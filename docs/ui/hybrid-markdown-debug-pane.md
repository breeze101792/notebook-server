# Markdown debug pane — the read-only source column in hybrid mode

Status: Current spec — pre-implementation (2026-11-16).
Mockup: [`hybrid-markdown-debug-pane-mockup.html`](hybrid-markdown-debug-pane-mockup.html) (illustrative; this doc is normative).

**Normative source.** This document owns one control and one pane: the split-view
toggle in the hybrid edit bar, and the read-only Markdown column beside the
editable page. It owns their anatomy, tokens, states, layout, breakpoint, and
accessibility. It does not own the hybrid surface
([`hybrid-mode.md`](hybrid-mode.md)), the edit bar's other controls
([`hybrid-mode.md`](hybrid-mode.md) §1.2, [`source-editor.md`](source-editor.md)),
the reader ([`reader.md`](reader.md)), or the serialization itself
([`../architecture/hybrid-editing.md`](../architecture/hybrid-editing.md) §5.8).
The product definition is
[`../product/hybrid-markdown-debug-pane.md`](../product/hybrid-markdown-debug-pane.md).

**Prerequisite.** None. The control and pane are additive: no existing token,
geometry, or rule changes. The pane reads tokens from
[`foundations.md`](foundations.md); the toggle follows the markdown edit bar's
recorded 26 px exception in [`guidelines.md`](guidelines.md) §6.

Paths: `index.html` is `templates/index.html`; `hybrid.js` is
`static/js/hybrid.js`; `style.css` is `static/css/style.css`.

---

## 1. What it is

A debug view, not a second editor. In hybrid mode the owner can split the
content area into two columns:

- **Left** — the editable hybrid page. Unchanged in every respect: caret,
  selection, block chrome, overlays, scroll.
- **Right** — a read-only, monospace column holding the Markdown that **Save
  would write right now** (`domToMarkdown()`, `hybrid.js:1259`).

The pane is not part of the document. It is a sibling of `#viewer` inside
`#edit-split` (`index.html:510-553`), never a child of `#viewer-content`, so the
serializer cannot see it. That isolation is a hard invariant, not an
implementation detail (product P-AC13).

## 2. The toggle

### 2.1 Anatomy

| Property | Value | Source |
| --- | --- | --- |
| Element | `<button id="hybrid-debug-btn" class="eb" type="button" aria-pressed="false" aria-controls="hybrid-debug-pane" aria-label="Show the Markdown source" title="Show the Markdown source Save writes" hidden><svg class="icon" aria-hidden="true" focusable="false"><use href="#nb-icon-split"/></svg></button>` | new |
| Glyph | sprite symbol `#nb-icon-split`, 16 px (`--icon-md`), `currentColor`; no text label | §2.4, `foundations.md` §9 |
| Box | the markdown edit bar's 26 px control: `min-width: 28px`, `height: 26px`, `padding: 0 6px`, `--radius-xs` (4) — the shipped `.eb` value | `style.css:791-805`, `:240`; exception in `guidelines.md` §6 |
| Icon box | 16 × 16 inside the 26 px `.eb`; the bar's font rules are inherited but unused | `style.css:791-805`; `foundations.md` §9.1 |
| Rest face | transparent, `--text-muted` | `style.css:801-805` |
| Hover | `--accent-soft` face, `--text-primary` | `style.css:807-810` |
| Pressed (`aria-pressed="true"`) | `--accent-soft` face, `--accent` 1 px border, `--accent` glyph — the toggle contract, never a filled accent | `controls.md` §2.2; graph-view toggle face `style.css:5067-5071` |
| Active (mouse held) | same soft face in both states: `#edit-bar #hybrid-debug-btn:active { background: var(--accent-soft); color: var(--accent); border-color: var(--accent) }`, overriding the bar's filled-accent `:active` (`style.css:811`) | new; controls.md §2.2 |
| Focus-visible | `--focus-ring` at +1 px — the shipped rule for the bar | `style.css:9231-9233`; `guidelines.md` §6 |
| Name | constant `aria-label="Show the Markdown source"`; state lives in `aria-pressed` | new |
| Visible when | hybrid mode is active **and** the viewport is 1140 px or wider | §4.3 |
| Hidden when | source mode, preview, phone, any viewport below 1140 px | §4.3, §6 |

