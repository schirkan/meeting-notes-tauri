import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { transformWithOxc } from 'vite'

const adapter = new URL('../src/renderer/src/web-speech.ts', import.meta.url)
const { code } = await transformWithOxc(await readFile(adapter, 'utf8'), adapter.pathname)
const { canUseWebSpeech, WebSpeechSession } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

function stubWebView(t) {
  const instances = []
  class SpeechRecognition {
    calls = []

    constructor() { instances.push(this) }
    start(...args) { this.calls.push(['start', ...args]) }
    stop() { this.calls.push(['stop']) }
    abort() { this.calls.push(['abort']) }

    result(index, ...results) { this.onresult?.({ resultIndex: index, results }) }
  }

  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else delete globalThis.window
  })
  return { SpeechRecognition, instances, host: globalThis.window }
}

function capture(options = {}) {
  const segments = []
  const ended = []
  const session = new WebSpeechSession({
    language: 'de-DE',
    onSegment: (segment) => segments.push(segment),
    onEnded: (error) => ended.push(error),
    ...options
  })
  return { session, segments, ended }
}

function result(transcript, isFinal = true) {
  return Object.assign([{ transcript, confidence: 0.75 }], { isFinal })
}

test('checks API presence without requesting the microphone and surfaces missing support', async (t) => {
  const { host, SpeechRecognition, instances } = stubWebView(t)
  assert.equal(canUseWebSpeech(), false)
  const { session, ended } = capture()
  await assert.rejects(session.start(), /not available in this WebView/)
  assert.deepEqual(ended, [])

  host.webkitSpeechRecognition = SpeechRecognition
  assert.equal(canUseWebSpeech(), true)
  host.SpeechRecognition = SpeechRecognition
  assert.equal(canUseWebSpeech(), true)
  assert.equal(instances.length, 0)
})

test('uses the WebKit fallback, starts synchronously but waits for readiness, and flushes finals on stop', async (t) => {
  const { host, SpeechRecognition, instances } = stubWebView(t)
  host.webkitSpeechRecognition = SpeechRecognition
  const { session, segments, ended } = capture({ interimResults: true })
  assert.equal(instances.length, 0)
  let ready = false
  const started = session.start().then(() => { ready = true })
  const [recognition] = instances
  assert.deepEqual(recognition.calls, [['start']])
  assert.equal(recognition.lang, 'de-DE')
  assert.equal(recognition.continuous, true)
  assert.equal(recognition.interimResults, true)
  recognition.result(0, result('not ready'))
  await Promise.resolve()
  assert.equal(ready, false)
  assert.deepEqual(segments, [])

  recognition.onstart()
  await started
  recognition.result(0, result('  Ist ', false))
  const stopped = session.stop()
  assert.equal(session.stop(), stopped)
  let finished = false
  void stopped.then(() => { finished = true })
  await Promise.resolve()
  assert.equal(finished, false)
  assert.deepEqual(recognition.calls, [['start'], ['stop']])
  recognition.result(0, result('  Ist gut. '), result('ignored interim', false))
  recognition.result(1, result('  Ist gut. '), result(' Zweiter Satz. '))
  recognition.onend()
  await stopped
  assert.deepEqual(ended, [])
  assert.deepEqual(segments.map(({ state, text }) => [state, text]), [
    ['interim', 'Ist'], ['final', 'Ist gut.'], ['final', 'Zweiter Satz.']
  ])
  assert.equal(segments[0].id, segments[1].id)
  assert.notEqual(segments[1].id, segments[2].id)
  assert.notEqual(session.sessionId, capture().session.sessionId)
  for (const segment of segments) {
    assert.equal(segment.sessionId, session.sessionId)
    assert.equal(segment.source, 'mic')
    assert.equal(segment.speaker, 'self')
    assert.equal(segment.language, 'de-DE')
    assert.equal(segment.confidence, 0.75)
    assert.equal(segment.timestampIso, new Date(segment.timestampIso).toISOString())
  }
})

