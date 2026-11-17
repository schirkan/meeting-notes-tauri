# T-512: Target-Frameworks des Sidecars und Single-File-Variante

## Kontext
Status: implemented
Priorität: medium
Abhängigkeiten: T-508, T-509

## Goal
Zwei Fragen aus dem Betrieb klären und die belastbaren Antworten als
Baupfad verfügbar machen:

1. **Kann das Sidecar für .NET 8 und .NET 10 gebaut werden?**
2. **Lässt sich das Sidecar zu einer einzigen Datei zusammenführen?**

## Messungen (2026-11-17, alle empirisch)
### Frage 1 — Target-Frameworks

| Ziel | Ergebnis |
|---|---|
| `net10.0-windows` | **ja** — Build 0 Warnungen / 0 Fehler, unverändert der Standard |
| `net9.0-windows` | **ja** — Build 0 Warnungen / 0 Fehler, Publish 21 Dateien / 7,61 MB, `--list-devices` Exit 0 |
| `net8.0-windows` | **nein** — `error NU1202`: NAudio 3.3.0 ist nicht mit net8.0-windows kompatibel, das Paket unterstützt nur `net9.0` |

**Versionsunabhaengig geprueft (2026-11-17):** die Antwort haengt nicht an der
gepinnten NAudio-Version. Aus dem NuGet-Index (71 Versionen) wurden die
`lib/`-Ordner und die `dependencyGroups` aus den NUSPECs geprueft:
NAudio **3.3.0** -> `lib/net9.0`, und die neueste Veroeffentlichung
**3.4.0-preview.1** -> ebenfalls `lib/net9.0`. Es gibt keine NAudio-3.x-Version
mit `net8.0`-Unterstuetzung.

**Warum .NET 8 nicht möglich ist:** NAudio 3.3.0 liefert ausschließlich eine
`net9.0`-Bibliothek. Die Alternative wäre ein Downgrade auf NAudio 2.2.1 —
das bringt zwar eine `net6.0`-Bibliothek mit (und damit .NET-8-Tauglichkeit),
aber **NAudio 2.x kennt `WasapiRecorder` und `WasapiRecorderBuilder` nicht**
(nachgewiesen: `error CS0246`). Ein .NET-8-Build würde damit T-509 zurücknehmen
und wieder auf die obsoleten `WasapiCapture`/`WasapiLoopbackCapture` mit
`#pragma warning disable CS0618` zurückfallen. **Das ist bewusst nicht gemacht** —
der Gewinn eines .NET-8-Ziels wiegt den Verlust der Wartbarkeit nicht auf.

**Was stattdessen gilt:** `net9.0-windows` ist das niedrigste von NAudio 3.3.0
unterstützte TFM. Mit `RollForward=Major` startet ein net9.0-Build auf .NET 9,
10 und 11+ — nachgewiesen über `DOTNET_ROLL_FORWARD=LatestMajor` (Exit 0).
Ein Rollforward auf **ältere** Runtimes gibt es nicht; .NET 8 bleibt damit
technisch unerreichbar.

### Frage 2 — eine einzige Datei

| Variante | Ergebnis |
|---|---|
| Framework-dependent, 21 Dateien (Standard) | Haupt-EXE 0,16 MB + 17 DLLs, gesamt 7,62 MB |
| **Framework-dependent + `PublishSingleFile`** | **1 Datei, 7,61 MB**, `--list-devices` Exit 0 |
| Self-contained + `PublishSingleFile` + Kompression | 6 Dateien, 41,92 MB (die Speech-Native-DLLs liegen daneben) |

**Kompression ist nur self-contained möglich** (`error NETSDK1176`). Für die
framework-dependent-Variante ist die einzelne Datei also **7,61 MB statt
7,62 MB in 21 Dateien** — die Größe bleibt, die Dateizahl kollabiert.

**Startzeitvergleich** (3 Läufe, `--list-devices`):

| Variante | Startzeiten |
|---|---|
| 21 Dateien | 689 / 185 / 203 ms |
| 1 Datei (Single-File) | 207 / 211 / 173 ms |
| self-contained, komprimiert | 238 / 235 / 221 ms |

Kein messbarer Nachteil für die Single-File-Variante.

**Native-DLL-Nachweis** (der eigentliche Risikopunkt: das Speech-SDK lädt
native DLLs nach): `--test-connectivity` liefert für **alle drei** Varianten
**identische Schritt-Sets** — `speech_proxy: ok`, `speech_recognizer_wss: error`,
`conversation_transcriber_wss: error` (der Endpunkt war absichtlich tot).
Die nativen Speech-DLLs werden also auch aus dem Single-File-Bundle korrekt
gefunden.

## Umsetzung
- `sidecar/MeetingNotes.Sidecar.csproj`: `<TargetFrameworks>net9.0-windows;net10.0-windows</TargetFrameworks>`
  und `<RollForward>Major</RollForward>`.
