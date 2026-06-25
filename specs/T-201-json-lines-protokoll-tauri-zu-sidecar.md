# T-201: JSON-Lines-Protokoll zwischen Tauri-Main und C#-Sidecar (via stdin/stdout)

## Kontext
Status: draft
Priorität: high
Abhängigkeiten: T-200

## Goal
Das bestehende Binär-Frame-Protokoll (36-B-Header + PCM-Payload + CRC) aus `../meeting-notes` durch ein **JSON-Lines**-Protokoll ersetzen. Audio-Frames werden nicht mehr zwischen Prozessen übertragen (siehe AD-002). Der Transport zwischen Sidecar und Tauri-Main ist **`stdin/stdout`** über `tauri-plugin-shell` — Named Pipe entfällt komplett (siehe AD-008).

## Done When
- [ ] IPC-Protokoll ist als JSON-Lines definiert: ein JSON-Objekt pro Zeile, Newline-getrennt, UTF-8.
- [ ] **Sidecar → App (`stdout`):** Events vom Typ `status` (`started`/`stopped`/`error`), `transcript` (`partial`/`final`), `debug` (Log-Zeile), `speaker-mapping`, `handshake` (initial).
- [ ] **App → Sidecar (`stdin`):** Commands vom Typ `start`, `stop`, `update-settings`, `shutdown`, sowie `handshake-ack` (initial).
- [ ] **Sidecar-intern (`stderr`):** Diagnose-Logs, getrennt von stdout (Tauri erfasst stderr separat).
- [ ] Erstes Handshake-Objekt (`stdout`) enthält `protocol_version`, `sidecar_version`, `capabilities`. Tauri-Main validiert `protocol_version >= 1.0.0` und antwortet mit `handshake-ack` auf `stdin`. Ohne gültiges Handshake wird der Sidecar beendet.
- [ ] **C#-Seite:** nutzt `System.Text.Json` + `Console.Out` / `Console.In` (async mit `StreamWriter`/`StreamReader` über `Console.OpenStandardOutput()` / `Console.OpenStandardInput()`). **Keine** `NamedPipeServerStream`-Aufrufe mehr.
- [ ] **Rust-Seite:** nutzt `tauri-plugin-shell` (`Command::new_sidecar`) + `serde_json` zum Parsen der stdout-Zeilen + `CommandChild::write()` für stdin.
- [ ] **Newline-Flushing:** C#-Sidecar flusht stdout nach jeder JSON-Zeile (verhindert Stdio-Buffering). Tauri liest Zeile für Zeile.
- [ ] **Reconnects:** Tauri startet den Sidecar bei Crash automatisch neu (max. 3 Versuche, siehe `T-301`); C#-Sidecar führt nach jedem Start ein neues Handshake durch.
- [ ] Fehlertoleranz: JSON-Parser ignoriert Malformed-Lines und loggt sie im Debug-Stream (Rate-limited, max. 1/1000).

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
    protocol_version = "1.0.0",
    sidecar_version = Assembly.GetExecutingAssembly().GetName().Version?.ToString(),
    capabilities    = new[] { "transcript:partial", "transcript:final", "diarization" }
}));

// Auf Handshake-Ack lesen
var ackLine = await stdin.ReadLineAsync();
var ack = JsonSerializer.Deserialize<HandshakeAck>(ackLine!);
if (ack?.protocol_version != "1.0.0") Environment.Exit(1);

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
if handshake.protocol_version != "1.0.0" { return Err(...); }

// Handshake-Ack schreiben
stdin.write_all(br#"{"type":"handshake-ack","protocol_version":"1.0.0"}"#).await?;
stdin.write_all(b"\n").await?;

// Event-Loop
while let Some(line) = reader.next().await {
    let event: Event = serde_json::from_str(&line?)?;
    app.emit(event.event_name(), event)?;
}
```

### EXE-Name

Bleibt `MeetingNotes.Sidecar.exe` (siehe OQ-1). Vermeidet unnötige Doppelpflege.

### Konsolen-Pop-up unterdrücken

`creation_flags = CREATE_NO_WINDOW` beim Tauri-Sidecar-Spawn (siehe `T-301`). Newline-Flushing auf C#-Seite verhindert, dass Output im Stdout-Buffer hängen bleibt.

## Log
- 2026-06-25: Spec angelegt.
- 2026-06-25: Komplett umgeschrieben — Transport wechselt von Named Pipe zu `stdin/stdout` über `tauri-plugin-shell` (siehe `DECISIONS.md → AD-008`). OQ-2 geschlossen.
