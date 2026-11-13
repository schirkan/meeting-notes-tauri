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

    // NAudio 3.x markiert WasapiLoopbackCapture als obsolet; die
    // Empfehlung (WasapiRecorderBuilder) wechselt das Aufnahmemodell
    // komplett und ist ein eigener Schritt (T-508).
#pragma warning disable CS0618
    protected override IWaveIn CreateCapture(MMDevice device) => new WasapiLoopbackCapture(device);
#pragma warning restore CS0618
}
