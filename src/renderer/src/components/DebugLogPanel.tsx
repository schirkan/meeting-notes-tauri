import type { DebugLogEntry } from '@shared/transcript-contract'
import { Icon } from './Icon'

type DebugLogPanelProps = {
  debugOpen: boolean
  debugLog: DebugLogEntry[]
  onOpenDebug: () => void
  onCloseDebug: () => void
  onCopyDebug: () => Promise<void>
  onClearDebug: () => Promise<void>
}

export function DebugLogPanel({ debugOpen, debugLog, onOpenDebug, onCloseDebug, onCopyDebug, onClearDebug }: DebugLogPanelProps) {
  const errorCount = debugLog.filter((entry) => entry.level === 'error').length
  return (
    <section className={`console-debug ${errorCount > 0 ? 'has-errors' : ''}`} id="console-debug" aria-label="Debug log">
      <div className="debug-summary">
        <button type="button" onClick={debugOpen ? onCloseDebug : onOpenDebug} aria-expanded={debugOpen} aria-controls="debug-content"
          aria-label={debugOpen ? 'Close debug log' : 'Open debug log'}>
          <Icon name="terminal" />Debug log <span className="count-pill">{errorCount} {errorCount === 1 ? 'error' : 'errors'}</span>
        </button>
        <div className="debug-actions">
          <button type="button" disabled={debugLog.length === 0} onClick={() => void onCopyDebug()}><Icon name="copy" />Copy log</button>
          <button type="button" onClick={() => void onClearDebug()}><Icon name="trash" />Clear log</button>
        </div>
      </div>
      {debugOpen && <div className="debug-content" id="debug-content">
        {debugLog.length === 0 ? <p className="empty">No debug entries yet.</p> : (
          <table className="debug-log-table">
            <thead><tr><th scope="col">Time</th><th scope="col">Source</th><th scope="col">Level</th><th scope="col">Message</th></tr></thead>
            <tbody>{debugLog.map((entry) => <tr key={entry.id} className={`debug-log-entry ${entry.level}`}>
              <td className="debug-log-time">{new Date(entry.timestampIso).toLocaleTimeString('en-US')}</td>
              <td className="debug-log-source">{entry.source.toUpperCase()}</td><td className="debug-log-level">{entry.level}</td>
              <td className="debug-log-message">{entry.message}</td>
            </tr>)}</tbody>
          </table>
        )}
      </div>}
    </section>
  )
}
