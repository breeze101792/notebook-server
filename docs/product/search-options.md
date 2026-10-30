# Search options (side-panel Search) — product spec

Status: draft for review. Owner: `product-designer`.
Applies to: the Search view in the side panel (`static/js/activity.js`, `mountSearch`), its API wrapper (`static/js/api.js`), search prefs (`static/js/app.js`), the search endpoint (`app.py`), and the tests and contracts named in §9.
Related: [mobile](mobile.md) owns phone-shell rules; [HTTP API](../contracts/http-api.md) and [configuration](../contracts/configuration.md) own the wire and config contracts. This document owns observable search behaviour.

Visual treatment is `ui-designer`'s. This document fixes labels, control order, states, and what must be true.

## 1. Purpose and user goal

> **After typing a few characters, the user sees which notes contain the text, how many hits each has, and opens the right one in one click — without the panel lying about what it left out.**

The request (verbatim): "On search sidebar, add search options for shows only one times if you found multiple matches on the same file. it's like unique. help to design a clear & easy to understand ui for user to search."

Today the panel is a flat list of occurrences:

- a note with many hits takes one row per hit and pushes every other note off the panel;
- the summary counts occurrences only, so "23 matches" does not say whether that is one note or ten;
- the per-file cap (`MAX_MATCHES_PER_FILE`) clips a file with no signal; `truncated` reports only the total cap;
- results have a fixed walk order; there is no sort;
- the panel's "Aa" is not persisted and does not stay in step with the top-bar "Aa";
- clicking a hit for a note that was deleted or moved is not caught, and `tabs.open` has already added the tab before the read fails.

P1 fixes the shape of the result list, makes every cap visible, and keeps the existing read-only safety: search never writes note content.

## 2. Users and jobs

One user, their own Markdown notebook. Desktop is the main surface; the phone drawer is the second. Viewers (read-only role) may search; search adds no write.

| Rank | Job | What it needs from search |
|---|---|---|
| 1 | "Which note was it?" | one row per note, a count, the first useful snippet |
| 2 | "Where in this note was it?" | every occurrence, in order, open at the hit |
| 3 | "I wrote it recently / it is under this folder" | sort by modified time; P2 scope |
| 4 | "I know the exact form" | case sensitivity (P1), regex (P2) |
| 5 | "That query failed — try again" | query kept, one Retry, no silent state |

## 3. Scope

### 3.1 In scope (P1, the MVP)

| ID | Capability | User-visible outcome |
|---|---|---|
| S1 | One result per note | a file with many hits appears once, with its total match count and its first snippet |
| S2 | Sort | Path A–Z, Recently modified, or Most matches; deterministic order |
| S3 | Shared match case | one persisted `Aa` setting, reflected in the panel and the top bar |
| S4 | Honest caps | unique mode never hides a matching note silently; every-match mode discloses the per-file cap; `truncated` is always stated |
| S5 | Search lifecycle | debounced, latest-response-wins, empty query is idle, failures keep the query and offer Retry |
| S6 | Robust open | a deleted or moved hit shows an inline message, does not leave a new empty tab, and writes nothing |
| S7 | Keyboard and phone | every option and result is reachable by keyboard; the phone drawer stays usable and closes when a note opens |
| S7b | Filename search | a `Search in: Content / File name` switch matches note names instead of content (`name=1`); grouping hides and rows carry no snippet |

### 3.2 Phase 2 (not built in P1)

| ID | Capability | Why it is worth a later phase |
|---|---|---|
| S8 | Regex toggle | the server already supports `regex=1`; a power user needs it for word boundaries and alternation; it needs its own error state |
| S9 | Scope: this note | useful for long notes; the server already supports `file=` |
| S10 | Scope: this folder | natural entry point is the folder context menu ("Search in this folder"), using `glob=` |
| S11 | Title/heading search | filename search shipped as S7b; ranking by a note's title or headings is still open and needs heading parsing |
| S12 | Load more / paging | only if truncation recurs after P1; needs an offset contract and stable ordering |

