# T-517: Echo cancellation (Alpha)

## Kontext
Status: not working

Die Alpha wurde entfernt: Praxistests zeigten keine verlaessliche Verbesserung
der Mikrofon-Transkripte ([T-519](./T-519-echo-cancellation-alpha-abnahme.md)).
Alte Einstellungen werden ignoriert und beim Speichern nicht mehr ausgegeben.
Der folgende Stand dokumentiert die fruehere Alpha, nicht den aktuellen Code.
Reifegrad: Alpha
Prioritaet: medium
Abhaengigkeiten: [T-403: Einstellungen](./T-403-settings-dialog-mit-verbindung-testen-button.md), [T-511: Transkriptionsquellen](./T-511-transkriptions-quellen-auswaehlen.md)

## Ziel
Wenn Lautsprecherton vom lokalen Mikrofon erneut erfasst wird, soll die
Gegenstelle im Mikrofon-Transkript seltener doppelt erscheinen. Die App
bereinigt nur ihren Mikrofonpfad vor Azure Speech. Sie veraendert weder die
Windows-Wiedergabe noch den ausgehenden Ton anderer Apps wie Teams. Die
Alpha ist keine Unterdrueckung eines akustischen Rueckkopplungspfeifens.

## Bedienung und Vertrag

- **Settings > Transcription > Echo cancellation (Alpha)** ist eine Checkbox
  bzw. ein Schalter. Beschriftung und Tooltip sind Englisch. Tooltip:
  “Reduces speaker audio picked up by your microphone. Requires both microphone and speaker loopback. Applies to the next transcription.”
- Vorgesehener Konfigurationsschluessel: `user.transcription.echoCancellation`
  (Boolean, **Default `false`**). Neuinstallation, Upgrade sowie fehlender oder
  ungueltiger Wert bleiben aus. Ein explizit gespeichertes `true` bleibt auch
  dann erhalten, wenn nur eine Quelle aktiv ist. Ein Audio-Autosave aendert
  die Einstellung nicht. Speichern und Verwerfen folgen dem normalen
  Dialog-Draft; waehrend einer laufenden oder pausierten Sitzung ist der
  Schalter nicht editierbar. Die naechste Sitzung uebernimmt den Wert auch bei Auto-Start.
- Wirksam nur bei gespeichertem `true` **und** gleichzeitig aktiven Quellen
  **Microphone** und **Speaker Loopback**. Sind nicht beide Quellen aktiv,
  bleibt die Praeferenz konfigurierbar und gespeichert; der Dialog erklaert,
  warum sie aktuell nicht angewendet wird. Kein zusaetzlicher Audio-Capture,
  kein versteckter Azure-Stream und kein Aendern der Quellenauswahl.
- Unterstuetzte Alpha-Zielplattform: Windows 11 x64, insbesondere lokale
  Lautsprecher mit passendem ausgewaehltem Loopback. Keine neue Zusage fuer
  Bluetooth, virtuelle/umgeleitete Audiopfade oder schon anderweitig gefilterte
  Mikrofone. Technischer Ablauf in [T-518](./T-518-echo-cancellation-audio-pipeline.md),
  Hardware-Nachweis in [T-519](./T-519-echo-cancellation-alpha-abnahme.md).

## Done When
- [x] Alpha-Schalter, Tooltip und Hinweis bei nur einer Quelle sind im Settings-Draft vorhanden. Beleg: `SettingsPanel.tsx` und Chromium-Regressionen in `startup-ui.test.mjs` fuer Save, Cancel und Sperre waehrend aktiver Sitzung.
- [x] TS, Rust, Sidecar-Aufruf und Beispielkonfiguration stimmen ueberein; fehlend/ungueltig ist aus, `true` persistiert und beide Startarten teilen denselben Settings-Snapshot. Beleg: `config-contract.ts`, `settings.rs`, `commands.rs`, `sidecar.rs` und `ArgsParser.cs`.
- [x] Ohne Opt-in und mit nur einer Quelle bleibt der bisherige Pfad unveraendert. Beleg: Rust-Test `transcription_arguments_preserve_sources_and_gate_echo_cancellation`, Parser-Regression in `EchoCancellationValidation.cs` und unveraenderte Quellenauswahl in `Program.cs`; native A/B-Abnahme siehe T-519.

## Workboard
`4f1a482b-afa7-42a3-a933-ef145302a856`
