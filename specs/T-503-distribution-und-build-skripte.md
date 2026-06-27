# T-503: Distribution und Build-Skripte

## Kontext
Status: implemented
Priorität: high
Abhängigkeiten: T-207

## Goal
Standardisierte Build-Pipeline für die Tauri-Variante.

## Done When
- [x] `src-tauri/build.rs` publisht den C#-Sidecar automatisch vor `cargo build` (RID aus `CARGO_CFG_TARGET_OS`/`CARGO_CFG_TARGET_ARCH`, Config aus `PROFILE`). — siehe `DECISIONS.md → AD-009`.
- [x] `npm run build` (= `tsc --noEmit && vite build`) baut den React-Renderer via Vite.
- [x] `npm run tauri build` produziert NSIS- und MSI-Installer (Sidecar-Build läuft automatisch in build.rs).
- [x] `npm run dist:portable` baut die portable Variante nach `dist/portable/` (T-504).
- [x] Sidecar-EXE ist über `tauri.conf.json → bundle.resources` im Installer enthalten.
- [x] `npm run typecheck` ist grün.
- [ ] `npm run lint` (sofern konfiguriert) ist grün — **offen**: kein Lint-Setup im Projekt.
- [x] `npm run publish:sidecar` ist nur noch ein optionales Skript für Ad-hoc-Rebuilds ohne Tauri-Build.
- [x] Toolchain-Setup-Skripte (`scripts/setup-toolchain.ps1`, `scripts/check-toolchain.ps1`, `scripts/run-with-toolchain.ps1`, `scripts/patch-w64devkit-gcc-eh.ps1`) reproduzieren die Build-Umgebung auf einer frischen Windows-Maschine.

## Approach
- `src-tauri/build.rs` ruft `dotnet publish` mit korrektem RID auf, bevor Cargo kompiliert. `cargo:rerun-if-changed=../sidecar` sorgt dafür, dass nur bei Sidecar-Quelländerungen neu publisht wird.
- `package.json` orchestriert die Sub-Skripte (siehe `../meeting-notes/package.json` als Vorlage).
- Tauri-CLI wird via devDependency eingebunden (`@tauri-apps/cli`).
- Cross-Compile-Skripte werden **nicht** separat aufgenommen; die RID-Matrix lebt in `build.rs`. Für macOS/Linux steht das Gerüst bereits (win-x64/arm64, osx-x64/arm64, linux-x64/arm64), auch wenn aktuell nur Windows-Builds durchlaufen (siehe `DECISIONS.md → AD-005`).

## Log
- 2026-06-25: Spec angelegt.
- 2026-06-26: Done-When an `build.rs`-Auto-Publish angepasst (siehe `AD-009`). Manuelles `publish:sidecar` ist obsolet.