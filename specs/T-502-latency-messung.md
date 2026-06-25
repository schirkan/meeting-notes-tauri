# T-502: Latency-Messung

## Kontext
Status: draft
Priorität: medium
Abhängigkeiten: T-501

## Goal
End-to-End-Latenz messen: Audio-Frame im Sidecar → Azure-Transkript zurück im Renderer.

## Done When
- [ ] Skript `scripts/measure-latency-tauri.mjs` existiert.
- [ ] Misst:
  - Audio-Capture → Sidecar-interner Resampler
  - Resampler → Azure-PushStream
  - Azure-Response → Sidecar-Event
  - Sidecar-Event → JSON-Lines Pipe → Tauri-Main
  - Tauri-Main → Tauri-Event → Renderer
- [ ] Report `context/latency-report.md` mit P50/P95/P99 über 100 Audio-Chunks.
- [ ] Ziel: P95 < 5 s End-to-End.

## Approach
- Zeitstempel an jedem Pipeline-Übergang mitloggen.
- Aggregation in Rust (Sidecar-intern) und in Node-Test-Skript (Renderer-Seite).
- Optional: Flame-Chart-Visualisierung (z. B. via Chrome DevTools-Performance-Tab im Tauri-WebView2).

## Log
- 2026-06-25: Spec angelegt.