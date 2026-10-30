# Search panel — Advanced disclosure

Design handoff for moving the side-panel search filters behind an
**Advanced** disclosure (`#search-view`, built by `mountSearch()` in
`static/js/activity.js`, styled in `static/css/style.css`).

Reference mockup: `docs/design/search-panel-advanced.html`.

Status: design only. No source files were changed. `web-engineer`
implements the markup change in `activity.js` and the CSS change in
`style.css`.

Companion: `docs/design/search-panel-controls.md`. **This document
supersedes its §3 anatomy, §4–§5 control layout, and the always-visible
statement in §5.** It keeps that document's tokens, result-row styling,
summary/error copy, state rules, accessibility rules, and the DOM-test
contract in its §8.7. Where the two disagree on the control area, this
document wins.

**Normative source.** §3 (the model), §4 (anatomy), §5 (control specs),
§6 (states), §7 (accessibility) and §8 (DOM/CSS handoff) are the single
source of truth. The mockup illustrates them; where the two differ, this
document wins.

---

## 1. Design intent

**One line:** the query row stays; the filters move behind one quiet
`Advanced` line, and the line tells you when a non-default setting is
still active.

The current design shows three caption + control rows at all times. At
240 px that is about 212 px before the summary, and the user rejects it:
too tall, too busy, and the settings compete with the query for
attention. The fix is not another rearrangement of the same rows. It is
a disclosure:

```
[ Search notebooks… ] [Aa]
Advanced ⌄                         All matches · Recently modified
──────────────────────────────────────────────────────────────────
6 notes · 14 matches
```

Collapsed, the controls zone is **80 px** instead of 212 px. The results
start about 131 px higher. The three filters are still there, one click
away, in a denser layout than before.

### 1.1 The chosen behaviour: A — disclosure only

**The Advanced controls take effect whether or not the panel is open.**
The trigger shows and hides the controls; it never enables or disables
the settings. This is model **A** from the brief.

Why not model **B** (power gate: options apply only while Advanced is
on, and closing resets them to defaults):

1. A filter is not a mode switch. Closing a drawer must not silently
   rewrite the result set under the user. With B, collapsing an
   "All matches" search would turn 14 matches back into 6 notes; the
   user would have to reopen Advanced just to keep the view they chose.
2. B makes the trigger destructive. A disclosure that discards state on
   close is a reset button wearing a chevron.
3. Hidden state is solved by **showing** it, not by disabling it. The
   collapsed row carries a settings summary (or a count badge at 140 px),
   so the user can always see that a non-default option is active. The
   summary is the honest version of "toggle to enable": you can see the
   state, and one click lets you edit it.

If the user later asks for a gate, the safe version is a separate
**Reset to defaults** action inside the panel, not a side effect of
closing it. That is out of scope here.

### 1.2 What stays visible when Advanced is collapsed

| Always visible | Not visible until Advanced is expanded |
|---|---|
| Header (`Search` + collapse/close) | Search in (`Content` / `File name`) |
| Query field | Grouping (`All matches` / `One per note`) |
| `Aa` case toggle | Sort (`Path (A–Z)` / `Recently modified` / `Most matches`) |
| `Advanced` trigger + settings summary/badge | — |
| Results summary, note, list | — |

`Aa` stays beside the query. It is one 28 px toggle, it is used often,
and it changes the result set. Moving it inside the disclosure would
create a second hidden active state with no room for a text summary, and
would add a tab stop inside a panel the user may never open. One visible
toggle is cheaper than one hidden state.

### 1.3 What does not change

- The query, its 250 ms debounce, `Enter`, and `Escape` behaviour.
- `searchTarget`, `searchUnique`, `searchSort`, `searchCaseSensitive`
  and the request parameters `unique` / `name` / `order` / `desc` /
  `case`.
- The result rows, the summary copy, the note, the empty/error/truncated
  states, and the list keyboard model.
- The accessible names `Search in` and `Result grouping` on the two
  radiogroups, the `#search-panel-sort` id, and the summary wrapper
  roles (see §8.7).

### 1.4 Non-goals

No new filters, no regex control, no search history, no saved searches,
no change to the backend, no popover or sheet, no new palette, font or
dependency. The existing options are only relocated and restyled.

---

## 2. The collapsed row

One row sits under the input, inside `.search-panel-controls`:

```
Advanced ⌄                                      All matches · Recently
```

- **Left:** a real `<button>` labelled `Advanced`, with a CSS chevron.
  It is a quiet ghost control, not a filled button.
- **Right:** a one-line settings summary, right-aligned, muted, with an
  ellipsis. It is present only when at least one non-default option is
  active. It has a `title` with the full text.
- **At 140 px:** the summary is visually clipped but kept in the
  accessibility tree; a small count badge on the trigger takes its
  place. The badge reads `2` when two non-default options are active.
- The row is 26 px tall on desktop and 44 px on phone. It does not wrap.
- There is **no result re-run** when the row is toggled. It only shows or
  hides the filter controls.

### 2.1 What counts as non-default

The summary lists only settings that differ from their defaults, in a
fixed order, joined by ` · `:

| Setting | Default | Summary fragment |
|---|---|---|
| Search in | `Content` | `File name` |
| Grouping | `One per note` | `All matches` |
| Sort | `Path (A–Z)` | `Recently modified` or `Most matches` |

Rules:

- **`Aa` is never in the summary.** It is visible next to the query; the
  summary is for hidden controls only.
- In **File name** mode the Grouping filter is hidden *and* dormant, so
  its value is excluded from the summary. When the user switches back to
  Content, the value reappears if it is still non-default.
- In File name mode a `Most matches` sort is demoted to `Path (A–Z)` by
  the existing code, so it never appears in the summary.
- If every setting is at its default, the summary is empty, the badge is
  absent, and `aria-describedby` is removed from the trigger.

The badge count is the number of fragments above, 1–3. It is not the
number of non-default settings in File name mode when grouping is
dormant: that grouping fragment is excluded from both the text and the
count.

### 2.2 How much fits at 240 and 140 px

The trigger is about 70 px wide at `--font-scale: 1`; the row has about
**140 px** left for the summary at 240 px.

