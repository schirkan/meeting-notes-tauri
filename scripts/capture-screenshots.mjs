#!/usr/bin/env node
/**
 * Erzeugt Screenshots der Meeting-Notes-Oberflaeche fuer die README.
 *
 * Hintergrund: Die Anwendung ist ein Tauri-Desktop-Fenster. Auf einem
 * Build-Host ohne interaktive Windows-Desktop-Sitzung laesst sich dieses
 * Fenster nicht fotografieren (das ist auch der Grund, warum die native
 * Tray-Probe dort SKIPPED meldet). Deshalb rendert dieses Skript den
 * echten Renderer (React/CSS aus src/renderer) headless ueber den
 * Vite-Dev-Server und ersetzt ausschliesslich die Tauri-Bridge
 * (window.transcriptApi) durch eine Attrappe mit realistischen Daten.
 *
 * Belegt: Layout, Texte, Dialoge, Zustaende, Farben.
 * Nicht belegt: natives Fensterrahmens, Tray-Icon, WebView2, Aufnahme-Pipeline.
 *
 * Diese Datei ist bewusst reines ASCII: die Umlaute in den deutschen
 * Oberflaechentexten werden per \u-Escape geschrieben. Damit kann die Datei
 * nicht durch eine falsche Console-Kodierung zerstoert werden.
 *
 * Aufruf: npm run screenshots
 */

import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..')
const OUTPUT_DIR = join(PROJECT_ROOT, 'docs', 'renderer')
const VIEWPORT = { width: 1280, height: 860 }

// Deutsche Oberflaechentexte als Unicode-Escapes (ASCII-sichere Datei).
const TXT = {
  openSettings: 'Einstellungsdialog \u00f6ffnen',
  settingsDialog: 'Einstellungen',
  tabAzure: 'Azure-Konfiguration',
  tabProxy: 'Proxy',
  tabGeneral: 'Allgemein',
  testConnection: 'Verbindung testen',
  connectivityDialog: 'Verbindungstest',
  debugLog: 'Debug-Log'
}

const validConfig = {
  endpoint: 'https://example.test',
  region: 'westeurope',
  speechKey: 'test-key',
  interimResults: true
}

const userSettings = {
  language: 'de-DE',
  transcription: { mic: true, speaker: true },
  diarization: { mic: true, speaker: true },
  devices: { micId: 'mic-demo', speakerLoopbackId: 'speaker-demo' },
  transcript: { markdownExport: { enabled: true, path: null } },
  autoStart: { enabled: true, processes: [] },
  window: { minimizeToTrayOnClose: true }
}

const devices = {
  inputs: [
    { id: 'mic-demo', name: 'Demo-Mikrofon (Windows-Audiogeraet)', flow: 'input', isDefault: true },
    { id: 'mic-two', name: 'Zweites Demo-Mikrofon', flow: 'input', isDefault: false }
  ],
  outputs: [
    { id: 'speaker-demo', name: 'Demo-Lautsprecher (Windows-Audiogeraet)', flow: 'output', isDefault: true },
    { id: 'speaker-two', name: 'Demo-Kopfhoerer', flow: 'output', isDefault: false }
  ],
  fetchedAtIso: new Date(2026, 10, 18, 9, 12, 3).toISOString()
}

const debugLog = [
  { id: 'd1', timestampIso: new Date(2026, 10, 18, 9, 12, 1).toISOString(), source: 'main', level: 'info', message: 'Meeting Notes initialisiert.' },
  { id: 'd2', timestampIso: new Date(2026, 10, 18, 9, 12, 2).toISOString(), source: 'main', level: 'info', message: 'Meeting-Erkennung gestartet (Audio-Session-Graph).' },
  { id: 'd3', timestampIso: new Date(2026, 10, 18, 9, 12, 3).toISOString(), source: 'sidecar', level: 'info', message: 'recorder_mode: engine (16 kHz, 16 bit, mono)' },
  { id: 'd4', timestampIso: new Date(2026, 10, 18, 9, 12, 4).toISOString(), source: 'status', level: 'info', message: 'Status geaendert: running.' },
  { id: 'd5', timestampIso: new Date(2026, 10, 18, 9, 12, 5).toISOString(), source: 'ipc', level: 'warn', message: 'Konfiguration nicht lesbar: Berechtigung verweigert' }
]

