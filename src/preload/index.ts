// Tauri 2 bridge for the meeting-notes renderer.
//
// Each method maps 1:1 to a `#[tauri::command]` in src-tauri (see
// src/shared/tauri-contract.ts for the single-source-of-truth name list).
// Commands land in src-tauri/src/commands.rs over Blocks 2–4; until a
// command is implemented, Tauri rejects the invoke call and the bridge
// propagates the error message to the renderer so UI tests can be done
// in isolation.

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import {
  TAURI_COMMANDS,
  TAURI_EVENTS,
  type SidecarCrashedPayload
} from '@shared/tauri-contract'
import type {
  AudioDeviceSnapshot,
  DebugLogEntry,
  TranscriptApi,
  TranscriptError,
  TranscriptSegment,
  TranscriptStatus
} from '@shared/transcript-contract'
import type { AzureConfig, AzureConfigState, UserSettings } from '@shared/config-contract'

export type ConnectivityResult = {
  probeUrl: string
  reachable: boolean
  httpStatus?: number
  httpStatusText?: string
  latencyMs: number
  error?: string
  steps: Array<{ step: string; status: 'ok' | 'warn' | 'error'; detail: string }>
}

function subscribe<T>(event: string, cb: (payload: T) => void): () => void {
  let unlisten: UnlistenFn | undefined
  void listen<T>(event, (e) => cb(e.payload)).then((u) => {
    unlisten = u
  })
  return () => {
    unlisten?.()
  }
}

const api: TranscriptApi = {
  start: () => invoke<TranscriptStatus>(TAURI_COMMANDS.startRecording),
  stop: () => invoke<TranscriptStatus>(TAURI_COMMANDS.stopRecording),
  getStatus: () => invoke<TranscriptStatus>(TAURI_COMMANDS.getStatus),
  getDebugLog: () => invoke<DebugLogEntry[]>(TAURI_COMMANDS.getDebugLog),
  clearDebugLog: () =>
    invoke<{ cleared: number }>(TAURI_COMMANDS.clearDebugLog),
  getDevices: () =>
    invoke<AudioDeviceSnapshot>(TAURI_COMMANDS.getDevices),
  getSettings: () =>
    invoke<UserSettings>(TAURI_COMMANDS.getUserSettings),
  getConfig: () =>
    invoke<AzureConfigState>(TAURI_COMMANDS.getFixedConfig),
  saveSettings: (settings) =>
    invoke<UserSettings>(TAURI_COMMANDS.saveUserSettings, { settings }),
  saveConfig: (config) =>
    invoke<AzureConfigState>(TAURI_COMMANDS.saveFixedConfig, { config }),
  testAzureConnectivity: (payload) =>
    invoke<ConnectivityResult>(TAURI_COMMANDS.testAzureConnectivity, { payload }),
  copyTranscript: (segments) =>
    invoke<void>(TAURI_COMMANDS.copyTranscript, { segments }),
  onSegment: (cb) =>
    subscribe<TranscriptSegment>(TAURI_EVENTS.segment, cb),
  onError: (cb) =>
    subscribe<TranscriptError>(TAURI_EVENTS.error, cb),
  onStatus: (cb) =>
    subscribe<TranscriptStatus>(TAURI_EVENTS.status, cb),
  onDebugLog: (cb) =>
    subscribe<DebugLogEntry>(TAURI_EVENTS.debug, cb)
}

// Sidecar crash event is not part of TranscriptApi (it's a Tauri-internal
// event the renderer can also subscribe to). Expose it for completeness.
;(window as unknown as { transcriptApi: TranscriptApi; transcriptSidecar: { onCrashed: (cb: (p: SidecarCrashedPayload) => void) => () => void } }).transcriptSidecar = {
  onCrashed: (cb) => subscribe<SidecarCrashedPayload>(TAURI_EVENTS.sidecarCrashed, cb)
}

;(window as unknown as { transcriptApi: TranscriptApi }).transcriptApi = api

export {}
