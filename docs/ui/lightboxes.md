# Lightboxes — Mermaid, WaveDrom, Graphviz, SVG

Status: Current spec — pre-implementation (codifies the shipped overlay).

Reference mockup: [`lightboxes-mockup.html`](lightboxes-mockup.html) — dark and light: Mermaid at
100 %, zoomed 200 %, fit, WaveDrom, Graphviz, SVG, the control pill with a focused button, the
loading and error cards that are **not** triggers, the 390 phone overlay, and the measured
anatomy.

**The shipped look is the target.** The user likes the current overlay. This document codifies
it exactly: the scrim, the body, the control pill, zoom, fit and close. Nothing that changes a
pixel ships here except the accessibility additions in §6.5, and each of those is recorded. Every
visual change is in §10, proposals only.

**Prerequisite.** [`foundations.md`](foundations.md) §11.1 and [`controls.md`](controls.md) §3.3 step 1 must land before any rule below; until then a token rule falls back to the shipped literal.

**Normative source.** This document owns the four full-screen viewers and nothing else. It reads
[`foundations.md`](foundations.md) for tokens and [`controls.md`](controls.md) §2.13 for control
anatomy. It does **not** own the diagram cards ([`content-blocks.md`](content-blocks.md) §6), the
edit windows, Settings, or the shell. The trigger contract is inherited from `content-blocks.md`
§6.3 and restated in §2.1 only so this file is self-contained.

Neither archived record describes this overlay: `docs/archive/design/graph-3d.md` is diagram
drawing only, and `docs/archive/ui/workspaces.md` is unrelated. Both are source material, not
current specs. Where they disagree with this document, this document wins.

Every claim about current code cites `file:line`.

---

## 1. Anatomy

### 1.1 One implementation, four instances

| Instance | Overlay id | Body id | Control prefix | Trigger selector | Caller |
|---|---|---|---|---|---|
| Mermaid | `#mermaid-lightbox` | `#mermaid-lightbox-body` | `mlb-*` | `.mermaid-container` | `static/js/mermaid.js:320-329` |
| WaveDrom | `#wavedrom-lightbox` | `#wavedrom-lightbox-body` | `wdlb-*` | `.wavedrom-container` | `static/js/wavedrom.js:255-264` |
| Graphviz | `#viz-lightbox` | `#viz-lightbox-body` | `vizlb-*` | `.viz-container` | `static/js/viz.js:179-188` |
| SVG | `#svg-lightbox` | `#svg-lightbox-body` | `svglb-*` | `.svg-container` | `static/js/svg.js:123-132` |

The markup is four copies of one block: `templates/index.html:1792-1801`, `:1808-1817`,
`:1824-1833`, `:1839-1848`. All four carry the same classes — `.mermaid-lightbox-overlay`,
`.mermaid-lightbox-body`, `.mermaid-lightbox-controls`, `.mlb-btn`, `.mlb-zoom-pct`,
`.mlb-close-btn` — and differ only in element ids. The factory is
`NB.lightbox.create(cfg)` (`static/js/lightbox.js:47-308`); each caller passes its six ids and one
container selector.

The class names still say "mermaid" although four types use them. **Do not rename them.** Every
caller and three CSS-source assertions select these names
(`tests/dom/test_dom.js:4294-4302`). One `<template>` replacing the four copies is proposal P5,
not this pass.

Two instances are independent by construction: each `create()` call owns its own
`lightboxOpen`, `zoomLevel`, `zoomFit`, `panX` and `panY` (`lightbox.js:59-63`), so opening a
second type never disturbs the first.

### 1.2 Structure

```
overlay   position: fixed; inset: 0; z 2000; scrim .55 + blur 8
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   body  padding 60px 40px, overflow auto, centred             │
│         ┌──────────────────────────────────┐                 │
│         │  one cloned <svg>                │                 │
│         │  .svg-fit, or translate+scale    │                 │
│         └──────────────────────────────────┘   ┌───────────┐ │
│                                                │− Fit + ⊞ ×│ │ controls pill
│                                                └───────────┘ │ top/right 16, local z 10
└──────────────────────────────────────────────────────────────┘
```

There is no title bar, no header, no footer, no source pane, no caption, no backdrop close
button, and no separate close layer. The scrim **is** the overlay; the body and the pill are its
two children.

### 1.3 The artefact (the source card)

The overlay holds a **clone of the card's SVG, and nothing else**.

| Rule | Value | Source |
|---|---|---|
| What is copied | the card's `.nb-figure-viewport > svg`, else the first `svg` in the card | `lightbox.js:301-302` |
| Clone, not move | `svg.cloneNode(true)`; the original stays in the reader | `lightbox.js:114`; asserted at `tests/dom/test_dom.js:4136-4142` |
| Inline style | stripped: `clone.removeAttribute("style")` | `lightbox.js:115` |
| Kept attributes | `width`, `viewBox`, `data-nb-*`, and any `preserveAspectRatio` the library wrote | `blocks.js:561-571` |
| Body contents | emptied, then one child | `lightbox.js:113`, `:116` |
| Card chrome | **not** copied: no card padding, border, radius, or `#fff` card background | `style.css:3407-3416`, `:3475-3483` |
| Library background | travels inside the SVG. WaveDrom's white skin is an embedded `<style>` in the SVG | `style.css:3467-3474` |
| Theme | baked at render; Mermaid does not re-theme on open | `static/js/mermaid.js:300-305` |
| No copy button | the clone is the `<svg>`, not the card, so no `.code-copy-btn` travels | `copy-image.js:732-785` |

Stripping `style` also drops the inline `aspect-ratio` and `--nb-w` that the sizing pass writes
(`blocks.js:514`, `:567`). That is deliberate: the fitted card size must not leak into the
overlay. The `viewBox` alone carries the ratio.

Consequence: the artefact has no accessible name and no visible label. The `<title>` a library
may emit is the only one, and the app adds none (`content-blocks.md` §9.4).

### 1.4 Geometry

