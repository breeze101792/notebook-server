# Reader — the reading surface

Status: Current spec — shipped surface, codified. §5.4 holds the only changes: three
accessibility additions. Nothing else in this document alters what ships.

Reference mockup: [`reader-mockup.html`](reader-mockup.html) — one realistic note at the
1280 editor column (dark), 861 (light) and 390 (dark), an XL type board, a print board, a
states strip, and an inline-elements strip. Standalone, no network assets.

**Normative source.** This document owns `#viewer-scroll`, `#viewer-content`,
`.markdown-body`, and the prose elements rendered into it. It **codifies the shipped
look** and does not redesign it. It reads [`foundations.md`](foundations.md) for tokens
and [`controls.md`](controls.md) for the shared control contract. The frame around the
page — topbar, rail, side panel, outline, phone conversion — is
[`shell-frame.md`](shell-frame.md). Fenced code, tables, images and figures, math, and the
six diagram/sandbox blocks are [`content-blocks.md`](content-blocks.md); this document
states only their block margin. The welcome page is a later document and is referenced
here, never specified.

Paths: `style.css` is `static/css/style.css`; `viewer.js` is `static/js/viewer.js`;
`index.html` is `templates/index.html`.

Every claim about current code cites `file:line`. Every px figure is computed from the
shipped rules at the default root (14 px, `--font-scale: 1`) and at XL (18.2 px, 1.3);
prose em values scale, px values do not.

---

## 1. The page

### 1.1 Elements and scroll ownership

```
#viewer                      shell: position relative, overflow hidden, flex 1 1 auto
└── #viewer-scroll           the only scroll container
    └── #viewer-content      the page: padding, wallpaper host, direct parent of blocks
        .markdown-body
```

| Element | Owns | Must not | Source |
|---|---|---|---|
| `#viewer` | Box and positioning context for the drag overlays, `overflow: hidden` | Scroll | `style.css:2354-2366` |
| `#viewer-scroll` | `scrollTop`, `scrollHeight`, `clientHeight`, the `scroll` event, the elastic overscroll | Hold note content or the wallpaper, except in `fixed` wallpaper mode | `:2380-2387` |
| `#viewer-content` | Padding, `min-height: 100%`, the wallpaper in `scroll` mode, every rendered block as a direct child | Scroll — a non-visible overflow would make it a second scroller and steal the figure viewport (`blocks.js` `hostOf`, `:681-687`) | `:2392-2400`; `:2388-2391` |

`overflow-y: auto` / `overflow-x: hidden` on the scroller, `overscroll-behavior-y:
contain` (`:2384-2386`). The page is `overflow: visible`. `#viewer[hidden]` is
`display: none` (`:2375`). The drag overlays stay children of `#viewer`, `position:
absolute`, so the scroller never clips them (`docs/archive/design/viewer-scroll-container.md:41-53`).

Nothing else in the reader scrolls. Code wraps (`:3273-3276`), diagrams grow the page
(`docs/architecture/markdown.md:188-230`), tables keep their own horizontal box
(`style.css:3760`, owned by `content-blocks.md`).

### 1.2 Padding, measure, wallpaper

`#viewer-content` is `padding: 16px 40px var(--viewer-tail)` with `--viewer-tail: 48px`
(`style.css:2396-2398`), so the page is `16 / 40 / 48`. There is **no reading
max-width**: `max-width: 100%` on the page (`:2399`) and `max-width: none` on
`.markdown-body` (`:3133`). The text measure is the column width minus 80 px.

| Viewport | Editor column | Page | Measure | Source |
|---|---|---|---|---|
| 1280, default panes | 772 (1280 − 48 − 240 − 220) | 772 | 692 | `style.css:215-227`; `shell-frame.md` §1.2 |
| 861, default panes | 353 (861 − 48 − 240 − 220) | 353 | 273 | same |
| 861, panes at the reader floor | 352 | 352 | 272 | `style.css:215-227`; `shell-frame.md` §1.2 |
| 390, phone | 390 | 390 (cap 680 + 2 × 20 = 720) | 350 | `style.css:7427-7436` |

A classic (non-overlay) scrollbar subtracts its width from the page; the stylesheet sets
no `scrollbar-gutter` on the scroller.

The page paints no background of its own, so `--bg` on `body` (`:141-148`) —
`--surface-page` in the token set — shows through. The wallpaper gradients are painted on
`#viewer-content` in `scroll` mode and on `#viewer-scroll` in `fixed` mode (`:2433-2471`;
host rule in `docs/archive/design/viewer-scroll-container.md`). Pattern pitch is `1.5em`
for lines and `24px` for the grid, so lines track the prose line-height on desktop.
**Do not change the wallpaper, its host, or the page's transparency.** The page must stay
`overflow: visible` or the pattern host and figure sizing both break (`:2388-2391`).

### 1.3 First paint and tab switch

