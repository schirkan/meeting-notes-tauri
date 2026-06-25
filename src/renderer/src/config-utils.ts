import type { AzureConfig } from '@shared/config-contract'

export type ConfigDraft = {
  endpoint: string
  region: string
  speechKey: string
  interimResults: boolean
  useProxy: boolean
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
    useProxy: !!config?.proxy,
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
    throw new Error('Bitte Endpoint, Region und Speech Key ausfüllen.')
  }

  const proxyPort = draft.proxyPort.trim()

  if (!draft.useProxy) {
    return {
      endpoint,
      region,
      speechKey,
      interimResults: draft.interimResults
    }
  }

  if (!draft.proxyHost.trim() || !proxyPort) {
    throw new Error('Proxy ist aktiv. Bitte Host und Port ausfüllen.')
  }

  const parsedPort = Number(proxyPort)
  if (!Number.isFinite(parsedPort) || parsedPort <= 0) {
    throw new Error('Proxy-Port ist ungültig.')
  }

  return {
    endpoint,
    region,
    speechKey,
    interimResults: draft.interimResults,
    proxy: {
      host: draft.proxyHost.trim(),
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

  return config.proxy.host.trim().length > 0 && Number.isFinite(config.proxy.port) && config.proxy.port > 0
}