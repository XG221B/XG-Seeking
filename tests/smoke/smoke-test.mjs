#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const port = 24_000 + Math.floor(Math.random() * 10_000);
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = join(root, "local-data");
const runId = Date.now().toString(36);
const testPrefix = `AI_TEST_SMOKE_${runId}`;
const createdNotes = new Set();
const createdMindmaps = new Set();
const createdFiles = new Set();

let server = null;
let failures = 0;

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

async function canReachServer() {
  try {
    await api("get_settings");
    return true;
  } catch {
    return false;
  }
}

async function waitForServer() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await canReachServer()) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`local-server did not become ready on 127.0.0.1:${port}`);
}

async function startServer() {
  server = spawn(process.execPath, ["local-server.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  server.stdout.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitForServer();
}

async function removeNote(id) {
  await api("delete_note", { id }).catch(() => {});
  await api("delete_permanently", { id }).catch(() => {});
}

async function removeMindmap(id) {
  await api("delete_mindmap", { id }).catch(() => {});
  await api("delete_mindmap_permanently", { id }).catch(() => {});
}

async function cleanupCreatedData() {
  for (const id of createdNotes) await removeNote(id);
  for (const id of createdMindmaps) await removeMindmap(id);
  for (const file of createdFiles) await rm(file, { force: true }).catch(() => {});
}

async function cleanupStaleSmokeData() {
  for (const note of await api("list_notes")) {
    if (note.title?.startsWith("AI_TEST_SMOKE_")) await removeNote(note.id);
  }
  for (const note of await api("list_trash")) {
    if (note.title?.startsWith("AI_TEST_SMOKE_")) await api("delete_permanently", { id: note.id });
  }
  for (const mindmap of await api("list_mindmaps")) {
    if (mindmap.title?.startsWith("AI_TEST_SMOKE_")) await removeMindmap(mindmap.id);
  }
  for (const mindmap of await api("list_mindmap_trash")) {
    if (mindmap.title?.startsWith("AI_TEST_SMOKE_")) {
      await api("delete_mindmap_permanently", { id: mindmap.id });
    }
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function noteCrudTrashRestore() {
  const title = `${testPrefix}_NOTE`;
  const note = await api("create_note", { title });
  createdNotes.add(note.id);
  assert(note.title === title, "created note title mismatch");

  const body = "# Heading\n\nline 1\nline 2\n\n- item";
  const saved = await api("save_note", { id: note.id, title, body });
  assert(saved.body === body, "saved note body mismatch");

  const notes = await api("list_notes");
  assert(notes.some((item) => item.id === note.id), "saved note not listed");

  await api("delete_note", { id: note.id });
  const trash = await api("list_trash");
  assert(trash.some((item) => item.id === note.id && item.title === title), "deleted note not in trash");

  const restored = await api("restore_note", { id: note.id });
  assert(restored.id === note.id && restored.body === body, "restored note mismatch");

  await api("delete_note", { id: note.id });
  await api("delete_permanently", { id: note.id });
  createdNotes.delete(note.id);

  const finalTrash = await api("list_trash");
  assert(!finalTrash.some((item) => item.id === note.id), "note remained in trash after permanent delete");
}

async function defaultTitleContracts() {
  const englishNote = await api("create_note", { title: "Untitled" });
  createdNotes.add(englishNote.id);
  assert(englishNote.title === "Untitled", "English note default title was not persisted");
  await removeNote(englishNote.id);
  createdNotes.delete(englishNote.id);

  const chineseNote = await api("create_note", { title: "未命名想法" });
  createdNotes.add(chineseNote.id);
  assert(chineseNote.title === "未命名想法", "Chinese note default title was not persisted");
  await removeNote(chineseNote.id);
  createdNotes.delete(chineseNote.id);

  const englishMindmap = await api("create_mindmap", { title: "Untitled" });
  createdMindmaps.add(englishMindmap.id);
  assert(englishMindmap.title === "Untitled", "English mindmap default title was not persisted");
  await removeMindmap(englishMindmap.id);
  createdMindmaps.delete(englishMindmap.id);

  const chineseMindmap = await api("create_mindmap", { title: "未命名导图" });
  createdMindmaps.add(chineseMindmap.id);
  assert(chineseMindmap.title === "未命名导图", "Chinese mindmap default title was not persisted");
  await removeMindmap(chineseMindmap.id);
  createdMindmaps.delete(chineseMindmap.id);
}

async function mindmapCrudTrashRestore() {
  const title = `${testPrefix}_MINDMAP`;
  const mindmap = await api("create_mindmap", { title });
  createdMindmaps.add(mindmap.id);

  const nodes = [
    {
      id: `n-${runId}`,
      text: "Root",
      collapsed: false,
      children: [{ id: `n-${runId}-child`, text: "Child", collapsed: false, children: [] }],
    },
  ];
  const saved = await api("save_mindmap", { mm: { ...mindmap, nodes } });
  assert(saved.nodes?.[0]?.children?.[0]?.text === "Child", "saved mindmap nodes mismatch");

  await api("delete_mindmap", { id: mindmap.id });
  const trash = await api("list_mindmap_trash");
  assert(trash.some((item) => item.id === mindmap.id && item.title === title), "deleted mindmap not in trash");

  const restored = await api("restore_mindmap", { id: mindmap.id });
  assert(restored.nodes?.[0]?.text === "Root", "restored mindmap mismatch");

  await api("delete_mindmap", { id: mindmap.id });
  await api("delete_mindmap_permanently", { id: mindmap.id });
  createdMindmaps.delete(mindmap.id);
}

async function corruptedJsonTolerance() {
  const mindmapsDir = join(dataDir, "mindmaps");
  await mkdir(mindmapsDir, { recursive: true });
  const corruptFile = join(mindmapsDir, `${testPrefix}_BAD_MINDMAP.json`);
  createdFiles.add(corruptFile);
  await writeFile(corruptFile, "{ not json", "utf8");
  const maps = await api("list_mindmaps");
  assert(Array.isArray(maps), "list_mindmaps did not tolerate corrupt JSON");
  await rm(corruptFile, { force: true });
  createdFiles.delete(corruptFile);
}

async function validationAndSafety() {
  const badId = await fetch(`${baseUrl}/api/save_note`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "../bad", title: "AI_TEST_BAD", body: "" }),
  });
  assert(!badId.ok, "illegal note id was accepted");

  const longTitle = await fetch(`${baseUrl}/api/create_note`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "x".repeat(501) }),
  });
  assert(!longTitle.ok, "overlong title was accepted");
}

