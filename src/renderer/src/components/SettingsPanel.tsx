import { isAzureSpeechModel, type UserSettings } from '@shared/config-contract'
import type { ConfigDraft } from '../config-utils'
import { Icon } from './Icon'

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
  setSettings: React.Dispatch<React.SetStateAction<UserSettings>>
  configDraft: ConfigDraft
  setConfigDraft: React.Dispatch<React.SetStateAction<ConfigDraft>>
  onChooseDirectory: () => Promise<void>
  choosingDirectory?: boolean
}

export function SettingsPanel(props: SettingsPanelProps) {
  const {
    statusRunning,
    settings,
    setSettings,
    configDraft,
    setConfigDraft,
    onChooseDirectory,
    choosingDirectory = false
  } = props
  const hasBothSources = settings.transcription.mic && settings.transcription.speaker

  const useMaiModel = configDraft.model === 'mai-transcribe-2-streaming'
  const stereo = !useMaiModel && hasBothSources && settings.transcription.audioMode === 'stereo'

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

    <section className="panel settings">
      <div className="panel-header"><h2>Speech recognition</h2></div>
      <div className="settings-block">
          <label className="speech-model-field" title="Choose the Azure Speech model for the next transcription">
            <span className="field-caption">Transcription model</span>
            <select
              value={configDraft.model}
              onChange={(event) => {
                const model = event.currentTarget.value
                if (isAzureSpeechModel(model)) setConfigDraft((prev) => ({ ...prev, model }))
              }}
              disabled={statusRunning}
            >
              <option value="standard">Azure Speech (standard)</option>
              <option value="mai-transcribe-2-streaming">MAI Transcribe (Preview)</option>
            </select>
          </label>
          <label className="audio-mode-field" title="Choose one stereo session or separate mono sessions for the next transcription.">
            <span className="field-caption">Audio stream mode</span>
            <select value={useMaiModel ? 'dual-mono' : settings.transcription.audioMode} disabled={statusRunning || useMaiModel}
              aria-describedby="audio-stream-mode-hint"
              onChange={(event) => {
                const audioMode = event.currentTarget.value === 'stereo' ? 'stereo' : 'dual-mono'
                setSettings((prev) => ({ ...prev, transcription: { ...prev.transcription, audioMode } }))
              }}>
              <option value="dual-mono">Mono (separate sessions per audio device)</option>
              <option value="stereo" disabled={useMaiModel}>Stereo (one session)</option>
            </select>
          </label>
          <label className="language-field" title={useMaiModel ? 'MAI Transcribe detects the language automatically' : 'Choose the fixed language, or a candidate for automatic language detection'}>
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
          <label className="checkbox-field" title={useMaiModel
            ? 'MAI Transcribe always detects the language automatically'
            : stereo ? 'Stereo uses the primary language' : 'Detect language changes between utterances'}>
            <input type="checkbox" checked={useMaiModel || (!stereo && settings.autoLanguageDetection)}
              disabled={statusRunning || useMaiModel || stereo}
              onChange={(event) => {
                const autoLanguageDetection = event.currentTarget.checked
                setSettings((prev) => ({ ...prev, autoLanguageDetection }))
              }} />
            <span>Automatic language detection</span>
          </label>
          <label className="checkbox-field" title={useMaiModel ? 'Speaker recognition is unavailable with MAI Transcribe' : 'Distinguish speakers on both enabled audio sources'}>
            <input type="checkbox" checked={!useMaiModel && settings.diarization}
              disabled={statusRunning || useMaiModel}
              onChange={(event) => {
                const diarization = event.currentTarget.checked
                setSettings((prev) => ({ ...prev, diarization }))
              }} />
            <span>Speaker recognition</span>
          </label>
          <label className="checkbox-field" title={stereo ? 'Provisional stereo text may appear without a source label' : 'Show provisional text while speech is being recognized'}>
            <input
              type="checkbox"
              checked={configDraft.interimResults}
              onChange={(event) => {
                const interimResults = event.currentTarget.checked
                setConfigDraft((prev) => ({ ...prev, interimResults }))
              }}
              disabled={statusRunning}
            />
            <span>Enable interim results</span>
          </label>
          <p className="meta full-field" id="audio-stream-mode-hint">
            Mono uses one Azure session per enabled source. Stereo uses one session for both sources and
            keeps them on separate channels. Interim results may appear without a source label.
            With one source enabled, audio stays mono.
            {useMaiModel && ' MAI uses mono only and does not support speaker recognition in Meeting Notes.'}
          </p>
      </div>
    </section>
    </>
  )
}
