import type { DebugLogEntry } from '@shared/transcript-contract'

type DebugLogPanelProps = {
  debugOpen: boolean
  debugLog: DebugLogEntry[]
  onOpenDebug: () => void
  onCloseDebug: () => void
  onClearDebug: () => Promise<void>
}

export function DebugLogPanel(props: DebugLogPanelProps) {
  const { debugOpen, debugLog, onOpenDebug, onCloseDebug, onClearDebug } = props

  return (
    <section className={`debug-log-dock ${debugOpen ? 'open' : 'closed'}`}>
      {!debugOpen && (
        <button
          className="debug-log-open-button"
          type="button"
          onClick={onOpenDebug}
          aria-expanded={false}
          aria-label="Debug-Log öffnen"
        >
          <span className="debug-log-bug-icon" aria-hidden="true">⚠️</span>
        </button>
      )}

      {debugOpen && (
        <div className="panel debug-log-panel">
          <div className="debug-log-header">
            <h2>Debug-Log</h2>
            <div className="debug-log-actions">
              <button
                className="debug-log-clear-button"
                type="button"
                onClick={() => void onClearDebug()}
              >
                Log löschen
              </button>
              <button
                className="debug-log-close-button"
                type="button"
                onClick={onCloseDebug}
                aria-expanded={true}
                aria-label="Debug-Log schließen"
              >
                <span className="toggle-indicator">−</span>
              </button>
            </div>
          </div>

          {debugLog.length === 0 ? (
            <p className="empty">Noch keine Debug-Einträge.</p>
          ) : (
            <div className="debug-log-table-wrap">
              <table className="debug-log-table">
                <thead>
                  <tr>
                    <th scope="col">Zeit</th>
                    <th scope="col">Quelle</th>
                    <th scope="col">Level</th>
                    <th scope="col">Nachricht</th>
                  </tr>
                </thead>
                <tbody>
                  {debugLog.map((entry) => (
                    <tr key={entry.id} className={`debug-log-entry ${entry.level}`}>
                      <td className="debug-log-time">{new Date(entry.timestampIso).toLocaleString('de-DE')}</td>
                      <td className="debug-log-source">{entry.source.toUpperCase()}</td>
                      <td className="debug-log-level">{entry.level}</td>
                      <td className="debug-log-message">{entry.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
