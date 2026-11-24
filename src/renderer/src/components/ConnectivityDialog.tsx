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
  const requestFailed = result?.steps.some((step) => step.step === 'IPC / Start diagnostics' || step.step === 'Check configuration')
  const httpsStatus = requestFailed || result?.httpsReachable === undefined ? 'not checked' : result.httpsReachable ? 'reachable' : 'failed'
  return (
    <SettingsDialog isOpen={isOpen} onClose={onClose} title="Connection test">
      <div className="connectivity-dialog-content">
        <p role="status">
          {isTesting ? 'Connection test running … (up to 45 seconds for Speech/WSS)' : result?.reachable
            ? result.httpsReachable ? 'HTTPS and Speech/WSS reachable' : 'Speech/WSS reachable'
            : 'Connection test failed'}
        </p>
        <p className="connectivity-result-meta">
          Validates TLS certificates on the tested connections. No audio is captured.
        </p>
        {result && (
          <>
            <p>
              HTTPS: {httpsStatus} · Speech/WSS: {requestFailed ? 'not checked' : result.speechReachable ? 'reachable' : 'failed'}
            </p>
            {result.httpStatus && <p>HTTP {result.httpStatus} {result.httpStatusText}</p>}
            <p className="connectivity-result-meta">
              {result.probeUrl && <>{result.probeUrl}<br /></>}
              Duration: {result.latencyMs} ms · {new Date(result.testedAtIso).toLocaleString('en-US')}
            </p>
            {result.error && <p className="connectivity-diagnostic-error" role="alert">{result.error}</p>}
            <table className="connectivity-step-table">
              <thead><tr><th>Step</th><th>Status</th><th>Details</th></tr></thead>
              <tbody>
                {result.steps.map((step, index) => (
                  <tr key={`${step.step}-${index}`} className={`connectivity-result-step-${step.status}`}>
                    <td>{step.step}</td>
                    <td>{step.status === 'ok' ? '✓ Success' : step.status === 'warn' ? '⚠ Warning' : '✗ Error'}</td>
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
