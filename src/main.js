import "./styles.css";

// ── i18n ──

const STRINGS = {
  zh: {
    home: "首页",
    notes: "记录",
    mindmaps: "导图",
    mindmapSearch: "搜索导图",
    mindmapUntitled: "未命名导图",
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
    mindmapEmptyHint: "Tab 添加第一个节点",
    editToggle: "编辑",
    previewToggle: "预览",
    bold: "加粗",
    italic: "斜体",
    inlineCode: "行内代码",
    heading: "标题",
    blockquote: "引用",
    unorderedList: "列表",
    codeBlock: "代码块",
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
    foundUnit: "篇",
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
    mindmaps: "Mindmap",
    mindmapSearch: "Search mindmaps",
    mindmapUntitled: "Untitled",
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
    mindmapEmptyHint: "Tab to add first node",
    editToggle: "Edit",
    previewToggle: "Preview",
    bold: "Bold",
    italic: "Italic",
    inlineCode: "Inline code",
    heading: "Heading",
    blockquote: "Quote",
    unorderedList: "List",
    codeBlock: "Code block",
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
    foundUnit: "",
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
  const val = STRINGS[lang]?.[key];
  if (val !== undefined) return val;
  return STRINGS.zh[key] !== undefined ? STRINGS.zh[key] : key;
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
  sourceMode: false,
  mindmaps: [],
  selectedMindmapId: "",
  selectedNodeId: "",
  showMindmapTrash: false,
  mindmapQuery: "",
  mindmapTrash: [],
  editingNode: false,
};

let autoSaveTimer = 0;
let pageLoadToken = 0;
const pendingNoteSaves = new Map();

// ── Markdown preview ──

function renderMd(text) {
  const isSafeMarkdownUrl = (value) => /^(https?:\/\/|mailto:|#|\/(?!\/))/i.test(value.trim());
  const inlineMd = (value) => escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => {
      const safeUrl = url.trim();
      if (!isSafeMarkdownUrl(safeUrl)) return match;
      return `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer">${label}</a>`;
    });

  const output = [];
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    output.push(`<p>${paragraph.map(inlineMd).join("<br>")}</p>`);
    paragraph = [];
  };

  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    if (trimmed.startsWith("```")) {
      flushParagraph();
      const codeLines = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i += 1;
      }
      output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      output.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`);
      continue;
    }

    if (/^-\s+/.test(trimmed)) {
      flushParagraph();
      const items = [];
      while (i < lines.length && /^-\s+/.test(lines[i].trim())) {
        items.push(`<li>${inlineMd(lines[i].trim().replace(/^-\s+/, ""))}</li>`);
        i += 1;
      }
      i -= 1;
      output.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushParagraph();
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i += 1;
      }
      i -= 1;
      output.push(`<blockquote>${quoteLines.map(inlineMd).join("<br>")}</blockquote>`);
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return output.join("");
}

function bodyToPreviewHtml(value) {
  return renderMd(value);
}

function editorValueToBody(value) {
  return String(value || "").replace(/\r\n/g, "\n");
}

function isEditorTarget(target) {
  return Boolean(target?.closest?.("#body"));
}

function syncEditorToNote() {
  const body = document.getElementById("body");
  const note = selectedNote();
  if (!body || !note) return;
  note.body = editorValueToBody(body.value);
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
  const token = ++pageLoadToken;
  const previousPage = state.page;
  if (state.page === "notes" && !state.showTrash) {
    clearTimeout(autoSaveTimer);
    syncEditorToNote();
    saveNote();
  }

  if (state.page === "mindmaps" && !state.showMindmapTrash) {
    const mm = getCurrentMindmap();
    if (mm) {
      clearTimeout(mindmapSaveTimer);
      await saveMindmap(mm);
    }
  }
  state.page = page;
  state.showTrash = false;
  if (page === "notes" && previousPage !== "notes") state.sourceMode = false;
  if (page !== "notes") state.query = "";
  if (page !== "mindmaps") state.mindmapQuery = "";
  navButtons.forEach((button) => button.classList.toggle("active", button.dataset.page === page));
  render();
  if (page === "notes") loadNotes(token);
  if (page === "mindmaps") loadMindmaps(token);
}

function renderPlaceholder(page) {
  if (page === "settings") {
    renderSettings();
    return;
  }
  const title = t("home");
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

function selectedNote() {
  const source = state.showTrash ? state.trashNotes : state.notes;
  return source.find((note) => note.id === state.selectedId) || null;
}

function selectNote(id, options = {}) {
  state.selectedId = id || "";
  state.sourceMode = Boolean(options.edit);
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
  const unit = t("foundUnit");
  return `${t(prefix || "found")} ${filteredNotes().length}${unit}`;
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
      selectNote(button.dataset.id);
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
        <div class="search" id="searchBox"><span class="search-icon">⌕</span><input id="search" autocomplete="off" placeholder="${t("searchTrash")}" value="${escapeHtml(state.query)}"></div>
        <div class="trash-header-label">${t("trash")}</div>
      </div>`
    : `<div class="tools">
        <div class="search-feedback ${state.query.trim() ? "visible" : ""}" id="searchFeedback">${searchFeedbackText("")}</div>
        <div class="search" id="searchBox"><span class="search-icon">⌕</span><input id="search" autocomplete="off" placeholder="${t("searchIdeas")}" value="${escapeHtml(state.query)}"></div>
        <button class="icon primary" id="new" title="${t("newNote")}">＋</button>
      </div>`;

  const editorHtml = state.showTrash
    ? (selected ? renderTrashEditor(selected) : renderTrashEmpty())
    : (selected ? renderRichEditor(selected) : renderEmpty());

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

  if (!state.showTrash) loadTrashSilent(pageLoadToken);
}

