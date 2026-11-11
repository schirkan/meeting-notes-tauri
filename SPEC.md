# Spezifikation v0.1 — Meeting Notes

Stand: 09.11.2026
Status: Implementierungsstand fortgeschrieben; reale Azure-/Corporate-Netz-, Latenz- und Clean-Machine-Akzeptanz offen.

Lokaler Stand: aktueller Portable-Build 20.79 MB (27 Dateien, 26 geprüfte Hashes), einschließlich der neuen unabhängigen Mic-/Speaker-Diarization; Build-Smoke inklusive Sidecar-Geräteabfrage erfolgreich. Dafür sind TypeScript, 23 Unit-Tests, drei Rust-Tests und 334 C#-Assertions erfolgreich; neue UI-Szenarien wurden im integrierten Browser mit gemockter Bridge geprüft. Der aktuelle CLI-Lauf der 18 UI-Tests scheitert vor den Assertions am headless-Edge-Start (Exit 21). Frühere Settings-/Diagnose-UI-Prüfungen und native Negativdiagnose bleiben dokumentiert. Nicht jede ursprüngliche Audio-/Protokoll-Anforderung ist als abgenommen bestätigt; Einzelstatus siehe [Specs](./specs/).

Diese Spezifikation ist die **Windows-Variante** von `../meeting-notes/SPEC-v0.1.md` (Electron-Projekt, unveränderte Referenz). Architekturziel: Tauri 2 + React + C#-Sidecar (mit Azure Speech SDK in NuGet-Form). Die Anwendung selbst heißt *Meeting Notes*; „Tauri" ist die Container-Technik, nicht Teil des Produktnamens.

---

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
- **Backend:** C#/.NET 8 als Sidecar (`MeetingNotes.Sidecar.exe`, framework-dependent publiziert). Verantwortlich für Audio-Capture, Audio-Resampling, Azure-Speech-Transkription, Speaker-Diarization und Event-Streaming.
- **Frontend:** React 19 + TypeScript 6 + Vite 8 (im Tauri-Renderer-WebView2).
- **IPC Sidecar ↔ App:** `stdin/stdout` über `tauri-plugin-shell` mit JSON-Lines (siehe `DECISIONS.md → AD-008`). Named Pipe entfällt.
- **IPC App ↔ Renderer:** Tauri-`invoke()` für Commands + Tauri-`listen()` für Events (typed JSON).
- **Distribution:** NSIS-/MSI-Installer oder gesamter Portable-Ordner. Sidecar-EXE und verwaltete/native DLLs werden extern ausgeliefert, nicht in die Haupt-EXE eingebettet. Zielsystem braucht .NET 8 Runtime (win-x64) und WebView2.

## 4. Transkription
- API: Azure Speech
- Mehrsprecher-Differenzierung (Diarization): Nice-to-have (Best Effort)
- Recognizer-Strategie ist pro Quelle unabhängig konfigurierbar:
  - `diarization.mic` und `diarization.speaker`: aktiviert → `ConversationTranscriber`; deaktiviert → `SpeechRecognizer`.
  - Beide Optionen sind standardmäßig `true`, auch bei alten oder teilweise ergänzten Konfigurationen; explizites `false` bleibt erhalten.
  - Aktiviert: SDK-Speaker-IDs in Interim-/Final-Segmenten, mit `unknown` bei noch fehlender ID. Deaktiviert: feste IDs `self` (Mic) bzw. `guest` (Speaker).
  - Reale Mehrsprecherqualität und Continuous-LID-Verhalten bleiben getrennte Akzeptanztests; siehe [T-205](./specs/T-205-continuous-lid-und-diarization-in-c-sharp.md).
