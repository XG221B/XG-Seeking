import "./styles.css";
import { lang, setLang, t } from "./i18n.js";
import { formatDate, isEditorTarget, editorValueToBody } from "./helpers.js";
import { isTauri, invoke } from "./api.js";
import { state, pageLoadToken, app, navButtons, storageWarningHtml } from "./state.js";
import { flushNoteSave, flushMindmapSave, flushAllDirty } from "./coordinator.js";
import { 
  loadNotes, loadTrash, loadTrashSilent, renderNotes, selectedNote,
  createNote, trashNote, restoreNote, deletePermanently, clearAllTrash,
} from "./notes-view.js";
import { 
  loadMindmaps, loadMindmapTrashSilent, renderMindmaps, getCurrentMindmap,
  createMindmap, trashMindmap, restoreMindmap, clearAllMindmapTrash,
  mindmapKeyHandler,
} from "./mindmap-view.js";

// ── Settings ──

function renderSettings() {
  const s = state.settings;
  const dirPath = state.dataDirPath || "";
  app.innerHTML = storageWarningHtml() +
    `<section class="settings-page">` +
      `<div class="settings-inner">` +
        `<h1 class="settings-heading">${t("settingsTitle")}</h1>` +
        `<div class="settings-group">` +
          `<label class="settings-label" for="setLang">${t("languageLabel")}</label>` +
          `<select class="settings-select" id="setLang">` +
            `<option value="zh" ${s.language === "zh" ? "selected" : ""}>中文</option>` +
            `<option value="en" ${s.language === "en" ? "selected" : ""}>English</option>` +
          `</select>` +
        `</div>` +
        `<div class="settings-group">` +
          `<label class="settings-label" for="setTitle">${t("appTitleLabel")}</label>` +
          `<input class="settings-input" id="setTitle" value="${escapeHtml(s.title)}" placeholder="${t("appTitle")}">` +
        `</div>` +
        `<div class="settings-group">` +
          `<label class="settings-label" for="setTheme">${t("themeLabel")}</label>` +
          `<select class="settings-select" id="setTheme">` +
            `<option value="system" ${s.theme === "system" ? "selected" : ""}>${t("themeSystem")}</option>` +
            `<option value="light" ${s.theme === "light" ? "selected" : ""}>${t("themeLight")}</option>` +
            `<option value="dark" ${s.theme === "dark" ? "selected" : ""}>${t("themeDark")}</option>` +
          `</select>` +
        `</div>` +
        `<div class="settings-group">` +
          `<label class="settings-label">${t("dataDirectory")}</label>` +
          `<input class="settings-input" id="dataDirField" value="${escapeHtml(dirPath)}" readonly>` +
        `</div>` +
        `<div class="settings-actions">` +
          `<button class="text-btn primary" id="saveSetBtn">${t("saveSettings")}</button>` +
          `<button class="text-btn" id="openDataDirBtn">${t("openDataFolder")}</button>` +
          `<span class="settings-feedback" id="settingsFeedback"></span>` +
        `</div>` +
      `</div>` +
    `</section>`;

  document.getElementById("saveSetBtn").addEventListener("click", saveSettings);
  document.getElementById("setTheme").addEventListener("change", (event) => applyTheme(event.target.value));
  document.getElementById("openDataDirBtn").addEventListener("click", async () => {
    const feedback = document.getElementById("settingsFeedback");
    try {
      await invoke("open_data_directory");
    } catch {
      feedback.textContent = t("openDataFolderFailed");
      feedback.classList.add("visible");
      setTimeout(() => feedback.classList.remove("visible"), 1800);
    }
  });
}

async function saveSettings() {
  const langSelect = document.getElementById("setLang");
  const titleInput = document.getElementById("setTitle");
  const themeSelect = document.getElementById("setTheme");
  const feedback = document.getElementById("settingsFeedback");

  const newLang = langSelect.value;
  const newTitle = titleInput.value.trim() || t("appTitle");
  const newTheme = normalizeTheme(themeSelect.value);

  const payload = { language: newLang, title: newTitle, theme: newTheme };
  try {
    await invoke("save_settings", payload);
  } catch {
    applyTheme(state.settings.theme);
    feedback.textContent = t("settingsSaveFailed");
    feedback.classList.add("visible");
    setTimeout(() => feedback.classList.remove("visible"), 1800);
    return;
  }

  state.settings = payload;
  applyTheme(newTheme);
  setLang(newLang);
  document.documentElement.lang = newLang === "zh" ? "zh-CN" : "en-US";
  await applyTitle();
  updateNavLabels();
  render();

  const savedFeedback = document.getElementById("settingsFeedback");
  savedFeedback.textContent = t("settingsSaved");
  savedFeedback.classList.add("visible");
  setTimeout(() => savedFeedback.classList.remove("visible"), 1800);
}

async function applyTitle() {
  const title = state.settings.title || t("appTitle");
  document.title = title;
  if (isTauri) {
    try { await invoke("set_window_title", { title }); } catch { /* non-critical */ }
  }
}

function normalizeTheme(theme) {
  return theme === "light" || theme === "dark" ? theme : "system";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = normalizeTheme(theme);
}

async function loadSettings() {
  try {
    const s = await invoke("get_settings");
    state.settings = s;
    state.settings.theme = normalizeTheme(s.theme);
    applyTheme(state.settings.theme);
    setLang(s.language || "zh");
    document.documentElement.lang = (s.language || "zh") === "zh" ? "zh-CN" : "en-US";
    await applyTitle();
  } catch {
    applyTheme(state.settings.theme);
    state.storageWarningCount = Math.max(1, state.storageWarningCount);
  }
}

