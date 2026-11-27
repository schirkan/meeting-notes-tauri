# T-525: Batch-Transkription und lokale Meeting-Aufnahme

## Kontext
Status: teils umgesetzt (1 Punkt offen)
Abhaengigkeiten: [T-509](./T-509-audio-capture-auf-wasapirecorderbuilder-umstellen.md), [T-523](./T-523-native-windows-stt-provider.md), [T-524](./T-524-native-windows-stt-machbarkeit.md)

## Bedienung und Daten

- Die Startseite zeigt **Record a meeting** links und **Transcribe audio files** rechts. Links stehen Geraete vor der Live-Modellwahl; **Record for later** braucht kein Modell. Bei vorhandenem Transkript wechselt **Home** zur Startseite, ohne das Transkript zu loeschen. Web Speech ist ausschliesslich Live. Bestehende Einstellungen bleiben Live; nur `user.transcription.mode: "batch"` schaltet um.
- Die Startseite speichert Aenderungen sofort. Datei-Modell, Sprache, automatische Spracherkennung und Sprechererkennung liegen separat unter `user.fileTranscription` und werden fuer den Dateiauftrag verwendet. Aeltere Konfigurationen uebernehmen bis zur ersten Aenderung die bisher gemeinsam genutzten Sprach-/Sprecherwerte und Azure Standard als Dateimodell. WAV-Pfade und Startzeiten sind keine Defaults.
- Start und Meeting-Auto-Start nehmen im Batch-Modus nur lokal auf. Azure-Zugangsdaten oder ein verfuegbares Erkennungsmodell sind dafuer nicht erforderlich. Auto-Stop finalisiert die Aufnahme; Pause wird nicht angeboten. Die bisherigen Grenzen fuer automatisches **Live**-Starten aendern sich nicht.
- Neue Aufnahmen liegen im selben Zielordner wie der Markdown-Export (standardmaessig neben der App), auch wenn der automatische Export aus ist. Alte WAVs werden nicht verschoben. Mikrofon und Speaker Loopback werden separat als PCM WAV (16 kHz, 16 Bit, Mono) gespeichert. Der Klick bzw. der Auto-Start-Ausloesezeitpunkt ist auf beiden Spuren Sekunde 0. Anfaenglich fehlende Pakete werden als Stille abgebildet. Die Dateinamen tragen denselben UTC-Aufnahmezeitstempel und eine eindeutige Kennung, danach `-mic.wav` bzw. `-speaker.wav`. Neue Aufnahmen schreiben kein `recording.json`. Erst ein erfolgreicher Stop nach Finalisierung fuellt die Spuren und den gemeinsamen Start ins Batch-Formular ein. WAVs bleiben lokal, bis sie manuell entfernt werden, und lassen sich spaeter erneut importieren.
- Im Dateibereich eine oder zwei WAVs explizit Mikrofon/Speaker zuordnen. Der Start stammt aus dem App-Dateinamen oder wird anhand eines Dateisystemzeitstempels geschaetzt. Die Felder zeigen Ortszeit; neu eingegebene Zeiten werden vor dem Auftrag in UTC umgerechnet. Nicht existierende Ortszeiten werden abgelehnt; bei doppelt vorkommenden Ortszeiten wird bei einer manuellen Eingabe der fruehere Zeitpunkt gewaehlt. Unveraenderte Zeitstempel behalten ihre Zeitzone und Millisekunden. Segmentzeiten sind Spurstart plus Offset und werden quellenuebergreifend sortiert; der gemeinsame bzw. frueheste Aufnahmestart bleibt im Markdown unabhaengig vom ersten gesprochenen Segment erhalten. Azure Standard, Azure MAI und SAPI koennen zwei Spuren liefern.
- Nur eine ausdruecklich gestartete und bestaetigte Azure-Dateitranskription uebertraegt Audio an die konfigurierte Azure-Speech-Ressource; Windows SAPI liest die WAV lokal und bietet keine Sprechererkennung. Kein automatischer Providerwechsel und kein automatischer Modell-Download. Dateien bleiben auch bei Transkriptionsfehlern erhalten.
- Azure-Dateitranskription verwendet `azure.batchEndpoint` (**Settings → Azure → File transcription endpoint**), alternativ einen bereits passenden Ressourcen-Endpunkt aus `azure.endpoint`. Regionale Live-Endpunkte sind dafuer nicht geeignet. Das Debug-Log zeigt Modell, Spur und Ergebnis; SAPI meldet auch abgelehnte Erkennungen und den gemeldeten Eingangspegel. Keine Zugangsdaten, Dateipfade oder Transkriptinhalte im Batch-Log.

## Abnahme

- [x] Live bleibt Default; Web Speech ist kein Dateimodell. Seine gespeicherte Live-Auswahl hindert die lokale Batch-Aufnahme nicht. Beleg: `src/shared/speech-models.ts`, `src-tauri/src/batch.rs`, `tests/startup-ui.test.mjs`.
- [x] Batch-Auto-Start und -Stop steuern den lokalen Audiorecorder, nicht einen STT-Dienst. Beleg: `src-tauri/src/commands.rs`, `sidecar/BatchAudioRecorder.cs`.
- [x] Dateierkennung fuer die drei Batch-Modelle und Uebergabe an die bestehende Transkriptansicht. Beleg: [BatchTranscription.cs](../sidecar/BatchTranscription.cs), [use-app-state.ts](../src/renderer/src/use-app-state.ts).
- [ ] Reales Mikrofon und Loopback zusammen aufnehmen; Synchronitaet und automatisches Stoppen am Meeting-Ende messen. - **offen**: erfordert freigegebene Audioquellen und eine interaktive Meeting-App.
- [x] Bestaetigten WAV-Upload mit Azure Standard und Azure MAI an einer geeigneten Ressource geprueft. Beleg: Nutzerabnahme vom 28.11.2026.

Workboard: `440e6921-7d49-4702-b849-2fb43e36d1f4`, `1e4f4251-fa49-4649-8fa0-2a8aaafef632`.