### 3.3 Out of scope

See §8. The MVP line is P1 in §3.1. Nothing in P2 may leave a disabled control in the P1 UI.

## 4. Functional behaviour

### 4.0 State model

| State | Entered when | Summary | List |
|---|---|---|---|
| Idle | query is empty or whitespace | empty | empty |
| Waiting | a non-empty query changed, debounce running | previous summary (not an error) | previous results |
| Running | request in flight | `Searching…` | previous results, `aria-busy="true"` |
| Results | response with at least one match | count line (§4.2) | rows for the current mode |
| Empty | response with zero matches | `0 matches` | `No matches found.` |
| Error | non-2xx or transport failure | `Search error: …` + Retry (or the 400 / 404 variants in §7) | previous results retained, except a 400 clears them |

Transitions are driven only by the current query and options. A response is applied only if it belongs to the newest request (see §4.1).

### 4.1 Query lifecycle

1. Typing starts a 250 ms debounce (the existing value). Only the last keystroke runs a search.
2. `Enter` in the query field cancels the debounce and runs the current query immediately, then moves focus to the results list (first row active).
3. A non-empty query is sent trimmed. A whitespace-only query is Idle: no request, summary and list cleared.
4. Clearing the query cancels the debounce, clears the summary and list, and discards any response still in flight.
5. Changing any option re-runs immediately when the query is non-empty (no debounce); with no query it changes only the control and persists.
6. **Latest response wins.** The panel keeps a request token; a response for an older token is ignored. This includes an older response that arrives after a newer query, a newer option change, or a cleared input.
7. While running, previous rows stay visible under `Searching…`; they remain clickable and open the note at their term.
8. The panel keeps its query, options, results, and active row across side-panel view switches. It does not re-run on becoming active unless a shared option changed while it was hidden (§4.9). The §search tab keeps its existing re-run-on-activation behaviour.
9. The query is not persisted. After a reload the panel is Idle; the options are restored from config.

### 4.2 One result per note (P1, default ON)

The result set is a list of notes. Each row is built from the first match in that note in document order.

| Row part | Content |
|---|---|
| file line | the relative path exactly as the server returned it |
| meta | `N matches` (singular `1 match`), right-aligned; `title` explains "total occurrences in this note" |
| snippet | the first occurrence with the matched text in `<mark>`; the existing `<<…>>` parser |
| whole row | clickable; keyboard-activatable; opens the note and jumps to the match |

- **The match used** is the first occurrence in document order: lowest line, then lowest column. "Best" is rejected (the server has no relevance score); "last" is rejected (it does not match what a reader remembers). The snippet shown is that first occurrence.
- **The count** is the number of pattern occurrences in the whole file, not the number of lines and not the number of returned snippets. Two hits on one line count two.
- **The row does not show a line number in this mode.** The click jumps to the first rendered occurrence of the term, so a line label would imply a precision the jump does not have. The server still returns `line`/`col`; a `title` tooltip may show them.
- **Dedupe key** is the exact relative path string. Do not lowercase, normalise Unicode, or strip `.md`. Two files whose names differ only by case are two notes.
- **No silent hiding:** a note with at least one returned match appears exactly once. The only thing that can remove a whole note is the file cap; when it does, `truncated` is true and the summary says more results exist. The per-file cap never removes a note.
- If the response is malformed and lacks `count`, the row shows no count rather than `undefined`, `NaN`, or an invented number.

**Control surface.** Query row (input + `Aa`), then an `Advanced` disclosure, then summary and results. Advanced holds the labelled filters (`Search in` segmented `Content / File name`; `Grouping` segmented `All matches / One per note`; `Sort` select). It starts collapsed; collapsing hides the controls but does not change or disable the persisted settings, and the collapsed row names any non-default option (a count badge below 200 px). In File name mode the Grouping row hides and `Most matches` is disabled. Each control shows its current value (`Path (A–Z)`, `Recently modified`, or `Most matches`).

