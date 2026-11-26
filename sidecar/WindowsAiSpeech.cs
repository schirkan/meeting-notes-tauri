#if WINDOWS_AI_SPEECH
using Microsoft.Windows.AI;
using Microsoft.Windows.AI.Speech;
using Windows.Media.Devices;
#endif

namespace MeetingNotes.Sidecar;

internal static class WindowsAiSpeech
{
    private const string NotBuilt = "Windows AI Speech is not included in the portable sidecar. It requires the experimental Windows App SDK sidecar with MSIX package identity and the systemAIModels capability.";

    internal static async Task<int> ProbeAsync(string? language)
    {
        var (ready, detail) = await ReadinessAsync(language);
        Logger.Event("windows_ai_speech_probe", new { ready, detail });
        return ready ? 0 : 1;
    }

    internal static Task<int> RunAsync(IReadOnlyDictionary<string, string?> args)
    {
        Logger.Event("handshake", new
        {
            protocol_version = ProtocolVersion.Current,
            sidecar_version = typeof(WindowsAiSpeech).Assembly.GetName().Version?.ToString() ?? "0.0.0",
            capabilities = new[] { "transcription", "markdown_export" }
        });
#if WINDOWS_AI_SPEECH
        try
        {
            var sources = ArgsParser.ParseTranscription(args);
            if (!sources.Mic || sources.Speaker)
                throw new ArgumentException("Windows AI Speech requires microphone transcription only (--transcription-mic true --transcription-speaker false).");
            if (!string.IsNullOrWhiteSpace(args.GetValueOrDefault("--mic-device-id")))
                throw new ArgumentException("Windows AI Speech uses the Windows default microphone; --mic-device-id is not supported.");
            if (args.GetValueOrDefault("--audio-mode") is not (null or "dual-mono"))
                throw new ArgumentException("Windows AI Speech does not support stereo audio.");
            foreach (var flag in new[] { "--interim-results", "--auto-language-detection", "--diarization-mic", "--diarization-speaker" })
            {
                if (args.TryGetValue(flag, out var raw) && (!bool.TryParse(raw, out var enabled) || enabled))
                    throw new ArgumentException($"Windows AI Speech supports {flag} only when false.");
            }
            if (!string.IsNullOrWhiteSpace(args.GetValueOrDefault("--language")))
                throw new ArgumentException("This Windows AI Speech experiment uses the SDK's default recognition locale. Omit --language when recording.");
            return RecordAsync();
        }
        catch (ArgumentException ex)
        {
            Logger.Error("SIDECAR_START_FAILED", ex.Message);
        }
#else
        Logger.Error("SIDECAR_START_FAILED", NotBuilt);
#endif
        return Task.FromResult(11);
    }

#if WINDOWS_AI_SPEECH
    private static readonly TimeSpan StartupBudget = TimeSpan.FromSeconds(8);

