# Hybrid mode — the WYSIWYG editing surface

Status: Current spec — shipped surface, codified. §10.4 holds the only visual changes:
the contrast labels on the active toggle and the pressed edit-bar controls, plus the
active toggle's hover face. Everything else in this document describes what ships.
Proposals live in §12.

Reference mockup: [`hybrid-mode-mockup.html`](hybrid-mode-mockup.html) — dark and light,
ten boards: hybrid idle, block hover, block focused, grip and marker, list drag, table
chip and rectangle, code chip editing, dirty, external conflict, phone. Standalone, no
network assets.

**Normative source.** This document owns the UI affordances of the hybrid surface: entry
and exit, the editable page's focus and selection treatment, block-level chrome, the two
overlay layers, the code-fence chip, save/dirty/conflict feedback, and the phone
conversion of all of it. It reads [`foundations.md`](foundations.md) for every token,
[`controls.md`](controls.md) for control anatomy and focus, [`reader.md`](reader.md) for
the page and rendered prose, and [`content-blocks.md`](content-blocks.md) for the fence,
table, figure and diagram visuals. The edit/parse algorithm and the write-back contract
are [`../architecture/hybrid-editing.md`](../architecture/hybrid-editing.md); this
document never restates them. Source mode is [`source-editor.md`](source-editor.md), and
the edit windows are separate documents.

Paths: `style.css` is `static/css/style.css`; `index.html` is `templates/index.html`;
`hybrid.js`, `list-edit.js`, `table-edit.js`, `table-select.js` and `copy-image.js` are in
`static/js/`.

Every claim about current code cites `file:line`.

---

## 1. Enter and exit

### 1.1 The entry control

| Property | Value | Source |
|---|---|---|
| Element | `<button id="hybrid-toggle" class="icon-btn">` | `index.html:178` |
| Glyph | `✎`, `font-size: 1.1rem`, `line-height: 1` | `index.html:178`; `style.css:2680-2684` |
| Box | shared `#topbar button` face: `--bg-elev`, `1px --border`, `--radius-sm`, padding `2px 8px`; content `1.1rem` = 15.4 px, so ≈ 21 × 33 px | `style.css:192-201`, `:2680-2684` |
| Name | `aria-label="WYSIWYG edit mode"`, `title="WYSIWYG edit mode (edit rendered markdown directly)"` | `index.html:178` |
| Visible when | a note is open **and** the role can write | `hybrid.js:9056-9061` |
| Hidden when | no note, empty state, viewer role | same |
| Pointer | click toggles; on a phone the active control acts as Done | `hybrid.js:9035-9041` |
| Keyboard | `Mod+Shift+E` (`Ctrl+Shift+E` outside macOS) | `shortcuts.js:59`; `hybrid.js:9045-9047` |
| Refused when | the CM6 source editor is open | `shortcuts.js:334` |

The button is the only entry control. It never enters a menu and never moves.

### 1.2 Active state

| Signal | Value | Source |
|---|---|---|
| Button | `.active`: `background: var(--accent)`, `color: #fff` | `style.css:2685-2688` |
| Topbar | `.editing`: `--accent-soft` face, `--accent` bottom border | `style.css:2647-2651` |
| Edit bar | shown in the `hybrid` context; 63 px at 772 (2 rows), 119 px at 353 (4 rows); Preview hidden, Save appears when dirty | `hybrid.js:6964-6971`; `style.css:574-618` |
| Close | visible; text `✕` desktop, `Done` phone; `aria-label="Exit WYSIWYG mode"` | `hybrid.js:6972-6979` |
| Save | hidden on desktop, visible on phone at entry; label `💾` while hybrid is active | `hybrid.js:46`, `:6980-6988` |
| Page | `contenteditable="true"`, `.hybrid-editing`, 2 px inset outline, 20 px top padding | `hybrid.js:6951-6960`; `style.css:2694-2701`, `:2737-2740` |
| Scroll shell | `#viewer.hybrid-active #viewer-scroll { overflow-x: auto }` | `style.css:2730-2732` |
| Focus | `viewerContentEl.focus()` — focus lands on the page | `hybrid.js:6991` |

The active toggle has no `aria-pressed` today. That is exception **E2**.

The accent fill is white-on-`--accent`: 2.61:1 in dark (`foundations.md` §3.6). Exception
**E1** changes the label to `--text-on-accent`. The same selector pair leaves the active
button's *hover* with the pale `--accent-soft` face and white text because
`#topbar button:hover` (`(1,1,1)`) outranks `#hybrid-toggle.active` (`(1,1,0)`); exception
**E1c** keeps the accent face on hover.

### 1.3 Shell delta

| Zone | Read mode | Hybrid | Source |
|---|---|---|---|
| Topbar | `--surface-panel`, `--border` bottom | `--accent-soft` face, `--accent` bottom | `style.css:2647-2651` |
| Tab bar | 34 px | unchanged | `style.css:494` |
| Edit bar | hidden | 63 px at 772, 119 at 353; wraps, `--surface-panel` | `style.css:574-618` |
| Page top padding | 16 px | 20 px | `style.css:2396`, `:2737-2739` |
| Page bottom padding | `--viewer-tail` 48 | unchanged | `style.css:2739` |
| Side panel, outline, rail | — | unchanged | — |

Entry changes no type size, block margin, colour of prose, table or code block. The first
block moves down by the bar plus 4 px of page padding: 67 px at 772, 123 px at 353. The bar's
appearance is part of the entry delta, not a hidden cost.

### 1.4 Exit

| Path | Writes? | Prompt | Source |
|---|---|---|---|
| Edit-bar **Close** / **Done** | saves if the serialized bytes differ | `Save them before exiting WYSIWYG mode?` OK = save then exit; Cancel = discard and exit | `hybrid.js:7264-7300` |
| Save fails during that prompt | no exit | `alert("Save failed: …")`, editor stays | `hybrid.js:7290-7295` |
| Topbar `✎` (desktop) | **no** | none — `exit(false)` re-renders from cache | `hybrid.js:9035-9039`, `:7302-7303` |
| `Mod+Shift+E` | **no** | none — same `toggle()` path | `hybrid.js:7302-7303`, `:9045-9047` |
| Topbar `✎` (phone, active) | routes through Close | same as Close | `hybrid.js:9035-9038` |
| Tab close / tab switch | see §6.4 | — | `hybrid.js:7325-7361` |

Exit removes `contenteditable`, `.hybrid-editing`, `.hybrid-active`, `.editing` and
`.active`, hides the edit bar, restores Preview and re-activates the tab so the note
renders from cache (`hybrid.js:7082-7129`). Focus is left on the now non-editable page
element; nothing moves it. Exception **E5** returns it to `#hybrid-toggle`.

The silent discard on the two desktop toggle paths is shipped and recorded as proposal
**P1**, not applied.

---

## 2. Page states

### 2.1 Read/edit parity

The preview DOM is reused, not re-rendered (`hybrid.js:6941-6946`), so every block keeps
its rendered identity. Exit re-renders from cache (`hybrid.js:7117-7127`).

