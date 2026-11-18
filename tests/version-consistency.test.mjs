import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('app, lockfiles, Tauri and sidecar carry the same release version', () => {
  const pkg = JSON.parse(read('package.json'))
  const lock = JSON.parse(read('package-lock.json'))
  assert.equal(lock.version, pkg.version)
  assert.equal(lock.packages[''].version, pkg.version)
  assert.equal(JSON.parse(read('src-tauri/tauri.conf.json')).version, pkg.version)
  assert.equal(read('src-tauri/Cargo.toml').match(/\[package\][\s\S]*?\nversion = "([^"]+)"\r?\n/)[1], pkg.version)
  assert.equal(read('src-tauri/Cargo.lock').match(/name = "meeting-notes"\r?\nversion = "([^"]+)"\r?\n/)[1], pkg.version)
  assert.equal(read('sidecar/MeetingNotes.Sidecar.csproj').match(/<Version>([^<]+)<\/Version>/)[1], pkg.version)
})
