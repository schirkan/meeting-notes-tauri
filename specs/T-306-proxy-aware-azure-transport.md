# T-306: Proxy-aware Azure-Transport (C#-Variante)

## Kontext
Status: implemented
Priorität: high
Abhängigkeiten: T-204, T-205

## Goal
Für die C#-Azure-Speech-SDK validieren, ob `SpeechConfig.SetProxy()` auf der C#-Plattform zuverlässiger funktioniert als in der Node-Variante. Falls nicht: Workaround implementieren.

## Done When
- [x] Test in restriktiver Netzwerkumgebung (vgl. `../meeting-notes` Befund): funktioniert `SetProxy()` in C# nativ für den WSS-Connect? **Ja — am 2026-11-12 im Firmennetz bestätigt.**
- [x] `SetProxy()` ist im gemeinsamen `SpeechConfiguration`-Builder für Aufnahme und Diagnose konfiguriert (siehe [T-204](./T-204-azure-speech-sdk-integration-im-sidecar.md)); die erfolgreiche Verbindung im Firmenproxy ist am 2026-11-12 bestätigt.
- [x] Connectivity-Diagnose (T-304) funktioniert auch in restriktiven Umgebungen und zeigt Proxy-Pfad korrekt an — am 2026-11-12 im Firmennetz bestätigt.
- [x] Workaround-Entscheidung entfällt: Da `SetProxy()` nativ funktioniert, wird **keine** der Varianten 1–4 umgesetzt. Die Proxy-Kommunikation ist bereits durch den Diagnose-Dialog abgedeckt.

## Implementierter Stand (2026-11-09)
- [SpeechConfiguration](../sidecar/SpeechConfiguration.cs) wird für Aufnahme und native Diagnose verwendet und setzt Endpoint, Sprache, Continuous LID und `SpeechConfig.SetProxy(...)`.
- Rust übergibt Host/Port als nicht geheime CLI-Args; Speech-Key/Proxy-Authentifizierung über prozesslokale Umgebungsvariablen.
- HTTPS-Diagnose nutzt einen expliziten HTTP-CONNECT-Proxy mit optionaler Basic-Authentifizierung; ohne Proxy sind automatische Umgebungsproxies deaktiviert.
- Separate native Diagnose ohne Audio-Capture verlangt für **beide** Clients (`SpeechRecognizer`, `ConversationTranscriber`) `Connected` und `SessionStarted`. HTTPS-Erfolg bestätigt weder WSS noch Speech-Authentifizierung.
- **TLS:** HTTPS-Diagnose ignoriert Zertifikatsprüfungen immer (unsicher, einschließlich Risiko für den Speech-Key). Im nativen Windows-Speech-SDK 1.44 bleiben sie aktiv; kein offiziell unterstützter .NET-Bypass wurde gefunden. Unternehmens-Root-CA/Allowlisting bleiben bei TLS-Inspection gegebenenfalls erforderlich.
- Lokal verifiziert: Payload-Weitergabe, Validierung/Redaktion, UI-Fehlerdetails und kontrollierter nativer Verbindungsfehler. **Im Firmennetz verifiziert (2026-11-12):** erfolgreiche Verbindung zu Azure über den konfigurierten HTTP-CONNECT-Proxy, HTTPS **und** native Speech/WSS-Sitzungen erfolgreich. Der aus `../meeting-notes` übernommene Proxy-Befund tritt im C#-Pfad damit nicht auf.

## Approach / Validierung
- [T-304](./T-304-connectivity-diagnose-in-rust.md) liefert die getrennten Transportergebnisse; im Firmennetz am 2026-11-12 erfolgreich geprüft.
- Der Netztest ist abgeschlossen. Ein zusätzlicher Workaround ist weder implementiert noch erforderlich; Eigenbau-WSS bleibt eine verworfene Alternative.
- Diarization und Continuous LID müssen bei einem eigenen WSS-Client separat evaluiert werden (ggf. eingeschränkt).

## Log
- 2026-06-25: Spec angelegt (Migration aus `../meeting-notes/specs/T-505-proxy-aware-azure-transport.md`).
- 2026-06-27: Anbieter-Alternativen geprüft (`gpt-4o-transcribe-diarize`, `gpt-realtime-whisper`) und verworfen — Continuous LID fehlt in beiden, Live-Diarization-Hybrid wäre doppelte Audio-Pipeline, Proxy-Problem bleibt. Azure bleibt Provider. Diese Spec bleibt damit relevant. Siehe [DECISIONS.md](../DECISIONS.md), AD-011.
- 2026-11-09: Implementierte Proxy-Konfiguration und getrennte Diagnosen dokumentiert; Corporate-Netztest bleibt offen.
- 2026-11-12: **Proxy-Test im Firmennetz erfolgreich.** `SetProxy()` funktioniert nativ für den WSS-Connect; HTTPS und beide nativen Speech-Sitzungen erreichen Azure. Kein Workaround erforderlich, Status auf `implemented`.