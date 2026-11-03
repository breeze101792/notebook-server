# Feature: Sessions — tab groups inside a workspace

**Author:** product-designer
**Date:** 2026-11-03
**Status:** Product definition. No technical or visual design chosen here.
**Inputs:** `static/js/tabs.js` (`ordered`/`openSet`/`pinned` at 29-32, `segment`
at 111, `togglePin` at 617, `restore` at 849, `rename` at 579, `conflictSet` at
939, close confirm at 525), `static/js/viewer.js` (`commitForTabSwitch` at 945,
draft bar at 43-101, `close` at 758, `showWelcome` at 672, external-change
handler at 1141-1205), `static/js/app.js` (`WORKSPACE_STATE_KEYS` at 24,
`tabs:changed` persistence at 640, boot restore at 975, phone boot at 986),
`app.py` (`_WORKSPACE_SCOPED_CONFIG_KEYS` at 92, `WORKSPACE_STATE_MAX_BYTES` at
77, `workspace_admin_required` at 1113, `/api/workspace-state` at 1660, ACP
open-note preamble at 2627). All line numbers verified 2026-11-03.

---

## 0. One-line definition

Give each workspace named **sessions** — flat Firefox-style tab groups holding
the unpinned tabs — so the owner can keep one strip for the task at hand and
switch the whole set in place, while the workspace's pinned tabs stay open in
every session.

---

## 1. User goals

Ranked by the job the feature does.

- **G1 — Keep several working sets alive at once.** A note set for one task
  (a driver bring-up, a board review) and another for a different task share one
  workspace; switching must not cost the open tabs of the set being left.
  *This is the reason the feature exists; every other goal is a constraint on
  how it is delivered.*
- **G2 — Keep the always-open notes always open.** A handful of notes (index,
  build sheet, pinout) belong in view whatever set the owner is working in.
  Pinned tabs are that set and must not be duplicated per group.
- **G3 — Never lose typing to a switch.** Moving between sets must cost nothing:
  an unsaved buffer is stashed, not prompted away, and is recoverable on return
  — the behaviour the tab switch already has (`viewer.js:945-967`).
- **G4 — Never show stale structure.** A file renamed, deleted, or moved on disk
  must leave no orphan tab in a session the owner is not looking at, and an
  external edit must not silently overwrite an unread buffer.
- **G5 — Nothing new to learn.** The session control is a side-panel view beside
  the file browser and the bookmarks view, and uses the app's existing dialog,
  confirm, draft, and conflict surfaces. No new keyboard shortcut, no second
  navigation model.

---

## 2. Scope

**Must-have (MVP).**

- Sessions as a flat, per-workspace, ordered list of named groups, each with its
  own unpinned tabs in their own order and its own active tab.
- One shared pinned set per workspace, rendered in the existing pinned region.
- A **Sessions** side-panel view, opened from the activity bar: the list of
  sessions with switch, create (name dialog), rename (name dialog), and delete
  (native confirm) on any row.
- Tab right-click → Move to session ▸ (existing sessions + New session…).
- Pin / unpin with the shared-set rule, preserving every rule in
  `tabs.js:617-630`.
- Per-session persistence of tabs, order, active tab, and the active session, in
  the existing workspace state.
- Legacy migration to a single session named "Main" on the first load after the
  upgrade.
- Draft, conflict, external-change, file rename/delete/move, and welcome-page
  behaviour as stated in §4 and §5.

**Should-have.**

- The session row shows the count of the session's unpinned tabs (the owner's
  only cue to what a hidden set costs in memory).

**Out of scope / non-goals.**

- Nested sessions or session folders. Sessions are flat.
- Sessions that span workspaces, or moving a session between workspaces.
- Any sync, sharing, or server-side session history. Sessions are UI state in
  `config.json`, not content.
- Drag-a-tab-onto-a-session in the Sessions view, and drag-reorder of sessions.
  Moving a tab is the tab menu's job; session order is creation order in v1.
- Keyboard shortcuts for sessions — no new binding in v1.
- Sessions on the phone shell, which has one reader, no tab bar, and no
  Sessions rail icon; a saved `activeView` of `sessions` falls back to Explorer.
- Changing what pin, close, rename, delete, search, or Back/Forward already do.

**MVP line.** Everything in must-have. The row count is the only should-have.

---

## 3. Verified current behaviour (baseline this spec changes)

The tab bar today is one flat, ordered set per workspace, persisted per
workspace:

- `ordered` (display order, pinned first), `openSet` (membership), `pinned` (a
  contiguous prefix of `ordered`), and one `activePath` — `tabs.js:29-32`.
  `segment()` re-establishes the pinned-first invariant (`tabs.js:111-116`).
- Pinned tabs render into `#tab-pinned`, unpinned into `#tab-list`
  (`index.html:241-250`, `tabs.js:19-24`); the pinned region is hidden while
  nothing is pinned (`tabs.js:265`), and pinned tabs carry no close button and
  are skipped by the bulk-close actions (`tabs.js:373-386`).
