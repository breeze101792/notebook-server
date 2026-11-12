# Typography contract — one scale, three enforcement layers

Status: design — pre-implementation. This document owns the **type-size
contract** for `static/css/style.css` and `static/css/vimnav.css`: the canonical
scale, who may use a literal, what `--font-scale` means, how drift is prevented,
and the order the contract lands in. It reads `docs/ui/foundations.md` §4 for
the token values and defers to it where they overlap; where this file and
`foundations.md` disagree, this file is wrong about values and right about
enforcement. No framework, no build step, no new dependency (all three layers
use what `package.json` already ships).

Every claim about current code cites `file:line`.

---

## 1. Root cause

The tokens exist and are correct (`style.css:197-203`). They are simply not
what the file uses. As of HEAD:

| Measure | Count | Source |
|---|---|---|
| Literal `font-size:` declarations (number or px) | 264 | `grep -o 'font-size: [^;]*' static/css/style.css \| grep -cv 'var('` |
| Token `font-size: var(--text-*)` declarations | 28 | same grep |
| Token `font: … var(--text-*)` shorthand declarations | 4 | `grep -c 'font:.*var(--text-'` |
| Distinct literal rem values | 34 | the inventory in §2.4 |
| Scale steps the design defines | 6 rem + 1 px | `style.css:197-203` |

Drift is not one mistake; it is five mechanisms, each visible in the file:

**1. The literal is the path of least resistance.** Nothing makes a new rule
read a token, and copying a nearby rule copies its literal. `.sp-file
{ font-size: .86rem }` (`style.css:4565`) lives 3,365 lines below
`--text-ui: .86rem` (`style.css:200`) and spells the same value by hand.

**2. The same value is spelled two ways, and one spelling wins.** The
token-value literals outnumber their own tokens:

| Value | As literal | As token |
|---|---|---|
| `.93rem` = `--text-ui-lg` (`style.css:201`) | 21× | 2× |
| `.8rem` = `--text-sm` (`style.css:199`) | 22× | 3× |
| `.86rem` = `--text-ui` (`style.css:200`) | 14× | 13× |
| `.72rem` = `--text-xs` (`style.css:198`) | 18× | 6× |
| `1rem` = `--text-body` (`style.css:202`) | 8× | 4× |

A reviewer cannot tell a deliberate token use from a coincidental literal, and
no grep for the token name finds the literal spellings.

**3. Intermediate values accumulate because nothing names the nearest step.**
Meta text — the same role — is `.74rem` (`style.css:4567`), `.76rem`
(`style.css:8340`, `:8345`), `.78rem` (`style.css:4741`, `:1679`), `.79rem`
(`style.css:2211`). Primary row text is `.86rem` (`style.css:4565`), `.9rem`
(`docs/ui/sessions.md:35`, `style.css:8317-8338`), `.93rem`
(`style.css:8271`), `.95rem` (`style.css:8385`) — four values for one role.
The role is now pinned to `--text-body` (`docs/ui/typography.md` §2); those
four literal spellings are its backlog. Small uppercase labels are
`.66rem` (`style.css:4110`, used at `:4321`), `.68rem` (`style.css:1931`),
`.72rem` (`style.css:6447`). Two side panels that should match, don't.

**4. Two steps of the scale are dead.** `--text-2xs` (`style.css:197`) and
`--text-lg` (`style.css:203`) have **zero** `var()` consumers
(`grep -c 'font-size: var(--text-2xs)'` = 0; same for `--text-lg`). The roles
they should own are served ad hoc: badges are literal `9px`
(`style.css:4733`), headings are `.95rem` (`style.css:2406`), `1.05rem`
(`style.css:3919`), `1.14rem` (`style.css:8820`).

**5. No test asserts typography.** `tests/dom/test_dom.js` is structural —
4,523 `check()` calls about DOM and behaviour; its only size-adjacent check
asserts `dataset.nbSizing`, not a pixel (`tests/dom/test_dom.js:5781-5782`).
The browser suites assert figure geometry, not type
(`tests/browser/test_figure_sizing_browser.js:88-98`). The checks in
`foundations.md` §11.3 are copy-paste shell commands, not wired to any npm
script, and none of them looks at `font-size`.

