# Mobile shell (iPhone-first) — design handoff

Status: design only. No source files changed. `web-engineer` implements
§7. Product behaviour is owned by [mobile.md](../product/mobile.md); measured
device facts by [mobile-support.md](../research/mobile-support.md).

Reference mockup: `docs/design/mobile-shell.html` (390×820, Read / Drawer /
Capture / Unreachable, mode toggle above the frame).

**Normative source.** §2 (mode signal), §3 (anatomy), §4 (components) and §5
(tokens) are the single source of truth. The mockup illustrates them; where the
two differ, this document wins.

---

## 1. Design intent

**One line:** the note is the page; every other surface is a temporary layer
over it.

The phone is a reader, not a shrunken desktop. v1 has exactly one content
column. Navigation, search, capture, settings and menus are layers that appear
over the note and dismiss back to it. Chrome is 52 px at the top and 56 px at the
bottom, both solid `--bg-panel`; the reading measure is capped at 680 px and
centred. Nothing requires hover, a right-click, or a keyboard
([mobile.md](../product/mobile.md) §4.0.3). Rendered Markdown stays un-sanitised, as on
desktop (`viewer.js` renders into `#viewer-content`).

The desktop four-column shell is not re-created. It is switched off by media
query and left byte-identical outside the query.

---

## 2. Mode signal and breakpoints

### 2.1 The signal: a CSS token read by JS

The media query is defined **once**, in CSS. Inside it, a custom property
changes. JS reads that property rather than repeating the query string, so the
two cannot drift.

```css
:root { --ui-mode: desktop; }

/* Phone shell. Two arms: a narrow window, or a touch device up to tablet
 * size (this is what carries a phone in landscape). */
@media (max-width: 860px),
       ((pointer: coarse) and (max-width: 1023px)) {
  :root { --ui-mode: phone; }
  /* … §7 layout block … */
}

/* Touch affordances, independent of layout. */
@media (hover: none) and (pointer: coarse) { /* 44 px, no hover reveal */ }
```

```js
function mode() {
  return (getComputedStyle(document.documentElement)
    .getPropertyValue("--ui-mode").trim()) ||
    document.documentElement.dataset.uiMode || "desktop";
}
```

`app.js` mirrors the value to `html[data-ui-mode]` on boot and on `resize`
(throttled), so tests and modules read one attribute. Tests set
`dataset.uiMode` directly; the token is absent when `style.css` is not linked
in jsdom.

### 2.2 Why these breakpoints

| Value | Failure it prevents |
|---|---|
| `max-width: 860px` | The default desktop grid is `48 + 240 + 1fr + 220` (`style.css:197-200`). Below 860 the `1fr` reader would be under 352 px, and at 390/360 it measures **0 px** (research §2.2). All phone portraits fit here, and so does a narrow desktop window. |
| `(pointer: coarse) and (max-width: 1023px)` | iPhone landscape is **932×430** (Pro Max) / 844×390, i.e. *wider* than the width arm. The coarse pointer is what separates those phones from a 932 px desktop window. It also covers portrait tablets up to 1023 px. |
| `(hover: none) and (pointer: coarse)` | The 88 `:hover` rules and hover-revealed `.tree-star` / `.tree-pin` / `.code-copy-btn` (`style.css:2953-2980`, `:3281-3290`) have no touch path. This arm also fixes an iPad left in the desktop shell. |
| No user-agent test | Product assumption A4: layout follows the viewport, so a narrow desktop window (e.g. 800×900) gets the phone shell. Predictable, and testable in jsdom/Playwright. |
| No `orientation: landscape` alone | A 1366×768 desktop is landscape; the coarse-pointer guard is the real signal. |

Not chosen: a flat 932 px width cut. It would reflow a 900 px desktop window
while still being one pixel short of the widest phone, and it says nothing
about the device's input.

### 2.3 Layout mode vs. role

`viewer` role is `NB.auth` state, not mode. On phone, capture is absent for
viewer (`mobile.md` M5.5) but the reader is identical.

---

## 3. Layout anatomy

```
#app (100dvh, body safe-area padding: style.css:126)
├ #topbar          52 px   back | title (flex) | + capture | … more
├ #layout          flex:1, single column, position:relative
│ ├ #editor-pane    100% width/height
│ │ ├ #tab-bar      display:none (DOM kept)
│ │ ├ #mobile-home  first-run / no-note list (mobile.js)
│ │ └ #viewer
│ │   └ #viewer-content   scrolls; max-width 680 centred
│ ├ #side-panel     fixed drawer, off-canvas by default
│ ├ #outline-pane   display:none
│ └ #activity-bar   fixed bottom rail, 56 px
├ #mobile-scrim     fixed, hidden
├ #capture-sheet    fixed bottom sheet
└ #mobile-state     fixed state screen inside the editor area
```

