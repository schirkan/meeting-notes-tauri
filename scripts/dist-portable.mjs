#!/usr/bin/env node

/**
 * Build a portable distribution of the Tauri app into `dist/portable/`.
 *
 * Spec: specs/T-504-portable-build.md
 *
 * Layout produced:
 *   dist/portable/
 *     MeetingNotes.exe             (Tauri host)
 *     MeetingNotes.Sidecar.exe     (single-file C# sidecar)
 *     MeetingNotes.config.example.json  (config template, optional)
 *     SHA256SUMS
 *
 * Pre-requisites:
 *   - `npm run tauri build`        → src-tauri/target/release/MeetingNotes.exe
 *   - Sidecar-Publish              → src-tauri/target/sidecar-publish/
 *                                    (lief automatisch via src-tauri/build.rs seit AD-009)
 */

import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, copyFileSync, writeFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { pipeline } from 'node:stream/promises'

const PROJECT_ROOT = process.cwd()
const TAURI_EXE_SRC = join(PROJECT_ROOT, 'src-tauri', 'target', 'release', 'MeetingNotes.exe')
const SIDECAR_SRC = join(PROJECT_ROOT, 'src-tauri', 'target', 'sidecar-publish')
const CONFIG_TEMPLATE = 'MeetingNotes.config.example.json'
const CONFIG_TEMPLATE_SRC = join(PROJECT_ROOT, CONFIG_TEMPLATE)
const PORTABLE_OUT = join(PROJECT_ROOT, 'dist', 'portable')

const TAURI_EXE_NAME = 'MeetingNotes.exe'
const SIDECAR_EXE_NAME = 'MeetingNotes.Sidecar.exe'
const SHA256SUMS_NAME = 'SHA256SUMS'

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function fail(message) {
  console.error(`\u274c ${message}`)
  process.exit(1)
}

function info(message) {
  console.log(`\u270d\ufe0f  ${message}`)
}

function listFilesRecursive(root) {
  const out = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) out.push(...listFilesRecursive(full))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

function ensurePrereqs() {
  if (!existsSync(TAURI_EXE_SRC)) {
    fail(`Tauri-EXE nicht gefunden: ${TAURI_EXE_SRC}\n   -> erst 'npm run tauri build' laufen lassen.`)
  }
  if (!existsSync(SIDECAR_SRC)) {
    fail(`Sidecar-Publish-Output fehlt: ${SIDECAR_SRC}\n   -> src-tauri/build.rs sollte das beim Build automatisch erzeugen.`)
  }
  const sidecarExe = join(SIDECAR_SRC, SIDECAR_EXE_NAME)
  if (!existsSync(sidecarExe)) {
    fail(`Sidecar-EXE nicht gefunden: ${sidecarExe}`)
  }
  const entries = readdirSync(SIDECAR_SRC)
  if (entries.length !== 1 || entries[0] !== SIDECAR_EXE_NAME) {
    fail(`Sidecar-Publish muss genau ${SIDECAR_EXE_NAME} enthalten; gefunden: ${entries.join(', ')}`)
  }
}

function cleanOutputDir() {
  if (existsSync(PORTABLE_OUT)) {
    rmSync(PORTABLE_OUT, { recursive: true, force: true })
  }
  mkdirSync(PORTABLE_OUT, { recursive: true })
}

function sha256OfFile(path) {
  // Streaming read keeps memory bounded for large DLLs.
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    pipeline(createReadStream(path), hash).then(
      () => resolve(hash.digest('hex')),
      reject
    )
  })
}

async function buildSha256Sums(root) {
  const files = listFilesRecursive(root)
    .map((abs) => relative(root, abs).replaceAll('\\', '/'))
    .sort()

  const lines = []
  for (const rel of files) {
    const abs = join(root, rel)
    const sum = await sha256OfFile(abs)
    lines.push(`${sum}  ${rel}`)
  }
  return lines.join('\n') + '\n'
}

async function main() {
  info(`Prereqs-Check …`)
  ensurePrereqs()
  cleanOutputDir()

  // 1. Tauri-EXE
  info(`Kopiere ${TAURI_EXE_NAME} …`)
  copyFileSync(TAURI_EXE_SRC, join(PORTABLE_OUT, TAURI_EXE_NAME))

  info(`Kopiere ${SIDECAR_EXE_NAME} …`)
  copyFileSync(join(SIDECAR_SRC, SIDECAR_EXE_NAME), join(PORTABLE_OUT, SIDECAR_EXE_NAME))

  // 3. Config-Template (optional)
  let configTemplateCopied = false
  if (existsSync(CONFIG_TEMPLATE_SRC)) {
    info(`Kopiere Config-Template …`)
    copyFileSync(CONFIG_TEMPLATE_SRC, join(PORTABLE_OUT, CONFIG_TEMPLATE))
    configTemplateCopied = true
  } else {
    info(`(Kein ${CONFIG_TEMPLATE} gefunden — übersprungen. Template gehört zu T-103/T-305.)`)
  }

  // 4. SHA256SUMS
  info(`Berechne SHA256-Summen …`)
  const sums = await buildSha256Sums(PORTABLE_OUT)
  writeFileSync(join(PORTABLE_OUT, SHA256SUMS_NAME), sums, 'utf8')

  // 5. Summary
  const allFiles = listFilesRecursive(PORTABLE_OUT).filter((p) => basename(p) !== SHA256SUMS_NAME)
  const totalBytes = allFiles.reduce((sum, p) => sum + statSync(p).size, 0)
  const sumsBytes = statSync(join(PORTABLE_OUT, SHA256SUMS_NAME)).size
  const tauriExeBytes = statSync(join(PORTABLE_OUT, TAURI_EXE_NAME)).size
  const sidecarBytes = statSync(join(PORTABLE_OUT, SIDECAR_EXE_NAME)).size
  const sumsCount = sums.split('\n').filter(Boolean).length

  console.log('')
  console.log('=== Portable Build abgeschlossen ===')
  console.log(`Ausgabe:       ${PORTABLE_OUT}`)
  console.log(`Tauri-EXE:     ${formatBytes(tauriExeBytes)}  (${TAURI_EXE_NAME})`)
  console.log(`Sidecar:       ${formatBytes(sidecarBytes)}  (${SIDECAR_EXE_NAME})`)
  console.log(`Config:        ${configTemplateCopied ? CONFIG_TEMPLATE : '— (übersprungen)'}`)
  console.log(`SHA256SUMS:    ${formatBytes(sumsBytes)}  (${sumsCount} Summen)`)
  console.log(`----------------------------------------`)
  console.log(`Gesamt:        ${formatBytes(totalBytes + sumsBytes)}  über ${allFiles.length + 1} Dateien`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})