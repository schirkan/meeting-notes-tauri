# Decisions — meeting-notes-tauri

Architekturentscheidungen für die Tauri-Migration. Wird fortlaufend ergänzt, wenn weitere Fragen auftauchen.

---

## AD-001 · Tauri 2 statt Electron (2026-06-25)

**Kontext:** Der bestehende Electron-Build ist ~180 MB groß, davon ~150 MB Electron-Runtime. Das schmälert die Distribution und das Image als „kleines Tool".

**Entscheidung:** Wir migrieren den App-Container zu **Tauri 2**. Der Renderer bleibt React + Vite, das System-WebView (WebView2 auf Windows 11) wird genutzt.

**Begründung:**
- Build-Größe: realistisches Ziel ~15–30 MB statt 180 MB (≈ 90 % kleiner).
- Tauri 2 ist 2026 produktionsreif für Desktop (Windows/macOS/Linux).
- Native IPC-API in Rust ist typsicher; das Befehlsystem (`tauri::command`) bietet ein vorhersehbares Promise-Modell für den Renderer.

**Alternativen, die verworfen wurden:**
- **Deno Desktop** — noch Preview (Q3/2026), keine Größenvorteile heute.
- **Neutralino.js** — kein C#-Sidecar-Modell, kein natives Audio-Capture ohne Brücken.
- **WinUI 3 pur** — bereits in `projects/meeting-notes-winui` evaluiert; wäre ein größerer UI-Refactor und Windows-only noch stärker, ohne Mobile-Option.
- **Bei Electron bleiben** — keine Lösung des Größenproblems.

---

## AD-002 · Azure Speech SDK komplett in den C#-Sidecar (2026-06-25)

**Kontext:** Heute läuft Audio-Capture im C#-Sidecar, Azure Speech SDK im Node-Main (`microsoft-cognitiveservices-speech-sdk`). Audio-Frames werden via Named Pipe vom Sidecar in den Main übertragen, der sie in die Azure-PushStream einspeist.

**Entscheidung:** Wir verlagern das Azure Speech SDK in den C#-Sidecar (NuGet `Microsoft.CognitiveServices.Speech`). Audio und Speech laufen damit in einem Prozess. Der Tauri-Main (Rust) empfängt nur noch **fertige Transkript-Events** per JSON-Lines über **stdin/stdout** (siehe AD-008).

**Begründung:**
- **Latenz:** Kein Pipe-Marshalling der PCM-Frames zwischen Prozessen mehr.
- **Konsistenz:** Ein einziger nativer Stack für Audio + Speech.
- **Sprachliche Konsistenz:** Martin hat 20+ Jahre C#-Erfahrung — die gesamte Native-Logik liegt jetzt in der Sprache, in der er am produktivsten ist.
- **First-Party-SDK:** Das C#-Azure-Speech-SDK ist offiziell von Microsoft und das reifste Client-SDK.
- **Geringer Migrationsaufwand:** Der C#-Sidecar existiert bereits; das Hinzufügen eines NuGet ist eine Zeile XML.

**Alternativen, die verworfen wurden:**
- **Azure Speech in Rust (Tauri-Main)** — Es gibt **kein offizielles Microsoft-Rust-SDK**. Community-Wrapper basieren auf dem C-SDK oder REST (kein Streaming); Aufwand 2–4 Wochen für eine „gerade-so"-Lösung.
- **Azure Speech in Node Sidecar (via `bun build --compile`)** — Funktioniert (Node-SDK ist first-party), aber: Node-Runtime adds ~40 MB, verliert tiefe Windows-Audio-Kontrolle.
- **Hybrid: NAudio in C#, Speech in Node Sidecar** — Zwei Sidecars, Audio-IPC zurück — schlimmer als Status quo.

---

## AD-003 · JSON-Lines als IPC-Protokoll (2026-06-25)

**Kontext:** Im Electron-Projekt wird zwischen C#-Sidecar und Node-Main ein **Binär-Frame-Protokoll** (36-B-Header + PCM-Payload) auf einer Named Pipe verwendet. Dieses Protokoll wird durch AD-002 obsolet: Audio-Frames müssen nicht mehr über die Prozessgrenze.