- Opening a file adds it to the same flat strip in the active position
  (`tabs.js:508`). A tab switch stashes a dirty source buffer as `t.draft` and
  shows the dot plus the Recover bar on return, with no prompt
  (`viewer.js:945-967`); WYSIWYG stashes its own serialized buffer.
- Closing a tab with unsaved edits prompts and discards on OK
  (`tabs.js:525-534`). Closing the last tab calls `NB.viewer.clear()` →
  `showWelcome()`, which also clears the whole content cache
  (`tabs.js:558-561`, `viewer.js:672-674`).
- File rename/move re-keys `ordered`, `openSet`, `pinned`, `activePath`, the
  frozen widths, and the viewer cache (`tabs.js:579-608`).
- Conflict badges are a `Set` of paths rendered onto open tabs
  (`tabs.js:939-952`).
- An external change to a dirty file prompts and, on Cancel, flags the conflict
  instead of overwriting (`viewer.js:1172-1180`).
- Boot restores `openFiles` / `activeFile` / `pinnedFiles` from the workspace
  state, dropping paths no longer in the tree (`app.js:975-979`), and falls back
  to `lastFile` or the first file when nothing is open (`tabs.js:855-858`).
- Persistence goes through `tabs:changed` → `cfg.openFiles` / `activeFile` /
  `pinnedFiles` (`app.js:640-646`), written into
  `workspaceState["<id>"]` under the keys in `WORKSPACE_STATE_KEYS`
  (`app.js:24-27`) and mirrored by `_WORKSPACE_SCOPED_CONFIG_KEYS`
  (`app.py:92-95`). That tuple is what the one-shot migration and the ACP
  preamble both read.
- The ACP preamble names the open note from
  `workspaceState["<id>"].activeFile` (`app.py:2627-2650`).
- The workspace-state write is admin-gated (`app.py:1113-1140`) and capped at
  `WORKSPACE_STATE_MAX_BYTES` = 256 KiB (`app.py:77`, enforced at
  `app.py:1690`).
- The phone boot drops desktop tabs entirely and never persists them
  (`app.js:641`, `app.js:986-1000`).

---

## 4. Model

### 4.1 Definitions

- **Workspace** — a root folder of notes, identified by the workspace id in the
  workspace state (`app.js:24`). Sessions are scoped to one workspace.
- **Session** — a stable id, a name, an ordered list of unpinned paths, and one
  active path (a member of that list, a pinned path, or `null`). A session's id
  is generated at create and never changes; the name does.
- **Pinned set** — one per workspace, shared by every session, rendered in the
  existing pinned region. A pinned path is not a member of any session's list;
  the pinned set and every session's list are disjoint.
- **Active session** — the session whose unpinned strip is rendered. Exactly one
  per workspace at any time.
- **Occurrence of a path** — the pinned set, or one tab in a session. A pinned
  path is shared and never a member of a session's list; an unpinned path may be
  open in **several** sessions at once. The occurrences point at the same file
  and share one viewer buffer.

### 4.2 Invariants

1. A workspace always has at least one session. Zero is an invalid state and is
   repaired to one empty session (§4.5).
2. Every session id in a workspace is unique and never reused.
3. `pinned ∩ session.unpinned = ∅` for every session.
4. A session's own list holds unique paths. The same unpinned path may appear in
   several sessions; closing one occurrence does not close another.
5. Every `session.active` is either a member of `session.unpinned` or a member of
   `pinned`, or `null`.
6. At most 20 sessions per workspace. Each session holds at most 40 unpinned
   tabs. Pinned tabs are not counted against a session.
7. A session name is 1-40 characters after trimming surrounding whitespace, and
   is unique within the workspace under a case-insensitive comparison.
7. The active session id names an existing session.
8. Order is stable: sessions keep their creation order; a session's tabs keep
   their relative order; pinning and unpinning are the only operations that move
   a tab between regions.

### 4.3 States

A session is always in one of these, and each is a testable rendering:

| State | Unpinned tabs | Pinned tabs | Content area |
|---|---|---|---|
| **Idle with tabs** | ≥1 | any | the session's active tab |
| **Pinned only** | 0 | ≥1 | the session's active tab if it is pinned; otherwise the first pinned tab |
| **Empty** | 0 | 0 | welcome page (`viewer.js:672`) |
| **Active + dirty draft** | a tab whose buffer differs from disk | any | that tab, with its dot and Recover bar on return |

The Sessions view itself has no error state beyond the name dialog's inline error
(§5.1) and the delete confirm's cancel path (AC20).

### 4.4 Limits

| Limit | Value | Source | Behaviour at the limit |
|---|---|---|---|
| Sessions per workspace | 20 | this spec | the view's `+` is disabled with a reason; an import of more is truncated (§4.5) |
| Session name length | 40 characters | this spec | the field refuses further input; a pasted longer name is truncated to 40 |
| Unpinned tabs per session | 40 | this spec | opening or moving a 41st into that session is refused with a notice; the tab is not added |
| Workspace state size | 256 KiB | `app.py:77` | the write is refused by the server (`state_too_large`, `app.py:1690`); worst case is bounded by 20 × (40 paths + name) and must stay under it |

