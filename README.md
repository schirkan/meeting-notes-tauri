# Meeting Notes

Windows-Desktop-App zur strukturierten Erfassung von Meeting-Transkripten (**Tauri 2** + React + C# Sidecar).

Dieses Projekt ist die **Tauri-Migration** des bestehenden Electron-Projekts `projects/meeting-notes`, das als Referenz unverändert bleibt. Architektur und aktueller Funktionsumfang siehe [SPEC.md](./SPEC.md) und [DECISIONS.md](./DECISIONS.md).

> **Aenderung 2026-11-13:** Pause und Stop haben klare Semantik. **Pause** haelt die Azure-Sitzung am Leben, speist aber kein Audio zu — der pausierte Abschnitt erscheint nicht im Transkript, und die Sprecher-Zuordnung bleibt gueltig. **Stop** beendet die Sitzung endgueltig; der naechste Start beginnt ein neues Transkript mit frischer Sprecherbasis. Die Sprecher-IDs sind jetzt sessionsicher zugeordnet. Siehe [T-507](./specs/T-507-pause-stop-und-sitzungsgebundene-sprecherzuordnung.md).
>
> **Stand 2026-11-13:** Alle Referenzen und Pakete aktualisiert (TypeScript 7, .NET 10, NAudio 3.3, Speech SDK 1.53, reqwest 0.13). Das Zielsystem benütigt jetzt **.NET 10 Runtime** statt .NET 8. Siehe [T-508](./specs/T-508-abhaengigkeiten-laufzeit-und-referenzen-aktualisieren.md).
>
> **Stand 2026-11-12:** Implementierung und lokaler Portable-Build vorhanden. Settings-/Diagnose-Regressionen und Build-Smoke sind geprüft; der Corporate-Proxy-/Azure-Test war am 2026-11-12 im Firmennetz erfolgreich (HTTPS und native Speech/WSS). **Offen:** Aufnahme-Latenz und Clean-Machine-Deployment. Die [Specs](./specs/) unterscheiden implementierte Funktionen von ausstehenden Akzeptanztests.
>
> **Änderung 2026-11-11:** Eine gemeinsame Konfigurationsdatei `meeting-notes.config.json` direkt neben der EXE, MIT-Lizenz und automatischer Transkript-Export als Markdown mit Frontmatter. Siehe [T-506](./specs/T-506-transkript-markdown-export-und-frontmatter.md).

## Features (Ziel)
- Start/Stop Recording im UI sowie **Pause**/**Weiter**: die Sitzung laeuft weiter, es wird aber kein Audio zugespeist
- Live-Transkript mit Interim/Final und verbesserter Lesbarkeit
- Speaker-Badges/Farben inkl. Alias-Mapping
- Fehler-/Status-Events via Tauri-Bridge
- Kompakte dunkle Console-Oberfläche über die gesamte Fensterhöhe: eine gemeinsame Kopfzeile, Timer-Status, zentrierte Aufnahmeaktionen und direkt editierbare Sprechernamen
- Sprecherzuordnung standardmäßig ausgeblendet; **Folgen** erscheint nur nach manuellem Zurückscrollen
- Debug-Log über das Drei-Punkte-Menü einblenden: die zunächst unsichtbare Fußzeile öffnet den Logbereich beim ersten Anzeigen direkt nach oben (maximal 50 % des Inhaltsbereichs). Fehlerzähler und **Log löschen** bleiben in der Fußzeile; späteres Aus-/Einblenden erhält den Öffnungszustand.
- Persistente Einstellungen (Sprache, Devices, Sprechererkennung separat für Mic und Speaker)
- Markdown-Export mit YAML-Frontmatter: automatisches Speichern beim Ende der Aufnahme (Pfad optional, Standard ist das Anwendungsverzeichnis) sowie Kopieren in die Zwischenablage — beide erzeugen dasselbe Dokument
- C#-Sidecar (NAudio WASAPI Mic + Loopback, Azure Speech SDK, JSON-Lines nach Tauri)
- Azure Speech: pro Quelle unabhängig `ConversationTranscriber` mit Sprechererkennung oder `SpeechRecognizer` ohne Sprechererkennung. Beide Optionen sind standardmäßig aktiviert, auch bei älteren Konfigurationen ohne diese Felder.
- Mic- und Speaker-IDs werden getrennt angezeigt und zugeordnet: z. B. `Mic · Guest-1` und `Speaker · Guest-1`. Ein Klick auf den farbigen Namen im Transkript erlaubt die Bearbeitung ohne Layout-Verschiebung (Enter/Verlassen übernimmt, Escape verwirft). Aliase gelten auch für die Sprecherzuordnung und den Markdown-/Clipboard-Export. Die Zuordnung ist sessionsicher: Azure vergibt die IDs pro Sitzung neu, deshalb kann ein Alias aus einer vorigen Sitzung nicht still auf eine andere Person fallen.
- Optionale Proxy-Konfiguration für Azure Speech
- Sidecar-Resampling auf 16 kHz / 16-bit / mono
- Einstellungen mit drei Tabs: **Allgemein**, **Azure-Konfiguration** und **Proxy**. Der Dialog behält beim Tabwechsel seine Größe; Inhalte scrollen intern. Mikrofon und Sprechererkennung sowie Loopback und Sprechererkennung stehen jeweils in einer Zeile. Ein einziger **Speichern**-Button im Dialog-Footer schreibt Azure-, Proxy- und Benutzereinstellungen gemeinsam; dort steht auch der Konfigurationspfad.
- Bei leerem Transkript und gestoppter Aufnahme stehen Sprache und Audioeinstellungen direkt im Hauptbereich; **Speichern** übernimmt die Änderungen für die nächste Aufnahme. Exportoptionen bleiben im Dialog. **Löschen** im Header ist nur gestoppt möglich; manueller Markdown-Export liegt im Drei-Punkte-Menü. Responsive Grenzen: 800 px (kompakter Header), 500 px (einspaltiger Inhalt).

## Voraussetzungen
- Node gemäß `package.json`: ≥22.12.0 <23 oder ≥24.0.0 <24.16.0 (Empfehlung: 22 LTS)
- Rust Toolchain (für Tauri 2)
- .NET 10 SDK (lokal für Sidecar-Build)
- .NET 10 Runtime (auf Zielsystemen; .NET 8 wird seit dem 10.11.2026 nicht mehr unterstützt) Der Sidecar ist framework-dependent und läuft mit `RollForward=Major` auch auf neueren Runtimes; eine net9.0-Variante sowie eine Single-File-Variante (eine Datei statt 21) stehen als Build-Optionen bereit — siehe [T-512](./specs/T-512-sidecar-targetframeworks-und-single-file.md).
- Windows 11 mit WebView2 (auf Zielsystemen)

## Setup
```powershell
npm ci
```
Die Tauri-CLI ist eine devDependency; keine globale Installation erforderlich.

Fuer native Builds werden Rust stable (x64/MSVC), .NET 10 SDK sowie Visual
Studio oder Build Tools mit **Desktopentwicklung mit C++** und Windows SDK
benoetigt. MinGW/GCC wird nicht verwendet. Toolchain pruefen:

```powershell
powershell -NoProfile -File scripts\check-toolchain.ps1
```

`scripts/setup-toolchain.ps1` installiert .NET 10 SDK und Rust-MSVC; Node und
die Visual-Studio-Komponenten sind separat bereitzustellen.
`scripts/run-with-toolchain.ps1` waehlt eine passende .NET-Installation und
Rust-MSVC nur fuer den gestarteten Prozess. Der persistente PATH und Rusts
globale Standard-Toolchain werden nicht geaendert. Die Node-Pruefung liest die
Anforderung direkt aus `package.json`; ein separates `check-node.mjs` gibt es
nicht mehr.

### Azure konfigurieren
1. `meeting-notes.config.example.json` → `meeting-notes.config.json` kopieren (direkt neben die EXE bzw. ins Repository-Root im Dev-Build)
2. Speech-Key direkt im Feld `azure.speechKey` eintragen
3. Optional: Proxy unter `proxy.host`/`proxy.port` (+ optional `username`/`password`). Host ohne `http://` oder Pfad, Port 1–65535. Der HTTP-Proxy tunnelt HTTPS und Speech/WSS mittels CONNECT. Proxy-Zugangsdaten werden dem Sidecar über prozesslokale Umgebungsvariablen statt CLI-Argumenten übergeben.

Beim Start mit fehlender, nicht lesbarer oder unvollständiger Azure-Konfiguration öffnen sich die Einstellungen automatisch. Der Hinweis erscheint als schließbarer Toast unten, ohne den Hauptinhalt zu verschieben. Nach manuellem Schließen bleibt der Dialog geschlossen; eine vollständige Konfiguration öffnet ihn beim Start nicht.

### HTTPS und Speech/WSS getrennt testen
- **Verbindung testen** nutzt die aktuellen, auch ungespeicherten UI-Werte einschließlich Proxy und Sitzungssprache.
- Rust prüft DNS/TCP zum Proxy (oder direkt zum Endpoint bei deaktiviertem Proxy) und führt eine HTTPS-HEAD-Probe aus. Deaktivierter Proxy bedeutet explizite Direktverbindung, ohne automatische Umgebungsproxies. DNS am Ziel-Endpoint muss im Proxy-Modus lokal nicht funktionieren.
- **Die HTTPS-Diagnose prüft TLS-Zertifikate gegen den System-Vertrauensspeicher** (gleiche Prüfung wie der native Speech/WSS-Pfad). Ein selbstsigniertes oder TLS-inspektiertes Zertifikat ohne vertrauenswürdige Firmen-Root-CA schlägt deshalb fehl. Redirects werden nicht verfolgt. Ein erfolgreicher HTTPS-Test belegt damit eine vertrauenswürdige TLS-Verbindung, aber weiterhin keine gültigen Azure-Zugangsdaten.
- Ein separater Sidecar-Diagnoseprozess öffnet native Speech-SDK-Sitzungen für `SpeechRecognizer` und `ConversationTranscriber`, ohne Mikrofon oder Loopback aufzunehmen. Er verwendet dieselben Endpoint-/Proxy-Einstellungen wie die Aufnahme. HTTPS-Erreichbarkeit allein beweist weder gültige Azure-Zugangsdaten noch Speech/WSS-Erreichbarkeit.
- Ein separater **Verbindungstest-Dialog** zeigt den laufenden Test sowie anschließend alle Diagnose-Schritte mit Status und kopierbaren Fehlerdetails, HTTP-Status, Endpoint und Dauer. HTTPS und Speech/WSS werden getrennt ausgewiesen; insgesamt erfolgreich ist der Test nur, wenn beide funktionieren. Auch als Strings oder Objekte zurückgewiesene IPC-Aufrufe werden mit ihren Details angezeigt, nicht nur als generischer Fehler. Der Dialog lässt sich schließen und aus den Einstellungen wieder öffnen, ohne den laufenden Test abzubrechen. Die Schritte werden nach dem HTTP-Status eingestuft: `2xx` als Erfolg, `401`/`403` als Warnung (Endpoint erreichbar, Speech-Key fehlt oder ist ungültig), `407` als Fehler. Ein HTTP 401/403 bestätigt lediglich HTTP-Erreichbarkeit, nicht erfolgreiche Speech-Authentifizierung.
- Speech/WSS behält unter Windows die native Zertifikatsprüfung bei: Für das verwendete .NET Speech-SDK 1.53 wurde kein offiziell dokumentierter Abschaltmechanismus gefunden. OpenSSL-/CRL-Schalter für Linux werden nicht als Windows-Zertifikatsbypass verwendet. Bei TLS-Inspection müssen die Firmenzertifikate daher weiterhin für den nativen SDK-Transport vertrauenswürdig sein — und jetzt auch für die HTTPS-Diagnose. Die WSS-Proben erwarten sowohl `Connected` als auch `SessionStarted`; bloßes lokales Starten reicht nicht für ein positives Ergebnis.
- Der native Diagnoseprozess ist auf 45 Sekunden begrenzt; DNS-/TCP-/HTTPS-Proben haben jeweils 5 Sekunden Timeout. Dies ist keine garantierte 45-Sekunden-Obergrenze des gesamten UI-Aufrufs einschließlich Prozessstart. Einzelne Schritte erscheinen erst nach Abschluss, nicht live während der Prüfung. Der Test kann Azure-Verbindungen und gegebenenfalls Kosten verursachen, sendet aber keine aufgenommenen Audiodaten. Firmenproxy-Allowlisting, CONNECT-Unterstützung und Authentifizierung sind separat im Zielnetz zu prüfen.

### Benutzereinstellungen (optional)
1. Im Abschnitt `user` derselben Datei `meeting-notes.config.json` bei Bedarf `language` (BCP-47, z. B. `de-DE`, `en-US`), `devices` und `diarization: { "mic": true, "speaker": true }` anpassen. Fehlende Diarization-Felder werden einzeln als `true` behandelt; ausdrücklich gespeichertes `false` bleibt erhalten. Im Settings-Bereich **Allgemein** stehen zwei unabhängige Checkboxen. Gespeicherte Änderungen gelten für die nächste Aufnahme; während einer Aufnahme sind beide Checkboxen deaktiviert.
2. Mit `transcription: { "mic": true, "speaker": true }` wird festgelegt, **welche Audioquelle transkribiert wird** — nur das Mikrofon, nur der Speaker-Loopback oder beides (Standard). Fehlende Felder werden einzeln als `true` behandelt; ausdrücklich gespeichertes `false` bleibt erhalten. Eine nicht transkribierte Quelle wird nicht aufgenommen, nicht an Azure gesendet und benötigt auch kein Gerät. Die Einstellung ist **unabhängig** von `diarization`: die Diarization entscheidet nur, ob für eine Quelle die Sprechererkennung verwendet wird. Im Settings-Bereich **Allgemein** stehen dafür zwei weitere Checkboxen; die Geräteauswahl und die Sprechererkennung der jeweiligen Quelle sind deaktiviert, wenn die Quelle nicht transkribiert wird. Mindestens eine Quelle muss transkribiert werden.
3. Für den Markdown-Export stehen `transcript.markdownExport.enabled` (standardmäßig `true`) und `transcript.markdownExport.path` (optional). Ohne Pfad landet die Datei im Anwendungsverzeichnis; relative Pfade werden dort aufgelöst.
4. Die Datei wird direkt neben der EXE gelesen und gespeichert: im Release-/Portable-Build neben der EXE, im Dev-Build im Repository-Root. Das Arbeitsverzeichnis des startenden Prozesses spielt keine Rolle. Es wird nichts nach AppData kopiert und keine AppData-Konfiguration als Fallback geladen. Bisher nur in AppData gespeicherte Werte bei Bedarf manuell übernehmen.

## Entwicklung
```powershell
npm run tauri -- dev    # Native App; Sidecar-Publish automatisch via build.rs
npm run dev            # Nur Vite/Renderer, kein Tauri-Backend
npm run typecheck      # TypeScript-Prüfung
npm run build          # TypeScript + Renderer-Build
npm run tauri -- build # MSI/NSIS-Installer inklusive Sidecar
npm run verify                   # Gesamtablauf: Typecheck, Node-Tests, C#-Validierung
npm run verify -- --full           # zusätzlich: Release-Build, Portable, Smoke, Deployment
npm run measure:latency -- --live  # End-to-End-Latenz messen (T-502, braucht Aufnahmegerät)
npm run docs:specs                # Stand der Specs in SPEC.md neu erzeugen
```
>
> `npm run verify` bricht beim ersten Fehlschlag ab und gibt am Ende eine
> Zusammenfassung mit Dauer je Schritt aus. `--full` baut die Artefakte vorher
> neu und prüft sie mit - die Reihenfolge ist bewusst fest verdrahtet, damit
> niemand die Reihenfolge der Prüfungen erraten muss.
>
> Die Latenzmessung startet die App selbst und sammelt bis zu 100 Messzeilen;
> der Report landet in `context/latency-report.md` (P50/P95/P99 je Stufe).
> `--selftest` prüft Statistik und Report-Erzeugung ohne Hardware - siehe
> [T-502](./specs/T-502-latency-messung.md).

> Das C#-Sidecar wird seit `src-tauri/build.rs` automatisch per
> `dotnet publish` erzeugt, bevor Cargo kompiliert. Der frühere
> manuelle Schritt `npm run publish:sidecar` ist nicht mehr nötig —
> das Skript existiert weiterhin für Ad-hoc-Rebuilds ohne Tauri-Build.

Build-Ausgaben liegen getrennt von den C#-Quellen: Publish unter
`src-tauri/target/sidecar-publish/`, .NET-Zwischenartefakte unter
`src-tauri/target/sidecar-artifacts/`. Dadurch verändert der Publish nicht
seine eigenen überwachten Eingaben. Neue und geänderte C#-Dateien lösen
weiterhin automatisch einen Publish aus. Das Release-Profil aktiviert
inkrementelle Kompilierung und deaktiviert Debug-Informationen explizit;
Optimierungsstufe und Laufzeitverhalten bleiben unverändert.

Messung nach der Umstellung: unveraenderte `cargo build --release`-Aufrufe
ca. 0,8 s; komplette warme `tauri build --no-bundle`-Aufrufe 17,5 s und
10,0 s. Der komplette Ablauf baut den Renderer erneut und bindet dessen
Ausgabe in die EXE ein; er ist deshalb nicht mit dem reinen Cargo-Cache-Test
gleichzusetzen. Die erste Kompilierung nach Profilwechsel bleibt teurer.

> **Wichtig fuer die Auslieferung:** die EXE muss ueber die Tauri-CLI gebaut
> werden (`npm run tauri build` bzw. `tauri build --no-bundle`). Ein reines
> `cargo build --release` kompiliert dieselbe Rust-Codebasis, bettet aber
> **keine** Renderer-Assets ein - das Ergebnis startet ohne UI (gemessen:
> 15,40 MB statt 15,48 MB, der Asset-Dateiname fehlt im Binary). Der
> Smoke-Test prueft das inzwischen und weist solche EXE zurueck.

```powershell
npm run build:sidecar  # .NET-Build nach src-tauri/target/sidecar-artifacts
# Alternative TFM- und Layout-Varianten laufen ueber Umgebungsvariablen (siehe unten)
# und wirken auf den kompletten Bundle-Pfad.

### Deployment auf einem fremden Rechner pruefen

`scripts/verify-deployment.ps1` setzt die Checkliste aus
[T-510](./specs/T-510-clean-machine-deployment-windows-11.md) als ausfuehrbaren Nachweis um:
Windows-Build, WebView2-Runtime, .NET-Runtime, Integritaet aller Dateien gegen
`SHA256SUMS`, keine persoenliche Config, Platzhalter statt Credentials, `device_list`-Event
des Sidecars und die PE-Subsysteme (Haupt-EXE ohne Konsolenfenster).

```powershell
npm run verify:deployment
# oder auf dem Zielsystem direkt:
powershell -ExecutionPolicy Bypass -File .\verify-deployment.ps1 -PortableDir D:\Apps\MeetingNotes
```

Rueckgabecode 0 = keine FAIL-Pruefung. Offen bleibende Punkte werden als `MANUELL`
ausgegeben (App-Start, Settings-Dialog, Entstehung der Config neben der EXE).

Fuer eine Portable-Ausgabe mit Single-File-Sidecar (1 Datei statt 21, 23,09 MB gesamt ueber 4 Dateien).
Die Variante wurde am 2026-11-17 end-to-end nachgefahren: `sidecar-publish/` mit genau
1 Datei, Portable 23,09 MB / 4 Dateien / 3 Summen, Smoke bestanden, Deployment-Nachweis
mit App-Start PASS 10 / FAIL 0 - der Sidecar wird im Single-File-Portable gefunden.

Beide Schalter duerfen auch **gleichzeitig** gesetzt sein (`net9.0-windows` **und**
Single-File). Diese Kombination ist ebenfalls end-to-end geprueft: Portable
23,08 MB / 4 Dateien / 3 Summen, Deployment-Nachweis PASS 10 / FAIL 0. Alle vier
Kombinationen aus Ziel-Framework und Layout sind damit belegt.

```powershell
$env:MEETING_NOTES_SIDECAR_SINGLE_FILE = '1'
npm run tauri -- build --no-bundle
npm run dist:portable
```

Ohne die Variable bleibt der Standard: 21 Sidecar-Dateien, 23,19 MB ueber 24 Dateien. Der Schalter wirkt auf den kompletten Bundle-Pfad, Smoke-Test inklusive.

Fuer einen Sidecar, der auch auf .NET-9-Runtimes startet (statt zwingend .NET 10):

```powershell
$env:MEETING_NOTES_SIDECAR_TFM = 'net9.0-windows'
npm run tauri -- build --no-bundle
npm run dist:portable
```

Beide Schalter wirken auf den kompletten Bundle-Pfad. `net9.0-windows` und `net10.0-windows`
sind moeglich, alles andere wird mit klarer Meldung abgewiesen.
npm run test:sidecar   # C#-Validierung nach src-tauri/target/sidecar-validation-artifacts
npm run clean:sidecar -- --dry-run  # Cleanup nur anzeigen
```

`npm run clean:sidecar` entfernt die drei Sidecar-Artefaktordner unter
`src-tauri/target/` sowie alte `sidecar/bin`, `sidecar/obj`, `sidecar/publish`
und `sidecar/Validation/bin`/`obj`. Rust-Caches und die Portable-Ausgabe bleiben
erhalten. Die Anwendung vorher beenden; anschliessend bei Bedarf neu bauen.

UI-Regressionstests: `node --test tests/startup-ui.test.mjs` (lokaler Vite-Testserver und headless Microsoft Edge; keine Azure-Verbindungen).

### Entwicklerwerkzeuge
F12 öffnet bzw. schließt die WebView2-DevTools, auch im Release-/Portable-Build. Dazu ist das Tauri-Feature `devtools` aktiviert.

Die Geraeteabfrage beim Start und nach dem Speichern startet den Sidecar unter
Windows ohne Konsolenfenster (`CREATE_NO_WINDOW`); stdout/stderr bleiben fuer
JSON-Lines und Fehlerausgaben verfuegbar.

## Portable Build
Beim unterstuetzten x64/MSVC-Build ist der WebView2-Loader statisch in der
Haupt-EXE enthalten. Eine separate `WebView2Loader.dll` wird nicht verteilt.
Die installierte WebView2 Runtime auf dem Zielsystem bleibt erforderlich;
die Sidecar-DLLs im Unterordner `sidecar/` werden weiterhin benoetigt.

Bestehende VS-Code-Aufgabe **Build portable distribution** verwenden oder nach dem Setup:
```powershell
npm run tauri -- build --no-bundle
# Nur nach erfolgreichem Build:
npm run dist:portable
npm run test:smoke
```
`dist:portable` verpackt bereits gebaute Artefakte; es kompiliert keine aktualisierte EXE. Portable-Ausgabe: [dist/portable/](./dist/portable/). Installer entstehen separat durch `npm run tauri -- build`.

**Den gesamten Portable-Ordner verteilen.** Sidecar-EXE und alle verwalteten/nativen DLLs liegen extern in `sidecar/`, nicht eingebettet in `meeting-notes.exe`. .NET 10 Runtime (win-x64) und WebView2 müssen auf dem Zielsystem vorhanden sein.

Letzter verifizierter Portable-Build (2026-11-17, **T-201**): **23.19 MB gesamt**, davon Haupt-EXE `meeting-notes.exe` 15.56 MB und Sidecar 7.62 MB (21 Dateien); 24 Dateien einschließlich Config-Template und SHA256SUMS. Release-/Renderer-Build und `npm run test:smoke` erfolgreich: **23/23 Hashes**, native Sidecar-Geräteabfrage (0 Eingänge, 0 Ausgänge), Protokoll-Handshake des Sidecars geprüft (`protocol_version=1.0.0`). Gegenüber dem T-502-Stand (23.12 MB, Haupt-EXE 15.50 MB) ist die EXE um 60 KB gewachsen - das Protokollmodul `src-tauri/src/protocol.rs` und der Handshake-Pfad (T-201). Frühere verifizierte Messungen derselben Quelle: 23.09 MB nach T-509 (Aufnahme über `WasapiRecorderBuilder`), 23.02 MB für den Console-Design-Build, 23.10 MB nach T-511 und 23.12 MB nach T-502. Der T-201-Stand umfasst zusätzlich das Protokoll-Handshake mit Versionsabgleich. Keine persönliche Konfiguration enthalten; .NET 10 Runtime und WebView2 bleiben Voraussetzung. Kein neuer Live-Azure- oder Clean-Machine-Nachweis; MSI/NSIS wurden nicht gebaut.

## Lizenz

MIT — siehe [LICENSE](./LICENSE).

## Bekannte Einschränkungen
- Der native Azure-Speech-SDK funktioniert auch in restriktiven Netzwerkumgebungen mit erzwungenem HTTP-Proxy: am 2026-11-12 im Firmennetz erfolgreich validiert. Siehe `specs/T-505-proxy-aware-azure-transport.md`.
- Mobile-Build (iOS/Android) ist nicht im Scope.

## Querverweise
- Bestehendes Electron-Projekt: `../meeting-notes/`
- Architekturentscheidungen: [DECISIONS.md](./DECISIONS.md)
- Spezifikation: [SPEC.md](./SPEC.md)
- Tasks und Akzeptanzstatus: [specs/](./specs/)
- Settings-/Diagnose-UX: [T-403](./specs/T-403-settings-dialog-mit-verbindung-testen-button.md)
- Transportdiagnose: [T-304](./specs/T-304-connectivity-diagnose-in-rust.md)
- Corporate-Netzvalidierung (erfolgreich, 2026-11-12): [T-505](./specs/T-505-proxy-aware-azure-transport.md)