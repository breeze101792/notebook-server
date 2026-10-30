# Search side panel — options and one-result-per-file

Design handoff for the **Search view in the activity bar** (`#search-view` in
`templates/index.html`, built by `mountSearch()` in `static/js/activity.js`).

Reference mockup: `docs/design/search-panel.html`.

Status: design only. No source files were changed. `web-engineer` implements the
markup in `activity.js`, the CSS in `static/css/style.css`, and the request
options in `api.js`.

**Normative source.** §4 (controls), §5 (states), §6 (keyboard), §7
(accessibility), §9 (DOM/CSS handoff) and §10 (implementation map) are the
single source of truth. The mockup illustrates them; where the two differ,
this document wins.

---

## 1. Design intent

**One line:** the query stays the loudest thing in the panel; grouping and
sorting are quiet tools that never turn the panel into a form.

The panel today has one query field, a tiny "Aa" checkbox, a summary line, and a
flat list of every hit. A common search produces the same file path five times,
so the user scans noise to find the one file they wanted. This design adds the
smallest control set that removes that noise:

1. **A two-state grouping control** — _All matches_ / _One per file_ — directly
   under the query. This is the core request. In one-per-file mode a file
   appears once with a readable count ("3 matches"), and the whole row opens
   the file at its first match.
2. **An Options disclosure** holding only two secondary controls: **Regex**
   and **Sort by**. Everything else stays out.
3. **Real states** — idle, loading, results, truncated, no matches, error with
   Retry — each with exact copy, so the panel never looks broken or blank.

The default (no Options open) keeps today's rhythm: header, query row, one
thin meta line, results. It adds one 32 px grouping row because that control is
the reason for the change.

### What stays

- The header (`Search` + collapse button), the query field, the "Aa" case
  toggle, the 250 ms debounce, and the result-row visual language.
- Clicking a row opens the file and jumps to the first match via
  `NB.viewer.jumpToMatch()`.
- The query, mode, and options survive view switches because the host stays
  mounted in the DOM. They are session state, not a new config key.
- The top-bar search (`search.js`, the `§search` special tab) is **not**
  redesigned. It keeps its own keyboard model and results list. The two
  surfaces stay consistent through the shared tokens and the same
  `NB.api.search` backend; the side panel is the only one that gains grouping.

### Non-goals

No saved searches, no search history list, no filters by folder in this phase
(see §11), no per-file expansion, no syntax highlighting of the query, no
result preview, and no server-side relevance scoring.

---

## 2. Today's surface (read before implementing)

`mountSearch(host)` currently builds:

```
.panel-header        Search                         ‹
.search-panel-input-row
  input.search-panel-input      placeholder "Search notebooks…"
  label.search-panel-case       checkbox + span "Aa"
.search-panel-summary  "12 matches" / "Search error: …"
.search-panel-list
  .search-panel-hit
    .search-panel-hit-file   .sp-file + .sp-meta ("line 12")
    .search-panel-hit-snippet  mark
  .search-panel-empty       "No matches found."
  .search-panel-retry       inline in the summary on error
```

Relevant CSS lives in `static/css/style.css` at `.search-panel-input-row`
(~line 3968), through `.search-panel-hit-snippet mark` (~line 4051). Phone
overrides are inside the `max-width: 860px` block (~line 6236). The API wrapper
is `NB.api.search(q, caseSensitive)` in `static/js/api.js` (~line 62) and
currently sends only `q` and `case`.

The backend already supports `regex`, `order`, `desc`, `limit`, and `perFile`;
it does **not** support grouping. The design assumes a new `unique=1` request
parameter and a `count` field on each match (see §10.4).

---

## 3. Anatomy

### 3.1 Desktop / side panel (default width 240 px)

```
┌ #search-view ───────────────────────────────────┐
│ .panel-header   SEARCH                       ‹  │
├─────────────────────────────────────────────────┤
│ .search-panel-input-row                         │
│  [ Search notebooks…                  ] [Aa]    │
│                                                 │
│ .search-panel-mode                              │
│  [ All matches ][ One per file ]                 │  ← new, always visible
│                                                 │
│ .search-panel-meta                              │
│  12 matches in 4 files              Options ⌄   │  ← summary + disclosure
│                                                 │
│ .search-panel-note                              │  ← one-per-file only
│  Click a row to open its first match.           │
│                                                 │
│ .search-panel-options                    (open) │  ← hidden by default
│  ☐ Regex                                        │
│  Sort by          [ Path A–Z            ▾ ]     │
│                                                 │
│ .search-panel-list                     (scrolls) │
│  ┌ button.search-panel-hit ───────────────────┐ │
│  │ projects/notes/a.md          3 matches     │ │
│  │ Remember to fix the fix before…            │ │
│  └────────────────────────────────────────────┘ │
│  …                                              │
└─────────────────────────────────────────────────┘
```

Vertical order is fixed. The options panel expands **between the note and the
list**, so opening it pushes results down instead of covering them. The list is
the only scroll container; the query, mode, meta, and options stay pinned.

### 3.2 Narrow desktop panel (down to the 140 px resize floor)

