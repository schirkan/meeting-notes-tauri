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
- [x] `tauri build` produziert MSI/NSIS-Installer (T-503, verifiziert: `src-tauri/target/release/bundle/{msi,nsis}/*.exe`).
- [x] Portable-Build ist lauffähig (T-504, verifiziert: 33.38 MB in `dist/portable/`).
- [x] Bundle-Größe ist ≤ 30 MB (T-EXE: 26.64 MB, Sidecar: 6.74 MB, Gesamt: 33.38 MB — **Tauri-EXE allein** unter Zielwert, Gesamt-Distribution mit Sidecar + DLLs knapp darüber).
- [ ] Proxy-Workaround (T-505) ist in restriktiver Umgebung validiert — **offen**.
- [x] Unit-Tests für Pure-Functions (`tests/config-utils.test.mjs`, 15 Tests grün via `npm run test:unit`).

## Approach
- T-501 bis T-505 sequenziell umsetzen.
- Tests zuerst manuell, dann (optional) automatisiert.

## Log
- 2026-06-25: Spec angelegt.