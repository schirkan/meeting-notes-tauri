# T-402: UI-Komponenten aus Electron-Projekt portieren

## Kontext
Status: umgesetzt
Priorität: high
Abhängigkeiten: T-401

## Goal
Alle UI-Komponenten aus `../meeting-notes/src/renderer/src/components/` portieren.

## Done When
- [x] `HeroStatusCard.tsx` ist portiert (Status und Aufnahmeaktionen; Verbindungstestergebnisse erscheinen separat gemäß [T-403](./T-403-settings-dialog-mit-verbindung-testen-button.md)). Beleg: src/renderer/src/components/HeroStatusCard.tsx.
- [x] `TranscriptPanel.tsx` ist portiert (Auto-Scroll-Pausierung bleibt erhalten; Console-Speaker-Badges sind inline editierbar). Beleg: src/renderer/src/components/TranscriptPanel.tsx.
- [x] `SettingsDialog.tsx` bietet Escape, Focus-Trap und Initial-Fokus sowie drei Tabs und einen Footer mit dem gemeinsamen Config-Pfad.
- [x] `SettingsPanel.tsx` ist portiert (Sprach-/Device-Auswahl; Alias-Mapping ist im `SpeakerMappingPanel`). Beleg: src/renderer/src/components/SettingsPanel.tsx.
- [x] `ConfigPanel.tsx` enthält Azure-Form, gemeinsames Azure-/Proxy-Speichern und Test-/Ergebnisaktionen. `ProxyPanel.tsx` enthält die ausgelagerten Proxy-Felder; `ConnectivityDialog.tsx` zeigt Diagnose und Fehlerdetails separat.
- [x] `DebugLogPanel.tsx` ist portiert (separate Öffnen/Schließen-Aktionen, Log-leeren). Beleg: src/renderer/src/components/DebugLogPanel.tsx.
- [x] `SpeakerMappingPanel.tsx` ist portiert (30 Speaker-Farben, Alias-Mapping). Beleg: src/renderer/src/components/SpeakerMappingPanel.tsx.
- [x] Funktionales Verhalten bleibt erhalten; Darstellung folgt auf Nutzerwunsch dem Console-Design statt der ursprünglichen 1:1-Portierung. Beleg: Node-UI-Tests decken Bedienung und Layout ab.

## Approach
- Bestehende Komponenten als Grundlage portieren; bewusste Ausnahme gemäß [DECISIONS.md](../DECISIONS.md), Fortschreibung AD-004: drei Settings-Bereiche, Config-Pfade im Footer, Startup-Dialog mit Bottom-Toast und separater Diagnose-Dialog.
- Tauri-Bridge hinter `window.transcriptApi` halten (siehe T-401); Diagnose-Dialog verwendet den Command-Return-Wert statt einer Hero-Ergebnis-Karte.
- Spezielle Edge-Cases (Focus-Trap, Auto-Scroll-Pause bei mehr als 24 px Scroll-Distanz) müssen bei der Port-Validierung gegengetestet werden.

## Log
- 2026-06-25: Spec angelegt.
- 2026-11-16: Darstellung auf das Console-Mockup umgestellt (siehe Fortschreibung AD-004): kompakter Header, Inline-Aliase, einklappbare Sprecherzuordnung, größenstabiler Tab-Dialog und aufwärts öffnender Debug-Dock. Regressionstests prüfen Layoutgrenzen, Alias-Export, Audio-Synchronisation, gestopptes Löschen, Debug-Höhenlimit, Auto-Scroll und Timer-Lebenszyklus. Backend- und Audio-Akzeptanz werden dadurch nicht ersetzt.