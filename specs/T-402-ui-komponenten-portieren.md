# T-402: UI-Komponenten aus Electron-Projekt portieren

## Kontext
Status: draft
Priorität: high
Abhängigkeiten: T-401

## Goal
Alle UI-Komponenten aus `../meeting-notes/src/renderer/src/components/` portieren.

## Done When
- [ ] `HeroStatusCard.tsx` ist portiert (Verbindung-testen-Ergebnis-Anzeige funktioniert via Tauri-Event).
- [ ] `TranscriptPanel.tsx` ist portiert (Auto-Scroll-Pausierung bleibt erhalten, Speaker-Badges identisch).
- [ ] `SettingsDialog.tsx` ist portiert (Escape-Handler, Focus-Trap, Initial-Fokus bleiben funktional).
- [ ] `SettingsPanel.tsx` ist portiert (Sprachauswahl, Device-Auswahl, Alias-Mapping).
- [ ] `ConfigPanel.tsx` ist portiert (Azure-Config-Form, Verbindung-testen-Button bleibt funktional).
- [ ] `DebugLogPanel.tsx` ist portiert (separate Öffnen/Schließen-Aktionen, Log-leeren).
- [ ] `SpeakerMappingPanel.tsx` ist portiert (30 Speaker-Farben, Alias-Mapping).
- [ ] Visuelles Verhalten ist identisch zur Electron-Variante.

## Approach
- Reine 1:1-Kopie der Dateien aus `../meeting-notes/src/renderer/src/components/`.
- Nur Anpassung der Imports: `electronAPI` → `tauriAPI` (siehe T-401).
- Spezielle Edge-Cases (Focus-Trap, Auto-Scroll-Pause bei ≥32 px Scroll-Distanz) müssen bei der Port-Validierung gegengetestet werden.

## Log
- 2026-06-25: Spec angelegt.