| Thing | Read | Hybrid | Source |
|---|---|---|---|
| Fonts, sizes, line heights | reader | identical | `reader.md` §2 |
| Block margins | `.7em` | identical | `content-blocks.md` §1 |
| Code, table, diagram visuals | content-blocks | identical | `content-blocks.md` |
| Inner scrollers on `pre` and `table` | may scroll | `overflow: visible`, page owns overflow | `style.css:2703-2718` |
| `pre code` | inline or block | forced `display: block` | `style.css:2723-2725` |
| Wide table pan | table scrolls | `#viewer-scroll` pans horizontally | `style.css:2726-2732` |
| Prose selection | UA or reader E1 | same | `reader.md` §5.1 |
| Task checkbox | disabled | enabled, `contenteditable="false"` | `hybrid.js:6907-6912` |
| Rendered plugin cards | live | atomic, `contenteditable="false"` | `hybrid.js:1644-1659` |
| Empty list marker | marker may collapse | zero-width placeholder keeps it | `hybrid.js:6995-6997` |
| Empty heading/paragraph | zero height | marked caret line box | `hybrid.js:6998-7001` |

The page's own `2px` radius on headings, `p`, `li` and `blockquote`
(`style.css:2745-2755`) is always applied, not a hover state. The comment above it promises
a "faint hover highlight"; **no hover highlight ships**. Do not add one from that comment.

### 2.2 Focus indicator

| State | Paint | Source |
|---|---|---|
| Page, focus elsewhere | `outline: 2px solid var(--accent-soft)`, offset `-2px` | `style.css:2694-2696` |
| Page, focus inside | `outline-color: var(--accent)` | `style.css:2699-2701` |
| Cursor | `text` | `style.css:2697` |
| Any other hybrid control | its own `:focus-visible` rule (§3) | — |

The outline is the editing-region indicator, not a per-control focus ring. It is drawn
whether focus arrived by pointer or keyboard, so a click also shows the editable region.
The page root is focusable because `contenteditable="true"`; no `tabindex` is added.

### 2.3 Caret and selection

| Item | Value | Source |
|---|---|---|
| Caret | browser default; colour is the inherited text colour, no `caret-color` rule | — |
| Selection | no hybrid rule; the UA default until reader **E1** lands, then `--selection-bg` / `--selection-text` | `reader.md` §5.1 |
| Task checkbox | real `<input type="checkbox">`, not contenteditable | `hybrid.js:6907-6912` |
| `<hr>` in a selection | `border-top-color: --accent`, `box-shadow: 0 0 0 2px --accent-soft` (`nb-hr-selected`) | `style.css:3772-3775` |
| Table rectangle | `background: --accent-soft`, `box-shadow: inset 0 0 0 1px --accent` | `style.css:1125-1128` |

The `<hr>` and table-rectangle classes are gesture chrome. They are stripped from the save
and from undo snapshots by `hybrid.js` and `table-select.js`; they are not content states.

### 2.4 Empty page and empty block

| State | Paint | Source |
|---|---|---|
| Whole page empty | `:empty::before { content: "Start typing…" }`, `--text-muted`, no pointer events | `style.css:2758-2762` |
| Empty paragraph/heading | zero-height block receives a marked caret `<br>`; the live block shows only the caret | `hybrid.js:6998-7001` |
| Empty list item | zero-width space keeps the marker rendered; stripped on save | `hybrid.js:6995-6997`; `tests/dom/test_dom.js:8034-8038` |

The placeholder is a single line at the page's top-left, in prose position, not a card or
an illustration.

### 2.5 IME

Composition is left native: no input rule, no Enter transform and no block-marker
Backspace claims a key while `e.isComposing` is true (`hybrid.js:5526-5530`,
`:6809-6817`). The composition underline is the browser's. No chrome appears or moves
during composition.

### 2.6 Block markers are rendered, not chrome

| Block | What the marker looks like | Source |
|---|---|---|
| Heading | No marker; size and weight carry the level | `reader.md` §2.2 |
| Bullet / ordered item | UA `list-style` inside the `1.6em` indent | `style.css:3162`; `reader.md` §2.4 |
| Task item | A real `1em` checkbox hanging `-1em` left | `style.css:3201-3239` |
| Quote | A 3 px `--accent` rail on an `--accent-soft` face | `reader.md` §2 |
| Rule | A 1 px `--border` line | `style.css:3764` |

Backspace at the first content position removes the marker and leaves a paragraph; one
press peels one layer; the previous and next blocks are untouched. The full per-block
result and the key conditions are
[`../product/hybrid-block-marker-backspace.md`](../product/hybrid-block-marker-backspace.md)
§3–4. The UI contract here is only: the marker disappears, the text stays, the caret sits
at the first character, and no chrome flashes.

---

## 3. Block chrome

**There is no generic block chrome.** No block hover outline, no block-level drag handle,
no per-block menu, no edit pencil, no gutter marker column. A block is edited by placing
the caret in it. The shipped chrome is four controls, each on one block type:

| Block | Hover | Focus / caret | Drag | Source |
|---|---|---|---|---|
| Paragraph, heading | none | none | none | — |
| Quote | none | none | none | — |
| List item | 24 px grip in the left gutter | grip follows the caret's item | grip, whole item subtree | `list-edit.js:261-293` |
| Table | 24 px Edit table chip, left of the header row | chip follows a focused table | none (architecture rejects table grips) | `table-edit.js:68-95`; `hybrid-editing.md` G3 |
| Code fence | Copy button in the 22 px band | Copy on `:focus-within`; language chip while the fence is edited | none | `style.css:3314-3335`, `:3362-3366` |
| Diagram / live HTML card | none in hybrid (copy buttons removed) | click opens the plugin source editor | none | `copy-image.js:34-37`; `hybrid-editing.md` G2 |
| Image, figure | none | caret only | none | — |
| Rule | none | selected-rule ring only | none | `style.css:3772-3775` |

### 3.1 List grip

| Property | Value | Source |
|---|---|---|
| Element | `<button class="nb-list-grip" type="button" tabindex="0">` | `list-edit.js:261-269` |
| Name | `aria-label="Reorder list item"`, `title="Drag to move this list item"` | `list-edit.js:265-266` |
| Glyph | 10 × 10 SVG, six 1.1 r dots, `fill: currentColor` | `list-edit.js:76-81`; `style.css:773` |
| Box | 24 × 24 (`--control-h-sm`), radius 4, transparent face, transparent 1 px border | `style.css:860-876` |
| Colour | `--text-muted`; `cursor: grab`; `touch-action: none` | same |
| Rest | invisible: overlay has no grip until an item is active | `list-edit.js:279-293` |
| Hover | `--accent-soft` face, `--border` border, `--text-primary` glyph | `style.css:877-881` |
| Pressed / drag | `--accent` face, `--bg` text, `cursor: grabbing` | `style.css:882-886` |
| Focus-visible | `2px solid --accent`, offset `1px` | `style.css:887-890` |
| Placement | right edge on the containing list's left rail, 24 px wide, y = centre of the item's first line, clamped to 4 px from `#viewer`'s left edge | `list-edit.js:279-293` |
| Reveal | pointer over the item, or caret inside it; 120 ms hide grace; locked while the pointer is on the grip | `list-edit.js:43`, `:517-558` |
| Hide | scroller `scroll`, window resize, hybrid exit | `list-edit.js:576-577`, `:580-598` |