- `src-tauri/build.rs` und `npm run publish:sidecar`: beim Publish muss das TFM
  explizit mit `-f` benannt werden, sonst bricht der Publish bei Multi-Target
  mit NETSDK1047 ab. Standard ist `net10.0-windows`.
- **Keine eigenen Publish-Skripte:** Beide Varianten laufen ueber Umgebungsvariablen
  im `build.rs` und damit ueber den kompletten Bundle-Pfad (siehe unten).

**Der Standard-Build bleibt unverändert:** net10.0-windows, framework-dependent,
21 Dateien im `sidecar/`-Ordner. Single-File und net9 sind **Optionen**, kein
Umbau des ausgelieferten Artefakts — der Portable-Build und die bestehende
Verifikation bleiben damit unberührt.

## Verifikation
- Multi-Target-Build: beide TFMs bauen mit 0 Warnungen / 0 Fehler.
- net9.0-Publish: 21 Dateien / 7,61 MB, `runtimeconfig.json` mit
  `"rollForward": "Major"`, `--list-devices` Exit 0.
- net9.0-Build auf .NET-10-Runtime: `DOTNET_ROLL_FORWARD=LatestMajor` → Exit 0.
- Single-File: 1 Datei / 7,61 MB, `--list-devices` Exit 0, identische
  Diagnose-Schritte wie die 21-Dateien-Variante.

## Bundle-Pfad (Single-File end-to-end)
Der Schalter `MEETING_NOTES_SIDECAR_SINGLE_FILE=1` in `src-tauri/build.rs` schaltet
den Single-File-Publish für den **kompletten Tauri-Bundle-Pfad** zu, nicht nur für
das Publish-Skript. Damit ist die Variante end-to-end testbar:

```powershell
$env:MEETING_NOTES_SIDECAR_SINGLE_FILE = '1'
npm run tauri -- build --no-bundle
npm run dist:portable
npm run test:smoke
```

Gemessen (2026-11-17):

| | Standard | Single-File |
|---|---|---|
| `src-tauri/target/sidecar-publish/` | 21 Dateien | **1 Datei** (`MeetingNotes.Sidecar.exe`, 7,61 MB) |
| Portable gesamt | 23,10 MB / 24 Dateien / 23 Summen | **23,09 MB / 4 Dateien / 3 Summen** |
| Smoke-Test | bestanden (23/23) | **bestanden (3/3)** |

### TFM-Schalter
Der zweite Schalter `MEETING_NOTES_SIDECAR_TFM` (zulaessig: `net9.0-windows` und
`net10.0-windows`, Standard `net10.0-windows`) waehlt das Ziel-Framework des
Bundle-Builds. Damit ist auch die net9.0-Variante end-to-end erreichbar. Vorher war
sie nur ueber ein eigenes Publish-Skript erreichbar und kam deshalb **nie im
Artefakt** an — eine Inkonsistenz, die die Umgebungsvariable behebt.

Gemessen: net9.0 durch den Bundle-Pfad ergibt 21 Dateien mit `tfm=net9.0`,
`rollForward=Major`, Portable 23,09 MB / 24 Dateien / 23 Summen, Smoke-Test bestanden.
Ungueltige Werte werden mit klarer Meldung abgewiesen, statt still zu einem
anderen TFM zu fuehren.

### Re-Verifikation nach dem Rust-Refactoring

Die Pfadaufloesung wurde anschliessend in `sidecar_candidates(exe_dir, exe)`
herausgezogen und durch den Test
`sidecar_candidates_cover_portable_and_single_file_layouts` abgesichert
(24 Rust-Tests statt 23). Damit stand der Single-File-Nachweis zunaechst nur
auf dem Unit-Test. **End-to-end nachgefahren** (2026-11-17, HEAD `6af00ff`):

| Pruefung | Ergebnis |
|---|---|
| `sidecar-publish/` | 1 Datei (`MeetingNotes.Sidecar.exe`, 7,61 MB) |
| Portable gesamt | 23,09 MB / 4 Dateien / 3 Summen |
| Smoke-Test | bestanden (3/3) |
| Deployment-Nachweis mit `-LaunchApp` | **PASS 10 / FAIL 0** - App startet, Sidecar wird gefunden |

Der Rust-Main findet den Single-File-Sidecar damit nicht nur per Unit-Test,
sondern im echten Start.

**Die net9.0-Variante wurde genauso nachgefahren** (gleicher Lauf, TFM-Schalter
`MEETING_NOTES_SIDECAR_TFM=net9.0-windows`):

