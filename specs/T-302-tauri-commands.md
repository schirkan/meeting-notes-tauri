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
  - `get_app_config() -> Result<AppConfigState, String>`
  - `save_fixed_config(config: AzureConfig) -> Result<AppConfigState, String>`
  - `save_transcript_markdown(markdown: String) -> Result<String, String>` — schreibt das Markdown-Dokument in das konfigurierte Zielverzeichnis bzw. das Anwendungsverzeichnis und liefert den geschriebenen Pfad zurück
  - `test_azure_connectivity(payload: Option<Value>) -> Result<ConnectivityResult, String>` (siehe [T-304](./T-304-connectivity-diagnose-in-rust.md)); Payload: vollständige Azure-Konfiguration inklusive optionalem Proxy und Sitzungssprache, auch ungespeichert.
  - `toggle_devtools(window: WebviewWindow)` für F12, auch im Release-/Portable-Build (Window wird von Tauri injiziert; Renderer-Aufruf ohne Argumente).
- [x] `AppConfigState` enthält `exists`, `path` und optional `config`; `get_app_config` und `save_fixed_config` liefern den tatsächlichen Backend-Dateipfad.
- [x] `ConnectivityResult` unterscheidet `httpsReachable` und `speechReachable`; `reachable` verlangt beide. Rückgabe und zusätzliches `transcript:connectivity-result`-Event enthalten alle Schritte erst nach Abschluss.
- [x] **Kein** `copy_transcript`-Command mehr — Clipboard-Copy lebt im Preload via `navigator.clipboard.writeText` (siehe `DECISIONS.md → AD-010`).
- [x] Alle Commands sind in einer zentralen `commands.rs` registriert.
- [x] Preload-Bridge im Renderer hat typisierte Wrapper-Funktionen für jeden Command (`src/preload/index.ts`, `TranscriptApi` in `src/shared/transcript-contract.ts`).

## Approach
- Granularität: ein Command pro Use-Case (kein „do-everything"-Command).
- Fehler als `Result<T, String>` mit klarer User-Fehlermeldung (kein leerer String). Der Diagnose-Dialog erhält auch Details von String-/JSON-Objekt-Rejections, statt sie durch eine generische Fehlermeldung zu ersetzen.
- Commands delegieren an den Sidecar über stdin/stdout (keine Named Pipe) oder an lokale Settings-/HTTPS-Logik.

## Log
- 2026-06-25: Spec angelegt.