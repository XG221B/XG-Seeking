import "./styles.css";

// ── i18n ──

const STRINGS = {
  zh: {
    home: "首页",
    notes: "记录",
    spare: "备用",
    settings: "设置",
    comingSoon: "暂未开放",
    untitled: "未命名想法",
    searchIdeas: "搜索想法",
    searchTrash: "搜索回收站",
    todaysThoughts: "今天的想法",
    placeholderBody: "一段还没整理好的念头……",
    noMatch: "没有找到匹配内容",
    noNotes: "还没有笔记",
    found: "找到",
    filtered: "已筛选",
    startWriting: "开始记录",
    newNote: "新建",
    loadFailed: "读取失败",
    delete: "删除",
    restore: "恢复",
    deleteForever: "彻底删除",
    trash: "回收站",
    trashEmpty: "回收站是空的",
    trashNoMatch: "回收站中没有匹配内容",
    backToNotes: "返回笔记",
    clear: "清空",
    deletedOn: "删除于",
    trashHint: "被删除的笔记会出现在这里，你可以恢复或彻底删除它们。",
    loadTrashFailed: "读取回收站失败",
    clearTrashConfirm: "确定清空回收站？",
    deleteForeverConfirm: "彻底删除后无法恢复，确定吗？",
    notesWillBeDeleted: "篇笔记将被彻底删除",
    settingsTitle: "设置",
    languageLabel: "语言",
    appTitleLabel: "应用标题",
    saveSettings: "保存",
    settingsSaved: "已保存",
    settingsSaveFailed: "保存失败",
    settingsLoadFailed: "设置读取失败",
    appTitle: "寻找心灵的碎片...",
  },
  en: {
    home: "Home",
    notes: "Notes",
    spare: "Spare",
    settings: "Settings",
    comingSoon: "Coming soon",
    untitled: "Untitled",
    searchIdeas: "Search ideas",
    searchTrash: "Search trash",
    todaysThoughts: "Today's thoughts",
    placeholderBody: "Unorganized thoughts...",
    noMatch: "No matches found",
    noNotes: "No notes yet",
    found: "Found",
    filtered: "Filtered",
    startWriting: "Start writing",
    newNote: "New",
    loadFailed: "Load failed",
    delete: "Delete",
    restore: "Restore",
    deleteForever: "Delete permanently",
    trash: "Trash",
    trashEmpty: "Trash is empty",
    trashNoMatch: "No matches in trash",
    backToNotes: "Back to notes",
    clear: "Clear",
    deletedOn: "Deleted on",
    trashHint: "Deleted notes appear here. You can restore or permanently delete them.",
    loadTrashFailed: "Failed to load trash",
    clearTrashConfirm: "Clear all trash?",
    deleteForeverConfirm: "This cannot be undone. Are you sure?",
    notesWillBeDeleted: "notes will be permanently deleted",
    settingsTitle: "Settings",
    languageLabel: "Language",
    appTitleLabel: "App Title",
    saveSettings: "Save",
    settingsSaved: "Saved",
    settingsSaveFailed: "Save failed",
    settingsLoadFailed: "Failed to load settings",
    appTitle: "Seeking fragments of the soul...",
  },
};

let lang = "zh";

function t(key) {
  return STRINGS[lang]?.[key] || STRINGS.zh[key] || key;
}

function setLang(newLang) {
  if (newLang === "zh" || newLang === "en") {
    lang = newLang;
  }
}

// ── App ──

const app = document.getElementById("app");
const navButtons = Array.from(document.querySelectorAll(".nav button"));
const isTauri = Boolean(window.__TAURI_INTERNALS__);
let tauriInvoke = null;

