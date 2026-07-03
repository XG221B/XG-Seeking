<div align="center">

<img src="src-tauri/icons/icon.ico" width="80" alt="XG-Seeking">

# XG-Seeking

### 寻找心灵的碎片 · Seeking Fragments of the Soul

A minimalist, local-first desktop notes app — write, search, and never lose a thought.

[![Release](https://img.shields.io/github/v/release/XG221B/xg-seeking?color=%23002060)](https://github.com/XG221B/xg-seeking/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-%23002060)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-%23002060)](https://github.com/XG221B/xg-seeking/releases/latest)

</div>

---

## ✨ Features · 功能

XG-Seeking is a no-fuss notebook that stays out of your way. Write Markdown notes with auto-save, find anything instantly with real-time search, and never worry about accidental deletions thanks to a built-in recycle bin. Switch between Chinese and English on the fly, tweak the window title to your liking, and rest easy knowing everything lives right on your disk — no accounts, no cloud, no nonsense. One lightweight installer, uninstalls cleanly.

## 📥 Install · 安装

Download the latest `XG221B_0.x.x_x64-setup.exe` from [Releases](https://github.com/XG221B/xg-seeking/releases/latest) and run it. Uninstall via **Settings → Apps → XG221B** or `uninstall.exe` in the install directory.

## 🛠 Development · 开发

**Prerequisites:** Node.js, Rust + Cargo, Windows WebView2

```bash
npm install           # install dependencies
npm run dev           # Tauri dev mode (frontend HMR + Rust debug)
npm run web:dev       # browser-only at http://127.0.0.1:1420
npm run build         # production build → installer
```

## 🧱 Tech Stack · 技术栈

| Layer 层 | Tech 技术 |
|----------|-----------|
| Desktop Shell | [Tauri 2](https://tauri.app) (Rust) |
| Frontend | Vanilla JS + CSS, bundled with [Vite](https://vitejs.dev) |
| Storage | `.md` files under `%APPDATA%/com.xg221b.notes/` |
| Web Fallback | Node.js `local-server.mjs` (identical API to Tauri backend) |

## 📁 Project Structure · 项目结构

```
xg-seeking/
├── index.html              # Vite entry
├── src/
│   ├── main.js             # App logic, i18n, router
│   └── styles.css          # All styles
├── src-tauri/
│   ├── src/
│   │   ├── main.rs         # Tauri command handlers
│   │   ├── notes.rs        # Note CRUD + trash logic
│   │   └── settings.rs     # Settings persistence
│   ├── icons/icon.ico      # App icon
│   └── Cargo.toml
├── local-server.mjs        # Dev web server
└── package.json
```

## 📄 License

MIT © XG221B
