# T-515: GitHub-Actions-Pipeline und Release-Veroeffentlichung

## Kontext
Status: umgesetzt
Prioritaet: medium
Abhaengigkeiten: T-503, T-504, T-505

Bisher wurden alle Builds und Releases ausschliesslich lokal auf einem Windows-Entwicklerrechner
erzeugt. Das Repo hatte keinen `.github`-Ordner, also weder eine CI-Pipeline noch einen
automatischen Release-Pfad vor dieser Aufgabe. Jede Veroeffentlichung war damit ein manueller,
nicht reproduzierbarer Schritt auf einem einzigen Rechner.

**Entscheidung:** Es gibt bewusst **keinen** automatischen Build bei Push oder Pull
Request. Der einzige Workflow startet bei einem Release-Tag oder manuell fuer ein bestehendes Tag. Ein Push auf `main` loest
keinen Build aus - Builds entstehen nur, wenn eine Veroeffentlichung tatsaechlich
veroeffentlicht werden soll.

## Done When
- [x] **Kein automatischer Build bei normalen Branch-Pushes oder Pull Requests**. Beleg: `.github/workflows/release.yml`, Trigger `on.push.tags: v*` plus `workflow_dispatch` (manuell). Der einzige Workflow im Repo ist `release.yml`.
- [x] Release-Workflow baut aus dem Tag heraus die Portable-Distribution und veroeffentlicht sie als GitHub-Release mit ZIP-Asset. Beleg: `.github/workflows/release.yml`, Job `release`; ZIP-Name `MeetingNotes-v<version>-win-x64.zip`, zusaetzlich `SHA256SUMS.txt`. Runner-Schritte: `npm run typecheck`, `npm run test:unit`, `npm run tauri -- build --no-bundle`, `npm run dist:portable`, `npm run test:smoke`, `npm run verify:deployment`.
- [x] Der Workflow laesst sich auch manuell fuer ein bestehendes Tag ausloesen (`workflow_dispatch` mit `tag`-Input), damit ein Release nachgeholt werden kann, ohne das Tag zu verschieben. Beleg: `.github/workflows/release.yml`, `workflow_dispatch.inputs.tag`; vorhandenes Release wird per `gh release upload --clobber` ersetzt statt ein zweites anzulegen.
- [x] Das fehlende Release **v0.1.2** ist veroeffentlicht und als ZIP herunterladbar. Beleg: GitHub-Release `v0.1.2` (https://github.com/schirkan/meeting-notes-tauri/releases/tag/v0.1.2, veroeffentlicht 19.11.2026) mit Asset `MeetingNotes-v0.1.2-win-x64.zip` (16.469.792 Bytes, SHA256 `c917e8a89cebe100cbad570f0f98a9ad5b3c218dafd8716185b362477ae949f2`) plus `SHA256SUMS.txt` im `sha256sum`-Format. Das ZIP wurde vom Release-Workflow aus dem Tag-Stand `e3781c1` gebaut; der Asset-Digest von GitHub und der selbst berechnete Hash des heruntergeladenen ZIP stimmen ueberein, die 3 enthaltenen Dateien sind gegen die archivinterne `SHA256SUMS` verifiziert (**3/3 OK**), `MeetingNotes.exe` ProductVersion 0.1.2, `MeetingNotes.Sidecar.exe` FileVersion 0.1.2.0, entpackt **31,17 MB / 4 Dateien**.
- [x] Das Tag `v0.1.2` wurde vor der Veroeffentlichung auf den Commit mit der Release-Pipeline verschoben. Beleg: `git ls-remote --tags origin` zeigt `refs/tags/v0.1.2` auf `e3781c1`. Grund: Der erste Pipeline-Lauf scheiterte an `Get-FileHash` (das Utility-Modul fehlt auf Build-Runnern); der Fix liegt in `scripts/verify-deployment.ps1`. **Der Produktcode ist zwischen dem alten Tag-Stand `5b8d876` und `e3781c1` identisch** (`git diff --stat 5b8d876 v0.1.2 -- src src-tauri/src src-tauri/tauri.conf.json sidecar` ist leer) - es wurden nur Doku, Specs, Screenshots, Build-Skripte und die Pipeline geaendert. Der Tag enthaelt damit auch die korrigierte Workflow-Fassung (`SHA256SUMS.txt` statt `.zip`, kein `--target`), sodass ein Nachlauf des Releases korrekt arbeitet.
- [x] Abnahme auf einem fremden Rechner: Download des ZIP, Entpacken, `MeetingNotes.exe` starten, Konfiguration neben der EXE entsteht. Beleg: manuelle Nutzerabnahme vom 19.11.2026, im Gespraech bestaetigt (Download und Start funktionieren; verbleibende Einschraenkungen betreffen Alt+F4 und Exit waehrend Aufnahme in [T-514](./T-514-systray-und-schliessen-verhalten.md)). Keine Live-Azure-/Latenzabnahme daraus abgeleitet.

## Approach
- Der Workflow laeuft auf `windows-latest`, weil der Sidecar eine Windows-Runtime braucht und
  `tauri build` den Sidecar ueber `src-tauri/build.rs` selbst publiziert.
- Die Toolchain wird im Workflow explizit gesetzt: Node 24 (`.node-version` ist nicht im
  Repo, `package.json` fordert `>=22.12.0 <27`), .NET 10 SDK und Rust stable mit MSVC.
- `npm ci` statt `npm install`, damit `package-lock.json` die exakten Versionen fixiert.
- Cargo-Cache ueber `actions/cache` mit `src-tauri/Cargo.lock` als Schluessel.
- Die Pipeline fuehrt dieselben Skripte aus wie der lokale Weg (`npm run tauri -- build
  --no-bundle`, `npm run dist:portable`, `npm run test:smoke`, `npm run verify:deployment`),
  damit das Release-Asset dem lokalen Build entspricht.
- Die C#-Validierung (`npm run test:sidecar`) laeuft bewusst **nicht** im Workflow: sie
  braucht reale Audio-Hardware und einen Core-Audio-Session-Graphen. GitHub-Runner haben
  keine Aufnahme- und keine Wiedergabegeraete; der Test wuerde dort mit
  `CoreAudioException 0x80070490` abbrechen. Der Workflow prueft stattdessen Typecheck,
  Node-Tests, Build, Smoke und Deployment-Pruefung - alles ohne Audio-Hardware.
  Spec-Konsistenz und Rust-Tests werden lokal zusaetzlich ausgefuehrt; sie sind
  keine Schritte des aktuellen Release-Workflows.
- `verify:deployment` prueft das Sidecar-Protokoll ueber `--list-devices`. Das
  funktioniert auch ohne Geraete, weil `DeviceResolver.ListDevices` die Default-Endpunkte
  per `try/catch` abfaengt und eine leere Liste statt eines Fehlers liefert.

## Release-Notes pflegen

- Der Workflow erstellt allgemeine Release-Notes und uebernimmt den
  [Changelog](../CHANGELOG.md) nicht automatisch. Nach der Veroeffentlichung
  die GitHub-Release-Notes um einen englischen Abschnitt `### What's new`
  direkt vor `### Included` ergaenzen.
- Die wichtigsten Nutzeraenderungen aus dem Changelog zusammenfassen. Bei
  experimentellen Funktionen Standardwert, Aktivierung und noch offene
  Abnahmen nennen. Nur den Release-Text bearbeiten, nicht Tag oder Downloads;
  danach den aktualisierten Text auf GitHub kontrollieren.

## Verifikation

### Release v0.1.3 (19.11.2026)
Der parallel eingegangene Remote-Commit `0caf00b` dokumentiert die
[Veroeffentlichung v0.1.3](https://github.com/schirkan/meeting-notes-tauri/releases/tag/v0.1.3)
aus Tag-Stand `3163e2a`, gebaut durch
[Workflow-Run 44629755890](https://github.com/schirkan/meeting-notes-tauri/actions/runs/44629755890).
Diese Detailnachweise wurden beim Merge aus der alten Agentenchronik hierher
uebernommen; sie sind kein erneut ausgefuehrter Release-Download dieses Sync-Laufs.

- Assets: `MeetingNotes-v0.1.3-win-x64.zip` (16.496.793 Bytes) und `SHA256SUMS.txt`.
- Dokumentierter ZIP-SHA256: `e84d5a58fdb69d0724bb7755428cdf21a5ecc2e85fab24b2c0891fdea1c4cbf7`.
- Dokumentierte Gegenprobe: 4 Dateien / 31,26 MB entpackt, Haupt-EXE
  ProductVersion 0.1.3, Sidecar FileVersion 0.1.3.0; berechneter Hash entspricht
  dem GitHub-Asset-Digest.
- Dokumentierter Vollnachweis: 9 Verifikationsschritte, 94 Node-Tests,
  47 Rust-Tests, 539 C#-Assertions gegen Quellen / 552 gegen publizierten Sidecar,
  Deployment PASS 9 / FAIL 0; alle Workflow-Schritte gruen.
- Native Screenshots nutzen Mausrad-Nachrichten am WebView2-Render-Host fuer die
  Abschnittspositionierung: ScrollItemPattern scrollte die Seitenwurzel statt
  des Settings-Grids; ScrollPattern lieferte keine brauchbaren Werte. Umsetzung:
  [capture-native-screenshots.ps1](../scripts/capture-native-screenshots.ps1).

### Release v0.1.4 (20.11.2026)

[Workflow-Run 44790203600](https://github.com/schirkan/meeting-notes-tauri/actions/runs/44790203600)
veroeffentlichte `v0.1.4` aus Commit `37f0bab` erfolgreich in 4m36s. ZIP und
Pruefsummen wurden anschliessend direkt vom Release heruntergeladen und auf
Hashes, Versionen, flaches Dateilayout und Deployment geprueft. Detaillierter
Asset-Nachweis und Abnahmegrenzen stehen in [T-516](./T-516-englische-oberflaeche-und-oeffentliche-doku.md#release-nachweis-20112026).

### Release v0.1.5 (23.11.2026)

[Workflow-Run 45182209606](https://github.com/schirkan/meeting-notes-tauri/actions/runs/45182209606)
veroeffentlichte [v0.1.5](https://github.com/schirkan/meeting-notes-tauri/releases/tag/v0.1.5)
aus Tag-Commit `91b511a` erfolgreich in 5m27s. ZIP und `SHA256SUMS.txt`
wurden direkt vom Release heruntergeladen. Das ZIP hat 16.499.926 Bytes;
GitHub-Digest, externer Pruefsummeneintrag und berechneter SHA256 stimmen ueberein:
`a0b12dbd5c778972ec6bc413516e40f9811a9ee576298101f004f80e87c559a9`.
Alle drei internen Dateihashes stimmen. Haupt-EXE ProductVersion 0.1.5,
Sidecar FileVersion 0.1.5.0; Download-Deployment PASS 9 / FAIL 0.

Lokal: 98 Node- und 47 Rust-Tests, 543 C#-Assertions gegen Quellen und 556
gegen den gebauten Sidecar im isolierten Nachlauf. Im ersten Lauf fehlte das
Meeting-Endsignal. Mangels zweitem Mikrofon wurde der Nicht-Standard-Endpunkt
nicht erneut abgenommen; die MediaFoundation-Stichprobe blieb uebersprungen.
Keine neue Live-Teams-, Azure- oder Clean-Machine-Abnahme.

### Release v0.1.6 (23.11.2026)

[Workflow-Run 45243730261](https://github.com/schirkan/meeting-notes-tauri/actions/runs/45243730261)
veroeffentlichte [v0.1.6](https://github.com/schirkan/meeting-notes-tauri/releases/tag/v0.1.6)
aus Tag-Commit `33e02de` in 4m55s. Download-ZIP: 16.540.163 Bytes.
GitHub-Digest, `SHA256SUMS.txt` und berechneter ZIP-Hash stimmen ueberein:
`f3d6711bbfc6c7f88f48ddc7c673f0b53d0d4f621bbfc856d20ec1199021ee46`.
Vier Dateien im ZIP; interne Dateihashes 3/3, Haupt-EXE ProductVersion 0.1.6,
Sidecar FileVersion 0.1.6.0, Download-Deployment PASS 9 / FAIL 0.

Lokal: 9 Verifikationsschritte, 106 Node- und 52 Rust-Tests, 553 C#-Assertions
gegen Quellen und 566 gegen den publizierten Sidecar. MediaFoundation-Probe und
Nicht-Standard-Mikrofontest uebersprungen. Native Quit-/Taskleisten-Abnahme und
Live-Test des letzten Azure-Ergebnisses stehen aus.

### Release v0.1.7 (24.11.2026)

[Workflow-Run 45337473666](https://github.com/schirkan/meeting-notes-tauri/actions/runs/45337473666)
veroeffentlichte [v0.1.7](https://github.com/schirkan/meeting-notes-tauri/releases/tag/v0.1.7)
aus Tag-Commit `c00d50a` in 5m20s. Download-ZIP: 16.553.513 Bytes.
GitHub-Digest, `SHA256SUMS.txt` und berechneter ZIP-Hash stimmen ueberein:
`5c5ef3667b3394a6ea1287f8dcb887706df17c419944b52bfb215ea3ba0ed08d`.
Vier Dateien im ZIP; interne Dateihashes 3/3, Haupt-EXE ProductVersion 0.1.7,
Sidecar FileVersion 0.1.7.0, Beispielkonfiguration `echoCancellation: false`,
Download-Deployment PASS 9 / FAIL 0.

Lokal: 9 Verifikationsschritte, 108 Node- und 53 Rust-Tests; 582 C#-Assertions
gegen Quellen, 595 mit gebautem Sidecar. Die Echo-Wirksamkeit wurde mit
synthetischem PCM geprueft. Die damalige Hardware- und Live-Azure-Abnahme
wurde mit der Entfernung der Alpha gegenstandslos ([T-519](./T-519-echo-cancellation-alpha-abnahme.md)).

### Release v0.1.9 (25.11.2026)

[Workflow-Run 45659115487](https://github.com/schirkan/meeting-notes-tauri/actions/runs/45659115487)
war fuer Tag-Commit `529800a` erfolgreich. GitHub fuehrt [v0.1.9](https://github.com/schirkan/meeting-notes-tauri/releases/tag/v0.1.9)
als veroeffentlicht. Das belegt den Pipeline-Erfolg, nicht eine erneute lokale
Download-, Hardware- oder Live-Azure-Abnahme.

### Release v0.2.0 (28.11.2026)

Der Release-Pfad prueft, dass Tag und App-Version uebereinstimmen, und liest
die versionsbezogenen Release Notes aus `CHANGELOG.md`. Das Portable-ZIP
muss die zueinander passenden Binaries mit Sidecar-Protokoll 2.0.0 enthalten.
Der Tag-Workflow baut das Paket, prueft Smoke und Deployment und publiziert
ZIP und SHA256-Datei zusammen. Workboard: `bbef3512-a868-402f-9255-58534d7a1dc4`.

### Weitere Nachweise

- 19.11.2026: Manueller Release-Download und Start auf fremdem Rechner vom Nutzer bestaetigt; siehe auch [T-500](./T-500-qualitaetssicherung-und-akzeptanztests.md).

- Pipeline-Datei: `.github/workflows/release.yml` (einziger Workflow im Repo).
- Release v0.1.2 mit ZIP-Asset und SHA256-Summe; veroeffentlichtes ZIP aus dem
  korrigierten Tag-Commit `e3781c1` gebaut (historischer Vorlaeufer `5b8d876`, siehe oben).
- `npm run check:specs` nach der Spec-Aenderung gruen.
