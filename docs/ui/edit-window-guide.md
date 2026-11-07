# Edit window — build guide for the unified shell

Status: **shipped**. This is the procedure. The measured spec is
[`edit-window.md`](edit-window.md); the visual reference is
[`edit-window-mockup.html`](edit-window-mockup.html) — look, not markup: it predates the
shipped class names and still shows a `+` slot, an `…` menu and fixed 1280 / 720 stages.
Numbers live in the spec, rules here.

## 1. When this applies

| Applies | Does not apply |
| --- | --- |
| Any modal hybrid-mode edit window with an **Apply**: table editor (`#table-editor-overlay`), Mermaid designer (`#designer-overlay`), Graphviz / WaveDrom designer (`#dw-designer-overlay`), and every future one. | The inline fence editor (no modal, no Apply). |
| Windows whose body owns a model that is serialized and applied into the note. | View-only lightboxes. |
| Windows that need document history. | Settings, export, auth dialogs (Save, not Apply). |

Body + Apply + history means this shell — never a fourth tool surface.

## 2. Anatomy

```
┌──────────────────────────────────────────────────────────────┐
│ title  badge?                            max   close         │ header
├──────────────────────────────────────────────────────────────┤
│ [ window actions — one scrolling line ] │ undo redo          │ bar
├──────────────────────────────────────────────────────────────┤
│                        body (per-window)                     │
├──────────────────────────────────────────────────────────────┤
│ status                                  Cancel    Apply      │ footer
└──────────────────────────────────────────────────────────────┘
```

**One shell. The body is the only per-window region.** Markup order is
`header → .edit-bar → body → .edit-footer`; the bar is a sibling of the body.

## 3. Contracts

### 3.1 Header

| Rule | Detail |
| --- | --- |
| Order | `[title][badge] … [maximize][close]`. No seam between them. |
| Badge | `.edit-badge` from the block type; collapses when empty. |
| History | None in the header. |
| Last control | Close stays the final `<button>`. `windows.js` inserts maximize before the last button and wraps both in `.settings-header-actions`; a trailing control breaks that. |
| Controls | 44 px targets, focus ring, accessible name. |

### 3.2 Action bar

| Slot | Contract |
| --- | --- |
| Slot | `.edit-bar-actions`, `flex: 1 1 auto`, horizontal scroll, no role of its own. The window's inner `.edit-bar-toolbar` carries `role="toolbar"` and its own `aria-label`; each group is `role="group"` + `aria-label`. Window actions only — no title, Cancel/Apply, or undo/redo. One line, items `flex: 0 0 auto`. |
| Seam | `.edit-bar-seam`, `aria-hidden`, last child of `.edit-bar-history`; separates document history from the window actions. |
| History | `.edit-bar-history`, `role="group" aria-label="History"`, holds the pinned `.edit-bar-btn` pair `#<prefix>-undo` / `-redo`; icon-only, 44 px, `aria-label` + `title` with the chord. Never scrolls. |
| Future action | Design reservation only — nothing is rendered. A new per-window control goes into the actions slot. No `+` placeholder. |
| Overflow | `.edit-bar-actions.is-scrollable` fades the right edge; toggled from `scrollWidth > clientWidth + 1` on window resize and through a `ResizeObserver`. No `…` menu, no second row. |

### 3.3 Footer

Fixed order: **`[status][hint?][Cancel][Apply]`**.

| Item | Spec |
| --- | --- |
| Status | `#<prefix>-status`, `role="status" aria-live="polite" aria-atomic="true"`, pushed left. The only status region. |
| Cancel | `#<prefix>-cancel`, `aria-keyshortcuts="Escape"`; dirty guard first. |
| Apply | `#<prefix>-apply`, primary, disabled until ready. A clean open still shows it; the no-op branch reports "No changes to apply" and closes without writing. |
| Actions | 44 px. |
| Hint | Designers: none. Table: `.te-hint` reading `Esc cancels` — a deliberate per-window exception, `aria-hidden`, hidden at ≤ 520 px. Esc cancels in every window either way. |

### 3.4 Ids and classes

| Prefix | Window |
| --- | --- |
| `table-editor` | Edit table |
| `designer` | Mermaid |
| `dw` | Graphviz / WaveDrom |

Ids: `<prefix>-undo`, `-redo`, `-status`, `-cancel`, `-apply`, `-title`, `-type`, `-close`.

Classes: `.edit-header`, `.edit-badge`, `.edit-bar`, `.edit-bar-actions`
(+ `.is-scrollable`), `.edit-bar-toolbar`, `.edit-bar-group`, `.edit-bar-sep`,
`.edit-bar-history`, `.edit-bar-seam`, `.edit-bar-btn`, `.edit-chip`, `.edit-footer`
(+ `.te-footer` / `.designer-footer`), plus the table's `.te-toolbar`, `.te-group`,
`.te-sep`, `.te-tool`, `.te-hint`. Move existing nodes and keep their listeners; never
invent a second id. Style the shared classes, not `#<prefix>-…`.

