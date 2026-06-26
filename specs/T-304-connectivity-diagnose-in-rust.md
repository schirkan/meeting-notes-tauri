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
- Crates: `hickory-resolver 0.24` für DNS, `tokio::net::TcpStream` für TCP, `reqwest` (mit `rustls-tls`-Feature) für HTTPS-HEAD. — Die in 0.24 entfernte `TokioResolver`-Statik-API wurde durch `hickory_resolver::TokioAsyncResolver::tokio(config, opts)` ersetzt; beide `dns_lookup_system` und `dns_lookup_fallback` rufen diesen Konstruktor mit `ResolverConfig::default()` / `ResolverOpts::default()` auf (semantisch aktuell identisch, weil `system` und `fallback` denselben Resolver-Typ verwenden — eine echte Differenzierung über system-DNS vs. Cloudflare/Google ist als Folgeaufgabe offen).
- Diagnose ist `async` und mit Timeout pro Schritt (5 s — `PROBE_TIMEOUT`).
- Bestehende Diagnose-Logik aus `../meeting-notes/src/main/azure-connectivity.ts` dient als Vorlage (gleiche Schritte, gleiche Fehlerklassifizierung).
- Result wird im UI als Karte mit aufklappbarer Step-Liste dargestellt (Komponente 1:1 portiert).

## Log
- 2026-06-25: Spec angelegt.
- 2026-06-26: hickory-API-Drift korrigiert (`TokioResolver::build` → `TokioAsyncResolver::tokio`, `use url::Url` raus, `format!`-Borrow-Lifetime-Fix in `probe_url_from_endpoint`).