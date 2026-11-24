using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using MeetingNotes.Sidecar;
using NAudio.CoreAudioApi;
using NAudio.Wave;

// Block 3 composition root for Meeting Notes.
//
// Responsibilities:
//   1. Parse CLI args (ArgsParser).
//   2. Resolve + enumerate audio devices (DeviceResolver).
//   3. Open two NAudio 3.x recorders (T-509): mic (WasapiRecorder) and
//      speaker loopback (WasapiRecorder with loopback). Each delivers
//      16 kHz / 16-bit / mono; if the WASAPI engine cannot convert, the
//      source falls back to a MediaFoundationResampler internally.
//   4. Forward the resampled PCM frames into AzureSpeechService, which owns
//      one recognizer per source, selected independently by diarization
//      settings, and surfaces transcripts + errors via Logger.
//   5. Emit everything (status, transcript, error, debug) as JSON-Lines
//      on stdout for the Tauri main process to consume.
//
// In Block 4 the Tauri-Main (Rust) spawns this EXE via tauri-plugin-shell
// and reads stdout as JSON-Lines; commands flow back over stdin.

/// <summary>
/// T-513, Stufe 1: Erkennungsmodus. Beobachtet den Core-Audio-Session-
/// Graph und meldet erkannte Meetings als JSON-Lines-Ereignis. Kein Azure,
/// keine Aufnahme, keine Geraete werden geoeffnet.
/// </summary>
static async Task<int> RunDetectionModeAsync(Dictionary<string, string?> argsMap)
{
    var allowed = argsMap.TryGetValue("--meeting-processes", out var raw) && !string.IsNullOrWhiteSpace(raw)
        ? raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        : null;

    Logger.Event("handshake", new
    {
        protocol_version = ProtocolVersion.Current,
        sidecar_version = System.Reflection.Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "0.0.0",
        capabilities = new[] { "transcription", "diarization", "pause", "resume", "markdown_export", "meeting_detection" }
    });

    var cts = new CancellationTokenSource();
    Console.CancelKeyPress += (_, e) =>
    {
        e.Cancel = true;
        cts.Cancel();
    };

    MeetingDetector? detector = null;
    try
    {
        detector = new MeetingDetector(detection =>
        {
            Logger.Event("meeting_detected", new
            {
                process_name = detection.ProcessName,
                process_id = detection.ProcessId,
                signal = detection.Signal
            });
        }, ended =>
        {
            // Das Gegenstueck zum Start-Ereignis: die Audiositzung wurde
            // beendet (OnStateChanged auf Inactive).
            Logger.Event("meeting_ended", new
            {
                process_name = ended.ProcessName,
                process_id = ended.ProcessId,
                signal = ended.Signal
            });
        }, allowed);
    }
    catch (Exception ex)
    {
        // Ohne Endpoint-Ueberwachung gibt es keine Erkennung - der
        // Tauri-Main laeuft dann ohne Auto-Start weiter.
        Logger.Error("MEETING_DETECTOR_UNAVAILABLE", ex.Message);
        return 51;
    }

    try
    {
        while (!cts.Token.IsCancellationRequested)
        {
            var line = await Console.In.ReadLineAsync(cts.Token);
            if (line is null) break;
            var command = SidecarCommands.ReadType(line);
            if (command == SidecarCommands.Shutdown)
            {
                Logger.Info("sidecar", "shutdown", "Shutdown command received.");
                cts.Cancel();
                break;
            }
            if (command == SidecarCommands.HandshakeAck)
            {
                Logger.Info("sidecar", "handshake_ack", "Protocol handshake confirmed.");
            }
        }
    }
    catch (OperationCanceledException) { }
    finally
    {
        detector.Dispose();
        cts.Dispose();
    }

    Logger.Info("status", "stopped", "Detection mode ended.");
    return 0;
}

var argsMap = ArgsParser.Parse(args);
Logger.ConfigureSecrets(
    argsMap.GetValueOrDefault("--speech-key"),
    argsMap.GetValueOrDefault("--proxy-username"),
    argsMap.GetValueOrDefault("--proxy-password"),
    Environment.GetEnvironmentVariable("MEETING_NOTES_SPEECH_KEY"),
    Environment.GetEnvironmentVariable("MEETING_NOTES_PROXY_USERNAME"),
    Environment.GetEnvironmentVariable("MEETING_NOTES_PROXY_PASSWORD"));

