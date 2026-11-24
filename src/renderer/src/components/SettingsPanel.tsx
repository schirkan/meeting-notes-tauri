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
  useMaiModel?: boolean
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
    useMaiModel = false,
    onChooseDirectory,
    choosingDirectory = false
  } = props
  const hasBothSources = settings.transcription.mic && settings.transcription.speaker

  return (
    <>
    <section className="panel settings">
      <div className="panel-header">
        <h2>{audioOnly ? 'Audio settings' : 'General'}</h2>
      </div>

      {statusRunning && <div className="settings-inline-hint">Stop the transcription to save settings.</div>}

      <div className={audioOnly ? 'settings-block audio-settings-grid' : 'settings-block'}>
        {audioOnly && <AudioSources
          statusRunning={statusRunning}
          sourceLabelsOnly={useMaiModel}
          settings={settings}
          devices={devices}
          setSettings={setSettings}
        />}

        {!audioOnly && <>
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
          <label className="checkbox-field" title="Start transcription automatically when a meeting is detected">
            <input
              type="checkbox"
              checked={settings.autoStart.enabled}
              onChange={(event) => {
                const enabled = event.currentTarget.checked
                setSettings((prev) => ({ ...prev, autoStart: { ...prev.autoStart, enabled } }))
              }}
              disabled={statusRunning}
            />
            <span>Start transcription automatically</span>
          </label>
          <label className="checkbox-field" title="Stop an automatically started transcription when its meeting ends">
            <input
              type="checkbox"
              checked={settings.autoStart.autoStop}
              onChange={(event) => {
                const autoStop = event.currentTarget.checked
                setSettings((prev) => ({ ...prev, autoStart: { ...prev.autoStart, autoStop } }))
              }}
              disabled={statusRunning || !settings.autoStart.enabled}
            />
            <span>Stop transcription automatically</span>
          </label>
        </>}
      </div>
    </section>

    {!audioOnly && <section className="panel settings">
      <div className="panel-header"><h2>Transcription</h2></div>
      <div className="settings-block">
          <label className="language-field" title={useMaiModel ? 'MAI Transcribe detects the language automatically' : 'Choose the language Azure Speech should recognize'}>
            <span className="field-caption"><Icon name="flag" />Primary language</span>
            <select value={settings.language} disabled={statusRunning || useMaiModel}
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
          <label className="audio-mode-field full-field" title="Choose one stereo session or separate mono sessions for the next transcription.">
            <span className="field-caption">Audio stream mode</span>
            <select value={settings.transcription.audioMode} disabled={statusRunning}
              aria-describedby="audio-stream-mode-hint"
              onChange={(event) => {
                const audioMode = event.currentTarget.value === 'stereo' ? 'stereo' : 'dual-mono'
                setSettings((prev) => ({ ...prev, transcription: { ...prev.transcription, audioMode } }))
              }}>
              <option value="dual-mono">Dual mono (separate sessions)</option>
              <option value="stereo">Stereo mix (one session{useMaiModel ? ', experimental' : ''})</option>
            </select>
          </label>
          <p className="meta full-field" id="audio-stream-mode-hint">
            Stereo keeps microphone and speaker loopback on separate channels and shows final results only.
            With one source enabled, audio stays mono. Applies to the next transcription.
            {useMaiModel && ' MAI stereo is experimental and does not automatically fall back to dual mono.'}
          </p>
          <label className="checkbox-field full-field" title="Reduces speaker audio picked up by your microphone. Requires both microphone and speaker loopback. Applies to the next transcription.">
            <input
              type="checkbox"
              checked={settings.transcription.echoCancellation}
              onChange={(event) => {
                const echoCancellation = event.currentTarget.checked
                setSettings((prev) => ({ ...prev, transcription: { ...prev.transcription, echoCancellation } }))
              }}
              disabled={statusRunning}
              aria-describedby={hasBothSources ? undefined : 'echo-cancellation-source-hint'}
            />
            <span>Echo cancellation (Alpha)</span>
          </label>
          {!hasBothSources && (
            <p className="meta full-field" id="echo-cancellation-source-hint">
              Echo cancellation won’t apply unless both Microphone and Speaker Loopback are enabled in Audio settings.
            </p>
          )}
      </div>
    </section>}
    </>
  )
}
