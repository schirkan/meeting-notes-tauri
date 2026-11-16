# T-403: Settings-Dialog und separater Verbindungstest

## Kontext
Status: implemented
Priorität: high
Abhängigkeiten: T-402, T-304

## Goal
Azure-, Benutzer- und Proxy-Einstellungen bearbeiten und HTTPS sowie native Speech/WSS-Verbindungen getrennt mit nachvollziehbaren Ergebnissen testen.

## Done When
- [x] Drei Tabs: **Allgemein**, **Azure-Konfiguration**, **Proxy**. Dialoggröße und -position bleiben beim Wechsel unverändert; Inhalt scrollt intern. Tabs besitzen horizontales Padding und unterstützen Pfeiltasten, Home und End.
- [x] Proxy-Aktivierung, Host, Port und optionale Zugangsdaten befinden sich ausschließlich im Proxy-Bereich. Azure-, Proxy- und Benutzereinstellungen werden gemeinsam über den einzigen Button **Speichern** im Dialog-Footer gespeichert.
- [x] Die Sprachauswahl im Bereich **Allgemein** ist ein Dropdown mit den bisherigen Sprachoptionen. Bereits konfigurierte weitere Sprachcodes bleiben erhalten; während einer Aufnahme ist die Auswahl deaktiviert.
- [x] Im Bereich **Allgemein** stehen **Sprechererkennung für Mikrofon** und **Sprechererkennung für Speaker** jeweils beim zugehörigen Gerät. Beide Checkboxen sind unabhängig, standardmäßig aktiviert und während einer Aufnahme deaktiviert. Alte Konfigurationen ohne Felder aktivieren beide; gespeichertes `false` bleibt erhalten. **Speichern** persistiert beide Werte; ein Hinweis erklärt die Anwendung auf die nächste Aufnahme.
- [x] **Verbindung testen** sowie das Wiederöffnen des laufenden/letzten Tests befinden sich im Bereich **Azure-Konfiguration**. Die Aktionen haben auch bei Zeilenumbrüchen mindestens 12 px Abstand.
- [x] Der Pfad der gemeinsamen Konfigurationsdatei wird unterhalb aller Bereiche im Dialog-Footer angezeigt, nicht innerhalb einzelner Panels; der tatsächliche Pfad stammt aus dem Backend. Dort steht auch der einzige **Speichern**-Button des Dialogs — die Panels enthalten keine eigenen Speichern-Buttons.
- [x] Der Anwendungshinweis und der Config-Pfad stehen links untereinander im Footer; **Speichern** steht rechtsbündig daneben und hat dieselbe Höhe wie der Textblock. Der Dialog ist bis zu 620 px hoch. Tabs nutzen Hintergrund/Unterstreichung statt seitlicher Fokusrahmen; der Proxy-Hinweis und der Tooltip für **Verbindung testen** entfallen.
- [x] Tabs verwenden den regulären Button-Hintergrund ohne transparenten Override. Das Settings-Icon ist ein zentriertes, symmetrisches Zahnrad mit acht gleichmäßig verteilten Zähnen.
- [x] Im Bereich **Allgemein** stehen **Transkript automatisch als Markdown speichern** (standardmäßig aktiv) und das optionale Feld **Speicherpfad** (leer = Anwendungsverzeichnis). Beide Felder sind während einer Aufnahme deaktiviert. Siehe [T-506](./T-506-transkript-markdown-export-und-frontmatter.md).
- [x] Fehlende, nicht lesbare oder unvollständige Azure-Konfiguration öffnet beim Start automatisch die Einstellungen. Der schließbare Hinweis erscheint als Toast unten, ohne Layout-Verschiebung. Manuelles Schließen öffnet den Dialog nicht erneut.
- [x] Der Button ruft `window.transcriptApi.testAzureConnectivity()` mit aktuellen, auch ungespeicherten Azure-/Proxy-Werten und Sitzungssprache auf.
- [x] Ein separater **Verbindungstest-Dialog** zeigt während des Tests einen laufenden Status und danach HTTPS-/Speech-Erreichbarkeit, HTTP-Code, Dauer, Probe-URL, Zeitpunkt sowie alle Schritte in einer Tabelle mit Status und Details. Inhalt und Tabelle nutzen die gesamte innere Dialogbreite, auch auf schmalen Fenstern.
- [x] Fehler aus Frontend-Validierung oder IPC (auch String-/Objekt-Rejections) erscheinen als eigene Fehlerschritte mit Details; die nicht ausgeführten Transporte stehen auf **nicht geprüft**.
- [x] Schließen des Diagnose-Dialogs führt zu den Einstellungen zurück und bricht den Test nicht ab. Wiederöffnen startet keine zweite Diagnose und erhält Draft-Werte und Ergebnisse.
- [x] HTTPS läuft in Rust; Speech/WSS in einem separaten Diagnose-Sidecar, ohne Aufnahme und unabhängig vom Aufnahme-Sidecar. Ein positives HTTPS-Ergebnis allein bedeutet keinen erfolgreichen Speech-Test.
- [x] Escape, Focus-Trap und Initial-Fokus bleiben erhalten (`SettingsDialog`, Effekte abhängig von `[isOpen]`).
- [x] Sprache, Mikrofon und Loopback tragen Icons. Ein Platzhalter neben Sprache hält Geräteauswahl und jeweilige Sprechererkennung paarweise in einer Zeile. Bis 500 px steht das Grid einspaltig.
- [x] Bei gestoppter Aufnahme und leerem Transkript zeigt der Hauptbereich ausschließlich Sprache und Audiooptionen mit Speichern-Aktion. Hauptbereich und Dialog teilen dieselben Draft-Werte; während einer Aufnahme einschließlich Pause sind die Optionen weiterhin gesperrt.

