#!/usr/bin/env node
import { rm } from "node:fs/promises";
import { startLocalServer, api, findChrome, startChrome, navigate, delay, cleanupTestData, pass, fail, step, click, waitFor, evaluate, pressKey, assertNoBrowserErrors } from "./helper.mjs";

const runId = Date.now().toString(36);
const testPrefix = `AI_TEST_UI_${runId}`;
let serverProc = null;
let chromeProc = null;
let client = null;
let userDataDir = "";
let baseUrl = "";
let failures = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function cleanupUiData() {
  await cleanupTestData(baseUrl, "AI_TEST_UI_");
}

async function notesEditPreviewFlow() {
  await navigate(client, baseUrl);
  await delay(800);
  await click(client, '[data-page="notes"]');
  await waitFor(client, "document.querySelector('#new') || document.querySelector('#emptyNew')", "Notes page did not become interactive");
  await click(client, "#new, #emptyNew");
  await waitFor(client, "document.querySelector('#body') && document.querySelector('#editMode.active')", "New note did not open in Edit mode");

  const markdown = [
    "# UI Heading",
    "",
    "line one",
    "line two",
    "",
    "**bold** <script>alert(1)</script>",
    "",
    "[unsafe](javascript:alert(1))",
  ].join("\n");

  await evaluate(client, `(() => {
    const title = document.querySelector('#title');
    const body = document.querySelector('#body');
    title.value = ${JSON.stringify(`${testPrefix}_NOTE`)};
    body.value = ${JSON.stringify(markdown)};
    title.dispatchEvent(new Event('input', { bubbles: true }));
    body.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);

  await click(client, "#previewMode");
  await waitFor(client, "document.querySelector('#mdPreview') && !document.querySelector('#body')", "Preview mode did not render");

  const preview = await evaluate(client, `(() => {
    const p = document.querySelector('#mdPreview');
    return {
      heading: p.querySelector('h1')?.textContent || '',
      hasStrong: Boolean(p.querySelector('strong')),
      hasScriptNode: Boolean(p.querySelector('script')),
      hasUnsafeHref: Array.from(p.querySelectorAll('a')).some((a) => a.getAttribute('href')?.startsWith('javascript:')),
      toolbarVisible: Boolean(document.querySelector('#mdBold, #mdItalic, #mdCode, #mdHeading, #mdQuote, #mdList, #mdCodeBlock')),
      text: p.textContent,
    };
  })()`);
  assert(preview.heading === "UI Heading", "Markdown heading did not render");
  assert(preview.hasStrong, "Markdown bold did not render");
  assert(!preview.hasScriptNode, "Preview generated a script node");
  assert(!preview.hasUnsafeHref, "Preview allowed a javascript: link");
  assert(preview.text.includes("<script>alert(1)</script>"), "Unsafe HTML not preserved as text");
  assert(!preview.toolbarVisible, "Markdown toolbar visible in Preview");
}

async function pageSwitchingFlow() {
  const navLayout = await evaluate(client, `(() => {
    const topbar = document.querySelector('.topbar');
    const nav = document.querySelector('.nav');
    const topbarRect = topbar.getBoundingClientRect();
    const navRect = nav.getBoundingClientRect();
    const style = getComputedStyle(nav);
    return {
      topOffset: navRect.top - topbarRect.top,
      borderTop: style.borderTopWidth,
      borderBottom: style.borderBottomWidth,
    };
  })()`);
  assert(navLayout.topOffset >= 20, "Top navigation is still too close to the window edge");
  assert(navLayout.borderTop === "1px" && navLayout.borderBottom === "1px", "Top navigation framing lines missing");

  await click(client, '[data-page="mindmaps"]');
  await waitFor(client, "document.querySelector('#newMindmap') || document.querySelector('.mm-toolbar')", "Mindmap page did not open");
  await click(client, '[data-page="settings"]');
  await waitFor(client, "document.querySelector('#setLang') && document.querySelector('#saveSetBtn')", "Settings page did not open");
  await click(client, '[data-page="notes"]');
  await waitFor(client, "document.querySelector('#mdPreview') && !document.querySelector('#body')", "Return to Notes not Preview");
}

async function noteTrashRestoreFlow() {
  const noteId = await evaluate(client, "document.querySelector('.note-row.active')?.dataset.id || ''");
  assert(noteId, "No active note for trash/restore");

  await click(client, ".note-row.active .delete-note");
  await waitFor(client, `!document.querySelector('.note-row[data-id="${noteId}"]')`, "Deleted note still appears");
  await delay(500);
  await click(client, "#toggleTrash");
  await waitFor(client, `document.querySelector('.restore-note[data-restore-id="${noteId}"]')`, "Deleted note not in Trash");

  const trashTitle = await evaluate(client, "document.querySelector('.note-row.active strong')?.textContent || ''");
  assert(trashTitle.startsWith("AI_TEST_UI_"), "Trash selected unexpected note");

  await click(client, `.restore-note[data-restore-id="${noteId}"]`);
  await waitFor(client, `document.querySelector('.note-row.active[data-id="${noteId}"]') && document.querySelector('#mdPreview')`, "Restored note not returned");
}

async function mindmapUiFlow() {
  await navigate(client, baseUrl);
  await delay(800);
  await click(client, '[data-page="mindmaps"]');
  await waitFor(client, "document.querySelector('#newMindmap')", "Mindmap page not interactive");
  await click(client, "#newMindmap");
  await waitFor(client, "document.querySelector('#mmTitle')", "New mindmap not opened");

  await evaluate(client, `(() => {
    const t = document.querySelector('#mmTitle');
    t.value = ${JSON.stringify(`${testPrefix}_MINDMAP`)};
    t.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await delay(300);

  await pressKey(client, "Tab", "Tab", 9);
  await waitFor(client, "document.querySelector('.mm-edit-input')", "First node editor did not open");
  await evaluate(client, `(() => {
    const inp = document.querySelector('.mm-edit-input');
    inp.value = 'Root node';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
  })()`);
  await waitFor(client, "Array.from(document.querySelectorAll('.mm-text')).some(n => n.textContent === 'Root node')", "Root node not committed");
  await delay(300);

  await pressKey(client, "Tab", "Tab", 9);
  await waitFor(client, "document.querySelector('.mm-edit-input')", "Child node editor did not open");
  await evaluate(client, `(() => {
    const inp = document.querySelector('.mm-edit-input');
    inp.value = 'Child node';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
  })()`);
  await waitFor(client, "Array.from(document.querySelectorAll('.mm-text')).some(n => n.textContent === 'Child node')", "Child node not committed");
  await waitFor(client, "document.querySelector('.mm-toggle')", "Toggle button missing");
  const guide = await evaluate(client, `(() => {
    const text = Array.from(document.querySelectorAll('.mm-text')).find((node) => node.textContent === 'Child node');
    const rootText = Array.from(document.querySelectorAll('.mm-text')).find((node) => node.textContent === 'Root node');
    const wrapper = text?.closest('.mm-node-wrapper');
    if (!wrapper || !rootText) return null;
    const style = getComputedStyle(wrapper);
    const marker = getComputedStyle(wrapper, '::before');
    return {
      paddingLeft: style.paddingLeft,
      guideWidth: marker.width,
      backgroundImage: marker.backgroundImage,
      guideLeft: wrapper.getBoundingClientRect().left + parseFloat(marker.left),
      parentTextLeft: rootText.getBoundingClientRect().left,
    };
  })()`);
  assert(guide && parseFloat(guide.paddingLeft) >= 24, "Child node indentation missing");
  assert(parseFloat(guide.guideWidth) >= 24 && guide.backgroundImage !== "none", "Child indentation guide missing");
  assert(Math.abs(guide.guideLeft - guide.parentTextLeft) <= 1, "Indentation guide is not aligned with parent text");
  await delay(200);

  await click(client, ".mm-toggle");
  await waitFor(client, "!Array.from(document.querySelectorAll('.mm-text')).some(n => n.textContent === 'Child node')", "Collapsed parent still shows child");
  await click(client, ".mm-toggle");
  await waitFor(client, "Array.from(document.querySelectorAll('.mm-text')).some(n => n.textContent === 'Child node')", "Expanded parent missing child");

  const mindmapId = await evaluate(client, "document.querySelector('.mindmap-row.active .mindmap-item')?.dataset.id || ''");
  assert(mindmapId, "No active mindmap for trash/restore");
  await click(client, ".mindmap-row.active .mindmap-delete");
  await waitFor(client, `!document.querySelector('.mindmap-item[data-id="${mindmapId}"]')`, "Deleted mindmap still visible");
  await delay(500);
  await click(client, "#toggleMindmapTrash");
  await waitFor(client, `document.querySelector('.mindmap-restore[data-restore="${mindmapId}"]')`, "Mindmap not in trash");
  await click(client, `.mindmap-restore[data-restore="${mindmapId}"]`);
  await waitFor(client, `document.querySelector('.mindmap-row.active .mindmap-item[data-id="${mindmapId}"]') && document.querySelector('#mmTitle')`, "Restored mindmap not returned");
}

async function cleanupThroughApi() {
  for (let attempt = 0; attempt < 3; attempt++) {
    await cleanupUiData();
    await delay(300);
    const remainingActive = (await api(baseUrl, "list_notes")).filter((n) => n.title?.startsWith("AI_TEST_UI_"));
    const remainingTrash = (await api(baseUrl, "list_trash")).filter((n) => n.title?.startsWith("AI_TEST_UI_"));
    const remainingMaps = (await api(baseUrl, "list_mindmaps")).filter((m) => m.title?.startsWith("AI_TEST_UI_"));
    const remainingMT = (await api(baseUrl, "list_mindmap_trash")).filter((m) => m.title?.startsWith("AI_TEST_UI_"));
    const details = [
      remainingActive.length ? `active: ${remainingActive.map(n=>n.title).join(',')}` : '',
      remainingTrash.length ? `trash: ${remainingTrash.map(n=>n.title).join(',')}` : '',
      remainingMaps.length ? `maps: ${remainingMaps.map(m=>m.title).join(',')}` : '',
      remainingMT.length ? `mapTrash: ${remainingMT.map(m=>m.title).join(',')}` : '',
    ].filter(Boolean).join('; ');
    if (remainingActive.length === 0 && remainingTrash.length === 0 && remainingMaps.length === 0 && remainingMT.length === 0) return;
    if (attempt === 2) assert(false, `UI cleanup failed${details ? ': '+details : ''}`);
  }
}

try {
  const r = await startLocalServer({ port: 0 });
  serverProc = r.server;
  baseUrl = r.baseUrl;

  await cleanupUiData();
  const chromePath = await findChrome();
  assert(chromePath, "Chrome/Edge not found. Set CHROME_PATH.");

  const browser = await startChrome(chromePath);
  chromeProc = browser.chrome;
  client = browser.client;
  userDataDir = browser.userDataDir;

  await navigate(client, baseUrl);
  let f = 0;
  f += await step("notes Edit/Preview, Markdown rendering, toolbar visibility", notesEditPreviewFlow);
  f += await step("page switching remains interactive", pageSwitchingFlow);
  f += await step("note Trash and Restore through UI", noteTrashRestoreFlow);
  f += await step("mindmap create, edit, collapse, Trash, Restore through UI", mindmapUiFlow);
  f += await step("UI test data cleanup", cleanupThroughApi);
  f += assertNoBrowserErrors(client, "ui smoke browser errors");
  failures += f;
} catch (err) {
  fail("ui smoke", err);
  failures += 1;
} finally {
  await cleanupUiData().catch(() => {});
  if (client) client.close();
  if (chromeProc) chromeProc.kill();
  if (serverProc) serverProc.kill();
  if (userDataDir) await delay(500).then(() => rm(userDataDir, { recursive: true, force: true }).catch(() => {}));
}

if (failures > 0) {
  console.error(`UI smoke test failed with ${failures} failure(s).`);
  process.exit(1);
}

console.log("UI smoke test passed.");
