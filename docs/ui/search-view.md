# Search view — query, Advanced options, results

Status: Current spec — pre-implementation.

Reference mockup: [`search-view-mockup.html`](search-view-mockup.html) — nine boards: idle
with the field focused; typing over previous results; five one-per-note results with
highlights and the active row focused; no matches with the alternate-target action; an
error with Retry focused; a timeout summary; Advanced open with all four filters; the
140 px panel expanded; and the phone drawer. Dark, plus light copies of the results,
Advanced, and error boards.

**Normative source.** This document owns the inside of `#search-view`: the query row,
the Advanced disclosure, the four filters, the results summary, the note line, the
result list, and every state and key those surfaces expose. It reads
[`foundations.md`](foundations.md) for every token and [`controls.md`](controls.md) for
input, chip, list-row, button, and focus anatomy. It does not change the shell, the
activity rail, the tab strip, Explorer, Sessions, or AI. The drawer frame stays owned by
`docs/archive/design/mobile-shell.md` and [`shell-frame.md`](shell-frame.md) §6. The wire stays
owned by `docs/contracts/http-api.md` §Search.

Source material, not normative: `docs/archive/design/search-panel.md`,
`docs/archive/design/search-panel-advanced.md`, `docs/archive/design/search-panel-clear.md`,
`docs/product/search-options.md`, `docs/product/search-gaps.md`. Where this document and
a shipped record disagree, §11 records the conflict and names the replacement.

Every claim about current code cites `file:line`.

**The default is one result per note.** `searchUnique` defaults to `true`
(`static/js/app.js:72`); the panel sends `unique=1` whenever the target is content
(`static/js/activity.js:877-883`). The list is therefore a list of notes, not a list of
occurrences, unless the user chooses **All matches**.

---

## 1. Anatomy

### 1.1 At the default 240 px

```
┌ #search-view  240 ───────────────────────────────┐
│ .panel-header            34   SEARCH          ‹  │  fixed
├──────────────────────────────────────────────────┤
│ .search-panel-controls                           │
│   [ Search notebooks…                    × ]     │  36
│   Advanced ⌄                                    │  24
│   ┌ .search-panel-advanced (hidden) ──────────┐  │
│   │ SEARCH IN        GROUPING                 │  │
│   │ [ Content ]      [ All matches ]          │  │  when open
│   │ [ File name ]    [ One per note ]         │  │
│   │ MATCH CASE                            [Aa] │  │
│   │ SORT                                      │  │
│   │ [ Path (A–Z)                          ▾ ] │  │
│   └───────────────────────────────────────────┘  │
├──────────────────────────────────────────────────┤
│ .search-panel-summary       5 notes · 11 matches │  fixed, 1 line
│ .search-panel-note     Click a row to open its…  │  fixed, 1 line
├──────────────────────────────────────────────────┤
│ .search-panel-list                               │  the only scroller
│   ┌ option ────────────────────────────────────┐ │
│   │ pinout.md (hardware)           4 matches   │ │
│   │ The 3V3 rail feeds the sensor breakout…    │ │
│   └────────────────────────────────────────────┘ │
│   …                                              │
└──────────────────────────────────────────────────┘
```

The view is a flex column (`static/css/style.css:296-303`). The header, controls zone,
summary, and note are `flex: 0 0 auto`; the list is `flex: 1 1 auto; min-height: 0;
overflow: auto` (`style.css:4273-4279`). Nothing else scrolls.

The header is the frame's header pattern: 34 px on desktop, a collapse control at the
trailing edge (`activity.js:447-455`; `shell-frame.md` §4.2). The shared `.panel-header`
still ships at its padding-derived height today (`style.css:329-343`); the height budget
below uses the frame's 34 px target. On the phone the same node is 52 px and the control
becomes `×` (`activity.js:278-286`; `style.css:7252-7264`).

### 1.2 At the 140 px floor

The side panel floors at `140px` (`foundations.md` §8.1; `app.js:860`). The view keeps
the same DOM and the same vertical order. Three things change, all driven by the panel's
own width, not the viewport:

| At ≤ 227 px container | Effect |
|---|---|
| The filter grid becomes one column | Search in, Grouping, Match case, Sort stack; each track stays vertical. No horizontal scroll. `style.css:4360-4366` |
| The sort select narrows | The native arrow and a 24 px right reserve stay; a long label ellipsizes and its `title` carries the full text (`activity.js:725-729`) |

| At ≤ 199 px container | Effect |
|---|---|
| The Advanced settings summary is visually clipped | It keeps the screen-reader-only pattern and stays `aria-describedby` of the trigger. `style.css:4368-4388` |
| The count badge appears | `Advanced 2 ⌃`; the badge carries the number of non-default filters, 1–4. The trigger's `title` and description carry the names. |

At 140 the query row holds only the field and its clear button; the case toggle is
inside Advanced, so the field keeps the full width (`style.css:3899-3911`).

```
┌ 140 ──────────────┐
│ SEARCH          ‹ │  36
│ [ Search…     × ] │  36
│ Advanced 2 ⌃      │  24, badge only
│ SEARCH IN         │
│ [ Content ]       │  30
│ [ File name ]     │
│ GROUPING          │
│ [ All matches ]   │  30
│ [ One per note ]  │
│ MATCH CASE    [Aa]│  32
│ SORT              │
│ [ Path (A–Z)  ▾ ] │  36
├───────────────────┤
│ 5 notes · 11 m…   │  ellipsis
│ …                 │
└───────────────────┘
```

### 1.3 Phone drawer

Search opens the drawer at 100 % width (`style.css:7232`), full height minus the
drawer's own header and footer. The frame is owned by `shell-frame.md` §6.2 and
`mobile-shell.md` §4.3; the search view contributes the query field as the drawer's
initial focus target (`static/js/mobile.js:332-338`, `:353`).

```
┌ drawer 390 ─────────────────────────┐
│ SEARCH                           ×  │  52
│ [ Search notebooks…            × ]  │  44, 16 px
│ Advanced ⌄                          │  44
│ 5 notes · 11 matches                │  30
│ Click a row to open its first match.│
├─────────────────────────────────────┤
│ pinout.md (hardware)    4 matches   │  52
│ The 3V3 rail feeds the sensor…      │
│ …                                   │
└─────────────────────────────────────┘
```

Every interactive target is 44 px (`--control-h-touch`), every field is 16 px fixed
(`foundations.md` §4.4), and the filter grid stays two columns because each column has
about 165 px at 390.

### 1.4 Current DOM and CSS map

The brief's ranges are close; these are the exact starts, verified against the files.

| Part | DOM (`static/js/activity.js`) | CSS (`static/css/style.css`) |
|---|---|---|
| View host | `#search-view` in `templates/index.html:266` | `#search-view` tokens `:3865-3888` |
| Header | `:447-455` | `.panel-header` `:329-356` |
| Input row | `:456-486` | `:3899-3931` |
| Clear | `:466-484` | `:3940-3975` |
| Case toggle | `:558-576` | `:3977-4025` |
| Advanced row | `:583-603` | `:4028-4104` |
| Advanced wrapper | `:605-609` | `:4106-4107` |
| Filters grid | `:492-581` | `:4109-4150` |
| Mode track / options | helpers `:512-537` | `:4152-4203` |
| Sort select | `:540-556` | `:4205-4227` |
| Results summary | `:614-622` | `:4229-4252` |
| Note | `:624-627` | `:4253-4260` |
| Retry / alternate action | `:910-919`, `:961-980` | `:4261-4272` |
| List | `:629-634` | `:4273-4279` |
| Empty state | `:954-958` | `:4280-4286` |
| Result row | `:997-1053` | `:4299-4358` |
| Container queries | — | `:4360-4388` |

### 1.5 Height budget

Approximate, at `--font-scale: 1`, with Advanced collapsed:

| Zone | 240 px | Phone | Notes |
|---|---|---|---|
| Header | 34 | 52 | frame-owned |
| Controls | 88 | 124 | 12 top + field + 8/12 gap + Advanced row + 8/12 bottom |
| Results summary | 27 | 30 | one line; wraps only for an error or a timeout |
| Note | 22 | 22 | unique-mode hint or the zero state |
| List | remainder | remainder | the only scroller |

Opening Advanced adds about 182 px on desktop and 240 px on the phone. On a short
viewport the list can reach zero height; the controls stay pinned and the user collapses
Advanced to recover. Do not make the controls scroll.

---

## 2. Query row

### 2.1 Markup

```html
<div class="search-panel-input-row">
  <div class="search-panel-input-wrap">
    <input type="search" class="search-panel-input"
           placeholder="Search notebooks…" aria-label="Search notebooks">
    <button type="button" class="search-panel-clear"
            aria-label="Clear search" title="Clear search" hidden>
      <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <path d="M2.5 2.5 9.5 9.5M9.5 2.5 2.5 9.5" fill="none"
              stroke="currentColor" stroke-width="1.5"
              stroke-linecap="round"/>
      </svg>
    </button>
  </div>
</div>
```

The row is one flex child; the case toggle is **not** here. It is the fourth filter
inside Advanced (`activity.js:558-580`; asserted by `tests/dom/test_dom.js:2580-2582`).
There is no leading magnifier: adding one would take 16 px plus a gap from a 140 px
field for no new affordance.

### 2.2 Field

| Property | Value |
|---|---|
| Height | `--control-h-lg` (36) desktop; `--control-h-touch` (44) phone |
| Padding | `0 var(--space-3)`; `padding-inline-end: var(--control-h-body)` desktop, `calc(var(--control-h-touch) + var(--space-1))` phone |
| Face | `--surface-well` — the field is recessed into the panel |
| Border | `var(--stroke-1) solid var(--border-strong)`; never `--border` |
| Radius | `--radius-sm` desktop; `--m-radius` (10) phone |
| Type | `--text-ui` / `--lh-flat`; 16 px fixed on the phone |
| Placeholder | `--text-muted` |