| Part | Shipped value | Source |
|---|---|---|
| Overlay | `position: fixed; inset: 0`; flex column, centred; `min-width/min-height: 0` | `style.css:3663-3676` |
| Overlay z | `2000` = `--z-modal` | `style.css:3666`; `foundations.md` §6.2 |
| Scrim | `rgba(0,0,0,.55)`, `backdrop-filter: blur(8px)` + `-webkit-` twin | `style.css:3667-3669` |
| Hidden | `[hidden] { display: none }` | `style.css:3677` |
| Body | `width/height: 100%`, `overflow: auto`, padding `60px 40px`, centred | `style.css:3729-3739` |
| Artefact at fit | `max-width: 100%`, `max-height: 100%`, `width: auto`, `height: auto`, `display: block` | `style.css:3743-3749` |
| Artefact transform | `transform-origin: center center`; `cursor: grab`; `.dragging` → `grabbing` | `style.css:3752-3759` |
| Pill | `position: absolute; top/right: 16px`; `gap: 4px`; `padding: 6px 8px`; `rgba(0,0,0,.45)`; radius 8; local `z: 10`; `user-select: none` | `style.css:3680-3692` |
| Button | `#fff` on transparent, `1px rgba(255,255,255,.25)`, radius 5, padding `3px 9px`, `1.05rem`/1.3, `min-width: 28px` | `style.css:3693-3707` |
| Close button | glyph `1.2rem`, padding-x 7, `margin-left: 2px` | `style.css:3715-3719` |
| Percentage | `rgba(255,255,255,.75)`, `.82rem`, `min-width: 3.2em`, tabular numerals, tracking `.3px` | `style.css:3720-3727` |

Measured at the 14 px base (`--font-scale: 1`): a zoom/fit button is **≈27.1 px** tall and at
least 28 px wide; the close button is **≈29.8 px** tall; the pill is **≈41.8 px** tall and
**≈185–200 px** wide for the five items, because the glyph widths follow the platform UI font.

The pill's local `z: 10` is a local stack value, not a shell band
(`foundations.md` §6.1 lists `.mermaid-lightbox-controls:3690` in the 1–18 group).

The **chrome is theme-invariant**. The scrim, the pill, its text and its borders are the same in
dark and light; only the artefact carries a theme. Nothing here reads `--surface-*` or
`--text-*`.

---

## 2. Open and close

### 2.1 Trigger contract

Inherited from `content-blocks.md` §6.3; the code is `lightbox.js:288-305`.

| # | Rule | Source |
|---|---|---|
| T1 | One delegated `click` listener on `document.body`; no listener per card | `lightbox.js:288` |
| T2 | Only clicks inside a reading root open: `#viewer-content` or `.ai-chat-log` | `lightbox.js:45`, `:291` |
| T3 | Hybrid (WYSIWYG) mode opens nothing; a click means "edit this block" | `lightbox.js:295` |
| T4 | A click on an `<a>` inside the diagram opens nothing | `lightbox.js:298` |
| T5 | The node copied is `.nb-figure-viewport > svg`, else the first `svg` in the card | `lightbox.js:301-302` |
| T6 | No SVG → no overlay | `lightbox.js:303` |
| T7 | The copy-image button stops propagation, so it never opens the overlay | `copy-image.js:773-783` |
| T8 | The whole card is the hit target, including its 14/16 px padding and the gutter | `tests/browser/test_figure_sizing_browser.js:661-669` |
| T9 | Only the four container selectors trigger. Math, images and `html-live` do not | `content-blocks.md` §4.3, §6.3 |
| T10 | No keyboard path exists: the cards are Tab stops for hybrid editing, but no `Enter`/`Space` handler opens the overlay | `content-blocks.md` §6.9; E3 there proposes one |

### 2.2 Open sequence

`openLightbox(svg)` (`lightbox.js:112-126`):

1. `body.innerHTML = ""`, then the cleaned clone is appended (`:113-116`).
2. State resets: `zoomLevel = 1`, `zoomFit = true`, `panX = panY = 0` (`:117-120`).
3. `body.classList.add("svg-fit")` (`:121`).
4. `overlay.hidden = false` (`:122`).
5. `document.body.classList.add("mermaid-lightbox-active")` (`:124`).
6. `applyZoom()` writes the fit transform and the label (`:125`).

The first frame therefore shows the drawing fitted and the label **`Fit`**, not `100%`
(`lightbox.js:69-72`). Opening a second time always returns to fit; nothing is remembered
between opens.

### 2.3 Close paths

| Path | Condition | Source |
|---|---|---|
| Close button `×` | always | `lightbox.js:169-170` |
| `Escape` | any keydown while open; document-level listener | `lightbox.js:262-268` |
| Overlay backdrop | click whose target is the overlay element itself | `lightbox.js:183-185` |
| Body blank area | click whose target is the body element — the area around the drawing | `lightbox.js:183-185` |
| Click on the drawing | does **not** close | `tests/dom/test_dom.js:4271-4277` |
| A drag | does not close: a mouseup on a different element fires no backdrop click | `lightbox.js:177-182` |

There is no `✕` button drawn in the corner of the screen and no scrim button: the close affordance
is the pill's fifth control (and `Esc`).

### 2.4 Teardown

`closeLightbox()` (`lightbox.js:128-134`): hide the overlay, empty the body, clear the flag, remove
`mermaid-lightbox-active` from `body`. The clone is destroyed, not parked.

There is no exit transition, no delay, and no animation of any kind (§8.5). Close is instant.

### 2.5 What the shipped code does not do

These are behaviour gaps, recorded here and fixed only as the exceptions in §6.5:

- Focus is not moved into the overlay on open and is not returned on close. `grep focus` in
  `lightbox.js` returns nothing.
- The overlay has no `role`, no `aria-modal`, and no accessible name
  (`templates/index.html:1792`).
- `body.mermaid-lightbox-active` is added and removed (`lightbox.js:124`, `:133`) but **no rule
  in any stylesheet selects it** — the page behind is not scroll-locked.
