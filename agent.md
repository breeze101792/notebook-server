# Notebook Server — Agent Guide

A single-user Markdown notebook over a JSON HTTP API. Every response is JSON
(except this page). This document describes everything an AI agent or script
needs to read, search, and edit the notebook. It is served at `/agent.md` with
the auth-state line below filled in at request time; edit this file
(`agent.md` in the project root) to change what agents see.

Auth state right now: {{auth_state}}

## Authentication

Check the current state first:

```
GET /api/auth
→ {"enabled": bool, "hasAdmin": bool, "hasViewer": bool, "role": null|"admin"|"viewer"}
```

When `enabled` is false, skip this section entirely.

### Option A — session cookie (interactive clients)

```
POST /api/login   {"password": "..."}   → {"role": "admin"|"viewer"}
POST /api/logout                        → {"ok": true}
```

The session is a signed cookie; send it automatically (cookie jar) on all
later calls.

### Option B — API token (agents / scripts)

If you were issued a token, send it on every request:

```
Authorization: Bearer nbtk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Tokens never expire but can be revoked individually. Rules that matter to you:

- A malformed or unknown Bearer token fails with **401**, even if a valid
  session cookie exists — the presented credential always wins.
- Failed token attempts share the login rate limiter:
  **5 failures / 60 s per IP, then 429**. Do not retry a failing token in a
  tight loop.

### Roles

| Role | Can do |
| --- | --- |
| `admin` | Everything: reads, writes, config, token management |
| `viewer` | Reads only (`GET` endpoints); writes return **403** |

## Endpoints

### Reads

| Endpoint | Returns |
| --- | --- |
| `GET /api/tree` | `{"tree": [{name, type: "dir"\|"file", path, children?}]}` — dirs-first recursive listing of all Markdown files. |
| `GET /api/ls?path=sub` | `{path, entries: [{name, type, size, mtime}]}` — **non-recursive** listing of ONE folder, every file type included (attachments too). Hidden entries are skipped. Empty path lists the root. Use this instead of fetching the whole tree when you know the folder. |
| `GET /api/file?path=notes/a.md` | `{path, content, size, mtime}`. Add `&ifModifiedSince=<mtime>` to get an empty **304** when unchanged. |
| `GET /api/search?q=text` | See [Search](#search) below. |
| `GET /api/graph` | `{nodes: [{id, name, links}], edges: [{source, target}]}` — wikilink/markdown-link graph between notes. |
| `GET /api/config` | The UI preferences object (opaque). |
| `GET /api/info` | `{data_dir, config_dir}` — server folder paths. |

### Search

```
GET /api/search?q=PATTERN[&case=1][&regex=1][&file=path][&glob=p][&limit=N][&perFile=N][&order=path|mtime|count][&desc=1]
→ {query, matches: [{file, line, col, snippet}], truncated[, file]}
```

- `q` is a **literal substring** by default; `regex=1` treats it as a Python
  regex matched per line (invalid regex → **400**).
- `case=1` makes matching case-sensitive.
- `file=notes/a.md` scans **only that file** (404 if missing) — use this to
  search one note instead of fetching its whole content.
- `glob=notes/*.md` filters which files are scanned at all (fnmatch against
  the relative path or basename).
- Caps: `limit` total matches (default 200, max 2000) and `perFile`
  (default 20, max 200); raise them for big notebooks.
- Ordering: default keeps root-first scan order; `order=path|mtime|count`
  sorts files by relative path, modification time, or match count
  respectively. Add `desc=1` to reverse (e.g. newest first with mtime).
  Ordering regroups whole files; caps still apply during the scan
  (`truncated: true` means refine your query).
- The hit inside each `snippet` is wrapped in `<<`…`>>`.

### Writes (admin role required when auth is on)

| Endpoint | Body | Returns |
| --- | --- | --- |
| `POST /api/file` | `{"path": "a.md", "content": "full new content"}` | `{path, size}` — creates or *overwrites the whole file*. Parent folder must exist. For smaller changes prefer `POST /api/edit`. |
| `POST /api/file/append` | `{"path": "a.md", "content": "text", "create": false}` | `{path, size, appended}` — **atomic append** (single O_APPEND write; concurrent appends never clobber each other). Missing file is 404 unless `"create": true` (parent folder must exist). |
| `POST /api/edit` | `{"path": "a.md", "edits": [...]}` | `{path, size, applied}` — server-side partial patch; see below. |
| `POST /api/create` | `{"path": "notes/", "type": "dir"}` or `{"path": "a.md", "type": "file", "upsert": false, "content": ""}` | `{path, existed}`; **409** if it already exists — unless `"upsert": true`, which makes the call idempotent: an existing target of the same type succeeds with `existed: true` and is NOT modified (a type mismatch is still 409). Optional `content` seeds a newly created file. |
| `POST /api/move` | `{"from": "a.md", "to": "b.md", "onConflict": "error"}` | `{from, to}`. `onConflict`: `error` (**409** if destination exists, the default), `skip` (200 + `"skipped": true`, nothing changed), or `overwrite` (destination replaced). When the destination does not exist, a plain-file move uses atomic link+unlink, so move-if-absent never clobbers a concurrently created target. |
| `POST /api/copy` | `{"from": "a.md", "to": "b.md", "onConflict": "error"}` | `{to}`; recursive for folders; same three `onConflict` modes. File copies are created exclusively, so copy-if-absent can never truncate an existing destination. |
| `POST /api/delete` | `{"path": "notes/"}` | `{path}`; folders are deleted recursively. Destructive. |

### Partial edits: `POST /api/edit`

Ops run in order against an in-memory buffer; the result is written back in
one atomic replace. If ANY op fails, the whole batch is rejected with **400**
and the file is left untouched (all-or-nothing).

```jsonc
{"path": "journal/2026.md", "edits": [
  {"op": "append",      "text": "- done thing\n"},
  {"op": "prepend",     "text": "# Top\n"},
  {"op": "find_replace", "find": "TODO fix", "replace_with": "FIXED",
   "count": 1,                      // optional; 0/omitted = all
   "regex": false,                  // true -> Python regex, \1 backrefs work
   "ignore_case": false,            // regex mode only
   "optional": false},              // false (default): zero matches = 400
  {"op": "line_insert", "after_line": 3, "text": "new line\nmore\n"},
  {"op": "line_replace", "start": 10, "end": 12, "text": "replacement\n"},
  {"op": "line_delete",  "start": 20, "end": 21}
]}
```

Line numbers are 1-based and inclusive; `"end"` defaults to `"start"`.
`line_insert` takes exactly one of `after_line` (0 = top) or `before_line`.
Line ops normalise the buffer so the file ends with a trailing newline.

### Config & tokens (admin role)

```
POST /api/config                body: the full preferences JSON object (replaces it)
GET  /api/auth/tokens           → {"tokens": [{name, role, created}]}
POST /api/auth/tokens           {"name": "my-agent", "role": "viewer"}
                                → {"ok": true, name, role, created, "token": "nbtk_..."}  # shown ONCE
DELETE /api/auth/tokens/<name>  → {"ok": true}
```

## Path rules

- All paths are relative to the notebook root and use forward slashes:
  `notes/project/ideas.md`.
- Absolute paths (`/etc/passwd`), empty paths, and anything that escapes the
  root (`../x`) are rejected with **400**.
- `/api/tree`, `/api/search` and `/api/graph` only see `.md` files;
  `/api/ls` sees everything.

## Errors

Non-2xx responses are JSON: `{"error": "<human-readable message>"}`.

| Status | Meaning |
| --- | --- |
| 400 | Bad request — invalid path, missing field, wrong type, bad regex |
| 401 | No valid credential (or a bad Bearer token was presented) |
| 403 | Authenticated but insufficient role (viewer attempting a write) |
| 404 | File/folder/token not found |
| 409 | Conflict — target already exists (unless upsert/onConflict opts out) |
| 429 | Rate limited — too many failed logins/token attempts from your IP |

## Common recipes

```bash
# Append a line atomically (no read-modify-write race):
curl -s -X POST http://HOST/api/file/append \
     -H 'Content-Type: application/json' \
     -d '{"path":"journal/2026-08.md","content":"- did the thing\n"}'

# Edit one section without rewriting the file:
curl -s -X POST http://HOST/api/edit \
     -H 'Content-Type: application/json' \
     -d '{"path":"notes/topic.md","edits":[
           {"op":"find_replace","find":"old text","replace_with":"new text","optional":true}]}'

# Idempotent create (safe to re-run, never clobbers existing content):
curl -s -X POST http://HOST/api/create \
     -H 'Content-Type: application/json' \
     -d '{"path":"notes/topic.md","type":"file","upsert":true,"content":"# Topic\n"}'

# Move only if the destination is free (skip instead of 409):
curl -s -X POST http://HOST/api/move \
     -H 'Content-Type: application/json' \
     -d '{"from":"draft.md","to":"notes/draft.md","onConflict":"skip"}'

# List one directory without pulling the whole tree:
curl -s 'http://HOST/api/ls?path=notes'

# Regex search across a subtree, newest files first:
curl -s 'http://HOST/api/search?q=deploy%20(failed|ok)&regex=1&glob=ops/*.md&order=mtime&desc=1'

# Search inside one specific file:
curl -s 'http://HOST/api/search?q=todo&file=notes/big-plan.md'
```

## Suggested workflow

```bash
# 0. Discover state
curl -s http://HOST/api/auth

# 1. List notes
curl -s http://HOST/api/tree

# 2. Search before editing (avoid duplicates)
curl -s "http://HOST/api/search?q=topic"

# 3. Read the note you want to change
curl -s "http://HOST/api/file?path=notes/topic.md"

# 4a. Small change? Patch in place (atomic, all-or-nothing):
curl -s -X POST http://HOST/api/edit \
     -H "Authorization: Bearer nbtk_..." -H "Content-Type: application/json" \
     -d '{"path":"notes/topic.md","edits":[{"op":"find_replace","find":"old","replace_with":"new"}]}'
# 4b. Whole-file rewrite still works:
curl -s -X POST http://HOST/api/file \
     -H "Authorization: Bearer nbtk_..." \
     -H "Content-Type: application/json" \
     -d '{"path":"notes/topic.md","content":"...entire updated markdown..."}'

# 5. Re-read to verify
curl -s "http://HOST/api/file?path=notes/topic.md"
```
