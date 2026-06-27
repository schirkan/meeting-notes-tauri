#!/usr/bin/env node
/**
 * Unit-Tests fuer die Pure-Functions in src/shared/config-contract.ts
 * und src/renderer/src/config-utils.ts.
 *
 * Spec: specs/T-500-qualitaetssicherung-und-akzeptanztests.md
 *
 * Verwendet Node's built-in node:test (Node >= 20), keine externen
 * Test-Deps noetig. Lauffaehig mit:
 *   node tests/config-utils.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL as toUrl } from 'node:url'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// config-contract.ts and config-utils.ts are TS files. We compile
// them on the fly via `tsc -p tsconfig.test.json` into a temp dir
// and import the emitted JS. tsconfig.test.json extends the project's
// tsconfig.json so @shared/* path aliases keep working.
async function compileAndImport() {
  const tmp = join(tmpdir(), `meeting-notes-test-${process.pid}-${Date.now()}`)
  const { execFileSync } = await import('node:child_process')
  const tscBin = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc')
  execFileSync(
    tscBin,
    ['-p', join(ROOT, 'tsconfig.test.json'), '--outDir', tmp],
    { stdio: 'inherit', shell: process.platform === 'win32' }
  )
  const contractPath = join(tmp, 'shared', 'config-contract.js')
  const utilsPath = join(tmp, 'renderer', 'src', 'config-utils.js')
  const contract = await import(toUrl(contractPath).href)
  const utils = await import(toUrl(utilsPath).href)
  return { contract, utils }
}

const { contract, utils } = await compileAndImport()

test('isValidBcp47Language accepts canonical codes', () => {
  assert.equal(contract.isValidBcp47Language('de-DE'), true)
  assert.equal(contract.isValidBcp47Language('en-US'), true)
  assert.equal(contract.isValidBcp47Language('fr-FR'), true)
})

test('isValidBcp47Language rejects malformed codes', () => {
  assert.equal(contract.isValidBcp47Language('de'), false)
  assert.equal(contract.isValidBcp47Language('DE-DE'), false) // uppercase language tag
  assert.equal(contract.isValidBcp47Language('de-de'), false) // lowercase region
  assert.equal(contract.isValidBcp47Language('deutsch'), false)
  assert.equal(contract.isValidBcp47Language(''), false)
  assert.equal(contract.isValidBcp47Language(null), false)
  assert.equal(contract.isValidBcp47Language(42), false)
})

test('normalizeUserSettings falls back on invalid language', () => {
  const result = contract.normalizeUserSettings({ language: 'invalid', devices: { micId: 'm', speakerLoopbackId: 's' } })
  assert.equal(result.language, contract.DEFAULT_USER_SETTINGS.language)
  assert.equal(result.devices.micId, 'm')
  assert.equal(result.devices.speakerLoopbackId, 's')
})

test('normalizeUserSettings accepts valid BCP-47', () => {
  const result = contract.normalizeUserSettings({ language: 'en-GB', devices: {} })
  assert.equal(result.language, 'en-GB')
})

test('normalizeUserSettings handles null/undefined input', () => {
  assert.equal(contract.normalizeUserSettings(null).language, contract.DEFAULT_USER_SETTINGS.language)
  assert.equal(contract.normalizeUserSettings(undefined).language, contract.DEFAULT_USER_SETTINGS.language)
})

test('validateAzureConfig accepts minimal valid config', () => {
  const valid = {
    endpoint: 'wss://westeurope.stt.speech.microsoft.com',
    region: 'westeurope',
    speechKey: 'abc123',
    interimResults: true
  }
  assert.equal(contract.validateAzureConfig(valid), true)
})

test('validateAzureConfig rejects missing required strings', () => {
  assert.equal(contract.validateAzureConfig({ endpoint: '', region: 'r', speechKey: 'k', interimResults: true }), false)
  assert.equal(contract.validateAzureConfig({ endpoint: 'e', region: '', speechKey: 'k', interimResults: true }), false)
  assert.equal(contract.validateAzureConfig({ endpoint: 'e', region: 'r', speechKey: '', interimResults: true }), false)
  assert.equal(contract.validateAzureConfig({ endpoint: 'e', region: 'r', speechKey: 'k', interimResults: 'yes' }), false)
})

test('validateAzureConfig rejects invalid proxy', () => {
  const bad = {
    endpoint: 'e', region: 'r', speechKey: 'k', interimResults: true,
    proxy: { host: '', port: 8080 }
  }
  assert.equal(contract.validateAzureConfig(bad), false)

  const bad2 = {
    endpoint: 'e', region: 'r', speechKey: 'k', interimResults: true,
    proxy: { host: 'h', port: -1 }
  }
  assert.equal(contract.validateAzureConfig(bad2), false)
})

test('validateAzureConfig accepts valid proxy', () => {
  const ok = {
    endpoint: 'e', region: 'r', speechKey: 'k', interimResults: true,
    proxy: { host: 'proxy.example.com', port: 8080, username: 'u', password: 'p' }
  }
  assert.equal(contract.validateAzureConfig(ok), true)
})

test('toConfigDraft maps null config to empty defaults', () => {
  const draft = utils.toConfigDraft(null)
  assert.equal(draft.endpoint, '')
  assert.equal(draft.region, '')
  assert.equal(draft.speechKey, '')
  assert.equal(draft.interimResults, true)
  assert.equal(draft.useProxy, false)
  assert.equal(draft.proxyHost, '')
  assert.equal(draft.proxyPort, '')
})

test('toConfigDraft maps existing config to draft', () => {
  const draft = utils.toConfigDraft({
    endpoint: 'wss://e', region: 'r', speechKey: 'k', interimResults: false,
    proxy: { host: 'h', port: 8080, username: 'u' }
  })
  assert.equal(draft.endpoint, 'wss://e')
  assert.equal(draft.interimResults, false)
  assert.equal(draft.useProxy, true)
  assert.equal(draft.proxyHost, 'h')
  assert.equal(draft.proxyPort, '8080')
  assert.equal(draft.proxyUsername, 'u')
  assert.equal(draft.proxyPassword, '')
})

test('draftToConfig throws on missing required fields', () => {
  assert.throws(() => utils.draftToConfig({
    endpoint: '', region: 'r', speechKey: 'k', interimResults: true,
    useProxy: false, proxyHost: '', proxyPort: '', proxyUsername: '', proxyPassword: ''
  }), /Endpoint/)
  assert.throws(() => utils.draftToConfig({
    endpoint: 'e', region: '', speechKey: 'k', interimResults: true,
    useProxy: false, proxyHost: '', proxyPort: '', proxyUsername: '', proxyPassword: ''
  }), /Region/)
  assert.throws(() => utils.draftToConfig({
    endpoint: 'e', region: 'r', speechKey: '', interimResults: true,
    useProxy: false, proxyHost: '', proxyPort: '', proxyUsername: '', proxyPassword: ''
  }), /Speech Key/)
})

test('draftToConfig produces config without proxy when useProxy=false', () => {
  const c = utils.draftToConfig({
    endpoint: 'wss://e', region: 'r', speechKey: 'k', interimResults: false,
    useProxy: false, proxyHost: '', proxyPort: '', proxyUsername: '', proxyPassword: ''
  })
  assert.equal(c.endpoint, 'wss://e')
  assert.equal(c.interimResults, false)
  assert.equal(c.proxy, undefined)
})

test('draftToConfig requires proxy host/port when useProxy=true', () => {
  assert.throws(() => utils.draftToConfig({
    endpoint: 'e', region: 'r', speechKey: 'k', interimResults: true,
    useProxy: true, proxyHost: '', proxyPort: '8080', proxyUsername: '', proxyPassword: ''
  }), /Proxy/)
  assert.throws(() => utils.draftToConfig({
    endpoint: 'e', region: 'r', speechKey: 'k', interimResults: true,
    useProxy: true, proxyHost: 'h', proxyPort: '0', proxyUsername: '', proxyPassword: ''
  }), /Port/)
  assert.throws(() => utils.draftToConfig({
    endpoint: 'e', region: 'r', speechKey: 'k', interimResults: true,
    useProxy: true, proxyHost: 'h', proxyPort: 'abc', proxyUsername: '', proxyPassword: ''
  }), /Port/)
})

test('isConfigComplete recognises minimal + proxy configs', () => {
  assert.equal(utils.isConfigComplete(null), false)
  assert.equal(utils.isConfigComplete({
    endpoint: 'e', region: 'r', speechKey: 'k', interimResults: true
  }), true)
  assert.equal(utils.isConfigComplete({
    endpoint: 'e', region: 'r', speechKey: 'k', interimResults: true,
    proxy: { host: 'h', port: 8080 }
  }), true)
  assert.equal(utils.isConfigComplete({
    endpoint: 'e', region: 'r', speechKey: 'k', interimResults: true,
    proxy: { host: '', port: 8080 }
  }), false)
})