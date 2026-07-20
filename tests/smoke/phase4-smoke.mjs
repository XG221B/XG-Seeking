#!/usr/bin/env node
import { rm } from "node:fs/promises";
import { startLocalServer, api, findChrome, startChrome, navigate, delay, cleanupTestData, pass, fail, step, click, waitFor, evaluate, pressKey, assertNoBrowserErrors } from "./helper.mjs";
import { extractTags } from "../../src/markdown.js";

const testPrefix = `AI_TEST_P4_${Date.now().toString(36)}`;
let serverProc = null;
let chromeProc = null;
let client = null;
let userDataDir = "";
let baseUrl = "";
let failures = 0;
let failNextNotesList = false;
let nextDialogAction = null;

function assertTagKeys(input, expected) {
  const result = extractTags(input);
  const keys = result.map((t) => t.key);
  if (JSON.stringify(keys) !== JSON.stringify(expected)) throw new Error(`extractTags mismatch:\n  input: ${JSON.stringify(input)}\n  expected: ${JSON.stringify(expected)}\n  got: ${JSON.stringify(keys)}`);
}

async function testBasicTags() {
  assertTagKeys("Simple #tag here", ["tag"]);
  assertTagKeys("#a and #b text", ["a", "b"]);
  assertTagKeys("Same #dup and #dup again", ["dup"]);
}

async function testCasePreservation() {
  const r = extractTags("Bring #CET6 book to #exam89");
  const keys = r.map((t) => t.key);
  if (JSON.stringify(keys) !== JSON.stringify(["cet6", "exam89"])) throw new Error(`keys: ${keys}`);
  if (r[0].display !== "CET6") throw new Error(`display[0] should be CET6, got: ${r[0].display}`);
  if (r[1].display !== "exam89") throw new Error(`display[1] should be exam89, got: ${r[1].display}`);
}

async function testEscapedTags() {
  assertTagKeys("This is \\#notatag but #real", ["real"]);
  assertTagKeys("\\#escaped and \\#also", []);
  assertTagKeys("Backslash\\\\#nope also \\#not", []);
  assertTagKeys("\\#hidden #visible", ["visible"]);
  assertTagKeys("\\#same", []);
  const src = String.fromCharCode(92) + "#same #same";
  const r = extractTags(src);
  if (r.length !== 1 || r[0].key !== "same") throw new Error("escaped+unescaped same failed");
}

async function testInlineCode() { assertTagKeys("Text `#nocode` and #real", ["real"]); }
async function testFencedCode() { assertTagKeys("```\n#nocode\n#alsonot\n```\n\n#real", ["real"]); }
async function testHeadings() { assertTagKeys("# Heading is not tag but #tag", ["tag"]); }
async function testCJK() { assertTagKeys("#\u6807\u7B7E and #\u6D4B\u8BD5 work", ["\u6807\u7B7E", "\u6D4B\u8BD5"]); }

async function testLinkURL() {
  assertTagKeys("Check [link](http://x.com#frag) but #real", ["real"]);
  assertTagKeys("[English material #CET6](https://example.com/resource)", ["cet6"]);
  assertTagKeys("[link](https://example.com/#fake)", []);
  assertTagKeys("[\\#hidden](https://example.com) #visible", ["visible"]);
  assertTagKeys("`#code` [material #visible](https://example.com/#fake)", ["visible"]);
}

async function testUnderscoreDigit() { assertTagKeys("#my_tag and #tag2 and #abc_def", ["abc_def", "my_tag", "tag2"]); }

async function testDataDirectoryContract() {
  const r = await api(baseUrl, "get_data_directory");
  if (!r || !r.path || !r.path.includes("local-data")) throw new Error("data dir contract failed");
}

