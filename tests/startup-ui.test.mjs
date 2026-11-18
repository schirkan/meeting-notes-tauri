import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from 'playwright'

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
      getStatus: async () => currentStatus,
      start: async () => { window.lastStartCalled = true; return currentStatus = { running: true, startedAt: new Date().toISOString() } },
      stop: async () => {
        window.lastStopCalled = true
        if (input.stopError) throw new Error(input.stopError)
        return currentStatus = { ...currentStatus, running: false, paused: false }
      },
      pause: async () => { window.lastPauseCalled = true; return currentStatus = { ...currentStatus, running: true, paused: true } },
      resume: async () => { window.lastResumeCalled = true; return currentStatus = { ...currentStatus, running: true, paused: false } },
        getSettings: async () => ({
          language: input.language ?? 'de-DE',
          devices: {},
          transcription: input.transcription,
          diarization: input.diarization,
          transcript: input.transcript,
          autoStart: input.autoStart ?? { enabled: false, processes: [] },
          window: input.windowSettings
        }),
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
        if (input.devicesError) throw new Error('Gerätetest fehlgeschlagen')
        return { inputs: input.inputs ?? [], outputs: input.outputs ?? [], fetchedAtIso: new Date(0).toISOString() }
      },
      getDebugLog: async () => input.debugLog ?? [],
      clearDebugLog: async () => { window.lastClearLogCalled = true; return { cleared: input.debugLog?.length ?? 0 } },
      getConfig: async () => {
        if (input.configError) throw new Error('Konfiguration nicht lesbar')
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
  await page.getByRole('dialog', { name: 'Einstellungen', exact: true }).waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'Einstellungsdialog öffnen' }).click()
}

for (const [name, configState] of [
  ['missing configuration', { exists: false, path: 'test-config', config: null }],
  ['unreadable configuration', { exists: true, path: 'test-config', config: null }],
  ['incomplete configuration', { exists: true, path: 'test-config', config: { ...validConfig, speechKey: ' ' } }],
  ['invalid proxy configuration', { exists: true, path: 'test-config', config: { ...validConfig, proxy: { host: 'proxy.test', port: 0 } } }]
]) {
  test(`${name} opens settings and shows a bottom toast without layout shift`, async () => {
    const page = await openApp({ configState })
    try {
      await page.getByRole('dialog', { name: 'Einstellungen' }).waitFor()
      const toast = page.locator('.toast')
      await toast.waitFor()
      assert.match(await toast.innerText(), /Azure-Konfiguration fehlt oder ist unvollständig/)
      assert.equal(await page.locator('main > .hint').count(), 0)
      const style = await toast.evaluate((element) => {
        const css = getComputedStyle(element)
        return { position: css.position, bottom: css.bottom }
      })
      assert.deepEqual(style, { position: 'fixed', bottom: '24px' })
      await page.getByRole('button', { name: 'Dialog schließen', exact: true }).click()
      const before = await page.locator('.layout-grid').boundingBox()
      await page.getByRole('button', { name: 'Fehlermeldung schließen', exact: true }).click()
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

test('settings separates Proxy into a fixed-size tab and preserves save and test payloads', async () => {
  const page = await openApp({
    configState: { exists: true, path: 'test-config', config: validConfig },
    connectivityError: 'Local diagnostic test'
  })
  try {
    await page.getByRole('button', { name: 'Einstellungsdialog öffnen' }).click()
    const dialog = page.getByRole('dialog', { name: 'Einstellungen', exact: true })
    const panels = dialog.locator('.panel')
    assert.deepEqual(await panels.locator('h2').allTextContents(), ['Allgemein', 'Azure-Konfiguration', 'Proxy'])
    const azure = panels.nth(1)
    const proxy = panels.nth(2)
    await dialog.getByRole('tab', { name: 'Azure-Konfiguration', exact: true }).click()
    assert.equal(await azure.getByLabel('Proxy verwenden').count(), 0)
    assert.equal(await proxy.getByRole('button', { name: 'Verbindung testen', exact: true }).count(), 0)
    assert.equal(await azure.getByRole('button', { name: 'Verbindung testen', exact: true }).count(), 1)
    assert.equal(await azure.getByRole('button', { name: 'Verbindung testen', exact: true }).getAttribute('title'), null)
    assert.equal(await panels.locator('.meta-path').count(), 0)
    const footer = dialog.locator('.settings-dialog-footer')
    assert.deepEqual(await footer.locator('.meta-path').allTextContents(), [
      'Konfiguration: test-config'
    ])
    assert.equal(await dialog.locator('.settings-dialog-grid .settings-dialog-footer').count(), 0)
    const dialogBox = await dialog.boundingBox()
    await dialog.getByRole('tab', { name: 'Proxy', exact: true }).click()
    assert.equal(await proxy.locator('.settings-inline-hint').count(), 0)
    assert.equal(await proxy.getByLabel('Proxy Host', { exact: true }).isDisabled(), true)
    await proxy.getByLabel('Proxy verwenden').check()
    await proxy.getByLabel('Proxy Host', { exact: true }).fill('proxy.test')
    await proxy.getByLabel('Proxy Port', { exact: true }).fill('8080')
    await proxy.getByLabel('Proxy Benutzername (optional)', { exact: true }).fill('test-user')
    await proxy.getByLabel('Proxy Passwort (optional)', { exact: true }).fill('test-password')
    const proxyConfig = { host: 'proxy.test', port: 8080, username: 'test-user', password: 'test-password' }
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click()
    await page.waitForFunction(() => !!window.lastSavedConfig)
    assert.deepEqual(await page.evaluate(() => window.lastSavedConfig), { ...validConfig, proxy: proxyConfig })
    await reopenSettings(page)
    await dialog.getByRole('tab', { name: 'Proxy', exact: true }).click()
    assert.deepEqual(await dialog.boundingBox(), dialogBox)
    for (const width of [1280, 800, 560, 390]) {
      await page.setViewportSize({ width, height: 860 })
      const before = await dialog.boundingBox()
      for (const tab of ['Allgemein', 'Azure-Konfiguration', 'Proxy']) {
        await dialog.getByRole('tab', { name: tab, exact: true }).click()
        assert.deepEqual(await dialog.boundingBox(), before)
        assert.equal(await dialog.getByRole('tabpanel').count(), 1)
      }
      const [host, port, username, password] = await Promise.all([
        'Proxy Host', 'Proxy Port', 'Proxy Benutzername (optional)', 'Proxy Passwort (optional)'
      ].map(name => proxy.getByLabel(name, { exact: true }).boundingBox()))
      assert.equal(host.y, port.y)
      assert.equal(username.y, password.y)
      assert.ok(host.x + host.width <= port.x)
      assert.ok(username.y > host.y + host.height)
      assert.equal(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth), true)
    }
    await dialog.getByRole('tab', { name: 'Azure-Konfiguration', exact: true }).click()
    await azure.getByRole('button', { name: 'Verbindung testen', exact: true }).click()
    await page.getByRole('dialog', { name: 'Verbindungstest', exact: true }).locator('tbody tr').waitFor()
    assert.deepEqual(await page.evaluate(() => window.lastConnectivityPayload), { ...validConfig, proxy: proxyConfig, language: 'de-DE' })
  } finally {
    await page.close()
  }
})

test('settings offers a single save button in the footer that persists config and settings together', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await page.getByRole('button', { name: 'Einstellungsdialog öffnen' }).click()
    const dialog = page.getByRole('dialog', { name: 'Einstellungen', exact: true })
    const footer = dialog.locator('.settings-dialog-footer')

    assert.equal(await dialog.boundingBox().then((box) => box.height), 620)
    assert.equal(await dialog.locator('.settings-dialog-grid').getByText('Änderungen gelten nach dem Speichern für die nächste Aufnahme.', { exact: true }).count(), 0)
    const hint = footer.getByText('Änderungen gelten nach dem Speichern für die nächste Aufnahme.', { exact: true })
    assert.equal(await hint.count(), 1)
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 860 })
      const copy = await footer.locator('.settings-dialog-footer-copy').boundingBox()
      const save = await footer.getByRole('button', { name: 'Speichern', exact: true }).boundingBox()
      const hintBox = await hint.boundingBox()
      const path = await footer.locator('.meta-path').boundingBox()
      const content = await footer.locator('.settings-dialog-footer-content').boundingBox()
      assert.equal(hintBox.x, path.x)
      assert.ok(path.y >= hintBox.y + hintBox.height)
      assert.ok(save.x >= copy.x + copy.width)
      assert.equal(save.y, copy.y)
      assert.equal(save.height, copy.height)
      assert.equal(save.x + save.width, content.x + content.width)
    }
    await page.setViewportSize({ width: 1280, height: 860 })

    // Genau ein Speichern-Button im Dialog, und er liegt im Footer.
    assert.equal(await dialog.getByRole('button', { name: 'Speichern', exact: true }).count(), 1)
    assert.equal(await footer.getByRole('button', { name: 'Speichern', exact: true }).count(), 1)
    assert.equal(await dialog.locator('.panel').getByRole('button', { name: 'Speichern', exact: true }).count(), 0)
    // Die alten, panelspezifischen Buttons existieren nicht mehr.
    assert.equal(await dialog.getByRole('button', { name: 'Einstellungen speichern', exact: true }).count(), 0)
    assert.equal(await dialog.getByRole('button', { name: 'Azure-Konfiguration speichern', exact: true }).count(), 0)

    // Der Button steht unterhalb aller drei Bereiche.
    const footerBox = await footer.boundingBox()
    const bodyBox = await dialog.locator('.settings-dialog-grid').boundingBox()
    assert.ok(footerBox.y >= bodyBox.y + bodyBox.height)

    // Ein Klick speichert beide Abschnitte: Benutzereinstellungen und Azure-Konfiguration.
    await dialog.getByRole('combobox', { name: 'Sprache', exact: true }).selectOption('en-US')
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click()
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
    await page.getByRole('button', { name: 'Einstellungsdialog öffnen' }).click()
    const language = page.getByRole('combobox', { name: 'Sprache', exact: true })
    assert.equal(await language.inputValue(), 'de-DE')
    assert.equal(await language.locator('option').count(), 10)
    assert.equal(await page.getByRole('radiogroup').count(), 0)
    await language.selectOption('en-US')
    await page.getByRole('button', { name: 'Speichern', exact: true }).click()
    await page.waitForFunction(() => window.lastSavedSettings?.language === 'en-US')
    await reopenSettings(page)
    await page.getByRole('tab', { name: 'Azure-Konfiguration', exact: true }).click()
    await page.getByRole('button', { name: 'Verbindung testen', exact: true }).click()
    await page.getByRole('dialog', { name: 'Verbindungstest', exact: true }).waitFor()
    assert.equal((await page.evaluate(() => window.lastConnectivityPayload)).language, 'en-US')
  } finally {
    await page.close()
  }
})

