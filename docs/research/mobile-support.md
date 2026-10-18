# Mobile support: facts for a read + quick-capture v1

**Status:** fact document, not a design. Researched 2026-10-18.
**Scope:** iPhone first; Android Chrome and other mobile browsers; the existing Flask + vanilla-JS notebook; plain HTTP on the LAN; no new framework; no TLS or reverse proxy.
`[observed]` = read in a source or measured here; `[inferred]` = conclusion from sources; `[not established]` = the sources do not settle it.

**Finding in brief.** The app has PWA groundwork, but at phone widths the editor
column collapses to 0 px, file management is right-click-only, and the worker is
scoped to `/static/`. Plain HTTP blocks service workers and Android install, while
iOS Add to Home Screen still works and uses separate storage. No framework is
indicated by the evidence.

## 1. Purpose and constraints

Establish what is already true about this app on a phone, and what blocks reading and quick capture. This informs the delivery shape (responsive web, installed web app, native shell), auth/storage, and whether a framework is required. It does not choose a solution. Constraints: iPhone primary; Android Chrome and other mobile browsers must work; plain HTTP on the LAN; no new frontend framework; no TLS or reverse proxy.

## 2. What already exists

| Piece | Evidence | State |
| --- | --- | --- |
| Mobile viewport, notch padding | `templates/index.html:5`, `static/css/style.css:126` | `viewport-fit=cover` and `env(safe-area-inset-*)` are present. |
| iOS standalone metadata | `templates/index.html:6-9` | `apple-mobile-web-app-capable`, status-bar style, title, `mobile-web-app-capable`. |
| Manifest | `static/manifest.json:5-7`, linked at `templates/index.html:24` | `start_url: "/"`, `scope: "/"`, `display: "standalone"`, three icons. |
| Service worker | `static/sw.js:19-27`, registered at `templates/index.html:1191-1195` | Network-first pages/assets, network-only `/api/`, precaches `/` and app files. |
| Phone-safe content CSS | `static/css/style.css:3260`, `:3664`, `:3680`, `:3371-3384` | Code/tables scroll horizontally, images cap at 100%, `dvh` is used. |
| Auth | `app.py:965`, `app.py:3033` | Signed session cookie with `role`; bcrypt passwords; named Bearer tokens. |
| Capture/edit API | `app.py:2264`, `app.py:2305`, `app.py:2365` | Atomic append, ordered patch batch, idempotent create with seed content. |
| Editors | `package.json:18`, `static/js/hybrid.js:4803-4814` | CodeMirror 6.43.6 vendored; hybrid uses `contenteditable` + mouse/keyboard. |
| No-build modules | `templates/index.html:1180-1190`, `package.json:5-9` | IIFE modules extend `window.NB`; no app bundler. |

### 2.1 Service-worker scope

`[observed]` The worker is registered at `/static/sw.js` with no `scope`
(`templates/index.html:1193`). The default scope is the script's directory
(`https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register`,
read 2026-10-18), so it controls `/static/`, not `/`.

Measured in Chromium 154 via Playwright on 2026-10-18: registration scope
`http://127.0.0.1:5599/static/`, and `navigator.serviceWorker.controller` null on
`/`. No `Service-Worker-Allowed` header exists: grep over `app.py`, `static/`,
`templates/` found none, and `GET /static/sw.js` lacked it. A worker cannot broaden
scope without that header
(`https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Service-Worker-Allowed`,
read 2026-10-18).

The `"/"` entry in `PRECACHE` (`static/sw.js:27`) is cached at install, but no
top-level navigation is in scope, so it is never served from that cache. On plain LAN
HTTP the worker does not register at all (Section 4), so the bug is latent for this
deployment but active on localhost or HTTPS.

### 2.2 Current phone-width layout

`[observed]` `#layout` is a four-column grid:
`48px var(--side-panel-width) 1fr var(--outline-width)` (`static/css/style.css:197-200`);
both panels default open (`sidebarWidth: 240`, `outlineWidth: 220`, collapsed flags
false, `static/js/app.js:37-40`). Measured in Chromium 154 mobile emulation (isMobile,
hasTouch, DPR 3; server at `http://127.0.0.1:5599/`), 2026-10-18:

| Viewport | Computed columns | `#viewer` width | Top bar `scrollWidth` / `clientWidth` |
| --- | --- | --- | --- |
| 390 x 844 | `48px 240px 0px 220px` | 0 px | 540 / 390 |
| 360 x 800 | `48px 240px 0px 220px` | 0 px | 540 / 360 |

The editor column resolves to 0 px, not merely cramped. The top bar is a non-wrapping flex row (`static/css/style.css:139-148`) with a fixed 280 px search (`:178`); at 390 px the search spans 121-401, back 471-504, edit 510-540, so right-side controls are off-screen and no horizontal scroll container is configured. The settings modal is `min(75vw, 96vw)` with a fixed 180 px nav (`static/css/style.css:1833-1836`, `:1941`; sections at `:1993`); at 390 x 844 it measured 293 x 717, nav 180, content 111 px; at 360 x 800, 270 x 680, nav 180, content 88 px. `.settings-modal` sets `touch-action: none` (`:1848`).

## 3. Blocker inventory, ranked by severity

| Rank | Severity | Blocker | Evidence | Effect |
| --- | --- | --- | --- | --- |
| 1 | Critical | Editor column 0 px at phone widths | `static/css/style.css:197-200`, `static/js/app.js:37-40`; measurements above | Reading and editing cannot work until panels collapse or overlay. |
| 2 | Critical | File actions only via `contextmenu` | `static/js/sidebar.js:132,173,383,435,778,1141`; `static/js/tabs.js:386`; `static/js/hybrid.js:6183`; `static/js/menu.js:29-52` | Safari iOS fires no `contextmenu`; create/rename/copy/delete are unreachable on iPhone. |
| 3 | High | Essential controls hidden until hover | `static/css/style.css:2953-2980` (star/pin), `:3281-3290` (copy); 88 `:hover` rules | No reliable reveal path on a touch-only device. |
| 4 | High | Structural gestures are mouse/keyboard only | `static/js/app.js:521-539`; `static/js/tabs.js:657-660`; `static/js/lightbox.js:243-251`; `static/js/table-select.js:53,257-270` | Pane resize, tab reorder, lightbox pan, and rectangular table copy have no touch path. |
| 5 | Medium | Tap targets below accessibility minimums | `static/css/style.css:224-226`; measurements in Section 6 | Controls are hard to hit reliably. |
| 6 | Medium | Settings content column 88-111 px | Measurements above; `static/css/style.css:1833-1836,1941,1993` | Settings are reachable but impractical at phone width. |
| 7 | Medium | Worker cannot control the app | `templates/index.html:1193`; `static/sw.js:27`; measured scope `/static/`; no `Service-Worker-Allowed` | Offline/PWA caching does not apply to `/`; the precached `"/"` is unusable. |
| 8 | Medium | Top bar overflows without scrolling | `static/css/style.css:139-148,178`; `scrollWidth` 540 | Search and edit controls are clipped off-screen at 390 px and 360 px. |

### 3.1 Why the context-menu gap is critical on iPhone

`[observed]` MDN browser-compat-data sets `api.Element.contextmenu_event` support for
`safari_ios` to `false`, linking WebKit bug 213953
(`https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/Element.json`,
read 2026-10-18); the BCD issue records no event on iOS 7-14
(`https://github.com/mdn/browser-compat-data/issues/6376`, read 2026-10-18).

File, folder, pinned-folder, tab, and hybrid menus all open from `contextmenu`
handlers; `NB.menu.open` takes an owner, x/y, scope, and items and has no trigger
(`static/js/menu.js:29-52`). `[inferred]` On iPhone those handlers never fire, so file
management is unreachable. Android Chrome may synthesize a long-press `contextmenu`;
that was not tested.

### 3.2 Hover and touch

`[observed]` The stylesheet has 88 `:hover` rules and zero `(hover: none)` /
`(pointer: coarse)` queries (grep, 2026-10-18); both matched true in the emulated
phone. `.tree-star`/`.tree-pin` are `display: none` until `.tree-row:hover`;
code-copy buttons start at `opacity: 0` and appear on hover or `:focus-within`
(`static/css/style.css:3281-3290`). `[inferred]` Some mobile browsers synthesize hover
on first tap, but there is no explicit touch path, so these controls are not
dependable.