### 2.2 Placement

Own separator group, after `Tx` (Clear formatting) and before the
`.eb-actions` group:

```
… ── ▦ | ▦ ▾ … | Tx | ⧉ |        [Preview] [Save] [Close]
```

`index.html:502-508` is the insertion point. The split toggle is a view control,
not a formatting command, so it gets its own separator and sits outside the
right-hand action cluster — but the cluster's `margin-left:auto`
(`style.css:1380-1385`) still pins Preview/Save/Close to the right edge.

At 772 px the bar wraps to two rows and at 353 px to four
([`hybrid-mode.md`](hybrid-mode.md) §1.2). One more 28 px control can add a
wrap at the boundary; that is the bar's normal behaviour and is not an
exception.

### 2.3 Behaviour

Click toggles the pane. The click runs through the edit bar's shared
`mousedown` handler, which calls `preventDefault()` and saves the toolbar range
(`hybrid.js:6404-6409`), so the page keeps focus and the caret does not move.
The toggle is wired by id, with a capture listener like Save and Close
(`hybrid.js:7772-7773`, `:7820-7821`), not through the `data-act` router.
`aria-pressed` follows the pane's visibility.

The label is constant; the state is `aria-pressed`. This is the same pattern as
the graph's 2D/3D toggles (`style.css:4963`).

### 2.4 The symbol

A new sprite symbol, added after the last existing one (`#nb-icon-menu`,
`index.html:246`), drawn to `foundations.md` §9.1: 16 grid, live area 1–15,
1.5 stroke, `currentColor`, `fill="none"`.

```html
<symbol id="nb-icon-split" viewBox="0 0 16 16">
  <rect x="2.2" y="3" width="11.6" height="10" rx="1.6" fill="none"
        stroke="currentColor" stroke-width="1.5"/>
  <path d="M8 3.6v8.8" fill="none" stroke="currentColor"
        stroke-width="1.5" stroke-linecap="round"/>
</symbol>
```

A split panel: one frame, two columns. It names the action — open a second
column — and the tooltip and the pane's own header name the content.

**Not `#nb-icon-code`.** That glyph already means "Edit Markdown source" on the
top-bar `#edit-toggle` (`index.html:322`). The same glyph for a different action
one bar lower would read as a second route into source mode. Do not substitute
it; do not draw `</>` inside the right column — at 16 px a bracket pair in a
half-width pane is mud.

## 3. The pane

### 3.1 Structure

```html
<div id="hybrid-debug-pane" class="hybrid-debug-pane" hidden>
  <div class="hybrid-debug-head">
    <span class="hybrid-debug-title">Markdown</span>
    <span class="hybrid-debug-hint">what Save writes</span>
  </div>
  <pre id="hybrid-debug-source" class="hybrid-debug-source"
       role="region" aria-label="Markdown source, read-only" tabindex="0"></pre>
</div>
```

Inserted once, after `#viewer` and before `#draft-bar` (`index.html:524-533`),
inside `#edit-split`.

### 3.2 Header

| Property | Value |
| --- | --- |
| Height | 26 px, `box-sizing: border-box` |
| Face | `var(--bg-elev)`, `border-bottom: 1px solid var(--border)` |
| Layout | `display: flex; align-items: center; gap: var(--space-2); padding: 0 var(--space-3)` |
| Title | the **label** role at its loud variant: `--text-xs` (.72rem), 600, `--lh-tight`, `--tracking-label`, `text-transform: uppercase`, `var(--text-primary)`. The DOM text stays `Markdown` so a screen reader reads a word, not letters |
| Hint | the **label** role at its quiet variant: `--text-xs`, 400, `var(--text-muted)`, sentence case, `margin-left: auto`, one line, ellipsis |
| Controls | none. The toggle above is the only control |

The hint is the doc's core promise in three words: this is not the file on disk
before a save, it is the file the next save produces.

