# T-500: Qualitätssicherung und Akzeptanztests

## Kontext
Status: teils umgesetzt (3 Punkte offen)
Priorität: high
Subtasks: T-501, T-502, T-503, T-504, T-505
Abhängigkeiten: -

## Goal
Vollständige QA-Strecke für die Tauri-Variante: Smoke-Test, Latency-Messung, Distribution-Builds, Portable-Build, Proxy-Workaround-Validierung.

## Done When
- [x] Smoke-Test deckt Build-Artefakte + Sidecar-Spawn ab (T-501, headless ohne WebDriver). Beleg: scripts/test-smoke.mjs (Stufen 1-5: Renderer, Tauri-EXE, Sidecar-EXE, Portable, TS-Contract) - bestanden.
- [ ] Latency-Messung dokumentiert < 5 s End-to-End (T-502) - **offen**: erfordert Live-Azure-Credentials + Audio-Input.
- [x] MSI/NSIS-Builds wurden zuvor verifiziert (T-503); heutige Rebuilds verwenden `--no-bundle`. Aktuelle Installer-Parität ist dadurch nicht erneut nachgewiesen. Beleg: src-tauri/tauri.conf.json (Bundle-Targets); die heutigen Rebuilds laufen bewusst mit --no-bundle.
- [x] Aktueller Portable-Build ist lokal lauffähig (T-504; kein Clean-Machine-Nachweis). Beleg: scripts/verify-deployment.ps1 -LaunchApp (App startet, PASS 10 / FAIL 0).
- [x] **Gesamte Portable-Distribution** ist ≤ 30 MB: Stand 2026-11-17 (Rebuild nach T-201) Haupt-EXE 15,56 MB, Sidecar 7,62 MB, gesamt 23,19 MB ueber 24 Dateien / 23 Summen. Stand 2026-11-16 (Rebuild nach T-511): Haupt-EXE 15,48 MB, gesamt 23,10 MB. Beleg: scripts/dist-portable.mjs (Messwerte im Build-Output) und README.md.
- [x] Proxy-Workaround (T-505) ist in restriktiver Umgebung validiert — **offen**. Beleg: am 2026-11-12 im Firmennetz erfolgreich validiert (T-505/T-306).
- [x] Konfigurations-Regressionen lokal erfolgreich (`tests/config-utils.test.mjs`); gesamter Test-Runner: `npm run test:unit`. Beleg: tests/config-utils.test.mjs (config-utils.test.mjs), package.json (run) (geprueft).
- [x] 31 Browser-UI-Regressionstests (heute 75 Node-Tests insgesamt): Startup bei fehlender/ungültiger Config, Bottom-Toast ohne Layout-Verschiebung, drei responsive Settings-Bereiche, zwei Footer-Pfade, Proxy-Save-/Test-Payloads und detaillierter Diagnose-Dialog einschließlich Schließen/Wiederöffnen. Beleg: tests/startup-ui.test.mjs (31 Browser-UI-Regressionstests; heute insgesamt 75 Node-Tests) - alle gruen.
- [x] TypeScript-Prüfung und drei fokussierte Rust-Tests für relative Config-Pfade und beide serialisierten Pfade erfolgreich. Beleg: npm run typecheck (gruen) und die Rust-Tests in src-tauri/src/settings.rs (relative Config-Pfade, Serialisierung).
- [x] Native lokale Prüfung: Release-F12, Laden/Speichern neben der EXE bei fremdem Arbeitsverzeichnis sowie kontrollierte HTTPS-/Speech-Fehler im separaten Dialog. Kein echter Azure-Erfolg durch den Loopback-Negativtest behauptet. Beleg: scripts/verify-deployment.ps1 -LaunchApp (Laden/Speichern neben der EXE, PE-Subsystem 2 - kein Konsolenfenster).
- [x] Positiver Corporate-Proxy-/Speech-Test mit echten Zugangsdaten — am 2026-11-12 im Firmennetz erfolgreich (HTTPS **und** native Speech/WSS). Beleg: Am 2026-11-12 im Firmennetz erfolgreich (README.md, SPEC.md, specs/T-306).
- [ ] Erfolgreiche Aufnahme und End-to-End-Latenz (< 5 s) mit echten Zugangsdaten — weiterhin offen (siehe [T-502](./T-502-latenz-messung.md)). - **offen**: Braucht die Live-Aufnahme mit echten Zugangsdaten (T-502).
- [ ] Aktueller Portable-Build auf sauberem Windows-11-Zielsystem geprüft. - **offen**: Braucht ein frisches Windows-11-Zielsystem (T-510).

## Approach
- T-501 bis T-505 sequenziell umsetzen.
- Tests zuerst manuell, dann (optional) automatisiert.

## Log
- 2026-06-25: Spec angelegt.
- 2026-11-09: Aktuelle UI-/Config-/Diagnose-Validierung und Portable-Messwerte dokumentiert; reale Netz-, Aufnahme-, Latenz- und Clean-Machine-Tests ausdrücklich offen gehalten.
- 2026-11-12: Corporate-Proxy-/Azure-Test im Firmennetz erfolgreich — Netz-Akzeptanz abgeschlossen, kein Proxy-Workaround nötig. Aufnahme-Latenz und Clean-Machine-Deployment bleiben offen.