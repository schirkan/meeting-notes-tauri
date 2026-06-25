# T-500: Qualitätssicherung und Akzeptanztests

## Kontext
Status: draft
Priorität: high
Subtasks: T-501, T-502, T-503, T-504, T-505
Abhängigkeiten: -

## Goal
Vollständige QA-Strecke für die Tauri-Variante: Smoke-Test, Latency-Messung, Distribution-Builds, Portable-Build, Proxy-Workaround-Validierung.

## Done When
- [ ] Smoke-Test deckt Tauri-Start + Sidecar-Spawn + Speech-Pipeline-Init ab.
- [ ] Latency-Messung dokumentiert < 5 s End-to-End.
- [ ] `tauri build` produziert MSI/NSIS-Installer.
- [ ] Portable-Build ist lauffähig.
- [ ] Bundle-Größe ist ≤ 30 MB (Zielwert).
- [ ] Proxy-Workaround (T-505) ist in restriktiver Umgebung validiert.

## Approach
- T-501 bis T-505 sequenziell umsetzen.
- Tests zuerst manuell, dann (optional) automatisiert.

## Log
- 2026-06-25: Spec angelegt.