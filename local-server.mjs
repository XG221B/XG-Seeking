import { execFileSync, execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const port = Number(process.env.PORT || 1420);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error("PORT must be an integer between 0 and 65535");
}
const allowPortZero = port === 0;
const root = process.cwd();
const distDir = join(root, "dist");
const dataDir = join(root, "local-data");
const notesDir = join(dataDir, "notes");
const trashDir = join(dataDir, "trash");
const mindmapsDir = join(dataDir, "mindmaps");
const mindmapsTrashDir = join(dataDir, "mindmaps_trash");
const settingsFile = join(dataDir, "settings.json");
const lockRoot = join(tmpdir(), "xg-seeking-locks", computeRevision(resolve(dataDir)).slice(0, 20));

const defaultSettings = { language: "zh", title: "寻找心灵的碎片...", theme: "system" };
const DEFAULT_NOTE_TITLE = "未命名想法";
const DEFAULT_MINDMAP_TITLE = "未命名导图";

if (!existsSync(join(distDir, "index.html"))) {
  const viteCli = join(root, "node_modules", "vite", "bin", "vite.js");
  execFileSync(process.execPath, [viteCli, "build"], { cwd: root, stdio: "ignore" });
}

await mkdir(notesDir, { recursive: true });
await mkdir(trashDir, { recursive: true });
await mkdir(mindmapsDir, { recursive: true });
await mkdir(mindmapsTrashDir, { recursive: true });
await mkdir(lockRoot, { recursive: true });

function nowMillis() {
  return Date.now();
}

function apiError(message, code = "VALIDATION", statusCode = 400) {
  const err = new Error(message);
  err.errorCode = code;
  err.statusCode = statusCode;
  return err;
}

function computeRevision(raw) {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

async function checkRevision(filePath, expectedRevision) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") {
      throw apiError("Item not found", "NOT_FOUND", 404);
    }
    throw apiError("IO error reading file", "IO", 500);
  }
  if (expectedRevision == null || expectedRevision === "") return;
  const current = computeRevision(raw);
  if (current !== expectedRevision) {
    const err = apiError("Revision conflict: the item was modified by another session", "CONFLICT", 409);
    err.currentRevision = current;
    throw err;
  }
}

async function atomicWriteText(file, text) {
  const dir = dirname(file);
  const base = file.split(/[/\\]/).pop() || "untitled";
  const temp = join(dir, `.${base}.${randomUUID()}.tmp`);
  const backup = join(dir, `.${base}.bak`);
  let fh;
  try {
    fh = await open(temp, "w");
    try {
      await fh.writeFile(text, "utf8");
      await fh.sync();
    } finally {
      await fh.close();
      fh = null;
    }
    if (existsSync(file)) {
      await rm(backup, { force: true }).catch(() => {});
      await rename(file, backup);
    }
    try {
      await rename(temp, file);
    } catch (renameError) {
      await rm(temp, { force: true }).catch(() => {});
      if (existsSync(backup)) {
        await rename(backup, file).catch(() => {});
      }
      throw renameError;
    }
    try {
      const dh = await open(dir, "r");
      try {
        await dh.sync();
      } finally {
        await dh.close();
      }
    } catch {
      // Directory sync not supported on this platform
    }
    await rm(backup, { force: true }).catch(() => {});
  } catch (error) {
    if (fh) await fh.close().catch(() => {});
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

function ensureId(id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id || "")) {
    throw apiError("Invalid id", "VALIDATION", 400);
  }
}

function notePath(id) {
  ensureId(id);
  return join(notesDir, `${id}.md`);
}

function trashNotePath(id) {
  ensureId(id);
  return join(trashDir, `${id}.md`);
}

