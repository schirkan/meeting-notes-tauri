import type { AudioDeviceSnapshot } from '@shared/transcript-contract'
import type { UserSettings } from '@shared/config-contract'
import { Icon } from './Icon'

type AudioSourcesProps = {
  statusRunning: boolean
  selectDevices: boolean
  speakerLoopback: boolean
  batch?: boolean
  settings: UserSettings
  devices: AudioDeviceSnapshot
  setSettings: React.Dispatch<React.SetStateAction<UserSettings>>
}

function AudioSources(props: AudioSourcesProps) {
  const { statusRunning, selectDevices, speakerLoopback, batch, settings, devices, setSettings } = props
  const sourceAction = batch ? 'Record' : 'Transcribe'

  return (
    <>
      <div className="audio-source-row full-field">
        <div className="audio-source-field">
          <span className="field-caption"><Icon name="mic" />Microphone</span>
          <div className="audio-source-control" title={`Choose the microphone to ${sourceAction.toLowerCase()}; System default follows Windows`}>
            <input
              type="checkbox"
              aria-label={`${sourceAction} microphone`}
              checked={!selectDevices || settings.transcription.mic}
              onChange={(event) => {
                const mic = event.currentTarget.checked
                setSettings((prev) => ({ ...prev, transcription: { ...prev.transcription, mic, speaker: !mic || prev.transcription.speaker } }))
              }}
              disabled={statusRunning || !speakerLoopback}
              title={speakerLoopback ? `${sourceAction} microphone` : 'This model uses the default microphone'}
            />
            <select
              aria-label="Microphone"
              value={(selectDevices && settings.devices.micId) || ''}
              onChange={(event) => {
                const micId = event.currentTarget.value || null
                setSettings((prev) => ({ ...prev, devices: { ...prev.devices, micId } }))
              }}
              disabled={statusRunning || !selectDevices || !settings.transcription.mic}
            >
              <option value="">System default</option>
              {devices.inputs.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name} {device.isDefault ? '(Default)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="audio-source-row full-field">
        <div className="audio-source-field">
          <span className="field-caption"><Icon name="speaker" />Speaker Loopback</span>
          <div className="audio-source-control" title={`Choose the Windows playback device whose audio to ${sourceAction.toLowerCase()}`}>
            <input
              type="checkbox"
              aria-label={`${sourceAction} speaker loopback`}
              checked={speakerLoopback && settings.transcription.speaker}
              onChange={(event) => {
                const speaker = event.currentTarget.checked
                setSettings((prev) => ({ ...prev, transcription: { ...prev.transcription, speaker, mic: !speaker || prev.transcription.mic } }))
              }}
              disabled={statusRunning || !speakerLoopback}
              title={speakerLoopback ? `${sourceAction} speaker loopback` : 'Speaker loopback is not supported by this model'}
            />
            <select
              aria-label="Speaker Loopback"
              value={settings.devices.speakerLoopbackId ?? ''}
              onChange={(event) => {
                const speakerLoopbackId = event.currentTarget.value || null
                setSettings((prev) => ({ ...prev, devices: { ...prev.devices, speakerLoopbackId } }))
              }}
              disabled={statusRunning || !speakerLoopback || !settings.transcription.speaker}
            >
              <option value="">System default</option>
              {devices.outputs.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name} {device.isDefault ? '(Default)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </>
  )
}

/**
 * Audio section of the settings dialog: both capture sources in one place.
 */
export function AudioPanel(props: AudioSourcesProps) {
  return (
    <section className="panel settings">
      <div className="panel-header">
        <h2>Audio devices</h2>
      </div>

      <div className="settings-block audio-settings-grid">
        <AudioSources {...props} />
      </div>
    </section>
  )
}
