use fs2::FileExt;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

pub fn with_file_locks<T, F>(paths: &[PathBuf], operation: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String>,
{
    let lock_root = std::env::temp_dir().join("xg-seeking-locks");
    fs::create_dir_all(&lock_root).map_err(|e| e.to_string())?;
    let mut ordered = paths.to_vec();
    ordered.sort();
    ordered.dedup();
    let mut locks = Vec::with_capacity(ordered.len());
    for path in ordered {
        let key = sha256_hex(path.to_string_lossy().as_bytes());
        let lock_path = lock_root.join(format!("{key}.lock"));
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(lock_path)
            .map_err(|e| e.to_string())?;
        file.lock_exclusive().map_err(|e| e.to_string())?;
        locks.push(file);
    }
    let result = operation();
    for file in locks.iter().rev() {
        let _ = FileExt::unlock(file);
    }
    result
}

pub fn atomic_write_text(path: &Path, contents: &str) -> Result<(), String> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Invalid file name".to_string())?;
    let temp = path.with_file_name(format!(".{file_name}.{}.tmp", uuid::Uuid::new_v4()));
    let backup = path.with_file_name(format!(".{file_name}.bak"));

    {
        let mut file = File::create(&temp).map_err(|e| e.to_string())?;
        file.write_all(contents.as_bytes())
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }

    if path.exists() {
        if backup.exists() {
            fs::remove_file(&backup).map_err(|e| e.to_string())?;
        }
        fs::rename(path, &backup).map_err(|e| e.to_string())?;
    }

    if let Err(error) = fs::rename(&temp, path) {
        let _ = fs::remove_file(&temp);
        if backup.exists() {
            let _ = fs::rename(&backup, path);
        }
        return Err(error.to_string());
    }

    if let Some(parent) = path.parent() {
        if let Ok(directory) = File::open(parent) {
            let _ = directory.sync_all();
        }
    }

    if backup.exists() {
        let _ = fs::remove_file(backup);
    }

    Ok(())
}

fn original_from_bak(bak_path: &Path) -> Option<PathBuf> {
    let file_name = bak_path.file_name()?.to_str()?;
    if !file_name.starts_with('.') {
        return None;
    }
    let without_dot = &file_name[1..];
    let original_name = without_dot.strip_suffix(".bak")?;
    Some(bak_path.parent()?.join(original_name))
}

pub fn recover_bak_files(dirs: &[PathBuf]) {
    for dir in dirs {
        if !dir.exists() {
            continue;
        }
        let entries = match fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("bak") {
                continue;
            }
            if let Some(main_path) = original_from_bak(&path) {
                if !main_path.exists() {
                    let _ = fs::rename(&path, &main_path);
                }
            }
        }
    }
}

pub fn cleanup_tmp_files(dirs: &[PathBuf]) {
    for dir in dirs {
        if !dir.exists() {
            continue;
        }
        let entries = match fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("tmp") {
                let _ = fs::remove_file(&path);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        env, fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn atomic_write_text_creates_and_replaces_file() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let dir = env::temp_dir().join(format!("xg-seeking-storage-test-{stamp}"));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("note.md");

        atomic_write_text(&path, "first").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "first");

        atomic_write_text(&path, "second").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "second");

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn sha256_hex_is_deterministic() {
        let h1 = sha256_hex(b"hello");
        let h2 = sha256_hex(b"hello");
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 64);
    }

    #[test]
    fn sha256_hex_differs_for_different_input() {
        let h1 = sha256_hex(b"hello");
        let h2 = sha256_hex(b"world");
        assert_ne!(h1, h2);
    }

    #[test]
    fn original_from_bak_restores_correct_name() {
        let bak = Path::new("/tmp/notes/.AI_TEST_abc.md.bak");
        let orig = original_from_bak(bak).unwrap();
        assert_eq!(orig, Path::new("/tmp/notes/AI_TEST_abc.md"));
    }

    #[test]
    fn recover_bak_files_restores_missing() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let dir = env::temp_dir().join(format!("xg-seeking-bak-test-{stamp}"));
        fs::create_dir_all(&dir).unwrap();
        let main = dir.join("AI_TEST_recover.md");
        let bak = dir.join(".AI_TEST_recover.md.bak");
        fs::write(&bak, b"recovered content").unwrap();

        assert!(!main.exists());
        recover_bak_files(&[dir.clone()]);
        assert!(main.exists());
        assert_eq!(fs::read_to_string(&main).unwrap(), "recovered content");

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn cleanup_tmp_files_removes_orphans() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let dir = env::temp_dir().join(format!("xg-seeking-tmp-test-{stamp}"));
        fs::create_dir_all(&dir).unwrap();
        let tmp = dir.join(".AI_TEST_note.md.12345.tmp");
        fs::write(&tmp, b"temp").unwrap();

        assert!(tmp.exists());
        cleanup_tmp_files(&[dir.clone()]);
        assert!(!tmp.exists());

        fs::remove_dir_all(dir).unwrap();
    }
}