| Moment | What happens | Source |
|---|---|---|
| Server render | `#viewer` is visible, `#viewer-content` is empty, `#welcome` is `hidden`. The saved `--font-scale` and pane widths are inline on `<html>` before the stylesheets, so the first frame has the right type size. | `index.html:2`, `:381-383`, `:400` |
| Boot | Nothing is drawn in the page until the first `viewer.activate()` resolves and `render()` fills it. There is no loading UI, so the first paint is a blank padded page. | `viewer.js:791-831`, `:425-436` |
| Cached note | `render()` runs inside the click task; the swap is one `innerHTML` assignment. No transition, no fade. | `viewer.js:434`; `foundations.md` §7.4 |
| Tab switch | `activate()` → `showViewer()` + `render()` (`viewer.js:821-822`). The scroller is not reset, so the new note inherits the old `scrollTop`, clamped to its own height. | `viewer.js:791-832`; no `scrollTop` reset exists outside `vimnav.js:278` |
| Back / deep link | `applyNavEntry()` writes `viewerScrollEl.scrollTop` one frame after the switch; the per-file `scrollPositions` map is written but never read. | `viewer.js:589-599`, `:1518-1546` |
| Heading jump | `scrollIntoView({ behavior: "smooth", block: "start" })`, no reduced-motion guard. | `viewer.js:1110-1112` |
| Phone resume | The last offset is restored from the mobile shell. | `mobile.js:1078-1085` |

The page carries no entrance animation and no content transition. Reader text layout,
font size, line height and scroll position may never animate (`foundations.md` §7.4).

The first element in the note has no top margin (`style.css:3153`), so a note that opens
with an `h1` sits 16 px below the top of the scroller, i.e. directly under the tab strip.

---

## 2. Type scale and rhythm

### 2.1 Prose base

| Property | Value | Source |
|---|---|---|
| Stack | `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` | `style.css:146` |
| Size | `1rem` → **14 px** at 1.0, **18.2 px** at 1.3 | `:138`, `:146` |
| Line | `1.5` → **21 px** at 1.0, **27.3 px** at 1.3 | `:146` |
| Weight | `400` | `:146` |
| Colour | `--text-primary` | `:3133` |
| Wrapping | `overflow-wrap: break-word` on the page | `:3137` |

`--font-scale` multiplies the root only (`:135-139`); every em length below follows it,
every px length does not. Desktop prose is UI type at reading size — there is no serif
and no second sans (`foundations.md` §4.1).

### 2.2 Element table

`em` is relative to the element's own font-size for size, padding and margin, and to the
inherited prose size for width and indent. Line is unitless and inherits.

| Element | Size | @1.0 | @1.3 | Line | Weight | Margin |
|---|---|---|---|---|---|---|
| `body` prose | `1rem` | 14 | 18.2 | 1.5 | 400 | 0 |
| `h1` | `1.9em` | 26.6 | 34.58 | 1.25 | 650 | `1.4em 0 .5em` = 37.24 / 13.3 → 48.41 / 17.29 |
| `h2` | `1.5em` | 21 | 27.3 | 1.25 | 650 | 29.4 / 10.5 → 38.22 / 13.65 |
| `h3` | `1.25em` | 17.5 | 22.75 | 1.25 | 650 | 24.5 / 8.75 → 31.85 / 11.38 |
| `h4`–`h6` | `1em` (no rule) | 14 | 18.2 | 1.25 | 650 | 19.6 / 7 → 25.48 / 9.1 |
| `p` | `1em` | 14 | 18.2 | 1.5 | 400 | `.7em 0` = 9.8 → 12.74 |
| `ul`, `ol` | `1em` | 14 | 18.2 | 1.5 | 400 | `.7em 0`; `padding-left: 1.6em` = 22.4 → 29.12 |
| `li` | `1em` | 14 | 18.2 | 1.5 | 400 | 0 (none) |
| `li > ul`, `li > ol` | — | — | — | — | — | `margin-top: .15em` = 2.1 → 2.73; bottom 0 |
| `blockquote` | `1em` | 14 | 18.2 | 1.5 | 400 | `.7em 0`; `padding: .2em 1em` = 2.8 / 14 → 3.64 / 18.2 |
| `hr` | — | — | — | — | — | `1.5em 0` = 21 → 27.3 |
| `code` (inline) | `.9em` | 12.6 | 16.38 | 1.5 | 400 | `padding: .12em .4em` = 1.51 / 5.04 → 1.97 / 6.55 |
| Task checkbox | `1em` box | 13.33 | 13.33 | — | — | UA input type, so it does not scale: `0 .53em 0 -1.53em` = 7.07 / −20.4 at every font scale |

Sources: `h1`–`h6` `style.css:3142-3148`, `h1` `:3154`, `h2` `:3155`, `h3` `:3156`,
`p` `:3157`, lists `:3162`, nested `:3186`, quote `:3240-3250`, `hr` `:3764`, inline code
`:3257-3263`, task box `:3201-3221`.

`h1` adds `padding-bottom: .2em` (5.32 → 6.92) and a 1 px `--border` bottom rule
(`:3154`). `h4`–`h6` have no desktop size rule, so they render at prose size and differ
from `p` only in weight, line and margin. Margins are top / bottom; the arrow separates
1.0 from 1.3.

### 2.3 Rhythm