The values above are product caps. They are not server-enforced constants; a
hand-edited config is repaired on read, not rejected.

### 4.5 Repair rules (boot)

Read in this order, never throw, never block boot:

1. No `sessions` key in the workspace state → **migrate** (§5.4). This is the
   only path that applies a fallback file.
2. `sessions` present but not an array, empty, or containing no usable entry →
   replace with one empty session named "Main".
3. Give every entry an identity. A usable stored id is kept; a missing or
   duplicate id is regenerated. A missing or empty name becomes `Session N`
   (N = its position); a case-insensitive duplicate gets ` 2`, ` 3`, … appended
   (truncated to 40). Entries that are not objects are dropped; if nothing
   usable remains, repair to one empty session named "Main".
4. Truncate to 20 entries, keeping the active session even when it falls past
   the cap (append it and drop the last other entry).
5. Drop a path that is not in the tree, matching today's filter (`app.js:975`).
6. A path in both the pinned set and a session: keep it pinned and drop it from
   the session. A path in two sessions is allowed; each occurrence is kept.
7. A session whose `active` is not owned by it becomes `null`; the renderer then
   applies §4.3.
8. An unknown `activeSessionId` falls back to the first session.
9. The repaired shape is held in memory only. It is written on the next user
   action, matching the boot baseline that stops a rewrite on load
   (`app.js:419`).

---

## 5. Functional flows

### 5.1 Create a session

1. The owner opens the **Sessions** view from the activity bar. It is a
   side-panel view beside the file browser and the bookmarks view: a
   `.panel-header` carrying the title "Sessions" and a `+` (New session), then
   one row per session in creation order, then the footnote "Pinned tabs are
   shared by every session." A row carries the active marker, the name, the
   unpinned tab count, a dirty dot when any of that session's tabs has an
   unsaved buffer, and a `⋯` actions button.
2. The owner picks **+**. A dialog opens with the title "New session", one text
   field focused, and Create / Cancel.
3. Empty or whitespace-only name, or a name equal (case-insensitive, trimmed) to
   an existing one → inline error under the field, dialog stays open, focus
   returns to the field, nothing is created.
4. A name longer than 40 characters cannot be typed past 40; a paste is
   truncated to 40 before validation.
5. Create → the session exists and is empty. The Sessions view stays open and
   the new row, active, takes focus. The content area shows the shared pinned
   tabs plus the welcome page if there are none (§4.3).
6. At 20 sessions, **+** is disabled and carries the reason on its title. The
   name dialog cannot be opened from it.
7. Cancel, Esc, or an outside click closes the dialog, creates nothing, and
   returns focus to the `+`.

The dialog is the app's existing name-dialog surface (the workspace add/rename
dialog, `static/js/workspaces.js`, is the closest precedent). Visual design is
`ui-designer`'s job.

### 5.2 Switch away from a dirty note and come back

1. The owner types in note A, which belongs to session S1, and does not save.
2. The owner opens the Sessions view from the activity bar and clicks the S2
   row.
3. The unpinned strip is replaced by S2's strip in place, and the Sessions view
   stays open with S2 marked current. No document load, no route change, no
   full re-render of the shell. Pinned tabs do not move.
4. A's buffer is stashed as a draft: A's tab is gone from the visible strip, but
   on return to S1 the tab carries its dot and its Recover bar offers the buffer
   — the same end state as the tab switch today (`viewer.js:945-967`). No modal
   prompt appears at any point.
5. S2's content area shows S2's active tab. If S2 has no unpinned tabs, the
   pinned region is still visible and S2's active pinned tab renders. If S2 has
   neither, the welcome page fills the content area.
6. Returning to S1 restores S1's strip in its own order and S1's own active tab,
   with A's dot and Recover bar.
7. If the owner instead opens a file that is already open in S3 (from the tree,
   search, a wikilink, a recent row, or a deep link), it opens or activates in
   **S1**, the active session; S3 keeps its own copy. No switch happens. A file
   in the pinned set activates in place.

### 5.3 Move a tab, then pin it

1. The owner right-clicks an unpinned tab in the active session.
2. **Move to session ▸** opens a submenu: every other session by name in creation
   order, then **New session…**. The current session is absent. The item is
   absent for a pinned tab.
3. Picking a session moves the tab — with its order relative to itself, its
   buffer, its dot, and any conflict flag — out of the source and into the target,
   appended last there. Switching to the target from its Sessions view row shows
   it at the end of the strip with the identical draft.
4. If the moved tab was the source's active tab, the source activates its next
   neighbour, else its previous one (`pickNeighbor`, `tabs.js:438-440`). If it was
   the source's only tab, the source stays active and renders §4.3.