The grip is the same hover-reveal model as the table chip, one column left of the marker.
It is the only drag handle in the surface. Its keyboard equivalent is `Alt+Up` / `Alt+Down`
on the item (`hybrid.js:5404-5411`), plus the context menu's List submenu.

The shipped `:active` text is `var(--bg)`, a surface token used as a label. It measures
fine, but exception **E6** reads `--text-on-accent` instead; light is unchanged, dark moves
from `#1a1b1f` to `#14151a`.

### 3.2 Table Edit chip

| Property | Value | Source |
|---|---|---|
| Element | `<button class="nb-te-open" type="button">`, 14 px table SVG | `table-edit.js:35-38`, `:83-88` |
| Name | `aria-label="Edit table"`, `title="Edit table"` | `table-edit.js:86-87` |
| Box | 24 × 24, radius 4, `1px --border`, `--bg-elev` face | `style.css:817-831` |
| Colour | `--text-muted`; `cursor: pointer` | same |
| Placement | `table.left − 24 − 4`, vertically centred on the header row, clamped 8 px inside `#viewer` | `table-edit.js:20-22`, `:76-81` |
| Hover | `--accent` glyph and border, `--accent-soft` face | `style.css:832-836` |
| Focus-visible | `2px solid --accent`, offset `1px` | `style.css:837-840` |
| Reveal | pointer over the table, or focus inside it; 120 ms grace; locked over the chip | `table-edit.js:104-121`, `:125-157` |
| Hide | scroll, resize, exit; the layer is empty and `display: none` | `table-edit.js:169-170`; `style.css:771` |

The chip opens the table editor modal. There is no row or column grip in hybrid mode; the
architecture rejects them explicitly (`hybrid-editing.md` G3).

### 3.3 Code-fence Copy

| Property | Value | Source |
|---|---|---|
| Box | absolute, `top: 1px`, `right: 10px`, `z-index: 2` in the band | `style.css:3362-3366` |
| Type | `.76rem`, line 1, padding `4px 8px`, radius 4 | `style.css:3297-3304` |
| Face | `--bg-elev`, `1px --border`, `--text-muted` | `style.css:3305-3307` |
| Rest | `opacity: 0` | `style.css:3309` |
| Shown | `pre:hover`, `pre:focus-within`, or the button's own `:focus` | `style.css:3314-3332` |
| Hover | `--accent-soft` face, `--text-primary` | `style.css:3334` |
| Copied | `--accent` text and border for 1200 ms | `style.css:3335`; `copy-image.js:63-64` |
| Phone | 44 × 44, always visible, `top: 0; right: 0` | `style.css:7464-7472` |

Copy is the only fence action. There is no per-fence edit button; the fence itself is the
click target (`content-blocks.md` §2.5).

### 3.4 Language chip — see §5.

---

## 4. Overlays

Three layers are children of `#viewer`, never of `#viewer-content`. They are outside the
editable subtree, so Turndown and the undo snapshots never see them
(`table-edit.js:10-14`; `list-edit.js:20-37`).

| Layer | Host | Position | Z | Pointer events | Empty |
|---|---|---|---|---|---|
| `.nb-table-overlay` | `#viewer` | `inset: 0` | 6 | `none`; chip `auto` | `:empty { display: none }` |
| `.nb-list-overlay` | `#viewer` | `inset: 0` | 6 | `none`; grip `auto` | `:empty { display: none }` |
| Drag chrome | inside `.nb-list-overlay` | absolute | proxy 2 | `none` | removed on drop/cancel |

Sources: `style.css:765-771`, `:852-858`, `:797-812`.

The two layers are siblings and never clear each other. `table-edit.js` wipes only its own
node on render (`table-edit.js:68-71`); `list-edit.js` wipes only its own
(`list-edit.js:279-281`). `z-index: 6` is a local stack value, not a shell band; it sits
above the page and below menus (1000) and the table-view overlay (7), which is torn down
before hybrid (`foundations.md` §6.1; `style.css:923`).

All three hide on scroll rather than tracking the rect, and re-show on the next pointer or
focus interaction (`list-edit.js:576-577`; `table-edit.js:169-170`).

### 4.1 List drag chrome

| Part | Value | Source |
|---|---|---|
| Ghost | translucent lifted item: `--accent-soft`, radius 2, no border | `style.css:789-794` |
| Proxy | pointer chip: max 220 px, padding `3px 8px`, `.8rem`, `--bg-elev`, `1px --border`, radius 6, `--shadow-pop`-equivalent `0 6px 24px rgba(0,0,0,.35)`, z 2 | `style.css:797-812` |
| Proxy text | item's own text, nested lists and checkboxes removed, 28 chars then `…`, `(empty item)` when blank | `list-edit.js:54`, `:339-346` |
| Drop line | 2 px `--accent`, `0 0 0 1px --accent-soft` ring, radius 1, full boundary width | `style.css:777-785`, `:893`; `list-edit.js:406-429` |
| Cursor | `body.nb-list-drag { cursor: grabbing }`; page text selection off | `style.css:896-897` |
| Offset | proxy 8 px right and down from the pointer | `list-edit.js:51`, `:437-438` |
| Announcement | `role="status" aria-live="polite" aria-atomic="true"`, "Item moved to position N, level M" | `list-edit.js:607-627` |

Escape or `Ctrl/Cmd+Z` during a drag cancels with no mutation (`list-edit.js:493-503`).
A refused drop removes the line; the ghost returns to the start rect on cancel. The ghost
stays at the item's start rect during the drag, so it does not follow the pointer.

### 4.2 Table rectangle

| Property | Value | Source |
|---|---|---|
| Gesture | `Ctrl` (Windows/Linux) or `Cmd` (macOS) + drag inside one table | `table-select.js:43-53` |
| Eligible | inside `#viewer-content`, not live preview, no merged cells, no modal | `table-select.js:82-93` |
| Rect | each covered cell gets `--accent-soft` + `inset 1px --accent` | `style.css:1125-1128` |
| Drag cursor | `crosshair` on the table | `style.css:1131-1133` |
| Paint lifetime | while held; cleared on the next arm, window blur, re-render or mode change | `table-select.js:212-247` |
| Copy | TSV to `text/plain`, a `<table>` to `text/html` | `table-select.js:1-8` |

The rectangle is painted on the cells, not in an overlay, so it moves with the content. It
touches no layout property (`style.css:1121-1124`).

---

## 5. Code fence

The fence keeps one 22 px top band in every state, 44 px on the phone. The band is reserved
by `padding-top` on `pre:has(> code)`, so entering and leaving edit never changes the
block's height (`style.css:3281-3283`, `:7452-7454`).

| State | Band content | Source |
|---|---|---|
| Read, labelled | generated `::after` text: `attr(data-fence-lang)`, `top: 6px`, `left: 16px`, `.72em/1.2` mono, `--text-muted`, max-width `calc(100% − 96px)`, no pointer events, z 0 | `style.css:3345-3356` |
| Read, bare | empty band; no label | `content-blocks.md` §2.4 |
| Read, hover/focus | Copy at the band's right | `style.css:3314-3332` |
| Fence being edited | label hidden (`pre.hybrid-plugin-editing::after`), chip in the same place | `style.css:3358-3360` |
| Fence being edited, chip focused | chip border `--accent`, text `--text-primary`, text selectable | `style.css:3394-3399` |
| Phone | band 44; label `top: 13px; left: 14px`; chip `top: 12px; left: 5px`; Copy 44 × 44 always visible | `style.css:7451-7472` |

