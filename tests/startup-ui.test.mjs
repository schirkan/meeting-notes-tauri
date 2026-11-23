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
    const noSubscription = () => () => {}
    let currentStatus = { running: input.running ?? false, paused: false }
    window.settingsSaveError = input.saveSettingsError
    window.directoryPickerResult = input.directoryPickerResult ?? null
    window.transcriptApi = {
      toggleDevtools: async () => {
        if (input.devtoolsError) throw new Error(input.devtoolsError)
        window.devtoolsToggleCalls = (window.devtoolsToggleCalls ?? 0) + 1
      },
      openRepository: async () => { window.repositoryOpened = true },
      getStatus: async () => currentStatus,
      start: async () => { window.lastStartCalled = true; return currentStatus = { running: true, startedAt: new Date().toISOString() } },
      stop: async () => {
        window.lastStopCalled = true
        if (input.stopError) throw new Error(input.stopError)
        return currentStatus = { ...currentStatus, running: false, paused: false }
      },
      pause: async () => { window.lastPauseCalled = true; return currentStatus = { ...currentStatus, running: true, paused: true } },
      resume: async () => { window.lastResumeCalled = true; return currentStatus = { ...currentStatus, running: true, paused: false } },
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
      saveTranscriptMarkdown: async (markdown) => {
        window.lastSavedMarkdown = markdown
        return 'D:/Notes/transcript-2026-11-11-22-05-00.md'
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
      copyTranscript: async (segments) => { window.lastCopiedSegments = segments },
      onSegment: (callback) => {
        window.emitSegment = callback
        return () => { delete window.emitSegment }
      },
      onError: noSubscription,
      onStatus: (callback) => { window.emitStatus = (value) => { currentStatus = value; callback(value) }; return () => { delete window.emitStatus } },
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
    await page.waitForFunction(() => document.activeElement?.classList.contains('settings-save-button'))
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
    await page.getByRole('checkbox', { name: 'Speaker recognition for microphone', exact: true }).uncheck()
    await page.waitForFunction(() => window.lastSavedSettings?.diarization.mic === false)
    assert.equal(await page.evaluate(() => window.lastSavedSettings.language), 'de-DE')
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
    await dialog.getByLabel('Use proxy').check()
    await dialog.getByLabel('Proxy Host', { exact: true }).fill('draft.proxy')
    await dialog.getByLabel('Proxy Port', { exact: true }).fill('8080')
    await dialog.getByRole('button', { name: 'Test connection', exact: true }).click()
    const diagnostic = page.getByRole('dialog', { name: 'Connection test', exact: true })
    await diagnostic.waitFor()
    assert.equal(await page.evaluate(() => window.lastConnectivityPayload.language), 'en-US')
    assert.equal(await page.evaluate(() => window.lastConnectivityPayload.proxy.host), 'draft.proxy')
    assert.equal(await page.evaluate(() => window.lastSavedSettings), undefined)
    assert.equal(await page.evaluate(() => window.lastSavedConfig), undefined)
    await diagnostic.getByRole('button', { name: 'Close dialog', exact: true }).click()
    assert.equal(await dialog.getByLabel('Proxy Host', { exact: true }).inputValue(), 'draft.proxy')
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
    assert.equal(await dialog.getByRole('button').count(), 1)
    await page.waitForFunction(() => document.activeElement?.classList.contains('settings-dialog-close'))
    assert.equal(await dialog.getByRole('heading', { name: 'Meeting Notes', exact: true }).count(), 1)
    assert.equal(await dialog.getByText(`Version: ${packageJson.version}`, { exact: true }).isVisible(), true)
    assert.match(await dialog.innerText(), /Martin Pietschmann/)
    assert.match(await dialog.innerText(), /License: MIT/)
    const [icon, details] = await Promise.all([dialog.getByRole('img').boundingBox(), dialog.locator('.about-details').boundingBox()])
    assert.ok(icon.width >= 96 && icon.x + icon.width < details.x)
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

test('settings shows all sections without navigation and preserves two-column layout, save and test payloads', async () => {
  const page = await openApp({
    configState: { exists: true, path: 'test-config', config: validConfig },
    connectivityError: 'Local diagnostic test'
  })
  try {
    await page.getByRole('button', { name: 'Open settings dialog' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
    const panels = dialog.locator('.panel')
    assert.deepEqual(await panels.locator('h2').allTextContents(), ['General', 'Transcription', 'Azure', 'Proxy'])
    const azure = panels.nth(2)
    const proxy = panels.nth(3)
    // Alle Abschnitte stehen gleichzeitig auf einer Seite.
    assert.equal(await dialog.getByRole('navigation').count(), 0)
    assert.equal(await dialog.getByRole('tab').count(), 0)
    assert.equal(await dialog.getByRole('combobox', { name: 'Microphone', exact: true }).count(), 0)
    await azure.getByRole('heading', { name: 'Azure', exact: true }).scrollIntoViewIfNeeded()
    assert.equal(await azure.getByLabel('Use proxy').count(), 0)
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
    assert.equal(endpointBox.y, regionBox.y)
    assert.ok(endpointBox.x + endpointBox.width <= regionBox.x)
    const general = panels.nth(1)
    assert.equal(await panels.nth(0).getByRole('checkbox').count(), 1)
    const languageField = general.locator('.language-field')
    const [caption, languageBox] = await Promise.all([
      languageField.locator('.field-caption').boundingBox(), languageField.getByRole('combobox').boundingBox()
    ])
    assert.ok(caption.x + caption.width <= languageBox.x)
    assert.ok(Math.abs(caption.y + caption.height / 2 - languageBox.y - languageBox.height / 2) < 1)
    for (const [left, right] of [
      [general.getByRole('checkbox', { name: 'Start recording automatically', exact: true }).locator('..'), general.getByRole('checkbox', { name: 'Stop recording automatically', exact: true }).locator('..')],
      [general.getByRole('checkbox', { name: 'Save transcript automatically', exact: true }).locator('..'), general.locator('.directory-control')]
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
    assert.deepEqual(gaps, Array(4).fill(['17px', '17px']))
    for (const checkbox of await dialog.getByRole('checkbox').all()) {
      const box = await checkbox.boundingBox()
      assert.equal(box.width, 14)
      assert.equal(box.height, 14)
    }
    const exportControl = general.locator('.directory-control')
    assert.equal(await exportControl.locator('label').count(), 0)
    const toggleBox = await general.getByRole('checkbox', { name: 'Save transcript automatically', exact: true }).boundingBox()
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
    assert.equal(await panels.count(), 4)
    assert.equal(await proxy.locator('.settings-inline-hint').count(), 0)
    assert.equal(await proxy.getByLabel('Proxy Host', { exact: true }).isDisabled(), true)
    await proxy.getByLabel('Use proxy').check()
    await proxy.getByLabel('Proxy Host', { exact: true }).fill('proxy.test')
    await proxy.getByLabel('Proxy Port', { exact: true }).fill('8080')
    await proxy.getByLabel('Proxy username (optional)', { exact: true }).fill('test-user')
    await proxy.getByLabel('Proxy password (optional)', { exact: true }).fill('test-password')
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
      for (const section of ['General', 'Transcription', 'Azure', 'Proxy']) {
        await dialog.getByRole('heading', { name: section, exact: true }).scrollIntoViewIfNeeded()
        assert.deepEqual(await dialog.boundingBox(), before)
        assert.equal(await panels.count(), 4)
      }
      const [host, port, username, password] = await Promise.all([
        'Proxy Host', 'Proxy Port', 'Proxy username (optional)', 'Proxy password (optional)'
      ].map(name => proxy.getByLabel(name, { exact: true }).boundingBox()))
      if (width > 500) {
        assert.equal(host.y, port.y)
        assert.equal(username.y, password.y)
        assert.ok(host.x + host.width <= port.x)
      } else {
        assert.ok(port.y > host.y + host.height)
        assert.ok(password.y > username.y + username.height)
      }
      assert.ok(username.y > host.y + host.height)
      assert.equal(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth), true)
      assert.equal(await footer.evaluate((element) => element.scrollWidth <= element.clientWidth), true)
    }
    await footer.getByRole('button', { name: 'Test connection', exact: true }).click()
    await page.getByRole('dialog', { name: 'Connection test', exact: true }).locator('tbody tr').waitFor()
    assert.deepEqual(await page.evaluate(() => window.lastConnectivityPayload), { ...validConfig, proxy: proxyConfig, language: 'de-DE' })
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
    assert.equal(await dialog.locator('.settings-dialog-grid').getByText('Changes apply to the next recording after saving.', { exact: true }).count(), 0)
    const hint = footer.getByText('Changes apply to the next recording after saving.', { exact: true })
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
    await idle.getByRole('checkbox', { name: 'Speaker recognition for microphone', exact: true }).uncheck()
    await idle.getByRole('combobox', { name: 'Microphone', exact: true }).selectOption('mic-one')
    await idle.getByRole('checkbox', { name: 'Transcribe speaker loopback', exact: true }).uncheck()
    assert.equal(await page.getByRole('button', { name: 'Start', exact: true }).isDisabled(), true)
    assert.equal(await page.evaluate(() => window.settingsSaveCalls.length), 1)
    for (let count = 1; count <= 3; count++) {
      await page.evaluate(() => window.pendingSettingsSaves.shift()())
      if (count < 3) {
        await page.waitForFunction(value => window.settingsSaveCalls.length === value, count + 1)
        assert.equal(await idle.getByRole('combobox', { name: 'Microphone', exact: true }).inputValue(), 'mic-one')
        assert.equal(await idle.getByRole('checkbox', { name: 'Transcribe speaker loopback', exact: true }).isChecked(), false)
      }
    }
    await page.waitForFunction(() => window.lastSavedSettings?.devices.micId === 'mic-one' && window.lastSavedSettings.transcription.speaker === false)
    assert.equal(await page.evaluate(() => window.lastSavedSettings.language), 'de-DE')
    assert.equal(await page.evaluate(() => window.lastSavedSettings.diarization.mic), false)
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
    await idle.getByRole('checkbox', { name: 'Speaker recognition for speaker loopback', exact: true }).uncheck()
    await page.getByRole('alert').waitFor()
    assert.match(await page.getByRole('alert').innerText(), /read-only/)
    assert.equal(await page.getByRole('button', { name: 'Start', exact: true }).isDisabled(), true)
    await page.evaluate(() => { window.settingsSaveError = null })
    await idle.getByRole('checkbox', { name: 'Speaker recognition for microphone', exact: true }).uncheck()
    await page.waitForFunction(() => window.lastSavedSettings?.language === 'de-DE' && window.lastSavedSettings.diarization.mic === false && window.lastSavedSettings.diarization.speaker === false)
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

test('language dropdown remains disabled during recording', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig }, running: true })
  try {
    await page.getByRole('button', { name: 'Open settings dialog' }).click()
    assert.equal(await page.getByRole('combobox', { name: 'Primary language', exact: true }).isDisabled(), true)
    assert.equal(await page.getByRole('checkbox', { name: 'Speaker recognition for microphone', exact: true }).count(), 0)
    assert.equal(await page.getByRole('checkbox', { name: 'Speaker recognition for speaker loopback', exact: true }).count(), 0)
  } finally {
    await page.close()
  }
})

test('diarization settings default on and independently save all source combinations', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    const mic = page.getByRole('checkbox', { name: 'Speaker recognition for microphone', exact: true })
    const speaker = page.getByRole('checkbox', { name: 'Speaker recognition for speaker loopback', exact: true })
    assert.equal(await mic.isChecked(), true)
    assert.equal(await speaker.isChecked(), true)
    for (const settings of [{ mic: false, speaker: true }, { mic: true, speaker: false }, { mic: false, speaker: false }, { mic: true, speaker: true }]) {
      await mic.setChecked(settings.mic)
      await speaker.setChecked(settings.speaker)
      await page.waitForFunction((value) => window.lastSavedSettings?.diarization.mic === value.mic && window.lastSavedSettings?.diarization.speaker === value.speaker, settings)
      assert.equal(await mic.isChecked(), settings.mic)
      assert.equal(await speaker.isChecked(), settings.speaker)
    }
    assert.equal(await mic.isChecked(), true)
    assert.equal(await speaker.isChecked(), true)
  } finally {
    await page.close()
  }
})

  test('microphone transcription toggles independently in the idle panel', async () => {
    const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
    try {
      const panel = page.locator('.idle-audio-panel')
      const mic = panel.getByRole('checkbox', { name: 'Transcribe microphone', exact: true })
      const speaker = panel.getByRole('checkbox', { name: 'Transcribe speaker loopback', exact: true })
      for (const width of [950, 390]) {
        await page.setViewportSize({ width, height: 650 })
        for (const [checkbox, device] of [[mic, 'Microphone'], [speaker, 'Speaker Loopback']]) {
          const toggleBox = await checkbox.boundingBox()
          const deviceBox = await panel.getByRole('combobox', { name: device, exact: true }).boundingBox()
          assert.ok(toggleBox.x + toggleBox.width <= deviceBox.x)
          assert.ok(Math.abs(toggleBox.y + toggleBox.height / 2 - deviceBox.y - deviceBox.height / 2) < 1)
          assert.equal(await panel.getByText(await checkbox.getAttribute('aria-label'), { exact: true }).count(), 0)
          const diarization = await panel.getByRole('checkbox', {
            name: device === 'Microphone' ? 'Speaker recognition for microphone' : 'Speaker recognition for speaker loopback', exact: true
          }).boundingBox()
          assert.ok(diarization.x >= deviceBox.x + deviceBox.width)
          assert.ok(Math.abs(diarization.y + diarization.height / 2 - deviceBox.y - deviceBox.height / 2) < 1)
          const row = panel.locator('.audio-source-row').nth(device === 'Microphone' ? 0 : 1)
          const [deviceColumn, diarizationColumn] = await Promise.all([
            row.locator('.audio-source-field').boundingBox(), row.locator('.source-diarization').boundingBox()
          ])
          assert.ok(Math.abs(deviceColumn.width - diarizationColumn.width) < 1)
          assert.ok(Math.abs(diarizationColumn.x - deviceColumn.x - deviceColumn.width - 17) < 1)
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
    assert.equal(await page.getByRole('checkbox', { name: 'Speaker recognition for speaker loopback', exact: true }).isDisabled(), true)
    assert.equal(await page.getByRole('checkbox', { name: 'Speaker recognition for microphone', exact: true }).isDisabled(), false)
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

test('automatic recording default on and explicitly disabled preferences are shown correctly', async () => {
  for (const explicitFalse of [false, true]) {
    const page = await openApp({
      configState: { exists: true, path: 'test-config', config: validConfig },
      autoStart: explicitFalse ? { enabled: false, processes: [] } : undefined,
      windowSettings: explicitFalse ? { minimizeToTrayOnClose: false } : undefined
    })
    try {
      await page.getByRole('button', { name: 'Open settings dialog' }).click()
      assert.equal(await page.getByRole('checkbox', { name: 'Start recording automatically', exact: true }).isChecked(), !explicitFalse)
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
    // Die Diarization-Schalter stehen seit dem Dialog-Umbau nur auf der Startseite.
    const idle = page.locator('.idle-audio-panel')
    await idle.waitFor()
    assert.equal(await idle.getByRole('checkbox', { name: 'Speaker recognition for microphone', exact: true }).isChecked(), false)
    assert.equal(await idle.getByRole('checkbox', { name: 'Speaker recognition for speaker loopback', exact: true }).isChecked(), false)
  } finally {
    await page.close()
  }
})

test('Mic speakers get independent badges, aliases, interim handling and export labels', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await page.waitForFunction(() => typeof window.emitSegment === 'function')
    const events = [
      { source: 'mic', speaker: 'Guest-1', text: 'Mic first voice.', state: 'final' },
      { source: 'mic', speaker: 'Guest-2', text: 'Mic second voice.', state: 'final' },
      { source: 'speaker', speaker: 'Guest-1', text: 'Speaker first voice.', state: 'final' },
      { source: 'mic', speaker: 'unknown', text: 'Provisionally unknown.', state: 'interim' },
      { source: 'mic', speaker: 'Guest-1', text: 'Provisionally the first voice.', state: 'interim' },
      { source: 'mic', speaker: 'Guest-2', text: 'Mic corrected second voice.', state: 'final' }
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

test('pause and resume keep the session running and report the paused state', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig }, running: true })
  try {
    await page.locator('.hero-controls').waitFor()
    assert.match(await page.locator('.live-badge').getAttribute('aria-label'), /Running/)
    await page.getByRole('button', { name: /Pause/ }).click()
    await page.waitForFunction(() => !!window.lastPauseCalled)
    await page.waitForFunction(() => document.querySelector('.live-badge')?.classList.contains('paused'))
    assert.match(await page.locator('.live-badge').getAttribute('aria-label'), /Paused/)
    assert.match(await page.locator('.live-badge').getAttribute('title'), /session stays active/)
    await page.getByRole('button', { name: /Resume/ }).click()
    await page.waitForFunction(() => !!window.lastResumeCalled)
    await page.waitForFunction(() => !document.querySelector('.live-badge')?.classList.contains('paused'))
    assert.match(await page.locator('.live-badge').getAttribute('aria-label'), /Running/)
  } finally {
    await page.close()
  }
})

test('the same SDK id in two sessions stays two separate speakers with separate aliases', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await page.waitForFunction(() => typeof window.emitSegment === 'function')
    const events = [
      { source: 'mic', speaker: 'Guest-1', sessionId: 's1', text: 'First session.', state: 'final' },
      { source: 'mic', speaker: 'Guest-1', sessionId: 's2', text: 'Second session.', state: 'final' }
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
        speaker: 'Guest-1', language: 'de-DE', timestampIso: new Date(2026, 10, 16, 14, 34, 42).toISOString(),
        text: `Transcript ${index}: discussion and next steps.`, state: 'final' })
    }
  }, count)
  await page.locator('.segment').nth(count - 1).waitFor()
}

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
        const panel = await idle.boundingBox()
        assert.ok(Math.abs(panel.x + panel.width / 2 - area.x - area.width / 2 - (width > 1100 ? 150 : 0)) < 1)
        assert.ok(Math.abs(panel.y + panel.height / 2 - area.y - area.height / 2) < 1)
        assert.ok(panel.height <= area.height + 1)
        assert.equal(await idle.evaluate(element => element.scrollWidth <= element.clientWidth), true)
        if (withSpeakers) await page.getByRole('button', { name: 'Speaker mapping hide', exact: true }).click()
      }
    }
  } finally { await page.close() }
})

