using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.CognitiveServices.Speech;
using Microsoft.CognitiveServices.Speech.Audio;
using Microsoft.CognitiveServices.Speech.Transcription;

namespace MeetingNotes.Sidecar;

/// <summary>
/// C#-side port of the Node AzureTranscriptionService from meeting-notes.
/// Owns one Recognizer per source (mic = SpeechRecognizer, speaker =
/// ConversationTranscriber), feeds them from the audio resampler via
/// PushAudioInputStream, and surfaces events as JSON-Lines to the
/// Tauri main process.
///
/// Continuous Language ID is enabled; diarization for the speaker
/// channel is exposed via SpeakerId on ConversationTranscriptionResults.
/// </summary>
public sealed class AzureSpeechService : IDisposable
{
    public const string SourceMic = "mic";
    public const string SourceSpeaker = "speaker";

    // Mirrors the Node default list — keeps continuous-LID candidates stable
    // for the C# port. Settings.language is prepended by GetLidCandidates().
    private static readonly string[] ContinuousLidCandidates =
    {
        "de-DE", "en-US", "fr-FR", "es-ES", "it-IT",
        "pt-BR", "nl-NL", "pl-PL", "tr-TR", "ja-JP"
    };

    private readonly AzureSpeechConfig _config;
    private readonly UserSettings _settings;
    private readonly Dictionary<string, StreamState> _streams = new();
    private readonly HashSet<string> _missingSpeakerIdLogged = new();
    private readonly HashSet<string> _firstFrameLogged = new();
    private readonly Dictionary<string, FrameCounter> _pushCounters = new();

    private SpeechConfig? _speechConfig;
    private bool _initialized;

    public AzureSpeechService(AzureSpeechConfig config, UserSettings settings)
    {
        _config = config;
        _settings = settings;
    }

    public async Task InitAsync()
    {
        if (_initialized) return;
        Logger.Info("azure", "init", "AzureSpeechService.init: SDK wird initialisiert.");

        _speechConfig = SpeechConfig.FromSubscription(_config.SpeechKey, _config.Region);
        _speechConfig.SpeechRecognitionLanguage = _settings.Language;
        _speechConfig.SetProperty("SpeechServiceConnection_Endpoint", _config.Endpoint);
        _speechConfig.SetProperty("SpeechServiceResponse_DiarizeIntermediateResults", "true");
        _speechConfig.SetProperty(
            "SpeechServiceResponse_InterimResults",
            _config.InterimResults ? "true" : "false");
        _speechConfig.SetProperty("SpeechServiceConnection_LanguageIdMode", "Continuous");

        if (_config.Proxy is { } proxy)
        {
            _speechConfig.SetProxy(proxy.Host, proxy.Port, proxy.Username ?? string.Empty, proxy.Password ?? string.Empty);
            Logger.Info("azure", "proxy", $"Azure Speech Proxy konfiguriert ({proxy.Host}:{proxy.Port}).");
        }

        _initialized = true;
        Logger.Info(
            "azure",
            "config",
            $"AzureSpeechService.init: region={_config.Region}, language={_settings.Language}, " +
            $"interimResults={_config.InterimResults}, lidMode=Continuous.");
    }

    /// <summary>
    /// Starts both Recognizers (mic + speaker) for the given audio format.
    /// Rolls back partially-started streams if any recognizer start fails.
    /// </summary>
    public async Task StartAsync(AzureAudioFormat format)
    {
        if (_speechConfig is null)
            throw new InvalidOperationException("AzureSpeechService nicht initialisiert.");
        if (_streams.Count > 0)
            throw new InvalidOperationException("AzureSpeechService läuft bereits. Bitte zuerst StopAsync aufrufen.");

        var micState = EnsureStreamForFormat(SourceMic, format);
        var speakerState = EnsureStreamForFormat(SourceSpeaker, format);
        try
        {
            await StartStreamAsync(micState);
            await StartStreamAsync(speakerState);
        }
        catch
        {
            await StopAsync();
            throw;
        }
        Logger.Info("azure", "started", "Beide Recognizer laufen.");
    }

