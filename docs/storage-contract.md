# XG-Seeking Storage Contract

Shared source of truth for the Node backend, Rust backend, frontend, and smoke tests.

Version: 1.0

---

## 1. Data Model

### Note
```json
{
  "id": "uuid-string",
  "title": "string (max 500 Unicode code points)",
  "body": "string (max 100_000 Unicode code points)",
  "updatedAt": 1700000000000,
  "revision": "sha256-hex-string"
}
```

Storage format: Markdown file (`{id}.md`)
```
# Title

Body text
```

### Mindmap
```json
{
  "id": "uuid-string",
  "title": "string (max 500 Unicode code points)",
  "updatedAt": 1700000000000,
  "revision": "sha256-hex-string",
  "nodes": [
    {
      "id": "uuid-string",
      "text": "string",
      "collapsed": false,
      "children": []
    }
  ]
}
```

Storage format: JSON file (`{id}.json`)

### Settings
```json
{
  "language": "zh | en",
  "title": "string",
  "theme": "system | light | dark"
}
```

Storage format: JSON file (`settings.json`)

---

## 2. API Commands

### 2.1 Notes

| Command | Method | Payload | Response | Notes |
|---|---|---|---|---|
| `list_notes` | POST | `{}` | `Note[]` | Returns all active notes sorted by updatedAt DESC |
| `create_note` | POST | `{ title?: string }` | `Note` | Title defaults to localized "Untitled" |
| `save_note` | POST | `{ id, title, body, expectedRevision?: string }` | `Note` | If expectedRevision provided and mismatched → CONFLICT |
| `delete_note` | POST | `{ id, expectedRevision?: string }` | 204 No Content | Soft-delete: moves to trash/ |
| `list_trash` | POST | `{}` | `Note[]` | Lists trashed notes |
| `restore_note` | POST | `{ id, expectedRevision?: string }` | `Note` | Moves from trash/ back to notes/ |
| `delete_permanently` | POST | `{ id, expectedRevision?: string }` | 204 No Content | Irreversible delete from trash |

### 2.2 Mindmaps

| Command | Method | Payload | Response | Notes |
|---|---|---|---|---|
| `list_mindmaps` | POST | `{}` | `Mindmap[]` | Returns all active mindmaps sorted by updatedAt DESC |
| `create_mindmap` | POST | `{ title?: string }` | `Mindmap` | Title defaults to localized "Untitled" |
| `save_mindmap` | POST | `{ mm: Mindmap, expectedRevision?: string }` | `Mindmap` | Tauri sends `mm` nested; Node accepts flat or nested |
| `delete_mindmap` | POST | `{ id, expectedRevision?: string }` | 204 No Content | Soft-delete: moves to mindmaps_trash/ |
| `list_mindmap_trash` | POST | `{}` | `Mindmap[]` | Lists trashed mindmaps |
| `restore_mindmap` | POST | `{ id, expectedRevision?: string }` | `Mindmap` | Moves from mindmaps_trash/ back to mindmaps/ |
| `delete_mindmap_permanently` | POST | `{ id, expectedRevision?: string }` | 204 No Content | Irreversible delete from trash |

### 2.3 Settings

| Command | Method | Payload | Response |
|---|---|---|---|
| `get_settings` | POST | `{}` | `Settings` |
| `save_settings` | POST | `{ language, title, theme }` | 204 No Content |

---

## 3. Error Codes

All errors return JSON with `code` and `message` fields.

| Code | HTTP Status | Meaning |
|---|---|---|
| `CONFLICT` | 409 | `expectedRevision` does not match current file revision. Response includes `currentRevision`. |
| `NOT_FOUND` | 404 | Requested resource does not exist. |
| `VALIDATION` | 400 | Input validation failed (bad ID, title too long, etc.). |
| `IO` | 500 | Disk I/O error. |

### Node HTTP Response Format
```json
{ "code": "CONFLICT", "message": "...", "currentRevision": "abc123" }
```

### Tauri Error Format
Frontend `invoke()` throws on Tauri errors. The error message string is prefixed with the error code:
- `CONFLICT:abc123` — revision conflict, current revision is `abc123`
- `NOT_FOUND:` — resource not found
- `VALIDATION:` — validation error
- `IO:` — I/O error

---

## 4. Revision Model

