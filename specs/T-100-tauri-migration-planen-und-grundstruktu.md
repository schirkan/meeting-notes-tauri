# T-100: Tauri-Migration planen und Grundstruktur festziehen

## Kontext
Status: umgesetzt
Priorität: high
Subtasks: T-101, T-102, T-103, T-104
Abhängigkeiten: -

## Goal
Umsetzbaren technischen Rahmen für die Tauri-Variante von Meeting Notes festziehen (Ordnerstruktur, Verträge, Konfiguration, Migrationsstrategie).

## Done When
- [x] Projektstruktur für `src/` (Renderer), `src-tauri/` (Rust-Main), `sidecar/` (C#) ist dokumentiert und im Repo angelegt. Beleg: Verzeichnisstruktur in AGENTS.md und README.md dokumentiert.
- [x] Tauri-IPC-Vertrag ist versioniert und für Renderer + Rust-Main eindeutig. Beleg: src/shared/tauri-contract.ts und src/shared/transcript-contract.ts.
- [x] Konfigurationsquellen und Persistenzpfad sind festgelegt. Beleg: src-tauri/src/settings.rs und eine Config-Datei neben der EXE.
- [x] Migrationsplan aus `AGENTS.md` ist mit Subtasks verlinkt. Beleg: AGENTS.md verweist auf die Specs T-100 bis T-510.

## Approach
- Subtasks T-101 bis T-104 zuerst abschließen.
- Bestehende Strukturen aus `../meeting-notes/` als Vorlage verwenden, nur dort ändern, wo es die Tauri-Architektur erzwingt.
- Offene Architekturfragen in `SPEC.md` und `DECISIONS.md` synchron halten.

## Log
- 2026-06-25: Spec angelegt.