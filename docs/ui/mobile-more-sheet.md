# Mobile More sheet — the sidebar items the phone rail cannot hold

Status: Current spec — shipped.

Reference mockup: [`mobile-shell-mockup.html`](mobile-shell-mockup.html) — the rail with six views and
More, and the More sheet open over a note, dark and light at 390 × 844.

**Normative source.** This document owns two things: how many activity-bar views the phone rail carries
and which ones, and the **More sheet** that lists the rest. The rail's box, height, glyph size and
active indicator stay owned by [`mobile-shell.md`](mobile-shell.md) §3; this file only changes *what
the rail carries*. The bar's order and per-view visibility are owned by
[`activity-bar-order.md`](activity-bar-order.md). Sessions row anatomy is owned by
[`sessions.md`](sessions.md). Every claim cites `file:line`.

**The rule this surface exists for.** On a phone nothing hides an activity-bar item with no way back.
Every view that has a phone surface is either a rail button or a More row, and the two rail actions
(Settings, Sign out) are More rows.

---

## 1. Model

### 1.1 The rail budget and the one rule

The phone rail is one row of equal columns. The 44 px coarse-pointer floor (`foundations.md` §10.4) and
a 320 px viewport cap the row at **seven slots**: 7 × 44 = 308.

| Slot | Contents |
|---|---|
| 1–6 | the **first six visible views in the user's saved bar order** |
| 7 | **More** — fixed, last, never moves |

**The rule: the rail shows the first six, in the order the user set.** There is no allow-list of
"mobile views" and no view is demoted by taste. Reorder the bar on desktop and the phone rail follows
it; push a view past slot 6 and it moves to More. The default order puts Sessions second, so Sessions
gets a rail slot without anyone ranking views.

Why six and not five: the default order is Explorer, Sessions, Pinned folders, Bookmarks, Recent files,
Search, AI. Five slots would push Search — the phone's main find path (`product/mobile.md` M4) — into
More. Six keeps every view the shipped rail already had, adds Sessions, and still fits a 320 px phone
as seven 44 px slots.

### 1.2 The two constants

```js
// activity.js
const PHONE_RAIL_SLOTS = 6;
// Views with no phone surface at all. They take neither a slot nor a More row,
// because a row that opens an empty drawer is worse than no row.
const PHONE_OFF_VIEWS = ["ai"];

function railViews() {
  if (!isPhone()) return visibleViews();
  return visibleViews()
    .filter(v => PHONE_OFF_VIEWS.indexOf(v.id) < 0)
    .slice(0, PHONE_RAIL_SLOTS);
}

function offRailViews() {
  if (!isPhone()) return [];
  return visibleViews()
    .filter(v => PHONE_OFF_VIEWS.indexOf(v.id) < 0)
    .slice(PHONE_RAIL_SLOTS);
}
```

| View | Default place | Why |
|---|---|---|
| Explorer | rail 1 | the only tree; no substitute |
| Sessions | rail 2 | the default bar order puts it second; the item this surface was built for |
| Pinned folders | rail 3 | stays exactly where the shipped phone rail had it |
| Bookmarks | rail 4 | a saved list with no other door |
| Recent files | rail 5 | jump back without typing |
| Search | rail 6 | the phone's main find path |
| AI Assistant | **off** | rejected for the phone on 2026-11-09 (`ai-panel.md` §9.2); no rail slot and no More row |
| Graph | not a view | a full-screen canvas with its own gestures, deliberately desktop-only (`graph-view.md` §7); proposed for the phone in §11 P1, not built |

A view added to the bar later takes the seventh position in More until the user moves it up. A view
registered but not yet in the saved order lands after the known ones (`activity.js:109-122`) and
follows the same rule.

### 1.3 What the sheet lists

| Group | Rows | Rule |
|---|---|---|
| `Views` | every **visible** view after the first six, in bar order, excluding `PHONE_OFF_VIEWS` | empty by default, and an empty group is not rendered |
| `App` | `Settings`; `Sign out` | Settings always; Sign out only when `NB.auth.status().enabled` |

With the default order the `Views` group is empty and More is a two-row action sheet. It grows only
when the user pushes a view past slot 6 — which is the point: the sheet is the overflow, not a second
nav.

