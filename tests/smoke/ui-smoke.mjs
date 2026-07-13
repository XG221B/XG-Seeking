#!/usr/bin/env node
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
const testPrefix = `AI_TEST_UI_${runId}`;
const chromePath = findChrome();

let server = null;
let chrome = null;
let userDataDir = "";
let client = null;
let failures = 0;

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

function pass(name) {
  console.log(`PASS ${name}`);
}

function fail(name, error) {
  failures += 1;
  console.error(`FAIL ${name}`);
  console.error(error?.stack || error);
}

async function step(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function api(command, payload = {}) {
  const response = await fetch(`${baseUrl}/api/${command}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${command} failed with ${response.status}: ${text}`);
  }
  return response.status === 204 || !text ? null : JSON.parse(text);
}

async function waitForServer() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await api("get_settings");
      return;
    } catch {
      await delay(250);
    }
  }
  throw new Error(`local-server did not become ready on ${baseUrl}`);
}

async function startServer() {
  execFileSync(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "build"], {
    cwd: root,
    stdio: "ignore",
  });
  server = spawn(process.execPath, ["local-server.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: String(localPort) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  server.stdout.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitForServer();
}

async function cleanupUiData() {
  const removeNote = async (id) => {
    await api("delete_note", { id }).catch(() => {});
    await api("delete_permanently", { id }).catch(() => {});
  };
  const removeMindmap = async (id) => {
    await api("delete_mindmap", { id }).catch(() => {});
    await api("delete_mindmap_permanently", { id }).catch(() => {});
  };

  for (const note of await api("list_notes").catch(() => [])) {
    if (note.title?.startsWith("AI_TEST_UI_")) await removeNote(note.id);
  }
  for (const note of await api("list_trash").catch(() => [])) {
    if (note.title?.startsWith("AI_TEST_UI_")) {
      await api("delete_permanently", { id: note.id }).catch(() => {});
    }
  }
  for (const mindmap of await api("list_mindmaps").catch(() => [])) {
    if (mindmap.title?.startsWith("AI_TEST_UI_")) await removeMindmap(mindmap.id);
  }
  for (const mindmap of await api("list_mindmap_trash").catch(() => [])) {
    if (mindmap.title?.startsWith("AI_TEST_UI_")) {
      await api("delete_mindmap_permanently", { id: mindmap.id }).catch(() => {});
    }
  }
}

async function startChrome() {
  assert(chromePath, "Chrome or Edge was not found. Set CHROME_PATH to run UI smoke tests.");
  userDataDir = await mkdtemp(join(tmpdir(), "xg-seeking-ui-"));
  chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--disable-extensions",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ], {
    stdio: ["ignore", "ignore", "ignore"],
    windowsHide: true,
  });

  const target = await waitForPageTarget();
  client = await CdpClient.connect(target.webSocketDebuggerUrl);
  client.on("Runtime.exceptionThrown", (event) => {
    fail("browser runtime exception", event.exceptionDetails?.text || JSON.stringify(event.exceptionDetails));
  });
  await client.send("Page.enable");
  await client.send("Runtime.enable");
}

async function waitForPageTarget() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((res) => res.json());
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // Chrome is still starting.
    }
    await delay(250);
  }
  throw new Error(`Chrome DevTools did not become ready on 127.0.0.1:${debugPort}`);
}

class CdpClient {
  static connect(url) {
    return new Promise((resolveClient, reject) => {
      const ws = new WebSocket(url);
      const client = new CdpClient(ws);
      ws.addEventListener("open", () => resolveClient(client), { once: true });
      ws.addEventListener("error", (event) => reject(event.error || new Error("WebSocket error")), { once: true });
    });
  }

  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener("message", (event) => this.handleMessage(event));
  }

  handleMessage(event) {
    const message = JSON.parse(event.data);
    if (message.id && this.pending.has(message.id)) {
      const { resolveCommand, rejectCommand } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) rejectCommand(new Error(message.error.message));
      else resolveCommand(message.result);
      return;
    }
    if (message.method && this.handlers.has(message.method)) {
      for (const handler of this.handlers.get(message.method)) handler(message.params || {});
    }
  }

  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(handler);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveCommand, rejectCommand) => {
      this.pending.set(id, { resolveCommand, rejectCommand });
    });
  }

  close() {
    this.ws.close();
  }
}

async function evaluate(expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Browser evaluation failed");
  }
  return result.result?.value;
}

async function waitFor(expression, message, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await delay(100);
  }
  throw new Error(message);
}

async function click(selector) {
  const clicked = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  assert(clicked, `Missing clickable element: ${selector}`);
}

