# T-102: IPC-Vertrag zwischen Renderer und Rust-Main festziehen

## Kontext
Status: umgesetzt
Priorität: high
Abhängigkeiten: T-101
Subtasks: T-302, T-303

## Goal
Typsicheren IPC-Vertrag zwischen React-Renderer und Rust-Main definieren, versionieren und in beiden Schichten mit geteilten TypeScript-Typen implementieren.

## Done When
- [x] Modul `src/shared/transcript-contract.ts` (portiert aus `../meeting-notes/src/shared/transcript-contract.ts`) liegt vor und exportiert alle Event-/Command-Typen. Beleg: src/shared/transcript-contract.ts.
- [x] Tauri-Commands sind in Rust typisiert deklariert (`#[tauri::command]` mit `serde::Deserialize`/`Serialize`). Beleg: src-tauri/src/commands.rs.
- [x] Modul `src/preload/index.ts` (oder gleichwertig) kapselt `invoke()`-Aufrufe in typisierte Funktionen (`startRecording()`, `stopRecording()`, `saveSettings()`, `testAzureConnectivity()` etc.). Beleg: src/preload/index.ts mit typisierten invoke-Wrappern.
- [x] Tauri-Event-Names sind als String-Union typisiert. Beleg: src/shared/tauri-contract.ts (TAURI_EVENTS).
- [x] Contract-Version wird im ersten **stdin/stdout-Handshake** des Sidecars mit Rust-Main abgeglichen (siehe `T-201` und `DECISIONS.md → AD-008`). Beleg: umgesetzt - der Sidecar sendet `handshake` mit `protocol_version`, `sidecar_version` und `capabilities`; der Rust-Main prüft die Version (`protocol.rs`, `version_at_least`), quittiert mit `handshake-ack` und beendet den Sidecar bei Inkompatibilität oder ausbleibendem Handshake (5 s).
- [x] `npm run typecheck` ist grün. Beleg: npm run typecheck laeuft gruen.

## Approach
- Electron-Preload-Pattern durch Tauri-Preload-äquivalentes Pattern ersetzen: Renderer spricht niemals direkt mit `window.__TAURI__`, sondern ausschließlich über typisierte Wrapper-Funktionen.
- Tauri-Commands so granular wie möglich halten (eine Funktion pro Use-Case).
- Tauri-Events als Broadcast-Modell: Rust emittiert einheitlich `transcript:segment`, `transcript:status`, `transcript:error`, `transcript:debug`.

## Log
- 2026-06-25: Spec angelegt.