The recent hand-fix proves the point: the search panel was tokenised by hand
(`docs/ui/search-view.md` §7.1, "No local alias survives") and the side-panel
spec now names tokens (`docs/ui/side-panel-views.md:220`, `:525`, `:625`) —
but the convention that covered it, "touch it, tokenise it"
(`docs/ui/foundations.md:747`), only fires on components already being
edited. Untouched components keep the old habit, and the next component
copies a literal because that is what most of the file still looks like.
Enforcement, not another hand-fix, is the fix.

---

## 2. The contract

### 2.1 Canonical scale

Seven steps. Values are the ones already in `style.css:197-203`; nothing is
re-valued.

| Token | Value | px @ M (1.0) | px @ XL (1.3) | Scales? |
|---|---|---|---|---|
| `--text-2xs` | `9px` | 9 | 9 | no (fixed) |
| `--text-xs` | `.72rem` | 10.08 | 13.10 | yes |
| `--text-sm` | `.8rem` | 11.2 | 14.56 | yes |
| `--text-ui` | `.86rem` | 12.04 | 15.65 | yes |
| `--text-ui-lg` | `.93rem` | 13.02 | 16.93 | yes |
| `--text-body` | `1rem` | 14 | 18.2 | yes |
| `--text-lg` | `1.15rem` | 16.1 | 20.93 | yes |

Weight, line-height and tracking travel with the step
(`docs/ui/foundations.md:250-257`): `--fw-*` at `style.css:205-209`,
`--lh-*` at `style.css:211-215`, `--tracking-label: .08em` at
`style.css:216`. A size rule without its line-height is incomplete; migrating
a size without its line is a half-migration.

### 2.2 Roles

One role → one step, on every surface. The role names come from the specs
that already use them (`docs/ui/controls.md`, `docs/ui/sessions.md`,
`docs/ui/side-panel-views.md`).

| Role | Step | Weight / line / tracking | Spec source |
|---|---|---|---|
| Badge (count chip in a row or header) | `--text-2xs` | 600–700, `--lh-tight`, tabular-nums | `controls.md:371` |
| Label (panel title, section header, small uppercase) | `--text-xs` | `--fw-regular`, `--lh-tight`, `--tracking-label`, uppercase | `style.css:531-537`; `sessions.md:40`; `side-panel-views.md:220` |
| Meta (secondary line in a row, footer, hint, status) | `--text-sm` | `--fw-regular`, `--lh-snug` | `foundations.md:260`; `controls.md:652`, `:654` |
| Control (button, field, menu item, chip, toggle) | `--text-ui` | `--fw-medium`, `--lh-flat` or `--lh-normal` | `controls.md:155`, `:504`, `:653` |
| Row (primary text of a list row: file, session, bookmark name) | `--text-body` | `--fw-regular`–`--fw-medium`, `--lh-snug` | `side-panel-views.md:525`, `:625`; `docs/ui/typography.md` §2 |
| Primary chrome (topbar, tabs, edit bar, brand, picker rows) | `--text-ui-lg` | 400–600, `--lh-flat` | `foundations.md:256`; `style.css:336`, `:8271` |
| Prose (viewer body, empty-state sentence, error body) | `--text-body` | `--fw-regular`, `--lh-normal` (1.5) | `style.css:303`; `controls.md:682` |
| UI heading (dialog title, modal h2, edit-window title) | `--text-lg` | `--fw-semibold`, `--lh-tight` | `foundations.md:257` |
| Prose heading (rendered markdown h1–h4) | em ladder: `1.7 / 1.4 / 1.2 / 1.05em` of prose, weight 650 | `--lh` per step | `style.css:7692-7695` (phone); desktop `:3374-3376` |
| Glyph (icon, pin, star, dot, decorative numeral) | `--icon-*` px or an allowlisted one-off | `--lh-flat` | `style.css:268-271` |

