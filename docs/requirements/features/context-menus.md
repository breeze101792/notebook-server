# Feature: Unified right-click context menus

**Author:** product-designer
**Date:** 2026-10-13
**Status:** Product definition. No technical or visual design chosen here.
**Inputs:** `static/js/sidebar.js`, `static/js/tabs.js`, `static/js/hybrid.js`,
`static/js/editbar.js`, `templates/index.html:344-350`,
`static/css/style.css:2549-2614`, `1336-1337`, `1165-1173` (all verified
2026-10-13).

---

## Decisions (implementation, 2026-10-13)

The six open questions in §8 are resolved as follows. The questions are kept
below for the record.

1. **Tab file ops — yes (R6).** The tab menu carries Rename / Move…, Copy…,
   Copy path, Copy link, Add/Remove bookmark, and Delete alongside Export…
   and the tab-lifecycle items.
2. **Collapse all folders — removed from the bookmark menu (R8).** It stays on
   the tree-file, folder, and root menus.
3. **Copy path / Copy link — both added (R10)** to the three file-like
   surfaces: tree file, bookmark, and tab. The link is the deep-link form
   `?file=<encoded path>` built from `location.origin + location.pathname`.
4. **Creation labels — "New file…" and "New folder…" everywhere (R9).** The
   target is derived from the clicked row: a file creates in its parent, a
   folder inside itself, and the root at the root.
5. **Edit-bar dropdowns — left separate for now (R12/R13).** `.eb-menu`,
   `.eb-table-menu`, and `.eb-list-menu` keep their own markup and wiring.
6. **Keyboard nav for sidebar/tab menus — yes (R4).** Every menu sets
   `role="menu"`, focuses the first enabled item on open, and supports
   Up/Down/Enter/Space/Esc.

Additional implementation decision: the hybrid **Save** item shows the real
`Mod+S` binding, rendered through `NB.shortcuts.format` (R11). No hint is
invented for delete, rename, new, or close, which have no binding.

---

## 0. One-line definition

Make every right-click context menu in the app one consistent surface: the
same item shapes, the same categories and separators, the same danger/disabled
rules, and the same keyboard behavior — so a command behaves and reads the
same wherever the owner right-clicks a file-like thing.

---

## 1. User goals

- **G1 — Predictable location.** The owner right-clicks a note in the tree, in
  the bookmark list, or on a tab, and the same file commands (Export, Rename /
  Move, Copy, Delete, bookmark) are in the same place in every menu.
- **G2 — Tab as a file.** A tab represents an open file; the owner expects the
  file commands it already sees in the tree, not only close/pin.
- **G3 — No dead ends.** An action that cannot run is either shown disabled
  with a reason, or absent because the surface does not support it — never a
  silent no-op.
- **G4 — Keyboard parity.** Each menu can be driven without a mouse and closes
  on Esc, matching the hybrid menu that already does this.

---

## 2. Scope

**Must-have (MVP).**

- A single canonical menu-item model (§4) covering plain, disabled, danger,
  separator, submenu, and keyboard-hint items.
- A single canonical category order and separator rule (§6, §7).
- Shared file-operation item group across the three file-like surfaces:
  tree file row, bookmark row, tab.
- One disabled-vs-omit rule.
- One keyboard behavior (role, focus, arrows, Esc, Enter) and one viewport
  clamping rule.
- Testable acceptance criteria (§7).

**Should-have.**

- A "Copy path" item on file-like surfaces; "Copy link" (the app already has
  deep links `?file=…&heading=…`).
- Reuse the same item model/styles for the edit-bar dropdown menus
  (`.eb-menu`, `.eb-table-menu`, `.eb-list-menu`), which are not right-click
  but duplicate the hybrid Table/List item sets.

**Out of scope / non-goals.**

