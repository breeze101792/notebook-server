# Search panel controls — labelled filter stack

Design handoff for the control area above the results in the **Search
side-panel view** (`#search-view`, built by `mountSearch()` in
`static/js/activity.js`, styled in `static/css/style.css`).

Reference mockup: `docs/design/search-panel-controls.html`.

Status: design only. No source files were changed. `web-engineer` implements
the markup change in `activity.js` and the CSS change in `style.css`.

Companion: `docs/design/search-panel.md` (rows, states, result copy). **This
document supersedes its §3 anatomy and §4 controls.** The result-row design,
state copy, keyboard model, and persistence behaviour in that doc still hold;
where the two disagree on the control area, this document wins.

**Normative source.** §4 (anatomy), §5 (control specs), §6 (states),
§7 (accessibility), §8 (DOM/CSS handoff) and §9 (implementation map) are the
single source of truth. The mockup illustrates them; where the two differ,
this document wins.

---

## 1. Design intent

**One line:** the query is the loudest row; every filter gets its own labelled
row instead of competing for one.

The complaint is precise: the query row is fine, but the option controls are
one `flex-wrap` row of two segmented groups plus a `Sort` label and select.
At 240 px that needs roughly 400 px, so it wraps — sometimes into two lines,
sometimes three, depending on the panel width, the font scale setting, and the
length of the selected sort label. The result is a ragged block that changes
shape as the user drags the panel.

This redesign **removes horizontal competition entirely**. Each decision owns
one full-width row under a small caption:

```
query
SEARCH IN    [ Content | File name ]
GROUPING     [ All matches | One per note ]
SORT         [ Path (A–Z)            ▾ ]
```

Nothing wraps. The only responsive change is the segmented track turning from
two columns into one at very narrow panel widths.

### Why this pattern (and not the alternatives)

The panel is tall and narrow, so horizontal space is the scarce resource and
vertical space is cheap. A stack spends the cheap resource (about 157 px of
filter height at default) to buy a stable, scannable hierarchy at every width.
At 240 px each segmented option gets a full half-row (about 105 px), so
"One per note" never truncates even at the largest font scale. At 140 px the
same row simply stacks its two options; the labels and order do not move.

- **Rejected: a "Refine" disclosure for Sort.** It saves about 46 px, but the
  active sort is information the user reads while scanning results. A
  disclosure would hide the current order and cost two interactions to check
  or change it. All three controls are cheap, one-line decisions; none is
  buried.
- **Rejected: a popover or sheet.** A popover is clipped by the 240 px panel
  and, on the phone, would need a new layer in the drawer's history stack.
- **Rejected: icon-only controls.** No control may be hover-only or depend on
  an unlabelled glyph. The text captions are the hierarchy.

### What stays

- The header (`Search` + collapse button), the query field, the `Aa` toggle,
  the 250 ms debounce, the result rows, and every keyboard behaviour.
- The persisted keys and request parameters: `searchTarget`, `searchUnique`,
  `searchSort`, `searchCaseSensitive`, and `unique` / `name` / `order` /
  `desc` / `case`.
- All labels: `Content`, `File name`, `All matches`, `One per note`,
  `Path (A–Z)`, `Recently modified`, `Most matches`.
- The accessible names the DOM tests already assert: `Search in` and
  `Result grouping` on the two radiogroups (see §8.7).

### Non-goals

No new filters, no search history, no saved searches, no regex control, no
change to the result rows, no change to the backend. This is the existing
control set, rearranged and restyled.

---

## 2. Today's surface (why it breaks)

`mountSearch()` builds `.search-panel-options-row` as a wrapping flex row:

```
.search-panel-options-row         display:flex; flex-wrap:wrap; gap:6px
  .search-panel-mode              flex: 1 1 140px   → Content | File name
  .search-panel-mode              flex: 1 1 140px   → All matches | One per note
  .search-panel-sort              flex: 0 0 auto; margin-left:auto
    "Sort" label + select          max-width: 132px
```

At 240 px the panel's content box is about 220 px. Two 140 px tracks plus the
sort group cannot fit, so the row wraps. The first track and the sort group
share line one and the second track drops to line two, or the sort drops
alone — the exact arrangement depends on the font scale and the selected sort
label. At 140 px the two tracks go full width and the container query then
makes each track single-column and forces the sort onto another line, so the
control block is four to six rows tall with inconsistent gaps.

The failure is structural: three unrelated controls were placed on one axis
and told to wrap. Restyling the same row cannot fix it.

---

## 3. The structure

One controls zone, then a summary line, then the list:

```
#search-view
├ .panel-header                    Search                         ‹
├ .search-panel-controls           (one padded, hairline-bottomed zone)
│  ├ .search-panel-input-row       [ Search notebooks… ] [Aa]
│  └ .search-panel-filters
│     ├ .search-panel-filter       SEARCH IN
│     │  └ .search-panel-mode      [ Content | File name ]
│     ├ .search-panel-filter       GROUPING
│     │  └ .search-panel-mode      [ All matches | One per note ]
│     └ .search-panel-filter--sort SORT
│        └ select                  [ Path (A–Z)            ▾ ]
├ .search-panel-summary            6 notes · 14 matches
├ .search-panel-note               (one-per-note only)
└ .search-panel-list               (the only scroll container)
```

