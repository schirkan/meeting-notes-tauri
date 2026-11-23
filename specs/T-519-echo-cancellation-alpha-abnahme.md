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

## Done When
- [ ] A/B mit Laptop-Lautsprechern und zweitem Geraetepaar belegt Nutzen gegen Doppeleintraege und Erhalt der Nahstimme bei Doppelsprache. - **offen**: Windows-Hardware und Azure-Testzugang fuer echte Transkripte sind erforderlich.
- [ ] Portable misst Verhalten bei Luecken, Resume und Last; Latenz, CPU, Queue und Drop-Zaehler sind dokumentiert. - **offen**: Dauerlauf auf Zielhardware fehlt.

## Workboard
Hardware-Abnahme: `455a9e0c-15af-4470-af29-28513028af63`.
Umsetzung der Alpha: `4f1a482b-afa7-42a3-a933-ef145302a856`.
