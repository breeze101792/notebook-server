# Search gap analysis — daily-use audit

Status: analysis for review. Owner: `product-designer`.
Applies to: the side-panel Search (`static/js/activity.js`, `mountSearch`),
`/api/search` (`app.py`), the viewer jump (`static/js/viewer.js`), the search
prefs (`static/js/app.js`), and the tests and contracts named below.
Related: [search options](search-options.md) is the current spec; the
[HTTP API](../contracts/http-api.md) and [configuration](../contracts/configuration.md)
own the wire and config contracts. This document is the audit and the next-step
definition; it does not choose the implementation.

## 1. Verdict

Search is not missing a query language. It is missing the last step of the two
jobs the user named: **find the note** and **find the line**.

The three changes that would change daily use:

1. Clicking a result must open the note at *that* occurrence, and the highlight
   must be transient.
2. The search must be scoped to a folder or the current note.
3. The keyboard search chord must open the side-panel Search, and a zero-result
   search must offer the other target instead of a dead end.

Everything else is later or rejected. The base is solid: one row per note, exact
counts, honest caps, latest-response-wins, keyboard navigation, phone drawer, and
inline recovery. Do not rebuild it.

## 2. What I checked

- Read the current spec and the code. The code is ahead of the spec in three
  places: filename search (`name=1` + `searchTarget`) shipped although
  `search-options.md` lists it as P2; the grouping control is a radio pair
  (`All matches` / `One per note`), not the checkbox the spec describes; and
  `searchTarget` is persisted but missing from the spec's config table. Update
  `search-options.md` in the same change as any feature below.
- Did not run tests or edit source. This is a product audit.
- No index is assumed. The notebook is small enough for a fresh scan; performance
  is not a proven problem (§4 G14–G15, §5).

## 3. User jobs, ranked

| Rank | Job | How today's search serves it | Verdict |
|---|---|---|---|
| 1 | "Find the note I mean" by a word, phrase, or title | Side panel: one row per note, exact count, first snippet. Content and File name are separate modes. No folder scope. | Good, with friction |
| 2 | "Find the line I mean" inside a known note | Every-match rows show `line N`, but a click marks the first rendered occurrence, not the selected one. Marks accumulate. | Weak |
| 3 | "Narrow to where I know it is" (folder, current note, recently modified) | Recently modified sort exists. Folder and current-note scope do not, although `glob=` and `file=` are supported server-side. | Missing |
| 4 | "Be precise when a word is common" (case, whole word, regex) | Case exists. Matching is a literal substring. Regex is server-side but has no UI. No whole-word. | Partial |
| 5 | "See enough context to choose the right note" | Unique mode shows only the first occurrence. All matches floods and loses the one-row-per-note view. | Partial |
| 6 | "Search from the keyboard or phone" | Panel keyboard and phone drawer are good. The global chord opens the panel. | Good |
| 7 | "Trust the result set" | Caps are disclosed, latest-response-wins, open failures recover inline. Search can return files in dot-directories that the tree hides. | Good, one leak |

### Already good — do not rebuild

- **Keyboard and screen reader.** The result list is a roving-focus listbox with
  `aria-selected`; the summary is a polite live region; an error is an alert;
  Enter/arrows/Esc work. No new semantics are needed for G1–G4.
- **Phone.** The drawer is the only search surface, the controls wrap, and a tap
  closes the drawer and opens the note. F2 adds the only missing phone job
  (current-note scope).
- **Empty / idle.** An empty query is Idle; the input placeholder and the
  visible target/group controls are the guidance. F3 adds the one missing
  zero-result action.
- **Caps and lifecycle.** `truncated` / `perFileTruncated` are disclosed,
  latest-response-wins is implemented, and a failed open recovers inline. These
  are strengths; the gaps above do not require reworking them.

## 4. Gap table

Recommendation values: **do next** (this phase), **later** (a real gap, not now),
**reject** (deliberately not doing). Phase follows the same P1/P2/P3 language as
`search-options.md`; "Now" is the next implementation slice.

