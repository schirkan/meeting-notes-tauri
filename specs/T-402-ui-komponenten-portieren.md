# T-402: UI-Komponenten aus Electron-Projekt portieren

## Kontext
Status: teils umgesetzt (1 Punkt offen)
Priorität: high
Abhängigkeiten: T-401

## Goal
Alle UI-Komponenten aus `../meeting-notes/src/renderer/src/components/` portieren.

## Done When
- [x] `HeroStatusCard.tsx` ist portiert (Status und Aufnahmeaktionen; Verbindungstestergebnisse erscheinen separat gemäß [T-403](./T-403-settings-dialog-mit-verbindung-testen-button.md)). Beleg: src/renderer/src/components/HeroStatusCard.tsx.
- [x] `TranscriptPanel.tsx` ist portiert (Auto-Scroll-Pausierung bleibt erhalten; Console-Speaker-Badges sind inline editierbar). Beleg: src/renderer/src/components/TranscriptPanel.tsx.
- [x] `SettingsDialog.tsx` bietet Escape, Focus-Trap, initialen Speichern-Fokus, eine scrollende Seite ohne Tabs und einen Footer mit dem gemeinsamen Config-Pfad. Draft-/Discard-Verhalten siehe [T-403](./T-403-settings-dialog-mit-verbindung-testen-button.md). Beleg: src/renderer/src/components/SettingsDialog.tsx; Speichern-Fokus im integrierten Browser mit gemockter Bridge geprueft.
- [x] `SettingsPanel.tsx` ist portiert (Sprach-/Device-Auswahl; Alias-Mapping ist im `SpeakerMappingPanel`). Beleg: src/renderer/src/components/SettingsPanel.tsx.
- [x] `ConfigPanel.tsx` enthält Azure-Form, gemeinsames Azure-/Proxy-Speichern und Test-/Ergebnisaktionen. `ProxyPanel.tsx` enthält die ausgelagerten Proxy-Felder; `ConnectivityDialog.tsx` zeigt Diagnose und Fehlerdetails separat. Beleg: src/renderer/src/components/ConfigPanel.tsx, src/renderer/src/components/ProxyPanel.tsx, src/renderer/src/components/ConnectivityDialog.tsx (geprueft).
- [x] `DebugLogPanel.tsx` ist portiert (separate Öffnen/Schließen-Aktionen, Log-leeren). Beleg: src/renderer/src/components/DebugLogPanel.tsx.
- [x] `SpeakerMappingPanel.tsx` ist portiert (30 Speaker-Farben, Alias-Mapping). Beleg: src/renderer/src/components/SpeakerMappingPanel.tsx.
- [x] Funktionales Verhalten bleibt erhalten; Darstellung folgt auf Nutzerwunsch dem Console-Design statt der ursprünglichen 1:1-Portierung. Beleg: Node-UI-Tests decken Bedienung und Layout ab.
- [x] **About** im Drei-Punkte-Menue oeffnet einen Dialog mit Header und **x**, ohne Footer-/Content-Buttons. Grosses App-Icon links; rechts **Meeting Notes**, Repository-Link, Author **Martin Pietschmann**, Lizenz **MIT**. Focus-Trap, initialer **x**-Fokus, Escape und Schliessen per Backdrop-Klick. Beleg: AboutDialog.tsx, SettingsDialog.tsx, styles.css und LICENSE; Icon, Link-Aufruf, einziger Button, Fokus, Layout bei 390 px und Backdrop-Schliessen im integrierten Browser geprueft.
- [x] **Dev-Tools (F12)** im Drei-Punkte-Menue und F12 verwenden denselben typisierten Toggle; Fehler erscheinen als Toast. Repository-Link oeffnet nur die feste Projekt-URL im Systembrowser, nicht im App-WebView. Beleg: HeroStatusCard.tsx, use-app-state.ts, preload/index.ts und commands.rs; Mock-Aufrufe fuer Menue/F12 (2 Toggles) und Repository im integrierten Browser geprueft.
- [x] Rechtsklick-Menues werden ausschliesslich im Webseiteninhalt unterdrueckt. Text-/Passwort-/Zahlenfelder, Textareas und Contenteditable behalten die nativen Bearbeitungsmenues; Checkboxen, Selects und Hintergrund nicht. Native Fenster-/Tray-Menues bleiben unberuehrt. Beleg: App.tsx (onContextMenu); cancelable Contextmenu-Events im integrierten Browser fuer Text-/Passwortfelder und Select geprueft; weitere Faelle in tests/startup-ui.test.mjs.
- [x] **About** zeigt die aktuelle App-Version direkt unter dem Produktnamen und bezieht sie aus `package.json`. Beleg: Der fokussierte About-Browsertest in `startup-ui.test.mjs` prueft die sichtbare Manifest-Version.
- [ ] Native About-/Repository-/DevTools-/Kontextmenue-Abnahme - **offen**: Browser-Checks verwenden Mock-IPC und synthetische Contextmenu-Events, pruefen keine echten WebView2-Menues oder Systembrowser-Aufrufe; Rust-Validierung durch MSBuild-Zugriff verweigert blockiert.

## Approach
- Bestehende Komponenten als Grundlage portieren; Settings-Struktur und temporaerer Store gemaess [T-403](./T-403-settings-dialog-mit-verbindung-testen-button.md), Config-Pfad im Footer, Startup-Dialog mit Bottom-Toast und separater Diagnose-Dialog.
- Tauri-Bridge hinter `window.transcriptApi` halten (siehe T-401); Diagnose-Dialog verwendet den Command-Return-Wert statt einer Hero-Ergebnis-Karte.
- Spezielle Edge-Cases (Focus-Trap, Auto-Scroll-Pause bei mehr als 24 px Scroll-Distanz) müssen bei der Port-Validierung gegengetestet werden.

## Log
- 2026-11-20: About und Dev-Tools im Drei-Punkte-Menue, selektive Webseiten-Kontextmenues und feste Repository-Oeffnung hinzugefuegt. Integrierter Mock-Browser erfolgreich; CLI-UI-Lauf vor Assertions mit Edge Exit 21 blockiert. Native Abnahme bleibt offen.
- 2026-06-25: Spec angelegt.
- 2026-11-16: Darstellung auf das Console-Mockup umgestellt (siehe Fortschreibung AD-004): kompakter Header, Inline-Aliase, einklappbare Sprecherzuordnung, größenstabiler Tab-Dialog und aufwärts öffnender Debug-Dock. Regressionstests prüfen Layoutgrenzen, Alias-Export, Audio-Synchronisation, gestopptes Löschen, Debug-Höhenlimit, Auto-Scroll und Timer-Lebenszyklus. Backend- und Audio-Akzeptanz werden dadurch nicht ersetzt.