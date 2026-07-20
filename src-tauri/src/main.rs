#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod mindmap;
mod notes;
mod settings;
mod storage;

use mindmap::Mindmap;
use notes::Note;
use settings::Settings;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, WebviewWindow};

fn app_data(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    notes::ensure_dirs(&dir)?;
    mindmap::ensure_dirs(&dir)?;
    Ok(dir)
}

fn recover_on_startup(app: &AppHandle) {
    if let Ok(dir) = app.path().app_data_dir() {
        let dirs = vec![
            dir.join("notes"),
            dir.join("trash"),
            dir.join("mindmaps"),
            dir.join("mindmaps_trash"),
        ];
        storage::recover_bak_files(&dirs);
        storage::cleanup_tmp_files(&dirs);
    }
}

#[tauri::command]
fn get_data_directory(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir = app_data(&app)?;
    Ok(serde_json::json!({ "path": dir.to_string_lossy() }))
}

#[tauri::command]
fn get_storage_warnings(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir = app_data(&app)?;
    let (notes, trash_notes) = notes::storage_warning_count(&dir);
    let (mindmaps, mindmap_trash) = mindmap::storage_warning_count(&dir);
    let settings = usize::from(!settings::load(&dir)?.warnings.is_empty());
    Ok(serde_json::json!({
        "notes": notes,
        "trashNotes": trash_notes,
        "mindmaps": mindmaps,
        "mindmapTrash": mindmap_trash,
        "settings": settings,
        "total": notes + trash_notes + mindmaps + mindmap_trash + settings,
    }))
}

#[tauri::command]
fn open_data_directory(app: AppHandle) -> Result<(), String> {
    let dir = app_data(&app)?;
    std::process::Command::new("explorer.exe")
        .arg(dir.to_string_lossy().as_ref())
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn list_notes(app: AppHandle) -> Result<Vec<Note>, String> {
    notes::list_notes(&app_data(&app)?)
}

#[tauri::command]
fn create_note(app: AppHandle, title: Option<String>) -> Result<Note, String> {
    notes::create_note(&app_data(&app)?, title)
}

#[tauri::command]
fn save_note(
    app: AppHandle,
    id: String,
    title: String,
    body: String,
    expected_revision: Option<String>,
) -> Result<Note, String> {
    notes::save_note(&app_data(&app)?, id, title, body, expected_revision)
}

#[tauri::command]
fn delete_note(
    app: AppHandle,
    id: String,
    expected_revision: Option<String>,
) -> Result<(), String> {
    notes::delete_note(&app_data(&app)?, &id, expected_revision)
}

#[tauri::command]
fn list_trash(app: AppHandle) -> Result<Vec<Note>, String> {
    notes::list_trash(&app_data(&app)?)
}

#[tauri::command]
fn restore_note(
    app: AppHandle,
    id: String,
    expected_revision: Option<String>,
) -> Result<Note, String> {
    notes::restore_note(&app_data(&app)?, &id, expected_revision)
}

#[tauri::command]
fn delete_permanently(
    app: AppHandle,
    id: String,
    expected_revision: Option<String>,
) -> Result<(), String> {
    notes::delete_permanently(&app_data(&app)?, &id, expected_revision)
}

#[tauri::command]
fn list_mindmaps(app: AppHandle) -> Result<Vec<Mindmap>, String> {
    mindmap::list_mindmaps(&app_data(&app)?)
}

#[tauri::command]
fn create_mindmap(app: AppHandle, title: Option<String>) -> Result<Mindmap, String> {
    mindmap::create_mindmap(&app_data(&app)?, title)
}

#[tauri::command]
fn save_mindmap(
    app: AppHandle,
    mm: Mindmap,
    expected_revision: Option<String>,
) -> Result<Mindmap, String> {
    mindmap::save_mindmap(&app_data(&app)?, mm, expected_revision)
}

#[tauri::command]
fn delete_mindmap(
    app: AppHandle,
    id: String,
    expected_revision: Option<String>,
) -> Result<(), String> {
    mindmap::delete_mindmap(&app_data(&app)?, &id, expected_revision)
}

#[tauri::command]
fn list_mindmap_trash(app: AppHandle) -> Result<Vec<Mindmap>, String> {
    mindmap::list_trash(&app_data(&app)?)
}

#[tauri::command]
fn restore_mindmap(
    app: AppHandle,
    id: String,
    expected_revision: Option<String>,
) -> Result<Mindmap, String> {
    mindmap::restore_mindmap(&app_data(&app)?, &id, expected_revision)
}

#[tauri::command]
fn delete_mindmap_permanently(
    app: AppHandle,
    id: String,
    expected_revision: Option<String>,
) -> Result<(), String> {
    mindmap::delete_permanently(&app_data(&app)?, &id, expected_revision)
}

#[tauri::command]
fn get_settings(app: AppHandle) -> Result<Settings, String> {
    settings::load(&app_data(&app)?)
}

#[tauri::command]
fn save_settings(
    app: AppHandle,
    language: String,
    title: String,
    theme: Option<String>,
) -> Result<(), String> {
    settings::save(
        &app_data(&app)?,
        &Settings {
            language,
            title,
            theme: theme.unwrap_or_else(|| "system".into()),
            warnings: Vec::new(),
        },
    )
}

#[tauri::command]
fn set_window_title(window: WebviewWindow, title: String) -> Result<(), String> {
    window.set_title(&title).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            recover_on_startup(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_data_directory,
            get_storage_warnings,
            open_data_directory,
            list_notes,
            create_note,
            save_note,
            delete_note,
            list_trash,
            restore_note,
            delete_permanently,
            list_mindmaps,
            create_mindmap,
            save_mindmap,
            delete_mindmap,
            list_mindmap_trash,
            restore_mindmap,
            delete_mindmap_permanently,
            get_settings,
            save_settings,
            set_window_title,
        ])
        .run(tauri::generate_context!())
        .expect("error while running XG221B");
}
