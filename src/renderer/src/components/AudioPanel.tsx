import type { AudioDeviceSnapshot } from '@shared/transcript-contract'
import type { UserSettings } from '@shared/config-contract'
import { Icon } from './Icon'

type AudioSourcesProps = {
  statusRunning: boolean
  settings: UserSettings
  devices: AudioDeviceSnapshot
  setSettings: React.Dispatch<React.SetStateAction<UserSettings>>
}

/**
 * Mic and speaker loopback as independent sources.
 *
 * Shared by the idle panel on the start screen and by the Audio section of the
 * settings dialog, so both places always show the same controls.
 */
export function AudioSources(props: AudioSourcesProps) {
  const { statusRunning, settings, devices, setSettings } = props

  return (
    <>
      <div className="audio-source-row full-field">
        <div className="audio-source-field">
          <span className="field-caption"><Icon name="mic" />Microphone</span>
          <div className="audio-source-control" title="Choose the microphone to transcribe; System default follows Windows">
            <input
              type="checkbox"
              aria-label="Transcribe microphone"
              checked={settings.transcription.mic}
              onChange={(event) => {
                const mic = event.currentTarget.checked
                setSettings((prev) => ({ ...prev, transcription: { ...prev.transcription, mic, speaker: !mic || prev.transcription.speaker } }))
              }}
              disabled={statusRunning}
              title="Transcribe microphone"
            />
            <select
              aria-label="Microphone"
              value={settings.devices.micId ?? ''}
              onChange={(event) => {
                const micId = event.currentTarget.value || null
                setSettings((prev) => ({ ...prev, devices: { ...prev.devices, micId } }))
              }}
              disabled={statusRunning || !settings.transcription.mic}
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

        <label className="checkbox-field source-diarization" title="Distinguish speakers in the microphone transcript">
          <input
            type="checkbox"
            aria-label="Speaker recognition for microphone"
            checked={settings.diarization.mic}
            onChange={(event) => {
              const mic = event.currentTarget.checked
              setSettings((prev) => ({ ...prev, diarization: { ...prev.diarization, mic } }))
            }}
            disabled={statusRunning || !settings.transcription.mic}
          />
          <span>Speaker recognition</span>
        </label>
      </div>

      <div className="audio-source-row full-field">
        <div className="audio-source-field">
          <span className="field-caption"><Icon name="speaker" />Speaker Loopback</span>
          <div className="audio-source-control" title="Choose the Windows playback device whose audio to transcribe">
            <input
              type="checkbox"
              aria-label="Transcribe speaker loopback"
              checked={settings.transcription.speaker}
              onChange={(event) => {
                const speaker = event.currentTarget.checked
                setSettings((prev) => ({ ...prev, transcription: { ...prev.transcription, speaker, mic: !speaker || prev.transcription.mic } }))
              }}
              disabled={statusRunning}
              title="Transcribe speaker loopback"
            />
            <select
              aria-label="Speaker Loopback"
              value={settings.devices.speakerLoopbackId ?? ''}
              onChange={(event) => {
                const speakerLoopbackId = event.currentTarget.value || null
                setSettings((prev) => ({ ...prev, devices: { ...prev.devices, speakerLoopbackId } }))
              }}
              disabled={statusRunning || !settings.transcription.speaker}
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

        <label className="checkbox-field source-diarization" title="Distinguish speakers in the speaker loopback transcript">
          <input
            type="checkbox"
            aria-label="Speaker recognition for speaker loopback"
            checked={settings.diarization.speaker}
            onChange={(event) => {
              const speaker = event.currentTarget.checked
              setSettings((prev) => ({ ...prev, diarization: { ...prev.diarization, speaker } }))
            }}
            disabled={statusRunning || !settings.transcription.speaker}
          />
          <span>Speaker recognition</span>
        </label>
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
        <h2>Audio</h2>
      </div>

      <div className="settings-block audio-settings-grid">
        <AudioSources {...props} />
      </div>
    </section>
  )
}
