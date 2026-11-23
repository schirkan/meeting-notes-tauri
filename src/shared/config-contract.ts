export interface AzureProxyConfig {
  host: string
  port: number
  username?: string
  password?: string
}

export interface AzureConfig {
  endpoint: string
  region: string
  speechKey: string
  interimResults: boolean
  proxy?: AzureProxyConfig
}

export interface DiarizationSettings {
  mic: boolean
  speaker: boolean
}

/**
 * Which audio sources are transcribed. Independent of the diarization
 * settings: a source can be transcribed without speaker recognition, and
 * diarization can be switched off for a source that is still transcribed.
 */
export interface TranscriptionSettings {
  mic: boolean
  speaker: boolean
}

export interface MarkdownExportSettings {
  enabled: boolean
  path: string | null
}

export interface TranscriptSettings {
  markdownExport: MarkdownExportSettings
}

/**
 * Automatic recording start when a meeting is detected (T-513).
 *
 * Start and matching session-end stop are enabled by default from v0.1.2.
 * Explicitly saved false values remain false.
 */
export interface AutoStartSettings {
  enabled: boolean
  /** Process names that count as a meeting. Empty: the built-in default list. */
  processes: string[]
  /** End an automatically started recording when the meeting session ends. */
  autoStop: boolean
}

export interface WindowSettings {
  /** Hide the main window on close; explicit tray Quit always exits. Default true. */
  minimizeToTrayOnClose: boolean
  /** Omit the main window from the Windows taskbar. Default true. */
  hideFromTaskbar: boolean
}

export interface UserSettings {
  language: string
  transcription: TranscriptionSettings
  diarization: DiarizationSettings
  devices: {
    micId: string | null
    speakerLoopbackId: string | null
  }
  transcript: TranscriptSettings
  autoStart: AutoStartSettings
  window: WindowSettings
}

/** Shape of the single on-disk configuration file. */
export interface AppConfig {
  azure: AzureConfig | null
  user: UserSettings
}

export interface AppConfigState {
  exists: boolean
  path: string
  config: AzureConfig | null
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  language: 'de-DE',
  transcription: { mic: true, speaker: true },
  diarization: { mic: true, speaker: true },
  devices: {
    micId: null,
    speakerLoopbackId: null
  },
  transcript: {
    markdownExport: { enabled: true, path: null }
  },
  autoStart: { enabled: true, processes: [], autoStop: true },
  window: { minimizeToTrayOnClose: true, hideFromTaskbar: true }
}

const BCP47_PATTERN = /^[a-z]{2,3}-[A-Z]{2}$/

export function isValidBcp47Language(input: unknown): input is string {
  return typeof input === 'string' && BCP47_PATTERN.test(input.trim())
}

type UserSettingsInput = Partial<Omit<UserSettings, 'devices' | 'transcription' | 'diarization' | 'transcript' | 'autoStart' | 'window'>> & {
  devices?: Partial<UserSettings['devices']> | null
  transcription?: Partial<TranscriptionSettings> | null
  diarization?: Partial<DiarizationSettings> | null
  transcript?: Partial<TranscriptSettings> & {
    markdownExport?: Partial<MarkdownExportSettings> | null
  } | null
  autoStart?: Partial<AutoStartSettings> | null
  window?: Partial<WindowSettings> | null
}

