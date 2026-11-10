# Dialogs — the shared frame, auth, workspaces, sessions and export

Status: Current spec — pre-implementation (codifies the shipped dialogs).
Scope: `#auth-overlay`, `#workspace-dialog`, `#session-dialog`, `#export-overlay`, the
shared `.settings-overlay > .settings-modal` frame they all use, the `.auth-error` slot,
the toast, and the four `window.confirm` prompts that stand where a dialog would.
Out of scope: Settings (`#settings-overlay`), the lightboxes, the edit windows
([`edit-window.md`](edit-window.md)), the shell ([`shell-frame.md`](shell-frame.md)), the
workspace picker and session picker popovers (their mounts are `shell-frame.md` §2.3;
their rows are not part of this document).

Reference mockup: [`dialogs-mockup.html`](dialogs-mockup.html) — dark and light, fifteen
boards plus a toast figure: auth (sign in, submitting, error), workspace (add, resolved path,
rename, error), session (create, delete confirm), export (main, section scope / preview
target, running, error), and the 390 phone pair. Every board uses the shipped numbers except
the nine exceptions in §10.2.

**Prerequisite.** [`foundations.md`](foundations.md) §11.1 and [`controls.md`](controls.md) §3.3 step 1 must land before any rule below; until then a token rule falls back to the shipped literal.

**Normative source.** This document owns the four dialogs and the frame they share. It reads
[`foundations.md`](foundations.md) for tokens and [`controls.md`](controls.md) for control
anatomy; it redefines neither. `NB.dialog` (`static/js/dialog.js`) stays normative for
containment and focus return, and `NB.windows` (`static/js/windows.js`) for drag, resize and
maximize — §1.7 restates their contract and adds nothing to it. The API contract is
[`../contracts/http-api.md`](../contracts/http-api.md) §Workspaces, §Auth; the workspace error
codes are server-side facts and this document only maps them to fields and copy.

**The shipped look is the target.** The user likes the current dialogs. This document
codifies them exactly and does not redesign them. §10.2 lists the eight applied exceptions:
three are keyboard or screen-reader fixes with no visual delta (E5, E6, E8); five change a
colour — one at rest (E1, the field boundary), two on focus (E2, E3), one in the dark-theme
label of the login button (E4), and one on the phone only (E7). §12 lists every change that
would move a pixel at rest, applied to nothing.

Source material, not current specs: [`../archive/ui/workspaces.md`](../archive/ui/workspaces.md)
§4.5, §5, §6 (the dialog and its error table),
[`sessions.md`](sessions.md) (current view spec),
[`../archive/ui/topbar-session.md`](../archive/ui/topbar-session.md), and
[`../archive/design/settings-modal.md`](../archive/design/settings-modal.md). Where they
disagree with the shipped code, this document wins; §14 records the disagreements.

`style.css` is `static/css/style.css`, `index.html` is `templates/index.html`. Every claim
about current code cites `file:line`.

---

## 1. Shared frame

Every dialog is one component: a scrim, a floating box, a header, a body slot and a footer.
Four surfaces fill it. Nothing about the frame is per-dialog except the width, the body's
internal layout, and the four booleans in §1.10.

### 1.1 DOM order

Each overlay is a **direct child of `<body>`**, in this order (`index.html:602`, `:626`,
`:670`, `:1239`):

```
body
├── #app                     (the shell; inert while a dialog is open)
├── #auth-overlay            .settings-overlay
├── #workspace-dialog        .settings-overlay   (rendered only when boot.workspace_id)
├── #session-dialog          .settings-overlay   (rendered only when boot.workspace_id)
├── #settings-overlay        .settings-overlay   (out of scope)
├── #export-overlay          .settings-overlay
└── … edit windows, lightboxes
```

Two rules follow from that order, and both are load-bearing:

1. `NB.dialog` makes **every other direct body child** inert (`dialog.js:92`), so a surface
   that is not a body child cannot be a dialog. A note element that happens to carry
   `id="auth-overlay"` is not the shell's (`tests/dom/test_dom.js:41415-41438`). The `.toast`
   node is the one exemption: it is appended to `<body>` while a dialog is open, and an inert
   live region announces nothing. Add `.toast` to the keep-list in `inertNode` (`:92-97`).
2. Overlays that tie on `z-index` paint in DOM order. `#workspace-dialog` is therefore raised
   to 2100 because it opens **from** Settings at 2000 (`style.css:8175`). The other three
   open from outside Settings and stay at 2000.

### 1.2 Overlay and box

| Part | Value | Source |
|---|---|---|
| Overlay | `position: fixed; inset: 0`, face `rgba(0,0,0,.5)` = `--overlay-scrim`, `z-index: 2000` = `--z-modal`, `min-width: 0; min-height: 0` | `style.css:1369-1383` |
| Overlay when closed | `[hidden] { display: none }` re-asserted, because the rule above outranks the UA default | `:1387` |
| Box | `position: fixed; left/top: 50%; translate(-50%,-50%)`; `background: --surface-panel`; `border: 1px --border`; `border-radius: 12px` = `--radius-lg`; `box-shadow: 0 20px 60px rgba(0,0,0,.5)` = `--shadow-modal`; `display: flex; flex-direction: column`; `overflow: hidden`; `touch-action: none` | `:1819-1840` |
| Box maximum | `max-width: 96vw; max-height: 92vh` | `:1826-1827` |
| Dialog opened from a dialog | `z-index: 2100` = `--z-dialog`; today only `#workspace-dialog` | `:8175` |
| Motion | none. No transition on the overlay or the box today | measured; `grep transition` finds none on these rules |

`touch-action: none` is the whole box (`:1839`). It exists for the drag handle and the resize
grip, and it also stops a touch drag from scrolling a dialog body. §10.2 E8 moves it off the
scrolling children; the visual result is unchanged.

### 1.3 Header

| Property | Value | Source |
|---|---|---|
| Layout | `display: flex; align-items: center; justify-content: space-between`, `flex-shrink: 0` | `:1897-1904` |
| Padding | `14px 18px` (off the 4 px grid; shipped) | `:1901` |
| Separator | `1px solid --border`, full width inside the box | `:1902` |
| Title | `<h2 id="…-title">`, `margin: 0`, `font-size: 1.14rem`, `font-weight: 600`, `letter-spacing: .3px` | `:1905-1910` |
| Trailing cluster | `.settings-header-actions`, `display: flex; gap: 2px; flex-shrink: 0`; injected by `NB.windows` | `:1913`; `windows.js:109-136` |
| Close | `.icon-btn` text `×` (`index.html:631`, `:675`, `:1243`): `background: none; border: none; padding: 4px 8px; border-radius: 6px; font-size: 1.3rem; color: --text-muted`; hover `--text-primary` on `--accent-soft` | `:1345-1355` |
| Cursor | `move` over the header (the drag affordance) | `:1841-1843` |

Title size note: `1.14rem` and `--text-lg` is `1.15rem` (§4.2). They differ by 0.14 px at
`--font-scale: 1`. The shipped literal stays; §10.4 records it.

**The maximize control is injected into every dialog header**, so a header that ships one
button ends up with two, grouped in `.settings-header-actions` (`windows.js:122-135`). The
auth header ships **no** button, so its maximize control is appended directly to the header
(`windows.js:123-126`) — the login gate has a maximize button and no close. That is the
shipped behaviour; §12 P4 proposes removing it there.

### 1.4 Body

`settings-body` is a flex row with zero padding (`:1921-1927`). Two shapes fill it:

| Shape | Used by | Rule |
|---|---|---|
| **Column form** | auth, workspace, session | `.settings-body.auth-form`: `display: flex; flex-direction: column; gap: 0; padding: 14px 18px 18px` (`:2285-2290`) |
| **Section scroller** | export | `.settings-sections`: `flex: 1 1 auto; overflow-y: auto; padding: 4px 18px 18px` (`:1984-1989`), overridden for export by `.export-modal .settings-sections { padding: 4px 18px 18px }` (`:5760`) |

The body is the **only** scroller. The header and the footer never scroll, and the box is
`overflow: hidden`, so a long body scrolls inside the rounded corners rather than pushing the
footer off-screen (`:1834-1837`).

Inside a section scroller, a section is `padding: 14px 0` with a bottom `1px --border`, and
the last section drops its border (`:1990-1994`). In the export dialog the error line is a
sibling **after** the last section (`index.html:1305`), so the Scope section is not
`:last-child` and keeps its separator. That is the shipped look: three rules and the error
line under the last one.

### 1.5 Footer

| Property | Value | Source |
|---|---|---|
| Layout | `display: flex; justify-content: flex-end; gap: 8px; flex-shrink: 0` | `:2257-2265` |
| Padding | `12px 18px` | `:2261` |
| Separator | `1px solid --border` on top | `:2262` |
| Face | `--surface-panel` (same as the box, so the footer reads as part of it) | `:2263` |
| Order | secondary actions left, commit action right | `index.html:656-659`, `:689-692`, `:1308-1312` |

A dialog footer holds two or three buttons and never a link, a field, or a status line. The
only footer with three is Export, and all three are secondary (§5.1).

### 1.6 Width rules