test('reports denied permissions before readiness and network loss after readiness', async (t) => {
  const { host, SpeechRecognition, instances } = stubWebView(t)
  host.SpeechRecognition = SpeechRecognition
  host.webkitSpeechRecognition = class { constructor() { assert.fail('unprefixed constructor should win') } }

  const denied = capture()
  const starting = denied.session.start()
  instances[0].onerror({ error: 'not-allowed' })
  await assert.rejects(starting, /Microphone access was denied/)
  assert.deepEqual(denied.ended, [])
  assert.deepEqual(instances[0].calls, [['start'], ['abort']])

  const active = capture()
  const started = active.session.start()
  const recognition = instances[1]
  assert.equal(recognition.interimResults, false)
  recognition.onstart()
  await started
  recognition.result(0, result('disabled interim', false))
  assert.deepEqual(active.segments, [])
  const lateEnd = recognition.onend
  recognition.onerror({ error: 'network' })
  lateEnd()
  assert.equal(active.ended.length, 1)
  assert.match(active.ended[0], /could not reach the speech service/)
  assert.deepEqual(recognition.calls, [['start'], ['abort']])
})

test('requires a specific language and maps synchronous permission failures', async (t) => {
  const { host, SpeechRecognition, instances } = stubWebView(t)
  host.SpeechRecognition = class extends SpeechRecognition {
    start() { throw new DOMException('platform detail', 'NotAllowedError') }
  }
  for (const language of ['', 'auto']) {
    await assert.rejects(capture({ language }).session.start(), /Select a specific language/)
  }
  assert.equal(instances.length, 0)
  await assert.rejects(capture().session.start(), /Microphone access was denied/)
  assert.deepEqual(instances[0].calls, [['abort']])
})

test('reports an unexpected native end without restarting', async (t) => {
  const { host, SpeechRecognition, instances } = stubWebView(t)
  host.SpeechRecognition = SpeechRecognition
  const { session, ended } = capture()
  const started = session.start()
  const [recognition] = instances
  recognition.onstart()
  await started
  recognition.onend()
  assert.match(ended[0], /ended unexpectedly/)
  assert.deepEqual(recognition.calls, [['start']])
  assert.equal(instances.length, 1)
})

test('aborts synchronously and ignores queued native callbacks, including while starting', async (t) => {
  const { host, SpeechRecognition, instances } = stubWebView(t)
  host.SpeechRecognition = SpeechRecognition
  const pending = capture()
  const starting = pending.session.start()
  const lateStart = instances[0].onstart
  pending.session.abort()
  lateStart()
  await assert.rejects(starting, /cancelled/)
  assert.deepEqual(pending.ended, [])

  const active = capture()
  const started = active.session.start()
  const recognition = instances[1]
  recognition.onstart()
  await started
  const lateResult = recognition.onresult
  const lateEnd = recognition.onend
  const stopped = active.session.stop()
  active.session.abort()
  assert.equal(recognition.onresult, null)
  assert.deepEqual(recognition.calls, [['start'], ['stop'], ['abort']])
  lateResult({ resultIndex: 0, results: [result('discard')] })
  lateEnd()
  await assert.rejects(stopped, /cancelled/)
  assert.deepEqual(active.segments, [])
  assert.deepEqual(active.ended, [])
})

test('enforces start and stop deadlines and closes capture on timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { host, SpeechRecognition, instances } = stubWebView(t)
  host.SpeechRecognition = SpeechRecognition

  const pending = capture()
  const starting = pending.session.start()
  t.mock.timers.tick(10_000)
  await assert.rejects(starting, /did not start listening in time/)
  assert.deepEqual(instances[0].calls, [['start'], ['abort']])
  assert.deepEqual(pending.ended, [])

  const active = capture()
  const started = active.session.start()
  instances[1].onstart()
  await started
  const stopped = active.session.stop()
  t.mock.timers.tick(3_000)
  await assert.rejects(stopped, /did not finish stopping in time/)
  assert.deepEqual(instances[1].calls, [['start'], ['stop'], ['abort']])
  assert.deepEqual(active.ended, [])
})