export function normalizeUserSettings(input: UserSettingsInput | null | undefined): UserSettings {
  const language = input?.language?.trim()
  const safeLanguage = language && BCP47_PATTERN.test(language) ? language : DEFAULT_USER_SETTINGS.language

  return {
    language: safeLanguage,
    transcription: {
      mic:
        typeof input?.transcription?.mic === 'boolean'
          ? input.transcription.mic
          : DEFAULT_USER_SETTINGS.transcription.mic,
      speaker:
        typeof input?.transcription?.speaker === 'boolean'
          ? input.transcription.speaker
          : DEFAULT_USER_SETTINGS.transcription.speaker
    },
    diarization: {
      mic: typeof input?.diarization?.mic === 'boolean' ? input.diarization.mic : DEFAULT_USER_SETTINGS.diarization.mic,
      speaker: typeof input?.diarization?.speaker === 'boolean' ? input.diarization.speaker : DEFAULT_USER_SETTINGS.diarization.speaker
    },
    devices: {
      micId: input?.devices?.micId ?? DEFAULT_USER_SETTINGS.devices.micId,
      speakerLoopbackId: input?.devices?.speakerLoopbackId ?? DEFAULT_USER_SETTINGS.devices.speakerLoopbackId
    },
    transcript: {
      markdownExport: {
        enabled:
          typeof input?.transcript?.markdownExport?.enabled === 'boolean'
            ? input.transcript.markdownExport.enabled
            : DEFAULT_USER_SETTINGS.transcript.markdownExport.enabled,
        path:
          typeof input?.transcript?.markdownExport?.path === 'string' &&
          input.transcript.markdownExport.path.trim().length > 0
            ? input.transcript.markdownExport.path.trim()
            : null
      }
    },
    autoStart: {
      enabled:
        typeof input?.autoStart?.enabled === 'boolean'
          ? input.autoStart.enabled
          : DEFAULT_USER_SETTINGS.autoStart.enabled,
      processes: Array.isArray(input?.autoStart?.processes)
        ? input.autoStart.processes
            .filter((name): name is string => typeof name === 'string')
            .map((name) => name.trim())
            .filter((name) => name.length > 0)
        : DEFAULT_USER_SETTINGS.autoStart.processes,
      autoStop:
        typeof input?.autoStart?.autoStop === 'boolean'
          ? input.autoStart.autoStop
          : DEFAULT_USER_SETTINGS.autoStart.autoStop
    },
    window: {
      minimizeToTrayOnClose: typeof input?.window?.minimizeToTrayOnClose === 'boolean'
        ? input.window.minimizeToTrayOnClose
        : DEFAULT_USER_SETTINGS.window.minimizeToTrayOnClose,
      hideFromTaskbar: typeof input?.window?.hideFromTaskbar === 'boolean'
        ? input.window.hideFromTaskbar
        : DEFAULT_USER_SETTINGS.window.hideFromTaskbar
    }
  }
}

export interface UserSettingsValidation {
  valid: boolean
  warnings: string[]
}

export function validateUserSettings(settings: UserSettings): UserSettingsValidation {
  const warnings: string[] = []

  if (!isValidBcp47Language(settings.language)) {
    warnings.push(
      `Invalid language code "${settings.language}" (expected BCP-47, e.g. "de-DE"). Falling back to "${DEFAULT_USER_SETTINGS.language}" `
    )
  }

  return { valid: warnings.length === 0, warnings }
}

export function validateAzureConfig(input: unknown): input is AzureConfig {
  if (!input || typeof input !== 'object') return false
  const candidate = input as Partial<AzureConfig>

  const hasRequiredStrings =
    typeof candidate.endpoint === 'string' && candidate.endpoint.length > 0 &&
    typeof candidate.region === 'string' && candidate.region.length > 0 &&
    typeof candidate.speechKey === 'string' && candidate.speechKey.length > 0

  const hasValidProxy = (() => {
    if (candidate.proxy == null) return true
    if (typeof candidate.proxy !== 'object') return false

    const proxy = candidate.proxy as Partial<AzureProxyConfig>

    return typeof proxy.host === 'string' && proxy.host.length > 0 &&
      typeof proxy.port === 'number' && Number.isInteger(proxy.port) && proxy.port > 0 && proxy.port <= 65535 &&
      (proxy.username === undefined || typeof proxy.username === 'string') &&
      (proxy.password === undefined || typeof proxy.password === 'string')
  })()

  return hasRequiredStrings && typeof candidate.interimResults === 'boolean' && hasValidProxy
}
