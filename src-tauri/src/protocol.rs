//! JSON-Lines startup contract for the recording and detection sidecars.

use std::{collections::VecDeque, time::Duration};

use serde_json::Value;
use tauri_plugin_shell::process::CommandEvent;
use tokio::sync::mpsc;

use crate::sidecar::{self, SidecarHandle};

pub const PROTOCOL_VERSION: &str = "2.0.0";
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);
const CAPTURE_START_TIMEOUT: Duration = Duration::from_secs(20);

fn check_handshake(line: &str) -> Result<(), String> {
    let event: Value =
        serde_json::from_str(line).map_err(|_| "The sidecar did not send a valid handshake.")?;
    if event["type"] != "handshake" || event.get("level").is_some() {
        return Err("The first sidecar event was not a handshake.".into());
    }
    let version = event["payload"]["protocol_version"]
        .as_str()
        .unwrap_or("<missing>");
    if version != PROTOCOL_VERSION {
        return Err(format!("The sidecar reports protocol version {version}; exactly {PROTOCOL_VERSION} is required."));
    }
    Ok(())
}

async fn next_line(
    rx: &mut mpsc::Receiver<CommandEvent>,
    pending: &mut VecDeque<String>,
) -> Result<String, String> {
    loop {
        if let Some(line) = pending.pop_front() {
            return Ok(line);
        }
        match rx.recv().await {
            Some(CommandEvent::Stdout(bytes)) => pending.extend(
                String::from_utf8_lossy(&bytes)
                    .lines()
                    .filter(|line| !line.trim().is_empty())
                    .map(str::to_owned),
            ),
            Some(CommandEvent::Error(error)) => {
                return Err(format!("Sidecar startup failed: {error}"))
            }
            Some(CommandEvent::Terminated(exit)) => {
                return Err(format!(
                    "The sidecar exited during startup (exit: {:?}).",
                    exit.code
                ))
            }
            None => return Err("The sidecar disconnected during startup.".into()),
            _ => {}
        }
    }
}

/// Confirm the protocol before accepting any payload. The sole output consumer
/// retains any lines following the handshake in the same shell event.
pub async fn handshake(handle: &mut SidecarHandle) -> Result<VecDeque<String>, String> {
    let mut pending = VecDeque::new();
    let first = tokio::time::timeout(
        HANDSHAKE_TIMEOUT,
        next_line(&mut handle.events_rx, &mut pending),
    )
    .await
    .map_err(|_| "The sidecar did not send its handshake within 15 seconds.")??;
    check_handshake(&first)?;
    sidecar::send_command(handle, r#"{"type":"handshake-ack"}"#)
        .await
        .map_err(|err| err.to_string())?;
    Ok(pending)
}

fn capture_started(line: &str) -> Result<bool, String> {
    let Ok(event) = serde_json::from_str::<Value>(line) else {
        return Ok(false);
    };
    let payload = &event["payload"];
    if event["type"] == "status" && event.get("level").is_none() {
        if payload["phase"] == "started" && payload["running"] == true {
            return Ok(true);
        }
        if payload["phase"] == "stopped" && payload["running"] == false {
            return Err("The sidecar stopped before capture was ready.".into());
        }
    }
    if event["type"] == "error" || event["type"] == "transcript:error" {
        return Err(event["message"]
            .as_str()
            .or_else(|| payload["message"].as_str())
            .unwrap_or("The sidecar failed before capture was ready.")
            .into());
    }
    Ok(false)
}

/// Buffer early output, including recognition results, until the provider's
/// authoritative start. The caller publishes running before replaying it.
async fn read_capture_start(
    rx: &mut mpsc::Receiver<CommandEvent>,
    mut pending: VecDeque<String>,
) -> Result<Vec<String>, String> {
    let mut buffered = Vec::new();
    loop {
        let line = next_line(rx, &mut pending).await?;
        if capture_started(&line)? {
            buffered.extend(pending);
            return Ok(buffered);
        }
        buffered.push(line);
    }
}

pub async fn wait_for_capture(handle: &mut SidecarHandle) -> Result<Vec<String>, String> {
    let pending = handshake(handle).await?;
    tokio::time::timeout(
        CAPTURE_START_TIMEOUT,
        read_capture_start(&mut handle.events_rx, pending),
    )
    .await
    .map_err(|_| "The sidecar did not confirm capture startup within 20 seconds.")?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_structured_handshake_is_required() {
        for version in [
            "2.0.0",
            "1.0.0",
            "2.0.1",
            "3.0.0",
            "2.0.0-beta",
            "2.0.0+build",
            " 2.0.0",
            "",
        ] {
            let line =
                serde_json::json!({"type": "handshake", "payload": {"protocol_version": version}})
                    .to_string();
            assert_eq!(
                check_handshake(&line).is_ok(),
                version == "2.0.0",
                "{version:?}"
            );
        }
        assert!(check_handshake(r#"{"type":"handshake","payload":{}}"#).is_err());
        assert!(check_handshake(
            r#"{"type":"status","payload":{"phase":"started","running":true}}"#
        )
        .is_err());
    }

    #[tokio::test]
    async fn capture_confirmation_preserves_early_segments_and_remaining_pipe_output() {
        let (tx, mut rx) = mpsc::channel(2);
        let handshake = r#"{"type":"handshake","payload":{"protocol_version":"2.0.0"}}"#;
        let log = r#"{"type":"status","level":"info","code":"started","message":"initializing"}"#;
        let early = r#"{"type":"transcript","payload":{"text":"early"}}"#;
        let started = r#"{"type":"status","payload":{"phase":"started","running":true}}"#;
        let later = r#"{"type":"transcript","payload":{"text":"later"}}"#;
        tx.send(CommandEvent::Stdout(
            format!("{handshake}\n{log}\n{early}\n{started}\n{later}").into_bytes(),
        ))
        .await
        .unwrap();
        let mut pending = VecDeque::new();
        check_handshake(&next_line(&mut rx, &mut pending).await.unwrap()).unwrap();
        assert_eq!(
            read_capture_start(&mut rx, pending).await.unwrap(),
            [log, early, later]
        );
    }

    #[tokio::test]
    async fn failed_or_unconfirmed_starts_do_not_return_buffered_output() {
        let (tx, mut rx) = mpsc::channel(2);
        let wrong = r#"{"type":"status","payload":{"phase":"started","running":false}}"#;
        let error = r#"{"type":"error","level":"error","code":"SIDECAR_START_FAILED","message":"No microphone"}"#;
        assert_eq!(
            read_capture_start(&mut rx, [wrong.into(), error.into()].into())
                .await
                .unwrap_err(),
            "No microphone"
        );
        drop(tx);
        assert!(read_capture_start(&mut rx, [wrong.into()].into())
            .await
            .is_err());
    }
}
