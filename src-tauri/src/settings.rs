//! Persistent settings on disk (T-305).
//!
//! One configuration file directly next to the application EXE
//! (portable/release), or in the repository root in development:
//!
//!   MeetingNotes.config.json
//!     azure: { model?, endpoint, region, speechKey, interimResults, proxy? }
//!     user:  { language, autoLanguageDetection, devices, transcription, diarization, transcript }
//!
//! Both sections live in the same file. Every write re-reads the file
//! first and replaces only the section that changed, so saving the Azure
//! configuration never drops the user settings and vice versa.
//!
//! The file is written atomically (temp file + rename) so a crash
//! mid-write never corrupts the on-disk config.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Name of the single configuration file next to the EXE.
pub const CONFIG_FILE_NAME: &str = "MeetingNotes.config.json";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AzureSpeechModel {
    #[default]
    Standard,
    #[serde(rename = "mai-transcribe-2-streaming")]
    MaiTranscribe2Streaming,
}

impl AzureSpeechModel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::MaiTranscribe2Streaming => "mai-transcribe-2-streaming",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AzureConfig {
    #[serde(default)]
    pub model: AzureSpeechModel,
    #[serde(default)]
    pub endpoint: String,
    pub region: String,
    pub speech_key: String,
    #[serde(default = "default_true")]
    pub interim_results: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy: Option<AzureProxyConfig>,
}

impl AzureConfig {
    pub fn check_connection_fields(&self) -> Result<(), String> {
        if self.region.trim().is_empty() || self.speech_key.trim().is_empty() {
            return Err("Enter the Azure region and speech key.".into());
        }
        if self.model == AzureSpeechModel::Standard && self.endpoint.trim().is_empty() {
            return Err("Enter the Azure endpoint for the standard model.".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AzureProxyConfig {
    pub host: String,
    pub port: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSettings {
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default)]
    pub devices: DeviceIds,
    #[serde(default)]
    pub transcription: TranscriptionSettings,
    #[serde(default = "default_true", deserialize_with = "deserialize_bool_default_true")]
    pub auto_language_detection: bool,
    #[serde(default = "default_true", deserialize_with = "deserialize_diarization")]
    pub diarization: bool,
    #[serde(default)]
    pub transcript: TranscriptSettings,
    #[serde(default)]
    pub auto_start: AutoStartSettings,
    #[serde(default)]
    pub window: WindowSettings,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WindowSettings {
    pub minimize_to_tray_on_close: bool,
    pub hide_from_taskbar: bool,
}

impl Default for WindowSettings {
    fn default() -> Self {
        Self {
            minimize_to_tray_on_close: true,
            hide_from_taskbar: true,
        }
    }
}

/// Automatischer Aufnahmestart bei erkanntem Meeting (T-513).
///
/// Seit v0.1.2 standardmaessig an: Start und passender Session-Ende-Stop.
/// Explizit gespeichertes false bleibt erhalten. Der Session-Ende-Stop ist
/// ueber `auto_stop` einzeln abschaltbar - der Start bleibt dann bestehen.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AutoStartSettings {
    /// Erkennungsmodus aktiv (Sidecar beobachtet den Audio-Session-Graph).
    pub enabled: bool,
    /// Prozessnamen, die als Meeting gelten. Leer: die Standardliste.
    pub processes: Vec<String>,
    /// Automatisch gestartete Aufnahme beim Session-Ende beenden.
    pub auto_stop: bool,
}

impl Default for AutoStartSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            processes: Vec::new(),
            auto_stop: true,
        }
    }
}

/// Which audio sources are transcribed.
///
/// Independent of the `diarization` settings: a source can be transcribed
/// without speaker recognition, and diarization can be switched off for a
/// source that is still transcribed. A source that is not transcribed is
/// neither captured nor sent to Azure.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TranscriptionSettings {
    pub mic: bool,
    pub speaker: bool,
    #[serde(default, deserialize_with = "deserialize_audio_mode")]
    pub audio_mode: AudioMode,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AudioMode {
    #[default]
    DualMono,
    Stereo,
}

fn deserialize_audio_mode<'de, D>(deserializer: D) -> Result<AudioMode, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(match serde_json::Value::deserialize(deserializer)?.as_str() {
        Some("stereo") => AudioMode::Stereo,
        _ => AudioMode::DualMono,
    })
}

