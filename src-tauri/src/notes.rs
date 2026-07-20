use crate::storage::{atomic_write_text, sha256_hex, with_file_locks};
use serde::Serialize;
use std::{
    cmp::Reverse,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub body: String,
    pub updated_at: u64,
    pub revision: String,
}

fn notes_dir(app_data: &Path) -> PathBuf {
    app_data.join("notes")
}

fn trash_dir(app_data: &Path) -> PathBuf {
    app_data.join("trash")
}

pub fn ensure_dirs(app_data: &Path) -> Result<(), String> {
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

fn note_path(app_data: &Path, id: &str) -> Result<PathBuf, String> {
    validate_note_id(id)?;
    let dir = notes_dir(app_data)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let path = dir.join(format!("{id}.md"));
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

fn modified_millis(path: &Path) -> Result<u64, String> {
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
            revision: String::new(),
        }
    } else {
        Note {
            id,
            title: "未命名想法".into(),
            body: normalized,
            updated_at,
            revision: String::new(),
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

fn read_note_from(path: &Path, id: &str) -> Result<Note, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let revision = sha256_hex(&bytes);
    let markdown = String::from_utf8(bytes).map_err(|e| e.to_string())?;
    let mut note = parse_note(id.into(), markdown, modified_millis(path)?);
    note.revision = revision;
    Ok(note)
}

fn list_notes_in(dir: &Path) -> Result<Vec<Note>, String> {
    let mut notes = Vec::new();
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
        if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
            continue;
        }
        if let Some(raw_id) = path.file_stem().and_then(|stem| stem.to_str()) {
            let id = raw_id.to_string();
            if validate_note_id(&id).is_err() {
                continue;
            }
            if let Ok(note) = read_note_from(&path, &id) {
                notes.push(note);
            }
        }
    }
    notes.sort_by_key(|b| Reverse(b.updated_at));
    Ok(notes)
}

const MAX_TITLE_LEN: usize = 500;
const MAX_BODY_LEN: usize = 100_000;

fn validate_note_content(title: &str, body: &str) -> Result<(), String> {
    if title.chars().count() > MAX_TITLE_LEN {
        return Err(format!("Title too long (max {MAX_TITLE_LEN} chars)"));
    }
    if body.chars().count() > MAX_BODY_LEN {
        return Err(format!("Body too long (max {MAX_BODY_LEN} chars)"));
    }
    if title.trim().is_empty() {
        return Err("Title must not be empty".into());
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
        .unwrap_or_else(|| "未命名想法".into())
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let resolved = if normalized.is_empty() {
        "未命名想法".into()
    } else {
        normalized
    };
    validate_note_content(&resolved, "")?;
    Ok(resolved)
}

pub fn list_notes(app_data: &Path) -> Result<Vec<Note>, String> {
    list_notes_in(&notes_dir(app_data))
}

pub fn storage_warning_count(app_data: &Path) -> (usize, usize) {
    fn count(dir: &Path) -> usize {
        fs::read_dir(dir)
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .filter(|entry| {
                        entry.path().extension().and_then(|ext| ext.to_str()) == Some("md")
                    })
                    .filter(|entry| {
                        let path = entry.path();
                        let Some(id) = path.file_stem().and_then(|stem| stem.to_str()) else {
                            return true;
                        };
                        validate_note_id(id).is_err() || read_note_from(&path, id).is_err()
                    })
                    .count()
            })
            .unwrap_or(0)
    }
    (count(&notes_dir(app_data)), count(&trash_dir(app_data)))
}

pub fn create_note(app_data: &Path, title: Option<String>) -> Result<Note, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let ts = now_millis()?;
    let resolved = resolve_title(title)?;
    let path = note_path(app_data, &id)?;
    let content = serialize_note(&resolved, "");
    let revision = sha256_hex(content.as_bytes());
    atomic_write_text(&path, &content)?;
    Ok(Note {
        id,
        title: resolved,
        body: String::new(),
        updated_at: ts,
        revision,
    })
}