### 3.1 Portrait / landscape

| Zone | Portrait (390×820 ref.) | Landscape (844×390 ref.) |
|---|---|---|
| Top bar | 52 px; gutter 4 px; 44 px controls | 48 px |
| Reader | full width − 2×20 px; max 680 | max 680; gutters 24 |
| Reader bottom pad | `56 + inset + 24` | `48 + inset + 20` |
| Rail | 56 px + `env(safe-area-inset-bottom)` | 48 px + inset |
| Drawer | `min(86vw, 340px)` = 335 at 390 | `min(70vw, 320px)` |
| Search drawer | 100% width | 100% width |
| Capture sheet | `min(72dvh, 560px)` | `min(88dvh, 420px)` |
| Tab strip, outline, edit bar | hidden | hidden |
| Status | drawer footer 44 px; toast above rail | same |

**Spacing scale:** 4 / 8 / 12 / 16 / 20 / 24 px. Row rhythm is 44; the
rail is 56; top bar 52; gutters 20 (24 landscape); drawer padding 16;
sheet padding 16/24. Hit area `--m-hit: 44px`; fields `16px`.

`--topbar-h` is re-pointed to the mobile value so every existing
`calc(100dvh - var(--topbar-h) - …)` (e.g. `style.css:3384`) stays correct.

### 3.2 z-index order

| Layer | z | Source |
|---|---|---|
| Reader / content | 0 | — |
| Top bar | 100 | new mobile rule |
| Bottom rail | 150 | new mobile rule |
| Scrim | 400 | new `#mobile-scrim` |
| Drawer | 410 | `#side-panel` |
| Capture sheet | 600 | new `#capture-sheet` |
| Context menu | 1000 | `style.css:2993` |
| Login / settings overlay | 2000 | `style.css:1398` |
| Toast | 3000 | `style.css:3695` |

The menu must outrank the drawer: the per-row `…` opens `NB.menu` from inside it.

### 3.3 Safe areas

`viewport-fit=cover` is set (`index.html:5`), but the phone shell does **not**
keep the desktop `body` padding (`style.css:126`). Phone mode zeroes it and
lets each edge layer own its inset, so the app is edge-to-edge and the fixed
rail cannot leave a strip under the home indicator:

- `--topbar-h: calc(52px + env(safe-area-inset-top))`; the top bar carries
  `padding-top`, and its height replaces the body's top inset everywhere
  (`#mobile-state`, diagram max-heights).
- rail: `height: calc(56px + env(safe-area-inset-bottom))` and
  `padding: 0 right inset bottom inset left inset`.
- drawer: top/bottom and left/right insets.
- capture/settings sheet: `padding-bottom` and left/right insets.
- reader: horizontal padding includes left/right insets; bottom padding
  includes the rail plus inset (§3.1).
- toast sits above the rail plus inset.

This is the fix for the iOS "small gap at the bottom" report: the old body
padding shortened `#app` while the rail was fixed to the viewport.

### 3.4 What mobile hides (never removes)

`#tab-bar`, `#outline-pane`, `#cm-host`, `#edit-toggle`, `#outline-toggle`,
`#brand`, `.activity-bar-spacer`, `#activity-graph-btn`, `#activity-settings-btn`,
`#logout-btn`, `[data-view="ai"]` (the rail button and the panel view), plus the
table-view toolbar. `#edit-bar` and `#hybrid-toggle` are conditional: the pencil
appears with an editable note and the bar only inside an edit layer (§4.12).

These IDs are read at boot by `tabs.js`, `outline.js`, `viewer.js`,
`sidebar.js`, `activity.js`; hiding is CSS only.

---

## 4. Components

All numbers are CSS px. `--font-scale` still scales readers and chrome
(`html { font-size: calc(14px * …) }`, `style.css:117`); fields are fixed 16 px.

### 4.1 Top bar

Container: `#topbar`, 52 px, `background: var(--bg-panel)`,
`border-bottom: 1px solid var(--border)`, `gap: 4px`, `padding: 0 4px`.
The phone arm resets the shared `#topbar button` chrome (`style.css:156-160`)
for these four controls: `#topbar .icon-btn, #topbar .mobile-title
{ background: none; border: 0; padding: 0 }`.

| Part | DOM | Size | States |
|---|---|---|---|
| Back | `#back-btn` | 44×44, glyph 20 | default `--fg`; **disabled** (no nav history) `--fg-muted` at .4 opacity (`style.css:1386`); `:active` `--accent-soft`; focus ring |
| Title | new `#mobile-title` (button) | 44 high, flex 1, min-width 0 | note basename, 16 px/600, one line, ellipsis; tap opens the drawer (`mobile.md` M2.4); Home shows the site title |
| Edit | existing `#hybrid-toggle` | 44×44, ✎ 20 | hidden unless a note is open and the role can write; `.active` keeps the desktop accent fill; opens §4.12 |
| Capture | new `#mobile-capture` | 44×44, `+` 22 | hidden for viewer role; `:active` `--accent-soft`; opens §4.8 |
| More | new `#mobile-more` | 44×44, `…` 22 | `aria-haspopup="menu"`, `aria-expanded`; opens `NB.menu` anchored 4 px below the button, right-aligned; on Home opens §4.9 settings |