**Server-side, not client-side.** Dedupe runs in `/api/search` behind a new `unique=1` parameter.

| | Server-side (`unique=1`) | Client-side dedupe of the flat list |
|---|---|---|
| count | exact, uncapped | capped at `MAX_MATCHES_PER_FILE`; "N+" only, cannot distinguish the cap from a larger true count |
| cap budget | `limit` counts notes, so one hit-heavy note cannot consume `MAX_MATCHES_PER_FILE` of the `MAX_TOTAL_MATCHES` match slots | one note can consume up to the per-file cap before dedupe; the cap can push whole notes out |
| sort by count | sorts exact counts, then caps | sorts the capped/served subset |
| cost | one additive server parameter; `app.py`, contract, `agent.md`, backend tests | no server change |

The user asked for a count. An approximate count and a cap-skewed list are the half-finished states this change exists to remove, so P1 takes the server change. The contract is in §9.

**Caps in unique mode** (all existing constants; no new numbers):

- `limit` is the maximum number of **notes**, default `MAX_TOTAL_MATCHES`, ceiling `MAX_TOTAL_MATCHES_CEILING`.
- `perFile` is ignored; `perFileTruncated` is false.
- The server scans all candidate files, counts every occurrence, orders the note bundles, then applies `limit`. `truncated` is true when more notes matched than were returned.
- The client sends `unique=1` only when the toggle is on; when off it sends `unique=0` (or omits it).

### 4.3 Every-match mode (toggle off)

This is the existing flat list, with three corrections:

1. It gains the per-file-cap disclosure: when `perFileTruncated` is true the summary appends `· some notes have more matches`. A file showing only its first `MAX_MATCHES_PER_FILE` hits is never presented as complete.
2. The row keeps `line N` (and the tab keeps `line N, col N`), because this is the per-line view. The click still jumps to the first rendered occurrence; see the known limitation in §8.
3. The summary reads `M matches in N notes`, where `N` is the number of distinct returned paths.

No dedupe is applied in this mode.

### 4.4 Sort (P1)

| Label | Server params | Order | Tie-break |
|---|---|---|---|
| `Path (A–Z)` (default) | `order=path` | case-insensitive relative path | — |
| `Recently modified` | `order=mtime&desc=1` | newest first | path A–Z |
| `Most matches` | `order=count&desc=1` | most matches first | path A–Z |

- In unique mode, order is applied to the full set of matching notes before the file cap, so `Most matches` shows the top notes, not the first notes that happened to fit.
- In every-match mode, the cap is applied during the scan; ordering regroups only the returned set. `Most matches` therefore ranks by the matches returned (a file clipped at `MAX_MATCHES_PER_FILE` ranks as that cap). The UI does not promise to recover clipped matches.
- Changing sort re-runs a non-empty query immediately. With no query it only persists.
- There is no asc/desc control. The directions above are the product decisions; the server keeps `desc` for agents.

### 4.5 Match case (P1, existing)

- Label `Aa`, accessible name "Match case". Off by default.
- One setting, `searchCaseSensitive`, shared by the panel and the top bar.
- Toggling in either place updates both checkboxes and persists once. The surface where the change was made re-runs its non-empty query immediately; the other surface re-runs on its next activation/visibility (the §search tab already re-runs on activation). Focus does not move.
- With no query, no request is made.
- If the panel mounted before the first config load (Search can be the saved view), it syncs its controls when the loaded config arrives. A change the user made in that window is not reverted by the late load.

### 4.6 Opening a result

1. The panel opens the note through `NB.tabs.open(path)`, then calls `NB.viewer.jumpToMatch(term, caseSensitive)` on the next frame.
2. The jump is literal and finds the first occurrence in the rendered text. This is the same behaviour as today.
3. If the note no longer exists or the read fails, the panel shows an inline message in the summary area: `Could not open “{path}”. It may have been moved or deleted.` with a `Refresh results` action. It does not use `alert`.
4. A failed open must leave no **newly added** tab behind (the tab set must not gain a phantom entry). A tab that was already open before the click is left as it was.
5. No search or open path writes note content. `Refresh results` re-runs the current query; it does not create or repair files.

