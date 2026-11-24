import { version } from '../../../../package.json'
import appIcon from '../../../../src-tauri/icons/app-icon.svg'
import { SettingsDialog } from './SettingsDialog'

type AboutDialogProps = {
  isOpen: boolean
  onClose: () => void
  onOpenRepository: () => Promise<void>
}

export function AboutDialog(props: AboutDialogProps) {
  return (
    <SettingsDialog isOpen={props.isOpen} onClose={props.onClose} title="About" className="about-dialog">
      <div className="about-content">
        <img src={appIcon} alt="Meeting Notes Icon" />
        <div className="about-details">
          <h2>Meeting Notes</h2>
          <p>Version: {version}</p>
          <a href="https://github.com/schirkan/meeting-notes-tauri" onClick={(event) => {
            event.preventDefault()
            void props.onOpenRepository()
          }}>github.com/schirkan/meeting-notes-tauri</a>
          <p>Author: Martin Pietschmann</p>
          <p>License: MIT</p>
        </div>
      </div>
    </SettingsDialog>
  )
}
