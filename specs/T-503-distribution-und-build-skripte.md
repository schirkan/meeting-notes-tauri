# T-503: Distribution und Build-Skripte

## Kontext
Status: draft
Priorität: high
Abhängigkeiten: T-207

## Goal
Standardisierte Build-Pipeline für die Tauri-Variante.

## Done When
- [ ] `npm run build:sidecar` baut und publiziert den C#-Sidecar framework-dependent nach `sidecar/publish/sidecar/`.
- [ ] `npm run build:renderer` baut den React-Renderer via Vite.
- [ ] `npm run tauri build` produziert NSIS- und/oder MSI-Installer.
- [ ] `npm run dist:portable` baut zusätzlich eine portable Variante (selbstextrahierend).
- [ ] Sidecar-EXE ist über `tauri.conf.json → bundle.resources` im Installer enthalten.
- [ ] `npm run typecheck` ist grün.
- [ ] `npm run lint` (sofern konfiguriert) ist grün.

## Approach
- `package.json` orchestriert die Sub-Skripte (siehe `../meeting-notes/package.json` als Vorlage).
- Tauri-CLI wird via devDependency eingebunden (`@tauri-apps/cli`).
- Cross-Compile-Skripte werden **nicht** aufgenommen (Windows-only-Build, siehe DECISIONS AD-005).

## Log
- 2026-06-25: Spec angelegt.