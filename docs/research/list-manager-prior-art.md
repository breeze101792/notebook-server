# List-manager modal: prior art and established interaction patterns

Research date: 2026-11-21. Scope: sourced facts only, no feature design.

Project grounding: the editor is CodeMirror 6 — `@codemirror/commands` 6.10.4,
`@codemirror/state` 6.7.1 (`package-lock.json`), history extension wired in
`static/vendor/codemirror.entry.js:7`, editor bridge in `static/js/cm-bridge.js`.
Any bulk list edit becomes one CM6 transaction, so CM6's own undo rules apply
(see §6).

Each finding is tagged **[Observed]** (read directly in the source cited) or
**[Inferred]** (my conclusion from what was read).

---

## 1. Markdown / WYSIWYG note editors

### Obsidian

1. **[Observed]** Obsidian has built-in commands to move a list item up or down,
   and since 1.15 (released 2026-11-02) "With **Smart lists** turned on,
   indenting, unindenting, or moving a list item up or down now also moves the
   items nested under it." — `https://obsidian.md/changelog/`, release 1.15
   entry (2026-11-02).
2. **[Observed]** The setting is documented as "**Smart lists** — Automatically
   set indentation and place list items correctly." — `en/User interface/Settings.md:149`,
   `https://github.com/obsidianmd/obsidian-help` (mirror of `help.obsidian.md`).
3. **[Observed]** Obsidian's editor has **no list-item multi-select**. Its
   documented multi-target editing is *multiple cursors*: "You can add
   additional cursors by holding `Alt` (or `Option` on macOS) and selecting
   another position", plus `Shift+Alt`-drag rectangular selection —
   `en/Editing and formatting/Multiple cursors.md`.
4. **[Observed]** Item-style multi-select is documented only on file-management
   surfaces, not in the editor: File explorer "`Alt-Click` … or `Shift-Click`"
   (`en/Plugins/File explorer.md:94`), Bookmarks "`Alt` … or `Shift`"
   (`en/Plugins/Bookmarks.md:121`), Sync version history bulk restore
   (`en/Obsidian Sync/Version history.md:127`).
5. **[Observed]** Obsidian core documents sorting for: File explorer
   (`en/Plugins/File explorer.md:44`), Search results
   (`en/Plugins/Search.md:113`), Backlinks (`en/Plugins/Backlinks.md:35`), Tags
   view (`en/Plugins/Tags view.md:14`), Properties view
   (`en/Plugins/Properties view.md:18`), Bases (`en/Bases/Views.md:87`), and
   table columns via right-click in Live Preview
   (`en/Editing and formatting/Advanced formatting syntax.md:26`).
6. **[Inferred]** There is no core command to sort a Markdown list; none of the
   above covers list items, and sorting of lists ships as third-party plugins.
7. **[Observed]** Community plugin **Alpha Bullet** sorts unordered lists with
   natural order, ascending/descending, optional grouping under headings; its
   README documents no behaviour for nested sub-items —
   `https://github.com/Mara-Li/obsidian-alpha-bullet` (README, read 2026-11-21).

### Logseq

8. **[Observed]** Logseq **does** support multi-block selection, with web-style
   modifiers: "mod+click support deselect if it's on an selected block",
   "support mod+shift+click", plus shift-click range anchoring — PR #10745
   "Enhance block selection", merged 2023-12-26,
   `https://github.com/logseq/logseq/pull/10745`.
9. **[Observed]** Logseq's own docs document sorting for **query tables**
   ("Results are sorted by clicking on a column header") —
   `pages/Query table.md:9`, `https://github.com/logseq/docs`.
10. **[Inferred]** Logseq has no core command that sorts the children of a page
    or block; block sorting exists only in plugins (next finding).
11. **[Observed]** Third-party `logseq-plugin-vim-shortcuts` provides `/Sort
    Blocks` and `/Reverse Sort Blocks`: "No block focused: Sorts page's
    top-level blocks. Block focused: Sorts that block's children." —
    `https://github.com/vipzhicheng/logseq-plugin-vim-shortcuts` README
    (read 2026-11-21).

