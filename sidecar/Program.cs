using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using MeetingNotes.Sidecar;
using NAudio.CoreAudioApi;
using NAudio.Wave;

// Block 3 composition root for meeting-notes-tauri.
//
// Responsibilities:
//   1. Parse CLI args (ArgsParser).
//   2. Resolve + enumerate audio devices (DeviceResolver).
//   3. Open two NAudio captures: mic (WasapiCapture) and speaker loopback
//      (WasapiLoopbackCapture). Each feeds a BufferedWaveProvider, which is
//      drained by a MediaFoundationResampler to 16 kHz / 16-bit / mono.
//   4. Forward the resampled PCM frames into AzureSpeechService, which owns
//      two Recognizers (SpeechRecognizer for mic, ConversationTranscriber
//      for speaker) and surfaces transcripts + errors via Logger.
//   5. Emit everything (status, transcript, error, debug) as JSON-Lines
//      on stdout for the Tauri main process to consume.
//
// In Block 4 the Tauri-Main (Rust) spawns this EXE via tauri-plugin-shell
// and reads stdout as JSON-Lines; commands flow back over stdin.

var argsMap = ArgsParser.Parse(args);

if (argsMap.ContainsKey("--list-devices"))
{
    var snapshot = DeviceResolver.ListDevices();
    Logger.Event("device_list", snapshot);
    return 0;
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
var speechKey = argsMap.GetValueOrDefault("--speech-key");
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
    var micDevice = DeviceResolver.ResolveInputDevice(mm, micId);
    var speakerDevice = DeviceResolver.ResolveOutputDevice(mm, speakerId);

    if (speakerDevice is null)
    {
        Logger.Error("LOOPBACK_DEVICE_NOT_FOUND", "Kein Speaker-Device für Loopback gefunden.");
        return 21;
    }
    if (micDevice is null)
    {
        Logger.Error("SIDECAR_START_FAILED", "Kein Mikrofon-Device gefunden.");
        return 22;
    }

    var micBuffered = new BufferedWaveProvider(micDevice.AudioClient.MixFormat)
    {
        DiscardOnBufferOverflow = true,
        ReadFully = false
    };
    var speakerBuffered = new BufferedWaveProvider(speakerDevice.AudioClient.MixFormat)
    {
        DiscardOnBufferOverflow = true,
        ReadFully = false
    };

    using var micCapture = new WasapiCapture(micDevice);
    using var speakerCapture = new WasapiLoopbackCapture(speakerDevice);
    using var micResampler = new MediaFoundationResampler(micBuffered, targetWaveFormat);
    using var speakerResampler = new MediaFoundationResampler(speakerBuffered, targetWaveFormat);
    micResampler.ResamplerQuality = 60;
    speakerResampler.ResamplerQuality = 60;

    AzureSpeechService? azure = null;
    if (azureEnabled)
    {
        var azureConfig = new AzureSpeechConfig(
            Endpoint: speechEndpoint!,
            Region: speechRegion!,
            SpeechKey: speechKey!,
            InterimResults: true,
            Proxy: null);
        var userSettings = new UserSettings(language, new DeviceIds(micId, speakerId));
        azure = new AzureSpeechService(azureConfig, userSettings);
        await azure.InitAsync();
        await azure.StartAsync(new AzureAudioFormat(sampleRate, 16, 1));
    }

    long micSeq = 0;
    long speakerSeq = 0;
    var azurePushLock = new object();

    micCapture.DataAvailable += (_, e) =>
    {
        try
        {
            micBuffered.AddSamples(e.Buffer, 0, e.BytesRecorded);
            var pcm = DrainResampled(micResampler);
            if (pcm.Length == 0) return;
            lock (azurePushLock)
            {
                azure?.PushFrame(new AudioFrame(
                    AzureSpeechService.SourceMic,
                    sampleRate, 16, 1,
                    pcm));
            }
            _ = micSeq;
        }
        catch (Exception ex)
        {
            Logger.Error("SIDECAR_UNAVAILABLE", $"Mic-Frame Fehler: {ex.Message}");
        }
    };

    speakerCapture.DataAvailable += (_, e) =>
    {
        try
        {
            speakerBuffered.AddSamples(e.Buffer, 0, e.BytesRecorded);
            var pcm = DrainResampled(speakerResampler);
            if (pcm.Length == 0) return;
            lock (azurePushLock)
            {
                azure?.PushFrame(new AudioFrame(
                    AzureSpeechService.SourceSpeaker,
                    sampleRate, 16, 1,
                    pcm));
            }
            _ = speakerSeq;
        }
        catch (Exception ex)
        {
            Logger.Error("LOOPBACK_INIT_FAILED", $"Loopback-Frame Fehler: {ex.Message}");
        }
    };

    micCapture.StartRecording();
    speakerCapture.StartRecording();

    Logger.Info("format", "mic_format", $"Mic Capture Format: {micCapture.WaveFormat}");
    Logger.Info("format", "speaker_format", $"Speaker Capture Format: {speakerCapture.WaveFormat}");
    Logger.Info("format", "azure_target", $"Azure Target Format: {targetWaveFormat}");
    Logger.Info("status", "capturing", "Mic + Speaker Loopback aktiv.");
    Logger.Event("status", new { phase = "started", running = true });

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
    }

    micCapture.StopRecording();
    speakerCapture.StopRecording();
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

static byte[] DrainResampled(IWaveProvider provider)
{
    var buffer = new byte[8192];
    using var output = new MemoryStream();
    while (true)
    {
        var read = provider.Read(buffer, 0, buffer.Length);
        if (read <= 0) break;
        output.Write(buffer, 0, read);
        if (read < buffer.Length) break;
    }
    return output.ToArray();
}
