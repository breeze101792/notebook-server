# Mobile v1 architecture (read + drawer + search + quick capture)

Status: implemented (mobile v1), design record.
Applies to: `templates/index.html`, `static/css/style.css`, `static/js/{app,viewer,sidebar,api,auth,mobile}.js`, `static/sw.js`, `tests/dom/test_dom.js`, `tests/browser/`.
Behaviour spec: [`../product/mobile.md`](../product/mobile.md); device facts: [`../research/mobile-support.md`](../research/mobile-support.md).
Decided upstream: no framework/bundler, no native shell, no TLS (plain HTTP on the LAN), desktop must not regress. Editing was deferred from v1 and shipped as the v2 addendum in §13.

## 1. Goal

One web app, one codebase. At phone widths the four-column shell becomes a reader column with a bottom rail, an off-canvas drawer for the existing side-panel views (Explorer, Recent, Search, Bookmarks), a Home list, and one capture sheet. Desktop is byte-for-byte unchanged at the desktop breakpoint (spec C4).

### Non-goals (v1)

| Cut | Reason |
| --- | --- |
| Source (CM6) editing, tabs UI, TOC, lightbox, AI, export, graph, offline cache | spec §2.2; WYSIWYG editing shipped in §13. Drag-reorder gestures stay desktop-only (`mousedown`/`mousemove`, `hybrid.js`) |
| Per-device theme/text size | theme/fontSize stay server-wide prefs; only Continue and the draft are device-local (spec M6.2) |
| Long-press menus | iOS never fires `contextmenu` (research §3.1); the `…` button is the one entry (spec §4.0.3) |
| Server changes | none required (§5, §7) |

## 2. Mode signal

**The mode is decided in CSS once; JS reads the resulting token.** The design
handoff (`../design/mobile-shell.md` §2) owns the reasoning; the contract is:

```css
:root { --ui-mode: desktop; }

@media (max-width: 860px),
       ((pointer: coarse) and (max-width: 1023px)) {
  :root { --ui-mode: phone; }
  /* the phone layout block lives here */
}
```

```js
function isOn() {
  return (getComputedStyle(document.documentElement)
    .getPropertyValue("--ui-mode").trim() ||
    document.documentElement.dataset.uiMode) === "phone";
}
```

- **Why the two arms.** A width-only query flips an iPhone Pro Max in landscape
  (~932 CSS px) back to the desktop shell; `(pointer: coarse)` is what separates
  that phone from a 932 px desktop window. The width arm also gives a narrow
  desktop window the phone shell, which spec A4 accepts.
- **One source of truth.** The query string appears only in `style.css`. JS never
  repeats it: `mobile.js` reads the token and mirrors it to
  `html[data-ui-mode]` on boot and on `resize` (throttled), so modules and tests
  read one attribute. Tests set `dataset.uiMode` directly; the token is empty
  when `style.css` is not applied in jsdom.
- **No inline boot snippet.** Because the rules are inside the media query, the
  layout is correct at first paint; there is no class to add before paint and no
  desktop flash on a phone.
- **No `change` listener needed for layout.** CSS re-evaluates on rotation. JS
  only needs the mirror refreshed, so `resize` is enough.
- **Rotation.** Phone portrait↔landscape stays inside the phone range (coarse,
  <1024), so the drawer, scroll, and draft survive (spec edge case). Crossing
  1024 on an iPad flips the shell; accepted under A4.
- **iPad.** Portrait iPads up to 1023 px are coarse → phone shell. iPad Pro 12.9
  and landscape iPads (≥1024) stay on the desktop shell.

## 3. Layout mechanics

Before v1: `#layout` was a four-column grid, `var(--activity-bar-width) var(--side-panel-width) 1fr var(--outline-width)` (`style.css`); at 390 px the fixed columns left the reader 0 px (research §2.2).

```
desktop: [ rail 48 | panel var | reader 1fr | outline var ]
phone:   [ reader, full width ]            #side-panel is a fixed drawer
         [ bottom rail 56 + inset ]        #activity-bar leaves the grid
```