test('idle settings save rapid changes in order before enabling recording', async () => {
  const page = await openApp({
    configState: { exists: true, path: 'test-config', config: validConfig },
    deferSettings: true,
    inputs: [{ id: 'mic-one', name: 'Testmikrofon', isDefault: false }]
  })
  try {
    const idle = page.locator('.idle-audio-panel')
    await idle.getByRole('combobox', { name: 'Sprache', exact: true }).selectOption('en-US')
    await idle.getByRole('combobox', { name: 'Mikrofon', exact: true }).selectOption('mic-one')
    await idle.getByRole('checkbox', { name: 'Speaker-Loopback transkribieren', exact: true }).uncheck()
    assert.equal(await page.getByRole('button', { name: 'Start', exact: true }).isDisabled(), true)
    assert.equal(await page.evaluate(() => window.settingsSaveCalls.length), 1)
    for (let count = 1; count <= 3; count++) {
      await page.evaluate(() => window.pendingSettingsSaves.shift()())
      if (count < 3) {
        await page.waitForFunction(value => window.settingsSaveCalls.length === value, count + 1)
        assert.equal(await idle.getByRole('combobox', { name: 'Mikrofon', exact: true }).inputValue(), 'mic-one')
        assert.equal(await idle.getByRole('checkbox', { name: 'Speaker-Loopback transkribieren', exact: true }).isChecked(), false)
      }
    }
    await page.waitForFunction(() => window.lastSavedSettings?.devices.micId === 'mic-one' && window.lastSavedSettings.transcription.speaker === false)
    assert.equal(await page.evaluate(() => window.lastSavedSettings.language), 'en-US')
    await page.locator('.hero-controls .primary-button:not(:disabled)').waitFor()
    assert.equal(await page.evaluate(() => window.lastSavedConfig), undefined)
  } finally { await page.close() }
})

