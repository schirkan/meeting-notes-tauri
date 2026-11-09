# T-204: Azure Speech SDK im C#-Sidecar integrieren

## Kontext
Status: partial
Priorität: high
Abhängigkeiten: T-203

## Goal
NuGet-Paket `Microsoft.CognitiveServices.Speech` (1.44.x) zum Sidecar-Projekt hinzufügen und beide Recognizer (Mic + Speaker) konfigurieren.

## Done When
- [ ] `MeetingNotes.Sidecar.csproj` enthält `<PackageReference Include="Microsoft.CognitiveServices.Speech" Version="1.44.0" />`.
- [ ] `AzureSpeechService.cs` kapselt beide Recognizer (`SpeechRecognizer` für Mic, `ConversationTranscriber` für Speaker).
- [ ] `PushAudioInputStream` wird aus der `AudioResampler`-Pipeline gefüttert (siehe `T-203`).
- [ ] Recognizer-Events (`Recognizing`, `Recognized`, `Canceled`, `SessionStarted/Stopped`, `SpeechStart/EndDetected`) werden auf interne Event-Handler gemappt.
- [x] Rust lädt `config/azure.json` und übergibt Region/Endpoint als CLI-Args sowie Speech-Key als prozesslokale Umgebungsvariable. Der Sidecar liest die JSON-Datei nicht selbst.
- [x] Optionaler Proxy (`proxy.host`/`proxy.port` + optional Auth) wird im gemeinsamen [SpeechConfiguration](../sidecar/SpeechConfiguration.cs)-Builder via `SpeechConfig.SetProxy()` für Aufnahme und Diagnose konfiguriert. Zugangsdaten kommen aus prozesslokalen Umgebungsvariablen.
- [x] `--test-connectivity` prüft Recognizer und Transcriber ohne Audio-Capture; positives Ergebnis verlangt jeweils `Connected` und `SessionStarted`.
- [ ] Erfolgreiche native Azure-/Proxy-Verbindung im realen Zielnetz validiert (siehe [T-306](./T-306-proxy-aware-azure-transport.md)); lokale Negativdiagnose ersetzt diesen Test nicht.

## Approach
- Audio-Push direkt aus dem Sidecar an `SpeechRecognizer` / `ConversationTranscriber` — **keine** Pipe-Marshalling-Schritte für PCM-Frames.
- Logging auf jedem Recognizer-Event für Diagnose (analog zum bestehenden `azure-transcription-service.ts`).
- Lifecycle-Korrektheit: `StopTranscribingAsync` für `ConversationTranscriber`, `StopContinuousRecognitionAsync` für `SpeechRecognizer`.
- Native Windows-SDK-Zertifikatsprüfungen bleiben aktiv; der unsichere HTTPS-Diagnose-Bypass in Rust gilt nicht für Speech/WSS.

## Log
- 2026-06-25: Spec angelegt.