| Example | At 240 px | At 140 px |
|---|---|---|
| `File name` | fits | summary clipped, badge `1` |
| `All matches` | fits | summary clipped, badge `1` |
| `Recently modified` | fits | summary clipped, badge `1` |
| `File name · All matches` | fits | summary clipped, badge `2` |
| `All matches · Recently modified` | ellipsizes (`All matches · Recent…`) | summary clipped, badge `2` |
| `File name · Recently modified` | ellipsizes (`File name · Recently…`) | summary clipped, badge `2` |

Ellipsis is acceptable because the row still signals "non-default
active", the full text is in the summary's `title`, and one click opens
the controls. The alternative — wrapping to a second line — is exactly
the tall, ragged block this redesign removes.

### 2.3 Expanded state persistence

**Session-only, in memory, default collapsed.** The open/closed state
lives in a local variable in `mountSearch()`. It survives side-panel
view switches because the host stays mounted, and it resets to collapsed
on a page reload.

- No new config key, no server write, no localStorage.
- A persisted "expanded" state would surprise on a fresh phone launch
  and on a second device, and would grow the config blob for a transient
  piece of chrome.
- Resetting to collapsed on reload is not a surprise: the collapsed row
  still shows the persisted non-default settings in its summary, so the
  user can see the state without opening anything.

The state is **not** tied to a breakpoint. Rotating or resizing keeps the
user's choice for the session; the shell does not auto-collapse under
their finger.

---

## 3. The expanded layout

The panel opens in flow, between the `Advanced` row and the controls
zone's bottom hairline. It is not a popover, a sheet or an overlay: a
popover would be clipped by the 240 px panel and would need a new layer
in the phone drawer's history stack.

The filters use a **two-column grid**:

```
SEARCH IN            GROUPING
[ Content ]          [ All matches ]
[ File name ]        [ One per note ]
SORT
[ Path (A–Z)                    ▾ ]
```

- At the default 240 px the grid is two columns (about 106 px each); the
  Sort row spans both. Two radiogroups sit side by side, each with a
  caption above its own vertically stacked track; Sort is full width.
- This replaces three repeated caption+control rows with two rows. In the
  expanded state it saves about 29 px of filter height versus the old
  stack before the trigger row is counted; with the trigger row the
  expanded zone is about 219 px, within 7 px of the old 212 px. The real win is
  the collapsed state (80 px), which is the default.
- The tracks are **vertical** in the two-up grid. At 106 px a horizontal
  pair would truncate `One per note` at `--font-scale: 1.3`; stacked, each
  option gets the full column. The segment type inside the grid is
  `.76rem` with 2 px side padding so the longest label stays whole at
  1.3.
- Below a 228 px panel width the grid falls to **one column** and the
  vertical tracks remain. At 140 px this gives the old stable stack
  (Search in, Grouping, Sort) with full labels.
- **File name mode:** the Grouping filter is hidden. The Search in filter
  spans both columns and its track becomes horizontal, because it is now
  full width. The Sort row spans both columns. The result is a clean
  two-row panel, not a half-empty grid:
  ```
  SEARCH IN
  [ Content | File name ]
  SORT
  [ Path (A–Z)            ▾ ]
  ```
  At 140 px the one-column rule wins and the Search in track goes back to
  vertical, so it still fits.
- **Phone (390 px):** the grid stays two columns with vertical tracks;
  each column is about 179 px and every target is 44 px. This keeps the
  expanded panel 60 px shorter than a one-column phone layout. The
  `Advanced` row is 44 px. The disclosure starts collapsed on a fresh
  mount; tapping it blurs the query, so the on-screen keyboard retracts
  and the panel does not push results off-screen any more than necessary.

No filter row wraps, no caption is ever inline with its control, and
there is no horizontal scrollbar at 140, 240 or 390 px.

---

## 4. Anatomy by width

### 4.1 Default 240 px — collapsed (Content, One per note, Path)

```
┌ 240 px ──────────────────────────────────┐
│ SEARCH                                ‹  │  header 34
│ ┌───────────────────────────────┐ ┌──┐   │
│ │ Search notebooks…             │ │Aa│   │  input 32, Aa 28×32
│ └───────────────────────────────┘ └──┘   │
│ Advanced ⌄                               │  trigger row 26
├──────────────────────────────────────────┤  hairline
│ 6 notes · 14 matches                     │  summary 26
│ Click a row to open its first match.     │  note 18
│ ┌──────────────────────────────────────┐ │
│ │ parser-notes.md (projects/firmware)  │ │
│ │                        3 matches     │ │
│ │ The fix landed before the demo.      │ │
│ └──────────────────────────────────────┘ │
│ …                                        │
└──────────────────────────────────────────┘
```

Metrics (desktop, `--font-scale: 1`):

| Part | Value |
|---|---|
| Controls zone padding | `8px 10px 6px` |
| Input | `32px` tall; `Aa` `28 × 32` |
| Gap, input → Advanced row | `8px` |
| Advanced row | `26px` min-height |
| Advanced trigger | text `.78rem` 600, `--fg-muted`; hover `--fg` + `--accent-soft`; radius `4` |
| Chevron | `6 × 6px` CSS border, 1.5 px, rotates 180° when open |
| Settings summary | `.72rem`, `--fg-muted`, right-aligned, one line, ellipsis |
| Trigger row → bottom hairline | `6px` via the controls bottom padding; zone ends with `1px --border` |
| **Controls zone, collapsed** | **80px** |
| Summary | `26px` min-height; unchanged |
| Result rows | `.32px` min-height; unchanged |

Before the results: `34 + 80 + 1 + 26 = 141px`. The old always-visible
stack was `34 + 212 + 26 = 272px`; the default gains about 131 px of
results.

### 4.2 Default 240 px — expanded

