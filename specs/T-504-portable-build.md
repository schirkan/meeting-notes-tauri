# T-504: Portable Build (Windows, unsigniert)

## Kontext
Status: umgesetzt
Priorität: high
Abhängigkeiten: T-503

## Goal
Portable Variante der Tauri-App, die ohne Installation läuft.

Der unterstuetzte MSVC-Build linkt den WebView2-Loader statisch. Eine separate
`WebView2Loader.dll` ist nicht Teil der Portable-Ausgabe; nur WebView2 Runtime
bleibt erforderlich. Der komprimierte, konservativ getrimmte Self-contained-Sidecar
buendelt seine .NET-Runtime und seine Abhaengigkeiten.

## Done When
- [x] `npm run dist:portable` erzeugt einen Ordner `dist/portable/` mit: Beleg: package.json (run) (geprueft).
  - [x] `MeetingNotes.exe` (App, unsigniert)
  - [x] `MeetingNotes.Sidecar.exe` (self-contained, komprimiertes/getrimmtes Single-File, direkt neben der App)
  - [x] `MeetingNotes.config.example.json` — die Config-Vorlage wird mitgeliefert; keine persönlichen Configs oder Credentials.
- [x] Portable-Build auf frischem Windows 11 mit WebView2 ohne installierte .NET-Runtime validiert. Beleg: manuelle Nutzerabnahme vom 28.11.2026; Umfang und Grenzen siehe [T-510](./T-510-clean-machine-deployment-windows-11.md).
- [x] SHA256SUMS-Datei wird erzeugt und geprüft: **3 Summen** fuer App-EXE, Sidecar-EXE und Config-Template; **4 Dateien** inklusive SHA256SUMS. Beleg: scripts/dist-portable.mjs; Testnachweis: portable build packages consistently named files without a sidecar directory.
- [x] Bundle-Größe wird im Build-Output geloggt (App-EXE / Sidecar / Config-Template / SHA256SUMS / Gesamt). Beleg: scripts/dist-portable.mjs (Ausgabe: Tauri-EXE, Sidecar, Config-Template, SHA256SUMS, Gesamtgroesse).

## Approach
- `scripts/dist-portable.mjs` orchestriert: Prereq-Check → Clean → Copy (`MeetingNotes.exe`, `MeetingNotes.Sidecar.exe`, optional `MeetingNotes.config.example.json`) → SHA256-Summen via Streaming-Hash (`createReadStream` + `pipeline`) → Summary-Output. Mehr als eine Datei im Sidecar-Publish wird vor dem Clean abgewiesen.
- Sidecar-Publish läuft automatisch via `src-tauri/build.rs` (siehe `DECISIONS.md → AD-009`); das portable Skript nimmt das Ergebnis aus `src-tauri/target/sidecar-publish/`.
- **Gesamten Ordner verteilen**, nicht nur `MeetingNotes.exe`: `MeetingNotes.Sidecar.exe` liegt direkt daneben und buendelt die .NET-Runtime und ihre verwalteten/nativen Abhaengigkeiten. Zielsystem benoetigt nur WebView2, keine .NET-Installation.
- Azure-/Benutzereinstellungen stehen in `MeetingNotes.config.json` direkt neben der Release-EXE, unabhängig vom Start-Arbeitsverzeichnis; kein AppData-Fallback. Mit fehlender gültiger Azure-Konfiguration öffnen sich die Einstellungen automatisch.
- Bestehende VS-Code-Aufgabe **Build portable distribution** führt Installation gemäß Lockfile, `npm run tauri -- build --no-bundle` und `npm run dist:portable` aus. Das Packaging-Skript allein kompiliert keine aktualisierte EXE.
- F12-DevTools sind auch im Release-/Portable-Build verfügbar (siehe [T-101](./T-101-tauri-2-scaffold-mit-react-und-vite.md)).
- Tauri-Bundle-Konfiguration (`bundle.targets: ["nsis", "msi"]`) bleibt für Installer-Distribution aktiv und unabhängig vom portable-Pfad.