| Dialog | Width | Height | Source |
|---|---|---|---|
| Auth | `min(420px, 92vw)` | `auto`, capped `92vh` | `.auth-modal`, `:2272-2280` |
| Workspace | same `.auth-modal` | same | `index.html:627` |
| Session | same `.auth-modal` | same | `index.html:671` |
| Export | `min(520px, 92vw)` | `auto`, capped `92vh` | `.export-modal`, `:5755-5759` |
| Settings (chrome owned by `edit-window.md`; out of this scope) | `min(--settings-modal-width, 96vw)` default `75vw` | `min(--settings-modal-height, 92vh)` default `85vh` | `:1824-1825` |

The shipped `.settings-modal` default is a 75 vw × 80 vh window. `.auth-modal` and
`.export-modal` are later rules at equal specificity, so they win the width and the height for
these four dialogs: they size to content and centre. That is why the login screen has no tall
empty band under the button.

`NB.windows` writes **inline** `left/top/width/height` onto any modal with saved geometry
(`windows.js:60-75`, `:180`), which outranks all of the above. A user who resized the login
box gets that size back on the next load, per overlay id (§1.7).

### 1.7 Window chrome — drag, resize, maximize

These four dialogs are free-floating windows because they are `.settings-modal` elements.
[`edit-window.md`](edit-window.md) §5 owns the full contract; the dialog-relevant facts:

| Property | Value | Source |
|---|---|---|
| Drag | the header, minus any button; left button only; 12 px viewport margin | `windows.js:138-186`, `:23` |
| Drag start | the centred box is frozen into inline pixels, `transform: none` | `:152-159` |
| Drag end | `{left, top, w, h}` saved under the overlay id | `:175-182` |
| Resize | one 18 × 18 grip, bottom-right, `z-index: 5`, L bracket in `--text-muted` at `.55`; minimum 320 × 240 | `style.css:1846-1867`; `windows.js:21-22`, `:196-227` |
| Maximize | `.settings-modal--max`: full viewport, radius 0, `!important`; the grip is hidden and drag/resize are ignored | `style.css:1877-1887`; `windows.js:87-99`, `:144-146`, `:198-201` |
| Maximize reset | any `hidden` change on the overlay clears it | `windows.js:244-256` |
| Persistence | `localStorage["nb:windowGeometry"]`, keyed `auth-overlay` / `workspace-dialog` / `session-dialog` / `export-overlay` | `windows.js:20`, `:55-58` |
| Grip keyboard | none: a `div` with a `title`, no `tabindex`, no role | `windows.js:79-83` |

The grip is pointer-only. That is a known gap shared with the edit windows (§12 P14).

### 1.8 Containment, focus and return

`NB.dialog.open(overlay, opts)` (`dialog.js:75-108`):

1. Records `document.activeElement` as the invoker, and `opts.fallbackFocus` as the fallback.
2. Sets `inert` on every other direct body child, and keeps doing so through a
   `MutationObserver` for overlays parsed later (`:92-99`).
3. Wraps `Tab` and `Shift+Tab` at the edges of `focusables(overlay)`, counting the dialog
   container as both ends so focus cannot fall to `BODY` (`:46-73`).
4. Focuses `opts.initialFocus`, else the `[role="dialog"]` element, adding `tabindex="-1"` if
   it has none (`:102-107`).

`NB.dialog.close(overlay)` (`:110-119`) clears the flags and returns focus to the invoker if
it is still usable — connected, not `body`, and with a layout box (`:25-32`) — else to
`fallbackFocus`. That `usable()` test is why the workspace dialog passes
`fallbackFocus: visibleTrigger()`: its usual opener is a popover row that is hidden before the
dialog opens, so the invoker fails the test (`workspaces.js:594-599`).

`NB.dialog` is single-owner. The workspace dialog can be opened from inside Settings, so it
re-establishes Settings' containment on **every** close path (`workspaces.js:609-624`,
`:631-640`; §12 C1 in [`controls.md`](controls.md)).

