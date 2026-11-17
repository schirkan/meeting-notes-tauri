# T-203: Audio-Resampling auf 16 kHz / 16-bit / mono

## Kontext
Status: teils umgesetzt (1 Punkt offen)
Priorität: high
Abhängigkeiten: T-202

## Goal
Audio-Frames beider Capture-Quellen (Mic, Speaker-Loopback) auf das Azure-kompatible Zielformat resampeln.

## Done When
- [x] Mic- und Speaker-Frames werden vor der Übergabe an Azure auf 16 kHz, 16-bit PCM, mono normalisiert. Beleg: 16 kHz / 16 Bit / Mono im Sidecar (targetWaveFormat).
- [x] Resampling-Implementierung ist eine eigene Klasse (`AudioResampler.cs`) und wird in `T-202`-Pipeline eingehängt. Beleg: sidecar/AudioResampler.cs.
- [ ] Smoke-Test: 48-kHz-Stereo-Input führt zu korrektem 16-kHz-Mono-Output ohne hörbare Artefakte (Stichproben-Test). - **offen**: Ein Stichproben-Test mit 48-kHz-Stereo-Input existiert nicht.
- [x] Resampling-Fehler (z. B. unbekanntes Eingabeformat) werden geloggt und als Capture-Fehler an den Tauri-Main weitergereicht. Beleg: SIDECAR_UNAVAILABLE bzw. LOOPBACK_INIT_FAILED im Recorder.

## Approach
- NAudio-eigenes `MediaFoundationResampler` oder `WaveFormatConversionStream` mit Ziel-WaveFormat.
- Bestehende Logik aus `../meeting-notes` (Sidecar-Resampling auf Azure-kompatibles Format) bleibt funktional erhalten, wird nur in eine eigene Klasse verschoben.
- Falls Resampling wegfällt, weil Azure auch Rohformate akzeptiert: Spec gegenchecken. Aktueller Stand: Resampling ist Pflicht.

## Log
- 2026-06-25: Spec angelegt.