The caption sits **above** its control, always. This is deliberate: at 240 px
an inline caption would steal 60–70 px from the control and force the segment
labels to truncate at large font scales; above the control the caption uses no
horizontal space and the same structure survives down to 140 px.

The controls zone ends with a 1 px `--border` hairline, matching the header
rule. The summary, note and list sit on the panel surface below it.

---

## 4. Anatomy by width

### 4.1 Default — 240 px (Content, One per note)

```
┌ 240 px ──────────────────────────────────┐
│ SEARCH                                ‹  │  header 34
│ ┌───────────────────────────────┐ ┌──┐   │
│ │ Search notebooks…             │ │Aa│   │  input 32, Aa 28×26
│ └───────────────────────────────┘ └──┘   │
│                                          │
│ SEARCH IN                                │  caption 9.2/1.2
│ ┌──────────────────┬───────────────────┐ │
│ │     Content      │     File name     │ │  track 32, segment 26
│ └──────────────────┴───────────────────┘ │
│ GROUPING                                 │
│ ┌──────────────────┬───────────────────┐ │
│ │   All matches    │   One per note    │ │  (selected = One per note)
│ └──────────────────┴───────────────────┘ │
│ SORT                                     │
│ ┌──────────────────────────────────────┐ │
│ │ Path (A–Z)                         ▾ │ │  select 32
│ └──────────────────────────────────────┘ │
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
| Controls zone padding | `8px 10px 6px` (top/right-left/bottom) |
| Gap, input row → filters | `8px` |
| Gap between filter rows | `8px` |
| Caption → control gap | `4px` |
| Caption size | `.66rem`, 600, uppercase, `.07em` tracking, `--fg-muted` |
| Input | `32px` tall, `.88rem`, radius `6`, `--bg`, 1 px `--border` |
| `Aa` target | `28 × 32`; visual `28 × 26`, radius `4`, `.74rem` 700 |
| Segmented track | full width (`218px` content), `32px` tall, 2 px padding, radius `6` |
| Segment | `26px` min-height, `.78rem`, radius `4` |
| Select | full width (`218px`), `32px` tall, `.78rem`, `padding-right: 24px` |
| Summary | `26px` min-height, `.78rem`, one line with ellipsis |
| Note | `.72rem`, wraps, `line-height: 1.4` |
| List row | `32px` min-height (unchanged) |

The control zone is about 212 px tall before the summary. That is the price of
the stack, and it is bounded: the filters never grow past three rows on
desktop. The results list keeps the rest of the panel and remains the only
scroller.

### 4.2 Narrow — 140 px (the resize floor)

At `@container (max-width: 199px)` the **only** change is the segmented track:

```
┌ 140 px ────────────┐
│ SEARCH           ‹ │
│ ┌────────────────┐ │
│ │ Search note…   │ │  Aa stays 28 wide; input flexes
│ └────────────────┘ │
│ SEARCH IN          │
│ ┌────────────────┐ │
│ │    Content     │ │
│ ├────────────────┤ │  26 px each, 2 px gap
│ │   File name    │ │
│ └────────────────┘ │
│ GROUPING           │
│ ┌────────────────┐ │
│ │  All matches   │ │
│ ├────────────────┤ │
│ │  One per note  │ │
│ └────────────────┘ │
│ SORT               │
│ ┌────────────────┐ │
│ │ Path (A–Z)   ▾ │ │
│ └────────────────┘ │
├────────────────────┤
│ 14 matches in 6 …  │  ellipsis
│ ┌────────────────┐ │
│ │ parser-notes.md│ │
│ │ (fw)   line 12 │ │
│ │ The fix landed…│ │
│ └────────────────┘ │
└────────────────────┘
```

- Captions do not move; they stay above their controls.
- The track becomes one column: each option is full width (`118px` content),
  so both labels fit at `--font-scale: 1.3`.
- The track grows to about `60px` tall; the panel is tall, so this is fine.
- The input keeps its `Aa` sibling; only the input shrinks. There is **no
  horizontal scroll anywhere**.
- The summary truncates with an ellipsis. Screen readers still read the full
  text (see §7.3).
- The note wraps to two lines; it is a hint, not a control.
- The select is full width. A long sort label (`Recently modified`) is clipped
  by the control with an ellipsis; the open native list always shows the full
  text, and the select carries `title="Recently modified"` for pointer hover.
  See §5.5.

### 4.3 Phone — 390 px drawer

The phone shell makes `#side-panel` full width for the search drawer
(`body.drawer-open[data-drawer-view="search"] #side-panel { width: 100% }`).
The structure is identical; the sizes are the phone sizes:

