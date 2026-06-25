# T-302: Tauri-Commands definieren

## Kontext
Status: draft
Priorität: high
Abhängigkeiten: T-102, T-301

## Goal
Vollständige Tauri-Command-API definieren, die der React-Renderer aufrufen kann.

## Done When
- [ ] Commands sind in Rust mit `#[tauri::command]` deklariert:
  - `start_recording() -> Result<(), String>`
  - `stop_recording() -> Result<(), String>`
  - `reset_transcript() -> Result<(), String>`
  - `get_status() -> Result<AppStatus, String>`
  - `get_settings() -> Result<UserSettings, String>`
  - `save_settings(settings: UserSettings) -> Result<(), String>`
  - `get_fixed_config() -> Result<AzureConfig, String>`
  - `save_fixed_config(config: AzureConfig) -> Result<(), String>`
  - `test_azure_connectivity() -> Result<ConnectivityResult, String>` (siehe T-304)
  - `clear_debug_log() -> Result<(), String>`
- [ ] Alle Commands sind in einer zentralen `commands.rs` registriert.
- [ ] Preload-Bridge im Renderer hat typisierte Wrapper-Funktionen für jeden Command.

## Approach
- Granularität: ein Command pro Use-Case (kein „do-everything"-Command).
- Fehler als `Result<T, String>` mit klarer User-Fehlermeldung (kein leerer String).
- Commands delegieren an den Sidecar via Pipe (sofern sidecar-spezifisch) oder an lokale Settings-Logik.

## Log
- 2026-06-25: Spec angelegt.