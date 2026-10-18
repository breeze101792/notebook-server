# Mobile v1 architecture (read + drawer + search + quick capture)

Status: implementation plan. Owner: `architect`.
Applies to: `templates/index.html`, `static/css/style.css`, `static/js/{app,viewer,sidebar,api,auth,mobile}.js`, `static/sw.js`, `tests/dom/test_dom.js`, `tests/browser/`.
Behaviour spec: [`../product/mobile.md`](../product/mobile.md); device facts: [`../research/mobile-support.md`](../research/mobile-support.md).
Decided upstream: no framework/bundler, no native shell, no TLS (plain HTTP on the LAN), desktop must not regress, editing deferred to v2.

## 1. Goal

One web app, one codebase. At phone widths the four-column shell becomes a reader column with a bottom rail, an off-canvas drawer for the existing side-panel views (Explorer, Recent, Search, Bookmarks), a Home list, and one capture sheet. Desktop is byte-for-byte unchanged at the desktop breakpoint (spec C4).

### Non-goals (v1)

| Cut | Reason |
| --- | --- |
| Editing, tabs UI, TOC, lightbox, AI, export, graph, offline cache | spec §2.2; hybrid editing's structural gestures are `mousedown`/`mouseup` (`hybrid.js:4808-4809`) — touch needs pointer-event work, v2 |
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

Today: `#layout` is a four-column grid, `var(--activity-bar-width) var(--side-panel-width) 1fr var(--outline-width)` (`style.css:197-210`, `:23`, `:29`); at 390 px the fixed columns leave the reader 0 px (research §2.2).

```
desktop: [ rail 48 | panel var | reader 1fr | outline var ]
phone:   [ reader, full width ]            #side-panel is a fixed drawer
         [ bottom rail 56 + inset ]        #activity-bar leaves the grid
```

