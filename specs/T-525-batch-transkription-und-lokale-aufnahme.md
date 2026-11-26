# T-525: Batch-Transkription und lokale Meeting-Aufnahme

## Kontext
Status: teils umgesetzt (2 Punkte offen)
Abhaengigkeiten: [T-509](./T-509-audio-capture-auf-wasapirecorderbuilder-umstellen.md), [T-523](./T-523-native-windows-stt-provider.md), [T-524](./T-524-native-windows-stt-machbarkeit.md)

## Bedienung und Daten

- Die Modellauswahl trennt Live und Batch. Batch-Varianten: Azure Speech Standard, Azure MAI Transcribe, Windows SAPI und Windows AI Speech. Web Speech ist ausschliesslich Live. Bestehende Einstellungen bleiben Live; nur `user.transcription.mode: "batch"` schaltet um.
- Start und Meeting-Auto-Start nehmen im Batch-Modus nur lokal auf. Azure-Zugangsdaten oder ein verfuegbares Erkennungsmodell sind dafuer nicht erforderlich. Auto-Stop finalisiert die Aufnahme; Pause wird nicht angeboten. Die bisherigen Grenzen fuer automatisches **Live**-Starten aendern sich nicht.
- Die Aufnahme liegt im lokalen App-Datenordner `Recordings`. Mikrofon und Speaker Loopback werden separat als PCM WAV (16 kHz, 16 Bit, Mono) mit gemeinsamer Zeitachse gespeichert. Erst der Abschlussmarker `recording.json` macht den Satz als fertige Aufnahme importierbar. Gespeicherte Aufnahmen verbleiben lokal, bis sie manuell entfernt werden.
- Im Batch-Modus eine WAV-Datei oder den Abschlussmarker auswaehlen und die Transkription ausdruecklich anstossen. Azure uebertraegt Audio erst nach dieser Aktion an die konfigurierte Azure-Speech-Ressource; die Windows-Modelle lesen die WAV lokal. Kein automatischer Providerwechsel und kein automatischer Modell-Download. Dateien bleiben auch bei Transkriptionsfehlern erhalten.
- Eigene Meeting-Aufnahmen behalten Quellenlabels und verfuegbare Zeitmarken. Eine externe WAV hat keine bekannte Quelle oder absolute Meeting-Zeit. Gibt der Provider keine Zeitmarken zurueck, erfindet die App keine relativen Offsets. Der fertige Text nutzt die vorhandene Transkriptansicht und den Markdown-Export.

## Abnahme

- [x] Live bleibt Default; Batch und Web Speech lassen sich nicht kombinieren. Beleg: `src/shared/speech-models.ts`, `src-tauri/src/batch.rs`.
- [x] Batch-Auto-Start und -Stop steuern den lokalen Audiorecorder, nicht einen STT-Dienst. Beleg: `src-tauri/src/commands.rs`, `sidecar/BatchAudioRecorder.cs`.
- [x] Dateierkennung fuer die vier Batch-Varianten und Uebergabe an die bestehende Transkriptansicht. Beleg: `sidecar/BatchTranscription.cs`, `src/renderer/src/use-app-state.ts`.
- [ ] Reales Mikrofon und Loopback zusammen aufnehmen; Synchronitaet und automatisches Stoppen am Meeting-Ende messen. - **offen**: erfordert freigegebene Audioquellen und eine interaktive Meeting-App.
- [ ] Expliziten Upload mit Azure Standard und MAI und Dateierkennung mit Windows AI Speech pruefen. - **offen**: erfordert eine geeignete Azure-Ressource bzw. ein installiertes Windows-AI-Speech-MSIX mit bereitem Modell.

Workboard: `440e6921-7d49-4702-b849-2fb43e36d1f4`.
