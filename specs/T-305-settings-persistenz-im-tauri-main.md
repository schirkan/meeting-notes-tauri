# T-305: Settings-Persistenz im Tauri-Main

## Kontext
Status: implemented
Priorität: high
Abhängigkeiten: T-103

## Goal
Azure-Config und User-Settings werden im Tauri-Main (Rust) gelesen und geschrieben.

## Done When
- [x] Beim App-Start: `config/azure.json` und `config/user-settings.json` werden parallel geladen (lazy on first command call; Default-UserSettings werden zurückgegeben, wenn `user-settings.json` fehlt oder ungültig ist).
- [x] `tauri::command save_user_settings(settings)` schreibt `config/user-settings.json` atomar (Temp-Datei + Rename) — siehe `src-tauri/src/settings.rs::write_atomic`.
- [x] `tauri::command save_fixed_config(config)` schreibt `config/azure.json` analog.
- [x] Settings sind über App-Restarts hinweg persistent.
- [x] Pfade werden via `tauri::Manager::path::app_config_dir()` aufgelöst (Plattform-übergreifend korrekt).
- [x] BCP-47-Validierung + Normalisierung der `language` (`is_valid_bcp47` in `settings.rs`).
- [ ] Bei Fehlender Azure-Datei: Tauri-Event `transcript:fixed-config-status` mit `status=missing` emittiert — **offen**, siehe T-303.

## Approach
- Crate `serde_json` + `tokio::fs` für asynchrone Datei-Operationen.
- Atomare Writes verhindern korrupte Configs bei Crash mid-write.
- Schema-Validierung gegen TypeScript-`config-contract.ts` (in Rust manuell dupliziert, mittelfristig via `ts-rs` automatisiert).

## Log
- 2026-06-25: Spec angelegt.