| Dialog | `initialFocus` | `fallbackFocus` | Source |
|---|---|---|---|
| Auth | `#auth-password` | none | `auth.js:102` |
| Workspace | `#ws-name` | `visibleTrigger()` | `workspaces.js:594-599` |
| Session | `#session-name` | the opener passed in (the `+`, the row's `⋯`, or the tab strip) | `sessions.js:858-861`, `:1017-1020` |
| Export | none → the dialog container | `#activity-bar .activity-btn[data-view="explorer"]` | `export.js:50-51`, `:369-373` |

Export focusing its container is deliberate and tested: `Shift+Tab` from it must wrap to the
last control (`tests/browser/test_auth_export_browser.js:737-751`).

### 1.9 Validation slot

One slot, one element, one shape, in all four dialogs:

| Property | Value | Source |
|---|---|---|
| Element | `<div class="auth-error" role="alert">` — `#auth-error`, `#ws-error`, `#session-error`, `#export-error` | `index.html:613`, `:654`, `:687`, `:1305` |
| Type | `--danger`, `.89rem` | `:2315-2320` |
| Reserved height | `min-height: 18px` so the footer does not jump when a message appears | `:2318` |
| Margin | `2px 0 4px` | `:2319` |
| Export variant | `hidden` until there is a message, and `margin: 4px 0 0` (`settings-auth-error`) | `index.html:1305`; `:2345-2347` |
| Empty text | the element stays present with empty text in auth, workspace and session; only export hides it | markup above |

One message at a time. The sentence carries the reason; there is no icon, no title, and no
prefix except the fallback wording in §3.4.

### 1.10 Esc, backdrop and the close button

| Dialog | Esc | Backdrop click | Header `×` | Cancel button |
|---|---|---|---|---|
| Auth | **no** — the gate cannot be dismissed | **no** | **no** | **no** |
| Workspace | yes, `stopPropagation()` so one press does not also close Settings | yes | yes | yes |
| Session | yes, `stopPropagation()` | yes | yes | yes |
| Export | yes, on `document` (no stopPropagation needed: nothing sits underneath) | yes | yes | yes |

Sources: `workspaces.js:1080-1094`, `sessions.js:1024-1035`, `export.js:1076-1083`,
`index.html:602-619` (auth ships no close control).

`Esc` is handled per surface, not by `NB.dialog`. Each dialog is responsible for its own
dismissal; the frame owns containment only (`dialog.js:1-6`).

A dialog whose request is in flight ignores close: `closeDialog()` returns early while
`submitting` is true (`workspaces.js:626-629`, `sessions.js:865-868`), so Esc, the backdrop
and `×` cannot leave a request without a surface to report into.

### 1.11 Loading

| Dialog | Busy signal |
|---|---|
| Auth | the submit is `disabled`; nothing else changes. No `aria-busy`. |
| Workspace | `<form aria-busy="true">`, submit disabled, label `Adding…` / `Saving…` |
| Session | `<form aria-busy="true">`, submit disabled, label `Creating…` / `Saving…` |
| Export | **nothing.** No busy state, no progress, no disabled control |

Sources: `auth.js:124-137`; `workspaces.js:642-647`; `sessions.js:895-903`;
`export.js:1038-1047`. Export is the gap: a PDF export can sit for up to two 15 s waits
(`export.js:56`, `:482-517`) with the dialog looking idle. §10.2 E5 covers auth's missing
`aria-busy`; §12 P2 covers export's missing progress.

---

## 2. Auth — the password gate

### 2.1 Layout

`#auth-overlay > .settings-modal.auth-modal` at 420 px, height to content (`index.html:602-619`).
Top to bottom:

| Order | Element | Value |
|---|---|---|
| 1 | Header `<h2 id="auth-title">Sign in</h2>` + injected maximize | §1.3 |
| 2 | Help paragraph `.auth-help` | `--text-muted`, `.93rem`, `margin: 4px 0 12px` (`:2291-2295`) |
| 3 | Row: label `Password` (flex `0 0 130px`) + `<input type="password" class="auth-input">` | `:2005-2021`, `:2297-2307` |
| 4 | Error slot `#auth-error[role="alert"]` | §1.9 |
| 5 | Actions row `.settings-form-actions` with one `.settings-action.auth-submit` | `:2026-2031`, `:2308-2314` |

The field is the one **mono** field in the app besides the path chip: `font: 1rem
"SFMono-Regular", Menlo, Consolas, monospace` (`:2304`). Its face is `background: var(--bg)`
(`:2299`), which is `--surface-page` — one step off the `--surface-well` every other field
uses. Recorded, not corrected: the difference is a shade at the same radius and leaves no
visible seam. §12 P12 proposes the shared face.

Row padding is `8px 0` inside `.auth-form` (`:2296`), not the global `6px 0`.

### 2.2 Copy

| Slot | String | Source |
|---|---|---|
| Title | `Sign in` | `index.html:605` |
| Help | `This notebook is password-protected. Enter the password to continue.` | `index.html:608` |
| Label | `Password` | `index.html:610` |
| Button | `Sign in` | `index.html:615` |
| Empty field | `Enter the password.` | `auth.js:123` |
| Wrong password | `Invalid password` (server prose, verbatim, no period) | `app.py:1850`; `auth.js:134` |
| Rate limited | `Too many failed attempts; try again in a minute` (verbatim) | `app.py:1839`; `auth.js:134` |
| Anything else | the thrown message, else `Login failed` | `auth.js:134` |

Server sentences are shown verbatim: no trailing period is added and no prefix is added. The
auth dialog is the only place in the app that prints a server sentence unedited; that is the
shipped behaviour and it is what the browser test asserts (`/too many|try again/i`,
`tests/browser/test_auth_export_browser.js:443-444`).

### 2.3 States

| State | Treatment |
|---|---|
| Signing in | submit `disabled`; `.auth-submit:disabled { opacity: .6; cursor: progress }` (`:2314`). Label does not change. |
| Error | one line in `#auth-error`; the field keeps what was typed; the submit is re-enabled in a `finally` (`auth.js:135-137`) |
| Locked page | `body.auth-locked`: `#app` at `opacity: .25` with `pointer-events: none`; `#topbar` and `#auth-overlay` at full opacity and full pointer access; `#editor-pane`, `#sidebar`, `#side-panel` and `#activity-bar` blurred 6 px (`style.css:2321-2332`) |
| Data wipe | on lock, viewer content, the tree and search results are emptied (`auth.js:71-95`); a 401 while the modal is already up wipes again but does not clear the typed password or the message (`auth.js:163-180`) |
| Re-required | any gated request returning 401 fires `auth:required`, which reopens the modal from wherever the user is (`auth.js:163-180`) |

The lock is visual plus `inert` from `NB.dialog`; there is no second lock treatment
(`shell-frame.md` §2.8).

### 2.4 Error and lockout detail

- Five failed attempts in 60 s per IP, then 429 (`../contracts/http-api.md` §Rate limiting).
  The dialog shows the server's sentence; it does not count down and does not disable the
  field.
- The message clears only when the dialog is opened fresh (`auth.js:107-108`), not on typing.
  That is deliberate: the user is re-entering the same secret, and clearing on each keystroke
  would remove the reason while they retype.
- A success reloads the page (`auth.js:128-130`); the dialog is never seen closing.

### 2.5 Keyboard

| Key | Where | Effect |
|---|---|---|
| `Enter` | in the field | submits (`auth.js:158-160`). The form has `onsubmit="return false"` (`index.html:607`), so `Enter` is the only path — a click on the button calls the same function (`:157`) |
| `Tab` | inside the dialog | maximize → password → submit → wraps. The box is the initial target only when `NB.dialog` is absent |
| `Esc` | anywhere | nothing |

### 2.6 What the gate does not have

No close, no cancel, no backdrop dismissal, no "remember me", no role choice, no password
reset. The server supports a second, read-only password (`../contracts/http-api.md`
§Authentication), but the dialog takes one field and the server decides which role it is.
Do not add a role selector (§13).

---

## 3. Workspace dialog — add and rename

One dialog, two modes, switched at open time (`workspaces.js:570-603`). Rendered only when
`boot.workspace_id` exists (`index.html:625`); on a page without it the module is absent and
the picker's Add row is not built (`workspaces.js:113-115`, `:954`).

### 3.1 Add vs rename

| Part | Add | Rename |
|---|---|---|
| Title | `Add workspace` | `Rename workspace` |
| Help | `Point at a folder of Markdown notes on this machine. Nothing is copied or moved.` | `Rename only changes the label. The folder stays where it is.` |
| Name | empty, then auto-filled from the folder's basename while untouched | the current name, pre-selected |
| Folder row | visible | **hidden** (`dialog.pathRow.hidden`) |
| Will open row | hidden until the typed path is absolute | **always visible**, showing the workspace's current path |
| Submit | `Add workspace`, primary | `Save`, primary |
| Busy | `Adding…` | `Saving…` |
| Route | `POST /api/workspaces` | `PATCH /api/workspaces/<id>` |

Sources: `workspaces.js:52-61`, `:579-588`, `:759-761`; `../contracts/http-api.md` §Workspaces.

Both modes are admin-only: `openDialog` returns early without `canManage`
(`workspaces.js:571`), and the picker's Add row and the Settings buttons are not built for a
viewer (`:358-366`, `:865-887`).

### 3.2 Fields

| Field | Markup | Behaviour |
|---|---|---|
| Name | `#ws-name`, `type="text"`, `maxlength="60"`, `autocomplete="off"`, `spellcheck="false"`, placeholder `Work journal` | Trimmed before validation and before submit (`workspaces.js:750`). Auto-filled from the path basename while the user has not typed in it (`:560-568`); typing stops the suggestion (`:1099-1103`) |
| Folder | `#ws-path`, `type="text"`, `autocomplete="off"`, `spellcheck="false"`, placeholder `/home/you/notes`, `aria-describedby="ws-resolved ws-error"` | Free text. `~` is **not** expanded in the browser: the home directory is the server's (`../archive/ui/workspaces.md:602`). Absolute-path shape is checked client-side on submit (`workspaces.js:753-756`) |
| Will open | `.ws-resolved-path` chip: `background: --surface-well`, radius 4, `padding: 3px 6px`, `.8rem` mono, `overflow-wrap: anywhere` | Echoes the **typed** value, not the server's realpath (`workspaces.js:550`). See §12 P13 |
| Error | `#ws-error[role="alert"]` | §1.9 |

Layout: label column `flex: 0 0 130px` (`:2017-2021`), rows `6px 0` (`.auth-form` overrides
to `8px 0`, `:2296`). Field face `--surface-well`, border `1px --border`, radius 6,
`padding: 6px 10px`, `.9rem` (`:2073-2082`).

### 3.3 The resolved row

`updateResolved()` (`workspaces.js:541-551`):

| Mode | Row |
|---|---|
| Add, typed path shorter than 2 characters or not absolute | hidden |
| Add, absolute path | visible; text = the typed string, verbatim |
| Rename | visible; text = the workspace's stored path (set at open, `:586`) |

The label says **Will open**, and the value is what the user typed. The server stores the
folder's absolute **realpath** (`../contracts/http-api.md` §Workspaces), so a symlinked or
`..`-laden path can open on a different string than the one displayed. The value is honest as
a preview of the input and wrong as a promise of the stored path; §12 P13 fixes the label
rather than faking a resolution.

### 3.4 Error table — code to field to copy

The server attaches a stable `code` (`../contracts/http-api.md` §Workspace error codes).
`ERROR_FIELD_BY_CODE` (`workspaces.js:86-104`) picks the field; `serverErrorMessage`
(`:687-746`) picks the sentence. One message at a time in `#ws-error`; the named field gets
`aria-invalid="true"`, a `--danger` border and focus (`:525-539`).

| `code` | Status | Field | Copy |
|---|---|---|---|
| `name_empty` | 400 | Name | `Give the workspace a name.` |
| `name_too_long` | 400 | Name | The server sentence, final punctuation normalised: `Workspace names are limited to 60 characters.` |
| `name_duplicate` | 400 | Name | `A workspace called “{name}” already exists.` |
| `path_not_absolute` | 400 | Folder | `Use an absolute path, like /home/you/notes.` |
| `path_missing` | 400 | Folder | `That folder doesn’t exist.` |
| `path_not_directory` | 400 | Folder | `That path is a file, not a folder.` |
| `path_inside_install` — folder inside the install tree | 400 | Folder | `That folder is inside the server’s install folder. Pick a folder outside it.` |
| `path_inside_install` — folder contains install/config | 400 | Folder | `That folder overlaps the server’s install or config folder. Pick another folder.` |
| `path_unreadable` | 400 | Folder | `That folder can’t be read. Check its permissions.` |
| `path_overlap` | 400 | Folder | `This folder overlaps “{other}” ({path}). Workspaces can’t contain one another.` — or, when the server sentence carries no quoted name, `This folder overlaps another workspace. Workspaces can’t contain one another.` |
| `bad_body`, `too_many`, `state_too_large`, `default_not_removable`, `not_admin`, `loopback_required`, `unknown_workspace`, `write_failed` | 400/403/404/500 | none | `Could not add the workspace: {message}.` · rename: `Could not rename the workspace: {message}.` · no message: `Could not add the workspace.` / `Could not rename the workspace.` |
| unknown code, or no code | any | Folder (prose fallback) | the same `Could not …` sentence |

The client copy uses curly quotes and curly apostrophes; the server prose uses straight ones.
The client string wins wherever it has one (`workspaces.js:692-714`), which is why the table
above is the copy of record.

Two conditions share `path_inside_install`, and the client separates them by reading
`install or config` in the server prose (`:705-710`). Do not collapse them into one sentence:
"inside" and "contains" are different mistakes with different fixes.

### 3.5 Submit enablement

`updateSubmitState()` (`workspaces.js:553-558`):

```
disabled = submitting || name.trim() === "" || (mode === add && path.trim() === "")
```

Consequences a builder must keep:

1. The button is **not** disabled for a malformed path. A non-empty relative path enables
   submit, and the client catches it on submit with `Use an absolute path…`
   (`:753-756`). Disabling on shape would make the field look broken while typing.
2. The auto-suggested name means typing a folder is enough to enable submit in practice.
3. Submitting always re-validates; the button state is a hint, never the guard.

### 3.6 Success and failure

- **Failure:** the dialog stays open, the submit label returns to its mode's label, the form
  loses `aria-busy`, the field is marked and focused, and the message is written
  (`workspaces.js:786-794`). The only path that keeps the dialog open is a failed write.
- **Add success:** the dialog closes, the list is refreshed, and — when it was opened from the
  picker — the picker reopens with the new row focused (`:779-785`). From Settings, the user
  stays where they were. Adding never switches workspace (`../archive/ui/workspaces.md:785-790`).
- **Rename success:** the dialog closes, both mounts are updated without a reload, the Settings
  list re-renders, and focus returns to the renamed row's **Rename** button (`:768-775`,
  `:903-913`).
