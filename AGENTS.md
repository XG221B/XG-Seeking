# XG-Seeking Agent Guide

This repository is XG-Seeking, a local-first desktop notes app built with a vanilla JavaScript frontend, a Tauri/Rust desktop backend, and a Node.js local backend for browser-mode development and smoke tests.

Read this file before changing code. Then read the relevant source. Do not rely on memory from earlier runs.

## Product Direction

XG-Seeking is a Markdown notes app, not a Word-style rich text editor.

The intended note experience is close to Obsidian:

- Edit mode is for writing raw Markdown source in a textarea.
- Preview mode renders that Markdown for reading.
- Markdown text is the canonical note body format.
- New notes open in Edit mode.
- Existing notes open in Preview mode.
- Markdown toolbar buttons may insert Markdown syntax such as bold, italic, code, heading, quote, list, or code block.
- Do not add rich-text controls such as selected-text font size, text color pickers, per-selection style menus, or document-wide visual formatting controls.
- Do not store arbitrary HTML as a formatting model.
- Preview rendering must escape unsafe input and must not execute user content.

Mindmaps are a separate structured feature. They should remain simple, local, and predictable: title, nodes, nested children, collapse state, trash, restore, and permanent delete.

## Tags

Tags are derived from note bodies at render time. There is no stored tag schema, no tag metadata, no tag pages, no tag folders, no backlinks, and no clickable tags in Preview mode. Tags appear only in the sidebar as a filter dropdown when active notes contain tags. The tag filter is ephemeral UI state and is not persisted.

## Current Architecture

Important files:

- `src/main.js`: frontend state, routing, Markdown rendering, notes UI, mindmap UI.
- `src/styles.css`: frontend styling.
- `local-server.mjs`: Node.js local backend used by browser mode and smoke tests.
- `src-tauri/src/main.rs`: Tauri command wiring.
- `src-tauri/src/notes.rs`: Rust note storage.
- `src-tauri/src/mindmap.rs`: Rust mindmap storage.
- `src-tauri/src/settings.rs`: Rust settings storage.
- `tests/smoke/smoke-test.mjs`: repeatable API smoke test.
- `vite.config.mjs`: explicit Vite build config.

There are two backend implementations:

- Node.js backend for `npm run local` and `npm run smoke`.
- Tauri/Rust backend for the installed desktop app.

When changing a backend contract, update both unless the change is intentionally backend-specific.

## Non-Negotiable Rules

1. Do not delete user notes, mindmaps, settings, or unknown data.
2. Do not clear `local-data`.
3. Test data must start with `AI_TEST_`.
4. Clean up your own `AI_TEST_` data before finishing.
5. Do not leave temporary debug files in the project.
6. Do not use destructive git commands such as `git reset --hard`, `git checkout --`, or commands that overwrite user changes.
7. Work on one clear bug or one clear stage at a time.
8. Do not make broad refactors unless they are required to finish the stated task safely.
9. Do not hide errors to make tests pass.
10. If runtime verification was not performed, explicitly say `not runtime verified`.

## Data Safety

Data safety is more important than UI polish.

Required behavior:

- Saving must not silently fail.
- The UI must not tell the user something is saved when the backend rejected it.
- Deleting a note or mindmap should wait for pending saves for that same item.
- Save requests for the same note or mindmap must not race each other.
- File writes should use the safest available local strategy, preferably write-temp-then-rename.
- Restore must not overwrite an existing active item with the same id.
- Trash operations must not permanently delete unless the user explicitly chose permanent delete or clear trash.
- Bad JSON in a single mindmap file must not make the whole mindmap list fail.

## Markdown And Security

Markdown is canonical.

Allowed:

- Normal Markdown.
- Escaped user text in Preview.
- Safe Markdown links only when the URL is allowed.

Disallowed:

- Word-style rich text editing.
- Arbitrary HTML rendering.
- `script`.
- Event handlers such as `onclick` or `onerror`.
- `javascript:` URLs.
- `iframe`, `object`, `embed`, `style`, and `link` elements from user content.
- Inline style support as a user formatting model.

If a requested feature cannot be supported safely in Markdown source + Preview, do not add it as a rich-text workaround. Explain the product mismatch and propose a Markdown-native alternative.

## UI Rules

1. Notes page must clearly show Edit and Preview modes.
2. Markdown toolbar appears only in Edit mode.
3. Preview mode hides Markdown insertion tools.
4. Save status should be visible when saving, saved, or failed.
5. Toolbar controls must look consistent.
6. Text must not overlap or overflow controls.
7. Search, trash, restore, permanent delete, settings, and mindmaps must keep working after UI changes.
8. Dangerous actions need confirmation or a recovery path.
9. Appearance supports `system`, `light`, and `dark`. Theme colors must use the shared CSS tokens; do not add page-specific hard-coded dark colors.

## Internationalization Rules

