using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace MeetingNotes.Sidecar;

/// <summary>
/// Mic capture client using WASAPI shared mode.
/// </summary>
public sealed class MicCaptureClient : AudioCaptureClient
{
    public MicCaptureClient(MMDevice device) : base(device) { }

    // NAudio 3.x markiert WasapiCapture als obsolet; die Empfehlung
    // (WasapiRecorderBuilder) wechselt das Aufnahmemodell komplett
    // (IAsyncEnumerable statt DataAvailable-Event) und ist ein eigener
    // Schritt, keine Paket-Aktualisierung (T-508).
#pragma warning disable CS0618
    protected override IWaveIn CreateCapture(MMDevice device) => new WasapiCapture(device);
#pragma warning restore CS0618
}