### 3.3 Body

| Property | Value |
| --- | --- |
| Element | `<pre>`, `id="hybrid-debug-source"` |
| Face | `--bg-panel` (inherited from the pane) |
| Text | `var(--font-mono)`; `--text-sm` size (.8rem); `--lh-snug` (1.35); `--text-primary` |
| White space | `pre-wrap` + `overflow-wrap: anywhere`; no horizontal scrollbar |
| Padding | `var(--space-3) var(--space-4) var(--space-4)` (12/16/16) |
| Scroll | `overflow-y: auto`, `overflow-x: hidden`, `overscroll-behavior: contain` |
| Selection | native; the text is copyable |
| Editing | none. No `contenteditable`, no listener that writes it |
| Refresh | text is replaced with `textContent`; the pane's `scrollTop` is captured before the write and restored after (the browser clamps it to the new height). The sync guard (§4.2) is held across the write **and** the restore, because the clamp fires a `scroll` event; it clears on the next frame, so neither side moves because of a refresh |
| Empty | only when the pane has no text node at all: `#hybrid-debug-source:empty::before { content: "Empty note"; color: var(--text-muted) }`. The selector is `:empty`, not a bare `::before`, or the word would paint over a full document |
| Error | one line, `⚠ Serialization failed: <message>` in `--danger` (the only red in the surface); a safety net for a thrown serializer, marked `unverified` |

Wrapping is deliberate: at 45% of the content area a Markdown paragraph line is
wider than the column, and a horizontal scrollbar inside a scrollable column is
a second, hidden navigation. Wrapping changes no byte; copying the text yields
the original line breaks. The exact bytes are the doc's promise, and newlines
survive wrapping; so does a scroll position, because the refresh restores it.

The empty state means **empty bytes**: a zero-byte document produces
`textContent === ""` and the `:empty` rule paints **Empty note**. A note holding
only blank lines serializes to `"\n\n"` — the splice returns the original bytes —
so the pane shows two blank lines and no word. That is accurate, not a bug; the
pane never invents a label for non-empty bytes. The word comes from CSS, never
from the pane's text, so copying an empty pane yields nothing.

### 3.4 Focus and keyboard

| Event | Result |
| --- | --- |
| `Tab` from the page | The pane's `<pre>` receives focus (its `tabindex="0"`), focus ring inset −2 px |
| `Arrow`, `PageUp/PageDown`, `Home/End` while focused | Native scroll of the pane; the page follows through the sync (§4.2), not by the viewer's key handler |
| A bare letter, `/`, or any chord the user has bound without a modifier, while focused | Nothing. No shortcut fires; the pane is not a typing target and the app must not treat it as the note |
| Typing while the pane has focus | Nothing. The pane has no editable surface |
| `Ctrl/Cmd+S` | Saves, as everywhere; the pane recomputes when the write returns (no keystroke since the capture: the written bytes) |
| `Ctrl/Cmd+E` | Exits hybrid, as everywhere; the pane closes with it |
| Click in the page | Caret returns to the page's own last position; the pane keeps its scroll |
| Closing while the pane has focus | Focus returns to the page with `preventScroll`, so the next keystroke edits the note and the page keeps its offset |
| Click a bar control | The shared bar handler keeps the page focused; the pane is unaffected |

Two existing key guards must learn about the pane, or the table above is false:
`viewerScrollTargetHasFocus()` (`viewer.js:1455-1462`) and
`typingTargetHasFocus()` (`shortcuts.js:355-362`) both return early only for
`isContentEditable`, `INPUT`, `TEXTAREA`, and `SELECT`, so a focused `<pre>`
looks like the note. Each gains one clause: `if (a.closest("#hybrid-debug-pane"))
return true;`. Without it the viewer's document-level scroll handler
(`viewer.js:1464-1481`) steals the arrows and scrolls the note, and the
document-capture shortcut dispatcher (`shortcuts.js:261`) fires `/`
(Search, `shortcuts.js:49-63`) and every bare key the user has bound while
the user is reading. Modifier chords
(`Ctrl/Cmd+S`, `Ctrl/Cmd+E`) keep working because the dispatcher's typing guard
applies only to modifierless chords (`shortcuts.js:311-320`).

