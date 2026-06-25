# T-204: Azure Speech SDK im C#-Sidecar integrieren

## Kontext
Status: draft
Priorität: high
Abhängigkeiten: T-203

## Goal
NuGet-Paket `Microsoft.CognitiveServices.Speech` (1.44.x) zum Sidecar-Projekt hinzufügen und beide Recognizer (Mic + Speaker) konfigurieren.

## Done When
- [ ] `MeetingNotes.Sidecar.csproj` enthält `<PackageReference Include="Microsoft.CognitiveServices.Speech" Version="1.44.0" />`.
- [ ] `AzureSpeechService.cs` kapselt beide Recognizer (`SpeechRecognizer` für Mic, `ConversationTranscriber` für Speaker).
- [ ] `PushAudioInputStream` wird aus der `AudioResampler`-Pipeline gefüttert (siehe `T-203`).
- [ ] Recognizer-Events (`Recognizing`, `Recognized`, `Canceled`, `SessionStarted/Stopped`, `SpeechStart/EndDetected`) werden auf interne Event-Handler gemappt.
- [ ] Speech-Key und Region werden aus `config/azure.json` geladen.
- [ ] Optionaler Proxy (`proxy.host`/`proxy.port` + optional Auth) wird via `SpeechConfig.SetProxy()` konfiguriert.

## Approach
- Audio-Push direkt aus dem Sidecar an `SpeechRecognizer` / `ConversationTranscriber` — **keine** Pipe-Marshalling-Schritte für PCM-Frames.
- Logging auf jedem Recognizer-Event für Diagnose (analog zum bestehenden `azure-transcription-service.ts`).
- Lifecycle-Korrektheit: `StopTranscribingAsync` für `ConversationTranscriber`, `StopContinuousRecognitionAsync` für `SpeechRecognizer`.

## Log
- 2026-06-25: Spec angelegt.