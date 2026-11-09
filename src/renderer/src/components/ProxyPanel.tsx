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

      <div className="settings-block">
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={configDraft.useProxy}
            onChange={(event) => setConfigDraft((prev) => ({ ...prev, useProxy: event.target.checked }))}
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

      <p className="settings-inline-hint">Proxy-Einstellungen werden mit der Azure-Konfiguration gespeichert.</p>
    </section>
  )
}
