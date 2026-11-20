# Screenshots

Two ways to capture the Meeting Notes interface. Both sets were regenerated
and visually checked for version **0.1.4** on **2026-11-20**, with English UI text
and English renderer demo data. The product's default transcription language
remains German; the renderer demo explicitly selects English.

## `native/` - the real application

`scripts/capture-native-screenshots.ps1` starts the built `MeetingNotes.exe` in the
interactive Windows session and records the real window with
`PrintWindow(PW_RENDERFULLCONTENT)`. The image therefore contains the real
window frame, the real app icon and the real WebView2 content.

Run: `npm run screenshots:native` (see `scripts/run-native-capture.ps1`).

| File | Content |
|---|---|
| [native/01-startbildschirm.png](native/01-startbildschirm.png) | Main window with the audio settings of the start page |
| [native/02-einstellungen-oben.png](native/02-einstellungen-oben.png) | Settings from the top: General, Transcription, Azure |
| [native/03-einstellungen-unten.png](native/03-einstellungen-unten.png) | Settings from the bottom: Azure and Proxy |
| [native/04-verbindungstest.png](native/04-verbindungstest.png) | Connection test against the real Azure endpoint (dummy key -> HTTP 401) |
| [native/05-sprecherzuordnung.png](native/05-sprecherzuordnung.png) | Speaker mapping in the inspector |
| [native/06-debug-log.png](native/06-debug-log.png) | Debug log with real log lines |
| [native/07-about-dialog.png](native/07-about-dialog.png) | About dialog with app icon and repository link |

## `renderer/` - headless renderer

`npm run screenshots` (`scripts/capture-screenshots.mjs`) renders the same
React interface headless through the Vite dev server; only the Tauri bridge is a
mock with realistic data. This is only needed for states that cannot be produced
natively - such as a running recording with a transcript, because a real
recording requires Azure Speech credentials.

| File | Content |
|---|---|
| [renderer/01-startbildschirm.png](renderer/01-startbildschirm.png) | Start screen with the audio settings |
| [renderer/02-aufnahme-transkript.png](renderer/02-aufnahme-transkript.png) | Running recording with transcript and speakers |
| [renderer/03-einstellungen-oben.png](renderer/03-einstellungen-oben.png) | Settings from the top: General, Transcription, Azure |
| [renderer/04-einstellungen-unten.png](renderer/04-einstellungen-unten.png) | Settings from the bottom: Azure and Proxy |
| [renderer/05-verbindungstest.png](renderer/05-verbindungstest.png) | Connection test diagnostics dialog |
| [renderer/06-sprecherzuordnung.png](renderer/06-sprecherzuordnung.png) | Speaker mapping in the inspector |
| [renderer/07-debug-log.png](renderer/07-debug-log.png) | Debug log dock |
| [renderer/08-about-dialog.png](renderer/08-about-dialog.png) | About dialog |

## Why only two settings images

After the redesign the dialog is one compact page: the sections **General**,
**Transcription**, **Azure** and **Proxy** are stacked, and several sections
partially fit into one image. Audio switches now live only on the start page. Four individual
captures would therefore produce byte duplicates. Two captures - from the top
and from the bottom - show the whole dialog without a duplicate.
