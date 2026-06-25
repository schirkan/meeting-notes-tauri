type SpeakerMappingPanelProps = {
  knownSpeakers: string[]
  speakerAliases: Record<string, string>
  setSpeakerAliases: React.Dispatch<React.SetStateAction<Record<string, string>>>
}

export function SpeakerMappingPanel(props: SpeakerMappingPanelProps) {
  const { knownSpeakers, speakerAliases, setSpeakerAliases } = props

  return (
    <section className="panel speaker-mapping-panel">
      <div className="panel-header">
        <h2>Sprecherzuordnung</h2>
        <span className="subtle-pill">{knownSpeakers.length} IDs</span>
      </div>

      {knownSpeakers.length === 0 ? (
        <p className="empty">Sobald Sprecher erkannt wurden, kannst du ihnen hier Anzeigenamen zuweisen.</p>
      ) : (
        <div className="speaker-mapping-table-wrap">
          <table className="speaker-mapping-table">
            <thead>
              <tr>
                <th scope="col">Speaker-ID</th>
                <th scope="col">Anzeigename</th>
              </tr>
            </thead>
            <tbody>
              {knownSpeakers.map((speaker) => (
                <tr key={speaker}>
                  <td className="speaker-mapping-id">{speaker}</td>
                  <td>
                    <input
                      type="text"
                      value={speakerAliases[speaker] ?? ''}
                      onChange={(event) =>
                        setSpeakerAliases((prev) => ({
                          ...prev,
                          [speaker]: event.target.value
                        }))
                      }
                      placeholder="Anzeigename"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}