| State | Delta |
|---|---|
| rest | as above |
| hover | border `--accent` |
| focus | border `--accent` and a 3 px `--accent-soft` halo; `outline: none` **only** because the border and halo are the visible replacement |
| filled | no change; the field never recolours for a value |
| disabled | never. Search stays usable while a request is in flight, so the user can type a replacement or clear |
| invalid | none. A server 400 is a result-state error line, not a field-invalid state |

This replaces the current 32 px height on `--bg` with `--border` and a 2 px outline
(`style.css:3913-3931`). §11 C10 records the change.

### 2.3 Clear

| Property | Desktop | Phone |
|---|---|---|
| Box | `--control-h-sm` 24 × 24 | `--control-h-touch` 44 × 44 |
| Inset | `--space-1` (4) from the field's inner right edge | 0 |
| Glyph | `--icon-sm` 14, 1.5 stroke, drawn cross | same |
| Radius | `--radius-xs` | `--m-radius` |
| Reserved slot | `--control-h-body` 32 | `calc(var(--control-h-touch) + var(--space-1))` 48 |

- Visible only when `input.value.trim() !== ""`; hidden with the `hidden` attribute, so it
  leaves the tab order and the accessibility tree (`activity.js:1176-1178`).
- `pointerdown` is prevented so a press does not move focus out of the field
  (`activity.js:1186`); `click` clears and returns focus (`activity.js:1187-1190`).
- Clearing runs `setIdle()`: cancels the debounce, bumps the request token, empties the
  summary, note, and list, and hides the clear button. It sends no request and does not
  dispatch `input` (`activity.js:846-861`, `:1182-1190`).
- The field's width does not change when the button appears or disappears; the slot is
  always reserved.
- `Esc` with a non-empty query calls the same path; `syncClear()` hides the button.

### 2.4 Typing, debounce, Enter

| Event | Current behaviour |
|---|---|
| input, non-empty | `syncClear()`; cancel the previous timer; schedule `runSearch` 250 ms later (`activity.js:1192-1197`) |
| input, whitespace only | `setIdle()`; no request (`activity.js:1195`) |
| 250 ms quiet | `runSearch()`; latest-response-wins token (`activity.js:862-902`) |
| `Enter` in the field | `preventDefault()`; `runSearch({focusFirst:true})` (`activity.js:1198-1200`). It cancels the debounce and runs now. When results arrive, focus moves to the first option (`activity.js:1067-1068`). It does **not** open a row and does not move focus before the response. |
| `Enter` on a focused row | Opens that row (list handler, `activity.js:1240-1247`) |
| any option change with a non-empty query | Runs immediately, no debounce (`activity.js:1256-1300`) |
| any option change with an empty query | Persists the setting; sends no request |

The two-press flow is deliberate: the first `Enter` puts the keyboard in the result list,
the second opens the active row. It matches the shipped test
`tests/dom/test_dom.js:2861` and `search-options.md` §4.1. `search-panel.md` §6.1 said
`Enter` opens the active row; §11 C4 records the replacement.

### 2.5 `Esc`

| Focus | Condition | Effect |
|---|---|---|
| Query | non-empty | `preventDefault` + `stopPropagation`; clear the query, results, summary, and note; focus stays in the field; the phone drawer stays open (`activity.js:1201-1207`) |
| Query | empty | The event is not stopped, so the shell handles it: on the phone the drawer closes; on desktop it is a no-op (`mobile.js:1134-1139`) |
| Advanced panel | focus inside | Collapse Advanced and return focus to the trigger; the query is untouched (`activity.js:1168-1174`) |
| Result list | any | Return focus to the query and select its text; do not clear it (`activity.js:1248-1254`) |

One press, one layer. The order is menu → sheet → drawer → viewer; search adds no layer
because Advanced is in flow, not an overlay.

### 2.6 IME

The shipped listener has no composition guard (`activity.js:1192-1197`). Target:

```js
let composing = false;
input.addEventListener("compositionstart", () => { composing = true; });
input.addEventListener("compositionend", () => {
  composing = false;
  syncClear();
  scheduleSearch();          // the existing 250 ms path
});
input.addEventListener("input", (e) => {
  syncClear();
  if (composing || e.isComposing) return;
  scheduleSearch();
});
```

`keydown` ignores `Enter` and `Esc` while `e.isComposing` is true, so a candidate is
committed (or the composition is cancelled) before either key reaches the panel. This is
the only change to the query lifecycle.

### 2.7 After a zero result

The query stays in the field and the clear button stays visible. The summary reads
`0 matches` (or `0 notes` in File name mode); the state block under it reads
`No matches found.` with the alternate-target action. See §5 and §6.

The query is not echoed in the zero state. That is the shipped copy
(`activity.js:957`) and it is pinned by `tests/dom/test_dom.js:2832-2834` and `:3307`.
Adding a quoted query would break the exact-text assertion and is not worth it.

---

## 3. Options

### 3.1 Visible versus Advanced

| Always visible | Inside Advanced (default collapsed) |
|---|---|
| Header `Search` + collapse/close | Search in: `Content` / `File name` |
| Query field + clear | Grouping: `All matches` / `One per note` |
| `Advanced` trigger + settings summary/badge | Match case: `Aa` toggle |
| Results summary, note, list | Sort: `Path (A–Z)` / `Recently modified` / `Most matches` |

The case toggle is inside Advanced and has been since 2026-10-30
(`docs/archive/design/search-panel-advanced.md:13-16`; `activity.js:558-580`). It is named in the
collapsed summary and counted in the badge, which the earlier record did not allow
(§11 C2, C3).

### 3.2 The four filters

Order is fixed by the DOM and by the tests: target, grouping, case, sort
(`activity.js:581`; `tests/dom/test_dom.js:3198-3203`).

| # | Caption | Control | Options | Default | Behaviour |
|---|---|---|---|---|---|
| 1 | `Search in` | `role=radiogroup`, native radios, vertical track | `Content` / `File name` | `Content` | Persists `searchTarget`; re-runs. File name sends `name=1` and omits `unique` (`activity.js:877-883`) |
| 2 | `Grouping` | `role=radiogroup`, native radios, vertical track | `All matches` / `One per note` | `One per note` | Persists `searchUnique`; re-runs. Hidden and dormant in File name mode |
| 3 | `Match case` | Native checkbox inside a chip toggle, caption on the left, toggle on the right | `Aa` | off | Persists `searchCaseSensitive`; re-runs; emits `search-case-changed` |
| 4 | `Sort` | Native `<select id="search-panel-sort">` | `Path (A–Z)`, `Recently modified`, `Most matches` | `Path (A–Z)` | Persists `searchSort`; re-runs. In File name mode `Most matches` is disabled and a stored `count` is demoted to `path` (`activity.js:708-724`) |

Request mapping is owned by the contract: `case=1`, `unique=1`, `name=1`, `order=`,
`desc=1` (`docs/contracts/http-api.md` §Search; `static/js/api.js:117-129`). The UI does
not invent a parameter.

In File name mode the Grouping **wrapper and track** both get `.is-hidden`
(`activity.js:709-713`); the control remains in the DOM and keeps its listener, so a
late config load and a test `change` event still work. The sort row spans both columns;
the target track becomes horizontal when it is the only filter (`style.css:4122-4129`).

### 3.3 The badge

The badge counts non-default filters. It is not a count of results.

```
n = (target === "name")
  + (caseSensitive)
  + (target !== "name" && !unique)
  + (sort !== "path")
```

Maximum 4. Grouping is excluded while File name mode makes it dormant; a demoted
`Most matches` never appears (`activity.js:686-704`).

| Property | Value |
|---|---|
| Element | `<span class="search-panel-advanced-badge" aria-hidden="true">2</span>` |
| Visibility | hidden by default; `display: inline-flex` only inside the 199 px container query and only while `.search-panel-advanced-row.has-nondefault` |
| Copy | the numeral, 1–4; empty when everything is default |
| Look | `--text-2xs`, `--fw-bold`, `--accent` text and `var(--stroke-1)` outline, no fill, `--radius-pill`, `min-width: 2ch`, tabular numerals, height `--space-4` desktop / `--space-5` phone |
| Why `aria-hidden` | the full names are already the trigger's `aria-describedby`; the numeral would duplicate them |

### 3.4 The settings summary

Right-aligned in the Advanced row; one line; `--text-xs`; `--text-muted`; ellipsis; a
`title` with the full text. Fragments are joined with ` · ` in shipped order:

1. `File name` when the target is name
2. `Match case` when case is on
3. `All matches` when the target is content and grouping is not one-per-note
4. the selected sort label when the sort is not `Path (A–Z)`

The order is `activity.js:672-684`. It is not alphabetical and not grouped by job; it is
the shipped order and the tests assert two of its combinations
(`tests/dom/test_dom.js:3235-3250`). Keep it.

The summary is a description, not a live region. Changing a filter announces through
the control itself; adding `aria-live` here would double every announcement.

### 3.5 The disclosure

| Property | Value |
|---|---|
| Element | `<button type="button" class="search-panel-advanced-toggle" aria-expanded="false" aria-controls="search-panel-advanced">` |
| Label | `Advanced`; never changes to `Hide` |
| Target | `--control-h-sm` 24 desktop; `--control-h-touch` 44 phone |
| Summary description | `aria-describedby="search-panel-advanced-summary"` only while a non-default exists; removed otherwise |
| Panel | `<div id="search-panel-advanced" hidden>`; no role; removed from the tree and tab order when hidden |
| Open/close | `hidden` plus `aria-expanded`; no height animation; no result re-run |
| Escape | Inside the panel: collapse and focus the trigger |
| Phone | Opening blurs the query so the soft keyboard retracts (`activity.js:1160-1166`) |

