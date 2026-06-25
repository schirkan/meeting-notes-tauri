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
- [ ] Bei Bestätigung des C#-Pfads: `SetProxy()` wird ohne weiteren Workaround konfiguriert.
- [ ] Bei Nicht-Funktion: Entscheidung und Implementierung gemäß T-306.

## Approach (zur Auswahl)
- **Variante 1:** System-Proxy via `netsh winhttp set proxy` — Runbook-Hinweis.
- **Variante 2:** Env-Var-Konfiguration (`HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS`) im Sidecar-Prozess vor SDK-Init.
- **Variante 3:** Eigenbau eines WSS-Clients in C# mit `WebSocket4Net` + `HttpProxyClient` (oder direkt `System.Net.WebSockets` mit Proxy-Aware-Stream).
- **Variante 4:** App-Hinweis statt Workaround — Diagnose kommuniziert Proxy-Bedarf.

## Decision (offen)
Nutzerentscheidung zwischen den Varianten, abhängig vom Ergebnis der C#-Validierung in T-306.

## Log
- 2026-06-25: Spec angelegt (Migration aus `../meeting-notes/specs/T-505-proxy-aware-azure-transport.md`).