A view hidden in Settings → Appearance → Activity bar (`sidebarHidden`) is in neither the rail nor
More; hidden is the user's own choice and desktop behaves the same (`activity-bar-order.md` §6).

**The accepted cost.** The phone settings sheet has no activity-bar list (`settings-modal.md` §9.3), so
a view hidden on desktop cannot be unhidden from the phone, and a view cannot be moved between the rail
and More from the phone either. `activate()` refuses a hidden view (`activity-bar-order.md` §7), so the
drawer cannot reach it. Restoring either from the phone is §11 P2.

The sheet is rebuilt on every open, so it never shows a stale set after a hide, an unhide, or a
reorder.

---

## 2. Anatomy

```
#activity-more-btn            phone only, last rail slot
  └── svg #nb-icon-menu       --icon-lg 17 px, centred

#mobile-views-sheet            joins the existing sheet selector list (see 8.2)
├── .capture-grabber          36 × 4, shared
├── .mobile-more-head         52 high: h2 "More" + .mobile-sheet-close (44 × 44, ×)
└── .mobile-more-body
    ├── .mobile-more-group    "Views"       12 / 600, .08em, uppercase, --fg-muted
    ├── .mobile-settings-row.mobile-more-row   icon + label, 52 high
    ├── .mobile-more-group    "App"
    ├── .mobile-settings-row.mobile-more-row   Settings
    └── .mobile-settings-row.mobile-more-row   Sign out, --danger, auth only
```

There is no `.mobile-sheet` class in the code. Sheets are the selector list
`#capture-sheet, #mobile-settings` (`style.css:8480-8499`); this host joins that list and the three
groups that go with it: the open rule (`style.css:8501-8505`), the `[hidden]` rule
(`style.css:8507-8508`), and the reduced-motion block (`style.css:8654-8658`). Rows reuse
`.mobile-settings-row` (`style.css:8584-8592`); `.mobile-more-row` adds only the icon, the label span
and the check.

| Part | Value | Token |
|---|---|---|
| Sheet | `position: fixed`, `bottom: var(--m-kb, 0px)`, `max-height: min(72dvh, 560px)`, radius 16 top, z 600 | the `#capture-sheet` block, `style.css:8480-8499` |
| Header | 52 high, padding `0 6px 0 16px`, title 16 / 600 | `.mobile-settings-head`, `style.css:8518-8526` |
| Close | 44 × 44, `×`, `aria-label="Close"` | `--m-hit`, `.mobile-sheet-close`, `style.css:8526-8540` |
| Body | `padding: 0`, `overflow-y: auto` — the host already owns `calc(12px + safe-area-inset-bottom)`, so a body inset would double it | the `#capture-sheet` block, `style.css:8480-8499` |
| Group label | `.72rem` (≈11.5 px) / 600, tracking `.08em`, uppercase, `--fg-muted`, padding `12px 16px 4px` | `--text-xs`; a raw `12px` would raise the typography ratchet count (`tests/static/test_typography.js`) |
| Row | 52 min-height, flex, gap 12, padding `0 16px`, full width | `.mobile-settings-row`, `style.css:8584-8592` |
| Row icon | 24 wide × 17 high box holding a 17 px `nb-icon-*` sprite, `--fg-muted` | `--icon-lg` |
| Row label | 15 / 1.3, `--fg`, flexes | `.mobile-settings-label` is 15 px (`style.css:8592`); not `--text-ui-lg`, which is 13 px |
| Current-view mark | 16 px `#nb-icon-check`, `--accent`, right-aligned | `--icon-sm` |
| Sign out row | label and icon `--danger` | `--danger` |
| Row separator | 1 px `--border` bottom, dropped on the sheet's last row | `--border` |

The row carries a sprite icon, not an emoji: the sheet mirrors the bar, and the bar's icons are the
`nb-icon-*` symbols (`activity.js:200-208`). Home rows and the rail use the same symbols
(`mobile-shell.md` §5), so one view has one glyph everywhere on the phone.

---

## 3. States