5. The target's own active tab does not change. If the target had no tabs at all,
   the moved tab becomes its active tab.
6. **New session…** creates the session with §5.1's validation, moves the tab
   into it, and leaves the owner on the source session.
7. The owner then right-clicks the same tab and picks **Pin**. The file leaves
   every session and joins the shared pinned set, staying active and visible.
   Every other session would now show it in its pinned region.
8. Later, **Unpin** puts the file back into the active session only, at the end
   of the strip, and it becomes that session's active tab.

### 5.4 First load after the upgrade

1. The workspace state has no `sessions` key. The owner's existing
   `openFiles`, `activeFile`, and `pinnedFiles` are read as today.
2. One session named "Main" is created, containing every open unpinned tab in
   their existing order, with `activeFile` as its active tab. `pinnedFiles`
   becomes the shared pinned set.
3. This boot renders exactly what the previous version rendered: same tabs, same
   order, same active note, same pinned region, no dialog, no content reload.
4. The migrated shape is persisted at the next state change, so the next reload
   reads `sessions` and does not migrate again.

---

## 6. Edge cases

| Situation | Behaviour | Rule / origin |
|---|---|---|
| Create a session while at 20 | The `+` is disabled with a reason; the dialog does not open | §4.4 |
| Create a session named like an existing one, differing only in case | Rejected as a duplicate | §4.2(6) |
| Name of only spaces, or a tab and newlines | Rejected as empty after trimming | §4.2(6) |
| Rename to the same name, different case only | Allowed as a no-op change of display text; id and order unchanged | §4.2(6) |
| Only session, Delete chosen from its `⋯` menu | Delete is shown disabled with the reason "The only session can't be deleted" | §7 AC19 |
| Delete an inactive session | That row is removed; the active session, its strip, and its content are unchanged; cached buffers close only for paths no other session or pin holds | §7 AC59 |
| Delete a session that holds an unsaved buffer | The confirm states that its unsaved edits will be lost; on OK its occurrences go, and another session's copy of the same note keeps its buffer and draft | §7 AC18, AC20 |
| Sessions view closed while a session is active | The strip renders the active session as usual and no session marker is visible anywhere until the view is reopened; accepted, the tab bar is unchanged | §9 |
| Delete the active session while another session has a dirty draft | The draft belongs to the other session and is untouched; the confirm covers only the deleted session's files | §5.2, §7 AC20 |
| Delete a session while one of its files is also open in another session | The other session's tab, buffer and draft survive; only the deleted session's occurrence goes. Pinned files survive | §4.2 |
| Open a file that is already open in another session | Opens or activates a tab in the **active** session; the other session's copy is untouched; no switch | §5.2(7), AC13 |
| Close a tab that another session also holds | Only this occurrence closes; the other tab keeps its content, dot and Recover bar | §4.2(4), AC61 |
| Move the last tab out of the active session | The source stays active; welcome page (or pinned only) renders | §5.3(4) |
| Move a tab into a session at 40 | Refused with a notice naming the limit; the tab stays in the source. If that session already lists the note, the source copy is just removed | §4.4, AC62 |
| Opening a 41st file in the active session | Refused with a notice naming the limit; the file does not open | §4.4 |
| Pin the active tab of a session that has only that tab | The workspace tab strip shows only the pinned region; the file stays active | §5.3(7) |
| Unpin the only pinned tab | It lands in the active session and renders there; the pinned region collapses | `tabs.js:265` |
| Close the last unpinned tab of a session with an unsaved buffer | Today's confirm; on OK the tab closes and the empty state renders without clearing other sessions' cached drafts. Cancel keeps the tab | `tabs.js:525-534`, §7 AC38 |
| Close a non-last dirty tab | Today's confirm and discard | `tabs.js:525-534` |
| A session has a draft but the file is deleted on disk | Removed from every session; the draft goes with the last occurrence | §5.2, `tabs.js:939-952` |
| External change to a dirty file in a hidden session | No confirm is shown; the tab is flagged and shows the conflict badge when the session becomes visible; the buffer is kept | `viewer.js:1172-1180`, `tabs.js:939` |
| External change to a clean file in a hidden session | Reloaded silently; the new bytes appear on switch | `viewer.js:1141-1205` |
| File renamed on disk while its session is hidden | Re-keyed in that session's list, in that session's active tab, and in its drafts | `tabs.js:579-608` |
| File deleted on disk while its session is hidden | Removed from that session; if it was that session's active tab, the session activates a neighbour | `tabs.js:547-561` |
| Folder moved or renamed | Every session's path under it re-keys | `tabs.js:579-608` |
| Sessions array holds a path no longer in the tree | Dropped at boot; an emptied session stays listed and empty | §4.5(5), §7 AC41 |
| Hand-edited `sessions` with duplicate ids or names | Duplicate ids are regenerated; duplicate names get ` 2`, ` 3`, …; boot continues | §4.5(3) |
| Hand-edited `activeSessionId` naming nothing | First session becomes active | §4.5(8) |
| 25 sessions in config | Truncated to the first 20 | §4.5(4) |
| Two sessions claim the same path | First keeps it; the second loses it | §4.5(6) |
| Phone opens a note | Phone shell unchanged: one reader, one tab, no session control, no Sessions rail icon; desktop sessions are neither read nor written | `app.js:641`, `app.js:986-1000`, §7 AC60 |
| Phone loads with a saved `activeView` of `sessions` | Explorer opens instead; no session UI is shown | §7 AC60 |
| Viewer role uses the Sessions view | Switching works in memory; the `+`, Rename, Delete, and Move to session are disabled with a read-only reason; nothing persists | `app.py:1113`, `app.py:1660` |
| Session state pushes the workspace state past 256 KiB | The write fails with `state_too_large`; the app keeps working, the change is lost on reload | `app.py:1690` |