test('failed idle autosave is visible and a successful retry restores recording', async () => {
  const page = await openApp({
    configState: { exists: true, path: 'test-config', config: validConfig },
    saveSettingsError: 'Konfiguration ist schreibgeschützt'
  })
  try {
    const idle = page.locator('.idle-audio-panel')
    await idle.getByRole('combobox', { name: 'Sprache', exact: true }).selectOption('en-US')
    await page.getByRole('alert').waitFor()
    assert.match(await page.getByRole('alert').innerText(), /schreibgeschützt/)
    assert.equal(await page.getByRole('button', { name: 'Start', exact: true }).isDisabled(), true)
    await page.evaluate(() => { window.settingsSaveError = null })
    await idle.getByRole('checkbox', { name: 'Sprechererkennung für Mikrofon', exact: true }).uncheck()
    await page.waitForFunction(() => window.lastSavedSettings?.language === 'en-US' && window.lastSavedSettings.diarization.mic === false)
    await page.locator('.hero-controls .primary-button:not(:disabled)').waitFor()
    assert.equal(await page.getByRole('alert').count(), 0)
  } finally { await page.close() }
})

for (const failure of ['saveSettingsError', 'saveConfigError']) {
  test(`settings dialog stays open on ${failure}`, async () => {
    const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig }, [failure]: 'Datei kann nicht gespeichert werden' })
    try {
      await page.getByRole('button', { name: 'Einstellungsdialog öffnen' }).click()
      const dialog = page.getByRole('dialog', { name: 'Einstellungen', exact: true })
      await dialog.getByRole('combobox', { name: 'Sprache', exact: true }).selectOption('en-US')
      assert.equal(await page.evaluate(() => window.lastSavedSettings), undefined)
      await dialog.getByRole('button', { name: 'Speichern', exact: true }).click()
      await page.getByRole('alert').waitFor()
      assert.equal(await dialog.isVisible(), true)
      assert.match(await dialog.locator('.hint').innerText(), /Datei kann nicht gespeichert werden/)
      assert.equal(await dialog.getByRole('button', { name: 'Speichern', exact: true }).isDisabled(), false)
    } finally { await page.close() }
  })
}

test('language dropdown preserves a configured language outside the default options', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig }, language: 'fr-CA' })
  try {
    await page.getByRole('button', { name: 'Einstellungsdialog öffnen' }).click()
    assert.equal(await page.getByRole('combobox', { name: 'Sprache', exact: true }).inputValue(), 'fr-CA')
    await page.getByRole('button', { name: 'Speichern', exact: true }).click()
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
    await page.getByRole('button', { name: 'Einstellungsdialog öffnen' }).click()
    const path = page.getByRole('textbox', { name: 'Speicherpfad (optional)', exact: true })
    const picker = page.getByRole('button', { name: 'Speicherordner auswählen', exact: true })
    await picker.click()
    await page.waitForFunction(() => document.querySelector('#transcript-export-path')?.value === 'D:\\Meeting Notes')
    await page.evaluate(() => { window.directoryPickerResult = null })
    await picker.click()
    await page.waitForFunction(() => window.directoryPickerCalls === 2)
    assert.equal(await path.inputValue(), 'D:\\Meeting Notes')
    await page.getByRole('button', { name: 'Speichern', exact: true }).click()
    await page.waitForFunction(() => window.lastSavedSettings?.transcript.markdownExport.path === 'D:\\Meeting Notes')
    await reopenSettings(page)
    await page.getByRole('checkbox', { name: 'Transkript automatisch als Markdown speichern', exact: true }).uncheck()
    assert.equal(await picker.isDisabled(), true)
    assert.equal(await path.isDisabled(), true)
  } finally { await page.close() }
})

test('export folder picker errors leave the previous path intact and visible', async () => {
  const page = await openApp({
    configState: { exists: true, path: 'test-config', config: validConfig },
    transcript: { markdownExport: { enabled: true, path: 'D:\\Existing' } },
    directoryPickerError: 'Ordnerauswahl fehlgeschlagen'
  })
  try {
    await page.getByRole('button', { name: 'Einstellungsdialog öffnen' }).click()
    await page.getByRole('button', { name: 'Speicherordner auswählen', exact: true }).click()
    await page.getByRole('alert').waitFor()
    assert.match(await page.getByRole('alert').innerText(), /Ordnerauswahl fehlgeschlagen/)
    assert.equal(await page.getByRole('textbox', { name: 'Speicherpfad (optional)', exact: true }).inputValue(), 'D:\\Existing')
    assert.equal(await page.getByRole('dialog', { name: 'Einstellungen', exact: true }).isVisible(), true)
  } finally { await page.close() }
})

test('language dropdown remains disabled during recording', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig }, running: true })
  try {
    await page.getByRole('button', { name: 'Einstellungsdialog öffnen' }).click()
    assert.equal(await page.getByRole('combobox', { name: 'Sprache', exact: true }).isDisabled(), true)
    assert.equal(await page.getByRole('checkbox', { name: 'Sprechererkennung für Mikrofon', exact: true }).isDisabled(), true)
    assert.equal(await page.getByRole('checkbox', { name: 'Sprechererkennung für Speaker', exact: true }).isDisabled(), true)
  } finally {
    await page.close()
  }
})

test('diarization settings default on and independently save all source combinations', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await page.getByRole('button', { name: 'Einstellungsdialog öffnen' }).click()
    const mic = page.getByRole('checkbox', { name: 'Sprechererkennung für Mikrofon', exact: true })
    const speaker = page.getByRole('checkbox', { name: 'Sprechererkennung für Speaker', exact: true })
    assert.equal(await mic.isChecked(), true)
    assert.equal(await speaker.isChecked(), true)
    for (const settings of [{ mic: false, speaker: true }, { mic: true, speaker: false }, { mic: false, speaker: false }, { mic: true, speaker: true }]) {
      await mic.setChecked(settings.mic)
      await speaker.setChecked(settings.speaker)
      await page.getByRole('button', { name: 'Speichern', exact: true }).click()
      await page.waitForFunction((value) => window.lastSavedSettings?.diarization.mic === value.mic && window.lastSavedSettings?.diarization.speaker === value.speaker, settings)
      await reopenSettings(page)
      assert.equal(await mic.isChecked(), settings.mic)
      assert.equal(await speaker.isChecked(), settings.speaker)
    }
    await page.getByRole('button', { name: 'Dialog schließen', exact: true }).click()
    await page.getByRole('button', { name: 'Einstellungsdialog öffnen' }).click()
    assert.equal(await mic.isChecked(), true)
    assert.equal(await speaker.isChecked(), true)
  } finally {
    await page.close()
  }
})

