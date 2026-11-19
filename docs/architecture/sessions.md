# Sessions — architecture and implementation contract

Status: §§1-17 are implemented; the verification record is in the commits that
landed them. The phone shell restores the shared sessions and writes its own
changes, but does not poll (§17.4). The product definition is
[`requirements/features/sessions.md`](../requirements/features/sessions.md);
the visual handoff, copy and CSS are [`ui/sessions.md`](../archive/ui/sessions.md).
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
| Server routes | None in the original feature; §17 adds `GET /api/workspace-state` and gives the POST a `base`. |

Not touched: the HTTP API surface, the workspace registry, the file tree,
search, the AI assistant, export, and **the tab bar**. The phone shell keeps no
tab strip, but it restores the same sessions and writes its changes; it never
polls (§17.4).

## 2. Ownership

The single rule that keeps the model honest:

> **The active session is the live tab view. Inactive sessions are stored.**

`tabs.js` already holds the live view — `ordered`, `openSet`, `pinned`,
`activePath` (`tabs.js`). Those keep their meaning exactly. A new,
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
| `openFiles` | **Mirror**: the live `ordered` including pins — exactly what `emitChanged()` sends today (`tabs.js`). Preserves `app.js`, the browser test, and any older client. |
| `activeFile` | **Mirror**: the live `activePath`. Keeps `_acp_context_preamble` (`app.py`) naming the open note. |

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
(`app.py`). A hand-edited blob over the cap is refused by the route and
only `console.warn`ed (`app.js`) — unchanged behaviour.

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
(`tests/dom/test_dom.js:24554`, `:25481`, `:25490`, `:25502`):

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

`app.js` boot replaces the hand-rolled filter (`app.js`) with:

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

The phone passes the same `sessionState`. It has no tab strip and restores only
the active session's active tab, but its session list and its writes are the
workspace's shared ones. A phone whose device-local resume note is not yet in
that session opens the note into the active session after restore. If the shared
active tab is a desktop-only special view (`§sessions`, `§graph`), the phone
activates another tab or Home; the tab stays in the model.

## 6. The swap

`NB.tabs.swapTo(id)` is the only way the live view becomes another session.
It is async and guarded by its own token, for the same reason `activate` has one
(`tabs.js`).