Opening does not move focus into the first filter. The user pressed a disclosure; `Tab`
enters the filters.

### 3.6 Record reconciliation

| Question | Earlier record | Shipped and this document |
|---|---|---|
| Trigger name | `Options` (`search-panel.md` §4) | `Advanced` |
| Grouping default | `All matches` (`search-panel.md` §4) | `One per note` (`search-panel-advanced.md` §5.5; `app.js:72`) |
| Grouping location | always visible under the query (`search-panel.md` §3.1) | inside Advanced |
| Case location | beside the query, never in the summary (`search-panel-advanced.md` §1.2) | inside Advanced; named in the summary; counted |
| Badge maximum | 3 (`search-panel-advanced.md` §2.1) | 4, including Match case |
| Non-default summary | 3 fragments, no case | 4 fragments, case included |

### 3.7 Kept from the shipped records

These decisions are shipped, tested, and unchanged. They are listed so a coder does not
mistake this pass for a rewrite.

| Decision | Source | Why it stands |
|---|---|---|
| 250 ms debounce; `Enter` runs now; `Esc` clears a non-empty query | `activity.js:1192-1210`; `search-panel.md` §6.1 | Tested and predictable; only IME guards are added |
| Latest response wins; a clear discards the in-flight response | `activity.js:862-902`, `:846-861` | Tested (`tests/dom/test_dom.js:2915-2940`); no abort controller is needed |
| Previous rows stay visible and clickable while loading and after an error | `activity.js:862-902`, `:906-920` | Avoids flicker and keeps recovery in place |
| One per note is the default; the count is exact; the snippet is the first match | `app.js:72`; `app.py:3944-4040`; `activity.js:1024-1044` | The requested behaviour and the product default |
| Sort labels and request mapping | `activity.js:540-556`, `:877-883`; `api.js:117-129` | The server already supports all three orders |
| Summary caps, per-file suffix, and timeout suffix | `activity.js:784-817`, `:34-35` | Honest about what was left out |
| Listbox roles, `aria-selected`, roving tabindex, list keys | `activity.js:629-634`, `:997-1002`, `:1090-1102`, `:1211-1254` | Shipped and asserted at `tests/dom/test_dom.js:2863-2894` |
| Advanced starts collapsed; its open state is session-only; filter values persist | `activity.js:649`, `:666-670`; `search-panel-advanced.md` §2.3 | No config key for transient chrome |
| The query is not persisted | `app.js:69-77` (no query key) | A reload starts clean; results never outlive the page |
| Phone: 100 % drawer, 44 px targets, 16 px fields, focus on open, tap closes | `style.css:7232`, `:7350-7418`; `mobile.js:332-338`, `:931-943` | Shipped and covered by the mobile browser suite |
| No client-side dedupe, no regex, no scope, no paging | `search-options.md` §4.2; `search-gaps.md` F2/G6/G14 | Server-owned shapes; the rejected list is §11.2 |

§11 records each superseded decision as a conflict with evidence.

---

## 4. Results

### 4.1 One per note — the default

The server groups by exact relative path and returns one item per note with `count`, the
exact number of occurrences, and `line` / `col` / `snippet` for the first occurrence
(`app.py:3944-4040`; `docs/contracts/http-api.md` §Search). The row shows:

```
pinout.md (hardware)                      4 matches
The 3V3 rail feeds the sensor breakout through a ferrite bead.
```

- The row is a `<button>`; the whole row opens the note at its first match.
- The count is text: `4 matches` / `1 match`; its `title` is `total occurrences in this note`.
- No line label. The click finds the first rendered occurrence, not a source line
  (`search-options.md` §4.2); a line label would promise precision the jump does not have.
- A missing or malformed `count` renders no count element; never `undefined`, `NaN`, or an
  invented number (`activity.js:1026-1033`; `tests/dom/test_dom.js:2808-2812`).
- The note line under the summary says `Click a row to open its first match.`
  (`activity.js:991-994`).

### 4.2 All matches and File name

| Mode | Row |
|---|---|
| All matches | One row per returned hit. Right meta is `line N`. The summary is `M matches in N notes`; a per-file cap appends ` · some notes have more matches` (`activity.js:796-807`) |
| File name | One row per matching note. No count, no line, no snippet (`activity.js:1023-1047`). The summary is `N notes` (`activity.js:812-817`) |

The grouping mode is not a client-side filter. The server owns both shapes; the client
never dedupes what the server returned.

### 4.3 Path and name

`hitPathParts()` splits at the last `/` (`activity.js:55-62`). The basename is
`.sp-file`, semibold; the directory is `.sp-dir`, muted, rendered as `" (" + dir + ")"`.
A root-level note has no directory text. The full path is the `title` of
`.search-panel-path` (`activity.js:1008-1020`), so a truncated path stays recoverable on
hover and to assistive technology as the description.

### 4.4 Snippets and highlights

- One line from the server, with every hit wrapped in `<<` … `>>`
  (`docs/contracts/http-api.md` §Search).
- `buildSnippet()` splits on those markers and creates `<mark>` nodes with
  `textContent`; server text is never assigned through `innerHTML`
  (`activity.js:1072-1088`).
- The snippet is `.search-panel-hit-snippet`: `--text-sm`, `--text-muted`, pre-wrap,
  `overflow-wrap: anywhere`.
- `mark`: `--accent-soft` face, `--text-primary` text, `--radius-xs`, 2 px horizontal
  padding. Primary on the wash is 9.1:1 dark / 12.4:1 light; accent on the wash is not
  used.
- In one-per-note mode only the first match's snippet is shown. In all-matches mode each
  row shows its own snippet. In File name mode there is no snippet.

### 4.5 Counts and the summary line

`plural()` is the only pluraliser (`activity.js:780-782`). Exact strings are in §6.

| Mode | Normal | Truncated (`truncated: true`) |
|---|---|---|
| One per note | `5 notes · 11 matches` | `200 notes shown — more results exist` |
| All matches | `11 matches in 5 notes` | `200 matches shown — more results exist` |
| File name | `5 notes` | `200 notes shown — more results exist` |

Suffixes append in this order: ` · some notes have more matches` (all-matches only, when
`perFileTruncated`) then ` · search stopped early — results may be incomplete` (when
`timedOut`). Both flags can be true with `truncated` (`docs/contracts/http-api.md` §Search).

The summary is a polite live region with `aria-atomic="true"` (`activity.js:615-618`).
The text is set with `textContent` (`activity.js:822-828`).

### 4.6 Sort

| Label | Request | Order |
|---|---|---|
| `Path (A–Z)` | `order=path` | case-insensitive path A–Z (`app.py:4187-4190`) |
| `Recently modified` | `order=mtime&desc=1` | newest first |
| `Most matches` | `order=count&desc=1` | most matches first |

There is no ascending/descending control (`search-options.md` §5 O10). In File name mode
`Most matches` is disabled and a stored value is demoted to `path`; the disabled option
keeps its place in the native list and uses `--text-muted` (`activity.js:715-721`;
`style.css:4227`).

The select mirrors its selected label into `title` because a 140 px select clips it
(`activity.js:725-729`).

### 4.7 The listbox model

The shipped model is a **single-select listbox with a roving tabindex**:

| Element | Contract |
|---|---|
| `.search-panel-list` | `role="listbox"`, `aria-label="Search results"`, `aria-busy` (`activity.js:629-634`) |
| `.search-panel-hit` | `role="option"`, `aria-selected` (`activity.js:997-1002`) |
| Active row | `.is-active` + `aria-selected="true"` + `tabindex="0"`; every other row `tabindex="-1"` and `aria-selected="false"` (`activity.js:1090-1102`) |
| Focus | Moves to the active option; the listbox itself is never focused |
| Selection | There is one active row. It is both the keyboard cursor and the row `Enter` opens. There is no separate persistent selection and no multi-select |

Tests assert the roles, `aria-selected`, and the single `tabindex="0"`
(`tests/dom/test_dom.js:2863-2874`). Do not replace the roles with a grid or a menu.

### 4.8 Opening

`openHit()` (`activity.js:1113-1144`):

1. It records whether the file was already open.
2. It awaits `NB.tabs.open(file)`.
3. It detects a swallowed failed read by checking `NB.tabs.isOpen(file)`.
4. On success it calls `NB.viewer.jumpToMatch(query, caseSensitive)` on the next frame in
   content mode; File name mode does not jump.
5. On failure it leaves no phantom tab, restores an already-open tab, and replaces the
   summary with `Could not open “{path}”. It may have been moved or deleted.` and a
   `Refresh results` button. It never uses `alert`.

The query used for the jump is the one that produced the row (`visibleQuery`), not the
live field text (`activity.js:994-1005`, `:1054-1057`). This matters while a newer query
is in flight over older rows: the old rows keep opening their own term.

### 4.9 Keyboard

| Where | Key | Action |
|---|---|---|
| Query | `Enter` | Run now; focus the first option when rows arrive |
| Query | `Esc` | Clear if non-empty; otherwise let the shell close the drawer |
| Query | arrows | Native caret movement. The panel does not move the active row from the field (`activity.js:1198-1210`) |
| List | `ArrowDown` / `j` | Next row |
| List | `ArrowUp` / `k` | Previous row |
| List | `Home` / `End` | First / last row |
| List | `Enter` / `Space` | Open the active row |
| List | `Esc` | Focus the query and select its text |

`j` / `k` are handled only by the list, so typing them in the query is still typing. The
list handler is on the list container and receives bubbled keydowns from the focused
option (`activity.js:1211-1254`).

### 4.10 Two hundred rows

