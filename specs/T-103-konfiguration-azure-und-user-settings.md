# T-103: Konfiguration (Azure + User-Settings)

## Kontext
Status: implemented
Priorität: high
Abhängigkeiten: T-102

## Goal
Konfigurationsmodell aus `../meeting-notes` übernehmen und in der Tauri-Variante verankern: fest verdrahtete Azure-Config (`config/azure.json`) + persistente User-Settings (`config/user-settings.json`).

## Done When
- [x] `config/azure.example.json` und `config/user-settings.example.json` sind analog zu `../meeting-notes/config/` angelegt. Die Templates werden von `scripts/dist-portable.mjs` automatisch in `dist/portable/config/` übernommen.
- [x] `config/azure.json` und `config/user-settings.json` sind in `.gitignore`.
- [x] Tauri-Main lädt beide Config-Dateien direkt aus dem relativen `config/`-Ordner neben der EXE bzw. im Dev-Build aus dem Repository. Fehlende, nicht lesbare oder unvollständige Azure-Konfiguration öffnet die Einstellungen automatisch und zeigt einen Toast unten. Implementierung in `src-tauri/src/settings.rs` und `src/renderer/src/use-app-state.ts`.
- [x] User-Settings werden via Tauri-Command `save_user_settings()` geschrieben.
- [x] Spracheinstellung wird über Neustarts hinweg persistiert (atomar via temp-file + rename, siehe `settings.rs` Header-Comment).
- [x] Azure-Proxy (`proxy.host`/`proxy.port` + optional `username`/`password`) wird an Aufnahme-Sidecar und beide Diagnosepfade weitergereicht. Host/Port sind CLI-Args; Speech-Key und Proxy-Zugangsdaten werden nur über prozesslokale Umgebungsvariablen übergeben.
- [x] `AzureConfigState` enthält `exists`, `path`, `userSettingsPath` und optional `config`. Beide tatsächlichen Dateipfade werden vom Rust-Backend geliefert und im Settings-Footer unterhalb der drei Bereiche angezeigt, auch wenn die Azure-Datei noch fehlt.
- [x] Settings bestehen aus Allgemein, Azure-Konfiguration und Proxy. Proxy wird gemeinsam mit Azure gespeichert; der Verbindungstest liegt im Azure-Bereich und verwendet auch ungespeicherte Draft-Werte (siehe [T-403](./T-403-settings-dialog-mit-verbindung-testen-button.md)).

## Approach
- Pfade: `config/` neben der EXE (Release/Portable), neben den Templates im Repository (Dev). Keine Migration nach AppData und kein AppData-Fallback.
- Azure-Key bleibt direkt im `speechKey`-Feld (wie in `meeting-notes`). Automatischer Startup-Dialog basiert auf lokaler Pflichtfeld-/Proxy-Validierung, nicht auf einer Live-Prüfung des Keys.
- Legacy-Pfad `azure.fixed.json` ist obsolet und wird in Doku explizit nicht erwähnt.

## Log
- 2026-06-25: Spec angelegt.
- 2026-11-09: EXE-/Repository-relative Pfade ohne AppData-Fallback, automatisches Öffnen mit Bottom-Toast, Proxy-Weitergabe und beide Footer-Pfade nachgezogen.