impl Default for TranscriptionSettings {
    fn default() -> Self {
        Self {
            mic: true,
            speaker: true,
            audio_mode: AudioMode::DualMono,
        }
    }
}

pub(crate) fn deserialize_diarization<'de, D: serde::Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
    let value = serde_json::Value::deserialize(d)?;
    Ok(value.as_bool().unwrap_or_else(|| {
        value.get("mic").and_then(|v| v.as_bool()).unwrap_or(true)
            || value.get("speaker").and_then(|v| v.as_bool()).unwrap_or(true)
    }))
}

/// Transcript output settings (T-506).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TranscriptSettings {
    pub markdown_export: MarkdownExportSettings,
}

impl Default for TranscriptSettings {
    fn default() -> Self {
        Self {
            markdown_export: MarkdownExportSettings::default(),
        }
    }
}

/// Automatic Markdown export of the transcript.
///
/// `path` is optional. When it is absent or blank, the export goes to the
/// application directory (the folder that contains the EXE). A relative
/// path is resolved against the application directory as well.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct MarkdownExportSettings {
    pub enabled: bool,
    pub path: Option<String>,
}

impl Default for MarkdownExportSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            path: None,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceIds {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mic_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker_loopback_id: Option<String>,
}

/// The complete on-disk configuration: Azure credentials plus user settings.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppConfig {
    pub azure: Option<AzureConfig>,
    pub user: UserSettings,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfigState {
    pub exists: bool,
    pub path: String,
    pub config: Option<AzureConfig>,
}

#[derive(Debug, thiserror::Error)]
pub enum SettingsError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

/// Directory that holds the application: the folder of the EXE in release
/// builds, the repository root in development.
pub fn app_dir_for(exe: &Path, development_root: Option<&Path>) -> PathBuf {
    match development_root {
        Some(root) => root.to_path_buf(),
        None => exe
            .parent()
            .map(|dir| dir.to_path_buf())
            .unwrap_or_else(|| PathBuf::from(".")),
    }
}

/// Resolve the application directory for the running process.
pub fn app_dir() -> Result<PathBuf, SettingsError> {
    let exe = std::env::current_exe()?;
    let development_root = if cfg!(debug_assertions) {
        Path::new(env!("CARGO_MANIFEST_DIR")).parent()
    } else {
        None
    };
    Ok(app_dir_for(&exe, development_root))
}

/// Path of the single configuration file.
pub fn config_path() -> Result<PathBuf, SettingsError> {
    Ok(app_dir()?.join(CONFIG_FILE_NAME))
}

/// Directory for automatic Markdown exports.
///
/// Defaults to the application directory when no path is configured.
/// Relative paths are resolved against the application directory.
pub fn markdown_export_dir(
    app_dir: &Path,
    settings: &MarkdownExportSettings,
) -> PathBuf {
    match settings.path.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        Some(configured) => {
            let candidate = PathBuf::from(configured);
            if candidate.is_absolute() {
                candidate
            } else {
                app_dir.join(candidate)
            }
        }
        None => app_dir.to_path_buf(),
    }
}

/// Read the whole configuration file. Missing or invalid files yield defaults.
pub async fn load_app_config() -> Result<AppConfig, SettingsError> {
    let path = config_path()?;
    let raw = match tokio::fs::read_to_string(&path).await {
        Ok(raw) => raw,
        Err(_) => return Ok(default_app_config()),
    };

    // Die beiden Abschnitte werden getrennt gelesen. Ein fehlerhafter
    // Azure-Abschnitt darf die User-Settings nicht mitreißen und
    // umgekehrt.
    let value: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(_) => return Ok(default_app_config()),
    };
    let azure = value
        .get("azure")
        .and_then(|section| serde_json::from_value::<AzureConfig>(section.clone()).ok());
    let user = value
        .get("user")
        .and_then(|section| serde_json::from_value::<UserSettings>(section.clone()).ok())
        .map(normalize_user_settings)
        .unwrap_or_else(default_user_settings);

    Ok(AppConfig { azure, user })
}