if (argsMap.ContainsKey("--test-connectivity"))
{
    var result = await SpeechConnectivityDiagnostic.RunFromArgsAsync(argsMap);
    Logger.Event("speech_connectivity", result);
    return result.reachable ? 0 : 1;
}

if (argsMap.ContainsKey("--list-devices"))
{
    var snapshot = DeviceResolver.ListDevices();
    Logger.Event("device_list", snapshot);
    return 0;
}

// T-513, Stufe 1: Erkennungsmodus. Der Sidecar beobachtet nur die
// Audiositzungen und meldet erkannte Meetings - ohne Aufnahme, ohne
// Azure, ohne Geraete zu oeffnen. Der Tauri-Main startet damit die
// Aufnahme, sobald eine Erkennung hereinkommt.
if (argsMap.ContainsKey("--detect-only"))
{
    return await RunDetectionModeAsync(argsMap);
}

// T-201: Handshake als erstes Event im Aufnahmemodus. Der Tauri-Main
// prueft die Protokollversion, quittiert mit handshake-ack und beendet den
// Sidecar, wenn die Version nicht kompatibel ist.
Logger.Event("handshake", new
{
    protocol_version = ProtocolVersion.Current,
    sidecar_version = System.Reflection.Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "0.0.0",
    capabilities = new[] { "transcription", "diarization", "pause", "resume", "markdown_export" }
});

DiarizationSettings diarization;
try
{
    diarization = ArgsParser.ParseDiarization(argsMap);
}
catch (ArgumentException)
{
    Logger.Error("SIDECAR_START_FAILED", "Invalid diarization options: --diarization-mic and --diarization-speaker must be true or false.");
    return 11;
}

// T-511: Welche Audioquellen transkribiert werden. Eigenstaendig von der
// Diarization - eine Quelle kann ohne Sprechererkennung transkribiert
// werden. Beide sind per Default aktiv.
TranscriptionSettings transcription;
try
{
    transcription = ArgsParser.ParseTranscription(argsMap);
}
catch (ArgumentException)
{
    Logger.Error("SIDECAR_START_FAILED", "Invalid transcription options: --transcription-mic and --transcription-speaker must be true or false.");
    return 11;
}
if (!transcription.Mic && !transcription.Speaker)
{
    Logger.Error("SIDECAR_START_FAILED", "No audio source selected for transcription: --transcription-mic or --transcription-speaker must be true.");
    return 23;
}
Logger.Info("config", "transcription", $"Transcribed sources: mic={transcription.Mic}, speaker={transcription.Speaker}.");

bool echoEnabled;
bool stereo;
try
{
    echoEnabled = ArgsParser.ParseEchoCancellation(argsMap, transcription);
    stereo = ArgsParser.ParseStereo(argsMap, transcription);
}
catch (ArgumentException ex)
{
    Logger.Error("SIDECAR_START_FAILED", ex.Message);
    return 11;
}

AzureProxyConfig? proxy;
try
{
    proxy = ProxyOptions.Parse(argsMap);
}
catch (ArgumentException)
{
    Logger.Error("SIDECAR_START_FAILED", "Invalid proxy configuration: provide a hostname/IP and port 1-65535.");
    return 11;
}

if (!argsMap.TryGetValue("--sample-rate", out var srRaw) || string.IsNullOrWhiteSpace(srRaw))
{
    srRaw = "16000";
    Logger.Info("config", "sample_rate_default", $"--sample-rate is not set, using the default {srRaw} Hz.");
}
if (!int.TryParse(srRaw, out var sampleRate) || sampleRate < 8000 || sampleRate > 48000)
{
    Logger.Error("SIDECAR_START_FAILED", $"The --sample-rate parameter is invalid: '{srRaw}'. Expected 8000-48000.");
    return 11;
}

if (stereo && sampleRate != StereoAudioMux.SampleRate)
{
    Logger.Error("SIDECAR_START_FAILED", "Stereo requires 16 kHz PCM audio.");
    return 11;
}

