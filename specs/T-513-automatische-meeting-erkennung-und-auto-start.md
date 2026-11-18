# T-513: Automatische Meeting-Erkennung und Auto-Start im Hintergrund

## Kontext
Status: geplant (Recherche abgeschlossen, 8 Punkte offen)
Priorität: medium
Abhängigkeiten: T-300, T-305, T-403, T-509, T-511

## Goal
Die App erkennt **selbstständig, dass ein Meeting beginnt**, und startet die
Aufnahme **ohne Zutun des Nutzers** - im Hintergrund, also ohne dass das
Fenster im Vordergrund sein muss.

Der Umfang dieses Specs ist bewusst zweigeteilt:
1. **Recherche**, wie bestehende Produkte das machen (Abschnitt "Recherche").
2. **Die Spezifikation** des Mechanismus für dieses Projekt (Abschnitt
   "Mechanismus"), inklusive der Entscheidung, welche Erkennung hier
   überhaupt taugt.

Es wird **nichts implementiert**. Das Spec beschreibt den Zielzustand; die
Umsetzung ist eine eigene Karte.

## Recherche: wie machen es andere Produkte?

### Der Referenzfall Granola

Granola ist das belastbarste dokumentierte Gegenbeispiel - und es entkräftet
die Erwartung, ein Meeting werde automatisch erkannt.