- The page behind stays in the Tab order after the pill's last control, because the overlay is a
  normal body child and nothing is inert.

---

## 3. Controls

### 3.1 The five controls

| # | Glyph | `aria-label` | `title` (shipped copy) | Action |
|---|---|---|---|---|
| 1 | `−` U+2212 | `Zoom Out` | `Zoom Out (Ctrl+−)` | `zoomOut()` |
| 2 | — | — (a `<span>`) | — | displays `Fit` or the percentage |
| 3 | `+` | `Zoom In` | `Zoom In (Ctrl++)` | `zoomIn()` |
| 4 | `⊞` U+229E | `Fit to Page` | `Fit to Page` | `fitToPage()` |
| 5 | `×` U+00D7 | `Close` | `Close (Esc)` | `closeLightbox()` |

Copy is shipped verbatim in `templates/index.html:1795-1799` (and the three twins). The percentage
element starts as `100%` in the markup (`:1796`) but is overwritten to `Fit` on the first open
(`lightbox.js:71`). The visible glyph is never the accessible name; the `title` carries the chord
(`controls.md` §2.2).

The percentage is text, not a field and not a control. It is not focusable, so the pill is
**four** Tab stops, not five.

### 3.2 States

| State | Delta | Source |
|---|---|---|
| Rest | transparent face, `#fff` glyph, `1px rgba(255,255,255,.25)` | `style.css:3693-3707` |
| Hover | face `rgba(255,255,255,.15)`, border `rgba(255,255,255,.5)` | `style.css:3708-3711` |
| Pressed | face `rgba(255,255,255,.25)`, border keeps the hover value | `style.css:3712-3714` |
| Focus-visible | **not shipped**; exception E5 draws a 2 px white outline at 2 px offset | §6.5 |
| Disabled | **does not exist.** No limit state, no `disabled` attribute, no `aria-disabled` | `lightbox.js:136-159` |
| At a limit | the press is a silent no-op; the label does not change | `Math.min` / `Math.max` at `lightbox.js:143`, `:156` |
| Busy | none | — |

There is no disabled treatment at 25 % or 500 %. Adding one would be new chrome; the label
already states the limit. Leave it.

### 3.3 Zoom model

| Rule | Value | Source |
|---|---|---|
| Step | 0.25 | `lightbox.js:38` |
| Floor | 0.25 (25 %) | `lightbox.js:39` |
| Ceiling | 5 (500 %) | `lightbox.js:40` |
| Start | fit, with `zoomLevel` reset to 1 | `lightbox.js:117-121` |
| First press from fit | **either** button leaves fit at 100 %; neither steps to 125 % or 75 % | `lightbox.js:138-141`, `:150-154` |
| Label | `Fit` when fitted, else `Math.round(level * 100) + "%"` | `lightbox.js:69-72` |
| Fit button | `zoomFit = true`, `zoomLevel = 1`, transform cleared, pan reset | `lightbox.js:161-166`, `:85-91` |
| Non-fit render | inline `width`/`height` locked to the current fitted box, then `translate(panX,panY) scale(level)`, origin centre | `lightbox.js:93-104` |
| Ceiling/floor press | silently clamped | `lightbox.js:143`, `:156` |

The 100 % baseline is the artefact's **fitted** box, not its intrinsic size: the code locks
`offsetWidth`/`offsetHeight` at the moment fit is left (`lightbox.js:99-102`), so 100 % means "the
size it had at fit, scaled 1:1". At 200 % the drawing is twice that, drawn from its centre.

The label is the only feedback. Do not add a slider, an input, or a reset-to-100 % button.

### 3.4 Placement and competition with the artefact

The pill is pinned 16 px from the top-right of the viewport, above the body in the local stack
(`style.css:3681-3682`, `:3690`). It never hides, never fades, and never moves out of the way. On
a narrow viewport it covers part of the drawing; that is shipped, and the user pans or zooms out
instead.

---

## 4. Gestures

All four instances share one code path, so all four support exactly the same gestures. The
difference between renderers is only in the artefact's intrinsic size and colours (§4.2).

| Gesture | Effect | Notes | Source |
|---|---|---|---|
| Wheel over the overlay | one zoom step per event; `deltaY < 0` zooms in, otherwise out | magnitude ignored; `preventDefault`; `{ passive: false }`; bubbling from the body and the pill is included | `lightbox.js:187-192` |
| Wheel while fitted | leaves fit to 100 %, then the next event steps | — | `lightbox.js:138-141` |
| Trackpad pinch | the browser sends `wheel` with `ctrlKey`; the handler ignores the modifier and treats each event as one step | there is no `gesturestart` handler, so Safari's own gesture path is not intercepted | observation from `lightbox.js:187-192` |
| Left-drag on the drawing | pan; 1:1 with the pointer | 3 px of movement sets `moved`; cursor `grab` → `grabbing`; works at fit and zoomed | `lightbox.js:208-244` |
| Right-drag on the drawing | pan | the context menu is suppressed while dragging or zoomed; allowed at fit with no drag | `lightbox.js:211`, `:252-257` |
| Drag from the pill | ignored | the guard is `closest(".mermaid-lightbox-controls")` | `lightbox.js:213` |
| Drag from the blank body or backdrop | ignored; the click closes instead | — | `lightbox.js:216` |
| Double-click | **none** | no handler | — |
| Touch drag | **none** | no `touch*` or `pointer*` listeners and no `touch-action` rule | — |
| Touch pinch | **none** in the overlay; the page may zoom instead | `wheel` never fires on touch | — |
| `Ctrl`/`Cmd` + `=` or `+` | zoom in | document-level, while open | `lightbox.js:269-273` |
| `Ctrl`/`Cmd` + `-` | zoom out | same | `lightbox.js:273-276` |
| `Esc` | close | same | `lightbox.js:264-268` |

Two shipped consequences worth stating plainly:

1. **A pan must start on the drawing.** A drag that starts on the blank body is ignored and the
   release fires a backdrop click, which closes. This is why panning never closes by accident
   (`lightbox.js:177-182`).