| Gap | 1.0 | 1.3 | Why |
|---|---|---|---|
| Prose line to line | 21 | 27.3 | `1.5` line (`:146`) |
| Paragraph to paragraph | 9.8 | 12.74 | one `.7em` margin; the two collapse (`:3157`) |
| Paragraph to list, quote, code | 9.8 | 12.74 | all `.7em`, so a toggled block never moves its neighbours (`docs/architecture/markdown.md:76-107`) |
| List item to item (tight or loose) | 21 | 27.3 | edge `p` margins collapse inside `li` (`:3182-3183`) |
| List to nested list | 2.1 above the child's first line | 2.73 | `margin-top: .15em` (`:3186`) |
| Quote to paragraph | 9.8 | 12.74 | `.7em` + edge-paragraph collapse (`:3255-3256`) |
| `hr` to either side | 21 | 27.3 | `1.5em` (`:3764`) |
| Heading to preceding block | 1.4em of the heading's size | same | `:3144` |
| Heading to following block | .5em of the heading's size, or the next block's `.7em` if larger | same | `:3144` |

Adjacent block margins collapse, so a gap is one margin, not two. For `h1`–`h3` the
heading's `.5em` bottom exceeds a following paragraph's `.7em`; for `h4`–`h6` it does not,
and the paragraph's `.7em` sets the gap.

Three rules do the work and must not be "simplified":

1. `.markdown-body > :first-child { margin-top: 0 }` — only the page's first block
   (`:3153`). A note whose first block is a list or quote also loses its top margin.
2. `.markdown-body li > p:first-child/:last-child` collapse item edge margins only, so a
   multi-paragraph item keeps its internal break (`:3182-3183`;
   `docs/architecture/markdown.md:128-145`).
3. `blockquote > :first-child/:last-child` does the same for a quote, so a one-line quote
   is not 2.2× a paragraph tall (`:3255-3256`).

There is no per-item margin anywhere. Tight and loose lists render at the same item pitch;
that equality is the contract, not a coincidence.

### 2.4 Lists and task lists

| Property | Value | Source |
|---|---|---|
| Indent per level | `--list-indent: 1.6em` (22.4 / 29.12 px) | `:80`, `:3162` |
| Marker | UA default: `disc` at level 1, `circle` at 2, `square` at 3 (`ul`) | no rule |
| Marker position | UA `outside`; the marker lives in the 1.6em pad | `:3162` |
| Nested list | `margin-top: .15em`, `margin-bottom: 0` | `:3186` |
| Task item marker | `list-style: none` when the `li` holds a checkbox directly or through a `p` | `:3198-3200` |
| Task box | `1em` square, `1px --text-muted`, `3px` radius, transparent face | `:3201-3221` |
| Task box, checked | `--accent` face and border, `--accent-fg` tick | `:3222-3239` |
| Task box, hang | `margin: 0 .53em 0 -1.53em` — the sum is −1em, so the item text does not move | `:3201-3210` |
| Task box state | marked emits `disabled`; the box is never interactive in the reader | `style.css:3212-3216` |

The selector is child-scoped, so a plain item that merely contains a nested task list
keeps its own bullet (`:3194-3198`). The list-drag rails read the same `--list-indent`
variable, so the indent always matches the guides (`:76-80`).

### 2.5 Headings

- All six levels: weight 650, line 1.25, `scroll-margin-top: calc(var(--topbar-h) + 8px)`
  (`:3144-3147`).
- `h1` is the only level with a rule under it (`:3154`). There is no numbering, no
  anchor-link glyph and no heading hover state.
- Heading ids are assigned after render for the outline and deep links; they are not
  visible (`viewer.js:201-215`, `docs/architecture/markdown.md:21-24`).
- Headings inside a blockquote or list item inherit the same rules; only their margins
  collapse against the container's edges.

---

## 3. Inline elements

| Element | Face | Type | Decoration | Source |
|---|---|---|---|---|
| `a` | `--accent` | inherit | UA underline (no `text-decoration` rule) | `:3158` |
| `a[data-wikilink]` | `--accent` | inherit | underline, `text-underline-offset: 2px` | `:3161` |
| Unresolved `[[Target]]` | `--text-primary` | inherit | none; a `<span data-wikilink-raw>` holding the literal token | `viewer.js:277` |
| `strong` | inherit | inherit | UA `700` — no rule; matches `--fw-bold` | none |
| `em` | inherit | inherit | UA italic | none |
| `del` (GFM strikethrough) | inherit | inherit | UA line-through | none |
| `code` | `--code-bg` | `.9em` `--font-mono`-class stack, `4px` radius | none | `:3257-3263` |
| `mark` (raw HTML, no class) | UA yellow | inherit | none | no rule |
| `mark.search-highlight` | `--accent`, text `--text-on-accent` (E2, §5.4) | inherit | `2px` radius, `0 2px` padding | `:3777-3779` |
| `sup`, `sub` | inherit | UA smaller, shifted | none | no rule |
| `kbd`, `abbr`, `u`, `small`, `q` | inherit | UA | UA | no rule |
| `figure`, `dl`, `details` | inherit | inherit | block, `.7em 0` | `:3190` |

