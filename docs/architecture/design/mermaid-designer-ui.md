# Mermaid visual designer — UI design + handoff

**Status:** design ready for implementation (P1)
**Owner:** `ui-designer` (this doc + the mockup)
**Implementer:** `web-engineer` (edits `static/`; this doc does not)
**Reference mockup:** [`mermaid-designer-mockup.html`](mermaid-designer-mockup.html)
**Source plan (wins on conflicts):** [`docs/architecture/mermaid-designer.md`](../mermaid-designer.md)
**Desired UX:** [`docs/requirements/features/mermaid-visual-editor.md`](../../requirements/features/mermaid-visual-editor.md)

This document specifies the **look, layout, states, and interaction** of the
visual Mermaid editor. The locked architecture doc fixes the behavior (Visimer,
hybrid right-click entry, modal with Apply/Cancel, DOM write-back); where the
requirements doc describes more (Source pane, Insert flow, structured families),
this design follows the architecture doc and treats the rest as later phases.

The editor is a **modal in the existing `.settings-overlay` / `.settings-modal`
family**. It adds one class family, `.designer-*`, and reuses every existing
token. No new framework, no new build step, no restyling of the library beyond
a handful of CSS custom properties.

---

## 1. Design principles

1. **Same shell, larger box.** The designer reuses the Settings/Export modal
   chrome (`static/css/style.css:1303-1411`) so it feels native. Only the size,
   the body layout, and the new `.designer-*` pieces are specific.
2. **The canvas is the hero.** The diagram surface gets almost the whole modal;
   chrome floats over it rather than consuming layout rows.
3. **No guessed state.** Loading, empty, error, and preview-only are explicit,
   centered messages — never a blank box.
4. **Tokens only.** Every color and size comes from an existing token or a new
   named one; no one-off hex values (guardrail).
5. **Theme and font-scale come for free.** The canvas reads `body[data-theme]`
   and the chrome is rem-based, so S/M/L/XL text scaling
   (`static/css/style.css:36`, `:92-97`) applies with no extra work.

---

## 2. Trigger — the hybrid right-click item

### 2.1 Where it lives

The hybrid (WYSIWYG) context menu builds its code/plugin section at
`static/js/hybrid.js:5176-5183`. Today that section emits one item per code
block: **Edit `<name>` source**. The designer adds a second item **above** it.

```
─── separator (addMenuSep, hybrid.js:5177) ───
Design diagram…            ← new, first
Edit mermaid source        ← existing
```

**Label:** `Design diagram…` — the ellipsis is correct because it opens a
dialog (the existing `Edit … source` opens an inline mode, so no ellipsis).

**Ordering — visual first, source second.** The visual editor is the friendly
default for the common case (G1/G2); the source editor stays as the escape
hatch and the only path for opaque syntax. Both sit under the existing
separator, before the `Insert` submenu.

### 2.2 Visibility / enabled matrix

The item is created in `hybrid.js` only when the clicked block's plugin
descriptor carries `design` **and** `NB[plugin.design]` exists (architecture:
`mermaid-designer.md:92-94`). Beyond that:

| Situation | State | Mechanism | Why |
| --- | --- | --- | --- |
| Admin role, editable type (library reports `capability: "edit"`) | **shown** | normal `<button>` | the happy path |
| Viewer role | **hidden** | do not append the item | writes are admin-only; the architecture hides both the menu item and Apply (`mermaid-designer.md:83-84`) |
| Render-only type (library reports `capability: "render"`, e.g. `zenuml`) | **disabled** | add `disabled` + `title="No visual editor for this diagram type — use Edit source"` | the library marks 22 of 23 types editable; the one exception must not pretend to open. `.context-menu button:disabled` already dims and drops the hover cue (`static/css/style.css:1246-1247`) |
| Plugin has no `design` flag (non-mermaid blocks) | **absent** | not appended | the section only shows existing items |
| Editor bundle not yet downloaded / offline | **shown** | normal button | the failure is not knowable at menu time; it surfaces in the modal's error state (§5.4) |

**Reading the role.** `NB.auth` currently exposes `showModal/hideModal/isLocked/
logout` but **not** the role (`static/js/auth.js:157-162`). The designer needs
the role at menu-build time. Add a `role` getter to `NB.auth` (populated from
the `/api/auth` response already fetched on boot, `static/js/auth.js:144-152`)
or cache the `/api/auth` result in `NB.mermaidDesign`. This is a behavior
prerequisite, not a visual one; the architecture already says "reads `role`
from `NB.auth`/`/api/auth`" (`mermaid-designer.md:83`).

