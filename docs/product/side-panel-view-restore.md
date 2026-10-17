# Active side-panel view restore and first paint — functional spec

Status: Implemented. Owner: `product-designer`.
Applies to: `static/js/activity.js`, `static/js/app.js`, `templates/index.html`,
`app.py` (`boot_state()` / `_render_index()`), `tests/dom/test_dom.js`,
`tests/test_app.py`.
Related: [configuration contract](../contracts/configuration.md),
[frontend architecture §7](../architecture/frontend.md).

## 1. Problem statement

The active side-panel view id is persisted to `config.json` under `activeView`
(`app.js:31-34`) and restored on boot from the config fetch
(`app.js:325-327`, `NB.activity.activate(cfg.activeView, false)`). The shell
that the server sends, however, always paints Explorer: `#sidebar` is the one
`.side-panel-view` without `hidden` (`index.html:129`, `144`, `150`, `156`,
`162`), and `activity.js` activates Explorer unconditionally at module load
(`activity.js:531`, `activate("explorer", false)`).

The config fetch is async (`app.js:616`), so on an authenticated reload whose
saved view is Bookmarks — or Recent, Search, or AI — the browser paints the
file tree first and then swaps to the saved view when the fetch resolves. The
user sees a "fake page" replaced by the real one.

The root cause is that one boot value (the active view) is left out of the
first-paint mechanism that already exists for theme, title, font size, pane
widths, collapse state, and wallpaper (`app.py:716-842`). Those are rendered
into the shell server-side precisely so the first frame matches the saved
config; the active view must join them.

This spec defines the intended UX and the acceptance criteria. It does not
choose the implementation; the observable behavior is the contract.

## 2. Goals

- **G1.** On an authenticated reload, the first painted frame already shows the
  saved active view. No Explorer frame precedes a Bookmarks/Recent/Search/AI
  frame.
- **G2.** A collapsed panel never paints expanded, and the saved view is the one
  revealed when the panel is re-expanded.
- **G3.** A slow or failed config fetch never blanks, resets, or swaps the side
  panel; the panel is usable as soon as the scripts are ready.
- **G4.** Restoration works across the auth reload (login → page reload) and
  never leaks the saved view on the unauthenticated login screen.
- **G5.** An unknown or removed view id falls back to Explorer silently, with no
  error and no empty panel.
- **G6.** Deep links (`?file=`) do not disturb the restored view; an explicit
  "Show in file sidebar" action still switches to Explorer.

## 3. Non-goals

- Changing how the active view is persisted, or the debounced config save.
- Changing view switching, the icon-toggle collapse behavior, or the per-view
  lazy-mount and state-preservation rules (`activity.js:29-34`).
- The activity bar's icons, labels, order, or look. This spec touches only which
  view is shown and which icon is marked active at boot.
- The graph view. It is an overlay driven from `#activity-graph-btn`, not an
  `NB.activity` view, and is not part of `activeView`.
- Adding a skeleton, spinner, or placeholder panel. See D2.
- The login modal's visual treatment. Only the view behind it is in scope.
- Any new runtime dependency, build step, or markup framework. Vanilla JS and
  the existing Jinja shell only.

## 4. Intended behavior — decisions

**D1. The first paint is the saved view.** The side panel's active view is part
of the first-paint chrome, like theme and pane widths. For an authenticated
request the shell is rendered with the saved view visible and every other view
hidden. The user never sees a view other than the saved one and then a swap.

**D2. No skeleton and no blank hold.** The correct value is known synchronously
at render time, so there is nothing to wait for and nothing to placehold.
Hiding the panel until the config fetch resolves would trade a wrong-view flash
for a blank-panel flash and delay an already-known result. "If you are waiting
for something, you don't need to render it" is satisfied by rendering the
right thing, not by rendering nothing.

**D3. The served shell is the single source of truth for the boot view.** The
boot view is the `data-view` of the one `.side-panel-view` host in the parsed
HTML that does not carry `hidden`. The activity module adopts that host on
load; it must not hard-code Explorer as the boot view when a host is already
visible. If no host is visible, or the visible host is not a registered view,
the module falls back to Explorer so the panel is never an empty pane with no
affordance.