## 4. History

**One shared engine, two controller kinds.** Both register through
`NB.editWindow.attach()` in `edit-window.js`, which picks stack mode when `snapshot` and
`restore` are both functions.

| Kind | Controller provides | Engine stores | Buttons |
| --- | --- | --- | --- |
| Own the stack | `snapshot()` / `restore(state)`, optional `isNoOp(model)` | Stack + index; coalesces text edits, never structural ones | Engine sets `disabled` from stack bounds |
| Delegate | `undo()`, `redo()`, `canUndo()`, `canRedo()` | Nothing | Controller calls `sync()` after each mutation |

| Window | Mode | Why |
| --- | --- | --- |
| Table | Stack | Restore must rebuild the grid and the cell model. |
| Graphviz / WaveDrom | Stack | Restore must repaint the preview. |
| Mermaid | Delegate | Visimer already owns undo/redo; a second stack would diverge. |

Never run two stacks.

| Rule | Detail |
| --- | --- |
| Cap | 100 snapshots including the opening one, **and** a 4 M-character total-size cap. |
| Eviction | Oldest entries drop until both caps fit. The current entry is never evicted, so one oversized snapshot is kept rather than leaving `index` past the end. |
| Coalescing | Text edits within 350 ms are one step; structural edits never coalesce. |
| Break | `breakCoalesce()` ends the typing window at a cell / field boundary; undo and redo also reset it, so typing after a step starts a new entry. |
| State | Native `disabled` only, never `aria-disabled`; dead buttons leave the tab order. Undo dead at the bottom, redo at the top. |
| Chords | `Ctrl/Cmd+Z` undo; `Ctrl/Cmd+Shift+Z` and `Ctrl/Cmd+Y` redo. Format with `shortcuts.js` (`Mod` → `Ctrl`/`Cmd`). |
| Lifecycle | Seed on open after mount; clear on close. A restore repaints, re-syncs Apply, reports status, and never captures itself. |
| Placement | **No history in the footer. No History section in a sidebar.** Bar only. |

### 4.1 Key ownership

`ownsKey(e)` per window. `NB.editWindow.isEditable()` is the one copy of the "native undo
owns this target" guard.

| Surface | `Ctrl+Z` | `Ctrl+Shift+Z` / `Ctrl+Y` |
| --- | --- | --- |
| Table, every target incl. cells and sort select | Window | Window |
| Designer text fields, selects, contenteditable | Native | Native |
| Mermaid canvas | Visimer owns it | `Ctrl+Y`: window; `Ctrl+Shift+Z`: Visimer |
| Any other target | Window | Window |

The table claims it everywhere because committing kills native cell undo and the select
has none. The Mermaid canvas keeps the vendor chords; only `Ctrl+Y` is claimed, since
Visimer does not bind `y` and intercepting `z` would undo twice.

## 5. Tokens

Add the shared `--edit-bar-*` block to the window's selector list and consume it; a value
used twice becomes a token.

| Region | Tokens / classes | Consume for | Values |
| --- | --- | --- | --- |
| Header | `.edit-header`, `.edit-badge`, `.icon-btn.win-max` | Title, badge, maximize, close | `edit-window.md` §2; mockup `:root` |
| Bar | `.edit-bar`, `.edit-bar-actions`; `--edit-bar-h`, `--edit-bar-pad-x`, `--edit-bar-pad-y`, `--edit-bar-gap` | One row, `--bg-elev`, bottom seam only | `edit-window.md` §2 |
| Tools | `.edit-bar-toolbar`, `.edit-bar-group`, `.edit-bar-sep`, `.te-tool`, `.edit-chip`; `--edit-bar-tool`, `--edit-bar-sep-h` | Interior row and separators | `edit-window.md` §2, §8 |
| History | `.edit-bar-history`, `.edit-bar-seam`, `.edit-bar-btn` | Chrome pair, pinned left | `edit-window.md` §4 |
| Footer | `.edit-footer`, `.settings-action`; `--edit-foot-*` | Order and action size | mockup `:root`; `edit-window.md` §6 |
| Status | `.te-status`, `.designer-status`, `[role="status"]` | One live region, left, muted | `edit-window.md` §6 |

## 6. Responsive

| Width | Bar | Body | Footer |
| --- | --- | --- | --- |
| 1280 | One line; table slot fits (~1090 px); chip slots never overflow | `min(1320px, 96vw) × min(85vh, 92vh)`; sidebar / canvas / inspector | One row |
| ~1150 | Table slot starts to scroll; right edge fades | — | One row |
| 900 | Unchanged | Designers compact (≤ 960): Mermaid sidebar becomes a horizontal strip; DW sidebar hides and its sections live in the compact sheet; the inspector becomes a bottom sheet | One row |
| 720 | Slot **scrolls**; history pair pinned; fade at the right edge | Table grid scrolls | **Status wraps to its own row**; Cancel/Apply right-aligned below |
| ≤ 520 | Unchanged | **Table modal full screen** | `Esc cancels` hint hidden |

