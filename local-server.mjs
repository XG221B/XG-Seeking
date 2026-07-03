import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const port = 1420;
const root = process.cwd();
const distDir = join(root, "dist");
const dataDir = join(root, "local-data");
const notesDir = join(dataDir, "notes");
const trashDir = join(dataDir, "trash");
const settingsFile = join(dataDir, "settings.json");

const defaultSettings = { language: "zh", title: "寻找心灵的碎片..." };

if (!existsSync(join(distDir, "index.html"))) {
  execFileSync("npm.cmd", ["run", "web:build"], { cwd: root, stdio: "ignore" });
}

await mkdir(notesDir, { recursive: true });
await mkdir(trashDir, { recursive: true });

function nowMillis() {
  return Date.now();
}

function ensureId(id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id || "")) {
    throw new Error("Invalid note id");
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
    const title = first.slice(2).trim() || "未命名想法";
    const body = lines.slice(lines[1] === "" ? 2 : 1).join("\n");
    return { id, title, body, updatedAt };
  }

  return { id, title: "未命名想法", body: normalized, updatedAt };
}

function serializeNote(title, body) {
  const safeTitle = String(title || "").split(/\s+/).join(" ").trim() || "未命名想法";
  return `# ${safeTitle}\n\n${String(body || "").replace(/\r\n/g, "\n")}`;
}

async function readNote(id) {
  const file = notePath(id);
  const [markdown, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
  return parseNote(id, markdown, info.mtimeMs);
}

async function readTrashNote(id) {
  const file = trashNotePath(id);
  const [markdown, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
  return parseNote(id, markdown, info.mtimeMs);
}

async function listNotes() {
  const files = await readdir(notesDir);
  const notes = await Promise.all(
    files
      .filter((file) => extname(file) === ".md")
      .map((file) => readNote(file.slice(0, -3))),
  );
  return notes.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function listTrashNotes() {
  let files;
  try {
    files = await readdir(trashDir);
  } catch {
    return [];
  }
  const notes = await Promise.all(
    files
      .filter((file) => extname(file) === ".md")
      .map((file) => readTrashNote(file.slice(0, -3))),
  );
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
  await writeFile(settingsFile, JSON.stringify(settings, null, 2), "utf8");
}

const MAX_BODY = 1_048_576; // 1 MB
const MAX_TITLE_LEN = 500;
const MAX_BODY_LEN = 100_000;

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function validateNoteContent(title, body) {
  if (title && title.length > MAX_TITLE_LEN) throw new Error(`Title too long (max ${MAX_TITLE_LEN})`);
  if (body && body.length > MAX_BODY_LEN) throw new Error(`Body too long (max ${MAX_BODY_LEN})`);
}

function sendJson(response, value) {
  response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function sendError(response, error, code = 500) {
  response.writeHead(code, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(error instanceof Error ? error.message : String(error));
}

async function handleApi(request, response) {
  const command = new URL(request.url, `http://127.0.0.1:${port}`).pathname.replace("/api/", "");
  const body = await readJson(request);

  if (command === "list_notes") return sendJson(response, await listNotes());

  if (command === "create_note") {
    const id = `note-${nowMillis()}`;
    await writeFile(notePath(id), serializeNote("未命名想法", ""), "utf8");
    return sendJson(response, await readNote(id));
  }

  if (command === "save_note") {
    validateNoteContent(body.title, body.body);
    await writeFile(notePath(body.id), serializeNote(body.title, body.body), "utf8");
    return sendJson(response, await readNote(body.id));
  }

  // Soft-delete: move to trash instead of removing
  if (command === "delete_note") {
    const src = notePath(body.id);
    const dst = trashNotePath(body.id);
    try {
      await rename(src, dst);
    } catch {
      // If the file is already gone, that's fine
    }
    response.writeHead(204);
    return response.end();
  }

  if (command === "list_trash") return sendJson(response, await listTrashNotes());

  if (command === "restore_note") {
    const src = trashNotePath(body.id);
    const dst = notePath(body.id);
    await rename(src, dst);
    return sendJson(response, await readNote(body.id));
  }

  if (command === "delete_permanently") {
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

  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Unknown command");
}

function serveStatic(request, response) {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const file = resolve(distDir, `.${normalize(requested)}`);

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

  response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
  createReadStream(file).on("error", () => {
    response.writeHead(404);
    response.end();
  }).pipe(response);
}

createServer((request, response) => {
  if (request.url?.startsWith("/api/")) {
    handleApi(request, response).catch((error) => sendError(response, error));
    return;
  }
  serveStatic(request, response);
}).listen(port, "127.0.0.1", () => {
  console.log(`XG221B is running at http://127.0.0.1:${port}`);
});
