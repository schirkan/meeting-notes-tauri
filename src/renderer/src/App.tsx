import { useState } from 'react'
import { hasAzureConnectionFields } from '@shared/config-contract'
import { AboutDialog } from './components/AboutDialog'
import { ConfigPanel } from './components/ConfigPanel'
import { ConnectivityDialog } from './components/ConnectivityDialog'
import { DebugLogPanel } from './components/DebugLogPanel'
import { HeroStatusCard } from './components/HeroStatusCard'
import { ProxyPanel } from './components/ProxyPanel'
import { SettingsDialog } from './components/SettingsDialog'
import { AudioPanel } from './components/AudioPanel'
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
    batchAudioPath,
    onPickBatchAudio,
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
    onOpenConnectivityDialog,
    closeConnectivityDialog,
    onToggleRecording,
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
  const busy = isLoadingInitialData || isStarting || status.running || batchAction !== null
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
          settingsDisabled={batchAction !== null}
          pauseSupported={savedFeatures.pause}
          startDisabled={isLoadingInitialData || !isConfigReady || isSavingSettings || settingsSaveFailed || batchAction !== null}
          canCopyTranscript={finalCount > 0}
          canResetTranscript={!busy && segments.length > 0}
          durationLabel={durationLabel}
          startedAtLabel={startedAtLabel}
          speakersOpen={speakersOpen}
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
        <div className={`layout-grid console-grid ${speakersOpen ? '' : 'inspector-hidden'}`}>
          <TranscriptPanel
            segments={segments}
            transcriptListRef={transcriptListRef}
            getSpeakerLabel={getSpeakerLabel}
            speakerAliases={speakerAliases}
            setSpeakerAliases={setSpeakerAliases}
            following={autoScrollEnabled}
            onFollow={onFollowTranscript}
            idleControls={batch && !isLoadingInitialData && !status.running && !isStarting && (
              <section className="batch-audio-controls" aria-label="Batch transcription">
                <p className="meta">Batch mode: record locally, import a WAV or choose a completed recording’s recording.json file.</p>
                <div className="batch-audio-actions">
                  <button className="secondary-button" type="button" onClick={() => void onPickBatchAudio()}
                    disabled={batchAction !== null || isSavingSettings || settingsSaveFailed}>Import WAV or choose recording</button>
                  <button className="secondary-button" type="button" onClick={() => void onTranscribeBatchAudio()}
                    disabled={!batchAudioPath || batchAction !== null || isSavingSettings || settingsSaveFailed}>
                    {batchAction === 'transcribe' ? 'Transcribing…' : 'Transcribe'}
                  </button>
                </div>
                {batchAudioPath && <p className="meta-path">Selected audio: {batchAudioPath}</p>}
                {segments.length > 0 && <details><summary>Audio devices</summary>{audioPanel}</details>}
              </section>
            )}
            emptyContent={!isLoadingInitialData && !status.running && !isStarting && <div className="idle-audio-panel">
              {audioPanel}
            </div>}
          />
          <aside className="console-inspector" id="console-speakers" hidden={!speakersOpen} aria-labelledby="console-speakers-title">
            <SpeakerMappingPanel
              knownSpeakers={knownSpeakers}
              speakerLabels={speakerLabels}
              speakerAliases={speakerAliases}
              setSpeakerAliases={setSpeakerAliases}
            />
          </aside>
        </div>

        {debugVisible && <DebugLogPanel
          debugOpen={debugOpen}
          debugLog={debugLog}
          onOpenDebug={openDebugPanel}
          onCloseDebug={closeDebugPanel}
          onCopyDebug={onCopyDebugLog}
          onClearDebug={onClearDebugLog}
        />}
      </div>

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
              <button
                className="secondary-button"
                type="button"
                onClick={() => void onTestConnectivity()}
                disabled={busy || isTestingConnectivity || isSavingSettings || isChoosingDirectory || draftModel === 'unsupported' || (draftFeatures.azure && !hasAzureConnectionFields(configDraft))}
              >
                {isTestingConnectivity ? 'Testing …' : draftFeatures.azure ? draftFeatures.mode === 'batch' ? 'Test live connection' : 'Test connection' : 'Check model availability'}
              </button>
              {(connectivityResult || isTestingConnectivity) && (
                <button className="secondary-button" type="button" onClick={onOpenConnectivityDialog}>
                  {isTestingConnectivity ? 'Show running connection test' : 'Show last connection test'}
                </button>
              )}
              <button
                className="primary-button settings-save-button"
                type="button"
                onClick={() => void onSaveAll()}
                disabled={busy || isSavingSettings || isChoosingDirectory || draftModel === 'unsupported'}
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
          configDraft={configDraft}
          setConfigDraft={setConfigDraft}
          settings={dialogSettings}
          setSettings={setDialogSettings}
          onChooseDirectory={onChooseTranscriptDirectory}
          choosingDirectory={isChoosingDirectory}
        />

        <ConfigPanel
          configState={configState}
          configDraft={configDraft}
          statusRunning={status.running || isStarting}
          enabled={draftFeatures.azure}
          endpointEnabled={draftFeatures.endpoint}
          batch={draftFeatures.mode === 'batch'}
          setConfigDraft={setConfigDraft}
        />

        <ProxyPanel
          configDraft={configDraft}
          setConfigDraft={setConfigDraft}
          disabled={!draftFeatures.azure}
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
