import type { ConnectivityResult as TransportResult } from '../../../preload/index'
import { SettingsDialog } from './SettingsDialog'

export type ConnectivityResult = TransportResult & { testedAtIso: string }

type ConnectivityDialogProps = {
  isOpen: boolean
  isTesting: boolean
  result: ConnectivityResult | null
  onClose: () => void
}

export function ConnectivityDialog({ isOpen, isTesting, result, onClose }: ConnectivityDialogProps) {
  const requestFailed = result?.steps.some((step) => step.step === 'IPC / Diagnose starten' || step.step === 'Konfiguration prüfen')
  return (
    <SettingsDialog isOpen={isOpen} onClose={onClose} title="Verbindungstest">
      <div className="connectivity-dialog-content">
        <p role="status">
          {isTesting ? 'Verbindungstest läuft … (maximal 45 Sekunden für Speech/WSS)' : result?.reachable ? 'HTTPS und Speech/WSS erreichbar' : 'Verbindungstest fehlgeschlagen'}
        </p>
        <p className="connectivity-result-meta">
          HTTPS-Zertifikatsprüfung deaktiviert (unsicher); Speech/WSS prüft Zertifikate separat. Keine Audioaufnahme.
        </p>
        {isTesting && (
          <ul className="connectivity-result-step-list">
            <li>HTTPS: DNS-, TCP- und HTTPS-Prüfung läuft …</li>
            <li>Speech/WSS: SpeechRecognizer und ConversationTranscriber werden geprüft …</li>
          </ul>
        )}
        {result && (
          <>
            <p>
              HTTPS: {requestFailed ? 'nicht geprüft' : result.httpsReachable ? 'erreichbar' : 'fehlgeschlagen'} · Speech/WSS: {requestFailed ? 'nicht geprüft' : result.speechReachable ? 'erreichbar' : 'fehlgeschlagen'}
            </p>
            {result.httpStatus && <p>HTTP {result.httpStatus} {result.httpStatusText}</p>}
            <p className="connectivity-result-meta">
              {result.probeUrl && <>{result.probeUrl}<br /></>}
              Dauer: {result.latencyMs} ms · {new Date(result.testedAtIso).toLocaleString('de-DE')}
            </p>
            {result.error && <p className="connectivity-diagnostic-error" role="alert">{result.error}</p>}
            <table className="connectivity-step-table">
              <thead><tr><th>Schritt</th><th>Status</th><th>Details</th></tr></thead>
              <tbody>
                {result.steps.map((step, index) => (
                  <tr key={`${step.step}-${index}`} className={`connectivity-result-step-${step.status}`}>
                    <td>{step.step}</td>
                    <td>{step.status === 'ok' ? '✓ Erfolgreich' : step.status === 'warn' ? '⚠ Warnung' : '✗ Fehler'}</td>
                    <td>{step.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </SettingsDialog>
  )
}