**Entscheidung:** Wir ersetzen das Binär-Protokoll durch **JSON-Lines** (1 JSON-Objekt pro Zeile, Newline-getrennt). Der Transport ist **stdin/stdout** zwischen Sidecar und Tauri-Main (siehe AD-008) — keine Named Pipe mehr. Datenfluss ist bidirektional: Sidecar sendet Status/Events/Transkripte auf stdout, App sendet Commands/Settings auf stdin.

**Begründung:**
- **Einfachheit:** Kein eigener Parser für Header/CRC/Magic/Sample-Rate nötig. JSON-Lines ist in C# (`System.Text.Json`) und Rust (`serde_json`) trivial.
- **Lesbarkeit:** Debug-Logs können den stdout-Stream direkt auf der Konsole mitschreiben.
- **Wartbarkeit:** Wenn sich Events ändern, ändert sich nur das TypeScript-Shared-Contract-Modul.
- **Bewährtes Muster:** Wird u. a. von npm, VS Code und dem Azure-Dev-Tunnel-Client verwendet.

**Alternativen, die verworfen wurden:**
- **gRPC** — Overkill, größere Toolchain-Dependency, kein sichtbarer Nutzen bei dieser Event-Frequenz.
- **MessagePack** — kleiner als JSON, aber C#- und Rust-Stack bringen beide schon `serde`/`System.Text.Json` mit — kein Größenproblem.
- **HTTP over localhost** — Funktioniert, aber `stdin/stdout` über `tauri-plugin-shell` ist performanter und von Tauri bereits gemanagt.

---

## AD-004 · Bestehende Electron-Komponenten 1:1 portieren (2026-06-25)

**Kontext:** Das bestehende Electron-Projekt hat ein gut funktionierendes React-UI (Hero-Status, Transcript, Settings, Debug-Log, Speaker-Mapping, Auto-Scroll, Focus-Trap, Reset-Verhalten).

**Entscheidung:** Wir portieren die React-Komponenten **eins zu eins** und verstecken die Tauri-Bridge hinter dem bestehenden `transcript-contract.ts`-Modul.

**Begründung:**
- **Risikoarm:** Bewährte UX bleibt unverändert.
- **Effizient:** Spart eine komplette Design- und Accessibility-Runde.
- **Diff-freundlich:** Späterer Vergleich Electron ↔ Tauri wird trivial.

**Alternativen, die verworfen wurden:**
- **Komplettes UI-Redesign für Tauri** — kein sichtbarer Mehrwert; UX-Stabilität ist wichtiger.
- **Astro/Svelte/Solid statt React** — neue Toolchain ohne klaren Vorteil.

---

## AD-005 · Kein Mobile-Build (2026-06-25)

**Kontext:** Tauri 2 hat Mobile-Alpha-Support (iOS/Android). Martin hat den Use Case „nur Windows 11".

**Entscheidung:** Mobile-Build wird **bewusst nicht** in den Scope aufgenommen. iOS-Unterstützung in Tauri gilt Stand 06/2026 als nicht produktionsreif (vgl. Reddit-Konsens), Android ist Alpha.

**Begründung:**
- Fokus: kleine, schnelle, robuste Windows-11-App.
- Kein zukünftiger Aufwand für Build-Pipeline-Konfiguration für Plattformen, die nicht benötigt werden.
- Wenn Mobile später relevant wird: separat evaluieren.

---

## AD-006 · Sidecar-Verteilung: framework-dependent EXE + Tauri-Resource (2026-06-25)

**Kontext:** Im Electron-Projekt wird der C#-Sidecar als framework-dependent EXE gebaut und als Resource mit `electron-packager` ausgeliefert. Zielsystem braucht nur die .NET Runtime.

**Entscheidung:** Wir behalten dieses Modell bei. Der C#-Sidecar wird weiterhin per `dotnet publish -c Release -r win-x64 --self-contained false` gebaut und liegt unter `sidecar/publish/sidecar/`. Tauri 2 bindet das EXE über `tauri.conf.json → bundle.resources` ein.

**Begründung:**
- Kleinste Bundle-Größe (Sidecar-EXE ~30 MB inkl. Speech-Native-Binaries, statt ~80 MB self-contained).
- Zielsystem-Voraussetzung bleibt einfach: .NET 8 Runtime.
- Tauri-Resource-System ist gut dokumentiert und für genau diesen Use Case gedacht.

