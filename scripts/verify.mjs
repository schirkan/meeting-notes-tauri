#!/usr/bin/env node
/**
 * Gesamtverifikation des Projekts in der richtigen Reihenfolge.
 *
 * Bisher lagen die Pruefungen ueber fuenf npm-Skripte verstreut - wer den
 * Stand pruefen wollte, musste die Reihenfolge kennen. Dieses Skript fasst
 * sie zusammen und bricht beim ersten Fehlschlag ab.
 *
 * Aufruf:
 *   npm run verify            # Typecheck, Node-Tests, C#-Validierung
 *   npm run verify -- --full  # zusaetzlich: Release-Build, Portable, Smoke, Deployment
 *
 * --full braucht gebaute Artefakte (Release-EXE und dist/portable) und
 * prueft sie mit - deshalb baut es sie vorher.
 */

import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..')
const NPM = 'npm'

const FAST = [
  { name: 'Typecheck', command: NPM, args: ['run', 'typecheck'] },
  { name: 'Node-Tests', command: NPM, args: ['run', 'test:unit'] },
  { name: 'C#-Validierung', command: NPM, args: ['run', 'test:sidecar'] }
]

const FULL = [
  { name: 'Release-Build', command: NPM, args: ['run', 'tauri', '--', 'build', '--no-bundle'] },
  { name: 'Portable packen', command: NPM, args: ['run', 'dist:portable'] },
  { name: 'Smoke-Test', command: NPM, args: ['run', 'test:smoke'] },
  { name: 'Deployment-Nachweis', command: NPM, args: ['run', 'verify:deployment'] }
]

function run(step) {
  return new Promise((resolve) => {
    const started = Date.now()
    // Windows: Node startet .cmd-Dateien (npm.cmd) nur mit shell - sonst
    // schlaegt der Spawn mit EINVAL fehl. Die Argumente enthalten keine
    // Leerzeichen, das Zusammensetzen ist deshalb unkritisch.
    const child = spawn([step.command, ...step.args].join(' '), {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      shell: true
    })
    child.on('error', (err) => {
      console.error('  Start fehlgeschlagen: ' + err.message)
      resolve({ ...step, ok: false, code: null, ms: Date.now() - started })
    })
    child.on('close', (code) => {
      resolve({ ...step, ok: code === 0, code, ms: Date.now() - started })
    })
  })
}

function printSummary(results) {
  console.log('')
  console.log('=== Zusammenfassung ===')
  for (const r of results) {
    const status = r.ok ? 'OK    ' : 'FEHLER'
    const seconds = (r.ms / 1000).toFixed(1)
    console.log('  ' + status + '  ' + r.name.padEnd(20) + seconds + ' s')
  }
}

const steps = process.argv.includes('--full') ? [...FAST, ...FULL] : FAST
const results = []

for (const step of steps) {
  console.log('')
  console.log('=== ' + step.name + ' ===')
  const result = await run(step)
  results.push(result)
  if (!result.ok) {
    printSummary(results)
    console.error('')
    console.error('Verifikation abgebrochen: ' + step.name + ' fehlgeschlagen (Exit ' + result.code + ').')
    process.exit(1)
  }
}

printSummary(results)
console.log('')
console.log('Verifikation vollstaendig gruen (' + results.length + ' Schritte).')
