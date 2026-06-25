export type TranscriptSource = 'mic' | 'speaker'
export type TranscriptState = 'interim' | 'final'

export interface TranscriptSegment {
  id: string
  source: TranscriptSource
  speaker: string
  language?: string
  timestampIso: string
  text: string
  state: TranscriptState
  confidence?: number
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
    description: 'Transkript-Service konnte nicht sauber gestoppt werden.',
    recoveryHint: 'Erneut stoppen oder App neu starten.'
  },
  LOOPBACK_REQUIRED: {
    blocker: true,
    description: 'Aufnahme ist ohne funktionierendes Speaker-Loopback nicht erlaubt.',
    recoveryHint: 'Loopback-Gerät aktivieren/wechseln und danach erneut starten.'
  },
  LOOPBACK_DEVICE_NOT_FOUND: {
    blocker: true,
    description: 'Kein Speaker-Loopback-Device gefunden.',
    recoveryHint: 'Audio-Ausgabegerät prüfen oder Gerät explizit konfigurieren.'
  },
  LOOPBACK_INIT_FAILED: {
    blocker: true,
    description: 'Speaker-Loopback konnte nicht initialisiert werden.',
    recoveryHint: 'Treiber/Permissions prüfen und Sidecar neu starten.'
  },
  SIDECAR_START_FAILED: {
    blocker: true,
    description: 'C#-Capture-Sidecar konnte nicht gestartet werden.',
    recoveryHint: 'Sidecar-Logs prüfen und Startparameter validieren.'
  },
  SIDECAR_UNAVAILABLE: {
    blocker: true,
    description: 'Sidecar ist nicht erreichbar oder bereits beendet.',
    recoveryHint: 'Sidecar neu starten und Health-Status prüfen.'
  },
  AZURE_AUTH_FAILED: {
    blocker: true,
    description: 'Azure-Speech-Authentifizierung fehlgeschlagen.',
    recoveryHint: 'API-Key/Region in der Konfiguration prüfen.'
  },
  AZURE_RECOGNIZER_FAILED: {
    blocker: false,
    description: 'Recognizer hat einen Laufzeitfehler gemeldet.',
    recoveryHint: 'Transkription neu starten und Azure-Diagnose prüfen.'
  },
  UI_START_FAILED: {
    blocker: false,
    description: 'Start wurde im Renderer ausgelöst, aber Main-Call ist fehlgeschlagen.',
    recoveryHint: 'Fehlerdetails prüfen und erneut starten.'
  },
  UI_STOP_FAILED: {
    blocker: false,
    description: 'Stop wurde im Renderer ausgelöst, aber Main-Call ist fehlgeschlagen.',
    recoveryHint: 'Erneut stoppen oder App neu starten.'
  },
  SETTINGS_PERSIST_FAILED: {
    blocker: false,
    description: 'Einstellungen konnten nicht gespeichert werden.',
    recoveryHint: 'Pfad-/Dateirechte prüfen und erneut speichern.'
  }
}

export interface TranscriptApi {
  start: () => Promise<TranscriptStatus>
  stop: () => Promise<TranscriptStatus>
  getStatus: () => Promise<TranscriptStatus>
  getDebugLog: () => Promise<DebugLogEntry[]>
  clearDebugLog: () => Promise<{ cleared: number }>
  getDevices: () => Promise<AudioDeviceSnapshot>
  getSettings: () => Promise<import('./config-contract').UserSettings>
  getConfig: () => Promise<import('./config-contract').AzureConfigState>
  saveSettings: (settings: import('./config-contract').UserSettings) => Promise<import('./config-contract').UserSettings>
  saveConfig: (config: import('./config-contract').AzureConfig) => Promise<import('./config-contract').AzureConfigState>
  testAzureConnectivity: (payload?: unknown) => Promise<{
    probeUrl: string
    reachable: boolean
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
}