### 2.3 Keyboard reachability of the trigger

The menu already supports keyboard navigation once it is open: focus lands on
the first enabled item (`hybrid.js:5250-5251`), ArrowUp/Down move between
enabled items, Enter/Space activate, Escape closes (`hybrid.js:5268-5295`).
The gap is **opening it without a mouse**. The block is right-click-only today.

Required:

- The rendered mermaid block (`.mermaid-container`) is focusable
  (`tabindex="0"`).
- While that block has focus, `ContextMenu` or `Shift+F10` opens the hybrid
  menu anchored to the block. Reuse the existing open path
  (`hybrid.js:5254-5257`) with a synthetic anchor.
- The `Design diagram…` item therefore becomes reachable on a keyboard-only
  path: Tab to the diagram → Shift+F10 → Down to `Design diagram…` → Enter.

Announcement: the item reads as a normal menu item and is announced by the
screen reader from the focused menu; no `aria-*` beyond the existing menu
semantics is needed. The disabled render-only item exposes its reason through
`title` (and should also set `aria-disabled="true"` so the reason is not
click-only).

---

## 3. Modal shell

### 3.1 Markup (added to `templates/index.html`)

Follows the Export modal shape (`templates/index.html:821-896`) and the
Settings modal shape (`templates/index.html:346-364`) exactly.

```html
<!-- Mermaid visual designer. Opened from the hybrid right-click menu. -->
<div id="designer-overlay" class="settings-overlay" hidden>
  <div class="settings-modal designer-modal" role="dialog" aria-modal="true"
       aria-labelledby="designer-title" aria-describedby="designer-hint">
    <div class="settings-header designer-header">
      <div class="designer-heading">
        <h2 id="designer-title">Design diagram</h2>
        <span class="designer-type" id="designer-type">flowchart</span>
      </div>
      <button id="designer-close" class="icon-btn" title="Close"
              aria-label="Close">×</button>
    </div>
    <div class="settings-body designer-body">
      <div class="designer-stage" id="designer-stage">
        <!-- the library mounts MermaidCanvasView in here -->
        <div class="designer-canvas" id="designer-canvas" tabindex="0"
             role="application"
             aria-label="Diagram canvas"></div>

        <!-- empty state: shown while the model has no nodes -->
        <div class="designer-empty" id="designer-empty" hidden>
          <span class="designer-state-icon" aria-hidden="true">◇</span>
          <p class="designer-state-msg">Double-click the canvas to add your first node.</p>
        </div>

        <!-- loading state: while the lazy bundle downloads -->
        <div class="designer-state designer-state--loading" id="designer-loading" hidden>
          <span class="designer-spinner" aria-hidden="true"></span>
          <p class="designer-state-msg" role="status">Loading editor…</p>
        </div>

        <!-- error state: mermaid render/parse failure or bundle failure -->
        <div class="designer-state designer-state--error" id="designer-error"
             role="alert" hidden>
          <span class="designer-state-icon" aria-hidden="true">⚠</span>
          <h3 class="designer-state-title">Couldn’t open this diagram</h3>
          <p class="designer-state-msg" id="designer-error-msg"></p>
          <pre class="designer-error-detail" id="designer-error-detail" hidden></pre>
          <div class="designer-state-actions">
            <button id="designer-retry" class="settings-action">Retry</button>
            <button id="designer-edit-source" class="settings-action">Edit source instead</button>
          </div>
        </div>

        <!-- preview-only state: library can render but not edit the model -->
        <div class="designer-state designer-state--readonly" id="designer-readonly" hidden>
          <span class="designer-state-icon" aria-hidden="true">👁</span>
          <h3 class="designer-state-title">Preview only</h3>
          <p class="designer-state-msg">This diagram type has no editable model yet.
            Close this window to edit the source instead.</p>
        </div>

        <!-- helper hint, non-empty diagrams -->
        <p class="designer-hint" id="designer-hint" hidden>
          Double-click to add a node · drag from a handle to connect
        </p>
      </div>
    </div>
    <div class="settings-footer designer-footer">
      <span class="designer-status" id="designer-status" role="status" aria-live="polite"></span>
      <button id="designer-cancel" class="settings-action">Cancel</button>
      <button id="designer-apply" class="settings-action settings-action--primary">Apply</button>
    </div>
  </div>
</div>
```

`aria-describedby="designer-hint"` points at whichever hint/hint-paragraph is
currently meaningful; drop the reference when the hint is `hidden` so a screen
reader does not read an invisible node (see §9).

### 3.2 Reused vs new classes

