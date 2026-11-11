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

export interface MarkdownExportSettings {
  enabled: boolean
  path: string | null
}

export interface TranscriptSettings {
  markdownExport: MarkdownExportSettings
}

export interface UserSettings {
  language: string
  diarization: DiarizationSettings
  devices: {
    micId: string | null
    speakerLoopbackId: string | null
  }
  transcript: TranscriptSettings
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
  diarization: { mic: true, speaker: true },
  devices: {
    micId: null,
    speakerLoopbackId: null
  },
  transcript: {
    markdownExport: { enabled: true, path: null }
  }
}

const BCP47_PATTERN = /^[a-z]{2,3}-[A-Z]{2}$/

export function isValidBcp47Language(input: unknown): input is string {
  return typeof input === 'string' && BCP47_PATTERN.test(input.trim())
}

type UserSettingsInput = Partial<Omit<UserSettings, 'devices' | 'diarization' | 'transcript'>> & {
  devices?: Partial<UserSettings['devices']> | null
  diarization?: Partial<DiarizationSettings> | null
  transcript?: Partial<TranscriptSettings> & {
    markdownExport?: Partial<MarkdownExportSettings> | null
  } | null
}

export function normalizeUserSettings(input: UserSettingsInput | null | undefined): UserSettings {
  const language = input?.language?.trim()
  const safeLanguage = language && BCP47_PATTERN.test(language) ? language : DEFAULT_USER_SETTINGS.language

  return {
    language: safeLanguage,
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
      `Ungültiger Sprachcode "${settings.language}" (erwartet BCP-47, z. B. "de-DE"). Es wird auf "${DEFAULT_USER_SETTINGS.language}" zurückgefallen.`
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
