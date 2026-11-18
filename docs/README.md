# Screenshots

Zwei Aufnahmewege fuer die Oberflaeche von Meeting Notes.

## `native/` - echte Anwendung

`scripts/capture-native-screenshots.ps1` startet das gebaute `MeetingNotes.exe` in der
interaktiven Windows-Sitzung und zeichnet das echte Fenster mit
`PrintWindow(PW_RENDERFULLCONTENT)` auf. Das Bild enthaelt dadurch echten
Fensterrahmen, echtes App-Icon, echten WebView2-Inhalt und - bei
`11-taskbar-mit-tray.png` - die echte Windows-Taskleiste mit dem Tray-Icon der App.

Aufruf: `npm run screenshots:native` (siehe `scripts/run-native-capture.ps1`).

| Datei | Inhalt |
|---|---|
| `native/01-startbildschirm.png` | Hauptfenster mit Quellen-Einstellungen |
| `native/03-einstellungen-allgemein.png` | Einstellungen - Allgemein |
| `native/04-einstellungen-azure.png` | Einstellungen - Azure-Konfiguration |
| `native/05-einstellungen-proxy.png` | Einstellungen - Proxy |
| `native/06-verbindungstest.png` | Verbindungstest gegen den echten Azure-Endpunkt (Dummy-Key -> HTTP 401) |
| `native/07-sprecherzuordnung.png` | Sprecherzuordnung im Inspector |
| `native/08-debug-log.png` | Debug-Log mit echten Logzeilen |
| `native/11-taskbar-mit-app-icon.png` | Windows-Taskleiste mit dem App-Icon von Meeting Notes |

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
| `renderer/04-einstellungen-azure.png` | Einstellungen - Azure-Konfiguration |
| `renderer/05-einstellungen-proxy.png` | Einstellungen - Proxy |
| `renderer/06-verbindungstest.png` | Diagnose-Dialog Verbindungstest |
| `renderer/07-sprecherzuordnung.png` | Sprecherzuordnung im Inspector |
| `renderer/08-debug-log.png` | Debug-Log-Dock |
