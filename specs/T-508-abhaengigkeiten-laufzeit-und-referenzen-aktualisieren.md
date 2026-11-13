# T-508: Abhaengigkeiten, Laufzeit und Referenzen aktualisieren

## Kontext
Status: implemented
Prioritaet: medium
Abhaengigkeiten: T-101, T-200, T-202, T-204, T-207, T-301, T-503

## Goal
Alle Pakete und Laufzeit-Referenzen des Projekts auf den aktuellen Stand bringen,
ohne das Verhalten der Anwendung zu aendern. Kein Feature soll dabei entstehen —
die Aufnahme- und Transkriptionslogik bleibt unveraendert.

## Done When
- [x] **npm:** React und React-Doma auf 19.3.1, `@types/react`/`@types/react-dom` auf 19.3.0,
  `@vitejs/plugin-react` auf 6.3.0, Vite auf 8.3.8, Playwright auf 1.65.0,
  `@tauri-apps/api` und `@tauri-apps/cli` auf 2.12.4, `@types/node` auf 26.6.6.
  `npm audit` meldet **0 Vulnerabilities**.
- [x] **TypeScript 7.0.2:** `baseUrl` ist in TS 7 entfernt, die Pfade sind jetzt
  relativ (`./src/shared/*`). Der Typecheck laeuft fehlerfrei durch.
- [x] **.NET:** Ziel-Framework von `net8.0-windows` auf **`net10.0-windows`**.
  .NET 8 ist seit 10.11.2026 aus der Unterstuetzung; .NET 10 ist die aktuelle LTS.
  `scripts/clean-sidecar.mjs` und `src-tauri/src/sidecar.rs` (Dev-Pfad) sind
  mitgezogen.
- [x] **NuGet:** `Microsoft.CognitiveServices.Speech` 1.44.0 -> **1.53.0**,
  NAudio 2.2.1 -> **3.3.0**.
- [x] **NAudio-3.x-Anpassungen:** `IWaveProvider.Read` ist jetzt span-basiert
  (`Read(Span<byte>)`) statt `Read(byte[], int, int)` — betrifft `AudioResampler`
  und die `DrainResampled`-Helfer in `Program.cs`. `MMDevice.AudioClient` ist
  obsolet und wurde durch `CreateAudioClient()` ersetzt.
- [x] **Rust:** `reqwest` 0.12 -> **0.13** (Feature `rustls-tls` heisst dort
  `rustls`), `thiserror` 1 -> **2**, `rust-version` 1.77.2 -> **1.90** (tauri 2.12
  verlangt MSRV 1.90). `Cargo.lock` und `package-lock.json` sind mitgezogen.
- [x] **Doku:** Alle Versionsangaben in `README.md`, `SPEC.md`, `AGENTS.md`,
  `DECISIONS.md` und den Specs T-204, T-205, T-207, T-306, T-504 sind aktualisiert.

## Approach
- Die Aktualisierung lief paketweise, damit jede Familie separat verifizierbar war:
  npm -> TypeScript -> .NET/NuGet -> Rust.
- **TypeScript 7** verlangt zwei Anpassungen: `baseUrl` wurde entfernt (TS7-Fehler
  TS5102) und `paths` muessen relativ sein (TS5090). Beide sind in
  `tsconfig.json` korrigiert.
- **NAudio 3.x** ist ein echter API-Bruch, kein Konfigurationswechsel. Die neue
  Signatur wurde per Reflection gegen die installierte DLL ermittelt, nicht geraten:
  `MediaFoundationTransform.Read(Span<byte>)` und `MMDevice.CreateAudioClient()`.
- **Rust `reqwest` 0.13** hat das TLS-Feature umbenannt (`rustls-tls` -> `rustls`).
  Die Diagnose-Diagnose zeigte `unrecognized feature for crate reqwest: rustls-tls`.
- Die beiden in NAudio 3.x als obsolet markierten Capture-Klassen
  (`WasapiCapture`, `WasapiLoopbackCapture`) bleiben mit `#pragma warning disable`
  im Einsatz. Die empfohlene Alternative `WasapiRecorderBuilder` wechselt das
  Aufnahmemodell komplett (IAsyncEnumerable statt `DataAvailable`-Event) und waere
  ein eigener Schritt mit Verhaltensaenderung — **kein Teil dieser Aktualisierung**.

## Offene Punkte
- **Zielsystem braucht jetzt .NET 10 Runtime** (win-x64) statt .NET 8. Das ist
  eine Anforderung an die Zielmaschine und muss beim Clean-Machine-Deployment
  (siehe T-504) beruecksichtigt werden.
- Die Umstellung des Audio-Captures auf `WasapiRecorderBuilder` bleibt offen.
- Die Node-Toolchain-Kette (Node 26, TypeScript 7, Vite 8.3) ist lokal verifiziert;
  ein Nachweis auf einem frischen System steht aus.

## Log
- 2026-11-13: Alle Referenzen und Pakete aktualisiert (npm, TypeScript 7, .NET 10,
  NAudio 3.3.0, Speech SDK 1.53.0, reqwest 0.13, thiserror 2). NAudio-3.x-API-Bruch
  (span-basiertes `IWaveProvider.Read`, obsoletes `MMDevice.AudioClient`) per
  Reflection ermittelt und angepasst. Verifiziert: 51 Node-Tests, 18 Rust-Tests,
  467 C#-Assertions, TypeScript-/Vite-/.NET-/Release-Build gruen, Portable-Distribution
  **23.50 MB / 27 Dateien** mit **26/26** SHA256-Summen.