`app.js` clamps the side panel to `Math.max(140, …)` during a drag, so the design
must survive 140 px even though 240 px is the default. At 200 px and below a container
query stacks the controls (§9.7):

- The grouping control becomes two full-width rows, so "One per file" never
  truncates.
- The meta row wraps: the summary takes the full width, and Options moves to
  its own right-aligned line.
- The sort row wraps: "Sort by" on one line, the select full-width below it.

Between 201 and 240 px the only degradation is the summary ellipsis; the mode
segments and Options stay on one row.

### 3.3 Phone

The side panel is already a fixed drawer; for the search view the existing rule
`body.drawer-open[data-drawer-view="search"] #side-panel { width: 100% }`
makes it full-width. The layout is identical, with 44 px controls:

```
┌ drawer, 100% width ────────────────────┐
│ SEARCH                              ×   │  44 px header
│ [ Search notebooks…       ]  [Aa]       │  44 px
│ [ All matches ][ One per file ]          │  50 px track
│ 6 matches in 3 files        Options ⌄   │
│ Click a row to open its first match.     │
│ ┌─────────────────────────────────────┐ │
│ │ projects/notes/a.md     3 matches   │ │  min 52 px
│ │ Remember to fix the fix before…     │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

---

## 4. Controls

Four controls are always visible (query, case, grouping, Options) and two live
behind Options (Regex, Sort); six in total. No control has a label stacked above
it; the panel stays a search surface, not a form.

| # | Control | Markup | Visible label | Default | Behavior |
|---|---|---|---|---|---|
| 1 | Query | `input[type=search].search-panel-input` | placeholder "Search notebooks…" | empty | Existing 250 ms debounce. `Enter` runs immediately and opens the active row. |
| 2 | Case sensitive | `label.search-panel-case` > `input[type=checkbox]` + `span` | "Aa" | off | Existing. `aria-label="Case sensitive"` on the checkbox. Re-runs the search immediately. |
| 3 | Result grouping | `div.search-panel-mode[role=radiogroup]` with two native radios | "All matches" / "One per file" | **All matches** | Re-runs the search immediately. Resets the active row to the first result and scrolls the list to top. |
| 4 | Options disclosure | `button.search-panel-options-toggle` | "Options" (becomes "Options (2)" when active) | collapsed | Toggles `.search-panel-options[hidden]`. Does **not** re-run a search. `aria-expanded`, `aria-controls`. |
| 5 | Regex | checkbox in `.search-panel-opt-row` | "Regex" | off | Sends `regex=1`. Re-runs immediately. Visible hint is screen-reader-only: "Use a Python regular expression." |
| 6 | Sort | native `select.search-panel-select` in `.search-panel-opt-row` | "Sort by" | **Path A–Z** | Re-runs immediately. Options: "Most matches", "Path A–Z", "Recently edited". |

> Native radios and a native select are deliberate. They bring arrow-key
> behavior, form semantics, and screen-reader announcements for free, and they
> match the Settings modal's theme controls. The radio inputs are visually
> hidden but remain focusable.

### 4.1 Grouping labels

- "All matches" — every hit, one row per hit. Today's behavior.
- "One per file" — one row per file, with the number of matches in that file.
  This is the plain-English name for "unique". Never label it "Unique",
  "Dedupe", or "Collapse"; those do not say what the user will see.
- Radio group accessible name: **"Result grouping"**.
- When the mode changes, the summary is the feedback ("12 matches" → "12
  matches in 4 files"). No toast.

### 4.2 One-per-file row

```
┌ button.search-panel-hit ───────────────────────────┐
│  projects/notes/a.md                    3 matches   │  ← .sp-file / .sp-count
│  Remember to fix the fix before the demo.           │  ← first-match snippet
│  (screen-reader-only: "Opens at the first match.")  │
└─────────────────────────────────────────────────────┘
```

- The count is text, not a bare number in color: "3 matches" / "1 match".
- The snippet is the **first** match in the file, built with the existing
  `buildSnippet()` path (no `innerHTML` of server text).
- The whole row is a `<button type="button">`; it opens the file at its first
  match. The row carries `data-line` = the first match line.
- A single line under the meta row — visible only in one-per-file mode — says
  **"Click a row to open its first match."** This is the affordance; no
  per-row chevron is needed.
- No count on all-matches rows; they keep "line 12" in `.sp-meta`.

### 4.3 Options

Only two rows, both low-frequency:

```
.search-panel-options
  row 1:  ☐ Regex
  row 2:  Sort by            [ Path A–Z ▾ ]
