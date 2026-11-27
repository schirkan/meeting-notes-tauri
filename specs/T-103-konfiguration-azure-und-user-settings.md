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
- [x] Das Rust-Backend laedt die Config-Datei neben der EXE bzw. im Dev-Build aus dem Repository-Root. Die UI meldet eine fehlende oder unvollstaendige Konfiguration beim Start, wenn das gewaehlte Live-Modell sie benoetigt (siehe [T-403](./T-403-settings-dialog-mit-verbindung-testen-button.md)). Beleg: src-tauri/src/settings.rs und src/renderer/src/use-app-state.ts.
- [x] User-Settings werden via Tauri-Command `save_user_settings()` geschrieben. Beleg: src-tauri/src/commands.rs (save_user_settings) und src-tauri/src/settings.rs (atomarer Schreibvorgang).
- [x] `user.diarization` ist ein gemeinsamer Boolean (Default `true`). Alte Objekte mit `mic` und `speaker` werden per ODER migriert, wobei fehlende Felder `true` sind. `user.autoLanguageDetection` ist standardmaessig `true`. Beleg: [config-contract.ts](../src/shared/config-contract.ts), [settings.rs](../src-tauri/src/settings.rs) und [config-utils.test.mjs](../tests/config-utils.test.mjs).
- [x] Datei-Modelloptionen werden getrennt unter `user.fileTranscription` gespeichert. Der optionale `azure.batchEndpoint` ersetzt nicht `azure.endpoint`; Verhalten und Altdateien siehe [T-525](./T-525-batch-transkription-und-lokale-aufnahme.md). Beleg: [Beispielconfig](../MeetingNotes.config.example.json), [settings.rs](../src-tauri/src/settings.rs) und [batch.rs](../src-tauri/src/batch.rs).
- [x] Spracheinstellung wird über Neustarts hinweg persistiert (atomar via temp-file + rename, siehe `settings.rs` Header-Comment). Beleg: src-tauri/src/settings.rs (geprueft).
- [x] Azure-Proxy (`proxy.host`/`proxy.port` + optional `username`/`password`) wird an Aufnahme-Sidecar und beide Diagnosepfade weitergereicht. Host/Port sind CLI-Args; Speech-Key und Proxy-Zugangsdaten werden nur über prozesslokale Umgebungsvariablen übergeben. Beleg: src/renderer/src/config-utils.ts (proxy.host), src/renderer/src/config-utils.ts (proxy.port), sidecar/Program.cs (username) (geprueft).
- [x] `AppConfigState` enthaelt `exists`, `path` und optional `config`. Der Dateipfad wird vom Rust-Backend geliefert und im Settings-Footer angezeigt, auch wenn die Datei noch fehlt. Beleg: [settings.rs](../src-tauri/src/settings.rs) und [SettingsDialog.tsx](../src/renderer/src/components/SettingsDialog.tsx).
- [x] Settings bestehen aus Allgemein, Transkription, Azure und Proxy auf einer scrollenden Seite. Audiooptionen stehen nur auf der Startseite und speichern sofort; der Dialog hat einen eigenen temporaeren Store und persistiert nur ueber **Speichern**. Verbindungstest im Footer verwendet auch ungespeicherte Draft-Werte; Schliessen prueft Pending Changes (siehe [T-403](./T-403-settings-dialog-mit-verbindung-testen-button.md)). Beleg: App.tsx, SettingsPanel.tsx und use-app-state.ts; aktuelle Nachweise in T-403.

## Approach
- Pfade: `MeetingNotes.config.json` direkt neben der EXE (Release/Portable), im Repository-Root (Dev). Keine Migration nach AppData und kein AppData-Fallback.
- Die Abschnitte werden getrennt gelesen und geschrieben: Das Speichern der Azure-Konfiguration verwirft die User-Settings nicht und umgekehrt; ein fehlerhafter Abschnitt verfällt nicht über den anderen.
- Azure-Key bleibt direkt im `speechKey`-Feld (wie in `meeting-notes`). Automatischer Startup-Dialog basiert auf lokaler Pflichtfeld-/Proxy-Validierung, nicht auf einer Live-Prüfung des Keys.
- `azure.model` ist optional (`standard` bei fehlendem Feld oder `mai-transcribe-2-streaming`); unbekannte Werte machen den Azure-Abschnitt ungueltig. MAI verwendet Region und Key ohne Standard-Endpunkt. Ein vorhandener Endpunkt bleibt beim Modellwechsel gespeichert. Details siehe [T-520](./T-520-mai-transcribe-streaming-feature.md).
- Legacy-Pfad `azure.fixed.json` ist obsolet und wird in Doku explizit nicht erwähnt.
- `user.transcription.audioMode` ist optional (`dual-mono` als Standard, `stereo` als Opt-in). Fehlende und ungueltige Werte fallen auf `dual-mono` zurueck; andere Optionen bleiben erhalten. Bei einer Quelle bleibt der gespeicherte Wert erhalten, verwendet wird aber Mono. Details siehe [T-521](./T-521-mai-transcribe-mehrkanal-sidecar.md).
- **Breaking Change ab v0.1.9:** `user.diarization` wird als Boolean gespeichert. v0.1.8 und aelter koennen nach dem Speichern den gesamten `user`-Abschnitt verwerfen und Standardwerte verwenden. Rollback ist nicht vorgesehen; alte Config bei Bedarf vor dem Upgrade sichern. Unbrauchbare Werte in `user.autoLanguageDetection` verwenden nur fuer dieses Feld den Standard `true`; andere Settings bleiben erhalten. Beleg: Rust-Regression `invalid_auto_language_detection_preserves_other_user_settings`.
- Sidecar-CLI: `--diarization-mic` und `--diarization-speaker` erhalten denselben Wert. `--auto-language-detection` und `--interim-results` uebertragen die SDK-Optionen; `azure.interimResults` bleibt im Azure-Abschnitt. Grenzen siehe [T-205](./T-205-continuous-lid-und-diarization-in-c-sharp.md).
- Konfigurationsnormalisierung und alle vier Boolean-Kombinationen sind in [Unit-Tests](../tests/config-utils.test.mjs) und drei Rust-Tests abgedeckt.

## Log
- 2026-06-25: Spec angelegt.
- 2026-11-09: EXE-/Repository-relative Pfade ohne AppData-Fallback, automatisches Öffnen mit Bottom-Toast, Proxy-Weitergabe und beide Footer-Pfade nachgezogen.