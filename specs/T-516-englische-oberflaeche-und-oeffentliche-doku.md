# T-516: Englische Oberflaeche, Meldungen und oeffentliche Dokumentation

## Kontext
Status: teils umgesetzt (1 Punkt offen: Release-Veroeffentlichung und Asset-Nachweis)
Prioritaet: hoch
Abhaengigkeiten: T-513, T-514, T-515

Die Anwendung war bis v0.1.3 durchgaengig deutschsprachig: alle sichtbaren Texte im
Renderer, alle Toast-Meldungen, die Tray-Beschriftung, die Debug-Log-Eintraege des
Sidecars sowie alle Fehlermeldungen aus Rust und C#. Die oeffentliche Flaeche (README,
GitHub-Texte, Release-Notizen, Beispielkonfiguration) war gemischt: der README-Abschnitt
war englisch, nannte aber deutsche UI-Beschriftungen, die Doku unter `docs/` und der
CHANGELOG waren deutsch.

**Entscheidung:** Trennung nach Zielgruppe statt nach Dokumenttyp.

- **Englisch (nur Nutzer-facing):** gesamte UI, alle Meldungen, alle Fehlertexte, Tray-Menue
  und Tooltips, Debug-Log-Eintraege, WebView-HTML-Sprachattribut, Datums- und
  Zeitformatierung, Beispielkonfiguration, README, `docs/README.md`, CHANGELOG,
  GitHub-Actions-Workflow mit Release-Notizen.
- **Deutsch (intern):** Specs, `SPEC.md`, `AGENTS.md`, `DECISIONS.md` sowie
  Quellcode-Kommentare. Der Code-Kommentar bleibt deutsch, weil er Arbeitsdokumentation
  fuer die Agenten ist.

Die Uebersetzung aendert **keine** Funktionalitaet: keine neuen Felder, keine geaenderten
Schwellwerte, keine geaenderten Protokoll-Keys, keine geaenderten Dateinamen. Maschinen-
lesbare Schluessel (JSON-Feldnamen, Protokoll-Versionen, Fehlercodes, Sprachcodes
`de-DE`, `en-US`, Step-IDs `config`, `transport`, `https-tls`, `endpoint`,
`dns-system`, `tcp`, `https-probe`) bleiben unveraendert. Der Default der primaeren
Sprache bleibt `de-DE` - die Transkriptionssprache ist eine eigene Achse und unabhaengig
von der UI-Sprache. Transkriptinhalte, vom Nutzer vergebene Namen, native
Windows-Geraetenamen und unveraenderte Fehlerdetails externer Bibliotheken werden
nicht uebersetzt; die Anwendung verfasst ihre eigenen Labels und Meldungen englisch.

## Glossar (verbindlich)

| Deutsch | English |
|---|---|
| Einstellungen | Settings |
| Allgemein | General |
| Transkription | Transcription |
| Audio Einstellungen | Audio settings |
| Speichern | Save |
| Schliessen | Close |
| Verbindung testen | Test connection |
| Verbindungstest | Connection test |
| Mikrofon | Microphone |
| Speaker-Loopback | Speaker loopback |
| Sprechererkennung | Speaker recognition |
| Sprecherzuordnung | Speaker mapping |
| Sprecher | Speakers |
| Anzeigename | Display name |
| Transkript | Transcript |
| Pause / Weiter | Pause / Resume |
| Start / Stopp | Start / Stop |
| Laeuft / Gestoppt / Pausiert | Running / Stopped / Paused |
| Startet | Starting |
| Fehler / Warnung / Erfolgreich | Error / Warning / Success |
| Debug-Log | Debug log |
| Log loeschen | Clear log |
| Beim Schliessen in den Systray minimieren | Minimize to system tray on close |
| Aufnahme automatisch starten | Start recording automatically |
| Aufnahme automatisch beenden | Stop recording automatically |
| Transkript automatisch speichern | Save transcript automatically |
| Speicherpfad (optional) | Save path (optional) |
| Speicherordner auswaehlen | Choose save folder |
| Ordner auswaehlen | Choose folder |
| Standard: Anwendungsverzeichnis | Default: application directory |
| Primaere Sprache | Primary language |
| Interim Results aktivieren | Enable interim results |
| Proxy verwenden | Use proxy |
| Proxy Benutzername / Passwort (optional) | Proxy username / password (optional) |
| Anzeigen (Tray) | Show |
| Beenden (Tray) | Quit |
| Meeting Notes - Aufnahme | Meeting Notes - Recording |
| Meeting Notes - Pausiert | Meeting Notes - Paused |
| Deutsch / Englisch / Franzoesisch / Spanisch / Italienisch / Portugiesisch / Niederlaendisch / Polnisch / Tuerkisch / Japanisch | German / English / French / Spanish / Italian / Portuguese / Dutch / Polish / Turkish / Japanese |

Datums- und Zeitformatierung wechselt von `de-DE` auf `en-US`. Das HTML-Sprachattribut
wechselt von `lang="de"` auf `lang="en"`.

## Done When
- [x] **Kein deutscher Text mehr in der Renderer-Oberflaeche.** Beleg: `src/renderer/src/**`,
      `src/preload/index.ts` und `src/shared/**` enthalten keine deutschen UI-Labels mehr;
      `npm run typecheck` gruen.
- [x] **Alle Meldungen und Fehlertexte sind englisch.** Beleg: Renderer-Toasts,
      `src/shared/config-contract.ts` und `src/shared/transcript-contract.ts` (description /
      recoveryHint), die Rust-Fehlertexte in `src-tauri/src/{commands,connectivity,tray,sidecar,
      autostart,state,lib}.rs` sowie die Sidecar-Logtexte in `sidecar/**.cs` sind uebersetzt.
      Maschinenlesbare Schluessel (Fehlercodes, Step-IDs, Protokoll-Keys) unveraendert.
