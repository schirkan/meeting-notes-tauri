# T-510: Clean-Machine-Deployment (Windows 11, .NET 10 Runtime, WebView2)

## Kontext
Status: vorbereitet (Pruefskript vorhanden und erprobt; Ausfuehrung auf dem Zielsystem steht aus)
Prioritaet: medium
Abhaengigkeiten: T-504, T-505, T-507, T-508

## Goal
Der Portable-Build wird auf einem **frischen** Windows-11-System validiert: ohne
Entwickler-Toolchain (kein Visual Studio, kein .NET SDK, kein Rust, kein Node),
ohne persoenliche Konfiguration und ohne hinterlegte Azure-Credentials.

Nachweisziel ist die **Installationsseite**: reichen die zwei dokumentierten
Voraussetzungen (.NET 10 Runtime win-x64 und WebView2 Runtime) aus, startet
die App ohne weitere Schritte, spawnt den Sidecar und laeuft fehlerfrei bis zur
Settings-Dialog-Oeffnung?

Der Aufnahme-Pfad (Mic, Loopback, Azure) bleibt davon getrennt: er benoetigt
Audio-Hardware und gehoert zum Live-Nachweis, nicht zum Deployment-Nachweis.

## Done When
- [ ] Zielsystem: Windows 11 x64, kein Visual Studio, kein .NET SDK, kein Rust, kein Node.
- [ ] WebView2 Runtime vorhanden — Version protokolliert.
- [ ] .NET 10 Desktop Runtime (win-x64) installiert — Version protokolliert.
- [ ] Portable-Ordner aus `dist/portable/` **ohne** `meeting-notes.config.json`
      kopiert; enthalten ist nur `meeting-notes.config.example.json`.
- [ ] `SHA256SUMS` auf dem Zielsystem verifiziert — **23/23**.
- [ ] `meeting-notes.exe` startet: Fenster oeffnet, **kein** Konsolenfenster sichtbar.
- [ ] `sidecar\MeetingNotes.Sidecar.exe --list-devices` liefert ein valides
      `device_list`-JSON-Lines-Event.
- [ ] Ohne gueltige Azure-Konfiguration oeffnen sich die Einstellungen automatisch
      und die Datei `meeting-notes.config.json` entsteht **direkt neben der EXE**.
- [ ] "Verbindung testen" meldet Netzwerk-/Proxy-Fehler verstaendlich im Dialog
      (kein Absturz, kein Hängen).
- [ ] Keine persoenlichen Daten im verteilten Ordner (keine Config, keine Credentials).
- [ ] Befunde sind in `T-504`, `T-500`, `SPEC.md` und `AGENTS.md` nachgezogen.

## Voraussetzungen mit Nachweis
| Voraussetzung | Nachweis auf dem Zielsystem |
|---|---|
| .NET 10 Runtime (win-x64) | `dotnet --list-runtimes` → `Microsoft.NETCore.App 10.x.x` |
| WebView2 Runtime (Evergreen) | Registry `HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}` → Wert `pv` |
| Integritaet der Dateien | `certutil -hashfile <Datei> SHA256` gegen `SHA256SUMS` |

Kein .NET **SDK** noetig — der Sidecar ist framework-dependent publiziert
(`--self-contained false`), siehe AD-006. Der WebView2-Loader ist beim
unterstuetzten MSVC-Build statisch gelinkt; eine separate
`WebView2Loader.dll` wird nicht verteilt.

## Ausfuehrbarer Nachweis
`scripts/verify-deployment.ps1` setzt die Checkliste dieses Specs als ausfuehrbaren
Nachweis um. Das Skript ist **selbststaendig** — es braucht weder Node noch Rust
noch das Repository, nur den Portable-Ordner. Auf dem Zielsystem:

```powershell
powershell -ExecutionPolicy Bypass -File .\verify-deployment.ps1 -PortableDir D:\Apps\MeetingNotes
```

Geprueft werden: Windows-11-Build, WebView2-Runtime (Registry), vorhandene .NET-Runtime
(Registry **und** Shared-Framework-Verzeichnis **und** `dotnet --list-runtimes` —
script-installierte Runtimes schreiben keinen Registry-Schlüssel), Integritaet aller Dateien
gegen `SHA256SUMS`, Abwesenheit einer persoenlichen Config, Platzhalter statt Credentials im
Template, `sidecar\\MeetingNotes.Sidecar.exe --list-devices` mit gueltigem `device_list`-Event
sowie die PE-Subsysteme (Haupt-EXE = GUI, also **kein** Konsolenfenster; Sidecar = Konsole).