---

## AD-007 · Schritt-für-Schritt-Migration, kein Big-Bang (2026-06-25)

**Kontext:** Migration eines funktionierenden Projekts birgt das Risiko, beide Projekte gleichzeitig kaputtzumachen.

**Entscheidung:** Die Migration erfolgt in 4 Phasen (siehe `PROJECT.md → Migration aus meeting-notes`). Phase 0 (Doku) ist abgeschlossen; Phase 1 startet erst nach Nutzer-Freigabe. Phase 1 verändert **zunächst nur `meeting-notes`**, nicht dieses Projekt.

**Update 2026-06-25:** Phase 5 (Decommission `meeting-notes`) wurde gestrichen. Das Electron-Projekt bleibt dauerhaft als Referenz bestehen — die Variante wird also **parallel** weitergepflegt, nicht abgelöst.

**Begründung:**
- `meeting-notes` bleibt während der gesamten Migration lauffähig.
- Phase 1 ist ein **Beweisstück**: Wenn Azure-Speech im C#-Sidecar funktioniert, ist der riskanteste Teil der Migration gelöst, bevor Tauri überhaupt ins Spiel kommt.

---

## AD-008 · IPC via stdin/stdout über tauri-plugin-shell (statt Named Pipe) (2026-06-25)

**Kontext:** AD-003 hatte Named Pipe als Transport zwischen Sidecar und Tauri-Main festgelegt. Mit AD-002 (Sidecar-Konsolidierung) gehen **keine Audio-Frames mehr über die Prozessgrenze** — die Named Pipe wäre nur noch ein dünner Event-Channel. Gleichzeitig bietet Tauri 2 mit `tauri-plugin-shell` (`Command::new_sidecar`) genau für diesen Use Case eingebaute stdin/stdout-Pipes an.

**Entscheidung:** Wir nutzen **stdin/stdout** über `tauri-plugin-shell` für die Sidecar-IPC. Named Pipe entfällt komplett.
- **stdout** (Sidecar → App): Events, Status, Debug-Logs (JSON-Lines)
- **stdin** (App → Sidecar): Commands, Settings-Updates (JSON-Lines)
- **stderr**: Sidecar-interne Diagnose-Logs (optional für Debug)