## 4. Delivery options: facts

| Option | Works over plain HTTP? | Install / shell | Offline | What the facts require |
| --- | --- | --- | --- | --- |
| Responsive web in the phone browser | Yes | No install; browser chrome remains | No | CSS/JS changes to the existing app; no new framework. |
| iOS Home Screen web app | Yes | Add to Home Screen; standalone from existing meta/manifest | No worker over HTTP | Same web code; separate storage and login expected (Section 5). |
| Android installable PWA | No | Chromium install promotion requires HTTPS or localhost | No | TLS/reverse proxy first; then fix worker scope. |
| Native shell | Possible with platform network exceptions | App install/distribution | Depends on the shell | iOS ATS exception for HTTP; same-origin WebView or CORS + Bearer. |

**Plain HTTP is not a secure context.** `[observed]` MDN lists `http://example.com` as not secure and `http://localhost` as secure (`https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts`, read 2026-10-18). Service workers may only be registered from a secure context (MDN `ServiceWorkerContainer.register`, read 2026-10-18). `[inferred]` A phone loading `http://192.168.x.x:5000` is not a secure context: no worker, no offline cache, no Android install promotion. The server's own `http://127.0.0.1:5000` is secure only because it is loopback.

**iOS Home Screen still works over HTTP.** `[observed]` WebKit's Safari 26.0 release notes (2025-09-15) say "there are now zero requirements for 'installability' in Safari. Users can add any site to their Home Screen and open it as a web app on iOS 26 and iPadOS 26." (`https://webkit.org/blog/17333/webkit-features-in-safari-26-0/`, read 2026-10-18). WebKit says the manifest has been supported since iOS 11.4 and the legacy meta tag since 2008; the repo supplies both (`templates/index.html:6`, `static/manifest.json:7`). `[inferred]` Plain HTTP does not block iOS Add to Home Screen: it is browser UI, and WebKit states no installability requirements. The secure-context rule applies to workers, not the shortcut. No iPhone was tested; iOS 18-and-earlier standalone behavior is inferred from the meta/manifest contract.

**Android install is blocked by HTTP.** `[observed]` MDN says a PWA must be served over HTTPS, or localhost/127.0.0.1, to be installable (`https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable`, read 2026-10-18). `[inferred]` On a LAN IP over HTTP, Chrome Android offers no install/WebAPK and no worker. A bookmark shortcut may exist, but that is not an installed PWA and was not tested.

**Native shell costs.** `[observed]` Apple's ATS documentation says ATS requires HTTPS for URLSession connections and is bypassed only with `NSAppTransportSecurity` exceptions such as `NSAllowsArbitraryLoadsInWebContent` or `NSExceptionDomains` (`https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity`, read 2026-10-18). `[inferred]` A native iOS shell loading the HTTP notebook needs an ATS exception even if it only wraps the page in a WebView. `[observed]` The backend has no `Access-Control-Allow-*` headers: grep over `app.py` found none; the only `after_request` hook sets `Cache-Control` on gated reads (`app.py:83-96`). Bearer tokens exist and are authoritative when presented (`app.py:580-600`). `[inferred]` A native client calling the API from another origin needs CORS; without it, only a same-origin WebView can use the cookie session. A cross-site cookie would also be blocked by the default `SameSite=Lax` (Section 5).

**Why no framework.** `[inferred]` The blockers are a CSS grid that does not collapse, event listeners that only handle mouse/right-click, hover-only visibility, and a mis-scoped worker. None is a rendering-model problem. The app already has no-build modules, a JSON API, client-side Markdown rendering, and two editors. A framework would not change iOS `contextmenu` support, secure-context rules, ATS, or iOS standalone storage separation. The evidence does not establish a framework requirement; it points to changes in existing CSS and event handling.

## 5. Auth and storage implications

