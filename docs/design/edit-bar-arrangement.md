# Edit Bar Arrangement

Product/functional spec for the Markdown editor's edit bar (`#edit-bar`), the
formatting row shown in edit/hybrid mode. This defines the target arrangement
only. No source files were changed. An engineer implements the markup in
`templates/index.html`, the CSS in `static/css/style.css`, and the small
`static/js/editbar.js` cleanup called out below.

Status: spec / definition.

---

## 1. Inventory (current)

Markup: `templates/index.html:187-262`. CSS: `static/css/style.css:546-624` and
`1174-1203`. Behavior: `static/js/editbar.js` (source mode) and
`static/js/hybrid.js:3577-3589` (WYSIWYG mode).

Left to right, as shipped today:

| Group | Controls (`data-act`) | Source |
| --- | --- | --- |
| Headings | `h1` `h2` `h3` `h4` | index.html:188-191 |
| — separator | | :192 |
| Inline emphasis | `bold` `italic` `strike` `code` | :193-196 |
| — separator | | :197 |
| Lists & quote | `ul` `ol` `task` `quote`, `☰` list menu (`list-menu`, items `list-move-up` `list-move-down`) | :198-208 |
| — separator | | :209 |
| Insert | `link` `image` `emoji` (opens emoji panel), `codeblock` | :210-220 |
| — separator | | :221 |
| Table | `▦` table menu (`table-menu`, 14 items, `table` first) | :222-240 |
| — separator | | :241 |
| History | `undo` `redo` | :242-243 |
| Overflow | `⋯` More menu (`more`) holding exactly `hr`, `h5`, `h6`, `clear` | :244-253 |
| Spacer + actions | `.eb-spacer`, then right-aligned `Preview`, `Save` (hidden), `Save & Exit` (hidden), `Close` (dirty dot) | :254-261 |

The More menu is the only *hide* menu: a control behind `⋯` is invisible until
opened. The `▦` and `☰` menus are *action* menus — they group a family of
related operations behind one visible trigger.

---

## 2. Target arrangement (the reorder)

The job is to **reorder** the bar so it follows how a person uses it, and to
promote the four controls that were hidden behind `⋯`. Nothing is dropped and
no label changes.

Ordering principle: **group by what the control acts on, order the groups by
how often a mouse user reaches for them, and keep undo/redo at the leading edge
where every editor puts them.** Within a group, keep the order the user already
knows.

Target, left to right:

| Group | Controls (`data-act`) | Why it sits here |
| --- | --- | --- |
| History | `undo` `redo` | Highest-frequency recovery, universal editor convention (first thing on the bar), and it moves recovery away from the destructive `Close` at the far right. |
| — separator | | |
| Headings | `h1` `h2` `h3` `h4` `h5` `h6` | The most common structural change. One ascending run; `h5`/`h6` complete it instead of hiding behind a menu. |
| — separator | | |
| Inline emphasis | `bold` `italic` `strike` `code` | The most common character change; the run the eye expects next to bold in every editor. |
| — separator | | |
| Lists & quote | `ul` `ol` `task` `quote`, `☰` list menu | Block prefixes; medium frequency, and the list menu belongs beside its own buttons. |
| — separator | | |
| Insert | `link` `image` `emoji` `codeblock` `hr` | Content insertion, lower frequency. `hr` joins `codeblock` — both place a self-contained block on its own line. |
| — separator | | |
| Table | `▦` table menu | Its own family of operations (14 items); kept as one visible trigger. |
| — separator | | |
| Reset | `clear` | Whole-line reset that strips the block prefixes (heading/list/quote/task) and the inline emphasis, i.e. it undoes groups 2-4. Rare, so it lives at the trailing edge of the formatting cluster, not in the hot zone. |
| Spacer + actions | `Preview`, `Save` (hidden unless dirty), `Save & Exit` (hidden), `Close` | Unchanged, right-aligned. |

What actually moved:

- `undo`/`redo` moved from just-right-of-centre to the **far left**.
- `h5`/`h6` moved out of the menu into the heading run.
- `hr` moved out of the menu to the end of the Insert run.
- `clear` moved out of the menu to the trailing reset slot.
- The `⋯` More wrapper and its trigger are gone (the only removal).

Everything else keeps its relative position. That is deliberate: the bar is a
muscle-memory surface, so the reorder improves the hot path (history first,
heads in one run) without scattering controls the user already knows.

### Placement decisions and rationale

- **`undo`/`redo` first.** Every editor the user already uses puts undo/redo at
  the start. They are the most frequent recovery actions, they pair only with
  each other, and the far-left slot keeps them clear of the `Close` button.
- **`h5`/`h6` after `h4`.** Same operation as `h1`–`h4` (`editbar.js`
  `lineAction`, `hybrid.js` `wrapBlock`) at a different level. A user picking a
  heading scans one ascending `H1`…`H6` run.
- **`hr` after `codeblock`.** Both are block-level inserts. `hr` trails the run
  because it is the least frequent insert.
- **`clear` at the trailing edge.** It strips the block prefixes (heading,
  list, quote, task) and the inline emphasis (`editbar.js` `clear()` in source
  mode, `hybrid.js` `clearFormatting()` in WYSIWYG mode), so it resets the
  block-structure groups and the character formatting. Rare and
  semi-destructive, so it belongs at the perimeter, with a separator marking it
  as a reset rather than a formatting control.
- **`code` and `codeblock` stay in their groups.** Inline code is a character
  format; the fenced block is an insert. Their titles distinguish them; keep
  each with its family rather than pairing the two.

---

## 3. Overflow policy

The `⋯` More menu is removed because its contents are now on the bar; the `▦`
table and `☰` list action menus stay, with their contents and behavior
unchanged.

---

## 4. Sizing and density

