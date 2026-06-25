using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

const int HeaderSize = 36;
const uint Magic = 0x4D4E5043;

var argsMap = ParseArgs(args);

if (argsMap.ContainsKey("--list-devices"))
{
    Console.WriteLine(JsonSerializer.Serialize(ListDevices()));
    return 0;
}

if (!argsMap.TryGetValue("--pipe-name", out var pipeName) || string.IsNullOrWhiteSpace(pipeName))
{
    LogError("SIDECAR_START_FAILED", "Parameter --pipe-name fehlt.");
    return 10;
}

var sampleRate = 16000;
if (argsMap.TryGetValue("--sample-rate", out var srRaw) && !string.IsNullOrWhiteSpace(srRaw))
{
    if (!int.TryParse(srRaw, out var srParsed) || srParsed <= 0)
    {
        LogError("SIDECAR_START_FAILED", $"Parameter --sample-rate ist ungültig: '{srRaw}'. Erwartet positive Ganzzahl.");
        return 11;
    }
    if (srParsed < 8000 || srParsed > 48000)
    {
        LogError("SIDECAR_START_FAILED", $"Parameter --sample-rate={srParsed} außerhalb des unterstützten Bereichs (8000-48000).");
        return 12;
    }
    sampleRate = srParsed;
}
else
{
    LogInfo("config", "sample_rate_default", $"--sample-rate nicht gesetzt, verwende Default {sampleRate} Hz.");
}

var micId = argsMap.GetValueOrDefault("--mic-device-id");
var speakerId = argsMap.GetValueOrDefault("--speaker-device-id");

if (!string.IsNullOrWhiteSpace(micId))
{
    LogInfo("config", "mic_device_id", $"--mic-device-id={micId}");
}
if (!string.IsNullOrWhiteSpace(speakerId))
{
    LogInfo("config", "speaker_device_id", $"--speaker-device-id={speakerId}");
}

var targetWaveFormat = new WaveFormat(sampleRate, 16, 1);

var cts = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) =>
{
    e.Cancel = true;
    cts.Cancel();
};

try
{
    using var pipe = new NamedPipeServerStream(pipeName, PipeDirection.Out, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
    LogInfo("status", "waiting_for_pipe", $"Warte auf Pipe-Verbindung {pipeName}.");
    await pipe.WaitForConnectionAsync(cts.Token);
    LogInfo("status", "pipe_connected", "Pipe-Verbindung steht.");

    using var mm = new MMDeviceEnumerator();

    var micDevice = ResolveInputDevice(mm, micId);
    var speakerDevice = ResolveOutputDevice(mm, speakerId);

    if (speakerDevice is null)
    {
        LogError("LOOPBACK_DEVICE_NOT_FOUND", "Kein Speaker-Device für Loopback gefunden.");
        return 21;
    }

    if (micDevice is null)
    {
        LogError("SIDECAR_START_FAILED", "Kein Mikrofon-Device gefunden.");
        return 22;
    }

    using var micCapture = new WasapiCapture(micDevice);
    using var speakerCapture = new WasapiLoopbackCapture(speakerDevice);
    var micBufferedProvider = new BufferedWaveProvider(micCapture.WaveFormat)
    {
        DiscardOnBufferOverflow = true,
        ReadFully = false
    };
    var speakerBufferedProvider = new BufferedWaveProvider(speakerCapture.WaveFormat)
    {
        DiscardOnBufferOverflow = true,
        ReadFully = false
    };
    using var micResampler = new MediaFoundationResampler(micBufferedProvider, targetWaveFormat);
    using var speakerResampler = new MediaFoundationResampler(speakerBufferedProvider, targetWaveFormat);

    micResampler.ResamplerQuality = 60;
    speakerResampler.ResamplerQuality = 60;

    long micSequence = 0;
    long speakerSequence = 0;
    var writeLock = new object();

    micCapture.DataAvailable += (_, e) =>
    {
        try
        {
            micBufferedProvider.AddSamples(e.Buffer, 0, e.BytesRecorded);
            var pcm16 = DrainResampledPcm(micResampler);
            if (pcm16.Length == 0) return;

            lock (writeLock)
            {
                WriteFrame(pipe, source: 1, sampleRate, channels: 1, bitsPerSample: 16, sequence: ++micSequence, payload: pcm16);
            }
        }
        catch (Exception ex)
        {
            LogError("SIDECAR_UNAVAILABLE", $"Mic-Frame Fehler: {ex.Message}");
        }
    };

    speakerCapture.DataAvailable += (_, e) =>
    {
        try
        {
            speakerBufferedProvider.AddSamples(e.Buffer, 0, e.BytesRecorded);
            var pcm16 = DrainResampledPcm(speakerResampler);
            if (pcm16.Length == 0) return;

            lock (writeLock)
            {
                WriteFrame(pipe, source: 2, sampleRate, channels: 1, bitsPerSample: 16, sequence: ++speakerSequence, payload: pcm16);
            }
        }
        catch (Exception ex)
        {
            LogError("LOOPBACK_INIT_FAILED", $"Loopback-Frame Fehler: {ex.Message}");
        }
    };

    micCapture.StartRecording();
    speakerCapture.StartRecording();

    LogInfo("format", "mic_capture_format", $"Mic Capture Format: {micCapture.WaveFormat}");
    LogInfo("format", "speaker_capture_format", $"Speaker Capture Format: {speakerCapture.WaveFormat}");
    LogInfo("format", "azure_target_format", $"Azure Target Format: {targetWaveFormat}");
    LogInfo("status", "capturing", "Mic + Speaker Loopback aktiv.");

    var healthInterval = TimeSpan.FromSeconds(30);
    var nextHealthLog = DateTime.UtcNow.Add(healthInterval);

    while (!cts.Token.IsCancellationRequested)
    {
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(1), cts.Token);
        }
        catch (OperationCanceledException) { break; }

        if (DateTime.UtcNow >= nextHealthLog)
        {
            LogInfo("health", "alive", "ok");
            nextHealthLog = DateTime.UtcNow.Add(healthInterval);
        }
    }

    micCapture.StopRecording();
    speakerCapture.StopRecording();
    LogInfo("status", "stopped", "Graceful shutdown abgeschlossen.");
    return 0;
}
catch (OperationCanceledException)
{
    LogInfo("status", "cancelled", "Beendet durch Cancellation.");
    return 0;
}
catch (Exception ex)
{
    LogError("SIDECAR_UNAVAILABLE", ex.Message);
    return 50;
}

