import type { AudioDeviceSnapshot } from '@shared/transcript-contract'
import type { UserSettings } from '@shared/config-contract'

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
  settingsError: string | null
  setSettings: React.Dispatch<React.SetStateAction<UserSettings>>
  onSaveSettings: () => Promise<void>
}

export function SettingsPanel(props: SettingsPanelProps) {
  const {
    statusRunning,
    settings,
    devices,
    settingsError,
    setSettings,
    onSaveSettings
  } = props

  return (
    <section className="panel settings">
      <div className="panel-header">
        <h2>Allgemein</h2>
      </div>

      {statusRunning && <div className="settings-inline-hint">Stop first to change settings.</div>}

      <div className="settings-block">
        <label>
          Sprache
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

        <label>
          Mikrofon
          <select
            value={settings.devices.micId ?? ''}
            onChange={(event) =>
              setSettings((prev) => ({
                ...prev,
                devices: { ...prev.devices, micId: event.target.value || null }
              }))
            }
            disabled={statusRunning}
          >
            <option value="">System-Default</option>
            {devices.inputs.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name} {device.isDefault ? '(Default)' : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={settings.diarization.mic}
            onChange={(event) => setSettings((prev) => ({
              ...prev,
              diarization: { ...prev.diarization, mic: event.target.checked }
            }))}
            disabled={statusRunning}
          />
          <span>Sprechererkennung für Mikrofon</span>
        </label>

        <label>
          Speaker Loopback
          <select
            value={settings.devices.speakerLoopbackId ?? ''}
            onChange={(event) =>
              setSettings((prev) => ({
                ...prev,
                devices: { ...prev.devices, speakerLoopbackId: event.target.value || null }
              }))
            }
            disabled={statusRunning}
          >
            <option value="">System-Default</option>
            {devices.outputs.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name} {device.isDefault ? '(Default)' : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={settings.diarization.speaker}
            onChange={(event) => setSettings((prev) => ({
              ...prev,
              diarization: { ...prev.diarization, speaker: event.target.checked }
            }))}
            disabled={statusRunning}
          />
          <span>Sprechererkennung für Speaker</span>
        </label>
        <p className="meta">Änderungen gelten nach dem Speichern für die nächste Aufnahme.</p>
      </div>

      <button className="primary-button settings-save-button" type="button" onClick={() => void onSaveSettings()} disabled={statusRunning}>
        Einstellungen speichern
      </button>
      {settingsError && <div className="hint">{settingsError}</div>}
    </section>
  )
}