Order: back, title, edit, capture, more. On 390 px: 4×44 plus 4×4 gaps and
2×4 padding leaves 178 px for the title; it ellipsizes. Back is always present
but disabled on first load (`viewer.js:1121-1123`).

Note `…` menu (desktop parity per `mobile.md` M3.4):

| Item | Action |
|---|---|
| Edit note | enter WYSIWYG mode (§4.12); admin/open server only |
| Reload | `NB.viewer.reload()` |
| Copy link | `NB.app.copyLink(path)` |
| Show in Browse | open drawer, reveal + select the active row |
| *(separator, then)* Home | return to Home; open question Q2 |

Menu item height 48, font 15, left label / right optional kbd. No destructive
items in v1.

### 4.2 Activity rail

`#activity-bar` becomes `position: fixed; left: 0; right: 0; bottom: 0`,
`height: calc(56px + env(safe-area-inset-bottom))`, `flex-direction: row`,
`padding-bottom: env(safe-area-inset-bottom)`. `.activity-bar-views`:
`display:flex; flex:1 1 auto`. Each `.activity-btn` (currently 36×36,
`style.css:224-226`) becomes `flex: 1 1 0; height: 56px`, icon 22 px.

| State | Treatment |
|---|---|
| Default | `--fg-muted` glyph |
| Active | `--fg` glyph, `--accent-soft` fill; the 2 px indicator moves from the left edge to the top edge (`style.css:244-252`) |
| Pressed | `--accent-soft` |
| Disabled | n/a — no disabled views |
| Focus | 2 px `--accent` ring, offset −2 (inside the button) |

Four icons remain: Files (🗂), Bookmarks (🔖), Recent (🕘), Search (🔍). Labels
are `aria-label` only (the module already sets it, `activity.js:65`). The
rail is 56 px so a 4-item row gives 97×56 per target at 390 px.

Tapping the active icon closes the drawer (VS Code behaviour, `activity.js:92-99`),
but on phone it must **not** call `collapse()` — see §7.

### 4.3 Drawer

`#side-panel` becomes `position: fixed; top: 0; bottom: 0; left: 0;
width: min(86vw, 340px); padding-top/bottom: env(safe-area-inset-*);
background: var(--bg-panel); border-right: 1px solid var(--border);
transform: translateX(-100%); visibility: hidden;` with
`body.drawer-open #side-panel { transform: none; visibility: visible; }`.
Transition: `transform 220ms cubic-bezier(.2,.8,.2,1)`;
`visibility 0s linear 220ms` when closing, `0s` when opening. `visibility:hidden`
also removes it from tab order.

| State | Surface | Behaviour |
|---|---|---|
| Closed (default) | off-canvas, no shadow | not focusable; `aria-hidden` not required thanks to `visibility` |
| Opening | scrim fades 160 ms, drawer slides 220 ms | focus moves to the close button |
| Open | `box-shadow: 0 12px 40px rgba(0,0,0,.45)` on the right edge | inner view scrolls; header and footer stay fixed |
| Scrim | `#mobile-scrim`, `rgba(0,0,0,.45)`, fixed inset 0 | tap closes; not focusable; `role="presentation"` |
| Closing | reverse transition | focus returns to `#mobile-title` (or `#mobile-more` if opened from Home) |

Width: 86vw / max 340. Search is the exception: `body.drawer-open[data-drawer-view="search"] #side-panel { width: 100% }`.

Header: `.panel-header` (52 px on phone, `padding: 0 4px 0 16px`), title
"Files"/"Bookmarks"/… 13 px uppercase `--fg-muted`, close `×` 44×44 — the
existing `.collapse-btn` (`activity.js:177`) relabelled from `‹` on phone. Footer:
`#mobile-drawer-status`, 44 px, 12 px text: origin (mono, ellipsis) + dot + word
"Online" / "Offline". Colour is never the only signal.

Close affordances (all present, `mobile.md` §4.0.2): scrim tap, header `×`,
the visible `←` when the drawer owns the back layer, Esc, hardware/browser back,
and choosing a leaf file.

Drawer content is the existing `.side-panel-view` hosts (`#sidebar`,
`#bookmarks-view`, `#recent-view`, `#search-view`). Only one is visible,
`[hidden]` does the switching (`style.css:286`).

### 4.4 Tree rows

