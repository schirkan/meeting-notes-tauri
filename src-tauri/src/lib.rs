//! Tauri 2 entry point for meeting-notes-tauri.
//!
//! Block 1 / T-101: stub. Provides the minimum scaffolding required for
//! `npm run tauri dev` to open a window and exercise a command roundtrip.
//! Real commands (start/stop recording, settings, connectivity) and the
//! sidecar orchestration are introduced in Block 2 (IPC) and Block 4.

#[tauri::command]
fn start_recording() -> Result<(), String> {
  println!("start_recording called (stub)");
  Ok(())
}

#[tauri::command]
fn stop_recording() -> Result<(), String> {
  println!("stop_recording called (stub)");
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .invoke_handler(tauri::generate_handler![start_recording, stop_recording])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