No new keyboard shortcut. A shortcut is proposal P4.

### 3.5 No motion

Opening and closing are instant. No transition, no slide, no fade: this is a
diagnostic split, and a moving column would shift the caret's visual position
twice.

## 4. Layout and geometry

### 4.1 The split

| Element | Rule |
| --- | --- |
| `#edit-split.hybrid-debug` | `flex-direction: row` |
| `#viewer` in that state | `flex: 1 1 55%` (the base rule is `1 1 auto`, `style.css:2731-2745`), `min-width: var(--shell-reader-min)` (352 px, `style.css:286`) |
| `#hybrid-debug-pane` | `flex: 1 1 45%`, `min-width: 0`, `display: flex; flex-direction: column`, `border-left: 1px solid var(--border)`, `background: var(--bg-panel)`, `min-height: 0` |
| The pane's `<pre>` | `flex: 1 1 auto`, `min-height: 0` |
| The page's inline padding | `16px 24px var(--viewer-tail)` — the same inset the source split uses (`style.css:2931-2933`), so the reader keeps its column |

Not equal halves. The page keeps the shell's reader floor (`--shell-reader-min`,
352 px) and the larger share; the pane takes the rest. At 1280 that is 424 / 347,
at the 1140 px breakpoint 352 / 280 — enough for the source to wrap readably.
Source mode's own split is 50/50 (`style.css:2918-2934`); it has no reader floor,
because its left column is a code editor. The two states are mutually exclusive —
`.split` is source mode, `hybrid-debug` is hybrid — and the class is removed on
exit.

`#hybrid-debug-pane[hidden] { display: none; }` is required for the same reason
`#viewer[hidden]` is (`style.css:2755`): the component's own `display: flex`
outranks the UA's `[hidden]` rule.

### 4.2 Scroll

The two columns scroll in sync, proportionally, while the pane is open. This is
the same rule source mode already applies between its editor and its preview
(`viewer.js:557-586`): two forms of one document, so a percentage of one maps to
the same percentage of the other. It is not line-accurate — rendered blocks and
wrapped lines have different heights — and it is not meant to be; it keeps the
neighbourhood visible.

| Item | Rule |
| --- | --- |
| Direction | Both. Scrolling the page moves the pane; scrolling the pane moves the page |
| Mapping | `target.scrollTop = (source.scrollTop / sourceMax) * targetMax`; do nothing when either side has no scrollable height |
| Guard | One module-local flag, set before the write and cleared on the next animation frame, so the echoed `scroll` event cannot re-trigger (the source-mode pattern) |
| Listeners | Bound in `setDebugPane(true)`, passive, on `#viewer-scroll` and `#hybrid-debug-source`; removed in `setDebugPane(false)` |
| Refresh | A refresh does **not** scroll either side. It holds the guard across the `textContent` write and the `scrollTop` restore (the clamp fires a `scroll` event), then releases it on the next frame; the next user scroll re-syncs |
| Narrow / hidden | If the pane is not rendered (`display: none`), the page's scroll does nothing; the pane's height is 0, so the mapping is skipped |
| Focus | Arrow/Page keys with the pane focused scroll the pane, which moves the page through the same mapping |

The source-mode sync stays untouched: its functions are module-private in
`viewer.js`, bound only in `.split`. Hybrid keeps its own pair.

### 4.3 Breakpoint

| Viewport | Toggle | Pane |
| --- | --- | --- |
| ≥ 1140 px, hybrid active | visible | available |
| < 1140 px | hidden (`display: none`) | hidden; `#edit-split` stays a column |
| Any phone mode | hidden — phone is ≤ 1023 px | hidden |

One media query owns it. The selectors are deliberately the same or stronger
than the rules they override:

- `#edit-bar #hybrid-debug-btn` is (2,0,0); `#edit-bar .eb` at `style.css:791`
  is (1,1,0), so two ids beat it regardless of order.