| # | Job | Missing capability | Why it matters | Recommendation | Risk or cost | Phase |
|---|---|---|---|---|---|---|
| G1 | Find the line | A result click marks the first rendered occurrence, not the selected one. Old `.search-highlight` marks are never cleared. A mark can survive into hybrid edit mode. | The rank-2 job is "where in this note"; the `line N` label is a promise the click does not keep. Repeated clicks leave several marks. A mark inside the editable DOM can reach a save, breaking the read-only guarantee. | **do next** | Add `occ` server-side and a client jump by ordinal. Some source matches (link URLs, front matter) do not render, so the ordinal can drift; fall back to the first visible occurrence. | Now |
| G2 | Trust | Search walks dot-directories; the tree and `/api/ls` hide them. | A `.trash` or tool folder can put notes in results that the user cannot see or open from the tree. | **do next** (small) | One prune in `_iter_search_targets`; no result-shape change. | Now |
| G3 | Find the note / line | No folder scope and no current-note scope in the panel. `glob=` and `file=` already work. | A common word becomes unusable in a growing notebook. Folder is the natural scope; current-note scope is the phone's only "find in note". | **do next** | UI state and a scope chip; `api.js` passes `glob`/`file`; folder menu and tab menu entries; a 404 branch for a scoped note; `fnmatch` metacharacters in folder names. | Now |
| G4 | Find the note | The global search chord focuses the top-bar input and opens the flat §search tab, bypassing the richer panel. Content and File name are mutually exclusive, so a wrong mode returns zero. | The fastest path leads to the weaker surface. Users may never discover one-per-note or sort. A zero result in the wrong mode looks like "no such note". | **done** | The chord now activates the side-panel Search (normal and VIM); the top-bar input and `§search` tab were removed. The zero-result fallback switches target. | Done |
| G5 | Find the note | No combined filename + content query. | Rejected: a fallback button (G4) removes the dead end without merging two result shapes or two scans. | **reject** | Two scans or a new server mode; ambiguous ordering between name and content hits. | — |
| G6 | Precision | No regex UI and no whole-word. `Aa` is the only precision control. | Embedded identifiers and acronyms collide (`SPI` vs `SPIFFS`). Literal substring returns noise. | **later** | A toggle, an invalid-pattern state, docs, and the jump term must be the matched text, not the pattern. Regex is already server-side; whole-word is the smaller first step. | P2 |
| G7 | Context | Unique mode shows only the first occurrence; there is no expander. Seeing other hits means switching to All matches, which loses the note overview. | The first source occurrence can be a passing mention. The user needs a second look without changing modes. | **later** | One `file=` request per expanded row, or a `snippets=N` server option. Reopens a §8 non-goal; needs confirmation. | P2 |
| G8 | Context | Snippets are one line (`SNIPPET_PAD` = 60 characters each side). A phrase that crosses a newline cannot match. | Hard-wrapped prose and code/log excerpts can hide the exact wording. Long lines are clipped. | **later** | Server scan must move from per-line to whole-text; snippet and `line` semantics change. No evidence yet that hard-wrapped prose is a daily failure. | P3 |
| G9 | Find the note | No title/heading-aware ordering. "Most matches" can rank a passing-mention note above the note about the term. | In a growing notebook, the note whose title or heading matches is usually the one wanted. | **later** | Parse headings or add a deterministic title/heading-first order. No relevance model. | P2 |
| G10 | Find the line | No separate in-note find bar. | Rejected as a separate UI: native Ctrl+F covers desktop reading; current-note scope (G3) covers the phone. A custom bar duplicates next/prev/highlight-all. | **reject** | New key handling and source/WYSIWYG differences for no new job. | — |
| G11 | Find the note | No tag search. | Rejected: there is no tag model. Adding tags is a separate product feature, not a search gap. Hashtags already match as literal text. | **reject** | A tag syntax, parsing, storage, and UI. | — |
| G12 | Find the note | No backlink/wikilink search mode. | Rejected: the graph view owns backlinks; content search already matches the raw `[[Target]]` text. | **reject** | A link index for a job the graph already serves. | — |
| G13 | Result actions | No context menu on result rows for copy path/link or reveal in tree. | The tab menu already has these after one click. Low daily value for a single user. | **reject** (for now) | Menu wiring only, but no job is blocked. | — |
| G14 | Scale | No "load more" when `truncated`. | Only matters if broad queries hit the note cap. The intended path is narrowing (G3), not paging. | **later** | Offset contract and stable ordering; only with evidence that truncation recurs. | P3 |
| G15 | Scale | No full-text index. | Rejected: invalidation against the watcher and autosave costs more than a fresh scan of a small notebook. | **reject** | Measure first; an index is a separate design. | — |
| G16 | Reuse | No saved searches, history, or pinned queries. | Rejected: a single user can retype a short query; storage and UI are not worth the maintenance. | **reject** | A second persistence surface. | — |
| G17 | Scope | No search of attachments, images, or non-Markdown files. | Rejected: `/api/search` is `.md`-only; attachments are not notes. | **reject** | A different extractor and result shape. | — |
| G18 | Draft | No search of the unsaved editor buffer. | Rejected: the server is the source of truth; autosave covers saved text (5 s idle, 60 s max dirty). Results would otherwise depend on edit state. | **reject** | A client-side second search path that can disagree with the server. | — |
| G19 | Query | No fuzzy, stemming, or semantic search. | Rejected: unpredictable ranking and cost; the user knows his own words. | **reject** | Relevance model and tuning. | — |
| G20 | Query | No boolean/AND/OR/NOT. | Rejected as a query language. A single "All words" checkbox is the only later candidate, and only with evidence that multi-word queries fail. | **reject** (language) / later (one toggle) | Snippet and count semantics for multiple terms. | — |
| G21 | Ordering | No asc/desc control. | Rejected: the three fixed directions cover the jobs; the server keeps `desc` for agents. | **reject** | A second control for no job. | — |
| G22 | Caps | No per-file cap knob. | Rejected: keep the server default (`MAX_MATCHES_PER_FILE`) and disclose the cap. | **reject** | A knob is noise. | — |
| G23 | Mutation | No cross-note replace, bulk edit, or rename from results. | Rejected: destructive; search stays read-only. | **reject** | Write paths and confirmations. | — |