### 4.7 Keyboard and focus

| Where | Keys |
|---|---|
| query | Enter: run and move focus to the results list; Esc: clear query and results; arrows keep native caret movement |
| options | native Tab / Shift+Tab; a select keeps its native arrow behaviour; no global key handler may steal keys from a focused control |
| results | one tab stop; ArrowDown/ArrowUp move the active row, Home/End jump to first/last, Enter opens, Esc returns focus to the query |
| any | visible focus ring on every control; no keyboard trap |

Accessibility semantics: the result list is a listbox (or an equivalent roving-focus list) with `aria-selected` / `aria-activedescendant` so the active row is announced. The summary is a polite live region; an error uses `role="alert"`. The list carries `aria-busy="true"` while a request is in flight.

### 4.8 Phone

The panel is the Search view inside the drawer (`#search-view`), reached from Home or the activity rail. The top-bar search is hidden, so in P1 the panel's options are the only search options on a phone.

1. Opening the drawer focuses the query field.
2. The options row wraps or stacks; every control is at least the mobile hit target (mobile spec C3), and the input stays at 16 px so iOS does not zoom (C2). No horizontal page scroll.
3. Tapping a result closes the drawer, opens the note, and jumps to the match. Reopening Search shows the same query, options, and results (the host stays mounted).
4. A 401 shows the login flow above the drawer; after login the page reloads and the panel is Idle.
5. The keyboard must not cover the query field; the results list scrolls above it.

### 4.9 Consistency with the top bar and the §search tab

| Setting | Panel | Top bar / §search tab | Storage |
|---|---|---|---|
| query text | own | own | in memory, per surface |
| match case | yes | yes | `searchCaseSensitive` |
| one per note | yes | no control, always every-match | `searchUnique` |
| sort | yes | no control, fixed walk order | `searchSort` |
| scope (P2) | yes | no; the top bar stays an all-notes search | session only |

The split is deliberate: the panel answers "which note", the tab answers "which line". The tab is not changed to grouped results in P1.

Re-run rules:

- A panel query/option change runs only the panel; a top-bar query runs only the tab.
- A shared case change re-runs the surface where it happened, updates the other surface's checkbox, and marks the hidden panel to re-run when it next becomes active (if its query is non-empty and the value changed since its last run).
- The panel does not open or activate the §search tab. Changing a panel option never pops a tab.
- Switching away from the panel and back does not re-run or reset. Switching to the §search tab re-runs it, as today.
- Both surfaces adopt latest-response-wins. This is a small `search.js` correction; the tab's existing behaviour is otherwise unchanged.

## 5. Option inventory

