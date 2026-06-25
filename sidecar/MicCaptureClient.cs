using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace MeetingNotes.Sidecar;

/// <summary>
/// Mic capture client using WASAPI shared mode.
/// </summary>
public sealed class MicCaptureClient : AudioCaptureClient
{
    public MicCaptureClient(MMDevice device) : base(device) { }

    protected override IWaveIn CreateCapture(MMDevice device) => new WasapiCapture(device);
}
