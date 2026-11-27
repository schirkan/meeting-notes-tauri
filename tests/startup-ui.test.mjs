import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import packageJson from '../package.json' with { type: 'json' }

let server
let browser
let baseUrl

before(async () => {
  server = await createServer({
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    server: { host: '127.0.0.1', port: 0, hmr: false, open: false }
  })
  await server.listen()
  baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ channel: 'msedge', headless: true })
})

after(async () => {
  await browser?.close()
  await server?.close()
})

const validConfig = {
  endpoint: 'https://example.test',
  region: 'westeurope',
  speechKey: 'test-key',
  interimResults: true
}

async function openApp(options) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
  await page.route(/\/preload\/index\.ts(?:\?.*)?$/, (route) => route.fulfill({
    contentType: 'application/javascript',
    body: ''
  }))
  await page.addInitScript((input) => {
    if (input.webSpeech) {
      window.SpeechRecognition = class {
        start() {
          window.webRecognition = this
          queueMicrotask(() => this.onstart?.())
        }
        stop() {
          this.onresult?.({ resultIndex: 1, results: [null, { isFinal: true, 0: { transcript: 'Last browser words', confidence: 0.9 } }] })
          queueMicrotask(() => this.onend?.())
        }
        abort() { window.webAborted = true }
      }
    }
    const noSubscription = () => () => {}
    const stoppedStatus = { running: false, paused: false }
    let currentStatus = input.running
      ? { running: true, paused: false, startedAt: input.startedAt ?? new Date().toISOString() }
      : stoppedStatus
    let onStatus
    window.emitStatus = (status) => {
      currentStatus = status
      onStatus?.(status)
      return status
    }
    window.settingsSaveError = input.saveSettingsError
    window.directoryPickerResult = input.directoryPickerResult ?? null
    window.batchPickerResult = input.batchPickerResult ?? null
    window.batchInspections = input.batchInspections ?? {}
    window.batchResult = input.batchResult ?? []
    window.transcriptApi = {
      toggleDevtools: async () => {
        if (input.devtoolsError) throw new Error(input.devtoolsError)
        window.devtoolsToggleCalls = (window.devtoolsToggleCalls ?? 0) + 1
      },
      openRepository: async () => { window.repositoryOpened = true },
      getStatus: async () => {
        const snapshot = currentStatus
        if (input.deferInitialStatus) {
          return new Promise(resolve => { window.completeInitialStatus = () => resolve(snapshot) })
        }
        return snapshot
      },
      start: async (provider, mode, requestedAtMs) => {
        window.lastStartCalled = true
        window.lastStartProvider = provider
        window.lastStartMode = mode
        window.lastStartRequestedAt = requestedAtMs
        return window.emitStatus({ running: true, paused: false, startedAt: new Date().toISOString() })
      },
      stop: async () => {
        window.lastStopCalled = true
        // Rust emits stopped even if shutting down the sidecar fails.
        const nextStatus = input.stopRecording ? { ...stoppedStatus, recording: { ...input.stopRecording,
          startedAt: new Date(window.lastStartRequestedAt).toISOString() } } : stoppedStatus
        window.emitStatus(nextStatus)
        if (input.stopError) throw input.stopError
        return nextStatus
      },
      pickBatchAudio: async () => {
        window.batchPickerCalls = (window.batchPickerCalls ?? 0) + 1
        if (window.batchPickerError) throw window.batchPickerError
        return window.batchPickerResult
      },
      inspectBatchAudio: async (path) => {
        window.batchInspectedPaths ??= []
        window.batchInspectedPaths.push(path)
        return window.batchInspections[path] ?? { estimated: false }
      },
      transcribeBatchAudio: async (tracks, provider, model) => {
        window.batchCalls ??= []
        window.batchCalls.push({ tracks, provider, model })
        if (window.batchError) throw window.batchError
        return window.batchResult
      },
      pause: async () => { window.lastPauseCalled = true; return window.emitStatus({ ...currentStatus, paused: true }) },
      resume: async () => { window.lastResumeCalled = true; return window.emitStatus({ ...currentStatus, paused: false }) },
      getSettings: async () => {
        const settings = {
          language: input.language ?? 'de-DE',
          devices: {},
          transcription: input.transcription,
          diarization: input.diarization,
          transcript: input.transcript,
          autoStart: input.autoStart,
          window: input.windowSettings
        }
        if (input.deferInitialSettings) {
          return new Promise(resolve => { window.completeInitialSettings = () => resolve(settings) })
        }
        return settings
      },
      saveSettings: async (settings) => {
        window.settingsSaveCalls ??= []
        window.settingsSaveCalls.push(settings)
        if (window.settingsSaveError) throw new Error(window.settingsSaveError)
        if (input.deferSettings) {
          window.pendingSettingsSaves ??= []
          return new Promise((resolve) => window.pendingSettingsSaves.push(() => {
            window.lastSavedSettings = settings
            resolve(settings)
          }))
        }
        window.lastSavedSettings = settings
        return settings
      },
      getDevices: async () => {
        if (input.devicesError) throw new Error('Device test failed')
        return { inputs: input.inputs ?? [], outputs: input.outputs ?? [], fetchedAtIso: new Date(0).toISOString() }
      },
      getDebugLog: async () => input.debugLog ?? [],
      clearDebugLog: async () => { window.lastClearLogCalled = true; return { cleared: input.debugLog?.length ?? 0 } },
      getConfig: async () => {
        if (input.configError) throw new Error('Configuration not readable')
        return input.configState
      },
      saveConfig: async (config) => {
        if (input.saveConfigError) throw new Error(input.saveConfigError)
        window.lastSavedConfig = config
        return { exists: true, path: 'test-config', config }
      },
      reset: async () => {
        if (input.deferReset) {
          return new Promise(resolve => { window.completeReset = resolve })
        }
      },
      saveTranscriptMarkdown: async (markdown) => {
        window.lastSavedMarkdown = markdown
        window.transcriptWrites = (window.transcriptWrites ?? 0) + 1
        if (input.deferTranscriptWrite) {
          await new Promise((resolve, reject) => {
            window.completeTranscriptWrite = (error) => error ? reject(error) : resolve()
          })
        }
        return 'D:/Notes/transcript-2026-11-11-22-05-00.md'
      },
      onQuitExport: (callback) => { window.emitQuitExport = callback; return () => { delete window.emitQuitExport } },
      completeQuitExport: async (requestId, error) => {
        window.quitExportReplies ??= []
        window.quitExportReplies.push({ requestId, error })
      },
      selectTranscriptDirectory: async () => {
        window.directoryPickerCalls = (window.directoryPickerCalls ?? 0) + 1
        if (input.directoryPickerError) throw new Error(input.directoryPickerError)
        return window.directoryPickerResult
      },
      testAzureConnectivity: async (payload) => {
        window.lastConnectivityPayload = payload
        if (input.connectivityError) throw input.connectivityError
        if (input.deferConnectivity) {
          return new Promise((resolve) => { window.completeConnectivity = resolve })
        }
        return input.connectivityResult
      },
      copyTranscript: async (segments, startedAt) => {
        window.lastCopiedSegments = segments
        window.lastCopiedStart = startedAt
      },
      onSegment: (callback) => {
        window.emitSegment = callback
        return () => { delete window.emitSegment }
      },
      onError: noSubscription,
      onStatus: (callback) => { onStatus = callback; return () => { onStatus = undefined } },
      onDebugLog: (callback) => { window.emitDebugLog = callback; return () => { delete window.emitDebugLog } },
      onMeetingDetected: (callback) => { window.emitMeetingDetected = callback; return () => { delete window.emitMeetingDetected } }
    }
    window.transcriptSidecar = {
      onCrashed: (callback) => { window.emitCrashed = callback; return () => { delete window.emitCrashed } }
    }
  }, options)
  await page.goto(baseUrl)
  await page.locator('.layout-grid').waitFor()
  return page
}

async function reopenSettings(page) {
  await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'Open settings dialog' }).click()
}

test('settings waits for initial data before presenting an editable draft and focuses save', async () => {
  const page = await openApp({ configState: { exists: false, path: 'test-config', config: null }, language: 'nl-NL', deferInitialSettings: true })
  try {
    await page.waitForFunction(() => typeof window.completeInitialSettings === 'function')
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
    assert.equal(await dialog.count(), 0)
    await page.evaluate(() => window.completeInitialSettings())
    await dialog.waitFor()
    await page.waitForFunction(() => document.activeElement?.classList.contains('settings-save-button'))
    assert.equal(await dialog.getByRole('combobox', { name: 'Primary language', exact: true }).inputValue(), 'nl-NL')
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
  } finally { await page.close() }
})

test('settings drafts are isolated, warn on close, discard and only persist on save', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await page.getByRole('button', { name: 'Open settings dialog' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
    const close = dialog.getByRole('button', { name: 'Close dialog', exact: true })
    const language = dialog.getByRole('combobox', { name: 'Primary language', exact: true })
    const hideFromTaskbar = dialog.getByRole('checkbox', { name: 'Hide from taskbar', exact: true })
    await page.waitForFunction(() => document.activeElement?.classList.contains('settings-save-button'))
    await hideFromTaskbar.uncheck()
    await language.selectOption('en-US')
    await dialog.getByLabel('Endpoint', { exact: true }).fill('https://draft.test')
    await dialog.getByRole('checkbox', { name: 'Save transcript automatically', exact: true }).uncheck()
    assert.equal(await page.evaluate(() => window.lastSavedSettings), undefined)
    assert.equal(await page.evaluate(() => window.lastSavedConfig), undefined)
    page.once('dialog', confirmation => {
      assert.match(confirmation.message(), /Discard unsaved changes/)
      return confirmation.dismiss()
    })
    await close.click()
    assert.equal(await dialog.isVisible(), true)
    assert.equal(await language.inputValue(), 'en-US')
    page.once('dialog', confirmation => confirmation.accept())
    await close.click()
    await dialog.waitFor({ state: 'hidden' })
    // An idle autosave must not include any abandoned dialog values.
    await page.getByRole('checkbox', { name: 'Transcribe speaker loopback', exact: true }).uncheck()
    await page.waitForFunction(() => window.lastSavedSettings?.transcription.speaker === false)
    assert.equal(await page.evaluate(() => window.lastSavedSettings.language), 'de-DE')
    assert.equal(await page.evaluate(() => window.lastSavedSettings.window.hideFromTaskbar), true)
    assert.equal(await page.evaluate(() => window.lastSavedSettings.transcript.markdownExport.enabled), true)
    assert.equal(await page.evaluate(() => window.lastSavedConfig), undefined)
    await reopenSettings(page)
    assert.equal(await language.inputValue(), 'de-DE')
    assert.equal(await dialog.getByLabel('Endpoint', { exact: true }).inputValue(), validConfig.endpoint)
    await language.selectOption('fr-FR')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await reopenSettings(page)
    assert.equal(await language.inputValue(), 'fr-FR')
    let prompted = false
    page.once('dialog', confirmation => { prompted = true; return confirmation.dismiss() })
    await close.click()
    assert.equal(prompted, false)
    await dialog.waitFor({ state: 'hidden' })
  } finally { await page.close() }
})

test('testing unsaved settings preserves drafts without persisting and footer buttons have equal height', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig }, connectivityError: 'test' })
  try {
    await page.getByRole('button', { name: 'Open settings dialog' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
    await dialog.getByRole('combobox', { name: 'Primary language', exact: true }).selectOption('en-US')
    await dialog.getByLabel('Host', { exact: true }).fill('draft.proxy')
    await dialog.getByLabel('Port', { exact: true }).fill('8080')
    await dialog.getByRole('button', { name: 'Test connection', exact: true }).click()
    const diagnostic = page.getByRole('dialog', { name: 'Connection test', exact: true })
    await diagnostic.waitFor()
    assert.equal(await page.evaluate(() => window.lastConnectivityPayload.language), 'en-US')
    assert.equal(await page.evaluate(() => window.lastConnectivityPayload.proxy.host), 'draft.proxy')
    assert.equal(await page.evaluate(() => window.lastSavedSettings), undefined)
    assert.equal(await page.evaluate(() => window.lastSavedConfig), undefined)
    await diagnostic.getByRole('button', { name: 'Close dialog', exact: true }).click()
    assert.equal(await dialog.getByLabel('Host', { exact: true }).inputValue(), 'draft.proxy')
    assert.equal(await dialog.getByRole('combobox', { name: 'Primary language', exact: true }).inputValue(), 'en-US')
    for (const width of [1280, 950, 390]) {
      await page.setViewportSize({ width, height: 860 })
      const heights = await dialog.locator('.settings-dialog-footer-actions button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height))
      assert.deepEqual(heights, [32, 32, 32])
      assert.equal(await dialog.locator('.settings-dialog-footer').evaluate(element => element.scrollWidth <= element.clientWidth), true)
    }
  } finally { await page.close() }
})

test('About has only a close button, repository link and focus trap; menu and F12 toggle DevTools', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await page.getByLabel('More actions', { exact: true }).click()
    await page.getByRole('button', { name: 'Dev-Tools (F12)', exact: true }).click()
    await page.keyboard.press('F12')
    await page.waitForFunction(() => window.devtoolsToggleCalls === 2)
    await page.getByLabel('More actions', { exact: true }).click()
    await page.getByRole('button', { name: 'About', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'About', exact: true })
    assert.equal((await dialog.boundingBox()).width, 450)
    assert.equal(await dialog.getByRole('button').count(), 1)
    await page.waitForFunction(() => document.activeElement?.classList.contains('settings-dialog-close'))
    assert.equal(await dialog.getByRole('heading', { name: 'Meeting Notes', exact: true }).count(), 1)
    assert.equal(await dialog.getByText(`Version: ${packageJson.version}`, { exact: true }).isVisible(), true)
    assert.match(await dialog.innerText(), /Martin Pietschmann/)
    assert.match(await dialog.innerText(), /License: MIT/)
    const [icon, details] = await Promise.all([dialog.getByRole('img').boundingBox(), dialog.locator('.about-details').boundingBox()])
    assert.ok(icon.width >= 96 && icon.x + icon.width < details.x)
    const gaps = await dialog.locator('.about-details > *').evaluateAll(elements => {
      const boxes = elements.map(element => element.getBoundingClientRect())
      return boxes.slice(1).map((box, index) => box.top - boxes[index].bottom)
    })
    assert.ok(gaps[0] > 0 && gaps.every(gap => gap === gaps[0]), `Uneven About spacing: ${gaps.join(', ')}`)
    await dialog.getByRole('link').click()
    assert.equal(await page.evaluate(() => window.repositoryOpened), true)
    await page.keyboard.press('Tab')
    assert.equal(await dialog.getByRole('button').evaluate(element => element === document.activeElement), true)
    await page.setViewportSize({ width: 390, height: 650 })
    assert.equal(await dialog.locator('.settings-dialog-grid').evaluate(element => element.scrollWidth <= element.clientWidth), true)
    await page.locator('.settings-dialog-overlay').click({ position: { x: 2, y: 2 } })
    assert.equal(await dialog.count(), 0)
    await page.getByLabel('More actions', { exact: true }).click()
    await page.getByRole('button', { name: 'About', exact: true }).click()
    await dialog.getByRole('button').click()
    assert.equal(await dialog.count(), 0)
  } finally { await page.close() }
})

