import type { BatchAudioSource, BatchAudioTrack, TranscriptStatus } from '@shared/transcript-contract'

export const BATCH_SOURCES = ['mic', 'speaker'] as const
export type BatchAudioSlots = Partial<Record<BatchAudioSource, { path: string; startedAt: string; estimated: boolean }>>
const localStartPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/
const dayMs = 86_400_000

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
    const entered = slot.startedAt.trim()
    const name = source === 'mic' ? 'microphone' : 'speaker'
    if (!entered) throw new Error(`Enter the ${name} start time before transcribing.`)
    let value = entered
    if (localStartPattern.test(entered)) {
      const choices = localTrackStartChoices(entered)
      if (choices.length > 1) throw new Error(`Choose the UTC offset for the ambiguous ${name} start time.`)
      if (choices.length === 0) throw new Error(`Enter a valid local ${name} start time.`)
      value = choices[0].startedAt
    }
    const timestamp = Date.parse(value)
    const date = value.slice(0, 10)
    const midnight = new Date(`${date}T00:00:00Z`)
    if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i.test(value) ||
      !Number.isFinite(timestamp) || !Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== date) {
      throw new Error(`Enter a valid ${name} start time with a UTC offset or Z.`)
    }
    return [{ path: slot.path, source, startedAt: value }]
  })
}

export function earliestTrackStart(tracks: BatchAudioTrack[]): string | undefined {
  return tracks.map(({ startedAt }) => startedAt).sort((a, b) => Date.parse(a) - Date.parse(b))[0]
}

export function localTrackStart(value: string): string {
  if (value && !/(Z|[+-]\d{2}:\d{2})$/i.test(value)) return value
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, -1)
}

export function localTrackStartChoices(value: string): { startedAt: string; label: string }[] {
  if (!localStartPattern.test(value)) return []
  const wallTime = Date.parse(`${value}Z`)
  if (!Number.isFinite(wallTime)) return []
  // Sample both sides of a potential DST change, then check which offsets
  // actually map to the entered wall time (zero for a skipped clock hour).
  const offsets = new Set([-dayMs, 0, dayMs].map((delta) => new Date(wallTime + delta).getTimezoneOffset()))
  return [...offsets].sort((a, b) => a - b).flatMap((minutes) => {
    const startedAt = new Date(wallTime + minutes * 60_000).toISOString()
    if (!localTrackStart(startedAt).startsWith(value)) return []
    const absolute = Math.abs(minutes)
    const hours = String(Math.floor(absolute / 60)).padStart(2, '0')
    const remainder = String(absolute % 60).padStart(2, '0')
    return [{ startedAt, label: `UTC${minutes > 0 ? '-' : '+'}${hours}:${remainder}` }]
  })
}
