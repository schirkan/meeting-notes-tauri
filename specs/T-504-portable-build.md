# T-504: Portable Build (Windows, unsigniert)

## Kontext
Status: draft
Priorität: high
Abhängigkeiten: T-503

## Goal
Portable Variante der Tauri-App, die ohne Installation läuft.

## Done When
- [ ] `npm run dist:portable` erzeugt einen Ordner `dist/portable/` mit:
  - `meeting-notes-tauri.exe` (Tauri-App, unsigniert)
  - `sidecar/MeetingNotes.Sidecar.exe` + DLLs (framework-dependent)
  - `config/azure.example.json`, `config/user-settings.example.json`
- [ ] Portable Build läuft auf einem frischen Windows-11-System (nur .NET 8 Runtime installiert).
- [ ] SHA256SUMS-Datei wird erzeugt.
- [ ] Bundle-Größe wird im Build-Output geloggt.

## Approach
- Tauri unterstützt portable Builds via Bundle-Konfiguration (`bundle.targets: ["nsis", "msi"]` plus manuelles Kopieren der Tauri-Binary + Resources in einen gemeinsamen Ordner).
- Alternative: Tauri-EXE mit `--portable`-Flag oder als Standalone-Ordner-Distribution.
- Vergleich zur Electron-Variante (`../meeting-notes/dist/portable/`): Sidecar-Struktur ist identisch, App-Binary ist Tauri-EXE statt Electron-EXE.

## Log
- 2026-06-25: Spec angelegt.