### Notion

12. **[Observed]** Block multi-select: "Click and drag from the left or right
    page margin to select an entire block of content, or multiple blocks at a
    time"; `Esc` selects the whole block; blocks are moved with the `⋮⋮` handle
    and blue guides ("A good way to nest bullets and to-do's") —
    `https://www.notion.com/help/writing-and-editing-basics` (read 2026-11-21).
13. **[Observed]** Sorting exists only as a **database view** setting: "Sort by
    a property to change the order that pages are displayed in"; multiple sorts
    are reordered by dragging — `https://www.notion.com/help/views-filters-and-sorts`.
14. **[Inferred]** Notion page lists (bulleted/numbered/to-do blocks) have no
    sort command; ordering is manual drag only.

### Typora

15. **[Observed]** Typora's official shortcut reference lists list operations
    only as Ordered/Unordered List and Indent/Outdent (`Ctrl+[` / Tab,
    `Ctrl+]` / Shift+Tab). No move-item-up/down, no sort, no multi-select of
    list items appears in that table —
    `https://support.typora.io/Shortcut-Keys/` (updated 2026-10-31).
16. **[Inferred]** Typora has no item-level multi-select; text selection is the
    only selection model. (Menu-only commands beyond the shortcut table were not
    verified.)

### Craft

17. **[Observed]** Craft supports block multi-select — "Select the blocks you
    want to group (click and drag, or Cmd+click multiple blocks)"; selection can
    be cut/pasted or dragged, including between documents; on iOS "swipe right on
    blocks to select them (or use long-press for multi-select)" —
    `https://support.craft.do/en/write-and-edit/blocks-and-pages` (read 2026-11-21).
18. **[Inferred]** Craft documents no list sort and no completed-to-bottom
    command; ordering is manual drag only.

### VS Code

19. **[Observed]** VS Code's built-in Markdown support documents one list-aware
    selection feature, **Smart selection** (expand/shrink with
    `Ctrl+Shift+Cmd+→` / `Shift+Alt+Right`), which follows a hierarchical
    pattern over Headers, Lists, Block quotes, code blocks, Paragraphs. No
    reorder, sort, or multi-select of list items is documented —
    `https://code.visualstudio.com/docs/languages/markdown` (page dated
    2026-11-18).
20. **[Observed]** The built-in *Sort Lines Ascending* command
    (`editor.action.sortLinesAscending`) is a plain text-line sort over the
    selected lines or the whole document; it has no list-structure awareness —
    `src/vs/editor/contrib/linesOperations/browser/linesOperations.ts:239-285`,
    `https://github.com/microsoft/vscode`.
21. **[Observed]** The common Markdown extension **Markdown All in One**
    documents its "List editing" as Enter-continuation, Tab/Shift+Tab indent,
    and fixing ordered-list markers; it exposes no sort command —
    `https://github.com/yzhang-gh/vscode-markdown` README (read 2026-11-21).

---

## 2. Task managers

### Todoist

22. **[Observed]** Selection: "Hold `Cmd/Ctrl` and click each task you want to
    select. To select a range, hold `Shift` and click the first and last task."
    On mobile: "Select Tasks" mode, "Select All"; a multi-select toolbar appears
    at the bottom. Reorder: "Drag these tasks to their new position", web and
    desktop only —
    `https://help.todoist.com/help/todoist/features/add-or-manage-multiple-tasks-in-todoist-PcPoskdUp`
    (last updated 2026-11-06).
23. **[Observed]** Sort options: Manual, Name, Date, Date added, Deadline,
    Priority; groupings: Date, Date added, Deadline, Priority, Label. "If a
    grouping option is applied to a project or view, you can't drag or manually
    reorder your tasks." —
    `https://help.todoist.com/help/todoist/features/sort-or-group-tasks-in-todoist-WFWD0hrb`
    (last updated 2026-11-19).

### Things 3 (Cultured Code)

24. **[Observed]** Multi-select: "When you're in selection-mode, just swipe your
    finger up or down the circles on the right to select a whole group." Reorder:
    "When you have a multi-selected group, just tap and hold. The to-dos will
    gather under your finger and you can drag them wherever you want." —
    `https://culturedcode.com/things/features/` (read 2026-11-21).
