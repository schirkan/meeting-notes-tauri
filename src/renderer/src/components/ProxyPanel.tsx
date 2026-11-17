import type { ConfigDraft } from '../config-utils'

type ProxyPanelProps = {
  configDraft: ConfigDraft
  statusRunning: boolean
  setConfigDraft: React.Dispatch<React.SetStateAction<ConfigDraft>>
}

export function ProxyPanel(props: ProxyPanelProps) {
  const {
    configDraft,
    statusRunning,
    setConfigDraft
  } = props

  return (
    <section className="panel settings">
      <div className="panel-header">
        <h2>Proxy</h2>
      </div>

      <div className="settings-block proxy-settings-grid">
        <label className="checkbox-field full-field">
          <input
            type="checkbox"
            checked={configDraft.useProxy}
            onChange={(event) => {
              const useProxy = event.currentTarget.checked
              setConfigDraft((prev) => ({ ...prev, useProxy }))
            }}
            disabled={statusRunning}
          />
          <span>Proxy verwenden</span>
        </label>

        <label>
          Proxy Host
          <input
            type="text"
            value={configDraft.proxyHost}
            onChange={(event) => setConfigDraft((prev) => ({ ...prev, proxyHost: event.target.value }))}
            disabled={statusRunning || !configDraft.useProxy}
          />
        </label>

        <label>
          Proxy Port
          <input
            type="number"
            min={1}
            value={configDraft.proxyPort}
            onChange={(event) => setConfigDraft((prev) => ({ ...prev, proxyPort: event.target.value }))}
            disabled={statusRunning || !configDraft.useProxy}
          />
        </label>

        <label>
          Proxy Benutzername (optional)
          <input
            type="text"
            value={configDraft.proxyUsername}
            onChange={(event) => setConfigDraft((prev) => ({ ...prev, proxyUsername: event.target.value }))}
            disabled={statusRunning || !configDraft.useProxy}
          />
        </label>

        <label>
          Proxy Passwort (optional)
          <input
            type="password"
            value={configDraft.proxyPassword}
            onChange={(event) => setConfigDraft((prev) => ({ ...prev, proxyPassword: event.target.value }))}
            disabled={statusRunning || !configDraft.useProxy}
          />
        </label>
      </div>

    </section>
  )
}
