# T-502: Latency-Messung

## Kontext
Status: teils umgesetzt (2 Punkte offen; Werkzeug fertig, die Live-Messung steht aus)
Priorität: medium
Abhängigkeiten: T-501

## Goal
End-to-End-Latenz messen: Audio-Frame im Sidecar → Azure-Transkript zurück im Renderer. Die Messmethode (Stufenmessung im Sidecar, dokumentierte Grenze am Tauri-Event) ist in `DECISIONS.md` → AD-019 festgehalten.

## Done When
- [x] Skript `scripts/measure-latency-tauri.mjs` existiert (`npm run measure:latency`). Beleg: scripts/measure-latency-tauri.mjs (measure-latency-tauri.mjs), package.json (run) (geprueft).
- [x] Misst: Beleg: scripts/measure-latency-tauri.mjs (7 Node-Assertions fuer die Statistik; Live-Modus mit App-Start verifiziert). Testnachweis: tests/latency-stats.test.mjs (7 Assertions fuer Percentile und Report); der App-Start mit MEETING_NOTES_LATENCY_LOG wurde am 2026-11-17 gemessen verifiziert.
  - Audio-Capture → Sidecar-interner Resampler → `captureLatencyMs` + `sidecarToPushMs`
  - Azure-PushStream → Azure-Response → Sidecar-Event → `azureToEventMs`
  - Sidecar-Event → JSON-Lines Pipe → Tauri-Main → `pipeToEventMs`
  - Tauri-Main → Tauri-Event → Renderer → Summe `totalMs` bis zum Tauri-Event.
    Der Renderer-Paint selbst ist von außen nicht messbar; die Kette endet
    deshalb am Tauri-Event (dokumentierte Obergrenze, kein Messfehler).
- [ ] Report `context/latency-report.md` mit P50/P95/P99 über 100 Audio-Chunks - **offen**:
  Generator und Statistik sind fertig und im Selbsttest belegt (7 Node-Assertions,
  Report-Erzeugung geprüft), die echte Datei entsteht erst mit Azure-Credentials
  und einem Aufnahmegerät.
- [ ] Ziel: P95 < 5 s End-to-End - **offen**: braucht die Live-Messung.

## Approach
- Zeitstempel an jedem Pipeline-Übergang mitloggen.
- Aggregation in Rust (Sidecar-intern) und in Node-Test-Skript (Renderer-Seite).
- Optional: Flame-Chart-Visualisierung (z. B. via Chrome DevTools-Performance-Tab im Tauri-WebView2).

## Umsetzung (2026-11-17)

Die Latenzkette wird an jedem Übergang gemessen, additiv und ohne Eingriff in
das Laufzeitverhalten:

| Stufe | Feld | Wo |
|---|---|---|
| WASAPI-Puffer → Callback | `captureLatencyMs` | Sidecar (NAudio-`LatencyMilliseconds`) |
| Callback → Azure-PushStream | `sidecarToPushMs` | Sidecar (`PushFrame`) |
| Azure-Roundtrip → Sidecar-Event | `azureToEventMs` | Sidecar (`EmitTranscript`) |
| Sidecar-Event → Tauri-Main | `pipeToEventMs` | Rust (`latency::enrich`) |
| Summe bis zum Tauri-Event | `totalMs` | Rust |

Mechanik:

- `AudioRecorderSource` reicht je Frame `capturedAtTicks` und die
  NAudio-Pufferlatenz an den Callback weiter.
- `AzureSpeechService` hält je Quelle den letzten Push-Zeitpunkt und legt
  das `latency`-Objekt in jedes Transcript-Event.
- Der Rust-Main (`src-tauri/src/latency.rs`) ergänzt die Pipe-Stufe aus
  `emittedAtUnixMs` und schreibt - **nur** wenn `MEETING_NOTES_LATENCY_LOG`
  gesetzt ist - eine NDJSON-Messzeile je Event. Im Normalbetrieb entstehen
  dadurch keine Zusatzkosten.
- `scripts/measure-latency-tauri.mjs` sammelt die Zeilen, wertet P50/P95/P99
  (Nearest-Rank) aus und schreibt `context/latency-report.md` (`context/` ist
  gitignoriert, weil die Messung maschinenspezifisch ist).

Aufruf:

```powershell
npm run measure:latency -- --selftest     # Statistik + Report ohne Hardware
npm run measure:latency -- --live          # echte Messung (startet die App)
```

Verifiziert: C#-Build 0 Fehler, Rust 2 neue Tests (Pipe-Stufe und Summe),
Zusaetzlich geprueft: der **Live-Modus** selbst ist bisher nur zur Haelfte belegt - der
Selbsttest deckt Statistik, Report-Erzeugung und Datei-Schreiben ab, der App-Start mit
gesetzter `MEETING_NOTES_LATENCY_LOG` wurde ebenfalls verifiziert (Prozess lebt nach 6 s,
Logdatei entsteht erwartungsgemaess erst mit dem ersten Event, das Polling behandelt ihr
Fehlen). **Ungeprueft bleibt der Probenfluss selbst** - er braucht eine Aufnahme mit
echten Geraeten und Azure-Credentials. Der erste Live-Lauf kann also noch an einem
Detail scheitern; das Skript meldet das mit Exit 1 und klarer Meldung.
7 Node-Assertions für die Statistik und die Report-Erzeugung, Selbsttest
erzeugt einen vollständigen Report.

## Log
- 2026-06-25: Spec angelegt.
- 2026-11-17: Werkzeug umgesetzt (Instrumentation + Skript + Tests). Live-Messung offen.