async function invoke(command, payload = {}) {
  if (isTauri) {
    if (!tauriInvoke) {
      tauriInvoke = (await import("@tauri-apps/api/core")).invoke;
    }
    return tauriInvoke(command, payload);
  }

  const response = await fetch(`/api/${command}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.status === 204 ? null : response.json();
}

const state = {
  page: "home",
  notes: [],
  selectedId: "",
  query: "",
  showTrash: false,
  trashNotes: [],
  settings: { language: "zh", title: t("appTitle") },
};

let autoSaveTimer = 0;

// ── Helpers ──

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function formatDate(value) {
  const locale = lang === "en" ? "en-US" : "zh-CN";
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

async function applyTitle() {
  const title = state.settings.title || t("appTitle");
  document.title = title;
  if (isTauri) {
    try {
      await invoke("set_window_title", { title });
    } catch {
      // Non-critical — window title can stay
    }
  }
}

function updateNavLabels() {
  navButtons.forEach((btn) => {
    const page = btn.dataset.page;
    const labelMap = { home: "home", notes: "notes", slot1: "spare", settings: "settings" };
    const key = labelMap[page];
    if (key) {
      const span = btn.querySelector("span");
      if (span) span.textContent = t(key);
    }
  });
}

// ── Page routing ──

function setPage(page) {
  state.page = page;
  state.showTrash = false;
  navButtons.forEach((button) => button.classList.toggle("active", button.dataset.page === page));
  render();
  if (page === "notes") loadNotes();
}

function renderPlaceholder(page) {
  if (page === "settings") {
    renderSettings();
    return;
  }
  const title = t(page === "home" ? "home" : "spare");
  app.innerHTML = `<section class="placeholder"><div class="placeholder-inner"><h1>${title}</h1><div class="quiet">${t("comingSoon")}</div></div></section>`;
}

// ── Settings page ──

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
  // Re-render the whole page so language change takes effect everywhere
  render();

  feedback.textContent = t("settingsSaved");
  feedback.classList.add("visible");
  setTimeout(() => feedback.classList.remove("visible"), 1800);
}

// ── Notes ──

function filteredNotes() {
  const keyword = state.query.trim().toLowerCase();
  const source = state.showTrash ? state.trashNotes : state.notes;
  return keyword
    ? source.filter((note) => `${note.title}\n${note.body}`.toLowerCase().includes(keyword))
    : source;
}

function noteListHtml() {
  const keyword = state.query.trim().toLowerCase();
  const list = filteredNotes();

  if (!list.length) {
    const emptyMsg = state.showTrash
      ? (keyword ? t("trashNoMatch") : t("trashEmpty"))
      : (keyword ? t("noMatch") : t("noNotes"));
    return `<p class="message">${emptyMsg}</p>`;
  }

  const isTrash = state.showTrash;

  return list.map((note) => (
    `<div class="note-row ${note.id === state.selectedId ? "active" : ""}" data-id="${note.id}">` +
    `<button class="item" data-id="${note.id}"><strong>${escapeHtml(note.title)}</strong><time>${formatDate(note.updatedAt)}</time></button>` +
    (isTrash
      ? `<button class="restore-note" data-restore-id="${note.id}" title="${t("restore")}" aria-label="${t("restore")}">↩</button>`
      : `<button class="delete-note" data-delete-id="${note.id}" title="${t("delete")}" aria-label="${t("delete")}">×</button>`) +
    `</div>`
  )).join("");
}

function searchFeedbackText(prefix) {
  if (!state.query.trim()) return "";
  return `${t(prefix || "found")} ${filteredNotes().length}`;
}

function updateSearchFeedback(prefix) {
  const feedback = document.getElementById("searchFeedback");
  if (!feedback) return;
  const text = searchFeedbackText(prefix);
  feedback.textContent = text;
  feedback.classList.toggle("visible", Boolean(text));
  if (prefix && text) {
    feedback.classList.add("flash");
    setTimeout(() => feedback.classList.remove("flash"), 450);
  }
}

function bindListEvents() {
  Array.from(document.querySelectorAll(".item")).forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedId = button.dataset.id;
      renderNotes();
    });
  });

  Array.from(document.querySelectorAll(".restore-note")).forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      restoreNote(button.dataset.restoreId);
    });
  });

  Array.from(document.querySelectorAll(".delete-note")).forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      trashNote(button.dataset.deleteId);
    });
  });
}

function renderNoteListOnly(prefix) {
  const listNode = document.querySelector(".list");
  if (!listNode) return;
  listNode.innerHTML = noteListHtml();
  bindListEvents();
  updateSearchFeedback(prefix);
}

function renderTrashFooter() {
  const count = state.trashNotes.length;
  return `<div class="trash-bar ${state.showTrash ? "active" : ""}">
    <button class="trash-toggle" id="toggleTrash">
      <span class="trash-icon">${state.showTrash ? "←" : "🗑"}</span>
      <span>${state.showTrash ? t("backToNotes") : `${t("trash")}${count ? " (" + count + ")" : ""}`}</span>
    </button>
    ${state.showTrash ? `<button class="trash-clear" id="clearTrash" title="${t("clear")}">${t("clear")}</button>` : ""}
  </div>`;
}

function renderNotes() {
  const selected = state.showTrash
    ? state.trashNotes.find((note) => note.id === state.selectedId)
    : state.notes.find((note) => note.id === state.selectedId);

  const toolsHtml = state.showTrash
    ? `<div class="tools">
        <div class="search-feedback ${state.query.trim() ? "visible" : ""}" id="searchFeedback">${searchFeedbackText("")}</div>
        <div class="search" id="searchBox"><span class="search-icon">⌕</span><input id="search" placeholder="${t("searchTrash")}" value="${escapeHtml(state.query)}"></div>
        <div class="trash-header-label">${t("trash")}</div>
      </div>`
    : `<div class="tools">
        <div class="search-feedback ${state.query.trim() ? "visible" : ""}" id="searchFeedback">${searchFeedbackText("")}</div>
        <div class="search" id="searchBox"><span class="search-icon">⌕</span><input id="search" placeholder="${t("searchIdeas")}" value="${escapeHtml(state.query)}"></div>
        <button class="icon primary" id="new" title="${t("newNote")}">＋</button>
      </div>`;

  const editorHtml = state.showTrash
    ? (selected ? renderTrashEditor(selected) : renderTrashEmpty())
    : (selected ? renderEditor(selected) : renderEmpty());

  app.innerHTML =
    `<section class="notes">` +
      `<aside class="side">` +
        toolsHtml +
        `<div class="list">${noteListHtml()}</div>` +
        renderTrashFooter() +
      `</aside>` +
      `<section class="editor">${editorHtml}</section>` +
    `</section>`;

  bindNotesEvents();

  if (!state.showTrash) loadTrashSilent();
}

function renderEditor(note) {
  return `<div class="form" id="form">` +
    `<input class="title" id="title" placeholder="${t("todaysThoughts")}" value="${escapeHtml(note.title)}">` +
    `<textarea class="body" id="body" placeholder="${t("placeholderBody")}">${escapeHtml(note.body)}</textarea>` +
  `</div>`;
}

function renderEmpty() {
  return `<div class="empty"><h2>${t("startWriting")}</h2><button class="text-btn primary" id="emptyNew">${t("newNote")}</button></div>`;
}

function renderTrashEditor(note) {
  return `<div class="form trash-form" id="form">` +
    `<div class="trash-detail">` +
      `<h2 class="trash-detail-title">${escapeHtml(note.title)}</h2>` +
      `<time class="trash-detail-time">${t("deletedOn")} ${formatDate(note.updatedAt)}</time>` +
      `<pre class="trash-detail-body">${escapeHtml(note.body)}</pre>` +
      `<div class="trash-actions">` +
        `<button class="text-btn primary" id="restoreBtn" data-id="${note.id}">${t("restore")}</button>` +
        `<button class="text-btn danger" id="deleteForeverBtn" data-id="${note.id}">${t("deleteForever")}</button>` +
      `</div>` +
    `</div>` +
  `</div>`;
}

function renderTrashEmpty() {
  return `<div class="empty"><h2>${t("trash")}</h2><p>${t("trashHint")}</p></div>`;
}

function render() {
  if (state.page === "notes") renderNotes();
  else if (state.page === "settings") renderSettings();
  else renderPlaceholder(state.page);
}

function bindNotesEvents() {
  const search = document.getElementById("search");
  const searchBox = document.getElementById("searchBox");
  let composing = false;

  if (searchBox) {
    searchBox.addEventListener("click", () => {
      if (search) search.focus();
    });
  }

  if (search) {
    search.addEventListener("compositionstart", () => {
      composing = true;
    });
    search.addEventListener("compositionend", (event) => {
      composing = false;
      state.query = event.target.value;
      renderNoteListOnly();
    });
    search.addEventListener("input", (event) => {
      state.query = event.target.value;
      if (!composing) renderNoteListOnly();
    });
    search.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        state.query = event.target.value;
        renderNoteListOnly("filtered");
      }
    });
  }

  const toggleTrash = document.getElementById("toggleTrash");
  if (toggleTrash) {
    toggleTrash.addEventListener("click", toggleTrashView);
  }

  const clearTrash = document.getElementById("clearTrash");
  if (clearTrash) {
    clearTrash.addEventListener("click", clearAllTrash);
  }

  if (!state.showTrash) {
    const createButtons = [document.getElementById("new"), document.getElementById("emptyNew")].filter(Boolean);
    createButtons.forEach((button) => button.addEventListener("click", createNote));
  } else {
    const restoreBtn = document.getElementById("restoreBtn");
    if (restoreBtn) {
      restoreBtn.addEventListener("click", () => restoreNote(restoreBtn.dataset.id));
    }
    const deleteForeverBtn = document.getElementById("deleteForeverBtn");
    if (deleteForeverBtn) {
      deleteForeverBtn.addEventListener("click", () => deletePermanently(deleteForeverBtn.dataset.id));
    }
  }

  bindListEvents();
  if (!state.showTrash) bindEditorAutoSave();
}

function selectedNote() {
  if (state.showTrash) {
    return state.trashNotes.find((note) => note.id === state.selectedId);
  }
  return state.notes.find((note) => note.id === state.selectedId);
}

function bindEditorAutoSave() {
  const title = document.getElementById("title");
  const body = document.getElementById("body");
  if (!title || !body) return;

  title.addEventListener("input", () => {
    const note = selectedNote();
    if (note) note.title = title.value || t("untitled");
    const activeTitle = document.querySelector(".note-row.active strong");
    if (activeTitle) activeTitle.textContent = title.value || t("untitled");
    scheduleAutoSave();
  });

  body.addEventListener("input", () => {
    const note = selectedNote();
    if (note) note.body = body.value;
    scheduleAutoSave();
  });
}

// ── API calls ──

async function loadSettings() {
  try {
    const s = await invoke("get_settings");
    state.settings = s;
    setLang(s.language || "zh");
    await applyTitle();
  } catch {
    // Use defaults
  }
}

async function loadNotes() {
  try {
    state.notes = await invoke("list_notes");
    if (!state.selectedId && state.notes[0]) state.selectedId = state.notes[0].id;
    state.showTrash = false;
    renderNotes();
  } catch (error) {
    app.innerHTML = `<section class="placeholder"><div class="placeholder-inner"><h1>${t("loadFailed")}</h1><div class="quiet">${escapeHtml(error)}</div></div></section>`;
  }
}

async function loadTrash() {
  try {
    state.trashNotes = await invoke("list_trash");
    state.showTrash = true;
    state.selectedId = state.trashNotes[0] ? state.trashNotes[0].id : "";
    state.query = "";
    renderNotes();
  } catch (error) {
    app.innerHTML = `<section class="placeholder"><div class="placeholder-inner"><h1>${t("loadTrashFailed")}</h1><div class="quiet">${escapeHtml(error)}</div></div></section>`;
  }
}

async function loadTrashSilent() {
  try {
    state.trashNotes = await invoke("list_trash");
    updateTrashBar();
  } catch {
    // Silently ignore
  }
}

function updateTrashBar() {
  const trashBar = document.querySelector(".trash-bar");
  if (!trashBar || state.showTrash) return;
  const toggle = trashBar.querySelector(".trash-toggle span:last-child");
  if (toggle) {
    const count = state.trashNotes.length;
    toggle.textContent = `${t("trash")}${count ? " (" + count + ")" : ""}`;
  }
}

async function toggleTrashView() {
  if (state.showTrash) {
    state.showTrash = false;
    state.selectedId = state.notes[0] ? state.notes[0].id : "";
    state.query = "";
    renderNotes();
  } else {
    await loadTrash();
  }
}

async function createNote() {
  try {
    const note = await invoke("create_note");
    state.notes.unshift(note);
    state.selectedId = note.id;
    renderNotes();
  } catch (error) {
    alert(`${t("loadFailed")}: ${error}`);
  }
}

function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(saveNote, 500);
}

async function saveNote() {
  if (!state.selectedId || state.showTrash) return;
  const titleField = document.getElementById("title");
  const bodyField = document.getElementById("body");
  if (!titleField || !bodyField) return;

  const id = state.selectedId;
  const saved = await invoke("save_note", {
    id,
    title: titleField.value,
    body: bodyField.value,
  });

  const note = state.notes.find((item) => item.id === saved.id);
  if (note) {
    note.title = saved.title;
    note.body = saved.body;
    note.updatedAt = saved.updatedAt;
  }

  if (state.selectedId === id) {
    const activeTime = document.querySelector(".note-row.active time");
    if (activeTime) activeTime.textContent = formatDate(saved.updatedAt);
  }
}

async function trashNote(id) {
  if (!id) return;
  clearTimeout(autoSaveTimer);

  await invoke("delete_note", { id });
  state.notes = state.notes.filter((note) => note.id !== id);
  if (state.selectedId === id) state.selectedId = state.notes[0] ? state.notes[0].id : "";
  renderNotes();
}

async function restoreNote(id) {
  const restored = await invoke("restore_note", { id });
  state.trashNotes = state.trashNotes.filter((n) => n.id !== id);
  state.notes.unshift(restored);

  if (state.trashNotes.length === 0 || state.selectedId === id) {
    state.showTrash = false;
    state.selectedId = restored.id;
    state.query = "";
  }
  renderNotes();
}

async function deletePermanently(id) {
  if (!confirm(t("deleteForeverConfirm"))) return;
  await invoke("delete_permanently", { id });
  state.trashNotes = state.trashNotes.filter((n) => n.id !== id);
  if (state.trashNotes.length === 0) {
    state.showTrash = false;
    state.selectedId = state.notes[0] ? state.notes[0].id : "";
  } else if (state.selectedId === id) {
    state.selectedId = state.trashNotes[0].id;
  }
  renderNotes();
}

async function clearAllTrash() {
  if (state.trashNotes.length === 0) return;
  if (!confirm(`${t("clearTrashConfirm")}（${state.trashNotes.length} ${t("notesWillBeDeleted")}）`)) return;
  for (const note of state.trashNotes) {
    await invoke("delete_permanently", { id: note.id });
  }
  state.trashNotes = [];
  state.showTrash = false;
  state.selectedId = state.notes[0] ? state.notes[0].id : "";
  renderNotes();
}

// ── Init ──

navButtons.forEach((button) => {
  button.addEventListener("click", () => setPage(button.dataset.page));
});

(async function init() {
  await loadSettings();
  updateNavLabels();
  render();
})();