25. **[Not established]** Whether Things exposes an automatic sort option. Its
    support index lists no sorting article
    (`https://culturedcode.com/things/support/`), and search engines were
    unavailable for a targeted check. No claim made.

### TickTick

26. **[Observed]** Multi-select: "Go to the list details page, click the '...'
    in the top right corner and select 'Select,' or long-press a task to
    multi-select." —
    `https://help.ticktick.com/articles/7055782219767349248` (read 2026-11-21).
27. **[Observed]** Sorting is "Group & Sort" (desktop: Sort button top-right;
    mobile: "..." → Group & Sort). Sorting options documented: Date, Priority,
    Created Time, Modified Time, with Newest/Oldest direction and a "Restore
    default date order" action —
    `https://help.ticktick.com/articles/7056594711640801280` (article modified
    2026-11-05).

### Apple Reminders

28. **[Observed]** Sort: "Choose View > Sort By, then choose a sort option (Due
    Date, Creation Date, Priority, or Title)", with per-option directions, or
    "sort lists manually by dragging them into the order you want". Dragging a
    reminder in an auto-sorted list "changes [the sort option] to Manual" —
    `https://support.apple.com/guide/reminders/sort-reminders-in-lists-remn922d0b42/mac`
    (macOS 27 guide, © 2026).
29. **[Observed]** Multi-select exists for bulk actions: "Multiple reminders:
    Select the reminders, then select Mark Complete next to one of the
    reminders." —
    `https://support.apple.com/guide/reminders/mark-reminders-complete-or-incomplete-remndbeda47c/mac`.

### Microsoft To Do

30. **[Not established]** Multi-select mechanics and the sort list could not be
    confirmed from a primary Microsoft page. `support.microsoft.com` has no
    sitemap and its search results are client-rendered; the search engines
    behind the private SearXNG instance (Brave, DuckDuckGo, Google CSE) were
    rate-limited or captcha-gated throughout this session. What would settle it:
    the "Sort tasks" / "Select tasks" articles under
    `support.microsoft.com/en-us/office/…` for Microsoft To Do, or the in-app
    Help links. No claim made.

---

## 3. Multi-select conventions and accessibility requirements (web)

31. **[Observed]** WAI-ARIA APG **Listbox Pattern** defines multi-select with
    `aria-multiselectable="true"` on the `listbox` and `aria-selected` on each
    `option`. Recommended (modifier-free) selection keys: `Space` toggles the
    focused option; `Shift+Down`/`Shift+Up` move focus and toggle; `Shift+Space`
    selects the contiguous range from the last selected item; `Ctrl+Shift+Home`
    / `Ctrl+Shift+End` extend to the ends; `Ctrl+A` selects all (optional, may
    toggle off) —
    `https://www.w3.org/WAI/ARIA/apg/patterns/listbox/` (read 2026-11-21).
32. **[Observed]** Navigation keys in the same pattern: `Down`/`Up` move focus,
    `Home`/`End` (strongly recommended for lists > 5 options), type-ahead
    recommended for lists > 7 options. On focus, a multi-select listbox puts
    focus on the first selected option without changing selection —
    same URL, "Keyboard Interaction".
33. **[Observed]** Focus technique in the APG examples: `tabindex="0"` on the
    `listbox` element with `aria-activedescendant` tracking the visually focused
    option, so DOM focus stays on the listbox and the widget is a single tab
    stop. The pattern explicitly notes `aria-activedescendant` as the
    alternative to moving DOM focus among options —
    `https://www.w3.org/WAI/ARIA/apg/patterns/listbox/examples/listbox-rearrangeable/`
    (page updated 2025-08-12) and the pattern's Note 2.
34. **[Observed]** APG warns that a `listbox` "does not provide an accessible way
    to present a list of interactive elements, such as links, buttons, or
    checkboxes"; for interactive content it points to the **Grid pattern** —
    `https://www.w3.org/WAI/ARIA/apg/patterns/listbox/`, "About This Pattern".
