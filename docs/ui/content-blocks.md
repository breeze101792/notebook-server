# Content blocks — code, tables, figures, math, diagrams, live HTML

Status: Current spec — pre-implementation (codifies the shipped render).

Reference mockup: [`content-blocks-mockup.html`](content-blocks-mockup.html) — dark and
light, a wide desktop reader and the 390 phone reader, and the code, table, figure,
math, diagram-card, error and live-HTML boards in every reachable state.

**Normative source.** This document owns every block `marked` can put inside
`#viewer-content` except prose and task-list checkboxes. Prose rhythm and headings are
owned by the reader document; task-list checkboxes are reader prose and are not
restyled here. It reads [`foundations.md`](foundations.md) for tokens and
[`controls.md`](controls.md) for control anatomy. The edit windows — table editor,
Mermaid designer, DOT/WaveDrom designer — and the lightbox chrome are out of scope; this
document names only the trigger.

**The shipped look is the target.** The user likes the current rendering. This document
codifies it exactly and does not redesign it. Anything that would change a pixel is in
§12, proposals only. The only additions are semantic, for accessibility or consistency;
§9.6 records each one.

Source material, not current specs: `docs/archive/ui/code-block-chip.md` (the fence
band), `docs/archive/design/table-editor.md` and `table-editor-selection.md` (the edit
windows), `docs/archive/design/graph-3d.md` (diagram drawing only). Where they disagree
with this document, this document wins.

Every claim about current code cites `file:line`.

---

## 1. Block rhythm

### 1.1 One gap

On desktop every block-level construct carries the same top and bottom margin: `.7em`
(9.8 px at 14 px). The phone is not uniform: the paragraph `.85em` is 13.6 px, the fence is
9.1 px (13 px pre type), and a card is 11.2 px. Keep the desktop invariant; do not claim one
phone gap.

| Block | Rule | Value | Source |
|---|---|---|---|
| Paragraph | `.markdown-body p` | `.7em 0` | `style.css:3157` |
| List | `.markdown-body ul, ol` | `.7em 0` | `style.css:3162` |
| Quote | `.markdown-body blockquote` | `.7em 0` | `style.css:3245` |
| Code fence | `.markdown-body pre` | `.7em 0` | `style.css:3264-3279` |
| Table | `.markdown-body table` | `.7em 0` | `style.css:3760` |
| Figure, `dl`, `details` | grouped rule | `.7em 0` | `style.css:3190` |
| Mermaid card | `.mermaid-container` | `.7em 0` | `style.css:3408` |
| WaveDrom card | `.wavedrom-container` | `.7em 0` | `style.css:3476` |
| Math card | `.katex-container` | `.7em 0` | `style.css:3498` |
| Graphviz card | `.viz-container` | `.7em 0` | `style.css:3523` |
| SVG card | `.svg-container` | `.7em 0` | `style.css:3545` |
| Live HTML card | `.htmlpreview-card` | `.7em 0` | `style.css:3631` |
| Error box, all five types | grouped rule | `.7em 0` | `style.css:3429-3438` |

Two constructs are deliberately off the grid and are not this document's to change: the
`hr` at `1.5em` (`style.css:3764`) and headings at `1.4em` top / `.5em` bottom
(`style.css:3142-3146`).

### 1.2 First and last child

`.markdown-body > :first-child { margin-top: 0 }` (`style.css:3153`) removes the top
margin of the first block so the reader's 16 px top padding is the only space under the
topbar. There is **no** matching last-child rule. The last block keeps its `.7em` bottom
margin inside the reader's 48 px tail (`--viewer-tail`, `style.css:2392-2402`). Do not add
a last-child collapse: it would change the shipped scroll height.

### 1.3 Why the gap is shared

On desktop a toolbar toggle (paragraph ↔ list, quote, code fence) must not move the blocks
around the line. Every construct uses `.7em`, so toggling a line changes only that block's
own height. On the phone the three gaps differ by up to 4.5 px; that is shipped and is not
part of this pass. The fence band follows the same rule: the 22 px header band is reserved in every
fence state, so clicking a fence never changes its height (`code-block-chip.md:§2`).

The code fence is the one block whose *inner* top padding is not prose-relative: the
vendor theme adds `1em` inside `<code>` (`github-dark.css:1`, `github.css:5`). See §2.6.

---

## 2. Code fences

### 2.1 Anatomy

```
┌──────────────────────────────────────────────┐  border 1px --border, radius 8
│ c                                  [ Copy ]  │  band 22; label top 6 left 16
│                                              │
│     static int ds18b20_read(...)             │  code padding 1em (vendor)
│     {                                        │  code .88em mono, wraps
└──────────────────────────────────────────────┘
```

| Part | Shipped value | Source |
|---|---|---|
| Outer `<pre>` | `background: var(--code-bg)`; `1px solid var(--border)`; `border-radius: 8px`; `padding: 14px 16px`; `margin: .7em 0`; `white-space: pre-wrap`; `overflow-wrap: anywhere`; `overflow-x: clip`; `position: relative` | `style.css:3264-3279`, `:3296` |
| Fence top padding | `padding-top: 22px` when the pre has a direct `<code>` child | `style.css:3281-3283` |
| Inner code | `display: block`; `padding: 1em`; `background: none` (app); `font-size: .88em`; mono stack | `style.css:3284-3290`; `github-dark.css:1`; `github.css:5` |
| Band | the 22 px top padding. No fill, no divider, no separate bar: the block's own well colour runs to the top edge | `style.css:3281-3283` |
| Language label | generated `::after`; `content: attr(data-fence-lang)`; `top: 6px`; `left: 16px`; `max-width: calc(100% - 96px)`; `.72em/1.2` mono; `--fg-muted`; `nowrap`; `overflow: hidden`; `pointer-events: none`; `z-index: 0` | `style.css:3345-3356` |
| Copy button | `position: absolute`; `top: 1px`; `right: 10px`; `z-index: 2` inside a fence; `font-size: .76rem`; `line-height: 1`; `padding: 4px 8px`; `radius: 4px`; `1px --border`; `--bg-elev`; `--fg-muted`; `opacity: 0` | `style.css:3297-3313`, `:3362-3366` |

**Code text origin.** The label starts at x = 16 px. The code text starts at
x = 16 + 1em, where 1em is the code's own font size: 12.32 px at the desktop base, so
≈ 28.3 px. This offset is shipped. §12 P3 proposes removing it; do not apply that here.

**Vertical measurement.** The band is 22 px. The first code line starts 22 + 12.32
≈ 34.3 px below the top border on desktop, and 44 + 11.44 ≈ 55.4 px on the phone. The
copy button sits in the band at 1.0, not over the first line (`style.css:3361-3366`). At
`--font-scale: 1.3` the button measures ≈23.8 px against the 22 px band and overhangs the
first line by ≈3.8 px; the band is px and the button rem. P17 records the repair.

### 2.2 Markup and the generated label

```html
<pre data-fence-lang="c"><code class="language-c hljs"><span class="hljs-…">…</span></code>
  <button type="button" class="code-copy-btn" aria-label="Copy code to clipboard">Copy</button>
</pre>
```

- `viewer.js` records the **authored** language before highlight.js runs, from marked's
  first `language-*` class, into `data-fence-lang` on the `<pre>` (`viewer.js:449-459`).
  A bare fence gets no attribute; a guessed language is never shown.
- highlight.js then highlights every `pre code` (`viewer.js:467-472`). A thrown error is
  swallowed and the plain text stays.
- The label is generated text, not a node: it cannot be selected, copied, saved, undone,
  or take a caret (`style.css:3337-3344`).
- The copy button is appended to every `<pre>` in view mode only; live edit preview has
  no button (`viewer.js:484-493`).

### 2.3 States

| State | Label | Copy | Block |
|---|---|---|---|
| Rest, pointer away | visible, `--fg-muted` | `opacity: 0`, still in tab order | unchanged |
| Hover / focus within | visible | `opacity: 1` | unchanged |
| Copy button hover | visible | `--accent-soft` face, `--fg` text | unchanged |
| Copy button focus | visible | `opacity: 1`; browser focus ring (no `outline` reset) | unchanged |
| Copied (1.2 s) | visible | text `Copied!`; `--accent` text and border; toast `Copied to clipboard` | unchanged |
| Copy fails (2.2 s toast) | visible | text stays `Copy`; toast `Copy failed` | unchanged |
| No language | band reserved, no `::after` | visible on hover | same height as a labelled fence |
| Hybrid edit | label hidden; the language chip occupies its place | not in the editable DOM | unchanged band (`style.css:3358-3360`; chip out of scope) |

Copy behaviour is owned by `copy-image.js` (`attachTextCopy`, `:684-729`): raw
`textContent` with every `.code-copy-btn` removed, the label flips to `Copied!` for
1200 ms, and one polite toast fires (`copy-image.js:61-66`, `:248`).

### 2.4 No-language fence

A fence with no info string has no `data-fence-lang`; the `:has(> code)` rule still
reserves 22 px (`style.css:3281-3283`). The band is empty. Do not collapse it: an empty
band is what keeps a bare fence the same height as a labelled one and gives the copy
button a home.

### 2.5 Long lines

Long lines wrap; there is no horizontal scrollbar inside code:

- `pre` and `pre code` both set `white-space: pre-wrap`, `overflow-wrap: anywhere`, and
  `overflow-x: clip` (`style.css:3268-3278`, `:3284-3288`).
- The app rule overrides the vendored `pre code.hljs { overflow-x: auto }`
  (`github-dark.css:1`, `github.css:5`) with a higher-specificity selector
  (`style.css:3284-3285`).
- A single 180-character token breaks at any character. The block grows vertically; the
  note page is the only scroller (`architecture/markdown.md:214-230`).

### 2.6 Highlight contrast

