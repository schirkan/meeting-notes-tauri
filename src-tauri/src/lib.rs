//! Tauri 2 entry point for Meeting Notes.
//!
//! Block 4 wires all Tauri-Commands to real implementations
//! (settings, connectivity, sidecar spawn, clipboard). The app
//! keeps an in-memory AppState for status + debug log and a cached
//! SidecarHandle so stop_recording can reach the running child.

mod autostart;
mod commands;
mod batch;
mod connectivity;
mod events;
mod latency;
mod protocol;
mod settings;
mod sidecar;
mod state;
mod tray;

use std::sync::Arc;

use tauri::{Manager, RunEvent};
use tokio::sync::Mutex;

use sidecar::SidecarHandle;
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      let _ = tray::show_main(app);
    }))
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_dialog::init())
    .manage(AppState::default())
    .manage(tray::WindowBehavior::default())
    .on_window_event(tray::on_window_event)
    .manage(commands::CaptureStartGate::default())
    .manage(Mutex::new(autostart::RecordingLifecycle::default()))
    .manage(Arc::new(Mutex::new(None::<SidecarHandle>)) as SidecarCache)
    .setup(|app| {
      let handle = app.handle().clone();
      let state = handle.state::<AppState>();
      let entry = state.push_debug(
        state::DebugLogEntrySource::Main,
        state::DebugLogEntryLevel::Info,
        "Meeting Notes initialized.",
      );
      events::emit_debug(&handle, &entry);

      // Beim App-Start den Azure-Config-Status melden, damit der
      // Renderer ohne Polling weiß, ob eine Konfiguration vorhanden ist.
      let config_status = tauri::async_runtime::block_on(async {
        match settings::get_app_config_state().await {
          Ok(state) => events::FixedConfigStatus {
            exists: state.exists,
            path: state.path,
          },
          Err(_) => events::FixedConfigStatus {
            exists: false,
            path: String::new(),
          },
        }
      });
      events::emit_fixed_config_status(&handle, &config_status);

      if let Err(error) = tray::init(&handle) {
        let entry = state.push_debug(
          state::DebugLogEntrySource::Main,
          state::DebugLogEntryLevel::Warn,
          format!("The system tray is not available; closing the app exits it: {error}"),
        );
        events::emit_debug(&handle, &entry);
      }

      let window_settings = tauri::async_runtime::block_on(settings::load_user_settings())
        .map(|user| user.window)
        .unwrap_or_default();
      tray::apply_window_settings(&handle, &window_settings);

      // T-513: Erkennungsmodus starten, wenn der Auto-Start aktiviert
      // ist. Der Prozess beobachtet nur die Audiositzungen und startet
      // die Aufnahme, sobald ein Meeting erkannt wird.
      if let Err(error) = tauri::async_runtime::block_on(start_detector_if_enabled(
        &handle,
      )) {
        let entry = state.push_debug(
          state::DebugLogEntrySource::Main,
          state::DebugLogEntryLevel::Warn,
          format!("Meeting detection is not available: {error}"),
        );
        events::emit_debug(&handle, &entry);
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::toggle_devtools,
      commands::open_repository,
      commands::start_recording,
      commands::show_silence_warning,
      batch::pick_batch_audio,
      batch::inspect_batch_audio,
      batch::transcribe_batch_audio,
      commands::stop_recording,
      commands::pause_recording,
      commands::resume_recording,
      commands::reset_transcript,
      commands::get_status,
      commands::get_debug_log,
      commands::clear_debug_log,
      commands::get_devices,
      commands::get_user_settings,
      commands::save_user_settings,
      commands::get_app_config,
      commands::save_fixed_config,
      commands::save_transcript_markdown,
      tray::complete_quit_export,
      commands::test_azure_connectivity,
    ])
    .build(tauri::generate_context!())
    .expect("error while running Meeting Notes")
    .run(|app_handle, event| match event {
      RunEvent::ExitRequested { .. } | RunEvent::Exit => {
        // T-513: Den Erkennungsprozess mit beenden.
        if let Some(detector) = app_handle.try_state::<autostart::DetectorHandle>() {
          let handle = detector.inner().clone();
          tauri::async_runtime::block_on(autostart::stop_detector(handle));
        }
        let cache = app_handle.state::<SidecarCache>();
        let inner = cache.inner().clone();
        tauri::async_runtime::block_on(async move {
          let mut guard = inner.lock().await;
          if let Some(handle) = guard.take() {
            let _ = sidecar::stop(handle).await;
          }
        });
      }
      _ => {}
    });
}

/// Wrapper alias so `manage()` registers a stable type.
type SidecarCache = Arc<Mutex<Option<SidecarHandle>>>;

/// Startet den Erkennungsmodus, wenn der Auto-Start aktiviert ist.
///
/// Der Erkennungsprozess laeuft unabhaengig von der Aufnahme. Kommt eine
/// Erkennung herein, wird die Aufnahme gestartet - aber nur, wenn:
/// der Auto-Start aktiviert ist, die Azure-Konfiguration vollstaendig ist und
/// noch keine Aufnahme laeuft.
async fn start_detector_if_enabled(app: &tauri::AppHandle) -> Result<(), String> {
    let user = match settings::load_user_settings().await {
        Ok(user) => user,
        Err(error) => return Err(error.to_string()),
    };
    if !user.auto_start.enabled {
        return Ok(());
    }

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let end_tx = tx.clone();
    let detected_handle = app.clone();
    let detector = autostart::start_detector(
        app,
        &user.auto_start.processes,
        move |payload| {
            let gate = detected_handle.state::<commands::CaptureStartGate>();
            if !enqueue_meeting_start(&gate, &tx, payload) {
                log_skipped_meeting_start(&detected_handle);
            }
        },
        move |payload| { let _ = end_tx.send(autostart::DetectionEvent::Ended(payload)); },
    ).await?;

    // Preserve detector event order: an old end must not overtake a new start.
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                autostart::DetectionEvent::Started(payload) => start_recording_on_detection(&handle, payload).await,
                autostart::DetectionEvent::Ended(payload) => stop_recording_on_meeting_end(&handle, payload).await,
            }
        }
    });
    app.manage(detector);
    Ok(())
}

