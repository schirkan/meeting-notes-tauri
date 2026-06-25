# T-301: Sidecar-Spawn via tauri-plugin-shell

## Kontext
Status: draft
Priorität: high
Abhängigkeiten: T-300

## Goal
C#-Sidecar via offizielles Tauri-Shell-Plugin starten, stoppen und überwachen. IPC läuft über `stdin/stdout` (siehe `AD-008`, `T-201`) — Named Pipe entfällt.

## Done When
- [ ] `tauri-plugin-shell` ist in `Cargo.toml` und `tauri.conf.json` konfiguriert.
- [ ] Sidecar-Pfad wird je nach Build-Variante korrekt aufgelöst (Dev: `sidecar/publish/sidecar/MeetingNotes.Sidecar.exe`, Prod: Resource-Pfad via `tauri::api::path::resource_dir()`).
- [ ] `tauri::command async fn start_sidecar(app: AppHandle) -> Result<(), String>` startet den Sidecar und übergibt CLI-Args (`--sample-rate`, `--log-level`). **Kein `--pipe-name`-Arg mehr** — Named Pipe entfällt (siehe `AD-008`, `T-201`).
- [ ] `tauri::command async fn stop_sidecar() -> Result<(), String>` beendet den Sidecar sauber (SIGTERM → 5 s Timeout → SIGKILL).
- [ ] Sidecar-Crashes (Exit-Code ≠ 0) werden via Tauri-Event `sidecar:crashed` an den Renderer gemeldet.

## Approach
- Tauri-Shell-Plugin-Befehl `Command::new_sidecar("MeetingNotes.Sidecar")`.
- Optional: `app.shell().sidecar(...).args([...])` mit konfigurierbaren CLI-Args.
- Auf Windows: `creation_flags` für `CREATE_NO_WINDOW` setzen, damit der Sidecar keine Console aufpoppen lässt. Sidecar-Stdout/-Stderr werden über `tauri-plugin-shell` in die App geleitet.
- Reconnect-Logik: Wenn der Sidecar unerwartet beendet wird, wird er automatisch neu gestartet (max. 3 Versuche, dann User-Dialog).

## Log
- 2026-06-25: Spec angelegt.