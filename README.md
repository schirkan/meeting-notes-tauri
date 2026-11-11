# Meeting Notes

Windows-Desktop-App zur strukturierten Erfassung von Meeting-Transkripten (**Tauri 2** + React + C# Sidecar).

Dieses Projekt ist die **Tauri-Migration** des bestehenden Electron-Projekts `projects/meeting-notes`, das als Referenz unverändert bleibt. Architektur und aktueller Funktionsumfang siehe [SPEC.md](./SPEC.md) und [DECISIONS.md](./DECISIONS.md).

> **Stand 2026-11-11:** Implementierung und lokaler Portable-Build vorhanden. Settings-/Diagnose-Regressionen und Build-Smoke sind geprüft; erfolgreicher Corporate-Proxy-/Azure-Betrieb, Aufnahme-Latenz und Clean-Machine-Deployment bleiben offen. Die [Specs](./specs/) unterscheiden implementierte Funktionen von ausstehenden Akzeptanztests.
>
> **Änderung 2026-11-11:** Eine gemeinsame Konfigurationsdatei `meeting-notes.config.json` direkt neben der EXE, MIT-Lizenz und automatischer Transkript-Export als Markdown mit Frontmatter. Siehe [T-506](./specs/T-506-transkript-markdown-export-und-frontmatter.md).

## Features (Ziel)
- Start/Stop Recording im UI
- Live-Transkript mit Interim/Final und verbesserter Lesbarkeit
- Speaker-Badges/Farben inkl. Alias-Mapping
- Fehler-/Status-Events via Tauri-Bridge
- Debug-Log im UI (separate Öffnen/Schließen-Aktionen + Log löschen)
- Persistente Einstellungen (Sprache, Devices, Sprechererkennung separat für Mic und Speaker)
- Markdown-Export mit YAML-Frontmatter: automatisches Speichern beim Ende der Aufnahme (Pfad optional, Standard ist das Anwendungsverzeichnis) sowie Kopieren in die Zwischenablage — beide erzeugen dasselbe Dokument
- C#-Sidecar (NAudio WASAPI Mic + Loopback, Azure Speech SDK, JSON-Lines nach Tauri)
- Azure Speech: pro Quelle unabhängig `ConversationTranscriber` mit Sprechererkennung oder `SpeechRecognizer` ohne Sprechererkennung. Beide Optionen sind standardmäßig aktiviert, auch bei älteren Konfigurationen ohne diese Felder.
- Mic- und Speaker-IDs werden getrennt angezeigt und zugeordnet: z. B. `Mic · Guest-1` und `Speaker · Guest-1`. Aliase gelten auch für die Anzeige des letzten Sprechers und den Clipboard-Export.
- Optionale Proxy-Konfiguration für Azure Speech
- Sidecar-Resampling auf 16 kHz / 16-bit / mono
- Einstellungen mit drei Bereichen: **Allgemein**, **Azure-Konfiguration** und **Proxy** (rechts daneben; bei schmalen Fenstern untereinander). Proxy-Einstellungen befinden sich im Proxy-Bereich, **Verbindung testen** in der Azure-Konfiguration. Gespeichert werden Azure- und Proxy-Einstellungen gemeinsam über **Azure-Konfiguration speichern**. Der Pfad der gemeinsamen Konfigurationsdatei wird unterhalb aller drei Bereiche angezeigt.

## Voraussetzungen
- Node gemäß `package.json`: ≥22.12.0 <23 oder ≥24.0.0 <24.16.0 (Empfehlung: 22 LTS)
- Rust Toolchain (für Tauri 2)
- .NET 8 SDK (lokal für Sidecar-Build)
- .NET 8 Runtime (auf Zielsystemen)
- Windows 11 mit WebView2 (auf Zielsystemen)

## Setup
```powershell
npm ci
```
Die Tauri-CLI ist eine devDependency; keine globale Installation erforderlich.

### Azure konfigurieren
1. `meeting-notes.config.example.json` → `meeting-notes.config.json` kopieren (direkt neben die EXE bzw. ins Repository-Root im Dev-Build)
2. Speech-Key direkt im Feld `azure.speechKey` eintragen
3. Optional: Proxy unter `proxy.host`/`proxy.port` (+ optional `username`/`password`). Host ohne `http://` oder Pfad, Port 1–65535. Der HTTP-Proxy tunnelt HTTPS und Speech/WSS mittels CONNECT. Proxy-Zugangsdaten werden dem Sidecar über prozesslokale Umgebungsvariablen statt CLI-Argumenten übergeben.

Beim Start mit fehlender, nicht lesbarer oder unvollständiger Azure-Konfiguration öffnen sich die Einstellungen automatisch. Der Hinweis erscheint als schließbarer Toast unten, ohne den Hauptinhalt zu verschieben. Nach manuellem Schließen bleibt der Dialog geschlossen; eine vollständige Konfiguration öffnet ihn beim Start nicht.

### HTTPS und Speech/WSS getrennt testen
- **Verbindung testen** nutzt die aktuellen, auch ungespeicherten UI-Werte einschließlich Proxy und Sitzungssprache.
- Rust prüft DNS/TCP zum Proxy (oder direkt zum Endpoint bei deaktiviertem Proxy) und führt eine HTTPS-HEAD-Probe aus. Deaktivierter Proxy bedeutet explizite Direktverbindung, ohne automatische Umgebungsproxies. DNS am Ziel-Endpoint muss im Proxy-Modus lokal nicht funktionieren.
- **Die HTTPS-Diagnose ignoriert Zertifikatsprüfungen immer (unsicher).** Ein nicht vertrauenswürdiger Proxy kann dadurch den Speech-Key abfangen. Redirects werden nicht verfolgt. Dieses Verhalten ist nur für die Diagnose vorgesehen und kein Nachweis vertrauenswürdiger TLS-Verbindungen.
- Ein separater Sidecar-Diagnoseprozess öffnet native Speech-SDK-Sitzungen für `SpeechRecognizer` und `ConversationTranscriber`, ohne Mikrofon oder Loopback aufzunehmen. Er verwendet dieselben Endpoint-/Proxy-Einstellungen wie die Aufnahme. HTTPS-Erreichbarkeit allein beweist weder gültige Azure-Zugangsdaten noch Speech/WSS-Erreichbarkeit.
- Ein separater **Verbindungstest-Dialog** zeigt den laufenden Test sowie anschließend alle Diagnose-Schritte mit Status und kopierbaren Fehlerdetails, HTTP-Status, Endpoint und Dauer. HTTPS und Speech/WSS werden getrennt ausgewiesen; insgesamt erfolgreich ist der Test nur, wenn beide funktionieren. Auch als Strings oder Objekte zurückgewiesene IPC-Aufrufe werden mit ihren Details angezeigt, nicht nur als generischer Fehler. Der Dialog lässt sich schließen und aus den Einstellungen wieder öffnen, ohne den laufenden Test abzubrechen. Ein HTTP 401/403 bestätigt lediglich HTTP-Erreichbarkeit, nicht erfolgreiche Speech-Authentifizierung.
- Speech/WSS behält unter Windows die native Zertifikatsprüfung bei: Für das verwendete .NET Speech-SDK 1.44 wurde kein offiziell dokumentierter Abschaltmechanismus gefunden. OpenSSL-/CRL-Schalter für Linux werden nicht als Windows-Zertifikatsbypass verwendet. Bei TLS-Inspection müssen die Firmenzertifikate daher weiterhin für den nativen SDK-Transport vertrauenswürdig sein. Die WSS-Proben erwarten sowohl `Connected` als auch `SessionStarted`; bloßes lokales Starten reicht nicht für ein positives Ergebnis.
- Der native Diagnoseprozess ist auf 45 Sekunden begrenzt; DNS-/TCP-/HTTPS-Proben haben jeweils 5 Sekunden Timeout. Dies ist keine garantierte 45-Sekunden-Obergrenze des gesamten UI-Aufrufs einschließlich Prozessstart. Einzelne Schritte erscheinen erst nach Abschluss, nicht live während der Prüfung. Der Test kann Azure-Verbindungen und gegebenenfalls Kosten verursachen, sendet aber keine aufgenommenen Audiodaten. Firmenproxy-Allowlisting, CONNECT-Unterstützung und Authentifizierung sind separat im Zielnetz zu prüfen.

### Benutzereinstellungen (optional)
1. Im Abschnitt `user` derselben Datei `meeting-notes.config.json` bei Bedarf `language` (BCP-47, z. B. `de-DE`, `en-US`), `devices` und `diarization: { "mic": true, "speaker": true }` anpassen. Fehlende Diarization-Felder werden einzeln als `true` behandelt; ausdrücklich gespeichertes `false` bleibt erhalten. Im Settings-Bereich **Allgemein** stehen zwei unabhängige Checkboxen. Gespeicherte Änderungen gelten für die nächste Aufnahme; während einer Aufnahme sind beide Checkboxen deaktiviert.
2. Für den Markdown-Export stehen `transcript.markdownExport.enabled` (standardmäßig `true`) und `transcript.markdownExport.path` (optional). Ohne Pfad landet die Datei im Anwendungsverzeichnis; relative Pfade werden dort aufgelöst.
3. Die Datei wird direkt neben der EXE gelesen und gespeichert: im Release-/Portable-Build neben der EXE, im Dev-Build im Repository-Root. Das Arbeitsverzeichnis des startenden Prozesses spielt keine Rolle. Es wird nichts nach AppData kopiert und keine AppData-Konfiguration als Fallback geladen. Bisher nur in AppData gespeicherte Werte bei Bedarf manuell übernehmen.

## Entwicklung
```powershell
npm run tauri -- dev    # Native App; Sidecar-Publish automatisch via build.rs
npm run dev            # Nur Vite/Renderer, kein Tauri-Backend
npm run typecheck      # TypeScript-Prüfung
npm run build          # TypeScript + Renderer-Build
npm run tauri -- build # MSI/NSIS-Installer inklusive Sidecar
```

> Das C#-Sidecar wird seit `src-tauri/build.rs` automatisch per
> `dotnet publish` erzeugt, bevor Cargo kompiliert. Der frühere
> manuelle Schritt `npm run publish:sidecar` ist nicht mehr nötig —
> das Skript existiert weiterhin für Ad-hoc-Rebuilds ohne Tauri-Build.

UI-Regressionstests: `node --test tests/startup-ui.test.mjs` (lokaler Vite-Testserver und headless Microsoft Edge; keine Azure-Verbindungen).

### Entwicklerwerkzeuge
F12 öffnet bzw. schließt die WebView2-DevTools, auch im Release-/Portable-Build. Dazu ist das Tauri-Feature `devtools` aktiviert.

## Portable Build
Bestehende VS-Code-Aufgabe **Build portable distribution** verwenden oder nach dem Setup:
```powershell
npm run tauri -- build --no-bundle
# Nur nach erfolgreichem Build:
npm run dist:portable
npm run test:smoke
```
`dist:portable` verpackt bereits gebaute Artefakte; es kompiliert keine aktualisierte EXE. Portable-Ausgabe: [dist/portable/](./dist/portable/). Installer entstehen separat durch `npm run tauri -- build`.

**Den gesamten Portable-Ordner verteilen.** Sidecar-EXE und alle verwalteten/nativen DLLs liegen extern in `sidecar/`, nicht eingebettet in `meeting-notes.exe`. .NET 8 Runtime (win-x64) und WebView2 müssen auf dem Zielsystem vorhanden sein.

Letzter verifizierter Portable-Build (2026-11-09): **20.79 MB gesamt**, davon Haupt-EXE 14.03 MB und Sidecar 6.76 MB; 27 Dateien einschließlich 2 Templates und SHA256SUMS, alle 26 Hashes geprüft. Seit 2026-11-11 heißt die EXE `meeting-notes.exe` und es gibt ein Config-Template statt zwei; die Größenangaben beziehen sich noch auf den Stand vom 2026-11-09. 12 UI-Regressionstests sowie fokussierte TypeScript-/Rust-Prüfungen erfolgreich. Native lokale Tests bestätigen F12, relative Config-Pfade und detaillierte negative Transportdiagnosen; kein positiver Azure-/Firmenproxy- oder Clean-Machine-Nachweis. MSI/NSIS wurden heute nicht neu gebaut.

## Lizenz

MIT — siehe [LICENSE](./LICENSE).

## Bekannte Einschränkungen
- In restriktiven Netzwerkumgebungen mit erzwungenem HTTP-Proxy: native Azure-Speech-SDK (auch in der C#-Variante) muss separat validiert werden. Siehe `specs/T-505-proxy-aware-azure-transport.md`.
- Mobile-Build (iOS/Android) ist nicht im Scope.

## Querverweise
- Bestehendes Electron-Projekt: `../meeting-notes/`
- Architekturentscheidungen: [DECISIONS.md](./DECISIONS.md)
- Spezifikation: [SPEC.md](./SPEC.md)
- Tasks und Akzeptanzstatus: [specs/](./specs/)
- Settings-/Diagnose-UX: [T-403](./specs/T-403-settings-dialog-mit-verbindung-testen-button.md)
- Transportdiagnose: [T-304](./specs/T-304-connectivity-diagnose-in-rust.md)
- Offene Corporate-Netzvalidierung: [T-505](./specs/T-505-proxy-aware-azure-transport.md)