import { useEffect, useRef } from 'react'
import { Icon } from './Icon'

type SettingsDialogProps = {
  isOpen: boolean
  onClose: () => void
  children: React.ReactNode
  title?: string
  scrollable?: boolean
  footer?: React.ReactNode
  busy?: boolean
  closeOnBackdrop?: boolean
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

export function SettingsDialog(props: SettingsDialogProps) {
  const { isOpen, onClose, children, title = 'Einstellungen', scrollable = false, footer, busy = false } = props
  const dialogRef = useRef<HTMLElement | null>(null)
  // Ref statt State, damit onClose-Wechsel den Initial-Focus-Effekt nicht
  // erneut auslösen. Außerdem den Initial-Fokus nur einmalig pro Open-Phase
  // setzen, damit Tastendrücke in Eingabefeldern den Fokus nicht zurück auf
  // den Schließen-Button ziehen.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Escape-Handler und Focus-Trap: laufen während des gesamten Dialog-Lebens,
  // hängen aber nur an document-Listenern, die in einem einzigen Effect pro
  // Open-Phase registriert werden (Dependency nur: isOpen).
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }

      if (event.key !== 'Tab' || !dialogRef.current) return

      const focusables = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => el.tabIndex >= 0 && el.offsetParent !== null && !el.closest('[inert]'))

      if (focusables.length === 0) {
        event.preventDefault()
        return
      }

      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement as HTMLElement | null

      if (event.shiftKey && (active === first || !dialogRef.current.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [isOpen])

  // Initialer Fokus nur einmal pro Open-Phase, nicht beim Bearbeiten.
  useEffect(() => {
    if (!isOpen) return
    const previousFocus = document.activeElement

    // requestAnimationFrame, damit der DOM nach dem Conditional-Render
    // (if (!isOpen) return null) vollständig gemounted ist, bevor wir suchen.
    const rafId = requestAnimationFrame(() => {
      const dialog = dialogRef.current
      if (!dialog) return

      const initialFocus = dialog.querySelector<HTMLElement>('.settings-save-button:not([disabled])')
        ?? dialog.querySelector<HTMLElement>('.settings-dialog-close')
      initialFocus?.focus()
    })

    return () => {
      cancelAnimationFrame(rafId)
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [isOpen])

  if (!isOpen) {
    return null
  }

  return (
    <div className="settings-dialog-overlay" role="presentation" onClick={props.closeOnBackdrop === false ? undefined : onClose}>
      <section
        ref={dialogRef}
        className={`settings-dialog ${scrollable ? 'settings-dialog-scroll' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-busy={busy}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-dialog-header">
          <h2>{title}</h2>
          <button className="settings-dialog-close" type="button" onClick={onClose} aria-label="Dialog schließen">
            <Icon name="close" />
          </button>
        </div>

        <div className="settings-dialog-grid" inert={busy}>
          {children}
        </div>

        {footer && <div className="settings-dialog-footer">{footer}</div>}
      </section>
    </div>
  )
}
