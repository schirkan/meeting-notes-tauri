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
    <section className="panel settings">
      <div className="panel-header">
        <h2>{audioOnly ? 'Allgemeine Einstellungen' : 'Allgemein'}</h2>
      </div>

      {statusRunning && <div className="settings-inline-hint">Aufnahme stoppen, um Einstellungen zu ändern.</div>}

      {/* Nur der Leerzustand nutzt das Audio-Grid; im Dialog hat der Abschnitt "Audio" eigene Felder. */}
      <div className={audioOnly ? 'settings-block audio-settings-grid' : 'settings-block'}>
        <label>
          <span className="field-caption"><Icon name="flag" />Sprache</span>
          <select
            value={settings.language}
            onChange={(event) => {
              const language = event.currentTarget.value
              setSettings((prev) => ({ ...prev, language }))
            }}
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

        {/* Der Leerzustand auf der Startseite zeigt Sprache und Audioquellen. */}
        {audioOnly && <AudioSources
          statusRunning={statusRunning}
          settings={settings}
          devices={devices}
          setSettings={setSettings}
        />}

        {!audioOnly && <>
          <label className="checkbox-field full-field">
            <input
              type="checkbox"
              checked={settings.autoStart.enabled}
              onChange={(event) => {
                const enabled = event.currentTarget.checked
                setSettings((prev) => ({
                  ...prev,
                  autoStart: { ...prev.autoStart, enabled }
                }))
              }}
              disabled={statusRunning}
            />
            <span>Aufnahme bei erkanntem Meeting automatisch starten</span>
          </label>

          <label className="checkbox-field full-field">
            <input
              type="checkbox"
              aria-label="Aufnahme automatisch beenden"
              checked={settings.autoStart.autoStop}
              onChange={(event) => {
                const autoStop = event.currentTarget.checked
                setSettings((prev) => ({
                  ...prev,
                  autoStart: { ...prev.autoStart, autoStop }
                }))
              }}
              disabled={statusRunning || !settings.autoStart.enabled}
            />
            <span>Aufnahme automatisch beenden, wenn das Meeting automatisch gestartet wurde</span>
          </label>

          <label className="checkbox-field full-field">
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
          <span>Transkript automatisch als Markdown speichern</span>
          </label>

          {/* Der Speicherpfad gehoert direkt unter seine Checkbox. */}
          <div className="full-field directory-field">
            <label htmlFor="transcript-export-path">Speicherpfad (optional)</label>
            <div className="directory-control">
              <input
                id="transcript-export-path"
                type="text"
                value={settings.transcript.markdownExport.path ?? ''}
                onChange={(event) => {
                  const path = event.currentTarget.value.trim() || null
                  setSettings((prev) => ({
                    ...prev,
                    transcript: {
                      ...prev.transcript,
                      markdownExport: {
                        ...prev.transcript.markdownExport,
                        path
                      }
                    }
                  }))
                }}
                placeholder="Standard: Anwendungsverzeichnis"
                disabled={statusRunning || !settings.transcript.markdownExport.enabled}
              />
              <button type="button" onClick={() => void onChooseDirectory()}
                disabled={statusRunning || !settings.transcript.markdownExport.enabled || choosingDirectory}
                aria-label="Speicherordner auswählen"><Icon name="folder" />Ordner auswählen</button>
            </div>
          </div>

          <label className="checkbox-field full-field">
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
  )
}
