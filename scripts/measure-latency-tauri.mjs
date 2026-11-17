#!/usr/bin/env node
/**
 * Latenzmessung fuer die Tauri-App (T-502).
 *
 * Spec: specs/T-502-latency-messung.md
 *
 * Die App schreibt pro Transcript-Event eine Messzeile (NDJSON) in die Datei,
 * auf die MEETING_NOTES_LATENCY_LOG zeigt. Dieses Skript sammelt die Zeilen,
 * wertet P50/P95/P99 aus und schreibt den Report nach context/latency-report.md.
 *
 * Aufruf:
 *   node scripts/measure-latency-tauri.mjs --selftest
 *   node scripts/measure-latency-tauri.mjs --live [--samples 100] [--timeout 300]
 *
 * --selftest  prueft Statistik und Report-Erzeugung mit synthetischen Werten.
 *             Braucht weder Azure-Credentials noch ein Aufnahmegeraet.
 * --live      startet die App, wartet auf die Messzeilen und erzeugt den
 *             Report. Der echte Lauf braucht Azure-Credentials, eine Config
 *             neben der EXE und ein Aufnahmegeraet; die Aufnahme muss in der
 *             App per Hand gestartet werden.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..')
const APP_EXE = join(PROJECT_ROOT, 'src-tauri', 'target', 'release', 'MeetingNotes.exe')
const DEFAULT_REPORT = join(PROJECT_ROOT, 'context', 'latency-report.md')
const LOG_ENV = 'MEETING_NOTES_LATENCY_LOG'

export const STAGES = [
  { key: 'captureLatencyMs', label: 'WASAPI-Puffer -> Callback' },
  { key: 'sidecarToPushMs', label: 'Callback -> Azure-PushStream' },
  { key: 'azureToEventMs', label: 'Azure-Roundtrip -> Sidecar-Event' },
  { key: 'pipeToEventMs', label: 'Sidecar-Event -> Tauri-Main' }
]

export const TARGET_P95_MS = 5000

/**
 * Naechster-Rang-Perzentil (nearest rank). Fuer p=95 und n=100 liefert das
 * den 95. sortierten Wert - die uebliche Definition fuer Latenzbudgets.
 */
export function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length)
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1)
  return sorted[index]
}

export function summarize(samples) {
  const stages = {}
  for (const stage of STAGES) {
    const values = samples
      .map((s) => (s && s.latency ? s.latency[stage.key] : undefined))
      .filter((v) => typeof v === 'number' && Number.isFinite(v))
    stages[stage.key] = {
      label: stage.label,
      count: values.length,
      min: values.length ? Math.min(...values) : null,
      p50: percentile(values, 50),
      p95: percentile(values, 95),
      p99: percentile(values, 99),
      max: values.length ? Math.max(...values) : null
    }
  }
  const totals = samples
    .map((s) => (s && s.latency ? s.latency.totalMs : undefined))
    .filter((v) => typeof v === 'number' && Number.isFinite(v))
  const total = {
    label: 'End-to-End (bis Tauri-Event)',
    count: totals.length,
    min: totals.length ? Math.min(...totals) : null,
    p50: percentile(totals, 50),
    p95: percentile(totals, 95),
    p99: percentile(totals, 99),
    max: totals.length ? Math.max(...totals) : null
  }
  return { stages, total, sampleCount: samples.length }
}

function fmt(value) {
  if (value === null || value === undefined) return '-'
  return String(Math.round(value * 10) / 10)
}

export function renderReport(summary, meta) {
  const rows = []
  for (const stage of STAGES) {
    const s = summary.stages[stage.key]
    rows.push('| ' + s.label + ' | ' + fmt(s.p50) + ' | ' + fmt(s.p95) + ' | ' + fmt(s.p99) + ' | ' + fmt(s.max) + ' | ' + s.count + ' |')
  }
  const t = summary.total
  rows.push('| **' + t.label + '** | **' + fmt(t.p50) + '** | **' + fmt(t.p95) + '** | **' + fmt(t.p99) + '** | **' + fmt(t.max) + '** | **' + t.count + '** |')

  const verdict = t.p95 === null
    ? 'Ergebnis: keine Messwerte vorhanden.'
    : 'Ergebnis: P95 = ' + fmt(t.p95) + ' ms - ' +
      (t.p95 < TARGET_P95_MS ? 'ZIEL ERFUELLT' : 'ZIEL NICHT ERFUELLT') +
      ' (Ziel: < ' + TARGET_P95_MS + ' ms).'

  const lines = [
    '# Latenz-Report (T-502)',
    '',
    'Erzeugt: ' + (meta.generatedAt || '-'),
    '',
    'Quelle: ' + (meta.source || '-'),
    '',
    'Messzeilen: ' + summary.sampleCount,
    '',
    'Ziel: P95 < ' + TARGET_P95_MS + ' ms End-to-End.',
    '',
    '| Stufe | P50 (ms) | P95 (ms) | P99 (ms) | Max (ms) | N |',
    '|---|---:|---:|---:|---:|---:|',
    ...rows,
    '',
    verdict,
    '',
    'Hinweis: Die Renderer-Stufe (Paint des Transkripts) ist von aussen nicht',
    'messbar; End-to-End endet am Tauri-Event.',
    ''
  ]
  return lines.join('\n')
}