2. **The pan offset is a screen-pixel translate**, not amplified by the scale
   (`lightbox.js:74-81`, `:231-236`). The drawing tracks the cursor exactly at every zoom level.

### 4.1 Renderer differences

| Renderer | Intrinsic size in the clone | What that means in the overlay |
|---|---|---|
| Mermaid | `width` attribute = natural px at the 14 px base (`blocks.js:569-571`); theme baked in (`mermaid.js:300-305`) | usually large, so fit visibly shrinks it; colours match the theme at render time |
| WaveDrom | explicit `width`/`height` from the library; light skin with its own white background inside the SVG (`style.css:3467-3474`) | a white timing plot on a dark scrim; the one light artefact in the dark theme |
| Graphviz | `pt` converted to CSS px, written to width/height (`content-blocks.md` §6.2) | often very wide; fit is the useful state |
| SVG | the author's explicit `width`/`height`, or viewBox dimensions at the prose size (`blocks.js:455-489`) | exact author size until fit clamps it |

The gestures and controls are identical for all four. Do not add a per-renderer control.

---

## 5. States

| State | What happens | Source |
|---|---|---|
| **Loading** | there is no overlay state. The async renderers show the highlighted **fence** until they succeed, and only a rendered `.nb-*-container` is a trigger, so the overlay cannot be opened while loading | `content-blocks.md` §6.4; `lightbox.js:296-303` |
| **Ready** | opens at fit, label `Fit`, body has `.svg-fit` | `lightbox.js:112-125` |
| **Error** | the renderer replaces the fence with a warn box, and the warn box is not a `.mermaid-container` / `.wavedrom-container` / `.viz-container` / `.svg-container`, so it is **not a trigger**. The overlay never displays an error | `content-blocks.md` §6.5; `lightbox.js:296` |
| **Missing SVG** | click opens nothing | `lightbox.js:303` |
| **Huge diagram** | fit clamps width and height to the body's content box (`max-width/max-height: 100%`); zoom out to 25 % is available; pan reaches the edges | `style.css:3743-3749` |
| **Tiny diagram** | fit never upscales (`max-*` only). At fit it renders at its intrinsic size and the label still says `Fit`; the first zoom press shows `100%`, which is the same size; further presses grow it | `style.css:3743-3749`; `lightbox.js:99-104` |
| **Zoomed past 100 %** | label shows the percentage; the drawing is visually scaled about its centre; the layout box does not change, so the code offers pan rather than reflow | `lightbox.js:93-104` |
| **At 500 %** | further zoom-in is a no-op; the label stays `500%` | `lightbox.js:143` |
| **At 25 %** | further zoom-out is a no-op; the label stays `25%` | `lightbox.js:156` |
| **Re-open** | always fit; nothing is remembered | `lightbox.js:117-121` |
| **Second type opened** | independent state; the first instance is untouched | `lightbox.js:59-63` |
| **Light theme** | the chrome is unchanged; the artefact is drawn for a light page and now sits on the 0.55 scrim, so a light-theme Mermaid diagram's dark ink measures ≈3.2:1 against the scrim composite — visible, below the 4.5 text floor for its labels. See A8 and P9 | §1.4; `style.css:3667` |
| **Phone (390)** | opens; see §7 | — |

There is no empty state, no spinner, no skeleton, no error line, and no "image unavailable"
message inside the overlay. That is the shipped contract; do not add one without a proposal.

---

## 6. Keyboard and ARIA

### 6.1 Shipped

| Thing | Shipped | Source |
|---|---|---|
| `Esc` | closes whenever the overlay is open; the listener is on `document` | `lightbox.js:262-268` |
| `Ctrl`/`Cmd` + `+`, `=` | zoom in | `lightbox.js:269-273` |
| `Ctrl`/`Cmd` + `-` | zoom out | `lightbox.js:273-276` |
| Bare `+` / `-` / `0` | nothing | no handler |
| Tab | four stops in DOM order: zoom out → zoom in → fit → close. The percentage is a `<span>` and is skipped | `templates/index.html:1795-1799` |
| Enter / Space | native button activation | — |
| Focus on open | **nothing moves** | — |
| Focus on close | **returns nowhere**; the focused control becomes hidden with the overlay, so focus falls to `<body>` | — |
| Tab containment | **none**; Tab from close leaves the pill into the page behind | — |
| Role / name | **none** on the overlay | `templates/index.html:1792` |
| Live region | **none** on the percentage | `templates/index.html:1796` |

The `title` strings are the only place the chords are stated, and they are correct
(`:1795`, `:1797`).

### 6.2 Target tab order

| # | Element | Notes |
|---|---|---|
| 1 | Zoom out | |
| 2 | Zoom in | |
| 3 | Fit to Page | |
| 4 | Close | |
| — | Tab / Shift+Tab wrap inside these four | exception E4 |

The artefact is not a Tab stop: it is a cloned `<svg>` with no `tabindex`. Do not add one; panning
is a pointer gesture and the zoom buttons are the keyboard path.

### 6.3 Dialog semantics

Each overlay is a modal dialog that contains one image and four controls. It needs
`role="dialog"`, `aria-modal="true"` and a name that says what it is. The names are
`Diagram: Mermaid`, `Diagram: WaveDrom`, `Diagram: Graphviz`, `Diagram: SVG` (exception E2). The
same wording as `content-blocks.md` §9.6 E2 (`<Type> diagram`) is deliberately not reused: the
dialog is not the card, and "Diagram:" reads as a window title.

### 6.4 The percentage

The percentage changes without moving focus. It is the only status in the overlay. Adding
`aria-live="polite"` announces each step to a screen reader (exception E3). Do not use `alert`.

### 6.5 Exceptions — additions only, no pixels at rest

Each of these is a missing accessibility or consistency feature, not a redesign.