for (const inDialog of [false, true]) {
  test(`microphone transcription toggles independently ${inDialog ? 'in settings' : 'in the idle panel'}`, async () => {
    const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
    try {
      if (inDialog) await page.getByRole('button', { name: 'Einstellungsdialog öffnen' }).click()
      const panel = inDialog ? page.getByRole('dialog', { name: 'Einstellungen', exact: true }) : page.locator('.idle-audio-panel')
      if (inDialog) {
        assert.equal(await panel.locator('.audio-settings-grid').evaluate(element => getComputedStyle(element).marginTop), '0px')
      }
      const mic = panel.getByRole('checkbox', { name: 'Mikrofon transkribieren', exact: true })
      const speaker = panel.getByRole('checkbox', { name: 'Speaker-Loopback transkribieren', exact: true })
      for (const width of [950, 390]) {
        await page.setViewportSize({ width, height: 650 })
        for (const [checkbox, device] of [[mic, 'Mikrofon'], [speaker, 'Speaker Loopback']]) {
          const toggleBox = await checkbox.boundingBox()
          const deviceBox = await panel.getByRole('combobox', { name: device, exact: true }).boundingBox()
          assert.ok(toggleBox.x + toggleBox.width <= deviceBox.x)
          assert.ok(Math.abs(toggleBox.y + toggleBox.height / 2 - deviceBox.y - deviceBox.height / 2) < 1)
          assert.equal(await panel.getByText(await checkbox.getAttribute('aria-label'), { exact: true }).count(), 0)
          const diarization = await panel.getByRole('checkbox', {
            name: device === 'Mikrofon' ? 'Sprechererkennung für Mikrofon' : 'Sprechererkennung für Speaker', exact: true
          }).boundingBox()
          assert.ok(diarization.x >= deviceBox.x + deviceBox.width)
          assert.ok(Math.abs(diarization.y + diarization.height / 2 - deviceBox.y - deviceBox.height / 2) < 1)
        }
        const micBox = await panel.getByRole('combobox', { name: 'Mikrofon', exact: true }).boundingBox()
        const speakerBox = await panel.getByRole('combobox', { name: 'Speaker Loopback', exact: true }).boundingBox()
        assert.ok(speakerBox.y >= micBox.y + micBox.height)
        assert.equal(await panel.evaluate(element => element.scrollWidth <= element.clientWidth), true)
      }
      await mic.click()
      assert.equal(await mic.isChecked(), false)
      assert.equal(await speaker.isChecked(), true)
      assert.equal(await panel.getByRole('combobox', { name: 'Mikrofon', exact: true }).isDisabled(), true)
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
}

test('transcription sources default on, persist independently and keep the last source enabled', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await page.getByRole('button', { name: 'Einstellungsdialog öffnen' }).click()
    const mic = page.getByRole('checkbox', { name: 'Mikrofon transkribieren', exact: true })
    const speaker = page.getByRole('checkbox', { name: 'Speaker-Loopback transkribieren', exact: true })
    assert.equal(await mic.isChecked(), true)
    assert.equal(await speaker.isChecked(), true)
    // Speaker abschalten: Mic bleibt aktiv, beide Checkboxen bleiben bedienbar.
    await speaker.uncheck()
    await page.getByRole('button', { name: 'Speichern', exact: true }).click()
    await page.waitForFunction(() => window.lastSavedSettings?.transcription?.speaker === false)
    await reopenSettings(page)
    assert.equal(await mic.isChecked(), true)
    assert.equal(await speaker.isChecked(), false)
    assert.equal(await mic.isDisabled(), false)
    assert.equal(await speaker.isDisabled(), false)
    // Letzte aktive Quelle abwaehlen: die andere wird automatisch aktiviert.
    await mic.uncheck()
    assert.equal(await mic.isChecked(), false)
    assert.equal(await speaker.isChecked(), true)
    await page.getByRole('button', { name: 'Speichern', exact: true }).click()
    await page.waitForFunction(() => window.lastSavedSettings?.transcription?.mic === false && window.lastSavedSettings?.transcription?.speaker === true)
    await reopenSettings(page)
    await speaker.uncheck()
    assert.equal(await mic.isChecked(), true)
    assert.equal(await speaker.isChecked(), false)
    await page.getByRole('button', { name: 'Speichern', exact: true }).click()
    await page.waitForFunction(() => window.lastSavedSettings?.transcription?.mic === true && window.lastSavedSettings?.transcription?.speaker === false)
    await reopenSettings(page)
    await speaker.check()
    assert.equal(await mic.isDisabled(), false)
    await page.getByRole('button', { name: 'Speichern', exact: true }).click()
    await page.waitForFunction(() => window.lastSavedSettings?.transcription?.speaker === true)
    await reopenSettings(page)
    // Ein deaktiviertes Quellgeraet wird nicht mehr gebraucht.
    await speaker.uncheck()
    assert.equal(await page.getByRole('combobox', { name: 'Speaker Loopback', exact: true }).isDisabled(), true)
    // Die Diarization-Checkboxen folgen der Quelle: ohne Transkription ist
    // die Sprechererkennung fuer diese Quelle wirkungslos.
    assert.equal(await page.getByRole('checkbox', { name: 'Sprechererkennung für Speaker', exact: true }).isDisabled(), true)
    assert.equal(await page.getByRole('checkbox', { name: 'Sprechererkennung für Mikrofon', exact: true }).isDisabled(), false)
    assert.equal(await page.getByRole('combobox', { name: 'Mikrofon', exact: true }).isDisabled(), false)
    await speaker.check()
    assert.equal(await page.getByRole('combobox', { name: 'Speaker Loopback', exact: true }).isDisabled(), false)
  } finally {
    await page.close()
  }
})


test('close-to-tray checkbox defaults off and saves both states via the existing footer', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await page.getByRole('button', { name: 'Einstellungsdialog öffnen' }).click()
    const checkbox = page.getByRole('checkbox', { name: 'Beim Schließen in den Systray minimieren', exact: true })
    assert.equal(await checkbox.isChecked(), false)
    for (const enabled of [true, false]) {
      await checkbox.setChecked(enabled)
      await page.getByRole('button', { name: 'Speichern', exact: true }).click()
      await page.waitForFunction(value => window.lastSavedSettings?.window.minimizeToTrayOnClose === value, enabled)
      assert.deepEqual(await page.evaluate(() => window.lastSavedConfig), validConfig)
      await reopenSettings(page)
      assert.equal(await checkbox.isChecked(), enabled)
      assert.equal(await page.getByRole('button', { name: 'Speichern', exact: true }).count(), 1)
    }
  } finally { await page.close() }
})

