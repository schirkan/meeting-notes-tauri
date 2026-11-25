using System;
using System.Collections.Concurrent;
using System.Diagnostics;
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

    private const string StereoSource = "stereo";
    private readonly AzureSpeechConfig _config;
    private readonly Action? _stopOnStereoFailure;
    private StereoAudioWriter? _stereoWriter;
    private readonly TaskCompletionSource<bool> _stereoReady = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private int _stereoFailed;
    private int _stereoSessionStarted;
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
    private volatile bool _stopping;
    private readonly SemaphoreSlim _streamLifecycle = new(1, 1);

    public AzureSpeechService(AzureSpeechConfig config, UserSettings settings, Action? stopOnStereoFailure = null)
    {
        _config = config;
        _settings = settings;
        _stopOnStereoFailure = stopOnStereoFailure;
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
        if (_stopping || _paused == paused) return;
        _stereoWriter?.SetPaused(paused);
        if (_stopping) return;
        _paused = paused;
        Logger.Info(
            "azure",
            paused ? "paused" : "resumed",
            paused
                ? "Audio feed stopped; the Azure session stays connected."
                : "Audio feed active again.");
    }

    public async Task InitAsync()
    {
        if (_initialized) return;
        Logger.Info("azure", "init", "AzureSpeechService.init: the SDK is being initialized.");

        // Die SDK-Eigenschaft gilt global. Wirksam ist sie nur, wenn
        // mindestens eine transkribierte Quelle die Sprechererkennung nutzt.
        _speechConfig = SpeechConfiguration.Create(_config, _settings.Language, EffectiveDiarization, IsStereo, _settings.AutoLanguageDetection);

        if (_config.Proxy is not null)
            Logger.Info("azure", "proxy", "Azure Speech proxy configured; credentials are not logged.");

        _initialized = true;
        Logger.Info(
            "azure",
            "config",
            $"AzureSpeechService.init: region={_config.Region}, language={_settings.Language}, " +
            $"interimResults={_config.InterimResults}, stereo={IsStereo}.");
    }

    /// <summary>
    /// Starts the Recognizers of all transcribed sources for the given audio
    /// format. A source that is not transcribed gets no Recognizer at all.
    /// On failure, rolls back separate streams here; the Stereo startup owner
    /// serializes cleanup of the shared stream with its native startup task.
    /// </summary>
    public async Task StartAsync(AzureAudioFormat format, CancellationToken startup = default)
    {
        startup.ThrowIfCancellationRequested();
        if (_speechConfig is null)
            throw new InvalidOperationException("AzureSpeechService is not initialized.");
        if (_streams.Count > 0)
            throw new InvalidOperationException("AzureSpeechService is already running. Call StopAsync first.");
        _format = format;
        lock (_missingSpeakerIdLogged) _missingSpeakerIdLogged.Clear();
        _firstFrameLogged.Clear();
        _pushCounters.Clear();
        // A Stereo service never starts a second session. Do not undo an early Stop.
        if (!IsStereo) _stopping = false;

        var sources = TranscriptionSources;
        if (sources.Count == 0)
            throw new InvalidOperationException("No audio source selected for transcription.");

        StreamState[] states;
        try
        {
            states = IsStereo
                ? [EnsureStreamForFormat(StereoSource, format with { Channels = 2 })]
                : sources.Select(source => EnsureStreamForFormat(source, format)).ToArray();
            foreach (var state in states)
            {
                startup.ThrowIfCancellationRequested();
                await StartStreamAsync(state);
                startup.ThrowIfCancellationRequested();
                if (IsStereo)
                    _stereoWriter = new StereoAudioWriter(pcm =>
                    {
                        if (state.SessionDead) return;
                        if (state.TryWrite(pcm)) state.LastPushTicks = Stopwatch.GetTimestamp();
                    }, ex => FailStereo(state, $"Stereo audio input failed ({ex.GetType().Name})."));
            }
        }
        catch
        {
            // The Stereo startup owner performs bounded cleanup after this task returns.
            if (!IsStereo) await StopAsync();
            throw;
        }
        Logger.Info(
            "azure",
            "started",
            $"{states.Length} recognizers are running ({string.Join(", ", sources)}).");
    }

    /// <summary>
    /// Quellen, die transkribiert werden und daher einen Recognizer bekommen.
    /// </summary>
    internal IReadOnlyList<string> TranscriptionSources => new[] { SourceMic, SourceSpeaker }
        .Where(source => _settings.Transcription.IsEnabled(source))
        .ToArray();

    /// <summary>
    /// Sprechererkennung ist nur wirksam, wenn mindestens eine transkribierte
    /// Quelle sie nutzt.
    /// </summary>
    internal bool IsStereo => _settings.Stereo && _settings.Transcription.Mic && _settings.Transcription.Speaker;

    internal async Task WaitForStereoReadyAsync(CancellationToken stopping)
    {
        if (IsStereo && (!await _stereoReady.Task.WaitAsync(stopping) || Volatile.Read(ref _stereoFailed) != 0))
            throw new InvalidOperationException("The stereo Azure session did not start.");
    }

    internal bool EffectiveDiarization =>
        TranscriptionSources.Any(UsesDiarization);

    private bool UsesDiarization(string source) =>
        _config.Model == AzureSpeechModel.Standard && _settings.Diarization.IsEnabled(source);

    public void PushFrame(AudioFrame frame)
    {
        if (_speechConfig is null) return;
        // Pause (T-507): die Azure-Session lebt weiter, aber es werden
        // keine Audioframes mehr zugespeist. Der pausierte Abschnitt
        // erscheint deshalb nicht im Transkript.
        if (_paused || _stopping) return;
        if (IsStereo)
        {
            _stereoWriter?.Add(frame);
            return;
        }
        try
        {
            if (_firstFrameLogged.Add(frame.Source))
            {
                Logger.Info(
                    "audio",
                    "first_frame",
                    $"First audio frame received (source={frame.Source}, " +
                    $"sampleRate={frame.SampleRate}, bits={frame.BitsPerSample}, " +
                    $"channels={frame.Channels}, bytes={frame.Payload.Length}).");
            }

            // TryGetValue statt Indexer: waehrend eines Reconnects kann die
            // Quelle kurzzeitig ohne Stream sein. Der Frame wird dann
            // verworfen, statt eine Ausnahme in die Capture-Schleife zu
            // tragen.
            if (!_streams.TryGetValue(frame.Source, out var state)) return;
            var pushTicks = Stopwatch.GetTimestamp();
            if (!state.TryWrite(frame.Payload)) return;

            // T-502: Stufen der Latenzkette im Sidecar festhalten. Der
            // Push-Zeitpunkt ist die Referenz fuer die Azure-Roundtrip.
            state.LastPushTicks = pushTicks;
            state.LastCaptureLatencyMs = frame.CaptureLatencyMs;
            state.LastSidecarToPushMs = frame.CapturedAtTicks > 0
                ? (pushTicks - frame.CapturedAtTicks) / (double)Stopwatch.Frequency * 1000.0
                : 0.0;

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
                    $"pushFrame statistics ({frame.Source}): {counter.Frames} frames, " +
                    $"{counter.Bytes} Bytes in {elapsed:F1}s (~{counter.Bytes / elapsed:F0} B/s).");
                counter.Reset(now);
            }
            _pushCounters[frame.Source] = counter;
        }
        catch (Exception ex)
        {
            Logger.Error("AZURE_RECOGNIZER_FAILED", $"pushFrame error (source={frame.Source}): {ex.Message}");
        }
    }

    /// <summary>
    /// Verbindet Quellen neu, deren Azure-Session vom Dienst beendet wurde
    /// (z. B. nach dem 60-Minuten-Limit der Verbindung). Eine Neuverbindung
    /// vergibt neue Sprecher-IDs — das UI erkennt das an der Session-ID im
    /// Segment und baut die Sprecherbasis neu auf (T-507).
    /// </summary>
    public async Task<string[]> ReconnectDeadStreamsAsync(CancellationToken stopping)
    {
        await _streamLifecycle.WaitAsync(stopping);
        try
        {
            if (IsStereo || _stopping || _format is null) return Array.Empty<string>();
            var restarted = new List<string>();
            foreach (var source in _streams.Where(pair => pair.Value.SessionDead).Select(pair => pair.Key).ToArray())
            {
                stopping.ThrowIfCancellationRequested();
                if (_stopping) break;
                var dead = _streams[source];
                if (!dead.SessionDead) continue;
                // Keep ownership until native cleanup/start actually returns.
                // Canceling a wait must not let shutdown dispose a busy recognizer.
                await FinalizeStreamAsync(dead, requireDrain: false, CancellationToken.None);
                _streams.TryRemove(source, out _);
                stopping.ThrowIfCancellationRequested();
                if (_stopping) break;
                var fresh = EnsureStreamForFormat(source, _format);
                stopping.ThrowIfCancellationRequested();
                if (_stopping) break;
                try { await StartStreamAsync(fresh); }
                catch
                {
                    fresh.MarkDead();
                    throw;
                }
                stopping.ThrowIfCancellationRequested();
                restarted.Add(source);
            }
            if (restarted.Count > 0)
                Logger.Info("azure", "session_restarted",
                    $"{restarted.Count} source(s) reconnected: {string.Join(", ", restarted)}. " +
                    "The speaker IDs were reassigned.");
            return restarted.ToArray();
        }
        finally { _streamLifecycle.Release(); }
    }

    internal void RequestStop() => _stopping = true;

    public Task StopAsync(bool requireCleanStop = false, CancellationToken deadline = default) =>
        StopAsync(requireCleanStop, deadline, requireTerminal: true);

    internal async Task StopAsync(bool requireCleanStop, CancellationToken deadline, bool requireTerminal)
    {
        RequestStop();
        await _streamLifecycle.WaitAsync(deadline);
        try
        {
            Logger.Info("azure", "stopping", $"{_streams.Count} active stream(s) are being stopped.");
            try
            {
                if (_stereoWriter is { } writer) await writer.CompleteAsync();
                await Task.WhenAll(_streams.Values.Select(state => Task.Run(
                    () => FinalizeStreamAsync(state, requireCleanStop && requireTerminal, deadline))));
            }
            catch (Exception ex) when (!requireCleanStop)
            {
                Logger.Warn("azure", "stop_error", $"An Azure recognizer could not be stopped: {ex.Message}");
            }
            finally { _streams.Clear(); }
        }
        finally { _streamLifecycle.Release(); }
    }

    public void Dispose() => StopAsync().GetAwaiter().GetResult();

    // ---------------- internals ----------------

    private StreamState EnsureStreamForFormat(string source, AzureAudioFormat format)
    {
        if (_speechConfig is null) throw new InvalidOperationException();
        if (_streams.TryGetValue(source, out var existing)) return existing;

        using var audioFormat = AudioStreamFormat.GetWaveFormatPCM(
            (uint)format.SampleRate,
            (byte)format.BitsPerSample,
            (byte)format.Channels);
        var mode = GetRecognitionMode(source);
        var pushStream = AudioInputStream.CreatePushStream(audioFormat);
        Recognizer native;
        try
        {
            using var audioConfig = AudioConfig.FromStreamInput(pushStream);
            var autoDetect = IsStereo ? null : SpeechConfiguration.CreateLanguageDetection(_config.Model, _settings.Language, _settings.AutoLanguageDetection);
            native = mode == "conversationTranscriber"
                ? autoDetect is null ? new ConversationTranscriber(_speechConfig, audioConfig)
                    : new ConversationTranscriber(_speechConfig, autoDetect, audioConfig)
                : SpeechConfiguration.CreateRecognizer(_speechConfig, audioConfig, autoDetect);
        }
        catch
        {
            pushStream.Dispose();
            throw;
        }

        Logger.Info(
            "azure",
            "stream_create",
            $"{mode} created for {source} (sampleRate={format.SampleRate}, " +
            $"bits={format.BitsPerSample}, channels={format.Channels}).");

        var state = new StreamState(native, pushStream, mode, source);
        AttachCommonDiagnostics(native, state);
        if (native is ConversationTranscriber recognizer)
        {
            if (_config.InterimResults) recognizer.Transcribing += (_, e) => state.Drain.Emit(() =>
            {
                if (IsStereo) EmitStereoResult(state, e.Result, e.Result?.SpeakerId, interim: true);
                else if (e.Result?.Text?.Trim() is { Length: > 0 } text)
                    EmitTranscript(source, text, "interim", 0.8, e.Result?.SpeakerId,
                        ExtractConversationLanguage(e.Result), state.ResolveSessionId());
            });
            recognizer.Transcribed += (_, e) => state.Drain.Emit(() =>
            {
                if (IsStereo) EmitStereoResult(state, e.Result, e.Result?.SpeakerId);
                else if (e.Result?.Text?.Trim() is { Length: > 0 } text)
                    EmitTranscript(source, text, "final", 0.9, e.Result?.SpeakerId,
                        ExtractConversationLanguage(e.Result), state.ResolveSessionId());
            });
            recognizer.Canceled += (_, e) => HandleCanceled(state, e.Reason, e.ErrorCode, e.ErrorDetails);
        }
        else if (native is SpeechRecognizer speechRecognizer)
        {
            if (_config.InterimResults) speechRecognizer.Recognizing += (_, e) => state.Drain.Emit(() =>
            {
                if (IsStereo) EmitStereoResult(state, e.Result, null, interim: true);
                else if (e.Result?.Text?.Trim() is { Length: > 0 } text)
                    EmitTranscript(source, text, "interim", 0.8, source == SourceMic ? "self" : "guest",
                        ExtractSpeechLanguage(e.Result), state.ResolveSessionId());
            });
            speechRecognizer.Recognized += (_, e) => state.Drain.Emit(() =>
            {
                if (IsStereo) EmitStereoResult(state, e.Result, null);
                else if (e.Result?.Text?.Trim() is { Length: > 0 } text)
                    EmitTranscript(source, text, "final", 0.9, source == SourceMic ? "self" : "guest",
                        ExtractSpeechLanguage(e.Result), state.ResolveSessionId());
            });
            speechRecognizer.Canceled += (_, e) => HandleCanceled(state, e.Reason, e.ErrorCode, e.ErrorDetails);
        }
        _streams[source] = state;
        return state;
    }

    private async Task StartStreamAsync(StreamState state)
    {
        if (state.Started) return;
        state.StartAttempted = true;
        if (state.Mode == "conversationTranscriber")
        {
            var recognizer = (ConversationTranscriber)state.RecognizerBase;
            await recognizer.StartTranscribingAsync();
            state.Started = true;
            Logger.Info("azure", "stream_start", $"startTranscribingAsync started for {state.Source}.");
        }
        else
        {
            var recognizer = (SpeechRecognizer)state.RecognizerBase;
            await recognizer.StartContinuousRecognitionAsync();
            state.Started = true;
            Logger.Info("azure", "stream_start", $"startContinuousRecognitionAsync started for {state.Source}.");
        }
    }

    private async Task FinalizeStreamAsync(StreamState state, bool requireDrain, CancellationToken deadline)
    {
        try
        {
            // EOF lets the SDK consume already queued audio. An explicit Stop
            // can cut that short, and its Task is not a final-result barrier.
            state.CloseInput();
            try
            {
                await state.Drain.FinishAsync(requireDrain && state.Started).WaitAsync(deadline);
            }
            finally
            {
                if (state.StartAttempted)
                {
                    state.ExplicitStopRequested = true;
                    if (state.RecognizerBase is ConversationTranscriber transcriber)
                        await transcriber.StopTranscribingAsync();
                    else
                        await ((SpeechRecognizer)state.RecognizerBase).StopContinuousRecognitionAsync();
                }
            }
        }
        finally { state.Dispose(); }
        if (requireDrain && (state.Drain.Failed || (state.StartAttempted && !state.Started)))
            throw new InvalidOperationException($"Azure recognition did not end cleanly ({state.Mode}/{state.Source}).");
        Logger.Info("azure", "stream_closed", $"Recognizer closed (mode={state.Mode}, started={state.Started}).");
    }

    private void AttachCommonDiagnostics(Recognizer recognizer, StreamState state)
    {
        recognizer.SessionStarted += (_, e) =>
        {
            if (IsStereo && Interlocked.Exchange(ref _stereoSessionStarted, 1) != 0)
            {
                FailStereo(state, "The stereo Azure session restarted unexpectedly. Start a new recording.");
                return;
            }
            state.Drain.OnSessionStarted();
            state.OnSessionStarted(e.SessionId);
            if (IsStereo) _stereoReady.TrySetResult(true);
            Logger.Info("azure", "session_start",
                $"Session started (source={state.Source}, mode={state.Mode}, session={e.SessionId}).");
        };
        recognizer.SessionStopped += (_, e) =>
        {
            state.Drain.OnSessionStopped();
            Logger.Info("azure", "session_stop",
                $"Session stopped (source={state.Source}, mode={state.Mode}, session={e.SessionId}).");
            if (!_stopping)
            {
                if (IsStereo) FailStereo(state, "The stereo Azure session ended unexpectedly. Start a new recording.");
                else state.MarkDead();
            }
        };
        recognizer.SpeechStartDetected += (_, e) =>
            Logger.Info("azure", "speech_start",
                $"Speech start detected (source={state.Source}, mode={state.Mode}, offset={e.Offset}).");
        recognizer.SpeechEndDetected += (_, e) =>
            Logger.Info("azure", "speech_end",
                $"Speech end detected (source={state.Source}, mode={state.Mode}, offset={e.Offset}).");
    }

    private void HandleCanceled(StreamState state, CancellationReason reason, CancellationErrorCode errorCode, string? errorDetails)
    {
        // EOF is normal. Let SessionStopped declare the stream dead after its
        // result callbacks, rather than reconnecting at the earlier EOF event.
        if (reason == CancellationReason.EndOfStream ||
            (state.ExplicitStopRequested && reason == CancellationReason.CancelledByUser)) return;

        state.Drain.Fail();
        if (!_stopping) state.MarkDead();
        var details = (errorDetails ?? "The Azure recognizer was canceled.").Trim();
        var (source, mode) = (state.Source, state.Mode);
        var authRelated = System.Text.RegularExpressions.Regex.IsMatch(
            details, "auth|token|key|forbidden|unauthorized|401|403",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        var code = authRelated ? "AZURE_AUTH_FAILED" : "AZURE_RECOGNIZER_FAILED";
        if (IsStereo)
        {
            FailStereo(state, $"Stereo recognition canceled ({reason}, {errorCode}). {details}", code);
            return;
        }
        Logger.Error("AZURE_CANCELED",
            $"Recognizer canceled (source={source}, mode={mode}, reason={reason}, " +
            $"errorCode={errorCode}): {details}");
        Logger.Event("transcript:error", new { code, message = $"[{source}/{mode}] {details}" });
    }

    private void FailStereo(StreamState state, string message, string code = "AZURE_RECOGNIZER_FAILED")
    {
        state.Drain.Fail();
        state.MarkDead();
        _stereoReady.TrySetResult(false);
        if (Interlocked.Exchange(ref _stereoFailed, 1) != 0) return;
        Logger.Event("transcript:error", new { code, message });
        if (!_stopping) _stopOnStereoFailure?.Invoke();
    }

    internal static string? ResolveStereoSource(int channel, string json)
    {
        // A numeric getter alone may default to zero for a result with no channel.
        if (channel is < 0 or > 1 || string.IsNullOrEmpty(json)) return null;
        try
        {
            using var response = System.Text.Json.JsonDocument.Parse(json);
            if (response.RootElement.ValueKind != System.Text.Json.JsonValueKind.Object ||
                !response.RootElement.TryGetProperty("Channel", out var value) ||
                value.ValueKind != System.Text.Json.JsonValueKind.Number ||
                !value.TryGetInt32(out var actual) || actual != channel) return null;
            return channel == 0 ? SourceMic : SourceSpeaker;
        }
        catch (System.Text.Json.JsonException) { return null; }
    }

    private void EmitStereoResult(StreamState state, SpeechRecognitionResult? result, string? speaker, bool interim = false)
    {
        if (state.SessionDead || result?.Text?.Trim() is not { Length: > 0 } text ||
            (!interim && result.Reason != ResultReason.RecognizedSpeech)) return;
        string? source = null;
        try
        {
            source = ResolveStereoSource(result.Channel, result.Properties.GetProperty(PropertyId.SpeechServiceResponse_JsonResult));
        }
        catch (Exception ex)
        {
            if (!interim)
            {
                FailStereo(state, $"Could not read Azure stereo channel metadata ({ex.GetType().Name}).");
                return;
            }
        }
        if (source is null && !interim)
        {
            FailStereo(state, "Azure returned a stereo result without verifiable channel metadata. No source was guessed.");
            return;
        }
        EmitTranscript(source ?? string.Empty, text, interim ? "interim" : "final", interim ? 0.8 : 0.9,
            speaker, _settings.Language, state.ResolveSessionId(), result.OffsetInTicks);
    }

    internal string GetRecognitionMode(string source) =>
        (source == StereoSource ? EffectiveDiarization : UsesDiarization(source)) ? "conversationTranscriber" : "speechRecognizer";

    internal void EmitTranscript(string source, string text, string state, double confidence, string? speaker, string? language, string? sessionId = null, long? utteranceOffsetTicks = null)
    {
        var diarized = UsesDiarization(source);
        if (diarized && string.IsNullOrWhiteSpace(speaker))
        {
            lock (_missingSpeakerIdLogged)
            {
                if (_missingSpeakerIdLogged.Add(source))
                    Logger.Warn(
                        "azure", "missing_speaker",
                        $"The ConversationTranscriber currently returns no speakerId for {source}. " +
                        "Check the region, the feature availability and whether diarization-capable events arrive.");
            }
        }
        var speakerId = source.Length == 0 ? speaker ?? string.Empty : diarized
            ? (string.IsNullOrWhiteSpace(speaker) ? "unknown" : speaker)
            : (source == SourceMic ? "self" : "guest");
        // T-502: Latenzstufen. Die Kette laeuft
        //   Capture (WASAPI) -> Resampler -> Azure-PushStream -> Azure-Response
        //   -> Sidecar-Event -> JSON-Lines -> Tauri-Main -> Renderer.
        // Der Renderer-Teil (Paint) ist von aussen nicht messbar; totalMs
        // endet deshalb am Tauri-Event.
        var nowTicks = Stopwatch.GetTimestamp();
        var captureLatencyMs = 0.0;
        var sidecarToPushMs = 0.0;
        var azureToEventMs = 0.0;
        if (_streams.TryGetValue(IsStereo ? StereoSource : source, out var streamState))
        {
            captureLatencyMs = streamState.LastCaptureLatencyMs;
            sidecarToPushMs = streamState.LastSidecarToPushMs;
            if (streamState.LastPushTicks > 0)
            {
                azureToEventMs = (nowTicks - streamState.LastPushTicks) / (double)Stopwatch.Frequency * 1000.0;
            }
        }
        var latency = new
        {
            captureLatencyMs = Math.Round(captureLatencyMs, 1),
            sidecarToPushMs = Math.Round(sidecarToPushMs, 1),
            azureToEventMs = Math.Round(azureToEventMs, 1),
            emittedAtUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };

        Logger.Event("transcript", new
        {
            id = Guid.NewGuid().ToString(),
            source,
            speaker = speakerId,
            // Session-Dimension (T-507): Azure vergibt die Sprecher-IDs
            // pro Session. Ohne diese Angabe kann das UI eine ID aus einer
            // alten Session nicht von einer neuen unterscheiden.
            sessionId = sessionId ?? _runId,
            utteranceOffsetTicks,
            language,
            timestampIso = DateTime.UtcNow.ToString("O"),
            text,
            state,
            confidence,
            latency
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
}

// ---------------- supporting types ----------------

public sealed record AzureSpeechConfig(
    string Endpoint,
    string Region,
    string SpeechKey,
    bool InterimResults,
    AzureProxyConfig? Proxy,
    AzureSpeechModel Model = AzureSpeechModel.Standard);

public sealed record AzureProxyConfig(string Host, int Port, string? Username, string? Password);

public sealed record UserSettings(string Language, DeviceIds Devices)
{
    public TranscriptionSettings Transcription { get; init; } = new();
    public DiarizationSettings Diarization { get; init; } = new();
    public bool AutoLanguageDetection { get; init; } = true;
    public bool Stereo { get; init; }
}

/// <summary>
/// Welche Audioquellen transkribiert werden. Eigenstaendig von der
/// Diarization: eine Quelle kann ohne Sprechererkennung transkribiert
/// werden, und die Diarization kann fuer eine weiterhin transkribierte
/// Quelle abgeschaltet sein. Eine nicht transkribierte Quelle erhaelt
/// weder einen Recognizer noch Azure-Frames.
/// </summary>
public sealed record TranscriptionSettings(bool Mic = true, bool Speaker = true)
{
    public bool IsEnabled(string source) => source switch
    {
        AzureSpeechService.SourceMic => Mic,
        AzureSpeechService.SourceSpeaker => Speaker,
        _ => throw new ArgumentException("Unknown audio source.", nameof(source))
    };
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

public sealed record AudioFrame(
    string Source,
    int SampleRate,
    int BitsPerSample,
    int Channels,
    byte[] Payload,
    /// <summary>T-502: Stopwatch-Zeitpunkt, an dem der Frame im Sidecar ankam.</summary>
    long CapturedAtTicks = 0,
    /// <summary>T-502: Alter des WASAPI-Puffers beim Capture (ms, von NAudio).</summary>
    int CaptureLatencyMs = 0,
    long? PacketQpc100Ns = null);

internal sealed class StreamState
{
    private readonly object _inputLock = new();
    private bool _inputClosed;
    private volatile bool _sessionDead;
    public StreamDrain Drain { get; } = new();
    public Recognizer RecognizerBase { get; }
    private PushAudioInputStream PushStream { get; }
    public string Mode { get; }
    public string Source { get; }
    public bool Started { get; set; }
    public bool StartAttempted { get; set; }
    public volatile bool ExplicitStopRequested;

    public bool TryWrite(byte[] payload)
    {
        lock (_inputLock)
        {
            if (_inputClosed) return false;
            PushStream.Write(payload);
            return true;
        }
    }

    public void CloseInput()
    {
        lock (_inputLock)
        {
            if (_inputClosed) return;
            PushStream.Close();
            _inputClosed = true;
        }
    }

    public void Dispose()
    {
        try { RecognizerBase.Dispose(); }
        finally { PushStream.Dispose(); }
    }

    /// <summary>T-502: Zeitpunkt des letzten Pushes in den Azure-Stream.</summary>
    public long LastPushTicks { get; set; }

    /// <summary>T-502: Alter des WASAPI-Puffers beim letzten Frame (ms).</summary>
    public int LastCaptureLatencyMs { get; set; }

    /// <summary>T-502: Callback -> Azure-PushStream des letzten Frames (ms).</summary>
    public double LastSidecarToPushMs { get; set; }

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
    public bool SessionDead => _sessionDead;

    public void MarkDead() => _sessionDead = true;

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
        _sessionDead = false;
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
