# T-101: Tauri-2-Scaffold mit React und Vite anlegen

## Kontext
Status: draft
Priorität: high
Abhängigkeiten: -

## Goal
Lauffähiges Tauri-2-Projekt mit React-Frontend, das ein leeres Fenster öffnet und einen Stub-Sidecar-Prozess startet.

## Done When
- [ ] `npm create tauri-app@latest` mit Template `react-ts` ausgeführt (oder manuell äquivalent).
- [ ] `src/` (React + Vite) und `src-tauri/` (Rust) sind nebeneinander angelegt.
- [ ] `npm run tauri dev` startet das Fenster.
- [ ] `npm run tauri build` produziert eine MSI- oder NSIS-Installer-Datei.
- [ ] Eine Stub-Rust-Funktion `start_recording()` ist über `tauri::command` aus dem React-Renderer aufrufbar und loggt in die Rust-Konsole.
- [ ] Eine Rust-Funktion `spawn_stub_sidecar()` startet einen Dummy-Prozess (z. B. `cmd /c echo hello`) über das offizielle `tauri-plugin-shell`-Crate.

## Approach
- `tauri.conf.json`: Window-Größe, Identifier (`de.schirkan.meeting-notes-tauri`), Bundle-Identifier, Resources-Verzeichnis für den Sidecar.
- Rust-Crate-Dependencies (Minimum): `tauri = "2"`, `tauri-plugin-shell = "2"`, `serde`, `serde_json`, `tokio` (für Async-Pipes).
- Vite-Config identisch zu `../meeting-notes` (Port 1420 für Tauri-Dev).
- Smoke-Test: `npm run tauri dev` öffnet Fenster, IPC-Roundtrip aus DevTools-Console.

## Log
- 2026-06-25: Spec angelegt.