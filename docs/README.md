# Screenshots

Zwei Aufnahmewege fuer die Oberflaeche von Meeting Notes.

## `native/` - echte Anwendung

`scripts/capture-native-screenshots.ps1` startet das gebaute `MeetingNotes.exe` in der
interaktiven Windows-Sitzung und zeichnet das echte Fenster mit
`PrintWindow(PW_RENDERFULLCONTENT)` auf. Das Bild enthaelt dadurch echten
Fensterrahmen, echtes App-Icon, echten WebView2-Inhalt und - bei
`10-taskbar-mit-app-icon.png` - die echte Windows-Taskleiste mit dem Icon der App.

Aufruf: `npm run screenshots:native` (siehe `scripts/run-native-capture.ps1`).

| Datei | Inhalt |
|---|---|
| `native/01-startbildschirm.png` | Hauptfenster mit Quellen-Einstellungen |
| `native/03-einstellungen-allgemein.png` | Einstellungen - Allgemein |
| `native/04-einstellungen-audio.png` | Einstellungen - Audio |
| `native/05-einstellungen-azure.png` | Einstellungen - Azure |
| `native/06-einstellungen-proxy.png` | Einstellungen - Proxy |
| `native/07-verbindungstest.png` | Verbindungstest gegen den echten Azure-Endpunkt (Dummy-Key -> HTTP 401) |
| `native/08-sprecherzuordnung.png` | Sprecherzuordnung im Inspector |
| `native/09-debug-log.png` | Debug-Log mit echten Logzeilen |
| `native/10-taskbar-mit-app-icon.png` | Windows-Taskleiste mit dem Icon von Meeting Notes |

## `renderer/` - headless Renderer

`npm run screenshots` (`scripts/capture-screenshots.mjs`) rendert dieselbe
React-Oberflaeche headless ueber den Vite-Dev-Server; nur die Tauri-Bridge ist eine
Attrappe mit realistischen Daten. Das wird nur fuer Zustaende gebraucht, die native
nicht herstellbar sind - etwa eine laufende Aufnahme mit Transkript, weil eine echte
Aufnahme Azure-Speech-Credentials braucht.

| Datei | Inhalt |
|---|---|
| `renderer/01-startbildschirm.png` | Startbildschirm mit Audio-Einstellungen |
| `renderer/02-aufnahme-transkript.png` | Laufende Aufnahme mit Transkript und Sprechern |
| `renderer/03-einstellungen-allgemein.png` | Einstellungen - Allgemein |
| `renderer/04-einstellungen-audio.png` | Einstellungen - Audio |
| `renderer/05-einstellungen-azure.png` | Einstellungen - Azure |
| `renderer/06-einstellungen-proxy.png` | Einstellungen - Proxy |
| `renderer/07-verbindungstest.png` | Diagnose-Dialog Verbindungstest |
| `renderer/08-sprecherzuordnung.png` | Sprecherzuordnung im Inspector |
| `renderer/09-debug-log.png` | Debug-Log-Dock |
