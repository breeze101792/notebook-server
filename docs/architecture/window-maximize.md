# Window maximize/restore — shared design

Status: implemented. Designed 2026-10-11 as a read-only analysis (owner:
`build`); the build landed Option A below, deleting the designer's private
maximize exactly as §6 specified. As-built anchors: `setMaximized` at
`windows.js`, `ensureMaxButton` at `windows.js`, the header
`dblclick` toggle at `windows.js`, the `hidden` `attributeFilter` at
`windows.js`, and the max CSS block at `style.css`.
Line anchors inside the design sections (§2-§8) are the 2026-10-11
snapshot and are not re-anchored.

Goal: give every modal window the maximize/restore control that the Mermaid
designer has today, and fold the designer-specific implementation into one
shared place.

## 1. Is window behavior already centralized?

**Yes — everything except maximize (at analysis time).** `windows.js` is the
single window module. Every modal in the app is an `.settings-overlay >
.settings-modal` pair and every one is wired by `wire()`
(`static/js/windows.js`), which injects the resize grip and the
maximize button, arms header drag, and applies persisted geometry:

| Modal | Created | Header contents | Wired by |
| --- | --- | --- | --- |
| Login `#auth-overlay` | static, `templates/index.html` | `<h2>` only — **no close button** | boot scan (`windows.js`) |
| Add-workspace `#workspace-dialog` | static, `index.html` — rendered only when `boot.workspace_id` is set | `<h2>` + close `icon-btn` | boot scan |
| New-session `#session-dialog` | static, `index.html` — same condition | `<h2>` + close `icon-btn` | boot scan |
| Settings `#settings-overlay` | static, `index.html` | `<h2>` + close `icon-btn` | boot scan |
| Export `#export-overlay` | static, `index.html` | `<h2>` + close `icon-btn`; footer separate | boot scan |
| Table editor `#table-editor-overlay` | static, `index.html` | `<h2>` + close `icon-btn` | boot scan |
| Designer `#designer-overlay` | static, `index.html` | `.designer-heading` + `.designer-header-actions` (`#designer-close`) | boot scan |
| Dot/WaveDrom designer `#dw-designer-overlay` | static, `index.html` | `.designer-heading` + `.designer-header-actions` (`#dw-close`) | boot scan |
| VIM `:help` `#vimnav-help` | dynamic, `static/js/vimnav.js` | `<h2>` + close `icon-btn` | MutationObserver (`windows.js`) |

Seven overlay modals are always present — login, Settings, Export, the
table editor, the Mermaid designer, the dot/WaveDrom designer, and the
dynamically created `:help` — and the two workspace dialogs join them
whenever `boot.workspace_id` renders them. A `role="dialog"` grep over
`index.html` counts eleven nodes: the eight static modal dialogs above
plus the phone capture sheet, the phone settings sheet, and the designer's
compact build sheet, which carry the role without being floating windows.
The context menus are not modals. Geometry persistence is also centralized
(`nb:windowGeometry`, keyed by overlay id — every overlay has one,
including `vimnav-help`).

At analysis time the one window behavior **not** in `windows.js` was
maximize: it lived only in `static/js/mermaid-designer.js`
(`setMaximized`/`toggleMaximized`, header `dblclick`, close-reset), its
markup `#designer-max`, and its CSS `.designer-modal--max` /
`.designer-max`. That was the duplication this design removed; all three
are gone from the shipped tree and the control is injected by
`ensureMaxButton` instead.

## 2. Decision

**Option A — inject the button in `windows.js`** (like `ensureGrip`), and delete
the designer's own button, logic, and CSS. Every wired modal acquires the
control with zero per-modal markup, and the existing MutationObserver gives it
to the dynamic `:help` modal for free.

Option B (per-modal markup + shared logic) is rejected: it is exactly the
duplication this task exists to kill — five markup edits now and one more for
every future modal, against one injection site in the module that already owns
window chrome.

Two supporting decisions:

- **Geometry: CSS class with `!important`** (generalize the designer's proven
  approach, style.css–4016). This is not a `!important` smell: the class
  overrides inline styles that `windows.js` itself writes — one module owns
  both sides. A JS-managed save/restore of inline geometry would need to
  intercept `applyGeometry` (windows.js–176 re-applies saved geometry on
  window resize), stash pre-max geometry, and re-clamp on restore — more state
  for zero benefit. With the class, a window resize while maximized simply
  writes inline styles the class outranks; on restore the untouched inline
  geometry takes over, already clamped to the new viewport. Correct for free.