function renderRichEditor(note) {
  const markdownToolbar = state.sourceMode
    ? `<button class="toolbar-btn" id="mdBold" title="${t("bold")} (Ctrl+B)"><strong>B</strong></button>
      <button class="toolbar-btn" id="mdItalic" title="${t("italic")} (Ctrl+I)"><em>I</em></button>
      <button class="toolbar-btn" id="mdCode" title="${t("inlineCode")}"><code>\`</code></button>
      <button class="toolbar-btn" id="mdHeading" title="${t("heading")}">H</button>
      <button class="toolbar-btn" id="mdQuote" title="${t("blockquote")}">&gt;</button>
      <button class="toolbar-btn" id="mdList" title="${t("unorderedList")}">-</button>
      <button class="toolbar-btn" id="mdCodeBlock" title="${t("codeBlock")}">#</button>
      <span class="toolbar-sep"></span>`
    : "";

  return `<div class="form" id="form">` +
    `<input class="title" id="title" placeholder="${t("todaysThoughts")}" value="${escapeHtml(note.title)}">` +
    (!state.sourceMode
      ? `<div class="md-preview" id="mdPreview">${bodyToPreviewHtml(note.body)}</div>`
      : `<textarea class="body markdown-source" id="body" placeholder="${t("placeholderBody")}">${escapeHtml(note.body)}</textarea>`) +
    `<div class="editor-toolbar mode-toolbar" aria-label="Editor mode">
      ${markdownToolbar}
      <button class="toolbar-btn mode-btn ${state.sourceMode ? "active" : ""}" id="editMode" title="${t("editToggle")}">Edit</button>
      <button class="toolbar-btn mode-btn ${!state.sourceMode ? "active" : ""}" id="previewMode" title="${t("previewToggle")}">Preview</button>
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

    document.getElementById("editMode")?.addEventListener("click", () => switchNoteMode(true));
    document.getElementById("previewMode")?.addEventListener("click", () => switchNoteMode(false));
    bindMarkdownTools();
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

function switchNoteMode(sourceMode) {
  const titleEl = document.getElementById("title");
  const bodyEl = document.getElementById("body");
  const note = selectedNote();
  if (note && titleEl) note.title = titleEl.value || t("untitled");
  if (note && bodyEl) note.body = editorValueToBody(bodyEl.value);
  state.sourceMode = sourceMode;
  renderNotes();
  scheduleAutoSave();
}

function bindMarkdownTools() {
  const body = document.getElementById("body");
  if (!body || body.tagName !== "TEXTAREA") return;

  const replaceRange = (start, end, value, selectStart = null, selectEnd = null) => {
    body.setRangeText(value, start, end, "end");
    body.dispatchEvent(new Event("input", { bubbles: true }));
    body.focus();
    if (selectStart !== null && selectEnd !== null) body.setSelectionRange(selectStart, selectEnd);
  };

  const wrapSel = (before, after, placeholder = "text") => {
    const s = body.selectionStart, e = body.selectionEnd;
    const selected = body.value.substring(s, e);
    const content = selected || placeholder;
    replaceRange(s, e, before + content + after, s + before.length, s + before.length + content.length);
  };

  const prefixLines = (prefix, placeholder = "text") => {
    const s = body.selectionStart;
    const e = body.selectionEnd;
    const v = body.value;
    if (s === e) {
      replaceRange(s, e, prefix + placeholder, s + prefix.length, s + prefix.length + placeholder.length);
      return;
    }
    const ls = v.lastIndexOf("\n", s - 1) + 1;
    const le = v.indexOf("\n", e);
    const end = le === -1 ? v.length : le;
    const lines = v.substring(ls, end).split("\n");
    const next = lines.map((line) => line.startsWith(prefix) ? line : prefix + line).join("\n");
    replaceRange(ls, end, next);
  };

  document.getElementById("mdBold")?.addEventListener("click", () => wrapSel("**", "**"));
  document.getElementById("mdItalic")?.addEventListener("click", () => wrapSel("*", "*"));
  document.getElementById("mdCode")?.addEventListener("click", () => wrapSel("`", "`"));
  document.getElementById("mdHeading")?.addEventListener("click", () => prefixLines("# ", "Heading"));
  document.getElementById("mdQuote")?.addEventListener("click", () => prefixLines("> "));
  document.getElementById("mdList")?.addEventListener("click", () => prefixLines("- "));
  document.getElementById("mdCodeBlock")?.addEventListener("click", () => {
    const s = body.selectionStart, e = body.selectionEnd;
    const selected = body.value.substring(s, e);
    const content = selected || "code";
    replaceRange(s, e, "```\n" + content + "\n```", s + 4, s + 4 + content.length);
  });
}

function bindEditorAutoSave() {
  const title = document.getElementById("title");
  const body = document.getElementById("body");
  if (!title) return;

  title.addEventListener("input", () => {
    const note = selectedNote();
    if (note) note.title = title.value || t("untitled");
    const activeTitle = document.querySelector(".note-row.active strong");
    if (activeTitle) activeTitle.textContent = title.value || t("untitled");
    scheduleAutoSave();
  });

  if (body) {
    body.addEventListener("input", () => {
      const note = selectedNote();
      if (note) note.body = editorValueToBody(body.value);
      scheduleAutoSave();
    });
  }
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

async function loadNotes(token = pageLoadToken) {
  try {
    const notes = await invoke("list_notes");
    if (token !== pageLoadToken || state.page !== "notes") return;

    state.notes = notes;
    if (!state.selectedId && state.notes[0]) selectNote(state.notes[0].id);
    state.showTrash = false;
    await loadTrashSilent(token);
    if (token !== pageLoadToken || state.page !== "notes") return;
    renderNotes();
  } catch (error) {
    if (token !== pageLoadToken || state.page !== "notes") return;
    app.innerHTML = `<section class="placeholder"><div class="placeholder-inner"><h1>${t("loadFailed")}</h1><div class="quiet">${escapeHtml(error)}</div></div></section>`;
  }
}

async function loadTrash() {
  try {
    const token = pageLoadToken;
    const trashNotes = await invoke("list_trash");
    if (token !== pageLoadToken || state.page !== "notes") return;

    state.trashNotes = trashNotes;
    state.showTrash = true;
    selectNote(state.trashNotes[0] ? state.trashNotes[0].id : "");
    state.query = "";
    renderNotes();
  } catch (error) {
    if (state.page !== "notes") return;
    app.innerHTML = `<section class="placeholder"><div class="placeholder-inner"><h1>${t("loadTrashFailed")}</h1><div class="quiet">${escapeHtml(error)}</div></div></section>`;
  }
}

async function loadTrashSilent(token = pageLoadToken) {
  try {
    const trashNotes = await invoke("list_trash");
    if (token !== pageLoadToken || state.page !== "notes") return;

    state.trashNotes = trashNotes;
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
    selectNote(state.notes[0] ? state.notes[0].id : "");
    state.query = "";
    renderNotes();
  } else {
    await loadTrash();
  }
}

async function createNote() {
  try {
    const note = await invoke("create_note", { title: t("untitled") });
    state.notes.unshift(note);
    selectNote(note.id, { edit: true });
    renderNotes();
  } catch (error) {
    alert(`${t("loadFailed")}: ${error}`);
  }
}

function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(saveNote, 500);
}

function trackNoteSave(id, promise) {
  if (!pendingNoteSaves.has(id)) pendingNoteSaves.set(id, new Set());
  const saves = pendingNoteSaves.get(id);
  saves.add(promise);
  const cleanup = () => {
    saves.delete(promise);
    if (saves.size === 0) pendingNoteSaves.delete(id);
  };
  promise.then(cleanup, cleanup);
}

async function waitForNoteSaves(id) {
  const saves = pendingNoteSaves.get(id);
  if (!saves || saves.size === 0) return;
  await Promise.allSettled(Array.from(saves));
}

async function saveNote() {
  if (!state.selectedId || state.showTrash) return;
  const titleField = document.getElementById("title");
  const bodyField = document.getElementById("body");
  if (!titleField) return;
  const currentNote = selectedNote();

  const id = state.selectedId;
  const payload = {
    id,
    title: titleField.value,
    body: bodyField ? editorValueToBody(bodyField.value) : currentNote?.body || "",
  };

  let saved;
  const request = invoke("save_note", payload);
  trackNoteSave(id, request);
  try {
    saved = await request;
  } catch {
    return;
  }

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
  await waitForNoteSaves(id);

  try { await invoke("delete_note", { id }); } catch (e) { alert(e); return; }
  state.notes = state.notes.filter((note) => note.id !== id);
  if (state.selectedId === id) selectNote(state.notes[0] ? state.notes[0].id : "");
  renderNotes();
}

async function restoreNote(id) {
  let restored;
  try { restored = await invoke("restore_note", { id }); } catch (e) { alert(e); return; }
  state.trashNotes = state.trashNotes.filter((n) => n.id !== id);
  state.notes.unshift(restored);

  if (state.trashNotes.length === 0 || state.selectedId === id) {
    state.showTrash = false;
    selectNote(restored.id);
    state.query = "";
  }
  renderNotes();
}

async function deletePermanently(id) {
  if (!confirm(t("deleteForeverConfirm"))) return;
  try { await invoke("delete_permanently", { id }); } catch (e) { alert(e); return; }
  state.trashNotes = state.trashNotes.filter((n) => n.id !== id);
  if (state.trashNotes.length === 0) {
    state.showTrash = false;
    selectNote(state.notes[0] ? state.notes[0].id : "");
  } else if (state.selectedId === id) {
    selectNote(state.trashNotes[0].id);
  }
  renderNotes();
}

async function clearAllTrash() {
  if (state.trashNotes.length === 0) return;
  if (!confirm(`${t("clearTrashConfirm")}（${state.trashNotes.length} ${t("notesWillBeDeleted")}）`)) return;
  for (const note of state.trashNotes) {
    try { await invoke("delete_permanently", { id: note.id }); } catch (e) { alert(e); return; }
  }
  state.trashNotes = [];
  state.showTrash = false;
  selectNote(state.notes[0] ? state.notes[0].id : "");
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
        `<button class="mindmap-item" data-id="${m.id}"><strong>${escapeHtml(m.title)}</strong><time>${formatDate(m.updatedAt)}</time></button>` +
        (state.showMindmapTrash
          ? `<button class="mindmap-restore" data-restore="${m.id}" title="${t("restore")}">↩</button>`
          : `<button class="mindmap-delete" data-delete="${m.id}" title="${t("delete")}">×</button>`) +
        `</div>`
      ).join("")
    : `<p class="message">${state.showMindmapTrash ? t("mindmapTrashEmpty") : t("mindmapEmpty")}</p>`;

  const feedbackText = keyword ? `${t("found")} ${filtered.length}${t("foundUnit")}` : "";

  app.innerHTML =
    `<section class="notes">` +
      `<aside class="side">` +
        `<div class="tools">
          <div class="search-feedback ${keyword ? "visible" : ""}" id="searchFeedback">${feedbackText}</div>
          <div class="search" id="searchBox"><span class="search-icon">⌕</span><input id="search" autocomplete="off" placeholder="${t("mindmapSearch")}" value="${escapeHtml(state.mindmapQuery)}"></div>
          ${state.showMindmapTrash
            ? `<div class="trash-header-label">${t("trash")}</div>`
            : `<button class="icon primary" id="newMindmap" title="${t("mindmapUntitled")}">＋</button>`}
        </div>` +
        `<div class="list">${listHtml}</div>` +
        `<div class="trash-bar ${state.showMindmapTrash ? "active" : ""}">
          <button class="trash-toggle" id="toggleMindmapTrash">
            <span class="trash-icon">${state.showMindmapTrash ? "←" : "🗑"}</span>
            <span>${state.showMindmapTrash ? t("mindmapBack") : `${t("trash")}${state.mindmapTrash.length ? " (" + state.mindmapTrash.length + ")" : ""}`}</span>
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
      ${mm.nodes.length ? renderNodes(mm.nodes) : `<div class="mm-empty-hint"><p>${t("mindmapEmptyHint")}</p></div>`}
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

  // Keyboard shortcuts (remove old listener to prevent accumulation)
  document.removeEventListener("keydown", mindmapKeyHandler);
  document.addEventListener("keydown", mindmapKeyHandler);
}

