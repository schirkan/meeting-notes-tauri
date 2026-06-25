//! Persistent settings on disk (T-305).
//!
//! Layout under the OS-standard app config dir returned by Tauri:
//!   %APPDATA%\de.schirkan.meeting-notes-tauri\
//!       azure.json          (Azure endpoint, region, speechKey, proxy)
//!       user-settings.json  (language, device ids)
//!
//! Both files are written atomically (temp file + rename) so a crash
//! mid-write never corrupts the on-disk config.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

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

fn config_dir(app: &AppHandle) -> Result<PathBuf, SettingsError> {
    app.path().app_config_dir().map_err(|_| SettingsError::NoConfigDir)
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
