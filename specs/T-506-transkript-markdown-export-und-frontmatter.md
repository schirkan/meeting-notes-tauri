# T-506: Transkript-Markdown-Export mit Frontmatter

## Kontext
Status: umgesetzt
Priorität: medium
Abhängigkeiten: T-305, T-403

## Goal
Das Transkript soll als Markdown-Datei mit YAML-Frontmatter automatisch gespeichert werden. Der Zielpfad ist optional; ohne Angabe landet die Datei im Anwendungsverzeichnis. Dieselbe Datei mit Frontmatter entsteht beim Kopieren in die Zwischenablage.

## Done When
- [x] **Eine** Konfigurationsdatei `MeetingNotes.config.json` liegt direkt neben der EXE (Release/Portable) bzw. im Repository-Root (Dev). Der frühere `config/`-Ordner mit `azure.json` und `user-settings.json` ist entfallen. Siehe [T-103](./T-103-konfiguration-azure-und-user-settings.md) und [T-305](./T-305-settings-persistenz-im-tauri-main.md). Beleg: src-tauri/src/settings.rs (Config neben der EXE, im Repository-Root im Dev-Build); Vorlage: MeetingNotes.config.example.json.
- [x] Die Datei enthält zwei Abschnitte: `azure` (Endpoint, Region, Speech-Key, Interim-Results, Proxy) und `user` (Sprache, Devices, Diarization, Transcript-Optionen). Beim Speichern wird nur der geänderte Abschnitt ersetzt — das Speichern der Azure-Konfiguration verwirft die User-Settings nicht und umgekehrt. Beleg: scripts/measure-latency-tauri.mjs (azure) (geprueft).
- [x] Ein fehlerhafter Abschnitt verfällt nicht über den anderen: fehlt oder ist `azure` ungültig, bleiben die User-Settings erhalten (und umgekehrt). Beleg: scripts/measure-latency-tauri.mjs (azure) (geprueft).
- [x] Das Frontmatter enthält die Metadaten der Sitzung: `title`, `date`, `start`, `end`, `duration`, `language`, `segments` und die Liste der `speakers`. Der Body enthält ausschließlich finale Segmente als Markdown-Liste (`- [HH:MM:SS] Sprecher (Sprache): Text`). Beleg: src/renderer/src/App.tsx (title), scripts/measure-latency-tauri.mjs (start), src/renderer/src/App.tsx (duration) (geprueft).
- [x] Clipboard-Kopie und Datei-Export erzeugen **identische** Dokumente. Beide nutzen das gemeinsame Modul [transcript-markdown.ts](../src/shared/transcript-markdown.ts). Beleg: src/shared/transcript-markdown.ts (buildTranscriptMarkdown) - Datei und Zwischenablage nutzen denselben Builder; im Node-Test abgedeckt.
- [x] Option **Transkript automatisch als Markdown speichern** im Bereich **Transkription** des Settings-Dialogs (standardmaessig aktiv). Zusaetzlich ein optionales Feld **Speicherpfad** mit nativem Ordner-Picker: leer bedeutet Anwendungsverzeichnis, relative Pfade werden gegen das Anwendungsverzeichnis aufgeloest, absolute Pfade bleiben absolut. Picker und manuelle Eingabe bearbeiten nur den temporaeren Dialog-Store; Persistenz erst durch **Speichern**, Verwerfen beim Schliessen siehe [T-403](./T-403-settings-dialog-mit-verbindung-testen-button.md). Abbrechen der Auswahl bewahrt den Draft-Pfad. Beleg: config-contract.ts, SettingsPanel.tsx und use-app-state.ts (onChooseTranscriptDirectory); Regression `export folder picker preserves cancellation and saves the selected folder`.
- [x] Der Export läuft automatisch, sobald die Aufnahme endet. Final-Segmente, die nach dem Status-Event eintreffen, werden mit einem kurzen Nachlauf (500 ms) noch erfasst. Beleg: src/renderer/src/use-app-state.ts (Export beim Stopp) und src-tauri/src/commands.rs (save_transcript_markdown).
- [x] Der Dateiname lautet `transcript-<JJJJ-MM-TT-hh-mm-ss>.md`; bei Namenskollision erhaelt er einen eindeutigen Suffix. Geschrieben wird atomar (Temp-Datei + Rename). Beleg: `write_transcript_markdown` in settings.rs.
- [x] Bestaetigtes **Quit** bei offener Sitzung speichert unabhaengig von **Save transcript automatically**. Ohne finale Segmente entsteht keine Datei. Beleg: die drei Chromium-Regressionen `Quit export` pruefen spaete finale Segmente mit Alias, Schreiben vor Quittierung, Fehler mit Wiederholung, gemeinsame laufende Schreiboperation und eine Sitzung mit nur Interim-Segmenten. Native Abnahme siehe [T-514](./T-514-systray-und-schliessen-verhalten.md).
- [x] Der Pfad des geschriebenen Files wird als Toast zurückgemeldet. Auch beim manuellen Export bleibt ein Schreibfehler sichtbar und veraendert das Transkript nicht. Beleg: src/renderer/src/use-app-state.ts (Pfad- bzw. Fehler-Toast).

## Approach
- Die Transkriptliste wird nicht nach einer festen Segmentzahl abgeschnitten. Anzeige, Zwischenablage und Datei behalten die Finals bis zum Beginn eines neuen Transkripts. Ohne Sprecherzuordnung zeigt der Markdown-Body die Audioquelle; `speakers` im Frontmatter enthaelt nur erkannte Sprecher. Beleg: UI-Test `more than 500 unattributed finals stay distinct in the UI, clipboard and Markdown` mit 525 Finals.
- Das Markdown-Dokument entsteht im Renderer, geschrieben wird es im Rust-Backend. Der Renderer kennt die Segmente und die Sprecher-Aliase; das Backend kennt das Anwendungsverzeichnis und den konfigurierten Zielpfad. So bleibt die Formatierung an einer Stelle und die Pfadauflösung an einer anderen.
- Rust-Command `save_transcript_markdown(markdown)` legt das Zielverzeichnis an, ermittelt den Dateinamen aus der lokalen Zeit und schreibt atomar. Der Zielordner ergibt sich aus `user.transcript.markdownExport.path` oder, wenn dieser fehlt, aus dem Anwendungsverzeichnis.
- Frontmatter-Werte werden als YAML-Strings quotiert; die Sprecherliste ist ein YAML-Block. Werte mit Sonderzeichen brechen das Dokument nicht.
- Die User-Settings wachsen um `transcript.markdownExport` mit `enabled` (Default `true`) und `path` (Default `null`). Fehlende Felder in älteren Konfigurationen werden je Feld normalisiert, ein explizit gespeichertes `false` bleibt erhalten.

## Log
- 2026-11-11: Spec angelegt und umgesetzt. Eine Konfigurationsdatei neben der EXE, Frontmatter-Export mit optionalem Pfad, Clipboard und Datei teilen denselben Builder. Verifiziert: 46 Node-Tests, 15 Rust-Tests, TypeScript- und .NET-Build grün.