```js
let sessionToken = 0;

async function swapTo(id) {
  if (id === activeSessionId) return true;
  if (sessionOrder.indexOf(id) < 0) return false;
  const token = ++sessionToken;
  const stale = () => token !== sessionToken;

  // Stop the in-flight activation and its recovery path (tabs.js),
  // and the viewer's own UI write (viewer.js).
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
  hybrid save fails (`hybrid.js`) and leaves hybrid active. Switching
  anyway would let the next keystroke serialize to the old path.
- **Bump both tokens first.** `activateToken` stops `tabs.activate` from taking
  its `!openSet.has(path)` recovery (`tabs.js`); `cancelActivation()`
  stops `viewer.activate` from writing `active`, rendering, and emitting
  `file:open` for a file that no longer belongs to the strip.
- **Mutate before emitting.** `activeSessionId` and the live sets change together
  before `emitChanged()`, so the snapshot `app.js` takes in its listener is
  consistent (`app.js`).
- Two rapid picks: the second bumps `sessionToken`; the first aborts at its next
  check and never installs.
- Ghosts and the width freeze belong to the old strip. A ghost is data
  (`tabs.js`) and would otherwise materialize in the new strip for 280 ms.
- `activate(activePath)` is a second commit, which is a no-op after the first
  (the buffer is already stashed, `viewer.js`).

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
| `reorderSession(id, targetId, before)` | Move `id` before or after `targetId`; `targetId === null` appends. The destination index is computed after removing `id`, so both directions are correct. The active session, its tab and every stored record are untouched; only `sessionOrder` changes. `render()` + `emitChanged()`, so the order persists and syncs like any other shared change. Returns `false` when nothing moved. |
| `moveToSession(path, id)` | `path` must be unpinned and live; `id` must be another session. **Do not call `viewer.close`** — the cache entry and any draft travel with the file. Remove from `ordered`/`openSet`; append to the target record **unless it already lists the path** (then the source copy is simply removed); fix the source's `activePath` (activate the neighbour, or show the empty state if the strip empties); render, emit. |
| `moveSessionTabs(targetId, items)` | **New.** The one move that works from any session into any other, for the `§sessions` page (`ui/sessions-page.md` §8). `items` = `[{ sourceId, path }]`, the selection or one row. Validate before mutating: `targetId` exists, every source exists, every `path` is unpinned and listed in its source. **Collapse the batch by `path`**, because a session's list is unique and the same note may be carried from two cards; items whose source is already the target drop out, and what remains is one entry per path with every other occurrence marked for removal from its source. An empty batch returns `false`. Capacity: the target must have room for every new path it does not already list, else the shipped `SESSION_FULL_MESSAGE` and `false`, with **nothing** moved. **Only when the live session's `activePath` is among the carried paths** — the same gate `moveToSession` uses (`tabs.js:1280`) — bump `activateToken`, `cancelActivation()`, `await commitForTabSwitch()` (abort on `false`) and re-validate; a background tab leaving the live session commits nothing. Then remove each item from its source — live: `ordered`/`openSet`/`frozenWidths`; stored: `openFiles` with `activeFile` repaired to its first remaining file else `null` — and append each new path to the target: stored gets `openFiles`/`activeFile` (set when the record was empty); live gets `ordered` after the pins and `openSet`. When the live source's active tab moved, choose its successor **before** any splice from the pre-mutation `ordered`: the first path at or after the active path's old index that survives the batch, else the last survivor, else `null` — a captured index would skip a survivor once two earlier tabs leave. **Never calls `viewer.close`.** One `render()` + one `emitChanged()` for the moves, then `activate(next)` or `showSessionEmpty()` for the live source, which emits its own ordinary change. Returns `Promise<boolean>`. |
| `moveSessionTab(sourceId, path, targetId)` | Thin wrapper: `moveSessionTabs(targetId, [{ sourceId, path }])`. Kept so a one-tab mover need not build a list. |
| `hasStoredPath(path, exceptId)` | Internal: does an inactive session still list the path? Used by `dropTab`, `closeStoredPath` and `deleteSession` to keep a shared buffer alive. |

`moveSessionTabs` adds no state of its own: it changes only `sessionOrder`-indexed records and the
live sets, so `snapshot()`, the config shape and the live-view invariant are untouched. It is
deliberately not a loop over `moveToSession`: a loop would render and emit once per tab, let a cap
refusal land after half the batch had moved, and append the same path twice when two cards carried
it. One validate, one collapse by path, one mutate, one emit is the contract. `moveToSession` keeps
its signature and its single-path behaviour for the tab menu; both obey the same dedupe and cap
rules.

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
(`activity.js`): it adds the tab to the active session without
activating it. `openSpecial` follows the same rule.

If the active session already holds `SESSION_FILES_MAX` unpinned tabs, `open`
adds nothing and reports it through `NB.app.notify` ("This session is full —
close a tab or open a new session."). `restore` and `normaliseSessions`
truncate instead of refusing, because no user action is being rejected at load
time. A deep link is the one caller that makes room instead of failing: when
the active tab has no unsaved edits, `openDeepLink` closes it and retries
(`app.js`).

Back/forward keeps calling `open` when a history entry is not open
(`viewer.js`); it now opens the note in the active session. There is
no session switch on the nav path.

## 9. Pinning and file operations

**Pin** (`tabs.js`): remove the path from the live `ordered` (existing)
**and from every stored session**; if a stored session's `activeFile` was that
path, fall back to its first remaining file or `null`. Pinning is what makes a
tab shared.

**Unpin**: existing behaviour inserts the path into the active session's strip
(`tabs.js`). It is now visible only in the active session — the Firefox
rule.

**Close** (`dropTab`): remove this occurrence from the active strip. The viewer
cache, any stashed draft and the watcher baseline are deleted **only when no
pinned tab or stored session still holds the path** (`hasStoredPath`); otherwise
the other occurrence keeps them. `conflictSet` is cleared only on the last
close. A special tab's `onClose` runs only on the last close too, so a `§graph`
open in another session keeps its module alive.

**`rename(from, to)`** (`tabs.js`): apply `remap` to `ordered`,
`openSet`, `pinned`, `conflictSet`, `frozenWidths` (existing) **and every
stored session's `openFiles`/`activeFile`**, including every duplicate
occurrence. Remove the
`if (!pairs.length) return` early-out (`tabs.js`) or move it after the stored
pass: a file that exists only in an inactive session must still be re-keyed.
Call `NB.viewer.rename` for every pair; it is a safe no-op for an uncached path
(`viewer.js`).

**`file:deleted`** (`tabs.js`): drop the path from the live strip and
from every stored session; `closeStoredPath` closes the viewer cache and calls
the special tab's `onClose` once, when the last occurrence is gone. A deleted
file's draft goes with it, as today.

**`auth:locked`** (`tabs.js`): `sessionToken++`, clear every stored
session's `openFiles` first, stop the special tabs those lists held, then
`clearAll()` the live strip (so its `dropTab` paths no longer look "elsewhere")
and `viewer.clear()`. Keep names, ids, order and `activeSessionId`, so
re-entering the workspace shows the same named places, empty. The lock
invalidates every buffer.

**`dropTab(path)`** also clears the path's conflict flag, but only on the last
close. The dead `_dropTab` hook (`tabs.js`) can go.

## 10. viewer.js

Three changes.

**10.1 Abandon an activation.** Export `cancelActivation()` which bumps the
module-private `activateToken` (`viewer.js`). It writes nothing else; a
pending fetch then seeds the cache and returns without touching `active`, the
DOM, or `file:open` (`viewer.js`).

**10.2 An empty state that keeps the cache.** `showWelcome()`
(`viewer.js`) starts with `cache.clear()`, which would destroy every
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
  the welcome page" — `tabs.js` and `tabs.js` — with
  `showSessionEmpty()`. Both sit after `dropTab` has already closed the files
  they name, so their cache entries are gone; only the other sessions' entries
  were at risk.
- The special-tab container is hidden here because no `activate()` follows a
  target with pinned-only tabs; without it a `§graph` container can stay on top
  of the welcome page.

**10.3 External changes in a hidden session.** In the
`file:external-change` handler (`viewer.js`), compute
`const live = !NB.tabs || !NB.tabs.isOpen || NB.tabs.isOpen(path);` before the
dirty check (the handler runs after `tabs.js` is defined; guard for the harness).

| Path state | Behaviour |
| --- | --- |
| clean, live or hidden | Refresh the cache silently (today's `else` branch at `viewer.js`). |
| dirty, live | Today's confirm; Cancel marks the conflict. |
| dirty, hidden | **No modal.** Emit `viewer:conflict {path, conflict:true}`, keep the buffer, return. The badge appears when the user switches to that session. |

This keeps a burst of external writes from raising dialogs about notes the user
cannot see. `isOpen` is active-session-only, which is exactly the test.

## 11. Persistence and the server

> Superseded in part by §17: the write path, the `/api/config` interaction and
> the read side change. This section stays as the record of what shipped before
> the cross-device extension.

**Client.** `app.js`:

- `WORKSPACE_STATE_KEYS` (`app.js`) gains `"sessions"` and
  `"activeSessionId"`. `workspaceStateSnapshot()` then carries them, and
  `flushWorkspaceState` posts them to `/api/workspace-state` on its existing
  250 ms debounce.
- `tabs:changed` (`app.js`) copies `sessions` and `activeSessionId` from
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

1. `_WORKSPACE_SCOPED_CONFIG_KEYS` (`app.py`) gains `"sessions"` and
   `"activeSessionId"`, so a whole-blob `POST /api/config` from a page without a
   workspace folds stray top-level copies under `workspaceState.default`
   (`_fold_legacy_workspace_state`, `app.py`).
2. `set_workspace_state()` (`app.py`) replaces the whole entry
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
3. `_ACTIVE_VIEWS` (`app.py`) gains `"sessions"`, so a saved
   `activeView: "sessions"` is accepted by `boot_state()` and the server renders
   `#sessions-view` visible on the first frame. The test that keeps
   `_ACTIVE_VIEWS` in step with the registered views and the `data-view` hosts
   (`tests/test_app.py`) gains the new id too.

There is no first-paint session *name*: the view is rendered by `sessions.js`
from the restored model, exactly like the Bookmarks list.

