import "./styles.css";

const app = document.getElementById("app");
const navButtons = Array.from(document.querySelectorAll(".nav button"));
const isTauri = Boolean(window.__TAURI_INTERNALS__);
let tauriInvoke = null;
let fileDropUnlisten = null;

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
  files: [],
  selectedFileId: "",
  filePreview: null,
  fileZoom: 1,
  fileMessage: "",
  fileDragActive: false,
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

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function setPage(page) {
  state.page = page;
  navButtons.forEach((button) => button.classList.toggle("active", button.dataset.page === page));
  render();
  if (page === "notes") loadNotes();
  if (page === "slot1") {
    loadFiles();
    setupFileDrop();
  }
}

function renderPlaceholder(page) {
  const title = {
    home: "首页",
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

function fileListHtml() {
  return state.files.length
    ? state.files.map((file) => (
      `<div class="note-row ${file.id === state.selectedFileId ? "active" : ""}">` +
      `<button class="item file-item" data-file-id="${file.id}"><strong>${escapeHtml(file.name)}</strong><time>${formatSize(file.size)} · ${formatDate(file.updatedAt)}</time></button>` +
      `<button class="delete-note" data-delete-file-id="${file.id}" title="移除" aria-label="移除">×</button>` +
      `</div>`
    )).join("")
    : `<p class="message">把文件拖进这里开始预览</p>`;
}

function renderFilePreviewContent() {
  const preview = state.filePreview;
  if (!isTauri) {
    return `<div class="empty"><h2>请使用桌面应用</h2><p class="message">本地文件预览需要桌面端权限，浏览器模式不能长期保存拖入文件。</p></div>`;
  }
  if (!preview) {
    return `<div class="empty"><h2>选择或拖入文件</h2><p class="message">支持 PDF、图片和常见文本文件。文件会复制到本机应用数据目录。</p></div>`;
  }

  if (preview.kind === "text") {
    return `<pre class="file-text" style="font-size:${Math.round(16 * state.fileZoom)}px">${escapeHtml(preview.content)}</pre>`;
  }
  if (preview.kind === "image") {
    return `<div class="file-canvas"><img class="file-image" style="width:${Math.round(state.fileZoom * 100)}%" src="${preview.dataUrl}" alt="${escapeHtml(preview.name)}"></div>`;
  }
  if (preview.kind === "pdf") {
    return `<iframe class="file-frame" style="width:${Math.round(state.fileZoom * 100)}%; height:${Math.round(state.fileZoom * 100)}%" src="${preview.dataUrl}#toolbar=1&navpanes=0"></iframe>`;
  }
  return `<div class="empty"><h2>暂不支持预览</h2><p class="message">这个文件已经保存到本地文件库，但当前只支持 PDF、图片和常见文本预览。</p></div>`;
}

function renderFileLibrary() {
  const selected = state.files.find((file) => file.id === state.selectedFileId);
  app.innerHTML =
    `<section class="notes files ${state.fileDragActive ? "dragging" : ""}">` +
      `<aside class="side">` +
        `<div class="tools file-tools">` +
          `<div class="drop-zone" id="dropZone">` +
            `<strong>拖入文件</strong>` +
            `<span>${isTauri ? "拖到这个页面任意位置即可导入" : "请在桌面应用中使用"}</span>` +
            `<button class="text-btn primary" id="chooseFiles">选择文件</button>` +
          `</div>` +
        `</div>` +
        `<div class="list">${fileListHtml()}</div>` +
      `</aside>` +
      `<section class="editor file-preview">` +
        `<div class="file-preview-head">` +
          `<div><strong>${selected ? escapeHtml(selected.name) : "文件预览"}</strong><span>${state.fileMessage ? escapeHtml(state.fileMessage) : ""}</span></div>` +
          `<div class="zoom-tools">` +
            `<button class="icon" id="zoomOut" title="缩小">−</button>` +
            `<button class="text-btn" id="zoomReset">${Math.round(state.fileZoom * 100)}%</button>` +
            `<button class="icon" id="zoomIn" title="放大">＋</button>` +
          `</div>` +
        `</div>` +
        `<div class="file-preview-body">${renderFilePreviewContent()}</div>` +
      `</section>` +
    `</section>`;

  bindFileEvents();
}

function render() {
  if (state.page === "notes") renderNotes();
  else if (state.page === "slot1") renderFileLibrary();
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

function bindFileEvents() {
  Array.from(document.querySelectorAll(".file-item")).forEach((button) => {
    button.addEventListener("click", () => selectFile(button.dataset.fileId));
  });

  Array.from(document.querySelectorAll("[data-delete-file-id]")).forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteFile(button.dataset.deleteFileId);
    });
  });

  const chooseFiles = document.getElementById("chooseFiles");
  if (chooseFiles) chooseFiles.addEventListener("click", chooseLocalFiles);

  const zoomOut = document.getElementById("zoomOut");
  const zoomReset = document.getElementById("zoomReset");
  const zoomIn = document.getElementById("zoomIn");

  if (zoomOut) zoomOut.addEventListener("click", () => setFileZoom(state.fileZoom - 0.1));
  if (zoomReset) zoomReset.addEventListener("click", () => setFileZoom(1));
  if (zoomIn) zoomIn.addEventListener("click", () => setFileZoom(state.fileZoom + 0.1));

  const dropZone = document.getElementById("dropZone");
  if (dropZone) {
    ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
      dropZone.addEventListener(eventName, (event) => event.preventDefault());
    });
  }
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