The chip is a real `<input type="text">`, not a contenteditable span, so `Ctrl/Cmd+A`
selects the chip and not the note (`hybrid.js:8694-8699`).

| Property | Value | Source |
|---|---|---|
| Box | absolute, `top: 2px`, `left: 7px`, height 18, border-box, radius 4 | `style.css:3372-3388` |
| Type | `.72em/1.2` mono, padding `0 8px` — text starts at x = 16, the label's x | same |
| Face | `1px dashed --border`, `--bg-elev`, `--text-muted`, `cursor: text`, `min-width: 24px` | same |
| Width | `calc(Nch + 18px)` where N is the value length + 1, minimum 2ch + 18 | `hybrid.js:8707-8713` |
| Name | `aria-label="Fence language"`, `spellcheck="false"` | `hybrid.js:8704-8705` |
| Hover | border `--border`, text `--text-primary` | `style.css:3390-3393` |
| Focus | border `--accent`, text `--text-primary`; no outline | `style.css:3394-3399`, `:3387` |
| Enter | commit a valid language, focus the code end | `hybrid.js:8719-8733` |
| Esc | restore the previous value, focus the code end | `hybrid.js:8734-8740` |
| Blur | commit through the same path | `hybrid.js:8758-8782` |
| Invalid | reset to the previous value; toast `Language may use letters, digits, +, - and _` | `hybrid.js:8723-8730` |

Copy stays available while the fence is edited. Clicking it does not commit the fence
(`hybrid.js:8787-8790`).

---

## 6. Save and conflicts

### 6.1 Dirty

| Signal | Value | Source |
|---|---|---|
| Trigger | any input, structural edit, checkbox toggle, drag commit | `hybrid.js:6478-6490` |
| Save button | `hidden` removed the instant the document is dirty; the glyph is `💾`, not the word Save | `hybrid.js:6485`, `:6985` |
| Close button | `.unsaved`: `--accent` text and border, plus a 9 px `●` after the label | `hybrid.js:6486`; `style.css:1150-1160` |
| Tab | 8 px `--accent` dot before the label | `style.css:1207-1216` |
| Phone | tab bar is hidden; Save + the Done dot are the only dirty signals | `style.css:7085` |
| Save failure | `alert("Save failed: …")`; edits stay | `hybrid.js:7234-7236`, `:7258-7261` |

Dirty is cleared on a successful write, on a no-op save, and on exit
(`hybrid.js:6494-6501`, `:7223-7226`).

### 6.2 Save paths

| Path | Behaviour | Source |
|---|---|---|
| Save button (`💾`) | serializes, skips the POST when the bytes are unchanged, writes otherwise, then `notify("Saved")` | `hybrid.js:7243-7262` |
| `Mod+S` | `viewer.save()` delegates to `hybrid.save()` | `viewer.js:1063-1064` |
| Autosave on (default) | silent save after the configured quiet period, default 5 s; 60 s hard cap; hidden tab flushes immediately | `hybrid.js:6634-6652`, `:6689-6729`; `app.js:130-137` |
| Autosave failure | `console.warn` only; no interruption, no toast | `hybrid.js:6717-6721` |
| Autosave off | only the Save button, `Mod+S`, the Close prompt, and the tab-switch draft path | `hybrid.js:6671-6673` |

Autosave produces no spinner, no toast and no button state. The tab dot's disappearance is
the only persistent proof.

### 6.3 Exit with unsaved work

The Close / Done path asks once: `You have unsaved changes in "path". Save them before
exiting WYSIWYG mode?` OK saves then exits; Cancel discards and exits (the shipped
comment says "as before", `hybrid.js:7286-7289`). A failed save keeps the editor open with
the buffer intact (`hybrid.js:7290-7295`).

The desktop topbar toggle and `Mod+Shift+E` bypass this prompt and discard. That is
**P1**.

### 6.4 Tab switch and draft

| Condition | Result | Source |
|---|---|---|
| Clean | exits to preview | `hybrid.js:7336-7339` |
| Dirty, autosave on | saves silently, then exits | `hybrid.js:7340-7351` |
| Dirty, autosave off | stashes the serialized buffer in the viewer cache as a hybrid draft, then exits | `hybrid.js:7352-7360` |
| Draft shown | only in preview: `#draft-bar`, fixed bottom centre, `Unsaved changes in "name" from before the switch.` | `viewer.js:63-76`; `style.css:7791-7807` |
| Recover | enters hybrid on the saved bytes, swaps in the draft, records one undo step | `hybrid.js:7367-7375`; `viewer.js:83-97` |
| Discard | drops the draft and reloads the saved bytes | `viewer.js:108-113` |

Draft bar: `--z-draft` 80, `--bg-elev`, `1px --border`, radius 8, `0 6px 24px
rgba(0,0,0,.35)`, padding `10px 12px`, `.85rem`, bottom `24px + safe-area`. Recover is an
accent outline, not a fill (`style.css:7825-7828`). It is not shown while hybrid is active.

### 6.5 External change

| Condition | Result | Source |
|---|---|---|
| Fresh bytes equal our session source | ignored (own echo) | `hybrid.js:9117` |
| Fresh bytes equal an in-flight write | ignored | `hybrid.js:9118-9119` |
| Not dirty | re-renders, rebases, clears dirty | `hybrid.js:9129-9139` |
| Dirty | `confirm` with the discard/reload question | `hybrid.js:9120-9127` |
| Confirm OK | reloads from disk, rebases, clears dirty | same |
| Confirm Cancel | keeps the buffer; emits `viewer:conflict { conflict: true }` | `hybrid.js:9125` |

The conflict signal paints a `↻` in `--danger`, weight 700, with a 4 px left margin inside
the tab label (`tabs.js:678-684`; `style.css:1314-1318`). Its `title` is
`Disk has a newer version of this file (your edits are kept locally).` The next reload,
save or re-key clears it (`tabs.js:1670-1672`). Exception **E8** gives the glyph an
accessible name.

The prompt is the browser's `confirm`, not a custom dialog. Nothing in the page changes
while it is open.

---

## 7. Keyboard

Only the bindings whose effect is visible chrome are listed. The parser and transform
behaviour is `hybrid-editing.md` §4; the full chord table is `hybrid-shortcuts.md` §12.

