import type { AppConfigState } from '@shared/config-contract'
import type { ConfigDraft } from '../config-utils'

type ConfigPanelProps = {
  configState: AppConfigState | null
  configDraft: ConfigDraft
  statusRunning: boolean
  setConfigDraft: React.Dispatch<React.SetStateAction<ConfigDraft>>
}

export function ConfigPanel(props: ConfigPanelProps) {
  const {
    configState,
    configDraft,
    statusRunning,
    setConfigDraft
  } = props

  return (
    <section className="panel settings">
      <div className="panel-header">
        <h2>Azure</h2>
      </div>

      {!configState?.exists && (
        <div className="settings-inline-hint">
          No valid Azure configuration found. Please enter and save one now.
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
          <span>Enable interim results</span>
        </label>
      </div>

    </section>
  )
}