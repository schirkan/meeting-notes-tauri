using Microsoft.CognitiveServices.Speech;
using Microsoft.CognitiveServices.Speech.Audio;
using Microsoft.CognitiveServices.Speech.Transcription;

namespace MeetingNotes.Sidecar;

public sealed record SpeechConnectivityStep(string step, string status, string detail);
public sealed record SpeechConnectivityResult(bool reachable, IReadOnlyList<SpeechConnectivityStep> steps);

public static class SpeechConnectivityDiagnostic
{
    public static async Task<SpeechConnectivityResult> RunFromArgsAsync(IReadOnlyDictionary<string, string?> args)
    {
        // Kein eigener TLS-Schritt: Die Zertifikatspruefung ist eine feste
        // Eigenschaft des nativen SDK-Pfads (kein offiziell unterstuetzter
        // Bypass) und keine Messgroesse dieses Tests. Sie aeussert sich ohnehin
        // als Fehler in den eigentlichen WSS-Proben, wenn die Kette nicht
        // vertrauenswuerdig ist. Der Dialog weist die Pruefung einmal als
        // Hinweis aus.
        var steps = new List<SpeechConnectivityStep>();
        try
        {
            var key = SpeechConfiguration.GetSpeechKey(args);
            var region = args.GetValueOrDefault("--speech-region");
            var endpoint = args.GetValueOrDefault("--speech-endpoint") ?? string.Empty;
            var model = SpeechConfiguration.ParseModel(args.GetValueOrDefault("--speech-model"));
            var language = args.GetValueOrDefault("--language") ?? "de-DE";
            if (string.IsNullOrWhiteSpace(key) || key == "true" || string.IsNullOrWhiteSpace(region) || region == "true")
            {
                steps.Add(new("speech_config", "error", "Speech key and region are required."));
                return new(false, steps);
            }
            if (model == AzureSpeechModel.Standard &&
                (!Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) ||
                 (uri.Scheme != "https" && uri.Scheme != "wss") || !string.IsNullOrEmpty(uri.UserInfo) ||
                 !string.IsNullOrEmpty(uri.Fragment) || string.IsNullOrWhiteSpace(language) || language == "true"))
            {
                steps.Add(new("speech_config", "error", "Standard requires a valid HTTPS/WSS endpoint (without userinfo/fragment) and language."));
                return new(false, steps);
            }
            var sources = ArgsParser.ParseTranscription(args);
            var stereo = ArgsParser.ParseStereo(args, sources, model);
            var diarization = ArgsParser.ParseDiarization(args);
            var autoLanguageDetection = ArgsParser.ParseAutoLanguageDetection(args);
            var proxy = ProxyOptions.Parse(args);
            steps.Add(new("speech_proxy", "ok", proxy is null ? "Native Speech SDK uses direct transport." : "Native Speech SDK SetProxy configured; credentials are not logged."));
            var config = new AzureSpeechConfig(endpoint, region, key, ArgsParser.ParseInterimResults(args), proxy, model);
            var timeout = TimeSpan.FromSeconds(12);
            var probes = stereo
                ? new[] { await ProbeAsync(config, language, (sources.Mic && diarization.Mic) || (sources.Speaker && diarization.Speaker), timeout, stereo: true) }
                : model == AzureSpeechModel.Standard
                ? await Task.WhenAll(ProbeAsync(config, language, false, timeout, autoLanguageDetection: autoLanguageDetection),
                    ProbeAsync(config, language, true, timeout, autoLanguageDetection: autoLanguageDetection))
                : new[] { await ProbeAsync(config, language, false, timeout) };
            foreach (var probe in probes) steps.AddRange(probe);
            return new(probes.All(p => p[0].status == "ok"), steps);
        }
        catch (ArgumentException)
        {
            steps.Add(new("speech_config", "error", "Invalid Speech or proxy configuration. Check the model, region and key. Proxy requires a hostname/IP and port 1-65535."));
            return new(false, steps);
        }
        catch (Exception ex)
        {
            steps.Add(new("speech_config", "error", $"Speech diagnostic could not initialize ({ex.GetType().Name}); sensitive SDK details omitted."));
            return new(false, steps);
        }
    }

    public static async Task<IReadOnlyList<SpeechConnectivityStep>> ProbeAsync(
        AzureSpeechConfig config, string language, bool conversation, TimeSpan timeout, bool stereo = false, bool autoLanguageDetection = true)
    {
        conversation = config.Model == AzureSpeechModel.Standard && conversation;
        var name = config.Model == AzureSpeechModel.MaiTranscribe2Streaming
            ? "mai_transcribe_wss"
            : (conversation ? "conversation_transcriber_wss" : "speech_recognizer_wss");
        if (stereo) name += "_stereo";
        var connectionHint = config.Model == AzureSpeechModel.Standard
            ? "Check credentials, endpoint, proxy and TLS trust"
            : "Check credentials, MAI region availability, proxy and TLS trust";
        var steps = new List<SpeechConnectivityStep>();
        SpeechConfig? speech = null;
        AudioStreamFormat? format = null;
        PushAudioInputStream? push = null;
        AudioConfig? audio = null;
        AutoDetectSourceLanguageConfig? lid = null;
        Recognizer? recognizer = null;
        Connection? connection = null;
        Func<Task>? stop = null;
        Task? feeding = null;
        var cleaningUp = 0;
        using var deadline = new CancellationTokenSource(timeout);
        using var feedCancellation = new CancellationTokenSource();
        var connected = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var session = new TaskCompletionSource<SpeechConnectivityStep>(TaskCreationOptions.RunContinuationsAsynchronously);
        var failure = new TaskCompletionSource<SpeechConnectivityStep>(TaskCreationOptions.RunContinuationsAsynchronously);
        void Fail(string detail)
        {
            if (Volatile.Read(ref cleaningUp) != 0) return;
            var result = new SpeechConnectivityStep(name, "error", detail);
            failure.TrySetResult(result);
            session.TrySetResult(result);
        }
        try
        {
            speech = SpeechConfiguration.Create(config, language, diarizeIntermediateResults: conversation, stereo: stereo, autoLanguageDetection: autoLanguageDetection);
            var channels = (byte)(stereo ? 2 : 1);
            format = AudioStreamFormat.GetWaveFormatPCM(16000, 16, channels);
            push = AudioInputStream.CreatePushStream(format);
            audio = AudioConfig.FromStreamInput(push);
            lid = stereo ? null : SpeechConfiguration.CreateLanguageDetection(config.Model, language, autoLanguageDetection);
            Func<Task> start;
            if (conversation)
            {
                var transcriber = lid is null ? new ConversationTranscriber(speech, audio) : new ConversationTranscriber(speech, lid, audio);
                transcriber.Canceled += (_, e) => Fail($"Native SDK canceled: reason={e.Reason}, code={e.ErrorCode}. {connectionHint}; sensitive SDK details omitted.");
                recognizer = transcriber;
                start = transcriber.StartTranscribingAsync;
                stop = transcriber.StopTranscribingAsync;
            }
            else
            {
                var speechRecognizer = SpeechConfiguration.CreateRecognizer(speech, audio, lid);
                speechRecognizer.Canceled += (_, e) => Fail($"Native SDK canceled: reason={e.Reason}, code={e.ErrorCode}. {connectionHint}; sensitive SDK details omitted.");
                recognizer = speechRecognizer;
                start = speechRecognizer.StartContinuousRecognitionAsync;
                stop = speechRecognizer.StopContinuousRecognitionAsync;
            }
            connection = Connection.FromRecognizer(recognizer);
            connection.Connected += (_, _) => connected.TrySetResult(true);
            connection.Disconnected += (_, _) => Fail("Native SDK WSS connection disconnected before readiness verification completed.");
            recognizer.SessionStarted += (_, _) => session.TrySetResult(new(name, "ok", $"Native SDK WSS Connected and SessionStarted received with silent 16 kHz { (stereo ? "stereo" : "mono") } PCM; recognition and channel routing were not tested."));
            recognizer.SessionStopped += (_, _) => Fail("Native SDK session stopped before readiness verification completed.");
            var stream = push;
            feeding = Task.Run(async () =>
            {
                var silence = new byte[640 * channels];
                try
                {
                    while (!feedCancellation.IsCancellationRequested)
                    {
                        stream.Write(silence);
                        await Task.Delay(20, feedCancellation.Token);
                    }
                }
                catch (OperationCanceledException) when (feedCancellation.IsCancellationRequested) { }
                catch (Exception ex) { Fail($"Silent input failed ({ex.GetType().Name}); sensitive SDK details omitted."); }
            });
            var starting = Task.Run(start);
            // WaitAsync does not cancel native SDK operations; observe late faults and dispose during cleanup.
            _ = starting.ContinueWith(t => { _ = t.Exception; }, TaskContinuationOptions.OnlyOnFaulted);
            var completed = await Task.WhenAny(starting, failure.Task).WaitAsync(deadline.Token);
            if (completed == starting) await starting;
            var result = await session.Task.WaitAsync(deadline.Token);
            if (result.status == "ok")
            {
                await Task.WhenAny(connected.Task, failure.Task).WaitAsync(deadline.Token);
                await Task.WhenAny(failure.Task, Task.Delay(1000, deadline.Token)).WaitAsync(deadline.Token);
                if (failure.Task.IsCompletedSuccessfully) result = await failure.Task;
            }
            steps.Add(result);
        }
        catch (OperationCanceledException)
        {
            steps.Add(failure.Task.IsCompletedSuccessfully ? await failure.Task :
                new(name, "error", "Timed out waiting for native SDK session readiness (including cancellation observation)."));
        }
        catch (Exception ex)
        {
            steps.Add(failure.Task.IsCompletedSuccessfully ? await failure.Task :
                new(name, "error", $"Native SDK start failed ({ex.GetType().Name}); sensitive SDK details omitted."));
        }
        finally
        {
            Interlocked.Exchange(ref cleaningUp, 1);
            feedCancellation.Cancel();
            try
            {
                if (feeding is not null) await feeding.WaitAsync(TimeSpan.FromSeconds(1));
            }
            catch { }
            try
            {
                await Task.Run(async () =>
                {
                    try
                    {
                        connection?.Close();
                        push?.Close();
                        if (stop is not null) await Task.Run(stop).WaitAsync(TimeSpan.FromSeconds(2));
                    }
                    finally
                    {
                        var disposalFailed = false;
                        foreach (var resource in new IDisposable?[] { connection, recognizer, audio, push, format })
                        {
                            try { resource?.Dispose(); }
                            catch { disposalFailed = true; }
                        }
                        if (disposalFailed) throw new InvalidOperationException("Native resource disposal failed.");
                    }
                });
            }
            catch
            {
                steps.Add(new(name + "_cleanup", "warn", "Native SDK stop or disposal reported a failure; disposal of every owned native resource was attempted before reporting."));
            }
        }
        return steps;
    }
}