```
┌ 390 px drawer ────────────────────────────────┐
│ SEARCH                                     ×  │  52
│ ┌─────────────────────────────┐ ┌──────────┐  │
│ │ Search notebooks…           │ │    Aa    │  │  input 44, Aa 44×44
│ └─────────────────────────────┘ └──────────┘  │
│ SEARCH IN                                     │  12 px caption
│ ┌──────────────────────┬────────────────────┐ │
│ │       Content        │      File name     │ │  track 50, segment 44
│ └──────────────────────┴────────────────────┘ │
│ GROUPING                                      │
│ ┌──────────────────────┬────────────────────┐ │
│ │     All matches      │    One per note    │ │
│ └──────────────────────┴────────────────────┘ │
│ SORT                                          │
│ ┌───────────────────────────────────────────┐ │
│ │ Path (A–Z)                              ▾ │ │  44
│ └───────────────────────────────────────────┘ │
├───────────────────────────────────────────────┤
│ 6 notes · 14 matches                          │  14 px
│ Click a row to open its first match.          │  13 px
│ ┌───────────────────────────────────────────┐ │
│ │ parser-notes.md (projects/firmware)        │ │
│ │                              3 matches    │ │
│ │ The fix landed before the demo.           │ │
│ └───────────────────────────────────────────┘ │  min 52
│ …                                             │
└───────────────────────────────────────────────┘
```

- Every interactive target is at least `44 × 44` (`--m-hit`): input, `Aa`,
  each segment, the select, the header close button, and result rows.
- The input font is `16px` so iOS does not zoom on focus.
- Captions are `12px`; segments `15px`; the select `16px`; summary `14px`.
- The drawer focus behaviour is unchanged: `mobile.js` focuses the input
  after opening, so the keyboard rises for the query.

---

## 5. Control specifications

All five controls are always visible in Content mode. No control is behind a
menu, a popover, or hover.

| # | Control | Markup | Visible text | Default | Behaviour |
|---|---|---|---|---|---|
| 1 | Query | `input.search-panel-input[type=search]` | placeholder `Search notebooks…` | empty | 250 ms debounce (existing). `Enter` runs and opens the active row. `Escape` clears a non-empty query (existing). |
| 2 | Case sensitive | `label.search-panel-case` > hidden `input[type=checkbox]` + `span` | `Aa` | off | Re-runs immediately (existing). |
| 3 | Search in | caption + `div.search-panel-mode[role=radiogroup]` with two native radios | caption `Search in`; options `Content`, `File name` | `Content` | Persists `searchTarget`; re-runs immediately; in `File name` mode hides the Grouping row and disables the count sort (existing). |
| 4 | Grouping | caption + radiogroup | caption `Grouping`; options `All matches`, `One per note` | `One per note` (`searchUnique: true`) | Persists `searchUnique`; re-runs immediately; hidden in `File name` mode. |
| 5 | Sort | caption `<label for>` + native `select` | caption `Sort`; options `Path (A–Z)`, `Recently modified`, `Most matches` | `Path (A–Z)` | Persists `searchSort`; re-runs immediately; `Most matches` disabled in `File name` mode. |

### 5.1 Exact labels and accessible names

| Element | DOM text | Accessible name |
|---|---|---|
| Query | — | `aria-label="Search notebooks"` |
| Case checkbox | `Aa` | `aria-label="Case sensitive"`; label `title="Case sensitive"` |
| Search in group | caption `Search in` | `aria-label="Search in"` (radiogroup) |
| Content radio | `Content` | `Content` |
| File name radio | `File name` | `File name` |
| Grouping group | caption `Grouping` | `aria-label="Result grouping"` (radiogroup) |
| All matches radio | `All matches` | `All matches` |
| One per note radio | `One per note` | `One per note` |
| Sort | caption `Sort` | `Sort` via `<label for="search-panel-sort">` |
| Sort option 1 | `Path (A–Z)` | — |
| Sort option 2 | `Recently modified` | — |
| Sort option 3 | `Most matches` | — |

The Grouping **caption** is `Grouping`; the radiogroup keeps the existing
accessible name `Result grouping` because the DOM test suite selects the group
by that name and it is the more explicit wording for a screen reader. The
visible caption is a substring of the accessible name ("grouping"), so the
label-in-name rule still holds, and the visible option labels match their
accessible names exactly.

### 5.2 Segmented control

```
.search-panel-mode   grid, 2 columns, 2px gap, 2px padding,
                     1px --border, radius 6, background --bg, width 100%
```

| State | Treatment |
|---|---|
| Unselected | transparent segment, `--fg-muted` text, `.78rem` |
| Hover | `--accent-soft` fill, `--fg` text (additive only; never required) |
| Selected | `--bg-elev` fill, `--fg` text, `font-weight: 600`, 2 px inset `--accent` bottom rail |
| Focus-visible | 2 px `--accent` outline, offset 1 px on the segment span |
| Disabled | not applicable — the segmented options are never disabled |

Selected state uses surface, weight and rail, not colour alone.

At `≤199px` the track switches to `grid-template-columns: 1fr`.

### 5.3 Case toggle `Aa`

The native checkbox is visually hidden but remains focusable and in the tab
order. The visible control is the sibling `span`; the whole `label` is the
28 × 32 hit area (44 × 44 on phone).

| State | Treatment |
|---|---|
| Off | `--bg` fill, 1 px `--border`, `--fg-muted` text, `.74rem` 700 |
| Hover | `--fg` text, `--accent` border |
| On (`:checked`) | `--accent-soft` fill, `--accent` border, `--fg` text |
| Focus-visible | 2 px `--accent` outline, offset 2 px on the span |

