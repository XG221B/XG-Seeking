#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startLocalServer, api, pass, fail, step } from "./helper.mjs";

const runId = Date.now().toString(36);
const testPrefix = `AI_TEST_SMOKE_${runId}`;
const createdNotes = new Set();
const createdMindmaps = new Set();
const createdFiles = new Set();

let server = null;
let baseUrl = "";
let failures = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function removeNote(id) {
  await api(baseUrl, "delete_note", { id }).catch(() => {});
  await api(baseUrl, "delete_permanently", { id }).catch(() => {});
}

async function removeMindmap(id) {
  await api(baseUrl, "delete_mindmap", { id }).catch(() => {});
  await api(baseUrl, "delete_mindmap_permanently", { id }).catch(() => {});
}

async function cleanupCreatedData() {
  for (const id of createdNotes) await removeNote(id);
  for (const id of createdMindmaps) await removeMindmap(id);
  for (const file of createdFiles) await rm(file, { force: true }).catch(() => {});
}

async function cleanupStaleSmokeData() {
  for (const note of await api(baseUrl, "list_notes")) {
    if (note.title?.startsWith("AI_TEST_SMOKE_")) await removeNote(note.id);
  }
  for (const note of await api(baseUrl, "list_trash")) {
    if (note.title?.startsWith("AI_TEST_SMOKE_")) await api(baseUrl, "delete_permanently", { id: note.id });
  }
  for (const mindmap of await api(baseUrl, "list_mindmaps")) {
    if (mindmap.title?.startsWith("AI_TEST_SMOKE_")) await removeMindmap(mindmap.id);
  }
  for (const mindmap of await api(baseUrl, "list_mindmap_trash")) {
    if (mindmap.title?.startsWith("AI_TEST_SMOKE_")) await api(baseUrl, "delete_mindmap_permanently", { id: mindmap.id });
  }
}

async function noteCrudTrashRestore() {
  const title = `${testPrefix}_NOTE`;
  const note = await api(baseUrl, "create_note", { title });
  createdNotes.add(note.id);
  assert(note.title === title, "created note title mismatch");

  const body = "# Heading\n\nline 1\nline 2\n\n- item";
  const saved = await api(baseUrl, "save_note", { id: note.id, title, body });
  assert(saved.body === body, "saved note body mismatch");

  const notes = await api(baseUrl, "list_notes");
  assert(notes.some((item) => item.id === note.id), "saved note not listed");

  await api(baseUrl, "delete_note", { id: note.id });
  const trash = await api(baseUrl, "list_trash");
  assert(trash.some((item) => item.id === note.id && item.title === title), "deleted note not in trash");

  const restored = await api(baseUrl, "restore_note", { id: note.id });
  assert(restored.id === note.id && restored.body === body, "restored note mismatch");

  await api(baseUrl, "delete_note", { id: note.id });
  await api(baseUrl, "delete_permanently", { id: note.id });
  createdNotes.delete(note.id);

  const finalTrash = await api(baseUrl, "list_trash");
  assert(!finalTrash.some((item) => item.id === note.id), "note remained in trash after permanent delete");
}

async function defaultTitleContracts() {
  const englishNote = await api(baseUrl, "create_note", { title: "Untitled" });
  createdNotes.add(englishNote.id);
  assert(englishNote.title === "Untitled", "English note default title not persisted");
  await removeNote(englishNote.id);
  createdNotes.delete(englishNote.id);

  const chineseNote = await api(baseUrl, "create_note", { title: "未命名想法" });
  createdNotes.add(chineseNote.id);
  assert(chineseNote.title === "未命名想法", "Chinese note default title not persisted");
  await removeNote(chineseNote.id);
  createdNotes.delete(chineseNote.id);

  const englishMindmap = await api(baseUrl, "create_mindmap", { title: "Untitled" });
  createdMindmaps.add(englishMindmap.id);
  assert(englishMindmap.title === "Untitled", "English mindmap default title not persisted");
  await removeMindmap(englishMindmap.id);
  createdMindmaps.delete(englishMindmap.id);

  const chineseMindmap = await api(baseUrl, "create_mindmap", { title: "未命名导图" });
  createdMindmaps.add(chineseMindmap.id);
  assert(chineseMindmap.title === "未命名导图", "Chinese mindmap default title not persisted");
  await removeMindmap(chineseMindmap.id);
  createdMindmaps.delete(chineseMindmap.id);
}

