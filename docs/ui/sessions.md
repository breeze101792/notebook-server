# Sessions view — the side-panel list

Status: Current spec — pre-implementation (codifies the shipped view).

Reference mockup: [`sessions-mockup.html`](sessions-mockup.html) — normal, active and dirty,
row menu, the 20-session cap, read-only, and the 140 px floor, dark and light.

**Normative source.** This document owns the Sessions activity view: header, rows, counts,
row menu, footer and states. The model, persistence, tab data and switching live in
[`../architecture/sessions.md`](../architecture/sessions.md) and `tabs.js`; the shared
tab-bar interactions are [`tab-bar.md`](tab-bar.md); create/rename/delete dialogs are
[`dialogs.md`](dialogs.md). It reads [`side-panel-views.md`](side-panel-views.md) for the
frame. Every claim cites `file:line`.

**The shipped look is the target.** Applied exceptions are listed in §10.4; anything else
visual is a proposal in §12.

---

## 1. Placement

| Thing | Rule | Source |
|---|---|---|
| Activity view | `sessions`, second rail icon on desktop | `activity.js:1328` |
| Host | `#sessions-view`, a side-panel view, mounted lazily | `index.html:245-247` |
| Phone | hidden; the rail icon and the host are not rendered | `style.css:7203-7206` |
| Top-bar picker | a separate control, owned by `sessions.md` history and `topbar-session` (archived); this view does not own it | shell-frame |
| Order | registration order after Explorer | `activity.js` |

The view is one list of sessions for the current workspace. The active session's tabs are
in the tab bar; pinned tabs are shared by every session and are not counted here.

---

## 2. Header

| Part | Value | Source |
|---|---|---|
| Header | `.panel-header`, 36 px, padding `7px 10px`, gap 4 | `sessions.js:130-140`; `style.css:8247-8253` |
| Title | `Sessions`, `.72rem`, 600, tracking `.08em`, uppercase, `--text-muted` | `sessions.js:134-136` |
| Total | `.panel-heading` with a count chip: 20 × 18, radius 5, 1 px `--border`, `.72rem` 600, tabular | `:137-146`; `style.css:8254-8269` |
| Add | `+`, 24 × 24, radius 5, `--text-muted`; hover wash + `--text-primary`; focus ring | `:155-160`; `style.css:8271-8292` |
| Collapse | 24 × 24, the frame's `makeCollapseBtn()` | `sessions.js:161-164` |

The header has at most two actions before the collapse control, matching the frame rule.

**Add states.** At the 20-session cap the `+` keeps its tab stop, gets
`aria-disabled="true"`, `aria-describedby` the hidden cap note, and the title
`20 sessions is the limit. Delete one first.` For a viewer it is also `aria-disabled` with
`Read-only: sessions can’t be changed.` A missing dialog is `aria-disabled` with its own
reason (`sessions.js:507-526`).

---

## 3. Rows

One row is a wrapper plus two sibling buttons; a button cannot contain a button.

| Part | Value | Source |
|---|---|---|
| Wrapper | `.session-row-wrap`, flex, gap 2, `flex: 0 0 auto` | `style.css:8309-8316` |
| Row button | 30 px min, padding `3px 6px 3px 10px`, radius 6, `.9rem/1.35`, left | `:8317-8338` |
| Hover | neutral `--surface-raised` on the row when the wrapper is hovered and the row is not active | `:8341-8344` |
| Active | `--accent-soft` face, 600, 2 px accent marker 14 px tall at the left edge | `:8345-8355` |
| Focus | ring at `--focus-offset-inset` (−2) | `:8356` |
| Name | flexes first, ellipsis, `title` = full name | `:8358-8364` |
| Dirty dot | 8 px accent dot; `aria-hidden`; the name carries `, unsaved changes` | `:8365-8374`; `sessions.js:452-465` |
| Unpinned count | `.76rem`, tabular, 2ch min, right; `--text-muted`; on the active row `--text-primary` | `:8375-8382` |
| More | `⋯`, 24 × 24, always visible, radius 5; `aria-haspopup="menu"`, `aria-expanded` | `:8384-8412`; `sessions.js:468-490` |

The count is unpinned tabs only. Pinned tabs are shared, so counting them in every row would
mislead. A row with zero unpinned tabs shows `0`.

**Row actions.** The row button switches; the `⋯` opens the row menu; right-click on the
wrapper opens the same menu at the pointer. Enter and Space on the row switch natively.

---

## 4. Menus

**Row menu** (`NB.menu`, two items):

