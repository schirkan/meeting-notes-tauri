import type { SpeechModel, UserSettings } from '@shared/config-contract'
import { LIVE_MODELS, type meetingSpeechFeatures } from '@shared/speech-models'
import { SpeechLanguageOptions } from './SpeechLanguageOptions'

type Props = {
  features: ReturnType<typeof meetingSpeechFeatures>
  settings: UserSettings
  disabled: boolean
  azureInterim: boolean
  setSettings: React.Dispatch<React.SetStateAction<UserSettings>>
  onModelChange: (model: SpeechModel) => void
  onAzureInterimChange: (enabled: boolean) => void
}

export function LiveModelPanel({ features, settings, disabled, azureInterim, setSettings, onModelChange, onAzureInterimChange }: Props) {
  const { model } = features
  const stereo = features.stereo && settings.transcription.mic && settings.transcription.speaker && settings.transcription.audioMode === 'stereo'
  const optionalLid = features.optionalLanguageDetection && !stereo
  return <div className="home-fields">
    <h3 id="live-model-heading">Transcription model</h3>
    <select value={model} aria-labelledby="live-model-heading" disabled={disabled} onChange={(event) => {
      const value = event.currentTarget.value
      const next = (Object.keys(LIVE_MODELS) as SpeechModel[]).find((key) => key === value)
      if (next) onModelChange(next)
    }}>
      {model === 'unsupported' && <option value="unsupported" disabled>Unsupported model</option>}
      {Object.entries(LIVE_MODELS).map(([id, choice]) => <option key={id} value={id}>{choice.label}</option>)}
    </select>
    {model === 'web-speech' && <p className="meta">WebView2 may send microphone audio to its online speech service.</p>}
    <label title="Choose separate mono sessions per source or a single stereo session.">
      Audio stream mode
      <select value={features.stereo ? settings.transcription.audioMode : 'dual-mono'} disabled={disabled || !features.stereo}
        onChange={(event) => {
          const audioMode = event.currentTarget.value === 'stereo' ? 'stereo' : 'dual-mono'
          setSettings((previous) => ({ ...previous, transcription: { ...previous.transcription, audioMode } }))
        }}>
        <option value="dual-mono">{features.speakerLoopback ? 'Mono (separate sessions per audio device)' : 'Mono (default microphone)'}</option>
        <option value="stereo" disabled={!features.stereo}>Stereo (one session)</option>
      </select>
    </label>
    <label title={features.language === 'automatic' ? 'This model detects the language automatically' : undefined}>
      Primary language
      <select value={settings.language} disabled={disabled || features.language !== 'selectable'} onChange={(event) => {
        const language = event.currentTarget.value
        setSettings((previous) => ({ ...previous, language }))
      }}><SpeechLanguageOptions language={settings.language} /></select>
    </label>
    <label className="checkbox-field" title={stereo ? 'Unavailable in stereo mode' : undefined}>
      <input type="checkbox" checked={features.language === 'automatic' || (optionalLid && settings.autoLanguageDetection)}
        disabled={disabled || !optionalLid} onChange={(event) => {
          const autoLanguageDetection = event.currentTarget.checked
          setSettings((previous) => ({ ...previous, autoLanguageDetection }))
        }} />Automatic language detection
    </label>
    <label className="checkbox-field" title={features.diarization ? undefined : 'Speaker recognition is unavailable with this model'}>
      <input type="checkbox" checked={features.diarization && settings.diarization} disabled={disabled || !features.diarization} onChange={(event) => {
        const diarization = event.currentTarget.checked
        setSettings((previous) => ({ ...previous, diarization }))
      }} />Speaker recognition
    </label>
    <label className="checkbox-field" title={stereo ? 'Provisional stereo text may appear without a source label' : undefined}>
      <input type="checkbox" checked={features.interim && (features.azure ? azureInterim : settings.transcription.webInterimResults === true)}
        disabled={disabled || !features.interim} onChange={(event) => {
          const interimResults = event.currentTarget.checked
          if (features.azure) onAzureInterimChange(interimResults)
          else setSettings((previous) => ({ ...previous, transcription: { ...previous.transcription, webInterimResults: interimResults } }))
        }} />Enable interim results
    </label>
  </div>
}
