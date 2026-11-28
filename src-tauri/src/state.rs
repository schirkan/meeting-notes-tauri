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
    stop_error: Option<String>,
    recording: Option<crate::events::BatchRecording>,
    debug_log: Vec<DebugLogEntry>,
    /// T-201: Zahl der fehlerhaften JSON-Zeilen aus dem Sidecar.
    malformed_lines: u64,
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
    /// T-201: Rate-Limit fuer Malformed-Lines.
    ///
    /// Die erste fehlerhafte Zeile wird immer geloggt, danach nur jede
    /// 1000. (Spec: max. 1/1000). Gibt die Gesamtzahl zurueck, wenn
    /// geloggt werden soll, sonst None.
    pub fn note_malformed_line(&self) -> Option<u64> {
        let mut inner = self.inner.lock().expect("AppState mutex poisoned");
        inner.malformed_lines += 1;
        let count = inner.malformed_lines;
        if count == 1 || count % 1000 == 0 {
            Some(count)
        } else {
            None
        }
    }

    pub fn snapshot_status(&self) -> TranscriptStatus {
        let inner = self.inner.lock().expect("AppState mutex poisoned");
        TranscriptStatus {
            running: inner.running,
            paused: inner.paused,
            started_at: inner.started_at.clone(),
            recording: inner.recording.clone(),
        }
    }

    pub fn mark_started(&self) -> TranscriptStatus {
        self.mark_started_at(None)
    }

    pub fn mark_started_at(&self, requested_start: Option<&str>) -> TranscriptStatus {
        let mut inner = self.inner.lock().expect("AppState mutex poisoned");
        let started_at = requested_start.map(str::to_owned).unwrap_or_else(|| Utc::now().to_rfc3339());
        inner.running = true;
        inner.paused = false;
        inner.started_at = Some(started_at.clone());
        inner.stop_error = None;
        inner.recording = None;
        TranscriptStatus {
            running: true,
            paused: false,
            started_at: Some(started_at),
            recording: None,
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
            recording: None,
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
            recording: None,
        }
    }

    pub fn has_stop_error(&self) -> bool {
        self.inner.lock().expect("AppState mutex poisoned").stop_error.is_some()
    }

    pub fn take_stop_error(&self) -> Option<String> {
        self.inner.lock().expect("AppState mutex poisoned").stop_error.take()
    }

    #[cfg(test)]
    pub fn mark_stopped(&self) -> TranscriptStatus {
        self.mark_stopped_with_error(None)
    }

    pub fn mark_stopped_with_error(&self, error: Option<String>) -> TranscriptStatus {
        self.finish_recording(error, None)
    }

    pub fn finish_recording(&self, error: Option<String>, recording: Option<crate::events::BatchRecording>) -> TranscriptStatus {
        let mut inner = self.inner.lock().expect("AppState mutex poisoned");
        if error.is_some() { inner.stop_error = error; }
        inner.running = false;
        inner.paused = false;
        inner.started_at = None;
        inner.recording = recording.clone();
        TranscriptStatus {
            running: false,
            paused: false,
            started_at: None,
            recording,
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

    #[test]
    fn confirmed_batch_recording_uses_the_click_time() {
        let state = AppState::default();
        let click = "2026-11-27T16:25:00.321+00:00";
        assert_eq!(state.mark_started_at(Some(click)).started_at.as_deref(), Some(click));
        state.mark_stopped();
        assert_ne!(state.mark_started().started_at.as_deref(), Some(click));
    }

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
        assert!(paused.running, "The recording keeps running during the pause");
        assert!(paused.paused);
        assert_eq!(paused.started_at, started_at, "The pause does not reset the start time");

        let resumed = state.mark_resumed();
        assert!(resumed.running);
        assert!(!resumed.paused);
        assert_eq!(resumed.started_at, started_at, "Resuming keeps the start time");
    }

    #[test]
    fn unclean_stop_survives_the_idle_transition_until_reported_or_restarted() {
        let state = AppState::default();
        state.mark_started();
        assert!(!state.mark_stopped_with_error(Some("child exited".into())).running);
        state.mark_stopped();
        assert!(state.has_stop_error());
        assert_eq!(state.take_stop_error().as_deref(), Some("child exited"));
        assert_eq!(state.take_stop_error(), None, "a retry can export the partial transcript");

        state.mark_stopped_with_error(Some("previous failure".into()));
        state.mark_started();
        assert!(!state.has_stop_error(), "a new session must not inherit an old failure");
    }

    /// Stop beendet die Sitzung endgueltig: kein Pause-Flag, keine Startzeit.
    #[test]
    fn stop_ends_the_session_and_clears_the_pause_flag() {
        let state = AppState::default();
        state.mark_started();
        state.mark_paused();

        let stopped = state.mark_stopped();
        assert!(!stopped.running);
        assert!(!stopped.paused, "After the stop the recording is no longer paused");
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
