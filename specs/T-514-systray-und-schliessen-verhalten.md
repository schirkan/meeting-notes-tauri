# T-514 - Systray und Schliessen-Verhalten

## Kontext
Status: teils umgesetzt (offen: native Abnahme von Taskleiste, Alt+F4 und Beenden waehrend einer Transkription)
Prioritaet: medium
Abhaengigkeiten: T-300, T-305, T-403, T-513

## Ziel
Martin wuenscht ein dauerhaftes Windows-Systray-Icon mit Kontextmenue
**Anzeigen**, **Beenden**. Doppelklick oeffnet das Hauptfenster. Eine neue
Einstellung bestimmt, ob Schliessen die App beendet oder nur im Tray verbirgt.

## Verhalten
- Beim App-Start wird genau ein Tray-Icon mit vorhandenem App-Icon und Tooltip
  `Meeting Notes` angelegt. Seine Existenz ist nicht vom Auto-Start oder Aufnahmezustand abhaengig.
- Die Iconfarbe zeigt den Aufnahmestatus: **rot** bei Aufnahme, **gelb** bei Pause,
  Originalfarbe nach Stop, fehlgeschlagenem Start oder Sidecar-Absturz. Der Tooltip
  lautet dabei `Meeting Notes - Transcribing`, `Meeting Notes - Paused` oder `Meeting Notes`.
  Dies gilt auch bei verborgenem Fenster und automatisch gestarteten Aufnahmen.
- Rechtsklick zeigt genau zwei Eintraege in dieser Reihenfolge: `Anzeigen`, `Beenden`.
- `Anzeigen` und linker Doppelklick machen das vorhandene Hauptfenster sichtbar,
  stellen es aus minimiertem Zustand wieder her und fokussieren es. Kein zweites Fenster.
- Neue Settings-Achse: `user.window.minimizeToTrayOnClose: boolean`, Default **true**
  ab v0.1.2 (Entscheidung Martin, 18.11.2026). Fehlende Felder erhalten true;
  ausdruecklich gespeichertes false bleibt false. Urspruenglich war der Default false.
- Checkbox unter **Allgemein**: `Beim Schließen in den Systray minimieren`.
  Aenderung wird ueber den vorhandenen Speichern-Pfad persistiert und gilt sofort
  nach erfolgreichem Speichern, ohne Neustart. Kein eigener Speichern-Button.
- **Hide from taskbar** unter **General** (`user.window.hideFromTaskbar`, Default **true**) blendet auch das sichtbare Hauptfenster aus der Taskleiste aus. Explizites `false` bleibt gespeichert. Die Einstellung gilt beim Start und nach **Save** ohne Neustart und ist unabhaengig vom Schliessen-Verhalten. Kann das Tray nicht initialisiert werden, bleibt der Taskleisteneintrag als Rueckweg erhalten.
- Einstellung **an** (Schliessen): X/Alt+F4 verbirgt das Hauptfenster, ohne App/Sidecars zu stoppen.
  Das Fenster verschwindet aus Taskleiste und Alt+Tab; Aufnahme, Pause-Zustand und
  Meeting-Erkennung laufen unveraendert weiter. Verbergen ist kein Aufnahme-Stop.
- Einstellung **aus**: X/Alt+F4 beendet die App auch bei aktivem **Hide from taskbar**.
  **Quit** im Tray umgeht die Tray-Minimierung.
- Beide Beenden-Wege zeigen bei laufender oder pausierter Transkription einen nativen
  Dialog (**Quit** / **Cancel**), auch bei verborgenem Hauptfenster. Ohne aktive Sitzung
  endet die App sofort. Abbruch laesst Fenster und Sitzung unveraendert. Bestaetigung
  loest intern **Stop** aus, uebernimmt die letzten vom Sidecar gelieferten Segmente
  und wartet auf den Markdown-Export (siehe [T-506](./T-506-transkript-markdown-export-und-frontmatter.md)). Erst danach beendet sich die App. Bei einem Stop- oder
  Schreibfehler bleibt die App mit dem Transkript offen; **Quit** kann erneut
  versucht werden.
- Kann kein Tray erstellt werden, meldet Windows keine erreichbare Tray-Position
  (`tray.rect()`), oder kann das Fenster nicht verborgen werden, greift derselbe
  Beenden-Weg. Kein unerreichbares Hintergrundfenster.
- Kein Autostart mit Windows, kein Start im Tray und keine zusaetzlichen Menuepunkte.

