# T-304: Connectivity-Diagnose in Rust (Pendant zu azure-connectivity.ts)

## Kontext
Status: draft
Priorität: high
Abhängigkeiten: T-302

## Goal
DNS-/TCP-/HTTPS-Diagnose gegen den konfigurierten Azure-Endpoint als Tauri-Command verfügbar machen.

## Done When
- [ ] Modul `src-tauri/src/connectivity.rs` mit Funktion `diagnose_endpoint_reachability(endpoint: &str) -> ConnectivityResult`.
- [ ] Diagnose-Schritte: System-DNS-Lookup → Fallback-DNS-Lookup → TCP-Connect auf Port 443 → HTTPS-HEAD-Probe.
- [ ] Tauri-Command `test_azure_connectivity` ruft die Diagnose auf und emittiert das Result-Karte-Objekt.
- [ ] Result-Karte enthält: `status` (OK/FAIL), `http_code`, `latency_ms`, `probe_url`, `steps: Vec<Step>` mit DNS-/TCP-/HTTPS-Ergebnissen.
- [ ] Funktioniert unabhängig davon, ob der Sidecar läuft (d. h. der Button funktioniert auch ohne aktive Speech-Pipeline).

## Approach
- Crates: `hickory-resolver` (oder `trust-dns-resolver`) für DNS, `tokio::net::TcpStream` für TCP, `reqwest` (oder `hyper`) für HTTPS-HEAD.
- Diagnose ist `async` und mit Timeout pro Schritt (3 s).
- Bestehende Diagnose-Logik aus `../meeting-notes/src/main/azure-connectivity.ts` dient als Vorlage (gleiche Schritte, gleiche Fehlerklassifizierung).
- Result wird im UI als Karte mit aufklappbarer Step-Liste dargestellt (Komponente 1:1 portiert).

## Log
- 2026-06-25: Spec angelegt.