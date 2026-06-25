# T-104: Migrationsplan — welcher Code wandert wohin

## Kontext
Status: draft
Priorität: high
Abhängigkeiten: -

## Goal
Vollständige Inventur: Welche Module aus `../meeting-notes` werden **portiert**, welche **umgeschrieben**, welche **entfernt**.

## Done When
- [ ] Mapping-Tabelle pro Modul mit Spalten `Quelle` / `Zielpfad (Tauri)` / `Aktion` (1:1 / Refactor / Neu / Entfällt) liegt vor.
- [ ] Sidecar-Code wird zu 100 % übernommen (siehe `T-200`).
- [ ] React-Komponenten werden zu 100 % portiert (siehe `T-400`).
- [ ] Tauri-spezifische Neuerungen sind identifiziert (`connectivity.rs`, `tauri.conf.json`, `src-tauri/Cargo.toml`).
- [ ] Entfallene Module sind begründet (z. B. Node-`azure-transcription-service.ts` entfällt komplett).

## Approach — Mapping-Skizze

| Quelle (`../meeting-notes/`) | Ziel (`meeting-notes-tauri/`) | Aktion |
|---|---|---|
| `src/main/index.ts` | `src-tauri/src/main.rs` | **Refactor:** Electron-Main → Tauri-Main |
| `src/main/sidecar-manager.ts` | `src-tauri/src/sidecar.rs` | **Refactor:** `child_process.spawn` → `tauri-plugin-shell` |
| `src/main/azure-transcription-service.ts` | `sidecar/MeetingNotes.Sidecar/AzureSpeechService.cs` | **Verschoben:** C# statt TypeScript |
| `src/main/frame-protocol.ts` | `sidecar/MeetingNotes.Sidecar/PipeProtocol.cs` | **Neu:** JSON-Lines statt Binär-Frames |
| `src/main/azure-connectivity.ts` | `src-tauri/src/connectivity.rs` | **Refactor:** Node → Rust |
| `src/main/settings-store.ts` | `src-tauri/src/settings.rs` | **Refactor:** Node → Rust |
| `src/preload/index.ts` | `src/preload/index.ts` | **Refactor:** Electron-IPC → Tauri-IPC |
| `src/renderer/**` | `src/renderer/**` | **1:1 Port** |
| `src/shared/**` | `src/shared/**` | **1:1 Port** |
| `sidecar/MeetingNotes.Sidecar/**` | `sidecar/MeetingNotes.Sidecar/**` | **1:1 Port + NuGet `Microsoft.CognitiveServices.Speech` ergänzen** |
| `electron.vite.config.ts` | — | **Entfällt** |
| `scripts/pack-portable.mjs` | `tauri.conf.json → bundle.resources` | **Entfällt, ersetzt durch Tauri-Bundle** |

## Log
- 2026-06-25: Spec angelegt.