//! Tauri commands invoked from the renderer via the preload bridge.
//!
//! Naming + event payloads are kept in sync via
//! `src/shared/tauri-contract.ts` (single source of truth).

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

use crate::connectivity;
use crate::events;
use crate::settings::{
    self, AzureConfig, AzureConfigState, UserSettings,
};
use crate::sidecar::{self, SidecarHandle, SidecarOptions};
use crate::state::{
    AppState, DebugLogEntry, DebugLogEntryLevel, DebugLogEntrySource,
};

#[allow(unused_imports)]
pub use crate::state::{DebugLogEntryLevel as Level, DebugLogEntrySource as Source};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub flow: String,
    pub is_default: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSnapshot {
    pub inputs: Vec<DeviceInfo>,
    pub outputs: Vec<DeviceInfo>,
    pub fetched_at_iso: String,
}

fn empty_device_snapshot() -> DeviceSnapshot {
    DeviceSnapshot {
        inputs: vec![],
        outputs: vec![],
        fetched_at_iso: chrono::Utc::now().to_rfc3339(),
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

// ---------- start / stop recording ----------

#[tauri::command]
pub async fn start_recording(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<events::TranscriptStatus, String> {
    push_and_emit_debug(&app, &state, DebugLogEntrySource::Ipc, DebugLogEntryLevel::Info, "start_recording aufgerufen.");

    let azure = settings::load_azure_config(&app).await.map_err(|e| e.to_string())?;
    let user = settings::load_user_settings(&app).await.map_err(|e| e.to_string())?;

    let speech_key = azure.as_ref().map(|a| a.speech_key.clone());
    let speech_region = azure.as_ref().map(|a| a.region.clone());
    let speech_endpoint = azure.as_ref().map(|a| a.endpoint.clone());

    let options = SidecarOptions {
        sample_rate: 16_000,
        language: Some(user.language.clone()),
        speech_key,
        speech_region,
        speech_endpoint,
        mic_device_id: user.devices.mic_id.clone(),
        speaker_device_id: user.devices.speaker_loopback_id.clone(),
    };

    let handle = sidecar::start(&app, options).await.map_err(|e| e.to_string())?;
    spawn_event_forwarder(app.clone(), handle.events_rx);

    // Cache the live handle so stop_recording can reach it.
    let cache = app.state::<Arc<Mutex<Option<SidecarHandle>>>>();
    {
        let mut guard = cache.lock().await;
        // Replace any stale handle (e.g. after a previous crash).
        // The CommandChild is wrapped in Arc<Mutex<Option<...>>> so the
        // orchestrator can keep writing via the original handle while
        // the cache owns another reference for stop_recording().
        *guard = Some(SidecarHandle {
            child: Arc::clone(&handle.child),
            events_rx: tokio::sync::mpsc::channel(1).1,
        });
    }

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

    let cache = app.state::<Arc<Mutex<Option<SidecarHandle>>>>();
    let handle = {
        let mut guard = cache.lock().await;
        guard.take()
    };
    if let Some(handle) = handle {
        let _ = sidecar::stop(handle).await;
    }

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

// ---------- devices ----------

#[tauri::command]
pub async fn get_devices() -> Result<DeviceSnapshot, String> {
    // Block 4: spawn a temporary sidecar instance with --list-devices
    // is the cleanest path; for now return an empty snapshot until
    // Block 6 wires the device-listing through the orchestrator.
    Ok(empty_device_snapshot())
}

// ---------- user settings ----------

#[tauri::command]
pub async fn get_user_settings(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<UserSettings, String> {
    push_and_emit_debug(&app, &state, DebugLogEntrySource::Ipc, DebugLogEntryLevel::Info, "get_user_settings aufgerufen.");
    settings::load_user_settings(&app).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_user_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: UserSettings,
) -> Result<UserSettings, String> {
    push_and_emit_debug(&app, &state, DebugLogEntrySource::Ipc, DebugLogEntryLevel::Info, "save_user_settings aufgerufen.");
    let saved = settings::save_user_settings(&app, settings).await.map_err(|e| e.to_string())?;
    push_and_emit_debug(&app, &state, DebugLogEntrySource::Main, DebugLogEntryLevel::Info, "User-Settings gespeichert.");
    Ok(saved)
}

// ---------- Azure config ----------

#[tauri::command]
pub async fn get_fixed_config(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<AzureConfigState, String> {
    push_and_emit_debug(&app, &state, DebugLogEntrySource::Ipc, DebugLogEntryLevel::Info, "get_fixed_config aufgerufen.");
    settings::get_azure_config_state(&app).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_fixed_config(
    app: AppHandle,
    state: State<'_, AppState>,
    config: AzureConfig,
) -> Result<AzureConfigState, String> {
    push_and_emit_debug(&app, &state, DebugLogEntrySource::Ipc, DebugLogEntryLevel::Info, "save_fixed_config aufgerufen.");
    settings::save_azure_config(&app, config).await.map_err(|e| e.to_string())?;
    push_and_emit_debug(&app, &state, DebugLogEntrySource::Main, DebugLogEntryLevel::Info, "Azure-Konfiguration gespeichert.");
    settings::get_azure_config_state(&app).await.map_err(|e| e.to_string())
}

// ---------- connectivity ----------

#[tauri::command]
pub async fn test_azure_connectivity(
    payload: Option<serde_json::Value>,
) -> Result<connectivity::ConnectivityResult, String> {
    let value = payload.unwrap_or(serde_json::Value::Null);
    let endpoint = value
        .get("endpoint")
        .and_then(|v| v.as_str())
        .ok_or("endpoint fehlt")?
        .to_string();
    let speech_key = value
        .get("speechKey")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let language = value
        .get("language")
        .and_then(|v| v.as_str())
        .unwrap_or("de-DE")
        .to_string();
    Ok(connectivity::diagnose(&endpoint, &speech_key, &language).await)
}

// ---------- clipboard ----------
//
// Clipboard copy is done in the renderer via `navigator.clipboard`
// (WebView2 supports it natively) — the Rust side has no clipboard
// command any more. See `src/preload/index.ts` for the implementation.

// ---------- event forwarder (replacement for lib.rs::ensure_sidecar) ----------

fn spawn_event_forwarder(
    app: AppHandle,
    mut events_rx: tokio::sync::mpsc::Receiver<tauri_plugin_shell::process::CommandEvent>,
) {
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events_rx.recv().await {
            match event {
                tauri_plugin_shell::process::CommandEvent::Stdout(bytes) => {
                    let text = String::from_utf8_lossy(&bytes);
                    for line in text.lines() {
                        if line.is_empty() { continue; }
                        forward_sidecar_line(&app_handle, line);
                    }
                }
                tauri_plugin_shell::process::CommandEvent::Stderr(bytes) => {
                    let text = String::from_utf8_lossy(&bytes);
                    let entry = app_handle.state::<AppState>().push_debug(
                        DebugLogEntrySource::Sidecar,
                        DebugLogEntryLevel::Warn,
                        format!("stderr: {}", text.trim()),
                    );
                    events::emit_debug(&app_handle, &entry);
                }
                tauri_plugin_shell::process::CommandEvent::Error(err) => {
                    let entry = app_handle.state::<AppState>().push_debug(
                        DebugLogEntrySource::Sidecar,
                        DebugLogEntryLevel::Error,
                        format!("sidecar: {err}"),
                    );
                    events::emit_debug(&app_handle, &entry);
                }
                tauri_plugin_shell::process::CommandEvent::Terminated(payload) => {
                    let exit_code = payload.code;
                    let entry = app_handle.state::<AppState>().push_debug(
                        DebugLogEntrySource::Sidecar,
                        DebugLogEntryLevel::Error,
                        format!("Sidecar beendet (exit={exit_code:?})."),
                    );
                    events::emit_debug(&app_handle, &entry);
                    events::emit_sidecar_crashed(
                        &app_handle,
                        &events::SidecarCrashedPayload { exit_code, last_error: None },
                    );
                    let status = app_handle.state::<AppState>().mark_stopped();
                    events::emit_status(&app_handle, &status);
                }
                _ => {
                    // CommandEvent is #[non_exhaustive]; new variants land
                    // here until we add a dedicated arm.
                }
            }
        }
    });
}

fn forward_sidecar_line(app: &AppHandle, line: &str) {
    let parsed: serde_json::Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => {
            // Surface raw non-JSON output as debug so we don't lose it.
            let entry = app.state::<AppState>().push_debug(
                DebugLogEntrySource::Sidecar,
                DebugLogEntryLevel::Info,
                format!("sidecar raw: {line}"),
            );
            events::emit_debug(app, &entry);
            return;
        }
    };
    let ty = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let payload = parsed.get("payload").cloned().unwrap_or(serde_json::Value::Null);

    match ty {
        "transcript" | "transcript:segment" => {
            let _ = app.emit("transcript:segment", &payload);
        }
        "status" | "transcript:status" => {
            let running = payload.get("running").and_then(|v| v.as_bool()).unwrap_or(false);
            let phase = payload.get("phase").and_then(|v| v.as_str()).unwrap_or("");
            let status = if running {
                app.state::<AppState>().mark_started()
            } else {
                app.state::<AppState>().mark_stopped()
            };
            let _ = app.emit("transcript:status", &status);
            let entry = app.state::<AppState>().push_debug(
                DebugLogEntrySource::Status,
                DebugLogEntryLevel::Info,
                format!("sidecar status: phase={phase} running={running}"),
            );
            events::emit_debug(app, &entry);
        }
        "error" | "transcript:error" => {
            let _ = app.emit("transcript:error", &payload);
        }
        "debug" => {
            let entry = app.state::<AppState>().push_debug(
                DebugLogEntrySource::Sidecar,
                DebugLogEntryLevel::Info,
                payload.to_string(),
            );
            events::emit_debug(app, &entry);
        }
        "device_list" | "device-list" => {
            // Surface device-list payloads as a debug entry; full UI
            // integration lands when the renderer is taught to subscribe.
            let entry = app.state::<AppState>().push_debug(
                DebugLogEntrySource::Sidecar,
                DebugLogEntryLevel::Info,
                format!("device_list: {payload}"),
            );
            events::emit_debug(app, &entry);
        }
        _ => {
            let entry = app.state::<AppState>().push_debug(
                DebugLogEntrySource::Sidecar,
                DebugLogEntryLevel::Info,
                format!("sidecar unknown: {line}"),
            );
            events::emit_debug(app, &entry);
        }
    }
}
