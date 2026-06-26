# T-207: Sidecar-Deployment (framework-dependent EXE + Tauri-Resource)

## Kontext
Status: draft
Priorität: high
Abhängigkeiten: T-200 bis T-206

## Goal
C#-Sidecar als framework-dependent EXE bauen und über Tauri-Ressourcenmechanismus in den Build einbinden.

## Done When
- [x] `src-tauri/build.rs` ruft `dotnet publish sidecar/MeetingNotes.Sidecar.csproj -c {Debug|Release} -r {RID} --self-contained false -o sidecar/publish/sidecar` automatisch auf — siehe `DECISIONS.md → AD-009`. Ein-Befehl-Workflow über `tauri build` reicht.
- [x] Tauri-`tauri.conf.json` deklariert `bundle.resources` für `sidecar/publish/sidecar/*` (selektiv via Glob, Mapping auf `sidecar/` im Installer).
- [x] Tauri-Main findet die Sidecar-EXE in Development (`dev`) und in Production (`production`) zuverlässig (`sidecar.rs::resolve_sidecar_path` mit CWD-/Resource-/EXE-Fallback).
- [x] Auf Zielsystem ist nur .NET 8 Runtime erforderlich (kein SDK).
- [ ] EXE-Größe nach Publish: dokumentiert (Erwartung: ~25–35 MB inkl. Speech-Native-Binaries).

## Approach
- Sidecar-Publish wird in `src-tauri/build.rs` orchestriert (vor `cargo build`). `cargo:rerun-if-changed=../sidecar` triggert nur bei Sidecar-Quelländerungen neu.
- `npm run publish:sidecar` bleibt als Opt-in-Skript für Ad-hoc-Rebuilds ohne Tauri-Build erhalten.
- Veröffentlichungs-Skript analog zu `../meeting-notes/scripts/build-and-publish-sidecar.mjs` — wird durch `build.rs` ersetzt.
- Tauri-Ressourcen werden bei `tauri build` in den Installer übernommen.
- Optional: `--self-contained true` als alternative Build-Konfiguration für Zielsysteme ohne .NET-Runtime (Trade-off: +60 MB). In `build.rs` durch `--self-contained false` hartkodiert; eine `self-contained`-Variante wäre eine zukünftige Erweiterung.

## Log
- 2026-06-25: Spec angelegt.
- 2026-06-26: Publish-Trigger von manuellem npm-Skript auf `src-tauri/build.rs` umgestellt (siehe `AD-009`).