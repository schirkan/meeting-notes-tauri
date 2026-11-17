# T-301: Sidecar-Spawn via tauri-plugin-shell

## Kontext
Status: umgesetzt
Priorität: high
Abhängigkeiten: T-300

## Goal
C#-Sidecar via offizielles Tauri-Shell-Plugin starten, stoppen und überwachen. IPC läuft über `stdin/stdout` (siehe `AD-008`, `T-201`) — Named Pipe entfällt.

## Done When
- [x] `tauri-plugin-shell` ist in `Cargo.toml` und `tauri.conf.json` konfiguriert. Beleg: src-tauri/tauri.conf.json (geprueft).
- [x] Sidecar-Pfad wird je nach Build-Variante korrekt aufgelöst (Dev: `src-tauri/target/sidecar-publish/MeetingNotes.Sidecar.exe`, Prod: Resource-Pfad). Entwicklung nutzt den Manifest-Pfad unabhaengig vom CWD, danach werden Resource-Dir und EXE-Verzeichnis geprueft. Release verwendet keinen Entwicklungs-Sidecar aus dem CWD. Beleg: src-tauri/src/sidecar.rs (resolve_sidecar_path und sidecar_candidates - deckt Portable- und Single-File-Layout ab). Testnachweis: am 2026-11-17 end-to-end verifiziert - beide Layouts (21-Dateien- und Single-File-Portable) gestartet, der Sidecar wurde in beiden gefunden; Rust-Test sidecar_candidates_cover_portable_and_single_file_layouts.
- [x] `start_recording` startet den Sidecar mit nicht geheimen CLI-Args (`--sample-rate`, `--language`, `--speech-region`, `--speech-endpoint`, `--diarization-mic true|false`, `--diarization-speaker true|false`, Device-IDs und bei aktivem Proxy `--proxy-host`/`--proxy-port`). Diarization-Werte stammen aus den gespeicherten User-Settings und gelten für die neue Aufnahme. Speech-Key sowie optionale Proxy-Zugangsdaten stehen nur in den prozesslokalen Variablen `MEETING_NOTES_SPEECH_KEY`, `MEETING_NOTES_PROXY_USERNAME`, `MEETING_NOTES_PROXY_PASSWORD`. App-Aufrufe verwenden keine Credential-CLI-Args und keinen `--pipe-name`. Beleg: src/shared/tauri-contract.ts (start_recording), sidecar/Program.cs (MEETING_NOTES_SPEECH_KEY), sidecar/Program.cs (MEETING_NOTES_PROXY_USERNAME) (geprueft).
- [x] Der Verbindungstest startet einen **separaten** Sidecar mit `--test-connectivity` und derselben Speech-/Proxy-Konfiguration, ohne Audio-Capture oder Zugriff auf den Aufnahmeprozess. Auswertung des `speech_connectivity`-JSON-Lines-Ergebnisses; bei fehlendem Ergebnis werden stderr/Prozessfehler und Exit-Code unter Credential-Redaktion angezeigt. Rust begrenzt den Diagnoseprozess auf 45 s und räumt ihn anschließend auf. Beleg: sidecar/Program.cs (speech_connectivity) (geprueft).
- [x] `tauri::command async fn stop_recording(app: AppHandle) -> Result<TranscriptStatus, String>` beendet den Sidecar sauber (`{"type":"shutdown"}`-JSON-Lines → 250 ms Timeout → `CommandChild::kill`). Beleg: src-tauri/src/commands.rs (#[tauri::command] stop_recording) und src-tauri/src/sidecar.rs (stop).
- [x] Sidecar-Crashes (Exit-Code ≠ 0) werden via Tauri-Event `sidecar:crashed` (`SidecarCrashedPayload { exitCode, lastError? }`) an den Renderer gemeldet. Beleg: src/shared/tauri-contract.ts (sidecar:crashed) (geprueft).
- [x] Der Sidecar-Handle ist als `Arc<Mutex<Option<CommandChild>>>` getypt — `CommandChild` ist in `tauri-plugin-shell` 2.x **nicht Clone**. Der `Arc` erlaubt Orchestrator + Cache geteilten Besitz, das `Option` lässt `CommandChild::kill(self)` weiter konsumieren (via `Option::take()` im `stop`-Pfad). Beleg: src-tauri/src/commands.rs (CommandChild), sidecar/AzureSpeechService.cs (Option) (geprueft).

## Approach
- Tauri-Shell-Plugin-Befehl `Command::new_sidecar("MeetingNotes.Sidecar")`.
- Optional: `app.shell().sidecar(...).args([...])` mit konfigurierbaren CLI-Args.
- Auf Windows: `creation_flags` für `CREATE_NO_WINDOW` setzen, damit der Sidecar keine Console aufpoppen lässt. Sidecar-Stdout/-Stderr werden über `tauri-plugin-shell` in die App geleitet.
- Reconnect-Logik: Wenn der Sidecar unerwartet beendet wird, wird er automatisch neu gestartet (max. 3 Versuche, dann User-Dialog).

## Log
- 2026-06-25: Spec angelegt.