35. **[Observed]** APG ships a **rearrangeable multi-select listbox** example
    with a toolbar: `Up` / `Down` buttons with `Alt+Up Arrow` / `Alt+Down
    Arrow`, announced via `aria-keyshortcuts`; after a move, focus stays on the
    moved option "enabling all keyboard users to easily perform consecutive move
    operations"; a live region confirms the action. The example also states it
    deliberately uses the modifier-free multi-select model, which "differs from
    the behavior provided by browsers for native HTML `<select multiple>`" —
    same example URL.
36. **[Observed]** The shift-click-range / ctrl-click-toggle convention is what
    shipping apps document, not just the APG: Todoist (§22), Logseq (§8),
    Obsidian file explorer (§4), Apple Reminders ("Select the reminders").
    A "Select All" affordance is documented in Todoist (§22) and optional in
    APG via `Ctrl+A` (§31).
37. **[Not established]** No source read documents drag-to-range selection
    (sweeping a rectangle across list items) in a web list widget. Obsidian's
    rectangular selection is over text (multiple cursors), Craft's and Notion's
    drag-select is over blocks by margin drag, not a list-range sweep.

---

## 4. Sorting in outline / tree editors: what happens to children

38. **[Observed]** Emacs Org mode, `org-sort-list` docstring: "Sort list items.
    … **Sublists are not sorted.** Checkboxes, if any, are ignored." For
    alphabetical sorting "Only the first line of item is checked." —
    `lisp/org/org-list.el`, `org-sort-list`, read from
    `https://raw.githubusercontent.com/emacs-mirror/emacs/master/lisp/org/org-list.el`
    (master, 2026-11-21). Manual entry point: `C-c ^` "Sort the plain list" —
    `https://orgmode.org/manual/Plain-Lists.html`.
39. **[Observed]** Todoist sorts **recursively**: "When you apply a sorting
    option to a project, it applies to both tasks and sub-tasks … sorting by
    name also puts each parent task's sub-tasks in alphabetical order." The
    stored manual order is not overwritten: "The task view always shows sub-tasks
    in their manual order, and sorting doesn't change that saved order." —
    §23 URL (2026-11-19).
40. **[Observed]** Logseq's `/Sort Blocks` sorts exactly one level and moves
    blocks as siblings: it reads `block.children` (or the page's top-level
    blocks) and calls `logseq.Editor.moveBlock(a.uuid, b.uuid, {before: false,
    children: false})`; it refuses to run with more than one block selected
    ("Please select only one block!") —
    `src/commands/sort.ts` and `src/keybindings/sort.ts`,
    `https://github.com/vipzhicheng/logseq-plugin-vim-shortcuts`.
41. **[Inferred]** Because `moveBlock` relocates the whole block entity, a
    sorted parent keeps its own children; only the sibling level is reordered.
42. **[Observed]** Obsidian's move-list-item commands move the nested items with
    the item (since 1.15, with Smart lists on) — §1. That is a *move*, not a
    sort, but it establishes that "children travel with the parent" is the
    expected behaviour in a Markdown list editor.
43. **[Observed]** Apple Reminders avoids the question: sorting is a view mode
    over the list, and a manual drag silently switches the list to Manual order —
    §28. **[Inferred]** No item data is rewritten by a sort.
44. **[Observed]** Notion and Obsidian offer no list sort at all (§6, §14), so
    there is no documented child rule for them. Alpha Bullet documents sorting
    flat lists and says nothing about nested items (§7).
45. **[Inferred]** Convergence across the four implementations that do sort:
    either one level only with children attached (Org, Logseq plugin) or full
    recursion with children attached (Todoist). No implementation read detaches
    children from their parent or leaves children in place while the parent
    moves.

---

## 5. Moving completed items ("archive / done to bottom")

46. **[Observed]** Todoist: completed tasks are "removed from the active task
    list". With the **Completed tasks** display option on, they "appear at the
    bottom of a section's or parent task's active task list" — per section and
    per parent task, not once at the end of the whole list —
    `https://help.todoist.com/help/todoist/features/view-completed-tasks-in-todoist-J19h2s`
    (last updated 2026-11-20).
