# T-500: Qualitätssicherung und Akzeptanztests

## Kontext
Status: partial
Priorität: high
Subtasks: T-501, T-502, T-503, T-504, T-505
Abhängigkeiten: -

## Goal
Vollständige QA-Strecke für die Tauri-Variante: Smoke-Test, Latency-Messung, Distribution-Builds, Portable-Build, Proxy-Workaround-Validierung.

## Done When
- [x] Smoke-Test deckt Build-Artefakte + Sidecar-Spawn ab (T-501, headless ohne WebDriver).
- [ ] Latency-Messung dokumentiert < 5 s End-to-End (T-502) — **offen**: erfordert Live-Azure-Credentials + Audio-Input.
- [x] MSI/NSIS-Builds wurden zuvor verifiziert (T-503); heutige Rebuilds verwenden `--no-bundle`. Aktuelle Installer-Parität ist dadurch nicht erneut nachgewiesen.
- [x] Aktueller Portable-Build ist lokal lauffähig (T-504; kein Clean-Machine-Nachweis).
- [x] **Gesamte Portable-Distribution** ist ≤ 30 MB: Stand 2026-11-13 Haupt-EXE 14.19 MB, Sidecar 6.77 MB, Gesamt 20.96 MB einschließlich Templates und Hashdatei. 26 Dateien, 25 geprüfte SHA256-Summen.
- [ ] Proxy-Workaround (T-505) ist in restriktiver Umgebung validiert — **offen**.
- [x] Konfigurations-Regressionen lokal erfolgreich (`tests/config-utils.test.mjs`); gesamter Test-Runner: `npm run test:unit`.
- [x] 12 Browser-UI-Regressionstests: Startup bei fehlender/ungültiger Config, Bottom-Toast ohne Layout-Verschiebung, drei responsive Settings-Bereiche, zwei Footer-Pfade, Proxy-Save-/Test-Payloads und detaillierter Diagnose-Dialog einschließlich Schließen/Wiederöffnen.
- [x] TypeScript-Prüfung und drei fokussierte Rust-Tests für relative Config-Pfade und beide serialisierten Pfade erfolgreich.
- [x] Native lokale Prüfung: Release-F12, Laden/Speichern neben der EXE bei fremdem Arbeitsverzeichnis sowie kontrollierte HTTPS-/Speech-Fehler im separaten Dialog. Kein echter Azure-Erfolg durch den Loopback-Negativtest behauptet.
- [x] Positiver Corporate-Proxy-/Speech-Test mit echten Zugangsdaten — am 2026-11-12 im Firmennetz erfolgreich (HTTPS **und** native Speech/WSS).
- [ ] Erfolgreiche Aufnahme und End-to-End-Latenz (< 5 s) mit echten Zugangsdaten — weiterhin offen (siehe [T-502](./T-502-latenz-messung.md)).
- [ ] Aktueller Portable-Build auf sauberem Windows-11-Zielsystem geprüft.

## Approach
- T-501 bis T-505 sequenziell umsetzen.
- Tests zuerst manuell, dann (optional) automatisiert.

## Log
- 2026-06-25: Spec angelegt.
- 2026-11-09: Aktuelle UI-/Config-/Diagnose-Validierung und Portable-Messwerte dokumentiert; reale Netz-, Aufnahme-, Latenz- und Clean-Machine-Tests ausdrücklich offen gehalten.
- 2026-11-12: Corporate-Proxy-/Azure-Test im Firmennetz erfolgreich — Netz-Akzeptanz abgeschlossen, kein Proxy-Workaround nötig. Aufnahme-Latenz und Clean-Machine-Deployment bleiben offen.