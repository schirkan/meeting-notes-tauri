# T-300: Tauri-Main als Orchestrator

## Kontext
Status: teils umgesetzt (1 Punkt offen)
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
- [ ] App-Crashes oder Sidecar-Crashes führen zu klarer UI-Fehlermeldung. - **offen**: Beleg fehlt: Das Ereignis sidecar:crashed wird bis zum Preload durchgereicht, der Renderer abonniert es aber nicht - im UI erscheint keine Fehlermeldung.

## Approach
- Subtasks T-301 bis T-306 als sequenzielle Kernimplementierung.
- Klare Modulgrenzen: `sidecar.rs` (Spawn + Lifecycle), `commands.rs` (Tauri-Commands), `events.rs` (Tauri-Events), `connectivity.rs` (Diagnose), `settings.rs` (Persistenz).
- Logging von Anfang an strukturiert (tracing oder env_logger).

## Log
- 2026-06-25: Spec angelegt.