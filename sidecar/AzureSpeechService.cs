using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.CognitiveServices.Speech;
using Microsoft.CognitiveServices.Speech.Audio;
using Microsoft.CognitiveServices.Speech.Transcription;

namespace MeetingNotes.Sidecar;

/// <summary>
/// C#-side port of the Node AzureTranscriptionService from meeting-notes.
/// Owns one recognizer per source: ConversationTranscriber when that
/// source's diarization is enabled, otherwise SpeechRecognizer. Feeds
/// resampled audio via PushAudioInputStream and emits JSON-Lines.
/// Continuous Language ID is enabled; diarized interim and final events
/// retain the SDK SpeakerId and source for frontend namespacing.
/// </summary>
public sealed class AzureSpeechService : IDisposable
{
    public const string SourceMic = "mic";
    public const string SourceSpeaker = "speaker";

    private readonly AzureSpeechConfig _config;
    private readonly UserSettings _settings;
    // ConcurrentDictionary: die Capture-Threads lesen die Streams
    // waehrend eine vom Dienst beendete Sitzung neu verbunden wird (T-507).
    private readonly ConcurrentDictionary<string, StreamState> _streams = new();
    private readonly HashSet<string> _missingSpeakerIdLogged = new();
    private readonly HashSet<string> _firstFrameLogged = new();
    private readonly Dictionary<string, FrameCounter> _pushCounters = new();

    /// <summary>
    /// Laufende Kennung des Sidecar-Prozesses. Sie dient als Session-ID im
    /// Segment-Payload, solange Azure fuer die Quelle noch keine
    /// Session-ID gemeldet hat (T-507).
    /// </summary>
    private readonly string _runId = Guid.NewGuid().ToString("N");

    /// <summary>
    /// Pause-Zustand (T-507): die Azure-Session bleibt verbunden, es
    /// werden aber keine Audioframes mehr zugespeist. Der pausierte
    /// Abschnitt wird dadurch nicht transkribiert.
    /// </summary>
    private volatile bool _paused;

    private SpeechConfig? _speechConfig;
    private bool _initialized;
    private AzureAudioFormat? _format;
    private bool _stopping;

    public AzureSpeechService(AzureSpeechConfig config, UserSettings settings)
    {
        _config = config;
        _settings = settings;
    }

    /// <summary>Laufzeit-Kennung dieses Sidecar-Prozesses.</summary>
    public string RunId => _runId;

    /// <summary>Ist die Aufnahme pausiert (Azure-Session lebt weiter)?</summary>
    public bool IsPaused => _paused;

    /// <summary>
    /// Pausiert oder aktiviert die Aufnahme. Die Azure-Session wird
    /// dabei weder gestoppt noch neu verbunden, damit die vom Azure-Dienst
    /// vergebenen Sprecher-IDs gueltig bleiben (T-507).
    /// </summary>
    public void SetPaused(bool paused)
    {
        if (_paused == paused) return;
        _paused = paused;
        Logger.Info(
            "azure",
            paused ? "paused" : "resumed",
            paused
                ? "Audio-Zufuhr gestoppt; Azure-Session bleibt verbunden."
                : "Audio-Zufuhr wieder aktiv.");
    }