- **State: transient, reset on close** — matches the designer's chosen behavior
  ("opens at its normal size next time", mermaid-designer.js) and avoids
  the surprise of a full-viewport Settings modal. Nothing is added to
  `nb:windowGeometry`.

## 3. Injection mechanism

New `ensureMaxButton(modal)`, called from `wire()` next to `ensureGrip()`
(windows.js):

- Idempotent: bail if `modal.querySelector(".win-max")` exists (same pattern as
  the grip guard, windows.js). The existing `dataset.windowsWired` guard
  (windows.js) prevents re-running `wire()` anyway.
- Placement rule, shape-agnostic, no aria-label string matching:
  **insert before the last `<button>` in the `.settings-header`; if the header
  has no button, append at the end.**
  - Settings / Export / `:help`: `[h2, max, close]` — max sits left of close.
  - Designer: the last header button is `#designer-close`, so max lands inside
    `.designer-header-actions` before it — the exact spot `#designer-max`
    occupies today.
  - Login: no close button by design; `justify-content: space-between`
    (style.css–1422) parks the appended button at the right edge.
- Button markup: `class="icon-btn win-max"`, `type="button"`,
  `title`/`aria-label="Maximize"`, `aria-pressed="false"`, carrying the two SVG
  glyphs reused verbatim from today's index.html–923 (`.win-max-icon`,
  `.win-max-restore`). The CSS swaps glyphs on `[aria-pressed="true"]` as
  style.css–4006 does today, under the renamed selectors.
- Uniform for all five modals — no skip list. The login modal is the only odd
  case (maximizing a three-row form is pointless but harmless); if it should be
  excluded later, a `data-windows-nomax` check in `ensureMaxButton` is a
  two-line addition. Do not build it now.

Shared state function in `windows.js` (generalizes
mermaid-designer.js–477): toggles class `settings-modal--max` on the modal
and swaps `aria-pressed` + `title`/`aria-label` Maximize/Restore on the button.

```mermaid
flowchart LR
  A[wire(modal)] --> B[ensureGrip]
  A --> C[ensureMaxButton]
  A --> D[header drag + dblclick toggle]
  A --> E[applyGeometry]
  C --> F{.win-max present?}
  F -- yes --> G[skip]
  F -- no --> H[insert before last header button / append]
  H --> I[click + dblclick toggle .settings-modal--max]
  I --> J[overlay hidden=true]
  J --> K[MutationObserver resets class + aria]
```

## 4. Interaction rules while maximized

- **Drag and resize are refused, not just visually hidden.** Guard the
  `pointerdown` handlers in `startDrag` (windows.js) and `startResize`
  (windows.js) with a maximized check. This is a real bug class, not
  polish: both `pointerup` handlers persist `geo[key]` from
  `getBoundingClientRect()` (windows.js–108, 137–138) — a gesture on a
  maximized modal would **overwrite the user's saved geometry with the
  full-viewport rect**. CSS `display: none` on the grip
  (generalize style.css) already blocks grip events; the JS guards cover
  the header and act as belt-and-braces.
- **Double-click header toggles**, moved from mermaid-designer.js–769 into
  `windows.js` (armed next to the drag wiring, once per header via the same
  `dataset.windowsDrag` guard). Keep the exemption: a dblclick whose target is
  inside a `<button>` does not toggle.
- **Esc / close / backdrop-click are untouched.** They are owned by each
  modal's module, and the keyboard guards (shortcuts.js, vimnav.js,
  table-select.js) key off `.settings-overlay:not([hidden])` — none of this
  changes.
- **Close resets the state.** The designer's `close()` calls
  `setMaximized(false)` directly (mermaid-designer.js); modules must not
  have to know about maximize (the windows.js decoupling contract,
  windows.js–12). Instead, extend the **existing** MutationObserver
  (windows.js–167) with `attributes: true, attributeFilter: ["hidden"]` and
  branch on `mutation.type === "attributes"`: when a `.settings-overlay`
  target becomes hidden, reset its modal's max class and the button's
  `aria-pressed`/labels. The filter is one `classList.contains` check; other
  `hidden` toggles (settings tab sections, `#export-error`) pass through it
  cheaply.
- **Window resize while maximized**: `applyGeometry` keeps running for all
  modals (windows.js–176); the `!important` class outranks what it writes,
  so the modal stays full-viewport, and on restore the re-clamped inline
  geometry applies.

