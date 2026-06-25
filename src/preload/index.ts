// Tauri 2 bridge for the meeting-notes renderer.
//
// Block 1 / T-101: stubs the full `TranscriptApi` surface so that the
// React renderer can mount against `window.transcriptApi` without changes.
// Real command/event wiring lands in Block 2 (T-102/T-302/T-303).
//
// Pattern:
//   - Commands: `@tauri-apps/api/core` invoke() with snake_case command name
//   - Events:   `@tauri-apps/api/event` listen() returning an unsubscribe fn
//   - All methods match the `TranscriptApi` interface from @shared/transcript-contract

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  AudioDeviceSnapshot,
  DebugLogEntry,
  TranscriptApi,
  TranscriptError,
  TranscriptSegment,
  TranscriptStatus
} from '@shared/transcript-contract'
import type { AzureConfig, AzureConfigState, UserSettings } from '@shared/config-contract'

type ConnectivityResult = {
  probeUrl: string
  reachable: boolean
  httpStatus?: number
  httpStatusText?: string
  latencyMs: number
  error?: string
  steps: Array<{ step: string; status: 'ok' | 'warn' | 'error'; detail: string }>
}

const stoppedStatus = (): TranscriptStatus => ({ running: false })

const stubSettings: UserSettings = {
  language: 'de-DE',
  devices: { micId: null, speakerLoopbackId: null }
}

const stubDevices: AudioDeviceSnapshot = {
  inputs: [],
  outputs: [],
  fetchedAtIso: new Date(0).toISOString()
}

const stubConfigState: AzureConfigState = {
  exists: false,
  path: '',
  config: null
}

function notImplemented(method: string): never {
  throw new Error(`transcriptApi.${method}: not implemented yet (Block 1 stub)`)
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
  start: async () => {
    await invoke('start_recording')
    return stoppedStatus()
  },
  stop: async () => {
    await invoke('stop_recording')
    return stoppedStatus()
  },
  getStatus: () => Promise.resolve(stoppedStatus()),
  getDebugLog: () => Promise.resolve<DebugLogEntry[]>([]),
  clearDebugLog: () => Promise.resolve({ cleared: 0 }),
  getDevices: () => Promise.resolve(stubDevices),
  getSettings: () => Promise.resolve(stubSettings),
  getConfig: () => Promise.resolve(stubConfigState),
  saveSettings: () => Promise.resolve(stubSettings),
  saveConfig: () => Promise.resolve(stubConfigState),
  testAzureConnectivity: () => notImplemented('testAzureConnectivity'),
  copyTranscript: () => Promise.resolve(),
  onSegment: (cb) => subscribe<TranscriptSegment>('transcript:segment', cb),
  onError: (cb) => subscribe<TranscriptError>('transcript:error', cb),
  onStatus: (cb) => subscribe<TranscriptStatus>('transcript:status', cb),
  onDebugLog: (cb) => subscribe<DebugLogEntry>('transcript:debug', cb)
}

;(window as unknown as { transcriptApi: TranscriptApi }).transcriptApi = api

export {}