    public async Task InitAsync()
    {
        if (_initialized) return;
        Logger.Info("azure", "init", "AzureSpeechService.init: SDK wird initialisiert.");

        _speechConfig = SpeechConfiguration.Create(_config, _settings.Language,
            _settings.Diarization.Mic || _settings.Diarization.Speaker);

        if (_config.Proxy is not null)
            Logger.Info("azure", "proxy", "Azure Speech Proxy konfiguriert; Zugangsdaten werden nicht protokolliert.");

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
        _format = format;
        _stopping = false;

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
        // Pause (T-507): die Azure-Session lebt weiter, aber es werden
        // keine Audioframes mehr zugespeist. Der pausierte Abschnitt
        // erscheint deshalb nicht im Transkript.
        if (_paused) return;
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

            // TryGetValue statt Indexer: waehrend eines Reconnects kann die
            // Quelle kurzzeitig ohne Stream sein. Der Frame wird dann
            // verworfen, statt eine Ausnahme in die Capture-Schleife zu
            // tragen.
            if (!_streams.TryGetValue(frame.Source, out var state)) return;
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

    /// <summary>
    /// Verbindet Quellen neu, deren Azure-Session vom Dienst beendet wurde
    /// (z. B. nach dem 60-Minuten-Limit der Verbindung). Eine Neuverbindung
    /// vergibt neue Sprecher-IDs — das UI erkennt das an der Session-ID im
    /// Segment und baut die Sprecherbasis neu auf (T-507).
    /// </summary>
    public async Task<string[]> ReconnectDeadStreamsAsync()
    {
        if (_format is null) return Array.Empty<string>();
        var restarted = new List<string>();
        foreach (var source in _streams.Where(pair => pair.Value.SessionDead).Select(pair => pair.Key).ToArray())
        {
            var dead = _streams[source];
            FinalizeStream(dead);
            _streams.TryRemove(source, out _);
            var fresh = EnsureStreamForFormat(source, _format);
            await StartStreamAsync(fresh);
            restarted.Add(source);
        }
        if (restarted.Count > 0)
            Logger.Info("azure", "session_restarted",
                $"{restarted.Count} Quelle(n) neu verbunden: {string.Join(", ", restarted)}. " +
                "Die Sprecher-IDs wurden neu vergeben.");
        return restarted.ToArray();
    }

    public async Task StopAsync()
    {
        _stopping = true;
        Logger.Info("azure", "stopping", $"{_streams.Count} aktive Stream(s) werden beendet.");
        var closeTasks = _streams.Values.Select(state => Task.Run(() => FinalizeStream(state))).ToArray();
        await Task.WhenAll(closeTasks);
        _streams.Clear();
        lock (_missingSpeakerIdLogged) _missingSpeakerIdLogged.Clear();
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
        var useConversation = GetRecognitionMode(source) == "conversationTranscriber";

        Logger.Info(
            "azure",
            "stream_create",
            $"{useConversation} für {source} erstellt (sampleRate={format.SampleRate}, " +
            $"bits={format.BitsPerSample}, channels={format.Channels}).");

        if (useConversation)
        {
            var recognizer = new ConversationTranscriber(_speechConfig, autoDetect, audioConfig);
            var state = new StreamState(recognizer, pushStream, "conversationTranscriber", source);
            AttachCommonDiagnostics(recognizer, state);
            recognizer.Transcribing += (_, e) =>
            {
                var text = e.Result?.Text?.Trim();
                if (!string.IsNullOrEmpty(text))
                    EmitTranscript(source, text, "interim", 0.8, e.Result?.SpeakerId,
                        ExtractConversationLanguage(e.Result), state.ResolveSessionId());
            };
            recognizer.Transcribed += (_, e) =>
            {
                var text = e.Result?.Text?.Trim();
                if (!string.IsNullOrEmpty(text))
                    EmitTranscript(source, text, "final", 0.9, e.Result?.SpeakerId,
                        ExtractConversationLanguage(e.Result), state.ResolveSessionId());
            };
            recognizer.Canceled += (_, e) => HandleCanceled(source, "conversationTranscriber", e);
            _streams[source] = state;
            return state;
        }
        else
        {
            var recognizer = new SpeechRecognizer(_speechConfig, autoDetect, audioConfig);
            var state = new StreamState(recognizer, pushStream, "speechRecognizer", source);
            AttachCommonDiagnostics(recognizer, state);
            recognizer.Recognizing += (_, e) =>
            {
                var text = e.Result?.Text?.Trim();
                if (!string.IsNullOrEmpty(text))
                    EmitTranscript(source, text, "interim", 0.8, source == SourceMic ? "self" : "guest",
                        ExtractSpeechLanguage(e.Result), state.ResolveSessionId());
            };
            recognizer.Recognized += (_, e) =>
            {
                var text = e.Result?.Text?.Trim();
                if (!string.IsNullOrEmpty(text))
                    EmitTranscript(source, text, "final", 0.9, source == SourceMic ? "self" : "guest",
                        ExtractSpeechLanguage(e.Result), state.ResolveSessionId());
            };
            recognizer.Canceled += (_, e) => HandleCanceled(source, "speechRecognizer", e);
            _streams[source] = state;
            return state;
        }
    }

    private async Task StartStreamAsync(StreamState state)
    {
        if (state.Started) return;
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

    private void AttachCommonDiagnostics(Recognizer recognizer, StreamState state)
    {
        recognizer.SessionStarted += (_, e) =>
        {
            state.OnSessionStarted(e.SessionId);
            Logger.Info("azure", "session_start",
                $"Session gestartet (source={state.Source}, mode={state.Mode}, session={e.SessionId}).");
        };
        recognizer.SessionStopped += (_, e) =>
        {
            Logger.Info("azure", "session_stop",
                $"Session gestoppt (source={state.Source}, mode={state.Mode}, session={e.SessionId}).");
            if (!_stopping) state.MarkDead();
        };
        recognizer.SpeechStartDetected += (_, e) =>
            Logger.Info("azure", "speech_start",
                $"Speech start erkannt (source={state.Source}, mode={state.Mode}, offset={e.Offset}).");
        recognizer.SpeechEndDetected += (_, e) =>
            Logger.Info("azure", "speech_end",
                $"Speech end erkannt (source={state.Source}, mode={state.Mode}, offset={e.Offset}).");
    }

    private void HandleCanceled(string source, string mode, RecognitionEventArgs e)
    {
        if (!_stopping && _streams.TryGetValue(source, out var canceled)) canceled.MarkDead();
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

    internal string GetRecognitionMode(string source) =>
        _settings.Diarization.IsEnabled(source) ? "conversationTranscriber" : "speechRecognizer";

    internal void EmitTranscript(string source, string text, string state, double confidence, string? speaker, string? language, string? sessionId = null)
    {
        var diarized = _settings.Diarization.IsEnabled(source);
        if (diarized && string.IsNullOrWhiteSpace(speaker))
        {
            lock (_missingSpeakerIdLogged)
            {
                if (_missingSpeakerIdLogged.Add(source))
                    Logger.Warn(
                        "azure", "missing_speaker",
                        $"ConversationTranscriber liefert für {source} aktuell keine speakerId. " +
                        "Prüfe Region, Feature-Verfügbarkeit und ob diarization-fähige Events eintreffen.");
            }
        }
        var speakerId = diarized
            ? (string.IsNullOrWhiteSpace(speaker) ? "unknown" : speaker)
            : (source == SourceMic ? "self" : "guest");
        Logger.Event("transcript", new
        {
            id = Guid.NewGuid().ToString(),
            source,
            speaker = speakerId,
            // Session-Dimension (T-507): Azure vergibt die Sprecher-IDs
            // pro Session. Ohne diese Angabe kann das UI eine ID aus einer
            // alten Session nicht von einer neuen unterscheiden.
            sessionId = sessionId ?? _runId,
            language,
            timestampIso = DateTime.UtcNow.ToString("O"),
            text,
            state,
            confidence
        });
    }

    private string? ExtractSpeechLanguage(SpeechRecognitionResult? result)
    {
        if (result is null) return null;
        try
        {
            var detected = AutoDetectSourceLanguageResult.FromResult(result);
            var lang = detected?.Language?.Trim();
            return string.IsNullOrEmpty(lang) ? null : lang;
        }
        catch { return null; }
    }

    private string? ExtractConversationLanguage(SpeechRecognitionResult? result)
    {
        if (result is null) return null;
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
        return SpeechConfiguration.LidCandidates(_settings.Language?.Trim() ?? string.Empty);
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

public sealed record UserSettings(string Language, DeviceIds Devices)
{
    public DiarizationSettings Diarization { get; init; } = new();
}

public sealed record DiarizationSettings(bool Mic = true, bool Speaker = true)
{
    public bool IsEnabled(string source) => source switch
    {
        AzureSpeechService.SourceMic => Mic,
        AzureSpeechService.SourceSpeaker => Speaker,
        _ => throw new ArgumentException("Unknown audio source.", nameof(source))
    };
}
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

    /// <summary>Azure-Session-ID dieser Quelle (T-507).</summary>
    public string? AzureSessionId { get; set; }

    /// <summary>
    /// Eindeutige Kennung dieses Streams. Sie dient als Rueckfall-ID, wenn
    /// Azure noch keine Session-ID gemeldet hat. Beim Neuverbinden wird ein
    /// neuer Stream erzeugt und damit eine neue Kennung vergeben — das UI
    /// erkennt daran die gewechselte Sprecherbasis.
    /// </summary>
    public string InstanceId { get; } = Guid.NewGuid().ToString("N");

    /// <summary>
    /// Die Azure-Session dieser Quelle wurde vom Dienst beendet. Sie wird
    /// neu verbunden.
    /// </summary>
    public bool SessionDead { get; private set; }

    public void MarkDead() => SessionDead = true;

    /// <summary>
    /// Wie oft Azure fuer diese Quelle eine Session gemeldet hat. Der
    /// zweite Aufruf markiert eine neue Azure-Session (Neuverbindung).
    /// </summary>
    public int SessionStartedCount { get; set; }

    /// <summary>
    /// Die Session-ID, die im Segment-Payload gemeldet wird. Sie ist
    /// "sticky": der erste Wert bleibt fuer die Lebensdauer der Quelle
    /// erhalten, damit Segmente einer Quelle nie zwischen zwei
    /// Session-IDs wechseln. Eine echte Azure-Neuverbindung setzt sie neu.
    /// </summary>
    public string? EffectiveSessionId { get; private set; }

    /// <summary>Wurde die Session-ID bereits an ein Segment gemeldet?</summary>
    public bool SessionAnnounced { get; private set; }

    public StreamState(Recognizer recognizer, PushAudioInputStream pushStream, string mode, string source)
    {
        RecognizerBase = recognizer;
        PushStream = pushStream;
        Mode = mode;
        Source = source;
    }

    /// <summary>
    /// Liefert die Session-ID fuer die Segment-Meldung. Solange Azure keine
    /// Session-ID geliefert hat, wird die eindeutige Kennung dieses Streams
    /// verwendet, damit kein Segment ohne Session-Dimension im UI landet.
    /// </summary>
    public string ResolveSessionId()
    {
        if (EffectiveSessionId is null)
        {
            EffectiveSessionId = AzureSessionId ?? InstanceId;
            SessionAnnounced = true;
        }
        return EffectiveSessionId;
    }

    /// <summary>
    /// Wird aufgerufen, wenn Azure eine Session meldet. Eine andere
    /// Session-ID als zuvor bedeutet einen neuen Nummernkreis fuer die
    /// Sprecher-IDs — die Identitaet im Segment wird deshalb neu gesetzt.
    /// </summary>
    public void OnSessionStarted(string sessionId)
    {
        var previous = AzureSessionId;
        SessionStartedCount += 1;
        AzureSessionId = sessionId;
        SessionDead = false;
        if (previous is not null && !string.Equals(previous, sessionId, StringComparison.Ordinal))
        {
            EffectiveSessionId = null;
            return;
        }
        if (!SessionAnnounced) EffectiveSessionId = sessionId;
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