## 5. Consistency and a11y

- `icon-btn` class — same chrome as every close button; `.win-max` adds only
  the glyph-swap rules. Designers' `.designer-max` styles
  (style.css–4006) rename, not duplicate.
- `aria-pressed` carries the state; `title` and `aria-label` swap
  Maximize/Restore on every toggle (the mermaid-designer.js–476 pattern).
- Keyboard: a real `<button>` — tab-reachable, Enter/Space operable.
  Maximize/restore becomes the only fully keyboard-operable window op (drag
  and resize stay pointer-only, as today). Focus order is unaffected: the
  button is inserted before the close button, never before the title.
- Headers keep `cursor: move` (style.css–1381): drag is refused while
  maximized but dblclick still works on the same surface, so the cue stays
  honest.

## 6. Migration (minimal, fold-then-delete)

1. `static/js/windows.js` — add `ensureMaxButton` + shared `setMaximized`;
   call from `wire()`; add header `dblclick`; add drag/resize maximized guards;
   extend the MutationObserver with the `hidden` attributeFilter branch.
   `NB.windows = { wire }` export (windows.js) is unchanged.
2. `static/css/style.css` — rename `.designer-modal--max` →
   `.settings-modal--max` and `.designer-max*` → `.win-max*`; move the block
   next to the `.resize-grip` rules (~line 1382) so shared window chrome lives
   in one place; keep `!important` and the grip-hide rule.
3. `templates/index.html` — delete the `#designer-max` button block
   (lines 912–924). `#designer-close` stays; `.designer-header-actions`
   stays (it groups the injected buttons).
4. `static/js/mermaid-designer.js` — delete `maxBtn` (line 128),
   `setMaximized(false)` in `close()` (line 454), `setMaximized`/
   `toggleMaximized` (468–482), the max click + header dblclick wiring
   (760–769). Nothing else in the module references maximize.
5. `tests/dom/test_dom.js` — the `== designer maximize ==` block
   (lines 19945–20049) moves into the `== windows ==` block (15166+) as shared
   assertions; the fixture near line 730 drops its hand-written `#designer-max`
   (the shared code injects it, which is the new assertion).

The designer needs no opt-in or skip: with its markup removed, the injection
rule gives it the shared button in the exact same position.

## 7. Verification

jsdom (`tests/dom/test_dom.js` — the harness builds its own fixture and stubs
`getBoundingClientRect`, so all of this is assertible):

- Every fixture `.settings-modal` has exactly one `.win-max` after wiring —
  including the login modal and a dynamically added modal (proves both the
  boot scan and the observer path).
- Placement: before the last header button where one exists; appended for the
  login header.
- Toggle: click adds `settings-modal--max`, sets `aria-pressed="true"`,
  relabels to "Restore"; second click reverts all three. Header dblclick
  toggles; dblclick targeting a button does not.
- **Drag-guard regression test** (the bug class of §4): maximize, dispatch
  pointerdown/move/up on the header, assert `nb:windowGeometry` is unchanged.
- Close-reset: maximize, set `overlay.hidden = true`, assert class removed and
  `aria-pressed="false"` — for a static modal and for the `:help` modal.
- Content checks flip: index.html no longer contains `designer-max`;
  style.css contains `.settings-modal--max` with `100vw !important` and the
  grip-hide rule; mermaid-designer.js has no `setMaximized`.

Real-browser only (jsdom has no layout):

- Full-viewport rendering actually happens (`!important` vs inline styles).
- Grip hidden and drag truly inert while maximized.
- Window resize while maximized keeps the modal full-viewport; restore lands
  the old geometry re-clamped into the shrunk viewport.
- Glyph alignment/theme rendering across the five modals.

## 8. Risks

- The `hidden`-attribute observer branch fires for unrelated `hidden` toggles
  (settings tab sections). One `classList.contains("settings-overlay")` check
  per mutation; low frequency, acceptable.
- `.designer-modal` sizes itself via `--designer-modal-w/h`
  (style.css) and `.auth-modal` via `height: auto` (style.css–1795);
  both are overridden by the max class's `!important` — verified by reading,
  confirm visually once.
- Test churn: the `== designer maximize ==` block is ~100 lines that move and
  get generalized; the registry-completeness style checks must flip direction
  (presence → absence) or they will fail on the old strings.
- No other module references `#designer-max` or `setMaximized`
  (grep: only mermaid-designer.js, index.html, test_dom.js) — the deletion is
  self-contained.