The checked text stays `--fg` rather than `--accent`: accent on the soft accent
fill is about 4.4:1 in the dark theme, just under AA. The accent border and
soft fill carry the "on" state, and the checkbox semantics carry it for
assistive technology.

### 5.4 Sort select

A native `<select>`. No custom dropdown: the native control brings keyboard
support, type-ahead, and the platform list for free, and it matches the
Settings modal's selects.

- Full width; `32px` tall (`44px` on phone); radius 6; 1 px `--border`;
  `--bg` fill; `padding: 0 24px 0 8px` so the native chevron never overlaps
  text.
- Hover: `--accent` border. Focus-visible: 2 px `--accent` outline, offset 2.
- The active value is shown by the select itself. There is no extra badge or
  dot; the value is the state.
- `Most matches` (`option[value="count"]`) carries `disabled` in File name
  mode. If it was the active sort, the code demotes to `Path (A–Z)` and
  persists the demotion (existing).

### 5.5 Long sort labels

`Recently modified` is the longest label.

- **240 px:** the full label fits (about 78 px at `.78rem`, `218px` available).
- **140 px:** the closed control truncates with an ellipsis under Blink and
  WebKit (`text-overflow: ellipsis` on the select). The open native list always
  shows the complete labels. The select's `title` mirrors the selected option
  so a pointer user can reveal the full text without opening it.
- **Phone:** full width; the label fits.
- The select never wraps to a second line and never widens the panel.

---

## 6. States that change the layout

| State | Controls | Summary | Note | List |
|---|---|---|---|---|
| **Content · One per note** (default) | all three rows | `6 notes · 14 matches` | `Click a row to open its first match.` | one row per file, `.sp-count` pill |
| **Content · All matches** | all three rows | `14 matches in 6 notes` | hidden | one row per hit, `.sp-meta` `line 12` |
| **File name** | Grouping row hidden; sort count disabled/demoted | `9 notes` | hidden | one row per note: name + directory only |
| **Active sort ≠ Path** | same rows | unchanged | unchanged | the select shows the active option |
| **Idle / empty query** | all controls keep their persisted selections | empty | hidden | empty (no new placeholder in this phase) |
| **Searching…** | all controls stay enabled | `Searching…` | unchanged from the previous mode | previous rows kept, `.is-loading` (`opacity: .6`), `aria-busy="true"` |
| **No matches** | all controls | `0 matches` / `0 notes` | hidden | `.search-panel-empty` `No matches found.` |
| **Truncated** | all controls | existing cap copy, e.g. `200 matches shown — more results exist` | hidden or truncation note (existing) | current rows |
| **Error** | all controls | `Search error: …` in `--danger`, wraps; `Retry` on the next line | hidden | previous rows kept |
| **File name mode with empty query** | Grouping row hidden, sort path | empty | hidden | empty |

Details:

- **File name mode.** Hiding the Grouping row removes its caption, track and
  the 8 px gap; the Sort row moves up immediately with no animation. The
  layout change is intentional and happens only on a target change, never
  while typing. The sort select must never display `Most matches` in this
  mode. The summary switches to the notes-only form, and rows drop the count
  pill, line label and snippet (existing behaviour).
- **Idle.** The current panel has no idle placeholder; adding one is a content
  change outside this redesign. The design keeps the controls visible, the
  summary at its reserved `26px` height, and the list blank. Because the query
  is focused on mount, the placeholder instructs the user. This also means
  clearing the query produces no layout jump.
- **Searching….** The summary text replaces the previous summary in place; the
  reserved min-height prevents a shift. No spinner. Controls remain usable, so
  a user can change grouping or sort mid-request (the latest-response-wins
  token handles the race).
- **Error.** The summary text span wraps to two or more lines; the `Retry`
  button sits below it on its own line at 240 px and 140 px. The controls and
  previous rows stay usable. The summary wrapper keeps its existing
  `role="alert"` live-region contract; the text lives in the span so it can
  wrap independently.
- **Truncation.** The summary is one line with an ellipsis at 240/140; the
  full text is what the live region contains and what screen readers read.
  `title` is set to the full summary by the implementation for pointer users.

---

## 7. Accessibility

### 7.1 Semantics and labels

| Element | Role / name |
|---|---|
| Query | native search input, `aria-label="Search notebooks"` |
| Case | native checkbox, `aria-label="Case sensitive"`; visible `Aa` |
| Search in | `role="radiogroup" aria-label="Search in"`; two native radios in labels |
| Grouping | `role="radiogroup" aria-label="Result grouping"`; two native radios in labels |
| Sort | native select with a real `<label for>` `Sort` |
| Summary | the wrapper carries `role="status" aria-live="polite" aria-atomic="true"` (unchanged); the text is in `.search-panel-summary-text` |
| List | `role="listbox" aria-label="Search results"`, rows `role="option"` (existing) |
| Error | the wrapper switches to `role="alert" aria-live="assertive"` (unchanged); `Retry` is appended to the wrapper |
| Captions | plain text; not used as the radiogroup name (the explicit `aria-label` is) |

### 7.2 Contrast (existing tokens, both themes)

All pairs are the existing app tokens; no new colour is introduced.