| ID | Option | Values / default | Phase | Applies to | Decision and rationale |
|---|---|---|---|---|---|
| O1 | Query | text, required for a search; trimmed; empty = idle | P1 | both | the one mandatory input; no auto-search on empty |
| O2 | Match case (`Aa`) | off | P1 (exists) | both | cheap, familiar, already in the server; fix the missing sync and persistence |
| O3 | One per note | on | P1 | panel | requested; the panel's main job is finding a note; the count and first snippet carry the context |
| O4 | Sort | `Path (A–Z)` | P1 | panel | one compact select; three orders the server already supports; no asc/desc control |
| O5 | Scope: this note | off (P2) | P2 | panel | useful for long notes; needs an active-note rule and a 404 path; defer to keep P1's control row small |
| O6 | Scope: this folder | off (P2) | P2 | panel | best entry is the folder menu ("Search in this folder"), not a folder picker; uses `glob`; P2 |
| O7 | Regex | off (P2) | P2 | panel first | server already supports it; needs an invalid-pattern state and a literal jump from the matched text; not a P1 default |
| O8 | Search in: File name | `Content` | P1 (shipped) | panel | matches the basename (`name=1`); one row per note, no snippet; grouping hides and count sort is disabled |
| O9 | Load more / paging | none | P2 candidate | panel | unique mode caps notes at a number larger than most notebooks; paging needs an offset contract and stable order; only revisit if truncation recurs |
| O10 | Sort direction (asc/desc) | — | rejected | — | fixed directions are enough for one user; a second control adds ambiguity for no job |
| O11 | Whole-word match | — | rejected | — | regex (P2) covers it; a separate toggle is a second partial syntax |
| O12 | Saved searches / history | — | rejected | — | adds storage and UI for a single user who can retype; not worth the maintenance |
| O13 | Fuzzy / stemming / semantic | — | rejected | — | unpredictable result order and cost; the user knows their own words |
| O14 | Boolean / quoted phrase / field prefixes | — | rejected | — | a mini-language needs docs and errors; regex covers the need |
| O15 | Cross-note replace | — | rejected | — | destructive; search must stay read-only |
| O16 | Full-text index | — | rejected | — | invalidation against the watcher and autosave costs more than a fresh scan of a small notebook |
| O17 | Attachments / binary files | — | rejected | — | `/api/search` is Markdown-only; attachments are not notes |
| O18 | Search unsaved editor buffer | — | rejected | — | the server is the source of truth; autosave and the watcher already cover saved text; searching the buffer would make results depend on edit state |
| O19 | Line-accurate jump | — | deferred (separate change) | — | the rendered DOM has no source-line mapping; a renderer change, not a search change |
| O20 | Per-file cap knob | — | rejected | — | hide the knob; keep the server default; disclose the cap instead |

## 6. Defaults and persistence

| Key | Values | Default | Owner | Notes |
|---|---|---|---|---|
| `searchCaseSensitive` | boolean | `false` | `app.js` | existing; now both surfaces read and write it |
| `searchUnique` | boolean | `true` | `app.js` | new; panel only in P1 |
| `searchSort` | `"path"` \| `"mtime"` \| `"count"` | `"path"` | `app.js` | new; panel only in P1 |
| `searchTarget` | `"content"` \| `"name"` | `"content"` | `app.js` | new; panel only |
| — | query text | none | panel memory | not persisted; lost on reload |
| — | scope (P2) | `"all"` | panel memory | P2; not persisted; if persistence is later requested, use `searchScope` |

- Persist through `/api/config`, the existing path. Do not use `localStorage` for these. `app.js` adds the two keys to `DEFAULTS` and exposes setters/getters on `NB.app` (the panel cannot reach `cfg` directly).
- Hand-edited values are normalised: `searchUnique` must be a boolean (otherwise `true`), `searchSort` must be one of the three values (otherwise `"path"`). A write persists the normalised value.
- A viewer (read-only role) can change options for the session; `POST /api/config` is admin-only, so the save may be refused. That must not appear as a search error and must not block searching.
- Boot can mount the panel before `GET /api/config` resolves when Search is the saved active view. The page must signal the loaded config (e.g. emit the existing `config:changed` after `applyConfig`), and the panel must sync then without reverting a user change made in the same window.
- First run: query empty, `Aa` off, One per note on, Sort Path A–Z. No results, no request, input focused when the panel is activated.

## 7. Edge cases and acceptance criteria

**Tag:** [B] backend unittest, [D] jsdom, [H] manual / real browser / phone. Exact strings are pass conditions unless marked "contains".

### 7.1 Options and defaults

