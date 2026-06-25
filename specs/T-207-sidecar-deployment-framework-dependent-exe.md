# T-207: Sidecar-Deployment (framework-dependent EXE + Tauri-Resource)

## Kontext
Status: draft
Priorität: high
Abhängigkeiten: T-200 bis T-206

## Goal
C#-Sidecar als framework-dependent EXE bauen und über Tauri-Ressourcenmechanismus in den Build einbinden.

## Done When
- [ ] `dotnet publish sidecar/MeetingNotes.Sidecar.csproj -c Release -r win-x64 --self-contained false -o sidecar/publish/sidecar` baut eine EXE + DLLs.
- [ ] Tauri-`tauri.conf.json` deklariert `bundle.resources` für `sidecar/publish/sidecar/*` (oder selektive EXE + benötigte DLLs).
- [ ] Tauri-Main findet die Sidecar-EXE in Development (`dev`) und in Production (`production`) zuverlässig.
- [ ] Auf Zielsystem ist nur .NET 8 Runtime erforderlich (kein SDK).
- [ ] EXE-Größe nach Publish: dokumentiert (Erwartung: ~25–35 MB inkl. Speech-Native-Binaries).

## Approach
- Veröffentlichungs-Skript analog zu `../meeting-notes/scripts/build-and-publish-sidecar.mjs` (sofern vorhanden) — auf Tauri-Konventionen anpassen.
- Tauri-Ressourcen werden bei `tauri build` in den Installer übernommen.
- Optional: `--self-contained true` als alternative Build-Konfiguration für Zielsysteme ohne .NET-Runtime (Trade-off: +60 MB).

## Log
- 2026-06-25: Spec angelegt.