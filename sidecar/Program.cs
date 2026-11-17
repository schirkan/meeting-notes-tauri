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
    Logger.Error("SIDECAR_START_FAILED", "Keine Aufnahmequelle zum Transkribieren ausgewaehlt: --transcription-mic oder --transcription-speaker muss true sein.");
    return 23;
}
Logger.Info("config", "transcription", $"Transkribierte Quellen: mic={transcription.Mic}, speaker={transcription.Speaker}.");

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
    Logger.Info("config", "sample_rate_default", $"--sample-rate nicht gesetzt, verwende Default {srRaw} Hz.");
}
if (!int.TryParse(srRaw, out var sampleRate) || sampleRate < 8000 || sampleRate > 48000)
{
    Logger.Error("SIDECAR_START_FAILED", $"Parameter --sample-rate ist ungültig: '{srRaw}'. Erwartet 8000-48000.");
    return 11;
}

var micId = argsMap.GetValueOrDefault("--mic-device-id");
var speakerId = argsMap.GetValueOrDefault("--speaker-device-id");
var language = argsMap.GetValueOrDefault("--language") ?? "de-DE";
var speechKey = SpeechConfiguration.GetSpeechKey(argsMap);
var speechRegion = argsMap.GetValueOrDefault("--speech-region");
var speechEndpoint = argsMap.GetValueOrDefault("--speech-endpoint");
var azureEnabled = !string.IsNullOrWhiteSpace(speechKey)
                   && !string.IsNullOrWhiteSpace(speechRegion)
                   && !string.IsNullOrWhiteSpace(speechEndpoint);

if (!azureEnabled)
{
    Logger.Warn(
        "config",
        "azure_incomplete",
        "Azure-Konfiguration unvollständig (speech-key/region/endpoint fehlt). Audio-Capture läuft, Azure-Start übersprungen.");
}

if (!string.IsNullOrWhiteSpace(micId))
    Logger.Info("config", "mic_device_id", $"--mic-device-id={micId}");
if (!string.IsNullOrWhiteSpace(speakerId))
    Logger.Info("config", "speaker_device_id", $"--speaker-device-id={speakerId}");

var targetWaveFormat = new WaveFormat(sampleRate, 16, 1);
var cts = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) =>
{
    e.Cancel = true;
    cts.Cancel();
};