async function mindmapCrudTrashRestore() {
  const title = `${testPrefix}_MINDMAP`;
  const mindmap = await api(baseUrl, "create_mindmap", { title });
  createdMindmaps.add(mindmap.id);

  const nodes = [
    { id: `n-${runId}`, text: "Root", collapsed: false, children: [{ id: `n-${runId}-child`, text: "Child", collapsed: false, children: [] }] },
  ];
  const saved = await api(baseUrl, "save_mindmap", { mm: { ...mindmap, nodes } });
  assert(saved.nodes?.[0]?.children?.[0]?.text === "Child", "saved mindmap nodes mismatch");

  await api(baseUrl, "delete_mindmap", { id: mindmap.id });
  const trash = await api(baseUrl, "list_mindmap_trash");
  assert(trash.some((item) => item.id === mindmap.id && item.title === title), "deleted mindmap not in trash");

  const restored = await api(baseUrl, "restore_mindmap", { id: mindmap.id });
  assert(restored.nodes?.[0]?.text === "Root", "restored mindmap mismatch");

  await api(baseUrl, "delete_mindmap", { id: mindmap.id });
  await api(baseUrl, "delete_mindmap_permanently", { id: mindmap.id });
  createdMindmaps.delete(mindmap.id);
}

async function corruptedJsonTolerance() {
  const dataDir = join(baseUrl.includes("local") ? process.cwd() : "", "local-data");
  const mindmapsDir = join(dataDir, "mindmaps");
  await mkdir(mindmapsDir, { recursive: true });
  const corruptFile = join(mindmapsDir, `${testPrefix}_BAD_MINDMAP.json`);
  createdFiles.add(corruptFile);
  await writeFile(corruptFile, "{ not json", "utf8");
  const maps = await api(baseUrl, "list_mindmaps");
  assert(Array.isArray(maps), "list_mindmaps did not tolerate corrupt JSON");
  const warnings = await api(baseUrl, "get_storage_warnings");
  assert(warnings.mindmaps >= 1 && warnings.total >= 1, "corrupt mindmap was not reported as a storage warning");
  await rm(corruptFile, { force: true });
  createdFiles.delete(corruptFile);
}

async function validationAndSafety() {
  const badId = await fetch(`${baseUrl}/api/save_note`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "../bad", title: "AI_TEST_BAD", body: "" }),
  });
  assert(!badId.ok, "illegal note id was accepted");

  const longTitle = await fetch(`${baseUrl}/api/create_note`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "x".repeat(501) }),
  });
  assert(!longTitle.ok, "overlong title was accepted");
}

async function sourceSafetyChecks() {
  const markdownSource = await readFile(join(process.cwd(), "src", "markdown.js"), "utf8");
  assert(markdownSource.includes("html: false"), "Raw Markdown HTML is not disabled");
  assert(markdownSource.includes("isSafeMarkdownUrl"), "Markdown link safety check missing");
  assert(markdownSource.includes("noreferrer"), "External preview links lost safe rel attribute");
}