async function sourceSafetyChecks() {
  const mainSource = await readFile(join(root, "src", "main.js"), "utf8");
  const markdownSource = await readFile(join(root, "src", "markdown.js"), "utf8");
  assert(markdownSource.includes("escapeHtml"), "Markdown preview no longer imports escapeHtml");
  assert(markdownSource.includes("isSafeMarkdownUrl"), "Markdown link safety check missing");
  assert(markdownSource.includes("noreferrer"), "External preview links lost safe rel attribute");
}

async function noTempBackupLeftovers() {
  const leftovers = [];
  async function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".tmp") || entry.name.endsWith(".bak")) leftovers.push(full);
    }
  }
  await walk(dataDir);
  assert(leftovers.length === 0, `temporary/backup files left behind: ${leftovers.join(", ")}`);
}

try {
  await startServer();
  await cleanupStaleSmokeData();
  await step("note CRUD, trash, restore, permanent delete", noteCrudTrashRestore);
  await step("localized default title contracts", defaultTitleContracts);
  await step("mindmap CRUD, trash, restore, permanent delete", mindmapCrudTrashRestore);
  await step("corrupted mindmap JSON tolerance", corruptedJsonTolerance);
  await step("validation rejects unsafe input", validationAndSafety);
  await step("Markdown preview source safety guards", sourceSafetyChecks);
  await cleanupCreatedData();
  await step("no smoke test temp or backup leftovers", noTempBackupLeftovers);
} finally {
  await cleanupCreatedData().catch((error) => fail("cleanup", error));
  if (server) server.kill();
}

if (failures > 0) {
  console.error(`Smoke test failed with ${failures} failure(s).`);
  process.exit(1);
}

console.log("Smoke test passed.");