var micId = argsMap.GetValueOrDefault("--mic-device-id");
var speakerId = argsMap.GetValueOrDefault("--speaker-device-id");
var language = argsMap.GetValueOrDefault("--language") ?? "de-DE";
var speechKey = SpeechConfiguration.GetSpeechKey(argsMap);
var speechRegion = argsMap.GetValueOrDefault("--speech-region");
var speechEndpoint = argsMap.GetValueOrDefault("--speech-endpoint");
AzureSpeechModel speechModel;
try
{
    speechModel = SpeechConfiguration.ParseModel(argsMap.GetValueOrDefault("--speech-model"));
}
catch (ArgumentException ex)
{
    Logger.Error("SIDECAR_START_FAILED", ex.Message);
    return 11;
}
var azureEnabled = !string.IsNullOrWhiteSpace(speechKey)
                   && !string.IsNullOrWhiteSpace(speechRegion)
                   && (speechModel == AzureSpeechModel.MaiTranscribe2Streaming || !string.IsNullOrWhiteSpace(speechEndpoint));
if (!azureEnabled && (stereo || speechModel == AzureSpeechModel.MaiTranscribe2Streaming))
{
    Logger.Error("SIDECAR_START_FAILED", speechModel == AzureSpeechModel.MaiTranscribe2Streaming
        ? "MAI Transcribe requires an Azure region and speech key."
        : "Azure Speech stereo requires an endpoint, region and speech key.");
    return 11;
}

if (!azureEnabled)
{
    Logger.Warn(
        "config",
        "azure_incomplete",
        "The Azure configuration is incomplete (speech-key/region/endpoint missing). Audio capture runs, the Azure start is skipped.");
}

if (!string.IsNullOrWhiteSpace(micId))
    Logger.Info("config", "mic_device_id", $"--mic-device-id={micId}");
if (!string.IsNullOrWhiteSpace(speakerId))
    Logger.Info("config", "speaker_device_id", $"--speaker-device-id={speakerId}");

var targetWaveFormat = new WaveFormat(sampleRate, 16, 1);
// Process lifetime: a native operation or the stdin reader may outlive a
// timed-out shutdown and still use the token while the process exits.
var cts = new CancellationTokenSource();
var stopping = cts.Token;
AzureSpeechService? azure = null;
MMDeviceEnumerator? deviceEnumerator = null;
AudioRecorderSource? micSource = null;
AudioRecorderSource? speakerSource = null;
var captureCleanupAssigned = false;
Task<int>? stereoStart = null;
using var stereoStartup = stereo ? CancellationTokenSource.CreateLinkedTokenSource(stopping) : null;
var startupStatusGate = new object();
var userStopRequested = false;
var commandsReady = stereo ? new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously) : null;
EchoCancellation? echo = null;
Task echoDiagnostics = Task.CompletedTask;
if (echoEnabled)
{
    try { echo = new EchoCancellation(sampleRate); }
    catch (Exception) { Logger.Debug("audio", "echo_cancellation", "Echo cancellation (Alpha): Bypass (initialization failed)."); }
}

void LogEchoDiagnostics(EchoCancellation filter)
{
    if (filter.TakeDiagnosticSummary() is { } summary)
        Logger.Debug("audio", "echo_cancellation_stats", summary);
}

void RequestStop()
{
    Volatile.Read(ref azure)?.RequestStop();
    cts.Cancel();
}

void RequestUserStop()
{
    lock (startupStatusGate)
    {
        Volatile.Write(ref userStopRequested, true);
        RequestStop();
    }
}

