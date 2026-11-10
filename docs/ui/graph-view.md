# Graph view — the `§graph` tab

Status: Current spec — pre-implementation (codifies the shipped graph).

Reference mockup: [`graph-view-mockup.html`](graph-view-mockup.html) — 3D loading and ready,
2D ready, empty, error, the large-graph notice, and 720, in dark and light.

**Normative source.** This document owns the graph view's chrome: header, controls, canvas
host, hint, chip, toast and state card. The renderers — force layout, orbit camera, tiers —
are described in [`../architecture/frontend.md`](../architecture/frontend.md) §Graph view;
this document does not change them. Every claim cites `file:line`.

**The shipped look is the target.** The header, canvases and overlays are codified as they
ship. Applied exceptions are listed in §8.4; anything else visual is a proposal in §10.

---

## 1. Entry

| Thing | Rule | Source |
|---|---|---|
| Activity button | `#activity-graph-btn`, a rail action, not a view | `index.html:210` |
| Tab | a special tab, id `§graph`; one instance | `tabs.js` `registerSpecial` |
| Open | clicking the rail button opens or focuses the `§graph` tab | `graph.js` |
| Mode | `graphMode` `"2d"` or `"3d"`, default `"3d"`, persisted | `app.js` `setGraphMode` |
| Reopen | a saved `§graph` in `openFiles` reopens in the last mode | `graph.js` |
| Phone | not reachable; the rail button is hidden | `style.css:7198-7206` |

The view replaces the reader inside `#editor-pane`; the tab bar, edit bar state and side
panels stay. `#graph-view` is a sibling of `#viewer`, `#welcome` and `#mobile-home`.

---

## 2. Header

`.graph-view-header` is one wrapping row: identity left, tools right.

| Part | Value | Source |
|---|---|---|
| Height | `min-height: 47px`; wraps | `style.css:4437-4449` |
| Padding / gap | `8px 14px`; `10px 12px` | `:4443-4447` |
| Face | `--surface-panel` at 86 % + `backdrop-filter: blur(8px)` | `:4448-4451` |
| Bottom edge | 1 px `--border` at 70 %, plus a 1 px accent gradient at 55 % | `:4452-4462` |
| Stacking | local `z-index: 5` | `:4439` |

**Identity.**

| Part | Value | Source |
|---|---|---|
| Title | `Graph`, `.95rem`, 650, tracking `.01em`, `--text-primary` | `:4476-4483` |
| Pulse dot | 7 px, `--accent`, two glows, `graph-title-pulse` 2.4 s | `:4484-4497` |
| Badge | 16 px high, `--accent-soft` face, accent border/text, 9 px 700, tracking `.1em`; reads `2D` or `3D` | `:4499-4510` |
| Summary | `.78rem`, `--text-muted`, tabular numerals; empty until data | `:4504-4510` |

**Tools**, left to right, 6 px gap:

| # | Control | Shape | State |
|---|---|---|---|
| 1 | 2D/3D segmented | 30 px, radius 8, 1 px `--border`; each 34 px min, `.74rem`, 600 | `aria-pressed`; accent-soft active |
| 2 | Filter | 160 × 30, radius 8, left glyph 13, padding `0 8px 0 26px`, `.82rem` | search input; native cancel hidden |
| 3 | Depth | 30 high, radius 8, `0 8px`; range 58 × 14, output 30, 10 px | 3D only; 0–100 step 5 |
| — | Separator | 1 × 18, `--border` | hidden in 2D |
| 4 | Auto-orbit | 30 × 30, radius 8 | 3D only; `aria-pressed`; spins under reduced motion? no |
| 5 | Fit | 30 × 30 | both modes |
| 6 | Zoom in | 30 × 30 | both |
| 7 | Zoom out | 30 × 30 | both |
| 8 | Refresh | 30 × 30 | both; `.is-spinning` while loading |

Buttons: transparent face, `--text-muted`, hover `--accent-soft` + `--text-primary`, pressed
`translateY(1px)`, focus ring 2 px at 2 px. The mode and filter are pill/rounded controls;
the five icon buttons are square.

Narrow: at 980 the summary truncates at 118 px; at 820 the tools wrap; at 720 the depth
control hides; at 520 the header stacks identity over tools.

---

## 3. Canvas

| Part | Value | Source |
|---|---|---|
| Host | `#graph-view-canvas-host`, `tabindex="0"`, `role="application"`, label names the gestures | `:509-511` |
| Size | fills the view below the header | `:4678-4692` |
| Face | radial `--graph-bg` + 12 % accent at centre, `--graph-bg` at 62 % | `:4686-4690` |
| Focus | inset 2 px accent at 72 % | `:4692-4694` |
| Canvases | two absolutely positioned canvases; only the active one is visible | `:4695-4703` |
| Cursor | `grab`; `grabbing` while `.is-grabbing` | `:4699-4707` |