```

- Sort is last because it is read once and rarely changed.
- The panel has no title of its own; the Options button is its label.
- The disclosure is inline (pushed content), never an overlay. Overlays over a
  240 px panel hide the results and are hard to dismiss on touch.
- "Options (n)" counts **non-default** settings: regex on = 1, sort not
  "Path A–Z" = 1, both = 2. The visible text contains the number; the
  `aria-label` is "Search options, n active".
- Opening/closing does not change focus anywhere except returning focus to the
  button when Esc closes it.

Request mapping:

| UI state | Query parameter |
|---|---|
| One per file | `unique=1` |
| Regex on | `regex=1` (omitted when off) |
| Sort: Most matches | `order=count&desc=1` |
| Sort: Path A–Z | `order=path` |
| Sort: Recently edited | `order=mtime&desc=1` |
| Case sensitive | `case=1` (existing) |
| Truncation cap | `limit=<N>`; echo `limit` in the response for the copy |

### 4.4 What is not exposed

Do not add a scope field, a file-type filter, a "whole word" toggle, a per-file
cap field, or a show-more button in this phase. See §11.

---

## 5. States and copy

Every state keeps the query, mode, and options controls visible. Only the
summary, note, and list region change. Use `textContent`, never `innerHTML`, for
all copy that includes the query.

| State | Summary (`.search-panel-summary`) | List region |
|---|---|---|
| **Idle, empty query** | empty | `.search-panel-state`: title **"Search your notebooks"**, hint **"Type a word or phrase to find it in every note."** |
| **Loading** (debounce fired, request in flight) | **"Searching…"** | Keep the previous rows; set `aria-busy="true"` on the list and add `.is-loading` (opacity .6). On the first search, hide the idle/no-match state and leave the list region blank. No spinner. |
| **All matches** | **"12 matches"**, **"1 match"** | One row per hit. `.sp-meta` = "line 12". |
| **One per file** | **"12 matches in 4 files"** / **"1 match in 1 file"** | One row per file, `.sp-count` = "3 matches". Below the meta row, note **"Click a row to open its first match."** |
| **Truncated** (`truncated: true`) | **"Showing first 200 matches"** (use the server-returned limit) | Same rows as the current mode. Note below the summary: **"Refine your query to narrow the results."** In one-per-file mode the same truncation note replaces the mode note. |
| **No matches** | **"0 matches"** | `.search-panel-state`: title `No matches for “<query>”`, hint **"Try a shorter word or check the spelling."** If Regex is on: **"Check the pattern, or turn off Regex to search plain text."** |
| **Error** | **"Search failed"** with `.error` | `.search-panel-error` banner (`role="alert"`) above any previous rows: title **"Search failed"**, the server message in muted text, and a **Retry** button. Previous results stay visible and usable. |
| **Idle after a mode/option change with an empty query** | empty | Same as idle. Changing an option with no query never sends a request. |

Notes:

- The zero state never says "0 results"; use **"0 matches"** for consistency
  with the positive summary.
- The no-matches title quotes the query with typographic quotes; a long query
  wraps inside the state block rather than being cut off.
- "Showing first 200 matches" must not read "200+ matches". The user needs to
  know a cap was hit and that the number is a cap, not a total.
- The error banner stays even if the rows underneath are from the previous
  query; the query field is unchanged and Retry re-runs it.
- While loading, do not clear the list; clearing causes flicker every 250 ms
  while typing.

---

## 6. Keyboard and focus

Focus order in the panel:

1. Header collapse button
2. Query field
3. "Aa" case checkbox
4. Grouping radiogroup (one tab stop; Arrow keys move between radios)
5. Options button
6. When open: Regex checkbox → Sort select
7. Result rows (one roving tab stop)
8. Error banner's Retry button, when present

### 6.1 Query field

| Key | Action |
|---|---|
| printable keys | Type; search runs 250 ms after the last keystroke |
| `Enter` | Cancel the debounce; run the search; open the **active** row if rows exist |
| `ArrowDown` / `ArrowUp` | Move the active row; keep focus in the field; scroll the row into view |
| `Escape` | If the query is non-empty: clear it, cancel the debounce, restore the idle state, and `stopPropagation()` so the phone drawer does not close. If empty: let the event reach the shell (phone closes the drawer; desktop no-op). |

`Enter` must open the active row, not always the first row. Today's handler
resets `activeIdx = 0`; that is a bug in the new model and must be changed.

### 6.2 Result rows

Rows are `<button>` elements with a roving tabindex: the active row has
`tabindex="0"`, all others `tabindex="-1"`. When the list has focus:

| Key | Action |
|---|---|
| `ArrowDown` / `j` | Next row |
| `ArrowUp` / `k` | Previous row |
| `Home` | First row |
| `End` | Last row |
| `Enter` / `Space` | Open the active row (native button activation also works) |
| `Escape` | Focus the query and select its text; do not clear it |

`j` / `k` are only handled while a row has focus, so typing in the query still
inserts letters. The top-bar search keeps its own vim model (including
`gg` / `G`); the side panel does not need chords.

On results arrival, `activeIdx = 0` and the first row is highlighted. Tab from
the Options controls enters the active row. Tab from the active row leaves the
list (to the panel resize handle or the browser chrome); it does not walk every
result.

### 6.3 Grouping and Options

- The radiogroup is one tab stop. Arrow keys change the selection and run the
  search immediately; the focused radio keeps focus.
- `Enter` / `Space` on the Options button toggles the disclosure.
- `Escape` inside the open Options panel closes it and returns focus to the
  Options button. It does not close the search panel.
- Changing Regex or Sort keeps focus on that control; the summary announces the
  new count.

### 6.4 After a hit opens

Focus moves to the note (existing behavior). The panel keeps its query and
active row for the next visit.

---

## 7. Accessibility

### 7.1 Labels and semantics

| Element | Accessible name / role |
|---|---|
| Query | `aria-label="Search notebooks"` (the placeholder is not a label) |
| Case checkbox | `aria-label="Case sensitive"`; visible "Aa" stays |
| Grouping | `div role="radiogroup" aria-label="Result grouping"`; two native radios in labels |
| Options button | visible "Options" / "Options (2)"; `aria-expanded`, `aria-controls="search-panel-options"`; when active, `aria-label="Search options, 2 active"` |
| Regex | native checkbox with visible label "Regex" and `aria-label="Regex"`; `aria-describedby` points to the `.search-panel-sr` hint "Use a Python regular expression." |
| Sort | visible `<label for="search-panel-sort">Sort by</label>` + native select |
| Summary | `role="status"` (polite); `aria-atomic="true"` |
| Error banner | `role="alert"`; Retry is a real button |
| Result row | native `<button>`; name is its visible file + count + snippet; unique rows append `.search-panel-sr` "Opens at the first match." |
| Loading | `aria-busy="true"` on the list; summary says "Searching…" |

### 7.2 Contrast (existing tokens, both themes)

Computed against the actual panel surfaces. All values pass WCAG AA for normal
text. No new color token is introduced.

| Pair | Dark | Light |
|---|---|---|
| `--fg-muted` on `--bg-panel` (summary, snippets, hints) | 4.74:1 | 5.56:1 |
| `--fg` on `--bg-panel` (file names, count pills, state titles) | 11.3:1 | 13.5:1 |
| `--accent` on `--bg-panel` (focus ring, active bottom rail) | 6.0:1 | 5.34:1 |
| `--danger` on `--bg-panel` (error summary text) | 5.64:1 | 5.07:1 |
| `--fg` on the error banner fill | 10.05:1 | 12.26:1 |

The error banner uses `--fg` for all text and `--danger` only for its border
plus a leading "!" glyph, so the light-theme danger text ratio (4.26:1 on the
soft fill) is never relied on.

### 7.3 No color-only meaning

- **Selected mode:** filled `--bg-elev` surface + `font-weight: 600` + a 2 px
  inset `--accent` bottom rail, plus `:checked` semantics. Not just a tint.
- **Match count:** the word "matches" is always present.
- **Error:** the words "Search failed" plus the "!" glyph; red is reinforcement.
- **Active row:** `--accent-soft` fill **and** the row is the focused element or
  the `.is-active` target, so keyboard users get the outline/focus ring.

### 7.4 Focus

Every new control uses:

```css
outline: 2px solid var(--accent);
outline-offset: 2px;
```

Result rows use `outline-offset: -2px` so the ring stays inside the full-width
row. Never remove the outline without a replacement. The radios' native input
is visually hidden; put the ring on the adjacent span via
`input:focus-visible + span`.

### 7.5 Touch and motion

- Phone controls are at least 44 px (see §8); rows are at least 52 px.
- No new animation except the existing `.12s` background transition on the
  segmented control. Add the new selectors to the existing
  `prefers-reduced-motion` block so it becomes instant.
- No interaction depends on hover: the row is a button, the options are
  always visible once open, and the selected mode is visible without hover.

---

## 8. Phone adaptation

The phone shell is defined by the existing media query
`(max-width: 860px), ((pointer: coarse) and (max-width: 1023px))` in
`style.css`. All overrides below go inside it.

| Element | Desktop | Phone |
|---|---|---|
| Query field | 32 px tall, .9rem | `min-height: var(--m-hit)` (44), 16px (prevents iOS zoom) |
| "Aa" toggle | content height | 44 × 44 hit area, 18 px checkbox |
| Grouping track | 30 px | 50 px (44 px segments + 2 px padding + 1 px border) |
| Grouping segment | 26 px, .8rem | 44 px, 15px |
| Options button | 26 px, .76rem | 44 px, 14px, right-aligned |
| Options panel | inline card, 2 rows | inline card, rows 44 px / 15px, select 44 px / 16px |
| Result row | 5 px 8 px padding | `min-height: 52px; padding: 8px` (existing) |
| Count pill | .72rem | 12px |
| State title / hint | .86rem / .78rem | 15px / 14px |
| Retry | 28 px | 44 px |

- The drawer already focuses `.search-panel-input` 220 ms after opening
  (`mobile.js` `focusDrawer()`), so the on-screen keyboard opens on the field.
  Keep that.
- When a result opens, the existing mobile behavior closes the drawer. Do not
  add a second close path.
- The Options panel is inline, not a popover or sheet, so it cannot be clipped
  by the drawer and needs no new layer in the history stack.
- The mode switch is at the top, within thumb reach of the field. Do not move
  it into the drawer footer.

---

## 9. DOM and CSS handoff

### 9.1 Final DOM (desktop, results + options open)

```html
<div id="search-view" class="side-panel-view" data-view="search">
  <div class="panel-header">
    <span class="panel-title">Search</span>
    <button class="collapse-btn" type="button" aria-label="Collapse side panel">‹</button>
  </div>

  <div class="search-panel-input-row">
    <input type="search" class="search-panel-input"
           placeholder="Search notebooks…" aria-label="Search notebooks">
    <label class="search-panel-case" title="Case sensitive">
      <input type="checkbox" aria-label="Case sensitive">
      <span>Aa</span>
    </label>
  </div>

  <div class="search-panel-mode" role="radiogroup" aria-label="Result grouping">
    <label class="search-panel-mode-opt">
      <input type="radio" name="search-panel-mode" value="all" checked>
      <span>All matches</span>
    </label>
    <label class="search-panel-mode-opt">
      <input type="radio" name="search-panel-mode" value="unique">
      <span>One per file</span>
    </label>
  </div>

  <div class="search-panel-meta">
    <div class="search-panel-summary" role="status" aria-live="polite"
         aria-atomic="true">12 matches in 4 files</div>
    <button type="button" class="search-panel-options-toggle"
            aria-expanded="true" aria-controls="search-panel-options">
      <span class="search-panel-options-label">Options</span>
      <span class="search-panel-chevron" aria-hidden="true">⌄</span>
    </button>
  </div>

  <div class="search-panel-note">Click a row to open its first match.</div>

  <div class="search-panel-options" id="search-panel-options">
    <label class="search-panel-opt-row">
      <input type="checkbox" id="search-panel-regex" aria-label="Regex"
             aria-describedby="search-panel-regex-help">
      <span>Regex</span>
      <span id="search-panel-regex-help" class="search-panel-sr">
        Use a Python regular expression.
      </span>
    </label>
    <div class="search-panel-opt-row">
      <label for="search-panel-sort">Sort by</label>
      <select id="search-panel-sort" class="search-panel-select">
        <option value="most">Most matches</option>
        <option value="path" selected>Path A–Z</option>
        <option value="recent">Recently edited</option>
      </select>
    </div>
  </div>

  <div class="search-panel-list" aria-busy="false">
    <button type="button" class="search-panel-hit" data-line="4" tabindex="0">
      <span class="search-panel-hit-file">
        <span class="sp-file">projects/notes/a.md</span>
        <span class="sp-count">3 matches</span>
      </span>
      <span class="search-panel-hit-snippet">Remember to <mark>fix</mark> the parser before the demo.</span>
      <span class="search-panel-sr">Opens at the first match.</span>
    </button>
    <button type="button" class="search-panel-hit" data-line="2" tabindex="-1">
      <span class="search-panel-hit-file">
        <span class="sp-file">projects/notes/b.md</span>
        <span class="sp-count">1 match</span>
      </span>
      <span class="search-panel-hit-snippet">The <mark>fix</mark> landed in the last release.</span>
      <span class="search-panel-sr">Opens at the first match.</span>
    </button>
  </div>
