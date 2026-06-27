#!/usr/bin/env node

/**
 * Build a portable distribution of the Tauri app into `dist/portable/`.
 *
 * Spec: specs/T-504-portable-build.md
 *
 * Layout produced:
 *   dist/portable/
 *     meeting-notes-tauri.exe      (Tauri host)
 *     sidecar/                     (C# sidecar + deps)
 *       MeetingNotes.Sidecar.exe
 *       MeetingNotes.Sidecar.dll
 *       …                          (Azure Speech / NAudio / System.* DLLs)
 *     config/                      (optional, only if templates exist)
 *       azure.example.json
 *       user-settings.example.json
 *     SHA256SUMS
 *
 * Pre-requisites:
 *   - `npm run tauri build`        → src-tauri/target/release/meeting-notes-tauri.exe
 *   - Sidecar-Publish              → sidecar/publish/sidecar/
 *                                    (lief automatisch via src-tauri/build.rs seit AD-009)
 */

import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, copyFileSync, writeFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { pipeline } from 'node:stream/promises'

const PROJECT_ROOT = process.cwd()
const TAURI_EXE_SRC = join(PROJECT_ROOT, 'src-tauri', 'target', 'release', 'meeting-notes-tauri.exe')
const SIDECAR_SRC = join(PROJECT_ROOT, 'sidecar', 'publish', 'sidecar')
const CONFIG_SRC = join(PROJECT_ROOT, 'config')
const PORTABLE_OUT = join(PROJECT_ROOT, 'dist', 'portable')

const TAURI_EXE_NAME = 'meeting-notes-tauri.exe'
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
}

function cleanOutputDir() {
  if (existsSync(PORTABLE_OUT)) {
    rmSync(PORTABLE_OUT, { recursive: true, force: true })
  }
  mkdirSync(PORTABLE_OUT, { recursive: true })
}

function copyDirContents(srcDir, dstDir) {
  mkdirSync(dstDir, { recursive: true })
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const src = join(srcDir, entry.name)
    const dst = join(dstDir, entry.name)
    if (entry.isDirectory()) {
      copyDirContents(src, dst)
    } else if (entry.isFile()) {
      copyFileSync(src, dst)
    }
  }
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

  // 1a. Tauri-Support-DLLs aus dem Release-Ordner (z. B. WebView2Loader.dll
  // wird von Tauri 2 als Delayed-Load-DLL neben der EXE erwartet).
  const tauriReleaseDir = TAURI_EXE_SRC.replace(/[\\/][^\\/]+$/, '')
  const tauriDlls = readdirSync(tauriReleaseDir).filter((f) => f.toLowerCase().endsWith('.dll'))
  if (tauriDlls.length > 0) {
    info(`Kopiere Tauri-Support-DLLs (${tauriDlls.length}) …`)
    for (const dll of tauriDlls) {
      copyFileSync(join(tauriReleaseDir, dll), join(PORTABLE_OUT, dll))
    }
  }

  // 2. Sidecar-Verzeichnis
  info(`Kopiere Sidecar (${SIDECAR_EXE_NAME} + DLLs) …`)
  copyDirContents(SIDECAR_SRC, join(PORTABLE_OUT, 'sidecar'))

  // 3. Config-Templates (optional)
  const configTemplates = []
  if (existsSync(CONFIG_SRC)) {
    for (const entry of readdirSync(CONFIG_SRC)) {
      if (entry.endsWith('.example.json')) configTemplates.push(entry)
    }
  }
  if (configTemplates.length > 0) {
    info(`Kopiere Config-Templates …`)
    copyDirContents(CONFIG_SRC, join(PORTABLE_OUT, 'config'))
  } else {
    info(`(Kein config/-Verzeichnis mit *.example.json gefunden — übersprungen. Templates gehören zu T-103/T-305.)`)
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
  const sidecarBytes = listFilesRecursive(join(PORTABLE_OUT, 'sidecar'))
    .reduce((sum, p) => sum + statSync(p).size, 0)
  const sumsCount = sums.split('\n').filter(Boolean).length

  console.log('')
  console.log('=== Portable Build abgeschlossen ===')
  console.log(`Ausgabe:       ${PORTABLE_OUT}`)
  console.log(`Tauri-EXE:     ${formatBytes(tauriExeBytes)}  (${TAURI_EXE_NAME})`)
  console.log(`Sidecar:       ${formatBytes(sidecarBytes)}  (${listFilesRecursive(join(PORTABLE_OUT, 'sidecar')).length} Dateien in sidecar/)`)
  console.log(`Config:        ${configTemplates.length > 0 ? `${configTemplates.length} Templates` : '— (übersprungen)'}`)
  console.log(`SHA256SUMS:    ${formatBytes(sumsBytes)}  (${sumsCount} Summen)`)
  console.log(`----------------------------------------`)
  console.log(`Gesamt:        ${formatBytes(totalBytes + sumsBytes)}  über ${allFiles.length + 1} Dateien`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})