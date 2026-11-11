# T-305: Settings-Persistenz im Tauri-Main

## Kontext
Status: implemented
Priorität: high
Abhängigkeiten: T-103

## Goal
Azure-Config und User-Settings werden im Tauri-Main (Rust) gelesen und geschrieben.

## Done When
- [x] Beim App-Start wird die gemeinsame Datei `meeting-notes.config.json` geladen (lazy on first command call). Fehlt sie oder ist sie unlesbar, gelten Default-User-Settings und eine leere Azure-Konfiguration.
- [x] `tauri::command save_user_settings(settings)` schreibt den Abschnitt `user` der gemeinsamen Datei atomar (Temp-Datei + Rename) — siehe `src-tauri/src/settings.rs::write_atomic`. Der Abschnitt `azure` bleibt dabei erhalten.
- [x] `tauri::command save_fixed_config(config)` schreibt den Abschnitt `azure` analog und erhält den Abschnitt `user`.
- [x] Settings sind über App-Restarts hinweg persistent.
- [x] Pfade zeigen direkt auf `meeting-notes.config.json` neben der EXE (Release/Portable) bzw. im Repository-Root (Dev). Auflösung unabhängig vom Arbeitsverzeichnis, ohne AppData-Fallback.
- [x] BCP-47-Validierung + Normalisierung der `language` (`is_valid_bcp47` in `settings.rs`).
- [x] `get_app_config()` und `save_fixed_config()` liefern `AppConfigState` mit `exists`, `path` und optional `config`; der Pfad stammt aus derselben Backend-Pfadauflösung.
- [x] `transcript:fixed-config-status` wird beim App-Setup mit `exists` und `path` emittiert (kein `status=missing`-Feld), siehe [T-303](./T-303-tauri-events.md). Der Renderer lädt die Konfiguration zusätzlich unabhängig von Devices/Status; ein anderer Startup-Fehler verhindert das automatische Öffnen nicht.
- [x] Fehlende/nicht lesbare Azure-Datei liefert keine Konfiguration. Unvollständige Draft-Pflichtfelder bzw. ungültiger Proxy-Port führen im Renderer ebenfalls zum automatischen Settings-Dialog mit Bottom-Toast. Dies ist keine Live-Validierung des Azure-Keys.

## Approach
- Crate `serde_json` + `tokio::fs` für asynchrone Datei-Operationen.
- Atomare Writes verhindern korrupte Configs bei Crash mid-write.
- Schema-Validierung gegen TypeScript-`config-contract.ts` (in Rust manuell dupliziert, mittelfristig via `ts-rs` automatisiert).

## Log
- 2026-06-25: Spec angelegt.
- 2026-11-09: Tatsächlichen Config-State-/Event-Vertrag und startupunabhängige Config-Abfrage dokumentiert. Drei fokussierte Rust-Tests für Pfadauflösung und serialisierte Dateipfade erfolgreich; Laden/Speichern im portablen EXE-Verzeichnis auch mit fremdem Arbeitsverzeichnis nativ geprüft.