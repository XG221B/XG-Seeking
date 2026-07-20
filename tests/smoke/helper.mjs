import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// ── Server helper ──

export async function startLocalServer({ port } = {}) {
  const env = { ...process.env };
  if (port !== undefined) env.PORT = String(port);

  const server = spawn(process.execPath, ["local-server.mjs"], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let baseUrl = null;
  const output = [];

  await new Promise((resolveStart, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Server did not start within 15s"));
    }, 15000);

    server.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output.push(text);
      process.stdout.write(text);

      if (port === 0) {
        const m = text.match(/ASSIGNED_PORT=(\d+)/);
        if (m) {
          baseUrl = `http://127.0.0.1:${m[1]}`;
          clearTimeout(timeout);
          resolveStart();
        }
      } else {
        const m = text.match(/running at (http:\/\/[^\s]+)/);
        if (m) {
          baseUrl = m[1];
          clearTimeout(timeout);
          resolveStart();
        }
      }
    });

    server.stderr.on("data", (chunk) => process.stderr.write(chunk));
    server.on("error", (err) => { clearTimeout(timeout); reject(err); });
  });

  return { server, baseUrl };
}

// ── API helper ──

export async function api(baseUrl, command, payload = {}) {
  const response = await fetch(`${baseUrl}/api/${command}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) {
    const err = new Error(`${command} failed with ${response.status}: ${text}`);
    err.status = response.status;
    throw err;
  }
  return response.status === 204 || !text ? null : JSON.parse(text);
}

// ── Chrome helper ──

export async function findChrome() {
  const envPath = process.env.CHROME_PATH;
  if (envPath && existsSync(envPath)) return envPath;
  try {
    const pw = JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_PATH || "null");
    if (pw && existsSync(pw)) return pw;
  } catch {}
  try {
    const { chromium } = await import("playwright");
    const pwPath = chromium.executablePath();
    if (pwPath && existsSync(pwPath)) {
      process.env.CHROME_PATH = pwPath;
      return pwPath;
    }
  } catch { /* Playwright not installed */ }
  const candidates = [
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

export async function startChrome(chromePath) {
  const userDataDir = await mkdtemp(join(tmpdir(), "xg-seek-"));
  const chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--disable-extensions",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ], {
    stdio: ["ignore", "ignore", "ignore"],
    windowsHide: true,
  });

  // Read DevToolsActivePort file to get the actual port
  let debugPort = null;
  const portFile = join(userDataDir, "DevToolsActivePort");

  await new Promise((resolveStart, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Chrome did not write DevToolsActivePort within 15s"));
    }, 15000);

    const check = async () => {
      try {
        const content = await readFile(portFile, "utf8");
        const lines = content.split("\n").filter(l => l.trim());
        if (lines.length > 0) {
          debugPort = parseInt(lines[0], 10);
          if (debugPort > 0) {
            clearTimeout(timeout);
            resolveStart();
            return;
          }
        }
      } catch {
        // File not yet written
      }
      setTimeout(check, 200);
    };

    setTimeout(check, 500);

    chrome.on("error", (err) => { clearTimeout(timeout); reject(err); });
  });

  // Get the WebSocket URL from the debug port
  const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json());
  const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page) throw new Error("No page target found in Chrome DevTools");

  const client = await CdpClient.connect(page.webSocketDebuggerUrl);
  client.browserErrors = [];
  client.on("Runtime.exceptionThrown", (event) => {
    const detail = event.exceptionDetails;
    const text = detail.exception?.description || detail.exception?.value || detail.text || JSON.stringify(detail);
    const url = detail.url || "";
    const line = detail.lineNumber || 0;
    const col = detail.columnNumber || 0;
    const entry = { text, url, line, col, stack: detail.stackTrace ? JSON.stringify(detail.stackTrace) : "" };
    client.browserErrors.push(entry);
    process.stderr.write(`[browser] ${text} (${url}:${line}:${col})\n`);
  });
  client.on("Runtime.consoleAPICalled", (event) => {
    if (event.type === "error") {
      const msgs = event.args.map((a) => a.value || a.description || "").join(" ");
      client.browserErrors.push({ text: msgs, url: "", line: 0, col: 0, stack: "console.error" });
      process.stderr.write(`[browser console] ${msgs}\n`);
    }
  });
  await client.send("Page.enable");
  await client.send("Runtime.enable");

  return { chrome, client, userDataDir };
}

export async function navigate(client, baseUrl) {
  await client.send("Page.navigate", { url: baseUrl });
  await waitFor(client, "document.readyState === 'complete' && document.querySelector('#app')", "App shell did not load");
}

export async function reload(client) {
  await client.send("Page.reload");
  await waitFor(client, "document.readyState === 'complete' && document.querySelector('#app')", "App shell did not reload");
}

export function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── CDP client ──

export class CdpClient {
  static connect(url) {
    return new Promise((resolveClient, reject) => {
      const ws = new WebSocket(url);
      const client = new CdpClient(ws);
      ws.addEventListener("open", () => resolveClient(client), { once: true });
      ws.addEventListener("error", (e) => reject(e.error || new Error("WebSocket error")), { once: true });
    });
  }

  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener("message", (e) => this.handleMessage(e));
  }

  handleMessage(event) {
    const msg = JSON.parse(event.data);
    if (msg.id && this.pending.has(msg.id)) {
      const { r, j } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) j(new Error(msg.error.message));
      else r(msg.result);
      return;
    }
    if (msg.method && this.handlers.has(msg.method)) {
      for (const h of this.handlers.get(msg.method)) h(msg.params || {});
    }
  }

  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(handler);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((r, j) => { this.pending.set(id, { r, j }); });
  }

  close() {
    this.ws.close();
  }
}

// ── Browser helpers ──

export async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails;
    const text = detail.exception?.description || detail.exception?.value || detail.text || JSON.stringify(detail);
    throw new Error(`Browser eval failed: ${text}`);
  }
  return result.result?.value;
}

export async function waitFor(client, expression, message, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(client, `Boolean(${expression})`)) return;
    await delay(100);
  }
  throw new Error(message);
}

export async function click(client, selector) {
  const clicked = await evaluate(client, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Missing clickable element: ${selector}`);
}

