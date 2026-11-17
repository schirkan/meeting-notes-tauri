# T-103: Konfiguration (Azure + User-Settings)

## Kontext
Status: umgesetzt
Priorität: high
Abhängigkeiten: T-102

## Goal
Konfigurationsmodell aus `../meeting-notes` übernehmen und in der Windows-Variante verankern: **eine** gemeinsame Konfigurationsdatei (`MeetingNotes.config.json`) mit den Abschnitten `azure` und `user`, direkt neben der EXE.

## Done When
- [x] `MeetingNotes.config.example.json` ist als Vorlage angelegt. Das Template wird von `scripts/dist-portable.mjs` automatisch nach `dist/portable/` übernommen. Beleg: MeetingNotes.config.example.json, scripts/dist-portable.mjs (geprueft).
- [x] `MeetingNotes.config.json` ist in `.gitignore`. Beleg: .gitignore enthaelt den Eintrag MeetingNotes.config.json (geprueft).
- [x] Das Rust-Backend lädt die Config-Datei direkt neben der EXE bzw. im Dev-Build aus dem Repository-Root. Fehlende, nicht lesbare oder unvollständige Azure-Konfiguration öffnet die Einstellungen automatisch und zeigt einen Toast unten. Implementierung in `src-tauri/src/settings.rs` und `src/renderer/src/use-app-state.ts`. Beleg: src-tauri/src/settings.rs, src/renderer/src/use-app-state.ts (geprueft).
- [x] User-Settings werden via Tauri-Command `save_user_settings()` geschrieben. Beleg: src-tauri/src/commands.rs (save_user_settings) und src-tauri/src/settings.rs (atomarer Schreibvorgang).
- [x] `diarization.mic` und `diarization.speaker` werden als unabhängige Boolean-Optionen persistiert und beim nächsten Aufnahmestart an den Sidecar übergeben. Beide sind standardmäßig `true`, auch für alte oder teilweise ergänzte Konfigurationen; explizites `false` bleibt erhalten. Beleg: src/renderer/src/components/SettingsPanel.tsx (diarization.mic), src/renderer/src/components/SettingsPanel.tsx (diarization.speaker), scripts/dist-portable.mjs (false) (geprueft).
- [x] Spracheinstellung wird über Neustarts hinweg persistiert (atomar via temp-file + rename, siehe `settings.rs` Header-Comment). Beleg: src-tauri/src/settings.rs (geprueft).
- [x] Azure-Proxy (`proxy.host`/`proxy.port` + optional `username`/`password`) wird an Aufnahme-Sidecar und beide Diagnosepfade weitergereicht. Host/Port sind CLI-Args; Speech-Key und Proxy-Zugangsdaten werden nur über prozesslokale Umgebungsvariablen übergeben. Beleg: src/renderer/src/config-utils.ts (proxy.host), src/renderer/src/config-utils.ts (proxy.port), sidecar/Program.cs (username) (geprueft).
- [x] `AppConfigState` enthält `exists`, `path` und optional `config`. Der tatsächliche Dateipfad wird vom Rust-Backend geliefert und im Settings-Footer unterhalb der drei Bereiche angezeigt, auch wenn die Datei noch fehlt. Beleg: src/preload/index.ts (AppConfigState), scripts/clean-sidecar.mjs (exists), scripts/dist-portable.mjs (config) (geprueft).
- [x] Settings bestehen aus Allgemein, Azure-Konfiguration und Proxy. Proxy wird gemeinsam mit Azure gespeichert; der Verbindungstest liegt im Azure-Bereich und verwendet auch ungespeicherte Draft-Werte (siehe [T-403](./T-403-settings-dialog-mit-verbindung-testen-button.md)). Beleg: src/renderer/src/components/SettingsDialog.tsx (Tabs Allgemein/Azure/Proxy) und src/renderer/src/components/ProxyPanel.tsx.

## Approach
- Pfade: `MeetingNotes.config.json` direkt neben der EXE (Release/Portable), im Repository-Root (Dev). Keine Migration nach AppData und kein AppData-Fallback.
- Die Abschnitte werden getrennt gelesen und geschrieben: Das Speichern der Azure-Konfiguration verwirft die User-Settings nicht und umgekehrt; ein fehlerhafter Abschnitt verfällt nicht über den anderen.
- Azure-Key bleibt direkt im `speechKey`-Feld (wie in `meeting-notes`). Automatischer Startup-Dialog basiert auf lokaler Pflichtfeld-/Proxy-Validierung, nicht auf einer Live-Prüfung des Keys.
- Legacy-Pfad `azure.fixed.json` ist obsolet und wird in Doku explizit nicht erwähnt.
- Sidecar-CLI: `--diarization-mic true|false` und `--diarization-speaker true|false`. Die Optionen steuern je Quelle Transcriber versus Recognizer; Details siehe [T-205](./T-205-continuous-lid-und-diarization-in-c-sharp.md).
- Konfigurationsnormalisierung und alle vier Boolean-Kombinationen sind in [Unit-Tests](../tests/config-utils.test.mjs) und drei Rust-Tests abgedeckt.

## Log
- 2026-06-25: Spec angelegt.
- 2026-11-09: EXE-/Repository-relative Pfade ohne AppData-Fallback, automatisches Öffnen mit Bottom-Toast, Proxy-Weitergabe und beide Footer-Pfade nachgezogen.