The server caps at 200 matches by default (`app.py:113`; `MAX_TOTAL_MATCHES`). The panel
builds every returned row in one pass. There is no virtual list, no paging, and no
spinner. At 200 rows the list scrolls; the active row is scrolled into view with
`block: "nearest"` on each active change (`activity.js:1100-1101`).

Do not add "Show more" or an offset. Paging needs a stable contract and a real case for
it (`search-options.md` §5 O9, `search-gaps.md` G14).

---

## 5. States

Every state keeps the query and all filter controls visible. Only the summary, note, and
list change. No state adds a spinner, a toast, or an overlay.

| State | Entered when | Summary | Note | List | ARIA |
|---|---|---|---|---|---|
| **Idle** | query trimmed empty | empty | hidden | empty | `aria-busy="false"` |
| **Waiting** | a non-empty value changed, under 250 ms | previous (never an error) | previous | previous | unchanged |
| **Loading** | request in flight | `Searching…` | previous | previous rows, dimmed, clickable | `aria-busy="true"` |
| **Results** | at least one match | §4.5 copy | unique hint, or hidden | rows | `aria-busy="false"` |
| **No results** | zero matches | `0 matches` / `0 notes` plus any timeout suffix | state block: `No matches found.` + other-target action | empty listbox | `aria-busy="false"` |
| **Error** | non-2xx or transport failure | `Search error: {message}` + `Retry` | previous | previous rows kept, still usable | summary `role="alert"`, `aria-live="assertive"` |
| **Timeout** | `timedOut: true` | normal or truncated copy + ` · search stopped early — results may be incomplete` | normal | rows, or the zero state | summary wraps |
| **Truncated** | `truncated: true` | cap copy; never a false total | unique hint still shown | rows | — |
| **File name** | target is name | `N notes` | hidden | name rows, no snippet | — |
| **Empty notebook** | zero matches in a notebook with no notes | `0 matches` | the zero state | empty | — |
| **200 results** | the cap is reached | cap copy | normal | 200 rows | — |
| **Long query** | the field text exceeds its box | normal | normal | normal | the field scrolls horizontally; the clear button stays |
| **Narrow** | container ≤ 199 | normal, may ellipsize | normal | normal | settings summary is clipped but still described |
| **Phone** | phone shell | as desktop | as desktop | as desktop | drawer is modal |

Details:

- **Idle is blank.** There is no "Search your notebooks" heading. The placeholder is the
  only guidance. This follows `search-panel-clear.md` §12 and the shipped `setIdle()`
  (`activity.js:846-861`), and supersedes `search-panel.md` §5 (§11 C6).
- **Loading keeps the previous rows.** Clearing on every keystroke would flicker every
  250 ms. The rows stay clickable and open their own query. The summary is the only
  change.
- **Loading after a zero result clears the zero block.** A stale `No matches found.`
  must not sit under `Searching…`. `runSearch()` empties the list and hides a state note
  when there are no rows. This is a target change; the shipped `runSearch()` leaves it on
  screen (`activity.js:862-902`).
- **The error keeps the rows on every error**, including a 400. `showSearchError()` never
  clears the list (`activity.js:906-920`). `search-options.md` §4.0 says a 400 clears
  them; §11 C15 records the replacement.
- **The timeout is a caveat, not an error.** The returned matches are exact; only the
  scan stopped. The suffix is appended to the summary (`activity.js:809`, `:816`, `:953`).
  The summary grows to two lines when it is incomplete. Without that rule the nowrap +
  ellipsis (`style.css:4239-4245`) hides the caveat at 240 px.
- **A zero result from a timed-out scan** still says `No matches found.`, because the
  server found none in the part it scanned; the summary above carries the caveat.
  A stopped scan cannot support a clean "no hits" claim, and the two lines are adjacent.
- **The empty notebook has no separate copy.** The response carries no notebook-size
  field. The Explorer owns "No notes yet."; search shows the same zero state.
- **No first-search spinner.** The list is blank and the summary says `Searching…`.

---

## 6. Copy

Exact strings. Curly quotes are U+201C/U+201D; the em dash is U+2014; the middle dot is
U+00B7. A trailing space in the shipped error strings is an artefact of `textContent`
concatenation; the target has no trailing space and uses the flex gap.

| Context | String |
|---|---|
| Panel title | `Search` |
| Header control (desktop / phone) | `Collapse panel` / `Close panel`; glyph `‹` / `×` |
| Field placeholder and name | `Search notebooks…` |
| Clear name and title | `Clear search` |
| Disclosure | `Advanced` |
| Settings summary | fragments joined by ` · `: `File name`, `Match case`, `All matches`, `Path (A–Z)`, `Recently modified`, `Most matches` |
| Disclosure title with non-defaults | `Search options: {summary}` |
| Captions | `Search in`, `Grouping`, `Match case`, `Sort` |
| Target options | `Content`, `File name` |
| Grouping options | `All matches`, `One per note` |
| Sort options | `Path (A–Z)`, `Recently modified`, `Most matches` |
| Summary, idle | empty |
| Summary, running | `Searching…` |
| Summary, one per note | `{N} notes · {M} matches`; `1 note · 1 match` |
| Summary, one per note, truncated | `{N} notes shown — more results exist` |
| Summary, all matches | `{M} matches in {N} notes` |
| Summary, all matches, truncated | `{M} matches shown — more results exist` |
| Summary, file name | `{N} notes` |
| Summary, file name, truncated | `{N} notes shown — more results exist` |
| Per-file cap suffix | ` · some notes have more matches` |
| Timeout suffix | ` · search stopped early — results may be incomplete` |
| Summary, zero | `0 matches`; `0 notes` in File name mode |
| Zero-state line | `No matches found.` |
| Zero-state action | `Search file names instead` / `Search content instead` |
| Unique-mode note | `Click a row to open its first match.` |
| Unique-row screen-reader text | `Opens at the first match.` |
| Count tooltip | `total occurrences in this note` |
| All-matches meta | `line {N}` |
| Error summary | `Search error: {message}` |
| Retry | `Retry` |
| Open failure | `Could not open “{path}”. It may have been moved or deleted.` |
| Refresh action | `Refresh results` |
| List label | `Search results` |
| Filters group label | `Search filters` |
| Radio group labels | `Search in`, `Result grouping` |
| Case name | `Match case` |
| Search landmark | `Search` |

The case toggle's accessible name changes from `Case sensitive` (shipped,
`activity.js:563-566`) to `Match case` so it matches its visible caption. The glyph `Aa` is
`aria-hidden`; the name carries the meaning. No test asserts the old name.

---

## 7. Tokens and CSS target

### 7.1 Mapping the old local tokens

The search block currently declares 21 local tokens with literals
(`style.css:3865-3888`). They are retired. This is the component being edited, so
foundations §11.2 rule 2 ("touch it, tokenise it") applies. The literal values below are
the ones at `style.css:3865-3888` unless a row names another line.

| Old local | Value today | Target |
|---|---|---|
| `--search-space-1` | 4 | `--space-1` |
| `--search-space-2` | 6 | `--space-1` for an inner gap, `--space-2` for a row gap |
| `--search-space-3` | 8 | `--space-2` |
| `--search-space-4` | 12 | `--space-3` |
| `--search-space-5` | 16 | `--space-4` (no remaining user) |
| `--search-radius-sm` | 4 | `--radius-xs` |
| `--search-radius-md` | 6 | `--radius-sm` |
| `--search-pad-x` | 10 | `--space-3` (12) |
| `--search-gap` | 8 | `--space-2` desktop, `--space-3` phone |
| `--search-mode-h` | 26 | `--control-h-md` (30) desktop, `--control-h-touch` (44) phone |
| `--search-control-h` | 32 | `--control-h-lg` (36) for the field and select; `--control-h-body` (32) for the case label |
| `--search-label-size` | .66 | `--text-xs` (.72) |
| `--search-hit-min-h` | 32 | `--control-h-md` (30) desktop, `--control-h-touch` (44) phone |
| `--search-adv-h` | 26 | `--control-h-sm` (24) desktop, `--control-h-touch` phone |
| `--search-adv-font` | .78 | `--text-ui` (.86) |
| `--search-adv-meta` | .72 | `--text-xs` |
| `--search-badge-h` | 16 | `--space-4` desktop, `--space-5` phone |
| `--search-clear-btn` | 22 | `--control-h-sm` (24) desktop, `--control-h-touch` phone |
| `--search-clear-inset` | 5 | `--space-1` (4) |
| `--search-clear-slot` | 32 | `--control-h-body` desktop; `calc(var(--control-h-touch) + var(--space-1))` phone |
| `--search-clear-icon` | 12 | `--icon-sm` (14) |

No local alias survives. The rules read the foundation names directly.

### 7.2 Proposed additions

One.

| Token | Value | Why it cannot use an existing token |
|---|---|---|

Everything else resolves to a foundation token or a `calc()` of two. No new colour,
radius, spacing rung, shadow, z-band, or breakpoint.

### 7.3 Rules, in landing order

These replace `style.css:3865-4394`. Class names stay.