test('web context menus are suppressed except in text fields and editable content', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    const prevented = locator => locator.evaluate(element => !element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
    assert.equal(await prevented(page.locator('.console-header')), true)
    assert.equal(await prevented(page.getByRole('checkbox', { name: 'Transcribe microphone', exact: true })), true)
    await page.getByRole('button', { name: 'Open settings dialog' }).click()
    assert.equal(await prevented(page.getByLabel('Endpoint', { exact: true })), false)
    assert.equal(await prevented(page.getByLabel('Speech Key', { exact: true })), false)
    assert.equal(await prevented(page.getByRole('combobox', { name: 'Primary language', exact: true })), true)
    assert.equal(await page.locator('main').evaluate(element => {
      const editable = document.createElement('div')
      editable.contentEditable = 'true'
      const child = document.createElement('span')
      editable.append(child)
      element.append(editable)
      const prevented = !child.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
      editable.remove()
      return prevented
    }), false)
  } finally { await page.close() }
})

for (const [name, configState] of [
  ['missing configuration', { exists: false, path: 'test-config', config: null }],
  ['unreadable configuration', { exists: true, path: 'test-config', config: null }],
  ['incomplete configuration', { exists: true, path: 'test-config', config: { ...validConfig, speechKey: ' ' } }],
  ['invalid proxy configuration', { exists: true, path: 'test-config', config: { ...validConfig, proxy: { host: 'proxy.test', port: 0 } } }]
]) {
  test(`${name} opens settings and shows a bottom toast without layout shift`, async () => {
    const page = await openApp({ configState })
    try {
      await page.getByRole('dialog', { name: 'Settings' }).waitFor()
      const toast = page.locator('.toast')
      await toast.waitFor()
      assert.match(await toast.innerText(), /Azure configuration is missing or incomplete/)
      assert.equal(await page.locator('main > .hint').count(), 0)
      const style = await toast.evaluate((element) => {
        const css = getComputedStyle(element)
        return { position: css.position, bottom: css.bottom }
      })
      assert.deepEqual(style, { position: 'fixed', bottom: '24px' })
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
      const before = await page.locator('.layout-grid').boundingBox()
      await page.getByRole('button', { name: 'Close error message', exact: true }).click()
      const after = await page.locator('.layout-grid').boundingBox()
      assert.deepEqual(after, before)
      assert.equal(await page.getByRole('dialog').count(), 0)
    } finally {
      await page.close()
    }
  })
}

test('valid startup configuration leaves settings closed', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await page.locator('.hero-controls .primary-button:not(:disabled)').waitFor()
    assert.equal(await page.getByRole('dialog').count(), 0)
    assert.equal(await page.locator('.toast').count(), 0)
  } finally {
    await page.close()
  }
})

test('a first live paused status preserves segments and wins over a delayed initial status', async () => {
  const startedAt = new Date().toISOString()
  const page = await openApp({
    configState: { exists: true, path: 'test-config', config: validConfig },
    running: true,
    startedAt,
    deferInitialStatus: true
  })
  try {
    await page.waitForFunction(() => typeof window.completeInitialStatus === 'function')
    await emitSegments(page)
    await page.getByRole('button', { name: 'Speaker mapping show', exact: true }).click()
    await page.getByRole('textbox', { name: 'Display name for Mic · Guest-1', exact: true }).fill('Anna')
    await page.evaluate(value => window.emitStatus({ running: true, paused: true, startedAt: value }), startedAt)
    const resume = page.getByRole('button', { name: 'Resume', exact: true })
    await resume.waitFor()
    const badges = page.locator('.speaker-badge')
    assert.deepEqual(await badges.allTextContents(), ['Anna', 'Speaker · Guest-1'])

    // The Settings dialog waits for startup data, so its visibility confirms
    // the older status snapshot was processed, not just delivered to IPC.
    await page.getByRole('button', { name: 'Open settings dialog' }).click()
    await page.evaluate(() => window.completeInitialStatus())
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
    await dialog.waitFor()
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
    assert.equal(await resume.isVisible(), true)
    assert.equal(await page.getByRole('button', { name: 'Clear transcript', exact: true }).isDisabled(), true)
    assert.deepEqual(await badges.allTextContents(), ['Anna', 'Speaker · Guest-1'])
  } finally { await page.close() }
})

test('settings shows all sections without navigation and preserves two-column layout, save and test payloads', async () => {
  const page = await openApp({
    configState: { exists: true, path: 'test-config', config: validConfig },
    connectivityError: 'Local diagnostic test'
  })
  try {
    await page.getByRole('button', { name: 'Open settings dialog' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
    const panels = dialog.locator('.panel')
    assert.deepEqual(await panels.locator('h2').allTextContents(), ['General', 'Transcription', 'Speech recognition', 'Azure', 'Proxy'])
    const speech = panels.nth(2)
    const azure = panels.nth(3)
    const proxy = panels.nth(4)
    // Alle Abschnitte stehen gleichzeitig auf einer Seite.
    assert.equal(await dialog.getByRole('navigation').count(), 0)
    assert.equal(await dialog.getByRole('tab').count(), 0)
    assert.equal(await dialog.getByRole('combobox', { name: 'Microphone', exact: true }).count(), 0)
    await azure.getByRole('heading', { name: 'Azure', exact: true }).scrollIntoViewIfNeeded()
    assert.equal(await azure.getByLabel('Host', { exact: true }).count(), 0)
    assert.equal(await proxy.getByRole('button', { name: 'Test connection', exact: true }).count(), 0)
    assert.equal(await azure.getByRole('button', { name: 'Test connection', exact: true }).count(), 0)
    assert.equal(await panels.locator('.meta-path').count(), 0)
    const footer = dialog.locator('.settings-dialog-footer')
    assert.equal(await footer.getByRole('button', { name: 'Test connection', exact: true }).count(), 1)
    assert.equal(await footer.getByRole('button', { name: 'Test connection', exact: true }).getAttribute('title'), null)
    assert.deepEqual(await footer.locator('.meta-path').allTextContents(), [
      'Configuration: test-config'
    ])
    assert.equal(await dialog.locator('.settings-dialog-grid .settings-dialog-footer').count(), 0)
    const dialogBox = await dialog.boundingBox()
    assert.equal(dialogBox.width, 770)
    const [endpointBox, regionBox] = await Promise.all([
      azure.getByLabel('Endpoint', { exact: true }).boundingBox(),
      azure.getByLabel('Region', { exact: true }).boundingBox()
    ])
    assert.ok(endpointBox.y + endpointBox.height <= regionBox.y)
    const general = panels.nth(0)
    const transcription = panels.nth(1)
    assert.equal(await general.getByRole('checkbox').count(), 2)
    assert.equal(await transcription.getByRole('checkbox').count(), 3)
    const autoStart = transcription.getByRole('checkbox', { name: 'Start transcription automatically', exact: true })
    const autoStop = transcription.getByRole('checkbox', { name: 'Stop transcription automatically', exact: true })
    await autoStart.uncheck()
    assert.equal(await autoStop.isDisabled(), true)
    await autoStart.check()
    assert.equal(await autoStop.isDisabled(), false)
    const speechControl = (role, name) => speech.getByRole(role, { name, exact: true }).locator('..')
    for (const [left, right] of [
      [speechControl('combobox', 'Transcription model'), speechControl('combobox', 'Audio stream mode')],
      [speechControl('combobox', 'Primary language'), speechControl('checkbox', 'Automatic language detection')],
      [speechControl('checkbox', 'Speaker recognition'), speechControl('checkbox', 'Enable interim results')]
    ]) {
      const [a, b] = await Promise.all([left.boundingBox(), right.boundingBox()])
      assert.ok(Math.abs(a.y + a.height - b.y - b.height) < 1)
      assert.ok(a.x + a.width < b.x)
    }
    for (const [left, right] of [
      [autoStart.locator('..'), autoStop.locator('..')],
      [transcription.getByRole('checkbox', { name: 'Save transcript automatically', exact: true }).locator('..'), transcription.locator('.directory-control')]
    ]) {
      const [leftBox, rightBox] = await Promise.all([left.boundingBox(), right.boundingBox()])
      assert.equal(leftBox.y, rightBox.y)
      assert.ok(Math.abs(leftBox.width - rightBox.width) < 1)
      assert.ok(Math.abs(rightBox.x - leftBox.x - leftBox.width - 17) < 1)
    }
    for (const header of await panels.locator('.panel-header').all()) {
      assert.equal(await header.evaluate(element => getComputedStyle(element, '::after').borderTopWidth), '1px')
    }
    const gaps = await panels.locator('.settings-block').evaluateAll(elements => elements.map(element => {
      const style = getComputedStyle(element)
      return [style.columnGap, style.rowGap]
    }))
    assert.deepEqual(gaps, Array(5).fill(['17px', '17px']))
    for (const checkbox of await dialog.getByRole('checkbox').all()) {
      const box = await checkbox.boundingBox()
      assert.equal(box.width, 14)
      assert.equal(box.height, 14)
    }
    const exportControl = transcription.locator('.directory-control')
    assert.equal(await exportControl.locator('label').count(), 0)
    const toggleBox = await transcription.getByRole('checkbox', { name: 'Save transcript automatically', exact: true }).boundingBox()
    const pathBox = await exportControl.getByRole('textbox').boundingBox()
    assert.ok(toggleBox.x + toggleBox.width < pathBox.x)
    assert.ok(Math.abs(toggleBox.y + toggleBox.height / 2 - pathBox.y - pathBox.height / 2) < 1)
    const folderButton = exportControl.getByRole('button', { name: 'Choose save folder' })
    assert.equal(await folderButton.innerText(), '')
    assert.equal(await folderButton.getAttribute('title'), 'Choose folder')
    await proxy.getByRole('heading', { name: 'Proxy', exact: true }).scrollIntoViewIfNeeded()
    const gridBox = await dialog.locator('.settings-dialog-grid').boundingBox()
    const proxyBox = await proxy.boundingBox()
    assert.ok(proxyBox.y < gridBox.y + gridBox.height, 'Proxy-Abschnitt bleibt im sichtbaren Bereich')
    assert.equal(await panels.count(), 5)
    assert.equal(await proxy.locator('.settings-inline-hint').count(), 0)
    assert.equal(await proxy.getByRole('checkbox').count(), 0)
    assert.equal(await proxy.locator('input:disabled').count(), 0)
    await proxy.getByLabel('Host', { exact: true }).fill('proxy.test')
    await proxy.getByLabel('Port', { exact: true }).fill('8080')
    await proxy.getByLabel('Username (optional)', { exact: true }).fill('test-user')
    await proxy.getByLabel('Password (optional)', { exact: true }).fill('test-password')
    const proxyConfig = { host: 'proxy.test', port: 8080, username: 'test-user', password: 'test-password' }
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForFunction(() => !!window.lastSavedConfig)
    assert.deepEqual(await page.evaluate(() => window.lastSavedConfig), { ...validConfig, proxy: proxyConfig })
    await reopenSettings(page)
    await proxy.getByRole('heading', { name: 'Proxy', exact: true }).scrollIntoViewIfNeeded()
    assert.deepEqual(await dialog.boundingBox(), dialogBox)
    for (const width of [1280, 800, 560, 390]) {
      await page.setViewportSize({ width, height: 860 })
      const before = await dialog.boundingBox()
      for (const section of ['General', 'Transcription', 'Speech recognition', 'Azure', 'Proxy']) {
        await dialog.getByRole('heading', { name: section, exact: true }).scrollIntoViewIfNeeded()
        assert.deepEqual(await dialog.boundingBox(), before)
        assert.equal(await panels.count(), 5)
      }
      const [host, port, username, password] = await Promise.all([
        'Host', 'Port', 'Username (optional)', 'Password (optional)'
      ].map(name => proxy.getByLabel(name, { exact: true }).boundingBox()))
      if (width > 500) {
        assert.equal(host.y, port.y)
        assert.equal(host.y, username.y)
        assert.equal(username.y, password.y)
        assert.ok(Math.abs(host.width / port.width - 35 / 15) < 0.05)
        assert.ok(Math.abs(username.width - password.width) < 1)
        assert.ok(host.x + host.width <= port.x)
      } else {
        assert.ok(port.y > host.y + host.height)
        assert.ok(password.y > username.y + username.height)
      }
      assert.equal(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth), true)
      assert.equal(await footer.evaluate((element) => element.scrollWidth <= element.clientWidth), true)
    }
    await footer.getByRole('button', { name: 'Test connection', exact: true }).click()
    await page.getByRole('dialog', { name: 'Connection test', exact: true }).locator('tbody tr').waitFor()
    assert.deepEqual(await page.evaluate(() => window.lastConnectivityPayload), {
      ...validConfig, proxy: proxyConfig, language: 'de-DE',
      transcription: { mic: true, speaker: true, audioMode: 'dual-mono' },
      autoLanguageDetection: true,
      diarization: true
    })
    await page.getByRole('dialog', { name: 'Connection test', exact: true }).getByRole('button', { name: 'Close dialog', exact: true }).click()
    await proxy.getByLabel('Host', { exact: true }).fill('')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    assert.deepEqual(await page.evaluate(() => window.lastSavedConfig), validConfig)
  } finally {
    await page.close()
  }
})

test('settings offers a single save button in the footer that persists config and settings together', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await page.getByRole('button', { name: 'Open settings dialog' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
    const footer = dialog.locator('.settings-dialog-footer')

    assert.equal(await dialog.boundingBox().then((box) => box.height), 620)
    const hintText = 'After saving, window settings apply immediately. Transcription settings apply to the next session.'
    assert.equal(await dialog.locator('.settings-dialog-grid').getByText(hintText, { exact: true }).count(), 0)
    const hint = footer.getByText(hintText, { exact: true })
    assert.equal(await hint.count(), 1)
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 860 })
      const copy = await footer.locator('.settings-dialog-footer-copy').boundingBox()
      const save = await footer.getByRole('button', { name: 'Save', exact: true }).boundingBox()
      const hintBox = await hint.boundingBox()
      const path = await footer.locator('.meta-path').boundingBox()
      const content = await footer.locator('.settings-dialog-footer-content').boundingBox()
      assert.equal(hintBox.x, path.x)
      assert.ok(path.y >= hintBox.y + hintBox.height)
      if (width > 500) {
        assert.ok(save.x >= copy.x + copy.width)
        assert.ok(Math.abs(save.y + save.height / 2 - copy.y - copy.height / 2) < 1)
      } else {
        assert.ok(save.y >= copy.y + copy.height)
      }
      const connection = await footer.getByRole('button', { name: 'Test connection', exact: true }).boundingBox()
      assert.equal(save.height, connection.height)
      assert.equal(save.height, 32)
      assert.equal(save.x + save.width, content.x + content.width)
    }
    await page.setViewportSize({ width: 1280, height: 860 })

    // Genau ein Speichern-Button im Dialog, und er liegt im Footer.
    assert.equal(await dialog.getByRole('button', { name: 'Save', exact: true }).count(), 1)
    assert.equal(await footer.getByRole('button', { name: 'Save', exact: true }).count(), 1)
    assert.equal(await dialog.locator('.panel').getByRole('button', { name: 'Save', exact: true }).count(), 0)
    // Die alten, panelspezifischen Buttons existieren nicht mehr.
    assert.equal(await dialog.getByRole('button', { name: 'Save settings', exact: true }).count(), 0)
    assert.equal(await dialog.getByRole('button', { name: 'Save Azure configuration', exact: true }).count(), 0)

    // Der Button steht unterhalb aller drei Bereiche.
    const footerBox = await footer.boundingBox()
    const bodyBox = await dialog.locator('.settings-dialog-grid').boundingBox()
    assert.ok(footerBox.y >= bodyBox.y + bodyBox.height)

    // Ein Klick speichert beide Abschnitte: Benutzereinstellungen und Azure-Konfiguration.
    await dialog.getByRole('combobox', { name: 'Primary language', exact: true }).selectOption('en-US')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForFunction(() => !!window.lastSavedSettings && !!window.lastSavedConfig)
    assert.equal(await page.evaluate(() => window.lastSavedSettings.language), 'en-US')
    assert.deepEqual(await page.evaluate(() => window.lastSavedConfig), validConfig)
    await dialog.waitFor({ state: 'hidden' })
  } finally {
    await page.close()
  }
})

