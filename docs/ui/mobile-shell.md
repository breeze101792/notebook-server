# Mobile shell — the phone mode

Status: Current spec — pre-implementation (codifies the shipped phone shell).

Reference mockup: [`mobile-shell-mockup.html`](mobile-shell-mockup.html) — reader, rail,
drawer, Home, capture, capture error, settings sheet, auth-locked and offline, in dark and
light at 390 × 844.

**Normative source.** This document owns the phone shell: the mode switch, topbar, rail,
drawer, Home, capture sheet and settings sheet. It reads [`foundations.md`](foundations.md),
[`controls.md`](controls.md) and [`shell-frame.md`](shell-frame.md) §6. The individual views
inside the drawer are owned by their own docs. Every claim cites `file:line`.

**The shipped look is the target.** Applied exceptions are listed in §11.4; anything else
visual is a proposal in §13.

---

## 1. Mode

| Thing | Rule | Source |
|---|---|---|
| Switch | `(max-width: 860px), ((pointer: coarse) and (max-width: 1023px))`, defined once | `style.css:6975` |
| Signal | `--ui-mode: phone`; JS mirrors it to `html[data-ui-mode]` | `:6977`, `mobile.js:85` |
| Shell | `#layout` becomes one column; `#editor-pane` fills; tab bar, outline, CM host and desktop welcome hide | `:7082-7090` |
| Tokens | `--m-hit` 44, `--m-topbar-h` 52, `--m-rail-h` 56, `--m-gutter` 20, `--m-reader-max` 680, `--m-radius` 10, `--m-sheet-radius` 16, `--m-scrim` `.45` | `:6977-6986` |
| Body | `100dvh`, padding 0; each edge layer applies its own safe-area inset | `:6990-6998` |

There is no second mode switch. A component phone rule lives inside this query.

---

## 2. Topbar

52 px + top inset. Order: workspace chip, back, title, capture, more.
`#brand`, the spacer, `#edit-toggle`, `#hybrid-toggle`, the outline toggle and the desktop actions
hide. Editing is entered from the note menu, so the bar spends its width on the title.

| Part | Value | Source |
|---|---|---|
| Height | `calc(52px + env(safe-area-inset-top))` | `:6991` |
| Padding | `env(top) calc(4px + right) 0 calc(4px + left)` | `:7005-7009` |
| Gap | 4 px | `:7004` |
| Chip | secondary chip, 44 high, max 240 wide | `:8198-8208` |
| Back | 44 × 44, disabled with no history | `:7011-7040` |
| Title | flex 1, 600 16/1.25, ellipsis; names the open note | `:7055-7062` |
| Hybrid | **not shown**; `Edit note` is the first item of the note menu (`mobile.js` `openMore`) | `mobile.js:786-800` |
| Capture | 44 × 44; hidden for a viewer | `:7048` |
| More | 44 × 44; opens the note menu | `:7048-7053` |
| Auth-locked | bar at 25 % opacity, pointer-events none; title/capture/more/hybrid hidden | `:7054-7062` |

Topbar-hidden is forced off on the phone: the bar is always visible.

---

## 3. Rail

A fixed bottom bar, 56 px + bottom inset, z 150, one row: the **first six visible views in the user's
saved bar order**, then More.

| Slot | Default view | Source |
|---|---|---|
| 1 | Explorer | `activity.js:1487` |
| 2 | Sessions | `activity.js:1490` |
| 3 | Pinned folders | `activity.js` |
| 4 | Bookmarks | `activity.js` |
| 5 | Recent files | `activity.js` |
| 6 | Search | `activity.js` |
| 7 | **More** — always last, never a view | [`mobile-more-sheet.md`](mobile-more-sheet.md) |

The six are a slice of the saved bar order, not a set: reorder the bar on desktop and the rail follows
it; a view pushed past slot 6 moves to the More sheet (`mobile-more-sheet.md` §1.1). AI is the one view
with no phone surface, so it takes neither a slot nor a More row. Settings and Sign out are More rows.
The Tabs view registers after AI, so in the default order it is the first view past the six and opens
from the More sheet until the user promotes it ([`tabs-view.md`](tabs-view.md) §2).

Each button is `flex: 1 1 0`, min 44 wide, rail height, radius 0. A sprite glyph is `--icon-lg` (17 px);
a text glyph is 22 px. Active gets `--accent-soft` and a 2 px top indicator at 24–76 %. There is no
hover state; `:active` paints the wash. More is never a view: it carries `aria-expanded` and no active
face — its sheet and the scrim cover the rail while it is open.

