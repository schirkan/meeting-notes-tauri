//! Local recording manifests and explicitly requested file transcription.
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::{DateTime, TimeDelta, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::{commands, connectivity, settings, sidecar, state::AppState};
use settings::{RecognitionProvider, TranscriptionMode};

pub(crate) fn recordings_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("Recordings"))
        .map_err(|err| format!("Cannot resolve the local recordings folder: {err}"))
}

#[tauri::command]
pub async fn pick_batch_audio(app: AppHandle) -> Result<Option<String>, String> {
    let mut dialog = app
        .dialog()
        .file()
        .add_filter("WAV or Meeting Notes recording", &["wav", "json"]);
    let directory = recordings_directory(&app)?;
    if directory.is_dir() {
        dialog = dialog.set_directory(directory);
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    dialog.pick_file(move |file| {
        let _ = tx.send(file);
    });
    rx.await
        .map_err(|_| "The audio picker closed unexpectedly.".to_string())?
        .map(|file| {
            file.into_path()
                .map(|path| path.to_string_lossy().into_owned())
                .map_err(|err| err.to_string())
        })
        .transpose()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecordingManifest {
    started_at: DateTime<Utc>,
    sources: Vec<RecordingSource>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
enum RecordingSource {
    Mic,
    Speaker,
}

impl RecordingSource {
    fn as_str(self) -> &'static str {
        match self {
            Self::Mic => "mic",
            Self::Speaker => "speaker",
        }
    }
}

async fn inputs(path: &Path) -> Result<(DateTime<Utc>, Vec<(&'static str, PathBuf)>), String> {
    let metadata = tokio::fs::metadata(path)
        .await
        .map_err(|err| format!("Cannot open audio input: {err}"))?;
    if !metadata.is_file() {
        return Err("Select a WAV file or a completed recording.json file.".into());
    }
    if path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("wav"))
    {
        // External WAV has no absolute meeting time; use job time as the display origin.
        return Ok((Utc::now(), vec![("", path.to_owned())]));
    }
    if path.file_name().and_then(|name| name.to_str()) != Some("recording.json")
        || metadata.len() > 4096
    {
        return Err("Select a WAV file or a completed recording.json file.".into());
    }
    let manifest: RecordingManifest =
        serde_json::from_slice(&tokio::fs::read(path).await.map_err(|e| e.to_string())?)
            .map_err(|_| "The recording manifest is not valid.".to_string())?;
    let sources = manifest.sources;
    if sources.is_empty() || sources.len() > 2 || (sources.len() == 2 && sources[0] == sources[1]) {
        return Err(
            "The recording manifest must specify one or two distinct audio sources.".into(),
        );
    }
    let directory = path.parent().ok_or("The recording has no parent folder.")?;
    let mut tracks = Vec::with_capacity(sources.len());
    for source in sources {
        let name = source.as_str();
        let path = directory.join(format!("{name}.wav"));
        // A recording manifest cannot redirect a cloud upload to another path.
        let track = tokio::fs::symlink_metadata(&path)
            .await
            .map_err(|_| format!("The recording is missing {name}.wav."))?;
        if !track.file_type().is_file() {
            return Err(format!(
                "The recording track {name}.wav is not a regular file."
            ));
        }
        tracks.push((name, path));
    }
    Ok((manifest.started_at, tracks))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatchPhrase {
    text: String,
    offset_ms: Option<u64>,
    speaker: Option<String>,
    language: Option<String>,
}

#[derive(Deserialize)]
struct BatchResult {
    segments: Vec<BatchPhrase>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchSegment {
    id: String,
    session_id: String,
    source: &'static str,
    speaker: String,
    speaker_identified: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    language: Option<String>,
    #[serde(rename = "timestampIso")]
    timestamp_iso: String,
    text: String,
    state: &'static str,
}

#[tauri::command]
pub async fn transcribe_batch_audio(
    app: AppHandle,
    path: String,
    expected_provider: String,
    expected_model: Option<String>,
) -> Result<Vec<BatchSegment>, String> {
    let gate = app.state::<commands::CaptureStartGate>();
    let _batch = gate
        .try_start()
        .ok_or("Another audio operation is in progress.")?;
    if app.state::<AppState>().snapshot_status().running
        || app
            .state::<crate::tray::WindowBehavior>()
            .protects_transcript()
    {
        return Err("Stop recording before transcribing a file.".into());
    }
    let settings::AppConfig { azure, user } = settings::load_app_config()
        .await
        .map_err(|err| err.to_string())?;
    let provider = user.transcription.provider;
    if user.transcription.mode != TranscriptionMode::Batch
        || !provider.supports_batch()
        || expected_provider != provider.as_str()
    {
        return Err("Select and save the intended Batch model before transcribing.".into());
    }
    let azure = if provider == RecognitionProvider::Azure {
        let config = azure.ok_or(
            "Enter Azure credentials before transcribing. The recording is still saved locally.",
        )?;
        if expected_model.as_deref() != Some(config.model.as_str()) {
            return Err(
                "The saved Azure model changed. Choose the file again before uploading.".into(),
            );
        }
        config.check_connection_fields()?;
        if config.endpoint.trim().is_empty() {
            return Err("Enter the Azure Speech resource endpoint for Fast Transcription.".into());
        }
        if let Some(proxy) = config.proxy.as_ref() {
            connectivity::configured_proxy(proxy)?;
        }
        Some(config)
    } else {
        None
    };
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err("Select an absolute path to an audio file or recording.".into());
    }
    let (origin, tracks) = inputs(&path).await?;
    let exe = sidecar::resolve_sidecar_path(&app).map_err(|err| err.to_string())?;
    let mut segments = Vec::new();
    for (source, path) in tracks {
        let mut command =
            tokio::process::Command::from(commands::background_command(exe.as_os_str()));
        command
            .arg("--transcribe-batch")
            .arg(path)
            .args([
                "--recognition-provider",
                provider.as_str(),
                "--language",
                &user.language,
                "--diarization-speaker",
                if user.diarization { "true" } else { "false" },
                "--auto-language-detection",
                if user.auto_language_detection {
                    "true"
                } else {
                    "false"
                },
            ])
            .env_remove("MEETING_NOTES_SPEECH_KEY")
            .env_remove("MEETING_NOTES_PROXY_USERNAME")
            .env_remove("MEETING_NOTES_PROXY_PASSWORD")
            .kill_on_drop(true);
        if let Some(config) = azure.as_ref() {
            command
                .args([
                    "--speech-model",
                    config.model.as_str(),
                    "--speech-endpoint",
                    config.endpoint.trim(),
                    "--speech-region",
                    config.region.trim(),
                ])
                .env("MEETING_NOTES_SPEECH_KEY", &config.speech_key);
            if let Some(proxy) = config.proxy.as_ref() {
                command
                    .args([
                        "--proxy-host",
                        proxy.host.trim(),
                        "--proxy-port",
                        &proxy.port.to_string(),
                    ])
                    .env(
                        "MEETING_NOTES_PROXY_USERNAME",
                        proxy.username.as_deref().unwrap_or(""),
                    )
                    .env(
                        "MEETING_NOTES_PROXY_PASSWORD",
                        proxy.password.as_deref().unwrap_or(""),
                    );
            }
        }
        let output = tokio::time::timeout(Duration::from_secs(1800), command.output())
            .await
            .map_err(|_| "File transcription timed out. The audio files were kept.".to_string())?
            .map_err(|err| format!("The file transcription worker could not start: {err}"))?;
        let result = parse_output(&output.stdout, output.status.success())?;
        let session_id = uuid::Uuid::new_v4().to_string();
        for phrase in result.segments {
            if phrase.text.trim().is_empty() {
                continue;
            }
            let speaker = phrase.speaker.unwrap_or_default();
            let speaker_identified =
                !speaker.trim().is_empty() && !speaker.trim().eq_ignore_ascii_case("unknown");
            let time = phrase
                .offset_ms
                .and_then(|ms| i64::try_from(ms).ok())
                .and_then(TimeDelta::try_milliseconds)
                .and_then(|delta| origin.checked_add_signed(delta))
                .unwrap_or(origin);
            segments.push((
                time,
                BatchSegment {
                    id: uuid::Uuid::new_v4().to_string(),
                    session_id: session_id.clone(),
                    source,
                    speaker,
                    speaker_identified,
                    language: phrase.language,
                    timestamp_iso: time.to_rfc3339(),
                    text: phrase.text,
                    state: "final",
                },
            ));
        }
    }
    segments.sort_by_key(|(time, _)| *time);
    Ok(segments.into_iter().map(|(_, segment)| segment).collect())
}

fn parse_output(stdout: &[u8], success: bool) -> Result<BatchResult, String> {
    let mut result = None;
    let mut error = None;
    for line in stdout.split(|byte| *byte == b'\n') {
        let Ok(event) = serde_json::from_slice::<serde_json::Value>(line) else {
            continue;
        };
        if event["code"] == "BATCH_TRANSCRIPTION_FAILED" {
            error = event["message"].as_str().map(str::to_owned);
        }
        if event["type"] == "batch_transcript" {
            result = serde_json::from_value(event["payload"].clone()).ok();
        }
    }
    if !success {
        return Err(
            error.unwrap_or_else(|| "File transcription failed. The audio files were kept.".into())
        );
    }
    result.ok_or_else(|| {
        "The worker did not return a file transcript. The audio files were kept.".into()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_explicit_worker_result_or_failure() {
        let ok = br#"{"type":"batch_transcript","payload":{"segments":[{"text":"hello","offsetMs":20,"speaker":null}]}}"#;
        assert_eq!(
            parse_output(ok, true).unwrap().segments[0].offset_ms,
            Some(20)
        );
        assert!(parse_output(ok, false).is_err());
        let failure =
            br#"{"type":"error","code":"BATCH_TRANSCRIPTION_FAILED","message":"Test failure"}"#;
        assert_eq!(
            parse_output(failure, false).err().as_deref(),
            Some("Test failure")
        );
    }

    #[test]
    fn batch_mode_is_opt_in_and_web_is_never_eligible() {
        let missing: settings::TranscriptionSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(missing.mode, TranscriptionMode::Live);
        let saved: settings::TranscriptionSettings =
            serde_json::from_str(r#"{"provider":"windows-sapi","mode":"batch"}"#).unwrap();
        assert_eq!(saved.mode, TranscriptionMode::Batch);
        assert!(saved.provider.supports_batch());
        assert!(!RecognitionProvider::WebSpeech.supports_batch());
        let invalid: settings::TranscriptionSettings =
            serde_json::from_str(r#"{"mic":false,"mode":42}"#).unwrap();
        assert_eq!(invalid.mode, TranscriptionMode::Unsupported);
        assert!(!invalid.mic);
    }

    #[tokio::test]
    async fn validates_manifest_before_transcribing_either_track() {
        let root =
            std::env::temp_dir().join(format!("meeting-notes-test-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir(&root).await.unwrap();
        let manifest = root.join("recording.json");
        tokio::fs::write(
            &manifest,
            br#"{"startedAt":"2026-11-26T12:00:00Z","sources":["mic","speaker"]}"#,
        )
        .await
        .unwrap();
        assert!(inputs(&manifest).await.is_err());
        tokio::fs::write(root.join("mic.wav"), b"mock")
            .await
            .unwrap();
        tokio::fs::write(root.join("speaker.wav"), b"mock")
            .await
            .unwrap();
        let (_, tracks) = inputs(&manifest).await.unwrap();
        assert_eq!(
            tracks,
            vec![
                ("mic", root.join("mic.wav")),
                ("speaker", root.join("speaker.wav"))
            ]
        );
        tokio::fs::write(
            &manifest,
            br#"{"startedAt":"2026-11-26T12:00:00Z","sources":["mic","mic"]}"#,
        )
        .await
        .unwrap();
        assert!(inputs(&manifest).await.is_err());
        tokio::fs::remove_dir_all(root).await.unwrap();
    }
}