The Graphviz / WaveDrom chips are **`Add` / `Chart` / `Source`** with `data-compact`, in
the bar at every width. `Add` and `Chart` open the compact sheet on compact and scroll /
focus the matching section on desktop; `Source` opens the inline source editor at every
width. The Mermaid chips always scroll and focus, because its sidebar stays in the layout
as a strip. No compact `+ ▦ ⌨` strip exists.

## 7. Accessibility

| Rule | Why |
| --- | --- |
| 44 px chrome, 32 px interior tools | Chrome is sparse and touch-critical; the table's 20 tools must fit one line. 32 px is the body size and stays above the 24 px minimum. Never raise the tool row to 44. |
| Visible focus ring on every control | 2 px accent, offset 1; the scrolling slot keeps 6 px slack so rings are not clipped. |
| One live region | `#<prefix>-status`, polite, atomic. Never add a second. |
| Names and tooltips | Icon-only controls get `aria-label` + `title`; the title carries the chord. Toggles use `aria-pressed`; destructive tools `.is-danger`. |
| No unnamed icon | No visible text means an accessible name is mandatory. |
| Fade is not a control | The mask only signals more content. Keyboard focus scrolls the item into view, so nothing becomes unreachable. |
| Dialog focus trap | `NB.dialog.open(overlay, {fallbackFocus})`: siblings inert, Tab/Shift+Tab wrap at both ends, `aria-modal`, and close restores the invoker or fallback. Esc and backdrop stay per window. |
| Keyboard reach | Focused tools scroll into view; the pinned pair never hides. |

## 8. Adding a new edit window — checklist

1. **Pick the prefix.** Kebab-case, unique, used for every chrome id; check existing ids.
2. **Render the shell.** Header `[title][badge] … [maximize][close]`, `.edit-bar`, body, `.edit-footer`. No seam in the header, no history in the header.
3. **Set the badge.** Block type text; empty when there is none so it collapses.
4. **Fill the slot.** `.edit-bar-toolbar` + groups, 32 px items, one scrolling line, window actions only. A chip focuses a sidebar section; it never copies its form.
5. **Choose the history controller kind.** Own the stack or delegate; never both.
6. **Wire the footer.** Status live region, Cancel with `aria-keyshortcuts`, primary Apply with a no-op branch. Keep the order. Add a hint only for a shortcut the window must name there.
7. **Add responsive rules.** Slot scroll + pinned pair, footer wrap, compact body at ≤ 960, full screen at ≤ 520. Reuse shared rules; no per-window breakpoints.
8. **Update the focus-trap assertions.** First/last wrap, Shift+Tab from the container, background inert, Esc, focus return.
9. **Add the script to `sw.js`.** New JS (or `edit-window.js` when the engine is shared) goes in `PRECACHE` with a `CACHE` bump, or installed workers keep the old bundle.
10. **Add tests.** Button states at both ends, chord ownership per surface, Apply order (validate → swap → render → one `onContentChange`), three widths.
11. **Update this guide if the pattern changed.** If only a measurement changed, update [`edit-window.md`](edit-window.md) instead.

## 9. Do / don't

| Do | Don't |
| --- | --- |
| Window actions in the bar's scrolling slot | A second toolbar or body tool strip |
| History in the pinned bar pair | History in the footer, header, or sidebar |
| Reuse `#<prefix>-status` | Invent a second status region |
| Let the badge collapse when empty | Reserve a fixed badge slot |
| Keep tools at 32 px and scroll | Raise the tool row to 44 |
| Fade the right edge when the slot overflows | Add an `…` menu, a popover, or a second row |
| Native `disabled` on the history pair | `aria-disabled`, or hiding the pair |
| Keep Close last in the header | Insert a control after Close |
| Keep Cancel/Apply in the footer | Move Apply into the bar or header |

## 10. Decisions and known limits

| Decision | Limit / consequence |
| --- | --- |
| Table tool row stays 32 px | Needs the width; at 44 px it would not fit even at 1280. Below ~1150 px viewport width it scrolls and the right edge fades. Destructive tools can scroll out; the block menu still deletes. |
| The bar costs the designers body height | Accepted cost of one anatomy and a permanent history home. |
| Mermaid **Source** is not in the bar | Its four items are two mode toggles plus Add / Chart; the source path stays in the error and read-only states. |
| Table badge reads **"Table"** | It names the window, not the block flavour. |
| No `+` slot ships | Design reservation only. A future per-window control goes after the history pair. |
| The table footer keeps `Esc cancels` | The one per-window footer extra; it is hidden at ≤ 520 px. |
| The sort `<select>` cannot be an icon | At 720 it scrolls with the slot instead of pinning. |