- **No toast on success.** The dialog closing and the row appearing is the feedback.

### 3.7 Clearing

Editing the field that owns the error clears the message and `aria-invalid`; editing the
*other* field does not (`workspaces.js:1099-1109`). Clearing on blur is wrong: it removes the
reason while the user is still reading it.

---

## 4. Session dialog — create, rename, delete

One dialog for create and rename (`index.html:670-695`), plus a native confirm for delete
(`sessions.js:775-823`). Rendered only when `boot.workspace_id` exists; without it the `+` is
present but disabled with `Sessions can’t be changed on this page.`
(`sessions.js:512-519`).

### 4.1 Create vs rename

| Part | Create | Rename |
|---|---|---|
| Title | `New session` | `Rename session` |
| Help | `A session is a named set of open tabs. Pinned tabs stay in every session.` | `Rename only changes the label. Its tabs stay open.` |
| Name | empty, placeholder `Deep work` | current name, pre-selected, no placeholder |
| Submit | `Create session` | `Save` |
| Busy | `Creating…` | `Saving…` |
| Opened from | the panel header `+`, the rail view's `+`, the topbar picker's `New session…` row, or a tab's *New session from tab* | a row's `⋯` → `Rename…` |

Sources: `sessions.js:55-78`, `:837-863`, `:703-727`.

The label column is narrower than the shared 130 px: `#session-dialog .settings-label`
is `flex: 0 0 92px` (`style.css:8507`). One short word, one short row; keep it.

### 4.2 Limit and hint

| Fact | Value | Where it is visible |
|---|---|---|
| Name limit | 40 characters after trimming (`tabs.js:41`) | `maxlength="40"` (`index.html:682`); enforced again on typing and on paste (`sessions.js:1040-1043`, `:924`) |
| Session limit | 20 per workspace (`tabs.js:40`) | the `+` carries `aria-disabled="true"`, `title="20 sessions is the limit. Delete one first."` and `aria-describedby` to a screen-reader note (`sessions.js:508-522`, `:172-178`) |
| Pinned-tab hint | in the dialog's help line, and again in the view's footnote `Pinned tabs are shared by every session.` with a `📌` glyph marked `aria-hidden` (`sessions.js:75`, `:180-190`) | the dialog and the panel |

The pin glyph in the footnote is content-adjacent chrome that predates
[`foundations.md`](foundations.md) §9.3. It is outside this document's scope (the view
belongs to `side-panel-views.md`); note that the dialog itself uses words, not the glyph.

### 4.3 Validation and copy

Submitted name = `value.trim().slice(0, 40)` (`sessions.js:924`). The slice means a pasted
60-character name is silently truncated to 40 **before** validation, so the over-long message
(`Session names are limited to 40 characters.`) is reachable only from the model's own code
(`:975-978`), not from the field. Keep the message; it is the server/model contract.

| Condition | Copy |
|---|---|
| Empty | `Give the session a name.` |
| Over 40 | `Session names are limited to 40 characters.` |
| Duplicate (trimmed, case-insensitive, excluding the row being renamed) | `A session called “{name}” already exists.` |
| Write refused, no code | `Could not create the session.` / `Could not rename the session.` |

Sources: `sessions.js:70-74`, `:905-918`, `:974-987`. Validation runs on submit only; the
button is never disabled for content, and every open resets it to enabled
(`:852-854`) — a submit left disabled by the previous open is a shipped bug that was fixed and
is asserted by `tests/browser/test_core_ui_browser.js:1875-1878`.

### 4.4 Success

Dialog closes, the list refreshes, and focus moves to the new or renamed row
(`sessions.js:952-965`). A create from a tab's menu does not switch session and keeps the tab
strip's own focus rule (`:940-946`, `:961`). No toast.

### 4.5 Delete confirm

A `window.confirm` (`sessions.js:775-786`), not a dialog. The message is composed
(`:811-823`):

```
Delete “{name}”?
{body}[ You’ll switch to “{next}”.][\nUnsaved edits in its files will be lost.]
```

| Part | Value |
|---|---|
| `{body}`, 0 tabs | `It has no open tabs.` |
| `{body}`, 1 tab | `Its open tab will close.` |
| `{body}`, n tabs | `Its {n} open tabs will close.` |
| `{next}` | present only when the deleted session is active and a neighbour exists; the neighbour is the previous session, else the next |
| Dirty line | present only when one of the session's files has unsaved changes |

Cancel returns focus to the row's `⋯` (`:780-785`). A refusal from the model leaves the row and
the focus where they are (`:798-808`). Deleting the last session is impossible: the item is
disabled with `The only session can’t be deleted.` (`:735-750`).

---

## 5. Export dialog

### 5.1 Layout

`#export-overlay > .settings-modal.export-modal` at 520 px, height to content
(`index.html:1239-1314`). The body is a section scroller (§1.4) with three sections and an
error line:

| Section | Rows |
|---|---|
| **Format** | `Output`: radios `PDF` / `HTML` (HTML checked) + a help paragraph |
| **Options** | `Width`: `Fit` / `80%` / `Full` (Fit checked) · `Colors`: `Light` / `Dark` (Light checked) · `Contents`: checkbox `Table of contents` (checked) |
| **Scope** | `File`: `Current file` / `Section` (Current checked) · `Note`: the file label · `Heading`: the section `<select>`, hidden until Section |

Section heading: `<h3>` at `.79rem`, uppercase, `letter-spacing: .8px`, `--text-muted`,
`margin: 0 0 10px` (`style.css:1996-2003`). Row label `flex: 0 0 130px`, `.93rem`,
`--text-muted` (`:2017-2021`). Format help: `.settings-help`, `.89rem`, `--text-muted`,
`margin: 0 0 10px` (`:2004`).

Radio groups are **native radios in a plain flex row**, not the Settings radio chip:

```
.export-format-options, .export-scope-options, .export-width-options, .export-theme-options
  { display: flex; gap: 14px }
  label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; font-size: .93rem }
```

(`style.css:5761-5777`). The container carries `role="radiogroup"` and an `aria-label`
(`index.html:1251`, `:1266`, `:1274`, `:1291`), which is redundant next to a real `<fieldset>`
but is the shipped markup; §12 P6 proposes the fieldset that
[`controls.md`](controls.md) §3.3 step 11 asks for.

The checkbox uses `accent-color: var(--accent)` (`style.css:5785-5788`).

**The footer has three secondary buttons and no primary:** `Cancel`, `Preview`, `Export`
(`index.html:1308-1312`). Export is the commit action and is not styled as one. That is the
shipped look; §12 P1 proposes the promotion.

### 5.2 Format options

| Value | Label | What it does |
|---|---|---|
| `html` (default) | `HTML` | Builds a standalone document and downloads it as `{title}.html` (`export.js:671-675`, `:1025-1035`) |
| `pdf` | `PDF` | Renders into a hidden iframe, paginates with Paged.js, moves the sheets into a print-only layer, and calls `window.print()` (`export.js:572-594`) — the browser's print dialog is where "Save as PDF" lives |

Help copy, verbatim: `PDF opens the browser's print dialog — choose "Save as PDF". HTML
downloads a self-contained file with the rendered note and diagrams baked in.`
(`index.html:1256-1260`).

### 5.3 Options

| Row | Values | Effect |
|---|---|---|
| Width | `Fit` / `80%` / `Full` | class `export-width-fit` / `-80` / `-full` on the exported body (`export.js:310-317`) |
| Colors | `Light` / `Dark` | class `export-theme-light` / `-dark`; picks the embedded palette and the highlight.js theme (`export.js:777-792`) |
| Contents | checkbox | prepends the TOC: flat for PDF, a collapsible sidebar for HTML (`export.js:171-305`, `:441-447`) |

Options are read at run time from the checked radio, not stored: every open resets to
HTML / Fit / Light / TOC on / Current file. §12 P11 proposes remembering them.

### 5.4 Scope, file label and section list

- `Note` is `<code id="export-file-label" class="settings-value settings-mono">`. It holds the
  target path or `(no file open)` with a muted `.empty` class (`export.js:361-365`;
  `style.css:5789`). `.settings-mono` is `--surface-raised`, radius 4, `padding: 3px 8px`,
  `.86rem` mono, `word-break: break-all` (`:2115-2123`).
- The dialog exports **the active file** when opened from the topbar, or **a specific path**
  when opened from a file-tree, bookmark or tab menu (`export.js:353-361`).