- Continuous Language Identification (LID) aktiviert (entspricht `meeting-notes`).
- **Implementierung:** NuGet-Paket `Microsoft.CognitiveServices.Speech` (C#) im Sidecar.
- Der Stop-Pfad muss je nach Recognizer-Typ korrekt erfolgen (`stopContinuousRecognitionAsync` vs. `stopTranscribingAsync`).
- Betriebsmodus: bevorzugt Echtzeit-Streaming (Implementierungsdetail des C#-SDK).
- Latenzziel: neue Transkriptsegmente erscheinen innerhalb von **< 5 Sekunden** in der UI.

## 5. UI (React)
- Anzeige der Transkripte mit Sprecher/Quelle, Zeitstempel, Text (sofern verfügbar).
- Verbesserte Sprecherdarstellung über Speaker-Badges/Farben.
- Sprecher-Alias-Mapping im UI für beide Quellen. Identitäten sind quellenspezifisch (`mic:Guest-1`, `speaker:Guest-1`), Standardlabels zeigen `Mic · Guest-1` bzw. `Speaker · Guest-1`; gleiche SDK-IDs verschiedener Quellen teilen keinen Alias. Nummerierte Mic-IDs nutzen einen Offset von 15 innerhalb der 30 zyklischen Farbslots.
- Bei geänderter SDK-Sprecher-ID ersetzt ein neues Interim-/Final-Event ältere Interims derselben Quelle; andere Quellen und finale Segmente bleiben erhalten. Die letzter-Sprecher-Anzeige berücksichtigt Aliase.
- Diagnostikbereich mit laufendem Debug-Log (App/Sidecar/IPC).
- Diagnostikbereich mit separaten Öffnen-/Schließen-Aktionen und manueller Log-Leerung.
- Einstellungen haben drei responsive Bereiche: **Allgemein**, **Azure-Konfiguration**, **Proxy** (rechts). Unterhalb aller Bereiche steht der tatsächliche Backend-Pfad der gemeinsamen Konfigurationsdatei. Bis 960 px Fensterbreite stehen die Bereiche untereinander.
- Nutzer kann Sprache/Devices sowie Azure-Konfiguration und Proxy bearbeiten. Proxy wird gemeinsam mit Azure gespeichert; **Verbindung testen** und laufende/letzte Ergebnisse öffnen liegen im Azure-Bereich.
- Spracheinstellung und unabhängige Sprechererkennung für Mic/Speaker werden über Neustarts hinweg persistiert. Beide Diarization-Checkboxen stehen bei den jeweiligen Geräten im Bereich **Allgemein** und sind während der Aufnahme deaktiviert. Gespeicherte Änderungen gelten für die nächste Aufnahme.
- Im Bereich **Allgemein** stehen außerdem **Transkript automatisch als Markdown speichern** (standardmäßig aktiv) und das optionale Feld **Speicherpfad**. Leer bedeutet Anwendungsverzeichnis.
- Bei fehlender, nicht lesbarer oder unvollständiger Azure-Konfiguration öffnen sich Einstellungen beim Start automatisch; schließbarer Bottom-Toast ohne Verschiebung des Hauptinhalts. Das ist lokale Pflichtfeldprüfung, keine Azure-Key-Verifikation.
- Separater Diagnose-Dialog mit Transportstatus und vollständiger Schritttabelle nach Abschluss. Schließen kehrt zu Einstellungen zurück, ohne einen laufenden Test abzubrechen; Ergebnisse können wieder geöffnet werden.
- F12 öffnet/schließt DevTools auch im Release-/Portable-Build.
- Bestehende UI bleibt Grundlage; Settings-/Diagnose-UX ist eine bewusste Ausnahme zur ursprünglichen 1:1-Portierung (siehe [DECISIONS.md](./DECISIONS.md), Fortschreibung AD-004 und [T-403](./specs/T-403-settings-dialog-mit-verbindung-testen-button.md)).

## 6. Konfiguration
- Azure-Konfiguration und Benutzeroptionen liegen gemeinsam in **einer** Datei `meeting-notes.config.json` (Abschnitte `azure` und `user`): im Release direkt neben der EXE, in Entwicklung im Repository-Root. Unabhängig vom Start-Arbeitsverzeichnis, ohne AppData-Migration/-Fallback.
- Azure-Key bleibt direkt im Feld `azure.speechKey`; Azure-/Proxy-Werte sind im Settings-Dialog editierbar. `AppConfigState` liefert `exists`, `path` und optional `config`.
- User-Settings enthalten `diarization: { "mic": true, "speaker": true }` sowie `transcript.markdownExport` mit `enabled` (Default `true`) und optionalem `path` (Default `null`). Fehlende Felder werden je Quelle als `true` normalisiert. Rust reicht die gespeicherten Optionen beim Start über `--diarization-mic true|false` und `--diarization-speaker true|false` an den Sidecar weiter.
- Optionaler HTTP-CONNECT-Proxy über `proxy.host`, `proxy.port` (1–65535), optional `username`/`password`. Host ohne Schema/Pfad. Rust lädt die Dateien und reicht Einstellungen an HTTPS-Diagnose und Sidecar weiter; der Sidecar lädt sie nicht selbst.
- Sidecar erhält Speech-Key/Proxy-Zugangsdaten über prozesslokale Umgebungsvariablen, nicht Credential-CLI-Argumente. Host/Port/Endpoint/Region/Sprache sind nicht geheime CLI-Args.
- **Verbindung testen** nutzt aktuelle, auch ungespeicherte Werte und Sitzungssprache. `test_azure_connectivity` führt parallel System-DNS/TCP/HTTPS in Rust und native Speech/WSS-Diagnose in einem separaten Sidecar ohne Audio-Capture aus.
- HTTPS nutzt expliziten Proxy mit optionaler Basic-Authentifizierung, ansonsten `.no_proxy()`; kein öffentlicher DNS-Fallback. DNS/TCP prüfen den Proxy, sonst den Endpoint mit dessen Port oder 443. HTTPS-HEAD folgt keinen Redirects.
- **HTTPS-Diagnose ignoriert Zertifikatsprüfungen immer (unsicher, Speech-Key-Abfangrisiko). Native Windows-Speech-SDK-Prüfung bleibt aktiv.** Kein offiziell dokumentierter .NET-Bypass für Speech SDK 1.44 gefunden.
- `httpsReachable` bedeutet HTTP-Antwort auch bei 401/403; `speechReachable` verlangt `Connected` und `SessionStarted` für Recognizer **und** Transcriber. `reachable` verlangt beide Transporte.
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
- Proxy-Probleme mit dem nativen Node-Speech-Pfad sind aus der Electron-Referenz übernommen. Ob dasselbe Verhalten im C#-Pfad auftritt, ist **nicht bestätigt**; `SpeechConfig.SetProxy()` ist implementiert, Erfolg im Firmenproxy noch offen.
- HTTPS-Erreichbarkeit bei ignorierten Zertifikaten beweist weder vertrauenswürdiges TLS noch native Speech/WSS-Funktion. Bei TLS-Inspection können Unternehmens-Root-CA und Allowlisting erforderlich sein.
- Corporate-Netzvalidierung und gegebenenfalls Entscheidung über eigenen WSS-Transport siehe [T-306](./specs/T-306-proxy-aware-azure-transport.md) und [T-505](./specs/T-505-proxy-aware-azure-transport.md). Eigener WSS-Client ist nicht implementiert.

## 7. Export
- Automatischer Dateiexport als Markdown mit YAML-Frontmatter (siehe [T-506](./specs/T-506-transkript-markdown-export-und-frontmatter.md)); kein Export in weitere Formate.
- Vollständiges Transkript per Copy-to-Clipboard als Markdown — identisch zur automatisch gespeicherten Datei.
- Exportinhalt: YAML-Frontmatter (`title`, `date`, `start`, `end`, `duration`, `language`, `segments`, `speakers`) plus finale Segmentliste mit Sprecher/Uhrzeit/Text. Sprecherlabels berücksichtigen quellenspezifische UI-Aliase; ohne Alias wird die Quelle mit ausgegeben, z. B. `Mic · Guest-1`.
- Zeitformat: deutsches Datums-/Zeitformat. Der Zielpfad des Datei-Exports ist optional; ohne Angabe landet die Datei im Anwendungsverzeichnis, relative Pfade werden dort aufgelöst.

## 8. Entwicklungsumgebung (Stabilitätsvorgabe)
- Standard für lokale Entwicklung: Node 22 LTS ≥22.12.0; zulässige Versionen gemäß `package.json` (auch ≥24.0.0 <24.16.0).
- Rust-Toolchain (stable, Edition 2021).
- .NET 8 SDK (für Sidecar-Build) lokal.
- Tauri-CLI (2.x) als devDependency.
- Native Entwicklung: `npm run tauri -- dev`; `npm run dev` startet nur Vite/Renderer. Build-/Test-Kommandos siehe [README.md](./README.md).

## 8.1 Sidecar-Deployment (Runtime-Anforderung)
- Lokale Entwicklung/Build: .NET 8 SDK erforderlich, um das Sidecar zu veröffentlichen.
- Zielsystem: .NET 8 Runtime (win-x64) ausreichend; SDK ist dort nicht erforderlich.
- Build-/Start-Flow:
  - Dev: `build.rs` publiziert Sidecar automatisch, danach Start durch Tauri.
  - Installer: `npm run tauri -- build` bündelt Sidecar-EXE **und DLLs** als externe Resources.
  - Portable: `npm run tauri -- build --no-bundle`, nach Erfolg `npm run dist:portable` und `npm run test:smoke`; gesamter Ordner erforderlich, nicht nur Haupt-EXE.
  - Lokaler letzter Portable-Build: 20.79 MB, alle 26 Hashes geprüft. Aktuelle MSI/NSIS- und Clean-Machine-Validierung nicht erneut durchgeführt.

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
- Proxy-Workaround (T-505) je nach Entscheidung.

## 11. Offene Entscheidungen und Akzeptanz
1. [T-505](./specs/T-505-proxy-aware-azure-transport.md): Erst nach echtem Firmenproxy-/C#-WSS-Test gegebenenfalls über Workaround entscheiden.
2. Reale Aufnahme/Latenz und Clean-Machine-Deployment sowie aktuelle Installer-Parität prüfen ([T-500](./specs/T-500-qualitaetssicherung-und-akzeptanztests.md)).
3. Historisch offene Sidecar-Benennung: aktuell `MeetingNotes.Sidecar.exe`; keine Umbenennung in den heutigen Änderungen.

Bereits festgelegt: stdin/stdout statt Named Pipe, Windows-only; Installer-Konfiguration NSIS und MSI, daneben Portable-Ordner. Heute nur Portable neu gebaut.

## 12. Querverweise
- Aktueller Projektstatus: [README.md](./README.md)
- Architekturentscheidungen: [DECISIONS.md](./DECISIONS.md)
- Tasks und Akzeptanzstatus: [specs/](./specs/)
- Quell-Projekt (Electron): `../meeting-notes/` (unveränderte Referenz)