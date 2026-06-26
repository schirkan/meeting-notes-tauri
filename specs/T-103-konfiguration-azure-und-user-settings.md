# T-103: Konfiguration (Azure + User-Settings)

## Kontext
Status: draft
Priorität: high
Abhängigkeiten: T-102

## Goal
Konfigurationsmodell aus `../meeting-notes` übernehmen und in der Tauri-Variante verankern: fest verdrahtete Azure-Config (`config/azure.json`) + persistente User-Settings (`config/user-settings.json`).

## Done When
- [x] `config/azure.example.json` und `config/user-settings.example.json` sind analog zu `../meeting-notes/config/` angelegt. Die Templates werden von `scripts/dist-portable.mjs` automatisch in `dist/portable/config/` übernommen.
- [x] `config/azure.json` und `config/user-settings.json` sind in `.gitignore`.
- [x] Tauri-Main lädt beide Config-Dateien beim Start über `app_config_dir()` (Fehler beim Lesen der Azure-Datei → klare UI-Meldung „Azure nicht konfiguriert"). Implementierung in `src-tauri/src/settings.rs`.
- [x] User-Settings werden via Tauri-Command `save_user_settings()` geschrieben.
- [x] Spracheinstellung wird über Neustarts hinweg persistiert (atomar via temp-file + rename, siehe `settings.rs` Header-Comment).
- [x] Azure-Proxy (`proxy.host`/`proxy.port` + optional `username`/`password`) wird an den Sidecar weitergereicht (CLI-Args bei `start_recording`).

## Approach
- Pfade: `$APPDATA/de.schirkan.meeting-notes-tauri/` (Tauri-Standard über `tauri::api::path::app_config_dir()`) oder relative Pfade zum EXE — Entscheidung in Implementierung.
- Azure-Key bleibt direkt im `speechKey`-Feld (wie in `meeting-notes`).
- Legacy-Pfad `azure.fixed.json` ist obsolet und wird in Doku explizit nicht erwähnt.

## Log
- 2026-06-25: Spec angelegt.