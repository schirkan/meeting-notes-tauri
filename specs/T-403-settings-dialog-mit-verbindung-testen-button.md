# T-403: Settings-Dialog und separater Verbindungstest

## Kontext
Status: implemented
Priorität: high
Abhängigkeiten: T-402, T-304

## Goal
Azure-, Benutzer- und Proxy-Einstellungen bearbeiten und HTTPS sowie native Speech/WSS-Verbindungen getrennt mit nachvollziehbaren Ergebnissen testen.

## Done When
- [x] Drei Bereiche stehen nebeneinander: **Allgemein**, **Azure-Konfiguration**, **Proxy** (rechts). Bei Fensterbreiten bis 960 px stehen sie untereinander.
- [x] Proxy-Aktivierung, Host, Port und optionale Zugangsdaten befinden sich ausschließlich im Proxy-Bereich. Azure- und Proxy-Werte werden gemeinsam über **Azure-Konfiguration speichern** gespeichert.
- [x] Die Sprachauswahl im Bereich **Allgemein** ist ein Dropdown mit den bisherigen Sprachoptionen. Bereits konfigurierte weitere Sprachcodes bleiben erhalten; während einer Aufnahme ist die Auswahl deaktiviert.
- [x] **Verbindung testen** sowie das Wiederöffnen des laufenden/letzten Tests befinden sich im Bereich **Azure-Konfiguration**. Die Aktionen haben auch bei Zeilenumbrüchen mindestens 12 px Abstand.
- [x] Beide Konfigurationspfade werden unterhalb aller Bereiche im Dialog-Footer angezeigt, nicht innerhalb einzelner Panels; die tatsächlichen Pfade stammen aus dem Backend.
- [x] Fehlende, nicht lesbare oder unvollständige Azure-Konfiguration öffnet beim Start automatisch die Einstellungen. Der schließbare Hinweis erscheint als Toast unten, ohne Layout-Verschiebung. Manuelles Schließen öffnet den Dialog nicht erneut.
- [x] Der Button ruft `window.transcriptApi.testAzureConnectivity()` mit aktuellen, auch ungespeicherten Azure-/Proxy-Werten und Sitzungssprache auf.
- [x] Ein separater **Verbindungstest-Dialog** zeigt während des Tests einen laufenden Status und danach HTTPS-/Speech-Erreichbarkeit, HTTP-Code, Dauer, Probe-URL, Zeitpunkt sowie alle Schritte in einer Tabelle mit Status und Details. Inhalt und Tabelle nutzen die gesamte innere Dialogbreite, auch auf schmalen Fenstern.
- [x] Fehler aus Frontend-Validierung oder IPC (auch String-/Objekt-Rejections) erscheinen als eigene Fehlerschritte mit Details; die nicht ausgeführten Transporte stehen auf **nicht geprüft**.
- [x] Schließen des Diagnose-Dialogs führt zu den Einstellungen zurück und bricht den Test nicht ab. Wiederöffnen startet keine zweite Diagnose und erhält Draft-Werte und Ergebnisse.
- [x] HTTPS läuft in Rust; Speech/WSS in einem separaten Diagnose-Sidecar, ohne Aufnahme und unabhängig vom Aufnahme-Sidecar. Ein positives HTTPS-Ergebnis allein bedeutet keinen erfolgreichen Speech-Test.
- [x] Escape, Focus-Trap und Initial-Fokus bleiben erhalten (`SettingsDialog`, Effekte abhängig von `[isOpen]`).

## Approach
- [ConfigPanel](../src/renderer/src/components/ConfigPanel.tsx), [ProxyPanel](../src/renderer/src/components/ProxyPanel.tsx), [SettingsDialog](../src/renderer/src/components/SettingsDialog.tsx) und [ConnectivityDialog](../src/renderer/src/components/ConnectivityDialog.tsx) teilen den State aus [use-app-state](../src/renderer/src/use-app-state.ts).
- Ergebnisanzeige nutzt den `invoke()`-Return-Wert. Das Backend emittiert zusätzlich `transcript:connectivity-result`; ein Event-Abonnement ist für den Dialog nicht erforderlich.
- **Keine Live-Einzelsteps:** Die Tabelle erscheint erst nach Rückkehr der Diagnose. Währenddessen wird nur der laufende Gesamt-/Transportstatus angezeigt.
- TLS-Verhalten und Proxy-Validierung siehe [T-304](./T-304-connectivity-diagnose-in-rust.md) und [T-306](./T-306-proxy-aware-azure-transport.md).
- 15 [UI-Regressionstests](../tests/startup-ui.test.mjs) prüfen Startup, Toast-Position, drei responsive Bereiche, Footer-Pfade, Sprach-Dropdown (Speichern, weitere Sprachcodes, Aufnahmesperre), Save-/Test-Payloads, Fehlerdetails und Wiederöffnen. Geometrische Prüfungen sichern volle Diagnosebreite bei 1280/800/560 px Fensterbreite und den Button-Abstand auf Desktop und schmalem Fenster ab.

## Log
- 2026-06-25: Spec angelegt.
- 2026-11-09: An implementierte Settings-Struktur und separaten Diagnose-Dialog angepasst; 12 Browser-Regressionstests erfolgreich. Native Diagnose mit absichtlich nicht erreichbarem Loopback-Endpoint bestätigt detaillierte HTTPS- und Speech/WSS-Fehler, nicht die Erreichbarkeit des Firmen-Azure-Endpunkts.