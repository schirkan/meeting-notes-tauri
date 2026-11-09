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
- [x] Pfade zeigen direkt auf `config/` neben der EXE (Release/Portable) bzw. im Repository (Dev). Auflösung unabhängig vom Arbeitsverzeichnis, ohne AppData-Fallback.
- [x] BCP-47-Validierung + Normalisierung der `language` (`is_valid_bcp47` in `settings.rs`).
- [x] `get_fixed_config()` und `save_fixed_config()` liefern `AzureConfigState` mit `exists`, `path`, `userSettingsPath` und optional `config`; beide Pfade stammen aus derselben Backend-Pfadauflösung.
- [x] `transcript:fixed-config-status` wird beim App-Setup mit `exists` und `path` emittiert (kein `status=missing`-Feld), siehe [T-303](./T-303-tauri-events.md). Der Renderer lädt die Konfiguration zusätzlich unabhängig von Devices/Status; ein anderer Startup-Fehler verhindert das automatische Öffnen nicht.
- [x] Fehlende/nicht lesbare Azure-Datei liefert keine Konfiguration. Unvollständige Draft-Pflichtfelder bzw. ungültiger Proxy-Port führen im Renderer ebenfalls zum automatischen Settings-Dialog mit Bottom-Toast. Dies ist keine Live-Validierung des Azure-Keys.

## Approach
- Crate `serde_json` + `tokio::fs` für asynchrone Datei-Operationen.
- Atomare Writes verhindern korrupte Configs bei Crash mid-write.
- Schema-Validierung gegen TypeScript-`config-contract.ts` (in Rust manuell dupliziert, mittelfristig via `ts-rs` automatisiert).

## Log
- 2026-06-25: Spec angelegt.
- 2026-11-09: Tatsächlichen Config-State-/Event-Vertrag und startupunabhängige Config-Abfrage dokumentiert. Drei fokussierte Rust-Tests für Pfadauflösung und serialisierte Dateipfade erfolgreich; Laden/Speichern im portablen EXE-Verzeichnis auch mit fremdem Arbeitsverzeichnis nativ geprüft.