    public void PushFrame(AudioFrame frame)
    {
        if (_speechConfig is null) return;
        try
        {
            if (_firstFrameLogged.Add(frame.Source))
            {
                Logger.Info(
                    "audio",
                    "first_frame",
                    $"Erstes Audio-Frame empfangen (source={frame.Source}, " +
                    $"sampleRate={frame.SampleRate}, bits={frame.BitsPerSample}, " +
                    $"channels={frame.Channels}, bytes={frame.Payload.Length}).");
            }

            var state = _streams[frame.Source];
            state.PushStream.Write(frame.Payload);

            var counter = _pushCounters.GetValueOrDefault(frame.Source) ?? new FrameCounter();
            counter.Frames += 1;
            counter.Bytes += frame.Payload.Length;
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (now - counter.LastReport >= 5000)
            {
                var elapsed = (now - counter.LastReport) / 1000.0;
                Logger.Info(
                    "audio",
                    "push_stat",
                    $"pushFrame-Statistik ({frame.Source}): {counter.Frames} Frames, " +
                    $"{counter.Bytes} Bytes in {elapsed:F1}s (~{counter.Bytes / elapsed:F0} B/s).");
                counter.Reset(now);
            }
            _pushCounters[frame.Source] = counter;
        }
        catch (Exception ex)
        {
            Logger.Error("AZURE_RECOGNIZER_FAILED", $"pushFrame Fehler (source={frame.Source}): {ex.Message}");
        }
    }

    public async Task StopAsync()
    {
        Logger.Info("azure", "stopping", $"{_streams.Count} aktive Stream(s) werden beendet.");
        var closeTasks = _streams.Values.Select(state => Task.Run(() => FinalizeStream(state))).ToArray();
        await Task.WhenAll(closeTasks);
        _streams.Clear();
        _missingSpeakerIdLogged.Clear();
        _firstFrameLogged.Clear();
        _pushCounters.Clear();
    }

    public void Dispose() => StopAsync().GetAwaiter().GetResult();

    // ---------------- internals ----------------

    private StreamState EnsureStreamForFormat(string source, AzureAudioFormat format)
    {
        if (_speechConfig is null) throw new InvalidOperationException();
        if (_streams.TryGetValue(source, out var existing)) return existing;

        var audioFormat = AudioStreamFormat.GetWaveFormatPCM(
            (uint)format.SampleRate,
            (byte)format.BitsPerSample,
            (byte)format.Channels);
        var pushStream = AudioInputStream.CreatePushStream(audioFormat);
        var audioConfig = AudioConfig.FromStreamInput(pushStream);
        var autoDetect = AutoDetectSourceLanguageConfig.FromLanguages(GetLidCandidates());
        var useConversation = source == SourceSpeaker;

        Logger.Info(
            "azure",
            "stream_create",
            $"{useConversation} für {source} erstellt (sampleRate={format.SampleRate}, " +
            $"bits={format.BitsPerSample}, channels={format.Channels}).");

        if (useConversation)
        {
            var recognizer = new ConversationTranscriber(_speechConfig, autoDetect, audioConfig);
            AttachCommonDiagnostics(recognizer, source, "conversationTranscriber");
            recognizer.Transcribing += (_, e) =>
            {
                var text = e.Result?.Text?.Trim();
                if (!string.IsNullOrEmpty(text))
                    EmitTranscript(source, text, "interim", 0.8, null, ExtractConversationLanguage(e.Result));
            };
            recognizer.Transcribed += (_, e) =>
            {
                var text = e.Result?.Text?.Trim();
                if (!string.IsNullOrEmpty(text))
                {
                    var speaker = e.Result.SpeakerId?.Trim() ?? string.Empty;
                    EmitTranscript(source, text, "final", 0.9, string.IsNullOrEmpty(speaker) ? null : speaker,
                        ExtractConversationLanguage(e.Result));
                }
            };
            recognizer.Canceled += (_, e) => HandleCanceled(source, "conversationTranscriber", e);
            var state = new StreamState(recognizer, pushStream, "conversationTranscriber", source);
            _streams[source] = state;
            return state;
        }
        else
        {
            var recognizer = new SpeechRecognizer(_speechConfig, autoDetect, audioConfig);
            AttachCommonDiagnostics(recognizer, source, "speechRecognizer");
            recognizer.Recognizing += (_, e) =>
            {
                var text = e.Result?.Text?.Trim();
                if (!string.IsNullOrEmpty(text))
                    EmitTranscript(source, text, "interim", 0.8, source == SourceMic ? "self" : "guest",
                        ExtractSpeechLanguage(e.Result));
            };
            recognizer.Recognized += (_, e) =>
            {
                var text = e.Result?.Text?.Trim();
                if (!string.IsNullOrEmpty(text))
                    EmitTranscript(source, text, "final", 0.9, source == SourceMic ? "self" : "guest",
                        ExtractSpeechLanguage(e.Result));
            };
            recognizer.Canceled += (_, e) => HandleCanceled(source, "speechRecognizer", e);
            var state = new StreamState(recognizer, pushStream, "speechRecognizer", source);
            _streams[source] = state;
            return state;
        }
    }

