import { hasAzureConnectionFields, isAzureSpeechModel, type AzureConfig, type AzureSpeechModel } from '../../shared/config-contract.js'

export type ConfigDraft = {
  model: AzureSpeechModel
  endpoint: string
  batchEndpoint: string
  region: string
  speechKey: string
  interimResults: boolean
  proxyHost: string
  proxyPort: string
  proxyUsername: string
  proxyPassword: string
}

export function toConfigDraft(config: AzureConfig | null): ConfigDraft {
  return {
    model: config?.model ?? 'standard',
    endpoint: config?.endpoint ?? '',
    batchEndpoint: config?.batchEndpoint ?? '',
    region: config?.region ?? '',
    speechKey: config?.speechKey ?? '',
    interimResults: config?.interimResults ?? true,
    proxyHost: config?.proxy?.host ?? '',
    proxyPort: config?.proxy?.port != null ? String(config.proxy.port) : '',
    proxyUsername: config?.proxy?.username ?? '',
    proxyPassword: config?.proxy?.password ?? ''
  }
}

export function draftToConfig(draft: ConfigDraft, { allowIncomplete = false } = {}): AzureConfig {
  const endpoint = draft.endpoint.trim()
  const region = draft.region.trim()
  const speechKey = draft.speechKey.trim()

  const model = draft.model
  if (!isAzureSpeechModel(model)) {
    throw new Error('Please select a supported transcription model.')
  }
  const config: AzureConfig = { endpoint, region, speechKey, interimResults: draft.interimResults }
  const batchEndpoint = draft.batchEndpoint.trim()
  if (batchEndpoint) {
    if (!isBatchSpeechEndpoint(batchEndpoint, 'standard')) {
      throw new Error('Enter an HTTPS Azure Speech resource endpoint without a path, credentials, query, or port.')
    }
    config.batchEndpoint = batchEndpoint
  }
  if (model !== 'standard') config.model = model
  if (!allowIncomplete && !hasAzureConnectionFields(config)) {
    throw new Error(model === 'standard'
      ? 'Please fill in endpoint, region and speech key.'
      : 'Please fill in region and speech key.')
  }

  const proxyHost = draft.proxyHost.trim()
  if (!proxyHost) return config

  const proxyPort = draft.proxyPort.trim()
  if (!proxyPort) {
    throw new Error('Please enter a port for the proxy host.')
  }

  const parsedPort = Number(proxyPort)
  if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
    throw new Error('The proxy port is invalid.')
  }

  return {
    ...config,
    proxy: {
      host: proxyHost,
      port: parsedPort,
      username: draft.proxyUsername.trim() || undefined,
      password: draft.proxyPassword.trim() || undefined
    }
  }
}

export function isConfigComplete(config: AzureConfig | null, requireEndpoint = false): boolean {
  if (!config || !hasAzureConnectionFields(config) || (requireEndpoint && !config.endpoint.trim())) return false

  if (!config.proxy) {
    return true
  }

  return config.proxy.host.trim().length > 0 && Number.isInteger(config.proxy.port) && config.proxy.port > 0 && config.proxy.port <= 65535
}

export function isBatchSpeechEndpoint(endpoint: string, model: AzureSpeechModel): boolean {
  const label = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
  const suffix = model === 'standard' ? '(?:cognitiveservices\\.azure\\.com|api\\.cognitive\\.microsoft\\.com)' : 'cognitiveservices\\.azure\\.com'
  return new RegExp(`^https://${label}\\.${suffix}/?$`, 'i').test(endpoint.trim())
}