The syntax theme is the vendored GitHub theme, switched by two `<link>` elements
(`templates/index.html:39-40`). The app paints no token colours.

| Pair | Ratio | Verdict |
|---|---|---|
| Dark base `#c9d1d9` on `--code-bg` `#14151a` | 11.81 | pass |
| Light base `#24292e` on `--code-bg` `#f0f2f5` | 13.08 | pass |
| Light keyword `#d73a49` on `#f0f2f5` | **4.08** | fail for body text |
| Dark keyword `#ff7b72` on `#14151a` | 7.23 | pass |

The light keyword failure is shipped. §9.5 records it and §12 P2 proposes a new vendor
value; neither changes the current look.

### 2.7 Error fences

A fence whose plugin renderer fails is replaced by that renderer's error box, not by a
code fence. The box is `1px --warn`, radius 8, `overflow: hidden`, margin `.7em`
(`style.css:3429-3438`). Its head is a `--warn` fill with `color: var(--bg)`, `.86rem`,
600, `6px 12px` (`style.css:3439-3449`). Its source is a text-only `<pre>`. The computed look is the page's code-block shell, not
the export's: `--code-bg`, `1px --border`, radius 8, margin `.7em`, `14px 16px`, `.85rem/1.4`,
wrapping (`style.css:3264` wins over `:3450`). `export.js:926` scopes the source rule more
tightly and paints the borderless `10px 12px` version; that app/export divergence is recorded
in §12.

The source `<pre>` has no `<code>` child, so `pre:has(> code)` does not apply: there is no
band and no language label. The shared copy button still injects into it (viewer selects
every `pre`, `viewer.js:491-492`) at the base position `top: 6px; right: 6px`
(`style.css:3297-3300`), over the first source line. §12 P8 proposes moving it; do not
apply that here.

### 2.8 Phone (≤ 860 px, or coarse ≤ 1023 px)

| Part | Value | Source |
|---|---|---|
| Pre | `padding: 12px 14px`; `font-size: 13px` | `style.css:7446-7450` |
| Fence | `padding: 44px 14px 12px` | `style.css:7452-7454` |
| Label | `top: 13px`; `left: 14px` | `style.css:7455-7458` |
| Copy | `top: 0`; `right: 0`; `44px × 44px`; `padding: 0`; `opacity: 1`; `font-size: 12px` | `style.css:7464-7472` |
| Inner code | still `1em` padding from the vendor; `.88em` → 11.44 px at the 13 px pre | `github.css:5` |

The 44 px copy target is always visible because there is no hover on touch. The label and
the 44 px button share the 44 px band; the label's `max-width: calc(100% - 96px)`
(`style.css:3350`) keeps it clear of the button.

### 2.9 Actions

The code fence has one action: **Copy**. There is no per-fence edit button. In hybrid
mode a fence becomes editable by the shared click-to-edit path and the context menu
(`architecture/hybrid-editing.md`); the language chip is part of that edit window and is
out of scope here.

---

## 3. Tables

### 3.1 Anatomy

| Part | Shipped value | Source |
|---|---|---|
| Table | `border-collapse: collapse`; `display: block`; `max-width: 100%`; `overflow-x: auto`; `margin: .7em 0` | `style.css:3760` |
| Cell | `1px solid var(--border)`; `padding: 6px 10px` | `style.css:3761` |
| Header | UA `<th>`: bold, centred unless GFM alignment says otherwise. **No background rule.** | `style.css:3761` only |
| Body zebra | odd rows `--bg-panel`; even rows `--bg` | `style.css:3762-3763` |
| Phone | `overscroll-behavior-x: contain`; `border-radius: 8px` | `style.css:7482-7485` |

`display: block` makes the table box fill the measure and become the horizontal
scroll container. The cell grid keeps its content width: a short table does not stretch
its columns, and a wide table pans inside the box. The page never scrolls sideways
(`style.css:2386`).

GFM alignment is carried by marked as an `align` attribute on each `th`/`td`. The
stylesheet does not override it, so the browser applies it. Do not add a `text-align`
rule: it would erase the author's alignment.

### 3.2 Content states

| State | Render |
|---|---|
| Empty body | `<thead>` only. There is no empty-state row, illustration, or message. |
| One column | Allowed. The preview control refuses to hide the last visible column. |
| Long cell | The cell grows; the table pans; text wraps only at its normal breaking points. |
| Merged cell | Renders as authored. Preview controls and rectangle selection are refused (below). |
| Wide table | The table pans horizontally; the header pans with the body (no sticky header). |
| Narrow reader | Same; the table gets the whole measure and pans. |
| Phone | Same, with no preview controls and no rectangle selection. |

### 3.3 Preview controls

The `.nb-tv-*` anatomy is codified here for the reader. `controls.md` lists the same classes
as inventory only; where the two differ, this section wins and P17 carries the 24 px floor.


The controls are view-only: they never touch the Markdown source. They are a child of
`#viewer`, outside `#viewer-content`, and are torn down before hybrid editing
(`table-view.js:14-30`).

**The icon.** A 24 × 24 button in the table's left gutter, vertically centred on the
header row, 6 px from the table, at least 4 px from the pane edge
(`table-view.js:55-61`, `:557-600`). It is `--bg-elev`, `1px --border`, radius 4,
`--fg-muted`, glyph `≡` (`U+2261`). Hover is `--accent-soft` + `--fg`; focus-visible is a
2 px `--accent` outline at 1 px offset (`style.css:940-957`). It is hidden until the
pointer is over the table or focus is inside it; scrolling or resizing hides it again and the next
hover/focus re-reveals it (`table-view.js:1221-1222`). Clicking opens the toolbar; the glyph
becomes `✕` and `aria-expanded` flips (`table-view.js:635-650`).

**The toolbar.** A flex row, 2 px padding, 2 px gap, `--bg-elev`, `1px --border`,
radius 6, shadow `0 6px 24px rgba(0,0,0,.35)` (`style.css:959-986`). Three buttons:
`Rows`, `Columns`, `Reset` (`table-view.js:651-663`).

| Button | Popover |
|---|---|
| Rows | One checkbox per **body** row, label `#N — <first cell>` truncated at 28 characters (`table-view.js:782-805`). Empty: `No body rows` (`.nb-tv-empty`, `:1032-1036`). |
| Columns | One checkbox per header column, label `#N — <header>`. Hiding the last visible column is refused with the toast `At least one column must stay visible` (`table-view.js:810-823`). |
| Reset | Clears sort and every hidden row/column, restores source order (`table-view.js:660-663`, `:544-552`). |

**The popover.** `min-width: 180px`, `max-height: 320px`, `overflow: auto`, 4 px padding,
`--bg-elev`, `1px --border`, radius 6, the same shadow, `z-index: 8`
(`style.css:987-999`). Items are 4px 8px, `.8rem`, full width, left aligned, hover
`--accent-soft`, focus-visible inset 2 px ring (`style.css:1000-1015`).

**Sorting.** Clicking a header **title** toggles ascending → descending → ascending; it
never clears (`table-view.js:858-865`). A different column starts ascending. `Clear sort`
exists only in that column's header menu. There is exactly one sorted column; the active
`<th>` carries `aria-sort` and `.nb-tv-sorted` (`table-view.js:424-433`).

The header's own menu icon is a 16 × 16 fixed box with one chevron `▾` (`U+25BE`), 6 px
after the title, reserved with `visibility: hidden` so revealing it never shifts the
text (`style.css:1074-1092`). It is visible on header hover/focus-within, on the sorted
column, and while its menu is open (`style.css:1093-1096`). The sorted icon turns
`--accent` and rotates 180° for ascending; descending keeps 0° (`style.css:1106-1112`).
This one glyph is the only sort indicator; do not add a second arrow.

Sorting rules (`table-view.js:436-458`): empty cells sort last in both directions; a
column is numeric only when both compared non-empty values are numeric; otherwise the
`Intl.Collator` is used; ties keep source order.

**Persistence.** Per file, per table, in `localStorage` under `nb:tableView` (or
`nb:<workspace>:tableView`). The record is applied only when the header signature, the
body hash, and the table ordinal all match; otherwise it is ignored, not deleted. The
state never enters the note, an export, or the hybrid round-trip (`table-view.js:1-50`).

### 3.4 Merged cells

A table with any `colspan`/`rowspan` gets no session, no icon, no toolbar
(`table-view.js:326-337`). Hovering it shows one note anchored to the table's top-left
(`table-view.js:912-936`):

> Merged cells: table view controls are unavailable

The note is `.nb-tv-note`: absolute, `2px 8px`, `.74rem`, `--fg-muted`, `--bg-elev`,
`1px --border`, radius 4, `pointer-events: none`, nowrap (`style.css:1038-1049`). It sits
over the table's top-left corner, including the header. Rectangle selection refuses the
same table (`table-select.js:82-93`).

The table itself still renders and still pans. Editing stays available through the
Markdown source or the hybrid table editor, which opens read-only and shows its own
refusal (`docs/archive/design/table-editor.md` §6). Those windows are out of scope.

### 3.5 Rectangle selection

Hold the platform primary modifier — Ctrl on Windows/Linux, Cmd on macOS — and drag
across cells (`table-select.js:1-22`). The gesture arms on `mousedown` and suppresses the
native selection/DnD, takes over after a 3 px move into a different cell, and paints the
inclusive rectangle.

| Part | Value | Source |
|---|---|---|
| Selected cell | `background: var(--accent-soft)`; `box-shadow: inset 0 0 0 1px var(--accent)` | `style.css:1125-1128` |
| During drag | `table.nb-ts-drag { cursor: crosshair }` | `style.css:1131-1133` |
| Copy | TSV in `text/plain` plus an HTML `<table>` in `text/html` | `table-select.js:363-393` |
| Cancel | `Esc`, a new press, typing, a render, hybrid entry, file change | `table-select.js:240-420` |
| Scope | Pointer only. No keyboard rectangle. Hidden rows/columns are skipped. | `table-select.js:22`, `:1-22` |

