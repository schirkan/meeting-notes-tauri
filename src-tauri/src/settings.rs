//! Persistent settings on disk (T-305).
//!
//! One configuration file directly next to the application EXE
//! (portable/release), or in the repository root in development:
//!
//!   meeting-notes.config.json
//!     azure: { endpoint, region, speechKey, interimResults, proxy? }
//!     user:  { language, devices, diarization, transcript }
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
pub const CONFIG_FILE_NAME: &str = "meeting-notes.config.json";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AzureConfig {
    pub endpoint: String,
    pub region: String,
    pub speech_key: String,
    #[serde(default = "default_true")]
    pub interim_results: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy: Option<AzureProxyConfig>,
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
    pub diarization: DiarizationSettings,
    #[serde(default)]
    pub transcript: TranscriptSettings,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DiarizationSettings {
    pub mic: bool,
    pub speaker: bool,
}

impl Default for DiarizationSettings {
    fn default() -> Self {
        Self {
            mic: true,
            speaker: true,
        }
    }
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
    let stamp = chrono::Local::now().format("%Y-%m-%d-%H-%M-%S");
    let path = target_dir.join(format!("transcript-{stamp}.md"));
    write_atomic(&path, markdown.as_bytes()).await?;
    Ok(path)
}

pub const DEFAULT_LANGUAGE: &str = "de-DE";

fn default_true() -> bool {
    true
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
        diarization: DiarizationSettings::default(),
        transcript: TranscriptSettings::default(),
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
    fn diarization_defaults_and_persistence_preserve_each_source() {
        assert_eq!(default_user_settings().diarization, DiarizationSettings::default());
        for (options, mic, speaker) in [
            ("", true, true),
            (r#", "diarization": {}"#, true, true),
            (r#", "diarization": {"mic": false}"#, false, true),
            (r#", "diarization": {"speaker": false}"#, true, false),
            (r#", "diarization": {"mic": false, "speaker": false}"#, false, false),
            (r#", "diarization": {"mic": true, "speaker": true}"#, true, true),
        ] {
            let raw = format!(r#"{{"language":"invalid","devices":{{}}{options}}}"#);
            let settings = normalize_user_settings(serde_json::from_str(&raw).unwrap());
            assert_eq!(settings.language, DEFAULT_LANGUAGE);
            assert_eq!(settings.diarization, DiarizationSettings { mic, speaker });
            let persisted = serde_json::to_string_pretty(&settings).unwrap();
            let json: serde_json::Value = serde_json::from_str(&persisted).unwrap();
            assert_eq!(json["diarization"], serde_json::json!({"mic": mic, "speaker": speaker}));
            assert_eq!(
                serde_json::from_str::<UserSettings>(&persisted).unwrap().diarization,
                settings.diarization
            );
        }
    }

    #[test]
    fn config_file_sits_directly_next_to_the_exe() {
        let exe = Path::new(r"D:\Portable\Meeting Notes\meeting-notes.exe");
        let dir = app_dir_for(exe, None);
        assert_eq!(dir, PathBuf::from(r"D:\Portable\Meeting Notes"));
        assert_eq!(dir.join(CONFIG_FILE_NAME), PathBuf::from(r"D:\Portable\Meeting Notes\meeting-notes.config.json"));
    }

    #[test]
    fn development_config_uses_the_repository_root() {
        let exe = Path::new(r"D:\repo\src-tauri\target\debug\meeting-notes.exe");
        let dir = app_dir_for(exe, Some(Path::new(r"D:\repo")));
        assert_eq!(dir, PathBuf::from(r"D:\repo"));
        assert_eq!(dir.join(CONFIG_FILE_NAME), PathBuf::from(r"D:\repo\meeting-notes.config.json"));
    }

    #[test]
    fn one_file_holds_azure_and_user_settings_together() {
        let config = AppConfig {
            azure: Some(AzureConfig {
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
        assert_eq!(parsed.user.diarization, DiarizationSettings::default());
    }

    #[test]
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
        settings.diarization = DiarizationSettings {
            mic: false,
            speaker: true,
        };
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
