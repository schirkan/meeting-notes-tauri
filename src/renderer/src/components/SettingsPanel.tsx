import type { AudioDeviceSnapshot } from '@shared/transcript-contract'
import type { UserSettings } from '@shared/config-contract'
import { Icon } from './Icon'
import { AudioSources } from './AudioPanel'

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
  onChooseDirectory: () => Promise<void>
  choosingDirectory?: boolean
}

export function SettingsPanel(props: SettingsPanelProps) {
  const {
    statusRunning,
    settings,
    devices,
    setSettings,
    audioOnly = false,
    onChooseDirectory,
    choosingDirectory = false
  } = props

  return (
    <>
    <section className="panel settings">
      <div className="panel-header">
        <h2>{audioOnly ? 'Audio Einstellungen' : 'Allgemein'}</h2>
      </div>

      {statusRunning && <div className="settings-inline-hint">Aufnahme stoppen, um Einstellungen zu ändern.</div>}

      <div className={audioOnly ? 'settings-block audio-settings-grid' : 'settings-block'}>
        {audioOnly && <AudioSources
          statusRunning={statusRunning}
          settings={settings}
          devices={devices}
          setSettings={setSettings}
        />}

        {!audioOnly && <>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={settings.window.minimizeToTrayOnClose}
              onChange={(event) => {
                const minimizeToTrayOnClose = event.currentTarget.checked
                setSettings((prev) => ({
                  ...prev,
                  window: { ...prev.window, minimizeToTrayOnClose }
                }))
              }}
              disabled={statusRunning}
            />
            <span>Beim Schließen in den Systray minimieren</span>
          </label>
        </>}
      </div>
    </section>

    {!audioOnly && <section className="panel settings">
      <div className="panel-header"><h2>Transkription</h2></div>
      <div className="settings-block">
          <label className="language-field">
            <span className="field-caption"><Icon name="flag" />Primäre Sprache</span>
            <select value={settings.language} disabled={statusRunning}
              onChange={(event) => {
                const language = event.currentTarget.value
                setSettings((prev) => ({ ...prev, language }))
              }}>
              {!languageOptions.some((option) => option.value === settings.language) && (
                <option value={settings.language}>{settings.language}</option>
              )}
              {languageOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="checkbox-field" title="Aufnahme bei erkanntem Meeting automatisch starten">
            <input
              type="checkbox"
              checked={settings.autoStart.enabled}
              onChange={(event) => {
                const enabled = event.currentTarget.checked
                setSettings((prev) => ({ ...prev, autoStart: { ...prev.autoStart, enabled } }))
              }}
              disabled={statusRunning}
            />
            <span>Aufnahme automatisch starten</span>
          </label>
          <label className="checkbox-field" title="Aufnahme automatisch beenden, wenn das Meeting automatisch gestartet wurde">
            <input
              type="checkbox"
              aria-label="Aufnahme automatisch beenden"
              checked={settings.autoStart.autoStop}
              onChange={(event) => {
                const autoStop = event.currentTarget.checked
                setSettings((prev) => ({ ...prev, autoStart: { ...prev.autoStart, autoStop } }))
              }}
              disabled={statusRunning || !settings.autoStart.enabled}
            />
            <span>Aufnahme automatisch beenden</span>
          </label>

          <label className="checkbox-field" title="Transkript automatisch als Markdown speichern">
            <input
              type="checkbox"
              checked={settings.transcript.markdownExport.enabled}
              onChange={(event) => {
                const enabled = event.currentTarget.checked
                setSettings((prev) => ({
                  ...prev,
                  transcript: {
                    ...prev.transcript,
                    markdownExport: { ...prev.transcript.markdownExport, enabled }
                  }
                }))
              }}
              disabled={statusRunning}
            />
            <span>Transkript automatisch speichern</span>
          </label>
          <div className="directory-control">
            <input
              id="transcript-export-path"
              aria-label="Speicherpfad (optional)"
              type="text"
              value={settings.transcript.markdownExport.path ?? ''}
              onChange={(event) => {
                const path = event.currentTarget.value.trim() || null
                setSettings((prev) => ({
                  ...prev,
                  transcript: {
                    ...prev.transcript,
                    markdownExport: { ...prev.transcript.markdownExport, path }
                  }
                }))
              }}
              placeholder="Standard: Anwendungsverzeichnis"
              disabled={statusRunning || !settings.transcript.markdownExport.enabled}
            />
            <button type="button" onClick={() => void onChooseDirectory()}
              disabled={statusRunning || !settings.transcript.markdownExport.enabled || choosingDirectory}
              aria-label="Speicherordner auswählen" title="Ordner auswählen"><Icon name="folder" /></button>
          </div>
      </div>
    </section>}
    </>
  )
}