test('native model selection applies the matrix and saves without Azure credentials', async () => {
  const page = await openApp({ configState: { exists: false, path: 'test-config', config: null }, webSpeech: true })
  try {
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
    const model = dialog.getByLabel('Transcription model')
    assert.deepEqual(await model.locator('option').allTextContents(), [
      'Azure Speech (standard)', 'Azure MAI Transcribe (Preview)', 'Windows SAPI (Experimental)', 'Web Speech API (Experimental)'
    ])
    await model.selectOption('windows-sapi')
    assert.equal(await dialog.getByLabel('Endpoint', { exact: true }).isEnabled(), true)
    assert.equal(await dialog.getByLabel('Speech Key').isEnabled(), true)
    assert.equal(await dialog.getByLabel('Host', { exact: true }).isEnabled(), true)
    assert.equal(await dialog.getByLabel('Primary language').isEnabled(), true)
    assert.equal(await dialog.getByLabel('Audio stream mode').isDisabled(), true)
    assert.equal(await dialog.getByLabel('Speaker recognition', { exact: true }).isDisabled(), true)
    assert.equal(await dialog.getByLabel('Enable interim results').isDisabled(), true)
    assert.equal(await dialog.getByLabel('Start transcription automatically').isEnabled(), true)
    await model.selectOption('web-speech')
    assert.equal(await dialog.getByLabel('Start transcription automatically').isDisabled(), true)
    assert.equal(await dialog.getByLabel('Enable interim results').isEnabled(), true)
    await dialog.getByRole('button', { name: 'Check model availability' }).click()
    const availability = page.getByRole('dialog', { name: 'Model availability' })
    await availability.getByText('Model check passed').waitFor()
    assert.equal(await page.evaluate(() => window.lastConnectivityPayload), undefined)
    await availability.getByRole('button', { name: 'Close dialog', exact: true }).click()
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await page.evaluate(() => window.lastSavedSettings.transcription.provider), 'web-speech')
    assert.equal(await page.evaluate(() => window.lastSavedConfig), undefined)
    assert.equal(await page.getByLabel('Transcribe speaker loopback').isDisabled(), true)
    assert.equal(await page.getByLabel('Microphone', { exact: true }).isDisabled(), true)
  } finally { await page.close() }
})

test('a removed saved model requires explicit reselection instead of falling back to Azure', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig },
    transcription: { provider: 'windows-ai-speech' } })
  try {
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
    const model = dialog.getByLabel('Transcription model')
    await model.waitFor()
    assert.equal(await model.inputValue(), 'unsupported')
    assert.equal(await model.locator('option[value="windows-ai-speech"]').count(), 0)
    const save = dialog.getByRole('button', { name: 'Save', exact: true })
    assert.ok(await save.isDisabled())
    assert.equal(await page.evaluate(() => window.lastStartCalled), undefined)
    await model.selectOption('windows-sapi')
    await save.click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await page.evaluate(() => window.lastSavedSettings.transcription.provider), 'windows-sapi')
  } finally { await page.close() }
})

test('Web Speech starts without Azure, drains finals on quit and does not call the sidecar stop', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: null },
    transcription: { provider: 'web-speech', webInterimResults: true }, webSpeech: true })
  try {
    await page.getByRole('button', { name: 'Start', exact: true }).click()
    await page.getByRole('button', { name: 'Stop', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Pause', exact: true }).isDisabled(), true)
    assert.deepEqual(await page.evaluate(() => [window.lastStartProvider, window.webRecognition.lang, window.webRecognition.interimResults]), ['web-speech', 'de-DE', true])
    assert.equal(await page.evaluate(() => window.lastStartMode), 'live')
    assert.equal(await page.getByRole('region', { name: 'Batch transcription' }).count(), 0)
    await page.evaluate(() => {
      window.emitStatus({ running: false })
      window.emitQuitExport('web-quit')
    })
    await page.waitForFunction(() => window.quitExportReplies?.length === 1)
    assert.match(await page.evaluate(() => window.lastSavedMarkdown), /Last browser words/)
    assert.deepEqual(await page.evaluate(() => window.quitExportReplies), [{ requestId: 'web-quit', error: null }])
    assert.equal(await page.evaluate(() => window.lastStopCalled), undefined)
  } finally { await page.close() }
})

test('Meeting mode controls automatic recording, and clean stop prefills both WAVs with the click time', async () => {
  const micPath = 'D:/recordings/2026-11-27T16-25-22.123Z-mic.wav'
  const speakerPath = 'D:/recordings/2026-11-27T16-25-22.123Z-speaker.wav'
  const startedAt = '2026-11-27T16:25:22.123Z'
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: null }, transcription: { provider: 'windows-sapi' }, stopRecording: { micPath, speakerPath },
    inputs: [{ id: 'batch-mic', name: 'Batch mic', isDefault: false }], outputs: [{ id: 'batch-speaker', name: 'Batch speaker', isDefault: false }] })
  try {
    const mode = page.getByLabel('Meeting mode')
    assert.equal(await mode.inputValue(), 'live')
    assert.ok(await page.getByText('Live model: Windows SAPI (Experimental)', { exact: true }).isVisible())
    await page.getByRole('button', { name: 'Change live model' }).click()
    const liveDialog = page.getByRole('dialog', { name: 'Settings' })
    assert.equal(await liveDialog.getByLabel('Transcription model').inputValue(), 'windows-sapi')
    await liveDialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
    await mode.selectOption('batch')
    await page.waitForFunction(() => window.lastSavedSettings?.transcription.mode === 'batch')
    await reopenSettings(page)
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    assert.ok(await dialog.getByLabel('Start recording automatically').isEnabled())
    assert.ok(await dialog.getByLabel('Stop recording automatically').isEnabled())
    assert.equal(await dialog.getByLabel('Transcription model').count(), 0)
    assert.equal(await dialog.getByLabel('Audio stream mode').count(), 0)
    assert.equal(await dialog.getByLabel('Enable interim results').count(), 0)
    assert.equal(await dialog.getByRole('button', { name: /test.*connection|check model availability/i }).count(), 0)
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await page.getByRole('button', { name: 'Change live model' }).count(), 0)
    await page.getByLabel('Microphone', { exact: true }).selectOption('batch-mic')
    await page.getByLabel('Speaker Loopback', { exact: true }).selectOption('batch-speaker')
    assert.ok(await page.getByLabel('Record microphone', { exact: true }).isChecked())
    assert.ok(await page.getByLabel('Record speaker loopback', { exact: true }).isChecked())
    await page.evaluate((instant) => { Date.now = () => instant }, Date.parse(startedAt))
    await page.getByRole('button', { name: 'Start recording', exact: true }).click()
    const stop = page.getByRole('button', { name: 'Stop recording', exact: true })
    await stop.waitFor()
    assert.equal(await page.getByRole('button', { name: 'Pause', exact: true }).count(), 0)
    assert.equal(await page.getByRole('region', { name: 'Batch transcription' }).count(), 0)
    assert.deepEqual(await page.evaluate(() => [window.lastStartProvider, window.lastStartMode, window.lastSavedSettings.devices, window.lastStartRequestedAt]), [
      'windows-sapi', 'batch', { micId: 'batch-mic', speakerLoopbackId: 'batch-speaker' }, Date.parse(startedAt)
    ])
    await stop.click()
    const form = page.getByRole('region', { name: 'Batch transcription' })
    await form.getByText(micPath, { exact: true }).waitFor()
    assert.ok(await form.getByText(speakerPath, { exact: true }).isVisible())
    assert.equal(await form.getByLabel('Microphone start time').inputValue(), startedAt)
    assert.equal(await form.getByLabel('Speaker start time').inputValue(), startedAt)
    assert.equal(await form.getByText(/estimated/i).count(), 0)
    assert.equal(await page.evaluate(() => window.batchCalls ?? window.transcriptWrites), undefined)
    await page.getByRole('button', { name: 'Transcribe', exact: true }).click()
    await page.getByRole('alert').getByText(/Configure the Azure endpoint, region and speech key/).waitFor()
    assert.equal(await page.evaluate(() => window.batchCalls), undefined)
  } finally { await page.close() }
})

const batchFinal = { id: 'batch-test', sessionId: 'batch-session', source: 'mic', speaker: '', timestampIso: '2026-11-26T11:11:00Z', text: 'Batch final text', state: 'final' }

test('Two explicitly assigned WAVs require Azure consent and export from the earliest sample zero', async () => {
  const mic = 'D:/audio/interview-mic.wav'
  const speaker = 'D:/audio/interview-speaker.wav'
  const speakerEstimate = '2026-11-26T11:10:39.120Z'
  const micStart = '2026-11-26T11:10:40.000Z'
  const firstStart = '2026-11-26T11:10:39.123Z'
  const model = 'mai-transcribe-2-streaming'
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig },
    transcription: { provider: 'web-speech' }, batchPickerResult: mic,
    batchInspections: { [mic]: { startedAt: micStart, estimated: false }, [speaker]: { startedAt: speakerEstimate, estimated: true } },
    batchResult: [batchFinal, { ...batchFinal, id: 'partial', text: 'Do not show', state: 'interim' }] })
  try {
    await page.getByRole('button', { name: 'Transcribe files' }).click()
    const form = page.getByRole('region', { name: 'Batch transcription' })
    const modelSelect = form.getByLabel('File transcription model')
    assert.deepEqual(await modelSelect.locator('option').allTextContents(), ['Azure Speech (standard)', 'Azure MAI Transcribe (Preview)', 'Windows SAPI (Experimental)'])
    await modelSelect.selectOption(model)
    assert.equal(await form.getByRole('button', { name: /test.*connection|check model availability/i }).count(), 0)
    const pickMic = form.getByRole('button', { name: 'Choose microphone WAV' })
    const pickSpeaker = form.getByRole('button', { name: 'Choose speaker WAV' })
    const transcribe = form.getByRole('button', { name: 'Transcribe', exact: true })
    assert.equal(await transcribe.isDisabled(), true)
    await pickMic.click()
    const selected = form.getByText(mic, { exact: true })
    await selected.waitFor()
    assert.equal(await page.evaluate(() => window.batchCalls), undefined)
    await page.evaluate(() => { window.batchPickerResult = null })
    await pickMic.click()
    assert.equal(await selected.isVisible(), true)
    await page.evaluate(path => { window.batchPickerResult = path }, speaker)
    await pickSpeaker.click()
    await form.getByText('Estimated from the file’s timestamp.', { exact: false }).waitFor()
    const speakerStart = form.getByLabel('Speaker start time')
    assert.equal(await speakerStart.inputValue(), speakerEstimate)
    await speakerStart.fill('')
    await transcribe.click()
    await page.getByRole('alert').getByText('Enter the speaker start time before transcribing.').waitFor()
    await speakerStart.fill('not a timestamp')
    await transcribe.click()
    await page.getByRole('alert').getByText('Enter a valid speaker start time with a UTC offset or Z.').waitFor()
    await speakerStart.fill('2026-11-26T12:10:39.123+01:00')
    assert.equal(await form.getByText(/estimated/i).count(), 0)
    page.once('dialog', prompt => {
      assert.match(prompt.message(), /Send the selected audio to Azure/)
      assert.ok(prompt.message().includes(`Microphone: ${mic}`))
      assert.ok(prompt.message().includes(`Speaker: ${speaker}`))
      return prompt.dismiss()
    })
    await transcribe.click()
    assert.equal(await page.evaluate(() => window.batchCalls), undefined)
    page.once('dialog', prompt => prompt.accept())
    await transcribe.click()
    await page.getByText('Batch final text', { exact: true }).waitFor()
    await page.getByText('Transcript saved: D:/Notes/transcript-2026-11-11-22-05-00.md', { exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.batchCalls), [{ tracks: [
      { path: mic, source: 'mic', startedAt: micStart }, { path: speaker, source: 'speaker', startedAt: firstStart }
    ], provider: 'azure', model }])
    const markdown = await page.evaluate(() => window.lastSavedMarkdown)
    const exportedStart = markdown.match(/^start: "([^"]+)"$/m)?.[1]
    assert.equal(Date.parse(exportedStart), Date.parse(firstStart))
    assert.match(markdown, /Mic: Batch final text/)
    assert.equal(await page.evaluate(() => window.lastSavedSettings ?? window.lastSavedConfig), undefined)
    assert.equal(await page.getByText('Do not show', { exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Copy transcript' }).click()
    assert.equal(await page.evaluate(() => window.lastCopiedSegments[0].text), batchFinal.text)
    assert.equal(await page.evaluate(() => window.lastCopiedStart), firstStart)
    await page.evaluate(() => { window.batchError = 'Speech resource denied the request' })
    page.once('dialog', prompt => prompt.accept())
    await transcribe.click()
    await page.getByRole('alert').getByText('Speech resource denied the request', { exact: true }).waitFor()
    assert.equal(await selected.isVisible(), true)
    assert.equal(await page.getByText('Batch final text', { exact: true }).isVisible(), true)
    assert.equal(await page.evaluate(() => window.transcriptWrites), 1)
  } finally { await page.close() }
})