```
┌ 240 px ──────────────────────────────────┐
│ SEARCH                                ‹  │
│ ┌───────────────────────────────┐ ┌──┐   │
│ │ Search notebooks…             │ │Aa│   │
│ └───────────────────────────────┘ └──┘   │
│ Advanced ⌃                               │
│ SEARCH IN          GROUPING              │
│ ┌──────────────┐   ┌──────────────┐      │
│ │   Content    │   │ All matches  │      │
│ ├──────────────┤   ├──────────────┤      │
│ │  File name   │   │ One per note │      │  selected
│ └──────────────┘   └──────────────┘      │
│ SORT                                     │
│ ┌──────────────────────────────────────┐ │
│ │ Path (A–Z)                         ▾ │ │
│ └──────────────────────────────────────┘ │
├──────────────────────────────────────────┤
│ 6 notes · 14 matches                     │
│ …                                        │
└──────────────────────────────────────────┘
```

Metrics:

| Part | Value |
|---|---|
| Grid | two columns, gap `8px`; Sort spans both |
| Filter | caption `13px` line + `4px` gap + control |
| Caption | `.66rem`, 600, uppercase, `.07em` tracking, `--fg-muted` |
| Two-up track | vertical, `60px` tall (`2 × 26 + 2 + 4 + 2`) |
| Segment (two-up) | `.76rem`, 2 px side padding, `26px` min-height |
| Sort select | full width, `32px`, `.78rem`, `24px` right padding |
| **Controls zone, expanded** | **≈219px** |
| Summary + list | unchanged |

The expanded zone is about 219 px; it is not the default. The 2-up grid
keeps it within 7 px of the old stack while removing one caption row
and one control row.

### 4.3 240 px — collapsed with non-default settings

```
│ Advanced ⌄                    All matches · Recent…  │
```

The trigger row keeps its 26 px height. The summary is one line with an
ellipsis and a `title` of the full text. The results reflect the active
settings; nothing re-runs when the row is toggled.

### 4.4 Narrow 140 px — expanded, two non-defaults

```
┌ 140 px ────────────┐
│ SEARCH           ‹ │
│ ┌────────────────┐ │
│ │ Search note…   │ │
│ └────────────────┘ │  Aa stays 28 wide; input flexes
│ Advanced 2      ⌃  │  summary clipped; badge 2
│ SEARCH IN          │
│ ┌────────────────┐ │
│ │    Content     │ │
│ ├────────────────┤ │  26 px each
│ │   File name    │ │
│ └────────────────┘ │
│ GROUPING           │
│ ┌────────────────┐ │
│ │  All matches   │ │
│ ├────────────────┤ │
│ │ One per note   │ │
│ └────────────────┘ │
│ SORT               │
│ ┌────────────────┐ │
│ │ Path (A–Z)   ▾ │ │
│ └────────────────┘ │
├────────────────────┤
│ 14 matches in 6 …  │  ellipsis
│ …                  │
└────────────────────┘
```

- The filters grid is one column; each track stays vertical, so both
  labels fit at `--font-scale: 1.3`.
- The settings summary is clipped to the screen-reader-only pattern,
  not `display: none`; the trigger's `aria-describedby` still points at
  it. The count badge is shown.
- The trigger is about `Advanced 2 ⌃`, roughly 95 px at scale 1 and
  under 120 px at 1.3. It fits without wrapping.
- The select truncates a long sort label with an ellipsis; the title and
  the open native list show the full text (existing behaviour).
- No horizontal scroll anywhere.

### 4.5 Phone 390 px drawer

The phone shell makes `#side-panel` full width for the search drawer
(`body.drawer-open[data-drawer-view="search"] #side-panel { width: 100% }`).

Collapsed (the default on a fresh mount):

```
┌ 390 px drawer ────────────────────────────────┐
│ SEARCH                                     ×  │  52
│ ┌─────────────────────────────┐ ┌──────────┐  │
│ │ Search notebooks…           │ │    Aa    │  │  input 44, Aa 44
│ └─────────────────────────────┘ └──────────┘  │
│ Advanced ⌄                                    │  44
├───────────────────────────────────────────────┤
│ 6 notes · 14 matches                          │  30
│ …                                             │
└───────────────────────────────────────────────┘
```

Expanded:

```
│ Advanced ⌃                                    │  44
│ SEARCH IN              GROUPING               │  12 px captions
│ ┌──────────────┐       ┌──────────────┐       │
│ │   Content    │       │ All matches  │       │  44 each
│ ├──────────────┤       ├──────────────┤       │
│ │  File name   │       │ One per note │       │
│ └──────────────┘       └──────────────┘       │
│ SORT                                          │
│ ┌───────────────────────────────────────────┐ │
│ │ Path (A–Z)                              ▾ │ │  44
│ └───────────────────────────────────────────┘ │
```

- Every interactive target is at least `44 × 44px` (`--m-hit`): input,
  `Aa`, the trigger, each segment, the select, the header close, rows.
- The input is `16px` so iOS does not zoom on focus.
- Captions are `12px`; segments `15px`; the select `16px`; the settings
  summary `14px`; the results summary `14px`.
- The drawer opens with the query focused. Tapping `Advanced` moves focus
  to the button, which blurs the query and retracts the keyboard; the
  panel's extra height is offset by the reclaimed keyboard area. The
  implementation may call `input.blur()` when `NB.mobile.isOn()` to make
  that deterministic.
- Starts **collapsed** on every fresh mount. Rotating does not auto-close
  an open panel.

---

## 5. Control specifications

### 5.1 Advanced trigger

| Property | Value |
|---|---|
| Element | `<button type="button" class="search-panel-advanced-toggle">` |
| Visible text | ` Advanced` + chevron; badge only at ≤199 px container |
| Accessible name | `Advanced` (the visible label) |
| State | `aria-expanded="true|false"`, `aria-controls="search-panel-advanced"` |
| Description | `aria-describedby="search-panel-advanced-summary"` only while non-default |
| Target | `26px` min-height desktop; `44px` phone |
| Colour | `--fg-muted`; hover `--fg` on `--accent-soft` |
| Focus | `outline: 2px solid var(--accent); outline-offset: 2px` |
| Motion | chevron rotates 180° over `.12s`; disabled by `prefers-reduced-motion` |

The trigger does **not** change its label to "Hide". Keeping `Advanced`
avoids a width jump and is conventional with `aria-expanded`.

### 5.2 Count badge (narrow only)