## 5. Deliberately not doing

One line each; the reasons are the product decision, not an implementation gap.

- **Combined filename + content results** — the zero-result fallback removes the dead end without merging two scans.
- **Saved searches, history, pinned queries** — short queries; storage and UI for one user.
- **Full-text index or cache** — invalidation against the watcher and autosave costs more than a fresh scan; measure before designing one.
- **Boolean operators and quoted-phrase syntax** — a second query language needs docs and errors; the literal substring is predictable; regex is the planned precision path.
- **Fuzzy, stemming, semantic** — unpredictable ranking and cost.
- **Tag search** — no tag model exists; tags would be a separate feature.
- **Backlink/wikilink search** — the graph view owns backlinks; content search already sees the raw link text.
- **Attachments, images, non-Markdown** — the endpoint is `.md`-only.
- **Unsaved editor buffer** — the server is the source of truth; autosave covers saved text.
- **A separate in-note find bar** — native find plus current-note scope cover the job.
- **Cross-note replace, rename from results** — destructive; search is read-only.
- **Sort direction control** — fixed directions cover the jobs.
- **Per-file cap knob** — keep the default and disclose it.
- **Search-as-you-type off switch** — always debounced; no half-typed flood.
- **Telemetry or search analytics** — none exists in this app.
- **Result-row context menu** — the tab menu already has copy path/link and reveal after one click.
- **Open in a new/background tab** — the app opens a tab; there is no split view.
- **Paging now** — only if truncation recurs in real use.
- **Multi-line/phrase now** — changes the snippet and line contract; no evidence yet.
- **Title/heading ranking now** — needs heading parsing and a new order; scope plus a distinctive word solves most cases.

## 6. Next 1–3 features

### F1. Open the selected occurrence; keep the highlight transient

**User goal.** "I found the line; take me to that line, not the first time the
word appears."

**Behaviour.**

- Each content match carries an occurrence ordinal in its file. Add `occ`
  (0-based) to every item in every-match mode; unique mode returns `occ: 0` for
  its one item. The client uses `occ` when present and otherwise counts prior
  same-file rows.
- `NB.viewer.jumpToOccurrence(term, caseSensitive, occ)` marks the matching
  visible occurrence. `jumpToMatch(term, caseSensitive)` remains as
  `jumpToOccurrence(..., 0)`.
- Before marking, clear every existing `.search-highlight` mark by unwrapping it
  and normalising the parent text. Exactly one mark remains.
- If `occ` is beyond the visible occurrences (a source match in a link URL or
  front matter), fall back to the first visible occurrence; never throw.
- In hybrid edit mode, do not wrap text. Clear marks on `hybrid:will-enter`;
  scroll/select the occurrence without inserting an element. A save must never
  contain a search mark.

**Acceptance criteria.** [B] = backend unittest, [D] = jsdom, [H] = manual.

- F1-AC1 [B] `GET /api/search?q=needle` on a note with three occurrences returns
  `occ` 0, 1, 2 in source order; `unique=1` returns `occ: 0` and `count: 3`.