</div>
```

State variants:

```html
<!-- Idle -->
<div class="search-panel-state">
  <div class="search-panel-state-title">Search your notebooks</div>
  <div class="search-panel-state-hint">Type a word or phrase to find it in every note.</div>
</div>

<!-- No matches -->
<div class="search-panel-state">
  <div class="search-panel-state-title">No matches for “regulr expression”</div>
  <div class="search-panel-state-hint">Check the pattern, or turn off Regex to search plain text.</div>
</div>

<!-- Error, above any previous rows -->
<div class="search-panel-error" role="alert">
  <span class="search-panel-error-mark" aria-hidden="true">!</span>
  <div class="search-panel-error-body">
    <div class="search-panel-error-title">Search failed</div>
    <div class="search-panel-error-detail">Search error: Server Error</div>
  </div>
  <button type="button" class="search-panel-retry">Retry</button>
</div>
```

### 9.2 New scoped tokens

Add once at the top of the search region in `style.css`. Colors stay existing;
these are spacing/size tokens only, scoped to `#search-view` so no other view is
touched.

```css
#search-view {
  --search-space-1: 4px;
  --search-space-2: 6px;
  --search-space-3: 8px;
  --search-space-4: 12px;
  --search-space-5: 16px;
  --search-radius-sm: 4px;
  --search-radius-md: 6px;
  --search-mode-h: 26px;        /* segment; track = mode-h + 4 */
  --search-control-h: 26px;
  --search-hit-min-h: 32px;
}
```