`.tree-row`: `min-height: 44px`, `padding: 0 0 0 4px`, `gap: 6px`, radius 8;
icon 18×18; name 15 px, ellipsis; chevron 20 px at the left of a folder; row
indent +16 px per level (the existing guide cells stay, `style.css:2794`).

| State | Treatment |
|---|---|
| Default | transparent |
| Pressed | `--accent-soft` (no hover on touch) |
| Selected / open note | `--accent-soft`, 3 px `--accent` inset on the left, name `--fg` 600 |
| Folder collapsed / expanded | chevron `0deg` / `90deg`, 160 ms; `aria-expanded` |
| Long name | ellipsis; full path available in the `…` menu |
| Row `…` | new `.tree-more`, 44×44, `margin-left: auto`, always visible on phone (never hover-gated); opens `NB.menu` anchored to the button |

Tap targets: row tap toggles a folder or opens a leaf; the `…` is a sibling
button, so it never triggers the row. Row menu (read-only v1): Open, Copy link,
Copy path. Create/rename/delete are absent, not greyed out
(`mobile.md` §4.0.3); see Q3.

The `#file-tree` scroll container keeps `-webkit-overflow-scrolling: touch`
and `overscroll-behavior: contain`. The resize handle is hidden
(`.resize-handle { display:none }`). Empty tree: the existing `.tree-empty`
copy (`style.css:2834`) — "No notes yet." — plus a Capture action when the role
allows it.

### 4.5 Search surface

Reuses `#search-view` in the drawer at 100% width, full height.

| Part | Spec |
|---|---|
| Header | 52 px: `×` 44 left, title "Search" 16/600; the case toggle sits in the input row |
| Field | 44 px high, 16 px font, `background: var(--bg)`, 1 px `--border`, radius 8; autofocus on open; clear `×` 44 when non-empty |
| Debounce | 250 ms, already implemented (`activity.js`, `mountSearch`); no request for an empty query |
| Results | grouped by file; file header 13 px `--fg-muted`; hit ≥52 px: path 14/500, snippet 13 `--fg-muted`, two lines, `<mark>` on `--accent-soft` |
| Loading | 13 px "Searching…" under the field; results stay visible |
| Empty | "No matches for “q”." query retained |
| Error | inline text + Retry 44; query and existing results retained |
| Hit tap | close drawer, open note, scroll to match, mark it (`mobile.md` M4.3) |
| Esc / back | close drawer; query is not preserved across app reloads in v1 |

### 4.6 Bookmarks / Recent

Both lists use 44 px rows: pin glyph 14 (`--warn`) for bookmarks, name 15 px
ellipsis, meta 12 px `--fg-muted` on the right (directory for Recent).
Selected: `--accent-soft` + accent text.

| State | Copy |
|---|---|
| Bookmarks empty | "No bookmarks yet. Add them from a desktop browser." (two lines, 14 px) |
| Recent empty | "No recent notes on this server yet." |
| Continue absent (first use) | row omitted, not disabled (`mobile.md` M2.1) |

No drag, no reorder, no add/remove in v1. Long-press and right-click are
absent; the row is one tap.

### 4.7 Note reader

`#viewer-content` remains the only scroller (`style.css:2388-2398`).

- `max-width: 680px; margin-inline: auto; padding: 16px 20px calc(56px + env(safe-area-inset-bottom) + 24px)`.
- Font `calc(16px * var(--font-scale))`, line-height 1.65, paragraph gap .85em.
- Headings: h1 1.7em/1.2, h2 1.4em/1.25, h3 1.2em/1.3, h4 1.05em/600; h1 keeps
  the bottom border; no first-child top margin.
- Links: `--accent`, underline, `text-underline-offset: 2px`; internal links
  open in place, external `http(s)` in a new tab, `mailto:` hands off
  (`mobile.md` M3.4).
- Code: `pre { overflow-x: auto; overscroll-behavior-x: contain; padding: 12px 14px; font-size: 13px; }`
  long lines scroll inside the block; `.code-copy-btn` is visible (not
  hover-gated) at 44×44, `top: 0; right: 0`.
- Table: already `display:block; max-width:100%; overflow-x:auto`
  (`style.css:3664`); add `overscroll-behavior-x: contain` and `border-radius: 8px`.
  Hover toolbar, row/column hiding and sort are hidden (`table-view.js`).
- Images: `max-width: 100%; height: auto`; tap does nothing.
- Diagram: `.mermaid-container` / `.wavedrom-container` / `.viz-container` /
  `.katex-container` full width, `overflow-x: auto`, `overscroll-behavior-x:
  contain`. The SVG keeps natural width and scrolls rather than shrinking below
  legibility. **Tap-to-zoom is not offered in v1** (`mobile.md` §2.2): suppress
  the mermaid lightbox click and `cursor: zoom-in` on phone.