- `#hybrid-debug-pane` ties (1,0,0) with the pane's base rule, so the media block
  must come **after** that base rule.
- `#edit-split.hybrid-debug` ties (1,1,0) with the state rule in §4.1, so the
  media block must come after it too.

```css
@media (max-width: 1139px) {
  #edit-bar #hybrid-debug-btn { display: none; }
  #hybrid-debug-pane { display: none; }
  #edit-split.hybrid-debug { flex-direction: column; }
}
```

The rules land as one new section **appended at the end of `style.css`** (after
the current last rule), with the `@media` block last in that section. Appending
to an earlier block such as the phone shell would leave the base rules below it
free to win. A single-id selector such as `#hybrid-debug-btn { display: none }`
would lose to `#edit-bar .eb` — id-only is (1,0,0), the bar's rule is (1,1,0).

The number is derived, not borrowed: the default shell spends 48 (rail) + 240
(side panel) + 220 (outline) = 508 px on chrome, and the split needs 352
(`--shell-reader-min`) + 280 (a readable source column) = 632 px of content.
508 + 632 = 1140. The default layout is what the number assumes; the panels are
resizable and collapsible, so a user who widens the outline shrinks the pane —
never the page, whose floor wins.

Between 861 and 1139 px on a fine pointer the desktop shell is live and hybrid
mode works, but this control is absent. That is a deliberate gap, not the phone
rule: the phone mode switch is `max-width: 860px` or a coarse pointer at
`max-width: 1023px` (foundations §8.2), and a fine-pointer 900 px window is
desktop. §6 names the row.

The state survives a resize: narrow the window and the pane disappears; widen it
and the pane is still open. Nothing is persisted either way.

