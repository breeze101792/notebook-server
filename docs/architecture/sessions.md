# Sessions — architecture and implementation contract

Status: implemented. This is the document `build` implemented from; the
verification record is in the commit that landed it.
The product definition is
[`requirements/features/sessions.md`](../requirements/features/sessions.md);
the visual handoff, copy and CSS are [`ui/sessions.md`](../ui/sessions.md).
Where this document and those disagree, this document owns the data model and
the call order; `ui/sessions.md` owns pixels and copy.

A **session** is a named set of unpinned open tabs plus its own active tab.
The workspace's pinned tabs are shared and visible in every session. Sessions
are flat and belong to one workspace; nothing is shared across workspaces.

## 1. What changes, and what does not

| Area | Change |
| --- | --- |
| `static/js/tabs.js` | Owns the session model, the swap, create/rename/delete/move, the restore extension, and the session-aware file operations. |
| `static/js/sessions.js` | **New.** The Sessions side-panel view: header, row list, row menu, name dialog. No tab data. |
| `static/js/activity.js` | Registers the `sessions` view after Explorer (the same block as the other six). |
| `static/js/viewer.js` | An empty-state variant that keeps the cache; a way to abandon an in-flight activation; the hidden-session guard on external changes. |
| `static/js/menu.js` | `buildSubmenu()` honours `disabled` and `title` (for the read-only role). |
| `static/js/app.js` | Two scoped config keys; normalise + restore; persist from `tabs:changed`. |
| `templates/index.html` | `#sessions-view` host; the `sessions.js` script tag. The tab bar is unchanged. |
| `static/css/style.css` | One appended block (UI spec Appendix A). No existing rule changes. |
| `static/sw.js` | Precache `sessions.js`; bump `CACHE`. |
| `app.py` | Two scoped keys; the workspace-state route preserves them when an older client omits them; `_ACTIVE_VIEWS` gains `sessions`. |
| Server routes | **None added or changed in shape.** Sessions ride the existing workspace-state write. |

Not touched: the HTTP API surface, the workspace registry, the file tree,
search, the AI assistant, export, **the tab bar**, and the phone shell (the
Sessions icon is hidden there; the phone has no tab bar, `style.css:7101-7103`).

## 2. Ownership

The single rule that keeps the model honest:

> **The active session is the live tab view. Inactive sessions are stored.**

`tabs.js` already holds the live view — `ordered`, `openSet`, `pinned`,
`activePath` (`tabs.js:29-32`). Those keep their meaning exactly. A new,
private record set holds only the sessions that are **not** on screen:

```js
// tabs.js, module-private
let sessionOrder = [];                 // ids, display order
const sessionNames = new Map();        // id -> display name
const storedSessions = new Map();      // id -> { openFiles: [path], activeFile }
let activeSessionId = "";
```

- There is **no duplicate** of the active session's tab list. It is `ordered`
  (minus `pinned`) and `activePath`, at every instant.
- `sessionNames` and `sessionOrder` are metadata; they never hold paths.
- A **pinned** path is shared and never stored in a session list. An **unpinned**
  path may be open in several sessions at once; each occurrence is an
  independent tab entry pointing at the same file and the same viewer buffer.
  A session's own list has unique paths.
- Closing a tab in one session removes only that occurrence; the viewer cache,
  draft and watcher baseline survive while another session or a pin still holds
  the path. `dropTab` and `closeStoredPath` enforce this.

`storedSessions` never contains `activeSessionId`. `installSession(id)` deletes
the record it consumes; `storeOutgoing()` writes the record it leaves.

## 3. Config shape

Under `config.json -> workspaceState.<workspace id>`:

```json
{
  "sessions": [
    { "id": "main", "name": "Main",
      "openFiles": ["notes/sensors.md", "notes/timing.md"],
      "activeFile": "notes/sensors.md" },
    { "id": "s-7f3a2c", "name": "Reading", "openFiles": [], "activeFile": null }
  ],
  "activeSessionId": "main",
  "pinnedFiles": ["notes/power-budget.md"],
  "openFiles": ["notes/power-budget.md", "notes/sensors.md", "notes/timing.md"],
  "activeFile": "notes/sensors.md",
  "lastFile": "notes/sensors.md",
  "recentFiles": []
}
```

