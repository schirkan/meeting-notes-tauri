using System;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace MeetingNotes.Sidecar;

/// <summary>
/// Wraps a single NAudio capture source (mic or speaker-loopback) and
/// feeds PCM frames into a shared buffered provider. The provider is
/// drained by an <see cref="AudioResampler"/> and finally pushed into
/// Azure Speech's PushAudioInputStream.
///
/// Source-specific subclasses implement <see cref="CreateCapture"/>.
/// </summary>
public abstract class AudioCaptureClient : IDisposable
{
    private readonly MMDevice _device;
    private IWaveIn? _capture;

    public BufferedWaveProvider BufferedProvider { get; }
    public WaveFormat DeviceFormat => _capture?.WaveFormat ?? throw new InvalidOperationException("Capture not started.");

    protected AudioCaptureClient(MMDevice device)
    {
        _device = device;
        BufferedProvider = new BufferedWaveProvider(device.AudioClient.MixFormat)
        {
            DiscardOnBufferOverflow = true,
            ReadFully = false
        };
    }

    protected abstract IWaveIn CreateCapture(MMDevice device);

    public void Start()
    {
        if (_capture != null) return;
        _capture = CreateCapture(_device);
        _capture.DataAvailable += (_, e) =>
        {
            try
            {
                BufferedProvider.AddSamples(e.Buffer, 0, e.BytesRecorded);
            }
            catch (Exception ex)
            {
                Logger.Error("CAPTURE_FRAME_FAILED", ex.Message);
            }
        };
        _capture.StartRecording();
    }

    public void Stop()
    {
        _capture?.StopRecording();
        _capture?.Dispose();
        _capture = null;
    }

    public void Dispose() => Stop();
}
