# T-525: Batch-Transkription und lokale Meeting-Aufnahme

## Kontext
Status: teils umgesetzt (2 Punkte offen)
Abhaengigkeiten: [T-509](./T-509-audio-capture-auf-wasapirecorderbuilder-umstellen.md), [T-523](./T-523-native-windows-stt-provider.md), [T-524](./T-524-native-windows-stt-machbarkeit.md)

## Bedienung und Daten

- Die Startseite trennt Live-Transkription und Batch-Aufnahme. Der Datei-Dialog ist in beiden Modi im Leerlauf erreichbar; seine Modellwahl gilt nur fuer den Dateiauftrag. Optionen und Diagnosen entsprechen den Faehigkeiten des aktiven Modells und Modus. Web Speech ist ausschliesslich Live. Bestehende Einstellungen bleiben Live; nur `user.transcription.mode: "batch"` schaltet um.
- Start und Meeting-Auto-Start nehmen im Batch-Modus nur lokal auf. Azure-Zugangsdaten oder ein verfuegbares Erkennungsmodell sind dafuer nicht erforderlich. Auto-Stop finalisiert die Aufnahme; Pause wird nicht angeboten. Die bisherigen Grenzen fuer automatisches **Live**-Starten aendern sich nicht.
- Die Aufnahme liegt im lokalen App-Datenordner `Recordings`. Mikrofon und Speaker Loopback werden separat als PCM WAV (16 kHz, 16 Bit, Mono) gespeichert. Der Klick bzw. der Auto-Start-Ausloesezeitpunkt ist auf beiden Spuren Sekunde 0. Anfaenglich fehlende Pakete werden als Stille abgebildet. Die Dateinamen tragen denselben UTC-Aufnahmezeitstempel und eine eindeutige Kennung, danach `-mic.wav` bzw. `-speaker.wav`. Neue Aufnahmen schreiben kein `recording.json`. Erst ein erfolgreicher Stop nach Finalisierung fuellt die Spuren und den gemeinsamen Start ins Batch-Formular ein. WAVs bleiben lokal, bis sie manuell entfernt werden, und lassen sich spaeter erneut importieren.
- Im Datei-Dialog eine oder zwei WAVs explizit Mikrofon/Speaker zuordnen; einen Start aus dem App-Dateinamen uebernehmen oder einen Dateisystemzeitstempel als Schaetzung vorschlagen. Startzeiten sind korrigierbar. Segmentzeiten sind Spurstart plus Offset und werden quellenuebergreifend sortiert; der gemeinsame bzw. frueheste Aufnahmestart bleibt im Markdown unabhaengig vom ersten gesprochenen Segment erhalten. Azure Standard, Azure MAI und SAPI koennen zwei Spuren liefern. Windows AI Speech bleibt ohne Segmentzeitmarken auf eine Spur beschraenkt.
- Nur eine ausdruecklich gestartete und bestaetigte Azure-Dateitranskription uebertraegt Audio an die konfigurierte Azure-Speech-Ressource; die Windows-Modelle lesen die WAV lokal. Kein automatischer Providerwechsel und kein automatischer Modell-Download. Dateien bleiben auch bei Transkriptionsfehlern erhalten.

## Abnahme

- [x] Live bleibt Default; Web Speech ist kein Dateimodell. Seine gespeicherte Live-Auswahl hindert die lokale Batch-Aufnahme nicht. Beleg: `src/shared/speech-models.ts`, `src-tauri/src/batch.rs`, `tests/startup-ui.test.mjs`.
- [x] Batch-Auto-Start und -Stop steuern den lokalen Audiorecorder, nicht einen STT-Dienst. Beleg: `src-tauri/src/commands.rs`, `sidecar/BatchAudioRecorder.cs`.
- [x] Dateierkennung fuer die vier Batch-Varianten und Uebergabe an die bestehende Transkriptansicht. Beleg: `sidecar/BatchTranscription.cs`, `src/renderer/src/use-app-state.ts`.
- [ ] Reales Mikrofon und Loopback zusammen aufnehmen; Synchronitaet und automatisches Stoppen am Meeting-Ende messen. - **offen**: erfordert freigegebene Audioquellen und eine interaktive Meeting-App.
- [ ] Expliziten Upload mit Azure Standard und MAI und Dateierkennung mit Windows AI Speech pruefen. - **offen**: erfordert eine geeignete Azure-Ressource bzw. ein installiertes Windows-AI-Speech-MSIX mit bereitem Modell.

Workboard: `440e6921-7d49-4702-b849-2fb43e36d1f4`, `1e4f4251-fa49-4649-8fa0-2a8aaafef632`.
