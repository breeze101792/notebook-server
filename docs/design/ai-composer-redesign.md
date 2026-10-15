# AI Composer Redesign

Design handoff for the input/composer area of the AI assistant side panel
(`#ai-view`, mounted by `static/js/ai.js`). Reference mockup:
`docs/design/ai-composer-redesign.html`.

Status: design only. No source files were changed. `web-engineer` implements
the CSS in `static/css/style.css` and the two small `ai.js` tweaks called out
below.

---

## 1. Design intent

Turn the composer from four competing boxes into **one calm input card**. Today
the row is a textarea, an attach square, a send square, and (when streaming) a
stop square — all roughly the same size, all with their own border, all sitting
side by side at equal weight. The eye has to sort four objects. The redesign
makes the **card itself** the single bordered surface: the textarea becomes a
borderless field that fills the card, the attach control drops to a quiet ghost
icon in the card's bottom-left, and send/stop occupies a single circle in the
bottom-right — a filled accent circle when idle, an outlined neutral circle
while streaming. One border, one focal point (the text), two subordinate
actions. The layout is a two-row CSS grid, so it stays composed down to the
panel's minimum width without any breakpoint.

---

## 2. Layout spec

### Structure (markup is unchanged; only CSS changes)

```
form.ai-input-row            <- the card (grid)
├── textarea.ai-input        <- grid-area: input   (row 1, full width)
├── button.ai-attach         <- grid-area: attach  (row 2, left)
├── button.ai-send           <- grid-area: actions (row 2, right)
├── button.ai-stop           <- grid-area: actions (row 2, right)
└── input.ai-attach-input    <- hidden; not a grid item
```

`sendBtn` and `stopBtn` share the `actions` grid area and are mutually
exclusive (`stopBtn.hidden` toggles). They never both render, so the overlap is
safe.

Sibling above the card (unchanged position):

```
div.ai-attach-bar            <- attachment chips + error chips; hidden when empty
```

### Grid

```css
grid-template-columns: 1fr auto;
grid-template-areas:
  "input  input"
  "attach actions";
row-gap: 4px;
column-gap: 4px;
align-items: end;
```

- Row 1: the textarea spans both columns and dominates the card.
- Row 2: attach docked left, send/stop docked right.

### Card metrics

- Margin: `8px 12px 12px` (replaces the old `border-top`; gives the card
  breathing room against the panel bottom and sides).
- Padding: `8px 8px 6px`.
- Background `--bg-elev`, border `1px solid --border`, radius `12px`.
- Horizontal margin `12px` matches `.ai-attach-bar`'s `12px` so chips and card
  share an edge.

### Idle state

Textarea empty (placeholder visible), `.ai-attach` ghost icon bottom-left,
`.ai-send` filled accent circle bottom-right. `.ai-stop` hidden.

### Streaming state

Identical geometry; `.ai-stop` replaces `.ai-send` in the same circle slot
(outlined neutral, not accent). `.ai-attach` is disabled while streaming
(`syncSend` already sets `attachBtn.disabled = !!ctl`). Optional accent tint:
add class `.ai-streaming` to `.ai-input-row` in `ui.begin()` / `ui.end()` so
the card border turns `--accent` while a response streams. Recommended, not
required.

### Narrow width (panel minimum 240px; resizable; also small screens)

No breakpoint needed. The two-row grid is fluid: the textarea keeps its full
width and the two icon actions sit on their own row, so nothing is squeezed.
At 240px the card still shows a full-width field with attach left / send right.
Chips wrap normally in `.ai-attach-bar` (already `flex-wrap: wrap`). The only
narrow tightening, if desired, is a viewport media query
(`@media (max-width: 480px) { .ai-input-row { margin: 6px 8px 10px; } }`) —
viewport width is a poor proxy for panel width, so this is optional polish, not
a requirement.

### Hierarchy / whitespace

1. Textarea (largest, transparent, no competing border).
2. Send/stop (single accent focal action).
3. Attach (quietest — no fill until hover).
4. Chips (transient, above the card, muted).

---

## 3. Component specs

