# Changelog

## v0.1.6 - 2026-11-23

### Added
- When quitting during a running or paused transcription, Meeting Notes asks for confirmation and saves finalized text as Markdown before exiting, even when automatic saving is off. Failed stops or writes leave the app open so you can recover the available transcript.
- **Hide from taskbar** is a separate, default-on window setting with a fallback when the tray cannot initialize.

### Changed
- Automatic transcription start and stop are under **General**. Settings fields have explanatory tooltips.

### Fixed
- A delayed **Clear** response no longer deletes a newer automatic session, and taking over an active session preserves its text and speaker aliases when the status changes.
- Manual Markdown export and Stop show specific errors. A sidecar failure cannot count as a clean shutdown, and reconnects no longer prevent the sidecar from accepting shutdown.
- The sidecar waits for Azure result delivery before acknowledging a clean stop; fixed protocol fields no longer depend on secret redaction.

## v0.1.5 - 2026-11-23

### Added
- **About** now shows the installed app version below the product name.

### Fixed
- Automatic meeting detection watches all capture and playback devices that are active when the detector starts, not just Windows' default multimedia devices.
- The default meeting-process list recognizes both `teams.exe` and `ms-teams.exe`.

### Known limitations
- Restart the detector after connecting a new audio device. This change does not affect which devices are used for transcription.
- Optimized Teams VDI can process call audio outside the VM; automatic detection still requires a local Windows audio session.

## v0.1.4 - 2026-11-20

### Added
- **About dialog:** The three-dot menu now offers **About** with the app icon, repository link, author and license. The link opens the repository page through the new shell integration (`open_repository`).
- **Dev tools (F12):** The WebView2 developer tools can be opened directly from the three-dot menu.
- **Transcription section:** The primary language now lives in its own dialog section **Transcription**; **General** contains only the system tray setting.
- **Audio controls on the start page only:** Microphone, speaker loopback and speaker recognition are now only available in the idle state of the start page.
- **Temporary dialog draft:** Dialog changes stay in a draft until **Save** is clicked. Closing with X, Escape or the backdrop asks about unsaved changes; the connection test uses the draft without saving it.

### Changed
- **English throughout:** UI labels, accessibility text, notifications, diagnostics, error/recovery messages and tray text are now English.
- README, end-user documentation, the configuration example, GitHub description and release notes are now English. Internal specs and agent documentation remain German.
- Display dates and times use `en-US`. The default transcription language remains `de-DE`; existing settings, protocol keys and filenames are unchanged.
- New native and renderer screenshots show the English interface; renderer demo transcripts and diagnostics are also English.
- The start page audio panel is shifted 150 px to the right on wide windows so it does not disappear behind the inspector; narrow windows (<= 1100 px) stay centered.
- Webpage context menus are suppressed outside editable text fields; native menus are unaffected.

### Fixed
- Updated the diarization regression test to find audio controls on the start page, not in the settings dialog. The 150 px audio-panel offset now only applies above 1100 px, matching the responsive layout.
- Updated UI-test and screenshot selectors for the English labels, including Resume, Follow and debug controls.
- The debug error count uses the correct singular/plural form; demo recording timers no longer suggest multi-day recordings.

### Verification
- Full local verification: 9 successful steps; 98 Node tests, 47 Rust tests,
  539 source / 552 published-sidecar C# assertions; smoke test passed,
  deployment PASS 9 / FAIL 0.
- The noninteractive Media Foundation sample remains skipped. Existing hardware,
  live Azure, clean-machine and remaining tray acceptance limits are unchanged.

