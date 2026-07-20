# Changelog

## 0.3.0

- Fixed malformed Markdown Preview closing tags and added exact renderer safety tests.
- Serialized cross-process note and mindmap mutations with per-path locks; stale saves can no longer recreate deleted files.
- Added revision checks to delete, restore, and permanent-delete UI operations.
- Added an installed-app close guard that waits for dirty notes and mindmaps to flush before destroying the window.
- Hardened the Node local API against cross-origin localhost requests and invalid request methods/content types.
- Added mindmap file, node-count, depth, and node-text limits in both backends.
- Added non-blocking storage-health warnings for unreadable files and corrupted settings.
- Restricted GitHub Releases to version tags and aligned Action versions with CI.
- Fixed the API smoke runner so failed steps fail the command instead of only printing `FAIL`.

- Removed unfinished Home/Coming Soon placeholder; app now starts at Notes page.
- Removed loading spinners and placeholder loading states; pages show existing content or empty states immediately, with error states only on real failures.
- Added Ctrl+S (flush save for active note/mindmap) and Ctrl+F (focus search) keyboard shortcuts.
- Added Markdown-derived tag extraction from note bodies; tag appears as a filter dropdown in the Notes sidebar when active notes contain tags. Tags are ephemeral UI state, never stored.
- Added Settings data directory path display and Open Data Folder action to quickly reach the canonical local data directory.
- Local server now supports port 0 for deterministic test port assignment.
- Chrome test helper reads `DevToolsActivePort` instead of picking random debug ports.
- Added phase-specific smoke tests for tag filtering, shortcuts, data directory contracts, and loading state removal.
- Updated CI to install Chromium and run full QA before Rust checks.
- Updated all version sources to 0.3.0.

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