## Approach
- [ConfigPanel](../src/renderer/src/components/ConfigPanel.tsx), [ProxyPanel](../src/renderer/src/components/ProxyPanel.tsx), [SettingsDialog](../src/renderer/src/components/SettingsDialog.tsx) und [ConnectivityDialog](../src/renderer/src/components/ConnectivityDialog.tsx) teilen den State aus [use-app-state](../src/renderer/src/use-app-state.ts).
- Ergebnisanzeige nutzt den `invoke()`-Return-Wert. Das Backend emittiert zusätzlich `transcript:connectivity-result`; ein Event-Abonnement ist für den Dialog nicht erforderlich.
- **Keine Live-Einzelsteps:** Die Tabelle erscheint erst nach Rückkehr der Diagnose. Währenddessen wird nur der laufende Gesamt-/Transportstatus angezeigt.
- TLS-Verhalten und Proxy-Validierung siehe [T-304](./T-304-connectivity-diagnose-in-rust.md) und [T-306](./T-306-proxy-aware-azure-transport.md).
- 18 [UI-Regressionstests](../tests/startup-ui.test.mjs) decken Startup, Toast-Position, drei responsive Bereiche, Footer-Pfad, Sprach-Dropdown, Aufnahmesperre, Save-/Test-Payloads, Fehlerdetails und Wiederöffnen ab. Drei neue Tests prüfen unabhängige Diarization-Optionen und Mic-/Speaker-Anzeige, Aliase und Export. Geometrische Prüfungen sichern volle Diagnosebreite bei 1280/800/560 px Fensterbreite und den Button-Abstand ab.
- Console-Validierung: TypeScript-/Renderer-Build und headless Edge mit gemockter Tauri-Bridge. Tab-Geometrie, Tastatur-/Fokusverhalten, gemeinsame Save-/Test-Payloads und Audio-Synchronisation sind durch [UI-Regressionstests](../tests/startup-ui.test.mjs) abgedeckt; keine Live-Azure-Abnahme.

## Log
- 2026-06-25: Spec angelegt.
- 2026-11-09: An implementierte Settings-Struktur und separaten Diagnose-Dialog angepasst; 12 Browser-Regressionstests erfolgreich. Native Diagnose mit absichtlich nicht erreichbarem Loopback-Endpoint bestätigt detaillierte HTTPS- und Speech/WSS-Fehler, nicht die Erreichbarkeit des Firmen-Azure-Endpunkts.
- 2026-11-15: Auf **einen** Speichern-Button im Dialog-Footer umgestellt (vorher „Einstellungen speichern" im Allgemein-Bereich und „Azure-Konfiguration speichern" im Azure-Bereich). Der Button schreibt beide Abschnitte; die Benutzereinstellungen werden zuerst geschrieben, damit eine unvollständige Azure-Konfiguration die Sprach-/Geräteauswahl nicht verwirft. Fehler beider Abschnitte werden gemeinsam als Toast und als Hinweis im Footer angezeigt.
- 2026-11-16: Console-Design übernommen: größenstabiler Tab-Dialog, Audio-Icons und gepaartes Grid, synchronisierte Audiooptionen im leeren Hauptbereich. Bestehende Startup-, Save-, Sprach-, Diarization- und Diagnose-Regressionen auf die Tab-Struktur angepasst; keine Azure-Verbindung für diese Tests.