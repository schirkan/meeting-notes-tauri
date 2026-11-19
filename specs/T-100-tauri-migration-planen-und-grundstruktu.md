# T-100: Tauri-Migration planen und Grundstruktur festziehen

## Kontext
Status: umgesetzt
Priorität: high
Subtasks: [T-101](./T-101-tauri-2-scaffold-mit-react-und-vite.md), [T-102](./T-102-ipc-vertrag-zwischen-renderer-und-rust.md), [T-103](./T-103-konfiguration-azure-und-user-settings.md), [T-104](./T-104-migrationsplan-was-bleibt-was-wandert.md)
Abhängigkeiten: -

## Goal
Umsetzbaren technischen Rahmen für die Tauri-Variante von Meeting Notes festziehen (Ordnerstruktur, Verträge, Konfiguration, Migrationsstrategie).

## Done When
- [x] Projektstruktur für `src/` (Renderer), `src-tauri/` (Rust-Main), `sidecar/` (C#) ist dokumentiert und im Repo angelegt. Beleg: Verzeichnisstruktur in AGENTS.md und README.md dokumentiert.
- [x] Tauri-IPC-Vertrag ist versioniert und für Renderer + Rust-Main eindeutig. Beleg: src/shared/tauri-contract.ts und src/shared/transcript-contract.ts.
- [x] Konfigurationsquellen und Persistenzpfad sind festgelegt. Beleg: src-tauri/src/settings.rs und eine Config-Datei neben der EXE.
- [x] Migrationsplan ist mit Subtasks verlinkt. Beleg: Abschnitt Historischer Migrationsrahmen dieser Spec, verlinkte Subtasks und zentraler Spec-Index in SPEC.md; AGENTS.md verweist auf diese Einstiege.

## Approach
- Subtasks T-101 bis T-104 zuerst abschließen.
- Bestehende Strukturen aus `../meeting-notes/` als Vorlage verwenden, nur dort ändern, wo es die Tauri-Architektur erzwingt.
- Offene Architekturfragen in `SPEC.md` und `DECISIONS.md` synchron halten.

## Historischer Migrationsrahmen

Dieser Abschnitt bewahrt den Hintergrund und den urspruenglichen Plan aus
[AGENTS.md](../AGENTS.md); er beschreibt keine noch auszufuehrende Migration.
Aktueller Produktstand und Arbeitsregeln stehen dort, die vollstaendige Navigation
im [Spec-Index](../SPEC.md#spec-index).

Ausgangspunkt war die Electron-Anwendung `../meeting-notes/`: ca. 180 MB
Portable-Groesse und eine verteilte Pipeline aus C#-Audio-Capture, Named-Pipe-
Transport und Azure Speech im Node-Main. Ziel war ein kleinerer Windows-Container
mit WebView2 sowie Audio und Azure Speech gemeinsam im C#-Sidecar. Rust erhaelt
nur fertige Transkript-/Statusereignisse, keine PCM-Frames.

Der Entwurf vom 25.06.2026 sah folgende Schritte vor:

1. **Phase 0: Dokumentation und Vertraege.** Projektstruktur, Architektur und
   Konfiguration festlegen ([T-101](./T-101-tauri-2-scaffold-mit-react-und-vite.md),
   [T-102](./T-102-ipc-vertrag-zwischen-renderer-und-rust.md),
   [T-103](./T-103-konfiguration-azure-und-user-settings.md)).
2. **Phase 1: Sidecar-Konsolidierung.** Azure Speech von Node nach C# verschieben,
   im urspruenglichen Entwurf zunaechst innerhalb der Electron-Anwendung
   ([T-200](./T-200-c-sharp-sidecar-architektur-audio-und-azure.md),
   [T-204](./T-204-azure-speech-sdk-integration-im-sidecar.md)).
3. **Phase 2: Tauri-Grundgeruest.** React/Vite anbinden, Bridge und Sidecar-Spawn
   auf Tauri umstellen ([T-101](./T-101-tauri-2-scaffold-mit-react-und-vite.md),
   [T-301](./T-301-sidecar-spawn-via-shell-plugin.md),
   [T-401](./T-401-tauri-preload-bridge.md)).
4. **Phase 3: Feature-Paritaet.** Oberflaeche und gemeinsame Vertraege portieren;
   Modul-Mapping in [T-104](./T-104-migrationsplan-was-bleibt-was-wandert.md),
   Frontend in [T-400](./T-400-react-frontend-auf-tauri-portieren.md).
5. **Phase 4: Validierung.** Smoke-Test, Latenz und Portable pruefen
   ([T-500](./T-500-qualitaetssicherung-und-akzeptanztests.md),
   [T-501](./T-501-smoke-test-tauri-und-sidecar.md),
   [T-502](./T-502-latency-messung.md), [T-504](./T-504-portable-build.md)).

Die urspruengliche Phase 5 (Abschaltung des Electron-Projekts) wurde gestrichen:
das Quellprojekt bleibt unveraenderte Referenz. Seit der Fortschreibung vom
09.11.2026 erfolgen Produktarbeiten ausschliesslich in diesem Tauri-Repository.
Die urspruenglich geplante 1:1-Darstellung wurde durch das Console-Design ersetzt;
siehe [T-402](./T-402-ui-komponenten-portieren.md). Die Implementierung ist vorhanden;
verbleibende Akzeptanzpunkte stehen in den Fach-Specs, nicht in diesem historischen Plan.

## Querverweise
- [Spec-Index](../SPEC.md#spec-index) und [Agenten-Einstieg](../AGENTS.md).
- [T-104: Modul-Mapping](./T-104-migrationsplan-was-bleibt-was-wandert.md).
- [Architekturentscheidungen](../DECISIONS.md): Windows-only, stdin/stdout-IPC
  und Sidecar-Publish; Begruendungen nicht im Agenten-Einstieg duplizieren.

## Log
- 2026-06-25: Spec angelegt.