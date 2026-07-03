import "./styles.css";

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
};

let autoSaveTimer = 0;

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
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function setPage(page) {
  state.page = page;
  navButtons.forEach((button) => button.classList.toggle("active", button.dataset.page === page));
  render();
  if (page === "notes") loadNotes();
}

function renderPlaceholder(page) {
  const title = {
    home: "首页",
    slot1: "备用",
    slot2: "备用",
  }[page];

  app.innerHTML = `<section class="placeholder"><div class="placeholder-inner"><h1>${title}</h1><div class="quiet">暂未开放</div></div></section>`;
}

function filteredNotes() {
  const keyword = state.query.trim().toLowerCase();
  return keyword
    ? state.notes.filter((note) => `${note.title}\n${note.body}`.toLowerCase().includes(keyword))
    : state.notes;
}

function noteListHtml() {
  const keyword = state.query.trim().toLowerCase();
  const list = filteredNotes();

  return list.length
    ? list.map((note) => (
      `<div class="note-row ${note.id === state.selectedId ? "active" : ""}" data-id="${note.id}">` +
      `<button class="item" data-id="${note.id}"><strong>${escapeHtml(note.title)}</strong><time>${formatDate(note.updatedAt)}</time></button>` +
      `<button class="delete-note" data-delete-id="${note.id}" title="删除" aria-label="删除">×</button>` +
      `</div>`
    )).join("")
    : `<p class="message">${keyword ? "没有找到匹配内容" : "还没有笔记"}</p>`;
}

function searchFeedbackText(prefix) {
  if (!state.query.trim()) return "";
  return `${prefix || "找到"} ${filteredNotes().length} 篇`;
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

  Array.from(document.querySelectorAll(".delete-note")).forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteNote(button.dataset.deleteId);
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

function renderNotes() {
  const selected = state.notes.find((note) => note.id === state.selectedId);
  app.innerHTML =
    `<section class="notes">` +
      `<aside class="side">` +
        `<div class="tools">` +
          `<div class="search-feedback ${state.query.trim() ? "visible" : ""}" id="searchFeedback">${searchFeedbackText("")}</div>` +
          `<div class="search" id="searchBox"><span class="search-icon">⌕</span><input id="search" placeholder="搜索想法" value="${escapeHtml(state.query)}"></div>` +
          `<button class="icon primary" id="new" title="新建">＋</button>` +
        `</div>` +
        `<div class="list">${noteListHtml()}</div>` +
      `</aside>` +
      `<section class="editor">${selected ? renderEditor(selected) : renderEmpty()}</section>` +
    `</section>`;

  bindNotesEvents();
}

function renderEditor(note) {
  return `<div class="form" id="form">` +
    `<input class="title" id="title" placeholder="今天的想法" value="${escapeHtml(note.title)}">` +
    `<textarea class="body" id="body" placeholder="一段还没整理好的念头……">${escapeHtml(note.body)}</textarea>` +
  `</div>`;
}

function renderEmpty() {
  return `<div class="empty"><h2>开始记录</h2><button class="text-btn primary" id="emptyNew">新建</button></div>`;
}

function render() {
  if (state.page === "notes") renderNotes();
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
        renderNoteListOnly("已筛选");
      }
    });
  }

  const createButtons = [document.getElementById("new"), document.getElementById("emptyNew")].filter(Boolean);
  createButtons.forEach((button) => button.addEventListener("click", createNote));
  bindListEvents();
  bindEditorAutoSave();
}

function selectedNote() {
  return state.notes.find((note) => note.id === state.selectedId);
}

function bindEditorAutoSave() {
  const title = document.getElementById("title");
  const body = document.getElementById("body");
  if (!title || !body) return;

  title.addEventListener("input", () => {
    const note = selectedNote();
    if (note) note.title = title.value || "未命名想法";
    const activeTitle = document.querySelector(".note-row.active strong");
    if (activeTitle) activeTitle.textContent = title.value || "未命名想法";
    scheduleAutoSave();
  });

  body.addEventListener("input", () => {
    const note = selectedNote();
    if (note) note.body = body.value;
    scheduleAutoSave();
  });
}

async function loadNotes() {
  try {
    state.notes = await invoke("list_notes");
    if (!state.selectedId && state.notes[0]) state.selectedId = state.notes[0].id;
    renderNotes();
  } catch (error) {
    app.innerHTML = `<section class="placeholder"><div class="placeholder-inner"><h1>读取失败</h1><div class="quiet">${escapeHtml(error)}</div></div></section>`;
  }
}

async function createNote() {
  const note = await invoke("create_note");
  state.notes.unshift(note);
  state.selectedId = note.id;
  renderNotes();
}

function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(saveNote, 500);
}

async function saveNote() {
  if (!state.selectedId) return;
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

async function deleteNote(id) {
  const idToDelete = id || state.selectedId;
  if (!idToDelete || !confirm("确定删除这篇笔记吗？")) return;
  if (idToDelete === state.selectedId) clearTimeout(autoSaveTimer);

  await invoke("delete_note", { id: idToDelete });
  state.notes = state.notes.filter((note) => note.id !== idToDelete);
  if (state.selectedId === idToDelete) state.selectedId = state.notes[0] ? state.notes[0].id : "";
  renderNotes();
}

navButtons.forEach((button) => {
  button.addEventListener("click", () => setPage(button.dataset.page));
});

render();