| Class | Reused / new | Source |
| --- | --- | --- |
| `.settings-overlay` | reused | `static/css/style.css:1303-1321` |
| `.settings-modal` | reused | `static/css/style.css:1322-1361` |
| `.settings-header`, `.icon-btn` | reused | `style.css:1398-1411`, `:1281-1301` |
| `.settings-body` | reused (layout overridden) | `style.css:1419-1425` |
| `.settings-footer` | reused | `style.css:1755-1763` |
| `.settings-action` | reused | `style.css:1643-1662` |
| `.designer-modal`, `.designer-header`, `.designer-heading`, `.designer-type` | new | §8.3 |
| `.designer-body`, `.designer-stage`, `.designer-canvas` | new | §5, §8.3 |
| `.designer-state` + `--loading/--error/--readonly`, `.designer-empty`, `.designer-hint` | new | §5 |
| `.designer-toolrow`, `.designer-tool-btn`, `.designer-popover` | new | §6 |
| `.designer-footer`, `.designer-status` | new | §8.3 |
| `.settings-action--primary` | new | §8.3 |

### 3.3 Size and responsiveness

`.settings-modal` defaults to `min(75vw, 96vw)` × `min(80vh, 92vh)`
(`static/css/style.css:1345-1346`). The designer needs a large canvas, so
`.designer-modal` overrides only the preferred size (the `96vw`/`92vh` clamps
are inherited):

```css
.designer-modal {
  width:  min(var(--designer-modal-w), 96vw);   /* --designer-modal-w: 1200px */
  height: min(var(--designer-modal-h), 92vh);   /* --designer-modal-h: 85vh   */
}
```

- **Desktop / tablet (≥ 720px):** 1200 × 85vh — a wide, tall canvas, still
  inset from every edge.
- **Narrow (≤ 720px):** `96vw` × `92vh` bind, so the modal is effectively
  full-screen; the footer keeps Cancel/Apply at the right and the status line
  moves to its own row (see §8.3) so two buttons never crowd the message.
- The modal is `position: fixed` and centered, with `display: flex;
  flex-direction: column; overflow: hidden` (`style.css:1340-1361`). The stage
  owns all internal scroll/pan; the modal itself never clips a diagram because
  the library's view provides pan/zoom inside the stage.

**Stacking.** `.settings-overlay` is `z-index: 2000` (`style.css:1307`); the
hybrid context menu is `z-index: 1000` (`style.css:2441`). The modal therefore
covers the menu. The menu is hidden before the designer opens (the item click
closes it).

**No nav column.** The Settings modal's `.settings-body` is a horizontal flex
with a nav column (`style.css:1419-1438`). The designer has no nav; set
`.designer-body { display: flex; flex-direction: column; }` so the stage can
use the full width and the `min-height: 0` scroll contract is preserved.

### 3.4 Open / close behavior

Mirror `static/js/export.js:329-352`:

- `open()`: store the invoker (`document.activeElement`), unhide the overlay,
  move focus to `#designer-canvas`.
- `close()`: unhide→hidden, then restore focus to the stored invoker
  (`export.js:344-350`).
- Esc closes; a click on the overlay backdrop closes; the header `×` closes.
  All three route through `close()`.
- Opening is guarded: if an instance is already open, focus the existing modal
  instead of opening a second (requirements §6, "editor opened twice").

---

## 4. Header

`.settings-header` gives a 14px/18px padded row with the title and a close
button (`style.css:1398-1411`). The designer adds `.designer-heading`, a
baseline-aligned row holding:

- `h2#designer-title` — **Design diagram** (unchanged copy).
- `.designer-type` — a small pill naming the detected diagram type
  (`flowchart`, `sequenceDiagram`, …). It is informational; it is `aria-hidden`
  when its text duplicates the title's scope, otherwise leave it readable. It
  uses `--bg-elev` / `--border` / `--fg-muted`.

The header is draggable by the `NB.windows` machinery like every
`.settings-modal` (`style.css:1362-1364`, `:1367-1397`); no designer-specific
work is needed. The `×` reuses `.icon-btn` (`style.css:1281-1301`).

---

## 5. Canvas area and its states

### 5.1 Layout

`.designer-stage` is a positioned, flex-filling box; `.designer-canvas` fills it
absolutely so the library's SVG surface and the state overlays share one
coordinate space. The library's tool row and popover are positioned relative to
this stage (§6).