The 1 px accent edge is drawn on every selected cell, so internal grid lines are visible
inside the rectangle. That is shipped. §12 P10 proposes an outline-only rectangle; do
not apply it.

### 3.6 Phone

- The toggle, toolbar and header menu icons are `display: none` below the mode switch
  (`style.css:7497-7499`).
- A saved hidden-row/column state and sort still apply on render, because `applyState`
  has no phone gate. With the controls hidden there is no visible way to reset them.
  §12 P7 proposes a phone guard; do not apply it here.
- A header tap still runs the title-click sort: the click handler has no phone guard
  (`table-view.js:1086-1107`). The indicator is hidden, so the rows reorder with no
  visible cause. Same proposal.
- Rectangle selection cannot start: it needs a modifier, and touch has none.
- The table pans horizontally inside the 350 px phone measure (390 − 2 × 20).

---

## 4. Images and figures

### 4.1 Two shapes

| Source | DOM | Styling |
|---|---|---|
| `![alt](src)` | `<p><img alt="…" src="…"></p>` | paragraph margin + `img { max-width: 100% }` |
| `<figure>…<figcaption>…</figcaption></figure>` | raw HTML, passed through | `figure { margin: .7em 0 }`; `figcaption` has no app rule |

marked does not wrap images in a figure. A caption requires raw HTML in the note. Notes
are rendered unsanitized because they are the user's own files
(`architecture/markdown.md:39-47`), so raw `<figure>` is valid.

### 4.2 Sizing

`.markdown-body img { max-width: 100% }` is the only size rule (`style.css:3776`). There
is no `height: auto`, no `display: block`, no max-height, no border, radius, or shadow.
The image is an inline replaced element inside a paragraph:

- A wide image scales down to the measure. Its height follows the intrinsic ratio
  because a plain GFM `<img>` has no `width`/`height` attributes.
- A raw HTML image with both `width` and `height` attributes can distort when
  `max-width` shrinks it: the height attribute stays fixed. §12 P4 proposes
  `height: auto`; do not apply it here.
- A tall image grows the page. There is no inner image scroller and no lightbox.
- Images are not part of the figure sizing pass. `FIGURE_SELECTOR` covers only the four
  SVG card classes (`blocks.js:283-284`); `prepareSvg` is called only for SVG.
- Phone: same `max-width: 100%`; measure 350 px at 390; no separate rule.

### 4.3 Captions and links

- `figcaption` inherits prose: `--fg`, 1rem, 1.5 line height, no italic, no muted colour,
  no top margin. That is the shipped default. Do not style it without a proposal.
- A linked image is an `<a>` around an `<img>`. The anchor gets the link colour
  (`style.css:3158`) but the image pixels do not tint. Keyboard focus lands on the
  anchor and uses the browser ring; there is no app focus rule for note links.
- The image itself is not a lightbox trigger. Only the four SVG card classes and the
  shared `.mermaid-lightbox-*` overlays are (`lightbox.js:30-35`, `:300-310`).

### 4.4 Broken and missing images

There is no app fallback. The browser paints its broken-image glyph and the `alt` text.
`alt` is preserved by marked from the `![alt]` source. An empty `alt` marks a decorative
image and is skipped by screen readers. Do not add a JS error handler or a styled
placeholder without a proposal; both change the shipped output.

### 4.5 Accessibility

- `alt` is the image's accessible name. The author writes it. There is no generated
  caption and no `aria-describedby`.
- A `<figcaption>` is the native accessible description of its `<figure>`; no ARIA is
  needed.
- A linked image's accessible name is the `alt`; the anchor must not wrap the image in
  text that repeats it.
- A broken image still exposes its `alt`; that is the fallback, not an error state.

---

## 5. Math

### 5.1 Inline math is not rendered

There is no inline-math extension, no auto-render pass, and no `$…$` delimiter handling in
`viewer.js` or `katex.js`. `$E = mc^2$` stays literal prose. Only a fenced block tagged
`math` or `katex` becomes math (`katex.js:187`).

This is a scope correction: the brief asks for inline and display KaTeX; the shipped
reader has display only. Adding inline math is a feature, not a restyle; it is listed in
§12 P5 and not applied.

### 5.2 Display math

A fence tagged `math` or `katex` is replaced by `.katex-container` holding KaTeX output.
`math` and `katex` are aliases; the round-trip always writes `math`
(`katex.js:187`; `architecture/markdown.md:289-305`).

| Part | Shipped value | Source |
|---|---|---|
| Card | `position: relative`; `margin: .7em 0`; `padding: 14px 16px`; `--bg-panel`; `1px --border`; radius 8; `overflow: hidden` | `style.css:3496-3504` |
| Display line | `display: block`; `margin: 0`; `max-width: 100%`; `text-align: center` | `style.css:3508-3513` |
| Inner `.katex` | `display: inline-block`; centred | `style.css:3514-3517` |
| Render options | `displayMode: true`; `throwOnError: false`; `output: "html"` | `katex.js:130-134` |
| Copy | text `Copy` button in the card, copies `data-katex-source`; hidden until hover/focus | `copy-image.js:827-833` |

### 5.3 Fit and overflow

`fitOne` resets the display's inline `font-size`, then measures the rendered `.katex`
against the display's `clientWidth`. While it overflows and for at most **2 passes**, it
sets `font-size = current × available / width × 0.99`; a 1 px epsilon stops needless
shrink (`katex.js:34-39`, `:83-99`). The card never scrolls horizontally; a wide equation
gets smaller instead (`architecture/markdown.md:220-226`).

The fit pass runs on every relayout: render, resize, sidebar/outline/panel drag,
font-size change, phone/desktop flip, and `<details>` toggle (`blocks.js:757-770`,
`:817-860`). On the phone the inherited prose size is 16 px, so the equation starts
larger and the same pass shrinks it to the 350 px card.

### 5.4 Error and unavailable

`throwOnError: false` means a bad expression does **not** throw. KaTeX returns a
`<span class="katex-error" style="color:#cc0000" title="ParseError…">` holding the raw
source; that span is placed inside the normal card. The app's grouped `.katex-error` rule
then paints a `--warn` border and radius 8 around the span, because it owns the same
class name (`style.css:3429-3438`). The module's own `.katex-error-head` + `.katex-source`
box exists only for a defensive catch that should not fire (`katex.js:137-157`).

The shipped error is therefore: a normal card, a warn-bordered inline error span, and the
raw LaTeX in red. There is no header and no source pane. The copy button still copies the
original source. Contrast: `#cc0000` on `--bg-panel` measures 2.66:1 in dark and 5.49:1
in light. The dark failure is shipped; §9.5 records it.

If the KaTeX bundle does not load within 2.5 s, `whenReady` resolves false and the
renderer returns without touching the fence (`katex.js:44-75`, `:122`). The fence stays a
highlighted code block, with its band and copy button. No toast fires.

### 5.5 Phone

The card keeps `14px 16px` padding and the same radius. The only phone rule is
`max-width: 100%; overflow: hidden` in the grouped card rule (`style.css:7486-7496`).
`fitOne` recomputes at the 16 px prose size; the equation never scrolls.

---

## 6. Diagram cards

### 6.1 Shared card

| Part | Mermaid | WaveDrom | Graphviz | SVG | Live HTML |
|---|---|---|---|---|---|
| Class | `.mermaid-container` | `.wavedrom-container` | `.viz-container` | `.svg-container` | `.htmlpreview-card` |
| Background | `--bg-panel` | **`#fff`** (literal) | `--bg-panel` | `--bg-panel` | `--bg-panel` |
| Padding | `14px 16px` | `14px 16px` | `14px 16px` | `14px 16px` | **0** (frame only) |
| Border | `1px --border` | same | same | same | same |
| Radius | 8 | 8 | 8 | 8 | 8 |
| Margin | `.7em 0` | same | same | same | same |
| Overflow | hidden | hidden | hidden | hidden | hidden |
| `position: relative` | yes | yes | yes | yes | yes |
| Cursor | `zoom-in` | `zoom-in` | `zoom-in` | `zoom-in` | default |
| Source | `style.css:3407-3416` | `:3475-3482` | `:3522-3529` | `:3544-3551` | `:3629-3636` |

The WaveDrom white background is deliberate: the library emits a light-skin SVG with its
own white background, and the comment says the white card makes it read as a crisp timing
plot (`style.css:3467-3474`). In the dark theme it is the one white card in the note. Do
not theme it without a proposal (§12 P11).

Card SVG rules differ only in display and centring: Mermaid, WaveDrom and Graphviz use
`display: inline-block; max-width: 100%; height: auto; width: auto; cursor: zoom-in`
(`style.css:3418-3424`, `:3484-3490`, `:3531-3537`). SVG uses `display: block; max-width:
100%; height: auto; margin: 0 auto` (`style.css:3553-3558`). The four cards themselves
carry `position: relative; cursor: zoom-in` (`style.css:3601-3610`).

### 6.2 Sizing model

All four SVG types hand their SVG to `NB.blocks.prepareSvg`
(`blocks.js:536-576`). It wraps the SVG in `.nb-figure-viewport` (`:3565-3576`) and
records a unitless natural-size factor. The reference is the prose font at the card:
`1rem` on desktop, `calc(16px * var(--font-scale))` on the phone (`--nb-ref-size`,
`style.css:41`, `:6988`). Library diagrams store natural px / 14; Graphviz converts `pt`
to CSS px first; an inline SVG's explicit physical `width`/`height` wins; a viewBox-only
SVG is font-sized at its viewBox dimensions (`blocks.js:279-300`, `:530-576`;
`architecture/markdown.md:168-213`).

`planFigure` picks one of three modes from the card's content width and 70 % of the
nearest scrolling host's `clientHeight` (`blocks.js:280`, `:588-612`):

