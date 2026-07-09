# Changelog

## 0.2.1

- Fixed Windows/Tauri save failures that showed `Access is denied (os error 5)` when creating notes, creating mindmaps, or switching pages after edits.
- Kept the safer temp-file write path while making post-rename file synchronization best-effort on Windows.

## 0.2.0

- Clarified the app direction as local-first Markdown notes with Edit and Preview modes.
- Removed the rich-text formatting direction in favor of Markdown source as the canonical note body.
- Added API and real browser UI smoke tests for notes, trash, restore, mindmaps, page switching, and cleanup.
- Hardened note, mindmap, and settings saving with safer Rust storage writes.
- Improved stale async request protection around creating notes and mindmaps.
- Aligned README and agent guidance with the current product direction and QA workflow.

## 0.1.0

- Converted the prototype into a lightweight Tauri project structure.
- Moved note file operations from a local Node server into the desktop app backend.
- Preserved the current XG221B interface, icon, note list, search bubble, and auto-save behavior.