1. English mode should not show Chinese UI text.
2. Chinese mode should not show English UI text, except accepted fixed terms such as `Edit` and `Preview`.
3. Historical note and mindmap titles are user data and must not be auto-translated.
4. New default titles must follow the current UI language.
5. Trash shows the actual saved title.
6. Language changes should update nav, buttons, placeholders, tooltips, confirmation text, and empty states where applicable.

## Required Checks

Run these after code changes:

```bash
npm run smoke
npm run smoke:ui
npm run web:build
node --check local-server.mjs
node --check src/main.js
node --check tests/smoke/smoke-test.mjs
node --check tests/smoke/ui-smoke.mjs
```

Run these from `src-tauri` after Rust or Tauri changes:

```bash
cargo fmt --check
cargo check
cargo clippy -- -D warnings
```

If the change affects the installed app or packaging, also run:

```bash
npm run build
```

Build success alone is not feature success. For user-facing behavior, perform runtime verification where possible.

## Runtime Verification

Prefer real verification over code review.

Minimum acceptable verification depends on the change:

- Backend/data change: run `npm run smoke` and relevant Rust checks.
- Notes UI change: run `npm run smoke:ui` and test create, edit, save, switch page, reload, Preview, trash, restore where relevant.
- Markdown change: test normal Markdown, XSS-like input, unsafe links, multiline input.
- Mindmap change: test create, edit title, add node, add child, collapse, delete, restore.
- i18n change: test English and Chinese default titles through trash.
- Packaging change: run `npm run build`.

## Smoke Test Expectations

The smoke test must:

- Use only `AI_TEST_` data.
- Clean up after itself.
- Use its own local backend process when possible.
- Avoid clearing all of `local-data`.
- Avoid deleting non-test user data.
- Fail loudly if a regression is found.

## Handoff Report

Use `AGENT-HANDOFF.md` only as a local working handoff file. It is ignored by Git and should not be committed.

If you stop with incomplete work, write:

```md
# Agent Handoff

## Current Stage
Stage name:

## Files Changed
- File path: reason

## What Was Implemented
- Concrete implementation detail

## Verification Performed
- Command/test:
- Result:

## Manual/Runtime Checks
- Scenario:
- Actual result:
- Passed:

## Test Data
- Created data:
- Cleanup status:

## Known Failures
- Failure:
- Cause:
- Next step:

## Remaining Work
- Next recommended stage:
- Risks:

## Notes For Reviewer
- Code to inspect:
- Uncertainties:
```

Do not write vague status such as "should work".

## Suggested Priority Queue

Follow this order unless the user asks otherwise:

1. Keep build and smoke test green.
2. Protect note/mindmap data from loss or silent save failure.
3. Keep Markdown Edit/Preview behavior correct and secure.
4. Keep Node and Tauri backend contracts aligned.
5. Fix i18n inconsistencies.
6. Fix page switching, stale request, and delete-after-save races.
7. Improve UI polish without changing the product model.
8. Add or improve tests for newly fixed bugs.

## Resolved Regression Guardrails

These regressions occurred during the 0.3 work and were fixed. Future agents must preserve the fixes and add regression coverage when changing the same paths.

- Conflict state is per document in `src/coordinator.js`. Never replace it with a singleton note or mindmap conflict id: two documents can conflict independently.
- Editing after a conflict must keep updating that document's coordinator draft, but must not retry a disk write until the user chooses a conflict action.
- Conflict "Save as new" must copy the coordinator draft, including edits made in Preview/conflict state. It must never reconstruct content from the current DOM.
- Queued saves must resolve `expectedRevision` when their queue task begins. Capturing it before an older save finishes can create a false self-conflict.
- Create, delete, and restore mutations must invalidate pending list-load tokens. A stale list response must never resurrect a deleted item or discard a newly created/restored item in memory.
- Missing-export and similar Vite warnings are release blockers, even when the build exits successfully.
- Browser runtime exceptions, unhandled rejections, console errors, and intermittent UI failures are real QA failures. Do not suppress, ignore-list, or catch-and-discard them to make tests green.
- Markdown Preview relies on `markdown-it` with raw HTML disabled and a constrained link renderer. Do not reintroduce regex-based HTML sanitization; it previously converted closing tags into opening tags.
- Backend mutation locks must cover revision check plus write/move/delete as one critical section. Frontend queues alone do not protect multiple app instances.
- `save_note` and `save_mindmap` must never create missing files. Only `create_*` may create active items, even when an old caller omits `expectedRevision`.
- Tauri close requests must remain blocked until all dirty documents flush successfully. Browser unload handlers are only best-effort fallbacks.
- Node browser-mode APIs must remain POST-only, JSON-only, loopback-hosted, and same-origin protected.
- Smoke-test steps must affect the process exit code. A printed `FAIL` with exit code 0 is a release blocker.

## Definition Of Done

A task is done only when:

1. Code is implemented.
2. Required checks pass.
3. Runtime or equivalent verification passes.
4. Test data is cleaned.
5. No process files, debug files, or temporary artifacts are left behind.
6. Remaining risks are stated clearly.