| ID | Scenario | Expected (pass condition) | V |
|---|---|---|---|
| AC1 | Fresh config, panel opened | `Aa` unchecked, `One per note` checked, `Sort` = `Path (A–Z)`; no `/api/search` request; input focused | D |
| AC2 | Each option changed, then reload | the debounced `POST /api/config` body has the changed key and value (one POST may carry several keys changed inside the same debounce); after reload the controls show the saved values | D |
| AC3 | Saved view = Search, `GET /api/config` delayed | controls start at defaults, then take the loaded values; a change made before the response is not reverted | D |
| AC4 | Fixture: `a.md` ×3 hits, `b.md` ×1, unique on | exactly 2 rows; `a.md` row says `3 matches` and shows `a.md`'s first hit; `b.md` says `1 match` | D |
| AC5 | Same fixture, unique off | 4 rows, line labels shown; toggling persists `searchUnique:false` | D |
| AC6 | Two hits on one line | unique row count is 2; one row; snippet marks the first hit | B, D |
| AC7 | Sort chosen | requests carry `order=path`, `order=mtime&desc=1`, `order=count&desc=1`; rendered order matches; equal keys fall back to path A–Z | B, D |
| AC8 | Unique + `order=count&desc=1` + `limit=2`, three notes with counts 3/2/1 | the two highest-count notes are returned; `truncated:true`; the low-count note is absent | B |
| AC9 | Unique + `perFile=1`, one note with 25 hits | one row, `count:25`; no per-file clipping | B |
| AC10 | Unique row fields | `line`/`col` point at the first occurrence; `snippet` contains that hit; `count` covers every occurrence in the file | B |
| AC11 | Every-match mode, a note exceeds `perFile` | `perFileTruncated:true`; summary contains `some notes have more matches`; unique mode returns `false` | B, D |
| AC12 | `unique` absent or `0` | the current response shape and values are unchanged except the additive `perFileTruncated`; `truncated` still means the total cap | B |

### 7.2 Query lifecycle and results

| ID | Scenario | Expected (pass condition) | V |
|---|---|---|---|
| AC13 | No query / spaces only | no request; summary and list empty; no error | D |
| AC14 | Typing, then Enter | one request per 250 ms quiet period; Enter sends one request immediately and moves focus to the first result | D |
| AC15 | Two overlapping responses, first is slow | only the newest query's rows and summary render; the old response never overwrites | D |
| AC16 | Zero matches | summary `0 matches`; list `No matches found.`; query kept; no Retry; a `Search file names instead` / `Search content instead` action switches mode | D |
| AC17 | Request in flight | summary `Searching…`; previous rows remain; list `aria-busy="true"`; cleared when the response lands | D |
| AC18 | Truncated unique / every-match | `N notes shown — more results exist` / `N matches shown — more results exist`; no false total | D |
| AC19 | Pluralisation | `1 note · 1 match`, `2 notes · 3 matches`, `1 match` on the row | D |
| AC20 | Counts in the DOM | no `undefined`, `NaN`, or negative number appears in a row or summary for any response, including an empty one | D |

### 7.3 Result shape and identity

| ID | Scenario | Expected (pass condition) | V |
|---|---|---|---|
| AC21 | Unique, one note one hit | one row, `1 note · 1 match`, click opens the note and marks the hit | D |
| AC22 | Unique, one note many hits | one row with the exact count even when the count exceeds `perFile`; click opens and marks the first rendered hit | B, D |
| AC23 | Unique, many notes | one row per distinct path, none repeated, none missing within the returned set | B, D |
| AC24 | Paths differing only by case | two rows (exact path key), not merged | B |

### 7.4 Failures and recovery

| ID | Scenario | Expected (pass condition) | V |
|---|---|---|---|
| AC25 | Network / 5xx | query and last good results stay; summary `Search error: …` + `Retry`; Retry sends exactly one request; disabled while in flight; success replaces the list | D |
| AC26 | 401 | login modal shows; the panel does not show `Search error`; the in-flight response is discarded; after login the panel is Idle (query not restored) | D |
| AC27 | Invalid regex (P2 only) | 400 clears the results, shows `Invalid pattern: …` with the server detail, keeps the query, offers no Retry, focuses the input | D |
| AC28 | Scoped note deleted (P2 only) | 404 shows `This note no longer exists` + `Search all notes`; no silent fallback | D |
| AC29 | Hit's file deleted/moved before click | inline `Could not open “{path}”. It may have been moved or deleted.` + `Refresh results`; no alert; no write; a newly added tab is removed; an already-open tab stays; Refresh re-runs once | D |
| AC30 | Read-only | a search + open issues only GETs; only an option change POSTs `/api/config`; a viewer's 403 on that POST does not surface as a search error | D |

