# T-205: Continuous Language Identification (LID) und Diarization in C#

## Kontext
Status: umgesetzt
Priorität: high
Abhängigkeiten: T-204

## Goal
Continuous LID und Speaker-Diarization in der C#-Recognizer-Konfiguration aktivieren und in Segment-Events weiterreichen.

## Done When
- [x] Bei aktivierter automatischer Spracherkennung im Standard-Mono-Pfad werden `LanguageIdMode = Continuous` und AutoDetect-Kandidaten konfiguriert. Reales Continuous-LID-Verhalten bleibt zu validieren. Beleg: [AzureSpeechService.cs](../sidecar/AzureSpeechService.cs) und [SpeechConfiguration.cs](../sidecar/SpeechConfiguration.cs).
- [x] Erkannte Sprache wird im optionalen Segmentfeld `language` mitgefuehrt, nicht `detectedLanguage`. Beleg: language-Feld in src/shared/transcript-contract.ts und im Sidecar-Payload.
- [x] `user.diarization` waehlt bei Azure Standard fuer alle aktiven Quellen `ConversationTranscriber` (aktiviert) oder `SpeechRecognizer` (deaktiviert). Alte per-Quelle gespeicherte Optionen werden beim Laden migriert. Beleg: [T-103](./T-103-konfiguration-azure-und-user-settings.md), [LiveModelPanel.tsx](../src/renderer/src/components/LiveModelPanel.tsx) und [AzureSpeechService.cs](../sidecar/AzureSpeechService.cs).
- [x] Bei aktivierter Sprechererkennung werden SDK-Speaker-IDs für Mic und Speaker unverändert im Segmentfeld `speaker` weitergegeben, für Interim und Final; fehlende IDs werden `unknown`. Bei deaktivierter Sprechererkennung heißen die IDs `self` (Mic) bzw. `guest` (Speaker). Beleg: scripts/measure-latency-tauri.mjs (speaker), sidecar/AzureSpeechService.cs (unknown), sidecar/AzureSpeechService.cs (guest) (geprueft).
- [x] Das SDK-Property für Intermediate-Diarization ist mit Speech SDK 1.53 verifiziert und im Transcriber-Pfad konfiguriert. Beleg: src-tauri/src/settings.rs (diarization) und sidecar/SpeechConfiguration.cs - die Diarization wird ueber EffectiveDiarization je Quelle aktiviert.
- [x] Die UI verwendet quellenspezifische Identitäten und 30 zyklische Farbslots; nummerierte Mic-IDs erhalten einen Offset von 15. Siehe [T-404](./T-404-speaker-mapping-auto-scroll-focus-trap.md). Beleg: src/renderer/src/speaker-utils.ts (30 Farbslots, je Quelle eigene Palette) und src/shared/transcript-contract.ts (source im Identitaetsschluessel).
- [x] Diarization unterscheidet mindestens zwei Sprecher je aktivierter Quelle im Live-Azure-Test. Beleg: Nutzerabnahme vom 28.11.2026; kein separater Nachweis fuer Continuous LID.

## Approach
- Persistenz: `diarization: true` in User-Settings. Speichern wirkt beim nächsten Aufnahmestart, nicht auf eine laufende Sitzung.
- Transport zum Sidecar: `--diarization-mic true|false` und `--diarization-speaker true|false`.
- API-Mapping C#:
  - `AutoDetectSourceLanguageConfig.FromLanguages(...)` für AutoDetect.
  - `SpeechConfig.SetProperty(PropertyId.SpeechServiceConnection_LanguageIdMode, "Continuous")`.
  - `ConversationTranscriber` für jede Quelle mit aktivierter Sprechererkennung, sonst `SpeechRecognizer`; Start/Stop und Event-Verarbeitung folgen dem gewählten Typ.
- JSON-Lines-Segmente behalten `source: "mic" | "speaker"` (bei nicht zuordenbarem Stereo-Interim `""`), `speaker`, `state` und optional `language`. SDK-IDs werden im Backend nicht mit der Quelle präfixiert; die UI bildet daraus z. B. `mic:Guest-1` und `speaker:Guest-1`.
- Historische Validierung: drei Rust-Tests und 334 C#-Assertions fuer Konfiguration, CLI und Auswahl-/Mapping-Logik. Kein Nachweis fuer die Qualitaet realer Azure-Sprechererkennung.

- Standard-Mono: Continuous LID ist standardmaessig aktiv. Ist es deaktiviert, setzt die App nur die Primaersprache. Standard-Stereo verwendet immer die Primaersprache; MAI erkennt die Sprache selbst.
- Zwischenergebnisse sind in Mono und Standard-Stereo aktivierbar; bei Stereo bleibt die Quelle ohne verifizierten Kanal leer. MAI-Mono verwendet nach fehlgeschlagenem Praxistest keine Diarization (T-520). Bei ausgeschalteter Interim-Option werden keine Interim-Callbacks registriert und Intermediate-Diarization bleibt aus. Beleg: [DiarizationValidation.cs](../sidecar/Validation/DiarizationValidation.cs) und [AzureSpeechService.cs](../sidecar/AzureSpeechService.cs).

## Log
- 2026-06-25: Spec angelegt.
- 2026-11-09: Unabhängige Mic-/Speaker-Diarization implementiert, Defaults und tatsächliche Segmentfelder dokumentiert; Live-LID und Mehrsprecher-Abnahme weiter offen.