try
{
    using var mm = new MMDeviceEnumerator();

    // T-511: Nur transkribierte Quellen brauchen ein Geraet. Ohne
    // Speaker-Transkription wird kein Ausgabegeraet vorausgesetzt - sonst
    // waere "nur Mikrofon" auf einem Rechner ohne Ausgabe nicht moeglich.
    MMDevice? micDevice = null;
    if (transcription.Mic)
    {
        micDevice = DeviceResolver.ResolveInputDevice(mm, micId);
        if (micDevice is null)
        {
            Logger.Error("SIDECAR_START_FAILED", "Kein Mikrofon-Device gefunden.");
            return 22;
        }
    }
    MMDevice? speakerDevice = null;
    if (transcription.Speaker)
    {
        speakerDevice = DeviceResolver.ResolveOutputDevice(mm, speakerId);
        if (speakerDevice is null)
        {
            Logger.Error("LOOPBACK_DEVICE_NOT_FOUND", "Kein Speaker-Device für Loopback gefunden.");
            return 21;
        }
    }

    // NAudio 3.x (T-509): Die Aufnahme laeuft jetzt ueber WasapiRecorder.
    // Die WASAPI-Engine konvertiert im Shared Mode selbst auf das Zielformat
    // (16 kHz / 16-bit / mono). Kann sie das nicht - etwa bei einem
    // Float-Mic, fuer das die Engine nicht auf 16-Bit-PCM konvertieren kann -
    // faellt AudioRecorderSource automatisch auf den MediaFoundation-Resampler
    // zurueck. Beide Wege liefern exakt 16 kHz / 16-bit / mono.
    AzureSpeechService? azure = null;
    if (azureEnabled)
    {
        var azureConfig = new AzureSpeechConfig(
            Endpoint: speechEndpoint!,
            Region: speechRegion!,
            SpeechKey: speechKey!,
            InterimResults: true,
            Proxy: proxy);
        var userSettings = new UserSettings(language, new DeviceIds(micId, speakerId))
        {
            Transcription = transcription,
            Diarization = diarization
        };
        azure = new AzureSpeechService(azureConfig, userSettings);
        await azure.InitAsync();
        await azure.StartAsync(new AzureAudioFormat(sampleRate, 16, 1));
    }

    var azurePushLock = new object();

    // T-511: Nur transkribierte Quellen werden aufgenommen. Eine abgeschaltete
    // Quelle erhaelt weder Recorder noch Azure-Stream.
    using AudioRecorderSource? micSource = micDevice is null
        ? null
        : AudioRecorderSource.Create(
        micDevice,
        loopback: false,
        targetWaveFormat,
        "Mic",
        (pcm, capturedAtTicks, captureLatencyMs) =>
        {
            try
            {
                if (pcm.Length == 0) return;
                lock (azurePushLock)
                {
                    azure?.PushFrame(new AudioFrame(
                        AzureSpeechService.SourceMic,
                        sampleRate, 16, 1,
                        pcm,
                        capturedAtTicks,
                        captureLatencyMs));
                }
            }
            catch (Exception ex)
            {
                Logger.Error("SIDECAR_UNAVAILABLE", $"Mic-Frame Fehler: {ex.Message}");
            }
        });

    using AudioRecorderSource? speakerSource = speakerDevice is null
        ? null
        : AudioRecorderSource.Create(
        speakerDevice,
        loopback: true,
        targetWaveFormat,
        "Speaker-Loopback",
        (pcm, capturedAtTicks, captureLatencyMs) =>
        {
            try
            {
                if (pcm.Length == 0) return;
                lock (azurePushLock)
                {
                    azure?.PushFrame(new AudioFrame(
                        AzureSpeechService.SourceSpeaker,
                        sampleRate, 16, 1,
                        pcm,
                        capturedAtTicks,
                        captureLatencyMs));
                }
            }
            catch (Exception ex)
            {
                Logger.Error("LOOPBACK_INIT_FAILED", $"Loopback-Frame Fehler: {ex.Message}");
            }
        });

    micSource?.Start();
    speakerSource?.Start();

    var activeSources = new List<string>();
    if (micSource is not null) activeSources.Add("Mic");
    if (speakerSource is not null) activeSources.Add("Speaker-Loopback");

    Logger.Info("format", "mic_format", micSource is null
        ? "Mic: nicht transkribiert."
        : $"Mic Capture Format: {micSource.Format} (Modus: {micSource.ModeLabel})");
    Logger.Info("format", "speaker_format", speakerSource is null
        ? "Speaker-Loopback: nicht transkribiert."
        : $"Speaker Capture Format: {speakerSource.Format} (Modus: {speakerSource.ModeLabel})");
    Logger.Info("format", "azure_target", $"Azure Target Format: {targetWaveFormat}");
    Logger.Info("status", "capturing", $"Aktiv: {string.Join(" + ", activeSources)}.");
    Logger.Event("status", new { phase = "started", running = true });

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
    _ = Task.Run(async () =>
    {
        try
        {
            while (!cts.Token.IsCancellationRequested)
            {
                var line = await Console.In.ReadLineAsync(cts.Token);
                if (line is null) break;
                var command = SidecarCommands.ReadType(line);
                switch (command)
                {
                    case SidecarCommands.Pause:
                        azure?.SetPaused(true);
                        Logger.Info("sidecar", "pause", "Aufnahme pausiert; Azure-Session bleibt verbunden.");
                        Logger.Event("status", new { phase = "paused", running = true });
                        break;
                    case SidecarCommands.Resume:
                        {
                            var restarted = azure is null ? Array.Empty<string>() : await azure.ReconnectDeadStreamsAsync();
                            azure?.SetPaused(false);
                            Logger.Info("sidecar", "resume", "Aufnahme fortgesetzt.");
                            Logger.Event("status", new { phase = "resumed", running = true });
                            foreach (var source in restarted)
                                Logger.Warn("azure", "speaker_ids_reset",
                                    $"Azure-Session fuer {source} war beendet und wurde neu verbunden. " +
                                    "Die Sprecher-IDs wurden neu vergeben.");
                            break;
                        }
                    case SidecarCommands.Reset:
                        Logger.Info("sidecar", "reset", "Reset-Kommando empfangen.");
                        break;
                    case SidecarCommands.Shutdown:
                        Logger.Info("sidecar", "shutdown", "Shutdown-Kommando empfangen.");
                        cts.Cancel();
                        break;
                    default:
                        Logger.Warn("sidecar", "unknown_command", $"Unbekanntes Kommando: {command}");
                        break;
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            Logger.Error("SIDECAR_UNAVAILABLE", $"stdin-Reader beendet: {ex.Message}");
        }
    });

    var healthInterval = TimeSpan.FromSeconds(30);
    var nextHealthLog = DateTime.UtcNow.Add(healthInterval);
    while (!cts.Token.IsCancellationRequested)
    {
        try { await Task.Delay(TimeSpan.FromSeconds(1), cts.Token); }
        catch (OperationCanceledException) { break; }

        if (DateTime.UtcNow >= nextHealthLog)
        {
            Logger.Info("health", "alive", "ok");
            nextHealthLog = DateTime.UtcNow.Add(healthInterval);
        }

        // Waehrend einer Pause wird nicht neu verbunden: die Azure-Sitzung
        // soll die Sprecher-IDs unveraendert erhalten. Ausserhalb der Pause
        // wird eine vom Dienst beendete Sitzung sofort neu aufgebaut, damit
        // die Aufnahme nicht still weiterlaeuft.
        if (azure is not null && !azure.IsPaused)
        {
            var restarted = await azure.ReconnectDeadStreamsAsync();
            foreach (var source in restarted)
                Logger.Warn("azure", "speaker_ids_reset",
                    $"Azure-Session fuer {source} wurde vom Dienst beendet und neu verbunden. " +
                    "Die Sprecher-IDs wurden neu vergeben.");
        }
    }

    micSource?.Stop();
    speakerSource?.Stop();
    if (azure is not null) await azure.StopAsync();
    Logger.Info("status", "stopped", "Graceful shutdown abgeschlossen.");
    Logger.Event("status", new { phase = "stopped", running = false });
    return 0;
}
catch (OperationCanceledException)
{
    Logger.Info("status", "cancelled", "Beendet durch Cancellation.");
    return 0;
}
catch (Exception ex)
{
    Logger.Error("SIDECAR_UNAVAILABLE", ex.Message);
    return 50;
}
finally
{
    cts.Dispose();
}

