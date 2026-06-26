import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const port = 1420;
const root = process.cwd();
const distDir = join(root, "dist");
const notesDir = join(root, "local-data", "notes");

if (!existsSync(join(distDir, "index.html"))) {
  execFileSync("npm.cmd", ["run", "web:build"], { cwd: root, stdio: "ignore" });
}

await mkdir(notesDir, { recursive: true });

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

async function listNotes() {
  const files = await readdir(notesDir);
  const notes = await Promise.all(
    files
      .filter((file) => extname(file) === ".md")
      .map((file) => readNote(file.slice(0, -3))),
  );
  return notes.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function sendJson(response, value) {
  response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function sendError(response, error) {
  response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
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
    await writeFile(notePath(body.id), serializeNote(body.title, body.body), "utf8");
    return sendJson(response, await readNote(body.id));
  }

  if (command === "delete_note") {
    await rm(notePath(body.id), { force: true });
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

  if (!file.startsWith(resolve(distDir))) {
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
