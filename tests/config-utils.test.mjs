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
import { readFileSync, writeFileSync, unlinkSync, rmSync } from 'node:fs'
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
  const speakers = await import(toUrl(join(tmp, 'renderer', 'src', 'speaker-utils.js')).href)
  const markdown = await import(toUrl(join(tmp, 'shared', 'transcript-markdown.js')).href)
  rmSync(tmp, { recursive: true, force: true })
  return { contract, utils, speakers, markdown }
}

const { contract, utils, speakers, markdown } = await compileAndImport()

test('transcription mode defaults to live, preserves batch, and does not mistake unknown modes for live', () => {
  const normalize = (mode) => contract.normalizeUserSettings({ transcription: { provider: 'windows-sapi', mode } }).transcription
  assert.equal(normalize(undefined).mode, undefined)
  assert.equal(normalize('live').mode, undefined)
  assert.equal(normalize('batch').mode, 'batch')
  assert.equal(normalize('batch').provider, 'windows-sapi')
  assert.equal(normalize('future-mode').mode, 'unsupported')
})

test('window preferences default on for legacy and malformed settings', () => {
  for (const input of [null, undefined, {}, { window: null }, { window: {} },
    { window: { minimizeToTrayOnClose: 'true', hideFromTaskbar: 'false' } },
    { window: { minimizeToTrayOnClose: 1, hideFromTaskbar: 0 } }]) {
    assert.deepEqual(contract.normalizeUserSettings(input).window, { minimizeToTrayOnClose: true, hideFromTaskbar: true })
  }
})

test('window preferences preserve explicit values independently without changing audio settings', () => {
  for (const enabled of [false, true]) {
    const result = contract.normalizeUserSettings({
      window: { minimizeToTrayOnClose: enabled, hideFromTaskbar: !enabled },
      transcription: { mic: false, speaker: true },
      autoStart: { enabled: true, processes: ['teams'] }
    })
    assert.deepEqual(result.window, { minimizeToTrayOnClose: enabled, hideFromTaskbar: !enabled })
    assert.deepEqual(result.transcription, { mic: false, speaker: true, audioMode: 'dual-mono' })
    assert.equal(result.autoStart.enabled, true)
  }
})

test('automatic capture and matching auto-stop default on but preserve explicit false', () => {
  for (const input of [undefined, {}, { autoStart: null }, { autoStart: {} },
    { autoStart: { enabled: 'false' } }]) {
    assert.equal(contract.normalizeUserSettings(input).autoStart.enabled, true)
  }
  assert.equal(contract.normalizeUserSettings({ autoStart: { enabled: false } }).autoStart.enabled, false)
  assert.equal(contract.normalizeUserSettings({ autoStart: { enabled: true } }).autoStart.enabled, true)
})

test('the automatic stop defaults on and an explicit false is preserved', () => {
  assert.equal(contract.DEFAULT_USER_SETTINGS.autoStart.autoStop, true)
  for (const input of [undefined, {}, { autoStart: null }, { autoStart: {} },
    { autoStart: { autoStop: 'false' } }]) {
    assert.equal(contract.normalizeUserSettings(input).autoStart.autoStop, true)
  }
  assert.equal(contract.normalizeUserSettings({ autoStart: { autoStop: false } }).autoStart.autoStop, false)
  assert.equal(contract.normalizeUserSettings({ autoStart: { enabled: true, autoStop: false } }).autoStart.autoStop, false)
})

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

test('stereo preference survives a single enabled source and invalid modes fall back to dual mono', () => {
  for (const [input, expected] of [['stereo', 'stereo'], ['unsupported', 'dual-mono'], [null, 'dual-mono']]) {
    const settings = contract.normalizeUserSettings({ transcription: { mic: false, speaker: true, audioMode: input } })
    assert.deepEqual(contract.normalizeUserSettings(JSON.parse(JSON.stringify(settings))).transcription, {
      mic: false, speaker: true, audioMode: expected
    })
  }
})

test('normalizeUserSettings handles null/undefined input', () => {
  assert.equal(contract.normalizeUserSettings(null).language, contract.DEFAULT_USER_SETTINGS.language)
  assert.equal(contract.normalizeUserSettings(undefined).language, contract.DEFAULT_USER_SETTINGS.language)
})

test('speaker recognition migrates legacy settings and preserves explicit false', () => {
  for (const input of [undefined, {}, { diarization: { mic: false } }, { diarization: { mic: false, speaker: true } }]) {
    assert.equal(contract.normalizeUserSettings(input).diarization, true)
  }
  for (const diarization of [false, { mic: false, speaker: false }]) {
    const settings = contract.normalizeUserSettings({ diarization, autoLanguageDetection: false })
    assert.equal(settings.diarization, false)
    assert.equal(settings.autoLanguageDetection, false)
  }
})