async function loadStorageWarnings() {
  try {
    const warnings = await invoke("get_storage_warnings");
    state.storageWarningCount = Number(warnings?.total) || 0;
  } catch {
    state.storageWarningCount = Math.max(1, state.storageWarningCount);
  }
}

function updateNavLabels() {
  const nav = document.querySelector("nav.nav");
  if (nav) nav.setAttribute("aria-label", t("navLabel"));
  navButtons.forEach((btn) => {
    const page = btn.dataset.page;
    const labelMap = { notes: "notes", mindmaps: "mindmaps", settings: "settings" };
    const key = labelMap[page];
    if (key) {
      const span = btn.querySelector("span");
      if (span) span.textContent = t(key);
      btn.setAttribute("aria-label", t(key));
    }
  });
}

// ── Page routing ──

async function setPage(page) {
  const token = ++pageLoadToken.current;
  const leavingPage = state.page;

  if (leavingPage === "settings" && page !== "settings") {
    applyTheme(state.settings.theme);
  }

  // Flush dirty state before leaving current page
  if (leavingPage === "notes" && !state.showTrash) {
    if (state.selectedId) {
      const note = selectedNote();
      if (note) {
        const titleField = document.getElementById("title");
        const bodyField = document.getElementById("body");
        if (titleField) note.title = titleField.value || t("untitled");
        if (bodyField) note.body = editorValueToBody(bodyField.value);
      }
      const saved = await flushNoteSave(state.selectedId);
      if (!saved) { alert(t("saveFailed")); return; }
    }
  }

  if (leavingPage === "mindmaps" && !state.showMindmapTrash) {
    const mm = getCurrentMindmap();
    if (mm) {
      const saved = await flushMindmapSave(mm.id);
      if (!saved) { alert(t("saveFailed")); return; }
    }
  }

  // Reset page state
  state.page = page;
  state.showTrash = false;
  if (page === "notes" && leavingPage !== "notes") state.sourceMode = false;
  if (page !== "notes") state.query = "";
  if (page !== "mindmaps") state.mindmapQuery = "";
  navButtons.forEach((button) => button.classList.toggle("active", button.dataset.page === page));

  // Clear document-level page-specific handlers
  unmountPage(leavingPage);

  render();
  if (page === "notes") await loadNotes(token);
  else if (page === "mindmaps") await loadMindmaps(token);
  else if (page === "settings") {
    try {
      const d = await invoke("get_data_directory");
      if (token !== pageLoadToken.current) return;
      state.dataDirPath = d.path;
      render();
    } catch {
      if (token !== pageLoadToken.current) return;
      state.dataDirPath = "";
      render();
    }
  }
}

function unmountPage(page) {
  if (page === "mindmaps") {
    document.removeEventListener("keydown", mindmapKeyHandler);
  }
}

function render() {
  if (state.page === "notes") renderNotes();
  else if (state.page === "mindmaps") renderMindmaps();
  else if (state.page === "settings") renderSettings();
  else renderNotes();
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[char]);
}

// ── Visibility / close flush ──

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushAllDirty();
});
window.addEventListener("beforeunload", () => flushAllDirty());
window.addEventListener("pagehide", () => flushAllDirty());

async function installTauriCloseGuard() {
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const currentWindow = getCurrentWindow();
  let closing = false;
  await currentWindow.onCloseRequested(async (event) => {
    if (closing) return;
    event.preventDefault();
    const saved = await flushAllDirty();
    if (!saved) {
      alert(t("saveFailed"));
      return;
    }
    closing = true;
    await currentWindow.destroy();
  });
}

// ── Navigation ──

let userNavigatedDuringInit = false;
navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    userNavigatedDuringInit = true;
    setPage(button.dataset.page);
  });
});

// Keyboard shortcuts
document.addEventListener("keydown", (event) => {
  if (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA" || isEditorTarget(event.target)) return;
  if (event.ctrlKey && event.key === "n") {
    event.preventDefault();
    if (state.page === "notes" && !state.showTrash) createNote();
  }
  if (event.ctrlKey && event.key === "s") {
    event.preventDefault();
    if (state.page === "notes" && state.selectedId && !state.showTrash) {
      const note = selectedNote();
      if (note) {
        const titleField = document.getElementById("title");
        const bodyField = document.getElementById("body");
        if (titleField) note.title = titleField.value || t("untitled");
        if (bodyField) note.body = editorValueToBody(bodyField.value);
      }
      flushNoteSave(state.selectedId);
    }
    if (state.page === "mindmaps" && state.selectedMindmapId && !state.showMindmapTrash) {
      flushMindmapSave(state.selectedMindmapId);
    }
  }
  if (event.ctrlKey && event.key === "f") {
    event.preventDefault();
    const search = document.getElementById("search");
    if (search) { search.focus(); search.select(); }
  }
  if (event.key === "Delete" && state.page === "notes" && state.selectedId && !state.showTrash) {
    event.preventDefault();
    trashNote(state.selectedId);
  }
});

// ── Init ──

(async function init() {
  await installTauriCloseGuard();
  await loadSettings();
  await loadStorageWarnings();
  updateNavLabels();
  if (!userNavigatedDuringInit) await setPage("notes");
})();
