//! Tauri event payloads and helpers.
//!
//! Event names live in `src/shared/tauri-contract.ts` (single source of truth).
//! This module owns the Rust-side struct definitions and the emit helpers
//! used by the commands + sidecar-bridge.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::state::DebugLogEntry;

pub const EVENT_SEGMENT: &str = "transcript:segment";
pub const EVENT_STATUS: &str = "transcript:status";
pub const EVENT_ERROR: &str = "transcript:error";
pub const EVENT_DEBUG: &str = "transcript:debug";
pub const EVENT_SIDECAR_CRASHED: &str = "sidecar:crashed";
pub const EVENT_FIXED_CONFIG_STATUS: &str = "transcript:fixed-config-status";
pub const EVENT_CONNECTIVITY_RESULT: &str = "transcript:connectivity-result";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptStatus {
    pub running: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarCrashedPayload {
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

/// Status der fest verdrahteten Azure-Konfiguration.
/// Wird beim App-Start emittiert und spiegelt, ob `config/azure.json`
/// im app_config_dir existiert.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixedConfigStatus {
    pub exists: bool,
    pub path: String,
}

pub fn emit_status(app: &AppHandle, status: &TranscriptStatus) {
  let _ = app.emit(EVENT_STATUS, status);
}

pub fn emit_debug(app: &AppHandle, entry: &DebugLogEntry) {
  let _ = app.emit(EVENT_DEBUG, entry);
}

pub fn emit_segment<T: Serialize + Clone>(app: &AppHandle, payload: &T) {
  let _ = app.emit(EVENT_SEGMENT, payload);
}

pub fn emit_error<T: Serialize + Clone>(app: &AppHandle, payload: &T) {
  let _ = app.emit(EVENT_ERROR, payload);
}

pub fn emit_sidecar_crashed(app: &AppHandle, payload: &SidecarCrashedPayload) {
  let _ = app.emit(EVENT_SIDECAR_CRASHED, payload);
}

pub fn emit_fixed_config_status(app: &AppHandle, status: &FixedConfigStatus) {
  let _ = app.emit(EVENT_FIXED_CONFIG_STATUS, status);
}

pub fn emit_connectivity_result<T: Serialize + Clone>(app: &AppHandle, payload: &T) {
  let _ = app.emit(EVENT_CONNECTIVITY_RESULT, payload);
}