const connectivityResult = {
  probeUrl: 'https://example.test/speech',
  reachable: true,
  httpsReachable: true,
  speechReachable: true,
  httpStatus: 200,
  httpStatusText: 'OK',
  latencyMs: 143,
  steps: [
    { step: 'DNS-Aufloesung', status: 'ok', detail: 'example.test -> 203.0.113.10' },
    { step: 'TCP-Verbindung', status: 'ok', detail: 'Port 443 erreichbar (24 ms)' },
    { step: 'HTTPS-Handshake', status: 'ok', detail: 'TLS 1.3, Zertifikat gegen Systemvertrauen geprueft' },
    { step: 'Speech/WSS', status: 'ok', detail: 'ConversationTranscriber verbunden' }
  ],
  testedAtIso: new Date(2026, 10, 18, 9, 12, 6).toISOString()
}

// Dummy-Transkript: zwei Sprecher, Mic und Speaker, ein laufendes Interim.
function dummySegments() {
  const at = (second) => new Date(2026, 10, 18, 9, 13, second).toISOString()
  return [
    { id: 's1', sessionId: 'demo-session', source: 'mic', speaker: 'Guest-1', language: 'de-DE', timestampIso: at(1), text: 'Guten Morgen zusammen, wir schauen uns heute den Stand des Transkripts an.', state: 'final' },
    { id: 's2', sessionId: 'demo-session', source: 'speaker', speaker: 'Guest-2', language: 'de-DE', timestampIso: at(6), text: 'Danke. Der Abruf aus dem System-Ton liefert bereits brauchbare Saetze.', state: 'final' },
    { id: 's3', sessionId: 'demo-session', source: 'mic', speaker: 'Guest-1', language: 'de-DE', timestampIso: at(11), text: 'Die Sprechertrennung ordnet Mic und System-Ausgabe getrennt zu.', state: 'final' },
    { id: 's4', sessionId: 'demo-session', source: 'speaker', speaker: 'Guest-2', language: 'de-DE', timestampIso: at(16), text: 'Dann exportieren wir am Ende als Markdown mit Frontmatter.', state: 'final' },
    { id: 's5', sessionId: 'demo-session', source: 'mic', speaker: 'Guest-1', language: 'de-DE', timestampIso: at(21), text: 'Genau, mit Zeitstempeln und Sprechernamen.', state: 'final' },
    { id: 's6', sessionId: 'demo-session', source: 'speaker', speaker: 'Guest-2', language: 'de-DE', timestampIso: at(24), text: 'Ich notiere noch die offenen Punkte fuer das naechste', state: 'interim' }
  ]
}

async function openApp(browser, baseUrl, options = {}) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 })
  await page.route(/\/preload\/index\.ts(?:\?.*)?$/, (route) => route.fulfill({
    contentType: 'application/javascript',
    body: ''
  }))
  await page.addInitScript((input) => {
    const noSubscription = () => () => {}
    let currentStatus = {
      running: input.running ?? false,
      paused: false,
      startedAt: input.startedAt
    }
    window.transcriptApi = {
      getStatus: async () => currentStatus,
      start: async () => { currentStatus = { ...currentStatus, running: true, startedAt: new Date().toISOString() }; return currentStatus },
      stop: async () => { currentStatus = { running: false, paused: false }; return currentStatus },
      pause: async () => { currentStatus = { ...currentStatus, running: true, paused: true }; return currentStatus },
      resume: async () => { currentStatus = { ...currentStatus, running: true, paused: false }; return currentStatus },
      getSettings: async () => input.settings,
      saveSettings: async (settings) => settings,
      getDevices: async () => input.devices,
      getDebugLog: async () => input.debugLog,
      clearDebugLog: async () => ({ cleared: input.debugLog.length }),
      getConfig: async () => ({ exists: true, path: 'C:\\Program Files\\Meeting Notes\\MeetingNotes.config.json', config: input.config }),
      saveConfig: async (config) => ({ exists: true, path: 'demo', config }),
      saveTranscriptMarkdown: async () => 'C:\\Notes\\transcript-2026-11-18-09-13-00.md',
      selectTranscriptDirectory: async () => 'C:\\Notes',
      testAzureConnectivity: async () => input.connectivityResult,
      copyTranscript: async () => {},
      onSegment: (callback) => { window.emitSegment = callback; return () => { delete window.emitSegment } },
      onError: noSubscription,
      onStatus: (callback) => { window.emitStatus = (value) => { currentStatus = value; callback(value) }; return () => { delete window.emitStatus } },
      onDebugLog: (callback) => { window.emitDebugLog = (value) => callback(value); return () => { delete window.emitDebugLog } },
      onMeetingDetected: (callback) => { window.emitMeetingDetected = callback; return () => { delete window.emitMeetingDetected } }
    }
    window.transcriptSidecar = { onCrashed: noSubscription }
  }, {
    running: options.running ?? false,
    startedAt: options.startedAt,
    settings: userSettings,
    devices,
    debugLog,
    config: validConfig,
    connectivityResult
  })
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => typeof window.emitSegment === 'function')
  return page
}