## Log
- 2026-11-17: Handshake-Quittung im Sidecar akzeptiert und fehlerhafte Byte-pro-Wandzeit-Umschaltung bei sporadischem Loopback entfernt. Initialisierungsfehler nutzen weiterhin den Resampler. Opt-in-Hardwaretest: 7 Assertions ueber 5 s PASS (nur Loopback, kein Mikrofon/Azure/Audiodateien); bestehende Validierung 521 Assertions PASS, MediaFoundation-Stichprobe SKIPPED. Portable neu gebaut: 30,67 MiB / 4 Distributionsdateien, Smoke 3/3 und Deployment 9 PASS / 0 FAIL. Persoenliche Config anschliessend bytegleich wiederhergestellt.
- 2026-11-17: Falschen 15-s-Handshake-Abbruch durch Trennung von flachen Logzeilen und Payload-Events korrigiert. Nativer Exportordner-Picker (tauri-plugin-dialog 2.8.4), vertikale Audioquellen mit Sprechererkennung rechts und Fenster 950 x 650 umgesetzt. README ins Englische mit Emoji-Abschnittstiteln uebersetzt. Verifiziert: 39 UI-Tests, 35 Rust-Tests, Typecheck, Tauri-Release-Build, Smoke 3/3 und Deployment 9 PASS / 0 FAIL. Portable 30,67 MiB / 4 Distributionsdateien (Haupt-EXE 15,92 MiB, Sidecar 14,74 MiB); persoenliche Config anschliessend bytegleich wiederhergestellt.
- 2026-11-17: UI-Autosave, Dialog-Schliessen bei erfolgreichem Speichern, zeilenweise Log-Fehlerfarbe und manuellen Neustart nach Sidecar-Crash eingebaut. 37 UI-Tests und 33 Rust-Tests bestanden; Typecheck, kanonischer Tauri-Build, Smoke 3/3 und Deployment 9 PASS / 0 FAIL erfolgreich. Portable 30,23 MiB / 4 Distributionsdateien (Haupt-EXE 15,49 MiB, Sidecar 14,74 MiB). Persoenliche Config nach der Deployment-Pruefung bytegleich wiederhergestellt; sie gehoert nicht zu den vier Distributionsdateien.
- 2026-11-17: Nach dem Rebuild entstand im verwendeten Portable erneut eine persoenliche Config; diese wurde nicht geloescht oder veraendert. Der Hygiene-Check meldet dort deshalb erwartungsgemaess FAIL. Eine separate Kopie der vier unveraenderten Distributionsdateien besteht die korrigierte Self-contained-Probe und alle Deployment-Pruefungen mit 9 PASS / 0 FAIL. Vor Weitergabe die persoenliche Config nicht mitverteilen.
- 2026-11-17: Standard auf self-contained + Kompression + konservatives Trimming umgestellt. Sidecar 14,74 MiB, Haupt-EXE 15,48 MiB, Portable 30,22 MiB / 4 Dateien / 3 Summen. Smoke (inklusive Self-contained-Probe beider Sidecar-EXEs) und Deployment 9 PASS / 0 FAIL bestanden. 521 Sidecar-Assertions inklusive der publizierten EXE bestanden; Resampler-Hardwareprobe SKIPPED. Keine Installer, keine persoenliche Config im neuen Portable; vorhandene Config vor dem angeforderten Ueberschreiben separat gesichert. Azure-/Audio-Live-Test und Clean-Machine-Nachweis bleiben offen.
- Flaches Single-File-Portable neu gebaut: `MeetingNotes.exe` (15,59 MB), `MeetingNotes.Sidecar.exe` (7,62 MB), `MeetingNotes.config.example.json` und `SHA256SUMS` direkt nebeneinander. Gesamt 23,20 MB / 4 Dateien; Smoke 3/3 Hashes, Deployment mit `-LaunchApp` 10 PASS / 0 FAIL. Regressionstests pruefen das Layout und die Ablehnung zusaetzlicher Sidecar-Dateien vor dem Clean.
- 2026-11-16: Portable nach der T-511-Umstellung (auswählbare Transkriptions-Quelle) neu gebaut: Release-/Renderer-Build, Packaging und Smoke-Test erfolgreich. Haupt-EXE 15.48 MB, Sidecar 7.62 MB (21 Dateien), Gesamt 23.10 MB / 24 Dateien / 23 geprüfte Hashes. Native Geräteabfrage: 0 Eingänge, 0 Ausgänge. Keine persönlichen Configs mitgeliefert; keine Installer und kein Clean-Machine-Test.
- 2026-11-16: Portable nach der T-509-Umstellung neu gebaut: Release-/Renderer-Build, Packaging und Smoke-Test erfolgreich. Haupt-EXE 15.47 MB, Sidecar 7.61 MB (21 Dateien), Gesamt 23.09 MB / 24 Dateien / 23 gepruefte Hashes. Native Geraeteabfrage: 0 Eingaenge, 0 Ausgaenge. Keine persoenlichen Configs mitgeliefert; keine Installer und kein Clean-Machine-Test.
- 2026-11-16: Temporäre Browser-Vorschau beendet und beide Preview-Hilfsdateien entfernt. Portable mit aktuellem Settings-Footer, regulären Tab-Hintergründen und symmetrischem Settings-Zahnrad neu gebaut. 23.02 MB / 24 Distributionsdateien / 23 geprüfte Hashes; Smoke-Test erfolgreich. Persönliche lokale Konfiguration gesichert und unverändert wiederhergestellt, nicht Teil des Distributionsmanifests.
- 2026-11-16: Vollständiger Neuaufbau nach geleertem Rust-Target inklusive aktuellem Settings-Footer: Renderer, Rust-Release und C#-Sidecar neu gebaut; Rust-Kompilierung 2 min 05 s. Portable unverändert 23.02 MB / 24 Distributionsdateien / 23 geprüfte Hashes; Smoke-Test erfolgreich. Vorhandene persönliche Portable-Konfiguration vor dem Build gesichert und danach hashgleich wiederhergestellt; sie gehört nicht zum Distributionsmanifest und ist vor Weitergabe zu entfernen.
- 2026-11-16: Portable mit Console-Design neu gebaut: Release-/Renderer-Build, Packaging und Smoke-Test erfolgreich. Haupt-EXE 15.40 MB, Sidecar 7.61 MB (21 Dateien), Gesamt 23.02 MB / 24 Dateien / 23 geprüfte Hashes. Native Geräteabfrage: 0 Eingänge, 1 Ausgang. Keine persönlichen Configs mitgeliefert; keine Installer und kein Clean-Machine-Test.
- 2026-06-25: Spec angelegt.
- 2026-06-26: `scripts/dist-portable.mjs` + `npm run dist:portable` implementiert. Config-Templates als optional markiert (gehört zu T-103/T-305).
- 2026-11-13: Portable nach der Paket-Aktualisierung neu gebaut (T-508): Haupt-EXE 15.44 MB, Sidecar 8.06 MB (24 Dateien), Gesamt 23.50 MB, 27 Dateien, 26/26 SHA256-Summen. Der Sidecar waechst, weil NAudio 3.x die Capture-Assemblies als Teilpakete ausliefert; die Haupt-EXE waechst durch reqwest 0.13 mit rustls-Platform-Verifier.
- 2026-11-13: Portable nach der Pause-/Stop-Umsetzung neu gebaut (T-507): Haupt-EXE 14.19 MB, Sidecar 6.77 MB, Gesamt 20.96 MB, 26 Dateien, 25/25 SHA256-Summen. Smoke-Test bestütigt.
- 2026-11-09: Portable neu gebaut und Smoke-Test erfolgreich, alle 26 Hashes geprüft. Haupt-EXE 14.03 MB, Sidecar 6.76 MB, Gesamt 20.79 MB. Aktueller Build enthält drei Settings-Bereiche, Azure-Testbutton, Config-Footer, relative Pfade und separaten Diagnose-Dialog; MSI/NSIS heute nicht neu gebaut.