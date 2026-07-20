use crate::storage::{atomic_write_text, sha256_hex, with_file_locks};
use serde::{Deserialize, Serialize};
use std::{
    cmp::Reverse,
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MindmapNode {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub collapsed: bool,
    #[serde(default)]
    pub children: Vec<MindmapNode>,
    #[serde(flatten)]
    pub _extra: HashMap<String, serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Mindmap {
    pub id: String,
    pub title: String,
    pub updated_at: u64,
    #[serde(default)]
    pub nodes: Vec<MindmapNode>,
    #[serde(skip)]
    pub revision: String,
    #[serde(flatten)]
    pub _extra: HashMap<String, serde_json::Value>,
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
const MAX_MINDMAP_BYTES: u64 = 1_048_576;
const MAX_MINDMAP_NODES: usize = 5_000;
const MAX_MINDMAP_DEPTH: usize = 100;
const MAX_NODE_TEXT_LEN: usize = 10_000;

fn validate_title(title: &str) -> Result<(), String> {
    if title.trim().is_empty() {
        return Err("Title must not be empty".into());
    }
    if title.chars().count() > MAX_TITLE_LEN {
        return Err(format!("Title too long (max {MAX_TITLE_LEN} chars)"));
    }
    Ok(())
}

fn validate_mindmap(mm: &Mindmap) -> Result<(), String> {
    validate_id(&mm.id)?;
    validate_title(&mm.title)?;
    let mut stack: Vec<(&MindmapNode, usize)> = mm.nodes.iter().map(|node| (node, 1)).collect();
    let mut count = 0usize;
    while let Some((node, depth)) = stack.pop() {
        count += 1;
        if count > MAX_MINDMAP_NODES {
            return Err(format!("Too many mindmap nodes (max {MAX_MINDMAP_NODES})"));
        }
        if depth > MAX_MINDMAP_DEPTH {
            return Err(format!(
                "Mindmap nesting too deep (max {MAX_MINDMAP_DEPTH})"
            ));
        }
        validate_id(&node.id)?;
        if node.text.chars().count() > MAX_NODE_TEXT_LEN {
            return Err(format!(
                "Mindmap node text too long (max {MAX_NODE_TEXT_LEN})"
            ));
        }
        stack.extend(node.children.iter().map(|child| (child, depth + 1)));
    }
    Ok(())
}

fn check_revision(path: &Path, expected_revision: Option<&str>) -> Result<(), String> {
    let bytes = fs::read(path).map_err(|_| "NOT_FOUND:".to_string())?;
    if let Some(expected) = expected_revision {
        let current = sha256_hex(&bytes);
        if current != expected {
            return Err(format!("CONFLICT:{current}"));
        }
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

fn read_mindmap_from(path: &Path) -> Result<Mindmap, String> {
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > MAX_MINDMAP_BYTES {
        return Err("Mindmap file too large".into());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let revision = sha256_hex(&bytes);
    let raw = String::from_utf8(bytes).map_err(|e| e.to_string())?;
    let mut mm: Mindmap = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    validate_mindmap(&mm)?;
    mm.revision = revision;
    Ok(mm)
}

fn list_mindmaps_in(dir: &Path) -> Result<Vec<Mindmap>, String> {
    let mut maps = Vec::new();
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) => return Err(e.to_string()),
    };
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(mm) = read_mindmap_from(&path) {
            maps.push(mm);
        }
    }
    maps.sort_by_key(|b| Reverse(b.updated_at));
    Ok(maps)
}

pub fn list_mindmaps(app_data: &Path) -> Result<Vec<Mindmap>, String> {
    list_mindmaps_in(&mindmaps_dir(app_data))
}

pub fn storage_warning_count(app_data: &Path) -> (usize, usize) {
    fn count(dir: &Path) -> usize {
        fs::read_dir(dir)
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .filter(|entry| {
                        entry.path().extension().and_then(|ext| ext.to_str()) == Some("json")
                    })
                    .filter(|entry| read_mindmap_from(&entry.path()).is_err())
                    .count()
            })
            .unwrap_or(0)
    }
    (count(&mindmaps_dir(app_data)), count(&trash_dir(app_data)))
}

pub fn create_mindmap(app_data: &Path, title: Option<String>) -> Result<Mindmap, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let ts = now_millis()?;
    let resolved = resolve_title(title)?;
    let mm = Mindmap {
        id: id.clone(),
        title: resolved,
        updated_at: ts,
        nodes: vec![],
        revision: String::new(),
        _extra: HashMap::new(),
    };
    let path = mindmap_path(app_data, &id)?;
    let raw = serde_json::to_string(&mm).map_err(|e| e.to_string())?;
    let revision = sha256_hex(raw.as_bytes());
    atomic_write_text(&path, &raw)?;
    Ok(Mindmap { revision, ..mm })
}