The button's `[hidden]` attribute is separate: `#edit-bar .eb[hidden]
{ display: none; }` (`style.css:1366`) is what lets JS keep the control out of
source mode, and the media query is what keeps it out of the narrow window even
when `hidden` is false.

## 5. Tokens

No new tokens. Every value is a foundation token or a measured literal from the
existing edit bar.

| Value | Token | Source |
| --- | --- | --- |
| Pane face | `--bg-panel` | `foundations.md`; `style.css:6`, `:119` |
| Header face | `--bg-elev` | `style.css:7`, `:120` |
| Seam | `--border` | foundations |
| Body / title text | `--text-primary` | `style.css:93`, `:165` |
| Hint text | `--text-muted` | `style.css:94`, `:166` |
| Pressed toggle | `--accent`, `--accent-soft` | foundations |
| Error | `--danger` | foundations |
| Mono | `--font-mono` | `style.css:195` |
| Body size / line | `--text-sm`, `--lh-snug` | `style.css:211`, `:224` |
| Header title / hint size | `--text-xs` (.72rem), `--lh-tight`; the label role's 600 and 400 variants | `style.css:210`, `:221`; `typography.md` §2 |
| Toggle glyph | `--icon-md` (16 px); the control carries no text | `style.css:281`; `foundations.md` §9.1 |
| Spacing | `--space-2` (8) header gap; `--space-3` / `--space-4` (12/16) pane padding | `style.css:232-234` |
| Radius | `--radius-xs` (4) on the toggle; the pane is square | `style.css:240` |
| Focus | toggle +1 px (shipped); pane `--focus-offset-inset` (−2 px) | `style.css:9231-9233`, `:298-299` |
| Pane width | `flex: 1 1 45%`; page floor `--shell-reader-min` | `style.css:286`; §4.1 |
| Header height | 26 px | the edit bar's control height, `style.css:797` |

## 6. States matrix

| State | Toggle | Pane | Page | Notes |
| --- | --- | --- | --- | --- |
| Hybrid, closed (default) | split glyph, unpressed, muted | hidden, class off, text empty | full width | every entry path |
| Hover | soft face, primary glyph | — | — | pointer only |
| Active (held) | soft face in both states, accent glyph | — | — | overrides the bar's filled-accent `:active` |
| Hybrid, open | split glyph, pressed | header + text | 55%, editable | refresh on the idle pass |
| Open, long content | pressed | scrolls; sync keeps the page's neighbourhood | scrolls | §4.2 |
| Pane focused | pressed | inset ring on the `<pre>` | — | `Tab` from the page |
| Open, empty note | pressed | header + **Empty note** | 55% | the `:empty::before` text is not bytes |
| Open, serializer failed | pressed | header + red error line | 55%, editable | safety net, unverified |
| Open, save in flight | pressed | the last refreshed text; recomputed from the DOM when the write returns | 55% | with no keystroke since the capture, the recomputation equals the file; with one, the pane stays on the newer DOM |
| Open, rebuild after a mismatch | pressed | rebuilt serialization | rebuilt page | scroll offsets kept by their owners |
| Source mode or preview | absent | hidden | full width | the button is `hidden`; the pane is closed on exit |
| Viewport < 1140 px | absent | hidden | full width | state kept for a widen |
| Fine pointer, 861–1139 px | absent | hidden | full width | desktop shell, hybrid works, no debug surface (§4.3) |
| Phone | absent | hidden | phone layout | the phone bar has no second column |
| Exiting hybrid | reset | closed and cleared | full width | all exit paths |
| Disabled / busy | never; the toggle is always actionable while hybrid is on | — | — | there is nothing to wait for |

## 7. Accessibility

| Item | Contract |
| --- | --- |
| Roles | `button` with `aria-pressed`; `region` on the pane |
| Name | button: "Show the Markdown source"; pane: "Markdown source, read-only" |
| Relationship | `aria-controls="hybrid-debug-pane"` |
| Focus order | edit bar controls, then the page, then the pane; the pane is reachable by `Tab` |
| Focus visible | toggle: the bar's +1 px ring (`style.css:9231-9233`); pane: inset ring, `--focus-offset-inset`, because `#edit-split { overflow: hidden }` (`style.css:2916`) clips an outset ring |
| Live updates | **no** `aria-live`: the pane changes on every idle pass, and announcing a whole document per keystroke is noise. The toggle's `aria-pressed` is the state signal |
| Contrast | `--text-primary` on `--bg-panel` and `--text-muted` on `--bg-elev` are foundation pairs already in use. The pressed glyph is `--accent` on `--accent-soft` (≈4.2:1 in dark), above the 3:1 component floor; the state is also carried by `aria-pressed`, never colour alone |
| Zoom | both columns reflow; the pane wraps at every zoom because it has no fixed line width |
| Motion | none; `prefers-reduced-motion` needs no rule |

## 8. Exceptions

None. The control reuses the edit bar's recorded 26 px exception; the pane is
new surface, so its geometry is spec, not a delta. No existing pixel changes.

## 9. Proposals, not applied

| # | Proposal | Why not v1 |
| --- | --- | --- |
| P1 | Show a diff against the on-disk baseline, highlighting changed blocks | Needs a diff engine, a second scroll model, and a decision about what "changed" means for a spliced save |
| P2 | A draggable divider between the columns | A new drag surface with its own persistence; the derived ratio is enough to start |
| P3 | Line numbers in the gutter | Markdown has no stable line identity across a splice; numbers would mislead |
| P4 | A keyboard shortcut for the toggle | The bar is the only entry the request names; a chord needs the shortcut table and a conflict review |
| P5 | Persist the toggle in `config/config.json` | The product spec makes it session state (D4); a debug view should not surprise the next session |
| P6 | Scroll the pane to the block clicked in the page | Needs a block→byte map that the serializer does not expose today |

## 10. Acceptance criteria