---

## 4. Drawer

| Part | Value | Source |
|---|---|---|
| Width | `min(86vw, 340px)` | `:7216` |
| Position | fixed, top 0, bottom rail, left, z 410 | `:7214-7228` |
| Slide | transform 220 ms `cubic-bezier(.2,.8,.2,1)`; visibility delayed 220 ms | `:7220-7233` |
| Scrim | `#mobile-scrim`, `--m-scrim` .45, z 400 | `:7238-7242` |
| Open | `body.drawer-open`; the panel is visible and slides in | `:7226-7233` |
| Search view | drawer width 100 % | `:7234` |
| Close | the panel header's `×` or a scrim tap | `mobile.js:332-360` |
| Resize | none; the strip is hidden | `:7236` |

The drawer contains the same side-panel views as desktop; the view keeps its state. The
panel header is 52 high with a 44 px close. Focus moves into the drawer on open and returns
to the opener on close.

---

## 5. Home

Home is the phone's no-note screen (`#mobile-home`), replacing the desktop welcome.

| Row | Glyph | Action | Source |
|---|---|---|---|
| Search | `#nb-icon-search` | opens the Search drawer | `mobile.js:521` |
| Continue | `#nb-icon-file` | reopens the last note at the saved scroll; absent on first use | `:523-525` |
| Bookmarks | `#nb-icon-bookmark` | opens the Bookmarks drawer | `:527` |
| Recent | `#nb-icon-clock` | opens the Recent drawer | `:528` |
| Browse | `#nb-icon-explorer` | opens the Explorer drawer | `:529` |
| Settings | `#nb-icon-settings` | opens the settings sheet | `:535` |

**The glyphs are the desktop sprites**, the same symbols the activity bar draws. Home used to show
emoji (🔍 🔖 🕒 🗂 ⚙); that set is retired, so one icon means one view across the rail, Home and the
More sheet. Sign out is not a Home row: it is the settings sheet's last control and a More row.
(`mobile-shell.md` §5 previously claimed both; the code never had them.)

Title 22/600, subtitle 14 muted — `<session name> · Read or capture a note.` when the active session
has a name, so a switch that lands on an empty session says where it landed. Rows 56 with a 17 px
`--icon-lg` glyph in a 24 px box, 2 px gap, separators between groups (`style.css:8389-8433`).
Auth-locked hides Home.

---

## 6. Capture sheet

A bottom sheet for quick capture: it appends a paragraph to `Inbox.md`.

| Part | Value | Source |
|---|---|---|
| Shape | bottom sheet, `max-height: min(72dvh, 560px)`, radius 16 top, z 600 | `:7593-7605` |
| Header | title `Quick capture`, 52 high, 44 px close | `:7610-7620` |
| Body | one textarea, 4 rows, 16 px type, placeholder `Jot something down…` | `:7622-7635` |
| Status | one line, `role="status"`, `aria-live="polite"` | `:7637` |
| Send | 44 high, disabled while empty or sending; label `Send` | `:7639-7642` |
| Draft | typed text persists per workspace; restored on reopen | `mobile.js:70-82` |
| Success | sheet closes; the note is appended | `mobile.js:580-640` |
| Error | status line, draft kept, Send re-enabled | `:600-640` |

The scrim is shared. The sheet sits above the rail and lifts with `--m-kb` when the keyboard
is open.

---

## 7. Settings sheet

`#mobile-settings`, built by `mobile.js`. A sheet, not the desktop modal.

| Part | Value | Source |
|---|---|---|
| Shape | bottom sheet, 72 dvh cap, radius 16 top, z 600 | `:7593-7605` |
| Header | `Settings`, 52 high, 44 px close | `:7680-7700` |
| Contents | theme segmented, text size segmented, server row, note, Sign out | `mobile.js:655-745` |
| Gates | no AI, tokens, passwords, provider or admin controls | `:700-745` |
| Viewer | `Admin only` note on the admin-only rows | `:730` |
| Sign out | danger text, only with auth | `:735-745` |

---

## 8. Navigation and history

| Layer | Back closes | Source |
|---|---|---|
| Menu / note menu | first | `mobile.js:314-330` |
| Capture sheet | next | `:318-322` |
| Settings sheet | next | `:318-322` |
| Views sheet (More) | next | `mobile.js` (target) |
| Drawer | next | `:318-322` |
| Note history | last; exits the note | `:321-330` |