/// Write the whole configuration file atomically.
pub async fn save_app_config(config: AppConfig) -> Result<AppConfig, SettingsError> {
    let path = config_path()?;
    let normalized = AppConfig {
        azure: config.azure,
        user: normalize_user_settings(config.user),
    };
    let json = serde_json::to_string_pretty(&normalized)?;
    write_atomic(&path, json.as_bytes()).await?;
    Ok(normalized)
}

pub async fn load_azure_config() -> Result<Option<AzureConfig>, SettingsError> {
    Ok(load_app_config().await?.azure)
}

/// Replace only the Azure section and keep the user settings untouched.
pub async fn save_azure_config(config: AzureConfig) -> Result<AzureConfig, SettingsError> {
    let mut current = load_app_config().await?;
    current.azure = Some(config.clone());
    save_app_config(current).await?;
    Ok(config)
}

pub async fn load_user_settings() -> Result<UserSettings, SettingsError> {
    Ok(load_app_config().await?.user)
}

/// Replace only the user section and keep the Azure configuration untouched.
pub async fn save_user_settings(settings: UserSettings) -> Result<UserSettings, SettingsError> {
    let mut current = load_app_config().await?;
    current.user = settings;
    let saved = save_app_config(current).await?;
    Ok(saved.user)
}

pub async fn get_app_config_state() -> Result<AppConfigState, SettingsError> {
    let path = config_path()?;
    let exists = tokio::fs::try_exists(&path).await.unwrap_or(false);
    let config = load_azure_config().await?;
    Ok(AppConfigState {
        exists,
        path: path.to_string_lossy().into_owned(),
        config,
    })
}

/// Write a Markdown export of the transcript next to the app (or into the
/// configured folder). Returns the absolute path of the written file.
pub async fn write_transcript_markdown(markdown: &str) -> Result<PathBuf, SettingsError> {
    let dir = app_dir()?;
    let user = load_user_settings().await?;
    let target_dir = markdown_export_dir(&dir, &user.transcript.markdown_export);
    tokio::fs::create_dir_all(&target_dir).await?;
    static EXPORT_WRITE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = EXPORT_WRITE_LOCK.lock().await;
    let stamp = chrono::Local::now().format("%Y-%m-%d-%H-%M-%S");
    let mut path = target_dir.join(format!("transcript-{stamp}.md"));
    if tokio::fs::try_exists(&path).await? {
        path = target_dir.join(format!("transcript-{stamp}-{}.md", uuid::Uuid::new_v4()));
    }
    write_atomic(&path, markdown.as_bytes()).await?;
    Ok(path)
}

pub const DEFAULT_LANGUAGE: &str = "de-DE";

pub(crate) fn default_true() -> bool {
    true
}

fn deserialize_bool_default_true<'de, D: serde::Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
    Ok(serde_json::Value::deserialize(d)?.as_bool().unwrap_or_else(default_true))
}

fn default_language() -> String {
    DEFAULT_LANGUAGE.to_string()
}

impl Default for UserSettings {
    fn default() -> Self {
        default_user_settings()
    }
}

pub fn default_user_settings() -> UserSettings {
    UserSettings {
        language: DEFAULT_LANGUAGE.into(),
        devices: DeviceIds::default(),
        transcription: TranscriptionSettings::default(),
        diarization: true,
        auto_language_detection: true,
        transcript: TranscriptSettings::default(),
        auto_start: AutoStartSettings::default(),
        window: WindowSettings::default(),
    }
}

pub fn default_app_config() -> AppConfig {
    AppConfig {
        azure: None,
        user: default_user_settings(),
    }
}

fn normalize_user_settings(mut settings: UserSettings) -> UserSettings {
    if !is_valid_bcp47(&settings.language) {
        settings.language = DEFAULT_LANGUAGE.into();
    }
    settings
}

fn is_valid_bcp47(lang: &str) -> bool {
    // Accepts e.g. "de-DE", "en-US"; lenient on the script/section count.
    let parts: Vec<&str> = lang.split('-').collect();
    parts.len() == 2
        && parts[0].len() >= 2
        && parts[0].chars().all(|c| c.is_ascii_lowercase())
        && parts[1].len() == 2
        && parts[1].chars().all(|c| c.is_ascii_uppercase())
}

async fn write_atomic(path: &PathBuf, bytes: &[u8]) -> Result<(), SettingsError> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let tmp = path.with_extension("tmp");
    tokio::fs::write(&tmp, bytes).await?;
    tokio::fs::rename(&tmp, path).await?;
    Ok(())
}

