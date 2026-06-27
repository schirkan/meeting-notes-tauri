//! Tauri commands invoked from the renderer via the preload bridge.
//!
//! Naming + event payloads are kept in sync via
//! `src/shared/tauri-contract.ts` (single source of truth).

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
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

    // Transkript-Buffer wird vom Renderer gehalten. Hier nur ein
    // zentraler Log-Punkt + das Versenden eines optionalen
    // reset-Befehls an den laufenden Sidecar (best-effort).
    let cache = app.state::<Arc<Mutex<Option<SidecarHandle>>>>();
    let handle = {
        let guard = cache.lock().await;
        guard.as_ref().map(|h| SidecarHandle {
            child: Arc::clone(&h.child),
            events_rx: tokio::sync::mpsc::channel(1).1,
        })
    };
    if let Some(handle) = handle {
        let _ = sidecar::send_command(&handle, r#"{"type":"reset"}"#).await;
        push_and_emit_debug(
            &app,
            &state,
            DebugLogEntrySource::Sidecar,
            DebugLogEntryLevel::Info,
            "Reset-Befehl an Sidecar gesendet.",
        );
    }

    push_and_emit_debug(
        &app,
        &state,
        DebugLogEntrySource::Main,
        DebugLogEntryLevel::Info,
        "Transkript zurueckgesetzt.",
    );
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
pub async fn get_devices(app: AppHandle) -> Result<DeviceSnapshot, String> {
    // Wir rufen hier den **Sidecar-EXE selbst** auf, aber **nicht als
    // laufende Transkriptions-Instanz** — sondern im Device-Listing-
    // Modus (`--list-devices`). In diesem Modus emittiert der Sidecar
    // genau ein JSON-Lines-Event und beendet sich sofort wieder.
    // Das ist unabhängig vom laufenden Recording-Sidecar, der in
    // `start_recording` über `tauri-plugin-shell` gestartet wird und
    // dauerhaft transcribiert.
    //
    // Wir nutzen hier `std::process::Command` direkt (statt
    // tauri-plugin-shell), weil:
    //   1. Es ein One-Shot-Spawn ist (kein Stream, kein Event-Loop
    //      über mehrere Sekunden) — tauri-plugin-shell ist für
    //      langlebige Prozesse mit Stream-Kommunikation gedacht.
    //   2. `std::process::Command` ist `Send` und kann direkt aus
    //      `spawn_blocking` aufgerufen werden, ohne Borrow-Lifetime-
    //      Konflikte mit dem `tauri::AppHandle`.
    let exe_path = match sidecar::resolve_sidecar_path(&app) {
        Ok(p) => p,
        Err(e) => {
            push_and_emit_debug(
                &app,
                &app.state::<AppState>(),
                DebugLogEntrySource::Sidecar,
                DebugLogEntryLevel::Warn,
                format!("Sidecar-EXE für Device-Listing nicht gefunden: {e}"),
            );
            return Ok(empty_device_snapshot());
        }
    };

    // Sidecar-EXE benötigt ihre DLLs im selben Verzeichnis. Wir
    // lassen `std::process::Command` das Arbeitsverzeichnis
    // standardmäßig vom aktuellen Prozess erben — das ist im
    // portable-Layout automatisch das EXE-Dir (Tauri startet von
    // dort). resolve_sidecar_path liefert die EXE in
    // `<exe_dir>/sidecar/<exe>`, und das EXE-Dir enthält die DLLs.
    // Wir setzen zusätzlich explizit das CWD auf das
    // Sidecar-EXE-Verzeichnis, falls resolve_sidecar_path mal einen
    // abweichenden Pfad liefern sollte.
    let cwd = exe_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());

    let result = tauri::async_runtime::spawn_blocking(move || -> Result<Option<DeviceSnapshot>, String> {
        let mut child = std::process::Command::new(&exe_path)
            .arg("--list-devices")
            .current_dir(&cwd)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Sidecar-Spawn fehlgeschlagen: {e}"))?;

        // Sidecar beendet sich nach der device_list-Zeile selbst.
        // Wir warten max. 5 s, lesen aber auch schon früher, wenn
        // der Prozess exited ist.
        let start = std::time::Instant::now();
        let timeout = std::time::Duration::from_secs(5);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break, // Prozess beendet
                Ok(None) => {
                    if start.elapsed() >= timeout { break; }
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                Err(_) => break,
            }
        }
        let _ = child.kill(); // sicherheitshalber

        let mut stdout = String::new();
        if let Some(mut out) = child.stdout.take() {
            use std::io::Read;
            let _ = out.read_to_string(&mut stdout);
        }

        if stdout.trim().is_empty() {
            return Ok(None);
        }

        // Parse: die Sidecar-Ausgabe ist genau eine JSON-Lines-Zeile
        // {"type":"device_list","payload":{...}}. Wir scannen alle
        // Zeilen und nehmen die erste mit type=="device_list".
        for line in stdout.lines() {
            if line.trim().is_empty() { continue; }
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(line) {
                let ty = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
                if ty == "device_list" {
                    if let Some(payload) = parsed.get("payload") {
                        if let Ok(snap) = serde_json::from_value::<SidecarDeviceSnapshot>(payload.clone()) {
                            return Ok(Some(DeviceSnapshot {
                                inputs: snap.inputs.into_iter().map(DeviceInfo::from).collect(),
                                outputs: snap.outputs.into_iter().map(DeviceInfo::from).collect(),
                                fetched_at_iso: snap.fetched_at_iso,
                            }));
                        }
                    }
                }
            }
        }
        Ok(None)
    })
    .await
    .map_err(|e| format!("Device-Listing-Task: {e}"))?;

    match result {
        Ok(Some(snap)) => {
            push_and_emit_debug(
                &app,
                &app.state::<AppState>(),
                DebugLogEntrySource::Sidecar,
                DebugLogEntryLevel::Info,
                format!(
                    "Device-Listing: {} inputs, {} outputs",
                    snap.inputs.len(),
                    snap.outputs.len()
                ),
            );
            Ok(snap)
        }
        Ok(None) => {
            push_and_emit_debug(
                &app,
                &app.state::<AppState>(),
                DebugLogEntrySource::Sidecar,
                DebugLogEntryLevel::Warn,
                "Sidecar beendet ohne device_list-Event — leerer Snapshot zurueckgegeben.",
            );
            Ok(empty_device_snapshot())
        }
        Err(e) => {
            push_and_emit_debug(
                &app,
                &app.state::<AppState>(),
                DebugLogEntrySource::Sidecar,
                DebugLogEntryLevel::Warn,
                format!("Device-Listing fehlgeschlagen: {e}"),
            );
            Ok(empty_device_snapshot())
        }
    }
}

