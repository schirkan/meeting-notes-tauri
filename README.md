# meeting-notes-tauri

PoC zur strukturierten Erfassung von Meeting-Transkripten (**Tauri 2** + React + C# Sidecar).

Dieses Projekt ist die **Tauri-Migration** des bestehenden Electron-Projekts `projects/meeting-notes`. Vollständiger Migrationsplan und Architekturziele siehe `PROJECT.md` und `DECISIONS.md`.

> ⚠️ **Status: Doku-Phase.** Es existieren noch keine Quelldateien. Die Spezifikationen unter `specs/` bilden den verbindlichen Bauplan für die Implementierung.

## Features (Ziel)
- Start/Stop Recording im UI
- Live-Transkript mit Interim/Final und verbesserter Lesbarkeit
- Speaker-Badges/Farben inkl. Alias-Mapping
- Fehler-/Status-Events via Tauri-Bridge
- Debug-Log im UI (separate Öffnen/Schließen-Aktionen + Log löschen)
- Persistente Einstellungen (Sprache, Devices)
- TXT-Clipboard-Export mit Header-Metadaten
- C#-Sidecar (NAudio WASAPI Mic + Loopback, Azure Speech SDK, JSON-Lines nach Tauri)
- Azure Speech: Mic via `SpeechRecognizer`, Speaker via `ConversationTranscriber`
- Optionale Proxy-Konfiguration für Azure Speech
- Sidecar-Resampling auf 16 kHz / 16-bit / mono
- **Verbindung testen**-Button in den Azure-Einstellungen

## Voraussetzungen (Soll)
- Node gemäß `.nvmrc` (Empfehlung: 22 LTS)
- Rust Toolchain (für Tauri 2)
- .NET 8 SDK (lokal für Sidecar-Build)
- .NET 8 Runtime (auf Zielsystemen)
- Windows 11 mit WebView2 (auf Zielsystemen)

## Setup (Soll, ab Phase 2)
```bash
nvm use
npm install
# Tauri-CLI global oder via devDependency
```

### Azure konfigurieren
1. `config/azure.example.json` → `config/azure.json` kopieren
2. Speech-Key direkt im Feld `speechKey` eintragen
3. Optional: Proxy unter `proxy.host`/`proxy.port` (+ optional `username`/`password`)

## Entwicklung (Soll)
```bash
npm run dev          # Tauri-Dev (Sidecar wird automatisch via src-tauri/build.rs gebaut)
npm run typecheck    # TS-Lint
npm run build        # Renderer-Build
npm run tauri build  # MSI/NSIS-Installer (Sidecar-Publish läuft in src-tauri/build.rs)
```

> Das C#-Sidecar wird seit `src-tauri/build.rs` automatisch per
> `dotnet publish` erzeugt, bevor Cargo kompiliert. Der frühere
> manuelle Schritt `npm run publish:sidecar` ist nicht mehr nötig —
> das Skript existiert weiterhin für Ad-hoc-Rebuilds ohne Tauri-Build.

## Portable Build (Soll)
```bash
npm run dist:portable
```
Artefakte: `dist/portable/` bzw. `src-tauri/target/release/bundle/`.

## Bekannte Einschränkungen
- In restriktiven Netzwerkumgebungen mit erzwungenem HTTP-Proxy: native Azure-Speech-SDK (auch in der C#-Variante) muss separat validiert werden. Siehe `specs/T-505-proxy-aware-azure-transport.md`.
- Mobile-Build (iOS/Android) ist nicht im Scope.

## Querverweise
- Bestehendes Electron-Projekt: `../meeting-notes/`
- Architekturentscheidungen: `DECISIONS.md`
- Spezifikation: `SPEC-v0.1.md`
- Tasks: `specs/`