### 2.3 The rule for choosing a size

Answer in order; the first "yes" wins:

1. Is it a decorative glyph or icon? → `--icon-sm/md/lg/xl` (`style.css:268-271`)
   or an allowlisted glyph literal (§3.3). Never a `--text-*` step.
2. Is it a count badge? → `--text-2xs`.
3. Is it a small uppercase label? → `--text-xs` + `--tracking-label`.
4. Is it secondary to a neighbouring primary text (meta, hint, footer,
   status)? → `--text-sm`.
5. Is it inside rendered markdown? → `--text-body`, with the em ladder for
   headings (§3.4). Never a `--text-*` step inside prose.
6. Is it a heading of a modal/dialog/chrome surface? → `--text-lg`.
7. Is it the primary text of a list row (the file, session or bookmark the
   row is about)? → `--text-body`. One step in every panel; see
   `docs/ui/typography.md` §2.
8. Is it a control (click it, type in it)? → `--text-ui`.
9. Is it primary chrome text (topbar, tab, edit bar)? → `--text-ui-lg`.
10. Anything else that a human reads as a sentence → `--text-body`.

Two elements that play the same role on different surfaces use the same step.
If the step looks wrong for the role, the role is re-decided here in §2.2 —
not locally in the component.

### 2.4 What is retired

Retired means: no new rule may use it, and every existing use has an expiry
(the phase in §6 that removes it).

| Retired | Replacement | Notes |
|---|---|---|
| The 28 off-scale rem values `.5 .64 .66 .68 .7 .73 .74 .75 .76 .78 .79 .82 .84 .85 .89 .9 .95 .98 1.05 1.08 1.1 1.14 1.2 1.3 1.35 1.4 1.6 2rem` | the role's step (§2.2), or the glyph allowlist for the five glyph one-offs (`.5rem :7015`, `1.3rem :1557`, `1.4rem :6791`, `1.6rem :6690`, `2rem :6716`) | Snap by role, not by nearest value. Text examples: `.74/.76/.78/.79` meta → `--text-sm`; `.84/.85/.89/.9` chrome → `--text-ui` or `--text-ui-lg` by role; `.95/.98/1.05/1.08/1.14` headings → `--text-lg` |
| The 6 token-value literals `.72 .8 .86 .93 1 1.15rem` written by hand | their own tokens | Pixel-neutral swap; phase 1 |
| The local aliases `--search-label-size` (`style.css:4110`), `--search-adv-font` (`:4113`), `--search-adv-meta` (`:4114`) | `--text-xs`, `--text-ui`, `--text-xs` | Already decided: `search-view.md:717-721` |
| `9px` badges (`style.css:4733`) | `var(--text-2xs)` | Same pixels |
| px literals in desktop rules (the 9/10/11/11.5/12/14/16 px set) | `--text-2xs` for text, glyph allowlist for glyphs | `style.css:1355`, `:3208`, `:3219`, `:4855`, `:5061` |

Not retired: the phone px ladder inside the breakpoint blocks (§4), the
prose em ladder (§3.4), and the glyph one-offs on the allowlist.

---

## 3. Consumption rules

### 3.1 The default

Every `font-size` in `static/css/style.css` and `static/css/vimnav.css` —
including the size inside a `font:` shorthand, e.g. `style.css:303`,
`:537`, `:2417` — is one of:

1. `var(--text-<step>)` — the seven steps, `style.css:197-203`;
2. `var(--icon-<size>)` — `style.css:268-271`;
3. `inherit`;
4. an entry in the allowlist (§5.1).

JS is already compliant: the only thing it writes is `--font-scale` on
`<html>` (`static/js/app.js:268`). No JS sets an element font size inline
(`grep -rn 'fontSize' static/js/` finds config keys, comments, and SVG
fixture markup at `static/js/blocks.js:116` only).

### 3.2 Why literals exist at all: the four legal exceptions