### 9.3 New classes

| Class | Purpose |
|---|---|
| `.search-panel-mode` | Segmented track: 2-column grid, `--bg`, 1 px `--border`, radius md, 2 px padding |
| `.search-panel-mode-opt` | Label wrapper; `position: relative`; equal column |
| `.search-panel-mode-opt input` | Visually hidden but focusable radio |
| `.search-panel-mode-opt span` | Segment: flex center, `--search-mode-h`, .8rem, muted, radius sm |
| `.search-panel-meta` | One row: summary + Options button; `padding: 0 12px 4px` |
| `.search-panel-options-toggle` | Quiet text button, 26 px; label span + chevron |
| `.search-panel-options-label` | Holds "Options" / "Options (2)"; the JS updates this span, never the button's raw text |
| `.search-panel-chevron` | 1em glyph, rotates 180° when expanded (instant under reduced motion) |
| `.search-panel-options` | Inline card: `--bg`, 1 px border, radius md, margin `0 10px 6px`, padding `6px 8px`, grid gap 6 px |
| `.search-panel-opt-row` | Flex row, space-between, min-height 26 px, .8rem |
| `.search-panel-select` | Native select, `--bg-panel`, border, radius sm, .78rem |
| `.search-panel-note` | .72rem muted hint under the meta row |
| `.search-panel-state` | Idle/no-result block, padding 20 px 14 px |
| `.search-panel-state-title` | .86rem, 600, `--fg`, margin-bottom 4 px; wraps with `overflow-wrap: anywhere` |
| `.search-panel-state-hint` | .78rem, `--fg-muted`, line-height 1.45 |
| `.search-panel-error` | Danger-bordered banner, `--danger-soft`, flex, 6 px gap |
| `.search-panel-error-mark` | 1.1rem "!" glyph, `--danger`, flex none |
| `.search-panel-error-body` | flex 1, min-width 0 |
| `.search-panel-error-title` | .8rem, 600, `--fg` |
| `.search-panel-error-detail` | .74rem, `--fg-muted`, wrap anywhere |
| `.search-panel-sr` | Standard visually-hidden utility (clip, 1 px, absolute) |
| `.sp-count` | Count pill: .72rem, `--fg`, 1 px `--border`, pill radius, 0 6 px |
| `.search-panel-list.is-loading` | `opacity: .6` while `aria-busy="true"` |