| Pair | Dark | Light |
|---|---|---|
| `--fg-muted` on `--bg-panel` (captions, summary, note) | 4.74:1 | 5.56:1 |
| `--fg` on `--bg-panel` (segment labels, select, name) | 11.3:1 | 13.5:1 |
| `--fg` on `--bg-elev` (selected segment) | 11.2:1 | 13.3:1 |
| `--accent` on `--bg-panel` (focus rings, selected rail) | 6.0:1 | 5.34:1 |
| `--fg` on the `Aa` on-state fill (`accent-soft` over `--bg-panel`) | 9.1:1 | 12.4:1 |
| `--danger` on `--bg-panel` (error summary) | 5.64:1 | 5.07:1 |

Captions are small but meet the same 4.5:1 AA threshold; the muted token
already passes on the panel in both themes.

### 7.3 Focus and keyboard

Tab order, top to bottom:

1. Header collapse button
2. Query field
3. `Aa` checkbox (visually hidden, focus ring on the visible span)
4. Search in radiogroup (one tab stop; `←`/`→` move between the two radios)
5. Grouping radiogroup (one tab stop; skipped entirely in File name mode)
6. Sort select (`↑`/`↓` change the option natively)
7. Result rows (one roving tab stop; existing list keys)

Rules:

- Every focusable control uses `outline: 2px solid var(--accent)` with
  `outline-offset: 2px`; the segment span uses offset 1 px inside the track.
- Radios and the checkbox are visually hidden with the standard clipped
  technique, never `display:none`, so they stay focusable.
- Changing a radio, the checkbox or the select keeps focus on that control and
  re-runs the query (existing).
- `Escape` inside the panel keeps the existing behaviour: it clears a
  non-empty query and stops propagation (phone drawer does not close), or
  passes through when the query is empty.
- The list keeps its existing roving-tabindex model, `j`/`k`, Home/End,
  Enter/Space, and Escape-to-query.

### 7.4 No hover-only affordance

- Every option is visible without hover; hover only adds a fill.
- The selected segment is visible through fill, weight and rail.
- The `Aa` on-state is visible through fill and border.
- The sort value is visible in the closed select.
- Nothing needs a right-click, a long-press, or a tooltip to operate.

### 7.5 Touch and motion

- Phone targets are at least `44px`; rows are `52px`.
- The only transitions are the existing `.12s` background/colour changes on
  the segments and the new `Aa` toggle. Both are disabled by the existing
  `prefers-reduced-motion` block.
- No control sits below the phone keyboard; the controls are at the top of the
  drawer, in thumb reach of the focused input.

---

## 8. DOM and CSS handoff

### 8.1 Final DOM (Content mode, results present)

```html
<div id="search-view" class="side-panel-view" data-view="search">
  <div class="panel-header">
    <span class="panel-title">Search</span>
    <button class="collapse-btn" type="button"
            aria-label="Collapse side panel">‹</button>
  </div>

  <div class="search-panel-controls">
    <div class="search-panel-input-row">
      <input type="search" class="search-panel-input"
             placeholder="Search notebooks…" aria-label="Search notebooks">
      <label class="search-panel-case" title="Case sensitive">
        <input type="checkbox" aria-label="Case sensitive">
        <span>Aa</span>
      </label>
    </div>

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
            <input type="radio" name="search-panel-mode" value="all">
            <span>All matches</span>
          </label>
          <label class="search-panel-mode-opt">
            <input type="radio" name="search-panel-mode" value="unique" checked>
            <span>One per note</span>
          </label>
        </div>
      </div>

      <div class="search-panel-filter search-panel-filter--sort">
        <label class="search-panel-filter-label" for="search-panel-sort">
          Sort
        </label>
        <select id="search-panel-sort" class="search-panel-select"
                title="Path (A–Z)">
          <option value="path" selected>Path (A–Z)</option>
          <option value="mtime">Recently modified</option>
          <option value="count">Most matches</option>
        </select>
      </div>
    </div>
  </div>

  <div class="search-panel-summary" role="status" aria-live="polite"
       aria-atomic="true">
    <span class="search-panel-summary-text">6 notes · 14 matches</span>
  </div>

  <div class="search-panel-note">Click a row to open its first match.</div>

  <div class="search-panel-list" role="listbox" aria-label="Search results"
       aria-busy="false">
    <button type="button" class="search-panel-hit" data-line="12" tabindex="0"
            role="option" aria-selected="true">
      <span class="search-panel-hit-file">
        <span class="search-panel-path" title="projects/firmware/parser-notes.md">
          <span class="sp-file">parser-notes.md</span>
          <span class="sp-dir"> (projects/firmware)</span>
        </span>
        <span class="sp-count">3 matches</span>
      </span>
      <span class="search-panel-hit-snippet">
        The <mark>fix</mark> landed before the demo.
      </span>
      <span class="search-panel-sr">Opens at the first match.</span>
    </button>
    <!-- further rows omitted -->
  </div>
</div>
```

File name variant: `.search-panel-filter#search-group-filter` also carries
`.is-hidden` (and the inner track carries `.is-hidden` for the existing DOM
test), `option[value="count"]` carries `disabled`, the summary reads `9 notes`,
the note is `hidden`, and rows contain only `.search-panel-hit-file`.

Error variant: `.search-panel-summary` gains `.error` and switches to
`role="alert" aria-live="assertive"`; `Retry` is appended to the wrapper as a
sibling of the text span.