### Release
- [Release v0.1.4](https://github.com/schirkan/meeting-notes-tauri/releases/tag/v0.1.4)
  built from commit `37f0bab` by the successful release workflow.
- `MeetingNotes-v0.1.4-win-x64.zip`: 16,499,074 bytes;
  SHA256 `10fbb0facda1460b9db431708f19e85aac1b86eb7510479ad35689394e2b73a5`.
- Independently downloaded and checked: ZIP digest matches GitHub and
  `SHA256SUMS.txt`; all 3 internal hashes match. Four extracted files,
  main EXE 0.1.4, sidecar 0.1.4.0; downloaded-release deployment PASS 9 / FAIL 0.

## v0.1.3 - 2026-11-19

### Added
- **Settings dialog on a single page:** All settings are stacked on one scrolling page. The sections **General**, **Audio**, **Azure** and **Proxy** appear as headings in that order - without tabs and without section navigation; everything stays visible at the same time and is merely scrolled.
- **Dedicated Audio section:** Microphone and speaker loopback live there with their device selection and the speaker recognition.
- **Auto-stop separately switchable:** new option `user.autoStart.autoStop` ("Stop recording automatically when the meeting was started automatically"). When switched off, the automatically started recording keeps running until it is stopped manually. Enabled by default; missing fields receive `true`, an explicitly saved `false` is preserved.

### Changed
- **Test connection** now sits in the dialog footer next to **Save** instead of in the Azure section; reopening the running/last test remains reachable there as well.
- The tray icon turns **red** while recording and **yellow** while paused; after a stop or a sidecar crash it returns to its original color.
- The save path for the Markdown export sits directly below its checkbox "Save transcript automatically as Markdown".

### Verification
- `npm run verify -- --full`: 9 steps green; 94 Node tests, 47 Rust tests,
  539 C# assertions against the sources / 552 against the published sidecar.
- Portable build: main EXE `ProductVersion` 0.1.3; sidecar `FileVersion` 0.1.3.0.
  Smoke test passed; deployment PASS 9 / FAIL 0.
- Manual user acceptance on 2026-11-19: tray icon, context menu, double-click and
  closing via X with both settings confirmed. Alt+F4 and quitting during a
  recording remain open
  ([T-514](./specs/T-514-systray-und-schliessen-verhalten.md)).

### Release
- [Release v0.1.3](https://github.com/schirkan/meeting-notes-tauri/releases/tag/v0.1.3)
  with `MeetingNotes-v0.1.3-win-x64.zip` (16,496,793 bytes) and `SHA256SUMS.txt`.
- ZIP SHA256: `e84d5a58fdb69d0724bb7755428cdf21a5ecc2e85fab24b2c0891fdea1c4cbf7`.

## v0.1.2 - 2026-11-18

### Added
- Automatic meeting recording via the Windows AudioSessionManager.
- A matching auto-stop, when all capture/render sessions of the triggering
  process stay inactive for at least 3 seconds. Manual recordings are protected.
- System tray icon with **Show** and **Quit**. A left double-click restores the
  existing main window and focuses it.
- Setting **Minimize to system tray on close**: hiding keeps recording and
  meeting detection running; quitting from the tray ends the app.

### Changed
- **Auto-recording including auto-stop and close-to-tray are enabled by default.**
- Missing settings fields receive the new defaults. Already explicitly saved
  `false` values are preserved; no forced migration of personal configurations.
- Application and sidecar carry version 0.1.2. The IPC protocol stays compatible at 1.0.0.
- Self-contained single-file sidecar: no separate .NET installation on the target system.

### Verification
- `npm run verify -- --full`: 9 steps green; 92 Node tests,
  539 C# assertions against the sources / 552 against the published sidecar.
- Additionally 44 Rust tests passed.
- Fresh portable build: 31.37 MB / 4 files / 3 verified SHA256 sums.
  Main EXE ProductVersion 0.1.2; sidecar FileVersion 0.1.2.0.
- Smoke test passed; deployment PASS 9 / FAIL 0. Tray icon acceptance natively proven, context menu/double-click acceptance and the known
  MediaFoundation probe SKIPPED; these are not passed acceptances.

### Release pipeline
- GitHub Actions builds and publishes the releases: **exclusively on a release tag** (`release.yml`) - no automatic build on push or pull request. The workflow checks out exactly the tag, runs typecheck, Node tests and spec consistency, builds the portable distribution, verifies it with the smoke test and the deployment check and publishes ZIP + `SHA256SUMS` as a release asset. `workflow_dispatch` catches up a missing release without moving the tag.
- The release **v0.1.2** was added later: ZIP from the tag, produced by the release workflow - **16,469,792 bytes** (SHA256 `c917e8a8…949f2`), unpacked **31.17 MB / 4 files**, `SHA256SUMS.txt` as a second asset in `sha256sum` format, all 3 files verified against the sums.
- The tag `v0.1.2` was moved before publication to the commit with the pipeline (the product code between the two states is identical).

### Known limits
- Recording still requires a complete Azure configuration.
- The end of an audio session is a heuristic, not a guaranteed meeting end.
  Real Teams/Zoom acceptance and a podcast cross-check are still outstanding.
- The native tray/mouse/focus acceptance cannot be executed on the current non-interactive
  build host via the session bridge. Win32 probe and open points: [T-514](./specs/T-514-systray-und-schliessen-verhalten.md).
- Live latency, clean-machine acceptance and the known MF probe remain open.
- An interactive user session exists on this host (session 1 with Explorer).
  The gateway runs in session 0 and cannot see it; a scheduled task with
  LogonType=Interactive bridges this. Native screenshots and the tray icon proof
  are therefore possible, context menu and double-click are not.

The version tag and the GitHub release assets are two separate publications.
