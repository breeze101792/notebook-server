# Preview overflow, modal focus, tab-strip scroll — structural fixes

Decisions for five findings from the real-Chromium pass. This document fixes
the approach, the ownership boundary, and the shared-mechanism question;
implementation goes to the build department. Citation corrections from
reading the code: the `overflow-wrap: normal` rules cited at
`style.css:3206/:3223` do not exist — those lines carry color/margin rules
only, so the no-wrap behavior is UA defaults, not a wrong policy. Also,
`designer-shell.js:729-750` and `mermaid-designer.js:3721-3742` already
hold two byte-identical `focusables()`/`trapTab()` copies, and
`designer-shell.js:615-616` already sets `el.inert` — both facts change the
F2 decision. Siblings: [frontend.md](frontend.md) (§7 tab bar) and
[context-menus.md](context-menus.md) (the precedent for consolidating a
triplicated widget into one module).

---

## 1. F1 — wrapping strategy (medium)

**Decision: one rule — `.markdown-body { overflow-wrap: break-word; }` next
to `.markdown-body` (`style.css:3206`). Use `break-word`, not `anywhere`.
Keep `overflow-x: hidden` on `#viewer-content` (`:2427`) as the guard.**

- The clipped elements are block-flow prose (`p`, `li`, headings) and inline
  runs (`a`, inline `code`); `break-word` breaks a long token only when it
  alone cannot fit the line — the exact failure, no more.
- **`min-width: 0` is already load-bearing:** `#viewer` (`:2406`) and
  `#viewer-content` (`:2424`) both carry it. A flex item's automatic minimum
  is its min-content; a long token would inflate it and push the overflow
  into the page grid (a horizontal *page* scrollbar) instead of the viewer's
  clip — that is why the bug is "clipped in the viewer", not "page scrolls".
  Any future flex/grid wrapper around rendered prose must repeat
  `min-width: 0` or the bug returns one level up.
- **Why not `anywhere`:** `overflow-wrap` is inherited, and `anywhere` counts
  its break opportunities into min-content sizing. Inherited into `table`
  cells, a long-token column would shrink to the table's `max-width: 100%`
  cap and wrap inside the cell instead of extending the table's scrollWidth
  — `.markdown-body table` (`:3770`) is `display: block; overflow-x: auto`
  by design. The naive fix converts the two documented scrollers (tables;
  `pre` holds `white-space: pre`) to wrappers, regressing the one behavior
  the finding says is already correct. `break-word` leaves min-content
  untouched, so tables keep widening and scrolling. Inline `code` and long
  links need no separate rule: in block flow, `break-word` breaks them only
  when needed. Reject `word-break: break-all` (smashes normal words
  eagerly); in-repo precedent: `.search-hit .hit-snippet` already wraps via
  `word-break: break-word` (`:3197`).
- **Export parity:** the standalone export embeds its own stylesheet
  (`export.js:806-903`), not `style.css`; add the same rule there so
  exported files match the app. Hybrid mode is unaffected: wrapping is
  CSS-only and Turndown serializes text nodes, so the write-back round-trip
  cannot see it; the hybrid container scrolls itself (`:2773-2775`), where
  wrapped prose is consistent.

## 2. F2 — modal focus mechanism (medium, a11y)

**Decision: a shared module — new `static/js/dialog.js` (`NB.dialog`),
`inert`-based, no JS Tab trap. Wire Settings, Export, and the auth modal;
retire the two existing trap copies in the designers.**

- **Shared, not local, because duplication already exists.** `trapTab` +
  `focusables()` are byte-identical in the two designers; a local Settings
  fix writes the third copy and leaves auth/export broken. Five consumers
  for one mechanism is a real requirement, not a speculative framework.
- **`inert`, not a JS trap.** A keydown trap only stops Tab; pointer users
  can still click the dimmed background and focus escapes. `inert` removes
  the background from the tab order, pointer interaction, and the AT tree in
  one attribute (`designer-shell.js:615-616` is the in-repo precedent).
