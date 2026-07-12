#!/usr/bin/env node
// Stage 1.1: Save coordinator acceptance & regression tests
// Validates per-item debounce isolation, fast-switch data integrity,
// delete-during-save safety, rapid create uniqueness, cross-page flush.
// Uses real UI events through Chrome DevTools Protocol + real backend reloads.

import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const localPort = 26_000 + Math.floor(Math.random() * 8_000);
const debugPort = 34_000 + Math.floor(Math.random() * 8_000);
const baseUrl = `http://127.0.0.1:${localPort}`;
const runId = Date.now().toString(36);
const testPrefix = `AI_TEST_S1_${runId}`;
const chromePath = findChrome();

let server = null;
let chrome = null;
let userDataDir = "";
let client = null;
let failures = 0;

// ── helpers ──

function findChrome() {
  const envPath = process.env.CHROME_PATH;
  const candidates = [
    envPath,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
  ].filter(Boolean);
  return candidates.find((item) => existsSync(item));
}

function pass(name) { console.log(`PASS ${name}`); }
function fail(name, error) { failures += 1; console.error(`FAIL ${name}`); console.error(error?.stack || error); }

async function step(name, fn) {
  try { await fn(); pass(name); } catch (error) { fail(name, error); }
}

function assert(condition, message) { if (!condition) throw new Error(message); }

async function api(command, payload = {}) {
  const response = await fetch(`${baseUrl}/api/${command}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${command} failed with ${response.status}: ${text}`);
  return response.status === 204 || !text ? null : JSON.parse(text);
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForServer() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try { await api("get_settings"); return; } catch { await delay(250); }
  }
  throw new Error(`local-server did not become ready on ${baseUrl}`);
}

