//! Tauri 2 entry point for Meeting Notes.
//!
//! Block 4 wires all Tauri-Commands to real implementations
//! (settings, connectivity, sidecar spawn, clipboard). The app
//! keeps an in-memory AppState for status + debug log and a cached
//! SidecarHandle so stop_recording can reach the running child.

mod autostart;
mod commands;
mod connectivity;
mod events;
mod latency;
mod protocol;
mod settings;
mod sidecar;
mod state;

use std::sync::Arc;

use tauri::{Manager, RunEvent};
use tokio::sync::Mutex;

use sidecar::SidecarHandle;
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_dialog::init())
    .manage(AppState::default())
    .manage(Arc::new(Mutex::new(None::<SidecarHandle>)) as SidecarCache)
    .setup(|app| {
      let handle = app.handle().clone();
      let state = handle.state::<AppState>();
      let entry = state.push_debug(
        state::DebugLogEntrySource::Main,
        state::DebugLogEntryLevel::Info,
        "Meeting Notes initialisiert.",
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

      // T-513: Erkennungsmodus starten, wenn der Auto-Start aktiviert
      // ist. Der Prozess beobachtet nur die Audiositzungen und startet
      // die Aufnahme, sobald ein Meeting erkannt wird.
      if let Err(error) = tauri::async_runtime::block_on(start_detector_if_enabled(
        &handle,
      )) {
        let entry = state.push_debug(
          state::DebugLogEntrySource::Main,
          state::DebugLogEntryLevel::Warn,
          format!("Meeting-Erkennung nicht verfuegbar: {error}"),
        );
        events::emit_debug(&handle, &entry);
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::toggle_devtools,
      commands::start_recording,
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

    let handle = app.clone();
    let detector = autostart::start_detector(app, &user.auto_start.processes, move |payload| {
        let handle = handle.clone();
        tauri::async_runtime::spawn(async move {
            start_recording_on_detection(&handle, payload).await;
        });
    })
    .await?;

    app.manage(detector);
    Ok(())
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
            format!("Meeting erkannt, aber es laeuft bereits eine Aufnahme: {description}"),
        );
        events::emit_debug(app, &entry);
        return;
    }

    // Ohne vollstaendige Azure-Konfiguration gibt es keinen Start.
    match settings::load_azure_config().await {
        Ok(Some(_)) => {}
        Ok(None) => {
            let entry = state.push_debug(
                state::DebugLogEntrySource::Main,
                state::DebugLogEntryLevel::Warn,
                format!("Meeting erkannt, aber die Azure-Konfiguration fehlt: {description}"),
            );
            events::emit_debug(app, &entry);
            return;
        }
        Err(error) => {
            let entry = state.push_debug(
                state::DebugLogEntrySource::Main,
                state::DebugLogEntryLevel::Error,
                format!("Meeting erkannt, Konfiguration nicht lesbar: {error}"),
            );
            events::emit_debug(app, &entry);
            return;
        }
    }

    let entry = state.push_debug(
        state::DebugLogEntrySource::Main,
        state::DebugLogEntryLevel::Info,
        format!("Meeting erkannt, Aufnahme startet automatisch: {description}"),
    );
    events::emit_debug(app, &entry);

    // Der Renderer bekommt die Erkennung fuer die Anzeige.
    events::emit_meeting_detected(app, &payload);

    let state = app.state::<AppState>();
    if let Err(error) = commands::start_recording(app.clone(), state).await {
        let entry = app.state::<AppState>().push_debug(
            state::DebugLogEntrySource::Main,
            state::DebugLogEntryLevel::Error,
            format!("Automatischer Aufnahmestart fehlgeschlagen: {error}"),
        );
        events::emit_debug(app, &entry);
    }
}
