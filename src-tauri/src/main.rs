#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Note {
    id: String,
    title: String,
    body: String,
    updated_at: u64,
}

fn notes_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("notes");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn ensure_note_id(id: &str) -> Result<(), String> {
    if id
        .chars()
        .all(|char| char.is_ascii_alphanumeric() || char == '-' || char == '_')
    {
        Ok(())
    } else {
        Err("Invalid note id".into())
    }
}

fn note_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    ensure_note_id(id)?;
    Ok(notes_dir(app)?.join(format!("{id}.md")))
}

fn now_millis() -> Result<u64, String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    u64::try_from(millis).map_err(|error| error.to_string())
}

fn modified_millis(path: &PathBuf) -> Result<u64, String> {
    let millis = fs::metadata(path)
        .map_err(|error| error.to_string())?
        .modified()
        .map_err(|error| error.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    u64::try_from(millis).map_err(|error| error.to_string())
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
            .skip(if normalized.lines().nth(1) == Some("") { 2 } else { 1 })
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

fn read_note(app: &AppHandle, id: &str) -> Result<Note, String> {
    let path = note_path(app, id)?;
    let markdown = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    Ok(parse_note(id.into(), markdown, modified_millis(&path)?))
}

#[tauri::command]
fn list_notes(app: AppHandle) -> Result<Vec<Note>, String> {
    let dir = notes_dir(&app)?;
    let mut notes = Vec::new();

    for entry in fs::read_dir(dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
            continue;
        }
        if let Some(id) = path.file_stem().and_then(|stem| stem.to_str()) {
            notes.push(read_note(&app, id)?);
        }
    }

    notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(notes)
}

#[tauri::command]
fn create_note(app: AppHandle) -> Result<Note, String> {
    let id = format!("note-{}", now_millis()?);
    let path = note_path(&app, &id)?;
    fs::write(path, serialize_note("未命名想法", "")).map_err(|error| error.to_string())?;
    read_note(&app, &id)
}

#[tauri::command]
fn save_note(app: AppHandle, id: String, title: String, body: String) -> Result<Note, String> {
    let path = note_path(&app, &id)?;
    fs::write(path, serialize_note(&title, &body)).map_err(|error| error.to_string())?;
    read_note(&app, &id)
}

#[tauri::command]
fn delete_note(app: AppHandle, id: String) -> Result<(), String> {
    let path = note_path(&app, &id)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_notes,
            create_note,
            save_note,
            delete_note
        ])
        .run(tauri::generate_context!())
        .expect("error while running XG221B");
}