test('Automatic local capture prefills both files for local SAPI transcription without uploading', async () => {
  const startedAt = '2026-11-26T11:10:30.123Z'
  const micPath = 'D:/recordings/auto-mic.wav'
  const speakerPath = 'D:/recordings/auto-speaker.wav'
  const page = await openApp({ configState: { exists: false, path: 'test-config', config: null },
    transcription: { provider: 'windows-sapi', mode: 'batch' }, transcript: { markdownExport: { enabled: false } }, batchResult: [{ ...batchFinal, source: 'speaker' }],
    connectivityResult: { reachable: true, speechReachable: true, latencyMs: 2, steps: [] } })
  try {
    await page.getByRole('button', { name: 'Start recording', exact: true }).waitFor()
    await page.evaluate(() => {
      window.emitMeetingDetected({ processName: 'teams', processId: 1, signal: 'mic' })
      window.emitStatus({ running: true, startedAt: new Date().toISOString() })
    })
    await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
    await page.getByText('Meeting detected (teams). Local recording starts automatically.', { exact: true }).waitFor()
    await page.evaluate(recording => window.emitStatus({ running: false, recording }), { startedAt, micPath, speakerPath })
    const form = page.getByRole('region', { name: 'Batch transcription' })
    await form.getByText(speakerPath, { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.lastStartCalled ?? window.batchCalls ?? window.transcriptWrites), undefined)
    await form.getByLabel('File transcription model').selectOption('windows-sapi')
    const transcribe = form.getByRole('button', { name: 'Transcribe', exact: true })
    assert.ok(await transcribe.isEnabled())
    await form.getByRole('button', { name: 'Check model availability' }).click()
    const availability = page.getByRole('dialog', { name: 'Model availability' })
    await availability.getByText('Model check passed').waitFor()
    assert.deepEqual(await page.evaluate(() => window.lastConnectivityPayload), { provider: 'windows-sapi', language: 'de-DE' })
    await availability.getByRole('button', { name: 'Close dialog', exact: true }).click()
    await transcribe.click()
    await page.getByText('Batch final text', { exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.batchCalls), [{ tracks: [{ path: micPath, source: 'mic', startedAt }, { path: speakerPath, source: 'speaker', startedAt }], provider: 'windows-sapi', model: undefined }])
    assert.equal(await page.evaluate(() => window.transcriptWrites), undefined)
    await page.getByLabel('Meeting mode').selectOption('live')
    await page.waitForFunction(() => !!window.lastSavedSettings && window.lastSavedSettings.transcription.mode === undefined)
    await reopenSettings(page)
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    assert.equal(await dialog.getByLabel('Transcription model').inputValue(), 'windows-sapi')
  } finally { await page.close() }
})

test('MAI selection tests the unsaved draft and preserves Standard controls when switching back', async () => {
  const model = 'mai-transcribe-2-streaming'
  const page = await openApp({
    configState: { exists: true, path: 'test-config', config: validConfig },
    connectivityResult: {
      reachable: true, speechReachable: true, latencyMs: 10,
      steps: [{ step: 'mai_transcribe_wss', status: 'ok', detail: 'Speech connection ready' }]
    }
  })
  try {
    await page.getByRole('button', { name: 'Open settings dialog' }).click()
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    const modelSelect = settings.getByLabel('Transcription model')
    const audioMode = settings.getByLabel('Audio stream mode')
    const endpoint = settings.getByRole('textbox', { name: 'Endpoint', exact: true })
    const language = settings.locator('.language-field').getByRole('combobox')
    const speakerRecognition = settings.getByRole('checkbox', { name: 'Speaker recognition', exact: true })
    assert.equal(await modelSelect.inputValue(), 'standard')
    assert.equal(await audioMode.inputValue(), 'dual-mono')
    assert.deepEqual(await audioMode.locator('option').allTextContents(), [
      'Mono (separate sessions per audio device)', 'Stereo (one session)'
    ])
    await audioMode.selectOption('stereo')
    await modelSelect.selectOption(model)
    assert.equal(await audioMode.inputValue(), 'dual-mono')
    assert.equal(await audioMode.isDisabled(), true)
    assert.equal(await speakerRecognition.isDisabled(), true)
    assert.equal(await speakerRecognition.isChecked(), false)
    const modelHint = await settings.locator('#audio-stream-mode-hint').innerText()
    assert.match(modelHint, /Mono uses one Azure session per enabled source/)
    assert.match(modelHint, /Stereo uses one session for both sources/)
    assert.match(modelHint, /MAI uses mono only/)
    assert.equal(await endpoint.isEnabled(), true)
    assert.equal(await language.isDisabled(), true)
    await settings.getByRole('button', { name: 'Test connection', exact: true }).click()

    const connection = page.getByRole('dialog', { name: 'Connection test', exact: true })
    await connection.getByText('Speech connection ready', { exact: true }).waitFor()
    assert.match(await connection.innerText(), /HTTPS: not checked · Speech\/WSS: reachable/)
    assert.equal(await page.evaluate(() => window.lastConnectivityPayload.model), model)
    assert.equal(await page.evaluate(() => window.lastConnectivityPayload.transcription.audioMode), 'dual-mono')
    assert.equal(await page.evaluate(() => window.lastConnectivityPayload.diarization), false)
    assert.equal(await page.evaluate(() => window.lastSavedSettings), undefined)
    assert.equal(await page.evaluate(() => window.lastSavedConfig), undefined)
    await connection.getByRole('button', { name: 'Close dialog', exact: true }).click()
    await settings.getByRole('button', { name: 'Save', exact: true }).click()
    await settings.waitFor({ state: 'hidden' })
    assert.deepEqual(await page.evaluate(() => window.lastSavedConfig), { ...validConfig, model })
    await reopenSettings(page)
    assert.equal(await speakerRecognition.isDisabled(), true)
    assert.equal(await speakerRecognition.isChecked(), false)
    assert.equal(await modelSelect.inputValue(), model)
    assert.equal(await audioMode.inputValue(), 'dual-mono')
    await modelSelect.selectOption('standard')
    assert.equal(await audioMode.inputValue(), 'stereo')
    assert.equal(await endpoint.inputValue(), validConfig.endpoint)
    assert.equal(await endpoint.isEnabled(), true)
    assert.equal(await language.isEnabled(), true)
    assert.equal(await speakerRecognition.isEnabled(), true)
    assert.equal(await speakerRecognition.isChecked(), true)
    await settings.getByRole('button', { name: 'Save', exact: true }).click()
    await settings.waitFor({ state: 'hidden' })
    assert.deepEqual(await page.evaluate(() => window.lastSavedConfig), validConfig)
  } finally {
    await page.close()
  }
})

test('language dropdown saves the selection and forwards it to connectivity testing', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig }, deferConnectivity: true })
  try {
    await page.getByRole('button', { name: 'Open settings dialog' }).click()
    const language = page.getByRole('combobox', { name: 'Primary language', exact: true })
    assert.equal(await language.inputValue(), 'de-DE')
    assert.equal(await language.locator('option').count(), 10)
    assert.equal(await page.getByRole('radiogroup').count(), 0)
    await language.selectOption('en-US')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForFunction(() => window.lastSavedSettings?.language === 'en-US')
    await reopenSettings(page)
    await page.getByRole('button', { name: 'Test connection', exact: true }).click()
    await page.getByRole('dialog', { name: 'Connection test', exact: true }).waitFor()
    assert.equal((await page.evaluate(() => window.lastConnectivityPayload)).language, 'en-US')
  } finally {
    await page.close()
  }
})

test('idle settings save rapid changes in order before enabling recording', async () => {
  const page = await openApp({
    configState: { exists: true, path: 'test-config', config: validConfig },
    deferSettings: true,
    inputs: [{ id: 'mic-one', name: 'Test microphone', isDefault: false }]
  })
  try {
    const idle = page.locator('.idle-audio-panel')
    await idle.getByRole('checkbox', { name: 'Transcribe microphone', exact: true }).uncheck()
    await idle.getByRole('checkbox', { name: 'Transcribe microphone', exact: true }).check()
    await idle.getByRole('combobox', { name: 'Microphone', exact: true }).selectOption('mic-one')
    await idle.getByRole('checkbox', { name: 'Transcribe speaker loopback', exact: true }).uncheck()
    assert.equal(await page.getByRole('button', { name: 'Start', exact: true }).isDisabled(), true)
    assert.equal(await page.evaluate(() => window.settingsSaveCalls.length), 1)
    for (let count = 1; count <= 4; count++) {
      await page.evaluate(() => window.pendingSettingsSaves.shift()())
      if (count < 4) {
        await page.waitForFunction(value => window.settingsSaveCalls.length === value, count + 1)
        assert.equal(await idle.getByRole('combobox', { name: 'Microphone', exact: true }).inputValue(), 'mic-one')
        assert.equal(await idle.getByRole('checkbox', { name: 'Transcribe speaker loopback', exact: true }).isChecked(), false)
      }
    }
    await page.waitForFunction(() => window.lastSavedSettings?.devices.micId === 'mic-one' && window.lastSavedSettings.transcription.speaker === false)
    assert.equal(await page.evaluate(() => window.lastSavedSettings.language), 'de-DE')
    await page.locator('.hero-controls .primary-button:not(:disabled)').waitFor()
    assert.equal(await page.evaluate(() => window.lastSavedConfig), undefined)
  } finally { await page.close() }
})

test('failed idle autosave is visible and a successful retry restores recording', async () => {
  const page = await openApp({
    configState: { exists: true, path: 'test-config', config: validConfig },
    saveSettingsError: 'The configuration is read-only'
  })
  try {
    const idle = page.locator('.idle-audio-panel')
    await idle.getByRole('checkbox', { name: 'Transcribe speaker loopback', exact: true }).uncheck()
    await page.getByRole('alert').waitFor()
    assert.match(await page.getByRole('alert').innerText(), /read-only/)
    assert.equal(await page.getByRole('button', { name: 'Start', exact: true }).isDisabled(), true)
    await page.evaluate(() => { window.settingsSaveError = null })
    await idle.getByRole('checkbox', { name: 'Transcribe speaker loopback', exact: true }).check()
    await page.waitForFunction(() => window.lastSavedSettings?.language === 'de-DE' && window.lastSavedSettings.transcription.speaker === true)
    await page.locator('.hero-controls .primary-button:not(:disabled)').waitFor()
    assert.equal(await page.getByRole('alert').count(), 0)
  } finally { await page.close() }
})

for (const failure of ['saveSettingsError', 'saveConfigError']) {
  test(`settings dialog stays open on ${failure}`, async () => {
    const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig }, [failure]: 'The file cannot be saved' })
    try {
      await page.getByRole('button', { name: 'Open settings dialog' }).click()
      const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
      await dialog.getByRole('combobox', { name: 'Primary language', exact: true }).selectOption('en-US')
      assert.equal(await page.evaluate(() => window.lastSavedSettings), undefined)
      await dialog.getByRole('button', { name: 'Save', exact: true }).click()
      await page.getByRole('alert').waitFor()
      assert.equal(await dialog.isVisible(), true)
      assert.match(await dialog.locator('.hint').innerText(), /The file cannot be saved/)
      assert.equal(await dialog.getByRole('button', { name: 'Save', exact: true }).isDisabled(), false)
    } finally { await page.close() }
  })
}

test('language dropdown preserves a configured language outside the default options', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig }, language: 'fr-CA' })
  try {
    await page.getByRole('button', { name: 'Open settings dialog' }).click()
    assert.equal(await page.getByRole('combobox', { name: 'Primary language', exact: true }).inputValue(), 'fr-CA')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForFunction(() => window.lastSavedSettings?.language === 'fr-CA')
  } finally {
    await page.close()
  }
})

