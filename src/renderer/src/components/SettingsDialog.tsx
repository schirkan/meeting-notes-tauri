import { Children, useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

type SettingsDialogProps = {
  isOpen: boolean
  onClose: () => void
  children: React.ReactNode
  title?: string
  /**
   * Names of the sections. All sections live on one page; the navigation
   * only scrolls to the selected section.
   */
  sections?: string[]
  footer?: React.ReactNode
  busy?: boolean
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
  const { isOpen, onClose, children, title = 'Einstellungen', sections, footer, busy = false } = props
  const [activeSection, setActiveSection] = useState(0)
  const navRefs = useRef<Array<HTMLButtonElement | null>>([])
  const sectionRefs = useRef<Array<HTMLElement | null>>([])
  const gridRef = useRef<HTMLDivElement | null>(null)
  // While a programmatic scroll runs, the scroll spy must not override the
  // section the user just chose.
  const scrollLock = useRef(false)
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

  // Initialer Fokus: einmalig beim Öffnen, explizit nicht bei jedem Render.
  // Wir fokussieren das erste Eingabefeld/Select (kein Schließen-Button), damit
  // Tastatureingaben direkt in den Settings landen.
  useEffect(() => {
    if (!isOpen) return
    const previousFocus = document.activeElement

    // requestAnimationFrame, damit der DOM nach dem Conditional-Render
    // (if (!isOpen) return null) vollständig gemounted ist, bevor wir suchen.
    const rafId = requestAnimationFrame(() => {
      const dialog = dialogRef.current
      if (!dialog) return

      // Erstes echtes Eingabe-Element (input/select/textarea) im Dialog suchen.
      // Bewusst NICHT den Schließen-Button, da dieser Fokus bei jedem Re-Render
      // der Settings den Nutzer aus Eingabefeldern reißen würde.
      const firstInput = Array.from(dialog.querySelectorAll<HTMLElement>(
        'input:not([type="checkbox"]):not([type="radio"]):not([disabled]), select:not([disabled]), textarea:not([disabled])'
      )).find((element) => element.offsetParent !== null)

      if (firstInput instanceof HTMLElement) {
        firstInput.focus()
      } else {
        // Fallback: nur wenn keine Eingabefelder existieren (z. B. reiner Read-only-Dialog)
        const closeButton = dialog.querySelector<HTMLElement>('.settings-dialog-close')
        closeButton?.focus()
      }
    })

    return () => {
      cancelAnimationFrame(rafId)
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [isOpen])

  // Die Bereiche liegen alle auf einer Seite. Die Navigation scrollt nur zum
  // gewaehlten Abschnitt.
  const scrollToSection = (index: number) => {
    const section = sectionRefs.current[index]
    const grid = gridRef.current
    if (!section || !grid) return
    scrollLock.current = true
    setActiveSection(index)
    window.setTimeout(() => { scrollLock.current = false }, 600)
    const gridTop = grid.getBoundingClientRect().top
    const sectionTop = section.getBoundingClientRect().top
    grid.scrollTo({ top: grid.scrollTop + (sectionTop - gridTop) - 8, behavior: 'smooth' })
  }

  // Scroll-Spy: markiert den Abschnitt, der gerade oben steht.
  useEffect(() => {
    if (!isOpen || !sections) return
    const grid = gridRef.current
    if (!grid) return
    const update = () => {
      if (scrollLock.current) return
      const gridTop = grid.getBoundingClientRect().top
      let current = 0
      sectionRefs.current.forEach((section, index) => {
        if (section && section.getBoundingClientRect().top - gridTop <= 40) current = index
      })
      setActiveSection(current)
    }
    update()
    grid.addEventListener('scroll', update, { passive: true })
    return () => grid.removeEventListener('scroll', update)
  }, [isOpen, sections])

  if (!isOpen) {
    return null
  }

  return (
    <div className="settings-dialog-overlay" role="presentation" onClick={onClose}>
      <section
        ref={dialogRef}
        className={`settings-dialog ${sections ? 'settings-dialog-scroll' : ''}`}
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

        {sections && <nav className="settings-sections" aria-label="Einstellungsbereiche">
          {sections.map((section, index) => <button
            key={section}
            type="button"
            ref={(element) => { navRefs.current[index] = element }}
            aria-current={activeSection === index ? 'true' : undefined}
            onClick={() => scrollToSection(index)}
            onKeyDown={(event) => {
              let next = index
              if (event.key === 'ArrowRight') next = (index + 1) % sections.length
              else if (event.key === 'ArrowLeft') next = (index + sections.length - 1) % sections.length
              else if (event.key === 'Home') next = 0
              else if (event.key === 'End') next = sections.length - 1
              else return
              event.preventDefault()
              scrollToSection(next)
              navRefs.current[next]?.focus()
            }}>{section}</button>)}
        </nav>}
        <div className="settings-dialog-grid" ref={gridRef} inert={busy}>
          {sections
            ? Children.toArray(children).map((child, index) => <div
              key={sections[index] ?? `settings-section-${index}`}
              className="settings-section"
              id={`settings-section-${index}`}
              ref={(element) => { sectionRefs.current[index] = element }}
            >{child}</div>)
            : children}
        </div>

        {footer && <div className="settings-dialog-footer">{footer}</div>}
      </section>
    </div>
  )
}