- Block padding never exceeds the gutter; no element may widen the scroller.
- Scroll restoration: `#viewer-content.scrollTop` survives rotation and back
  (`viewer.js` restore path). `overscroll-behavior-y: contain` stops
  pull-to-refresh.
- Focus/selection: body text is selectable; chrome is not (`user-select`).

Loading: existing skeleton/spinner; no new state.

### 4.8 Capture sheet

New `#capture-sheet`, fixed, bottom-anchored, `background: var(--bg-panel)`,
`border-radius: 16px 16px 0 0`, `max-height: min(72dvh, 560px)`,
`padding-bottom: calc(12px + env(safe-area-inset-bottom))`,
`bottom: var(--m-kb, 0px)`, z 600. Scrim: `#mobile-scrim`.

```
grabber 36×4, --border, centred, 8px top
header 52px: "Quick capture" 16/600 left, × 44 right
textarea  min 96px, max 40dvh, 16px, padding 12, --bg well, radius 10
status   13px, --danger or --fg-muted, 0/2 lines
footer   Send 44px high, full width, radius 10
```

| State | Field | Send | Notes |
|---|---|---|---|
| Empty draft | placeholder "Jot something down…" | disabled: `--accent` at .5, `--accent-fg`, `cursor: default` | no request |
| Enabled | trimmed length > 0 | `--accent` / `--accent-fg`, 600 | tap once |
| In flight | field unchanged and still focused, `aria-busy` on sheet | label "Sending…", disabled | guard flag blocks a second tap (`mobile.md` M5.4) |
| Error | draft kept, focus stays | label "Retry", enabled | one block, once |
| Success | closed, draft cleared | — | toast "Saved to Inbox.md"; focus returns to `+` |
| Viewer role | sheet never opens; absent entry | — | 403 direct attempt shows "Not allowed for this role" |

Draft: `localStorage["nb:captureDraft"]`, written on input (300 ms debounce) and
on `pagehide` / `visibilitychange:hidden`; restored on sheet open and app boot.
Send: `POST /api/file/append {path:"Inbox.md", content, create:true}`
(`app.py:2264-2298`). The server appends the string verbatim, so the client
sends `"\n\n" + text.trim()` to produce the blank-line-separated block.
Close: `×`, scrim, Esc, back.

Keyboard: `visualViewport` `resize` + `scroll` compute
`--m-kb = max(0, innerHeight - vv.height - vv.offsetTop)`; the sheet and its
footer ride above the keyboard. Focus the textarea after the open transition
(≈80 ms) so iOS does not scroll the page. Rotation recomputes the inset and
keeps the draft.

### 4.9 Home and settings

Home is the no-note state and the first-run landing (`mobile.md` M2). It
renders into a separate `#mobile-home` host (built by `mobile.js`, hidden on
desktop): a vertical list of 56 px rows — Search, Continue, Bookmarks, Recent,
Browse — then the settings entry. `#welcome` stays the desktop empty state and
is not reused. On desktop `#welcome` is untouched.

Settings sheet (M6) is a bottom sheet like §4.8: theme segmented
(Auto/Dark/Light), text size segmented (S/M/L/XL), a server row (origin + dot +
word), a note that both are server-wide, and Sign out only when auth is on. No
AI, export, graph, admin or token entries. Theme and size call
`NB.app.setTheme` / `NB.app.setFontSize`.

### 4.10 Empty, unreachable, unauthorized

New `#mobile-state`, fixed inset below the top bar, fills the editor area.

| State | Content | Actions |
|---|---|---|
| Unreachable (`mobile.md` M8) | 40 px glyph, h2 "Can't reach the server", origin in mono, "Nothing is cached on this phone." | Retry (primary, 44); top bar stays |
| Note not found | h2 "Note not found", the requested path in mono | Browse, Home (44 each) |
| 403 | "Not allowed for this role" | Home |
| 401 | **not** this surface: existing `.auth-modal` (`index.html:351`) | password field, inline error, rate-limit copy |
| Empty reader | existing `#welcome` / loading state | — |

Unreachable and sign-in must never look alike (product C6): Retry vs. password.

### 4.11 Toast and menu

Toast (`.toast`, `style.css:3691`): fixed, `left/right: 16px`,
`bottom: calc(56px + env(safe-area-inset-bottom) + 12px)`, min-height 44,
radius 10, 14 px, one or two lines, auto-dismiss 2.4 s, `z-index: 3000`.
Success and warning variants keep the border colour cue and a word.

`NB.menu` (`menu.js:29-52`) is unchanged except for touch sizes: item
`min-height: 48px`, font 15, horizontal padding 14, viewport edge 10.
It is anchored to the triggering button (`x = rect.left`, `y = rect.bottom + 4`),
right-aligned when the button is in the right half. `focusFirst` is true for
keyboard users; touch does not need it.

