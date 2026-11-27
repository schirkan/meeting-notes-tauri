//! Tauri commands invoked from the renderer via the preload bridge.
//!
//! Naming + event payloads are kept in sync via
//! `src/shared/tauri-contract.ts` (single source of truth).

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tokio::sync::{Mutex, Semaphore, SemaphorePermit};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

use crate::connectivity;
use crate::events;
use crate::settings::{
    self, AppConfigState, AzureConfig, UserSettings,
};
use crate::sidecar::{self, SidecarHandle, SidecarOptions};
use crate::state::{
    AppState, DebugLogEntry, DebugLogEntryLevel, DebugLogEntrySource,
};

#[allow(unused_imports)]
pub use crate::state::{DebugLogEntryLevel as Level, DebugLogEntrySource as Source};

#[tauri::command]
pub fn toggle_devtools(window: tauri::WebviewWindow) {
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
}

#[tauri::command]
pub fn open_repository(app: AppHandle) -> Result<(), String> {
    #[allow(deprecated)]
    app.shell()
        .open("https://github.com/schirkan/meeting-notes-tauri", None)
        .map_err(|error| format!("The repository could not be opened: {error}"))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub flow: String,
    pub is_default: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSnapshot {
    pub inputs: Vec<DeviceInfo>,
    pub outputs: Vec<DeviceInfo>,
    pub fetched_at_iso: String,
}

fn empty_device_snapshot() -> DeviceSnapshot {
    DeviceSnapshot {
        inputs: vec![],
        outputs: vec![],
        fetched_at_iso: chrono::Utc::now().to_rfc3339(),
    }
}

fn push_and_emit_debug(
    app: &AppHandle,
    state: &AppState,
    source: DebugLogEntrySource,
    level: DebugLogEntryLevel,
    message: impl Into<String>,
) -> DebugLogEntry {
    let entry = state.push_debug(source, level, message);
    events::emit_debug(app, &entry);
    entry
}

// ---------- start / stop recording ----------

/// Excludes capture startup and connectivity probes, without making meeting
/// end events wait for a probe on the recording lifecycle lock.
pub(crate) struct CaptureStartGate(Semaphore);

impl Default for CaptureStartGate {
    fn default() -> Self {
        Self(Semaphore::new(1))
    }
}

impl CaptureStartGate {
    pub(crate) async fn lock(&self) -> SemaphorePermit<'_> {
        self.0
            .acquire()
            .await
            .expect("the capture start gate is never closed")
    }

    pub(crate) fn try_start(&self) -> Option<SemaphorePermit<'_>> {
        self.0.try_acquire().ok()
    }

    pub(crate) fn is_busy(&self) -> bool {
        self.0.available_permits() == 0
    }
}

#[tauri::command]
pub async fn start_recording(
    app: AppHandle,
    state: State<'_, AppState>,
    expected_provider: Option<String>,
    expected_mode: Option<String>,
    requested_at_ms: Option<i64>,
) -> Result<events::TranscriptStatus, String> {
    let requested_at_ms = requested_at_ms.or_else(|| Some(chrono::Utc::now().timestamp_millis()));
    let gate = app.state::<CaptureStartGate>();
    let _capture = gate.lock().await;
    let lifecycle = app.state::<Mutex<crate::autostart::RecordingLifecycle>>();
    let mut lifecycle = lifecycle.lock().await;
    start_recording_with_origin(&app, &state, &mut lifecycle, None, expected_provider.as_deref(), expected_mode.as_deref(), requested_at_ms).await
}

pub(crate) async fn start_recording_for_meeting(
    app: &AppHandle,
    origin: crate::autostart::MeetingDetectedPayload,
) -> Result<bool, String> {
    let requested_at_ms = chrono::Utc::now().timestamp_millis();
    // Never queue an automatic start behind either gate: its meeting could
    // end while the ordered detector consumer is waiting here.
    let gate = app.state::<CaptureStartGate>();
    let Some(_capture) = gate.try_start() else {
        return Ok(false);
    };
    let lifecycle = app.state::<Mutex<crate::autostart::RecordingLifecycle>>();
    let Ok(mut lifecycle) = lifecycle.try_lock() else {
        return Ok(false);
    };
    start_recording_with_origin(app, &app.state::<AppState>(), &mut lifecycle, Some(origin), None, None, Some(requested_at_ms)).await?;
    Ok(true)
}

async fn start_recording_with_origin(
    app: &AppHandle,
    state: &AppState,
    lifecycle: &mut crate::autostart::RecordingLifecycle,
    origin: Option<crate::autostart::MeetingDetectedPayload>,
    expected_provider: Option<&str>,
    expected_mode: Option<&str>,
    requested_at_ms: Option<i64>,
) -> Result<events::TranscriptStatus, String> {
    if app.state::<crate::tray::WindowBehavior>().protects_transcript() {
        return Err("Finish quitting before starting a new transcription.".into());
    }
    if state.snapshot_status().running {
        return Err("A transcription is already running.".into());
    }
    lifecycle.auto_origin = None;
    // Manual and automatic starts use one persisted snapshot for this sidecar.
    lifecycle.web_speech = false;
    lifecycle.sapi = false;
    lifecycle.windows_ai_speech = false;
    lifecycle.batch_recording = None;
    let settings::AppConfig { azure, user } = settings::load_app_config().await.map_err(|e| e.to_string())?;
    if expected_provider.is_some_and(|expected| expected != user.transcription.provider.as_str())
        || expected_mode.is_some_and(|expected| expected != user.transcription.mode.as_str()) {
        return Err("The saved transcription model changed. Reopen Settings before starting.".into());
    }
    if origin.is_some() && !user.auto_start.enabled {
        return Err("Automatic transcription start is disabled.".into());
    }
    push_and_emit_debug(app, state, DebugLogEntrySource::Ipc, DebugLogEntryLevel::Info, "start_recording called.");

    let batch = user.transcription.mode == settings::TranscriptionMode::Batch;
    if user.transcription.mode == settings::TranscriptionMode::Unsupported {
        return Err("The saved provider does not support the selected transcription mode.".into());
    }
    if !batch && user.transcription.provider == settings::RecognitionProvider::WebSpeech {
        if origin.is_some() { return Err("Web Speech API allows manual microphone start only.".into()); }
        lifecycle.web_speech = true;
        let status = state.mark_started();
        events::emit_status(app, &status);
        return Ok(status);
    }
    if !batch && origin.is_some() && user.transcription.provider == settings::RecognitionProvider::WindowsAiSpeech {
        return Err("Windows AI Speech allows manual microphone start only.".into());
    }
    let (handle, use_sapi, use_windows_ai_speech) = if batch {
        let root = crate::batch::recordings_directory(app)?;
        tokio::fs::create_dir_all(&root).await.map_err(|err| format!("Cannot open recording folder: {err}"))?;
        let started_at = crate::batch::capture_start(requested_at_ms, chrono::Utc::now())?;
        let (prefix, recording) = crate::batch::recording_outputs(&root, started_at, &user.transcription)?;
        let handle = sidecar::start_batch_recorder(app, &user, &root, &prefix, started_at.timestamp_millis()).map_err(|e| e.to_string())?;
        lifecycle.batch_recording = Some(recording);
        (handle, false, false)
    } else {
        let options = recording_options(azure, user)?;
        let use_sapi = options.use_sapi;
        let use_ai = options.transcription.provider == settings::RecognitionProvider::WindowsAiSpeech;
        let handle = sidecar::start(app, options).await.map_err(|e| e.to_string())?;
        (handle, use_sapi, use_ai)
    };

    // Cache the live handle so stop_recording can reach it. Das passiert vor
    // dem Start des Forwarders: der Handshake (T-201) wird ueber den Cache
    // quittiert, und der Forwarder laeuft bereits, bevor die erste Zeile
    // des Sidecars eintrifft.
    let cache = app.state::<Arc<Mutex<Option<SidecarHandle>>>>();
    {
        let mut guard = cache.lock().await;
        // Replace any stale handle (e.g. after a previous crash).
        // The CommandChild is wrapped in Arc<Mutex<Option<...>>> so the
        // orchestrator can keep writing via the original handle while
        // the cache owns another reference for stop_recording().
        *guard = Some(SidecarHandle {
            child: Arc::clone(&handle.child),
            events_rx: tokio::sync::mpsc::channel(1).1,
            shutdown: None,
        });
    }

    lifecycle.auto_origin = origin;
    lifecycle.sapi = use_sapi;
    lifecycle.windows_ai_speech = use_windows_ai_speech;
    let status = state.mark_started_at(lifecycle.batch_recording.as_ref().map(|recording| recording.started_at.as_str()));
    events::emit_status(app, &status);
    if let Some(origin) = lifecycle.auto_origin.as_ref() {
        events::emit_meeting_detected(app, origin);
    }
    spawn_event_forwarder(app.clone(), handle.events_rx, Arc::clone(&handle.child));

    // T-201: Ohne gueltiges Handshake wird der Sidecar beendet - ein
    // Sidecar, der nicht antwortet, wuerde sonst stumm bleiben.
    spawn_handshake_timeout(app.clone(), handle.child);

    push_and_emit_debug(app, state, DebugLogEntrySource::Status, DebugLogEntryLevel::Info, "Status changed: running.");
    Ok(status)
}

