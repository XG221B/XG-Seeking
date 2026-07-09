use crate::storage::atomic_write_text;
use serde::{Deserialize, Serialize};
use std::{
    cmp::Reverse,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MindmapNode {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub collapsed: bool,
    #[serde(default)]
    pub children: Vec<MindmapNode>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Mindmap {
    pub id: String,
    pub title: String,
    pub updated_at: u64,
    #[serde(default)]
    pub nodes: Vec<MindmapNode>,
}

fn mindmaps_dir(app_data: &Path) -> PathBuf {
    app_data.join("mindmaps")
}

fn trash_dir(app_data: &Path) -> PathBuf {
    app_data.join("mindmaps_trash")
}

pub fn ensure_dirs(app_data: &Path) -> Result<(), String> {
    fs::create_dir_all(mindmaps_dir(app_data)).map_err(|e| e.to_string())?;
    fs::create_dir_all(trash_dir(app_data)).map_err(|e| e.to_string())?;
    Ok(())
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Invalid mindmap id".into());
    }
    Ok(())
}

fn mindmap_path(app_data: &Path, id: &str) -> Result<PathBuf, String> {
    validate_id(id)?;
    Ok(mindmaps_dir(app_data).join(format!("{id}.json")))
}

fn now_millis() -> Result<u64, String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    u64::try_from(millis).map_err(|e| e.to_string())
}

const MAX_TITLE_LEN: usize = 500;

fn validate_title(title: &str) -> Result<(), String> {
    if title.len() > MAX_TITLE_LEN {
        return Err(format!("Title too long (max {MAX_TITLE_LEN} chars)"));
    }
    Ok(())
}

fn resolve_title(title: Option<String>) -> Result<String, String> {
    let normalized = title
        .unwrap_or_else(|| "未命名导图".into())
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let resolved = if normalized.is_empty() {
        "未命名导图".into()
    } else {
        normalized
    };
    validate_title(&resolved)?;
    Ok(resolved)
}

// ── Public API ──

pub fn list_mindmaps(app_data: &Path) -> Result<Vec<Mindmap>, String> {
    list_mindmaps_in(&mindmaps_dir(app_data))
}

pub fn create_mindmap(app_data: &Path, title: Option<String>) -> Result<Mindmap, String> {
    let id = format!("mindmap-{}", now_millis()?);
    let ts = now_millis()?;
    let resolved = resolve_title(title)?;
    let mm = Mindmap {
        id: id.clone(),
        title: resolved,
        updated_at: ts,
        nodes: vec![],
    };
    let path = mindmap_path(app_data, &id)?;
    let raw = serde_json::to_string(&mm).map_err(|e| e.to_string())?;
    atomic_write_text(&path, &raw)?;
    Ok(mm)
}

pub fn save_mindmap(app_data: &Path, mm: Mindmap) -> Result<Mindmap, String> {
    let path = mindmap_path(app_data, &mm.id)?;
    let mut saved = mm;
    validate_title(&saved.title)?;
    saved.updated_at = now_millis()?;
    let raw = serde_json::to_string(&saved).map_err(|e| e.to_string())?;
    atomic_write_text(&path, &raw)?;
    Ok(saved)
}

pub fn delete_mindmap(app_data: &Path, id: &str) -> Result<(), String> {
    let src = mindmap_path(app_data, id)?;
    if !src.exists() {
        return Ok(());
    }
    let dst = trash_dir(app_data).join(format!("{id}.json"));
    if dst.exists() {
        return Err("A trashed mindmap with this id already exists".into());
    }
    fs::create_dir_all(trash_dir(app_data)).map_err(|e| e.to_string())?;
    fs::rename(&src, &dst).map_err(|e| e.to_string())
}

pub fn list_trash(app_data: &Path) -> Result<Vec<Mindmap>, String> {
    let dir = trash_dir(app_data);
    if !dir.exists() {
        return Ok(vec![]);
    }
    list_mindmaps_in(&dir)
}

fn list_mindmaps_in(dir: &Path) -> Result<Vec<Mindmap>, String> {
    let mut maps = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(raw) = fs::read_to_string(&path) {
            let Ok(mm) = serde_json::from_str::<Mindmap>(&raw) else {
                continue;
            };
            maps.push(mm);
        }
    }
    maps.sort_by_key(|b| Reverse(b.updated_at));
    Ok(maps)
}

pub fn restore_mindmap(app_data: &Path, id: &str) -> Result<Mindmap, String> {
    validate_id(id)?;
    let src = trash_dir(app_data).join(format!("{id}.json"));
    if !src.exists() {
        return Err("Mindmap not found in trash".into());
    }
    let dst = mindmaps_dir(app_data).join(format!("{id}.json"));
    if dst.exists() {
        return Err("A mindmap with this id already exists".into());
    }
    fs::rename(&src, &dst).map_err(|e| e.to_string())?;
    let raw = fs::read_to_string(&dst).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

pub fn delete_permanently(app_data: &Path, id: &str) -> Result<(), String> {
    validate_id(id)?;
    let path = trash_dir(app_data).join(format!("{id}.json"));
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
