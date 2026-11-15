#!/usr/bin/env node

import { existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const paths = [
  join(root, 'src-tauri', 'target', 'sidecar-artifacts'),
  join(root, 'src-tauri', 'target', 'sidecar-publish'),
  join(root, 'src-tauri', 'target', 'sidecar-validation-artifacts'),
  join(root, 'sidecar', 'bin'),
  join(root, 'sidecar', 'obj'),
  join(root, 'sidecar', 'publish'),
  join(root, 'sidecar', 'Validation', 'bin'),
  join(root, 'sidecar', 'Validation', 'obj')
]

const dryRun = process.argv.includes('--dry-run')
for (const path of paths) {
  if (!existsSync(path)) continue
  console.log(`${dryRun ? 'Wuerde entfernen' : 'Entferne'}: ${path}`)
  if (!dryRun) rmSync(path, { recursive: true, force: true })
}
console.log(dryRun ? 'Keine Dateien geloescht.' : 'Sidecar-Cleanup abgeschlossen; Rust-Caches bleiben erhalten.')