---

## 7. Acceptance criteria

Each criterion names what the tester observes. "No page load" means the document
was not navigated: the boot marker on `window` (or the absence of a new document
request) is unchanged.

**Create**

1. **AC1** — With two sessions present, choosing the `+` in the Sessions view
    header opens a dialog titled "New session" with one focused text field.
    *Observe:* dialog title, `document.activeElement` is inside the field, the
    Sessions view still open behind it.
2. **AC2** — Submitting an empty name and a whitespace-only name each show an
    inline error under the field, keep the dialog open, create no session, and
    leave focus in the field. *Observe:* error text, session-row count unchanged,
    active element.
3. **AC3** — Pasting a 60-character name leaves exactly 40 characters in the
    field and creates a session whose name is those 40 characters. *Observe:*
    field value length and the new row's text.
4. **AC4** — Creating a session named "main" while "Main" exists shows the
    duplicate error inline, creates nothing, and keeps focus in the field.
    *Observe:* error text, row count, active element.
5. **AC5** — The 20th session can be created; with 20 present, the `+` is
    disabled, carries a non-empty reason on its title, and does not open a dialog
    when clicked. *Observe:* disabled state, `title`, row count 20.
6. **AC6** — A created session is appended last, becomes the active row, and
    takes focus; its strip is empty: pinned tabs render if the workspace has any,
    otherwise the welcome page. *Observe:* row order, current-row marker, focused
    element, tab strip, content area. No page load.
7. **AC7** — Cancel, Esc, and an outside click each close the dialog, create
    nothing, and return focus to the `+`. *Observe:* row count, active element.

**Switch**

8. **AC8** — Clicking a session row replaces the unpinned strip with that
    session's tabs, in that session's order, and renders that session's active
    tab; the Sessions view stays open with that row marked current. *Observe:*
    tab labels and order, highlighted tab, content heading, current-row marker.
    No page load; no fetch for already-cached files.
9. **AC9** — Switching away from a source session with an unsaved source-mode
    buffer shows no prompt; the source's tab is absent; on return the tab has its
    dot, the Recover bar names the file, and Recover restores the exact text,
    with one `Ctrl+Z` returning the saved bytes. *Observe:* no dialog during the
    switch, dot, Recover bar text, buffer text, undo depth.
10. **AC10** — Switching away from a session with an active WYSIWYG edit shows no
    prompt; on return the tab has its dot and Recover restores the editable
    content as typed. *Observe:* no dialog, dot, Recover result.
11. **AC11** — Switching to a session with no unpinned tabs and at least one
    pinned tab shows the pinned region with files, no unpinned tab, and the
    session's active note in the content area. *Observe:* pinned region
    visibility, unpinned strip emptiness, content heading.
12. **AC12** — Switching to a session with neither unpinned nor pinned tabs shows
    the welcome page, and the tab bar shows no active tab. *Observe:*
    `#welcome` visible, no `.tab.active`, no dot anywhere.
13. **AC13** — Opening from the tree a file that is already open in a non-active
    session opens a tab for it in the **active** session and activates it; the
    other session keeps its copy and no session switch happens. *Observe:*
    current-row marker unchanged, the file's tab present in the active strip,
    content shown once, the other session's row count unchanged.
14. **AC14** — Opening a file that is pinned does not change the active session.
    *Observe:* current-row marker before and after; the file activates in the
    pinned region.

**Rename**

15. **AC15** — **Rename…** from a row's `⋯` menu opens the dialog prefilled with
    that row's name, selected for replacement, and saving a valid new name changes
    only the row's text: tab set, tab order, active tab, drafts, and id are
    unchanged after reload. *Observe:* field value and selection, row text, tab
    strip before and after, persisted id after reload.
16. **AC16** — Rename to empty, over 40 characters, or an existing name
    (case-insensitive) shows the same inline errors as create and saves nothing.
    *Observe:* error text, row text unchanged.
17. **AC17** — Cancel or Esc on rename leaves the name unchanged and returns
    focus to the row's `⋯`. *Observe:* row text, active element.

**Delete**

