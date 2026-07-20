use crate::storage::atomic_write_text;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_title")]
    pub title: String,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default, skip_deserializing, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

fn default_language() -> String {
    "zh".into()
}

fn default_title() -> String {
    "寻找心灵的碎片...".into()
}

fn default_theme() -> String {
    "system".into()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            language: default_language(),
            title: default_title(),
            theme: default_theme(),
            warnings: Vec::new(),
        }
    }
}

fn settings_path(app_data: &Path) -> PathBuf {
    app_data.join("settings.json")
}

pub fn load(app_data: &Path) -> Result<Settings, String> {
    let path = settings_path(app_data);
    if path.exists() {
        match fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
        {
            Some(settings) => Ok(settings),
            None => Ok(Settings {
                warnings: vec!["SETTINGS_UNREADABLE".into()],
                ..Settings::default()
            }),
        }
    } else {
        Ok(Settings::default())
    }
}

pub fn save(app_data: &Path, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app_data);
    let mut normalized = settings.clone();
    normalized.warnings.clear();
    if !matches!(normalized.language.as_str(), "zh" | "en") {
        normalized.language = default_language();
    }
    if normalized.title.trim().is_empty() {
        normalized.title = default_title();
    } else {
        normalized.title = normalized.title.trim().to_string();
    }
    if !matches!(normalized.theme.as_str(), "system" | "light" | "dark") {
        normalized.theme = default_theme();
    }
    let raw = serde_json::to_string_pretty(&normalized).map_err(|e| e.to_string())?;
    atomic_write_text(&path, &raw)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn old_settings_default_to_system_theme() {
        let settings: Settings =
            serde_json::from_str(r#"{"language":"en","title":"Notes"}"#).unwrap();
        assert_eq!(settings.theme, "system");
    }

    #[test]
    fn corrupt_settings_return_defaults_with_warning() {
        let dir =
            std::env::temp_dir().join(format!("xg-seeking-settings-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(settings_path(&dir), "{ invalid json").unwrap();
        let settings = load(&dir).unwrap();
        assert_eq!(settings.theme, "system");
        assert_eq!(settings.warnings, vec!["SETTINGS_UNREADABLE"]);
        fs::remove_dir_all(dir).unwrap();
    }
}
