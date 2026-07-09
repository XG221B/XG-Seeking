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
}

fn default_language() -> String {
    "zh".into()
}

fn default_title() -> String {
    "寻找心灵的碎片...".into()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            language: default_language(),
            title: default_title(),
        }
    }
}

fn settings_path(app_data: &Path) -> PathBuf {
    app_data.join("settings.json")
}

pub fn load(app_data: &Path) -> Result<Settings, String> {
    let path = settings_path(app_data);
    if path.exists() {
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).map_err(|e| e.to_string())
    } else {
        Ok(Settings::default())
    }
}

pub fn save(app_data: &Path, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app_data);
    let raw = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    atomic_write_text(&path, &raw)
}
