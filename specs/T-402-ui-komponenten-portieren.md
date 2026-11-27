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
- [x] `SettingsDialog.tsx` bietet Escape, Focus-Trap, initialen Speichern-Fokus, eine scrollende Seite ohne Tabs und einen Footer mit dem gemeinsamen Config-Pfad. Draft-/Discard-Verhalten siehe [T-403](./T-403-settings-dialog-mit-verbindung-testen-button.md). Beleg: src/renderer/src/components/SettingsDialog.tsx; Speichern-Fokus im integrierten Browser mit gemockter Bridge geprueft.
- [x] `SettingsPanel.tsx` zeigt Fensteroptionen, Auto-Start/Stop und Export-Einstellungen. Sprache und Geraete stehen auf der Startseite; Alias-Mapping bleibt im `SpeakerMappingPanel`. Beleg: [SettingsPanel.tsx](../src/renderer/src/components/SettingsPanel.tsx) und [App.tsx](../src/renderer/src/App.tsx).
- [x] `ConfigPanel.tsx` enthaelt die Azure-Felder und `ProxyPanel.tsx` die Proxy-Felder. Speichern und Test starten im Dialog-Footer; `ConnectivityDialog.tsx` zeigt Diagnose und Fehlerdetails. Beleg: [T-403](./T-403-settings-dialog-mit-verbindung-testen-button.md), [App.tsx](../src/renderer/src/App.tsx) und [ConnectivityDialog.tsx](../src/renderer/src/components/ConnectivityDialog.tsx).
- [x] `DebugLogPanel.tsx` ist portiert (separate Öffnen/Schließen-Aktionen, Log-leeren). Beleg: src/renderer/src/components/DebugLogPanel.tsx.
- [x] `SpeakerMappingPanel.tsx` ist portiert (30 Speaker-Farben, Alias-Mapping). Beleg: src/renderer/src/components/SpeakerMappingPanel.tsx.
- [x] Funktionales Verhalten bleibt erhalten; Darstellung folgt auf Nutzerwunsch dem Console-Design statt der ursprünglichen 1:1-Portierung. Beleg: Node-UI-Tests decken Bedienung und Layout ab.
- [x] **About** im Drei-Punkte-Menue oeffnet einen Dialog mit Header und **x**, ohne Footer-/Content-Buttons. Grosses App-Icon links; rechts **Meeting Notes**, Repository-Link, Author **Martin Pietschmann**, Lizenz **MIT**. Focus-Trap, initialer **x**-Fokus, Escape und Schliessen per Backdrop-Klick. Beleg: AboutDialog.tsx, SettingsDialog.tsx, styles.css und LICENSE; Icon, Link-Aufruf, einziger Button, Fokus, Layout bei 390 px und Backdrop-Schliessen im integrierten Browser geprueft.
- [x] **Dev-Tools (F12)** im Drei-Punkte-Menue und F12 verwenden denselben typisierten Toggle; Fehler erscheinen als Toast. Repository-Link oeffnet nur die feste Projekt-URL im Systembrowser, nicht im App-WebView. Beleg: HeroStatusCard.tsx, use-app-state.ts, preload/index.ts und commands.rs; Mock-Aufrufe fuer Menue/F12 (2 Toggles) und Repository im integrierten Browser geprueft.
- [x] Rechtsklick-Menues werden ausschliesslich im Webseiteninhalt unterdrueckt. Text-/Passwort-/Zahlenfelder, Textareas und Contenteditable behalten die nativen Bearbeitungsmenues; Checkboxen, Selects und Hintergrund nicht. Native Fenster-/Tray-Menues bleiben unberuehrt. Beleg: App.tsx (onContextMenu); cancelable Contextmenu-Events im integrierten Browser fuer Text-/Passwortfelder und Select geprueft; weitere Faelle in tests/startup-ui.test.mjs.
- [x] **About** zeigt die aktuelle App-Version direkt unter dem Produktnamen und bezieht sie aus `package.json`. Beleg: Der fokussierte About-Browsertest in `startup-ui.test.mjs` prueft die sichtbare Manifest-Version.
- [x] About, Repository-Link, DevTools und Kontextmenues im nativen WebView2-Fenster abgenommen. Beleg: native Nutzerabnahme vom 28.11.2026, getrennt von den frueheren Browser-Regressionen mit Mock-Bridge.

## Approach
- Bestehende Komponenten als Grundlage portieren; Settings-Struktur und temporaerer Store gemaess [T-403](./T-403-settings-dialog-mit-verbindung-testen-button.md), Config-Pfad im Footer, Startup-Dialog mit Bottom-Toast und separater Diagnose-Dialog.
- Tauri-Bridge hinter `window.transcriptApi` halten (siehe T-401); Diagnose-Dialog verwendet den Command-Return-Wert statt einer Hero-Ergebnis-Karte.
- Spezielle Edge-Cases (Focus-Trap, Auto-Scroll-Pause bei mehr als 24 px Scroll-Distanz) müssen bei der Port-Validierung gegengetestet werden.

## Log
- 2026-11-24: About ist maximal 450 px breit; bei schmalen Fenstern schrumpft der Dialog. Die Textzeilen haben gleiche sichtbare Abstaende. Links neben **Clear log** kopiert **Copy log** die aktuellen Eintraege in Anzeigereihenfolge als tabgetrennten Text; ohne Eintraege ist die Schaltflaeche deaktiviert. Beleg: Die fokussierten About- und Debug-Dock-Tests in `startup-ui.test.mjs` bestanden mit Playwright Chromium, Zwischenablage im Test gemockt.
- 2026-11-20: About und Dev-Tools im Drei-Punkte-Menue, selektive Webseiten-Kontextmenues und feste Repository-Oeffnung hinzugefuegt. Integrierter Mock-Browser erfolgreich; CLI-UI-Lauf vor Assertions mit Edge Exit 21 blockiert. Die native Abnahme war damals noch offen.
- 2026-06-25: Spec angelegt.
- 2026-11-16: Darstellung auf das Console-Mockup umgestellt (siehe Fortschreibung AD-004): kompakter Header, Inline-Aliase, einklappbare Sprecherzuordnung, größenstabiler Tab-Dialog und aufwärts öffnender Debug-Dock. Regressionstests prüfen Layoutgrenzen, Alias-Export, Audio-Synchronisation, gestopptes Löschen, Debug-Höhenlimit, Auto-Scroll und Timer-Lebenszyklus. Backend- und Audio-Akzeptanz werden dadurch nicht ersetzt.