| Mode | Condition | Result |
|---|---|---|
| `normal` | fits width and viewport | width-fitted size |
| `tall` | fits width, taller than one viewport, up to 3 | keep the width-fitted size; the card grows; the note scrolls |
| `fit` | more than 3 viewports tall | scale the whole drawing down to the viewport; never upscale |

There is no inner diagram scrollbar, no height cap on `.nb-figure-viewport`, and no
scroll-specific focus state (`blocks.js:661-672`; `tests/dom/test_dom.js:6218-6224`).
The lightbox is the detail view for a `fit` diagram.

Re-layout runs after each render and on resize, a guarded `ResizeObserver` on each figure
host, font-size changes, the phone/desktop flip, and a `<details>` open
(`architecture/markdown.md:199-213`).

### 6.3 Actions

| Action | Where | Detail |
|---|---|---|
| Copy image | top-right of every diagram card; and the live-HTML card | icon button, shared `.code-copy-btn` + `.nb-copy-img-btn`; 16 px glyph; `padding: 4px`; `line-height: 0`; `aria-label` and `title` `Copy image` |
| Copy source | top-right of the math card | text `Copy`, copies the stored LaTeX |
| Edit | hybrid mode only | click the card, or the context menu / Shift+F10; opens the shared edit window; no visible header button |
| Open lightbox | click the card in preview | whole card is the hit target; anchors inside the SVG are skipped |

The copy-image button is injected by `copy-image.js` (`:732-785`), positioned at the base
`top: 6px; right: 6px` (`style.css:3297-3300`), hidden until hover/focus within the host
(`style.css:3318-3332`). A click calls `preventDefault` and `stopPropagation`, so it does
not also open the lightbox (`copy-image.js:773-783`). The PNG is rasterised at 2×, capped
at 4096 px, on a white background (`copy-image.js:98-101`, `:364-380`).

The lightbox trigger is delegated from `document.body` on `#viewer-content` and
`.ai-chat-log`, skips hybrid mode, skips `<a>`, and prefers
`.nb-figure-viewport > svg` so the copy button's own icon cannot be mistaken for the
diagram (`lightbox.js:292-313`). The overlay chrome is a later document. This document
specifies only: **clicking the card opens it**.

### 6.4 Loading

There is no spinner or skeleton. Every renderer replaces the `<pre>` only after success,
so the loading state is the original highlighted fence, with its band, language label and
copy button:

| Type | Loading |
|---|---|
| Mermaid | fence while `ensureInitialized` and `mermaid.render` run (`mermaid.js:187-219`) |
| WaveDrom | fence while the bundle loads and `renderSvgElement` runs (`wavedrom.js:155-189`) |
| Graphviz | fence while the ~2 MB WASM bundle loads (`viz.js:111-140`) |
| SVG | none; synchronous parse and swap (`svg.js:73-110`) |
| Math | fence while KaTeX loads, up to 2.5 s (`katex.js:44-75`, `:118-136`) |
| Live HTML | none; synchronous card + iframe (`htmlpreview.js:240-266`) |

This is why the fence band is reserved in every fence: the loading state must not jump
when it becomes a card.

### 6.5 Error

Five renderers share one error box: `1px --warn`, radius 8, `overflow: hidden`, margin
`.7em`; a `--warn` head with `color: var(--bg)`, `.86rem`, 600, `6px 12px`; and a source
`<pre>` with the page's shell: `--code-bg`, `1px --border`, radius 8, margin `.7em`,
`14px 16px`, `.85rem/1.4`, wrapping (`style.css:3264` wins over `:3450`; the export path at
`export.js:926` paints the borderless version).

| Type | Class | Head text | Source | Extra |
|---|---|---|---|---|
| Mermaid | `.mermaid-error` | `Mermaid error: <first line>` | `.mermaid-source` | toast, 4 s, warn |
| WaveDrom | `.wavedrom-error` | `WaveDrom error: <first line>` | `.wavedrom-source` | toast, 4 s, warn |
| Graphviz | `.viz-error` | `Graphviz error: <first line>` | `.viz-source` | toast, 4 s, warn |
| SVG | `.svg-error` | `SVG error: could not parse the block as SVG` | `.svg-source` | no toast |
| Math | `.katex-error` box (defensive only) | `KaTeX error: <first line>` | `.katex-source` | normal parse errors use the in-card span, §5.4 |
| Live HTML | none | — | — | the sandbox renders whatever it is given |

The error box is focusable for Mermaid and WaveDrom so the repair path is reachable with
Shift+F10 (`mermaid.js:247-250`; `wavedrom.js:190-200`). The head is one line: the
renderer collapses a multi-line library message to the first 200 characters
(`mermaid.js:229-236`).

Light-theme contrast: `color: var(--bg)` is `#ffffff` on `--warn` `#c9831d`, **3.11:1**,
below the 4.5:1 floor for 0.86 rem text. Foundations §3.6 changes the light `--warn` to
`#8a5a0b`, which measures 5.92:1 and fixes it when that token lands. Until then the
failure is shipped; §9.5 records it and §12 P1 proposes the foundations change.

### 6.6 Unavailable bundle

| Type | When the bundle is unavailable | Source |
|---|---|---|
| Mermaid | `ensureInitialized` rejects → error box `Mermaid error: mermaid bundle not available` + toast | `mermaid.js:124`, `:223-259` |
| WaveDrom | `whenReady()` false → the fence is left untouched | `wavedrom.js:162`, `:181-183` |
| Graphviz | `whenReady()` false → the fence is left untouched | `viz.js:118`, `:137-139` |
| Math | `whenReady()` false after 2.5 s → the fence is left untouched | `katex.js:44-75`, `:122` |
| SVG | no bundle | — |
| Live HTML | no bundle | `htmlpreview.js:19-21` |

The two "left untouched" outcomes are indistinguishable from a slow load until the
timeout. No message appears. §12 P12 proposes a small unavailable marker; not applied.

### 6.7 AI untrusted state

The AI panel runs the same registry on model output
(`architecture/markdown.md:29-37`). `renderAll(container, { untrusted: true })` skips any
descriptor with `untrustedSafe: false` (`blocks.js:880-897`). Only WaveDrom declares it,
because its lenient parser evals unquoted keys (`wavedrom.js:294`). A ```wavedrom fence in
an assistant reply therefore stays a highlighted code block with its band, label and
copy button. The note path still renders it.

Model-authored SVG and DOT are rendered and then sanitised: the SVG sanitizer drops
script, `foreignObject`, `on*`, and external `href`/`xlink:href`
(`architecture/markdown.md:45-50`; `svg.js:39-53`). Mermaid runs at `securityLevel:
"strict"` (`mermaid.js:65-67`). This document does not change any of that.

### 6.8 Phone

- The diagram cards get `max-width: 100%; overflow: hidden`; padding and radius stay
  (`style.css:7486-7496`). The card grows for a tall diagram; the note scrolls.
- `--nb-ref-size` becomes `calc(16px * var(--font-scale))`, so a font-sized diagram
  starts at the phone prose size and is then width-fitted (`style.css:6988`).
- The copy-image button inherits the phone `.code-copy-btn` 44 × 44 rule
  (`style.css:7473-7481`), so it is always visible and finger-sized.
- The lightbox opens on tap through the same delegated click handler (`lightbox.js:292`).
- There is no hover; the card still shows `zoom-in` only where a pointer exists.

### 6.9 Keyboard and focus

Mermaid, WaveDrom and Graphviz set `tabIndex = 0` so a keyboard user can reach the card
and open the hybrid context menu (`mermaid.js:198-201`; `wavedrom.js:163-166`;
`viz.js:119-122`). SVG does not. No card has a `role`, an accessible name, a
`:focus-visible` ring, or an `Enter`/`Space` handler for the lightbox. These are the
accessibility gaps in §9.5; §9.6 E2/E3 add semantics and a ring, with no visual change.

---

## 7. `html-live` sandbox

### 7.1 Card and frame

| Part | Shipped value | Source |
|---|---|---|
| Card | `.htmlpreview-card`: `position: relative`; margin `.7em`; `--bg-panel`; `1px --border`; radius 8; `overflow: hidden`; **no padding** | `style.css:3629-3636` |
| Frame | `.htmlpreview-frame`: `display: block`; `width: 100%`; `border: 0`; `background: #fff`; `resize: vertical`; `overflow: hidden` | `style.css:3637-3649` |
| Default height | 260 px until the content reports | `htmlpreview.js:33-36` |
| Floor | 80 px; an authored `height: N` is a higher floor | `htmlpreview.js:37-38`, `:49-59` |
| Auto-grow | the injected bridge posts the content height; the frame grows, never shrinks below its current height, and is capped only at 100000 px | `htmlpreview.js:86-140`, `:182-198` |
| Resize | the reader can drag the frame taller; the note keeps the only scrollbar | `style.css:3642-3648` |
| Sandbox | `sandbox="allow-scripts"`, deliberately **without** `allow-same-origin`; `title="HTML preview"` | `htmlpreview.js:207-211` |

The frame has no header, no language label, no source toggle and no error box
(`htmlpreview.js:240-266`). A failed demo shows whatever the sandbox renders; there is no
app fallback. The source is stored in `data-htmlpreview-source` for the hybrid round-trip
and for Copy image.

### 7.2 Sandbox caveat

The opaque origin blocks cookies, `localStorage`/`sessionStorage`, the parent DOM, the
notebook API, same-origin `fetch`, form submission, popups, downloads,
`alert`/`confirm`/`prompt`, and top-level navigation. External `fetch` is subject to CORS.
Use `html-live` only for self-contained, offline demos
(`architecture/markdown.md:373-395`).

### 7.3 Actions and phone

