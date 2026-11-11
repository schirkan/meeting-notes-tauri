import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_USER_SETTINGS, normalizeUserSettings, type AppConfigState } from '@shared/config-contract'
import { buildTranscriptMarkdown } from '@shared/transcript-markdown'
import { formatSpeakerKey, getSpeakerClass, getSpeakerKey } from './speaker-utils'
import {
  type AudioDeviceSnapshot,
  type DebugLogEntry,
  type TranscriptError,
  type TranscriptSegment,
  type TranscriptStatus
} from '@shared/transcript-contract'
import { type ConfigDraft, draftToConfig, isConfigComplete, toConfigDraft } from './config-utils'
import type { ConnectivityResult } from './components/ConnectivityDialog'

function errorDetail(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message || fallback
  if (typeof error === 'string') return error.trim() || fallback
  if (error != null) {
    try {
      return JSON.stringify(error) || fallback
    } catch {
      return fallback
    }
  }
  return fallback
}

type ToastState = {
  message: string
  variant: 'info' | 'error'
  persistent: boolean
}

const initialStatus: TranscriptStatus = {
  running: false
}

const initialDevices: AudioDeviceSnapshot = {
  inputs: [],
  outputs: [],
  fetchedAtIso: new Date(0).toISOString()
}

export function useAppState() {
  const [status, setStatus] = useState<TranscriptStatus>(initialStatus)
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [lastError, setLastError] = useState<TranscriptError | null>(null)
  const [runtimeIssue, setRuntimeIssue] = useState<string | null>(null)
  const [settings, setSettings] = useState(DEFAULT_USER_SETTINGS)
  const [devices, setDevices] = useState<AudioDeviceSnapshot>(initialDevices)
  const [debugLog, setDebugLog] = useState<DebugLogEntry[]>([])
  const [settingsHint, setSettingsHint] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const [debugOpen, setDebugOpen] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [configState, setConfigState] = useState<AppConfigState | null>(null)
  const [configDraft, setConfigDraft] = useState<ConfigDraft>(() => toConfigDraft(null))
  const [speakerAliases, setSpeakerAliases] = useState<Record<string, string>>({})
  const [now, setNow] = useState(() => Date.now())
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null)
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)
  const transcriptListRef = useRef<HTMLUListElement | null>(null)

  useEffect(() => {
    const transcriptApi = window.transcriptApi

    if (!transcriptApi) {
      setRuntimeIssue('IPC-Bridge nicht verfügbar. Prüfe Preload/Dev-Start.')
      setToast({
        message: 'IPC-Bridge nicht verfügbar. Prüfe Preload/Dev-Start.',
        variant: 'error',
        persistent: true
      })
      return
    }

    let disposed = false

    void transcriptApi.getConfig()
      .then((nextConfig) => {
        if (disposed) return
        setConfigState(nextConfig)
        setConfigDraft(toConfigDraft(nextConfig.config))
        if (!nextConfig.exists || !isConfigComplete(nextConfig.config)) {
          setSettingsDialogOpen(true)
          setToast({
            message: 'Azure-Konfiguration fehlt oder ist unvollständig. Bitte in den Einstellungen ergänzen und speichern.',
            variant: 'error',
            persistent: true
          })
        }
      })
      .catch(() => {
        if (disposed) return
        setSettingsDialogOpen(true)
        setToast({
          message: 'Azure-Konfiguration konnte nicht geladen werden. Bitte in den Einstellungen prüfen und speichern.',
          variant: 'error',
          persistent: true
        })
      })

    void Promise.all([
      transcriptApi.getStatus(),
      transcriptApi.getSettings(),
      transcriptApi.getDevices(),
      transcriptApi.getDebugLog()
    ])
      .then(([nextStatus, nextSettings, nextDevices, nextDebugLog]) => {
        if (disposed) return
        setStatus(nextStatus)
        setSessionStartedAt(nextStatus.startedAt ?? null)
        setSettings(normalizeUserSettings(nextSettings))
        setDevices(nextDevices)
        setDebugLog(nextDebugLog)
      })
      .catch((error) => {
        if (disposed) return
        const message = error instanceof Error ? error.message : 'Initialdaten konnten nicht geladen werden.'
        setRuntimeIssue(message)
        setToast({ message, variant: 'error', persistent: true })
      })

    const unsubSegment = transcriptApi.onSegment((segment) => {
      setSegments((prev) => {
        const sameSpeakerKey = (entry: TranscriptSegment) =>
          entry.source === segment.source && entry.speaker === segment.speaker

        const withoutInterimForSource = prev.filter(
          (entry) => !(entry.source === segment.source && entry.state === 'interim')
        )

        if (segment.state === 'final') {
          const previousFinalIndex = [...withoutInterimForSource]
            .reverse()
            .findIndex((entry) => sameSpeakerKey(entry) && entry.state === 'final')

          if (previousFinalIndex >= 0) {
            const actualIndex = withoutInterimForSource.length - 1 - previousFinalIndex
            const previousFinal = withoutInterimForSource[actualIndex]

            if (actualIndex === withoutInterimForSource.length - 1) {
              const mergedFinal: TranscriptSegment = {
                ...segment,
                id: previousFinal.id,
                text: `${previousFinal.text} ${segment.text}`.trim(),
                timestampIso: segment.timestampIso
              }

              return withoutInterimForSource
                .map((entry, index) => (index === actualIndex ? mergedFinal : entry))
                .slice(-500)
            }
          }

          return [...withoutInterimForSource, segment].slice(-500)
        }

        return [...withoutInterimForSource, segment].slice(-500)
      })
    })

    const unsubError = transcriptApi.onError((error) => {
      setLastError(error)
      setToast({
        message: `${error.code}: ${error.message}`,
        variant: 'error',
        persistent: true
      })
    })

    const unsubStatus = transcriptApi.onStatus((nextStatus) => {
      setStatus(nextStatus)
    })

    const unsubDebugLog = transcriptApi.onDebugLog((entry) => {
      setDebugLog((prev) => [entry, ...prev].slice(0, 300))
    })

    return () => {
      disposed = true
      unsubSegment()
      unsubError()
      unsubStatus()
      unsubDebugLog()
    }
  }, [])

  useEffect(() => {
    const list = transcriptListRef.current
    if (!list) return

    const handleScroll = () => {
      // Auto-Scroll aktiv, solange der Nutzer maximal 32 px vom Listenende entfernt ist.
      // Sobald hochgescrollt wird, wird Auto-Scroll deaktiviert.
      const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight
      const nearBottom = distanceFromBottom <= 32
      setAutoScrollEnabled(nearBottom)
    }

    list.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()

    return () => {
      list.removeEventListener('scroll', handleScroll)
    }
  }, [])

  useEffect(() => {
    if (!autoScrollEnabled || !transcriptListRef.current) return
    transcriptListRef.current.scrollTop = transcriptListRef.current.scrollHeight
  }, [segments, autoScrollEnabled])

  useEffect(() => {
    if (!status.running || !status.startedAt) return

    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [status.running, status.startedAt])

  useEffect(() => {
    if (!toast || toast.persistent) return

    const timer = window.setTimeout(() => {
      setToast(null)
    }, 5000)

    return () => {
      window.clearTimeout(timer)
    }
  }, [toast])

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!status.running) {
        return undefined
      }

      event.preventDefault()
      event.returnValue = ''
      return ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [status.running])

  const isConfigReady = useMemo(() => {
    if (!configState?.exists || !configState.config) {
      return false
    }

    return isConfigComplete(configState.config)
  }, [configState])

  const statusLabel = useMemo(() => {
    if (isStarting) return 'Startet'
    if (status.running) return 'Läuft'
    if (configState && !isConfigComplete(configState.config)) return 'Fehler'
    if (lastError) return 'Fehler'
    return 'Gestoppt'
  }, [configState, isStarting, lastError, status.running])

  const statusDescription = useMemo(() => {
    if (isStarting) return 'Transkription wird gestartet ...'
    if (status.running) return 'Transkription aktiv'
    if (!isConfigReady) return 'Konfiguration unvollständig'
    return 'Bereit zum Starten'
  }, [isConfigReady, isStarting, status.running])

  const finalCount = segments.filter((segment) => segment.state === 'final').length
  const latestSegment = segments.at(-1) ?? null

  const knownSpeakers = useMemo(
    () =>
      [
        ...new Set(
          segments
            .filter((segment) => segment.speaker.trim().length > 0 && segment.speaker.trim().toLowerCase() !== 'unknown')
            .map(getSpeakerKey)
        )
      ],
    [segments]
  )

  const startedAtLabel = useMemo(() => {
    const startedAt = status.startedAt ?? sessionStartedAt
    if (!startedAt) return '---'

    return new Date(startedAt).toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }, [sessionStartedAt, status.startedAt])

  const durationLabel = useMemo(() => {
    const startedAt = status.startedAt ?? sessionStartedAt
    if (!startedAt) return '00:00'

    const startedAtMs = new Date(startedAt).getTime()
    const endAtMs = status.running ? now : Date.now()

    if (Number.isNaN(startedAtMs)) return '00:00'

    const elapsedSeconds = Math.max(0, Math.floor((endAtMs - startedAtMs) / 1000))
    const hours = Math.floor(elapsedSeconds / 3600)
    const minutes = Math.floor((elapsedSeconds % 3600) / 60)
    const seconds = elapsedSeconds % 60

    if (hours > 0) {
      return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
    }

    return [minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
  }, [now, sessionStartedAt, status.running, status.startedAt])

  const onStart = async () => {
    setIsStarting(true)
    try {
      setLastError(null)
      const next = await window.transcriptApi.start()
      setStatus(next)
      setSessionStartedAt(next.startedAt ?? new Date().toISOString())
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Start fehlgeschlagen.'
      setLastError({ code: 'UI_START_FAILED', message })
      setToast({ message: `UI_START_FAILED: ${message}`, variant: 'error', persistent: true })
    } finally {
      setIsStarting(false)
    }
  }

  const onStop = async () => {
    try {
      const next = await window.transcriptApi.stop()
      setStatus(next)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Stop fehlgeschlagen.'
      setLastError({ code: 'UI_STOP_FAILED', message })
    }
  }

  const onToggleRecording = async () => {
    if (status.running) {
      await onStop()
      return
    }

    await onStart()
  }

  const onResetTranscript = async () => {
    const shouldReset = window.confirm('Transkript, Startzeit und Dauer wirklich zurücksetzen?')
    if (!shouldReset) {
      return
    }

    if (status.running) {
      try {
        const next = await window.transcriptApi.stop()
        setStatus(next)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Stop fehlgeschlagen.'
        setLastError({ code: 'UI_STOP_FAILED', message })
        setToast({ message: `UI_STOP_FAILED: ${message}`, variant: 'error', persistent: true })
        return
      }
    }

    setSegments([])
    setSpeakerAliases({})
    setSessionStartedAt(null)
    setStatus((prev) => ({ ...prev, startedAt: undefined }))
    setAutoScrollEnabled(true)
  }

  const onSaveSettings = async () => {
    try {
      const saved = await window.transcriptApi.saveSettings(settings)
      setSettings(normalizeUserSettings(saved))
      const refreshedDevices = await window.transcriptApi.getDevices()
      setDevices(refreshedDevices)
      setSettingsHint(null)
      setToast({ message: 'Einstellungen gespeichert.', variant: 'info', persistent: false })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Einstellungen konnten nicht gespeichert werden.'
      setSettingsHint(message)
      setToast({ message, variant: 'error', persistent: true })
    }
  }

  const onSaveConfig = async () => {
    try {
      const payload = draftToConfig(configDraft)
      const savedState = await window.transcriptApi.saveConfig(payload)
      setConfigState(savedState)
      setConfigDraft(toConfigDraft(savedState.config))
      setToast({ message: 'Azure-Konfiguration gespeichert.', variant: 'info', persistent: false })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Azure-Konfiguration konnte nicht gespeichert werden.'
      setToast({ message, variant: 'error', persistent: true })
    }
  }

  const [connectivityResult, setConnectivityResult] = useState<ConnectivityResult | null>(null)
  const [isTestingConnectivity, setIsTestingConnectivity] = useState(false)
  const [connectivityDialogOpen, setConnectivityDialogOpen] = useState(false)

  const onTestConnectivity = async () => {
    if (isTestingConnectivity) return
    setSettingsDialogOpen(false)
    setConnectivityDialogOpen(true)
    setConnectivityResult(null)
    setToast(null)
    setIsTestingConnectivity(true)
    const startedAt = Date.now()
    let requestSubmitted = false
    try {
      // Aktuelle Draft-Werte (auch ungespeicherte Änderungen) testen.
      const payload = { ...draftToConfig(configDraft), language: settings.language }
      requestSubmitted = true
      const result = await window.transcriptApi.testAzureConnectivity(payload)
      setConnectivityResult({
        reachable: result.reachable,
        httpsReachable: result.httpsReachable,
        speechReachable: result.speechReachable,
        httpStatus: result.httpStatus,
        httpStatusText: result.httpStatusText,
        latencyMs: result.latencyMs,
        error: result.error,
        probeUrl: result.probeUrl,
        testedAtIso: new Date().toISOString(),
        steps: result.steps ?? []
      })

    } catch (error) {
      const message = errorDetail(error, 'Verbindungstest fehlgeschlagen.')
      setConnectivityResult({
        reachable: false,
        httpsReachable: false,
        speechReachable: false,
        latencyMs: Date.now() - startedAt,
        probeUrl: '',
        error: message,
        testedAtIso: new Date().toISOString(),
        steps: [{
          step: requestSubmitted ? 'IPC / Diagnose starten' : 'Konfiguration prüfen',
          status: 'error',
          detail: message
        }]
      })
    } finally {
      setIsTestingConnectivity(false)
    }
  }

  const onCopyTranscript = async () => {
    try {
      await window.transcriptApi.copyTranscript(labeledSegments)
      setToast({ message: 'Finales Transkript wurde in die Zwischenablage kopiert.', variant: 'info', persistent: false })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kopieren fehlgeschlagen.'
      setToast({ message, variant: 'error', persistent: true })
    }
  }

  const onClearDebugLog = async () => {
    try {
      const result = await window.transcriptApi.clearDebugLog()
      setDebugLog([])
      setToast({ message: `Debug-Log gelöscht (${result.cleared} Einträge).`, variant: 'info', persistent: false })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Debug-Log konnte nicht gelöscht werden.'
      setToast({ message, variant: 'error', persistent: true })
    }
  }

  const getSpeakerLabel = (speaker: string) => {
    const alias = speakerAliases[speaker]?.trim()
    return alias && alias.length > 0 ? alias : formatSpeakerKey(speaker)
  }

  // Segmente mit Anzeigenamen (Alias), wie sie im UI und im Export erscheinen.
  const labeledSegments = useMemo(
    () =>
      segments.map((segment) => ({
        ...segment,
        speaker: getSpeakerLabel(getSpeakerKey(segment))
      })),
    [segments, speakerAliases]
  )

  // Markdown-Export (T-506). Das Dokument enthaelt Frontmatter mit den
  // Metadaten der Sitzung; geschrieben wird es ueber das Backend, damit
  // der Zielordner (App-Verzeichnis oder konfigurierter Pfad) dort
  // aufgeloest wird.
  const persistTranscript = async () => {
    try {
      const markdown = buildTranscriptMarkdown(labeledSegments)
      const path = await window.transcriptApi.saveTranscriptMarkdown(markdown)
      setToast({ message: `Transkript gespeichert: ${path}`, variant: 'info', persistent: false })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transkript konnte nicht gespeichert werden.'
      setToast({ message, variant: 'error', persistent: true })
    }
  }

  // Automatisch speichern, sobald die Aufnahme endet.
  //
  // Der Export wird erst ausgeloest, wenn die Aufnahme endet, und dann
  // kurz verzoe gert: Final-Segmente, die nach dem Status-Event
  // eintreffen, sollen noch im Dokument landen. Jedes neue Segment
  // setzt die Wartezeit zurueck.
  const sessionActiveRef = useRef(false)
  const saveTimerRef = useRef<number | null>(null)
  const [saveRequest, setSaveRequest] = useState(0)

  useEffect(() => {
    if (status.running) {
      sessionActiveRef.current = true
      return
    }
    if (sessionActiveRef.current) {
      sessionActiveRef.current = false
      setSaveRequest((value) => value + 1)
    }
  }, [status.running])

  useEffect(() => {
    if (saveRequest === 0) return
    if (status.running) return
    if (!settings.transcript.markdownExport.enabled) return
    if (labeledSegments.length === 0) return
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      setSaveRequest(0)
      void persistTranscript()
    }, 500)
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [saveRequest, status.running, labeledSegments, settings.transcript.markdownExport.enabled])

  return {
    configDraft,
    configState,
    debugLog,
    debugOpen,
    devices,
    durationLabel,
    finalCount,
    getSpeakerClass,
    getSpeakerLabel,
    isConfigReady,
    isStarting,
    knownSpeakers,
    lastError,
    latestSegment,
    onCopyTranscript,
    onOpenSettingsDialog: () => setSettingsDialogOpen(true),
    onResetTranscript,
    onSaveConfig,
    onSaveSettings,
    onTestConnectivity,
    isTestingConnectivity,
    connectivityResult,
    connectivityDialogOpen,
    onOpenConnectivityDialog: () => {
      setSettingsDialogOpen(false)
      setConnectivityDialogOpen(true)
    },
    closeConnectivityDialog: () => {
      setConnectivityDialogOpen(false)
      setSettingsDialogOpen(true)
    },
    onToggleRecording,
    runtimeIssue,
    segments,
    setConfigDraft,
    setSettings,
    setSpeakerAliases,
    settings,
    settingsDialogOpen,
    settingsHint,
    speakerAliases,
    startedAtLabel,
    status,
    statusDescription,
    statusLabel,
    toast,
    transcriptListRef,
    openDebugPanel: () => setDebugOpen(true),
    closeDebugPanel: () => setDebugOpen(false),
    onClearDebugLog,
    closeSettingsDialog: () => setSettingsDialogOpen(false),
    dismissToast: () => setToast(null)
  }
}