### 8.2 Scoped tokens

Replace the current `#search-view` token block with:

```css
#search-view {
  --search-space-1: 4px;
  --search-space-2: 6px;
  --search-space-3: 8px;
  --search-space-4: 12px;
  --search-space-5: 16px;
  --search-radius-sm: 4px;
  --search-radius-md: 6px;
  --search-pad-x: 10px;        /* controls/summary side padding      */
  --search-gap: 8px;           /* input→filters and filter→filter    */
  --search-mode-h: 26px;       /* one segment                       */
  --search-control-h: 32px;    /* input and select                   */
  --search-label-size: .66rem; /* caption                            */
  --search-hit-min-h: 32px;
  container-type: inline-size;
}
```

Phone overrides the size tokens only: `--search-pad-x: 12px`,
`--search-gap: 8px`, `--search-mode-h: 44px`,
`--search-control-h: var(--m-hit)`, `--search-label-size: 12px`,
`--search-hit-min-h: 52px`.

### 8.3 Class inventory

**New**

| Class | Purpose |
|---|---|
| `.search-panel-controls` | Padded controls zone with the bottom hairline |
| `.search-panel-filters` | Vertical stack of filter rows |
| `.search-panel-filter` | One caption + one full-width control |
| `.search-panel-filter.is-hidden` | Collapses the whole Grouping row in File name mode |
| `.search-panel-filter--sort` | Sort-row modifier (no extra styling required; hook for future changes) |
| `.search-panel-filter-label` | 9 px uppercase caption; also the `<label>` for the select |
| `.search-panel-summary-text` | The live-region span; one-line ellipsis, wrapping in error |

**Reused unchanged**

`.panel-header`, `.panel-title`, `.collapse-btn`, `.search-panel-input-row`,
`.search-panel-input`, `.search-panel-case` (restyled, same class),
`.search-panel-mode`, `.search-panel-mode-opt`, `.search-panel-select`,
`.search-panel-summary`, `.search-panel-note`, `.search-panel-list`,
`.search-panel-hit`, `.search-panel-hit-file`, `.search-panel-path`,
`.sp-file`, `.sp-dir`, `.sp-count`, `.sp-meta`, `.search-panel-hit-snippet`,
`.search-panel-empty`, `.search-panel-state`, `.search-panel-retry`,
`.search-panel-sr`, `.is-hidden`.

**Replaced / removed**

| Old | Replaced by |
|---|---|
| `.search-panel-options-row` | `.search-panel-controls` + `.search-panel-filters` |
| `.search-panel-sort` | `.search-panel-filter--sort` |
| `.search-panel-sort-label` | `.search-panel-filter-label` |
| `.search-panel-mode { flex: 1 1 140px; … }` | `width: 100%` grid track |
| `.search-panel-select { max-width: 132px }` | `width: 100%`, `height: var(--search-control-h)` |
| `.search-panel-case` checkbox+text | hidden checkbox + styled `span` |
| Container-query `.search-panel-sort` rules | single track-column rule |

### 8.4 CSS

