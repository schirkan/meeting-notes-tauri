# T-511: Transkriptions-Quellen auswählbar (Mic, Speaker oder beides)

## Kontext
Status: umgesetzt
Priorität: medium
Abhängigkeiten: T-305, T-403, T-507, T-509

## Goal
In den Einstellungen wird auswählbar, **welche Audioquelle transkribiert** wird:
nur das Mikrofon, nur der Speaker-Loopback oder beides. Bisher werden immer
beide Quellen aufgenommen und nach Azure gesendet.

Die Transkription ist dabei eine **eigene Achse neben der Diarization**:
die Diarization entscheidet, ob für eine Quelle die Sprechererkennung
verwendet wird; die Transkription entscheidet, ob die Quelle überhaupt
aufgenommen wird. Beide sind unabhängig voneinander.

## Datenfelder
Zwei neue Bool-Felder unter `user.transcription` in der gemeinsamen
Config-Datei `meeting-notes.config.json`:

```json
"user": {
  "transcription": { "mic": true, "speaker": true }
}
```

- **Default: beide `true`.** Das entspricht dem bisherigen Verhalten.
- Fehlende Felder werden einzeln als `true` behandelt; ausdrücklich
  gespeichertes `false` bleibt erhalten — wie bei der Diarization.
- `false` bedeutet: die Quelle wird **nicht aufgenommen**, nicht an Azure
  gesendet und erzeugt weder ein Gerät noch einen Recognizer.

## Done When
- [x] Zwei Bool-Felder in TS-Contract, Rust-Settings und Config-Template.
- [x] Normalisierung in `normalizeUserSettings` (Default je Feld `true`,
      explizites `false` bleibt erhalten, unbrauchbare Werte werden nicht
      truthy).
- [x] Rust-Persistenz: `transcription` überlebt Speichern/Laden; jedes
      Feld einzeln kombinierbar.
- [x] Weitergabe an den Sidecar über `--transcription-mic` /
      `--transcription-speaker` (unabhängige Booleans).
- [x] Sidecar: nicht transkribierte Quellen erzeugen **weder** ein
      Aufnahmegerät **noch** einen Azure-Recognizer.
- [x] Sidecar: eine nicht transkribierte Quelle **voraussetzt kein Gerät** —
      ohne Speaker-Transkription wird kein Ausgabegerät gesucht.
- [x] Beide Quellen ausgeschaltet ist ein Fehlerfall (Exit-Code 23), weil
      dann nichts transkribiert würde.
- [x] Zwei Checkboxen im Settings-Dialog; die Geräteauswahl und die
      Diarization-Checkboxen der jeweiligen Quelle werden deaktiviert, wenn
      die Quelle nicht transkribiert wird.
- [x] Die letzte aktive Quelle lässt sich nicht abschalten (Mindestens eine
      Quelle muss transkribiert werden).
- [x] Verifikation: Node-Tests, Rust-Tests und C#-Validierung grün.

## Umsetzung
### Contract und Persistenz
- `src/shared/config-contract.ts`: `TranscriptionSettings` mit `mic` und
  `speaker`, Teil von `UserSettings`, Default `{ mic: true, speaker: true }`.
- `src-tauri/src/settings.rs`: `TranscriptionSettings` mit
  `#[serde(default)]` — fehlende Felder werden einzeln `true`.
- `meeting-notes.config.example.json`: `transcription`-Block ergänzt.

### Weitergabe an den Sidecar
- `src-tauri/src/sidecar.rs`: `SidecarOptions.transcription` und
  `transcription_arguments()` — dieselbe Form wie bei der Diarization.
- `src-tauri/src/commands.rs`: `user.transcription` wird beim Start
  durchgereicht.

### Sidecar
- `sidecar/ArgsParser.cs`: `ParseTranscription` analog zu
  `ParseDiarization`.
- `sidecar/Program.cs`: Geräte werden **nur** für transkribierte Quellen
  aufgelöst; die Recorder-Erzeugung entfällt je abgeschalteter Quelle.
- `sidecar/AzureSpeechService.cs`: `StartAsync` legt nur für transkribierte
  Quellen einen Recognizer an. `EffectiveDiarization` berücksichtigt, dass
  die SDK-Eigenschaft nur wirkt, wenn eine transkribierte Quelle die
  Sprechererkennung nutzt.

### Oberfläche
- `src/renderer/src/components/SettingsPanel.tsx`: zwei Checkboxen
  („Mikrofon transkribieren“, „Speaker-Loopback transkribieren“). Die
  zugehörige Geräteauswahl und die zugehörige Diarization-Checkbox sind
  deaktiviert, wenn die Quelle nicht transkribiert wird.

## Verifikation
- Node-Tests: Normalisierung über alle vier Bool-Kombinationen, Legacy- und
  Teilangaben, unbrauchbare Werte, Unabhängigkeit von der Diarization.
- Rust-Tests: Persistenz und Weitergabe der Argumente.
- C#-Validierung (`sidecar/Validation/TranscriptionValidation.cs`): CLI-Optionen,
  JSON-Rundreise, Quellenauswahl (nur transkribierte Quellen erhalten einen
  Recognizer) und die wirksame Diarization.

## Offene Punkte
- **Hardware-Nachweis steht aus.** Diese Entwicklungsmaschine meldet
  `--list-devices` mit **0** Eingangs- und **0** Ausgabegeraeten. Der
  transkribierte Inhalt, die tatsächlich erfasste Latenz und das Verhalten
  bei nur einer Quelle sind hier nicht nachweisbar. Auf einem Rechner mit
  echtem Mic und Ausgabe prüfen: nur Mic aktiviert → kein Speaker-Gerät
  nötig, Transkript enthält nur den Sprecher; nur Speaker aktiviert →
  kein Mic-Gerät nötig.

## Log
- 2026-11-16: Umgesetzt. Neuer Contract-Block `user.transcription`, zwei
  Checkboxen im Settings-Dialog, Weitergabe über `--transcription-mic` /
  `--transcription-speaker`. Der Sidecar nimmt nur transkribierte Quellen
  auf und erzeugt nur dafür einen Azure-Recognizer. Geräte werden nur für
  aktive Quellen aufgelöst. Beide Quellen ausgeschaltet wird mit Exit-Code 23
  abgewiesen.
- 2026-11-16: Portable nach der Umstellung neu gebaut: Release-/Renderer-Build,
  Packaging und Smoke-Test erfolgreich. Haupt-EXE 15.48 MB, Sidecar 7.62 MB
  (21 Dateien), Gesamt **23.10 MB / 24 Dateien / 23 geprüfte Hashes**. Native
  Geräteabfrage: 0 Eingänge, 0 Ausgänge — der Hardware-Nachweis (nur eine
  Quelle aktiv, Transkriptinhalt, Latenz) bleibt offen.