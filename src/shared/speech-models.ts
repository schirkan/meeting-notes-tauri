import type { AzureSpeechModel, SpeechModel, TranscriptionMode, TranscriptionSettings } from './config-contract.js'

export type BatchModel = Exclude<SpeechModel, 'web-speech'>

type SpeechFeatures = {
  label: string
  azure: boolean
  endpoint: boolean
  stereo: boolean
  speakerLoopback: boolean
  selectDevices: boolean
  language: 'selectable' | 'automatic'
  optionalLanguageDetection: boolean
  diarization: boolean
  interim: boolean
  autoStart: boolean
  pause: boolean
  test: 'azure' | 'native' | 'web'
}

export const LIVE_MODELS = {
  standard: { label: 'Azure Speech (standard)', azure: true, endpoint: true, stereo: true, speakerLoopback: true, selectDevices: true, language: 'selectable', optionalLanguageDetection: true, diarization: true, interim: true, autoStart: true, pause: true, test: 'azure' },
  'mai-transcribe-2-streaming': { label: 'Azure MAI Transcribe (Preview)', azure: true, endpoint: false, stereo: false, speakerLoopback: true, selectDevices: true, language: 'automatic', optionalLanguageDetection: false, diarization: false, interim: true, autoStart: true, pause: true, test: 'azure' },
  'windows-sapi': { label: 'Windows SAPI (Experimental)', azure: false, endpoint: false, stereo: false, speakerLoopback: true, selectDevices: true, language: 'selectable', optionalLanguageDetection: false, diarization: false, interim: false, autoStart: true, pause: true, test: 'native' },
  'web-speech': { label: 'Web Speech API (Experimental)', azure: false, endpoint: false, stereo: false, speakerLoopback: false, selectDevices: false, language: 'selectable', optionalLanguageDetection: false, diarization: false, interim: true, autoStart: false, pause: false, test: 'web' },
} as const satisfies Record<SpeechModel, SpeechFeatures>

export const BATCH_MODELS = {
  standard: LIVE_MODELS.standard.label,
  'mai-transcribe-2-streaming': LIVE_MODELS['mai-transcribe-2-streaming'].label,
  'windows-sapi': LIVE_MODELS['windows-sapi'].label,
} satisfies Record<BatchModel, string>

export function meetingSpeechFeatures(settings: TranscriptionSettings, azureModel: AzureSpeechModel = 'standard'): SpeechFeatures & { model: SpeechModel | 'unsupported'; mode: TranscriptionMode } {
  const model = settings.mode === 'unsupported' ? 'unsupported' : settings.provider ?? azureModel
  if (settings.mode === 'batch') return {
    ...LIVE_MODELS.standard, model, mode: 'batch', label: 'Local recording',
    speakerLoopback: true, selectDevices: true, autoStart: true,
    stereo: false, interim: false, pause: false
  }
  return model === 'unsupported'
    ? { ...LIVE_MODELS['web-speech'], model, mode: 'live', label: 'Unsupported model', interim: false }
    : { ...LIVE_MODELS[model], model, mode: 'live' }
}