- **Mechanism.** All overlays are direct `<body>` children
  (`index.html:372,403,910,992,1202`). `NB.dialog.open(overlayEl,
  { initialFocus })` saves `document.activeElement`, sets `inert` on every
  other body child, then focuses `initialFocus`. `NB.dialog.close(overlayEl)`
  clears the inert set (only if this overlay is the active one) and restores
  focus to the saved invoker.
  - **Cycle rule:** `inert` removes the background from the tab order, but
    Chromium still moves Tab to the browser chrome after the last control, so
    the helper wraps Tab and Shift+Tab explicitly. The dialog container is the
    default focus target and is not in `focusables()`, so it counts as both
    ends of the cycle; without that, Shift+Tab from a freshly opened dialog
    falls to `BODY`.
  - **Initial focus:** default to the dialog container (`.settings-modal`
    gets `tabindex="-1"`) so the `aria-labelledby` title is announced — the
    ARIA APG dialog pattern. Auth passes its password input instead,
    preserving `auth.js:82`.
  - **Return focus:** on close, focus the saved invoker iff `isConnected`
    and not `document.body` — the `designer-shell.js:334` pattern;
    supersedes settings.js's blur-only release (`settings.js:184-186`).
  - **Esc stays with each surface** (`settings.js:544-545` keeps its own);
    the helper owns only inert + initial focus + restore. Designer Esc and
    Ctrl+Z (`designer-shell.js:752-778`) survive their migration untouched.
  - **One dialog at a time;** no flow stacks two overlays today. If one
    ever does, the lower becomes inert (visible, unreachable) — the correct
    degradation. `NB.menu`'s singleton is a body child, but a menu can
    never be open when a dialog opens (the opening click is an outside
    click the dispatcher closes on); no exemption needed.
- **Load order:** eager group becomes `api.js → dialog.js → auth.js`
  (`index.html:399-400`); `auth.js` runs at parse time, so the helper must
  precede it. Add `dialog.js` to `sw.js` PRECACHE and bump the cache name
  (`sw.js:22`). Mobile sheets (`mobile.js:735-744`) keep their local
  focus-close pattern — different layer/history lifecycle; a follow-up.
  The AI panel and context menus are not modal, so they are out of scope.
- **jsdom caveat:** jsdom 24 reflects `inert` but does not enforce its
  focus blocking — tests assert the attribute set/cleared on body children;
  real containment is covered by the browser suites (§6).
- **`aria-modal="true"` without a trap is a correctness bug — yes.** The
  attribute is a contract with assistive tech — "everything outside is
  unavailable" — and today that is false (`index.html:373,404,911`). Same
  class as a wrong type signature; low severity only because the primary
  user is sighted-keyboard. `inert` makes the promise true for free.

## 3. F3 — tab-strip scroll ownership (medium)

**Decision: `tabs.js` owns both behaviors — `render()` preserves scroll,
`activate()` reveals the newly active tab.**

- **Preserve:** `render()` wipes `#tab-list` (`tabs.js:325-326`), so read
  `listEl.scrollLeft` (and `pinEl.scrollLeft`) at the top of `render()` and
  write them back after `applyFrozenWidths()` — the last layout-mutating
  step, so frozen inline widths cannot clamp the restored value. Every
  non-activation render (dirty marker, conflict badge, watcher tick, ghost
  close) then keeps the user's manual scroll instead of snapping to 0.
- **Reveal — on every `activate()`, not every render:** in `activate()`, after
  `render()`, reveal the active `.tab` by clamping `listEl.scrollLeft` alone:
  to `tab.offsetLeft` when the tab starts left of the visible strip, to
  `tab.offsetLeft + tab.offsetWidth - listEl.clientWidth` when it ends beyond
  it, nothing when already visible. This includes re-activating the tab that
  is already active, because a sidebar click can land there after the strip
  was scrolled away. Revealing on every render would trade the lost-scroll bug
  for a yank-the-strip bug on every watcher tick.