### 9.4 Key CSS

```css
.search-panel-mode {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
  margin: 0 10px var(--search-space-1);
  padding: 2px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--search-radius-md);
}
.search-panel-mode-opt { position: relative; display: flex; }
.search-panel-mode-opt input {
  position: absolute;
  width: 0; height: 0;
  opacity: 0;
  pointer-events: none;
}
.search-panel-mode-opt span {
  flex: 1 1 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--search-mode-h);
  border-radius: var(--search-radius-sm);
  color: var(--fg-muted);
  font-size: .8rem;
  cursor: pointer;
  user-select: none;
  transition: background .12s ease, color .12s ease;
}
.search-panel-mode-opt span:hover { background: var(--accent-soft); color: var(--fg); }
.search-panel-mode-opt input:checked + span {
  background: var(--bg-elev);
  color: var(--fg);
  font-weight: 600;
  box-shadow: inset 0 -2px 0 var(--accent);
}
.search-panel-mode-opt input:focus-visible + span {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.search-panel-meta {
  display: flex;
  align-items: flex-start;
  gap: var(--search-space-3);
  padding: 0 var(--search-space-4) var(--search-space-1);
}
.search-panel-meta .search-panel-summary {
  flex: 1 1 auto;
  min-width: 0;
  padding: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-panel-options-toggle {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-height: var(--search-control-h);
  padding: 0 2px;
  background: none;
  border: 0;
  border-radius: var(--search-radius-sm);
  color: var(--fg-muted);
  font: inherit;
  font-size: .76rem;
  cursor: pointer;
}
.search-panel-options-toggle:hover { color: var(--fg); background: var(--accent-soft); }
.search-panel-options-toggle[aria-expanded="true"] { color: var(--fg); }
.search-panel-options-toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.search-panel-chevron { font-size: .9em; line-height: 1; transition: transform .12s ease; }
.search-panel-options-toggle[aria-expanded="true"] .search-panel-chevron { transform: rotate(180deg); }

.search-panel-options {
  margin: 0 10px var(--search-space-2);
  padding: var(--search-space-2) var(--search-space-3);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--search-radius-md);
  display: grid;
  gap: var(--search-space-2);
}
.search-panel-options[hidden] { display: none; }
.search-panel-opt-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--search-space-3);
  min-height: var(--search-control-h);
  font-size: .8rem;
  color: var(--fg);
}
.search-panel-opt-row input { margin: 0; }
.search-panel-select {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 132px;
  min-height: var(--search-control-h);
  padding: 2px 4px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--search-radius-sm);
  color: var(--fg);
  font: inherit;
  font-size: .78rem;
}
.search-panel-select:focus-visible,
.search-panel-opt-row input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.search-panel-note {
  padding: 0 var(--search-space-4) var(--search-space-2);
  color: var(--fg-muted);
  font-size: .72rem;
  line-height: 1.4;
}

/* Result rows become buttons without changing their look. */
.search-panel-hit {
  display: block;
  width: 100%;
  min-height: var(--search-hit-min-h);
  text-align: left;
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
}
.search-panel-hit:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.search-panel-hit-file { /* existing: flex, baseline, space-between */ }
.sp-count {
  flex: 0 0 auto;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--fg);
  font-size: .72rem;
  line-height: 1.5;
  white-space: nowrap;
}

.search-panel-state { padding: 20px 14px; }
.search-panel-state-title {
  margin-bottom: 4px;
  color: var(--fg);
  font-size: .86rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.search-panel-state-hint {
  color: var(--fg-muted);
  font-size: .78rem;
  line-height: 1.45;
}

.search-panel-error {
  display: flex;
  align-items: flex-start;
  gap: var(--search-space-2);
  margin: 0 0 var(--search-space-3);
  padding: var(--search-space-3);
  background: var(--danger-soft);
  border: 1px solid var(--danger);
  border-radius: var(--search-radius-md);
}
.search-panel-error-mark { color: var(--danger); font-weight: 700; line-height: 1.2; }
.search-panel-error-body { flex: 1 1 auto; min-width: 0; }
.search-panel-error-title { color: var(--fg); font-size: .8rem; font-weight: 600; }
.search-panel-error-detail {
  margin-top: 2px;
  color: var(--fg-muted);
  font-size: .74rem;
  overflow-wrap: anywhere;
}
.search-panel-error .search-panel-retry { flex: 0 0 auto; }

.search-panel-list.is-loading { opacity: .6; }

.search-panel-sr {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
```

