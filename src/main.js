import "./styles.css";

// ── i18n ──

const STRINGS = {
  zh: {
    home: "首页",
    notes: "记录",
    spare: "备用",
    mindmaps: "导图",
    mindmapSearch: "搜索导图",
    mindmapUntitled: "未命名导图",
    mindmapRoot: "根节点",
    mindmapNodeNew: "新节点",
    mindmapEmpty: "还没有导图",
    mindmapTrashEmpty: "回收站为空",
    mindmapClearConfirm: "确定清空所有导图？",
    mindmapHint: "选择一个导图或新建",
    mindmapBack: "返回导图",
    mindmapAddChild: "添加子节点",
    mindmapAddSibling: "添加同级节点",
    mindmapDeleteNode: "删除节点",
    mindmapShortcuts: "Tab 添加子节点 · Enter 添加同级节点 · Delete 删除节点",
    mindmapEditHint: "Ctrl+Enter 确认编辑",
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
    mindmaps: "Mindmap",
    mindmapSearch: "Search mindmaps",
    mindmapUntitled: "Untitled",
    mindmapRoot: "Root",
    mindmapNodeNew: "New node",
    mindmapEmpty: "No mindmaps yet",
    mindmapTrashEmpty: "Trash is empty",
    mindmapClearConfirm: "Clear all mindmaps?",
    mindmapHint: "Select or create a mindmap",
    mindmapBack: "Back to mindmaps",
    mindmapAddChild: "Add child",
    mindmapAddSibling: "Add sibling",
    mindmapDeleteNode: "Delete node",
    mindmapShortcuts: "Tab child · Enter sibling · Delete remove",
    mindmapEditHint: "Ctrl+Enter to confirm edit",
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
  previewMode: false,
  mindmaps: [],
  selectedMindmapId: "",
  selectedNodeId: "",
  showMindmapTrash: false,
  mindmapQuery: "",
  mindmapTrash: [],
  editingNode: false,
};

let autoSaveTimer = 0;

// ── Markdown preview ──

function renderMd(text) {
  let html = escapeHtml(text);
  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // Bold / italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  // Paragraphs (double newline)
  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';
  // Clean empty paragraphs
  html = html.replace(/<p><\/p>/g, '');
  return html;
}

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
  // Save current mindmap before switching away (don't block on failure)
  if (state.page === "mindmaps" && !state.showMindmapTrash) {
    const mm = getCurrentMindmap();
    if (mm) { clearTimeout(mindmapSaveTimer); try { await saveMindmap(mm); } catch {} }
  }
  state.page = page;
  state.showTrash = false;
  if (page !== "notes") state.query = "";
  if (page !== "mindmaps") state.mindmapQuery = "";
  navButtons.forEach((button) => button.classList.toggle("active", button.dataset.page === page));
  render();
  if (page === "notes") loadNotes();
  if (page === "mindmaps") loadMindmaps();
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
    (state.previewMode
      ? `<div class="md-preview" id="mdPreview">${renderMd(note.body)}</div>`
      : `<textarea class="body" id="body" placeholder="${t("placeholderBody")}">${escapeHtml(note.body)}</textarea>`) +
    `<div class="editor-toolbar">
      <button class="toolbar-btn ${state.previewMode ? "active" : ""}" id="togglePreview" title="${state.previewMode ? "Edit" : "Preview"}">${state.previewMode ? "✎" : "👁"}</button>
    </div>` +
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
  else if (state.page === "mindmaps") renderMindmaps();
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

    const togglePreview = document.getElementById("togglePreview");
    if (togglePreview) {
      togglePreview.addEventListener("click", () => {
        state.previewMode = !state.previewMode;
        renderNotes();
      });
    }
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
    // Override default title with i18n version
    note.title = t("untitled");
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

// ── Mindmaps ──

function renderMindmaps() {
  const source = state.showMindmapTrash ? state.mindmapTrash : state.mindmaps;
  const selected = source.find((m) => m.id === state.selectedMindmapId);
  const keyword = state.mindmapQuery.trim().toLowerCase();
  const filtered = keyword
    ? source.filter((m) => m.title.toLowerCase().includes(keyword))
    : source;

  const listHtml = filtered.length
    ? filtered.map((m) =>
        `<div class="mindmap-row ${m.id === state.selectedMindmapId ? "active" : ""}">` +
        `<button class="mindmap-item" data-id="${m.id}">${escapeHtml(m.title)}</button>` +
        (state.showMindmapTrash
          ? `<button class="mindmap-restore" data-restore="${m.id}" title="${t("restore")}">↩</button>`
          : `<button class="mindmap-delete" data-delete="${m.id}" title="${t("delete")}">×</button>`) +
        `</div>`
      ).join("")
    : `<p class="message">${state.showMindmapTrash ? t("mindmapTrashEmpty") : t("mindmapEmpty")}</p>`;

  const feedbackText = keyword ? `${t("found")} ${filtered.length}` : "";

  app.innerHTML =
    `<section class="notes">` +
      `<aside class="side">` +
        `<div class="tools">
          <div class="search-feedback ${keyword ? "visible" : ""}" id="searchFeedback">${feedbackText}</div>
          <div class="search" id="searchBox"><span class="search-icon">⌕</span><input id="search" placeholder="${t("mindmapSearch")}" value="${escapeHtml(state.mindmapQuery)}"></div>
          ${state.showMindmapTrash
            ? `<div class="trash-header-label">${t("trash")}</div>`
            : `<button class="icon primary" id="newMindmap" title="${t("mindmapUntitled")}">＋</button>`}
        </div>` +
        `<div class="list">${listHtml}</div>` +
        `<div class="trash-bar ${state.showMindmapTrash ? "active" : ""}">
          <button class="trash-toggle" id="toggleMindmapTrash">
            <span class="trash-icon">${state.showMindmapTrash ? "←" : "🗑"}</span>
            <span>${state.showMindmapTrash ? t("mindmapBack") : t("trash")}</span>
          </button>
          ${state.showMindmapTrash ? `<button class="trash-clear" id="clearMindmapTrash">${t("clear")}</button>` : ""}
        </div>` +
      `</aside>` +
      `<section class="editor">${selected ? renderMindmapCanvas(selected) : `<div class="empty"><h2>${t("mindmaps")}</h2><p>${t("mindmapHint")}</p></div>`}</section>` +
    `</section>`;

  bindMindmapEvents();
}

function renderMindmapCanvas(mm) {
  return `<div class="mm-canvas" id="mmCanvas">
    <div class="mm-toolbar">
      <input class="mm-title-input" id="mmTitle" value="${escapeHtml(mm.title)}" placeholder="${t("mindmapUntitled")}">
      <div class="mm-shortcuts">
        <span>${t("mindmapShortcuts")}</span>
        <span class="mm-edit-hint">${t("mindmapEditHint")}</span>
      </div>
    </div>
    <div class="mm-tree" id="mmTree">
      ${renderNodes(mm.nodes)}
    </div>
  </div>`;
}

function bindMindmapEvents() {
  const search = document.getElementById("search");
  if (search) {
    let composing = false;
    search.addEventListener("compositionstart", () => { composing = true; });
    search.addEventListener("compositionend", (e) => { composing = false; state.mindmapQuery = e.target.value; renderMindmaps(); });
    search.addEventListener("input", (e) => { state.mindmapQuery = e.target.value; if (!composing) renderMindmaps(); });
  }

  document.getElementById("newMindmap")?.addEventListener("click", createMindmap);
  document.getElementById("toggleMindmapTrash")?.addEventListener("click", toggleMindmapTrashView);
  document.getElementById("clearMindmapTrash")?.addEventListener("click", clearAllMindmapTrash);

  document.querySelectorAll(".mindmap-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedMindmapId = btn.dataset.id;
      state.selectedNodeId = "";
      renderMindmaps();
    });
  });

  document.querySelectorAll(".mindmap-delete").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); trashMindmap(btn.dataset.delete); });
  });

  document.querySelectorAll(".mindmap-restore").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); restoreMindmap(btn.dataset.restore); });
  });

  const mm = state.showMindmapTrash
    ? state.mindmapTrash.find((m) => m.id === state.selectedMindmapId)
    : state.mindmaps.find((m) => m.id === state.selectedMindmapId);
  if (!mm || state.showMindmapTrash) return;

  // Title — update sidebar on change
  const titleInput = document.getElementById("mmTitle");
  if (titleInput) {
    titleInput.addEventListener("input", () => {
      mm.title = titleInput.value || t("mindmapUntitled");
      scheduleMindmapSave(mm);
      // Update sidebar item in-place
      const item = document.querySelector(`.mindmap-item[data-id="${mm.id}"]`);
      if (item) item.textContent = mm.title;
    });
  }

  // Node click: first click selects, second click → edit mode
  document.querySelectorAll(".mm-node").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".mm-toggle") || e.target.closest(".mm-edit-input")) return;
      const nodeId = el.parentElement.dataset.nodeId;
      if (state.selectedNodeId === nodeId && !state.editingNode) {
        state.editingNode = true;
        renderMindmaps();
        return;
      }
      state.selectedNodeId = nodeId;
      state.editingNode = false;
      renderMindmaps();
    });
  });

  // Inline edit: textarea for multi-line, Ctrl+Enter to commit
  const editInput = document.querySelector(".mm-edit-input");
  if (editInput) {
    editInput.focus();
    const commitEdit = () => {
      const node = findNodeInList(mm.nodes, editInput.dataset.nodeId);
      if (node) { node.text = editInput.value.trim() || " "; scheduleMindmapSave(mm); }
      state.editingNode = false;
      renderMindmaps();
    };
    editInput.addEventListener("blur", () => setTimeout(commitEdit, 50));
    editInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); commitEdit(); }
      if (ev.key === "Escape") { state.editingNode = false; renderMindmaps(); }
    });
  }

  // Collapse/expand
  document.querySelectorAll(".mm-toggle").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleNode(mm.nodes, btn.dataset.toggle);
      scheduleMindmapSave(mm);
      renderMindmaps();
    });
  });

  // Right-click context menu — don't re-render, just update selection visually
  document.querySelectorAll(".mm-node-wrapper").forEach((el) => {
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Update selection state and highlight
      state.selectedNodeId = el.dataset.nodeId;
      state.editingNode = false;
      document.querySelectorAll(".mm-node.selected").forEach((n) => n.classList.remove("selected"));
      const nodeDiv = el.querySelector(".mm-node");
      if (nodeDiv) nodeDiv.classList.add("selected");
      showContextMenu(e.clientX, e.clientY);
    });
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", mindmapKeyHandler);
}

