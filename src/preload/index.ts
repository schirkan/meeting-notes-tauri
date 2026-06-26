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

// ---- Clipboard copy (renderer-side) -------------------------------------
//
// WebView2 (Chromium) supports `navigator.clipboard.writeText` natively,
// so the transcript copy lives here instead of going through a Tauri
// command + Rust clipboard plugin. Behaviour mirrors the old Rust
// `copy_transcript` command byte-for-byte: filter final segments,
// prepend a German metadata header, format as `- [HH:MM:SS] speaker: text`.

function formatGermanClock(iso: string): string {
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return iso
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}.${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`
}

function formatGermanDate(iso: string): string {
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return iso
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}.${dt.getFullYear()}`
}

function formatGermanTime(iso: string): string {
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return iso
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`
}

function formatDuration(start: Date, end: Date): string {
  const secs = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000))
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

function buildTranscriptText(segments: TranscriptSegment[]): string {
  const finals = segments.filter((s) => s.state === 'final')
  const exportEnded =
    finals[finals.length - 1]?.timestampIso ?? new Date().toISOString()
  const exportStarted = finals[0]?.timestampIso ?? exportEnded

  const startDate = new Date(exportStarted)
  const endDate = new Date(exportEnded)
  const validRange = !Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime())

  const metadata = `---
datum: ${formatGermanDate(exportStarted)}
startzeit: ${formatGermanTime(exportStarted)}
dauer: ${validRange ? formatDuration(startDate, endDate) : '00:00'}
---`

  const body = finals
    .map((s) => {
      if (!s.timestampIso) return null
      const langSuffix = s.language ? ` (${s.language})` : ''
      return `- [${formatGermanClock(s.timestampIso)}] ${s.speaker}${langSuffix}: ${s.text}`
    })
    .filter((line): line is string => line !== null)

  return body.length === 0 ? metadata : `${metadata}\n\n${body.join('\n')}`
}

async function copyTranscriptToClipboard(segments: TranscriptSegment[]): Promise<void> {
  const text = buildTranscriptText(segments)
  if (!navigator.clipboard?.writeText) {
    throw new Error('Zwischenablage wird vom WebView nicht unterstützt.')
  }
  await navigator.clipboard.writeText(text)
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
  copyTranscript: (segments) => copyTranscriptToClipboard(segments),
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