```css
/* 1. Host ---------------------------------------------------------- */
#search-view {
  container-type: inline-size;
}

/* 2. Controls zone -------------------------------------------------- */
.search-panel-controls {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-3) var(--space-2);
  border-bottom: var(--stroke-1) solid var(--border);
}

.search-panel-input-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 0 0 auto;
}

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
  height: var(--control-h-lg);
  padding: 0 var(--space-3);
  padding-inline-end: var(--control-h-body);
  background: var(--surface-well);
  border: var(--stroke-1) solid var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font: var(--fw-regular) var(--text-ui)/var(--lh-flat) var(--font-ui);
}
.search-panel-input::placeholder { color: var(--text-muted); }
.search-panel-input:hover { border-color: var(--accent); }
.search-panel-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 var(--stroke-3) var(--accent-soft);
}
.search-panel-input::-webkit-search-cancel-button,
.search-panel-input::-webkit-search-decoration,
.search-panel-input::-webkit-search-results-button {
  -webkit-appearance: none;
  appearance: none;
}

/* 3. Clear ----------------------------------------------------------- */
.search-panel-clear {
  position: absolute;
  top: 50%;
  right: var(--space-1);
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-h-sm);
  height: var(--control-h-sm);
  padding: 0;
  border: var(--stroke-1) solid transparent;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out);
}
.search-panel-clear[hidden] { display: none; }
.search-panel-clear svg {
  display: block;
  width: var(--icon-sm);
  height: var(--icon-sm);
}
.search-panel-clear:hover {
  color: var(--text-primary);
  background: var(--accent-soft);
}
.search-panel-clear:active {
  color: var(--text-primary);
  background: var(--accent-soft);
  border-color: var(--accent);
}
.search-panel-clear:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}

/* 4. Advanced row ---------------------------------------------------- */
.search-panel-advanced-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-h-sm);
  min-width: 0;
}

.search-panel-advanced-toggle {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  height: var(--control-h-sm);
  margin-left: calc(-1 * var(--space-1));
  padding: 0 var(--space-1);
  background: none;
  border: 0;
  border-radius: var(--radius-xs);
  color: var(--text-muted);
  font: var(--fw-medium) var(--text-ui)/var(--lh-flat) var(--font-ui);
  cursor: pointer;
}
.search-panel-advanced-toggle:hover {
  color: var(--text-primary);
  background: var(--accent-soft);
}
.search-panel-advanced-toggle[aria-expanded="true"] { color: var(--text-primary); }
.search-panel-advanced-toggle:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}

.search-panel-advanced-chevron {
  flex: 0 0 auto;
  width: var(--space-2);
  height: var(--space-2);
  border-right: var(--stroke-1) solid currentColor;
  border-bottom: var(--stroke-1) solid currentColor;
  transform: rotate(45deg);
  transition: transform var(--dur-1) var(--ease-out);
}
.search-panel-advanced-toggle[aria-expanded="true"]
  .search-panel-advanced-chevron {
  transform: rotate(-135deg);
}

.search-panel-advanced-badge {
  display: none;
  align-items: center;
  justify-content: center;
  min-width: 2ch;
  height: var(--space-4);
  padding: 0 var(--space-1);
  border: var(--stroke-1) solid var(--accent);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--accent);
  font-size: var(--text-2xs);
  font-weight: var(--fw-bold);
  font-variant-numeric: tabular-nums;
  line-height: var(--lh-flat);
}
.search-panel-advanced-badge:empty { display: none; }

.search-panel-advanced-summary {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-size: var(--text-xs);
  line-height: var(--lh-snug);
  text-align: right;
}
.search-panel-advanced-summary:empty { display: none; }

.search-panel-advanced { display: block; min-width: 0; }
.search-panel-advanced[hidden] { display: none; }

/* 5. Filters --------------------------------------------------------- */
.search-panel-filters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
  min-width: 0;
}
.search-panel-filter {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}
.search-panel-filter--sort,
.search-panel-filter--case { grid-column: 1 / -1; }
.search-panel-filter--case {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}
.search-panel-filter.is-hidden { display: none; }

.search-panel-filter-label {
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-label);
  line-height: var(--lh-tight);
  text-transform: uppercase;
}

.search-panel-filters.is-name
  .search-panel-filter:not(.search-panel-filter--sort) {
  grid-column: 1 / -1;
}
.search-panel-filters.is-name
  .search-panel-filter:not(.search-panel-filter--sort) .search-panel-mode {
  grid-template-columns: 1fr 1fr;
}

/* 6. Segmented tracks ------------------------------------------------ */
.search-panel-mode {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-hair);
  width: 100%;
  min-width: 0;
  padding: var(--space-hair);
  background: var(--surface-well);
  border: var(--stroke-1) solid var(--border-strong);
  border-radius: var(--radius-sm);
}
.search-panel-mode.is-hidden { display: none; }
.search-panel-mode-opt { position: relative; display: flex; min-width: 0; }
.search-panel-mode-opt input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
  pointer-events: none;
}
.search-panel-mode-opt span {
  flex: 1 1 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--control-h-md);
  padding: 0 var(--space-1);
  border-radius: var(--radius-xs);
  color: var(--text-muted);
  font-size: var(--text-sm);
  cursor: pointer;
  user-select: none;
  transition: background var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}
.search-panel-mode-opt span:hover {
  background: var(--accent-soft);
  color: var(--text-primary);
}
.search-panel-mode-opt input:checked + span {
  background: var(--surface-raised);
  color: var(--text-primary);
  font-weight: var(--fw-semibold);
  box-shadow: inset 0 calc(-1 * var(--stroke-2)) 0 var(--accent);
}
.search-panel-mode-opt input:focus-visible + span {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset-inset);
}

/* 7. Match case ------------------------------------------------------ */
.search-panel-case {
  position: relative;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: calc(var(--control-h-sm) + var(--space-1));
  height: var(--control-h-body);
  cursor: pointer;
  user-select: none;
}
.search-panel-case input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
  pointer-events: none;
}
.search-panel-case span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: calc(var(--control-h-sm) + var(--space-1));
  height: var(--control-h-md);
  border: var(--stroke-1) solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-well);
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-weight: var(--fw-bold);
  line-height: var(--lh-flat);
  transition: background var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out);
}
.search-panel-case:hover span {
  color: var(--text-primary);
  border-color: var(--accent);
}
.search-panel-case input:checked + span {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--text-primary);
}
.search-panel-case input:focus-visible + span {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}

/* 8. Sort ------------------------------------------------------------ */
.search-panel-select {
  width: 100%;
  height: var(--control-h-lg);
  min-height: 0;
  padding: 0 var(--space-6) 0 var(--space-3);
  background-color: var(--surface-well);
  border: var(--stroke-1) solid var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font: var(--fw-regular) var(--text-ui)/var(--lh-flat) var(--font-ui);
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
}
.search-panel-select:hover { border-color: var(--accent); }
.search-panel-select:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}
.search-panel-select option:disabled { color: var(--text-muted); }

/* 9. Results summary ------------------------------------------------- */
.search-panel-summary {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-h-sm);
  padding: var(--space-1) var(--space-3) var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-sm);
  line-height: var(--lh-snug);
}
.search-panel-summary-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-panel-summary.is-incomplete .search-panel-summary-text {
  white-space: normal;
  overflow: visible;
}
.search-panel-summary.error { flex-wrap: wrap; color: var(--danger); }
.search-panel-summary.error .search-panel-summary-text {
  flex-basis: 100%;
  white-space: normal;
  overflow: visible;
}
.search-panel-summary.error .search-panel-retry { margin-inline-start: auto; }

.search-panel-retry {
  flex: 0 0 auto;
  min-height: var(--control-h-sm);
  padding: 0 var(--space-2);
  background: var(--surface-raised);
  border: var(--stroke-1) solid var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font: var(--fw-medium) var(--text-ui)/var(--lh-flat) var(--font-ui);
  cursor: pointer;
}
.search-panel-retry:hover {
  background: var(--accent-soft);
  border-color: var(--accent);
}
.search-panel-retry:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}
.search-panel-retry:disabled {
  opacity: var(--opacity-disabled);
  cursor: progress;
}

.search-panel-empty-action {
  height: auto;
  min-height: var(--control-h-sm);
  margin: 0 var(--space-3) var(--space-4);
  padding: var(--space-hair) var(--space-2);
  white-space: normal;
  text-align: left;
}

/* 10. Note / zero state ---------------------------------------------- */
.search-panel-note {
  flex: 0 0 auto;
  padding: 0 var(--space-3) var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-xs);
  line-height: var(--lh-snug);
}
.search-panel-note[hidden] { display: none; }
.search-panel-note.is-state { padding: 0; }
.search-panel-note.is-state .search-panel-empty {
  padding: var(--space-4) var(--space-3) var(--space-2);
}

/* 11. List ----------------------------------------------------------- */
.search-panel-list {
  flex: 1 1 auto;
  overflow: auto;
  min-height: 0;
  margin-right: var(--space-2);
  padding: 0 var(--space-1) var(--space-2);
}
/* The list keeps full contrast while busy: dimmed 12 px text drops below 4.5:1.
   aria-busy and the summary line carry the state. */
.search-panel-list.is-loading { cursor: progress; }

.search-panel-empty {
  padding: var(--space-6) var(--space-4);
  max-width: calc(60 * var(--space-2));
  color: var(--text-muted);
  font-size: var(--text-ui);
  font-style: normal;
}

.search-panel-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

/* 12. Result row ----------------------------------------------------- */
.search-panel-hit {
  display: block;
  width: 100%;
  min-height: var(--control-h-md);
  padding: var(--space-1) var(--space-2);
  border: 0;
  border-radius: var(--radius-xs);
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.search-panel-hit:hover { background: var(--surface-raised); }
.search-panel-hit.is-active { background: var(--accent-soft); }
.search-panel-hit:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset-inset);
}
.search-panel-hit-file {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}
.search-panel-path {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sp-file {
  font-size: var(--text-body);
  font-weight: var(--fw-semibold);
}
.sp-dir {
  color: var(--text-muted);
  font-weight: var(--fw-regular);
}
.sp-meta {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: var(--text-xs);
  white-space: nowrap;
}
.sp-count {
  flex: 0 0 auto;
  padding: 0 var(--space-2);
  border: var(--stroke-1) solid var(--border);
  border-radius: var(--radius-pill);
  color: var(--text-muted);
  font-size: var(--text-xs);
  line-height: var(--lh-snug);
  white-space: nowrap;
}
.search-panel-hit.is-active .sp-count { color: var(--text-primary); }
.search-panel-hit-snippet {
  display: block;
  margin-top: var(--space-hair);
  color: var(--text-muted);
  font-size: var(--text-sm);
  line-height: var(--lh-snug);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.search-panel-hit-snippet mark {
  padding: 0 var(--space-hair);
  border-radius: var(--radius-xs);
  background: var(--accent-soft);
  color: var(--text-primary);
}

/* 13. Container refinements ----------------------------------------- */
@container (max-width: 227px) {
  #search-view .search-panel-filters { grid-template-columns: 1fr; }
  #search-view .search-panel-filters.is-name
    .search-panel-filter:not(.search-panel-filter--sort) .search-panel-mode {
    grid-template-columns: 1fr;
  }
}

@container (max-width: 199px) {
  #search-view .search-panel-select {
    font-size: var(--text-xs);
    padding-right: var(--space-5);
  }
  #search-view .search-panel-advanced-summary {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
  #search-view .search-panel-advanced-row.has-nondefault
    .search-panel-advanced-badge {
    display: inline-flex;
  }
}

/* 14. Phone ---------------------------------------------------------- */
@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) {
  #search-view .search-panel-controls {
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
  }
  #search-view .search-panel-input {
    height: var(--control-h-touch);
    padding-inline-end: calc(var(--control-h-touch) + var(--space-1));
    border-radius: var(--m-radius);
    font-size: 16px;
  }
  #search-view .search-panel-clear {
    right: 0;
    width: var(--control-h-touch);
    height: var(--control-h-touch);
    border-radius: var(--m-radius);
  }
  #search-view .search-panel-clear svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
  }
  #search-view .search-panel-advanced-row { min-height: var(--control-h-touch); }
  #search-view .search-panel-advanced-toggle {
    height: var(--control-h-touch);
    font-size: var(--text-body);
  }
  #search-view .search-panel-advanced-summary { font-size: var(--text-body); }
  #search-view .search-panel-advanced-badge { height: var(--space-5); }
  #search-view .search-panel-filter-label { font-size: var(--text-ui); }
  #search-view .search-panel-mode-opt span {
    min-height: var(--control-h-touch);
    padding: 0 var(--space-1);
    font-size: var(--text-body);
  }
  #search-view .search-panel-case,
  #search-view .search-panel-case span {
    width: var(--control-h-touch);
    height: var(--control-h-touch);
    border-radius: var(--m-radius);
  }
  #search-view .search-panel-select {
    height: var(--control-h-touch);
    padding-right: calc(var(--space-6) + var(--space-1));
    border-radius: var(--m-radius);
    font-size: 16px;
  }
  #search-view .search-panel-summary {
    min-height: var(--control-h-md);
    padding: var(--space-1) var(--space-4) var(--space-2);
    font-size: var(--text-body);
  }
  #search-view .search-panel-note {
    padding: 0 var(--space-4) var(--space-2);
    font-size: var(--text-ui-lg);
  }
  #search-view .search-panel-retry { min-height: var(--control-h-touch); }
  #search-view .search-panel-empty-action {
    min-height: var(--control-h-touch);
    margin: 0 var(--space-4) var(--space-4);
  }
  #search-view .search-panel-list {
    margin-right: 0;
    padding: 0 var(--space-1) var(--space-2);
  }
  #search-view .search-panel-hit {
    min-height: var(--control-h-touch);
    padding: var(--space-2);
    border-radius: var(--radius-md);
  }
  #search-view .search-panel-hit:hover { background: transparent; }
  #search-view .sp-file { font-size: var(--text-body); }
  #search-view .search-panel-hit-snippet { font-size: var(--text-body); }
  #search-view .sp-count { font-size: var(--text-ui); }
  #search-view .search-panel-empty {
    padding: var(--space-4);
    font-size: var(--text-body);
  }
}

/* 15. Reduced motion ------------------------------------------------- */
@media (prefers-reduced-motion: reduce) {
  .search-panel-advanced-chevron,
  .search-panel-mode-opt span,
  .search-panel-case span,
  .search-panel-clear { transition: none; }
}
```

