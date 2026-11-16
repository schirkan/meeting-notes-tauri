import type { DebugLogEntry } from '@shared/transcript-contract'
import { Icon } from './Icon'

type DebugLogPanelProps = {
  debugOpen: boolean
  debugLog: DebugLogEntry[]
  onOpenDebug: () => void
  onCloseDebug: () => void
  onClearDebug: () => Promise<void>
}

export function DebugLogPanel({ debugOpen, debugLog, onOpenDebug, onCloseDebug, onClearDebug }: DebugLogPanelProps) {
  const errorCount = debugLog.filter((entry) => entry.level === 'error').length
  return (
    <section className={`console-debug ${errorCount > 0 ? 'has-errors' : ''}`} id="console-debug" aria-label="Debug-Log">
      <div className="debug-summary">
        <button type="button" onClick={debugOpen ? onCloseDebug : onOpenDebug} aria-expanded={debugOpen} aria-controls="debug-content"
          aria-label={debugOpen ? 'Debug-Log schließen' : 'Debug-Log öffnen'}>
          <Icon name="terminal" />Debug-Log <span className="count-pill">{errorCount} Fehler</span>
        </button>
        <button type="button" onClick={() => void onClearDebug()}><Icon name="trash" />Log löschen</button>
      </div>
      {debugOpen && <div className="debug-content" id="debug-content">
        {debugLog.length === 0 ? <p className="empty">Noch keine Debug-Einträge.</p> : (
          <table className="debug-log-table">
            <thead><tr><th scope="col">Zeit</th><th scope="col">Quelle</th><th scope="col">Level</th><th scope="col">Nachricht</th></tr></thead>
            <tbody>{debugLog.map((entry) => <tr key={entry.id} className={`debug-log-entry ${entry.level}`}>
              <td className="debug-log-time">{new Date(entry.timestampIso).toLocaleTimeString('de-DE')}</td>
              <td className="debug-log-source">{entry.source.toUpperCase()}</td><td className="debug-log-level">{entry.level}</td>
              <td className="debug-log-message">{entry.message}</td>
            </tr>)}</tbody>
          </table>
        )}
      </div>}
    </section>
  )
}
