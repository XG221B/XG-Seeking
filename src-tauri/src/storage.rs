use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

fn now_millis() -> Result<u128, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())
        .map(|duration| duration.as_millis())
}

pub fn atomic_write_text(path: &Path, contents: &str) -> Result<(), String> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Invalid file name".to_string())?;
    let temp = path.with_file_name(format!(".{file_name}.{}.tmp", now_millis()?));
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

    if let Ok(file) = OpenOptions::new().read(true).write(true).open(path) {
        let _ = file.sync_all();
    }

    if backup.exists() {
        fs::remove_file(backup).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::atomic_write_text;
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
}
