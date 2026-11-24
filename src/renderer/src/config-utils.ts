import type { AzureConfig } from '@shared/config-contract'

export type ConfigDraft = {
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

  if (!endpoint || !region || !speechKey) {
    throw new Error('Please fill in endpoint, region and speech key.')
  }

  const proxyHost = draft.proxyHost.trim()

  if (!proxyHost) {
    return {
      endpoint,
      region,
      speechKey,
      interimResults: draft.interimResults
    }
  }

  const proxyPort = draft.proxyPort.trim()
  if (!proxyPort) {
    throw new Error('Please enter a port for the proxy host.')
  }

  const parsedPort = Number(proxyPort)
  if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
    throw new Error('The proxy port is invalid.')
  }

  return {
    endpoint,
    region,
    speechKey,
    interimResults: draft.interimResults,
    proxy: {
      host: proxyHost,
      port: parsedPort,
      username: draft.proxyUsername.trim() || undefined,
      password: draft.proxyPassword.trim() || undefined
    }
  }
}

export function isConfigComplete(config: AzureConfig | null): boolean {
  if (!config) {
    return false
  }

  if (!config.endpoint.trim() || !config.region.trim() || !config.speechKey.trim()) {
    return false
  }

  if (!config.proxy) {
    return true
  }

  return config.proxy.host.trim().length > 0 && Number.isInteger(config.proxy.port) && config.proxy.port > 0 && config.proxy.port <= 65535
}