test('transcription defaults enable both sources for legacy and partial settings', () => {
  for (const input of [null, undefined, {}, { language: 'en-US' }, { transcription: null }, { transcription: {} }]) {
    assert.deepEqual(contract.normalizeUserSettings(input).transcription, { mic: true, speaker: true, audioMode: 'dual-mono' })
  }
  assert.deepEqual(contract.normalizeUserSettings({ transcription: { mic: false } }).transcription, { mic: false, speaker: true, audioMode: 'dual-mono' })
  assert.deepEqual(contract.normalizeUserSettings({ transcription: { speaker: false } }).transcription, { mic: true, speaker: false, audioMode: 'dual-mono' })
})

test('transcription normalization preserves every independent boolean combination', () => {
  for (const mic of [true, false]) {
    for (const speaker of [true, false]) {
      const settings = contract.normalizeUserSettings({ transcription: { mic, speaker } })
      assert.deepEqual(settings.transcription, { mic, speaker, audioMode: 'dual-mono' })
      assert.deepEqual(contract.normalizeUserSettings(JSON.parse(JSON.stringify(settings))).transcription, { mic, speaker, audioMode: 'dual-mono' })
    }
  }
})

test('malformed transcription values do not become truthy checkbox settings', () => {
  assert.deepEqual(contract.normalizeUserSettings({ transcription: { mic: 'false', speaker: 0 } }).transcription, { mic: true, speaker: true, audioMode: 'dual-mono' })
})

test('removed transcription option is ignored in legacy config and omitted from the example', () => {
  const example = JSON.parse(readFileSync(join(ROOT, 'MeetingNotes.config.example.json'), 'utf8'))
  assert.equal(Object.hasOwn(example.user.transcription, 'echoCancellation'), false)
  const settings = contract.normalizeUserSettings({ language: 'en-US', transcription: { mic: false, echoCancellation: true, audioMode: 'stereo' } })
  assert.deepEqual(settings.transcription, { mic: false, speaker: true, audioMode: 'stereo' })
  assert.equal(settings.language, 'en-US')
})

test('malformed diarization values do not become truthy checkbox settings', () => {
  assert.equal(contract.normalizeUserSettings({ diarization: { mic: 'false', speaker: 0 } }).diarization, true)
})

test('markdown export defaults to enabled without a path', () => {
  for (const input of [null, undefined, {}, { transcript: null }]) {
    assert.deepEqual(contract.normalizeUserSettings(input).transcript.markdownExport, {
      enabled: true,
      path: null
    })
  }
})

test('markdown export path is optional and blank values fall back to null', () => {
  assert.deepEqual(
    contract.normalizeUserSettings({ transcript: { markdownExport: { enabled: false, path: '   ' } } })
      .transcript.markdownExport,
    { enabled: false, path: null }
  )
  assert.deepEqual(
    contract.normalizeUserSettings({ transcript: { markdownExport: { enabled: false, path: 'D:/Notes' } } })
      .transcript.markdownExport,
    { enabled: false, path: 'D:/Notes' }
  )
})

test('markdown export keeps an explicitly disabled flag', () => {
  assert.equal(contract.normalizeUserSettings({ transcript: { markdownExport: { enabled: false } } })
    .transcript.markdownExport.enabled, false)
})

test('transcript markdown starts with yaml frontmatter carrying the session metadata', () => {
  const segments = [
    { id: '1', source: 'mic', speaker: 'Guest-1', speakerIdentified: true, language: 'de-DE', timestampIso: '2026-11-09T13:00:00.000Z', text: 'Hallo.', state: 'final' },
    { id: '2', source: 'speaker', speaker: 'Guest-2', speakerIdentified: true, language: 'de-DE', timestampIso: '2026-11-09T13:00:05.000Z', text: 'Guten Tag.', state: 'final' }
  ]
  const document = markdown.buildTranscriptMarkdown(segments)
  assert.ok(document.startsWith('---\n'), 'document starts with frontmatter')
  assert.ok(document.includes('\n---\n'), 'frontmatter is closed')
  assert.ok(document.includes('segments: 2'))
  assert.ok(document.includes('duration: "00:00:05"'))
  assert.ok(document.includes('"Guest-1"'))
  assert.ok(document.includes('"Guest-2"'))
  assert.ok(document.includes('- ['))
})