- [x] **Tray und Tooltips sind englisch.** Beleg: `src-tauri/src/tray.rs` nutzt `Show`/`Quit`
      sowie die Tooltips `Meeting Notes - Recording` und `Meeting Notes - Paused`.
- [x] **Nur `en-US`-Formatierung, kein `de-DE` mehr im Renderer.** Beleg: keine
      `de-DE`-Formatierung in `src/renderer/src/**`; `src/renderer/index.html` traegt
      `lang="en"`.
- [x] **Die oeffentliche Doku ist englisch.** Beleg: `README.md`, `docs/README.md`,
      `CHANGELOG.md`, `MeetingNotes.config.example.json` und
      `.github/workflows/release.yml` (inklusive Release-Notizen-Body) sind englisch.
- [x] **Die interne Doku bleibt deutsch.** Beleg: `specs/**`, `SPEC.md`, `AGENTS.md`,
      `DECISIONS.md` unveraendert deutsch.
- [x] **Tests folgen der UI-Sprache.** Beleg: `tests/startup-ui.test.mjs` greift auf die
      englischen Labels zu (`Settings`, `General`, `Transcription`, `Test connection`,
      `Save transcript automatically`, ...); `tests/config-utils.test.mjs` prueft die
      englischen Fehlermeldungen.
- [x] **Screenshots zeigen die englische Oberflaeche.** Beleg: `npm run screenshots` und
      `npm run screenshots:native` erzeugen je 8 Aufnahmen in `docs/renderer/` und
      `docs/native/` mit englischen UI-Texten.
- [ ] **Release v0.1.4 veroeffentlicht.** **offen**:  GitHub-Release `v0.1.4` mit Asset
      `MeetingNotes-v0.1.4-win-x64.zip` und Pruefsumme veroeffentlichen,
      herunterladen, hash-verifizieren und entpackt pruefen.
- [x] **Vollverifikation gruen.** Beleg: `npm run verify -- --full` am 20.11.2026
      mit allen 9 Schritten gruen; 98 Node-Tests, 539 Quell-/552 Published-Sidecar-
      Assertions, Smoke gruen, Deployment PASS 9 / FAIL 0. Zusaetzlich 47 Rust-Tests
      gruen. MediaFoundation-Stichprobe wegen nichtinteraktiver Umgebung SKIPPED;
      keine neue Hardware-/Azure-/Clean-Machine-Abnahme behauptet.

## Approach
- Die Uebersetzung lief in vier getrennten, dateidisjunkten Pfaeden: Renderer inklusive
  Shared-Verträgen und Tests, Rust-Backend, C#-Sidecar und oeffentliche Doku.
- Die Ersetzungen liefen ueber ein Skript mit **Trefferpruefung**: jedes Muster muss genau
  einmal greifen. Mehrdeutige Muster (z. B. `"Fehler"` in Rust, `"erreichbar"` in der
  Connectivity-Probe) brauchten eindeutigen Zeilenkontext; bei `n` Treffern bricht das
  Skript ab, statt still falsch zu ersetzen.
- **Zeilenenden:** Die Quelldateien nutzen CRLF. Das Skript probiert deshalb neben dem
  exakten Muster auch die CRLF-Variante und eine einzeilige Variante. Ohne diese Toleranz
  greifen mehrzeilige Muster nicht.
- Die Testdatei spricht die UI ueber Rollennamen an (`getByRole('button', { name: 'Settings dialog' })`).
  Beim Uebersetzen der UI muss deshalb jeder Rollenname mituebersetzt werden - sonst
  schlagen die Tests still gegen nicht mehr vorhandene Labels fehl.
- Die Screenshot-Skripte referenzieren die Dialogabschnitte ueber ihre Ueberschriften
  (`General`, `Transcription`, `Azure`, `Proxy`) und ueber den Dialogtitel (`Settings`).
  Diese Selektoren wurden mituebersetzt; sonst scrollt die native Aufnahme ins Leere.
  Der Verbindungstest oeffnet seinen Dialog sofort und schliesst Settings: native
  Captures pruefen deshalb den sichtbaren Dialog, nicht die dort nicht vorhandenen
  Reopen-Buttons. Ein Bild laufender Diagnostik behauptet keinen fertigen Test.
- `scripts/capture-screenshots.mjs` bleibt bewusst ASCII-sicher. Labels, Demo-
  Transkripte, Diagnose-Fixtures und Debug-Meldungen sind englisch. Nur die Demo
  waehlt `en-US`; der Produktdefault bleibt `de-DE`. Die Demo-Aufnahme startet
  83 Sekunden vor dem Capture statt an einem festen historischen Datum, damit
  der Timer keine mehrtaegige Aufnahme suggeriert.
- Die `de-DE`-Sprachauswahl in der Primaeren Sprache bleibt als **Wert** erhalten
  (`de-DE` ist ein Azure-Sprachcode). Nur die **Anzeigenamen** der Sprachliste werden
  englisch (`German`, `English`, ...), damit das Dropdown zur englischen UI passt.
- `README.md` nannte bisher deutsche UI-Beschriftungen im Feature-Text
  (`Anzeigen`, `Beenden`, `Allgemein`). Diese Stellen wurden auf die neuen englischen
  Labels umgestellt, damit die Doku die realen Buttons benennt.
- Fuer v0.1.4 werden die Screenshots neu erzeugt, weil die alten Aufnahmen den deutschen
  UI-Stand zeigen und damit nicht mehr zum Produkt passen.
