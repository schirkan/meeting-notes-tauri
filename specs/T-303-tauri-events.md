# T-303: Tauri-Events definieren

## Kontext
Status: partial
Priorität: high
Abhängigkeiten: T-102

## Goal
Vollständige Tauri-Event-API definieren, mit der der Rust-Main den React-Renderer benachrichtigt.

## Done When
- [x] Events werden emittiert (in `src-tauri/src/events.rs` + `commands.rs::spawn_event_forwarder`):
  - `transcript:segment` → Sidecar-Roh-Payload wird weitergereicht (Renderer normalisiert auf `TranscriptSegment`-Form aus `transcript-contract.ts`)
  - `transcript:status` → `{ running: bool, startedAt?: string }` (`events::TranscriptStatus`)
  - `transcript:error` → Sidecar-Roh-Payload
  - `transcript:debug` → `DebugLogEntry { id, timestampIso, source, level, message }` (`state::DebugLogEntry`)
  - `sidecar:crashed` → `{ exitCode, lastError? }` (`events::SidecarCrashedPayload`)
- [x] Renderer abonniert Events via typisiertem `listen<T>(event, cb)` im Preload (`subscribe<T>`-Helper in `src/preload/index.ts`).
- [x] Event-Names sind als String-Union typisiert und werden zwischen Rust und TS geteilt (über `src/shared/tauri-contract.ts`).
- [ ] `transcript:connectivity-result` als separates Event — **offen**: aktuell liefert `test_azure_connectivity` das Result als Return-Wert zurück; Renderer kann es direkt nach `invoke()` anzeigen. Spec lässt beide Wege offen.
- [ ] `transcript:fixed-config-status` mit `status=missing` beim App-Start — **offen** (siehe T-305): aktuell erkennt der Renderer eine fehlende `azure.json` über `get_fixed_config` (`exists: false`) und blendet den Hinweis im UI ein.

## Approach
- Alle Events tragen eine `timestampMs`-Feld (für Debug-Logging und UI-Sync).
- Rate-Limit für `transcript:debug` (max. 100 Events/s) verhindert UI-Flood.
- Spezielle Events (`sidecar:crashed`, `transcript:connectivity-result`) sind 1:1-Bridges ohne Sidecar-Vermittlung.

## Log
- 2026-06-25: Spec angelegt.