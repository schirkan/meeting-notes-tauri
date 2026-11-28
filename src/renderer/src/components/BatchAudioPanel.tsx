import type { FileTranscriptionSettings } from '@shared/config-contract'
import { BATCH_MODELS } from '@shared/speech-models'
import type { BatchAudioSource } from '@shared/transcript-contract'
import { BATCH_SOURCES, localTrackStart, localTrackStartChoices, type BatchAudioSlots } from '../batch-audio'
import { Icon } from './Icon'
import { SpeechLanguageOptions } from './SpeechLanguageOptions'

const sourceLabels = { mic: 'Microphone', speaker: 'Speaker' }

type BatchAudioPanelProps = {
  slots: BatchAudioSlots
  defaults: FileTranscriptionSettings
  action: 'pick' | 'transcribe' | null
  disabled: boolean
  onDefaultsChange: (update: Partial<FileTranscriptionSettings>) => void
  onPick: (source: BatchAudioSource) => Promise<void>
  onClear: (source: BatchAudioSource) => void
  onChangeStart: (source: BatchAudioSource, startedAt: string) => void
  onCheckModel: () => Promise<void>
  onTranscribe: () => Promise<void>
}

export function BatchAudioPanel(props: BatchAudioPanelProps) {
  const { slots, defaults, action, disabled } = props
  const { model } = defaults
  const native = model === 'windows-sapi'
  const hasFiles = Boolean(slots.mic || slots.speaker)
  return (
    <section className="home-workflow" aria-labelledby="file-workflow-heading">
      <header><h2 id="file-workflow-heading">Transcribe audio files</h2><p className="meta">Create a transcript from existing WAV recordings.</p></header>
      <section className="home-files" aria-labelledby="audio-files-heading">
        <h3 id="audio-files-heading">Audio files</h3>
        {BATCH_SOURCES.map((source) => {
          const label = sourceLabels[source]
          const slot = slots[source]
          const localStart = localTrackStart(slot?.startedAt ?? '')
          const choices = localTrackStartChoices(localStart)
          const offsetSelection = slot && slot.startedAt !== localStart
            ? choices.find((choice) => Date.parse(choice.startedAt) === Date.parse(slot.startedAt))?.startedAt ?? ''
            : ''
          return (
            <fieldset key={source} disabled={disabled}>
              <legend className="field-caption"><Icon name={source} />{label} WAV</legend>
              <div className="home-file-picker">
                <div className="home-file-path">
                  <input readOnly aria-label={`${label} WAV file path`} value={slot?.path ?? ''} title={slot?.path} placeholder="No WAV selected" />
                  {slot && <button type="button" aria-label={`Remove ${label.toLowerCase()} WAV`} title="Clear selection (keeps the file)" onClick={() => props.onClear(source)}><Icon name="close" /></button>}
                </div>
                <button type="button" aria-label={`Select file for ${label.toLowerCase()} WAV`} onClick={() => void props.onPick(source)}>Select file</button>
              </div>
              <label>
                {label} start time
                <input type="datetime-local" step="any" required disabled={!slot} value={localStart}
                  title={slot?.estimated ? 'Estimated from the file timestamp. Adjust to the first audio sample if needed.' : 'Start time of the first audio sample (local time).'}
                  onChange={(event) => props.onChangeStart(source, event.currentTarget.value)} />
              </label>
              {choices.length > 1 && <label>
                {label} UTC offset
                <select required value={offsetSelection} onChange={(event) => props.onChangeStart(source, event.currentTarget.value)}>
                  <option value="" disabled>Choose an offset</option>
                  {choices.map(({ startedAt, label: offset }) => <option key={startedAt} value={startedAt}>{offset}</option>)}
                </select>
              </label>}
            </fieldset>
          )
        })}
      </section>
      <div className="home-fields">
        <h3 id="file-model-heading">Transcription model</h3>
        <select aria-labelledby="file-model-heading" value={model} disabled={disabled} onChange={(event) => {
          const value = event.currentTarget.value
          if (value === 'standard' || value === 'mai-transcribe-2-streaming' || value === 'windows-sapi') props.onDefaultsChange({ model: value })
        }}>
          {Object.entries(BATCH_MODELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <label>Language
          <select value={!native && defaults.autoLanguageDetection ? 'auto' : defaults.language} disabled={disabled}
            title={native ? 'Choose a language with an installed Windows speech recognizer.' : undefined} onChange={(event) => {
              const language = event.currentTarget.value
              if (language === 'auto') props.onDefaultsChange({ autoLanguageDetection: true })
              else props.onDefaultsChange({ language, ...(native ? {} : { autoLanguageDetection: false }) })
            }}>
            <option value="auto" disabled={native}>Auto-detect</option>
            <SpeechLanguageOptions language={defaults.language} />
          </select>
        </label>
        <label className="checkbox-field" title={native ? 'Windows SAPI does not support speaker recognition' : undefined}>
          <input type="checkbox" checked={!native && defaults.diarization} disabled={disabled || native}
            onChange={(event) => props.onDefaultsChange({ diarization: event.currentTarget.checked })} />Speaker recognition
        </label>
      </div>
      <div className="home-actions">
        {!hasFiles && <span className="meta" id="transcribe-hint">Select at least one WAV to continue.</span>}
        {native && <button type="button" onClick={() => void props.onCheckModel()} disabled={disabled}>Check model availability</button>}
        <button className="primary-button" type="button" onClick={() => void props.onTranscribe()}
          aria-describedby={!hasFiles ? 'transcribe-hint' : undefined} disabled={disabled || !hasFiles}>
          {action === 'transcribe' ? 'Transcribing…' : 'Transcribe'}
        </button>
      </div>
    </section>
  )
}
