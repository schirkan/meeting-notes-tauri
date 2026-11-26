import type { TranscriptSegment } from '@shared/transcript-contract'

type RecognitionResult = ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }

interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
  onresult: ((event: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null
  start(): void
  stop(): void
  abort(): void
}

type RecognitionConstructor = new () => Recognition

function recognitionConstructor(): RecognitionConstructor | undefined {
  if (typeof window === 'undefined') return undefined
  const host = window as Window & {
    SpeechRecognition?: RecognitionConstructor
    webkitSpeechRecognition?: RecognitionConstructor
  }
  if (typeof host.SpeechRecognition === 'function') return host.SpeechRecognition
  if (typeof host.webkitSpeechRecognition === 'function') return host.webkitSpeechRecognition
}

/** API presence only; microphone permission and service availability are checked on start. */
export function canUseWebSpeech(): boolean {
  return recognitionConstructor() !== undefined
}

export interface WebSpeechSessionOptions {
  language: string
  interimResults?: boolean
  onSegment: (segment: TranscriptSegment) => void
  /** Unexpected termination after readiness; explicit stop/abort never calls this. */
  onEnded: (error?: string) => void
}

const startTimeoutMs = 10_000
const stopTimeoutMs = 3_000
const cancelled = 'Web Speech recognition was cancelled.'
let nextSession = 0

function recognitionError(code: string): string {
  switch (code) {
    case 'not-allowed': return 'Microphone access was denied for Web Speech recognition.'
    case 'service-not-allowed': return 'The Web Speech recognition service is not permitted by this WebView.'
    case 'audio-capture': return 'Web Speech recognition could not access the default microphone.'
    case 'network': return 'Web Speech recognition could not reach the speech service. Check your network connection.'
    case 'language-not-supported': return 'The selected language is not supported by Web Speech recognition.'
    case 'no-speech': return 'Web Speech recognition did not detect any speech.'
    case 'aborted': return 'Web Speech recognition was interrupted.'
    default: return 'Web Speech recognition failed.'
  }
}

function nativeError(error: unknown, fallback: string): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return recognitionError('not-allowed')
    if (error.name === 'NotFoundError' || error.name === 'NotReadableError') return recognitionError('audio-capture')
    if (error.name === 'NetworkError') return recognitionError('network')
    if (error.name === 'NotSupportedError') return 'Web Speech recognition is not supported in this WebView.'
  }
  return fallback
}

/** One manual capture. Create a new instance for every recording; no automatic restart. */
export class WebSpeechSession {
  readonly sessionId = `web-speech-${Date.now()}-${++nextSession}`
  private recognition?: Recognition
  private phase: 'idle' | 'starting' | 'listening' | 'stopping' | 'ended' = 'idle'
  private settle?: (error?: string) => void
  private stopPromise?: Promise<void>

  constructor(private readonly options: WebSpeechSessionOptions) {}

  /** Call directly from the user's Start gesture. Resolves only when recognition starts listening. */
  async start(): Promise<void> {
    if (this.phase !== 'idle') throw new Error('This Web Speech session has already been used.')
    this.phase = 'starting'
    try {
      const ctor = recognitionConstructor()
      if (!ctor) throw new Error('Web Speech recognition is not available in this WebView.')
      const language = this.options.language.trim()
      if (!language || language.toLowerCase() === 'auto') {
        throw new Error('Select a specific language for Web Speech recognition.')
      }

      let recognition: Recognition
      try {
        recognition = new ctor()
        this.recognition = recognition
        recognition.lang = language
        recognition.continuous = true
        recognition.interimResults = this.options.interimResults === true
      } catch (error) {
        throw new Error(nativeError(error, 'Web Speech recognition could not be initialized in this WebView.'))
      }

      recognition.onstart = () => {
        if (this.phase !== 'starting') return
        this.phase = 'listening'
        this.settle?.()
      }
      recognition.onend = () => {
        const error = this.phase === 'stopping' ? undefined : this.phase === 'starting'
          ? 'Web Speech recognition ended before listening started.'
          : 'Web Speech recognition ended unexpectedly.'
        this.finish(error)
      }
      recognition.onerror = ({ error }) => this.finish(recognitionError(error), true)
      recognition.onresult = ({ resultIndex, results }) => {
        for (let index = resultIndex; index < results.length; index++) {
          if (this.phase !== 'listening' && this.phase !== 'stopping') return
          const result = results[index]
          if (!result.isFinal && (this.phase === 'stopping' || !recognition.interimResults)) continue
          const alternative = result[0]
          const text = alternative?.transcript.trim()
          if (!text) continue
          this.options.onSegment({
            id: `${this.sessionId}-${index}`,
            sessionId: this.sessionId,
            source: 'mic',
            speaker: 'self',
            language,
            timestampIso: new Date().toISOString(),
            text,
            state: result.isFinal ? 'final' : 'interim',
            confidence: alternative.confidence
          })
        }
      }

      const ready = this.wait(startTimeoutMs, 'Web Speech recognition did not start listening in time.')
      try {
        // No MediaStream/device argument: the WebView uses its default microphone.
        recognition.start()
      } catch (error) {
        this.finish(nativeError(error, 'Web Speech recognition could not start.'), true)
      }
      await ready
    } catch (error) {
      // Constructor/configuration failures precede installation of the readiness wait.
      this.finish(undefined, true)
      throw error
    }
  }

  /** Waits for finals and end, rejecting on failure or timeout. Cancels an in-flight start. */
  stop(): Promise<void> {
    if (this.phase === 'stopping') return this.stopPromise!
    if (this.phase === 'starting') this.abort()
    if (this.phase !== 'listening' || !this.recognition) return Promise.resolve()

    this.phase = 'stopping'
    const stopped = this.wait(stopTimeoutMs, 'Web Speech recognition did not finish stopping in time.')
    this.stopPromise = stopped
    try {
      this.recognition.stop()
    } catch (error) {
      this.finish(nativeError(error, 'Web Speech recognition could not stop cleanly.'), true)
    }
    return stopped
  }

  /** Cancels capture and disconnects handlers synchronously, suppressing all later results. */
  abort(): void {
    this.finish(cancelled, true, false)
  }

  private wait(timeoutMs: number, timeoutError: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => this.finish(timeoutError, true), timeoutMs)
      this.settle = (error) => {
        clearTimeout(timeout)
        this.settle = undefined
        if (error) reject(new Error(error))
        else resolve()
      }
    })
  }

  private finish(error?: string, abortNative = false, notify = true): void {
    if (this.phase === 'ended') return
    const wasListening = this.phase === 'listening'
    this.phase = 'ended'
    const recognition = this.recognition
    this.recognition = undefined
    this.stopPromise = undefined
    if (recognition) {
      recognition.onstart = recognition.onend = recognition.onerror = recognition.onresult = null
      if (abortNative) {
        try { recognition.abort() } catch { /* Browser already closed the capture. */ }
      }
    }
    this.settle?.(error)
    if (wasListening && notify) this.options.onEnded(error)
  }
}