- `Heading` is a native `<select class="settings-text-input">` (`index.html:1302`). It is
  populated from the resolved content's `h1`–`h3` headings, matched line-wise by
  `/^(#{1,3})\s+(.+?)\s*$/m` (`export.js:119-131`); each option is labelled `#`×level + a
  space + the heading text, and its value is the character offset of the heading line. The
  list is filled by `refreshSections()` (`:333-351`), the row is `hidden` unless Scope is
  Section, and the select is `disabled` when the note has no headings.
- Changing Scope re-runs `refreshSections()` (`export.js:1080`), which re-resolves the content
  and can hit the server for a non-active file.

The section list is the one place where the dialog reads content it does not already have; on
a slow or missing file the select is simply empty and disabled (`export.js:347-350`).

### 5.5 Preview

`Preview` builds the same document and opens it in a **new browser tab** as a blob URL
(`export.js:1055-1070`); nothing is shown inside the dialog. The format decides what the tab
looks like: PDF previews the real paginated A4 sheets with Paged.js, HTML previews the sidebar
layout (`:1049-1054`). The blob is revoked after 60 s (`:1065`). With no file open it writes
`No file is open to preview.` into the error line (`:1058`).

A pop-up blocker makes Preview look broken: `window.open` is called after an `await`, so it is
not in the original click gesture. Recorded, not fixed; §12 P10.

### 5.6 Run, progress, error

`Export` (`export.js:1038-1047`):

1. Hide the error line.
2. Read format and scope.
3. HTML: build, then download. PDF: build, paginate in the iframe (up to two 15 s waits),
   mount the print root, `window.print()`.
4. On rejection: write `e.message` into `#export-error` and unhide it; without that element,
   `alert("Export failed: …")`.

| Message | Cause |
|---|---|
| `No file is open to export.` | no active or target path (`export.js:395`, `:604`) |
| `marked.js is not available.` | the Markdown renderer failed to load (`:397`) |
| `Select a section heading to export.` | Scope = Section with no valid heading selected (`:403`) |
| `Pagination produced no pages to print.` | Paged.js produced no sheets (`:590`) |
| anything else | the thrown message, verbatim |

There is **no progress state and no cancel** (§1.11). `Cancel` closes the dialog, but the
promise keeps running; a finished PDF export can still open the print dialog after the user
has walked away. That is the largest honesty gap in this document; §12 P2.

### 5.7 What the dialog does not do

It does not export a folder, a session, or the whole notebook. It does not write to the
notebook. It does not offer a filename: the download name is the note's basename
(`export.js:613`, `:672`).

---

## 6. Toasts and app-level confirmations

### 6.1 The toast, as shipped

| Property | Value | Source |
|---|---|---|
| Node | one `<div class="toast">`, created on first use, appended to `<body>` | `app.js:1152-1159` |
| Role | `role="status"`, `aria-live="polite"` | `app.js:1157-1158` |
| Face | `--surface-raised`, `1px --border`, radius 6, `.86rem`, `padding: 8px 14px` | `style.css:3787-3798` |
| Place | fixed, `right: 20px; bottom: 20px`, `z-index: 3000` = `--z-toast`, `max-width: 80vw` | `:3788-3803` |
| Shadow | `0 4px 12px rgba(0,0,0,.3)` = `--shadow-toast` | `:3798` |
| Motion | `opacity` and `translateY(6px) → 0`, `150ms ease`; the reduced-motion twin exists **only inside the phone query** (`:7764-7770`), so a desktop toast still animates — a pre-existing gap, recorded | `:3799-3805`, `:7764-7770` |
| Duration | 1500 ms by default (`ms` argument, else 1500); one at a time, last write wins | `app.js:1168-1171` |
| Pointer | `pointer-events: none` — it never eats the click under it | `style.css:3802` |
| Warn variant | `.toast.warn`: border and text `--warn` | `:3806` |
| Phone | `left/right: 16px`, bottom above the rail + inset, `min-height: 44px`, radius 10, `font-size: 14px` | `:7745-7755` |

`controls.md` §2.14 specifies a 2.4 s duration; the shipped default is 1.5 s. Shipped wins in
this pass (§12 P9).

### 6.2 When a toast is right

A toast carries **one sentence about something that already finished**, and no action:

- `Could not switch workspace: {message}` (`workspaces.js:501`).
- `Could not remove the workspace: {message}` (`:922`).
- `Could not load workspaces: {message}` (`:1068`).
- Copy/save confirmations from elsewhere in the app (`app.js:1140-1151`).

A toast is wrong when the user must decide, must retype, or must find a control. A destructive
action never lives in a toast, because a strip that disappears cannot own the consequence
([`controls.md`](controls.md) §8).

### 6.3 When a dialog is right

A dialog is right when the app needs **input** (a name, a path, a password), when a **field**
owns the failure, or when the answer is **irreversible**. All four dialogs here are the first
case; the delete confirm is the third.

The rule for a failure inside a dialog: it goes in the dialog's own error slot (§1.9), on the
field that owns it, and the dialog stays open. A toast for the same failure would leave the
user in a dialog that looks like it did nothing.

### 6.4 The four native confirms

`window.confirm` is the only confirmation surface today. It cannot be styled, it blocks the
page, and it is announced by the browser with the origin — that is the shipped behaviour and
this pass does not replace it (§12 P3).

| Trigger | Copy | Source |
|---|---|---|
| Delete a session | §4.5 | `sessions.js:811-823` |
| Remove a workspace | `Remove “{name}” from the workspace list?` then a blank line and `Its folder and notes stay on disk.` | `workspaces.js:917-918` |
| Switch workspace with an unsaved draft | `Switch to “{name}”?` then a blank line and `The page reloads and your unsaved draft is discarded.` | `workspaces.js:484-488` |
| Discard a designer draft | owned by the designers; out of scope | `diagram-designers.md` |

Each is `OK` = proceed, `Cancel` = nothing changes. The cancel path restores focus to the
control that opened the prompt (`sessions.js:780-785`).

---

## 7. States matrix

Rows are dialogs; columns are conditions. `—` means the state does not exist.

| Dialog | Loading | Invalid | Server error | Success | Long text | Narrow (861–1023) | Phone (≤860) |
|---|---|---|---|---|---|---|---|
| **Auth** | submit disabled, `.6` opacity, `cursor: progress`; no label change | empty field → message only, no field mark (E5 adds it) | message in `#auth-error`; field keeps its value; submit re-enabled | page reloads; dialog never seen closing | password field type is mono 1 rem; no wrap | 420 px, centred | 358.8 px at 390; field 16 px / 44 high; button 44 |
| **Workspace** | form `aria-busy`, submit disabled, `Adding…` / `Saving…` | field `aria-invalid` + danger border + danger-soft halo; focus moves there | one line; field marked; dialog stays open | closes; picker reopens with the new row focused, or Settings stays; rename focuses the row's Rename | path wraps in the Will-open chip (`overflow-wrap: anywhere`); the input scrolls horizontally | 420 px | 358.8 px; label column stays 130 px, so the field is ~180 px wide |
| **Session** | form `aria-busy`, submit disabled, `Creating…` / `Saving…` | field `aria-invalid` + focus; E2 adds the danger border | one line; dialog stays open | closes; focus lands on the new/renamed row | 40-char cap; the field scrolls, the row ellipsizes | 420 px; label 92 px | 358.8 px; label 92 px |
| **Export** | **nothing** (§12 P2) | — | `#export-error` unhidden with the thrown message | HTML: a download starts. PDF: the print dialog opens | the Note chip breaks anywhere; option rows overflow at XL (E7 wraps) | 520 px | 358.8 px; sections scroll if taller than 92vh |

Every message is `--danger` on `--surface-panel`. The panel sits between the page and raised
pairs measured in [`foundations.md`](foundations.md) §3.4 (dark 6.20 / 5.07, light 5.44 /
4.68), so the slot clears 4.5:1 in both themes on the box face, not only on the page.

---

## 8. Keyboard and ARIA

### 8.1 Roles and names

| Dialog | Role attributes | Source |
|---|---|---|
| Auth | `role="dialog" aria-modal="true" aria-labelledby="auth-title" tabindex="-1"` — **no** `aria-describedby` | `index.html:603` |
| Workspace | `… aria-labelledby="ws-dialog-title" aria-describedby="ws-dialog-help" tabindex="-1"` | `:627-628` |
| Session | `… aria-labelledby="session-dialog-title" aria-describedby="session-dialog-help" tabindex="-1"` | `:671-672` |
| Export | `… aria-labelledby="export-title" tabindex="-1"` — no description | `:1240` |

The description points at the help paragraph, which is the dialog's first sentence. Auth is the
one that omits it; §10.2 E5 adds it.

The box carries `tabindex="-1"` in the markup on all four, so `NB.dialog`'s default focus
target is focusable without mutation (`dialog.js:104-106`).

### 8.2 Focus order

DOM order, no positive `tabindex`. For all four: header cluster (maximize, then close where
one exists) → body fields in visual order → footer buttons left to right. The frame wraps at
the ends (§1.8).

Two shipped quirks worth knowing before "fixing" a test:

1. `NB.windows` inserts the maximize control **before** the close button inside
   `.settings-header-actions` (`windows.js:122-135`), so Tab meets maximize first.