All phone rules sit inside the §2 media query, appended as one section at the
end of `style.css` (the file's only existing `max-width` query is the
designer's, `style.css:4904`):

| Rule | Purpose |
| --- | --- |
| `#layout { display: block; position: relative; }` | one column; the grid columns are gone (`style.css:197-210`) |
| `#editor-pane { height: 100%; }` | reader fills the space above the rail |
| `#outline-pane, #tab-bar { display: none; }` | outline and tabs not in v1; `#outline-toggle` inside the strip (`index.html:174-188`) is dead, fine |
| `#activity-bar { position: fixed; left: 0; right: 0; bottom: 0; height: calc(56px + env(safe-area-inset-bottom)); flex-direction: row; z-index: 150; }` | the rail becomes a bottom bar; `.activity-btn` stretches to `flex: 1 1 0; height: 56px` |
| `#side-panel { position: fixed; top: 0; bottom: 0; left: 0; width: min(86vw, 340px); z-index: 410; transform: translateX(-100%); visibility: hidden; }` + `body.drawer-open #side-panel { transform: none; visibility: visible; }` | the drawer. Width deliberately does NOT read `--side-panel-width`, so desktop width writes stay irrelevant |
| `#drawer-scrim { position: fixed; inset: 0; z-index: 400; }` | built by `mobile.js`, hidden unless `body.drawer-open` |
| `#side-panel.collapsed .side-panel-view:not([hidden]) { display: flex; }`, `.resize-handle { display: none; }` | neutralize desktop collapse chrome: boot may paint `.collapsed` from server config (`index.html:128`, `style.css:435-441`); the drawer must not inherit desktop collapse state |
| `body.topbar-hidden #topbar { display: flex; }` | wins on specificity ((1,1,0) + element) against `body.topbar-hidden #topbar` (`style.css:149-150`); the phone keeps the back button even when the desktop hid the bar |

State: `html[data-ui-mode]` (mirror, for JS/tests), `body.drawer-open` (drawer),
`body.capture-open` (sheet), `.nb-capture-sheet`, `#mobile-title`.

**Why no `!important`:** the only inline style that would fight these rules is
`pane.style.position = "relative"` written by `setupResize` (`app.js:507`). It
is redundant — `style.css:274` already sets `position: relative` — so v1 deletes
the inline write instead of overriding it. The inline `--side-panel-width`
writes (`app.js:352-355`, `activity.js:129-130`, `:143-147`) are never read by a
phone rule; they keep the desktop variable in sync for mode exit. Every other
phone rule wins by being the only rule that matches in the phone arm.

Topbar on mobile: hide `.search-wrap` (`style.css:176-185`), `#brand`, and
`#edit-toggle`; keep `#back-btn` (wired to `goBack()`, `viewer.js:1163-1165`)
and add `#mobile-title` (button), `#mobile-capture`, `#mobile-more`. The title
shows the active note's basename and opens the drawer; it must not be `#brand`,
which calls `NB.viewer.reload()` (`viewer.js:1169-1171`).

**Edge-to-edge and safe areas.** Phone mode sets `body { padding: 0 }` and
`#app { height: 100dvh }`; each edge layer owns its inset instead of sharing the
desktop body padding. `--topbar-h` becomes
`calc(52px + env(safe-area-inset-top))`, the top bar carries that padding, the
rail's height and padding include the bottom inset, and the drawer, sheets,
reader, and state screen add left/right insets. This prevents the iOS gap where
the padded body shortened `#app` while the fixed rail sat on the viewport edge.

## 4. Navigation and history

Verified today: `file:open-request` is emitted by `sidebar.openFile` (`sidebar.js:661-664`) and the Recent view (`activity.js:290-293`); its one handler is `app.js:387-390` → `NB.tabs.open` → `activate` → `viewer.activate` → emits `file:open`. `pushNav` is module-private (`viewer.js:1124-1129`), called only from the content click handler on wikilinks / in-page anchors / cross-note links (`viewer.js:999`, `:1027`, `:1042`); back is the public `NB.viewer.goBack()` (`viewer.js:750`) which pops `navStack`; viewer's own `popstate` listener (`viewer.js:1236-1240`) also pops on any browser back. Boot strips `?file=` with `replaceState` (`app.js:714`).

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
| `file:open` → `updateRecent` (`app.js:393`, `:377-382`) | `lastFile`, `recentFiles` | yes, every open | allow `recentFiles` only; `lastFile` stays desktop-owned (Continue is device-local) |
| `tabs:changed` (`app.js:396-401`) | `openFiles`, `activeFile`, `pinnedFiles` | yes — fired by `tabs.restore` on boot | suppress (skip mutation + persist) |
| `activity:collapsed`/`expanded` (`app.js:425-431`) | `sidebarCollapsed` | yes (icon toggle / `‹`) | suppress |
| `activity:changed` (`app.js:435-437`) | `activeView` | yes | suppress |
| `outline-collapse`/`outline-toggle` (`app.js:439-449`) | `outlineCollapsed` | no (outline hidden) | n/a |
| `search-case-changed` (`app.js:404-407`) | `searchCaseSensitive` | no (top-bar search hidden; the panel search's Aa does not emit, `activity.js:504-506`) | n/a |
| `setTheme`/`setFontSize` etc. (`app.js:834`) | `theme`, `fontSize`, … | only via Settings modal | allow (server-wide by design) |
| resize `endDrag` (`app.js:510-519`) | `sidebarWidth`, `outlineWidth` | no (handle hidden, mouse-only) | n/a |

**Minimal gate — one mechanism in `app.js`:** `persistConfig(keys?)` gains a mobile branch. On mobile, a keyless `persistConfig()` is a no-op (nothing is safe to write); a keyed persist does a **read-merge-write**: `GET /api/config` fresh, copy only the named keys from `cfg`, `POST` the merged *complete* blob. The POST replaces the file verbatim (`app.py:885-895`), so the body must be complete — a partial POST would drop every other key and the desktop would fall back to `DEFAULTS` (`app.js:315`). `updateRecent` calls `persistConfig(["recentFiles"])` and skips `cfg.lastFile = path` while in mobile mode. If the fresh GET fails, skip the save — a stale-blob write is exactly the clobber being prevented.

**Pending keys and serialization.** The debounce accumulates a Set of pending keys instead of keeping the last call, so theme + text size + recent in one window all survive. Flushes are serialized through one promise chain: a flush that started with keys A cannot POST a stale A after a later flush wrote B; if new keys arrive during a flush, one follow-up pass runs. A failed GET or POST is caught and does not wedge the chain.

**No server change.** `GET/POST /api/config` (`app.py:859-867`, `:882-898`) already carry the whole blob; the merge is client-side. The residual race is the GET→POST gap across devices — the same last-writer-wins race two desktop windows already share. A server-side per-key PATCH would close it fully; not justified for a single-user LAN app in v1.

**Mobile last-note/scroll:** localStorage `nb:mobileResume` = `{v:1, path, scroll}` — written debounced on `file:open` and rAF-throttled on `#viewer-content` scroll (the viewer's own `scrollPositions` map, `viewer.js:381-391`, is in-memory only). The capture draft lives in `nb:captureDraft` and is saved while the sheet is open or the field is dirty. Both keys survive a 401/auth lock (the sheet text is cleared from the DOM but the stored draft remains); they are removed only on explicit sign-out or a confirmed send. **iOS home-screen storage isolation:** an installed web app has separate cookies and storage from Safari (research §5), so Continue and the draft do not cross Safari ↔ installed app, and auth-on deployments get a second login inside the installed app — accepted, documented. Storage eviction after long non-use: **not verified**; the designed fallback (Continue absent, draft gone) degrades gracefully per M2.1/M5.2. Per-device theme/text size: cut — theme and size stay server-wide, and the phone settings sheet disables them for a viewer.

## 6. Touch menus

- **Tree rows:** `renderNode` (`sidebar.js:101-179`) appends one `…` button per row (file and dir), after the star/pin spans, CSS-visible only in the phone arm. Click: `stopPropagation()` + `preventDefault()`, then open a read-only menu (Open / Copy link / Copy path) — file management is not in v1. `menu.js` clamps to the viewport edges (`menu.js:41-44`).
- **Why `stopPropagation` is required twice over:** (1) the row's own click opens the file (`sidebar.js:172`) — without stopping, tapping `…` would also navigate; (2) `menu.js`'s close dispatcher listens on document click (`menu.js:155-157`) — a trigger click that opens the menu synchronously and bubbles to document immediately re-closes it (the target is not inside `#nb-menu`). Both mirror the star/pin handlers (`sidebar.js:164-168`); also `dragstart` `preventDefault()` like the star (`sidebar.js:169`).
- **Phone gates:** every tree/pin/bookmark `contextmenu` handler returns early in phone mode, tree rows are not draggable, and the drag/drop move path bails. Android long-press therefore does not open the desktop file-management menu; the `…` button is the only phone entry.
- **Note header:** `#mobile-more` opens a 3-item menu built in mobile.js: Reload → `NB.viewer.reload()`; Copy link → `NB.app.copyLink(path)` (`app.js:833`); Show in Browse → open drawer + `NB.sidebar.revealFile(path)` (`sidebar.js:675-687`). On Home the same button opens the settings sheet. Same `NB.menu` anchoring.

## 7. Quick capture

**One request:**

```
POST /api/file/append  {"path": "Inbox.md", "content": "\n\n" + text.trim() + "\n", "create": true}
```

- `api.js` gains `appendFile(path, content, create)` — there is no append wrapper today (`api.js:47-65`).
- **Separator:** the client composes the blank line. The server appends exactly the bytes given (`app.py:2291-2299`); it has no separator logic. On a freshly created file the two leading newlines are cosmetic; accepted (spec M5.3: verbatim block, blank-line separated).
- **Why not `/api/create` first:** under `upsert: true` create's `content` is *ignored* (`app.py:2376-2379`), so create cannot seed the block; create-then-append is two requests with a meaningless gap, while append with `create: true` does both in one `open(O_CREAT|O_APPEND)` (`app.py:2293`) — no TOCTOU, and concurrent captures from two phones order atomically at the kernel (`O_APPEND`).
- **Inode/atomic-write race with desktop saves:** `POST /api/file` (desktop save) writes a temp file and `os.replace`s it (`app.py:2257-2258` → `atomic_write`, `app.py:238-252`) — the path now names a **new inode**. A phone append that opened the old inode and wrote just before the replace is silently discarded while its response still reports success (`app.py:2302`); likewise any capture landing during a desktop edit session of the same file is clobbered by the save itself. v1 accepts this: the target is `Inbox.md`, a capture-only file the desktop rarely holds open; when it is open + dirty on the desktop, the watcher flags the conflict (`viewer.js:912-918` → `viewer:conflict` → badge, `tabs.js:887-891`) — the only in-app detection that exists today. Not reliably detectable from the phone; an append-aware save or per-path lock is a v2 option.
- **After success:** `NB.sidebar.refresh()` (`sidebar.js:916`) so a first-capture `Inbox.md` appears in the tree (one `/api/tree` GET per capture, fine on LAN). If the file is open in this client's tabs, leave the viewer to the watcher's mtime poll — no direct cache poke, no new event.
- **Role gating — the trap:** server-side, `file_append` is `@admin_required` (`app.py:2265`) which **bypasses when auth is off** (`app.py:661-664`) — an open server accepts the append. But `NB.auth.isAdmin()` (`auth.js:175`) returns **false** when auth is off (it requires `enabled && role === "admin"`), so gating the UI on `isAdmin()` would hide capture on every open server. Fix: `auth.js` gains `canWrite: () => { const s = authStatus; return !s || !s.enabled || s.role === "admin"; }`. The capture entry keys on `canWrite()`; a viewer never sees it (M5.5); a direct attempt hits the server's 403 and the fetch throws (`api.js:40-42`) → refusal message, never a false success.
- **Draft:** localStorage `nb:captureDraft`, written debounced on input and on `visibilitychange`/`pagehide` (backgrounding, M5.2); restored on sheet open; cleared only on confirmed success.
- **In-flight guard:** `sending` boolean; Send disabled while true — a double tap produces exactly one append (M5.4).
- **Failure:** keep sheet + draft + inline Retry; Retry re-sends the same block once. A 401 mid-send emits `auth:required` (`api.js:37-39`) → login modal (`auth.js:136`); the draft survives the post-login reload.

## 8. Touch and keyboard hardening

- **Hover-only rules:** hide `.tree-star`/`.tree-pin` on mobile (both actions live in the `…` menu — no dead UI) and reveal the code-block copy button: `.tree-star, .tree-pin { display: none; }`, `.copy-btn { opacity: 1; }` inside the phone arm. Today they are hover-gated (`style.css:2953-2980`, `:3281-3290` per research §3.2). No `:hover` rule remains load-bearing in the phone arm.
- **44 px targets:** the phone arm raises `.activity-btn` (36 px today, `style.css:224-226`), drawer rows (27 px), and every `…`/sheet control to ≥44 px with padding (HIG; research §6).
- **Capture sheet + `visualViewport`:** the sheet is bottom-anchored and listens to `window.visualViewport` `resize`/`scroll` to re-anchor above the open keyboard (iOS does not shrink the layout viewport; research §5/M4). Fallback: `resize` for Android. The field renders at ≥16 px so iOS does not zoom on focus (spec C2).
- **`#edit-toggle` hidden** on mobile (`#edit-toggle { display: none; }` in the phone arm); `#hybrid-toggle` already carries `hidden` (`index.html:98`). No edit entry point remains on a phone.
- **`#brand` must not be the mobile title:** it is a reload button — click calls `NB.viewer.reload()` (`viewer.js:1169-1171`) — so a mis-tap would discard the reading position. The phone arm hides it; the title is `#mobile-title` (opens the drawer).
- **`topbar-hidden` config class:** §3's two rules keep the topbar and back button alive on a phone even when the desktop preference is on (`app.js:294-297`, `style.css:149-150`).

## 9. File-by-file change list

New files (kept to two shipped code files + this doc):

| File | Contents |
| --- | --- |
| `static/js/mobile.js` | mode mirror (`data-ui-mode`) + `mobile:mode` event; drawer (open/close, scrim, history entries, `popstate` owner); mobile Home + settings sheet; title text + `…` menu; capture sheet (draft, guard, append, retry); resume read/write (`nb:mobileResume`); builds the sheet/scrim/state DOM at boot |
| `tests/browser/test_mobile_browser.js` | Playwright mobile harness (temp notebook via `NOTEBOOK_DATA_DIR`/`NOTEBOOK_CONFIG_DIR`, pattern of `test_designer_browser.js:28-52`) |

Edits:

| File | Change |
| --- | --- |
| `templates/index.html` | add `interactive-widget=resizes-content` to the viewport (`index.html:5`); add `#mobile-title`, `#mobile-capture`, `#mobile-more` to `#topbar`; add `#mobile-scrim`, `#capture-sheet`, `#mobile-state`, `#mobile-home`, and the settings-sheet host before `#app` closes; `<script defer src="/static/js/mobile.js">` before `app.js` (`index.html:1190`) |
| `static/css/style.css` | one appended section **inside the phone media query** (§2, §3, §6, §8), plus the `:root { --ui-mode: … }` declarations; no edits above it |
| `static/js/app.js` | delete the inline position write in `setupResize` (`app.js:507`; CSS covers it, `style.css:274`); skip `setupResize` in phone mode; boot gate for `NB.tabs.restore` (`app.js:697`); `persistConfig(keys)` mobile branch + `updateRecent` `lastFile` guard (§5) |
| `static/js/activity.js` | `collapse()`/`expand()`/`activate()` become mode-aware (`activity.js:92-150`): on phone they call `NB.mobile.closeDrawer()`/`openDrawer()` and return without touching `.collapsed`, the width var, or `activity:collapsed`/`expanded` |
| `static/js/viewer.js` | one-line early return at the top of the `popstate` handler (`viewer.js:1236`); set `#mobile-title` on every activate |
| `static/js/sidebar.js` | `…` button per tree row in `renderNode` (`sidebar.js:101-179`), CSS-hidden on desktop |
| `static/js/api.js` | `appendFile` wrapper (`api.js:47-65` block) |
| `static/js/auth.js` | `canWrite()` next to `isAdmin()` (`auth.js:166-176`) |
| `static/sw.js` | add `/static/js/mobile.js` to `PRECACHE`; bump `CACHE` (`sw.js:19`) |
| `tests/dom/test_dom.js` | a new `== mobile ==` block; tests set `document.documentElement.dataset.uiMode = "phone"` (the token is absent in jsdom) |

`app.py` gains only the two public icon routes (`/apple-touch-icon.png`,
`/apple-touch-icon-precomposed.png`); no notebook route changes. The manifest
gains `id`, `lang`, `dir` and the opaque v2 icon set. The renderer doc contract
(`ai.js`/`agent.md`) is untouched — no fence or version change.

## 10. Test plan

**jsdom** (extend `tests/dom/test_dom.js`): set `document.documentElement.dataset.uiMode = "phone"` before boot (the mode reader's fallback; `getComputedStyle` returns no custom property without `style.css`). Assert: mode mirroring; drawer open/close classes + scrim; the capture sheet posts stubbed `/api/file/append` with `create: true` and the `"\n\n"` separator, Send disabled in flight, draft save/restore/clear; `canWrite()` across the four auth states; the persist gate — opening a file in mobile mode issues a merged POST whose body equals fresh-config + `recentFiles` and never contains phone `openFiles`; the `…` click opens `NB.menu` with sidebar items AND does not open the file; `popstate` order (drawer close, then `NB.viewer.goBack`); activity-bar taps do not write `sidebarCollapsed`.

**Playwright** (real browser, real layout): viewports 390×844 (portrait), 932×430 (iPhone landscape), 1280×800 (desktop regression, C4); touch context (`hasTouch`, `isMobile`) for the mobile two. Assert: no horizontal overflow (`scrollWidth ≤ innerWidth`), `#viewer` width > 0, tab strip hidden at mobile widths / visible at 1280, 44 px target measurement, drawer lifecycle, hardware back via `page.goBack()` closes the drawer then returns the note, desktop four-column parity at 1280×800. Isolation: the harness copies the designer pattern — `mkdtemp` + `NOTEBOOK_DATA_DIR`/`NOTEBOOK_CONFIG_DIR` env + `app.py` from `.venv_<hostname>` (`test_designer_browser.js:28-52`); the real `notebook/`/`config/` are never touched (jsdom stubs `fetch` entirely; `tests/test_app.py` redirects dirs before import).

**Real iPhone [H]** (manual, spec device matrix): iOS fires no `contextmenu` — the `…` path is the only menu (C1); keyboard: `visualViewport` re-anchor + no zoom on focus (C2); rotation keeps drawer/draft/scroll (C6); safe-area insets; Add to Home Screen standalone launch + separate storage (second login when auth on; Continue/draft do not cross into the installed app).

## 11. Risks and rollback

| Risk | Exposure | Detection | Rollback |
| --- | --- | --- | --- |
| Desktop CSS regression | low — every mobile rule lives inside the phone media query; desktop never matches it | jsdom suite + Playwright 1280×800 + manual smoke | revert the appended CSS section |
| Shared-code edits regress desktop | `app.js:507` deletion (covered by `style.css:274`); viewer `popstate` gate (inert when mode off); sidebar `…` hidden but present in row DOM (`dragstart` must be prevented) | jsdom `== sidebar tree ==` / `== back button ==` blocks + desktop Playwright pass | revert the four JS hunks |
| Config clobber (phone writes desktop keys) | the whole-blob POST replaces the file (`app.py:885-895`); a naive phone persist resets desktop `openFiles`/widths to phone-boot values | jsdom merge test; manual: concurrent phone read + desktop tab change, then desktop reload (C5) | gate is one function; revert restores today's behaviour |
| Stale-merge race (GET→POST gap) | milliseconds; identical in kind to the existing two-desktop-window race (both POST whole `cfg`) | none added; accepted | n/a |
| Append race vs desktop save (§7) | silent capture loss when the desktop saves `Inbox.md` mid-capture | desktop conflict badge only (`viewer.js:917`); not detectable from the phone | accepted v1; documented |
| Mode flip mid-session (iPad rotation) | drawer closes, shell swaps | manual iPad pass | accepted (A4) |

Rollback overall: v1 is one module + one CSS section + four small JS hunks; no server, schema, or config-key changes (all mobile state is `localStorage`), so reverting the module and the CSS restores today's behaviour exactly.

## 12. v2 boundary (what v1 must not preclude)

- Note identity stays the `?file=` path; the reader never forks `NB.tabs` — one open path via `file:open-request` (`app.js:387-390`). v2 tabs and editing reuse the substrate.
- The `navStack` restore contract (`pushNav`/`applyNavEntry`, `viewer.js:1124-1161`) stays the single back source; mobile only mirrors history entries.
- The `…` menus reuse the shared item builders (`sidebar.js:691-758`) — v2 adds edit items without new menu machinery.
- `localStorage` keys are versioned (`v:1`) so v2 can migrate resume and draft.
- Editing: hybrid's structural gestures are `mousedown`/`mouseup` (`hybrid.js:4808-4809`) and will need pointer-event equivalents on touch; CM6 (vendored, `cm-bridge.js`) is the alternative input surface. v1 neither blocks nor builds either — the choice is v2's, not made here.
- Per-device prefs, if ever wanted, are additive `config.json` keys (the blob is schema-free, `app.py:885-895`); v1 adds none, so there is nothing to migrate.

**Not verified** (could not be confirmed from the code): Android Chrome long-press `contextmenu` synthesis (research §10); iOS storage-eviction window for Safari/installed-app `localStorage` (degradation is designed); real-iPhone behaviour of hover-synthesized controls (moot once §8 hides/reveals them); the 932×430 landscape figure comes from the task brief — the research table measured 390×844 portrait only.