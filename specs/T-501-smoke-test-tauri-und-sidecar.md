# T-501: Smoke-Test (Tauri-Start + Sidecar-Spawn + Speech-Pipeline)

## Kontext
Status: partial
Priorität: high
Abhängigkeiten: T-301, T-302, T-303

## Goal
Smoke-Test, der die gesamte Tauri-Variante inkl. Sidecar-Spawn und Speech-Pipeline-Init automatisiert prüft.

## Done When
- [x] Skript `scripts/test-smoke.mjs` existiert.
- [x] Skript prüft (headless, ohne WebDriver):
  1. Renderer-Build-Artefakte (`dist/index.html`, `dist/assets/`).
  2. Tauri-EXE (`src-tauri/target/release/meeting-notes-tauri.exe`).
  3. Sidecar-EXE + `--list-devices` produziert valides `device_list`-JSON-Lines-Event mit Inputs/Outputs.
  4. Portable-Distribution (`dist/portable/meeting-notes-tauri.exe`, `dist/portable/sidecar/MeetingNotes.Sidecar.exe`, `dist/portable/SHA256SUMS` konsistent).
  5. Transcript-Contract hat alle benötigten TS-Typen.
  6. Exit-Codes summieren und Skript-Exit-Code setzen.
- [x] Skript ist im `package.json` als `npm run test:smoke` registriert.
- [ ] Voller End-to-End-Test mit WebDriver + App-Start + `start_recording()`/Event-Wait — **offen**: WebDriver-Setup für Tauri 2 ist aufwendig; die headless Smoke-Stufen 1–5 decken die kritischen Artefakt-Invarianten ab.

## Approach
- Inspiration: `../meeting-notes/scripts/test-smoke-electron.mjs` (Pattern übernehmen).
- Tauri-App-Steuerung via Tauri-CLI oder WebDriver-Integration (offene Entscheidung).
- Timeouts: 10 s für jeden Wait-Step, dann Fail.

## Log
- 2026-06-25: Spec angelegt.