async Task<int> StartCaptureAsync(CancellationToken startup)
{
    startup.ThrowIfCancellationRequested();
    var mm = deviceEnumerator = new MMDeviceEnumerator();

    // T-511: Nur transkribierte Quellen brauchen ein Geraet. Ohne
    // Speaker-Transkription wird kein Ausgabegeraet vorausgesetzt - sonst
    // waere "mic only" auf einem Rechner ohne Ausgabe nicht moeglich.
    MMDevice? micDevice = null;
    if (transcription.Mic)
    {
        micDevice = DeviceResolver.ResolveInputDevice(mm, micId);
        if (micDevice is null)
        {
            Logger.Error("SIDECAR_START_FAILED", "No microphone device found.");
            return 22;
        }
    }
    MMDevice? speakerDevice = null;
    if (transcription.Speaker)
    {
        speakerDevice = DeviceResolver.ResolveOutputDevice(mm, speakerId);
        if (speakerDevice is null)
        {
            Logger.Error("LOOPBACK_DEVICE_NOT_FOUND", "No speaker device for the loopback found.");
            return 21;
        }
    }

    // NAudio 3.x (T-509): Die Aufnahme laeuft jetzt ueber WasapiRecorder.
    // Die WASAPI-Engine konvertiert im Shared Mode selbst auf das Zielformat
    // (16 kHz / 16-bit / mono). Kann sie das nicht - etwa bei einem
    // Float-Mic, fuer das die Engine nicht auf 16-Bit-PCM konvertieren kann -
    // faellt AudioRecorderSource automatisch auf den MediaFoundation-Resampler
    // zurueck. Beide Wege liefern exakt 16 kHz / 16-bit / mono.
    startup.ThrowIfCancellationRequested();
    if (azureEnabled)
    {
        var azureConfig = new AzureSpeechConfig(
            Endpoint: speechEndpoint ?? string.Empty,
            Region: speechRegion!,
            SpeechKey: speechKey!,
            InterimResults: true,
            Proxy: proxy,
            Model: speechModel);
        var userSettings = new UserSettings(language, new DeviceIds(micId, speakerId))
        {
            Transcription = transcription,
            Diarization = diarization,
            Stereo = stereo
        };
        var service = new AzureSpeechService(azureConfig, userSettings, RequestStop);
        Volatile.Write(ref azure, service);
        startup.ThrowIfCancellationRequested();
        await service.InitAsync();
        await service.StartAsync(new AzureAudioFormat(sampleRate, 16, 1), startup);
    }

    startup.ThrowIfCancellationRequested();
    var azurePushLock = new object();
    EchoCancellation.Phase? lastEchoPhase = null;

    // T-511: Nur transkribierte Quellen werden aufgenommen. Eine abgeschaltete
    // Quelle erhaelt weder Recorder noch Azure-Stream.
    micSource = micDevice is null
        ? null
        : AudioRecorderSource.Create(
        micDevice,
        loopback: false,
        targetWaveFormat,
        "Mic",
        includePacketTimestamp: echo is not null || stereo,
        (pcm, capturedAtTicks, captureLatencyMs, packetTimestamp) =>
        {
            try
            {
                if (pcm.Length == 0) return;
                if (echo is not null)
                {
                    pcm = echo.ProcessMic(pcm, packetTimestamp);
                    var phase = echo.State;
                    if (lastEchoPhase != phase)
                    {
                        lastEchoPhase = phase;
                        Logger.Debug("audio", "echo_cancellation", $"Echo cancellation (Alpha): {phase}.");
                    }
                }
                var frame = new AudioFrame(
                        AzureSpeechService.SourceMic,
                        sampleRate, 16, 1,
                        pcm,
                        capturedAtTicks,
                        captureLatencyMs, packetTimestamp);
                if (stereo) azure?.PushFrame(frame);
                else lock (azurePushLock) azure?.PushFrame(frame);
            }
            catch (Exception ex)
            {
                Logger.Error("SIDECAR_UNAVAILABLE", $"Mic frame error: {ex.Message}");
            }
        });

    startup.ThrowIfCancellationRequested();
    speakerSource = speakerDevice is null
        ? null
        : AudioRecorderSource.Create(
        speakerDevice,
        loopback: true,
        targetWaveFormat,
        "Speaker-Loopback",
        includePacketTimestamp: echo is not null || stereo,
        (pcm, capturedAtTicks, captureLatencyMs, packetTimestamp) =>
        {
            try
            {
                if (pcm.Length == 0) return;
                echo?.AddReference(pcm, packetTimestamp);
                var frame = new AudioFrame(
                        AzureSpeechService.SourceSpeaker,
                        sampleRate, 16, 1,
                        pcm,
                        capturedAtTicks,
                        captureLatencyMs, packetTimestamp);
                if (stereo) azure?.PushFrame(frame);
                else lock (azurePushLock) azure?.PushFrame(frame);
            }
            catch (Exception ex)
            {
                Logger.Error("LOOPBACK_INIT_FAILED", $"Loopback frame error: {ex.Message}");
            }
        });

    startup.ThrowIfCancellationRequested();
    micSource?.Start();
    startup.ThrowIfCancellationRequested();
    speakerSource?.Start();
    startup.ThrowIfCancellationRequested();

    if (echo is { } filter)
    {
        echoDiagnostics = Task.Run(async () =>
        {
            using var timer = new PeriodicTimer(TimeSpan.FromSeconds(5));
            try
            {
                while (await timer.WaitForNextTickAsync(stopping)) LogEchoDiagnostics(filter);
            }
            catch (OperationCanceledException) when (stopping.IsCancellationRequested) { }
        });
    }

    Logger.Info("format", "mic_format", micSource is null
        ? "Mic: not transcribed."
        : $"Mic capture format: {micSource.Format} (mode: {micSource.ModeLabel})");
    Logger.Info("format", "speaker_format", speakerSource is null
        ? "Speaker loopback: not transcribed."
        : $"Speaker capture format: {speakerSource.Format} (mode: {speakerSource.ModeLabel})");
    var azureTarget = stereo ? new WaveFormat(sampleRate, 16, 2) : targetWaveFormat;
    Logger.Info("format", "azure_target", $"Azure Target Format: {azureTarget}");
    if (stereo && azure is not null) await azure.WaitForStereoReadyAsync(startup);
    return 0;
}

