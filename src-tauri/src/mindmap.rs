use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
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
    pub root: MindmapNode,
}

fn mindmaps_dir(app_data: &PathBuf) -> PathBuf {
    app_data.join("mindmaps")
}

fn trash_dir(app_data: &PathBuf) -> PathBuf {
    app_data.join("mindmaps_trash")
}

pub fn ensure_dirs(app_data: &PathBuf) -> Result<(), String> {
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

fn mindmap_path(app_data: &PathBuf, id: &str) -> Result<PathBuf, String> {
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

fn default_root() -> MindmapNode {
    MindmapNode {
        id: "n1".into(),
        text: "根节点".into(),
        collapsed: false,
        children: vec![],
    }
}

// ── Public API ──

pub fn list_mindmaps(app_data: &PathBuf) -> Result<Vec<Mindmap>, String> {
    let dir = mindmaps_dir(app_data);
    let mut maps = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let mm: Mindmap = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        maps.push(mm);
    }
    maps.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(maps)
}

pub fn create_mindmap(app_data: &PathBuf) -> Result<Mindmap, String> {
    let id = format!("mindmap-{}", now_millis()?);
    let ts = now_millis()?;
    let mm = Mindmap {
        id: id.clone(),
        title: "未命名导图".into(),
        updated_at: ts,
        root: default_root(),
    };
    let path = mindmap_path(app_data, &id)?;
    let raw = serde_json::to_string(&mm).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())?;
    Ok(mm)
}

pub fn save_mindmap(app_data: &PathBuf, mm: Mindmap) -> Result<Mindmap, String> {
    let path = mindmap_path(app_data, &mm.id)?;
    let mut saved = mm;
    saved.updated_at = now_millis()?;
    let raw = serde_json::to_string(&saved).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())?;
    Ok(saved)
}

pub fn delete_mindmap(app_data: &PathBuf, id: &str) -> Result<(), String> {
    let src = mindmap_path(app_data, id)?;
    if !src.exists() {
        return Ok(());
    }
    let dst = trash_dir(app_data).join(format!("{id}.json"));
    fs::create_dir_all(trash_dir(app_data)).map_err(|e| e.to_string())?;
    fs::rename(&src, &dst).map_err(|e| e.to_string())
}

pub fn list_trash(app_data: &PathBuf) -> Result<Vec<Mindmap>, String> {
    let dir = trash_dir(app_data);
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut maps = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        if let Ok(mm) = serde_json::from_str::<Mindmap>(&raw) {
            maps.push(mm);
        }
    }
    maps.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(maps)
}

pub fn restore_mindmap(app_data: &PathBuf, id: &str) -> Result<Mindmap, String> {
    let src = trash_dir(app_data).join(format!("{id}.json"));
    if !src.exists() {
        return Err("Mindmap not found in trash".into());
    }
    let dst = mindmaps_dir(app_data).join(format!("{id}.json"));
    fs::rename(&src, &dst).map_err(|e| e.to_string())?;
    let raw = fs::read_to_string(&dst).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

pub fn delete_permanently(app_data: &PathBuf, id: &str) -> Result<(), String> {
    let path = trash_dir(app_data).join(format!("{id}.json"));
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
