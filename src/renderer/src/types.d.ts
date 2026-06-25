import type { TranscriptApi } from '@shared/transcript-contract'

declare global {
  interface Window {
    transcriptApi: TranscriptApi
  }
}

export {}
