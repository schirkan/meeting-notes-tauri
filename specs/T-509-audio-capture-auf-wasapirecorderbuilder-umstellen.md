# T-509: Audio-Capture auf `WasapiRecorderBuilder` umstellen

## Kontext
Status: teils umgesetzt (2 Punkte offen; Code fertig, Hardware-Verifikation ausstehend)
Prioritaet: medium
Abhaengigkeiten: T-200, T-202, T-203, T-508, T-502

## Goal
Die in NAudio 3.x als obsolet markierten Capture-Klassen `WasapiCapture` und
`WasapiLoopbackCapture` durch `WasapiRecorderBuilder` / `WasapiRecorder` ersetzen.
Kein Feature-Change: Aufnahme, Resampling auf 16 kHz/16-Bit/mono und der
Push in den Azure-`PushAudioInputStream` bleiben semantisch identisch.

## Ausgangslage (gemessen am 2026-11-13)
- Aktive Pipeline: `sidecar/Program.cs` Zeile 137-231 — zwei Capture-Objekte,
  zwei `BufferedWaveProvider`, zwei `MediaFoundationResampler`, zwei
  `DataAvailable`-Handler, `DrainResampled`, `azure.PushFrame`.
- `sidecar/AudioCaptureClient.cs` (62 Zeilen), `MicCaptureClient.cs` (17) und
  `LoopbackCaptureClient.cs` (17) haben **0 externe Verwendungen** — die
  Pipeline liegt vollstaendig inline in `Program.cs`.
- Verifikation per `git grep` ueber alle versionierten `.cs`-Dateien
  (am 2026-11-16): `AudioResampler`, `DrainResampled`, `AudioCaptureClient`,
  `MicCaptureClient`, `LoopbackCaptureClient`, `MediaFoundationResampler`,
  `BufferedWaveProvider`, `WasapiCapture` und `WasapiLoopbackCapture` kommen
  **ausschliesslich** in `sidecar/*.cs` vor. Die C#-Validierung
  (`sidecar/Validation/`) und die Node-/Rust-Tests referenzieren sie nicht —
  der Wegfall dieser rund 160 Zeilen fasst **keine** Test- oder
  Harness-Aenderung nach sich.
- `NAudio.Wave.WasapiRecorder` (3.3.0) bietet **beide** Konsumwege:
  `EVENT DataAvailable : CaptureDataAvailableHandler` (jetzt `ReadOnlySpan<byte>`,
  Zero-Copy) **und** `M CaptureAsync(CancellationToken) -> IAsyncEnumerable`.
  Der Umstieg ist also eine API-Ersetzung, kein Modellwechsel.
- `WasapiRecorderBuilder`: `WithDevice(MMDevice)`, `WithFormat(WaveFormat)`,
  `WithSharedMode()`, `WithExclusiveMode()`, `WithEventSync()`,
  `WithPollingSync()`, `WithBufferLength(int ms)`,
  `WithMmcssThreadPriority(string)`, `WithLowLatency(bool)`,
  `WithLoopbackCapture()`, `WithProcessLoopback(uint, ProcessLoopbackMode)`,
  `WithRawMode()`, `WithCommunicationsMode()`,
  `WithEchoCancellationReferenceEndpoint(MMDevice)`,
  `WithDefaultDeviceStreamRouting()`, `Build()`, `BuildAsync()`.

## Done When
- [x] Mic und Speaker-Loopback laufen ueber `WasapiRecorder` (Code umgesetzt; Laufzeitnachweis auf echter Hardware steht aus).
- [x] Das Zielformat 16 kHz / 16-Bit / mono erreicht Azure unveraendert — im Engine-Modus liefert die WASAPI-Engine direkt, im Resampler-Modus der MediaFoundationResampler.
- [x] `WasapiCapture`, `WasapiLoopbackCapture` und `DrainResampled` sind aus
      `Program.cs` entfernt; die drei ungenutzten Capture-Klassen
      (`AudioCaptureClient`, `MicCaptureClient`, `LoopbackCaptureClient`) sind
      geloescht. `BufferedWaveProvider` und `MediaFoundationResampler` bleiben
      **nur** im automatischen Rueckfallpfad in `AudioRecorderSource.cs`.
- [x] Keine `#pragma warning disable CS0618` mehr noetig.
- [ ] Das Loopback-Verhalten ist unveraendert: Events nur waehrend tatsaechlicher
      Audioausgabe auf dem Zielgeraet.
