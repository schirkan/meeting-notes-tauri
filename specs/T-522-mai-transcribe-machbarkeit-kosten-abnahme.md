# T-522: MAI-Transcribe-2-Streaming – Machbarkeit, Kosten und Abnahme

## Kontext
Status: geplant (3 Punkte offen)
Quellenstand: 24.11.2026; Dokumentationsanalyse, kein Live-Nachweis.
Bezug: [T-520: Feature](./T-520-mai-transcribe-streaming-feature.md), [T-521: Sidecar](./T-521-mai-transcribe-mehrkanal-sidecar.md), [T-306: Proxy](./T-306-proxy-aware-azure-transport.md), [T-502: Latenz](./T-502-latency-messung.md), [T-510: Clean Machine](./T-510-clean-machine-deployment-windows-11.md)

## Machbarkeit und Empfehlung

| Variante | Stand | Folge |
|---|---|---|
| [Direkte MAI Realtime API](https://learn.microsoft.com/de-de/azure/ai-services/speech-service/mai-transcribe-2-streaming-realtime) | Foundry-Deployment, eigener `/mai/v1/realtime`-WebSocket, PCM16 nur Mono, manuelle Commits und max. 1 h je Sitzung dokumentiert. | Kein dokumentierter Stereo-/Kanalresultat-Pfad. Eine Mono-Sitzung mit Downmix opfert Quellen; zwei Mono-Sitzungen verfehlen das Ziel. Ein eigener Client muesste ausserdem Auth, Proxy, Commit/Drain und Event-Abbildung neu liefern. Nicht einplanen. |
| [MAI ueber Speech SDK](https://learn.microsoft.com/de-de/azure/ai-services/speech-service/mai-transcribe-2-streaming-speech-sdk?pivots=programming-language-csharp) + [SDK-Mehrkanal](https://learn.microsoft.com/de-de/azure/ai-services/speech-service/how-to-recognize-speech-multichannel?pivots=programming-language-csharp) | Separat dokumentiert: MAI mit `SpeechConfig.Model` ab SDK 1.52.0, zwei Kanaele mit `Speech_EnableMultiChannelProcessing` ab 1.51.0. Mehrkanal dokumentiert `Channel` fuer Finals und nutzt `ConversationTranscriber` fuer Diarization, aber garantiert diese Kombination nicht fuer MAI. | Bevorzugter Spike im vorhandenen SDK 1.53.1. Mittlerer bis hoher Aufwand trotz unveraenderter App-API; **MAI + Stereo in einer Sitzung nicht als zugesichert behandeln**. |
| Standard-SDK + Stereo | Die generische SDK-Mehrkanalfunktion ist dokumentiert, auch fuer `ConversationTranscriber`. | Als Opt-in implementiert (T-521), Live-Abnahme und separater Kostenbeleg fehlen; kein automatischer Fallback. |

Die [Modelluebersicht](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-transcribe-2-streaming)
listet `swedencentral`, `centralus`, `eastus2`, `southeastasia` und Public Preview
ohne SLA. Die Beispielconfig nutzt heute `westeurope`: weder die vorhandene
Ressource noch ihre Datenresidenz-Eignung fuer MAI voraussetzen. Region,
Ressourcentyp, Key und Firmenproxy in der Zielumgebung pruefen und Datenrouting
vor Live-Nutzung klaeren. SDK und Realtime API koennen dasselbe Modell nutzen,
sind aber nicht dasselbe Protokoll und koennen unterschiedlich abgerechnet werden.

## Stufenplan und Schaetzung

| Stufe | Inhalt | Personentage |
|---|---|---:|
| 0 – Spike | Isolierter C#-Test mit synthetischen beziehungsweise eingewilligten, kurzen PCM-Faellen. MAI-Nutzung explizit anhand dienstseitiger Modell-/Usage-Evidenz bestaetigen (kein stiller Standard-Fallback). Konfiguration per Region/Key und bestehenden Endpoint-Pfad, Mono/Stereo, Readiness, Resultat-Events und Proxy pruefen. | 1–2 |
| 1 – Sidecar | Gemeinsame Audio-Timeline, PCM-Mux, Event-Routing, Drain/Timeout, Diagnose und fokussierte Validierung. | 3–5 |
| 2 – App | TypeScript-Config/Settings-Draft, Rust-Validierung/Sidecar-Startparameter/Diagnose, C#-Optionen und Beispielconfig, englische Bedien-/Fehlerdoku. Keine IPC-Neugestaltung. | 2–3 |
| 3 – Abnahme | A/B, reales Billing, Proxy, Lifecycle und veroeffentlichungsnaher Portable-Build. | 2–4 |

**8–14 Personentage** bei positivem Spike; Wartezeit fuer Zugriffe, Azure-Billing
und Freigaben nicht enthalten. SDK-/Proxy-/Policy-Blocker oder ein anderer
Transport erfordern eine neue Schaetzung. Die Schaetzung stammt aus der
Historische Planung. MAI-Stereo ist nach erneut gemeldetem Fehlschlag deaktiviert (T-521); aktuelle Live-Tests fokussieren MAI-Mono ohne Sprechererkennung und Standard-Stereo mit Interim Results.

## Kosten- und Qualitaets-Gate

1. Referenz sind zwei aktive Standard-Streams mit den heute genutzten LID-/
   Sprecheroptionen. Dagegen MAI-Mono und Standard-Stereo mit derselben Audiodauer,
   Stille, Pausen und Ueberlappung messen. Isolierte Azure-Ressourcen oder
   hinreichend getrennte Messfenster nutzen. Meter-ID, Region, SKU, Waehrung,
   erfasste Nutzungsmenge, etwaige Add-ons und Nettokosten je realer Meetingstunde
   aus Azure Cost Management dokumentieren; ausschliesslich aggregierte Werte
   ablegen. Verbindungszahl ist kein Kostenbeleg: 60 Stereo-Minuten koennen
   je nach Meter als 60 oder 120 Kanalminuten oder anders abgerechnet werden.
   Beide Szenarien auch fuer repraesentative Mono-/Stereo-Nutzungsanteile rechnen.
2. [Azure Speech Pricing](https://azure.microsoft.com/en-us/pricing/details/speech/)
   und [Foundry Pricing](https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/microsoft/)
   fuer den konkreten **SDK**-Meter abgleichen. Die Speech-Seite nennt fuer ihren
   MAI-Transcribe-2-Eintrag ein befristetes Angebot bis 31.12.2026; daraus weder
   denselben Streaming-Tarif noch einen dauerhaften Preis ableiten. Freigabe nur
   bei belegtem Kostenvorteil ohne befristete Rabatte im Ziel-Nutzungsprofil;
   andernfalls bleibt die Umstellung getrennt vom Sparziel und wird nicht freigegeben.
3. Live zwei unterscheidbare DE-/EN-Sprechskripte je getrenntem Kanal, stumme
   Gegenseite und gleichzeitige Sprache abspielen; Kanalzuordnung fuer alle
   erwarteten Finals muss stimmen. Interim-Zuordnung, Sprecher-IDs mit Standard-
   Diarization, Sprachwechsel und Sprachmetadaten separat
   dokumentieren. Fehlende Sprecherfaehigkeit nur als explizit akzeptierte
   Feature-Grenze (T-520), nicht als bestanden werten. Vor dem Lauf Vergleichs-
   schwelle festlegen: Vorschlag maximal 5 Prozentpunkte hoehere Wortfehlerrate
   pro Quelle gegenueber Standard, p95 bis finales Segment unter 5 s nach T-502.
4. Nach Spike-Go: Kurz- und Langlauf (ueber 60 min oder bis zum beobachteten
   Dienstlimit), Resume innerhalb einer offenen und nach abgelaufener Sitzung,
   Stop/Auto-Stop/Quit mit letzten Finals, Verbindungsfehler, direkter Netzpfad
   und authentifizierter Firmenproxy mit TLS-Pruefung. Pro Lauf lokal und, soweit
   verfuegbar, dienstseitig nachweisen, dass nie zwei App-Recognizer-Sitzungen
   gleichzeitig aktiv sind. Windows-11-x64-Portable und getrimmten Sidecar
   inkl. sauberem Zielsystem pruefen; keine Hardware-/Cloud-Freigabe auf Basis
   synthetischer Regressionen allein. Roh-Audio, Transkripte und Keys nicht in
   Diagnoselogs oder Nachweisen ablegen.

## Go / No-Go

MAI-Stereo ist derzeit No-Go. Fuer eine spaetere MAI-Stereo-Freigabe sind ein bestaetigtes MAI-Modell, eine Stereo-Sitzung
mit sicheren Kanal-Finals und ein tragfaehiger Ressourcen-/Proxy-Pfad noetig.
MAI-Sprechererkennung scheiterte im Praxistest und ist in der App deaktiviert (T-520).
Kein stiller Downgrade auf Mix oder zwei Sessions. Freigabe fuer das Sparziel
erst nach Kosten- und Qualitaets-Gate; ein Standardwechsel ist eine separate
Entscheidung. Der lokale Virenscanner blockiert das Sidecar-Trimming; der
getrimmte Portable-Build bleibt unveraendert und muss separat abgenommen werden.

## Done When
- [ ] Spike belegt MAI-Mono-Modell, Standard-Stereo-Kanalresultate und Ziel-Proxy. - **offen**: Live-Tests mit einer geeigneten Azure-Ressource stehen aus.
- [ ] Meter und Kostenvorteil ausserhalb der Promo sind fuer die Zielnutzung belegt. - **offen**: Vertragsdaten und Azure-Usage eines kontrollierten A/B-Laufs fehlen.
- [ ] Live-Qualitaet, Lifecycle und Portable-Abnahme sind dokumentiert. - **offen**: Zielhardware, Live-Azure und Preview-Build stehen noch aus.