47. **[Observed]** Apple Reminders: "The reminder is saved, but it's hidden in
    the list. You can scroll to the top of a list to see its completed
    reminders"; a completed repeating reminder "moves to the completed section of
    the list" — §29 URL.
48. **[Observed]** Logseq keeps `DONE` blocks where they are: the docs show
    `DONE watch Doctor Who` rendered in place among the workflow examples, with
    no archive or move-to-bottom action documented —
    `pages/Tasks.md:17`, `https://github.com/logseq/docs`.
49. **[Not established]** No tool read documents a user-invoked command that
    *moves* completed items to the bottom of the same list. The documented
    patterns are: hide them (Apple, Todoist default), render them in a separate
    "completed" section (Apple, Todoist when enabled), or leave them in place
    (Logseq). Checked: Obsidian, Logseq, Notion, Craft, VS Code, Typora, Todoist,
    Apple Reminders, TickTick, Things.
50. **[Not established]** What a move-to-bottom would do to the moved item's
    subtree, and how the remaining items would be re-sequenced. No source read
    specifies this, because no source read implements the operation. The closest
    documented analogue is Todoist's per-parent completed section (§46), which
    keeps a completed parent's completed sub-tasks with that parent.

---

## 6. Undo semantics for bulk operations

51. **[Observed]** CodeMirror 6 groups undo events by *transaction*, not by
    individual change. Two adjacent transactions are merged into one undo event
    only if they are within `newGroupDelay` (default **500 ms**) **and** touch an
    already-changed range; `joinToEvent` can override that. `isolateHistory`
    annotation (`"before"`, `"after"`, `"full"`) "will prevent that transaction
    from being combined with other transactions in the undo history";
    `Transaction.addToHistory` set to `false` keeps a transaction out of history
    entirely — `@codemirror/commands` `src/history.ts` (lines 8-14, 33-37,
    60-100), `https://github.com/codemirror/commands`; annotation declaration in
    `@codemirror/state/src/transaction.ts:279-281`.
52. **[Observed]** ProseMirror's history plugin works the same way and documents
    the escape hatch: transforms in quick succession are grouped into one event,
    and `closeHistory(tr)` "will prevent further steps from being appended to an
    existing history event (so that they require a separate undo command to
    undo)" — `prosemirror-history/src/history.ts:259-310, 363-368`,
    `https://github.com/ProseMirror/prosemirror-history`.
53. **[Observed]** Logseq's undo doc scopes undo to "Block operations … such as
    creating, editing, indenting, and deleting blocks" and offers a global vs
    page-only undo mode; it does not state how bulk commands are grouped —
    `pages/Undo and Redo.md`, `https://github.com/logseq/docs`.
54. **[Inferred]** For this project: because the editor is CM6 with
    `@codemirror/commands` 6.10.4 (§project grounding), a sort/reorder performed
    as **one transaction containing all changes** is one undo step with no extra
    work; a loop of 40 separate dispatches would be grouped only if they fall
    inside the 500 ms window and touch changed ranges, so `isolateHistory`
    `"before"`/`"after"` around the bulk edit is the documented way to force a
    clean boundary.
55. **[Not established]** No source read documents a DOM-snapshot or
    "command pattern" undo for list reordering; the documented mechanisms in the
    tools read are transaction/step based (CM6, ProseMirror).

---

## Open items and what would settle them

- **Microsoft To Do** (multi-select keys, sort options, completed handling): the
  official support articles could not be reached; search backends were
  unavailable. §30.
- **Things 3 automatic sort** and its completed/Logbook behaviour: no support
  article found in its index. A support-article URL or the app's Help menu would
  settle it. §25.
- **Typora / Craft / Notion menu-only commands** beyond their docs: the absence
  claims in §16, §18, §14 are inferences from the documentation, not from
  exhaustive menu inspection.
- **Move-completed-to-bottom with subtrees**: no implementation found, so there
  is no precedent to cite for subtree or re-sequencing behaviour. §49, §50.
- **Drag-to-range selection** in a web list: no documented pattern found. §37.
