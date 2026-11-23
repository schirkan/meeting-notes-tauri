# T-518: Echo cancellation – lokale Audio-Pipeline

## Kontext
Status: teils umgesetzt (1 Punkt offen; Alpha)
Reifegrad: Alpha
Abhaengigkeiten: [T-517: Feature und Einstellungen](./T-517-echo-cancellation-alpha.md), [T-203: PCM](./T-203-audio-resampling-16khz-mono-pcm.md), [T-509: WASAPI](./T-509-audio-capture-auf-wasapirecorderbuilder-umstellen.md)

## Signalpfad

Der C#-Sidecar erhaelt bereits zwei unabhaengige PCM-Quellen mit lokalen
Zeitmarken. Der ausgewaehlte WASAPI-Loopback liefert die Wiedergabereferenz
und wird weiterhin unveraendert transkribiert. Eine lokale Streaming-AEC
nutzt die Referenz, erkennt bzw. modelliert deren verzoegerten Anteil im Mic
und faehrt nur mit dem korrigierten **oder** unveraenderten Mic-Frame zur
bestehenden Azure-Sitzung fort. Keine Text-Deduplizierung, keine neue
Cloud-Verarbeitung und kein Roh-Audio in IPC, Logs oder Dateien.

## Design und Grenzen

1. **Engine:** Die Alpha verwendet einen konservativen Managed-Ein-Tap-Filter
   ohne weitere native Abhaengigkeit. Er bestaetigt die Korrelation wiederholt,
   subtrahiert einen begrenzten Anteil der geschaetzten Kopie und passt Gain
   nur bei hoher Korrelation an. Er modelliert keinen komplexen Raumhall.
   Fuer WebRTC AEC3 wurde keine reproduzierbare Einbindung in den getrimmten
   Portable-Pfad nachgewiesen; AEC3 bleibt ein spaeterer Kandidat.
2. **Zeitbasis und Frames.** Bindung an das aktuell verwendete Geraetepaar,
   10-ms-Analysefenster, WASAPI-Paket-QPC (nicht Callback-Ankunft) und maximal
   400 ms Referenzhistorie. Falsche/fehlende Zeitmarken und unzuverlaessige
   Resampler-Pakete fuehren zum Bypass. Der Referenzabgleich folgt begrenztem
   Drift; es gibt keine wachsende Warteschlange und keinen blockierenden
   Referenz-Lock im Audio-Callback.
3. **Zustaende:** `Off` (Schalter aus / Quellen fehlen) → `Warming up`
   (Referenz/Ausrichtung noch nicht stabil) → `Active` → `Bypass`
   (fehlende Referenz, Discontinuity, Engine-Fehler). In Warmup und Bypass
   unveraendertes Mic liefern; bei Referenzrueckkehr neu ausrichten. Stille ist
   nicht automatisch eine fehlerhafte Referenz. Doppelsprache darf kein
   Mic-Mute ausloesen. Debug-Meldungen nur bei Zustandswechseln, ohne Audiopayload.
4. **Lifecycle.** Referenzpuffer und Filterstatus gehoeren zur Sitzung und
   zum Geraetepaar. Pause leitet weiterhin kein Audio an Azure; bei Resume
   nach einer Luecke Warmup, ohne Azure-Session oder Sprecheraliase neu zu
   starten. Stop/Quit gibt AEC-State samt Puffern frei. Wenn der bestehende
   Capture-Pfad nach einem Geraetewechsel keine Referenz mehr liefert, bleibt
   AEC im Bypass; die Alpha fuehrt kein eigenes Hot-Swapping ein.

## Done When
- [x] Managed-Engine ohne zusaetzliche native Abhaengigkeit integriert. Beleg: `sidecar/EchoCancellation.cs`; die Integration erfordert keine neuen Pakete.
- [x] Deterministische PCM-Tests belegen Offset/Drift, mehr als 12 dB Echoabnahme im Einpfad-Test und mehr als 8 dB weniger Fehler bei synthetischer Doppelsprache; Nahstimme ohne Echo bleibt bytegleich. Beleg: `EchoCancellationValidation.cs`; Speaker-PCM wird unveraendert an Azure uebergeben (`Program.cs`).
- [x] Fehlende Referenz, Warmup, Ringgrenze, Pause/Resume und Stop reichen Mic unveraendert durch oder geben den Filterzustand frei. Beleg: AEC-Regressionen in `EchoCancellationValidation.cs` sowie Fail-open im `EchoCancellation`-Pfad.
- [ ] Echte Windows-Capture-Queues, Rueckkehr nach Geraetestoerungen und A/B-Sprachqualitaet sind gemessen. - **offen**: Native Zielgeraete-/Azure-Abnahme folgt in T-519.

## Workboard
`4f1a482b-afa7-42a3-a933-ef145302a856`
