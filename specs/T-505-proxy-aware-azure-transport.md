# T-505: Proxy-aware Azure-Transport (C#-Variante)

## Kontext
Status: draft
Priorität: high
Abhängigkeiten: T-306, T-303

## Goal
Für die Tauri-Variante klären, ob das Proxy-Problem aus `../meeting-notes` auch in der C#-Variante auftritt, und gegebenenfalls einen Workaround implementieren.

## Symptom (aus `../meeting-notes` übernommen)
- App startet, Audio-Frames erreichen die Azure-PushStream, aber keine Transcripts zurück.
- Diagnose-Button zeigt `TCP 443 EACCES` auf die aufgelöste Azure-IP.
- Auf einem anderen System ohne Proxy funktioniert die identische Konfiguration.

## Root Cause (aus `../meeting-notes`)
Die native Azure-Speech-SDK nutzt die per `setProxy()` gesetzten Proxy-Properties nicht zuverlässig für den ausgehenden WSS-Connect. In Node 1.44.x bestätigt; in C# zu validieren (siehe T-306).

## Done When
- [ ] Validierung in C# abgeschlossen: funktioniert `SpeechConfig.SetProxy()` in C# nativ für WSS-Connect?
- [x] `SetProxy()` ist bereits im gemeinsamen Builder für Aufnahme und Diagnose konfiguriert; die positive Validierung im Zielnetz bleibt offen.
- [ ] Bei Nicht-Funktion: Entscheidung und Implementierung gemäß T-306.

## Aktueller Prüfpfad (2026-11-09)
- Einstellungen enthalten einen eigenen Proxy-Bereich; **Verbindung testen** liegt im Azure-Bereich und testet auch ungespeicherte Werte.
- [T-304](./T-304-connectivity-diagnose-in-rust.md) prüft parallel HTTPS über expliziten HTTP-CONNECT-Proxy und native Speech/WSS-Verbindungen für beide Recognizer. Der separate Dialog zeigt alle Ergebnisse und Fehlerdetails nach Abschluss.
- HTTP 401/403 ist HTTPS-Erreichbarkeit, keine erfolgreiche Speech-Authentifizierung. Gesamterfolg verlangt HTTPS **und** beide nativen Speech-Sitzungen.
- HTTPS ignoriert Zertifikate bewusst nur in der Diagnose; native Windows-Speech-Zertifikatsprüfungen bleiben aktiv. Zertifikats-/Authentifizierungs-/Allowlisting-Fehler im Zielnetz getrennt auswerten.
- Lokaler nativer Negativtest bestätigt Diagnose und Fehleranzeige. Er beweist weder erfolgreichen CONNECT im Firmenproxy noch das aus Node übernommene Proxy-Problem im C#-Pfad.

## Approach (zur Auswahl, noch nicht umgesetzt)
- **Variante 1:** System-Proxy via `netsh winhttp set proxy` — Runbook-Hinweis.
- **Variante 2:** Native Proxy-/Trust-Konfiguration evaluieren. `HTTPS_PROXY` ist für diesen SDK-Pfad unbestätigt; `NODE_EXTRA_CA_CERTS` ist Node-spezifisch und keine .NET-/Windows-Zertifikatsumgehung.
- **Variante 3:** Eigenbau eines WSS-Clients in C# mit `WebSocket4Net` + `HttpProxyClient` (oder direkt `System.Net.WebSockets` mit Proxy-Aware-Stream).
- **Variante 4:** App-Hinweis statt Workaround — Diagnose kommuniziert Proxy-Bedarf.

## Decision (offen)
Nutzerentscheidung zwischen den Varianten, abhängig vom Ergebnis der C#-Validierung in T-306.

## Log
- 2026-06-25: Spec angelegt (Migration aus `../meeting-notes/specs/T-505-proxy-aware-azure-transport.md`).
- 2026-06-27: Anbieter-Alternativen geprüft (`gpt-4o-transcribe-diarize`, `gpt-realtime-whisper`) und verworfen — Continuous LID fehlt in beiden, Live-Diarization-Hybrid wäre doppelte Audio-Pipeline, Proxy-Problem bleibt. Azure bleibt Provider. Diese Spec bleibt damit relevant; Eigenbau-WSS bleibt eine zu evaluierende Alternative. Siehe [DECISIONS.md](../DECISIONS.md), AD-011.
- 2026-11-09: Getrennten HTTPS-/Speech-Prüfpfad, TLS-Grenzen und lokalen Verifikationsstand ergänzt. Entscheidung über Workaround bleibt abhängig vom echten Corporate-Netztest.