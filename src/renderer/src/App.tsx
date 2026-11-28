import { useState } from 'react'
import { hasAzureConnectionFields } from '@shared/config-contract'
import { AboutDialog } from './components/AboutDialog'
import { BatchAudioPanel } from './components/BatchAudioPanel'
import { ConfigPanel } from './components/ConfigPanel'
import { ConnectivityDialog } from './components/ConnectivityDialog'
import { DebugLogPanel } from './components/DebugLogPanel'
import { HeroStatusCard } from './components/HeroStatusCard'
import { ProxyPanel } from './components/ProxyPanel'
import { SettingsDialog } from './components/SettingsDialog'
import { AudioPanel } from './components/AudioPanel'
import { LiveModelPanel } from './components/LiveModelPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { SpeakerMappingPanel } from './components/SpeakerMappingPanel'
import { TranscriptPanel } from './components/TranscriptPanel'
import { useAppState } from './use-app-state'

export function App() {
  const [aboutOpen, setAboutOpen] = useState(false)
  const [speakersOpen, setSpeakersOpen] = useState(false)
  const [debugVisible, setDebugVisible] = useState(false)
  const [debugShownBefore, setDebugShownBefore] = useState(false)
  const {
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
    showStartPage: home,
    setShowHome,
    batchAudioSlots,
    fileDefaults,
    setFileDefaults,
    setLiveModel,
    setLiveAzureInterim,
    onPickBatchAudio,
    onClearBatchAudio,
    onChangeBatchStart,
    onCheckBatchModel,
    onTranscribeBatchAudio,
    knownSpeakers,
    onCopyTranscript,
    onExportTranscript,
    autoScrollEnabled,
    onFollowTranscript,
    onCopyDebugLog,
    onClearDebugLog,
    onOpenSettingsDialog,
    onPause,
    onResetTranscript,
    onResume,
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
    connectivityFromSettings,
    onOpenConnectivityDialog,
    closeConnectivityDialog,
    onToggleRecording,
    silenceCountdown,
    restartSilenceTimer,
    openDebugPanel,
    runtimeIssue,
    segments,
    setConfigDraft,
    dialogSettings,
    setDialogSettings,
    onToggleDevtools,
    onOpenRepository,
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
    closeDebugPanel,
    closeSettingsDialog,
    dismissToast
  } = useAppState()
  const batch = savedFeatures.mode === 'batch'
  const canShowSpeakers = !home && (segments.length > 0 || (status.running && !batch))
  const showSpeakers = canShowSpeakers && speakersOpen
  const busy = isLoadingInitialData || isStarting || status.running || batchAction !== null
  const idle = !isLoadingInitialData && !isStarting && !status.running
  const controlsDisabled = batchAction !== null || isSavingSettings
  const startDisabled = isLoadingInitialData || !isConfigReady || controlsDisabled || settingsSaveFailed
  const showConnectionTest = draftFeatures.mode === 'live' && draftModel !== 'unsupported'
  const audioPanel = <AudioPanel statusRunning={batchAction !== null} batch={batch} settings={settings} devices={devices} setSettings={setIdleSettings}
    selectDevices={savedFeatures.selectDevices} speakerLoopback={savedFeatures.speakerLoopback} />

  return (
    <main className="container" onContextMenu={(event) => {
      const target = event.target
      if (target instanceof HTMLElement && target.isContentEditable) return
      const field = target instanceof Element ? target.closest('input, textarea') : null
      if (field instanceof HTMLTextAreaElement || (field instanceof HTMLInputElement
        && ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(field.type))) return
      event.preventDefault()
    }}>
      <div className="console-shell" inert={settingsDialogOpen || connectivityDialogOpen || aboutOpen} aria-hidden={settingsDialogOpen || connectivityDialogOpen || aboutOpen}>
        <HeroStatusCard
          status={status}
          statusLabel={statusLabel}
          statusDescription={statusDescription}
          runtimeIssue={runtimeIssue}
          isStarting={isStarting}
          batch={batch}
          settingsDisabled={controlsDisabled}
          pauseSupported={savedFeatures.pause}
          navigation={idle && segments.length > 0 ? <nav className="home-navigation" aria-label="View">
            <button type="button" aria-pressed={home} disabled={batchAction !== null} onClick={() => setShowHome(true)}>Home</button>
            <button type="button" aria-pressed={!home} disabled={batchAction !== null} onClick={() => setShowHome(false)}>Transcript</button>
          </nav> : null}
          canCopyTranscript={finalCount > 0}
          canResetTranscript={!busy && segments.length > 0}
          durationLabel={durationLabel}
          startedAtLabel={startedAtLabel}
          speakersOpen={showSpeakers}
          speakersDisabled={!canShowSpeakers}
          debugVisible={debugVisible}
          onToggleSpeakers={() => setSpeakersOpen((open) => !open)}
          onOpenAbout={() => setAboutOpen(true)}
          onToggleDevtools={onToggleDevtools}
          onToggleDebug={() => {
            if (!debugShownBefore) { openDebugPanel(); setDebugShownBefore(true) }
            setDebugVisible((visible) => !visible)
          }}
          onCopyTranscript={onCopyTranscript}
          onExportTranscript={onExportTranscript}
          onOpenSettingsDialog={onOpenSettingsDialog}
          onToggleRecording={onToggleRecording}
          onPause={onPause}
          onResume={onResume}
          onResetTranscript={onResetTranscript}
        />
        {home ? <div className="home-scroll"><div className="home-layout">
          <section className="home-workflow" aria-labelledby="record-workflow-heading">
            <header><h2 id="record-workflow-heading">Record a meeting</h2><p className="meta">Capture your microphone, speaker audio, or both.</p></header>
            <fieldset className="home-mode" aria-label="Transcription mode" disabled={batchAction !== null}>
              <label title="See the transcript as the meeting happens.">
                <input type="radio" name="meeting-mode" checked={settings.transcription.mode !== 'unsupported' && !batch}
                  onChange={() => setIdleSettings((previous) => ({ ...previous, transcription: { ...previous.transcription, mode: undefined } }))} /><span>Transcribe live</span>
              </label>
              <label title="Save WAVs locally. Choose a model when you transcribe the files on the right.">
                <input type="radio" name="meeting-mode" checked={batch}
                  onChange={() => setIdleSettings((previous) => ({ ...previous, transcription: { ...previous.transcription, mode: 'batch' } }))} /><span>Record for later</span>
              </label>
            </fieldset>
            {audioPanel}
            <div className="home-record-options">
              <div className="home-live" inert={batch}>
                <LiveModelPanel features={savedFeatures} settings={settings} disabled={controlsDisabled} azureInterim={configState?.config?.interimResults ?? true}
                  setSettings={setIdleSettings} onModelChange={setLiveModel} onAzureInterimChange={setLiveAzureInterim} />
                {!isConfigReady && savedFeatures.azure && <>
                  {savedFeatures.endpoint && !configState?.config?.endpoint.trim() && <p className="meta">The Azure Speech endpoint is missing.</p>}
                  <button type="button" disabled={controlsDisabled} onClick={onOpenSettingsDialog}>Configure Azure</button>
                </>}
                <button className="primary-button" type="button" disabled={startDisabled || !!runtimeIssue} onClick={() => void onToggleRecording()}>Start live transcription</button>
              </div>
              {batch && <button className="primary-button home-batch-start" type="button" disabled={startDisabled || !!runtimeIssue} onClick={() => void onToggleRecording()}>Start recording</button>}
            </div>
          </section>
          <BatchAudioPanel slots={batchAudioSlots} defaults={fileDefaults} action={batchAction}
            disabled={controlsDisabled} onDefaultsChange={setFileDefaults} onPick={onPickBatchAudio} onClear={onClearBatchAudio}
            onChangeStart={onChangeBatchStart} onCheckModel={onCheckBatchModel} onTranscribe={onTranscribeBatchAudio} />
        </div></div> : <div className={`layout-grid console-grid ${showSpeakers ? '' : 'inspector-hidden'}`}>
          <TranscriptPanel
            segments={segments}
            transcriptListRef={transcriptListRef}
            getSpeakerLabel={getSpeakerLabel}
            speakerAliases={speakerAliases}
            setSpeakerAliases={setSpeakerAliases}
            following={autoScrollEnabled}
            onFollow={onFollowTranscript}
          />
          <aside className="console-inspector" id="console-speakers" hidden={!showSpeakers} aria-labelledby="console-speakers-title">
            <SpeakerMappingPanel
              knownSpeakers={knownSpeakers}
              speakerLabels={speakerLabels}
              speakerAliases={speakerAliases}
              setSpeakerAliases={setSpeakerAliases}
            />
          </aside>
        </div>}

        {debugVisible && <DebugLogPanel
          debugOpen={debugOpen}
          debugLog={debugLog}
          onOpenDebug={openDebugPanel}
          onCloseDebug={closeDebugPanel}
          onCopyDebug={onCopyDebugLog}
          onClearDebug={onClearDebugLog}
        />}
      </div>

      {silenceCountdown !== null && <div className="silence-warning" role="status">
        <span>No audio detected. Recording will stop in {silenceCountdown}s.</span>
        <button type="button" onClick={restartSilenceTimer}>Keep recording</button>
        <button type="button" onClick={() => { restartSilenceTimer(); void onToggleRecording() }}>Stop now</button>
      </div>}

      <SettingsDialog
        isOpen={settingsDialogOpen && !isLoadingInitialData}
        busy={isSavingSettings || isChoosingDirectory}
        onClose={closeSettingsDialog}
        scrollable
        footer={
          <div className="settings-dialog-footer-content">
            <div className="settings-dialog-footer-copy">
              <p className="meta">After saving, window settings apply immediately. Transcription settings apply to the next session.</p>
              {configState && <p className="meta-path">Configuration: {configState.path}</p>}
            </div>
            <div className="settings-dialog-footer-actions">
              {showConnectionTest && <button
                className="secondary-button"
                type="button"
                onClick={() => void onTestConnectivity()}
                disabled={busy || isTestingConnectivity || isSavingSettings || isChoosingDirectory || (draftFeatures.azure && !hasAzureConnectionFields(configDraft))}
              >
                {isTestingConnectivity ? 'Testing …' : draftFeatures.azure ? 'Test connection' : 'Check model availability'}
              </button>}
              {showConnectionTest && connectivityFromSettings && (connectivityResult || isTestingConnectivity) && (
                <button className="secondary-button" type="button" onClick={onOpenConnectivityDialog}>
                  {isTestingConnectivity ? 'Show running connection test' : 'Show last connection test'}
                </button>
              )}
              <button
                className="primary-button settings-save-button"
                type="button"
                onClick={() => void onSaveAll()}
                disabled={busy || isSavingSettings || isChoosingDirectory}
              >
                Save
              </button>
            </div>
            {settingsHint && <div className="hint">{settingsHint}</div>}
          </div>
        }
      >
        <SettingsPanel
          statusRunning={status.running || isStarting}
          features={draftFeatures}
          settings={dialogSettings}
          setSettings={setDialogSettings}
          onChooseDirectory={onChooseTranscriptDirectory}
          choosingDirectory={isChoosingDirectory}
        />

        <ConfigPanel
          configState={configState}
          configDraft={configDraft}
          statusRunning={status.running || isStarting}
          liveAzure={draftFeatures.mode === 'live' && draftFeatures.azure}
          liveEndpointRequired={draftFeatures.mode === 'live' && draftFeatures.azure && draftFeatures.endpoint}
          setConfigDraft={setConfigDraft}
        />

        <ProxyPanel
          configDraft={configDraft}
          setConfigDraft={setConfigDraft}
        />
      </SettingsDialog>

      <AboutDialog isOpen={aboutOpen} onClose={() => setAboutOpen(false)} onOpenRepository={onOpenRepository} />

      <ConnectivityDialog
        isOpen={connectivityDialogOpen}
        isTesting={isTestingConnectivity}
        kind={connectivityKind}
        result={connectivityResult}
        onClose={closeConnectivityDialog}
      />

      {toast && (
        toast.persistent ? (
          <div className={`toast toast-visible toast-${toast.variant} toast-persistent`.trim()} role="alert">
            <div className="toast-copyable-text">{toast.message}</div>
            <button className="toast-close-button" type="button" onClick={dismissToast} aria-label="Close error message">
              Close
            </button>
          </div>
        ) : (
          <div className={`toast toast-visible toast-${toast.variant}`.trim()} role="status">
            {toast.message}
          </div>
        )
      )}
    </main>
  )
}
