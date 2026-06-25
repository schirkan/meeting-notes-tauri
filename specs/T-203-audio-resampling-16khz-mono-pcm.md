# T-203: Audio-Resampling auf 16 kHz / 16-bit / mono

## Kontext
Status: draft
Priorität: high
Abhängigkeiten: T-202

## Goal
Audio-Frames beider Capture-Quellen (Mic, Speaker-Loopback) auf das Azure-kompatible Zielformat resampeln.

## Done When
- [ ] Mic- und Speaker-Frames werden vor der Übergabe an Azure auf 16 kHz, 16-bit PCM, mono normalisiert.
- [ ] Resampling-Implementierung ist eine eigene Klasse (`AudioResampler.cs`) und wird in `T-202`-Pipeline eingehängt.
- [ ] Smoke-Test: 48-kHz-Stereo-Input führt zu korrektem 16-kHz-Mono-Output ohne hörbare Artefakte (Stichproben-Test).
- [ ] Resampling-Fehler (z. B. unbekanntes Eingabeformat) werden geloggt und als Capture-Fehler an den Tauri-Main weitergereicht.

## Approach
- NAudio-eigenes `MediaFoundationResampler` oder `WaveFormatConversionStream` mit Ziel-WaveFormat.
- Bestehende Logik aus `../meeting-notes` (Sidecar-Resampling auf Azure-kompatibles Format) bleibt funktional erhalten, wird nur in eine eigene Klasse verschoben.
- Falls Resampling wegfällt, weil Azure auch Rohformate akzeptiert: Spec gegenchecken. Aktueller Stand: Resampling ist Pflicht.

## Log
- 2026-06-25: Spec angelegt.