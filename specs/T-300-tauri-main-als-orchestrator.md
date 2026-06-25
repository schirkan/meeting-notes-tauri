# T-300: Tauri-Main als Orchestrator

## Kontext
Status: draft
Priorität: high
Subtasks: T-301, T-302, T-303, T-304, T-305, T-306
Abhängigkeiten: T-101

## Goal
Rust-Main-Prozess orchestriert Sidecar-Lifecycle, IPC-Bridge zum Renderer und Settings-Persistenz.

## Done When
- [ ] Tauri-Main startet den Sidecar beim App-Start und stoppt ihn beim App-Exit.
- [ ] Tauri-Commands und Tauri-Events sind vollständig typisiert.
- [ ] Connectivity-Diagnose ist als Tauri-Command verfügbar.
- [ ] Settings werden persistent gespeichert.
- [ ] App-Crashes oder Sidecar-Crashes führen zu klarer UI-Fehlermeldung.

## Approach
- Subtasks T-301 bis T-306 als sequenzielle Kernimplementierung.
- Klare Modulgrenzen: `sidecar.rs` (Spawn + Lifecycle), `commands.rs` (Tauri-Commands), `events.rs` (Tauri-Events), `connectivity.rs` (Diagnose), `settings.rs` (Persistenz).
- Logging von Anfang an strukturiert (tracing oder env_logger).

## Log
- 2026-06-25: Spec angelegt.