fn enqueue_meeting_start(
    gate: &commands::CaptureStartGate,
    tx: &tokio::sync::mpsc::UnboundedSender<autostart::DetectionEvent>,
    payload: autostart::MeetingDetectedPayload,
) -> bool {
    // Skip at ingestion, not just on dispatch: the ordered consumer may be
    // finishing a preceding recording while the connection test runs.
    if gate.is_busy() {
        return false;
    }
    let _ = tx.send(autostart::DetectionEvent::Started(payload));
    true
}

fn log_skipped_meeting_start(app: &tauri::AppHandle) {
    let entry = app.state::<AppState>().push_debug(
        state::DebugLogEntrySource::Main,
        state::DebugLogEntryLevel::Info,
        "Meeting detected, but a connection test or another recording operation is in progress. Automatic start skipped.",
    );
    events::emit_debug(app, &entry);
}

/// Beendet die automatisch gestartete Aufnahme, weil das Meeting
/// vorbei ist. Das Ende kommt aus dem Session-Graph: die Audiositzung des
/// Meeting-Prozesses wechselt auf Inactive.
async fn stop_recording_on_meeting_end(
    app: &tauri::AppHandle,
    payload: autostart::MeetingEndedPayload,
) {
    match commands::stop_recording_for_meeting(app, &payload).await {
        Ok(true) => {
            let entry = app.state::<AppState>().push_debug(
                state::DebugLogEntrySource::Main,
                state::DebugLogEntryLevel::Info,
                format!("Audio sessions of {} ended; the automatic transcription was stopped.", payload.process_name),
            );
            events::emit_debug(app, &entry);
            events::emit_meeting_ended(app, &payload);
        }
        Ok(false) => {} // Manual recording, another process, or disabled automation.
        Err(error) => {
            let entry = app.state::<AppState>().push_debug(
                state::DebugLogEntrySource::Main,
                state::DebugLogEntryLevel::Error,
                format!("Could not stop the automatic transcription: {error}"),
            );
            events::emit_debug(app, &entry);
        }
    }
}

/// Startet die Aufnahme, weil ein Meeting erkannt wurde.
async fn start_recording_on_detection(
    app: &tauri::AppHandle,
    payload: autostart::MeetingDetectedPayload,
) {
    let state = app.state::<AppState>();
    let description = autostart::describe_detection(&payload);

    // Kein zweiter Start, solange eine Aufnahme laeuft.
    if state.snapshot_status().running {
        let entry = state.push_debug(
            state::DebugLogEntrySource::Main,
            state::DebugLogEntryLevel::Info,
            format!("Meeting detected, but transcription is already running: {description}"),
        );
        events::emit_debug(app, &entry);
        return;
    }

    match commands::start_recording_for_meeting(app, payload).await {
        Ok(true) => {
            let entry = state.push_debug(
                state::DebugLogEntrySource::Main,
                state::DebugLogEntryLevel::Info,
                format!("Meeting detected, transcription started automatically: {description}"),
            );
            events::emit_debug(app, &entry);
        }
        Ok(false) => log_skipped_meeting_start(app),
        Err(error) => {
            let entry = state.push_debug(
                state::DebugLogEntrySource::Main,
                state::DebugLogEntryLevel::Error,
                format!("Could not start the automatic transcription: {error}"),
            );
            events::emit_debug(app, &entry);
        }
    }
}

#[cfg(test)]
mod detection_tests {
    use super::*;
    use crate::autostart::{DetectionEvent, MeetingDetectedPayload, MeetingEndedPayload};

    #[tokio::test]
    async fn meeting_seen_during_probe_is_not_dispatched_after_probe_or_meeting_end() {
        let gate = commands::CaptureStartGate::default();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let meeting = MeetingDetectedPayload {
            process_name: "teams".into(),
            process_id: 123,
            signal: "mic".into(),
        };

        let probe = gate.lock().await;
        assert!(!enqueue_meeting_start(&gate, &tx, meeting.clone()));
        assert!(
            gate.try_start().is_none(),
            "dispatch cannot start capture either"
        );
        assert!(tx
            .send(DetectionEvent::Ended(MeetingEndedPayload {
                process_name: meeting.process_name.clone(),
                process_id: meeting.process_id,
                signal: meeting.signal.clone(),
            }))
            .is_ok());
        assert!(matches!(rx.try_recv().unwrap(), DetectionEvent::Ended(_)));
        drop(probe);

        assert!(matches!(
            rx.try_recv(),
            Err(tokio::sync::mpsc::error::TryRecvError::Empty)
        ));
        // A new detection (including for the same process) can start normally.
        assert!(enqueue_meeting_start(&gate, &tx, meeting));
        assert!(matches!(rx.try_recv().unwrap(), DetectionEvent::Started(_)));
    }
}
