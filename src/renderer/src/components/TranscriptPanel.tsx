import { useEffect, useRef, useState, type RefObject } from 'react'
import type { TranscriptSegment } from '@shared/transcript-contract'
import { formatTranscriptSource, getSpeakerClassForIdentity, getSpeakerIdentity, hasIdentifiedSpeaker } from '../speaker-utils'
import { Icon } from './Icon'

type TranscriptPanelProps = {
  segments: TranscriptSegment[]
  transcriptListRef: RefObject<HTMLUListElement | null>
  getSpeakerLabel: (speaker: string) => string
  speakerAliases: Record<string, string>
  setSpeakerAliases: React.Dispatch<React.SetStateAction<Record<string, string>>>
  following: boolean
  onFollow: () => void
}

function TranscriptRow({ segment, getSpeakerLabel, speakerAliases, setSpeakerAliases }: Pick<TranscriptPanelProps,
  'getSpeakerLabel' | 'speakerAliases' | 'setSpeakerAliases'> & { segment: TranscriptSegment }) {
  const identity = getSpeakerIdentity(segment)
  const identified = hasIdentifiedSpeaker(segment)
  const label = identified ? getSpeakerLabel(identity) : formatTranscriptSource(segment.source)
  const [editing, setEditing] = useState(false)
  const originalAlias = useRef<string | undefined>(undefined)
  const inputRef = useRef<HTMLInputElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (editing) { inputRef.current?.focus(); inputRef.current?.select() }
  }, [editing])
  const setAlias = (value: string | undefined) => setSpeakerAliases((previous) => {
    const next = { ...previous }
    if (value === undefined) delete next[identity]
    else next[identity] = value
    return next
  })
  const finish = () => {
    setEditing(false)
    requestAnimationFrame(() => buttonRef.current?.focus())
  }

  return (
    <li className={`segment ${segment.state}`}>
      <div className="segment-heading">
        {identified ? <div className={`speaker-editor speaker-tone ${getSpeakerClassForIdentity(identity)}`}>
          <button ref={buttonRef} className="speaker-badge" type="button" hidden={editing} title={`Change speaker name: ${label}`}
            onClick={() => { originalAlias.current = speakerAliases[identity]; setAlias(label); setEditing(true) }}>{label}</button>
          {editing && <input ref={inputRef} aria-label="Speaker name" value={speakerAliases[identity] ?? ''}
            onChange={(event) => setAlias(event.target.value)} onBlur={() => setEditing(false)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { event.preventDefault(); setAlias(originalAlias.current); finish() }
              if (event.key === 'Enter') { event.preventDefault(); finish() }
            }} />}
        </div> : label && <div className="speaker-editor speaker-tone"><span className="speaker-badge">{label}</span></div>}
        <span className="segment-meta">{new Date(segment.timestampIso).toLocaleTimeString('en-US')}{segment.language && ` | ${segment.language}`}</span>
      </div>
      <div className="segment-text">{segment.text}</div>
    </li>
  )
}

export function TranscriptPanel(props: TranscriptPanelProps) {
  return (
    <section className="console-transcript transcript-panel" aria-label="Transcript">
      {props.segments.length > 0 && <div className="console-column-labels"><span>TIME / SPEAKER</span><span>TRANSCRIPT</span></div>}
      {props.segments.length === 0 && <p className="empty">No data yet.</p>}
      <ul ref={props.transcriptListRef} className="transcript-list" tabIndex={0} aria-label="Transcript entries">
        {props.segments.map((segment) => <TranscriptRow key={segment.id} segment={segment} {...props} />)}
      </ul>
      {!props.following && props.segments.length > 0 && <button className="floating-follow" type="button" onClick={props.onFollow}
        title="Jump to the newest entry and follow automatically"><Icon name="download" />Follow</button>}
    </section>
  )
}