- [x] Die C#-Validierung bleibt gruen (467 Assertions PASS).
- [ ] Latenz und Ausgabequalitaet sind auf echter Hardware gegen die
      bisherige Implementierung geprueft.

## Approach
1. **Recorder statt Capture-Objekte.** Fuer Mic und Loopback je ein
   `WasapiRecorderBuilder` mit `WithDevice(...)`; Loopback zusaetzlich mit
   `WithLoopbackCapture()`. Der Speaker-Loopback nutzt weiterhin das
   Render-Endpoint (`WithDevice(speakerDevice)`) — **kein**
   `WithProcessLoopback`, das nur den eigenen Prozess erfasst und damit
   fremde Audioquellen verlieren wuerde.
2. **Format.** `WithFormat(new WaveFormat(16000, 16, 1))` — im Shared Mode
   konvertiert die WASAPI-Engine selbst. Damit entfallen `BufferedWaveProvider`,
   `MediaFoundationResampler` und `DrainResampled` **im Normalfall**.
   **Der automatische Rueckfallpfad bleibt im Code:** `AudioRecorderSource`
   faellt auf den MediaFoundation-Resampler zurueck, wenn die Engine das
   Zielformat nicht liefert; die Quelle meldet dann `ModeLabel = "resampler"`.
   Der Aufwand entspricht damit der 1,5-Tage-Variante, nicht der 1-Tage-Variante.
3. **Datenweg.** Der `DataAvailable`-Handler bekommt einen
   `ReadOnlySpan<byte>`, der **nur waehrend des Callbacks** gueltig ist. Die
   Daten muessen deshalb kopiert werden, bevor sie weiterlaufen.
4. **Kein `WithLowLatency()` im ersten Schritt.** Die Low-Latency-Variante
   schliesst `WithFormat` aus und arbeitet nur im Shared Mode mit
   Event-Sync, ohne Loopback und nur bei `IAudioClient3`-Unterstuetzung —
   Mic und Loopback muessten dann unterschiedlich behandelt werden. Das ist
   eine Architekturentscheidung (Latenzziel < 5 s, siehe T-502) und kein
   Refactor.
5. **Rueckfall wird gemessen, nicht angenommen.** `WasapiRecorder.WaveFormat`
   liefert das **angeforderte** Format, nicht das tatsaechlich gelieferte — ein
   Vergleich gegen das Zielformat waere damit tautologisch und wuerde einen
   Fehlerfall nicht erkennen. Stattdessen misst `AudioRecorderSource` die
   Byte-Rate der gelieferten Frames und vergleicht sie mit der Ziel-Bitrate
   (`WaveFormat.AverageBytesPerSecond`). Weicht sie um mehr als 50 % ab, wird
   auf den Resampler umgeschaltet. Ein Fenster ohne Daten (z. B. Loopback-Geraet
   im Leerlauf) wird nicht bewertet.
6. **Kein MMCSS.** `WithMmcssThreadPriority` wurde bewusst **nicht** gesetzt:
   der Capture-Thread schiebt die Frames blockierend in den Azure-PushStream.
   Eine Audio-Scheduling-Prioritaet wuerde waehrend dieser Netzwerkwartezeit
   einen MMCSS-Reservierungs-Platz halten. Die bisherige `WasapiCapture`-
   Klasse setzte ebenfalls kein MMCSS — die Aufnahme bleibt damit in der
   Scheduler-Klasse unveraendert.

## Verifikation (blockierend: benoetigt echte Audio-Hardware)
Diese Entwicklungsmaschine meldet `--list-devices` mit **0** Eingangs- und
**0** Ausgabegeraeten. Der Konvertierungsweg und das Loopback-Verhalten sind
hier nicht nachweisbar. Ablauf auf einem Rechner mit Mic und Ausgabe:

1. Portable-Build erzeugen (`npm run tauri -- build --no-bundle`) und
   `src-tauri/target/sidecar-publish/MeetingNotes.Sidecar.exe` mit
   `--list-devices` pruefen (Mic und Ausgabe muessen erscheinen).
2. Aufnahme starten, Mic und Loopback besprechen, Transkript im UI pruefen:
   Segmente kommen an, Format ist 16 kHz/16-Bit/mono, kein Rauschen, keine
   Luecken.
