# T-300: Tauri-Main als Orchestrator

## Kontext
Status: teils umgesetzt (Single-Instance implementiert, native Abnahme offen)
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
- [x] App-Crashes oder Sidecar-Crashes führen zu klarer UI-Fehlermeldung. Beleg: Renderer abonniert `sidecar:crashed` (use-app-state.ts), zeigt einen persistenten Fehler-Toast mit Exit-Code und erlaubt manuellen Start einer neuen Sitzung. Testnachweis: `a crashed sidecar surfaces a persistent error toast and allows a new recording`; Rust-Tests `stopped_or_replaced_sidecar_cannot_affect_the_current_session` und `restarting_after_stop_requires_a_new_handshake`.

## Approach
- Subtasks T-301 bis T-306 als sequenzielle Kernimplementierung.
- Klare Modulgrenzen: `sidecar.rs` (Spawn + Lifecycle), `commands.rs` (Tauri-Commands), `events.rs` (Tauri-Events), `connectivity.rs` (Diagnose), `settings.rs` (Persistenz).
- Logging von Anfang an strukturiert (tracing oder env_logger).

## Native Abnahme
- [ ] Doppelstart unter Windows prüfen: Der zweite Start endet und holt das vorhandene Fenster auch aus dem Tray oder minimierten Zustand zurück. Aufnahme und Meeting-Detektor laufen unverändert in der ersten Instanz. - **offen**: Die native Prüfung benötigt einen Windows-Build. Laut Nutzer blockiert der lokale Virenscanner das Linken der App-EXE; `cargo check` scheiterte bereits am Sidecar-Publish (MSBuild: Zugriff verweigert).

## Log
- 2026-11-24: Single-Instance-Plugin als erstes Tauri-Plugin registriert; ein erneuter Start aktiviert das vorhandene Fenster über denselben Pfad wie der Tray.
- 2026-11-17: Permanenten UI-Startblocker nach Sidecar-Crash entfernt. Crash setzt Aufnahme/Pause zurueck, vorhandenes Transkript bleibt bis zum naechsten Start erhalten. Der manuelle Start erzeugt eine neue Sitzung; kein automatischer Reconnect. Rust entfernt das tote Handle, verwirft Events/Timeouts alter Prozesse und setzt den Handshake bei Stop zurueck. Absichtliches Stoppen meldet keinen Crash mehr.
- 2026-06-25: Spec angelegt.