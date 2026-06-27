# Spezifikation v0.1 — Meeting Notes (Tauri-Variante)

Stand: 25.06.2026
Status: Entwurf (Doku-Phase, vor Implementierung)

Diese Spezifikation ist die **Tauri-Variante** von `../meeting-notes/SPEC-v0.1.md`. Architekturziel: Tauri 2 + React + C#-Sidecar (mit Azure Speech SDK in NuGet-Form).

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
- **Distribution:** Tauri-`tauri build` (NSIS-/MSI-Installer), Sidecar als Resource eingebunden.

## 4. Transkription
- API: Azure Speech
- Mehrsprecher-Differenzierung (Diarization): Nice-to-have (Best Effort)
- Recognizer-Strategie (wie bisher in `meeting-notes`):
  - Mic-Kanal: `SpeechRecognizer`
  - Speaker-Kanal: `ConversationTranscriber` (fest, kein separater `recognitionMode`-Schalter)
- Continuous Language Identification (LID) aktiviert (entspricht `meeting-notes`).
- **Implementierung:** NuGet-Paket `Microsoft.CognitiveServices.Speech` (C#) im Sidecar.
- Der Stop-Pfad muss je nach Recognizer-Typ korrekt erfolgen (`stopContinuousRecognitionAsync` vs. `stopTranscribingAsync`).
- Betriebsmodus: bevorzugt Echtzeit-Streaming (Implementierungsdetail des C#-SDK).
- Latenzziel: neue Transkriptsegmente erscheinen innerhalb von **< 5 Sekunden** in der UI.

## 5. UI (React)
- Anzeige der Transkripte mit Sprecher/Quelle, Zeitstempel, Text (sofern verfügbar).
- Verbesserte Sprecherdarstellung über Speaker-Badges/Farben.
- Sprecher-Alias-Mapping im UI.
- Diagnostikbereich mit laufendem Debug-Log (App/Sidecar/IPC).
- Diagnostikbereich mit separaten Öffnen-/Schließen-Aktionen und manueller Log-Leerung.
- Nutzer kann in der UI ändern:
  - Sprache
  - Audio-Devices (wenn nicht Default)
- Spracheinstellung wird über Neustarts hinweg persistiert.
- **Komponenten werden 1:1 aus `meeting-notes` portiert** (siehe `DECISIONS.md → AD-004`).

## 6. Konfiguration
- API-Konfiguration über fest verdrahtete JSON-Datei.
- Azure-Konfiguration liegt in `config/azure.json`; der Azure-Key wird dort direkt im Feld `speechKey` hinterlegt.
- Optionaler Azure-Proxy über `proxy.host`, `proxy.port` sowie optional `proxy.username`/`proxy.password`.
- Kein vollwertiger Konfigurationseditor in der UI für den PoC.
- **Verbindung testen**-Button in den Azure-Einstellungen: führt DNS-/TCP-/HTTPS-Diagnose gegen den konfigurierten Endpoint aus, Result-Karte zeigt alle Schritte und Fehlermeldungen. Modul `src-tauri/src/connectivity.rs` (Pendant zu `meeting-notes/src/main/azure-connectivity.ts`), Tauri-Command `test_azure_connectivity`.

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
- Die native Azure-Speech-SDK (Node- und C#-Variante) zeigt in restriktiven Netzwerkumgebungen identisches Verhalten: die per `setProxy()` gesetzten Proxy-Properties werden nicht zuverlässig für den ausgehenden WSS-Connect genutzt. In Corporate-Netzen mit erzwungenem HTTP-Proxy und ausgehender Firewall kommt keine Verbindung zustande.
- Diagnose-Hilfsmittel und Workarounds siehe `TROUBLESHOOTING.md` (zu erstellen) und `specs/T-505-proxy-aware-azure-transport.md`.

## 7. Export
- Kein Dateiexport im PoC vorgesehen.
- Vollständiges Transkript per Copy-to-Clipboard als TXT.
- Exportinhalt: YAML-ähnlicher Header (`datum`, `startzeit`, `dauer`) plus Segmentliste mit Sprecher/Uhrzeit/Text.
- Zeitformat: deutsches Datums-/Zeitformat.

## 8. Entwicklungsumgebung (Stabilitätsvorgabe)
- Standard für lokale Entwicklung: Node 22 LTS (`.nvmrc`).
- Rust-Toolchain (stable, Edition 2021).
- .NET 8 SDK (für Sidecar-Build) lokal.
- Tauri-CLI (2.x) als devDependency.
- Zulässige Node-Versionen im Projekt: identisch zu `meeting-notes` (siehe `../meeting-notes/SPEC-v0.1.md` Abschnitt 8).

## 8.1 Sidecar-Deployment (Runtime-Anforderung)
- Lokale Entwicklung/Build: .NET 8 SDK erforderlich, um das Sidecar zu veröffentlichen.
- Zielsystem: .NET 8 Runtime (win-x64) ausreichend; SDK ist dort nicht erforderlich.
- Build-/Start-Flow:
  - Dev: `dotnet publish` → `sidecar/publish/sidecar/MeetingNotes.Sidecar.exe`, von Tauri gestartet.
  - Build: Tauri-`tauri build` bündelt das Sidecar-EXE als Resource.

## 9. Nicht-Ziele
- Code-Signing
- Plattformübergreifende Unterstützung (macOS/Linux) — siehe `DECISIONS.md → AD-005`
- Bluetooth-Audio-Support
- Mobile (iOS/Android)
- Datei-Export (nur Clipboard)
- Produktionsreife Betriebs-/Monitoring-Features

## 10. MVP-Rollout

Die MVPs des Electron-Projekts werden in der Tauri-Variante **funktional beibehalten**, aber der Migrationsplan aus `PROJECT.md → Migration aus meeting-notes` strukturiert die Umsetzung:

### MVP 1 (Tauri)
- Tauri-2-Anwendung startet lokal mit React-Renderer.
- Tauri-IPC-Bridge (`invoke`/`listen`) steht und ist in Main/Renderer verdrahtet.
- Sidecar-Spawn funktioniert (Stub-Sidecar reicht für Smoke-Test).
- React-UI rendert mit Stub-Events.
- Manuelle Zwischenprüfungen.

### MVP 2 (Tauri)
- Sidecar mit Audio-Capture (NAudio, WASAPI Mic + Loopback) anbinden.
- Azure Speech SDK NuGet im Sidecar integrieren.
- Pipeline A (Mic → `SpeechRecognizer`) und Pipeline B (Speaker → `ConversationTranscriber`) laufen.
- JSON-Lines-Events fließen vom Sidecar durch den Tauri-Main in den Renderer.
- Loopback-Blocker-Regel mit finalen Fehlercodes.
- UI/Export auf reale Daten und finale Fehlerpfade gehärtet.

### MVP 3 (Tauri)
- Audio-Transport-Härtungen (1:1 aus `meeting-notes` Audit-Block).
- **Verbindung testen**-Button + Diagnose-Modul.
- Proxy-Workaround (T-505) je nach Entscheidung.

## 11. Offene Entscheidungen
1. `t-201`: Sidecar-EXE-Name und Command-Pipe-Trennung (siehe `DECISIONS.md → Offene Fragen`).
2. `T-505`: Proxy-Workaround-Variante (Node → C# Pfad; ggf. WSS-Eigenbau in C# statt Node).
3. `OQ-4`: macOS-/Linux-Build optional vorbereiten oder hardcoded Windows-only?
4. Tauri-Bundle-Format: NSIS vs. MSI vs. beides?

## 12. Querverweise
- Architekturziele: `PROJECT.md`
- Architekturentscheidungen: `DECISIONS.md`
- Tasks: `specs/`
- Quell-Projekt (Electron): `../meeting-notes/`