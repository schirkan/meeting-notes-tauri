# T-101: Tauri-2-Scaffold mit React und Vite anlegen

## Kontext
Status: teils umgesetzt (1 Punkt offen)
Priorität: high
Abhängigkeiten: -

## Goal
Lauffähiges Tauri-2-Projekt mit React-Frontend, das ein leeres Fenster öffnet und einen Stub-Sidecar-Prozess startet.

## Done When
- [x] `npm create tauri-app@latest` mit Template `react-ts` ausgeführt (oder manuell äquivalent). Manuell aequivalent ausgefuehrt.
- [x] `src/` (React + Vite) und `src-tauri/` (Rust) sind nebeneinander angelegt. Beleg: src/ und src-tauri/ liegen nebeneinander.
- [x] `npm run tauri dev` startet das Fenster. Beleg: npm run tauri dev startet das Fenster.
- [ ] `npm run tauri build` produziert eine MSI- oder NSIS-Installer-Datei. - **offen**: Installer (MSI/NSIS) wurden bewusst nicht gebaut; der Lieferweg ist die Portable-Distribution (siehe README).
- [x] Eine Stub-Rust-Funktion `start_recording()` ist über `tauri::command` aus dem React-Renderer aufrufbar und loggt in der Rust-Konsole. Beleg: in der echten Implementierung erfüllt - `start_recording` ist ein `#[tauri::command]` (commands.rs), schreibt `start_recording aufgerufen.` in den Debug-Stream und wird aus dem Renderer über die Preload-Bridge (`invoke(start_recording)`) aufgerufen. Ein Stub ist nicht mehr nötig.
- [x] Eine Rust-Funktion `spawn_stub_sidecar()` startet einen Dummy-Prozess (z. B. `cmd /c echo hello`) über das offizielle `tauri-plugin-shell`-Crate. Beleg: in der echten Implementierung erfüllt - `sidecar::start` startet den tatsächlichen Sidecar über `tauri-plugin-shell` (`ShellExt`, `app.shell().command(...)`, `CommandEvent`). Der Dummy-Prozess ist entfallen.

## Release-DevTools (Fortschreibung 2026-11-09)
- [x] F12 öffnet/schließt WebView2-DevTools auch im Release-/Portable-Build: Tauri-Feature `devtools`, registrierter `toggle_devtools`-Command und Frontend-Key-Handler.
- [x] Im nativen portablen Build geprüft; unabhängig von Vite-Dev-Modus. Dies bestätigt nicht automatisch die übrigen offenen Scaffold-Kriterien.

## Approach
- `tauri.conf.json`: Window-Größe, Identifier (`de.schirkan.meeting-notes`), Bundle-Identifier, Resources-Verzeichnis für den Sidecar. Product-Name und Fenstertitel lauten `Meeting Notes` — „Tauri" ist Technikbezeichnung, kein Produktname.
- Rust-Crate-Dependencies (Minimum): `tauri = "2"`, `tauri-plugin-shell = "2"`, `serde`, `serde_json`, `tokio` (für Async-Pipes).
- Vite-Config identisch zu `../meeting-notes` (Port 1420 für Tauri-Dev).
- Smoke-Test: `npm run tauri dev` öffnet Fenster, IPC-Roundtrip aus DevTools-Console.

## Log
- 2026-06-25: Spec angelegt.