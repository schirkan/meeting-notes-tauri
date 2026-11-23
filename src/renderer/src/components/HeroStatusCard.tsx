import { useEffect, useRef } from 'react'
import type { TranscriptStatus } from '@shared/transcript-contract'
import { Icon } from './Icon'

type HeroStatusCardProps = {
  status: TranscriptStatus
  statusLabel: string
  statusDescription: string
  runtimeIssue: string | null
  isStarting: boolean
  startDisabled: boolean
  canCopyTranscript: boolean
  canResetTranscript: boolean
  durationLabel: string
  startedAtLabel: string
  speakersOpen: boolean
  debugVisible: boolean
  onToggleSpeakers: () => void
  onToggleDebug: () => void
  onOpenAbout: () => void
  onToggleDevtools: () => Promise<void>
  onCopyTranscript: () => Promise<void>
  onExportTranscript: () => Promise<void>
  onOpenSettingsDialog: () => void
  onToggleRecording: () => Promise<void>
  onPause: () => Promise<void>
  onResume: () => Promise<void>
  onResetTranscript: () => Promise<void>
}

export function HeroStatusCard(props: HeroStatusCardProps) {
  const menuRef = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && menuRef.current) {
        menuRef.current.open = false
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menuRef.current?.open) {
        menuRef.current.open = false
        menuRef.current.querySelector('summary')?.focus()
      }
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])
  const closeMenu = () => { if (menuRef.current) menuRef.current.open = false }
  const { status, isStarting } = props
  const recordLabel = status.running ? 'Stop' : isStarting ? 'Starting …' : 'Start'
  const pauseLabel = status.paused ? 'Resume' : 'Pause'
  const speakerLabel = `Speaker mapping ${props.speakersOpen ? 'hide' : 'show'}`

  return (
    <header className="console-header">
      <div className="toolbar-actions recording-actions hero-controls">
        <button type="button" onClick={() => void (status.paused ? props.onResume() : props.onPause())}
          disabled={!status.running} aria-label={pauseLabel} title={pauseLabel}>
          <Icon name={status.paused ? 'play' : 'pause'} /><span>{pauseLabel}</span>
        </button>
        <button className={status.running ? 'stop-button' : 'start-button primary-button'} type="button"
          onClick={() => void props.onToggleRecording()}
          disabled={!status.running && (isStarting || props.startDisabled || !!props.runtimeIssue)}
          aria-label={recordLabel} title={recordLabel}>
          <Icon name={status.running ? 'stop' : 'play'} /><span>{recordLabel}</span>
        </button>
      </div>
      <div className="status-center">
        <span className={`live-badge ${status.paused ? 'paused' : status.running ? '' : 'stopped'}`}
          aria-label={`${props.statusLabel}: ${props.durationLabel}`}
          title={`${props.statusLabel} · ${props.runtimeIssue ?? props.statusDescription}`}>
          <span className="dot" /><time title={`Started at: ${props.startedAtLabel}`}>{props.durationLabel}</time>
        </span>
      </div>
      <div className="toolbar-actions utility-actions">
        <button type="button" onClick={() => void props.onCopyTranscript()} disabled={!props.canCopyTranscript}
          aria-label="Copy transcript" title="Copy transcript"><Icon name="copy" /><span>Copy</span></button>
        <button type="button" onClick={() => void props.onResetTranscript()} disabled={!props.canResetTranscript}
          aria-label="Clear transcript" title={status.running ? 'Stop the transcription to clear the transcript' : 'Clear transcript'}>
          <Icon name="trash" /><span>Clear</span>
        </button>
        <button type="button" onClick={props.onToggleSpeakers} aria-expanded={props.speakersOpen}
          aria-controls="console-speakers" aria-label={speakerLabel} title={speakerLabel}><Icon name="users" /><span>Speakers</span></button>
        <button className="icon-button" type="button" onClick={props.onOpenSettingsDialog}
          aria-label="Open settings dialog" title="Settings"><Icon name="settings" /></button>
        <details className="overflow-menu" ref={menuRef}>
          <summary aria-label="More actions" title="More actions"><Icon name="more" /></summary>
          <div className="menu">
            <button type="button" disabled={!props.canCopyTranscript} onClick={() => { closeMenu(); void props.onExportTranscript() }}>
              <Icon name="download" />Export Markdown
            </button>
            <button type="button" onClick={() => { closeMenu(); props.onToggleDebug() }} aria-controls="console-debug" aria-pressed={props.debugVisible}>
              <Icon name="terminal" />Debug log
            </button>
            <button type="button" onClick={() => { closeMenu(); void props.onToggleDevtools() }}>
              <Icon name="terminal" />Dev-Tools (F12)
            </button>
            <button type="button" onClick={() => { closeMenu(); props.onOpenAbout() }}>
              <Icon name="info" />About
            </button>
          </div>
        </details>
      </div>
    </header>
  )
}