    private async Task StartStreamAsync(StreamState state)
    {
        if (state.Started) return;
        var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

        if (state.Mode == "conversationTranscriber")
        {
            var recognizer = (ConversationTranscriber)state.RecognizerBase;
            await recognizer.StartTranscribingAsync();
            state.Started = true;
            Logger.Info("azure", "stream_start", $"startTranscribingAsync gestartet für {state.Source}.");
        }
        else
        {
            var recognizer = (SpeechRecognizer)state.RecognizerBase;
            await recognizer.StartContinuousRecognitionAsync();
            state.Started = true;
            Logger.Info("azure", "stream_start", $"startContinuousRecognitionAsync gestartet für {state.Source}.");
        }
        await tcs.Task;
    }

    private void FinalizeStream(StreamState state)
    {
        try
        {
            if (state.Mode == "conversationTranscriber")
            {
                if (state.Started) ((ConversationTranscriber)state.RecognizerBase).StopTranscribingAsync().GetAwaiter().GetResult();
            }
            else
            {
                if (state.Started) ((SpeechRecognizer)state.RecognizerBase).StopContinuousRecognitionAsync().GetAwaiter().GetResult();
            }
        }
        catch (Exception ex)
        {
            Logger.Warn("azure", "stop_error", $"stop-Fehler ({state.Mode}/{state.Source}): {ex.Message}");
        }
        try { state.PushStream.Close(); } catch { /* ignore */ }
        try { state.RecognizerBase.Dispose(); } catch { /* ignore */ }
        Logger.Info("azure", "stream_closed", $"Recognizer geschlossen (mode={state.Mode}, started={state.Started}).");
    }

    private void AttachCommonDiagnostics(Recognizer recognizer, string source, string mode)
    {
        recognizer.SessionStarted += (_, e) =>
            Logger.Info("azure", "session_start", $"Session gestartet (source={source}, mode={mode}, session={e.SessionId}).");
        recognizer.SessionStopped += (_, e) =>
            Logger.Info("azure", "session_stop", $"Session gestoppt (source={source}, mode={mode}, session={e.SessionId}).");
        recognizer.SpeechStartDetected += (_, e) =>
            Logger.Info("azure", "speech_start", $"Speech start erkannt (source={source}, mode={mode}, offset={e.Offset}).");
        recognizer.SpeechEndDetected += (_, e) =>
            Logger.Info("azure", "speech_end", $"Speech end erkannt (source={source}, mode={mode}, offset={e.Offset}).");
    }