Notes:

- Links are underlined by the browser, not by this stylesheet; only the wikilink sets an
  offset. A link's colour alone is never the signal, so do not remove the UA underline.
- A wikilink's `href` is the raw target, resolved on click through the in-app router
  (`viewer.js:283`, `:1362-1368`). An unresolvable target is plain text and is not a dead
  link (`docs/architecture/markdown.md:412-414`).
- Inline code is `.9em` of the surrounding size, so it shrinks inside a heading or a
  table cell too. `box-decoration-break: clone` on the page's code keeps the pill at both
  ends when the run wraps (`:3138-3141`). The shipped stack is
  `"SFMono-Regular", Menlo, Consolas, monospace` (`:3258`); `--font-mono` is the target
  name (§9 P8) and renders identically wherever the first three families are absent.
- Raw HTML prose is passed through un-sanitised for notes (`docs/architecture/markdown.md:39-45`),
  so `u`, `kbd`, `abbr` and `mark` render with browser defaults. They are content, not
  chrome; do not style them per note.
- **Footnotes are not supported.** marked v12 runs in GFM mode with no footnote
  extension (`viewer.js:434`; `docs/architecture/markdown.md:55-64`), so `[^1]` and a
  `[^1]: …` definition render as literal text. There is no `sup` reference, no backlink,
  and no footnote block. Do not add a stylesheet for one.

---

## 4. States

| State | What the page shows | Source | Gap |
|---|---|---|---|
| **First paint / loading** | A blank page: padding and wallpaper only. No spinner, no skeleton, no `aria-busy`. | `index.html:381`; `viewer.js:425-436` | A slow filesystem shows nothing. §9 P9. |
| **Render error (marked missing)** | The literal paragraph "marked.js failed to load." in prose type. Nothing else changes. | `viewer.js:437-439` | It reads as note text. No role, no retry. |
| **Open failure** | The reading pane draws nothing. The tab is dropped and the neighbour — or the welcome page — takes over. | `tabs.js:850-859` | No error surface in the pane. |
| **Empty (reference)** | `#welcome` replaces `#viewer`; the page is emptied first. Out of scope. | `viewer.js:693-717`; `index.html:400` | Later document. |
| **Long note** | The page grows; the scroller is the only scrollbar. No virtualisation, no inner scrollers. | `:2380-2400`; `docs/architecture/markdown.md:214-230` | — |
| **Very long unbroken word** | Wraps at the page edge via `overflow-wrap: break-word`. `min-content` is untouched, so a table or `pre` keeps its own overflow. | `:3134-3137` | A single unbroken run in a heading can still overflow its line box on a very narrow column; no `hyphens`. |
| **No headings** | The page is unchanged; the outline pane shows "No headings". | `outline.js:26-29` | Outside this surface. |
| **Read-only** | No visual difference. The reader is always read-only; the only editable state is hybrid mode, which is out of scope. | `:2694-2703` | — |
| **Hybrid (out of scope)** | `#viewer-content` becomes `contentEditable`, takes a 2 px `--accent-soft` inset outline and 20 px top padding. | `:2694-2703`, `:2736-2744` | Documented here only so it is not mistaken for a reader state. |

A note with no blocks at all is indistinguishable from loading: `innerHTML` is empty and
the page is one viewport of wallpaper (`min-height: 100%`, `:2397`).

---

## 5. Selection and search highlight

### 5.1 Selection

No `::selection` rule ships (`grep ::selection static/css/style.css` returns nothing).
The browser default is in force, which is not controllable per theme. `foundations.md`
§3.5 and Appendix A define the token pair and the rule; the reader adopts it as exception
**E1** (§5.4).

| Token | Dark | Light |
|---|---|---|
| `--selection-bg` | `rgba(124, 156, 255, .28)` | `rgba(47, 95, 208, .16)` |
| `--selection-text` | `--text-primary` | `--text-primary` |

Measured on the page: the selection text stays at 8.3:1 (dark) and 12.4:1 (light) over the
composited wash. The wash is translucent, so it reads correctly over the wallpaper in
either wallpaper mode.

### 5.2 Search highlight

| Property | Value | Source |
|---|---|---|
| Element | `<mark class="search-highlight">` wrapped around the first text match | `viewer.js:1125-1139` |
| Face | `--accent` | `:3778` |
| Text | `#fff` shipped — **2.61:1** in dark, 5.72:1 in light — E2 changes it to `--text-on-accent` (6.99:1 dark) | `:3778`; `foundations.md` §3.6 |
| Shape | `2px` radius, `0 2px` padding, no box-decoration-break | `:3778` |
| Scroll | `scrollIntoView({ behavior: "smooth", block: "center" })` | `viewer.js:1137` |
| Lifetime | One mark per click; existing marks are never cleared, so repeated result clicks accumulate highlights and a mark can survive into hybrid mode | `docs/product/search-gaps.md:76` |

The highlight marks the first rendered occurrence, not the matched line
(`docs/product/search-gaps.md:76`). Clearing old marks is a product decision recorded
there; this document only specifies the paint.

