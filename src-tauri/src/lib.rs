//! Tauri 2 entry point for meeting-notes-tauri.
//!
//! Block 4 wires all Tauri-Commands to real implementations
//! (settings, connectivity, sidecar spawn, clipboard). The app
//! keeps an in-memory AppState for status + debug log and a cached
//! SidecarHandle so stop_recording can reach the running child.

mod commands;
mod connectivity;
mod events;
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
    .manage(AppState::default())
    .manage(Arc::new(Mutex::new(None::<SidecarHandle>)) as SidecarCache)
    .setup(|app| {
      let handle = app.handle().clone();
      let state = handle.state::<AppState>();
      let entry = state.push_debug(
        state::DebugLogEntrySource::Main,
        state::DebugLogEntryLevel::Info,
        "Tauri app initialisiert.",
      );
      events::emit_debug(&handle, &entry);
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::start_recording,
      commands::stop_recording,
      commands::reset_transcript,
      commands::get_status,
      commands::get_debug_log,
      commands::clear_debug_log,
      commands::get_devices,
      commands::get_user_settings,
      commands::save_user_settings,
      commands::get_fixed_config,
      commands::save_fixed_config,
      commands::test_azure_connectivity,
    ])
    .build(tauri::generate_context!())
    .expect("error while running tauri application")
    .run(|app_handle, event| match event {
      RunEvent::ExitRequested { .. } | RunEvent::Exit => {
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
