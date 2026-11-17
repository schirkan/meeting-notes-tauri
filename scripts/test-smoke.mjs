#!/usr/bin/env node
/**
 * Smoke-Test for the meeting-notes-tauri build artifacts.
 *
 * Spec: specs/T-501-smoke-test-tauri-und-sidecar.md
 *
 * Prerequisite: `npm run tauri build` and `npm run dist:portable`
 * must have run successfully (so the artifacts exist). The test
 * verifies them — it does NOT rebuild them.
 *
 * Steps:
 *   1. Renderer-Build-Artefakte in dist/ vorhanden?
 *   2. Tauri-EXE vorhanden + Reagieren auf --version?
 *   3. Sidecar-EXE vorhanden + --list-devices liefert valides device_list-Event?
 *   4. Portable-Distribution vorhanden + SHA256SUMS konsistent?
 *   5. Settings-Defaults in den TS-Contracts vorhanden?
 *
 * Exit-Codes: 0 = alles OK, 1 = mindestens ein Schritt fehlgeschlagen.
 *
 * Usage:  node scripts/test-smoke.mjs
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..')

const TAURI_EXE = join(PROJECT_ROOT, 'src-tauri', 'target', 'release', 'MeetingNotes.exe')
const SIDECAR_EXE = join(PROJECT_ROOT, 'src-tauri', 'target', 'sidecar-publish', 'MeetingNotes.Sidecar.exe')
const DIST_DIR = join(PROJECT_ROOT, 'dist')
const PORTABLE_DIR = join(PROJECT_ROOT, 'dist', 'portable')
const PORTABLE_TAURI = join(PORTABLE_DIR, 'MeetingNotes.exe')
const PORTABLE_SIDECAR = join(PORTABLE_DIR, 'MeetingNotes.Sidecar.exe')
const PORTABLE_SHA256SUMS = join(PORTABLE_DIR, 'SHA256SUMS')
const TRANSCRIPT_CONTRACT = join(PROJECT_ROOT, 'src', 'shared', 'transcript-contract.ts')

const failures = []
const missingRuntimeRoot = join(tmpdir(), randomUUID())
const invalidDeps = `${missingRuntimeRoot}.deps.json`
writeFileSync(invalidDeps, '{')
process.on('exit', () => rmSync(invalidDeps, { force: true }))

function selfContainedEnvironment() {
  return {
    ...process.env,
    DOTNET_ROOT: missingRuntimeRoot,
    DOTNET_ROOT_X64: missingRuntimeRoot,
    DOTNET_ROOT_ARM64: missingRuntimeRoot,
    DOTNET_MULTILEVEL_LOOKUP: '0',
    DOTNET_ADDITIONAL_DEPS: invalidDeps
  }
}

function pass(label, detail) {
  console.log(`  \u2713 ${label}${detail ? `: ${detail}` : ''}`)
}

function fail(label, detail) {
  console.error(`  \u2717 ${label}${detail ? `: ${detail}` : ''}`)
  failures.push(label)
}

function header(text) {
  console.log('')
  console.log(`== ${text} ==`)
}

// Die Renderer-Assets muessen in der Tauri-EXE eingebettet sein. Das passiert
// nur ueber die Tauri-CLI ('npm run tauri build' bzw. 'tauri build --no-bundle').
// Ein reines 'cargo build --release' erzeugt dagegen eine EXE ohne UI-Assets -
// der Smoke-Test faengt genau das ab.
function rendererAssetNames() {
  if (!existsSync(assetsDir)) return []
  return readdirSync(assetsDir).filter((f) => statSync(join(assetsDir, f)).isFile())
}

function checkEmbeddedAssets(exePath, label) {
  if (!existsSync(exePath)) {
    fail(label, 'missing')
    return
  }
  const names = ['index.html', ...rendererAssetNames()]
  if (names.length < 2) {
    fail(label, 'dist/assets/ empty - run \'npm run build\' first')
    return
  }
  const buf = readFileSync(exePath)
  const missing = names.filter((n) => !buf.includes(Buffer.from(n, 'utf8')))
  if (missing.length === 0) {
    pass(label, `${names.length} assets embedded`)
  } else {
    fail(label, `not embedded: ${missing.join(', ')} - rebuild with 'npm run tauri build'`)
  }
}

// --- 1. Renderer-Build-Artefakte -----------------------------------------

header('1. Renderer-Build-Artefakte')

const rendererIndex = join(DIST_DIR, 'index.html')
if (existsSync(rendererIndex)) {
  const html = readFileSync(rendererIndex, 'utf8')
  if (html.includes('<html') && html.length > 50) {
    pass('dist/index.html', `${html.length} bytes`)
  } else {
    fail('dist/index.html', 'looks empty or malformed')
  }
} else {
  fail('dist/index.html', 'missing — run `npm run build`')
}

const assetsDir = join(DIST_DIR, 'assets')
if (existsSync(assetsDir)) {
  pass('dist/assets/', 'present')
} else {
  fail('dist/assets/', 'missing')
}

// --- 2. Tauri-EXE --------------------------------------------------------

header('2. Tauri-EXE')

if (existsSync(TAURI_EXE)) {
  const sizeMb = (statSync(TAURI_EXE).size / 1024 / 1024).toFixed(2)
  pass('src-tauri/target/release/MeetingNotes.exe', `${sizeMb} MB`)
  checkEmbeddedAssets(TAURI_EXE, 'release EXE renderer assets')
} else {
  fail('src-tauri/target/release/MeetingNotes.exe', 'missing — run `npm run tauri build`')
}

// --- 3. Sidecar-EXE + device_list ---------------------------------------

header('3. Sidecar-EXE')

if (existsSync(SIDECAR_EXE)) {
  const sizeMb = (statSync(SIDECAR_EXE).size / 1024 / 1024).toFixed(2)
  pass('src-tauri/target/sidecar-publish/MeetingNotes.Sidecar.exe', `${sizeMb} MB`)

  console.log('  ...spawning with --list-devices')
  const proc = spawnSync(SIDECAR_EXE, ['--list-devices'], {
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true,
    env: selfContainedEnvironment()
  })

  if (proc.error) {
    fail('sidecar --list-devices', `spawn error: ${proc.error.message}`)
  } else if (proc.status !== 0) {
    fail('sidecar --list-devices', `exit=${proc.status}, stderr=${proc.stderr?.slice(0, 200)}`)
  } else {
    const lines = (proc.stdout || '').split('\n').filter(Boolean)
    const deviceListLine = lines.find((l) => l.includes('"type":"device_list"'))
    if (!deviceListLine) {
      fail('sidecar --list-devices', `no device_list event in stdout (got ${lines.length} lines)`)
    } else {
      try {
        const parsed = JSON.parse(deviceListLine)
        const inputs = parsed?.payload?.Inputs ?? []
        const outputs = parsed?.payload?.Outputs ?? []
        if (!Array.isArray(inputs) || !Array.isArray(outputs)) {
          fail('sidecar device_list payload', 'Inputs/Outputs not arrays')
        } else {
          pass('self-contained sidecar --list-devices', `inputs=${inputs.length} outputs=${outputs.length}; invalid DOTNET_ROOT/additional deps ignored`)
        }
      } catch (e) {
        fail('sidecar device_list JSON', e.message)
      }
    }
  }
} else {
  fail('src-tauri/target/sidecar-publish/MeetingNotes.Sidecar.exe', 'missing — run `npm run tauri build`')
}

// --- 3b. Protokoll-Handshake (T-201) --------------------------------------

header('3b. Protokoll-Handshake')

// Der Sidecar sendet zu Beginn ein handshake-Event. Ohne dieses Event
// beendet die App den Sidecar nach 5 s (Timeout) - der Smoke-Test prueft
// deshalb end-to-end, dass die Zeile wirklich kommt.
if (existsSync(SIDECAR_EXE)) {
  const handshake = spawnSync(SIDECAR_EXE, ['--transcription-mic', 'false', '--transcription-speaker', 'false'], {
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
    env: selfContainedEnvironment()
  })
  const firstLine = (handshake.stdout || '')
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean)

  if (!firstLine) {
    fail('sidecar handshake', 'no output on stdout')
  } else {
    try {
      const parsed = JSON.parse(firstLine)
      const payload = parsed?.payload ?? {}
      if (parsed?.type !== 'handshake') {
        fail('sidecar handshake', `first event is "${parsed?.type}", expected "handshake"`)
      } else if (payload?.protocol_version !== '1.0.0') {
        fail('sidecar handshake', `unexpected protocol_version "${payload?.protocol_version}"`)
      } else {
        pass('sidecar handshake', `protocol_version=${payload.protocol_version}, capabilities=${(payload.capabilities || []).length}`)
      }
    } catch (e) {
      fail('sidecar handshake', `first line is not JSON: ${e.message}`)
    }
  }
} else {
  fail('sidecar handshake', 'sidecar executable missing')
}

// --- 4. Portable-Distribution + SHA256SUMS -------------------------------

header('4. Portable-Distribution')

if (existsSync(join(PORTABLE_DIR, 'sidecar'))) {
  fail('portable layout', 'unexpected sidecar directory; sidecar must be next to MeetingNotes.exe')
}

if (existsSync(PORTABLE_TAURI)) {
  pass('dist/portable/MeetingNotes.exe', `${(statSync(PORTABLE_TAURI).size / 1024 / 1024).toFixed(2)} MB`)
  checkEmbeddedAssets(PORTABLE_TAURI, 'portable EXE renderer assets')
} else {
  fail('dist/portable/MeetingNotes.exe', 'missing — run `npm run dist:portable`')
}

if (existsSync(PORTABLE_SIDECAR)) {
  pass('dist/portable/MeetingNotes.Sidecar.exe', `${(statSync(PORTABLE_SIDECAR).size / 1024 / 1024).toFixed(2)} MB`)
  const probe = spawnSync(PORTABLE_SIDECAR, ['--list-devices'], {
    encoding: 'utf8', timeout: 15000, windowsHide: true, env: selfContainedEnvironment()
  })
  if (probe.error || probe.status !== 0) {
    fail('portable self-contained sidecar', probe.error?.message || `exit=${probe.status}, stderr=${probe.stderr?.slice(0, 200)}`)
  } else {
    try {
      const event = JSON.parse(probe.stdout.trim())
      if (event.type !== 'device_list' || !Array.isArray(event.payload?.Inputs) || !Array.isArray(event.payload?.Outputs)) {
        fail('portable self-contained sidecar', 'invalid device_list payload')
      } else {
        pass('portable self-contained sidecar', 'starts without installed runtime probing')
      }
    } catch (error) {
      fail('portable self-contained sidecar', error.message)
    }
  }
} else {
  fail('dist/portable/MeetingNotes.Sidecar.exe', 'missing — run `npm run dist:portable`')
}

if (existsSync(PORTABLE_SHA256SUMS)) {
  // Validate every line: SHA256  filename
  const lines = readFileSync(PORTABLE_SHA256SUMS, 'utf8').split('\n').filter(Boolean)
  let mismatched = 0
  let checked = 0
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64})\s+(.+)$/)
    if (!match) {
      mismatched++
      continue
    }
    const [, expectedHash, relPath] = match
    const absPath = join(PORTABLE_DIR, relPath.replaceAll('/', '\\'))
    if (!existsSync(absPath)) {
      mismatched++
      continue
    }
    // Stream-hash to avoid loading large DLLs into memory.
    const hash = createHash('sha256')
    await pipeline(createReadStream(absPath), hash)
    const actual = hash.digest('hex')
    if (actual !== expectedHash) {
      mismatched++
    }
    checked++
  }
  if (mismatched === 0 && checked === lines.length) {
    pass('SHA256SUMS', `${checked}/${lines.length} hashes match`)
  } else {
    fail('SHA256SUMS', `${mismatched}/${lines.length} mismatches`)
  }
} else {
  fail('dist/portable/SHA256SUMS', 'missing — run `npm run dist:portable`')
}

// --- 5. TS-Contract-Sanity ----------------------------------------------

header('5. Transcript-Contract')

if (existsSync(TRANSCRIPT_CONTRACT)) {
  const content = readFileSync(TRANSCRIPT_CONTRACT, 'utf8')
  const required = ['TranscriptSegment', 'TranscriptStatus', 'TranscriptApi', 'DebugLogEntry', 'TranscriptError']
  const missing = required.filter((name) => !content.includes(name))
  if (missing.length === 0) {
    pass('transcript-contract.ts', `contains ${required.length} required types`)
  } else {
    fail('transcript-contract.ts', `missing types: ${missing.join(', ')}`)
  }
} else {
  fail('transcript-contract.ts', 'missing')
}

// --- Summary -------------------------------------------------------------

console.log('')
if (failures.length === 0) {
  console.log('\u2705 Smoke-Test bestanden.')
  process.exit(0)
} else {
  console.error(`\u274c Smoke-Test fehlgeschlagen: ${failures.length} Schritt(e) fehlerhaft:`)
  for (const f of failures) console.error(`   - ${f}`)
  process.exit(1)
}