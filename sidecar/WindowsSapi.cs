using System.Globalization;
using System.Runtime.InteropServices;
using System.Speech.AudioFormat;
using System.Speech.Recognition;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace MeetingNotes.Sidecar;

internal sealed class WindowsSapi
{
    private static readonly TimeSpan TransitionBudget = TimeSpan.FromSeconds(8);
    private static readonly WaveFormat Pcm = new(SapiPcmStream.SampleRate, 16, 1);
    internal static readonly SpeechAudioFormatInfo SpeechPcm = new(SapiPcmStream.SampleRate, AudioBitsPerSample.Sixteen, AudioChannel.Mono);

    private readonly string _language;
    private readonly TranscriptionSettings _sources;
    private readonly string? _micId;
    private readonly string? _speakerId;
    private readonly string _sessionId = Guid.NewGuid().ToString();
    private readonly CancellationTokenSource _stop = new();
    private readonly SemaphoreSlim _lifecycle = new(1);
    private readonly object _gate = new();
    private Batch? _active;
    private bool _failed;

    private WindowsSapi(string language, TranscriptionSettings sources, string? micId, string? speakerId)
        => (_language, _sources, _micId, _speakerId) = (language, sources, micId, speakerId);

    internal static SpeechRecognitionEngine Open(string language)
    {
        if (!OperatingSystem.IsWindows() || RuntimeInformation.ProcessArchitecture != Architecture.X64)
            throw new InvalidOperationException("Windows SAPI requires a Windows x64 sidecar.");
        string culture;
        try { culture = CultureInfo.GetCultureInfo(language).Name; }
        catch (CultureNotFoundException)
        {
            throw new ArgumentException($"Invalid Windows SAPI language '{language}'. Use a specific culture such as de-DE.");
        }

        // Do not let SAPI select the default recognizer or a different locale.
        var installed = SpeechRecognitionEngine.InstalledRecognizers();
        Exception? failure = null;
        try
        {
            foreach (var info in installed.Where(i => string.Equals(i.Culture.Name, culture, StringComparison.OrdinalIgnoreCase)))
            {
                SpeechRecognitionEngine? engine = null;
                try
                {
                    engine = new SpeechRecognitionEngine(info);
                    engine.LoadGrammar(new DictationGrammar());
                    return engine;
                }
                catch (Exception ex)
                {
                    failure = ex;
                    engine?.Dispose();
                }
            }
        }
        finally
        {
            foreach (var info in installed) info.Dispose();
        }
        throw new InvalidOperationException(failure is null
            ? $"No x64 Windows SAPI desktop dictation recognizer is installed for '{language}'. A Windows display language alone is not enough."
            : $"The x64 Windows SAPI recognizer for '{language}' could not load DictationGrammar: {failure.Message}", failure);
    }

    internal static async Task<int> ProbeAsync(string language)
    {
        var probe = Task.Run(() =>
        {
            using var engine = Open(language);
            return $"x64 Windows SAPI dictation grammar loaded for {engine.RecognizerInfo.Culture.Name} ({engine.RecognizerInfo.Name}). Live audio was not tested.";
        });
        try
        {
            var detail = await probe.WaitAsync(TransitionBudget);
            Logger.Event("sapi_probe", new { ready = true, detail });
            return 0;
        }
        catch (Exception ex)
        {
            ObserveLateFault(probe);
            var detail = ex is TimeoutException ? "Timed out loading the Windows SAPI dictation grammar." : $"Windows SAPI not ready: {ex.Message}";
            Logger.Event("sapi_probe", new { ready = false, detail });
            return 1;
        }
    }

