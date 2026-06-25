using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace MeetingNotes.Sidecar;

/// <summary>
/// Speaker-loopback capture client. Captures the audio stream that is
/// being rendered to the selected output device ("what you hear").
/// </summary>
public sealed class LoopbackCaptureClient : AudioCaptureClient
{
    public LoopbackCaptureClient(MMDevice device) : base(device) { }

    protected override IWaveIn CreateCapture(MMDevice device) => new WasapiLoopbackCapture(device);
}
