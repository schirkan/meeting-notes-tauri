import type { ConfigDraft } from '../config-utils'

type ProxyPanelProps = {
  configDraft: ConfigDraft
  disabled: boolean
  setConfigDraft: React.Dispatch<React.SetStateAction<ConfigDraft>>
}

export function ProxyPanel({ configDraft, setConfigDraft, disabled }: ProxyPanelProps) {

  return (
    <section className="panel settings">
      <div className="panel-header">
        <h2>Proxy</h2>
      </div>

      <div className="settings-block proxy-settings-grid" aria-disabled={disabled}>
        <label title="Enter the proxy server hostname or IP address. Leave blank for a direct connection.">
          Host
          <input
            type="text"
            value={configDraft.proxyHost}
            disabled={disabled}
            onChange={(event) => setConfigDraft((prev) => ({ ...prev, proxyHost: event.target.value }))}
          />
        </label>

        <label title="Enter the port on which the proxy accepts connections">
          Port
          <input
            type="number"
            min={1}
            max={65535}
            value={configDraft.proxyPort}
            disabled={disabled}
            onChange={(event) => setConfigDraft((prev) => ({ ...prev, proxyPort: event.target.value }))}
          />
        </label>

        <label title="Enter a username only if the proxy requires authentication">
          Username (optional)
          <input
            type="text"
            value={configDraft.proxyUsername}
            disabled={disabled}
            onChange={(event) => setConfigDraft((prev) => ({ ...prev, proxyUsername: event.target.value }))}
          />
        </label>

        <label title="Enter a password only if the proxy requires authentication">
          Password (optional)
          <input
            type="password"
            value={configDraft.proxyPassword}
            disabled={disabled}
            onChange={(event) => setConfigDraft((prev) => ({ ...prev, proxyPassword: event.target.value }))}
          />
        </label>
      </div>

    </section>
  )
}
