# Search panel — clear control

Design handoff for a mouse/touch **clear ×** on the side-panel Search query
field. Small, precise addition to the current surface. No redesign.

- **Surface:** `#search-view`, built by `mountSearch()` in `static/js/activity.js`
  (input row at `activity.js:440-471`). Styles: `static/css/style.css`,
  "Search view (side panel)" (`~3876`), phone block (`~6151`).
- **Reference mockup:** `docs/design/search-panel-clear.html`.
- **Status:** implemented in `activity.js` / `style.css`; covered by the jsdom
  and core/mobile browser suites.

**Why a new mockup file.** `docs/design/search-panel.html` documents an earlier
layout (a panel-padded input row with an **Options** disclosure and a
"All matches / One per file" segmented row) that no longer matches
`mountSearch()`. The current reference is `search-panel-advanced.html`. Adding
the × to the old mockup would document obsolete markup, so this handoff ships
the focused `search-panel-clear.html`, built on today's anatomy: input row, Advanced row (which now holds match case), filters, summary, results.

---

## 1. Decision summary

| Item | Decision |
| --- | --- |
| Placement | **× inside the input's right edge**, absolutely positioned in a wrapper. Not a sibling button. |
| Visibility | Show only when `input.value.trim() !== ""`. Hide with the `hidden` attribute (leaves tab order and a11y tree). |
| Empty / whitespace-only | Hidden. The input keeps the same reserved right padding, so nothing shifts. |
| Desktop size | Button 22×22, icon 12×12, 5 px inset, 32 px reserved text slot. |
| Phone size | Button 44×44 (`--m-hit`), icon 14×14, 1 px inset, 48 px reserved slot. |
| Focus order | input → × → Advanced toggle. `Aa` lives inside Advanced when it is open. Input keeps focus after clearing. |
| Native cancel | Hide `::-webkit-search-cancel-button` / `-webkit-search-decoration`; the custom × is the only one. Firefox has no native control. |

---

## 2. Placement — why inside the field

The input row is a single flex child inside a 240 px panel with 10 px side
padding, so the field gets the full width. A **sibling** clear button would add
22 + 5 = 27 px on desktop (44 + 5 = 49 px on the phone) and steal that space
from the query. Placing the × **inside** the input's right edge:

- costs no row width — it overlays the field's own padding;
- matches the platform convention for search fields (the native affordance sits
  inside too);
- leaves the field full-width after the case toggle moved into Advanced;
- scales to the phone without narrowing the query.

Trade-off: the input needs a wrapper for positioning and a reserved right
padding. That is a two-line markup delta and no visual change when the × is
hidden.

---

## 3. Markup

Wrap only the input. The case toggle now lives in the Advanced panel, not in
this row.

```html
<div class="search-panel-input-row">
  <div class="search-panel-input-wrap">
    <input type="search" class="search-panel-input"
           placeholder="Search notebooks…" aria-label="Search notebooks">
    <button type="button" class="search-panel-clear"
            aria-label="Clear search" title="Clear search" hidden>
      <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <path d="M2.5 2.5 9.5 9.5M9.5 2.5 2.5 9.5"
              fill="none" stroke="currentColor" stroke-width="1.5"
              stroke-linecap="round"/>
      </svg>
    </button>
  </div>
</div>
```

- `type="button"` — never submits (there is no form, but this is defensive).
- The button follows the input in DOM order, so tab order matches left-to-right
  visual order: **input → ×**, then the Advanced toggle.
- The SVG is decorative (`aria-hidden`, `focusable="false"`); the button carries
  the accessible name. Use a drawn cross, not the `×` character, so the glyph is
  identical in every font and centres by geometry rather than baseline.
- The wrapper is a new flex child; the input's existing
  `flex: 1 1 auto; min-width: 0` moves to the wrapper and the input becomes
  `width: 100%`.

---

## 4. Visibility rule

Show iff the **trimmed** value is non-empty:

```js
clearBtn.hidden = input.value.trim() === "";
```