All phone rules sit inside the §2 media query, appended as one section at the
end of `style.css` (the file's only existing `max-width` query is the
designer's, `style.css`):

| Rule | Purpose |
| --- | --- |
| `#layout { display: block; position: relative; }` | one column; the grid columns are gone (`style.css`) |
| `#editor-pane { height: 100%; }` | reader fills the space above the rail |
| `#outline-pane, #tab-bar { display: none; }` | outline and tabs not in v1; `#outline-toggle` inside the strip (`index.html`) is dead, fine |
| `#activity-bar { position: fixed; left: 0; right: 0; bottom: 0; height: calc(56px + env(safe-area-inset-bottom)); flex-direction: row; z-index: 150; }` | the rail becomes a bottom bar; `.activity-btn` stretches to `flex: 1 1 0; height: 56px` |
| `#side-panel { position: fixed; top: 0; bottom: 0; left: 0; width: min(86vw, 340px); z-index: 410; transform: translateX(-100%); visibility: hidden; }` + `body.drawer-open #side-panel { transform: none; visibility: visible; }` | the drawer. Width deliberately does NOT read `--side-panel-width`, so desktop width writes stay irrelevant |
| `#drawer-scrim { position: fixed; inset: 0; z-index: 400; }` | built by `mobile.js`, hidden unless `body.drawer-open` |
| `#side-panel.collapsed .side-panel-view:not([hidden]) { display: flex; }`, `.resize-handle { display: none; }` | neutralize desktop collapse chrome: boot may paint `.collapsed` from server config (`index.html`, `style.css`); the drawer must not inherit desktop collapse state |
| `body.topbar-hidden #topbar { display: flex; }` | wins on specificity ((1,1,0) + element) against `body.topbar-hidden #topbar` (`style.css`); the phone keeps the back button even when the desktop hid the bar |

State: `html[data-ui-mode]` (mirror, for JS/tests), `body.drawer-open` (drawer),
`body.capture-open` (sheet), `.nb-capture-sheet`, `#mobile-title`.

**Why no `!important`:** the only inline style that would fight these rules is
`pane.style.position = "relative"` written by `setupResize` (`app.js`). It
is redundant — `style.css` already sets `position: relative` — so v1 deletes
the inline write instead of overriding it. The inline `--side-panel-width`
writes (`app.js`, `activity.js`, `:143-147`) are never read by a
phone rule; they keep the desktop variable in sync for mode exit. Every other
phone rule wins by being the only rule that matches in the phone arm.

Topbar on mobile: hide `#brand` and `#edit-toggle`; keep `#back-btn` (wired to
`goBack()`, `viewer.js`) and add `#mobile-title` (button),
`#mobile-capture`, `#mobile-more`. The title
shows the active note's basename and opens the drawer; it must not be `#brand`,
which calls `NB.viewer.reload()` (`viewer.js`).

**Edge-to-edge and safe areas.** Phone mode sets `body { padding: 0 }` and
`#app { height: 100dvh }`; each edge layer owns its inset instead of sharing the
desktop body padding. `--topbar-h` becomes
`calc(52px + env(safe-area-inset-top))`, the top bar carries that padding, the
rail's height and padding include the bottom inset, and the drawer, sheets,
reader, and state screen add left/right insets. This prevents the iOS gap where
the padded body shortened `#app` while the fixed rail sat on the viewport edge.

## 4. Navigation and history

Verified today: `file:open-request` is emitted by `sidebar.openFile` (`sidebar.js`) and the Recent view (`activity.js`); its one handler is `app.js` → `NB.tabs.open` → `activate` → `viewer.activate` → emits `file:open`. `pushNav` is module-private (`viewer.js`), called only from the content click handler on wikilinks / in-page anchors / cross-note links (`viewer.js`, `:1027`, `:1042`); back is the public `NB.viewer.goBack()` (`viewer.js`) which pops `navStack`; viewer's own `popstate` listener (`viewer.js`) also pops on any browser back. Boot strips `?file=` with `replaceState` (`app.js`).

- **Single note without forking `NB.tabs`:** tabs stay the substrate. On mobile, `app.js` gates its `NB.tabs.restore` call to pass `openFiles: []` and `fallback: <resume or deep-link path>`; the incoming `?file=` is parsed before restore and wins over the device resume. Every open still goes through `file:open-request` → `NB.tabs.open`; there is no second open path.
- **Browser history is the single navigator in phone mode.** Invariant: at rest, the current history entry names the visible surface.
  - Boot seeds the entry: `replaceState({nbHome:true})` + `pathname` for Home, or `replaceState({nbFile:path})` + the note URL when a note opened. History writes are suppressed during boot.
  - A note opened by a user action pushes `{nbFile:path}` + its `?file=` URL. An in-page heading pushes an entry that still names the current note.
  - Showing Home (drawer Home action, missing note, tab dropped) replaces the entry with `{nbHome:true}` + `pathname`, so `?file=` never sticks.
  - The on-screen back button only calls `history.back()` (after closing an open layer). `popstate` is the only code that changes the visible note: layer → close; `nbHome`/`null` → Home; `nbFile !== current` → open that file with history pushing suppressed; `nbFile === current` → `NB.viewer.goBack()` for the in-page scroll entry.
  - Desktop keeps viewer's own `popstate` handler; the phone path gates it with `NB.mobile.isOn()`.
  - Entering phone mode after a desktop boot (resize, tablet rotation) runs the same idempotent seeding.
- **Touch drag is off:** tree rows are not draggable in phone mode, and `dragstart`/`dragover`/`drop`/`performMove` bail. The `…` menu is the only phone surface.
- **Unknown deep link:** `NB.app.openDeepLink` returns `false` when the target is not in the tree; mobile.js shows "Note not found" with Browse/Home actions (M7.2) and Home replaces the entry with `{nbHome:true}`.

## 5. Persistence

Every `persistConfig()` path a phone can trigger (all verified):

| Trigger | Keys written | Phone-reachable | v1 gate |
| --- | --- | --- | --- |
| `file:open` → `updateRecent` (`app.js`, `:377-382`) | `lastFile`, `recentFiles` | yes, every open | allow `recentFiles` only; `lastFile` stays desktop-owned (Continue is device-local) |
| `tabs:changed` (`app.js`) | `openFiles`, `activeFile`, `pinnedFiles`, `sessions`, `activeSessionId` | yes — fired by `tabs.restore` on boot | shared workspace state, written by `/api/workspace-state`; the global blob is not written from this event |
| `activity:collapsed`/`expanded` (`app.js`) | `sidebarCollapsed` | yes (icon toggle / `‹`) | suppress |
| `activity:changed` (`app.js`) | `activeView` | yes | suppress |
| `outline-collapse`/`outline-toggle` (`app.js`) | `outlineCollapsed` | no (outline hidden) | n/a |
| `search-case-changed` (`app.js`) | `searchCaseSensitive` | yes (panel Aa emits) | allow (keyed) |
| panel search options (`activity.js` → `NB.app.setSearchUnique`/`setSearchSort`) | `searchUnique`, `searchSort` | yes (Search drawer) | allow (keyed) |
| `setTheme`/`setFontSize` etc. (`app.js`) | `theme`, `fontSize`, … | only via Settings modal | allow (server-wide by design) |
| resize `endDrag` (`app.js`) | `sidebarWidth`, `outlineWidth` | no (handle hidden, mouse-only) | n/a |

**Minimal gate — one mechanism in `app.js`:** `persistConfig(keys?)` gains a mobile branch. On mobile, a keyless `persistConfig()` is a no-op (nothing is safe to write); a keyed persist does a **read-merge-write**: `GET /api/config` fresh, copy only the named keys from `cfg`, `POST` the merged *complete* blob. The POST replaces the file verbatim (`app.py`), so the body must be complete — a partial POST would drop every other key and the desktop would fall back to `DEFAULTS` (`app.js`). `updateRecent` calls `persistConfig(["recentFiles"])` and skips `cfg.lastFile = path` while in mobile mode. If the fresh GET fails, skip the save — a stale-blob write is exactly the clobber being prevented.

**Pending keys and serialization.** The debounce accumulates a Set of pending keys instead of keeping the last call, so theme + text size + recent in one window all survive. Flushes are serialized through one promise chain: a flush that started with keys A cannot POST a stale A after a later flush wrote B; if new keys arrive during a flush, one follow-up pass runs. A failed GET or POST is caught and does not wedge the chain.

**No server change in v1.** `GET/POST /api/config` (`app.py`, `:882-898`) already carry the whole blob; the v1 merge is client-side. The residual race is the GET→POST gap across devices. Cross-device sync later adds `GET/POST /api/workspace-state` and takes every session and tab key out of this path (`sessions.md` §17).

**Mobile last-note/scroll:** localStorage `nb:mobileResume` = `{v:1, path, scroll}` — written debounced on `file:open` and rAF-throttled on `#viewer-content` scroll (the viewer's own `scrollPositions` map, `viewer.js`, is in-memory only). The capture draft lives in `nb:captureDraft` and is saved while the sheet is open or the field is dirty. Both keys survive a 401/auth lock (the sheet text is cleared from the DOM but the stored draft remains); they are removed only on explicit sign-out or a confirmed send. **iOS home-screen storage isolation:** an installed web app has separate cookies and storage from Safari (research §5), so Continue and the draft do not cross Safari ↔ installed app, and auth-on deployments get a second login inside the installed app — accepted, documented. Storage eviction after long non-use: **not verified**; the designed fallback (Continue absent, draft gone) degrades gracefully per M2.1/M5.2. Per-device theme/text size: cut — theme and size stay server-wide, and the phone settings sheet disables them for a viewer.

## 6. Touch menus

- **Tree rows:** `renderNode` (`sidebar.js`) appends one `…` button per row (file and dir), after the star/pin spans, CSS-visible only in the phone arm. Click: `stopPropagation()` + `preventDefault()`, then open a read-only menu (Open / Copy link / Copy path) — file management is not in v1. `menu.js` clamps to the viewport edges (`menu.js`).
- **Why `stopPropagation` is required twice over:** (1) the row's own click opens the file (`sidebar.js`) — without stopping, tapping `…` would also navigate; (2) `menu.js`'s close dispatcher listens on document click (`menu.js`) — a trigger click that opens the menu synchronously and bubbles to document immediately re-closes it (the target is not inside `#nb-menu`). Both mirror the star/pin handlers (`sidebar.js`); also `dragstart` `preventDefault()` like the star (`sidebar.js`).
- **Phone gates:** every tree/pin/bookmark `contextmenu` handler returns early in phone mode, tree rows are not draggable, and the drag/drop move path bails. Android long-press therefore does not open the desktop file-management menu; the `…` button is the only phone entry.
- **Note header:** `#mobile-more` opens a 3-item menu built in mobile.js: Reload → `NB.viewer.reload()`; Copy link → `NB.app.copyLink(path)` (`app.js`); Show in Browse → open drawer + `NB.sidebar.revealFile(path)` (`sidebar.js`). On Home the same button opens the settings sheet. Same `NB.menu` anchoring.

## 7. Quick capture

**One request:**

```
POST /api/file/append  {"path": "Inbox.md", "content": "\n\n" + text.trim() + "\n", "create": true}
```

- `api.js` gains `appendFile(path, content, create)` — there is no append wrapper today (`api.js`).
- **Separator:** the client composes the blank line. The server appends exactly the bytes given (`app.py`); it has no separator logic. On a freshly created file the two leading newlines are cosmetic; accepted (spec M5.3: verbatim block, blank-line separated).
- **Why not `/api/create` first:** under `upsert: true` create's `content` is *ignored* (`app.py`), so create cannot seed the block; create-then-append is two requests with a meaningless gap, while append with `create: true` does both in one `open(O_CREAT|O_APPEND)` (`app.py`) — no TOCTOU, and concurrent captures from two phones order atomically at the kernel (`O_APPEND`).
- **Inode/atomic-write race with desktop saves:** `POST /api/file` (desktop save) writes a temp file and `os.replace`s it (`app.py` → `atomic_write`, `app.py`) — the path now names a **new inode**. A phone append that opened the old inode and wrote just before the replace is silently discarded while its response still reports success (`app.py`); likewise any capture landing during a desktop edit session of the same file is clobbered by the save itself. v1 accepts this: the target is `Inbox.md`, a capture-only file the desktop rarely holds open; when it is open + dirty on the desktop, the watcher flags the conflict (`viewer.js` → `viewer:conflict` → badge, `tabs.js`) — the only in-app detection that exists today. Not reliably detectable from the phone; an append-aware save or per-path lock is a v2 option.
- **After success:** `NB.sidebar.refresh()` (`sidebar.js`) so a first-capture `Inbox.md` appears in the tree (one `/api/tree` GET per capture, fine on LAN). If the file is open in this client's tabs, leave the viewer to the watcher's mtime poll — no direct cache poke, no new event.
- **Role gating — the trap:** server-side, `file_append` is `@admin_required` (`app.py`) which **bypasses when auth is off** (`app.py`) — an open server accepts the append. But `NB.auth.isAdmin()` (`auth.js`) returns **false** when auth is off (it requires `enabled && role === "admin"`), so gating the UI on `isAdmin()` would hide capture on every open server. Fix: `auth.js` gains `canWrite: () => { const s = authStatus; return !s || !s.enabled || s.role === "admin"; }`. The capture entry keys on `canWrite()`; a viewer never sees it (M5.5); a direct attempt hits the server's 403 and the fetch throws (`api.js`) → refusal message, never a false success.
- **Draft:** localStorage `nb:captureDraft`, written debounced on input and on `visibilitychange`/`pagehide` (backgrounding, M5.2); restored on sheet open; cleared only on confirmed success.
- **In-flight guard:** `sending` boolean; Send disabled while true — a double tap produces exactly one append (M5.4).
- **Failure:** keep sheet + draft + inline Retry; Retry re-sends the same block once. A 401 mid-send emits `auth:required` (`api.js`) → login modal (`auth.js`); the draft survives the post-login reload.

## 8. Touch and keyboard hardening

- **Hover-only rules:** hide `.tree-star`/`.tree-pin` on mobile (both actions live in the `…` menu — no dead UI) and reveal the code-block copy button: `.tree-star, .tree-pin { display: none; }`, `.copy-btn { opacity: 1; }` inside the phone arm. Before v1 they were hover-gated (`style.css` per research §3.2). No `:hover` rule remains load-bearing in the phone arm.
- **44 px targets:** the phone arm raises `.activity-btn` (36 px today, `style.css`), drawer rows (27 px), and every `…`/sheet control to ≥44 px with padding (HIG; research §6).
- **Capture sheet + `visualViewport`:** the sheet is bottom-anchored and listens to `window.visualViewport` `resize`/`scroll` to re-anchor above the open keyboard (iOS does not shrink the layout viewport; research §5/M4). Fallback: `resize` for Android. The field renders at ≥16 px so iOS does not zoom on focus (spec C2).
- **`#edit-toggle` and `#hybrid-toggle` hidden** on mobile. The source editor stays desktop-only, and the phone enters WYSIWYG from the note menu's `Edit note` (§14.4).
- **`#brand` must not be the mobile title:** it is a reload button — click calls `NB.viewer.reload()` (`viewer.js`) — so a mis-tap would discard the reading position. The phone arm hides it; the title is `#mobile-title` (opens the drawer).
- **`topbar-hidden` config class:** §3's two rules keep the topbar and back button alive on a phone even when the desktop preference is on (`app.js`, `style.css`).

## 9. File-by-file change list

New files (kept to two shipped code files + this doc):

| File | Contents |
| --- | --- |
| `static/js/mobile.js` | mode mirror (`data-ui-mode`) + `mobile:mode` event; drawer (open/close, scrim, history entries, `popstate` owner); mobile Home + settings sheet; title text + `…` menu; capture sheet (draft, guard, append, retry); resume read/write (`nb:mobileResume`); builds the sheet/scrim/state DOM at boot |
| `tests/browser/test_mobile_browser.js` | Playwright mobile harness (temp notebook via `NOTEBOOK_DATA_DIR`/`NOTEBOOK_CONFIG_DIR`, pattern of `test_designer_browser.js`) |

Edits:

| File | Change |
| --- | --- |
| `templates/index.html` | add `interactive-widget=resizes-content` to the viewport (`index.html`); add `#mobile-title`, `#mobile-capture`, `#mobile-more` to `#topbar`; add `#mobile-scrim`, `#capture-sheet`, `#mobile-state`, `#mobile-home`, and the settings-sheet host before `#app` closes; `<script defer src="/static/js/mobile.js">` before `app.js` (`index.html`) |
| `static/css/style.css` | one appended section **inside the phone media query** (§2, §3, §6, §8), plus the `:root { --ui-mode: … }` declarations; no edits above it |
| `static/js/app.js` | delete the inline position write in `setupResize` (`app.js`; CSS covers it, `style.css`); skip `setupResize` in phone mode; boot gate for `NB.tabs.restore` (`app.js`); `persistConfig(keys)` mobile branch + `updateRecent` `lastFile` guard (§5) |
| `static/js/activity.js` | `collapse()`/`expand()`/`activate()` become mode-aware (`activity.js`): on phone they call `NB.mobile.closeDrawer()`/`openDrawer()` and return without touching `.collapsed`, the width var, or `activity:collapsed`/`expanded` |
| `static/js/viewer.js` | one-line early return at the top of the `popstate` handler (`viewer.js`); set `#mobile-title` on every activate |
| `static/js/sidebar.js` | `…` button per tree row in `renderNode` (`sidebar.js`), CSS-hidden on desktop |
| `static/js/api.js` | `appendFile` wrapper (`api.js` block) |
| `static/js/auth.js` | `canWrite()` next to `isAdmin()` (`auth.js`) |
| `static/sw.js` | add `/static/js/mobile.js` to `PRECACHE`; bump `CACHE` (`sw.js`) |
| `tests/dom/test_dom.js` | a new `== mobile ==` block; tests set `document.documentElement.dataset.uiMode = "phone"` (the token is absent in jsdom) |

`app.py` gains only the two public icon routes (`/apple-touch-icon.png`,
`/apple-touch-icon-precomposed.png`); no notebook route changes. The manifest
gains `id`, `lang`, `dir` and the opaque v2 icon set. The renderer doc contract
(`ai.js`/`agent.md`) is untouched — no fence or version change.

## 10. Test plan

**jsdom** (extend `tests/dom/test_dom.js`): set `document.documentElement.dataset.uiMode = "phone"` before boot (the mode reader's fallback; `getComputedStyle` returns no custom property without `style.css`). Assert: mode mirroring; drawer open/close classes + scrim; the capture sheet posts stubbed `/api/file/append` with `create: true` and the `"\n\n"` separator, Send disabled in flight, draft save/restore/clear; `canWrite()` across the four auth states; the persist gate — opening a file in mobile mode issues a merged global-config POST whose body equals fresh-config + `recentFiles` and never contains phone `openFiles` (tab and session changes go to `/api/workspace-state`); the `…` click opens `NB.menu` with sidebar items AND does not open the file; `popstate` order (drawer close, then `NB.viewer.goBack`); activity-bar taps do not write `sidebarCollapsed`.

**Playwright** (real browser, real layout): viewports 390×844 (portrait), 932×430 (iPhone landscape), 1280×800 (desktop regression, C4); touch context (`hasTouch`, `isMobile`) for the mobile two. Assert: no horizontal overflow (`scrollWidth ≤ innerWidth`), `#viewer` width > 0, tab strip hidden at mobile widths / visible at 1280, 44 px target measurement, drawer lifecycle, hardware back via `page.goBack()` closes the drawer then returns the note, desktop four-column parity at 1280×800. Isolation: the harness copies the designer pattern — `mkdtemp` + `NOTEBOOK_DATA_DIR`/`NOTEBOOK_CONFIG_DIR` env + `app.py` from `.venv_<hostname>` (`test_designer_browser.js`); the real `notebook/`/`config/` are never touched (jsdom stubs `fetch` entirely; `tests/test_app.py` redirects dirs before import).

**Real iPhone [H]** (manual, spec device matrix): iOS fires no `contextmenu` — the `…` path is the only menu (C1); keyboard: `visualViewport` re-anchor + no zoom on focus (C2); rotation keeps drawer/draft/scroll (C6); safe-area insets; Add to Home Screen standalone launch + separate storage (second login when auth on; Continue/draft do not cross into the installed app).

## 11. Risks and rollback

| Risk | Exposure | Detection | Rollback |
| --- | --- | --- | --- |
| Desktop CSS regression | low — every mobile rule lives inside the phone media query; desktop never matches it | jsdom suite + Playwright 1280×800 + manual smoke | revert the appended CSS section |
| Shared-code edits regress desktop | `app.js` deletion (covered by `style.css`); viewer `popstate` gate (inert when mode off); sidebar `…` hidden but present in row DOM (`dragstart` must be prevented) | jsdom `== sidebar tree ==` / `== back button ==` blocks + desktop Playwright pass | revert the four JS hunks |
| Config clobber (phone writes desktop keys) | the whole-blob POST replaces the file (`app.py`); a naive phone persist resets desktop `openFiles`/widths to phone-boot values | jsdom merge test; manual: concurrent phone read + desktop tab change, then desktop reload (C5) | gate is one function; revert restores today's behaviour |
| Stale-merge race (GET→POST gap) | milliseconds; identical in kind to the existing two-desktop-window race (both POST whole `cfg`) | none added; accepted | n/a |
| Append race vs desktop save (§7) | silent capture loss when the desktop saves `Inbox.md` mid-capture | desktop conflict badge only (`viewer.js`); not detectable from the phone | accepted v1; documented |
| Mode flip mid-session (iPad rotation) | drawer closes, shell swaps | manual iPad pass | accepted (A4) |

Rollback overall: v1 is one module + one CSS section + four small JS hunks; no server, schema, or config-key changes (all mobile state is `localStorage`), so reverting the module and the CSS restores today's behaviour exactly.

## 12. v2 boundary (what v1 must not preclude)

- Note identity stays the `?file=` path; the reader never forks `NB.tabs` — one open path via `file:open-request` (`app.js`). v2 tabs and editing reuse the substrate.
- The `navStack` restore contract (`pushNav`/`applyNavEntry`, `viewer.js`) stays the single back source; mobile only mirrors history entries.
- The `…` menus reuse the shared item builders (`sidebar.js`) — v2 adds edit items without new menu machinery.
- `localStorage` keys are versioned (`v:1`) so v2 can migrate resume and draft.
- Editing: hybrid's structural gestures are `mousedown`/`mouseup` (`hybrid.js`) and will need pointer-event equivalents on touch; CM6 (vendored, `cm-bridge.js`) is the alternative input surface. v1 neither blocks nor builds either — the choice is v2's, not made here.
- Per-device prefs, if ever wanted, are additive `config.json` keys (the blob is schema-free, `app.py`); v1 adds none, so there is nothing to migrate.

**Not verified** (could not be confirmed from the code): Android Chrome long-press `contextmenu` synthesis (research §10); iOS storage-eviction window for Safari/installed-app `localStorage` (degradation is designed); real-iPhone behaviour of hover-synthesized controls (moot once §8 hides/reveals them); the 932×430 landscape figure comes from the task brief — the research table measured 390×844 portrait only.

## 13. v2 addendum — WYSIWYG editing (shipped)

Editing reuses hybrid mode; no second editor surface was added.

**Entry.** `#hybrid-toggle` (✎) moves before the +/… controls and is unhidden in
the phone arm. `hybrid.js:updateButtonVisibility` shows it only when a note is
open and `NB.auth.canWrite()` is true (default-deny until `/api/auth` answers;
`auth:status` re-runs it). The note `…` menu's first item, **Edit note**, enters
the same mode, so the menu path works on iOS where the pencil is small.

**Layer.** Entering emits `hybrid:entered`; `mobile.js` turns it into
`setLayer("edit")`, the same history entry the drawer uses. `body.edit-open`
hides the rail and the +/… actions, and `#app` shrinks above the keyboard with
`calc(100dvh - var(--m-kb))` (`--m-kb` already mirrors `visualViewport`).
`popstate`/Esc/top-bar back close the layer through `commitForTabSwitch` inside
`exitEditSession`: autosave on writes silently, autosave off stashes a draft, and
a 401 exits without writing.

**Toolbar.** `#edit-bar` becomes a single sideways-scrolling 44 px strip.
`#edit-bar .eb-actions` (`Save`, `Done`) is `order: -1` and sticky-left, so the
two exits never scroll away. Save is visible on the phone only (desktop keeps
autosave + the exit prompt). The flyout groups (table, list-move, examples,
emoji) are hidden: their anchored popovers do not fit the strip, and the same
constructs remain typeable. Tapping a button keeps the contenteditable caret
(`mousedown` `preventDefault` on `#edit-bar`) and a captured range is restored
when the browser moved focus anyway, so formatting acts on the user's selection
and the keyboard stays up.

**Desktop is unchanged** outside the phone media query: the pencil stays where
it was in the top bar, Save stays hidden in hybrid, and the bar keeps wrapping.

**Not supported on the phone:** drag-reorder handles (table/list `mousedown`
drags), the right-click formatting menu, and the source editor.

## 14. v3 addendum — phone sidebar access (shipped)

Behaviour: [`../product/mobile.md`](../product/mobile.md) M10. Visual contract:
[`../ui/mobile-more-sheet.md`](../ui/mobile-more-sheet.md).

The phone rail gains Sessions and one overflow control. Nothing else about the rail changes: same
DOM, same 56 px bottom bar, same `activate()` path.

### 14.1 One disposition table, no CSS decision

```js
// activity.js — the rail is a slice of the user's saved order, not a set.
const PHONE_RAIL_SLOTS = 6;
// Views with no phone surface: no rail slot and no More row.
const PHONE_OFF_VIEWS = ["ai"];

function phoneViews() {
  return visibleViews().filter(v => PHONE_OFF_VIEWS.indexOf(v.id) < 0);
}
function railViews() {
  return isPhone() ? phoneViews().slice(0, PHONE_RAIL_SLOTS) : visibleViews();
}
function offRailViews() {
  return isPhone() ? phoneViews().slice(PHONE_RAIL_SLOTS) : [];
}
```

- `renderBar()` iterates `railViews()`; every desktop line is untouched because `railViews()` equals
  `visibleViews()` off the phone.
- **`isPhone()` is the existing predicate** (`activity.js:237-239`). It must be extended, not
  duplicated: `NB.mobile` does not exist during the first `register()` calls, because `activity.js`
  is parsed before `mobile.js` (`index.html:2055`, `:2059`). Read the CSS token first and keep the
  `NB.mobile` branch as a fallback, so `renderBar` is correct at first paint and `collapse`/`expand`
  keep working.
- `NB.evt.on("mobile:mode", renderBar)` re-renders on a rotation or a resize across the breakpoint.
  Without it a tablet that rotates into the phone shell keeps the unfiltered bar.
- `NB.activity` gains `railViews()` and `offRailViews()`; `barItems()` keeps its contract (every
  view, hidden or not) because Settings' order list reads it (`activity-bar-order.md` §1).
- The two shipped sessions hides go away: `style.css:9415-9416`, and nothing else. The AI pair
  (`style.css:8065-8066`) **stays** as belt and braces; `PHONE_OFF_VIEWS` is the decision, the CSS is
  the guard. This matters: AI is registered and is not in `hiddenViews` (`activity.js:134-136`), so
  without the exclusion the More sheet would list it and open an empty drawer.
- `#pinned-view` needs no CSS change: it stays a rail slot by default and its host stays visible.
- **`app.js:36` is the second phone constant.** `PHONE_HIDDEN_VIEWS = ["ai", "sessions"]` is used at
  `app.js:1441-1448` to rewrite a saved `activeView` that names a view the phone cannot host.
  `"sessions"` must be removed from it, or a saved `activeView: "sessions"` still falls back to
  Explorer and the phone never opens the drawer on Sessions. Only `"ai"` stays, and the constant's
  comment changes with it.

### 14.2 The overflow control

| Piece | Change |
|---|---|
| Markup | `#activity-more-btn`, a `.activity-btn.activity-action` after `#activity-settings-btn` (`index.html:377`); `display: none` on desktop, `display: flex` in the phone arm |
| Glyph | `#nb-icon-menu` (`index.html:262-264`); the topbar's note menu keeps `#nb-icon-more`, so the two corners never share a glyph or a label |
| Label | `aria-label`/`title` `More views` against the topbar's `Note menu` (`index.html:344`); the sheet's own title is `More` |
| Layer | `layer = "views"`: a fourth phone sheet, same mechanics as `settings` — `setLayer`, a branch in `showLayerUi`/`hideLayerUi`, `body.views-open`, the shared scrim, `onKeydown`'s trap branch, `focusOpener` |
| Host | `#mobile-views-sheet`, a sibling of `#mobile-settings` inside `#app`; `hidden` at rest; joins the four shipped sheet selector lists |
| Build | `buildViews()` runs on every open and renders from `offRailViews()` and the auth status, so a hide/unhide or reorder needs no live subscription. It reuses the grabber/head/close/body construction of `buildSettings()` (`mobile.js:670-760`); factor that four-line header once instead of copying it |
| Owned state | `aria-expanded` and `body.views-open` are written only in `showLayerUi`/`hideLayerUi` (`mobile.js:213-250`), the single owner of every layer transition — including the drawer takeover, `onAuthLocked`'s blanket close, and a mode flip |
| View row | `NB.mobile.openDrawer(id)`; `setLayer("drawer")` reuses the one history entry, so back goes note-ward, not sheet-ward |
| Settings row | `openSettings(opener)`: the opener is an element with a `focus` method, otherwise `#mobile-more`. The Home row passes a wrapper, never the bare function (`mobile.js:535`), or a `MouseEvent` becomes the opener |
| Log out row | `NB.auth.status().enabled` gates the row; the click closes the layer and calls `NB.auth.logout()` |

`openMore()` keeps its name and its job (the note menu). The new entry point is `openViews()`.

`updateHome` (`mobile.js:545-547`) enables the back button on `!active`; it must be `!active && !layer`,
because More is reachable from Home and back is the only close control there besides the scrim.

### 14.3 Sessions on the phone

The list needs no new render path: remove the two hides, size it for touch
(`sessions.md` §10.2). `#sessions-view` already carries a `.panel-header` with
`makeCollapseBtn()`, so the phone header rule (`style.css:8113-8120`) gives it a 52 px bar and a 44 px
`×`, and `focusDrawer()` finds that close button (`mobile.js:342-352`).

**Closing the drawer after a switch** is the one behaviour that needs code, because the shipped paths
cover only part of it:

| Target session | Shipped path | Contract |
|---|---|---|
| Non-empty, different note | `pushNoteHistory` closes the layer and replaces the entry (`mobile.js:949-964`) | works as is |
| Non-empty, **same note** | `pushNoteHistory` returns at `:953` before the layer branch, so the drawer stays open | move the `if (layer)` branch above the `state.nbFile === path` check. The same fix makes a Search hit on the already-open note close its sheet |
| **Empty** | `activateSession` opens no file (`tabs.js:872-877`), so nothing closes the drawer | the row handler calls `NB.mobile.closeDrawer()` after the switch; the layer entry pops to the note |

Session switching stays `tabs.js`'s swap path. The phone adds no session model of its own:
it restores the workspace's shared sessions, writes its changes through
`/api/workspace-state`, and does not poll (`sessions.md` §17.4). Its active session and
active tab stay device-local in `nb:activeSession` and `nb:activeFile`. A restored active
tab with no phone surface (`§sessions`, `§graph`) is not shown: the phone activates
another tab, or Home, and leaves that tab in the shared model.

**The session dialog.** Create and Rename open `#session-dialog`, the first body-level desktop modal
reachable from the phone (`NB.dialog`, `dialog.js:76-120`, z 2000). Without a guard, hardware back
fires `popstate` and `onPopState` closes the drawer under the still-open dialog. The dialog is not a
second layer — the layer model holds one at a time, and stacking would fight `showLayerUi`:

- `dialog.js` gains `isOpen()` and `requestClose()`; `open(overlay, opts)` accepts an
  `onCloseRequest` and `close()` emits nothing new.
- `sessions.js` passes `onCloseRequest` for its create/rename dialog, so the closer stays owned by the
  surface that opened it.
- `mobile.js`'s `onPopState` runs first: if `NB.dialog.isOpen()` and `requestClose()` reports that the
  surface actually closed, re-push the layer entry (`history.pushState({ nbLayer: layer })`) when one
  exists, then return. A closer that declines (the session dialog refuses while a create is in flight)
  returns `false`, and the back press falls through to the normal layer handling.
- `isOpen()` checks `active.overlay.isConnected && !active.overlay.hidden`, not just the bookkeeping:
  the guard now sits on every back press, and a surface that hid its overlay without calling `close()`
  would otherwise swallow them all.

**Two stale comments go with the change.** `index.html:407-409` still says the phone hides the
Sessions host and its rail icon, and `style.css:8089-8090` cites a `sessions.md D12` that does not
exist. Both are rewritten in the same commit.

**The 20-session cap.** `sessions.js` refuses with `aria-disabled`, a `title` and an `sr-only` note
(`sessions.js:624-640`). A phone has no hover, so the tap appears to do nothing. The disable path
calls `NB.toast`/`notify` with the same reason on the phone; the title and `aria-describedby` stay for
desktop.

### 14.4 Home glyphs and the edit entry

Two chrome corrections ride with this change, both visual only.

**Home rows use the desktop sprites.** `homeRow()` (`mobile.js:468-488`) currently takes a text glyph
and writes it into `.mhr-icon`; it takes an `nb-icon-*` id instead and builds
`<svg class="icon"><use href="#id"/></svg>`. The mapping is the doc's table:
search, file (Continue), bookmark, clock, explorer, settings. `.mhr-icon` becomes a 24 × 17 box
(`--icon-lg`, `--fg-muted`); row height stays 56. No event, key or persistence changes.

**The phone has no top-bar edit button.** `#hybrid-toggle { display: none; }` inside the phone query
(`style.css`, phone block) hides it; `openMore()` already pushes `Edit note` as the first item when the
role can write (`mobile.js:786-800`), so the entry exists with no new code. `focusOpener("edit")`
(`mobile.js:252-258`) returns to `#hybrid-toggle`; on the phone it must return to `#mobile-more`. The
edit bar's `Done` remains the exit (`architecture` §13). Desktop is untouched.

The two stale comments (§14.3) and `hybrid-mode.md`'s "the button is the only entry control" both
carry the phone exception.

### 14.5 Tests

| Suite | Assertion |
|---|---|
| `tests/dom/test_dom.js` | With `dataset.uiMode = "phone"`: the rail builds six view buttons + More (default order: Explorer, Sessions, Pinned, Bookmarks, Recent, Search); `offRailViews()` is empty and never contains AI; the sheet renders no `Views` group, then Settings and Log out only when auth is enabled; tapping a view row opens the drawer and adds no second history entry; Esc and back close the sheet and re-enable the back button on Home |
| `tests/dom/test_dom.js` | A bar order that pushes a view to position 7 moves it into `offRailViews()` and out of the rail |
| `tests/dom/test_dom.js` | `app.js` boot with a saved `activeView: "sessions"` leaves the active view as Sessions on the phone (the `PHONE_HIDDEN_VIEWS` change) |
| `tests/browser/test_mobile_browser.js` | At 390 × 844: seven rail slots, each ≥44 wide, no horizontal overflow; tap Sessions → drawer with 44 px rows; tap a row → session switches and the drawer closes (same-note and empty-session cases included); tap More → sheet with Settings and Log out; back walks drawer → note |
| `tests/dom/test_dom.js` | Home rows carry `<svg><use href="#nb-icon-…"/>` and no emoji text; `#hybrid-toggle` is not rendered on the phone; the note menu's first item is `Edit note` for a writer and absent for a viewer |
| Desktop regression | At 1280 × 800: seven views, no `#activity-more-btn`, `railViews()` unfiltered, `#hybrid-toggle` shown for a writable note, Home rows untouched |

### 14.6 Wiring the spec did not spell out

Found while building; each is one line in the shipped code and none changes a contract.

| Fix | Why |
|---|---|
| `setLayer` and `closeLayerNow` call `updateHome()` | Nothing re-ran the back-button predicate when a layer opened on Home, so More left back disabled |
| `dataset.drawerView` is written **after** `setLayer("drawer")` | Entering from another layer runs `hideLayerUi` first, which deletes the attribute |
| `requestCloseLayer` pops history only when the current entry still carries `nbLayer` | An empty-session switch rewrites the entry to Home, so `history.back()` would land on a stale `?file=` |
| `#topbar #edit-toggle, #topbar #hybrid-toggle { display: none; }` | `#topbar .icon-btn { display: grid }` outranked a bare id: the source-editor `</>` had been visible on a phone all along, against `mobile-shell.md` §2 |
| `.side-panel-view[data-view="sessions"] .collapse-btn` and `.session-more { flex: 0 0 44px }` | The per-view selector outranked the shared phone header rule, and the flex basis clamped the `⋯` width |
| `sheetHead()` factors the grabber + head + close out of `buildSettings()` | The More sheet needs the same three nodes; a copy would drift |
| The group label is `var(--text-xs)` (≈11.5 px), not `12px` | The typography ratchet (`tests/static/test_typography.js`) counts literals; `.72rem` is the smallest existing role |
| `#welcome.welcome { display: none }` on the phone | `#welcome.welcome { display: flex }` outranked the phone's `#welcome { display: none }`, so the desktop welcome painted above Home — the same specificity class as the edit buttons above |
| `Sign out` is the More row's label | The phone settings sheet already says `Sign out`; the desktop rail says `Log out`. One device, one word |
| The sheet body is `padding: 0` | The host already applies `calc(12px + safe-area-inset-bottom)`; a body inset doubled it |
