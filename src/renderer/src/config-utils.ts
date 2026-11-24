import { hasAzureConnectionFields, isAzureSpeechModel, type AzureConfig, type AzureSpeechModel } from '../../shared/config-contract.js'

export type ConfigDraft = {
  model: AzureSpeechModel
  endpoint: string
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
    region: config?.region ?? '',
    speechKey: config?.speechKey ?? '',
    interimResults: config?.interimResults ?? true,
    proxyHost: config?.proxy?.host ?? '',
    proxyPort: config?.proxy?.port != null ? String(config.proxy.port) : '',
    proxyUsername: config?.proxy?.username ?? '',
    proxyPassword: config?.proxy?.password ?? ''
  }
}

export function draftToConfig(draft: ConfigDraft): AzureConfig {
  const endpoint = draft.endpoint.trim()
  const region = draft.region.trim()
  const speechKey = draft.speechKey.trim()

  const model = draft.model
  if (!isAzureSpeechModel(model)) {
    throw new Error('Please select a supported transcription model.')
  }
  const config: AzureConfig = { endpoint, region, speechKey, interimResults: draft.interimResults }
  if (model !== 'standard') config.model = model
  if (!hasAzureConnectionFields(config)) {
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

export function isConfigComplete(config: AzureConfig | null): boolean {
  if (!config || !hasAzureConnectionFields(config)) return false

  if (!config.proxy) {
    return true
  }

  return config.proxy.host.trim().length > 0 && Number.isInteger(config.proxy.port) && config.proxy.port > 0 && config.proxy.port <= 65535
}