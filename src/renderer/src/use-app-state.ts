import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_USER_SETTINGS, fileTranscriptionDefaults, isAzureSpeechModel, normalizeUserSettings, type AppConfigState, type AzureConfig, type FileTranscriptionSettings, type SpeechModel, type UserSettings } from '@shared/config-contract'
import { BATCH_MODELS, meetingSpeechFeatures } from '@shared/speech-models'
import type { BatchAudioSource, MeetingDetected } from '@shared/transcript-contract'
import { buildTranscriptMarkdown } from '@shared/transcript-markdown'
import {
  formatSpeakerIdentity,
  formatTranscriptSource,
  hasIdentifiedSpeaker,
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
import { type ConfigDraft, draftToConfig, isBatchSpeechEndpoint, isConfigComplete, toConfigDraft } from './config-utils'
import type { ConnectivityResult } from './components/ConnectivityDialog'
import { canUseWebSpeech, WebSpeechSession } from './web-speech'
import { batchTracks, earliestTrackStart, slotsFromRecording, type BatchAudioSlots } from './batch-audio'

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

function labelSegments(segments: TranscriptSegment[], getLabel: (identity: string) => string) {
  return segments.map((segment) => ({
    ...segment,
    speakerIdentified: hasIdentifiedSpeaker(segment),
    speaker: hasIdentifiedSpeaker(segment) ? getLabel(getSpeakerIdentity(segment)) : formatTranscriptSource(segment.source)
  }))
}

// SDK speaker identifiers can recur across sessions. Number equal display names.
function defaultSpeakerLabels(identities: string[]): Record<string, string> {
  const groups = new Map<string, string[]>()
  for (const identity of identities) {
    const base = formatSpeakerIdentity(identity)
    const group = groups.get(base) ?? []
    group.push(identity)
    groups.set(base, group)
  }
  return Object.fromEntries([...groups].flatMap(([base, group]) =>
    group.map((identity, index) => [identity, group.length === 1 ? base : `${base} #${index + 1}`])))
}

function identifiedSpeakers(segments: TranscriptSegment[]) {
  return [...new Set(segments.filter(hasIdentifiedSpeaker).map(getSpeakerIdentity))]
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
  const [showHome, setShowHome] = useState(false)
  const [batchAudioSlots, setBatchAudioSlots] = useState<BatchAudioSlots>({})
  const fileDefaults = fileTranscriptionDefaults(settings)
  const [batchTranscriptStart, setBatchTranscriptStart] = useState<string | undefined>()
  const [batchAction, setBatchAction] = useState<'pick' | 'transcribe' | null>(null)
  const lastCompletedRecordingRef = useRef<string | null>(null)
  const batchPendingRef = useRef(false)
  const startPendingRef = useRef(false)
  const webSpeechRef = useRef<WebSpeechSession | null>(null)
  const segmentReceiverRef = useRef<(segment: TranscriptSegment) => void>(() => {})
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
  const audioActivityRef = useRef<{ startedAt: string; at: number } | null>(null)
  const [silenceCountdown, setSilenceCountdown] = useState<number | null>(null)
  const showStartPage = !isLoadingInitialData && !isStarting && !status.running && (segments.length === 0 || showHome)

  const clearTranscript = () => {
    setShowHome(false)
    setSegments([])
    setBatchTranscriptStart(undefined)
    setSpeakerAliases({})
    autoScrollEnabledRef.current = true
    setAutoScrollEnabled(true)
  }

  const observeRecordingStart = (nextStatus: TranscriptStatus, resetTranscript = true) => {
    const startedAt = nextStatus.startedAt
    const previousStart = observedStartRef.current
    if (!nextStatus.running || !startedAt || previousStart === startedAt) return
    observedStartRef.current = startedAt
    recordingGenerationRef.current++
    setSessionStartedAt(startedAt)
    // A first paused status describes a session already in progress, even before getStatus resolves.
    if (!resetTranscript || (previousStart === null && nextStatus.paused)) return
    clearTranscript()
  }

  const prefillBatchAudio = (nextStatus: TranscriptStatus) => {
    const recording = nextStatus.recording
    if (nextStatus.running || !recording || (!recording.micPath && !recording.speakerPath)) return
    const key = JSON.stringify([recording.startedAt, recording.micPath, recording.speakerPath])
    if (key === lastCompletedRecordingRef.current) return
    lastCompletedRecordingRef.current = key
    setBatchAudioSlots(slotsFromRecording(recording))
    setShowHome(true)
    setToast({ message: 'Recording ready. Choose a model to transcribe the saved WAVs.', variant: 'info', persistent: false })
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
      prefillBatchAudio(nextStatus)
      setStatus(nextStatus)
    })

    const settingsLoad = transcriptApi.getSettings()
    const configLoad = transcriptApi.getConfig()
      .then(async (nextConfig) => {
        const nextSettings = await settingsLoad.catch(() => null)
        if (disposed) return
        setConfigState(nextConfig)
        setConfigDraft(toConfigDraft(nextConfig.config))
        const transcription = normalizeUserSettings(nextSettings).transcription
        const { model } = meetingSpeechFeatures(transcription, nextConfig.config?.model)
        if (transcription.mode !== 'batch' && (model === 'unsupported' || (!transcription.provider && (!nextConfig.exists || !isConfigComplete(nextConfig.config))))) {
          setToast({
            message: model === 'unsupported' ? 'The saved transcription model is unsupported. Choose another on the start page.'
              : model === 'standard' && !nextConfig.config?.endpoint.trim() ? 'The Azure Speech endpoint is missing. Configure it in Settings or choose another model.'
              : 'Azure configuration is missing or incomplete. Configure it in Settings or choose another model.',
            variant: 'error',
            persistent: true
          })
        }
      })
      .catch(async () => {
        const nextSettings = await settingsLoad.catch(() => null)
        const transcription = normalizeUserSettings(nextSettings).transcription
        if (disposed || transcription.provider || transcription.mode === 'batch') return
        setToast({
          message: 'The Azure configuration could not be loaded. Please check it in the settings and save.',
          variant: 'error',
          persistent: true
        })
      })

    void Promise.all([
      settingsLoad,
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

    segmentReceiverRef.current = (segment) => {
      setSegments((prev) => {
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

        if (segment.state === 'final' && segment.sessionId && hasIdentifiedSpeaker(segment)) {
          let index = withoutInterimForSource.length - 1
          while (index >= 0 && withoutInterimForSource[index].state === 'interim') index--
          const previous = withoutInterimForSource[index]
          // Only adjacent finals from an identified speaker, source and session (T-507).
          if (previous && hasIdentifiedSpeaker(previous) && getSpeakerIdentity(previous) === getSpeakerIdentity(segment)) {
            withoutInterimForSource[index] = {
              ...segment,
              id: previous.id,
              text: `${previous.text} ${segment.text}`.trim()
            }
            return withoutInterimForSource
          }
        }

        withoutInterimForSource.push(segment)
        return withoutInterimForSource
      })
    }
    const unsubSegment = transcriptApi.onSegment((segment) => segmentReceiverRef.current(segment))

    const unsubError = transcriptApi.onError((error) => {
      setLastError(error)
      setToast({
        message: `${error.code}: ${error.message}`,
        variant: 'error',
        persistent: true
      })
    })

    const unsubAudioActivity = transcriptApi.onAudioActivity((startedAt) => {
      audioActivityRef.current = { startedAt, at: performance.now() }
      setSilenceCountdown(null)
    })
    const unsubStatus = transcriptApi.onStatus((nextStatus) => {
      receivedLiveStatus = true
      if (webSpeechRef.current && (startPendingRef.current || !nextStatus.running)) return
      observeRecordingStart(nextStatus)
      prefillBatchAudio(nextStatus)
      setNow(Date.now())
      setStatus(nextStatus)
    })

    const unsubQuitExport = transcriptApi.onQuitExport((requestId) => {
      const web = webSpeechRef.current
      if (!web) { setQuitExportRequest(requestId); return }
      void web.stop().then(() => {
        if (webSpeechRef.current === web) webSpeechRef.current = null
        setStatus((previous) => ({ ...previous, running: false, paused: false }))
        setQuitExportRequest(requestId)
      }, (error: unknown) => {
        web.abort()
        if (webSpeechRef.current === web) webSpeechRef.current = null
        setStatus((previous) => ({ ...previous, running: false, paused: false }))
        void transcriptApi.completeQuitExport(requestId, errorDetail(error, 'Web Speech did not stop cleanly.')).catch(() => {})
      })
    })

    const unsubDebugLog = transcriptApi.onDebugLog((entry) => {
      setDebugLog((prev) => [entry, ...prev].slice(0, 300))
    })

    // T-513: Eine Meeting-Erkennung wird angezeigt. Die Aufnahme startet
    // der Rust-Main - der Renderer muss sie nur melden.
    const unsubMeetingDetected = transcriptApi.onMeetingDetected((detected) => {
      setMeetingDetected(detected)
      setToast({
        message:
          `Meeting detected (${detected.processName}). ${settingsRef.current.transcription.mode === 'batch' ? 'Local recording' : 'Transcription'} starts automatically.`,
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
      webSpeechRef.current?.abort()
      unsubSegment()
      unsubError()
      unsubStatus()
      unsubAudioActivity()
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
    if (autoScrollEnabledRef.current) list.scrollTop = list.scrollHeight

    return () => {
      list.removeEventListener('scroll', handleScroll)
    }
  }, [showStartPage])

  useEffect(() => {
    if (!autoScrollEnabled || !transcriptListRef.current) return
    const list = transcriptListRef.current
    const follow = () => { if (autoScrollEnabledRef.current) list.scrollTop = list.scrollHeight }
    follow()
    const observer = new ResizeObserver(follow)
    observer.observe(list)
    return () => observer.disconnect()
  }, [segments, speakerAliases, autoScrollEnabled, showStartPage])

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
      if (!status.running && !isSavingSettings && batchAction !== 'transcribe') {
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
  }, [status.running, isSavingSettings, batchAction])

  const savedFeatures = meetingSpeechFeatures(settings.transcription, configState?.config?.model)
  const draftFeatures = meetingSpeechFeatures(dialogSettings.transcription, configDraft.model)
  const { model: savedModel, mode: savedMode } = savedFeatures
  const draftModel = draftFeatures.model
  const isConfigReady = useMemo(() => {
    if (savedMode === 'batch') return true
    if (savedModel === 'unsupported') return false
    if (!savedFeatures.azure) return true
    if (!configState?.exists || !configState.config) {
      return false
    }

    return isConfigComplete(configState.config)
  }, [configState, savedFeatures.azure, savedModel, savedMode])

  const statusLabel = useMemo(() => {
    if (isStarting) return 'Starting'
    if (status.paused) return 'Paused'
    if (status.running) return savedMode === 'batch' ? 'Recording' : 'Running'
    if (configState && !isConfigReady) return 'Error'
    if (lastError) return 'Error'
    return 'Stopped'
  }, [configState, isConfigReady, isStarting, lastError, savedMode, status.paused, status.running])

  const statusDescription = useMemo(() => {
    if (isStarting) return savedMode === 'batch' ? 'Local recording is starting ...' : 'Transcription is starting ...'
    if (status.paused) return 'Transcription paused - the session stays active'
    if (status.running) return savedMode === 'batch' ? 'Recording audio locally' : 'Transcription active'
    if (!isConfigReady) return 'Configuration incomplete'
    return 'Ready to start'
  }, [isConfigReady, isStarting, savedMode, status.paused, status.running])

  const finalCount = segments.filter((segment) => segment.state === 'final').length
  const latestSegment = segments.at(-1) ?? null

  // Bekannte Sprecher als sessionsichere Identitaeten. Zwei Sitzungen
  // koennen dieselbe SDK-ID vergeben — die Identitaet trennt sie.
  const knownSpeakers = useMemo(() => identifiedSpeakers(segments), [segments])
  const speakerLabels = useMemo(() => defaultSpeakerLabels(knownSpeakers), [knownSpeakers])

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

  const addWebSpeechLog = (level: DebugLogEntry['level'], message: string) => {
    const entry: DebugLogEntry = { id: crypto.randomUUID(), timestampIso: new Date().toISOString(), source: 'main', level, message }
    setDebugLog((previous) => [entry, ...previous].slice(0, 300))
  }

  const onStart = async (requestedAtMs: number) => {
    if (startPendingRef.current || batchPendingRef.current) return
    startPendingRef.current = true
    setIsStarting(true)
    let web: WebSpeechSession | null = null
    let reservedWeb = false
    try {
      await settingsSaveQueueRef.current
      if (settingsSaveErrorRef.current) throw new Error(settingsSaveErrorRef.current)
      setLastError(null)
      const provider = settingsRef.current.transcription.provider
      const mode = settingsRef.current.transcription.mode ?? 'live'
      if (mode === 'unsupported' || (provider === 'unsupported' && mode === 'live')) throw new Error('Choose a supported meeting mode and transcription model.')
      const pendingSegments: TranscriptSegment[] = []
      let webStarted = false
      if (provider === 'web-speech' && mode === 'live') {
        if (!canUseWebSpeech()) throw new Error('Web Speech API is unavailable in this WebView2 runtime. Check the Windows installation and policies.')
        web = new WebSpeechSession({
          language: settingsRef.current.language,
          interimResults: settingsRef.current.transcription.webInterimResults,
          onRestart: () => {
            if (!web || webSpeechRef.current !== web) return
            const sessionId = web.sessionId
            setSegments((previous) => previous.filter((segment) => segment.sessionId !== sessionId || segment.state !== 'interim'))
            addWebSpeechLog('warn', 'Web Speech ended unexpectedly. Restarting recognition in the same recording.')
          },
          onSegment: (segment) => {
            if (webSpeechRef.current !== web) return
            if (!webStarted) pendingSegments.push(segment)
            else segmentReceiverRef.current(segment)
          },
          onEnded: (error) => {
            if (webSpeechRef.current !== web) return
            webSpeechRef.current = null
            setStatus((previous) => ({ ...previous, running: false, paused: false }))
            void window.transcriptApi.stop().catch(() => {})
            if (error) {
              addWebSpeechLog('error', error)
              setLastError({ code: 'WEB_SPEECH_ENDED', message: error })
              setToast({ message: error, variant: 'error', persistent: true })
            }
          },
        })
        webSpeechRef.current = web
      }
      clearTranscript()
      setSessionStartedAt(null)
      const next = await window.transcriptApi.start(provider ?? 'azure', mode, requestedAtMs)
      if (web) {
        reservedWeb = true
        if (webSpeechRef.current !== web) return
        await web.start()
        if (webSpeechRef.current !== web) return
      }
      // The native start event resets the transcript before the first segment.
      observeRecordingStart(next)
      webStarted = true
      pendingSegments.forEach(segmentReceiverRef.current)
      setNow(Date.now())
      setStatus(next)
      setToast({ message: mode === 'batch' ? 'Recording audio locally.' : 'New transcript started.', variant: 'info', persistent: false })
    } catch (error) {
      if (web) {
        web.abort()
        if (webSpeechRef.current !== web) return
        webSpeechRef.current = null
        if (reservedWeb) await window.transcriptApi.stop().catch(() => {})
      }
      const message = errorDetail(error, 'Start failed.')
      setLastError({ code: 'UI_START_FAILED', message })
      setToast({ message: `UI_START_FAILED: ${message}`, variant: 'error', persistent: true })
    } finally {
      startPendingRef.current = false
      setIsStarting(false)
    }
  }

  const onStop = async () => {
    const web = webSpeechRef.current
    let webError: unknown
    try {
      if (web) {
        try { await web.stop() } catch (error) { web.abort(); webError = error }
        if (webSpeechRef.current !== web) return
        webSpeechRef.current = null
      }
      const next = await window.transcriptApi.stop()
      prefillBatchAudio(next)
      setNow(Date.now())
      setStatus(next)
      if (webError) throw webError
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
      if (savedModel !== 'windows-sapi') setStatus(next)
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
      if (savedModel !== 'windows-sapi') setStatus(next)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Resume failed.'
      setLastError({ code: 'UI_RESUME_FAILED', message })
      setToast({ message: `UI_RESUME_FAILED: ${message}`, variant: 'error', persistent: true })
    }
  }

  const stopForSilenceRef = useRef(onStop)
  stopForSilenceRef.current = onStop
  const { stopOnSilence, silenceMinutes } = settings.autoStart
  const restartSilenceTimer = () => {
    if (status.startedAt) audioActivityRef.current = { startedAt: status.startedAt, at: performance.now() }
    setSilenceCountdown(null)
  }

  useEffect(() => {
    setSilenceCountdown(null)
    if (!stopOnSilence || !status.running || status.paused || !status.startedAt || webSpeechRef.current) return
    const startedAt = status.startedAt
    audioActivityRef.current = { startedAt, at: performance.now() }
    let warnedActivity: { startedAt: string; at: number } | null = null
    let deadline = 0
    const interval = window.setInterval(() => {
      const activity = audioActivityRef.current
      if (activity?.startedAt !== startedAt) return
      const now = performance.now()
      if (now - activity.at < silenceMinutes * 60_000) return
      if (warnedActivity !== activity) {
        warnedActivity = activity
        deadline = now + 60_000
        void window.transcriptApi.showSilenceWarning().catch((error) => {
          setToast({ message: errorDetail(error, 'Could not show the silence warning.'), variant: 'error', persistent: true })
          audioActivityRef.current = { startedAt, at: performance.now() }
          setSilenceCountdown(null)
        })
      }
      const remaining = Math.ceil((deadline - now) / 1000)
      if (remaining > 0) setSilenceCountdown(remaining)
      else {
        window.clearInterval(interval)
        setSilenceCountdown(null)
        void stopForSilenceRef.current()
      }
    }, 1000)
    return () => window.clearInterval(interval)
  }, [stopOnSilence, silenceMinutes, status.running, status.paused, status.startedAt])

  const onToggleRecording = async () => {
    const requestedAtMs = Date.now()
    if (status.running) {
      await onStop()
      return
    }

    await onStart(requestedAtMs)
  }

  const onResetTranscript = async () => {
    if (status.running || isStarting || batchPendingRef.current) return
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
    clearTranscript()
    setSessionStartedAt(null)
    setStatus((prev) => ({ ...prev, startedAt: undefined }))
  }

  const setIdleSettings = (update: React.SetStateAction<UserSettings>, azure?: AzureConfig) => {
    const previous = settingsRef.current
    const updated = typeof update === 'function' ? update(previous) : update
    const next = { ...updated, fileTranscription: updated.fileTranscription ?? fileTranscriptionDefaults(previous) }
    settingsRef.current = next
    setSettings(next)
    const revision = ++settingsSaveRevisionRef.current
    setIsSavingSettings(true)

    // Serialize full snapshots so rapid changes cannot overwrite one another.
    settingsSaveQueueRef.current = settingsSaveQueueRef.current.then(async () => {
      try {
        if (azure) {
          const savedConfig = await window.transcriptApi.saveConfig(azure)
          setConfigState(savedConfig)
          setConfigDraft(toConfigDraft(savedConfig.config))
        }
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

  const setLiveModel = (model: SpeechModel) => {
    const current = configState?.config ?? null
    const azure = isAzureSpeechModel(model) && model !== (current?.model ?? 'standard')
      ? { ...(current ?? { endpoint: '', region: '', speechKey: '', interimResults: true }), model }
      : undefined
    setIdleSettings((previous) => ({
      ...previous, transcription: {
        ...previous.transcription,
        provider: isAzureSpeechModel(model) ? undefined : model
      }
    }), azure)
  }

  const setLiveAzureInterim = (interimResults: boolean) => setIdleSettings((previous) => previous,
    { ...(configState?.config ?? { endpoint: '', region: '', speechKey: '' }), interimResults })

  const setFileDefaults = (update: Partial<FileTranscriptionSettings>) => setIdleSettings((previous) => ({
    ...previous, fileTranscription: { ...fileTranscriptionDefaults(previous), ...update }
  }))

  // Einziger Speichern-Pfad fuer den Settings-Dialog: der Button im
  // Dialog-Footer schreibt beide Abschnitte (Azure-Konfiguration inkl. Proxy
  // und Benutzereinstellungen). Die Benutzereinstellungen werden zuerst
  // geschrieben, damit eine unvollstaendige Azure-Konfiguration (z. B. beim
  // automatischen Oeffnen nach einem Start ohne Konfiguration) die
  // Sprache-/Geraete-Auswahl nicht verwerft.
  const onSaveAll = async () => {
    if (isSavingSettings || isStarting || batchPendingRef.current) return
    setIsSavingSettings(true)
    const snapshot = dialogSettings
    const revision = settingsSaveRevisionRef.current
    const save = settingsSaveQueueRef.current.then(async () => {
      const errors: string[] = []
      const liveAzure = draftFeatures.mode === 'live' && draftFeatures.azure
      const switchingToAzure = liveAzure && !!settingsRef.current.transcription.provider
      const azureChanged = JSON.stringify(configDraft) !== JSON.stringify(toConfigDraft(configState?.config ?? null))
      const saveAzure = async () => {
        const savedState = await window.transcriptApi.saveConfig(draftToConfig(configDraft, { allowIncomplete: !liveAzure }))
        setConfigState(savedState)
        setConfigDraft(toConfigDraft(savedState.config))
      }
      // Do not activate Azure before the incoming Azure draft has been saved.
      if (switchingToAzure) {
        try { await saveAzure() }
        catch (error) {
          const message = errorDetail(error, 'The Azure configuration could not be saved.')
          setIsSavingSettings(false)
          setSettingsHint(message)
          setToast({ message, variant: 'error', persistent: true })
          return
        }
      }

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
        if ((liveAzure || azureChanged) && !switchingToAzure) await saveAzure()
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
  const [connectivityKind, setConnectivityKind] = useState<'azure' | 'native' | 'web'>('azure')
  const returnToSettingsRef = useRef(true)

  const onTestConnectivity = async (fileModel?: 'windows-sapi') => {
    if (isTestingConnectivity || isStarting || status.running || batchPendingRef.current || (!fileModel && (draftModel === 'unsupported' || draftFeatures.mode === 'batch'))) return
    const kind = fileModel ? 'native' : draftFeatures.test
    const model = fileModel ?? draftModel
    returnToSettingsRef.current = !fileModel
    setSettingsDialogOpen(false)
    setConnectivityDialogOpen(true)
    setConnectivityResult(null)
    setToast(null)
    setIsTestingConnectivity(true)
    setConnectivityKind(kind)
    const startedAt = Date.now()
    let requestSubmitted = false
    try {
      if (kind === 'web') {
        const ready = canUseWebSpeech()
        setConnectivityResult({
          reachable: ready, speechReachable: ready, latencyMs: Date.now() - startedAt, probeUrl: '', testedAtIso: new Date().toISOString(),
          steps: [{ step: 'Web Speech API', status: ready ? 'ok' : 'error', detail: ready
            ? 'API exposed by WebView2. Microphone permission and online recognition were not tested.'
            : 'The API is not exposed by this WebView2 runtime.' }],
        })
        return
      }
      // Aktuelle Draft-Werte (auch ungespeicherte Änderungen) testen.
      const payload = kind === 'native'
        ? { provider: model, language: fileModel ? fileTranscriptionDefaults(settingsRef.current).language : dialogSettings.language }
        : {
        ...draftToConfig(configDraft),
        language: dialogSettings.language,
        autoLanguageDetection: dialogSettings.autoLanguageDetection,
        transcription: !draftFeatures.stereo
          ? { ...dialogSettings.transcription, audioMode: 'dual-mono' as const }
          : dialogSettings.transcription,
        diarization: draftFeatures.diarization && dialogSettings.diarization
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
      await window.transcriptApi.copyTranscript(labeledSegments, batchTranscriptStart)
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
  const labeledSegments = useMemo(() => labelSegments(segments, getSpeakerLabel), [segments, speakerAliases, speakerLabels])

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
  const persistTranscript = async (segmentsToExport: TranscriptSegment[], { reuseSaved = false, background = false, startedAt = undefined as string | undefined } = {}) => {
    if (!segmentsToExport.some((segment) => segment.state === 'final')) return
    const markdown = buildTranscriptMarkdown(segmentsToExport, new Date(), startedAt)
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

  const saveTranscriptWithToast = async (segmentsToExport: TranscriptSegment[], background = false, startedAt?: string) => {
    try {
      await persistTranscript(segmentsToExport, { background, startedAt })
    } catch (error) {
      const message = errorDetail(error, 'The transcript could not be saved.')
      setToast({ message, variant: 'error', persistent: true })
    }
  }

  const canUseBatchAudio = () => !isLoadingInitialData && !status.running && !startPendingRef.current && !batchPendingRef.current && !isSavingSettings

  const onPickBatchAudio = async (source: BatchAudioSource) => {
    if (!canUseBatchAudio()) return
    const generation = recordingGenerationRef.current
    batchPendingRef.current = true
    setBatchAction('pick')
    try {
      const path = await window.transcriptApi.pickBatchAudio()
      if (path === null) return
      const { startedAt, estimated } = await window.transcriptApi.inspectBatchAudio(path)
      if (recordingGenerationRef.current !== generation) throw new Error('A recording started while selecting audio. Choose the WAV again when idle.')
      setBatchAudioSlots((previous) => ({ ...previous, [source]: { path, startedAt: startedAt ?? '', estimated } }))
    } catch (error) {
      setToast({ message: errorDetail(error, 'The audio file could not be selected.'), variant: 'error', persistent: true })
    } finally {
      batchPendingRef.current = false
      setBatchAction(null)
    }
  }

  const onClearBatchAudio = (source: BatchAudioSource) => {
    setBatchAudioSlots((previous) => ({ ...previous, [source]: undefined }))
  }

  const onChangeBatchStart = (source: BatchAudioSource, startedAt: string) => {
    setBatchAudioSlots((previous) => {
      const slot = previous[source]
      return slot ? { ...previous, [source]: { ...slot, startedAt, estimated: false } } : previous
    })
  }

  const onTranscribeBatchAudio = async () => {
    if (!canUseBatchAudio() || settingsSaveFailed) return
    const batchModel = fileTranscriptionDefaults(settingsRef.current).model
    const reportBatchConfigurationError = (message: string) => {
      const entry: DebugLogEntry = { id: crypto.randomUUID(), timestampIso: new Date().toISOString(),
        source: 'ipc', level: 'error', message }
      setDebugLog((previous) => [entry, ...previous].slice(0, 300))
      setToast({ message, variant: 'error', persistent: true })
    }
    let tracks
    try {
      tracks = batchTracks(batchAudioSlots)
      if (tracks.length === 2 && tracks[0].path === tracks[1].path) throw new Error('Choose a different WAV for each audio source.')
    } catch (error) {
      setToast({ message: errorDetail(error, 'Check the selected audio.'), variant: 'error', persistent: true })
      return
    }
    if (!tracks.length) return
    const provider = batchModel === 'windows-sapi' ? batchModel : 'azure'
    const model = isAzureSpeechModel(batchModel) ? batchModel : undefined
    if (model) {
      const azure = configState?.config
      if (!azure?.region.trim() || !azure.speechKey.trim()) {
        reportBatchConfigurationError('Configure the Azure region and speech key in Settings before transcribing. Local recording does not require credentials.')
        return
      }
      if (!isBatchSpeechEndpoint(azure.batchEndpoint?.trim() || azure.endpoint, model)) {
        reportBatchConfigurationError('In Settings > Azure > File transcription endpoint, enter your resource endpoint, for example https://<resource>.cognitiveservices.azure.com.')
        return
      }
      const files = tracks.map(({ source, path }) => `${source === 'mic' ? 'Microphone' : 'Speaker'}: ${path}`).join('\n')
      if (!window.confirm(`Send the selected audio to Azure for transcription with ${BATCH_MODELS[batchModel]}?\n\n${files}`)) return
    }
    const generation = recordingGenerationRef.current
    batchPendingRef.current = true
    setBatchAction('transcribe')
    setToast(null)
    try {
      const result = await window.transcriptApi.transcribeBatchAudio(tracks, provider, model)
      const finals = result.filter((segment) => segment.state === 'final' && segment.text.trim())
      if (!finals.length) throw new Error(provider === 'windows-sapi'
        ? 'Windows SAPI recognized no speech. Check the selected language and listen to the WAV. See Debug log for input level and rejected speech. Your files and previous transcript are unchanged.'
        : 'No speech was recognized. The selected audio and previous transcript are unchanged.')
      if (recordingGenerationRef.current !== generation) throw new Error('A recording started while transcription was in progress. The selected audio is still available.')
      const startedAt = earliestTrackStart(tracks)
      setSegments(finals)
      setShowHome(false)
      setBatchTranscriptStart(startedAt)
      setSpeakerAliases({})
      autoScrollEnabledRef.current = true
      setAutoScrollEnabled(true)
      setLastError(null)
      if (settingsRef.current.transcript.markdownExport.enabled) {
        const labels = defaultSpeakerLabels(identifiedSpeakers(finals))
        await saveTranscriptWithToast(labelSegments(finals, (identity) => labels[identity]), false, startedAt)
      } else {
        setToast({ message: 'Batch transcript ready.', variant: 'info', persistent: false })
      }
    } catch (error) {
      setToast({ message: errorDetail(error, 'The selected audio could not be transcribed.'), variant: 'error', persistent: true })
    } finally {
      batchPendingRef.current = false
      setBatchAction(null)
    }
  }

  // Automatisch speichern, sobald die Live-Aufnahme endet.
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
      sessionActiveRef.current = savedMode === 'live'
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
  }, [status.running, savedMode])

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
        await persistTranscript(labeledSegments, { reuseSaved: true, startedAt: batchTranscriptStart })
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
  }, [quitExportRequest, labeledSegments, batchTranscriptStart])

  return {
    onToggleDevtools,
    onOpenRepository,
    configDraft,
    configState,
    savedFeatures,
    draftFeatures,
    draftModel,
    debugLog,
    debugOpen,
    devices,
    durationLabel,
    finalCount,
    getSpeakerLabel,
    isConfigReady,
    isLoadingInitialData,
    isStarting,
    batchAction,
    showStartPage,
    setShowHome,
    batchAudioSlots,
    fileDefaults,
    setFileDefaults,
    setLiveModel,
    setLiveAzureInterim,
    onPickBatchAudio,
    onClearBatchAudio,
    onChangeBatchStart,
    onCheckBatchModel: () => fileDefaults.model === 'windows-sapi' ? onTestConnectivity('windows-sapi') : Promise.resolve(),
    onTranscribeBatchAudio,
    knownSpeakers,
    lastError,
    latestSegment,
    onCopyTranscript,
    onExportTranscript: () => saveTranscriptWithToast(labeledSegments, false, batchTranscriptStart),
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
    connectivityKind,
    connectivityDialogOpen,
    connectivityFromSettings: returnToSettingsRef.current,
    onOpenConnectivityDialog: () => {
      returnToSettingsRef.current = true
      setSettingsDialogOpen(false)
      setConnectivityDialogOpen(true)
    },
    closeConnectivityDialog: () => {
      setConnectivityDialogOpen(false)
      if (returnToSettingsRef.current) setSettingsDialogOpen(true)
    },
    onToggleRecording,
    silenceCountdown,
    restartSilenceTimer,
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
