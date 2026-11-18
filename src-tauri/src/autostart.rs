//! Automatischer Aufnahmestart bei erkanntem Meeting (T-513, Stufe 1).
//!
//! Der Erkennungsmodus laeuft als **eigener Sidecar-Prozess**
//! (`--detect-only`). Er beobachtet den Core-Audio-Session-Graph, ohne
//! Audio aufzunehmen und ohne Azure zu kontaktieren - die Aufnahme startet
//! erst, wenn die Erkennung eintrifft.
//!
//! Warum ein eigener Prozess: der Aufnahme-Sidecar wird erst beim
//! Aufnahmestart erzeugt. Die Erkennung muss aber **vor** ihm laufen,
//! sonst kaeme das Meeting-Ereignis nie an. Ein separater Prozess loest das
//! ohne Eingriff in den Aufnahme-Lifecycle (T-300).
//!
//! Die Erkennung selbst liegt im C#-Sidecar (sidecar/MeetingDetector.cs);
//! dieser Rust-Teil startet den Prozess, leitet das Ereignis weiter und
//! stoesst den Aufnahmestart an.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;

use crate::events;

/// Ereignis des Erkennungsmodus: ein Meeting wurde erkannt.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingDetectedPayload {
    pub process_name: String,
    pub process_id: u32,
    /// "mic" oder "speaker".
    pub signal: String,
}

/// Handle auf den laufenden Erkennungsprozess.
#[derive(Clone)]
pub struct DetectorHandle {
    pub child: Arc<Mutex<Option<CommandChild>>>,
}

/// Startet den Erkennungsmodus.
///
/// `on_detected` wird bei jeder Erkennung aufgerufen. Der Aufrufer
/// entscheidet, ob die Aufnahme startet.
pub async fn start_detector(
    app: &AppHandle,
    processes: &[String],
    on_detected: impl Fn(MeetingDetectedPayload) + Send + Sync + 'static,
) -> Result<DetectorHandle, String> {
    let exe_path = crate::sidecar::resolve_sidecar_path(app).map_err(|e| e.to_string())?;
    let mut command = app
        .shell()
        .command(exe_path.to_string_lossy().as_ref())
        .args(["--detect-only"]);
    if !processes.is_empty() {
        command = command.args([
            "--meeting-processes".to_string(),
            processes.join(","),
        ]);
    }
    let (mut rx, child) = command.spawn().map_err(|e| e.to_string())?;

    let handler = Arc::new(on_detected);
    // Der App-Handle wandert in den Task - er muss deshalb eigenstaendig
    // (owned) vorliegen, sonst entkommt die Referenz dem Task.
    let app = app.clone();
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    for entry in line.lines() {
                        if entry.trim().is_empty() {
                            continue;
                        }
                        if let Some(payload) = parse_meeting_detected(entry) {
                            handler(payload);
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    let text = String::from_utf8_lossy(&bytes);
                    if !text.trim().is_empty() {
                        let entry = crate::state::AppState::default().push_debug(
                            crate::state::DebugLogEntrySource::Sidecar,
                            crate::state::DebugLogEntryLevel::Warn,
                            format!("detector/stderr: {}", text.trim()),
                        );
                        events::emit_debug(&app, &entry);
                    }
                }
                CommandEvent::Error(error) => {
                    let entry = crate::state::AppState::default().push_debug(
                        crate::state::DebugLogEntrySource::Sidecar,
                        crate::state::DebugLogEntryLevel::Error,
                        format!("detector: {error}"),
                    );
                    events::emit_debug(&app, &entry);
                }
                CommandEvent::Terminated(payload) => {
                    let entry = crate::state::AppState::default().push_debug(
                        crate::state::DebugLogEntrySource::Sidecar,
                        crate::state::DebugLogEntryLevel::Warn,
                        format!("detector beendet (Exit-Code {:?})", payload.code),
                    );
                    events::emit_debug(&app, &entry);
                }
                _ => {}
            }
        }
    });

    Ok(DetectorHandle {
        child: Arc::new(Mutex::new(Some(child))),
    })
}

/// Beendet den Erkennungsprozess.
pub async fn stop_detector(handle: DetectorHandle) {
    let mut guard = handle.child.lock().await;
    if let Some(child) = guard.take() {
        let _ = child.kill();
    }
}

/// Erkennt das `meeting_detected`-Event des Sidecars.
pub fn parse_meeting_detected(line: &str) -> Option<MeetingDetectedPayload> {
    let parsed: serde_json::Value = serde_json::from_str(line).ok()?;
    if parsed.get("type")?.as_str()? != "meeting_detected" {
        return None;
    }
    let payload = parsed.get("payload")?;
    Some(MeetingDetectedPayload {
        process_name: payload.get("process_name")?.as_str()?.to_string(),
        process_id: payload.get("process_id")?.as_u64()? as u32,
        signal: payload.get("signal")?.as_str()?.to_string(),
    })
}

/// Meldet den Prozessnamen der Aufnahme-Anwendung, die der Erkennung
/// zugrunde liegt. Wird fuer die Statusanzeige im Renderer gebraucht.
pub fn describe_detection(payload: &MeetingDetectedPayload) -> String {
    format!(
        "{} (PID {}) - Signal {}",
        payload.process_name, payload.process_id, payload.signal
    )
}

#[cfg(test)]
mod detection_tests {
    use super::*;

    #[test]
    fn parses_meeting_detected_events() {
        let line = r#"{"type":"meeting_detected","payload":{"process_name":"teams","process_id":4242,"signal":"mic"}}"#;
        let payload = parse_meeting_detected(line).expect("payload");
        assert_eq!(payload.process_name, "teams");
        assert_eq!(payload.process_id, 4242);
        assert_eq!(payload.signal, "mic");
    }

    #[test]
    fn ignores_other_events() {
        assert!(parse_meeting_detected(r#"{"type":"handshake","payload":{}}"#).is_none());
        assert!(parse_meeting_detected(r#"{"type":"meeting_detected","payload":{}}"#).is_none());
        assert!(parse_meeting_detected("not json").is_none());
    }

    #[test]
    fn describes_detection_for_the_ui() {
        let payload = MeetingDetectedPayload {
            process_name: "zoom".into(),
            process_id: 7,
            signal: "mic".into(),
        };
        assert_eq!(describe_detection(&payload), "zoom (PID 7) - Signal mic");
    }
}
