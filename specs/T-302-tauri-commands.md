# T-302: Tauri-Commands definieren

## Kontext
Status: implemented
Priorität: high
Abhängigkeiten: T-102, T-301

## Goal
Vollständige Tauri-Command-API definieren, die der React-Renderer aufrufen kann.

## Done When
- [x] Commands sind in Rust mit `#[tauri::command]` deklariert:
  - `start_recording() -> Result<TranscriptStatus, String>`
  - `stop_recording() -> Result<TranscriptStatus, String>`
  - `reset_transcript() -> Result<(), String>`
  - `get_status() -> Result<TranscriptStatus, String>`
  - `get_debug_log() -> Result<Vec<DebugLogEntry>, String>`
  - `clear_debug_log() -> Result<{ cleared: number }, String>`
  - `get_devices() -> Result<DeviceSnapshot, String>`
  - `get_user_settings() -> Result<UserSettings, String>`
  - `save_user_settings(settings: UserSettings) -> Result<UserSettings, String>`
  - `get_fixed_config() -> Result<AzureConfigState, String>`
  - `save_fixed_config(config: AzureConfig) -> Result<AzureConfigState, String>`
  - `test_azure_connectivity(payload: Option<Value>) -> Result<ConnectivityResult, String>` (siehe T-304)
- [x] **Kein** `copy_transcript`-Command mehr — Clipboard-Copy lebt im Preload via `navigator.clipboard.writeText` (siehe `DECISIONS.md → AD-010`).
- [x] Alle Commands sind in einer zentralen `commands.rs` registriert.
- [x] Preload-Bridge im Renderer hat typisierte Wrapper-Funktionen für jeden Command (`src/preload/index.ts`, `TranscriptApi` in `src/shared/transcript-contract.ts`).

## Approach
- Granularität: ein Command pro Use-Case (kein „do-everything"-Command).
- Fehler als `Result<T, String>` mit klarer User-Fehlermeldung (kein leerer String).
- Commands delegieren an den Sidecar via Pipe (sofern sidecar-spezifisch) oder an lokale Settings-Logik.

## Log
- 2026-06-25: Spec angelegt.