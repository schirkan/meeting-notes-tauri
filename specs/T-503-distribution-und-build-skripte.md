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
- [x] `npm run tauri -- build` produziert NSIS- und MSI-Installer (Sidecar-Build automatisch in build.rs); Installer-Build wurde zuvor verifiziert, heute nicht erneut ausgeführt.
- [x] `npm run dist:portable` **verpackt bereits gebaute Artefakte** nach `dist/portable/` (T-504), kompiliert sie nicht.
- [x] VS-Code-Aufgabe **Build portable distribution** führt `npm ci`, `npm run tauri -- build --no-bundle` und danach Packaging aus. Letzter Portable-Rebuild und anschließendes `npm run test:smoke` erfolgreich, 26 Hashes stimmen.
- [x] Sidecar-EXE und verwaltete/native DLLs sind über `tauri.conf.json → bundle.resources` im Installer enthalten und liegen in der portablen Ausgabe extern neben der Haupt-EXE.
- [x] `npm run typecheck` ist grün.
- [ ] `npm run lint` (sofern konfiguriert) ist grün — **offen**: kein Lint-Setup im Projekt.
- [x] `npm run publish:sidecar` ist nur noch ein optionales Skript für Ad-hoc-Rebuilds ohne Tauri-Build.
- [x] Toolchain-Setup-Skripte (`scripts/setup-toolchain.ps1`, `scripts/check-toolchain.ps1`, `scripts/run-with-toolchain.ps1`, `scripts/patch-w64devkit-gcc-eh.ps1`) reproduzieren die Build-Umgebung auf einer frischen Windows-Maschine.

## Approach
- `src-tauri/build.rs` ruft `dotnet publish` mit korrektem RID auf, bevor Cargo kompiliert. `cargo:rerun-if-changed=../sidecar` sorgt dafür, dass nur bei Sidecar-Quelländerungen neu publisht wird.
- `package.json` orchestriert die Sub-Skripte (siehe `../meeting-notes/package.json` als Vorlage).
- Tauri-CLI wird via devDependency eingebunden (`@tauri-apps/cli`).
- Unterstützter und lokal geprüfter Build ist Windows win-x64. Die historisch vorhandene RID-Matrix in `build.rs` begründet keine macOS-/Linux-/ARM-Unterstützung oder entsprechende Validierung; der Produkt-Scope bleibt Windows-only gemäß OQ-4 in [DECISIONS.md](../DECISIONS.md).

## Log
- 2026-06-25: Spec angelegt.
- 2026-06-26: Done-When an `build.rs`-Auto-Publish angepasst (siehe `AD-009`). Manuelles `publish:sidecar` ist obsolet.