Order matters in three places:

1. `.search-panel-hit.is-active` follows `:hover`, so the active row keeps its wash while
   the pointer is over it.
2. The `is-name` grid rule follows the base grid.
3. The 227 query follows the base grid and precedes the 199 query. Do not put a
   one-column rule in the 199 query; the base is already one column.

### 7.4 Contrast

All pairs use existing tokens; no new colour.

| Pair | Dark | Light | Use |
|---|---|---|---|
| `--text-muted` on `--surface-panel` | 5.52 | 5.56 | summary, note, snippet, captions, settings summary |
| `--text-primary` on `--surface-panel` | 12.57 | 14.61 | file name, row text, retry |
| `--text-primary` on `--surface-raised` | 11.30 | 13.48 | selected segment, hovered name |
| `--accent` on `--surface-panel` | 6.00 | 5.34 | focus ring, badge outline and numeral |
| `--border-strong` on `--surface-panel` | 4.03 | 3.64 | field, select, track boundary |
| `--danger` on `--surface-panel` | 5.60 | 5.06 | error summary |
| `--text-primary` on `--accent-soft` | 9.1 | 12.4 | active row, mark text |

Field placeholder: `--text-muted` on `--surface-well` measures 6.44 dark / 5.33 light
(computed from the §3 hexes). The field boundary and the focus border both clear 3:1.

Colour is never the only signal: the error carries words and a Retry; the count carries
the word `matches`; the active row carries a wash plus `aria-selected`; the badge is a
numeral with the names in the description.

### 7.5 Motion

| Element | Motion | Reduced |
|---|---|---|
| Advanced chevron | `transform var(--dur-1) var(--ease-out)` | none |
| Clear | background/colour/border `--dur-1` | none |
| Case toggle | background/colour/border `--dur-1` | none |
| Segment | background/colour `--dur-1` | none |
| Panel open/close | none — `hidden` only | — |
| List busy | opacity only | — |

No height or layout animation. Nothing on first paint.

### 7.6 JS changes this design requires

| # | Change | Where |
|---|---|---|
| 1 | Add `role="search"` and `aria-label="Search"` to the host | `templates/index.html:266` |
| 2 | Case checkbox name becomes `Match case`; `Aa` becomes `aria-hidden` | `activity.js:558-576` |
| 3 | IME guards: `compositionstart` / `compositionend`; skip `input` and `Enter` while composing | `activity.js:1192-1210` |
| 4 | On a zero result, move `.search-panel-empty` and `.search-panel-empty-action` into `.search-panel-note.is-state`; empty the listbox; keep `role="presentation"` on the message | `activity.js:949-986` |
| 5 | `runSearch` hides a stale zero state and empties the list when there are no rows | `activity.js:862-902` |
| 6 | Add `.is-incomplete` to the summary when `timedOut`; remove it in `setSummary` / `setSummaryError` | `activity.js:809-828`, `:937-995` |
| 7 | Focus: zero result while the list had focus → query; Retry / Refresh / alternate action → query or first result; never body | `activity.js:906-935`, `:961-980`, `:1067-1068` |
| 8 | `setIdle` and every non-zero `renderResults` branch remove `.is-state`; the class exists only while the zero block occupies the note | `activity.js:846-861`, `:937-995` |

No change to `api.js`, `app.py`, the request parameters, the row fields, the list keys,
or the persistence calls.

---

## 8. ARIA and keyboard

### 8.1 Landmarks and roles

| Element | Role / attributes |
|---|---|
| `#search-view` | `role="search"`, `aria-label="Search"` |
| Panel header | `<h2 class="panel-title">Search</h2>`; the view ships a `span` today (`activity.js:450`). The element changes in this view's pass; the node stays inside `#search-view` (§11 C16) |
| Query | Native `<input type="search">` → searchbox; `aria-label="Search notebooks"` |
| Clear | Native button; `aria-label="Clear search"`; glyph hidden |
| Advanced trigger | Native button; `aria-expanded`; `aria-controls="search-panel-advanced"`; `aria-describedby` only when non-default |
| Advanced panel | Plain `<div hidden>`; no role |
| Filters | `role="group" aria-label="Search filters"` |
| Target / grouping | `role="radiogroup"` with `aria-label="Search in"` / `"Result grouping"`; native radios |
| Match case | Native checkbox inside its label; `aria-label="Match case"` |
| Sort | Native select with `<label for="search-panel-sort">Sort</label>` |
| Results summary | `role="status" aria-live="polite" aria-atomic="true"`; error switches to `role="alert" aria-live="assertive"` |
| Results list | `role="listbox" aria-label="Search results" aria-busy` |
| Row | `role="option" aria-selected`; native button underneath |
| Zero state | `role="presentation"` on the message; the alternate action is a plain button in the note |
| Badge | `aria-hidden="true"` |
| Panel title | Text, not a live region |

### 8.2 Not a combobox; no `aria-activedescendant`

The input stays a plain searchbox, not `role="combobox"`. The results are a persistent
region, not a suggestion popup: there is no `aria-expanded` on the field, the list is
always present, and the keyboard model moves focus into it rather than keeping focus in
the field.

The listbox uses the **roving tabindex** variant: focus moves to the active option
(`activity.js:1104-1110`). `aria-activedescendant` is therefore not used. Adding it would
create a second active-row model and contradict the shipped focus assertion
(`tests/dom/test_dom.js:2861`). If search ever changes to "focus stays in the query", the
change is atomic: `role="combobox"`, `aria-expanded`, `aria-controls`, one
`aria-activedescendant`, remove the roving tabindex. Not this pass.

