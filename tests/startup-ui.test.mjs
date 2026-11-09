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
    window.transcriptApi = {
      getStatus: async () => ({ running: input.running ?? false }),
      getSettings: async () => ({ language: input.language ?? 'de-DE', devices: {} }),
      saveSettings: async (settings) => {
        window.lastSavedSettings = settings
        return settings
      },
      getDevices: async () => {
        if (input.devicesError) throw new Error('Gerätetest fehlgeschlagen')
        return { inputs: [], outputs: [], fetchedAtIso: new Date(0).toISOString() }
      },
      getDebugLog: async () => [],
      getConfig: async () => {
        if (input.configError) throw new Error('Konfiguration nicht lesbar')
        return input.configState && { ...input.configState, userSettingsPath: 'test-user-settings' }
      },
      saveConfig: async (config) => {
        window.lastSavedConfig = config
        return { exists: true, path: 'test-config', userSettingsPath: 'test-user-settings', config }
      },
      testAzureConnectivity: async (payload) => {
        window.lastConnectivityPayload = payload
        if (input.connectivityError) throw input.connectivityError
        if (input.deferConnectivity) {
          return new Promise((resolve) => { window.completeConnectivity = resolve })
        }
        return input.connectivityResult
      },
      onSegment: noSubscription,
      onError: noSubscription,
      onStatus: noSubscription,
      onDebugLog: noSubscription
    }
  }, options)
  await page.goto(baseUrl)
  await page.locator('.layout-grid').waitFor()
  return page
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

test('settings separates Proxy into a third responsive column and preserves save and test payloads', async () => {
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
    assert.equal(await azure.getByLabel('Proxy verwenden').count(), 0)
    assert.equal(await proxy.getByRole('button', { name: 'Verbindung testen', exact: true }).count(), 0)
    assert.equal(await azure.getByRole('button', { name: 'Verbindung testen', exact: true }).count(), 1)
    assert.equal(await panels.locator('.meta-path').count(), 0)
    const footer = dialog.locator('.settings-dialog-footer')
    assert.deepEqual(await footer.locator('.meta-path').allTextContents(), [
      'Azure-Konfiguration: test-config',
      'Allgemeine Einstellungen: test-user-settings'
    ])
    assert.equal(await dialog.locator('.settings-dialog-grid .settings-dialog-footer').count(), 0)
    assert.equal(await proxy.getByLabel('Proxy Host', { exact: true }).isDisabled(), true)
    await proxy.getByLabel('Proxy verwenden').check()
    await proxy.getByLabel('Proxy Host', { exact: true }).fill('proxy.test')
    await proxy.getByLabel('Proxy Port', { exact: true }).fill('8080')
    await proxy.getByLabel('Proxy Benutzername (optional)', { exact: true }).fill('test-user')
    await proxy.getByLabel('Proxy Passwort (optional)', { exact: true }).fill('test-password')
    const proxyConfig = { host: 'proxy.test', port: 8080, username: 'test-user', password: 'test-password' }
    await azure.getByRole('button', { name: 'Azure-Konfiguration speichern', exact: true }).click()
    await page.waitForFunction(() => !!window.lastSavedConfig)
    assert.deepEqual(await page.evaluate(() => window.lastSavedConfig), { ...validConfig, proxy: proxyConfig })
    const desktopBoxes = await Promise.all([0, 1, 2].map((index) => panels.nth(index).boundingBox()))
    assert.ok(desktopBoxes[0].x < desktopBoxes[1].x && desktopBoxes[1].x < desktopBoxes[2].x)
    assert.equal(desktopBoxes[0].y, desktopBoxes[2].y)
    assert.ok((await footer.boundingBox()).y >= Math.max(...desktopBoxes.map((box) => box.y + box.height)))
    for (const width of [800, 560]) {
      await page.setViewportSize({ width, height: 860 })
      const boxes = await Promise.all([0, 1, 2].map((index) => panels.nth(index).boundingBox()))
      assert.equal(boxes[0].x, boxes[2].x)
      assert.ok(boxes[0].y < boxes[1].y && boxes[1].y < boxes[2].y)
      assert.ok((await footer.boundingBox()).y >= boxes[2].y + boxes[2].height)
      assert.equal(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth), true)
    }
    await azure.getByRole('button', { name: 'Verbindung testen', exact: true }).click()
    await page.getByRole('dialog', { name: 'Verbindungstest', exact: true }).locator('tbody tr').waitFor()
    assert.deepEqual(await page.evaluate(() => window.lastConnectivityPayload), { ...validConfig, proxy: proxyConfig, language: 'de-DE' })
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
    await page.getByRole('button', { name: 'Einstellungen speichern', exact: true }).click()
    await page.waitForFunction(() => window.lastSavedSettings?.language === 'en-US')
    await page.getByRole('button', { name: 'Verbindung testen', exact: true }).click()
    await page.getByRole('dialog', { name: 'Verbindungstest', exact: true }).waitFor()
    assert.equal((await page.evaluate(() => window.lastConnectivityPayload)).language, 'en-US')
  } finally {
    await page.close()
  }
})

test('language dropdown preserves a configured language outside the default options', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig }, language: 'fr-CA' })
  try {
    await page.getByRole('button', { name: 'Einstellungsdialog öffnen' }).click()
    assert.equal(await page.getByRole('combobox', { name: 'Sprache', exact: true }).inputValue(), 'fr-CA')
    await page.getByRole('button', { name: 'Einstellungen speichern', exact: true }).click()
    await page.waitForFunction(() => window.lastSavedSettings?.language === 'fr-CA')
  } finally {
    await page.close()
  }
})

test('language dropdown remains disabled during recording', async () => {
  const page = await openApp({ configState: { exists: true, path: 'test-config', config: validConfig }, running: true })
  try {
    await page.getByRole('button', { name: 'Einstellungsdialog öffnen' }).click()
    assert.equal(await page.getByRole('combobox', { name: 'Sprache', exact: true }).isDisabled(), true)
  } finally {
    await page.close()
  }
})

test('saving a complete configuration replaces the warning and enables recording', async () => {
  const page = await openApp({ configState: { exists: false, path: 'test-config', config: null } })
  try {
    await page.getByRole('dialog', { name: 'Einstellungen' }).waitFor()
    await page.getByRole('textbox', { name: 'Endpoint', exact: true }).fill(validConfig.endpoint)
    await page.getByRole('textbox', { name: 'Region', exact: true }).fill(validConfig.region)
    await page.getByLabel('Speech Key', { exact: true }).fill(validConfig.speechKey)
    await page.getByRole('button', { name: 'Azure-Konfiguration speichern', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.toast-info')?.textContent.includes('Azure-Konfiguration gespeichert.'))
    await page.getByRole('button', { name: 'Dialog schließen', exact: true }).click()
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
    await page.getByRole('button', { name: 'Verbindung testen', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Verbindungstest', exact: true })
    await dialog.waitFor()
    assert.match(await dialog.innerText(), /Verbindungstest läuft/)
    const gridBox = await dialog.locator('.settings-dialog-grid').boundingBox()
    const contentBox = await dialog.locator('.connectivity-dialog-content').boundingBox()
    assert.ok(Math.abs(contentBox.width - gridBox.width) < 1)
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
      const grid = await dialog.locator('.settings-dialog-grid').boundingBox()
      const content = await dialog.locator('.connectivity-dialog-content').boundingBox()
      const table = await dialog.locator('.connectivity-step-table').boundingBox()
      assert.ok(Math.abs(content.width - grid.width) < 1, `Content should fill the dialog at ${width}px`)
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
