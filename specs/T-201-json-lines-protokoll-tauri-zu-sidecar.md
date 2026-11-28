# T-201: JSON-Lines-Protokoll zwischen Tauri-Main und C#-Sidecar (via stdin/stdout)

## Kontext
Status: umgesetzt
Priorität: high
Abhängigkeiten: T-200

## Goal
Das bestehende Binär-Frame-Protokoll (36-B-Header + PCM-Payload + CRC) aus `../meeting-notes` durch ein **JSON-Lines**-Protokoll ersetzen. Audio-Frames werden nicht mehr zwischen Prozessen übertragen (siehe AD-002). Der Transport zwischen Sidecar und Tauri-Main ist **`stdin/stdout`** über `tauri-plugin-shell` — Named Pipe entfällt komplett (siehe AD-008). Der Versionsabgleich per Handshake ist in `DECISIONS.md` → AD-018 festgehalten.

## Done When
- [x] IPC-Protokoll ist als JSON-Lines definiert: ein JSON-Objekt pro Zeile, Newline-getrennt, UTF-8. Beleg: sidecar/Logger.cs (eine JSON-Zeile pro Zeile).
- [x] **Sidecar → App (`stdout`):** Events vom Typ `status` (`started`/`stopped`/`error`), `transcript` (`partial`/`final`), `debug` (Log-Zeile), `speaker-mapping`, `handshake` (initial). Beleg: sidecar/Logger.cs und Rust-Seite in commands.rs.
- [x] **App → Sidecar (`stdin`):** Commands vom Typ `start`, `stop`, `update-settings`, `shutdown`, sowie `handshake-ack` (initial). Beleg: sidecar/Program.cs, Rust-Seite commands.rs.
- [x] Nach `shutdown` wartet Rust auf `status` mit `phase: "stopped"`, `running: false` und den Prozess-Exit mit Code `0`. Bis dahin werden finale Segmente weitergeleitet. Der Sidecar quittiert erst nach abgeschlossener Azure-Ergebnislieferung; ein Timeout oder unvollstaendiger Stop wird nicht als sauberer Exit gemeldet. Feste ACK-Felder werden nicht durch die Redaktion von Freitext veraendert. Beleg: `shutdown_requires_a_structured_stop_ack_and_a_successful_exit`; Export nach Beenden siehe [T-514](./T-514-systray-und-schliessen-verhalten.md).
  Der stdin-Reader kann `shutdown` auch bei blockiertem Resume lesen. Die
  Sidecar-Aufraeumphase hat ein gemeinsames Zeitbudget, das kleiner ist als
  das Rust-Limit (10 bzw. 15 Sekunden); ein nicht abbrechbarer SDK-Aufruf darf
  deshalb keinen Erfolg vortaeuschen. Die Abfolge bis zum ACK ist ohne Azure
  simuliert; Live-Abnahme des letzten Azure-Segments steht aus.
- [x] **Sidecar-intern (`stderr`):** Diagnose-Logs, getrennt von stdout (Tauri erfasst stderr separat). Beleg: Logger schreibt Diagnose ueber stderr.
- [x] Erstes Handshake-Objekt (`stdout`) enthält `protocol_version`, `sidecar_version`, `capabilities`. Seit v0.2.0 akzeptiert Tauri-Main exakt `2.0.0`; ältere Versionen ohne Audioaktivitätsmeldungen werden abgewiesen. Erst nach gültigem Handshake und bestätigter Aufnahmebereitschaft erscheint die neue Sitzung als laufend. Paketdateien verschiedener Releases nicht mischen. Beleg: `src-tauri/src/protocol.rs`, `src-tauri/src/commands.rs`, `sidecar/ProtocolVersion.cs` und `scripts/test-smoke.mjs`.
- [x] **C#-Seite:** nutzt `System.Text.Json` + `Console.Out` / `Console.In` (async mit `StreamWriter`/`StreamReader` über `Console.OpenStandardOutput()` / `Console.OpenStandardInput()`). **Keine** `NamedPipeServerStream`-Aufrufe mehr. Beleg: System.Text.Json, Console.Out mit Flush (Logger.cs) und Console.In.ReadLineAsync (Program.cs). Abweichung vom Wortlaut: nicht ueber Console.OpenStandardOutput/Input, sondern direkt ueber Console.Out/Console.In.
- [x] **Rust-Seite:** nutzt `tauri-plugin-shell` (`Command::new_sidecar`) + `serde_json` zum Parsen der stdout-Zeilen + `CommandChild::write()` für stdin. Beleg: tauri-plugin-shell und serde_json in der Rust-Seite.
- [x] **Newline-Flushing:** C#-Sidecar flusht stdout nach jeder JSON-Zeile (verhindert Stdio-Buffering). Tauri liest Zeile für Zeile. Beleg: Console.Out.Flush() nach jeder Zeile.

