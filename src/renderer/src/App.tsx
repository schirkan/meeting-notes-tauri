import { useState } from 'react'
import { AboutDialog } from './components/AboutDialog'
import { ConfigPanel } from './components/ConfigPanel'
import { ConnectivityDialog } from './components/ConnectivityDialog'
import { DebugLogPanel } from './components/DebugLogPanel'
import { HeroStatusCard } from './components/HeroStatusCard'
import { ProxyPanel } from './components/ProxyPanel'
import { SettingsDialog } from './components/SettingsDialog'
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
    onCopyTranscript,
    onExportTranscript,
    autoScrollEnabled,
    onFollowTranscript,
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
          startDisabled={isLoadingInitialData || !isConfigReady || isSavingSettings || settingsSaveFailed}
          canCopyTranscript={finalCount > 0}
          canResetTranscript={!status.running && !isStarting && segments.length > 0}
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
            emptyContent={!isLoadingInitialData && !status.running && !isStarting && <div className="idle-audio-panel">
              <SettingsPanel audioOnly statusRunning={false} settings={settings} devices={devices} setSettings={setIdleSettings} onChooseDirectory={onChooseTranscriptDirectory} />
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
              <p className="meta">Changes apply to the next recording after saving.</p>
              {configState && <p className="meta-path">Configuration: {configState.path}</p>}
            </div>
            <div className="settings-dialog-footer-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => void onTestConnectivity()}
                disabled={isTestingConnectivity || isSavingSettings || isChoosingDirectory || !configDraft.endpoint || !configDraft.speechKey || !configDraft.region}
              >
                {isTestingConnectivity ? 'Testing …' : 'Test connection'}
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
                disabled={status.running || isSavingSettings || isChoosingDirectory}
              >
                Save
              </button>
            </div>
            {settingsHint && <div className="hint">{settingsHint}</div>}
          </div>
        }
      >
        <SettingsPanel
          statusRunning={status.running}
          settings={dialogSettings}
          devices={devices}
          setSettings={setDialogSettings}
          onChooseDirectory={onChooseTranscriptDirectory}
          choosingDirectory={isChoosingDirectory}
        />

        <ConfigPanel
          configState={configState}
          configDraft={configDraft}
          statusRunning={status.running}
          setConfigDraft={setConfigDraft}
        />

        <ProxyPanel
          configDraft={configDraft}
          statusRunning={status.running}
          setConfigDraft={setConfigDraft}
        />
      </SettingsDialog>

      <AboutDialog isOpen={aboutOpen} onClose={() => setAboutOpen(false)} onOpenRepository={onOpenRepository} />

      <ConnectivityDialog
        isOpen={connectivityDialogOpen}
        isTesting={isTestingConnectivity}
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