| Exception | Value | Why it may not scale | Current proof |
|---|---|---|---|
| Count badge | `9px` (`--text-2xs`) | A numeral that grew to 12 px at XL would break the row height and the pill shape | `foundations.md:258`, `:294` |
| Touch field + phone prose | `16px`, `calc(16px * var(--font-scale))` | Below 16 px iOS zooms the viewport on focus; phone prose is px by design | `controls.md:907`; `style.css:7689`, `:8013`; `foundations.md:283-286` |
| Glyph | `--icon-*`, plus one-off `10/11/11.5/12/14/16/40/48px` | A glyph is art, not text; it must not balloon at XL — the convention stated at `style.css:33-35` | `style.css:4855`, `:4973`, `:5005`, `:3208`, `:1442`, `:1432`, `:7818`, `:2801` |
| Prose-relative | em multiples inside prose containers | Inline code and prose headings must follow the surrounding text size, whatever it is | `style.css:3374-3376`, `:3482`, `:3510`, `:5161`, `:5356` |

A new literal outside these four categories is a defect, exactly as
`foundations.md:302-303` already states ("A new `font-size` in px is a
defect unless it is one of these three") — this contract extends that rule
from px to every literal.

### 3.3 Glyph literals

Glyphs may stay literal, but each one is pinned on the allowlist with a
reason. Current pinned set: edit-bar unsaved dot `9px` (`style.css:1355`),
bookmark pin `11px` (`:3208`), tree star `11px` (`:3219`), graph depth
numeral `10px` (`:4855`), graph hint `11.5px` (`:4973`), graph chip `11.5px`
(`:5005`), chip dot `12px` (`:5061`), tab pin `14px` (`:1442`), edit-bar
action glyphs `16px` (`:1432`), recent-clear glyph `16px` (`:9061`), welcome
icon `48px` (`:2801`), mobile state glyph `40px` (`:7818`), designer rest
glyph `1.4rem` (`:6791`), designer state icons `1.6rem`/`2rem` (`:6690`, `:6716`), settings gear glyph `1.3rem`
(`:1557`), dot-designer slice glyph `.5rem` (`:7015`). Replacing these with a
`--text-*` step is **not** a goal; they are not text.

### 3.4 The em rule

`em` is legal only where the size must follow the element it sits inside:
the prose heading ladder (`style.css:3374-3376`, phone `:7692-7695`),
inline code `.9em` (`:3482`), `pre code` `.88em` (`:3510`), AI code `.92em`
(`:5161`), AI prose code `.82em` (`:5356`), fence label `.72em` (`:3571`,
`:3598`), and glyph arrows `.8em`/`.9em` (`:860`, `:3298`, `:5249`). `em`
is illegal as chrome sizing — an `em` in chrome is a literal wearing a
disguise, because its computed value depends on an ancestor nobody pinned.

---

## 4. `--font-scale` semantics

**Definition.** A unitless multiplier on `<html>`; default 1
(`style.css:36`). S/M/L/XL map to `0.9 / 1 / 1.15 / 1.3`
(`static/js/app.js:259-264`); `applyFontSize` writes it to
`documentElement` (`app.js:265-268`), persists it (`app.js:1271`), and
re-applies it at boot (`app.js:432`). `html { font-size:
calc(14px * var(--font-scale, 1)) }` (`style.css:295`) makes every rem in
the app follow it. `blocks.js` re-measures rendered blocks from the
computed size after a change (`app.js:270`; `static/js/blocks.js:341`).

**What scales:**

| Thing | Mechanism | Source |
|---|---|---|
| All six rem steps and any rem literal | root 14 px × scale | `style.css:295` |
| Prose em multiples | they multiply the rem base | §3.4 |
| Phone prose | `calc(16px * var(--font-scale))` | `style.css:7689` |
| Rendered diagram reference size | `--nb-ref-size: calc(16px * var(--font-scale))` | `style.css:7240` |
| Tab-bar height | `calc(34px * var(--font-scale))` | `style.css:690` |
| Side-panel header height | `min-height: calc(34px * var(--font-scale))` | `style.css:519` |

**What does not scale:** `--text-2xs` 9 px (`style.css:197`); `--icon-*`
(`:268-271`); `--topbar-h: 46px` (`:29`, used at `:321`); the phone target
height `--m-hit: 44px` (`:7230`); every glyph on the §3.3 list; the phone
px ladder inside the breakpoint blocks that start at `:7227`, `:8447`,
`:8768`, `:9038`, `:9102`, `:9161`.

**Layout-height rule.** A chrome band whose content is rem text must size
itself as `calc(<px> * var(--font-scale))` — the pattern the tab bar
(`:690`) and panel header (`:519`) already use — or it must be an explicit
exemption. The topbar is the one exemption: `--topbar-h: 46px` is fixed
because the shell, `body.topbar-hidden` (`:328`), and phone rules read it;
its text is `--text-ui-lg` (16.93 px at XL in a 46 px strip — no clipping,
the check foundations §11.3 already asks for at "1280 + XL"). New chrome
bands use the `calc` pattern; converting `--topbar-h` is out of scope here.

**Enforcement of this section is a test, not a comment:** the audit's XL
pass (§5.2) asserts the px column of §2.1 exactly, which fails if a new
step sneaks in unscaled or a scaled band stops following.

---

## 5. Enforcement design

Three layers. Layer 1 catches the literal at authoring time, layer 2
catches what reaches the screen, layer 3 catches what only eyes would.

### 5.1 Static — reject new literals

**Where:** `tests/static/test_typography.js` (new file, new folder —
`tests/` today holds only `browser/`, `dom/`, `fixtures/`, `manual/`,
`test_app.py`). Plain Node, zero dependencies. **How it runs:** wired into
`package.json` so the existing fast gate covers it:

```
"test": "node tests/static/test_typography.js && node tests/dom/test_dom.js"
```

`foundations.md` §11.3 already calls `npm test` "the fast gate"; the audit
joins it without a new command to remember.

**The seam.** The script scans exactly two files — `static/css/style.css`
and `static/css/vimnav.css` (`:63`, `:78`, `:100` hold literals too). It
strips comments, walks declarations with line numbers, and looks at every
`font-size` and at the size slot of every `font:` shorthand (`:303`,
`:537`, `:2417`). A declaration passes if its value is `var(--text-*)`,
`var(--icon-*)`, `inherit`, or `calc(16px * var(--font-scale))`. Anything
else must match an allowlist entry.

**The allowlist** is an array at the top of the script, one entry per
surviving literal:

```js
{ file: "style.css", selector: "#search-view .search-panel-filter-label", value: ".66rem",
  why: "small uppercase label; search-view.md §7.1", retires: "phase 2.5" },
```

Entries are pinned to `(file, selector, value)`. A new literal anywhere not
on the list fails. Changing an allowlisted value fails. Deleting the rule
leaves a stale entry, and the script counts matches, so stale entries fail
too — the list cannot rot and cannot quietly grow. Every entry carries
`retires`, the phase of §6 that deletes it; after migration only the four
§3 categories remain.

**False positives avoided by construction:**

| Source | Handling |
|---|---|
| Token block itself (`:197-203`) | custom properties, not `font-size` declarations — never matched |
| Phone/tablet `@media` blocks (`:7227`, `:8447`, `:8768`, `:9038`, `:9102`, `:9161` …) | px ladder is by design (`foundations.md:283-286`); the parser skips font sizes inside blocks whose media query contains `max-width` or `pointer: coarse`. The gap is covered by the runtime audit's phone pass (§5.2) |
| Prose em ladder and glyph `em`s (§3.4) | each is an allowlist entry pinned to its selector |
| Vendored CSS | `static/vendor/**` is not scanned; the two app files are |
| The `font:` shorthand | parsed explicitly, so `font: 0.9rem/1 …` (`:2417`) cannot smuggle a size past a `font-size`-only grep |

### 5.2 Runtime — audit computed sizes

**Where:** `tests/browser/test_typography_browser.js`, registered as one
more row in the existing `SUITES` array
(`tests/browser/run_all.js:17-32`) with its own port (5097 is free; used
ports run 5080–5099 with gaps at 5084–5085, 5087–5090, 5093, 5097). It copies
the harness every suite already uses: spawn the project's Python server
against a fresh temp notebook, drive Playwright with the located Chromium
(`tests/browser/test_core_ui_browser.js:9-18`; `tests/browser/chromium.js`),
viewport 1280×800. Playwright is already a devDependency
(`package.json`, `playwright ^1.63.0`) — no new dependency.

**The seam.** For each surface — welcome, tree + outline, search with hits,
sessions, AI panel, settings modal, edit window, table editor — the suite
walks visible text:

1. `document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)`; skip
   whitespace-only nodes.
2. Skip a node whose element fails `el.checkVisibility()` (hidden menus,
   unopened modals, templates).
3. Skip the element if it is inside a **vendored island** — any `svg`,
   `.katex`, or `.cm-editor` subtree. This is the false-positive wall:
   KaTeX, mermaid, graphviz, wavedrom, and CodeMirror all set their own
   sizes (`style.css:3726` documents the KaTeX case) and are not party to
   this contract. App glyphs are `<use>` sprites whose text is decorative;
   the enclosing button's label is still audited.
4. `getComputedStyle(el).fontSize` in px, rounded to 0.1. Map it against
   the expected set (below). **Fail on an unknown size**, reporting the
   selector chain, the computed px, and the nearest token.

**Expected set at M** = the seven steps × 14 (`9, 10.1, 11.2, 12.0, 13.0,
14, 16.1`) ∪ glyph px (`10, 11, 11.5, 12, 14, 16, 17, 22, 40, 48` — §3.3
plus `--icon-*`) ∪ prose em multiples of 14 (`.72 .8 .82 .88 .9 .92` em →
`10.1, 11.2, 11.5, 12.3, 12.6, 12.9`) ∪ prose heading ems (`1.05 1.2 1.4
1.7` × 14 → `14.7, 16.8, 19.6, 23.8`). The set is closed and lives in one
table in the suite.

**The XL pass** sets `--font-scale: 1.3` via
`document.documentElement.style.setProperty` and re-walks. Every rem member
of the set must move to its §2.1 XL column value; every px member must stay.
This is the §4 contract, executed.

**Role assertions** (the direct anti-drift check): for pinned role
selectors the suite asserts one size per role — all `.panel-title`
elements equal `var(--text-xs)`; the row-name group
(`.tree-name`, `.sp-file`, `.bookmark-name`, `.recent-name`,
`.session-name`, `.search-panel-hit-file`) shares one step,
`--text-body`; all `button`, `input`, `select` in the settings modal are
`--text-ui`. A second side panel that picks a different size fails here
even though both sizes are "legal".

**False positives avoided:** prose can only produce `--text-body` and the
enumerated em multiples (DOMPurify strips inline styles; the vendored
`static/vendor/purify.min.js` is the sanitizer); the audit's own fixtures
must not carry inline sizes — the lesson of
`tests/browser/test_figure_sizing_browser.js:88-98`, which injects
`font-size: 20px` demo divs. Phone pass (viewport 390, breakpoint blocks
active): expected set is the phone px ladder `12, 13, 14, 15, 16, 18, 20,
22, 40` plus `calc(16px × scale)`; ships with phase 2 of the migration,
not before.

### 5.3 Visual — optional screenshot diff

**What it adds:** the only layer that sees *interaction* failures — an
XL-size label clipping in the fixed 46 px topbar, a row height jumping
when `.74` becomes `.8`, a tab label colliding with its close button. A
correct size in a broken band is still a broken band.

**Why it is optional and not a gate:** baselines are not portable. The
stack resolves `-apple-system` differently per OS (`style.css:195`,
`:303`), antialiasing differs per host, and this repo runs its suites on
NixOS hosts where Playwright's bundled browser does not even start
(`tests/browser/chromium.js:5-7`). A pixel diff would fail on a different
machine, not on a regression.

**If ever wanted:** `page.screenshot()` per surface into
`tests/browser/baselines/<surface>.png` with an `--update` flag, compared
at a small tolerance. It stays manual, per-surface, run when a surface's
phase-2 delta lands. Nothing in §7's acceptance depends on it.

---

## 6. Migration order

The contract lands as two tiers of work, per surface, never as a sweep. One
exception was taken deliberately: the first call-site pass landed the token
swaps and most role rounding in a single commit, because the static ratchet
landed with it — every remaining literal is enumerated in the allowlist and
the count cannot rise, so the bookkeeping the per-surface order protects is
done by the check instead of by the commit boundary. Later passes follow the
order below.

**Tier 1 — pixel-neutral token swap.** Replace each literal whose value
already equals a step with `var(--text-*)` (`.72 → --text-xs`, `.8 →
--text-sm`, `.86 → --text-ui`, `.93 → --text-ui-lg`, `1rem → --text-body`,
`1.15rem → --text-lg`, `9px → --text-2xs`, plus the four `font:`
shorthands). Zero computed change — `--text-lg` and `--text-2xs` stop being
dead tokens, and the file stops teaching the literal habit.

**Tier 2 — role rounding.** Snap the off-scale values to their role step
(§2.4). These change pixels — each delta is recorded in the surface doc's
exception table, as `docs/ui/guidelines.md` §1.1 already requires
("A document that changes a pixel must say so twice").

**Per-surface order** — most-isolated and worst-off first:

| Phase | Surface | Literal hot spots | Why this order |
|---|---|---|---|
| 0 | Both checks land in **inventory mode**: allowlist seeded with today's full inventory; audit prints unknown sizes, exits 0 | — | Tests green from commit one; the inventory becomes the to-do list |
| 1 | Tier-1 swap, file-wide, one commit | all 6 token-value literals | No visual delta; jsdom and browser suites cannot regress |
| 2.1 | Settings overlay | `.68 :1931`, `.74 :1970/:2010`, `.76 :2005`, `.78 :1679/:1985`, `.82 :1907/:1942`, `.85 :1781`, `.89 :2217`, `.9 :2290` | Worst cluster; self-contained modal; nothing reads its sizes |
| 2.2 | Designers | `.64 :6968/:7078`, `.7 :6783`, `.73 :6554/:6786`, `.78 :6759`, `.8 :6746`, `.82 :6607/:6763` | Self-contained modals (`docs/ui/diagram-designers.md`) |
| 2.3 | AI panel | `.7 :5601`, `.72 :5856/:5956`, `.75 :5787`, `.76 :5574/:5891`, `.84 :8127`, `.92em :5161` | Follows `docs/ui/ai-panel.md` §10's own landing order |
| 2.4 | Sessions + workspace pickers | `.9 :8317-8338`, `.76 :8340/:8345`, `.95 :8385` | Aligns with `docs/ui/sessions.md`; the session row itself is already `--text-body` |
| 2.5 | Search remainder | `.66 :4110`, `.74 :4567`, `.72 :4574`, `.8 :4580`, `.95 :4705` | Completes `search-view.md` §7.1's already-approved deltas |
| 2.6 | Graph chrome, dialogs, toasts, welcome | `.78 :4741`, `.74 :4773`, `.95 :2406`, `1.14 :8820`, `1.4rem :2807` | Last chrome; welcome one-offs join the allowlist |
| 3 | Harden: audit exits 1 (drop inventory tolerance); phone pass; final allowlist is only §3 categories | — | End state |

**Keeping tests green.** `tests/dom/test_dom.js` asserts structure, not
pixels (its size check is `dataset.nbSizing`, `:5781-5782`), so tier 1
cannot touch it. Figure sizing depends on the **prose** computed size
(`static/js/blocks.js:341`, `style.css:3726`) and prose stays
`--text-body` — chrome rounding never reaches it. Mobile targets are px
(`--m-hit: 44px`, `style.css:7230`) and do not move. Per phase: run
`npm test` plus the touched surface's browser suite
(`node tests/browser/run_all.js --only=<name>`); run
`npm run test:browser:all` at phase 3.

---

## 7. Acceptance criteria

1. `node tests/static/test_typography.js` exits 0 on HEAD; exits 1 on a
   planted `font-size: .87rem` in `static/css/style.css` and on a planted
   `font: .9rem/1 …` shorthand (the script self-tests both directions).
2. `grep -nE 'font-size: \.[0-9]+rem' static/css/style.css` returns only
   lines whose `(selector, value)` is on the script's allowlist; the
   script proves this itself by failing on any unlisted match.
3. Every allowlist entry carries `why` and `retires`; after phase 2 no
   entry has `retires` set to a phase that has already landed (the script
   fails on stale entries whose selector no longer matches).
4. `node tests/browser/test_typography_browser.js` exits 0 at M and at XL:
   every visible, non-island text node's computed `font-size` maps to the
   §5.2 expected set; at XL every rem member equals its §2.1 XL column and
   every px member is unchanged.
5. Role assertions pass: every `.panel-title` equals `var(--text-xs)`; the
   row-name selector group shares one step; settings-modal controls are
   all `--text-ui` (`tests/browser/test_typography_browser.js`).
6. `grep -n 'search-adv-font\|search-adv-meta\|search-label-size'
   static/css/style.css` returns nothing.
7. `grep -c 'font-size: var(--text-2xs)'` and
   `grep -c 'font-size: var(--text-lg)'` on `static/css/style.css` are
   each ≥ 1 — no dead steps.
8. `npm test` and `npm run test:browser:all` are green, with the typography
   suite registered in `tests/browser/run_all.js` `SUITES` on port 5097.
9. Every tier-2 pixel delta appears in its surface doc's exception table
   with old value, new value, and delta (`docs/ui/guidelines.md` §1.1);
   tier 1 produced none (verified by the before/after screenshot pair
   recorded in the phase-1 commit message).

---

## 8. What not to do

| Rejected | Reason |
|---|---|
| `clamp()` fluid type scale | It couples size to viewport, so the user's S/M/L choice stops being the only multiplier and the computed-size set in §5.2 becomes unbounded. Also solves a problem this app does not have — it is windowed, not mobile-first |
| Per-component tokens (`--session-row-size`, `--settings-label-size`) | The search view's local aliases are being retired for exactly this reason (`search-view.md` §7.1, "No local alias survives") — they drifted from the scale and hid the step name from every audit |
| px-only scale | S/M/L would do nothing (`--font-scale` multiplies rem, `style.css:295`), and the 16 px iOS rule and 9 px badge are already px — a px-only rule would drag prose into fixed sizes |
| rem-only (kill the px exceptions) | Breaks the iOS 16 px zoom rule (`controls.md:907`), the fixed badge, and every glyph |
| stylelint or any lint dependency | Forbidden by constraint (no new dependency), and a generic property allowlist cannot express roles, the `calc()` exemption, or the expiry semantics of the allowlist |
| One big-bang rewrite commit | 264 literal declarations in one diff is unreviewable; pixel regressions would land silently and no exception table could be written for it |
| Automated sed sweep for tier 2 | Rounding is a role decision, not arithmetic — `.9rem` is a row in sessions (`sessions.md:35`) but a heading elsewhere; nearest-value snapping would assign wrong roles at scale. Tier 1 (exact-value swap) is the only sweepable part |
| New display steps (`--text-xl`, `--text-2xl`) for the 48 px welcome icon and empty-state glyphs | Four one-off decorations do not justify a scale step; they are glyphs (§3.3), and a step would invite chrome to grow upward — YAGNI |
| Retiring the phone px ladder by tokenising it | The phone surface is px by design (`foundations.md:283-286`); forcing rem into the breakpoint blocks would double-scale phone text (px base 16 × rem) |
