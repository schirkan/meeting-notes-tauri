# T-514 - Systray und Schliessen-Verhalten

## Kontext
Status: teils umgesetzt (1 offener Punkt: native Kontextmenue- und Doppelklick-Abnahme)
Prioritaet: medium
Abhaengigkeiten: T-300, T-305, T-403, T-513

## Ziel
Martin wuenscht ein dauerhaftes Windows-Systray-Icon mit Kontextmenue
**Anzeigen**, **Beenden**. Doppelklick oeffnet das Hauptfenster. Eine neue
Einstellung bestimmt, ob Schliessen die App beendet oder nur im Tray verbirgt.

## Verhalten
- Beim App-Start wird genau ein Tray-Icon mit vorhandenem App-Icon und Tooltip
  `Meeting Notes` angelegt. Es ist nicht vom Auto-Start oder Aufnahmezustand abhaengig.
- Rechtsklick zeigt genau zwei Eintraege in dieser Reihenfolge: `Anzeigen`, `Beenden`.
- `Anzeigen` und linker Doppelklick machen das vorhandene Hauptfenster sichtbar,
  stellen es aus minimiertem Zustand wieder her und fokussieren es. Kein zweites Fenster.
- Neue Settings-Achse: `user.window.minimizeToTrayOnClose: boolean`, Default **true**
  ab v0.1.2 (Entscheidung Martin, 18.11.2026). Fehlende Felder erhalten true;
  ausdruecklich gespeichertes false bleibt false. Urspruenglich war der Default false.
- Checkbox unter **Allgemein**: `Beim Schließen in den Systray minimieren`.
  Aenderung wird ueber den vorhandenen Speichern-Pfad persistiert und gilt sofort
  nach erfolgreichem Speichern, ohne Neustart. Kein eigener Speichern-Button.
- Einstellung **an**: X/Alt+F4 verbirgt das Hauptfenster, ohne App/Sidecars zu stoppen.
  Das Fenster verschwindet aus Taskleiste und Alt+Tab; Aufnahme, Pause-Zustand und
  Meeting-Erkennung laufen unveraendert weiter. Verbergen ist kein Aufnahme-Stop.
- Einstellung **aus**: X/Alt+F4 behaelt den regulaeren App-Exit bei.
- `Beenden` beendet die App immer, auch bei aktivierter Tray-Minimierung. Bestehendes
  Cleanup fuer Aufnahme-Sidecar und Detektor bleibt erhalten. Kein versteckter Restprozess.
- Kann kein Tray erstellt werden, meldet Windows keine erreichbare Tray-Position
  (`tray.rect()`), oder kann das Fenster nicht verborgen werden, wird der Close
  nicht verschluckt. Kein unerreichbares Hintergrundfenster.
- Kein Autostart mit Windows, kein Start im Tray, keine dynamischen Recording-Icons
  und keine zusaetzlichen Menuepunkte in dieser Iteration.

## Technische Umsetzung
Tauri-Feature `tray-icon`; natives Tray/Menu im Rust-Main, keine Renderer-Emulation.
Neues Modul `src-tauri/src/tray.rs`; Fenster-ID `main`. CloseRequested wird nur
nach erfolgreichem Hide verhindert. Ein in-memory Bool spiegelt die erfolgreich
persistierte Einstellung, damit der UI-Eventhandler keine Dateizugriffe blockiert.
Tray-Beenden nutzt App-Exit, nicht Window-Close, damit die Option keinen Exit verhindert.
TS/Rust-Contracts und Beispielconfig enthalten dieselbe Settings-Achse.

## Done When
- [x] Tray mit vorhandenem App-Icon und den Menuepunkten Anzeigen/Beenden ist eingebunden. Beleg: src-tauri/src/tray.rs (init, Menu::with_items), Cargo.toml (tray-icon). Testnachweis: Cargo-Compile und `tray_menu_actions_distinguish_show_from_real_exit`.
- [x] Anzeigen und linker Doppelklick verwenden denselben Show/Unminimize/Focus-Pfad. Beleg: src-tauri/src/tray.rs (show_main, MouseButton::Left). Formnachweis: beide Handler rufen dieselbe Funktion auf; native Interaktionsabnahme separat.
- [x] Schliessen verbirgt nur bei aktivierter Einstellung; Beenden bleibt ein echter Exit. Beleg: src-tauri/src/tray.rs (on_window_event: hide vor prevent_close, app.exit(0)). Testnachweis: `close_policy_requires_enabled_setting_available_tray_and_main_window`, `tray_menu_actions_distinguish_show_from_real_exit`.
- [x] Verbergen veraendert Aufnahme/Pause/Detektor nicht; Exit nutzt das bestehende Cleanup. Beleg: tray.rs verbirgt ausschliesslich Window; lib.rs RunEvent::ExitRequested/Exit behaelt Sidecar- und Detektor-Cleanup. Formnachweis: kein Recording-/Detektor-Aufruf im Hide-Pfad; native Probe separat.
- [x] Settings-Default, Persistenz, sofortige Uebernahme und Checkbox sind implementiert. Beleg: TS/Rust WindowSettings, commands::save_user_settings aktualisiert Cache erst nach erfolgreichem Save, SettingsPanel.tsx, Beispielconfig. Testnachweis: `close_to_tray_defaults_on_and_persists_both_boolean_values`, Node-Tests fuer malformed Defaults, true/false sowie Checkbox-Persistenz und Recording-Sperre.
- [x] Typecheck, Node-/Rust-Tests und Release-Build sind bestanden. Beleg: v0.1.2, 92 Node-Tests, 44 Rust-Tests, Tauri-Release-Build, Portable 31,37 MB / 4 Dateien / 3 Hashes, Smoke gruen, Deployment PASS 9 / FAIL 0 (18.11.2026). Testnachweis: npm run typecheck, npm run test:unit, cargo test, npm run tauri -- build --no-bundle, npm run test:smoke, npm run verify:deployment.
- [ ] Native Windows-Abnahme: sichtbares Icon, Kontextmenue, Doppelklick, X und Alt+F4 bei beiden Optionen sowie echter Exit mit laufendem Sidecar. - **offen**: Ausfuehrung von scripts/test-tray.ps1 meldet SKIPPED, weil das Gateway in Session 0 laeuft. Ueber eine geplante Aufgabe mit LogonType=Interactive ist die interaktive Sitzung erreichbar: das Tray-Icon ist nativ belegt (Screenshot docs/native/11-taskbar-mit-app-icon.png); Kontextmenue, Doppelklick und Exit bleiben unbelegt, weil synthetische Maus-Eingaben in der getrennten Sitzung nicht zugestellt werden. PowerShell-/Win32-Testhelfer kompiliert; echte Maus-/Explorer-Interaktion und Aufnahme-Exit sind nicht belegt.

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