    internal static async Task<int> RunAsync(IReadOnlyDictionary<string, string?> args)
    {
        Logger.Event("handshake", new
        {
            protocol_version = ProtocolVersion.Current,
            sidecar_version = typeof(WindowsSapi).Assembly.GetName().Version?.ToString() ?? "0.0.0",
            capabilities = new[] { "transcription", "pause", "resume", "markdown_export" }
        });

        TranscriptionSettings sources;
        try
        {
            sources = ArgsParser.ParseTranscription(args);
            if (args.GetValueOrDefault("--audio-mode") is not (null or "dual-mono"))
                throw new ArgumentException("Windows SAPI requires dual-mono audio.");
            if (args.GetValueOrDefault("--sample-rate") is { } rate && rate != "16000")
                throw new ArgumentException("Windows SAPI requires 16 kHz PCM audio.");
            foreach (var flag in new[] { "--interim-results", "--auto-language-detection", "--diarization-mic", "--diarization-speaker" })
            {
                if (args.TryGetValue(flag, out var raw) && (!bool.TryParse(raw, out var enabled) || enabled))
                    throw new ArgumentException($"Windows SAPI supports {flag} only when false.");
            }
        }
        catch (ArgumentException ex)
        {
            Logger.Error("SIDECAR_START_FAILED", ex.Message);
            return 11;
        }
        if (!sources.Mic && !sources.Speaker)
        {
            Logger.Error("SIDECAR_START_FAILED", "No audio source selected for Windows SAPI transcription.");
            return 23;
        }
        var recording = new WindowsSapi(args.GetValueOrDefault("--language") ?? "de-DE", sources,
            args.GetValueOrDefault("--mic-device-id"), args.GetValueOrDefault("--speaker-device-id"));
        return await recording.RecordAsync();
    }

    private async Task<int> RecordAsync()
    {
        ConsoleCancelEventHandler onCancel = (_, e) => { e.Cancel = true; RequestShutdown(); };
        Console.CancelKeyPress += onCancel;
        var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        _ = Task.Run(async () =>
        {
            try { await RecordingControl.ReadCommandsAsync(Console.In, HandleCommandAsync, RequestShutdown, _stop.Token, ready.Task); }
            catch (Exception ex) { Fail($"The stdin reader stopped: {ex.Message}"); }
        });

        try
        {
            await TransitionAsync(() => StartAsync("started"));
            ready.TrySetResult();
            await Task.Delay(Timeout.InfiniteTimeSpan, _stop.Token);
        }
        catch (OperationCanceledException) when (_stop.IsCancellationRequested) { }
        catch (Exception ex)
        {
            Fail(TransitionError(ex, "start"), code: "SIDECAR_START_FAILED");
        }

        try
        {
            using var deadline = new CancellationTokenSource(RecordingControl.ShutdownBudget);
            await RecordingControl.CompleteShutdownAsync(async () =>
            {
                // A startup or a pause/resume operation may still own native handles.
                await _lifecycle.WaitAsync(deadline.Token);
                try
                {
                    if (_active is { } batch) await batch.CloseAsync(requireClean: batch.Emit && !_failed);
                    lock (_gate) _active = null;
                }
                finally { _lifecycle.Release(); }
            }, deadline.Token, acknowledge: false);
            if (_failed) return 50;
            Logger.Stopped();
            return 0;
        }
        catch (Exception ex)
        {
            Logger.Error("SIDECAR_UNAVAILABLE", ex is TimeoutException
                ? "Timed out waiting for Windows SAPI shutdown; the last results may be incomplete." : ex.Message);
            return 50;
        }
        finally { Console.CancelKeyPress -= onCancel; }
    }

    private async Task TransitionAsync(Func<Task> change)
    {
        var work = Task.Run(async () =>
        {
            await _lifecycle.WaitAsync(_stop.Token);
            try { await change(); }
            finally { _lifecycle.Release(); }
        });
        ObserveLateFault(work);
        await work.WaitAsync(TransitionBudget, _stop.Token);
    }

    private static void ObserveLateFault(Task task)
        => _ = task.ContinueWith(t => { _ = t.Exception; }, TaskContinuationOptions.OnlyOnFaulted);

