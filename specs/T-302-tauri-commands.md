# T-302: Tauri-Commands definieren

## Kontext
Status: umgesetzt
Priorität: high
Abhängigkeiten: T-102, T-301

## Goal
Vollständige Tauri-Command-API definieren, die der React-Renderer aufrufen kann.

## Done When
- [x] Commands sind in Rust mit `#[tauri::command]` deklariert: Beleg: src-tauri/src/commands.rs (alle Commands mit #[tauri::command]) und src-tauri/src/lib.rs (Registrierung).
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
  - `toggle_devtools(window: WebviewWindow)` fuer F12 und den Menuepunkt **Dev-Tools (F12)**, auch im Release-/Portable-Build (Window wird von Tauri injiziert; Renderer-Aufruf ohne Argumente).
  - `open_repository(app: AppHandle) -> Result<(), String>` oeffnet ausschliesslich `https://github.com/schirkan/meeting-notes-tauri` im Systembrowser; kein URL-Argument aus dem Renderer. Neue native Abnahme siehe [T-402](./T-402-ui-komponenten-portieren.md).
- [x] `AppConfigState` enthält `exists`, `path` und optional `config`; `get_app_config` und `save_fixed_config` liefern den tatsächlichen Backend-Dateipfad. Beleg: src/preload/index.ts (AppConfigState), scripts/clean-sidecar.mjs (exists), scripts/dist-portable.mjs (config) (geprueft).
- [x] `ConnectivityResult` unterscheidet `httpsReachable` und `speechReachable`; `reachable` verlangt beide. Rückgabe und zusätzliches `transcript:connectivity-result`-Event enthalten alle Schritte erst nach Abschluss. Beleg: sidecar/SpeechConnectivityDiagnostic.cs (ConnectivityResult), src/preload/index.ts (httpsReachable), src/preload/index.ts (speechReachable) (geprueft).
- [x] **Kein** `copy_transcript`-Command mehr — Clipboard-Copy lebt im Preload via `navigator.clipboard.writeText` (siehe `DECISIONS.md → AD-010`). Beleg: src/preload/index.ts (navigator.clipboard.writeText) (geprueft).
- [x] Alle Commands sind in einer zentralen `commands.rs` registriert. Beleg: src-tauri/src/commands.rs (geprueft).
- [x] Preload-Bridge im Renderer hat typisierte Wrapper-Funktionen für jeden Command (`src/preload/index.ts`, `TranscriptApi` in `src/shared/transcript-contract.ts`). Beleg: src/preload/index.ts, scripts/test-smoke.mjs (TranscriptApi), src/shared/transcript-contract.ts (geprueft).

## Approach
- Granularität: ein Command pro Use-Case (kein „do-everything"-Command).
- Fehler als `Result<T, String>` mit klarer User-Fehlermeldung (kein leerer String). Der Diagnose-Dialog erhält auch Details von String-/JSON-Objekt-Rejections, statt sie durch eine generische Fehlermeldung zu ersetzen.
- Commands delegieren an den Sidecar über stdin/stdout (keine Named Pipe) oder an lokale Settings-/HTTPS-Logik.

## Log
- 2026-06-25: Spec angelegt.