| Property | Value |
|---|---|
| Element | `<span class="search-panel-advanced-badge" aria-hidden="true">2</span>` |
| Visibility | `display: none` by default; shown only at `@container (max-width: 199px)` when `.search-panel-advanced-row.has-nondefault` |
| Copy | the number of non-default fragments, 1–3 |
| Look | `16px` min height (20 phone), `999px` radius, `--accent` border, `--accent-soft` fill, `--fg` text, `.66rem` 700 |
| Why aria-hidden | the full list is in the trigger's `aria-describedby`; the count would duplicate it |

The badge is a fallback for the width where the summary cannot be read.
It signals "non-default settings are active" without pretending to name
them; one click reveals the names.

### 5.3 Settings summary

| Property | Value |
|---|---|
| Element | `<span class="search-panel-advanced-summary" id="search-panel-advanced-summary">` |
| Copy | non-default fragments joined by ` · `, or empty |
| Position | right-aligned in the trigger row, `flex: 1 1 auto`, `min-width: 0` |
| Type | `.72rem`, `--fg-muted`, one line, ellipsis |
| Pointer help | `title` = the full text |
| Narrow | visually clipped with the `.search-panel-sr` pattern at ≤199 px; still in the accessibility tree |
| Live region | no; it is a description, not an announcement. Do not add `aria-live` |

### 5.4 Search in

Unchanged semantics, moved inside the Advanced panel.

| Property | Value |
|---|---|
| Caption | `Search in` (uppercase via CSS) |
| Group | `div.search-panel-mode[role=radiogroup][aria-label="Search in"]` |
| Options | `Content` / `File name`, native radios |
| Default | `Content` (`searchTarget` absent or `"content"`) |
| Behaviour | Persists `searchTarget`; re-runs immediately; File name hides Grouping and disables/demotes `Most matches` (existing) |
| File name layout | the filter spans both grid columns and its track becomes horizontal |

### 5.5 Grouping

Unchanged semantics, moved inside the Advanced panel.

| Property | Value |
|---|---|
| Caption | `Grouping` |
| Group | `div.search-panel-mode[role=radiogroup][aria-label="Result grouping"]` |
| Options | `All matches` / `One per note`, native radios |
| Default | `One per note` (`searchUnique: true`) |
| Behaviour | Persists `searchUnique`; re-runs immediately |
| File name | wrapper `.search-panel-filter` and track `.search-panel-mode` both get `.is-hidden`; the fragment is excluded from the settings summary |

### 5.6 Sort

Unchanged semantics, moved inside the Advanced panel.

| Property | Value |
|---|---|
| Caption | `Sort`, a real `<label for="search-panel-sort">` |
| Control | native `<select id="search-panel-sort" class="search-panel-select">` |
| Options | `Path (A–Z)` / `Recently modified` / `Most matches` |
| Default | `path` |
| Behaviour | Persists `searchSort`; re-runs immediately; `Most matches` disabled and demoted in File name mode |
| Layout | full width; spans both grid columns |
| Long labels | ellipsis at 140 px; `title` mirrors the selected label; the open native list shows the full labels |

### 5.7 Case toggle `Aa`

Unchanged markup and styling; stays beside the query.

- Native checkbox, visually hidden but focusable, inside
  `label.search-panel-case`.
- `28 × 32` desktop, `44 × 44` phone.
- Off: `--bg`, `--border`, `--fg-muted`. On: `--accent-soft`,
  `--accent` border, `--fg`. Focus ring on the visible span.
- It is not part of the settings summary because it is never hidden.

### 5.8 Copy and accessible names

| Element | DOM text | Accessible name |
|---|---|---|
| Query | — | `aria-label="Search notebooks"` |
| Case | `Aa` | `Case sensitive` |
| Advanced trigger | `Advanced` | `Advanced` + description |
| Badge | `2` | hidden from AT |
| Search in | caption `Search in` | radiogroup `Search in` |
| Content / File name | same | same |
| Grouping | caption `Grouping` | radiogroup `Result grouping` |
| All matches / One per note | same | same |
| Sort | caption `Sort` | `Sort` |
| Sort options | `Path (A–Z)`, `Recently modified`, `Most matches` | same |

The visible caption `Grouping` is a substring of the accessible name
`Result grouping`, so the label-in-name rule holds; the radiogroup name
stays exact for the DOM tests.

---

## 6. States

| State | Trigger row | Panel | Results summary | List |
|---|---|---|---|---|
| **Collapsed default** | `Advanced ⌄`, no summary | hidden | unchanged | unchanged |
| **Expanded default** | `Advanced ⌃`, no summary | shown, 2-up | unchanged | unchanged |
| **Collapsed, non-default** | summary text (≥200) or badge (≤199) | hidden | reflects the active settings | reflects the active settings |
| **Expanded, non-default** | summary/badge stays | shown | unchanged | unchanged |
| **File name** | summary includes `File name`; grouping excluded | Search in full width horizontal, Grouping hidden, Sort full width | `N notes` | one row per note |
| **Idle / empty query** | keeps its summary/badge | keeps the user's open/closed state | empty, `26px` reserved | empty |
| **Searching…** | unchanged | unchanged | `Searching…` | previous rows kept, dimmed, `aria-busy` |
| **No matches** | unchanged | unchanged | `0 matches` / `0 notes` | empty text + alternate-mode action |
| **Truncated** | unchanged | unchanged | existing cap copy | current rows |
| **Error** | unchanged | unchanged | `Search error: …` wraps, `Retry` below | previous rows kept |

Details:

- **Collapsing never re-runs the search.** `setAdvancedOpen(false)` only
  flips `hidden` and `aria-expanded`. The values of `target`, `unique`
  and `sort` are untouched.
- **Idle:** the settings summary still shows persisted non-defaults,
  because they will apply to the next query. The results summary keeps
  its reserved height so no layout jump occurs when a query is cleared.
- **File name:** switching to File name hides the Grouping filter and
  removes its fragment from the summary. Switching back restores both.
  This is not hidden state: grouping has no effect in File name mode, and
  the value is visible again the moment it has an effect.