| Key | Where | Visible effect |
|---|---|---|
| `Mod+Shift+E` | anywhere a writer has a note | toggles hybrid; discards unsaved work on exit (**P1**) |
| `Mod+S` | hybrid, caret in the page | save; `Saved` toast |
| `Esc` | language chip | restores the old language, focus returns to the code |
| `Enter` | language chip | commits, focus returns to the code |
| `Esc` | list drag in progress | cancels: ghost, proxy and line vanish, no mutation |
| `Ctrl/Cmd+Z` | list drag in progress | cancels the drag instead of undoing the note |
| `Alt+Up` / `Alt+Down` | list item | moves the item among siblings (keyboard path for the grip) |
| `Alt+Up` / `Alt+Down` | table cell | moves the row |
| `Alt+Shift+Left/Right` | table cell | moves the column |
| `Tab` / `Shift+Tab` | list item | indent / outdent |
| `Backspace` | caret at the first content position of a heading, list item or quote | removes that block's marker and leaves a paragraph; one press peels one layer (`../product/hybrid-block-marker-backspace.md` §3) |
| `Delete` | empty formatted block at the first content position | same marker removal; on a non-empty block it stays a forward character delete |
| `Tab` | inside the language chip | moves focus, does not indent the note (`hybrid-editing.md` §4.9) |
| `Mod+K`, `Mod+Shift+7/8/9`, `Mod+Shift+.`, `Mod+\` | caret inside one block | the edit-bar acts; refusals toast |

The grip and the table chip are focusable buttons, but they are created only while their
block is active. The grip's keyboard path is `Alt+Up/Down`; the table editor's explicit
keyboard path is the context menu's `Edit table…` item, with the chip as the direct focus
target. Every action they perform has a keyboard equivalent, so no action is drag-only or
hover-only (`foundations.md` §10.5 rule 4).

The chord display in Settings is read-only and lives in `index.html:917-965`; this
document does not own it.

---

## 8. States matrix

`muted` = `--text-muted`, `raised` = `--surface-raised`, `wash` = `--accent-soft`. `—` means
the state does not exist or paints nothing.

| Element | Rest | Hover | Focus-visible | Active / on | Dirty | Hidden |
|---|---|---|---|---|---|---|
| Editable page | 2 px `wash` inset outline, `text` cursor | — | outline `--accent` | — | — | read mode: no outline, no contenteditable |
| `#hybrid-toggle` | raised face, `1px --border`, primary glyph | `wash` face, `--accent` border | base `:where()` ring from controls §3.3 | `--accent` face, `--text-on-accent` label (E1) + ring | — | no note / viewer |
| Edit-bar Close | transparent, muted, `✕` | `wash` face, `--text-primary` | base ring | — | `--accent` text and border + 9 px dot | read mode |
| Edit-bar Save | hidden | — | base ring | — | visible; `💾` in `--accent` 600; hover accent fill + `--text-on-accent` (E1b) | clean |
| List grip | not drawn | `wash` face, `--border` border, `--text-primary` | 2 px `--accent`, offset 1 | `--accent` face, `--text-on-accent` (E6), `grabbing` | — | pointer away, scroll, exit |
| Table chip | not drawn | `wash` face, `--accent` border and glyph | 2 px `--accent`, offset 1 | — | — | pointer away, scroll, exit |
| Language chip | dashed `--border`, raised face, muted | solid `--border`, `--text-primary` | `--accent` border, `--text-primary`, no outline | — | edit marks dirty on commit | fence not editing |
| Fence Copy | `opacity: 0` | `wash` face, `--text-primary` | `opacity: 1` + own focus | `Copied!` accent text/border 1200 ms | — | not hovered/focused |
| Drop line | not drawn | — | — | 2 px `--accent`, 1 px `wash` ring | during drag | drop refused, no-op, cancel |
| Drag proxy | not drawn | — | — | raised chip, 220 px cap, shadow, z 2 | during drag | cancel, drop |
| Table rectangle | — | — | — | `wash` fill + inset 1 px `--accent` | held selection | cleared |
| Draft bar | — | — | action rings | raised bar, z 80, Recover accent outline | — | shown only in preview with a draft; `enter()` must re-run `updateDraftBar()` so a preview bar does not stay over the page |
| Conflict tab | — | — | — | `↻` in `--danger` | — | cleared on reload/save |
| Phone `#hybrid-toggle` | 44 × 44, transparent, `--text-primary` | — | base ring | `--accent` face (tap = Done) | Done dot | read mode |

---

## 9. Responsive and phone

The mode switch is `@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px))`
(`style.css:6975`). It is the only one (`foundations.md` §8.2).

| Element | Desktop | Phone | Source |
|---|---|---|---|
| `#hybrid-toggle` | ≈ 21 × 33 | 44 × 44, no border/fill at rest | `style.css:2680-2684`, `:7023-7046` |
| Active toggle | accent fill | same; tap exits through the Close prompt | `hybrid.js:9035-9038` |
| Edit bar | 63/119, wraps, Save hidden until dirty | 52 strip, horizontal scroll, Save/Done sticky left, order −1, 6 px right shadow, primary filled | `style.css:574-618`, `:7098-7142` |
| Flyout groups | present | hidden (Table, Examples, Emoji, List) | `style.css:7143-7146` |
| Source edit entry | present | hidden (`#edit-toggle`, `#cm-host`) | `style.css:7019`, `:7087` |
| Rail, capture, more | present | hidden while `body.edit-open` | `style.css:7152-7154` |
| Keyboard height | — | `#app` height is `100dvh − --m-kb` | `style.css:7155` |
| Page | 16/40/48 | 16/20/`24 + inset`; prose 16 px / 1.65 | `style.css:7422-7444`, `:7156-7158` |
| Fence band | 22 | 44 | `style.css:7452-7454` |
| Fence label | `top: 6; left: 16` | `top: 13; left: 14` | `style.css:3345-3356`, `:7455-7458` |
| Language chip | `top: 2; left: 7` | `top: 12; left: 5` | `style.css:3372-3375`, `:7459-7462` |
| Copy | 4/8 text button, hidden until hover | 44 × 44, always visible | `style.css:7464-7481` |
| List grip | 24 | 24, shown for the caret's item; `touch-action: none` | `list-edit.js:261-293`; `style.css:860-890` |
| Table chip | 24 | 24, shown on a focused cell or a table hover | `table-edit.js:125-149` |
| Table editor | modal | modal; the phone rule makes the table editor full-screen at ≤ 520 | `foundations.md` §8.2 |
| Tab strip | 34 | hidden; DOM kept | `style.css:7085` |
| Right-click menu | present | not available on touch; the edit bar carries the same acts | `hybrid-editing.md` phone surface |
| Drag grips | present | present in code (§3.1); see conflict **C2** | `list-edit.js:631-632` |

The phone has no hover. Every control that desktop reveals on hover has a non-hover path:
the copy button is always visible, the table chip appears on a focused cell, the grip
appears for the caret's item, and every drag has a menu or chord equivalent.

**C2.** `hybrid-editing.md` "Phone surface (v2)" says drag-reorder grips are desktop-only,
while §4.7.2 says touch uses the same Pointer Events path and `list-edit.js` enables on
`hybrid:entered` with no phone gate (`list-edit.js:631-632`). The shipped behaviour is the
one this document codifies: the grip is present on the phone. The architecture sentence
needs correcting.

The 24 px grip and table chip miss the 44 px coarse-pointer floor
(`foundations.md` §10.4). Exception **E7** grows their hit box to 44 × 44 on coarse
pointers, leftward and vertically only, so the visible 24 px box and the text to its right
are unchanged.

---

## 10. Tokens and CSS target