| # | Addition | Why | Visual delta |
|---|---|---|---|
| **E1** | `body.mermaid-lightbox-active #viewer-scroll { overflow: hidden; }` | the class is added and removed today (`lightbox.js:124`, `:133`) but declares nothing. `body` is not the scroller; `#viewer-scroll` is (`style.css:2380`), so the note behind still scrolls by keyboard or script | none visible: the reader scrollbar is behind the scrim |
| **E2** | `role="dialog" aria-modal="true" aria-label="Diagram: {type}"` on each of the four overlays | the overlay is a modal layer with no role and no name | none |
| **E3** | `aria-live="polite"` on `.mlb-zoom-pct` | the zoom result is otherwise silent to assistive tech | none |
| **E4** | Pass the opening card into `openLightbox`; on open focus the close button, wrap Tab inside the four controls, make the other body children `inert`; on close clear `inert` and return focus to the card with `preventScroll: true` | the overlay is modal in fact and not in the tree; `Esc` works but focus does not enter or leave sanely. The current `openLightbox(svg)` has no trigger, and a plain `.focus()` scrolls the reader | focus ring only; no scroll change |
| **E5** | `.mlb-btn:focus-visible { outline: var(--stroke-2) solid var(--overlay-control-fg); outline-offset: var(--focus-offset); }` | no `.mlb-btn` focus rule exists anywhere, so a keyboard user cannot see which control is focused | a 2 px white ring at 2 px offset |
| **E6** | Pill `.45` → `.55`, border `.25` → `.28`, percentage `.75` white → full white | The percentage measured 2.60:1 over a white diagram; 4.74:1 after | Visible: darker pill, brighter number |

**The ring colour is white, not black.** The pill face is `rgba(0,0,0,.45)` over the artefact.
Over a white diagram that composites to **#8c8c8c**, and white on it measures **3.36:1** — clears
the 3:1 UI floor; over a mid-grey it measures ≈9.9:1; over a black diagram 21:1. `controls.md`
§1.2 proposes a black ring, which disappears on a dark diagram. The white ring has no such hole
(conflict C3).

The ring sits in the pill's 4 px gap (`style.css:3685`), so it fills the gap and just meets the
neighbour. That is acceptable at this density; do not add a second outline or a background fill
for focus.

E4 reuses `NB.dialog`'s containment helper if it can be applied to a non-modal-framed element;
otherwise it wraps its own Tab loop. It must not add an entrance animation (`foundations.md`
§7.4).

---

## 7. Phone

**The lightbox opens at 390 px.** There is no viewport gate, no pointer check, and no phone rule
for `.mermaid-lightbox-*`: the overlay rules end at `style.css:3759`, and the mode switch starts
at `:6975`. The delegated handler (`lightbox.js:288-305`) runs on a tap exactly as on a click, and
the reader root is the same `#viewer-content`. `mobile.js` has no lightbox code at all
(`grep lightbox static/js/mobile.js` returns nothing).

What a 390 px user gets:

| Thing | At 390 | Source |
|---|---|---|
| Open | tap the card; overlay covers the screen | `lightbox.js:288-305` |
| Scrim and blur | the same `.55` and 8 px as desktop | `style.css:3667-3669` |
| Body padding | still `60px 40px`, so the drawing gets 310 × (height − 120) | `style.css:3736` |
| Controls | the same pill, 16 px from the top-right, **≈27 px tall, 28 px wide** | `style.css:3693-3707` |
| Zoom / fit / close | tap works on all four | `lightbox.js:169-176` |
| Pan | **does not work**: no touch or pointer handlers | §4 |
| Pinch | **does not work** in the overlay | §4 |
| Close outside | a tap on the blank body or backdrop closes | `lightbox.js:183-185` |
| Safe area | **no inset**: the pill is 16 px from the visual-viewport edge, so a full-screen install can put it under a notch | `style.css:3681-3683` |
| Keyboard | none on a phone | — |

So the phone keeps the desktop overlay unchanged: it fits the screen, the controls work, but the
targets are below the 44 px coarse floor (`foundations.md` §10.4) and a zoomed diagram cannot be
panned. There is **no fallback** — no sheet, no inline expand, no second view.

The overlay opens on a phone, with no gate and no phone CSS. The fix is either a phone rule
(P2/P3) or a documented refusal; the phone board in the mockup shows what ships today.

---

## 8. Tokens and CSS target

### 8.1 What is reused

Only these foundation tokens apply, and each is used for exactly its documented role:

| Foundation token | Used for | Value | Source |
|---|---|---|---|
| `--z-modal` | the overlay's band | 2000 | `style.css:3666`; `foundations.md` §6.2 |
| `--space-1` | pill gap | 4 | `style.css:3685` |
| `--space-2` | pill padding-inline | 8 | `style.css:3687` |
| `--space-4` | pill inset top/right | 16 | `style.css:3682-3683` |
| `--space-hair` | close button `margin-left` | 2 | `style.css:3716` |
| `--radius-md` | pill radius | 8 | `style.css:3689` |
| `--stroke-1` | button border | 1 | `style.css:3696` |
| `--stroke-2` | focus ring width | 2 | E5 |
| `--focus-offset` | focus ring offset | 2 | E5 |

No theme colour token is used. The overlay chrome does not have a light and a dark value; it is
the same in both. That is the single most important rule in this section: **do not tokenise the
scrim, the pill or the controls into `--surface-*` / `--text-*`.**

### 8.2 Component tokens

Every remaining number is off the foundation ladder. Each holds a literal; none aliases another
token, and none is declared per theme.

