# T-404: Speaker-Mapping, Auto-Scroll, Focus-Trap (Port + Validierung)

## Kontext
Status: draft
Priorität: high
Abhängigkeiten: T-402

## Goal
Verhaltensfeinheiten aus `../meeting-notes` 1:1 portieren und gegen Validierungs-Tests prüfen.

## Done When
- [ ] **Speaker-Mapping:** numerische IDs werden auf 30 Farbslots zyklisch gemappt (`speaker-guest-1`…`speaker-guest-30`).
- [ ] **Auto-Scroll:** pausiert, sobald Nutzer ≥32 px vom Listenende hochgescrollt hat, reaktiviert beim Zurückscrollen.
- [ ] **Focus-Trap im Settings-Dialog:** Tab/Shift+Tab zyklisch innerhalb der Dialog-Elemente; Escape schließt den Dialog.
- [ ] **Initial-Fokus:** beim Öffnen des Settings-Dialogs wird das erste Eingabefeld fokussiert (nicht der Schließen-Button).
- [ ] **Re-Render-Fokus-Schutz:** Tastendrücke in Eingabefeldern reißen den Fokus nicht mehr weg (zwei separate `useEffect`-Blöcke mit `[isOpen]`-Dependency).

## Approach
- Code 1:1 aus `../meeting-notes/src/renderer/src/` übernehmen.
- Validierung: nach Port manueller Test im Tauri-Dev-Modus.
- Falls Tauri-WebView2 ein abweichendes Verhalten zeigt (z. B. bei Focus-Trap), gezielt nachjustieren — Spec-Eintrag aktualisieren.

## Log
- 2026-06-25: Spec angelegt.