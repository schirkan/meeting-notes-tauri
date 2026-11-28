# Spezifikation v0.1 — Meeting Notes

Stand: 28.11.2026
Status: Letzte Veroeffentlichung ist [v0.1.9](https://github.com/schirkan/meeting-notes-tauri/releases/tag/v0.1.9). Die folgenden Anforderungen beschreiben den Entwicklungsstand; lokale WAV-Aufnahme, Dateitranskription und experimentelle Windows-Modelle sind noch nicht veroeffentlicht. Offene Abnahmen stehen in den Einzel-Specs.

Nutzerabnahme vom 28.11.2026: Azure-Speech-Live-Aufnahme unter 5 s im Praxistest ([T-500](./specs/T-500-qualitaetssicherung-und-akzeptanztests.md)); P95 und der 100-Chunks-Report sind nicht nachgewiesen ([T-502](./specs/T-502-latency-messung.md)). Auf frischem Windows 11 mit WebView2 ohne installierte .NET-Runtime wurden App-Start, Settings ohne Azure-Config, Config neben der EXE und verstaendliche Netzwerk-/Proxyfehler manuell bestaetigt ([T-510](./specs/T-510-clean-machine-deployment-windows-11.md)).

Historischer Nachweis fuer **v0.1.3**: Voll-Verifikation mit **9 Schritten**, **94 Node-Tests**, **47 Rust-Tests**, **539 C#-Assertions** gegen Quellen / **552** gegen den publizierten Sidecar, Smoke gruen, Deployment **PASS 9 / FAIL 0**. Die manuelle Tray-Teilabnahme vom 19.11.2026 steht in [T-514](./specs/T-514-systray-und-schliessen-verhalten.md). Weitere Release-Belege: [T-515](./specs/T-515-github-actions-pipeline-und-release.md).
Historischer Nachweis fuer **v0.1.2**; Portable-Build **31,37 MB** (4 Dateien, 3 gepruefte Hashes; Build vom 2026-11-19, `ProductVersion` 0.1.2), `npm run verify -- --full` (**9 Schritte gruen**), Build-Smoke inklusive Sidecar-Geraeteabfrage und Deployment-Nachweis (**PASS 9 / FAIL 0**); dafuer TypeScript, **92 Node-Tests**, **44 Rust-Tests** und **539 C#-Assertions** (davon **552** gegen die publizierte, getrimmte Sidecar-EXE).

Historischer Nachweis fuer **v0.1.1**; Portable-Build **30,74 MB** (4 Dateien, 3 geprüfte Hashes; Rebuild vom 2026-11-18 - flaches Layout mit `MeetingNotes.exe` und **self-contained** Single-File-Sidecar, `ProductVersion` 0.1.1) mit der EXE `MeetingNotes.exe`, dem gemeinsamen Config-Template, der unabhängigen Mic-/Speaker-Diarization und der auswählbaren Transkriptions-Quelle (`user.transcription`, Mic/Speaker/beides); `npm run verify -- --full` (**9 Schritte grün**), Build-Smoke inklusive Sidecar-Geräteabfrage und Deployment-Nachweis (**PASS 9 / FAIL 0**) erfolgreich. Dafür sind TypeScript, **85 Node-Tests**, **35 Rust-Tests** und **508 C#-Assertions** (davon **521** gegen die publizierte, getrimmte Sidecar-EXE) erfolgreich; die Node-/UI-Tests laufen im CLI-Browserlauf grün. Nicht jede ursprüngliche Audio-/Protokoll-Anforderung ist als abgenommen bestätigt; Einzelstatus siehe [Specs](./specs/).

Diese Spezifikation ist die **Windows-Variante** von `../meeting-notes/SPEC-v0.1.md` (Electron-Projekt, unveränderte Referenz). Architekturziel: Tauri 2 + React + C#-Sidecar (mit Azure Speech SDK in NuGet-Form). Die Anwendung selbst heißt *Meeting Notes*; „Tauri" ist die Container-Technik, nicht Teil des Produktnamens.

---

## Stand der Specs (Abgleich 28.11.2026)

Die Checkboxen wurden gegen den **Code** geprueft, nicht gegen den Spec-Status:
jeder abgehakte Punkt traegt den Beleg im Klartext (`Beleg: …`), jeder offene
Punkt nennt den konkreten Grund (`- **offen**: …`). Ergebnis: **47 Specs** als
`umgesetzt` bzw. `teils umgesetzt` markiert, **23 offene Punkte in 14 Specs**.
Vorher waren ueber 70 Checkboxen offen, obwohl die Funktion ueberwiegend fertig
und verifiziert war - die Specs sind jetzt mit dem Stand der Implementierung
deckungsgleich.

_Dieser Abschnitt wird von `npm run docs:specs` aus den Spec-Dateien erzeugt._

### Offen und braucht deinen Rechner (14 Punkte)

| Spec | Punkt |
|---|---|
| T-502 | Report `context/latency-report.md` mit P50/P95/P99 über 100 Audio-Chunks - **offen**: |
| T-502 | Ziel: P95 < 5 s End-to-End |
| T-509 | Das Loopback-Verhalten ist unveraendert: Events nur waehrend tatsaechlicher |
| T-509 | Latenz und Ausgabequalitaet sind auf echter Hardware gegen die |
| T-514 | Native Windows-Abnahme: X/Alt+F4 mit deaktivierter Tray-Minimierung und **Quit** bei verborgen… |
| T-514 | Native Windows-Abnahme der Taskleistenoption. |
| T-521 | Hardwarelauf belegt Zeitanker, Resampling-Fallback, Drift und gleichzeitige Sprache. |
| T-522 | Spike belegt MAI-Mono-Modell, Standard-Stereo-Kanalresultate und Ziel-Proxy. |
| T-522 | Meter und Kostenvorteil ausserhalb der Promo sind fuer die Zielnutzung belegt. |
| T-522 | Live-Qualitaet, Lifecycle und Portable-Abnahme der MAI-Preview sind dokumentiert. |
| T-524 | 64-Bit-Engine fuer Deutsch und Englisch, Mic und Loopback einzeln sowie getrennt bei gleichzei… |
| T-524 | Mindestens 30 Minuten Referenzgespraech fuer die experimentellen Modelle inkl. Ueberlappung un… |
| T-524 | Clean-Machine-Nachweis am getrimmten Portable-ZIP: kein Azure-Konto oder Key, dokumentierte Wi… |
| T-525 | Reales Mikrofon und Loopback zusammen aufnehmen; Synchronitaet und automatisches Stoppen am Me… |

### Offen als bewusste Entscheidung (9 Punkte)

| Spec | Punkt | Warum offen |
|---|---|---|
| T-101 | `npm run tauri build` produziert eine MSI- oder NSIS-Installer-Datei. | Installer (MSI/NSIS) wurden bewusst nicht gebaut; der Lieferweg ist die Portable-Distribution (siehe README). |
| T-203 | Smoke-Test: 48-kHz-Stereo-Input führt zu korrektem 16-kHz-Mono-Output… | Der Stichprobentest ist implementiert (`ResamplingValidation`: 48-kHz-Stereo-Ton → 16-kHz-Mono, Länge, Pegel, Übersteuerung, Drop… |
| T-501 | Reproduzierbarer WebDriver-End-to-End-Test mit App-Start, `start_reco… | Der Nutzer bestaetigte am 28.11.2026 den Ablauf fuer das Azure Speech SDK. Ein WebDriver-Skript oder ein Laufprotokoll fuer die A… |
| T-503 | `npm run lint` (sofern konfiguriert) ist grün | kein Lint-Setup im Projekt. |
| T-513 | Stille-Timer mit echten Mikrofon- und Loopback-Quellen bei verborgene… | erfordert interaktive Windows- und Audio-Abnahme. |
| T-513 | Ein normales Podcast-Playback loest **keinen** Auto-Start aus. | Fuer die Gegenprobe am Zielrechner liegt kein Ergebnis vor. |
| T-513 | Fenster-/Applikations-Fallback nur bei nachgewiesenem Bedarf ergaenze… | Der Nutzer bestaetigte am 28.11.2026, dass Teams funktioniert. Fuer den bestaetigten Teams-Fall ist kein Fallback noetig; daraus… |
| T-520 | Kosten-, Qualitaets-, Proxy- und Portable-Nachweise fuer die MAI-Frei… | Der Nutzer hat den Freigabevorbehalt am 28.11.2026 bestaetigt. Die separat abgefragten Nachweise in [T-522](./T-522-mai-transcrib… |
| T-523 | Laufzeitnachweis fuer die experimentellen Modelle auf Windows x64. | Laut Nutzerrueckmeldung vom 28.11.2026 ist die SAPI-Qualitaet weiterhin sehr schlecht. Quellenisolation, Dauerlauf und WebView2-M… |

### Nächste Schritte auf dem Zielrechner

Diese Auswahl ergaenzt die erzeugte Uebersicht. Voraussetzungen sind je nach
Pruefung eine interaktive Windows-Sitzung, reale Audio-Endpunkte oder gueltige
Azure-Zugangsdaten. Weitere provider- und dateispezifische Abnahmen siehe
[T-522](./specs/T-522-mai-transcribe-machbarkeit-kosten-abnahme.md),
[T-524](./specs/T-524-native-windows-stt-machbarkeit.md) und
[T-525](./specs/T-525-batch-transkription-und-lokale-aufnahme.md).

**1. Statistischen Latenznachweis ergaenzen (T-502)** — das Werkzeug liegt vor:

```powershell
npm run measure:latency -- --live
```

Die App startet selbst, du startest die Aufnahme im Fenster, das Skript
sammelt bis zu 100 Messzeilen und schreibt `context/latency-report.md`
(P50/P95/P99 je Stufe, Ziel P95 < 5 s). Ohne Messung läuft stattdessen
`npm run measure:latency -- --selftest` — das prüft nur die Statistik.

**2. Loopback-Verhalten und Ausgabequalität (T-509)** — während einer
Aufnahme etwas abspielen: Es dürfen **nur** dann Speaker-Events ankommen,
wenn tatsächlich Audio aus dem Ausgabegerät läuft. Mic und Speaker
getrennt prüfen (`user.transcription.mic` / `.speaker`).

**3. Resampler-Stichprobe (T-203)** — in einer **interaktiven** Sitzung:

```powershell
npm run test:sidecar
```

Der Test laeuft nur, wo Media Foundation antwortet. Ein `SKIPPED` gilt nicht als Abnahme.
Auf deinem Rechner prüft er 48-kHz-Stereo → 16-kHz-Mono inklusive Länge,
Pegel, Übersteuerung und Dropouts.

**4. Optional: Deployment-Protokoll fuer einen konkreten Build (T-510)** — Ordner
`dist/portable` kopieren, WebView2 sicherstellen (keine .NET-Installation noetig), dann:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-deployment.ps1 -PortableDir D:\Apps\MeetingNotes -LaunchApp
```

Das Skript prüft Windows-Build, WebView2, alle SHA256-Summen,
das Fehlen einer persönlichen Config, den Sidecar und die PE-Subsysteme.

**5. Regression: Pause über Azure (T-507)** — Aufnahme starten, sprechen, pausieren,
weiter sprechen, stoppen. Die Sprecher-IDs müssen **über die Pause hinweg**
stabil bleiben (das ist der eigentliche Zweck der Pause-Semantik).

## 1. Ziel

Eine portable, unsignierte Windows-Anwendung fuer Live-Transkripte und lokale Audioaufnahmen. Der Entwicklungsstand ergaenzt den Standardpfad mit Azure Speech um experimentelle Live-Modelle und WAV-Dateitranskription.

**Quantitative Ziele:**
- Bundle-Größe (Windows): **≤ 30 MB** (gegenüber ~180 MB im Electron-Projekt).
- Latenz: neue Transkriptsegmente erscheinen innerhalb von **< 5 Sekunden** in der UI (wie bisher).
- Funktionale Parität mit `../meeting-notes/` zum Zeitpunkt der Migration (Feature-Liste siehe `README.md`).

## 2. Scope
- Plattform: ausschließlich Windows 11
- Testumgebung: Laptop mit integriertem Mikrofon
- Headsets:
  - Bluetooth: out of Scope
  - kabelgebunden: unterstützt
- **Kein** Mobile-Build (iOS/Android) — siehe `DECISIONS.md → AD-005`
- **Kein** macOS/Linux-Build (Windows 11 only)

## 3. Audio-Erfassung
- Zwei getrennte Erfassungspfade (wie bisher):
  - Pipeline A: Mikrofon
  - Pipeline B: primärer Speaker-Output (Loopback)
- Mikrofon, Loopback oder beide sind waehlbar. Eine aktivierte, nicht verfuegbare Quelle wird nicht stillschweigend abgeschaltet. Web Speech beschraenkt sich auf das Windows-Standardmikrofon. Siehe [T-511](./specs/T-511-transkriptions-quellen-auswaehlen.md) und [T-523](./specs/T-523-native-windows-stt-provider.md).
- Audio wird im Sidecar aufgenommen, ausser im Web-Speech-Pfad (WebView2). Roh-Audio wird nicht ueber IPC transportiert.

## 3.1 Technische Architektur

- **App-Container:** Tauri 2 (Rust). Verantwortlich für Fenster/WebView2-Lifecycle, Sidecar-Spawn, Settings-Persistenz, UI-Bridge.
- **Systray (T-514):** natives Tray-Icon, Kontextmenue `Anzeigen`/`Beenden`, linker Doppelklick stellt das Hauptfenster wieder her und fokussiert es. Die Iconfarbe zeigt den Aufnahmestatus: **rot** bei laufender Aufnahme, **gelb** bei Pause, zurueck auf die Originalfarbe nach Stop oder Sidecar-Crash. Die Aktualisierung laeuft ueber `tray::update_recording_indicator` bei jedem Status-Event; ein veralteter Status kann die Farbe nicht zuruecksetzen. `user.window.minimizeToTrayOnClose` (Default true ab v0.1.2) verbirgt beim Schliessen nur das Fenster; Aufnahme und Detektor bleiben unveraendert. Explizites Tray-Beenden umgeht CloseRequested und nutzt das vorhandene Sidecar-Cleanup. Gespeicherte Aenderungen gelten sofort. Bei fehlendem/unerreichbarem Tray oder Hide-Fehler bleibt regulaeres Schliessen erhalten.
- **Meeting-Erkennung:** Der separate Core-Audio-Detektor (`--detect-only`) beobachtet Audio-Sessions erlaubter Prozesse ohne Audio-Capture oder Azure. Nach 3 s Inaktivitaet aller Sessions des ausloesenden Prozesses beendet der bestehende Auto-Stop nur die zugehoerige automatisch gestartete Aufnahme. Teams wurde im Praxistest bestaetigt. Podcast-Gegenprobe und geplanter Auto-Stop nach Stille siehe [T-513](./specs/T-513-automatische-meeting-erkennung-und-auto-start.md).
- **Backend:** C#/.NET 10 als Sidecar (`MeetingNotes.Sidecar.exe`, self-contained, komprimiert und konservativ getrimmt). Verantwortlich fuer Audio-Capture, Resampling, lokale WAV-Aufnahme, Azure Speech, Windows SAPI und Meeting-Erkennung.
- **Frontend:** React 19 + TypeScript 7 + Vite 8 (im Tauri-Renderer-WebView2).
- **IPC Sidecar ↔ App:** `stdin/stdout` über `tauri-plugin-shell` mit JSON-Lines (siehe `DECISIONS.md → AD-008`). Named Pipe entfällt.
- **IPC App ↔ Renderer:** Tauri-`invoke()` für Commands + Tauri-`listen()` für Events (typed JSON).
- **Distribution:** Gesamter Portable-Ordner. Die Sidecar-EXE buendelt die .NET-Runtime sowie verwaltete/native Abhaengigkeiten und liegt neben der Haupt-EXE. Zielsystem braucht WebView2, aber keine installierte .NET-Runtime. Installer sind nicht Teil des Lieferwegs.

## 4. Transkription
- Live: Azure Standard als Default; MAI Preview, Windows SAPI und Web Speech mit modellspezifischen Grenzen. Modellmatrix: [T-523](./specs/T-523-native-windows-stt-provider.md).
- `user.diarization` steuert die Live-Sprechererkennung gemeinsam fuer alle aktiven Quellen, sofern das Modell sie unterstuetzt. Mehrsprechererkennung wurde live bestaetigt; Continuous LID ist dadurch nicht nachgewiesen ([T-205](./specs/T-205-continuous-lid-und-diarization-in-c-sharp.md)).
- Standard-Mono kann feste Sprache oder Continuous LID verwenden; Standard-Stereo verwendet die Primaersprache, MAI Live erkennt die Sprache automatisch. Kein automatischer Modellwechsel. Die fruehere Echo-Unterdrueckung wurde in v0.1.9 entfernt ([T-517](./specs/T-517-echo-cancellation-alpha.md)).
- **Record for later** speichert lokal zeitsynchrone WAV-Spuren. Dateitranskription hat eigene Einstellungen und verwendet Azure Standard, Azure MAI oder Windows SAPI. Nur ein bestaetigter Azure-Auftrag laedt WAV-Dateien hoch. Details: [T-525](./specs/T-525-batch-transkription-und-lokale-aufnahme.md).
- Azure vergibt die Sprecher-IDs pro Sitzung neu. Jedes Transkript-Segment fuehrt deshalb die Session-ID mit (`sessionId`). Das UI leitet daraus die sessionsichere Sprecheridentitaet `<sessionId>|<source>:<speaker>` ab: Alias-Zuordnung und das Zusammenfuehren von Segmenten ueberschreiten die Sitzungsgrenze nie. Siehe [T-507](./specs/T-507-pause-stop-und-sitzungsgebundene-sprecherzuordnung.md).
- **Implementierung:** NuGet-Paket `Microsoft.CognitiveServices.Speech` (C#) im Sidecar.
- Der Stop-Pfad muss je nach Recognizer-Typ korrekt erfolgen (`stopContinuousRecognitionAsync` vs. `stopTranscribingAsync`).
- Betriebsmodus: bevorzugt Echtzeit-Streaming (Implementierungsdetail des C#-SDK).
- Latenzziel: neue Transkriptsegmente erscheinen innerhalb von **< 5 Sekunden** in der UI.

## 5. UI (React)
- Anzeige der Transkripte mit Sprecher/Quelle, Zeitstempel, Text (sofern verfügbar).
- Dunkle Console-Oberfläche mit voller Fensterhöhe, einer 52-px-Kopfzeile und intern scrollendem Transkript. Timer und farbiger Statuspunkt stehen direkt neben dem Titel; Aufnahmeaktionen bleiben zentriert und beim Statuswechsel positionsstabil. Startzeit und Statusbeschreibung stehen als Tooltips zur Verfügung. Einstellungen immer als Icon; responsive Grenzen bei 800 und 500 px.
- Transkript mit 120-px-Spalte für farbigen Sprechernamen und `Uhrzeit | Sprache`. Namen sind direkt editierbar ohne Layout-Verschiebung (Enter/Verlassen übernimmt, Escape verwirft). Die standardmäßig geschlossene Sprecherzuordnung zeigt farblich passende Eingaben. Ein schwebender **Folgen**-Button erscheint beim Zurückscrollen (mehr als 24 px vom Ende) und aktiviert Auto-Scroll wieder.
- Sprecher-Alias-Mapping im UI für beide Quellen. Identitäten sind quellenspezifisch (`mic:Guest-1`, `speaker:Guest-1`), Standardlabels zeigen `Mic · Guest-1` bzw. `Speaker · Guest-1`; gleiche SDK-IDs verschiedener Quellen teilen keinen Alias. Nummerierte Mic-IDs nutzen einen Offset von 15 innerhalb der 30 zyklischen Farbslots.
- Aufnahmesteuerung mit **Start**, **Pause**/**Weiter** und **Stop**. Pause haelt die Azure-Sitzung am Leben, speist aber kein Audio zu: der pausierte Abschnitt erscheint nicht im Transkript, und die Sprecher-IDs der Sitzung bleiben gueltig. Stop beendet die Sitzung endgueltig; der naechste Start beginnt ein neues Transkript mit frischer Sprecherbasis. Ein Fortsetzen nach Stop ist nicht moeglich. Pausen zaehlen nicht als Aufnahmezeit.
- Bei geänderter SDK-Sprecher-ID ersetzt ein neues Interim-/Final-Event ältere Interims derselben Quelle; andere Quellen und finale Segmente bleiben erhalten. Transkript, Sprecherzuordnung und Export berücksichtigen Aliase.
- Diagnostikbereich mit laufendem Debug-Log (App/Sidecar/IPC).
- Die Debug-Fußzeile ist initial unsichtbar und wird über **Debug-Log** im Drei-Punkte-Menü umgeschaltet. Beim ersten Anzeigen öffnet sich der Logbereich nach oben, maximal bis 50 % des Inhaltsbereichs. Späteres Aus-/Einblenden erhält seinen Öffnungszustand. Fußzeile mit Fehlerzähler und **Log löschen**; nur Fehlerzeilen und der Zaehler werden rot hervorgehoben, nicht der gesamte Logtext.
- Einstellungen stehen auf einer scrollenden Seite mit **General**, **Transcription**, **Azure** und **Proxy**. **Save** persistiert den Draft; der Footer zeigt auch den Konfigurationspfad, **Test connection** und das letzte Testergebnis. Native Abnahme und Details: [T-403](./specs/T-403-settings-dialog-mit-verbindung-testen-button.md).
- Die Startseite trennt **Record a meeting** und **Transcribe audio files**. Quellenschalter und Geraeteauswahl stehen unter **Audio devices**; Live-Modelloptionen stehen getrennt von den Dateioptionen. Aenderungen werden sofort seriell gespeichert. **Home** kehrt aus dem abgeschlossenen Transkript zur Startseite zurueck, ohne Text zu loeschen. Siehe [T-525](./specs/T-525-batch-transkription-und-lokale-aufnahme.md).
- Nach einem Sidecar-Crash kann der Nutzer mit **Start** eine neue Sitzung beginnen, ohne die App neu zu starten. Kein automatischer Reconnect; das alte Transkript bleibt bis zum manuellen Start erhalten. Veraltete Prozess-Events/Timeouts werden ignoriert und absichtliches Stoppen meldet keinen Crash.
- **Transcription** im Settings-Dialog enthaelt Auto-Start, Auto-Stop und den automatischen Markdown-Export mit optionalem Pfad und nativem Ordner-Picker. Leer bedeutet Anwendungsverzeichnis. Die Fensteroptionen stehen unter **General**.
- Die initiale Fenstergroesse ist 950 x 650 logische Pixel; das Fenster bleibt skalierbar.
- Fehlt eine benoetigte Azure-Konfiguration, koennen die Einstellungen beim Start automatisch erscheinen. Die lokale Pflichtfeldpruefung verifiziert keinen Azure-Key. Lokale WAV-Aufnahme erfordert keine Azure-Konfiguration.
- Separater Diagnose-Dialog mit Transportstatus und vollständiger Schritttabelle nach Abschluss. Schließen kehrt zu Einstellungen zurück, ohne einen laufenden Test abzubrechen; Ergebnisse können wieder geöffnet werden.
- F12 öffnet/schließt DevTools auch im Release-/Portable-Build.
- Das auf Nutzerwunsch übernommene Console-Design ersetzt die ursprüngliche 1:1-Darstellung; Backend, IPC, Konfiguration und Diagnose verwenden weiterhin die bestehende Implementierung (siehe [DECISIONS.md](./DECISIONS.md), Fortschreibung AD-004 und [T-403](./specs/T-403-settings-dialog-mit-verbindung-testen-button.md)).

## 6. Konfiguration
- Azure-Konfiguration und Benutzeroptionen liegen gemeinsam in **einer** Datei `MeetingNotes.config.json` (Abschnitte `azure` und `user`): im Release direkt neben der EXE, in Entwicklung im Repository-Root. Unabhängig vom Start-Arbeitsverzeichnis, ohne AppData-Migration/-Fallback.
- Azure-Key bleibt direkt im Feld `azure.speechKey`; Azure-/Proxy-Werte sind im Settings-Dialog editierbar. `AppConfigState` liefert `exists`, `path` und optional `config`.
- `user.diarization` ist seit v0.1.9 ein gemeinsamer Boolean (Default `true`); die alte Objektform wird per ODER migriert. `user.transcript.markdownExport` behaelt `enabled` (Default `true`) und den optionalen `path` (Default `null`). Siehe [T-103](./specs/T-103-konfiguration-azure-und-user-settings.md).
- Optionaler HTTP-CONNECT-Proxy über `proxy.host`, `proxy.port` (1–65535), optional `username`/`password`. Host ohne Schema/Pfad. Rust lädt die Dateien und reicht Einstellungen an HTTPS-Diagnose und Sidecar weiter; der Sidecar lädt sie nicht selbst.
- Sidecar erhält Speech-Key/Proxy-Zugangsdaten über prozesslokale Umgebungsvariablen, nicht Credential-CLI-Argumente. Host/Port/Endpoint/Region/Sprache sind nicht geheime CLI-Args.
- `azure.model` waehlt Azure Standard oder MAI Preview. `user.transcription.provider` erlaubt alternative Live-Provider; `user.transcription.audioMode` waehlt fuer Standard Dual Mono oder Stereo. `user.fileTranscription` und `azure.batchEndpoint` konfigurieren den Dateipfad unabhaengig von Live-Optionen. Details: [T-521](./specs/T-521-mai-transcribe-mehrkanal-sidecar.md), [T-523](./specs/T-523-native-windows-stt-provider.md) und [T-525](./specs/T-525-batch-transkription-und-lokale-aufnahme.md).
- **Test connection** nutzt gespeicherte Live-Modelloptionen mit ungespeicherten Azure-/Proxy-Werten. Standard prueft HTTPS in Rust und native Speech/WSS im separaten Sidecar; MAI prueft nur Speech/WSS. Beide SDK-Diagnosen verwenden Stille statt Audio-Capture.
- HTTPS nutzt expliziten Proxy mit optionaler Basic-Authentifizierung, ansonsten `.no_proxy()`; kein öffentlicher DNS-Fallback. DNS/TCP prüfen den Proxy, sonst den Endpoint mit dessen Port oder 443. HTTPS-HEAD folgt keinen Redirects.
- **HTTPS-Diagnose und native Windows-Speech-SDK-Prüfung validieren TLS-Zertifikate beide gegen den System-Vertrauensspeicher.** Kein offiziell dokumentierter .NET-Bypass für Speech SDK 1.53 gefunden; für die HTTPS-Probe gibt es keinen Bypass. Bei TLS-Inspection muss das Firmen-Root-CA im Vertrauensspeicher hinterlegt sein.
- `httpsReachable` bedeutet HTTP-Antwort auch bei 401/403 (fuer MAI nicht geprueft). `speechReachable` verlangt `Connected` und `SessionStarted` fuer den tatsaechlich verwendeten Recognizer-Typ. `reachable` verlangt alle fuer das Modell vorgesehenen Transporte. HTTPS-Schritte: `2xx` = Erfolg, `401`/`403` = Warnung, `407` = Fehler, sonst Warnung.
- Diagnoseprozess: 45 s Grenze; DNS/TCP/HTTPS jeweils 5 s Timeout, keine garantierte 45-s-Obergrenze des vollständigen UI-Aufrufs. Native Proben können Azure-Kosten verursachen.
- Ergebnis wird zurückgegeben und als `transcript:connectivity-result` emittiert; UI nutzt Return-Wert. Separater Dialog zeigt alle Status/Details erst nach Abschluss, einschließlich Validierungs-/IPC-Fehlern, nicht live gestreamte Einzelsteps. Siehe [T-304](./specs/T-304-connectivity-diagnose-in-rust.md).

## 6.1 Audioformat fuer Azure-Ingest und WAV-Aufnahme
- Sidecar resampelt Mic- und Speaker-Frames auf ein einheitliches Zielformat:
  - 16 kHz
  - 16-bit PCM
  - mono
- Ziel: kompatibler, stabiler Ingest-Pfad für Azure Speech bei heterogenen Geräteformaten.
- Standard-Stereo fuehrt zwei Kanaele in einem Stream; lokale WAV-Aufnahme speichert jede aktivierte Quelle als eigene Monospur.

## 6.2 Audio-Transport
- Der Azure-Live-Pfad gibt resampelte Frames im C#-Sidecar an den SDK-Push-Stream weiter.
- **Keine Named-Pipe-Frames mehr für Audio** (verglichen mit der Electron-Variante).
- 5-Sekunden-Durchsatz-Log pro Source (`pushFrame-Statistik`) bleibt erhalten, damit Ingestion-Regressionen sichtbar werden.

## 6.3 IPC: Sidecar ↔ Tauri-Main
- **Transport:** `stdin/stdout` über `tauri-plugin-shell` (`Command::new_sidecar`). Named Pipe entfällt komplett (siehe `DECISIONS.md → AD-008`).
- **Protokoll:** JSON-Lines (ein JSON-Objekt pro Zeile, Newline-getrennt, UTF-8).
- **Richtung Sidecar → App:** **stdout** — Status, Events (transcript:partial, transcript:final, status:started, status:stopped, error, debug).
- **Richtung App → Sidecar:** **stdin** — Commands (start/stop), Settings-Updates, Shutdown.
- **Sidecar-interne Diagnose:** **stderr** (optional für Debug, von Tauri getrennt erfasst).
- **Versionierung:** `protocol_version` im ersten Handshake-Objekt auf stdout (siehe `specs/T-201`).

## 6.4 Bekannte Netzwerk-Einschränkungen
- Proxy-Probleme mit dem nativen Node-Speech-Pfad sind aus der Electron-Referenz übernommen. Im C#-Pfad treten sie **nicht** auf: `SpeechConfig.SetProxy()` funktioniert nativ, am 2026-11-12 im Firmennetz erfolgreich bestätigt (HTTPS **und** native Speech/WSS).
- HTTPS-Erreichbarkeit beweist weder gültige Azure-Zugangsdaten noch native Speech/WSS-Funktion. Bei TLS-Inspection können Unternehmens-Root-CA und Allowlisting erforderlich sein — die HTTPS-Diagnose prüft das Zertifikat inzwischen aktiv, ein TLS-inspektierender Proxy ohne vertrauenswürdiges Root-CA fällt dort durch.
- Die Corporate-Netzvalidierung ist abgeschlossen (2026-11-12, siehe [T-306](./specs/T-306-proxy-aware-azure-transport.md) und [T-505](./specs/T-505-proxy-aware-azure-transport.md)). Ein eigener WSS-Client ist nicht implementiert und nicht mehr erforderlich.

## 7. Export
- Automatischer Dateiexport als Markdown mit YAML-Frontmatter (siehe [T-506](./specs/T-506-transkript-markdown-export-und-frontmatter.md)); kein Export in weitere Formate.
- Vollständiges Transkript per Copy-to-Clipboard als Markdown — identisch zur automatisch gespeicherten Datei.
- **Markdown exportieren** im Drei-Punkte-Menü speichert manuell über denselben Backend-Pfad und Builder wie der automatische Export; Fehler erscheinen als Toast.
- Exportinhalt: YAML-Frontmatter (`title`, `date`, `start`, `end`, `duration`, `language`, `segments`, `speakers`) plus finale Segmentliste mit Sprecher/Uhrzeit/Text. Sprecherlabels berücksichtigen quellenspezifische UI-Aliase; ohne Alias wird die Quelle mit ausgegeben, z. B. `Mic · Guest-1`.
- Der Zielpfad des Datei-Exports ist optional; ohne Angabe landet die Datei im Anwendungsverzeichnis, relative Pfade werden dort aufgeloest.

## 8. Entwicklungsumgebung (Stabilitätsvorgabe)
- Node.js `>=22.12.0 <27` gemaess [package.json](./package.json).
- Rust-Toolchain (stable, Edition 2021).
- .NET 10 SDK (für Sidecar-Build) lokal.
- Tauri-CLI (2.x) als devDependency.
- Native Entwicklung: `npm run tauri -- dev`; `npm run dev` startet nur Vite/Renderer. Build-/Test-Kommandos siehe [README.md](./README.md).

## 8.1 Sidecar-Deployment (Runtime-Anforderung)
- Lokale Entwicklung/Build: .NET 10 SDK erforderlich, um das Sidecar zu veröffentlichen.
- Zielsystem: keine .NET-Runtime oder SDK erforderlich; die .NET-10-Runtime ist im komprimierten, getrimmten Single-File-Sidecar enthalten. Native Bibliotheken werden beim Start extrahiert. Sidecar-/Speech-SDK-Metadaten bleiben fuer Reflection erhalten; Trim-Warnungen bleiben sichtbar. Nur `net10.0-windows` wird gebaut — siehe [T-512](./specs/T-512-sidecar-targetframeworks-und-single-file.md).
- Build-/Start-Flow:
  - Dev: `build.rs` publiziert Sidecar automatisch, danach Start durch Tauri.
  - Portable: `npm run tauri -- build --no-bundle`, nach Erfolg `npm run dist:portable` und `npm run test:smoke`; gesamter Ordner erforderlich, nicht nur Haupt-EXE.

## 9. Nicht-Ziele
- Code-Signing
- Plattformübergreifende Unterstützung (macOS/Linux) — siehe `DECISIONS.md → AD-005`
- Bluetooth-Audio-Support
- Mobile (iOS/Android)
- Kein Export in weitere Formate (JSON, DOCX, TXT)
- Produktionsreife Betriebs-/Monitoring-Features

### Release-Pipeline (T-515)

Jede Veroeffentlichung laeuft ueber GitHub Actions. Normale Branch-Pushes und Pull Requests starten keinen Build:

- **Release** baut bei `v*`-Tag-Push oder manuellem Start das angegebene Tag. Typecheck, Node-Tests, Smoke und Deployment-Pruefung laufen vor der Veroeffentlichung von `MeetingNotes-v<version>-win-x64.zip` und `SHA256SUMS.txt`.
- Spec-Konsistenz, Rust-Tests und C#-Sidecar-Validierung laufen separat lokal.

Details: [T-515](./specs/T-515-github-actions-pipeline-und-release.md).

## 10. Historischer MVP-Rollout

Die MVPs des Electron-Projekts bleiben die funktionale Grundlage; umgesetzt wird ausschließlich in dieser Tauri-Variante, die Electron-Referenz bleibt unverändert. Aktuelle Teilabnahme siehe [T-500](./specs/T-500-qualitaetssicherung-und-akzeptanztests.md):

### MVP 1 (Tauri)
- Tauri-2-Anwendung startet lokal mit React-Renderer.
- Tauri-IPC-Bridge (`invoke`/`listen`) steht und ist in Main/Renderer verdrahtet.
- Sidecar-Spawn funktioniert (Stub-Sidecar reicht für Smoke-Test).
- React-UI rendert mit Stub-Events.
- Manuelle Zwischenprüfungen.

### MVP 2 (Tauri)
- Sidecar mit Audio-Capture (NAudio, WASAPI Mic + Loopback) anbinden.
- Azure Speech SDK NuGet im Sidecar integrieren.
- Pipeline A (Mic) und Pipeline B (Speaker) laufen mit unabhängig gewähltem Recognizer-Typ (`ConversationTranscriber` bei aktivierter Diarization, sonst `SpeechRecognizer`).
- JSON-Lines-Events fließen vom Sidecar durch den Tauri-Main in den Renderer.
- Loopback-Blocker-Regel mit finalen Fehlercodes.
- UI/Export auf reale Daten und finale Fehlerpfade gehärtet.

### MVP 3 (Tauri)
- Audio-Transport-Härtungen (1:1 aus `meeting-notes` Audit-Block).
- **Verbindung testen**-Button + Diagnose-Modul.
- Proxy-Workaround (T-505): **nicht erforderlich** — die native Proxy-Unterstützung funktioniert (2026-11-12 bestätigt).

## 11. Offene Entscheidungen und Akzeptanz
1. [T-505](./specs/T-505-proxy-aware-azure-transport.md): abgeschlossen — der Firmenproxy-/C#-WSS-Test war am 2026-11-12 erfolgreich, ein Workaround entfällt.
2. Statistischen Latenzreport und P95 fuer Azure Speech nachweisen ([T-502](./specs/T-502-latency-messung.md)); die manuelle Clean-Machine-Abnahme deckt keine experimentellen Sprachmodelle ab ([T-524](./specs/T-524-native-windows-stt-machbarkeit.md)).
3. Historisch offene Sidecar-Benennung: aktuell `MeetingNotes.Sidecar.exe`; keine Umbenennung in den heutigen Änderungen.

Bereits festgelegt: stdin/stdout statt Named Pipe, Windows-only, ausschliesslich Portable als Lieferweg.

## 12. Querverweise
- Aktueller Projektstatus: [README.md](./README.md)
- Agenten-Einstieg und Arbeitsregeln: [AGENTS.md](./AGENTS.md)
- Architekturentscheidungen: [DECISIONS.md](./DECISIONS.md)
- Tasks und Akzeptanzstatus: [Spec-Index](#spec-index)
- Quell-Projekt (Electron): `../meeting-notes/` (unveränderte Referenz)

## Spec-Index

Die einzelnen Specs enthalten Anforderungen, aktuellen Implementierungsstand,
Testbelege, offene Abnahmen und ihre Aenderungshistorie. Abhaengigkeiten und
fachliche Zusammenhaenge werden direkt zwischen den Specs verlinkt. Die
generierte Uebersicht im Abschnitt **Stand der Specs** fasst offene Punkte zusammen.

### Grundlagen und historische Migration
- [T-100: Rahmen und Migrationshintergrund](./specs/T-100-tauri-migration-planen-und-grundstruktu.md)
- [T-101: Tauri-Scaffold mit React und Vite](./specs/T-101-tauri-2-scaffold-mit-react-und-vite.md)
- [T-102: Renderer-/Rust-IPC-Vertrag](./specs/T-102-ipc-vertrag-zwischen-renderer-und-rust.md)
- [T-103: Azure- und Benutzerkonfiguration](./specs/T-103-konfiguration-azure-und-user-settings.md)
- [T-104: Historisches Modul-Mapping](./specs/T-104-migrationsplan-was-bleibt-was-wandert.md)

### Audio, Speech und Sidecar
- [T-200: Sidecar-Architektur](./specs/T-200-c-sharp-sidecar-architektur-audio-und-azure.md)
- [T-201: JSON-Lines-Protokoll](./specs/T-201-json-lines-protokoll-tauri-zu-sidecar.md)
- [T-202: WASAPI-Audio-Capture](./specs/T-202-audio-capture-mit-naudio-wasapi.md)
- [T-203: Resampling auf 16-kHz-Mono-PCM](./specs/T-203-audio-resampling-16khz-mono-pcm.md)
- [T-204: Azure Speech SDK](./specs/T-204-azure-speech-sdk-integration-im-sidecar.md)
- [T-205: Continuous LID und Diarization](./specs/T-205-continuous-lid-und-diarization-in-c-sharp.md)
- [T-206: Azure-Start mit Rollback](./specs/T-206-azure-start-pfad-mit-rollback.md)
- [T-207: Sidecar-Deployment](./specs/T-207-sidecar-deployment-framework-dependent-exe.md)
- [T-509: WasapiRecorderBuilder](./specs/T-509-audio-capture-auf-wasapirecorderbuilder-umstellen.md)
- [T-511: Transkriptionsquellen](./specs/T-511-transkriptions-quellen-auswaehlen.md)
- [T-512: Target-Framework und Single-File-Sidecar](./specs/T-512-sidecar-targetframeworks-und-single-file.md)
- [T-517: Echo cancellation (Alpha) – Opt-in und Einstellungen](./specs/T-517-echo-cancellation-alpha.md)
- [T-518: Echo cancellation – lokale Audio-Pipeline](./specs/T-518-echo-cancellation-audio-pipeline.md)
- [T-520: MAI-Transcribe-2-Streaming – optionales Feature](./specs/T-520-mai-transcribe-streaming-feature.md)
- [T-521: MAI-Transcribe-2-Streaming – Mehrkanal im Sidecar](./specs/T-521-mai-transcribe-mehrkanal-sidecar.md)
- [T-522: MAI-Transcribe-2-Streaming – Machbarkeit, Kosten und Abnahme](./specs/T-522-mai-transcribe-machbarkeit-kosten-abnahme.md)
- [T-523: Windows SAPI und Web Speech API als STT-Modelle](./specs/T-523-native-windows-stt-provider.md)
- [T-524: Windows-Spracherkennung ohne Azure-Zugangsdaten - API-Auswahl und Abnahme](./specs/T-524-native-windows-stt-machbarkeit.md)

### Orchestrierung und Persistenz
- [T-300: Tauri-Main](./specs/T-300-tauri-main-als-orchestrator.md)
- [T-301: Sidecar-Spawn](./specs/T-301-sidecar-spawn-via-shell-plugin.md)
- [T-302: Commands](./specs/T-302-tauri-commands.md)
- [T-303: Events](./specs/T-303-tauri-events.md)
- [T-304: Verbindungsdiagnose](./specs/T-304-connectivity-diagnose-in-rust.md)
- [T-305: Settings-Persistenz](./specs/T-305-settings-persistenz-im-tauri-main.md)
- [T-306: Nativer Proxy-Transport](./specs/T-306-proxy-aware-azure-transport.md)
- [T-505: Proxy-Abnahme und historische Alternativen](./specs/T-505-proxy-aware-azure-transport.md)
- [T-513: Meeting-Erkennung, Auto-Start und Auto-Stop](./specs/T-513-automatische-meeting-erkennung-und-auto-start.md)
- [T-514: Systray und Schliessen](./specs/T-514-systray-und-schliessen-verhalten.md)

### Oberflaeche und Transkripte
- [T-400: Frontend-Portierung](./specs/T-400-react-frontend-auf-tauri-portieren.md)
- [T-401: Preload-Bridge](./specs/T-401-tauri-preload-bridge.md)
- [T-402: UI-Komponenten](./specs/T-402-ui-komponenten-portieren.md)
- [T-403: Einstellungen und Verbindungstest](./specs/T-403-settings-dialog-mit-verbindung-testen-button.md)
- [T-404: Sprecherzuordnung, Auto-Scroll und Fokus](./specs/T-404-speaker-mapping-auto-scroll-focus-trap.md)
- [T-506: Markdown-Export](./specs/T-506-transkript-markdown-export-und-frontmatter.md)
- [T-507: Pause, Stop und Sitzungsidentitaet](./specs/T-507-pause-stop-und-sitzungsgebundene-sprecherzuordnung.md)

### Qualitaet, Build und Release
- [T-500: Qualitaetssicherung und Akzeptanz](./specs/T-500-qualitaetssicherung-und-akzeptanztests.md)
- [T-501: Smoke-Test](./specs/T-501-smoke-test-tauri-und-sidecar.md)
- [T-502: Latenzmessung](./specs/T-502-latency-messung.md)
- [T-503: Build-Skripte und Distribution](./specs/T-503-distribution-und-build-skripte.md)
- [T-504: Portable-Build](./specs/T-504-portable-build.md)
- [T-508: Abhaengigkeiten und Laufzeit](./specs/T-508-abhaengigkeiten-laufzeit-und-referenzen-aktualisieren.md)
- [T-510: Clean-Machine-Deployment](./specs/T-510-clean-machine-deployment-windows-11.md)
- [T-515: GitHub-Actions und Release](./specs/T-515-github-actions-pipeline-und-release.md)
- [T-519: Echo cancellation (Alpha) – Hardware-Abnahme](./specs/T-519-echo-cancellation-alpha-abnahme.md)