3. Latenz gegen den bisherigen Stand messen (T-502) und mit dem Wert von
   vor dem Umbau vergleichen.
4. Loopback-Gegenprobe: Audio nur auf dem Ausgabegeraet abspielen — es muss
   im Transkript erscheinen. Audio aus einem anderen Programm auf dem
   Ausgabegeraet — es muss ebenfalls erscheinen (systemweit, kein
   `WithProcessLoopback`).

## Offene Punkte
- **Hardware-Verifikation steht aus.** Diese Entwicklungsmaschine meldet
  `--list-devices` mit **0** Eingangs- und **0** Ausgabegeraeten. Der
  Konvertierungsweg (Engine- oder Resampler-Modus), das Loopback-Verhalten und
  die Latenz sind hier nicht nachweisbar.
- **Float-Mic-Frage ist zur Laufzeit entscheidbar, nicht mehr offen.** Die
  Engine-Konvertierung ist belegt (`AutoConvertPcm | SrcDefaultQuality` im
  Standard-Shared-Pfad — identisch zu `WasapiCapture`), aber ein Float-Mic kann
  je nach Treiber nicht auf 16-Bit-PCM konvertiert werden. Die Byte-Raten-
  Messung erkennt das und schaltet auf den Resampler um. Welcher Modus aktiv
  ist, steht im Log (`recorder_mode`) und in `ModeLabel`.
- **Latenzentscheidung:** `WithLowLatency()` ja oder nein — abhaengig vom
  Ziel in T-502 und davon, ob Mic und Loopback unterschiedlich behandelt
  werden duerfen.

## Log
- 2026-11-16: Portable nach dem Umbau neu gebaut: Release-/Renderer-Build, Packaging und
  Smoke-Test erfolgreich. Haupt-EXE 15.47 MB, Sidecar 7.61 MB (21 Dateien), Gesamt
  **23.09 MB / 24 Dateien / 23 gepruefte Hashes**. Native Geraeteabfrage: 0 Eingaenge,
  0 Ausgaenge — der Hardware-Nachweis fuer Konvertierungsweg und Loopback bleibt offen.
- 2026-11-13: Spec angelegt. Aufwand am Code und an der installierten
  NAudio-Wasapi-3.3.0-DLL gemessen: rund ein Tag Code plus ein
  Verifikationsfenster mit Audio-Hardware. API-Fakten per Reflection und
  NAudio-Doku belegt, nicht geschaetzt.
- 2026-11-16: Float-Mic-Frage an der NAudio-Quelle geklaert: `WasapiRecorder`
  setzt `waveFormat = requestedFormat ?? Client.MixFormat`, der Standard-Shared-Pfad
  unterstuetzt `AutoConvertPcm`. Der Aufwand bleibt bei ≈ 1 Tag; der
  Resampler bleibt als Ruecksfallpfad, bis die Hardware-Verifikation den
  Engine-Weg bestaetigt. Die in T-508 dokumentierte
  Falschangabe (Modellwechsel `DataAvailable` -> `IAsyncEnumerable`) wurde
  korrigiert — `DataAvailable` besteht in NAudio 3.x fort.


- 2026-11-16: **Umgesetzt.** Neue Klasse `sidecar/AudioRecorderSource.cs`;
  `Program.cs` auf `WasapiRecorderBuilder` umgestellt (359 -> 319 Zeilen).
  Die drei ungenutzten Capture-Klassen (`AudioCaptureClient`, `MicCaptureClient`,
  `LoopbackCaptureClient`) sind geloescht, `DrainResampled` und die
  `#pragma warning disable CS0618` sind entfernt. `AudioResampler.cs` bleibt
  bewusst bestehen: es ist der Rueckfallpfad fuer Geraete, deren Mixformat die
  Engine nicht auf 16-Bit-PCM konvertiert. Der Rueckfall wird ueber die
  Byte-Rate erkannt, nicht ueber den `WaveFormat`-Vergleich (der waere
  tautologisch). `WithMmcssThreadPriority` bewusst nicht gesetzt — der
  Capture-Thread blockiert beim Azure-Push im Netzwerk. Verifiziert: Build 0
  Warnungen / 0 Fehler, 467 C#-Assertions PASS, 21 Rust-Tests, 62 Node-Tests.
  **Offen bleibt der Hardware-Nachweis** (Konvertierungsweg, Loopback, Latenz).