18. **AC18** — Every session row carries a `⋯` actions button opening a menu with
    **Rename…** and **Delete…**; the same menu opens on right-click of the row.
    **Delete…** opens a native confirm that names that session, says its tabs
    close, and mentions unsaved edits — including WYSIWYG edits — when any of its
    files has a dirty buffer. *Observe:* `⋯` per row, menu items, confirm text for
    a clean session and for a session with a dirty tab.
19. **AC19** — With one session, its `⋯` menu shows **Delete…** disabled with a
    title saying the only session cannot be deleted. *Observe:* disabled state and
    title.
20. **AC20** — Cancelling the confirm changes nothing: same sessions, same order,
    same active session, same tabs, same drafts. *Observe:* Sessions view rows,
    current marker, and strip before and after.
21. **AC21** — Confirming a delete on the active session removes it and lands on
    the previous session in the list, else the next one, whose own tabs and active
    tab render; the Sessions view stays open. *Observe:* row list, current marker,
    strip, content. No page load.
22. **AC22** — Pinned tabs are unchanged by a delete: the same files stay open in
    the pinned region, in every remaining session, and after a reload.
    *Observe:* pinned labels before and after, and in each session, and after
    reload.

**Move**

23. **AC23** — The tab menu of an unpinned tab offers **Move to session ▸**
    listing every other session by name in creation order, then **New session…**;
    the current session is absent. A pinned tab's menu has no such item.
    *Observe:* submenu labels and order.
24. **AC24** — Choosing a session removes the tab from the source strip at once
    and, on switching to the target, shows it last with its dot and its exact
    draft. *Observe:* strip counts, tab position, dot, Recover text.
25. **AC25** — Moving the source's active tab activates its right neighbour, or
    its left neighbour when it is last, and the content area follows. *Observe:*
    highlighted tab and content.
26. **AC26** — Moving the only tab out of a session leaves that session active and
    showing the welcome page or pinned tabs. *Observe:* content area, current
    marker unchanged.
27. **AC27** — The target's active tab is unchanged by a move; moving into a
    completely empty session makes the moved tab that session's active tab.
    *Observe:* target's highlighted tab in both cases.
28. **AC28** — **New session…** in the submenu applies create validation, creates
    the session, moves the tab into it, and leaves the owner on the source
    session. *Observe:* new row, tab location, current marker still on the source.
29. **AC29** — Moving into a session that already holds 40 unpinned tabs shows a
    notice naming the limit and leaves the tab in the source. *Observe:* notice
    text, both strips' counts.

30. **AC30** — With 40 unpinned tabs in the active session, opening a 41st from
    the tree shows a notice naming the limit of 40, does not add a tab, and leaves
    the strip at 40 tabs and the content unchanged. *Observe:* notice text, tab
    count, content area.

**Pin / unpin**

31. **AC31** — Pinning a tab removes that path from every session's unpinned list;
    each session that had it active falls back to a neighbour or §4.3. The file
    appears once in the pinned region and is still active. *Observe:* every
    session's strip in turn, pinned region, content.
32. **AC32** — Unpinning a pinned file adds it to the active session only, last,
    and makes it active there; every other session still shows it as pinned and
    does not gain an unpinned copy. *Observe:* active strip, then each other
    session.
33. **AC33** — The pinned set is identical in every session after a reload, and
    each session's pinned region shows the same files in the same order.
    *Observe:* pinned labels per session before and after reload.

**Per-session active tab and persistence**

34. **AC34** — With session A active on `a2.md` and session B (the active session)
    on `b1.md`, a reload lands on B showing `b1.md`, and switching to A shows
    `a2.md`. *Observe:* session row, active tab, content, both before and after
    reload.
35. **AC35** — Session order, names, ids, tab order, active session, and each
    active tab survive a reload with no page-level reordering.
    *Observe:* Sessions view rows and persisted `workspaceState.<id>` contents.
36. **AC36** — Switching workspaces and back restores each workspace's own
    sessions; sessions in another workspace are not modified by a switch in this
    one. *Observe:* each workspace's Sessions view after switching.

**Drafts**

37. **AC37** — A dirty source-mode buffer survives a session switch as in AC9.
    *Observe:* dot, Recover bar, text, undo after Recover.
38. **AC38** — Closing the last unpinned tab of a session with an unsaved buffer
    prompts as today; Cancel keeps the tab and its buffer, OK closes it and shows
    the empty state, and a draft belonging to another session is still
    recoverable afterwards. *Observe:* the confirm, the empty strip, and the
    other session's dot and Recover after switching back.
39. **AC39** — Discarding a recovered draft clears the dot and the Recover bar and
    leaves disk content active; a later reload shows no draft. *Observe:* dot,
    bar, content, after-reload state.
40. **AC40** — A draft travels with a moved tab: the source has no dot and no
    Recover bar for that path, the target's tab has both, with the same text.
    *Observe:* both sessions.

**Empty sessions**

