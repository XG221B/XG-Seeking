import { t } from './i18n.js';
import { escapeHtml, formatDate, generateId, isEditorTarget } from './helpers.js';
import { invoke } from './api.js';
import { state, pageLoadToken, mindmapSaveQueue, app } from './state.js';
import { mindmapCoords, getMindmapCoord, scheduleMindmapSave, flushMindmapSave, waitForMindmapSaves, syncMindmapCoordToDisplay, updateSaveStatus, saveStatusText } from './coordinator.js';

// ── Mindmaps ──

function renderMindmaps() {
  syncMindmapCoordToDisplay();
  if (state.pageLoading && state.mindmaps.length === 0 && state.mindmapTrash.length === 0) {
    app.innerHTML = `<section class="notes"><div class="empty"><h2>${t("loadingMessage")}</h2></div></section>`;
    return;
  }
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
        <span class="save-status ${state.mindmapSaveStatus === "failed" ? "failed" : ""}" id="mindmapSaveStatus">${saveStatusText(state.mindmapSaveStatus)}</span>
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
    btn.addEventListener("click", async () => {
      const targetId = btn.dataset.id;
      if (targetId === state.selectedMindmapId) return;
      if (state.selectedMindmapId && !state.showMindmapTrash) {
        await flushMindmapSave(state.selectedMindmapId);
      }
      state.selectedMindmapId = targetId;
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
      const itemTitle = document.querySelector(`.mindmap-item[data-id="${mm.id}"] strong`);
      if (itemTitle) itemTitle.textContent = mm.title;
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

export function mindmapKeyHandler(e) {
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
    const newNode = { id: generateId(), text: t("mindmapNodeNew"), collapsed: false, children: [] };
    mm.nodes.push(newNode);
    state.selectedNodeId = newNode.id;
    state.editingNode = true;
    scheduleMindmapSave(mm);
    renderMindmaps();
    return;
  }
  const newNode = { id: generateId(), text: t("mindmapNodeNew"), collapsed: false, children: [] };
  node.children.push(newNode);
  node.collapsed = false;
  state.selectedNodeId = newNode.id;
  state.editingNode = true;
  scheduleMindmapSave(mm);
  renderMindmaps();
}

function addSiblingNode(mm) {
  if (!state.selectedNodeId) return addChildNode(mm);
  const topIdx = mm.nodes.findIndex((n) => n.id === state.selectedNodeId);
  if (topIdx >= 0) {
    const newNode = { id: generateId(), text: t("mindmapNodeNew"), collapsed: false, children: [] };
    mm.nodes.splice(topIdx + 1, 0, newNode);
    state.selectedNodeId = newNode.id;
    state.editingNode = true;
    scheduleMindmapSave(mm);
    renderMindmaps();
    return;
  }
  const parent = findParentInList(mm.nodes, state.selectedNodeId);
  if (!parent) return addChildNode(mm);
  const idx = parent.children.findIndex((c) => c.id === state.selectedNodeId);
  const newNode = { id: generateId(), text: t("mindmapNodeNew"), collapsed: false, children: [] };
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

// ── Mindmap API ──

async function loadMindmaps(token = pageLoadToken.current) {
  try {
    const mindmaps = await invoke("list_mindmaps");
    if (token !== pageLoadToken.current || state.page !== "mindmaps") return;

    state.mindmaps = mindmaps;
    for (const m of mindmaps) {
      if (m.revision) { const c = getMindmapCoord(m.id); c.revision = m.revision; }
    }
    state.showMindmapTrash = false;
    if (!state.selectedMindmapId && state.mindmaps[0]) state.selectedMindmapId = state.mindmaps[0].id;
    await loadMindmapTrashSilent(token);
    if (token !== pageLoadToken.current || state.page !== "mindmaps") return;
    renderMindmaps();
  } catch (e) {
    if (token !== pageLoadToken.current || state.page !== "mindmaps") return;
    app.innerHTML = `<section class="placeholder"><div class="placeholder-inner"><h1>${t("loadFailed")}</h1><div class="quiet">${escapeHtml(e)}</div></div></section>`;
  }
}

async function loadMindmapTrashSilent(token = pageLoadToken.current) {
  try {
    const mindmapTrash = await invoke("list_mindmap_trash");
    if (token !== pageLoadToken.current || state.page !== "mindmaps") return;
    state.mindmapTrash = mindmapTrash;
  } catch {}
}

let creatingMindmap = false;

async function createMindmap() {
  if (creatingMindmap) return;
  creatingMindmap = true;
  pageLoadToken.current += 1;
  let mm;
  try { mm = await invoke("create_mindmap", { title: t("mindmapUntitled") }); } catch (e) { alert(e); creatingMindmap = false; return; }
  state.mindmaps.unshift(mm);
  if (mm.revision) { const c = getMindmapCoord(mm.id); c.revision = mm.revision; }
  state.selectedMindmapId = mm.id;
  state.selectedNodeId = "";
  state.editingNode = false;
  creatingMindmap = false;
  renderMindmaps();
}

async function saveMindmap(mm, options = {}) {
  if (!mm) return true;
  const c = getMindmapCoord(mm.id);
  c.draft = JSON.parse(JSON.stringify(mm));
  c.dirty = true;
  return flushMindmapSave(mm.id).then((ok) => {
    if (!ok && options.showAlert) alert(t("saveFailed"));
    return ok;
  });
}

async function trashMindmap(id) {
  const mm = state.mindmaps.find((item) => item.id === id);
  if (mm) {
    const saved = await flushMindmapSave(id);
    if (!saved) { alert(t("saveFailed")); return; }
  }
  const c = getMindmapCoord(id);
  c.deleted = true;
  clearTimeout(c.timer);
  await waitForMindmapSaves(id);
  try { await invoke("delete_mindmap", { id }); } catch (e) { alert(e); c.deleted = false; return; }
  state.mindmaps = state.mindmaps.filter((m) => m.id !== id);
  mindmapCoords.delete(id);
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

export {
  renderMindmaps,
  renderMindmapCanvas,
  renderNodes,
  renderNode,
  bindMindmapEvents,
  removeContextMenu,
  showContextMenu,
  getCurrentMindmap,
  findNodeInList,
  findNode,
  findParentInList,
  findParent,
  toggleNode,
  addChildNode,
  addSiblingNode,
  deleteNode,
  loadMindmaps,
  loadMindmapTrashSilent,
  createMindmap,
  toggleMindmapTrashView,
  clearAllMindmapTrash,
  trashMindmap,
  restoreMindmap,
};
