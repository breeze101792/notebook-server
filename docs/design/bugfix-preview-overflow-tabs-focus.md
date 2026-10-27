# Preview Overflow, Settings Focus, Tab Strip

Design handoff for the three Chromium-pass findings: clipped long tokens (F1),
focus left behind the Settings dialog (F2), and an active tab that scrolls out
of view (F3). Status: design only. Behaviour is fixed by
`docs/product/bugfix-preview-overflow-tabs-focus.md` (D1–D13); ownership is
`docs/architecture/bugfix-preview-overflow-tabs-focus.md`. Mockup:
`docs/design/bugfix-preview-overflow-tabs-focus.html`.

---

## 1. Long-token treatment (F1)

The column is 932px at 1440px while content measured 2394px: no rule sets
`overflow-wrap`, so the UA default `normal` holds and `overflow-x: hidden`
(`style.css:2427`) clips the overflow. Rule: **prose wraps, code and tables
scroll in their own boxes**; the source and copied string never change.

| Content | Behaviour | Why |
| --- | --- | --- |
| Body prose | Wrap; a token wider than the line breaks inside itself | The reading surface must never clip text. |
| Inline code | Wrap like prose; each fragment keeps its own frame | Read like a word; an inline scroll box would break the line box and selection. |
| Bare URL | Wrap; the full URL stays readable and clickable | The tail is the part the user needs; one anchor may span two lines. |
| Markdown link | Wrap (label, and the URL export prints after it) | One anchor, two line fragments; the target never changes. |
| Headings | Wrap; a long token breaks inside itself | An unbreakable heading token would clip under the h1 rule line. |
| Table cells | No wrap; the table widens and scrolls in its own box (unchanged) | Cell values are data; `anywhere` would shrink the table and silently retire its scroller. |
| Fenced code | No wrap; local horizontal scroll (unchanged) | Whitespace and column alignment are semantic in code. |

```css
/* Inherited by p, li, a, inline code, and headings. break-word does not
 * affect min-content, so the two scrollers keep their sizing. */
#viewer-content.markdown-body { overflow-wrap: break-word; }
#viewer-content.markdown-body code { box-decoration-break: clone; }
```

`overflow-x: hidden` and the hybrid `overflow-x: auto` override stay. `pre`
keeps `white-space: pre` and its scroll. **No soft-wrap indicator**: link
colour and the code frame carry continuity; a pseudo-element would be copied
into URLs; a hyphen would invent a character. `export.js`'s `markdownCss`
(~776) needs the same rule.

---

## 2. Settings focus (F2)

**Ring.** One composite token, colour reused from the palette:

```css
#settings-overlay { --stg-focus-ring: 2px solid var(--accent); }
#settings-overlay .settings-modal :focus-visible {
  outline: var(--stg-focus-ring); outline-offset: 1px;
}
```

The four scoped rules hard-coding `2px solid var(--accent)` (buttons `:1591`,
switches `:1651`, chips `:1700`, nav `:2020`) switch to it; the catch-all also
covers `.icon-btn`, which has no focus state today.

**On open.** Focus goes to `#settings-close`. It is the first focusable in DOM
order and exists on every tab, so the landing point is deterministic.
Programmatic focus after a mouse click does not reliably match
`:focus-visible`, so `open()` also adds a short-lived `stg-initial-focus` class
(`outline: var(--stg-focus-ring); outline-offset: 1px`), focuses the button
with `preventScroll: true`, and clears the class on the first
keydown/pointerdown inside the dialog or on blur.

**Tab cycle.** With the background inert, the browser's order runs only inside
the overlay: Tab from the last visible control wraps to the first, Shift+Tab
from the first wraps to the last; hidden sections are out via `[hidden]`. The
helper also intercepts the edges explicitly, because Chromium otherwise moves
Tab to the browser chrome after the last control. The dialog container is the
default focus target (`tabindex="-1"`) and is excluded from the focusable
list, so the helper treats it as both ends of the cycle: Shift+Tab on it jumps
to the last control and Tab on it jumps to the first.

**Known limitation.** If a re-render removes the focused node and focus falls
to `BODY`, the helper does not move focus back: it has no `focusin` watcher.
Adding one was rejected as a global listener for a state the dialog cannot
observe through its own keydown. The re-render paths that could drop a focused
node are covered by the initial-focus and Tab-wrap guarantees — opening always
focuses a control inside the dialog, and the background is inert, so a single
Tab from `BODY` re-enters the dialog while Tab and Shift+Tab then stay inside.

**Background.** Every direct `<body>` child except `#settings-overlay` is
`inert` while it is open, restored on close; inert blocks pointer, keyboard,
and AT access, making `aria-modal="true"` true rather than aspirational.

How it reads: the backdrop keeps its `rgba(0,0,0,.5)` dim and nothing behind
it responds — no hover, caret, selection, or scroll — so the app reads as a
still frame of the shell, not a disabled form.

**Return focus.** `open()` saves `document.activeElement` (normally
`#activity-settings-btn`); every close path clears `inert` and restores focus
with `preventScroll: true`, falling back to the Settings gear if it is gone.

---

## 3. Tab strip (F3)

An 887px strip held 1584px of tabs; `render()` clears `innerHTML`, resetting
`scrollLeft`, and the scrollbar is hidden (`style.css:1231`).

**Reveal.** `render()` reads `listEl.scrollLeft` (and the pinned region's)
before clearing and writes both back after `applyFrozenWidths()` (the last
layout step, so frozen widths cannot clamp them). Then, on every `activate()`
— a changed tab, a re-activation of the already-active tab, or the boot
restore — reveal minimally, never with `scrollIntoView`:

```js
const b = listEl.getBoundingClientRect(), t = tab.getBoundingClientRect();
if (t.left < b.left) listEl.scrollLeft -= b.left - t.left;
else if (t.right > b.right) listEl.scrollLeft += t.right - b.right;
```

`getBoundingClientRect()` avoids the `offsetLeft` offset-parent trap
(`#tab-list` is not positioned; `#editor-pane` is). The tab lands flush, with
no centring or overshoot. `scroll-behavior: smooth` gives the short move a
slide; `prefers-reduced-motion: reduce` sets `auto`. A pinned active tab never
reveals; a hidden strip (`clientWidth === 0`) is a no-op.

**Manual scroll.** A non-activation render (dirty marker, conflict badge, ghost
close, watcher tick, pin/reorder) preserves the position exactly and never
reveals. Only an activation moves it — including clicking the active note
again after its tab was scrolled out of view.

**No edge fade, no chevrons.** The product contract keeps the hidden scrollbar
and forbids gradients and scroll buttons. The reveal removes the failure that
would motivate them: after every activation the active tab is whole, which is
the information the user was missing. A fade would dim the tab it just
revealed; a chevron would take 48px from a row whose tabs are the content.

**Active indicator.** The active tab keeps opaque `--bg` against `--bg-elev`
neighbours and its accent border on three visible sides. Reveal keeps it fully
inside; a manual half-scroll leaves its accent edge visible, and the next
activation re-reveals it. At the strip's end it is flush, never cut.

**Phone.** Unchanged: `#tab-bar` is `display: none` (`style.css:5868`); the
reveal and preserve code no-op at zero width.

---

## 4. Token delta

One new token; no new colour and no new size.

| Token | Value | Where |
| --- | --- | --- |
| `--stg-focus-ring` | `2px solid var(--accent)` | `#settings-overlay`; every focus ring in Settings, and the forced ring on `#settings-close` |

The prose fix adds no token: `break-word` and `clone` are keyword behaviours.
The tab strip adds none: no fade, no pad, no new colour.