- **The no-match alternate action** (`Search content instead` /
  `Search file names instead`) changes the target programmatically. It
  calls `applyTargetUi()`, so the settings summary and the `is-name`
  layout update even while the panel is collapsed. This is the main
  hidden-state path and must not be missed.
- **Config load:** a late `config:changed` updates the controls through
  `applyConfigSync()` → `applyTargetUi()` → `syncAdvancedSummary()`. The
  panel's open/closed state is never touched by a config load.
- **Auth/reload:** the panel returns collapsed; the persisted values
  still drive the summary.

---

## 7. Accessibility

### 7.1 Semantics

| Element | Role / name |
|---|---|
| Advanced trigger | native button, `aria-expanded`, `aria-controls`, optional `aria-describedby` |
| Advanced panel | `<div hidden>`; no role; removed from the accessibility tree and tab order when collapsed |
| Filters | `role="group" aria-label="Search filters"` (unchanged) |
| Search in | `role="radiogroup" aria-label="Search in"` |
| Grouping | `role="radiogroup" aria-label="Result grouping"` |
| Sort | native select with a real `<label for>` |
| Settings summary | plain text, referenced by `aria-describedby`; not a live region |
| Results summary | `.search-panel-summary` keeps `role="status" aria-live="polite" aria-atomic="true"`; error switches to `role="alert"` |
| Result list | `role="listbox" aria-label="Search results"`; rows `role="option"` (unchanged) |

### 7.2 Focus and keyboard

Tab order:

1. Header collapse/close button.
2. Query field.
3. `Aa` checkbox.
4. **Advanced trigger.**
5. When expanded: Search in radiogroup (one tab stop; `←`/`→` within).
6. Grouping radiogroup (skipped in File name mode).
7. Sort select.
8. Result rows (existing roving tab stop).

Rules:

- `Enter` and `Space` toggle the panel natively. No custom key handling
  is needed for the trigger.
- The trigger is a real button, not a `div` with a click handler.
- **Focus stays on the trigger when the panel collapses**, because the
  trigger remains in the DOM and never moves. If a collapse is triggered
  from inside the panel (see below), focus is moved back to the trigger
  explicitly.
- Opening does **not** move focus into the first filter. The user pressed
  Advanced and may only want to look; moving focus would also scroll the
  panel. `Tab` enters the filters.
- When collapsed, the panel carries `hidden`, so no filter, radio or
  select is tabbable or reachable by assistive technology. Do not use
  `opacity: 0` or `visibility: hidden` alone.
- `Escape` while focus is inside the Advanced panel collapses it and
  returns focus to the trigger. `Escape` in the query keeps the existing
  clear-query behaviour. The panel's handler must not swallow the
  query's Escape.
- Every focusable control keeps the existing
  `outline: 2px solid var(--accent); outline-offset: 2px` (segments use
  offset 1 inside the track).

### 7.3 Contrast

All pairs are existing tokens; no new colour is introduced. The new
surfaces are the trigger row and the badge.

| Pair | Dark | Light |
|---|---|---|
| `--fg-muted` on `--bg-panel` (trigger, summary, captions) | 4.74:1 | 5.56:1 |
| `--fg` on `--bg-panel` (expanded trigger, segment labels) | 11.3:1 | 13.5:1 |
| `--fg` on `--bg-elev` (selected segment) | 11.2:1 | 13.3:1 |
| `--accent` on `--bg-panel` (focus rings, rail, badge border) | 6.0:1 | 5.34:1 |
| `--fg` on `--accent-soft` over `--bg-panel` (badge) | 9.1:1 | 12.4:1 |
| `--fg` on the `Aa` on-state fill | 9.1:1 | 12.4:1 |
| `--danger` on `--bg-panel` (error summary) | 5.64:1 | 5.07:1 |

The selected segment still uses surface + weight + accent rail, not
colour alone. The `Aa` on-state uses fill + border, not colour alone.

### 7.4 Touch, motion, hover

- Desktop trigger target `26px` tall; phone `44px`. All expanded controls
  are `44px` on phone.
- No control is hover-only. Hover adds a fill; the chevron and
  `aria-expanded` carry the state without hover.
- The only new transition is the chevron rotation `.12s`. Add it to the
  existing `prefers-reduced-motion` block.
- The panel opens/closes without a height animation, so there is no
  motion to reduce beyond the chevron.

### 7.5 Screen-reader narrative

Collapsed with a non-default setting, focusing the trigger announces:

> Advanced, button, collapsed. All matches · Recently modified.

Expanding announces `expanded` and the controls follow in tab order. The
settings summary is not a live region, so changing a select or radio
does not produce a second announcement; the control itself announces its
new value.

---

## 8. DOM and CSS handoff

### 8.1 Final DOM

Collapsed with two non-default settings (badge text is present in the DOM
at every width; CSS decides whether it is visible):

```html
<div class="search-panel-controls">
  <div class="search-panel-input-row">
    <input type="search" class="search-panel-input"
           placeholder="Search notebooks…" aria-label="Search notebooks">
    <label class="search-panel-case" title="Case sensitive">
      <input type="checkbox" aria-label="Case sensitive">
      <span>Aa</span>
    </label>
  </div>

  <div class="search-panel-advanced-row has-nondefault">
    <button type="button" class="search-panel-advanced-toggle"
            aria-expanded="false"
            aria-controls="search-panel-advanced"
            aria-describedby="search-panel-advanced-summary"
            title="Search options: All matches · Recently modified">
      <span class="search-panel-advanced-label">Advanced</span>
      <span class="search-panel-advanced-badge" aria-hidden="true">2</span>
      <span class="search-panel-advanced-chevron" aria-hidden="true"></span>
    </button>
    <span class="search-panel-advanced-summary"
          id="search-panel-advanced-summary"
          title="All matches · Recently modified">All matches · Recently modified</span>
  </div>

  <div class="search-panel-advanced" id="search-panel-advanced" hidden>
    <div class="search-panel-filters" role="group" aria-label="Search filters">
      <div class="search-panel-filter">
        <span class="search-panel-filter-label">Search in</span>
        <div class="search-panel-mode" role="radiogroup" aria-label="Search in">
          <label class="search-panel-mode-opt">
            <input type="radio" name="search-panel-target" value="content" checked>
            <span>Content</span>
          </label>
          <label class="search-panel-mode-opt">
            <input type="radio" name="search-panel-target" value="name">
            <span>File name</span>
          </label>
        </div>
      </div>

      <div class="search-panel-filter" id="search-group-filter">
        <span class="search-panel-filter-label">Grouping</span>
        <div class="search-panel-mode" role="radiogroup"
             aria-label="Result grouping">
          <label class="search-panel-mode-opt">
            <input type="radio" name="search-panel-mode" value="all" checked>
            <span>All matches</span>
          </label>
          <label class="search-panel-mode-opt">
            <input type="radio" name="search-panel-mode" value="unique">
            <span>One per note</span>
          </label>
        </div>
      </div>

      <div class="search-panel-filter search-panel-filter--sort">
        <label class="search-panel-filter-label" for="search-panel-sort">Sort</label>
        <select id="search-panel-sort" class="search-panel-select"
                title="Recently modified">
          <option value="path">Path (A–Z)</option>
          <option value="mtime" selected>Recently modified</option>
          <option value="count">Most matches</option>
        </select>
      </div>
    </div>
  </div>
</div>
```