### 5.3 Focus within the page

| Target | Ring today | Target |
|---|---|---|
| Content links | Browser default only — no `:focus` rule exists for `.markdown-body a` | 2 px `--focus-ring`, offset 2 (E3, §5.4) |
| Task checkbox | Not focusable: `disabled` (`style.css:3212-3216`) | none — it is content |
| The page itself | No tab stop; arrow and Page keys scroll it from `document` | §9 P1 |
| Code copy button | Hidden until `pre:focus-within`, then visible and focusable (`:3314-3333`) | owned by `content-blocks.md` |

Keyboard scrolling is a document-level handler: Arrow Up/Down move 48 px, Page Up/Down
move one scroller height, and it yields to a focused input, the editor, a special tab, or
no open file (`viewer.js:1449-1487`). Vim's `j`/`k`/`d`/`u`/`gg`/`G` write the same
scroller (`vimnav.js:275-279`, `:344-355`).

### 5.4 Applied exceptions

Three additions, and only these three. Each is in the mockup. E1 is the foundation's own
rule from Appendix A; E2 fixes a measured failure; E3 closes a missing focus ring. None
changes spacing, type, colour at rest, or layout.

| # | Rule | Why | Cost |
|---|---|---|---|
| **E1** | `::selection { background: var(--selection-bg); color: var(--selection-text); }` | No rule ships, so selection is the browser default and cannot follow the theme (`foundations.md` §3.5, Appendix A). | None. Text stays `--text-primary` on a translucent accent wash: 8.3:1 dark, 12.4:1 light. |
| **E2** | `.markdown-body mark.search-highlight { color: var(--text-on-accent); }` | White on the dark accent is **2.61:1** (`style.css:3778`), below both floors. `--text-on-accent` is 6.99:1 there. | None in light (the token is white, unchanged); the dark mark gets near-black text on blue. |
| **E3** | `.markdown-body a:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-offset); }` | No focus rule exists for content links, so the ring is the UA default and does not match the shell (`foundations.md` §10.2). | None at rest. A 2 px accent ring on keyboard focus only. |

E2 is the `.search-highlight` fix that `foundations.md` §3.6 defers to "the reader pass".
E1 is global rather than reader-scoped, because `::selection` cannot be scoped to one
region without repeating the selector on every descendant; the declaration is the one
Appendix A specifies.

All three read foundation tokens — `--selection-bg`, `--selection-text`, `--text-on-accent`,
`--focus-ring`, `--focus-offset` — so they land with the Appendix A token block. Until that
block lands, the shipped names are `--accent-fg`, `--accent`, and a literal `2px` ring at
offset `2px`; do not add a second set of tokens for the reader.

---

## 6. Accessibility

### 6.1 Structure

| Requirement | Shipped | Source | Verdict |
|---|---|---|---|
| The page is inside the main landmark | `<main id="layout">` wraps the rail, panel, editor and outline | `index.html:185` | Pass |
| The note has its own landmark | No `<article>`, no `role="document"`. `#viewer-content` is a bare `div` | `index.html:381` | Gap — §9 P6 |
| Heading levels | `#`→`h1` … `######`→`h6`, real heading elements | `viewer.js:434` | Pass in the note; the first note heading follows the chrome's `h2` panel titles in DOM order |
| Lists | Real `<ul>`/`<ol>`/`<li>`; task items keep `li` | marked output | Pass |
| Quote | `<blockquote>` | marked output | Pass |
| Selection order | DOM order; no positive `tabindex` | `foundations.md` §10.5 | Pass |
| Skip path | None. The first Tab stop is `#brand`, then the rail, the panel and its view, the tab strip, then the note | `index.html:112`, `:280` | Gap — §9 P7 |

A note's heading tree is author-controlled and cannot be corrected by the shell. Do not
rewrite note headings. Do not inject a hidden heading.

### 6.2 Names

| Element | Accessible name today | Source | Note |
|---|---|---|---|
| Content link | Its text | — | The text is the name; a bare URL is its own name. |
| Wikilink | Its label, or the target when no label is given | `viewer.js:271-283` | The label is the note's own text. |
| Task checkbox | **None.** A `disabled` input with no `<label>` and no `aria-label`; the item text follows it in the same `li` | `style.css:3212-3216` | Gap — §9 P5 |
| Decorative `hr`, quote rail | Not exposed (CSS only) | — | Pass |

### 6.3 Contrast

Measured against the surface named. Text floor 4.5:1, UI graphic 3:1.