test('transcript markdown body contains final segments only', () => {
  const segments = [
    { id: '1', source: 'mic', speaker: 'Guest-1', language: 'de-DE', timestampIso: '2026-11-09T13:00:00.000Z', text: 'Endgueltig.', state: 'final' },
    { id: '2', source: 'mic', speaker: 'Guest-1', language: 'de-DE', timestampIso: '2026-11-09T13:00:02.000Z', text: 'Vorlaeufig.', state: 'interim' }
  ]
  const document = markdown.buildTranscriptMarkdown(segments)
  assert.ok(document.includes('Endgueltig.'))
  assert.ok(!document.includes('Vorlaeufig.'))
  assert.ok(document.includes('segments: 1'))
})

test('speaker identities are scoped to their audio source', () => {
  assert.equal(speakers.getSpeakerKey({ source: 'mic', speaker: ' Guest-1 ' }), 'mic:Guest-1')
  assert.equal(speakers.getSpeakerKey({ source: 'speaker', speaker: 'Guest-1' }), 'speaker:Guest-1')
  assert.equal(speakers.getSpeakerKey({ source: 'mic', speaker: ' ' }), 'mic:unknown')
  assert.notEqual(speakers.getSpeakerKey({ source: 'mic', speaker: 'Guest-1' }), speakers.getSpeakerKey({ source: 'speaker', speaker: 'Guest-1' }))
})

test('speaker labels retain source and complete SDK identity', () => {
  assert.equal(speakers.formatSpeakerKey('mic:Guest-1'), 'Mic · Guest-1')
  assert.equal(speakers.formatSpeakerKey('speaker:Guest:1'), 'Speaker · Guest:1')
})

test('speaker colors cycle over 30 slots with distinct Mic and Speaker palettes', () => {
  assert.equal(speakers.getSpeakerClass('speaker:Guest-1'), 'speaker-guest-1')
  assert.equal(speakers.getSpeakerClass('mic:Guest-1'), 'speaker-guest-16')
  assert.equal(speakers.getSpeakerClass('speaker:Guest-31'), 'speaker-guest-1')
  assert.equal(speakers.getSpeakerClass('mic:Guest-31'), 'speaker-guest-16')
  assert.equal(speakers.getSpeakerClass('mic:self'), 'speaker-mic-self')
  assert.equal(speakers.getSpeakerClass('speaker:guest'), 'speaker-guest-1')
  assert.equal(speakers.getSpeakerClass('mic:Unknown'), 'speaker-unknown')
})

test('speaker identities are scoped to the azure session', () => {
  // T-507: Azure vergibt die Sprecher-IDs pro Sitzung neu. Die Identitaet
  // muss die Sitzung mitfuehren, sonst faellt der Alias aus der vorigen
  // Sitzung still auf eine andere Person.
  const first = speakers.getSpeakerIdentity({ source: 'mic', speaker: 'Guest-1', sessionId: 's1' })
  const second = speakers.getSpeakerIdentity({ source: 'mic', speaker: 'Guest-1', sessionId: 's2' })
  assert.equal(first, 's1|mic:Guest-1')
  assert.notEqual(first, second, 'Gleiche SDK-ID in zwei Sitzungen sind verschiedene Identitaeten')
  assert.equal(
    speakers.getSpeakerIdentity({ source: 'speaker', speaker: 'Guest-1', sessionId: 's1' }),
    's1|speaker:Guest-1'
  )
  assert.equal(
    speakers.getSpeakerIdentity({ source: 'mic', speaker: ' ', sessionId: 's1' }),
    's1|mic:unknown'
  )
})

test('speaker identities without a session fall back to a stable placeholder', () => {
  assert.equal(speakers.getSpeakerIdentity({ source: 'mic', speaker: 'Guest-1' }), 'unknown|mic:Guest-1')
  assert.equal(speakers.getSpeakerIdentity({ source: 'mic', speaker: 'Guest-1', sessionId: '  ' }), 'unknown|mic:Guest-1')
})

test('identity labels and colors ignore the session prefix', () => {
  assert.equal(speakers.formatSpeakerIdentity('s1|mic:Guest-1'), 'Mic · Guest-1')
  assert.equal(speakers.formatSpeakerIdentity('s1|speaker:Guest-1'), 'Speaker · Guest-1')
  assert.equal(speakers.getSpeakerClassForIdentity('s1|mic:Guest-1'), 'speaker-guest-16')
  assert.equal(speakers.getSpeakerClassForIdentity('s1|speaker:Guest-1'), 'speaker-guest-1')
  assert.equal(speakers.getSpeakerClassForIdentity('unknown|mic:self'), 'speaker-mic-self')
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
  assert.equal(draft.proxyHost, 'h')
  assert.equal(draft.proxyPort, '8080')
  assert.equal(draft.proxyUsername, 'u')
  assert.equal(draft.proxyPassword, '')
})

