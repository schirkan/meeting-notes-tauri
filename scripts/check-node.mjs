#!/usr/bin/env node

function parseVersion(input) {
  const clean = String(input || '').trim().replace(/^v/, '')
  const [core] = clean.split('-')
  const parts = core.split('.').map((x) => Number.parseInt(x, 10))
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`Ungültige Node-Version: ${input}`)
  }
  return { major: parts[0], minor: parts[1], patch: parts[2], raw: clean }
}

function compare(a, b) {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

function inRange(version, min, maxExclusive) {
  return compare(version, min) >= 0 && compare(version, maxExclusive) < 0
}

const current = parseVersion(process.versions.node)

const min22 = parseVersion('22.12.0')
const max23 = parseVersion('23.0.0')
const min24 = parseVersion('24.0.0')
const max2416 = parseVersion('24.16.0')

const isSupported = inRange(current, min22, max23) || inRange(current, min24, max2416)

if (!isSupported) {
  console.error('❌ Nicht unterstützte Node-Version für dieses Projekt:', current.raw)
  console.error('Erlaubt sind:')
  console.error('- Node 22 LTS: >=22.12.0 <23.0.0')
  console.error('- Node 24 (valide Stand heute): >=24.0.0 <24.16.0')
  console.error('')
  console.error('Empfohlen: `nvm use` (liest .nvmrc -> 22)')
  process.exit(1)
}

console.log(`✅ Node-Version ok: ${current.raw}`)
