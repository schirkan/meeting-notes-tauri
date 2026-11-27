import { BATCH_MODELS, type BatchModel } from '@shared/speech-models'
import type { BatchAudioSource } from '@shared/transcript-contract'
import { BATCH_SOURCES, type BatchAudioSlots } from '../batch-audio'

const sourceLabels = { mic: 'Microphone', speaker: 'Speaker' }

type BatchAudioPanelProps = {
  slots: BatchAudioSlots
  model: BatchModel
  action: 'pick' | 'transcribe' | null
  disabled: boolean
  onModelChange: (model: BatchModel) => void
  onPick: (source: BatchAudioSource) => Promise<void>
  onClear: (source: BatchAudioSource) => void
  onChangeStart: (source: BatchAudioSource, startedAt: string) => void
  onCheckModel: () => Promise<void>
  onTranscribe: () => Promise<void>
}

export function BatchAudioPanel(props: BatchAudioPanelProps) {
  const { slots, model, action, disabled } = props
  const hasBoth = !!slots.mic && !!slots.speaker
  const native = model === 'windows-sapi' || model === 'windows-ai-speech'
  const oneSourceOnly = model === 'windows-ai-speech' && hasBoth
  return (
    <section id="batch-audio" className="batch-audio-controls" aria-label="Batch transcription">
      <label className="batch-model-field">
        <span className="field-caption">File transcription model</span>
        <select value={model} onChange={(event) => props.onModelChange(event.currentTarget.value as BatchModel)} disabled={disabled}>
          {Object.entries(BATCH_MODELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
      <p className="meta">Assign at least one WAV and a start time for each. Start times describe the first audio sample, not the first spoken words.</p>
      <div className="batch-audio-slots">
        {BATCH_SOURCES.map((source) => {
          const label = sourceLabels[source]
          const slot = slots[source]
          return (
            <fieldset key={source} disabled={disabled}>
              <legend>{label} WAV</legend>
              <div className="batch-audio-actions">
                <button className="secondary-button" type="button" onClick={() => void props.onPick(source)}>Choose {label.toLowerCase()} WAV</button>
                {slot && <button className="secondary-button" type="button" onClick={() => props.onClear(source)}>Remove {label.toLowerCase()} WAV</button>}
              </div>
              {slot && <>
                <p className="meta-path">{slot.path}</p>
                <label>
                  <span className="field-caption">{label} start time</span>
                  <input type="text" required value={slot.startedAt} placeholder="2026-11-27T16:00:00Z"
                    aria-describedby={`batch-${source}-time-hint`}
                    onChange={(event) => props.onChangeStart(source, event.currentTarget.value)} />
                </label>
                <p className="meta" id={`batch-${source}-time-hint`}>
                  {slot.estimated ? 'Estimated from the file’s timestamp. ' : ''}
                  {slot.startedAt ? 'ISO date and time with a UTC offset or Z.' : 'Start time unknown. Enter an ISO date and time with a UTC offset or Z.'}
                </p>
              </>}
            </fieldset>
          )
        })}
      </div>
      {model === 'windows-ai-speech' && <p className="meta">Windows AI Speech accepts one source only and requires the experimental packaged build.{oneSourceOnly && ' Remove one WAV or select another model.'}</p>}
      {!native && <p className="meta">Azure receives only the WAVs listed above, after you confirm.</p>}
      <div className="batch-audio-actions">
        <button className="secondary-button" type="button" onClick={() => void props.onTranscribe()}
          disabled={disabled || oneSourceOnly || (!slots.mic && !slots.speaker)}>
          {action === 'transcribe' ? 'Transcribing…' : 'Transcribe'}
        </button>
        {native && <button className="secondary-button" type="button" onClick={() => void props.onCheckModel()} disabled={disabled}>Check model availability</button>}
      </div>
    </section>
  )
}
