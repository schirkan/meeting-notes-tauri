export type TranscriptSource = 'mic' | 'speaker'
export type TranscriptState = 'interim' | 'final'

export interface TranscriptSegment {
  id: string
  /** Empty on stereo interim results without verifiable channel metadata. */
  source: TranscriptSource | ''
  speaker: string
  /**
   * Azure-Sitzung, in der das Segment entstanden ist. Azure vergibt die
   * Sprecher-IDs ("Guest-N") pro Sitzung neu, deshalb gehoeren Session und
   * Sprecher-ID untrennbar zusammen (T-507).
   */
  sessionId?: string
  language?: string
  timestampIso: string
  text: string
  state: TranscriptState
  confidence?: number
  /**
   * Latenzstufen der Kette Mikrofon -> Transkript (T-502).
   *
   * Alle Werte in Millisekunden. Die Stufen 1-3 misst der Sidecar, die
   * Pipe-Stufe (4) der Tauri-Main; `totalMs` ist die Summe bis zum
   * Tauri-Event. Die Renderer-Stufe (Paint) ist von aussen nicht messbar.
   */
  latency?: {
    /** Alter des WASAPI-Puffers beim Capture. */
    captureLatencyMs?: number
    /** Callback -> Azure-PushStream (Resampler). */
    sidecarToPushMs?: number
    /** Azure-Roundtrip -> Sidecar-Event. */
    azureToEventMs?: number
    /** Sidecar-Event -> Tauri-Main (JSON-Lines-Pipe). */
    pipeToEventMs?: number
    /** Summe bis zum Tauri-Event. */
    totalMs?: number
  }
}

export interface AudioDeviceInfo {
  id: string
  name: string
  flow: 'input' | 'output'
  isDefault: boolean
}

export interface AudioDeviceSnapshot {
  inputs: AudioDeviceInfo[]
  outputs: AudioDeviceInfo[]
  fetchedAtIso: string
}

export interface TranscriptStatus {
  running: boolean
  /** Aufnahme ist pausiert: die Azure-Sitzung lebt weiter, es wird kein Audio zugespeist. */
  paused?: boolean
  startedAt?: string
}

export interface DebugLogEntry {
  id: string
  timestampIso: string
  source: 'main' | 'sidecar' | 'ipc' | 'status'
  level: 'info' | 'warn' | 'error'
  message: string
}

export type TranscriptErrorCode =
  | 'TRANSCRIPTION_STOP_FAILED'
  | 'LOOPBACK_REQUIRED'
  | 'LOOPBACK_DEVICE_NOT_FOUND'
  | 'LOOPBACK_INIT_FAILED'
  | 'SIDECAR_START_FAILED'
  | 'SIDECAR_UNAVAILABLE'
  | 'AZURE_AUTH_FAILED'
  | 'AZURE_RECOGNIZER_FAILED'
  | 'UI_START_FAILED'
  | 'UI_STOP_FAILED'
  | 'UI_PAUSE_FAILED'
  | 'UI_RESUME_FAILED'
  | 'SETTINGS_PERSIST_FAILED'

export interface TranscriptError {
  code: TranscriptErrorCode
  message: string
}

export const TRANSCRIPT_ERROR_CATALOG: Record<
  TranscriptErrorCode,
  {
    blocker: boolean
    description: string
    recoveryHint: string
  }