The listbox is single-select. `aria-selected="true"` is on the one active row; all others
are `false`. There is no `aria-current` on a row: the row is not "the current page".

### 8.3 Focus retention

| Moment | Focus before | Focus after |
|---|---|---|
| `Enter` in the query, results arrive | query | first option |
| `Enter` in the query, zero or error | query | query |
| Option change | the control | the control; active row resets to 0 but focus does not move |
| A response replaces rows while the list had focus | an option | the new first option |
| A zero result while the list had focus | an option | the query (new) |
| `Retry` pressed | Retry | the query (new) |
| `Refresh results` pressed | Refresh | the query (new) |
| Alternate target action | the action | the first result, or the query if zero (new) |
| Clear `×` | the button or the field | the field |
| `Esc` in the list | an option | the query, text selected |
| View switch | anywhere | preserved; the host is never unmounted |

The shipped `renderResults` captures `hadFocus = list.contains(document.activeElement)`
and refocuses row 0 when rows exist (`activity.js:943`, `:1067-1068`). The zero branch
does not restore focus (`activity.js:983-986`); this design closes that gap. Pressing
Retry removes the focused button when the summary becomes `Searching…`
(`activity.js:862-866`, `:819-821`); this design moves focus to the query in the same
turn.

### 8.4 Live regions

- The summary is the only live region. It announces `Searching…`, the count, the cap,
  the timeout caveat, the error, and the open failure.
- The list is not live. Announcing 200 rows would be noise.
- The settings summary and badge are not live. The control announces its own new value;
  the trigger's description is available on demand.
- The zero state is not live; the summary already announced `0 matches`.

### 8.5 Keys

| Key | Query | Advanced open | List |
|---|---|---|---|
| `Tab` / `Shift+Tab` | native DOM order | enters filters in order; Grouping is skipped while hidden | one stop: the active option |
| `Enter` | run now; focus first option | native button activation on the trigger; native on filters | open active row |
| `Space` | types a space | toggles the focused control | open active row |
| `Esc` | clear if non-empty; otherwise the shell | close and focus the trigger | focus the query and select |
| `ArrowDown` / `ArrowUp` | native caret | native radio/select movement | next / previous row |
| `j` / `k` | types the letter | — | next / previous row |
| `Home` / `End` | native line start/end | native select behaviour | first / last row |
| `Ctrl/Cmd+F`, `/` | the shell's search chord focuses the query; the panel adds nothing (`search-gaps.md` F3) | — | — |

### 8.6 Target sizes

Desktop: field 36, clear 24, Advanced trigger 24, segments 30, case label 28 × 32,
select 36, retry 24, row 30. Every one meets the 24 px floor (`foundations.md` §10.4).
Phone: every target 44 (`.search-panel-case` is 44 × 44; the clear is 44 × 44; the row's
content height is about 52).

---

## 9. Responsive and phone

### 9.1 Panel width, not viewport width

The side panel resizes independently of the viewport, so the two refinements are container
queries on `#search-view`, not media queries:

| Query | Trigger | Effect |
|---|---|---|
| `(max-width: 227px)` | the two-up filter grid can no longer hold `One per note` at `--font-scale: 1.3` | filters become one column |
| `(max-width: 199px)` | the settings summary cannot be read | summary is clipped for AT; the badge appears |

No viewport breakpoint is added for the panel. The only viewport mode switch stays the
phone query at 860 / coarse 1023 (`foundations.md` §8.2).

### 9.2 Phone

| Part | Desktop | Phone |
|---|---|---|
| Drawer | 240 column | `min(86vw, 340px)`; **Search is 100 %** (`style.css:7232`) |
| Header | 34, `‹` | 52, `×` (`activity.js:282-285`) |
| Field | 36, `--text-ui` | 44, 16 px fixed |
| Clear | 24 | 44; slot 48 |
| Advanced row | 24 | 44 |
| Filter grid | 2 columns | 2 columns, vertical tracks |
| Segments | 30 | 44 |
| Case | 28 × 32 | 44 × 44 |
| Sort | 36 | 44, 16 px |
| Summary | `--text-sm` | `--text-body` |
| Note | `--text-xs` | `--text-ui-lg` |
| Row | 30 | 44 minimum; about 52 with a snippet |
| List margin | `--space-2` for the resize strip | 0 |

The drawer opens with the query focused (`mobile.js:332-338`, `:353`). Tapping Advanced
blurs the field so the soft keyboard retracts (`activity.js:1160-1166`). Tapping a result
opens the note and closes the drawer through the shell's existing open path
(`mobile.js:931-943`); the panel adds no second close path. The query, filters, rows, and
active row survive because the host stays mounted.

---

## 10. Acceptance criteria

Each names the file and the observable result. `style.css` is `static/css/style.css`;
`activity.js` is `static/js/activity.js`.

| # | Criterion | Where | Observable |
|---|---|---|---|
| **AC1** | Only the list scrolls; the header, controls, summary, and note stay pinned | `style.css`, `activity.js` | At 240, 140, and 390 the view is a flex column; `.search-panel-list` is the only `overflow: auto`; collapsing Advanced changes only `hidden` and `aria-expanded` and sends no `/api/search` request |
| **AC2** | The query row is one field plus one clear button; the case toggle is not in it | `activity.js` | The input row contains `.search-panel-input` and `.search-panel-clear` only; `Aa` is inside `#search-panel-advanced`. Existing checks: `tests/dom/test_dom.js:2574-2582` |
| **AC3** | The field is 36 desktop / 44 phone, on `--surface-well`, with a `--border-strong` outline and the accent-and-halo focus | `style.css` | Computed height 36/44; computed border colour is the `--border-strong` value; focus shows the 3 px wash and no stray outline |
| **AC4** | The clear button is 24 × 24 desktop / 44 × 44 phone with a 32 / 48 px reserved slot | `style.css`, `activity.js` | Computed box and `padding-right`; the input width is identical with the button hidden and shown. Existing checks: `tests/browser/test_core_ui_browser.js:678-686` (update `22px` → `24px`), `tests/browser/test_mobile_browser.js:385-393` |
| **AC5** | Clear hides for a trimmed-empty value, sends no request, and returns focus | `activity.js` | `tests/dom/test_dom.js:2574-2609`; `tests/browser/test_core_ui_browser.js:687-703`; `tests/browser/test_mobile_browser.js:394-401` |
| **AC6** | IME composition neither searches nor clears | `activity.js` | New DOM check: dispatch `compositionstart`, `input` events, and `Enter`; no `/api/search`; `compositionend` schedules exactly one; `Esc` during composition does not clear |
| **AC7** | Advanced holds exactly four filters in the fixed order with the fixed captions | `activity.js`, `style.css` | `.search-panel-controls` contains one input and four `.search-panel-filter` rows, each with a caption. Existing checks: `tests/dom/test_dom.js:3198-3203` |
| **AC8** | Defaults are Content, One per note, Match case off, Path (A–Z) | `activity.js`, `app.js` | `tests/dom/test_dom.js:2559-2570`; the requests carry `unique=1`, `order=path`, no `name`, `case=0` |
| **AC9** | File name hides and disables the dormant controls | `activity.js` | Grouping wrapper and track both `.is-hidden`; `Most matches` disabled; a stored count is demoted to path. Existing checks: `tests/dom/test_dom.js:3272-3282` |
| **AC10** | The badge counts 0–4 non-default filters, is hidden at 0 and above 199 px, and the trigger describes the full list | `activity.js`, `style.css` | Existing checks: `tests/dom/test_dom.js:3235-3253`; computed badge display at 240 vs 140 |
| **AC11** | Advanced starts collapsed; Escape closes and returns focus; opening never re-runs the query | `activity.js` | `tests/dom/test_dom.js:3213-3227`; request count unchanged on toggle |
| **AC12** | One-per-note is the default and renders one row per file with the exact count and first snippet | `activity.js` | `tests/dom/test_dom.js:2665-2703`; `tests/browser/test_core_ui_browser.js:653-664` |
| **AC13** | Rows split basename and directory; the full path is the `title`; name-mode rows have no count, line, or snippet | `activity.js` | Existing checks: `tests/dom/test_dom.js:3285-3300` |
| **AC14** | Snippets mark only server-returned hits, built with `textContent`; one `<mark>` per hit in the snippet | `activity.js` | `tests/browser/test_core_ui_browser.js:666-669`; a query containing `<img>` renders as text |
| **AC15** | Summary copy and plurals match §6, including caps, per-file, and timeout suffixes | `activity.js` | `tests/dom/test_dom.js:2670`, `:2693`, `:2751-2804` |
| **AC16** | The zero state reads `No matches found.` with the other-target action directly under it, and the listbox is empty | `activity.js` | `.search-panel-empty` is `.search-panel-note.is-state`'s first child; `.search-panel-empty-action` follows it; `.search-panel-list` has no children. Existing text/role checks: `tests/dom/test_dom.js:2832-2842` |
| **AC17** | The timeout caveat is visible in full at 240 | `activity.js`, `style.css` | With `timedOut`, the summary has `.is-incomplete`; its text is not clipped; the exact suffix is present |
| **AC18** | The listbox keeps its shipped model and focus behaviour | `activity.js` | `role="listbox"`; rows `role="option"`; exactly one `aria-selected="true"` and one `tabIndex === 0`; `Enter` in the query focuses row 0. Existing checks: `tests/dom/test_dom.js:2861-2875` |
| **AC19** | No `aria-activedescendant` and no combobox role on the query | `activity.js` | `document.querySelector(".search-panel-input").getAttribute("role") === null`; the listbox has no `aria-activedescendant` |
| **AC20** | Focus never falls to `document.body` when a state removes the focused element | `activity.js` | Zero result with list focus → input; Retry / Refresh → input; alternate action → first result or input. New DOM checks |
| **AC21** | The list keeps its rows and query on every error; Retry sends exactly one request and replaces the error with `Searching…` | `activity.js` | `tests/dom/test_dom.js:2987-3004`; `:3084-3118` for the open-failure Refresh |
| **AC22** | Idle is blank; whitespace-only sends no request; the query is not persisted | `activity.js`, `app.js` | `tests/dom/test_dom.js:2824-2834`; reload shows an empty field |
| **AC23** | A response applies only if it belongs to the newest request | `activity.js` | `tests/dom/test_dom.js:2915-2940` |
| **AC24** | 200 rows render and scroll; no spinner, no paging, no virtualisation | `activity.js` | A 200-match fixture renders 200 options; the list scrolls; the active row is in view |
| **AC25** | Phone: the drawer is 100 % for Search, the field is focused, every target is 44, every field is 16 px, no horizontal page scroll | `style.css`, `mobile.js` | `tests/browser/test_mobile_browser.js:355-401`; manual at 390 |
| **AC26** | At 140 and at `--font-scale: 1.3` the view has no horizontal scroll; below 199 the settings summary is clipped for AT and the badge is shown | `style.css` | Manual at 140; computed clip and badge display |
| **AC27** | Every chrome control has a visible focus state in both themes | `style.css` | Tab through: header, input, clear, trigger, four filters, row, retry; the field uses the halo, everything else the 2 px ring |
| **AC28** | Every transition has a reduced-motion twin | `style.css` | With `prefers-reduced-motion: reduce`, the chevron, clear, case, and segment transitions are `none` |
| **AC29** | No colour literal is added outside the token blocks | `style.css` | The diff adds no hex and no new token; every value resolves in foundations |
| **AC30** | The wire is untouched | `static/js/api.js`, `app.py` | The request parameters and response fields are exactly `docs/contracts/http-api.md` §Search |