The back button is enabled while a layer is open or a note is active, not only when a note is open:
`updateHome` must test `!active && !layer` (`mobile.js:545-547`), or More on Home leaves the only
visible close control dead. Browser history is the only navigator on a phone; `popstate` pops one
layer. Each open pushes a history entry; each close consumes it without a second pop. While a
body-level dialog is up (`#session-dialog`), back closes the dialog, never the layer under it.

---

## 9. States

| State | What shows | Source |
|---|---|---|
| Online | normal | — |
| Offline | `#mobile-state` card, warn glyph, `You’re offline`, Retry | `:7545-7560`, `mobile.js:540` |
| Auth-locked | topbar dimmed; Home hidden; sign-in layer | `:7054-7062` |
| No notes | Home empty copy | §5 |
| No workspace | Home with Browse; no workspace chip | `:6990` |
| Load error | `#mobile-state` card with Retry | `mobile.js:540` |
| Server 401 | auth layer; drafts kept | `mobile.js:277-300` |

---

## 10. Keyboard and ARIA

- Topbar buttons 44 × 44; labels name the action, the title names the note.
- Rail buttons: `aria-pressed` for the active view; the bar is a `nav` with a label. More carries
  `aria-haspopup="dialog"` and `aria-expanded`, never `aria-pressed`.
- Drawer: `role="dialog"`, `aria-modal="true"`; focus into the panel, trap, return to the
  opener (`shell-frame.md` §6.2).
- Sheets: `role="dialog"`, `aria-modal="true"`, focus into the sheet, Esc closes, scrim tap
  closes, focus returns. The More sheet's contract is [`mobile-more-sheet.md`](mobile-more-sheet.md) §6.
- Scrim: pointer only, no role; `hidden` when no layer is open.
- Safe areas: every edge layer applies its own inset; the keyboard inset is `--m-kb`.

---

## 11. Tokens and the CSS target

### 11.1 Reuse

All values map to the `--m-*` family or a foundation token. No new colour is introduced.

### 11.2 Target rules

```css
@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) {
  #topbar { height: var(--topbar-h); gap: var(--space-1); padding: env(safe-area-inset-top) calc(var(--space-1) + env(safe-area-inset-right)) 0 calc(var(--space-1) + env(safe-area-inset-left)); z-index: var(--z-chrome); }
  #activity-bar { height: calc(var(--m-rail-h) + env(safe-area-inset-bottom)); padding: 0 env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); z-index: var(--z-rail); }
  .activity-btn { height: var(--m-rail-h); min-width: var(--m-hit); font-size: var(--icon-xl); }
  .activity-icon { width: var(--icon-lg); height: var(--icon-lg); }
  #activity-more-btn { display: flex; }
  #hybrid-toggle { display: none; }
  #side-panel { width: min(86vw, 340px); z-index: var(--z-drawer); }
  #mobile-scrim { background: var(--m-scrim); z-index: var(--z-scrim); }
  #capture-sheet, #mobile-settings, #mobile-views-sheet { z-index: var(--z-sheet); border-radius: var(--m-sheet-radius) var(--m-sheet-radius) 0 0; }
  .mobile-home-row, .mobile-sheet button, #capture-send { min-height: var(--m-hit); }
  .mobile-home-title { font-size: 22px; font-weight: var(--fw-semibold); }
  .mhr-icon { width: 24px; height: var(--icon-lg); color: var(--fg-muted); }
}
```

### 11.3 Geometry

Topbar 52; rail 56; seven rail slots at 44 minimum each (six views + More); drawer 340 max; sheet
72 dvh/560; Home title 22, Home rows 56, sheet rows 52; sprite glyphs 17 (`--icon-lg`), text glyphs 22;
scrim .45; sheet radius 16; field 16 px.

### 11.4 Exceptions