test('export folder picker preserves cancellation and saves the selected folder', async () => {
  const page = await openApp({
    configState: { exists: true, path: 'test-config', config: validConfig },
    directoryPickerResult: 'D:\\Meeting Notes'
  })
  try {
    await page.getByRole('button', { name: 'Open settings dialog' }).click()
    const path = page.getByRole('textbox', { name: 'Save path (optional)', exact: true })
    const picker = page.getByRole('button', { name: 'Choose save folder', exact: true })
    await picker.click()
    await page.waitForFunction(() => document.querySelector('#transcript-export-path')?.value === 'D:\\Meeting Notes')
    await page.evaluate(() => { window.directoryPickerResult = null })
    await picker.click()
    await page.waitForFunction(() => window.directoryPickerCalls === 2)
    assert.equal(await path.inputValue(), 'D:\\Meeting Notes')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForFunction(() => window.lastSavedSettings?.transcript.markdownExport.path === 'D:\\Meeting Notes')
    await reopenSettings(page)
    await page.getByRole('checkbox', { name: 'Save transcript automatically', exact: true }).uncheck()
    assert.equal(await picker.isDisabled(), true)
    assert.equal(await path.isDisabled(), true)
  } finally { await page.close() }
})

test('export folder picker errors leave the previous path intact and visible', async () => {
  const page = await openApp({
    configState: { exists: true, path: 'test-config', config: validConfig },
    transcript: { markdownExport: { enabled: true, path: 'D:\\Existing' } },
    directoryPickerError: 'Folder selection failed'
  })
  try {
    await page.getByRole('button', { name: 'Open settings dialog' }).click()
    await page.getByRole('button', { name: 'Choose save folder', exact: true }).click()
    await page.getByRole('alert').waitFor()
    assert.match(await page.getByRole('alert').innerText(), /Folder selection failed/)
    assert.equal(await page.getByRole('textbox', { name: 'Save path (optional)', exact: true }).inputValue(), 'D:\\Existing')
    assert.equal(await page.getByRole('dialog', { name: 'Settings', exact: true }).isVisible(), true)
  } finally { await page.close() }
})

test('proxy fields stay editable while the language dropdown and Save are disabled during recording', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig }, running: true })
  try {
    await page.getByRole('button', { name: 'Open settings dialog' }).click()
    assert.equal(await page.getByRole('combobox', { name: 'Primary language', exact: true }).isDisabled(), true)
    await page.getByLabel('Host', { exact: true }).fill('proxy.test')
    assert.equal(await page.locator('.proxy-settings-grid input:disabled').count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true)
    assert.equal(await page.getByRole('checkbox', { name: 'Speaker recognition for microphone', exact: true }).count(), 0)
    assert.equal(await page.getByRole('checkbox', { name: 'Speaker recognition for speaker loopback', exact: true }).count(), 0)
  } finally {
    await page.close()
  }
})

test('recognition switches respect effective mode and save the draft preferences', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await reopenSettings(page)
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
    const model = dialog.getByLabel('Transcription model')
    const mode = dialog.getByLabel('Audio stream mode')
    const lid = dialog.getByLabel('Automatic language detection')
    const interim = dialog.getByLabel('Enable interim results')
    const speakers = dialog.getByLabel('Speaker recognition', { exact: true })
    await lid.uncheck()
    await interim.uncheck()
    await speakers.uncheck()
    await mode.selectOption('stereo')
    assert.equal(await lid.isDisabled(), true)
    assert.equal(await interim.isEnabled(), true)
    await interim.check()
    await interim.uncheck()
    await model.selectOption('mai-transcribe-2-streaming')
    assert.equal(await lid.isChecked(), true)
    assert.equal(await speakers.isDisabled(), true)
    assert.equal(await speakers.isChecked(), false)
    await model.selectOption('standard')
    assert.equal(await speakers.isEnabled(), true)
    assert.equal(await speakers.isChecked(), false)
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await page.evaluate(() => window.lastSavedSettings.autoLanguageDetection), false)
    assert.equal(await page.evaluate(() => window.lastSavedSettings.diarization), false)
    assert.equal(await page.evaluate(() => window.lastSavedConfig.interimResults), false)
    await page.locator('.idle-audio-panel').getByRole('checkbox', { name: 'Transcribe speaker loopback', exact: true }).uncheck()
    await page.waitForFunction(() => window.lastSavedSettings?.transcription.speaker === false)
    await reopenSettings(page)
    assert.equal(await mode.inputValue(), 'stereo')
    assert.equal(await lid.isEnabled(), true)
    assert.equal(await interim.isEnabled(), true)
    assert.equal(await lid.isChecked(), false)
    assert.equal(await interim.isChecked(), false)
  } finally { await page.close() }
})

  test('microphone transcription toggles independently in the idle panel', async () => {
    const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
    try {
      const panel = page.locator('.idle-audio-panel')
      const mic = panel.getByRole('checkbox', { name: 'Transcribe microphone', exact: true })
      const speaker = panel.getByRole('checkbox', { name: 'Transcribe speaker loopback', exact: true })
      await panel.getByRole('heading', { name: 'Audio devices', exact: true }).waitFor()
      for (const width of [1280, 950, 390]) {
        await page.setViewportSize({ width, height: 650 })
        assert.ok((await panel.boundingBox()).width <= 500)
        for (const [checkbox, device] of [[mic, 'Microphone'], [speaker, 'Speaker Loopback']]) {
          const toggleBox = await checkbox.boundingBox()
          const deviceBox = await panel.getByRole('combobox', { name: device, exact: true }).boundingBox()
          assert.ok(toggleBox.x + toggleBox.width <= deviceBox.x)
          assert.ok(Math.abs(toggleBox.y + toggleBox.height / 2 - deviceBox.y - deviceBox.height / 2) < 1)
          assert.equal(await panel.getByText(await checkbox.getAttribute('aria-label'), { exact: true }).count(), 0)
          const arrowStyle = await panel.getByRole('combobox', { name: device, exact: true }).evaluate(element => {
            const style = getComputedStyle(element)
            return [style.appearance, style.paddingRight, style.backgroundPositionX]
          })
          assert.deepEqual(arrowStyle, ['none', '32px', 'calc(100% - 10px)'])
        }
        const micBox = await panel.getByRole('combobox', { name: 'Microphone', exact: true }).boundingBox()
        const speakerBox = await panel.getByRole('combobox', { name: 'Speaker Loopback', exact: true }).boundingBox()
        assert.ok(speakerBox.y >= micBox.y + micBox.height)
        assert.equal(await panel.evaluate(element => element.scrollWidth <= element.clientWidth), true)
      }
      await mic.click()
      assert.equal(await mic.isChecked(), false)
      assert.equal(await speaker.isChecked(), true)
      assert.equal(await panel.getByRole('combobox', { name: 'Microphone', exact: true }).isDisabled(), true)
      assert.equal(await panel.getByRole('combobox', { name: 'Speaker Loopback', exact: true }).isDisabled(), false)
      await mic.click()
      assert.equal(await mic.isChecked(), true)
      assert.equal(await speaker.isChecked(), true)
      await speaker.click()
      assert.equal(await mic.isChecked(), true)
      assert.equal(await speaker.isChecked(), false)
      assert.equal(await mic.isDisabled(), false)
      await mic.click()
      assert.equal(await mic.isChecked(), false)
      assert.equal(await speaker.isChecked(), true)
      await speaker.click()
      assert.equal(await mic.isChecked(), true)
      assert.equal(await speaker.isChecked(), false)
    } finally { await page.close() }
  })

test('transcription sources default on, persist independently and keep the last source enabled', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    const mic = page.getByRole('checkbox', { name: 'Transcribe microphone', exact: true })
    const speaker = page.getByRole('checkbox', { name: 'Transcribe speaker loopback', exact: true })
    assert.equal(await mic.isChecked(), true)
    assert.equal(await speaker.isChecked(), true)
    // Speaker abschalten: Mic bleibt aktiv, beide Checkboxen bleiben bedienbar.
    await speaker.uncheck()
    await page.waitForFunction(() => window.lastSavedSettings?.transcription?.speaker === false)
    assert.equal(await mic.isChecked(), true)
    assert.equal(await speaker.isChecked(), false)
    assert.equal(await mic.isDisabled(), false)
    assert.equal(await speaker.isDisabled(), false)
    // Letzte aktive Quelle abwaehlen: die andere wird automatisch aktiviert.
    await mic.uncheck()
    assert.equal(await mic.isChecked(), false)
    assert.equal(await speaker.isChecked(), true)
    await page.waitForFunction(() => window.lastSavedSettings?.transcription?.mic === false && window.lastSavedSettings?.transcription?.speaker === true)
    await speaker.uncheck()
    assert.equal(await mic.isChecked(), true)
    assert.equal(await speaker.isChecked(), false)
    await page.waitForFunction(() => window.lastSavedSettings?.transcription?.mic === true && window.lastSavedSettings?.transcription?.speaker === false)
    await speaker.check()
    assert.equal(await mic.isDisabled(), false)
    await page.waitForFunction(() => window.lastSavedSettings?.transcription?.speaker === true)
    // Ein deaktiviertes Quellgeraet wird nicht mehr gebraucht.
    await speaker.uncheck()
    assert.equal(await page.getByRole('combobox', { name: 'Speaker Loopback', exact: true }).isDisabled(), true)
    // Die Diarization-Checkboxen folgen der Quelle: ohne Transkription ist
    // die Sprechererkennung fuer diese Quelle wirkungslos.
    assert.equal(await page.getByRole('combobox', { name: 'Microphone', exact: true }).isDisabled(), false)
    await speaker.check()
    assert.equal(await page.getByRole('combobox', { name: 'Speaker Loopback', exact: true }).isDisabled(), false)
  } finally {
    await page.close()
  }
})


test('close-to-tray checkbox defaults on and saves both states via the existing footer', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await page.getByRole('button', { name: 'Open settings dialog' }).click()
    const checkbox = page.getByRole('checkbox', { name: 'Minimize to system tray on close', exact: true })
    assert.equal(await checkbox.isChecked(), true)
    for (const enabled of [false, true]) {
      await checkbox.setChecked(enabled)
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await page.waitForFunction(value => window.lastSavedSettings?.window.minimizeToTrayOnClose === value, enabled)
      assert.deepEqual(await page.evaluate(() => window.lastSavedConfig), validConfig)
      await reopenSettings(page)
      assert.equal(await checkbox.isChecked(), enabled)
      assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).count(), 1)
    }
  } finally { await page.close() }
})

test('settings inputs and the folder picker have tooltips, including disabled fields', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    const audio = page.locator('.idle-audio-panel')
    await audio.waitFor()
    await page.getByRole('button', { name: 'Open settings dialog' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
    for (const inputs of [audio.locator('input, select'), dialog.locator('.settings-block :is(input, select, button)')]) {
      const missing = await inputs.evaluateAll(elements => elements
        .filter(element => !element.closest('[title]')?.title.trim())
        .map(element => element.getAttribute('aria-label') ?? element.outerHTML))
      assert.deepEqual(missing, [])
    }
  } finally { await page.close() }
})

test('Hide from taskbar defaults on and only applies the changed preference on Save', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await page.getByRole('button', { name: 'Open settings dialog' }).click()
    const checkbox = page.getByRole('checkbox', { name: 'Hide from taskbar', exact: true })
    assert.equal(await checkbox.isChecked(), true)
    for (const enabled of [false, true]) {
      await checkbox.setChecked(enabled)
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await page.waitForFunction(value => window.lastSavedSettings?.window.hideFromTaskbar === value, enabled)
      assert.equal(await page.evaluate(() => window.lastSavedSettings.window.minimizeToTrayOnClose), true)
      await reopenSettings(page)
      assert.equal(await checkbox.isChecked(), enabled)
    }
  } finally { await page.close() }
})

test('automatic transcription defaults on and explicitly disabled preferences load correctly', async () => {
  for (const explicitFalse of [false, true]) {
    const page = await openApp({
      configState: { exists: true, path: 'test-config', config: validConfig },
      autoStart: explicitFalse ? { enabled: false, processes: [] } : undefined,
      windowSettings: explicitFalse ? { minimizeToTrayOnClose: false, hideFromTaskbar: false } : undefined
    })
    try {
      await page.getByRole('button', { name: 'Open settings dialog' }).click()
      assert.equal(await page.getByRole('checkbox', { name: 'Start transcription automatically', exact: true }).isChecked(), !explicitFalse)
      assert.equal(await page.getByRole('checkbox', { name: 'Hide from taskbar', exact: true }).isChecked(), !explicitFalse)
      assert.equal(await page.getByRole('checkbox', { name: 'Minimize to system tray on close', exact: true }).isChecked(), !explicitFalse)
    } finally { await page.close() }
  }
})

test('saved close-to-tray preference loads and is disabled during recording', async () => {
  const page = await openApp({
    configState: { exists: true, path: 'test-config', config: validConfig },
    windowSettings: { minimizeToTrayOnClose: true }, running: true
  })
  try {
    await page.getByRole('button', { name: 'Open settings dialog' }).click()
    const checkbox = page.getByRole('checkbox', { name: 'Minimize to system tray on close', exact: true })
    assert.equal(await checkbox.isChecked(), true)
    assert.equal(await checkbox.isDisabled(), true)
  } finally { await page.close() }
})

test('saved disabled diarization options remain disabled on startup', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig }, diarization: { mic: false, speaker: false } })
  try {
    await reopenSettings(page)
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
    assert.equal(await dialog.getByRole('checkbox', { name: 'Speaker recognition', exact: true }).isChecked(), false)
  } finally {
    await page.close()
  }
})

test('unattributed stereo interim text has no source badge and clears on final', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await page.waitForFunction(() => typeof window.emitSegment === 'function')
    const emit = (event) => page.evaluate((segment) => window.emitSegment(segment), {
      sessionId: 'stereo-session', timestampIso: '2026-11-25T13:41:54Z', ...event
    })
    await emit({ id: 'interim', source: '', speaker: '', text: 'Unattributed words.', state: 'interim', utteranceOffsetTicks: 0 })
    const interim = page.locator('.segment.interim')
    await interim.getByText('Unattributed words.').waitFor()
    assert.equal(await interim.locator('.speaker-badge').count(), 0)
    await emit({ id: 'final', source: 'speaker', speaker: 'guest', text: 'Confirmed words.', state: 'final', utteranceOffsetTicks: 0 })
    await page.locator('.segment.final').getByText('Confirmed words.').waitFor()
    assert.equal(await interim.count(), 0)
  } finally { await page.close() }
})