    private void HandleCanceled(string source, string mode, RecognitionEventArgs e)
    {
        // ErrorDetails / Reason / ErrorCode live on the derived
        // *CanceledEventArgs classes; reflection keeps this helper generic.
        var prop = (string name) => e.GetType().GetProperty(name)?.GetValue(e)?.ToString();
        var details = (prop("ErrorDetails") ?? "Azure Recognizer wurde abgebrochen.").Trim();
        var reason = prop("Reason") ?? "n/a";
        var errorCode = prop("ErrorCode") ?? "n/a";
        var authRelated = System.Text.RegularExpressions.Regex.IsMatch(
            details, "auth|token|key|forbidden|unauthorized|401|403",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        var code = authRelated ? "AZURE_AUTH_FAILED" : "AZURE_RECOGNIZER_FAILED";
        Logger.Error("AZURE_CANCELED",
            $"Recognizer canceled (source={source}, mode={mode}, reason={reason}, " +
            $"errorCode={errorCode}): {details}");
        Logger.Event("transcript:error", new { code, message = $"[{source}/{mode}] {details}" });
    }

    private void EmitTranscript(string source, string text, string state, double confidence, string? speaker, string? language)
    {
        if (source == SourceSpeaker && string.IsNullOrEmpty(speaker) && _missingSpeakerIdLogged.Add(source))
        {
            Logger.Warn(
                "azure", "missing_speaker",
                $"ConversationTranscriber liefert für {source} aktuell keine speakerId. " +
                "Prüfe Region, Feature-Verfügbarkeit und ob diarization-fähige Events eintreffen.");
        }
        Logger.Event("transcript", new
        {
            id = Guid.NewGuid().ToString(),
            source,
            speaker = string.IsNullOrEmpty(speaker) ? "unknown" : speaker,
            language,
            timestampIso = DateTime.UtcNow.ToString("O"),
            text,
            state,
            confidence
        });
    }

    private string? ExtractSpeechLanguage(SpeechRecognitionResult result)
    {
        try
        {
            var detected = AutoDetectSourceLanguageResult.FromResult(result);
            var lang = detected?.Language?.Trim();
            return string.IsNullOrEmpty(lang) ? null : lang;
        }
        catch { return null; }
    }

    private string? ExtractConversationLanguage(SpeechRecognitionResult result)
    {
        try
        {
            var detected = AutoDetectSourceLanguageResult.FromResult(result);
            var lang = detected?.Language?.Trim();
            return string.IsNullOrEmpty(lang) ? null : lang;
        }
        catch { return null; }
    }

    private string[] GetLidCandidates()
    {
        var preferred = _settings.Language?.Trim() ?? string.Empty;
        var result = new List<string> { preferred };
        result.AddRange(ContinuousLidCandidates);
        return result.Where(s => !string.IsNullOrWhiteSpace(s)).Distinct().ToArray();
    }
}

// ---------------- supporting types ----------------

public sealed record AzureSpeechConfig(
    string Endpoint,
    string Region,
    string SpeechKey,
    bool InterimResults,
    AzureProxyConfig? Proxy);

public sealed record AzureProxyConfig(string Host, int Port, string? Username, string? Password);

public sealed record UserSettings(string Language, DeviceIds Devices);
public sealed record DeviceIds(string? MicId, string? SpeakerLoopbackId);

public sealed record AzureAudioFormat(int SampleRate, int BitsPerSample, int Channels);

public sealed record AudioFrame(string Source, int SampleRate, int BitsPerSample, int Channels, byte[] Payload);

internal sealed class StreamState
{
    public Recognizer RecognizerBase { get; }
    public PushAudioInputStream PushStream { get; }
    public string Mode { get; }
    public string Source { get; }
    public bool Started { get; set; }

    public StreamState(Recognizer recognizer, PushAudioInputStream pushStream, string mode, string source)
    {
        RecognizerBase = recognizer;
        PushStream = pushStream;
        Mode = mode;
        Source = source;
    }
}

internal sealed class FrameCounter
{
    public long Frames;
    public long Bytes;
    public long LastReport;

    public void Reset(long now)
    {
        Frames = 0;
        Bytes = 0;
        LastReport = now;
    }
}