- Changing what each command does (Open still opens, Delete still deletes).
- Redesigning menu visuals beyond what consistency requires (visual design is
  `ui-designer`'s job).
- New commands not already reachable somewhere, except the should-have
  clipboard items above, which are called out as open questions.
- The AI side panel, settings modal, and other non-right-click popovers.

**MVP line.** Ship the must-have set: one item model, one order/separator
rule, shared file ops on all three file-like surfaces, one disabled rule, one
keyboard behavior. The "Copy path"/edit-bar unification items follow.

---

## 3. Verified current inventory (baseline this spec changes)

Three right-click menus, all styled by the one `.context-menu` block. Each
reimplements positioning, close listeners, and its own `addMenuItem` with a
drifted signature.

### 3.1 `#context-menu` — `static/js/sidebar.js`

Helper `addMenuItem(label, handler, danger)` (`sidebar.js:637`); items are flat
`<button>`s and bare `<hr>` separators; no role, no keyboard navigation, no
disabled state.

**Tree file row** (`openMenu`, `sidebar.js:601-635`; `!isDir` branch):

| # | Item | Line |
|---|---|---|
| 1 | Open | 606 |
| 2 | New file beside… | 607 |
| 3 | New folder here… | 608 |
| — | separator | 609 |
| 4 | Export… | 610 |
| 5 | Rename / Move… | 611 |
| 6 | Copy… | 612 |
| 7 | Add bookmark / Remove bookmark (label flips) | 618-622 |
| — | separator (only if the tree has a folder) | 624 |
| 8 | Collapse all folders | 625 |
| — | separator | 627 |
| 9 | Delete (danger) | 628 |

**Tree folder row** (`openMenu`, `isDir` branch): New file here… (607),
New folder here… (608), separator, Rename / Move… (611), Copy… (612),
separator if dirs, Collapse all folders (625), separator, Delete (danger, 628).

> Correction to the work brief: the folder menu has **no** Add/Remove bookmark
> item. The bookmark toggle is guarded by `if (!isDir)` at `sidebar.js:618`.

**Bookmark row** (`openBookmarkMenu`, `sidebar.js:447-472`): Open (450),
separator (451), Remove bookmark (452), Export… (457), Rename / Move… (458),
Copy… (459), separator if dirs (461), Collapse all folders (462), separator
(464), Delete (danger, 465).

> Note (2026-10-17): the bookmark menu moved to `static/js/bookmarks.js` when
> the bookmark list became its own activity-bar view; the line references in
> this baseline section predate that and refer to `sidebar.js` as it was on
> 2026-10-13. Item shape and order are unchanged, except that a View-group
> "Show in file sidebar" item was later added so a bookmark can reveal its file
> in the Explorer tree (`NB.sidebar.revealFile`).

**Tree root / empty sidebar** (`openRootMenu`, `sidebar.js:664-678`): New file…
(667), New folder… (668), separator if dirs (670), Collapse all folders (671).

### 3.2 `#tab-context-menu` — `static/js/tabs.js`

Helper `addMenuItem(label, handler, opts)` with `opts = {danger, disabled}`
(`tabs.js:778-786`). `openMenu` (`tabs.js:752-776`):

| # | Item | State | Line |
|---|---|---|---|
| 1 | Pin / Unpin (label flips) | | 761 |
| 2 | Show in file sidebar | | 762 |
| 3 | Export… | | 765 |
| — | separator | | 768 |
| 4 | Close | danger | 769 |
| 5 | Close others | disabled when none | 770 |
| 6 | Close to the right | disabled when none | 771 |
| 7 | Close to the left | disabled when none | 772 |

### 3.3 `#hybrid-context-menu` — `static/js/hybrid.js`

Helper `addMenuItem(label, handler, danger, opts)` with `opts = {disabled,
title}` (`hybrid.js:4570-4586`), plus `addMenuSep` (4588), `addSubmenu` (4596),
and `addSubItem(…, hint)` which renders a right-aligned `<kbd>` (4620). This is
the only menu with separators-as-API, submenus, disabled-with-reason, keyboard
hints, `role="menu"`, first-item focus (5725-5727), and viewport-anchored
keyboard open (5708-5721). `buildMenu` (`hybrid.js:5540-5672`):

- **Clipboard:** Copy, Paste, Paste without formatting (top level).
- **Inline ▸** Bold, Italic, Strikethrough, Inline code, Clear formatting.
- **Heading ▸** Heading 1–6.
- **List ▸** Bulleted list, Numbered list, Task list, Quote; plus, only with
  the caret in a list, a separator and Move item up (`Alt+Up`), Move item down
  (`Alt+Down`).
- **Table ▸** only when the right-click lands inside a table
  (`buildTableMenu`, `hybrid.js:4910-4928`): Move row up (`Alt+Up`), Move row
  down (`Alt+Down`), Move column left (`Alt+Shift+Left`), Move column right
  (`Alt+Shift+Right`), Align column (cycle), Insert row above/below, Delete
  row, Insert column left/right, Delete column, Toggle header row, Delete
  table.
- **Block edit** only when the click lands on a fenced block: separator, then
  Design diagram… (disabled with a reason for a render-only type,
  `hybrid.js:5611-5614`), then `Edit <plugin.name> source` — e.g. "Edit
  mermaid source", "Edit WaveDrom source", "Edit math source", "Edit Graphviz
  source", "Edit HTML preview source" — or "Edit code block" for plain fences
  (5619-5623).
- **Insert ▸** Link…, Image…, Code block, Table, Horizontal rule.
- **History ▸** Undo, Redo.
- **Save** (top level).

### 3.4 Related but not right-click (out of scope)

Edit-bar overflow dropdowns: `.eb-menu` (index.html:205, Horizontal rule / H5 /
H6 / Clear formatting), `.eb-table-menu` (index.html:182, the same 14 table
operations as the hybrid Table submenu), `.eb-list-menu` (index.html:162, Move
item up/down). These duplicate hybrid submenu item sets but are not
right-click surfaces.

### 3.5 Drift observed across the three menus

1. **Helper signatures.** `(label, handler, danger)` vs
   `(label, handler, {danger, disabled})` vs
   `(label, handler, danger, {disabled, title})`.
2. **Positioning.** Sidebar clamps width at a hard-coded 190
   (`sidebar.js:631,674`); tabs and hybrid at 200 (`tabs.js:789`,
   `hybrid.js:5718`). None clamps the left or top edge; all only clamp
   right/bottom.
3. **Keyboard/A11y.** Only hybrid sets `role="menu"`, focuses the first item,
   and anchors a keyboard-triggered open. Sidebar and tab menus have no role,
   no arrow-key walk, no Esc close.
4. **Disabled handling.** Tabs disable inapplicable close variants; sidebar
   omits "Collapse all folders" entirely when there is no folder.
5. **Ordering/separators.** Bookmark puts an `<hr>` after "Open" and groups
   "Remove bookmark" with the file ops; tree row puts no `<hr>` after "Open"
   and groups it with the New items.
6. **Wording.** "New file beside…" (tree file) vs "New file here…" (folder) vs
   "New file…" (root).
7. **Danger.** Delete (sidebar) and Close (tabs) carry `.danger`; hybrid has no
   danger item.

The disabled style (`.context-menu button:disabled`, `style.css:1336-1337`)
and the keyboard-hint style (`kbd.context-menu-kbd`, `style.css:1165-1173`)
already exist and are reused; only the behavior and structure need unifying.

---

## 4. Canonical menu-item model

Six item shapes. Every menu must be built only from these; no menu may add a
seventh shape ad hoc.

| Shape | Behavior | Required data |
|---|---|---|
| **Plain item** | Activates its command and closes the menu. | label, handler |
| **Disabled item** | Visibly present, not focusable/activatable, exposes *why*. | label, reason (title + `aria-disabled="true"`) |
| **Danger item** | A plain item whose command is destructive; rendered with the `.danger` class. | label, handler |
| **Separator** | Non-interactive rule between categories. | — |
| **Submenu / flyout** | A parent row with a `▸` marker that reveals a nested menu on hover and on click (touch). Nested items may be any shape except another submenu (one level deep). | label, build function |
| **Keyboard-shortcut hint** | A right-aligned `<kbd>` on a plain item, showing the real chord for the same command. | label, handler, chord |

**Which menus need which shapes:**

| Shape | Sidebar menus | Tab menu | Hybrid menu |
|---|---|---|---|
| Plain | yes | yes | yes |
| Disabled | should | yes (close variants) | yes (Design diagram…) |
| Danger | yes (Delete) | yes (Close) | model supports it; none today |
| Separator | yes | yes | yes |
| Submenu | no (keep flat) | no (keep flat) | yes |
| Hint | should (where a chord exists) | should (where a chord exists) | yes |

A hint must never be shown for a command that has no actual binding. Today the
only real bindings are `save` (`Mod+S`) and the hybrid move chords; there is
no binding for delete, rename, new file, or close tab
(`static/js/shortcuts.js`). Do not invent one to fill a hint.

---

## 5. Item taxonomy — universal, surface-specific, format-specific

### 5.1 Universal file-operation group (all three file-like surfaces)

These apply to any single `.md` file, whether referenced by a tree row, a
bookmark, or a tab, and must be the same item, same label, same category:

- **Open**
- **Export…**
- **Rename / Move…**
- **Copy…**
- **Add bookmark / Remove bookmark** (label flips)
- **Delete** (danger)

Today only the tree row and the bookmark row have the full set. The tab menu is
missing Rename / Move…, Copy…, Delete, and the bookmark toggle.

### 5.2 Surface-specific groups

- **Creation** — tree file ("New file…", "New folder…" targeting the file's
  parent), tree folder ("New file…", "New folder…" inside the folder), root
  ("New file…", "New folder…" at the notebook root). Bookmarks and tabs do not
  create files.
- **Tab lifecycle** — Pin / Unpin, Show in file sidebar, Close, Close others,
  Close to the right, Close to the left. Tab only; these close-semantics do not
  apply to a tree row or bookmark.
- **Sidebar view** — Collapse all folders. Tree/folder/root only (see §6,
  rec SHOULD-1).
- **Hybrid clipboard, formatting, table, list, insert, history, block edit,
  save** — hybrid only (format-specific).

### 5.3 Format-specific group (hybrid only)

Clipboard, Inline, Heading, List, Table, Insert, History submenus, the
context-sensitive block-edit items, and Save. These depend on the caret,
selection, or the clicked block and have no meaning outside the editor.

### 5.4 Groups that should be shared (summary)

- **File operations (§5.1):** tree file ↔ bookmark ↔ tab.
- **Bookmark toggle:** tree file ↔ bookmark; add to tab.
- **Creation (§5.2):** tree file ↔ tree folder ↔ root, with one label set.
- **Collapse all folders:** tree file ↔ tree folder ↔ root; remove from
  bookmark.

### 5.5 Currently missing or inconsistently placed

- Tab menu is missing every file operation except Export….
- "Collapse all folders" is on the bookmark menu, where it does not belong.
- The bookmark menu groups "Remove bookmark" with file ops and separates it
  from "Open" differently than the tree row does.
- Creation labels drift three ways.
- Tabs use disabled items; the sidebar omits items; there is no stated rule.

---

## 6. Recommendations

Each item is marked **MUST**, **SHOULD**, or **COULD**. MUST items are the
MVP line and are covered by the acceptance criteria in §7.

### Structure

- **MUST R1 — One item model.** Build every menu from the six shapes in §4
  through one shared menu behavior. A menu may not reimplement activation,
  close, positioning, or item rendering.
  *(Behavior only; the mechanism — a shared module vs a shared helper — is
  `architect`'s decision.)*

- **MUST R2 — One canonical category order.** Every menu presents its items in
  this fixed category order, with a separator between each pair of adjacent
  non-empty categories:

  | Order | Category | Items |
  |---|---|---|
  | 1 | Open | Open |
  | 2 | Create | New file…, New folder… |
  | 3 | Organize | Pin / Unpin, Export…, Rename / Move…, Copy…, Add/Remove bookmark |
  | 4 | View | Show in file sidebar, Collapse all folders |
  | 5 | Terminal | Close, Close others, Close to the right, Close to the left; Delete (danger) |

  A surface shows only the categories it supports; empty categories collapse
  and contribute no separator. Under this order the tab menu keeps Pin / Unpin
  first (it has no Create category), and the tree row keeps Open first followed
  by Create.

- **MUST R3 — One disabled-vs-omit rule.** Show an item **disabled with a
  reason** when the command belongs to the menu's fixed set but is temporarily
  inapplicable (e.g. "Close others" with one tab, "Design diagram…" for a
  render-only type). **Omit** the item when the surface itself does not support
  it (e.g. bookmark toggle on a folder, Delete on the root menu). Never
  render a silent no-op.

- **MUST R4 — One keyboard behavior.** Every menu sets `role="menu"`, focuses
  the first enabled item on open, walks items with Up/Down (skipping disabled
  items and submenu parents acting as headings), enters a submenu with
  Right / Enter and leaves with Left / Esc, activates with Enter/Space, and
  closes on Esc or outside click. This matches hybrid today and brings the
  sidebar and tab menus up to it.

- **MUST R5 — One positioning rule.** Anchor at the pointer, clamp on all four
  viewport edges (left, top, right, bottom) using the menu's measured size and
  a single named margin. The current hard-coded 190/200 widths and
  right/bottom-only clamping are replaced by the measured clamp.

### Sharing

- **MUST R6 — File ops on the tab menu.** Add Export…'s siblings to the tab
  menu in the Organize category: Rename / Move…, Copy…, Delete (danger), and
  Add bookmark / Remove bookmark. This is the core consistency request.

- **MUST R7 — Delete is danger; Close is danger.** Destructive/terminal items
  keep the `.danger` class on every surface.

- **SHOULD R8 — Remove "Collapse all folders" from the bookmark menu.**
  A bookmark references a file; hiding the tree is a sidebar action, not a
  file action. Keep it on the tree file, folder, and root menus, where it
  already lives.

- **SHOULD R9 — One creation label set.** Use "New file…" and "New folder…" on
  all creation surfaces. Drop "here…"/"beside…" wording, or keep the
  directional sense in a shared way (e.g. "New file…" everywhere, with the
  target derived from the clicked row). Pick one set; today the three
  variants are the drift.

- **SHOULD R10 — Copy path / Copy link.** Add "Copy path" (the note's
  notebook-relative path) and, given the existing deep-link format, "Copy
  link" to the file-like surfaces. Confirm placement in the open questions.

- **SHOULD R11 — Hints only where a binding exists.** Add the right-aligned
  `<kbd>` hint to any item whose command has a real chord today (hybrid Save →
  `Mod+S`, hybrid move items). Do not add hints for delete, rename, new file,
  or close tab, which have no binding.

### Related menus

- **COULD R12 — Adopt the item model for edit-bar dropdowns.** `.eb-menu`,
  `.eb-table-menu`, and `.eb-list-menu` render the same operations as the
  hybrid submenus (Table 14 ops, List move up/down). Reuse the shared item
  model and styles there too, without changing their non-right-click trigger.
- **COULD R13 — Single source for the Table/List item sets.** The hybrid Table
  submenu and `.eb-table-menu` list the same 14 operations; the hybrid List
  submenu and `.eb-list-menu` list the same 2. Define each set once.
- **COULD R14 — Duplicate tab / Open in new tab**, if the owner wants a tab
  copy affordance. Not present today; not required for consistency.

---

## 7. Acceptance criteria

A QA engineer can turn each into a check. "File-like surface" means tree file
row, bookmark row, and tab.

**Item model and rendering**

1. Every item in every context menu is one of: plain, disabled,
   danger, separator, submenu parent, or hint-bearing plain item. No menu item
   renders outside this set.
2. Opening any menu, closing on outside click / Esc, positioning, and item
   activation all behave identically across the sidebar, tab, and hybrid menus
   for the shapes they share.

**Shared file operations**

3. On the tree file row, the bookmark row, and the tab, the Organize category
   contains the same items in the same order: (Pin / Unpin where supported),
   Export…, Rename / Move…, Copy…, Add bookmark / Remove bookmark.
4. On the tab menu, Rename / Move…, Copy…, Delete, and Add/Remove bookmark are
   present and invoke the same actions the tree row and bookmark row invoke for
   the same path.
5. The bookmark label reads "Add bookmark" when the file is not bookmarked and
   "Remove bookmark" when it is, on every surface that shows it.

**Ordering and grouping**

6. For each menu, items appear in the §6 R2 category order, and a separator
   appears between every pair of adjacent non-empty categories.
7. Empty categories produce no item and no separator (for example, the root
   menu shows no separator directly above "Collapse all folders" when there is
   no New group above it beyond the two creation items already separated).
8. The tree folder menu does not contain an Add/Remove bookmark item.
9. The bookmark menu does not contain "Collapse all folders" (R8).

**Disabled and omit rules**

10. An item that belongs to the menu but is temporarily inapplicable is
    rendered disabled, has `aria-disabled="true"`, carries a non-empty reason
    on `title`, receives focus skip in arrow navigation, and does not invoke
    its command when clicked.
11. "Close others" is disabled when the file has no non-pinned siblings;
    "Close to the right" when none lie to its right; "Close to the left" when
    none lie to its left.
12. An item whose capability the surface does not have is absent, not
    disabled (bookmark toggle on a folder; Delete on the root menu).

**Danger**

13. "Delete" on every file-like surface carries the `.danger` class.
14. "Close" on the tab menu carries the `.danger` class.

**Keyboard**

15. Opening any menu focuses its first enabled item.
16. Up/Down move focus through enabled items, skipping disabled ones, and wrap
    or stop at the ends consistently across all menus.
17. Right / Enter on a submenu parent opens its flyout; Left / Esc closes it.
18. Enter or Space activates the focused item and closes the menu; Esc closes
    the menu without activating anything.

**Hints**

19. A keyboard hint is shown on an item only when that command has a real
    binding; the hint text equals the binding rendered by the shortcut
    formatter, and follows the body theme.
20. The hybrid Save item shows `Mod+S` (rendered `Ctrl+S` / `Cmd+S`).

**Positioning**

21. A menu opened near the right or bottom edge is fully visible: its right and
    bottom edges stay inside the viewport.
22. A menu opened near the left or top edge is fully visible: its left and top
    edges stay inside the viewport (current menus clamp only right/bottom).
23. Menu width is measured, not assumed; the two different hard-coded widths
    (190 vs 200) no longer exist.

**Regression**

24. Existing item counts and labels for commands not named in this spec are
    unchanged unless a MUST/SHOULD recommendation above changes them.

---

## 8. Open questions

All six below were resolved by the implementation — see the **Decisions** note
at the top. They are kept here for the record.

1. **Tab file ops.** Confirm that the tab menu should carry Rename / Move…,
   Copy…, Delete, and the bookmark toggle (R6). This is the largest visible
   change.
2. **Collapse all folders.** Remove it from the bookmark menu (R8), or keep it
   for reach and accept the inconsistency?
3. **Copy path / Copy link.** Add both (R10), one, or neither? "Copy link"
   presumes the owner wants to paste note deep links elsewhere.
4. **Creation labels.** Prefer "New file…" everywhere (R9), or keep the
   "here…/beside…" directional wording and standardize that instead?
5. **Edit-bar dropdowns.** Unify them under the same item model now (R12) or
   leave them separate and revisit?
6. **Keyboard nav for sidebar/tab menus.** R4 adds arrow-key navigation and Esc
   close to the sidebar and tab menus, which do not have it today. Confirm this
   behavior change is wanted, not just a visual unification.