- F1-AC2 [D] In every-match mode, clicking row 3 marks the third visible
  occurrence; exactly one `.search-highlight` exists and its text is `needle`.
- F1-AC3 [D] Clicking row 1 after row 3 removes the old mark; exactly one mark
  remains; the note text is unchanged.
- F1-AC4 [D] In unique mode, clicking the row marks the first visible
  occurrence and leaves exactly one mark.
- F1-AC5 [D] If the requested ordinal has no visible occurrence, the click opens
  the note, leaves at most one mark, and throws nothing.
- F1-AC6 [D] Entering hybrid edit mode clears all search marks; a save after
  that contains no `search-highlight` and no search-inserted `<mark>`.
- F1-AC8 [H] On a long note, the marked line is in view after the click.

**Files / endpoints.** `app.py` (`_search_match_item`, the every-match and
unique loops, `search()`), `static/js/api.js` (pass `occ` through),
`static/js/activity.js` (`openHit`), `static/js/viewer.js`
(`jumpToOccurrence`, clear marks, `hybrid:will-enter` hook),
`tests/test_app.py` (`TestSearch`), `tests/dom/test_dom.js` (side-panel search
block), `docs/contracts/http-api.md` (add `occ`).

**Risk.** Source matches that do not render can shift the ordinal; the fallback
is deliberately loose. The edit-mode rule is the important one: search must not
add anything that can be saved.

### F2. Scope the search to a folder or the current note

**User goal.** "I know it is in this project folder (or in this note); stop
showing me the rest of the notebook."

**Behaviour.**

- Folder entry: the folder context menu gets **Search in this folder**. It
  activates the side-panel Search view, expands a collapsed panel, focuses the
  query, and sets a scope chip reading `in <folder>` (full path in `title`).
- Note entry: the open-note tab menu gets **Search in this note**. It sets a chip
  reading `in <basename>` (full path in `title`). With no note open, the action
  is absent or disabled.
- The panel sends `glob=<folder>/*` for folder scope and `file=<path>` for note
  scope; both are existing server parameters. The chip's clear button re-runs
  the current query with no scope.
- Scope is panel memory only: it survives view switches and is lost on reload.
- A scoped note that has vanished returns 404. The panel shows
  `This note no longer exists` and a **Search all notes** action; it does not
  silently fall back. `api.js` must expose the HTTP status on the thrown error
  so the panel can tell 404 from a transport failure.
- A scoped search with zero results offers **Search all notes**; it does not
  leave the user stuck in an empty folder.

**Acceptance criteria.**

- F2-AC1 [D] Folder menu → **Search in this folder** activates Search, shows the
  chip `in notes`, focuses the input, and sends `glob=notes/*`; only paths under
  `notes/` are returned.
- F2-AC2 [D] Clearing the chip re-runs the query with no `glob`; all-notes
  results return.
- F2-AC3 [D] Tab menu → **Search in this note** shows the chip `in <basename>`
  and sends `file=<path>`; only that note's matches appear.
- F2-AC4 [D] A 404 for the scoped note shows `This note no longer exists` plus
  **Search all notes**; clicking clears the scope and re-runs once; no alert; no
  silent all-notes result.
- F2-AC5 [D] With no note open, **Search in this note** is absent or disabled;
  **Search in this folder** is available.
- F2-AC6 [D] Switching views keeps the scope; a reload starts at All notes.
- F2-AC7 [H] On the phone drawer, the chip and clear control meet the mobile hit
  target, and a scoped search does not scroll the page sideways.
- F2-AC8 [D] Searching a folder with `name=1` works; the name request carries
  the same `glob`.

**Files / endpoints.** `static/js/activity.js` (scope state, chip, request
params, 404 and empty states), `static/js/api.js` (`glob`/`file` params, error
`status`), `static/js/sidebar.js` (`treeFolderMenuItems`), `static/js/tabs.js`
(tab menu), `tests/dom/test_dom.js`, `tests/test_app.py` (glob/file already
tested; add the scope combinations), `docs/contracts/http-api.md` (already
documents both params; confirm the folder glob example), `docs/product/search-options.md`
(mark S9/S10 as shipped or re-phase).

**Risk.** `fnmatch` treats `[`, `?`, and `*` in a folder name as pattern syntax;
rare, but state the limitation or add an exact `folder=` prefix parameter if it
matters. A dirty note is searched as saved, not as edited; do not force a save
from search.

### F3. One search entry point; no wrong-mode dead end

**User goal.** "Press search, get the good search; if nothing is found, try the
other kind of match without retyping."

