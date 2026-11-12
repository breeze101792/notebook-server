# Welcome and app-level empty states

Status: Current spec — pre-implementation (codifies the shipped welcome).

Reference mockup: [`welcome-mockup.html`](welcome-mockup.html) — desktop welcome, no tabs,
empty workspace, no workspace, load error, offline, first run, and the phone Home reference.

**Normative source.** This document owns the app-level empty and failure states: `#welcome`,
no tabs, no workspace, a note load failure and first run. Per-view empties stay in their own
docs; the phone Home is [`mobile-shell.md`](mobile-shell.md). Every claim cites `file:line`.

**The shipped look is the target.** Applied exceptions are listed in §8.4; anything else
visual is a proposal in §10.

---

## 1. When each state shows

| State | Predicate | Source |
|---|---|---|
| Welcome | no open tabs, no special view active, no note | `viewer.js:679-720` |
| No tabs, note exists on disk | the same welcome; the tree is populated | `viewer.js:683-690` |
| Empty workspace | no notes on disk, or the tree is empty | `sidebar.js:97-101` |
| No workspace | the boot page has no `workspace_id` and no registry | `app.py` boot, `index.html:113-123` |
| Load failure | the note fetch rejects or returns a non-OK status | `viewer.js` fetch path |
| Offline | `fetch` rejects with no response | same path |
| First run | the server seeded the template notebook | `app.py` seeding |

The welcome replaces the reader inside `#editor-pane`; the tab bar, side panel and outline
stay. A special tab (`§graph`) hides it.

---

## 2. Desktop welcome

| Part | Value | Source |
|---|---|---|
| Position | centred in the reader area, both axes | `style.css:2568-2578` |
| Inner | `max-width: 480px`, centred text | `:2579-2583` |
| Icon | 48 px, the notebook illustration, 12 px below | `:2584-2590` |
| Title | `Welcome to your notebook`, 1.4 rem, 600, 8 px below | `:2591-2596` |
| Subtitle | `Create a new note to get started, or pick one from the left.` 1 rem, `--text-muted`, 24 px below | `:2597-2601` |
| Actions | centred row, 10 px gap, wraps | `:2600-2606` |
| Button | raised face, 1 px `--border`, radius 6, `8px 16px`, `.95rem`; hover accent border + accent text | `:2607-2622` |
| Divider | 1 px `--border`, 20 px below the actions | `:2623-2627` |
| Tips | 4 rows, `.9rem`, `--text-muted`, 1.6 line, 4 px between | `:2628-2645` |
| Kbd | 1 px border, radius 4, `1px 6px`, `.82em` | `:2646-2654` |

**Actions.** `+ New note` always; `Open Welcome.md` only when that file exists
(`viewer.js:715-735`). New note opens the new-note flow; Open Welcome opens the seeded note.

**Tips.** Save shortcut; right-click the sidebar; Search; Settings. They are static copy.

**Focus.** The first action is the tab stop after the sidebar; the welcome itself is not
focusable. The icon is decorative.

---

## 3. No tabs

The welcome shows even when the notebook has notes. The tab strip is empty, the outline is
empty, the edit bar is hidden. The side panel, rail and outline toggle stay live.

`New note` creates `Untitled.md` (deduplicated) and opens it in the current mode. The tab
appears; the welcome hides.

---

## 4. Empty workspace

When the tree has no notes, the Explorer shows its own empty block (`side-panel-views.md`
§1.5): `No files yet. Right-click here to create one.` The welcome still shows. The copy does
not change; only the side panel differs.

---

## 5. No workspace

A page served without a workspace has no workspace chip, no rail workspace mount and no
Sessions view. The rest of the shell renders. On a phone, Home shows Browse only.

This state is a server boot condition, not a client error. It is not the same as a workspace
whose folder is missing (`workspaces.md` §4.3, archived).

---

## 6. Load failure and offline

| Case | Copy | Action | Source |
|---|---|---|---|
| 404 | `This note no longer exists.` | `Reload files` | `viewer.js` fetch path |
| 500 | `Couldn’t open the note.` + server message | `Retry` | same |
| Offline | `You’re offline.` | `Retry` | same |
| Parse error | the note stays; the renderer shows the raw text | none | `markdown.md` |

The failure replaces the reader; the tab stays open and marked. Retry re-fetches the same
path. A draft is not discarded.

---

## 7. First run

The server seeds the template notebook on first boot (`app.py` seeding). The tree shows
`Welcome.md` (and the template folders). The welcome shows until a note is opened; `Open
Welcome.md` is visible because the file exists.

An intentionally empty folder shows the same welcome without the Open action.

---

## 8. Tokens and the CSS target

### 8.1 Reuse

