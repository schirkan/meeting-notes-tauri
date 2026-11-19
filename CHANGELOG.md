# Changelog

## v0.1.2 - 18.11.2026

### Neu
- Automatische Meeting-Aufnahme ueber den Windows-AudioSessionManager.
- Zugehoeriger Auto-Stop, wenn alle Capture-/Render-Sessions des ausloesenden
  Prozesses mindestens 3 Sekunden inaktiv bleiben. Manuelle Aufnahmen sind geschuetzt.
- Systray-Icon mit **Anzeigen** und **Beenden**. Linker Doppelklick stellt das
  vorhandene Hauptfenster wieder her und fokussiert es.
- Einstellung **Beim Schließen in den Systray minimieren**: Verbergen laesst
  Aufnahme und Meeting-Erkennung weiterlaufen; Tray-Beenden beendet die App.

### Geaendert
- **Auto-Aufnahme samt Auto-Stop und Schliessen in den Systray sind standardmaessig an.**
- Fehlende Settings-Felder erhalten die neuen Defaults. Bereits ausdruecklich
  gespeicherte `false`-Werte bleiben erhalten; keine Zwangsmigration persoenlicher Configs.
- Anwendung und Sidecar tragen Version 0.1.2. IPC-Protokoll bleibt kompatibel bei 1.0.0.
- Self-contained Single-File-Sidecar: auf dem Zielsystem keine separate .NET-Installation.

### Verifikation
- `npm run verify -- --full`: 9 Schritte gruen; 92 Node-Tests,
  539 C#-Assertions gegen Quellen / 552 gegen den publizierten Sidecar.
- Zusaetzlich 44 Rust-Tests bestanden.
- Frischer Portable-Build: 31,37 MB / 4 Dateien / 3 gepruefte SHA256-Summen.
  Haupt-EXE ProductVersion 0.1.2; Sidecar FileVersion 0.1.2.0.
- Smoke bestanden; Deployment PASS 9 / FAIL 0. Tray-Icon-Abnahme nativ belegt, Kontextmenue-/Doppelklick-Abnahme und bekannte
  MediaFoundation-Stichprobe SKIPPED; diese sind keine bestandenen Abnahmen.

### Release-Pipeline
- GitHub Actions baut und veroeffentlicht die Releases: **ausschliesslich bei einem Release-Tag** (`release.yml`) - kein automatischer Build bei Push oder Pull Request. Der Workflow checkt genau das Tag aus, laesst Typecheck, Node-Tests und Spec-Konsistenz durch, baut die Portable-Distribution, prueft sie mit Smoke-Test und Deployment-Pruefung und veroeffentlicht ZIP + `SHA256SUMS` als Release-Asset. `workflow_dispatch` holt ein fehlendes Release ohne Tag-Verschiebung nach.
- Das Release **v0.1.2** wurde nachgetragen: ZIP aus dem Tag-Commit `5b8d876`.

### Bekannte Grenzen
- Aufnahme benoetigt weiterhin vollstaendige Azure-Konfiguration.
- Audio-Session-Ende ist eine Heuristik, kein garantiertes Meeting-Ende.
  Echte Teams-/Zoom-Abnahme und Podcast-Gegenprobe stehen aus.
- Native Tray-/Maus-/Fokus-Abnahme ist auf dem aktuellen nicht-interaktiven
  Build-Host per Session-Bridge nicht ausfuehrbar. Win32-Probe und offene Punkte: [T-514](./specs/T-514-systray-und-schliessen-verhalten.md).
- Live-Latenz, Clean-Machine-Abnahme und die bekannte MF-Stichprobe bleiben offen.
- Eine interaktive Benutzersitzung existiert auf diesem Host (Session 1 mit Explorer).
  Das Gateway laeuft in Session 0 und sieht sie nicht; eine geplante Aufgabe mit
  LogonType=Interactive ueberbrueckt das. Native Screenshots und Tray-Icon-Nachweis
  sind damit moeglich, Kontextmenue und Doppelklick nicht.

Versions-Tag und GitHub-Release-Assets sind getrennte Veroeffentlichungen.
