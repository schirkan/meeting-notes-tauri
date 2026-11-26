import type { AppConfigState } from '@shared/config-contract'
import type { ConfigDraft } from '../config-utils'

type ConfigPanelProps = {
  configState: AppConfigState | null
  configDraft: ConfigDraft
  statusRunning: boolean
  enabled: boolean
  endpointEnabled: boolean
  batch: boolean
  setConfigDraft: React.Dispatch<React.SetStateAction<ConfigDraft>>
}

export function ConfigPanel(props: ConfigPanelProps) {
  const {
    configState,
    configDraft,
    statusRunning, enabled, endpointEnabled, batch,
    setConfigDraft
  } = props

  return (
    <section className="panel settings">
      <div className="panel-header">
        <h2>Azure</h2>
      </div>

      {enabled && !configState?.config && (
        <div className="settings-inline-hint">
          {batch ? 'Local recording does not require Azure credentials. Enter them before transcribing with Azure.'
            : 'No valid Azure configuration found. Please enter and save one now.'}
        </div>
      )}

      <div className="settings-block">
        <label className="full-field" title={batch ? 'Enter the HTTPS origin of your Azure Speech resource without an API path' : 'Enter the HTTPS endpoint of your Azure Speech resource'}>
          Endpoint
          <input
            type="text"
            value={configDraft.endpoint}
            onChange={(event) => setConfigDraft((prev) => ({ ...prev, endpoint: event.target.value }))}
            placeholder={batch ? 'https://<resource>.cognitiveservices.azure.com' : 'https://...'}
            disabled={statusRunning || !endpointEnabled}
          />
        </label>

        <label title="Enter the region of your Azure Speech resource, such as westeurope">
          Region
          <input
            type="text"
            value={configDraft.region}
            onChange={(event) => setConfigDraft((prev) => ({ ...prev, region: event.target.value }))}
            placeholder="westeurope"
            disabled={statusRunning || !enabled}
          />
        </label>

        <label title="Enter an access key from your Azure Speech resource">
          Speech Key
          <input
            type="password"
            value={configDraft.speechKey}
            onChange={(event) => setConfigDraft((prev) => ({ ...prev, speechKey: event.target.value }))}
            placeholder="Azure Speech Key"
            disabled={statusRunning || !enabled}
          />
        </label>
      </div>
    </section>
  )
}
