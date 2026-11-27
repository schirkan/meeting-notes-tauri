# T-204: Azure Speech SDK im C#-Sidecar integrieren

## Kontext
Status: umgesetzt
Priorität: high
Abhängigkeiten: T-203
Folgespecs: [T-520: Modellauswahl](./T-520-mai-transcribe-streaming-feature.md) und [T-521: optionaler Mehrkanalpfad fuer Standard und MAI](./T-521-mai-transcribe-mehrkanal-sidecar.md). Die folgenden Belege beschreiben die Integration des Standard-Dual-Mono-Pfads.

## Goal
NuGet-Paket `Microsoft.CognitiveServices.Speech` (1.53.x) zum Sidecar-Projekt hinzufügen und beide Recognizer (Mic + Speaker) konfigurieren.

## Done When
- [x] `MeetingNotes.Sidecar.csproj` enthält `<PackageReference Include="Microsoft.CognitiveServices.Speech" Version="1.53.0" />`. Beleg: sidecar/MeetingNotes.Sidecar.csproj (Microsoft.CognitiveServices.Speech 1.53.0).
- [x] `AzureSpeechService.cs` kapselt `ConversationTranscriber` und `SpeechRecognizer`. Bei Azure Standard bestimmt ein gemeinsamer Schalter den Typ fuer die aktiven Quellen (siehe [T-205](./T-205-continuous-lid-und-diarization-in-c-sharp.md)). Beleg: [AzureSpeechService.cs](../sidecar/AzureSpeechService.cs) und [settings.rs](../src-tauri/src/settings.rs).
- [x] `PushAudioInputStream` wird aus der `AudioResampler`-Pipeline gefüttert (siehe `T-203`). Beleg: sidecar/AzureSpeechService.cs.
- [x] Recognizer-Events (`Recognizing`, `Recognized`, `Canceled`, `SessionStarted/Stopped`, `SpeechStart/EndDetected`) werden auf interne Event-Handler gemappt. Beleg: Transcribing/Transcribed/Recognizing/Recognized in AzureSpeechService.cs.
- [x] Rust lädt den Abschnitt `azure` aus `MeetingNotes.config.json` und übergibt Region/Endpoint als CLI-Args sowie Speech-Key als prozesslokale Umgebungsvariable. Der Sidecar liest die JSON-Datei nicht selbst. Beleg: scripts/measure-latency-tauri.mjs (azure) (geprueft).
- [x] Optionaler Proxy (`proxy.host`/`proxy.port` + optional Auth) wird im gemeinsamen [SpeechConfiguration](../sidecar/SpeechConfiguration.cs)-Builder via `SpeechConfig.SetProxy()` für Aufnahme und Diagnose konfiguriert. Zugangsdaten kommen aus prozesslokalen Umgebungsvariablen. Beleg: src/renderer/src/config-utils.ts (proxy.host), src/renderer/src/config-utils.ts (proxy.port) (geprueft).
- [x] `--test-connectivity` prueft den wirksamen Recognizer-Typ ohne Audio-Capture; positives Ergebnis verlangt `Connected` und `SessionStarted`. Beleg: [SpeechConnectivityDiagnostic.cs](../sidecar/SpeechConnectivityDiagnostic.cs) und [T-304](./T-304-connectivity-diagnose-in-rust.md).
- [x] Erfolgreiche native Azure-/Proxy-Verbindung im realen Zielnetz validiert (siehe [T-306](./T-306-proxy-aware-azure-transport.md)); lokale Negativdiagnose ersetzt diesen Test nicht. Beleg: am 2026-11-12 im Firmennetz erfolgreich validiert.

## Approach
- Audio-Push direkt aus dem Sidecar an `SpeechRecognizer` / `ConversationTranscriber` — **keine** Pipe-Marshalling-Schritte für PCM-Frames.
- Logging auf jedem Recognizer-Event für Diagnose (analog zum bestehenden `azure-transcription-service.ts`).
- Lifecycle-Korrektheit: `StopTranscribingAsync` für `ConversationTranscriber`, `StopContinuousRecognitionAsync` für `SpeechRecognizer`.
- Native Windows-SDK-Zertifikatsprüfungen bleiben aktiv; die HTTPS-Diagnose in Rust prüft Zertifikate ebenfalls aktiv (gleicher System-Vertrauensspeicher).

## Log
- 2026-06-25: Spec angelegt.