function parseSamples(text) {
  const samples = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      samples.push(JSON.parse(trimmed))
    } catch {
      // Teilweise geschriebene Zeile: ueberspringen.
    }
  }
  return samples
}

function syntheticSamples(count) {
  const samples = []
  for (let i = 0; i < count; i++) {
    const capture = 8 + (i % 5)
    const sidecar = 1.5
    const azure = 900 + (i % 120)
    const pipe = 3 + (i % 2)
    samples.push({
      tsUnixMs: 1700000000000 + i * 250,
      source: i % 2 === 0 ? 'mic' : 'speaker',
      state: i % 3 === 0 ? 'interim' : 'final',
      latency: {
        captureLatencyMs: capture,
        sidecarToPushMs: sidecar,
        azureToEventMs: azure,
        pipeToEventMs: pipe,
        totalMs: capture + sidecar + azure + pipe
      }
    })
  }
  return samples
}

function parseArgs(argv) {
  const options = { mode: null, samples: 100, timeoutSeconds: 300, out: DEFAULT_REPORT }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--selftest') options.mode = 'selftest'
    else if (arg === '--live') options.mode = 'live'
    else if (arg === '--samples') options.samples = Number(argv[++i])
    else if (arg === '--timeout') options.timeoutSeconds = Number(argv[++i])
    else if (arg === '--out') options.out = resolve(argv[++i])
  }
  return options
}

function writeReport(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

async function runLive(options) {
  if (!existsSync(APP_EXE)) {
    console.error('FEHLER: ' + APP_EXE + ' fehlt. Erst bauen: npm run tauri -- build --no-bundle')
    process.exit(1)
  }
  const logFile = join(tmpdir(), 'meeting-notes-latency-' + Date.now() + '.ndjson')
  console.log('Messdatei: ' + logFile)
  console.log('Starte die Aufnahme in der App, sobald das Fenster offen ist.')
  console.log('Sammle bis zu ' + options.samples + ' Messzeilen (Timeout ' + options.timeoutSeconds + ' s).')

  const child = spawn(APP_EXE, [], {
    env: Object.assign({}, process.env, { [LOG_ENV]: logFile }),
    windowsHide: false,
    stdio: 'ignore'
  })

  const deadline = Date.now() + options.timeoutSeconds * 1000
  let samples = []
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500))
    if (existsSync(logFile)) {
      samples = parseSamples(readFileSync(logFile, 'utf8'))
    }
    if (samples.length >= options.samples) break
  }

  child.kill()
  if (existsSync(logFile)) {
    samples = parseSamples(readFileSync(logFile, 'utf8'))
  }

  if (samples.length === 0) {
    console.error('FEHLER: keine Messzeilen. Wurde eine Aufnahme gestartet? Ist ' + LOG_ENV + ' gesetzt?')
    process.exit(1)
  }

  const summary = summarize(samples)
  const report = renderReport(summary, {
    generatedAt: new Date().toISOString(),
    source: 'Live-Messung (' + samples.length + ' Messzeilen)'
  })
  writeReport(options.out, report)
  console.log(report)
  console.log('Report geschrieben: ' + options.out)
}

function runSelftest(options) {
  const samples = syntheticSamples(options.samples)
  const summary = summarize(samples)
  const report = renderReport(summary, {
    generatedAt: new Date().toISOString(),
    source: 'Selbsttest (synthetische Werte, KEINE echte Messung)'
  })
  console.log(report)
  if (options.out) {
    writeReport(options.out, report)
    console.log('Report geschrieben: ' + options.out)
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.mode === 'selftest') {
    runSelftest(options)
    return
  }
  if (options.mode === 'live') {
    await runLive(options)
    return
  }
  console.log('Aufruf:')
  console.log('  node scripts/measure-latency-tauri.mjs --selftest')
  console.log('  node scripts/measure-latency-tauri.mjs --live [--samples N] [--timeout SEK]')
  process.exit(1)
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main()
}
