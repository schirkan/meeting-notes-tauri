# T-521: MAI-Transcribe-2-Streaming – Mehrkanal im Sidecar

## Kontext
Status: teils umgesetzt (3 Punkte offen)
Reifegrad: lokaler Nachweis; Standard-Stereo live offen; MAI-Stereo nach erneut gemeldetem Fehler deaktiviert.
Abhaengigkeiten: [T-520: Feature](./T-520-mai-transcribe-streaming-feature.md), [T-522: SDK-Nachweis](./T-522-mai-transcribe-machbarkeit-kosten-abnahme.md), [T-204: Speech SDK](./T-204-azure-speech-sdk-integration-im-sidecar.md), [T-201: JSON-Lines](./T-201-json-lines-protokoll-tauri-zu-sidecar.md), [T-507: Sitzungsidentitaet](./T-507-pause-stop-und-sitzungsgebundene-sprecherzuordnung.md)

## Implementierung

**Settings → Speech recognition → Audio stream mode** bietet
**Mono (separate sessions per audio device)** als Standardwert und
**Stereo (one session)** nur fuer Azure Speech Standard.
MAI ignoriert die gespeicherte Stereo-Praeferenz; die Sidecar-CLI weist
eine explizite MAI-Zweikanalanforderung zurueck. Bei nur einer Quelle wird weiterhin Mono verwendet. Stereo sendet
PCM16 LE mit 16 kHz und `0 = mic`, `1 = speaker` an einen PushStream und einen
Recognizer mit `Speech_EnableMultiChannelProcessing` (Speech SDK 1.53.1).

- Standard-Stereo verwendet die konfigurierte Primaersprache statt kontinuierlicher
  Sprachwahl. Sobald eine Quelle Sprechererkennung anfordert, wird der gemeinsame
  `ConversationTranscriber` eingesetzt. Die gemeinsame Einstellung gilt fuer
  beide Kanaele; die serverseitige Diarization ist nicht pro Kanal abschaltbar.
  Standard-Dual-Mono bleibt unveraendert.
- Capture und Resampling bleiben getrennt.
  Der Mux richtet beide Kanaele anhand der WASAPI/QPC-Zeitmarken aus und nutzt
  bei unbrauchbaren Zeitmarken eine Schaetzung aus Callback-Zeitpunkt und
  Paketdauer. Bloecke von 20 ms warten bis zu 80 ms auf die Gegenseite; nur
  fehlende Samples werden mit Nullen gefuellt. Vollstaendig leere Abschnitte
  werden nicht gesendet. Die Queue ist auf 50 Bloecke begrenzt; ein eigener
  Writer pusht die Bloecke. Padding, verworfene Samples und geschaetzte Pakete
  sind ohne Audioinhalte in der Diagnose sichtbar.
- Der SDK-Kanal und das explizite `Channel`-Feld des Ergebnis-JSON muessen
  fuer eine Quellzuordnung uebereinstimmen. Bei aktivierten Interim Results
  wird Text ohne sicheren Kanal mit `source: ""` angezeigt und durch das
  naechste Ergebnis der Sitzung ersetzt. Fuer Finals bleiben fehlende oder
  ungueltige Kanalangaben ein sichtbarer Sitzungsfehler. Ob beide Standard-
  Recognizer im Betrieb zuordenbare Interims liefern, ist offen.

## Lifecycle und Diagnose

Der Sidecar bestaetigt den Start erst nach Readiness; der Renderer zeigt den
bestehenden Aufnahmezustand bereits ab Prozessstart. Ein Startfehler oder
unerwartetes Sitzungsende stoppt Stereo sichtbar, ohne automatischen Wechsel
zu Mono, einem anderen Modell oder einer neuen Sitzung. Pause verwirft noch
ungesendete Bloecke; Resume richtet die Timeline neu aus, ohne die Sitzung
zu wechseln. Danach werden nur Pakete mit verlaesslichem WASAPI/QPC-Anker
akzeptiert und an der Resume-Grenze beschnitten. Fehlt der Zeitanker, wird
das Paket verworfen statt Aufnahmezeit aus der Callback-Zeit zu schaetzen.
Stop/Quit wird schon waehrend des nativen Stereo-Starts und der Readiness-Wartezeit
angenommen. Die Bereinigung wartet begrenzt auf native Handles; ein Timeout
wird nicht als sauberer Stop quittiert. Bei laufender Sitzung drainiert Stop
angenommene Bloecke vor EOF und wartet begrenzt auf letzte Finals. **Test connection** verwendet den ungespeicherten Draft
mit passendem Modell, Format und Recognizer, sendet nur Stille und ist bei
laufender oder pausierter Aufnahme gesperrt. Readiness ist kein Beleg fuer
Erkennung oder Kanalzuordnung.

## Done When
- [x] PCM-Reihenfolge, Versatz, fehlende Samples, Puffergrenzen, Pause/Resume, Drain und strikte Final-Kanalpruefung sind lokal getestet. Beleg: `npm run test:sidecar` mit 608 bestandenen Assertions; Stichproben zu Media Foundation und Nicht-Standard-Audioendpunkt blieben offen. Typecheck und 42 Config-Tests bestanden.
- [ ] Hardwarelauf belegt Zeitanker, Resampling-Fallback, Drift und gleichzeitige Sprache. - **offen**: Synthetische PCM-Tests ersetzen keine WASAPI-Hardwaremessung.
- [ ] Live-Azure belegt je eine Sitzung, korrekte Finals und Standard-Sprecher-IDs fuer beide Standard-Recognizer sowie Interim-Zuordnung. - **offen**: Azure-Ressource und geeignete Credentials fehlen in der Testumgebung.
- [ ] Live-Lifecycle und Diagnose decken Pause/Resume, Sitzungsende, Stop/Quit und letzte Finals bei Proxy/Direktverbindung ab. - **offen**: Live-Azure und getrimmter Portable-Build stehen aus; lokaler Virenscanner blockiert den MSBuild-Taskhost fuer Trimming.