> = {
  TRANSCRIPTION_STOP_FAILED: {
    blocker: false,
    description: 'The transcription service could not be stopped cleanly.',
    recoveryHint: 'Try stopping again or restart the app.'
  },
  LOOPBACK_REQUIRED: {
    blocker: true,
    description: 'Recording is not allowed without a working speaker loopback.',
    recoveryHint: 'Enable or switch the loopback device, then start again.'
  },
  LOOPBACK_DEVICE_NOT_FOUND: {
    blocker: true,
    description: 'No speaker loopback device found.',
    recoveryHint: 'Check the audio output device or configure the device explicitly.'
  },
  LOOPBACK_INIT_FAILED: {
    blocker: true,
    description: 'The speaker loopback could not be initialized.',
    recoveryHint: 'Check driver and permissions, then restart the sidecar.'
  },
  SIDECAR_START_FAILED: {
    blocker: true,
    description: 'The C# capture sidecar could not be started.',
    recoveryHint: 'Check the sidecar logs and validate the start parameters.'
  },
  SIDECAR_UNAVAILABLE: {
    blocker: true,
    description: 'The sidecar is unreachable or has already exited.',
    recoveryHint: 'Restart the sidecar and check the health status.'
  },
  AZURE_AUTH_FAILED: {
    blocker: true,
    description: 'Azure Speech authentication failed.',
    recoveryHint: 'Check the API key and region in the configuration.'
  },
  AZURE_RECOGNIZER_FAILED: {
    blocker: false,
    description: 'The recognizer reported a runtime error.',
    recoveryHint: 'Restart the transcription and check the Azure diagnostics.'
  },
  UI_START_FAILED: {
    blocker: false,
    description: 'The start was triggered in the renderer, but the main call failed.',
    recoveryHint: 'Check the error details and start again.'
  },
  UI_STOP_FAILED: {
    blocker: false,
    description: 'The stop was triggered in the renderer, but the main call failed.',
    recoveryHint: 'Try stopping again or restart the app.'
  },
  UI_PAUSE_FAILED: {
    blocker: false,
    description: 'The pause was triggered in the renderer, but the main call failed.',
    recoveryHint: 'Check the error details and pause again.'
  },
  UI_RESUME_FAILED: {
    blocker: false,
    description: 'The resume was triggered in the renderer, but the main call failed.',
    recoveryHint: 'Check the error details and resume again.'
  },
  SETTINGS_PERSIST_FAILED: {
    blocker: false,
    description: 'The settings could not be saved.',
    recoveryHint: 'Check path and file permissions, then save again.'
  }
}

/** A detected meeting that can trigger an automatic recording start (T-513). */
export interface MeetingDetected {
  processName: string
  processId: number
  /** "mic" or "speaker". */
  signal: string
}

export interface TranscriptApi {
  toggleDevtools: () => Promise<void>
  openRepository: () => Promise<void>
  start: () => Promise<TranscriptStatus>
  stop: () => Promise<TranscriptStatus>
  pause: () => Promise<TranscriptStatus>
  resume: () => Promise<TranscriptStatus>
  getStatus: () => Promise<TranscriptStatus>
  getDebugLog: () => Promise<DebugLogEntry[]>
  clearDebugLog: () => Promise<{ cleared: number }>
  getDevices: () => Promise<AudioDeviceSnapshot>
  getSettings: () => Promise<import('./config-contract').UserSettings>
  getConfig: () => Promise<import('./config-contract').AppConfigState>
  saveSettings: (settings: import('./config-contract').UserSettings) => Promise<import('./config-contract').UserSettings>
  saveConfig: (config: import('./config-contract').AzureConfig) => Promise<import('./config-contract').AppConfigState>
  reset: () => Promise<void>
  saveTranscriptMarkdown: (markdown: string) => Promise<string>
  onQuitExport: (cb: (requestId: string) => void) => () => void
  completeQuitExport: (requestId: string, error: string | null) => Promise<void>
  selectTranscriptDirectory: () => Promise<string | null>
  testAzureConnectivity: (payload?: unknown) => Promise<{
    probeUrl: string
    reachable: boolean
    httpsReachable?: boolean
    speechReachable: boolean
    httpStatus?: number
    httpStatusText?: string
    latencyMs: number
    error?: string
    steps: Array<{ step: string; status: 'ok' | 'warn' | 'error'; detail: string }>
  }>
  copyTranscript: (segments: TranscriptSegment[]) => Promise<void>
  onSegment: (cb: (segment: TranscriptSegment) => void) => () => void
  onError: (cb: (error: TranscriptError) => void) => () => void
  onStatus: (cb: (status: TranscriptStatus) => void) => () => void
  onDebugLog: (cb: (entry: DebugLogEntry) => void) => () => void
  onMeetingDetected: (cb: (detected: MeetingDetected) => void) => () => void
}