**Begründung:**
- **Idiomatisch für Tauri 2:** Der `Command::new_sidecar`-Mechanismus ist exakt für diesen Use Case gemacht — kein Kampf gegen das Framework.
- **Weniger Code:** ~150 Zeilen Boilerplate entfallen (`NamedPipeServerStream` in C#, `tokio::net::windows::named_pipe` in Rust).
- **Bidirektional out-of-the-box:** stdin/stdout sind natürlich bidirektional; Named Pipe bräuchte zwei separate Server.
- **Tauri-Lifecycle:** Tauri managt Process-Spawn, Buffering, Reconnects, Crash-Detection nativ.
- **Debug-Komfort:** `npm run dev` zeigt Sidecar-stdout/-stderr direkt im Terminal.
- **Konsolen-Pop-up beherrschbar:** Über `creation_flags = CREATE_NO_WINDOW` in `T-301` und Newline-Flushing im C#-Sidecar.

**Alternativen, die verworfen wurden:**
- **Named Pipe (alter AD-003-Stand):** Funktioniert sicher, aber redundante Komplexität — Audio-Frames gehen längst nicht mehr über IPC, also fehlt der Pipe-Use-Case.
- **TCP/Unix-Domain-Socket:** Plattformspezifisch komplexer, kein Vorteil gegenüber stdin/stdout.
- **Shared-Memory-File mit File-Watcher:** Overkill für Event-Frequenz.

**Konsequenzen für bestehende ADs und Specs:**
- **AD-003** umgeschrieben: JSON-Lines bleibt, aber Transport wechselt zu stdin/stdout.
- **`specs/T-201`** wird komplett umgeschrieben (siehe aktuelle Fassung).
- **`specs/T-301`** verliert `--pipe-name`-CLI-Arg.
- **`specs/T-102`** Pipe-Handshake → stdin-Handshake.
- **`specs/T-200`** Named-Pipe-Erwähnungen entfernt.
- **Architektur-Diagramm** in `PROJECT.md` und Tech-Stack-Tabelle aktualisiert.

---

## AD-009 · Sidecar-Publish via `src-tauri/build.rs` (statt manuelles npm-Skript) (2026-06-26)

**Kontext:** Vor diesem AD musste vor jedem `tauri build` / `tauri dev` manuell `npm run publish:sidecar` aufgerufen werden, sonst traf die Tauri-Bundler-Stage auf ein leeres `sidecar/publish/sidecar/` und der Bundle-Resources-Glob `../sidecar/publish/sidecar/*` resolved zu nichts. Das war ein klassischer Stolperdraht für Erstkontakt mit dem Projekt und für CI.

**Entscheidung:** Das Sidecar-Publish wird in `src-tauri/build.rs` verlagert und damit zur Pflichtstufe des Cargo-Builds.
- Cargo ruft `build.rs` **vor** jeder Rust-Kompilation auf.
- `build.rs` mappt `CARGO_CFG_TARGET_OS` / `CARGO_CFG_TARGET_ARCH` auf den passenden .NET-RID (win-x64/win-arm64, osx-x64/osx-arm64, linux-x64/linux-arm64 vorbereitet) und `PROFILE` auf `Debug`/`Release`.
- `dotnet publish sidecar/MeetingNotes.Sidecar.csproj -c {config} -r {rid} --self-contained false -o ../sidecar/publish/sidecar` läuft dort synchron.
- `cargo:rerun-if-changed=../sidecar` sorgt dafür, dass nur bei Sidecar-Quelländerungen neu publisht wird.
- `tauri_build::build()` wird am Ende aufgerufen, sodass Capabilities-Check und Schema-Generation weiterhin stattfinden.
- Das `npm run publish:sidecar`-Skript bleibt als Opt-in für Ad-hoc-Rebuilds ohne Tauri-Build erhalten.

**Begründung:**
- **Ein-Befehl-Workflow:** `tauri build` reicht jetzt für Sidecar + Renderer + Tauri + Bundle. Erstkontakt und CI werden trivial.
- **Cargo-eigene Inkrementalität:** `cargo:rerun-if-changed` ist äquivalent zu `npm`-Watch-Skripten, nur näher an der Cargo-Toolchain und ohne zusätzliches Glied.
- **Klare Fehlerlokalisierung:** Fehlende `dotnet`-Toolchain oder nicht gemappte Zielplattform schlagen **vor** der Cargo-Resolve-Phase mit klaren Meldungen fehl (kein „warum sehe ich hier nichts?“-Debugging mehr).
- **Pattern etabliert:** Build-Skript-Konvention ist im Rust-Ökosystem Standard (siehe `exphert/TauriCS`-Template, `tonari/tlslite-ng`, …) und damit wiedererkennbar für neue Entwickler:innen.

**Alternativen, die verworfen wurden:**
- **`beforeBuildCommand` in `tauri.conf.json`:** Läuft vor `vite build`, aber vor `cargo build` läuft nur `build.rs` — wir hätten weiterhin zwei Stellen pflegen müssen.
- **Eigenes `cargo make`/`cargo xtask`-Taskfile:** Mehr Setup, weniger idiomatisch für ein einzelnes Sidecar.
- **Pre-Commit-Hook oder CI-Skript:** Hilft CI, aber nicht der lokalen Entwicklung.

**Konsequenzen für bestehende ADs und Specs:**
- **AD-006** (framework-dependent) bleibt unverändert — wir bauen weiterhin framework-dependent, nur **wer** es tut, ändert sich.
- **`specs/T-503`**, **`specs/T-207`** und **`README.md`** werden angepasst, sodass `publish:sidecar` nicht mehr als Voraussetzung erscheint.

**Validierung (Stand 2026-06-26):**
- `rm -rf sidecar/publish && npx tauri build --no-bundle` → grün, `build.rs` erzeugt Sidecar automatisch.
- Zweiter Build ohne Sidecar-Änderung → Sidecar-mtime unverändert, `build.rs` korrekt gecached.

---

## AD-010 · Clipboard-Copy im Renderer via `navigator.clipboard` (statt Tauri-Clipboard-Plugin) (2026-06-26)

**Kontext:** Das ursprüngliche Backend-Design (`specs/T-302`) sah einen Rust-Command `copy_transcript(segments: Vec<…>) -> Result<(), String>` vor, der mit `tauri-plugin-clipboard-manager::ClipboardExt::write_text` in die Zwischenablage schreibt. Im Zuge der ersten Build-Fixes hat sich herausgestellt, dass WebView2 (Chromium-Engine) `navigator.clipboard.writeText` nativ und ohne zusätzliches Plugin unterstützt — der Tauri-Umweg über das IPC-Backend ist redundant.

**Entscheidung:** Das Transkript-Clipboard-Format (`- [HH:MM:SS] speaker (lang): text` mit deutschem Metadaten-Header) wird direkt im Preload (`src/preload/index.ts`) gebaut und via `navigator.clipboard.writeText` geschrieben. Der Rust-Command `copy_transcript` entfällt komplett.
- `tauri-plugin-clipboard-manager` ist aus `Cargo.toml`, `lib.rs` und `capabilities/default.json` entfernt.
- `TAURI_COMMANDS.copyTranscript` ist aus `src/shared/tauri-contract.ts` entfernt.
- Die `TranscriptApi.copyTranscript(segments): Promise<void>`-Signatur bleibt unverändert, damit der Renderer-Code (`use-app-state.ts → onCopyTranscript`) ohne Anpassung weiterarbeitet.
- Hilfsfunktionen (`formatGermanClock`, `formatGermanDate`, `formatGermanTime`, `formatDuration`, `buildTranscriptText`) liegen jetzt im Preload-Modul.

**Begründung:**
- **Eine Schicht weniger:** Kein Rust-Roundtrip, kein Permission-Eintrag (`clipboard-manager:allow-write-text`), keine zusätzliche Cargo-Dependency.
- **Verhalten 1:1 identisch:** WebView2 implementiert `navigator.clipboard` exakt so wie der Browser; das Format-Byte-für-Byte-Mapping bleibt erhalten.
- **Weniger Surface:** Wenn jemand den Sidecar-Vertrag erweitert, muss er nicht gleichzeitig an eine Clipboard-Schnittstelle denken.

**Alternativen, die verworfen wurden:**
- **Tauri-Clipboard-Plugin beibehalten:** Kostet eine Dependency, einen Capability-Eintrag und einen Roundtrip pro Klick — kein Mehrwert in einer WebView2-App.
- **Browser-Fallback über `document.execCommand('copy')`:** Deprecated, würde aber ohnehin nur in HTTP-Kontext relevant — Tauri-Webview liefert eine HTTPS-äquivalente Origin.

**Konsequenzen für bestehende ADs und Specs:**
- **`specs/T-302`** verliert `copy_transcript` aus der Command-Liste (war ohnehin nur informell dort).
- **`PROJECT.md` Tech-Stack** verliert `tauri-plugin-clipboard-manager` (war nicht explizit aufgeführt, wird aber via Bereinigung deutlicher).

---

## Offene Fragen

| # | Frage | Status |
|---|---|---|
| OQ-1 | Soll der Sidecar-EXE-Name gleich bleiben (`MeetingNotes.Sidecar.exe`) oder umbenannt werden (`MeetingNotes.AudioService.exe` o. ä.)? | offen — wird in `specs/T-201` entschieden |
| OQ-2 | ~~Soll es eine **separate Named Pipe für Commands** geben oder gehen Commands via stdin an den Sidecar?~~ | **Entschieden 2026-06-25:** Named Pipe entfällt komplett. Commands gehen via stdin an den Sidecar, Events via stdout zurück. Siehe AD-008 und `specs/T-201`. |
| OQ-3 | Wo wird das Azure-Speech-Modell konfiguriert (Default vs. Custom-Speech)? Heute gibt es dafür keine UI. | unverändert zum `meeting-notes`-Stand: keine UI |
| OQ-4 | ~~Soll die Tauri-App macOS-/Linux-Builds vorbereiten oder hardcoded Windows-only sein?~~ | **Entschieden 2026-06-25:** Hardcoded Windows-only. macOS/Linux-Builds werden **nicht** vorbereitet — kein Cross-Compile, keine plattformneutralen Pfade in Build-/Run-Skripten, `tauri.conf.json` ohne `targets`-MacOS/Linux-Definition. |