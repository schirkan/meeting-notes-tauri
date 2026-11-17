# T-501: Smoke-Test (Tauri-Start + Sidecar-Spawn + Speech-Pipeline)

> **Ergaenzung 2026-11-17 (T-512-Nachlauf):** Der Smoke-Test prueft zusaetzlich, dass die
> Renderer-Assets in der Tauri-EXE eingebettet sind (Release-EXE und Portable-EXE).
> Grund: ein mit `cargo build --release` statt der Tauri-CLI gebautes Binary
> enthaelt keine Assets und startet ohne UI (15,40 MB statt 15,48 MB). Ohne diese
> Pruefung waere ein solches Artefakt als Lieferung durchgerutscht.

## Kontext
Status: teils umgesetzt (1 Punkt offen)
Priorität: high
Abhängigkeiten: T-301, T-302, T-303

## Goal
Smoke-Test, der die gesamte Tauri-Variante inkl. Sidecar-Spawn und Speech-Pipeline-Init automatisiert prüft.

## Done When
- [x] Skript `scripts/test-smoke.mjs` existiert. Beleg: scripts/test-smoke.mjs (test-smoke.mjs) (geprueft).
- [x] Skript prüft (headless, ohne WebDriver): Beleg: scripts/test-smoke.mjs (Stufen 1-5) - am 2026-11-17 bestanden, inklusive Protokoll-Handshake und Asset-Einbettung.
  1. Renderer-Build-Artefakte (`dist/index.html`, `dist/assets/`).
  2. App-EXE (`src-tauri/target/release/meeting-notes.exe`).
  3. Sidecar-EXE + `--list-devices` produziert valides `device_list`-JSON-Lines-Event mit Inputs/Outputs.
  4. Portable-Distribution (`dist/portable/meeting-notes.exe`, `dist/portable/sidecar/MeetingNotes.Sidecar.exe`, `dist/portable/SHA256SUMS` konsistent).
  5. Transcript-Contract hat alle benötigten TS-Typen.
  6. Exit-Codes summieren und Skript-Exit-Code setzen.
- [x] Skript ist im `package.json` als `npm run test:smoke` registriert. Beleg: package.json, package.json (run) (geprueft).
- [ ] Voller End-to-End-Test mit WebDriver + App-Start + `start_recording()`/Event-Wait - **offen**: WebDriver-Setup für Tauri 2 ist aufwendig; die headless Smoke-Stufen 1–5 decken die kritischen Artefakt-Invarianten ab.

## Zusätzliche lokale Validierung (2026-11-09)
- `npm run test:smoke` nach letztem Portable-Rebuild erfolgreich, alle **25** SHA256-Summen (1 App-EXE + 23 Sidecar-Dateien + 1 Config-Template) stimmen.
- Native WebView2-Prüfung mit temporärer Portable-Kopie und absichtlich nicht erreichbarem Loopback-Endpoint/-Proxy: aus fremdem Arbeitsverzeichnis gestartet, relative Config geladen, detaillierte HTTPS- und beide Speech/WSS-Fehler im separaten Dialog sichtbar.
- Dieser CDP-/Playwright-Test wurde ad hoc durchgeführt und ist kein zusätzliches dauerhaftes Smoke-Skript. Er ersetzt weder Aufnahme-End-to-End noch Clean-Machine-Deployment. Der positive Corporate-Proxy-/Azure-Test wurde am 2026-11-12 separat im Firmennetz geführt.
- [Browser-UI-Tests](../tests/startup-ui.test.mjs) (12) prüfen die UI mit Bridge-Mocks; native Erreichbarkeit ist damit nicht nachgewiesen.

## Approach
- Inspiration: `../meeting-notes/scripts/test-smoke-electron.mjs` (Pattern übernehmen).
- Tauri-App-Steuerung via Tauri-CLI oder WebDriver-Integration (offene Entscheidung).
- Timeouts: 10 s für jeden Wait-Step, dann Fail.

## Log
- 2026-06-25: Spec angelegt.