### 10.1 Reuse, never alias

Every value already maps to a foundation token. The target reads the token and keeps the
rendered value. No `--hybrid-*` family is introduced; no token aliases another.

| Shipped | Target | Visual delta |
|---|---|---|
| `var(--bg)` | `var(--surface-page)` | none |
| `var(--bg-elev)` | `var(--surface-raised)` | none |
| `var(--bg-panel)` | `var(--surface-panel)` | none |
| `var(--fg)` | `var(--text-primary)` | none |
| `var(--fg-muted)` | `var(--text-muted)` | none in light; dark follows `foundations.md` §3.6 |
| `2px` outline / line | `var(--stroke-2)` | none |
| `-2px` offset | `calc(-1 * var(--stroke-2))` | none |
| `24px` control box | `var(--control-h-sm)` | none |
| `4px` radius | `var(--radius-xs)` | none |
| `6px` radius | `var(--radius-sm)` | none |
| `0 6px 24px rgba(0,0,0,.35)` | `var(--shadow-pop)` | none in dark; light alpha .35 → .16 (`foundations.md` §5.4) |
| `z-index: 2` | `var(--z-inline)` | none |
| `20px` page top padding | `var(--space-5)` | none |
| `--bg` as grip label | `--text-on-accent` (E6) | dark 1a→14 only |
| `#fff` on accent | `--text-on-accent` (E1) | dark only |

Two global foundation decisions show through this surface and are not hybrid-specific: the
dark muted text is `#9799a4` (`foundations.md` §3.6), and a light-theme shadow is lighter
than the shipped literal. The mockup draws the shipped light shadow, so it matches today's
screen; the token target is lighter by design.

### 10.2 Exact rules, in landing order

**Prerequisite.** Foundations Appendix A and controls §3.3 step 1 land before these rules; otherwise a token rule is invalid at computed-value time and the chrome disappears. Until then, keep the shipped declarations.

Edit in place; no sweep of untouched rules. Only the declarations shown change; the rest of
each rule stays. Source order:

```css
/* style.css:2685 — active toggle; E1 + E1c */
#hybrid-toggle.active {
  background: var(--accent);
  color: var(--text-on-accent);
}
#topbar #hybrid-toggle.active:hover {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--text-on-accent);
}

/* style.css:2694 — editable page; tokens only */
#viewer-content.hybrid-editing {
  outline: var(--stroke-2) solid var(--accent-soft);
  outline-offset: calc(-1 * var(--stroke-2));
  cursor: text;
}
#viewer-content.hybrid-editing:focus {
  outline-color: var(--accent);
}

/* style.css:2737 — page top padding */
#viewer.hybrid-active #viewer-content {
  padding-top: var(--space-5);
  padding-bottom: var(--viewer-tail);
}

/* style.css:1174 — Save hover; E1b */
#edit-bar .eb-primary:hover {
  background: var(--accent);
  color: var(--text-on-accent);
}

/* style.css:604 — pressed edit-bar control; E1d */
#edit-bar .eb:active {
  background: var(--accent);
  color: var(--text-on-accent);
}

/* style.css:817 — table chip; tokens only */
.nb-te-open {
  width: var(--control-h-sm);
  height: var(--control-h-sm);
  border: var(--stroke-1) solid var(--border);
  border-radius: var(--radius-xs);
  background: var(--surface-raised);
  color: var(--text-muted);
}
.nb-te-open:focus-visible {
  outline: var(--focus-ring);
  outline-offset: 1px;
}

/* style.css:860 — list grip; tokens only; E6 */
.nb-list-grip {
  width: var(--control-h-sm);
  height: var(--control-h-sm);
  border-radius: var(--radius-xs);
  color: var(--text-muted);
}
.nb-list-grip:hover {
  background: var(--accent-soft);
  border-color: var(--border);
  color: var(--text-primary);
}
.nb-list-grip:active {
  background: var(--accent);
  color: var(--text-on-accent);
}
.nb-list-grip:focus-visible {
  outline: var(--focus-ring);
  outline-offset: 1px;
}

/* after style.css:890 — E7, coarse-pointer hit box; visual box unchanged */
@media (pointer: coarse) {
  .nb-list-grip::before,
  .nb-te-open::before {
    content: "";
    position: absolute;
    top: 50%;
    right: calc(-1 * var(--stroke-1));
    width: var(--control-h-touch);
    height: var(--control-h-touch);
    transform: translateY(-50%);
  }
}

/* style.css:797 — drag proxy; tokens only */
.nb-drag-proxy {
  font-size: var(--text-sm);
  background: var(--surface-raised);
  color: var(--text-primary);
  border: var(--stroke-1) solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-pop);
  z-index: var(--z-inline);
}

/* style.css:777 — drop line */
.nb-drop-line {
  background: var(--accent);
  box-shadow: 0 0 0 var(--stroke-1) var(--accent-soft);
}

/* style.css:3372 — language chip; tokens only */
.hybrid-lang-pill {
  border-radius: var(--radius-xs);
  border: var(--stroke-1) dashed var(--border);
  background: var(--surface-raised);
  color: var(--text-muted);
}
.hybrid-lang-pill:hover {
  border-color: var(--border);
  color: var(--text-primary);
}
.hybrid-lang-pill:focus {
  border-color: var(--accent);
  color: var(--text-primary);
}

/* after style.css:3335 — E9, reduced motion */
@media (prefers-reduced-motion: reduce) {
  .code-copy-btn { transition: none; }
}

/* style.css:7791 — draft bar; colours and elevation only */
#draft-bar {
  background: var(--surface-raised);
  border: var(--stroke-1) solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-pop);
  z-index: var(--z-draft);
}
```

E7's box is exactly `--control-h-touch` square: its right edge sits on the button's outer
right, so it grows 20 px left and 10 px above and below the visible 24 px face. No text is
under the added area.

### 10.3 One-off literals retained

Kept as shipped, because changing them changes the look and no token expresses them:

| Value | Where | Why it stays |
|---|---|---|
| `2px` block radius | `style.css:2754` | Off the radius scale; it is the smallest softening, not a component radius |
| `22px` / `44px` fence band | `style.css:3282`, `:7453` | A fixed band, not a spacing rung; owned by `content-blocks.md` |
| `18px` chip height, `top: 2; left: 7` | `style.css:3374-3377` | Fits inside the 22 px band; text must start at 16 px |
| `.72em`, `.76rem` fence type | `style.css:3301`, `:3351` | `.72em` tracks the code's own size; `.76rem` is the shipped copy label |
| `220px`, `3px 8px` proxy | `style.css:799-801` | Chip geometry |
| `120ms` hide grace | `list-edit.js:43`; `table-edit.js:23` | Hover-intent delay, shorter than `--dur-1` |
| `10px`, `12px`, `.85rem` draft bar | `style.css:7799-7806` | Shipped bar, predates the grid; snap on its next edit |
| `1px` radius on drop line | `style.css:781` | A hairline bar rounding; not a control radius |
| `z-index: 6` overlays | `style.css:768`, `:855` | Local stack; foundations has no token for 6 |
| `9px` unsaved dot | `style.css:1158` | `--text-2xs`, fixed |
| `1px` focus offset | `style.css:839`, `:889` | Two overlay controls sit in a gutter; an outset ring can clip at the viewer edge. P4 revisits it |

