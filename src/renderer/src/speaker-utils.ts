import type { TranscriptSegment } from '@shared/transcript-contract'

export function getSpeakerKey(segment: Pick<TranscriptSegment, 'source' | 'speaker'>): string {
  return `${segment.source}:${segment.speaker.trim() || 'unknown'}`
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