---

## 5. Type and colour

### 5.1 Mobile tokens (add inside the phone block)

```css
:root {
  --m-hit: 44px;
  --m-topbar-h: 52px;
  --m-rail-h: 56px;
  --m-gutter: 20px;
  --m-reader-max: 680px;
  --m-radius: 10px;
  --m-sheet-radius: 16px;
  --m-scrim: rgba(0, 0, 0, .45);
}
```

No new palette. Surfaces: page `--bg`; chrome and drawer `--bg-panel`; fields
and code `--code-bg` or `--bg`; selected/active `--accent-soft`; hairlines
`--border`; primary `--accent`; primary text on accent `--accent-fg`; danger
`--danger`; status dot `--ok` / `--warn`.

Contrast (measured): `--fg` on `--bg` 13.8, on `--bg-panel` 12.6; `--fg-muted`
on `--bg` 5.21, on `--bg-panel` 4.74, on `--bg-elev` **4.26** — do not use
muted text on elevated surfaces. `--accent` on `--bg-panel` 6.0. Light theme
`--ok` 2.97 and `--warn` 3.11 on white: status *text* uses the darker
`#16703f` / `#8a5a0b` (same decision as `settings-modal.md` §3.1); dots may keep
`--ok` / `--warn`. Never colour-only: dot **and** word.

### 5.2 Type scale

| Role | Size | Weight | Line |
|---|---|---|---|
| Note body | `calc(16px * var(--font-scale))` | 400 | 1.65 |
| h1 / h2 / h3 / h4 | 1.7 / 1.4 / 1.2 / 1.05 em | 600 | 1.2–1.3 |
| Top-bar title | 16 px | 600 | 1.25 |
| Drawer row | 15 px | 400 (selected 600) | 1.35 |
| Section label | 12 px, uppercase, +.08em | 600 | 1.2 |
| Meta / snippet / status | 13 px | 400 | 1.4 |
| Rail label | — (icon only) | — | — |
| Field (input / textarea / select) | **16 px fixed** | 400 | 1.4 |
| Primary button | 15 px | 600 | 1 |

---

## 6. Interaction notes

**Drawer dismissal.** Scrim tap, header `×`, Esc, browser/hardware back, or
selecting a leaf. Selecting a folder keeps it open. Focus returns to the
control that opened it. The back layer order is: menu → sheet → drawer →
viewer nav stack → Home → browser history.

**Back layering.** `#back-btn` calls `NB.ui.closeTopLayer()` first; if it
returns true, it stops. The existing `popstate` handler (`viewer.js:1236`) gets
the same one-line guard before popping `navStack`. Recommended implementation:
push one history entry when a layer opens and close it on `popstate`; see Q1.

**Keyboard / viewport.** `100dvh` for `html`/`body` (border-box, body safe-area
padding included); `--m-kb` from `visualViewport`; `interactive-widget=resizes-content`
in the viewport meta for Chrome Android. No `position: fixed` on `body`.
The capture textarea is focused after opening, not during the slide.

**Rotation.** Nothing is rebuilt. Drawer/sheet classes persist, `--m-kb`
recomputes, `#viewer-content.scrollTop` is preserved by the browser. A request
in flight is not repeated (the send guard survives rotation).

**Momentum scroll.** `-webkit-overflow-scrolling: touch` on `#viewer-content`,
`#file-tree`, `.search-panel-list`, `.recent-list`, the drawer body and the
capture textarea. `overscroll-behavior: contain` on those scrollers: no
pull-to-refresh, no horizontal back-swipe while panning a table or diagram.
The page itself never scrolls sideways.

**Hover / right-click.** Under `(hover: none) and (pointer: coarse)`:
`.code-copy-btn { opacity: 1 }`; `.tree-star`, `.tree-pin` and the table-view
toolbar are hidden (write/optional actions, not in v1); every menu has a `…`
trigger; no action depends on `contextmenu`.

**Focus (keyboard / iPad).** `:focus-visible { outline: 2px solid var(--accent);
outline-offset: 2px; }` for buttons, rows, links and the sheet. Inputs keep
`border-color: var(--accent)` plus the ring. Focus order follows DOM order;
the off-canvas drawer is `visibility:hidden` so it is skipped.

**Reduced motion.** All drawer/sheet/scrim/chevron transitions are disabled
under `prefers-reduced-motion: reduce` (the file already has several such
blocks, e.g. `style.css:3985`); state changes remain instant and complete.

**Tap feedback.** `-webkit-tap-highlight-color: transparent` on chrome;
`:active { background: var(--accent-soft) }` on rows and buttons.

---

## 7. File-by-file changes

Design-only list; no implementation beyond the tokens above.

### `static/css/style.css` (all mobile CSS in one appended section)