pub fn save_note(
    app_data: &Path,
    id: String,
    title: String,
    body: String,
    expected_revision: Option<String>,
) -> Result<Note, String> {
    if let Err(e) = validate_note_content(&title, &body) {
        return Err(format!("VALIDATION:{}", e));
    }
    let path = note_path(app_data, &id).map_err(|e| format!("VALIDATION:{}", e))?;
    let content = serialize_note(&title, &body);
    let revision = sha256_hex(content.as_bytes());
    with_file_locks(std::slice::from_ref(&path), || {
        check_revision(&path, expected_revision.as_deref())?;
        atomic_write_text(&path, &content).map_err(|e| format!("IO:{}", e))
    })?;
    Ok(Note {
        id,
        title,
        body,
        updated_at: now_millis().map_err(|e| format!("IO:{}", e))?,
        revision,
    })
}

pub fn delete_note(
    app_data: &Path,
    id: &str,
    expected_revision: Option<String>,
) -> Result<(), String> {
    let src = note_path(app_data, id).map_err(|e| format!("VALIDATION:{}", e))?;
    let dst = trash_dir(app_data).join(format!("{id}.md"));
    fs::create_dir_all(trash_dir(app_data)).map_err(|e| format!("IO:{}", e))?;
    with_file_locks(&[src.clone(), dst.clone()], || {
        check_revision(&src, expected_revision.as_deref())?;
        if dst.exists() {
            return Err("VALIDATION:A trashed note with this id already exists".to_string());
        }
        fs::rename(&src, &dst).map_err(|e| format!("IO:{}", e))
    })
}

pub fn list_trash(app_data: &Path) -> Result<Vec<Note>, String> {
    let dir = trash_dir(app_data);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    list_notes_in(&dir)
}

pub fn restore_note(
    app_data: &Path,
    id: &str,
    expected_revision: Option<String>,
) -> Result<Note, String> {
    validate_note_id(id).map_err(|e| format!("VALIDATION:{}", e))?;
    let src = trash_dir(app_data).join(format!("{id}.md"));
    let dst = notes_dir(app_data).join(format!("{id}.md"));
    with_file_locks(&[src.clone(), dst.clone()], || {
        check_revision(&src, expected_revision.as_deref())?;
        if dst.exists() {
            return Err("VALIDATION:A note with this id already exists".to_string());
        }
        fs::rename(&src, &dst).map_err(|e| format!("IO:{}", e))
    })?;
    read_note_from(
        &note_path(app_data, id).map_err(|e| format!("VALIDATION:{}", e))?,
        id,
    )
    .map_err(|e| format!("IO:{}", e))
}