pub fn save_mindmap(
    app_data: &Path,
    mm: Mindmap,
    expected_revision: Option<String>,
) -> Result<Mindmap, String> {
    if let Err(e) = validate_mindmap(&mm) {
        return Err(format!("VALIDATION:{}", e));
    }
    let path = mindmap_path(app_data, &mm.id).map_err(|e| format!("VALIDATION:{}", e))?;
    let mut saved = mm;
    saved.updated_at = now_millis().map_err(|e| format!("IO:{}", e))?;
    saved.revision = String::new();
    let raw = serde_json::to_string(&saved).map_err(|e| format!("IO:{}", e))?;
    if raw.len() as u64 > MAX_MINDMAP_BYTES {
        return Err(format!(
            "VALIDATION:Mindmap file too large (max {MAX_MINDMAP_BYTES} bytes)"
        ));
    }
    let revision = sha256_hex(raw.as_bytes());
    with_file_locks(std::slice::from_ref(&path), || {
        check_revision(&path, expected_revision.as_deref())?;
        atomic_write_text(&path, &raw).map_err(|e| format!("IO:{}", e))
    })?;
    saved.revision = revision;
    Ok(saved)
}

pub fn delete_mindmap(
    app_data: &Path,
    id: &str,
    expected_revision: Option<String>,
) -> Result<(), String> {
    let src = mindmap_path(app_data, id).map_err(|e| format!("VALIDATION:{}", e))?;
    let dst = trash_dir(app_data).join(format!("{id}.json"));
    fs::create_dir_all(trash_dir(app_data)).map_err(|e| format!("IO:{}", e))?;
    with_file_locks(&[src.clone(), dst.clone()], || {
        check_revision(&src, expected_revision.as_deref())?;
        if dst.exists() {
            return Err("VALIDATION:A trashed mindmap with this id already exists".to_string());
        }
        fs::rename(&src, &dst).map_err(|e| format!("IO:{}", e))
    })
}

pub fn list_trash(app_data: &Path) -> Result<Vec<Mindmap>, String> {
    let dir = trash_dir(app_data);
    if !dir.exists() {
        return Ok(vec![]);
    }
    list_mindmaps_in(&dir)
}

pub fn restore_mindmap(
    app_data: &Path,
    id: &str,
    expected_revision: Option<String>,
) -> Result<Mindmap, String> {
    validate_id(id).map_err(|e| format!("VALIDATION:{}", e))?;
    let src = trash_dir(app_data).join(format!("{id}.json"));
    let dst = mindmaps_dir(app_data).join(format!("{id}.json"));
    with_file_locks(&[src.clone(), dst.clone()], || {
        check_revision(&src, expected_revision.as_deref())?;
        if dst.exists() {
            return Err("VALIDATION:A mindmap with this id already exists".to_string());
        }
        fs::rename(&src, &dst).map_err(|e| format!("IO:{}", e))
    })?;
    read_mindmap_from(&dst).map_err(|e| format!("IO:{}", e))
}