2. The auth dialog has no close, so its only header stop is maximize.

Initial focus: auth password, workspace name (selected in rename), session name (selected in
rename), export container (§1.8).

### 8.3 Fields, required and invalid

- No dialog uses the `required` attribute; the submit gate (§3.5) and submit-time validation
  (§4.3) are the guards. Do not add `required` without also removing the custom messages, or
  the browser's own bubble will compete with `#…-error`.
- `aria-invalid="true"` is set on the field that owns a failure and removed on edit
  (`workspaces.js:517-539`, `sessions.js:881-893`). Auth sets neither (E5).
- `aria-describedby` on a field points at its error **and** its preview text where one exists:
  `#ws-path` → `ws-resolved ws-error`; `#session-name` → `session-error`; `#ws-name` and
  `#auth-password` point at nothing today (E5, E6).
- `autocomplete` is set on auth (`current-password`, `index.html:611`) and off on both name
  fields and the path. `spellcheck="false"` on the path and both names.

### 8.4 Live regions

| Region | Role | Behaviour |
|---|---|---|
| `#auth-error` | `alert` | text swapped; the element never leaves the DOM, so the announcement is reliable |
| `#ws-error` | `alert` | same |
| `#session-error` | `alert` | same |
| `#export-error` | `alert` | hidden until used, then unhidden; a `role="alert"` that is revealed is announced |
| `.toast` | `status` + `aria-live="polite"` | never focused, never `alert` for a success |

Errors are text, not a colour: the `--danger` colour is a second signal only
([`foundations.md`](foundations.md) §3.4).

### 8.5 Esc, backdrop and return

§1.10 is the table. The return target is §1.8; the one rule to keep is that a dialog opened
from a control that disappears (a popover row, a menu item) must pass a `fallbackFocus` that
still has a layout box.

### 8.6 Gaps this pass closes

| Gap | Closed by |
|---|---|
| No focus ring inside auth, session or export (only Settings and the workspace dialog have a catch-all) | E3 |
| Auth field has no `aria-invalid` and no `aria-describedby` | E5 |
| Auth form has no `aria-busy` while signing in | E5 |
| `#ws-name` is not associated with `#ws-error` | E6 |
| Session field has no invalid border despite `aria-invalid` | E2 |
| Phone fields outside the auth dialog are ~33 px with 12.6 px type | E7 |
| `touch-action: none` on the box blocks touch scrolling of a long body | E8 |

---

## 9. Responsive and phone

### 9.1 Measurements at 390

The phone shell starts at 860 px (§8.2 of the foundations); nothing here introduces a second
switch.

| Thing | At 390 | Why |
|---|---|---|
| Auth / workspace / session box | `min(420, 92vw)` = **358.8 px**, centred, 15.6 px gutter each side | `style.css:2273` |
| Export box | `min(520, 92vw)` = **358.8 px** | `:5756` |
| Box height | content, capped at `92vh` = 717.6 px at 780 | `:2279`, `:5758` |
| Auth field | 16 px type, `min-height: 44px` | `:7761` |
| Auth button | `min-height: 44px` | `:7762` |
| Workspace / session / export fields | 36 px, `--text-ui`, `--border-strong` (unified with Settings) | `:2073-2082`; E1 |
| Workspace / session / export buttons | ~33 px | `:2145-2153`; E7 |
| Toast | full width, 16 px insets, 44 px tall, above the rail | `:7745-7755` |
| Window chrome | drag, grip and maximize all still active; the 320 × 240 minimum still applies | `windows.js:21-22` |

358.8 px is not full-bleed: there is a visible scrim strip on each side. That is the shipped
look for these four dialogs, and it is correct for a short form
([`controls.md`](controls.md) §2.11). §12 P5 proposes a sheet for export only, because it is a
preference set rather than a short form.

### 9.2 What does not happen on a phone

- No dialog becomes full-screen. There is no `100vw` rule inside the phone query for these
  four.
- No sheet, no grabber, no bottom anchoring.
- No second close affordance. The header `×` stays 26 px, not 44: a real target gap, recorded
  in §12 P8 with the edit windows' identical gap.
- The keyboard does not resize or scroll-into-view the dialog. `--m-kb` is used by the capture
  sheet only. On a 390 × 640 viewport with the keyboard up, the auth field can sit behind it.
  Unsettled (§14.2 item 4).

### 9.3 Narrow desktop (861–1023)

The boxes keep their 420 / 520 width; the clamps only bite below ~456 / ~565 px. Nothing
reflows. The export option rows fit at 520 with 36 px of padding either side.

---

## 10. Tokens and CSS target

### 10.1 Tokens reused — no new token

| Role | Token | Shipped expression |
|---|---|---|
| Scrim | `--overlay-scrim` | `rgba(0,0,0,.5)`, `:1372` |
| Box face | `--surface-panel` | `var(--bg-panel)`, `:1828` |
| Box border | `--border` | `1px solid var(--border)`, `:1829` |
| Box radius | `--radius-lg` | `12px`, `:1830` |
| Box shadow | `--shadow-modal` | `0 20px 60px rgba(0,0,0,.5)`, `:1831` |
| Box stacking | `--z-modal` / `--z-dialog` | `2000` / `2100`, `:1373`, `:8175` |
| Field face | `--surface-well` | `var(--code-bg)`, `:2078` |
| Field boundary | `--border` → **`--border-strong`** (E1) | `:2080`, `:2301` |
| Field focus | `--accent` + `--accent-soft` halo | `:8176`, `:2085` |
| Invalid | `--danger` + `--danger-soft` | `:8177-8178` |
| Button face | `--surface-raised` | `var(--bg-elev)`, `:2146` |
| Primary face / label | `--accent` / `--text-on-accent` | `:6549-6554` |
| Error text | `--danger` | `:2316` |
| Focus ring | `--focus-ring` (2 px `--accent`), offset 1 px | `:8179` |
| Toast | `--surface-raised`, `--shadow-toast`, `--z-toast` | `:3793-3798` |
| Motion | toast `150ms ease` — shipped `.15s`, between `--dur-1` and `--dur-2`; nothing else in this set moves | `:3801` |

No new token is required. The frame, the field, the button, the error slot and the toast all
resolve to foundation tokens or to shipped literals.

### 10.2 Exceptions applied

Each is an accessibility or consistency fix. "No visual delta" means nothing changes at rest,
in either theme.

| # | Exception | Why | Visual delta |
|---|---|---|---|
| **E1** | Field boundary `--border-strong` in all four dialogs | `--border` is 1.39:1 dark / 1.27:1 light on the box face, under the 3:1 UI floor ([`foundations.md`](foundations.md) §3.5, AC6; [`controls.md`](controls.md) AC11) | the outline is lighter: `#383a45` → `#7b8194` dark, `#d8dde4` → `#78828f` light |
| **E2** | Focus halo and invalid styling on the session and export fields, matching the workspace dialog | the workspace dialog already has both (`style.css:8176-8178`); the other two rely on a border swap and a UA outline | halo appears on focus; danger border appears only in the error state |
| **E3** | `:focus-visible` ring = `var(--focus-ring)` at `outline-offset: 1px` in auth, session and export | only `#settings-overlay` (`:1445`) and `#workspace-dialog` (`:8179`) have a catch-all; the other three fall back to the UA ring or none | ring appears only on keyboard focus |
| **E4** | `.auth-submit` label → `--text-on-accent`; hover → 3 px `--accent-soft` halo, no brightness filter | white on `--accent` is 2.61:1 in the dark theme; the same eight-rule fix is already recorded in [`foundations.md`](foundations.md) §3.6 and [`controls.md`](controls.md) C5 | dark theme: label turns near-black (`#14151a`); hover is a halo instead of a brightness bump |
| **E5** | Auth: `aria-describedby="auth-help"` on the dialog, `aria-describedby="auth-error"` on the field, `aria-invalid` on failure, `aria-busy` on the form while signing in | the field and the message were never associated; a screen reader heard the error only because it is also an `alert`, and heard nothing about the field | none |
| **E6** | `#ws-name` gains `aria-describedby="ws-error"` | the path had it, the name did not; a name error was announced only as an alert | none |
| **E7** | Phone: 16 px type and `min-height: var(--control-h-touch)` on fields and buttons in all four dialogs; export option rows and footer wrap | below 16 px iOS zooms the viewport on focus ([`foundations.md`](foundations.md) §4.4); three option labels clip at 390 + XL | phone only; 29 → 44 px fields, 12.6 → 16 px type |
| **E8** | `touch-action: auto` and `overflow-y: auto` on the scrolling body (all four `.auth-form` instances, `.settings-sections`), with `max-height: calc(92vh - 130px)` so the auth form actually scrolls | `touch-action: none` on the box (`:1839`) stops a finger dragging a long body; a height-auto form has no scrollport, so the workspace/session errors clip. [`controls.md`](controls.md) C6 records the same defect | none |

E1 is the only exception that changes every dialog at rest. It is a floor requirement, not a
style choice; if it is rejected, the record must say so and `foundations.md` AC6 must change
(§14.2).

### 10.3 Exact rules, in landing order