The 3D canvas draws the orbit view; the 2D canvas draws the force layout. Both are
`aria-hidden`; the SR note list carries the content.

**Hint.** Top centre, 14 px from the top, pill face, 11.5 px, z 12; desktop copy names orbit,
zoom, pan and double-click; touch copy names orbit, pinch, two-finger pan, double-tap. It
fades to `.is-hidden` after first use.

**Chip.** Bottom centre, 20 px from the bottom, z 16, pill, 8/13 padding, 12 px; dot, name,
meta and a close button. 3D only.

**Toast.** Bottom centre, z 18, pill, 12 px, appears on a copy/open failure.

**State card.** Centred, 24 px padding; a card at 26/28/24, radius 14, with art, title,
body and an optional action. It covers loading, empty and error.

---

## 4. Gestures

| Mode | Gesture | Action |
|---|---|---|
| 3D | left-drag empty space | orbit (yaw/pitch) |
| 3D | left-drag a node | pin it on a camera-facing plane |
| 3D | right/middle/Shift+left drag | pan |
| 3D | wheel / pinch | dolly, cursor-biased |
| 3D | double-click a note | open it |
| 2D | drag | pan |
| 2D | wheel / pinch | zoom |
| 2D | double-click a note | open it |

The depth slider scales the z spread, 0 % flat to 100 %; auto-orbit is off by default and
disabled under `prefers-reduced-motion`. Reduced motion also stops the title pulse and the
loading art, but keeps a spinner moving slowly.

---

## 5. States

| State | What shows | Trigger |
|---|---|---|
| Loading | state card with constellation art and `Mapping your notebook…` / `Reading links from your notes.` | first fetch |
| Empty | `No notes yet` card with a Refresh action | `nodes: []` |
| Ready | canvas, hint, summary `N notes · M links` | data |
| Error | `Couldn’t load the graph` + the server message + Refresh | fetch failure |
| Large | flat layout with a notice above 1500 nodes | tier |
| Filtered | summary `K of N notes`; nodes dim or hide | filter query |
| Selected | chip with the note name and link count | click or keyboard |
| 2D | depth, orbit, hint, chip and state card hidden | mode 2D |

Tiers: full ≤300 nodes, reduced 301–800, lite 801–1500, flat + notice >1500.

---

## 6. Keyboard and ARIA

| Element | Contract |
|---|---|
| Host | `role="application"`, `tabindex="0"`, label naming the gestures; the canvas itself is hidden from AT |
| Filter | a labelled search field; `Esc` clears it first |
| Mode | `role="group"` with two `aria-pressed` buttons; arrow keys move between them |
| Depth | range with `aria-valuetext` in percent |
| Buttons | `aria-label` + `title`; rotate is a toggle |
| Chip close | a named button; clears the selection |
| SR note list | `<ul class="sr-only" id="graph-view-sr-list">`, one item per note, link count |
| Live region | `#graph-view-sr-live`, `role="status"`, announces load/empty/error and selection |

Key map: `+`/`-` zoom, `0` fit, `R` auto-orbit, `Home` fit, arrows move the focus ring,
`Enter` opens the selected note. The filter takes typing; the host handles the rest only
when it has focus.

---

## 7. Responsive and phone

| Width | Change |
|---|---|
| 980 | Summary truncates at 118 px |
| 820 | Header gap tightens; tools wrap |
| 720 | Depth control hides; hint wraps and shrinks to 11 px; chip moves up 128 px; toast up 78 px |
| 520 | Header stacks; title `.9rem`; filter 32 high |
| Tablet coarse | Graph controls grow to 44 px at ≥1024 coarse |
| Phone | Not reachable; the rail button and the view are hidden |

---

## 8. Tokens and the CSS target

### 8.1 Reuse

The header and overlays already read the base tokens. The canvas reads only the
`--graph-*-rgb` triples and `--graph-bg`; those stay per theme and are exempt from the UI
palette (`foundations.md` §3.1).

### 8.2 Target rules

Replace in place, after the foundation token block. No new token is needed.