`[observed]` Login sets `session["role"]` (`app.py:965`); Flask's secret is the `auth.json` secret (`app.py:3033`). A live login on 2026-10-18 returned `Set-Cookie: session=...; HttpOnly; Path=/` — no `Secure`, no `SameSite`, no `Expires`/`Max-Age`. Flask defaults are `SESSION_COOKIE_SECURE=False`, `SESSION_COOKIE_SAMESITE=None`, `SESSION_COOKIE_HTTPONLY=True` (`https://flask.palletsprojects.com/en/stable/config/`, read 2026-10-18); the app sets none of these. MDN says browsers default an absent `SameSite` to `Lax` (`https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie`, read 2026-10-18). `[inferred]` Same-origin browser use over HTTP works: the cookie is not marked `Secure`, and `Lax` is sufficient for same-origin `fetch`. Setting `SESSION_COOKIE_SECURE=True` would break login over HTTP.

The app never sets `session.permanent`; the cookie had no expiry, so it is a browser-session cookie. Flask's 31-day lifetime applies only when `session.permanent` is true; lifetime across iOS standalone suspension is not established. iOS Home Screen web apps have separate cookies and storage from Safari: Apple's WWDC23 session says they have "separate cookies and storage from the browser" (`https://developer.apple.com/videos/play/wwdc2023/10120/`, read 2026-10-18). `[inferred]` With auth on, expect a second login inside the installed app.

Server data is files under `notebook/`; every mutation goes through `safe_path` and atomic writes. Quick capture can use `/api/file/append` with `create: true` (single `O_APPEND`; parent must exist) or `/api/create` with `upsert: true` and optional `content` (`app.py:2264-2298`, `app.py:2365-2413`). All are `@admin_required` (`app.py:2265`, `app.py:2366`); a viewer cannot capture. Client-side state (AI chat, table view) uses `localStorage` (`static/js/ai.js:1004`, `static/js/table-view.js:71`) and is not notebook data.

## 6. Mobile browser constraints

- `[observed]` Safari iOS has no `contextmenu` event (`api.Element.contextmenu_event`, `safari_ios.version_added = false`; MDN BCD, read 2026-10-18).
- `[observed]` WCAG 2.2 SC 2.5.8 requires a 24 x 24 CSS-pixel target, or sufficient spacing/equivalent (`https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html`, updated 2026-05-11, read 2026-10-18). Apple HIG gives a general 44 x 44 pt hit region for buttons (`https://developer.apple.com/design/human-interface-guidelines/buttons.md`, change log 2025-12-16, read 2026-10-18).

`[observed]` Measured target sizes at 390 x 844 (Chromium 154 emulation):

| Control | Measured | WCAG 24 x 24 | HIG 44 x 44 |
| --- | --- | --- | --- |
| Activity button | 36 x 36 | passes | below |
| Panel collapse | 14 x 19 | below; spacing not assessed | below |
| Tree row | 223 x 27 | passes | below height |
| Tab close | 19 x 16 | below; spacing not assessed | below |
| Top-bar edit | 30 x 25 | passes | below |

- `[observed]` Pane resize uses mouse events (`static/js/app.js:521-539`); tab reorder uses HTML5 drag events (`static/js/tabs.js:657-660`); lightbox pan uses mouse events (`static/js/lightbox.js:243-251`). No pointer/touch equivalents are wired.
- `[observed]` Table rectangle selection arms only on Ctrl/Meta (`static/js/table-select.js:53,257-270`); touch has no modifier. Hybrid structural gestures are `mousedown`/`keydown` (`static/js/hybrid.js:4803-4814`); iOS behavior is not established.
- `[observed]` `.settings-modal` has `touch-action: none` (`static/css/style.css:1848`). Chromium emulation still scrolled the inner pane; iOS was not tested.
- `[inferred]` `viewport-fit=cover` and safe-area padding are already present, so a standalone iOS launch should not need a separate safe-area fix. The black-translucent status bar (`templates/index.html:7`) means the top bar sits under the status-bar area unless the existing padding handles it.

## 7. What can be reused without a rewrite