test('idle audio settings synchronize with dialog, persist, and reset is stopped-only', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await page.getByRole('heading', { name: 'Audio settings', exact: true }).waitFor()
    const idle = page.locator('.idle-audio-panel')
    assert.equal(await idle.locator('.panel-header').evaluate(element => getComputedStyle(element, '::after').content), 'none')
    assert.equal(await idle.getByRole('combobox').count(), 2)
    assert.equal(await idle.getByRole('combobox', { name: 'Primary language', exact: true }).count(), 0)
    assert.equal(await idle.getByRole('checkbox').count(), 4)
    assert.equal(await idle.getByLabel('Speicherpfad (optional)', { exact: true }).count(), 0)
    assert.equal(await idle.getByRole('button', { name: 'Save', exact: true }).count(), 0)
    assert.equal(await idle.getByText(/Änderungen gelten/).count(), 0)
    await idle.getByRole('checkbox', { name: 'Speaker recognition for speaker loopback', exact: true }).uncheck()
    await page.waitForFunction(() => window.lastSavedSettings?.language === 'de-DE' && window.lastSavedSettings?.diarization.speaker === false)
    assert.equal(await page.evaluate(() => window.lastSavedConfig), undefined)
    await page.getByRole('button', { name: 'Open settings dialog' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
    assert.equal(await dialog.getByRole('combobox', { name: 'Primary language', exact: true }).inputValue(), 'de-DE')
    assert.equal(await dialog.getByRole('checkbox', { name: 'Speaker recognition for speaker loopback', exact: true }).count(), 0)
    await dialog.getByRole('combobox', { name: 'Primary language', exact: true }).selectOption('fr-FR')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForFunction(() => window.lastSavedSettings?.language === 'fr-FR')
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await idle.getByRole('combobox', { name: 'Primary language', exact: true }).count(), 0)
    assert.equal(await idle.getByRole('checkbox', { name: 'Speaker recognition for speaker loopback', exact: true }).isChecked(), false)
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
    await page.getByRole('button', { name: 'Clear log', exact: true }).click()
    await page.waitForFunction(() => !!window.lastClearLogCalled)
    await page.locator('.debug-content .empty').waitFor()
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
    await page.evaluate(() => window.emitSegment({ id: 'after-scroll', sessionId: 'console-session', source: 'mic', speaker: 'Guest-2', text: 'New entry', state: 'final', timestampIso: new Date().toISOString() }))
    await page.locator('.segment').nth(80).waitFor()
    assert.equal(await list.evaluate((element) => element.scrollTop), scrollTop)
    await page.getByRole('button', { name: 'Follow', exact: true }).click()
    await page.waitForFunction(() => { const list = document.querySelector('.transcript-list'); return list.scrollHeight - list.scrollTop - list.clientHeight <= 1 })
    assert.equal(await page.getByRole('button', { name: 'Follow', exact: true }).count(), 0)
  } finally { await page.close() }
})

test('recording timer excludes pauses, freezes after stop and resets on a new start', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig }, transcript: { markdownExport: { enabled: false } } })
  try {
    await page.getByRole('button', { name: 'Start', exact: true }).click()
    await page.evaluate(() => window.emitStatus({ running: true, startedAt: new Date(Date.now() - 60000).toISOString() }))
    await page.waitForFunction(() => document.querySelector('.live-badge time')?.textContent === '01:00')
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

test('failed Stop surfaces details and leaves recording and reset protection intact', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig }, running: true, stopError: 'Sidecar does not respond' })
  try {
    await emitSegments(page)
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await page.locator('.toast-error').waitFor()
    assert.match(await page.locator('.toast-error').innerText(), /UI_STOP_FAILED: Sidecar does not respond/)
    assert.equal(await page.getByRole('button', { name: 'Clear transcript', exact: true }).isDisabled(), true)
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
