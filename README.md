# XG-Seeking

Seeking Fragments of the Soul

A minimalist, local-first desktop notes app for writing Markdown notes, searching quickly, and keeping deleted items recoverable through a trash workflow.

[![Release](https://img.shields.io/github/v/release/XG221B/xg-seeking?color=%23002060)](https://github.com/XG221B/xg-seeking/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-%23002060)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-%23002060)](https://github.com/XG221B/xg-seeking/releases/latest)

## Features

- Local-first Markdown notes.
- Obsidian-style Edit and Preview modes: Edit writes raw Markdown, Preview renders it for reading.
- Auto-save.
- Search.
- Trash, restore, and permanent delete workflows.
- Mindmap notes.
- Chinese and English UI modes.
- Browser-only local development mode through `local-server.mjs`.
- Desktop app packaging through Tauri.

## Product Direction

XG-Seeking treats Markdown as the canonical note format. It is not a Word-style rich text editor: note content is saved as Markdown source, and formatting should be represented with Markdown syntax rather than hidden rich-text state.

The app is local-first. Notes, mindmaps, trash, and settings are stored locally, with safer write paths and smoke tests intended to catch data-loss, page-switching, trash, restore, and preview regressions before release.

## Install

Download the latest `XG221B_0.x.x_x64-setup.exe` from [Releases](https://github.com/XG221B/xg-seeking/releases/latest) and run it.

To uninstall, use Windows Settings > Apps > XG221B, or run `uninstall.exe` from the install directory.

## Data Directory

All user data (notes, mindmaps, settings, trash) is stored locally in a single data directory:

- **Installed app**: `%APPDATA%\XG221B\` (reachable via Settings > Open Data Folder)
- **Browser/dev mode**: `local-data\` inside the project folder

To back up, copy the complete data directory. To restore, place the copy in the correct location.

## Development

Prerequisites:

- Node.js
- Rust + Cargo
- Windows WebView2

Common commands:

```bash
npm install
npm run dev
npm run web:dev
npm run web:build
npm run smoke
npm run smoke:ui
npm run qa
npm run build
```

QA commands:

- `npm run smoke`: API/data smoke test for notes, trash, mindmaps, settings contracts, validation, and cleanup.
- `npm run smoke:ui`: real browser UI smoke test for Notes and Mindmaps. It uses installed Chrome/Edge, or `CHROME_PATH` if a custom browser path is needed.
- `npm run qa`: runs both smoke suites.

## Project Structure

```text
xg-seeking/
|-- .github/               # GitHub workflows and release config
|-- docs/                  # Project documentation
|   |-- CHANGELOG.md
|   `-- QA-WORKFLOW.md
|-- scripts/               # Helper scripts for local use
|   `-- start-xg221b.vbs / startup script
|-- src/                   # Frontend source
|   |-- main.js
|   `-- styles.css
|-- src-tauri/             # Tauri/Rust desktop shell
|   |-- src/
|   |   |-- main.rs
|   |   |-- notes.rs
|   |   |-- mindmap.rs
|   |   |-- settings.rs
|   |   `-- storage.rs
|   |-- icons/
|   |-- Cargo.toml
|   `-- Cargo.lock
|-- tests/                 # Smoke and regression checks
|   `-- smoke/
|-- AGENTS.md              # Agent workflow and QA rules
|-- index.html             # Vite entry
|-- local-server.mjs       # Browser-only local backend
|-- package.json
|-- package-lock.json
|-- LICENSE
`-- README.md
```

Generated or local-only folders are intentionally ignored by Git:

- `node_modules/`
- `dist/`
- `src-tauri/target/`
- `src-tauri/gen/`
- `local-data/`

## Documentation

- [QA workflow](docs/QA-WORKFLOW.md)
- [Changelog](docs/CHANGELOG.md)
- [Agent rules](AGENTS.md)

## License

MIT, XG221B