function renderNodes(nodes, depth = 0) {
  return nodes.map((node) => renderNode(node, depth)).join("");
}

const BULLETS = ["•", "◦", "▪", "▸"];

function renderNode(node, depth = 0) {
  const hasChildren = node.children.length > 0;
  const isEditing = state.editingNode && state.selectedNodeId === node.id;
  const bullet = BULLETS[depth % BULLETS.length];
  const textContent = escapeHtml(node.text).replace(/\n/g, "<br>");
  return `<div class="mm-node-wrapper" style="margin-left: ${depth * 24}px" data-node-id="${node.id}">
    <div class="mm-node ${state.selectedNodeId === node.id ? "selected" : ""}">
      ${hasChildren
        ? `<button class="mm-toggle" data-toggle="${node.id}">${node.collapsed ? "▸" : "▾"}</button>`
        : `<span class="mm-toggle-spacer"></span>`}
      <span class="mm-bullet">${bullet}</span>
      ${isEditing
        ? `<textarea class="mm-edit-input" data-node-id="${node.id}" rows="1">${escapeHtml(node.text)}</textarea>`
        : `<span class="mm-text">${textContent}</span>`}
    </div>
    ${!node.collapsed ? node.children.map((c) => renderNode(c, depth + 1)).join("") : ""}
  </div>`;
}

