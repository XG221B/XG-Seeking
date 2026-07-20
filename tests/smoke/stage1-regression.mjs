#!/usr/bin/env node
import { rm } from "node:fs/promises";
import { startLocalServer, api, findChrome, startChrome, navigate, delay, cleanupTestData, pass, fail, step, click, waitFor, evaluate, pressKey, assertNoBrowserErrors } from "./helper.mjs";

const runId = Date.now().toString(36);
const testPrefix = `AI_TEST_S1_${runId}`;
let serverProc = null;
let chromeProc = null;
let client = null;
let userDataDir = "";
let baseUrl = "";
let failures = 0;

function assert(condition, message) { if (!condition) throw new Error(message); }

async function navigateToNotesPage() {
  await click(client, '[data-page="notes"]');
  await waitFor(client, "document.querySelector('#search')", "Notes page not interactive");
}
async function navigateToMindmapsPage() {
  await click(client, '[data-page="mindmaps"]');
  await waitFor(client, "document.querySelector('#newMindmap') || document.querySelector('.mm-toolbar')", "Mindmap page not interactive");
}
async function selectNote(id) {
  await click(client, `.note-row[data-id="${id}"] .item`);
  await waitFor(client, `document.querySelector('.note-row.active[data-id="${id}"]') && document.querySelector('#title')`, `Note ${id} not selected`);
}
async function switchToEditMode() {
  if (await evaluate(client, "Boolean(document.querySelector('#editMode.active'))")) return;
  await click(client, "#editMode");
  await waitFor(client, "document.querySelector('#body') && document.querySelector('#editMode.active')", "Edit mode not engaged");
}
async function typeNoteTitle(title) {
  await evaluate(client, `(() => { const t = document.querySelector('#title'); t.value = ${JSON.stringify(title)}; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
}
async function typeNoteBody(body) {
  await evaluate(client, `(() => { const b = document.querySelector('#body'); if (!b) throw new Error('body missing'); b.value = ${JSON.stringify(body)}; b.dispatchEvent(new Event('input', { bubbles: true })); })()`);
}
async function readNoteTitle() { return await evaluate(client, "document.querySelector('#title')?.value || ''"); }
async function readNoteBody() { return await evaluate(client, "document.querySelector('#body')?.value || (document.querySelector('#mdPreview')?.textContent || '')"); }

async function cleanupAllS1() {
  await cleanupTestData(baseUrl, "AI_TEST_S1_");
}

async function emptyStateNotStuckLoading() {
  await navigate(client, baseUrl);
  await delay(800);
  await navigateToNotesPage();
  await waitFor(client, "document.querySelector('.note-row') || document.querySelector('#emptyNew') || document.querySelector('.message') || document.querySelector('#new')", "Notes stuck");
  const notesLoading = await evaluate(client, "document.body.textContent.includes('Loading') || document.body.textContent.includes('加载中')");
  assert(!notesLoading, "Notes shows loading text");
  await navigateToMindmapsPage();
  await waitFor(client, "document.querySelector('.mindmap-row') || document.querySelector('#newMindmap') || document.querySelector('.message')", "Mindmaps stuck");
  const mmLoading = await evaluate(client, "document.body.textContent.includes('Loading') || document.body.textContent.includes('加载中')");
  assert(!mmLoading, "Mindmaps shows loading text");
}

async function fastNoteSwitchFlow() {
  await navigate(client, baseUrl);
  await delay(800);
  await navigateToNotesPage();
  await click(client, "#new, #emptyNew");
  await waitFor(client, "document.querySelector('#body') && document.querySelector('#title')", "Note A not created");
  const noteAId = await evaluate(client, "document.querySelector('.note-row.active')?.dataset.id || ''");
  assert(noteAId, "Note A missing id");
  await typeNoteTitle(`${testPrefix}_TITLE_A`);
  await typeNoteBody(`${testPrefix}_A_BODY`);
  await delay(2000);
  const countBeforeB = await evaluate(client, "document.querySelectorAll('.note-row').length");
  await click(client, "#new");
  await waitFor(client, `document.querySelectorAll('.note-row').length > ${countBeforeB}`, "Note B not created");
  await waitFor(client, "document.querySelector('#body') && document.querySelector('#title')", "Note B not edit");
  const noteBId = await evaluate(client, "document.querySelector('.note-row.active')?.dataset.id || ''");
  assert(noteBId && noteBId !== noteAId, "Note B id matches A");
  await typeNoteTitle(`${testPrefix}_TITLE_B_INIT`);
  await delay(1200);
  const allNotes = await api(baseUrl, "list_notes");
  assert(allNotes.find((n) => n.id === noteAId), "Note A not in API");
  assert(allNotes.find((n) => n.id === noteBId), "Note B not in API");
  await navigateToNotesPage();
  await delay(300);
  await selectNote(noteAId);
  await switchToEditMode();
  const contentA = `${testPrefix}_A_content_UPDATED`;
  await typeNoteTitle(`${testPrefix}_TITLE_A_v2`);
  await typeNoteBody(contentA);
  await click(client, `.note-row[data-id="${noteBId}"] .item`);
  await waitFor(client, `document.querySelector('.note-row.active[data-id="${noteBId}"]')`, "Note B not selected");
  await switchToEditMode();
  await typeNoteTitle(`${testPrefix}_TITLE_B`);
  await delay(100);
  await delay(2500);
  await navigate(client, baseUrl);
  await delay(500);
  await navigateToNotesPage();
  await delay(500);
  await selectNote(noteAId);
  await switchToEditMode();
  const aTitle = await readNoteTitle();
  const aBody = await readNoteBody();
  assert(aTitle === `${testPrefix}_TITLE_A_v2`, `Note A title mismatch: "${aTitle}"`);
  assert(aBody === contentA, `Note A body mismatch`);
  await selectNote(noteBId);
  await switchToEditMode();
  const bTitle = await readNoteTitle();
  const bBody = await readNoteBody();
  assert(bTitle === `${testPrefix}_TITLE_B`, `Note B title overwritten: "${bTitle}"`);
  assert(!bBody.includes(contentA), "Note B body contaminated");
}

async function fastMindmapSwitchFlow() {
  await navigate(client, baseUrl);
  await delay(800);
  await navigateToMindmapsPage();
  await click(client, "#newMindmap");
  await waitFor(client, "document.querySelector('#mmTitle')", "Mindmap A not open");
  const mmAId = await evaluate(client, "document.querySelector('.mindmap-row.active .mindmap-item')?.dataset.id || ''");
  assert(mmAId, "Mindmap A missing id");
  await delay(2000);
  const countBefore = await evaluate(client, "document.querySelectorAll('.mindmap-row').length");
  await click(client, "#newMindmap");
  await waitFor(client, `document.querySelectorAll('.mindmap-row').length > ${countBefore}`, "Mindmap B not created");
  await waitFor(client, "document.querySelector('#mmTitle')", "Mindmap B not open");
  const allMaps = await api(baseUrl, "list_mindmaps");
  const mmBId = allMaps.find((m) => m.id !== mmAId)?.id;
  assert(mmBId, "Cannot find mindmap B in API");
  assert(mmBId !== mmAId, "Mindmap B id matches A");

  await click(client, `.mindmap-row .mindmap-item[data-id="${mmAId}"]`);
  await waitFor(client, `document.querySelector('.mindmap-row.active .mindmap-item[data-id="${mmAId}"]') && document.querySelector('#mmTitle')`, "Mindmap A not selected");
  await delay(200);
  await evaluate(client, `(() => { const t = document.querySelector('#mmTitle'); t.value = ${JSON.stringify(`${testPrefix}_MM_TITLE_A`)}; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await pressKey(client, "Tab", "Tab", 9);
  await waitFor(client, "document.querySelector('.mm-edit-input')", "Root edit not open");
  await evaluate(client, `(() => { const inp = document.querySelector('.mm-edit-input'); inp.value = 'Root A'; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })); })()`);
  await waitFor(client, "Array.from(document.querySelectorAll('.mm-text')).some(n => n.textContent === 'Root A')", "Root A not committed");
  await delay(300);
  await pressKey(client, "Tab", "Tab", 9);
  await waitFor(client, "document.querySelector('.mm-edit-input')", "Child edit not open");
  await evaluate(client, `(() => { const inp = document.querySelector('.mm-edit-input'); inp.value = 'Child A'; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })); })()`);
  await waitFor(client, "Array.from(document.querySelectorAll('.mm-text')).some(n => n.textContent === 'Child A')", "Child A not committed");
  await click(client, `.mindmap-row .mindmap-item[data-id="${mmBId}"]`);
  await waitFor(client, `document.querySelector('.mindmap-row.active .mindmap-item[data-id="${mmBId}"]')`, "Mindmap B not selected");
  await evaluate(client, `(() => { const t = document.querySelector('#mmTitle'); t.value = ${JSON.stringify(`${testPrefix}_MM_TITLE_B`)}; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await delay(2500);
  await navigate(client, baseUrl);
  await delay(500);
  await navigateToMindmapsPage();
  await delay(500);
  await click(client, `.mindmap-row .mindmap-item[data-id="${mmAId}"]`);
  await waitFor(client, `document.querySelector('.mindmap-row.active .mindmap-item[data-id="${mmAId}"]') && document.querySelector('#mmTitle')`, "Mindmap A not selectable");
  const aTitle = await evaluate(client, "document.querySelector('#mmTitle')?.value || ''");
  assert(aTitle === `${testPrefix}_MM_TITLE_A`, `Mindmap A title: "${aTitle}"`);
  const aNodes = await evaluate(client, "Array.from(document.querySelectorAll('.mm-text')).map(n => n.textContent)");
  assert(aNodes.includes("Root A"), "Mindmap A missing root");
  assert(aNodes.includes("Child A"), "Mindmap A missing child");
  await click(client, `.mindmap-row .mindmap-item[data-id="${mmBId}"]`);
  await waitFor(client, `document.querySelector('.mindmap-row.active .mindmap-item[data-id="${mmBId}"]') && document.querySelector('#mmTitle')`, "Mindmap B not selectable");
  const bTitle = await evaluate(client, "document.querySelector('#mmTitle')?.value || ''");
  assert(bTitle === `${testPrefix}_MM_TITLE_B`, `Mindmap B title: "${bTitle}"`);
  const bNodeCount = await evaluate(client, "document.querySelectorAll('.mm-text').length");
  assert(bNodeCount === 0, `Mindmap B has ${bNodeCount} nodes`);
}

async function deleteNoteDuringSaveFlow() {
  await navigate(client, baseUrl);
  await delay(800);
  await navigateToNotesPage();
  await delay(300);
  await click(client, "#new, #emptyNew");
  await waitFor(client, "document.querySelector('#title') && document.querySelector('#body')", "Note not created");
  const noteId = await evaluate(client, "document.querySelector('.note-row.active')?.dataset.id || ''");
  assert(noteId, "Note missing id");
  await typeNoteTitle(`${testPrefix}_DEL_NOTE`);
  await typeNoteBody("delete-me-content");
  await delay(100);
  await click(client, ".note-row.active .delete-note");
  await delay(1100);
  const active = await api(baseUrl, "list_notes");
  assert(!active.find((n) => n.id === noteId), "Deleted note resurrected");
  const trash = await api(baseUrl, "list_trash");
  assert(trash.find((n) => n.id === noteId), "Deleted note not in trash");
  await navigate(client, baseUrl);
  await delay(500);
  await navigateToNotesPage();
  await delay(500);
  const active2 = await api(baseUrl, "list_notes");
  assert(!active2.find((n) => n.id === noteId), "Note resurrected after reload");
  const trash2 = await api(baseUrl, "list_trash");
  assert(trash2.find((n) => n.id === noteId), "Note disappeared from trash after reload");
}

async function deleteMindmapDuringSaveFlow() {
  await navigate(client, baseUrl);
  await delay(800);
  await navigateToMindmapsPage();
  await delay(300);
  const beforeMaps = await api(baseUrl, "list_mindmaps");
  const beforeIds = new Set(beforeMaps.map((m) => m.id));
  await click(client, "#newMindmap");
  await delay(500);
  let newMm = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const afterMaps = await api(baseUrl, "list_mindmaps");
    newMm = afterMaps.find((m) => !beforeIds.has(m.id));
    if (newMm) break;
    if (attempt < 2) { await click(client, "#newMindmap"); await delay(500); }
  }
  assert(newMm, "No new mindmap found after creation");
  const mmId = newMm.id;
  await waitFor(client, "document.querySelector('#mmTitle')", "Mindmap editor not visible");
  await evaluate(client, `(() => { const t = document.querySelector('#mmTitle'); t.value = ${JSON.stringify(`${testPrefix}_DEL_MM`)}; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await pressKey(client, "Tab", "Tab", 9);
  await waitFor(client, "document.querySelector('.mm-edit-input')", "Node edit not open");
  await evaluate(client, `(() => { const inp = document.querySelector('.mm-edit-input'); inp.value = 'will-be-deleted'; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })); })()`);
  await delay(300);
  await click(client, `.mindmap-delete[data-delete="${mmId}"]`);
  await delay(1500);
  const activeDiag = await api(baseUrl, "list_mindmaps");
  const trashDiag = await api(baseUrl, "list_mindmap_trash");
  if (activeDiag.find((m) => m.id === mmId)) {
    await api(baseUrl, "delete_mindmap", { id: mmId }).catch(() => {});
    await delay(200);
  }
  assert(!activeDiag.find((m) => m.id === mmId), `Deleted mindmap still active`);
  assert(trashDiag.find((m) => m.id === mmId), `Deleted mindmap not in trash`);
  await navigate(client, baseUrl);
  await delay(500);
  await navigateToMindmapsPage();
  await delay(500);
  const active2 = await api(baseUrl, "list_mindmaps");
  assert(!active2.find((m) => m.id === mmId), "Mindmap resurrected after reload");
  const trash2 = await api(baseUrl, "list_mindmap_trash");
  assert(trash2.find((m) => m.id === mmId), "Mindmap gone from trash after reload");
}

async function rapidMultiCreateFlow() {
  await navigateToNotesPage();
  for (let i = 0; i < 5; i++) { await click(client, "#new"); await delay(30); }
  await delay(1500);
  const notes = await api(baseUrl, "list_notes");
  const s1Notes = notes.filter((n) => n.title?.startsWith("AI_TEST_S1_") || n.title === "Untitled" || n.title === "未命名想法");
  const noteIds = s1Notes.map((n) => n.id);
  assert(new Set(noteIds).size === noteIds.length, `Duplicate note IDs: ${noteIds}`);
  await navigateToMindmapsPage();
  await delay(300);
  for (let i = 0; i < 5; i++) { await click(client, "#newMindmap"); await delay(30); }
  await delay(1500);
  const maps = await api(baseUrl, "list_mindmaps");
  const s1Maps = maps.filter((m) => m.title?.startsWith("AI_TEST_S1_") || m.title === "Untitled" || m.title === "未命名导图");
  const mapIds = s1Maps.map((m) => m.id);
  assert(new Set(mapIds).size === mapIds.length, `Duplicate mindmap IDs: ${mapIds}`);
}

async function crossPageFlushFlow() {
  await navigate(client, baseUrl);
  await delay(800);
  await navigateToNotesPage();
  await delay(300);
  await click(client, "#new, #emptyNew");
  await waitFor(client, "document.querySelector('#title') && document.querySelector('#body')", "Note not created");
  const noteId = await evaluate(client, "document.querySelector('.note-row.active')?.dataset.id || ''");
  assert(noteId, "Note missing id");
  const crossTitle = `${testPrefix}_CROSS_NOTE`;
  const crossBody = `${testPrefix}_cross_page_body`;
  await typeNoteTitle(crossTitle);
  await typeNoteBody(crossBody);
  await click(client, '[data-page="mindmaps"]');
  await waitFor(client, "document.querySelector('#newMindmap') || document.querySelector('.mm-toolbar')", "Mindmaps not open");
  await delay(2000);
  await navigate(client, baseUrl);
  await delay(500);
  await navigateToNotesPage();
  await delay(500);
  await selectNote(noteId);
  await switchToEditMode();
  const title = await readNoteTitle();
  const body = await readNoteBody();
  assert(title === crossTitle, `Cross-page flush title: "${title}"`);
  assert(body === crossBody, `Cross-page flush body: "${body}"`);
}

// Save version guard uses injected script
async function saveVersionGuardFlow() {
  await navigate(client, baseUrl);
  await delay(800);
  await navigateToNotesPage();
  await click(client, "#new, #emptyNew");
  await waitFor(client, "document.querySelector('#body') && document.querySelector('#title')", "Note not created");
  const noteId = await evaluate(client, "document.querySelector('.note-row.active')?.dataset.id || ''");
  assert(noteId, "Note missing id");
  await evaluate(client, "window.__delaySave = true");
  await typeNoteTitle(`${testPrefix}_VG_TITLE`);
  await typeNoteBody(`${testPrefix}_VG_BODY_OLD`);
  await delay(800);
  const heldCount = await evaluate(client, "window.__flushPendingSaveCount()");
  assert(heldCount >= 1, `Expected pending saves, got ${heldCount}`);
  await typeNoteBody(`${testPrefix}_VG_BODY_NEW`);
  await delay(100);
  await evaluate(client, "window.__delaySave = false; window.__releasePendingSaves()");
  await delay(3000);
  await navigate(client, baseUrl);
  await delay(500);
  await navigateToNotesPage();
  await delay(500);
  await selectNote(noteId);
  await switchToEditMode();
  const body = await readNoteBody();
  assert(body === `${testPrefix}_VG_BODY_NEW`, `Stale overwrite: "${body}"`);
}

async function rapidMindmapEditReloadFlow() {
  await navigate(client, baseUrl);
  await delay(800);
  await navigateToMindmapsPage();
  await click(client, "#newMindmap");
  await waitFor(client, "document.querySelector('#mmTitle')", "Mindmap not created");
  const mmId = await evaluate(client, "document.querySelector('.mindmap-row.active .mindmap-item')?.dataset.id || ''");
  assert(mmId, "Mindmap missing id");
  await evaluate(client, `(() => { const t = document.querySelector('#mmTitle'); t.value = ${JSON.stringify(`${testPrefix}_MM_RAPID`)}; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await delay(400);
  await evaluate(client, `(() => { const t = document.querySelector('#mmTitle'); t.value = ${JSON.stringify(`${testPrefix}_MM_RAPID_V2`)}; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await delay(2000);
  await navigate(client, baseUrl);
  await delay(500);
  await navigateToMindmapsPage();
  await delay(500);
  await click(client, `.mindmap-row .mindmap-item[data-id="${mmId}"]`);
  await waitFor(client, `document.querySelector('.mindmap-row.active .mindmap-item[data-id="${mmId}"]') && document.querySelector('#mmTitle')`, "Mindmap not selectable");
  const title = await evaluate(client, "document.querySelector('#mmTitle')?.value || ''");
  assert(title === `${testPrefix}_MM_RAPID_V2`, `Title reverted: "${title}"`);
}

// ── Run ──

try {
  const r = await startLocalServer({ port: 0 });
  serverProc = r.server;
  baseUrl = r.baseUrl;
  await cleanupAllS1();

  const chromePath = await findChrome();
  assert(chromePath, "Chrome/Edge not found. Set CHROME_PATH.");

  const browser = await startChrome(chromePath);
  chromeProc = browser.chrome;
  client = browser.client;
  userDataDir = browser.userDataDir;

  // Inject fetch interceptor
  await client.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => { const f = window.fetch; var pending = []; window.__delaySave = false; window.fetch = function(u,...a) { if (typeof u === 'string' && u.includes('/api/save_note') && window.__delaySave) { return new Promise(r => { pending.push({r,args:[u,...a]}); }); } return f.apply(this,[u,...a]); }; window.__releasePendingSaves = function() { while(pending.length) { var p = pending.shift(); f.apply(window,p.args).then(p.r).catch(()=>{}); } }; window.__flushPendingSaveCount = function() { return pending.length; }; })();`,
  });

  await navigate(client, baseUrl);
  let f = 0;
  f += await step("empty state not stuck on loading", emptyStateNotStuckLoading);
  f += await step("fast note switch within debounce, reload verify", fastNoteSwitchFlow);
  f += await step("fast mindmap switch within debounce, reload verify", fastMindmapSwitchFlow);
  f += await step("delete note during save — no resurrection", deleteNoteDuringSaveFlow);
  f += await step("delete mindmap during save — no resurrection", deleteMindmapDuringSaveFlow);
  f += await step("rapid multi-create — unique IDs", rapidMultiCreateFlow);
  f += await step("cross-page flush — edit then switch page, reload verify", crossPageFlushFlow);
  f += await step("save version guard — stale response must not overwrite newer edits", saveVersionGuardFlow);
  f += await step("rapid mindmap edit + reload verify", rapidMindmapEditReloadFlow);
  f += assertNoBrowserErrors(client, "stage1 browser errors");
  failures += f;
} catch (err) {
  fail("stage1", err);
  failures += 1;
} finally {
  await cleanupAllS1().catch(() => {});
  if (client) client.close();
  if (chromeProc) chromeProc.kill();
  if (serverProc) serverProc.kill();
  if (userDataDir) await delay(500).then(() => rm(userDataDir, { recursive: true, force: true }).catch(() => {}));
}

if (failures > 0) {
  console.error(`Stage 1.1 regression test failed with ${failures} failure(s).`);
  process.exit(1);
}

console.log("Stage 1.1 regression test passed.");
