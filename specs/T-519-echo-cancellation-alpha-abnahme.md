# T-519: Echo cancellation (Alpha) – Hardware-Abnahme

## Kontext
Status: geplant (2 Punkte offen; nicht abgenommen)
Reifegrad: Alpha
Abhaengigkeiten: [T-517: Bedienung](./T-517-echo-cancellation-alpha.md), [T-518: Audio-Pipeline](./T-518-echo-cancellation-audio-pipeline.md), [T-502: Latenzmessung](./T-502-latency-messung.md)

## A/B-Protokoll

Mit gebautem Portable auf Windows 11 x64, Laptop-Lautsprecher + Mikrofon,
gleicher Lautstaerke, Geraetezuordnung und Sprecherposition. Dieselben kurzen
Sprechskripte mit AEC aus/an mehrfach wiederholen, Transkripte getrennt fuer
**Mic** und **Speaker** auswerten. Mindestens ein zweites Setup pruefen,
z. B. USB-Mikrofon mit Laptop-Lautsprecher und damit unabhaengiger Clock.
Nur synthetische oder freiwillig gesprochene Testsaetze; keine Meeting-Audios
in Log, Repo oder Nachweis ablegen.

| Fall | Nachweis |
|---|---|
| Nur Gegenstelle | Weniger fremde Woerter im Mic-Transkript; Speaker-Transkript bleibt nutzbar. Als Alpha-Ziel mindestens 50 % weniger fremde Woerter gegenueber reproduzierbarem Baseline-Echo; ohne messbares Baseline-Echo keine Wirksamkeit behaupten. |
| Nur Nahstimme | Keine Stummschaltung, abgeschnittene Wortanfaenge oder systematische Verschlechterung gegenueber AEC aus. |
| Beide gleichzeitig | Nahstimme bleibt verstaendlich und im Mic-Transkript. In Nahstimmen-Faellen hoechstens 5 Prozentpunkte zusaetzliche Wortfehlerrate gegenueber AEC aus (mit Skript als Referenz, Treffer und Stichprobengroesse angeben). |
| Lautstaerkewechsel, Ausgabepause, Pause/Resume | Kein dauerhafter Ausfall des Mikrofons, Referenz wird nach einer Luecke neu gefunden oder AEC bleibt im dokumentierten Bypass. |
| Ueber mindestens 30 Minuten | Keine anwachsende Queue. CPU-Auslastung, Drop-Zaehler und zusaetzliche lokale Processing-Latenz melden; Alpha-Ziel p95 hoechstens 40 ms zusaetzlich, getrennt von Azure-Netzwerklatenz. |

Die Zahlen sind Abnahmeschwellen, keine Leistungsversprechen. Ergebnisse mit
Geraetepaar, Build, Ausgangspegel und Betriebsart dokumentieren. Eine reine
PCM-Simulation ersetzt die Hardware-/Azure-Abnahme nicht. Bis zum Nachweis
bleibt der Status **Alpha**, der Schalter bleibt standardmaessig aus.

## Praxisrueckmeldung (24.11.2026)

Der Nutzer bestaetigt identische Mic-Transkripte mit und ohne AEC; Mix entspricht
zudem Speaker. Damit ist in diesem A/B-Test kein Nutzen im Mic-Transkript
nachweisbar. Identischer Text schliesst eine Pegelreduktion nicht aus.
Der Lauf mit AEC zeigt Mic und Speaker beide im Engine-Modus bei 16 kHz,
16 Bit, Mono. AEC erreicht zeitweise `Active`, faellt aber wiederholt auf
`WarmingUp` und zum Ende auf `Bypass` zurueck. Die Hardware-Abnahme bleibt offen.

### Folgelauf mit AEC-Diagnose (24.11.2026, 16:27–16:28)

Im Teams-Lauf mit aktivierter AEC wurden nur 24 von 1.671 Mic-Bloecken (1,4 %)
bearbeitet. Die drei regulaeren Intervalle zeigen 0,00 / 0,05 / 0,03 dB
Mic-Pegelreduktion; das kuerzere Schlussintervall zeigt 0,49 dB. `Off` in der
letzten Zeile stammt vom Stop. Die Pegelwerte beziehen sich auf das gesamte
Mic-Signal, nicht auf den isolierten Echoanteil.

`SearchCooldown` (1.074 Bloecke) zeigt, dass der Filter haeufig ohne stabile
Zuordnung war und dann nur alle vier Bloecke sucht. Verwerfungen wegen
Korrelation und Gain sowie wiederholte Wechsel zwischen `Active` und
`WarmingUp` stuetzen diesen Befund. Ein Intervall meldet 42 Zeitstempelabweichungen.
Die Delay-Spanne enthaelt auch verworfene Kandidaten; Treffer nahe 200 ms
belegen weder einen stabilen Delay noch eine zu enge Suchgrenze.

### Folgelauf bei minimaler Lautsprecherlautstaerke (24.11.2026, 16:31)

Der Nutzer meldet weiterhin keinen Erfolg. Mit AEC wurden 39 von 2.276
Mic-Bloecken (1,7 %) bearbeitet; die Mic-Pegelreduktion lag je Intervall bei
0,00 bis 0,29 dB. `SearchCooldown` betrifft 1.462 Bloecke; `Active` haelt
weiterhin nicht stabil. Der Lauf aendert die Lautstaerke, ist aber kein
kontrollierter A/B-Test mit und ohne AEC.

### Gegenprobe Lautsprecher/Kopfhoerer (24.11.2026, 16:35–16:36)

Beide Logs zeigen denselben Mic-Endpunkt, unterschiedliche Ausgabe-Endpunkte,
aktive Speaker-Loopbacks mit Spracherkennung und keine AEC-Diagnose. Mit
Lautsprecher meldet Azure einen Sprachbeginn auch fuer Mic. Mit Kopfhoerer
meldet der Nutzer kein Echo im Mic-Transkript; das Log enthaelt dort keinen
Mic-Sprachbeginn. `speech_end` allein belegt keinen erkannten Text. Der
Befund spricht fuer akustisches Uebersprechen, belegt aber keine AEC-Wirkung.

Naechster Schritt: akzeptierte und verworfene Delay-/Gain-Kandidaten getrennt
messen und denselben Clip bei unveraendertem Lautsprecherpegel und ohne
Nahsprache mit und ohne AEC vergleichen.
Mix ist kein Daempfungsnachweis, weil AEC nur Mic bearbeitet. Die reproduzierte
Grenze des Ein-Tap-Filters steht in
[T-518](./T-518-echo-cancellation-audio-pipeline.md#fehleranalyse-24112026).

## Done When
- [ ] A/B mit Laptop-Lautsprechern und zweitem Geraetepaar belegt Nutzen gegen Doppeleintraege und Erhalt der Nahstimme bei Doppelsprache. - **offen**: Windows-Hardware und Azure-Testzugang fuer echte Transkripte sind erforderlich.
- [ ] Portable misst Verhalten bei Luecken, Resume und Last; Latenz, CPU, Queue und Drop-Zaehler sind dokumentiert. - **offen**: Dauerlauf auf Zielhardware fehlt.

## Workboard
Hardware-Abnahme: `455a9e0c-15af-4470-af29-28513028af63`.
Umsetzung der Alpha: `4f1a482b-afa7-42a3-a933-ef145302a856`.