**Nicht im Scope (Nutzerentscheid vom 28.11.2026):** Kein automatischer Sidecar-Neustart mit neuer Azure-Sitzung nach Absturz, da dabei Sprecher-IDs wechseln. Der Absturz wird angezeigt; eine neue Aufnahme wird manuell gestartet. Siehe [T-507](./T-507-pause-stop-und-sitzungsgebundene-sprecherzuordnung.md).
- [x] Fehlertoleranz: JSON-Parser ignoriert Malformed-Lines und loggt sie im Debug-Stream (Rate-limited, max. 1/1000). Beleg: umgesetzt - der Rust-Main zählt fehlerhafte Zeilen (`AppState::note_malformed_line`); die erste wird immer geloggt, danach nur jede 1000.

## Approach

### Datenaustausch

```
┌──────────────────────────────────┐                  ┌──────────────────────────────────┐
│  C#-Sidecar                      │                  │  Tauri-Main (Rust)               │
│  MeetingNotes.Sidecar.exe        │                  │  src-tauri/                      │
│                                  │                  │                                  │
│  Console.Out  ─────────────────▶ │  stdout          │  Command::sidecar(...).stdout()  │
│  (Events, Status, Handshake)     │  JSON-Lines      │  → app.emit("transcript:...")    │
│                                  │                  │                                  │
│  Console.In   ◀───────────────── │  stdin           │  CommandChild::write(...)        │
│  (Commands, Settings, Ack)       │  JSON-Lines      │  → sidecar                       │
│                                  │                  │                                  │
│  Console.Error ─────────────────▶│  stderr          │  (Diagnose-Logs, getrennt)       │
│  (Diagnose-Logs, optional)       │                  │                                  │
└──────────────────────────────────┘                  └──────────────────────────────────┘
```

### C#-Seite (skizziert)

```csharp
// Pseudo-Code, illustrative
using var stdout = new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true };
using var stdin  = new StreamReader(Console.OpenStandardInput());

// Handshake schreiben
await stdout.WriteLineAsync(JsonSerializer.Serialize(new {
    type = "handshake",
    protocol_version = "2.0.0",
    sidecar_version = Assembly.GetExecutingAssembly().GetName().Version?.ToString(),
    capabilities    = new[] { "transcript:partial", "transcript:final", "diarization" }
}));

// Auf Handshake-Ack lesen
var ackLine = await stdin.ReadLineAsync();
var ack = JsonSerializer.Deserialize<HandshakeAck>(ackLine!);
if (ack?.type != "handshake-ack") Environment.Exit(1);

// Loop: Events schreiben, Commands lesen
// Task A: stdout-Writer (Events aus Recognizer-Handlern)
// Task B: stdin-Reader (Commands verarbeiten)
```

### Rust-Seite (skizziert)