async function startServer() {
  execFileSync(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "build"], { cwd: root, stdio: "ignore" });
  server = spawn(process.execPath, ["local-server.mjs"], { cwd: root, env: { ...process.env, PORT: String(localPort) }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  server.stdout.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitForServer();
}

async function cleanupAllS1() {
  const removeNote = async (id) => { await api("delete_note", { id }).catch(() => {}); await api("delete_permanently", { id }).catch(() => {}); };
  const removeMindmap = async (id) => { await api("delete_mindmap", { id }).catch(() => {}); await api("delete_mindmap_permanently", { id }).catch(() => {}); };
  for (const note of await api("list_notes").catch(() => [])) if (note.title?.startsWith("AI_TEST_S1_")) await removeNote(note.id);
  for (const note of await api("list_trash").catch(() => [])) if (note.title?.startsWith("AI_TEST_S1_")) await api("delete_permanently", { id: note.id }).catch(() => {});
  for (const m of await api("list_mindmaps").catch(() => [])) if (m.title?.startsWith("AI_TEST_S1_")) await removeMindmap(m.id);
  for (const m of await api("list_mindmap_trash").catch(() => [])) if (m.title?.startsWith("AI_TEST_S1_")) await api("delete_mindmap_permanently", { id: m.id }).catch(() => {});
}

// ── Chrome / DevTools helpers ──

async function startChrome() {
  assert(chromePath, "Chrome/Edge not found. Set CHROME_PATH.");
  userDataDir = await mkdtemp(join(tmpdir(), "xg-s1-"));
  chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userDataDir}`, "about:blank"], { stdio: ["ignore","ignore","ignore"], windowsHide: true });
  const target = await waitForPageTarget();
  client = await CdpClient.connect(target.webSocketDebuggerUrl);
  client.on("Runtime.exceptionThrown", (event) => {
    const detail = event.exceptionDetails;
    const text = detail.text || detail.exception?.description || JSON.stringify(detail);
    console.error(`[browser] ${text}`);
  });
  client.on("Runtime.consoleAPICalled", (event) => {
    if (event.type === "error") {
      const msgs = event.args.map((a) => a.value || a.description || "").join(" ");
      console.error(`[browser console] ${msgs}`);
    }
  });
  await client.send("Page.enable");
  await client.send("Runtime.enable");
}

async function waitForPageTarget() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json());
      const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {}
    await delay(250);
  }
  throw new Error(`Chrome DevTools not ready on 127.0.0.1:${debugPort}`);
}

class CdpClient {
  static connect(url) {
    return new Promise((resolveClient, reject) => {
      const ws = new WebSocket(url);
      const client = new CdpClient(ws);
      ws.addEventListener("open", () => resolveClient(client), { once: true });
      ws.addEventListener("error", (e) => reject(e.error || new Error("WebSocket error")), { once: true });
    });
  }
  constructor(ws) { this.ws = ws; this.nextId = 1; this.pending = new Map(); this.handlers = new Map(); ws.addEventListener("message", (e) => this.handleMessage(e)); }
  handleMessage(event) {
    const msg = JSON.parse(event.data);
    if (msg.id && this.pending.has(msg.id)) { const { r, j } = this.pending.get(msg.id); this.pending.delete(msg.id); if (msg.error) j(new Error(msg.error.message)); else r(msg.result); return; }
    if (msg.method && this.handlers.has(msg.method)) for (const h of this.handlers.get(msg.method)) h(msg.params || {});
  }
  on(method, handler) { if (!this.handlers.has(method)) this.handlers.set(method, []); this.handlers.get(method).push(handler); }
  send(method, params = {}) { const id = this.nextId++; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((r, j) => { this.pending.set(id, { r, j }); }); }
  close() { this.ws.close(); }
}

async function evaluate(expression) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails;
    const text = detail.text || detail.exception?.description || JSON.stringify(detail);
    throw new Error(`Browser eval failed: ${text}`);
  }
  return result.result?.value;
}

async function waitFor(expression, message, timeout = 12_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await evaluate(`Boolean(${expression})`)) return; await delay(100); }
  throw new Error(message);
}

async function click(selector) {
  const clicked = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
  assert(clicked, `Missing clickable element: ${selector}`);
}

async function pressKey(key, code, windowsVirtualKeyCode) {
  await evaluate("document.activeElement?.blur?.(); document.body.tabIndex = -1; document.body.focus();");
  const params = { key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode };
  await client.send("Input.dispatchKeyEvent", { type: "keyDown", ...params });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", ...params });
}

async function navigateToApp() {
  await client.send("Page.navigate", { url: baseUrl });
  await waitFor("document.readyState === 'complete' && document.querySelector('#app')", "App shell did not load");
}

async function reloadApp() {
  await client.send("Page.reload");
  await waitFor("document.readyState === 'complete' && document.querySelector('#app')", "App shell did not reload");
}

async function navigateToNotesPage() {
  await click('[data-page="notes"]');
  await waitFor("document.querySelector('#search')", "Notes page not interactive");
}

async function navigateToMindmapsPage() {
  await click('[data-page="mindmaps"]');
  await waitFor("document.querySelector('#newMindmap') || document.querySelector('.mm-toolbar')", "Mindmap page not interactive");
}

async function selectNote(id) {
  await click(`.note-row[data-id="${id}"] .item`);
  await waitFor(`document.querySelector('.note-row.active[data-id="${id}"]') && document.querySelector('#title')`, `Note ${id} not selected`);
}

async function switchToEditMode() {
  if (await evaluate("Boolean(document.querySelector('#editMode.active'))")) return;
  await click("#editMode");
  await waitFor("document.querySelector('#body') && document.querySelector('#editMode.active')", "Edit mode did not engage");
}

async function typeNoteTitle(title) {
  await evaluate(`(() => {
    const t = document.querySelector('#title');
    t.value = ${JSON.stringify(title)};
    t.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

async function typeNoteBody(body) {
  await evaluate(`(() => {
    const b = document.querySelector('#body');
    if (!b) throw new Error('body textarea missing — not in Edit mode');
    b.value = ${JSON.stringify(body)};
    b.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

async function readNoteTitle() {
  return await evaluate(`document.querySelector('#title')?.value || ''`);
}

async function readNoteBody() {
  return await evaluate(`document.querySelector('#body')?.value || (document.querySelector('#mdPreview')?.textContent || '')`);
}

// Test 1: Edit note A, fast-switch to note B within debounce, reload verify
async function fastNoteSwitchFlow() {
  await reloadApp();
  await delay(800);
  await navigateToNotesPage();

  // Create note A (opens in Edit mode)
  await click("#new, #emptyNew");
  await waitFor("document.querySelector('#body') && document.querySelector('#title')", "Note A did not open");
  const noteAId = await evaluate("document.querySelector('.note-row.active')?.dataset.id || ''");
  assert(noteAId, "Note A missing id");
  await typeNoteTitle(`${testPrefix}_TITLE_A`);
  await typeNoteBody(`${testPrefix}_A_BODY`);

  // Wait for save and creation guard to settle
  await delay(2000);

  // Create note B — verify it appears
  const countBeforeB = await evaluate("document.querySelectorAll('.note-row').length");
  await click("#new");
  await waitFor(`document.querySelectorAll('.note-row').length > ${countBeforeB}`, "Note B did not appear after click");
  await waitFor("document.querySelector('#body') && document.querySelector('#title')", "Note B not in Edit mode");
  const noteBId = await evaluate("document.querySelector('.note-row.active')?.dataset.id || ''");
  assert(noteBId && noteBId !== noteAId, `Note B id: "${noteBId}" matches A: "${noteAId}"`);
  await typeNoteTitle(`${testPrefix}_TITLE_B_INIT`);
  await delay(1200);

  // Verify both notes exist via API
  const allNotes = await api("list_notes");
  assert(allNotes.find((n) => n.id === noteAId), "Note A not in API");
  assert(allNotes.find((n) => n.id === noteBId), "Note B not in API");

  // Refresh page to ensure consistent UI state
  await navigateToNotesPage();
  await delay(300);

  // Edit note A: select it (opens Preview), switch to Edit, edit
  await selectNote(noteAId);
  await switchToEditMode();

  const contentA = `${testPrefix}_A_content_UPDATED`;
  await typeNoteTitle(`${testPrefix}_TITLE_A_v2`);
  await typeNoteBody(contentA);

  // Immediately switch to note B (within 500ms debounce!)
  await click(`.note-row[data-id="${noteBId}"] .item`);
  await waitFor(`document.querySelector('.note-row.active[data-id="${noteBId}"]')`, "Note B not selected after switch");

  // Edit note B briefly
  await switchToEditMode();
  await typeNoteTitle(`${testPrefix}_TITLE_B`);
  await delay(100);

  // Wait for all saves to complete
  await delay(2500);

  // Reload page to force fresh data load from backend
  await reloadApp();
  await delay(500);
  await navigateToNotesPage();
  await delay(500);

  // Verify note A content persisted
  await selectNote(noteAId);
  await switchToEditMode();
  const aTitle = await readNoteTitle();
  const aBody = await readNoteBody();
  assert(aTitle === `${testPrefix}_TITLE_A_v2`, `Note A title mismatch after fast-switch reload: got "${aTitle}"`);
  assert(aBody === contentA, `Note A body mismatch after fast-switch reload: expected "${contentA}" got "${aBody}"`);

  // Verify note B not overwritten
  await selectNote(noteBId);
  await switchToEditMode();
  const bTitle = await readNoteTitle();
  const bBody = await readNoteBody();
  assert(bTitle === `${testPrefix}_TITLE_B`, `Note B title overwritten: got "${bTitle}"`);
  assert(!bBody.includes(contentA), `Note B body contaminated by A content`);
}

// Test 2: Edit mindmap A, fast-switch to mindmap B, reload verify
async function fastMindmapSwitchFlow() {
  await reloadApp();
  await delay(800);
  await navigateToMindmapsPage();

  // Create mindmap A
  await click("#newMindmap");
  await waitFor("document.querySelector('#mmTitle')", "Mindmap A did not open");
  const mmAId = await evaluate("document.querySelector('.mindmap-row.active .mindmap-item')?.dataset.id || ''");
  assert(mmAId, "Mindmap A missing id");

  // Wait for creation to fully settle
  await delay(2000);

  // Create mindmap B via API verification
  const countBefore = await evaluate("document.querySelectorAll('.mindmap-row').length");
  await click("#newMindmap");
  await waitFor(`document.querySelectorAll('.mindmap-row').length > ${countBefore}`, "Mindmap B row did not appear");
  await waitFor("document.querySelector('#mmTitle')", "Mindmap B not opened");
  const allMaps = await api("list_mindmaps");
  const mmBId = allMaps.find((m) => m.id !== mmAId)?.id;
  assert(mmBId, `Cannot find mindmap B in API (${allMaps.length} total)`);
  assert(mmBId !== mmAId, `Mindmap B id matches A: ${mmBId}`);

  // Select mindmap A and edit
  await click(`.mindmap-row .mindmap-item[data-id="${mmAId}"]`);
  await waitFor(`document.querySelector('.mindmap-row.active .mindmap-item[data-id="${mmAId}"]') && document.querySelector('#mmTitle')`, "Mindmap A not selected");
  await delay(200);

  await evaluate(`(() => {
    const t = document.querySelector('#mmTitle');
    t.value = ${JSON.stringify(`${testPrefix}_MM_TITLE_A`)};
    t.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);

  // Add a root node
  await pressKey("Tab", "Tab", 9);
  await waitFor("document.querySelector('.mm-edit-input')", "Root node editor did not open");
  await evaluate(`(() => {
    const inp = document.querySelector('.mm-edit-input');
    inp.value = 'Root A';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
  })()`);
  await waitFor("Array.from(document.querySelectorAll('.mm-text')).some(n => n.textContent === 'Root A')", "Root A not committed");
  await delay(300);

  // Add child node
  await pressKey("Tab", "Tab", 9);
  await waitFor("document.querySelector('.mm-edit-input')", "Child node editor did not open");
  await evaluate(`(() => {
    const inp = document.querySelector('.mm-edit-input');
    inp.value = 'Child A';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
  })()`);
  await waitFor("Array.from(document.querySelectorAll('.mm-text')).some(n => n.textContent === 'Child A')", "Child A not committed");

  // Immediately switch to mindmap B (within debounce)
  await click(`.mindmap-row .mindmap-item[data-id="${mmBId}"]`);
  await waitFor(`document.querySelector('.mindmap-row.active .mindmap-item[data-id="${mmBId}"]')`, "Mindmap B not selected");

  // Edit B briefly
  await evaluate(`(() => {
    const t = document.querySelector('#mmTitle');
    t.value = ${JSON.stringify(`${testPrefix}_MM_TITLE_B`)};
    t.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);

  // Wait for saves
  await delay(2500);

  // Reload verify
  await reloadApp();
  await delay(500);
  await navigateToMindmapsPage();
  await delay(500);

  await click(`.mindmap-row .mindmap-item[data-id="${mmAId}"]`);
  await waitFor(`document.querySelector('.mindmap-row.active .mindmap-item[data-id="${mmAId}"]') && document.querySelector('#mmTitle')`, "Mindmap A not selectable after reload");
  const aTitle = await evaluate(`document.querySelector('#mmTitle')?.value || ''`);
  assert(aTitle === `${testPrefix}_MM_TITLE_A`, `Mindmap A title mismatch: got "${aTitle}"`);
  const aNodes = await evaluate(`Array.from(document.querySelectorAll('.mm-text')).map(n => n.textContent)`);
  assert(aNodes.includes("Root A"), `Mindmap A missing root node after reload`);
  assert(aNodes.includes("Child A"), `Mindmap A missing child node after reload`);

  await click(`.mindmap-row .mindmap-item[data-id="${mmBId}"]`);
  await waitFor(`document.querySelector('.mindmap-row.active .mindmap-item[data-id="${mmBId}"]') && document.querySelector('#mmTitle')`, "Mindmap B not selectable after reload");
  const bTitle = await evaluate(`document.querySelector('#mmTitle')?.value || ''`);
  assert(bTitle === `${testPrefix}_MM_TITLE_B`, `Mindmap B title overwritten: got "${bTitle}"`);
  const bNodeCount = await evaluate(`document.querySelectorAll('.mm-text').length`);
  assert(bNodeCount === 0, `Mindmap B has ${bNodeCount} nodes but should have 0`);
}

// Test 3: Edit note then immediately delete — no resurrection
async function deleteNoteDuringSaveFlow() {
  await reloadApp();
  await delay(800);
  await navigateToNotesPage();
  await delay(300);

  await click("#new, #emptyNew");
  await waitFor("document.querySelector('#title') && document.querySelector('#body')", "Note not created or not in Edit");
  const noteId = await evaluate("document.querySelector('.note-row.active')?.dataset.id || ''");
  assert(noteId, "Note missing id");

  await typeNoteTitle(`${testPrefix}_DEL_NOTE`);
  await typeNoteBody('delete-me-content');

  // Ensure the input events have been processed and the save is scheduled
  await delay(100);

  // Delete immediately (triggers flush-save-then-delete)
  await click(".note-row.active .delete-note");
  // Wait for the note to disappear from the active DOM list
  await delay(600);
  // Verify via API that the note moved to trash
  await delay(500);

  const active = await api("list_notes");
  assert(!active.find((n) => n.id === noteId), "Deleted note resurrected in active list");
  const trash = await api("list_trash");
  assert(trash.find((n) => n.id === noteId), "Deleted note not found in trash");

  await reloadApp();
  await delay(500);
  await navigateToNotesPage();
  await delay(500);

  const active2 = await api("list_notes");
  assert(!active2.find((n) => n.id === noteId), "Deleted note resurrected after reload");
  const trash2 = await api("list_trash");
  assert(trash2.find((n) => n.id === noteId), "Deleted note disappeared from trash after reload");
}

// Test 4: Edit mindmap then immediately delete — no resurrection
async function deleteMindmapDuringSaveFlow() {
  await reloadApp();
  await delay(800);
  await navigateToMindmapsPage();
  await delay(300);

  // Get the mindmap count before creating and capture new mindmap from API
  const beforeMaps = await api("list_mindmaps");
  const beforeIds = new Set(beforeMaps.map((m) => m.id));

  await click("#newMindmap");
  await delay(500);

  // Retry if creation was blocked by creatingMindmap flag
  let newMm = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const afterMaps = await api("list_mindmaps");
    newMm = afterMaps.find((m) => !beforeIds.has(m.id));
    if (newMm) break;
    if (attempt < 2) {
      await click("#newMindmap");
      await delay(500);
    }
  }
  assert(newMm, "No new mindmap found in API after creation");
  const mmId = newMm.id;

  await waitFor("document.querySelector('#mmTitle')", "Mindmap editor not visible");

  await evaluate(`(() => {
    const t = document.querySelector('#mmTitle');
    t.value = ${JSON.stringify(`${testPrefix}_DEL_MM`)};
    t.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);

  await pressKey("Tab", "Tab", 9);
  await waitFor("document.querySelector('.mm-edit-input')", "Node editor not open");
  await evaluate(`(() => {
    const inp = document.querySelector('.mm-edit-input');
    inp.value = 'will-be-deleted';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
  })()`);
  await delay(300);

  // Verify the delete button exists and has the correct ID
  const delBtnId = await evaluate(`document.querySelector('.mindmap-row.active .mindmap-delete')?.dataset.delete || ''`);
  assert(delBtnId === mmId, `Active delete button id "${delBtnId}" does not match mindmap id "${mmId}"`);

  await click(`.mindmap-delete[data-delete="${mmId}"]`);
  await delay(1500);

  // Diagnostic: check what the delete did
  const activeDiag = await api("list_mindmaps");
  const inActiveNow = activeDiag.find((m) => m.id === mmId);
  const trashDiag = await api("list_mindmap_trash");
  const inTrashNow = trashDiag.find((m) => m.id === mmId);
  if (inActiveNow) {
    await api("delete_mindmap", { id: mmId }).catch(() => {});
    await delay(200);
    const activeRetry = await api("list_mindmaps");
    const trashRetry = await api("list_mindmap_trash");
    console.error(`  [diag] beforeRetry: inActive=${Boolean(inActiveNow)} inTrash=${Boolean(inTrashNow)}`);
    console.error(`  [diag] afterRetry: inActive=${Boolean(activeRetry.find(m=>m.id===mmId))} inTrash=${Boolean(trashRetry.find(m=>m.id===mmId))}`);
  }
  assert(!inActiveNow, `Deleted mindmap (${mmId}) still in active list. In trash: ${Boolean(inTrashNow)}`);
  assert(inTrashNow, `Deleted mindmap (${mmId}) not found in trash`);

  await reloadApp();
  await delay(500);
  await navigateToMindmapsPage();
  await delay(500);

  const active2 = await api("list_mindmaps");
  assert(!active2.find((m) => m.id === mmId), "Deleted mindmap resurrected after reload");
  const trash2 = await api("list_mindmap_trash");
  assert(trash2.find((m) => m.id === mmId), "Deleted mindmap disappeared from trash after reload");
}

// Test 5: Rapid multi-create — all IDs unique
async function rapidMultiCreateFlow() {
  await navigateToNotesPage();

  // Rapidly create 5 notes
  for (let i = 0; i < 5; i++) {
    await click("#new");
    await delay(30); // minimal delay to allow server roundtrip
  }
  await delay(1500);

  const notes = await api("list_notes");
  const s1Notes = notes.filter((n) => n.title?.startsWith("AI_TEST_S1_") || n.title === "Untitled" || n.title === "未命名想法");
  const noteIds = s1Notes.map((n) => n.id);
  assert(new Set(noteIds).size === noteIds.length, `Duplicate note IDs found: ${noteIds}`);

  // Rapidly create 5 mindmaps
  await navigateToMindmapsPage();
  await delay(300);
  for (let i = 0; i < 5; i++) {
    await click("#newMindmap");
    await delay(30);
  }
  await delay(1500);

  const maps = await api("list_mindmaps");
  const s1Maps = maps.filter((m) => m.title?.startsWith("AI_TEST_S1_") || m.title === "Untitled" || m.title === "未命名导图");
  const mapIds = s1Maps.map((m) => m.id);
  assert(new Set(mapIds).size === mapIds.length, `Duplicate mindmap IDs found: ${mapIds}`);
}

// Test 6: Cross-page flush — edit note, switch to mindmaps, reload, verify
async function crossPageFlushFlow() {
  await reloadApp();
  await delay(800);
  await navigateToNotesPage();
  await delay(300);

  await click("#new, #emptyNew");
  await waitFor("document.querySelector('#title') && document.querySelector('#body')", "Note not created in Edit mode");
  const noteId = await evaluate("document.querySelector('.note-row.active')?.dataset.id || ''");
  assert(noteId, "Note missing id");

  const crossTitle = `${testPrefix}_CROSS_NOTE`;
  const crossBody = `${testPrefix}_cross_page_body`;
  await typeNoteTitle(crossTitle);
  await typeNoteBody(crossBody);

  // Immediately switch to mindmaps page (triggers setPage flush)
  await click('[data-page="mindmaps"]');
  await waitFor("document.querySelector('#newMindmap') || document.querySelector('.mm-toolbar')", "Mindmap page not open");
  await delay(2000);

  // Reload and navigate back to notes
  await reloadApp();
  await delay(500);
  await navigateToNotesPage();
  await delay(500);

  await selectNote(noteId);
  await switchToEditMode();
  const title = await readNoteTitle();
  const body = await readNoteBody();
  assert(title === crossTitle, `Cross-page flush failed: title got "${title}", expected "${crossTitle}"`);
  assert(body === crossBody, `Cross-page flush failed: body got "${body}", expected "${crossBody}"`);
}

// ── Run ──

try {
  await startServer();
  await cleanupAllS1();
  await startChrome();
  await navigateToApp();

  await step("fast note switch within debounce, reload verify", fastNoteSwitchFlow);
  await step("fast mindmap switch within debounce, reload verify", fastMindmapSwitchFlow);
  await step("delete note during save — no resurrection", deleteNoteDuringSaveFlow);
  await step("delete mindmap during save — no resurrection", deleteMindmapDuringSaveFlow);
  await step("rapid multi-create — unique IDs", rapidMultiCreateFlow);
  await step("cross-page flush — edit then switch page, reload verify", crossPageFlushFlow);
} finally {
  await cleanupAllS1().catch(() => {});
  if (client) client.close();
  if (chrome) chrome.kill();
  if (server) server.kill();
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
}

if (failures > 0) {
  console.error(`Stage 1.1 regression test failed with ${failures} failure(s).`);
  process.exit(1);
}
console.log("Stage 1.1 regression test passed.");
