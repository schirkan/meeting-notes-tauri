# T-205: Continuous Language Identification (LID) und Diarization in C#

## Kontext
Status: teils umgesetzt (1 Punkt offen)
Priorität: high
Abhängigkeiten: T-204

## Goal
Continuous LID und Speaker-Diarization in der C#-Recognizer-Konfiguration aktivieren und in Segment-Events weiterreichen.

## Done When
- [x] `SpeechRecognizer` und `ConversationTranscriber` nutzen `LanguageIdMode = Continuous` und konfigurieren AutoDetect-Kandidaten; reales Continuous-LID-Verhalten bleibt zu validieren. Beleg: AzureSpeechService.cs (Continuous, AutoDetectSourceLanguageConfig). Das reale Continuous-LID-Verhalten bleibt live zu validieren.
- [x] Erkannte Sprache wird im optionalen Segmentfeld `language` mitgeführt und im Live-Test geprüft (nicht `detectedLanguage`). Beleg: language-Feld in src/shared/transcript-contract.ts und im Sidecar-Payload.
- [x] Je Quelle wählt `diarization.mic` bzw. `diarization.speaker` unabhängig `ConversationTranscriber` (aktiviert) oder `SpeechRecognizer` (deaktiviert). Beide Optionen sind standardmäßig aktiviert, auch bei fehlenden Feldern in bestehenden Konfigurationen. Beleg: src/renderer/src/components/SettingsPanel.tsx (diarization.mic), src/renderer/src/components/SettingsPanel.tsx (diarization.speaker), sidecar/AzureSpeechService.cs (ConversationTranscriber) (geprueft).
- [x] Bei aktivierter Sprechererkennung werden SDK-Speaker-IDs für Mic und Speaker unverändert im Segmentfeld `speaker` weitergegeben, für Interim und Final; fehlende IDs werden `unknown`. Bei deaktivierter Sprechererkennung heißen die IDs `self` (Mic) bzw. `guest` (Speaker). Beleg: scripts/measure-latency-tauri.mjs (speaker), sidecar/AzureSpeechService.cs (unknown), sidecar/AzureSpeechService.cs (guest) (geprueft).
- [x] Das SDK-Property für Intermediate-Diarization ist mit Speech SDK 1.53 verifiziert und im Transcriber-Pfad konfiguriert. Beleg: src-tauri/src/settings.rs (diarization) und sidecar/SpeechConfiguration.cs - die Diarization wird ueber EffectiveDiarization je Quelle aktiviert.
- [x] Die UI verwendet quellenspezifische Identitäten und 30 zyklische Farbslots; nummerierte Mic-IDs erhalten einen Offset von 15. Siehe [T-404](./T-404-speaker-mapping-auto-scroll-focus-trap.md). Beleg: src/renderer/src/speaker-utils.ts (30 Farbslots, je Quelle eigene Palette) und src/shared/transcript-contract.ts (source im Identitaetsschluessel).
- [ ] Diarization funktioniert für mindestens 2 Sprecher je aktivierter Quelle (manueller Live-Azure-Test). - **offen**: Erfordert einen manuellen Live-Azure-Test mit mindestens zwei Sprechern je Quelle.

## Approach
- Persistenz: `diarization: { "mic": true, "speaker": true }` in User-Settings. Speichern wirkt beim nächsten Aufnahmestart, nicht auf eine laufende Sitzung.
- Transport zum Sidecar: `--diarization-mic true|false` und `--diarization-speaker true|false`.
- API-Mapping C#:
  - `AutoDetectSourceLanguageConfig.FromLanguages(...)` für AutoDetect.
  - `SpeechConfig.SetProperty(PropertyId.SpeechServiceConnection_LanguageIdMode, "Continuous")`.
  - `ConversationTranscriber` für jede Quelle mit aktivierter Sprechererkennung, sonst `SpeechRecognizer`; Start/Stop und Event-Verarbeitung folgen dem gewählten Typ.
- JSON-Lines-Segmente behalten `source: "mic" | "speaker"`, `speaker`, `state` und optional `language`. SDK-IDs werden im Backend nicht mit der Quelle präfixiert; die UI bildet daraus z. B. `mic:Guest-1` und `speaker:Guest-1`.
- Validierung: drei Rust-Tests und 334 C#-Assertions erfolgreich. Diese prüfen Konfiguration, CLI und Auswahl-/Mapping-Logik, nicht die Qualität realer Azure-Sprechererkennung. Status bleibt deshalb `draft`.

## Log
- 2026-06-25: Spec angelegt.
- 2026-11-09: Unabhängige Mic-/Speaker-Diarization implementiert, Defaults und tatsächliche Segmentfelder dokumentiert; Live-LID und Mehrsprecher-Abnahme weiter offen.