### 9.5 Existing classes reused unchanged

`.panel-header`, `.panel-title`, `.collapse-btn`, `.search-panel-input-row`,
`.search-panel-input`, `.search-panel-case`, `.search-panel-summary`,
`.search-panel-retry`, `.search-panel-list`, `.search-panel-hit`,
`.search-panel-hit-file`, `.sp-file`, `.sp-meta`,
`.search-panel-hit-snippet`, and the `mark` rule inside it.

Changes to existing rules are limited to:

- `.search-panel-summary` loses its own horizontal padding **inside
  `.search-panel-meta` only** (scoped rule above). Keep the base rule for the
  error-in-summary fallback and any other consumer.
- `.search-panel-hit` gains the button reset (display, width, border, font).
- `.search-panel-empty` is superseded by `.search-panel-state` for new states;
  keep the old class if tests still reference it.
- `.search-panel-hit:hover, .search-panel-hit.is-active` keep today's
  `--accent-soft` fill.

### 9.6 Phone overrides

Add inside the existing phone media query, near the current search block:

```css
#search-view {
  --search-mode-h: 44px;
  --search-control-h: var(--m-hit);
  --search-hit-min-h: 52px;
}
.search-panel-mode { margin: 0 var(--search-space-4) var(--search-space-2); }
.search-panel-meta { padding: 0 var(--search-space-4) var(--search-space-2); }
.search-panel-options-toggle { font-size: 14px; padding: 0 8px; }
.search-panel-options { margin: 0 var(--search-space-4) var(--search-space-3); padding: 4px 10px; }
.search-panel-opt-row { font-size: 15px; }
.search-panel-opt-row input { width: 20px; height: 20px; }
.search-panel-select { font-size: 16px; max-width: 160px; }
.search-panel-mode-opt span { font-size: 15px; }
.search-panel-case {
  min-width: var(--m-hit);
  min-height: var(--m-hit);
  justify-content: center;
  font-size: 15px;
}
.search-panel-case input { width: 18px; height: 18px; }
.search-panel-error .search-panel-retry { min-height: var(--m-hit); }
.search-panel-hit .sp-file { font-size: 15px; }
.search-panel-hit-snippet { font-size: 14px; }
.sp-count { font-size: 12px; }
.search-panel-state-title { font-size: 15px; }
.search-panel-state-hint { font-size: 14px; }
```

The existing phone rules for `.search-panel-hit` (`min-height: 52px; padding:
8px`) and `.search-panel-input` (44 px, 16 px font) stay.

### 9.7 Narrow desktop panel (container query, 200 px and below)

`#search-view` becomes an inline-size container. This is independent of the
viewport media query, so it responds to the panel being dragged narrow.

```css
#search-view { container-type: inline-size; }

@container (max-width: 200px) {
  #search-view .search-panel-mode { grid-template-columns: 1fr; }
  #search-view .search-panel-meta { flex-wrap: wrap; }
  #search-view .search-panel-options-toggle { margin-left: auto; }
  #search-view .search-panel-opt-row { flex-wrap: wrap; }
  #search-view .search-panel-opt-row .search-panel-select {
    flex-basis: 100%;
    max-width: none;
  }
}
```

The 140 px floor also means the input row can get tight: the query field is
`flex: 1 1 auto; min-width: 0` already, and the "Aa" label is `flex: 0 0 auto`.
It degrades by shrinking the field, never by pushing the label out of the
panel.

---

## 10. What changes, file by file (references only)

### 10.1 `static/js/activity.js` — `mountSearch()`

- Build the grouping radiogroup, the meta row, the Options disclosure, the note,
  and the state/error markup from §9.1.
- Replace the flat `currentMatches` with `visibleRows` containing the rendered
  row data (all hits, or one file group with `{file, line, col, snippet, count}`).
  `activeIdx`, `applyActive()`, and Enter all operate on `visibleRows`.
- `renderResults(data, q, caseSensitive)`:
  - compute summary and note for the active mode and `truncated`;
  - render all-mode rows with `.sp-meta` "line N";
  - render unique-mode rows with `.sp-count` and the sr hint;
  - set `aria-busy="false"` and remove `.is-loading`.
- `showSearchError()`: put `.search-panel-summary.error` "Search failed" in the
  meta row and insert the `.search-panel-error` banner at the top of the list;
  keep any previous rows; Retry re-runs.
- Add `runSearch()` guards: no query → idle state, clear the list, no request.
- Add the request options object (see §10.4) and the `change` handlers for both
  radios, Regex, and Sort.
- Keyboard: fix Enter to open the active row; add list-level
  Arrow/j/k/Home/End/Enter/Escape; add Esc-clears-query in the input with
  `stopPropagation()` only when non-empty.