static Dictionary<string, string?> ParseArgs(string[] args)
{
    var result = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);

    for (var i = 0; i < args.Length; i++)
    {
        var key = args[i];
        if (!key.StartsWith("--", StringComparison.Ordinal)) continue;

        var hasValue = i + 1 < args.Length && !args[i + 1].StartsWith("--", StringComparison.Ordinal);
        result[key] = hasValue ? args[++i] : "true";
    }

    return result;
}

static object ListDevices()
{
    using var mm = new MMDeviceEnumerator();

    string? defaultIn = null;
    string? defaultOut = null;

    try { defaultIn = mm.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Multimedia).ID; } catch { }
    try { defaultOut = mm.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia).ID; } catch { }

    var inputs = mm.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active)
        .Select(d => new { id = d.ID, name = d.FriendlyName, flow = "input", isDefault = d.ID == defaultIn })
        .ToArray();

    var outputs = mm.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active)
        .Select(d => new { id = d.ID, name = d.FriendlyName, flow = "output", isDefault = d.ID == defaultOut })
        .ToArray();

    return new
    {
        inputs,
        outputs,
        fetchedAtIso = DateTimeOffset.UtcNow.ToString("O")
    };
}

static MMDevice? ResolveInputDevice(MMDeviceEnumerator mm, string? explicitId)
{
    if (!string.IsNullOrWhiteSpace(explicitId))
    {
        return mm.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active)
            .FirstOrDefault(d => string.Equals(d.ID, explicitId, StringComparison.OrdinalIgnoreCase));
    }

    try { return mm.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Multimedia); } catch { return null; }
}

static MMDevice? ResolveOutputDevice(MMDeviceEnumerator mm, string? explicitId)
{
    if (!string.IsNullOrWhiteSpace(explicitId))
    {
        return mm.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active)
            .FirstOrDefault(d => string.Equals(d.ID, explicitId, StringComparison.OrdinalIgnoreCase));
    }

    try { return mm.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia); } catch { return null; }
}

static void WriteFrame(Stream stream, byte source, int sampleRate, byte channels, byte bitsPerSample, long sequence, ReadOnlySpan<byte> payload)
{
    var header = new byte[HeaderSize];

    BitConverter.GetBytes(Magic).CopyTo(header, 0);
    header[4] = 1; // protocol version
    header[5] = source;
    header[6] = channels;
    header[7] = bitsPerSample;
    BitConverter.GetBytes(sampleRate).CopyTo(header, 8);
    BitConverter.GetBytes(payload.Length).CopyTo(header, 12);
    BitConverter.GetBytes(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()).CopyTo(header, 16);
    BitConverter.GetBytes(sequence).CopyTo(header, 24);

    var crc = ComputeCrc32(payload);
    BitConverter.GetBytes(crc).CopyTo(header, 32);

    // Header und Payload in einem einzigen Write-Call absetzen, damit auf der
    // Named Pipe (PipeTransmissionMode.Byte) kein DataAvailable-Event zwischen
    // Header und Payload feuern kann. Sonst sieht der Reader einen Header-only
    // Chunk, kann den Frame nicht zuordnen und verwirft ihn.
    var combined = new byte[header.Length + payload.Length];
    Buffer.BlockCopy(header, 0, combined, 0, header.Length);
    payload.CopyTo(combined.AsSpan(header.Length));

    stream.Write(combined, 0, combined.Length);
    stream.Flush();
}

static byte[] DrainResampledPcm(IWaveProvider provider)
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

static uint ComputeCrc32(ReadOnlySpan<byte> buffer)
{
    uint crc = 0xffffffff;

    foreach (var b in buffer)
    {
        crc ^= b;
        for (var i = 0; i < 8; i++)
        {
            var mask = (uint)-(int)(crc & 1);
            crc = (crc >> 1) ^ (0xedb88320 & mask);
        }
    }

    return crc ^ 0xffffffff;
}

static void LogInfo(string type, string code, string message)
{
    Console.WriteLine(JsonSerializer.Serialize(new { type, level = "info", code, message }));
}

static void LogError(string code, string message)
{
    Console.WriteLine(JsonSerializer.Serialize(new { type = "error", level = "error", code, message }));
}