async function testTagTrashIsolation() {
  const n = await api(baseUrl, "create_note", { title: `${testPrefix}_TAG_TRASH` });
  await api(baseUrl, "save_note", { id: n.id, title: n.title, body: "#tagx" });
  await api(baseUrl, "delete_note", { id: n.id });
  if (!(await api(baseUrl, "list_trash")).find((x) => x.id === n.id)) throw new Error("tag note not in trash");
  await api(baseUrl, "delete_permanently", { id: n.id });
}

// ── Browser UI ──

async function testAppStartsAtNotes() {
  await navigate(client, baseUrl); await delay(800);
  const p = await evaluate(client, "document.querySelector('.nav button.active')?.dataset.page||''");
  if (p !== "notes") throw new Error("app not at Notes: " + p);
}

async function testNoLoadingPlaceholder() {
  const h = await evaluate(client, "document.body.textContent.includes('\u52A0\u8F7D\u4E2D')||document.body.textContent.includes('Loading...')");
  if (h) throw new Error("loading text visible");
}

async function testSettingsShowsDataDir() {
  await navigate(client, baseUrl); await delay(800);
  await click(client, '[data-page="settings"]');
  await waitFor(client, "document.getElementById('dataDirField')", "no field");
  await waitFor(client, "document.getElementById('dataDirField')?.value?.length>0", "empty", 15000);
  const v = await evaluate(client, "document.getElementById('dataDirField')?.value||''");
  if (!v || !v.includes("local-data")) throw new Error("bad path: "+v);
}

