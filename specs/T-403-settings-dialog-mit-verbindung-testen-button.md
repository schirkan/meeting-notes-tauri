# T-403: Settings-Dialog mit Verbindung-testen-Button

## Kontext
Status: draft
Priorität: high
Abhängigkeiten: T-402, T-304

## Goal
Settings-Dialog portieren und den Verbindung-testen-Button funktional an die Rust-Connectivity-Diagnose (T-304) binden.

## Done When
- [ ] Verbindung-testen-Button löst `tauriAPI.testAzureConnectivity()` aus.
- [ ] Result-Karte zeigt Status, HTTP-Code, Latenz, Probe-URL und aufklappbare Step-Liste.
- [ ] Bei Fehler zeigt die Step-Liste detaillierte Diagnose (DNS-System, DNS-Fallback, TCP, HTTPS).
- [ ] Button funktioniert unabhängig vom Sidecar-Status.
- [ ] Fokus-Management bleibt korrekt (Trick mit `[isOpen]`-Dependency im `useEffect`, Initial-Fokus auf erstes Eingabefeld).

## Approach
- Result-Karte-Komponente 1:1 portieren aus `../meeting-notes/src/renderer/src/components/ConfigPanel.tsx`.
- Tauri-Event `transcript:connectivity-result` triggert die Karten-Aktualisierung.
- Diagnose-Ergebnisse werden zusätzlich in den Debug-Log emittiert (`transcript:debug`).

## Log
- 2026-06-25: Spec angelegt.