- Options button updates `.search-panel-options-label` to "Options (n)" and its `aria-label`.
- Keep the mount-time `input.focus()`.

### 10.2 `static/css/style.css`

- Add the scoped tokens (§9.2), the new classes (§9.3–9.4), the button reset on
  `.search-panel-hit`, and the phone overrides (§9.6) inside the existing
  search region and phone media query.
- Add the new transitions to the existing `prefers-reduced-motion` block.

### 10.3 `static/js/api.js`

`search(q, caseSensitive)` gains an optional third argument, so the top-bar
search call is unchanged:

```js
search: (q, caseSensitive, opts) => {
  const o = opts || {};
  const p = new URLSearchParams({ q, case: caseSensitive ? "1" : "0" });
  if (o.regex) p.set("regex", "1");
  if (o.unique) p.set("unique", "1");
  if (o.order) p.set("order", o.order);
  if (o.desc) p.set("desc", "1");
  if (o.limit != null) p.set("limit", String(o.limit));
  return request("GET", "/api/search?" + p.toString());
}
```

### 10.4 `app.py` — `/api/search`

- Accept `unique=1`. Group matches by file **before** applying `limit` /
  `perFile`, so `count` is the true number of matches in that file. Return one
  entry per file with `count`, and keep `line` / `col` / `snippet` of the first
  match.
- Echo the applied cap as `limit` in the JSON response. The client uses it for
  "Showing first N matches" instead of hard-coding 200.
- Response shape remains compatible for existing callers:
  `{query, matches:[{file,line,col,snippet,count?}], truncated, limit}`.

### 10.5 `tests/dom/test_dom.js`

Extend the existing search block (do not add a new runner): assert the mode
radios exist, that switching to one-per-file renders one `.search-panel-hit`
per file with `.sp-count`, that clicking it still opens the note and highlights
a match, that Options toggles the disclosure, and that the error banner's Retry
keeps the query. Keep the existing `.search-panel-hit` / `.sp-file` selectors
working.

### 10.6 `templates/index.html`

No change required. `#search-view` already ships.

---

## 11. Recommended scope

### Must-have (this phase)

| Option | Why it earns its place |
|---|---|
| All matches / One per file | The request. Cuts repeated paths without hiding information. |
| Case sensitive (existing) | Already there; cheap and understood. |
| Regex | The one power option worth a disclosure row; the backend already supports it. |
| Sort by: Path A–Z / Recently edited / Most matches | Fixes "where is that recent note?" and makes counts usable. Three fixed choices, no free text. |

### Phase 2 (designed, not built)

| Option | Placement when added |
|---|---|
| **Show more** past the cap | Replace the truncated note with a `Show more` button that doubles `limit`; keep "Showing first N". Needs accurate `truncated` + `limit` first (this phase). |
| **Per-file expand** ("Show all 3") | A second-line button inside a unique row, with `aria-expanded`; expands the file's hits in place. Add only if users ask for the hits without leaving the panel. |
| **Scope: this folder / glob** | A chip under the meta row, set from the file tree's context menu ("Search in folder"), not a free-text glob field. |
| **Persist mode and sort** | Add `searchMode` / `searchOrder` to `config.json` only if users report re-setting them. Session state is enough for now. |
| **Whole word** | Requires a backend flag. Do not fake it by filtering snippets client-side. |

### Avoid

- A "Unique" label, a checkbox labelled "Collapse duplicates", or an icon-only
  toggle. The two named modes are the whole point.
- Putting Regex/Sort inline. Six always-visible controls in a 240 px panel is a
  form.
- Per-file grouping on the server response only as a visual trick that hides
  hits with no count. The count is the information.
- Hiding the mode switch while idle or while loading. Layout jumps and users
  cannot set the mode before typing.
- Auto-expanding a file group on click. The primary action is opening the note;
  expansion is a phase-2 affordance with its own control.
- Replacing the summary with a spinner on every keystroke.

---

## 12. Acceptance checklist

- [ ] Default view (empty query, options closed) shows header, query, mode only;
      no options panel, no error, no results.
- [ ] "One per file" shows one row per file, each with "N matches" / "1 match"
      and the first match's snippet.
- [ ] Summary reads "N matches in M files" in one-per-file mode and "N matches"
      in all mode; "1 match" is singular.
- [ ] The note "Click a row to open its first match." is visible only in
      one-per-file mode (or replaced by the truncation note).
- [ ] Clicking a unique row opens the file and highlights the first match.
- [ ] Options opens inline with Regex and Sort; changing either re-runs the
      query; the button shows "(n)" for non-default settings.
- [ ] Idle, loading, truncated, no-match, and error states match §5, including
      the Retry button and preserved previous rows on error.
- [ ] Enter opens the active row; arrows/j/k/Home/End work; Esc in the list
      returns to the query; Esc in a non-empty query clears it without closing
      the phone drawer.
- [ ] Every control has an accessible name; selected mode is not conveyed by
      color alone; focus rings are visible in both themes.
- [ ] Phone: 44 px controls, 52 px rows, no hover-only affordance, drawer
      search remains 100% width.
- [ ] No new color literal appears in the new CSS; only existing variables.
