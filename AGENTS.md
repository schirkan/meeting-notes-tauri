# Project: Meeting Notes

## Aktueller Status
- 25.06.2026: Projekt angelegt. Fokus: **Electron durch Tauri 2 ersetzen** und die gesamte Backend-Logik (Audio-Capture + Azure Speech SDK) in den bestehenden C#-Sidecar konsolidieren.
- 25.06.2026: Architekturziel und Migrationsstrategie dokumentiert (siehe `DECISIONS.md`).
- 25.06.2026: Spec-Backbone (`specs/T-100` … `T-505`) für die Tauri-Variante angelegt; Status aller Specs: **draft** (Umsetzung steht aus).
- 25.06.2026: Bestehendes `projects/meeting-notes` (Electron + Node Speech SDK + C#-Sidecar nur für Audio) bleibt während der Migration **unverändert referenzierbar** und wird nicht zwischendurch angefasst.
- 25.06.2026: **Phase 5 (Decommission `meeting-notes`) aus dem Migrationsplan gestrichen.** Das Electron-Projekt bleibt dauerhaft als Referenz bestehen. Migrationsplan ist jetzt **4 Phasen** (Phase 1–4 nach Phase 0 = Doku).
- 25.06.2026: **OQ-4 entschieden → Windows-only (hardcoded).** macOS-/Linux-Builds werden nicht vorbereitet (kein Cross-Compile, keine plattformneutralen Pfade).
- 25.06.2026: **OQ-2 entschieden + AD-008 ergänzt → IPC via stdin/stdout über `tauri-plugin-shell`.** Named Pipe als Transport entfällt komplett (siehe DECISIONS.md → AD-008). Betrifft: `specs/T-201` (komplett umgeschrieben), `specs/T-301` (Args angepasst), `specs/T-102`/`T-200` (Erwähnungen), Architektur-Diagramm und Tech-Stack-Tabelle in diesem Dokument.
- 2026-11-09: **Implementierung vorhanden, lokal gebaut und teilweise validiert.** Portable: 20.79 MB gesamt, 27 Dateien/26 geprüfte Hashes. Tauri-Haupt-EXE benötigt den externen Sidecar-Ordner mit DLLs, .NET 8 Runtime und WebView2.
- 2026-11-09: Settings mit Allgemein/Azure-Konfiguration/Proxy, Azure-Testbutton und beiden Config-Pfaden im Footer. Release liest/schreibt `config/` neben der EXE, Dev im Repository; kein AppData-Fallback. Fehlende/ungültige Azure-Konfiguration öffnet Settings automatisch mit Bottom-Toast. F12-DevTools funktionieren auch im Release.
- 2026-11-09: HTTPS-Diagnose nutzt expliziten CONNECT-Proxy und ignoriert Zertifikatsprüfungen bewusst nur dort (unsicher). Separate native Speech/WSS-Diagnose prüft Recognizer/Transcriber ohne Capture; native Zertifikatsprüfung bleibt aktiv. Credentials werden prozesslokal per Env übergeben. Separater Dialog zeigt Schritte erst nach Abschluss und bleibt wiederöffnbar.
- 2026-11-09: 12 UI-Regressionstests, fokussierte TypeScript-/Rust-Prüfungen, Build-Smoke und native lokale Negativdiagnose erfolgreich. **Offen:** positiver Firmenproxy-/Azure-Test, Aufnahme-Latenz, Clean-Machine-Deployment und aktuelle Installer-Parität. Specs unterscheiden `implemented`, `partial` und offene Akzeptanz; ursprüngliche Draft-Notizen oben sind historisch.
- 2026-11-11: Git-Sync mit `origin/main` abgeschlossen (2 Commits übernommen, Stand `39b251e`). Review der eingetroffenen Änderungen: 41 Node-Tests, 12 Rust-Tests und beide .NET-Builds grün. Ungenutzte Rust-Abhängigkeit entfernt, `## Git`-Sektion ergänzt, veraltete Spec-Verweise korrigiert. Repo-Setup siehe `## Git`.
- 2026-11-11: **Produktname bereinigt, MIT-Lizenz, eine Konfigurationsdatei, Markdown-Export.** Das Wort „Tauri" ist aus dem UI entfernt (Fenstertitel, HTML-Titel, EXE-Name `meeting-notes.exe`, Product-Name, Identifier, Paketname). Die zwei Config-Dateien sind zu **einer** Datei `meeting-notes.config.json` direkt neben der EXE zusammengeführt; der `config/`-Ordner entfällt. Neu: automatischer Transkript-Export als Markdown mit YAML-Frontmatter (optionaler Pfad, Standard Anwendungsverzeichnis); Clipboard-Kopie und Datei teilen denselben Builder. `LICENSE` (MIT, Copyright Martin Pietschmann) ergänzt. Spec: [T-506](./specs/T-506-transkript-markdown-export-und-frontmatter.md).

## Ziel der Migration

Das bestehende Electron-Projekt (`projects/meeting-notes`) hat zwei erkannte Schwächen, die dieser Fork adressiert:

1. **Build-Größe.** Der aktuelle Portable-Build ist ~180 MB groß, davon ca. 150 MB Electron-Runtime (Chromium + Node). Ein Tauri-Build nutzt die systemeigene WebView2 (Windows 11: bereits vorinstalliert) und landet typischerweise bei **~15–30 MB** Installations- bzw. Bundle-Größe.
2. **Audio- + Speech-SDK verteilt.** Heute läuft Audio-Capture in C# (NAudio), Azure-Speech-Transkription in Node (`microsoft-cognitiveservices-speech-sdk`) im Electron-Main. Audio-Frames werden via Named Pipe vom C#-Sidecar in den Node-Main übertragen, der sie in die Azure-PushStream einspeist. Das ist ein zusätzlicher Hop pro Frame.
   - **Im Tauri-Projekt** wandert **Azure Speech SDK komplett in den C#-Sidecar** (NuGet `Microsoft.CognitiveServices.Speech`). Audio und Speech laufen damit in **einem** Prozess, ohne Pipe-Marshalling der PCM-Frames. Tauri-Main (Rust) empfängt nur noch **fertige Transkript-Events** per JSON-Lines über **stdin/stdout** über `tauri-plugin-shell` (siehe `DECISIONS.md → AD-008`).

Eine detaillierte Begründung der Entscheidungen siehe [DECISIONS.md](./DECISIONS.md); aktuelle Spezifikation siehe [SPEC.md](./SPEC.md).

## Architektur (Soll)

```
┌─────────────────────────────────────────────────────────────┐
│  React-Frontend (TypeScript, Vite)                          │
│  - identisch zum bestehenden Projekt, nur Tauri-Preload     │
└─────────────────────────────────────────────────────────────┘
                          ▲ tauri::invoke / .listen
                          │ (typed JSON, kein HTML-IPC)
┌─────────────────────────────────────────────────────────────┐
│  Tauri-Main (Rust) — src-tauri/                             │
│  - Fenster/WebView2-Lifecycle                               │
│  - Sidecar-Spawn (tauri-plugin-shell)                       │
│  - stdin/stdout JSON-Lines vom/zum C#-Sidecar               │
│  - Settings persistieren                                    │
│  - Verbindung-testen-Diagnose (DNS/TCP/HTTPS)               │
└─────────────────────────────────────────────────────────────┘
                          ▲ stdin/stdout (JSON-Lines, via tauri-plugin-shell)
                          │
┌─────────────────────────────────────────────────────────────┐
│  C# Sidecar — sidecar/MeetingNotes.Sidecar/                 │
│  - WASAPI Mic + Speaker-Loopback (NAudio)                   │
│  - PCM-Resampling auf 16 kHz / 16-bit / mono                │
│  - Azure Speech SDK (SpeechRecognizer +                     │
│    ConversationTranscriber + Continuous LID)                │
│  - Speaker-Diarization                                      │
│  - JSON-Lines-Stream → Tauri-Main                           │
│  - KEINE Audio-Frames mehr nach außen                       │
└─────────────────────────────────────────────────────────────┘
```

### Pipeline-Vergleich

| Phase                     | Electron-Variante (`meeting-notes`)       | Tauri-Variante (dieses Projekt)  |
| ------------------------- | ----------------------------------------- | -------------------------------- |
| Audio-Capture             | C# Sidecar (NAudio)                       | **C# Sidecar (NAudio)**          |
| Audio-Frame-Transport     | Named Pipe → Node-Main → Azure PushStream | **entfällt — bleibt im Sidecar** |
| Azure Speech              | Node SDK im Electron-Main                 | **C# SDK im Sidecar**            |
| Transcript-Events         | Electron IPC → React                      | **Tauri `.emit()` → React**      |
| Bundle-Größe (Windows)    | ~180 MB                                   | **~15–30 MB (Zielwert)**         |
| Sprache der Backend-Logik | C# (Audio) + TypeScript (Speech)          | **C# (Audio + Speech)**          |

## Scope (unverändert gegenüber Electron-Variante)
- Plattform: Windows 11
- Mikrofon + primärer Speaker-Output (Loopback) parallel
- Live-Transkript in React-UI (Interim/Final, Speaker-Badges, Alias-Mapping)
- Sprache pro Sitzung persistent
- Debug-Log im UI (Main/Sidecar/IPC)
- Markdown-Export mit YAML-Frontmatter: automatisches Speichern beim Ende der Aufnahme (Pfad optional, Standard ist das Anwendungsverzeichnis) sowie Kopieren in die Zwischenablage — beide erzeugen dasselbe Dokument
- Azure-Proxy optional konfigurierbar (`proxy.host`/`proxy.port` + optional Auth)
- **Verbindung testen**-Button (DNS/TCP/HTTPS-Diagnose) — wandert vom Node-Modul `azure-connectivity.ts` in ein Rust-Modul `connectivity.rs`
- **Diagnose** für restriktive Netzwerkumgebungen (siehe `specs/T-505-proxy-aware-azure-transport.md`)

## Nicht-Ziele
- Code-Signing
- macOS/Linux (Windows 11 only, kompatibel zu `meeting-notes`)
- Bluetooth-Audio-Support
- Mobile (iOS/Android) — Tauri 2 hat Mobile-Alpha, ist aber bewusst **nicht** im Scope
- Kein Export in weitere Formate (JSON, DOCX, TXT)
- Produktionsreife Betriebs-/Monitoring-Features

## Technologie-Stack (Soll)

| Schicht           | Technologie                                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App-Container     | Tauri 2 (Rust)                                                                                                                                                      |
| Renderer          | React 19 + Vite 8 (TypeScript)                                                                                                                                      |
| System-WebView    | WebView2 (Edge/Chromium-Engine, Windows 11 Bestandteil)                                                                                                             |
| Backend-Prozess   | C#/.NET 8, framework-dependent Publish                                                                                                                              |
| Audio-Library     | NAudio 2.2.x (WASAPI Mic + Loopback)                                                                                                                                |
| Speech-SDK        | `Microsoft.CognitiveServices.Speech` 1.44.x NuGet                                                                                                                   |
| IPC Sidecar ↔ App | `stdin/stdout` über `tauri-plugin-shell`, JSON-Lines (Status, Events, Commands, Settings) — siehe `DECISIONS.md → AD-008`                                           |
| Build-Pipeline    | `tauri build` (NSIS/MSI-Installer) + `dotnet publish` für Sidecar, automatisiert via `src-tauri/build.rs` (siehe `DECISIONS.md → AD-009`)                           |
| Sidecar-Lifecycle | `Arc<Mutex<Option<CommandChild>>>` aus `tauri-plugin-shell` 2.x (`CommandChild` ist nicht mehr Clone, Wrapper teilt Schreibzugriff zwischen Cache und Orchestrator) |
| Clipboard         | `navigator.clipboard.writeText` direkt im Preload (siehe `DECISIONS.md → AD-010`)                                                                                   |

## Offene Probleme / Erkenntnisse

### Audio-Transport funktioniert in Electron-Variante, Proxy-Problem bleibt bestehen (aus `meeting-notes` übernommen)

Das unter `projects/meeting-notes/AGENTS.md → Offene Probleme` dokumentierte Proxy-Problem gilt für diese Variante **sinngemäß gleich**:
- Native Azure-SDK nutzt `setProxy()`-Properties im Node-Pfad nicht zuverlässig für WSS-Connect.
- Im C#-Pfad verhält sich die native Speech-SDK (NuGet) tendenziell etwas kooperativer, aber die genaue Garantie muss in `specs/T-505-proxy-aware-azure-transport.md` für die C#-Variante neu validiert werden.
- Workaround-Plan (Variante 3: Eigenbau eines WSS-Clients) wird in `specs/T-505` mit C#-Code-Skeleton skizziert.

### Bekannte Nebensymptome (aus `meeting-notes` übernommen)
- DNS-Filterung auf Custom-Endpoints in Corporate-Netzen.
- `https-proxy-agent` als möglicher Ersatz evaluiert, nicht eingebaut.

### Anbieter-Alternativen evaluiert (OpenAI) — nicht verfolgt (2026-06-27)

Als Reaktion auf den Proxy-Block des Azure-Cognitive-Services-Endpoints (`*.cognitiveservices.azure.com`, konkret `schir-mbpjdimi-swedencentral.cognitiveservices.azure.com`) wurden zwei OpenAI-Audio-Modelle als mögliche Alternative geprüft:

- **`gpt-4o-transcribe-diarize`** (OpenAI, REST `POST /v1/audio/transcriptions`, seit Okt. 2025): Diarization via `diarized_json`, bekannte Sprecher-Referenzen (bis zu 4), `stream=true` möglich — Live-Deltas vorhanden, aber Speaker-Labels erst beim Segment-Final. Continuous LID nicht vorgesehen. Akzeptiert nur Container-Formate (mp3/m4a/wav/…), kein Raw-PCM. Upload ≤ 25 MB, `chunking_strategy` Pflicht > 30 s.
- **`gpt-realtime-whisper`** (OpenAI Realtime API, Session-Type `transcription`, WebSocket/WebRTC): nativ streaming, transcript-deltas live, Latenz-Stufen `minimal/low/medium/high/xhigh`. Erwartet 24 kHz PCM (Sidecar-Resampling nötig). **Diarization im Transcription-Session nicht unterstützt** (Doku: Felder vor Live-Schaltung verifizieren). Continuous LID nicht vorgesehen, nur ein statischer `language`-Hint pro Session.

**Warum verworfen:**

1. **Continuous LID fehlt in beiden Modellen.** Azure Continuous LID ist Alleinstellung. Workaround (periodische `gpt-4o-mini-transcribe`-LID-Probes) wäre Eigenbau-Komplexität ohne Qualitätsgewinn.
2. **Live-Interim + Diarization gleichzeitig** ist bei OpenAI nicht in einem Modell verfügbar. Hybrid (`gpt-realtime-whisper` für Deltas + rollende `gpt-4o-transcribe-diarize`-Passes auf 30-s-Chunks) ist machbar, aber doppelte Audio-Pipeline und Speaker-Mapping-Zusammenführung erforderlich — Aufwand > Nutzen.
3. **Proxy-Problem wird nicht automatisch gelöst.** Wenn die Firmenfirewall `*.cognitiveservices.azure.com` blockt, ist `api.openai.com` mit hoher Wahrscheinlichkeit ebenfalls geblockt oder muss allowgelistet werden. OpenAI ist zusätzlich über **Azure OpenAI Service** deploybar — das wäre dann wieder ein Azure-Endpoint mit demselben Block-Potenzial.

**Entscheidung:** Azure bleibt der Speech-Provider. Der Workaround-Pfad gemäß Specs **T-306** (C#-Validierung von `SpeechConfig.SetProxy`) und **T-505** (Variante 3: Eigenbau-WSS-Client in C#) wird weiterverfolgt. Begründung als Entscheidungs-Record: `DECISIONS.md → AD-011`.

## Migration aus `meeting-notes` (historischer Schritt-für-Schritt-Plan)

**Fortschreibung 2026-11-09:** Der ursprüngliche Plan unten beschreibt den Entwurfsstand. Aktuelle Änderungen erfolgen ausschließlich in diesem Tauri-Projekt; das Electron-Projekt bleibt unveränderte Referenz. Implementierung und Teilabnahme stehen in [SPEC.md](./SPEC.md) und [T-500](./specs/T-500-qualitaetssicherung-und-akzeptanztests.md).

Der ursprüngliche Migrationsplan war bewusst **inkrementell** aufgebaut, sodass `meeting-notes` jederzeit lauffähig bleibt und dieses Projekt nie aus dem Nichts entsteht:

1. **Phase 0 (dieser Stand):** Doku + Specs vollständig, kein Code.
2. **Phase 1 — Sidecar-Konsolidierung (in `meeting-notes`):**
   - Azure Speech SDK NuGet zum bestehenden `MeetingNotes.Sidecar.csproj` hinzufügen.
   - Node-Pfad (`src/main/azure-transcription-service.ts`) durch gemanagte Pipe-Listener ersetzen, der nur noch Events konsumiert.
   - Funktioniert weiter in Electron → dient als **Brückenkopf** und beweist, dass die Sidecar-Konsolidierung technisch trägt.
3. **Phase 2 — Tauri-Scaffold (dieses Projekt):**
   - `tauri init` + React/Vite-Ports.
   - IPC-Vertrag 1:1 aus dem Sidecar-Konsolidierungsschritt übernehmen.
   - Sidecar bleibt dasselbe EXE; nur der Spawner wechselt von Electron zu Tauri.
4. **Phase 3 — Feature-Parität herstellen:**
   - Alle UI-Komponenten (`HeroStatusCard`, `TranscriptPanel`, `SettingsDialog`, `DebugLogPanel`, `SpeakerMappingPanel`) 1:1 portieren.
   - Tauri-spezifische Bridge (`tauri::command` / `.listen`) hinter identischer `transcript-contract.ts`-Schnittstelle verstecken.
5. **Phase 4 — Validierung:**
   - Smoke-Test, Latenz-Messung, Portable-Build.
   - Größenvergleich: vorher ~180 MB → nachher ~15–30 MB.
## Git

- **Repo-Typ:** GitHub (public)
- **Pfad / URL:** https://github.com/schirkan/meeting-notes-tauri
- **Remote(s):** `origin` -> https://github.com/schirkan/meeting-notes-tauri.git
- **Eingerichtet am:** 2026-06-25
- **Standard-Branch:** `main`
- **Notizen:** Die Anwendung heißt *Meeting Notes* (EXE `meeting-notes.exe`). Das GitHub-Repository behält den Namen `meeting-notes-tauri`; „Tauri" ist dort die Technikbezeichnung, kein Produktname mehr.
- **`.gitignore`-Status:** vorhanden (Rust `target/`, Node `node_modules/`/`dist/`, .NET `bin/`/`obj/`, `meeting-notes.config.json`)

## Workboard

Kein Workboard-Board für dieses Projekt (Owner-Entscheidung 2026-11-11). Aufgaben und Akzeptanzstatus werden in `specs/T-*.md` geführt; eine Karten-Erzeugung im Workboard ist bewusst nicht aktiviert.

## Session Log
- 2026-11-11, 14:30 UTC: Git-Sync mit `origin/main` (2 Commits: `6a83162`, `39b251e`). Review abgeschlossen; Befunde behoben: ungenutztes `hickory-resolver` aus `src-tauri/Cargo.toml` entfernt, `## Git`-Sektion ergänzt, veraltete Verweise in `specs/T-100-...md` korrigiert.
- 2026-11-11, 20:15 UTC: Produktname bereinigt (kein „Tauri" mehr im UI, EXE `meeting-notes.exe`), MIT-Lizenz ergänzt, Config auf eine Datei `meeting-notes.config.json` neben der EXE zusammengeführt, Markdown-Export mit Frontmatter implementiert (T-506). Verifiziert: 46 Node-Tests, 15 Rust-Tests, TypeScript- und .NET-Build grün.
- 25.06.2026, 22:30 UTC: Projektordner `meeting-notes-tauri` angelegt (`PROJECT.md`, `README.md`, `DECISIONS.md`, `SPEC-v0.1.md`, `specs/T-*.md`).
- 25.06.2026, 22:30 UTC: Architekturziel dokumentiert (Tauri 2 + C#-Sidecar mit Azure Speech SDK in NuGet-Form).
- 25.06.2026, 22:30 UTC: Migration in 5 Phasen geplant; Phase 0 (Doku) abgeschlossen, Phase 1 ff. warten auf Nutzer-Freigabe.
- 2026-06-27, 09:21 UTC: Anbieter-Alternativen geprüft (`gpt-4o-transcribe-diarize`, `gpt-realtime-whisper`) und verworfen — Continuous LID fehlt in beiden, Hybrid wäre doppelte Audio-Pipeline, Proxy-Problem bleibt bestehen. Azure bleibt Provider. Doku-Update ohne Spike/Implementierung auf Nutzer-Wunsch (siehe neuer Abschnitt oben + `DECISIONS.md → AD-011`).