Rueckgabecode 0 = keine FAIL-Pruefung. Offen bleibende Punkte werden als `MANUELL`
ausgegeben (App-Start, Settings-Dialog, Entstehung der Config neben der EXE).
Mit `-LaunchApp` startet das Skript zusaetzlich die App und prueft, ob der Prozess lebt.

Probelauf am 2026-11-17 gegen die lokale Distribution: **PASS 9 / FAIL 0** (Windows 11
Build 26300, WebView2 157.0.4341.46, .NET 10.0.13, SHA256SUMS 23/23, `device_list` mit
0 Eingängen/0 Ausgängen, Haupt-EXE PE-Subsystem 2 = GUI).

## Approach
1. **Vorbereitung (Entwicklerrechner):** `npm run dist:portable` erzeugt
   `dist/portable/`. Persoenliche `meeting-notes.config.json` vor dem
   Kopieren entfernen und die SHA256-Summenliste als Referenz mitnehmen.
2. **Zielsystem protokollieren:** Windows-Version, Edge-/WebView2-Version,
   `dotnet --list-runtimes`, freier Speicher, Antivirautyp. Ergebnis in
   dieser Spec unter "Log" festhalten.
3. **Kopieren und pruefen:** Gesamten Ordner kopieren, `SHA256SUMS` verifizieren.
4. **Start ohne Credentials:** App starten, Settings-Dialog pruefen, Config-
   Entstehung neben der EXE pruefen, Verbindungstest mit bewusst ungueltiger
   bzw. fehlender Konfiguration.
5. **Optional (nur mit Audio-Hardware):** Mic + Loopback, Aufnahme, Transkript,
   Markdown-Export mit Frontmatter, Zwischenablage sowie Pause/Stop nach T-507.

## Risiken
- WebView2 Runtime fehlt auf entfernten oder stark abgespeckten Windows-11-Images.
- .NET 10 Runtime muss **win-x64** sein (kein ARM-Build, keine .NET 8).
- Kein persoenlicher Config-Transfer: Credentials gehoeren in die
  `meeting-notes.config.json` neben der EXE und sind zu keinem Zeitpunkt Teil
  der verteilten Dateien.
- Der Sidecar-Pfad ist relativ zur EXE; der Ordner muss **vollstaendig**
  kopiert werden, nicht nur die Haupt-EXE.

## Offene Punkte
- Zielsystem noch nicht verfuegbar — kein Clean-Machine-Nachweis vorhanden. Der Nachweis
  ist aber als ausfuehrbares Skript vorbereitet (`scripts/verify-deployment.ps1`, siehe
  oben) und lokal erprobt: PASS 9 / FAIL 0.
- Die Reihenfolge ist geklaert: T-509 (Variante A, Aufnahme-Umstellung) und dieser Spec
  pruefen unterschiedliche Seiten — T-509 den Aufnahme-Pfad, T-510 die
  Installationsseite. Beide sind umgesetzt und unabhaengig voneinander.

## Log
- 2026-11-17: Checkliste in `scripts/verify-deployment.ps1` als ausfuehrbaren Nachweis
  umgesetzt und gegen die lokale Distribution erprobt (PASS 9 / FAIL 0). Zwei Befunde dabei
  korrigiert, die ausschliesslich das Skript betrafen: die Runtime-Erkennung lief nur
  ueber die Registry (script-installierte Runtimes schreiben dort nichts — jetzt auch
  Shared-Framework-Verzeichnis und `dotnet --list-runtimes`), und der Platzhalter-Regex
  liess 'DEINEN' im `<HIER-DEINEN-AZURE-SPEECH-KEY-EINTRAGEN>` aus. Am Produkt
  aenderte sich nichts.

- 2026-11-16: Spec als Vorbereitung der Alternative "b" (Clean-Machine-Deployment)
  neben T-509 (Variante A, `WasapiRecorderBuilder`) angelegt. Noch **nicht**
  ausgefuehrt; die Voraussetzungen .NET 10 Runtime und WebView2 Runtime sind
  bereits in `README.md`, `SPEC.md` und `DECISIONS.md` (AD-006) dokumentiert.
