import "./styles.css";
import { lang, setLang, t } from "./i18n.js";
import { formatDate, isEditorTarget, editorValueToBody } from "./helpers.js";
import { isTauri, invoke } from "./api.js";
import { state, pageLoadToken, noteSaveQueue, mindmapSaveQueue, app, navButtons } from "./state.js";
import { flushNoteSave, flushMindmapSave, flushAllDirty, saveNote, saveStatusText, syncNoteCoordToDisplay, syncMindmapCoordToDisplay } from "./coordinator.js";
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
  app.innerHTML =
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
        `<div class="settings-actions">` +
          `<button class="text-btn primary" id="saveSetBtn">${t("saveSettings")}</button>` +
          `<span class="settings-feedback" id="settingsFeedback"></span>` +
        `</div>` +
      `</div>` +
    `</section>`;

  document.getElementById("saveSetBtn").addEventListener("click", saveSettings);
}

async function saveSettings() {
  const langSelect = document.getElementById("setLang");
  const titleInput = document.getElementById("setTitle");
  const feedback = document.getElementById("settingsFeedback");

  const newLang = langSelect.value;
  const newTitle = titleInput.value.trim() || t("appTitle");

  const payload = { language: newLang, title: newTitle };
  try {
    await invoke("save_settings", payload);
  } catch {
    feedback.textContent = t("settingsSaveFailed");
    feedback.classList.add("visible");
    setTimeout(() => feedback.classList.remove("visible"), 1800);
    return;
  }

  state.settings = payload;
  setLang(newLang);
  await applyTitle();
  updateNavLabels();
  render();

  feedback.textContent = t("settingsSaved");
  feedback.classList.add("visible");
  setTimeout(() => feedback.classList.remove("visible"), 1800);
}

async function applyTitle() {
  const title = state.settings.title || t("appTitle");
  document.title = title;
  if (isTauri) {
    try { await invoke("set_window_title", { title }); } catch { /* non-critical */ }
  }
}

async function loadSettings() {
  try {
    const s = await invoke("get_settings");
    state.settings = s;
    setLang(s.language || "zh");
    await applyTitle();
  } catch { /* use defaults */ }
}

function updateNavLabels() {
  navButtons.forEach((btn) => {
    const page = btn.dataset.page;
    const labelMap = { home: "home", notes: "notes", mindmaps: "mindmaps", settings: "settings" };
    const key = labelMap[page];
    if (key) {
      const span = btn.querySelector("span");
      if (span) span.textContent = t(key);
    }
  });
}

// ── Page routing ──

async function setPage(page) {
  const token = ++pageLoadToken.current;
  const leavingPage = state.page;

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
  state.pageLoading = true;
  state.showTrash = false;
  if (page === "notes" && leavingPage !== "notes") state.sourceMode = false;
  if (page !== "notes") state.query = "";
  if (page !== "mindmaps") state.mindmapQuery = "";
  navButtons.forEach((button) => button.classList.toggle("active", button.dataset.page === page));

  // Clear document-level page-specific handlers
  unmountPage(leavingPage);

  render();
  if (page === "notes") { await loadNotes(token); state.pageLoading = false; }
  else if (page === "mindmaps") { await loadMindmaps(token); state.pageLoading = false; }
  else { state.pageLoading = false; }
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
  else renderPlaceholder(state.page);
}

function renderPlaceholder(page) {
  if (page === "settings") {
    renderSettings();
    return;
  }
  const title = t("home");
  app.innerHTML = `<section class="placeholder"><div class="placeholder-inner"><h1>${title}</h1><div class="quiet">${t("comingSoon")}</div></div></section>`;
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

// ── Navigation ──

navButtons.forEach((button) => {
  button.addEventListener("click", () => setPage(button.dataset.page));
});

// Keyboard shortcuts
document.addEventListener("keydown", (event) => {
  if (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA" || isEditorTarget(event.target)) return;
  if (event.ctrlKey && event.key === "n") {
    event.preventDefault();
    if (state.page === "notes" && !state.showTrash) createNote();
  }
  if (event.key === "Delete" && state.page === "notes" && state.selectedId && !state.showTrash) {
    event.preventDefault();
    trashNote(state.selectedId);
  }
});

// ── Init ──

(async function init() {
  await loadSettings();
  updateNavLabels();
  render();
})();
