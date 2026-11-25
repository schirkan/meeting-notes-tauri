import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_USER_SETTINGS, normalizeUserSettings, type AppConfigState, type UserSettings } from '@shared/config-contract'
import type { MeetingDetected } from '@shared/transcript-contract'
import { buildTranscriptMarkdown } from '@shared/transcript-markdown'
import {
  formatSpeakerIdentity,
  getSpeakerClassForIdentity,
  getSpeakerIdentity
} from './speaker-utils'
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
  const [quitExportRequest, setQuitExportRequest] = useState<string | null>(null)
  const [lastError, setLastError] = useState<TranscriptError | null>(null)
  const [runtimeIssue, setRuntimeIssue] = useState<string | null>(null)
  const [settings, setSettings] = useState(DEFAULT_USER_SETTINGS)
  const [isLoadingInitialData, setIsLoadingInitialData] = useState(true)
  const [dialogSettings, setDialogSettings] = useState(DEFAULT_USER_SETTINGS)
  const dialogSettingsBaselineRef = useRef(DEFAULT_USER_SETTINGS)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const settingsSaveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const settingsSaveRevisionRef = useRef(0)
  const settingsSaveErrorRef = useRef<string | null>(null)
  const [isSavingSettings, setIsSavingSettings] = useState(false)
  const [settingsSaveFailed, setSettingsSaveFailed] = useState(false)
  const [isChoosingDirectory, setIsChoosingDirectory] = useState(false)
  const [devices, setDevices] = useState<AudioDeviceSnapshot>(initialDevices)
  const [debugLog, setDebugLog] = useState<DebugLogEntry[]>([])
  const [settingsHint, setSettingsHint] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const [debugOpen, setDebugOpen] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [meetingDetected, setMeetingDetected] = useState<MeetingDetected | null>(null)
  const [configState, setConfigState] = useState<AppConfigState | null>(null)
  const [configDraft, setConfigDraft] = useState<ConfigDraft>(() => toConfigDraft(null))
  const [speakerAliases, setSpeakerAliases] = useState<Record<string, string>>({})
  const [now, setNow] = useState(() => Date.now())
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null)
  const observedStartRef = useRef<string | null>(null)
  const recordingGenerationRef = useRef(0)
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)
  const autoScrollEnabledRef = useRef(true)
  const transcriptListRef = useRef<HTMLUListElement | null>(null)

  const observeRecordingStart = (nextStatus: TranscriptStatus, resetTranscript = true) => {
    const startedAt = nextStatus.startedAt
    const previousStart = observedStartRef.current
    if (!nextStatus.running || !startedAt || previousStart === startedAt) return
    observedStartRef.current = startedAt
    recordingGenerationRef.current++
    setSessionStartedAt(startedAt)
    // A first paused status describes a session already in progress, even before getStatus resolves.
    if (!resetTranscript || (previousStart === null && nextStatus.paused)) return
    setSegments([])
    setSpeakerAliases({})
    autoScrollEnabledRef.current = true
    setAutoScrollEnabled(true)
  }

  const onToggleDevtools = async () => {
    try {
      await window.transcriptApi.toggleDevtools()
    } catch (error) {
      setToast({ message: errorDetail(error, 'Developer tools could not be toggled.'), variant: 'error', persistent: true })
    }
  }

  const onOpenRepository = async () => {
    try {
      await window.transcriptApi.openRepository()
    } catch (error) {
      setToast({ message: errorDetail(error, 'The repository could not be opened.'), variant: 'error', persistent: true })
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'F12') return
      event.preventDefault()
      if (!event.repeat) void onToggleDevtools()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  useEffect(() => {
    const transcriptApi = window.transcriptApi

    if (!transcriptApi) {
      setRuntimeIssue('The IPC bridge is not available. Check the preload or the dev start.')
      setToast({
        message: 'The IPC bridge is not available. Check the preload or the dev start.',
        variant: 'error',
        persistent: true
      })
      return
    }

    let disposed = false
    let receivedLiveStatus = false

    const statusLoad = transcriptApi.getStatus().then((nextStatus) => {
      if (disposed || receivedLiveStatus) return
      // Adopt an existing session without clearing any segments already received.
      observeRecordingStart(nextStatus, false)
      setStatus(nextStatus)
    })

    const configLoad = transcriptApi.getConfig()
      .then((nextConfig) => {
        if (disposed) return
        setConfigState(nextConfig)
        setConfigDraft(toConfigDraft(nextConfig.config))
        if (!nextConfig.exists || !isConfigComplete(nextConfig.config)) {
          setSettingsDialogOpen(true)
          setToast({
            message: 'Azure configuration is missing or incomplete. Please complete it in the settings and save.',
            variant: 'error',
            persistent: true
          })
        }
      })
      .catch(() => {
        if (disposed) return
        setSettingsDialogOpen(true)
        setToast({
          message: 'The Azure configuration could not be loaded. Please check it in the settings and save.',
          variant: 'error',
          persistent: true
        })
      })

    void Promise.all([
      transcriptApi.getSettings(),
      transcriptApi.getDevices(),
      transcriptApi.getDebugLog(),
      configLoad,
      statusLoad
    ])
      .then(([nextSettings, nextDevices, nextDebugLog]) => {
        if (disposed) return
        const normalized = normalizeUserSettings(nextSettings)
        setSettings(normalized)
        setDialogSettings(normalized)
        dialogSettingsBaselineRef.current = normalized
        setDevices(nextDevices)
        setDebugLog(nextDebugLog)
      })
      .catch((error) => {
        if (disposed) return
        const message = error instanceof Error ? error.message : 'The initial data could not be loaded.'
        setRuntimeIssue(message)
        setToast({ message, variant: 'error', persistent: true })
      })
      .finally(() => {
        if (!disposed) setIsLoadingInitialData(false)
      })

    const unsubSegment = transcriptApi.onSegment((segment) => {
      setSegments((prev) => {
        // Die Identitaet enthaelt die Azure-Sitzung (T-507): "Guest-1" aus
        // zwei Sitzungen sind verschiedene Personen. Deshalb wird nur
        // innerhalb derselben Identitaet zusammengefuehrt.
        const identity = getSpeakerIdentity(segment)
        const sameSpeakerKey = (entry: TranscriptSegment) =>
          getSpeakerIdentity(entry) === identity

        const sameUtterance = (entry: TranscriptSegment) =>
          entry.sessionId === segment.sessionId && entry.utteranceOffsetTicks === segment.utteranceOffsetTicks
        const hasOffset = segment.utteranceOffsetTicks != null
        // Both stereo channels can start at the same offset. An unlabelled
        // update cannot safely replace either when both are present.
        if (hasOffset && segment.state === 'interim' && segment.source === '' &&
          prev.some((entry) => entry.state === 'interim' && entry.source === 'mic' && sameUtterance(entry)) &&
          prev.some((entry) => entry.state === 'interim' && entry.source === 'speaker' && sameUtterance(entry))) return prev

        const withoutInterimForSource = prev.filter((entry) => {
          if (entry.state !== 'interim' || entry.sessionId !== segment.sessionId) return true
          if (!hasOffset) return entry.utteranceOffsetTicks != null ||
            (entry.source !== segment.source && entry.source !== '')
          // Preserve the channel's live slot if Azure adjusts its hypothesis offset.
          if (segment.source && entry.source === segment.source) return false
          if (!sameUtterance(entry)) return true
          return entry.source !== segment.source && entry.source !== '' && segment.source !== ''
        })

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
      receivedLiveStatus = true
      observeRecordingStart(nextStatus)
      setNow(Date.now())
      setStatus(nextStatus)
    })

    const unsubQuitExport = transcriptApi.onQuitExport(setQuitExportRequest)

    const unsubDebugLog = transcriptApi.onDebugLog((entry) => {
      setDebugLog((prev) => [entry, ...prev].slice(0, 300))
    })

    // T-513: Eine Meeting-Erkennung wird angezeigt. Die Aufnahme startet
    // der Rust-Main - der Renderer muss sie nur melden.
    const unsubMeetingDetected = transcriptApi.onMeetingDetected((detected) => {
      setMeetingDetected(detected)
      setToast({
        message:
          `Meeting detected (${detected.processName}). Transcription starts automatically.`,
        variant: 'info',
        persistent: false
      })
    })

    // T-300: Ein abgestuerzter Sidecar muss fuer den Nutzer sichtbar sein.
    // Das Ereignis kam bisher bis zum Preload, wurde aber von niemandem
    // abonniert - die Oberflaeche blieb bei einem Crash stumm.
    const unsubCrashed = window.transcriptSidecar?.onCrashed((payload) => {
      receivedLiveStatus = true
      setLastError({ code: 'SIDECAR_UNAVAILABLE', message: 'The transcription service has crashed.' })
      setStatus((prev) => ({ ...prev, running: false, paused: false }))
      setIsStarting(false)
      setToast({
        message:
          `Sidecar crashed (exit code ${payload.exitCode ?? 'unknown'}). ` +
          'The transcription must be restarted.',
        variant: 'error',
        persistent: true
      })
    })

    return () => {
      disposed = true
      unsubSegment()
      unsubError()
      unsubStatus()
      unsubQuitExport()
      unsubMeetingDetected()
      unsubDebugLog()
      unsubCrashed?.()
    }
  }, [])

  useEffect(() => {
    const list = transcriptListRef.current
    if (!list) return

    const handleScroll = () => {
      // Auto-Scroll aktiv, solange der Nutzer maximal 24 px vom Listenende entfernt ist.
      // Sobald hochgescrollt wird, wird Auto-Scroll deaktiviert.
      const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight
      const nearBottom = distanceFromBottom <= 24
      autoScrollEnabledRef.current = nearBottom
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
    const list = transcriptListRef.current
    const follow = () => { if (autoScrollEnabledRef.current) list.scrollTop = list.scrollHeight }
    follow()
    const observer = new ResizeObserver(follow)
    observer.observe(list)
    return () => observer.disconnect()
  }, [segments, speakerAliases, autoScrollEnabled])

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
      if (!status.running && !isSavingSettings) {
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
  }, [status.running, isSavingSettings])

  const isConfigReady = useMemo(() => {
    if (!configState?.exists || !configState.config) {
      return false
    }

    return isConfigComplete(configState.config)
  }, [configState])

  const statusLabel = useMemo(() => {
    if (isStarting) return 'Starting'
    if (status.paused) return 'Paused'
    if (status.running) return 'Running'
    if (configState && !isConfigComplete(configState.config)) return 'Error'
    if (lastError) return 'Error'
    return 'Stopped'
  }, [configState, isStarting, lastError, status.paused, status.running])

  const statusDescription = useMemo(() => {
    if (isStarting) return 'Transcription is starting ...'
    if (status.paused) return 'Transcription paused - the session stays active'
    if (status.running) return 'Transcription active'
    if (!isConfigReady) return 'Configuration incomplete'
    return 'Ready to start'
  }, [isConfigReady, isStarting, status.paused, status.running])

  const finalCount = segments.filter((segment) => segment.state === 'final').length
  const latestSegment = segments.at(-1) ?? null

  // Bekannte Sprecher als sessionsichere Identitaeten. Zwei Sitzungen
  // koennen dieselbe SDK-ID vergeben — die Identitaet trennt sie.
  const knownSpeakers = useMemo(
    () =>
      [
        ...new Set(
          segments
            .filter((segment) => segment.speaker.trim().length > 0 && segment.speaker.trim().toLowerCase() !== 'unknown')
            .map(getSpeakerIdentity)
        )
      ],
    [segments]
  )

  // Anzeigenamen je Identitaet. Nur wenn dieselbe Anzeige in zwei Sitzungen
  // vorkommt, wird sie nummeriert, damit die Zuordnung unterscheidbar bleibt.
  const speakerLabels = useMemo(() => {
    const groups = new Map<string, string[]>()
    for (const identity of knownSpeakers) {
      const base = formatSpeakerIdentity(identity)
      const group = groups.get(base) ?? []
      group.push(identity)
      groups.set(base, group)
    }

    const labels: Record<string, string> = {}
    for (const [base, group] of groups) {
      if (group.length === 1) {
        labels[group[0]] = base
        continue
      }
      group.forEach((identity, index) => {
        labels[identity] = `${base} #${index + 1}`
      })
    }
    return labels
  }, [knownSpeakers])

  const startedAtLabel = useMemo(() => {
    const startedAt = status.startedAt ?? sessionStartedAt
    if (!startedAt) return '---'

    return new Date(startedAt).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }, [sessionStartedAt, status.startedAt])

  // Pausen zaehlen nicht als Aufnahmezeit (T-507): waehrend der Pause
  // wird kein Audio aufgenommen.
  const pausedAccumulatedMsRef = useRef(0)
  const pausedSinceRef = useRef<number | null>(null)
  const wasPausedRef = useRef(false)
  const timedSessionRef = useRef<string | null>(null)

  useEffect(() => {
    const session = status.startedAt ?? sessionStartedAt
    if (timedSessionRef.current !== session) {
      timedSessionRef.current = session
      pausedAccumulatedMsRef.current = 0
      pausedSinceRef.current = null
      wasPausedRef.current = false
    }
    if (status.paused && !wasPausedRef.current) {
      pausedSinceRef.current = Date.now()
    } else if (!status.paused && wasPausedRef.current && pausedSinceRef.current !== null) {
      pausedAccumulatedMsRef.current += Date.now() - pausedSinceRef.current
      pausedSinceRef.current = null
    }
    wasPausedRef.current = !!status.paused
    setNow(Date.now())
  }, [status.paused, status.running, status.startedAt, sessionStartedAt])

  const durationLabel = useMemo(() => {
    const startedAt = status.startedAt ?? sessionStartedAt
    if (!startedAt) return '00:00'

    const startedAtMs = new Date(startedAt).getTime()
    const endAtMs = now

    if (Number.isNaN(startedAtMs)) return '00:00'

    const pausedMs = pausedAccumulatedMsRef.current
      + (pausedSinceRef.current !== null ? now - pausedSinceRef.current : 0)
    const elapsedSeconds = Math.max(0, Math.floor((endAtMs - startedAtMs - pausedMs) / 1000))
    const hours = Math.floor(elapsedSeconds / 3600)
    const minutes = Math.floor((elapsedSeconds % 3600) / 60)
    const seconds = elapsedSeconds % 60

    if (hours > 0) {
      return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
    }

    return [minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
  }, [now, sessionStartedAt, status.paused, status.running, status.startedAt])

  const onStart = async () => {
    setIsStarting(true)
    try {
      await settingsSaveQueueRef.current
      if (settingsSaveErrorRef.current) throw new Error(settingsSaveErrorRef.current)
      setLastError(null)
      const next = await window.transcriptApi.start()
      // The native start event resets the transcript before the first segment.
      observeRecordingStart(next)
      setNow(Date.now())
      setStatus(next)
      setToast({ message: 'New transcript started.', variant: 'info', persistent: false })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Start failed.'
      setLastError({ code: 'UI_START_FAILED', message })
      setToast({ message: `UI_START_FAILED: ${message}`, variant: 'error', persistent: true })
    } finally {
      setIsStarting(false)
    }
  }

  const onStop = async () => {
    try {
      const next = await window.transcriptApi.stop()
      setNow(Date.now())
      setStatus(next)
    } catch (error) {
      const message = errorDetail(error, 'Stop failed.')
      setLastError({ code: 'UI_STOP_FAILED', message })
      setToast({ message: `UI_STOP_FAILED: ${message}`, variant: 'error', persistent: true })
    }
  }

  // Pause: die Azure-Sitzung lebt weiter, es wird kein Audio zugespeist.
  // Fortsetzen nutzt dieselbe Sitzung — die Sprecher-IDs bleiben gueltig.
  const onPause = async () => {
    try {
      const next = await window.transcriptApi.pause()
      setNow(Date.now())
      setStatus(next)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Pause failed.'
      setLastError({ code: 'UI_PAUSE_FAILED', message })
      setToast({ message: `UI_PAUSE_FAILED: ${message}`, variant: 'error', persistent: true })
    }
  }

  const onResume = async () => {
    try {
      const next = await window.transcriptApi.resume()
      setNow(Date.now())
      setStatus(next)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Resume failed.'
      setLastError({ code: 'UI_RESUME_FAILED', message })
      setToast({ message: `UI_RESUME_FAILED: ${message}`, variant: 'error', persistent: true })
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
    if (status.running || isStarting) return
    const shouldReset = window.confirm('Really reset the transcript, start time and duration?')
    if (!shouldReset) {
      return
    }

    const generation = recordingGenerationRef.current
    try {
      await window.transcriptApi.reset()
    } catch (error) {
      setToast({ message: errorDetail(error, 'The transcript could not be reset.'), variant: 'error', persistent: true })
      return
    }
    // A new recording may have started (and even stopped) while IPC was pending.
    if (recordingGenerationRef.current !== generation) return
    setSegments([])
    setSpeakerAliases({})
    setSessionStartedAt(null)
    setStatus((prev) => ({ ...prev, startedAt: undefined }))
    autoScrollEnabledRef.current = true
    setAutoScrollEnabled(true)
  }

  const setIdleSettings: React.Dispatch<React.SetStateAction<UserSettings>> = (update) => {
    const next = typeof update === 'function' ? update(settingsRef.current) : update
    settingsRef.current = next
    setSettings(next)
    const revision = ++settingsSaveRevisionRef.current
    setIsSavingSettings(true)

    // Serialize full snapshots so rapid changes cannot overwrite one another.
    settingsSaveQueueRef.current = settingsSaveQueueRef.current.then(async () => {
      try {
        const saved = normalizeUserSettings(await window.transcriptApi.saveSettings(next))
        if (revision === settingsSaveRevisionRef.current) {
          if (settingsRef.current === next) {
            settingsRef.current = saved
            setSettings(saved)
          }
          const previousError = settingsSaveErrorRef.current
          if (previousError) setToast((previous) => previous?.message === previousError ? null : previous)
          settingsSaveErrorRef.current = null
          setSettingsSaveFailed(false)
          setSettingsHint(null)
        }
      } catch (error) {
        const message = errorDetail(error, 'The settings could not be saved automatically.')
        if (revision === settingsSaveRevisionRef.current) {
          settingsSaveErrorRef.current = message
          setSettingsSaveFailed(true)
        }
        setSettingsHint(message)
        setToast({ message, variant: 'error', persistent: true })
      } finally {
        if (revision === settingsSaveRevisionRef.current) setIsSavingSettings(false)
      }
    })
  }

  // Einziger Speichern-Pfad fuer den Settings-Dialog: der Button im
  // Dialog-Footer schreibt beide Abschnitte (Azure-Konfiguration inkl. Proxy
  // und Benutzereinstellungen). Die Benutzereinstellungen werden zuerst
  // geschrieben, damit eine unvollstaendige Azure-Konfiguration (z. B. beim
  // automatischen Oeffnen nach einem Start ohne Konfiguration) die
  // Sprache-/Geraete-Auswahl nicht verwerft.
  const onSaveAll = async () => {
    if (isSavingSettings) return
    setIsSavingSettings(true)
    const snapshot = dialogSettings
    const revision = settingsSaveRevisionRef.current
    const save = settingsSaveQueueRef.current.then(async () => {
      const errors: string[] = []

      try {
        const saved = await window.transcriptApi.saveSettings(snapshot)
        const normalized = normalizeUserSettings(saved)
        settingsRef.current = normalized
        setSettings(normalized)
        setDialogSettings(normalized)
        dialogSettingsBaselineRef.current = normalized
        settingsSaveErrorRef.current = null
        setSettingsSaveFailed(false)
        const refreshedDevices = await window.transcriptApi.getDevices()
        setDevices(refreshedDevices)
        setSettingsHint(null)
      } catch (error) {
        const message = errorDetail(error, 'The settings could not be saved.')
        settingsSaveErrorRef.current = message
        setSettingsSaveFailed(true)
        errors.push(message)
      }

      try {
        const payload = draftToConfig(configDraft)
        const savedState = await window.transcriptApi.saveConfig(payload)
        setConfigState(savedState)
        setConfigDraft(toConfigDraft(savedState.config))
      } catch (error) {
        errors.push(errorDetail(error, 'The Azure configuration could not be saved.'))
      }

      if (revision === settingsSaveRevisionRef.current) setIsSavingSettings(false)
      if (errors.length > 0) {
        const message = errors.join(' ')
        setSettingsHint(message)
        setToast({ message, variant: 'error', persistent: true })
        return
      }

      setSettingsDialogOpen(false)
      setToast({ message: 'Settings saved.', variant: 'info', persistent: false })
    })
    settingsSaveQueueRef.current = save
    await save
  }

  const onChooseTranscriptDirectory = async () => {
    if (isChoosingDirectory) return
    setIsChoosingDirectory(true)
    try {
      const path = await window.transcriptApi.selectTranscriptDirectory()
      if (path === null) return
      setDialogSettings((previous) => ({
        ...previous,
        transcript: {
          ...previous.transcript,
          markdownExport: { ...previous.transcript.markdownExport, path }
        }
      }))
    } catch (error) {
      const message = errorDetail(error, 'The save folder could not be selected.')
      setToast({ message, variant: 'error', persistent: true })
    } finally {
      setIsChoosingDirectory(false)
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
      const payload = {
        ...draftToConfig(configDraft),
        language: dialogSettings.language,
        autoLanguageDetection: dialogSettings.autoLanguageDetection,
        transcription: configDraft.model === 'mai-transcribe-2-streaming'
          ? { ...dialogSettings.transcription, audioMode: 'dual-mono' as const }
          : dialogSettings.transcription,
        diarization: configDraft.model === 'standard' && dialogSettings.diarization
      }
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
      const message = errorDetail(error, 'Connection test failed.')
      setConnectivityResult({
        reachable: false,
        httpsReachable: false,
        speechReachable: false,
        latencyMs: Date.now() - startedAt,
        probeUrl: '',
        error: message,
        testedAtIso: new Date().toISOString(),
        steps: [{
          step: requestSubmitted ? 'IPC / Start diagnostics' : 'Check configuration',
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
      setToast({ message: 'The final transcript was copied to the clipboard.', variant: 'info', persistent: false })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Copy failed.'
      setToast({ message, variant: 'error', persistent: true })
    }
  }

  const onCopyDebugLog = async () => {
    if (debugLog.length === 0) return
    const rows = debugLog.map(({ timestampIso, source, level, message }) => [
      new Date(timestampIso).toLocaleTimeString('en-US'), source.toUpperCase(), level, message
    ].join('\t'))
    try {
      await navigator.clipboard.writeText(['Time\tSource\tLevel\tMessage', ...rows].join('\n'))
      setToast({ message: 'Debug log copied to the clipboard.', variant: 'info', persistent: false })
    } catch {
      setToast({ message: 'The debug log could not be copied to the clipboard.', variant: 'error', persistent: true })
    }
  }

  const onClearDebugLog = async () => {
    try {
      const result = await window.transcriptApi.clearDebugLog()
      setDebugLog([])
      setToast({ message: `Debug log cleared (${result.cleared} entries).`, variant: 'info', persistent: false })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The debug log could not be cleared.'
      setToast({ message, variant: 'error', persistent: true })
    }
  }

  // Der Alias-Schluessel ist die sessionsichere Identitaet. Nach einem
  // Stop startet ein neues Transkript mit frischer Sprecherbasis — der
  // Alias aus der vorigen Sitzung faellt dann nicht auf eine andere Person.
  const getSpeakerLabel = (identity: string) => {
    const alias = speakerAliases[identity]?.trim()
    if (alias && alias.length > 0) return alias
    return speakerLabels[identity] ?? formatSpeakerIdentity(identity)
  }

  // Segmente mit Anzeigenamen (Alias), wie sie im UI und im Export erscheinen.
  const labeledSegments = useMemo(
    () =>
      segments.map((segment) => ({
        ...segment,
        speaker: getSpeakerLabel(getSpeakerIdentity(segment))
      })),
    [segments, speakerAliases, speakerLabels]
  )

  // Spiegel fuer den Export: der Export-Snapshot muss auch dann gueltig
  // sein, wenn direkt nach dem Stop ein neues Transkript startet.
  const labeledSegmentsRef = useRef<TranscriptSegment[]>([])
  useEffect(() => {
    labeledSegmentsRef.current = labeledSegments
  }, [labeledSegments])

  // Markdown-Export (T-506). Das Dokument enthaelt Frontmatter mit den
  // Metadaten der Sitzung; geschrieben wird es ueber das Backend, damit
  // der Zielordner (App-Verzeichnis oder konfigurierter Pfad) dort
  // aufgeloest wird.
  const pendingExportsRef = useRef(new Map<string, Promise<void>>())
  const lastSavedExportRef = useRef<string | null>(null)
  const persistTranscript = async (segmentsToExport: TranscriptSegment[], { reuseSaved = false, background = false } = {}) => {
    if (!segmentsToExport.some((segment) => segment.state === 'final')) return
    const markdown = buildTranscriptMarkdown(segmentsToExport)
    const key = JSON.stringify([segmentsToExport.at(-1)?.sessionId, settingsRef.current.transcript.markdownExport.path, markdown])
    const pending = pendingExportsRef.current
    const current = pending.get(key)
    if (current) return current
    if (reuseSaved && lastSavedExportRef.current === key) return
    const write = window.transcriptApi.saveTranscriptMarkdown(markdown).then((path) => {
      lastSavedExportRef.current = key
      setToast((previous) => background && previous?.variant === 'error' ? previous : {
        message: `Transcript saved: ${path}`, variant: 'info', persistent: false
      })
    }).finally(() => pending.delete(key))
    pending.set(key, write)
    return write
  }

  const saveTranscriptWithToast = async (segmentsToExport: TranscriptSegment[], background = false) => {
    try {
      await persistTranscript(segmentsToExport, { background })
    } catch (error) {
      const message = errorDetail(error, 'The transcript could not be saved.')
      setToast({ message, variant: 'error', persistent: true })
    }
  }

  // Automatisch speichern, sobald die Aufnahme endet.
  //
  // Der Export wird erst ausgeloest, wenn die Aufnahme endet, und dann
  // kurz verzoe gert: Final-Segmente, die nach dem Status-Event
  // eintreffen, sollen noch im Dokument landen. Jedes neue Segment
  // setzt die Wartezeit zurueck.
  //
  // Der Export bekommt einen Snapshot der beendeten Sitzung. Startet direkt
  // danach ein neues Transkript (T-507), bleibt der Export des beendeten
  // Transkripts trotzdem erhalten.
  const sessionActiveRef = useRef(false)
  const saveTimerRef = useRef<number | null>(null)
  const exportSegmentsRef = useRef<TranscriptSegment[]>([])
  const exportSessionRef = useRef<string | null>(null)
  const [saveRequest, setSaveRequest] = useState(0)

  useEffect(() => {
    if (status.running) {
      sessionActiveRef.current = true
      return
    }
    if (sessionActiveRef.current) {
      sessionActiveRef.current = false
      const finished = [...labeledSegmentsRef.current]
      exportSegmentsRef.current = finished
      exportSessionRef.current = finished.length > 0
        ? finished[finished.length - 1].sessionId ?? null
        : null
      setSaveRequest((value) => value + 1)
    }
  }, [status.running])

  // Nachlaufende Final-Segmente der beendeten Sitzung gehoeren noch ins
  // Dokument. Sobald ein neues Transkript laeuft, bleibt der Snapshot.
  useEffect(() => {
    if (saveRequest === 0) return
    if (status.running) return
    // Nachlaufende Final-Segmente der beendeten Sitzung gehoeren noch ins
    // Dokument. Sobald ein neues Transkript laeuft (andere Session oder
    // leere Liste), bleibt der Snapshot der beendeten Sitzung unveraendert.
    const current = labeledSegmentsRef.current
    if (current.length === 0) return
    const lastSession = current[current.length - 1].sessionId ?? null
    if (exportSessionRef.current !== null && lastSession !== exportSessionRef.current) return
    exportSegmentsRef.current = [...current]
  }, [saveRequest, status.running, labeledSegments])

  useEffect(() => {
    if (saveRequest === 0 || quitExportRequest !== null) return
    if (!settings.transcript.markdownExport.enabled) return
    if (exportSegmentsRef.current.length === 0) return
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      setSaveRequest(0)
      void saveTranscriptWithToast(exportSegmentsRef.current, true)
    }, 500)
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [saveRequest, settings.transcript.markdownExport.enabled, quitExportRequest])

  const handledQuitExportRef = useRef<string | null>(null)
  useEffect(() => {
    if (quitExportRequest === null || handledQuitExportRef.current === quitExportRequest) return
    handledQuitExportRef.current = quitExportRequest
    setSaveRequest(0)
    // Use the committed snapshot: the last segment may have arrived in the same batch as the request.
    void (async () => {
      let error: string | null = null
      try {
        await settingsSaveQueueRef.current
        await persistTranscript(labeledSegments, { reuseSaved: true })
      } catch (cause) {
        error = `The transcript could not be saved: ${errorDetail(cause, 'Unknown error.')}`
      }
      try {
        await window.transcriptApi.completeQuitExport(quitExportRequest, error)
      } catch (cause) {
        setToast({ message: errorDetail(cause, 'The quit export could not be acknowledged.'), variant: 'error', persistent: true })
      } finally {
        setQuitExportRequest((current) => current === quitExportRequest ? null : current)
      }
    })()
  }, [quitExportRequest, labeledSegments])

  return {
    onToggleDevtools,
    onOpenRepository,
    configDraft,
    configState,
    debugLog,
    debugOpen,
    devices,
    durationLabel,
    finalCount,
    getSpeakerLabel,
    isConfigReady,
    isLoadingInitialData,
    isStarting,
    knownSpeakers,
    lastError,
    latestSegment,
    onCopyTranscript,
    onExportTranscript: () => saveTranscriptWithToast(labeledSegments),
    autoScrollEnabled,
    onFollowTranscript: () => {
      autoScrollEnabledRef.current = true
      setAutoScrollEnabled(true)
      const list = transcriptListRef.current
      if (list) list.scrollTop = list.scrollHeight
    },
    onOpenSettingsDialog: () => {
      setDialogSettings(settingsRef.current)
      dialogSettingsBaselineRef.current = settingsRef.current
      setConfigDraft(toConfigDraft(configState?.config ?? null))
      setSettingsDialogOpen(true)
    },
    onResetTranscript,
    onSaveAll,
    isSavingSettings,
    settingsSaveFailed,
    setIdleSettings,
    onChooseTranscriptDirectory,
    isChoosingDirectory,
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
    onPause,
    onResume,
    runtimeIssue,
    segments,
    setConfigDraft,
    dialogSettings,
    setDialogSettings,
    setSpeakerAliases,
    settings,
    settingsDialogOpen,
    settingsHint,
    speakerAliases,
    speakerLabels,
    startedAtLabel,
    status,
    statusDescription,
    statusLabel,
    toast,
    transcriptListRef,
    openDebugPanel: () => setDebugOpen(true),
    closeDebugPanel: () => setDebugOpen(false),
    onCopyDebugLog,
    onClearDebugLog,
    closeSettingsDialog: () => {
      if (isSavingSettings || isChoosingDirectory) return
      const dirty = JSON.stringify(dialogSettings) !== JSON.stringify(dialogSettingsBaselineRef.current)
        || JSON.stringify(configDraft) !== JSON.stringify(toConfigDraft(configState?.config ?? null))
      if (dirty && !window.confirm('Discard unsaved changes?')) return
      setDialogSettings(settingsRef.current)
      setConfigDraft(toConfigDraft(configState?.config ?? null))
      setSettingsDialogOpen(false)
    },
    dismissToast: () => setToast(null)
  }
}
