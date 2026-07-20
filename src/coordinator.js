import { t } from './i18n.js';
import { invoke } from './api.js';
import { formatDate, editorValueToBody } from './helpers.js';
import { state, noteSaveQueue, mindmapSaveQueue } from './state.js';

const noteCoords = new Map();
const mindmapCoords = new Map();

function getNoteCoord(id) {
  let c = noteCoords.get(id);
  if (!c) {
    c = { draft: null, dirty: false, timer: 0, status: "", deleted: false, revision: null, conflictRevision: null, version: 0 };
    noteCoords.set(id, c);
  }
  return c;
}

function getMindmapCoord(id) {
  let c = mindmapCoords.get(id);
  if (!c) {
    c = { draft: null, dirty: false, timer: 0, status: "", deleted: false, revision: null, conflictRevision: null, version: 0 };
    mindmapCoords.set(id, c);
  }
  return c;
}

function updateNoteCoordStatus(id, status) {
  const c = getNoteCoord(id);
  c.status = status;
  if (state.selectedId === id) {
    state.noteSaveStatus = status;
    const el = document.getElementById("noteSaveStatus");
    if (el) {
      el.textContent = saveStatusText(status);
      el.classList.toggle("failed", status === "failed" || status === "conflict");
    }
    if (status === "conflict") {
      document.dispatchEvent(new CustomEvent("xg:note-save-conflict", { detail: { id } }));
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
      el.classList.toggle("failed", status === "failed" || status === "conflict");
    }
    if (status === "conflict") {
      document.dispatchEvent(new CustomEvent("xg:mindmap-save-conflict", { detail: { id } }));
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
    el.classList.toggle("failed", c.status === "failed" || c.status === "conflict");
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
    el.classList.toggle("failed", c.status === "failed" || c.status === "conflict");
  }
}

function saveStatusText(status) {
  if (status === "pending") return t("savePending");
  if (status === "saved") return t("saveSaved");
  if (status === "failed") return t("saveFailed");
  if (status === "conflict") return t("saveConflict");
  return "";
}

function queueById(queue, id, task) {
  const previous = queue.get(id) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  let tracked;
  const cleanup = () => {
    if (queue.get(id) === tracked) queue.delete(id);
  };
  tracked = current.then(cleanup, cleanup);
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
  const note = state.notes.find((item) => item.id === id);
  if (!note) return;
  c.draft = { id, title: note.title, body: note.body };
  c.dirty = true;
  c.version++;
  clearTimeout(c.timer);
  if (c.status === "conflict") return;
  c.timer = setTimeout(() => flushNoteSave(id).catch(() => {}), 500);
}

async function flushNoteSave(id) {
  const c = getNoteCoord(id);
  if (c.status === "conflict") return false;
  if (c.deleted || !c.dirty) return true;
  clearTimeout(c.timer);

  const note = state.notes.find((n) => n.id === id);
  if (!note) return true;

  if (!c.draft) c.draft = { id, title: note.title, body: note.body };
  const snapshot = { ...c.draft };

  const capturedVersion = c.version;
  updateNoteCoordStatus(id, "pending");
  try {
    const saved = await queueById(noteSaveQueue, id, () => {
      const payload = { ...snapshot };
      if (c.revision) payload.expectedRevision = c.revision;
      return invoke("save_note", payload);
    });
    if (c.deleted) return true;
    if (saved.revision) c.revision = saved.revision;
    if (capturedVersion === c.version) {
      const existing = state.notes.find((n) => n.id === saved.id);
      if (existing) {
        existing.title = saved.title;
        existing.body = saved.body;
        existing.updatedAt = saved.updatedAt;
        if (saved.revision) existing.revision = saved.revision;
      }
      c.dirty = false;
      c.draft = null;
      c.conflictRevision = null;
      updateNoteCoordStatus(id, "saved");
      if (state.selectedId === id) {
        const activeTime = document.querySelector(".note-row.active time");
        if (activeTime) activeTime.textContent = formatDate(saved.updatedAt);
        const activeTitle = document.querySelector(".note-row.active strong");
        if (activeTitle) activeTitle.textContent = saved.title;
      }
      setTimeout(() => {
        if (capturedVersion === c.version && c.status === "saved") updateNoteCoordStatus(id, "");
      }, 1400);
    }
    return true;
  } catch (error) {
    if (c.deleted) return true;
    if (error.code === "CONFLICT") {
      c.conflictRevision = error.currentRevision || null;
      clearTimeout(c.timer);
      updateNoteCoordStatus(id, "conflict");
    } else if (capturedVersion === c.version) {
      updateNoteCoordStatus(id, "failed");
    }
    return false;
  }
}

function scheduleMindmapSave(mm) {
  const c = getMindmapCoord(mm.id);
  if (c.deleted) return;
  c.draft = JSON.parse(JSON.stringify(mm));
  c.dirty = true;
  c.version++;
  clearTimeout(c.timer);
  if (c.status === "conflict") return;
  c.timer = setTimeout(() => flushMindmapSave(mm.id).catch(() => {}), 500);
}

async function flushMindmapSave(id) {
  const c = getMindmapCoord(id);
  if (c.status === "conflict") return false;
  if (c.deleted || !c.dirty) return true;
  clearTimeout(c.timer);

  const snapshot = c.draft;
  if (!snapshot) return true;

  const capturedVersion = c.version;
  updateMindmapCoordStatus(id, "pending");
  try {
    const saved = await queueById(mindmapSaveQueue, id, () => {
      const payload = { mm: snapshot };
      if (c.revision) payload.expectedRevision = c.revision;
      return invoke("save_mindmap", payload);
    });
    if (c.deleted) return true;
    if (saved.revision) c.revision = saved.revision;
    if (capturedVersion === c.version) {
      const existing = state.mindmaps.find((item) => item.id === saved.id);
      if (existing) {
        existing.title = saved.title;
        existing.updatedAt = saved.updatedAt;
        existing.nodes = saved.nodes;
        if (saved.revision) existing.revision = saved.revision;
      }
      c.dirty = false;
      c.draft = null;
      c.conflictRevision = null;
      updateMindmapCoordStatus(id, "saved");
      setTimeout(() => {
        if (capturedVersion === c.version && c.status === "saved") updateMindmapCoordStatus(id, "");
      }, 1400);
    }
    return true;
  } catch (error) {
    if (c.deleted) return true;
    if (error.code === "CONFLICT") {
      c.conflictRevision = error.currentRevision || null;
      clearTimeout(c.timer);
      updateMindmapCoordStatus(id, "conflict");
    } else if (capturedVersion === c.version) {
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
  const results = await Promise.allSettled(promises);
  return results.every((result) => result.status === "fulfilled" && result.value === true);
}

function selectedNote() {
  const source = state.showTrash ? state.trashNotes : state.notes;
  return source.find((note) => note.id === state.selectedId) || null;
}

function getCurrentMindmap() {
  return state.mindmaps.find((m) => m.id === state.selectedMindmapId) || null;
}

// Conflict resolution is DOM-free; callers own confirmation and feedback UI.

async function reloadLatestNote(id) {
  if (!id) return false;
  const c = getNoteCoord(id);
  try {
    const notes = await invoke("list_notes");
    const refreshed = notes.find((n) => n.id === id);
    if (!refreshed) return false;
    const existing = state.notes.find((n) => n.id === id);
    if (existing) {
      existing.title = refreshed.title; existing.body = refreshed.body;
      existing.updatedAt = refreshed.updatedAt;
      if (refreshed.revision) existing.revision = refreshed.revision;
    }
    c.revision = refreshed.revision; c.conflictRevision = null; c.dirty = false; c.draft = null; c.version++;
    updateNoteCoordStatus(id, "");
    return true;
  } catch { return false; }
}

async function saveAsNewNoteFromDraft(originalId) {
  const note = state.notes.find((n) => n.id === originalId);
  if (!note) return { ok: false };
  const c = getNoteCoord(originalId);
  const draft = { ...(c.draft || { id: originalId, title: note.title, body: note.body }) };
  delete draft.expectedRevision;
  let newNote = null;
  try {
    newNote = await invoke("create_note", { title: draft.title || t("untitled") });
    const newCoord = getNoteCoord(newNote.id);
    newCoord.revision = newNote.revision || null;
    newCoord.draft = { id: newNote.id, title: draft.title || t("untitled"), body: draft.body || "" };
    newCoord.dirty = true;
    state.notes.unshift(newNote);
    newNote.title = newCoord.draft.title;
    newNote.body = newCoord.draft.body;
    const payload = { ...newCoord.draft };
    if (newCoord.revision) payload.expectedRevision = newCoord.revision;
    const saved = await queueById(noteSaveQueue, newNote.id, () => invoke("save_note", payload));
    newCoord.revision = saved.revision || newCoord.revision;
    newCoord.dirty = false;
    newCoord.draft = null;
    updateNoteCoordStatus(newNote.id, "saved");
    newNote.title = saved.title; newNote.body = saved.body; newNote.updatedAt = saved.updatedAt;
    if (saved.revision) newNote.revision = saved.revision;
    c.dirty = false; c.draft = null; c.conflictRevision = null; c.version++;
    updateNoteCoordStatus(originalId, "");
    state.selectedId = newNote.id;
    return { ok: true, newId: newNote.id };
  } catch {
    if (newNote) updateNoteCoordStatus(newNote.id, "failed");
    updateNoteCoordStatus(originalId, "conflict");
    return { ok: false, newId: newNote?.id || "" };
  }
}

async function reloadLatestMindmap(id) {
  if (!id) return false;
  const c = getMindmapCoord(id);
  try {
    const maps = await invoke("list_mindmaps");
    const refreshed = maps.find((m) => m.id === id);
    if (!refreshed) return false;
    const existing = state.mindmaps.find((m) => m.id === id);
    if (existing) {
      existing.title = refreshed.title; existing.updatedAt = refreshed.updatedAt;
      existing.nodes = refreshed.nodes;
      if (refreshed.revision) existing.revision = refreshed.revision;
    }
    c.revision = refreshed.revision; c.conflictRevision = null; c.dirty = false; c.draft = null; c.version++;
    updateMindmapCoordStatus(id, "");
    return true;
  } catch { return false; }
}

async function saveAsNewMindmapFromDraft(originalId) {
  const mm = state.mindmaps.find((m) => m.id === originalId);
  if (!mm) return { ok: false };
  const c = getMindmapCoord(originalId);
  const draft = JSON.parse(JSON.stringify(c.draft || mm));
  delete draft.expectedRevision;
  let newMm = null;
  try {
    newMm = await invoke("create_mindmap", { title: draft.title || t("mindmapUntitled") });
    const newCoord = getMindmapCoord(newMm.id);
    newCoord.revision = newMm.revision || null;
    newCoord.draft = { ...draft, id: newMm.id, title: draft.title || t("mindmapUntitled"), updatedAt: Date.now() };
    delete newCoord.draft.revision;
    newCoord.dirty = true;
    state.mindmaps.unshift(newCoord.draft);
    const payload = { mm: JSON.parse(JSON.stringify(newCoord.draft)) };
    if (newCoord.revision) payload.expectedRevision = newCoord.revision;
    const saved = await queueById(mindmapSaveQueue, newMm.id, () => invoke("save_mindmap", payload));
    newCoord.revision = saved.revision || newCoord.revision;
    newCoord.dirty = false;
    newCoord.draft = null;
    updateMindmapCoordStatus(newMm.id, "saved");
    const index = state.mindmaps.findIndex((item) => item.id === newMm.id);
    if (index >= 0) state.mindmaps[index] = saved;
    c.dirty = false; c.draft = null; c.conflictRevision = null; c.version++;
    updateMindmapCoordStatus(originalId, "");
    state.selectedMindmapId = newMm.id; state.selectedNodeId = "";
    return { ok: true, newId: newMm.id };
  } catch {
    if (newMm) updateMindmapCoordStatus(newMm.id, "failed");
    updateMindmapCoordStatus(originalId, "conflict");
    return { ok: false, newId: newMm?.id || "" };
  }
}

function snapshotCurrentNote() {
  const id = state.selectedId;
  if (!id || state.showTrash) return null;
  const note = state.notes.find((n) => n.id === id);
  if (!note) return null;
  return { id, title: note.title, body: note.body };
}

function snapshotCurrentMindmap() {
  const mm = getCurrentMindmap();
  return mm ? JSON.parse(JSON.stringify(mm)) : null;
}

export {
  noteCoords, mindmapCoords, getNoteCoord, getMindmapCoord,
  snapshotCurrentNote,
  snapshotCurrentMindmap,
  updateNoteCoordStatus, updateMindmapCoordStatus,
  syncNoteCoordToDisplay, syncMindmapCoordToDisplay,
  saveStatusText,
  queueById, waitForNoteSaves, waitForMindmapSaves,
  scheduleNoteSave, flushNoteSave, scheduleMindmapSave, flushMindmapSave,
  flushAllDirty,
  reloadLatestNote, saveAsNewNoteFromDraft,
  reloadLatestMindmap, saveAsNewMindmapFromDraft,
};