- `[observed]` The Flask JSON API, `safe_path`, `atomic_write`, auth (cookie and Bearer), and the tree/listing/file/create/edit/append/search routes. No second backend is needed.
- `[observed]` The Markdown renderer and block pipeline run client-side; tables, code blocks, and images already have phone-safe overflow rules (`static/css/style.css:3260,3664,3680`).
- `[observed]` `NB.menu` is descriptor-driven with four-edge positioning and keyboard navigation (`static/js/menu.js:29-52`). It does not depend on `contextmenu`; only the trigger is missing. Sidebar, tabs, bookmarks, and hybrid already build item lists and call `NB.menu.open`; a visible button/tap handler can reach the same menus.
- `[observed]` CodeMirror 6.43.6 and the hybrid `contenteditable` path already exist; capture can also be a plain form against `/api/file/append` or `/api/create`.
- `[observed]` The manifest and iOS meta tags already exist; a Home Screen launch reuses the same HTML/CSS/JS. `config/config.json` persists panel widths and collapse state as an opaque JSON object, but its defaults are desktop values (`static/js/app.js:37-40`).
- `[observed]` The frontend uses standard `fetch` and DOM APIs; no browser-specific plugin or framework is required. The constraints found are browser behavior (contextmenu, secure contexts, ATS), not missing APIs.

## 8. Facts the implementation must respect

1. Do not rely on `contextmenu` for any action that must work on iPhone; Safari iOS has no support (MDN BCD).
2. Do not rely on `:hover` to reveal an essential control; there is no `(hover: none)`/`(pointer: coarse)` branch.
3. At phone widths `48 + 240 + 0 + 220 = 508` px of fixed columns exceed the viewport; the `1fr` editor column resolves to 0. Panels must collapse, overlay, or otherwise leave width for the editor.
4. The 280 px search plus the non-wrapping top bar produces a 540 px row at a 390 px viewport; the overflow is clipped, not scrollable.
5. Every server file operation must continue through `safe_path`; mobile routes must not accept raw paths.
6. The cookie session is same-origin and HTTP-compatible only while `Secure` is off. Cross-origin native clients need CORS and Bearer tokens; no CORS headers exist.
7. iOS standalone storage is separate from Safari; auth-on deployments get a second login inside the installed app.
8. A worker at `/static/sw.js` cannot control `/` without `Service-Worker-Allowed`; moving the registration alone is not enough. On plain LAN HTTP there is no worker, so offline is unavailable through the web app.
9. Tap targets below 24 x 24 need the WCAG spacing exception or a larger hit area; the measured 14 x 19 and 19 x 16 controls do not meet the size rule.

## 9. Open questions

Scope decisions taken after this research (capture target, v1 read/capture
boundary, hidden outline) live in [`../product/mobile.md`](../product/mobile.md),
not here. The facts still open:

- Will auth be enabled on the LAN, and is a second login inside the iOS Home Screen app acceptable?
- What minimum iOS version is supported? iOS 26 opens every Home Screen site as a web app; earlier versions depend on the meta/manifest contract.
- Is a visible overflow/search control acceptable, or should search move behind an icon?

## 10. Not established

- Real iPhone behavior of the hybrid editor's mouse/keyboard structural gestures.
- Real iPhone behavior of hover-synthesized star/pin/code-copy controls.
- Whether Android Chrome's long-press fires `contextmenu` for this app's handlers.
- Session-cookie lifetime across iOS standalone suspension or storage eviction.
- Whether `touch-action: none` on `.settings-modal` blocks inner scrolling on iOS. Chromium emulation scrolled; iOS was not tested.
- Actual runtime performance of `static/js/hybrid.js` (281,378 bytes) and `static/js/ai.js` (109,594 bytes) on a mid-range phone.
- Whether plain HTTP Add to Home Screen produces standalone mode on iOS 18 and earlier; the meta/manifest contract and WebKit's iOS 26 statement support it, but no device test was run.
- Whether an Android home-screen shortcut over HTTP behaves usefully without an installed PWA.
- The exact first-launch auth state of an iOS Home Screen app when auth is on and a Safari session exists. Apple documents separate storage; iOS copy behavior was not tested.

## 11. Implication for the decision

The evidence points to a responsive change in the existing web app as the only shape that works under plain HTTP and the no-framework constraint; iOS Home Screen wrapping reuses that same code, while an Android installable PWA is blocked by the missing secure context and a native shell adds ATS/CORS work without removing the server's HTTP constraint. That is an implication of the facts, not a design; the delivery and scope decisions belong to `plan`, `architect`, or the user.
