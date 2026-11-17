# T-300: Tauri-Main als Orchestrator

## Kontext
Status: umgesetzt
Priorität: high
Subtasks: T-301, T-302, T-303, T-304, T-305, T-306
Abhängigkeiten: T-101

## Goal
Rust-Main-Prozess orchestriert Sidecar-Lifecycle, IPC-Bridge zum Renderer und Settings-Persistenz.

## Done When
- [x] Tauri-Main startet den Sidecar beim App-Start und stoppt ihn beim App-Exit. Beleg: Der Sidecar startet lazy beim Aufnahmebeginn (commands.rs) und wird beim App-Exit beendet (lib.rs, RunEvent::Exit). Abweichung vom Wortlaut - kein Start bei App-Start - ist bewusst: der Prozess wird erst bei Bedarf gestartet.
- [x] Tauri-Commands und Tauri-Events sind vollständig typisiert. Beleg: src-tauri/src/commands.rs und src/shared/tauri-contract.ts.
- [x] Connectivity-Diagnose ist als Tauri-Command verfügbar. Beleg: test_azure_connectivity in commands.rs.
- [x] Settings werden persistent gespeichert. Beleg: src-tauri/src/settings.rs.
- [x] App-Crashes oder Sidecar-Crashes führen zu klarer UI-Fehlermeldung. Beleg: umgesetzt - der Renderer abonniert jetzt `sidecar:crashed` (use-app-state.ts) und zeigt einen persistenten Fehler-Toast mit Exit-Code; Node-UI-Test `a crashed sidecar surfaces a persistent error toast`.

## Approach
- Subtasks T-301 bis T-306 als sequenzielle Kernimplementierung.
- Klare Modulgrenzen: `sidecar.rs` (Spawn + Lifecycle), `commands.rs` (Tauri-Commands), `events.rs` (Tauri-Events), `connectivity.rs` (Diagnose), `settings.rs` (Persistenz).
- Logging von Anfang an strukturiert (tracing oder env_logger).

## Log
- 2026-06-25: Spec angelegt.