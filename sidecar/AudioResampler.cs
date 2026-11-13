using System;
using System.IO;
using NAudio.Wave;

namespace MeetingNotes.Sidecar;

/// <summary>
/// Resamples a buffered PCM stream to Azure's target format
/// (16 kHz, 16-bit, mono). Wraps NAudio's MediaFoundationResampler
/// with quality=60 (good enough for speech, low CPU).
///
/// DrainToBuffer() reads everything currently buffered and returns a
/// single contiguous PCM16 byte array. Callers feed those bytes into
/// the Azure Speech PushAudioInputStream.
/// </summary>
public sealed class AudioResampler : IDisposable
{
    private readonly MediaFoundationResampler _resampler;

    public WaveFormat TargetFormat { get; }

    public AudioResampler(BufferedWaveProvider sourceProvider, WaveFormat targetFormat)
    {
        TargetFormat = targetFormat;
        _resampler = new MediaFoundationResampler(sourceProvider, targetFormat);
        _resampler.ResamplerQuality = 60;
    }

    public byte[] DrainToBuffer()
    {
        var buffer = new byte[8192];
        using var output = new MemoryStream();
        while (true)
        {
            // NAudio 3.x: MediaFoundationTransform liest span-basiert
            // (IWaveProvider.Read(Span<byte>)); die alte byte[]-Ueberladung
            // mit Offset/Count existiert nicht mehr.
            var read = _resampler.Read(buffer.AsSpan());
            if (read <= 0) break;
            output.Write(buffer, 0, read);
            if (read < buffer.Length) break;
        }
        return output.ToArray();
    }

    public void Dispose() => _resampler.Dispose();
}