All values use existing tokens. Sizes are in `px` (matching the existing
`.ai-*` micro-control convention so `--font-scale` never balloons icon buttons;
the textarea's font stays rem-based and does scale).

### Card — `.ai-input-row`
| Property | Value |
| --- | --- |
| display | `grid` (template above) |
| margin | `8px 12px 12px` (was `padding` + `border-top`) |
| padding | `8px 8px 6px` |
| background | `--bg-elev` |
| border | `1px solid --border` |
| radius | `12px` |
| focus-within | `border-color: --accent; box-shadow: 0 0 0 3px --accent-soft` |
| streaming (opt) | `.ai-streaming` → `border-color: --accent` |

Remove the old `border-top` and the old `align-items: flex-end` flex rules.

### Textarea — `.ai-input`
| State | Spec |
| --- | --- |
| default | `background: transparent; border: none; color: --fg; resize: none; padding: 4px 6px 0; font-size: .9rem; line-height: 1.5; min-height: 40px; max-height: 160px` |
| focus | `outline: none` — focus is shown by the card's `:focus-within` ring |
| placeholder | `color: --fg-muted` |
| disabled | not used (field stays enabled while streaming) |

Keep the JS auto-grow; only the `resize: vertical` handle is removed.

### Attach — `.ai-attach`
| State | Spec |
| --- | --- |
| default | `30×30px; inline-flex center; border: none; background: transparent; color: --fg-muted; border-radius: 8px` |
| hover | `color: --fg; background: --accent-soft` |
| focus-visible | `outline: 2px solid --accent; outline-offset: 2px` |
| active | no transform (it is a secondary action) |
| disabled | `opacity: .4; color: --fg-muted; background: transparent; cursor: default` |

### Send — `.ai-send`
| State | Spec |
| --- | --- |
| default | `32×32px; border-radius: 50%; border: none; background: --accent; color: --accent-fg; inline-flex center` |
| hover | `box-shadow: 0 0 0 3px --accent-soft` |
| active | `transform: translateY(1px)` |
| focus-visible | `outline: 2px solid --accent; outline-offset: 2px` |
| disabled | `background: --bg-elev; color: --fg-muted; border: 1px solid --border; opacity: .6; box-shadow: none; cursor: default` |

`--accent-fg` is the existing token for text/icons on an accent fill (dark
`#14151a`, light `#ffffff`); it is the correct choice here, not `#fff`.

### Stop — `.ai-stop`
| State | Spec |
| --- | --- |
| default | `32×32px; border-radius: 50%; border: 1px solid --border; background: --bg-elev; color: --fg; inline-flex center` |
| hover | `color: --danger; border-color: --danger` |
| focus-visible | `outline: 2px solid --accent; outline-offset: 2px` |
| hidden | explicit `.ai-stop[hidden] { display: none }` (defensive; matches the `.ai-attach-bar[hidden]` precedent) |

Stop is deliberately **not** accent-filled: it must not compete with the
primary send, and it is an interrupt, so it reads neutral until hovered.

### Attachment chips — `.ai-attach-chip` (unchanged)
Keep the current chip styles (`.ai-attach-bar`, `.ai-attach-chip`,
`.ai-attach-chip-name`, `-size`, `-thumb`, `-remove`, `.error`, `.reading`,
`.ai-attach-err`). Only change the bar's padding to align with the card:

```css
.ai-attach-bar { padding: 0 12px; }   /* was: 6px 12px 0 */
```

The card's `margin-top: 8px` supplies the gap; chips therefore sit directly
above the card with a matching 12px side edge.

---

## 4. Icon / label treatment

**Current code** (`ai.js` 2132, 2159, 2164) uses plain text glyphs:
`attachBtn.textContent = "📎"`, `sendBtn.textContent = "↑"`,
`stopBtn.textContent = "■"`. The emoji paperclip renders inconsistently across
platforms and ignores `currentColor`.

**Recommendation:** replace each glyph with an inline SVG using
`stroke/fill: currentColor`, `width/height 18`, `aria-hidden="true"`. Add an
`aria-label` to each icon-only button (the code currently sets only `title`;
`title` is not a reliable accessible name). Keep `title` for the tooltip.

Exact SVG to embed (set via `innerHTML` on the button; no new CSS class):

```html
<!-- attach: paperclip -->
<svg width="18" height="18" viewBox="0 0 24 24" fill="none"
     stroke="currentColor" stroke-width="1.8"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
</svg>

<!-- send: arrow up -->
<svg width="18" height="18" viewBox="0 0 24 24" fill="none"
     stroke="currentColor" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>
</svg>

<!-- stop: filled rounded square -->
<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <rect x="7" y="7" width="10" height="10" rx="2"/>
</svg>
```

Accessible names: `attach` → `"Attach files"` (or `"Attach text files"` in the
ACP branch), `send` → `"Send message"`, `stop` → `"Stop generating"`. Keep the
existing `"Remove <name>"` aria-label on `.ai-attach-chip-remove`.

**Fallback (minimum change):** if SVG embedding is out of scope, keep the text
glyphs but still add the three `aria-label`s and set the glyph color from
`currentColor` (works for `↑`/`■`, not for the emoji). The rest of the layout
spec is unchanged.

---

## 5. Class names: keep vs add

### Reuse unchanged (no `ai.js` change)
- `.ai-input-row` — the card; restyled to grid.
- `.ai-input` — textarea.
- `.ai-attach` — attach button.
- `.ai-send`, `.ai-stop` — action buttons.
- `.ai-attach-input` — hidden file input.
- `.ai-attach-bar`, `.ai-attach-chip`, `.ai-attach-chip-name`,
  `.ai-attach-chip-size`, `.ai-attach-chip-thumb`, `.ai-attach-chip-remove`,
  `.ai-attach-chip.error`, `.ai-attach-chip.reading`, `.ai-attach-err`.
- `.ai-drop-active` — drag highlight (unchanged; the `2px dashed --accent`
  outline still reads correctly over the card).

### Replace in `static/css/style.css`
- The combined `.ai-send, .ai-stop { … }` rule (≈3972–3984) and the separate
  `.ai-stop { … }` (3984) → split into the specs in §3.
- `.ai-input { … }` (3958–3970) and `.ai-input:focus` (3971) → §3.
- `.ai-attach { … }` (4041–4052) → §3.
- `.ai-input-row { … }` (3950–3957) → §3 grid card.
- `.ai-attach-bar { padding: 6px 12px 0 }` → `padding: 0 12px`.

### Add (in `ai.js`)
- **Required:** none. The grid layout needs no new markup or class.
- **Recommended (optional):** class `ai-streaming` on the `.ai-input-row`
  element, added in `ui.begin()` and removed in `ui.end()` (one line each), to
  drive the accent border tint while streaming.
- **If SVG icons are adopted:** change the three `textContent = "…"` lines to
  `innerHTML = "<svg…>"` and add `aria-label` on the same three buttons.

---

## 6. Reference mockup

`docs/design/ai-composer-redesign.html` — standalone, no build step, no
dependencies. It inlines the app's real dark and light tokens as `.theme-dark`
/ `.theme-light` variable sets (equivalents of `:root` and
`body[data-theme="light"]`) and renders four composer states side by side:
dark idle (with attachment chips), dark streaming, dark narrow (240px), and
light idle. Open it directly in a browser.

---

## 7. Acceptance criteria

Testable by `web-engineer` while implementing and by `tester` for regression.

- [ ] The composer renders as a single bordered card; there is exactly one
      visible border around the input area (the card), and the textarea itself
      has no border of its own.
- [ ] Idle state shows the send button (filled accent circle) and **not** the
      stop button; streaming state shows the stop button and **not** the send
      button. Exactly one action circle is visible at all times.
- [ ] Send and stop occupy the same bottom-right slot; toggling between them
      does not shift the card's layout, width, or height.
- [ ] The attach control is a borderless ghost icon until hover; on hover it
      shows `--accent-soft` background and `--fg` icon color.
- [ ] Clicking the composer card focuses the textarea (grid layout does not
      break the existing click-to-focus / auto-grow behaviour).
- [ ] The textarea still auto-grows up to 160px and Enter still sends while
      Shift+Enter inserts a newline (behaviour unchanged from `ai.js` 2438).
- [ ] `sendBtn.disabled` (empty draft / reading attachments / streaming) still
      renders the inert disabled look, and Enter is still suppressed while
      disabled.
- [ ] Attachment chips still appear above the card in `.ai-attach-bar`, are
      removable via their `✕`, and error chips still show in `--danger`.
- [ ] The composer is usable at a 240px panel width with no horizontal
      overflow and no clipped controls.
- [ ] Keyboard focus on attach, send, and stop shows a visible `2px --accent`
      outline; the card shows an accent focus ring while the textarea is
      focused.
- [ ] Icon-only buttons (attach, send, stop) expose an accessible name
      (`aria-label`); the remove buttons keep `"Remove <name>"`.
- [ ] Both the dark and light themes render with correct contrast (accent
      circle uses `--accent-fg` on `--accent`; muted icons meet ≥ 3:1 on the
      card).
- [ ] No new dependencies, no framework, plain CSS only; all colors and sizes
      come from existing tokens (no new custom properties introduced).
