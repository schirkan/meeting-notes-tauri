import type { RefObject } from 'react'
import type { TranscriptSegment } from '@shared/transcript-contract'

type TranscriptPanelProps = {
  segments: TranscriptSegment[]
  transcriptListRef: RefObject<HTMLUListElement | null>
  getSpeakerClass: (speaker: string) => string
  getSpeakerLabel: (speaker: string) => string
  canCopyTranscript: boolean
  onCopyTranscript: () => Promise<void>
}

export function TranscriptPanel(props: TranscriptPanelProps) {
  const { segments, transcriptListRef, getSpeakerClass, getSpeakerLabel, canCopyTranscript, onCopyTranscript } = props

  return (
    <section className="panel transcript-panel">
      <div className="panel-header">
        <h2>Transkript</h2>
        <button className="hero-icon-button transcript-copy-button" type="button" onClick={() => void onCopyTranscript()} disabled={!canCopyTranscript} aria-label="Transkript kopieren">
          ⧉
        </button>
      </div>
      {segments.length === 0 ? (
        <p className="empty">Noch keine Daten.</p>
      ) : (
        <ul ref={transcriptListRef} className="transcript-list">
          {segments.map((segment) => (
            <li key={segment.id} className={`segment ${segment.state}`}>
              <div className="segment-text">{segment.text}</div>
              <div className="segment-meta">
                <span className="meta">{new Date(segment.timestampIso).toLocaleTimeString('de-DE')}</span>
                <span className="meta">{segment.language}</span>
                <span className={`speaker-badge ${getSpeakerClass(segment.speaker)}`.trim()}>{getSpeakerLabel(segment.speaker)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
