//! Persistent settings on disk (T-305).
//!
//! Layout: config/ next to the application EXE (portable/release),
//! or the repository's config/ directory in development.
//!   config/azure.json          (Azure endpoint, region, speechKey, proxy)
//!   config/user-settings.json  (language, device ids, per-source diarization)
//!
//! Both files are written atomically (temp file + rename) so a crash
//! mid-write never corrupts the on-disk config.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AzureConfig {
    pub endpoint: String,
    pub region: String,
    pub speech_key: String,
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
    pub language: String,
    pub devices: DeviceIds,
    #[serde(default)]
    pub diarization: DiarizationSettings,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DiarizationSettings {
    pub mic: bool,
    pub speaker: bool,
}

impl Default for DiarizationSettings {
    fn default() -> Self {
        Self { mic: true, speaker: true }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceIds {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mic_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker_loopback_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AzureConfigState {
    pub exists: bool,
    pub path: String,
    pub user_settings_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<AzureConfig>,
}

#[derive(Debug, thiserror::Error)]
pub enum SettingsError {
    #[error("config dir not found")]
    NoConfigDir,
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

fn config_dir_for(exe: &Path, development_root: Option<&Path>) -> Result<PathBuf, SettingsError> {
    let root = development_root.or_else(|| exe.parent()).ok_or(SettingsError::NoConfigDir)?;
    Ok(root.join("config"))
}

fn config_dir(_app: &AppHandle) -> Result<PathBuf, SettingsError> {
    let exe = std::env::current_exe()?;
    let development_root = if cfg!(debug_assertions) {
        Path::new(env!("CARGO_MANIFEST_DIR")).parent()
    } else {
        None
    };
    config_dir_for(&exe, development_root)
}

#[cfg(test)]
mod config_path_tests {
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
            assert_eq!(serde_json::from_str::<UserSettings>(&persisted).unwrap().diarization,
                settings.diarization);
        }
    }

    #[tokio::test]
    async fn diarization_persists_false_atomically() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target").join(format!("diarization-{}.json", uuid::Uuid::new_v4()));
        let mut settings = default_user_settings();
        settings.diarization = DiarizationSettings { mic: false, speaker: true };
        let json = serde_json::to_string_pretty(&settings).unwrap();
        write_atomic(&path, json.as_bytes()).await.unwrap();
        let raw = tokio::fs::read_to_string(&path).await.unwrap();
        tokio::fs::remove_file(&path).await.unwrap();
        assert!(!path.with_extension("tmp").exists());
        assert_eq!(serde_json::from_str::<UserSettings>(&raw).unwrap().diarization,
            settings.diarization);
    }

    #[test]
    fn portable_config_is_next_to_exe() {
        let exe = Path::new(r"D:\Portable\Meeting Notes\meeting-notes-tauri.exe");
        assert_eq!(config_dir_for(exe, None).unwrap(), PathBuf::from(r"D:\Portable\Meeting Notes\config"));
    }

    #[test]
    fn config_state_serializes_both_file_paths() {
        let state = AzureConfigState {
            exists: false,
            path: r"D:\Portable\config\azure.json".into(),
            user_settings_path: r"D:\Portable\config\user-settings.json".into(),
            config: None,
        };
        let json = serde_json::to_value(state).unwrap();
        assert_eq!(json["path"], r"D:\Portable\config\azure.json");
        assert_eq!(json["userSettingsPath"], r"D:\Portable\config\user-settings.json");
    }

    #[test]
    fn development_config_uses_repository_templates_directory() {
        let exe = Path::new(r"D:\repo\src-tauri\target\debug\meeting-notes-tauri.exe");
        assert_eq!(config_dir_for(exe, Some(Path::new(r"D:\repo"))).unwrap(), PathBuf::from(r"D:\repo\config"));
    }
}

fn azure_path(app: &AppHandle) -> Result<PathBuf, SettingsError> {
    Ok(config_dir(app)?.join("azure.json"))
}

fn user_settings_path(app: &AppHandle) -> Result<PathBuf, SettingsError> {
    Ok(config_dir(app)?.join("user-settings.json"))
}

pub const DEFAULT_LANGUAGE: &str = "de-DE";

pub fn default_user_settings() -> UserSettings {
    UserSettings {
        language: DEFAULT_LANGUAGE.into(),
        devices: DeviceIds { mic_id: None, speaker_loopback_id: None },
        diarization: DiarizationSettings::default(),
    }
}

pub async fn load_user_settings(app: &AppHandle) -> Result<UserSettings, SettingsError> {
    let path = user_settings_path(app)?;
    match tokio::fs::read_to_string(&path).await {
        Ok(raw) => match serde_json::from_str::<UserSettings>(&raw) {
            Ok(parsed) => Ok(normalize_user_settings(parsed)),
            Err(_) => Ok(default_user_settings()),
        },
        Err(_) => Ok(default_user_settings()),
    }
}

pub async fn save_user_settings(app: &AppHandle, settings: UserSettings) -> Result<UserSettings, SettingsError> {
    let path = user_settings_path(app)?;
    let normalized = normalize_user_settings(settings);
    let json = serde_json::to_string_pretty(&normalized)?;
    write_atomic(&path, json.as_bytes()).await?;
    Ok(normalized)
}

pub async fn load_azure_config(app: &AppHandle) -> Result<Option<AzureConfig>, SettingsError> {
    let path = azure_path(app)?;
    match tokio::fs::read_to_string(&path).await {
        Ok(raw) => match serde_json::from_str::<AzureConfig>(&raw) {
            Ok(parsed) => Ok(Some(parsed)),
            Err(_) => Ok(None),
        },
        Err(_) => Ok(None),
    }
}

pub async fn save_azure_config(app: &AppHandle, config: AzureConfig) -> Result<AzureConfig, SettingsError> {
    let path = azure_path(app)?;
    let json = serde_json::to_string_pretty(&config)?;
    write_atomic(&path, json.as_bytes()).await?;
    Ok(config)
}

pub async fn get_azure_config_state(app: &AppHandle) -> Result<AzureConfigState, SettingsError> {
    let path = azure_path(app)?;
    let config = load_azure_config(app).await?;
    Ok(AzureConfigState {
        exists: config.is_some(),
        path: path.to_string_lossy().into_owned(),
        user_settings_path: user_settings_path(app)?.to_string_lossy().into_owned(),
        config,
    })
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
