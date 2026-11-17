#!/usr/bin/env node
/**
 * Prueft die Konsistenz der Specs (T-502-Nachlauf, T-507).
 *
 * Drei Regeln, alle maschinell pruefbar:
 *   1. Jede abgehakte Checkbox traegt einen Beleg (sonst behauptet sie
 *      Fertigstellung ohne Nachweis).
 *   2. Jede offene Checkbox nennt ihren Grund.
 *   3. Die Statuszeile nennt die tatsaechliche Zahl der offenen Punkte.
 *
 * Zusaetzlich wird geprueft, ob die Uebersicht in SPEC.md noch zu den
 * Spec-Dateien passt - sonst waere sie eine veraltete Zahl.
 *
 * Aufruf: npm run check:specs   (laeuft auch als Teil von npm run verify)
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..')
const SPECS_DIR = join(PROJECT_ROOT, 'specs')
const SPEC_MD = join(PROJECT_ROOT, 'SPEC.md')

// Specs, deren offene Punkte eine Messung auf einem echten Rechner brauchen.
const NEEDS_TARGET_MACHINE = new Set([
  'T-205-continuous-lid-und-diarization-in-c-sharp.md',
  'T-500-qualitaetssicherung-und-akzeptanztests.md',
  'T-502-latency-messung.md',
  'T-504-portable-build.md',
  'T-509-audio-capture-auf-wasapirecorderbuilder-umstellen.md',
  'T-510-clean-machine-deployment-windows-11.md'
])

const problems = []
let ticked = 0
let open = 0
let markedSpecs = 0

const files = readdirSync(SPECS_DIR).filter((f) => f.endsWith('.md')).sort()
for (const file of files) {
  const lines = readFileSync(join(SPECS_DIR, file), 'utf8').split(/\r?\n/)
  const statusLine = lines.find((l) => l.startsWith('Status: '))
  if (!statusLine) {
    problems.push(file + ': keine Status-Zeile')
    continue
  }
  const status = statusLine.slice('Status: '.length)
  if (status.startsWith('umgesetzt') || status.startsWith('teils umgesetzt')) markedSpecs += 1

  const fileOpen = lines.filter((l) => l.startsWith('- [ ]')).length
  const fileTicked = lines.filter((l) => l.startsWith('- [x]')).length
  open += fileOpen
  ticked += fileTicked

  lines.forEach((line, i) => {
    if (line.startsWith('- [x]') && !line.includes('Beleg:')) {
      problems.push(file + ':' + (i + 1) + ' abgehakt ohne Beleg')
    }
    if (line.startsWith('- [ ]') && !line.includes('**offen**') && !line.includes('weiterhin offen')) {
      problems.push(file + ':' + (i + 1) + ' offen ohne Begruendung')
    }
  })

  const claimed = status.match(/\((\d+) Punkte? offen/)
  if (claimed) {
    if (Number(claimed[1]) !== fileOpen) {
      problems.push(file + ': Status nennt ' + claimed[1] + ' offene Punkte, tatsaechlich ' + fileOpen)
    }
  } else if (status.endsWith('umgesetzt') && fileOpen > 0) {
    problems.push(file + ': Status sagt umgesetzt, aber ' + fileOpen + ' Punkte sind offen')
  } else if (fileOpen > 0 && !status.includes('offen')) {
    problems.push(file + ': Status nennt die Zahl der offenen Punkte nicht')
  }
}

// Uebersicht in SPEC.md gegen die Spec-Dateien pruefen.
const specMd = readFileSync(SPEC_MD, 'utf8')
const section = specMd.slice(specMd.indexOf('## Stand der Specs'))
const hardware = []
const deliberate = []
for (const file of files) {
  const lines = readFileSync(join(SPECS_DIR, file), 'utf8').split(/\r?\n/)
  const fileOpen = lines.filter((l) => l.startsWith('- [ ]')).length
  if (fileOpen === 0) continue
  const target = NEEDS_TARGET_MACHINE.has(file) ? hardware : deliberate
  target.push(...lines.filter((l) => l.startsWith('- [ ]')))
}
const expectHw = hardware.length
const expectDl = deliberate.length
const expectOpen = expectHw + expectDl
const expectMarked = markedSpecs
const check = (label, value) => {
  if (!section.includes(label)) problems.push('SPEC.md: ' + label + ' fehlt in der Uebersicht')
}
check('**' + expectMarked + ' Specs**', expectMarked)
check('**' + expectOpen + ' offene Punkte in ', expectOpen)
check('(' + expectHw + ' Punkte)', expectHw)
check('(' + expectDl + ' Punkte)', expectDl)

console.log('  Specs markiert: ' + markedSpecs + ' | Checkboxen: ' + ticked + ' abgehakt, ' + open + ' offen')
if (problems.length === 0) {
  console.log('  Spec-Konsistenz: OK')
} else {
  console.error('  Spec-Konsistenz: ' + problems.length + ' Problem(e)')
  for (const p of problems.slice(0, 25)) console.error('    - ' + p)
  process.exit(1)
}