The phone writes the same state through `/api/workspace-state`; it runs no poll
(§17.4), only a conditional read when the page comes back or the drawer opens.
Its session changes and tab opens are shared, so the desktop sees them within one
sync interval, and a resumed phone picks up the desktop's within one read.

## 12. UI wiring (`sessions.js`)

The module owns no data. It owns one side-panel view, built once at load the
way `bookmarks.js` builds its list (`bookmarks.js`), and it is registered
in `activity.js`'s existing block — after Explorer, before Pinned folders — so
the rail reads Explorer, **Sessions**, Pinned, Bookmarks, Recent, Search, AI.
The registration carries no `mount`: the host is populated at load and
`activity.js` only toggles `[hidden]` (`activity.js`), the bookmarks
pattern. The id must be a literal `id: "sessions"` in `activity.js`:
`tests/test_app.py` parses that file and compares the ids with
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
  `workspaces.js`), so a tab change cannot yank the keyboard out of the
  list.
- It must null-guard its host and no-op when `#sessions-view` is absent (an old
  cached shell, the jsdom harness), the way `tabs.js` guards a stale
  `index.html`. On the phone the view is a rail slot and opens in the drawer
  (`mobile.md` §14.3).

Placement, row anatomy, keyboard, focus, copy and CSS are in
[`ui/sessions.md`](../archive/ui/sessions.md) §2-§8 and Appendix A.

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
reorderSession(id, targetId, before)
```

Existing seams (`getOpen`, `isOpen`, `getActive`, `restore`, `togglePin`,
`isWidthFrozen`, `isGhosting`, …) keep their meaning for the active session.

Verification:

- **DOM (`npm test`, `tests/dom/test_dom.js`)**: the `#sessions-view` host
  (`:237`) and the `sessions.js` eval after `tabs.js` (`:2433`) are in place; the
  old boot-filter source assertion has been replaced by the table-select tests.
  Drag coverage: a row dragged above another lands before it in the model, the
  DOM and `snapshot()`; a drop on the empty area appends; a viewer cannot drag;
  a drag that starts on the `⋯` does nothing; every mark is cleared after
  `dragend`; the new order reaches the state write. Cases: migration;
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
  (`static/sw.js, 45-90`); check an offline reload.

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
- The list order is the creation order until someone reorders it; a drag or the
  row menu changes it, and two clients that reorder at the same time settle on
  one order (the writer's), like any other same-session change.
- Deleting a session is per-row; its buffers close only for paths no other
  session or pin still holds.

---


## 17. Cross-device sync (implemented 2026-11-15)

Product rules: [`requirements/features/sessions.md`](../requirements/features/sessions.md)
§10. This section owns the mechanism, the call order, and the failure matrix, and
it **supersedes §11's write path**. §11 stays as the record of what shipped
before this extension; where the two disagree, this section wins.

> **Status.** Implemented: the versioned read, the rev map, the server-side
> merge, and the client loop. The phone shell restores the same sessions and
> writes its changes, but does not poll (§17.4).

The shared set is held on the server. Three rules make it converge:

1. one writer — `/api/workspace-state` and nothing else;
2. a server-side three-way merge, so two clients that changed different sessions
   both keep their change;
3. a 3 s conditional poll per open page, so every client converges.

A client never merges. It sends what it has plus the state it started from; the
server merges and returns the result. That keeps the hard logic in one tested
Python function instead of in a browser that cannot be exercised in CI.

### 17.1 What syncs

| Key (`WORKSPACE_STATE_KEYS`) | Shared | Device-local |
| --- | --- | --- |
| `sessions` | ids, names, order, `openFiles`, per-session `activeFile` | the active session's own live view |
| `pinnedFiles` | yes | — |
| `bookmarks`, `recentFiles`, `pinnedFolders` | yes | — |
| `openFiles`, `activeFile` | written as hints, never applied | the active tab |
| `lastFile` | written as a hint, never applied | — |
| `activeSessionId` | written as a fallback, never applied | the active session |

`activeFile` stays a write-only hint so `_acp_context_preamble`
(`app.py:2870-2906`) still names the note the owner was last reading. It is
never applied from a poll, so a peer's tab click cannot move this reader.

### 17.2 Server contract

Five changes in `app.py`. All writes stay under `_CONFIG_LOCK`.

**`workspaceStateRev`** — a new top-level map in `config.json`, sibling to
`workspaceState`:

```json
{ "workspaceState": { "default": { "...": "..." } },
  "workspaceStateRev": { "default": 7 } }
```

| Rule | Detail |
| --- | --- |
| Type | one non-negative `int` per workspace id; missing, non-int, or negative reads as `0` |
| Owner | the server only. A client-supplied `workspaceStateRev` is discarded on every route |
| Bump | `+1` on every accepted `POST /api/workspace-state`, in the same lock and the same `atomic_write` as the state |
| Delete | `remove_workspace()` drops the entry and its rev in the same lock, so a removed workspace leaves nothing behind |
| Lifetime | otherwise permanent for the life of the entry |

`_workspace_state_rev(cfg, wid) -> int` is the one reader; it never raises.

**`GET /api/workspace-state`** — new, `@read_login_required`:

```
GET /api/workspace-state?id=<wid>[&rev=<int>]
```

| Case | Response |
| --- | --- |
| `id` missing or not a string | 400 `{error, code: "bad_body"}` |
| unknown workspace id | 404 `{error, code: "unknown_workspace"}` |
| `rev` present and equal to the stored rev | **304**, empty body |
| otherwise | 200 `{ok: true, id, rev, state}`; `state` is `{}` for an entry that was never written |

The route is already in `_GATED_READ_PATHS` (`app.py:173-176`), so it answers
`Cache-Control: no-store, private`. No `ETag`: the conditional is the `rev`
query parameter, matching the existing `ifModifiedSince` style
(`api.js:102-105`). A 304 must not carry a body.

**`POST /api/workspace-state`** — the body changes shape:

```
POST /api/workspace-state
{"id": "<wid>", "state": {...}, "base": {...}}
```

`base` is the exact state this client started from: the boot `/api/config`
entry, or the `state` returned by the previous GET or POST. It is required.

| Case | Response |
| --- | --- |
| `id`, `state`, or `base` missing or not an object | 400 `{error, code: "bad_body"}` |
| `state` over `WORKSPACE_STATE_MAX_BYTES` | 400 `{error, code: "state_too_large"}` |
| `base` over `WORKSPACE_STATE_MAX_BYTES` | 400 `{error, code: "base_too_large"}` — a base that large can never equal a stored entry, and parsing it costs memory for nothing |
| unknown workspace | 404 `unknown_workspace` |
| the workspace is removed between the id check and the write | 404 `unknown_workspace`, re-checked under the lock, so a removed workspace is never re-created |
| `config.json` unreadable, or its `workspaceState`/`workspaceStateRev` not objects | 500 `write_failed`; nothing is written, so a corrupt file cannot be replaced with one workspace's state |
| `base` equals the stored entry | store `state` unchanged |
| `base` differs from the stored entry | store `_merge_workspace_state(stored, base, state)` |
| success | 200 `{ok: true, id, rev, state}` with the **new** rev and the **stored** state after the write |

There is no 409 and no client-side retry: a stale write is merged, and the
response tells the client what the server now holds. A client that sends no
`base` is refused, which is what stops a page loaded before this change from
posting a stale session list over newer data.

**`_merge_workspace_state(current, base, incoming) -> dict`** — a pure function,
no I/O, unit-tested on its own:

```python
def usable(s):
    return isinstance(s, dict) and isinstance(s.get("id"), str) and s["id"]

def session_key(s):                          # what counts as "changed"
    return (s.get("name"), tuple(s.get("openFiles") or []))

def merge_state(current, base, incoming):
    out = dict(current)
    out.update(incoming)                     # hints and scalars: last writer wins
    out["sessions"] = merge_sessions(current, base, incoming)
    for key in ("pinnedFiles", "bookmarks", "recentFiles", "pinnedFolders"):
        # a list the client did not touch takes the server's copy
        out[key] = current.get(key) if incoming.get(key) == base.get(key) \
                   else incoming.get(key)
    return out


def merge_sessions(current, base, incoming):
    cur = {s["id"]: s for s in current.get("sessions") or [] if usable(s)}
    bas = {s["id"]: s for s in base.get("sessions") or [] if usable(s)}
    inc = {s["id"]: s for s in incoming.get("sessions") or [] if usable(s)}
    out = []
    for sid in [s["id"] for s in incoming.get("sessions") or [] if usable(s)]:
        if sid not in cur:                   # the server has no such session
            if sid in bas and session_key(inc[sid]) == session_key(bas[sid]):
                continue                     # server deleted it, client did not touch it
            out.append(inc[sid])             # client added it, or edited a deleted one
        elif session_key(inc[sid]) == session_key(bas.get(sid, {})):
            out.append(cur[sid])             # client did not touch it: server wins
        else:
            out.append(inc[sid])             # client edited it: client wins
    for sid, record in bas.items():           # client deletions
        if sid in inc:
            continue
        if sid in cur and session_key(cur[sid]) != session_key(record):
            out.append(cur[sid])             # server changed it: resurrect the server copy
    for sid, record in cur.items():           # sessions the client never saw
        if sid not in inc and sid not in bas:
            out.append(record)
    return out
```

| Rule | Meaning |
| --- | --- |
| Session granularity | Two clients that changed different sessions both keep their change. Two that changed the same session settle on one (requirements A8). |
| Add | A session in `incoming` that `base` did not have is kept. |
| Delete | A session in `base`, absent from `incoming`, and untouched on the server is dropped. If the server changed it in between, the server's copy is kept. |
| Edit | A session the client changed wins over the server's copy; a session the client did not change takes the server's copy. |
| What counts as changed | The name or the unpinned `openFiles` list. A per-session `activeFile` difference alone is **not** a change, so a peer clicking a tab can never discard a tab another peer added to that session. |
| Peer-only | A session the server has that the client never saw (added by a peer after its `base`) is kept. |
| Order | `incoming` order first, then resurrected and peer-only entries in their existing order. Deterministic. |
| Non-session keys | List fields: the client's copy if it differs from `base`, else the server's. Scalars: `incoming`. |
| Idempotence | `merge_state(s, s, s) == s`. A replayed write changes nothing but the rev. |

**`POST /api/config`** — stops being a state writer:

1. Inside `_CONFIG_LOCK`, read the stored file. If the read fails or the result
   is not a dict, refuse the whole POST with 500 `write_failed` — never replace
   a file whose state cannot be re-attached.
2. Delete from the incoming body: `workspaceState`, `workspaceStateRev`, and
   every key in `_WORKSPACE_SCOPED_CONFIG_KEYS`.
3. Re-attach the stored `workspaceState` and `workspaceStateRev`.
4. `atomic_write` the result.

Consequences, all deliberate:

- `_fold_legacy_workspace_state(data)` is **removed from this route**. The
  startup migration (`_migrate_config_at_startup`, `app.py:1573`) still folds a
  legacy file once at boot; a POST no longer folds or clobbers.
- The whole-blob route can no longer create, delete or reorder a session, a
  bookmark, or a pin. That is the transition cost for a page loaded before this
  change; its state writes are refused by the missing `base` and its config
  writes lose the state keys. The shell replaces itself on the next load.
- A page with no workspace id never persists scoped state. It could not reach
  `/api/workspace-state` before either (see §17.11).

Single-writer invariant: **only `set_workspace_state()` writes `workspaceState`
or `workspaceStateRev`; `remove_workspace()` deletes one entry of each under the
same lock.** Any other write path is a defect.

### 17.3 Client transport (`static/js/api.js`)

| Change | Contract |
| --- | --- |
| `request()` error shape | before throwing, attach the parsed body: `error.body = data`. Additive; every existing caller keeps `code` and `status` (`api.js:84-91`). |
| `getWorkspaceState(id, rev)` | `GET /api/workspace-state?id=…&rev=…` with `{notModified: {notModified: true}}`. Resolves to `{notModified:true}` on 304, else `{ok, id, rev, state}`. `rev` is omitted when it is not a finite integer. |
| `saveWorkspaceState(id, state, base)` | `POST` with the same body shape as §17.2. Resolves to `{ok, id, rev, state}`. A 400 is a programming error and surfaces through `error.code`. |

### 17.4 The sync loop (`static/js/app.js`, `NB.sync`)

A new labelled section beside `flushWorkspaceState`. No new file: every input
(`cfg`, `workspaceStateSnapshot`, `workspaceId`) is module-private to `app.js`.

| Constant | Value | Meaning |
| --- | --- | --- |
| `WORKSPACE_SYNC_MS` | `3000` | Poll interval while visible; also the initial `wsSyncDelay` |
| `WORKSPACE_SYNC_MAX_MS` | `30000` | Backoff ceiling after repeated failures |

Module state, with its initial value:

| Name | Initial | Meaning |
| --- | --- | --- |
| `wsRev` | `0` | Last rev the server reported |
| `wsRevKnown` | `false` | Whether `wsRev` came from the server for this workspace |
| `wsBootLoaded` | `false` | Whether the boot `/api/config` fetch succeeded; no write or poll before it does |
| `lastAckKey` | `""` | `stateKey()` of the last state the **server** acknowledged |
| `lastServerState` | `null` | The state object that `lastAckKey` was computed from; becomes the next `base` |
| `wsSyncDelay` | `WORKSPACE_SYNC_MS` | Current delay; doubles on failure |
| `wsSyncTimer`, `wsSyncPaused`, `wsSyncing` | `null`, `false`, `false` | Timer handle, hidden-tab gate, in-flight gate |

Two helpers, different jobs:

```js
// The dirty check: the whole state, in a fixed key order.
function stateKey(s) {
  const out = {};
  for (const k of WORKSPACE_STATE_KEYS) out[k] = (s || {})[k];
  return JSON.stringify(out);
}
```

`stateKey` replaces the raw `JSON.stringify(workspaceStateSnapshot())`
comparisons (`app.js:534-535`), so key order and absent keys cannot produce a
false diff. `syncProjection` (§17.5) is the narrower one: it drops the
device-local hints and the per-session `activeFile`, and decides whether a remote
state changes anything on screen.

| Function | Contract |
| --- | --- |
| `start()` | Async, idempotent, resolves `true` when the chain is armed and `false` when it is not. Not armed when `isPhoneMode()`, `workspaceId()` is empty, or `wsBootLoaded` is false. Otherwise it runs one `syncOnce()` first and arms only when that returns `ok` without `unsupported` — a server without the endpoint is probed once and then left alone. |
| `stop()` | Clears the timer; a later `start()` may follow. |
| `pause()` / `resume()` | Set/clear `wsSyncPaused`. `resume()` ticks immediately, and does nothing while `document.hidden`. Used by the visibility, `online` and `pageshow` handlers. |
| `tick()` | One pass now, without `force`: a no-op on a phone. Resolves `{ok, rev}`; `{ok:false, unsupported:true}` when the server has no such endpoint. |
| `status()` | `{running, paused, pending, rev, delayMs, lastAt, lastError}` — diagnostics and tests. `pending` is true while a write is queued or in flight. |

One pass:

```js
async function syncOnce(force) {
  if (!workspaceId() || !wsBootLoaded || wsSyncPaused || wsSyncing)
    return {ok: true, rev: wsRev};
  // The phone arms no timer; only its explicit catch-up read passes `force`.
  if (isPhoneMode() && !force) return {ok: true, rev: wsRev};
  // A queued or in-flight write answers with the merged state; do not race it.
  if (wsSaveTimer !== null || wsWritesOutstanding > 0) return {ok: true, rev: wsRev};
  wsSyncing = true;
  const localKey = stateKey(workspaceStateSnapshot());
  try {
    const res = await NB.api.getWorkspaceState(workspaceId(), wsRevKnown ? wsRev : undefined);
    if (res && res.notModified) return {ok: true, rev: wsRev};
    if (!res || typeof res.rev !== "number") return {ok: false, rev: wsRev, unsupported: true};
    if (wsRevKnown && res.rev < wsRev) return {ok: true, rev: wsRev};
    if (stateKey(workspaceStateSnapshot()) !== localKey) {
      // A local change outpaced this poll; keep it and update the base.
      lastServerState = res.state || {};
      lastAckKey = stateKey(lastServerState);
      wsRev = res.rev; wsRevKnown = true;
      return {ok: true, rev: wsRev};
    }
    await applyRemoteWorkspaceState(res.state || {});
    wsRev = res.rev;
    wsRevKnown = true;
    wsSyncDelay = WORKSPACE_SYNC_MS;
    return {ok: true, rev: wsRev};
  } catch (e) {
    wsLastError = e;
    wsSyncDelay = Math.min(wsSyncDelay * 2, WORKSPACE_SYNC_MAX_MS);
    return {ok: false, rev: wsRev};
  } finally {
    wsSyncing = false;
  }
}
```

Scheduling is a `setTimeout` chain, not `setInterval`, so a slow response never
stacks requests. Three rules around it:

- **A response older than `wsRev` is ignored.** The poll and the write use
  different queues, so their responses can land out of order; adopting the older
  one would regress the revision and drop tabs. `syncOnce` and
  `flushWorkspaceState` both drop a response whose `rev` is below the current
  one.
- **A response older than the local state is ignored too.** Both paths capture
  `stateKey()` before the request. If the page changed while the request was in
  flight — a rename, a tab added — the response carries a state that predates
  that change, and applying it would silently erase the edit. The client keeps
  the local model, adopts the response only as the next `base`, and the debounce
  the local change already armed publishes it. A revision alone cannot catch
  this: the response can be the newest the server has and still be older than
  the unsent change.
- **A transport failure still arms the chain.** `start()` returns `false` only
  for a gate or a server without the endpoint; a failed first probe arms the
  backoff, so a page that booted before the network came up recovers on its own.
  `resume()` starts the chain if it never armed.
- **A page that starts hidden does not poll.** The initial pause is
  `document.visibilityState === "hidden"`, so a page restored into a background
  tab waits for its first `visibilitychange`.
- **A queued or in-flight write pauses the poll.** The write's response is the
  merged state, so a poll during that window would adopt the server's copy over
  a change that has not been sent yet.
- **Adoptions are serialised.** One promise chain runs every apply, so a poll
  response and a write response that arrive together cannot rebuild the tab
  model twice from each other's intermediate state.
- **A 404 or 405 from the probe is `unsupported`.** A server without the route
  answers one way or the other; a dropped connection is a transport failure and
  uses the backoff.

Wiring:

- `applyConfig()` seeds the sync from the boot payload, before any write:
  `wsRev = cfg.workspaceStateRev?.[wid] ?? 0`, `wsRevKnown = !!cfg.workspaceStateRev`,
  `lastServerState = cfg.workspaceState?.[wid] ?? {}`,
  `lastAckKey = stateKey(lastServerState)`, `wsBootLoaded = true` — on every call
  that received a server object, including the empty one after a failed fetch,
  where `wsBootLoaded` stays `false`.
- `boot()` calls `await NB.sync.start()` **after** `NB.tabs.restore()` and after
  the deep-link block (`app.js:1113-1138`). Because the boot seeding happened in
  `applyConfig`, the restore's own `tabs:changed` write already carries the right
  `base`; nothing is unconditional.
- `visibilitychange`: hidden → `pause()`; visible → `resume()`.
- `window` `online` → `resume()`, but `resume()` is a no-op while hidden, so a
  network flap in the background sends nothing (AC71).
- `window` `pageshow` with `persisted` → `resume()` (a page restored from the
  back/forward cache gets no `visibilitychange`).
- The phone never polls (`start()` returns false) but still writes; its `base` is
  the boot state, so the merge protects the other devices from it. `resume()`
  makes one conditional read on a phone — when the page becomes visible, comes
  back online, is restored from the back/forward cache, or opens the drawer — so
  a PWA that was left open catches up without a reload. There is no timer behind
  it, and `tick()` still no-ops on a phone.

### 17.5 Applying a remote state (`app.js`)

```js
async function applyRemoteWorkspaceState(state)   // resolves void
```

Used for both a poll response and the state a POST returns, so a merge result
takes exactly one path.

1. **Fingerprint gate.** Compare the synced projection of `state` with the same
   projection of `cfg`:

   ```js
   function syncProjection(s) {
     return JSON.stringify({
       pinnedFiles:   s.pinnedFiles   || [],
       bookmarks:     s.bookmarks     || [],
       recentFiles:   s.recentFiles   || [],
       pinnedFolders: s.pinnedFolders || [],
       sessions: (s.sessions || []).map(x => [x.id, x.name, x.openFiles || []]),
     });
   }
   ```

   `sessions[].activeFile`, `activeFile`, `openFiles`, `lastFile` and
   `activeSessionId` are excluded, so a peer's tab click does no work here. When
   the projections are equal:

   - `lastServerState = state` (the next `base` is current);
   - leave `lastAckKey` alone — nothing local changed, and recomputing it from
     the peer's `activeFile` would make the next save look dirty and echo it
     back;
   - return.

2. Copy the **shared** keys only — `sessions`, `pinnedFiles`, `bookmarks`,
   `recentFiles`, `pinnedFolders`. Do **not** copy `openFiles`, `activeFile`,
   `lastFile` or `activeSessionId`: they are this device's hints, and copying a
   peer's would publish them back on the next local event.

   The write path moves `lastAckKey` to the state it is about to send before
   the request, and restores it if the request fails. Without that, a later
   unrelated save (a theme, a pane width) would see the state as dirty and
   repost it, bumping the rev and waking every peer for nothing.

   The `known` predicate passed to the model must accept every path while the
   file tree has not loaded. An empty tree means "not loaded yet", not "every
   path is gone": filtering against it would drop a whole workspace from one
   failed `/api/tree` and then republish the erasure to every other device.
3. `lastServerState = state` (the next `base`), then
   `lastAckKey = stateKey(workspaceStateSnapshot())` — the key of the state as
   just adopted, **before** the model is rebuilt.
4. `applyingRemote = true`, then `await NB.tabs.applyRemoteState(...)` in a
   `try`, `finally { applyingRemote = false }`. The flag must span the `await`:
   the apply may call `activate()`, which is async and emits `tabs:changed` after
   its own `await` (`tabs.js:880-924`). The `tabs:changed` listener returns early
   while `applyingRemote` is true.
5. Rebuild `cfg.sessions = NB.tabs.snapshot()` and `cfg.pinnedFiles = <model
   pins>`, then call `scheduleWorkspaceState()`. It compares `stateKey(cfg)` with
   `lastAckKey` and writes only when they differ, so this one call covers every
   case where the model could not adopt the server's copy verbatim: a kept dirty
   tab, a kept session, a pin move the model refused, **and** a remote path the
   sanitiser dropped. The result is at most one republish, and the next poll is
   clean. `diverged` is what the tests assert; it does not gate the write.
6. Side effects — **do not call `applyConfig`** (it would re-run `applyTheme`,
   `applyFontSize` and `mermaid.reinit`, `app.js:431-438`):
   `NB.bookmarks.set(cfg.bookmarks)`, `NB.sidebar.setPinnedFolders(cfg.pinnedFolders)`,
   then `NB.evt.emit("config:changed", cfg, {remote: true})`.

### 17.6 Applying a remote state to the tab model (`tabs.js`)

```js
await NB.tabs.applyRemoteState({ sessions, pinnedFiles, known })
// -> { applied: boolean, kept: [path], diverged: boolean }
```

**This is not `installSessionState`.** That function is a boot path: it assumes an
empty viewer, replaces every set wholesale, bumps no token, and closes nothing
(`tabs.js:1598-1635`). Reusing it at runtime orphans dirty buffers and lets an
in-flight `activate()` overwrite `activePath` (`tabs.js:921`).

Steps, in order:

1. `!Array.isArray(sessions) || sessions.length === 0` →
   `{applied:false, kept:[], diverged:false}`. The runtime path never synthesises
   a session; an empty list is "no data", not the first boot.
2. **Sanitise, do not normalise.** A new function
   `sanitiseRemoteSessions(raw, known, activeId)`, separate from
   `normaliseSessions` (§4), because that one is a boot repair: a non-empty array
   of unusable entries makes it synthesise a `Main` session (`tabs.js:365-371`),
   it renames duplicate names (`tabs.js:373-386`), regenerates duplicate ids
   (`tabs.js:354-357`), and drops entries past the cap (`tabs.js:415-423`). At
   runtime those rules would rewrite a peer's data. The remote rules are:

   | Rule | Behaviour |
   | --- | --- |
   | Entry unusable (not a dict, no non-empty string `id`) | drop the entry |
   | Duplicate id | keep the first, drop the rest |
   | `openFiles` | strings that pass `known`, deduped, order kept, capped at 40 |
   | Pinned path in a session | drop it (§9: pinned wins) |
   | Name | trimmed and capped at `SESSION_NAME_MAX`; empty or non-string → `Session N`. Duplicates are never renamed: that would rewrite a peer's data. |
   | Unregistered `§` id | dropped, like the boot path: a `§` id with no registered view would open a blank pane |
   | Order | as received |
   | Cap | 20 entries, keeping the active session |
   | Result empty after sanitising | `{applied:false}` — never a synthesised session |

   `known` comes from the caller, so a peer's path that no longer exists is
   dropped exactly as at boot (`app.js:1074`).
3. No-op gate: compare the sanitised projection with the current `snapshot()`
   projection (same shape as §17.5). Equal →
   `{applied:false, kept:[], diverged:false}`.
4. **Pins.** Replace the `pinned` Set with the sanitised set. A path that becomes
   unpinned is inserted into the active session's unpinned section; a path that
   becomes pinned is removed from every stored record (§9). A dirty path is never
   dropped by a pin move.
5. **The active session's tab list.** `serverList` = the sanitised record for
   `activeSessionId`, or `[]` when absent. For each live unpinned path not in
   `serverList`:

   | Condition | Action |
   | --- | --- |
   | `NB.viewer.isDirty(path)` | keep; add to `kept`; `diverged = true` |
   | `NB.hybrid.isActive()` and `path === activePath` | keep; `diverged = true` |
   | an `activate()` is in flight for `path` | keep; `diverged = true` |
   | otherwise | `dropTab(path)` — the tested primitive, so cache, draft, conflict flag, watcher baseline, frozen width and special-tab `onClose` follow the existing last-close rules (`tabs.js:813-827`) |

   For each path in `serverList` not live and not pinned: append to `ordered`,
   `openSet.add(path)`, capped at `SESSION_FILES_MAX`. **Never** `activate()` it
   and never fetch it; the viewer loads it when the user clicks the tab.

   The local active tab does not change, with one exception: if it was dropped
   (clean, not hybrid, no activation in flight), pick the neighbour with
   `pickNeighbor` and `activate` it. That is a local consequence of a removal,
   not a remote activation, and it is the only activation an apply performs.
6. **The active session was deleted remotely.** Keep it, its name, its order
   position and its live strip, and set `diverged = true` so step 5 of §17.5
   republishes it. There is no "local-only" session: the republish makes it a
   normal session again, and a peer that still holds an unsaved buffer from it
   keeps it on both sides until that buffer is saved or closed.
7. **Inactive sessions.** Replace `storedSessions`, `sessionNames` and
   `sessionOrder` from the sanitised list, with three exceptions:
   - the active session is kept at its position (step 6), because it is the live
     view and `sessionOrder` must still name `activeSessionId`;
   - a session the server deleted that still holds a dirty hidden path is kept,
     and `diverged = true`;
   - `activeSessionId` is never added to `storedSessions` (§2).
8. `render()`, then `emitChanged(true)`. `emitChanged(remote)` adds
   `remote: !!remote` to the payload; the 23 existing call sites are unchanged.
9. If the strip is now empty, `NB.viewer.showSessionEmpty()` (not `clear()`).

Invariants after any call: `openSet` equals `new Set(ordered)`; `activeSessionId`
is in `sessionOrder`; `storedSessions` has no `activeSessionId` key; every live
unpinned path is either in the active session's list or in `kept`.

`applyRemoteState` never calls `swapTo`, never calls `open`, and never prompts.
`confirm()` from a background poll is a defect. The only `activate()` it may
perform is the neighbour of a removed clean active tab (§17.6 step 5).

### 17.7 Write path (`app.js`)

`flushWorkspaceState` changes in four ways:

1. **No captured snapshot.** `wsPendingState` is deleted (`app.js:171, 544`).
   The body is serialized at send time from `cfg`, and `base` is
   `lastServerState || {}`.
2. **Adopt the response.** On success: `wsRev = res.rev; wsRevKnown = true;`
   then `await applyRemoteWorkspaceState(res.state)`.
3. **No retry loop and no blind re-post.** If the merge changed a session this
   client did not touch, the apply converges the model; if the model diverged,
   §17.5 step 5 schedules exactly one republish. There is no 409 to handle.
4. **No write before boot.** `scheduleWorkspaceState()` returns early while
   `wsBootLoaded` is false, so a failed boot fetch can never post a DEFAULTS
   state over the server's.

A viewer or the unauthenticated shell never queues a write (unchanged,
`app.js:530-533`) but does poll, so it still sees live updates.

### 17.8 Device-local selection and session ids

Two `localStorage` keys, using the existing `nb:<ws>:<base>` convention
(`table-view.js storageKey()`, `frontend.md` §5):

| Key | Written | Read |
| --- | --- | --- |
| `nb:activeSession` | the `tabs:changed` listener, skipped while `applyingRemote` | boot, before normalisation |
| `nb:activeFile` | the same listener, same rule | boot, before normalisation |

Boot preference (`app.js:1069-1087`):

```
sessions source      : cfg.sessions
activeSessionId      : local `nb:activeSession` if it names an existing session,
                       else cfg.activeSessionId
activeFile override  : local `nb:activeFile` if it is in that session's list,
                       else the server value
```

`auth.js` adds both names to `DEVICE_LOCAL_KEY_RE` (`auth.js:42-43`) so sign-out
clears them with the other device-local keys.

**Session ids must be unique across clients.** `generateSessionId`
(`tabs.js:182-189`) is `Date.now()` plus a per-page counter, so two pages that
create their first session in the same millisecond produce the same id, and the
merge would fold them into one session. It must use
`crypto.randomUUID()` when available, else a random suffix
(`Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)`), and
keep its existing "not already in `sessionOrder`" check.

### 17.9 Failure and race matrix

| Event | Result |
| --- | --- |
| Two clients change different sessions at once | The merge keeps both. Each response carries the merged state, so both converge (`requirements` AC69). |
| Two clients change the same session at once | The second write's merge takes the client's copy for that session; both converge on it (A8). |
| Two clients delete and edit the same session | The edited copy wins; a deletion only applies to a session the other side did not touch. |
| Remote apply while hybrid is editing | Allowed. The active tab is kept, so the edit target never changes; the same apply schedules one republish if a peer removed it. |
| Dirty path removed remotely | Kept, returned in `kept`, and republished by the same apply. |
| Dirty path in a session removed remotely | The session is kept and republished. |
| Active clean tab removed remotely | `dropTab`, then the neighbour is activated. The only activation an apply performs. |
| Active tab removed while an `activate()` is in flight | Kept; the same apply schedules one republish. |
| Apply between the fingerprint check and the model update | Impossible in one tab; the apply is awaited before the next pass can start (`wsSyncing`). |
| A write lands while a poll is in flight | The poll is paused while a write is queued or in flight, and every apply runs on one serialised chain, so the two cannot interleave. A response older than `wsRev` is dropped by both paths, so an out-of-order arrival cannot regress the state. |
| Boot restore's write | Carries the `base` seeded from `/api/config`, so a peer write between boot and the first save is merged, not lost. |
| Page loaded before this change | Its `/api/workspace-state` write is refused (no `base`); its `/api/config` write loses the state keys. No clobber. |
| Endpoint missing (older server) | `start()` resolves `false` after one probe; no timer, no repeated request. |
| Phone shell | No timer. Writes carry the boot `base`, so the merge protects the other devices. One conditional read when the page becomes visible again, comes back online, is restored from the back/forward cache, or opens the drawer. |
| Hidden tab | No requests; one immediate poll on return. |
| Server error or network down | Backoff from 3 s doubling to 30 s; recovery resets the delay. No user-visible error. |
| 401 mid-poll | `request()` emits `auth:required` (`api.js:75-78`); the loop backs off. |
| Corrupt `config.json` at a `POST /api/config` | The POST is refused (500 `write_failed`) rather than dropping every workspace's state. |
| State over the cap | 400 `state_too_large`; `console.warn` once, as today. |
| Hand-edited remote sessions | Sanitised per §17.6 step 2; never throws, never renames a peer's session. |

### 17.10 Test seams

`NB.sync` and `applyRemoteState` are the seams.

**The DOM harness needs three changes before any sync test is meaningful**
(`tests/dom/test_dom.js`):

1. The shell `<html>` has no `data-workspace` (`test_dom.js:173`), so
   `NB.workspaceId()` is `""` (`api.js:11-13`) and `scheduleWorkspaceState()`
   returns immediately (`app.js:529`). The sync block must set
   `document.documentElement.dataset.workspace = "default"` for its duration and
   restore it afterwards.
2. The fake router (`test_dom.js:1898`) must answer
   `GET /api/workspace-state` (with `rev`, `state`, and a 304 when `rev` matches)
   and `POST /api/workspace-state` (store `state`, bump `rev`, return both; for
   the merge case, return a canned merged state). Without those routes no POST
   can be observed and every "no write" assertion would pass for the wrong
   reason.
3. `GET /api/config` must return a body that carries `workspaceState` and
   `workspaceStateRev` for `default`, so `applyConfig` seeds `wsRev` and `base`
   the way the real server does.

Outside that block the loop stays off for the real reason: no workspace id. The
`{}`-has-no-`rev` rule is the second gate, for a server that lacks the endpoint.

Server (`pytest`):

| Case | Assertion |
| --- | --- |
| GET round-trip | `{ok, id, rev, state}`; `{}`/`0` for an entry never written |
| GET conditional | 304 with an empty body on an equal rev; 200 on a different one |
| GET validation | 400 `bad_body` without `id`; 404 `unknown_workspace` |
| POST replace | `base` equal to the stored entry stores `state` verbatim and returns `rev + 1` |
| POST merge | two clients changing different sessions: both survive |
| POST merge, same session | the incoming copy wins |
| POST delete/edit conflict | a delete applies only to an untouched session; an edited one is kept |
| POST add | a session added by either side survives |
| POST idempotent | replaying the same `base`/`state` changes only the rev |
| POST without `base` | 400 `bad_body`; nothing written |
| POST oversized | `state` over the cap is 400 `state_too_large`; `base` over the cap is 400 `base_too_large` before the workspace lookup; a merge that grows past the cap is 400 `state_too_large` |
| `/api/config` | strips state keys and re-attaches the stored maps; a corrupt read refuses with 500 `write_failed` |
| Rev monotonic | never regresses across a `/api/config` write or a merge |
| Workspace delete | the state entry and its rev are removed |
| Permissions | a viewer may GET and is refused POST; the 304 and the 200 carry `no-store` and `Vary` |

DOM (`tests/dom/test_dom.js`, `== workspace sync ==`): a remote add appends
without activating; a remote remove closes a clean tab; a dirty one is kept,
returned in `kept`, and republished by exactly one POST; a removed active clean
tab activates its neighbour and emits exactly one `tabs:changed`, not two; a
remote rename updates the Sessions row; a reorder rewrites `sessionOrder`; a pin
added remotely moves the tab into the pinned prefix; a session deleted remotely
disappears, unless it holds a dirty hidden path, in which case it is kept and
republished; an identical projection is a no-op that emits nothing; an
`activeFile`-only change never calls `applyRemoteState` and never queues a write;
`activeSessionId` and the active tab are unchanged after every apply except the
neighbour case; a POST response that merges a peer session is applied and
produces no second POST.

Browser (`tests/browser/`): two contexts on one server converge on a tab add and
on a session rename, and neither switches the other's active tab. Optional today;
it is the only test that would catch a regression across the whole loop, so it
is worth promoting to the core suite once the feature lands.

### 17.11 Accepted limits

- **Polling, not push.** A peer update is visible within one interval (3 s), not
  instantly. SSE was rejected: one held connection and one thread per open
  browser on the Flask dev server, plus proxy buffering.
- **An `activeFile`-only peer write still fetches the full state.** It bumps the
  rev, so the next poll is a 200, not a 304; the fingerprint gate then does no
  work. Cheap, not free.
- **Last writer wins inside one session.** Two devices that add a tab to the same
  session in the same interval settle on one list (A8).
- **The per-session `activeFile` is a shared hint.** Switching into a session on
  device B may restore the tab device A used there. Only the *active* session's
  tab is device-local.
- **`recentFiles` lands on the next Recent activation.** That view re-reads on
  activation (`activity.js:469`); it has no setter to call from an apply.
- **A page without a workspace id persists no scoped state.** It could not reach
  the workspace endpoint before either.
- **A page loaded before this change stops persisting.** Its state write is
  refused and its config write loses the state keys, by design; the shell
  replaces itself on the next load.
- **Writes need workspace admin.** With auth off, a non-loopback peer cannot
  write, so the shared set is read-only from a remote host until auth is enabled.
  This is the existing `workspace_admin_required` rule, unchanged.
- **No sync across workspaces.** The page is bound to one workspace; switching
  reloads.