```css
.designer-body { display: flex; flex-direction: column; min-height: 0; min-width: 0; padding: 0; }
.designer-stage { position: relative; flex: 1 1 auto; min-height: 0; min-width: 0; overflow: hidden; }
.designer-canvas {
  position: absolute; inset: 0;
  background-color: var(--designer-canvas-bg);
  background-image: radial-gradient(circle, var(--designer-grid) 1px, transparent 1px);
  background-size: var(--designer-grid-size) var(--designer-grid-size);
  background-position: center;
  overflow: hidden;
  outline: none;
}
.designer-canvas:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
```

- **Background:** `--designer-canvas-bg` (dark `#14151a`, light `#f7f8fb`).
- **Grid:** a calm **dot** grid from `--designer-grid` at `--designer-grid-size`
  (24px). Dots read as "work surface" without the busyness of a line grid. The
  grid is in **px**, not rem, matching the app's rule that only micro-decorations
  stay px (`style.css:30-36`); it must not balloon at XL font scale.
- **The library surface must be transparent** so the grid shows through. If the
  vendored `visimer.css` paints its own canvas background, override it to
  `transparent` on the `.designer-canvas` host. This is one of the allowed
  custom-property overrides (§7.3).

The library is mounted by `mermaid-designer.js` as
`new MermaidCanvasView({ editor, container: #designer-canvas,
mermaid: window.mermaid, mermaidConfig, toolbar: 'top' })` (architecture:
`mermaid-designer.md:76-79`).

### 5.2 Empty state (`#designer-empty`)

Shown while the model has zero nodes (a brand-new or emptied diagram). Centered
over the **visible grid** (`pointer-events: none`, no fill):

- a large muted glyph (`◇`, `--accent` at 80% opacity), and
- one line: *Double-click the canvas to add your first node.*

It disappears the moment the first node exists. It never blocks the canvas: the
user can double-click straight through it.

### 5.3 Loading state (`#designer-loading`)

Shown from open until the lazy Visimer bundle is fetched and the first render
completes (the bundle is ~264 KB, `mermaid-designer.md:54-56`). Opaque
background (`--designer-canvas-bg`) so the bare grid does not flash as
"content":

- `.designer-spinner` — a 26px ring, `--border` track, `--accent` head, 0.8s
  linear spin. Under `prefers-reduced-motion` the spin slows to 1.6s (it is a
  progress indicator, so it must not stop).
- `.designer-state-msg` with `role="status"`: *Loading editor…*

The footer's Apply is disabled during loading (§8.3).

### 5.4 Error state (`#designer-error`)

Shown when the lazy bundle fails to load **or** mermaid render/parse fails
inside the designer. Opaque background; `role="alert"` so it is announced when
it appears. It reuses the app's warn treatment so it reads like the existing
mermaid error box (`style.css:2828-2846`):

- `.designer-state-icon` `⚠` in `--warn`, `.designer-state-title` *Couldn’t open
  this diagram* in `--warn`.
- `.designer-state-msg` (`#designer-error-msg`) — a plain-language cause:
  *The diagram failed to render.* or *The diagram editor couldn’t be loaded.*
- `.designer-error-detail` — an optional, scrollable `<pre>` holding the raw
  mermaid message, `--code-bg`, monospace, `max-height: 9em`. Hidden when there
  is no detail text.
- Two actions: **Retry** (re-attempt load/render) and **Edit source instead**
  (close the modal and open the existing `Edit mermaid source` path). The second
  is the honest fallback the architecture promises (`mermaid-designer.md:202`).

Apply is disabled in this state; Cancel/`×`/Esc still close with no write.

### 5.5 Preview-only state (`#designer-readonly`)

Shown when the library renders the diagram but reports it is **not editable**
at runtime (`readOnly: true`). Opaque background, no `role="alert"` (not an
error):

- muted title **Preview only**, message *This diagram type has no editable model
  yet. Close this window to edit the source instead.*
- Apply is disabled; the canvas is rendered read-only.

This is the in-modal counterpart to the **disabled** render-only menu item
(§2.2). It guarantees the "no dead end" requirement (requirements §3.3) without
pretending to edit what the library cannot.

### 5.6 Ready state

The default. Grid visible, tool row and (when relevant) popover shown, helper
hint pinned bottom-center. Apply is enabled and is the primary action.

### 5.7 State precedence

```
loading → error(bundle) → readonly → error(render) → empty → ready
```

One state overlay visible at a time; the others are `hidden`. The empty overlay
is allowed to coexist with `ready` (it is `pointer-events: none` chrome over a
live canvas); the four `.designer-state` overlays are mutually exclusive and
cover the canvas.

---

## 6. Interaction affordances

### 6.1 Library tool row

