// Shared transcript rendering (T-506).
//
// One place builds the Markdown document, so the clipboard copy and the
// automatic file export produce identical output. The document starts with
// YAML frontmatter that carries the session metadata, followed by the
// transcript body as a Markdown list.

import type { TranscriptSegment } from './transcript-contract'

export interface TranscriptMetadata {
  title: string
  date: string
  start: string
  end: string
  duration: string
  language: string
  segments: number
  speakers: string[]
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function toDate(date: Date): Date {
  return Number.isNaN(date.getTime()) ? new Date(0) : date
}

export function formatLocalDate(date: Date): string {
  const value = toDate(date)
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

export function formatLocalIsoWithOffset(date: Date): string {
  const value = toDate(date)
  const offsetMinutes = -value.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absolute = Math.abs(offsetMinutes)
  return `${formatLocalDate(value)}T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
}

export function formatDuration(start: Date, end: Date): string {
  const seconds = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds % 60)}`
}

export function formatClockTime(date: Date): string {
  const value = toDate(date)
  return `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function buildTranscriptMetadata(
  segments: TranscriptSegment[],
  now: Date = new Date()
): TranscriptMetadata {
  const finals = segments.filter((segment) => segment.state === 'final')
  const first = finals[0]
  const last = finals[finals.length - 1]
  const start = first ? new Date(first.timestampIso) : now
  const end = last ? new Date(last.timestampIso) : start
  const safeStart = Number.isNaN(start.getTime()) ? now : start
  const safeEnd = Number.isNaN(end.getTime()) ? safeStart : end
  const speakers = [
    ...new Set(finals.map((segment) => segment.speaker.trim()).filter((speaker) => speaker.length > 0))
  ]
  const language = finals.find((segment) => segment.language)?.language ?? 'de-DE'

  return {
    title: `Meeting Notes ${formatLocalDate(safeStart)}`,
    date: formatLocalDate(safeStart),
    start: formatLocalIsoWithOffset(safeStart),
    end: formatLocalIsoWithOffset(safeEnd),
    duration: formatDuration(safeStart, safeEnd),
    language,
    segments: finals.length,
    speakers
  }
}

export function buildTranscriptFrontmatter(metadata: TranscriptMetadata): string {
  const lines = [
    '---',
    `title: ${quote(metadata.title)}`,
    `date: ${quote(metadata.date)}`,
    `start: ${quote(metadata.start)}`,
    `end: ${quote(metadata.end)}`,
    `duration: ${quote(metadata.duration)}`,
    `language: ${quote(metadata.language)}`,
    `segments: ${metadata.segments}`,
    'speakers:'
  ]
  if (metadata.speakers.length === 0) {
    lines.push('  []')
  } else {
    for (const speaker of metadata.speakers) {
      lines.push(`  - ${quote(speaker)}`)
    }
  }
  lines.push('---')
  return lines.join('\n')
}

export function buildTranscriptBody(segments: TranscriptSegment[]): string {
  return segments
    .filter((segment) => segment.state === 'final')
    .map((segment) => {
      const time = formatClockTime(new Date(segment.timestampIso))
      const language = segment.language ? ` (${segment.language})` : ''
      return `- [${time}] ${segment.speaker}${language}: ${segment.text}`
    })
    .join('\n')
}

export function buildTranscriptMarkdown(
  segments: TranscriptSegment[],
  now: Date = new Date()
): string {
  const metadata = buildTranscriptMetadata(segments, now)
  const frontmatter = buildTranscriptFrontmatter(metadata)
  const body = buildTranscriptBody(segments)
  return body.length === 0 ? frontmatter : `${frontmatter}\n\n${body}`
}
