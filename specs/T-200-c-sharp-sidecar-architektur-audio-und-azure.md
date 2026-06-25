# T-200: C#-Sidecar-Architektur (Audio + Azure Speech)

## Kontext
Status: draft
Priorität: high
Subtasks: T-201, T-202, T-203, T-204, T-205, T-206, T-207
Abhängigkeiten: -

## Goal
C#-Sidecar bereitstellen, der **Audio-Capture (NAudio) UND Azure Speech SDK** in einem Prozess vereint und Transkript-Events per JSON-Lines über **stdin/stdout** an den Tauri-Main liefert (siehe `AD-008`, `T-201`).

## Done When
- [ ] `MeetingNotes.Sidecar.exe` startet/stoppt zuverlässig via Tauri-Plugin-Shell.
- [ ] Mic- und Loopback-Capture liefern kontinuierliche PCM-Frames.
- [ ] Audio-Frames werden intern (ohne Pipe) an die Azure-Speech-PushStream übergeben.
- [ ] Transkript-Events (interim/final, inkl. Diarization) fließen als JSON-Lines über **stdout** an den Tauri-Main. Commands (start/stop/settings) gehen über **stdin** zurück (siehe `T-201`).
- [ ] Fehlerfälle (Loopback nicht verfügbar, Azure-Start schlägt fehl) sind robust abgefangen und signalisiert.

## Approach
- Audio- und Speech-Logik laufen in **einem** Prozess, daher sind die PCM-Frames nie über Prozessgrenzen unterwegs.
- Tauri-Main (Rust) bekommt ausschließlich **fertige Transkript-Events** (über stdout) und steuert den Sidecar per stdin-Commands (siehe `T-201`, `AD-008`).
- Diese Architektur eliminiert den Pipe-Bottleneck, der in der Electron-Variante zu den Audio-Transport-Härtungen (`b2b903a`, `5d90c63`) geführt hat.

## Log
- 2026-06-25: Spec angelegt.