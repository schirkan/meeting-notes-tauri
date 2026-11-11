# T-506: Transkript-Markdown-Export mit Frontmatter

## Kontext
Status: implemented
Priorität: medium
Abhängigkeiten: T-305, T-403

## Goal
Das Transkript soll als Markdown-Datei mit YAML-Frontmatter automatisch gespeichert werden. Der Zielpfad ist optional; ohne Angabe landet die Datei im Anwendungsverzeichnis. Dieselbe Datei mit Frontmatter entsteht beim Kopieren in die Zwischenablage.

## Done When
- [x] **Eine** Konfigurationsdatei `meeting-notes.config.json` liegt direkt neben der EXE (Release/Portable) bzw. im Repository-Root (Dev). Der frühere `config/`-Ordner mit `azure.json` und `user-settings.json` ist entfallen. Siehe [T-103](./T-103-konfiguration-azure-und-user-settings.md) und [T-305](./T-305-settings-persistenz-im-tauri-main.md).
- [x] Die Datei enthält zwei Abschnitte: `azure` (Endpoint, Region, Speech-Key, Interim-Results, Proxy) und `user` (Sprache, Devices, Diarization, Transcript-Optionen). Beim Speichern wird nur der geänderte Abschnitt ersetzt — das Speichern der Azure-Konfiguration verwirft die User-Settings nicht und umgekehrt.
- [x] Ein fehlerhafter Abschnitt verfällt nicht über den anderen: fehlt oder ist `azure` ungültig, bleiben die User-Settings erhalten (und umgekehrt).
- [x] Das Frontmatter enthält die Metadaten der Sitzung: `title`, `date`, `start`, `end`, `duration`, `language`, `segments` und die Liste der `speakers`. Der Body enthält ausschließlich finale Segmente als Markdown-Liste (`- [HH:MM:SS] Sprecher (Sprache): Text`).
- [x] Clipboard-Kopie und Datei-Export erzeugen **identische** Dokumente. Beide nutzen das gemeinsame Modul [transcript-markdown.ts](../src/shared/transcript-markdown.ts).
- [x] Neue Option **Transkript automatisch als Markdown speichern** im Bereich **Allgemein** des Settings-Dialogs (standardmäßig aktiv). Zusätzlich ein optionales Feld **Speicherpfad**: leer bedeutet Anwendungsverzeichnis, relative Pfade werden gegen das Anwendungsverzeichnis aufgelöst, absolute Pfade bleiben absolut.
- [x] Der Export läuft automatisch, sobald die Aufnahme endet. Final-Segmente, die nach dem Status-Event eintreffen, werden mit einem kurzen Nachlauf (500 ms) noch erfasst.
- [x] Der Dateiname lautet `transcript-<JJJJ-MM-TT-hh-mm-ss>.md`. Geschrieben wird atomar (Temp-Datei + Rename).
- [x] Der Pfad des geschriebenen Files wird als Toast zurückgemeldet.

## Approach
- Das Markdown-Dokument entsteht im Renderer, geschrieben wird es im Rust-Backend. Der Renderer kennt die Segmente und die Sprecher-Aliase; das Backend kennt das Anwendungsverzeichnis und den konfigurierten Zielpfad. So bleibt die Formatierung an einer Stelle und die Pfadauflösung an einer anderen.
- Rust-Command `save_transcript_markdown(markdown)` legt das Zielverzeichnis an, ermittelt den Dateinamen aus der lokalen Zeit und schreibt atomar. Der Zielordner ergibt sich aus `user.transcript.markdownExport.path` oder, wenn dieser fehlt, aus dem Anwendungsverzeichnis.
- Frontmatter-Werte werden als YAML-Strings quotiert; die Sprecherliste ist ein YAML-Block. Werte mit Sonderzeichen brechen das Dokument nicht.
- Die User-Settings wachsen um `transcript.markdownExport` mit `enabled` (Default `true`) und `path` (Default `null`). Fehlende Felder in älteren Konfigurationen werden je Feld normalisiert, ein explizit gespeichertes `false` bleibt erhalten.

## Log
- 2026-11-11: Spec angelegt und umgesetzt. Eine Konfigurationsdatei neben der EXE, Frontmatter-Export mit optionalem Pfad, Clipboard und Datei teilen denselben Builder. Verifiziert: 46 Node-Tests, 15 Rust-Tests, TypeScript- und .NET-Build grün.
