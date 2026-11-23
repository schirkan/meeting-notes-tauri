# T-507: Pause, Stop und sessionsichere Sprecherzuordnung

## Kontext
Status: umgesetzt
Priorität: high
Abhängigkeiten: T-205, T-306, T-404, T-406

## Goal
Pause und Stop bekommen eindeutige, technisch tragfähige Semantik:

- **Pause** hält die Azure-Sitzung am Leben, speist aber kein Audio zu. Die
  Sprecher-IDs der Sitzung bleiben gültig, der pausierte Abschnitt erscheint
  nicht im Transkript.
- **Stop** beendet die Sitzung endgültig. Ein Fortsetzen ist nicht möglich;
  der nächste Start beginnt ein **neues Transkript** mit frischer
  Sprecherbasis.

Ursache der bisherigen Fehlzuordnung war nicht der Start selbst, sondern dass
das Datenmodell die Azure-Sitzung nicht kannte: Azure vergibt die
Sprecher-IDs (Guest-N) pro Sitzung neu, das Segment-Payload führte aber
keine Session-ID. Dadurch fiel ein Alias aus der vorigen Sitzung still auf
eine andere Person und Final-Segmente wurden über die Sitzungsgrenze hinweg
zusammengeführt.

## Done When
- [x] Das Segment-Payload führt die **Session-ID** mit. Der Sidecar meldet die Beleg: sidecar/AzureSpeechService.cs (sessionId im Transcript-Payload) und src/shared/transcript-contract.ts.
  Azure-Session-ID pro Quelle (SessionStarted) im Feld `sessionId`; bis Azure
  sie meldet, wird eine eindeutige Kennung des Streams verwendet.
- [x] Die Sprecheridentität im UI ist **sessionsicher** Beleg: src/renderer/src/speaker-utils.ts (Identitaet aus sessionId und source) und src/shared/transcript-contract.ts. Testnachweis: Node-UI-Test "the same SDK id in two sessions stays two separate speakers with separate aliases".
  (`<sessionId>|<source>:<speaker>`, `getSpeakerIdentity`). Alias-Zuordnung und
  Merge-Zuordnung benutzen diese Identität, nie die nackte SDK-ID.
