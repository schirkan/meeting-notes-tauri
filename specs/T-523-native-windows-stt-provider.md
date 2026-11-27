# T-523: Experimentelle Windows-STT-Modelle

## Kontext
Status: teils umgesetzt (1 Punkt offen)
Reifegrad: experimentelle Implementierung; Live-/Zielrechner-Abnahme in [T-524](./T-524-native-windows-stt-machbarkeit.md)
Abhaengigkeiten: [T-103](./T-103-konfiguration-azure-und-user-settings.md), [T-403](./T-403-settings-dialog-mit-verbindung-testen-button.md), [T-507](./T-507-pause-stop-und-sitzungsgebundene-sprecherzuordnung.md), [T-511](./T-511-transkriptions-quellen-auswaehlen.md), [T-520](./T-520-mai-transcribe-streaming-feature.md)

## Ziel und Bedienung

Unter **Settings → Speech recognition → Transcription model**: **Azure Speech (standard)**,
**Azure MAI Transcribe (Preview)**, **Windows SAPI (Experimental)** und **Web Speech API (Experimental)**.
Das bisherige Azure-Modell bleibt Standard und unveraendert als `azure.model` gespeichert. Fehlt
`user.transcription.provider`, gilt Azure; alternative Providerwerte sind `windows-sapi` und `web-speech`.
Ein unbekannter expliziter Wert blockiert statt still Azure zu starten. **Save** persistiert erst den
Dialog-Draft; waehrend Start/Aufnahme/Pause bleiben die Modelloptionen gesperrt. Inaktive Azure-Konfiguration,
Stereo-, Quellen- und Auto-Start-Praeferenzen werden nicht ueberschrieben. Fuer Web Speech wird Interim-Text
separat unter `user.transcription.webInterimResults` gespeichert (Standard aus).

## Interne Modellmatrix

Die folgende Matrix beschreibt den Live-Betrieb. Batch-Varianten und lokales Auto-Start/Stop sind in [T-525](./T-525-batch-transkription-und-lokale-aufnahme.md) beschrieben.

| Modell | Audioquellen | Sprache | Diarization | Interim | Auto-Start | Pause/Resume |
|---|---|---|---|---|---|---|
| Azure Speech (standard) | Mic und Loopback; Mono oder Stereo | feste Sprache oder optionale Erkennung in Mono | ja | ja | ja | ja |
| Azure MAI Transcribe (Preview) | Mic und Loopback; getrenntes Mono | automatisch | nein | ja | ja | ja |
| Windows SAPI (Experimental) | Mic und Loopback; getrennte Mono-Streams | installierte Desktop-Diktatsprache | nein | nein | ja | ja |
| Web Speech API (Experimental) | Standardmikrofon, manuell; keine Geraetewahl/kein Loopback | feste Sprache | nein | optional | nein | nein |

Die Matrix in `src/shared/speech-models.ts` steuert Settings, Quellenauswahl und Pause-Bedienung.
Rust erzwingt die Provider-Grenzen auch beim Start ohne Renderer (Auto-Start). SAPI benutzt
WASAPI/PCM16 im C#-Sidecar und `System.Speech`, ohne Azure-Argumente, Proxy oder Key; Pause und
Resume verwerfen alte Audio-Puffer und behalten die App-Sitzungs-ID. Kein Roh-Audio ueber IPC.
Web Speech laeuft in WebView2, nicht im Azure- oder SAPI-Sidecar. Vor dem Aktivieren weist die App
darauf hin, dass der WebView-Betreiber Mikrofon-Audio an seinen Onlinedienst uebermitteln kann.
Kein stiller Alternativprovider, keine Audioablage, kein Modelldownload und kein automatisches Setzen
des Ceto-Testflags oder Windows-Benutzervariablen. **Check model availability** prueft lokal die
SAPI-Diktatgrammatik bzw. die API-Oberflaeche, nicht Mikrofonberechtigung, Cloud-Verbindung oder Qualitaet.

Web Speech startet nur nach manueller Auswahl, meldet Fehler oder unerwartete Enden sichtbar und startet
nicht automatisch neu. Der App-Status wird erst nach WebView-Readiness im Renderer angezeigt. Stop und
Quit warten begrenzt auf Finals, danach verwendet Quit den bestehenden Markdown-Export. Beim Wechsel
der Engine bleibt Azure konfiguriert; es findet kein stiller Start der alten Engine statt.

Der Windows-AI-Speech-Laborpfad wurde entfernt (historischer Build-Nachweis in [T-524](./T-524-native-windows-stt-machbarkeit.md)). Eine alte Modellauswahl wird als nicht unterstuetzt erkannt; vor Live-Transkription muss ein anderes Modell ausgewaehlt werden.

## Done When
- [x] Modellwahl und Matrix, Persistenz/Draft, Azure-Abgrenzung und experimentelle Provider-Routen integriert. Beleg: `src/shared/speech-models.ts`, `src-tauri/src/commands.rs`, `sidecar/WindowsSapi.cs` sowie `tests/startup-ui.test.mjs` und `tests/web-speech.test.mjs`.
- [ ] Laufzeitnachweis fuer die experimentellen Modelle auf Windows x64. - **offen**: SAPI-Engines, Quellenisolation und Dauerlauf sowie echtes WebView2-Mikrofon/Netz; siehe T-524.

Workboard: `6c9e26bb-b2e7-4520-85cd-0a956e52eb2b` (SAPI/Web).