- **revision** is a SHA-256 hex digest of the raw file content (NOT the parsed/serialized form)
- For notes: SHA-256 of the raw Markdown bytes in the `.md` file
- For mindmaps: SHA-256 of the raw JSON bytes in the `.json` file
- The `revision` field is computed by the backend and included in all read responses
- The `revision` field is NEVER stored inside the file — it is metadata only
- `expectedRevision` is an optional parameter on all mutating commands
- If `expectedRevision` is provided and does not match the current file's SHA-256:
  - Return `CONFLICT` with the current revision
  - Do NOT modify the file
- If `expectedRevision` is null/undefined/empty: skip the revision check (backward compatible)

---

## 5. Validation Rules

### Unicode Code Points
- Title: max 500 Unicode code points (`Array.from(text).length` in Node, `chars().count()` in Rust)
- Body: max 100_000 Unicode code points
- Must NOT use byte length or UTF-16 code unit length

### Empty Title
- Frontend MUST normalize empty titles to the current UI language's default before calling save
- Backend MUST reject empty or whitespace-only titles in save_note (never in create_note for backward compat)
- Backend returns the actual canonical title written to disk

### ID Format
- Must match `/^[a-zA-Z0-9_-]+$/` (allows UUIDs with dashes)
- Generated by backend using `crypto.randomUUID()` (Node) or `uuid::Uuid::new_v4()` (Rust)
- Mindmap node IDs generated by frontend using `crypto.randomUUID()` or v4 fallback

---

## 6. Old/Missing Data Handling

### Old Mindmap JSON
- Missing `nodes` field → default to `[]`
- Missing `collapsed` on node → default to `false`
- Missing `children` on node → default to `[]`
- Unknown JSON fields MUST be preserved across read-save cycles (do not strip unknown keys)

### Schema Version (future)
- Current default: `schemaVersion` absent = v1
- When adding `schemaVersion`, write v2 only on successful user-triggered save (not on list/read)

### Corrupted Files
- A single unreadable/unparseable file MUST NOT break the entire list
- Skip the bad file, log a warning, continue listing other files
- Return available warnings in a non-blocking way

### .bak Recovery (Node only)
- On startup: scan each data directory
- For `.bak` files where the main file is missing → rename to restore
- For orphan `.tmp` files → delete
- The Tauri backend uses `storage::recover_bak_files()` and `storage::cleanup_tmp_files()`

---

## 7. Atomic Write Protocol

1. Generate unique temp filename: `.{timestamp}-{random}.tmp`
2. Write content to temp file
3. `fsync` the temp file
4. Rename temp → target (atomic on same filesystem)
5. `fsync` the parent directory (best-effort; skip on unsupported platforms)
6. On failure: delete temp file, re-throw error

---

## 8. Frontend API Adapter

The frontend MUST normalize backend responses to a consistent format regardless of transport:

```js
// Normalized error shape (both Node HTTP and Tauri invoke):
{ code: "CONFLICT"|"NOT_FOUND"|"VALIDATION"|"IO", message: "...", currentRevision?: "..." }
```

- Node HTTP: parse JSON error body
- Tauri: parse error message string prefix for code
- All invoke calls go through the adapter
- The rest of the frontend only sees normalized errors
```

## 9. Conflict Handling (Frontend)

When the frontend receives a CONFLICT error:
1. Keep the local draft (do NOT discard unsaved changes)
2. Do NOT auto-overwrite the file
3. Offer user options:
   a. Reload latest version from backend (discards local changes)
   b. Save as new note/mindmap (preserves local changes under a new ID)

## 10. Hardened Mutation And Health Rules

- `save_note` and `save_mindmap` update existing active files only. Only `create_*` may create a file.
- Revision checking and the following write, move, or delete run under the same per-path backend lock.
- Temporary write names use UUIDs. Backup cleanup failure after a successful replacement is a warning, not a failed save.
- Frontend delete, restore, and permanent-delete calls include the revision of the item being mutated.
- `get_storage_warnings` returns non-sensitive unreadable-file counts. Bad files remain untouched and do not prevent readable items from loading.
- Mindmaps are limited to 1 MiB serialized size, 5,000 nodes, depth 100, and 10,000 Unicode code points per node.
- Node browser-mode `/api/*` requests require `POST` and `application/json`; Host must be loopback and Origin, when present, must match it exactly.
- Tauri window close is intercepted until dirty note and mindmap saves complete successfully.