| Pair | Dark | Light | Verdict |
|---|---|---|---|
| Prose `--text-primary` on `--surface-page` | 13.82 | 15.66 | pass |
| `--text-muted` on `--surface-page` (shipped `#8b8d98` / `#5d6470`) | 5.21 | 5.96 | pass |
| Blockquote text `--text-muted` on `--accent-soft` over the page | **3.85** (4.48 after the foundation's `#9799a4`) | 5.03 | **fail, dark** — §9 P2 |
| Link `--accent` on the page | 6.60 | 5.72 | pass |
| Link inside a quote | 4.87 | 4.83 | pass |
| Inline code text on `--code-bg` | 14.65 | 13.96 | pass |
| Quote rail `--accent` on the quote face (3:1 UI) | 4.87 | 4.83 | pass |
| Task box border `--text-muted` on the page (3:1 UI) | 5.21 | 5.96 | pass |
| Search highlight text on `--accent` | **2.61** | 5.72 | **fail, dark** — fixed by E2 |
| `hr` / `h1` rule `--border` on the page | 1.52 | 1.37 | decorative, no floor |

The ratios above for the quote face are computed as the accent wash composited over
`--surface-page`. The shipped dark `--fg-muted` fails inside a quote and is the only
body-text failure in the reader; the foundation's next value still lands at 4.48 and does
not close it. Do not fix it by eye — §9 P2 names the two legal routes.

### 6.4 Zoom and text size

At `--font-scale: 1.3` the measure does not change (692 px desktop, 350 px phone), so the
line count per paragraph grows and nothing clips: headings, quote, list indent and inline
code are all em. At 200 % browser zoom the phone shell takes over below 860 px and the
page keeps its gutter (`foundations.md` §10.6). No reader type or spacing value is a fixed
px except the page padding, the 1 px heading rule and the 2 px wikilink offset.

---

## 7. Responsive and phone

### 7.1 Desktop

| Width | Shell | Page | Prose | Heading block |
|---|---|---|---|---|
| 1280, 1.0 | four columns, editor 772 | 772 / measure 692 | 14 / 21 | 26.6 / 21 / 17.5 / 14 |
| 1280, 1.3 | same | same | 18.2 / 27.3 | 34.58 / 27.3 / 22.75 / 18.2 |
| 861, 1.0 | desktop at the last pixel, editor 353 | 353 / measure 273 | 14 / 21 | same as 1280 |
| 861, 1.3 | same | same | 18.2 / 27.3 | same |

The heading block is `h1 / h2 / h3 / h4` size. Nothing about the reading surface responds
between 1280 and 861 except its width: same padding, same type, same margins. The 40 px
gutter is 5 % of the column at 1280 and 11 % at 861.

### 7.2 Phone

The phone override is inside the single mode query `(max-width: 860px), ((pointer:
coarse) and (max-width: 1023px))` (`style.css:6975`). The reader part is `:7422-7444`.

| Property | Desktop | Phone |
|---|---|---|
| Page width | column | `100 %`, `max-width: calc(680px + 2 × 20px)` = 720, centred |
| Padding | `16px 40px 48px` | `16px 20px calc(56px + inset + 24px)`, with the safe-area inset added per side |
| Prose | `1rem` / 1.5 | `calc(16px × scale)` / **1.65** (16 / 26.4 at 1.0; 20.8 / 34.32 at 1.3) |
| `h1` | `1.9em`, lh 1.25, `1.4em 0 .5em` | `1.7em`, lh **1.2**, `0 0 .45em`, same 1 px rule |
| `h2` | `1.5em`, lh 1.25 | `1.4em`, lh 1.25 |
| `h3` | `1.25em`, lh 1.25 | `1.2em`, lh **1.3** |
| `h4` | `1em` | `1.05em` |
| `h5`, `h6` | `1em` | unchanged |
| `p` | `.7em` | **`.85em`** |
| List, quote, `hr`, inline code | as desktop | unchanged, at the 16 px base |
| Tail | 48 | rail 56 + inset + 24 = 80 |
| Scroller | `overscroll-behavior-y: contain` | `overscroll-behavior: contain`, `-webkit-overflow-scrolling: touch` |

Consequences of the phone block that are easy to get wrong:

- `h1` loses its top margin as a page first child and again through its own `0` top.
  At 1.0 a phone `h1` is 27.2 px, its `h1` rule is 5.44 px of padding plus 1 px.
- Paragraph gaps are 13.6 px at 1.0 (`.85em` of 16 px), against 9.8 px on desktop —
  the phone relaxes the rhythm, it does not scale it.
- Only the page's `font-size` changes to 16 px; `1.6em` of a list indent is 25.6 px and
  `.9em` of inline code is 14.4 px.
- The phone has no tab strip and no outline pane, so a note starts at the top of the
  scroller directly under the 52 px topbar (`style.css:7085`).

---

## 8. Print

### 8.1 What the app prints today

The only print rule in `style.css` hides the two copy affordances
(`style.css:3620-3623`). Everything else prints as it looks on screen: the topbar, rail,
side panel, tab strip and outline included. Because `#viewer-scroll` is a fixed-height
scroller, a direct browser print of a long note captures one viewport and clips the rest.

| Prints | Hidden | Breaks |
|---|---|---|
| The whole shell and the note as displayed in the current viewport | `.code-copy-btn`, `.nb-copy-img-btn` | None specified; the UA decides |

Direct print of the app is **not a supported reading surface**. Do not build one here.

### 8.2 The supported print path

A note is printed through the export path, which owns print CSS in `export.js`
`printRules()` (`static/js/export.js:745-768`). Those rules are the reader's print
contract:

| Rule | Effect |
|---|---|
| `body, html` → white background, `#1f2330` text | A note always prints light, whatever the screen theme |
| `.markdown-body a` → `#2f5fd0`, underlined | Link colour is print-safe and never colour-only |
| `.markdown-body a[href^="http"]::after` → ` (href)` | A printed link stays followable |
| `pre, code, blockquote, table, img, svg, .katex-display, figure` → `break-inside: avoid` | A block is not split across a sheet |
| `h1` → `break-before: page`, except the first `h1` | Each top-level section starts a sheet |
| `h2`, `h3` → `break-after: avoid` | A heading is never stranded at the foot of a sheet |
| Figures and `html-live` → one-page cap | A tall artefact is scaled or clipped, never paginated |

Text-only content (headings, paragraphs, lists, quotes, inline code) keeps the screen
rhythm; there is no separate print type scale. The mockup's print board illustrates this
contract.

---

## 9. Proposals, not applied

Nothing in this table is applied. E1–E3 in §5.4 are the only changes in this document and
are the only deltas the mockup shows. Each proposal names its reason and its cost.

| # | Proposal | Why | Cost |
|---|---|---|---|
| **P1** | Make `#viewer-scroll` a Tab stop and a named region: `tabindex="0"`, `role="region"`, `aria-label="Note"`, inset 2 px ring. | Firefox does not put a scroll container in the tab order; keyboard users cannot reach the page without a link, and shell-frame §7.1 already names "reader" as a focus step. | One attribute set on `index.html:381` and one `:focus-visible` rule. Adds a stop before the first link; shell-frame owns the focus order, so it must land with that doc's next edit. |
| **P2** | Close the blockquote text failure. Two legal routes: use `--text-primary` inside a quote, or add a dedicated `--text-muted-on-wash` (`#9ea0ab` dark / unchanged light) in the foundation and read it here. | 3.85:1 today; 4.48 after the foundation's `#9799a4`. Both are below 4.5. | Route one makes quotes read as loud as body text and changes the shipped look. Route two needs a new colour token and a second declaration per theme. |
| **P3** | Guard `scrollToHeading()` and `jumpToMatch()` with `prefers-reduced-motion`; use `behavior: "auto"` when it matches. | Both scroll smoothly today (`viewer.js:1112`, `:1137`); foundations §7.3 requires a reduced-motion twin and §7.4 forbids animating the reader's scroll. | One media-query read per call. No visual change without the setting. |
| **P4** | Add a reader print block: flatten the shell, `#viewer-scroll { overflow: visible; height: auto }`, hide the chrome, and copy the export's break rules. | Direct print currently clips the note to one viewport and prints the chrome. | A new `@media print` block and a risk of drifting from `export.js`. The export path already serves print; this is only for printing the app page. |
| **P5** | Give the task checkbox a name: `aria-label="Done"` / `"Not done"` from the renderer, keeping it `disabled`. | A screen reader announces "checkbox, checked, disabled" with no name today. The item text follows but is not the control's name. | `viewer.js` render pass, plus the hybrid round-trip must not write the attribute. |
| **P6** | Wrap the note in `<article aria-labelledby="…">` (or `role="document"` on `#viewer-content` with the note title). | The page has no landmark of its own inside `<main>`; a note's `h1` also follows the chrome's `h2` panel titles in DOM order. | A markup change in `index.html` and a title id from the renderer; the heading-level jump is not fixed by `role="document"`, only scoped. |
| **P7** | A skip link to the note (visually hidden until focused) before `#topbar`. | No skip path exists; reaching the note from a cold Tab costs the whole chrome. | One anchor and a `.sr-only`-style rule; adds a focusable element before the brand. |
| **P8** | Read `--font-mono` and `--radius-xs` in inline code (`:3257-3263`). | The shipped stack omits `ui-monospace` and writes `4px`; both are foundation tokens with the same rendered result on every platform where the first families are absent. | One line, no visual delta. |
| **P9** | `aria-busy="true"` on `#viewer` while a note's first fetch is in flight, and a one-line quiet "Loading…" in the page after 300 ms. | A cold filesystem shows a blank page with no announcement. `controls.md` §2.15 forbids a spinner under 300 ms but allows a line. | A JS flag and one rule; risks a flash on fast local reads unless delayed. |
| **P10** | Fix `scroll-margin-top` for headings: `var(--space-2)` instead of `var(--topbar-h) + 8px`. | The scroller already starts below the topbar, so a deep link lands 54 px low — 46 px of them wasted (`:3145`). | One line. Changes only the landing position of deep links and outline clicks. |
| **P11** | Clear existing `.search-highlight` marks before each `jumpToMatch()`. | Repeated result clicks accumulate marks and one can survive into hybrid mode (`docs/product/search-gaps.md:76`). | A JS unwrap pass before the wrap. Product behaviour is owned by `search-gaps.md`. |
| **P12** | Give a raw `<mark>` a token face in both themes. | Unstyled `mark` is UA yellow on a dark page; it is the one inline element with no design decision. | A new colour pair, or reuse `--accent-soft` with `--text-primary`. Changes note content appearance. |

Deliberately **not** proposed: a reading max-width, a serif face, a line-height bump, a
heading anchor glyph, a sticky title, a progress bar, or a card around the page. The user
likes this surface; each of those is a redesign, not a fix.

---

## 10. Acceptance criteria

Each is observable in the app or in the mockup and names its file.

| # | Criterion | File | Observable |
|---|---|---|---|
| **AC1** | `#viewer-scroll` is the only scroller and `#viewer-content` is its only child | `templates/index.html` | Scrolling a long note changes `#viewer-scroll.scrollTop`; `getComputedStyle(#viewer-content).overflowY` is `visible`. |
| **AC2** | The page keeps `16px 40px 48px` and no reading max-width at 1280 | `static/css/style.css` | A full-width paragraph's client rect is 692 px wide in a 772 px editor column; no rule constrains its measure. |
| **AC3** | Prose is `1rem/1.5` and follows `--font-scale` | `static/css/style.css` | At S/M/L/XL the computed prose size is 12.6 / 14 / 16.1 / 18.2 px and the line is 1.5×. |
| **AC4** | Headings are 1.9 / 1.5 / 1.25 / 1 em at weight 650, line 1.25, `1.4em 0 .5em`; the first block has no top margin | `static/css/style.css` | A note opening with `h1` starts 16 px below the scroller top; every other heading has 1.4em above it. |
| **AC5** | Every block construct carries `.7em` margins; only `hr` and headings differ | `static/css/style.css` | Toggling a paragraph to a list, quote or fence leaves the neighbours still; the collapsed paragraph gap measures 9.8 px at 1.0. |
| **AC6** | List indent is `--list-indent` and nested lists add `.15em` on top | `static/css/style.css` | A level-2 list starts 44.8 px in at 1.0; the list-drag rail sits on the same x. |
| **AC7** | A task box is 1em, hangs 1em left, and carries no bullet | `static/css/style.css` | The first character of the task text aligns with a plain item's text; the box is at the marker column. |
| **AC8** | Blockquote is a 3 px accent rail, `--accent-soft` face, `.2em 1em` padding, muted text | `static/css/style.css` | A one-paragraph quote is one line plus 5.6 px; a two-paragraph quote keeps its internal gap. |
| **AC9** | Links are `--accent`; wikilinks add a 2 px underline offset | `static/css/style.css` | Computed link colour is the accent token; `text-underline-offset` is 2px on `a[data-wikilink]` only. |
| **AC10** | Phone prose is 16 px / 1.65 with a 20 px gutter and a 720 px cap | `static/css/style.css` | At 390 the page padding is 16/20/80 and the measure is 350; at 1.3 the prose is 20.8 px. |
| **AC11** | `::selection` uses the token pair | `static/css/style.css` | Selecting prose paints `rgba(124,156,255,.28)` in dark; the rule exists once, not per component. |
| **AC12** | `.search-highlight` text clears 4.5:1 in both themes | `static/css/style.css` | Dark text is `--text-on-accent` (6.99:1); light is unchanged at 5.72:1. |
| **AC13** | Content links show a 2 px accent ring on `:focus-visible` | `static/css/style.css` | Tabbing from the tab strip into a note lands on a link with a visible ring at offset 2. |
| **AC14** | The mockup is self-contained and renders the note at 1280, 861 and 390 | `docs/ui/reader-mockup.html` | Opening the file offline shows all boards with zero network requests. |

AC11–AC13 are the applied exceptions; every other criterion describes shipped behaviour.

---

## 11. What not to build

- **No reading column.** No `max-width`, no `ch` cap, no centred text column, no
  adjustable measure. The page fills the editor column (`style.css:3133`).
- **No second scroller.** The page never scrolls, never gets `overflow: auto`, and never
  gets a height. A nested scroller breaks the wallpaper host and the figure viewport
  (`:2388-2391`, `docs/architecture/markdown.md:214-230`).
- **No typographic redesign.** No serif, no second sans, no web font, no drop cap, no
  justified text, no hyphenation, no new line-height for prose, no letter-spacing on
  body text.
- **No animation.** No fade on tab switch, no reveal on render, no smooth scroll without
  a reduced-motion guard, no transition on selection or highlight.
- **No chrome in the page.** No sticky heading bar, no progress indicator, no breadcrumb,
  no floating "back to top" button, no reading-time label, no per-heading anchor glyph.
- **No card.** No border, radius, shadow or background on `.markdown-body`, a paragraph,
  a list, a quote or a heading. The page is paper.
- **No editing affordances in read mode.** Hybrid mode owns click-to-edit; the reader
  must not grow hover outlines, pencils or block handles.
- **No restyle of code, tables, images, math or the six special blocks.** Their internals
  belong to [`content-blocks.md`](content-blocks.md); the reader only guarantees the
  `.7em` block margin.
- **No colour literal.** Every colour is a token. A one-off hex in the reader is a defect.
- **No `filter`, `opacity` or `color-mix()` as a state.** Selection and highlight are
  token colours, not filters.
- **No footnote support.** The renderer does not produce footnotes; do not style
  `[^1]` as if it did.