function mindmapKeyHandler(e) {
  if (state.page !== "mindmaps" || state.showMindmapTrash) return;
  const mm = state.mindmaps.find((m) => m.id === state.selectedMindmapId);
  if (!mm) return;
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  if (e.key === "Tab") { e.preventDefault(); addChildNode(mm); }
  if (e.key === "Enter") { e.preventDefault(); addSiblingNode(mm); }
  if (e.key === "Delete" && state.selectedNodeId) { e.preventDefault(); deleteNode(mm); }
}

function removeContextMenu() {
  document.querySelector(".mm-context-menu")?.remove();
}

// Replace the old showContextMenu — fix event timing
function showContextMenu(x, y) {
  removeContextMenu();
  const menu = document.createElement("div");
  menu.className = "mm-context-menu";
  menu.style.left = x + "px";
  menu.style.top = y + "px";
  menu.innerHTML = `
    <button data-action="child">＋ ${t("mindmapAddChild")}</button>
    <button data-action="sibling">＝ ${t("mindmapAddSibling")}</button>
    <button data-action="delete">✕ ${t("mindmapDeleteNode")}</button>
  `;
  menu.querySelectorAll("button").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const mm = getCurrentMindmap();
      if (!mm) return;
      if (btn.dataset.action === "child") addChildNode(mm);
      if (btn.dataset.action === "sibling") addSiblingNode(mm);
      if (btn.dataset.action === "delete") deleteNode(mm);
      removeContextMenu();
    };
  });
  document.body.appendChild(menu);
  setTimeout(() => {
    const closer = (e) => {
      if (!menu.contains(e.target)) { removeContextMenu(); document.removeEventListener("click", closer); }
    };
    document.addEventListener("click", closer);
  }, 0);
}
// ── Mindmap tree operations ──

