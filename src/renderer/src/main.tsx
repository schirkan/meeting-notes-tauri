import React from 'react'
import ReactDOM from 'react-dom/client'
import '../../preload/index' // Sets up window.transcriptApi before App mounts.
import { App } from './App'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