    internal static SpeechRecognitionModelFactory OpenReadyFactory()
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 26100))
            throw new InvalidOperationException("Windows AI Speech requires Windows 11 24H2 (build 26100) or newer.");
        try { _ = Windows.ApplicationModel.Package.Current.Id.Name; }
        catch (InvalidOperationException ex)
        {
            throw new InvalidOperationException("The experimental sidecar is running without MSIX package identity. Its package must declare systemAIModels.", ex);
        }

        var factory = SpeechRecognitionModelFactory.Default;
        var state = factory.GetReadyState();
        // EnsureReadyAsync can download the model via Windows Update. Never call it.
        if (state != AIFeatureReadyState.Ready)
            throw new InvalidOperationException($"The Windows AI Speech model is not ready ({state}). No download was started.");
        return factory;
    }

    private static async Task<(bool Ready, string Detail)> ReadinessAsync(string? language)
    {
        var probe = Task.Run(async () =>
        {
            using var model = await OpenReadyFactory().CreateAsync();
            return "The Windows AI Speech model opened with the SDK's default recognition locale. Live audio was not tested."
                + (string.IsNullOrWhiteSpace(language) ? "" : " The requested locale was not used.");
        });
        try { return (true, await probe.WaitAsync(StartupBudget)); }
        catch (Exception ex)
        {
            _ = probe.ContinueWith(t => { _ = t.Exception; }, TaskContinuationOptions.OnlyOnFaulted);
            return (false, ex is TimeoutException ? "Timed out opening the Windows AI Speech model." : $"Windows AI Speech not ready: {ex.Message}");
        }
    }

    private static async Task<int> RecordAsync()
    {
        // Keep the token alive if the stdin worker or native operation outlives the shutdown budget.
        var stop = new CancellationTokenSource();
        ConsoleCancelEventHandler onCancel = (_, e) => { e.Cancel = true; stop.Cancel(); };
        Console.CancelKeyPress += onCancel;
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var record = Task.Run(() => RunNativeAsync(started, stop.Token));
        _ = record.ContinueWith(t => { _ = t.Exception; }, TaskContinuationOptions.OnlyOnFaulted);
        _ = Task.Run(async () =>
        {
            try { await RecordingControl.ReadCommandsAsync(Console.In, HandleCommandAsync, stop.Cancel, stop.Token, started.Task); }
            catch (Exception ex) { Logger.Error("SIDECAR_UNAVAILABLE", $"The stdin reader stopped: {ex.Message}"); }
        });
        try
        {
            var startDeadline = Task.Delay(StartupBudget, stop.Token);
            if (await Task.WhenAny(record, started.Task, startDeadline) == startDeadline && !stop.IsCancellationRequested)
                throw new TimeoutException("Timed out starting Windows AI Speech.");

            await Task.WhenAny(record, Task.Delay(Timeout.InfiniteTimeSpan, stop.Token));
            await record.WaitAsync(RecordingControl.ShutdownBudget);
            Logger.Stopped();
            return 0;
        }
        catch (Exception ex)
        {
            Logger.Error(started.Task.IsCompletedSuccessfully ? "SIDECAR_UNAVAILABLE" : "SIDECAR_START_FAILED",
                $"Windows AI Speech: {ex.Message}");
            return 50;
        }
        finally
        {
            stop.Cancel();
            Console.CancelKeyPress -= onCancel;
        }
    }

    private static async Task RunNativeAsync(TaskCompletionSource started, CancellationToken stopping)
    {
        // Own all native handles here; neither cancellation nor a timeout may dispose them concurrently.
        using var model = await OpenReadyFactory().CreateAsync();
        if (stopping.IsCancellationRequested) return;
        var micId = MediaDevice.GetDefaultAudioCaptureId(AudioDeviceRole.Default);
        if (string.IsNullOrWhiteSpace(micId)) throw new InvalidOperationException("No Windows default microphone is available.");
        using var recognizer = new StreamingRecognition(AudioConfiguration.FromAudioDevice(micId), model);
        var sessionId = Guid.NewGuid().ToString();
        var gate = new object();
        var emit = false;
        void Recognized(StreamingRecognition _, StreamingRecognizedEventArgs result)
        {
            lock (gate)
            {
                if (!emit || !result.IsFinal) return;
                var text = result.Text;
                if (string.IsNullOrWhiteSpace(text)) return;
                Logger.Event("transcript", new
                {
                    id = Guid.NewGuid().ToString(),
                    source = "mic",
                    speaker = "self",
                    sessionId,
                    timestampIso = DateTime.UtcNow.ToString("O"),
                    text,
                    state = "final"
                });
            }
        }
        recognizer.Recognized += Recognized;
        try
        {
            if (stopping.IsCancellationRequested) return;
            await recognizer.StartContinuousRecognitionAsync();
            try
            {
                lock (gate)
                {
                    if (!stopping.IsCancellationRequested)
                    {
                        Logger.Event("status", new { phase = "started", running = true });
                        emit = true;
                        started.TrySetResult();
                    }
                }
                await Task.Delay(Timeout.InfiniteTimeSpan, stopping);
            }
            catch (OperationCanceledException) when (stopping.IsCancellationRequested) { }
            finally { await recognizer.StopContinuousRecognitionAsync(); }
        }
        finally
        {
            lock (gate) emit = false;
            recognizer.Recognized -= Recognized;
        }
    }

    private static Task HandleCommandAsync(string command)
    {
        switch (command)
        {
            case SidecarCommands.HandshakeAck:
                Logger.Info("sidecar", "handshake_ack", "Protocol handshake confirmed.");
                break;
            case SidecarCommands.Reset:
                Logger.Info("sidecar", "reset", "Reset command received.");
                break;
            default:
                Logger.Warn("sidecar", "unsupported_command", $"Windows AI Speech does not support this command: {command}");
                break;
        }
        return Task.CompletedTask;
    }
#else
    private static Task<(bool Ready, string Detail)> ReadinessAsync(string? _) => Task.FromResult((false, NotBuilt));
#endif
}