1. Add `:root { --ui-mode: desktop; }` next to the theme tokens and the two
   media queries from §2.1 (the phone arm sets `--ui-mode: phone`).
2. Phone arm: `html, body { height: 100dvh }`; `--topbar-h: var(--m-topbar-h)`;
   `#layout { display: block; position: relative }`; `#editor-pane { height:100% }`.
3. Phone arm: top bar (§4.1), rail (§4.2), drawer (§4.3), reader (§4.7),
   sheet (§4.8), state screen, toast, menu sizes, `#mobile-title`.
4. Phone arm: hide §3.4 nodes with `display: none` (no DOM removal).
5. Phone arm safety net for a persisted `.collapsed` (server-rendered from a
   desktop state): `#side-panel.collapsed .side-panel-view:not([hidden])` and
   `#side-panel.collapsed .panel-header` are re-shown, later in the file (no
   `!important`). `:not([hidden])` keeps `.side-panel-view[hidden]` intact.
6. Touch arm: hover-reveal and 44 px fixes (§6).
7. `prefers-reduced-motion` overrides for the new transitions.
8. Existing `.auth-modal` (`:2281`): 16 px field, 44 px buttons, full-width up
   to 92vw under the phone arm.

### `templates/index.html`

1. `index.html:5` — add `interactive-widget=resizes-content` to the viewport.
2. `#topbar` (`:87`) — add `<button id="mobile-title">`, `<button
   id="mobile-capture">`, `<button id="mobile-more">`; move the existing
   `#hybrid-toggle` before them. Keep `#back-btn`, `#brand`, `#edit-toggle`.
3. Before `#app` closes — add `#mobile-scrim`, `#capture-sheet`, `#mobile-state`
   (all `hidden` initially) and the settings-sheet host.
4. Add `<script src="/static/js/mobile.js" defer>` before `app.js` (`:1190`).

No class or id is renamed. `#tab-bar`, `#side-panel`, `#outline-pane`, `#outline`,
`#back-btn`, `#edit-toggle` stay in the DOM.

### JS

| File | Change |
|---|---|
| `static/js/mobile.js` **(new)** | mode read/mirror, drawer + sheet layers, history guard, capture send/draft, `visualViewport`, mobile Home render, mobile settings sheet, title text, back order. ~250 lines. |
| `static/js/app.js` | **Delete `pane.style.position = "relative"` (`:507`)** — redundant (`style.css:274`, `:309`) and it defeats the media query. Guard `applySidebarState`/`applyOutlineState` (`:350`, `:359`) and `setupResize` (`:487-488`) with the mode; expose the mode on `NB.app`. |
| `static/js/activity.js` | Make `collapse()`/`expand()` (`:126-150`) mode-aware: on phone they call `NB.ui.closeDrawer()`/`openDrawer()` and return without touching `.collapsed`, the width var, or `activity:collapsed`/`expanded`, so `sidebarCollapsed` is never persisted from a phone (product C5). `activate()` (`:92`) routes to the drawer the same way. `makeCollapseBtn()` (`:177`) uses `×` on phone and `‹` on desktop. |
| `static/js/viewer.js` | Back handler (`:1164`) closes the top layer first; set `#mobile-title` on every activate (same place as the tab title). Editing is untouched; CSS hides its entry points. |
| `static/js/mermaid.js` | Skip the lightbox click and `cursor: zoom-in` on phone. |
| `static/js/table-view.js`, `table-select.js` | No-op on phone (CSS alone hides the toolbar; guards prevent arming). |
| Search view in `activity.js` | Autofocus the field when opened on phone; debounce 250 ms already exists. |
| `static/js/api.js` | Add `appendFile: (path, content, create) => request("POST", "/api/file/append", {path, content, create})`. |
| `static/js/hybrid.js` | v2 (§4.12): phone-only Done/Save labels, the toolbar touch-selection guard, and the canWrite gate on the pencil. |
| `static/js/settings.js`, `export.js`, `ai.js`, `graph.js` | No change. Their entry points are hidden or their views unmounted on phone. |
| `tests/dom/test_dom.js` | New `== mobile ==` block: set `dataset.uiMode="phone"`, assert drawer open/close, capture states, 44 px CSS presence, edit controls hidden, no config write on drawer toggle. |

The drawer "wins" without `!important` because (a) the only inline positioning
is the line deleted above, and (b) the drawer width is `min(86vw, 340px)`, not
`var(--side-panel-width)`, so the inline width written by `app.js:352` /
`activity.js:130` is simply never read in the phone arm.

---

## 8. Mapping table (mockup → app DOM)

