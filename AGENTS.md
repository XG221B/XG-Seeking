# XG-Seeking Agent Rules

You are working on XG-Seeking, a local-first desktop notes app. Act as a product QA engineer, stability engineer, and implementation engineer. The goal is not to produce a polished report; the goal is to make the app behave correctly for a real user.

Read this file before every task, then read the relevant source code. Do not rely on memory.

## Core Rules

1. Work on one clear stage or one clear bug at a time.
2. Do not perform broad, vague project-wide optimization.
3. Do not make surface-only UI changes. Verify that the feature actually works.
4. Keep Markdown as the canonical note body format.
5. Do not delete user notes, mindmaps, settings, or unknown data.
6. Test data must start with `AI_TEST_`.
7. Clean up your own test data before finishing.
8. Do not leave temporary debug files in the project.
9. Do not use destructive git commands such as `git reset --hard` or commands that overwrite user changes.
10. If real runtime verification was not performed, explicitly say `not runtime verified`.
11. If a build, safety check, or acceptance test fails, stop at the current stage and do not continue to the next stage.

## Required Workflow

For every stage:

1. State the single problem this stage will solve.
2. Read the relevant code.
3. Make the smallest necessary change.
4. Run the required checks.
5. Perform real runtime verification when possible.
6. Clean up `AI_TEST_` data created by you.
7. Update the local `AGENT-HANDOFF.md` handoff file.
8. Continue to the next stage only if this stage passed.

Do not stop after writing a plan unless there is a real blocker.

## Required Checks

Run these from the project root after changes:

```bash
npm run web:build
node --check local-server.mjs
```

Run these from `src-tauri`:

```bash
cargo check
cargo clippy -- -D warnings
```

If the change affects the installed desktop app, also run:

```bash
npm run build
```

If a command cannot be run, write the reason and risk in the local `AGENT-HANDOFF.md`.

## Handoff Report

After each stage, update the local `AGENT-HANDOFF.md` in the project root. This is a working handoff file for agents and is ignored by Git. Overwrite it each time with the latest status.

Use this exact structure:

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

Do not write vague status such as "should work". If something was not verified, say so.

## Priority Queue

Follow these stages in order. A stage is complete only when implementation, checks, runtime verification, cleanup, and handoff are done.

### Stage 1: Fix Local Text Formatting

Goal: In note Edit mode, selected text can be formatted locally with color or font size. Preview must render it correctly. Saving, page switching, refresh, and reload must preserve it.

Requirements:

1. Edit mode remains a textarea for Markdown source.
2. Use `selectionStart` and `selectionEnd` for the current selection.
3. Do not change the whole note's color or font size.
4. Store local styling as safe Markdown-compatible inline HTML:
   - `<span style="color:#c0392b">text</span>`
   - `<span style="font-size:20px">text</span>`
5. Preview must render safe spans as real DOM spans.
6. `#mdPreview span` must exist for valid formatted text.
7. Only allow `span`.
8. Only allow `color` and `font-size` inside `style`.
9. `color` may only be `#RGB` or `#RRGGBB`.
10. `font-size` may only be `10px` through `32px`.
11. Block `script`, event handlers such as `onclick`/`onerror`, `javascript:`, unsafe style, and all non-whitelisted HTML.
12. If no text is selected, do not fail silently. Show a clear hint or insert an explicit placeholder.
13. Style `toolbar-select`, `toolbar-color`, and `toolbar-hint` so the toolbar matches the existing UI.

Acceptance tests:

1. Create note `AI_TEST_FORMAT_RENDER`.
2. In Edit mode enter `red big normal`.
3. Select `red`, apply color `#c0392b`.
4. Select `big`, apply font size `20px`.
5. Switch to Preview.
6. Verify only `red` is red and only `big` is 20px.
7. Verify real spans exist in the Preview DOM.
8. Test malicious input:
   - `<script>alert(1)</script>`
   - `<span style="position:absolute">bad</span>`
   - `<span onclick="alert(1)">bad</span>`
9. Verify no script node is generated, no script runs, unsafe style does not survive, and event handlers do not survive.
10. Test a multi-line selection.
11. Save, switch pages, reload, and verify the result remains correct.
12. Clean up `AI_TEST_FORMAT_RENDER`.

If safe spans display as escaped text such as `&lt;span ...&gt;`, this stage failed.

### Stage 2: Fix Default Title Language At Source

Goal: New notes and mindmaps use the current UI language from creation through trash.

Requirements:

1. `create_note` accepts optional `title`.
2. `create_mindmap` accepts optional `title`.
3. Node backend and Tauri/Rust backend both support the same contract.
4. Frontend passes the current localized default title when creating.
5. Backend fallback is used only when no title is supplied.
6. Do not translate historical user data.

Acceptance tests:

1. English mode: create note, delete it, trash title is `Untitled`.
2. Chinese mode: create note, delete it, trash title is Chinese.
3. English mode: create mindmap, delete it, trash title is English.
4. Chinese mode: create mindmap, delete it, trash title is Chinese.
5. Historical titles are not rewritten.

### Stage 3: Unify Node And Tauri API Contracts

Goal: Web/local-server behavior and installed Tauri behavior should match.

Check and fix if needed:

- `create_note`
- `save_note`
- `delete_note`
- `restore_note`
- `delete_permanently`
- `list_notes`
- `list_trash`
- `create_mindmap`
- `save_mindmap`
- `delete_mindmap`
- `restore_mindmap`
- `delete_mindmap_permanently`
- `list_mindmaps`
- `list_mindmap_trash`
- `get_settings`
- `save_settings`

