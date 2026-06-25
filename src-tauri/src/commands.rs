//! Tauri commands invoked from the renderer via the preload bridge.
//!
//! Naming and event payloads are kept in sync via
//! `src/shared/tauri-contract.ts` — single source of truth.
//!
//! Block 2 scope: stubs that exercise the AppState (debug log, status
//! transitions). Block 4 wires these to real sidecar + settings +
//! connectivity logic.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::events;
use crate::state::{
    AppState, DebugLogEntry, DebugLogEntryLevel, DebugLogEntrySource,
};

// ---------- Re-exports for type compatibility with the renderer ----------

pub use crate::state::{DebugLogEntryLevel as Level, DebugLogEntrySource as Source};

// ---------- Stub types for not-yet-implemented commands ----------
// (Replaced with real types in Block 4 once settings, devices,
// connectivity, clipboard are implemented.)

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StubDeviceInfo {
    pub id: String,
    pub name: String,
    pub flow: String,
    pub is_default: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StubDeviceSnapshot {
    pub inputs: Vec<StubDeviceInfo>,
    pub outputs: Vec<StubDeviceInfo>,
    pub fetched_at_iso: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StubUserSettings {
    pub language: String,
    pub devices: StubDeviceDevices,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StubDeviceDevices {
    pub mic_id: Option<String>,
    pub speaker_loopback_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StubAzureConfig {
    pub endpoint: String,
    pub region: String,
    pub speech_key: String,
    pub interim_results: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StubAzureConfigState {
    pub exists: bool,
    pub path: String,
    pub config: Option<StubAzureConfig>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StubConnectivityResult {
    pub probe_url: String,
    pub reachable: bool,
    pub latency_ms: u64,
    pub steps: Vec<StubConnectivityStep>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StubConnectivityStep {
    pub step: String,
    pub status: String,
    pub detail: String,
}

// ---------- Helpers ----------

fn default_stub_user_settings() -> StubUserSettings {
    StubUserSettings {
        language: "de-DE".into(),
        devices: StubDeviceDevices {
            mic_id: None,
            speaker_loopback_id: None,
        },
    }
}

fn default_stub_devices() -> StubDeviceSnapshot {
    StubDeviceSnapshot {
        inputs: vec![],
        outputs: vec![],
        fetched_at_iso: chrono::Utc::now().to_rfc3339(),
    }
}

fn default_stub_config_state() -> StubAzureConfigState {
    StubAzureConfigState {
        exists: false,
        path: String::new(),
        config: None,
    }
}

fn push_and_emit_debug(
    app: &AppHandle,
    state: &AppState,
    source: DebugLogEntrySource,
    level: DebugLogEntryLevel,
    message: impl Into<String>,
) -> DebugLogEntry {
    let entry = state.push_debug(source, level, message);
    events::emit_debug(app, &entry);
    entry
}

// ---------- Tauri commands ----------

#[tauri::command]
pub async fn start_recording(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<events::TranscriptStatus, String> {
    push_and_emit_debug(&app, &state, DebugLogEntrySource::Ipc, DebugLogEntryLevel::Info, "start_recording aufgerufen.");
    let status = state.mark_started();
    push_and_emit_debug(&app, &state, DebugLogEntrySource::Status, DebugLogEntryLevel::Info, "Status geändert: running.");
    events::emit_status(&app, &status);
    Ok(status)
}

#[tauri::command]
pub async fn stop_recording(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<events::TranscriptStatus, String> {
    push_and_emit_debug(&app, &state, DebugLogEntrySource::Ipc, DebugLogEntryLevel::Info, "stop_recording aufgerufen.");
    let status = state.mark_stopped();
    push_and_emit_debug(&app, &state, DebugLogEntrySource::Status, DebugLogEntryLevel::Info, "Status geändert: stopped.");
    events::emit_status(&app, &status);
    Ok(status)
}

#[tauri::command]
pub async fn reset_transcript(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    push_and_emit_debug(&app, &state, DebugLogEntrySource::Ipc, DebugLogEntryLevel::Info, "reset_transcript aufgerufen.");
    Ok(())
}

#[tauri::command]
pub async fn get_status(state: State<'_, AppState>) -> Result<events::TranscriptStatus, String> {
    Ok(state.snapshot_status())
}

#[tauri::command]
pub async fn get_debug_log(state: State<'_, AppState>) -> Result<Vec<DebugLogEntry>, String> {
    Ok(state.debug_log())
}

#[tauri::command]
pub async fn clear_debug_log(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let cleared = state.clear_debug_log();
    push_and_emit_debug(&app, &state, DebugLogEntrySource::Main, DebugLogEntryLevel::Info, format!("Debug-Log gelöscht ({cleared} Einträge)."));
    Ok(serde_json::json!({ "cleared": cleared }))
}

#[tauri::command]
pub async fn get_devices() -> Result<StubDeviceSnapshot, String> {
    Ok(default_stub_devices())
}

#[tauri::command]
pub async fn get_user_settings() -> Result<StubUserSettings, String> {
    Ok(default_stub_user_settings())
}

#[tauri::command]
pub async fn save_user_settings(
    settings: StubUserSettings,
) -> Result<StubUserSettings, String> {
    Ok(settings)
}

#[tauri::command]
pub async fn get_fixed_config() -> Result<StubAzureConfigState, String> {
    Ok(default_stub_config_state())
}

#[tauri::command]
pub async fn save_fixed_config(
    config: StubAzureConfig,
) -> Result<StubAzureConfigState, String> {
    Ok(StubAzureConfigState {
        exists: true,
        path: String::new(),
        config: Some(config),
    })
}

#[tauri::command]
pub async fn test_azure_connectivity(
    _payload: Option<serde_json::Value>,
) -> Result<StubConnectivityResult, String> {
    Err("test_azure_connectivity noch nicht implementiert (Block 4)".into())
}

#[tauri::command]
pub async fn copy_transcript(
    _segments: Vec<serde_json::Value>,
) -> Result<(), String> {
    Err("copy_transcript noch nicht implementiert (Block 5 + Clipboard-Plugin)".into())
}
