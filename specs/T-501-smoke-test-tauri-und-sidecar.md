# T-501: Smoke-Test (Tauri-Start + Sidecar-Spawn + Speech-Pipeline)

## Kontext
Status: draft
Priorität: high
Abhängigkeiten: T-301, T-302, T-303

## Goal
Smoke-Test, der die gesamte Tauri-Variante inkl. Sidecar-Spawn und Speech-Pipeline-Init automatisiert prüft.

## Done When
- [ ] Skript `scripts/test-smoke-tauri.mjs` existiert (oder `.ps1`-Pendant).
- [ ] Skript:
  1. `npm run build:sidecar` (Sidecar bauen + publishen).
  2. `npm run tauri build` (App-Build ohne Installer).
  3. App-EXE starten.
  4. Warten auf Tauri-Event `sidecar:started`.
  5. Command `start_recording()` auslösen.
  6. Warten auf `transcript:status.phase=started` und erstes `transcript:segment`.
  7. Command `stop_recording()` auslösen.
  8. Warten auf `transcript:status.phase=stopped`.
  9. App beenden.
  10. Exit-Codes summieren und Skript-Exit-Code setzen.
- [ ] Skript ist im `package.json` als `npm run test:smoke` registriert.

## Approach
- Inspiration: `../meeting-notes/scripts/test-smoke-electron.mjs` (Pattern übernehmen).
- Tauri-App-Steuerung via Tauri-CLI oder WebDriver-Integration (offene Entscheidung).
- Timeouts: 10 s für jeden Wait-Step, dann Fail.

## Log
- 2026-06-25: Spec angelegt.