### 10.4 Applied exceptions

Only accessibility or consistency. E1, E1b, E1c and E1d are visible; the rest are semantic
or setting-only.

| # | Change | Why | Cost |
|---|---|---|---|
| **E1** | `#hybrid-toggle.active` colour → `--text-on-accent` | White on the dark accent is 2.61:1; the token is 6.99:1 (`foundations.md` §3.6) | Dark label goes near-black on blue |
| **E1b** | `#edit-bar .eb-primary:hover` colour → `--text-on-accent` | Same 2.61:1 failure on the Save hover (`foundations.md` §3.6 lists `:1174`) | Dark only |
| **E1c** | `#topbar #hybrid-toggle.active:hover` keeps the accent face | The shipped hover rule outranks `.active` and leaves white on the pale wash | Hovering the active button no longer washes out |
| **E1d** | `#edit-bar .eb:active` colour → `--text-on-accent` | Same 2.61:1 failure while pressed (`foundations.md` §3.6 lists `:604`) | Dark only; the press is transient |
| **E2** | `aria-pressed="true\|false"` on `#hybrid-toggle`, set on enter/exit | The toggle's state is visual only (`shell-frame.md` §9.3) | None |
| **E3** | `aria-label="Note content editor"` on `#viewer-content` while active; removed on exit | The editable region has no accessible name | None |
| **E4** | `aria-keyshortcuts="Control+Shift+E Meta+Shift+E"` on `#hybrid-toggle` | The chord is not announced | None |
| **E5** | On the explicit Close/Done path, exit returns focus to `#hybrid-toggle` (not on a tab switch or tab close); the toggle's `aria-label` switches between "Enter WYSIWYG mode" and "Exit WYSIWYG mode" | Removing `contenteditable` strands focus on a non-editable div, and a pressed toggle still named for entry reads wrong | Keyboard users see the toggle's ring; the name matches the action |
| **E6** | `.nb-list-grip:active` colour → `--text-on-accent` | A surface token used as a label; the label token is the correct name | Dark shifts 1a1b1f → 14151a |
| **E7** | Coarse pointer: 44 × 44 hit box for the grip and table chip | 24 px misses the 44 px floor (`foundations.md` §10.4) | None; the hit box grows left and vertically |
| **E8** | Conflict badge gets `role="img"` + `aria-label="Changed on disk"` | `↻` alone is announced as a glyph, and the meaning lives in `title` | None |
| **E9** | `prefers-reduced-motion`: `.code-copy-btn { transition: none }` | The only transition in the surface has no twin (`foundations.md` §7.3) | Reduce setting only |
| **E10** | Task checkbox `aria-label="Done"` / `"Not done"`, updated on toggle | The checkbox is live in hybrid and has no name (`reader.md` P5) | None |

E5 is the one exception a product owner could reject: it moves focus into chrome on exit.
It is the dialog convention (`controls.md` §2.11) and returns the user to the control they
pressed.

### 10.5 Conflicts recorded

| # | Conflict | Evidence | Position |
|---|---|---|---|
| C1 | Comment promises a block hover highlight; the rule only sets a radius | `style.css:2742-2755` | No hover highlight ships. Do not implement the comment. |
| C2 | Phone surface says list grips are desktop-only; §4.7.2 and the code put them on touch | `hybrid-editing.md` phone surface vs §4.7.2; `list-edit.js:631-632` | Shipped wins: grips are present on the phone. Correct the architecture sentence. |
| C3 | The active toggle's hover loses its fill by specificity | `style.css:202` vs `:2685-2688` | E1c. |
| C4 | Desktop topbar toggle and `Mod+Shift+E` discard unsaved work with no prompt, while Close prompts | `hybrid.js:9035-9039`, `:7302-7303` | Shipped. P1 proposes routing both through Close. |
| C5 | `.nb-te-open` rest border is `--border` (1.39:1 dark / 1.27:1 light), below the 3:1 control-boundary floor; the shipped docs require `--border-strong` | `style.css:825`; `controls.md` §2.4 | P5. The glyph carries the affordance today, so this is drift, not a blocker. |
| C6 | `#hybrid-toggle` is ≈ 21 px tall on desktop, under the 24 px floor | `style.css:2680-2684`, `:192-201` | P6: grow to `--control-h-sm` with no visual box change beyond 3 px. |

---

## 11. Acceptance criteria

Each is observable in the app or the mockup and names its file.

| # | Criterion | File | Observable |
|---|---|---|---|
| **AC1** | The toggle is visible only for an open, writable note and reports its state | `hybrid.js`, `index.html` | `#hybrid-toggle.hidden` is true with no note or `role="viewer"`; after entry it has `aria-pressed="true"` and `.active` |
| **AC2** | Entry lands focus on the page and paints the region | `hybrid.js`, `style.css` | After enter, `document.activeElement` is `#viewer-content`, the outline is 2 px `--accent`, and the page top padding is 20 px |
| **AC3** | Read/edit parity | `hybrid.js`, `style.css` | No prose size, block margin or block colour changes between modes; the layout delta is the appearance of the bar (63/119) plus the 4 px top padding, and the paint delta is the inset outline |
| **AC4** | Block chrome is exactly four controls | `style.css`, `list-edit.js`, `table-edit.js` | A paragraph, heading, quote, image and rule show no hover outline, handle or menu; a list shows one grip, a table one chip, a fence one copy chip |
| **AC5** | The list grip carries its name and full state set | `list-edit.js`, `style.css` | The grip is `24 × 24`, `aria-label="Reorder list item"`, its rest/hover/pressed/focus treatments match §3.1, and it hides 120 ms after the pointer leaves |
| **AC6** | The table chip is placed in the gutter and never covers text | `table-edit.js` | The chip's right edge is 4 px left of the table; its top is the header row's centre; it clamps 8 px inside `#viewer` |
| **AC7** | Overlays are outside the editable subtree and hide on scroll | `list-edit.js`, `table-edit.js` | `#viewer-content.contains(overlay) === false`; scrolling calls `hide()`; no overlay node appears in `domToMarkdown()` |
| **AC8** | Drag chrome matches §4.1 | `list-edit.js`, `style.css` | Ghost is `--accent-soft`, proxy is ≤ 220 px with `--shadow-pop`, the drop line is 2 px `--accent`, and `body.nb-list-drag` sets `grabbing` |
| **AC9** | The fence changes no height on edit | `style.css`, `hybrid.js` | A labelled fence and the same fence with the chip focused have equal `offsetHeight`; the label is hidden and the chip starts at x = 16 |
| **AC10** | Copy is revealed by hover and focus, and is 44 px on the phone | `style.css` | Desktop copy is `opacity: 0` until `pre:hover`/`:focus-within`; at 390 it is 44 × 44 and `opacity: 1` |
| **AC11** | Dirty is visible without colour alone | `hybrid.js`, `style.css` | The Close button gains `.unsaved` (accent border + dot) and the tab gains an 8 px dot; Save appears on the first change |
| **AC12** | A save writes nothing when the bytes are unchanged and toasts only on an explicit save | `hybrid.js` | An untouched save makes no POST; `Mod+S` after an edit shows `Saved`; autosave shows nothing |
| **AC13** | An external change while dirty prompts, and Cancel marks the tab | `hybrid.js`, `tabs.js` | The confirm text matches §6.5; Cancel keeps the buffer and paints `↻` in `--danger` with an accessible name |
| **AC14** | Every drag has a keyboard equivalent | `hybrid.js` | `Alt+Up/Down` moves a list item and a table row; `Alt+Shift+Left/Right` moves a table column; no action is drag-only |
| **AC15** | Phone: 44 px targets, sticky Save/Done, 44 px band | `style.css` | At 390 the toggle is 44 × 44; Save/Done stay at the left while the strip scrolls; the fence band and copy are 44 px |
| **AC16** | Tokenised values, no new hex | `style.css` | The diff adds no hex; the rules in §10.2 read foundation tokens; the list in §10.3 is the only literal set |
| **AC17** | Reduced motion removes the copy fade | `style.css` | With reduce emulated, `.code-copy-btn` has no transition |
| **AC18** | The mockup is self-contained | `docs/ui/hybrid-mode-mockup.html` | Opening it offline shows both themes and all ten boards with zero network requests |
| **AC19** | Marker removal leaves a paragraph and keeps the text | `hybrid.js` | At T in a heading, list item or quote, Backspace leaves a `<p>` with the same text and the caret at its first character; Delete on a non-empty block stays a forward delete |