**Behaviour.**

- The global `openSearch` chord (default `/`, rebindable) activates the
  side-panel Search view, expands a collapsed panel, and focuses the panel's
  input. It sends no request.
- The VIM `/` binding does the same. There is no top-bar search input; the
  side-panel Search is the only search surface.
- With a content query that returns zero, the empty state shows **No matches
  found.** and a **Search file names** button. Clicking keeps the query, sets
  the target to File name, persists the target, and runs one name search.
- With a name query that returns zero, the empty state shows **Search content**;
  clicking clears the name mode and runs one content search.
- If the search is scoped and empty, **Search all notes** (F2) is the primary
  action; the target fallback may also show.
- The fallback button is keyboard reachable and is absent while the query is
  empty.

**Acceptance criteria.**

- F3-AC1 [D] In non-VIM mode, the `openSearch` chord from Explorer activates
  Search, expands a collapsed panel, focuses `.search-panel-input`, and sends no
  `/api/search` request.
- F3-AC2 [D] In VIM mode, `/` does the same; no top-bar input exists to focus.
- F3-AC3 [D] A zero-result content search shows **Search file names**; clicking
  keeps the query, checks the File name radio, persists `searchTarget: "name"`,
  and sends exactly one `name=1` request.
- F3-AC4 [D] A zero-result name search shows **Search content**; clicking sends
  exactly one request without `name`, with the query unchanged.
- F3-AC5 [D] The fallback button is reachable by Tab/Enter and is not shown in
  the idle state.
- F3-AC6 [D] The top-bar search input and `§search` tab are gone; no route or
  shortcut creates them.
- F3-AC7 [H] A rebound chord behaves the same; the phone Search rail still opens
  the drawer.

**Files / endpoints.** `static/js/app.js` (`openSearch` handler),
`static/js/vimnav.js` (`/` binding), `static/js/activity.js` (activation/focus,
empty-state button), `tests/dom/test_dom.js`, `static/js/shortcuts.js`
(comment/label only if needed). No endpoint change.

**Risk.** Shipped: the shortcut now opens the side-panel Search; the top bar
and `§search` tab were removed.

## 7. Needs confirmation

- **Q1.** Resolved: the global search chord opens the side-panel Search; the
  top-bar input and `§search` tab were removed.
- **Q2.** Is a later per-note expander (show the other hits without leaving
  unique mode) worth doing? It reopens a §8 non-goal; the cost is one `file=`
  request per expanded row.
- **Q3.** Has truncation (more than `MAX_TOTAL_MATCHES` notes) actually happened
  in real use? If yes, paging is justified; if no, keep "narrow" as the answer.
- **Q4.** Should folder/note scope last only for the session, or be remembered
  across reload? Recommended session only; a sticky scope can silently hide a
  note.
- **Q5.** For precision, which comes first: a whole-word toggle or full regex?
  Recommended whole-word first; it covers identifiers without a syntax-error
  state. Full regex follows with the invalid-pattern treatment in
  `search-options.md` §7.

## 8. Assumptions

- A1. The notebook is small enough for a fresh scan per search; no index is
  added. Measure before changing this.
- A2. The side panel is the single search surface; the keyboard chord opens it.
- A3. Client and server ship together; additive response fields (`occ`) are
  acceptable.
- A4. Scope is panel-only; there is no top bar.
- A5. No new numeric constants. Reuse `SNIPPET_PAD`, `MAX_TOTAL_MATCHES`,
  `MAX_MATCHES_PER_FILE`, and their ceilings from `app.py`.
- A6. `search-options.md` is stale in the ways listed in §2; update it with the
  implementation rather than adding a second spec.

## 9. Suggested handoff order

1. **F1** — server `occ`, viewer `jumpToOccurrence`/clear, panel caller, tests.
   This is the largest daily win.
2. **F2** — scope state and chip, folder and note entries, `api.js` params and
   error status, 404/empty states, tests.
3. **F3** — shortcut handlers (normal and VIM), empty-state target fallback,
   tests. This can ship alone as a quick win.
4. **G2** — prune dot-directories in `_iter_search_targets`; one small test that
   search and `/api/tree` agree on hidden paths.
5. Update `docs/contracts/http-api.md` (`occ`), `docs/product/search-options.md`
   (shipped filename mode, `searchTarget`, phase changes), and the relevant
   `docs/contracts/configuration.md` row only if a scope key is ever persisted
   (it is not in this plan).