### 7.5 Input, device, and state

| ID | Scenario | Expected (pass condition) | V |
|---|---|---|---|
| AC31 | Keyboard-only | Tab reaches query → Aa → one-per-note → sort → results; arrows/Home/End move the active row; Enter opens; Esc returns to the query (and clears when in the query); every focused control has a visible ring | D, H |
| AC32 | Screen reader semantics | results expose a listbox/option (or equivalent) with the active row announced; summary is a live region; error is an alert; list is busy while running | D |
| AC33 | Switch to Explorer and back | same query, options, results, and active row; no new request unless a shared case value changed while hidden | D |
| AC34 | Case toggled in the top bar while the panel is active | both checkboxes update; the panel re-runs its own query once; focus does not move; one config POST | D |
| AC35 | Phone drawer | search opens focused; controls meet the 44 px target (mobile C3) and do not scroll the page sideways; tap closes the drawer, opens the note, marks the hit; reopening shows the same query/results | H |
| AC36 | Panel at default 240 px and at the drawer width | long paths ellipsize, snippets wrap, controls do not overlap or clip, no horizontal scroll | H |

## 8. Non-goals

| Excluded | Reason |
|---|---|
| Saved searches, search history | storage and UI for a single user; the query is short to retype |
| Full-text index or cache | invalidation against the watcher and autosave costs more than scanning a small notebook |
| Boolean operators, quoted phrases, field prefixes | a second query language needs docs and error handling; regex (P2) covers precision |
| Fuzzy, stemming, semantic search | unpredictable ranking and cost; the user knows their own words |
| Cross-note replace, bulk edit, rename from results | destructive; the panel is read-only |
| Searching attachments, images, or binary files | the endpoint is `.md`-only; those are not notes |
| Searching the unsaved editor buffer | the server is the source of truth; autosave already covers saved text |
| Line-accurate jump to the selected row | the rendered DOM has no source-line map; this is a renderer change and is explicitly not part of this work. Every-match rows keep their line label as source information, not a promise that the click lands on that line |
| Expanding a note row to show all its hits | the "one per note" toggle is the way to see every hit; an expander needs a second request |
| Load more / paging in P1 | unique mode caps notes, default above most notebook sizes; a truncated summary tells the user to narrow |
| Sort direction controls | fixed directions cover the jobs; the server keeps `desc` for agents |
| A per-file cap control | keep the server default and disclose it; a knob is noise |
| Search-as-you-type off switch | always debounced; no half-typed-query flood |
| Telemetry or search analytics | none exists in this app |

## 9. Handoff: files, contract, and order

### 9.1 Files

| File | Change | Required |
|---|---|---|
| `app.py` (`search()`, constants near `MAX_TOTAL_MATCHES`) | `unique=1`; exact per-file `count`; order before file cap; `perFileTruncated` | yes |
| `static/js/api.js` | `search(q, opts)` with `{caseSensitive, unique, order, desc, …}`; old `(q, caseSensitive)` calls still work | yes |
| `static/js/activity.js` (`mountSearch`) | controls, row rendering, dedupe/display rules, sort, latest-wins, error paths, keyboard, open-error catch | yes |
| `static/js/app.js` | `DEFAULTS` + `NB.app` setters for `searchUnique`/`searchSort`; case sync to the top-bar checkbox; signal the loaded config; do not clobber a user change made before the first load | yes |
| `static/js/search.js` | latest-response-wins; read/emit the shared case; no unique/sort here | small |
| `static/css/style.css` | options row and result count/meta; mobile hit targets; focus rings | yes (with `ui-designer`) |
| `tests/test_app.py` (`TestSearch`) | contract tests AC4–AC12 | yes |
| `tests/dom/test_dom.js` | stub `/api/search` honours `unique`, `order`, `desc`, returns `count`/`perFileTruncated`; panel tests AC1–AC36 | yes |
| `agent.md` | document `unique=1`, the changed `limit` meaning, `count`, `perFileTruncated` | yes |
| `docs/contracts/http-api.md` | search table + response | yes |
| `docs/contracts/configuration.md`, `docs/architecture/frontend.md` | the two new config keys | yes |
| `docs/architecture/mobile.md` | remove the "panel Aa does not emit" note; the control now syncs | yes |
| `templates/index.html`, `static/sw.js` | no new script; no precache entry if the code stays in `activity.js` | no |