function parseNote(id, markdown, updatedAt) {
  const normalized = String(markdown || "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const first = lines[0] || "";

  if (first.startsWith("# ")) {
    const title = first.slice(2).trim() || DEFAULT_NOTE_TITLE;
    const body = lines.slice(lines[1] === "" ? 2 : 1).join("\n");
    return { id, title, body, updatedAt };
  }

  return { id, title: DEFAULT_NOTE_TITLE, body: normalized, updatedAt };
}

function serializeNote(title, body) {
  const safeTitle = String(title || "").split(/\s+/).join(" ").trim() || DEFAULT_NOTE_TITLE;
  return `# ${safeTitle}\n\n${String(body || "").replace(/\r\n/g, "\n")}`;
}

async function readNote(id) {
  const file = notePath(id);
  const [markdown, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
  const note = parseNote(id, markdown, info.mtimeMs);
  note.revision = computeRevision(markdown);
  return note;
}

async function readTrashNote(id) {
  const file = trashNotePath(id);
  const [markdown, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
  const note = parseNote(id, markdown, info.mtimeMs);
  note.revision = computeRevision(markdown);
  return note;
}

async function listNotes() {
  const files = await readdir(notesDir);
  const notes = (
    await Promise.all(
      files
        .filter((file) => extname(file) === ".md")
        .map((file) => readNote(file.slice(0, -3)).catch((e) => {
          console.warn(`Warning: Failed to read note ${file}: ${e.message}`);
          return null;
        })),
    )
  ).filter(Boolean);
  return notes.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function listTrashNotes() {
  let files;
  try {
    files = await readdir(trashDir);
  } catch {
    return [];
  }
  const notes = (
    await Promise.all(
      files
        .filter((file) => extname(file) === ".md")
        .map((file) => readTrashNote(file.slice(0, -3)).catch((e) => {
          console.warn(`Warning: Failed to read trash note ${file}: ${e.message}`);
          return null;
        })),
    )
  ).filter(Boolean);
  return notes.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function loadSettings() {
  try {
    const raw = await readFile(settingsFile, "utf8");
    return normalizeSettings(JSON.parse(raw));
  } catch (error) {
    if (error?.code === "ENOENT") return { ...defaultSettings, warnings: [] };
    return { ...defaultSettings, warnings: ["SETTINGS_UNREADABLE"] };
  }
}

async function countUnreadable(dir, extension, reader) {
  const files = (await readdir(dir).catch(() => [])).filter((file) => extname(file) === extension);
  let unreadable = 0;
  for (const file of files) {
    try {
      const value = await reader(file);
      if (!value) unreadable += 1;
    } catch {
      unreadable += 1;
    }
  }
  return unreadable;
}

async function getStorageWarnings() {
  const [notes, trashNotes, mindmaps, mindmapTrash] = await Promise.all([
    countUnreadable(notesDir, ".md", (file) => readNote(file.slice(0, -3))),
    countUnreadable(trashDir, ".md", (file) => readTrashNote(file.slice(0, -3))),
    countUnreadable(mindmapsDir, ".json", (file) => readMindmapFile(join(mindmapsDir, file))),
    countUnreadable(mindmapsTrashDir, ".json", (file) => readMindmapFile(join(mindmapsTrashDir, file))),
  ]);
  const settings = (await loadSettings()).warnings?.length ? 1 : 0;
  return { notes, trashNotes, mindmaps, mindmapTrash, settings, total: notes + trashNotes + mindmaps + mindmapTrash + settings };
}

async function acquirePathLock(filePath) {
  const lockPath = join(lockRoot, `${computeRevision(resolve(filePath)).slice(0, 32)}.lock`);
  const deadline = Date.now() + 15_000;
  while (true) {
    try {
      await mkdir(lockPath);
      return async () => { await rm(lockPath, { recursive: true, force: true }).catch(() => {}); };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > 30_000) {
          await rm(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() >= deadline) throw apiError("Timed out waiting for storage lock", "IO", 503);
      await delay(25);
    }
  }
}

async function withPathLocks(paths, operation) {
  const releases = [];
  const ordered = [...new Set(paths.map((path) => resolve(path)))].sort();
  try {
    for (const path of ordered) releases.push(await acquirePathLock(path));
    return await operation();
  } finally {
    for (const release of releases.reverse()) await release();
  }
}

async function saveSettings(settings) {
  await atomicWriteText(settingsFile, JSON.stringify(normalizeSettings(settings), null, 2));
}

function normalizeSettings(settings = {}) {
  return {
    language: settings.language === "en" ? "en" : "zh",
    title: typeof settings.title === "string" && settings.title.trim() ? settings.title.trim() : defaultSettings.title,
    theme: settings.theme === "light" || settings.theme === "dark" ? settings.theme : "system",
  };
}

// ── Mindmaps ──

function mindmapPath(id) {
  ensureId(id);
  return join(mindmapsDir, `${id}.json`);
}

function mindmapTrashPath(id) {
  ensureId(id);
  return join(mindmapsTrashDir, `${id}.json`);
}

async function listMindmaps() {
  const files = await readdir(mindmapsDir).catch(() => []);
  const maps = (
    await Promise.all(
      files
        .filter((f) => extname(f) === ".json")
        .map((f) => readMindmapFile(join(mindmapsDir, f))),
    )
  ).filter(Boolean);
  return maps.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function listMindmapTrash() {
  const files = await readdir(mindmapsTrashDir).catch(() => []);
  const maps = (
    await Promise.all(
      files
        .filter((f) => extname(f) === ".json")
        .map((f) => readMindmapFile(join(mindmapsTrashDir, f))),
    )
  ).filter(Boolean);
  return maps.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function readMindmapFile(file) {
  try {
    const info = await stat(file);
    if (info.size > MAX_MINDMAP_BYTES) throw apiError("Mindmap file too large", "VALIDATION", 400);
    const raw = await readFile(file, "utf8");
    const map = JSON.parse(raw);
    validateMindmap(map);
    map.revision = computeRevision(raw);
    return map;
  } catch (e) {
    console.warn(`Warning: Failed to read mindmap file ${file}: ${e.message}`);
    return null;
  }
}

const MAX_BODY = 1_048_576; // 1 MB
const MAX_TITLE_LEN = 500;
const MAX_BODY_LEN = 100_000;
const MAX_MINDMAP_BYTES = 1_048_576;
const MAX_MINDMAP_NODES = 5_000;
const MAX_MINDMAP_DEPTH = 100;
const MAX_NODE_TEXT_LEN = 10_000;

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw apiError("Request body too large", "VALIDATION", 400);
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function validateNoteContent(title, body) {
  if (title && Array.from(title).length > MAX_TITLE_LEN) throw apiError(`Title too long (max ${MAX_TITLE_LEN})`, "VALIDATION", 400);
  if (body && Array.from(body).length > MAX_BODY_LEN) throw apiError(`Body too long (max ${MAX_BODY_LEN})`, "VALIDATION", 400);
  if (title != null && String(title).trim() === "") throw apiError("Title must not be empty", "VALIDATION", 400);
}

function resolveTitle(title, fallback) {
  const normalized = String(title || "").split(/\s+/).join(" ").trim() || fallback;
  if (Array.from(normalized).length > MAX_TITLE_LEN) throw apiError(`Title too long (max ${MAX_TITLE_LEN})`, "VALIDATION", 400);
  return normalized;
}

function validateMindmap(map) {
  if (!map || typeof map !== "object") throw apiError("Invalid mindmap", "VALIDATION", 400);
  ensureId(map.id);
  if (typeof map.title !== "string") throw apiError("Invalid mindmap title", "VALIDATION", 400);
  if (Array.from(map.title).length > MAX_TITLE_LEN) throw apiError(`Title too long (max ${MAX_TITLE_LEN})`, "VALIDATION", 400);
  if (!Array.isArray(map.nodes)) map.nodes = [];
  const stack = map.nodes.map((node) => ({ node, depth: 1 }));
  let count = 0;
  while (stack.length) {
    const { node, depth } = stack.pop();
    count += 1;
    if (count > MAX_MINDMAP_NODES) throw apiError(`Too many mindmap nodes (max ${MAX_MINDMAP_NODES})`, "VALIDATION", 400);
    if (depth > MAX_MINDMAP_DEPTH) throw apiError(`Mindmap nesting too deep (max ${MAX_MINDMAP_DEPTH})`, "VALIDATION", 400);
    if (!node || typeof node !== "object") throw apiError("Invalid mindmap node", "VALIDATION", 400);
    ensureId(node.id);
    if (typeof node.text !== "string") throw apiError("Invalid mindmap node text", "VALIDATION", 400);
    if (Array.from(node.text).length > MAX_NODE_TEXT_LEN) throw apiError(`Mindmap node text too long (max ${MAX_NODE_TEXT_LEN})`, "VALIDATION", 400);
    if (typeof node.collapsed !== "boolean") node.collapsed = Boolean(node.collapsed);
    if (!Array.isArray(node.children)) node.children = [];
    for (const child of node.children) stack.push({ node: child, depth: depth + 1 });
  }
}

function sendJson(response, value, statusCode = 200) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function sendError(response, error, code = "IO", statusCode = 500) {
  const message = error instanceof Error ? error.message : String(error);
  const errCode = error.errorCode || code;
  const errStatus = error.statusCode || statusCode;
  const body = { code: errCode, message };
  if (error.currentRevision) body.currentRevision = error.currentRevision;
  response.writeHead(errStatus, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function recoverBakFiles(dir) {
  let files;
  try {
    files = await readdir(dir);
  } catch {
    return;
  }
  for (const file of files) {
    if (file.endsWith(".tmp")) {
      await rm(join(dir, file), { force: true }).catch(() => {});
    } else if (file.endsWith(".bak")) {
      const baseName = file.startsWith(".") ? file.slice(1, -4) : file.slice(0, -4);
      const mainPath = join(dir, baseName);
      if (!existsSync(mainPath)) {
        await rename(join(dir, file), mainPath).catch(() => {});
        console.warn(`Recovered ${baseName} from .bak in ${dir}`);
      }
    }
  }
}

function validateApiRequest(request) {
  if (request.method !== "POST") throw apiError("API requests must use POST", "VALIDATION", 405);
  const contentType = String(request.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw apiError("API requests must use application/json", "VALIDATION", 415);
  }

  const host = String(request.headers.host || "");
  let hostUrl;
  try { hostUrl = new URL(`http://${host}`); } catch { throw apiError("Invalid Host header", "VALIDATION", 400); }
  if (hostUrl.hostname !== "127.0.0.1" && hostUrl.hostname !== "localhost") {
    throw apiError("Host is not allowed", "VALIDATION", 403);
  }

  const origin = request.headers.origin;
  if (origin) {
    let originUrl;
    try { originUrl = new URL(origin); } catch { throw apiError("Invalid Origin header", "VALIDATION", 403); }
    if (originUrl.protocol !== "http:" || originUrl.host !== hostUrl.host) {
      throw apiError("Origin is not allowed", "VALIDATION", 403);
    }
  }
}

async function handleApi(request, response) {
  validateApiRequest(request);
  const command = new URL(request.url, `http://127.0.0.1:${port}`).pathname.replace("/api/", "");
  const body = await readJson(request);

  if (command === "get_data_directory") {
    await mkdir(dataDir, { recursive: true });
    return sendJson(response, { path: dataDir });
  }

  if (command === "open_data_directory") {
    execFile("explorer.exe", [dataDir], { windowsHide: true });
    response.writeHead(204);
    return response.end();
  }

  if (command === "list_notes") return sendJson(response, await listNotes());

  if (command === "create_note") {
    const id = randomUUID();
    const title = resolveTitle(body?.title, DEFAULT_NOTE_TITLE);
    await atomicWriteText(notePath(id), serializeNote(title, ""));
    return sendJson(response, await readNote(id));
  }

  if (command === "save_note") {
    validateNoteContent(body.title, body.body);
    const path = notePath(body.id);
    let saved;
    await withPathLocks([path], async () => {
      await checkRevision(path, body.expectedRevision);
      await atomicWriteText(path, serializeNote(body.title, body.body));
      saved = await readNote(body.id);
    });
    return sendJson(response, saved);
  }

  if (command === "get_storage_warnings") return sendJson(response, await getStorageWarnings());

  if (command === "delete_note") {
    const src = notePath(body.id);
    const dst = trashNotePath(body.id);
    await withPathLocks([src, dst], async () => {
      await checkRevision(src, body.expectedRevision);
      if (existsSync(dst)) throw apiError("A trashed note with this id already exists", "VALIDATION", 400);
      await rename(src, dst);
    });
    response.writeHead(204);
    return response.end();
  }

  if (command === "list_trash") return sendJson(response, await listTrashNotes());

  if (command === "restore_note") {
    const src = trashNotePath(body.id);
    const dst = notePath(body.id);
    await withPathLocks([src, dst], async () => {
      await checkRevision(src, body.expectedRevision);
      if (existsSync(dst)) throw apiError("A note with this id already exists", "VALIDATION", 400);
      await rename(src, dst);
    });
    return sendJson(response, await readNote(body.id));
  }

  if (command === "delete_permanently") {
    const path = trashNotePath(body.id);
    await withPathLocks([path], async () => {
      await checkRevision(path, body.expectedRevision);
      await rm(path);
    });
    response.writeHead(204);
    return response.end();
  }

  if (command === "get_settings") return sendJson(response, await loadSettings());

  if (command === "save_settings") {
    await saveSettings(body);
    response.writeHead(204);
    return response.end();
  }

  // ── Mindmaps ──

  if (command === "list_mindmaps") return sendJson(response, await listMindmaps());

  if (command === "create_mindmap") {
    const id = randomUUID();
    const title = resolveTitle(body?.title, DEFAULT_MINDMAP_TITLE);
    const mm = {
      id,
      title,
      updatedAt: nowMillis(),
      nodes: [],
    };
    const json = JSON.stringify(mm);
    await atomicWriteText(mindmapPath(id), json);
    mm.revision = computeRevision(json);
    return sendJson(response, mm);
  }

  if (command === "save_mindmap") {
    const data = body.mm || body;
    validateMindmap(data);
    const { revision: _rev, ...clean } = data;
    const mm = { ...clean, updatedAt: nowMillis() };
    const json = JSON.stringify(mm);
    const path = mindmapPath(data.id);
    await withPathLocks([path], async () => {
      await checkRevision(path, body.expectedRevision);
      await atomicWriteText(path, json);
    });
    mm.revision = computeRevision(json);
    return sendJson(response, mm);
  }

  if (command === "delete_mindmap") {
    const src = mindmapPath(body.id);
    const dst = mindmapTrashPath(body.id);
    await withPathLocks([src, dst], async () => {
      await checkRevision(src, body.expectedRevision);
      if (existsSync(dst)) throw apiError("A trashed mindmap with this id already exists", "VALIDATION", 400);
      await rename(src, dst);
    });
    response.writeHead(204);
    return response.end();
  }

  if (command === "list_mindmap_trash") return sendJson(response, await listMindmapTrash());

  if (command === "restore_mindmap") {
    const src = mindmapTrashPath(body.id);
    const dst = mindmapPath(body.id);
    await withPathLocks([src, dst], async () => {
      await checkRevision(src, body.expectedRevision);
      if (existsSync(dst)) throw apiError("A mindmap with this id already exists", "VALIDATION", 400);
      await rename(src, dst);
    });
    const mm = await readMindmapFile(dst);
    if (!mm) throw apiError("Failed to read restored mindmap", "IO", 500);
    return sendJson(response, mm);
  }

  if (command === "delete_mindmap_permanently") {
    const path = mindmapTrashPath(body.id);
    await withPathLocks([path], async () => {
      await checkRevision(path, body.expectedRevision);
      await rm(path);
    });
    response.writeHead(204);
    return response.end();
  }

  sendError(response, apiError("Unknown command", "NOT_FOUND", 404));
}

function serveStatic(request, response) {
  // Block path traversal in raw URL before parser normalizes it
  if (request.url.includes("..")) {
    response.writeHead(403);
    response.end();
    return;
  }

  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const file = resolve(distDir, `.${normalize(requested)}`);

  // Block any path traversal attempts in raw pathname
  if (requested.includes("..")) {
    response.writeHead(403);
    response.end();
    return;
  }

  // Path traversal protection
  const resolvedDist = resolve(distDir);
  if (!file.toLowerCase().startsWith(resolvedDist.toLowerCase())) {
    response.writeHead(403);
    response.end();
    return;
  }

  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".ico": "image/x-icon",
  };

  if (!existsSync(file)) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
  createReadStream(file).pipe(response);
}

// ── Auto-recovery on startup ──
await recoverBakFiles(notesDir);
await recoverBakFiles(trashDir);
await recoverBakFiles(mindmapsDir);
await recoverBakFiles(mindmapsTrashDir);

createServer((request, response) => {
  if (request.url?.startsWith("/api/")) {
    handleApi(request, response).catch((error) => sendError(response, error));
    return;
  }
  serveStatic(request, response);
}).listen(allowPortZero ? 0 : port, "127.0.0.1", function () {
  const assignedPort = this.address().port;
  console.log(`XG221B is running at http://127.0.0.1:${assignedPort}`);
  if (allowPortZero) console.log(`ASSIGNED_PORT=${assignedPort}`);
});