**D4. The config fetch reconciles; it does not paint.** The panel is correct
before `GET /api/config` resolves. A slow fetch changes nothing about the
panel. A failed fetch leaves the side panel exactly as the shell rendered it —
same active view, same collapsed state, same width. It must not reset to
Explorer, expand a collapsed panel, or blank the panel. (This matches the
existing pattern: the shell already paints the fallback state, so a 401 from an
unauthenticated request converges to the same frame.)

**D5. Collapse is orthogonal to the active view.** Collapsing sets the panel
width to zero and adds `.collapsed`; it does not change which view is active.
The saved view stays the active view and stays the one revealed on re-expand.
At boot a collapsed shell must stay collapsed: the load-time activation may not
expand it.

**D6. Auth reuses the same path.** The login screen is served unauthenticated,
so the server paints the defaults and the saved view is not embedded
(`app.py:839`). After a successful login the page reloads (`auth.js:104`); that
reload is authenticated, so the shell paints the saved view and the first frame
is correct. No separate restore path is added.

**D7. Unknown ids fall back to Explorer, silently.** The server allowlists
`activeView` against the known view ids and substitutes `"explorer"` for
anything else. The client's `activate()` already no-ops on an unknown id
(`activity.js:91-92`). No toast, no dialog; a console warning is acceptable.

## 5. Boot contract

Exactly one `.side-panel-view` host is visible (no `hidden`) in the shell. Its
`data-view` is the boot view. The activity bar marks that view's icon active and
`aria-pressed="true"`; `NB.activity.getActive()` returns its id. All other hosts
carry `hidden` and their icons are not active.

The boot view is the result of allowlisting the saved `activeView`:

| Saved `activeView` | Boot view |
| --- | --- |
| `explorer` | `explorer` |
| `bookmarks` | `bookmarks` |
| `recent` | `recent` |
| `search` | `search` |
| `ai` | `ai` |
| missing, null, non-string | `explorer` |
| any other value | `explorer` |

The allowlist must equal the set of registered view ids in `activity.js` and
the set of `data-view` hosts in `templates/index.html`; a drift is a defect.

## 6. Functional flows

### 6.1 Authenticated reload — saved Bookmarks, expanded

1. Saved config: `activeView: "bookmarks"`, `sidebarCollapsed: false`.
2. The server renders the shell with `#bookmarks-view` visible, `#sidebar` and
   the other hosts `hidden`, the panel not collapsed, and its saved width.
3. First frame: the bookmarks view at the saved width; no file tree.
4. `activity.js` loads, registers the views, adopts the visible host as the
   active view, and marks the Bookmarks icon active. It does not switch to
   Explorer and emits no `activity:changed` for `explorer`.
5. `bookmarks.js` loads and populates the list inside the already-visible view.
6. `GET /api/config` resolves (`app.js:616`); `applyConfig` reconciles the
   already-active view. No change, no swap.
7. Result: no frame shows the file tree.

### 6.2 Authenticated reload — saved Bookmarks, collapsed

1. Saved config: `activeView: "bookmarks"`, `sidebarCollapsed: true`.
2. The server renders `#side-panel` with `class="collapsed"`,
   `--side-panel-width: 0`, `#bookmarks-view` visible inside, `#sidebar` hidden.
3. First frame: the activity bar only; panel width zero. The Bookmarks icon is
   active.
4. Load-time activation leaves the panel collapsed and does not set a non-zero
   width. `NB.activity.getActive()` is `bookmarks`.
5. The config fetch resolves; nothing about the panel changes.
6. The user clicks the Bookmarks icon: the panel expands and the bookmarks view
   is revealed. (Clicking the already-active icon expands a collapsed panel;
   `activity.js:96-105`.)
7. Result: the panel never paints open before settling collapsed, and the
   revealed view is the saved one.

### 6.3 Slow or failed config fetch

1. The shell has painted the saved view (per 6.1/6.2).
2. `GET /api/config` is slow: the panel is already correct and interactive. The
   user can switch views, read the tree/recents, and use the activity bar while
   the fetch is in flight. The app does not blank the panel, hide the icons, or
   overlay a loading state on it.