- [x] Segmente unterschiedlicher Sitzungen werden **nicht** zusammengeführt. Beleg: src/renderer/src/use-app-state.ts (Merge nur innerhalb derselben Identitaet). Testnachweis: Node-UI-Test "the same SDK id in two sessions stays two separate speakers with separate aliases".
- [x] Eine neue Azure-Sitzung erhält eine neue Identität. Die Beleg: src/renderer/src/speaker-utils.ts (neue Azure-Sitzung ergibt eine neue Identitaet). Testnachweis: Node-UI-Test "the same SDK id in two sessions stays two separate speakers with separate aliases".
  Sprecherzuordnung wird dadurch nicht still auf eine fremde Person
  übertragen; das UI nummeriert die Anzeige, wenn dieselbe SDK-ID in zwei
  Sitzungen vorkommt (Speaker · Guest-1 #2).
- [x] **Pause** (`pause_recording`) schickt `{"type":"pause"}` an den Beleg: src/shared/tauri-contract.ts (pause_recording) (geprueft).
  Sidecar. Der Sidecar stoppt die Audio-Zufuhr, beendet die Azure-Sitzung
  aber **nicht**. Status: `paused`.
- [x] **Fortsetzen** (`resume_recording`) schickt `{"type":"resume"}` und Beleg: src/shared/tauri-contract.ts (resume_recording) (geprueft).
  setzt die Audio-Zufuhr fort. Status: `running`, Startzeit unverändert.
- [x] Der Sidecar liest Kommandos über **stdin** (bisher wurden Beleg: sidecar/Program.cs (liest pause, resume, reset und shutdown ueber stdin).
  `{"type":"reset"}` und `{"type":"shutdown"}` gesendet, aber nicht
  gelesen). Unterstützt: `pause`, `resume`, `reset`, `shutdown`.
- [x] Der Sidecar erkennt eine vom Dienst beendete Sitzung und verbindet sie Beleg: sidecar/AzureSpeechService.cs (erkennt eine vom Dienst beendete Sitzung und verbindet sie neu).
  neu. Während einer Pause wird bewusst **nicht** neu verbunden — sonst
  wären die Sprecher-IDs der Pause verloren.
- [x] **Stop** beendet die Sitzung endgültig. Der nächste Start setzt Beleg: sidecar/Program.cs (Stop beendet die Sitzung endgueltig).
  Segmente und Sprecherbasis zurück: das ist ein neues Transkript.
- [x] Der Markdown-Export bekommt einen **Snapshot** der beendeten Sitzung. Beleg: src-tauri/src/commands.rs (Snapshot der beendeten Sitzung beim Markdown-Export).
  Startet direkt nach dem Stop ein neues Transkript, geht der Export des
  beendeten Transkripts trotzdem nicht verloren.
- [x] Die UI zeigt einen zusätzlichen Knopf Pause/Weiter neben Start/Stop; Beleg: src/renderer/src/components/HeroStatusCard.tsx (Pause-/Weiter-Knopf neben Start/Stop).
  der Status lautet Pausiert mit der Beschreibung Aufnahme pausiert — Sitzung
  bleibt aktiv.
- [x] Die Laufzeitanzeige berücksichtigt die Pausezeit: Pausen sind nicht Beleg: src/renderer/src/use-app-state.ts (Pausen zaehlen nicht als Aufnahmezeit); im Node-Test abgedeckt.
  aufgenommene Zeit und werden nicht als Dauer gewertet.

## Approach
- **Datenmodell (Fundament):** `TranscriptSegment.sessionId` in
  `src/shared/transcript-contract.ts`. Der Sidecar hält pro Quelle die
  Azure-Session-ID (`StreamState.OnSessionStarted`) und meldet sie im
  Transcript-Event. Die Identität ist sticky: sie wechselt erst, wenn Azure
  tatsächlich eine neue Sitzung meldet.
- **UI:** `getSpeakerIdentity` und `formatSpeakerIdentity` in
  `src/renderer/src/speaker-utils.ts`. Die Alias-Map ist über diese Identität
  geschlüsselt, der Merge-Vergleich nutzt sie ebenfalls.
- **Pause (Variante 2b):** Die Azure-Sitzung bleibt offen, aber
  `AzureSpeechService.PushFrame` verwirft Frames im Pausezustand. Das
  erfüllt den Namen Pause: der pausierte Abschnitt wird nicht transkribiert,
  und die IDs bleiben stabil.
- **Transport:** Der Sidecar bekommt einen stdin-Reader
  (`SidecarCommands.ReadType`). Die Kommandos sind JSON-Lines auf stdin,
  passend zu AD-008 und T-201.
- **Rust:** `pause_recording` und `resume_recording` schreiben über die
  bestehende `sidecar::send_command`-Schale. `TranscriptStatus` erhält
  `paused`; `mark_paused` und `mark_resumed` setzen die Startzeit **nicht**
  zurück.
- **Stop:** Der Renderer leert Segmente und Aliase nur bei einer neuen Sitzung.
  Der initial geladene Status und spaetere Pause-/Resume-Ereignisse derselben
  Sitzung loeschen nichts. Eine spaete Quittung fuer **Clear** darf eine inzwischen
  gestartete Sitzung nicht zuruecksetzen. Native Stop-Fehler zeigen ihre Details
  auch dann, wenn der Status bereits auf gestoppt gewechselt hat.

## Offene Punkte
- Die Azure-Dienstgrenze von **60 Minuten Verbindungsdauer** je Sitzung und
  **240 Minuten Audiolänge** bei Echtzeit-Diarisierung gilt auch für eine
  pausierte Sitzung. Eine sehr lange Pause kann die Sitzung also beenden.
  Der Sidecar erkennt das und verbindet neu; die Sprecher-IDs werden dabei
  neu vergeben, das UI baut die Zuordnung sichtbar neu auf.
- Die tatsächliche Zuordnung der Sprecher-IDs über eine Pause hinweg ist
  noch nicht gegen die echte Azure-Dienstinstanz verifiziert (analog zum
  Proxy-Test in T-306/T-505 noch offen).

## Log
- 2026-11-13: Spec angelegt und umgesetzt. Session-ID im Segment-Payload,
  sessionsichere Alias- und Merge-Schlüssel, Pause als Sitzung lebt ohne
  Audio, Stop als endgültiger Abschluss mit neuem Transkript pro Start.
  Sidecar liest jetzt stdin-Kommandos (pause/resume/reset/shutdown).
  Verifiziert: 51 Node-Tests, 18 Rust-Tests, 467 C#-Assertions, TypeScript-/.NET-Build, Release-Build und Smoke-Test (25/25 Hashes) grün;
  Live-Verifikation der Sprecher-IDs über eine Pause steht aus.