fn recording_options(azure: Option<AzureConfig>, user: settings::UserSettings) -> Result<SidecarOptions, String> {
    let mut options = SidecarOptions {
        sample_rate: 16_000,
        use_sapi: false,
        transcription: user.transcription,
        diarization: false,
        auto_language_detection: false,
        interim_results: false,
        language: Some(user.language),
        speech_key: None,
        speech_region: None,
        speech_model: settings::AzureSpeechModel::Standard,
        speech_endpoint: None,
        proxy: None,
        mic_device_id: user.devices.mic_id,
        speaker_device_id: user.devices.speaker_loopback_id,
    };
    match options.transcription.provider {
        settings::RecognitionProvider::WindowsSapi => {
            options.use_sapi = true;
            options.transcription.audio_mode = settings::AudioMode::DualMono;
        }
        settings::RecognitionProvider::WindowsAiSpeech => {
            options.transcription.mic = true;
            options.transcription.speaker = false;
            options.transcription.audio_mode = settings::AudioMode::DualMono;
            options.mic_device_id = None;
            options.speaker_device_id = None;
            options.language = None;
        }
        settings::RecognitionProvider::Azure => {
            let azure = azure.ok_or("The Azure configuration is missing or invalid. Check the transcription model and connection settings.")?;
            azure.check_connection_fields()?;
            options.diarization = user.diarization;
            options.auto_language_detection = user.auto_language_detection;
            options.interim_results = azure.interim_results;
            options.speech_key = Some(azure.speech_key);
            options.speech_region = Some(azure.region);
            options.speech_model = azure.model;
            options.speech_endpoint = (azure.model == settings::AzureSpeechModel::Standard).then_some(azure.endpoint);
            options.proxy = azure.proxy;
        }
        _ => return Err("The saved transcription model is unsupported. Choose a model in Settings.".into()),
    }
    Ok(options)
}

fn finish_web_recording(app: &AppHandle, state: &AppState) -> events::TranscriptStatus {
    let status = state.mark_stopped_with_error(None);
    events::emit_status(app, &status);
    status
}

