#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SIDECAR_ROOT = join(process.cwd(), 'sidecar')
const CSPROJ_PATH = join(SIDECAR_ROOT, 'MeetingNotes.Sidecar.csproj')
const OUTPUT_DIRS = ['bin', 'obj']

function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Liest die aktiven Target-Frameworks aus dem Sidecar-csproj.
 * Unterstützt sowohl einzelne `<TargetFramework>` als auch Multi-Target
 * `<TargetFrameworks>` (Semikolon-getrennt). Fallback: ['net8.0-windows'].
 */
function readActiveTargetFrameworks() {
  if (!existsSync(CSPROJ_PATH)) {
    console.warn(`Warnung: csproj nicht gefunden: ${CSPROJ_PATH}`)
    return ['net8.0-windows']
  }

  const xml = readFileSync(CSPROJ_PATH, 'utf8')
  const singleMatch = xml.match(/<TargetFramework>([^<]+)<\/TargetFramework>/i)
  if (singleMatch) {
    return [singleMatch[1].trim()]
  }

  const multiMatch = xml.match(/<TargetFrameworks>([^<]+)<\/TargetFrameworks>/i)
  if (multiMatch) {
    return multiMatch[1].split(';').map((value) => value.trim()).filter(Boolean)
  }

  return ['net8.0-windows']
}

function listSubdirectories(path) {
  if (!isDirectory(path)) return []
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

function cleanStaleTargets() {
  const activeTargets = new Set(readActiveTargetFrameworks())
  console.log(`Aktive Target-Frameworks (aus csproj): ${[...activeTargets].join(', ')}`)

  let removed = 0

  for (const sub of OUTPUT_DIRS) {
    const root = join(SIDECAR_ROOT, sub)
    if (!isDirectory(root)) continue

    for (const config of listSubdirectories(root)) {
      const configPath = join(root, config)
      const targetDirs = listSubdirectories(configPath)

      for (const target of targetDirs) {
        if (activeTargets.has(target)) continue

        const targetPath = join(configPath, target)
        rmSync(targetPath, { recursive: true, force: true })
        console.log(`entfernt: ${targetPath}`)
        removed += 1
      }
    }
  }

  return removed
}

if (!existsSync(SIDECAR_ROOT)) {
  console.error(`Sidecar-Verzeichnis nicht gefunden: ${SIDECAR_ROOT}`)
  process.exit(1)
}

const removed = cleanStaleTargets()
console.log(`Sidecar-Cleanup abgeschlossen. ${removed} stale Verzeichnis(se) entfernt.`)