export async function pressKey(client, key, code, windowsVirtualKeyCode) {
  await evaluate(client, "document.activeElement?.blur?.(); document.body.tabIndex = -1; document.body.focus();");
  const params = { key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode };
  await client.send("Input.dispatchKeyEvent", { type: "keyDown", ...params });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", ...params });
}

// ── Cleanup ──

export async function cleanupTestData(baseUrl, prefix) {
  const removeNote = async (id) => {
    await api(baseUrl, "delete_note", { id }).catch(() => {});
    await api(baseUrl, "delete_permanently", { id }).catch(() => {});
  };
  const removeMindmap = async (id) => {
    await api(baseUrl, "delete_mindmap", { id }).catch(() => {});
    await api(baseUrl, "delete_mindmap_permanently", { id }).catch(() => {});
  };
  for (const note of await api(baseUrl, "list_notes").catch(() => [])) {
    if (note.title?.startsWith(prefix)) await removeNote(note.id);
  }
  for (const note of await api(baseUrl, "list_trash").catch(() => [])) {
    if (note.title?.startsWith(prefix)) await api(baseUrl, "delete_permanently", { id: note.id }).catch(() => {});
  }
  for (const m of await api(baseUrl, "list_mindmaps").catch(() => [])) {
    if (m.title?.startsWith(prefix)) await removeMindmap(m.id);
  }
  for (const m of await api(baseUrl, "list_mindmap_trash").catch(() => [])) {
    if (m.title?.startsWith(prefix)) await api(baseUrl, "delete_mindmap_permanently", { id: m.id }).catch(() => {});
  }
}

// ── Test framework ──

export function assertNoBrowserErrors(client, label) {
  if (!client || !client.browserErrors) return;
  if (client.browserErrors.length > 0) {
    const msgs = client.browserErrors.map((e) => `${e.text} (${e.url}:${e.line})`).join("\n  ");
    console.error(`FAIL ${label || "browser errors"}:\n  ${msgs}`);
    return client.browserErrors.length;
  }
  return 0;
}

export function pass(name) {
  console.log(`PASS ${name}`);
}

export function fail(name, error) {
  console.error(`FAIL ${name}`);
  console.error(error?.stack || error);
  return 1;
}

export async function step(name, fn) {
  try {
    await fn();
    pass(name);
    return 0;
  } catch (error) {
    return fail(name, error);
  }
}
