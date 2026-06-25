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

export interface UserSettings {
  language: string
  devices: {
    micId: string | null
    speakerLoopbackId: string | null
  }
}

export interface ResolvedAppConfig {
  azure: AzureConfig
  user: UserSettings
}

export interface AzureConfigState {
  exists: boolean
  path: string
  config: AzureConfig | null
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  language: 'de-DE',
  devices: {
    micId: null,
    speakerLoopbackId: null
  }
}

const BCP47_PATTERN = /^[a-z]{2,3}-[A-Z]{2}$/

export function isValidBcp47Language(input: unknown): input is string {
  return typeof input === 'string' && BCP47_PATTERN.test(input.trim())
}

export function normalizeUserSettings(input: Partial<UserSettings> | null | undefined): UserSettings {
  const language = input?.language?.trim()
  const safeLanguage = language && BCP47_PATTERN.test(language) ? language : DEFAULT_USER_SETTINGS.language

  return {
    language: safeLanguage,
    devices: {
      micId: input?.devices?.micId ?? DEFAULT_USER_SETTINGS.devices.micId,
      speakerLoopbackId: input?.devices?.speakerLoopbackId ?? DEFAULT_USER_SETTINGS.devices.speakerLoopbackId
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
      typeof proxy.port === 'number' && Number.isFinite(proxy.port) && proxy.port > 0 &&
      (proxy.username === undefined || typeof proxy.username === 'string') &&
      (proxy.password === undefined || typeof proxy.password === 'string')
  })()

  return hasRequiredStrings && typeof candidate.interimResults === 'boolean' && hasValidProxy
}
