import type { AzureConfigState } from '@shared/config-contract'
import type { ConfigDraft } from '../config-utils'
import type { ConnectivityResult } from './ConnectivityDialog'

type ConfigPanelProps = {
  configState: AzureConfigState | null
  configDraft: ConfigDraft
  statusRunning: boolean
  setConfigDraft: React.Dispatch<React.SetStateAction<ConfigDraft>>
  onSaveConfig: () => Promise<void>
  onTestConnectivity: () => Promise<void>
  onOpenConnectivityDialog: () => void
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
    onOpenConnectivityDialog,
    isTestingConnectivity,
    connectivityResult
  } = props

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
          disabled={isTestingConnectivity || !configDraft.endpoint || !configDraft.speechKey || !configDraft.region}
          title="HTTPS ohne Zertifikatsprüfung und native Speech/WSS-Sitzungen getrennt über den konfigurierten Proxy testen (ohne Audioaufnahme)"
        >
          {isTestingConnectivity ? 'Teste …' : 'Verbindung testen'}
        </button>
        {(connectivityResult || isTestingConnectivity) && (
          <button className="secondary-button" type="button" onClick={onOpenConnectivityDialog}>
            {isTestingConnectivity ? 'Laufenden Verbindungstest anzeigen' : 'Letzten Verbindungstest anzeigen'}
          </button>
        )}
      </div>
    </section>
  )
}