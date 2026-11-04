# Top bar — the active session name

Status: **shipped**, design record. Built in `templates/index.html`,
`static/css/style.css`, `static/js/sessions.js`, `tests/test_app.py` and the DOM
harness `tests/dom/test_dom.js`. The browser-suite assertions in §9 are not
added yet; the label was checked by hand in a real browser.

Reference mockup: [`topbar-session-mockup.html`](topbar-session-mockup.html) — the
label in the shell, before/after, sizes and contrast, a 40-character name with
its tooltip, a narrow desktop, the hidden-bar and phone states, the light
theme, and the four rejected placements.

**Normative source.** §2 (placement, markup, CSS, JS), §3 (tokens), §4
(states), §5 (ARIA), §6 (responsive) and §8 (acceptance criteria). The mockup
illustrates them; where the two differ, this document wins.

This supersedes one sentence of [`sessions.md`](sessions.md) §1.1 D14 ("a second
indicator on the rail, the strip or the topbar would duplicate a fact"). The
rail, the strip, the view and the tab bar are untouched. What changed is the
user's decision: the current session is named in the top bar.

---

## 1. Decision

**Show the active session's name in the top bar, after the workspace chip, as a
plain label.** Not a control: no face, no border, no hover, no focus, no new tab
stop.

Why a label and not a control:

- the request is to **show** a name; the Sessions view and its rail icon already
  own switching, and a second control would duplicate them;
- a chip beside the workspace chip would promise the same thing the workspace
  chip does — a menu — and would not deliver one;
- a label cannot fall out of sync with the model because it has no state of its
  own.

Why after the chip: a session is stored per workspace (`workspaceState[<id>]` in
`config/config.json`, `app.py:92-96`), so the row reads container → set. The
shipped `1 × 16 px` divider separates them, exactly as it already separates the
brand from the chip.

Why the client fills it and not the server: `tabs.js` owns the session model and
its normalisation (`tabs.js:291-416`). A server-rendered name would duplicate
those rules in `app.py` and could disagree with the model for one frame after a
legacy-state migration. The label is between the chip and the spacer, so
inserting it pushes nothing: the actions are anchored by the spacer at the right
edge and no chrome sits to the right of the label. It appears with the restored
tab strip, because both read the same `tabs:changed`; while the spacer has slack
there is no layout shift at all, and in a tight window the label takes its room
from the brand and the chip, which re-clip in that one frame (§6).

---

## 2. Placement and markup

### 2.1 `templates/index.html` — the glyph

Add one symbol to the existing sprite, after `nb-icon-workspace`
(`index.html:91-96`). Two stacked bars read as a *set*; the workspace glyph's two
overlapping cards deliberately do not repeat.

```html
<!-- Session glyph: two stacked bars -- a named set of open tabs. Distinct
     from the workspace glyph (two overlapping cards) so the two labels never
     read as the same kind of thing. currentColor follows --fg-muted. -->
<symbol id="nb-icon-session" viewBox="0 0 16 16">
  <rect x="2.5" y="3.3" width="11" height="3.8" rx="1.4" fill="none"
        stroke="currentColor" stroke-width="1.3"/>
  <rect x="2.5" y="8.9" width="11" height="3.8" rx="1.4" fill="none"
        stroke="currentColor" stroke-width="1.3"/>
</symbol>
```

### 2.2 `templates/index.html` — the bar

Inside the existing `{% if ws_interactive %}` block, directly after
`#workspace-bar`'s closing `</div>` (`index.html:139`) and before that block's
`{% endif %}` (`index.html:140`). It therefore renders only when the workspace
chip does — that is, for the full-access and viewer shells, never for the
unauthenticated locked shell.

```html
<!-- The active session. Context, not a control -- no face and no tab stop.
     It ships hidden and sessions.js fills it, because the client owns the
     session model's normalisation: an absent label is honest, a name the
     model then corrects is not. The `topbar-` prefix is load-bearing:
     `.session-name` already names the Sessions row label (style.css:8246). -->
<span id="session-bar" class="topbar-session" hidden>
  <span class="topbar-divider" aria-hidden="true"></span>
  <span class="topbar-session-chip" title="">
    <svg class="topbar-session-glyph" aria-hidden="true" focusable="false"><use href="#nb-icon-session"/></svg>
    <span class="sr-only">Session: </span>
    <span class="topbar-session-name" id="topbar-session-name"></span>
  </span>
</span>
```

`#topbar-session-name` is **not** `session-name` — that id belongs to the New /
Rename dialog's input (`index.html:647`, `sessions.js:25`).

The tab strip, the spacer, the actions and `#brand` are not edited.

### 2.3 `static/css/style.css` — the rules

Place after the workspace-chip block (after the `.workspace-caret` rules at
`style.css:7904-7909`) and before the `.workspace-menu` popover comment, so the
chip and the label sit together.

```css
/* The active session: context, not a control. It follows the chip because a
 * session lives inside a workspace. No face, no hover, no tab stop, and the
 * same 12 px gap the topbar uses, so the divider reads as a divider.
 *
 * The `topbar-` prefix is not decoration. `.session-name` already names the
 * Sessions row label (style.css:8246) and carries `flex:1 1 auto;
 * margin-right:6px`; an unprefixed rule here would repaint every row name
 * grey at .84rem, strip the active row's 600, and inherit the row's flex
 * behaviour onto this label. */
.topbar-session {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 0 1 auto;
  min-width: 0;
}
/* sessions.js fills it. An empty label must never paint an empty slot or a
 * stray rule on the first frame. */
.topbar-session[hidden] { display: none; }
.topbar-session-chip { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.topbar-session-glyph { width: 12px; height: 12px; flex: 0 0 12px; color: var(--fg-muted); }
.topbar-session-name {
  min-width: 0;
  max-width: 17em;          /* 200 px at .84rem; the full name is in title */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: .84rem;
  font-weight: 500;
  line-height: 1.2;
  color: var(--fg-muted);
}
```

Add one line to the **second** phone query (the one that starts at
`style.css:8065`, where the workspace chip becomes a 44 px icon button):

```css
  /* Sessions are desktop-only (sessions.md D12); the phone names the note. */
  #session-bar { display: none; }
```

The id wins over `.topbar-session`'s `display:flex`; no `!important` and no
second breakpoint.

### 2.4 `static/js/sessions.js` — the fill

The view already re-renders on every state change that can name a session
(`tabs:changed` and `viewer:dirty-changed`, `sessions.js:695-696`), and its
`refresh()` runs once at module load (`sessions.js:691`). The label is one more
output of that same function — no new listener, no new event.

**Refs** (beside the other `getElementById` calls near `sessions.js:80`):

```js
  // The top-bar label. Null in an older harness or a cached shell, so every
  // use below is guarded.
  const topbarLabel = {
    bar: document.getElementById("session-bar"),
    name: document.getElementById("topbar-session-name"),
    chip: null,
  };
  if (topbarLabel.bar) {
    topbarLabel.chip = topbarLabel.bar.querySelector(".topbar-session-chip");
  }
```

**Render** (beside `refresh()`, `sessions.js:179`):

```js
  /* The top bar names the active session. Called from refresh() before the
   * signature guard: a rename or a switch must repaint the label even when
   * the row list is unchanged. Every node is guarded, because the DOM
   * harness is not this shell. */
  function renderTopbarLabel() {
    if (!topbarLabel.bar || !topbarLabel.name) return;
    const active = sessions.find((s) => s.id === activeId);
    if (!active) { topbarLabel.bar.hidden = true; return; }
    if (topbarLabel.name.textContent !== active.name) {
      topbarLabel.name.textContent = active.name;
    }
    if (topbarLabel.chip) {
      const title = "Session: " + active.name;
      if (topbarLabel.chip.title !== title) topbarLabel.chip.title = title;
    }
    topbarLabel.bar.hidden = false;
  }
```

**Call site** — inside `refresh()`, after the `active` flags are set and
**before** the signature early-return:

```js
  function refresh() {
    if (!listEl) return;
    sessions = readSessions();
    activeId = readActiveId();
    for (const s of sessions) s.active = s.id === activeId;
    renderTopbarLabel();                       // <- add this line
    if (signature() === lastSignature) { updateAddBtn(); return; }
    render();
  }
```

That single call site covers every path: first load, switch
(`swapTo` → `tabs:changed`), rename, create, delete, and a viewer's switch. The
writes are compared before assignment, so the dirty-changed tick that fires on
every editor transaction touches no DOM.

**No server change.** `boot_state` / `_boot_workspaces` are untouched; there is
no new endpoint and no new config key.

---

## 3. Tokens

No new token. Reused, unchanged from `style.css:4-87`:

| Token | Dark | Light | Used for |
|---|---|---|---|
| `--bg-panel` | `#22232a` | `#f6f7f9` | the bar behind the label |
| `--fg-muted` | `#8b8d98` | `#5d6470` | the name and the glyph |
| `--border` | `#383a45` | `#d8dde4` | the divider |
| `--fg` | `#e6e6ea` | `#1f2330` | the chip's name beside it (600) |

Contrast, measured on the pair the label actually paints:

| Pair | Dark | Light | Verdict |
|---|---|---|---|
| `--fg-muted` on `--bg-panel` — name | 4.74 | 5.56 | passes 4.5:1 |
| `--fg-muted` on `--bg-panel` — glyph | 4.74 | 5.56 | decorative and `aria-hidden`; still above 3:1 |
| `--fg` at 600 on `--bg-elev` — the chip | 11.30 | 13.48 | the emphasis step the label must stay below |

The label is one step quieter than the chip on two axes at once — colour
(`--fg-muted` vs `--fg`) and weight (500 vs 600) — while keeping the same
`.84rem` size. That is the whole hierarchy: a control beside its context.

---

## 4. States

| Case | What the label shows |
|---|---|
| first paint | `hidden`; the model is empty at module load, so the first `refresh()` hides it. It fills on the first `tabs:changed`, the same emit that paints the restored tab strip (`tabs.js:1441-1451`), so it never shows a name the model then corrects |
| switch session | the new session's name, in the same `tabs:changed` render that repaints the rows |
| rename the active session | the new name, without a reload |
| rename an inactive session | unchanged |
| create a session | the new session's name (creating makes it active) |
| delete the active session | the neighbour the app switched to |
| delete an inactive session | unchanged |
| 40-character name | ellipsised at 17em; `title="Session: {full name}"` |
| zero tabs / empty session | the name; tab counts are not the topbar's business |
| unsaved edits | **no dot.** The active tab already carries the dirty dot; a marker on chrome with no action would read as an alert |
| viewer role | identical; a viewer may switch, and the label follows |
| top bar hidden (`body.topbar-hidden`) | gone with the bar. The `🗂` rail icon and the strip still say where you are |
| phone / coarse pointer | `display:none` with the Sessions view (`sessions.md` D12). The phone's `#mobile-title` names the note |
| no workspace chip (unauthenticated locked shell) | the bar is not rendered at all (it lives inside `ws_interactive`) |
| missing model (`NB.tabs` absent) | `hidden`; the label never shows an empty slot |

There is no loading, error or busy state: the label reads client state that is
already in memory.

---

## 5. Keyboard and ARIA

- **No tab stop.** The label is a `<span>`; Tab order is exactly what it is
  today.
- **No role.** It is text, not a listbox, a menu or a status.
- **No live region.** A rename is confirmed by the dialog and by the Sessions
  row; announcing the topbar would be a second confirmation for one action.
- **Accessible text** is `Session: Deep work` — the `.sr-only` prefix inside the
  chip, then the name. The glyph and the divider are `aria-hidden="true"`.
- The `title` is the full `Session: {name}` string. It is the only discoverability
  affordance, and it is also what an ellipsised 40-character name needs.
- A sighted keyboard-only user cannot raise that tooltip, because the label has
  no focus target. Accepted: the full string is in the visible `.sr-only` text,
  so assistive technology always reads it whole, and the Sessions view lists the
  name as a row with the same hover-only `title` convention. Making the label
  focusable would spend a tab stop and make it look operable — the one thing it
  must not be.
- The label is not part of the `.topbar-actions` group and does not disturb the
  Workspace button's `aria-expanded`, which stays on its own trigger.

---

## 6. Responsive

| Width | Behaviour |
|---|---|
| desktop ≥ 861 px | the label is capped at `17em` and never wraps |
| a long brand + long workspace + long session | the three left-hand names share the shortfall. The chip and the label ellipsise; `#brand` hard-clips, because `text-overflow` does not apply to its `inline-flex` box (`style.css:173`) — a shipped quirk this feature does not change. Nothing overflows the row. The actions keep their width because a flex item's automatic minimum size stops them shrinking below their content; the spacer's base size is 0 and takes free space first |
| ≤ 860 px, or coarse pointer ≤ 1023 px | `#session-bar` is `display:none`; the phone shell has no sessions |
| top bar hidden | not rendered with the bar |

There is no session label in the rail. The rail mount exists for the workspace
because switching workspaces would otherwise be unreachable with the bar hidden;
the session label is not a control, so nothing becomes unreachable.

---

## 7. Copy

| Slot | String |
|---|---|
| accessible text | `Session: {name}` |
| `title` | `Session: {name}` |
| empty | none — the element is hidden |

No user-facing sentence, no unit and no count.

---

## 8. Acceptance criteria

Each one names its verifier in §9. Paint claims are checked in a real browser,
not in jsdom: the harness loads `style.css` as text and applies no cascade
(`test_dom.js:4025`).

| # | Criterion |
|---|---|
| AC1 | With the shell loaded, `#session-bar` is visible and its text is the active session's name. |
| AC2 | The **served** shell (`tests/test_app.py`) contains `#session-bar` with `hidden` and an empty name span, rendered after `#workspace-bar` inside the workspace block — and not at all for an unauthenticated visitor while auth is on. |
| AC3 | Switching sessions updates the label's text and `title` without a reload. |
| AC4 | Renaming the active session updates both. |
| AC5 | Renaming an inactive session leaves them unchanged. |
| AC6 | Deleting the active session names the neighbour the app switched to. |
| AC7 | A name longer than 17em ellipsises and the element's `title` carries the full string. |
| AC8 | The label is not focusable (`tabIndex === -1`), adds no tab stop, and hovering it changes no computed `background`, `border`, `color` or `cursor`. |
| AC9 | With `hideTopbar` on, no label is visible. |
| AC10 | Under the phone query the label is not visible, and the Sessions view is still hidden by its existing rule. |
| AC11 | The label's accessible text reads `Session: {name}`; the glyph and divider are `aria-hidden`. |
| AC12 | Dark and light both render the name at ≥ 4.5:1 against `--bg-panel`. |

---

## 9. Verification

| Check | Where |
|---|---|
| AC2 | `tests/test_app.py` (`TestIndexAndSeed`, beside `test_index_paints_saved_boot_state` at `test_app.py:84`): render `/` with auth off, assert `id="workspace-bar"` precedes `id="session-bar"`, the bar carries `hidden`, and the name span is empty. Extend `test_index_paints_defaults_until_authenticated` (`test_app.py:186`) with `assertNotIn('id="session-bar"', anon_html)`. This is the only check that can prove placement: the hand-written harness in `test_dom.js:191-199` has no workspace chip, so it can never prove the bar sits after one. |
| AC1, AC11 | `tests/dom/test_dom.js`, the `== sessions ==` block (`test_dom.js:39795`). Add the nodes to the harness shell's `#topbar`; the module null-guards, so the harness may also omit the name span and must still not throw. |
| AC3–AC6 | same block: drive `NB.tabs.swapTo`, `renameSession`, `deleteSession` and read `#topbar-session-name` after each. |
| AC7, AC8 | `tests/browser/test_core_ui_browser.js`, the existing sessions scenario (`test_core_ui_browser.js:1740-1920`): `scrollWidth > clientWidth` plus the `title`; then `page.hover('#session-bar')` and compare the computed `background-color`, `border-width`, `color` and `cursor` before and after. |
| AC1, AC3, AC12 | same browser scenario: assert the label at load and after a switch, in both themes. |
| AC9 | browser suite: enable "Hide top bar", assert the label is not visible, then restore. |
| AC10 | `tests/browser/test_mobile_browser.js`: assert `#session-bar` is not visible at the phone viewport. |

No backend endpoint, config key or boot value changes; the only Python work is
the template assertion above.

---

## 10. What this does not do

- It does not change the session model, its limits, its order, its storage or
  its normalisation.
- It does not add a session control, a menu, a popover or a tab stop.
- It does not touch the tab strip, the Sessions view, the rail, the tab menu or
  the dialogs.
- It does not show a dirty dot, a tab count or a "2 sessions" count.
- It does not move the workspace chip, the brand, the spacer or the actions.
- It does not render the name server-side.