| Token | Value | Shipped source |
|---|---|---|
| `--lightbox-scrim` | `rgba(0, 0, 0, .55)` | `style.css:3667` |
| `--lightbox-blur` | `8px` | `style.css:3668-3669` |
| `--lightbox-pad-block` | `60px` | `style.css:3736` |
| `--lightbox-pad-inline` | `40px` | `style.css:3736` |
| `--lightbox-controls-z` | `10` | `style.css:3690` |
| `--overlay-pill-pad-block` | `6px` | `style.css:3687` |
| `--overlay-control-pill` | `rgba(0, 0, 0, .55)` | `style.css:3688`; E6 raises .45 → .55 |
| `--overlay-control-fg` | `#ffffff` | `style.css:3695` |
| `--overlay-control-border` | `rgba(255, 255, 255, .28)` | `style.css:3696`; E6 raises .25 → .28 |
| `--overlay-control-radius` | `5px` | `style.css:3697` |
| `--overlay-control-pad-block` | `3px` | `style.css:3698` |
| `--overlay-control-pad-inline` | `9px` | `style.css:3698` |
| `--overlay-control-size` | `1.05rem` | `style.css:3699` |
| `--overlay-control-line` | `1.3` | `style.css:3700` |
| `--overlay-control-min` | `28px` | `style.css:3706` |
| `--overlay-control-face` | `rgba(255, 255, 255, .15)` | `style.css:3709` |
| `--overlay-control-border-hover` | `rgba(255, 255, 255, .5)` | `style.css:3710` |
| `--overlay-control-face-active` | `rgba(255, 255, 255, .25)` | `style.css:3713` |
| `--overlay-control-close-size` | `1.2rem` | `style.css:3717` |
| `--overlay-control-close-pad-inline` | `7px` | `style.css:3718` |
| `--overlay-control-pct-fg` | `#ffffff` | `style.css:3721`; E6 raises .75 → 1 |
| `--overlay-control-pct-size` | `.82rem` | `style.css:3722` |
| `--overlay-control-pct-min` | `3.2em` | `style.css:3723` |
| `--overlay-control-pct-tracking` | `.3px` | `style.css:3726` |

`--lightbox-scrim` is deliberately **not** `--overlay-scrim` (`rgba(0,0,0,.5)`): the lightbox is
0.05 darker, and adopting the foundation value would change the look. The two names describe two
surfaces.

The focus ring has no token: E5 writes `var(--stroke-2) solid var(--overlay-control-fg)`, which
is already the whole value.

The block is scoped to the overlay, not `:root`, because controls §1.2 declares the same
`--overlay-control-*` names on `body[data-theme]`; a root declaration would lose to them. P1
takes the `.55`/`.28` decision.

```css
.mermaid-lightbox-overlay {
  --lightbox-scrim: rgba(0, 0, 0, .55);
  --lightbox-blur: 8px;
  --lightbox-pad-block: 60px;
  --lightbox-pad-inline: 40px;
  --lightbox-controls-z: 10;
  --overlay-pill-pad-block: 6px;
  --overlay-control-pill: rgba(0, 0, 0, .55);
  --overlay-control-fg: #ffffff;
  --overlay-control-border: rgba(255, 255, 255, .28);
  --overlay-control-radius: 5px;
  --overlay-control-pad-block: 3px;
  --overlay-control-pad-inline: 9px;
  --overlay-control-size: 1.05rem;
  --overlay-control-line: 1.3;
  --overlay-control-min: 28px;
  --overlay-control-face: rgba(255, 255, 255, .15);
  --overlay-control-border-hover: rgba(255, 255, 255, .5);
  --overlay-control-face-active: rgba(255, 255, 255, .25);
  --overlay-control-close-size: 1.2rem;
  --overlay-control-close-pad-inline: 7px;
  --overlay-control-pct-fg: #ffffff;
  --overlay-control-pct-size: .82rem;
  --overlay-control-pct-min: 3.2em;
  --overlay-control-pct-tracking: .3px;
}
```

### 8.3 Target rules, in order

Replace `style.css:3660-3759` in place. Order matters only inside this component; the exception
rules go last.

```css
/* ---------- lightbox frame ---------- */
.mermaid-lightbox-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: var(--lightbox-scrim);
  backdrop-filter: blur(var(--lightbox-blur));
  -webkit-backdrop-filter: blur(var(--lightbox-blur));
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 0;
}
.mermaid-lightbox-overlay[hidden] { display: none; }

/* ---------- controls pill ---------- */
.mermaid-lightbox-controls {
  position: absolute;
  top: var(--space-4);
  right: var(--space-4);
  display: flex;
  gap: var(--space-1);
  align-items: center;
  padding: var(--overlay-pill-pad-block) var(--space-2);
  background: var(--overlay-control-pill);
  border-radius: var(--radius-md);
  z-index: var(--lightbox-controls-z);
  user-select: none;
}
.mlb-btn {
  background: transparent;
  color: var(--overlay-control-fg);
  border: var(--stroke-1) solid var(--overlay-control-border);
  border-radius: var(--overlay-control-radius);
  padding: var(--overlay-control-pad-block) var(--overlay-control-pad-inline);
  font-size: var(--overlay-control-size);
  line-height: var(--overlay-control-line);
  cursor: pointer;
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--overlay-control-min);
}
.mlb-btn:hover {
  background: var(--overlay-control-face);
  border-color: var(--overlay-control-border-hover);
}
.mlb-btn:active { background: var(--overlay-control-face-active); }
.mlb-close-btn {
  margin-left: var(--space-hair);
  font-size: var(--overlay-control-close-size);
  padding: var(--overlay-control-pad-block) var(--overlay-control-close-pad-inline);
}
.mlb-zoom-pct {
  color: var(--overlay-control-pct-fg);
  font-size: var(--overlay-control-pct-size);
  min-width: var(--overlay-control-pct-min);
  text-align: center;
  font-variant-numeric: tabular-nums;
  letter-spacing: var(--overlay-control-pct-tracking);
}

/* ---------- artefact ---------- */
.mermaid-lightbox-body {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  width: 100%;
  height: 100%;
  padding: var(--lightbox-pad-block) var(--lightbox-pad-inline);
}
.mermaid-lightbox-body.svg-fit svg {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  display: block;
}
.mermaid-lightbox-body svg {
  display: block;
  transform-origin: center center;
  cursor: grab;
}
.mermaid-lightbox-body svg.dragging { cursor: grabbing; }

/* ---------- E1, E5: exceptions, no pixels at rest ---------- */
.mlb-btn:focus-visible {
  outline: var(--stroke-2) solid var(--overlay-control-fg);
  outline-offset: var(--focus-offset);
}
body.mermaid-lightbox-active #viewer-scroll { overflow: hidden; }
```

