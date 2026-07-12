import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";

const port = Number(process.env.PORT || 1420);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}
const root = process.cwd();
const distDir = join(root, "dist");
const dataDir = join(root, "local-data");
const notesDir = join(dataDir, "notes");
const trashDir = join(dataDir, "trash");
const mindmapsDir = join(dataDir, "mindmaps");
const mindmapsTrashDir = join(dataDir, "mindmaps_trash");
const settingsFile = join(dataDir, "settings.json");

const defaultSettings = { language: "zh", title: "寻找心灵的碎片..." };
const DEFAULT_NOTE_TITLE = "未命名想法";
const DEFAULT_MINDMAP_TITLE = "未命名导图";

if (!existsSync(join(distDir, "index.html"))) {
  execFileSync("npm.cmd", ["run", "web:build"], { cwd: root, stdio: "ignore" });
}

await mkdir(notesDir, { recursive: true });
await mkdir(trashDir, { recursive: true });
await mkdir(mindmapsDir, { recursive: true });
await mkdir(mindmapsTrashDir, { recursive: true });

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
  if (expectedRevision == null || expectedRevision === "") return;
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") {
      throw apiError("Item not found", "NOT_FOUND", 404);
    }
    throw apiError("IO error reading file", "IO", 500);
  }
  const current = createHash("sha256").update(raw, "utf8").digest("hex");
  if (current !== expectedRevision) {
    const err = apiError("Revision conflict: the item was modified by another session", "CONFLICT", 409);
    err.currentRevision = current;
    throw err;
  }
}

async function atomicWriteText(file, text) {
  const dir = dirname(file);
  const temp = join(dir, `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
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
    await rename(temp, file);
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
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return { ...defaultSettings };
  }
}

async function saveSettings(settings) {
  await atomicWriteText(settingsFile, JSON.stringify(settings, null, 2));
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
}

function resolveTitle(title, fallback) {
  const normalized = String(title || "").split(/\s+/).join(" ").trim() || fallback;
  if (Array.from(normalized).length > MAX_TITLE_LEN) throw apiError(`Title too long (max ${MAX_TITLE_LEN})`, "VALIDATION", 400);
  return normalized;
}

function validateMindmapNode(node) {
  if (!node || typeof node !== "object") throw apiError("Invalid mindmap node", "VALIDATION", 400);
  ensureId(node.id);
  if (typeof node.text !== "string") throw apiError("Invalid mindmap node text", "VALIDATION", 400);
  if (typeof node.collapsed !== "boolean") node.collapsed = Boolean(node.collapsed);
  if (!Array.isArray(node.children)) node.children = [];
  node.children.forEach(validateMindmapNode);
}

function validateMindmap(map) {
  if (!map || typeof map !== "object") throw apiError("Invalid mindmap", "VALIDATION", 400);
  ensureId(map.id);
  if (typeof map.title !== "string") throw apiError("Invalid mindmap title", "VALIDATION", 400);
  if (Array.from(map.title).length > MAX_TITLE_LEN) throw apiError(`Title too long (max ${MAX_TITLE_LEN})`, "VALIDATION", 400);
  if (!Array.isArray(map.nodes)) map.nodes = [];
  map.nodes.forEach(validateMindmapNode);
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
      const baseName = file.slice(0, -4);
      const mainPath = join(dir, baseName);
      if (!existsSync(mainPath)) {
        await rename(join(dir, file), mainPath).catch(() => {});
        console.warn(`Recovered ${baseName} from .bak in ${dir}`);
      }
    }
  }
}

async function handleApi(request, response) {
  const command = new URL(request.url, `http://127.0.0.1:${port}`).pathname.replace("/api/", "");
  const body = await readJson(request);

  if (command === "list_notes") return sendJson(response, await listNotes());

  if (command === "create_note") {
    const id = randomUUID();
    const title = resolveTitle(body?.title, DEFAULT_NOTE_TITLE);
    await atomicWriteText(notePath(id), serializeNote(title, ""));
    return sendJson(response, await readNote(id));
  }

  if (command === "save_note") {
    await checkRevision(notePath(body.id), body.expectedRevision);
    validateNoteContent(body.title, body.body);
    await atomicWriteText(notePath(body.id), serializeNote(body.title, body.body));
    return sendJson(response, await readNote(body.id));
  }

  if (command === "delete_note") {
    await checkRevision(notePath(body.id), body.expectedRevision);
    const src = notePath(body.id);
    const dst = trashNotePath(body.id);
    if (existsSync(dst)) throw apiError("A trashed note with this id already exists", "VALIDATION", 400);
    try {
      await rename(src, dst);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    response.writeHead(204);
    return response.end();
  }

  if (command === "list_trash") return sendJson(response, await listTrashNotes());

  if (command === "restore_note") {
    await checkRevision(trashNotePath(body.id), body.expectedRevision);
    const src = trashNotePath(body.id);
    const dst = notePath(body.id);
    if (existsSync(dst)) throw apiError("A note with this id already exists", "VALIDATION", 400);
    await rename(src, dst);
    return sendJson(response, await readNote(body.id));
  }

  if (command === "delete_permanently") {
    await checkRevision(trashNotePath(body.id), body.expectedRevision);
    await rm(trashNotePath(body.id), { force: true });
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
    await checkRevision(mindmapPath(data.id), body.expectedRevision);
    validateMindmap(data);
    const { revision: _rev, ...clean } = data;
    const mm = { ...clean, updatedAt: nowMillis() };
    const json = JSON.stringify(mm);
    await atomicWriteText(mindmapPath(data.id), json);
    mm.revision = computeRevision(json);
    return sendJson(response, mm);
  }

  if (command === "delete_mindmap") {
    await checkRevision(mindmapPath(body.id), body.expectedRevision);
    const dst = mindmapTrashPath(body.id);
    if (existsSync(dst)) throw apiError("A trashed mindmap with this id already exists", "VALIDATION", 400);
    try {
      await rename(mindmapPath(body.id), dst);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    response.writeHead(204);
    return response.end();
  }

  if (command === "list_mindmap_trash") return sendJson(response, await listMindmapTrash());

  if (command === "restore_mindmap") {
    await checkRevision(mindmapTrashPath(body.id), body.expectedRevision);
    const src = mindmapTrashPath(body.id);
    const dst = mindmapPath(body.id);
    if (existsSync(dst)) throw apiError("A mindmap with this id already exists", "VALIDATION", 400);
    await rename(src, dst);
    const mm = await readMindmapFile(dst);
    if (!mm) throw apiError("Failed to read restored mindmap", "IO", 500);
    return sendJson(response, mm);
  }

  if (command === "delete_mindmap_permanently") {
    await checkRevision(mindmapTrashPath(body.id), body.expectedRevision);
    await rm(mindmapTrashPath(body.id), { force: true });
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
}).listen(port, "127.0.0.1", () => {
  console.log(`XG221B is running at http://127.0.0.1:${port}`);
});
