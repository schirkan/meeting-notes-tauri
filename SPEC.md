# Spezifikation v0.1 — Meeting Notes

Stand: 18.11.2026
Status: Implementierungsstand fortgeschrieben; Corporate-Netz-/Proxy-Akzeptanz am 2026-11-12 erfolgreich. Offen bleiben Latenz- und Clean-Machine-Akzeptanz.

Lokaler Stand: Release **v0.1.1**; Portable-Build **30,74 MB** (4 Dateien, 3 geprüfte Hashes; Rebuild vom 2026-11-18 - flaches Layout mit `MeetingNotes.exe` und **self-contained** Single-File-Sidecar, `ProductVersion` 0.1.1) mit der EXE `MeetingNotes.exe`, dem gemeinsamen Config-Template, der unabhängigen Mic-/Speaker-Diarization und der auswählbaren Transkriptions-Quelle (`user.transcription`, Mic/Speaker/beides); `npm run verify -- --full` (**9 Schritte grün**), Build-Smoke inklusive Sidecar-Geräteabfrage und Deployment-Nachweis (**PASS 9 / FAIL 0**) erfolgreich. Dafür sind TypeScript, **85 Node-Tests**, **35 Rust-Tests** und **508 C#-Assertions** (davon **521** gegen die publizierte, getrimmte Sidecar-EXE) erfolgreich; die Node-/UI-Tests laufen im CLI-Browserlauf grün. Nicht jede ursprüngliche Audio-/Protokoll-Anforderung ist als abgenommen bestätigt; Einzelstatus siehe [Specs](./specs/).

Diese Spezifikation ist die **Windows-Variante** von `../meeting-notes/SPEC-v0.1.md` (Electron-Projekt, unveränderte Referenz). Architekturziel: Tauri 2 + React + C#-Sidecar (mit Azure Speech SDK in NuGet-Form). Die Anwendung selbst heißt *Meeting Notes*; „Tauri" ist die Container-Technik, nicht Teil des Produktnamens.

---

## Stand der Specs (Abgleich 18.11.2026)

Die Checkboxen wurden gegen den **Code** geprueft, nicht gegen den Spec-Status:
jeder abgehakte Punkt traegt den Beleg im Klartext (`Beleg: …`), jeder offene
Punkt nennt den konkreten Grund (`- **offen**: …`). Ergebnis: **37 Specs** als
`umgesetzt` bzw. `teils umgesetzt` markiert, **26 offene Punkte in 14 Specs**.
Vorher waren ueber 70 Checkboxen offen, obwohl die Funktion ueberwiegend fertig
und verifiziert war - die Specs sind jetzt mit dem Stand der Implementierung
deckungsgleich.

_Dieser Abschnitt wird von `npm run docs:specs` aus den Spec-Dateien erzeugt._

### Offen und braucht deinen Rechner (11 Punkte)