#[cfg(test)]
mod config_tests {
    use super::*;

    #[test]
    fn azure_models_validate_their_own_fields_without_unknown_fallback() {
        let mut config = serde_json::json!({
            "endpoint": "https://example.test",
            "region": "swedencentral",
            "speechKey": "test"
        });
        let standard: AzureConfig = serde_json::from_value(config.clone()).unwrap();
        assert_eq!(standard.model, AzureSpeechModel::Standard);
        assert!(standard.check_connection_fields().is_ok());

        config.as_object_mut().unwrap().remove("endpoint");
        let standard: AzureConfig = serde_json::from_value(config.clone()).unwrap();
        assert!(standard.check_connection_fields().is_err());

        config["model"] = serde_json::json!("mai-transcribe-2-streaming");
        let mai: AzureConfig = serde_json::from_value(config.clone()).unwrap();
        assert_eq!(mai.model, AzureSpeechModel::MaiTranscribe2Streaming);
        assert!(mai.check_connection_fields().is_ok());
        assert_eq!(serde_json::to_value(mai).unwrap()["model"], config["model"]);

        for invalid in [serde_json::json!("unknown"), serde_json::Value::Null] {
            config["model"] = invalid;
            assert!(serde_json::from_value::<AzureConfig>(config.clone()).is_err());
        }
    }