| State | Rail More | Sheet |
|---|---|---|
| Rest, sheet closed | `--fg-muted`, `aria-expanded="false"` | `hidden` |
| Open | `aria-expanded="true"` only — the sheet and the scrim cover the rail, so a paint on the button would never be seen | visible, scrim `.45` |
| Row rest | — | `--fg` label, `--fg-muted` icon |
| Row pressed | — | `--accent-soft` face |
| Row focus-visible | — | `--focus-ring`, offset −2 |
| No off-rail view | — | `Views` group not rendered; `App` starts at the top |
| No auth | — | Sign out row absent (not disabled) |
| Viewer | — | Sign out present; Settings opens the gated sheet, and a More view row still opens its drawer |
| Auth locked | whole app inert (`style.css:2700-2709`) | unreachable |
| Edit mode | rail hidden (`style.css:8014-8016`) | unreachable |

`aria-expanded` is the More button's state; there is no `aria-pressed`, because More is not a view and
never becomes the current view. The attribute is written by `showLayerUi`/`hideLayerUi`
(`mobile.js:213-250`), the one owner of every layer transition, so it cannot go stale when the drawer
takes over, when auth locks the app, or when the mode flips.

---

## 4. Behaviour

| Step | What happens |
|---|---|
| Tap More | `buildViews()` renders the groups from the live bar, stores `layer = "views"`, pushes **one** history entry, unhides the sheet, paints the scrim, sets `aria-expanded="true"`, focuses the first row |
| Tap a view row | `NB.mobile.openDrawer(id)` — the sheet's UI closes, the drawer takes over **without a second history entry** (`setLayer("drawer")` reuses the open layer), `aria-expanded="false"` |
| Tap Settings | the sheet's UI closes, `openSettings(opener)` runs with `#activity-more-btn` as the opener for focus return |
| Tap Sign out | close the layer, then `NB.auth.logout()` |
| Tap the scrim, tap `×`, press Esc, hardware back | close the sheet, pop the one entry, focus returns to `#activity-more-btn` |
| Bar changes while the sheet is open | not live — the sheet is a snapshot rebuilt on open; it is never open while Settings is |
| Mode flips to desktop | the layer closes (`mobile:mode` → `closeLayerNow`); the desktop rail shows every view again |

`openSettings(opener)` takes an **element**, and the Home row passes a wrapper, not the function, so a
`MouseEvent` can never be recorded as the opener. The recorder accepts it only when it has a `focus`
method; otherwise the opener falls back to `#mobile-more`.

`focusOpener` currently hardcodes `shell.more` for the settings sheet (`mobile.js:252-258`); the
recorded opener replaces that constant, so the rail path returns focus to the rail and the Home path
still returns to the topbar `…`.

The sheet never switches the note, never writes config, and never changes the active view by itself.
Only the row the user taps acts, and a view row's action is the drawer.

---

## 5. What changing the order does

| Change | Result |
|---|---|
| A view moves up into the first six | it takes that rail slot; the view it displaced becomes a `Views` row |
| A view moves down past slot 6 | it leaves the rail and appears in More |
| A seventh view takes a slot | one of the six moves to More in the same change, or the 44 px floor breaks at 320 px (7 × 44 = 308) |
| `sidebarHidden` hides a view | it leaves the rail, and it is not a More row either |
| A new view registers | it joins the end of the order; if the rail is full it appears in More until the user moves it up |

The user's order is set on desktop in Settings → Appearance → Activity bar (`activity-bar-order.md`).
The phone does not edit it; it obeys it.

---

## 6. Keyboard and ARIA

| Element | Contract |
|---|---|
| More button | native `<button>`, `aria-haspopup="dialog"`, `aria-expanded`, `aria-label="More views"`, `title="More views"` |
| Sheet | `role="dialog"`, `aria-modal="true"`, `aria-labelledby` the header `h2` |
| Rows | native `<button>`; one tab stop each; Enter and Space activate |
| Current view | `aria-current="true"` on that row; the check glyph is `aria-hidden` |
| Sign out | `aria-label="Sign out"` from the visible label; no extra warning (the settings sheet owns the confirm-free sign-out today) |
| Focus on open | first row; no field exists to focus |
| Focus trap | the existing phone trap covers `drawer`, `capture`, `settings`; `views` joins that branch (`mobile.js:1152-1175`) |
| Esc | closes the sheet before any other layer (`closeTopLayer`) |
| Back | consumes the sheet's own entry. The back button is enabled while a layer is open even with no note; `updateHome` currently disables it on `!active` (`mobile.js:545-547`) and must include `layer` |
| Focus on close | `#activity-more-btn`; the Settings path returns to it too, through the recorded opener |

