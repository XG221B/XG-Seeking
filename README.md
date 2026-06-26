# XG Seeking

XG Seeking is a lightweight local-first desktop notes app. It started as a personal web notebook and is being shaped into a reusable template-style application that people can install, customize, and extend.

## Disclaimer

This project was created for fun with the help of Codex. It is a personal experiment, even not a real product.

Use it at your own risk. I do not provide any warranty, guarantee, or formal support. If something breaks, data is lost, or the app behaves unexpectedly, please do not hold me responsible.

## Current Features

- Four-slot top navigation for future personal modules
- Local note writing with title and body
- Auto-save while editing
- Chinese-friendly search with result bubble feedback
- Markdown files stored in the app data directory
- Lightweight Tauri desktop shell instead of a browser tab and local Node server

## Development

Requirements:

- Node.js
- Rust toolchain with Cargo
- Windows WebView2 runtime

Install dependencies:

```bash
npm install
```

Run in development:

```bash
npm run dev
```

Build an installer:

```bash
npm run build
```

## Data Location

User notes are stored under the system app data directory for the app identifier `com.xg221b.notes`, inside a `notes` folder. This keeps user data separate from the application files so upgrades do not overwrite personal notes.

## Release Direction

The intended GitHub release flow is:

- maintain source in this repository
- build signed or unsigned Windows installers through GitHub Actions
- publish installers in GitHub Releases
- keep `CHANGELOG.md` updated for each version