The library owns the tool row (select / connect) and its buttons are its own
markup. We choose `toolbar: 'top'` and style it as a floating pill anchored
top-left of the stage:

```css
.designer-toolrow {
  position: absolute; top: 12px; left: 12px; z-index: 4;
  display: flex; align-items: center; gap: 4px;
  padding: 5px 6px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .35);   /* matches .context-menu, style.css:2446 */
}
```

Rationale for an **opaque, theme-aware pill** rather than the lightbox's
translucent black (`style.css:2999`): the canvas is a light surface in the light
theme, where a black pill looks like a bug. `--bg-elev` + `--border` reads as
app chrome on both themes. `.designer-tool-btn` uses the same accent-soft hover
and `aria-pressed` accent fill as `.settings-nav-item` (`style.css:1466-1478`).

If the vendor ships its own tool-row background, clear it and let this class
paint instead (allowed override, §7.3).

### 6.2 Popover

The library renders its floating entity popover (rename/label/delete) inside
the canvas host. We style it with the same surface tokens so it matches the
context menu and tool row:

```css
.designer-popover {
  position: absolute; z-index: 5; width: 220px;
  padding: 10px 12px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, .4);
  font-size: .86rem;
}
```

**Clipping constraint.** The popover is `position: absolute` inside
`.designer-canvas`, and `.designer-stage` is `overflow: hidden`. The popover must
therefore stay within the stage; the library normally clamps it near the
viewport. If it does not, the designer clamps the popover's `left/top` to the
stage rect after it opens. Do **not** make ancestors `overflow: visible` — the
stage must clip the pan/zoom surface.

### 6.3 Keyboard

| Key | Action | Notes |
| --- | --- | --- |
| `Esc` | close the modal, discard | handled by the designer's `keydown`, matching `export.js` / `hybrid.js:5268-5270` |
| `Ctrl/Cmd+Z` | **canvas undo** | must **not** reach the note. See below. |
| `Shift+Ctrl/Cmd+Z` | **canvas redo** | same routing |
| `Tab` / `Shift+Tab` | cycle focus within the modal | focus trap (§9) |
| `Enter` / `Space` | activate the focused tool / button | native `<button>` behavior |
| `Delete` / `Backspace` | delete the selected node/edge | library-owned; the designer must not intercept when the canvas has focus |

**Canvas undo isolation (hard requirement).** While the modal is open, the
global shortcut dispatcher (`static/js/shortcuts.js`, `static/js/vimnav.js`)
must not act on `Ctrl/Cmd+Z`. Two reinforcing mechanisms:

1. The designer's own `keydown` listener on `#designer-overlay` captures
   `Ctrl/Cmd+Z` (and `Shift+Ctrl/Cmd+Z`), calls `preventDefault()` +
   `stopPropagation()`, and forwards to the canvas's `undo`/`redo`.
2. `#designer-overlay` gets `data-active` (or `NB.mermaidDesign.isOpen()`
   returns true) and the global handlers early-return while it is set, so a
   `Ctrl+Z` that slips past the dialog never reaches the note's history. This is
   exactly architecture test 8 (`mermaid-designer.md:180`).

The note's history is touched only by the **Apply** write-back, which is one
undo step in the owning editor (`mermaid-designer.md:109-110`).

**Autosave.** Never runs while the modal is open (requirements §4). The
designer does not call any save path until Apply.

### 6.4 Footer status line

`#designer-status` sits left of the buttons (`.designer-footer` uses
`.settings-footer`'s `justify-content: flex-end` plus
`.designer-status { margin-right: auto }`). It is `role="status"
aria-live="polite"` and carries transient, non-blocking feedback: *Ready*,
*No changes to apply*, *Applying…*, *Couldn’t apply — the diagram changed*.
Reuse the `.settings-vimrc-status` color pattern: `--fg-muted` default,
`--ok` for success, `--warn` for failure (`style.css:1585-1590`).

---

## 7. Theme

### 7.1 Body theme

The canvas reads theme tokens from `body[data-theme]` (`style.css:4-88`):
`--designer-canvas-bg`, `--designer-grid`, `--accent`, `--border`, `--bg-elev`,
`--fg`, `--fg-muted`. No JS theme switch is needed for the chrome — the tokens
flip with the body.

### 7.2 Diagram theme

The diagram itself is rendered by **our** vendored mermaid through the library.
Pass the resolved body theme into `mermaidConfig: { theme }` at mount so the
diagram nodes/edges match the app (architecture: `mermaid-designer.md:181`).
When the note re-renders after Apply, the existing renderer re-renders with the
same theme (`static/js/mermaid.js`), so the block and the designer agree.

