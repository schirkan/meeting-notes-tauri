# T-504: Portable Build (Windows, unsigniert)

## Kontext
Status: teils umgesetzt (1 Punkt offen)
Priorität: high
Abhängigkeiten: T-503

## Goal
Portable Variante der Tauri-App, die ohne Installation läuft.

Der unterstuetzte MSVC-Build linkt den WebView2-Loader statisch. Eine separate
`WebView2Loader.dll` ist nicht Teil der Portable-Ausgabe; WebView2 Runtime und
die externen Sidecar-Abhaengigkeiten bleiben erforderlich.

## Done When
- [x] `npm run dist:portable` erzeugt einen Ordner `dist/portable/` mit:
  - [x] `meeting-notes.exe` (App, unsigniert)
  - [x] `sidecar/MeetingNotes.Sidecar.exe` + DLLs (framework-dependent)
  - [x] `meeting-notes.config.example.json` — die Config-Vorlage wird mitgeliefert; keine persönlichen Configs oder Credentials.
- [ ] Portable Build auf einem **frischen** Windows-11-System mit .NET 10 Runtime und WebView2 validiert. Bisherige native Tests erfolgten nur auf dem lokalen Entwicklungsrechner. **Verfahren und Nachweisschritte: [T-510](./T-510-clean-machine-deployment-windows-11.md)** (Vorbereitung, Ausfuehrung offen).
- [x] SHA256SUMS-Datei wird erzeugt und geprüft. Stand 2026-11-16: **23 Summen** für 1 App-EXE + 21 Sidecar-Dateien + 1 Config-Template; **24 Dateien** inklusive SHA256SUMS. `npm run test:smoke` bestätigt 23/23 Hashes.
- [x] Bundle-Größe wird im Build-Output geloggt (App-EXE / Sidecar / Config-Template / SHA256SUMS / Gesamt).

## Approach
- `scripts/dist-portable.mjs` orchestriert: Prereq-Check → Clean → Copy (`meeting-notes.exe`, `sidecar/*`, optional `meeting-notes.config.example.json`) → SHA256-Summen via Streaming-Hash (`createReadStream` + `pipeline`) → Summary-Output.
- Sidecar-Publish läuft automatisch via `src-tauri/build.rs` (siehe `DECISIONS.md → AD-009`); das portable Skript nimmt das Ergebnis aus `src-tauri/target/sidecar-publish/`.
- **Gesamten Ordner verteilen**, nicht nur `meeting-notes.exe`: Sidecar-EXE und verwaltete/native DLLs liegen extern in `sidecar/` und sind nicht in die Haupt-EXE eingebettet. Zielsystem benötigt .NET 10 Runtime (win-x64) und WebView2.
- Azure-/Benutzereinstellungen stehen in `meeting-notes.config.json` direkt neben der Release-EXE, unabhängig vom Start-Arbeitsverzeichnis; kein AppData-Fallback. Mit fehlender gültiger Azure-Konfiguration öffnen sich die Einstellungen automatisch.
- Bestehende VS-Code-Aufgabe **Build portable distribution** führt Installation gemäß Lockfile, `npm run tauri -- build --no-bundle` und `npm run dist:portable` aus. Das Packaging-Skript allein kompiliert keine aktualisierte EXE.
- F12-DevTools sind auch im Release-/Portable-Build verfügbar (siehe [T-101](./T-101-tauri-2-scaffold-mit-react-und-vite.md)).
- Tauri-Bundle-Konfiguration (`bundle.targets: ["nsis", "msi"]`) bleibt für Installer-Distribution aktiv und unabhängig vom portable-Pfad.

## Log
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