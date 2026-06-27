# T-303: Tauri-Events definieren

## Kontext
Status: implemented
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
- [x] `transcript:connectivity-result` als separates Event — nach `test_azure_connectivity` emittiert (`events::emit_connectivity_result`); Renderer kann alternativ zum `invoke`-Return-Wert zuhören.
- [x] `transcript:fixed-config-status` beim App-Start emittiert (`lib.rs::setup` ruft `settings::get_azure_config_state` und `events::emit_fixed_config_status`); spiegelt `exists` + `path` der `azure.json`.

## Approach
- Alle Events tragen eine `timestampMs`-Feld (für Debug-Logging und UI-Sync).
- Rate-Limit für `transcript:debug` (max. 100 Events/s) verhindert UI-Flood.
- Spezielle Events (`sidecar:crashed`, `transcript:connectivity-result`) sind 1:1-Bridges ohne Sidecar-Vermittlung.

## Log
- 2026-06-25: Spec angelegt.