test('saved close-to-tray preference loads and is disabled during recording', async () => {
  const page = await openApp({
    configState: { exists: true, path: 'test-config', config: validConfig },
    windowSettings: { minimizeToTrayOnClose: true }, running: true
  })
  try {
    await page.getByRole('button', { name: 'Einstellungsdialog öffnen' }).click()
    const checkbox = page.getByRole('checkbox', { name: 'Beim Schließen in den Systray minimieren', exact: true })
    assert.equal(await checkbox.isChecked(), true)
    assert.equal(await checkbox.isDisabled(), true)
  } finally { await page.close() }
})

test('saved disabled diarization options remain disabled on startup', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig }, diarization: { mic: false, speaker: false } })
  try {
    await page.getByRole('button', { name: 'Einstellungsdialog öffnen' }).click()
    assert.equal(await page.getByRole('checkbox', { name: 'Sprechererkennung für Mikrofon', exact: true }).isChecked(), false)
    assert.equal(await page.getByRole('checkbox', { name: 'Sprechererkennung für Speaker', exact: true }).isChecked(), false)
  } finally {
    await page.close()
  }
})

test('Mic speakers get independent badges, aliases, interim handling and export labels', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await page.waitForFunction(() => typeof window.emitSegment === 'function')
    const events = [
      { source: 'mic', speaker: 'Guest-1', text: 'Mic erste Stimme.', state: 'final' },
      { source: 'mic', speaker: 'Guest-2', text: 'Mic zweite Stimme.', state: 'final' },
      { source: 'speaker', speaker: 'Guest-1', text: 'Speaker erste Stimme.', state: 'final' },
      { source: 'mic', speaker: 'unknown', text: 'Vorläufig unbekannt.', state: 'interim' },
      { source: 'mic', speaker: 'Guest-1', text: 'Vorläufig erste Stimme.', state: 'interim' },
      { source: 'mic', speaker: 'Guest-2', text: 'Mic korrigierte zweite Stimme.', state: 'final' }
    ]
    for (const [index, event] of events.entries()) {
      await page.evaluate((segment) => window.emitSegment(segment), { ...event, id: `segment-${index}`, language: 'de-DE', timestampIso: new Date(2026, 10, 9, 13, 0, index).toISOString() })
    }
    await page.locator('.segment.final').nth(3).waitFor()
    await page.getByRole('button', { name: 'Sprecherzuordnung einblenden', exact: true }).click()
    assert.equal(await page.locator('.segment.interim').count(), 0)
    assert.equal(await page.locator('.speaker-mapping-list .speaker-row').count(), 3)
    assert.deepEqual(await page.locator('.speaker-badge').allTextContents(), ['Mic · Guest-1', 'Mic · Guest-2', 'Speaker · Guest-1', 'Mic · Guest-2'])
    const badges = await page.locator('.speaker-editor').evaluateAll((elements) => elements.map((element) => element.className))
    assert.notEqual(badges[0], badges[1])
    assert.notEqual(badges[0], badges[2])
    await page.getByRole('textbox', { name: 'Anzeigename für Mic · Guest-1', exact: true }).fill('Anna')
    await page.getByRole('textbox', { name: 'Anzeigename für Mic · Guest-2', exact: true }).fill('Clara')
    await page.getByRole('textbox', { name: 'Anzeigename für Speaker · Guest-1', exact: true }).fill('Bert')
    assert.deepEqual(await page.locator('.speaker-badge').allTextContents(), ['Anna', 'Clara', 'Bert', 'Clara'])
    assert.equal(await page.locator('.speaker-badge').last().innerText(), 'Clara')
    await page.getByRole('button', { name: 'Transkript kopieren', exact: true }).click()
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
    assert.match(await page.locator('.live-badge').getAttribute('aria-label'), /Läuft/)
    await page.getByRole('button', { name: /Pause/ }).click()
    await page.waitForFunction(() => !!window.lastPauseCalled)
    await page.waitForFunction(() => document.querySelector('.live-badge')?.classList.contains('paused'))
    assert.match(await page.locator('.live-badge').getAttribute('aria-label'), /Pausiert/)
    assert.match(await page.locator('.live-badge').getAttribute('title'), /Sitzung bleibt aktiv/)
    await page.getByRole('button', { name: /Weiter/ }).click()
    await page.waitForFunction(() => !!window.lastResumeCalled)
    await page.waitForFunction(() => !document.querySelector('.live-badge')?.classList.contains('paused'))
    assert.match(await page.locator('.live-badge').getAttribute('aria-label'), /Läuft/)
  } finally {
    await page.close()
  }
})

test('the same SDK id in two sessions stays two separate speakers with separate aliases', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await page.waitForFunction(() => typeof window.emitSegment === 'function')
    const events = [
      { source: 'mic', speaker: 'Guest-1', sessionId: 's1', text: 'Erste Sitzung.', state: 'final' },
      { source: 'mic', speaker: 'Guest-1', sessionId: 's2', text: 'Zweite Sitzung.', state: 'final' }
    ]
    for (const [index, event] of events.entries()) {
      await page.evaluate((segment) => window.emitSegment(segment), { ...event, id: `segment-${index}`, language: 'de-DE', timestampIso: new Date(2026, 10, 13, 10, 0, index).toISOString() })
    }
    await page.locator('.segment.final').nth(1).waitFor()
    // Zwei Sitzungen, zwei Identitaeten: kein Zusammenfuehren ueber die Grenze.
    assert.equal(await page.locator('.segment.final').count(), 2)
    await page.getByRole('button', { name: 'Sprecherzuordnung einblenden', exact: true }).click()
    assert.equal(await page.locator('.speaker-mapping-list .speaker-row').count(), 2)
    await page.getByRole('textbox', { name: 'Anzeigename für Mic · Guest-1 #1', exact: true }).fill('Anna')
    await page.getByRole('textbox', { name: 'Anzeigename für Mic · Guest-1 #2', exact: true }).fill('Bert')
    assert.deepEqual(await page.locator('.speaker-badge').allTextContents(), ['Anna', 'Bert'])
    // Der Alias der ersten Sitzung faellt nicht auf die zweite.
    await page.getByRole('button', { name: 'Transkript kopieren', exact: true }).click()
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
    await page.getByRole('dialog', { name: 'Einstellungen' }).waitFor()
    await page.getByRole('tab', { name: 'Azure-Konfiguration', exact: true }).click()
    await page.getByRole('textbox', { name: 'Endpoint', exact: true }).fill(validConfig.endpoint)
    await page.getByRole('textbox', { name: 'Region', exact: true }).fill(validConfig.region)
    await page.getByLabel('Speech Key', { exact: true }).fill(validConfig.speechKey)
    await page.getByRole('button', { name: 'Speichern', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.toast-info')?.textContent.includes('Einstellungen gespeichert.'))
    await page.getByRole('dialog', { name: 'Einstellungen', exact: true }).waitFor({ state: 'hidden' })
    await page.locator('.hero-controls .primary-button:not(:disabled)').waitFor()
    assert.equal(await page.getByRole('dialog').count(), 0)
  } finally {
    await page.close()
  }
})