3. The fetch fails (network error, 500, or offline): `boot()`'s catch
   (`app.js:618`) must leave the side panel in the shell-rendered state — the
   same active view, the same collapsed state, the same width. It must not call
   `activate("explorer")` and must not clear `.collapsed`.
4. Offline service-worker fallback (`sw.js:115-127`) serves the last cached
   shell; the same rule applies: the panel keeps the cached shell's view.

### 6.4 Auth-gated reload

1. Auth is enabled and there is no session. The server renders defaults —
   Explorer visible, panel expanded (`app.py:835-839`). The login modal dims the
   UI (`auth.js:39`). The saved view is not embedded and not shown.
2. The user logs in; `auth.js:104` reloads the page.
3. The reload is authenticated, so the server paints the saved view
   (`app.py:840-841`). First frame is the saved view; no flash.
4. A later 401 on a gated read fires `auth:required`, which re-shows the modal
   (`auth.js:134-136`). It must not change the active view.

### 6.5 Unknown or removed view id

1. Saved `activeView: "gone"` (a view removed in a later version, or a
   hand-edited value).
2. The server allowlists it to `explorer`; the shell paints Explorer.
3. The client may also receive `"gone"` from `/api/config`; `activate("gone")`
   no-ops, leaving Explorer visible.
4. No toast, no dialog, no blank panel.

### 6.6 Deep link (`?file=` / `/<path>#<heading>`)

1. URL `/?file=Welcome.md` with saved `activeView: "bookmarks"`.
2. Boot restores Bookmarks in the panel. The deep link opens `Welcome.md` in a
   tab (`app.js:646-657`); it reads the tree from `NB.sidebar.getTree()`, which
   is independent of which view is visible.
3. The active view is still Bookmarks after boot. The deep link must not call
   `sidebar.revealFile()` and must not paint Explorer.
4. Reloading the deep-link URL serves the same shell boot state through the
   catch-all route (`app.py:2909`), so it is flash-free too.

### 6.7 "Show in file sidebar" from another view

1. While Bookmarks (or Search, Recent, AI) is active, the user picks **Show in
   file sidebar** (`bookmarks.js:292`).
2. `sidebar.revealFile()` activates Explorer and expands a collapsed panel
   (`sidebar.js:313-318`). This is a deliberate user action.
3. The panel switches to Explorer and `activeView` persists as `explorer`. This
   is expected, not a flash, and is out of scope for elimination.

## 7. Edge cases

| Case | Expected |
| --- | --- |
| No saved config (fresh install) | Explorer visible; all other hosts hidden. |
| `activeView` is a number, null, object, or empty string | Explorer. |
| `activeView` is a known id but the view's host is missing from the shell | Explorer is revealed so the panel is never empty with no affordance. |
| `activeView` is a known id but the client module failed to register it | Same as above: Explorer is revealed. |
| Shell collapsed and saved view is a lazily-mounted view (Recent/Search/AI) | Panel stays collapsed. The view mounts at boot even while collapsed, because `activity.js`'s `activate()` mounts regardless of the collapsed state; nothing is deferred until expand. This is pre-existing behavior. |
| Config fetch returns a different view than the shell (changed on the server while the tab was open) | One reconciliation switch after boot. The first paint still matched the shell snapshot, so this is a genuine config change, not a flash. |
| Whitespace or case in the id (`" Explorer "`, `"EXPLORER"`) | Not a match; Explorer. |
| Offline launch | Cached shell's view is kept; config failure does not change it. |
| Service worker serves the shell | Pages are network-first (`sw.js:112-127`), so an online reload gets a fresh shell. |
| The user has disabled JS | The shell still shows the saved view (correct), without icons. |

## 8. Acceptance criteria

Each criterion is tagged with the suite that can verify it: `[server]` =
`tests/test_app.py`, `[dom]` = `tests/dom/test_dom.js`. Every `[dom]` criterion
must be checkable by loading the real `activity.js`/`app.js` into jsdom with the
fetch stub, following the existing harness conventions
(`docs/testing/frontend.md`).