```css
.graph-view-header {
  position: relative; z-index: var(--z-inline);
  min-height: 47px; padding: var(--space-2) var(--space-3);
  gap: var(--space-2) var(--space-3);
  background: color-mix(in oklab, var(--surface-panel) 86%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: var(--stroke-1) solid color-mix(in oklab, var(--border) 70%, transparent);
}
.graph-view-title { font-size: .95rem; font-weight: var(--fw-heading); color: var(--text-primary); }
.graph-view-summary { font-size: .78rem; color: var(--text-muted); }
.graph-view-mode { height: var(--control-h-md); border-radius: var(--radius-md); border: var(--stroke-1) solid var(--border); }
.graph-view-mode button { min-width: 34px; font-size: .74rem; }
.graph-view-filter { height: var(--control-h-md); width: 160px; border-radius: var(--radius-md); font-size: .82rem; }
.graph-view-depth, .graph-view-btn { height: var(--control-h-md); border-radius: var(--radius-md); }
.graph-view-btn { width: var(--control-h-md); }
.graph-view-host:focus-visible { box-shadow: inset 0 0 0 var(--stroke-2) color-mix(in oklab, var(--accent) 72%, transparent); }
.graph-view-hint, .graph-view-chip, .graph-view-toast, .graph-view-state-card {
  border-radius: var(--radius-pill); border: var(--stroke-1) solid var(--border);
  background: var(--surface-raised); color: var(--text-muted);
}
```

### 8.3 Geometry

Header 47; controls 30; filter 160; depth range 58; separator 1 × 18; icon glyphs 15;
hint pill 11.5 px; chip 12 px; state card radius 14; host focus inset 2.

### 8.4 Exceptions

| # | Change | Why | Pixel delta |
|---|---|---|---|
| E1 | Canvas host keeps `role="application"` but the label is built from the active mode | 2D and 3D have different gestures | none |
| E2 | The mode group gets roving focus and arrow keys | APG group keyboard | none |
| E3 | The title pulse and loading art stop under reduced motion; the spinner slows to 1.6 s | Foundations §7.3 | none at rest |
| E4 | The filter's native cancel is hidden in favour of `Esc` | One clear path | none |

---

## 9. Acceptance criteria

| # | Criterion | File | Observable |
|---|---|---|---|
| AC1 | The graph opens as one `§graph` tab from the rail button | `graph.js`, `tabs.js` | One tab, one view; clicking again focuses it; the mode persists across reload |
| AC2 | The header shows the title, badge, summary and eight controls in order | `index.html` | DOM order: mode, filter, depth, sep, rotate, fit, zoom in, zoom out, refresh |
| AC3 | 2D hides depth, orbit, separator, hint, chip and state card | `style.css` | In 2D those compute `display: none`; the canvases swap |
| AC4 | The host is keyboard-operable and named | `index.html`, `graph.js` | `role="application"`, `tabindex="0"`; the label names the active mode's gestures; the keys in §6 work |
| AC5 | The canvas colours come only from the `--graph-*` tokens | `style.css`, `graph-*.js` | No literal in the canvas host or the renderers; both themes swap |
| AC6 | Loading, empty, error and large states each render one card with the shipped copy | `graph.js` | `Mapping your notebook…`, `No notes yet`, `Couldn’t load the graph`, the 1500 notice |
| AC7 | The chip names the selected note and clears on close | `graph.js` | Chip visible in 3D, hidden in 2D; close clears `selectedId` |
| AC8 | The hints split desktop and touch | `index.html`, `style.css` | `.hint-desktop` vs `.hint-touch`; the touch copy shows under a coarse pointer |
| AC9 | The view is absent on a phone | `style.css` | At 390 `#activity-graph-btn` and `#graph-view` are hidden |
| AC10 | Reduced motion stops the pulse and orbit | `style.css`, `graph-3d.js` | No pulse; auto-orbit disabled; the spinner slows |
| AC11 | The mockup is self-contained | `graph-view-mockup.html` | Opens offline, both themes, zero network requests |

---

## 10. Proposals, not applied

| # | Proposal | Why | Cost |
|---|---|---|---|
| P1 | Make the state card's action a primary button | Refresh is the only action in an error | Visible |
| P2 | Show the filter's match count in the summary while typing | The summary already has the slot | Copy change |
| P3 | Add a keyboard shortcut list to the hint | The host handles many keys | More chrome |
| P4 | Pause the pulse when the tab is hidden | Wasted frames | None visible |
| P5 | A 44 px coarse-pointer rule for the header controls | The 1024+ coarse rule only covers some | Touch-only |

---

## 11. What not to build

- A second graph tab, a second canvas, or a new renderer.
- A minimap, a legend, a node inspector, or a search-inside-graph panel.
- A new z-band or breakpoint.
- A phone graph. The rail entry is deliberately absent.
- A different palette for the canvas; the `--graph-*` triples are the contract.
