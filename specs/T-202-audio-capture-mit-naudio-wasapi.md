# T-202: Audio-Capture mit NAudio (WASAPI Mic + Loopback)

## Kontext
Status: draft
Priorität: high
Abhängigkeiten: T-200

## Goal
Bestehende NAudio-basierte WASAPI-Capture-Implementierung aus `../meeting-notes/sidecar/Program.cs` 1:1 übernehmen und im neuen JSON-Lines-Kontext einbetten.

## Done When
- [ ] Mic-Capture (`WasapiCapture`) und Speaker-Loopback (`WasapiLoopbackCapture`) sind in eigene Klassen gekapselt (`AudioCaptureClient.cs`, `LoopbackCaptureClient.cs`).
- [ ] Lifecycle (`Start`/`Stop`) ist explizit und idempotent.
- [ ] Beide Clients liefern PCM-Frames als `ReadOnlyMemory<byte>` an eine interne Pipeline.
- [ ] Capture-Fehler (Device verschwindet, Sample-Rate-Inkompatibilität) werden als strukturierte Events geloggt und an den Tauri-Main weitergereicht.

## Approach
- Bestehender Code aus `../meeting-notes/sidecar/Program.cs` wird **nicht umgeschrieben**, sondern nur in Klassen aufgeteilt.
- `Main()`-Methode wird zur Composition Root: sie instanziiert Capture-Clients, Audio-Pipeline und Azure-Service.
- Sample-Raten-Erkennung bleibt unverändert (Geräte-Sample-Rate wird respektiert, Resampling erfolgt zentral in `T-203`).

## Log
- 2026-06-25: Spec angelegt.