/// Hilfsstruktur, die dem vom Sidecar emittierten PascalCase-Snapshot
/// entspricht (`DeviceSnapshot` in `sidecar/DeviceResolver.cs`).
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
struct SidecarDeviceSnapshot {
    inputs: Vec<SidecarDeviceInfo>,
    outputs: Vec<SidecarDeviceInfo>,
    fetched_at_iso: String,
}

#[derive(Debug, serde::Deserialize)]
struct SidecarDeviceInfo {
    id: String,
    name: String,
    flow: String,
    is_default: bool,
}

impl From<SidecarDeviceInfo> for DeviceInfo {
    fn from(value: SidecarDeviceInfo) -> Self {
        DeviceInfo {
            id: value.id,
            name: value.name,
            flow: value.flow,
            is_default: value.is_default,
        }
    }
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
    app: AppHandle,
    state: State<'_, AppState>,
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

    push_and_emit_debug(
        &app,
        &state,
        DebugLogEntrySource::Ipc,
        DebugLogEntryLevel::Info,
        format!("test_azure_connectivity(endpoint={endpoint}) aufgerufen."),
    );

    let result = connectivity::diagnose(&endpoint, &speech_key, &language).await;

    // Bridge-Event: Renderer kann zuhören statt zu pollen
    events::emit_connectivity_result(&app, &result);
    Ok(result)
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
            events::emit_segment(app, &payload);
        }
        "status" | "transcript:status" => {
            let running = payload.get("running").and_then(|v| v.as_bool()).unwrap_or(false);
            let phase = payload.get("phase").and_then(|v| v.as_str()).unwrap_or("");
            let status = if running {
                app.state::<AppState>().mark_started()
            } else {
                app.state::<AppState>().mark_stopped()
            };
            events::emit_status(app, &status);
            let entry = app.state::<AppState>().push_debug(
                DebugLogEntrySource::Status,
                DebugLogEntryLevel::Info,
                format!("sidecar status: phase={phase} running={running}"),
            );
            events::emit_debug(app, &entry);
        }
        "error" | "transcript:error" => {
            events::emit_error(app, &payload);
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