function renderNodes(nodes, depth = 0) {
  return nodes.map((node) => renderNode(node, depth)).join("");
}

function renderNode(node, depth = 0) {
  const hasChildren = node.children.length > 0;
  const isEditing = state.editingNode && state.selectedNodeId === node.id;
  const sizeClass = depth === 0 ? "mm-text-lg" : depth === 1 ? "mm-text-md" : "mm-text-sm";
  const textContent = escapeHtml(node.text).replace(/\n/g, "<br>");
  return `<div class="mm-node-wrapper" style="margin-left: ${depth * 24}px" data-node-id="${node.id}">
    <div class="mm-node ${state.selectedNodeId === node.id ? "selected" : ""}">
      ${hasChildren
        ? `<button class="mm-toggle" data-toggle="${node.id}">${node.collapsed ? "▸" : "▾"}</button>`
        : `<span class="mm-toggle-spacer"></span>`}
      ${isEditing
        ? `<textarea class="mm-edit-input" data-node-id="${node.id}" rows="1">${escapeHtml(node.text)}</textarea>`
        : `<span class="mm-text ${sizeClass}">${textContent}</span>`}
    </div>
  </div>
  ${!node.collapsed ? node.children.map((c) => renderNode(c, depth + 1)).join("") : ""}`;
}

