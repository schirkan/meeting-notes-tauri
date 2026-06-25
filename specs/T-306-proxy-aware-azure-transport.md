# T-306: Proxy-aware Azure-Transport (C#-Variante)

## Kontext
Status: draft
Priorität: high
Abhängigkeiten: T-204, T-205

## Goal
Für die C#-Azure-Speech-SDK validieren, ob `SpeechConfig.SetProxy()` auf der C#-Plattform zuverlässiger funktioniert als in der Node-Variante. Falls nicht: Workaround implementieren.

## Done When
- [ ] Test in restriktiver Netzwerkumgebung (vgl. `../meeting-notes` Befund): funktioniert `SetProxy()` in C# nativ für den WSS-Connect?
- [ ] Wenn ja: `SetProxy()` wird in `T-204` ohne weiteren Workaround konfiguriert.
- [ ] Wenn nein: Entscheidung zwischen Workaround-Varianten (siehe `../meeting-notes/specs/T-505-proxy-aware-azure-transport.md`):
  - Variante 1: System-Proxy via `netsh` (außerhalb der App) — Runbook-Hinweis.
  - Variante 2: Env-Var-Konfiguration (`HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS`) — Code-Änderung im Sidecar-Prozess.
  - Variante 3: Eigenbau eines WSS-Clients in C# (mit `WebSocket4Net` + `HttpProxyClient`).
  - Variante 4: App-Hinweis statt Workaround (Diagnose kommuniziert Proxy-Bedarf).
- [ ] Connectivity-Diagnose (T-304) funktioniert auch in restriktiven Umgebungen und zeigt Proxy-Pfad korrekt an.

## Approach
- Validierungs-Phase zuerst: kleines Test-Programm in C# mit `SpeechConfig.SetProxy(...)` → Azure-Endpoint in restriktiver Umgebung → Logs.
- Falls Workaround nötig: Variante 3 (Eigenbau in C#) ist die robuste Wahl, weil Martin C# beherrscht und das SDK-Limit damit umgangen wird.
- Diarization- und Continuous-LID-Features müssen bei Variante 3 evaluiert werden (ggf. eingeschränkt).

## Log
- 2026-06-25: Spec angelegt (Migration aus `../meeting-notes/specs/T-505-proxy-aware-azure-transport.md`).