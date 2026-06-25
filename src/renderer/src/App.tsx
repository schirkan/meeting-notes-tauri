import { ConfigPanel } from './components/ConfigPanel'
import { DebugLogPanel } from './components/DebugLogPanel'
import { HeroStatusCard } from './components/HeroStatusCard'
import { SettingsDialog } from './components/SettingsDialog'
import { SettingsPanel } from './components/SettingsPanel'
import { SpeakerMappingPanel } from './components/SpeakerMappingPanel'
import { TranscriptPanel } from './components/TranscriptPanel'
import { useAppState } from './use-app-state'

export function App() {
  const {
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
    latestSegment,
    onCopyTranscript,
    onClearDebugLog,
    onOpenSettingsDialog,
    onResetTranscript,
    onSaveConfig,
    onSaveSettings,
    onTestConnectivity,
    isTestingConnectivity,
    connectivityResult,
    onToggleRecording,
    openDebugPanel,
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
    closeDebugPanel,
    closeSettingsDialog,
    dismissToast
  } = useAppState()

  return (
    <main className="container">
      {configState?.exists === false && (
        <section className="hint">
          Azure-Konfiguration fehlt. Bitte <code>config/azure.json</code> im Formular unten speichern.
        </section>
      )}

      <div className="layout-grid">
        <TranscriptPanel
          segments={segments}
          transcriptListRef={transcriptListRef}
          getSpeakerClass={getSpeakerClass}
          getSpeakerLabel={getSpeakerLabel}
          canCopyTranscript={finalCount > 0}
          onCopyTranscript={onCopyTranscript}
        />

        <HeroStatusCard
          status={status}
          statusLabel={statusLabel}
          statusDescription={statusDescription}
          runtimeIssue={runtimeIssue}
          isStarting={isStarting}
          startDisabled={!isConfigReady}
          finalCount={finalCount}
          latestSegment={latestSegment}
          durationLabel={durationLabel}
          startedAtLabel={startedAtLabel}
          getSpeakerLabel={getSpeakerLabel}
          onOpenSettingsDialog={onOpenSettingsDialog}
          onToggleRecording={onToggleRecording}
          onResetTranscript={onResetTranscript}
        />

        <SpeakerMappingPanel
          knownSpeakers={knownSpeakers}
          speakerAliases={speakerAliases}
          setSpeakerAliases={setSpeakerAliases}
        />
      </div>

      <DebugLogPanel
        debugOpen={debugOpen}
        debugLog={debugLog}
        onOpenDebug={openDebugPanel}
        onCloseDebug={closeDebugPanel}
        onClearDebug={onClearDebugLog}
      />

      <SettingsDialog isOpen={settingsDialogOpen} onClose={closeSettingsDialog}>
        <SettingsPanel
          statusRunning={status.running}
          settings={settings}
          devices={devices}
          settingsError={settingsHint}
          setSettings={setSettings}
          onSaveSettings={onSaveSettings}
        />

        <ConfigPanel
          configState={configState}
          configDraft={configDraft}
          statusRunning={status.running}
          setConfigDraft={setConfigDraft}
          onSaveConfig={onSaveConfig}
          onTestConnectivity={onTestConnectivity}
          isTestingConnectivity={isTestingConnectivity}
          connectivityResult={connectivityResult}
        />
      </SettingsDialog>

      {toast && (
        toast.persistent ? (
          <div className={`toast toast-visible toast-${toast.variant} toast-persistent`.trim()} role="alert">
            <div className="toast-copyable-text">{toast.message}</div>
            <button className="toast-close-button" type="button" onClick={dismissToast} aria-label="Fehlermeldung schließen">
              Schließen
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
