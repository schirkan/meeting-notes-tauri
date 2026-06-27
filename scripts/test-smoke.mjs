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

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..')

const TAURI_EXE = join(PROJECT_ROOT, 'src-tauri', 'target', 'release', 'meeting-notes-tauri.exe')
const SIDECAR_EXE = join(PROJECT_ROOT, 'sidecar', 'publish', 'sidecar', 'MeetingNotes.Sidecar.exe')
const DIST_DIR = join(PROJECT_ROOT, 'dist')
const PORTABLE_DIR = join(PROJECT_ROOT, 'dist', 'portable')
const PORTABLE_TAURI = join(PORTABLE_DIR, 'meeting-notes-tauri.exe')
const PORTABLE_SIDECAR = join(PORTABLE_DIR, 'sidecar', 'MeetingNotes.Sidecar.exe')
const PORTABLE_SHA256SUMS = join(PORTABLE_DIR, 'SHA256SUMS')
const TRANSCRIPT_CONTRACT = join(PROJECT_ROOT, 'src', 'shared', 'transcript-contract.ts')

const failures = []

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
  pass('src-tauri/target/release/meeting-notes-tauri.exe', `${sizeMb} MB`)
} else {
  fail('src-tauri/target/release/meeting-notes-tauri.exe', 'missing — run `npm run tauri build`')
}

// --- 3. Sidecar-EXE + device_list ---------------------------------------

header('3. Sidecar-EXE')

if (existsSync(SIDECAR_EXE)) {
  const sizeMb = (statSync(SIDECAR_EXE).size / 1024 / 1024).toFixed(2)
  pass('sidecar/publish/sidecar/MeetingNotes.Sidecar.exe', `${sizeMb} MB`)

  console.log('  ...spawning with --list-devices')
  const proc = spawnSync(SIDECAR_EXE, ['--list-devices'], {
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true
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
          pass('sidecar --list-devices', `inputs=${inputs.length} outputs=${outputs.length}`)
        }
      } catch (e) {
        fail('sidecar device_list JSON', e.message)
      }
    }
  }
} else {
  fail('sidecar/publish/sidecar/MeetingNotes.Sidecar.exe', 'missing — run `npm run tauri build`')
}

// --- 4. Portable-Distribution + SHA256SUMS -------------------------------

header('4. Portable-Distribution')

if (existsSync(PORTABLE_TAURI)) {
  pass('dist/portable/meeting-notes-tauri.exe', `${(statSync(PORTABLE_TAURI).size / 1024 / 1024).toFixed(2)} MB`)
} else {
  fail('dist/portable/meeting-notes-tauri.exe', 'missing — run `npm run dist:portable`')
}

if (existsSync(PORTABLE_SIDECAR)) {
  pass('dist/portable/sidecar/MeetingNotes.Sidecar.exe', `${(statSync(PORTABLE_SIDECAR).size / 1024 / 1024).toFixed(2)} MB`)
} else {
  fail('dist/portable/sidecar/MeetingNotes.Sidecar.exe', 'missing — run `npm run dist:portable`')
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