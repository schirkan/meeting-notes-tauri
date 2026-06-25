import type { AudioDeviceSnapshot } from '@shared/transcript-contract'
import type { UserSettings } from '@shared/config-contract'

type LanguageOption = {
  value: string
  label: string
}

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
        <span className="field-label">Sprache</span>
        <div className="language-grid" role="radiogroup" aria-label="Sprache auswählen">
          {languageOptions.map((option) => (
            <label key={option.value} className={`language-option ${settings.language === option.value ? 'active' : ''}`}>
              <input
                type="radio"
                name="language"
                value={option.value}
                checked={settings.language === option.value}
                onChange={(event) => setSettings((prev) => ({ ...prev, language: event.target.value }))}
                disabled={statusRunning}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>

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
      </div>

      <button className="primary-button settings-save-button" type="button" onClick={() => void onSaveSettings()} disabled={statusRunning}>
        Einstellungen speichern
      </button>
      {settingsError && <div className="hint">{settingsError}</div>}
    </section>
  )
}