```css
/* ------------------------------------------------------------------ */
/* Search view — controls (replaces .search-panel-options-row)          */
/* ------------------------------------------------------------------ */
#search-view {
  --search-space-1: 4px;
  --search-space-2: 6px;
  --search-space-3: 8px;
  --search-space-4: 12px;
  --search-space-5: 16px;
  --search-radius-sm: 4px;
  --search-radius-md: 6px;
  --search-pad-x: 10px;
  --search-gap: 8px;
  --search-mode-h: 26px;
  --search-control-h: 32px;
  --search-label-size: .66rem;
  --search-hit-min-h: 32px;
  container-type: inline-size;
}

.search-panel-controls {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--search-gap);
  padding: var(--search-space-3) var(--search-pad-x) var(--search-space-2);
  border-bottom: 1px solid var(--border);
}

.search-panel-input-row {
  display: flex;
  align-items: center;
  gap: var(--search-space-2);
  flex: 0 0 auto;
}

.search-panel-input {
  flex: 1 1 auto;
  min-width: 0;
  height: var(--search-control-h);
  padding: 0 var(--search-space-3);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--search-radius-md);
  color: var(--fg);
  font: inherit;
  font-size: .88rem;
}
.search-panel-input::placeholder { color: var(--fg-muted); }
.search-panel-input:focus { outline: none; border-color: var(--accent); }
.search-panel-input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.search-panel-case {
  position: relative;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: var(--search-control-h);
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
  width: 28px;
  height: 26px;
  border: 1px solid var(--border);
  border-radius: var(--search-radius-sm);
  background: var(--bg);
  color: var(--fg-muted);
  font-size: .74rem;
  font-weight: 700;
  line-height: 1;
  transition: background .12s ease, color .12s ease, border-color .12s ease;
}
.search-panel-case:hover span {
  color: var(--fg);
  border-color: var(--accent);
}
.search-panel-case input:checked + span {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--fg);
}
.search-panel-case input:focus-visible + span {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.search-panel-filters {
  display: flex;
  flex-direction: column;
  gap: var(--search-gap);
  min-width: 0;
}
.search-panel-filter {
  display: flex;
  flex-direction: column;
  gap: var(--search-space-1);
  min-width: 0;
}
.search-panel-filter.is-hidden { display: none; }
.search-panel-filter-label {
  color: var(--fg-muted);
  font-size: var(--search-label-size);
  font-weight: 600;
  letter-spacing: .07em;
  line-height: 1.2;
  text-transform: uppercase;
}

.search-panel-mode.is-hidden { display: none; }
.search-panel-mode {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
  width: 100%;
  min-width: 0;
  padding: 2px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--search-radius-md);
}
.search-panel-mode-opt { position: relative; display: flex; min-width: 0; }
.search-panel-mode-opt input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}
.search-panel-mode-opt span {
  flex: 1 1 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--search-mode-h);
  padding: 0 4px;
  border-radius: var(--search-radius-sm);
  color: var(--fg-muted);
  font-size: .78rem;
  cursor: pointer;
  user-select: none;
  transition: background .12s ease, color .12s ease;
}
.search-panel-mode-opt span:hover {
  background: var(--accent-soft);
  color: var(--fg);
}
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

.search-panel-select {
  width: 100%;
  max-width: none;
  height: var(--search-control-h);
  min-height: 0;
  padding: 0 24px 0 var(--search-space-3);
  background-color: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--search-radius-md);
  color: var(--fg);
  font: inherit;
  font-size: .78rem;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
}
.search-panel-select:hover { border-color: var(--accent); }
.search-panel-select:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.search-panel-select option:disabled { color: var(--fg-muted); }

.search-panel-summary {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--search-space-3);
  min-height: 26px;
  padding: var(--search-space-1) var(--search-pad-x) var(--search-space-2);
  color: var(--fg-muted);
  font-size: .78rem;
}
.search-panel-summary-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-panel-summary.error { flex-wrap: wrap; color: var(--danger); }
.search-panel-summary.error .search-panel-summary-text {
  flex-basis: 100%;
  white-space: normal;
  overflow: visible;
}
.search-panel-summary .search-panel-retry { flex: 0 0 auto; }

.search-panel-note {
  flex: 0 0 auto;
  padding: 0 var(--search-pad-x) var(--search-space-2);
  color: var(--fg-muted);
  font-size: .72rem;
  line-height: 1.4;
}
.search-panel-note[hidden] { display: none; }

/* Result rows, list, empty/state/retry/sr: keep the existing rules. */
```

### 8.5 Narrow container query

```css
@container (max-width: 199px) {
  #search-view .search-panel-mode { grid-template-columns: 1fr; }
  #search-view .search-panel-select {
    font-size: .74rem;
    padding-right: 20px;
  }
}
```

No other rules belong in this query. The captions, order and gaps do not
change; only the track's column count and the select's text size.

### 8.6 Phone overrides

Replace the current search-control rules inside the phone media query
(`(max-width: 860px), ((pointer: coarse) and (max-width: 1023px))`) with:

```css
#search-view {
  --search-mode-h: 44px;
  --search-control-h: var(--m-hit);
  --search-hit-min-h: 52px;
  --search-pad-x: var(--search-space-4);
  --search-gap: var(--search-space-3);
  --search-label-size: 12px;
}
.search-panel-controls { padding: var(--search-space-3) var(--search-pad-x); }
.search-panel-input {
  height: var(--m-hit);
  font-size: 16px;
  border-radius: 8px;
}
.search-panel-case {
  width: var(--m-hit);
  height: var(--m-hit);
}
.search-panel-case span {
  width: var(--m-hit);
  height: var(--m-hit);
  border-radius: 8px;
  font-size: 15px;
}
.search-panel-filter-label { letter-spacing: .06em; }
.search-panel-mode-opt span { font-size: 15px; }
.search-panel-select {
  height: var(--m-hit);
  padding-right: 28px;
  border-radius: 8px;
  font-size: 16px;
}
.search-panel-summary {
  min-height: 30px;
  padding: var(--search-space-1) var(--search-pad-x) var(--search-space-2);
  font-size: 14px;
}
.search-panel-note { padding: 0 var(--search-pad-x) var(--search-space-2); font-size: 13px; }
.search-panel-hit { min-height: 52px; padding: 8px; }
.search-panel-hit .sp-file { font-size: 15px; }
.search-panel-hit-snippet { font-size: 14px; }
.sp-count { font-size: 12px; }
.search-panel-summary .search-panel-retry { min-height: var(--m-hit); }
```

Delete the old phone `.search-panel-input-row { padding: … }`,
`.search-panel-options-row { margin: … }`, `.search-panel-sort { … }`,
`.search-panel-case input { width: 18px; height: 18px }`, and the old
`.search-panel-case` sizing block.

### 8.7 Existing DOM-test contract

Keep these or the frontend suite breaks:

- `#search-panel-sort` stays the select's id.
- `aria-label="Search in"` and `aria-label="Result grouping"` stay on the two
  radiogroups.
- `.search-panel-case` still contains a native checkbox (visually hidden).
- The grouping **track** (`.search-panel-mode[aria-label="Result grouping"]`)
  keeps getting `.is-hidden` in File name mode, in addition to the new
  `.search-panel-filter` wrapper. Toggle both; the wrapper collapses the
  caption and gap, the track class satisfies the existing assertion.