async function revisionConflictContracts() {
  const note = await api(baseUrl, "create_note", { title: `${testPrefix}_REV_NOTE` });
  createdNotes.add(note.id);
  assert(note.revision, "Note missing revision");

  const saved = await api(baseUrl, "save_note", { id: note.id, title: `${testPrefix}_REV_NOTE_v2`, body: "updated", expectedRevision: note.revision });
  assert(saved.revision && saved.revision !== note.revision, "Revision did not change after save");

  const conflict = await fetch(`${baseUrl}/api/save_note`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: note.id, title: "conflict-attempt", body: "stale", expectedRevision: note.revision }),
  });
  assert(conflict.status === 409, `Expected 409 CONFLICT, got ${conflict.status}`);
  const conflictBody = await conflict.json();
  assert(conflictBody.code === "CONFLICT", `Expected CONFLICT code, got ${conflictBody.code}`);
  assert(conflictBody.currentRevision, "CONFLICT response missing currentRevision");

  const ok = await api(baseUrl, "save_note", { id: note.id, title: `${testPrefix}_REV_NOTE_v3`, body: "stable", expectedRevision: saved.revision });
  assert(ok, "Save with matching revision failed");

  const mm = await api(baseUrl, "create_mindmap", { title: `${testPrefix}_REV_MM` });
  createdMindmaps.add(mm.id);
  assert(mm.revision, "Mindmap missing revision");

  const mmConflict = await fetch(`${baseUrl}/api/save_mindmap`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mm: { ...mm, title: "hack" }, expectedRevision: "bad-revision" }),
  });
  assert(mmConflict.status === 409, "Mindmap CONFLICT not returned on bad revision");
}

async function oldDataCompatibility() {
  const dataDir = join(process.cwd(), "local-data");
  const oldMmDir = join(dataDir, "mindmaps");
  await mkdir(oldMmDir, { recursive: true });
  const oldMmFile = join(oldMmDir, "AI_TEST_SMOKE_OLD_MM.json");
  const oldJson = JSON.stringify({ id: "AI_TEST_SMOKE_OLD_MM", title: "Old Mindmap", updatedAt: 1 });
  await writeFile(oldMmFile, oldJson, "utf8");
  createdFiles.add(oldMmFile);

  const maps = await api(baseUrl, "list_mindmaps");
  const oldMap = maps.find((m) => m.id === "AI_TEST_SMOKE_OLD_MM");
  assert(oldMap, "Old mindmap with missing fields was not loaded");
  assert(Array.isArray(oldMap.nodes), "Old mindmap nodes not defaulted");
  assert(oldMap.nodes.length === 0, "Old mindmap nodes should be empty");
  assert(oldMap.revision, "Old mindmap missing revision after load");

  oldMap.title = `${testPrefix}_OLD_MM_UPDATED`;
  const savedMm = await api(baseUrl, "save_mindmap", { mm: oldMap });
  assert(savedMm.title === `${testPrefix}_OLD_MM_UPDATED`, "Old mindmap title not updated");
  createdMindmaps.add("AI_TEST_SMOKE_OLD_MM");
}

async function englishEmptyTitleContracts() {
  const note = await api(baseUrl, "create_note", { title: "" });
  createdNotes.add(note.id);
  assert(note.title === "未命名想法", `Empty title fallback: got "${note.title}"`);

  const saveEmpty = await fetch(`${baseUrl}/api/save_note`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: note.id, title: "", body: "test" }),
  });
  assert(saveEmpty.status === 400, `Empty title save not rejected`);

  const saved = await api(baseUrl, "save_note", { id: note.id, title: "Untitled", body: "test" });
  assert(saved.title === "Untitled", `English explicit title not preserved`);

  const mm = await api(baseUrl, "create_mindmap", { title: "   " });
  createdMindmaps.add(mm.id);
  assert(mm.title === "未命名导图", "Whitespace mindmap title not defaulted");

  await removeNote(note.id);
  createdNotes.delete(note.id);
  await removeMindmap(mm.id);
  createdMindmaps.delete(mm.id);
}

async function contractFixturesConsistency() {
  const dataDir = join(process.cwd(), "local-data");
  const fixtureNoteDir = join(dataDir, "notes");
  const fixtureNoteFile = join(fixtureNoteDir, "AI_TEST_SMOKE_FIXTURE_NOTE.md");
  const fixtureMd = `# Fixture Title\n\nBody text line 1\nBody text line 2`;
  await writeFile(fixtureNoteFile, fixtureMd, "utf8");
  createdFiles.add(fixtureNoteFile);

  const notes = await api(baseUrl, "list_notes");
  const fixture = notes.find((n) => n.id === "AI_TEST_SMOKE_FIXTURE_NOTE");
  assert(fixture, "Fixture note not loaded");
  assert(fixture.title === "Fixture Title", "Fixture note title mismatch");
  assert(fixture.body === "Body text line 1\nBody text line 2", "Fixture body mismatch");
  assert(fixture.revision, "Fixture note missing revision");
  assert(fixture.revision.length === 64, "Revision not 64 hex chars");

  await rm(fixtureNoteFile);
  await writeFile(fixtureNoteFile, fixtureMd, "utf8");
  const notes2 = await api(baseUrl, "list_notes");
  const fixture2 = notes2.find((n) => n.id === "AI_TEST_SMOKE_FIXTURE_NOTE");
  assert(fixture2.revision === fixture.revision, "Revision not deterministic");
}