## Technische Umsetzung
Tauri-Feature `tray-icon`; natives Tray/Menu im Rust-Main, keine Renderer-Emulation.
`src-tauri/src/tray.rs` behandelt CloseRequested des Hauptfensters (`main`):
Es verbirgt das Fenster bei aktivem Close-to-Tray und erreichbarem Tray,
sonst ruft es wie Tray-**Quit** `request_quit` auf. Diese Funktion wartet auf einen
bereits begonnenen Start, blockiert neue Starts und doppelte Anfragen bis zur
Entscheidung. Bei Bestaetigung wartet Rust auf die strukturierte Sidecar-Stop-Quittung,
den Prozess-Exit und die Bestaetigung des Renderers, dass die Markdown-Datei
atomar geschrieben wurde. Erst dann erfolgt der bestehende App-Exit. Bei Abbruch
wird die Sperre aufgehoben. Der Fenstercache spiegelt die erfolgreich persistierten Optionen.
Tauri `set_skip_taskbar` wird beim Start nach der Tray-Initialisierung, nach
erfolgreichem Speichern und bei Wiederherstellung aus dem Tray angewendet.
TS/Rust-Contracts und Beispielconfig enthalten beide Fensteroptionen.
`events::emit_status` aktualisiert auch den nativen Tray-Indikator. Die Aktualisierung
liest den aktuellen Zustand im UI-Thread, damit verzoegerte Statusmeldungen keine alte
Farbe wiederherstellen. Die vorhandenen Icon-Pixel werden ohne neue Assets/Dependencies
eingefaerbt; Transparenz und Kontrast bleiben erhalten. Fehler werden im Debug-Log gemeldet.
Testnachweis: `recording_indicator_tracks_start_pause_resume_and_stop` und
`recording_icons_preserve_shape_alpha_and_restore_the_original`. Die echte Windows-
Farbumschaltung bei Aufnahme/Pause ist Teil des unten noch offenen Abnahmepunkts.

## Done When
- [x] Tray mit vorhandenem App-Icon und den Menuepunkten Anzeigen/Beenden ist eingebunden. Beleg: src-tauri/src/tray.rs (init, Menu::with_items), Cargo.toml (tray-icon). Testnachweis: Cargo-Compile und `tray_menu_actions_distinguish_show_from_real_exit`.
- [x] Anzeigen und linker Doppelklick verwenden denselben Show/Unminimize/Focus-Pfad. Beleg: src-tauri/src/tray.rs (show_main, MouseButton::Left). Formnachweis: beide Handler rufen dieselbe Funktion auf; native Interaktionsabnahme separat.
- [x] Schliessen verbirgt nur bei aktivierter Einstellung; Beenden bleibt ein echter Exit. Beleg: `on_window_event` und `request_quit` in tray.rs; Tests `close_policy_requires_enabled_setting_available_tray_and_main_window` und `tray_menu_actions_distinguish_show_from_real_exit`.
- [x] Schliessen und Tray-**Quit** verwenden dieselbe Sitzungsschutzabfrage. Beleg: `request_quit` und `show_quit_confirmation` in tray.rs; Test `quit_requests_are_deduplicated_until_cancelled` fuer die gemeinsame Sperre.
- [x] Verbergen veraendert Aufnahme/Pause/Detektor nicht; Exit nutzt das bestehende Cleanup. Beleg: tray.rs verbirgt ausschliesslich Window; lib.rs RunEvent::ExitRequested/Exit behaelt Sidecar- und Detektor-Cleanup. Formnachweis: kein Recording-/Detektor-Aufruf im Hide-Pfad; native Probe separat.
- [x] Settings-Default, Persistenz, sofortige Uebernahme und Checkbox sind implementiert. Beleg: TS/Rust WindowSettings, commands::save_user_settings aktualisiert Cache erst nach erfolgreichem Save, SettingsPanel.tsx, Beispielconfig. Testnachweis: `close_to_tray_defaults_on_and_persists_both_boolean_values`, Node-Tests fuer malformed Defaults, true/false sowie Checkbox-Persistenz und Recording-Sperre.
- [x] Typecheck, Node-/Rust-Tests und Release-Build sind bestanden. Beleg: v0.1.2, 92 Node-Tests, 44 Rust-Tests, Tauri-Release-Build, Portable 31,37 MB / 4 Dateien / 3 Hashes, Smoke gruen, Deployment PASS 9 / FAIL 0 (18.11.2026). Testnachweis: npm run typecheck, npm run test:unit, cargo test, npm run tauri -- build --no-bundle, npm run test:smoke, npm run verify:deployment.
- [x] Native Windows-Abnahme: sichtbares Icon, Kontextmenue, Doppelklick und X bei beiden Optionen. Beleg: manuelle Nutzerabnahme vom 19.11.2026, im Gespraech bestaetigt; keine synthetische Callback-Probe als Ersatz behauptet.
- [ ] Native Windows-Abnahme: X/Alt+F4 mit deaktivierter Tray-Minimierung und **Quit** bei verborgenem Fenster jeweils ohne, mit laufender und mit pausierter Sitzung pruefen. Bei **Cancel** die unveraenderte Sitzung pruefen; bei **Quit** letzte Segmente, die fertige Markdown-Datei vor Prozessende sowie Fehler und Wiederholung pruefen. Alt+F4 mit aktivierter Tray-Minimierung muss die Sitzung ohne Rueckfrage weiterlaufen lassen. - **offen**: Die neue native Abfrage und die bisher nicht visuell bestaetigten Icon-Farben erfordern einen interaktiven Test mit einer laufenden Sitzung.

