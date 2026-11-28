import type { UserSettings } from '@shared/config-contract'
import type { meetingSpeechFeatures } from '@shared/speech-models'
import { Icon } from './Icon'

type SettingsPanelProps = {
  statusRunning: boolean
  settings: UserSettings
  setSettings: React.Dispatch<React.SetStateAction<UserSettings>>
  features: ReturnType<typeof meetingSpeechFeatures>
  onChooseDirectory: () => Promise<void>
  choosingDirectory?: boolean
}

export function SettingsPanel(props: SettingsPanelProps) {
  const {
    statusRunning,
    settings,
    setSettings,
    features,
    onChooseDirectory,
    choosingDirectory = false
  } = props
  const batch = features.mode === 'batch'

  return (
    <>
    <section className="panel settings">
      <div className="panel-header">
        <h2>General</h2>
      </div>

      {statusRunning && <div className="settings-inline-hint">Stop the transcription to save settings.</div>}

      <div className="settings-block">
          <label className="checkbox-field" title="Keep the app running in the system tray when you close the window">
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
          <label className="checkbox-field" title="Remove the window from the Windows taskbar; reopen it from the system tray">
            <input
              type="checkbox"
              checked={settings.window.hideFromTaskbar}
              onChange={(event) => {
                const hideFromTaskbar = event.currentTarget.checked
                setSettings((prev) => ({ ...prev, window: { ...prev.window, hideFromTaskbar } }))
              }}
              disabled={statusRunning}
            />
            <span>Hide from taskbar</span>
          </label>
      </div>
    </section>

    <section className="panel settings">
      <div className="panel-header"><h2>Transcription</h2></div>
      <div className="settings-block">
          <label className="checkbox-field" title={batch ? 'Start local recording automatically when a meeting is detected' : 'Start transcription automatically when a meeting is detected'}>
            <input
              type="checkbox"
              checked={features.autoStart && settings.autoStart.enabled}
              onChange={(event) => {
                const enabled = event.currentTarget.checked
                setSettings((prev) => ({ ...prev, autoStart: { ...prev.autoStart, enabled } }))
              }}
              disabled={statusRunning || !features.autoStart}
            />
            <span>{batch ? 'Start recording automatically' : 'Start transcription automatically'}</span>
          </label>
          <label className="checkbox-field" title={batch ? 'Stop an automatically started recording when its meeting ends' : 'Stop an automatically started transcription when its meeting ends'}>
            <input
              type="checkbox"
              checked={features.autoStart && settings.autoStart.autoStop}
              onChange={(event) => {
                const autoStop = event.currentTarget.checked
                setSettings((prev) => ({ ...prev, autoStart: { ...prev.autoStart, autoStop } }))
              }}
              disabled={statusRunning || !features.autoStart || !settings.autoStart.enabled}
            />
            <span>{batch ? 'Stop recording automatically' : 'Stop transcription automatically'}</span>
          </label>
          <label className="checkbox-field" title="Ask before stopping after sustained silence. Not available with Web Speech API.">
            <input type="checkbox" checked={settings.autoStart.stopOnSilence} disabled={statusRunning}
              onChange={(event) => {
                const stopOnSilence = event.currentTarget.checked
                setSettings((prev) => ({ ...prev, autoStart: { ...prev.autoStart, stopOnSilence } }))
              }} />
            <span>Stop automatically after silence</span>
          </label>
          <label title="Minutes without audio before the 60-second stop warning">
            Silence timer (minutes)
            <input type="number" min="1" max="120" step="1" value={settings.autoStart.silenceMinutes}
              disabled={statusRunning || !settings.autoStart.stopOnSilence}
              onChange={(event) => {
                const silenceMinutes = event.currentTarget.valueAsNumber
                if (Number.isInteger(silenceMinutes) && silenceMinutes >= 1 && silenceMinutes <= 120) {
                  setSettings((prev) => ({ ...prev, autoStart: { ...prev.autoStart, silenceMinutes } }))
                }
              }} />
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
          <div className="directory-control" title="Save folder for Markdown transcripts. Leave blank to use the application directory.">
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
    </section>

    </>
  )
}