test('draftToConfig throws on missing required fields', () => {
  assert.throws(() => utils.draftToConfig({
    model: 'standard', endpoint: '', region: 'r', speechKey: 'k', interimResults: true,
    proxyHost: '', proxyPort: '', proxyUsername: '', proxyPassword: ''
  }), /endpoint/i)
  assert.throws(() => utils.draftToConfig({
    model: 'standard', endpoint: 'e', region: '', speechKey: 'k', interimResults: true,
    proxyHost: '', proxyPort: '', proxyUsername: '', proxyPassword: ''
  }), /region/i)
  assert.throws(() => utils.draftToConfig({
    model: 'standard', endpoint: 'e', region: 'r', speechKey: '', interimResults: true,
    proxyHost: '', proxyPort: '', proxyUsername: '', proxyPassword: ''
  }), /speech key/i)
})

test('draftToConfig produces config without proxy when the proxy host is blank', () => {
  const c = utils.draftToConfig({
    model: 'standard', endpoint: 'wss://e', region: 'r', speechKey: 'k', interimResults: false,
    proxyHost: '', proxyPort: '', proxyUsername: '', proxyPassword: ''
  })
  assert.equal(c.endpoint, 'wss://e')
  assert.equal(c.interimResults, false)
  assert.equal(c.proxy, undefined)
})

test('MAI requires region and key but not the Standard endpoint', () => {
  const legacy = { endpoint: 'wss://legacy.test', region: 'swedencentral', speechKey: 'k', interimResults: true }
  const draft = utils.toConfigDraft(legacy)
  const model = 'mai-transcribe-2-streaming'
  assert.equal(draft.model, 'standard')
  assert.deepEqual(utils.draftToConfig({ ...draft, model }), { ...legacy, model })
  const mai = utils.draftToConfig({ ...draft, endpoint: '', model })
  assert.equal(contract.validateAzureConfig(mai), true)
  assert.equal(utils.isConfigComplete(mai), true)
  assert.throws(() => utils.draftToConfig({ ...utils.toConfigDraft(mai), model: 'standard' }), /endpoint/i)
  assert.throws(() => utils.draftToConfig({ ...utils.toConfigDraft(mai), region: '' }), /region/i)
  assert.equal(utils.isConfigComplete({ ...legacy, model: 'unknown' }), false)
  assert.equal(contract.validateAzureConfig({ ...legacy, model: null }), false)
  assert.throws(() => utils.draftToConfig({ ...draft, model: 'unknown' }), /model/i)
})

test('draftToConfig requires a valid port when a proxy host is set', () => {
  assert.throws(() => utils.draftToConfig({
    model: 'standard', endpoint: 'e', region: 'r', speechKey: 'k', interimResults: true,
    proxyHost: 'h', proxyPort: '', proxyUsername: '', proxyPassword: ''
  }), /port/i)
  assert.throws(() => utils.draftToConfig({
    model: 'standard', endpoint: 'e', region: 'r', speechKey: 'k', interimResults: true,
    proxyHost: 'h', proxyPort: '0', proxyUsername: '', proxyPassword: ''
  }), /port/i)
  assert.throws(() => utils.draftToConfig({
    model: 'standard', endpoint: 'e', region: 'r', speechKey: 'k', interimResults: true,
    proxyHost: 'h', proxyPort: 'abc', proxyUsername: '', proxyPassword: ''
  }), /port/i)
})

test('proxy port must fit the Rust u16 contract', () => {
  for (const port of [0, -1, 1.5, 65536, Infinity]) {
    const config = {
      endpoint: 'https://example.test', region: 'r', speechKey: 'k', interimResults: true,
      proxy: { host: 'proxy.test', port }
    }
    assert.equal(contract.validateAzureConfig(config), false)
    assert.equal(utils.isConfigComplete(config), false)
    assert.throws(() => utils.draftToConfig(utils.toConfigDraft(config)), /port/i)
  }
})

test('diagnostic draft normalization preserves proxy credentials and uses a direct connection when the host is cleared', () => {
  const config = {
    endpoint: 'https://example.test', region: 'r', speechKey: 'k', interimResults: true,
    proxy: { host: 'proxy.test', port: 8080, username: 'u', password: 'p' }
  }
  const draft = utils.toConfigDraft(config)
  assert.deepEqual(utils.draftToConfig({ ...draft, proxyHost: ' proxy.test ' }), config)
  assert.equal(utils.draftToConfig({ ...draft, proxyHost: '  ' }).proxy, undefined)
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