41. **AC41** — An empty session stays empty across a reload: it is still listed,
    still selectable, and shows the welcome page (or the pinned tabs), and no
    fallback file is opened into it. *Observe:* row present, content area, strip.
42. **AC42** — A session emptied by closing its tabs remains in the Sessions view
    at the same position and is not removed. *Observe:* row list.

**File operations on disk**

43. **AC43** — Renaming a file on disk while its owning session is hidden re-keys
    that session's tab, that session's active tab, and its draft; on switching, the
    session shows the new name and no orphan tab. *Observe:* strip labels in both
    sessions and after reload.
44. **AC44** — Deleting a file on disk removes it from every session; a session
    whose active tab it was activates a neighbour, and an emptied session renders
    §4.3. *Observe:* every session's strip and content.
45. **AC45** — Moving or renaming a folder re-keys every file under it in every
    session, active or not, and drafts follow. *Observe:* strips before and after,
    then reload.

**External changes**

46. **AC46** — An external change to a dirty file in the visible session still
    prompts as today; Cancel flags the conflict and keeps the buffer. *Observe:*
    confirm text, conflict badge, buffer.
47. **AC47** — An external change to a dirty file in a hidden session shows no
    confirm; switching to that session shows the tab with the conflict badge and
    the buffer intact. *Observe:* absence of a dialog, badge on switch, buffer text.
48. **AC48** — An external change to a clean file in a hidden session shows no
    confirm and the new bytes appear when the session is shown. *Observe:*
    content on switch.

**Migration**

49. **AC49** — Loading a workspace whose state has no `sessions` key creates
    exactly one session named "Main" containing every previously open unpinned
    tab in the same order, with the same active tab and the same pinned set, with
    no dialog, no reload, and no change to what is on screen. *Observe:* Sessions
    view with one row, strip labels and order, active tab, pinned region, content.
50. **AC50** — After migration and a reload, "Main" restores the same tabs from
    `sessions`, and no second "Main" appears. *Observe:* Sessions view row count,
    strip, persisted `sessions`.
51. **AC51** — A fresh workspace with no saved tabs gets one empty session named
    "Main" and keeps today's first-run fallback (last file, else the first file
    in the tree, else welcome). *Observe:* content on first boot.

**Corrupt or hand-edited config**

52. **AC52** — A non-array `sessions` value, an empty array, or an array of
    unusable entries boots to one empty session named "Main" with no error
    dialog and a usable app. *Observe:* Sessions view, tab strip, console.
53. **AC53** — Duplicate ids, duplicate names, a missing name, a path absent
    from the tree, and more than 20 sessions each boot without error: duplicate
    ids are regenerated, duplicate names get a numeric suffix, a missing name
    becomes `Session N`, unknown paths are dropped, and at most 20 rows remain
    (the active one is kept). *Observe:* Sessions view rows and counts after the
    repair.
54. **AC54** — A path may appear in several sessions; each keeps its own tab. A
    path in both the pinned set and a session appears only as pinned. *Observe:*
    both sessions' strips and the pinned region.
55. **AC55** — An unknown or missing `activeSessionId` makes the first session
    active, and a session whose `active` is not owned by it renders per §4.3.
    *Observe:* current row, content area.

**Role and device**

56. **AC56** — On the phone shell there is no Sessions rail icon, no session row,
    and no session-related item in any menu; opening notes does not read or write
    desktop sessions, and a later desktop load shows the previous sessions intact.
    *Observe:* phone activity bar, phone tab bar, menus, then desktop Sessions view
    and strips.
57. **AC57** — Signed in as viewer, switching sessions works in memory while the
    `+`, Rename, Delete, and Move to session are disabled with a read-only reason;
    no `POST /api/workspace-state` is issued by any of them; after a reload the
    server's saved active session and tabs return. *Observe:* disabled states,
    network log, state after reload.

**No new shortcut**

58. **AC58** — No new keyboard binding exists for any session action; every
    existing binding behaves as before. *Observe:* shortcut list and a keypress
    sweep for session-related chords.

**Delete reach**

59. **AC59** — Deleting an inactive session from its `⋯` menu removes only that
    row: the active row stays current, its strip and content are unchanged, its
    drafts survive, and the confirm named the deleted session. *Observe:* row
    list, current marker, strip, content, confirm text.

**Activity bar and phone**

60. **AC60** — The phone shell renders no Sessions rail icon; with a saved
    `activeView` of `sessions`, the phone opens Explorer on load instead and shows
    no session UI. *Observe:* activity bar icons, shown view after load, network
    log.

**Multiple occurrences**

61. **AC61** — With the same note open in two sessions, closing its tab in one
    removes only that occurrence: the other session's tab, dot, Recover bar and
    buffer are unchanged. *Observe:* close one, switch to the other, dot and
    Recover text.
62. **AC62** — Moving a tab into a session that already lists the note removes
    the source copy and leaves one tab in the target; no duplicate is created.
    *Observe:* both strips and the target's count.

---

## 8. What must not regress

