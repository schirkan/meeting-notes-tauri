import { isAzureSpeechModel, type AppConfigState } from '@shared/config-contract'
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

  const isMai = configDraft.model === 'mai-transcribe-2-streaming'

  return (
    <section className="panel settings">
      <div className="panel-header">
        <h2>Azure</h2>
      </div>

      {!configState?.config && (
        <div className="settings-inline-hint">
          No valid Azure configuration found. Please enter and save one now.
        </div>
      )}

      <div className="settings-block">
        <label className="speech-model-field" title="Choose the Azure Speech model for the next transcription">
          Transcription model
          <select
            value={configDraft.model}
            onChange={(event) => {
              const model = event.currentTarget.value
              if (isAzureSpeechModel(model)) setConfigDraft((prev) => ({ ...prev, model }))
            }}
            disabled={statusRunning}
          >
            <option value="standard">Azure Speech (standard)</option>
            <option value="mai-transcribe-2-streaming">MAI Transcribe (Preview)</option>
          </select>
        </label>
        {isMai && (
          <p className="settings-inline-hint speech-model-hint">
            Requires a supported Azure region and speech key. The endpoint below is only used by Standard.
            MAI detects the language automatically and labels audio by source, not by speaker.
            Dual mono uses one Azure session per enabled source. Stereo mix uses one session for both sources.
            Stereo is experimental; billing savings have not been verified.
          </p>
        )}

        <label title="Enter the HTTPS endpoint of your Azure Speech resource">
          Endpoint
          <input
            type="text"
            value={configDraft.endpoint}
            onChange={(event) => setConfigDraft((prev) => ({ ...prev, endpoint: event.target.value }))}
            placeholder="https://..."
            disabled={statusRunning || isMai}
          />
        </label>

        <label title="Enter the region of your Azure Speech resource, such as westeurope">
          Region
          <input
            type="text"
            value={configDraft.region}
            onChange={(event) => setConfigDraft((prev) => ({ ...prev, region: event.target.value }))}
            placeholder="westeurope"
            disabled={statusRunning}
          />
        </label>

        <label title="Enter an access key from your Azure Speech resource">
          Speech Key
          <input
            type="password"
            value={configDraft.speechKey}
            onChange={(event) => setConfigDraft((prev) => ({ ...prev, speechKey: event.target.value }))}
            placeholder="Azure Speech Key"
            disabled={statusRunning}
          />
        </label>

        <label className="checkbox-field" title="Show provisional text while Azure Speech is still recognizing it">
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