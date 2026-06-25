# T-102: IPC-Vertrag zwischen Renderer und Rust-Main festziehen

## Kontext
Status: draft
Priorität: high
Abhängigkeiten: T-101
Subtasks: T-302, T-303

## Goal
Typsicheren IPC-Vertrag zwischen React-Renderer und Rust-Main definieren, versionieren und in beiden Schichten mit geteilten TypeScript-Typen implementieren.

## Done When
- [ ] Modul `src/shared/transcript-contract.ts` (portiert aus `../meeting-notes/src/shared/transcript-contract.ts`) liegt vor und exportiert alle Event-/Command-Typen.
- [ ] Tauri-Commands sind in Rust typisiert deklariert (`#[tauri::command]` mit `serde::Deserialize`/`Serialize`).
- [ ] Modul `src/preload/index.ts` (oder gleichwertig) kapselt `invoke()`-Aufrufe in typisierte Funktionen (`startRecording()`, `stopRecording()`, `saveSettings()`, `testAzureConnectivity()` etc.).
- [ ] Tauri-Event-Names sind als String-Union typisiert.
- [ ] Contract-Version wird im ersten **stdin/stdout-Handshake** des Sidecars mit Rust-Main abgeglichen (siehe `T-201` und `DECISIONS.md → AD-008`).
- [ ] `npm run typecheck` ist grün.

## Approach
- Electron-Preload-Pattern durch Tauri-Preload-äquivalentes Pattern ersetzen: Renderer spricht niemals direkt mit `window.__TAURI__`, sondern ausschließlich über typisierte Wrapper-Funktionen.
- Tauri-Commands so granular wie möglich halten (eine Funktion pro Use-Case).
- Tauri-Events als Broadcast-Modell: Rust emittiert einheitlich `transcript:segment`, `transcript:status`, `transcript:error`, `transcript:debug`.

## Log
- 2026-06-25: Spec angelegt.