for (const error of ['Proxy CONNECT: 407 Proxy Authentication Required', { message: 'Sidecar konnte nicht starten', code: 'SPAWN_FAILED' }]) {
  test(`connectivity dialog preserves IPC error details: ${JSON.stringify(error)}`, async () => {
    const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig }, connectivityError: error })
    try {
      await page.getByRole('button', { name: 'Einstellungsdialog öffnen' }).click()
      await page.getByRole('tab', { name: 'Azure-Konfiguration', exact: true }).click()
      await page.getByRole('button', { name: 'Verbindung testen', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Verbindungstest', exact: true })
      await dialog.locator('tbody tr').waitFor()
      assert.match(await dialog.innerText(), /IPC \/ Diagnose starten/)
      assert.ok((await dialog.innerText()).includes(typeof error === 'string' ? error : error.message))
      assert.match(await dialog.innerText(), /HTTPS: nicht geprüft/)
      assert.equal(await page.getByRole('dialog').count(), 1)
    } finally {
      await page.close()
    }
  })
}

test('connectivity dialog displays pending test and all results, and can reopen without rerunning', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig }, deferConnectivity: true })
  try {
    await page.getByRole('button', { name: 'Einstellungsdialog öffnen' }).click()
    await page.getByRole('tab', { name: 'Azure-Konfiguration', exact: true }).click()
    await page.getByRole('button', { name: 'Verbindung testen', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Verbindungstest', exact: true })
    await dialog.waitFor()
    assert.match(await dialog.innerText(), /Verbindungstest läuft/)
    const gridWidth = await dialog.locator('.settings-dialog-grid').evaluate((element) => {
      const css = getComputedStyle(element)
      return element.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight)
    })
    const contentBox = await dialog.locator('.connectivity-dialog-content').boundingBox()
    assert.ok(Math.abs(contentBox.width - gridWidth) < 1)
    await dialog.getByRole('button', { name: 'Dialog schließen', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: 'Teste …', exact: true }).isDisabled(), true)
    await page.getByRole('button', { name: 'Laufenden Verbindungstest anzeigen' }).click()
    await dialog.waitFor()
    assert.match(await dialog.innerText(), /Verbindungstest läuft/)
    const result = {
      reachable: false, httpsReachable: true, speechReachable: false, httpStatus: 403,
      httpStatusText: 'Forbidden', latencyMs: 123, probeUrl: 'https://example.test/probe',
      error: 'Speech/WSS fehlgeschlagen',
      steps: [
        { step: 'dns', status: 'ok', detail: 'Proxy DNS erfolgreich' },
        { step: 'tcp', status: 'ok', detail: 'TCP verbunden' },
        { step: 'https', status: 'warn', detail: 'HTTP 403 bestätigt Erreichbarkeit' },
        { step: 'speech_recognizer_wss', status: 'error', detail: 'TLS handshake rejected' },
        { step: 'conversation_transcriber_wss', status: 'error', detail: 'Connection timeout' }
      ]
    }
    await page.evaluate((value) => window.completeConnectivity(value), result)
    await dialog.locator('tbody tr').first().waitFor()
    assert.equal(await dialog.locator('tbody tr').count(), result.steps.length)
    for (const step of result.steps) assert.ok((await dialog.innerText()).includes(step.detail))
    assert.match(await dialog.innerText(), /HTTP 403 Forbidden/)
    assert.match(await dialog.innerText(), /HTTPS: erreichbar · Speech\/WSS: fehlgeschlagen/)
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
    await dialog.getByRole('button', { name: 'Dialog schließen', exact: true }).click()
    for (const width of [1280, 560]) {
      await page.setViewportSize({ width, height: 860 })
      const testButton = await page.getByRole('button', { name: 'Verbindung testen', exact: true }).boundingBox()
      const lastButton = await page.getByRole('button', { name: 'Letzten Verbindungstest anzeigen' }).boundingBox()
      const gap = Math.max(lastButton.x - testButton.x - testButton.width, lastButton.y - testButton.y - testButton.height)
      assert.ok(gap >= 11.9, `Test actions should have at least 12px spacing at ${width}px`)
    }
    await page.getByRole('button', { name: 'Letzten Verbindungstest anzeigen' }).click()
    await dialog.waitFor()
    assert.equal(await dialog.locator('tbody tr').count(), result.steps.length)
  } finally {
    await page.close()
  }
})

test('configuration load rejection opens settings', async () => {
  const page = await openApp({ configError: true })
  try {
    await page.getByRole('dialog', { name: 'Einstellungen' }).waitFor()
    assert.match(await page.locator('.toast').innerText(), /Azure-Konfiguration konnte nicht geladen werden/)
  } finally {
    await page.close()
  }
})

test('other startup failures do not prevent opening settings for missing configuration', async () => {
  const page = await openApp({ devicesError: true, configState: { exists: false, path: 'test-config', config: null } })
  try {
    await page.getByRole('dialog', { name: 'Einstellungen' }).waitFor()
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
        text: `Transkript ${index}: Besprechung und naechste Schritte.`, state: 'final' })
    }
  }, count)
  await page.locator('.segment').nth(count - 1).waitFor()
}