No controls are dropped or shrunk. Keep the current `.eb` metrics exactly as
they are.

Keep `flex-wrap: wrap` on `.edit-bar`, and give `.eb-actions` `margin-left:
auto` (replacing the `.eb-spacer` span). Today, when the row wraps, the spacer
stays on row 1 and the `Preview`/`Save`/`Close` group strands left-aligned on
row 2; `margin-left: auto` pins the actions to the right edge wherever they
land. The formatting cluster wraps first; the actions always stay reachable.

---

## 5. Grouping and scanability

A user finds a control by scanning one of seven labelled runs separated by the
existing 1px separators:

1. **History** — undo, redo.
2. **Headings** — structure.
3. **Inline emphasis** — character formatting.
4. **Lists & quote** — line prefixes.
5. **Insert** — links, images, emoji, code block, rule.
6. **Table** — table operations.
7. **Reset** — clear formatting, at the trailing edge.

Rules: order groups high-frequency-first; keep related operations adjacent so
the eye lands on a run, not a scatter; keep a separator between groups so the
runs are visually distinct; keep the highest-frequency controls in the left
half where the eye starts; keep rare and destructive actions at the edges
(`clear` right, `Close` far right). Every glyph-only control keeps its
descriptive `title` so its meaning never depends on the glyph alone.

---

## 6. Acceptance criteria

An engineer can verify each item directly; the DOM harness
(`tests/dom/test_dom.js`) drives the real `#edit-bar` by
`#edit-bar .eb[data-act="..."]`.

1. `#edit-bar` contains **no** `[data-act="more"]` button and **no**
   `.eb-overflow-btn`.
2. The only menus under `#edit-bar` are `.eb-table-menu` and `.eb-list-menu`. No
   plain `.eb-menu` (the former More menu) exists.
3. These four exist as **direct** bar controls, not descendants of any
   `.eb-menu`: `h5`, `h6`, `hr`, `clear`.
4. Document order of the direct bar controls matches §2:
   `undo redo`, separator, `h1 h2 h3 h4 h5 h6`, separator,
   `bold italic strike code`, separator, `ul ol task quote` + list menu,
   separator, `link image emoji codeblock hr`, separator, table menu,
   separator, `clear`, then the actions.
5. `data-act` values are **unchanged**. `more` is the only key removed. No
   label, glyph, or tooltip changed.
6. Clicking each promoted control performs the same action it performs today,
   in both source (CM6) and hybrid mode: `h5` → `##### `, `h6` → `###### `,
   `hr` → a rule on its own line, `clear` → strips the block prefixes
   (heading/list/quote/task) **and** the inline emphasis (bold/italic/
   strikethrough/inline code) from the selection. Links, images, and fenced
   code blocks keep their content and are left intact. Behavior of every
   other existing control is unchanged.
7. `templates/index.html` holds the §2 order. The test fixture in
   `tests/dom/test_dom.js` (currently lines 210-271) carries the same controls
   and menu wrappers; exact fixture order is not load-bearing because the tests
   query by `data-act`.
8. CSS: `flex-wrap: wrap` remains; `.eb-actions` carries `margin-left: auto`;
   the `.eb-spacer` element is gone. No `.eb` control is hidden or clipped at
   narrow widths.
9. `editbar.js` no longer references the overflow button or menu: remove
   `overflowBtn`, `MORE_OVERFLOW`, `overflowMenu`, the `more` entry in
   `actions`, and the `overflowMenu.hidden = true` lines in `refresh()` and the
   two click handlers. Outside-click still closes the table menu, the list
   menu, and the emoji panel.
10. Hybrid mode needs no code change for the four controls: `h5`, `h6`, `hr`,
    and `clear` are already in `EDIT_BAR_HYBRID_ACTS`
    (`hybrid.js:3577-3589`) and `more` was never claimed there. Confirm no
    `.eb-overflow:not(...)` selector survives.

### Tests to change (name them)

- `tests/dom/test_dom.js:4801-4803` — the "at least 14 buttons" count and the
  `.eb-overflow:not(.eb-table) > .eb-menu` hidden-by-default check.
- `tests/dom/test_dom.js:4960` — `hr` query (`#edit-bar .eb[data-act="hr"]`)
  still passes unchanged.
- `tests/dom/test_dom.js:4977-5002` — the `.eb-overflow:not(.eb-table)`
  lookups and the `index.html` regex `/<div class="eb-menu" hidden>/`; that
  regex no longer targets the (removed) More menu.
- `tests/dom/test_dom.js:5003-5022` — the "more opens overflow menu" checks;
  replace with a direct `h5` click.
- `tests/dom/test_dom.js:5010` and `5025` — `.eb-menu .eb[data-act="h5"]` and
  `.eb-menu .eb[data-act="clear"]` become plain bar queries.

No new `data-act` keys are introduced; none are renamed; `more` is removed.

---

## 7. Out of scope / unchanged

- The `▦` table menu: same 14 items, same order (`table` first), same behavior.
- The `☰` list menu: same 2 items, same enable/disable-when-not-in-a-list rule.
- The emoji panel: same toggle, search, categories, and insert behavior.
- The right-aligned mode actions `Preview`, `Save`, `Save & Exit`, `Close`:
  same labels, same hidden/dirty-dot behavior.
- Vim-mode visibility of the whole bar (`editbar.js` `refresh()`): unchanged.
- Labels, glyphs, tooltips, and button sizes: unchanged.

---

## Open questions

1. **Minimum supported content-column width.** With no controls dropped, the
   only narrow-window behavior is wrapping. If the bar must stay on one row
   above a known width, fix that width (the app already uses 720px as a
   narrow-width reference, `style.css:4477`) and measure it against the real
   content column; otherwise leave wrapping unconstrained.