| Pruefung | Ergebnis |
|---|---|
| `runtimeconfig.json` | `"version": "9.0.0"`, `"rollForward": "Major"` |
| `sidecar-publish/` | 21 Dateien (net9.0-Build) |
| Portable gesamt | 23,09 MB / 24 Dateien / 23 Summen |
| Smoke-Test | bestanden (23/23) |
| Deployment-Nachweis mit `-LaunchApp` | **PASS 10 / FAIL 0** |

Beide Ziel-Frameworks sind damit nach dem Rust-Refactoring end-to-end belegt -
nicht nur der Standard.

**Vollstaendige Matrix (alle vier Kombinationen, jeweils mit laufender App):**

| TFM | Layout | Sidecar | Portable | Smoke | Deployment |
|---|---|---|---|---|---|
| net10.0-windows | 21 Dateien (Standard) | 0,16 MB + 20 DLLs | 23,10 MB / 24 Dateien / 23 Summen | bestanden | PASS 10 / FAIL 0 |
| net9.0-windows | 21 Dateien | 0,16 MB + 20 DLLs | 23,09 MB / 24 Dateien / 23 Summen | bestanden | PASS 10 / FAIL 0 |
| net10.0-windows | Single-File | 1 Datei (7,61 MB) | 23,09 MB / 4 Dateien / 3 Summen | bestanden | PASS 10 / FAIL 0 |
| **net9.0-windows** | **Single-File** | **1 Datei (7,61 MB)** | **23,08 MB / 4 Dateien / 3 Summen** | **bestanden** | **PASS 10 / FAIL 0** |

Die letzte Zeile war die einzige ungeprueft gebliebene Kombination: beide Schalter
gleichzeitig gesetzt (`MEETING_NOTES_SIDECAR_TFM=net9.0-windows` **und**
`MEETING_NOTES_SIDECAR_SINGLE_FILE=1`). Sie funktioniert - die Schalter in
`build.rs` beeinflussen sich nicht gegenseitig.

### Findet der Rust-Main den Single-File-Sidecar?

Der Sidecar wird als externe Datei gestartet, und `resolve_sidecar_path` sucht sie
unter anderem unter `EXE-Ordner/sidecar/<exe>` (portable Layout) und
`EXE-Ordner/<exe>` (Fallback). Beiderlei Pfade sind im Single-File-Portable
vorhanden, weil die Datei `MeetingNotes.Sidecar.exe` **denselben Namen** behält —
nur ihr Inhalt ist gebündelt. Gemessen am 2026-11-17:

| | Ergebnis |
|---|---|
| `EXE-Ordner/sidecar/MeetingNotes.Sidecar.exe` | **existiert** (Rust-Pfad 3) |
| `EXE-Ordner/MeetingNotes.Sidecar.exe` | existiert nicht (Rust-Pfad 4, nicht nötig) |
| App-Start mit Single-File-Sidecar | **PASS** (Prozess läuft nach 6 s) |
| Regressionstest | `sidecar_candidates_cover_portable_and_single_file_layouts` (Rust) |

| Deployment-Prüfung | PASS 10 / FAIL 0 (3/3 SHA256-Summen) |
| Smoke-Test | bestanden (3/3) |

Die Dateiname-Kompatibilität war damit der entscheidende Punkt: `PublishSingleFile`
ändert den Inhalt der EXE, nicht ihren Namen.

Der `dist-portable.mjs`-Pfad und der Tauri-Resource-Glob
(`target/sidecar-publish/*` → `sidecar/`) arbeiten mit beiden Layouts, ohne Änderung.

Damit ist die offene Frage aus der ersten Fassung dieser Spec erledigt: Die
Single-File-Variante war nicht nur technisch möglich, sondern ist über den
Bundle-Pfad vollständig erreichbar und verifiziert.

## Offene Punkte
- Die Single-File-Variante ist als **Option** umgesetzt, nicht als Standard: der
  ausgelieferte Portable-Build bleibt der 21-Dateien-Build. Sie ist aber ueber
  `MEETING_NOTES_SIDECAR_SINGLE_FILE=1` im `build.rs` durch den kompletten
  Tauri-Bundle-Pfad erreichbar und verifiziert (siehe Bundle-Abschnitt).
- .NET 8 bleibt unerreichbar (siehe oben) — NAudio 3.x ist die harte Grenze.

## Log
- 2026-11-17: Beide Fragen empirisch beantwortet. Multi-Target
  `net9.0-windows;net10.0-windows` mit `RollForward=Major` eingefuehrt;
  `-f` beim Publish ergaenzt; beide Varianten ueber Umgebungsvariablen im
  `build.rs` (`MEETING_NOTES_SIDECAR_TFM`, `MEETING_NOTES_SIDECAR_SINGLE_FILE`).
  (NU1202 durch NAudio 3.3.0; NAudio 2.x ohne `WasapiRecorderBuilder`).
  Single-File als Option: 1 Datei / 7,61 MB, Startzeit ohne Nachteil, native
  Speech-DLLs nachweislich korrekt geladen.