- **The tab bar is unchanged in every respect.** Pinned region, tabs, and the
  outline toggle behave as they do today; the Sessions view adds no chip, marker,
  or action to the bar.
- **The activity bar's existing views and the side-panel collapse/expand.** File
  browser, bookmarks, and their icons are unchanged; opening or closing the
  Sessions view obeys the same collapse/expand behaviour as every other view.
- **The tab bar's motion.** Equal-width tabs within the existing min/max
  (`style.css:481-483`, `1184-1185`), the width freeze while the pointer is in
  the bar (`tabs.js:55`), the release animation, and the ghost close slot
  (`tabs.js:79-83`, `style.css:1268-1304`) must behave identically. The strip
  swap on a session switch is instant and produces no ghost and no release
  animation.
- **Pinned tabs.** No close button, skipped by middle-click close
  (`tabs.js:373-386`), skipped by close others / right / left
  (`tabs.js:784-796`), hidden region while empty (`tabs.js:265`), contiguous
  prefix invariant (`tabs.js:111`, `690-691`), and their current position at the
  left of the bar.
- **Search and Recent opening behaviour.** A result for a file that is already
  open in another session opens or activates a tab in the **active** session; no
  switch and no cross-session duplicate suppression. A file not open anywhere
  opens one tab in the active session and activates it.
- **Back / Forward.** The navigation stack (`viewer.js:1406-1420`) keeps
  working across sessions: going back to a note opens it in the active session
  (adding a tab if needed); no session switch; the back button's enabled state
  and the browser's `popstate` path are unchanged.
- **The ACP open-note hint.** `activeFile` in the workspace state must remain the
  visible session's active tab, so the preamble still names the open note
  (`app.py:2627-2650`). `sessions` and `activeSessionId` join the scoped key
  lists (`app.py:92`, `app.js:24`) so the migration and the preamble agree.
- **Deep links.** `?file=…&heading=…` opens the file in the active session
  (adding a tab if needed) and still applies the heading; no session switch.
- **Phone shell.** One reader, one tab, no tab bar, no Sessions rail icon
  (`app.js:986-1000`).

---

## 9. Assumptions and open questions

**Assumptions** — taken to make the settled behaviour complete; each is written
into the criteria above and can be reversed without changing the shape of the
feature.

- **A1 — The 40-file limit is per session and counts unpinned tabs only.** At the
  limit, opening or moving a 41st tab is refused with a notice. Pinned tabs are
  shared and uncounted. The brief fixes the number, not the overflow rule.
- **A2 — Closing a dirty tab keeps today's confirm, including the last tab of a
  session.** The only change on the empty path is that the empty state renders
  without `showWelcome()`'s `cache.clear()`, so drafts belonging to *other*
  sessions survive; the closed tab's own buffer is discarded on OK, as today
  (`tabs.js:525-534`). A session does not accumulate hidden drafts.
- **A3 — Name uniqueness is trimmed and case-insensitive**, because "Main" and
  "main" are indistinguishable in the Sessions view. Ids are opaque and stable.
- **A4 — The viewer role may switch sessions but not change them.** Structural
  actions are disabled with a read-only reason; switching is in-memory only and
  is not persisted, because `/api/workspace-state` is admin-gated
  (`app.py:1113`).
- **A5 — Special tabs (`§graph`, `§search`) belong to the session that opened
  them** and follow the same swap, move, and persistence rules as file tabs.

**Resolved decisions**

1. **Surface — a Sessions side-panel view.** Sessions live in an activity-bar
   view, like the file browser and the bookmarks view: a `.panel-header` with the
   title and a `+`, one row per session, and the footnote "Pinned tabs are shared
   by every session." No chip, popover, or footer action exists in the tab bar
   (`docs/ui/sessions.md`).
2. **Row content — shown.** Every row carries the active marker, the name, the
   unpinned tab count including `0`, a dirty dot when the session holds an
   unsaved buffer, and a `⋯` actions button.
3. **Delete reach — per row, any session.** Right-click or `⋯` opens the same
   menu on every row, with **Delete…** disabled on the only session. Deleting an
   inactive session does not change the active one; deleting the active session
   lands on the previous session, else the next.
4. **Migration name — not reserved.** "Main" is an ordinary user-facing name. If
   the migrated session still carries it, a new session named "Main" is rejected
   by the uniqueness rule (§4.2); renaming the migrated session frees the name.
5. **Draft retention — session lifetime only.** Drafts live in the viewer's
   in-memory cache (`viewer.js:32, 815-825`) and do not survive a page reload,
   exactly as today. Persisting drafts is out of scope and is not implied by
   session persistence.
6. **No drag-reorder in v1.** Session order is creation order; the row list does
   not accept drags and no reorder affordance exists. The state model keeps an
   order, so a later revision can add it.
7. **The active session is visible only while the Sessions view is open —
   accepted.** The tab bar carries no session label, so a closed view leaves the
   owner with no on-screen marker of which session is active. Accepted in v1 to
   keep the tab bar unchanged.
