import type { AudioDeviceSnapshot } from '@shared/transcript-contract'
import type { UserSettings } from '@shared/config-contract'
import { Icon } from './Icon'
import { AudioSources } from './AudioPanel'

const languageOptions = [
  { value: 'de-DE', label: 'German' },
  { value: 'en-US', label: 'English' },
  { value: 'fr-FR', label: 'French' },
  { value: 'es-ES', label: 'Spanish' },
  { value: 'it-IT', label: 'Italian' },
  { value: 'pt-BR', label: 'Portuguese' },
  { value: 'nl-NL', label: 'Dutch' },
  { value: 'pl-PL', label: 'Polish' },
  { value: 'tr-TR', label: 'Turkish' },
  { value: 'ja-JP', label: 'Japanese' }
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
        <h2>{audioOnly ? 'Audio settings' : 'General'}</h2>
      </div>

      {statusRunning && <div className="settings-inline-hint">Stop the recording to change settings.</div>}

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
            <span>Minimize to system tray on close</span>
          </label>
        </>}
      </div>
    </section>

    {!audioOnly && <section className="panel settings">
      <div className="panel-header"><h2>Transcription</h2></div>
      <div className="settings-block">
          <label className="language-field">
            <span className="field-caption"><Icon name="flag" />Primary language</span>
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
          <label className="checkbox-field" title="Start recording automatically when a meeting is detected">
            <input
              type="checkbox"
              checked={settings.autoStart.enabled}
              onChange={(event) => {
                const enabled = event.currentTarget.checked
                setSettings((prev) => ({ ...prev, autoStart: { ...prev.autoStart, enabled } }))
              }}
              disabled={statusRunning}
            />
            <span>Start recording automatically</span>
          </label>
          <label className="checkbox-field" title="Stop recording automatically when the meeting was started automatically">
            <input
              type="checkbox"
              aria-label="Stop recording automatically"
              checked={settings.autoStart.autoStop}
              onChange={(event) => {
                const autoStop = event.currentTarget.checked
                setSettings((prev) => ({ ...prev, autoStart: { ...prev.autoStart, autoStop } }))
              }}
              disabled={statusRunning || !settings.autoStart.enabled}
            />
            <span>Stop recording automatically</span>
          </label>

          <label className="checkbox-field" title="Save the transcript automatically as Markdown">
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
            <span>Save transcript automatically</span>
          </label>
          <div className="directory-control">
            <input
              id="transcript-export-path"
              aria-label="Save path (optional)"
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
              placeholder="Default: application directory"
              disabled={statusRunning || !settings.transcript.markdownExport.enabled}
            />
            <button type="button" onClick={() => void onChooseDirectory()}
              disabled={statusRunning || !settings.transcript.markdownExport.enabled || choosingDirectory}
              aria-label="Choose save folder" title="Choose folder"><Icon name="folder" /></button>
          </div>
      </div>
    </section>}
    </>
  )
}