### 9.2 Server contract (additive; `unique` defaults off)

```
GET /api/search?q=…&unique=1
→ {query, matches: [{file, line, col, snippet, count}], truncated, perFileTruncated}
```

- One item per distinct relative path; `count` is the exact number of occurrences in that file, uncapped.
- `line`, `col`, `snippet` describe the first occurrence (lowest line, then lowest column); the snippet keeps `<<…>>`.
- `perFile` is ignored; `perFileTruncated` is `false`.
- `limit` is the maximum number of notes; default `MAX_TOTAL_MATCHES`, ceiling `MAX_TOTAL_MATCHES_CEILING`.
- Scan all candidates, order, then truncate to `limit`; `truncated` is true when more notes matched.
- Every other parameter (`q`, `case`, `regex`, `file`, `glob`, `order`, `desc`) keeps its meaning. Invalid input still returns the current 400/404 shapes.
- Without `unique=1`, the response is unchanged except the additive `perFileTruncated`, which is true when at least one file had more matches than `perFile`.
- `count` is present only with `unique=1`.

### 9.3 Implementation order

1. Server contract + `TestSearch` cases; update `agent.md` and `docs/contracts/http-api.md`.
2. `api.js` options object; update the jsdom search stub.
3. Panel controls and rendering; latest-wins; keyboard; open-error path.
4. Case sync and config load/save in `app.js` + `search.js`.
5. CSS with `ui-designer`; phone checks.
6. DOM tests and the frontend/backend docs.

### 9.4 Risks to watch

- Default unique ON changes the panel's current behaviour; it is the point of the request but is user-visible.
- Unique mode scans the whole candidate set to count exactly. For a single-user notebook this is fine; it is not free for a very large tree. The answer is narrowing (P2), not an index.
- Client and server ship together (one Flask process). No version skew is expected; the jsdom stub is the only other consumer and must be updated in the same change.
- The panel can mount before config loads. Do not let the late config undo a user change.
- A viewer cannot persist prefs (admin-only config POST). Session behaviour must still work, silently.

## 10. Assumptions and open questions

**Assumptions**

- A1 The notebook is small enough for a fresh scan per search; no index is added.
- A2 "Match" means one occurrence; two on a line count twice.
- A3 The panel is the "find the note" surface; the §search tab is the "find the line" surface and keeps per-hit results in P1.
- A4 The viewer role may search; search writes nothing.
- A5 Client and server deploy together; `unique` is additive and defaults off for other callers.
- A6 The existing caps (`MAX_TOTAL_MATCHES`, `MAX_MATCHES_PER_FILE`) remain the defaults; unique mode reinterprets `limit` as a note cap and ignores `perFile`.
- A7 No new script file is added; the panel stays in `activity.js`.
- A8 The phone drawer is the only search surface on a phone; the top bar is hidden there.

**Open questions**

- Q1 Confirm one-per-note is ON by default (it changes today's panel behaviour).
- Q2 Confirm unique/sort stay panel-only, with the §search tab unchanged in shape.
- Q3 Confirm the additive server change is acceptable; if not, the fallback is client-side dedupe with capped, approximate counts and the cap-budget limitation in §4.2.
- Q4 If P2 ships, which first: regex, current-note scope, or title search?
- Q5 Is losing the query on a 401 reload acceptable, or should the panel restore the last query for the session? (Current decision: not restored.)
