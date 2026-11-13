# T-504: Portable Build (Windows, unsigniert)

## Kontext
Status: implemented
Priorität: high
Abhängigkeiten: T-503

## Goal
Portable Variante der Tauri-App, die ohne Installation läuft.

## Done When
- [x] `npm run dist:portable` erzeugt einen Ordner `dist/portable/` mit:
  - [x] `meeting-notes.exe` (App, unsigniert)
  - [x] `sidecar/MeetingNotes.Sidecar.exe` + DLLs (framework-dependent)
  - [x] `meeting-notes.config.example.json` — die Config-Vorlage wird mitgeliefert; keine persönlichen Configs oder Credentials.
- [ ] Portable Build auf einem **frischen** Windows-11-System mit .NET 8 Runtime und WebView2 validiert. Bisherige native Tests erfolgten nur auf dem lokalen Entwicklungsrechner.
- [x] SHA256SUMS-Datei wird erzeugt und geprüft. Stand 2026-11-13: **25 Summen** für 1 App-EXE + 23 Sidecar-Dateien + 1 Config-Template; **26 Dateien** inklusive SHA256SUMS. `npm run test:smoke` bestätigt 25/25 Hashes.
- [x] Bundle-Größe wird im Build-Output geloggt (App-EXE / Sidecar / Config-Template / SHA256SUMS / Gesamt).

## Approach
- `scripts/dist-portable.mjs` orchestriert: Prereq-Check → Clean → Copy (`meeting-notes.exe`, `sidecar/*`, optional `meeting-notes.config.example.json`) → SHA256-Summen via Streaming-Hash (`createReadStream` + `pipeline`) → Summary-Output.
- Sidecar-Publish läuft automatisch via `src-tauri/build.rs` (siehe `DECISIONS.md → AD-009`); das portable Skript nimmt das Ergebnis aus `sidecar/publish/sidecar/`.
- **Gesamten Ordner verteilen**, nicht nur `meeting-notes.exe`: Sidecar-EXE und verwaltete/native DLLs liegen extern in `sidecar/` und sind nicht in die Haupt-EXE eingebettet. Zielsystem benötigt .NET 8 Runtime (win-x64) und WebView2.
- Azure-/Benutzereinstellungen stehen in `meeting-notes.config.json` direkt neben der Release-EXE, unabhängig vom Start-Arbeitsverzeichnis; kein AppData-Fallback. Mit fehlender gültiger Azure-Konfiguration öffnen sich die Einstellungen automatisch.
- Bestehende VS-Code-Aufgabe **Build portable distribution** führt Installation gemäß Lockfile, `npm run tauri -- build --no-bundle` und `npm run dist:portable` aus. Das Packaging-Skript allein kompiliert keine aktualisierte EXE.
- F12-DevTools sind auch im Release-/Portable-Build verfügbar (siehe [T-101](./T-101-tauri-2-scaffold-mit-react-und-vite.md)).
- Tauri-Bundle-Konfiguration (`bundle.targets: ["nsis", "msi"]`) bleibt für Installer-Distribution aktiv und unabhängig vom portable-Pfad.

## Log
- 2026-06-25: Spec angelegt.
- 2026-06-26: `scripts/dist-portable.mjs` + `npm run dist:portable` implementiert. Config-Templates als optional markiert (gehört zu T-103/T-305).
- 2026-11-13: Portable nach der Pause-/Stop-Umsetzung neu gebaut (T-507): Haupt-EXE 14.19 MB, Sidecar 6.77 MB, Gesamt 20.96 MB, 26 Dateien, 25/25 SHA256-Summen. Smoke-Test bestütigt.
- 2026-11-09: Portable neu gebaut und Smoke-Test erfolgreich, alle 26 Hashes geprüft. Haupt-EXE 14.03 MB, Sidecar 6.76 MB, Gesamt 20.79 MB. Aktueller Build enthält drei Settings-Bereiche, Azure-Testbutton, Config-Footer, relative Pfade und separaten Diagnose-Dialog; MSI/NSIS heute nicht neu gebaut.