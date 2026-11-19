# Project: Meeting Notes

## Zweck und Dokumentationspflege

Diese Datei ist der kompakte Einstieg fuer Agenten: aktueller Projektstand,
Arbeitsregeln und Verweise auf die fachlichen Details. Keine Session-Logs,
Aenderungschronik, historischen Build-Messungen oder Migrationsanleitungen hier pflegen.

- [SPEC.md: Spec-Index](./SPEC.md#spec-index) ist der zentrale Einstieg zu allen Tasks.
- Anforderungen, Implementierungsdetails, Aenderungshistorie, Testbelege und offene
  Abnahmen stehen in den jeweils zustaendigen [Specs](./specs/). Zusammenhaengende
  Specs direkt untereinander verlinken, statt Inhalte zu duplizieren.
- [SPEC.md](./SPEC.md) fasst im Abschnitt **Stand der Specs** offene
  Punkte zusammen; diesen Abschnitt mit `npm run docs:specs` generieren, nicht manuell pflegen.
- [DECISIONS.md](./DECISIONS.md) dokumentiert Architekturentscheidungen und Begruendungen;
  [CHANGELOG.md](./CHANGELOG.md) die veroeffentlichten Versionsaenderungen.
- [README.md](./README.md) beschreibt Installation, Bedienung und Entwicklung;
  [docs/README.md](./docs/README.md) die Screenshots und ihre Aussagegrenzen.
- Bei Aenderungen die betroffene Spec aktualisieren. Abgehakte Punkte brauchen
  einen konkreten Beleg, offene Punkte einen Grund. Historische Nachweise als
  solche erhalten; sie sind keine Aussage ueber den aktuellen Stand.

## Aktueller Produktstand

- **Meeting Notes**, Version **0.1.2**, ist eine portable Windows-11-x64-Anwendung
  fuer Live-Transkripte mit Azure Speech. Implementierung vorhanden; offene
  Live-/Hardware-/Zielsystem-Abnahmen sind in den Specs ausgewiesen.
- Mikrofon, Speaker-Loopback oder beide Quellen sind waehlbar. Sprechererkennung
  ist je Quelle unabhaengig konfigurierbar; mindestens eine Transkriptionsquelle
  bleibt aktiv. Siehe [T-511](./specs/T-511-transkriptions-quellen-auswaehlen.md).
- **Pause/Weiter** erhaelt die Azure-Sitzung ohne Audiozufuhr. **Stop** beendet sie;
  der naechste Start beginnt ein neues Transkript. Sprecheraliase und Segment-Merge
  sind sitzungsgebunden. Siehe [T-507](./specs/T-507-pause-stop-und-sitzungsgebundene-sprecherzuordnung.md).
- Automatischer Start beobachtet lokale Core-Audio-Sessions erlaubter Prozesse,
  ohne Kalender. Auto-Stop betrifft nur die passend automatisch gestartete Aufnahme.
  `user.autoStart.enabled` und `user.autoStart.autoStop` sind standardmaessig aktiv;
  gespeichertes `false` bleibt erhalten. Die Erkennung ist eine Heuristik.
  Siehe [T-513](./specs/T-513-automatische-meeting-erkennung-und-auto-start.md).
- Schliessen verbirgt das Fenster standardmaessig im Systray, ohne Aufnahme oder
  Detektor zu stoppen. **Beenden** beendet die App. Siehe [T-514](./specs/T-514-systray-und-schliessen-verhalten.md).
- Einstellungen stehen auf einer scrollenden Seite: **Allgemein**, **Audio**,
  **Azure**, **Proxy**. Audiooptionen im Leerzustand werden sofort gespeichert;
  der Dialog speichert explizit. Siehe [T-403](./specs/T-403-settings-dialog-mit-verbindung-testen-button.md).
- Automatischer Markdown-Export ist standardmaessig aktiv; Datei und Clipboard
  nutzen denselben Builder mit YAML-Frontmatter. Siehe [T-506](./specs/T-506-transkript-markdown-export-und-frontmatter.md).
- HTTPS- und native Speech/WSS-Diagnose sind getrennte Pruefungen mit aktiver
  TLS-Zertifikatsvalidierung. Der native Firmenproxy-Pfad ist erfolgreich abgenommen;
  kein eigener WSS-Workaround erforderlich. Siehe [T-304](./specs/T-304-connectivity-diagnose-in-rust.md)
  und [T-306](./specs/T-306-proxy-aware-azure-transport.md).

## Architektur und Code-Orientierung

| Bereich | Aktuelle Verantwortung | Einstieg |
|---|---|---|
| [src/renderer/](./src/renderer/) | React 19, TypeScript 7, Vite 8; Console-UI und App-State | [T-402](./specs/T-402-ui-komponenten-portieren.md) |
| [src/preload/](./src/preload/) und [src/shared/](./src/shared/) | Typisierte Tauri-Bridge und gemeinsame Vertraege | [T-102](./specs/T-102-ipc-vertrag-zwischen-renderer-und-rust.md), [T-401](./specs/T-401-tauri-preload-bridge.md) |
| [src-tauri/src/](./src-tauri/src/) | Tauri 2/Rust; Fenster, Tray, Orchestrierung, Persistenz, HTTPS-Diagnose | [T-300](./specs/T-300-tauri-main-als-orchestrator.md) |
| [sidecar/](./sidecar/) | C#/.NET 10; WASAPI/NAudio 3.3, Resampling, Azure Speech SDK, Meeting-Erkennung | [T-200](./specs/T-200-c-sharp-sidecar-architektur-audio-und-azure.md), [T-509](./specs/T-509-audio-capture-auf-wasapirecorderbuilder-umstellen.md) |
| [scripts/](./scripts/) und [tests/](./tests/) | Build, Portable-Packing, Verifikation und Regressionstests | [T-500](./specs/T-500-qualitaetssicherung-und-akzeptanztests.md), [T-503](./specs/T-503-distribution-und-build-skripte.md) |

Renderer und Rust kommunizieren per `invoke`/`listen`. Rust und Sidecar nutzen
JSON-Lines ueber stdin/stdout mit `tauri-plugin-shell`; Protokollversion **1.0.0**.
Audio bleibt im Sidecar und geht von dort direkt an Azure, nicht ueber IPC.
Kein automatischer Reconnect mit neuer Azure-Sitzung. Siehe [T-201](./specs/T-201-json-lines-protokoll-tauri-zu-sidecar.md).

## Konfiguration und Distribution

- Eine Datei `MeetingNotes.config.json` mit `azure` und `user` (siehe
  [Beispielconfig](./MeetingNotes.config.example.json)): im Release neben der EXE, in Entwicklung im Repository-Root,
  unabhaengig vom Arbeitsverzeichnis. Kein AppData-Fallback. Zugangsdaten liegen
  im Klartext; persoenliche Config, Transkripte und Credentials nicht committen
  oder mit Releases verteilen. Siehe [T-103](./specs/T-103-konfiguration-azure-und-user-settings.md)
  und [T-305](./specs/T-305-settings-persistenz-im-tauri-main.md).
- Portable: `MeetingNotes.exe`, `MeetingNotes.Sidecar.exe`, Config-Template und
  `SHA256SUMS` im selben Ordner. Sidecar ist self-contained, Single-File,
  komprimiert und konservativ getrimmt; Zielsystem braucht WebView2, keine
  separate .NET-Installation. Siehe [T-504](./specs/T-504-portable-build.md)
  und [T-512](./specs/T-512-sidecar-targetframeworks-und-single-file.md).
- Builds fuer Veroeffentlichungen laufen nur bei `v*`-Tags oder manuellem
  Release-Workflow, **nicht** bei normalen Pushes oder Pull Requests.
  Siehe [T-515](./specs/T-515-github-actions-pipeline-und-release.md).

## Arbeiten und Verifizieren

- Ausschliesslich Windows 11/x64; keine macOS-, Linux-, Mobile- oder
  Bluetooth-Unterstuetzung vorbereiten. Lieferweg ist Portable; kein
  Code-Signing oder Installer-Ausbau im aktuellen Scope.
- Nur dieses Repository bearbeiten. Hintergrund und historische Schritte der
  Migration stehen in [T-100](./specs/T-100-tauri-migration-planen-und-grundstruktu.md)
  und [T-104](./specs/T-104-migrationsplan-was-bleibt-was-wandert.md), nicht hier.
- Bestehende Vertraege zwischen TypeScript, Rust, C# und
  [Beispielconfig](./MeetingNotes.config.example.json) konsistent halten.
- Verfuegbare Befehle und Versionen stehen in [package.json](./package.json),
  [Cargo.toml](./src-tauri/Cargo.toml) und [Sidecar-Projekt](./sidecar/MeetingNotes.Sidecar.csproj).

| Zweck | Befehl |
|---|---|
| Renderer entwickeln | `npm run tauri -- dev` |
| Typecheck / Node-Regressionen | `npm run typecheck` / `npm run test:unit` |
| Rust-Tests | `cargo test --manifest-path src-tauri\Cargo.toml` |
| C#-Validierung | `npm run test:sidecar` |
| Spec-Uebersicht / Konsistenz | `npm run docs:specs` / `npm run check:specs` |
| Gesamtpruefung inkl. Release und Portable | `npm run verify -- --full` |

`cargo build --release` ist nur ein Compile-Check: der Auslieferungsweg muss
`npm run tauri -- build --no-bundle` verwenden, damit Renderer-Assets eingebettet
sind. Danach Portable packen und Smoke/Deployment pruefen; der Gesamtpruefer
erledigt diese Reihenfolge. Rust-Tests separat ausfuehren.

Hardware-, Azure-, native UI- und Clean-Machine-Abnahmen nicht durch Unit-Tests
oder Renderer-Screenshots als bestanden ausweisen. Verfuegbarkeit von Desktop,
Audiogeraeten und Credentials jeweils pruefen, nicht aus frueheren Sessions ableiten.
Offene Abnahmen und Messverfahren: [T-500](./specs/T-500-qualitaetssicherung-und-akzeptanztests.md),
[T-502](./specs/T-502-latency-messung.md), [T-510](./specs/T-510-clean-machine-deployment-windows-11.md).

Repository: [schirkan/meeting-notes-tauri](https://github.com/schirkan/meeting-notes-tauri),
Standard-Branch `main`, Lizenz [MIT](./LICENSE). Aufgaben werden in den Specs
gefuehrt; kein Workboard.