async function loadFiles() {
  if (!isTauri) return;
  try {
    state.files = await invoke("list_files");
    if (!state.selectedFileId && state.files[0]) state.selectedFileId = state.files[0].id;
    if (state.selectedFileId && !state.filePreview) await loadFilePreview(state.selectedFileId, false);
    renderFileLibrary();
  } catch (error) {
    state.fileMessage = error instanceof Error ? error.message : String(error);
    renderFileLibrary();
  }
}

async function setupFileDrop() {
  if (!isTauri || fileDropUnlisten) return;
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  fileDropUnlisten = await getCurrentWebview().onDragDropEvent(async (event) => {
    if (state.page !== "slot1") return;
    if (event.payload.type === "enter" || event.payload.type === "over") {
      if (state.fileDragActive) return;
      state.fileDragActive = true;
      renderFileLibrary();
    } else if (event.payload.type === "leave") {
      state.fileDragActive = false;
      renderFileLibrary();
    } else if (event.payload.type === "drop") {
      state.fileDragActive = false;
      await importDroppedFiles(event.payload.paths);
    }
  });
}

async function chooseLocalFiles() {
  if (!isTauri) return;
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: true,
      directory: false,
      title: "选择要导入的文件",
    });
    const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
    await importDroppedFiles(paths);
  } catch (error) {
    state.fileMessage = error instanceof Error ? error.message : String(error);
    renderFileLibrary();
  }
}

async function importDroppedFiles(paths) {
  if (!paths.length) return;
  try {
    state.fileMessage = "正在导入...";
    renderFileLibrary();
    const imported = await invoke("import_files", { paths });
    state.files = await invoke("list_files");
    if (imported[0]) {
      state.selectedFileId = imported[0].id;
      await loadFilePreview(imported[0].id, false);
    }
    state.fileMessage = imported.length ? `已导入 ${imported.length} 个文件` : "没有可导入的文件";
    renderFileLibrary();
  } catch (error) {
    state.fileMessage = error instanceof Error ? error.message : String(error);
    renderFileLibrary();
  }
}

async function selectFile(id) {
  state.selectedFileId = id;
  await loadFilePreview(id);
}

async function loadFilePreview(id, shouldRender = true) {
  state.filePreview = await invoke("read_file_preview", { id });
  state.fileZoom = 1;
  if (shouldRender) renderFileLibrary();
}

function setFileZoom(value) {
  state.fileZoom = Math.min(2.5, Math.max(0.5, Math.round(value * 10) / 10));
  renderFileLibrary();
}

async function deleteFile(id) {
  if (!id || !confirm("确定移除这个文件吗？")) return;
  await invoke("delete_file", { id });
  state.files = state.files.filter((file) => file.id !== id);
  if (state.selectedFileId === id) {
    state.selectedFileId = state.files[0] ? state.files[0].id : "";
    state.filePreview = null;
    if (state.selectedFileId) await loadFilePreview(state.selectedFileId, false);
  }
  renderFileLibrary();
}

navButtons.forEach((button) => {
  button.addEventListener("click", () => setPage(button.dataset.page));
});

render();
