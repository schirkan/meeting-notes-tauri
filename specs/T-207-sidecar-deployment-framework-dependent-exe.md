# T-207: Sidecar-Deployment (framework-dependent EXE + Tauri-Resource)

## Kontext
Status: umgesetzt
Priorität: high
Abhängigkeiten: T-200 bis T-206

## Goal
C#-Sidecar als framework-dependent EXE bauen und über Tauri-Ressourcenmechanismus in den Build einbinden.

## Done When
- [x] `src-tauri/build.rs` publiziert automatisch nach `src-tauri/target/sidecar-publish/`; .NET-Zwischenartefakte liegen via `--artifacts-path` unter `src-tauri/target/sidecar-artifacts/`, ausserhalb des ueberwachten Quellbaums. Ein-Befehl-Workflow über `tauri build` reicht.
- [x] Tauri-`tauri.conf.json` deklariert `bundle.resources` für `target/sidecar-publish/*` (Mapping auf `sidecar/`).
- [x] Tauri-Main findet die Sidecar-EXE in Development (`dev`) und in Production (`production`) zuverlässig (`sidecar.rs::resolve_sidecar_path` mit CWD-/Resource-/EXE-Fallback).
- [x] Auf Zielsystem ist nur .NET 10 Runtime erforderlich (kein SDK).
- [x] EXE-Größe nach Publish: dokumentiert (Erwartung: ~25–35 MB inkl. Speech-Native-Binaries). Gemessen: Sidecar-EXE 0,16 MB (framework-dependent), 7,62 MB mit DLLs, Portable gesamt 23,12 MB.

## Approach
- Sidecar-Publish wird in `src-tauri/build.rs` orchestriert (vor `cargo build`). `cargo:rerun-if-changed=../sidecar` triggert nur bei Sidecar-Quelländerungen neu.
- `npm run publish:sidecar` bleibt als Opt-in-Skript für Ad-hoc-Rebuilds ohne Tauri-Build erhalten.
- Veröffentlichungs-Skript analog zu `../meeting-notes/scripts/build-and-publish-sidecar.mjs` — wird durch `build.rs` ersetzt.
- Tauri-Ressourcen werden bei `tauri build` in den Installer übernommen.
- Optional: `--self-contained true` als alternative Build-Konfiguration für Zielsysteme ohne .NET-Runtime (Trade-off: +60 MB). In `build.rs` durch `--self-contained false` hartkodiert; eine `self-contained`-Variante wäre eine zukünftige Erweiterung.

## Log
- 2026-06-25: Spec angelegt.
- 2026-06-26: Publish-Trigger von manuellem npm-Skript auf `src-tauri/build.rs` umgestellt (siehe `AD-009`).