| # | Criterion | File / proof |
| --- | --- | --- |
| AC1 | The toggle is a 26 px `.eb` showing `#nb-icon-split` at 16 px, placed after `Tx` in its own separator group | `templates/index.html:502-508`; `tests/dom/test_dom.js` |
| AC2 | Pressed: `--accent-soft` face, `--accent` border and glyph; rest: transparent and muted; held-down: the soft face, never the bar's filled accent | `static/css/style.css`; inspection |
| AC3 | The pane is a sibling of `#viewer` inside `#edit-split`, never inside `#viewer-content` | `tests/dom/test_dom.js` asserts `#viewer-content.contains(pane) === false` |
| AC4 | Header 26 px; title **MARKDOWN** at the label role 600; hint `what Save writes` at 400 | `tests/dom/test_dom.js`; `hybrid-markdown-debug-pane-mockup.html` board B |
| AC5 | Body: mono `.8rem`/1.35, `pre-wrap`, vertical scroll only, padding 12/16/16 | `static/css/style.css`; `tests/browser/test_hybrid_browser.js` computed style |
| AC6 | A zero-byte document shows **Empty note** from the `:empty` rule; a blank-lines-only document shows `"\n\n"`, not the word | `tests/dom/test_dom.js`: `textContent === ""`, `childNodes.length === 0`, and the blank-lines fixture |
| AC7 | A thrown serializer shows one red line and editing still works — **unverified** (inspection only; the module has no seam to force a throw) | `docs/architecture/hybrid-editing.md` §5.8 Failure; inspection |
| AC8 | The pane is focusable, shows the inset ring, and `Arrow`/`Page` scroll the pane; the page follows proportionally | `tests/browser/test_hybrid_browser.js` |
| AC9 | Open: a row split where the page keeps ≥352 px and the pane takes the rest; closed: full-width column | `tests/browser/test_hybrid_browser.js` measures `#viewer-content` clientWidth at 1280 and 1140 |
| AC10 | At 1139 px neither the toggle nor the pane is visible; at 1140 the toggle is visible and the split fits | `tests/browser/test_hybrid_browser.js` at both widths (media queries do not run in jsdom) |
| AC11 | Button and pane carry the roles, names and `aria-controls` above | `tests/dom/test_dom.js` |
| AC12 | No transition on the pane or the toggle | `static/css/style.css`; inspection |
| AC13 | The pane's text is selectable and copyable (native `<pre>` text; nothing overrides selection) | inspection |
| AC14 | The page's scroll offset survives a toggle (open and close do not scroll it) | `tests/dom/test_dom.js`; `tests/browser/test_hybrid_browser.js` |
| AC15 | A refresh keeps the pane's own `scrollTop` (clamped to the new content) | `tests/browser/test_hybrid_browser.js` (jsdom stores `scrollTop` without layout) |
| AC16 | A bare `/` with the pane focused does not open Search | `tests/browser/test_hybrid_browser.js` keyboard pass |
| AC17 | Scrolling either column moves the other to the same relative position, in both directions, with no echo loop | `tests/browser/test_hybrid_browser.js` (jsdom has no scrollable height) |
| AC18 | A refresh does not jump either column: the pane keeps its own offset and the page does not move | `tests/browser/test_hybrid_browser.js` |
| AC19 | Closing the pane unbinds both scroll listeners and clears the text | `static/js/hybrid.js` `setDebugPane`; inspection (the close path removes both) |
| AC20 | The reader floor holds while the pane is open: `#viewer-content` clientWidth ≥ 352 px at 1140 and 1280 | `tests/browser/test_hybrid_browser.js` |
| AC21 | Closing the pane while it has focus returns focus to `#viewer-content` and does not scroll the page | `tests/dom/test_dom.js`; `tests/browser/test_hybrid_browser.js` close check |

## 11. What not to build

- Do not reuse `.split` (source mode's class) or its private scroll-sync functions; hybrid keeps its own pair.
- Do not put the pane inside `#viewer-content`, not even as a `position: fixed`
  overlay: it would be serialized.
- Do not render the pane with `innerHTML` from the Markdown. `textContent` only;
  untrusted bytes must never become nodes.
- Do not add an Apply, an edit mode, or a toolbar inside the pane.
- Do not add `aria-live`, line numbers, or a diff.
- Do not put a keydown handler on the pane that calls `stopPropagation`: the
  shortcut dispatcher listens in the capture phase and runs first. Fix the two
  focus guards named in §3.4 instead.
- Do not persist the toggle.
- Do not change the serializer, the splice, the render check, or the undo
  history to serve this view. It observes; it never participates.