// ---- stdin-Kommandoschale (T-507) ---------------------------------
//
// Der Tauri-Main steuert den laufenden Sidecar ueber JSON-Lines auf
// stdin:
//   {"type":"pause"}    -> Audio-Zufuhr stoppt, Azure-Session bleibt offen
//   {"type":"resume"}   -> Audio-Zufuhr laeuft weiter, gleiche Session
//   {"type":"reset"}    -> Zuruecksetzen der internen Zaehler
//   {"type":"shutdown"} -> geordneter Abbruch
//
// "pause" beendet die Azure-Session NICHT: nur die Audioframes werden
// nicht mehr zugespeist. Die vom Azure-Dienst vergebenen Sprecher-IDs
// bleiben dadurch gueltig.
async Task ReconnectAsync(bool resuming)
{
    if (azure is null) return;
    try
    {
        var restarted = await azure.ReconnectDeadStreamsAsync(stopping);
        stopping.ThrowIfCancellationRequested();
        foreach (var source in restarted)
            Logger.Warn("azure", "speaker_ids_reset",
                $"The Azure session for {source} had ended and was reconnected. The speaker IDs were reassigned.");
    }
    catch (OperationCanceledException) when (stopping.IsCancellationRequested) { throw; }
    catch (Exception ex)
    {
        Logger.Error("AZURE_RECOGNIZER_FAILED", $"Azure reconnect failed ({(resuming ? "resume" : "health check")}): {ex.Message}");
    }
}

async Task HandleCommandAsync(string command)
{
    switch (command)
    {
        case SidecarCommands.HandshakeAck:
            Logger.Info("sidecar", "handshake_ack", "Protocol handshake confirmed.");
            break;
        case SidecarCommands.Pause:
            azure?.SetPaused(true);
            echo?.SetPaused(true);
            Logger.Info("sidecar", "pause", "Transcription paused; the Azure session stays connected.");
            Logger.Event("status", new { phase = "paused", running = true });
            break;
        case SidecarCommands.Resume:
            await ReconnectAsync(resuming: true);
            stopping.ThrowIfCancellationRequested();
            echo?.SetPaused(false);
            azure?.SetPaused(false);
            Logger.Info("sidecar", "resume", "Transcription resumed.");
            Logger.Event("status", new { phase = "resumed", running = true });
            break;
        case SidecarCommands.Reset:
            Logger.Info("sidecar", "reset", "Reset command received.");
            break;
        default:
            Logger.Warn("sidecar", "unknown_command", $"Unknown command: {command}");
            break;
    }
}

void StartCommandReader() => _ = Task.Run(async () =>
{
    try { await RecordingControl.ReadCommandsAsync(Console.In, HandleCommandAsync, RequestStop, stopping, commandsReady?.Task, RequestUserStop); }
    catch (Exception ex) { Logger.Error("SIDECAR_UNAVAILABLE", $"The stdin reader stopped: {ex.Message}"); }
});

