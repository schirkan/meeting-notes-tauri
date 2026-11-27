//! Local WAV captures and explicitly requested file transcription.
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::{DateTime, TimeDelta, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::{commands, connectivity, events::BatchRecording, settings, sidecar, state::AppState};
use settings::{AzureSpeechModel, RecognitionProvider};

pub(crate) fn recordings_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("Recordings"))
        .map_err(|err| format!("Cannot resolve the local recordings folder: {err}"))
}

#[tauri::command]
pub async fn pick_batch_audio(app: AppHandle) -> Result<Option<String>, String> {
    let mut dialog = app.dialog().file().add_filter("WAV audio", &["wav"]);
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

const RECORDING_STAMP: &str = "%Y%m%dT%H%M%S%3fZ";

pub(crate) fn capture_start(
    requested_ms: Option<i64>,
    now: DateTime<Utc>,
) -> Result<DateTime<Utc>, String> {
    let requested = requested_ms.unwrap_or_else(|| now.timestamp_millis());
    let started_at =
        DateTime::from_timestamp_millis(requested).ok_or("Invalid recording start time.")?;
    if !(-1_000..=60_000).contains(&now.timestamp_millis().saturating_sub(requested)) {
        return Err("The recording start request expired. Please start again.".into());
    }
    Ok(started_at)
}

pub(crate) fn recording_outputs(
    root: &Path,
    start: DateTime<Utc>,
    sources: &settings::TranscriptionSettings,
) -> Result<(String, BatchRecording), String> {
    if !sources.mic && !sources.speaker {
        return Err("Select at least one audio source.".into());
    }
    let prefix = format!("{}-{}", start.format(RECORDING_STAMP), uuid::Uuid::new_v4());
    let path = |source: &str| {
        root.join(format!("{prefix}-{source}.wav"))
            .to_string_lossy()
            .into_owned()
    };
    let recording = BatchRecording {
        started_at: start.to_rfc3339(),
        mic_path: sources.mic.then(|| path("mic")),
        speaker_path: sources.speaker.then(|| path("speaker")),
    };
    Ok((prefix, recording))
}

pub(crate) fn recording_files_complete(recording: &BatchRecording) -> bool {
    let mut paths = [recording.mic_path.as_ref(), recording.speaker_path.as_ref()]
        .into_iter()
        .flatten()
        .peekable();
    paths.peek().is_some()
        && paths.all(|p| std::fs::symlink_metadata(p).is_ok_and(|m| m.is_file() && m.len() > 44))
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

fn filename_start(path: &Path) -> Option<DateTime<Utc>> {
    let (stamp, rest) = path.file_stem()?.to_str()?.split_once('-')?;
    let (id, source) = rest.rsplit_once('-')?;
    if !matches!(source, "mic" | "speaker") || uuid::Uuid::parse_str(id).is_err() {
        return None;
    }
    chrono::NaiveDateTime::parse_from_str(stamp, RECORDING_STAMP)
        .ok()
        .map(|t| t.and_utc())
}

async fn wav_metadata(path: &Path) -> Result<std::fs::Metadata, String> {
    if !path.is_absolute()
        || !path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("wav"))
    {
        return Err("Select a WAV file.".into());
    }
    let metadata = tokio::fs::symlink_metadata(path)
        .await
        .map_err(|err| format!("Cannot open audio input: {err}"))?;
    if !metadata.is_file() {
        return Err("The selected WAV is not a regular file.".into());
    }
    Ok(metadata)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioTiming {
    #[serde(skip_serializing_if = "Option::is_none")]
    started_at: Option<DateTime<Utc>>,
    estimated: bool,
}

#[tauri::command]
pub async fn inspect_batch_audio(path: String) -> Result<AudioTiming, String> {
    let path = Path::new(&path);
    let metadata = wav_metadata(path).await?;
    if let Some(started_at) = filename_start(path) {
        return Ok(AudioTiming {
            started_at: Some(started_at),
            estimated: false,
        });
    }
    // Creation can reflect a copy; last modification may be the end of recording.
    Ok(AudioTiming {
        started_at: metadata
            .created()
            .or_else(|_| metadata.modified())
            .ok()
            .map(DateTime::from),
        estimated: true,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputTrack {
    path: PathBuf,
    source: RecordingSource,
    started_at: Option<DateTime<Utc>>,
}

async fn validate_tracks(tracks: &[InputTrack]) -> Result<(), String> {
    if tracks.is_empty()
        || tracks.len() > 2
        || (tracks.len() == 2 && tracks[0].source == tracks[1].source)
    {
        return Err("Choose one or two distinct WAV sources.".into());
    }
    let mut paths = Vec::with_capacity(tracks.len());
    for track in tracks {
        wav_metadata(&track.path).await?;
        if track.started_at.is_none() {
            return Err("Choose the recording start time for every audio source.".into());
        }
        paths.push(
            tokio::fs::canonicalize(&track.path)
                .await
                .map_err(|err| err.to_string())?,
        );
    }
    if paths.len() == 2 && paths[0] == paths[1] {
        return Err("Select a different WAV file for each audio source.".into());
    }
    Ok(())
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
    tracks: Vec<InputTrack>,
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
    let provider = settings::parse_provider(Some(&expected_provider));
    if !provider.supports_batch() {
        return Err("Select a supported Batch model before transcribing.".into());
    }
    if provider == RecognitionProvider::WindowsAiSpeech && tracks.len() > 1 {
        return Err("Windows AI Speech only supports one file because it does not return segment timestamps.".into());
    }
    validate_tracks(&tracks).await?;
    let azure = if provider == RecognitionProvider::Azure {
        let mut config = azure.ok_or(
            "Enter Azure credentials before transcribing. The recording is still saved locally.",
        )?;
        config.model = match expected_model.as_deref() {
            Some("standard") => AzureSpeechModel::Standard,
            Some("mai-transcribe-2-streaming") => AzureSpeechModel::MaiTranscribe2Streaming,
            _ => return Err("Select a supported Azure Batch model.".into()),
        };
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
    let exe = sidecar::resolve_sidecar_path(&app).map_err(|err| err.to_string())?;
    let mut segments = Vec::new();
    let multiple = tracks.len() > 1;
    for track in tracks {
        let source = track.source.as_str();
        let origin = track.started_at.ok_or("Missing start time.")?;
        let mut command =
            tokio::process::Command::from(commands::background_command(exe.as_os_str()));
        command
            .arg("--transcribe-batch")
            .arg(track.path)
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
            let time = phrase_time(origin, phrase.offset_ms, multiple)?;
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

fn phrase_time(
    origin: DateTime<Utc>,
    offset_ms: Option<u64>,
    multiple: bool,
) -> Result<DateTime<Utc>, String> {
    if offset_ms.is_none() && !multiple {
        return Ok(origin);
    }
    offset_ms
        .and_then(|ms| i64::try_from(ms).ok())
        .and_then(TimeDelta::try_milliseconds)
        .and_then(|offset| origin.checked_add_signed(offset))
        .ok_or_else(|| {
            "A result is missing a usable timestamp, so the transcript cannot be ordered reliably."
                .into()
        })
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
        use settings::TranscriptionMode;
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
    async fn produces_distinct_wav_names_and_validates_both_tracks() {
        let root =
            std::env::temp_dir().join(format!("meeting-notes-test-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir(&root).await.unwrap();
        let now = Utc::now();
        let start = capture_start(Some(now.timestamp_millis() - 2345), now).unwrap();
        assert!(capture_start(Some(now.timestamp_millis() - 60_001), now).is_err());
        let settings = settings::TranscriptionSettings::default();
        let (prefix, recorded) = recording_outputs(&root, start, &settings).unwrap();
        assert_ne!(
            prefix,
            recording_outputs(&root, start, &settings).unwrap().0
        );
        let mic = PathBuf::from(recorded.mic_path.as_ref().unwrap());
        let speaker = PathBuf::from(recorded.speaker_path.as_ref().unwrap());
        assert_eq!(filename_start(&mic), Some(start));
        assert_eq!(filename_start(&speaker), Some(start));
        assert_eq!(filename_start(Path::new("other.wav")), None);
        let mut tracks = vec![
            InputTrack {
                path: mic.clone(),
                source: RecordingSource::Mic,
                started_at: Some(start),
            },
            InputTrack {
                path: speaker.clone(),
                source: RecordingSource::Speaker,
                started_at: Some(start),
            },
        ];
        tokio::fs::write(&mic, [0; 80]).await.unwrap();
        assert!(validate_tracks(&tracks).await.is_err());
        assert!(!recording_files_complete(&recorded));
        tokio::fs::write(speaker, [0; 80]).await.unwrap();
        assert!(validate_tracks(&tracks).await.is_ok());
        assert!(recording_files_complete(&recorded));
        tracks[1].path = mic;
        assert!(validate_tracks(&tracks).await.is_err());
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[test]
    fn orders_segments_by_absolute_time_not_input_order_or_relative_offset() {
        let origin = DateTime::from_timestamp_millis(1_000_000).unwrap();
        let later = origin + TimeDelta::seconds(5);
        let mut segments = [
            (
                phrase_time(origin, Some(15_000), true).unwrap(),
                "mic later",
            ),
            (
                phrase_time(origin, Some(5_000), true).unwrap(),
                "mic earlier",
            ),
            (phrase_time(later, Some(2_000), true).unwrap(), "speaker"),
        ];
        segments.sort_by_key(|(time, _)| *time);
        assert_eq!(
            segments.map(|(_, text)| text),
            ["mic earlier", "speaker", "mic later"]
        );
        assert!(phrase_time(origin, None, true).is_err());
    }
}
