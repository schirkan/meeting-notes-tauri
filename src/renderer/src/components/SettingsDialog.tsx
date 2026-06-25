import { useEffect, useRef } from 'react'

type SettingsDialogProps = {
  isOpen: boolean
  onClose: () => void
  children: React.ReactNode
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
  const { isOpen, onClose, children } = props
  const dialogRef = useRef<HTMLElement | null>(null)
  // Ref statt State, damit onClose-Wechsel den Initial-Focus-Effekt nicht
  // erneut auslösen. Außerdem den Initial-Fokus nur einmalig pro Open-Phase
  // setzen, damit Tastendrücke in Eingabefeldern den Fokus nicht zurück auf
  // den Schließen-Button ziehen.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Escape-Handler und Focus-Trap: laufen während des gesamten Dialog-Lebens,
  // hängen aber nur an document-Listener, die in einem einzigen Effect pro
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
      ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)

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

  // Initialer Fokus: einmalig beim Öffnen, explizit nicht bei jedem Render.
  // Wir fokussieren das erste Eingabefeld/Select (kein Schließen-Button), damit
  // Tastatureingaben direkt in den Settings landen.
  useEffect(() => {
    if (!isOpen) return

    // requestAnimationFrame, damit der DOM nach dem Conditional-Render
    // (if (!isOpen) return null) vollständig gemounted ist, bevor wir suchen.
    const rafId = requestAnimationFrame(() => {
      const dialog = dialogRef.current
      if (!dialog) return

      // Erstes echtes Eingabe-Element (input/select/textarea) im Dialog suchen.
      // Bewusst NICHT den Schließen-Button, da dieser Fokus bei jedem Re-Render
      // der Settings den Nutzer aus Eingabefeldern reißen würde.
      const firstInput = dialog.querySelector<HTMLElement>(
        'input:not([type="checkbox"]):not([type="radio"]):not([disabled]), select:not([disabled]), textarea:not([disabled])'
      )

      if (firstInput instanceof HTMLElement) {
        firstInput.focus()
      } else {
        // Fallback: nur wenn keine Eingabefelder existieren (z. B. reiner Read-only-Dialog)
        const closeButton = dialog.querySelector<HTMLElement>('.settings-dialog-close')
        closeButton?.focus()
      }
    })

    return () => cancelAnimationFrame(rafId)
  }, [isOpen])

  if (!isOpen) {
    return null
  }

  return (
    <div className="settings-dialog-overlay" role="presentation" onClick={onClose}>
      <section
        ref={dialogRef}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-dialog-header">
          <h2 id="settings-dialog-title">Einstellungen</h2>
          <button className="settings-dialog-close" type="button" onClick={onClose} aria-label="Dialog schließen">
            ×
          </button>
        </div>

        <div className="settings-dialog-grid">
          {children}
        </div>
      </section>
    </div>
  )
}