### A. Server first paint — `[server]`

- AC1. With saved `activeView: "bookmarks"`, `GET /` returns HTML in which
  `#bookmarks-view` has no `hidden` attribute and `#sidebar` carries `hidden`.
  All other `.side-panel-view` hosts carry `hidden`.
- AC2. With saved `activeView: "explorer"`, or with no `activeView` key, `GET /`
  returns `#sidebar` without `hidden` and all other hosts hidden.
- AC3. For each of `recent`, `search`, `ai`, `GET /` returns the matching host
  without `hidden` and all other hosts hidden.
- AC4. With an unknown value (`"gone"`) or a non-string (`42`, `null`), `GET /`
  returns `#sidebar` visible and all other hosts hidden; no error status.
- AC5. With `activeView: "bookmarks"` and `sidebarCollapsed: true`, `GET /`
  returns `#side-panel` with the `collapsed` class, `--side-panel-width: 0`, the
  Bookmarks icon state renderable as active, `#bookmarks-view` visible, and
  `#sidebar` hidden.
- AC6. The catch-all route (e.g. `GET /Welcome.md`) renders the same active-view
  markup as `GET /` for the same config.
- AC7. With auth on and no session, `GET /` paints Explorer (defaults) and does
  not expose the saved view id in the shell; after login, `GET /` paints the
  saved view.
- AC8. `boot_state()` allowlists `activeView` against exactly the set of view
  ids registered by `activity.js` and present as `data-view` hosts in
  `templates/index.html`; a mismatch fails the test. The allowlist never emits
  an unvalidated string into the shell.

### B. No wrong-view transition at boot — `[dom]`

- AC9. Given a shell whose only visible host is `bookmarks`, loading
  `activity.js` leaves `NB.activity.getActive() === "bookmarks"`,
  `#bookmarks-view` visible, and `#sidebar` hidden. The load-time activation
  adopts the shell view; it does not call `activate("explorer", false)`.
- AC10. In that same boot, no `activity:changed` event with `id === "explorer"`
  is emitted before the config fetch resolves.
- AC11. With the fetch stub returning `activeView: "bookmarks"` and the shell
  already showing Bookmarks, after boot resolves the active view is unchanged
  and no additional `activity:changed` swap occurs.
- AC12. The `data-view` of the visible host in the shell drives the active icon:
  after load exactly one `.activity-btn[data-view]` carries `active` and
  `aria-pressed="true"`, and its `data-view` equals the visible host's id.
- AC13. With a shell whose visible host is not a registered view, the module
  reveals Explorer (or leaves no empty visible host) so the panel is not blank;
  no uncaught error is logged.

### C. Collapsed panel — `[dom]`

- AC14. Given a shell with `#side-panel.collapsed` and `--side-panel-width: 0`
  and Bookmarks visible, the load-time activation leaves `.collapsed` in place
  and does not set a non-zero `--side-panel-width`.
- AC15. In that state `NB.activity.getActive() === "bookmarks"`, and clicking
  the Bookmarks icon expands the panel and reveals `#bookmarks-view`.
- AC16. Extends the existing regression at `test_dom.js:24534-24565`: a
  non-toggle `activate()` never expands a collapsed panel, and an icon click
  still expands and restores the saved width.

### D. Slow and failed config — `[dom]`

- AC17. While the config fetch promise is pending (unresolved), the active view
  equals the shell-rendered view and the panel is not blanked or hidden. The
  test asserts this synchronously after `DOMContentLoaded` without awaiting the
  fetch.
- AC18. With `GET /api/config` rejecting, after boot the active view, the
  `.collapsed` class, and `--side-panel-width` equal the shell-rendered values;
  the panel did not reset to Explorer and did not expand.
- AC19. A failed fetch surfaces no modal or error dialog for the side panel and
  leaves the activity bar icons present and clickable.

### E. Auth-gated reload — `[server]` + `[dom]`

- AC20. `[server]` With auth on and no session, the shell paints Explorer and
  the saved view id does not appear in the HTML (extends
  `test_app.py:162-198`). After login, the shell paints the saved view.
