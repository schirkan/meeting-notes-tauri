# T-205: Continuous Language Identification (LID) und Diarization in C#

## Kontext
Status: draft
Priorität: high
Abhängigkeiten: T-204

## Goal
Continuous LID und Speaker-Diarization in der C#-Recognizer-Konfiguration aktivieren und in Segment-Events weiterreichen.

## Done When
- [ ] `SpeechRecognizer` und `ConversationTranscriber` nutzen `LanguageIdMode = Continuous` und konfigurieren AutoDetect-Kandidaten.
- [ ] Erkannte Sprache (`detectedLanguage`) wird in jedem Transkript-Segment mitgeführt.
- [ ] Speaker-ID (`speakerId`) wird in jedem Speaker-Transkript mitgeführt.
- [ ] Mapping-Logik für 30 Speaker-Farben bleibt identisch zu `../meeting-notes`.
- [ ] Diarization funktioniert für mindestens 2 Sprecher (manueller Test).

## Approach
- API-Mapping C#:
  - `AutoDetectSourceLanguageConfig.FromLanguages(...)` für AutoDetect.
  - `SpeechConfig.SetProperty(PropertyId.SpeechServiceConnection_LanguageIdMode, "Continuous")`.
  - Diarization via `ConversationTranscriber` (Speaker-Kanal).
- Erkannte Sprache wird im Segment-Event als `detectedLanguage: string` mitgeschickt.

## Log
- 2026-06-25: Spec angelegt.