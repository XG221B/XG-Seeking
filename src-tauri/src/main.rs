#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileItem {
    id: String,
    name: String,
    ext: String,
    size: u64,
    updated_at: u64,
    kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FilePreview {
    id: String,
    name: String,
    ext: String,
    size: u64,
    updated_at: u64,
    kind: String,
    content: Option<String>,
    data_url: Option<String>,
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

fn files_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("files");
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

fn ensure_file_id(id: &str) -> Result<(), String> {
    if id
        .chars()
        .all(|char| char.is_ascii_alphanumeric() || char == '-' || char == '_')
    {
        Ok(())
    } else {
        Err("Invalid file id".into())
    }
}

fn note_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    ensure_note_id(id)?;
    Ok(notes_dir(app)?.join(format!("{id}.md")))
}

fn file_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    ensure_file_id(id)?;
    let prefix = format!("{id}__");
    for entry in fs::read_dir(files_dir(app)?).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if name.starts_with(&prefix) {
            return Ok(path);
        }
    }
    Err("File not found".into())
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

fn kind_from_ext(ext: &str) -> String {
    match ext {
        "png" | "jpg" | "jpeg" | "gif" | "bmp" | "webp" | "svg" => "image",
        "pdf" => "pdf",
        "txt" | "md" | "csv" | "json" | "js" | "css" | "html" | "xml" | "rs" | "toml" | "yml"
        | "yaml" | "log" => "text",
        _ => "unsupported",
    }
    .into()
}

fn mime_from_ext(ext: &str) -> &str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

fn file_item_from_path(path: &Path) -> Result<FileItem, String> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Invalid file name".to_string())?;
    let (id, name) = file_name
        .split_once("__")
        .ok_or_else(|| "Invalid stored file name".to_string())?;
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_lowercase();
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;

    Ok(FileItem {
        id: id.into(),
        name: name.into(),
        ext: ext.clone(),
        size: metadata.len(),
        updated_at: modified_millis(&path.to_path_buf())?,
        kind: kind_from_ext(&ext),
    })
}

fn sanitize_file_name(name: &str) -> String {
    name.chars()
        .map(|char| match char {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => char,
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string()
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

#[tauri::command]
fn list_files(app: AppHandle) -> Result<Vec<FileItem>, String> {
    let mut files = Vec::new();

    for entry in fs::read_dir(files_dir(&app)?).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.is_file() {
            files.push(file_item_from_path(&path)?);
        }
    }

    files.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(files)
}

#[tauri::command]
fn import_files(app: AppHandle, paths: Vec<String>) -> Result<Vec<FileItem>, String> {
    let dir = files_dir(&app)?;
    let mut imported = Vec::new();

    for (index, path) in paths.iter().enumerate() {
        let source = PathBuf::from(path);
        if !source.is_file() {
            continue;
        }

        let original_name = source
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "Invalid file name".to_string())?;
        let safe_name = sanitize_file_name(original_name);
        if safe_name.is_empty() {
            continue;
        }

        let id = format!("file-{}-{index}", now_millis()?);
        let target = dir.join(format!("{id}__{safe_name}"));
        fs::copy(&source, &target).map_err(|error| error.to_string())?;
        imported.push(file_item_from_path(&target)?);
    }

    Ok(imported)
}

#[tauri::command]
fn read_file_preview(app: AppHandle, id: String) -> Result<FilePreview, String> {
    let path = file_path(&app, &id)?;
    let item = file_item_from_path(&path)?;
    let mut preview = FilePreview {
        id: item.id,
        name: item.name,
        ext: item.ext.clone(),
        size: item.size,
        updated_at: item.updated_at,
        kind: item.kind.clone(),
        content: None,
        data_url: None,
    };

    match item.kind.as_str() {
        "text" => {
            preview.content = Some(fs::read_to_string(path).map_err(|error| error.to_string())?);
        }
        "image" | "pdf" => {
            let bytes = fs::read(path).map_err(|error| error.to_string())?;
            let encoded = general_purpose::STANDARD.encode(bytes);
            preview.data_url = Some(format!("data:{};base64,{encoded}", mime_from_ext(&item.ext)));
        }
        _ => {}
    }

    Ok(preview)
}

#[tauri::command]
fn delete_file(app: AppHandle, id: String) -> Result<(), String> {
    let path = file_path(&app, &id)?;
    fs::remove_file(path).map_err(|error| error.to_string())?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_notes,
            create_note,
            save_note,
            delete_note,
            list_files,
            import_files,
            read_file_preview,
            delete_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running XG221B");
}
