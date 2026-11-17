import type { AudioDeviceSnapshot } from '@shared/transcript-contract'
import type { UserSettings } from '@shared/config-contract'
import { Icon } from './Icon'

const languageOptions = [
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'en-US', label: 'Englisch' },
  { value: 'fr-FR', label: 'Französisch' },
  { value: 'es-ES', label: 'Spanisch' },
  { value: 'it-IT', label: 'Italienisch' },
  { value: 'pt-BR', label: 'Portugiesisch' },
  { value: 'nl-NL', label: 'Niederländisch' },
  { value: 'pl-PL', label: 'Polnisch' },
  { value: 'tr-TR', label: 'Türkisch' },
  { value: 'ja-JP', label: 'Japanisch' }
] as const

type SettingsPanelProps = {
  statusRunning: boolean
  settings: UserSettings
  devices: AudioDeviceSnapshot
  setSettings: React.Dispatch<React.SetStateAction<UserSettings>>
  audioOnly?: boolean
}

export function SettingsPanel(props: SettingsPanelProps) {
  const {
    statusRunning,
    settings,
    devices,
    setSettings,
    audioOnly = false
  } = props

  return (
    <section className="panel settings">
      <div className="panel-header">
        <h2>{audioOnly ? 'Allgemeine Einstellungen' : 'Allgemein'}</h2>
      </div>

      {statusRunning && <div className="settings-inline-hint">Aufnahme stoppen, um Einstellungen zu ändern.</div>}

      <div className="settings-block audio-settings-grid">
        <label>
          <span className="field-caption"><Icon name="flag" />Sprache</span>
          <select
            value={settings.language}
            onChange={(event) => setSettings((prev) => ({ ...prev, language: event.target.value }))}
            disabled={statusRunning}
          >
            {!languageOptions.some((option) => option.value === settings.language) && (
              <option value={settings.language}>{settings.language}</option>
            )}
            {languageOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <div className="settings-placeholder" aria-hidden="true" />

        <div className="audio-source-field">
          <span className="field-caption"><Icon name="mic" />Mikrofon</span>
          <div className="audio-source-control">
            <input
              type="checkbox"
              aria-label="Mikrofon transkribieren"
              checked={settings.transcription.mic}
              onChange={(event) => {
                const mic = event.currentTarget.checked
                setSettings((prev) => ({ ...prev, transcription: { mic, speaker: !mic || prev.transcription.speaker } }))
              }}
              disabled={statusRunning}
              title="Mikrofon transkribieren"
            />
            <select
              aria-label="Mikrofon"
              value={settings.devices.micId ?? ''}
              onChange={(event) => {
                const micId = event.currentTarget.value || null
                setSettings((prev) => ({ ...prev, devices: { ...prev.devices, micId } }))
              }}
              disabled={statusRunning || !settings.transcription.mic}
            >
              <option value="">System-Default</option>
              {devices.inputs.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name} {device.isDefault ? '(Default)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="audio-source-field">
          <span className="field-caption"><Icon name="speaker" />Speaker Loopback</span>
          <div className="audio-source-control">
            <input
              type="checkbox"
              aria-label="Speaker-Loopback transkribieren"
              checked={settings.transcription.speaker}
              onChange={(event) => {
                const speaker = event.currentTarget.checked
                setSettings((prev) => ({ ...prev, transcription: { speaker, mic: !speaker || prev.transcription.mic } }))
              }}
              disabled={statusRunning}
              title="Speaker-Loopback transkribieren"
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
              <option value="">System-Default</option>
              {devices.outputs.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name} {device.isDefault ? '(Default)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={settings.diarization.mic}
            onChange={(event) => setSettings((prev) => ({
              ...prev,
              diarization: { ...prev.diarization, mic: event.target.checked }
            }))}
            disabled={statusRunning || !settings.transcription.mic}
          />
          <span>Sprechererkennung für Mikrofon</span>
        </label>

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={settings.diarization.speaker}
            onChange={(event) => setSettings((prev) => ({
              ...prev,
              diarization: { ...prev.diarization, speaker: event.target.checked }
            }))}
            disabled={statusRunning || !settings.transcription.speaker}
          />
          <span>Sprechererkennung für Speaker</span>
        </label>
        {!audioOnly && <>
        <label className="checkbox-field full-field">
          <input
            type="checkbox"
            checked={settings.transcript.markdownExport.enabled}
            onChange={(event) =>
              setSettings((prev) => ({
                ...prev,
                transcript: {
                  ...prev.transcript,
                  markdownExport: { ...prev.transcript.markdownExport, enabled: event.target.checked }
                }
              }))
            }
            disabled={statusRunning}
          />
          <span>Transkript automatisch als Markdown speichern</span>
        </label>

        <label className="full-field">
          Speicherpfad (optional)
          <input
            type="text"
            value={settings.transcript.markdownExport.path ?? ''}
            onChange={(event) =>
              setSettings((prev) => ({
                ...prev,
                transcript: {
                  ...prev.transcript,
                  markdownExport: {
                    ...prev.transcript.markdownExport,
                    path: event.target.value.trim() || null
                  }
                }
              }))
            }
            placeholder="Standard: Anwendungsverzeichnis"
            disabled={statusRunning || !settings.transcript.markdownExport.enabled}
          />
        </label>
        </>}
        {audioOnly && <p className="meta full-field">Änderungen gelten nach dem Speichern für die nächste Aufnahme.</p>}
      </div>
    </section>
  )
}