- `.search-panel-summary` stays the wrapper class; the text moves into
  `.search-panel-summary-text`. `textContent` reads the same.
- `role="status" aria-live="polite" aria-atomic="true"` and the error
  `role="alert"` stay on the `.search-panel-summary` wrapper; the tests
  assert them there.
- `.sp-file`, `.sp-dir`, `.sp-count`, `.sp-meta`, `.search-panel-path` and
  `.search-panel-hit-snippet` keep their names and semantics.

---

## 9. What changes, file by file (references only)

### 9.1 `static/js/activity.js` — `mountSearch()`

Control construction (currently ~lines 420–500):

- Replace `optionsRow` with `.search-panel-controls` (containing the existing
  input row and a new `.search-panel-filters`).
- Wrap each of the two `.search-panel-mode` groups in a `.search-panel-filter`
  with a `.search-panel-filter-label` caption (`Search in`, `Grouping`).
- Replace `sortWrap` / `.search-panel-sort` / `.search-panel-sort-label` with a
  `.search-panel-filter.search-panel-filter--sort` whose `<label
  class="search-panel-filter-label" for="search-panel-sort">` is `Sort` and
  whose select is unchanged.
- Add a `summaryText` span inside the summary wrapper. Keep the existing
  `role="status" aria-live="polite" aria-atomic="true"` attributes on the
  wrapper; the tests assert them there.
- Set `caseToggle` markup unchanged (`label > checkbox + span "Aa"`).

`applyTargetUi()` (currently ~lines 530–600):

- Toggle `.is-hidden` on the **Grouping filter row** in addition to the mode
  track (see §8.7).
- Keep `countOption.disabled = isName` and the demote-to-path logic exactly as
  it is.

Summary helpers:

- `setSummary()` / `setSummaryError()` write to `summaryText` and keep the
  existing role/aria changes on the wrapper (`.error`, `role="alert"`). Set
  the wrapper's `title` to the same text so a summary clipped by the one-line
  ellipsis is still readable on hover.
- `showSearchError()` / `showOpenError()` append `Retry` / `Refresh results`
  to the summary **wrapper**, as today.

Presentational only:

- Add one small helper, `syncSortTitle()`, that sets `sortSelect.title` from
  the selected option's text. Call it after every place the value changes:
  `syncControls()`, `applyConfigSync()`, the sort `change` handler, and the
  count→path demotion inside `applyTargetUi()`. This lets a clipped narrow
  select expose its full label on hover.

Do not change: the debounce, request options, latest-response-wins token, row
rendering, keyboard handlers, persistence calls, or `setTimeout(input.focus)`.

### 9.2 `static/css/style.css`

- Replace the `#search-view` token block with §8.2.
- Delete `.search-panel-options-row`, `.search-panel-sort`,
  `.search-panel-sort-label`.
- Rewrite `.search-panel-input-row`, `.search-panel-input`,
  `.search-panel-case`, `.search-panel-mode`, `.search-panel-select`,
  `.search-panel-summary` and `.search-panel-note` per §8.4.
- Add `.search-panel-controls`, `.search-panel-filters`,
  `.search-panel-filter`, `.search-panel-filter-label`,
  `.search-panel-filter--sort`, `.search-panel-summary-text`.
- Replace the old `@container (max-width: 200px)` block with §8.5.
- Replace the search portion of the phone media query with §8.6.
- Add `.search-panel-case span` to the existing `prefers-reduced-motion` block.

### 9.3 Not changed

- `static/js/api.js`, `app.py`, `templates/index.html`: no change.
- Persistence keys and request parameters: no change.
- The top-bar search overlay: no change.
- Result rows and their states: no change.

### 9.4 Test note

The DOM suite selects the radiogroups by `aria-label` and the grouping track's
`.is-hidden` class, and asserts summary `textContent` (see §8.7). Those hooks
are preserved, so no test edits are required. Run the suite only after the
implementation is complete.

---

## 10. Acceptance checklist

- [ ] At 240 px, the three filters occupy three stable rows; nothing wraps at
      `--font-scale` 0.9, 1.0, 1.15 or 1.3.
- [ ] At 140 px, each segmented track shows its options stacked; no horizontal
      scrollbar appears anywhere in the panel; captions stay above controls.
- [ ] At 390 px phone width, the drawer is full width, every target is at
      least 44 px, and the input is 16 px.
- [ ] The query row never wraps; the `Aa` toggle stays centered with the input.
- [ ] Content mode shows all three filter rows; File name mode removes the
      Grouping row and disables/demotes `Most matches`.
- [ ] The summary is one line with an ellipsis at 240/140; screen readers read
      the full text; the error summary wraps and `Retry` stays visible.
- [ ] `Searching…` keeps the previous rows visible and dimmed; controls stay
      usable.
- [ ] Selected segments, the `Aa` on-state, and focus rings are visible in
      both themes and do not rely on colour alone.
- [ ] Tab order is collapse → query → `Aa` → Search in → Grouping → Sort →
      rows; the Grouping group is skipped in File name mode.
- [ ] The existing DOM test selectors (§8.7) still resolve.
- [ ] No new colour literal, font, or dependency appears; every value comes
      from the scoped tokens or existing app variables.
