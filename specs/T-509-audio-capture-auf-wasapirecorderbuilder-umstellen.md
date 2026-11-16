# T-509: Audio-Capture auf `WasapiRecorderBuilder` umstellen

## Kontext
Status: draft (geplante Umsetzung, Termin offen)
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
- [ ] Mic und Speaker-Loopback laufen ueber `WasapiRecorder`.
- [ ] Das Zielformat 16 kHz / 16-Bit / mono erreicht Azure unveraendert.
- [ ] `WasapiCapture`, `WasapiLoopbackCapture`, `BufferedWaveProvider`,
      `MediaFoundationResampler` und `DrainResampled` sind aus `Program.cs`
      entfernt; die drei ungenutzten Capture-Klassen sind geloescht.
- [ ] Keine `#pragma warning disable CS0618` mehr noetig.
- [ ] Das Loopback-Verhalten ist unveraendert: Events nur waehrend tatsaechlicher
      Audioausgabe auf dem Zielgeraet.
- [ ] Die C#-Validierung bleibt gruen und deckt den Recorder-Pfad ab.
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
   `MediaFoundationResampler` und `DrainResampled` komplett.
   **Fallback (bleibt sinnvoll):** Quellcode der installierten NAudio-3.3.0 zeigt
   `waveFormat = requestedFormat ?? Client.MixFormat` und fuer den
   Standard-Shared-Pfad "GetMixFormat and AutoConvertPcm work"; die NAudio-Doku
   sagt zusaetzlich: "In shared mode the engine converts to the format you request
   via WithFormat." Ein Float-Mic wird damit sehr wahrscheinlich von der
   WASAPI-Engine auf 16-Bit-PCM konvertiert. **Ohne Hardware ist das nicht
   beweisbar**, deshalb bleibt `MediaFoundationResampler` als Ruecksfallpfad
   im Code — kostet beim Wegfall aber ≈ 1,5 statt ≈ 1 Tag.
3. **Datenweg.** Der `DataAvailable`-Handler bekommt einen
   `ReadOnlySpan<byte>`, der **nur waehrend des Callbacks** gueltig ist. Die
   Daten muessen deshalb kopiert werden, bevor sie weiterlaufen.
4. **Kein `WithLowLatency()` im ersten Schritt.** Die Low-Latency-Variante
   schliesst `WithFormat` aus und arbeitet nur im Shared Mode mit
   Event-Sync, ohne Loopback und nur bei `IAudioClient3`-Unterstuetzung —
   Mic und Loopback muessten dann unterschiedlich behandelt werden. Das ist
   eine Architekturentscheidung (Latenzziel < 5 s, siehe T-502) und kein
   Refactor.

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
- **Float-Mic-Frage: quellenklaert, weiterhin hardwarebelegt.** NAudio-3.3.0
  uebernimmt im Shared Mode das angeforderte Format (`requestedFormat ??
  Client.MixFormat`) und der Standard-Pfad unterstuetzt `AutoConvertPcm`; laut
  NAudio-Doku konvertiert die Engine im Shared Mode auf das per `WithFormat`
  angeforderte Format. Ein Float-Mic sollte damit ohne eigenen Resampler
  funktionieren — **der Nachweis erfolgt auf echter Hardware** (T-509
  Verifikation). Der Resampler bleibt bis dahin als Ruecksfallpfad im Code.
- **Latenzentscheidung:** `WithLowLatency()` ja oder nein — abhaengig vom
  Ziel in T-502 und davon, ob Mic und Loopback unterschiedlich behandelt
  werden duerfen.
- Die NAudio-3.x-Capture-Klassen bleiben bis zum bestaetigten Umbau per
  `#pragma warning disable CS0618` im Einsatz (siehe T-508).

## Log
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