Requirements:

1. Inputs match.
2. Outputs match.
3. Error behavior matches.
4. Bad JSON does not make the whole list fail.
5. Save failure is not shown as success.
6. Field names remain consistent: `id`, `title`, `body`, `updatedAt`, `nodes`.
7. Illegal IDs, very long titles, and very long bodies are handled consistently.

### Stage 4: Fix Mindmap Save/Delete Race

Goal: A mindmap should not reappear after quick edit, page switch, and delete.

Requirements:

1. Add pending save tracking for mindmaps or an equivalent version protection.
2. Wait for pending saves before deleting the same mindmap.
3. Old async requests must not overwrite the current page.
4. Avoid visible UI freezing.
5. Avoid unhandled Promise errors.

Acceptance tests:

1. Create `AI_TEST_MINDMAP_RACE`.
2. Edit title, immediately switch pages, delete, verify it does not reappear.
3. Edit node, immediately delete, verify it does not reappear.
4. Rapidly switch Notes/Mindmap/Settings and verify stale requests do not overwrite the page.
5. Clean up test data.

### Stage 5: Add Minimal QA Script

Goal: Make future regressions easier to catch.

Cover at least:

1. Note CRUD.
2. Markdown Preview.
3. Local color/font-size formatting.
4. XSS and unsafe HTML.
5. Chinese/English default titles.
6. Trash delete/restore.
7. Mindmap CRUD.
8. Corrupted mindmap JSON tolerance.
9. Page switching stale request protection.
10. Delete-after-save race behavior.

Rules:

1. Test data starts with `AI_TEST_`.
2. Tests clean up after themselves.
3. Do not delete user data.
4. Do not clear all `local-data`.
5. Tests must be repeatable.

### Stage 6: Final Verification And Build

Run:

```bash
npm run web:build
node --check local-server.mjs
```

From `src-tauri`:

```bash
cargo check
cargo clippy -- -D warnings
```

If the installed app should be updated:

```bash
npm run build
```

Final handoff must include:

1. Completion status for every stage.
2. Acceptance test results.
3. Remaining issues.
4. Whether reinstalling is needed.
5. New executable path.
6. New installer path.
7. Test data cleanup status.

## Runtime Verification Rules

1. If a browser or Tauri app can be opened and clicked, perform real click verification.
2. If no browser is available, perform API and DOM/HTML checks.
3. If no Tauri GUI is available, still verify Rust checks and API contract by code.
4. Build success alone is not feature success.
5. Code review alone is not feature success.

## Test Data Rules

1. Test note titles start with `AI_TEST_`.
2. Test mindmap titles start with `AI_TEST_`.
3. Clean up only test data created by you.
4. Never clear the entire `local-data` directory.
5. If cleanup fails, record data ID and file path in the local `AGENT-HANDOFF.md`.

## File Safety

Do not:

1. Delete user data.
2. Clear `local-data`.
3. Use destructive git commands.
4. Delete unknown files.
5. Perform unrelated large refactors.
6. Hide errors to make tests pass.
7. Remove features to reduce failures.

If the worktree already has changes:

1. Do not overwrite them.
2. Determine whether they affect the current stage.
3. Ignore unrelated changes.
4. Stop and report if there is a real conflict.

## Markdown And Security

Markdown is the canonical note body format.

Allowed:

- Normal Markdown.
- Safe inline `span` with `color` or `font-size`.

Disallowed:

- Arbitrary HTML.
- Arbitrary style.
- `script`
- Event handlers.
- `javascript:` URLs.
- `iframe`, `object`, `embed`, `style`, `link`.

If a format cannot be safely supported, do not support it.

## UI Rules

1. Controls must look consistent.
2. Toolbar controls must not look like mismatched browser defaults.
3. Text must not overlap or overflow controls.
4. Toolbar must not block important note content.
5. Edit/Preview state must be clear.
6. New notes open in Edit.
7. Existing notes open in Preview.
8. Returning from another page to Notes should default to Preview unless the current flow is clearly new-note editing.
9. Dangerous actions need confirmation or recovery.

## Internationalization Rules

1. English mode should not show Chinese UI text.
2. Chinese mode should not show English UI text, except accepted fixed terms like `Edit` and `Preview`.
3. Historical note titles are user data and should not be auto-translated.
4. New default titles must follow the current language.
5. Trash shows the actual saved title.
6. Language changes should update nav, buttons, placeholders, tooltips, and confirm text.

## Stop Conditions

Stop the current stage if:

1. Build fails.
2. Runtime acceptance fails.
3. Test data cannot be cleaned.
4. There is risk of deleting user data.
5. Node and Tauri contracts conflict in a way that is unclear.
6. Security filtering cannot be proven safe.
7. User data format may be damaged.

When stopping, update the local `AGENT-HANDOFF.md` with what happened and how to continue.

## Continuation

If resuming after a stop:

1. Read `AGENTS.md`.
2. Read the local `AGENT-HANDOFF.md` if it exists.
3. Restate the current stage.
4. Restate completed items.
5. Restate remaining acceptance tests.
6. Continue from the unfinished point.
7. Do not redo passed stages unless code changed.

## Definition Of Done

A stage is done only when:

1. Code is implemented.
2. Required checks pass.
3. Runtime or equivalent verification passes.
4. Test data is cleaned.
5. The local `AGENT-HANDOFF.md` is updated.
6. Failures are not hidden.
7. No obvious regression is introduced.