async function testThemePersistence() {
  const original = await api(baseUrl, "get_settings");
  try {
    await navigate(client, baseUrl);
    await waitFor(client, "document.querySelector('[data-page=\"notes\"].active') && document.querySelector('.notes')", "app did not finish initial navigation");
    await click(client, '[data-page="settings"]');
    await waitFor(client, "document.querySelector('[data-page=\"settings\"].active') && document.getElementById('dataDirField')?.value", "theme setting missing");
    const options = await evaluate(client, "Array.from(document.querySelectorAll('#setTheme option')).map((option) => option.value)");
    if (JSON.stringify(options) !== JSON.stringify(["system", "light", "dark"])) throw new Error("theme options mismatch: " + JSON.stringify(options));

    await evaluate(client, `(() => {
      const select = document.getElementById('setTheme');
      select.value = 'dark';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    const applied = await evaluate(client, `(() => ({
      theme: document.documentElement.dataset.theme,
      background: getComputedStyle(document.body).backgroundColor,
      surface: getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim(),
      muted: getComputedStyle(document.documentElement).getPropertyValue('--color-text-muted').trim(),
      dim: getComputedStyle(document.documentElement).getPropertyValue('--color-text-dim').trim(),
    }))()`);
    if (applied.theme !== "dark") throw new Error("dark theme did not apply immediately");
    if (applied.background !== "rgb(24, 24, 24)" || applied.surface !== "#222222") throw new Error("dark palette mismatch: " + JSON.stringify(applied));
    if (applied.muted !== "#c7c7c7" || applied.dim !== "#aaaaaa") throw new Error("dark text contrast mismatch: " + JSON.stringify(applied));

    await click(client, "#saveSetBtn");
    await delay(800);
    await navigate(client, baseUrl);
    await waitFor(client, "document.querySelector('[data-page=\"notes\"].active') && document.querySelector('.notes')", "app did not finish reload navigation");
    if (await evaluate(client, "document.documentElement.dataset.theme") !== "dark") throw new Error("dark theme did not persist after reload");

    await click(client, '[data-page="settings"]');
    await waitFor(client, "document.querySelector('[data-page=\"settings\"].active') && document.getElementById('dataDirField')?.value", "theme setting missing after reload");
    await evaluate(client, `(() => {
      const select = document.getElementById('setTheme');
      select.value = 'light';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    if (await evaluate(client, "document.documentElement.dataset.theme") !== "light") throw new Error("light preview did not apply");
    await click(client, '[data-page="notes"]');
    await waitFor(client, "document.querySelector('[data-page=\"notes\"].active')", "did not leave settings");
    const revertedTheme = await evaluate(client, "document.documentElement.dataset.theme");
    if (revertedTheme !== "dark") throw new Error("unsaved theme preview was not reverted: " + revertedTheme);
  } finally {
    await api(baseUrl, "save_settings", original);
    await navigate(client, baseUrl); await delay(800);
  }
}

async function testTagFilterAppears() {
  await navigate(client, baseUrl); await delay(800);
  await click(client, "#new, #emptyNew");
  await waitFor(client, "document.querySelector('#body')", "no editor");
  await evaluate(client, `(()=>{document.querySelector('#title').value=${JSON.stringify(testPrefix+"_TAG")};document.querySelector('#title').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#body').value='Some #testtag and #AnotherTag';document.querySelector('#body').dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await delay(1500);
  await waitFor(client, "document.querySelector('#tagSelect')", "no tag select");
  const opts = await evaluate(client, "Array.from(document.querySelectorAll('#tagSelect option')).map(o=>({v:o.value,t:o.textContent}))");
  if (!opts.some((o)=>o.v==="testtag")) throw new Error("testtag missing: "+JSON.stringify(opts));
  if (!opts.some((o)=>o.v==="anothertag"&&o.t.includes("AnotherTag"))) throw new Error("anothertag case missing");
}

async function testTagFilterFiltering() {
  await evaluate(client, "document.querySelector('#tagSelect').value='testtag';document.querySelector('#tagSelect').dispatchEvent(new Event('change',{bubbles:true}))");
  await delay(300);
  if (await evaluate(client, "document.querySelectorAll('.note-row').length")===0) throw new Error("filter empty");
  await evaluate(client, "document.querySelector('#tagSelect').value='';document.querySelector('#tagSelect').dispatchEvent(new Event('change',{bubbles:true}))");
  await delay(300);
}

async function testCtrlSShortcutSaves() {
  await navigate(client, baseUrl); await delay(800);
  await click(client, "#new, #emptyNew");
  await waitFor(client, "document.querySelector('#body')", "no editor");
  await evaluate(client, `(()=>{document.querySelector('#title').value=${JSON.stringify(testPrefix+"_CTRLS")};document.querySelector('#title').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#body').value='Body';document.querySelector('#body').dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await delay(300);
  await client.send("Input.dispatchKeyEvent",{type:"keyDown",key:"s",code:"KeyS",windowsVirtualKeyCode:83,nativeVirtualKeyCode:83,modifiers:2});
  await client.send("Input.dispatchKeyEvent",{type:"keyUp",key:"s",code:"KeyS",windowsVirtualKeyCode:83,nativeVirtualKeyCode:83,modifiers:2});
  await delay(2000);
  await navigate(client, baseUrl); await delay(800);
  if (!(await evaluate(client,"Array.from(document.querySelectorAll('.note-row strong')).map(e=>e.textContent)")).some(t=>t===testPrefix+"_CTRLS")) throw new Error("Ctrl+S note missing");
}

async function testCtrlFShortcutFocusesSearch() {
  await navigate(client, baseUrl); await delay(800);
  await evaluate(client, "document.body.focus()"); await delay(200);
  await client.send("Input.dispatchKeyEvent",{type:"keyDown",key:"f",code:"KeyF",windowsVirtualKeyCode:70,nativeVirtualKeyCode:70,modifiers:2});
  await client.send("Input.dispatchKeyEvent",{type:"keyUp",key:"f",code:"KeyF",windowsVirtualKeyCode:70,nativeVirtualKeyCode:70,modifiers:2});
  await delay(300);
  if (!(await evaluate(client,"document.activeElement?.id==='search'"))) throw new Error("Ctrl+F failed");
}

// ── Conflict ──

function setupDialogAccept() { nextDialogAction = true; }
function setupDialogReject() { nextDialogAction = false; }

async function triggerConflictEdit(noteId, localTitle, localBody, extTitle, extBody) {
  await evaluate(client, `(()=>{document.querySelector('#title').value=${JSON.stringify(localTitle)};document.querySelector('#title').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#body').value=${JSON.stringify(localBody)};document.querySelector('#body').dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await api(baseUrl, "save_note", { id: noteId, title: extTitle, body: extBody });
  await delay(3000);
}

async function testNoteConflictReload() {
  const n = await api(baseUrl, "create_note", { title: `${testPrefix}_CONF` });
  await api(baseUrl, "save_note", { id: n.id, title: n.title, body: "orig" });
  await navigate(client, baseUrl); await delay(800);
  await click(client, `.note-row[data-id="${n.id}"] .item`); await delay(500);
  await click(client, "#editMode"); await waitFor(client, "document.querySelector('#body')", "no editor");
  await triggerConflictEdit(n.id, `${testPrefix}_T1`, "local", `${testPrefix}_EXT1`, "ext");
  if (!(await evaluate(client, "!!document.getElementById('conflictReloadBtn')&&!!document.getElementById('conflictSaveNewBtn')"))) throw new Error("no btns");
  if (await evaluate(client, "document.getElementById('body')?.value")!=="local") throw new Error("draft lost");
  if ((await api(baseUrl,"list_notes")).find(x=>x.id===n.id)?.body!=="ext") throw new Error("disk overwritten");
  setupDialogAccept(); await click(client, "#conflictReloadBtn"); await delay(2500);
  if (await evaluate(client, "document.getElementById('body')?.value||''")!=="ext") throw new Error("not reloaded");
  if (await evaluate(client, "!!document.getElementById('conflictReloadBtn')")) throw new Error("ui not cleared");
}

async function testNoteConflictSaveAsNew() {
  const n = await api(baseUrl, "create_note", { title: `${testPrefix}_C2` });
  await api(baseUrl, "save_note", { id: n.id, title: n.title, body: "orig" });
  await navigate(client, baseUrl); await delay(800);
  await click(client, `.note-row[data-id="${n.id}"] .item`); await delay(500);
  await click(client, "#editMode"); await waitFor(client, "document.querySelector('#body')", "no editor");
  const local = "local-as-new";
  await triggerConflictEdit(n.id, `${testPrefix}_T2`, local, `${testPrefix}_EXT2`, "ext");
  if (!(await evaluate(client, "!!document.getElementById('conflictReloadBtn')&&!!document.getElementById('conflictSaveNewBtn')"))) throw new Error("no btns");
  await evaluate(client, `(()=>{document.querySelector('#body').value='newest-after-conflict';document.querySelector('#body').dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click(client, "#conflictSaveNewBtn"); await delay(3000);
  const all = await api(baseUrl, "list_notes");
  const nn = all.find(x=>x.body==="newest-after-conflict");
  if (!nn) throw new Error("not created"); if (nn.id===n.id) throw new Error("same id");
  if (all.find(x=>x.id===n.id)?.body!=="ext") throw new Error("original overwritten");
}

async function testNoteConflictFailedReload() {
  const n = await api(baseUrl, "create_note", { title: `${testPrefix}_RF` });
  await api(baseUrl, "save_note", { id: n.id, title: n.title, body: "orig" });
  await navigate(client, baseUrl); await delay(800);
  await click(client, `.note-row[data-id="${n.id}"] .item`); await delay(500);
  await click(client, "#editMode"); await waitFor(client, "document.querySelector('#body')", "no editor");
  await triggerConflictEdit(n.id, `${testPrefix}_RFT`, "reload-failure-draft", `${testPrefix}_RFEXT`, "external");
  failNextNotesList = true;
  setupDialogAccept(); await click(client, "#conflictReloadBtn"); await delay(2000);
  if (!(await evaluate(client, "!!document.getElementById('conflictReloadBtn')&&!!document.getElementById('conflictSaveNewBtn')"))) throw new Error("failed reload cleared conflict actions");
  if (await evaluate(client, "document.getElementById('body')?.value") !== "reload-failure-draft") throw new Error("failed reload discarded draft");
}

async function testIndependentNoteConflicts() {
  const a = await api(baseUrl, "create_note", { title: `${testPrefix}_CA` });
  const b = await api(baseUrl, "create_note", { title: `${testPrefix}_CB` });
  await api(baseUrl, "save_note", { id: a.id, title: a.title, body: "a0" });
  await api(baseUrl, "save_note", { id: b.id, title: b.title, body: "b0" });
  await navigate(client, baseUrl); await delay(800);

  await click(client, `.note-row[data-id="${a.id}"] .item`); await delay(300);
  await click(client, "#editMode"); await waitFor(client, "document.querySelector('#body')", "no A editor");
  await triggerConflictEdit(a.id, `${testPrefix}_CA_LOCAL`, "a-local", `${testPrefix}_CA_EXT`, "a-external");

  await click(client, `.note-row[data-id="${b.id}"] .item`); await delay(300);
  await click(client, "#editMode"); await waitFor(client, "document.querySelector('#body')", "no B editor");
  await triggerConflictEdit(b.id, `${testPrefix}_CB_LOCAL`, "b-local", `${testPrefix}_CB_EXT`, "b-external");

  await click(client, `.note-row[data-id="${a.id}"] .item`); await delay(300);
  if (!(await evaluate(client, "!!document.getElementById('conflictReloadBtn')"))) throw new Error("A conflict state was replaced by B");
  await click(client, "#editMode"); await waitFor(client, "document.querySelector('#body')", "no A conflict editor");
  if (await evaluate(client, "document.getElementById('body')?.value") !== "a-local") throw new Error("A conflict draft changed");
  await click(client, `.note-row[data-id="${b.id}"] .item`); await delay(300);
  if (!(await evaluate(client, "!!document.getElementById('conflictReloadBtn')"))) throw new Error("B conflict state was lost");
  await click(client, "#editMode"); await waitFor(client, "document.querySelector('#body')", "no B conflict editor");
  if (await evaluate(client, "document.getElementById('body')?.value") !== "b-local") throw new Error("B conflict draft changed");
}

async function testNoteConflictPreview() {
  const n = await api(baseUrl, "create_note", { title: `${testPrefix}_PV` });
  const fullMd = "# H\n\none\ntwo\n\n- li\n- `c`\n\nEN \u4E2D\u6587";
  await api(baseUrl, "save_note", { id: n.id, title: n.title, body: fullMd });
  await navigate(client, baseUrl); await delay(800);
  await click(client, `.note-row[data-id="${n.id}"] .item`); await delay(500);
  await click(client, "#editMode"); await waitFor(client, "document.querySelector('#body')", "no editor");
  await evaluate(client, `(()=>{document.querySelector('#title').value=${JSON.stringify(testPrefix+"_PV")};document.querySelector('#title').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#body').value=${JSON.stringify(fullMd+"\n\n#e")};document.querySelector('#body').dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await api(baseUrl, "save_note", { id: n.id, title: `${testPrefix}_PVE`, body: "short" });
  await click(client, "#previewMode"); await waitFor(client, "document.querySelector('#mdPreview')", "no preview");
  await delay(3000);
  if (!(await evaluate(client, "!!document.getElementById('conflictReloadBtn')&&!!document.getElementById('conflictSaveNewBtn')"))) throw new Error("preview no btns");
  const pv = await evaluate(client, "document.querySelector('#mdPreview')?.textContent||''");
  if (!pv.includes("one")||!pv.includes("\u4E2D\u6587")) throw new Error("preview lost");
  await click(client, "#conflictSaveNewBtn"); await delay(3000);
  const all = await api(baseUrl, "list_notes");
  const nn = all.find(x=>x.title===testPrefix+"_PV");
  if (!nn) throw new Error("not created");
  if (!nn.body.includes("one")||!nn.body.includes("# H")||!nn.body.includes("- li")||!nn.body.includes("\u4E2D\u6587")) throw new Error("body lost");
  if (!(await evaluate(client,"!!document.getElementById('editMode')&&!!document.getElementById('previewMode')"))) throw new Error("edit/preview missing");
}

async function testNoteConflictCancelReload() {
  const n = await api(baseUrl, "create_note", { title: `${testPrefix}_CN` });
  await api(baseUrl, "save_note", { id: n.id, title: n.title, body: "orig" });
  await navigate(client, baseUrl); await delay(800);
  await click(client, `.note-row[data-id="${n.id}"] .item`); await delay(500);
  await click(client, "#editMode"); await waitFor(client, "document.querySelector('#body')", "no editor");
  await triggerConflictEdit(n.id, `${testPrefix}_CT`, "cancel-draft", `${testPrefix}_CEX`, "ext");
  if (!(await evaluate(client, "!!document.getElementById('conflictReloadBtn')"))) throw new Error("no btns");
  setupDialogReject(); await click(client, "#conflictReloadBtn"); await delay(2000);
  if (!(await evaluate(client, "!!document.getElementById('conflictReloadBtn')&&!!document.getElementById('conflictSaveNewBtn')"))) throw new Error("btns gone");
  if (await evaluate(client, "document.getElementById('body')?.value")!=="cancel-draft") throw new Error("draft lost");
}

async function testMindmapConflictReload() {
  const m = await api(baseUrl, "create_mindmap", { title: `${testPrefix}_MM` });
  await api(baseUrl, "save_mindmap", { mm: { ...m, nodes: [{ id: "r", text: "Root", collapsed: false, children: [] }] } });
  await navigate(client, baseUrl); await delay(800);
  await click(client, '[data-page="mindmaps"]'); await waitFor(client, "document.querySelector('#mmTitle')", "no mm");
  await evaluate(client, `(()=>{document.querySelector('#mmTitle').value=${JSON.stringify(testPrefix+"_MT")};document.querySelector('#mmTitle').dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await api(baseUrl, "save_mindmap", { mm: { ...m, title: `${testPrefix}_MME`, nodes: [{ id: "e", text: "Ext", collapsed: false, children: [] }] } });
  await delay(3000);
  if (!(await evaluate(client, "!!document.getElementById('conflictReloadMMBtn')&&!!document.getElementById('conflictSaveNewMMBtn')"))) throw new Error("no mm btns");
  setupDialogAccept(); await click(client, "#conflictReloadMMBtn"); await delay(2500);
  if (await evaluate(client, "document.querySelector('#mmTitle')?.value||''")!==`${testPrefix}_MME`) throw new Error("not reloaded");
}

async function testMindmapConflictSaveAsNew() {
  const m = await api(baseUrl, "create_mindmap", { title: `${testPrefix}_M2` });
  await api(baseUrl, "save_mindmap", { mm: { ...m, nodes: [{ id: "r2", text: "R", collapsed: false, children: [] }] } });
  await navigate(client, baseUrl); await delay(800);
  await click(client, '[data-page="mindmaps"]'); await waitFor(client, "document.querySelector('#mmTitle')", "no mm");
  await evaluate(client, `(()=>{document.querySelector('#mmTitle').value=${JSON.stringify(testPrefix+"_MT2")};document.querySelector('#mmTitle').dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await api(baseUrl, "save_mindmap", { mm: { ...m, title: `${testPrefix}_M2E`, nodes: [] } });
  await delay(3000);
  if (!(await evaluate(client, "!!document.getElementById('conflictReloadMMBtn')&&!!document.getElementById('conflictSaveNewMMBtn')"))) throw new Error("no mm btns");
  await click(client, "#conflictSaveNewMMBtn"); await delay(3000);
  const all = await api(baseUrl, "list_mindmaps");
  const mm = all.find(x=>x.title===testPrefix+"_MT2");
  if (!mm) throw new Error("not created"); if (mm.id===m.id) throw new Error("same id");
  if ((mm.nodes||[]).length<1||mm.nodes[0].text!=="R") throw new Error("nodes lost");
  if (all.find(x=>x.id===m.id)?.title!==`${testPrefix}_M2E`) throw new Error("original overwritten");
}

// ── Run ──

try {
  const s = await startLocalServer({ port: 0 });
  serverProc = s.server; baseUrl = s.baseUrl;
  console.log(`Server running at ${baseUrl}`);
  await cleanupTestData(baseUrl, "AI_TEST_P4_");

  let f = 0;
  f += await step("extractTags basic", testBasicTags);
  f += await step("extractTags case preservation", testCasePreservation);
  f += await step("extractTags escaped", testEscapedTags);
  f += await step("extractTags inline code", testInlineCode);
  f += await step("extractTags fenced code", testFencedCode);
  f += await step("extractTags headings", testHeadings);
  f += await step("extractTags CJK", testCJK);
  f += await step("extractTags link URL", testLinkURL);
  f += await step("extractTags underscore digit", testUnderscoreDigit);
  f += await step("data directory contract", testDataDirectoryContract);
  f += await step("tag trash isolation", testTagTrashIsolation);

  const cp = await findChrome();
  if (!cp) { f += fail("browser", new Error("Chrome/Edge not found")); }
  else {
    const b = await startChrome(cp);
    chromeProc = b.chrome; client = b.client; userDataDir = b.userDataDir;
    await client.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/list_notes", requestStage: "Request" }] });
    client.on("Fetch.requestPaused", (event) => {
      let action;
      if (failNextNotesList) {
        failNextNotesList = false;
        action = client.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Failed" });
      } else {
        action = client.send("Fetch.continueRequest", { requestId: event.requestId });
      }
      action.catch(() => {});
    });
    client.on("Page.javascriptDialogOpening", () => {
      if (nextDialogAction === null) return;
      const accept = nextDialogAction;
      nextDialogAction = null;
      client.send("Page.handleJavaScriptDialog", { accept }).catch(() => {});
    });

    f += await step("app starts at Notes page", testAppStartsAtNotes);
    f += await step("no loading placeholder", testNoLoadingPlaceholder);
    f += await step("Settings displays data directory", testSettingsShowsDataDir);
    f += await step("theme selection and persistence", testThemePersistence);
    f += await step("tag filter appears with case", testTagFilterAppears);
    f += await step("tag filter filtering", testTagFilterFiltering);
    f += await step("Ctrl+S shortcut saves note", testCtrlSShortcutSaves);
    f += await step("Ctrl+F shortcut focuses search", testCtrlFShortcutFocusesSearch);
    f += await step("note conflict reload", testNoteConflictReload);
    f += await step("note conflict save as new", testNoteConflictSaveAsNew);
    f += await step("note conflict Preview save as new", testNoteConflictPreview);
    f += await step("note conflict cancel reload", testNoteConflictCancelReload);
    f += await step("note conflict failed reload", testNoteConflictFailedReload);
    f += await step("independent note conflicts", testIndependentNoteConflicts);
    f += await step("mindmap conflict reload", testMindmapConflictReload);
    f += await step("mindmap conflict save as new", testMindmapConflictSaveAsNew);
    f += assertNoBrowserErrors(client, "phase4 browser errors");
  }
  failures += f;
  await cleanupTestData(baseUrl, "AI_TEST_P4_");
} catch (err) { fail("phase4 smoke", err); failures += 1; }
finally {
  if (client) client.close();
  if (chromeProc) chromeProc.kill();
  if (serverProc) serverProc.kill();
  if (userDataDir) await delay(500).then(() => rm(userDataDir, { recursive: true, force: true }).catch(() => {}));
}

if (failures > 0) { console.error(`Phase 4 smoke test failed with ${failures} failure(s).`); process.exit(1); }
console.log("Phase 4 smoke test passed.");
