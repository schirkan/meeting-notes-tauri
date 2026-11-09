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
    pub proxy: Option<crate::settings::AzureProxyConfig>,
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

fn proxy_arguments(proxy: &crate::settings::AzureProxyConfig) -> Result<Vec<String>, SidecarError> {
    crate::connectivity::configured_proxy(proxy).map_err(SidecarError::Spawn)?;
    Ok(vec!["--proxy-host".into(), proxy.host.trim().into(),
        "--proxy-port".into(), proxy.port.to_string()])
}

fn apply_proxy(
    mut command: tauri_plugin_shell::process::Command,
    proxy: Option<&crate::settings::AzureProxyConfig>,
) -> Result<tauri_plugin_shell::process::Command, SidecarError> {
    command = command.env("MEETING_NOTES_PROXY_USERNAME", "")
        .env("MEETING_NOTES_PROXY_PASSWORD", "");
    if let Some(proxy) = proxy {
        command = command.args(proxy_arguments(proxy)?)
            .env("MEETING_NOTES_PROXY_USERNAME", proxy.username.as_deref().unwrap_or(""))
            .env("MEETING_NOTES_PROXY_PASSWORD", proxy.password.as_deref().unwrap_or(""));
    }
    Ok(command)
}

#[derive(Deserialize)]
pub struct SpeechConnectivityResult {
    pub reachable: bool,
    pub steps: Vec<crate::connectivity::Step>,
}

pub async fn diagnose_speech<R: Runtime>(
    app: &AppHandle<R>,
    config: &crate::settings::AzureConfig,
    language: &str,
) -> Result<SpeechConnectivityResult, String> {
    let exe_path = resolve_sidecar_path(app).map_err(|e| e.to_string())?;
    let command = app.shell().command(exe_path.to_string_lossy().as_ref())
        .args(["--test-connectivity", "--speech-region", &config.region,
            "--speech-endpoint", &config.endpoint, "--language", language])
        .env("MEETING_NOTES_SPEECH_KEY", &config.speech_key);
    let command = apply_proxy(command, config.proxy.as_ref()).map_err(|e| e.to_string())?;
    let (mut rx, child) = command.spawn().map_err(|e| e.to_string())?;
    let result = tokio::time::timeout(Duration::from_secs(45), async {
        let mut stderr = String::new();
        let mut exit_code = None;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    if let Some(result) = parse_speech_result(&line) {
                        return Ok(result);
                    }
                }
                CommandEvent::Stderr(line) => {
                    if stderr.len() < 8192 {
                        stderr.push_str(&String::from_utf8_lossy(&line));
                        stderr.push('\n');
                    }
                }
                CommandEvent::Error(error) => {
                    stderr.push_str(&error);
                    stderr.push('\n');
                }
                CommandEvent::Terminated(payload) => {
                    exit_code = payload.code;
                }
                _ => {}
            }
        }
        let mut detail = format!("Speech/WSS-Diagnose lieferte kein Ergebnis (Exit-Code: {exit_code:?}). {}", stderr.trim());
        for secret in [Some(config.speech_key.as_str()),
            config.proxy.as_ref().and_then(|p| p.username.as_deref()),
            config.proxy.as_ref().and_then(|p| p.password.as_deref())].into_iter().flatten() {
            if !secret.is_empty() {
                detail = detail.replace(secret, "[redacted]");
            }
        }
        Err(detail)
    }).await;
    let _ = child.kill();
    result.map_err(|_| "Speech/WSS-Diagnose: Timeout nach 45 s".to_string())?
}

fn parse_speech_result(line: &[u8]) -> Option<SpeechConnectivityResult> {
    let event: serde_json::Value = serde_json::from_slice(line).ok()?;
    if event.get("type")?.as_str()? != "speech_connectivity" {
        return None;
    }
    serde_json::from_value(event.get("payload")?.clone()).ok()
}

#[cfg(test)]
mod connectivity_tests {
    use super::*;

    #[test]
    fn proxy_arguments_exclude_credentials() {
        let proxy = crate::settings::AzureProxyConfig {
            host: "proxy.test".into(), port: 8080,
            username: Some("test-user".into()), password: Some("test-password".into()),
        };
        assert_eq!(proxy_arguments(&proxy).unwrap(),
            vec!["--proxy-host", "proxy.test", "--proxy-port", "8080"]);
    }

    #[test]
    fn parses_only_native_speech_diagnostic_events() {
        let line = br#"{"type":"speech_connectivity","payload":{"reachable":true,"steps":[{"step":"speech-wss-mic","status":"ok","detail":"connected"}]}}"#;
        let result = parse_speech_result(line).unwrap();
        assert!(result.reachable);
        assert_eq!(result.steps.len(), 1);
        assert!(parse_speech_result(br#"{"type":"debug","payload":{}}"#).is_none());
        assert!(parse_speech_result(b"not json").is_none());
    }
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
    command = command.env("MEETING_NOTES_SPEECH_KEY", options.speech_key.as_deref().unwrap_or(""));
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

    command = apply_proxy(command, options.proxy.as_ref())?;
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
///   1. CWD-relative dev paths (`sidecar/publish/sidecar/`, `../sidecar/bin/Release/`)
///   2. Bundled resource dir (`app.path().resource_dir()/sidecar/`)
///   3. Tauri-EXE directory + `sidecar/` (portable distribution layout)
///   4. Tauri-EXE directory directly (fallback)
pub fn resolve_sidecar_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, SidecarError> {
    let exe = if cfg!(windows) { "MeetingNotes.Sidecar.exe" } else { "MeetingNotes.Sidecar" };

    // 1. CWD-relative dev paths
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

    // 2. Bundled resource dir (Tauri bundle's `resources/sidecar/<exe>`)
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("sidecar").join(exe);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    // 3. Tauri-EXE directory + `sidecar/<exe>` (portable dist layout)
    if let Ok(self_path) = std::env::current_exe() {
        if let Some(dir) = self_path.parent() {
            let candidate = dir.join("sidecar").join(exe);
            if candidate.exists() {
                return Ok(candidate);
            }
            // 4. Tauri-EXE directory directly (fallback)
            let candidate2 = dir.join(exe);
            if candidate2.exists() {
                return Ok(candidate2);
            }
        }
    }

    Err(SidecarError::Spawn(format!(
        "Sidecar-EXE '{exe}' nicht gefunden. Erwartet unter sidecar/publish/sidecar/ oder als Bundle-Resource."
    )))
}
