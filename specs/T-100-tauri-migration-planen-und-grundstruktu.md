# T-100: Tauri-Migration planen und Grundstruktur festziehen

## Kontext
Status: draft
Priorität: high
Subtasks: T-101, T-102, T-103, T-104
Abhängigkeiten: -

## Goal
Umsetzbaren technischen Rahmen für die Tauri-Variante von Meeting Notes festziehen (Ordnerstruktur, Verträge, Konfiguration, Migrationsstrategie).

## Done When
- [ ] Projektstruktur für `src/` (Renderer), `src-tauri/` (Rust-Main), `sidecar/` (C#) ist dokumentiert und im Repo angelegt.
- [ ] Tauri-IPC-Vertrag ist versioniert und für Renderer + Rust-Main eindeutig.
- [ ] Konfigurationsquellen und Persistenzpfad sind festgelegt.
- [ ] Migrationsplan aus `PROJECT.md` ist mit Subtasks verlinkt.

## Approach
- Subtasks T-101 bis T-104 zuerst abschließen.
- Bestehende Strukturen aus `../meeting-notes/` als Vorlage verwenden, nur dort ändern, wo es die Tauri-Architektur erzwingt.
- Offene Architekturfragen in `SPEC-v0.1.md` und `DECISIONS.md` synchron halten.

## Log
- 2026-06-25: Spec angelegt.