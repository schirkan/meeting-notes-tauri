# Screenshots

Zwei Aufnahmewege fuer die Oberflaeche von Meeting Notes.

## `native/` - echte Anwendung

`scripts/capture-native-screenshots.ps1` startet das gebaute `MeetingNotes.exe` in der
interaktiven Windows-Sitzung und zeichnet das echte Fenster mit
`PrintWindow(PW_RENDERFULLCONTENT)` auf. Das Bild enthaelt dadurch echten
Fensterrahmen, echtes App-Icon, echten WebView2-Inhalt und - bei
`08-taskbar-mit-app-icon.png` - die echte Windows-Taskleiste mit dem Icon der App.

Aufruf: `npm run screenshots:native` (siehe `scripts/run-native-capture.ps1`).

| Datei | Inhalt |
|---|---|
| `native/01-startbildschirm.png` | Hauptfenster mit den Audio-Einstellungen der Startseite |
| `native/02-einstellungen-oben.png` | Einstellungen von oben: Allgemein, Transkription, Azure |
| `native/03-einstellungen-unten.png` | Einstellungen von unten: Azure und Proxy |
| `native/04-verbindungstest.png` | Verbindungstest gegen den echten Azure-Endpunkt (Dummy-Key -> HTTP 401) |
| `native/05-sprecherzuordnung.png` | Sprecherzuordnung im Inspector |
| `native/06-debug-log.png` | Debug-Log mit echten Logzeilen |
| `native/07-about-dialog.png` | About-Dialog mit App-Icon und Repository-Link |
| `native/08-taskbar-mit-app-icon.png` | Windows-Taskleiste mit dem Icon von Meeting Notes |

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
| `renderer/03-einstellungen-oben.png` | Einstellungen von oben: Allgemein, Transkription, Azure |
| `renderer/04-einstellungen-unten.png` | Einstellungen von unten: Azure und Proxy |
| `renderer/05-verbindungstest.png` | Diagnose-Dialog Verbindungstest |
| `renderer/06-sprecherzuordnung.png` | Sprecherzuordnung im Inspector |
| `renderer/07-debug-log.png` | Debug-Log-Dock |
| `renderer/08-about-dialog.png` | About-Dialog |

## Warum nur zwei Einstellungsbilder

Der Dialog ist nach dem Umbau eine kompakte Seite: die Abschnitte **Allgemein**,
**Transkription**, **Azure** und **Proxy** passen in einem Bild teilweise nebeneinander,
und die Audio-Schalter liegen nur noch auf der Startseite. Vier Einzelaufnahmen
wuerden deshalb Byte-Duplikate ergeben. Zwei Aufnahmen - von oben und von unten -
zeigen den ganzen Dialog ohne Duplikat.