Expanded is the same DOM with `hidden` removed and
`aria-expanded="true"`. Default values produce an empty
`.search-panel-advanced-summary`, an empty badge, no `has-nondefault`,
and no `aria-describedby` / trigger `title`.

File name variant:

- `.search-panel-filters` also has `.is-name`.
- `#search-group-filter` and its inner `.search-panel-mode` both carry
  `.is-hidden`; `option[value="count"]` is `disabled`; a stored count sort
  is demoted to path.
- The summary contains `File name` (plus any non-default sort) and never
  `All matches` / `One per note`.

### 8.2 Scoped tokens

Add these four to the existing `#search-view` block
(`static/css/style.css:3969`). Everything else stays.

```css
#search-view {
  /* existing tokens ... */
  --search-adv-h: 26px;      /* trigger row height, desktop */
  --search-adv-font: .78rem; /* trigger label */
  --search-adv-meta: .72rem; /* settings summary */
  --search-badge-h: 16px;    /* narrow count badge */
}
```

Phone overrides in the existing phone block: `--search-adv-h: var(--m-hit)`,
`--search-adv-font: 15px`, `--search-adv-meta: 14px`,
`--search-badge-h: 20px`.

### 8.3 Class inventory

**New**

| Class | Purpose |
|---|---|
| `.search-panel-advanced-row` | The trigger + summary line; owns `.has-nondefault` |
| `.search-panel-advanced-toggle` | The real `<button>`; owns `aria-expanded` / `aria-controls` |
| `.search-panel-advanced-label` | The visible `Advanced` text |
| `.search-panel-advanced-chevron` | CSS chevron; rotates 180° when open |
| `.search-panel-advanced-badge` | Count badge, shown only at ≤199 px |
| `.search-panel-advanced-summary` | Non-default settings text / clipped a11y description at narrow widths |
| `.search-panel-advanced` | The collapsible wrapper; `hidden` when closed |
| `.search-panel-filters.is-name` | File-name layout: single visible filter spans both columns |
| `.search-panel-advanced-row.has-nondefault` | Activates the badge at narrow widths |

**Changed**

| Class | Change |
|---|---|
| `.search-panel-filters` | flex column → two-column grid (`1` column below 228 px) |
| `.search-panel-mode` | base `grid-template-columns: 1fr` (vertical); the File-name layout overrides to horizontal, and the ≤227 px query resets it to vertical |
| `.search-panel-mode-opt span` | inside the filters, `.76rem` and 2 px side padding; phone 15 px / 6 px |
| `.search-panel-controls` | unchanged; now also contains the trigger row and the Advanced wrapper |

**Reused unchanged**

`.panel-header`, `.panel-title`, `.collapse-btn`, `.search-panel-input-row`,
`.search-panel-input`, `.search-panel-case`, `.search-panel-filter`,
`.search-panel-filter-label`, `.search-panel-filter--sort`,
`.search-panel-mode-opt`, `.search-panel-select`, `.search-panel-summary`,
`.search-panel-summary-text`, `.search-panel-note`, `.search-panel-list`,
`.search-panel-hit*`, `.sp-file`, `.sp-dir`, `.sp-count`, `.sp-meta`,
`.search-panel-path`, `.search-panel-empty`, `.search-panel-state`,
`.search-panel-retry`, `.search-panel-sr`, `.is-hidden`.

**Removed**

Nothing. The old classes are all retained; only their layout context
changes.

### 8.4 CSS additions and changes

Add the trigger block after the `.search-panel-case` rules
(`static/css/style.css:4021`–`:4067`):

```css
/* ------------------------------------------------------------------ */
/* Search view — Advanced disclosure (add after .search-panel-case)    */
/* ------------------------------------------------------------------ */
.search-panel-advanced-row {
  display: flex;
  align-items: center;
  gap: var(--search-gap);
  min-height: var(--search-adv-h);
  min-width: 0;
}

.search-panel-advanced-toggle {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: var(--search-space-2);
  min-height: var(--search-adv-h);
  margin-left: calc(-1 * var(--search-space-2));
  padding: 0 var(--search-space-2);
  background: none;
  border: 0;
  border-radius: var(--search-radius-sm);
  color: var(--fg-muted);
  font: inherit;
  font-size: var(--search-adv-font);
  font-weight: 600;
  cursor: pointer;
}
.search-panel-advanced-toggle:hover {
  color: var(--fg);
  background: var(--accent-soft);
}
.search-panel-advanced-toggle[aria-expanded="true"] { color: var(--fg); }
.search-panel-advanced-toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.search-panel-advanced-chevron {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: translateY(-1px) rotate(45deg);
  transition: transform .12s ease;
}
.search-panel-advanced-toggle[aria-expanded="true"]
  .search-panel-advanced-chevron {
  transform: translateY(2px) rotate(-135deg);
}

.search-panel-advanced-badge {
  display: none;
  align-items: center;
  justify-content: center;
  min-width: var(--search-badge-h);
  height: var(--search-badge-h);
  padding: 0 4px;
  border: 1px solid var(--accent);
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--fg);
  font-size: .66rem;
  font-weight: 700;
  line-height: 1;
}
.search-panel-advanced-badge:empty { display: none; }

.search-panel-advanced-summary {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-muted);
  font-size: var(--search-adv-meta);
  text-align: right;
}
.search-panel-advanced-summary:empty { display: none; }

.search-panel-advanced { display: block; min-width: 0; }
.search-panel-advanced[hidden] { display: none; }
```

