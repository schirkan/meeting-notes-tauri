# Project: Meeting Notes (Tauri)

## Aktueller Status
- 25.06.2026: Projekt angelegt. Fokus: **Electron durch Tauri 2 ersetzen** und die gesamte Backend-Logik (Audio-Capture + Azure Speech SDK) in den bestehenden C#-Sidecar konsolidieren.
- 25.06.2026: Architekturziel und Migrationsstrategie dokumentiert (siehe `DECISIONS.md`).
- 25.06.2026: Spec-Backbone (`specs/T-100` … `T-505`) für die Tauri-Variante angelegt; Status aller Specs: **draft** (Umsetzung steht aus).
- 25.06.2026: Bestehendes `projects/meeting-notes` (Electron + Node Speech SDK + C#-Sidecar nur für Audio) bleibt während der Migration **unverändert referenzierbar** und wird nicht zwischendurch angefasst.
- 25.06.2026: **Phase 5 (Decommission `meeting-notes`) aus dem Migrationsplan gestrichen.** Das Electron-Projekt bleibt dauerhaft als Referenz bestehen. Migrationsplan ist jetzt **4 Phasen** (Phase 1–4 nach Phase 0 = Doku).
- 25.06.2026: **OQ-4 entschieden → Windows-only (hardcoded).** macOS-/Linux-Builds werden nicht vorbereitet (kein Cross-Compile, keine plattformneutralen Pfade).
- 25.06.2026: **OQ-2 entschieden + AD-008 ergänzt → IPC via stdin/stdout über `tauri-plugin-shell`.** Named Pipe als Transport entfällt komplett (siehe DECISIONS.md → AD-008). Betrifft: `specs/T-201` (komplett umgeschrieben), `specs/T-301` (Args angepasst), `specs/T-102`/`T-200` (Erwähnungen), Architektur-Diagramm und Tech-Stack-Tabelle in diesem Dokument.
- **Bisher keine Implementierung.** Nur Dokumentation und Spezifikationen.

## Ziel der Migration

Das bestehende Electron-Projekt (`projects/meeting-notes`) hat zwei erkannte Schwächen, die dieser Fork adressiert:

1. **Build-Größe.** Der aktuelle Portable-Build ist ~180 MB groß, davon ca. 150 MB Electron-Runtime (Chromium + Node). Ein Tauri-Build nutzt die systemeigene WebView2 (Windows 11: bereits vorinstalliert) und landet typischerweise bei **~15–30 MB** Installations- bzw. Bundle-Größe.
2. **Audio- + Speech-SDK verteilt.** Heute läuft Audio-Capture in C# (NAudio), Azure-Speech-Transkription in Node (`microsoft-cognitiveservices-speech-sdk`) im Electron-Main. Audio-Frames werden via Named Pipe vom C#-Sidecar in den Node-Main übertragen, der sie in die Azure-PushStream einspeist. Das ist ein zusätzlicher Hop pro Frame.
   - **Im Tauri-Projekt** wandert **Azure Speech SDK komplett in den C#-Sidecar** (NuGet `Microsoft.CognitiveServices.Speech`). Audio und Speech laufen damit in **einem** Prozess, ohne Pipe-Marshalling der PCM-Frames. Tauri-Main (Rust) empfängt nur noch **fertige Transkript-Events** per JSON-Lines über **stdin/stdout** über `tauri-plugin-shell` (siehe `DECISIONS.md → AD-008`).

Eine detaillierte Begründung der Entscheidungen siehe `DECISIONS.md`; eine aktualisierte Fassung der Spezifikation siehe `SPEC-v0.1.md`.

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

| Phase | Electron-Variante (`meeting-notes`) | Tauri-Variante (dieses Projekt) |
|---|---|---|
| Audio-Capture | C# Sidecar (NAudio) | **C# Sidecar (NAudio)** |
| Audio-Frame-Transport | Named Pipe → Node-Main → Azure PushStream | **entfällt — bleibt im Sidecar** |
| Azure Speech | Node SDK im Electron-Main | **C# SDK im Sidecar** |
| Transcript-Events | Electron IPC → React | **Tauri `.emit()` → React** |
| Bundle-Größe (Windows) | ~180 MB | **~15–30 MB (Zielwert)** |
| Sprache der Backend-Logik | C# (Audio) + TypeScript (Speech) | **C# (Audio + Speech)** |

## Scope (unverändert gegenüber Electron-Variante)
- Plattform: Windows 11
- Mikrofon + primärer Speaker-Output (Loopback) parallel
- Live-Transkript in React-UI (Interim/Final, Speaker-Badges, Alias-Mapping)
- Sprache pro Sitzung persistent
- Debug-Log im UI (Main/Sidecar/IPC)
- TXT-Clipboard-Export mit Metadaten-Header (Datum, Startzeit, Dauer)
- Azure-Proxy optional konfigurierbar (`proxy.host`/`proxy.port` + optional Auth)
- **Verbindung testen**-Button (DNS/TCP/HTTPS-Diagnose) — wandert vom Node-Modul `azure-connectivity.ts` in ein Rust-Modul `connectivity.rs`
- **Diagnose** für restriktive Netzwerkumgebungen (siehe `specs/T-505-proxy-aware-azure-transport.md`)

## Nicht-Ziele
- Code-Signing
- macOS/Linux (Windows 11 only, kompatibel zu `meeting-notes`)
- Bluetooth-Audio-Support
- Mobile (iOS/Android) — Tauri 2 hat Mobile-Alpha, ist aber bewusst **nicht** im Scope
- Datei-Export (nur Clipboard wie bisher)
- Produktionsreife Betriebs-/Monitoring-Features

## Technologie-Stack (Soll)

| Schicht | Technologie |
|---|---|
| App-Container | Tauri 2 (Rust) |
| Renderer | React 18 + Vite (TypeScript) |
| System-WebView | WebView2 (Edge/Chromium-Engine, Windows 11 Bestandteil) |
| Backend-Prozess | C#/.NET 8, framework-dependent Publish |
| Audio-Library | NAudio 2.2.x (WASAPI Mic + Loopback) |
| Speech-SDK | `Microsoft.CognitiveServices.Speech` 1.44.x NuGet |
| IPC Sidecar ↔ App | `stdin/stdout` über `tauri-plugin-shell`, JSON-Lines (Status, Events, Commands, Settings) — siehe `DECISIONS.md → AD-008` |
| Build-Pipeline | `tauri build` (NSIS/MSI-Installer) + `dotnet publish` für Sidecar |

## Offene Probleme / Erkenntnisse

### Audio-Transport funktioniert in Electron-Variante, Proxy-Problem bleibt bestehen (aus `meeting-notes` übernommen)

Das unter `projects/meeting-notes/PROJECT.md → Offene Probleme` dokumentierte Proxy-Problem gilt für diese Variante **sinngemäß gleich**:
- Native Azure-SDK nutzt `setProxy()`-Properties im Node-Pfad nicht zuverlässig für WSS-Connect.
- Im C#-Pfad verhält sich die native Speech-SDK (NuGet) tendenziell etwas kooperativer, aber die genaue Garantie muss in `specs/T-505-proxy-aware-azure-transport.md` für die C#-Variante neu validiert werden.
- Workaround-Plan (Variante 3: Eigenbau eines WSS-Clients) wird in `specs/T-505` mit C#-Code-Skeleton skizziert.

### Bekannte Nebensymptome (aus `meeting-notes` übernommen)
- DNS-Filterung auf Custom-Endpoints in Corporate-Netzen.
- `https-proxy-agent` als möglicher Ersatz evaluiert, nicht eingebaut.

## Migration aus `meeting-notes` (Schritt-für-Schritt-Plan)

Der Migrationsplan ist bewusst **inkrementell** aufgebaut, sodass `meeting-notes` jederzeit lauffähig bleibt und dieses Projekt nie aus dem Nichts entsteht:

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
## Session Log
- 25.06.2026, 22:30 UTC: Projektordner `meeting-notes-tauri` angelegt (`PROJECT.md`, `README.md`, `DECISIONS.md`, `SPEC-v0.1.md`, `specs/T-*.md`).
- 25.06.2026, 22:30 UTC: Architekturziel dokumentiert (Tauri 2 + C#-Sidecar mit Azure Speech SDK in NuGet-Form).
- 25.06.2026, 22:30 UTC: Migration in 5 Phasen geplant; Phase 0 (Doku) abgeschlossen, Phase 1 ff. warten auf Nutzer-Freigabe.