async function unicodeCharacterLimits() {
  const note = await api(baseUrl, "create_note", { title: `${testPrefix}_UNICODE` });
  createdNotes.add(note.id);

  const cjkTitle = "我".repeat(500);
  const emojiTitle = "\uD83C\uDF1F".repeat(500);
  const englishBody = "A".repeat(100_000);

  const savedCjk = await api(baseUrl, "save_note", { id: note.id, title: cjkTitle, body: "ok" });
  assert(savedCjk.title.length >= 500, `CJK title truncated: ${savedCjk.title.length}`);
  const savedEmoji = await api(baseUrl, "save_note", { id: note.id, title: emojiTitle, body: "ok" });
  assert(savedEmoji.title.length >= 500, `Emoji title truncated: ${savedEmoji.title.length}`);
  const savedBody = await api(baseUrl, "save_note", { id: note.id, title: "limit test", body: englishBody });
  assert(savedBody.body.length === 100_000, `Body truncated: ${savedBody.body.length}`);

  const tooLongTitle = "x".repeat(501);
  const res = await fetch(`${baseUrl}/api/save_note`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: note.id, title: tooLongTitle, body: "" }),
  });
  assert(res.status === 400, `Overlong title not rejected`);

  const tooLongBody = "y".repeat(100_001);
  const res2 = await fetch(`${baseUrl}/api/save_note`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: note.id, title: "ok", body: tooLongBody }),
  });
  assert(res2.status === 400, `Overlong body not rejected`);

  await removeNote(note.id);
  createdNotes.delete(note.id);
}

async function saveNotFoundContracts() {
  const res = await fetch(`${baseUrl}/api/save_note`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: `${testPrefix}_NONEXISTENT`, title: "Ghost", body: "test", expectedRevision: "abc" }),
  });
  assert(res.status === 404, `Save non-existent not rejected`);
  const body = await res.json();
  assert(body.code === "NOT_FOUND", `Expected NOT_FOUND`);

  const noRevision = await fetch(`${baseUrl}/api/save_note`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: `${testPrefix}_NONEXISTENT_NO_REV`, title: "Ghost", body: "test" }),
  });
  assert(noRevision.status === 404, "Save without revision recreated a missing note");

  const mmRes = await fetch(`${baseUrl}/api/save_mindmap`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mm: { id: `${testPrefix}_NONEXISTENT_MM`, title: "Ghost", updatedAt: 1, nodes: [] }, expectedRevision: "bad" }),
  });
  assert(mmRes.status === 404 || mmRes.status === 400, `Save non-existent mindmap not rejected`);

  const mmNoRevision = await fetch(`${baseUrl}/api/save_mindmap`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mm: { id: `${testPrefix}_NONEXISTENT_MM_NO_REV`, title: "Ghost", updatedAt: 1, nodes: [] } }),
  });
  assert(mmNoRevision.status === 404, "Save without revision recreated a missing mindmap");
}

async function concurrentRevisionContracts() {
  const note = await api(baseUrl, "create_note", { title: `${testPrefix}_CONCURRENT` });
  createdNotes.add(note.id);
  const peer = await startLocalServer({ port: 0 });
  const request = (url, body) => fetch(`${url}/api/save_note`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: note.id, title: note.title, body, expectedRevision: note.revision }),
  });
  try {
    const responses = await Promise.all([
      request(baseUrl, "writer-a"),
      request(peer.baseUrl, "writer-b"),
    ]);
    const statuses = responses.map((response) => response.status).sort();
    assert(statuses[0] === 200 && statuses[1] === 409, `Concurrent revision writes were not serialized: ${statuses}`);
  } finally {
    peer.server.kill();
  }
}

