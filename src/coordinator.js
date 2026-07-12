import { t } from './i18n.js';
import { invoke, ApiError } from './api.js';
import { formatDate, editorValueToBody } from './helpers.js';
import { state, pageLoadToken, noteSaveQueue, mindmapSaveQueue } from './state.js';

// ── Per-item save coordinator ──

const noteCoords = new Map();
const mindmapCoords = new Map();

function getNoteCoord(id) {
  let c = noteCoords.get(id);
  if (!c) {
    c = { draft: null, dirty: false, timer: 0, status: "", seq: 0, deleted: false, revision: null };
    noteCoords.set(id, c);
  }
  return c;
}

function getMindmapCoord(id) {
  let c = mindmapCoords.get(id);
  if (!c) {
    c = { draft: null, dirty: false, timer: 0, status: "", seq: 0, deleted: false, revision: null };
    mindmapCoords.set(id, c);
  }
  return c;
}

function snapshotCurrentNote() {
  const id = state.selectedId;
  if (!id || state.showTrash) return null;
  const titleField = document.getElementById("title");
  const bodyField = document.getElementById("body");
  if (!titleField) return null;
  return {
    id,
    title: titleField.value,
    body: bodyField ? editorValueToBody(bodyField.value) : "",
  };
}

function snapshotCurrentMindmap() {
  const mm = getCurrentMindmap();
  if (!mm) return null;
  return JSON.parse(JSON.stringify(mm));
}

function updateNoteCoordStatus(id, status) {
  const c = getNoteCoord(id);
  c.status = status;
  if (state.selectedId === id) {
    state.noteSaveStatus = status;
    const el = document.getElementById("noteSaveStatus");
    if (el) {
      el.textContent = saveStatusText(status);
      el.classList.toggle("failed", status === "failed");
    }
  }
}

function updateMindmapCoordStatus(id, status) {
  const c = getMindmapCoord(id);
  c.status = status;
  if (state.selectedMindmapId === id) {
    state.mindmapSaveStatus = status;
    const el = document.getElementById("mindmapSaveStatus");
    if (el) {
      el.textContent = saveStatusText(status);
      el.classList.toggle("failed", status === "failed");
    }
  }
}

function syncNoteCoordToDisplay() {
  const id = state.selectedId;
  if (!id || state.showTrash) {
    state.noteSaveStatus = "";
    const el = document.getElementById("noteSaveStatus");
    if (el) { el.textContent = ""; el.classList.remove("failed"); }
    return;
  }
  const c = getNoteCoord(id);
  state.noteSaveStatus = c.status;
  const el = document.getElementById("noteSaveStatus");
  if (el) {
    el.textContent = saveStatusText(c.status);
    el.classList.toggle("failed", c.status === "failed");
  }
}

function syncMindmapCoordToDisplay() {
  const id = state.selectedMindmapId;
  if (!id || state.showMindmapTrash) {
    state.mindmapSaveStatus = "";
    const el = document.getElementById("mindmapSaveStatus");
    if (el) { el.textContent = ""; el.classList.remove("failed"); }
    return;
  }
  const c = getMindmapCoord(id);
  state.mindmapSaveStatus = c.status;
  const el = document.getElementById("mindmapSaveStatus");
  if (el) {
    el.textContent = saveStatusText(c.status);
    el.classList.toggle("failed", c.status === "failed");
  }
}

function saveStatusText(status) {
  if (status === "pending") return t("savePending");
  if (status === "saved") return t("saveSaved");
  if (status === "failed") return t("saveFailed");
  if (status === "conflict") return t("saveConflict");
  return "";
}

function updateSaveStatus(target, status) {
  if (target === "note") state.noteSaveStatus = status;
  if (target === "mindmap") state.mindmapSaveStatus = status;
  const id = target === "note" ? "noteSaveStatus" : "mindmapSaveStatus";
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = saveStatusText(status);
  el.classList.toggle("failed", status === "failed");
}

function queueById(queue, id, task) {
  const previous = queue.get(id) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  const tracked = current.finally(() => {
    if (queue.get(id) === tracked) queue.delete(id);
  });
  queue.set(id, tracked);
  return current;
}

async function waitForNoteSaves(id) {
  const save = noteSaveQueue.get(id);
  if (!save) return;
  await save.catch(() => {});
}

async function waitForMindmapSaves(id) {
  const save = mindmapSaveQueue.get(id);
  if (!save) return;
  await save.catch(() => {});
}

function scheduleNoteSave(id) {
  const c = getNoteCoord(id);
  if (c.deleted) return;
  c.dirty = true;
  clearTimeout(c.timer);
  c.timer = setTimeout(() => flushNoteSave(id).catch(() => {}), 500);
}