| # | Change | Why | Pixel delta |
|---|---|---|---|
| E1 | Rail `aria-pressed` on the active view | The active face is visual only today | none |
| E2 | Drawer `role="dialog"`/trap/return | It behaves modally and is not in the tree | none |
| E3 | Sheet `role="dialog"`/trap/return; scrim click closes | Same | none |
| E4 | Capture status `role="status"` | A send failure is silent to AT | none |
| E5 | `prefers-reduced-motion` twin for the drawer/sheet slide | Foundations §7.3 | none at rest |
| E6 | Safe-area inset on the rail and sheets | Notched devices | none on a flat phone |
| E7 | The rail is the first six views of the saved order plus More | Sessions had no phone door; the user's own order decides the slots | 6 + 1 controls instead of 5 |
| E8 | `#hybrid-toggle` leaves the phone topbar | It was a third 44 px control between the title and capture; `Edit note` is already the first note-menu item, and the edit bar owns Done | −44 px of chrome, more title width |
| E9 | Home row glyphs are the desktop sprites, not emoji | One icon per view across the rail, Home and the More sheet; emoji metrics move with the platform font | emoji → 17 px sprite; no row height change |
| E10 | Both edit buttons are hidden with `#topbar #edit-toggle, #topbar #hybrid-toggle` | The shipped `#topbar .icon-btn { display: grid }` outranked a bare id, so the source-editor `</>` was visible on a phone all along, against this spec | −1 stray control; no layout change |

---

## 12. Acceptance criteria

| # | Criterion | File | Observable |
|---|---|---|---|
| AC1 | One mode switch at 860 / coarse 1023 | `style.css` | Below it `--ui-mode: phone`; above it desktop; no second switch |
| AC2 | Topbar order and 44 px targets | `index.html`, `style.css` | Chip, back, title, capture, more; each target ≥44; title ellipsizes; no edit control in the bar |
| AC3 | The rail has six view slots and More | `activity.js`, `style.css` | Default order gives Explorer, Sessions, Pinned, Bookmarks, Recent, Search, More; AI has no slot; 56 high + inset; each slot ≥44 |
| AC4 | Drawer is modal and returns focus | `mobile.js`, `style.css` | Width ≤340; scrim .45; focus enters and returns |
| AC5 | Home lists search, continue, bookmarks, recent, browse and settings, each with the desktop's sprite glyph | `mobile.js` | Rows in the table's order; Continue absent on first use; no emoji glyph and no Sign out row |
| AC6 | Capture appends to Inbox.md and keeps its draft | `mobile.js` | Send disabled while empty; draft restored; success closes; error keeps text |
| AC7 | Settings sheet is gated | `mobile.js` | Theme/text size/server/sign-out only; no AI/token/password controls |
| AC8 | Back closes one layer at a time | `mobile.js` | Menu → capture → settings → more → drawer → history → exit |
| AC9 | Offline and error states show a card with Retry | `mobile.js`, `style.css` | `You’re offline`; Retry re-fetches |
| AC10 | Auth-locked state hides the shell | `style.css`, `mobile.js` | Topbar dimmed; Home hidden; drafts kept |
| AC11 | Reduced motion removes the slides | `style.css` | Drawer and sheet switch instantly |
| AC12 | The mockup is self-contained | `mobile-shell-mockup.html` | Opens offline, dark and light |
| AC13 | Every view with a phone surface is reachable | `activity.js`, `mobile.js` | Each visible view except AI is a rail button or a More row |
| AC14 | More lists the views past slot 6, Settings and Sign out | `mobile.js` | Under the default order: no `Views` group, then Settings and Sign out; no duplicate of a rail view; Sign out only with auth |

---

## 13. Proposals, not applied

| # | Proposal | Why | Cost |
|---|---|---|---|
| P1 | ~~Restore Settings/Logout on the rail~~ — **applied as More** | Two fewer taps for a sixth/seventh icon we could not afford | resolved in [`mobile-more-sheet.md`](mobile-more-sheet.md) |
| P2 | 48 px Home rows | Thumb reach | Density |
| P3 | A capture floating action on Home | Quicker than the topbar | New control |
| P4 | Swipe-from-edge opens the drawer | Native feel | Gesture conflicts with text selection |
| P5 | Show the workspace name in Home | Orientation | Copy |
| P6 | 44 px sheet close | The shipped close is ≈26 | Sheet chrome |
| P7 | A dark scrim on light pages | Contrast of the sheet edge | Visible |

---

## 14. What not to build

- A second phone layout, a tablet shell, or a landscape variant.
- A phone graph, a phone AI view, or a settings modal.
- A second Sessions list; Sessions uses the drawer and its shipped rows.
- A second tab list, a tabs sheet, or a swipe-between-tabs gesture. The drawer's Tabs view is the
  phone's only tab surface ([`tabs-view.md`](tabs-view.md) §8).
- A custom keyboard bar, swipe navigation, or pull-to-refresh.
- A new breakpoint or a container query for the drawer.
- A per-view CSS hide rule for the rail. The order and `PHONE_RAIL_SLOTS` decide, not a stylesheet.
