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
    paused: bool,
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
            paused: inner.paused,
            started_at: inner.started_at.clone(),
        }
    }

    pub fn mark_started(&self) -> TranscriptStatus {
        let mut inner = self.inner.lock().expect("AppState mutex poisoned");
        inner.running = true;
        inner.paused = false;
        let started_at = Utc::now().to_rfc3339();
        inner.started_at = Some(started_at.clone());
        TranscriptStatus {
            running: true,
            paused: false,
            started_at: Some(started_at),
        }
    }

    /// Pause (T-507): die Aufnahme laeuft weiter, die Azure-Sitzung
    /// bleibt am Leben. Startzeit und Laufzeit werden nicht zurueckgesetzt.
    pub fn mark_paused(&self) -> TranscriptStatus {
        let mut inner = self.inner.lock().expect("AppState mutex poisoned");
        inner.running = true;
        inner.paused = true;
        TranscriptStatus {
            running: true,
            paused: true,
            started_at: inner.started_at.clone(),
        }
    }

    /// Fortsetzen nach Pause: dieselbe Sitzung, dieselbe Sprecher-IDs.
    pub fn mark_resumed(&self) -> TranscriptStatus {
        let mut inner = self.inner.lock().expect("AppState mutex poisoned");
        inner.running = true;
        inner.paused = false;
        TranscriptStatus {
            running: true,
            paused: false,
            started_at: inner.started_at.clone(),
        }
    }

    pub fn mark_stopped(&self) -> TranscriptStatus {
        let mut inner = self.inner.lock().expect("AppState mutex poisoned");
        inner.running = false;
        inner.paused = false;
        inner.started_at = None;
        TranscriptStatus {
            running: false,
            paused: false,
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

#[cfg(test)]
mod pause_tests {
    use super::*;

    /// Pause und Fortsetzen muessen dieselbe Sitzung und dieselbe
    /// Startzeit beibehalten — nur so bleiben die Sprecher-IDs gueltig
    /// (T-507).
    #[test]
    fn pause_and_resume_keep_the_session_start_time() {
        let state = AppState::default();
        let started = state.mark_started();
        assert!(started.running);
        assert!(!started.paused);
        let started_at = started.started_at.clone();

        let paused = state.mark_paused();
        assert!(paused.running, "Die Aufnahme laeuft während der Pause weiter");
        assert!(paused.paused);
        assert_eq!(paused.started_at, started_at, "Pause setzt die Startzeit nicht zurueck");

        let resumed = state.mark_resumed();
        assert!(resumed.running);
        assert!(!resumed.paused);
        assert_eq!(resumed.started_at, started_at, "Fortsetzen behaelt die Startzeit");
    }

    /// Stop beendet die Sitzung endgueltig: kein Pause-Flag, keine Startzeit.
    #[test]
    fn stop_ends_the_session_and_clears_the_pause_flag() {
        let state = AppState::default();
        state.mark_started();
        state.mark_paused();

        let stopped = state.mark_stopped();
        assert!(!stopped.running);
        assert!(!stopped.paused, "Nach Stop ist die Aufnahme nicht mehr pausiert");
        assert_eq!(stopped.started_at, None);
    }

    /// Der Status muss die Pause auch ueber get_status sichtbar machen.
    #[test]
    fn snapshot_reports_the_paused_state() {
        let state = AppState::default();
        assert!(!state.snapshot_status().paused);
        state.mark_started();
        state.mark_paused();
        assert!(state.snapshot_status().paused);
        state.mark_resumed();
        assert!(!state.snapshot_status().paused);
    }
}
