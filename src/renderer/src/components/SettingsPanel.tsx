import { isAzureSpeechModel, type SpeechModel, type UserSettings } from '@shared/config-contract'
import { LIVE_MODELS, meetingSpeechFeatures } from '@shared/speech-models'
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

  const features = meetingSpeechFeatures(settings.transcription, configDraft.model)
  const { model, mode } = features
  const batch = mode === 'batch'
  const stereo = features.stereo && hasBothSources && settings.transcription.audioMode === 'stereo'
  const optionalLid = features.optionalLanguageDetection && !stereo

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
          {!batch && <label className="speech-model-field" title="Choose the speech recognition model for the next live transcription">
            <span className="field-caption">Transcription model</span>
            <select
              value={model}
              onChange={(event) => {
                const next = event.currentTarget.value as SpeechModel
                if (isAzureSpeechModel(next)) setConfigDraft((prev) => ({ ...prev, model: next }))
                setSettings((prev) => {
                  const { provider: _provider, ...sources } = prev.transcription
                  return { ...prev, transcription: {
                    ...sources,
                    ...(isAzureSpeechModel(next) ? {} : { provider: next })
                  } }
                })
              }}
              disabled={statusRunning}
            >
              {model === 'unsupported' && <option value="unsupported" disabled>Unsupported model</option>}
              {Object.entries(LIVE_MODELS).map(([id, choice]) => <option key={id} value={id}>{choice.label}</option>)}
            </select>
          </label>}
          {!batch && <label className="audio-mode-field" title="Choose one stereo session or separate mono sessions for the next transcription.">
            <span className="field-caption">Audio stream mode</span>
            <select value={features.stereo ? settings.transcription.audioMode : 'dual-mono'} disabled={statusRunning || !features.stereo}
              aria-describedby="audio-stream-mode-hint"
              onChange={(event) => {
                const audioMode = event.currentTarget.value === 'stereo' ? 'stereo' : 'dual-mono'
                setSettings((prev) => ({ ...prev, transcription: { ...prev.transcription, audioMode } }))
              }}>
              <option value="dual-mono">{features.speakerLoopback ? 'Mono (separate sessions per audio device)' : 'Mono (default microphone)'}</option>
              <option value="stereo" disabled={!features.stereo}>Stereo (one session)</option>
            </select>
          </label>}
          <label className="language-field" title={features.language === 'managed' ? 'The Windows model controls recognition language' : features.language === 'automatic' ? 'This model detects the language automatically' : 'Choose the primary recognition language'}>
            <span className="field-caption"><Icon name="flag" />Primary language</span>
            <select value={features.language === 'managed' ? '' : settings.language} disabled={statusRunning || features.language !== 'selectable'}
              onChange={(event) => {
                const language = event.currentTarget.value
                setSettings((prev) => ({ ...prev, language }))
              }}>
              {features.language === 'managed' && <option value="">Managed by Windows</option>}
              {!(model === 'windows-sapi' && settings.language === 'en-GB') && !languageOptions.some((option) => option.value === settings.language) && (
                <option value={settings.language}>{settings.language}</option>
              )}
              {languageOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.value === 'en-US' && model === 'windows-sapi' ? 'English (United States)' : option.label}</option>
              ))}
              {model === 'windows-sapi' && <option value="en-GB">English (United Kingdom)</option>}
            </select>
          </label>
          <label className="checkbox-field" title={features.language === 'automatic'
            ? 'This model always detects the language automatically'
            : features.language === 'managed' ? 'Not configurable for this model'
              : optionalLid ? 'Detect language changes between utterances' : 'This mode uses the primary language'}>
            <input type="checkbox" checked={features.language === 'automatic' || (optionalLid && settings.autoLanguageDetection)}
              disabled={statusRunning || !optionalLid}
              onChange={(event) => {
                const autoLanguageDetection = event.currentTarget.checked
                setSettings((prev) => ({ ...prev, autoLanguageDetection }))
              }} />
            <span>Automatic language detection</span>
          </label>
          <label className="checkbox-field" title={features.diarization ? 'Distinguish speakers on active audio sources' : 'Speaker recognition is unavailable with this model'}>
            <input type="checkbox" checked={features.diarization && settings.diarization}
              disabled={statusRunning || !features.diarization}
              onChange={(event) => {
                const diarization = event.currentTarget.checked
                setSettings((prev) => ({ ...prev, diarization }))
              }} />
            <span>Speaker recognition</span>
          </label>
          {!batch && <label className="checkbox-field" title={stereo ? 'Provisional stereo text may appear without a source label' : 'Show provisional text while speech is being recognized'}>
            <input
              type="checkbox"
              checked={features.interim && (features.azure ? configDraft.interimResults : settings.transcription.webInterimResults === true)}
              onChange={(event) => {
                const interimResults = event.currentTarget.checked
                if (features.azure) setConfigDraft((prev) => ({ ...prev, interimResults }))
                else setSettings((prev) => ({ ...prev, transcription: { ...prev.transcription, webInterimResults: interimResults || undefined } }))
              }}
              disabled={statusRunning || !features.interim}
            />
            <span>Enable interim results</span>
          </label>}
          <p className="meta full-field" id="audio-stream-mode-hint">
            {batch && 'Batch records one local WAV per enabled audio source. Choose an engine under Transcribe files when ready. Language and speaker settings apply where supported.'}
            {!batch && features.azure && 'Mono uses one Azure session per enabled source. Stereo uses one session for both sources and keeps them on separate channels. Interim results may appear without a source label. With one source enabled, audio stays mono.'}
            {!batch && model === 'mai-transcribe-2-streaming' && ' Live MAI uses mono only and does not support speaker recognition in Meeting Notes.'}
            {!batch && model === 'windows-sapi' && 'Uses an installed Windows desktop dictation engine for the selected language. No Azure credentials are used.'}
            {!batch && model === 'windows-ai-speech' && 'On-device recognition from the default microphone. Not available in the standard portable build. Requires MSIX package identity and a ready Windows model. No Azure credentials or automatic downloads.'}
            {!batch && model === 'web-speech' && 'Manual start uses the default microphone. WebView2 may send microphone audio to its online speech service. Availability depends on WebView2, permissions and policy. No Azure credentials are used.'}
            {!batch && model === 'unsupported' && 'Select a supported model before starting transcription.'}
          </p>
      </div>
    </section>
    </>
  )
}
