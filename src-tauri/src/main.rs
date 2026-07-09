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

// ── Notes ──

#[tauri::command]
fn list_notes(app: AppHandle) -> Result<Vec<Note>, String> {
    notes::list_notes(&app_data(&app)?)
}

#[tauri::command]
fn create_note(app: AppHandle, title: Option<String>) -> Result<Note, String> {
    notes::create_note(&app_data(&app)?, title)
}

#[tauri::command]
fn save_note(app: AppHandle, id: String, title: String, body: String) -> Result<Note, String> {
    notes::save_note(&app_data(&app)?, id, title, body)
}

#[tauri::command]
fn delete_note(app: AppHandle, id: String) -> Result<(), String> {
    notes::delete_note(&app_data(&app)?, &id)
}

#[tauri::command]
fn list_trash(app: AppHandle) -> Result<Vec<Note>, String> {
    notes::list_trash(&app_data(&app)?)
}

#[tauri::command]
fn restore_note(app: AppHandle, id: String) -> Result<Note, String> {
    notes::restore_note(&app_data(&app)?, &id)
}

#[tauri::command]
fn delete_permanently(app: AppHandle, id: String) -> Result<(), String> {
    notes::delete_permanently(&app_data(&app)?, &id)
}

// ── Mindmaps ──

#[tauri::command]
fn list_mindmaps(app: AppHandle) -> Result<Vec<Mindmap>, String> {
    mindmap::list_mindmaps(&app_data(&app)?)
}

#[tauri::command]
fn create_mindmap(app: AppHandle, title: Option<String>) -> Result<Mindmap, String> {
    mindmap::create_mindmap(&app_data(&app)?, title)
}

#[tauri::command]
fn save_mindmap(app: AppHandle, mm: Mindmap) -> Result<Mindmap, String> {
    mindmap::save_mindmap(&app_data(&app)?, mm)
}

#[tauri::command]
fn delete_mindmap(app: AppHandle, id: String) -> Result<(), String> {
    mindmap::delete_mindmap(&app_data(&app)?, &id)
}

#[tauri::command]
fn list_mindmap_trash(app: AppHandle) -> Result<Vec<Mindmap>, String> {
    mindmap::list_trash(&app_data(&app)?)
}

#[tauri::command]
fn restore_mindmap(app: AppHandle, id: String) -> Result<Mindmap, String> {
    mindmap::restore_mindmap(&app_data(&app)?, &id)
}

#[tauri::command]
fn delete_mindmap_permanently(app: AppHandle, id: String) -> Result<(), String> {
    mindmap::delete_permanently(&app_data(&app)?, &id)
}

// ── Settings ──

#[tauri::command]
fn get_settings(app: AppHandle) -> Result<Settings, String> {
    settings::load(&app_data(&app)?)
}

#[tauri::command]
fn save_settings(app: AppHandle, language: String, title: String) -> Result<(), String> {
    settings::save(&app_data(&app)?, &Settings { language, title })
}

#[tauri::command]
fn set_window_title(window: WebviewWindow, title: String) -> Result<(), String> {
    window.set_title(&title).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
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