The welcome already reads the base tokens. No new token is needed.

### 8.2 Target rules

```css
#welcome .welcome-inner { max-width: 480px; }
#welcome .welcome-icon { font-size: 48px; margin-bottom: var(--space-3); }
#welcome .welcome-title { margin: 0 0 var(--space-2); font-size: var(--text-lg); font-weight: var(--fw-semibold); }
#welcome .welcome-subtitle { margin: 0 0 var(--space-6); color: var(--text-muted); font-size: 1rem; line-height: var(--lh-normal); }
#welcome .welcome-actions { display: flex; gap: var(--space-2); justify-content: center; margin-bottom: var(--space-7, 32px); flex-wrap: wrap; }
#welcome .welcome-action { height: var(--control-h-lg); padding: 0 var(--space-4); border: var(--stroke-1) solid var(--border); border-radius: var(--radius-sm); background: var(--surface-raised); color: var(--text-primary); font-size: var(--text-ui); }
#welcome .welcome-action:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
#welcome .welcome-action:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-offset); }
#welcome .welcome-divider { border: 0; border-top: var(--stroke-1) solid var(--border); margin: 0 0 var(--space-5); }
#welcome .welcome-tips { margin: 0; padding: 0; list-style: none; color: var(--text-muted); font-size: var(--text-sm); line-height: var(--lh-normal); }
#welcome .welcome-tips li { margin-bottom: var(--space-1); }
```

### 8.3 Geometry

Inner 480; icon 48; title `--text-lg`; subtitle `--text-body`; button 36 high, `--text-ui`;
divider full width; tips `--text-sm`/1.5 with `kbd` at `.82em`; kbd radius 4.

### 8.4 Exceptions

| # | Change | Why | Pixel delta |
|---|---|---|---|
| E1 | Actions get `:focus-visible` | They rely on the UA ring today | focus only |
| E2 | The icon is `aria-hidden` and the title is the heading | The emoji is decorative | none |
| E3 | The subtitle names the sidebar in a `title`-free way | Copy only | none |
| E4 | Load failure keeps the tab and the draft | Today a failure can leave an empty pane | none |
| E5 | Title takes the display role | `1.4rem` → `--text-lg` | −3.5 px at M (19.6 → 16.1) |
| E6 | Action takes the control role | `.95rem` → `--text-ui` | −1.3 px at M (13.3 → 12.0) |
| E7 | Tips take the meta role, `kbd` stays `em` | `.9rem`/1.6 → `--text-sm`/`--lh-normal`; the `kbd` is prose-relative | −1.4 px at M (12.6 → 11.2) |

---

## 9. Acceptance criteria

| # | Criterion | File | Observable |
|---|---|---|---|
| AC1 | The welcome shows exactly when no tab is open | `viewer.js` | Empty tab list → welcome; one tab → reader; special tab → neither |
| AC2 | The welcome anatomy matches §2 | `index.html`, `style.css` | Icon, title, subtitle, two actions, divider, four tips; inner ≤480 |
| AC3 | `Open Welcome.md` only when the file exists | `viewer.js` | Seeded notebook: visible; empty folder: hidden |
| AC4 | New note opens a deduplicated file and hides the welcome | `viewer.js` | `Untitled.md`, then `Untitled 2.md`; one new tab |
| AC5 | Empty workspace keeps the welcome and shows the Explorer empty block | `sidebar.js` | Both visible; the copy is the shipped one |
| AC6 | No workspace renders the shell without the chip, rail mount or Sessions | `index.html` | Absent, not disabled |
| AC7 | A load failure keeps the tab and offers Retry | `viewer.js` | 404/500/offline copy; Retry re-fetches |
| AC8 | First run shows `Welcome.md` in the tree and the Open action | `app.py` | Seeded folder |
| AC9 | The actions draw the focus ring | `style.css` | Keyboard focus shows 2 px accent at 2 px |
| AC10 | The mockup is self-contained | `welcome-mockup.html` | Opens offline, both themes |

---

## 10. Proposals, not applied

| # | Proposal | Why | Cost |
|---|---|---|---|
| P1 | Make `+ New note` the primary button | The main action is not distinguished | Visible |
| P2 | Show the recent notes under the tips | Two clicks saved | New list |
| P3 | A “Restore last session” action | Useful after a crash | New behaviour |
| P4 | A distinct empty workspace illustration | The copy is the same as a normal empty notebook | New art |
| P5 | Replace the notebook emoji with an SVG | Foundations §9.3 | Visible |

---

## 11. What not to build

- A second welcome for the phone; `mobile-shell.md` owns Home.
- A modal, a carousel, or animated onboarding.
- A separate error page; the failure stays inside the editor pane.
- A new breakpoint or a new token.
