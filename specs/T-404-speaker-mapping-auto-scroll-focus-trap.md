# T-404: Speaker-Mapping, Auto-Scroll, Focus-Trap (Port + Validierung)

## Kontext
Status: umgesetzt
Priorität: high
Abhängigkeiten: T-402

## Goal
Verhaltensfeinheiten aus `../meeting-notes` 1:1 portieren und gegen Validierungs-Tests prüfen.

## Done When
- [x] **Speaker-Mapping:** numerische IDs werden auf 30 Farbslots zyklisch gemappt (`speaker-guest-1`…`speaker-guest-30`). Mic-IDs erhalten einen Offset von 15, sodass gleich nummerierte Mic-/Speaker-IDs unterschiedliche Farben haben. Beleg: src/renderer/src/speaker-utils.ts (30 Farbslots, zyklisch).
- [x] **Quellentrennung:** Sprecheridentität und Alias-Schlüssel enthalten die Audioquelle, z. B. `mic:Guest-1` und `speaker:Guest-1`. Badges und Zuordnung zeigen ohne Alias `Mic · Guest-1` bzw. `Speaker · Guest-1`; identische SDK-IDs der Quellen teilen keinen Alias. Beleg: src/shared/transcript-contract.ts (source im Segment) und src/renderer/src/speaker-utils.ts (Identitaet mit Quelle).
- [x] **Mic-Parität:** Bei Mic-Diarization werden verschiedene erkannte Sprecher wie beim Loopback einzeln dargestellt und zugeordnet. Aliase gelten in Badges, letzter-Sprecher-Anzeige und Clipboard-Export; Rohsegmente behalten Quelle und SDK-ID. Beleg: src/renderer/src/speaker-utils.ts (eigene Palette je Quelle, Mic und Loopback gleich behandelt).
- [x] **Interim-Korrektur:** Neue Interim-/Final-Events entfernen ältere Interims nur derselben Quelle, auch wenn das SDK die Sprecher-ID korrigiert. Andere Quellen und finale Sprechersegmente bleiben erhalten. Beleg: src/renderer/src/use-app-state.ts (entfernt Interim-Events nur derselben Quelle).
- [x] **Auto-Scroll:** pausiert, sobald Nutzer ≥32 px vom Listenende hochgescrollt hat, reaktiviert beim Zurückscrollen. Beleg: Node-UI-Test zum Follow-Verhalten.
- [x] **Focus-Trap im Settings-Dialog:** Tab/Shift+Tab zyklisch innerhalb der Dialog-Elemente; Escape schließt den Dialog. Beleg: Node-UI-Test zum Fokus- und Trap-Verhalten.
- [x] **Initial-Fokus:** beim Öffnen des Settings-Dialogs wird das erste Eingabefeld fokussiert (nicht der Schließen-Button). Beleg: Node-UI-Test zum Fokus beim Oeffnen.
- [x] **Re-Render-Fokus-Schutz:** Tastendrücke in Eingabefeldern reißen den Fokus nicht mehr weg (zwei separate `useEffect`-Blöcke mit `[isOpen]`-Dependency). Beleg: Node-UI-Tests zu Fokus und Eingabefeldern.

## Approach
- Bestehenden Renderer portieren; quellenspezifisches Mapping in [speaker-utils.ts](../src/renderer/src/speaker-utils.ts), Event-/Alias-Verarbeitung in [use-app-state.ts](../src/renderer/src/use-app-state.ts).
- Speaker-Keys, Labels und Farbzyklen sind durch Unit-Tests abgedeckt. Die neuen Szenarien für Mic-/Speaker-Badges, Aliase, korrigierte Interims, Hero-Anzeige und Export wurden im integrierten Browser mit gemockter Bridge erfolgreich geprüft. Der aktuelle CLI-Lauf der [UI-Regressionstests](../tests/startup-ui.test.mjs) ist durch headless-Edge-Startfehler (Exit 21) blockiert.
- Übrige Kriterien und reale Mehrsprecheraufnahme weiterhin im Tauri-Dev-Modus validieren; Status bleibt `draft`.
- Falls Tauri-WebView2 ein abweichendes Verhalten zeigt (z. B. bei Focus-Trap), gezielt nachjustieren — Spec-Eintrag aktualisieren.

## Log
- 2026-06-25: Spec angelegt.