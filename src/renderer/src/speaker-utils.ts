import type { TranscriptSegment } from '@shared/transcript-contract'

export function getSpeakerKey(segment: Pick<TranscriptSegment, 'source' | 'speaker'>): string {
  return `${segment.source}:${segment.speaker.trim() || 'unknown'}`
}

/**
 * Sitzungsbezogene Sprecheridentitaet (T-507).
 *
 * Azure vergibt die Sprecher-IDs ("Guest-1", "Guest-2", ...) pro Sitzung neu.
 * "Guest-1" aus zwei verschiedenen Sitzungen koennen verschiedene Personen
 * sein. Deshalb gehoert die Session-ID untrennbar zur Identitaet: Alias-Zuordnung
 * und Segment-Merge duerfen sich nie ueber eine Sitzungsgrenze hinweg greifen.
 *
 * Format: "<sessionId>|<source>:<speaker>" — die Session-ID enthaelt kein "|".
 */
export function getSpeakerIdentity(
  segment: Pick<TranscriptSegment, 'source' | 'speaker' | 'sessionId'>
): string {
  const session = segment.sessionId?.trim()
  return `${session || 'unknown'}|${getSpeakerKey(segment)}`
}

/** Anzeigename einer Identitaet: "Mic - Guest-1" (ohne Session-Praefix). */
export function formatSpeakerIdentity(identity: string): string {
  const separator = identity.indexOf('|')
  return formatSpeakerKey(separator < 0 ? identity : identity.slice(separator + 1))
}

/** Farb-Slot einer Identitaet (je Quelle getrennte Palette). */
export function getSpeakerClassForIdentity(identity: string): string {
  const separator = identity.indexOf('|')
  return getSpeakerClass(separator < 0 ? identity : identity.slice(separator + 1))
}

export function formatSpeakerKey(key: string): string {
  const separator = key.indexOf(':')
  if (separator < 0) return key
  const source = key.slice(0, separator)
  const speaker = key.slice(separator + 1)
  return `${source === 'mic' ? 'Mic' : 'Speaker'} · ${speaker}`
}

export function getSpeakerClass(key: string): string {
  const separator = key.indexOf(':')
  const source = separator < 0 ? '' : key.slice(0, separator)
  const speaker = (separator < 0 ? key : key.slice(separator + 1)).toLowerCase()

  if (speaker.includes('unknown')) return 'speaker-unknown'
  if (speaker.includes('self')) return 'speaker-mic-self'

  const numbered = speaker.match(/(?:guest|speaker|participant|user)[\s:_-]?(\d{1,3})/)
  const number = numbered ? Number(numbered[1]) : speaker.includes('guest') ? 1 : 0
  if (number < 1) return ''
  const offset = source === 'mic' ? 15 : 0
  return `speaker-guest-${((number - 1 + offset) % 30) + 1}`
}