pub fn delete_permanently(
    app_data: &Path,
    id: &str,
    expected_revision: Option<String>,
) -> Result<(), String> {
    validate_id(id).map_err(|e| format!("VALIDATION:{}", e))?;
    let path = trash_dir(app_data).join(format!("{id}.json"));
    with_file_locks(std::slice::from_ref(&path), || {
        check_revision(&path, expected_revision.as_deref())?;
        fs::remove_file(&path).map_err(|e| format!("IO:{}", e))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        env, fs,
        sync::atomic::{AtomicU64, Ordering},
        thread,
        time::Duration,
    };

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn test_dir(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let ctr = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        env::temp_dir().join(format!("xg-seeking-test-{name}-{stamp}-{ctr}"))
    }

    fn setup_dirs() -> PathBuf {
        let dir = test_dir("mindmap");
        fs::create_dir_all(&dir).unwrap();
        ensure_dirs(&dir).unwrap();
        dir
    }

    fn clean_dir(dir: &Path) {
        for _ in 0..5 {
            if fs::remove_dir_all(dir).is_ok() {
                return;
            }
            thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn revision_is_computed_and_returned() {
        let dir = setup_dirs();
        let mm = create_mindmap(&dir, Some("AI_TEST_Rev".into())).unwrap();
        assert!(!mm.revision.is_empty());
        assert_eq!(mm.revision.len(), 64);
        clean_dir(&dir);
    }

    #[test]
    fn revision_changes_after_save() {
        let dir = setup_dirs();
        let mm = create_mindmap(&dir, Some("AI_TEST_RevChange".into())).unwrap();
        let rev1 = mm.revision.clone();

        let mut updated = mm.clone();
        updated.title = "AI_TEST_Changed".into();
        let saved = save_mindmap(&dir, updated, None).unwrap();
        assert_ne!(saved.revision, rev1);
        clean_dir(&dir);
    }

    #[test]
    fn save_with_matching_revision_succeeds() {
        let dir = setup_dirs();
        let mm = create_mindmap(&dir, Some("AI_TEST_Match".into())).unwrap();
        let rev = mm.revision.clone();

        let mut updated = mm.clone();
        updated.title = "AI_TEST_Changed".into();
        let result = save_mindmap(&dir, updated, Some(rev));
        assert!(result.is_ok());
        clean_dir(&dir);
    }

    #[test]
    fn save_with_mismatched_revision_returns_conflict() {
        let dir = setup_dirs();
        let mm = create_mindmap(&dir, Some("AI_TEST_Mismatch".into())).unwrap();

        let mut updated = mm.clone();
        updated.title = "AI_TEST_Changed".into();
        let result = save_mindmap(
            &dir,
            updated,
            Some("0000000000000000000000000000000000000000000000000000000000000000".into()),
        );
        assert!(result.is_err());
        let err = result.err().unwrap();
        assert!(err.starts_with("CONFLICT:"));
        assert!(err.contains(&mm.revision));
        clean_dir(&dir);
    }

    #[test]
    fn save_missing_mindmap_without_revision_is_rejected() {
        let dir = setup_dirs();
        let missing = Mindmap {
            id: "AI_TEST_nonexistent_no_revision".into(),
            title: "Missing".into(),
            updated_at: 0,
            nodes: Vec::new(),
            revision: String::new(),
            _extra: HashMap::new(),
        };
        let result = save_mindmap(&dir, missing, None);
        assert!(result.unwrap_err().starts_with("NOT_FOUND:"));
        clean_dir(&dir);
    }

    #[test]
    fn old_json_with_missing_fields_is_auto_filled() {
        let dir = setup_dirs();
        let id = uuid::Uuid::new_v4().to_string();
        let old_json = format!(r#"{{"id":"{id}","title":"Old Mindmap","updatedAt":1000}}"#);
        let path = mindmaps_dir(&dir).join(format!("{id}.json"));
        fs::write(&path, old_json).unwrap();

        let maps = list_mindmaps(&dir).unwrap();
        assert_eq!(maps.len(), 1);
        assert_eq!(maps[0].id, id);
        assert_eq!(maps[0].title, "Old Mindmap");
        assert_eq!(maps[0].updated_at, 1000);
        assert!(maps[0].nodes.is_empty());
        assert!(!maps[0].revision.is_empty());

        clean_dir(&dir);
    }

    #[test]
    fn old_json_preserves_unknown_fields() {
        let dir = setup_dirs();
        let id = uuid::Uuid::new_v4().to_string();
        let old_json =
            format!(r#"{{"id":"{id}","title":"Extra","updatedAt":2000,"color":"red","zoom":1.5}}"#);
        let path = mindmaps_dir(&dir).join(format!("{id}.json"));
        fs::write(&path, old_json).unwrap();

        let maps = list_mindmaps(&dir).unwrap();
        let mm = maps.into_iter().next().unwrap();

        let raw = serde_json::to_string(&mm).unwrap();
        assert!(raw.contains("\"color\":\"red\""));
        assert!(raw.contains("\"zoom\":1.5"));

        clean_dir(&dir);
    }

    #[test]
    fn unicode_title_validation() {
        let dir = setup_dirs();
        let emoji_title = "🌟".repeat(10);
        assert!(emoji_title.len() > 10);
        assert_eq!(emoji_title.chars().count(), 10);

        let mm = create_mindmap(&dir, Some(emoji_title)).unwrap();
        assert_eq!(mm.title.chars().count(), 10);

        let long_emoji = "🌟".repeat(600);
        let result = create_mindmap(&dir, Some(long_emoji));
        assert!(result.is_err());

        clean_dir(&dir);
    }

    #[test]
    fn cjk_title_validation() {
        let dir = setup_dirs();
        let cjk_title = "我".repeat(400);
        assert_eq!(cjk_title.chars().count(), 400);

        let mm = create_mindmap(&dir, Some(cjk_title.clone())).unwrap();
        assert_eq!(mm.title, cjk_title);

        let too_long = "我".repeat(600);
        let result = create_mindmap(&dir, Some(too_long));
        assert!(result.is_err());

        clean_dir(&dir);
    }

    #[test]
    fn list_continues_on_bad_file() {
        let dir = setup_dirs();
        let mm = create_mindmap(&dir, Some("AI_TEST_Good".into())).unwrap();

        let bad_path = mindmaps_dir(&dir).join("AI_TEST_badfile.json");
        fs::write(&bad_path, b"not valid json {{{").unwrap();

        let maps = list_mindmaps(&dir).unwrap();
        assert!(maps.iter().any(|m| m.id == mm.id));
        assert!(maps.iter().all(|m| m.id != "AI_TEST_badfile"));

        clean_dir(&dir);
    }

    #[test]
    fn delete_revision_conflict() {
        let dir = setup_dirs();
        let mm = create_mindmap(&dir, Some("AI_TEST_DelConflict".into())).unwrap();

        let result = delete_mindmap(
            &dir,
            &mm.id,
            Some("0000000000000000000000000000000000000000000000000000000000000000".into()),
        );
        assert!(result.is_err());
        let err = result.err().unwrap();
        assert!(err.starts_with("CONFLICT:"));
        clean_dir(&dir);
    }
}