- **Why not `scrollIntoView`:** it scrolls every scrollable ancestor
  (including the window vertically), and the DOM harness must stub it
  (`test_dom.js:1234-1235`). Direct `scrollLeft` arithmetic scrolls only
  the strip and is a no-op in jsdom (all offsets 0), leaving existing
  tab tests untouched.
- **Affordance: defer.** The hidden scrollbar (`style.css:500-501,523,1231`)
  is a deliberate 34px-row cleanliness choice; a visible overflow indicator
  needs JS scroll listeners (CSS scroll-driven animations are
  Chromium-only). The reveal fix removes the "where am I" failure that
  would motivate it.
- **Docs:** amend `frontend.md` §7 "Tab bar" with the scroll contract
  (render preserves, activation reveals); the two tab design docs are
  width-machinery documents — no change.

## 4. F4 — highlight.js warns on plugin fences (low)

**Fix: skip registry-claimed fences in the highlight loop — the cited
`viewer.js:446-450` plus the identical loops at `hybrid.js:1765-1773` and
`export.js:423-427` (leave `ai.js:1271`; its prose never carries plugin
fences). Guard each loop with the existing registry API: extract the
`language-*` token from the class list and skip when `NB.blocks.forLang(lang)`
returns a descriptor (`blocks.js:159` covers `mermaid`, `math`/`katex`,
`wavedrom`, `dot`/`graphviz`, `html-live`, `svg`). No new registry method —
the guard is two lines at three sites, and a `claimsElement()` helper would
abstract a trivial predicate. Zero risk to real code fences: `forLang`
matches only registered names.

## 5. F5 — "Password field is not contained in a form" (low)

**Defer.** The warning is a verbose-only diagnostic with zero functional
impact. The "fix" — real `<form>` wrappers — is the risky direction in the
app's most sensitive UI: implicit submission puts Enter-in-a-password-field
at risk of navigating, while today's Enter behavior is deliberately
hand-wired per input (`settings.js:751,788,797,967`). If ever fixed: one
`<form>` per password group (`index.html:686-766`), explicit
`type="button"` inside it, and a submit `preventDefault` — its own change.

## 6. Ordering and risk

1. **F1 first** — CSS-only, biggest user-visible win; lands alone.
2. **F2 and F3 in parallel** — F2 touches `dialog.js` (new), `index.html`,
   `sw.js`, `settings.js`, `export.js`, `auth.js`, and both designers; F3
   touches `tabs.js` only. Disjoint files, no conflicting hunks.
3. **F4 after F2** — both touch `export.js` (F2 wires `close()`, F4 guards
   the highlight loop); sequencing avoids double-churning one file.

| Fix | Regression risk | Catching suite |
| --- | --- | --- |
| F1 | table/pre rendering, export parity | `test_hybrid_blocks_browser.js`; DOM suite cannot see layout — verify clientWidth vs scrollWidth in a real browser |
| F2 | login/logout, designer traps | `test_auth_export_browser.js`; `== auth ==` block in `tests/dom` (attribute assertions); `test_designer_browser.js` + `test_dw_designer_browser.js` (Esc/Ctrl+Z kept) |
| F3 | width-freeze machinery, drag reorder | `test_core_ui_browser.js`; DOM-suite tab tests (restore after `applyFrozenWidths`) |
| F4 | fence rendering and editing | `test_block_edit_browser.js`, `test_hybrid_blocks_browser.js`, blocks-registry block in `tests/dom` |

Non-goals: no mobile-sheet rewiring (§2), no strip affordance (§3), no
`claimsElement` helper (§4), no `<form>` migration (§5), no lightbox changes
(it is not `aria-modal`; no trap requirement today).