Rules:

| Field | Rule |
| --- | --- |
| `sessions[].openFiles` | Unpinned paths only, in strip order. Never a pinned path. At most 40. The same path may appear in several sessions. |
| `sessions[].activeFile` | A path that was the active tab; may be pinned. `null` for an empty session. |
| `activeSessionId` | Always one of `sessions[].id`. |
| `pinnedFiles` | Unchanged: workspace-global, shared by every session. |
| `openFiles` | **Mirror**: the live `ordered` including pins — exactly what `emitChanged()` sends today (`tabs.js:416-422`). Preserves `app.js:975-980`, the browser test, and any older client. |
| `activeFile` | **Mirror**: the live `activePath`. Keeps `_acp_context_preamble` (`app.py:2605-2645`) naming the open note. |

`sessions` is authoritative on load. The two mirrors are derived and are
rewritten by the first `tabs:changed`. `sessions` absent → migrate (below).
`lastFile` is untouched and stays the recents/"where I was" pointer.

Limits, as named constants in `tabs.js`:

| Constant | Value | Enforced by |
| --- | --- | --- |
| `SESSION_MAX_COUNT` | 20 | create disabled; normalisation drops the overflow |
| `SESSION_NAME_MAX` | 40 | dialog `maxlength` + normalisation |
| `SESSION_FILES_MAX` | 40 unpinned | `open`/move refusal with a notice; normalisation truncates |

Worst case state is ~100 KiB, inside `WORKSPACE_STATE_MAX_BYTES = 256 KiB`
(`app.py:77`). A hand-edited blob over the cap is refused by the route and
only `console.warn`ed (`app.js:542`) — unchanged behaviour.

## 4. Normalisation and migration

One exported function, called by `app.js` after the tree is available:

```js
NB.tabs.normaliseSessions(raw, known)
// raw:   { sessions, activeSessionId, openFiles, activeFile, pinnedFiles }
// known: (path) => boolean   // special tabs pass; files must be in the tree
// returns: { sessions, activeSessionId, pinnedFiles, migrated }
```

Rules, in order:

1. **`sessions` is not a non-empty array** → migrate: one session
   `{id: "main", name: "Main", openFiles: raw.openFiles, activeFile: raw.activeFile}`,
   `activeSessionId = "main"`, `migrated = true`. This is the first boot after
   the upgrade; it preserves today's restore exactly.
2. Drop entries that are not objects; give every remaining entry an id. A
   duplicate stored id is regenerated (the first keeps it).
3. `name` = trimmed string, truncated to 40; empty → `Session N`; a
   case-insensitive duplicate gets ` 2`, ` 3`, … appended.
4. `openFiles` = strings that pass `known`, deduped, order preserved, capped at
   40. `activeFile` = the stored value if it is in `openFiles` or pinned,
   else the first `openFiles` entry, else `null`.
5. Remove every pinned path from every session (pinned wins).
6. `activeSessionId` = the stored id if it exists, else the first session's id.
7. Cap at 20: keep the first 19 plus the active session (appending it if it is
   beyond the cap, dropping the last non-active entry).
8. `pinnedFiles` = strings that pass `known`, deduped, **in strip order**: take
   the order from `raw.openFiles` first (that mirror carries the pinned prefix
   in display order), then append any saved pin the mirror did not contain.
9. `migrated` is true only for rule 1.

