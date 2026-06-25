# T-305: Settings-Persistenz im Tauri-Main

## Kontext
Status: draft
Priorität: high
Abhängigkeiten: T-103

## Goal
Azure-Config und User-Settings werden im Tauri-Main (Rust) gelesen und geschrieben.

## Done When
- [ ] Beim App-Start: `config/azure.json` und `config/user-settings.json` werden parallel geladen.
- [ ] Bei Fehlender Azure-Datei: Tauri-Event `transcript:fixed-config-status` mit `status=missing` emittiert.
- [ ] `tauri::command save_user_settings(settings)` schreibt `config/user-settings.json` atomar (Temp-Datei + Rename).
- [ ] `tauri::command save_fixed_config(config)` schreibt `config/azure.json` analog.
- [ ] Settings sind über App-Restarts hinweg persistent.
- [ ] Pfade werden via `tauri::api::path::app_config_dir()` aufgelöst (Plattform-übergreifend korrekt).

## Approach
- Crate `serde_json` + `tokio::fs` für asynchrone Datei-Operationen.
- Atomare Writes verhindern korrupte Configs bei Crash mid-write.
- Schema-Validierung gegen TypeScript-`config-contract.ts` (in Rust manuell dupliziert, mittelfristig via `ts-rs` automatisiert).

## Log
- 2026-06-25: Spec angelegt.