---

## 7. Motion

| Property | Value |
|---|---|
| Sheet slide | 220 ms `cubic-bezier(.2, .8, .2, 1)`, the `#capture-sheet` motion (`style.css:8494-8498`) |
| Scrim | opacity `.16s ease`, shared |
| Row press | none — `:active` face only |
| Reduced motion | the host id joins the existing block (`style.css:8654-8658`); no new rule |

---

## 8. Tokens and the CSS target

### 8.1 Reuse

No new token. The rail keeps `--m-rail-h`, `--m-hit`, `--icon-lg`; the sheet keeps `--m-sheet-radius`,
`--z-sheet`, `--m-scrim`.

### 8.2 Target rules

Five shipped selector lists gain this host. Extend them; do not copy them, or the sheet will render
without position, motion or reduced-motion handling.

| Existing rule | Add |
|---|---|
| sheet geometry, `style.css:8480-8499` | `#mobile-views-sheet` to the `#capture-sheet, #mobile-settings` list |
| open, `style.css:8501-8505` | `body.views-open #mobile-views-sheet` to the group |
| hidden, `style.css:8507-8508` | `#mobile-views-sheet[hidden]` |
| reduced motion, `style.css:8654-8658` | `#mobile-views-sheet` |
| header, `style.css:8541-8546` | `.mobile-more-head` in the `.capture-head, .mobile-settings-head` list, rather than a copy |
| scrim, `style.css:8109-8111` | `body.views-open` in the `body.drawer-open, body.capture-open, body.settings-open` group |

```css
@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) {
  #activity-more-btn { display: flex; flex: 0 0 var(--m-hit); }
  .mobile-more-body { padding: 0; overflow-y: auto; overscroll-behavior: contain; }
  .mobile-more-group { padding: 12px 16px 4px; color: var(--fg-muted);
    font-size: var(--text-xs); font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
  .mobile-more-row { text-align: left; }
  .mobile-more-row:active { background: var(--accent-soft); }
  .mobile-more-icon { flex: 0 0 24px; width: 24px; height: var(--icon-lg); color: var(--fg-muted); }
  .mobile-more-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mobile-more-check { flex: 0 0 16px; width: 16px; height: 16px; color: var(--accent); }
  .mobile-more-row.is-danger, .mobile-more-row.is-danger .mobile-more-icon { color: var(--danger); }
  .mobile-more-body > .mobile-settings-row:last-child { border-bottom: 0; }
}
```

`.mobile-more-row` adds no geometry: the row is `.mobile-settings-row` (52 high, gap 12,
`padding: 0 16px`, 1 px `--border`), and only the sheet's last row drops its border. Desktop carries
`#activity-more-btn { display: none; }` outside the query, next to the other phone-only chrome.

### 8.3 Geometry

Rail: six view slots + More, 56 high + bottom inset, 44 minimum width each. Sheet: header 52, row 52,
group label 12, icon 24 wide × 17 high, check 16, cap `min(72dvh, 560px)`.

---

## 9. Exceptions

| # | Change | Why | Pixel delta |
|---|---|---|---|
| E1 | Sessions joins the phone rail | It had no phone door at all; the default bar order places it second | +1 slot |
| E2 | The rail is the first six of the user's order, plus More | The old rail was a hardcoded five, unrelated to the user's order | 6 + 1 controls instead of 5 |
| E3 | A More slot and sheet are added | Settings and Sign out stay reachable while a note is open, and any view past slot 6 stays reachable at all | +1 control |
| E4 | `role="dialog"`, trap, focus return for the sheet | It is modal and was not in the tree | none |
| E5 | `aria-expanded` on More | The button opens a modal and nothing said so | none |
| E6 | Sprite icons in the rows | The sheet mirrors the bar, whose icons are sprites | none |
| E7 | Row label 15 px, group label `.72rem` | `.mobile-settings-label` is the phone's 15 px label; `--text-ui-lg` is 13 px and `--text-xs` is the smallest legal role for the group label | none |
| E8 | The scrim and the reduced-motion rule are extended, not copied | A copied sheet has no position or motion | none |

