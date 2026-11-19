# T-515: GitHub-Actions-Pipeline und Release-Veroeffentlichung

## Kontext
Status: umgesetzt (1 offener Punkt: echter Release-Download auf einem fremden Rechner)
Prioritaet: medium
Abhaengigkeiten: T-503, T-504, T-505

Bisher wurden alle Builds und Releases ausschliesslich lokal auf einem Windows-Entwicklerrechner
erzeugt. Das Repo hatte keinen `.github`-Ordner, also weder eine CI-Pipeline noch einen
automatischen Release-Pfad. Jede Veroeffentlichung war damit ein manueller,
nicht reproduzierbarer Schritt auf einem einzigen Rechner.

**Entscheidung:** Es gibt bewusst **keinen** automatischen Build bei Push oder Pull
Request. Der einzige Workflow startet bei einem Release-Tag. Ein Push auf `main` loest
keinen Build aus - Builds entstehen nur, wenn eine Veroeffentlichung tatsaechlich
veroeffentlicht werden soll.

## Done When
- [x] **Kein automatischer Build bei Push oder Pull Request** - der Workflow startet ausschliesslich bei einem Release-Tag. Beleg: `.github/workflows/release.yml`, Trigger `on.push.tags: v*` plus `workflow_dispatch` (manuell). Der einzige Workflow im Repo ist `release.yml`.
- [x] Release-Workflow baut aus dem Tag heraus die Portable-Distribution und veroeffentlicht sie als GitHub-Release mit ZIP-Asset. Beleg: `.github/workflows/release.yml`, Job `release`; ZIP-Name `MeetingNotes-v<version>-win-x64.zip`, zusaetzlich `SHA256SUMS.zip`. Testnachweis: `npm run typecheck`, `npm run test:unit`, `npm run check:specs`, `npm run tauri -- build --no-bundle`, `npm run dist:portable`, `npm run test:smoke`, `npm run verify:deployment`.
- [x] Der Workflow laesst sich auch manuell fuer ein bestehendes Tag ausloesen (`workflow_dispatch` mit `tag`-Input), damit ein Release nachgeholt werden kann, ohne das Tag zu verschieben. Beleg: `.github/workflows/release.yml`, `workflow_dispatch.inputs.tag`; vorhandenes Release wird per `gh release upload --clobber` ersetzt statt ein zweites anzulegen.
- [x] Das fehlende Release **v0.1.2** ist veroeffentlicht und als ZIP herunterladbar. Beleg: GitHub-Release `v0.1.2` (https://github.com/schirkan/meeting-notes-tauri/releases/tag/v0.1.2, veroeffentlicht 19.11.2026) mit Asset `MeetingNotes-v0.1.2-win-x64.zip` (16.469.792 Bytes, SHA256 `c917e8a89cebe100cbad570f0f98a9ad5b3c218dafd8716185b362477ae949f2`) plus `SHA256SUMS.txt` im `sha256sum`-Format. Das ZIP wurde vom Release-Workflow aus dem Tag-Stand `e3781c1` gebaut; der Asset-Digest von GitHub und der selbst berechnete Hash des heruntergeladenen ZIP stimmen ueberein, die 3 enthaltenen Dateien sind gegen die archivinterne `SHA256SUMS` verifiziert (**3/3 OK**), `MeetingNotes.exe` ProductVersion 0.1.2, `MeetingNotes.Sidecar.exe` FileVersion 0.1.2.0, entpackt **31,17 MB / 4 Dateien**.
- [x] Das Tag `v0.1.2` wurde vor der Veroeffentlichung auf den Commit mit der Release-Pipeline verschoben. Beleg: `git ls-remote --tags origin` zeigt `refs/tags/v0.1.2` auf `e3781c1`. Grund: Der erste Pipeline-Lauf scheiterte an `Get-FileHash` (das Utility-Modul fehlt auf Build-Runnern); der Fix liegt in `scripts/verify-deployment.ps1`. **Der Produktcode ist zwischen dem alten Tag-Stand `5b8d876` und `e3781c1` identisch** (`git diff --stat 5b8d876 v0.1.2 -- src src-tauri/src src-tauri/tauri.conf.json sidecar` ist leer) - es wurden nur Doku, Specs, Screenshots, Build-Skripte und die Pipeline geaendert. Der Tag enthaelt damit auch die korrigierte Workflow-Fassung (`SHA256SUMS.txt` statt `.zip`, kein `--target`), sodass ein Nachlauf des Releases korrekt arbeitet.
- [ ] Abnahme auf einem fremden Rechner: Download des ZIP, Entpacken, `MeetingNotes.exe` starten, Konfiguration neben der EXE entsteht. - **offen**: Der Download ist hier nur als Asset nachgewiesen; das Entpacken und der Start auf einem anderen Rechner mit WebView2 und Azure-Zugangsdaten ist nicht belegt.

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
  Node-Tests, Spec-Konsistenz, Rust-Tests, Build, Smoke und Deployment-Pruefung - alles
  ohne Audio-Hardware.
- `verify:deployment` prueft das Sidecar-Protokoll ueber `--list-devices`. Das
  funktioniert auch ohne Geraete, weil `DeviceResolver.ListDevices` die Default-Endpunkte
  per `try/catch` abfaengt und eine leere Liste statt eines Fehlers liefert.

## Verifikation

- Pipeline-Datei: `.github/workflows/release.yml` (einziger Workflow im Repo).
- Release v0.1.2 mit ZIP-Asset und SHA256-Summe; ZIP aus dem Tag-Commit `5b8d876` gebaut.
- `npm run check:specs` nach der Spec-Aenderung gruen.
