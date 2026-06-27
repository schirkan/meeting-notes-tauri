//! Sidecar process management (T-301).
//!
//! Spawns the C# sidecar via `tauri-plugin-shell`, returns the live
//! `CommandChild` so the orchestrator (T-300) can read its
//! stdout/stderr event stream and write JSON-Lines commands back over
//! stdin (`CommandChild::write`).
//!
//! The pipe-name parameter from the legacy Electron sidecar is gone
//! (AD-008): JSON-Lines goes over stdin/stdout, no Named Pipe needed.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::{mpsc, Mutex};

#[derive(Debug, thiserror::Error)]
pub enum SidecarError {
    #[error("shell plugin error: {0}")]
    Shell(String),
    #[error("spawn error: {0}")]
    Spawn(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

impl From<tauri_plugin_shell::Error> for SidecarError {
    fn from(value: tauri_plugin_shell::Error) -> Self {
        SidecarError::Shell(value.to_string())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarOptions {
    pub sample_rate: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speech_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speech_region: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speech_endpoint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mic_device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker_device_id: Option<String>,
}

/// Handle returned by `start` — exposes the underlying `CommandChild`
/// for stdin writes plus a Tokio mpsc channel for the orchestrator to
/// receive CommandEvents (stdout chunks, stderr, termination) from.
///
/// `CommandChild` is not `Clone` in tauri-plugin-shell 2.x, so we wrap
/// it in `Arc<Mutex<Option<...>>>`: the `Arc` lets the orchestrator and
/// the cache share ownership, the `Option` lets `stop()` consume the
/// child for `kill(self)`.
pub struct SidecarHandle {
    pub child: Arc<Mutex<Option<CommandChild>>>,
    pub events_rx: mpsc::Receiver<CommandEvent>,
}

pub async fn start<R: Runtime>(
    app: &AppHandle<R>,
    options: SidecarOptions,
) -> Result<SidecarHandle, SidecarError> {
    let exe_path = resolve_sidecar_path(app)?;
    let mut command = app.shell().command(exe_path.to_string_lossy().as_ref());

    let sample_rate = options.sample_rate.clamp(8000, 48000);
    command = command.args(["--sample-rate".to_string(), sample_rate.to_string()]);

    if let Some(language) = options.language.as_deref() {
        command = command.args(["--language".to_string(), language.into()]);
    }
    if let Some(key) = options.speech_key.as_deref() {
        command = command.args(["--speech-key".to_string(), key.into()]);
    }
    if let Some(region) = options.speech_region.as_deref() {
        command = command.args(["--speech-region".to_string(), region.into()]);
    }
    if let Some(endpoint) = options.speech_endpoint.as_deref() {
        command = command.args(["--speech-endpoint".to_string(), endpoint.into()]);
    }
    if let Some(mic) = options.mic_device_id.as_deref() {
        command = command.args(["--mic-device-id".to_string(), mic.into()]);
    }
    if let Some(spk) = options.speaker_device_id.as_deref() {
        command = command.args(["--speaker-device-id".to_string(), spk.into()]);
    }

    let (mut rx, child) = command.spawn().map_err(|e| SidecarError::Spawn(e.to_string()))?;

    let (events_tx, events_rx) = mpsc::channel::<CommandEvent>(128);

    // Forward CommandEvents into our channel. The tauri-plugin-shell
    // Receiver is single-consumer, so this fan-in is the only consumer.
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            if events_tx.send(event).await.is_err() {
                break;
            }
        }
    });

    Ok(SidecarHandle {
        child: Arc::new(Mutex::new(Some(child))),
        events_rx,
    })
}

/// Write a JSON-Lines command to the sidecar's stdin (one line, no
/// trailing newline needed — write adds it).
pub async fn send_command(handle: &SidecarHandle, command: &str) -> Result<(), SidecarError> {
    let mut line = command.as_bytes().to_vec();
    line.push(b'\n');
    let mut guard = handle.child.lock().await;
    let child = guard.as_mut().ok_or_else(|| {
        SidecarError::Spawn("Sidecar bereits beendet — Schreiben nicht möglich.".into())
    })?;
    child
        .write(&line)
        .map_err(|e| SidecarError::Spawn(e.to_string()))?;
    Ok(())
}

pub async fn stop(handle: SidecarHandle) -> Result<(), SidecarError> {
    // Politely ask the sidecar to shut down before killing.
    let _ = send_command(&handle, r#"{"type":"shutdown"}"#).await;
    tokio::time::sleep(Duration::from_millis(250)).await;
    let mut guard = handle.child.lock().await;
    if let Some(child) = guard.take() {
        child.kill().map_err(|e| SidecarError::Spawn(e.to_string()))?;
    }
    Ok(())
}

/// Locate the sidecar EXE. Search order:
///   1. `sidecar/publish/sidecar/<exe>` next to the Tauri-Main CWD (dev)
///   2. Bundled resource dir (`app.path().resource_dir()/sidecar/<exe>`)
///   3. Same directory as the Tauri-Main EXE
fn resolve_sidecar_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, SidecarError> {
    let exe = if cfg!(windows) { "MeetingNotes.Sidecar.exe" } else { "MeetingNotes.Sidecar" };

    // 1. CWD-relative dev path
    if let Ok(cwd) = std::env::current_dir() {
        let candidate = cwd.join("sidecar").join("publish").join("sidecar").join(exe);
        if candidate.exists() {
            return Ok(candidate);
        }
        let candidate2 = cwd.join("..").join("sidecar").join("bin").join("Release").join("net8.0-windows").join(exe);
        if candidate2.exists() {
            return Ok(candidate2);
        }
    }

    // 2. Bundled resource dir
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("sidecar").join(exe);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    // 3. Same directory as the Tauri-Main EXE
    if let Ok(self_path) = std::env::current_exe() {
        if let Some(dir) = self_path.parent() {
            let candidate = dir.join(exe);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    Err(SidecarError::Spawn(format!(
        "Sidecar-EXE '{exe}' nicht gefunden. Erwartet unter sidecar/publish/sidecar/ oder als Bundle-Resource."
    )))
}