| Input value | × | Search behaviour |
| --- | --- | --- |
| `""` | hidden | idle; no request |
| `"   "` | hidden | idle; no request (matches today's `trim()` guard) |
| `"fix"` or `" fix "` | shown | 250 ms debounce → request |

- Use the **`hidden` attribute**, not `visibility`/`opacity`: it removes the
  button from the tab order and the accessibility tree, and prevents a
  whitespace-only query from offering a no-op control.
- Update visibility from the input handler, after Esc, after a clear, and at
  mount. One `syncClear()` helper owns the rule.
- **No layout shift:** the button is absolutely positioned and the input's right
  padding is constant (`var(--search-clear-slot)`), whether or not the × is
  painted. The placeholder therefore has less room than before on every state,
  but the field geometry never changes when the × appears.
- Do not animate visibility. A fade would delay the control and add motion for
  no information.

---

## 5. Dimensions and spacing

Add these tokens to `#search-view` beside the existing `--search-*` block:

```css
#search-view {
  --search-clear-btn: 22px;    /* square hit box */
  --search-clear-inset: 5px;   /* gap from the field's inner right edge */
  --search-clear-slot: 32px;   /* input padding-right, always reserved */
  --search-clear-icon: 12px;   /* drawn cross */
}
```

| | Desktop | Phone (≤ 860 px, or coarse + ≤ 1023 px) |
| --- | --- | --- |
| Input height | 32 px (`--search-control-h`) | 44 px (`--m-hit`) |
| Button box | 22 × 22 | 44 × 44 |
| Icon | 12 × 12 | 14 × 14 |
| Right inset | 5 px | 1 px |
| Reserved slot (`padding-right`) | 32 px | 48 px |
| Text-to-glyph gap | 5 px | 3 px |
| Radius | `--search-radius-sm` (4 px) | 8 px (matches phone inputs) |

Phone overrides — add the four tokens to the existing `#search-view` block
inside the phone media query, next to `--search-control-h: var(--m-hit)`, and
widen the button radius there:

```css
#search-view {
  --search-clear-btn: var(--m-hit);   /* 44 */
  --search-clear-inset: 1px;
  --search-clear-slot: 48px;
  --search-clear-icon: 14px;
}
.search-panel-clear { border-radius: 8px; }
```

On the phone the 44 px target fills the 44 px field (the 1 px inset absorbs the
border), so no extra row height is introduced. The reserved 48 px is affordable
in the phone drawer and is the price of a real 44 px target.

The text slot is computed from the same side as the button. For RTL support use
`inset-inline-end` / `padding-inline-end`; the app is LTR-only today, so the
spec uses `right` / `padding-right`.

---

## 6. CSS (normative)

```css
.search-panel-input-wrap {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
}

.search-panel-input {
  flex: 1 1 auto;
  min-width: 0;
  width: 100%;
  padding-right: var(--search-clear-slot);
}

.search-panel-clear {
  position: absolute;
  top: 50%;
  right: var(--search-clear-inset);
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--search-clear-btn);
  height: var(--search-clear-btn);
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--search-radius-sm);
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  transition: background .12s ease, color .12s ease, border-color .12s ease;
}
.search-panel-clear[hidden] { display: none; }
.search-panel-clear svg {
  display: block;
  width: var(--search-clear-icon);
  height: var(--search-clear-icon);
}
.search-panel-clear:hover {
  color: var(--fg);
  background: var(--accent-soft);
}
.search-panel-clear:active {
  color: var(--fg);
  background: var(--accent-soft);
  border-color: var(--accent);
}
.search-panel-clear:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

Do **not** put the `:focus-visible` ring on the input wrapper and do not touch
the input's existing focus rules. The input's accent border stays as it is.

---

## 7. Theme tokens and states

All colours already exist; no new palette.

| State | Glyph | Background | Border | Notes |
| --- | --- | --- | --- | --- |
| Default | `--fg-muted` | transparent | transparent | dark `#8b8d98` on `#1a1b1f` = 5.2:1; light `#5d6470` on `#ffffff` = 6.0:1. Above the 3:1 non-text minimum. |
| Hover | `--fg` | `--accent-soft` | transparent | 13.8:1 dark / 15.7:1 light. |
| Active / pressed | `--fg` | `--accent-soft` | `--accent` | One-frame feedback. The border reads as a pressed key without a new colour. |
| Focus-visible | inherits | transparent | — | `outline: 2px solid var(--accent); outline-offset: 2px`. On the phone the ring extends 2 px past the field; the panel's 8 px padding absorbs it, and the wrapper must not clip. |
| Disabled | not used | — | — | The control is hidden when there is nothing to clear; never render it disabled. |

The input's `background` is `--bg`; the hover fill (`--accent-soft`) is tuned for
both themes in the existing tokens, so the × reads as part of the field rather
than a floating chip.

---

## 8. Native `input[type="search"]` cancel button

Hide the user-agent decorations so the custom × is the only one:

```css
.search-panel-input::-webkit-search-cancel-button,
.search-panel-input::-webkit-search-decoration,
.search-panel-input::-webkit-search-results-button {
  -webkit-appearance: none;
  appearance: none;
}
```

Facts and caveats:

- **Chromium / Edge / Safari** render a native ✕ inside `input[type=search]`
  once it has a value (and sometimes a magnifier/decoration). Both would sit in
  the same corner as the custom control. Hide them.
- **Firefox** does not render a search cancel control at all (there is no
  `::-moz-search-cancel-button`). The custom × is mandatory on Firefox, which is
  the reason the design cannot lean on the native affordance.
- Keep `type="search"` for semantics; do **not** set `appearance: none` on the
  input itself — only reset the webkit pseudo-elements. Resetting the input can
  remove the rounded search-field metrics on some engines.
- Hiding is unconditional. If JS ever fails to build the panel, there is no
  visible ×; Esc still clears the field, and the app is JS-rendered end to end,
  so this is accepted.
- Chromium's native cancel has its own padding. Hiding it returns that space to
  the text, which is why the reserved slot must be tested after the reset (the
  input's own `padding-right` is the only right padding).

---

## 9. Keyboard and screen-reader behaviour

- **Focus order:** input → clear × → Advanced toggle (then `Aa` inside Advanced
  when it is open). The button sits between the input and the Advanced toggle in
  the DOM, so no positive `tabindex` is needed.
- **Name:** `aria-label="Clear search"`. The SVG is hidden. A `title` of the same
  text is optional; it must not carry an "Esc" hint, because Esc only clears
  while the input itself has focus.
- **Activation:** native `<button>`; Enter and Space both fire `click`. Do not
  add key handlers and do not `preventDefault` on the key events.
- **Focus stays in the input.** Two parts:
  1. `pointerdown` → `preventDefault()` so a mouse/touch press does not move
     focus off the input (and, on the phone, does not dismiss the soft
     keyboard).
  2. The `click` handler clears, then calls `input.focus()` so keyboard
     activation from the button also returns focus to the field.
- **Never hide a focused element.** The clear routine hides the ×; it must set
  `hidden` and then focus the input synchronously, in that order, so focus never
  drops to `document.body`. Because focus moves to the input, the next `Tab`
  goes to the clear × (when it is still mounted) and then the Advanced toggle.
- After clearing, the input is empty and its accessible name/placeholder still
  describe it. Do not move focus to the results list and do not announce a
  separate "cleared" message; the empty field is the feedback.
- Esc continues to behave exactly as today (clear, stay focused, no request)
  and must also run `syncClear()` so the × disappears.

---

## 10. Behaviour and debounce

The clear control must reproduce the empty-input and Escape path exactly:

```js
function syncClear() {
  clearBtn.hidden = input.value.trim() === "";
}

function clearQuery() {
  input.value = "";
  setIdle();   // cancels the debounce, bumps requestToken, empties summary/list
  syncClear();
}

clearBtn.addEventListener("pointerdown", (e) => e.preventDefault());
clearBtn.addEventListener("click", () => {
  clearQuery();
  input.focus();
});

input.addEventListener("input", () => {
  syncClear();
  clearTimeout(debounceTimer);
  if (!input.value.trim()) { setIdle(); return; }
  debounceTimer = setTimeout(runSearch, 250);
});
```

Rules the implementer must preserve:

1. **No new request.** `clearQuery()` never calls `runSearch`, and it must **not**
   dispatch an `input` event (that would re-enter the input handler and
   schedule a search). Reuse `setIdle()`, which already clears `debounceTimer`
   and increments `requestToken`.
2. **Pending debounce is cancelled.** Type, then press × inside 250 ms → no
   `/api/search` call. `setIdle()`'s `clearTimeout` handles this.
3. **In-flight response is discarded, not aborted.** If a request had already
   fired, the token bump makes its `.then` a no-op. The network request cannot
   be un-sent; the panel stays idle.
4. Escape should call the same `clearQuery()` (then no extra focus call — the
   input already has focus) instead of duplicating the value/idle writes.
5. **Filters are not reset.** Case, target, grouping, and sort keep their
   values and remain persisted. Clearing only clears the query.
6. **Advanced stays open** if it was open; collapse is unrelated. The × sits
   above the Advanced row and never overlaps the filters.
7. The × reflects the value, not the result state: it is visible while a request
   is loading, after "No matches", and after an error, as long as the trimmed
   value is non-empty.
8. Mount with `syncClear()` after appending, so the initial `hidden` attribute
   and the value agree.

---

## 11. Reduced motion

The only motion is the 120 ms colour/background transition, the same duration
the `Aa` toggle uses. Under `prefers-reduced-motion: reduce`, disable it:

```css
@media (prefers-reduced-motion: reduce) {
  .search-panel-clear { transition: none; }
}
```

Do not add a scale/pop animation, so there is nothing else to reduce.

---

## 12. Interaction with the rest of the view

- **Empty / idle state:** identical to today's `setIdle()` result — blank
  summary, hidden note, empty list. No new "start typing" copy is introduced by
  this control; the input placeholder is the only guidance.
- **Whitespace-only:** the × is hidden even though the field visually contains
  characters. This is deliberate: that state is already treated as empty
  (`trim()`), and offering a clear button for it would imply a search is active.
- **Advanced / filters:** untouched by clearing. Results after the next query
  still use the current filter state. The Advanced summary/badge do not change.
- **Aa:** independent. Toggling case with an empty query stays idle; toggling it
  with a query re-runs as today. The × never toggles case.
- **Phone drawer:** the control works in the off-canvas drawer and the reserved
  slot is part of the input's width, so the row does not overflow.

---

## 13. Acceptance criteria

DOM / layout

1. `#search-view` contains
   `div.search-panel-input-wrap > input.search-panel-input` and
   `button.search-panel-clear[type="button"][aria-label="Clear search"]`,
   followed by `label.search-panel-case`.
2. On mount the button has the `hidden` attribute. It is hidden for `""` and
   `"   "`; it is visible for `"fix"`, `" fix "`, and `"a"`.
3. The input's client width and position are identical with the × hidden and
   visible (no layout shift).
4. The input's computed `padding-right` is 32 px desktop / 48 px phone in both
   visibility states; a full query never renders under the glyph.
5. The button's box is 22×22 desktop and 44×44 on the phone; the icon is
   12 px / 14 px.

Behaviour

6. Clicking × sets `input.value` to `""`, clears the summary, note, and list
   (`setIdle()` result), and leaves `document.activeElement === input`.
7. Type a query and click × within 250 ms: `fetch` is never called with
   `/api/search`.
8. With a response in flight, clear: the late response does not repopulate the
   list or summary.
9. Esc with a non-empty query has the same result and also hides the ×.
10. Clearing while Advanced is open leaves it open and leaves the filter
    controls' values unchanged (including `Aa`).
11. Clearing does not dispatch an `input` event and does not call `runSearch`.

Keyboard / accessibility

12. Tab order is input → × → Advanced toggle; `Aa` follows inside Advanced when it is open. Shift+Tab reverses it.
13. Enter and Space on the focused × clear the field and focus the input.
14. The × shows a 2 px `--accent` outline with 2 px offset under
    `:focus-visible` in both themes.
15. The accessible name is exactly "Clear search"; the SVG is not announced.
16. Hiding the × while it is focused moves focus to the input, never to the
    document body.
17. Icon contrast is ≥ 3:1 in both themes (measured: 5.2:1 dark, 6.0:1 light).

Native / mobile

18. In Chromium/Edge/Safari, exactly one × is visible in a populated field
    (the webkit cancel button resolves to none); in Firefox, the custom × is the
    only one.
19. At ≤ 860 px (or coarse + ≤ 1023 px) the field is 44 px tall and the × is a
    44 px touch target.
20. Tapping × on the phone keeps the input focused and does not dismiss the
    soft keyboard.

---

## 14. Files the implementer changes

- `static/js/activity.js` — the wrapper + button in `mountSearch()`, plus
  `syncClear()` and `clearQuery()`; reuse them from the input and Escape
  handlers.
- `static/css/style.css` — the four `--search-clear-*` tokens, the wrapper, the
  button states, the native-cancel reset, and the phone overrides; add the
  button to the existing reduced-motion block.
- `tests/dom/test_dom.js` — add the acceptance checks for visibility, no
  request on clear, focus return, and tab order (optional but recommended;
  the harness already stubs `/api/search`).
