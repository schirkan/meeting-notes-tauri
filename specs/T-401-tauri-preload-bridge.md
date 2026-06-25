# T-401: Tauri-Preload-Bridge (typed invoke + listen)

## Kontext
Status: draft
Priorität: high
Abhängigkeiten: T-102, T-302, T-303

## Goal
Typisierte Bridge zwischen React-Renderer und Tauri-Rust-Main, die Electron-IPC-Komfort nachbildet.

## Done When
- [ ] Modul `src/preload/index.ts` exportiert typisierte Wrapper-Funktionen für jeden Tauri-Command (siehe T-302).
- [ ] Modul exportiert typisierte Wrapper für jedes Tauri-Event-Abonnement (siehe T-303).
- [ ] Renderer-Komponenten verwenden ausschließlich die Wrapper, niemals `window.__TAURI__` direkt.
- [ ] TypeScript-Strict-Mode ist aktiv, alle Wrapper sind vollständig typisiert.
- [ ] Mock-Implementierung für Tests ist vorhanden (für zukünftige Unit-Tests, optional).

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