async function emitDummyTranscript(page) {
  for (const segment of dummySegments()) {
    await page.evaluate((value) => window.emitSegment(value), segment)
  }
  await page.waitForSelector('.segment')
}

const failures = []

async function capture(page, file, description) {
  try {
    await page.screenshot({ path: join(OUTPUT_DIR, file) })
    console.log('  ok  ' + file + '  ' + description)
  } catch (error) {
    failures.push(file + ': ' + error.message)
    console.log('  FEHLER  ' + file + '  ' + error.message)
  }
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  const server = await createServer({
    configFile: join(PROJECT_ROOT, 'vite.config.ts'),
    server: { host: '127.0.0.1', port: 0, hmr: false, open: false }
  })
  await server.listen()
  const baseUrl = 'http://127.0.0.1:' + server.httpServer.address().port + '/'
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  console.log('Renderer-Screenshots -> ' + OUTPUT_DIR)

  try {
    let page = await openApp(browser, baseUrl)
    await page.waitForSelector('.idle-audio-panel')
    await capture(page, '01-startbildschirm.png', 'Startbildschirm mit Audio-Einstellungen')
    await page.close()

    page = await openApp(browser, baseUrl, { running: true, startedAt: new Date(2026, 10, 18, 9, 13, 0).toISOString() })
    await emitDummyTranscript(page)
    await page.waitForTimeout(400)
    await capture(page, '02-aufnahme-transkript.png', 'Laufende Aufnahme mit Transkript und Sprechern')
    await page.close()

    page = await openApp(browser, baseUrl)
    await page.getByRole('button', { name: TXT.openSettings }).click()
    await page.getByRole('dialog', { name: TXT.settingsDialog, exact: true }).waitFor()
    await capture(page, '03-einstellungen-allgemein.png', 'Einstellungen - Allgemein')
    await page.close()

    page = await openApp(browser, baseUrl)
    await page.getByRole('button', { name: TXT.openSettings }).click()
    const azureDialog = page.getByRole('dialog', { name: TXT.settingsDialog, exact: true })
    await azureDialog.waitFor()
    await azureDialog.getByRole('tab', { name: TXT.tabAzure, exact: true }).click()
    await capture(page, '04-einstellungen-azure.png', 'Einstellungen - Azure-Konfiguration')
    await page.close()

    page = await openApp(browser, baseUrl)
    await page.getByRole('button', { name: TXT.openSettings }).click()
    const proxyDialog = page.getByRole('dialog', { name: TXT.settingsDialog, exact: true })
    await proxyDialog.waitFor()
    await proxyDialog.getByRole('tab', { name: TXT.tabProxy, exact: true }).click()
    await capture(page, '05-einstellungen-proxy.png', 'Einstellungen - Proxy')
    await page.close()

    page = await openApp(browser, baseUrl)
    await page.getByRole('button', { name: TXT.openSettings }).click()
    const testDialog = page.getByRole('dialog', { name: TXT.settingsDialog, exact: true })
    await testDialog.waitFor()
    await testDialog.getByRole('tab', { name: TXT.tabAzure, exact: true }).click()
    await testDialog.getByRole('button', { name: TXT.testConnection, exact: true }).click()
    await page.getByRole('dialog', { name: TXT.connectivityDialog, exact: true }).waitFor()
    await page.waitForTimeout(300)
    await capture(page, '06-verbindungstest.png', 'Diagnose-Dialog Verbindungstest')
    await page.close()

    page = await openApp(browser, baseUrl, { running: true, startedAt: new Date(2026, 10, 18, 9, 13, 0).toISOString() })
    await emitDummyTranscript(page)
    await page.locator('.utility-actions button[aria-controls="console-speakers"]').click()
    await page.waitForSelector('#console-speakers:not([hidden])')
    await page.waitForTimeout(300)
    await capture(page, '07-sprecherzuordnung.png', 'Sprecherzuordnung im Inspector')
    await page.close()

    page = await openApp(browser, baseUrl)
    await page.locator('.overflow-menu > summary').click()
    await page.getByRole('button', { name: TXT.debugLog, exact: true }).click()
    await page.waitForSelector('.console-debug')
    await page.waitForTimeout(400)
    await capture(page, '08-debug-log.png', 'Debug-Log-Dock')
    await page.close()
  } finally {
    await browser.close()
    await server.close()
  }

  console.log('Fertig. Die Renderer-Screenshots liegen in docs/renderer.')
  if (failures.length > 0) {
    console.error('Fehlgeschlagene Aufnahmen: ' + failures.join(' | '))
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
