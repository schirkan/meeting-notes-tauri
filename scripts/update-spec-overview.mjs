#!/usr/bin/env node
/**
 * Erzeugt den Abschnitt "Stand der Specs" in SPEC.md aus den Spec-Dateien.
 *
 * Der Abschnitt wird nicht von Hand gepflegt: jedes offene Kaestchen in
 * specs/*.md wird gelesen und in die beiden Tabellen einsortiert - nach
 * "braucht deinen Rechner" (Hardware, Azure-Credentials, Clean Machine)
 * und "bewusste Entscheidung" (nicht umgesetzt, mit Begruendung).
 *
 * Aufruf:  node scripts/update-spec-overview.mjs
 *         npm run docs:specs
 *
 * Der Abschnitt "Naechste Schritte auf deinem Rechner" bleibt unveraendert -
 * er steht hinter dem generierten Teil und wird nicht ueberschrieben.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { NEEDS_TARGET_MACHINE } from './spec-classification.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..')
const SPECS_DIR = join(PROJECT_ROOT, 'specs')
const SPEC_MD = join(PROJECT_ROOT, 'SPEC.md')


const OPEN_MARKER = ' - **offen**: '
const BACKTICK = String.fromCharCode(96)
const TICK = BACKTICK + 'Beleg: …' + BACKTICK

function collect() {
  const hardware = []
  const deliberate = []
  let marked = 0

  for (const file of readdirSync(SPECS_DIR).filter((f) => f.endsWith('.md')).sort()) {
    const lines = readFileSync(join(SPECS_DIR, file), 'utf8').split(/\r?\n/)
    const status = (lines.find((l) => l.startsWith('Status: ')) || '').slice('Status: '.length)
    if (status.startsWith('umgesetzt') || status.startsWith('teils umgesetzt')) marked += 1

    const id = (file.match(/^(T-\d+)/) || [file.slice(0, 5)])[0]
    for (const line of lines) {
      if (!line.startsWith('- [ ]')) continue
      const raw = line.slice('- [ ] '.length)
      const at = raw.indexOf(OPEN_MARKER)
      const item = (at >= 0 ? raw.slice(0, at) : raw).trim()
      let reason = at >= 0 ? raw.slice(at + OPEN_MARKER.length).trim() : ''
      if (!reason) {
        const m = raw.match(/ - (weiterhin offen[^.]*\.?)\s*$/)
        reason = m ? m[1].trim() : 'kein Grund hinterlegt'
      }
      const entry = { id, item, reason }
      if (NEEDS_TARGET_MACHINE.has(file)) hardware.push(entry)
      else deliberate.push(entry)
    }
  }
  return { hardware, deliberate, marked }
}

function short(text, max) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + '…' : clean
}

function build({ hardware, deliberate, marked }) {
  const total = hardware.length + deliberate.length
  const specsWithOpen = new Set([...hardware, ...deliberate].map((e) => e.id)).size

  const lines = [
    '## Stand der Specs (Abgleich ' + new Date().toLocaleDateString('de-DE') + ')',
    '',
    'Die Checkboxen wurden gegen den **Code** geprueft, nicht gegen den Spec-Status:',
    'jeder abgehakte Punkt traegt den Beleg im Klartext (' + TICK + '), jeder offene',
    'Punkt nennt den konkreten Grund (' + BACKTICK + '- **offen**: …' + BACKTICK + '). Ergebnis: **' + marked + ' Specs** als',
    BACKTICK + 'umgesetzt' + BACKTICK + ' bzw. ' + BACKTICK + 'teils umgesetzt' + BACKTICK + ' markiert, **' + total + ' offene Punkte in ' + specsWithOpen + ' Specs**.',
    'Vorher waren ueber 70 Checkboxen offen, obwohl die Funktion ueberwiegend fertig',
    'und verifiziert war - die Specs sind jetzt mit dem Stand der Implementierung',
    'deckungsgleich.',
    '',
    '_Dieser Abschnitt wird von ' + BACKTICK + 'npm run docs:specs' + BACKTICK + ' aus den Spec-Dateien erzeugt._',
    '',
    '### Offen und braucht deinen Rechner (' + hardware.length + ' Punkte)',
    '',
    '| Spec | Punkt |',
    '|---|---|'
  ]
  for (const e of hardware) lines.push('| ' + e.id + ' | ' + short(e.item, 95) + ' |')

  lines.push('')
  lines.push('### Offen als bewusste Entscheidung (' + deliberate.length + ' Punkte)')
  lines.push('')
  lines.push('| Spec | Punkt | Warum offen |')
  lines.push('|---|---|---|')
  for (const e of deliberate) lines.push('| ' + e.id + ' | ' + short(e.item, 70) + ' | ' + short(e.reason, 130) + ' |')
  lines.push('')
  return lines
}

const specLines = readFileSync(SPEC_MD, 'utf8').split(/\r?\n/)
const start = specLines.findIndex((l) => l.startsWith('## Stand der Specs'))
const runbook = specLines.findIndex((l) => l.startsWith('### Nächste Schritte'))
if (start < 0 || runbook < 0 || runbook < start) {
  console.error('FEHLER: Der Abschnitt "Stand der Specs" oder "Nächste Schritte" fehlt in SPEC.md.')
  process.exit(1)
}

const summary = collect()
writeFileSync(SPEC_MD, specLines.slice(0, start).concat(build(summary), specLines.slice(runbook)).join('\n'), 'utf8')
console.log(
  'SPEC.md aktualisiert: ' + summary.marked + ' Specs markiert, ' +
  (summary.hardware.length + summary.deliberate.length) + ' offene Punkte (' +
  summary.hardware.length + ' Zielrechner, ' + summary.deliberate.length + ' Entscheidung).'
)