- Copy image sits at the card's top-right (base `top: 6px; right: 6px`), visible on hover
  or focus-within (`copy-image.js:754-765`; `style.css:3320-3321`).
- The card is not a lightbox trigger and has no `zoom-in` cursor.
- In hybrid mode the frame gets `pointer-events: none` so the click reaches the card and
  swaps it to its editable source (`style.css:3650-3658`).
- Phone: `width: 100%`, the same 260 px default, the same 44 px copy button through the
  `.code-copy-btn` phone rule. A tall demo grows the page.

---

## 8. States matrix

| Block | Loading | Ready | Error | Unsupported / unavailable | Long | Narrow / phone |
|---|---|---|---|---|---|---|
| Code fence | n/a (synchronous highlight) | band + label + copy | n/a; highlight failure leaves plain text | no-language fence keeps the band | wraps, no inner scrollbar | 44 px band, 44 px copy, 13 px pre |
| Table | n/a | zebra rows, header, pan | n/a | merged cells: note, no controls | pans horizontally | pans; controls and selection unavailable |
| Image | browser load | intrinsic ratio, max-width 100 % | broken glyph + alt | no figure wrapper from marked | downscales width | same, 350 px measure |
| Figure | browser load | raw `<figure>` + unstyled caption | broken glyph + alt | caption only via raw HTML | grows page | same |
| Math | fence while KaTeX loads | centred card, 2-pass fit | in-card red source + warn border | fence stays a code block after 2.5 s | font shrinks, never scrolls | re-fits at 16 px prose |
| Mermaid | fence | card + SVG + copy image | warn box + source + toast | warn box `bundle not available` | card grows; `fit` beyond 3 viewports | card fits measure, 44 px copy |
| WaveDrom | fence | **white** card + SVG + copy image | warn box + source + toast | fence stays a code block | same | same; white card on dark |
| Graphviz | fence | card + SVG + copy image | warn box + source + toast | fence stays a code block | same | same |
| SVG | n/a | card + sanitised SVG + copy image | warn box + source | no bundle | same | same |
| Live HTML | n/a | white frame, auto-height, resize | no app error box | no bundle | frame grows; author overflow untouched | full width, 44 px copy |

"Loading" is always the source fence for the async types. That is the shipped behaviour
and the reason the band is reserved in every fence.

---

## 9. Accessibility

### 9.1 Copy buttons

- The fence copy button is a native `<button type="button">` with visible text `Copy`
  and `aria-label="Copy code to clipboard"` (`copy-image.js:61-62`, `:696-699`). The
  accessible name starts with the visible word, so it does not hide it.
- It is `opacity: 0` at rest but remains in the tab order. `:focus` and `:focus-visible`
  reveal it (`style.css:3309`, `:3330-3332`). No `outline: none` rule removes the browser
  ring.
- The copy-image button is icon-only with `title` and `aria-label` `Copy image`
  (`copy-image.js:59`, `:771-772`). Its box is 26 × 26 on desktop (16 px icon + 4 px
  padding each side + 1 px border) and 44 × 44 on the phone (`style.css:7473-7481`).
- The text copy button is about 21 px high on desktop (`.76rem` line box + 4 px padding
  each side + 1 px border, `style.css:3301-3305`). That is below the 24 px target floor;
  A9 records it and §12 P17 proposes a fix.
- Copy feedback is both local (`Copied!`, 1.2 s) and a polite toast with `role="status"`
  and `aria-live="polite"` (`app.js:1154-1159`). The toast does not take focus.

### 9.2 Language and code

- The label is CSS-generated text. Screen readers may or may not announce it; it is not
  a reliable accessible name for the block.
- The code itself is plain text in a `<pre><code>`; highlight spans do not change the
  reading order.
- A fence with no language has no label; it is still announced as preformatted text.

### 9.3 Tables

- GFM emits `<th>` without `scope`. Browsers infer column headers from position, but
  explicit `scope="col"` is safer. §9.6 E4 adds it after render, with no visual change.
- The table has no `<caption>` unless the author writes raw HTML. A caption is the
  native accessible name; do not generate one.
- The preview toggle is a native button with `aria-haspopup="true"` and
  `aria-expanded` (`table-view.js:635-650`). The toolbar buttons are native buttons.
  The column menu is `role="menu"` with `menuitemradio` items. The Rows/Columns chooser
  is `role="menu"` in the shipped code but contains native checkbox labels; §9.6 E5
  changes that container to `role="group"` with an `aria-label`.
- The header menu icon is the keyboard path: `tabindex="0"`, `role="button"`,
  `aria-haspopup`, `aria-expanded`, and `aria-label="Column menu"`
  (`table-view.js:365-374`). `Enter`/`Space` opens; `Esc` closes and returns focus to the
  anchor (`table-view.js:1118-1146`).
- Header cells themselves are not tabbable. The `thead th:focus-visible` rule
  (`style.css:1059-1062`) is therefore unreachable. Do not remove it; it becomes live if
  cells gain a tab stop.
- Rectangle selection has no keyboard path. A screen reader reads the table normally.
  The copy result also goes to the clipboard, but no live region announces it. See §12
  P9.

### 9.4 Figures, math, diagrams

- Image alt text is the only accessible name. A missing alt is an authoring failure, not
  a renderer bug.
- `figcaption` is the native description; no ARIA is needed.
- KaTeX is called with `output: "html"` (`katex.js:130-134`), so it emits the
  `aria-hidden` HTML rendering and **no MathML**. Display math has no text alternative today;
  §12 P18 proposes `htmlAndMathml`. Do not claim one until that lands.
- A diagram card is a `div` with inline SVG. Mermaid/WaveDrom/Graphviz are focusable but
  have no role or name; SVG is not focusable. The SVG may carry its own `<title>` from the
  library, but the app does not add one.
- The live-HTML iframe has `title="HTML preview"` (`htmlpreview.js:211`).

### 9.5 Known shipped failures

| # | Failure | Measurement | Where |
|---|---|---|---|
| A1 | Light error-box head: white on light `--warn` | 3.11:1 (needs 4.5:1) | `style.css:3444-3445`; light `--warn` `#c9831d` at `:103` |
| A2 | Light syntax keyword | 4.08:1 on `--code-bg` | `github.css` keyword `#d73a49`; vendor line 1 |
| A3 | Dark math parse error | 2.66:1 (`#cc0000` on `--bg-panel`) | KaTeX inline style, `katex.js:130-134` |
| A4 | Diagram cards: no role, name, focus ring, or keyboard open | — | `mermaid.js:200`; `style.css:3601-3610` |
| A5 | Table preview controls: 24 px targets on a fine pointer only; hidden on phone | — | `style.css:940-942`, `:7497-7499` |
| A6 | Rectangle selection is pointer-only | — | `table-select.js:1-22` |
| A7 | Phone can inherit hidden rows/sort with no visible reset | — | `table-view.js:482-498`; `style.css:7497-7499` |
| A8 | Error source copy button sits over the first source line | — | `style.css:3297-3300`, `:3450-3466` |
| A9 | Desktop text copy button is about 21 px high | below the 24 px target floor | `style.css:3301-3305` |

A1 is fixed by foundations §3.6 when it lands. A2 and A3 need a vendor/app colour change
and are proposals. A4–A6 are the deliberate exceptions in §9.6 or proposals in §12.

### 9.6 Deliberate exceptions

These add semantics or keyboard behaviour. None changes a pixel at rest.

| # | Addition | Why | Visual delta |
|---|---|---|---|
| E1 | Copy button keeps `aria-label="Copy code to clipboard"` | The authored token (`js`) has no display-name map today; a guessed name is worse than none | none |
| E2 | Diagram cards get `role="group"` and `aria-label="<Type> diagram"`; `.svg-container` also becomes `tabindex="0"` | The card is an interactive lightbox trigger and currently unnamed | none |
| E3 | Diagram cards get `:focus-visible` with `var(--focus-ring)` at `var(--focus-offset)`; `Enter`/`Space` opens the lightbox in preview | Keyboard parity with click | focus ring only |
| E4 | Every rendered `<th>` gets `scope="col"` after render | Explicit header association | none |
| E5 | The Rows/Columns chooser popover becomes `role="group"` with an `aria-label`; the native checkbox labels keep their state | A `menu` containing checkbox labels is the wrong pattern | none |

Do not add a second focus ring, a tooltip, an `aria-live` region per block, or a visible
label to an icon button. The shell already owns focus and status.

---

## 10. Tokens and CSS target

### 10.1 Token names

The component rules below read foundation tokens. The shipped stylesheet uses the base
names; the mapping is fixed and one-way:

| Shipped base | Foundation role |
|---|---|
| `--bg` | `--surface-page` |
| `--bg-panel` | `--surface-panel` |
| `--bg-elev` | `--surface-raised` |
| `--code-bg` | `--surface-well` |
| `--fg` | `--text-primary` |
| `--fg-muted` | `--text-muted` |
| `--accent-fg` | `--text-on-accent` |

`--accent`, `--accent-soft`, `--border`, `--warn`, `--danger`, and `--ok` already are
role names and are read directly. No alias is introduced in the other direction.

### 10.2 Component tokens

The shipped layer has values off the foundation ladder: 14 px, 6 px, 10 px, .76 rem,
.74 rem, 180 px, 320 px, 16 px, 22 px, 24 px, 26 px, 1 em inner code padding. They are
named here so a rule never carries a one-off. Each token holds a literal; none aliases
another token.