    private static string TransitionError(Exception ex, string verb) => ex is TimeoutException
        ? $"Timed out waiting for Windows SAPI to {verb}."
        : $"Windows SAPI could not {verb}: {ex.Message}";

    private async Task HandleCommandAsync(string command)
    {
        switch (command)
        {
            case SidecarCommands.HandshakeAck:
                Logger.Info("sidecar", "handshake_ack", "Protocol handshake confirmed.");
                break;
            case SidecarCommands.Reset:
                Logger.Info("sidecar", "reset", "Reset command received.");
                break;
            case SidecarCommands.Pause:
            case SidecarCommands.Resume:
                try
                {
                    await TransitionAsync(command == SidecarCommands.Pause ? PauseAsync : () => StartAsync("resumed"));
                }
                catch (OperationCanceledException) when (_stop.IsCancellationRequested) { }
                catch (Exception ex) { Fail(TransitionError(ex, command)); }
                break;
            default:
                Logger.Warn("sidecar", "unknown_command", $"Unknown command: {command}");
                break;
        }
    }

    private async Task StartAsync(string phase)
    {
        Batch batch;
        lock (_gate)
        {
            _stop.Token.ThrowIfCancellationRequested();
            if (_active is not null) return;
            var lanes = new List<Lane>(2);
            if (_sources.Mic) lanes.Add(new("mic", "Mic", false, _micId));
            if (_sources.Speaker) lanes.Add(new("speaker", "Speaker-Loopback", true, _speakerId));
            _active = batch = new Batch(lanes);
        }

        // Open every requested dictation engine before opening audio devices.
        foreach (var lane in batch.Lanes)
        {
            _stop.Token.ThrowIfCancellationRequested();
            try { lane.Engine = Open(_language); }
            catch (Exception ex) { throw new InvalidOperationException($"[{lane.Source}] {ex.Message}", ex); }
        }
        foreach (var lane in batch.Lanes)
        {
            _stop.Token.ThrowIfCancellationRequested();
            lane.Start(
                result => Publish(batch, lane, result),
                reason => Fail(reason, batch, "SAPI_RECOGNIZER_FAILED"));
        }
        await Task.WhenAll(batch.Lanes.Select(lane => lane.Ready.Task)).WaitAsync(_stop.Token);

        lock (_gate)
        {
            _stop.Token.ThrowIfCancellationRequested();
            batch.Emit = true;
            Logger.Info("sapi", phase, $"Windows SAPI session {_sessionId}; language={_language}; sources={string.Join(", ", batch.Lanes.Select(l => l.Source))}.");
            Logger.Event("status", new { phase, running = true });
        }
    }

    private async Task PauseAsync()
    {
        Batch? batch;
        lock (_gate)
        {
            _stop.Token.ThrowIfCancellationRequested();
            batch = _active;
            if (batch is null) return;
            // Invalidate the generation before tearing down the native streams.
            // In particular, no old callback can publish after the pause ack.
            _active = null;
            batch.FinishAudio(discard: true);
        }
        await batch.CloseAsync(requireClean: true);
        lock (_gate)
        {
            _stop.Token.ThrowIfCancellationRequested();
            Logger.Info("sapi", "pause", "Windows SAPI paused; buffered audio was discarded.");
            Logger.Event("status", new { phase = "paused", running = true });
        }
    }

    private void Publish(Batch batch, Lane lane, RecognitionResult result)
    {
        lock (_gate)
        {
            if (_active != batch || !batch.Emit || _failed || string.IsNullOrWhiteSpace(result.Text)) return;
            Logger.Event("transcript", new
            {
                id = Guid.NewGuid().ToString(),
                source = lane.Source,
                speaker = lane.Loopback ? "guest" : "self", // Existing non-diarized source labels, not speaker identities.
                sessionId = _sessionId,
                language = _language,
                timestampIso = DateTime.UtcNow.ToString("O"),
                text = result.Text,
                state = "final",
                confidence = result.Confidence
            });
        }
    }