| Item | Rule |
|---|---|
| `Rename` | opens the name dialog in rename mode; disabled for a viewer |
| `Delete` | confirm, then delete; hidden/disabled when it is the only session |

The menu is placed 2 px under the button, flipped above when it would overflow, and
clamped to an 8 px viewport margin (`sessions.js:39`, `:580-600`). It closes on `Esc`, an
outside click, or a second click on `⋯`.

**Tab menu.** The tab's context menu gets `Move to session` with one item per session and
a `New session…` tail (`sessions.md` history; `tab-bar.md` §5.5). The view does not own it,
but the rows are the destination names, so the copy must match.

---

## 5. Create, rename, delete

The dialog is [`dialogs.md`](dialogs.md) (session create/rename): 420 wide, name field,
40-character limit, pinned hint, inline error, Create/Save.

| Action | Copy | Source |
|---|---|---|
| Create title | `New session` | `sessions.js:704-714` |
| Rename title | `Rename session` | `:708-720` |
| Placeholder | `e.g. Bench tests` | dialog |
| Limit | 40 characters; `Session names are limited to 40 characters.` | `sessions.js:37`, `:71-73` |
| Empty | `Enter a name.` | `:913` |
| Duplicate | `A session with that name already exists.` | `:913` |
| Footer | `Cancel`, `Create session` / `Save` | dialog |

**Delete** uses `window.confirm` with the session name and the tab count:
`Delete “Bench tests”? Its 4 tabs will be closed.` The only session cannot be deleted; its
menu item is disabled with `The only session can’t be deleted.` (`sessions.js:58`,
`:795-810`).

---

## 6. Counts, dot and order

| Signal | Rule |
|---|---|
| Header total | number of sessions, live; `20` max |
| Row count | unpinned tab count, not pinned |
| Dirty dot | any visible dirty tab in that session |
| Order | insertion order; a new session appends; rename keeps position |
| Sort | none; no drag reorder |

The header total is a count, not a live region; it updates with the list. The dot is
presentational; the row's accessible name carries the state.

---

## 7. States

| State | What shows |
|---|---|
| One session | the row; Delete disabled with its title |
| 20 sessions | `+` `aria-disabled`, cap note linked |
| Viewer | rows switch; `+` and Rename/Delete disabled |
| Dirty | dot on the row; header total unchanged |
| Renaming | the dialog; list unchanged behind |
| Empty | impossible: at least one session exists |
| Narrow 140 | name ellipsizes; count and `⋯` stay |
| Phone | not reachable |

---

## 8. Keyboard and ARIA

| Element | Contract |
|---|---|
| View | no landmark; the panel provides it |
| Header `+` | native button; `aria-disabled` (not `disabled`) so the reason stays reachable |
| Row | native button; `aria-current="true"` on the active session; `aria-describedby` none |
| More | native button; `aria-haspopup="menu"`, `aria-expanded` |
| Row menu | `role="menu"`; items `role="menuitem"`; one roving tab stop; arrows, Home/End, `Esc` |
| Name dialog | dialog role, focus into the field, `Esc` cancels, focus returns to the opener |
| Delete | native confirm; focus returns to the row or the `+` |

Tab order: `+` → collapse → rows in DOM order (row, more) → footer is static. The `⋯` is
always visible, so a keyboard user never needs hover.

---

## 9. Responsive

| Width | Change |
|---|---|
| 240 default | the design width |
| 140 floor | name ellipsizes; count and `⋯` keep their boxes; header title stays |
| 720–140 | no separate rule; the panel narrows |
| Phone | the view and its rail icon are hidden; the top-bar picker is the door |

The list is the scroller; the header and footer stay fixed. The resize handle sits on the
right edge; the list keeps an 8 px right inset.

---

## 10. Tokens and the CSS target

### 10.1 Reuse

The view already reads base tokens. No new token is needed.

### 10.2 Target rules

