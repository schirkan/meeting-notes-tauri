import type { TranscriptStatus, TranscriptSegment } from '@shared/transcript-contract'

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
          <strong>{latestSegment ? getSpeakerLabel(latestSegment.speaker) : '---'}</strong>
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