async function toggleDebug(page) {
  await page.locator('.overflow-menu > summary').click()
  await page.getByRole('button', { name: 'Debug-Log', exact: true }).click()
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
      assert.equal(await page.getByRole('button', { name: 'Einstellungsdialog öffnen' }).innerText(), '')
      const firstColumn = await page.locator('.segment').first().evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ')[0])
      if (width > 500) assert.equal(firstColumn, '120px')
    }
    await page.setViewportSize({ width: 1280, height: 860 })
    const before = await page.locator('.recording-actions').boundingBox()
    await page.getByRole('button', { name: 'Start', exact: true }).click()
    await page.getByRole('button', { name: 'Pause', exact: true }).click()
    assert.deepEqual(await page.locator('.recording-actions').boundingBox(), before)
    await page.getByRole('button', { name: 'Weiter', exact: true }).click()
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
    const input = tag.getByRole('textbox', { name: 'Sprechername', exact: true })
    assert.deepEqual(await input.boundingBox(), tagBox)
    assert.equal(await input.evaluate((element) => getComputedStyle(element).outlineStyle), 'none')
    await input.fill('Anna')
    assert.deepEqual(await page.locator('.segment-text').first().boundingBox(), textBox)
    await input.press('Escape')
    assert.equal(await tag.innerText(), 'Mic · Guest-1')
    await tag.locator('button').click()
    await input.fill('Anna')
    await input.press('Enter')
    await page.getByRole('button', { name: 'Sprecherzuordnung einblenden', exact: true }).click()
    const mapping = page.getByRole('textbox', { name: 'Anzeigename für Mic · Guest-1', exact: true })
    assert.equal(await mapping.inputValue(), 'Anna')
    assert.deepEqual(await mapping.evaluate((element) => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color })), palette)
    await tag.locator('button').click()
    await input.fill('Anita')
    await mapping.click()
    assert.equal(await mapping.inputValue(), 'Anita')
    await page.locator('.overflow-menu > summary').click()
    await page.getByRole('button', { name: 'Markdown exportieren', exact: true }).click()
    await page.waitForFunction(() => window.lastSavedMarkdown?.includes('Anita'))
    assert.ok((await page.evaluate(() => window.lastSavedMarkdown)).includes('Speaker · Guest-1'))
    await page.getByRole('button', { name: 'Transkript kopieren', exact: true }).click()
    await page.waitForFunction(() => window.lastCopiedSegments?.[0].speaker === 'Anita')
  } finally { await page.close() }
})

test('idle audio settings synchronize with dialog, persist, and reset is stopped-only', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await page.getByRole('heading', { name: 'Allgemeine Einstellungen', exact: true }).waitFor()
    const idle = page.locator('.idle-audio-panel')
    assert.equal(await idle.getByRole('combobox').count(), 3)
    assert.equal(await idle.getByRole('checkbox').count(), 4)
    assert.equal(await idle.getByLabel('Speicherpfad (optional)', { exact: true }).count(), 0)
    assert.equal(await idle.getByRole('button', { name: 'Speichern', exact: true }).count(), 0)
    assert.equal(await idle.getByText(/Änderungen gelten/).count(), 0)
    await idle.getByRole('combobox', { name: 'Sprache', exact: true }).selectOption('en-US')
    await idle.getByRole('checkbox', { name: 'Sprechererkennung für Speaker', exact: true }).uncheck()
    await page.waitForFunction(() => window.lastSavedSettings?.language === 'en-US' && window.lastSavedSettings?.diarization.speaker === false)
    assert.equal(await page.evaluate(() => window.lastSavedConfig), undefined)
    await page.getByRole('button', { name: 'Einstellungsdialog öffnen' }).click()
    const dialog = page.getByRole('dialog', { name: 'Einstellungen', exact: true })
    assert.equal(await dialog.getByRole('combobox', { name: 'Sprache', exact: true }).inputValue(), 'en-US')
    assert.equal(await dialog.getByRole('checkbox', { name: 'Sprechererkennung für Speaker', exact: true }).isChecked(), false)
    await dialog.getByRole('combobox', { name: 'Sprache', exact: true }).selectOption('fr-FR')
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click()
    await page.waitForFunction(() => window.lastSavedSettings?.language === 'fr-FR')
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await idle.getByRole('combobox', { name: 'Sprache', exact: true }).inputValue(), 'fr-FR')
    assert.equal(await page.getByRole('button', { name: 'Transkript löschen', exact: true }).isDisabled(), true)
    await page.getByRole('button', { name: 'Start', exact: true }).click()
    await emitSegments(page)
    assert.equal(await idle.count(), 0)
    await page.getByRole('button', { name: 'Pause', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: 'Transkript löschen', exact: true }).isDisabled(), true)
    assert.equal(await idle.count(), 0)
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    assert.equal(await idle.count(), 0)
    page.once('dialog', (confirmation) => confirmation.accept())
    await page.getByRole('button', { name: 'Transkript löschen', exact: true }).click()
    await idle.waitFor()
    assert.equal(await page.locator('.segment').count(), 0)
    assert.equal(await page.locator('.live-badge time').innerText(), '00:00')
  } finally { await page.close() }
})

test('Debug dock starts hidden, opens upward within half the workspace, and clears without collapsing', async () => {
  const logs = Array.from({ length: 70 }, (_, index) => ({ id: `log-${index}`, timestampIso: new Date().toISOString(), source: 'ipc',
    level: index < 2 ? 'error' : 'info', message: `Log ${index}: Status und Details` }))
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig }, debugLog: logs })
  try {
    await emitSegments(page)
    assert.equal(await page.locator('.console-debug').count(), 0)
    await toggleDebug(page)
    await page.locator('.debug-log-entry').nth(69).waitFor()
    assert.equal(await page.locator('.debug-summary .count-pill').innerText(), '2 Fehler')
    assert.equal(await page.locator('.console-debug.has-errors').count(), 1)
    const colors = await page.locator('.debug-log-message').evaluateAll(elements => elements.map(element => getComputedStyle(element).color))
    assert.notEqual(colors[0], colors[2])
    await page.evaluate(() => window.emitDebugLog({ id: 'new-info', timestampIso: new Date().toISOString(), source: 'ipc', level: 'info', message: 'Normaler Eintrag' }))
    await page.getByText('Normaler Eintrag', { exact: true }).waitFor()
    assert.equal(await page.getByText('Normaler Eintrag', { exact: true }).evaluate(element => getComputedStyle(element).color), colors[2])
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
    await page.getByRole('button', { name: 'Log löschen', exact: true }).click()
    await page.waitForFunction(() => !!window.lastClearLogCalled)
    await page.locator('.debug-content .empty').waitFor()
    assert.equal(await page.locator('.debug-summary .count-pill').innerText(), '0 Fehler')
    await page.getByRole('button', { name: 'Debug-Log schließen', exact: true }).click()
    await toggleDebug(page)
    assert.equal(await page.locator('.console-debug').count(), 0)
    await toggleDebug(page)
    assert.equal(await page.locator('.debug-content').count(), 0)
    await page.getByRole('button', { name: 'Debug-Log öffnen', exact: true }).click()
    await page.evaluate(() => window.emitDebugLog({ id: 'new-error', timestampIso: new Date().toISOString(), source: 'sidecar', level: 'error', message: 'Fehlermeldung' }))
    await page.waitForFunction(() => document.querySelector('.debug-summary .count-pill')?.textContent === '1 Fehler')
    assert.equal(await page.locator('.debug-log-entry.error').innerText().then((value) => value.includes('Fehlermeldung')), true)
  } finally { await page.close() }
})