### 7.3 Library custom properties (the allowed override)

The library's stylesheet is vendored (`static/vendor/visimer.css`,
`mermaid-designer.md:141-148`). Scope overrides to our host so we never edit the
vendored file:

```css
.designer-canvas {
  /* our contract; alias to the vendor's internal names once frozen */
  --designer-canvas-bg: #14151a;   /* from token */
  --designer-accent: var(--accent);
}
```

Set, at minimum: canvas/background (`transparent`, so our grid shows),
accent (node selection / handles) = `var(--accent)`, surface/popover background =
`var(--bg-elev)`, text = `var(--fg)`, and border = `var(--border)`. The exact
vendor variable **names** are read from `static/vendor/visimer.css` at
implementation time; our values are the tokens above. Keep this to a single
small alias block in `style.css`, commented as "Visimer theme bridge".

### 7.4 Font scaling

- Header, type pill, footer, status, state messages, and hints are **rem** —
  they scale with `--font-scale` (`style.css:36`, `:92-97`).
- Grid size, spinner, and glyph sizes are **px** — they are micro-decorations
  that must not distort at 1.3×.
- The diagram's own text is the library's SVG, scaled by pan/zoom, not by
  `--font-scale`; leave it to the canvas.

---

## 8. Design tokens

### 8.1 New tokens (add to the theme blocks)

Add to `:root` (dark default) and override in `body[data-theme="light"]`
(`style.css:4-88`):

| Token | Dark | Light | Purpose |
| --- | --- | --- | --- |
| `--designer-canvas-bg` | `#14151a` | `#f7f8fb` | canvas surface behind the grid |
| `--designer-grid` | `rgba(124,156,255,.12)` | `rgba(47,95,208,.14)` | grid dot color (accent-tinted) |
| `--designer-grid-size` | `24px` | `24px` | grid pitch (px, not rem) |
| `--designer-modal-w` | `1200px` | `1200px` | preferred modal width |
| `--designer-modal-h` | `85vh` | `85vh` | preferred modal height |
| `--accent-fg` | `#14151a` | `#ffffff` | text/icon on `--accent` fills (primary Apply) |

### 8.2 Reused tokens

`--bg`, `--bg-panel`, `--bg-elev`, `--fg`, `--fg-muted`, `--accent`,
`--accent-soft`, `--border`, `--code-bg`, `--danger`, `--warn`, `--ok`
(`style.css:4-88`). No others.

### 8.3 New CSS (block to add to `static/css/style.css`)