    private void Fail(string detail, Batch? batch = null, string code = "SIDECAR_UNAVAILABLE")
    {
        lock (_gate)
        {
            if (_failed || (batch is not null && (_active != batch || _stop.IsCancellationRequested))) return;
            _failed = true;
            _active?.FinishAudio(discard: true);
            Logger.Error(code, detail);
            _stop.Cancel();
        }
    }

    private void RequestShutdown()
    {
        lock (_gate)
        {
            _active?.FinishAudio(discard: !_active.Emit || _failed);
            _stop.Cancel();
        }
    }

    private sealed class Batch(List<Lane> lanes)
    {
        public List<Lane> Lanes { get; } = lanes;
        public bool Emit { get; set; }
        public void FinishAudio(bool discard)
        {
            foreach (var lane in Lanes) lane.Input.Finish(discard);
        }
        public Task CloseAsync(bool requireClean)
            => Task.WhenAll(Lanes.Select(lane => Task.Run(() => lane.CloseAsync(requireClean))));
    }

    private sealed class Lane(string source, string label, bool loopback, string? id)
    {
        public string Source { get; } = source;
        public bool Loopback { get; } = loopback;
        public SpeechRecognitionEngine? Engine { get; set; }
        public SapiPcmStream Input { get; } = new();
        public TaskCompletionSource Ready { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource<RecognizeCompletedEventArgs> _completed = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _eof;
        private bool _submitted;
        private MMDevice? _device;
        private AudioRecorderSource? _capture;

        public void Start(Action<RecognitionResult> recognized, Action<string> failed)
        {
            using var devices = new MMDeviceEnumerator();
            _device = (Loopback ? DeviceResolver.ResolveOutputDevice(devices, id) : DeviceResolver.ResolveInputDevice(devices, id))
                ?? throw new InvalidOperationException($"No {label} audio device found.");
            _capture = AudioRecorderSource.Create(_device, Loopback, Pcm, label, includePacketTimestamp: false,
                (pcm, _, _, _) =>
                {
                    if (!Input.TryPush(pcm)) failed($"[{Source}] Windows SAPI audio buffer overran or received invalid PCM.");
                });
            _capture.CaptureFailed += ex => failed($"[{Source}] Windows SAPI capture failed: {ex.Message}");
            var engine = Engine!;
            engine.AudioStateChanged += (_, e) => { if (e.AudioState != AudioState.Stopped) Ready.TrySetResult(); };
            engine.SpeechRecognized += (_, e) => recognized(e.Result);
            engine.RecognizeCompleted += (_, e) =>
            {
                _completed.TrySetResult(e);
                if (Volatile.Read(ref _eof) == 0)
                    failed($"[{Source}] Windows SAPI recognition ended unexpectedly: {e.Error?.Message ?? "audio stream ended"}.");
            };
            engine.SetInputToAudioStream(Input, SpeechPcm);
            engine.RecognizeAsync(RecognizeMode.Multiple);
            _submitted = true;
            _capture.Start();
            Logger.Info("format", "sapi_capture_format", $"{label}: {_capture.Format} ({_capture.ModeLabel}); SAPI input: {Pcm}.");
        }

        public async Task CloseAsync(bool requireClean)
        {
            Interlocked.Exchange(ref _eof, 1);
            try
            {
                _capture?.Stop();
                if (_submitted)
                {
                    var completed = await _completed.Task;
                    if (requireClean && (completed.Error is not null || completed.Cancelled))
                        throw new InvalidOperationException($"[{Source}] Windows SAPI did not stop cleanly: {completed.Error?.Message ?? "recognition cancelled"}.");
                }
            }
            finally
            {
                try { _capture?.Dispose(); }
                finally
                {
                    try { Engine?.Dispose(); }
                    finally
                    {
                        Input.Dispose();
                        _device?.Dispose();
                    }
                }
            }
        }
    }
}
