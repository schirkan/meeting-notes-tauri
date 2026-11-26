import type { AzureSpeechModel, SpeechModel, TranscriptionMode, TranscriptionSettings } from './config-contract.js'

type BatchModel = Exclude<SpeechModel, 'web-speech'>
export type SpeechChoice = SpeechModel | `${BatchModel}-batch`

type SpeechFeatures = {
  label: string
  azure: boolean
  endpoint: boolean
  stereo: boolean
  speakerLoopback: boolean
  selectDevices: boolean
  language: 'selectable' | 'automatic' | 'managed'
  optionalLanguageDetection: boolean
  diarization: boolean
  interim: boolean
  autoStart: boolean
  pause: boolean
  test: 'azure' | 'native' | 'web'
}

const LIVE_MODELS = {
  standard: { label: 'Azure Speech (standard)', azure: true, endpoint: true, stereo: true, speakerLoopback: true, selectDevices: true, language: 'selectable', optionalLanguageDetection: true, diarization: true, interim: true, autoStart: true, pause: true, test: 'azure' },
  'mai-transcribe-2-streaming': { label: 'Azure MAI Transcribe (Preview)', azure: true, endpoint: false, stereo: false, speakerLoopback: true, selectDevices: true, language: 'automatic', optionalLanguageDetection: false, diarization: false, interim: true, autoStart: true, pause: true, test: 'azure' },
  'windows-sapi': { label: 'Windows SAPI (Experimental)', azure: false, endpoint: false, stereo: false, speakerLoopback: true, selectDevices: true, language: 'selectable', optionalLanguageDetection: false, diarization: false, interim: false, autoStart: true, pause: true, test: 'native' },
  'windows-ai-speech': { label: 'Windows AI Speech (Experimental)', azure: false, endpoint: false, stereo: false, speakerLoopback: false, selectDevices: false, language: 'managed', optionalLanguageDetection: false, diarization: false, interim: false, autoStart: false, pause: false, test: 'native' },
  'web-speech': { label: 'Web Speech API (Experimental)', azure: false, endpoint: false, stereo: false, speakerLoopback: false, selectDevices: false, language: 'selectable', optionalLanguageDetection: false, diarization: false, interim: true, autoStart: false, pause: false, test: 'web' },
} as const satisfies Record<SpeechModel, SpeechFeatures>

const batchCapture = { stereo: false, speakerLoopback: true, selectDevices: true, interim: false, autoStart: true, pause: false } as const

export const SPEECH_MODELS = {
  standard: { ...LIVE_MODELS.standard, model: 'standard', mode: 'live' },
  'mai-transcribe-2-streaming': { ...LIVE_MODELS['mai-transcribe-2-streaming'], model: 'mai-transcribe-2-streaming', mode: 'live' },
  'windows-sapi': { ...LIVE_MODELS['windows-sapi'], model: 'windows-sapi', mode: 'live' },
  'windows-ai-speech': { ...LIVE_MODELS['windows-ai-speech'], model: 'windows-ai-speech', mode: 'live' },
  'web-speech': { ...LIVE_MODELS['web-speech'], model: 'web-speech', mode: 'live' },
  'standard-batch': { ...LIVE_MODELS.standard, ...batchCapture, label: 'Azure Speech (standard) — Batch', model: 'standard', mode: 'batch' },
  'mai-transcribe-2-streaming-batch': { ...LIVE_MODELS['mai-transcribe-2-streaming'], ...batchCapture, endpoint: true, language: 'selectable', optionalLanguageDetection: true, diarization: true, label: 'Azure MAI Transcribe (Preview) — Batch', model: 'mai-transcribe-2-streaming', mode: 'batch' },
  'windows-sapi-batch': { ...LIVE_MODELS['windows-sapi'], ...batchCapture, label: 'Windows SAPI (Experimental) — Batch', model: 'windows-sapi', mode: 'batch' },
  'windows-ai-speech-batch': { ...LIVE_MODELS['windows-ai-speech'], ...batchCapture, label: 'Windows AI Speech (Experimental) — Batch', model: 'windows-ai-speech', mode: 'batch' }
} as const satisfies Record<SpeechChoice, SpeechFeatures & { model: SpeechModel; mode: TranscriptionMode }>

export function selectedSpeechChoice(settings: TranscriptionSettings, azureModel: AzureSpeechModel = 'standard'): SpeechChoice | 'unsupported' {
  if (settings.mode === 'unsupported') return 'unsupported'
  const model = settings.provider ?? azureModel
  if (settings.mode !== 'batch') return model
  return model === 'unsupported' || model === 'web-speech' ? 'unsupported' : `${model}-batch`
}

export function speechFeatures(choice: SpeechChoice | 'unsupported'): SpeechFeatures & { model: SpeechModel | 'unsupported'; mode: TranscriptionMode } {
  return choice === 'unsupported'
    ? { ...SPEECH_MODELS['web-speech'], model: 'unsupported', label: 'Unsupported model', interim: false }
    : SPEECH_MODELS[choice]
}