test('stereo hypotheses survive channel metadata changes without duplicating or clearing another utterance', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await page.waitForFunction(() => typeof window.emitSegment === 'function')
    const emit = (id, source, utteranceOffsetTicks, state = 'interim', sessionId = 'stereo-session') => page.evaluate((segment) => window.emitSegment(segment), {
      id, source, utteranceOffsetTicks, state, speaker: '', text: id,
      sessionId, timestampIso: '2026-11-25T13:41:54Z'
    })
    const interims = page.locator('.segment.interim')
    await emit('Mic labelled', 'mic', 10)
    await emit('Speaker in progress', 'speaker', 20)
    await emit('Mic unlabelled', '', 10)
    await interims.getByText('Mic unlabelled', { exact: true }).waitFor()
    assert.equal(await interims.getByText('Mic labelled', { exact: true }).count(), 0)
    await emit('Mic labelled again', 'mic', 10)
    await interims.getByText('Mic labelled again', { exact: true }).waitFor()
    assert.equal(await interims.getByText('Mic unlabelled', { exact: true }).count(), 0)
    await emit('Mic finalized', 'mic', 10, 'final')
    await page.locator('.segment.final').getByText('Mic finalized').waitFor()
    assert.deepEqual(await interims.locator('.segment-text').allTextContents(), ['Speaker in progress'])
    await emit('Mic same offset', 'mic', 20)
    await interims.getByText('Mic same offset', { exact: true }).waitFor()
    await emit('Ambiguous update', '', 20)
    await emit('Marker', 'speaker', 30, 'interim', 'another-session')
    await interims.getByText('Marker', { exact: true }).waitFor()
    assert.deepEqual(await interims.locator('.segment-text').allTextContents(), ['Speaker in progress', 'Mic same offset', 'Marker'])
    await emit('Mic offset adjusted', 'mic', 23)
    await interims.getByText('Mic offset adjusted', { exact: true }).waitFor()
    assert.equal(await interims.getByText('Mic same offset', { exact: true }).count(), 0)
  } finally { await page.close() }
})

test('only adjacent finals with an identified speaker from the same source and session merge', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await page.waitForFunction(() => typeof window.emitSegment === 'function')
    await page.evaluate(() => {
      const base = { sessionId: 'meeting', source: 'mic', speaker: 'Guest-1', speakerIdentified: true,
        state: 'final', timestampIso: new Date().toISOString() }
      const events = [
        { text: 'First.' },
        { text: 'Other source in progress.', source: 'speaker', state: 'interim' },
        { text: 'Continued.' },
        { text: 'Unknown one.', speaker: 'Unknown', speakerIdentified: false },
        { text: 'Unknown two.', speaker: 'unknown', speakerIdentified: false },
        { text: 'Same ID after unknown.' },
        { text: 'Same ID different source.', source: 'speaker' },
        { text: 'Same ID different session.', source: 'speaker', sessionId: 'next-sdk-session' }
      ]
      events.forEach((event, index) => window.emitSegment({ ...base, ...event, id: `group-${index}` }))
    })
    await page.getByText('Same ID different session.', { exact: true }).waitFor()
    assert.deepEqual(await page.locator('.segment.final .segment-text').allTextContents(), [
      'First. Continued.', 'Unknown one.', 'Unknown two.', 'Same ID after unknown.',
      'Same ID different source.', 'Same ID different session.'
    ])
    assert.equal(await page.locator('.segment.final').nth(1).locator('.speaker-badge').innerText(), 'Mic')
  } finally { await page.close() }
})

test('more than 500 unattributed finals stay distinct in the UI, clipboard and Markdown', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await page.waitForFunction(() => typeof window.emitSegment === 'function')
    await page.evaluate(() => {
      for (let index = 0; index < 525; index++) {
        const mic = index === 0
        window.emitSegment({ id: `long-${index}`, sessionId: 'long-meeting', source: mic ? 'mic' : 'speaker',
          speaker: mic ? 'self' : 'guest', speakerIdentified: mic ? undefined : false, state: 'final',
          text: `Long meeting row ${index}.`, timestampIso: new Date(1795000000000 + index * 1000).toISOString() })
      }
    })
    const rows = page.locator('.segment.final')
    await page.getByText('Long meeting row 524.', { exact: true }).waitFor()
    assert.equal(await rows.count(), 525)
    assert.equal(await rows.first().locator('.speaker-badge').innerText(), 'Mic')
    assert.equal(await rows.last().locator('.speaker-badge').innerText(), 'Speaker Loopback')
    assert.equal(await rows.locator('.speaker-editor button').count(), 0)
    await page.getByRole('button', { name: 'Copy transcript', exact: true }).click()
    await page.waitForFunction(() => !!window.lastCopiedSegments)
    assert.deepEqual(await page.evaluate(() => window.lastCopiedSegments.map(({ id }) => id)),
      Array.from({ length: 525 }, (_, index) => `long-${index}`))
    await page.locator('.overflow-menu > summary').click()
    await page.getByRole('button', { name: 'Export Markdown', exact: true }).click()
    await page.waitForFunction(() => !!window.lastSavedMarkdown)
    const markdown = await page.evaluate(() => window.lastSavedMarkdown)
    assert.match(markdown, /segments: 525\nspeakers:\n  \[\]/)
    const lines = markdown.split('\n').filter((line) => line.startsWith('- ['))
    assert.equal(lines.length, 525)
    assert.match(lines[0], /Mic: Long meeting row 0\.$/)
    assert.match(lines.at(-1), /Speaker Loopback: Long meeting row 524\.$/)
  } finally { await page.close() }
})

test('Mic speakers get independent badges, aliases, interim handling and export labels', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await page.waitForFunction(() => typeof window.emitSegment === 'function')
    const events = [
      { source: 'mic', speaker: 'Guest-1', speakerIdentified: true, text: 'Mic first voice.', state: 'final' },
      { source: 'mic', speaker: 'Guest-2', speakerIdentified: true, text: 'Mic second voice.', state: 'final' },
      { source: 'speaker', speaker: 'Guest-1', speakerIdentified: true, text: 'Speaker first voice.', state: 'final' },
      { source: 'mic', speaker: 'unknown', text: 'Provisionally unknown.', state: 'interim' },
      { source: 'mic', speaker: 'Guest-1', speakerIdentified: true, text: 'Provisionally the first voice.', state: 'interim' },
      { source: 'mic', speaker: 'Guest-2', speakerIdentified: true, text: 'Mic corrected second voice.', state: 'final' }
    ]
    for (const [index, event] of events.entries()) {
      await page.evaluate((segment) => window.emitSegment(segment), { ...event, id: `segment-${index}`, language: 'de-DE', timestampIso: new Date(2026, 10, 9, 13, 0, index).toISOString() })
    }
    await page.locator('.segment.final').nth(3).waitFor()
    await page.getByRole('button', { name: 'Speaker mapping show', exact: true }).click()
    assert.equal(await page.locator('.segment.interim').count(), 0)
    assert.equal(await page.locator('.speaker-mapping-list .speaker-row').count(), 3)
    assert.deepEqual(await page.locator('.speaker-badge').allTextContents(), ['Mic · Guest-1', 'Mic · Guest-2', 'Speaker · Guest-1', 'Mic · Guest-2'])
    const badges = await page.locator('.speaker-editor').evaluateAll((elements) => elements.map((element) => element.className))
    assert.notEqual(badges[0], badges[1])
    assert.notEqual(badges[0], badges[2])
    await page.getByRole('textbox', { name: 'Display name for Mic · Guest-1', exact: true }).fill('Anna')
    await page.getByRole('textbox', { name: 'Display name for Mic · Guest-2', exact: true }).fill('Clara')
    await page.getByRole('textbox', { name: 'Display name for Speaker · Guest-1', exact: true }).fill('Bert')
    assert.deepEqual(await page.locator('.speaker-badge').allTextContents(), ['Anna', 'Clara', 'Bert', 'Clara'])
    assert.equal(await page.locator('.speaker-badge').last().innerText(), 'Clara')
    await page.getByRole('button', { name: 'Copy transcript', exact: true }).click()
    await page.waitForFunction(() => !!window.lastCopiedSegments)
    const copied = await page.evaluate(() => window.lastCopiedSegments)
    assert.deepEqual(copied.map((segment) => segment.speaker), ['Anna', 'Clara', 'Bert', 'Clara'])
    assert.deepEqual(copied.map((segment) => segment.source), ['mic', 'mic', 'speaker', 'mic'])
    assert.ok(copied.every((segment) => segment.state === 'final'))
  } finally {
    await page.close()
  }
})

test('pause and resume preserve segments and aliases when the renderer adopts a running session', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig }, running: true })
  try {
    await page.getByRole('button', { name: 'Stop', exact: true }).waitFor()
    await emitSegments(page)
    await page.getByRole('button', { name: 'Speaker mapping show', exact: true }).click()
    await page.getByRole('textbox', { name: 'Display name for Mic · Guest-1', exact: true }).fill('Anna')
    const badges = page.locator('.speaker-badge')
    assert.deepEqual(await badges.allTextContents(), ['Anna', 'Speaker · Guest-1'])
    assert.match(await page.locator('.live-badge').getAttribute('aria-label'), /Running/)
    await page.getByRole('button', { name: /Pause/ }).click()
    await page.waitForFunction(() => !!window.lastPauseCalled)
    await page.waitForFunction(() => document.querySelector('.live-badge')?.classList.contains('paused'))
    assert.match(await page.locator('.live-badge').getAttribute('aria-label'), /Paused/)
    assert.match(await page.locator('.live-badge').getAttribute('title'), /session stays active/)
    assert.deepEqual(await badges.allTextContents(), ['Anna', 'Speaker · Guest-1'])
    await page.getByRole('button', { name: /Resume/ }).click()
    await page.waitForFunction(() => !!window.lastResumeCalled)
    await page.waitForFunction(() => !document.querySelector('.live-badge')?.classList.contains('paused'))
    assert.match(await page.locator('.live-badge').getAttribute('aria-label'), /Running/)
    assert.deepEqual(await badges.allTextContents(), ['Anna', 'Speaker · Guest-1'])
  } finally {
    await page.close()
  }
})

test('the same SDK id in two sessions stays two separate speakers with separate aliases', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await page.waitForFunction(() => typeof window.emitSegment === 'function')
    const events = [
      { source: 'mic', speaker: 'Guest-1', speakerIdentified: true, sessionId: 's1', text: 'First session.', state: 'final' },
      { source: 'mic', speaker: 'Guest-1', speakerIdentified: true, sessionId: 's2', text: 'Second session.', state: 'final' }
    ]
    for (const [index, event] of events.entries()) {
      await page.evaluate((segment) => window.emitSegment(segment), { ...event, id: `segment-${index}`, language: 'de-DE', timestampIso: new Date(2026, 10, 13, 10, 0, index).toISOString() })
    }
    await page.locator('.segment.final').nth(1).waitFor()
    // Zwei Sitzungen, zwei Identitaeten: kein Zusammenfuehren ueber die Grenze.
    assert.equal(await page.locator('.segment.final').count(), 2)
    await page.getByRole('button', { name: 'Speaker mapping show', exact: true }).click()
    assert.equal(await page.locator('.speaker-mapping-list .speaker-row').count(), 2)
    await page.getByRole('textbox', { name: 'Display name for Mic · Guest-1 #1', exact: true }).fill('Anna')
    await page.getByRole('textbox', { name: 'Display name for Mic · Guest-1 #2', exact: true }).fill('Bert')
    assert.deepEqual(await page.locator('.speaker-badge').allTextContents(), ['Anna', 'Bert'])
    // Der Alias der ersten Sitzung faellt nicht auf die zweite.
    await page.getByRole('button', { name: 'Copy transcript', exact: true }).click()
    await page.waitForFunction(() => !!window.lastCopiedSegments)
    const copied = await page.evaluate(() => window.lastCopiedSegments)
    assert.deepEqual(copied.map((segment) => segment.speaker), ['Anna', 'Bert'])
  } finally {
    await page.close()
  }
})

test('saving a complete configuration replaces the warning and enables recording', async () => {
  const page = await openApp({ configState: { exists: false, path: 'test-config', config: null } })
  try {
    await page.getByRole('dialog', { name: 'Settings' }).waitFor()
    await page.getByRole('textbox', { name: 'Endpoint', exact: true }).fill(validConfig.endpoint)
    await page.getByRole('textbox', { name: 'Region', exact: true }).fill(validConfig.region)
    await page.getByLabel('Speech Key', { exact: true }).fill(validConfig.speechKey)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.toast-info')?.textContent.includes('Settings saved.'))
    await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor({ state: 'hidden' })
    await page.locator('.hero-controls .primary-button:not(:disabled)').waitFor()
    assert.equal(await page.getByRole('dialog').count(), 0)
  } finally {
    await page.close()
  }
})

for (const error of ['Proxy CONNECT: 407 Proxy Authentication Required', { message: 'The sidecar could not be started', code: 'SPAWN_FAILED' }]) {
  test(`connectivity dialog preserves IPC error details: ${JSON.stringify(error)}`, async () => {
    const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig }, connectivityError: error })
    try {
      await page.getByRole('button', { name: 'Open settings dialog' }).click()
      await page.getByRole('button', { name: 'Test connection', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Connection test', exact: true })
      await dialog.locator('tbody tr').waitFor()
      assert.match(await dialog.innerText(), /IPC \/ Start diagnostics/)
      assert.ok((await dialog.innerText()).includes(typeof error === 'string' ? error : error.message))
      assert.match(await dialog.innerText(), /HTTPS: not checked/)
      assert.equal(await page.getByRole('dialog').count(), 1)
    } finally {
      await page.close()
    }
  })
}