- AC21. `[dom]` A `401` from a gated read (the `auth:required` path) re-shows the
  login modal without changing the active view or the collapsed state.

### F. Unknown id — `[dom]`

- AC22. With the fetch stub returning `activeView: "gone"` and the shell showing
  Explorer, after boot `NB.activity.getActive() === "explorer"`, `#sidebar` is
  visible, and no toast or `alert` fires.
- AC23. Calling `NB.activity.activate("gone", false)` with an unknown id changes
  nothing and throws nothing (`activity.js:91-92`).

### G. Deep link and revealFile — `[dom]`

- AC24. With shell/fetch `activeView: "bookmarks"` and a `?file=Welcome.md`
  deep link, after boot the active view is still `bookmarks` and `#sidebar` is
  hidden; the deep-linked file is the active tab.
- AC25. A deep link does not emit `activity:changed` with `id === "explorer"`.
- AC26. `NB.sidebar.revealFile(path)` from the Bookmarks view activates Explorer,
  expands a collapsed panel, and persists `activeView: "explorer"` through the
  existing debounced save.

### H. Contract sync — `[server]` + `[dom]`

- AC27. `[server]` The `boot_state()` allowlist equals the registered view ids
  and the `data-view` host set (AC8).
- AC28. `[dom]` `templates/index.html` renders the `hidden` attribute on every
  `.side-panel-view` conditionally on the boot view, and the existing
  first-paint boot-state block (`test_dom.js:24495-24532`) is extended to assert
  the active-view markup is rendered server-side.
- AC29. `[server]` `docs/contracts/configuration.md` documents `activeView` with
  its allowed values and its first-paint treatment.

### I. Non-regression — `[dom]` + `[server]`

- AC30. `[dom]` All existing activity/view tests still pass unchanged: view
  switching, icon toggle collapse, per-view collapse buttons, bookmarks view,
  recent view, AI mount/collapse, and the active-view persistence checks
  (`test_dom.js:13840-13913`).
- AC31. `[server]` The existing first-paint tests still pass, and
  `test_boot_state_does_not_leak_content` (`test_app.py:144-160`) still holds:
  `activeView` is a view id, never content-bearing.
- AC32. The full suites pass: `node tests/dom/test_dom.js` and
  `.venv_$(hostname)/bin/python -m unittest discover -s tests -v`.

## 9. Decisions and open questions

Accepted decisions: D1–D7 above.

Resolved during implementation:

- Q1 (multi-tab divergence). One reconciliation switch is accepted, but only
  when the user has not switched the view themselves while the fetch was in
  flight. `resolveBootView()` (`app.js`) activates the fetched view only when
  it differs from the shell view AND the panel still shows the shell view; a
  slow fetch therefore never yanks a view the user just chose. A failed fetch
  never reconciles.

Still open (out of scope for this spec):

- Q2. Should a failed config fetch preserve the entire shell-rendered chrome
  (theme, font, widths), not just the side panel? This spec requires only the
  side panel. `boot()`'s failed-fetch path now restores the side panel and
  outline pane (collapse state, and widths where the shell exposes a non-zero
  value) from the DOM; theme, font, and wallpaper still fall back to
  `DEFAULTS`. The broader behavior is a separate contract question.

## 10. Non-hard-coded values

Names and locations, not literals: the config key `activeView` and its default
live in `app.js:31-34`; the view-id set lives in `activity.js`'s
`NB.activity.register()` calls; the boot allowlist must be derived from, or
kept in sync with, that set rather than duplicated as an unrelated literal.
No new numeric constant is introduced by this spec.

## 11. Assumptions

- A1. The active view remains a single id, not a per-view history.
- A2. The existing first-paint mechanism (`boot_state()` / `_render_index()`,
  `app.py:754-842`) is the intended home for boot chrome; the active view joins
  it rather than adding a new mechanism.
- A3. `activity.js` remains the owner of the view registry and the boot
  adoption; `app.js` remains the owner of config load and reconciliation.
- A4. Service-worker page handling stays network-first (`sw.js:112-127`); this
  spec does not change caching.
