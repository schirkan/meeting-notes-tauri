import { formatSpeakerIdentity, getSpeakerClassForIdentity } from '../speaker-utils'

type SpeakerMappingPanelProps = {
  knownSpeakers: string[]
  speakerLabels: Record<string, string>
  speakerAliases: Record<string, string>
  setSpeakerAliases: React.Dispatch<React.SetStateAction<Record<string, string>>>
}

export function SpeakerMappingPanel({ knownSpeakers, speakerLabels, speakerAliases, setSpeakerAliases }: SpeakerMappingPanelProps) {
  return (
    <section className="speaker-mapping-panel">
      <div className="panel-header"><h2 id="console-speakers-title">Sprecherzuordnung</h2><span className="count-pill">{knownSpeakers.length}</span></div>
      {knownSpeakers.length === 0 ? <p className="empty">Sobald Sprecher erkannt wurden, kannst du ihnen hier Anzeigenamen zuweisen.</p> : (
        <div className="speaker-mapping-list">
          {knownSpeakers.map((speaker) => {
            const label = speakerLabels[speaker] ?? formatSpeakerIdentity(speaker)
            return <label className="speaker-row" key={speaker}>
              <span>{label}</span>
              <input className={`speaker-tone ${getSpeakerClassForIdentity(speaker)}`} type="text"
                value={speakerAliases[speaker] ?? ''} placeholder={label} aria-label={`Anzeigename für ${label}`}
                onChange={(event) => setSpeakerAliases((prev) => ({ ...prev, [speaker]: event.target.value }))} />
            </label>
          })}
        </div>
      )}
    </section>
  )
}
