# T-305: Settings-Persistenz im Tauri-Main

## Kontext
Status: umgesetzt
Priorität: high
Abhängigkeiten: T-103

## Goal
Azure-Config und User-Settings werden im Tauri-Main (Rust) gelesen und geschrieben.

## Done When
- [x] Beim App-Start wird die gemeinsame Datei `MeetingNotes.config.json` geladen (lazy on first command call). Fehlt sie oder ist sie unlesbar, gelten Default-User-Settings und eine leere Azure-Konfiguration. Beleg: src-tauri/src/settings.rs (laden beim ersten Zugriff) und src-tauri/src/commands.rs.
- [x] `tauri::command save_user_settings(settings)` schreibt den Abschnitt `user` der gemeinsamen Datei atomar (Temp-Datei + Rename) — siehe `src-tauri/src/settings.rs::write_atomic`. Der Abschnitt `azure` bleibt dabei erhalten. Beleg: src-tauri/src/settings.rs (write_atomic), scripts/measure-latency-tauri.mjs (azure) (geprueft).
- [x] `tauri::command save_fixed_config(config)` schreibt den Abschnitt `azure` analog und erhält den Abschnitt `user`. Beleg: scripts/measure-latency-tauri.mjs (azure) (geprueft).
- [x] Settings sind über App-Restarts hinweg persistent. Beleg: src-tauri/src/settings.rs (atomarer Schreibvorgang ueber Temp-Datei + Rename); Roundtrip ueber Node-Tests abgedeckt.
- [x] Pfade zeigen direkt auf `MeetingNotes.config.json` neben der EXE (Release/Portable) bzw. im Repository-Root (Dev). Auflösung unabhängig vom Arbeitsverzeichnis, ohne AppData-Fallback. Beleg: src-tauri/src/settings.rs (Config neben der EXE bzw. im Repository-Root im Dev-Build).
- [x] BCP-47-Validierung + Normalisierung der `language` (`is_valid_bcp47` in `settings.rs`). Beleg: sidecar/AzureSpeechService.cs (language), src-tauri/src/settings.rs (is_valid_bcp47), src-tauri/src/settings.rs (geprueft).
- [x] `get_app_config()` und `save_fixed_config()` liefern `AppConfigState` mit `exists`, `path` und optional `config`; der Pfad stammt aus derselben Backend-Pfadauflösung. Beleg: src/preload/index.ts (AppConfigState), scripts/clean-sidecar.mjs (exists), scripts/dist-portable.mjs (config) (geprueft).
- [x] `transcript:fixed-config-status` wird beim App-Setup mit `exists` und `path` emittiert (kein `status=missing`-Feld), siehe [T-303](./T-303-tauri-events.md). Der Renderer lädt die Konfiguration zusätzlich unabhängig von Devices/Status; ein anderer Startup-Fehler verhindert das automatische Öffnen nicht. Beleg: scripts/clean-sidecar.mjs (exists) (geprueft).
- [x] Eine fehlende/nicht lesbare Datei liefert keine Azure-Konfiguration. Fehlen Pflichtfelder fuer das gewaehlte Azure-Live-Modell, meldet der Renderer dies beim Start; der lokale Recorder braucht diese Felder nicht. Dies validiert keinen Azure-Key. Beleg: [settings.rs](../src-tauri/src/settings.rs) und [use-app-state.ts](../src/renderer/src/use-app-state.ts).

## Approach
- Crate `serde_json` + `tokio::fs` für asynchrone Datei-Operationen.
- Atomare Writes verhindern korrupte Configs bei Crash mid-write.
- Schema-Validierung gegen TypeScript-`config-contract.ts` (in Rust manuell dupliziert, mittelfristig via `ts-rs` automatisiert).

## Log
- 2026-06-25: Spec angelegt.
- 2026-11-09: Tatsächlichen Config-State-/Event-Vertrag und startupunabhängige Config-Abfrage dokumentiert. Drei fokussierte Rust-Tests für Pfadauflösung und serialisierte Dateipfade erfolgreich; Laden/Speichern im portablen EXE-Verzeichnis auch mit fremdem Arbeitsverzeichnis nativ geprüft.