    #[test]
    fn transcription_defaults_and_persistence_preserve_each_source() {
        assert_eq!(default_user_settings().transcription, TranscriptionSettings::default());
        for (options, mic, speaker) in [
            ("", true, true),
            (r#", "transcription": {}"#, true, true),
            (r#", "transcription": {"mic": false}"#, false, true),
            (r#", "transcription": {"speaker": false}"#, true, false),
            (r#", "transcription": {"mic": false, "speaker": false}"#, false, false),
            (r#", "transcription": {"mic": true, "speaker": true}"#, true, true),
        ] {
            let raw = format!(r#"{{"language":"invalid","devices":{{}}{options}}}"#);
            let settings = normalize_user_settings(serde_json::from_str(&raw).unwrap());
            assert_eq!(settings.language, DEFAULT_LANGUAGE);
            assert_eq!(settings.transcription, TranscriptionSettings { mic, speaker, ..Default::default() });
            let persisted = serde_json::to_string_pretty(&settings).unwrap();
            let json: serde_json::Value = serde_json::from_str(&persisted).unwrap();
            assert_eq!(json["transcription"], serde_json::json!({"mic": mic, "speaker": speaker, "audioMode": "dual-mono"}));
            assert_eq!(
                serde_json::from_str::<UserSettings>(&persisted).unwrap().transcription,
                settings.transcription
            );
        }
    }

    #[test]
    fn normalize_and_persist_audio_mode_without_resetting_source_preferences() {
        for (value, expected) in [(serde_json::json!("stereo"), AudioMode::Stereo),
            (serde_json::json!("invalid"), AudioMode::DualMono), (serde_json::Value::Null, AudioMode::DualMono)] {
            let raw = serde_json::json!({"transcription": {"mic":false, "audioMode":value}});
            let settings = normalize_user_settings(serde_json::from_value(raw).unwrap());
            let saved: UserSettings = serde_json::from_value(serde_json::to_value(settings).unwrap()).unwrap();
            assert_eq!(saved.transcription, TranscriptionSettings {
                mic: false, speaker: true, audio_mode: expected,
            });
        }
    }

    #[test]
    fn removed_transcription_option_is_ignored_and_not_serialized() {
        let raw = r#"{"language":"en-US","transcription":{"mic":false,"echoCancellation":true,"audioMode":"stereo"}}"#;
        let settings: UserSettings = serde_json::from_str(raw).unwrap();
        assert_eq!(settings.language, "en-US");
        assert_eq!(serde_json::to_value(&settings).unwrap()["transcription"],
            serde_json::json!({"mic": false, "speaker": true, "audioMode": "stereo"}));
    }

    #[test]
    fn invalid_auto_language_detection_preserves_other_user_settings() {
        for value in [serde_json::Value::Null, serde_json::json!("false"), serde_json::json!([])] {
            let settings: UserSettings = serde_json::from_value(serde_json::json!({
                "autoLanguageDetection": value,
                "transcription": { "mic": false },
                "devices": { "speakerLoopbackId": "selected-speaker" },
                "autoStart": { "enabled": false },
                "transcript": { "markdownExport": { "path": "notes" } }
            })).unwrap();
            assert!(settings.auto_language_detection);
            assert!(!settings.transcription.mic);
            assert_eq!(settings.devices.speaker_loopback_id.as_deref(), Some("selected-speaker"));
            assert!(!settings.auto_start.enabled);
            assert_eq!(settings.transcript.markdown_export.path.as_deref(), Some("notes"));
        }
    }

    #[test]
    fn recognition_settings_migrate_legacy_diarization_and_preserve_explicit_false() {
        for (raw, expected) in [
            (r#"{}"#, true),
            (r#"{"diarization":{"mic":false}}"#, true),
            (r#"{"diarization":{"mic":true,"speaker":false}}"#, true),
            (r#"{"diarization":{"mic":false,"speaker":false}}"#, false),
            (r#"{"diarization":false}"#, false),
        ] {
            let settings: UserSettings = serde_json::from_str(raw).unwrap();
            assert_eq!(settings.diarization, expected);
            assert!(settings.auto_language_detection);
            assert_eq!(serde_json::to_value(settings).unwrap()["diarization"], expected);
        }
        let settings: UserSettings = serde_json::from_str(r#"{"autoLanguageDetection":false}"#).unwrap();
        assert!(!settings.auto_language_detection);
    }

    #[test]
    fn config_file_sits_directly_next_to_the_exe() {
        let exe = Path::new(r"D:\Portable\Meeting Notes\MeetingNotes.exe");
        let dir = app_dir_for(exe, None);
        assert_eq!(dir, PathBuf::from(r"D:\Portable\Meeting Notes"));
        assert_eq!(dir.join(CONFIG_FILE_NAME), PathBuf::from(r"D:\Portable\Meeting Notes\MeetingNotes.config.json"));
    }

    #[test]
    fn development_config_uses_the_repository_root() {
        let exe = Path::new(r"D:\repo\src-tauri\target\debug\MeetingNotes.exe");
        let dir = app_dir_for(exe, Some(Path::new(r"D:\repo")));
        assert_eq!(dir, PathBuf::from(r"D:\repo"));
        assert_eq!(dir.join(CONFIG_FILE_NAME), PathBuf::from(r"D:\repo\MeetingNotes.config.json"));
    }

    #[test]
    fn one_file_holds_azure_and_user_settings_together() {
        let config = AppConfig {
            azure: Some(AzureConfig {
                model: AzureSpeechModel::Standard,
                endpoint: "wss://example.test".into(),
                region: "westeurope".into(),
                speech_key: "key".into(),
                interim_results: true,
                proxy: None,
            }),
            user: default_user_settings(),
        };
        let json = serde_json::to_string_pretty(&config).unwrap();
        let parsed: AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.azure.unwrap().speech_key, "key");
        assert_eq!(parsed.user.language, DEFAULT_LANGUAGE);
        assert!(json.contains("azure"));
        assert!(json.contains("user"));
    }

    #[test]
    fn missing_sections_fall_back_to_defaults() {
        let parsed: AppConfig = serde_json::from_str("{}").unwrap();
        assert!(parsed.azure.is_none());
        assert_eq!(parsed.user.language, DEFAULT_LANGUAGE);
        assert!(parsed.user.diarization);
    }

    #[test]
    fn close_to_tray_defaults_on_and_persists_both_boolean_values() {
        let legacy: UserSettings = serde_json::from_str(r#"{"language":"de-DE"}"#).unwrap();
        assert!(legacy.window.minimize_to_tray_on_close);
        let partial: UserSettings = serde_json::from_str(r#"{"window":{}}"#).unwrap();
        assert!(partial.window.minimize_to_tray_on_close);
        for enabled in [false, true] {
            let mut config = default_app_config();
            config.user.window.minimize_to_tray_on_close = enabled;
            let encoded = serde_json::to_string(&config).unwrap();
            let saved: AppConfig = serde_json::from_str(&encoded).unwrap();
            assert_eq!(saved.user.window.minimize_to_tray_on_close, enabled);
            assert_eq!(saved.user.transcription, config.user.transcription);
            assert_eq!(saved.user.auto_start, config.user.auto_start);
        }
    }

    #[test]
    fn taskbar_hiding_defaults_on_and_preserves_opt_out_independently() {
        for input in ["{}", r#"{"window":{"minimizeToTrayOnClose":false}}"#] {
            let user: UserSettings = serde_json::from_str(input).unwrap();
            assert!(user.window.hide_from_taskbar);
        }
        let user: UserSettings =
            serde_json::from_str(r#"{"window":{"hideFromTaskbar":false}}"#).unwrap();
        let saved: UserSettings = serde_json::from_str(&serde_json::to_string(&user).unwrap()).unwrap();
        assert!(!saved.window.hide_from_taskbar);
        assert!(saved.window.minimize_to_tray_on_close);
    }

    #[test]
    fn auto_start_is_on_by_default_and_explicit_false_survives_a_save_cycle() {
        let defaults = default_user_settings();
        assert!(defaults.auto_start.enabled, "Auto-Start samt Auto-Stop ist standardmaessig an");
        assert!(defaults.auto_start.auto_stop, "Auto-Stop ist standardmaessig an");
        assert!(defaults.auto_start.processes.is_empty(), "Keine feste Prozessliste im Default");

        let mut settings = defaults.clone();
        settings.auto_start.enabled = false;
        settings.auto_start.auto_stop = false;
        settings.auto_start.processes = vec!["teams".into(), "zoom".into()];
        let encoded = serde_json::to_string(&settings).expect("settings serialisieren");
        let decoded: UserSettings = serde_json::from_str(&encoded).expect("settings lesen");
        assert!(!decoded.auto_start.enabled, "Explizit gespeichertes false bleibt erhalten");
        assert!(!decoded.auto_start.auto_stop, "Explizit gespeichertes false fuer den Auto-Stop bleibt erhalten");
        assert_eq!(decoded.auto_start.processes, vec!["teams".to_string(), "zoom".to_string()]);

        // Fehlt der Abschnitt, greifen die Defaults.
        let without_auto_start: UserSettings =
            serde_json::from_str(r#"{"language":"de-DE"}"#).expect("teilweise Settings lesen");
        assert!(without_auto_start.auto_start.enabled);
        assert!(without_auto_start.auto_start.auto_stop);
        let partial: UserSettings = serde_json::from_str(r#"{"autoStart":{}}"#).unwrap();
        assert!(partial.auto_start.enabled);
        assert!(partial.auto_start.auto_stop);
        assert!(without_auto_start.auto_start.processes.is_empty());
    }

    fn markdown_export_defaults_to_the_application_directory() {
        let dir = Path::new(r"D:\Portable\Meeting Notes");
        let settings = MarkdownExportSettings::default();
        assert_eq!(markdown_export_dir(dir, &settings), dir);
    }

    #[test]
    fn markdown_export_path_is_optional_and_relative_paths_resolve_against_the_app_dir() {
        let dir = Path::new(r"D:\Portable\Meeting Notes");
        let blank = MarkdownExportSettings {
            enabled: true,
            path: Some("   ".into()),
        };
        assert_eq!(markdown_export_dir(dir, &blank), dir);

        let relative = MarkdownExportSettings {
            enabled: true,
            path: Some("notes".into()),
        };
        assert_eq!(markdown_export_dir(dir, &relative), dir.join("notes"));

        let absolute = MarkdownExportSettings {
            enabled: true,
            path: Some(r"D:\Meetings".into()),
        };
        assert_eq!(markdown_export_dir(dir, &absolute), PathBuf::from(r"D:\Meetings"));
    }

    #[tokio::test]
    async fn diarization_persists_false_atomically() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("diarization-{}.json", uuid::Uuid::new_v4()));
        let mut settings = default_user_settings();
        settings.diarization = false;
        let json = serde_json::to_string_pretty(&settings).unwrap();
        write_atomic(&path, json.as_bytes()).await.unwrap();
        let raw = tokio::fs::read_to_string(&path).await.unwrap();
        tokio::fs::remove_file(&path).await.unwrap();
        assert!(!path.with_extension("tmp").exists());
        assert_eq!(
            serde_json::from_str::<UserSettings>(&raw).unwrap().diarization,
            settings.diarization
        );
    }
}
