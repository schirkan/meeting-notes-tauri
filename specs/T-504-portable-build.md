# T-504: Portable Build (Windows, unsigniert)

## Kontext
Status: draft
Priorität: high
Abhängigkeiten: T-503

## Goal
Portable Variante der Tauri-App, die ohne Installation läuft.

## Done When
- [x] `npm run dist:portable` erzeugt einen Ordner `dist/portable/` mit:
  - [x] `meeting-notes-tauri.exe` (Tauri-App, unsigniert)
  - [x] `sidecar/MeetingNotes.Sidecar.exe` + DLLs (framework-dependent)
  - [ ] `config/azure.example.json`, `config/user-settings.example.json` — Config-Templates gehören zu T-103/T-305, sind aktuell noch nicht implementiert. `scripts/dist-portable.mjs` kopiert sie **automatisch**, sobald sie existieren; ohne sie läuft der Build mit Warnung durch.
- [x] Portable Build läuft auf einem frischen Windows-11-System (nur .NET 8 Runtime installiert). Sidecar ist framework-dependent (`--self-contained false`), Tauri-EXE ist statisch gelinkt.
- [x] SHA256SUMS-Datei wird erzeugt (24 Summen für 1 Tauri-EXE + 23 Sidecar-Dateien).
- [x] Bundle-Größe wird im Build-Output geloggt (Tauri-EXE / Sidecar / SHA256SUMS / Gesamt).

## Approach
- `scripts/dist-portable.mjs` orchestriert: Prereq-Check → Clean → Copy (`meeting-notes-tauri.exe`, `sidecar/*`, optional `config/*example.json`) → SHA256-Summen via Streaming-Hash (`createReadStream` + `pipeline`) → Summary-Output.
- Sidecar-Publish läuft automatisch via `src-tauri/build.rs` (siehe `DECISIONS.md → AD-009`); das portable Skript nimmt das Ergebnis aus `sidecar/publish/sidecar/`.
- Config-Templates werden **automatisch** übernommen, sobald T-103/T-305 sie liefert — keine Anpassung am Skript nötig.
- Tauri-Bundle-Konfiguration (`bundle.targets: ["nsis", "msi"]`) bleibt für Installer-Distribution aktiv und unabhängig vom portable-Pfad.

## Log
- 2026-06-25: Spec angelegt.
- 2026-06-26: `scripts/dist-portable.mjs` + `npm run dist:portable` implementiert. Config-Templates als optional markiert (gehört zu T-103/T-305).