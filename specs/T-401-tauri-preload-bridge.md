# T-401: Tauri-Preload-Bridge (typed invoke + listen)

## Kontext
Status: implemented
Priorität: high
Abhängigkeiten: T-102, T-302, T-303

## Goal
Typisierte Bridge zwischen React-Renderer und Tauri-Rust-Main, die Electron-IPC-Komfort nachbildet.

## Done When
- [x] Modul `src/preload/index.ts` exportiert typisierte Wrapper-Funktionen für jeden Tauri-Command (siehe T-302) als `TranscriptApi`-Objekt.
- [x] Modul exportiert typisierte Wrapper für jedes Tauri-Event-Abonnement (`onSegment`, `onError`, `onStatus`, `onDebugLog`); `onCrashed` ist als `transcriptSidecar.onCrashed` exponiert.
- [x] Renderer-Komponenten verwenden ausschließlich die Wrapper (`useAppState` ruft `api.start()`, `api.onSegment(...)` etc. auf — kein direkter `invoke()`).
- [x] TypeScript-Strict-Mode ist aktiv (`tsc --noEmit` läuft im `npm run build`-Skript), alle Wrapper sind vollständig typisiert.
- [x] Single-source-of-truth: Command- und Event-Namen werden über `src/shared/tauri-contract.ts` geteilt; `transcript-contract.ts` definiert die Datentypen.
- [ ] Mock-Implementierung für Unit-Tests (siehe T-500) — **offen**.

## Approach
- Tauri-2-API: `@tauri-apps/api/core` für `invoke()`, `@tauri-apps/api/event` für `listen()`.
- Pattern:
  ```ts
  // src/preload/index.ts
  export const tauriAPI = {
    startRecording: () => invoke<void>('start_recording'),
    onTranscriptSegment: (handler: (s: TranscriptSegment) => void) =>
      listen<TranscriptSegment>('transcript:segment', (e) => handler(e.payload)),
    // ...
  };
  ```
- Tests: Mock-Implementierung in `src/preload/__mocks__/` (siehe `T-500`).

## Log
- 2026-06-25: Spec angelegt.