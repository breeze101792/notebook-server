# Typography regression plan — how the type contract is held

Status: design — pre-implementation. This document specifies the two suites that keep
[`docs/ui/typography.md`](../ui/typography.md) true on the running app and
[`docs/architecture/typography.md`](../architecture/typography.md) §5 true in the source. It does
not restate the role table; it says how a violation is caught, where the test lives, and how the
test proves it can fail.

The failure this plan exists for: seven side panels shipped at different row sizes, and nothing in
the suite noticed. `tests/dom/test_dom.js` asserts class names and behaviour, never computed type;
the browser suites assert geometry and interaction. A drift was invisible to every gate, so it
survived three passes.

Abbreviations: `style.css` = `static/css/style.css`; `typography.md` = `docs/ui/typography.md`.

---

## 1. The invariants

Every test below maps to one of these. A test that does not serve one is scope creep.

| # | Invariant | Where it can break | Layer |
|---|---|---|---|
| **I1** | Every side-panel row that carries primary text measures the same px: tree, sessions, pinned, bookmarks, recent, search hit, AI message | a component rule, a panel-specific override | runtime |
| **I2** | Every visible chrome text resolves to one of the seven `--text-*` steps | a new literal, a copied rule | runtime + static |
| **I3** | A literal `font-size` exists only in the four sanctioned categories (badge 9 px, 16 px touch/phone, glyphs, prose `em`) | authoring | static |
| **I4** | The seven steps follow `--font-scale` at S, M, L and XL, and the fixed 9 px does not | token block, `applyFontSize` | runtime |
| **I5** | Side-panel headers stay the height of the tab bar at every setting | header rule | runtime |
| **I6** | No JS writes an element font size | `static/js/**` | static |

---

## 2. Layer 1 — source check

**File:** `tests/static/test_typography.js` (new folder `tests/static/`). Plain Node, no
dependency, no build step — `package.json` already runs the DOM suite through `node`.

**Runs:** first in `npm test`, before the DOM suite, so a literal fails in under a second:

```
"test": "node tests/static/test_typography.js && node tests/dom/test_dom.js"
```

### 2.1 What it parses

| Input | Extracted | Passes when |
|---|---|---|
| `style.css`, `static/css/vimnav.css` | every `font-size:` declaration, and the size slot of every `font:` shorthand | the value is `var(--text-*)`, `var(--icon-*)`, `inherit`, `calc(16px * var(--font-scale))`, an allowlisted literal, or a `em`/`%` value inside an allowlisted prose selector |
| `style.css` `:root` | the seven `--text-*` declarations | exactly seven steps, values `9px .72rem .8rem .86rem .93rem 1rem 1.15rem` in that order |
| `static/js/**/*.js` | `fontSize`, `font-size` | zero hits outside comments and SVG fixture attributes (`static/js/blocks.js:116`) — I6 |
| `tests/browser/*.js` | `page.addStyleTag` | zero non-allowlisted injections; a test that hides a defect by injecting a size is a defect |

Comments are stripped first, so a rule inside `/* … */` never counts. The parser tracks line
numbers, and every failure prints `file:line  <selector>  font-size: <value>` plus the nearest step
and its delta — the message the author needs, not an index.

### 2.2 The allowlist

An array at the top of the script. One entry per surviving literal:

```js
{ file: "style.css", selector: "#search-view .search-panel-filter-label",
  value: ".66rem", why: "small uppercase label; search-view.md §7.1", retires: "phase 2.5" },
```

Rules:

1. An entry is pinned to `(file, selector, value)`. A new literal anywhere else fails.
2. Changing an allowlisted value fails, because the pinned value no longer matches.
3. A stale entry fails. The script counts matches per entry and reports entries that match nothing,
   so the list cannot rot.
4. `retires` is mandatory and names a phase of `docs/architecture/typography.md` §6.

### 2.3 Inventory mode, then strict

The migration in the architecture doc lands surface by surface, so the check ships in two modes:

| Phase | Behaviour | Exit |
|---|---|---|
| 0 (with the migration's phase 0) | The allowlist is seeded from today's inventory; the script prints `N literals allowlisted, M tokenised` | 0 |
| 1 onward | Each phase deletes its entries; the printed count is asserted to be non-increasing | 0 |
| Final | Zero entries outside the four §1 categories | 0 |

The count assertion is the ratchet: `test_typography.js` reads the previous count from
`tests/static/typography-baseline.json`, fails if the count rose, and requires the file to be
updated by the same commit that lowers it. Deleting the baseline file fails the run.

---

## 3. Layer 2 — runtime audit

**File:** `tests/browser/test_typography_browser.js`. Registered as one entry in the existing
`SUITES` array (`tests/browser/run_all.js:17-32`) on port **5097**, launched through
`tests/browser/chromium.js` and `CHROMIUM_PATH`, like every other suite.

It boots the real app with the same fixtures the core suite uses, then walks **visible text** in a
fixed state matrix at four settings. jsdom cannot do this: it has no layout and does not resolve the
rem cascade reliably, so the DOM suite is not the place (that is why the drift was never caught).

### 3.1 State matrix

A size is only provable in a state where the text exists. Every state below is required; each one
was a blind spot in the hand scan that missed `.66rem` inside the collapsed Advanced panel.

| Surface | States | Selector scope |
|---|---|---|
| Shell | default, topbar hidden | `#topbar`, `#tab-bar`, `#edit-bar` |
| Explorer | default, one folder expanded, a context menu open | `#side-panel`, `#context-menu` |
| Sessions | one session, two sessions, row menu open | `#sessions-view` |
| Pinned | empty, with one pinned folder | `#pinned-view` |
| Bookmarks | empty, three bookmarks, row menu open | `#bookmarks-view` |
| Recent | three entries | `#recent-view` |
| Search | idle, Advanced closed; Advanced open; a query with results; no matches; an error | `#search-view` |
| AI | empty, one user message, one assistant message with a fence, one error card | `#ai-view` |
| Outline | one note open | `#outline-view` |
| Settings | each of the seven tabs | `#settings-overlay` |
| Overlays | export dialog, workspace dialog, session dialog | their roots |

Settings states are not optional: the last sweep found four off-scale sizes in Settings after the
side panels were clean.

### 3.2 The measurement

```
for each element in scope, depth-first:
  skip when display:none, visibility:hidden, or inside .sr-only
  skip when the element has no direct text node
  skip inside #viewer-content, .ai-prose-span, and any rendered-block root (prose, §1 I2 exemption)
  skip <text>/<tspan> inside SVG (rendered diagrams own their own size)
  read getComputedStyle(el).fontSize
  match it to the nearest step at the current root, tolerance 0.3 px
  record an unmatched size with the element's class chain and its first 24 characters
```

Tolerance: 0.3 px absorbs sub-pixel rounding (`.72 × 16.1 = 11.592`); it is far below the gap
between steps (1.0 px at S, 1.3 px at L).

### 3.3 Assertions

| # | Assertion | Fails when |
|---|---|---|
| A1 | Zero unmatched sizes in the matrix | any text is off the scale |
| A2 | The row group measures one px: `.tree-name`, `.session-name`, `.bookmark-name`, `.recent-name`, `.search-panel-hit-file`, `.ai-prose-span` | two panels disagree — **the original bug** |
| A3 | All `.panel-title` elements measure one px, and it is `--text-xs` | a panel header drifts |
| A4 | All panel headers and the tab bar are equal in height | a header stops following the scale |
| A5 | At S/M/L/XL each step equals root × its rem value; `--text-2xs` stays 9 px | a token stops scaling |
| A6 | At M, `.tab` is `--text-ui-lg`; every visible Settings `button`/`input`/`select`/`textarea` carries `--text-ui` (fields included: their text is in `value`, not a child node) | a control takes the wrong rank |

A2 and A3 are the anti-drift assertions: they are cheap, they name the role rather than the value,
and they fail on a *new* surface that picks its own size even when that size is legal.

The Settings row's `Font size · <px>` label is behaviour, not computed type, so it stays in the DOM
suite: `tests/dom/test_dom.js` asserts `14 px` on open and the picked value on every change, driving
the same native radios. The browser suite owns the four `Aa` specimens and the captions; neither
suite can assert the other's half.

### 3.4 Failure output

One line per violation, grouped by surface and setting:

```
FAIL search, advanced open, XL: 9 off-scale
  .search-panel-filter-label  .66rem → 12.06 px, nearest --text-xs 13.10 (−1.04)
  .search-panel-mode span      .76rem → 13.88 px, nearest --text-ui 15.65 (−1.77)
```

The delta and the nearest step make the fix obvious without opening the stylesheet.

---

## 4. Layer 3 — visual diff (optional, not a gate)

`page.screenshot()` per surface with a baseline per theme would catch a *correctly sized* regression
(a role applied to the wrong element). It is not required here: it fails on font-hinting differences
between renderers, needs a baseline update on every deliberate change, and the role assertions in
A2/A3 cover the failure the project actually hit. It stays available as a manual tool, per surface,
when a phase-2 delta lands; nothing in §6 depends on it.

---

## 5. Seeding and determinism

| Need | How |
|---|---|
| A clean font setting per run | write `NOTEBOOK_CONFIG_DIR` with `fontSize` per pass, or drive `NB.app.setFontSize` and await a frame |
| Session, bookmark, recent and search data | reuse the fixtures the core suite already writes (`tests/browser/test_core_ui_browser.js` boot sequence) |
| AI messages without a provider | stub the stream the way `test_ai_editor_browser.js` does; never call a real provider |
| Same browser across passes | launch once, reuse the page, re-render the state after each setting; one `setFontSize` per pass |
| No cross-suite port clash | port 5097 (free), declared in `run_all.js` |

The audit asserts computed px, not screenshots, so it is stable across font-backend differences;
that is also why it can live in the required gate.

---

## 6. Acceptance criteria for the tests themselves

| # | Criterion | Observable |
|---|---|---|
| **T1** | The static check fails on an injected literal | Add `.77rem` to any rule: `npm test` exits non-zero and names `file:line` |
| **T2** | The static check fails on a stale allowlist entry | Delete the rule behind an entry: the run fails and names the entry |
| **T3** | The runtime audit fails on an injected size | `page.addStyleTag` setting `.tree-name` to `.9rem`: A2 fails and names both sides |
| **T4** | The runtime audit passes on a clean tree | `node tests/browser/test_typography_browser.js` exits 0 at M and XL |
| **T5** | The gate runs both | `npm test` runs layer 1; `npm run test:browser` includes the audit; `run_all.js` lists it on 5097 |
| **T6** | No hidden dependency | The suite runs with `CHROMIUM_PATH` only, no network, no provider key |

T1–T3 are run once by hand when the suites land and their outcome is recorded in
[`browser-audit.md`](browser-audit.md). A test that has never been seen to fail does not count as a
regression test.

---

## 7. Where the migration stands

Measured in Chromium at `--font-scale: 1.15` (L). These ten were the entries the allowlist started
with, and the first pass retired every one of them — the table is kept as the record of what the
hand sweep missed and the audit caught.

The static allowlist still holds 247 declarations. 73 are token-value spellings (`.72rem`,
`.8rem`, `.86rem`, `.93rem`, `1rem` — Tier 1, pixel-identical to their token), the rest are surfaces
the runtime matrix does not cover (the designers, the graph overlay, `vimnav.css`, dialogs at rest)
plus the deliberate exemptions of §1. The count ratchets down; the allowlist is the backlog, not a
clean bill.

| Selector | Value | px at L | Step | Phase |
|---|---|---|---|---|
| `#search-view .search-panel-filter-label` | `.66rem` | 10.63 | `--text-xs` | 2.5 |
| `#search-view .search-panel-mode span` | `.76rem` | 12.24 | `--text-ui` | 2.5 |
| `#search-view .search-panel-advanced-toggle .aa` | `.74rem` | 11.91 | `--text-ui` | 2.5 |
| `.settings-form-title` | `.74rem` | 11.91 | `--text-xs` | 2.1 |
| `.settings-hint` | `.78rem` | 12.56 | `--text-sm` | 2.1 |
| `.settings-watch-status` | `.82rem` | 13.20 | `--text-sm` | 2.1 |
| `.ws-row-name` | `.95rem` | 15.29 | `--text-ui-lg` | 2.4 |
| `.shortcut-label` | `.95rem` | 15.29 | `--text-ui-lg` | 2.1 |
| `.shortcut-binding` | `.9rem` | 14.49 | `--text-ui` | 2.1 |
| `#outline .outline-item a` | `.89rem` | 14.33 | `--text-ui` | 2.6 |

The seven side panels and Settings are clean in every state the audit walks. When the allowlist
holds only the four sanctioned categories, §2.3's final state holds.

---

## 8. Maintenance

1. **A new panel or a new state is added to §3.1 in the same change.** The audit walks what it is
   told about; an unlisted panel is an untested panel.
2. **A new role is a change to `docs/ui/typography.md` first**, then a token, then a test row. Never
   the other way round.
3. **An allowlist entry carries `retires`.** An entry without a phase is a decision to keep the
   literal forever, which needs the user's approval, not the author's.
4. **The audit never asserts a colour, a weight or a line height.** Those are `controls.md` and
   `typography.md` §6; this suite asserts size and the row equality, and stays cheap.

## 9. What not to do

| Rejected | Reason |
|---|---|
| Assert computed type in `tests/dom/test_dom.js` | jsdom has no layout; it would pass on values the browser never renders |
| A full-page screenshot diff as the gate | Fails on font backends, needs a baseline per theme × setting × state; the role assertions catch the real failure |
| Asserting CSS line numbers | Every reformat breaks the test; assert the selector and the value |
| A `getComputedStyle` sweep of the whole document | Rendered prose, diagrams and vendored CSS contribute hundreds of legal sizes; the result is noise, and noise gets allowlisted until the test means nothing |
| Testing the Settings tiles' `Aa` sizes as roles | They are deliberately absolute (§8 of `typography.md`); the audit excludes the tile specimen and asserts the four captions instead |
