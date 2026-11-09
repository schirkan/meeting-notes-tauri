# T-301: Sidecar-Spawn via tauri-plugin-shell

## Kontext
Status: implemented
Priorität: high
Abhängigkeiten: T-300

## Goal
C#-Sidecar via offizielles Tauri-Shell-Plugin starten, stoppen und überwachen. IPC läuft über `stdin/stdout` (siehe `AD-008`, `T-201`) — Named Pipe entfällt.

## Done When
- [x] `tauri-plugin-shell` ist in `Cargo.toml` und `tauri.conf.json` konfiguriert.
- [x] Sidecar-Pfad wird je nach Build-Variante korrekt aufgelöst (Dev: `sidecar/publish/sidecar/MeetingNotes.Sidecar.exe`, Prod: Resource-Pfad via `tauri::api::path::resource_dir()`). `resolve_sidecar_path` durchsucht CWD-relativ, Resource-Dir und EXE-Verzeichnis in dieser Reihenfolge.
- [x] `start_recording` startet den Sidecar mit nicht geheimen CLI-Args (`--sample-rate`, `--language`, `--speech-region`, `--speech-endpoint`, `--diarization-mic true|false`, `--diarization-speaker true|false`, Device-IDs und bei aktivem Proxy `--proxy-host`/`--proxy-port`). Diarization-Werte stammen aus den gespeicherten User-Settings und gelten für die neue Aufnahme. Speech-Key sowie optionale Proxy-Zugangsdaten stehen nur in den prozesslokalen Variablen `MEETING_NOTES_SPEECH_KEY`, `MEETING_NOTES_PROXY_USERNAME`, `MEETING_NOTES_PROXY_PASSWORD`. App-Aufrufe verwenden keine Credential-CLI-Args und keinen `--pipe-name`.
- [x] Der Verbindungstest startet einen **separaten** Sidecar mit `--test-connectivity` und derselben Speech-/Proxy-Konfiguration, ohne Audio-Capture oder Zugriff auf den Aufnahmeprozess. Auswertung des `speech_connectivity`-JSON-Lines-Ergebnisses; bei fehlendem Ergebnis werden stderr/Prozessfehler und Exit-Code unter Credential-Redaktion angezeigt. Rust begrenzt den Diagnoseprozess auf 45 s und räumt ihn anschließend auf.
- [x] `tauri::command async fn stop_recording(app: AppHandle) -> Result<TranscriptStatus, String>` beendet den Sidecar sauber (`{"type":"shutdown"}`-JSON-Lines → 250 ms Timeout → `CommandChild::kill`).
- [x] Sidecar-Crashes (Exit-Code ≠ 0) werden via Tauri-Event `sidecar:crashed` (`SidecarCrashedPayload { exitCode, lastError? }`) an den Renderer gemeldet.
- [x] Der Sidecar-Handle ist als `Arc<Mutex<Option<CommandChild>>>` getypt — `CommandChild` ist in `tauri-plugin-shell` 2.x **nicht Clone**. Der `Arc` erlaubt Orchestrator + Cache geteilten Besitz, das `Option` lässt `CommandChild::kill(self)` weiter konsumieren (via `Option::take()` im `stop`-Pfad).

## Approach
- Tauri-Shell-Plugin-Befehl `Command::new_sidecar("MeetingNotes.Sidecar")`.
- Optional: `app.shell().sidecar(...).args([...])` mit konfigurierbaren CLI-Args.
- Auf Windows: `creation_flags` für `CREATE_NO_WINDOW` setzen, damit der Sidecar keine Console aufpoppen lässt. Sidecar-Stdout/-Stderr werden über `tauri-plugin-shell` in die App geleitet.
- Reconnect-Logik: Wenn der Sidecar unerwartet beendet wird, wird er automatisch neu gestartet (max. 3 Versuche, dann User-Dialog).

## Log
- 2026-06-25: Spec angelegt.