function getCurrentMindmap() {
  return state.mindmaps.find((m) => m.id === state.selectedMindmapId) || null;
}

function findNodeInList(nodes, id) {
  for (const node of nodes) {
    const found = findNode(node, id);
    if (found) return found;
  }
  return null;
}

function findNode(root, id) {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function findParentInList(nodes, id, parent = null) {
  for (const node of nodes) {
    if (node.id === id) return parent;
    const found = findParent(node, id, node);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findParent(root, id, parent = null) {
  if (root.id === id) return parent;
  for (const child of root.children) {
    const found = findParent(child, id, root);
    if (found !== undefined) return found;
  }
  return undefined;
}

function toggleNode(nodes, id) {
  const node = findNodeInList(nodes, id);
  if (node) node.collapsed = !node.collapsed;
}

function addChildNode(mm) {
  const node = state.selectedNodeId ? findNodeInList(mm.nodes, state.selectedNodeId) : null;
  if (!node) {
    // No node selected or not found — add top-level node
    const newNode = { id: "n" + Date.now(), text: t("mindmapNodeNew"), collapsed: false, children: [] };
    mm.nodes.push(newNode);
    state.selectedNodeId = newNode.id;
    state.editingNode = true;
    scheduleMindmapSave(mm);
    renderMindmaps();
    return;
  }
  const newNode = { id: "n" + Date.now(), text: t("mindmapNodeNew"), collapsed: false, children: [] };
  node.children.push(newNode);
  node.collapsed = false;
  state.selectedNodeId = newNode.id;
  state.editingNode = true;
  scheduleMindmapSave(mm);
  renderMindmaps();
}

function addSiblingNode(mm) {
  if (!state.selectedNodeId) return addChildNode(mm);
  // Check if selected node is a top-level node
  const topIdx = mm.nodes.findIndex((n) => n.id === state.selectedNodeId);
  if (topIdx >= 0) {
    // Top-level sibling
    const newNode = { id: "n" + Date.now(), text: t("mindmapNodeNew"), collapsed: false, children: [] };
    mm.nodes.splice(topIdx + 1, 0, newNode);
    state.selectedNodeId = newNode.id;
    state.editingNode = true;
    scheduleMindmapSave(mm);
    renderMindmaps();
    return;
  }
  // Nested sibling
  const parent = findParentInList(mm.nodes, state.selectedNodeId);
  if (!parent) return addChildNode(mm);
  const idx = parent.children.findIndex((c) => c.id === state.selectedNodeId);
  const newNode = { id: "n" + Date.now(), text: t("mindmapNodeNew"), collapsed: false, children: [] };
  parent.children.splice(idx + 1, 0, newNode);
  state.selectedNodeId = newNode.id;
  state.editingNode = true;
  scheduleMindmapSave(mm);
  renderMindmaps();
}

function deleteNode(mm) {
  if (!state.selectedNodeId) return;
  // Check if it's a top-level node
  const topIdx = mm.nodes.findIndex((n) => n.id === state.selectedNodeId);
  if (topIdx >= 0) {
    mm.nodes.splice(topIdx, 1);
    // Select neighbor
    if (topIdx > 0) state.selectedNodeId = mm.nodes[topIdx - 1]?.id || "";
    else if (mm.nodes.length > 0) state.selectedNodeId = mm.nodes[0].id;
    else state.selectedNodeId = "";
    state.editingNode = false;
    scheduleMindmapSave(mm);
    renderMindmaps();
    return;
  }
  // Nested node
  const parent = findParentInList(mm.nodes, state.selectedNodeId);
  if (!parent) return;
  const idx = parent.children.findIndex((c) => c.id === state.selectedNodeId);
  parent.children = parent.children.filter((c) => c.id !== state.selectedNodeId);
  if (idx > 0) state.selectedNodeId = parent.children[idx - 1]?.id || "";
  else if (parent.children.length > 0) state.selectedNodeId = parent.children[0]?.id || "";
  else state.selectedNodeId = parent.id;
  state.editingNode = false;
  scheduleMindmapSave(mm);
  renderMindmaps();
}

let mindmapSaveTimer = 0;
function scheduleMindmapSave(mm) {
  clearTimeout(mindmapSaveTimer);
  mindmapSaveTimer = setTimeout(() => saveMindmap(mm), 500);
}

// ── Mindmap API ──

async function loadMindmaps() {
  try {
    state.mindmaps = await invoke("list_mindmaps");
    state.showMindmapTrash = false;
    if (!state.selectedMindmapId && state.mindmaps[0]) state.selectedMindmapId = state.mindmaps[0].id;
    renderMindmaps();
    loadMindmapTrashSilent();
  } catch (e) {
    app.innerHTML = `<section class="placeholder"><div class="placeholder-inner"><h1>读取失败</h1><div class="quiet">${escapeHtml(e)}</div></div></section>`;
  }
}

async function loadMindmapTrashSilent() {
  try { state.mindmapTrash = await invoke("list_mindmap_trash"); } catch {}
}

async function createMindmap() {
  const mm = await invoke("create_mindmap");
  mm.title = t("mindmapUntitled");
  state.mindmaps.unshift(mm);
  state.selectedMindmapId = mm.id;
  state.selectedNodeId = "";
  state.editingNode = false;
  renderMindmaps();
}

async function saveMindmap(mm) {
  await invoke("save_mindmap", { mm });
}

async function trashMindmap(id) {
  await invoke("delete_mindmap", { id });
  state.mindmaps = state.mindmaps.filter((m) => m.id !== id);
  if (state.selectedMindmapId === id) state.selectedMindmapId = state.mindmaps[0]?.id || "";
  renderMindmaps();
}

async function restoreMindmap(id) {
  const mm = await invoke("restore_mindmap", { id });
  state.mindmapTrash = state.mindmapTrash.filter((m) => m.id !== id);
  state.mindmaps.unshift(mm);
  if (state.mindmapTrash.length === 0) state.showMindmapTrash = false;
  state.selectedMindmapId = mm.id;
  renderMindmaps();
}

async function toggleMindmapTrashView() {
  if (state.showMindmapTrash) {
    state.showMindmapTrash = false;
    state.selectedMindmapId = state.mindmaps[0]?.id || "";
    state.mindmapQuery = "";
    renderMindmaps();
  } else {
    state.mindmapTrash = await invoke("list_mindmap_trash");
    state.showMindmapTrash = true;
    state.selectedMindmapId = state.mindmapTrash[0]?.id || "";
    state.mindmapQuery = "";
    renderMindmaps();
  }
}

async function clearAllMindmapTrash() {
  if (state.mindmapTrash.length === 0) return;
  if (!confirm(t("mindmapClearConfirm"))) return;
  for (const m of state.mindmapTrash) {
    await invoke("delete_mindmap_permanently", { id: m.id });
  }
  state.mindmapTrash = [];
  state.showMindmapTrash = false;
  state.selectedMindmapId = state.mindmaps[0]?.id || "";
  renderMindmaps();
}

// ── Init ──

navButtons.forEach((button) => {
  button.addEventListener("click", () => setPage(button.dataset.page));
});

// Keyboard shortcuts (global)
document.addEventListener("keydown", (event) => {
  // Ignore when typing in inputs
  if (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA") return;

  if (event.ctrlKey && event.key === "n") {
    event.preventDefault();
    if (state.page === "notes" && !state.showTrash) createNote();
  }
  if (event.key === "Delete" && state.page === "notes" && state.selectedId && !state.showTrash) {
    event.preventDefault();
    trashNote(state.selectedId);
  }
});

(async function init() {
  await loadSettings();
  updateNavLabels();
  render();
})();