test('connectivity dialog displays pending test and all results, and can reopen without rerunning', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig }, deferConnectivity: true })
  try {
    await page.getByRole('button', { name: 'Open settings dialog' }).click()
    await page.getByRole('button', { name: 'Test connection', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Connection test', exact: true })
    await dialog.waitFor()
    assert.match(await dialog.innerText(), /Connection test running/)
    const gridWidth = await dialog.locator('.settings-dialog-grid').evaluate((element) => {
      const css = getComputedStyle(element)
      return element.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight)
    })
    const contentBox = await dialog.locator('.connectivity-dialog-content').boundingBox()
    assert.ok(Math.abs(contentBox.width - gridWidth) < 1)
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: 'Testing …', exact: true }).isDisabled(), true)
    await page.getByRole('button', { name: 'Show running connection test' }).click()
    await dialog.waitFor()
    assert.match(await dialog.innerText(), /Connection test running/)
    const result = {
      reachable: false, httpsReachable: true, speechReachable: false, httpStatus: 403,
      httpStatusText: 'Forbidden', latencyMs: 123, probeUrl: 'https://example.test/probe',
      error: 'Speech/WSS failed',
      steps: [
        { step: 'dns', status: 'ok', detail: 'Proxy DNS successful' },
        { step: 'tcp', status: 'ok', detail: 'TCP connected' },
        { step: 'https', status: 'warn', detail: 'HTTP 403 confirms reachability' },
        { step: 'speech_recognizer_wss', status: 'error', detail: 'TLS handshake rejected' },
        { step: 'conversation_transcriber_wss', status: 'error', detail: 'Connection timeout' }
      ]
    }
    await page.evaluate((value) => window.completeConnectivity(value), result)
    await dialog.locator('tbody tr').first().waitFor()
    assert.equal(await dialog.locator('tbody tr').count(), result.steps.length)
    for (const step of result.steps) assert.ok((await dialog.innerText()).includes(step.detail))
    assert.match(await dialog.innerText(), /HTTP 403 Forbidden/)
    assert.match(await dialog.innerText(), /HTTPS: reachable · Speech\/WSS: failed/)
    assert.equal((await page.evaluate(() => window.lastConnectivityPayload)).language, 'de-DE')
    for (const width of [1280, 800, 560]) {
      await page.setViewportSize({ width, height: 860 })
      const innerWidth = await dialog.locator('.settings-dialog-grid').evaluate((element) => {
        const css = getComputedStyle(element)
        return element.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight)
      })
      const content = await dialog.locator('.connectivity-dialog-content').boundingBox()
      const table = await dialog.locator('.connectivity-step-table').boundingBox()
      assert.ok(Math.abs(content.width - innerWidth) < 1, `Content should fill the dialog at ${width}px`)
      assert.ok(Math.abs(table.width - content.width) < 1, `Table should fill the content at ${width}px`)
      assert.equal(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth), true)
    }
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
    for (const width of [1280, 560]) {
      await page.setViewportSize({ width, height: 860 })
      const testButton = await page.getByRole('button', { name: 'Test connection', exact: true }).boundingBox()
      const lastButton = await page.getByRole('button', { name: 'Show last connection test' }).boundingBox()
      const gap = Math.max(lastButton.x - testButton.x - testButton.width, lastButton.y - testButton.y - testButton.height)
      assert.ok(gap >= 11.9, `Test actions should have at least 12px spacing at ${width}px`)
    }
    await page.getByRole('button', { name: 'Show last connection test' }).click()
    await dialog.waitFor()
    assert.equal(await dialog.locator('tbody tr').count(), result.steps.length)
  } finally {
    await page.close()
  }
})

test('configuration load rejection opens settings', async () => {
  const page = await openApp({ configError: true })
  try {
    await page.getByRole('dialog', { name: 'Settings' }).waitFor()
    assert.match(await page.locator('.toast').innerText(), /The Azure configuration could not be loaded/)
  } finally {
    await page.close()
  }
})

test('other startup failures do not prevent opening settings for missing configuration', async () => {
  const page = await openApp({ devicesError: true, configState: { exists: false, path: 'test-config', config: null } })
  try {
    await page.getByRole('dialog', { name: 'Settings' }).waitFor()
  } finally {
    await page.close()
  }
})

async function emitSegments(page, count = 2) {
  await page.waitForFunction(() => typeof window.emitSegment === 'function')
  await page.evaluate((length) => {
    for (let index = 0; index < length; index++) {
      window.emitSegment({ id: `console-${index}`, sessionId: 'console-session', source: index % 2 ? 'speaker' : 'mic',
        speaker: 'Guest-1', speakerIdentified: true, language: 'de-DE', timestampIso: new Date(2026, 10, 16, 14, 34, 42).toISOString(),
        text: `Transcript ${index}: discussion and next steps.`, state: 'final' })
    }
  }, count)
  await page.locator('.segment').nth(count - 1).waitFor()
}

test('Quit export includes late finals and aliases and reports write failure before allowing a retry', async () => {
  const page = await openApp({
    configState: { exists: true, path: 'test-config', config: validConfig },
    running: true,
    transcript: { markdownExport: { enabled: false } },
    deferTranscriptWrite: true
  })
  try {
    await emitSegments(page, 1)
    const tag = page.locator('.speaker-editor').first()
    await tag.locator('button').click()
    const input = tag.getByRole('textbox', { name: 'Speaker name', exact: true })
    await input.fill('Anita')
    await input.press('Enter')
    await page.evaluate(() => {
      window.emitSegment({ id: 'shutdown-final', sessionId: 'console-session', source: 'mic', speaker: 'Guest-1', speakerIdentified: true,
        timestampIso: '2026-11-16T14:34:45Z', text: 'Final words during shutdown.', state: 'final' })
      window.emitStatus({ running: false, paused: false })
      window.emitQuitExport('first')
    })
    await page.waitForFunction(() => window.transcriptWrites === 1)
    assert.match(await page.evaluate(() => window.lastSavedMarkdown), /Anita.*Final words during shutdown\./)
    assert.equal(await page.evaluate(() => window.quitExportReplies), undefined)
    await page.evaluate(() => window.completeTranscriptWrite('Folder is not writable'))
    await page.waitForFunction(() => window.quitExportReplies?.length === 1)
    assert.match(await page.evaluate(() => window.quitExportReplies[0].error), /Folder is not writable/)
    await page.getByText(/Final words during shutdown/).waitFor()
    await page.evaluate(() => window.emitQuitExport('retry'))
    await page.waitForFunction(() => window.transcriptWrites === 2)
    assert.equal(await page.evaluate(() => window.quitExportReplies.length), 1)
    await page.evaluate(() => window.completeTranscriptWrite())
    await page.waitForFunction(() => window.quitExportReplies?.length === 2)
    assert.deepEqual(await page.evaluate(() => window.quitExportReplies[1]), { requestId: 'retry', error: null })
  } finally { await page.close() }
})

test('Quit export reuses an in-flight automatic write and waits for it to finish', async () => {
  const page = await openApp({
    configState: { exists: true, path: 'test-config', config: validConfig },
    running: true,
    deferTranscriptWrite: true
  })
  try {
    await emitSegments(page, 1)
    await page.evaluate(() => window.emitStatus({ running: false, paused: false }))
    await page.waitForFunction(() => window.transcriptWrites === 1)
    await page.evaluate(() => {
      window.emitQuitExport('quit')
      window.emitQuitExport('quit')
    })
    await page.evaluate(() => window.completeTranscriptWrite())
    await page.waitForFunction(() => window.quitExportReplies?.length === 1)
    assert.deepEqual(await page.evaluate(() => ({ writes: window.transcriptWrites, replies: window.quitExportReplies })), {
      writes: 1, replies: [{ requestId: 'quit', error: null }]
    })
  } finally { await page.close() }
})

test('Quit export does not write a file for an interim-only session', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig }, running: true })
  try {
    await page.waitForFunction(() => typeof window.emitQuitExport === 'function')
    await page.evaluate(() => {
      window.emitSegment({ id: 'interim', sessionId: 'console-session', source: 'mic', speaker: 'Guest-1', speakerIdentified: true,
        timestampIso: '2026-11-16T14:34:45Z', text: 'Unconfirmed words.', state: 'interim' })
      window.emitStatus({ running: false, paused: false })
      window.emitQuitExport('empty')
    })
    await page.waitForFunction(() => window.quitExportReplies?.length === 1)
    assert.deepEqual(await page.evaluate(() => window.quitExportReplies[0]), { requestId: 'empty', error: null })
    assert.equal(await page.evaluate(() => window.transcriptWrites), undefined)
  } finally { await page.close() }
})

async function toggleDebug(page) {
  await page.locator('.overflow-menu > summary').click()
  await page.getByRole('button', { name: 'Debug log', exact: true }).click()
}

test('Console header stays compact, centered and stable across states and breakpoint boundaries', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await emitSegments(page)
    assert.equal(await page.locator('.console-header .wordmark').count(), 0)
    for (const width of [1280, 900, 801, 800, 501, 500, 390, 320]) {
      await page.setViewportSize({ width, height: 700 })
      assert.equal((await page.locator('.console-header').boundingBox()).height, 52)
      assert.equal((await page.locator('.container').boundingBox()).height, 700)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), true)
      const [buttons, center, utilities] = await Promise.all(['.recording-actions', '.status-center', '.utility-actions'].map((selector) => page.locator(selector).boundingBox()))
      assert.ok(buttons.x + buttons.width <= center.x && center.x + center.width <= utilities.x, `No header overlap at ${width}px`)
      const badge = await page.locator('.live-badge').boundingBox()
      assert.ok(Math.abs(badge.x + badge.width / 2 - center.x - center.width / 2) < 1)
      assert.equal(await page.getByRole('button', { name: 'Open settings dialog' }).innerText(), '')
      const firstColumn = await page.locator('.segment').first().evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ')[0])
      if (width > 500) assert.equal(firstColumn, '120px')
    }
    await page.setViewportSize({ width: 1280, height: 860 })
    const before = await page.locator('.recording-actions').boundingBox()
    await page.getByRole('button', { name: 'Start', exact: true }).click()
    await page.getByRole('button', { name: 'Pause', exact: true }).click()
    assert.deepEqual(await page.locator('.recording-actions').boundingBox(), before)
    await page.getByRole('button', { name: 'Resume', exact: true }).click()
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    assert.deepEqual(await page.locator('.recording-actions').boundingBox(), before)
    assert.match(await page.locator('.live-badge').innerText(), /^\d{2}:\d{2}$/)
  } finally { await page.close() }
})

test('inline speaker editing has no reflow, cancels with Escape, and updates mapping and Markdown', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await emitSegments(page)
    const tag = page.locator('.speaker-editor').first()
    const textBox = await page.locator('.segment-text').first().boundingBox()
    const tagBox = await tag.boundingBox()
    const palette = await tag.evaluate((element) => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }))
    await tag.locator('button').click()
    const input = tag.getByRole('textbox', { name: 'Speaker name', exact: true })
    assert.deepEqual(await input.boundingBox(), tagBox)
    assert.equal(await input.evaluate((element) => getComputedStyle(element).outlineStyle), 'none')
    await input.fill('Anna')
    assert.deepEqual(await page.locator('.segment-text').first().boundingBox(), textBox)
    await input.press('Escape')
    assert.equal(await tag.innerText(), 'Mic · Guest-1')
    await tag.locator('button').click()
    await input.fill('Anna')
    await input.press('Enter')
    await page.getByRole('button', { name: 'Speaker mapping show', exact: true }).click()
    const mapping = page.getByRole('textbox', { name: 'Display name for Mic · Guest-1', exact: true })
    assert.equal(await mapping.inputValue(), 'Anna')
    assert.deepEqual(await mapping.evaluate((element) => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color })), palette)
    await tag.locator('button').click()
    await input.fill('Anita')
    await mapping.click()
    assert.equal(await mapping.inputValue(), 'Anita')
    await page.locator('.overflow-menu > summary').click()
    await page.getByRole('button', { name: 'Export Markdown', exact: true }).click()
    await page.waitForFunction(() => window.lastSavedMarkdown?.includes('Anita'))
    assert.ok((await page.evaluate(() => window.lastSavedMarkdown)).includes('Speaker · Guest-1'))
    await page.getByRole('button', { name: 'Copy transcript', exact: true }).click()
    await page.waitForFunction(() => window.lastCopiedSegments?.[0].speaker === 'Anita')
  } finally { await page.close() }
})

test('a manual Markdown export shows its write error and can be retried', async () => {
  const page = await openApp({
    configState: { exists: true, path: 'test-config', config: validConfig },
    deferTranscriptWrite: true
  })
  try {
    await emitSegments(page)
    const exportMarkdown = async () => {
      await page.getByLabel('More actions', { exact: true }).click()
      await page.getByRole('button', { name: 'Export Markdown', exact: true }).click()
    }
    await exportMarkdown()
    await page.waitForFunction(() => window.transcriptWrites === 1)
    const writeError = 'The export folder is not writable.'
    await page.evaluate(error => window.completeTranscriptWrite(error), writeError)
    await page.getByText(writeError, { exact: true }).waitFor({ timeout: 3000 })
    assert.equal(await page.getByRole('alert').isVisible(), true)

    await exportMarkdown()
    await page.waitForFunction(() => window.transcriptWrites === 2)
    await page.evaluate(() => window.completeTranscriptWrite())
    await page.getByText(/^Transcript saved: /).waitFor()
  } finally { await page.close() }
})

test('idle audio settings stay centered in the available transcript area', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    const idle = page.locator('.idle-audio-panel')
    await idle.waitFor()
    for (const [width, height] of [[1280, 860], [950, 650], [390, 650], [950, 260]]) {
      await page.setViewportSize({ width, height })
      for (const withSpeakers of [false, true]) {
        if (withSpeakers) await page.getByRole('button', { name: 'Speaker mapping show', exact: true }).click()
        const area = await page.locator('.console-transcript').boundingBox()
        const controls = await page.getByRole('region', { name: 'Meeting controls' }).boundingBox()
        const availableTop = controls.y + controls.height
        const availableHeight = area.y + area.height - availableTop
        const panel = await idle.boundingBox()
        assert.ok(Math.abs(panel.x + panel.width / 2 - area.x - area.width / 2 - (width > 1100 ? 150 : 0)) < 1)
        assert.ok(Math.abs(panel.y + panel.height / 2 - availableTop - availableHeight / 2) < 1)
        assert.ok(panel.height <= availableHeight + 1)
        assert.equal(await idle.evaluate(element => element.scrollWidth <= element.clientWidth), true)
        if (withSpeakers) await page.getByRole('button', { name: 'Speaker mapping hide', exact: true }).click()
      }
    }
  } finally { await page.close() }
})