async Task<int> StopRecordingAsync(bool wasStarted, bool acknowledge = true)
{
    captureCleanupAssigned = true;
    using var deadline = new CancellationTokenSource(RecordingControl.ShutdownBudget);
    var shutdownToken = deadline.Token;
    try
    {
        await RecordingControl.CompleteShutdownAsync(async () =>
        {
            try
            {
                try
                {
                    micSource?.Stop();
                    speakerSource?.Stop();
                }
                finally
                {
                    try { micSource?.Dispose(); }
                    finally { speakerSource?.Dispose(); }
                }
            }
            finally
            {
                try
                {
                    deviceEnumerator?.Dispose();
                    if (echo is { } filter)
                    {
                        filter.Stop();
                        await echoDiagnostics.WaitAsync(shutdownToken);
                        LogEchoDiagnostics(filter);
                    }
                }
                finally
                {
                    if (azure is not null)
                        await azure.StopAsync(requireCleanStop: true, wasStarted ? shutdownToken : CancellationToken.None,
                            requireTerminal: wasStarted);
                }
            }
        }, shutdownToken, stereoStart, acknowledge);
        return 0;
    }
    catch (Exception ex)
    {
        Logger.Error("SIDECAR_UNAVAILABLE", ex.Message);
        return 50;
    }
}

ConsoleCancelEventHandler onCancel = (_, e) =>
{
    e.Cancel = true;
    RequestUserStop();
};
Console.CancelKeyPress += onCancel;

try
{
    int startResult;
    if (stereoStartup is not null)
    {
        stereoStartup.CancelAfter(TimeSpan.FromSeconds(12));
        var (owner, untilReady) = RecordingControl.BeginStereoStartup(StartCaptureAsync, StartCommandReader, stereoStartup.Token);
        stereoStart = owner;
        startResult = await untilReady;
    }
    else startResult = await StartCaptureAsync(CancellationToken.None);

    lock (startupStatusGate)
    {
        stereoStartup?.Token.ThrowIfCancellationRequested();
        if (startResult != 0) return startResult;
        stereoStartup?.CancelAfter(Timeout.InfiniteTimeSpan);
        var activeSources = new List<string>();
        if (micSource is not null) activeSources.Add("Mic");
        if (speakerSource is not null) activeSources.Add("Speaker-Loopback");
        Logger.Info("status", "capturing", $"Active: {string.Join(" + ", activeSources)}.");
        Logger.Event("status", new { phase = "started", running = true });
        commandsReady?.TrySetResult();
    }
    if (!stereo) StartCommandReader();

    _ = Task.Run(async () =>
    {
        var healthInterval = TimeSpan.FromSeconds(30);
        var nextHealthLog = DateTime.UtcNow.Add(healthInterval);
        try
        {
            while (!stopping.IsCancellationRequested)
            {
                await Task.Delay(TimeSpan.FromSeconds(1), stopping);
                if (DateTime.UtcNow >= nextHealthLog)
                {
                    Logger.Info("health", "alive", "ok");
                    nextHealthLog = DateTime.UtcNow.Add(healthInterval);
                }

                // During a pause, retain speaker identities and leave reconnect to Resume.
                if (azure is not null && !azure.IsPaused) await ReconnectAsync(resuming: false);
            }
        }
        catch (OperationCanceledException) when (stopping.IsCancellationRequested) { }
    });

    // Neither a Resume command nor the health task owns the shutdown wait.
    try { await Task.Delay(Timeout.InfiniteTimeSpan, stopping); }
    catch (OperationCanceledException) when (stopping.IsCancellationRequested) { }

    return await StopRecordingAsync(wasStarted: true);
}
catch (OperationCanceledException) when (stereo && Volatile.Read(ref userStopRequested))
{
    // An explicit Stop/Quit before the started status is normal. A terminal
    // SessionStopped event is not guaranteed for a session that never became ready.
    RequestStop();
    return await StopRecordingAsync(wasStarted: false);
}
catch (OperationCanceledException) when (stereoStartup?.IsCancellationRequested == true && !stopping.IsCancellationRequested)
{
    Logger.Error("SIDECAR_START_FAILED", "Timed out waiting for the stereo Azure session to start.");
    return 50;
}
catch (Exception ex)
{
    Logger.Error("SIDECAR_UNAVAILABLE", ex.Message);
    return 50;
}
finally
{
    Console.CancelKeyPress -= onCancel;
    // Never retry cleanup: a timed-out worker may still own native handles.
    if (!captureCleanupAssigned)
    {
        RequestStop();
        if (stereo) _ = await StopRecordingAsync(wasStarted: false, acknowledge: false);
        else
        {
            echo?.Stop();
            try { micSource?.Dispose(); }
            finally
            {
                try { speakerSource?.Dispose(); }
                finally { deviceEnumerator?.Dispose(); }
            }
        }
    }
}