function mindmapKeyHandler(e) {
  if (state.page !== "mindmaps" || state.showMindmapTrash) return;
  const mm = state.mindmaps.find((m) => m.id === state.selectedMindmapId);
  if (!mm) return;
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || isEditorTarget(e.target)) return;
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
const pendingMindmapSaves = new Map();

function trackMindmapSave(id, promise) {
  if (!pendingMindmapSaves.has(id)) pendingMindmapSaves.set(id, new Set());
  const saves = pendingMindmapSaves.get(id);
  saves.add(promise);
  const cleanup = () => {
    saves.delete(promise);
    if (saves.size === 0) pendingMindmapSaves.delete(id);
  };
  promise.then(cleanup, cleanup);
}

async function waitForMindmapSaves(id) {
  const saves = pendingMindmapSaves.get(id);
  if (!saves || saves.size === 0) return;
  await Promise.allSettled(Array.from(saves));
}

function scheduleMindmapSave(mm) {
  clearTimeout(mindmapSaveTimer);
  mindmapSaveTimer = setTimeout(() => saveMindmap(mm), 500);
}

// ── Mindmap API ──

async function loadMindmaps(token = pageLoadToken) {
  try {
    const mindmaps = await invoke("list_mindmaps");
    if (token !== pageLoadToken || state.page !== "mindmaps") return;

    state.mindmaps = mindmaps;
    state.showMindmapTrash = false;
    if (!state.selectedMindmapId && state.mindmaps[0]) state.selectedMindmapId = state.mindmaps[0].id;
    await loadMindmapTrashSilent(token);
    if (token !== pageLoadToken || state.page !== "mindmaps") return;
    renderMindmaps();
  } catch (e) {
    if (token !== pageLoadToken || state.page !== "mindmaps") return;
    app.innerHTML = `<section class="placeholder"><div class="placeholder-inner"><h1>${t("loadFailed")}</h1><div class="quiet">${escapeHtml(e)}</div></div></section>`;
  }
}

