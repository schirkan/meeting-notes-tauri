import type { AzureConfigState } from '@shared/config-contract'
import type { ConfigDraft } from '../config-utils'

type ConnectivityResult = {
  reachable: boolean
  httpStatus?: number
  httpStatusText?: string
  latencyMs: number
  error?: string
  probeUrl?: string
  testedAtIso: string
  steps: Array<{ step: string; status: 'ok' | 'warn' | 'error'; detail: string }>
}

type ConfigPanelProps = {
  configState: AzureConfigState | null
  configDraft: ConfigDraft
  statusRunning: boolean
  setConfigDraft: React.Dispatch<React.SetStateAction<ConfigDraft>>
  onSaveConfig: () => Promise<void>
  onTestConnectivity: () => Promise<void>
  isTestingConnectivity: boolean
  connectivityResult: ConnectivityResult | null
}

export function ConfigPanel(props: ConfigPanelProps) {
  const {
    configState,
    configDraft,
    statusRunning,
    setConfigDraft,
    onSaveConfig,
    onTestConnectivity,
    isTestingConnectivity,
    connectivityResult
  } = props

  const formatTestedAt = (iso: string) =>
    new Date(iso).toLocaleString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })

  return (
    <section className="panel settings">
      <div className="panel-header">
        <h2>Azure-Konfiguration</h2>
      </div>

      {!configState?.exists && (
        <div className="settings-inline-hint">
          Keine gültige <code>config/azure.json</code> gefunden. Bitte jetzt anlegen.
        </div>
      )}

      <div className="settings-block">
        <label>
          Endpoint
          <input
            type="text"
            value={configDraft.endpoint}
            onChange={(event) => setConfigDraft((prev) => ({ ...prev, endpoint: event.target.value }))}
            placeholder="https://..."
            disabled={statusRunning}
          />
        </label>

        <label>
          Region
          <input
            type="text"
            value={configDraft.region}
            onChange={(event) => setConfigDraft((prev) => ({ ...prev, region: event.target.value }))}
            placeholder="westeurope"
            disabled={statusRunning}
          />
        </label>

        <label>
          Speech Key
          <input
            type="password"
            value={configDraft.speechKey}
            onChange={(event) => setConfigDraft((prev) => ({ ...prev, speechKey: event.target.value }))}
            placeholder="Azure Speech Key"
            disabled={statusRunning}
          />
        </label>

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={configDraft.interimResults}
            onChange={(event) => setConfigDraft((prev) => ({ ...prev, interimResults: event.target.checked }))}
            disabled={statusRunning}
          />
          <span>Interim Results aktivieren</span>
        </label>

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

      <div className="settings-action-row">
        <button
          className="primary-button settings-save-button"
          type="button"
          onClick={() => void onSaveConfig()}
          disabled={statusRunning}
        >
          Azure-Konfiguration speichern
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={() => void onTestConnectivity()}
          disabled={isTestingConnectivity || !configDraft.endpoint || !configDraft.speechKey}
          title="HTTPS-Probe gegen den konfigurierten Endpoint mit dem Speech Key"
        >
          {isTestingConnectivity ? 'Teste …' : 'Verbindung testen'}
        </button>
      </div>

      {connectivityResult && (
        <div
          className={`connectivity-result ${connectivityResult.reachable ? 'connectivity-result-ok' : 'connectivity-result-error'}`}
          role="status"
        >
          {connectivityResult.reachable ? (
            <>
              <strong>Erreichbar</strong> — HTTP {connectivityResult.httpStatus} {connectivityResult.httpStatusText} in {connectivityResult.latencyMs} ms
              <div className="connectivity-result-meta">
                {connectivityResult.probeUrl}
              </div>
            </>
          ) : (
            <>
              <strong>Nicht erreichbar</strong> ({connectivityResult.latencyMs} ms)
              <div className="connectivity-result-meta">{connectivityResult.error ?? 'Unbekannter Fehler'}</div>
              {connectivityResult.probeUrl && (
                <div className="connectivity-result-meta">{connectivityResult.probeUrl}</div>
              )}
            </>
          )}
          <div className="connectivity-result-meta">
            Getestet um {formatTestedAt(connectivityResult.testedAtIso)} (lokale Zeit)
          </div>

          {connectivityResult.steps && connectivityResult.steps.length > 0 && (
            <details className="connectivity-result-steps" open={!connectivityResult.reachable}>
              <summary>Diagnose-Schritte</summary>
              <ul className="connectivity-result-step-list">
                {connectivityResult.steps.map((step, index) => (
                  <li key={`${step.step}-${index}`} className={`connectivity-result-step connectivity-result-step-${step.status}`}>
                    <span className="connectivity-result-step-icon" aria-hidden="true">
                      {step.status === 'ok' ? '✓' : step.status === 'warn' ? '⚠' : '✗'}
                    </span>
                    <span className="connectivity-result-step-name">{step.step}</span>
                    <span className="connectivity-result-step-detail">{step.detail}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {configState?.path && <p className="meta-path">Pfad: {configState.path}</p>}
    </section>
  )
}