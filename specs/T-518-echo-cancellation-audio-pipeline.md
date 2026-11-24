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
   Mic-Mute ausloesen. Neben Zustandswechseln meldet `echo_cancellation_stats`
   bei eingeschalteter AEC etwa alle 5 s und beim geordneten Stop die Mic-Bloecke
   mit wirksamer Subtraktion, Bypass-/Filtergruende sowie Min/Max der getesteten
   Delay-Kandidaten (ms) und absoluten Korrelation. Leere Intervalle werden
   ausgelassen. `micReductionDb` ist die Energiedifferenz des Mic-Signals vor/nach
   dem Filter fuer das ganze gemessene Intervall (positiv = leiser, `n/a` bei
   fehlender Eingangsenergie); sie isoliert Echo nur im Gegenstellen-Test ohne
   Nahstimme. Es werden keine Audiodaten gespeichert oder geloggt.
4. **Lifecycle.** Referenzpuffer und Filterstatus gehoeren zur Sitzung und
   zum Geraetepaar. Pause leitet weiterhin kein Audio an Azure; bei Resume
   nach einer Luecke Warmup, ohne Azure-Session oder Sprecheraliase neu zu
   starten. Stop/Quit gibt AEC-State samt Puffern frei. Wenn der bestehende
   Capture-Pfad nach einem Geraetewechsel keine Referenz mehr liefert, bleibt
   AEC im Bypass; die Alpha fuehrt kein eigenes Hot-Swapping ein.

## Fehleranalyse (24.11.2026)

Der damalige Ein-Tap-Filter in `EchoCancellation.cs` verlangte zum Einrasten eine
Korrelation von mindestens 0,84 zu **einer** verzoegerten Kopie. Ein direkter
Schallpfad plus eine aehnlich starke Reflexion koennen jeweils darunter liegen.
Dann bleibt die Phase `WarmingUp`, und die App schickt das Mikrofon unveraendert
an Azure. Das ist mit dem unveraenderten Filter und synthetischem PCM reproduziert:
bei einem Pfad (641 Samples Verzoegerung) 13,98 dB Daempfung und 380 aktive Pakete,
bei zwei gleich starken Pfaden (641 und 823 Samples, 16 kHz) 0 dB und kein aktives
Paket. Die bisherigen Tests modellieren jeweils nur eine verzögerte Echokopie.

Die Probe belegt eine Grenze des Filters, nicht die Ursache auf dem Zielgeraet.
Die App kann auch bei fehlender oder ungueltig getakteter Loopback-Referenz
(`AudioRecorderSource.cs`, unter anderem im Resampler-Fallback) unveraendertes
Mikrofon liefern. Zur Unterscheidung auf dem Zielgeraet: ausgewaehlten
Speaker-Endpunkt und `recorder_mode` abgleichen und bei reiner Gegenstelle
`echo_cancellation` im **Debug log** pruefen. Dauerhaft `Bypass` deutet auf
Referenz-/Timingprobleme; dauerhaft `WarmingUp` auf fehlende stabile Korrelation.
Ein Hardware-Nachweis und die A/B-Abnahme bleiben in [T-519](./T-519-echo-cancellation-alpha-abnahme.md) offen.

## Gelockerte Alpha-Schwellen (24.11.2026)

| Parameter | Vorher | Neu |
|---|---:|---:|
| Mindestkorrelation (Einrasten / aktiv / Gain-Update) | 0,84 / 0,65 / 0,92 | 0,70 / 0,55 / 0,87 |
| Absoluter Gain / Verhaeltnis zum Modell | 0,03–1,25 / 0,70–1,35 | 0,015–1,75 / 0,55–1,60 |
| Delay-Suche / Trackingradius | −20 bis +200 ms / ±3 ms | −30 bis +250 ms / ±5 ms |
| Zeitstempelabstand Mic minus Referenz | −100 bis +75 ms | −125 bis +100 ms |
| Suchpause / Einrastdauer / Tracking-Verlust | 40 / 30 / 80 ms | 20 / 20 / 150 ms |
| Mindest-RMS Mic und Referenz (PCM-Einheiten) | 32 | 24 |

Die Alpha bleibt optional und bearbeitet nur Mic. Schutz fuer Clipping,
fehlende Referenz, Paketluecken und ungueltige Zeitmarken bleibt erhalten.
Die Subtraktion ist auf 80 % des kleineren absoluten Gains aus Modell und
aktuellem Block begrenzt, damit der gelockerte Gain-Abgleich nicht mehr als
den im Block geschaetzten Echoanteil entfernt. Haertere Suche kann CPU-Last
und Fehlzuordnungen erhoehen. Synthetische Regressionen pruefen einen
225-ms-Pfad mit Gain 1,5 und zwei fast gleich starke Pfade; reale
Sprachqualitaet bleibt in [T-519](./T-519-echo-cancellation-alpha-abnahme.md) offen.

## Done When
- [x] Managed-Engine ohne zusaetzliche native Abhaengigkeit integriert. Beleg: `sidecar/EchoCancellation.cs`; die Integration erfordert keine neuen Pakete.
- [x] Deterministische PCM-Tests belegen Offset/Drift, mehr als 12 dB Echoabnahme im Einpfad-Test und mehr als 8 dB weniger Fehler bei synthetischer Doppelsprache; Nahstimme ohne Echo bleibt bytegleich. Beleg: `EchoCancellationValidation.cs`; Speaker-PCM wird unveraendert an Azure uebergeben (`Program.cs`).
- [x] Fehlende Referenz, Warmup, Ringgrenze, Pause/Resume und Stop reichen Mic unveraendert durch oder geben den Filterzustand frei. Beleg: AEC-Regressionen in `EchoCancellationValidation.cs` sowie Fail-open im `EchoCancellation`-Pfad.
- [ ] Echte Windows-Capture-Queues, Rueckkehr nach Geraetestoerungen und A/B-Sprachqualitaet sind gemessen. - **offen**: Native Zielgeraete-/Azure-Abnahme folgt in T-519.

## Workboard
`4f1a482b-afa7-42a3-a933-ef145302a856`
