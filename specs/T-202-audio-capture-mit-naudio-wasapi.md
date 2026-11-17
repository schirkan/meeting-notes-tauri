# T-202: Audio-Capture mit NAudio (WASAPI Mic + Loopback)

## Kontext
Status: umgesetzt
PrioritÃ¤t: high
AbhÃ¤ngigkeiten: T-200

## Goal
Bestehende NAudio-basierte WASAPI-Capture-Implementierung aus `../meeting-notes/sidecar/Program.cs` 1:1 Ã¼bernehmen und im neuen JSON-Lines-Kontext einbetten.

## Done When
- [x] Mic-Capture und Speaker-Loopback laufen ueber `WasapiRecorderBuilder`/`WasapiRecorder` (T-509 umgesetzt). Die Kapselung liegt in `sidecar/AudioRecorderSource.cs`; die frueher geplanten Klassen `AudioCaptureClient.cs`/`LoopbackCaptureClient.cs` wurden als ungenutzt geloescht.
- [x] Lifecycle (`Start`/`Stop`) ist explizit und idempotent (`AudioRecorderSource.Start`/`Stop`/`Dispose`).
- [x] Beide Quellen liefern PCM-Frames im Zielformat (16 kHz / 16-bit / mono) an eine interne Pipeline; im Engine-Modus direkt aus dem WASAPI-Puffer, im Resampler-Modus ueber `AudioResampler`.
- [x] Capture-Fehler (Device verschwindet, Sample-Rate-Inkompatibilitaet) werden als strukturierte Events geloggt und ueber die JSON-Lines-Ausgabe an den Tauri-Main weitergereicht (`AudioRecorderSource` loggt Frame- und Abbruchfehler als `SIDECAR_UNAVAILABLE`).

## Approach
- Bestehender Code aus `../meeting-notes/sidecar/Program.cs` wird **nicht umgeschrieben**, sondern nur in Klassen aufgeteilt.
- `Main()`-Methode wird zur Composition Root: sie instanziiert Capture-Clients, Audio-Pipeline und Azure-Service.
- Sample-Raten-Erkennung bleibt unverÃ¤ndert (GerÃ¤te-Sample-Rate wird respektiert, Resampling erfolgt zentral in `T-203`).

## Log
- 2026-06-25: Spec angelegt.
