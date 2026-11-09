import React from 'react'
import ReactDOM from 'react-dom/client'
import '../../preload/index' // Sets up window.transcriptApi before App mounts.
import { App } from './App'
import './styles.css'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { TAURI_COMMANDS } from '@shared/tauri-contract'

if (isTauri()) {
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'F12') return
    event.preventDefault()
    if (event.repeat) return
    void invoke(TAURI_COMMANDS.toggleDevtools).catch((error: unknown) => {
      console.error('DevTools konnten nicht geöffnet werden:', error)
    })
  }, { capture: true })
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