```css
/* ------------------------------------------------------------------ */
/* Mermaid visual designer                                             */
/* ------------------------------------------------------------------ */
.designer-modal { width: min(var(--designer-modal-w), 96vw); height: min(var(--designer-modal-h), 92vh); }
.designer-heading { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.designer-type {
  font-size: .72rem; text-transform: uppercase; letter-spacing: .6px;
  color: var(--fg-muted); background: var(--bg-elev);
  border: 1px solid var(--border); border-radius: 999px; padding: 2px 9px;
  white-space: nowrap;
}
.designer-body { display: flex; flex-direction: column; min-height: 0; min-width: 0; padding: 0; }
.designer-stage { position: relative; flex: 1 1 auto; min-height: 0; min-width: 0; overflow: hidden; }
.designer-canvas {
  position: absolute; inset: 0;
  background-color: var(--designer-canvas-bg);
  background-image: radial-gradient(circle, var(--designer-grid) 1px, transparent 1px);
  background-size: var(--designer-grid-size) var(--designer-grid-size);
  background-position: center;
  overflow: hidden; outline: none;
}
.designer-canvas:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

.designer-state {
  position: absolute; inset: 0; z-index: 3;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; padding: 32px; text-align: center;
}
.designer-state[hidden] { display: none; }
.designer-state--loading,
.designer-state--error,
.designer-state--readonly { background: var(--designer-canvas-bg); }
.designer-state-icon { font-size: 1.6rem; line-height: 1; color: var(--fg-muted); }
.designer-state-title { margin: 0; font-size: 1rem; font-weight: 600; color: var(--fg); }
.designer-state--error .designer-state-title { color: var(--warn); }
.designer-state-msg { margin: 0; max-width: 46ch; font-size: .9rem; color: var(--fg-muted); }
.designer-state-actions { display: flex; gap: 8px; margin-top: 6px; }
.designer-error-detail {
  max-width: 60ch; max-height: 9em; overflow: auto; text-align: left;
  margin: 0; padding: 10px 12px; white-space: pre-wrap;
  font: .82rem/1.4 ui-monospace, Menlo, Consolas, monospace;
  color: var(--fg); background: var(--code-bg);
  border: 1px solid var(--border); border-radius: 6px;
}
.designer-spinner {
  width: 26px; height: 26px; border-radius: 50%;
  border: 3px solid var(--border); border-top-color: var(--accent);
  animation: designer-spin .8s linear infinite;
}
@keyframes designer-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .designer-spinner { animation-duration: 1.6s; } }

.designer-empty {
  position: absolute; inset: 0; z-index: 2; pointer-events: none;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 24px; text-align: center;
}
.designer-empty[hidden] { display: none; }
.designer-empty .designer-state-icon { font-size: 2rem; color: var(--accent); opacity: .8; }
.designer-hint {
  position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%);
  z-index: 2; max-width: calc(100% - 32px); margin: 0; padding: 6px 12px;
  font-size: .82rem; color: var(--fg-muted); text-align: center;
  background: var(--bg-elev); border: 1px solid var(--border); border-radius: 999px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, .25); pointer-events: none;
}
.designer-hint[hidden] { display: none; }

.designer-toolrow {
  position: absolute; top: 12px; left: 12px; z-index: 4;
  display: flex; align-items: center; gap: 4px; padding: 5px 6px;
  background: var(--bg-elev); border: 1px solid var(--border); border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .35);
}
.designer-tool-btn {
  display: inline-flex; align-items: center; gap: 6px;
  background: transparent; border: 1px solid transparent; color: var(--fg-muted);
  border-radius: 5px; padding: 4px 9px; font: inherit; font-size: .85rem; cursor: pointer;
}
.designer-tool-btn:hover { background: var(--accent-soft); color: var(--fg); }
.designer-tool-btn[aria-pressed="true"] {
  background: var(--accent-soft); border-color: var(--accent); color: var(--accent);
}

.designer-popover {
  position: absolute; z-index: 5; width: 220px; padding: 10px 12px;
  background: var(--bg-elev); border: 1px solid var(--border); border-radius: 8px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, .4); font-size: .86rem;
}
.designer-popover-title { margin: 0 0 6px; font-weight: 600; color: var(--fg); }
.designer-popover-row { display: flex; justify-content: space-between; gap: 10px; padding: 2px 0; color: var(--fg-muted); }
.designer-popover-row b { font-weight: 500; color: var(--fg); }

.designer-footer { align-items: center; }
.designer-status { margin-right: auto; font-size: .85rem; color: var(--fg-muted); }
.designer-status.ok { color: var(--ok); }
.designer-status.error { color: var(--warn); }

.settings-action--primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); font-weight: 600; }
.settings-action--primary:hover { background: var(--accent); border-color: var(--accent); filter: brightness(1.06); }
.settings-action--primary:disabled,
.settings-action--primary:disabled:hover {
  background: var(--accent); border-color: var(--accent); color: var(--accent-fg);
  opacity: .5; filter: none; cursor: not-allowed;
}

/* narrow screens: stack the status line above the buttons */
@media (max-width: 720px) {
  .designer-footer { flex-wrap: wrap; }
  .designer-status { flex: 1 1 100%; margin: 0 0 6px; }
}
```

### 8.4 Tool row vs. app chrome — spacing

All insets are 12px (tool row top/left, popover offset), matching the lightbox
toolbar's 16px feel (`style.css:2991-3003`) but tightened for a modal. Modal
padding is unchanged (header 14/18, footer 12/18). No new spacing scale is
introduced.

---

## 9. Accessibility

- **Dialog semantics.** `.designer-modal` is `role="dialog" aria-modal="true"`
  with `aria-labelledby="designer-title"` and a conditional
  `aria-describedby` (the hint/state message, when visible). Matches the
  Settings/Export modals (`index.html:347`, `:822`).
- **Focus on open.** Move focus to `#designer-canvas` (`tabindex="0"`). It is
  the primary surface; a keyboard user should land where the work happens, not
  on a chrome button.
- **Focus trap.** `Tab`/`Shift+Tab` cycle within the modal's focusable
  descendants: the header `×`, the canvas, any tool-row buttons, the popover's
  controls, then Cancel and Apply, then wrap. Collect focusables as
  `button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])`
  filtered by `offsetParent !== null` (this mirrors the visibility filter the
  hybrid menu already uses at `hybrid.js:5289`). Do not use `inert` on `#app`:
  the overlays are children of `#app` (`index.html:41`, `:306`), so inerting
  the app would inert the modal too.