At 320 px, seven slots measure 45.7 each — above the 44 floor. Six slots with no More was never an
option: Settings and Sign out would be unreachable from a note.

---

## 10. Acceptance criteria

| # | Criterion | Files | Observable |
|---|---|---|---|
| AC1 | The phone rail has six view buttons and More | `activity.js`, `style.css` | At 390 in the default order: Explorer, Sessions, Pinned folders, Bookmarks, Recent files, Search, More |
| AC2 | The rail is the first six in the user's order | `activity.js` | `PHONE_RAIL_SLOTS` is the only slice; reorder the bar on desktop and the phone rail follows after reload |
| AC3 | AI takes neither a slot nor a More row | `activity.js` | `PHONE_OFF_VIEWS = ["ai"]`; `railViews()` and `offRailViews()` both exclude it |
| AC4 | Every view with a phone surface is reachable | `activity.js`, `mobile.js` | Each visible view is either a rail button or a More row, and choosing the row opens it in the drawer |
| AC5 | The More sheet lists the views past slot 6 plus Settings and Sign out | `mobile.js` | Empty `Views` group under the default order; two `App` rows; no duplicate of a rail view |
| AC6 | A hidden view appears in neither place | `mobile.js` | Hiding a view on desktop removes its button and leaves no More row |
| AC7 | Sign out is absent without auth | `mobile.js` | No row when `/api/auth` reports `enabled: false`; with auth on it renders in `--danger` and calls `logout()` |
| AC8 | Choosing a view opens the drawer on it | `mobile.js` | More → a view row → drawer shows that header; one back step returns to the note |
| AC9 | Settings opens the settings sheet and returns focus to More | `mobile.js` | The gated sheet appears; closing it focuses `#activity-more-btn` |
| AC10 | The sheet is a modal dialog | `mobile.js`, `index.html` | `role="dialog"`, `aria-modal`, trap, Esc closes, scrim tap closes, focus returns |
| AC11 | Targets are 44 px or larger | `style.css` | Rail buttons ≥44 × 56; rows 52 with full-width hit area; close 44 |
| AC12 | No new token and no raw duration | `style.css` | The block adds no hex, no px radius, no literal ms |
| AC13 | Desktop is unchanged | `style.css`, `activity.js` | At 1280 the rail has all seven views, no More button, and the slice is not applied |
| AC14 | The mockup is self-contained | `mobile-shell-mockup.html` | Opens offline, dark and light |

---

## 11. Proposals, not applied

| # | Proposal | Why | Cost |
|---|---|---|---|
| P1 | Graph on the phone | It is the one rail item with no phone door; this design excludes it | A touch canvas surface, gestures, and a 3D budget on a phone — a surface of its own |
| P2 | Set the phone order, and unhide views, from the phone | Both live only in the desktop Settings list today (§1.3) | A phone activity-bar list in the settings sheet |
| P3 | Make the slot count configurable | Six is a fixed budget a user might want to spend differently | A config key, a phone settings row, and a re-render path |
| P4 | A session chip on the note (topbar subtitle, or a line under the title) | The active session is named only inside the Sessions list (§1.3), so a reader cannot tell which one they are in without opening it | A third line of chrome in a 52 px bar; the desktop session bar has no phone home |
| P5 | Show a count badge on Sessions | Shows that other sessions have work open | A live count and a second active-state signal |
| P6 | A long-press on a rail icon to jump to its More row | Fewer taps | Invisible gesture; conflicts with text selection |
| P7 | Merge More into the topbar `…` menu on Home | One fewer rail slot | The topbar menu is per-note; the rail is global |

---

## 12. What not to build

- A per-view CSS hide rule for the phone. The order and the slot count decide; CSS only boxes the slots.
- A hardcoded "mobile views" allow-list. If a view should leave the rail, the user moves it down.
- A second Sessions list, a Sessions modal, or a phone-only session picker in the topbar.
- More rows for AI or Graph. Neither has a phone surface today; a row that opens nothing is worse than no row. Adding one means building the surface first (P1).
- More rows for actions already on Home (Capture, Continue, Browse). Home is the no-note screen; the rail is global, and the sheet lists only what the rail cannot carry.
- A sheet that also mirrors the six rail views. The rail already shows them, one tap closer.
- Drag reorder inside the More sheet. The order is set on desktop.
