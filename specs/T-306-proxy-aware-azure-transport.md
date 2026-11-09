# T-306: Proxy-aware Azure-Transport (C#-Variante)

## Kontext
Status: partial
Priorität: high
Abhängigkeiten: T-204, T-205

## Goal
Für die C#-Azure-Speech-SDK validieren, ob `SpeechConfig.SetProxy()` auf der C#-Plattform zuverlässiger funktioniert als in der Node-Variante. Falls nicht: Workaround implementieren.

## Done When
- [ ] Test in restriktiver Netzwerkumgebung (vgl. `../meeting-notes` Befund): funktioniert `SetProxy()` in C# nativ für den WSS-Connect?
- [x] `SetProxy()` ist im gemeinsamen `SpeechConfiguration`-Builder für Aufnahme und Diagnose konfiguriert (siehe [T-204](./T-204-azure-speech-sdk-integration-im-sidecar.md)); erfolgreiche Verbindung im Firmenproxy bleibt unbestätigt.
- [ ] Wenn nein: Entscheidung zwischen Workaround-Varianten (siehe `../meeting-notes/specs/T-505-proxy-aware-azure-transport.md`):
  - Variante 1: System-Proxy via `netsh` (außerhalb der App) — Runbook-Hinweis.
  - Variante 2: Native Proxy-/Trust-Konfiguration evaluieren. `HTTPS_PROXY` ist für diesen SDK-Pfad nicht bestätigt; `NODE_EXTRA_CA_CERTS` gilt nur für Node, nicht für das native Windows-C#-SDK.
  - Variante 3: Eigenbau eines WSS-Clients in C# (mit `WebSocket4Net` + `HttpProxyClient`).
  - Variante 4: App-Hinweis statt Workaround (Diagnose kommuniziert Proxy-Bedarf).
- [ ] Connectivity-Diagnose (T-304) funktioniert auch in restriktiven Umgebungen und zeigt Proxy-Pfad korrekt an.

## Implementierter Stand (2026-11-09)
- [SpeechConfiguration](../sidecar/SpeechConfiguration.cs) wird für Aufnahme und native Diagnose verwendet und setzt Endpoint, Sprache, Continuous LID und `SpeechConfig.SetProxy(...)`.
- Rust übergibt Host/Port als nicht geheime CLI-Args; Speech-Key/Proxy-Authentifizierung über prozesslokale Umgebungsvariablen.
- HTTPS-Diagnose nutzt einen expliziten HTTP-CONNECT-Proxy mit optionaler Basic-Authentifizierung; ohne Proxy sind automatische Umgebungsproxies deaktiviert.
- Separate native Diagnose ohne Audio-Capture verlangt für **beide** Clients (`SpeechRecognizer`, `ConversationTranscriber`) `Connected` und `SessionStarted`. HTTPS-Erfolg bestätigt weder WSS noch Speech-Authentifizierung.
- **TLS:** HTTPS-Diagnose ignoriert Zertifikatsprüfungen immer (unsicher, einschließlich Risiko für den Speech-Key). Im nativen Windows-Speech-SDK 1.44 bleiben sie aktiv; kein offiziell unterstützter .NET-Bypass wurde gefunden. Unternehmens-Root-CA/Allowlisting bleiben bei TLS-Inspection gegebenenfalls erforderlich.
- Lokal verifiziert: Payload-Weitergabe, Validierung/Redaktion, UI-Fehlerdetails und kontrollierter nativer Verbindungsfehler. **Nicht verifiziert:** erfolgreiche Verbindung im tatsächlichen Firmenproxy zu Azure.

## Approach / offene Validierung
- [T-304](./T-304-connectivity-diagnose-in-rust.md) liefert die getrennten Transportergebnisse für den realen Netztest in [T-505](./T-505-proxy-aware-azure-transport.md).
- Erst bei nachgewiesenem nativen Proxy-Problem über zusätzlichen Workaround entscheiden. Eigenbau-WSS ist nicht implementiert oder als zuverlässig validiert.
- Diarization und Continuous LID müssen bei einem eigenen WSS-Client separat evaluiert werden (ggf. eingeschränkt).

## Log
- 2026-06-25: Spec angelegt (Migration aus `../meeting-notes/specs/T-505-proxy-aware-azure-transport.md`).
- 2026-06-27: Anbieter-Alternativen geprüft (`gpt-4o-transcribe-diarize`, `gpt-realtime-whisper`) und verworfen — Continuous LID fehlt in beiden, Live-Diarization-Hybrid wäre doppelte Audio-Pipeline, Proxy-Problem bleibt. Azure bleibt Provider. Diese Spec bleibt damit relevant. Siehe [DECISIONS.md](../DECISIONS.md), AD-011.
- 2026-11-09: Implementierte Proxy-Konfiguration und getrennte Diagnosen dokumentiert; Corporate-Netztest bleibt offen.