Append after the `#session-dialog` rule at `style.css:8507`, one block. It replaces no existing
declaration and needs no reordering.

```css
/* ---------- Dialogs — field, focus and touch parity (docs/ui/dialogs.md §10.2) ---------- */

/* E1: a field is a control, so its boundary must clear 3:1 (foundations §3.5). */
#auth-overlay .auth-input,
#workspace-dialog .settings-text-input,
#session-dialog .settings-text-input,
#export-overlay .settings-text-input,
#export-overlay select { border-color: var(--border-strong); }

/* E2: one focus idiom and one invalid state across the four dialogs; the
 *      workspace dialog already ships exactly this at style.css:8176-8178. */
#session-dialog .settings-text-input:focus,
#export-overlay .settings-text-input:focus,
#export-overlay select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 var(--stroke-3) var(--accent-soft);
}
#session-dialog .settings-text-input[aria-invalid="true"] { border-color: var(--danger); }
#session-dialog .settings-text-input[aria-invalid="true"]:focus {
  box-shadow: 0 0 0 var(--stroke-3) var(--danger-soft);
}

/* E3: the ring every other shipped surface uses; 1px offset because a dialog
 *     body pads by 14-18px and an outset 2px ring would touch the seam. */
#auth-overlay .settings-modal :focus-visible,
#session-dialog .settings-modal :focus-visible,
#export-overlay .settings-modal :focus-visible {
  outline: var(--focus-ring);
  outline-offset: 1px;
}

/* E9: one field and button ladder across the four dialogs. */
#auth-overlay .auth-input,
#workspace-dialog .settings-text-input,
#session-dialog .settings-text-input,
#export-overlay .settings-text-input,
#export-overlay select {
  height: var(--control-h-lg);
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-ui);
}
#auth-overlay .auth-submit,
#workspace-dialog .settings-action,
#session-dialog .settings-action,
#export-overlay .settings-action {
  height: var(--control-h-md);
  padding: 0 var(--space-3);
  font-size: var(--text-ui);
  line-height: var(--lh-flat);
}

/* E4: the login button is one of the eight white-on-accent rules. */
#auth-overlay .auth-submit { color: var(--text-on-accent); }
#auth-overlay .auth-submit:hover:not(:disabled) {
  background: var(--accent);
  border-color: var(--accent);
  filter: none;
  box-shadow: 0 0 0 var(--stroke-3) var(--accent-soft);
}

/* E8: the box sets touch-action:none for its drag and grip; the scrollers
 *     must not inherit that or a finger cannot scroll them. */
#auth-overlay .auth-form,
#workspace-dialog .auth-form,
#session-dialog .auth-form,
#export-overlay .settings-sections { touch-action: auto; }
#auth-overlay .auth-form,
#workspace-dialog .auth-form,
#session-dialog .auth-form {
  max-height: calc(92vh - 130px);
  overflow-y: auto;
}

/* E7: phone parity — 16px type stops iOS zooming, 44px targets, wrapping
 *     option rows. Values from foundations §4.4 and controls §5. */
@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) {
  #workspace-dialog .settings-text-input,
  #session-dialog .settings-text-input,
  #export-overlay .settings-text-input,
  #export-overlay select { font-size: 16px; min-height: var(--control-h-touch); }
  #workspace-dialog .settings-action,
  #session-dialog .settings-action,
  #export-overlay .settings-action { min-height: var(--control-h-touch); }
  #export-overlay .export-format-options,
  #export-overlay .export-scope-options,
  #export-overlay .export-width-options,
  #export-overlay .export-theme-options { flex-wrap: wrap; }
  #export-overlay .settings-footer { flex-wrap: wrap; }
}
```

E5 and E6 are markup and JS, not CSS:

| Change | File | Line |
|---|---|---|
| `#auth-overlay` gains `aria-describedby="auth-help"`; the help `<p>` gains `id="auth-help"`; `#auth-password` gains `aria-describedby="auth-error"` | `templates/index.html` | 603, 608, 611 |
| `auth.js` sets `aria-invalid` on the field on failure and clears it on success/open; sets `aria-busy="true"` on `.auth-form` around the request | `static/js/auth.js` | 117-138 |
| `#ws-name` gains `aria-describedby="ws-error"` | `templates/index.html` | 638 |

No colour literal is introduced. Every declaration above reads a token.

### 10.4 What must not change

| Shipped value | Why it stays |
|---|---|
| Overlay `rgba(0,0,0,.5)` full-bleed scrim with no blur | one scrim for every dialog; blur is the lightbox's, not a dialog's |
| Header `14px 18px`, footer `12px 18px`, body `14px 18px 18px` | off the 4 px grid, deliberate at 12/14/18 to keep the box compact; snapping to `--space-3`/`--space-4` would add 4 px of height to every dialog |
| Field height 36 px; button 30 px | the unified control ladder (`controls.md` §2.4, §2.1) |
| Title `1.14rem` | equals `--text-lg` within 0.14 px; the literal stays until the token lands |
| Export's three secondary footer buttons | §12 P1 |
| The 420 / 520 widths | measured against the content, and the phone rule re-derives from them |
| `#workspace-dialog` at 2100 | both it and Settings are at 2000 otherwise; the Settings test asserts the order (`tests/browser/test_core_ui_browser.js:1727-1728`) |
| Drag, grip and maximize on all four dialogs | shipped, and the DOM suite asserts one `.win-max` per modal (`tests/dom/test_dom.js:27354-27359`) |

---

## 11. Acceptance criteria

`style.css` is `static/css/style.css`. Each criterion names the file and an observable result.

| # | Criterion | File | Observable |
|---|---|---|---|
| **AC1** | Every dialog is a direct body child with one `[role="dialog"][aria-modal="true"]` box carrying `tabindex="-1"` and a label that resolves | `templates/index.html` | Opening each dialog leaves every other body child `inert === true`; `document.activeElement` is inside the box |
| **AC2** | The frame's numbers are the ones in §1.2–§1.6 | `style.css` | Overlay background `rgba(0,0,0,.5)`, z 2000; box `--surface-panel`, `1px --border`, `12px`, `--shadow-modal`; workspace overlay z 2100 |
| **AC3** | The body is the only scroller and the footer never leaves the box | `style.css` | At 390 + XL, a long export body scrolls inside `.settings-sections`; `.settings-footer` stays visible; the page itself does not scroll |
| **AC4** | Esc and backdrop follow §1.10 exactly | `workspaces.js`, `sessions.js`, `export.js`, `auth.js` | `Esc` closes workspace/session/export; `Esc` on the workspace dialog leaves Settings open; `Esc` on auth does nothing; a backdrop click on auth does nothing |
| **AC5** | Closing returns focus to the opener, or to a usable fallback | `dialog.js`, each module | Opening the workspace dialog from the picker and closing it returns focus to the visible mount; closing export returns to the explorer rail button when the menu opener is gone |
| **AC6** | Auth: empty → `Enter the password.`; 401 → `Invalid password`; 429 → `Too many failed attempts; try again in a minute`; the field keeps its value; the submit re-enables | `auth.js` | `tests/browser/test_auth_export_browser.js:420-444`, `:463-469` still pass; `#auth-password` has `aria-invalid="true"` after a failure |
| **AC7** | Every workspace code lands on the field and copy named in §3.4 | `workspaces.js` | Rejecting `NB.api.createWorkspace` with each code marks that field `aria-invalid` and writes that sentence into `#ws-error`; a field-less code writes it with no field marked |
| **AC8** | Workspace submit is disabled only for an empty name, or an empty folder in add mode | `workspaces.js` | Typing `~/notes` leaves the button enabled and produces `Use an absolute path, like /home/you/notes.` on submit |
| **AC9** | Session: 40-character cap on typing and paste, exact copy for empty/duplicate, submit enabled at every open, delete confirm matching §4.5 | `sessions.js` | `tests/browser/test_core_ui_browser.js:1849-1880`, `:1915-1973` pass; a 60-character paste leaves 40 in the field |
| **AC10** | Export opens in its default state and reports its failures in `#export-error` | `export.js` | HTML / Fit / Light / TOC on / Current file; the Heading row appears only for Section; an empty note disables the select; `No file is open to export.` and `Select a section heading to export.` both land in the slot |
| **AC11** | The toast stays one announced, unfocused, click-through node | `app.js`, `style.css` | `role="status"`, `aria-live="polite"`, `pointer-events: none`, z 3000; calling `notify` twice reuses the node; `document.activeElement` is unchanged |
| **AC12** | Every error slot is `role="alert"` and every failing field is described by it | `templates/index.html`, `workspaces.js`, `sessions.js`, `auth.js` | `#ws-name` and `#auth-password` point at their error; `#session-name` and `#ws-path` already do |
| **AC13** | At 390 the four dialogs are 358.8 px, fields are 16 px, buttons are ≥44, and no dialog scrolls horizontally | `style.css` | A 390 browser run shows `dialog.getBoundingClientRect().width === 358.8` (±0.5), `scrollWidth === clientWidth` on the box, and an export option row that wraps rather than clips at XL |
| **AC14** | No new motion is introduced, and any transition added ships its reduced-motion twin | `style.css` | No `transition` or `animation` exists on `.settings-overlay` or `.settings-modal`. With reduce emulated at 390 the toast appears instantly (`:7764-7770`); at desktop it still transitions, which is the pre-existing gap this pass does not widen |