async function pressKey(key, code, windowsVirtualKeyCode) {
  await evaluate("document.activeElement?.blur?.(); document.body.tabIndex = -1; document.body.focus();");
  const params = { key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode };
  await client.send("Input.dispatchKeyEvent", { type: "keyDown", ...params });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", ...params });
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function navigateToApp() {
  await client.send("Page.navigate", { url: baseUrl });
  await waitFor("document.readyState === 'complete' && document.querySelector('#app')", "App shell did not load");
}

async function reloadApp() {
  await client.send("Page.reload");
  await waitFor("document.readyState === 'complete' && document.querySelector('#app')", "App shell did not reload");
}

async function notesEditPreviewFlow() {
  await click('[data-page="notes"]');
  await waitFor("document.querySelector('#new') || document.querySelector('#emptyNew')", "Notes page did not become interactive");
  await click("#new, #emptyNew");
  await waitFor("document.querySelector('#body') && document.querySelector('#editMode.active')", "New note did not open in Edit mode");

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

  await evaluate(`(() => {
    const title = document.querySelector('#title');
    const body = document.querySelector('#body');
    title.value = ${JSON.stringify(`${testPrefix}_NOTE`)};
    body.value = ${JSON.stringify(markdown)};
    title.dispatchEvent(new Event('input', { bubbles: true }));
    body.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);

  await click("#previewMode");
  await waitFor("document.querySelector('#mdPreview') && !document.querySelector('#body')", "Preview mode did not render");

  const preview = await evaluate(`(() => {
    const preview = document.querySelector('#mdPreview');
    return {
      heading: preview.querySelector('h1')?.textContent || '',
      hasStrong: Boolean(preview.querySelector('strong')),
      hasScriptNode: Boolean(preview.querySelector('script')),
      hasUnsafeHref: Array.from(preview.querySelectorAll('a')).some((a) => a.getAttribute('href')?.startsWith('javascript:')),
      text: preview.textContent,
      toolbarVisible: Boolean(document.querySelector('#mdBold, #mdItalic, #mdCode, #mdHeading, #mdQuote, #mdList, #mdCodeBlock')),
    };
  })()`);
  assert(preview.heading === "UI Heading", "Markdown heading did not render in Preview");
  assert(preview.hasStrong, "Markdown bold did not render in Preview");
  assert(!preview.hasScriptNode, "Preview generated a script node");
  assert(!preview.hasUnsafeHref, "Preview allowed a javascript: link");
  assert(preview.text.includes("<script>alert(1)</script>"), "Unsafe HTML was not preserved as escaped text");
  assert(!preview.toolbarVisible, "Markdown insertion toolbar is visible in Preview mode");

  await click("#editMode");
  await waitFor("document.querySelector('#body') && document.querySelector('#editMode.active')", "Edit mode did not return to textarea");
  const editValue = await evaluate("document.querySelector('#body').value");
  assert(editValue.includes("line one\nline two"), "Edit mode did not preserve multiline Markdown source");

  await click("#previewMode");
  await delay(800);
}

async function pageSwitchingFlow() {
  await click('[data-page="mindmaps"]');
  await waitFor("document.querySelector('.mindmaps') || document.querySelector('.mindmap-page') || document.querySelector('.mm-toolbar')", "Mindmap page did not open");
  await click('[data-page="settings"]');
  await waitFor("document.querySelector('#setLang') && document.querySelector('#saveSetBtn')", "Settings page did not open");
  await click('[data-page="notes"]');
  await waitFor("document.querySelector('#mdPreview') && !document.querySelector('#body')", "Returning to Notes did not default to Preview for existing note");
}

async function noteTrashRestoreFlow() {
  const noteId = await evaluate(`document.querySelector('.note-row.active')?.dataset.id || ''`);
  assert(noteId, "No active note available for trash/restore flow");

  await click(".note-row.active .delete-note");
  await waitFor(`!document.querySelector('.note-row[data-id="${noteId}"]')`, "Deleted note still appears in active note list");
  await delay(500);
  await click("#toggleTrash");
  await waitFor(`document.querySelector('.restore-note[data-restore-id="${noteId}"]')`, "Deleted note did not appear in Trash");

  const trashTitle = await evaluate(`document.querySelector('.note-row.active strong')?.textContent || ''`);
  assert(trashTitle.startsWith("AI_TEST_UI_"), "Trash view selected an unexpected note");

  await click(`.restore-note[data-restore-id="${noteId}"]`);
  await waitFor(`document.querySelector('.note-row.active[data-id="${noteId}"]') && document.querySelector('#mdPreview')`, "Restored note did not return to active notes");
}

async function mindmapUiFlow() {
  await reloadApp();
  await delay(800);
  await click('[data-page="mindmaps"]');
  await waitFor("document.querySelector('#newMindmap')", "Mindmap page did not become interactive");
  await click("#newMindmap");
  await waitFor("document.querySelector('#mmTitle')", "New mindmap did not open");

  await evaluate(`(() => {
    const title = document.querySelector('#mmTitle');
    title.value = ${JSON.stringify(`${testPrefix}_MINDMAP`)};
    title.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await delay(300);

  await pressKey("Tab", "Tab", 9);
  await waitFor("document.querySelector('.mm-edit-input')", "First mindmap node editor did not open");
  await evaluate(`(() => {
    const input = document.querySelector('.mm-edit-input');
    input.value = 'Root node';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
  })()`);
  await waitFor("Array.from(document.querySelectorAll('.mm-text')).some((node) => node.textContent === 'Root node')", "Root node was not committed");
  await delay(300);

  await pressKey("Tab", "Tab", 9);
  await waitFor("document.querySelector('.mm-edit-input')", "Child mindmap node editor did not open");
  await evaluate(`(() => {
    const input = document.querySelector('.mm-edit-input');
    input.value = 'Child node';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
  })()`);
  await waitFor("Array.from(document.querySelectorAll('.mm-text')).some((node) => node.textContent === 'Child node')", "Child node was not committed");
  await waitFor("document.querySelector('.mm-toggle')", "Toggle button did not appear after child node added", 8000);
  await delay(200);

  await click(".mm-toggle");
  await waitFor("!Array.from(document.querySelectorAll('.mm-text')).some((node) => node.textContent === 'Child node')", "Collapsed parent still shows child node");
  await click(".mm-toggle");
  await waitFor("Array.from(document.querySelectorAll('.mm-text')).some((node) => node.textContent === 'Child node')", "Expanded parent did not show child node");

  const mindmapId = await evaluate(`document.querySelector('.mindmap-row.active .mindmap-item')?.dataset.id || ''`);
  assert(mindmapId, "No active mindmap available for trash/restore flow");
  await click(".mindmap-row.active .mindmap-delete");
  await waitFor(`!document.querySelector('.mindmap-item[data-id="${mindmapId}"]')`, "Deleted mindmap still appears in active list");
  await delay(500);
  await click("#toggleMindmapTrash");
  await waitFor(`document.querySelector('.mindmap-restore[data-restore="${mindmapId}"]')`, "Deleted mindmap did not appear in Trash");
  await click(`.mindmap-restore[data-restore="${mindmapId}"]`);
  await waitFor(`document.querySelector('.mindmap-row.active .mindmap-item[data-id="${mindmapId}"]') && document.querySelector('#mmTitle')`, "Restored mindmap did not return to active list");
}

async function cleanupThroughApi() {
  for (let attempt = 0; attempt < 3; attempt++) {
    await cleanupUiData();
    await delay(300);
    const remainingActive = (await api("list_notes")).filter((note) => note.title?.startsWith("AI_TEST_UI_"));
    const remainingTrash = (await api("list_trash")).filter((note) => note.title?.startsWith("AI_TEST_UI_"));
    const remainingMindmaps = (await api("list_mindmaps")).filter((mindmap) => mindmap.title?.startsWith("AI_TEST_UI_"));
    const remainingMindmapTrash = (await api("list_mindmap_trash")).filter((mindmap) => mindmap.title?.startsWith("AI_TEST_UI_"));
    const details = [
      remainingActive.length ? `active notes: ${remainingActive.map(n => n.title).join(', ')}` : '',
      remainingTrash.length ? `trash notes: ${remainingTrash.map(n => n.title).join(', ')}` : '',
      remainingMindmaps.length ? `active mindmaps: ${remainingMindmaps.map(m => m.title).join(', ')}` : '',
      remainingMindmapTrash.length ? `trash mindmaps: ${remainingMindmapTrash.map(m => m.title).join(', ')}` : '',
    ].filter(Boolean).join('; ');
    if (remainingActive.length === 0 && remainingTrash.length === 0 && remainingMindmaps.length === 0 && remainingMindmapTrash.length === 0) return;
    if (attempt === 2) assert(false, `UI test data cleanup failed after retries${details ? ': ' + details : ''}`);
  }
}

try {
  await startServer();
  await cleanupUiData();
  await startChrome();
  await navigateToApp();
  await step("notes Edit/Preview, Markdown rendering, and toolbar visibility", notesEditPreviewFlow);
  await step("page switching remains interactive", pageSwitchingFlow);
  await step("note Trash and Restore through UI", noteTrashRestoreFlow);
  await step("mindmap create, edit, collapse, Trash, and Restore through UI", mindmapUiFlow);
  await step("UI test data cleanup", cleanupThroughApi);
} finally {
  await cleanupUiData().catch((error) => fail("cleanup", error));
  if (client) client.close();
  if (chrome) chrome.kill();
  if (server) server.kill();
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
}

if (failures > 0) {
  console.error(`UI smoke test failed with ${failures} failure(s).`);
  process.exit(1);
}

console.log("UI smoke test passed.");
