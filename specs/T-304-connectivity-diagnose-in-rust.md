# T-304: Connectivity-Diagnose in Rust (Pendant zu azure-connectivity.ts)

## Kontext
Status: umgesetzt
Priorität: high
Abhängigkeiten: T-302

## Goal
Proxy-aware DNS-/TCP-/HTTPS-Diagnose und getrennte native Speech/WSS-Validierung als Tauri-Command verfügbar machen.

## Done When
- [x] [connectivity.rs](../src-tauri/src/connectivity.rs) bietet `diagnose(endpoint, subscription_key, language, proxy) -> ConnectivityResult`.
- [x] DNS/TCP prüfen den konfigurierten Proxy-Host/-Port, andernfalls den Endpoint mit seinem expliziten Port oder 443. System-DNS nutzt `tokio::net::lookup_host`; es gibt keinen öffentlichen Fallback-DNS-Lookup. DNS-/TCP-Fehler sind Warnungen, die HTTPS-Probe ist maßgeblich.
- [x] `reqwest` nutzt einen expliziten HTTP-CONNECT-Proxy mit optionaler Basic-Authentifizierung. Ohne Proxy wird `.no_proxy()` gesetzt; automatische Umgebungsproxies werden nicht übernommen.
- [x] Die HTTPS-HEAD-Probe **validiert TLS-Zertifikate gegen den System-Vertrauensspeicher** (gleiche Prüfung wie der native Speech/WSS-Pfad) und folgt keinen Redirects. Probe-URL nutzt HTTPS, den Azure-Speech-Pfad und die Sitzungssprache; Endpoint-Zugangsdaten in der URL werden abgelehnt.
- [x] `test_azure_connectivity` akzeptiert `{ endpoint, region, speechKey, interimResults, proxy?, language? }`, validiert den Payload und führt HTTPS sowie native Speech/WSS-Diagnose parallel aus.
- [x] Speech/WSS wird durch einen separaten Sidecar-Prozess mit `--test-connectivity` geprüft, ohne Mikrofon/Loopback. `SpeechRecognizer` und `ConversationTranscriber` müssen jeweils `Connected` und `SessionStarted` erreichen.
- [x] Ergebnis enthält `reachable`, `httpsReachable`, `speechReachable`, `httpStatus?`, `httpStatusText?`, `latencyMs`, `probeUrl`, `error?`, `steps` mit `ok`/`warn`/`error`. `reachable = httpsReachable && speechReachable`.
- [x] HTTP 401/403 bestätigt nur HTTP-Erreichbarkeit, nicht gültige Zugangsdaten oder funktionierendes Speech/WSS.
- [x] Die Step-Einstufung der HTTPS-Probe folgt dem HTTP-Status: `2xx` = Erfolg, `401`/`403` = Warnung (Endpoint erreichbar, Speech-Key fehlt oder ist ungültig), `407` = Fehler (Proxy verlangt Authentifizierung), alle übrigen Codes = Warnung. Ein erfolgreicher Test wird damit nicht als „Warnung" dargestellt.
- [x] Rückgabe über `invoke()` und zusätzliches Event `transcript:connectivity-result` (siehe [T-303](./T-303-tauri-events.md)). Aufnahme-Sidecar muss nicht laufen.
- [x] HTTPS-Fehler enthalten die Fehlerursachenkette; fehlende Sidecar-Ergebnisse enthalten stderr/Prozessfehler und Exit-Code, unter Redaktion von Speech-Key und Proxy-Zugangsdaten.

## Approach
- HTTPS: `tokio::net` + `reqwest` (`rustls-tls`), 5 s Timeout pro DNS-/TCP-/HTTP-Probe. Kein Cloudflare-/Google-DNS-Bypass für Corporate-Netze.
- Native Diagnose: [sidecar.rs](../src-tauri/src/sidecar.rs) begrenzt den Diagnoseprozess auf 45 s und beendet ihn anschließend. Dies ist kein separater Timeout für jeden UI-Schritt.
- **TLS-Grenze:** HTTPS-Diagnose und native Windows-Speech-SDK-Prüfung validieren Zertifikate beide aktiv gegen den System-Vertrauensspeicher. Bei TLS-Inspection muss das Firmen-Root-CA dort vertrauenswürdig hinterlegt sein; andernfalls schlägt die HTTPS-Probe fehl, während der native Pfad unverändert bleibt. Es gibt keinen Zertifikatsbypass. Siehe [T-306](./T-306-proxy-aware-azure-transport.md).
- [T-403](./T-403-settings-dialog-mit-verbindung-testen-button.md) definiert den separaten Ergebnisdialog. Alle Schritte werden nach Abschluss angezeigt, nicht live einzeln gestreamt.
- Die Verbindung im realen Corporate-Netz wurde am 2026-11-12 validiert ([T-505](./T-505-proxy-aware-azure-transport.md)): HTTPS **und** native Speech/WSS erfolgreich über den konfigurierten CONNECT-Proxy.

## Log
- 2026-06-25: Spec angelegt.
- 2026-06-26: hickory-API-Drift korrigiert (`TokioResolver::build` → `TokioAsyncResolver::tokio`, `use url::Url` raus, `format!`-Borrow-Lifetime-Fix in `probe_url_from_endpoint`).
- 2026-11-09: Expliziten Proxy, System-DNS ohne externen Fallback, getrennte HTTPS-/Speech-WSS-Ergebnisse, TLS-Grenzen und detaillierte Fehler dokumentiert. Lokaler nativer Negativtest erfolgreich; Firmenproxy/Azure noch nicht live validiert.
- 2026-11-12: **Im Firmennetz erfolgreich validiert** — HTTPS- und beide nativen Speech-Ergebnisse positiv über den CONNECT-Proxy.
- 2026-11-15: HTTPS-Zertifikatsprüfung aktiviert (`danger_accept_invalid_certs` entfernt). Regressionstest `https_probe_rejects_untrusted_certificate` startet einen lokalen TLS-Server mit selbstsigniertem Zertifikat und belegt, dass die Probe es ablehnt.
- 2026-11-15: Status-Einstufung der HTTPS-Probe korrigiert — vorher wurde jeder Status außer 401/403 pauschal als „Warnung" etikettiert, also auch ein erfolgreiches HTTP 200. Jetzt: `2xx` = Erfolg, `401`/`403` = Warnung mit Key-Hinweis, `407` = Fehler. Neuer Test `classifies_https_status_codes_consistently`.