```rust
// Pseudo-Code, illustrative
use tauri_plugin_shell::ShellExt;

let sidecar = app.shell()
    .sidecar("MeetingNotes.Sidecar")?
    .args(["--sample-rate", "16000"])
    .spawn()?;

let stdout = sidecar.stdout().expect("stdout piped");
let stdin  = sidecar.stdin().expect("stdin piped");

// Handshake lesen
let mut reader = BufReader::new(stdout).lines();
let handshake: Handshake = serde_json::from_str(&reader.next().await.unwrap()?);
if handshake.protocol_version != "2.0.0" { return Err(...); }

// Handshake-Ack schreiben
stdin.write_all(br#"{"type":"handshake-ack"}"#).await?;
stdin.write_all(b"\n").await?;

// Event-Loop
while let Some(line) = reader.next().await {
    let event: Event = serde_json::from_str(&line?)?;
    app.emit(event.event_name(), event)?;
}
```

### Implementierter Diagnose-Untervertrag (2026-11-09)

Ein separat mit `--test-connectivity` gestarteter Sidecar schreibt das Diagnoseergebnis auf stdout, ohne Audio-Capture und ohne den geplanten Aufnahme-Handshake vorauszusetzen:

```json
{"type":"speech_connectivity","payload":{"reachable":false,"steps":[{"step":"speech_recognizer_wss","status":"error","detail":"Verbindung konnte nicht aufgebaut werden."}]}}
```

- `steps` enthalten `step`, `status` (`ok`, `warn`, `error`) und `detail`, insbesondere TLS-/Proxy-Hinweise und Ergebnisse für Recognizer und ConversationTranscriber.
- `reachable` verlangt erfolgreiche Verbindung und Session-Start beider Clients. Keine PCM-Frames im Ergebnis.
- Rust verarbeitet das Ergebnis getrennt vom Aufnahme-Eventstream; stderr/Exit-Code dienen bei ausbleibendem Ergebnis zur Fehlerdiagnose.
- Speech-Key/Proxy-Zugangsdaten werden als prozesslokale Umgebungsvariablen übergeben, nicht im Diagnoseprotokoll. Details werden vor Weitergabe redigiert.
- Die übrigen offenen Handshake-/Reconnect-Kriterien und Skizzen dieser Spec werden dadurch nicht als implementiert bestätigt.

### EXE-Name

Bleibt `MeetingNotes.Sidecar.exe` (siehe OQ-1). Vermeidet unnötige Doppelpflege.

### Konsolen-Pop-up unterdrücken

`creation_flags = CREATE_NO_WINDOW` beim Tauri-Sidecar-Spawn (siehe `T-301`). Newline-Flushing auf C#-Seite verhindert, dass Output im Stdout-Buffer hängen bleibt.

## Log
- 2026-11-17: `handshake-ack` wird jetzt im stdin-Kommandoleser des Sidecars explizit akzeptiert und als `handshake_ack` auf Info-Level protokolliert. Die bisherige unknown_command-Warnung war eine fehlende Behandlung der regulaeren Rust-Quittung, kein fehlgeschlagener Handshake. Unbekannte Kommandos bleiben Warnungen.
- 2026-11-17: Falschen Handshake-Timeout im laufenden Audio-/Transkriptionspfad korrigiert. Logger-Zeilen wie `type=status, level=info, code=capturing` sind Logs ohne Event-Payload; bisher wurden sie als `running=false` verarbeitet und loeschten das bereits empfangene Handshake. Rust trennt jetzt flache Logs und Payload-Events vor dem Routing. Fehler-Logs behalten Code/Nachricht und werden als Fehler gemeldet. Das 15-s-Zeitlimit bleibt unveraendert. Testnachweis: `status_log_is_not_a_recording_status_event` und `flat_error_logs_preserve_error_details_and_reject_malformed_logs`.
- 2026-06-25: Spec angelegt.
- 2026-06-25: Komplett umgeschrieben — Transport wechselt von Named Pipe zu `stdin/stdout` über `tauri-plugin-shell` (siehe `DECISIONS.md → AD-008`). OQ-2 geschlossen.