- [x] Taskleistenoption und Tray-Fallback sind implementiert. Beleg: `apply_window_settings` in tray.rs, TS/Rust-Normalisierung und Beispielconfig; Regressionen `taskbar_hiding_defaults_on_and_preserves_opt_out_independently`, `taskbar_policy_requires_tray_and_is_independent_of_close_policy` und `Hide from taskbar defaults on and only applies the changed preference on Save`.
- [ ] Native Windows-Abnahme der Taskleistenoption. - **offen**: Default und gespeichertes `false` beim Start, sofortiger Wechsel nach **Save** in beide Richtungen sowie Wiederherstellung aus dem Tray mit sichtbarer Taskleiste pruefen; Renderer-Tests simulieren nur die Persistenz.

## Manuelle Abnahme (19.11.2026)
Der Nutzer bestaetigt Tray-Icon, Kontextmenue, Doppelklick und Schliessen per X
bei beiden Einstellungen. Alt+F4 und Beenden waehrend einer Aufnahme wurden
nicht getestet und bleiben offen. Die historischen SKIPPED-Nachweise unten
beschreiben die damalige automatisierte Testumgebung, nicht diese Nutzerabnahme.

## Aktualisierung v0.1.2 (18.11.2026)
Default jetzt **an** nach Martins Vorgabe. Neuer Release-/Default-Testlauf:
92 Node-Tests, 44 Rust-Tests, Release-Build/Smoke bestanden, Deployment PASS 9 / FAIL 0.
Explizites false bleibt erhalten. Native Explorer-Abnahme weiterhin SKIPPED;
die alte Messung unten bleibt als historischer Nachweis erhalten.

## Historische Nachweise der T-514-Implementierung (18.11.2026, vor v0.1.2)
- Typecheck und 89 Node-Tests bestanden; darunter true/false-Persistenz,
  fehlende/malformed Defaults, Checkbox-Anzeige und Sperre waehrend Aufnahme.
- 44 Rust-Tests bestanden; neue Tests fuer WindowSettings, Close-Policy und
  Menueaktionen. Beenden bleibt app.exit(0), nicht window.close().
- Tauri-Release-Build bestanden. Portable: **31,37 MB / 4 Dateien**, Haupt-EXE
  16,48 MB, Sidecar 14,89 MB; **3/3** SHA256-Summen. Smoke bestanden,
  Deployment **PASS 9 / FAIL 0**. Kein neuer Release/Tag erstellt.
- `scripts/test-tray.ps1 -CompileOnly` bestanden. Native Ausfuehrung: **SKIPPED**
  mangels interaktivem Desktop/Explorer; keine falsche Native-PASS-Behauptung.
- `npm run test:tray` ist eine wiederholbare native Probe mit isolierter App-Kopie
  und Config ohne Credentials/Aufnahme. Sie testet synthetisierte native Tray-
  Callback-Nachrichten, Menueeintraege, WM_CLOSE, Wiederanzeigen/Unminimize und
  Exit mit Detektor-Cleanup. Physische Maus-Interaktion, Fokus und Alt+F4 bleiben
  manuell zu pruefen, ebenso Exit waehrend einer echten Aufnahme.
- Die Probe veraendert keine persoenliche Config. Temp-Pfad kann explizit mit
  `-TestRoot` gesetzt werden; Cleanup ist auf eigene Testprozesse/-Dateien begrenzt.

Automatisierte Policy-/UI-Tests und synthetische Callback-Nachrichten sind kein
Ersatz fuer die echte Explorer-Abnahme.
