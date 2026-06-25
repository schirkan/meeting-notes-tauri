//! Tauri 2 entry point for meeting-notes-tauri.
//!
//! Block 2 / T-102 + T-302 + T-303 + T-401: shared IPC contract,
//! command skeletons, event helpers, and an in-memory AppState.
//! Block 4 (T-300 / T-301 / T-304 / T-305) wires the real sidecar,
//! settings, connectivity, and clipboard logic.

mod commands;
mod events;
mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .manage(AppState::default())
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
      commands::copy_transcript,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