Tests that change with this design, not because behaviour changed but because a value
did:

| Test | Today | Change |
|---|---|---|
| `tests/browser/test_core_ui_browser.js:682-684` | desktop clear is `22px` | `24px` |
| `tests/browser/test_core_ui_browser.js:685-686` | slot `32px` | unchanged |
| `tests/browser/test_mobile_browser.js:385-393` | phone clear 44, slot 48 | unchanged |
| `tests/browser/test_core_ui_browser.js:628-630` | case label `28 × 32` | unchanged (the span inside becomes 28 × 30) |

The DOM test at `tests/dom/test_dom.js:2835` is named "empty state is presentational
inside the listbox". After AC16 the message is outside the listbox; the assertion
(`role === "presentation"`) still passes. Rename the check; do not change the assertion.

---

## 11. Conflicts and what not to build

### 11.1 Conflicts found

| # | Conflict | Evidence | Position |
|---|---|---|---|
| **C1** | Grouping default and location | `search-panel.md:178` (All matches, always visible) vs `app.js:72` (unique true), `activity.js:731-739`, `search-panel-advanced.md:516` | Shipped wins: One per note, inside Advanced |
| **C2** | `Aa` location and summary membership | `search-panel-advanced.md:90-94` (beside the query, never in the summary) vs its own 2026-10-30 note (`:13-16`), `activity.js:558-580`, `:672-704`, `tests/dom/test_dom.js:2624-2626` | The update and shipped code win: `Aa` is the fourth filter and is named and counted |
| **C3** | Badge maximum | `search-panel-advanced.md:159-162` (1–3) vs `activity.js:691-695` (1–4) | 4 |
| **C4** | `Enter` opens the active row | `search-panel.md:311-313` vs `activity.js:1198-1268`, `tests/dom/test_dom.js:2861` | `Enter` runs and focuses row 0; a second `Enter` opens |
| **C5** | Query arrows move the active row | `search-panel.md:308-309`, `search-options.md:175` vs `activity.js:1198-1210` | Native caret movement; the list owns arrows |
| **C6** | Idle copy | `search-panel.md:265` (heading + hint) vs `search-panel-clear.md:377-379` and `activity.js:846-861` | Blank idle; the placeholder is the only guidance |
| **C7** | Zero-state copy | `search-panel.md:270` (quoted query + hint) vs `activity.js:952-957`, `tests/dom/test_dom.js:2832-2834` | `0 matches` + `No matches found.` |
| **C8** | Alternate action position | `activity.js:961-980` puts it in the note above the list | This document puts it directly under the message, in the same note block; the listbox stays empty |
| **C9** | Clear size | `search-panel-clear.md:31` and `:132` (22 × 22, 12 px glyph, 5 px inset) vs `controls.md` AC13 and `foundations.md` §10.4 (24 floor) | 24 × 24 with `--icon-sm` (14) and `--space-1` (4); the 32 px slot and the 44 / 48 phone values stay. Update the browser assertion |
| **C10** | Field treatment | `style.css:3913-3931` (32, `--bg`, `--border`, 2 px outline) vs `controls.md` §2.4 (36, `--surface-well`, `--border-strong`, halo) | Follow controls; the field grows 4 px |
| **C11** | List-row hover | `style.css:4312` (`--accent-soft` for hover and active) vs `controls.md` §2.16 (`--surface-raised` hover) | Raised hover, accent-soft active |
| **C12** | Container queries | `foundations.md` §8.2 rule 3 now places two in Search and one in Sessions (`style.css:4360`, `:4368`, `:8463`) | Keep 227 / 199: the panel resizes independently, so a viewport query cannot do the job. No foundation amendment remains |
| **C13** | Narrow threshold | `search-panel.md:134` (200) vs `search-panel-advanced.md:989` and `style.css:4360` (227) | 227 |
| **C14** | Timeout caveat can be clipped | `activity.js:809`, `:816`, `:953` append it; `style.css:4239-4245` is nowrap + ellipsis | Add `.is-incomplete` wrapping |
| **C15** | A 400 clears the rows | `search-options.md:78` vs `activity.js:906-920` (never clears) | Shipped wins: keep rows on every error |
| **C16** | Panel title element | `shell-frame.md` §4.2 (`h2`) vs `activity.js:450` and `sidebar.js:599` (both `span`) | Each view changes its own title node in its own pass; the node stays per view. `sidebar.js:599` moves with the Explorer pass. |
| **C17** | Unique summary wording | `search-panel.md:195` (`12 matches` → `12 matches in 4 files`) vs `activity.js:790-794` and `search-options.md` AC19 (`1 note · 1 match`) | Shipped/product wins: `N notes · M matches` |
| **C18** | Truncation note vs mode note | `search-panel.md:269` (truncation note replaces the mode note) vs `activity.js:784-809`, `:991-994` (cap in the summary, hint stays) | Shipped wins |
| **C19** | Search is a `role=search` landmark | No role today (`templates/index.html:266`) | Add it; the panel is already an aside |
| **C20** | Control heights | `search-panel-advanced.md` §4.1 and §5.1 (trigger 26, segment 26, sort 32, row 32) vs `controls.md` (button sm 24, segmented 30, select 36, list row 30) | Follow controls: the four literals become token sizes on this component's next edit. The case label stays 28 × 32 because it is a two-glyph field affordance and the browser test pins it |

Three smaller errata, recorded rather than silently fixed:

- The brief's CSS range for "filters `:3977-4060`" is the case and Advanced block; the
  filter grid starts at `:4109`. The brief's "controls `:489-606`" stops at the Advanced
  wrapper. The exact map is §1.4.
- `search-panel-advanced.md:456` says the badge is `.66rem` 700. This document uses
  `--text-2xs` (9 px) because controls §2.6 makes every count badge that size.
- The shipped `.search-panel-retry` is 28 px (`style.css:4262`) and is classified as a
  `sm` button (24) in `controls.md` §1.3. This document takes 24.

### 11.2 What not to build

| Rejected | Reason |
|---|---|
| A combobox on the query | There is no popup; the list is persistent. It would change the shipped focus model (§8.2) |
| `aria-activedescendant` | The roving tabindex is already the active-row model; adding both creates two states (§8.2) |
| A custom tooltip for the badge | Native `title` plus `aria-describedby` already carries the names; controls §2.10 |
| A search history, saved searches, or a recent-query list | Product O12; storage and UI for one user, no job |
| Regex, whole-word, folder scope, or current-note scope | Not shipped; `search-gaps.md` F2/G6 define them for later. P2 may not leave a disabled control in the P1 UI |
| A "Show more" button or paging | Product O9; the intended path is narrowing, not paging |
| Expanding a note row to show all its hits | Product §8; the one-per-note toggle is the way to see every hit |
| Client-side dedupe or filtering | The server owns grouping and counts; a client cap would be approximate |
| A spinner for search | The summary is the state; a spinner would compete with the count and animate a 250 ms cycle |
| A toast for search results or errors | The summary is in-place; a toast cannot carry Retry |
| An overlay, popover, or sheet for Advanced | It would be clipped by a 240 px panel and add a layer to the phone history |
| An idle illustration or start-typing heading | §5; the placeholder is enough and the zero/loading blocks already carry the copy |
| A leading magnifier in the field | It steals width at 140 for no new affordance |
| A second accent for marks, badges, or counts | Foundations P1/P4; the wash and the accent already carry the state |
| Theme-specific geometry or shadow | Foundations P4 |
| A new viewport breakpoint for the panel | The container queries already respond to the pane; foundations §8.2 |
| Virtualising the 200-row list | The cap is 200; a virtual list adds state and breaks `scrollIntoView` for no measured gain |
| `filter: brightness()` on any state | Foundations §11.4 |
| A hover-only action on a row | Unreachable on touch; every action is visible at rest |
| Auto-opening the first result on the first `Enter` | The shipped two-press flow is deliberate and tested; the first press moves focus, the second opens |
