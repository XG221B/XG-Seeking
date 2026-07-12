import { t } from './i18n.js';
import { escapeHtml, formatDate, editorValueToBody, isEditorTarget } from './helpers.js';
import { bodyToPreviewHtml } from './markdown.js';
import { invoke } from './api.js';
import { state, pageLoadToken, noteSaveQueue, app } from './state.js';
import { noteCoords, getNoteCoord, scheduleNoteSave, flushNoteSave, waitForNoteSaves, saveNote, syncNoteCoordToDisplay, updateSaveStatus, saveStatusText } from './coordinator.js';

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
    button.addEventListener("click", async () => {
      const targetId = button.dataset.id;
      if (targetId === state.selectedId) return;
      if (state.selectedId && !state.showTrash) {
        const note = selectedNote();
        if (note) {
          const titleField = document.getElementById("title");
          const bodyField = document.getElementById("body");
          if (titleField) note.title = titleField.value || t("untitled");
          if (bodyField) note.body = editorValueToBody(bodyField.value);
          await flushNoteSave(state.selectedId);
        }
      }
      selectNote(targetId);
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
  syncNoteCoordToDisplay();
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

    if (!state.showTrash) loadTrashSilent(pageLoadToken.current);
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
      <span class="save-status ${state.noteSaveStatus === "failed" ? "failed" : ""}" id="noteSaveStatus">${saveStatusText(state.noteSaveStatus)}</span>
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

async function switchNoteMode(sourceMode) {
  const titleEl = document.getElementById("title");
  const bodyEl = document.getElementById("body");
  const note = selectedNote();
  if (note && titleEl) note.title = titleEl.value || t("untitled");
  if (note && bodyEl) note.body = editorValueToBody(bodyEl.value);
  if (note) await flushNoteSave(note.id);
  state.sourceMode = sourceMode;
  renderNotes();
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
    if (note) {
      note.title = title.value || t("untitled");
      const activeTitle = document.querySelector(".note-row.active strong");
      if (activeTitle) activeTitle.textContent = title.value || t("untitled");
      scheduleNoteSave(note.id);
    }
  });

  if (body) {
    body.addEventListener("input", () => {
      const note = selectedNote();
      if (note) {
        note.body = editorValueToBody(body.value);
        scheduleNoteSave(note.id);
      }
    });
  }
}

// ── API calls ──

async function loadNotes(token = pageLoadToken.current) {
  try {
    const notes = await invoke("list_notes");
    if (token !== pageLoadToken.current || state.page !== "notes") return;

    state.notes = notes;
    for (const n of notes) {
      if (n.revision) { const c = getNoteCoord(n.id); c.revision = n.revision; }
    }
    if (!state.selectedId && state.notes[0]) selectNote(state.notes[0].id);
    state.showTrash = false;
    await loadTrashSilent(token);
    if (token !== pageLoadToken.current || state.page !== "notes") return;
    renderNotes();
  } catch (error) {
    if (token !== pageLoadToken.current || state.page !== "notes") return;
    app.innerHTML = `<section class="placeholder"><div class="placeholder-inner"><h1>${t("loadFailed")}</h1><div class="quiet">${escapeHtml(error)}</div></div></section>`;
  }
}

async function loadTrash() {
  try {
    const token = pageLoadToken.current;
    const trashNotes = await invoke("list_trash");
    if (token !== pageLoadToken.current || state.page !== "notes") return;

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

async function loadTrashSilent(token = pageLoadToken.current) {
  try {
    const trashNotes = await invoke("list_trash");
    if (token !== pageLoadToken.current || state.page !== "notes") return;

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

let creatingNote = false;

async function createNote() {
  if (creatingNote) return;
  creatingNote = true;
  pageLoadToken.current += 1;
  try {
    const note = await invoke("create_note", { title: t("untitled") });
    state.notes.unshift(note);
    if (note.revision) { const c = getNoteCoord(note.id); c.revision = note.revision; }
    selectNote(note.id, { edit: true });
    renderNotes();
  } catch (error) {
    alert(`${t("loadFailed")}: ${error}`);
  } finally {
    creatingNote = false;
  }
}

async function trashNote(id) {
  if (!id) return;
  if (id === state.selectedId) {
    const note = selectedNote();
    if (note) {
      const titleField = document.getElementById("title");
      const bodyField = document.getElementById("body");
      if (titleField) note.title = titleField.value || t("untitled");
      if (bodyField) note.body = editorValueToBody(bodyField.value);
    }
    const saved = await flushNoteSave(id);
    if (!saved) { alert(t("saveFailed")); return; }
  }
  const c = getNoteCoord(id);
  c.deleted = true;
  clearTimeout(c.timer);
  await waitForNoteSaves(id);

  try { await invoke("delete_note", { id }); } catch (e) { alert(e); c.deleted = false; return; }
  state.notes = state.notes.filter((note) => note.id !== id);
  noteCoords.delete(id);
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

export {
  filteredNotes,
  selectedNote,
  selectNote,
  noteListHtml,
  searchFeedbackText,
  updateSearchFeedback,
  bindListEvents,
  renderNoteListOnly,
  renderTrashFooter,
  renderNotes,
  renderRichEditor,
  renderEmpty,
  renderTrashEditor,
  renderTrashEmpty,
  bindNotesEvents,
  switchNoteMode,
  bindMarkdownTools,
  bindEditorAutoSave,
  loadNotes,
  loadTrash,
  loadTrashSilent,
  updateTrashBar,
  toggleTrashView,
  createNote,
  trashNote,
  restoreNote,
  deletePermanently,
  clearAllTrash,
};