async function localApiRequestBoundaryContracts() {
  const getResponse = await fetch(`${baseUrl}/api/list_notes`);
  assert(getResponse.status === 405, "API accepted a non-POST request");

  const plainResponse = await fetch(`${baseUrl}/api/list_notes`, {
    method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}",
  });
  assert(plainResponse.status === 415, "API accepted a non-JSON content type");

  const crossOrigin = await fetch(`${baseUrl}/api/list_notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://example.com" },
    body: "{}",
  });
  assert(crossOrigin.status === 403, "API accepted a foreign Origin");
}

async function backupRecoveryContracts() {
  const dataDir = join(process.cwd(), "local-data");
  const notesDir = join(dataDir, "notes");
  await mkdir(notesDir, { recursive: true });

  const noteId = `${testPrefix}_BAK_NOTE`;
  const notePath = join(notesDir, `${noteId}.md`);
  const bakPath = join(notesDir, `.${noteId}.md.bak`);

  await writeFile(bakPath, `# ${testPrefix}_BAK_TITLE\n\nRecovered body`, "utf8");
  createdFiles.add(bakPath);

  assert(!existsSync(notePath), "Main file should not exist before recovery");
  assert(existsSync(bakPath), ".bak file should exist");

  if (server) { server.kill(); await new Promise((r) => setTimeout(r, 500)); }
  const result = await startLocalServer({ port: 0 });
  server = result.server;
  baseUrl = result.baseUrl;

  const notes = await api(baseUrl, "list_notes");
  const recovered = notes.find((n) => n.id === noteId);
  assert(recovered, ".bak file was not recovered");
  assert(recovered.title === `${testPrefix}_BAK_TITLE`, "Recovered title mismatch");
  assert(recovered.body === "Recovered body", "Recovered body mismatch");
  createdNotes.add(noteId);
}

async function noTempBackupLeftovers() {
  const dataDir = join(process.cwd(), "local-data");
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
  assert(leftovers.length === 0, `temp/backup files left: ${leftovers.join(", ")}`);
}

// ── Run ──

try {
  const r = await startLocalServer({ port: 0 });
  server = r.server;
  baseUrl = r.baseUrl;

  await cleanupStaleSmokeData();
  failures += await step("note CRUD, trash, restore, permanent delete", noteCrudTrashRestore);
  failures += await step("localized default title contracts", defaultTitleContracts);
  failures += await step("mindmap CRUD, trash, restore, permanent delete", mindmapCrudTrashRestore);
  failures += await step("corrupted mindmap JSON tolerance", corruptedJsonTolerance);
  failures += await step("validation rejects unsafe input", validationAndSafety);
  failures += await step("Markdown preview source safety guards", sourceSafetyChecks);
  failures += await step("revision conflict contracts", revisionConflictContracts);
  failures += await step("old data compatibility", oldDataCompatibility);
  failures += await step("English empty title contracts", englishEmptyTitleContracts);
  failures += await step("contract fixtures consistency", contractFixturesConsistency);
  failures += await step("Unicode character limits (CJK, emoji, English)", unicodeCharacterLimits);
  failures += await step("save non-existent note returns NOT_FOUND", saveNotFoundContracts);
  failures += await step("concurrent revision writes are serialized", concurrentRevisionContracts);
  failures += await step("local API request boundaries", localApiRequestBoundaryContracts);
  failures += await step("backup recovery contracts", backupRecoveryContracts);
  await cleanupCreatedData();
  failures += await step("no smoke test temp or backup leftovers", noTempBackupLeftovers);
} catch (err) {
  fail("smoke", err);
  failures += 1;
} finally {
  await cleanupCreatedData().catch(() => {});
  if (server) server.kill();
}

if (failures > 0) {
  console.error(`Smoke test failed with ${failures} failure(s).`);
  process.exit(1);
}

console.log("Smoke test passed.");
