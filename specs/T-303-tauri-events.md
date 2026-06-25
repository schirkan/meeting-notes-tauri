# T-303: Tauri-Events definieren

## Kontext
Status: draft
Priorität: high
Abhängigkeiten: T-102

## Goal
Vollständige Tauri-Event-API definieren, mit der der Rust-Main den React-Renderer benachrichtigt.

## Done When
- [ ] Events werden mit `app.emit_all("event-name", payload)` emittiert:
  - `transcript:segment` → `{ kind: 'partial' | 'final', text, speakerId?, detectedLanguage?, source, startedAtMs }`
  - `transcript:status` → `{ phase: 'started' | 'stopped' | 'error', message? }`
  - `transcript:error` → `{ code, message, recoverable }`
  - `transcript:debug` → `{ level, message, source }`
  - `transcript:connectivity-result` → Result-Karte aus T-304
  - `transcript:fixed-config-status` → Status-Anzeige für Azure-Config
  - `sidecar:crashed` → `{ exitCode, lastError }`
- [ ] Renderer abonniert Events via typisiertem `listen<EventName>(handler)`.
- [ ] Event-Names sind als String-Union typisiert und werden zwischen Rust und TS geteilt (über `transcript-contract.ts`).

## Approach
- Alle Events tragen eine `timestampMs`-Feld (für Debug-Logging und UI-Sync).
- Rate-Limit für `transcript:debug` (max. 100 Events/s) verhindert UI-Flood.
- Spezielle Events (`sidecar:crashed`, `transcript:connectivity-result`) sind 1:1-Bridges ohne Sidecar-Vermittlung.

## Log
- 2026-06-25: Spec angelegt.