**Granola startet die Aufnahme nicht automatisch.** Die Doku ist hier
eindeutig: "Granola does not automatically transcribe meetings without you
having clicked into a note." (Quelle: [How transcription
works](https://docs.granola.ai/help-center/taking-notes/transcription.md))

Granola kennt **zwei** getrennte Dinge, die oft verwechselt werden:

1. **Kalender-Notification** (1 Minute vor dem Termin): "Clicking the
   notification will: Open the URL for the video call from the calendar event,
   Open your Granola note for that meeting, and start transcribing."
   ([Notifications](https://docs.granola.ai/help-center/taking-notes/notifications.md))
   Das ist also **kein** Auto-Start, sondern ein Klick, der startet.
2. **Ad-hoc-Call-Erkennung**: "By detecting that your microphone is in use,
   Granola will prompt you to take notes." Die Notification heisst dann
   "Meeting detected" bzw. "Call detected", zeigt **die App, die das
   Mikrofon nutzt**, und hat einen "Take Notes"-Button.
   ([Notifications](https://docs.granola.ai/help-center/taking-notes/notifications.md))

Granolas Erkennung der Mikrofontnutzung ist damit genau der Mechanismus,
der auch hier ohne Cloud-Kalender funktioniert.

**Ende der Aufnahme** (Granola, [How transcription
works](https://docs.granola.ai/help-center/taking-notes/transcription.md)):
- Erkennung, dass der Call beendet ist - "based on the length of the
  transcript, whether or not you are still using the call software
  (e.g Zoom, Teams, Google Meet)"
- bei kalendergebundenen Meetings zusätzlich das planmässige Ende des Termins
- 15 Minuten ohne neues Audio
- Rechner in den Schlafmodus

Granola nutzt also **drei** Signale für das Ende, nicht eines.

**Kalender**: Google Calendar und Microsoft/Outlook, kein Apple Calendar.
Events mit weniger als zwei Teilnehmern erzeugen keine Notification. Der
Sync läuft in "a few minutes" nach einer Kalenderänderung, nicht in Echtzeit
([Syncing your calendars](https://docs.granola.ai/help-center/getting-started/syncing-your-calendars.md)).

### Weitere Produkte

Die übrigen gängigen Produkte setzen auf **Kalender plus Bot**, nicht auf
lokale Audio-Erkennung: Fireflies, tl;dv, Avoma, Fathom und Sembly lassen
einen Bot dem Meeting beitreten; der Bot sieht den Meeting-Start, weil der
Kalendertermin beginnt und der Bot den Einladungslink hat. Recall.ai
nutzt eine Kalender-Integration mit automatischer Aufnahme. Otter.ai und
Read AI verhalten sich vergleichbar.

Der **Unterschied** ist entscheidend: ein Bot braucht den Einladungslink des
Termins und eine Berechtigung im Kalender. Das Meeting muss **im Kalender
stehen**. Granola und die lokalen Whisper-Tools kommen dagegen ohne
Kalender aus, indem sie das **Mikrofon** beobachten.

Für Meeting Notes ist der Bot-Weg ausgeschlossen: die App ist ein
Desktop-Tool ohne Bot, und der Kalender-Zugriff über die Cloud (Graph/OAuth)
wäre ein Bruch mit dem lokalen Character (siehe README: "Current source
builds ... need no separate .NET installation") und bräuchte ein Konto.

### Die technischen Bausteine unter Windows

Es gibt **keine** offizielle Windows-API "Ein Meeting hat begonnen". Die
Erkennung ist immer eine Heuristik. Die einschlägigen Bausteine:

**Fenstertitel** (Win32, `winuser.h`):
- `GetWindowTextW` - "Copies the text of the specified window's title bar
  (if it has one) into a buffer." Der Titel eines Top-Level-Fensters eines
  anderen Prozesses ist lesbar. ([Doku](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowtextw))
- `EnumWindows` - "Enumerates all top-level windows on the screen by
  passing the handle to each window, in turn, to an application-defined
  callback function." ([Doku](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-enumwindows))
- `GetWindowThreadProcessId` für die Zuordnung Fenster zu Prozess,
  `GetClassNameW` für die Fensterklasse, `IsWindowVisible` für die
  Sichtbarkeit.
- `SetWinEventHook` liefert Titel- und Fokusänderungen ereignisgesteuert
  statt per Timer.

**Audio-Sitzungen** (Core Audio):
- `IAudioSessionManager2` - "enables an application to manage submixes for
  the audio device" - liefert über `GetSessionEnumerator` die Sitzungsliste.
  ([Doku](https://learn.microsoft.com/en-us/windows/win32/api/audiopolicy/nn-audiopolicy-iaudiosessionmanager2))
- `IAudioSessionControl2` - "can be used by a client to get information
  about the audio session" - liefert die **Prozess-ID** der Sitzung.
  ([Doku](https://learn.microsoft.com/en-us/windows/win32/api/audiopolicy/nn-audiopolicy-iaudiosessioncontrol2))
- `IAudioSessionEvents` - "provides notifications of session-related events
  such as changes in the volume level, display name, and session state".
  ([Doku](https://learn.microsoft.com/en-us/windows/win32/api/audiopolicy/nn-audiopolicy-iaudiosessionevents))
- `IAudioMeterInformation` (endpointvolume.h) - "represents a peak meter on an
  audio stream to or from an audio endpoint device", mit `GetPeakValue`.
  ([Doku](https://learn.microsoft.com/en-us/windows/win32/api/endpointvolume/nn-endpointvolume-iaudiometerinformation))
- `IAudioClient3` erlaubt Shared-Mode über
  `InitializeSharedAudioStream` und liefert die Engine-Periodizität über
  `GetCurrentSharedModeEnginePeriod` - nützlich für einen periodischen
  Mess-Loop.
- **Ducking** (`IAudioSessionManager2::RegisterDuckNotification`):
  "the system adjusts the volume of a non-communication stream when a new
  communication stream is opened". Teams, Zoom und Meet öffnen genau solche
  Kommunikations-Streams - das Ducking-Event ist damit faktisch ein
  "Meeting-Start"-Signal des Betriebssystems.
  ([Doku](https://learn.microsoft.com/en-us/windows/win32/api/audiopolicy/nf-audiopolicy-iaudiosessionmanager2-registerducknotification),
  [How-to](https://learn.microsoft.com/en-us/windows/win32/coreaudio/getting-ducking-events-from-a-communication-device))
  **Einschränkung:** Der Nutzer kann das Default Ducking im Kommunikations-Tab
  abschalten - das Signal fällt dann aus. Ducking darf deshalb nie das
  *einzige* Kriterium sein.

**Kalender**:
- `Windows.ApplicationModel.Appointments.AppointmentManager` (WinRT) -
  die UWP-Kalender-API. ([Doku](https://learn.microsoft.com/en-us/uwp/api/windows.applicationmodel.appointments.appointmentmanager))
  **Achtung:** Der Weg haengt am `AppointmentsProvider`-Contract der UWP-App
  "Mail & Calendar". Die wurde unter Windows 11 durch das neue Outlook
  ersetzt (Dezember 2024) - der WinRT-Weg ist damit praktisch tot.
  ([Quelle](https://support.microsoft.com/en-us/outlook/outlook-for-windows-the-future-of-mail-calendar-and-people-on-windows-11))
  Ob das neue Outlook den Contract implementiert, geht aus den Quellen
  **nicht** hervor - vor einer Entscheidung gegen Graph/Outlook-COM
  verifizieren, sonst als tot behandeln.
- `Microsoft Graph` `calendarView` - "Get the occurrences, exceptions, and
  single instances of events in a calendar view defined by a time range, from
  the user's default calendar". ([Doku](https://learn.microsoft.com/en-us/graph/api/user-list-calendarview))
  Braucht OAuth und ein Microsoft-365-Konto.
- **Outlook-COM** (`Microsoft.Office.Interop.Outlook.AppointmentItem`) -
  lokal, **ohne** OAuth, aber nur mit installiertem klassischem Outlook.
  Das Projekt `outlook-mcp-server` im selben Workspace nutzt genau das.

**Graphic Capture**: `Windows.Graphics.Capture` liefert Frames aus Display
**oder Anwendungsfenster**; `IGraphicsCaptureItemInterop::CreateForWindow`
erlaubt die Erzeugung direkt aus einem HWND ohne System-Picker, verlangt aber
seit Windows 11 die einmalige Zustimmung über
`GraphicsCaptureAccess::RequestAccessAsync` und einen sichtbaren Rahmen.
([Doku](https://learn.microsoft.com/en-us/windows/apps/develop/media-authoring-processing/screen-capture))
Für die **Erkennung** ist das nicht der richtige Hebel - die Erkennung
läuft vor der Aufnahme, und Capture ist der teure Teil.

### Was NAudio 3.3.0 bereits mitbringt

Für dieses Projekt ist entscheidend, dass die nötigen Core-Audio-APIs
**bereits als Abhängigkeit vorhanden** sind. Eine Reflection-Prüfung gegen
die installierte `NAudio.Wasapi.dll` 3.3.0 (Namespace der Typen ist
`NAudio.CoreAudioApi`, nicht `NAudio.Wasapi`) belegt:

- `NAudio.CoreAudioApi.AudioSessionManager` mit `RefreshSessions()`,
  `Sessions` (Property `SessionCollection`), `AudioSessionControl`,
  `SimpleAudioVolume` und dem Ereignis `OnSessionCreated`.
- `NAudio.CoreAudioApi.AudioSessionControl` mit `GetProcessID` (uint),
  `GetSessionIdentifier`, `DisplayName`, `IconPath`, `State`
  (`AudioSessionState`: Inactive/Active/Expired),
  `AudioMeterInformation`, `RegisterEventClient(IAudioSessionEventsHandler)`
  und `UnRegisterEventClient`.
- `NAudio.CoreAudioApi.AudioMeterInformation` mit `MasterPeakValue`
  (float) und `PeakValues` (`AudioMeterInformationChannels`).
- `NAudio.CoreAudioApi.AudioSessionEventsCallback` mit `OnStateChanged`,
  `OnSessionDisconnected`, `OnDisplayNameChanged`, `OnSimpleVolumeChanged`,
  `OnChannelVolumeChanged`, `OnGroupingParamChanged`.
- `NAudio.Wave.WasapiLoopbackCapture` und `NAudio.CoreAudioApi.WasapiCapture`
  sind ebenfalls vorhanden (letztere ist in NAudio 3.x als obsolet markiert,
  siehe T-509 - für die Detection ist sie ohnehin nicht nötig).

**Grenze des NAudio-Wegs:** NAudio 3.3.0 exportiert **keine**
Ducking-Schnittstellen - die Reflection über `NAudio.Wasapi` liefert keine
Ducking-Typen, und `AudioSessionManager` hat keine
`RegisterDuckNotification`-Methode. Der Session-Graph, die
Zustands-Events und der Pegel sind also abgedeckt, **das Ducking-Signal
nicht**. Es bräuchte rohes COM-Interop auf
`IAudioSessionManager2::RegisterDuckNotification`.
WinRT-Alternative: `Windows.Media.Audio.AudioStateMonitor` - "Allows a
UWP app to determine if any of the app's audio streams are currently being
muted or having their volume reduced by the system."
([Doku](https://learn.microsoft.com/en-us/uwp/api/windows.media.audio.audiostatemonitor))

Beleg: Reflection über `NAudio.Wasapi` 3.3.0 (Paket
`naudio.wasapi/3.3.0/lib/net9.0/NAudio.Wasapi.dll`), ausgeführt am
2026-11-18; `NAudio` 3.3.0 ist bereits direkte Abhängigkeit von
`sidecar/MeetingNotes.Sidecar.csproj`.

Damit braucht die Audio-Erkennung **kein neues NuGet-Paket**. Das ist der
entscheidende Punkt für die Aufwandsschätzung.

## Mechanismus: was Meeting Notes tun kann

### Der Ansatz: Mikrofon- und Sessions-Graph beobachten

Der von Granola belegte Mechanismus ist hier direkt umsetzbar, weil die
Seitenauswertung in NAudio bereits enthalten ist:

1. **Sitzungsbeobachter im Sidecar**: `AudioSessionManager` mit
   `RefreshSessions()` liefert alle Audiositzungen mit Prozess-ID und
   Zustand. Eine Sitzung, deren Prozess-ID zu einer Meeting-App gehört
   (Teams, Zoom, Meet) **und** deren Zustand von Inactive auf Active
   wechselt, ist das Startsignal. `RegisterEventClient` mit
   `AudioSessionEventsCallback.OnStateChanged` macht das ereignisgesteuert
   statt per Timer.
2. **Mikrofonbelegung**: Eine Audiositzung auf dem **Aufnahme**-Endpoint, die
   von einem Prozess ausserhalb von Meeting Notes stammt, bedeutet: jemand
   benutzt das Mikrofon. Das ist Granolas "detecting that your microphone is
   in use". Mit `AudioMeterInformation.MasterPeakValue` lässt sich zusätzlich
   prüfen, ob wirklich Audio anliegt (statt eines stummen Aufbaus).
3. **Kalender optional**: über `Windows.ApplicationModel.Appointments` oder
   - für den klassischen Outlook-Desktop-Client - über COM-Interop, wie es
   das Projekt `outlook-mcp-server` im selben Workspace bereits tut
   (`CalendarTools.list_events` mit ISO-8601 plus IANA-Zeitzone). Der
   Kalender ist die **beste** Quelle für das planmäßige Ende und für
   Fehlalarme, aber nicht die Quelle für den Start.

### Warum nicht der Kalender als Startsignal

Der Kalender ist in Granola der Auslöser für die **Notification**, nicht
für die Aufnahme. Für Meeting Notes spricht dagegen:
- Der Sync läuft bei Granola in "a few minutes" - für einen Auto-Start
  ist das zu langsam.
- Events ohne Teilnehmer oder ohne Videolink lösen bei Granola keine
  Notification aus - genau die Fälle, in denen trotzdem getranskribiert
  werden soll.
- Der Kalender braucht ein Konto und eine Berechtigung; der
  Mikrofon-/Sitzungsweg braucht nichts davon und ist offline.

### Das Ende der automatischen Sitzung

Granola nutzt drei Signale. Für Meeting Notes sind es:
1. **Stille**: kein neues Audio über einen konfigurierbaren Zeitraum
   (Granola: 15 Minuten ohne neues Audio).
2. **Sitzung beendet**: die Meeting-App beendet ihre Audiositzung
   (`OnSessionDisconnected` / Zustandswechsel auf Inactive oder Expired).
3. **Kalender-Ende**, falls ein Kalender angebunden ist.

Alle drei sind nötig: ein Meeting kann mitten in einer Videokonferenz eine
Stillephase haben, und ein Fensterschluss ist kein Meeting-Ende.

### Die rechtliche Grenze

Die Recherche hat einen Punkt zutage gefoerdert, der **vor** jeder
Implementierung geklaert sein muss - er ist technisch nicht loesbar:

**Eine Aufnahme eines Meetings ohne Zustimmung der Teilnehmer ist in
Deutschland problematisch** (§ 201 StGB bei der Aufnahme, § 201a StGB bei
Aufnahme oder Wiedergabe, § 184 StGB bei der Verwertung). Teams und Zoom
benachrichtigen die Teilnehmer bei der **integrierten** Aufnahme - bei einem
externen Screen- oder Audio-Recorder erfolgt diese Benachrichtigung oft
**nicht**. Das ist das groesste Einzelrisiko des Vorhabens.

Fuen den Mikrofon-Zugriff gilt zusaetzlich: Desktop-Apps loesen **keinen**
UWP-Dialog aus. Der Zugriff laeuft stattdessen ueber die Einstellung
"Desktop-Apps den Zugriff auf Ihr Mikrofon erlauben" (Registry:
`HKCU\...\CapabilityAccessManager\ConsentStore\microphone`) und kann per
Intune-Policy erzwungen werden. Ein Mikrofonzugriff erzeugt zwar den
sichtbaren Datenschutz-Indikator in der Taskleiste, kann aber nicht
vollstaendig verhindert werden.

**Konsequenz fuer den Entwurf:** Der Beobachter sollte den
**Render-Endpoint** (Loopback) und die Session-/Ducking-Events nutzen, nicht
den Capture-Endpoint. Damit braucht die *Erkennung* ueberhaupt keinen
Mikrofonzugriff - erst die eigentliche Aufnahme beruehrt das Mikrofon.

### Das Start-Fenster: der eigentliche Designkonflikt

Auto-Start heißt: die App nimmt **auf**, ohne dass der Nutzer das verlangt
hat. Das erzeugt drei Konflikte, die in Granola durch die **Nutzer-geste**
gelöst werden - Granola startet nicht automatisch, und genau deshalb gibt
es dort keine Auto-Start-Diskussion.

1. **Zustimmung.** Eine automatisch gestartete Aufnahme erfasst Mikrofon und
   Systemton. Der Nutzer muss vorab zugestimmt haben. Ein Schalter
   "Automatisch starten" in den Einstellungen, der **explizit** gesetzt
   werden muss, ist das Mindestmaß.
2. **Fehlalarm.** Jedes Meeting, das ausserhalb des Kalenders läuft (ein
   Telefonat, ein Gespräch neben dem Rechner, ein Podcast), ist ein
   Fehlalarm. Granola reagiert darauf mit einer **Notification** und einem
   Klick - nicht mit einer Aufnahme. Ein Aufnahme-Fehlalarm erzeugt eine
   Transkriptdatei, die niemand wollte.
3. **Sichtbarkeit.** Der Nutzer muss jederzeit sehen, dass eine Aufnahme
   läuft. Windows zeigt bei aktivem Mikrofonzugriff einen Indikator, und
   `WasapiRecorder` öffnet den Aufnahme-Endpoint im Shared Mode
   (T-509) - dieser teilt sich mit anderen Anwendungen, sperrt das Gerät
   aber nicht exklusiv.

### Vorschlag: zweistufig, mit Bestätigung im Hintergrund

Vorschlag, der die Konflikte 1 und 2 entschärft, ohne die Produktidee
(Grenzen) aufzugeben:

- **Stufe 1 (Erkennung ohne Aufnahme):** Der Beobachter meldet eine
  **Verdachtserkennung** ("Meeting-Apps aktiv, Mikrofon belegt"). Es wird
  **nichts aufgezeichnet**, nichts gespeichert, nichts gesendet. Die App
  zeigt das als dezente Statuszeile ("Meeting erkannt - Aufnahme startet
  in 30 s") oder gar nicht.
- **Stufe 2 (Auto-Start nach Bestätigung):** Nach einer kurzen
  Bestätigungsfrist (Vorschlag: 30 s, einstellbar) ohne Nutzereingriff
  startet die Aufnahme - **nur wenn** der Modus "Automatisch starten"
  aktiviert ist. Vor dem Start prüft die App die Startbedingungen
  (`isConfigReady` in `use-app-state.ts`): ohne vollständige
  Azure-Konfiguration gibt es keinen Auto-Start.
- **Rücknahme jederzeit** über dieselbe Statuszeile.

Damit ist der Normalfall (Meeting läuft, Nutzer ist weg) die Aufnahme
startet - das ist die eigentliche Produktidee. Der Fehlalarm kostet
weniger, weil er nur ein 30-Sekunden-Fenster und eine sichtbare Anzeige
kostet.

### Abbruchbedingungen

Ein Auto-Start findet **nicht** statt, wenn:
- die Azure-Konfiguration unvollständig ist (`isConfigReady` ist false),
- der Modus "Automatisch starten" nicht aktiviert ist,
- bereits eine Aufnahme läuft (`status.running`),
- das Mikrofon nicht verfügbar oder der Aufnahme-Endpoint nicht erreichbar
  ist (analog zur vorhandenen Fehlerbehandlung in `start_recording`),
- die App gerade beendet wird.

### Aufbau im bestehenden Projekt

Der Beobachter gehört **in den Sidecar**, nicht in den Tauri-Main:
- Der Sidecar ist der Prozess, der bereits den Aufnahme-Endpoint geöffnet
  hat und die Audio-Grenze kennt. Eine Erkennung, die nichts aufnimmt, ist
  im Sidecar eine Abwesenheit von Aufnahme, kein Sonderfall im Main.
- Der Sidecar hat die NAudio-Abhängigkeit bereits (`NAudio` 3.3.0) und
  kennt `DeviceResolver` für die Geräteauflösung.
- Die Erkennung muss **ohne** Azure funktionieren - ein Kalender oder ein
  Fenstertitel braucht keinen Cloud-Zugang.

Der Sidecar meldet die Verdachtserkennung als **neues JSON-Lines-Event**
über den bestehenden Kanal (das Muster steht in T-201):
`{"type":"meeting:detected","payload":{"source":"session","processId":1234,"confidence":"session"}}`.
Der Tauri-Main leitet es als `transcript:meeting-detected` weiter
(Tauri-Events in `TAURI_EVENTS` in `src/shared/tauri-contract.ts`), der
Renderer reagiert darauf mit dem Start- oder Countdown-Pfad.

Für den Fenster-Titel- oder Kalender-Weg käme ein **zweiter** Mechanismus
hinzu, der in einem eigenen Schritt nach dem Audio-Mechanismus gebaut wird
(siehe "Reihenfolge").

### Einstellungen

Neue Achse in `UserSettings` (in `src/shared/config-contract.ts`, Default
in `normalizeUserSettings`, Persistenz in `src-tauri/src/settings.rs`):

    export interface AutoStartSettings {
      enabled: boolean          // Default: false
      mode: 'notify' | 'record' // Default: 'notify'
      confirmSeconds: number    // Default: 30
    }

Der Default `enabled: false` ist bewusst: Auto-Start ist eine bewusste
Entscheidung des Nutzers, kein Default.

### Reihenfolge der Umsetzung

1. **Session-Graph-Beobachter** im Sidecar (rein lesend, keine Aufnahme):
   `AudioSessionManager` + `RegisterEventClient` + `GetProcessID`.
   Beleg: neue Datei `sidecar/MeetingDetector.cs` plus Event
   `meeting:detected`.
2. **Mikrofonbelegung** über `AudioMeterInformation.MasterPeakValue` als
   zusätzliches Signal (statt nur Session-Zustand).
3. **UI**: Statuszeile "Meeting erkannt", Countdown, Abbruch.
4. **Auto-Start** mit den Abbruchbedingungen, inklusive `isConfigReady`-Prüfung.
5. **Ende-Erkennung** (Stille, Session-Ende, optional Kalender-Ende).
6. **Optional Kalender** (COM-Interop wie `outlook-mcp-server`, oder WinRT
   `AppointmentManager`) für das planmäßige Ende und zur Fehlalarm-
   Reduktion.
7. **Optional Fenstertitel** (`GetWindowTextW`/`EnumWindows`) als
   zusätzliches Signal, falls die Prozess-ID allein zu unscharf ist.

Die Schritte 1-3 sind der Kern und kommen ohne Kalender, ohne OAuth und ohne
neues Nuget-Paket aus.

## Datenfelder
- `user.autoStart.enabled`, `user.autoStart.mode`,
  `user.autoStart.confirmSeconds` (in `UserSettings`)
- `user.autoStart.allowedProcesses` (Liste von Prozessnamen, Default:
  Teams, Zoom, Meet) - erste Iteration auf einen fixen Satz, später
  konfigurierbar

## Done When
- [x] Recherche-Beleg: Granola startet **nicht** automatisch, sondern per
  Notification plus Klick; die Notification entsteht aus zwei Quellen
  (Kalendertermin, Mikrofonbelegung). Beleg: docs.granola.ai
  (help-center/taking-notes/transcription.md, help-center/taking-notes/notifications.md).
- [x] Recherche-Beleg: die für die Erkennung nötigen Core-Audio-APIs sind
  in NAudio 3.3.0 bereits enthalten - ohne neues NuGet-Paket. Beleg:
  Reflection über NAudio.Wasapi 3.3.0 (AudioSessionManager, AudioSessionControl
  mit GetProcessID, AudioMeterInformation mit MasterPeakValue,
  AudioSessionEventsCallback mit OnStateChanged) - alle Typen vorhanden.
- [x] Recherche-Beleg: die Windows-Fenster-APIs für die Titelauswertung sind
  dokumentiert und frei zugänglich. Beleg: learn.microsoft.com
  (GetWindowTextW, EnumWindows, SetWinEventHook).
- [x] Recherche-Beleg: der Kalender-Weg braucht ein Konto (Graph/OAuth) und
  läuft nicht in Echtzeit; er ist für den Start nicht tauglich. Beleg:
  docs.granola.ai (Syncing your calendars: "within a few minutes"),
  learn.microsoft.com (Graph calendarView).
- [x] Recherche-Beleg: Granola beendet die Aufnahme über drei Signale
  (Call-Ende, planmäßiges Terminende, 15 min ohne Audio). Beleg:
  docs.granola.ai (help-center/taking-notes/transcription.md).
- [x] Recherche-Beleg: der bestehende Kalender-Zugriff im Workspace-Projekt
  `outlook-mcp-server` (COM-Interop, `list_events` mit ISO-8601 und
  IANA-Zeitzone) ist als Quelle für das Terminende wiederverwendbar. Beleg:
  projects/outlook-mcp-server (src/OutlookMcpServer/Tools/CalendarTools.cs,
  list_events).
- [x] Kein Kalender und keine Cloud für den Start nötig: der Mechanismus nutzt ausschließlich lokale System-APIs. Beleg: kein Graph-/OAuth-Aufruf im geplanten Pfad (Abbruchbedingungen).
- [ ] Der Modus ist standardmäßig **inaktiv** (`enabled: false`) - Auto-Start ist eine bewusste Nutzerentscheidung. Beleg: normalizeUserSettings (Default je Feld `false`). - **offen**: die Einstellungs-Achse ist noch nicht implementiert; das Spec definiert nur den Zielzustand.
- [ ] Ohne vollständige Azure-Konfiguration startet die Aufnahme nicht automatisch. Beleg: `isConfigReady` in use-app-state.ts als Vorbedingung des Auto-Starts. - **offen**: setzt die Umsetzung des Auto-Starts voraus.
- [ ] Die Erkennung läuft im **Sidecar** (nicht im Tauri-Main) und nimmt dabei nichts auf. Beleg: neue Datei sidecar/MeetingDetector.cs, Event `meeting:detected`. - **offen**: `sidecar/MeetingDetector.cs` existiert noch nicht.
- [ ] Die Erkennung ist ereignisgesteuert, nicht per Timer. Beleg: `RegisterEventClient` (AudioSessionEvents) bzw. `OnSessionCreated`. - **offen**: folgt der Umsetzung des Beobachters.
- [ ] Das Ende nutzt mehrere Signale (Stille, Session-Ende, optional Kalender-Ende), nicht nur eines. Beleg: sidecar/MeetingDetector.cs (Ende-Erkennung). - **offen**: setzt die Umsetzung des Beobachters voraus.
- [ ] Jede automatisch gestartete Aufnahme ist für den Nutzer sichtbar und jederzeit abbrechbar. Beleg: Statuszeile im Renderer, Abbruch-Button. - **offen**: die UI ist noch nicht vorhanden.
- [x] Recherche-Beleg: der stärkste einzelne OS-Trigger ist das Ducking-Event (`IAudioVolumeDuckNotification`): "the system adjusts the volume of a non-communication stream when a new communication stream is opened". Beleg: learn.microsoft.com (audiopolicy/nn-audiopolicy-iaudiovolumeducknotification, coreaudio/getting-ducking-events-from-a-communication-device).
- [x] Recherche-Beleg: NAudio 3.3.0 deckt Session-Graph, Zustands-Events und Pegel ab, **aber kein Ducking** - die Reflection über `NAudio.Wasapi` liefert keine Ducking-Typen und `AudioSessionManager` hat keine `RegisterDuckNotification`-Methode. Beleg: Reflection ueber NAudio.Wasapi 3.3.0 (Ducking-Typen: keine) - fuer das Ducking-Signal waere rohes COM-Interop noetig.
- [x] Recherche-Beleg: der WinRT-Weg `Windows.ApplicationModel.Appointments` haengt am `AppointmentsProvider`-Contract von "Mail & Calendar"; die App wurde unter Windows 11 durch das neue Outlook ersetzt (Dezember 2024) - der Weg ist damit praktisch tot. Beleg: support.microsoft.com (outlook-for-windows-the-future-of-mail-calendar-and-people-on-windows-11).
- [x] Recherche-Beleg: fuer Meeting Notes ist der Bot-Weg (Kalender plus Bot, wie bei Fireflies, tl;dv, Avoma, Fathom, Sembly, Read AI) ausgeschlossen - fuer Teams, Zoom und Meet gibt es keine oeffentlichen lokalen Desktop-Hooks, und ein Bot braucht den Einladungslink. Beleg: learn.microsoft.com (graph/changenotifications-for-onlinemeeting), developers.zoom.us (docs/api/webhooks), developers.google.com (workspace/meet/api/guides/overview).
- [x] Recherche-Beleg: die rechtliche Grenze ist technisch nicht loesbar - eine Aufnahme ohne Zustimmung der Teilnehmer ist in Deutschland problematisch (§ 201 StGB), und bei externen Rekordern erfolgt die Teilnehmer-Benachrichtigung oft nicht. Beleg: docs.granola.ai (help-center/consent-security-privacy/security-privacy-data-faqs.md - "Granola requires you to click to start recording").
- [ ] Verifikation: Node-Tests, Rust-Tests und C#-Validierung grün. Beleg: npm run verify - alle grün. - **offen**: erst nach der Umsetzung sinnvoll prüfbar.
- [ ] Live-Abnahme: ein echtes Meeting (Teams oder Zoom) startet die Aufnahme ohne Nutzeraktion, und ein normales Podcast-Playback löst **keinen** Auto-Start aus. Beleg: manuelle Abnahme am Zielrechner - die Zielrechner-Abnahme ist eine bewusste Lücke in diesem Spec. - **offen**: braucht einen echten Rechner mit Teams oder Zoom und einen Podcast-Playback als Gegenprobe.

## Offene Fragen
- **Kalender oder nicht?** Schritt 6 ist optional. Für den Start wird er
  nicht gebraucht; für das Ende und gegen Fehlalarme hilft er. Die
  Entscheidung fällt bei der Umsetzung von Schritt 5.
- **Prozessliste.** Eine feste Liste (Teams, Zoom, Meet) ist der
  Startpunkt. Eine konfigurierbare Liste ist wahrscheinlich nötig, weil
  Firmen andere Tools nutzen (z. B. Slack-Huddles - Granola erkennt diese
  ausdrücklich, siehe "Huddle detected").
- **Schwellenwerte.** Die Peak-Schwelle für "Mikrofon belegt" und die
  Stille-Dauer sind frei gewählt. Granolas 15 Minuten sind ein Anhaltspunkt,
  aber für Meeting Notes ist eine kürzere Zeit plausibler, weil die
  Aufnahme ohnehin in Echtzeit läuft.
- **Mehrere Meetings hintereinander.** Granola hat dokumentierte Probleme mit
  Back-to-Back-Meetings (das Mikrofon bleibt aktiv). Hier relevant, weil
  das Mikrofon-Signal dann nicht sauber trennt.
- **Abstimmung mit T-507 (Pause/Stop).** Der Auto-Start muss sich in die
  bestehende Sitzungs-Semantik einfügen: Pause hält die Azure-Sitzung,
  Stop beendet sie endgültig. Ein automatisch gestarteter Durchlauf darf
  eine laufende Sitzung nicht verdrängen.
- **Zielrechner-Abnahme.** Die Live-Prüfung an einem echten Meeting ist
  eine Zielrechner-Abnahme und steht aus - wie bei T-510.
- **Rechtliche Bewertung.** Eine automatisch gestartete Aufnahme von
  Mikrofon und Systemton kann personenbezogene Daten erfassen. Die
  Bewertung der Aufzeichnungspflicht und der Anzeige obliegt dem Betreiber;
  dieses Spec behandelt nur die Technik.

## Nicht-Ziele
- Ein Bot, der dem Meeting beitritt (wie Fireflies, tl;dv, Avoma, Fathom,
  Sembly) - Meeting Notes ist ein lokales Desktop-Tool ohne Kalenderkonto.
- Cloud-Kalender-Zugriff über Microsoft Graph oder OAuth.
- Screen-Recording oder Fensteraufnahme über `Windows.Graphics.Capture`.
- Sprechertrennung über Meeting-Apps hinweg (Sprechernamen aus der
  Kalender-Teilnehmerliste).
- Erkennung über Grafik oder Bildanalyse.