- **Focus return.** On close, restore focus to the element stored at open
  (`export.js:347-349`). For the hybrid entry the invoker is the menu item; if
  the menu has already hidden, focus falls back to the mermaid container.
- **Keyboard-only path.** Fulfilled by §2.3 + §6.3: Tab to the focused block →
  Shift+F10 → arrow to `Design diagram…` → Enter → edit on the canvas →
  Tab to Apply → Enter. Esc always exits.
- **Canvas role.** `role="application"` with an `aria-label` is used because
  the library implements its own keyboard interaction on the surface (a plain
  `group` would make screen readers read the SVG as static content). The label
  states the primary gesture. If the vendored library does **not** implement
  roving focus / arrow-key navigation, downgrade to `role="group"` with the same
  label and expose the tool-row buttons as the keyboard entry; do not claim
  `application` without the keyboard behavior behind it.
- **Live regions.** `#designer-status` is `role="status" aria-live="polite"`.
  `#designer-loading .designer-state-msg` is `role="status"`. `#designer-error`
  is `role="alert"`.
- **Contrast.** Body text on canvas: `--fg` on `--designer-canvas-bg` ≈ 15:1
  (dark) / 14:1 (light). Muted hint: ≈ 5.5:1 both themes (AA for normal text).
  Primary Apply label: `--accent-fg` on `--accent` ≈ 7.9:1 (dark) / 6.2:1
  (light). Error title `--warn` on `--designer-canvas-bg`: ≈ 9:1 (dark) / 4.8:1
  (light, large-text AA; it is a heading, so acceptable). Grid dots are
  decorative and never carry meaning.
- **Focus visibility.** `.designer-canvas:focus-visible` uses a 2px `--accent`
  outline inset by 2px. Buttons inherit the app's focus-visible accent outline
  pattern (`style.css:1475-1478`).
- **Reduced motion.** Only the spinner animates; it slows under
  `prefers-reduced-motion` rather than stopping (progress must stay legible).
  No other designer animation exists.
- **Disabled reasons.** The render-only menu item carries `disabled`,
  `aria-disabled="true"`, and a `title` so the reason is not click-only.

---

## 10. Handoff checklist (`web-engineer`)

Files (per `mermaid-designer.md:142-158`):

1. `templates/index.html` — add the `#designer-overlay` markup (§3.1), the
   `static/js/mermaid-designer.js` script tag in dependency order (after
   `mermaid.js` and `blocks.js`, before `hybrid.js`), and the
   `static/vendor/visimer.css` link.
2. `static/css/style.css` — add the tokens (§8.1) to both theme blocks and the
   `.designer-*` block (§8.3), plus the Visimer theme bridge (§7.3).
3. `static/js/mermaid-designer.js` — modal open/close/Esc/backdrop, focus
   trap + return, lazy mount of `MermaidCanvasView({ toolbar: 'top' })`, state
   machine (§5.7), `Ctrl+Z` isolation (§6.3), Apply/Cancel.
4. `static/js/hybrid.js` — the `Design diagram…` item (§2.2) above the existing
   source item (`hybrid.js:5176-5183`); the block focus + `Shift+F10` open
   (§2.3).
5. `static/js/auth.js` (or the designer) — expose/cache the role for the menu
   gate (§2.2).
6. `static/sw.js` — CACHE bump + PRECACHE `mermaid-designer.js` (the vendor
   bundle stays lazy), per `mermaid-designer.md:154`.

Verify (from `mermaid-designer.md:160-182`): jsdom menu-visibility and
Apply/Cancel write tests; the completeness/lazy guards; Playwright round-trip,
theme sync, and the `Ctrl+Z`-does-not-touch-the-note test.

## 11. What to avoid

- **No new framework or CSS system.** Plain CSS, the app's own classes and
  tokens.
- **No one-off values.** Every color/size maps to a token above.
- **No layout control for the diagram.** The canvas edits structure and labels;
  it never stores coordinates (requirements §8). No position persistence UI.
- **No nav column, no multi-pane shell.** The designer is one stage; do not
  clone the Settings nav.
- **No restyling of the library internals** beyond the §7.3 alias block; edit
  the vendored `visimer.css` only to build it, never by hand.
- **No preview-hover entry, no source pane, no Insert flow** in P1 — those are
  later phases (architecture phasing, `mermaid-designer.md:186-191`).
- **No autosave while open.** The note is written only on Apply.
- **Don't disable Apply silently.** When Apply is unavailable, the reason is
  shown (status line or state message).