```css
.panel-heading { display: flex; align-items: center; gap: 6px; min-width: 0; }
.session-total { min-width: 20px; height: 18px; padding: 0 5px; border: var(--stroke-1) solid var(--border); border-radius: 5px; color: var(--text-muted); font-size: .72rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.session-add { width: var(--control-h-sm); height: var(--control-h-sm); border-radius: 5px; color: var(--text-muted); }
.session-add:hover { color: var(--text-primary); background: var(--accent-soft); }
.session-add[aria-disabled="true"] { opacity: var(--opacity-disabled); cursor: default; }
.sessions-list { gap: var(--space-hair); margin-right: var(--space-2); padding: 6px 6px 10px; overflow-y: auto; overflow-x: hidden; }
.session-row-wrap { display: flex; align-items: center; gap: 2px; min-width: 0; }
.session-row { min-height: var(--control-h-md); padding: 3px 6px 3px 10px; border-radius: var(--radius-sm); font-size: .9rem; line-height: var(--lh-snug); }
.session-row[aria-current="true"] { background: var(--accent-soft); font-weight: var(--fw-semibold); }
.session-row[aria-current="true"]::before { width: var(--stroke-2); height: 14px; background: var(--accent); }
.session-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.session-dot { width: var(--space-2); height: var(--space-2); background: var(--accent); }
.session-count { font-size: .76rem; color: var(--text-muted); }
.session-row[aria-current="true"] .session-count { color: var(--text-primary); }
.session-more { width: var(--control-h-sm); height: var(--control-h-sm); border-radius: 5px; color: var(--text-muted); }
.session-more:hover, .session-more[aria-expanded="true"] { color: var(--text-primary); background: var(--accent-soft); }
.sessions-foot { padding: 9px 12px 10px; border-top: var(--stroke-1) solid var(--border); color: var(--text-muted); font-size: .76rem; line-height: 1.45; }
```

### 10.3 Geometry

Header 36; actions 24; total 20 × 18; row 30; marker 2 × 14; dot 8; count `.76rem`;
`⋯` 24; footer padding 9/12/10; list gap 2, right inset 8.

### 10.4 Exceptions

| # | Change | Why | Pixel delta |
|---|---|---|---|
| E1 | Row and `⋯` labels include the session name | The row title and the `⋯` title are tooltips only | none |
| E2 | Dirty row adds `, unsaved changes` to the accessible name | The dot is `aria-hidden` | none |
| E3 | `+` uses `aria-disabled` and keeps its tab stop | The reason must stay reachable | none |
| E4 | Row menu is `NB.menu` with `role="menu"` items | It already behaves as one | none |
| E5 | Focus ring on the `+` and rows at the shipped offsets | Keyboard users see the control | focus only |
| E6 | Viewer `+`/rename/delete disabled with a named reason | The shipped title is enough for a pointer, not for AT | none |

---

## 11. Acceptance criteria

| # | Criterion | File | Observable |
|---|---|---|---|
| AC1 | The view is the second desktop rail view and absent on the phone | `activity.js`, `style.css` | `sessions` registered; rail icon and host hidden at 390 |
| AC2 | Header: title, total, `+`, collapse | `sessions.js` | `Sessions`, `N sessions`, `+`, chevron; at most two actions before collapse |
| AC3 | Rows show name, count, dot and `⋯` | `sessions.js` | Unpinned count; dirty dot; `⋯` always visible |
| AC4 | Active row is tinted, 600 and marked | `sessions.js`, `style.css` | `aria-current="true"`; 2 px marker; `--accent-soft` |
| AC5 | The `+` is capped at 20 and stays reachable | `sessions.js` | `aria-disabled` + `aria-describedby`; title names the cap |
| AC6 | A viewer cannot change sessions | `sessions.js` | `+` and Rename/Delete disabled; switching still works |
| AC7 | Rename and delete dialogs match `dialogs.md` | `sessions.js`, `dialogs.js` | 40-char limit; duplicate/empty errors; delete confirm names the tab count |
| AC8 | The only session cannot be deleted | `sessions.js` | Menu item disabled with its title |
| AC9 | Row menu is keyboard-operable | `NB.menu` | Arrows, Home/End, `Esc`; focus returns to `⋯` |
| AC10 | The list scrolls, the header/footer stay | `style.css` | 20 rows scroll; header and footer fixed |
| AC11 | 140 px keeps name, count and `⋯` | `style.css` | Name ellipsizes; the other two boxes hold |
| AC12 | The mockup is self-contained | `sessions-mockup.html` | Opens offline, dark and light |

---

## 12. Proposals, not applied

| # | Proposal | Why | Cost |
|---|---|---|---|
| P1 | Drag to reorder sessions | Insertion order only | New behaviour + persistence |
| P2 | A row preview of the session's note names | Context | Copy density |
| P3 | A colour or glyph per session | Faster recognition | New visual system |
| P4 | Inline rename on double-click | One less dialog | Conflict with row switch |
| P5 | A “close all tabs” row action | Useful before delete | New destructive action |
| P6 | Sort by name / last used | 20 rows is short | Sort control |

---

## 13. What not to build

- A second Sessions list, a phone version, or a modal.
- A new count rule that includes pinned tabs.
- A drag-reorder without persistence.
- A different row shape from the shared list rules.