| Token | Value | Shipped source |
|---|---|---|
| `--content-block-gap` | `.7em` | `style.css:3157`, `:3267`, `:3760` |
| `--content-pre-pad-block` | `14px` | `style.css:3270` |
| `--content-pre-pad-inline` | `16px` | `style.css:3270` |
| `--content-pre-band` | `22px` | `style.css:3282` |
| `--content-code-pad` | `1em` | `github-dark.css:1` |
| `--content-code-size` | `.88em` | `style.css:3290` |
| `--content-copy-size` | `.76rem` | `style.css:3301` |
| `--content-copy-pad-block` | `4px` | `style.css:3303` |
| `--content-copy-pad-inline` | `8px` | `style.css:3303` |
| `--content-fence-label-size` | `.72em` | `style.css:3351` |
| `--content-fence-label-line` | `1.2` | `style.css:3351` |
| `--content-fence-label-offset` | `96px` | `style.css:3350` |
| `--content-cell-pad-block` | `6px` | `style.css:3761` |
| `--content-cell-pad-inline` | `10px` | `style.css:3761` |
| `--content-card-pad-block` | `14px` | `style.css:3409` |
| `--content-card-pad-inline` | `16px` | `style.css:3409` |
| `--content-error-head-size` | `.86rem` | `style.css:3446` |
| `--content-error-head-pad-block` | `6px` | `style.css:3447` |
| `--content-error-head-pad-inline` | `12px` | `style.css:3447` |
| `--content-source-size` | `.85rem` | `style.css:3461` |
| `--content-source-pad-block` | `10px` | `style.css:3460` |
| `--content-source-pad-inline` | `12px` | `style.css:3460` |
| `--content-source-line` | `1.4` | `style.css:3462` |
| `--content-tv-gap` | `6px` | `style.css:935` |
| `--content-tv-toggle` | `24px` | `style.css:941-942` |
| `--content-tv-toolbar-pad` | `2px` | `style.css:961` |
| `--content-tv-toolbar-gap` | `2px` | `style.css:962` |
| `--content-tv-btn-size` | `.76rem` | `style.css:976` |
| `--content-tv-btn-pad-block` | `2px` | `style.css:969` |
| `--content-tv-btn-pad-inline` | `8px` | `style.css:969` |
| `--content-tv-item-size` | `.8rem` | `style.css:1006` |
| `--content-tv-item-pad-block` | `4px` | `style.css:1004` |
| `--content-tv-item-pad-inline` | `8px` | `style.css:1004` |
| `--content-tv-pop-min` | `180px` | `style.css:988` |
| `--content-tv-pop-max` | `320px` | `style.css:989` |
| `--content-tv-pop-pad` | `4px` | `style.css:990` |
| `--content-tv-shadow` | `0 6px 24px rgba(0,0,0,.35)` | `style.css:963`, `:999` |
| `--content-tv-z` | `7` | `style.css:923` |
| `--content-tv-pop-z` | `8` | `style.css:998` |
| `--content-tv-menu-icon` | `16px` | `style.css:1081-1082` |
| `--content-tv-menu-gap` | `6px` | `style.css:1085` |
| `--content-tv-menu-size` | `.7rem` | `style.css:1089` |
| `--content-tv-menu-radius` | `3px` | `style.css:1087` |
| `--content-tv-note-size` | `.74rem` | `style.css:1042` |
| `--content-tv-note-pad-block` | `2px` | `style.css:1041` |
| `--content-tv-note-pad-inline` | `8px` | `style.css:1041` |

Two content-surface colours are raw today and stay raw in the target: the WaveDrom card `background: #fff`
(`style.css:3478`) and the frame `background: #fff` (`style.css:3641`). They are content
surfaces, not chrome, and the white is the library's skin. Do not tokenise them into a
theme colour.

The table-control shadow `0 6px 24px rgba(0,0,0,.35)` is the dark `--shadow-pop` value
(`foundations.md` §5.4). The light theme should read `--shadow-pop`, but this is a visual
change in the light theme, so §12 P6 proposes it and the target CSS keeps the literal.

```css
:root {
  --content-block-gap: .7em;
  --content-pre-pad-block: 14px;
  --content-pre-pad-inline: 16px;
  --content-pre-band: 22px;
  --content-code-pad: 1em;
  --content-code-size: .88em;
  --content-copy-size: .76rem;
  --content-copy-pad-block: 4px;
  --content-copy-pad-inline: 8px;
  --content-fence-label-size: .72em;
  --content-fence-label-line: 1.2;
  --content-fence-label-offset: 96px;
  --content-cell-pad-block: 6px;
  --content-cell-pad-inline: 10px;
  --content-card-pad-block: 14px;
  --content-card-pad-inline: 16px;
  --content-error-head-size: .86rem;
  --content-error-head-pad-block: 6px;
  --content-error-head-pad-inline: 12px;
  --content-source-size: .85rem;
  --content-source-pad-block: 10px;
  --content-source-pad-inline: 12px;
  --content-source-line: 1.4;
  --content-tv-gap: 6px;
  --content-tv-toggle: 24px;
  --content-tv-toolbar-pad: 2px;
  --content-tv-toolbar-gap: 2px;
  --content-tv-btn-size: .76rem;
  --content-tv-btn-pad-block: 2px;
  --content-tv-btn-pad-inline: 8px;
  --content-tv-item-size: .8rem;
  --content-tv-item-pad-block: 4px;
  --content-tv-item-pad-inline: 8px;
  --content-tv-pop-min: 180px;
  --content-tv-pop-max: 320px;
  --content-tv-pop-pad: 4px;
  --content-tv-shadow: 0 6px 24px rgba(0,0,0,.35);
  --content-tv-z: 7;
  --content-tv-pop-z: 8;
  --content-tv-menu-icon: 16px;
  --content-tv-menu-gap: 6px;
  --content-tv-menu-size: .7rem;
  --content-tv-menu-radius: 3px;
  --content-tv-note-size: .74rem;
  --content-tv-note-pad-block: 2px;
  --content-tv-note-pad-inline: 8px;
}
```

The three `em` values are re-declared where the prose size lives, because an `em` on
`:root` would freeze at the 14 px root instead of following the phone reader:

```css
.markdown-body {
  --content-block-gap: .7em;
  --content-code-size: .88em;
  --content-fence-label-size: .72em;
}
```

### 10.3 Target rules

Order matters only inside a component. The blocks sit after the current `.markdown-body`
rules and before the phone query; the phone overrides stay inside the query at the end.