Empty sessions are valid and survive step 7 (they are a place the user made).
There is **no cross-session dedupe**: the same note may be open in several
sessions (each session's own list was deduped in rule 4).

## 5. Restore

`restore` keeps its four positional arguments and gains a trailing optional
fifth, so the four existing DOM-test calls keep working
(`tests/dom/test_dom.js:21218, 22144, 22153, 22165`):

```js
await NB.tabs.restore(openFiles, activeFile, fallback, pinnedFiles, sessionState)
```

With `sessionState` (`normaliseSessions` output):

1. Seed `sessionOrder`, `sessionNames`, `pinned` (from `sessionState.pinnedFiles`).
2. For every session, filter again against the live tree (the tree may have
   changed since normalisation); drop a session file only, never the session.
3. `activeSessionId` from the state; `installSession(activeSessionId)` builds the
   live view: `ordered = [...pinned, ...activeSession.openFiles]`, `openSet` from
   that, `activePath` = the session's `activeFile` if it is in the set, else the
   first session file, else the first pinned, else `null`.
4. Every other session is stored as-is.
5. If `ordered` is empty **and** `fallback` is non-null, `open(fallback)` into the
   active session. `app.js` passes a fallback **only when `migrated` is true**;
   after the first boot an empty session stays empty (the decision in
   `requirements/features/sessions.md` §5.4).
6. `render()`, then `activate(activePath)` if there is one, else
   `NB.viewer.showSessionEmpty()`.

Without `sessionState`, the function behaves exactly as it does today **and
seeds one `main` session** from the legacy arguments (`sessionOrder = ["main"]`,
name "Main", `storedSessions` empty), so a phone that rotates into the desktop
shell still has a valid model and the Sessions view has one row.

`app.js` boot replaces the hand-rolled filter (`app.js:975-980`) with:

```js
const known = (p) => isSpecialTab(p) || treeHas(tree, p);
const state = NB.tabs.normaliseSessions({
  sessions: cfg.sessions, activeSessionId: cfg.activeSessionId,
  openFiles: cfg.openFiles, activeFile: cfg.activeFile,
  pinnedFiles: cfg.pinnedFiles,
}, known);
const fallback = state.migrated
  ? (cfg.lastFile && treeHas(tree, cfg.lastFile) ? cfg.lastFile
     : firstFilePath(tree) || null)
  : null;
```

The phone branch passes no `sessionState` and an empty set, so the phone never
sees sessions.

## 6. The swap

`NB.tabs.swapTo(id)` is the only way the live view becomes another session.
It is async and guarded by its own token, for the same reason `activate` has one
(`tabs.js:449-453`).

```js
let sessionToken = 0;

async function swapTo(id) {
  if (id === activeSessionId) return true;
  if (sessionOrder.indexOf(id) < 0) return false;
  const token = ++sessionToken;
  const stale = () => token !== sessionToken;

  // Stop the in-flight activation and its recovery path (tabs.js:486-490),
  // and the viewer's own UI write (viewer.js:725-754).
  activateToken++;
  NB.viewer.cancelActivation();

  const ok = await NB.viewer.commitForTabSwitch();   // stash source / exit hybrid
  if (!ok || stale()) return false;

  storeOutgoing();              // live view -> storedSessions[activeSessionId]
  activeSessionId = id;
  installSession(id);           // consume the record into ordered/openSet/activePath
  finishGhosts();               // no ghost from the old strip survives
  frozenWidths = null;          // the new strip measures itself
  clearPins(realTabs());

  render();
  emitChanged();
  if (!ordered.length) { NB.viewer.showSessionEmpty(); return true; }
  await activate(activePath);
  return true;
}
```

Points that are load-bearing:

- **Check the commit's return.** `commitForTabSwitch()` returns `false` when a
  hybrid save fails (`hybrid.js:7250-7266`) and leaves hybrid active. Switching
  anyway would let the next keystroke serialize to the old path.
- **Bump both tokens first.** `activateToken` stops `tabs.activate` from taking
  its `!openSet.has(path)` recovery (`tabs.js:486-490`); `cancelActivation()`
  stops `viewer.activate` from writing `active`, rendering, and emitting
  `file:open` for a file that no longer belongs to the strip.
- **Mutate before emitting.** `activeSessionId` and the live sets change together
  before `emitChanged()`, so the snapshot `app.js` takes in its listener is
  consistent (`app.js:640-646`).
- Two rapid picks: the second bumps `sessionToken`; the first aborts at its next
  check and never installs.
- Ghosts and the width freeze belong to the old strip. A ghost is data
  (`tabs.js:83`) and would otherwise materialize in the new strip for 280 ms.
- `activate(activePath)` is a second commit, which is a no-op after the first
  (the buffer is already stashed, `viewer.js:953-954`).

`installSession(id)`:

```js
const rec = storedSessions.get(id) || { openFiles: [], activeFile: null };
storedSessions.delete(id);
// Keep the pins in their displayed order: `ordered`'s prefix, not the Set's
// insertion order, because drag-reorder changes the strip and not the Set.
const pinOrder = ordered.filter(p => pinned.has(p));
ordered.length = 0; openSet.clear();
for (const p of pinOrder) { ordered.push(p); openSet.add(p); }
for (const p of rec.openFiles) if (!pinned.has(p) && !openSet.has(p)) {
  ordered.push(p); openSet.add(p);
}
activePath = (rec.activeFile && openSet.has(rec.activeFile))
  ? rec.activeFile
  : (rec.openFiles.find(p => openSet.has(p)) || ordered[0] || null);
```

`storeOutgoing()` writes
`{ openFiles: ordered.filter(p => !pinned.has(p)), activeFile: activePath }`
under `activeSessionId`. An empty session stores `{openFiles: [], activeFile: null}`
— deliberately, so it is not confused with a missing record.

## 7. Session operations

All of them end in `render()` + `emitChanged()`, which is what marks the state
dirty for `app.js` (`persistConfig`, `scheduleWorkspaceState`).

| Operation | Contract |
| --- | --- |
| `createSession(name)` | Validate (non-empty after trim, ≤40, unique case-insensitive, count < 20). Push the id and name, store an empty record, then `await swapTo(id)` — the header `+` switches to the new session. Return `{ok, code}` so the dialog can mark the field. |
| `createSessionFromTab(path, name)` | Same validation; create the record; `moveToSession(path, id)`; **do not switch** (requirements AC28). |
| `renameSession(id, name)` | Any session. Validate, set the name, render, `emitChanged()`. Ids never change. |
| `deleteSession(id)` | Refuse when `sessionOrder.length === 1`. The UI confirms first, covering the target session's `viewer.isDirty` files (and `NB.hybrid.isDirty()` when the target is active). **Active id:** bump the tokens, `await commitForTabSwitch()` (abort on `false`), `dropTab` every **unpinned** live path without prompting, delete the record/name/order entry, pick the previous session in order else the next, `installSession` it (no outgoing record to save), render, emit, activate or show the empty state. Pinned tabs stay. **Stored id:** remove the record/name/order entry **first**, then `closeStoredPath` each of its paths — which closes the viewer cache and the special tab only when no other session or pin still holds that path. Render, emit; the active session is untouched. |
| `moveToSession(path, id)` | `path` must be unpinned and live; `id` must be another session. **Do not call `viewer.close`** — the cache entry and any draft travel with the file. Remove from `ordered`/`openSet`; append to the target record **unless it already lists the path** (then the source copy is simply removed); fix the source's `activePath` (activate the neighbour, or show the empty state if the strip empties); render, emit. |
| `hasStoredPath(path, exceptId)` | Internal: does an inactive session still list the path? Used by `dropTab`, `closeStoredPath` and `deleteSession` to keep a shared buffer alive. |

Deleting a stored session is the only path that closes cached files the user
cannot see. Its cleanup runs after the record is gone, and `closeStoredPath`
closes only a path no other session or pin holds — otherwise the same note is
still visible somewhere and must keep its cache, draft and watcher baseline.

## 8. Opening files

`open(path, opts)` always opens in the **active** session. A note that is
already open in another session is left alone there; clicking it here adds or
activates a tab in the current session. No click ever switches sessions.

```js
if (!openSet.has(path)) {
  if (unpinnedCount() >= SESSION_FILES_MAX) {
    notify(SESSION_FULL_MESSAGE);
    return false;
  }
  openSet.add(path);
  ordered.push(path);
}
if (opts.activate !== false) await activate(path);
```

`open(path)` on a pinned path is already in the active `openSet`; it just
activates. `open(path, {activate:false})` is the search view's failure recovery
(`activity.js:1131-1133`): it adds the tab to the active session without
activating it. `openSpecial` follows the same rule.

If the active session already holds `SESSION_FILES_MAX` unpinned tabs, `open`
adds nothing and reports it through `NB.app.notify` ("This session is full —
close a tab or open a new session."). `restore` and `normaliseSessions`
truncate instead of refusing, because no user action is being rejected at load
time.

Back/forward keeps calling `open` when a history entry is not open
(`viewer.js:1425-1432`); it now opens the note in the active session. There is
no session switch on the nav path.

## 9. Pinning and file operations

**Pin** (`tabs.js:617-632`): remove the path from the live `ordered` (existing)
**and from every stored session**; if a stored session's `activeFile` was that
path, fall back to its first remaining file or `null`. Pinning is what makes a
tab shared.

**Unpin**: existing behaviour inserts the path into the active session's strip
(`tabs.js:624-628`). It is now visible only in the active session — the Firefox
rule.

**Close** (`dropTab`): remove this occurrence from the active strip. The viewer
cache, any stashed draft and the watcher baseline are deleted **only when no
pinned tab or stored session still holds the path** (`hasStoredPath`); otherwise
the other occurrence keeps them. `conflictSet` is cleared only on the last
close. A special tab's `onClose` runs only on the last close too, so a `§graph`
open in another session keeps its module alive.

**`rename(from, to)`** (`tabs.js:579-614`): apply `remap` to `ordered`,
`openSet`, `pinned`, `frozenWidths` (existing) **and every stored session's
`openFiles`/`activeFile`**, including every duplicate occurrence. Remove the
`if (!pairs.length) return` early-out (`tabs.js:593`) or move it after the stored
pass: a file that exists only in an inactive session must still be re-keyed.
Call `NB.viewer.rename` for every pair; it is a safe no-op for an uncached path
(`viewer.js:766-774`).

**`file:deleted`** (`tabs.js:928-932`): drop the path from the live strip and
from every stored session; `closeStoredPath` closes the viewer cache and calls
the special tab's `onClose` once, when the last occurrence is gone. A deleted
file's draft goes with it, as today.

**`auth:locked`** (`tabs.js:958`): `sessionToken++`, clear every stored
session's `openFiles` first, stop the special tabs those lists held, then
`clearAll()` the live strip (so its `dropTab` paths no longer look "elsewhere")
and `viewer.clear()`. Keep names, ids, order and `activeSessionId`, so
re-entering the workspace shows the same named places, empty. The lock
invalidates every buffer.

**`dropTab(path)`** also clears the path's conflict flag, but only on the last
close. The dead `_dropTab` hook (`tabs.js:947`) can go.

## 10. viewer.js

Three changes.

**10.1 Abandon an activation.** Export `cancelActivation()` which bumps the
module-private `activateToken` (`viewer.js:725`). It writes nothing else; a
pending fetch then seeds the cache and returns without touching `active`, the
DOM, or `file:open` (`viewer.js:734-742`).

**10.2 An empty state that keeps the cache.** `showWelcome()`
(`viewer.js:672-704`) starts with `cache.clear()`, which would destroy every
inactive session's stashed draft. Split it:

```js
function showWelcome(opts) {           // opts.keepCache
  active = null;
  if (!(opts && opts.keepCache)) cache.clear();
  ...
  hideSpecialContainers();             // new: showWelcome does not call it today
  hideDraftBar();                      // new: only clear() hid it today
  ...
}
```

- `clear()` calls `showWelcome()` (default: clears) — unchanged.
- `NB.viewer.showSessionEmpty()` calls `showWelcome({keepCache: true})`.
- Replace the two `NB.viewer.clear()` calls that mean "the strip is empty, show
  the welcome page" — `tabs.js:501` and `tabs.js:561` — with
  `showSessionEmpty()`. Both sit after `dropTab` has already closed the files
  they name, so their cache entries are gone; only the other sessions' entries
  were at risk.
- The special-tab container is hidden here because no `activate()` follows a
  target with pinned-only tabs; without it a `§graph` container can stay on top
  of the welcome page.

**10.3 External changes in a hidden session.** In the
`file:external-change` handler (`viewer.js:1141-1206`), compute
`const live = !NB.tabs || !NB.tabs.isOpen || NB.tabs.isOpen(path);` before the
dirty check (the handler runs after `tabs.js` is defined; guard for the harness).

| Path state | Behaviour |
| --- | --- |
| clean, live or hidden | Refresh the cache silently (today's `else` branch at `viewer.js:1201-1203`). |
| dirty, live | Today's confirm; Cancel marks the conflict. |
| dirty, hidden | **No modal.** Emit `viewer:conflict {path, conflict:true}`, keep the buffer, return. The badge appears when the user switches to that session. |

This keeps a burst of external writes from raising dialogs about notes the user
cannot see. `isOpen` is active-session-only, which is exactly the test.

## 11. Persistence and the server

**Client.** `app.js`:

- `WORKSPACE_STATE_KEYS` (`app.js:24-27`) gains `"sessions"` and
  `"activeSessionId"`. `workspaceStateSnapshot()` then carries them, and
  `flushWorkspaceState` posts them to `/api/workspace-state` on its existing
  250 ms debounce.
- `tabs:changed` (`app.js:640-646`) copies `sessions` and `activeSessionId` from
  the payload into `cfg`. The payload is built by `emitChanged()`:

  ```js
  NB.evt.emit("tabs:changed", {
    openFiles: ordered.slice(), activeFile: activePath,
    pinnedFiles: ordered.filter(p => pinned.has(p)),
    sessions: snapshot(), activeSessionId,
  });
  ```

  `snapshot()` composes `sessionOrder` with the live view for the active id and
  the stored records for the rest. It never persists `dirty`/`count`; those are
  `getSessionList()`'s UI-only fields.

**Server.** Three small changes in `app.py`:

1. `_WORKSPACE_SCOPED_CONFIG_KEYS` (`app.py:92-95`) gains `"sessions"` and
   `"activeSessionId"`, so a whole-blob `POST /api/config` from a page without a
   workspace folds stray top-level copies under `workspaceState.default`
   (`_fold_legacy_workspace_state`, `app.py:1427`).
2. `set_workspace_state()` (`app.py:1660-1705`) replaces the whole entry
   (`workspace_state[wid] = state`). Before the size check, preserve the session
   fields when the caller omits them **and the stored entry has them**:

   ```python
   existing = workspace_state.get(wid)
   if isinstance(existing, dict) and "sessions" in existing:
       for key in ("sessions", "activeSessionId"):
           if key not in state:
               state[key] = existing[key]
   ```

   This is the forward-compatibility guard: a tab loaded before the upgrade
   posts the old key set and would otherwise delete every other session. A new
   client always sends `sessions`, so a legitimate change (including deleting a
   session) is never blocked.
3. `_ACTIVE_VIEWS` (`app.py:1273`) gains `"sessions"`, so a saved
   `activeView: "sessions"` is accepted by `boot_state()` and the server renders
   `#sessions-view` visible on the first frame. The test that keeps
   `_ACTIVE_VIEWS` in step with the registered views and the `data-view` hosts
   (`tests/test_app.py`) gains the new id too.

There is no first-paint session *name*: the view is rendered by `sessions.js`
from the restored model, exactly like the Bookmarks list.

Phone writes stay gated (`app.js:641`); the phone's restored state has no
sessions. The phone must also not adopt a saved `activeView: "sessions"`
(`app.js:955-957` already forces `ai` to explorer there; add `sessions`), and
`html[data-ui-mode="phone"] .activity-btn[data-view="sessions"]` hides the rail
icon.

## 12. UI wiring (`sessions.js`)

The module owns no data. It owns one side-panel view, built once at load the
way `bookmarks.js` builds its list (`bookmarks.js:52-130`), and it is registered
in `activity.js`'s existing block — after Explorer, before Pinned folders — so
the rail reads Explorer, **Sessions**, Pinned, Bookmarks, Recent, Search, AI.
The registration carries no `mount`: the host is populated at load and
`activity.js` only toggles `[hidden]` (`activity.js:173-181`), the bookmarks
pattern. The id must be a literal `id: "sessions"` in `activity.js`:
`tests/test_app.py:318-339` parses that file and compares the ids with
`_ACTIVE_VIEWS` and the `data-view` hosts.

```js
NB.sessions = {
  openCreate(),                // header "+" and the row menu
  openRename(id),              // row menu
  create(name), rename(id, name), remove(id),   // dialog submits
  moveTo(path, id), newFromTab(path),           // tab context menu
  refresh(),                   // re-read NB.tabs.getSessionList()
};
```

- The view is `.panel-header` ("Sessions", `+`, `NB.activity.makeCollapseBtn()`)
  plus a `.session-list` of rows and a `.ws-foot` footnote. It is populated at
  load and survives view switches because `activity.js` only toggles `[hidden]`.
- Each row is a button carrying the session's id, name, unpinned count and dirty
  flag, plus a `⋯` actions button. Click switches (`NB.tabs.swapTo(id)`); the
  active row is `aria-current="true"`. Right-click and the `⋯` button open
  `NB.menu` with Rename… and Delete… (Delete `disabled` on the only session).
- It reads `NB.tabs.getSessionList()` → `[{id, name, count, dirty}]` and
  `NB.tabs.getActiveSessionId()`.
- It writes only through the `NB.tabs.*` operations in §7.
- `tabs.js` builds the `Move to session` submenu inside `tabMenuItems()` from
  `getSessionList()` (names, minus the active id) and calls
  `NB.sessions.moveTo(path, id)` / `NB.sessions.newFromTab(path)`; that keeps
  all context-menu construction in `tabs.js` and all naming UI in `sessions.js`.
  It appends the item only when `NB.sessions` exists, so an older cached shell
  simply has no session item and its tab menu still works.
- It listens for `tabs:changed` and `viewer:dirty-changed` and re-renders the
  rows, preserving focus by session id (the same rule the workspace picker uses,
  `workspaces.js:349-373`), so a tab change cannot yank the keyboard out of the
  list.
- It must null-guard its host and no-op when `#sessions-view` is absent (an old
  cached shell, the jsdom harness), the way `tabs.js:23-24` guards a stale
  `index.html`. On the phone the host exists but the rail icon is hidden and a
  saved `activeView` falls back to Explorer, so the view is unreachable.

Placement, row anatomy, keyboard, focus, copy and CSS are in
[`ui/sessions.md`](../ui/sessions.md) §2-§8 and Appendix A.

## 13. States

| State | Data condition | UI |
| --- | --- | --- |
| One session, tabs | `sessionOrder.length === 1` | View has one active row; Delete disabled |
| Several, active has tabs | normal | Rows with active marker/count/dot |
| Active empty, pins exist | active session `openFiles: []`, `pinned.size > 0` | Strip = pins only; content = the session's `activeFile` if pinned, else first pin |
| Active empty, no pins | both empty | Strip = outline toggle only; `viewer.showSessionEmpty()` |
| Stored empty | stored `{openFiles: [], activeFile: null}` | A row with count `0`; switching lands in one of the two states above |
| Dirty hidden | `viewer.isDirty` true for a stored path | Row dot; no modal; conflict badge on switch |
| Read-only role | `NB.pageRole() !== "admin"` | Switching works; `+`, Rename, Delete disabled; `Move to session` disabled |
| Phone | rail icon hidden | No Sessions view; no sessions restored or written |

## 14. Failure and race matrix

| Event | Result |
| --- | --- |
| Two session picks | Second bump wins; first aborts before install. |
| Pick while a tab fetch is in flight | Both tokens bumped; the fetch seeds the cache silently; the swap's render is last. |
| Hybrid save fails during a swap | `commitForTabSwitch()` returns false; the swap aborts; the user stays with the edits. |
| Switch to an empty session | `showSessionEmpty()` keeps every other session's cache and drafts. |
| Close the last tab of a session | Same path as today's confirm, then `showSessionEmpty()` (not `clear()`). |
| Delete while a swap is in flight | Both delete branches bump `sessionToken`, and `swapTo` re-checks that the target id is still in `sessionOrder` after the commit; the stale swap is a no-op. |
| Open a note another session holds | Added/activated in the active session; the other copy is untouched and no switch happens. |
| Close a tab another session also holds | Only this occurrence goes; the viewer cache, draft, conflict flag and watcher baseline stay with the other copy. |
| Same note in three sessions | One viewer cache entry; one `viewer.close` when the last occurrence closes. |
| File renamed while hidden | Re-keyed in every stored record, its `activeFile`, and the viewer cache. |
| File deleted while hidden | Removed from every session; the cache/draft/baseline close when the last occurrence goes. |
| External write to a hidden dirty file | Conflict flag, no dialog. |
| Old client posts workspace state | Server keeps `sessions`/`activeSessionId`; the rest of the entry updates. |
| Hand-edited `sessions` | Normalised per §4; never throws. |

## 15. Test seams

`tabs.js` exposes, for the DOM harness and the browser suite:

```js
getSessionList()        // [{id, name, count, dirty}]
getActiveSessionId()
snapshot()              // the persisted shape
swapTo(id)              // async
createSession(name)
createSessionFromTab(path, name)
renameSession(id, name)
deleteSession(id)
moveToSession(path, id)
```

Existing seams (`getOpen`, `isOpen`, `getActive`, `restore`, `togglePin`,
`isWidthFrozen`, `isGhosting`, …) keep their meaning for the active session.

Verification:

- **DOM (`npm test`, `tests/dom/test_dom.js`)**: add the `#sessions-view` host
  to the harness shell (around `tests/dom/test_dom.js:226-230`), eval
  `static/js/sessions.js` after `tabs.js` (around `:2335`), and update the source
  regex that asserts the old boot filter (`:21225-21227`). Cases: migration;
  pinned union on boot; per-session active tab; swap with a stashed draft; close
  last tab keeps another session's draft; empty session after reload; the view
  renders rows/counts/dots and marks the active row; the row menu renames and
  deletes an inactive session and closes its cached buffers; delete active with
  a hybrid buffer; move; cross-session open; `activate:false`; corrupt config and
  limits; focus after create/rename/delete; the same note open in two sessions
  (opening and closing one occurrence leaves the other's tab, draft and dot
  intact); moving into a session that already lists the note.
- **Browser (`npm run test:browser:core`)**: the rail icon, the view at 240 px
  and 360 px, switching, reload restore, pinned visible in both, the light
  theme, the `Move to session` submenu.
- **Server (`pytest tests/test_app.py`)**: workspace-state round-trip with the
  session shape; preserve-if-absent; the fold tuple; `_ACTIVE_VIEWS` includes
  `sessions`.
- **Service worker**: bump `CACHE` and include `sessions.js` in `PRECACHE`
  (`static/sw.js:38, 45-90`); check an offline reload.

## 16. Accepted limits

- Back/forward opens a note in the active session; it no longer switches
  sessions, and the hop is not a history entry of its own.
- The same note open in several sessions shares one viewer buffer: an unsaved
  edit or stashed draft is shared, not per-session.
- The first boot after the upgrade keeps today's `lastFile` fallback; afterwards
  an empty session stays empty.
- Drafts are in memory only and do not survive a reload (`requirements` §9).
- The active session is named only in the Sessions view; with the panel on
  Explorer, Search, or collapsed, there is no session indicator.
- No drag-reorder of sessions in v1; the list order is the creation order.
- Deleting a session is per-row; its buffers close only for paths no other
  session or pin still holds.