#[tauri::command]
pub async fn stop_recording(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<events::TranscriptStatus, String> {
    let lifecycle = app.state::<Mutex<crate::autostart::RecordingLifecycle>>();
    let mut lifecycle = lifecycle.lock().await;
    let behavior = app.state::<crate::tray::WindowBehavior>();
    if behavior.is_quit_pending() {
        return Err("Finish or cancel quitting before stopping transcription.".into());
    }
    lifecycle.auto_origin = None;
    if std::mem::take(&mut lifecycle.web_speech) { return Ok(finish_web_recording(&app, &state)); }
    stop_recording_inner(&app, &state, false, lifecycle.batch_recording.take()).await
}

pub async fn stop_recording_for_quit(app: &AppHandle) -> Result<events::TranscriptStatus, String> {
    let lifecycle = app.state::<Mutex<crate::autostart::RecordingLifecycle>>();
    let mut lifecycle = lifecycle.lock().await;
    lifecycle.auto_origin = None;
    if std::mem::take(&mut lifecycle.web_speech) {
        // The renderer drains browser finals on the subsequent quit-export request.
        return Ok(finish_web_recording(app, &app.state::<AppState>()));
    }
    stop_recording_inner(app, &app.state::<AppState>(), true, lifecycle.batch_recording.take()).await
}

/// Only the process that automatically started this recording can end it.
/// Darf eine automatisch gestartete Aufnahme beim Session-Ende beendet werden?
///
/// Der automatische Stop haengt an zwei Optionen: der Auto-Start muss aktiv
/// sein und der Auto-Stop darf nicht einzeln abgeschaltet sein.
fn auto_stop_allowed(auto_start: &crate::settings::AutoStartSettings) -> bool {
    auto_start.enabled && auto_start.auto_stop
}

pub async fn stop_recording_for_meeting(
    app: &AppHandle,
    ended: &crate::autostart::MeetingEndedPayload,
) -> Result<bool, String> {
    let lifecycle = app.state::<Mutex<crate::autostart::RecordingLifecycle>>();
    let mut lifecycle = lifecycle.lock().await;
    let state = app.state::<AppState>();
    if !lifecycle.matches_end(ended) || !state.snapshot_status().running {
        return Ok(false);
    }
    // Der automatische Stop ist einzeln abschaltbar: der Start bleibt dann
    // bestehen, die Aufnahme laeuft aber bis zum manuellen Stop weiter.
    let user = settings::load_user_settings().await.map_err(|e| e.to_string())?;
    if !auto_stop_allowed(&user.auto_start) {
        return Ok(false);
    }
    lifecycle.auto_origin = None;
    stop_recording_inner(app, &state, false, lifecycle.batch_recording.take()).await.map(|_| true)
}

async fn stop_recording_inner(
    app: &AppHandle,
    state: &AppState,
    for_quit: bool,
    batch_recording: Option<events::BatchRecording>,
) -> Result<events::TranscriptStatus, String> {
    push_and_emit_debug(&app, &state, DebugLogEntrySource::Ipc, DebugLogEntryLevel::Info, "stop_recording called.");

    let cache = app.state::<Arc<Mutex<Option<SidecarHandle>>>>();
    let (tx, rx) = tokio::sync::oneshot::channel();
    let handle = {
        let mut guard = cache.lock().await;
        // The forwarder records a crash under this same cache lock, before
        // a confirmed Quit can mistake the now-idle session for a clean stop.
        if for_quit && guard.is_none() {
            if let Some(error) = state.take_stop_error() { return Err(error); }
        }
        guard.as_mut().map(|handle| {
            handle.shutdown = Some(tx);
            SidecarHandle {
                child: Arc::clone(&handle.child),
                events_rx: tokio::sync::mpsc::channel(1).1,
                shutdown: None,
            }
        })
    };
    let result = if let Some(handle) = handle {
        // Keep the process current until the forwarder has drained its output.
        let result = tokio::time::timeout(std::time::Duration::from_secs(15), async {
            sidecar::send_command(&handle, r#"{"type":"shutdown"}"#).await.map_err(|e| e.to_string())?;
            rx.await.map_err(|_| "The transcription service disconnected before shutdown completed.".to_string())?
        }).await.unwrap_or_else(|_| Err("The transcription service did not finish stopping within 15 seconds.".into()));
        if result.is_err() {
            let mut guard = cache.lock().await;
            if is_current_sidecar(guard.as_ref(), &handle.child) {
                guard.take();
                drop(guard);
                if let Err(error) = sidecar::kill(handle).await {
                    push_and_emit_debug(app, state, DebugLogEntrySource::Sidecar, DebugLogEntryLevel::Error, error.to_string());
                }
            }
        }
        result
    } else if state.snapshot_status().running {
        Err("No transcription service is running.".into())
    } else {
        return Ok(state.snapshot_status());
    };

    // Quit already presents its own failure; only remember errors it has not seen.
    let result = result.and_then(|()| match batch_recording {
        Some(recording) if crate::batch::recording_files_complete(&recording) => Ok(Some(recording)),
        Some(_) => Err("The audio recording did not finalize.".into()),
        None => Ok(None),
    });
    let stop_error = if for_quit { None } else { result.as_ref().err().cloned() };
    let status = state.finish_recording(stop_error, result.as_ref().ok().and_then(|path| path.clone()));
    push_and_emit_debug(app, state, DebugLogEntrySource::Status, DebugLogEntryLevel::Info, "Status changed: stopped.");
    events::emit_status(app, &status);
    result.map(|_| status)
}

fn require_running_recording(state: &AppState) -> Result<(), String> {
    if state.snapshot_status().running { Ok(()) }
    else { Err("No transcription is running.".into()) }
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;

    #[test]
    fn sapi_options_never_forward_azure_credentials_or_stereo() {
        let mut user = settings::default_user_settings();
        user.transcription.provider = settings::RecognitionProvider::WindowsSapi;
        user.transcription.audio_mode = settings::AudioMode::Stereo;
        let azure = serde_json::from_value(serde_json::json!({
            "endpoint":"https://example.test", "region":"westeurope", "speechKey":"unused-test-value",
            "interimResults":true, "proxy":{"host":"proxy.example.test","port":8080}
        })).unwrap();
        let opts = recording_options(Some(azure), user.clone()).unwrap();
        assert!(opts.use_sapi && opts.transcription.mic && opts.transcription.speaker);
        assert_eq!(opts.transcription.audio_mode, settings::AudioMode::DualMono);
        assert!(opts.speech_key.is_none() && opts.speech_endpoint.is_none() && opts.speech_region.is_none() && opts.proxy.is_none());
        assert!(!opts.diarization && !opts.auto_language_detection && !opts.interim_results);
        assert!(recording_options(None, user.clone()).is_ok());
        user.transcription.provider = settings::RecognitionProvider::Unsupported;
        assert!(recording_options(None, user).is_err());
    }

    #[test]
    fn windows_ai_speech_options_only_enable_default_mic_and_no_azure_credentials() {
        let user: settings::UserSettings = serde_json::from_value(serde_json::json!({
            "transcription": {"provider":"windows-ai-speech", "mic":false, "speaker":true, "audioMode":"stereo"},
            "devices":{"micId":"other-mic","speakerLoopbackId":"other-loopback"},
            "language":"en-GB"
        })).unwrap();
        assert_eq!(serde_json::to_value(&user).unwrap()["transcription"]["provider"], "windows-ai-speech");
        let opts = recording_options(None, user).unwrap();
        assert_eq!(opts.transcription.provider, settings::RecognitionProvider::WindowsAiSpeech);
        assert!(!opts.use_sapi && opts.transcription.mic && !opts.transcription.speaker);
        assert_eq!(opts.transcription.audio_mode, settings::AudioMode::DualMono);
        assert!(opts.language.is_none() && opts.mic_device_id.is_none() && opts.speaker_device_id.is_none());
        assert!(opts.speech_key.is_none() && opts.speech_region.is_none() && opts.speech_endpoint.is_none() && opts.proxy.is_none());
        assert!(!opts.diarization && !opts.auto_language_detection && !opts.interim_results);
    }

    #[tokio::test]
    async fn pause_waiting_for_automatic_stop_cannot_revive_the_recording() {
        let gate = Arc::new(Mutex::new(crate::autostart::RecordingLifecycle::default()));
        let state = Arc::new(AppState::default());
        state.mark_started();
        let stop_guard = gate.lock().await;
        let pause_state = state.clone();
        let pause_gate = gate.clone();
        let pause = tokio::spawn(async move {
            let _guard = pause_gate.lock().await;
            require_running_recording(&pause_state)?;
            pause_state.mark_paused();
            Ok::<_, String>(())
        });
        state.mark_stopped();
        drop(stop_guard);
        assert!(pause.await.unwrap().is_err());
        assert!(!state.snapshot_status().running);
        assert!(require_running_recording(&state).is_err(), "resume uses the same guard");
    }

    #[test]
    fn shutdown_requires_a_structured_stop_ack_and_a_successful_exit() {
        let ack = serde_json::json!({"type": "status", "payload": {"phase": "stopped", "running": false}});
        let log = serde_json::json!({"type": "status", "level": "info", "code": "stopped"});
        let paused = serde_json::json!({"type": "status", "payload": {"phase": "paused", "running": true}});
        assert!(check_sidecar_shutdown(Some(0), is_sidecar_shutdown_ack(&ack)).is_ok());
        assert!(check_sidecar_shutdown(Some(0), is_sidecar_shutdown_ack(&log)).is_err());
        assert!(check_sidecar_shutdown(Some(0), is_sidecar_shutdown_ack(&paused)).is_err());
        assert!(check_sidecar_shutdown(Some(1), is_sidecar_shutdown_ack(&ack)).is_err());
    }

    #[test]
    fn auto_stop_needs_both_the_auto_start_and_the_auto_stop_option() {
        let mut auto_start = crate::settings::AutoStartSettings::default();
        assert!(
            auto_stop_allowed(&auto_start),
            "Auto-start and auto-stop are enabled by default"
        );
        auto_start.auto_stop = false;
        assert!(
            !auto_stop_allowed(&auto_start),
            "A disabled auto-stop does not stop the recording"
        );
        auto_start.auto_stop = true;
        auto_start.enabled = false;
        assert!(
            !auto_stop_allowed(&auto_start),
            "Without auto-start there is nothing to stop automatically"
        );
    }
}

/// Pause (T-507): der Sidecar behaelt die Azure-Sitzung, speist aber
/// kein weiteres Audio zu. Die Sprecher-IDs der Sitzung bleiben damit
/// gueltig, und der pausierte Abschnitt wird nicht transkribiert.
#[tauri::command]
pub async fn pause_recording(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<events::TranscriptStatus, String> {
    let lifecycle = app.state::<Mutex<crate::autostart::RecordingLifecycle>>();
    let _lifecycle = lifecycle.lock().await;
    require_running_recording(&state)?;
    if _lifecycle.batch_recording.is_some() { return Err("Batch audio recording does not support pause.".into()); }
    if _lifecycle.windows_ai_speech { return Err("Windows AI Speech does not support pause.".into()); }
    push_and_emit_debug(&app, &state, DebugLogEntrySource::Ipc, DebugLogEntryLevel::Info, "pause_recording called.");

    let cache = app.state::<Arc<Mutex<Option<SidecarHandle>>>>();
    let handle = {
        let guard = cache.lock().await;
        guard.as_ref().map(|h| SidecarHandle {
            child: Arc::clone(&h.child),
            events_rx: tokio::sync::mpsc::channel(1).1,
            shutdown: None,
        })
    };
    if let Some(handle) = handle {
        sidecar::send_command(&handle, r#"{"type":"pause"}"#)
            .await
            .map_err(|e| e.to_string())?;
        push_and_emit_debug(
            &app,
            &state,
            DebugLogEntrySource::Sidecar,
            DebugLogEntryLevel::Info,
            "Pause command sent to the sidecar.",
        );
    } else {
        push_and_emit_debug(
            &app,
            &state,
            DebugLogEntrySource::Main,
            DebugLogEntryLevel::Warn,
            "Pause requested, but no sidecar is running.",
        );
        return Err("No sidecar is running.".into());
    }

    // SAPI acknowledges only after closing its capture and discarding buffered audio.
    if _lifecycle.sapi { return Ok(state.snapshot_status()); }
    let status = state.mark_paused();
    push_and_emit_debug(&app, &state, DebugLogEntrySource::Status, DebugLogEntryLevel::Info, "Status changed: paused.");
    events::emit_status(&app, &status);
    Ok(status)
}

/// Fortsetzen nach Pause: dieselbe Azure-Sitzung, dieselben Sprecher-IDs.
#[tauri::command]
pub async fn resume_recording(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<events::TranscriptStatus, String> {
    let lifecycle = app.state::<Mutex<crate::autostart::RecordingLifecycle>>();
    let _lifecycle = lifecycle.lock().await;
    require_running_recording(&state)?;
    if _lifecycle.batch_recording.is_some() { return Err("Batch audio recording does not support resume.".into()); }
    if _lifecycle.windows_ai_speech { return Err("Windows AI Speech does not support resume.".into()); }
    push_and_emit_debug(&app, &state, DebugLogEntrySource::Ipc, DebugLogEntryLevel::Info, "resume_recording called.");

    let cache = app.state::<Arc<Mutex<Option<SidecarHandle>>>>();
    let handle = {
        let guard = cache.lock().await;
        guard.as_ref().map(|h| SidecarHandle {
            child: Arc::clone(&h.child),
            events_rx: tokio::sync::mpsc::channel(1).1,
            shutdown: None,
        })
    };
    if let Some(handle) = handle {
        sidecar::send_command(&handle, r#"{"type":"resume"}"#)
            .await
            .map_err(|e| e.to_string())?;
        push_and_emit_debug(
            &app,
            &state,
            DebugLogEntrySource::Sidecar,
            DebugLogEntryLevel::Info,
            "Resume command sent to the sidecar.",
        );
    } else {
        push_and_emit_debug(
            &app,
            &state,
            DebugLogEntrySource::Main,
            DebugLogEntryLevel::Warn,
            "Resume requested, but no sidecar is running.",
        );
        return Err("No sidecar is running.".into());
    }

    if _lifecycle.sapi { return Ok(state.snapshot_status()); }
    let status = state.mark_resumed();
    push_and_emit_debug(&app, &state, DebugLogEntrySource::Status, DebugLogEntryLevel::Info, "Status changed: resumed.");
    events::emit_status(&app, &status);
    Ok(status)
}

#[tauri::command]
pub async fn reset_transcript(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let lifecycle = app.state::<Mutex<crate::autostart::RecordingLifecycle>>();
    let _guard = lifecycle.lock().await;
    if app.state::<crate::tray::WindowBehavior>().protects_transcript() {
        return Err("Finish quitting before clearing the transcript.".into());
    }
    if state.snapshot_status().running {
        return Err("Stop transcription before clearing the transcript.".into());
    }
    push_and_emit_debug(&app, &state, DebugLogEntrySource::Ipc, DebugLogEntryLevel::Info, "reset_transcript called.");

    // Transkript-Buffer wird vom Renderer gehalten. Hier nur ein
    // zentraler Log-Punkt + das Versenden eines optionalen
    // reset-Befehls an den laufenden Sidecar (best-effort).
    let cache = app.state::<Arc<Mutex<Option<SidecarHandle>>>>();
    let handle = {
        let guard = cache.lock().await;
        guard.as_ref().map(|h| SidecarHandle {
            child: Arc::clone(&h.child),
            events_rx: tokio::sync::mpsc::channel(1).1,
            shutdown: None,
        })
    };
    if let Some(handle) = handle {
        let _ = sidecar::send_command(&handle, r#"{"type":"reset"}"#).await;
        push_and_emit_debug(
            &app,
            &state,
            DebugLogEntrySource::Sidecar,
            DebugLogEntryLevel::Info,
            "Reset command sent to the sidecar.",
        );
    }

    push_and_emit_debug(
        &app,
        &state,
        DebugLogEntrySource::Main,
        DebugLogEntryLevel::Info,
        "Transcript reset.",
    );
    Ok(())
}

#[tauri::command]
pub async fn get_status(state: State<'_, AppState>) -> Result<events::TranscriptStatus, String> {
    Ok(state.snapshot_status())
}

#[tauri::command]
pub async fn get_debug_log(state: State<'_, AppState>) -> Result<Vec<DebugLogEntry>, String> {
    Ok(state.debug_log())
}

#[tauri::command]
pub async fn clear_debug_log(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let cleared = state.clear_debug_log();
    push_and_emit_debug(&app, &state, DebugLogEntrySource::Main, DebugLogEntryLevel::Info, format!("Debug log cleared ({cleared} entries)."));
    Ok(serde_json::json!({ "cleared": cleared }))
}

// ---------- devices ----------

pub(crate) fn background_command(program: &std::ffi::OsStr) -> std::process::Command {
    let mut command = std::process::Command::new(program);
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW; stdout/stderr bleiben nutzbar.
    }
    command
}

#[tauri::command]
pub async fn get_devices(app: AppHandle) -> Result<DeviceSnapshot, String> {
    // Wir rufen hier den **Sidecar-EXE selbst** auf, aber **nicht als
    // laufende Transkriptions-Instanz** — sondern im Device-Listing-
    // Modus (`--list-devices`). In diesem Modus emittiert der Sidecar
    // genau ein JSON-Lines-Event und beendet sich sofort wieder.
    // Das ist unabhängig vom laufenden Recording-Sidecar, der in
    // `start_recording` über `tauri-plugin-shell` gestartet wird und
    // dauerhaft transcribiert.
    //
    // Wir nutzen hier `std::process::Command` direkt (statt
    // tauri-plugin-shell), weil:
    //   1. Es ein One-Shot-Spawn ist (kein Stream, kein Event-Loop
    //      über mehrere Sekunden) — tauri-plugin-shell ist für
    //      langlebige Prozesse mit Stream-Kommunikation gedacht.
    //   2. `std::process::Command` ist `Send` und kann direkt aus
    //      `spawn_blocking` aufgerufen werden, ohne Borrow-Lifetime-
    //      Konflikte mit dem `tauri::AppHandle`.
    let exe_path = match sidecar::resolve_sidecar_path(&app) {
        Ok(p) => p,
        Err(e) => {
            push_and_emit_debug(
                &app,
                &app.state::<AppState>(),
                DebugLogEntrySource::Sidecar,
                DebugLogEntryLevel::Warn,
                format!("Sidecar EXE for the device listing not found: {e}"),
            );
            return Ok(empty_device_snapshot());
        }
    };

    // Sidecar-EXE benötigt ihre DLLs im selben Verzeichnis. Wir
    // lassen `std::process::Command` das Arbeitsverzeichnis
    // standardmäßig vom aktuellen Prozess erben. Im Portable liegt
    // der Single-File-Sidecar direkt neben der Haupt-EXE.
    // Wir setzen zusätzlich explizit das CWD auf das
    // Sidecar-EXE-Verzeichnis, falls resolve_sidecar_path mal einen
    // abweichenden Pfad liefern sollte.
    let cwd = exe_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());

    let result = tauri::async_runtime::spawn_blocking(move || -> Result<Option<DeviceSnapshot>, String> {
        let mut child = background_command(exe_path.as_os_str())
            .arg("--list-devices")
            .current_dir(&cwd)
            .spawn()
            .map_err(|e| format!("Sidecar spawn failed: {e}"))?;

        // stdout-Handle VOR kill() wegnehmen, damit die Pipe nicht
        // geschlossen wird, bevor wir gelesen haben.
        let mut stdout = child.stdout.take()
            .ok_or_else(|| "The sidecar did not provide a stdout stream.".to_string())?;
        let mut stderr = child.stderr.take();

        // Auf Prozess-Beendigung warten, max. 5 s.
        let start = std::time::Instant::now();
        let timeout = std::time::Duration::from_secs(5);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break, // Prozess beendet
                Ok(None) => {
                    if start.elapsed() >= timeout {
                        // Timeout: Prozess abwuergen, damit die
                        // Pipes geschlossen werden und read_to_string
                        // zurueckkehrt.
                        let _ = child.kill();
                        let _ = child.wait();
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(20));
                }
                Err(_) => break,
            }
        }

        use std::io::Read;
        let mut out = String::new();
        // read_to_string blockiert bis die Pipe geschlossen wird —
        // das passiert automatisch, sobald der Sidecar exit ist.
        let _ = stdout.read_to_string(&mut out);

        if let Some(mut err) = stderr.take() {
            let mut e = String::new();
            let _ = err.read_to_string(&mut e);
            if !e.trim().is_empty() {
                eprintln!("Sidecar stderr: {e}");
            }
        }

        if out.trim().is_empty() {
            return Ok(None);
        }

        // Parse: die Sidecar-Ausgabe ist genau eine JSON-Lines-Zeile
        // {"type":"device_list","payload":{...}}. Wir scannen alle
        // Zeilen und nehmen die erste mit type=="device_list".
        for line in out.lines() {
            if line.trim().is_empty() { continue; }
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(line) {
                let ty = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
                if ty == "device_list" {
                    if let Some(payload) = parsed.get("payload") {
                        if let Ok(snap) = serde_json::from_value::<SidecarDeviceSnapshot>(payload.clone()) {
                            return Ok(Some(DeviceSnapshot {
                                inputs: snap.inputs.into_iter().map(DeviceInfo::from).collect(),
                                outputs: snap.outputs.into_iter().map(DeviceInfo::from).collect(),
                                fetched_at_iso: snap.fetched_at_iso,
                            }));
                        }
                    }
                }
            }
        }
        Ok(None)
    })
    .await
    .map_err(|e| format!("Device listing task: {e}"))?;

    match result {
        Ok(Some(snap)) => {
            push_and_emit_debug(
                &app,
                &app.state::<AppState>(),
                DebugLogEntrySource::Sidecar,
                DebugLogEntryLevel::Info,
                format!(
                    "Device listing: {} inputs, {} outputs",
                    snap.inputs.len(),
                    snap.outputs.len()
                ),
            );
            Ok(snap)
        }
        Ok(None) => {
            push_and_emit_debug(
                &app,
                &app.state::<AppState>(),
                DebugLogEntrySource::Sidecar,
                DebugLogEntryLevel::Warn,
                "The sidecar exited without a device_list event - an empty snapshot was returned.",
            );
            Ok(empty_device_snapshot())
        }
        Err(e) => {
            push_and_emit_debug(
                &app,
                &app.state::<AppState>(),
                DebugLogEntrySource::Sidecar,
                DebugLogEntryLevel::Warn,
                format!("Device listing failed: {e}"),
            );
            Ok(empty_device_snapshot())
        }
    }
}

/// Hilfsstruktur, die dem vom Sidecar emittierten PascalCase-Snapshot
/// entspricht (`DeviceSnapshot` in `sidecar/DeviceResolver.cs`).
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
struct SidecarDeviceSnapshot {
    inputs: Vec<SidecarDeviceInfo>,
    outputs: Vec<SidecarDeviceInfo>,
    fetched_at_iso: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
struct SidecarDeviceInfo {
    id: String,
    name: String,
    flow: String,
    is_default: bool,
}

impl From<SidecarDeviceInfo> for DeviceInfo {
    fn from(value: SidecarDeviceInfo) -> Self {
        DeviceInfo {
            id: value.id,
            name: value.name,
            flow: value.flow,
            is_default: value.is_default,
        }
    }
}

#[cfg(test)]
mod device_deser_tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn background_process_has_no_console_and_preserves_output_pipes() {
        let powershell = std::path::PathBuf::from(std::env::var_os("SystemRoot").unwrap())
            .join(r"System32\WindowsPowerShell\v1.0\powershell.exe");
        let output = background_command(powershell.as_os_str())
            .args(["-NoProfile", "-Command", r#"
                Add-Type 'using System; using System.Runtime.InteropServices; public static class ConsoleProbe { [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); }';
                [Console]::WriteLine([ConsoleProbe]::GetConsoleWindow().ToInt64());
                [Console]::Error.WriteLine('stderr-ok');
            "#])
            .output()
            .expect("Hintergrundprozess muss starten");
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "0");
        assert_eq!(String::from_utf8_lossy(&output.stderr).trim(), "stderr-ok");
    }

    #[test]
    fn sidecar_device_snapshot_parses_pascal_case_payload() {
        // Auszug aus der tatsächlichen Sidecar-Ausgabe (siehe device-list.log).
        let line = r#"{"type":"device_list","payload":{"Inputs":[{"Id":"{0.0.1.00000000}.{abc}","Name":"Mikrofon","Flow":"input","IsDefault":true}],"Outputs":[{"Id":"{0.0.0.00000000}.{def}","Name":"Lautsprecher","Flow":"output","IsDefault":false}],"FetchedAtIso":"2026-06-27T22:00:00Z"}}"#;

        let parsed: serde_json::Value = serde_json::from_str(line).expect("outer json");
        let payload = parsed.get("payload").expect("payload field");
        let snap: SidecarDeviceSnapshot = serde_json::from_value(payload.clone())
            .expect("PascalCase deserialization must succeed");

        assert_eq!(snap.inputs.len(), 1);
        assert_eq!(snap.outputs.len(), 1);
        assert_eq!(snap.inputs[0].id, "{0.0.1.00000000}.{abc}");
        assert_eq!(snap.inputs[0].name, "Mikrofon");
        assert_eq!(snap.inputs[0].flow, "input");
        assert!(snap.inputs[0].is_default);
        assert_eq!(snap.outputs[0].is_default, false);
        assert_eq!(snap.fetched_at_iso, "2026-06-27T22:00:00Z");
    }

    #[test]
    fn stopped_or_replaced_sidecar_cannot_affect_the_current_session() {
        let previous = Arc::new(Mutex::new(None));
        let current = Arc::new(Mutex::new(None));
        let handle = SidecarHandle {
            child: Arc::clone(&current),
            events_rx: tokio::sync::mpsc::channel(1).1,
            shutdown: None,
        };
        assert!(!is_current_sidecar(None, &previous), "Intentional stop is not a crash");
        assert!(!is_current_sidecar(Some(&handle), &previous), "Old events/timeouts must not affect a restarted sidecar");
        assert!(is_current_sidecar(Some(&handle), &current));
    }

    #[test]
    fn status_log_is_not_a_recording_status_event() {
        let log = serde_json::json!({
            "type": "status", "level": "info", "code": "capturing", "message": "Active: mic + speaker loopback."
        });
        let parsed = parse_sidecar_log(&log).unwrap().expect("Flat status message must be routed as a log");
        assert_eq!(parsed.code, "capturing");
        let status = serde_json::json!({ "type": "status", "payload": { "phase": "started", "running": true } });
        assert!(parse_sidecar_log(&status).unwrap().is_none());
    }

    #[test]
    fn flat_error_logs_preserve_error_details_and_reject_malformed_logs() {
        let value = serde_json::json!({ "type": "error", "level": "error", "code": "SIDECAR_UNAVAILABLE", "message": "Capture failed" });
        let error = parse_sidecar_log(&value).unwrap().unwrap();
        assert_eq!(error.level, "error");
        assert_eq!(error.message, "Capture failed");
        assert!(parse_sidecar_log(&serde_json::json!({ "type": "status", "level": "info" })).is_err());
    }
}

// ---------- user settings ----------

#[tauri::command]
pub async fn get_user_settings(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<UserSettings, String> {
    push_and_emit_debug(&app, &state, DebugLogEntrySource::Ipc, DebugLogEntryLevel::Info, "get_user_settings called.");
    settings::load_user_settings().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_user_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: UserSettings,
) -> Result<UserSettings, String> {
    push_and_emit_debug(&app, &state, DebugLogEntrySource::Ipc, DebugLogEntryLevel::Info, "save_user_settings called.");
    let saved = settings::save_user_settings(settings).await.map_err(|e| e.to_string())?;
    crate::tray::apply_window_settings(&app, &saved.window);
    push_and_emit_debug(&app, &state, DebugLogEntrySource::Main, DebugLogEntryLevel::Info, "User settings saved.");
    Ok(saved)
}

// ---------- Azure config ----------

#[tauri::command]
pub async fn get_app_config(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<AppConfigState, String> {
    push_and_emit_debug(&app, &state, DebugLogEntrySource::Ipc, DebugLogEntryLevel::Info, "get_app_config called.");
    settings::get_app_config_state().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_fixed_config(
    app: AppHandle,
    state: State<'_, AppState>,
    config: AzureConfig,
) -> Result<AppConfigState, String> {
    push_and_emit_debug(&app, &state, DebugLogEntrySource::Ipc, DebugLogEntryLevel::Info, "save_fixed_config called.");
    settings::save_azure_config(config).await.map_err(|e| e.to_string())?;
    push_and_emit_debug(&app, &state, DebugLogEntrySource::Main, DebugLogEntryLevel::Info, "Azure configuration saved.");
    settings::get_app_config_state().await.map_err(|e| e.to_string())
}

// ---------- transcript export ----------

/// Write the transcript as a Markdown file with frontmatter (T-506).
/// The target directory comes from the user settings; without a
/// configured path the file lands next to the application EXE.
#[tauri::command]
pub async fn save_transcript_markdown(
    app: AppHandle,
    state: State<'_, AppState>,
    markdown: String,
) -> Result<String, String> {
    push_and_emit_debug(&app, &state, DebugLogEntrySource::Ipc, DebugLogEntryLevel::Info, "save_transcript_markdown called.");
    let path = settings::write_transcript_markdown(&markdown)
        .await
        .map_err(|e| e.to_string())?;
    let path = path.to_string_lossy().into_owned();
    push_and_emit_debug(&app, &state, DebugLogEntrySource::Main, DebugLogEntryLevel::Info, format!("Transcript saved as Markdown: {path}"));
    Ok(path)
}

// ---------- connectivity ----------

#[tauri::command]
pub async fn test_azure_connectivity(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: Option<serde_json::Value>,
) -> Result<connectivity::ConnectivityResult, String> {
    let gate = app.state::<CaptureStartGate>();
    let _probe = gate.lock().await;
    {
        // Let any capture shutdown finish, then release its lifecycle lock
        // before starting the probe. No new capture can start while _probe lives.
        let lifecycle = app.state::<Mutex<crate::autostart::RecordingLifecycle>>();
        let _lifecycle = lifecycle.lock().await;
        if state.snapshot_status().running {
            return Err("Stop transcription before testing the connection.".into());
        }
    }
    let value = payload.unwrap_or(serde_json::Value::Null);
    if let Some(provider) = value.get("provider") {
        let (flag, event, label) = match provider.as_str() {
            Some("windows-sapi") => ("--test-sapi", "sapi_probe", "Windows SAPI"),
            Some("windows-ai-speech") => ("--test-windows-ai-speech", "windows_ai_speech_probe", "Windows AI Speech"),
            _ => return Err("This model does not use the native connection test.".into()),
        };
        let language = (flag == "--test-sapi").then(|| value.get("language").and_then(|v| v.as_str()).unwrap_or("de-DE"));
        return test_native_readiness(&app, flag, event, label, language).await;
    }
    let config: AzureConfig = serde_json::from_value(value.clone())
        .map_err(|_| "Invalid Azure configuration. Check the model, region, speech key, endpoint and proxy.")?;
    config.check_connection_fields()?;
    if let Some(proxy) = config.proxy.as_ref() {
        connectivity::configured_proxy(proxy)?;
    }
    let language = value
        .get("language")
        .and_then(|v| v.as_str())
        .unwrap_or("de-DE")
        .to_string();

    push_and_emit_debug(
        &app,
        &state,
        DebugLogEntrySource::Ipc,
        DebugLogEntryLevel::Info,
        format!("test_azure_connectivity(model={}) called.", config.model.as_str()),
    );

    let audio = value.get("transcription").cloned()
        .map(serde_json::from_value::<settings::TranscriptionSettings>)
        .transpose().map_err(|_| "Invalid transcription settings.")?.unwrap_or_default();
    let diarization = value.get("diarization").map(settings::deserialize_diarization)
        .transpose().map_err(|_| "Invalid speaker recognition settings.")?.unwrap_or(true);
    let auto_language_detection = value.get("autoLanguageDetection").and_then(|v| v.as_bool()).unwrap_or(true);
    let start = std::time::Instant::now();
    let (mut result, speech) = tokio::join!(
        async {
            if config.model == settings::AzureSpeechModel::Standard {
                connectivity::diagnose(&config.endpoint, &config.speech_key, &language, config.proxy.as_ref()).await
            } else {
                connectivity::ConnectivityResult {
                    probe_url: String::new(),
                    reachable: false,
                    https_reachable: None,
                    speech_reachable: false,
                    http_status: None,
                    http_status_text: None,
                    latency_ms: 0,
                    error: None,
                    steps: vec![connectivity::Step {
                        step: "speech-model".into(),
                        status: connectivity::StepStatus::Ok,
                        detail: "MAI Transcribe uses the regional Speech SDK connection. The Standard HTTPS endpoint is not tested.".into(),
                    }],
                }
            }
        },
        sidecar::diagnose_speech(&app, &config, &language, &audio, diarization, auto_language_detection),
    );
    match speech {
        Ok(speech) => {
            result.speech_reachable = speech.reachable;
            result.steps.extend(speech.steps);
        }
        Err(error) => result.steps.push(connectivity::Step {
            step: "speech-wss".into(),
            status: connectivity::StepStatus::Error,
            detail: error,
        }),
    }
    result.reachable = result.https_reachable.unwrap_or(true) && result.speech_reachable;
    result.latency_ms = start.elapsed().as_millis() as u64;
    if !result.reachable {
        result.error = Some(match result.https_reachable {
            Some(https) => format!("HTTPS: {}; Speech/WSS: {}. See the separate diagnostic steps.",
                if https { "reachable" } else { "failed" },
                if result.speech_reachable { "reachable" } else { "failed" }),
            None => "MAI Transcribe Speech/WSS failed. See the diagnostic steps.".into(),
        });
    }

    // Bridge-Event: Renderer kann zuhören statt zu pollen
    events::emit_connectivity_result(&app, &result);
    Ok(result)
}

// ---------- clipboard ----------

async fn test_native_readiness(app: &AppHandle, flag: &str, event_type: &str, label: &str, language: Option<&str>) -> Result<connectivity::ConnectivityResult, String> {
    let start = std::time::Instant::now();
    let path = sidecar::resolve_sidecar_path(app).map_err(|e| e.to_string())?;
    let mut command = tokio::process::Command::from(background_command(path.as_os_str()));
    command.arg(flag);
    if let Some(language) = language { command.args(["--language", language]); }
    command.env_remove("MEETING_NOTES_SPEECH_KEY");
    command.kill_on_drop(true);
    let output = tokio::time::timeout(std::time::Duration::from_secs(12), command.output()).await
        .map_err(|_| format!("{label} did not report availability within 12 seconds."))?
        .map_err(|e| format!("The {label} check could not start: {e}"))?;
    let payload = String::from_utf8_lossy(&output.stdout).lines().find_map(|line| {
        let event: serde_json::Value = serde_json::from_str(line).ok()?;
        (event.get("type")?.as_str()? == event_type).then(|| event.get("payload").cloned()).flatten()
    }).ok_or_else(|| format!("{label} did not report availability."))?;
    let ready = payload.get("ready").and_then(|v| v.as_bool()) == Some(true) && output.status.success();
    let detail = payload.get("detail").and_then(|v| v.as_str()).map(str::to_string)
        .unwrap_or_else(|| format!("{label} availability could not be determined."));
    Ok(connectivity::ConnectivityResult {
        probe_url: String::new(), reachable: ready, https_reachable: None, speech_reachable: ready,
        http_status: None, http_status_text: None, latency_ms: start.elapsed().as_millis() as u64,
        error: (!ready).then(|| detail.clone()),
        steps: vec![connectivity::Step { step: label.into(), status: if ready { connectivity::StepStatus::Ok } else { connectivity::StepStatus::Error }, detail }],
    })
}
//
// Clipboard copy is done in the renderer via `navigator.clipboard`
// (WebView2 supports it natively) — the Rust side has no clipboard
// command any more. See `src/preload/index.ts` for the implementation.

// ---------- event forwarder (replacement for lib.rs::ensure_sidecar) ----------

fn is_current_sidecar(
    handle: Option<&SidecarHandle>,
    child: &Arc<Mutex<Option<CommandChild>>>,
) -> bool {
    handle.is_some_and(|handle| Arc::ptr_eq(&handle.child, child))
}

fn is_sidecar_shutdown_ack(parsed: &serde_json::Value) -> bool {
    parsed.get("level").is_none()
        && matches!(parsed["type"].as_str(), Some("status" | "transcript:status"))
        && parsed["payload"]["phase"] == "stopped"
        && parsed["payload"]["running"] == false
}

fn check_sidecar_shutdown(code: Option<i32>, acknowledged: bool) -> Result<(), String> {
    if code == Some(0) && acknowledged {
        Ok(())
    } else {
        Err(format!("The transcription service exited without completing shutdown (exit: {code:?})."))
    }
}

fn spawn_event_forwarder(
    app: AppHandle,
    mut events_rx: tokio::sync::mpsc::Receiver<tauri_plugin_shell::process::CommandEvent>,
    child: Arc<Mutex<Option<CommandChild>>>,
) {
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut acknowledged_shutdown = false;
        while let Some(event) = events_rx.recv().await {
            let cache = app_handle.state::<Arc<Mutex<Option<SidecarHandle>>>>();
            if !is_current_sidecar(cache.lock().await.as_ref(), &child) {
                // Intentional stop or a superseded process: never disturb a new session.
                return;
            }
            match event {
                tauri_plugin_shell::process::CommandEvent::Stdout(bytes) => {
                    let text = String::from_utf8_lossy(&bytes);
                    for line in text.lines() {
                        if line.is_empty() { continue; }
                        if !is_current_sidecar(cache.lock().await.as_ref(), &child) { return; }
                        // T-201: Das Handshake wird separat behandelt.
                        if handle_handshake_line(&app_handle, line, &child).await { continue; }
                        acknowledged_shutdown |= forward_sidecar_line(&app_handle, line);
                    }
                }
                tauri_plugin_shell::process::CommandEvent::Stderr(bytes) => {
                    let text = String::from_utf8_lossy(&bytes);
                    let entry = app_handle.state::<AppState>().push_debug(
                        DebugLogEntrySource::Sidecar,
                        DebugLogEntryLevel::Warn,
                        format!("stderr: {}", text.trim()),
                    );
                    events::emit_debug(&app_handle, &entry);
                }
                tauri_plugin_shell::process::CommandEvent::Error(err) => {
                    let entry = app_handle.state::<AppState>().push_debug(
                        DebugLogEntrySource::Sidecar,
                        DebugLogEntryLevel::Error,
                        format!("sidecar: {err}"),
                    );
                    events::emit_debug(&app_handle, &entry);
                }
                tauri_plugin_shell::process::CommandEvent::Terminated(payload) => {
                    let mut guard = cache.lock().await;
                    if !is_current_sidecar(guard.as_ref(), &child) { return; }
                    let shutdown = guard.take().and_then(|handle| handle.shutdown);
                    if let Some(shutdown) = shutdown {
                        let _ = shutdown.send(check_sidecar_shutdown(payload.code, acknowledged_shutdown));
                        return;
                    }
                    let exit_code = payload.code;
                    let status = app_handle.state::<AppState>().mark_stopped_with_error(Some(format!(
                        "The transcription service exited without completing shutdown (exit: {exit_code:?})."
                    )));
                    events::emit_status(&app_handle, &status);
                    let entry = app_handle.state::<AppState>().push_debug(
                        DebugLogEntrySource::Sidecar,
                        DebugLogEntryLevel::Error,
                        format!("The sidecar exited (exit={exit_code:?})."),
                    );
                    events::emit_debug(&app_handle, &entry);
                    events::emit_sidecar_crashed(
                        &app_handle,
                        &events::SidecarCrashedPayload { exit_code, last_error: None },
                    );
                }
                _ => {
                    // CommandEvent is #[non_exhaustive]; new variants land
                    // here until we add a dedicated arm.
                }
            }
        }
    });
}

/// T-201: Wertet eine Sidecar-Zeile auf ein Handshake-Event aus.
///
/// Gibt true zurueck, wenn die Zeile ein Handshake war - sie wird dann
/// nicht normal weitergeleitet.
async fn handle_handshake_line(
    app: &AppHandle,
    line: &str,
    child: &Arc<Mutex<Option<CommandChild>>>,
) -> bool {
    let parsed: serde_json::Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let ty = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
    if ty != "handshake" {
        return false;
    }
    let payload = parsed.get("payload").cloned().unwrap_or(serde_json::Value::Null);
    let version = payload
        .get("protocol_version")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let compatible =
        crate::protocol::version_at_least(&version, crate::protocol::MIN_PROTOCOL_VERSION);

    let cache = app.state::<Arc<Mutex<Option<SidecarHandle>>>>();
    let mut guard = cache.lock().await;
    if !is_current_sidecar(guard.as_ref(), child) { return true; }
    {
        let state = app.state::<AppState>();
        state.mark_handshake(&version);
        let entry = state.push_debug(
            DebugLogEntrySource::Sidecar,
            if compatible { DebugLogEntryLevel::Info } else { DebugLogEntryLevel::Error },
            format!("handshake: protocol_version={version} (kompatibel={compatible})"),
        );
        events::emit_debug(app, &entry);
    }

    let handle = if compatible {
        guard.as_ref().map(|h| SidecarHandle {
            child: Arc::clone(&h.child),
            events_rx: tokio::sync::mpsc::channel(1).1,
            shutdown: None,
        })
    } else {
        let handle = guard.take();
        let status = app.state::<AppState>().mark_stopped_with_error(Some(
            "The transcription service reported an incompatible protocol version.".into(),
        ));
        events::emit_status(app, &status);
        handle
    };
    drop(guard);
    if compatible {
        // Quittung an den Sidecar.
        if let Some(handle) = handle {
            let _ = sidecar::send_command(&handle, r#"{"type":"handshake-ack"}"#).await;
        }
    } else {
        // Inkompatible Version: den Sidecar beenden, statt ihn mit
        // unverstaendlichen Events weiterlaufen zu lassen.
        let entry = app.state::<AppState>().push_debug(
            DebugLogEntrySource::Sidecar,
            DebugLogEntryLevel::Error,
            format!(
                "handshake rejected: protocol version {version} is not supported (minimum {}).",
                crate::protocol::MIN_PROTOCOL_VERSION
            ),
        );
        events::emit_debug(app, &entry);
        events::emit_error(
            app,
            &serde_json::json!({
                "code": "PROTOCOL_VERSION_MISMATCH",
                "message": format!(
                    "The sidecar reports protocol version {version}, at least {} is expected.",
                    crate::protocol::MIN_PROTOCOL_VERSION
                ),
            }),
        );
        if let Some(handle) = handle {
            let _ = sidecar::stop(handle).await;
        }
    }
    true
}

/// T-201: Beendet den Sidecar, wenn er innerhalb des Zeitfensters kein
/// Handshake sendet.
fn spawn_handshake_timeout(app: AppHandle, child: Arc<Mutex<Option<CommandChild>>>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(
            crate::protocol::HANDSHAKE_TIMEOUT_SECS,
        ))
        .await;
        let cache = app.state::<Arc<Mutex<Option<SidecarHandle>>>>();
        let mut guard = cache.lock().await;
        if !is_current_sidecar(guard.as_ref(), &child) || guard.as_ref().is_some_and(|handle| handle.shutdown.is_some()) {
            return;
        }
        let (has_handshake, running) = {
            let state = app.state::<AppState>();
            (
                state.handshake_version().is_some(),
                state.snapshot_status().running,
            )
        };
        if has_handshake || !running {
            // Handshake kam, oder die Aufnahme wurde inzwischen gestoppt.
            return;
        }
        let handle = guard.take();
        let status = app.state::<AppState>().mark_stopped_with_error(Some(
            "The transcription service did not complete its handshake.".into(),
        ));
        events::emit_status(&app, &status);
        let entry = app.state::<AppState>().push_debug(
            DebugLogEntrySource::Sidecar,
            DebugLogEntryLevel::Error,
            format!(
                "No handshake from the sidecar within {} s - the sidecar will be stopped.",
                crate::protocol::HANDSHAKE_TIMEOUT_SECS
            ),
        );
        events::emit_debug(&app, &entry);
        events::emit_error(
            &app,
            &serde_json::json!({
                "code": "HANDSHAKE_TIMEOUT",
                "message": format!(
                    "The sidecar did not answer the handshake within {} s.",
                    crate::protocol::HANDSHAKE_TIMEOUT_SECS
                ),
            }),
        );
        drop(guard);
        if let Some(handle) = handle {
            let _ = sidecar::stop(handle).await;
        }
    });
}

#[derive(Deserialize)]
struct SidecarLog {
    level: String,
    code: String,
    message: String,
}

fn parse_sidecar_log(parsed: &serde_json::Value) -> Result<Option<SidecarLog>, serde_json::Error> {
    if parsed.get("level").is_none() { return Ok(None); }
    serde_json::from_value(parsed.clone()).map(Some)
}

fn forward_sidecar_line(app: &AppHandle, line: &str) -> bool {
    let parsed: serde_json::Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => {
            // T-201: Rate-Limit. Die erste fehlerhafte Zeile wird immer
            // geloggt, danach nur jede 1000. - sonst flutet ein kaputter
            // Sidecar das Debug-Log.
            let state = app.state::<AppState>();
            if let Some(count) = state.note_malformed_line() {
                let entry = state.push_debug(
                    DebugLogEntrySource::Sidecar,
                    DebugLogEntryLevel::Info,
                    format!("sidecar raw: {line}"),
                );
                events::emit_debug(app, &entry);
                if count > 1 {
                    let entry = state.push_debug(
                        DebugLogEntrySource::Sidecar,
                        DebugLogEntryLevel::Warn,
                        format!("{count} malformed sidecar lines (rate limit 1/1000)."),
                    );
                    events::emit_debug(app, &entry);
                }
            }
            return false;
        }
    };
    // Publish the stopped status after the shell has drained both pipes.
    if is_sidecar_shutdown_ack(&parsed) { return true; }
    let ty = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
    match parse_sidecar_log(&parsed) {
        Ok(Some(log)) => {
            let level = match log.level.as_str() {
                "info" | "debug" => DebugLogEntryLevel::Info,
                "error" => DebugLogEntryLevel::Error,
                _ => DebugLogEntryLevel::Warn,
            };
            let entry = app.state::<AppState>().push_debug(
                DebugLogEntrySource::Sidecar,
                level,
                format!("{ty}/{} [{}]: {}", log.level, log.code, log.message),
            );
            events::emit_debug(app, &entry);
            if log.level == "error" {
                events::emit_error(app, &serde_json::json!({ "code": log.code, "message": log.message }));
            }
            return false;
        }
        Err(error) => {
            let entry = app.state::<AppState>().push_debug(
                DebugLogEntrySource::Sidecar,
                DebugLogEntryLevel::Warn,
                format!("Invalid sidecar log entry: {error}"),
            );
            events::emit_debug(app, &entry);
            return false;
        }
        Ok(None) => {}
    }
    let payload = parsed.get("payload").cloned().unwrap_or(serde_json::Value::Null);

    match ty {
        "transcript" | "transcript:segment" => {
            // T-502: Die Pipe-Stufe (Sidecar-Event -> Rust) ergaenzen und
            // die Gesamtlatenz bis zum Tauri-Event berechnen. Die Messzeile
            // entsteht nur, wenn MEETING_NOTES_LATENCY_LOG gesetzt ist.
            let enriched = crate::latency::enrich(&payload);
            crate::latency::write_sample(&enriched);
            events::emit_segment(app, &enriched);
        }

        "status" | "transcript:status" => {
            let Some(running) = payload.get("running").and_then(|v| v.as_bool()) else {
                let entry = app.state::<AppState>().push_debug(
                    DebugLogEntrySource::Sidecar,
                    DebugLogEntryLevel::Warn,
                    "Invalid sidecar status event: running must be a boolean.",
                );
                events::emit_debug(app, &entry);
                return false;
            };
            let phase = payload.get("phase").and_then(|v| v.as_str()).unwrap_or("");
            // Die Phase steuert den Zustand: "paused"/"resumed" duerfen die
            // Startzeit nicht zuruecksetzen, sonst waere die Laufzeit nach
            // einer Pause falsch (T-507).
            let status = match phase {
                "paused" => app.state::<AppState>().mark_paused(),
                "resumed" => app.state::<AppState>().mark_resumed(),
                _ => {
                    if running {
                        app.state::<AppState>().mark_started()
                    } else {
                        app.state::<AppState>().mark_stopped()
                    }
                }
            };
            events::emit_status(app, &status);
            let entry = app.state::<AppState>().push_debug(
                DebugLogEntrySource::Status,
                DebugLogEntryLevel::Info,
                format!("sidecar status: phase={phase} running={running}"),
            );
            events::emit_debug(app, &entry);
        }
        "error" | "transcript:error" => {
            events::emit_error(app, &payload);
        }
        "debug" => {
            let entry = app.state::<AppState>().push_debug(
                DebugLogEntrySource::Sidecar,
                DebugLogEntryLevel::Info,
                payload.to_string(),
            );
            events::emit_debug(app, &entry);
        }
        "device_list" | "device-list" => {
            // Surface device-list payloads as a debug entry; full UI
            // integration lands when the renderer is taught to subscribe.
            let entry = app.state::<AppState>().push_debug(
                DebugLogEntrySource::Sidecar,
                DebugLogEntryLevel::Info,
                format!("device_list: {payload}"),
            );
            events::emit_debug(app, &entry);
        }
        _ => {
            let entry = app.state::<AppState>().push_debug(
                DebugLogEntrySource::Sidecar,
                DebugLogEntryLevel::Info,
                format!("sidecar unknown: {line}"),
            );
            events::emit_debug(app, &entry);
        }
    }
    false
}
