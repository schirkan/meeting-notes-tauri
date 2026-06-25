//! App-wide runtime state.
//!
//! Holds the in-memory state shared across Tauri commands: recording flag,
//! start timestamp, debug log. Settings and Azure config live on disk via
//! the `settings` module (Block 4) and are not duplicated here.

use std::sync::Mutex;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::events::TranscriptStatus;

const DEBUG_LOG_CAP: usize = 300;

#[derive(Default)]
pub struct AppState {
    inner: Mutex<AppStateInner>,
}

#[derive(Default)]
struct AppStateInner {
    running: bool,
    started_at: Option<String>,
    debug_log: Vec<DebugLogEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DebugLogEntrySource {
    Main,
    Sidecar,
    Ipc,
    Status,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DebugLogEntryLevel {
    Info,
    Warn,
    Error,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugLogEntry {
    pub id: String,
    pub timestamp_iso: String,
    pub source: DebugLogEntrySource,
    pub level: DebugLogEntryLevel,
    pub message: String,
}

impl AppState {
    pub fn snapshot_status(&self) -> TranscriptStatus {
        let inner = self.inner.lock().expect("AppState mutex poisoned");
        TranscriptStatus {
            running: inner.running,
            started_at: inner.started_at.clone(),
        }
    }

    pub fn mark_started(&self) -> TranscriptStatus {
        let mut inner = self.inner.lock().expect("AppState mutex poisoned");
        inner.running = true;
        let started_at = Utc::now().to_rfc3339();
        inner.started_at = Some(started_at.clone());
        TranscriptStatus {
            running: true,
            started_at: Some(started_at),
        }
    }

    pub fn mark_stopped(&self) -> TranscriptStatus {
        let mut inner = self.inner.lock().expect("AppState mutex poisoned");
        inner.running = false;
        inner.started_at = None;
        TranscriptStatus {
            running: false,
            started_at: None,
        }
    }

    pub fn push_debug(
        &self,
        source: DebugLogEntrySource,
        level: DebugLogEntryLevel,
        message: impl Into<String>,
    ) -> DebugLogEntry {
        let entry = DebugLogEntry {
            id: Uuid::new_v4().to_string(),
            timestamp_iso: Utc::now().to_rfc3339(),
            source,
            level,
            message: message.into(),
        };
        let mut inner = self.inner.lock().expect("AppState mutex poisoned");
        inner.debug_log.insert(0, entry.clone());
        if inner.debug_log.len() > DEBUG_LOG_CAP {
            inner.debug_log.truncate(DEBUG_LOG_CAP);
        }
        entry
    }

    pub fn debug_log(&self) -> Vec<DebugLogEntry> {
        self.inner
            .lock()
            .expect("AppState mutex poisoned")
            .debug_log
            .clone()
    }

    pub fn clear_debug_log(&self) -> usize {
        let mut inner = self.inner.lock().expect("AppState mutex poisoned");
        let count = inner.debug_log.len();
        inner.debug_log.clear();
        count
    }
}
