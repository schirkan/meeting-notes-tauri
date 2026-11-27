# T-401: Tauri-Preload-Bridge (typed invoke + listen)

## Kontext
Status: umgesetzt
Priorität: high
Abhängigkeiten: T-102, T-302, T-303

## Goal
Typisierte Bridge zwischen React-Renderer und Tauri-Rust-Main, die Electron-IPC-Komfort nachbildet.

## Done When
- [x] Modul `src/preload/index.ts` exportiert typisierte Wrapper-Funktionen für jeden Tauri-Command (siehe T-302) als `TranscriptApi`-Objekt. Beleg: src/preload/index.ts, scripts/test-smoke.mjs (TranscriptApi) (geprueft).
- [x] Modul exportiert typisierte Wrapper für jedes Tauri-Event-Abonnement (`onSegment`, `onError`, `onStatus`, `onDebugLog`); `onCrashed` ist als `transcriptSidecar.onCrashed` exponiert. Beleg: src/preload/index.ts (onSegment), src/preload/index.ts (onError), src/preload/index.ts (onStatus) (geprueft).
- [x] Renderer-Komponenten verwenden ausschließlich die Wrapper (`useAppState` ruft `api.start()`, `api.onSegment(...)` etc. auf — kein direkter `invoke()`). Beleg: src/renderer/src/App.tsx (useAppState) (geprueft).
- [x] TypeScript-Strict-Mode ist aktiv (`tsc --noEmit` läuft im `npm run build`-Skript), alle Wrapper sind vollständig typisiert. Beleg: package.json (run) (geprueft).
- [x] Single-source-of-truth: Command- und Event-Namen werden über `src/shared/tauri-contract.ts` geteilt; `transcript-contract.ts` definiert die Datentypen. Beleg: src/shared/tauri-contract.ts, src/shared/transcript-contract.ts (geprueft).
- [x] About-Repository und DevTools-Toggle sind als `openRepository(): Promise<void>` und `toggleDevtools(): Promise<void>` typisiert; Komponenten importieren dafuer kein direktes `invoke`. Native Abnahme siehe [T-402](./T-402-ui-komponenten-portieren.md). Beleg: src/preload/index.ts, src/shared/transcript-contract.ts und use-app-state.ts; `npm run typecheck` erfolgreich.
- [x] Renderer-Browsertests verwenden eine gemockte Bridge, getrennt von nativer IPC-Abnahme. Beleg: [startup-ui.test.mjs](../tests/startup-ui.test.mjs) setzt `window.transcriptApi` vor dem Seitenstart mit `page.addInitScript`; ebenfalls gemockt in [capture-screenshots.mjs](../scripts/capture-screenshots.mjs).

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
- Tests: Mock-Injektion im Playwright-Test statt einer zweiten Preload-Implementierung.

## Log
- 2026-06-25: Spec angelegt.