test('idle audio settings synchronize with dialog, persist, and reset is stopped-only', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await page.getByRole('heading', { name: 'Audio devices', exact: true }).waitFor()
    const idle = page.locator('.idle-audio-panel')
    assert.equal(await idle.locator('.panel-header').evaluate(element => getComputedStyle(element, '::after').content), 'none')
    assert.equal(await idle.getByRole('combobox').count(), 2)
    assert.equal(await idle.getByRole('combobox', { name: 'Primary language', exact: true }).count(), 0)
    assert.equal(await idle.getByRole('checkbox').count(), 2)
    assert.equal(await idle.getByLabel('Speicherpfad (optional)', { exact: true }).count(), 0)
    assert.equal(await idle.getByRole('button', { name: 'Save', exact: true }).count(), 0)
    assert.equal(await idle.getByText(/Änderungen gelten/).count(), 0)
    await idle.getByRole('checkbox', { name: 'Transcribe speaker loopback', exact: true }).uncheck()
    await page.waitForFunction(() => window.lastSavedSettings?.language === 'de-DE' && window.lastSavedSettings?.transcription.speaker === false)
    assert.equal(await page.evaluate(() => window.lastSavedConfig), undefined)
    await page.getByRole('button', { name: 'Open settings dialog' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
    assert.equal(await dialog.getByRole('combobox', { name: 'Primary language', exact: true }).inputValue(), 'de-DE')
    assert.equal(await dialog.getByRole('checkbox', { name: 'Speaker recognition', exact: true }).isChecked(), true)
    await dialog.getByRole('combobox', { name: 'Primary language', exact: true }).selectOption('fr-FR')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForFunction(() => window.lastSavedSettings?.language === 'fr-FR')
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await idle.getByRole('combobox', { name: 'Primary language', exact: true }).count(), 0)
    assert.equal(await idle.getByRole('checkbox', { name: 'Transcribe speaker loopback', exact: true }).isChecked(), false)
    await reopenSettings(page)
    assert.equal(await dialog.getByRole('combobox', { name: 'Primary language', exact: true }).inputValue(), 'fr-FR')
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: 'Clear transcript', exact: true }).isDisabled(), true)
    await page.getByRole('button', { name: 'Start', exact: true }).click()
    await emitSegments(page)
    assert.equal(await idle.count(), 0)
    await page.getByRole('button', { name: 'Pause', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: 'Clear transcript', exact: true }).isDisabled(), true)
    assert.equal(await idle.count(), 0)
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    assert.equal(await idle.count(), 0)
    page.once('dialog', (confirmation) => confirmation.accept())
    await page.getByRole('button', { name: 'Clear transcript', exact: true }).click()
    await idle.waitFor()
    assert.equal(await page.locator('.segment').count(), 0)
    assert.equal(await page.locator('.live-badge time').innerText(), '00:00')
  } finally { await page.close() }
})

test('a delayed Clear response cannot erase a newer session even after it stops', async () => {
  const page = await openApp({
    configState: { exists: true, path: 'test-config', config: validConfig },
    deferReset: true,
    transcript: { markdownExport: { enabled: false } }
  })
  try {
    const start = page.getByRole('button', { name: 'Start', exact: true })
    const stop = page.getByRole('button', { name: 'Stop', exact: true })
    const clear = page.getByRole('button', { name: 'Clear transcript', exact: true })
    await start.click()
    await emitSegments(page)
    await stop.click()
    page.once('dialog', confirmation => confirmation.accept())
    await clear.click()
    await page.waitForFunction(() => typeof window.completeReset === 'function')

    await start.click()
    const text = 'Final segment of the newer session.'
    await page.evaluate(value => window.emitSegment({ id: 'new-final', sessionId: 'new-session', source: 'mic',
      speaker: 'Guest-1', speakerIdentified: true, language: 'de-DE', timestampIso: new Date().toISOString(), text: value, state: 'final' }), text)
    await page.getByText(text, { exact: true }).waitFor()
    assert.deepEqual(await page.locator('.segment-text').allTextContents(), [text])
    await page.getByRole('button', { name: 'Speaker mapping show', exact: true }).click()
    await page.getByRole('textbox', { name: 'Display name for Mic · Guest-1', exact: true }).fill('Anna')
    await stop.click()
    await start.waitFor()

    await page.evaluate(async () => {
      window.completeReset()
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })
    assert.deepEqual(await page.locator('.segment-text').allTextContents(), [text])
    assert.deepEqual(await page.locator('.speaker-badge').allTextContents(), ['Anna'])
    assert.equal(await clear.isEnabled(), true)
  } finally { await page.close() }
})

test('Debug dock starts hidden, opens upward within half the workspace, and clears without collapsing', async () => {
  const logs = Array.from({ length: 70 }, (_, index) => ({ id: `log-${index}`, timestampIso: new Date().toISOString(), source: 'ipc',
    level: index < 2 ? 'error' : 'info', message: `Log ${index}: Status and details` }))
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig }, debugLog: logs })
  try {
    await emitSegments(page)
    assert.equal(await page.locator('.console-debug').count(), 0)
    await toggleDebug(page)
    await page.locator('.debug-log-entry').nth(69).waitFor()
    assert.equal(await page.locator('.debug-summary .count-pill').innerText(), '2 errors')
    assert.equal(await page.locator('.console-debug.has-errors').count(), 1)
    const colors = await page.locator('.debug-log-message').evaluateAll(elements => elements.map(element => getComputedStyle(element).color))
    assert.notEqual(colors[0], colors[2])
    await page.evaluate(() => window.emitDebugLog({ id: 'new-info', timestampIso: new Date().toISOString(), source: 'ipc', level: 'info', message: 'Normal entry' }))
    await page.getByText('Normal entry', { exact: true }).waitFor()
    assert.equal(await page.getByText('Normal entry', { exact: true }).evaluate(element => getComputedStyle(element).color), colors[2])
    for (const height of [860, 420]) {
      await page.setViewportSize({ width: 800, height })
      const workspace = await page.locator('.console-grid').boundingBox()
      const content = await page.locator('.debug-content').boundingBox()
      const footer = await page.locator('.debug-summary').boundingBox()
      assert.ok(content.height <= workspace.height / 2 + .5)
      assert.ok(content.y >= workspace.y)
      assert.ok(Math.abs(content.y + content.height - footer.y) <= 1)
      assert.equal(footer.y + footer.height, height)
    }
    const copy = page.getByRole('button', { name: 'Copy log', exact: true })
    const clear = page.getByRole('button', { name: 'Clear log', exact: true })
    assert.ok((await copy.boundingBox()).x < (await clear.boundingBox()).x)
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async (text) => { window.copiedLog = text }
      } })
    })
    const rows = await page.locator('.debug-log-table tr').evaluateAll(elements =>
      elements.map(row => Array.from(row.cells, cell => cell.textContent).join('\t')))
    await copy.click()
    assert.equal(await page.evaluate(() => window.copiedLog), rows.join('\n'))
    await clear.click()
    await page.waitForFunction(() => !!window.lastClearLogCalled)
    await page.locator('.debug-content .empty').waitFor()
    assert.equal(await copy.isDisabled(), true)
    assert.equal(await page.locator('.debug-summary .count-pill').innerText(), '0 errors')
    await page.getByRole('button', { name: 'Close debug log', exact: true }).click()
    await toggleDebug(page)
    assert.equal(await page.locator('.console-debug').count(), 0)
    await toggleDebug(page)
    assert.equal(await page.locator('.debug-content').count(), 0)
    await page.getByRole('button', { name: 'Open debug log', exact: true }).click()
    await page.evaluate(() => window.emitDebugLog({ id: 'new-error', timestampIso: new Date().toISOString(), source: 'sidecar', level: 'error', message: 'Error message' }))
    await page.waitForFunction(() => document.querySelector('.debug-summary .count-pill')?.textContent === '1 error')
    assert.equal(await page.locator('.debug-log-entry.error').innerText().then((value) => value.includes('Error message')), true)
  } finally { await page.close() }
})

test('Follow appears only after manual scrolling and resumes automatic following', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await page.setViewportSize({ width: 800, height: 420 })
    await emitSegments(page, 80)
    const list = page.locator('.transcript-list')
    await page.waitForFunction(() => { const list = document.querySelector('.transcript-list'); return list.scrollHeight - list.scrollTop - list.clientHeight <= 1 })
    assert.equal(await page.getByRole('button', { name: 'Follow', exact: true }).count(), 0)
    await list.evaluate((element) => { element.scrollTop = 100 })
    await page.getByRole('button', { name: 'Follow', exact: true }).waitFor()
    const scrollTop = await list.evaluate((element) => element.scrollTop)
    await page.evaluate(() => window.emitSegment({ id: 'after-scroll', sessionId: 'console-session', source: 'mic', speaker: 'Guest-2', speakerIdentified: true, text: 'New entry', state: 'final', timestampIso: new Date().toISOString() }))
    await page.locator('.segment').nth(80).waitFor()
    assert.equal(await list.evaluate((element) => element.scrollTop), scrollTop)
    await page.getByRole('button', { name: 'Follow', exact: true }).click()
    await page.waitForFunction(() => { const list = document.querySelector('.transcript-list'); return list.scrollHeight - list.scrollTop - list.clientHeight <= 1 })
    assert.equal(await page.getByRole('button', { name: 'Follow', exact: true }).count(), 0)
  } finally { await page.close() }
})

test('recording timer excludes pauses, freezes after stop and resets on a new start', async () => {
  const page = await openApp({
    configState: { exists: true, path: 'test-config', config: validConfig },
    running: true,
    startedAt: new Date(Date.now() - 60000).toISOString(),
    transcript: { markdownExport: { enabled: false } }
  })
  try {
    await page.getByRole('button', { name: 'Stop', exact: true }).waitFor()
    assert.match(await page.locator('.live-badge time').innerText(), /^01:\d{2}$/)
    await page.getByRole('button', { name: 'Pause', exact: true }).click()
    const paused = await page.locator('.live-badge time').innerText()
    await page.waitForTimeout(2100)
    assert.equal(await page.locator('.live-badge time').innerText(), paused)
    await page.getByRole('button', { name: 'Resume', exact: true }).click()
    await page.waitForTimeout(1100)
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    const stopped = await page.locator('.live-badge time').innerText()
    await page.waitForTimeout(1100)
    await emitSegments(page)
    assert.equal(await page.locator('.live-badge time').innerText(), stopped)
    await page.getByRole('button', { name: 'Start', exact: true }).click()
    assert.equal(await page.locator('.live-badge time').innerText(), '00:00')
  } finally { await page.close() }
})

test('settings without navigation preserve input focus, scroll and trap focus', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await page.getByRole('button', { name: 'Open settings dialog' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
    assert.equal(await dialog.getByRole('navigation').count(), 0)
    await page.waitForFunction(() => document.activeElement?.classList.contains('settings-save-button'))
    const endpoint = dialog.getByRole('textbox', { name: 'Endpoint', exact: true })
    await endpoint.fill('https://changed.test')
    assert.equal(await endpoint.evaluate((element) => element === document.activeElement), true)
    const before = await dialog.boundingBox()
    await dialog.getByRole('heading', { name: 'Proxy', exact: true }).scrollIntoViewIfNeeded()
    assert.deepEqual(await dialog.boundingBox(), before)
    await dialog.getByRole('button', { name: 'Save', exact: true }).focus()
    await page.keyboard.press('Tab')
    assert.equal(await dialog.getByRole('button', { name: 'Close dialog', exact: true }).evaluate((element) => element === document.activeElement), true)
    await page.keyboard.press('Shift+Tab')
    assert.equal(await dialog.getByRole('button', { name: 'Save', exact: true }).evaluate((element) => element === document.activeElement), true)
    page.once('dialog', confirmation => confirmation.accept())
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('dialog').count(), 0)
    await page.getByRole('button', { name: 'Open settings dialog' }).click()
    assert.equal(await page.getByRole('textbox', { name: 'Endpoint', exact: true }).inputValue(), validConfig.endpoint)
  } finally { await page.close() }
})

test('failed Stop shows the Rust string error after the stopped status and preserves the transcript', async () => {
  const stopError = 'The transcription service did not finish stopping within 15 seconds.'
  const page = await openApp({
    configState: { exists: true, path: 'test-config', config: validConfig },
    running: true,
    stopError,
    deferTranscriptWrite: true
  })
  try {
    await emitSegments(page)
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    const errorToast = page.getByText(`UI_STOP_FAILED: ${stopError}`, { exact: true })
    await errorToast.waitFor({ timeout: 3000 })
    await page.waitForFunction(() => window.transcriptWrites === 1)
    await page.evaluate(async () => {
      window.completeTranscriptWrite()
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })
    assert.equal(await errorToast.isVisible(), true)
    assert.equal(await page.getByRole('button', { name: 'Start', exact: true }).isEnabled(), true)
    assert.equal(await page.getByRole('button', { name: 'Clear transcript', exact: true }).isEnabled(), true)
    assert.equal(await page.locator('.segment').count(), 2)
  } finally { await page.close() }
})

test('a crashed sidecar surfaces a persistent error toast and allows a new recording', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig }, running: true })
  try {
    await page.getByRole('button', { name: 'Stop', exact: true }).waitFor()
    await emitSegments(page)
    assert.equal(await page.locator('.toast').count(), 0)

    await page.evaluate(() => window.emitCrashed({ exitCode: 1, lastError: 'Azure start failed' }))
    const toast = page.locator('.toast')
    await toast.waitFor()
    assert.match(await toast.innerText(), /Sidecar crashed/)
    assert.match(await toast.innerText(), /exit code 1/)
    assert.equal(await toast.getAttribute('role'), 'alert')
    await page.evaluate(() => window.emitStatus({ running: false, paused: false }))
    await page.waitForTimeout(150)
    assert.equal(await page.locator('.toast').count(), 1)
    assert.match(await toast.innerText(), /Sidecar crashed/)
    assert.equal(await page.getByRole('button', { name: 'Start', exact: true }).isDisabled(), false)
    assert.equal(await page.getByRole('button', { name: 'Pause', exact: true }).isDisabled(), true)
    assert.equal(await page.locator('.segment').count(), 2)
    await page.getByRole('button', { name: 'Start', exact: true }).click()
    await page.getByRole('button', { name: 'Stop', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.lastStartCalled), true)
    assert.equal(await page.locator('.segment').count(), 0)
    assert.equal(await page.locator('.toast-error').count(), 0)
  } finally {
    await page.close()
  }
})