Replace the `.search-panel-filters` flex block
(`static/css/style.css:4069`–`:4073`) with:

```css
.search-panel-filters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--search-gap);
  min-width: 0;
}
.search-panel-filter--sort { grid-column: 1 / -1; }

/* Two-up columns are narrow: stack each track's two options. */
.search-panel-filters .search-panel-mode { grid-template-columns: 1fr; }

/* File-name mode: only Search in is visible; give it the full row and
 * a horizontal track so the panel does not leave an empty grid cell. */
.search-panel-filters.is-name
  .search-panel-filter:not(.search-panel-filter--sort) {
  grid-column: 1 / -1;
}
.search-panel-filters.is-name
  .search-panel-filter:not(.search-panel-filter--sort) .search-panel-mode {
  grid-template-columns: 1fr 1fr;
}
```

Change `.search-panel-mode` (`static/css/style.css:4092`) from
`grid-template-columns: 1fr 1fr;` to `grid-template-columns: 1fr;`.
Keep the existing `.search-panel-mode.is-hidden { display: none; }`.

After the `.search-panel-mode-opt span` rule (`:4111`), add the narrow
grid type:

```css
/* The two-up grid is ~106 px per column; this keeps the longest label
 * whole at --font-scale: 1.3. The phone block restores 15 px / 6 px. */
.search-panel-filters .search-panel-mode-opt span {
  padding: 0 2px;
  font-size: .76rem;
}
```

### 8.5 Container queries

Replace the existing `@container (max-width: 199px)` block
(`static/css/style.css:4295`–`:4300`) with two queries:

```css
/* Below this the two-up filter grid cannot hold a full option label. */
@container (max-width: 227px) {
  #search-view .search-panel-filters { grid-template-columns: 1fr; }
  #search-view .search-panel-filters.is-name
    .search-panel-filter:not(.search-panel-filter--sort) .search-panel-mode {
    grid-template-columns: 1fr;
  }
}

/* The summary cannot be read here; clip it for AT and show the badge. */
@container (max-width: 199px) {
  #search-view .search-panel-select {
    font-size: .74rem;
    padding-right: 20px;
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
```

Do not put the old `#search-view .search-panel-mode { grid-template-columns: 1fr; }`
back into the 199 query; the base is already one column.

### 8.6 Phone overrides

Inside the existing phone media query
(`static/css/style.css:6486`), extend `#search-view` with the four new
tokens and add the trigger rules. Keep the existing search rules; replace
the phone `.search-panel-mode-opt span` font-size rule with the scoped
version so it wins over the `.search-panel-filters …` rule:

```css
#search-view {
  --search-mode-h: 44px;
  --search-control-h: var(--m-hit);
  --search-hit-min-h: 52px;
  --search-pad-x: var(--search-space-4);
  --search-gap: var(--search-space-3);
  --search-label-size: 12px;
  --search-adv-h: var(--m-hit);
  --search-adv-font: 15px;
  --search-adv-meta: 14px;
  --search-badge-h: 20px;
}
.search-panel-advanced-row { min-height: var(--search-adv-h); }
.search-panel-advanced-toggle {
  min-height: var(--search-adv-h);
  padding: 0 var(--search-space-2);
  margin-left: calc(-1 * var(--search-space-2));
  font-size: var(--search-adv-font);
}
.search-panel-advanced-chevron { width: 7px; height: 7px; }
.search-panel-advanced-summary { font-size: var(--search-adv-meta); }
#search-view .search-panel-mode-opt span {
  padding: 0 6px;
  font-size: 15px;
}
```

The phone grid stays two columns (the base) with vertical tracks; do not
add a one-column override. The summary stays visible at 390 px; the
badge stays hidden because the 199 query does not apply.

### 8.7 Existing DOM-test contract

Preserved exactly:

- `#search-panel-sort` stays the select's id.
- `aria-label="Search in"` and `aria-label="Result grouping"` stay on the
  two radiogroups.
- `.search-panel-case` still contains a native checkbox.
- The grouping **track** (`.search-panel-mode[aria-label="Result grouping"]`)
  still gets `.is-hidden` in File name mode, in addition to the wrapper
  `.search-panel-filter#search-group-filter`. Toggle both.
- `.search-panel-summary` stays the results-summary wrapper;
  `.search-panel-summary-text` stays the text span;
  `role="status" aria-live="polite" aria-atomic="true"` and the error
  `role="alert"` stay on the wrapper.
- `.sp-file`, `.sp-dir`, `.sp-count`, `.sp-meta`, `.search-panel-path`
  and `.search-panel-hit-snippet` keep their names and semantics.
- `.search-panel-controls` still contains the input and exactly three
  `.search-panel-filter` elements, each with a
  `.search-panel-filter-label`; the filters are now descendants of
  `.search-panel-advanced` inside the controls zone, so
  `querySelectorAll` still finds them while the panel is `hidden`.

The panel starts collapsed. Existing DOM tests that dispatch `change`
events on the hidden radios and select still work, because the elements
remain in the DOM and keep their listeners. Do not add `display: none` to
individual filters as a substitute for `hidden` on the wrapper; use the
wrapper's `hidden` attribute and the `.is-hidden` class only for the
File-name Grouping row.

### 8.8 Behaviour map for `activity.js`

Add near `syncControls` / `applyTargetUi` (`static/js/activity.js:576`):

