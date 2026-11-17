import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

for (const extraDll of [false, true]) {
  test(`portable build ${extraDll ? 'rejects a non-single-file sidecar before replacing output' : 'packages consistently named files without a sidecar directory'}`, () => {
    const fixture = mkdtempSync(join(tmpdir(), 'meeting-notes-portable-'))
    try {
      const publish = join(fixture, 'src-tauri', 'target', 'sidecar-publish')
      const release = join(fixture, 'src-tauri', 'target', 'release')
      const portable = join(fixture, 'dist', 'portable')
      for (const dir of [publish, release, portable]) mkdirSync(dir, { recursive: true })
      writeFileSync(join(release, 'MeetingNotes.exe'), 'app')
      writeFileSync(join(publish, 'MeetingNotes.Sidecar.exe'), 'sidecar')
      writeFileSync(join(fixture, 'MeetingNotes.config.example.json'), '{}')
      writeFileSync(join(portable, 'previous-output'), 'preserve on failure')
      if (extraDll) writeFileSync(join(publish, 'dependency.dll'), 'unexpected')

      const result = spawnSync(process.execPath, [join(root, 'scripts', 'dist-portable.mjs')], {
        cwd: fixture, encoding: 'utf8'
      })
      if (extraDll) {
        assert.equal(result.status, 1, result.stderr)
        assert.match(result.stderr, /Sidecar-Publish muss genau MeetingNotes.Sidecar.exe enthalten/)
        assert.ok(existsSync(join(portable, 'previous-output')))
      } else {
        assert.equal(result.status, 0, result.stderr)
        assert.deepEqual(readdirSync(portable).sort(), [
          'MeetingNotes.Sidecar.exe', 'MeetingNotes.config.example.json', 'MeetingNotes.exe', 'SHA256SUMS'
        ].sort())
        const lines = readFileSync(join(portable, 'SHA256SUMS'), 'utf8').trim().split('\n')
        assert.equal(lines.length, 3)
        for (const line of lines) {
          const [hash, file] = line.split('  ')
          assert.equal(hash, createHash('sha256').update(readFileSync(join(portable, file))).digest('hex'))
        }
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })
}