pub fn delete_permanently(
    app_data: &Path,
    id: &str,
    expected_revision: Option<String>,
) -> Result<(), String> {
    validate_note_id(id).map_err(|e| format!("VALIDATION:{}", e))?;
    let path = trash_dir(app_data).join(format!("{id}.md"));
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
        let dir = test_dir("notes");
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
        let note = create_note(&dir, Some("AI_TEST_Revision".into())).unwrap();
        assert!(!note.revision.is_empty());
        assert_eq!(note.revision.len(), 64);
        clean_dir(&dir);
    }

    #[test]
    fn revision_changes_after_save() {
        let dir = setup_dirs();
        let note = create_note(&dir, Some("AI_TEST_RevChange".into())).unwrap();
        let rev1 = note.revision.clone();

        let saved = save_note(
            &dir,
            note.id.clone(),
            "AI_TEST_RevChange".into(),
            "new body".into(),
            None,
        )
        .unwrap();
        assert_ne!(saved.revision, rev1);
        clean_dir(&dir);
    }

    #[test]
    fn save_with_matching_revision_succeeds() {
        let dir = setup_dirs();
        let note = create_note(&dir, Some("AI_TEST_Match".into())).unwrap();
        let rev = note.revision.clone();

        let result = save_note(
            &dir,
            note.id.clone(),
            "AI_TEST_Match".into(),
            "updated".into(),
            Some(rev),
        );
        assert!(result.is_ok());
        clean_dir(&dir);
    }

    #[test]
    fn save_with_mismatched_revision_returns_conflict() {
        let dir = setup_dirs();
        let note = create_note(&dir, Some("AI_TEST_Mismatch".into())).unwrap();

        let result = save_note(
            &dir,
            note.id.clone(),
            "AI_TEST_Mismatch".into(),
            "updated".into(),
            Some("0000000000000000000000000000000000000000000000000000000000000000".into()),
        );
        assert!(result.is_err());
        let err = result.err().unwrap();
        assert!(err.starts_with("CONFLICT:"));
        assert!(err.contains(&note.revision));
        clean_dir(&dir);
    }

    #[test]
    fn save_with_not_found_revision() {
        let dir = setup_dirs();
        let result = save_note(
            &dir,
            "AI_TEST_nonexistent".into(),
            "Title".into(),
            "body".into(),
            Some("abc123".into()),
        );
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.starts_with("NOT_FOUND:"));
        clean_dir(&dir);
    }

    #[test]
    fn save_missing_note_without_revision_is_rejected() {
        let dir = setup_dirs();
        let result = save_note(
            &dir,
            "AI_TEST_nonexistent_no_revision".into(),
            "Title".into(),
            "body".into(),
            None,
        );
        assert!(result.unwrap_err().starts_with("NOT_FOUND:"));
        clean_dir(&dir);
    }

    #[test]
    fn concurrent_writes_with_same_revision_only_allow_one() {
        let dir = setup_dirs();
        let note = create_note(&dir, Some("AI_TEST_Concurrent".into())).unwrap();
        let revision = note.revision.clone();
        let first_dir = dir.clone();
        let first_id = note.id.clone();
        let first_revision = revision.clone();
        let first = thread::spawn(move || {
            save_note(
                &first_dir,
                first_id,
                "First".into(),
                "a".into(),
                Some(first_revision),
            )
        });
        let second_dir = dir.clone();
        let second_id = note.id.clone();
        let second = thread::spawn(move || {
            save_note(
                &second_dir,
                second_id,
                "Second".into(),
                "b".into(),
                Some(revision),
            )
        });
        let results = [first.join().unwrap(), second.join().unwrap()];
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| result
                    .as_ref()
                    .is_err_and(|error| error.starts_with("CONFLICT:")))
                .count(),
            1
        );
        clean_dir(&dir);
    }

    #[test]
    fn delete_revision_conflict() {
        let dir = setup_dirs();
        let note = create_note(&dir, Some("AI_TEST_DelConflict".into())).unwrap();

        let result = delete_note(
            &dir,
            &note.id,
            Some("0000000000000000000000000000000000000000000000000000000000000000".into()),
        );
        assert!(result.is_err());
        let err = result.err().unwrap();
        assert!(err.starts_with("CONFLICT:"));
        clean_dir(&dir);
    }

    #[test]
    fn unicode_title_length_uses_code_points() {
        let dir = setup_dirs();
        let emoji_title = "🌟".repeat(10);
        assert!(emoji_title.len() > 10);
        assert_eq!(emoji_title.chars().count(), 10);

        let note = create_note(&dir, Some(emoji_title)).unwrap();
        assert_eq!(note.title.chars().count(), 10);

        let long_emoji = "🌟".repeat(600);
        let result = create_note(&dir, Some(long_emoji));
        assert!(result.is_err());

        clean_dir(&dir);
    }

    #[test]
    fn cjk_title_validation() {
        let dir = setup_dirs();
        let cjk_title = "我".repeat(400);
        assert!(cjk_title.len() <= 500 * 3);
        assert_eq!(cjk_title.chars().count(), 400);

        let note = create_note(&dir, Some(cjk_title.clone())).unwrap();
        assert_eq!(note.title, cjk_title);

        let too_long = "我".repeat(600);
        let result = create_note(&dir, Some(too_long));
        assert!(result.is_err());

        clean_dir(&dir);
    }

    #[test]
    fn list_continues_on_bad_file() {
        let dir = setup_dirs();
        let note = create_note(&dir, Some("AI_TEST_Good".into())).unwrap();

        let bad_path = notes_dir(&dir).join("AI_TEST_badfile.md");
        fs::write(&bad_path, b"\xFF\xFE invalid utf8").unwrap();

        let notes = list_notes(&dir).unwrap();
        assert!(notes.iter().any(|n| n.id == note.id));
        assert!(notes.iter().all(|n| n.id != "AI_TEST_badfile"));

        clean_dir(&dir);
    }

    #[test]
    fn validation_error_has_prefix() {
        let dir = setup_dirs();
        let note = create_note(&dir, Some("AI_TEST_Valid".into())).unwrap();
        let rev = note.revision.clone();

        let long_title = "A".repeat(600);
        let result = save_note(&dir, note.id, long_title, "body".into(), Some(rev));
        assert!(result.is_err());
        let err = result.err().unwrap();
        assert!(err.starts_with("VALIDATION:"));

        clean_dir(&dir);
    }
}