```css
/* ---------- rhythm ---------- */
.markdown-body > :first-child { margin-top: 0; }
.markdown-body figure,
.markdown-body dl,
.markdown-body details { margin: var(--content-block-gap) 0; }

/* ---------- code fence ---------- */
.markdown-body pre {
  position: relative;
  margin: var(--content-block-gap) 0;
  padding: var(--content-pre-pad-block) var(--content-pre-pad-inline);
  background: var(--surface-well);
  border: var(--stroke-1) solid var(--border);
  border-radius: var(--radius-md);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  overflow-x: clip;
}
.markdown-body pre:has(> code) { padding-top: var(--content-pre-band); }
.markdown-body pre code,
.markdown-body pre code.hljs {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  overflow-x: clip;
}
.markdown-body pre code {
  background: none;
  padding: var(--content-code-pad);   /* vendor parity, see §2.6 */
  font-size: var(--content-code-size);
}
.markdown-body pre:has(> code)[data-fence-lang]:not([data-fence-lang=""])::after {
  content: attr(data-fence-lang);
  position: absolute;
  top: 6px;
  left: 16px;
  max-width: calc(100% - var(--content-fence-label-offset));
  font: var(--content-fence-label-size)/var(--content-fence-label-line)
        var(--font-mono);
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
}
.markdown-body pre:has(> code) > .code-copy-btn {
  top: 1px;
  right: 10px;
  z-index: var(--z-inline);
}
.code-copy-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  font-size: var(--content-copy-size);
  line-height: var(--lh-flat);
  padding: var(--content-copy-pad-block) var(--content-copy-pad-inline);
  border-radius: var(--radius-xs);
  border: var(--stroke-1) solid var(--border);
  background: var(--surface-raised);
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--dur-1) var(--ease-out),
              background var(--dur-1) var(--ease-out),
              color var(--dur-1) var(--ease-out);
  user-select: none;
}
.markdown-body pre:hover .code-copy-btn,
.markdown-body pre:focus-within .code-copy-btn,
.ai-prose-span pre:hover .code-copy-btn,
.ai-prose-span pre:focus-within .code-copy-btn,
.katex-container:hover .code-copy-btn,
.katex-container:focus-within .code-copy-btn,
.htmlpreview-card:hover .code-copy-btn,
.htmlpreview-card:focus-within .code-copy-btn,
.mermaid-container:hover .code-copy-btn,
.mermaid-container:focus-within .code-copy-btn,
.wavedrom-container:hover .code-copy-btn,
.wavedrom-container:focus-within .code-copy-btn,
.viz-container:hover .code-copy-btn,
.viz-container:focus-within .code-copy-btn,
.svg-container:hover .code-copy-btn,
.svg-container:focus-within .code-copy-btn,
.code-copy-btn:focus,
.code-copy-btn:focus-visible { opacity: 1; }
.code-copy-btn:hover { background: var(--accent-soft); color: var(--text-primary); }
.code-copy-btn.copied { color: var(--accent); border-color: var(--accent); }
.nb-copy-img-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-1);
  line-height: 0;
}

/* ---------- table ---------- */
.markdown-body table {
  border-collapse: collapse;
  display: block;
  max-width: 100%;
  overflow-x: auto;
  margin: var(--content-block-gap) 0;
}
.markdown-body th,
.markdown-body td {
  border: var(--stroke-1) solid var(--border);
  padding: var(--content-cell-pad-block) var(--content-cell-pad-inline);
}
.markdown-body tbody tr:nth-child(odd) { background: var(--surface-panel); }
.markdown-body tbody tr:nth-child(even) { background: var(--surface-page); }

/* ---------- preview controls ---------- */
.nb-tv-overlay { position: absolute; inset: 0; z-index: var(--content-tv-z); pointer-events: none; }
.nb-tv-controls { position: absolute; display: flex; align-items: center;
  gap: var(--content-tv-gap); pointer-events: auto; }
.nb-tv-controls[hidden] { display: none; }
.nb-tv-toggle {
  width: var(--content-tv-toggle);
  height: var(--content-tv-toggle);
  padding: 0;
  border: var(--stroke-1) solid var(--border);
  border-radius: var(--radius-xs);
  background: var(--surface-raised);
  color: var(--text-muted);
  font-family: inherit;
  font-size: var(--content-tv-item-size);
  line-height: var(--lh-flat);
  cursor: pointer;
}
.nb-tv-toggle:hover { background: var(--accent-soft); color: var(--text-primary); }
.nb-tv-toggle:focus-visible { outline: var(--focus-ring); outline-offset: 1px; }
.nb-tv-toolbar {
  display: flex;
  gap: var(--content-tv-toolbar-gap);
  padding: var(--content-tv-toolbar-pad);
  background: var(--surface-raised);
  border: var(--stroke-1) solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: var(--content-tv-shadow);   /* P6 proposes --shadow-pop */
}
.nb-tv-toolbar[hidden] { display: none; }
.nb-tv-btn {
  padding: var(--content-tv-btn-pad-block) var(--content-tv-btn-pad-inline);
  border: var(--stroke-1) solid transparent;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-muted);
  font-family: inherit;
  font-size: var(--content-tv-btn-size);
  line-height: var(--lh-normal);
  white-space: nowrap;
  cursor: pointer;
}
.nb-tv-btn:hover { background: var(--accent-soft); color: var(--text-primary); }
.nb-tv-btn:focus-visible { outline: var(--focus-ring); outline-offset: 1px; }
.nb-tv-pop {
  position: absolute;
  min-width: var(--content-tv-pop-min);
  max-height: var(--content-tv-pop-max);
  overflow: auto;
  padding: var(--content-tv-pop-pad);
  background: var(--surface-raised);
  border: var(--stroke-1) solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: var(--content-tv-shadow);   /* P6 proposes --shadow-pop */
  pointer-events: auto;
  z-index: var(--content-tv-pop-z);
}
.nb-tv-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--content-tv-item-pad-block) var(--content-tv-item-pad-inline);
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--content-tv-item-size);
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}
.nb-tv-item:hover { background: var(--accent-soft); }
.nb-tv-item:focus-visible { outline: var(--focus-ring); outline-offset: -2px; }
.nb-tv-note {
  position: absolute;
  padding: var(--content-tv-note-pad-block) var(--content-tv-note-pad-inline);
  font-size: var(--content-tv-note-size);
  color: var(--text-muted);
  background: var(--surface-raised);
  border: var(--stroke-1) solid var(--border);
  border-radius: var(--radius-xs);
  pointer-events: none;
  white-space: nowrap;
}
#viewer-content tr.nb-tv-hide-row { display: none; }
#viewer-content .nb-tv-hide-col { display: none; }
#viewer-content thead th { cursor: pointer; }
#viewer-content thead th:focus-visible { outline: var(--focus-ring); outline-offset: -2px; }
#viewer-content thead th .nb-tv-head-menu {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--content-tv-menu-icon);
  height: var(--content-tv-menu-icon);
  vertical-align: middle;
  visibility: hidden;
  margin-left: var(--content-tv-menu-gap);
  padding: 0;
  border-radius: var(--content-tv-menu-radius);
  color: var(--text-muted);
  font-size: var(--content-tv-menu-size);
  line-height: var(--lh-flat);
  cursor: pointer;
}
#viewer-content thead th:hover .nb-tv-head-menu,
#viewer-content thead th:focus-within .nb-tv-head-menu,
#viewer-content thead th.nb-tv-sorted .nb-tv-head-menu,
#viewer-content thead th .nb-tv-head-menu.is-open { visibility: visible; }
#viewer-content thead th .nb-tv-head-menu:hover,
#viewer-content thead th .nb-tv-head-menu.is-open {
  background: var(--accent-soft); color: var(--text-primary);
}
#viewer-content thead th.nb-tv-sorted .nb-tv-head-menu { color: var(--accent); }
#viewer-content thead th[aria-sort="ascending"] .nb-tv-head-menu { transform: rotate(180deg); }
#viewer-content thead th[aria-sort="descending"] .nb-tv-head-menu { transform: rotate(0deg); }
#viewer-content thead th .nb-tv-head-menu:focus-visible {
  outline: var(--focus-ring); outline-offset: 1px;
}
.nb-tv-item[role="menuitemradio"]::before {
  content: "\2713";
  color: var(--accent);
  visibility: hidden;
}
.nb-tv-item[role="menuitemradio"][aria-checked="true"]::before { visibility: visible; }
.nb-tv-item.is-check input { margin: 0; accent-color: var(--accent); }
.nb-tv-empty {
  padding: var(--space-1) var(--space-2);
  color: var(--text-muted);
  font-size: var(--content-tv-item-size);
}
#viewer-content .nb-ts-range {
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px var(--accent);
}
#viewer-content table.nb-ts-drag { cursor: crosshair; }

/* ---------- cards ---------- */
.mermaid-container,
.wavedrom-container,
.viz-container,
.svg-container,
.katex-container {
  position: relative;
  margin: var(--content-block-gap) 0;
  padding: var(--content-card-pad-block) var(--content-card-pad-inline);
  background: var(--surface-panel);
  border: var(--stroke-1) solid var(--border);
  border-radius: var(--radius-md);
  text-align: center;
  overflow: hidden;
}
.wavedrom-container { background: #fff; }
.svg-container svg { display: block; max-width: 100%; height: auto; margin: 0 auto; }
.mermaid-container svg,
.wavedrom-container svg,
.viz-container svg { display: inline-block; max-width: 100%; height: auto; width: auto; }
.mermaid-container,
.wavedrom-container,
.viz-container,
.svg-container { cursor: zoom-in; }
.katex-container { text-align: left; }
.katex-container .katex-display {
  display: block; margin: 0; max-width: 100%; text-align: center;
}
.katex-container .katex-display > .katex { display: inline-block; text-align: center; }
.nb-figure-viewport { display: block; width: 100%; max-width: 100%; text-align: center; }
.nb-figure-viewport > svg { display: block; max-width: 100%; margin: 0 auto; height: auto; }
.nb-figure-viewport > svg[data-nb-sizing="font"] {
  width: calc(var(--nb-w, 0) * var(--nb-ref-size)); height: auto;
}
.nb-figure-viewport > svg[data-nb-sizing="explicit"],
.nb-figure-viewport > svg[data-nb-sizing="fallback"] { width: auto; height: auto; }

/* ---------- error boxes ---------- */
.mermaid-error, .wavedrom-error, .katex-error, .viz-error, .svg-error {
  margin: var(--content-block-gap) 0;
  border: var(--stroke-1) solid var(--warn);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.mermaid-error-head, .wavedrom-error-head, .katex-error-head,
.viz-error-head, .svg-error-head {
  background: var(--warn);
  color: var(--surface-page);
  font-size: var(--content-error-head-size);
  padding: var(--content-error-head-pad-block) var(--content-error-head-pad-inline);
  font-weight: var(--fw-semibold);
}
.mermaid-source, .wavedrom-source, .katex-source, .viz-source, .svg-source {
  margin: 0;
  background: var(--surface-well);
  color: var(--text-primary);
  border: 0;
  border-radius: 0;
  padding: var(--content-source-pad-block) var(--content-source-pad-inline);
  font-size: var(--content-source-size);
  line-height: var(--content-source-line);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  overflow-x: clip;
}

/* ---------- images ---------- */
.markdown-body img { max-width: 100%; }

/* ---------- live HTML ---------- */
.htmlpreview-card {
  position: relative;
  margin: var(--content-block-gap) 0;
  background: var(--surface-panel);
  border: var(--stroke-1) solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.htmlpreview-frame {
  display: block;
  width: 100%;
  border: 0;
  background: #fff;
  resize: vertical;
  overflow: hidden;
}
```

Phone overrides, inside the existing mode query, keep their current numbers:

```css
.markdown-body pre { padding: 12px 14px; font-size: 13px; }
.markdown-body pre:has(> code) { padding: 44px 14px 12px; }
.markdown-body pre:has(> code)[data-fence-lang]:not([data-fence-lang=""])::after {
  top: 13px; left: 14px;
}
.markdown-body pre:has(> code) > .code-copy-btn {
  top: 0; right: 0; width: var(--control-h-touch); height: var(--control-h-touch);
  padding: 0; opacity: 1; font-size: 12px;
}
.code-copy-btn {
  top: 0; right: 0; width: var(--control-h-touch); height: var(--control-h-touch);
  padding: 0; opacity: 1; font-size: 12px;
}
.markdown-body table { overscroll-behavior-x: contain; border-radius: var(--radius-md); }
.nb-tv-controls, .nb-tv-toolbar,
#viewer-content thead th .nb-tv-head-menu { display: none; }
```

### 10.4 What not to tokenise

- The vendored highlight colours. They belong to the theme file and change as a pair
  (`github-dark.css`, `github.css`).
- The KaTeX glyph metrics and the inline error colour. KaTeX owns them.
- The WaveDrom and iframe white. They are the content's own surface.
- `.7em` as a px value. The rhythm is prose-relative and must scale with the reader.

---

## 11. Acceptance criteria

Each is testable and names the file or test that observes it.