New assertions belong beside the existing blocks: `tests/dom/test_dom.js` around `:26335`
(auth) and `:42750` (dialog options), `tests/browser/test_core_ui_browser.js:1711-1790`
(workspace) and `:1849-1980` (session), `tests/browser/test_auth_export_browser.js:707-791`
(export).

---

## 12. Proposals, not applied

Ordered by what it costs the user today. None is in the mockup.

| # | Proposal | Why | Cost |
|---|---|---|---|
| **P1** | Make `#export-run` `settings-action--primary` | Export is the commit action of the dialog and is the only secondary among three; [`controls.md`](controls.md) §2.1 asks for one primary per group | one class in `index.html:1311`; the accent fill becomes the loudest thing on the surface |
| **P2** | A progress state for export: `aria-busy` on the body, the run button disabled with `Exporting…`, and a working `Cancel` that aborts the promise | the PDF path can sit 30 s with no feedback, and closing the dialog does not stop it (`export.js:572-594`) | JS: an abort flag through `buildExportDoc`/`waitForPagination`; the iframe work is not cancellable mid-write |
| **P3** | Replace the three prompts in §6.4 (not the designers' fourth) with one `role="alertdialog"` built on this frame | the prompts are the only unstyled surface left, cannot be keyboard-shaped, and print the origin above the sentence | a fifth dialog, its tests, and `controls.md` §2.1's danger-ghost variant |
| **P4** | Skip window chrome on `#auth-overlay` (`data-no-window-chrome`) | a password gate should not be maximizable, and the injected control is its only header stop | `windows.js:229-239` gains one guard; one DOM test asserts a `.win-max` per modal and would need to exempt it |
| **P5** | Export becomes a sheet at ≤860 px | it is a preference set, not a short form ([`controls.md`](controls.md) §2.11, [`mobile-shell.md`](../archive/design/mobile-shell.md) §4.9) | a second presentation for one dialog; the sections already scroll |
| **P6** | Radio groups become `<fieldset>` + `<legend>` | native grouping and arrow keys; the shipped `role="radiogroup"` on a `div` works but is redundant next to the inputs | markup in three sections; [`controls.md`](controls.md) §3.3 step 11 already asks for it |
| **P7** | Fields at `--control-h-lg` (36) and buttons at `--control-h-md` (30) | the shipped ≈33 px is on no rung of the control ladder ([`controls.md`](controls.md) §2.1, §2.4) | 5 px per row; the export dialog grows ~25 px |
| **P8** | The header `×` becomes a 44 px target on the phone | it is ≈26 px inside a dialog whose fields are already 44 | header padding must absorb it; the title baseline shifts |
| **P9** | Toast duration 2.4 s instead of 1.5 s | [`controls.md`](controls.md) §2.14 specifies 2.4 s; 1.5 s can clip a long message before it is read | one constant in `app.js:1171` |
| **P10** | Preview: open the blank tab synchronously, then navigate it | `window.open` after an `await` is blocked by pop-up blockers (`export.js:1055-1070`) | a tab that can be left blank if the build throws |
| **P11** | Remember the last export options | every open resets to HTML / Fit / Light / TOC on, so a repeated PDF export needs the same clicks each time | one `localStorage` key and a read at `open()` |
| **P12** | `.auth-input` takes `--surface-well` like every other field | it uses `--surface-page` (`:2299`), so the login field is a shade off every other field in both themes | 1 declaration; visible as a slightly different field face |
| **P13** | Relabel `Will open` to `Path` (or keep it and have the server echo the realpath) | the row echoes the typed string while the server stores the realpath (§3.3) | copy only, or a new resolve endpoint |
| **P14** | A keyboard path for the resize grip: `role="separator"`, `tabindex="0"`, arrow keys, `Home`/`End` | it is a pointer-only `div` (`windows.js:79-83`); the same gap as `edit-window.md` §12 P10, and one implementation should close both | JS on the grip plus a value contract per modal; the saved geometry is already there |

---

## 13. What not to build

| Rejected | Reason |
|---|---|
| A second dialog frame, or a `.nb-dialog` class family | four dialogs already share one frame; a new one would have to re-earn containment, focus return, drag, resize and persistence |
| Full-screen dialogs on a phone for these four | 358.8 px with a scrim is correct for a short form; a full-screen name field is a page, not a dialog (§9.1) |
| A sheet for auth, workspace or session | they are short forms; the sheet is for a list or a preference set ([`controls.md`](controls.md) §2.11) |
| A custom `<select>` for the export section list | native type-ahead, Home/End and the platform picker for free ([`controls.md`](controls.md) §2.5) |
| A folder browser for the workspace path | the picker would have to read the server's filesystem; the server already validates the path and names the fault (§3.4) |
| A filled danger button for delete | white on `--danger` is 2.78:1 and there is no `--text-on-danger` ([`controls.md`](controls.md) §8) |
| An "Undo" action in the toast that reports a failed workspace switch | a 1.5 s strip cannot own a workspace switch; the dialog or the picker owns it |
| A role selector on the login form | the server decides the role from the password (`../contracts/http-api.md` §Authentication) |
| A new `z-index`, a new shadow, a new breakpoint | [`foundations.md`](foundations.md) §6.2, §5.4, §8.2 |
| A tooltip that carries a fact the user needs | §2.10 of [`controls.md`](controls.md); the disabled reasons here are visible text or `title` on a control that also has `aria-describedby` |
| A drag-only resize | the grip is one today; P10 of [`edit-window.md`](edit-window.md) §12 and P14 here are the same follow-up, owned once |
| `alert()` for an export failure | the error slot is the target; `alert` is only the fallback when `#export-error` is absent (`export.js:1045`) |
| Replacing the auth dialog's missing close with one | the gate must not be dismissible; the missing control is the design |

---

## 14. Unsettled and recorded disagreements

### 14.1 Disagreements with the shipped records

Each is a place where a record says one thing and the stylesheet does another. The shipped
code wins for the current look; the record's value is the proposal's starting point.

| # | Record | Shipped | Position |
|---|---|---|---|
| C1 | [`controls.md`](controls.md) §2.11 gives the header `--space-3 var(--space-4)` and the footer `var(--space-3) var(--space-4)` | header `14px 18px`, footer `12px 18px`, body `14px 18px 18px` (`style.css:1901`, `:2261`, `:2289`) | shipped; the 12/14/18 rhythm is deliberate and snapping it adds height (§10.4) |
| C2 | *(closed)* [`controls.md`](controls.md) §2.4 gives every field `--control-h-lg` (36) | content-sized, ≈33 px shipped | unified to 36 in this pass |
| C3 | [`controls.md`](controls.md) §2.14 gives the toast 2.4 s | 1500 ms (`app.js:1171`) | shipped; §12 P9 |
| C4 | [`controls.md`](controls.md) §2.11 gives the scrim a `--dur-2` fade | no motion on overlay or box | shipped; §12 P6 |
| C5 | [`foundations.md`](foundations.md) §10.2 puts the ring at offset 2 / −2 | offset 1 inside the dialogs (`style.css:8179`) | shipped; the body pads 14–18 px and an outset 2 px ring touches the seam |
| C6 | [`controls.md`](controls.md) §2.11 sends a preference set to a sheet on a phone | every dialog stays 358.8 px centred at 390 | shipped; §12 P5 proposes the sheet for export only |
| C7 | [`../archive/ui/workspaces.md`](../archive/ui/workspaces.md) §4.5 says “Will open” shows the path the server will use | it echoes the typed string (`workspaces.js:550`) | shipped; §3.3 and §12 P13 |
| C8 | [`../archive/ui/workspaces.md`](../archive/ui/workspaces.md) §4.5 requires `aria-describedby="ws-error"` on the offending field | only `#ws-path` has it (`index.html:645`) | the record is right; E6 closes the gap |

### 14.2 Unsettled

1. **E1, the field boundary.** It is the only exception that changes every dialog at rest. It
   is required by `foundations.md` AC6 and `controls.md` AC11, and it is the largest visible
   delta in this pass. If it is rejected, both foundation criteria must be amended rather
   than quietly ignored.
2. **The auth gate's maximize control (P4).** Shipped, tested at the "one `.win-max` per
   modal" level, and wrong on a gate. Needs a decision before anybody writes a test for it.
3. **Toast duration (P9).** 1.5 s shipped against 2.4 s specified. One number, two documents.
4. **Dialog height on a phone with the keyboard up.** Nothing sets `--m-kb` on these four, so
   the field can sit behind the keyboard on a 640 px-tall phone. The fix is either a
   `visualViewport` offset on the box or a sheet (P5); neither is specified yet.
5. **Keyboard resize (P14).** Shared with the edit windows, where the same grip has no keyboard
   path. One implementation, two documents, not yet owned.
6. **Whether `#export-run` should be primary (P1).** It is the clearest consistency defect in
   this set and the one most likely to be noticed, but it is a visual change and the user
   likes the current footer.