| Spec | Punkt |
|---|---|
| T-205 | Diarization funktioniert für mindestens 2 Sprecher je aktivierter Quelle (manueller Live-Azure… |
| T-500 | Latency-Messung dokumentiert < 5 s End-to-End (T-502) |
| T-500 | Erfolgreiche Aufnahme und End-to-End-Latenz (< 5 s) mit echten Zugangsdaten — weiterhin offen… |
| T-500 | Aktueller Portable-Build auf sauberem Windows-11-Zielsystem geprüft. |
| T-502 | Report `context/latency-report.md` mit P50/P95/P99 über 100 Audio-Chunks - **offen**: |
| T-502 | Ziel: P95 < 5 s End-to-End |
| T-504 | Portable Build auf einem **frischen** Windows-11-System ohne .NET-Installation mit WebView2 va… |
| T-509 | Das Loopback-Verhalten ist unveraendert: Events nur waehrend tatsaechlicher |
| T-509 | Latenz und Ausgabequalitaet sind auf echter Hardware gegen die |
| T-510 | Auf dem **Zielsystem** ausgefuehrt: Fenster oeffnet, Einstellungen automatisch |
| T-510 | Befunde sind in `T-504`, `T-500`, `SPEC.md` und `AGENTS.md` nachgezogen. |

### Offen als bewusste Entscheidung (15 Punkte)

| Spec | Punkt | Warum offen |
|---|---|---|
| T-101 | `npm run tauri build` produziert eine MSI- oder NSIS-Installer-Datei. | Installer (MSI/NSIS) wurden bewusst nicht gebaut; der Lieferweg ist die Portable-Distribution (siehe README). |
| T-201 | **Reconnects:** Tauri startet den Sidecar bei Crash automatisch neu (… | bewusst nicht umgesetzt - ein Neustart des Sidecars erzeugt eine **neue Azure-Sitzung**, damit brechen die Sprecher-IDs (T-507).… |
| T-203 | Smoke-Test: 48-kHz-Stereo-Input führt zu korrektem 16-kHz-Mono-Output… | Der Stichprobentest ist implementiert (`ResamplingValidation`: 48-kHz-Stereo-Ton → 16-kHz-Mono, Länge, Pegel, Übersteuerung, Drop… |
| T-400 | Visuelles Verhalten ist identisch zur Electron-Variante. | Bewusst nicht 1:1: die Darstellung folgt auf Nutzerwunsch dem Console-Design statt der urspruenglichen Portierung (siehe T-402).… |
| T-401 | Mock-Implementierung für Unit-Tests (siehe T-500) | Die Unit-Tests laufen gegen die echte App (Playwright-CLI-Browserlauf), nicht gegen einen Mock. |
| T-501 | Voller End-to-End-Test mit WebDriver + App-Start + `start_recording()… | WebDriver-Setup für Tauri 2 ist aufwendig; die headless Smoke-Stufen 1–5 decken die kritischen Artefakt-Invarianten ab. |
| T-503 | `npm run lint` (sofern konfiguriert) ist grün | kein Lint-Setup im Projekt. |
| T-513 | Der Modus ist standardmäßig **inaktiv** (`enabled: false`) - Auto-Sta… | die Einstellungs-Achse ist noch nicht implementiert; das Spec definiert nur den Zielzustand. |
| T-513 | Ohne vollständige Azure-Konfiguration startet die Aufnahme nicht auto… | setzt die Umsetzung des Auto-Starts voraus. |
| T-513 | Die Erkennung läuft im **Sidecar** (nicht im Tauri-Main) und nimmt da… | `sidecar/MeetingDetector.cs` existiert noch nicht. |
| T-513 | Die Erkennung ist ereignisgesteuert, nicht per Timer. Beleg: `Registe… | folgt der Umsetzung des Beobachters. |
| T-513 | Das Ende nutzt mehrere Signale (Stille, Session-Ende, optional Kalend… | setzt die Umsetzung des Beobachters voraus. |
| T-513 | Jede automatisch gestartete Aufnahme ist für den Nutzer sichtbar und… | die UI ist noch nicht vorhanden. |
| T-513 | Verifikation: Node-Tests, Rust-Tests und C#-Validierung grün. Beleg:… | erst nach der Umsetzung sinnvoll prüfbar. |
| T-513 | Live-Abnahme: ein echtes Meeting (Teams oder Zoom) startet die Aufnah… | braucht einen echten Rechner mit Teams oder Zoom und einen Podcast-Playback als Gegenprobe. |

### Nächste Schritte auf deinem Rechner (die 11 offenen Punkte)

Alles hier ist auf dieser Maschine nicht ausführbar (0 Audioeingänge, 0
Ausgänge, keine Azure-Credentials, keine interaktive Sitzung). Auf deinem
Rechner sind es sechs Schritte:

**1. Latenz messen (T-502, T-500)** — das Werkzeug liegt vor:

```powershell
npm run measure:latency -- --live
```

Die App startet selbst, du startest die Aufnahme im Fenster, das Skript
sammelt bis zu 100 Messzeilen und schreibt `context/latency-report.md`
(P50/P95/P99 je Stufe, Ziel P95 < 5 s). Ohne Messung läuft stattdessen
`npm run measure:latency -- --selftest` — das prüft nur die Statistik.

**2. Diarization mit zwei Sprechern (T-205)** — App starten, Konfiguration
eintragen, Aufnahme starten, zwei Personen nacheinander sprechen lassen. Im
Transkript müssen `Guest-1` und `Guest-2` getrennt auftauchen; die
Session-ID steht in `SPEC.md` unter T-507 als Grundlage.

**3. Loopback-Verhalten und Ausgabequalität (T-509)** — während einer
Aufnahme etwas abspielen: Es dürfen **nur** dann Speaker-Events ankommen,
wenn tatsächlich Audio aus dem Ausgabegerät läuft. Mic und Speaker
getrennt prüfen (`user.transcription.mic` / `.speaker`).

**4. Resampler-Stichprobe (T-203)** — in einer **interaktiven** Sitzung:

```powershell
npm run test:sidecar
```

Der Test läuft nur, wo MediaFoundation antwortet; hier steht `SKIPPED`.
Auf deinem Rechner prüft er 48-kHz-Stereo → 16-kHz-Mono inklusive Länge,
Pegel, Übersteuerung und Dropouts.

**5. Deployment auf einem frischen Windows 11 (T-504, T-510)** — Ordner
`dist/portable` kopieren, WebView2 sicherstellen (keine .NET-Installation noetig), dann:

```powershell
powershell -ExecutionPolicy Bypass -File .\verify-deployment.ps1 -PortableDir D:\Apps\MeetingNotes -LaunchApp
```

Das Skript prüft Windows-Build, WebView2, .NET-Runtime, alle SHA256-Summen,
das Fehlen einer persönlichen Config, den Sidecar und die PE-Subsysteme.

**6. Pause über Azure (T-507)** — Aufnahme starten, sprechen, pausieren,
weiter sprechen, stoppen. Die Sprecher-IDs müssen **über die Pause hinweg**
stabil bleiben (das ist der eigentliche Zweck der Pause-Semantik).

## 1. Ziel

Ein portabler, unsignierter Desktop-PoC, der parallel Mikrofon und primären Speaker-Output erfasst, per Azure Speech transkribiert und Transkripte in einer React-UI anzeigt — bei deutlich kleinerer Bundle-Größe als die Electron-Variante.

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
- Loopback ist Pflichtanforderung.
- Wenn Loopback nicht verfügbar/fehlerhaft ist: Aufnahme wird blockiert (kein Mic-only-Fallback).
- Audio-Frames werden im C#-Sidecar direkt an die Azure-Speech-PushStream übergeben — **keine Audio-Frames über Prozessgrenzen hinweg**.

## 3.1 Technische Architektur

- **App-Container:** Tauri 2 (Rust). Verantwortlich für Fenster/WebView2-Lifecycle, Sidecar-Spawn, Settings-Persistenz, UI-Bridge.
- **Backend:** C#/.NET 10 als Sidecar (`MeetingNotes.Sidecar.exe`, self-contained, komprimiert und konservativ getrimmt). Verantwortlich für Audio-Capture, Audio-Resampling, Azure-Speech-Transkription, Speaker-Diarization und Event-Streaming.
- **Frontend:** React 19 + TypeScript 6 + Vite 8 (im Tauri-Renderer-WebView2).
- **IPC Sidecar ↔ App:** `stdin/stdout` über `tauri-plugin-shell` mit JSON-Lines (siehe `DECISIONS.md → AD-008`). Named Pipe entfällt.
- **IPC App ↔ Renderer:** Tauri-`invoke()` für Commands + Tauri-`listen()` für Events (typed JSON).
- **Distribution:** Gesamter Portable-Ordner. Die Sidecar-EXE buendelt die .NET-Runtime sowie verwaltete/native Abhaengigkeiten und liegt neben der Haupt-EXE. Zielsystem braucht WebView2, aber keine installierte .NET-Runtime. Aktuell 30,67 MiB / 4 Dateien; keine Installer erzeugt.

## 4. Transkription
- API: Azure Speech
- Mehrsprecher-Differenzierung (Diarization): Nice-to-have (Best Effort)
- Recognizer-Strategie ist pro Quelle unabhängig konfigurierbar:
  - `diarization.mic` und `diarization.speaker`: aktiviert → `ConversationTranscriber`; deaktiviert → `SpeechRecognizer`.
  - Beide Optionen sind standardmäßig `true`, auch bei alten oder teilweise ergänzten Konfigurationen; explizites `false` bleibt erhalten.
  - Aktiviert: SDK-Speaker-IDs in Interim-/Final-Segmenten, mit `unknown` bei noch fehlender ID. Deaktiviert: feste IDs `self` (Mic) bzw. `guest` (Speaker).
  - Reale Mehrsprecherqualität und Continuous-LID-Verhalten bleiben getrennte Akzeptanztests; siehe [T-205](./specs/T-205-continuous-lid-und-diarization-in-c-sharp.md).
- Azure vergibt die Sprecher-IDs pro Sitzung neu. Jedes Transkript-Segment fuehrt deshalb die Session-ID mit (`sessionId`). Das UI leitet daraus die sessionsichere Sprecheridentitaet `<sessionId>|<source>:<speaker>` ab: Alias-Zuordnung und das Zusammenfuehren von Segmenten ueberschreiten die Sitzungsgrenze nie. Siehe [T-507](./specs/T-507-pause-stop-und-sitzungsgebundene-sprecherzuordnung.md).
- Continuous Language Identification (LID) aktiviert (entspricht `meeting-notes`).
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
- Einstellungen haben drei Tabs: **Allgemein**, **Azure-Konfiguration**, **Proxy**. Die Dialogposition und -größe bleiben beim Wechsel gleich; Inhalte scrollen intern. Der Footer enthält den einzigen **Speichern**-Button und den tatsächlichen Backend-Pfad der gemeinsamen Konfigurationsdatei. Erfolgreiches Speichern schliesst den Dialog; bei Fehlern bleibt er mit Fehlermeldung offen. Tabs unterstützen Pfeiltasten, Home und End; Escape und Focus-Trap bleiben erhalten.
- Bei leerem Transkript und gestoppter Aufnahme zeigt der Hauptbereich nur Sprache und Audioeinstellungen ohne Anwendungshinweis oder Speichern-Button. Aenderungen werden sofort seriell gespeichert; Azure-/Proxy-Drafts bleiben davon unberuehrt. Start wartet auf erfolgreiche Persistenz. Mikrofon und Speaker-Loopback stehen untereinander; pro Zeile steht die Transkriptions-Checkbox links vor dem Geraet und die Sprechererkennung rechts daneben. **Löschen** im Header ist während Aufnahme, Pause und Start deaktiviert und auch im Handler gesperrt.
- Nach einem Sidecar-Crash kann der Nutzer mit **Start** eine neue Sitzung beginnen, ohne die App neu zu starten. Kein automatischer Reconnect; das alte Transkript bleibt bis zum manuellen Start erhalten. Veraltete Prozess-Events/Timeouts werden ignoriert und absichtliches Stoppen meldet keinen Crash.
- Nutzer kann Sprache/Devices sowie Azure-Konfiguration und Proxy bearbeiten. Proxy wird gemeinsam mit Azure gespeichert; **Verbindung testen** und laufende/letzte Ergebnisse öffnen liegen im Azure-Bereich.
- Spracheinstellung und unabhängige Sprechererkennung für Mic/Speaker werden über Neustarts hinweg persistiert. Beide Diarization-Checkboxen stehen bei den jeweiligen Geräten im Bereich **Allgemein** und sind während der Aufnahme deaktiviert. Gespeicherte Änderungen gelten für die nächste Aufnahme.
- Im Bereich **Allgemein** stehen außerdem **Transkript automatisch als Markdown speichern** (standardmäßig aktiv) und das optionale Feld **Speicherpfad** mit nativem Ordner-Picker. Manuelle Eingabe bleibt moeglich; Abbrechen der Ordnerauswahl veraendert den Pfad nicht. Leer bedeutet Anwendungsverzeichnis.
- Die initiale Fenstergroesse ist 950 x 650 logische Pixel; das Fenster bleibt skalierbar.
- Bei fehlender, nicht lesbarer oder unvollständiger Azure-Konfiguration öffnen sich Einstellungen beim Start automatisch; schließbarer Bottom-Toast ohne Verschiebung des Hauptinhalts. Das ist lokale Pflichtfeldprüfung, keine Azure-Key-Verifikation.
- Separater Diagnose-Dialog mit Transportstatus und vollständiger Schritttabelle nach Abschluss. Schließen kehrt zu Einstellungen zurück, ohne einen laufenden Test abzubrechen; Ergebnisse können wieder geöffnet werden.
- F12 öffnet/schließt DevTools auch im Release-/Portable-Build.
- Das auf Nutzerwunsch übernommene Console-Design ersetzt die ursprüngliche 1:1-Darstellung; Backend, IPC, Konfiguration und Diagnose verwenden weiterhin die bestehende Implementierung (siehe [DECISIONS.md](./DECISIONS.md), Fortschreibung AD-004 und [T-403](./specs/T-403-settings-dialog-mit-verbindung-testen-button.md)).

## 6. Konfiguration
- Azure-Konfiguration und Benutzeroptionen liegen gemeinsam in **einer** Datei `MeetingNotes.config.json` (Abschnitte `azure` und `user`): im Release direkt neben der EXE, in Entwicklung im Repository-Root. Unabhängig vom Start-Arbeitsverzeichnis, ohne AppData-Migration/-Fallback.
- Azure-Key bleibt direkt im Feld `azure.speechKey`; Azure-/Proxy-Werte sind im Settings-Dialog editierbar. `AppConfigState` liefert `exists`, `path` und optional `config`.
- User-Settings enthalten `diarization: { "mic": true, "speaker": true }` sowie `transcript.markdownExport` mit `enabled` (Default `true`) und optionalem `path` (Default `null`). Fehlende Felder werden je Quelle als `true` normalisiert. Rust reicht die gespeicherten Optionen beim Start über `--diarization-mic true|false` und `--diarization-speaker true|false` an den Sidecar weiter.
- Optionaler HTTP-CONNECT-Proxy über `proxy.host`, `proxy.port` (1–65535), optional `username`/`password`. Host ohne Schema/Pfad. Rust lädt die Dateien und reicht Einstellungen an HTTPS-Diagnose und Sidecar weiter; der Sidecar lädt sie nicht selbst.
- Sidecar erhält Speech-Key/Proxy-Zugangsdaten über prozesslokale Umgebungsvariablen, nicht Credential-CLI-Argumente. Host/Port/Endpoint/Region/Sprache sind nicht geheime CLI-Args.
- **Verbindung testen** nutzt aktuelle, auch ungespeicherte Werte und Sitzungssprache. `test_azure_connectivity` führt parallel System-DNS/TCP/HTTPS in Rust und native Speech/WSS-Diagnose in einem separaten Sidecar ohne Audio-Capture aus.
- HTTPS nutzt expliziten Proxy mit optionaler Basic-Authentifizierung, ansonsten `.no_proxy()`; kein öffentlicher DNS-Fallback. DNS/TCP prüfen den Proxy, sonst den Endpoint mit dessen Port oder 443. HTTPS-HEAD folgt keinen Redirects.
- **HTTPS-Diagnose und native Windows-Speech-SDK-Prüfung validieren TLS-Zertifikate beide gegen den System-Vertrauensspeicher.** Kein offiziell dokumentierter .NET-Bypass für Speech SDK 1.53 gefunden; für die HTTPS-Probe gibt es keinen Bypass. Bei TLS-Inspection muss das Firmen-Root-CA im Vertrauensspeicher hinterlegt sein.
- `httpsReachable` bedeutet HTTP-Antwort auch bei 401/403; `speechReachable` verlangt `Connected` und `SessionStarted` für Recognizer **und** Transcriber. `reachable` verlangt beide Transporte. Die Step-Einstufung der HTTPS-Probe: `2xx` = Erfolg, `401`/`403` = Warnung, `407` = Fehler, sonst Warnung.
- Diagnoseprozess: 45 s Grenze; DNS/TCP/HTTPS jeweils 5 s Timeout, keine garantierte 45-s-Obergrenze des vollständigen UI-Aufrufs. Native Proben können Azure-Kosten verursachen.
- Ergebnis wird zurückgegeben und als `transcript:connectivity-result` emittiert; UI nutzt Return-Wert. Separater Dialog zeigt alle Status/Details erst nach Abschluss, einschließlich Validierungs-/IPC-Fehlern, nicht live gestreamte Einzelsteps. Siehe [T-304](./specs/T-304-connectivity-diagnose-in-rust.md).

## 6.1 Audioformat für Azure-Ingest (unverändert)
- Sidecar resampelt Mic- und Speaker-Frames auf ein einheitliches Zielformat:
  - 16 kHz
  - 16-bit PCM
  - mono
- Ziel: kompatibler, stabiler Ingest-Pfad für Azure Speech bei heterogenen Geräteformaten.

## 6.2 Audio-Transport (NEU: im selben Prozess)
- Audio-Frames werden im C#-Sidecar direkt nach Resampling an `PushAudioInputStream.WriteAsync()` der Azure-Speech-SDK übergeben.
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
- Zeitformat: deutsches Datums-/Zeitformat. Der Zielpfad des Datei-Exports ist optional; ohne Angabe landet die Datei im Anwendungsverzeichnis, relative Pfade werden dort aufgelöst.

## 8. Entwicklungsumgebung (Stabilitätsvorgabe)
- Standard für lokale Entwicklung: Node 22 LTS ≥22.12.0; zulässige Versionen gemäß `package.json` (auch ≥24.0.0 <24.16.0).
- Rust-Toolchain (stable, Edition 2021).
- .NET 10 SDK (für Sidecar-Build) lokal.
- Tauri-CLI (2.x) als devDependency.
- Native Entwicklung: `npm run tauri -- dev`; `npm run dev` startet nur Vite/Renderer. Build-/Test-Kommandos siehe [README.md](./README.md).

## 8.1 Sidecar-Deployment (Runtime-Anforderung)
- Lokale Entwicklung/Build: .NET 10 SDK erforderlich, um das Sidecar zu veröffentlichen.
- Zielsystem: keine .NET-Runtime oder SDK erforderlich; die .NET-10-Runtime ist im komprimierten, getrimmten Single-File-Sidecar enthalten. Native Bibliotheken werden beim Start extrahiert. Sidecar-/Speech-SDK-Metadaten bleiben fuer Reflection erhalten; Trim-Warnungen bleiben sichtbar. Nur `net10.0-windows` wird gebaut — siehe [T-512](./specs/T-512-sidecar-targetframeworks-und-single-file.md).
- Build-/Start-Flow:
  - Dev: `build.rs` publiziert Sidecar automatisch, danach Start durch Tauri.
  - Installer: `npm run tauri -- build` bündelt die **self-contained** Sidecar-EXE als externe Resource; separate DLLs werden nicht mehr ausgeliefert.
  - Portable: `npm run tauri -- build --no-bundle`, nach Erfolg `npm run dist:portable` und `npm run test:smoke`; gesamter Ordner erforderlich, nicht nur Haupt-EXE.
  - Lokaler letzter Portable-Build: **30,74 MB / 4 Dateien**, 3 von 3 Hashes geprüft (Rebuild vom 2026-11-18 nach `1f22adc`). Aktuelle MSI/NSIS- und Clean-Machine-Validierung nicht erneut durchgeführt.

## 9. Nicht-Ziele
- Code-Signing
- Plattformübergreifende Unterstützung (macOS/Linux) — siehe `DECISIONS.md → AD-005`
- Bluetooth-Audio-Support
- Mobile (iOS/Android)
- Kein Export in weitere Formate (JSON, DOCX, TXT)
- Produktionsreife Betriebs-/Monitoring-Features

## 10. MVP-Rollout

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
2. Reale Aufnahme/Latenz und Clean-Machine-Deployment sowie aktuelle Installer-Parität prüfen ([T-500](./specs/T-500-qualitaetssicherung-und-akzeptanztests.md)).
3. Historisch offene Sidecar-Benennung: aktuell `MeetingNotes.Sidecar.exe`; keine Umbenennung in den heutigen Änderungen.

Bereits festgelegt: stdin/stdout statt Named Pipe, Windows-only; Installer-Konfiguration NSIS und MSI, daneben Portable-Ordner. Heute nur Portable neu gebaut.

## 12. Querverweise
- Aktueller Projektstatus: [README.md](./README.md)
- Architekturentscheidungen: [DECISIONS.md](./DECISIONS.md)
- Tasks und Akzeptanzstatus: [specs/](./specs/)
- Quell-Projekt (Electron): `../meeting-notes/` (unveränderte Referenz)