Tests that assert the shipped state today:

| Suite | What it pins |
|---|---|
| `tests/dom/test_dom.js:7929-7991` | enter sets contenteditable, `.hybrid-editing`, `.active`, shows the bar, hides Preview; dirty shows Save |
| `tests/dom/test_dom.js:8034-8038` | empty-list marker placeholder is stripped from markdown |
| `tests/dom/test_dom.js:11182-11290` | table overlay enable/reveal/hide and the `.nb-te-open` button |
| `tests/dom/test_dom.js:5133-5164` | copy-image injects before hybrid and removes on `hybrid:will-enter` |
| `tests/dom/test_dom.js:13808-14281` | block-marker removal at T: heading, list, task, quote, empty block, nested peel |
| `tests/dom/test_dom.js:18113-18594` | list-edit loads, starts and cancels a drag, and announces the moved item |
| `tests/browser/test_hybrid_browser.js:1657-1779` | the real-engine list drag: grip reveal, drag state, hit region |
| `tests/browser/test_hybrid_browser.js:2437` | block-marker Backspace / forward Delete at T in a real engine |
| `tests/browser/test_hybrid_blocks_browser.js:253-271` | the draft is kept, the Recover bar appears, Recover restores the WYSIWYG buffer, nothing is written |
| `tests/browser/test_hybrid_blocks_browser.js:326-347` | Ctrl+drag paints a rectangle and copies TSV without touching the note |
| `tests/browser/test_block_edit_browser.js:141-160` | the language chip is an input in the band, commits on Enter and restores on Esc |

Any change to `#hybrid-toggle.active` (E1), `.nb-list-grip:active` (E6) or the overlay
`outline-offset` will be caught by the browser suites only if they assert computed style;
they currently assert presence and behaviour, so add one computed-colour check per
exception.

---

## 12. Proposals, not applied

| # | Proposal | Why | Cost |
|---|---|---|---|
| **P1** | Route the desktop topbar `✎` and `Mod+Shift+E` through the Close prompt | Two exit paths silently discard unsaved work while the visible Close button asks (`hybrid.js:9035-9039`, `:7302-7303`) | One call-site change; the toggle stops being a one-press flip when dirty |
| **P2** | A block handle for every block (drag to reorder; menu on click) | Only list items can be reordered by drag; a Word-like editor normally moves any block | New overlay, serialization for arbitrary subtrees, full keyboard parity, block-level undo; a second list-drag-sized module |
| **P3** | A hover wash on the hovered block | Makes the caret target obvious; the shipped comment claims it exists | Chrome over prose, flicker while moving the mouse, and the user likes the current quiet page |
| **P4** | Align the overlay controls' `outline-offset` from `1px` to `var(--focus-offset)` | One ring idiom | A 1 px visual shift on two controls; risks clipping at the viewer edge |
| **P5** | `.nb-te-open` rest border → `--border-strong` | The current `--border` is under the 3:1 control-boundary floor | The chip gains a visibly darker outline |
| **P6** | Grow `#hybrid-toggle` to `--control-h-sm` (24 px) | Shipped ≈ 21 px misses the desktop floor | 3 px taller; the topbar action row shifts slightly |
| **P7** | Replace `💾` and `✎` with sprite symbols | Foundations §9.3 replaces chrome glyphs; both are emoji today (`hybrid.js:46`, `index.html:178`) | A visible glyph swap; the user likes the current icons |
| **P8** | Reserve the Save button's slot while clean | Save appears on the first keystroke and pushes Close right by its width | An empty 40 px slot in the bar at rest |
| **P9** | A persistent save status ("Saved 12:04") in the edit bar | Autosave is invisible; the tab dot clearing is the only proof | New chrome text; competes with the toolbar |
| **P10** | A conflict banner in the page instead of a tab glyph | The `↻` meaning lives in `title`; a touch user cannot read it | A new in-page surface and a dismiss path |
| **P11** | Give the fence chip a real focus ring | It relies on a 1 px border colour change inside a 22 px band | The ring clips or overhangs the band |
| **P12** | Show the block marker in the gutter on hover (`#`, `-`, `>`) | Teaches the Markdown mapping while editing | New gutter chrome, alignment work per block type, and the marker is already rendered |

---

## 13. What not to build

- **No generic block chrome.** No hover outline, pencil, drag handle or `⋮` on paragraphs,
  headings, quotes, images, rules or diagram cards.
- **No second editing surface.** No floating toolbar at the caret, no inline bubble menu,
  no per-block source toggle. The edit bar and the context menu are the two entries.
- **No table grips or row/column drag in hybrid.** The architecture rejects them; the
  table editor modal owns structure (`hybrid-editing.md` G3).
- **No drag-only action.** Every grip and chip action keeps its menu or chord twin
  (`foundations.md` §10.5 rule 4).
- **No custom tooltip.** `title` plus `aria-label` only (`controls.md` §2.10).
- **No new overlay layer.** The two existing layers own their nodes; do not merge them or
  add a third.
- **No page transition.** No fade on entry or exit, no animated outline, no caret
  animation, no scroll animation (`foundations.md` §7.4).
- **No second selection colour.** The reader's `::selection` token pair is the only one.
- **No resized or restyled prose, table, code or diagram.** Those belong to `reader.md` and
  `content-blocks.md`.
- **No new breakpoint or container query.** The phone query is the only mode switch.
- **No source-mode chrome in hybrid.** Preview, split and CM6 controls stay hidden.
- **No image resize handles, caption editor or alt-text editor.** None ship.
- **No custom confirm dialog.** The external-change prompt is the browser's `confirm`.
- **No `filter`, `opacity` or `color-mix()` as a state.** Only the shipped copy fade and
  drag opacity exist, and the fade gets a reduced-motion twin.
