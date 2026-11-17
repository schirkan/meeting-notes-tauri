import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

for (const dryRun of [true, false]) {
  test(`sidecar cleanup ${dryRun ? 'dry run preserves outputs' : 'removes outputs but preserves sources and Rust caches'}`, () => {
    const fixture = mkdtempSync(join(tmpdir(), 'meeting-notes-cleanup-'))
    try {
      mkdirSync(join(fixture, 'scripts'))
      const script = join(fixture, 'scripts', 'clean-sidecar.mjs')
      copyFileSync(join(root, 'scripts', 'clean-sidecar.mjs'), script)
      const outputs = [
        ['src-tauri', 'target', 'sidecar-artifacts'],
        ['src-tauri', 'target', 'sidecar-publish'],
        ['src-tauri', 'target', 'sidecar-validation-artifacts'],
        ['sidecar', 'bin'], ['sidecar', 'obj'], ['sidecar', 'publish'],
        ['sidecar', 'Validation', 'bin'], ['sidecar', 'Validation', 'obj']
      ].map(parts => join(fixture, ...parts))
      const preserved = [
        ['sidecar', 'Program.cs'],
        ['sidecar', 'Validation', 'Program.cs'],
        ['src-tauri', 'target', 'release', 'MeetingNotes.exe'],
        ['src-tauri', 'target', 'debug', 'cache'],
        ['dist', 'portable', 'MeetingNotes.exe']
      ].map(parts => join(fixture, ...parts))
      for (const output of outputs) {
        mkdirSync(output, { recursive: true })
        writeFileSync(join(output, 'artifact'), 'test')
      }
      for (const path of preserved) {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, 'test')
      }
      const result = spawnSync(process.execPath, [script, ...(dryRun ? ['--dry-run'] : [])], {
        cwd: tmpdir(), encoding: 'utf8'
      })
      assert.equal(result.status, 0, result.stderr)
      for (const output of outputs) assert.equal(existsSync(output), dryRun, output)
      for (const path of preserved) assert.ok(existsSync(path), path)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })
}