```js
let advancedOpen = false;

function setAdvancedOpen(open) {
  advancedOpen = !!open;
  advanced.hidden = !advancedOpen;
  advancedBtn.setAttribute("aria-expanded", advancedOpen ? "true" : "false");
}

function advancedSummaryText() {
  const parts = [];
  if (target === "name") parts.push("File name");
  if (target !== "name" && !unique) parts.push("All matches");
  if (sort !== "path") {
    const opt = sortSelect.options[sortSelect.selectedIndex];
    if (opt) parts.push(opt.textContent);
  }
  return parts.join(" · ");
}

function syncAdvancedSummary() {
  const text = advancedSummaryText();
  const active = text !== "";
  let count = 0;
  if (target === "name") count += 1;
  if (target !== "name" && !unique) count += 1;
  if (sort !== "path") count += 1;

  advancedSummary.textContent = text;
  advancedSummary.title = text;
  advancedBadge.textContent = active ? String(count) : "";
  advancedRow.classList.toggle("has-nondefault", active);
  if (active) {
    advancedBtn.setAttribute("aria-describedby", advancedSummary.id);
    advancedBtn.title = "Search options: " + text;
  } else {
    advancedBtn.removeAttribute("aria-describedby");
    advancedBtn.removeAttribute("title");
  }
}
```

Wire it:

- `advancedBtn.addEventListener("click", () => setAdvancedOpen(!advancedOpen));`
- `advanced.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setAdvancedOpen(false); advancedBtn.focus(); } });`
- Call `syncAdvancedSummary()` at the end of `applyTargetUi()`, after
  `syncSortTitle()`.
- Call it in the `mode` change handler after `unique = uniqueRadio.checked`.
- Call it in the `sortSelect` change handler after `syncSortTitle()`.
- `applyConfigSync()` and the no-match alternate action already call
  `applyTargetUi()`, so they inherit the update.
- Add `filters.classList.toggle("is-name", isName);` in `applyTargetUi()`.

Do not call `setAdvancedOpen` from `applyTargetUi`, `applyConfigSync` or
`runSearch`; the disclosure state is independent of the settings.

Do not change the debounce, request options, latest-response-wins token,
row rendering, list keyboard handlers, persistence calls, or the
`setTimeout(input.focus)`.

On phone, opening the disclosure may explicitly blur the query when
`NB.mobile && NB.mobile.isOn()` so the keyboard retracts; that is the only
mobile-specific behaviour.

---

## 9. What changes, file by file

### 9.1 `static/js/activity.js`

- `mountSearch()` (`:415`): build the `.search-panel-advanced-row` and
  `.search-panel-advanced` wrapper; move the existing `.search-panel-filters`
  inside the wrapper; append the row and wrapper after the input row.
  Reference the control construction at `:447`–`:545`.
- Add `advancedOpen`, `setAdvancedOpen`, `advancedSummaryText`,
  `syncAdvancedSummary` near `syncControls` (`:597`).
- `applyTargetUi()` (`:576`): add the `.is-name` toggle and the
  `syncAdvancedSummary()` call.
- Event handlers (`:1068`–`:1115`): add the trigger click, the panel
  Escape handler, and the two `syncAdvancedSummary()` calls.
- Presentational only; no API, persistence or search-option changes.

### 9.2 `static/css/style.css`

- `#search-view` tokens (`:3969`): add the four new tokens.
- Add the Advanced row/toggle/badge/summary/panel rules after
  `.search-panel-case` (`:4030`–`:4067`).
- Replace `.search-panel-filters` (`:4069`) with the grid; add the
  `is-name` rules.
- Change `.search-panel-mode` (`:4092`) to one column.
- Add the `.search-panel-filters .search-panel-mode-opt span` type rule
  after `:4111`.
- Replace the `@container (max-width: 199px)` block (`:4295`) with the
  227 / 199 pair.
- Extend the phone search block (`:6486`) with the trigger tokens/rules
  and the scoped segment size.
- Add `.search-panel-advanced-chevron` to the existing
  `prefers-reduced-motion` block (`:4302`).

### 9.3 Not changed

- `templates/index.html`: the host is built by JS.
- `static/js/api.js`, `app.py`: no request or endpoint change.
- Persistence keys and request parameters.
- The top-bar search overlay.
- Result rows and their states.
- `tests/`: the existing selectors remain valid. Run the suite only
  after implementation.

---

## 10. Acceptance checklist

- [ ] At 240 px collapsed, the controls zone is about 80 px tall and the
      results begin about 141 px from the panel top; no filter rows are
      visible.
- [ ] The collapsed row shows the query, `Aa`, the `Advanced` trigger,
      and — only when a non-default option is active — a one-line settings
      summary with an ellipsis.
- [ ] Toggling `Advanced` never changes `searchTarget` / `searchUnique` /
      `searchSort`, never re-runs the search, and never moves the result
      set.
- [ ] Expanded at 240 px, the two radiogroups sit in a two-column grid
      with vertical tracks and Sort spans the row; no horizontal scroll,
      no truncated option labels at `--font-scale` 0.9 / 1.0 / 1.15 / 1.3.
- [ ] File name mode hides the Grouping filter (wrapper **and** track
      `.is-hidden`), disables and demotes `Most matches`, makes Search in
      span both columns with a horizontal track, and excludes grouping
      from the settings summary.
- [ ] At 140 px the filters are one column, tracks are vertical, the
      settings summary is clipped for AT, and the count badge is visible;
      the trigger still fits without wrapping.
- [ ] On phone the panel starts collapsed, every target is at least
      44 px, the input is 16 px, and the expanded grid is two columns
      with vertical 44 px tracks.
- [ ] `Enter`/`Space` toggle the trigger; focus stays on it when
      collapsing; `Tab` order is trigger → filters → rows; hidden
      controls are not tabbable; `Escape` from inside the panel collapses
      it and returns focus.
- [ ] The disclosure state is session-only, survives view switches,
      resets on reload, and is never written to `config.json`.
- [ ] The collapsed summary shows persisted non-defaults after a reload
      and after the no-match alternate-mode action.
- [ ] The new trigger, badge and summary meet contrast in both themes; no
      new colour, font or dependency appears.
- [ ] `#search-panel-sort`, both radiogroup `aria-label`s, the
      `.search-panel-case` checkbox, the `.is-hidden` handling and the
      summary wrapper roles all still resolve in the DOM suite.