The two comments in the shipped rule (`style.css:3737-3738`, `:3750-3751`) explain why the body's
overflow is `auto` and why the cursor is always `grab`; keep the reasoning, drop nothing that the
code depends on. The wheel handler is `passive: false` on the overlay, not on the body, so the
body's `overflow: auto` does not swallow wheel events (`lightbox.js:187-192`).

### 8.4 Placement

| Block | Goes | Why |
|---|---|---|
| Component tokens | the primitives `:root` after `style.css:131` | theme-independent numbers; `foundations.md` §11.1 |
| Rule replacements | in place at `style.css:3660-3759` | keeps the diff reviewable and the surrounding order intact |
| E1, E5 | appended immediately after the artefact rules | exceptions live with the component |
| E2–E4 | `templates/index.html` (E2, E3) and `static/js/lightbox.js` (E4; add the trigger argument and the inert teardown) | not CSS |

Do not move these rules inside the phone query. There are no phone overrides, and adding one is
P2.

### 8.5 Motion

There is **no** transition or animation in this component: no fade on the scrim, no slide on the
pill, no transform animation on zoom. The only animated-looking thing is `backdrop-filter`, which
is a filter, not motion. Therefore no `prefers-reduced-motion` twin is needed, and none may be
invented. Adding an entrance fade would need a proposal.

### 8.6 Theme

The overlay is theme-invariant (§1.4). The light section of the mockup repeats the same pill,
the same scrim and the same white text on a light page to make that visible.

---

## 9. Acceptance criteria

Each names a file and an observable result. `style.css` is `static/css/style.css`.

| # | Criterion | Where | Observable |
|---|---|---|---|
| **AC1** | Four overlays, four ids, one class set | `templates/index.html:1792-1848` | `#mermaid-lightbox`, `#wavedrom-lightbox`, `#viz-lightbox`, `#svg-lightbox` exist; each has one `.mermaid-lightbox-body`, four `.mlb-btn` buttons and one `.mlb-zoom-pct` |
| **AC2** | The overlay is one fixed full-screen layer at `--z-modal` | `style.css` | `position: fixed; inset: 0`; computed `z-index: 2000`; background `rgba(0,0,0,.55)`; `backdrop-filter: blur(8px)` |
| **AC3** | The body centres one artefact with 60/40 padding and scrolls | `style.css` | `padding: 60px 40px`; `overflow: auto`; a single `<svg>` child after open |
| **AC4** | Every open starts fitted and reset | `static/js/lightbox.js:112-126` | After a click, `body.classList.contains("svg-fit")`, label text `Fit`, inline transform `none` |
| **AC5** | The zoom model is 25 %–500 % in 25 % steps, and the first press from fit is 100 % | `lightbox.js:38-40`, `:136-159` | `Fit` → press either button → `100%` → `+` → `125%`; label never exceeds `500%`; never goes below `25%` |
| **AC6** | Limits clamp silently with no disabled state | `lightbox.js:143`, `:156` | From fit, seventeen `+` presses end at `500%`; from 100 %, ten do. The button stays enabled with no `aria-disabled` |
| **AC7** | Fit restores the fitted state and clears the transform | `lightbox.js:161-166` | `svg-fit` present, inline `width`/`height` empty, label `Fit` |
| **AC8** | Close works from the button, `Esc`, and the backdrop | `lightbox.js:169-170`, `:183-185`, `:262-268` | Each path hides the overlay and empties the body; a click on the drawing does not close |
| **AC9** | Pan works from the drawing only, at any zoom | `lightbox.js:208-244` | `transform: translate(40px, 30px) scale(1)` after a 40/30 drag; a drag from the body closes instead of panning |
| **AC10** | Wheel zooms one step per event and never scrolls the page behind | `lightbox.js:187-192` | `deltaY: -120` → `125%`; `deltaY: +120` → back; the page's scroll position is unchanged |
| **AC11** | `Ctrl`/`Cmd` `+`/`=`/`-` and `Esc` work; no bare key does | `lightbox.js:262-278` | From `100%`, `Ctrl+=` → `125%`; `Ctrl+-` → `100%`; a bare `0` changes nothing |
| **AC12** | The trigger contract holds | `lightbox.js:288-305` | A click on the card padding opens the right overlay; a click in hybrid mode does not; a click on an `<a>` does not; a click on the copy-image button does not |
| **AC13** | Loading and error cards are not triggers | `lightbox.js:296-303`; `content-blocks.md` §6.4-6.5 | Clicking a fence or a warn box leaves the overlay hidden |
| **AC14** | No literal remains in the lightbox rules | `style.css` | The rules in §8.3 read only `var(--space-*)`, `var(--radius-md)`, `var(--stroke-*)`, `var(--z-modal)`, `var(--focus-offset)` and the §8.2 tokens; no hex, px, rem or alpha remains in a selector rule |
| **AC15** | The phone opens the overlay and keeps the shipped chrome | `static/js/lightbox.js`, `style.css` | At 390, tapping a card shows the overlay; the pill is 16 px from the edge; there is no phone override in the stylesheet |
| **AC16** | The five exceptions ship without changing a pixel at rest | `templates/index.html`, `lightbox.js`, `style.css` | E1–E3 add attributes and one rule that paints nothing; E4 changes focus only; E5 paints on `:focus-visible` only. E1 hides the reader scroll container behind the scrim |
| **AC17** | Nothing animates | `style.css` | No `transition` or `animation` property inside `.mermaid-lightbox-*` / `.mlb-*` |
| **AC18** | The mockup is self-contained | `docs/ui/lightboxes-mockup.html` | Opening it offline shows both themes and every board with zero network requests |

Existing tests that already cover part of this set:

- `tests/dom/test_dom.js:4099-4292` — open, clone, fit, zoom, label, `Ctrl±`, wheel, close button,
  `Esc`, backdrop, body-blank click, drawing click.