| # | Criterion | Where | Observable |
|---|---|---|---|
| AC1 | Every listed block keeps `.7em` top and bottom; the first child drops its top margin | `static/css/style.css` | Computed margins on `pre`, `table`, `figure`, the six cards and the five error boxes are 9.8 px at 14 px prose; the first block's top is 0 |
| AC2 | A fence reserves a 22 px top band in every state | `style.css` | `.markdown-body pre:has(> code)` computes `padding-top: 22px`; toggling hybrid never changes the pre height |
| AC3 | The language label is generated from `data-fence-lang` and never shows a guessed language | `static/js/viewer.js:449-459` | A bare fence has no `data-fence-lang` and no `::after`; a ```` ```js ```` fence shows `js` |
| AC4 | The copy button is hidden at rest, revealed on hover/focus, and copies raw source | `style.css:3297-3335`; `copy-image.js:684-729` | `opacity` 0 → 1; clipboard text equals `pre code` text with no button label or highlight spans; label becomes `Copied!` |
| AC5 | Long lines wrap; no code fence scrolls horizontally | `style.css:3268-3288` | `scrollWidth === clientWidth` on every fence at 390 and in the wide desktop reader |
| AC6 | The error box has a warn border, warn head, and a source `<pre>` with no band | `style.css:3429-3466` | `.mermaid-error` exists after a bad mermaid fence; no `data-fence-lang`; source text equals the fence body |
| AC7 | A table pans inside the reader, not the page | `style.css:3760`, `:2386` | A 12-column table has `scrollWidth > clientWidth` on the table and the page does not scroll horizontally |
| AC8 | The preview controls appear on hover/focus and expose Rows, Columns, Reset | `static/js/table-view.js:631-663` | `.nb-tv-toggle` visible; toolbar hidden until click; three buttons in that order; `aria-expanded` flips |
| AC9 | Sorting is one column, shown by the rotated chevron and `aria-sort`; a title click never clears | `table-view.js:424-433`, `:858-865`; `style.css:1106-1112` | Only one `th[aria-sort]`; ascending icon is rotated 180°; two title clicks end at descending, not unsorted |
| AC10 | Hiding is class-based and the last column cannot be hidden | `table-view.js:387-409`, `:810-823` | Hidden row has `.nb-tv-hide-row`; no node is removed; the refusal toast appears |
| AC11 | A merged table shows the exact note and no controls | `table-view.js:912-936`; `style.css:1038-1049` | Text `Merged cells: table view controls are unavailable`; no `.nb-tv-controls` |
| AC12 | A rectangle drag paints the inclusive cells and copies TSV + HTML | `static/js/table-select.js:1-22`; `style.css:1125-1133` | `.nb-ts-range` on the rectangle; `text/plain` is TSV; `text/html` is a `<table>` |
| AC13 | Display math is centred, fitted in at most two passes, and never scrolls | `katex.js:34-39`, `:83-99`; `style.css:3496-3517` | Wide equation's `.katex` width ≤ card width; `overflow-x` on the card is hidden; no scrollbar |
| AC14 | Inline `$…$` is not rendered | `katex.js:187` | A paragraph with `$x$` shows the literal characters |
| AC15 | Each SVG card uses the shared sizing model and never scrolls internally | `blocks.js:536-630`; `style.css:3565-3591` | `.nb-figure-viewport` wraps every SVG; `data-nb-mode` is normal/tall/fit; the wrapper has no max-height or overflow |
| AC16 | A diagram card loads as its fence and swaps only on success | `mermaid.js:187-219`; `wavedrom.js:155-189`; `viz.js:111-140` | Before resolution the `pre > code.language-*` exists; after, the card exists |
| AC17 | The copy-image button is 26 px desktop / 44 px phone and does not open the lightbox | `copy-image.js:732-783`; `style.css:7473-7481` | Box size; clicking it leaves the overlay hidden |
| AC18 | AI replies skip WaveDrom and keep it as a code block | `blocks.js:880-897`; `wavedrom.js:294` | In `test_ai_blocks_browser.js`, `.wavedrom-container` absent, `pre > code.language-wavedrom` present with a copy button |
| AC19 | `html-live` is a sandboxed iframe that grows and can be resized | `htmlpreview.js:207-238`; `style.css:3629-3649` | `sandbox="allow-scripts"`; no `allow-same-origin`; `resize: vertical`; height grows |
| AC20 | The phone fence is 44 px band, 44 px copy, always visible | `style.css:7452-7481` | At 390, the copy box is 44 × 44 and `opacity: 1` |
| AC21 | The phone hides preview table controls and does not need a modifier | `style.css:7497-7499` | `.nb-tv-controls`, `.nb-tv-toolbar`, `.nb-tv-head-menu` are `display: none` |
| AC22 | The mockup is self-contained and shows both themes | `docs/ui/content-blocks-mockup.html` | Opening it offline makes zero network requests; both `data-theme` values render |
| AC23 | The a11y additions add no pixels at rest | `static/css/style.css`, `static/js/*` | E1/E2/E4/E5 add attributes only; E3 paints a ring on `:focus-visible` only |

Existing tests that already cover part of this set:

- `tests/dom/test_dom.js` — `== blocks registry ==` (`:5841`), code copy
  (`:3808-3850`), Mermaid error (`:4021-4092`), figure sizing
  (`:5990-6265`), table view (`:18936-19470`), table select (`:19839-20040`).
- `tests/browser/test_figure_sizing_browser.js` — the real layout matrix, the export and
  hybrid seams.
- `tests/browser/test_ai_blocks_browser.js` — the six fences in a reply, WaveDrom skipped,
  per-host sizing, copy image, lightbox.
- `tests/browser/test_mobile_browser.js` — phone shell and reader width.
- `tests/dom/test_dom.js` `:27740-27747` — the `.7em` rhythm of `figure`, `dl`, `details`.

---

## 12. Proposals, not applied

None of these is in the mockup. Each changes a pixel or a behaviour and needs a separate
decision.

| # | Proposal | Why | Cost |
|---|---|---|---|
| P1 | Adopt foundations §3.6: light `--warn` `#c9831d` → `#8a5a0b` | Error head 3.11 → 5.92:1; status text clears 4.5:1 | Touches every light warn use; visible |
| P2 | Light syntax keyword `#d73a49` → `#cf222e` (4.08 → 4.78:1) | Body-text contrast | A vendor theme diff; changes code colours |
| P3 | Remove the vendor `1em` padding inside `<code>` and align code text with the label | The label and the first line start 12.3 px apart today | Changes every fence's inner geometry |
| P4 | `img { height: auto }` | Prevents distortion when raw HTML carries both dimensions | Changes dimensioned images only |
| P5 | Add inline math (`$…$` / `\(…\)`) with a marked extension and KaTeX auto-render | The brief assumes it; the reader has display only | New render path, more bundle work, hybrid round-trip |
| P6 | Use `--shadow-pop` for the table popovers and toolbar | The current literal is dark-only; light gets a heavy shadow | Light-theme shadow gets lighter |
| P7 | Guard `applyState`/the header-click sort on phone, or expose a Reset | A hidden saved view cannot be cleared on touch; a tap sorts invisibly | Behaviour change; no visual change |
| P8 | Move the error source copy button below the head (or out of the source) | It sits over the first source line | Small chrome move |
| P9 | Add a keyboard rectangle (Shift+Arrow from a focused cell) and a polite selection announcement | Selection is pointer-only | New interaction; no visual change |
| P10 | Paint the selection as an outer 1 px accent rectangle, not one ring per cell | Internal grid lines appear inside the rectangle today | Visible |
| P11 | Theme the WaveDrom card for dark, or invert the SVG | A white card in a dark note | Large visual change; risks the library's skin |
| P12 | Show an "unavailable" marker when a bundle fails to load | Silence looks like a slow load | New state chrome |
| P13 | Style `figcaption` (muted, `.86rem`, top gap) | Captions currently inherit body type | Visible |
| P14 | Add a lightbox for images | Large images have no detail view | New overlay and trigger |
| P15 | Sticky table headers | Long tables lose the header when panning/scrolling | Changes the table scroll model |
| P16 | An empty-table state | A header-only table looks broken | New content |
| P17 | Give the desktop text copy button a 24 px box (raise the fence band to 24 or let it overhang) | The 21 px button misses the 24 px target floor and overhangs at XL | Band height or overlap changes |
| P18 | Call KaTeX with `output: "htmlAndMathml"` | Display math has no text alternative today (`katex.js:130-134`) | Adds MathML to every equation; measurable DOM growth |
| P19 | Make the table's horizontal scroller focusable and named (`tabindex="0"`, `role="region"`, `aria-label="Table"`) | A wide table pans, but the table is not in the tab order and has no name | One attribute set; one stop in the reader |

---

## 13. What not to build

- **No restyle of the shipped blocks.** No new card shadow, hover lift, gradient, border
  radius, or "modern" spacing. The measurements in §2–§7 are the design.
- **No inner scrollbar in code, math, or a diagram.** The note is the only vertical
  scroller; code wraps and math shrinks. Tables and the lightbox keep their own scrolling.
- **No second sort indicator.** One chevron, rotated. Do not add a separate arrow.
- **No table controls on phone.** They are display-none today; a mobile redesign is a
  separate document.
- **No task-list restyle.** The checkbox is reader prose; it belongs to `reader.md`.
- **No new fence language and no renderer change.** The six are fixed; adding one touches
  `blocks.js`, the service worker, `ai.js` and `agent.md`
  (`architecture/markdown.md:472-496`).
- **No lightbox chrome here.** Trigger only. The overlay, zoom, fit, pan and Escape
  contract are a later overlay document.
- **No edit-window design.** The table editor, Mermaid designer, DOT/WaveDrom designer,
  and their selection models are referenced, not redrawn.
- **No figure wrapper for images.** marked does not emit one; do not add one in a
  post-pass without a proposal.
- **No sanitising change for notes.** The note path is unsanitised by design; the AI path
  is sanitised. Do not move that boundary in this layer.
- **No new breakpoint.** The 860 / 1023 mode switch is the only one (`foundations.md`
  §8.2).
- **No colour literal in a component rule.** The two content whites in §10.2 are the
  recorded exceptions.
- **No custom tooltip, copy counter, or per-block status chip.** The toast is the status
  channel.
