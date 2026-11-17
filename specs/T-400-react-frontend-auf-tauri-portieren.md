# T-400: React-Frontend auf Tauri portieren

## Kontext
Status: teils umgesetzt (1 Punkt offen)
Priorität: high
Subtasks: T-401, T-402, T-403, T-404
Abhängigkeiten: T-102

## Goal
React-Frontend 1:1 aus `../meeting-notes/src/renderer/` portieren, hinter einer Tauri-Preload-Bridge versteckt.

## Done When
- [x] Alle Komponenten sind portiert: `HeroStatusCard`, `TranscriptPanel`, `SettingsDialog`, `ConfigPanel`, `DebugLogPanel`, `SpeakerMappingPanel`. Beleg: HeroStatusCard, TranscriptPanel, SettingsDialog, ConfigPanel, DebugLogPanel, SpeakerMappingPanel.
- [x] Tauri-Preload-Bridge (`src/preload/index.ts`) ersetzt die Electron-Preload-Bridge. Beleg: src/preload/index.ts.
- [x] State-Management (`use-app-state.ts`) ist unverändert, nur die IPC-Aufrufe sind Tauri-konform. Beleg: use-app-state.ts, IPC-Aufrufe Tauri-konform.
- [ ] Visuelles Verhalten ist identisch zur Electron-Variante. - **offen**: Bewusst nicht 1:1: die Darstellung folgt auf Nutzerwunsch dem Console-Design statt der urspruenglichen Portierung (siehe T-402). Das funktionale Verhalten bleibt erhalten und ist durch die Node-UI-Tests abgedeckt.
- [x] `npm run typecheck` ist grün. Beleg: npm run typecheck laeuft gruen.

## Approach
- 1:1-Port-Strategie (siehe `DECISIONS.md → AD-004`).
- Einziger Punkt mit API-Drift: `electronAPI.foo()` → `tauriAPI.foo()`. Diese Differenz wird in der Preload-Bridge gekapselt, sodass die Komponenten selbst unverändert bleiben.
- Vite-Config identisch zu `../meeting-notes` (außer evtl. angepasster Dev-Port).

## Log
- 2026-06-25: Spec angelegt.