use serde::Serialize;
use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub body: String,
    pub updated_at: u64,
}

fn notes_dir(app_data: &PathBuf) -> PathBuf {
    app_data.join("notes")
}

fn trash_dir(app_data: &PathBuf) -> PathBuf {
    app_data.join("trash")
}

pub fn ensure_dirs(app_data: &PathBuf) -> Result<(), String> {
    fs::create_dir_all(notes_dir(app_data)).map_err(|e| e.to_string())?;
    fs::create_dir_all(trash_dir(app_data)).map_err(|e| e.to_string())?;
    Ok(())
}

fn validate_note_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Invalid note id".into());
    }
    Ok(())
}

fn note_path(app_data: &PathBuf, id: &str) -> Result<PathBuf, String> {
    validate_note_id(id)?;
    // Canonicalize the directory (catches symlink tricks), then join the safe id.
    // File may not exist yet (e.g. during create), so only canonicalize the dir.
    let dir = notes_dir(app_data)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let path = dir.join(format!("{id}.md"));
    // Defense-in-depth: joined path must stay under notes_dir
    if !path.starts_with(&dir) {
        return Err("Path traversal denied".into());
    }
    Ok(path)
}

fn now_millis() -> Result<u64, String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    u64::try_from(millis).map_err(|e| e.to_string())
}

fn modified_millis(path: &PathBuf) -> Result<u64, String> {
    let millis = fs::metadata(path)
        .map_err(|e| e.to_string())?
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    u64::try_from(millis).map_err(|e| e.to_string())
}

fn parse_note(id: String, markdown: String, updated_at: u64) -> Note {
    let normalized = markdown.replace("\r\n", "\n");
    let mut lines = normalized.lines();
    let first = lines.next().unwrap_or_default();

    if let Some(title) = first.strip_prefix("# ") {
        let title = if title.trim().is_empty() {
            "未命名想法".into()
        } else {
            title.trim().into()
        };
        let body = normalized
            .lines()
            .skip(if normalized.lines().nth(1) == Some("") {
                2
            } else {
                1
            })
            .collect::<Vec<_>>()
            .join("\n");
        Note {
            id,
            title,
            body,
            updated_at,
        }
    } else {
        Note {
            id,
            title: "未命名想法".into(),
            body: normalized,
            updated_at,
        }
    }
}

fn serialize_note(title: &str, body: &str) -> String {
    let title = title
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();
    let title = if title.is_empty() {
        "未命名想法".into()
    } else {
        title
    };
    format!("# {title}\n\n{}", body.replace("\r\n", "\n"))
}

fn read_note_from(path: &PathBuf, id: &str) -> Result<Note, String> {
    let markdown = fs::read_to_string(path).map_err(|e| e.to_string())?;
    Ok(parse_note(id.into(), markdown, modified_millis(path)?))
}

fn list_notes_in(dir: &PathBuf) -> Result<Vec<Note>, String> {
    let mut notes = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
            continue;
        }
        if let Some(raw_id) = path.file_stem().and_then(|stem| stem.to_str()) {
            let id = raw_id.to_string();
            validate_note_id(&id)?;
            notes.push(read_note_from(&path, &id)?);
        }
    }
    notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(notes)
}

// ── Public API ──

pub fn list_notes(app_data: &PathBuf) -> Result<Vec<Note>, String> {
    list_notes_in(&notes_dir(app_data))
}

const MAX_TITLE_LEN: usize = 500;
const MAX_BODY_LEN: usize = 100_000;

fn validate_note_content(title: &str, body: &str) -> Result<(), String> {
    if title.len() > MAX_TITLE_LEN {
        return Err(format!("Title too long (max {MAX_TITLE_LEN} chars)"));
    }
    if body.len() > MAX_BODY_LEN {
        return Err(format!("Body too long (max {MAX_BODY_LEN} chars)"));
    }
    Ok(())
}

pub fn create_note(app_data: &PathBuf) -> Result<Note, String> {
    let id = format!("note-{}", now_millis()?);
    let ts = now_millis()?;
    let path = note_path(app_data, &id)?;
    fs::write(path, serialize_note("未命名想法", "")).map_err(|e| e.to_string())?;
    Ok(Note {
        id,
        title: "未命名想法".into(),
        body: String::new(),
        updated_at: ts,
    })
}

pub fn save_note(
    app_data: &PathBuf,
    id: String,
    title: String,
    body: String,
) -> Result<Note, String> {
    validate_note_content(&title, &body)?;
    let path = note_path(app_data, &id)?;
    fs::write(path, serialize_note(&title, &body)).map_err(|e| e.to_string())?;
    Ok(Note {
        id,
        title,
        body,
        updated_at: now_millis()?,
    })
}

/// Soft-delete: move the note from notes/ to trash/
pub fn delete_note(app_data: &PathBuf, id: &str) -> Result<(), String> {
    let src = note_path(app_data, id)?;
    if !src.exists() {
        return Ok(());
    }
    let dst = trash_dir(app_data).join(format!("{id}.md"));
    // Ensure trash dir exists
    fs::create_dir_all(trash_dir(app_data)).map_err(|e| e.to_string())?;
    fs::rename(&src, &dst).map_err(|e| e.to_string())
}

/// List notes currently in trash
pub fn list_trash(app_data: &PathBuf) -> Result<Vec<Note>, String> {
    let dir = trash_dir(app_data);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    list_notes_in(&dir)
}

/// Restore a note from trash/ back to notes/
pub fn restore_note(app_data: &PathBuf, id: &str) -> Result<Note, String> {
    let src = trash_dir(app_data).join(format!("{id}.md"));
    if !src.exists() {
        return Err("Note not found in trash".into());
    }
    let dst = notes_dir(app_data).join(format!("{id}.md"));
    fs::rename(&src, &dst).map_err(|e| e.to_string())?;
    read_note_from(&note_path(app_data, id)?, id)
}

/// Permanently delete a note from trash
pub fn delete_permanently(app_data: &PathBuf, id: &str) -> Result<(), String> {
    let path = trash_dir(app_data).join(format!("{id}.md"));
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