- `tests/dom/test_dom.js:4304-4340` — drag-to-pan, left and right button, transform values.
- `tests/dom/test_dom.js:4293-4302` — the three CSS-source assertions on the class rules.
- `tests/browser/test_figure_sizing_browser.js:625-672` — the zoom-in cursor and "clicking the card
  padding opens its lightbox" for all four types.
- `tests/browser/test_figure_sizing_browser.js:750-815` — open in fit mode from a tall diagram,
  close via `Esc`, and the wrapper gutter as a target.
- `tests/browser/test_ai_blocks_browser.js:500-555` — open from the AI chat log, `Esc`, and no
  overlay for prose or a click outside a reading root.

No test opens the overlay on a phone today; §7 is verified by reading the code, not by a test
(see §12).

---

## 10. Proposals, not applied

None of these is in the mockup. Each changes a pixel or a behaviour and needs its own decision.

| # | Proposal | Why | Cost |
|---|---|---|---|
| **P1** | *(applied as E6)* pill `.55`, percentage full `#fff`, border `.28` | The percentage at `.75` on `.45` measured **2.60:1**, below the 4.5 floor; at `.55`/full white it is **4.74:1** | Visible: darker pill, brighter number |
| **P2** | Phone: 44 px controls, 20 px pill inset, body padding `32px 16px` under the mode switch | The shipped 28 × 27 px targets miss the 44 px coarse floor, and 60/40 padding wastes 80 px of a 390 px width | Visible on phone only |
| **P3** | Add pointer-event pan and two-finger pinch to the overlay | Touch has no pan and no pinch today, so a zoomed diagram cannot be explored on a phone | New gesture code; no desktop change |
| **P4** | Add the bare `+`, `-` and `0` (fit) shortcuts | `controls.md` §2.13 states them; the code requires `Ctrl`/`Cmd` and has no fit key | New key handling; risks colliding with reader shortcuts |
| **P5** | Replace the four markup copies with one `<template>` | One source of truth for four buttons, one percentage and four id sets; `controls.md` §3.3 step 10 | No visual change; touches four callers and the DOM fixture |
| **P6** | Double-click toggles 100 % ↔ fit | A common pan/zoom idiom; currently unbound | New gesture; no visual change |
| **P7** | Show the diagram type or the note name in the overlay | The overlay has no title at all; a screen reader gets only the label | New chrome; conflicts with "the artefact is the page" |
| **P8** | Guard the `Esc` listener by top layer | The listener is global and unconditional (`lightbox.js:262`), so `Esc` closes the overlay even when a higher layer (the 2100 workspace dialog) has focus | Behaviour change; no visual change |
| **P9** | Paint a plate behind the artefact (the note card's `--surface-panel`, or clone the card rather than the SVG) | In the light theme the library draws for a white page, and the 0.55 scrim turns the backdrop grey: dark ink measures ≈3.2:1. A plate restores the surface the drawing was made for | Visible: the overlay gains a framed plate, which conflicts with the current borderless look |

---

## 11. What not to build

- **No redesign of the pill.** No glass panel, no blur on the pill itself, no rounded floating
  card behind the artefact, no drop shadow. The scrim's blur is a backdrop, not a surface.
- **No new z-band.** The overlay is `--z-modal`; the pill's `10` is a local stack value.
- **No new breakpoint.** A phone rule, if ever added, goes inside the existing mode switch
  (`foundations.md` §8.2 rule 1).
- **No auto-hiding controls**, no hover-to-reveal, no idle fade.
- **No extra actions** in the pill: no rotate, download, print, share, fullscreen API, or
  reset-to-100 %. Four buttons and one percentage, one row.
- **No source panel, caption, alt text editor, or code view** inside the overlay. The artefact is
  the image; the source lives in the note.
- **No entrance or exit animation.** No fade, no scale-in, no slide.
- **No theme-scoped overlay chrome.** Do not make the scrim or the pill follow `data-theme`.
- **No per-renderer control.** One code path, four artefacts.
- **No custom tooltip.** `title` plus `aria-label` is the contract (`controls.md` §2.10).
- **No fifth copy of the markup.** Extend the existing four only as P5 allows.
- **No changing the diagram cards, the edit windows, Settings, or the shell.** Those are other
  documents.
- **No `disabled` treatment at the zoom limits.** The label is the feedback.

---

## 12. Conflicts and known shipped failures

### 12.1 Conflicts with `controls.md`

None live. `controls.md` §2.13 now defers the control anatomy, sizes, ring and keyboard to this
document, and §5 records that the phone overlay opens. The only open items are the proposals
below (phone targets, pan/pinch, bare keys, one template, focus, title, top-layer Esc, plate).

### 12.2 Known shipped failures

| # | Failure | Measurement | Where |
|---|---|---|---|
| **A1** | The percentage text is unreadable on the pill over a light diagram | 2.60:1 (needs 4.5:1) | `style.css:3688`, `:3721` |
| **A2** | The button glyphs are white on a pill over a light diagram | 3.36:1 — clears the 3:1 icon floor, misses 4.5:1 if read as text | `style.css:3695` |
| **A3** | No focus indicator on any of the four controls | — | no `.mlb-btn:focus-visible` rule |
| **A4** | No dialog role, name or live region | — | `templates/index.html:1792-1800` |
| **A5** | The scroll-lock class is dead | — | `lightbox.js:124`; no matching rule |
| **A6** | Phone targets are ≈28 × 27 px | below the 44 px coarse floor | `style.css:3693-3707` |
| **A7** | No touch pan and no pinch | — | `lightbox.js:208-259` |
| **A8** | In the light theme the artefact is drawn for a white page and floats on the dark scrim | light-theme dark ink on the scrim composite `#737373` ≈ 3.2:1 (needs 4.5 for labels) | `style.css:3667`; library output |

A1 and A2 are fixed by P1; A3–A5 by E5, E2/E3 and E1; A6 and A7 by P2 and P3; A8 by P9. Until
then the failures are shipped and recorded, not hidden.

Every claim about code in this document was read from the working tree on 9 November 2026; the
line numbers above are that tree's.
