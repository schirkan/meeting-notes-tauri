// Single-source-of-truth for Tauri command + event names.
//
// Both the renderer (via the preload bridge) and the Rust main process
// import these constants. Adding a command here forces both sides to stay
// in sync — no string drift between `invoke('foo')` and `#[tauri::command] fn foo`.

export const TAURI_COMMANDS = {
  startRecording: 'start_recording',
  stopRecording: 'stop_recording',
  resetTranscript: 'reset_transcript',
  getStatus: 'get_status',
  getDebugLog: 'get_debug_log',
  clearDebugLog: 'clear_debug_log',
  getDevices: 'get_devices',
  getUserSettings: 'get_user_settings',
  saveUserSettings: 'save_user_settings',
  getFixedConfig: 'get_fixed_config',
  saveFixedConfig: 'save_fixed_config',
  testAzureConnectivity: 'test_azure_connectivity',
  copyTranscript: 'copy_transcript'
} as const

export type TauriCommand = (typeof TAURI_COMMANDS)[keyof typeof TAURI_COMMANDS]

export const TAURI_EVENTS = {
  segment: 'transcript:segment',
  status: 'transcript:status',
  error: 'transcript:error',
  debug: 'transcript:debug',
  sidecarCrashed: 'sidecar:crashed'
} as const

export type TauriEventName = (typeof TAURI_EVENTS)[keyof typeof TAURI_EVENTS]

export interface SidecarCrashedPayload {
  exitCode: number | null
  lastError?: string
}