test('Follow appears only after manual scrolling and resumes automatic following', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await page.setViewportSize({ width: 800, height: 420 })
    await emitSegments(page, 80)
    const list = page.locator('.transcript-list')
    await page.waitForFunction(() => { const list = document.querySelector('.transcript-list'); return list.scrollHeight - list.scrollTop - list.clientHeight <= 1 })
    assert.equal(await page.getByRole('button', { name: 'Folgen', exact: true }).count(), 0)
    await list.evaluate((element) => { element.scrollTop = 100 })
    await page.getByRole('button', { name: 'Folgen', exact: true }).waitFor()
    const scrollTop = await list.evaluate((element) => element.scrollTop)
    await page.evaluate(() => window.emitSegment({ id: 'after-scroll', sessionId: 'console-session', source: 'mic', speaker: 'Guest-2', text: 'Neuer Eintrag', state: 'final', timestampIso: new Date().toISOString() }))
    await page.locator('.segment').nth(80).waitFor()
    assert.equal(await list.evaluate((element) => element.scrollTop), scrollTop)
    await page.getByRole('button', { name: 'Folgen', exact: true }).click()
    await page.waitForFunction(() => { const list = document.querySelector('.transcript-list'); return list.scrollHeight - list.scrollTop - list.clientHeight <= 1 })
    assert.equal(await page.getByRole('button', { name: 'Folgen', exact: true }).count(), 0)
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
    await page.getByRole('button', { name: 'Weiter', exact: true }).click()
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

test('settings tabs preserve input focus, support keyboard selection and trap focus in the active panel', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig } })
  try {
    await page.getByRole('button', { name: 'Einstellungsdialog öffnen' }).click()
    const dialog = page.getByRole('dialog', { name: 'Einstellungen', exact: true })
    await dialog.getByRole('tab', { name: 'Allgemein', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    assert.equal(await dialog.getByRole('tab', { name: 'Azure-Konfiguration', exact: true }).getAttribute('aria-selected'), 'true')
    const tab = dialog.getByRole('tab', { name: 'Azure-Konfiguration', exact: true })
    assert.equal(await tab.evaluate((element) => getComputedStyle(element).outlineStyle), 'none')
    const endpoint = dialog.getByRole('textbox', { name: 'Endpoint', exact: true })
    await endpoint.fill('https://changed.test')
    assert.deepEqual(await tab.evaluate((element) => {
      const style = getComputedStyle(element)
      return [style.borderLeftWidth, style.borderRightWidth, style.outlineStyle]
    }), ['0px', '0px', 'none'])
    assert.equal(await endpoint.evaluate((element) => element === document.activeElement), true)
    const before = await dialog.boundingBox()
    await dialog.getByRole('tab', { name: 'Azure-Konfiguration', exact: true }).focus()
    await page.keyboard.press('End')
    assert.equal(await dialog.getByRole('tab', { name: 'Proxy', exact: true }).getAttribute('aria-selected'), 'true')
    assert.deepEqual(await dialog.boundingBox(), before)
    await page.keyboard.press('Home')
    assert.equal(await dialog.getByRole('tab', { name: 'Allgemein', exact: true }).getAttribute('aria-selected'), 'true')
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).focus()
    await page.keyboard.press('Tab')
    assert.equal(await dialog.getByRole('button', { name: 'Dialog schließen', exact: true }).evaluate((element) => element === document.activeElement), true)
    await page.keyboard.press('Shift+Tab')
    assert.equal(await dialog.getByRole('button', { name: 'Speichern', exact: true }).evaluate((element) => element === document.activeElement), true)
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('dialog').count(), 0)
    await page.getByRole('button', { name: 'Einstellungsdialog öffnen' }).click()
    await page.getByRole('tab', { name: 'Azure-Konfiguration', exact: true }).click()
    assert.equal(await page.getByRole('textbox', { name: 'Endpoint', exact: true }).inputValue(), 'https://changed.test')
  } finally { await page.close() }
})

test('failed Stop surfaces details and leaves recording and reset protection intact', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig }, running: true, stopError: 'Sidecar antwortet nicht' })
  try {
    await emitSegments(page)
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await page.locator('.toast-error').waitFor()
    assert.match(await page.locator('.toast-error').innerText(), /UI_STOP_FAILED: Sidecar antwortet nicht/)
    assert.equal(await page.getByRole('button', { name: 'Transkript löschen', exact: true }).isDisabled(), true)
    assert.equal(await page.locator('.segment').count(), 2)
  } finally { await page.close() }
})

test('a crashed sidecar surfaces a persistent error toast and allows a new recording', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig }, running: true })
  try {
    await page.getByRole('button', { name: 'Stop', exact: true }).waitFor()
    await emitSegments(page)
    assert.equal(await page.locator('.toast').count(), 0)

    await page.evaluate(() => window.emitCrashed({ exitCode: 1, lastError: 'Azure-Start fehlgeschlagen' }))
    const toast = page.locator('.toast')
    await toast.waitFor()
    assert.match(await toast.innerText(), /Sidecar abgestuerzt/)
    assert.match(await toast.innerText(), /Exit-Code 1/)
    assert.equal(await toast.getAttribute('role'), 'alert')
    await page.evaluate(() => window.emitStatus({ running: false, paused: false }))
    await page.waitForTimeout(150)
    assert.equal(await page.locator('.toast').count(), 1)
    assert.match(await toast.innerText(), /Sidecar abgestuerzt/)
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