async function flushNoteSave(id) {
  const c = getNoteCoord(id);
  if (c.deleted || !c.dirty) return true;
  clearTimeout(c.timer);

  const note = state.notes.find((n) => n.id === id);
  if (!note) return true;

  const snapshot = { id, title: note.title, body: note.body };
  if (c.revision) snapshot.expectedRevision = c.revision;
  c.draft = snapshot;

  const seq = ++c.seq;
  updateNoteCoordStatus(id, "pending");
  try {
    const saved = await queueById(noteSaveQueue, id, () => invoke("save_note", snapshot));
    if (c.deleted) return true;
    if (saved.revision) c.revision = saved.revision;
    const existing = state.notes.find((n) => n.id === saved.id);
    if (existing) {
      existing.title = saved.title;
      existing.body = saved.body;
      existing.updatedAt = saved.updatedAt;
      if (saved.revision) existing.revision = saved.revision;
    }
    if (seq === c.seq) {
      c.dirty = false;
      updateNoteCoordStatus(id, "saved");
      if (state.selectedId === id) {
        const activeTime = document.querySelector(".note-row.active time");
        if (activeTime) activeTime.textContent = formatDate(saved.updatedAt);
        const activeTitle = document.querySelector(".note-row.active strong");
        if (activeTitle) activeTitle.textContent = saved.title;
      }
      setTimeout(() => {
        if (seq === c.seq && c.status === "saved") updateNoteCoordStatus(id, "");
      }, 1400);
    }
    return true;
  } catch (error) {
    if (c.deleted) return true;
    if (error.code === "CONFLICT") {
      if (error.currentRevision) c.revision = error.currentRevision;
      if (seq === c.seq) updateNoteCoordStatus(id, "conflict");
      return false;
    }
    if (seq === c.seq) {
      updateNoteCoordStatus(id, "failed");
    }
    return false;
  }
}

async function saveNote(options = {}) {
  if (!state.selectedId || state.showTrash) return true;
  const note = selectedNote();
  if (!note) return true;
  return flushNoteSave(state.selectedId).then((ok) => {
    if (!ok && options.showAlert) alert(t("saveFailed"));
    return ok;
  });
}

function scheduleMindmapSave(mm) {
  const c = getMindmapCoord(mm.id);
  if (c.deleted) return;
  c.dirty = true;
  clearTimeout(c.timer);
  c.draft = JSON.parse(JSON.stringify(mm));
  c.timer = setTimeout(() => flushMindmapSave(mm.id).catch(() => {}), 500);
}

async function flushMindmapSave(id) {
  const c = getMindmapCoord(id);
  if (c.deleted || !c.dirty) return true;
  clearTimeout(c.timer);

  const snapshot = c.draft;
  if (!snapshot) return true;

  const payload = { mm: snapshot };
  if (c.revision) payload.expectedRevision = c.revision;

  const seq = ++c.seq;
  updateMindmapCoordStatus(id, "pending");
  try {
    const saved = await queueById(mindmapSaveQueue, id, () => invoke("save_mindmap", payload));
    if (c.deleted) return true;
    if (saved.revision) c.revision = saved.revision;
    const existing = state.mindmaps.find((item) => item.id === saved.id);
    if (existing) {
      existing.title = saved.title;
      existing.updatedAt = saved.updatedAt;
      existing.nodes = saved.nodes;
      if (saved.revision) existing.revision = saved.revision;
    }
    if (seq === c.seq) {
      c.dirty = false;
      updateMindmapCoordStatus(id, "saved");
      setTimeout(() => {
        if (seq === c.seq && c.status === "saved") updateMindmapCoordStatus(id, "");
      }, 1400);
    }
    return true;
  } catch (error) {
    if (c.deleted) return true;
    if (error.code === "CONFLICT") {
      if (error.currentRevision) c.revision = error.currentRevision;
      if (seq === c.seq) updateMindmapCoordStatus(id, "conflict");
      return false;
    }
    if (seq === c.seq) {
      updateMindmapCoordStatus(id, "failed");
    }
    return false;
  }
}

async function flushAllDirty() {
  const promises = [];
  for (const [id, c] of noteCoords) {
    if (c.dirty) {
      const note = state.notes.find((n) => n.id === id);
      if (note) {
        const titleField = document.getElementById("title");
        const bodyField = document.getElementById("body");
        if (titleField && state.selectedId === id) {
          note.title = titleField.value || t("untitled");
          if (bodyField) note.body = editorValueToBody(bodyField.value);
        }
        clearTimeout(c.timer);
        promises.push(flushNoteSave(id));
      }
    }
  }
  for (const [id, c] of mindmapCoords) {
    if (c.dirty) {
      clearTimeout(c.timer);
      promises.push(flushMindmapSave(id));
    }
  }
  await Promise.allSettled(promises);
}

// Circular reference: selectedNote is in notes-view, so resolve lazily
function selectedNote() {
  const source = state.showTrash ? state.trashNotes : state.notes;
  return source.find((note) => note.id === state.selectedId) || null;
}

// Internal helper used by saveNote (resolved lazily to avoid circular imports)
function getCurrentMindmap() {
  return state.mindmaps.find((m) => m.id === state.selectedMindmapId) || null;
}

export {
  noteCoords,
  mindmapCoords,
  getNoteCoord,
  getMindmapCoord,
  snapshotCurrentNote,
  snapshotCurrentMindmap,
  updateNoteCoordStatus,
  updateMindmapCoordStatus,
  syncNoteCoordToDisplay,
  syncMindmapCoordToDisplay,
  saveStatusText,
  updateSaveStatus,
  queueById,
  waitForNoteSaves,
  waitForMindmapSaves,
  scheduleNoteSave,
  flushNoteSave,
  saveNote,
  scheduleMindmapSave,
  flushMindmapSave,
  flushAllDirty,
};
