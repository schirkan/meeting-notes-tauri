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
 * Diese Datei ist bewusst reines ASCII: englische UI-Texte und Demo-Daten
 * vermeiden Console-Kodierungsprobleme. Die UI-Sprache ist unabhaengig von
 * der gewaehlten Transkriptionssprache.
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

// Englische Oberflaechentexte (ASCII-sichere Datei).
const TXT = {
  openSettings: 'Open settings dialog',
  settingsDialog: 'Settings',
  tabAzure: 'Azure',
  tabTranscription: 'Transcription',
  tabProxy: 'Proxy',
  tabGeneral: 'General',
  testConnection: 'Test connection',
  connectivityDialog: 'Connection test',
  debugLog: 'Debug log'
}

const validConfig = {
  endpoint: 'https://example.test',
  region: 'westeurope',
  speechKey: 'test-key',
  interimResults: true
}

const userSettings = {
  language: 'en-US',
  transcription: { mic: true, speaker: true },
  diarization: { mic: true, speaker: true },
  devices: { micId: 'mic-demo', speakerLoopbackId: 'speaker-demo' },
  transcript: { markdownExport: { enabled: true, path: null } },
  autoStart: { enabled: true, autoStop: true, processes: [] },
  window: { minimizeToTrayOnClose: true }
}

const devices = {
  inputs: [
    { id: 'mic-demo', name: 'Demo microphone (Windows audio device)', flow: 'input', isDefault: true },
    { id: 'mic-two', name: 'Second demo microphone', flow: 'input', isDefault: false }
  ],
  outputs: [
    { id: 'speaker-demo', name: 'Demo speaker (Windows audio device)', flow: 'output', isDefault: true },
    { id: 'speaker-two', name: 'Demo headphones', flow: 'output', isDefault: false }
  ],
  fetchedAtIso: new Date(2026, 10, 18, 9, 12, 3).toISOString()
}

const debugLog = [
  { id: 'd1', timestampIso: new Date(2026, 10, 18, 9, 12, 1).toISOString(), source: 'main', level: 'info', message: 'Meeting Notes initialized.' },
  { id: 'd2', timestampIso: new Date(2026, 10, 18, 9, 12, 2).toISOString(), source: 'main', level: 'info', message: 'Meeting detection started (audio session graph).' },
  { id: 'd3', timestampIso: new Date(2026, 10, 18, 9, 12, 3).toISOString(), source: 'sidecar', level: 'info', message: 'recorder_mode: engine (16 kHz, 16 bit, mono)' },
  { id: 'd4', timestampIso: new Date(2026, 10, 18, 9, 12, 4).toISOString(), source: 'status', level: 'info', message: 'Status changed: running.' },
  { id: 'd5', timestampIso: new Date(2026, 10, 18, 9, 12, 5).toISOString(), source: 'ipc', level: 'warn', message: 'Configuration not readable: permission denied' }
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
    { step: 'DNS resolution', status: 'ok', detail: 'example.test -> 203.0.113.10' },
    { step: 'TCP connection', status: 'ok', detail: 'Port 443 reachable (24 ms)' },
    { step: 'HTTPS handshake', status: 'ok', detail: 'TLS 1.3, certificate checked against the system trust store' },
    { step: 'Speech/WSS', status: 'ok', detail: 'ConversationTranscriber connected' }
  ],
  testedAtIso: new Date(2026, 10, 18, 9, 12, 6).toISOString()
}

