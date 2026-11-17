import type { TranscriptApi } from '@shared/transcript-contract'
import type { SidecarCrashedPayload } from '@shared/tauri-contract'

declare global {
  interface Window {
    transcriptApi: TranscriptApi
    /**
     * T-300: Der Sidecar-Crash ist ein Tauri-internes Ereignis und liegt
     * deshalb nicht in der TranscriptApi. Optional, weil der Preload in
     * Testlaeufen durch einen Stub ersetzt wird.
     */
    transcriptSidecar?: {
      onCrashed: (cb: (payload: SidecarCrashedPayload) => void) => () => void
    }
  }
}

export {}
