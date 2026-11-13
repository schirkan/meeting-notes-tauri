import type { TranscriptStatus, TranscriptSegment } from '@shared/transcript-contract'
import { getSpeakerIdentity } from '../speaker-utils'

type HeroStatusCardProps = {
  status: TranscriptStatus
  statusLabel: string
  statusDescription: string
  runtimeIssue: string | null
  isStarting: boolean
  startDisabled: boolean
  finalCount: number
  latestSegment: TranscriptSegment | null
  durationLabel: string
  startedAtLabel: string
  getSpeakerLabel: (speaker: string) => string
  onOpenSettingsDialog: () => void
  onToggleRecording: () => Promise<void>
  onPause: () => Promise<void>
  onResume: () => Promise<void>
  onResetTranscript: () => Promise<void> | void
}

export function HeroStatusCard(props: HeroStatusCardProps) {
  const {
    status,
    statusLabel,
    statusDescription,
    runtimeIssue,
    isStarting,
    startDisabled,
    finalCount,
    latestSegment,
    durationLabel,
    startedAtLabel,
    getSpeakerLabel,
    onOpenSettingsDialog,
    onToggleRecording,
    onPause,
    onResume,
    onResetTranscript
  } = props

  return (
    <section className="hero-status-card">
      <div className="hero-card-topbar">
        <strong>{statusLabel}</strong>
        <button className="hero-icon-button" type="button" onClick={onOpenSettingsDialog} aria-label="Einstellungsdialog öffnen">
          ⚙
        </button>
      </div>

      <span>{statusDescription}</span>
      <div className="controls hero-controls">
        <button
          className={status.running ? 'secondary-button' : 'primary-button'}
          type="button"
          onClick={() => void onToggleRecording()}
          disabled={status.running ? false : isStarting || startDisabled || !!runtimeIssue}
        >
          {status.running ? '■ Stop' : isStarting ? '◌ Startet ...' : '▶ Start'}
        </button>
        {status.running && (
          <button
            className="secondary-button"
            type="button"
            onClick={() => void (status.paused ? onResume() : onPause())}
          >
            {status.paused ? '▶ Weiter' : '⏸ Pause'}
          </button>
        )}
        <button className="ghost-button" type="button" onClick={() => void onResetTranscript()} disabled={finalCount === 0 && startedAtLabel === '---'}>
          🗑 Löschen
        </button>
      </div>
      <div className="hero-stats">
        <div>
          <span>Einträge</span>
          <strong>{finalCount}</strong>
        </div>
        <div>
          <span>Letzter Sprecher</span>
          <strong>{latestSegment ? getSpeakerLabel(getSpeakerIdentity(latestSegment)) : '---'}</strong>
        </div>
        <div>
          <span>Dauer</span>
          <strong>{durationLabel}</strong>
        </div>
        <div>
          <span>Startzeit</span>
          <strong>{startedAtLabel}</strong>
        </div>
      </div>
    </section>
  )
}