import type { BatchAudioSource, BatchAudioTrack, TranscriptStatus } from '@shared/transcript-contract'

export const BATCH_SOURCES = ['mic', 'speaker'] as const
export type BatchAudioSlots = Partial<Record<BatchAudioSource, { path: string; startedAt: string; estimated: boolean }>>

export function slotsFromRecording(recording: NonNullable<TranscriptStatus['recording']>): BatchAudioSlots {
  const { startedAt, micPath, speakerPath } = recording
  return {
    ...(micPath ? { mic: { path: micPath, startedAt, estimated: false } } : {}),
    ...(speakerPath ? { speaker: { path: speakerPath, startedAt, estimated: false } } : {})
  }
}

export function batchTracks(slots: BatchAudioSlots): BatchAudioTrack[] {
  return BATCH_SOURCES.flatMap((source) => {
    const slot = slots[source]
    if (!slot) return []
    const value = slot.startedAt.trim()
    const name = source === 'mic' ? 'microphone' : 'speaker'
    if (!value) throw new Error(`Enter the ${name} start time before transcribing.`)
    const timestamp = Date.parse(value)
    const date = value.slice(0, 10)
    const midnight = new Date(`${date}T00:00:00Z`)
    if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i.test(value) ||
      !Number.isFinite(timestamp) || !Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== date) {
      throw new Error(`Enter a valid ${name} start time with a UTC offset or Z.`)
    }
    return [{ path: slot.path, source, startedAt: new Date(timestamp).toISOString() }]
  })
}

export function earliestTrackStart(tracks: BatchAudioTrack[]): string | undefined {
  // batchTracks normalizes timestamps to UTC ISO strings before submission.
  return tracks.map(({ startedAt }) => startedAt).sort()[0]
}