async function loadMindmapTrashSilent(token = pageLoadToken) {
  try {
    const mindmapTrash = await invoke("list_mindmap_trash");
    if (token !== pageLoadToken || state.page !== "mindmaps") return;
    state.mindmapTrash = mindmapTrash;
  } catch {}
}

async function createMindmap() {
  let mm;
  try { mm = await invoke("create_mindmap", { title: t("mindmapUntitled") }); } catch (e) { alert(e); return; }
  state.mindmaps.unshift(mm);
  state.selectedMindmapId = mm.id;
  state.selectedNodeId = "";
  state.editingNode = false;
  renderMindmaps();
}

async function saveMindmap(mm) {
  const request = invoke("save_mindmap", { mm });
  trackMindmapSave(mm.id, request);
  try { await request; } catch {}
}

async function trashMindmap(id) {
  await waitForMindmapSaves(id);
  try { await invoke("delete_mindmap", { id }); } catch (e) { alert(e); return; }
  state.mindmaps = state.mindmaps.filter((m) => m.id !== id);
  if (state.selectedMindmapId === id) state.selectedMindmapId = state.mindmaps[0]?.id || "";
  await loadMindmapTrashSilent();
  renderMindmaps();
}

async function restoreMindmap(id) {
  let mm;
  try { mm = await invoke("restore_mindmap", { id }); } catch (e) { alert(e); return; }
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
    try { state.mindmapTrash = await invoke("list_mindmap_trash"); } catch (e) { alert(e); return; }
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
    try { await invoke("delete_mindmap_permanently", { id: m.id }); } catch (e) { alert(e); return; }
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

(async function init() {
  await loadSettings();
  updateNavLabels();
  render();
})();
