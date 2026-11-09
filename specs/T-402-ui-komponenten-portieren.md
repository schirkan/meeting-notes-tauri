# T-402: UI-Komponenten aus Electron-Projekt portieren

## Kontext
Status: draft
Priorität: high
Abhängigkeiten: T-401

## Goal
Alle UI-Komponenten aus `../meeting-notes/src/renderer/src/components/` portieren.

## Done When
- [ ] `HeroStatusCard.tsx` ist portiert (Status und Aufnahmeaktionen; Verbindungstestergebnisse erscheinen separat gemäß [T-403](./T-403-settings-dialog-mit-verbindung-testen-button.md)).
- [ ] `TranscriptPanel.tsx` ist portiert (Auto-Scroll-Pausierung bleibt erhalten, Speaker-Badges identisch).
- [x] `SettingsDialog.tsx` bietet Escape, Focus-Trap und Initial-Fokus sowie drei responsive Bereiche und einen Footer mit beiden Config-Pfaden.
- [ ] `SettingsPanel.tsx` ist portiert (Sprach-/Device-Auswahl; Alias-Mapping ist im `SpeakerMappingPanel`).
- [x] `ConfigPanel.tsx` enthält Azure-Form, gemeinsames Azure-/Proxy-Speichern und Test-/Ergebnisaktionen. `ProxyPanel.tsx` enthält die ausgelagerten Proxy-Felder; `ConnectivityDialog.tsx` zeigt Diagnose und Fehlerdetails separat.
- [ ] `DebugLogPanel.tsx` ist portiert (separate Öffnen/Schließen-Aktionen, Log-leeren).
- [ ] `SpeakerMappingPanel.tsx` ist portiert (30 Speaker-Farben, Alias-Mapping).
- [ ] Visuelles Verhalten bleibt außerhalb der bewusst geänderten Settings-/Diagnose-UX funktional identisch zur Electron-Variante.

## Approach
- Bestehende Komponenten als Grundlage portieren; bewusste Ausnahme gemäß [DECISIONS.md](../DECISIONS.md), Fortschreibung AD-004: drei Settings-Bereiche, Config-Pfade im Footer, Startup-Dialog mit Bottom-Toast und separater Diagnose-Dialog.
- Tauri-Bridge hinter `window.transcriptApi` halten (siehe T-401); Diagnose-Dialog verwendet den Command-Return-Wert statt einer Hero-Ergebnis-Karte.
- Spezielle Edge-Cases (Focus-Trap, Auto-Scroll-Pause bei ≥32 px Scroll-Distanz) müssen bei der Port-Validierung gegengetestet werden.

## Log
- 2026-06-25: Spec angelegt.