// Dummy-Transkript: zwei Sprecher, Mic und Speaker, ein laufendes Interim.
function dummySegments() {
  const at = (second) => new Date(2026, 10, 18, 9, 13, second).toISOString()
  return [
    { id: 's1', sessionId: 'demo-session', source: 'mic', speaker: 'Guest-1', language: 'en-US', timestampIso: at(1), text: 'Good morning, everyone. Today we are reviewing the transcript.', state: 'final' },
    { id: 's2', sessionId: 'demo-session', source: 'speaker', speaker: 'Guest-2', language: 'en-US', timestampIso: at(6), text: 'Thank you. System audio capture is already producing useful sentences.', state: 'final' },
    { id: 's3', sessionId: 'demo-session', source: 'mic', speaker: 'Guest-1', language: 'en-US', timestampIso: at(11), text: 'Speaker separation assigns the mic and the system output separately.', state: 'final' },
    { id: 's4', sessionId: 'demo-session', source: 'speaker', speaker: 'Guest-2', language: 'en-US', timestampIso: at(16), text: 'Then we will export Markdown with frontmatter when we finish.', state: 'final' },
    { id: 's5', sessionId: 'demo-session', source: 'mic', speaker: 'Guest-1', language: 'en-US', timestampIso: at(21), text: 'Exactly, with timestamps and speaker names.', state: 'final' },
    { id: 's6', sessionId: 'demo-session', source: 'speaker', speaker: 'Guest-2', language: 'en-US', timestampIso: at(24), text: 'I am noting the open questions for the next', state: 'interim' }
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
      reset: async () => {},
      onQuitExport: noSubscription,
      completeQuitExport: async () => {},
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

// Scrollt den Dialog-Inhalt ans Ende. Der Dialog ist nach dem Umbau kompakt:
// mehrere Abschnitte passen in ein Bild, deshalb zwei Zustaende statt vier.
async function scrollDialogToBottom(page) {
  await page.getByRole('dialog', { name: TXT.settingsDialog, exact: true }).evaluate((dialog) => {
    const grid = dialog.querySelector('.settings-dialog-grid')
    if (grid) grid.scrollTop = grid.scrollHeight
  })
  await page.waitForTimeout(400)
}

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
    await capture(page, '01-start-screen.png', 'Start screen with the audio settings')
    await page.close()

    page = await openApp(browser, baseUrl, { running: true, startedAt: new Date(Date.now() - 83000).toISOString() })
    await emitDummyTranscript(page)
    await page.waitForTimeout(400)
    await capture(page, '02-recording-transcript.png', 'Running recording with transcript and speakers')
    await page.close()

    page = await openApp(browser, baseUrl)
    await page.getByRole('button', { name: TXT.openSettings }).click()
    await page.getByRole('dialog', { name: TXT.settingsDialog, exact: true }).waitFor()
    await capture(page, '03-settings-top.png', 'Settings - General, Transcription, Azure')
    await page.close()

    page = await openApp(browser, baseUrl)
    await page.getByRole('button', { name: TXT.openSettings }).click()
    const settingsDialog = page.getByRole('dialog', { name: TXT.settingsDialog, exact: true })
    await settingsDialog.waitFor()
    await scrollDialogToBottom(page)
    await capture(page, '04-settings-bottom.png', 'Settings - Azure and Proxy')
    await page.close()

    page = await openApp(browser, baseUrl)
    await page.getByRole('button', { name: TXT.openSettings }).click()
    const testDialog = page.getByRole('dialog', { name: TXT.settingsDialog, exact: true })
    await testDialog.waitFor()
    await page.waitForTimeout(500)
    await testDialog.getByRole('button', { name: TXT.testConnection, exact: true }).click()
    await page.getByRole('dialog', { name: TXT.connectivityDialog, exact: true }).waitFor()
    await page.waitForTimeout(300)
    await capture(page, '05-connection-test.png', 'Connection test diagnostics dialog')
    await page.close()

    page = await openApp(browser, baseUrl, { running: true, startedAt: new Date(Date.now() - 83000).toISOString() })
    await emitDummyTranscript(page)
    await page.locator('.utility-actions button[aria-controls="console-speakers"]').click()
    await page.waitForSelector('#console-speakers:not([hidden])')
    await page.waitForTimeout(300)
    await capture(page, '06-speaker-mapping.png', 'Speaker mapping in the inspector')
    await page.close()

    page = await openApp(browser, baseUrl)
    await page.locator('.overflow-menu > summary').click()
    await page.getByRole('button', { name: TXT.debugLog, exact: true }).click()
    await page.waitForSelector('.console-debug')
    await page.waitForTimeout(400)
    await capture(page, '07-debug-log.png', 'Debug log dock')
    await page.close()

    page = await openApp(browser, baseUrl)
    await page.locator('.overflow-menu > summary').click()
    await page.getByRole('button', { name: 'About', exact: true }).click()
    await page.getByRole('dialog', { name: 'About', exact: true }).waitFor()
    await page.waitForTimeout(400)
    await capture(page, '08-about-dialog.png', 'About-Dialog')
    await page.close()
  } finally {
    await browser.close()
    await server.close()
  }

  console.log('Fertig. Die Renderer-Screenshots liegen in docs/renderer.')
  if (failures.length > 0) {
    console.error('Failed captures: ' + failures.join(' | '))
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