| Mockup element | Existing id / class | Notes |
|---|---|---|
| `.screen` | viewport; `body` safe-area | `style.css:126` |
| `.topbar` | `#topbar` | `index.html:87` |
| `.back` | `#back-btn` | `index.html:97`, `viewer.js:1164` |
| `.title` | new `#mobile-title` | button, opens drawer |
| `.capture` | new `#mobile-capture` | opens sheet |
| `.more` | new `#mobile-more` | anchors `NB.menu` |
| `.menu` | `#nb-menu` | `menu.js:17` |
| `.rail` | `#activity-bar`, `.activity-bar-views` | `index.html:110`, `activity.js:54` |
| `.rail-btn` | `.activity-btn` | `style.css:224` |
| `.rail-badge` | `.activity-btn.active::before` | `style.css:244` |
| `.scrim` | new `#mobile-scrim` | one scrim for both layers |
| `.drawer` | `#side-panel` | `index.html:128` |
| `.drawer-head` | `.panel-header` / `.panel-title` | `style.css:311` |
| `.drawer-close` | `.collapse-btn` / `NB.activity.makeCollapseBtn()` | `activity.js:177` |
| `.status` | new `#mobile-drawer-status` | origin + reachability |
| `.tree-row` | `.tree-row`, `.tree-children` | `sidebar.js` render |
| `.tree-more` | new `.tree-more` | per-row `…` |
| `.search` | `#search-view` (`.side-panel-view[data-view="search"]`) | `activity.js` mount |
| `.bookmarks / recent` | `#bookmarks-view`, `#recent-view` | module hosts |
| `.reader` | `#viewer`, `#viewer-content` | `index.html:271-272` |
| `.table` | `.markdown-body table` | `style.css:3664` |
| `.code` | `.markdown-body pre` | `style.css:3251` |
| `.diagram` | `.mermaid-container` / `.wavedrom-container` / `.viz-container` / `.katex-container` | renderer blocks |
| `.sheet` | new `#capture-sheet` | |
| `.state` | new `#mobile-state` | unreachable / not found / 403 |
| `.toast` | `.toast` (`.show`) | `style.css:3691`, `NB.app.notify` |
| `.login` | `.settings-modal.auth-modal` | `index.html:351` |

---

## 9. Resolutions and remaining questions

The implementation answers are in [`../architecture/mobile.md`](../architecture/mobile.md):

| Question | Resolution |
|---|---|
| History layers | One `pushState` per drawer and per note; `mobile.js` owns `popstate`, and `viewer.js`'s handler returns early in phone mode (§4 of the architecture doc). |
| Home host | A separate `#mobile-home` view rendered by `mobile.js`; `#welcome` stays the desktop empty state. |
| Tree `…` items | Open / Copy link / Copy path only. File management is out of v1 (product §2.2). |
| Capture target | `Inbox.md` at notebook root; `append` with `create:true`. No folder variant. |
| Tablet split | Portrait tablets up to 1023 px get the phone shell; 1024 px and above stay desktop. |
| iPad + trackpad | Still open: an iPad with a trackpad reports hover and fine pointer, so it keeps desktop hover behaviour. Use `(any-pointer: coarse)` for hit areas only if this proves wrong on a device. |

### 4.12 Edit mode (WYSIWYG)

Editing is a layer over the reader, not a second screen. Entering it swaps the
rendered note into the contenteditable surface in place; the address, note, and
scroll do not change.

```
top bar      52 + inset   back ← (exits) · title · ✎ active
edit bar     52           [💾 Save][✕ Done] │ undo redo │ H1 H2 H3 … (scrolls →)
reader       1fr           the note, now editable
rail         hidden       the keyboard owns the bottom edge
```

- **Entry.** ✎ in the top bar, or **Edit note** as the first `…` item. Both
  absent for a viewer role and with no note open.
- **Edit bar.** One horizontal strip, `background: var(--bg-panel)`
  (`--bg-elev` under the top bar would read as a second header), a 1 px
  `--border` bottom edge, 8 px vertical padding, 44 px controls, 2 px gaps.
  It scrolls sideways; the horizontal scrollbar is hidden. `Save` and `Done`
  are pinned at the left with a soft right shadow, so they are reachable
  whatever the scroll position.
- **Hidden while editing.** Rail, `+`, `…`, and the drawer title action. Back
  (top bar, hardware, browser, Esc) exits editing instead of navigating.
- **Keyboard.** The shell height is `100dvh - var(--m-kb)`, so the reader ends
  above the keyboard rather than under it. Tapping a formatting control keeps
  the keyboard and the caret.
- **Saving.** `Save` writes immediately and toasts “Saved”. `Done` and back
  save when autosave is on, otherwise ask; the exit path never discards typed
  text without a prompt or a recoverable draft.
- **Not offered.** The flyout menus (table actions, list move, examples,
  emoji) are display:none on the phone; the remaining buttons are a single
  scrollable row. Drag-reorder grips and the right-click menu stay desktop.

