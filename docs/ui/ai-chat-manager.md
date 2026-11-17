# AI chat bar and chat manager — design handoff

Status: current spec — the bar and the manager are shipped; §2.5 (Clear's move into the
bar) is the target for the next pass. This document adds one bar and one in-panel view to the
AI side panel. It does not restate the panel: `ai-panel.md` owns the header, the provider row,
the log, the cards and the composer; this document owns the chat bar between the header and
the provider row, the manager view that replaces everything below the panel header, and the
Clear control.

Reference mockup: [`ai-chat-manager-mockup.html`](ai-chat-manager-mockup.html) — dark and
light boards for the chat bar at 240 and 140 with its three actions, the bar's states (not
open, no chat, no file, locked during a turn, empty chat with Clear disabled), the manager
with chats at 240 and 140, the manager empty, inline rename, the delete confirm, the storage
warning, and the panel header before and after Clear moved.

**Normative source.** This document owns the chat bar and the chat manager: anatomy,
states, copy, keyboard and CSS target. It reads [`foundations.md`](foundations.md) for every
token, [`controls.md`](controls.md) for control anatomy, ARIA, focus and target sizes,
[`guidelines.md`](guidelines.md) for the document format, the control ladder and the
list-row contract, and [`ai-panel.md`](ai-panel.md) §1–§2, §6–§10 for the view it sits in.
Chat storage is browser-local and has no server contract; the data layer (keys, ids,
timestamps, write policy) belongs to `static/js/ai.js` and is named here only where the UI
needs a fact.

**Prerequisite.** The token landing in `foundations.md` Appendix A, and the AI pass in
`ai-panel.md` §10 (the header pattern, `.ai-chat-log`, the composer card). Until that pass
lands, the new rules read the same tokens and will resolve, but the surrounding panel will
not match its own spec.

Every claim about current code cites `file:line`.

---

## 1. Where the two pieces sit

### 1.1 The view with the chat bar

`#ai-view` is a `side-panel-view` host (`templates/index.html:430`) filled by
`NB.ai.mount(host)` (`static/js/ai.js:2806`). `mount()` appends the panel header, then
one chat stack holding the chat bar, the config hint, the provider bar, the log, the attach
bar and the composer, then the manager (`ai.js:2806-3626`). The chat bar is a sibling between
the header and the hint, and the manager is a second sibling of the whole chat group.

```
#ai-view  flex column, --surface-panel, overflow hidden
├─ .panel-header             34    "AI Assistant" · collapse only              (Clear moved)
├─ .ai-chat-stack            flex  every chat-side zone; hidden while the manager is open
│   ├─ .ai-chat-bar          69    chat <select> · path · New · Manage · Clear
│   ├─ .ai-config-hint       —     config failure or the viewer gate           (unchanged)
│   ├─ .ai-model-bar         48    provider <select> (+ .ai-acp-note)          (unchanged)
│   ├─ .ai-chat-log          flex  THE ZONE THAT SCROLLS                       (unchanged)
│   ├─ .ai-attach-bar        0/…   chips                                       (unchanged)
│   └─ .ai-input-row         113   composer card                               (unchanged)
└─ .ai-chat-manager          flex  NEW: replaces the stack, one scroller of its own
    ├─ .ai-cm-header         34    "Chats" · close
    ├─ .ai-cm-search         52    search field + clear
    ├─ .ai-cm-list           flex  THE ZONE THAT SCROLLS: groups and rows
    │   ├─ .ai-cm-group            sticky head (path · current) + .ai-cm-rows
    │   └─ .ai-empty               no chats, or no match
    └─ .ai-cm-footer       73/105  New chat · storage · warning · Delete all chats
```

### 1.2 Heights at 240

| Zone | Height | Sum |
|---|---|---|
| Panel header | 34 | frame pattern, `ai-panel.md` §2.1 |
| Chat bar | **69** | 8 + 30 select + 2 gap + 24 meta row + 4 + 1 border |
| Provider row | 48 | `ai-panel.md` §1.1 |
| Composer + margins | 138 | `ai-panel.md` §1.1 |
| Log at 560 | ≈ 271 | 560 − 34 − 69 − 48 − 138 |

The bar costs 69 px of log height (340 → 271 at the default panel height). That is the
price of a chat name and its file being visible at all times; §2.1 records why the two-line
bar beats a one-line bar with a 48 px-wide title.

The manager, with the stack hidden, spends 34 + 35 header + 52 search + 73 footer = 194, so
its list is ≈ 366 at 560. With Delete all chats visible the footer is 105 — 8 top + 30 New
chat + 8 + 14 storage line + 8 + 24 button + 12 bottom + 1 border — so the list is ≈ 334. The
control is `hidden` when the open note has no chats, which is the 73 px case.

Clear's move into the bar (§2.5) does not change that height: the three 24 px actions share
the existing 24 px meta row and make the group 76 px wide. The one taller case is the
`not open` flag at 140 px, where the group wraps to a second line and the bar becomes 95 px
for that state (§2.3).

### 1.3 Widths

| Part | At 240 (content 216) | At 140 (content 116) |
|---|---|---|
| Chat select | 216 wide; ~30 characters of title before the native arrow | 116 wide; ~14 characters, full title in `title` |
| Bar path | 136 without the flag; 74 with it | 36 without the flag; with the flag the group wraps and the path gets 54 |
| Bar actions | 76 (24 + 2 + 24 + 2 + 24) | 76 — the targets never shrink |
| Manager search field | 216 | 116 |
| Manager row | 200 | 100 |
| Row meta: path | 118 | 18 |

The three 24 px action buttons in the bar and the two in each row are fixed. Everything that
can give way is text: the select clips, the paths ellipsize, the meta line clamps — or wraps,
when the flag is showing (§2.5). The select is on its own row, so a third action never
narrows it. Nothing is hidden and no container query is introduced (`foundations.md` §8.2
rule 3, `ai-panel.md` §9.1).

---

## 2. The chat bar

### 2.1 Control choice: one native `<select>`

The bar carries the active chat in a native `<select>` — the same element the provider
picker 48 px below already uses (`static/js/ai.js:3545`, `style.css:5587`) — rather than a
custom button plus a popup. Two reasons: the select brings type-ahead, `Home`/`End`, the
platform picker and grouping through `<optgroup>` for free at 140 px, where a custom popup
would have to be positioned inside a 140 px panel; and the rich list already has a home —
grouping, search, rename and delete are the manager's job, so a popup would only duplicate
it. The select's limits (one line, no recency) are why the path has its own line and the
manager owns everything else.

### 2.2 Anatomy

```html
<div class="ai-chat-bar" data-test-chat-bar>
  <select class="ai-chat-pick" data-test-chat-select aria-label="Active chat"
          title="Fix the intro — notes/projects/launch.md">
    <optgroup label="This file">
      <option selected>Fix the intro</option>
    </optgroup>
    <optgroup label="notes/projects/budget.md">
      <option>Why is Q3 short</option>
    </optgroup>
    <optgroup label="Unfiled">
      <option>Old scratch</option>
    </optgroup>
  </select>
  <div class="ai-chat-meta">
    <span class="ai-chat-path" title="notes/projects/launch.md">notes/projects/launch.md</span>
    <span class="ai-chat-flag" title="This chat belongs to notes/projects/budget.md, which is not open in the viewer.">
      <svg class="icon" aria-hidden="true" focusable="false"><use href="#nb-icon-warning"/></svg>not open
    </span>
    <span class="ai-chat-actions">
      <button type="button" class="ai-chat-btn" data-test-chat-new aria-label="New chat" title="New chat">
        <svg class="icon" aria-hidden="true" focusable="false"><use href="#nb-icon-plus"/></svg>
      </button>
      <button type="button" class="ai-chat-btn" data-test-chat-manage aria-label="Manage chats"
              title="Manage chats" aria-expanded="false" aria-controls="ai-chat-manager">
        <svg class="icon" aria-hidden="true" focusable="false"><use href="#nb-icon-list"/></svg>
      </button>
      <button type="button" class="ai-chat-btn ai-clear" data-test-chat-clear
              aria-label="Clear conversation"
              title="Clear the conversation (the assistant forgets this chat's context)">
        <svg class="icon" aria-hidden="true" focusable="false"><use href="#nb-icon-broom"/></svg>
      </button>
    </span>
  </div>
</div>
```

| Part | Value | Why |
|---|---|---|
| Bar box | `padding: var(--space-2) var(--space-3) var(--space-1)`, `border-bottom: 1px var(--border)`, `--surface-panel` | Hairline groups "chat identity" above the provider row |
| Select | `width: 100%`, `height: --control-h-md` 30, `padding: 0 --space-6 0 --space-2`, `--surface-well`, 1 px `--border-strong`, `--radius-sm`, `--text-ui`, `--text-primary` | Exception X1: 6 px below the field ladder (§11) |
| Select hover / focus / disabled | Border `--accent` / 2 px `--focus-ring` at offset 2 / `--opacity-disabled` | As the provider select, `ai-panel.md` §2.2 |
| Option text | The chat title, one line | The group label carries the file |
| Option groups | `This file` for the open file's chats; each other file by its path; `Unfiled` last | Mirrors the manager's order (§3.4) |
| Select `title` | `<title> — <path>` | The 140 px select clips to about fourteen characters |
| Path | `--font-mono`, `--text-xs`, `--text-muted`, one line, end ellipsis, `flex: 1 1 0`, `min-width: 0`, `title` = full path | The panel's path idiom (`.ai-tool-path`, `.ai-edit-path`) |
| Flag | `--warn`, `--text-xs`, `--lh-flat`, 14 px `nb-icon-warning`, `flex: 0 0 auto` | Word plus glyph, never colour alone (`foundations.md` §3.4) |
| Actions | `gap: var(--space-hair)`, three 24 px icon buttons — New, Manage, Clear | `--control-h-sm` is the desktop target floor; Clear is owned by §2.5 |
| Meta row | `min-height: var(--control-h-sm)`; the buttons set the row height | Keeps the bar's height stable in every state |
| Coarse pointer | Actions 44 × 44, select 44 high | `ai-panel.md` §8.5 |

`aria-expanded` and `aria-controls` on Manage declare that a region will replace the chat
group; no `aria-haspopup` and no dialog role are added, because there is no popup, no scrim and
no focus trap — the manager is a disclosure inside the panel, and the panel header stays live
above it.

### 2.3 States

| State | Trigger | Select | Path line | New | Manage | Clear |
|---|---|---|---|---|---|---|
| Normal | a chat is active and its file is open | enabled, active chat selected | the chat's path | enabled | enabled | enabled when the chat has a message or a chip |
| Not open | the active chat's file ≠ `NB.viewer.getPath()` | enabled | the chat's path + `not open` flag | enabled | enabled | same rule as Normal |
| No chat for this file | the open file has no chat | enabled, one option `No chat yet` | the open file's path | enabled | enabled | **disabled** — nothing to clear |
| No file open | `NB.viewer.getPath()` is empty | disabled, one option `No file open` | `No file open` | **disabled** | enabled | **disabled** |
| Locked | a turn is in flight | disabled | normal | **disabled** | **disabled** | **enabled** — the only live control in the bar |
| Locked, card pending | a write/patch card awaits Apply/Reject | disabled | normal | **disabled** | **disabled** |

The path line always shows the **active chat's** file, never the open file: the bar answers
"which chat am I in", and when those two differ the flag says so.

**Not-open origins.** One: the viewer opens a different file while a turn — or a write/patch
card awaiting Apply/Reject — is outstanding, so the switch to that file's newest chat waits for
it to finish and the panel still shows the old chat. Selecting another note's chat from the
select or the manager is not an origin: that action opens the note's tab first (§3.1). The flag
informs; it does not disable the composer. The transcript is the chat's own, and the assistant
can read any file with its tools, so a mismatch is context, not a fault. Unfiled chats have no
note to open, so selecting one leaves the viewer where it is. When the open is refused — the
session's file cap — nothing switches: the picker returns to the active chat and the panel keeps
the chat it already showed.

**Locked.** The select, New chat and Manage are all disabled for the span of a turn. A chat
cannot be swapped, created or deleted while a reply is being written into it — deleting the
active chat mid-stream would leave the stream writing into a chat that no longer exists. The
reason is visible in the view: the composer shows Stop. The field stays draftable behind it
(`ai-panel.md` §5.2). Clear stays enabled and aborts (§2.5). This is one rule instead of four
per-chat exceptions in the manager. The same lock holds while
a write/patch permission card awaits Apply/Reject: the tool loop is stopped on that decision,
so the chat the card belongs to must not move either.

**New chat** creates a chat for the open file, titled `New chat`, makes it active, and moves
focus to the composer textarea. It never opens a file and never touches another chat.

### 2.4 What the bar does not do

No rename and no delete: both live in the manager, next to the row they act on. No popup
menu. No recency in the option text — the manager has it.

### 2.5 Clear — a bar action, one chat deep

Clear empties the active chat's transcript and keeps the chat, its title, its file and its
place in the list. It is the panel's only destructive control that stays live while a turn is
streaming, and that fact decides where it lives.

**Placement.** It is the third icon in the bar's action group, after Manage:
`New · Manage · Clear`.

| Option | Fits 140 px | Live while locked | One click | Verdict |
|---|---|---|---|---|
| (a) third icon in the bar | yes — it costs path width, not the select (§1.3) | **yes** | yes | **chosen** |
| (b) per-row action in the manager, beside Rename and Delete | yes — the row's action line is 76 px in an 84 px box | **no** — Manage is disabled during a turn, so the manager is unreachable exactly when Clear is the only escape | no: open manager, find row, press | rejected |
| (c) manager header or footer action for the active chat | yes | **no**, same reason | no | rejected |
| (d) keep the header text button | yes | yes | yes | rejected |

(b) fails twice more. It puts a second irreversible action 26 px from Delete, on **every**
row, including rows that are not the active chat — and clearing a non-active chat from inside
the manager has no visible effect, because the transcript is not on screen. A destructive
control must act on what the user can see. (d) passes every functional test and still loses on
meaning: the panel header is the frame's chrome, shared with Explorer (`ai-panel.md` §2.1), it
describes the view, and Clear describes one chat. Next to a chat selector it reads as "reset
the assistant", which is not what it does. Removing it also leaves the header at title plus
collapse — the frame's pattern with nothing extra bolted on.

**What (a) costs, in numbers.** The select sits on its own row, so a third 24 px action never
narrows it: at 140 px the select is still 116 px and shows about fourteen characters. The cost
lands on the path line (162 → 136 at 240; 62 → 36 at 140) and, in one state, on the bar's
height. With the `not open` flag showing at 140 px the meta row cannot hold path + flag +
76 px of actions, so it wraps: the flag keeps its ~58 px on line 1, the path takes the 54 px
left, and the action group moves to a second right-aligned line. The bar is 95 px in that one
state and 69 px everywhere else. No control is hidden, no breakpoint and no container query is
added (`foundations.md` §8.2 rule 3).

**The control.**

| Property | Value |
|---|---|
| Element | `<button type="button" class="ai-chat-btn ai-clear" data-test-chat-clear>` |
| DOM position | last child of `.ai-chat-actions`, after Manage chats |
| Icon | new sprite symbol `nb-icon-broom` — a slanted handle into a bound head with two bristle strokes; 16 grid, 1.5 stroke, round caps, `currentColor` (`foundations.md` §9.1) |
| Box and glyph | `--control-h-sm` 24 square, glyph `--icon-md` 16 |
| Accessible name | `Clear conversation` |
| `title` | `Clear the conversation (the assistant forgets this chat's context)` |
| Rest | ghost: no border, no fill, glyph `--text-muted` |
| Hover | face `--accent-soft`, glyph `--text-primary` |
| Focus-visible | 2 px `--focus-ring` at offset 2 |
| Pressed | no transform — the bar's other two buttons have none (`controls.md` §2.1 allows it; consistency wins) |
| Disabled | `disabled`, `--opacity-disabled`, `cursor: not-allowed`, no hover, out of the Tab order |
| Locked (a turn streams) | **enabled** — the only live control in the bar, with select, New and Manage dimmed beside it |
| Coarse pointer | 44 × 44, like the other two |
| `.ai-clear` | kept on the element as the test seam; it carries no declarations of its own once the shipped block is deleted (§13.4) |

The glyph is a broom, not a bin. `nb-icon-trash` already means "delete this chat and its
messages" in the manager's rows; two identical glyphs with different scopes — the transcript
versus the chat — is the one confusion this surface cannot afford. A neutral brush also keeps
the escape hatch from looking dangerous: when a reply runs away, Clear is the button the user
reaches for, and a red one would argue against pressing it.

**Enabled rule.** The button is enabled when an active chat exists *and* either the
conversation holds an entry or an attachment chip is pending. It is disabled in the no-chat, the
no-file and the viewer states. While a turn streams it stays enabled, because the
conversation already holds the user's turn — which is also why it is the abort path that does
not need Stop.

**No confirm, no undo.** A decision, not an omission:

1. Clear must abort in one press. A confirm in front of an escape hatch is the wrong shape:
   the user presses Clear *because* the reply went wrong and wants it gone now.
2. The prior decision stands (`ai-panel.md` §12 C10): Clear was confirmless when it was the
   panel's only destructive control. The scope has narrowed since, not widened.
3. The loss is bounded and legible: the chat, its title, its file and its row stay, and the
   log replaces the transcript with its own empty state. Notes on disk are never touched.
4. Delete keeps its two-step confirm because it removes an object that cannot be retyped — the
   title, the file binding, the row. Clear removes content inside an object that survives.
5. The guards are structural rather than modal: disabled when empty, last in the group and so
   away from New, a distinct glyph, and a name and tooltip that state the scope.

If recoverability is ever asked for, copy `#draft-bar`'s `Recover` (`controls.md` §2.14) — a
status strip with one undo — not a dialog. That is not built here.

**After a press.** The conversation empties, the chat's stored entry is rewritten, attachments
are cleared, the turn controls are removed, and the log shows its empty state. Focus moves to
the composer textarea: the pressed button disables itself in the same frame, and a focused
button that turns disabled drops focus to `<body>`. The composer is the next action, so it
takes the focus.

---

## 3. The chat manager

### 3.1 Opening and closing

| Action | Result |
|---|---|
| Manage chats pressed | `.ai-chat-stack.hidden = true`, `.ai-chat-manager.hidden = false`; focus moves to `.ai-cm-title` (`tabindex="-1"`) |
| Close pressed, or `Esc` outside the search field | reverse the two flags; focus returns to the Manage chats button |
| A row's title pressed | the note's tab opens when the chat belongs to another note; the chat becomes active, the manager closes, focus moves to the chat select |
| `Esc` in a non-empty search field | clears the query and keeps the manager open; a second `Esc` closes it |

The manager replaces the provider row, the log, the attach bar and the composer as one unit.
It never opens a modal, never adds a scrim, and never traps focus: `Tab` may leave it into
the panel header and come back, exactly as the Search view behaves in the same frame.

### 3.2 Anatomy

```html
<div class="ai-chat-manager" id="ai-chat-manager" role="region" aria-labelledby="ai-cm-title" data-test-chat-manager hidden>
  <div class="ai-cm-header">
    <h3 class="ai-cm-title" id="ai-cm-title" tabindex="-1">Chats</h3>
    <button type="button" class="ai-chat-btn" data-test-chat-close
            aria-label="Close chat manager" title="Close chat manager">
      <svg class="icon" aria-hidden="true" focusable="false"><use href="#nb-icon-close"/></svg>
    </button>
  </div>

  <div class="ai-cm-search">
    <div class="ai-cm-search-wrap">
      <input class="ai-cm-search-input" type="search" id="ai-cm-search"
             data-test-chat-search aria-label="Search chats" placeholder="Search chats">
      <button type="button" class="ai-cm-search-clear" aria-label="Clear search" title="Clear search" hidden>
        <svg class="icon" aria-hidden="true" focusable="false"><use href="#nb-icon-close"/></svg>
      </button>
    </div>
  </div>

  <div class="ai-cm-list">
    <section class="ai-cm-group ai-cm-group--current" aria-labelledby="ai-cm-g1">
      <h4 class="ai-cm-group-head" id="ai-cm-g1">
        <span class="ai-cm-group-path">notes/projects/launch.md</span>
        <span class="ai-cm-group-flag">current</span>
      </h4>
      <ul class="ai-cm-rows">
        <li>
          <div class="ai-chat-row" data-test-chat-row aria-current="true">
            <button type="button" class="ai-chat-open" data-test-chat-open>Fix the intro</button>
            <div class="ai-chat-row-meta">
              <span class="ai-chat-path" title="notes/projects/launch.md">notes/projects/launch.md</span>
              <span class="ai-chat-sep" aria-hidden="true">·</span>
              <span class="ai-chat-time" title="2026-11-17 09:41">2h</span>
              <span class="ai-chat-sep" aria-hidden="true">·</span>
              <span class="ai-chat-count">6 msgs</span>
              <span class="ai-chat-row-actions">
                <button type="button" class="ai-chat-btn" data-test-chat-rename
                        aria-label="Rename “Fix the intro”" title="Rename “Fix the intro”">
                  <svg class="icon" aria-hidden="true" focusable="false"><use href="#nb-icon-pencil"/></svg>
                </button>
                <button type="button" class="ai-chat-btn danger" data-test-chat-delete
                        aria-label="Delete “Fix the intro”" title="Delete “Fix the intro”">
                  <svg class="icon" aria-hidden="true" focusable="false"><use href="#nb-icon-trash"/></svg>
                </button>
              </span>
            </div>
          </div>
        </li>
      </ul>
    </section>
    <!-- … other files by recency … -->
    <section class="ai-cm-group" aria-labelledby="ai-cm-gN">
      <h4 class="ai-cm-group-head" id="ai-cm-gN"><span class="ai-cm-group-path">Unfiled</span></h4>
      <ul class="ai-cm-rows">…</ul>
    </section>
  </div>

  <div class="ai-cm-footer">
    <button type="button" class="ai-cm-new" data-test-chat-new-manager>
      <svg class="icon" aria-hidden="true" focusable="false"><use href="#nb-icon-plus"/></svg>New chat
    </button>
    <p class="ai-cm-storage" data-test-chat-storage>3 chats · 18 KB of 4 MB</p>
    <p class="ai-cm-warn" role="status">
      <svg class="icon" aria-hidden="true" focusable="false"><use href="#nb-icon-warning"/></svg>
      Over the 4 MB limit. New messages may not be saved — delete a chat to free space.
    </p>
    <button type="button" class="ai-cm-btn danger ai-cm-danger" data-test-chat-delete-all
            aria-label="Delete all 3 chats for this note" title="Delete all 3 chats for this note">
      <svg class="icon" aria-hidden="true" focusable="false"><use href="#nb-icon-trash"/></svg>Delete all chats
    </button>
    <p class="sr-only ai-cm-status" role="status" aria-live="polite"></p>
  </div>
</div>
```

`nb-icon-trash` is a new sprite symbol (16 grid, 1.5 stroke, `currentColor`,
`foundations.md` §9.1); every other symbol already exists in
`templates/index.html:51-264`. The over-budget warning and the Delete all chats button are the
only footer elements that may be absent.

### 3.3 Header and search

| Part | Value |
|---|---|
| Header box | `min-height: calc(34px * var(--font-scale))`, `padding: 0 var(--space-2) 0 var(--space-3)`, bottom 1 px `--border` |
| Title | `.ai-cm-title`, `--text-ui`, `--fw-semibold`, `--text-primary`, one line; `tabindex="-1"` so opening the manager can focus it |
| Close | `.ai-chat-btn`, 24 px, `nb-icon-close`, `aria-label="Close chat manager"` |
| Search row | `padding: var(--space-2) var(--space-3)` |
| Search field | 36 (`--control-h-lg`), `--surface-well`, 1 px `--border-strong`, `--radius-sm`, `--text-ui`, placeholder `--text-muted`, `padding-inline-end: var(--control-h-body)` |
| Search clear | 24 px icon button, `right: var(--space-1)`, vertically centred, shown only when the field is non-empty (`controls.md` §2.4) |
| Native cancel button | Suppressed (`::-webkit-search-cancel-button`), one clear control only |

The search is a plain substring match over the chat title and its file path, case-insensitive.
It filters rows and groups; it never changes the order of what remains.

### 3.4 Groups and order

| Order | Group | Head |
|---|---|---|
| 1 | The file open in the viewer, if it has chats | path in `--accent` + the word `current` in `--accent` |
| 2 | Every other file, by its most recently updated chat, newest first | path in `--text-muted` |
| 3 | `Unfiled` — chats whose stored path is empty | the word `Unfiled` in `--text-muted` |

Rows inside a group are ordered by recency, newest first. A group that the search empties
disappears, and so does its head. Group heads are sticky at the top of the list (`z-index: 1`,
a local stack — `foundations.md` §6.1) with an opaque `--surface-panel` face so rows never
show through.

`Unfiled` is a fallback for chats whose binding was lost (an empty stored path); the new-chat
path is disabled with no file open, so it cannot be produced from the UI. The group exists so
the manager can still show, rename and delete such a chat instead of hiding it.

### 3.5 Row anatomy

| Part | Value |
|---|---|
| Row box | `padding: var(--space-1) var(--space-2)`, `--radius-xs`, transparent face, `gap: var(--space-hair)` inside |
| Row hover | `--accent-soft` face |
| Row current | `--accent-soft` face + `inset var(--stroke-2) 0 0 var(--accent)`; the meta and path take `--text-primary` |
| Title | `.ai-chat-open`, a real `<button>` at full row width, `--text-ui`, `--text-primary`, weight 400, one line, end ellipsis, `title` = the full title |
| Path | `--font-mono`, `--text-xs`, `--text-muted` (inherits the row's colour), `flex: 1 1 0`, `min-width: 0`, ellipsis |
| Time | `--text-xs`, `--text-muted`, `flex: 0 0 auto`, `title` = the full local timestamp |
| Count | `--text-xs`, `--text-muted`, `flex: 0 0 auto` |
| Separators | `·` in `<span class="ai-chat-sep" aria-hidden="true">` |
| Actions | **their own line under the meta**, right-aligned, 24 px each, `gap: var(--space-hair)` |
| Rename button | ghost, `nb-icon-pencil`, `aria-label`/`title` = `Rename “<title>”` |
| Delete button | ghost + `.danger`: glyph `--text-muted`, hover `--danger` with an inset 1 px `--danger` ring and **no** fill (`controls.md` §2.1) |

The meta line is `path · time · count` and the actions always sit on the line below it. At 140
the content box is 84 px inside the row: the time, the count and two 24 px buttons cannot share
one line there, and a layout that fits at 140 must not collapse two controls at 240. Forcing
the actions to their own line at every width is the only arrangement that needs no breakpoint,
no container query and no hidden control; it costs 16 px of row height against the compact
alternative. The title keeps the full row width at both widths, which is why it is the row's
identity.

The row cannot be one big button: it contains two more buttons, the reason `controls.md` §2.16
records for the same problem in Sessions. The title button is the row's activation target and
the only Tab stop that opens the chat.

### 3.6 Inline rename

| Step | Behaviour |
|---|---|
| Start | The Rename button, or `F2` while the title button has focus: the title button is replaced by `.ai-cm-rename`, an `<input type="text" maxlength="48" aria-label="Chat title">` seeded with the full title and fully selected |
| Look | `--surface-well`, 1 px `--accent`, `--radius-xs`, `box-shadow: 0 0 0 3px var(--accent-soft)`, `--text-ui`; the field is 24 px tall, so the row grows by ~7 px for the duration |
| Commit | `Enter`, or blur: the stored title becomes the field's trimmed value; the row and the bar update |
| Cancel | `Esc`, or a commit whose trimmed value is empty: the previous title returns |
| Focus after commit | the row's title button |
| Focus after cancel | the control that started the rename (F2 → the title button, button → the Rename button) |
| Effect on the auto title | a manual title overrides the derived one and is never re-derived |

### 3.7 Delete, two steps

| Step | Behaviour |
|---|---|
| First press | The meta line and the action line are replaced by `.ai-chat-confirm` inside the same row: the text `Delete “<title>”?` on its own line, then `Cancel` and `Delete` right-aligned. The title button stays. |
| Focus | Moves to `Cancel` — the safe choice for a destructive step |
| Confirm | `Delete`: the chat is removed, and the row goes with it |
| Cancel | `Cancel`, or `Esc`: the row returns to its meta and action lines; focus returns to the row's Delete button |
| Focus after delete | the next row's title button; else the previous row's; else the search field |
| Announcement | `.ai-cm-status` (`role="status"`, `.sr-only`) says `Deleted “<title>”.` |
| Active chat deleted | the panel falls back to the open file's most recent remaining chat, or to the no-chat empty state |
| Locked | no delete or rename while a turn is in flight — the manager is not reachable then (§2.3) |

The confirm block is a `role="group"` with `aria-label="Confirm delete"`, not a dialog: it has
no scrim, no trap and no close button, and it lives inside the row it acts on. Nothing is
removed until `Delete` is pressed, and `Cancel` is the first control in DOM order.

```html
<div class="ai-chat-confirm" role="group" aria-label="Confirm delete" data-test-chat-confirm>
  <p class="ai-chat-confirm-text">Delete “Fix the intro”?</p>
  <div class="ai-chat-confirm-actions">
    <button type="button" class="ai-cm-btn">Cancel</button>
    <button type="button" class="ai-cm-btn danger">Delete</button>
  </div>
</div>
```

### 3.8 Footer: New chat, storage, warning, Delete all chats

| Part | Value |
|---|---|
| Footer box | `padding: var(--space-2) var(--space-3) var(--space-3)`, top 1 px `--border`, `gap: var(--space-2)` |
| New chat | full width, `min-height: --control-h-md` 30, `--accent` face, `--text-on-accent`, 1 px `--accent`, `--radius-sm`, `--text-ui`, `--fw-medium`, leading `nb-icon-plus` at 16; hover = 3 px `--accent-soft` halo, pressed = `translateY(1px)` with the halo removed; disabled = `--opacity-disabled`, `cursor: not-allowed` |
| New chat disabled | when no file is open — a chat needs a file |
| Storage line | `.ai-cm-storage`, `--text-xs`, `--text-muted`, wraps |
| Warning | `.ai-cm-warn`, `--surface-raised`, 1 px `--warn`, `--radius-sm`, `padding: --space-2`, `--text-xs`, `--lh-snug`, `--text-primary`, 16 px `nb-icon-warning` in `--warn`, `role="status"` |
| Delete all chats | `.ai-cm-btn.danger.ai-cm-danger`, last item, hidden when the open note has no chats (§3.10) |

The storage line is `n chats · <size> of 4 MB`, where the size is the summed approximate byte
size of every stored chat. The budget is 4 MiB (`ai.js:168`); the copy rounds it to `4 MB`
because the number is an estimate, not a quota report. The warning appears only when the
total exceeds the budget, and the line's own numbers keep it honest.

### 3.9 Empty states

| State | Where | Title | Hint |
|---|---|---|---|
| No chats at all, a file is open | `.ai-empty` inside `.ai-cm-list` | `No chats yet.` | `A chat belongs to one note and is saved in this browser. Start one with New chat.` |
| No chats at all, no file open | same | `No chats yet.` | `Open a note to start a chat about it.` |
| No match | same, with the search icon | `No chats match “<query>”.` | `Try a different word, or clear the search.` |

The empty block reuses `.ai-empty` / `.ai-empty-title` / `.ai-empty-hint` from
`ai-panel.md` §1.5 (`margin: auto` centres it inside the flex list). The footer, its New chat
button and the storage line stay visible in every empty state; Delete all chats appears only
when the open note has chats (§3.10). The no-chats block keeps the log's `nb-icon-sparkle`; the
no-match block swaps the symbol for `nb-icon-search` at the same `--icon-lg` size.

### 3.10 Delete all chats

| Part | Value |
|---|---|
| Placement | the footer's last item, after the over-budget warning: `New chat` → storage line → warning → `Delete all chats` |
| Look | `.ai-cm-btn.danger.ai-cm-danger`: a text button in `--danger` with a leading 16 px `nb-icon-trash`, `--text-xs`, `--radius-sm`, `padding: 0 var(--space-2)`, `min-height: --control-h-sm`; `align-self: flex-start` so it hugs its text instead of filling the column |
| Name | `aria-label` and `title` = `Delete all <n> chats for this note`, where `<n>` is the open note's chat count (`Delete all 1 chat for this note` when it is one) |
| Hidden | no file open, or the open note has no chats: `hidden`, never `disabled` |
| Scope | every chat whose `file` equals the open note, read from `chatGroups()` so the manager's own grouping decides it; `Unfiled` chats are never included |
| Confirm | the button is replaced in place by `.ai-chat-confirm` (`role="group"`, `aria-label="Confirm delete all chats"`): `Delete all <n> chats for this note? This cannot be undone.` on its own line, then `Cancel` and `Delete all` (`.ai-cm-btn danger`) right-aligned |
| Search | a non-empty query never narrows the scope; the confirm appends ` This includes chats hidden by the search.` |
| Note changes | the confirm names one note and its count, so opening another note drops it |
| Focus on open | `Cancel`, the safe choice for a destructive step |
| Cancel | `Cancel`, or `Esc` handled in the block (`stopPropagation`, as the row confirm does): the button returns and takes focus |
| Confirm | one store write removes the file's chats; the active chat becomes none if it was one of them (`No chat yet` in the bar, the panel's no-chat empty state, the manager's no-chats empty state); the storage line and the warning refresh |
| Focus after confirm | `#ai-cm-search` — the button it started from is hidden again with no chats for the note |
| Announcement | `.ai-cm-status` says `Deleted all <n> chats for this note.` |
| Other confirms | only one confirm is open at a time: opening this one closes a pending row delete or rename, and a row's Delete drops this one (so `Esc` always keeps working) |
| Locked | no delete while a turn is in flight — the manager is not reachable then (§2.3) |

The control is a text button, not a filled one: it sits at the bottom of a column whose one
primary action is `New chat`, so the destructive action stays quiet until it is pressed. Like
the row confirm it is inline — no scrim, no trap, no close button — and it replaces the button
in the footer's flow, so the footer grows to fit the block's question and action row.

---

## 4. The panel's own empty states

These two live in `.ai-chat-log` and replace nothing else. They use the geometry and classes
of `.ai-empty` (`ai-panel.md` §1.5) and only change the copy and the icon.

| State | Title | Hint | Composer |
|---|---|---|---|
| A file is open, it has no chat | `No chat for this file.` | `Ask a question below to start one.` | enabled — the first send creates the chat |
| No file is open | `No file open.` | `Open a note to chat about it.` | disabled |

Sending the first prompt with no active chat creates a chat for the open file and derives its
title from that prompt (§5.4). That is why the composer stays enabled in the first state.

---

## 5. Copy

Every string this surface adds. Existing strings the bar reuses — `AI Assistant`, `Clear` —
are in `ai-panel.md` §7 and are not repeated.

### 5.1 Chat bar

| String | Where |
|---|---|
| `Active chat` | select `aria-label` |
| `New chat` | New button `aria-label` + `title` |
| `Manage chats` | Manage button `aria-label` + `title` |
| `This file` | `<optgroup>` label for the open file |
| `Unfiled` | `<optgroup>` label and manager group head |
| `<path>` | `<optgroup>` label for every other file |
| `No chat yet` | the select's single option when the file has no chat |
| `No file open` | the select's disabled option and the path line, with no file |
| `not open` | path-line flag; `title` = `This chat belongs to <path>, which is not open in the viewer.` |
| `<title> — <path>` | select `title` |
| `Clear conversation` | Clear button `aria-label` (§2.5) |
| `Clear the conversation (the assistant forgets this chat's context)` | Clear button `title` |

The panel header no longer carries a `Clear` label. `ai-panel.md` §7.1's two `Clear` rows
describe the shipped header button and are superseded by this table.

### 5.2 Manager

| String | Where |
|---|---|
| `Chats` | manager title |
| `Close chat manager` | close button `aria-label` + `title` |
| `Search chats` | search `aria-label` and placeholder |
| `Clear search` | search clear `aria-label` + `title` |
| `current` | group head flag on the open file's group |
| `now` / `5m` / `3h` / `yesterday` / `4d` / `12 Mar` / `12 Mar 2025` | relative time; under 1 min, under 60 min, under 24 h, under 48 h, under 7 d, else `d MMM` (+ year when not this year) |
| `1 msg` / `6 msgs` | message count |
| `Rename “<title>”` | Rename `aria-label` + `title` |
| `Delete “<title>”` | Delete `aria-label` + `title` |
| `Delete “<title>”?` | confirm text |
| `Cancel` / `Delete` | confirm buttons |
| `Chat title` | rename field `aria-label` |
| `New chat` | footer button (the same words as the bar button) |
| `1 chat · 6 KB of 4 MB` / `3 chats · 18 KB of 4 MB` | storage line |
| `Over the 4 MB limit. New messages may not be saved — delete a chat to free space.` | warning |
| `Deleted “<title>”.` | live region after a delete |
| `Renamed to “<title>”.` | live region after a rename |
| `Confirm delete` | confirm group `aria-label` |
| `Delete all chats` | footer danger button |
| `Delete all <n> chats for this note` | its `aria-label` + `title` (`1 chat` when one) |
| `Delete all <n> chats for this note? This cannot be undone.` | delete-all confirm text |
| ` This includes chats hidden by the search.` | appended to that text while the search is non-empty |
| `Delete all` | delete-all confirm action |
| `Confirm delete all chats` | delete-all confirm group `aria-label` |
| `Deleted all <n> chats for this note.` | live region after a delete-all |

Storage sizes: `n < 1024` → `n B`; `< 1024 × 1024` → `n KB`; else `n.n MB`, one decimal, rounded
down. Counts use `1 chat` / `n chats`, `1 msg` / `n msgs`.

### 5.3 Panel empties

| String | Where |
|---|---|
| `No chat for this file.` | log empty title |
| `Ask a question below to start one.` | log empty hint |
| `No file open.` | log empty title, no file |
| `Open a note to chat about it.` | log empty hint, no file |
| `No chats yet.` | manager empty title |
| `A chat belongs to one note and is saved in this browser. Start one with New chat.` | manager empty hint, file open |
| `Open a note to start a chat about it.` | manager empty hint, no file |
| `No chats match “<query>”.` | no-match title |
| `Try a different word, or clear the search.` | no-match hint |

### 5.4 Titles

| Rule | Value |
|---|---|
| Default title, before the first prompt | `New chat` |
| Derived title | the first prompt's first line, trimmed, at most 48 characters, `…` appended when longer |
| Manual title | replaces the derived one; never re-derived; at most 48 characters |
| Ellipsis in the bar and the row | the CSS ellipsis; the full string stays in `title` |

---

## 6. Keyboard, focus and touch

### 6.1 Order

| # | Stop |
|---|---|
| 1 | Collapse / close (panel header) |
| 2 | Chat select |
| 3 | New chat |
| 4 | Manage chats |
| 5 | Clear conversation |
| 6 | Provider select |
| 7 | Log contents (`ai-panel.md` §8.2) |

While the manager is open, 2–7 are `hidden` and the order continues:

| # | Stop |
|---|---|
| 3 | Close chat manager |
| 4 | Search field |
| 5 | Search clear, only when the field is non-empty |
| 6 | Per group: the first row's title, Rename, Delete; then the next row; then the next group |
| 7 | New chat (footer) |

### 6.2 Keys

| Key | Where | Effect |
|---|---|---|
| `Tab` / `Shift+Tab` | everywhere | DOM order; no positive `tabindex` |
| `Enter`, `Space` | any button | native activation |
| `Arrow` keys | chat select | native; moves between options and across `<optgroup>`s |
| `F2` | a row's title button | start the rename |
| `Enter` | rename field | commit; focus to the title button |
| `Esc` | rename field | cancel; focus to the control that started it |
| `Enter` | confirm's `Delete` | delete; focus to the next row's title |
| `Esc` | confirm | cancel; focus to the row's Delete button |
| `Esc` | non-empty search field | clear the query; stay in the manager |
| `Esc` | manager, empty search field | close; focus to Manage chats |
| `Esc` | a locked bar | nothing — Clear is the abort |
| `Home` / `End` / `PageUp` / `PageDown` | manager list | native scrolling |

While a turn streams, the select, New and Manage are disabled and therefore skipped by `Tab`:
Clear becomes the first stop after the panel header, which is the point of §2.5. Arrow keys are
not bound inside the list: the rows are independent buttons, not a listbox (`controls.md` §2.3,
§2.9). Roving tabindex is not used.

### 6.3 Focus moves

| From → to | When |
|---|---|
| Manage chats → `.ai-cm-title` | the manager opens |
| manager → Manage chats | close button, or `Esc` |
| row title → chat select | a chat is selected |
| title button → rename field | rename starts |
| rename field → title button | commit |
| rename field → the starting control | cancel |
| Delete button → `Cancel` | the confirm opens |
| confirm → Delete button | cancel |
| Clear → composer textarea | after a press: the chat is emptied and Clear disables itself |
| deleted row → next row's title, else previous row's, else search field | confirmed |

The focused control is never removed without a destination; the delete, rename and
manager-close paths above are the only places a control disappears.

### 6.4 Touch

On `(pointer: coarse)` the bar's select and actions, the manager's close, search, every row
action, the confirm buttons and the footer button are at least 44 × 44. The bar's meta row grows
to 44 because its two buttons live there; the row's actions already own a line, so only the
buttons grow. The manager's list loses the height. The AI view has no phone surface
(`ai-panel.md` §9.2), so this is the tablet case only.

---

## 7. CSS target

### 7.1 Rule order

| # | Change | Where |
|---|---|---|
| 1 | No tokens. Every value resolves to a foundation token. | — |
| 2 | `.ai-chat-stack` wrapper; the six chat-side children are appended to it instead of the host | `ai.js:2806-3626` |
| 3 | `.ai-chat-bar` and its parts, immediately after `#ai-view .panel-header-actions` and before `.ai-config-hint` | `style.css:5472-5570`, `:5572` |
| 4 | `.ai-chat-manager` and its parts, after `.ai-user-thumb` / `.ai-drop-active` and before the Settings → AI rows | `style.css:6175-6485`, `:6487` |
| 5 | The two new log empty states reuse `.ai-empty` / `.ai-empty-title` / `.ai-empty-hint`; no new rule | `ai-panel.md` §10.3 — the class lands with that pass |
| 6 | Coarse-pointer block after the manager rules, beside the AI rules | `style.css` |
| 7 | The chat rules' transitions join the AI reduced-motion block that `ai-panel.md` §10.2 rule 9 creates | `style.css` |
| 8 | One new sprite symbol `nb-icon-trash` | `templates/index.html:51-264` |
| 9 | Delete the shipped `.ai-clear` block; the moved button reads `.ai-chat-btn` alone | `style.css:6542-6552` |
| 10 | `.ai-chat-meta` gains `flex-wrap: wrap`; `.ai-chat-actions` gains `margin-left: auto` | `style.css:5510-5516`, `:5539-5544` |

Rules 3–4 are new declarations in one place each; rule 9 deletes one rule and rule 10 adds one
declaration to two existing rules. Nothing else is edited, reordered or moved.
`.ai-model-bar` (`style.css:5583`) and `.ai-chat-log` (`:5602`) keep their geometry.

### 7.2 CSS

```css
/* --- chat bar: between the panel header and the config hint ---------- */
.ai-chat-stack {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
}
.ai-chat-stack[hidden] { display: none; }

.ai-chat-bar {
  display: flex;
  flex-direction: column;
  gap: var(--space-hair);
  flex: 0 0 auto;
  min-width: 0;
  padding: var(--space-2) var(--space-3) var(--space-1);
  border-bottom: var(--stroke-1) solid var(--border);
  background: var(--surface-panel);
}
.ai-chat-bar[hidden] { display: none; }

.ai-chat-pick {
  width: 100%;
  min-width: 0;
  height: var(--control-h-md);
  padding: 0 var(--space-6) 0 var(--space-2);
  background: var(--surface-well);
  border: var(--stroke-1) solid var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-ui);
}
.ai-chat-pick:hover:not(:disabled) { border-color: var(--accent); }
.ai-chat-pick:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-offset); }
.ai-chat-pick:disabled { opacity: var(--opacity-disabled); cursor: not-allowed; }

.ai-chat-meta {
  display: flex;
  flex-wrap: wrap;                   /* the flag state at 140 px: §2.5 */
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  min-height: var(--control-h-sm);
}
.ai-chat-path {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: var(--lh-snug);
}
.ai-chat-flag {
  display: inline-flex;
  align-items: center;
  gap: var(--space-hair);
  flex: 0 0 auto;
  color: var(--warn);
  font-size: var(--text-xs);
  line-height: var(--lh-flat);
  white-space: nowrap;
}
.ai-chat-flag > .icon { width: var(--icon-sm); height: var(--icon-sm); }
.ai-chat-actions {
  display: flex;
  align-items: center;
  gap: var(--space-hair);
  flex: 0 0 auto;
  margin-left: auto;                 /* right-aligned on its own line when wrapped */
}

/* one 24 px ghost icon button: New, Manage, Clear, manager close, Rename, Delete */
.ai-chat-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-h-sm);
  height: var(--control-h-sm);
  padding: 0;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  cursor: pointer;
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.ai-chat-btn > .icon { width: var(--icon-md); height: var(--icon-md); }
.ai-chat-btn:hover:not(:disabled) { background: var(--accent-soft); color: var(--text-primary); }
.ai-chat-btn:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-offset); }
.ai-chat-btn:disabled { opacity: var(--opacity-disabled); cursor: not-allowed; }
.ai-chat-btn.danger:hover:not(:disabled) {
  background: transparent;
  color: var(--danger);
  box-shadow: inset 0 0 0 var(--stroke-1) var(--danger);
}

/* --- chat manager: replaces .ai-chat-stack ------------------------- */
.ai-chat-manager {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  background: var(--surface-panel);
}
.ai-chat-manager[hidden] { display: none; }

.ai-cm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  flex: 0 0 auto;
  min-height: calc(34px * var(--font-scale));
  padding: 0 var(--space-2) 0 var(--space-3);
  border-bottom: var(--stroke-1) solid var(--border);
}
.ai-cm-title {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-size: var(--text-ui);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
}
.ai-cm-title:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-offset-inset); }

.ai-cm-search {
  display: flex;
  flex: 0 0 auto;
  padding: var(--space-2) var(--space-3);
}
.ai-cm-search-wrap {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
}
.ai-cm-search-input {
  width: 100%;
  min-width: 0;
  height: var(--control-h-lg);
  padding: 0 var(--control-h-body) 0 var(--space-3);
  background: var(--surface-well);
  border: var(--stroke-1) solid var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-ui);
}
.ai-cm-search-input::placeholder { color: var(--text-muted); }
.ai-cm-search-input::-webkit-search-cancel-button,
.ai-cm-search-input::-webkit-search-decoration { -webkit-appearance: none; appearance: none; }
.ai-cm-search-input:hover { border-color: var(--accent); }
.ai-cm-search-input:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-offset); }
.ai-cm-search-clear {
  position: absolute;
  top: 50%;
  right: var(--space-1);
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-h-sm);
  height: var(--control-h-sm);
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.ai-cm-search-clear[hidden] { display: none; }
.ai-cm-search-clear:hover { background: var(--accent-soft); color: var(--text-primary); }
.ai-cm-search-clear:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-offset-inset); }

.ai-cm-list {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: 0 var(--space-2) var(--space-2);
}
.ai-cm-group { flex: 0 0 auto; min-width: 0; }
.ai-cm-group + .ai-cm-group { margin-top: var(--space-2); }
.ai-cm-group-head {
  position: sticky;
  top: 0;
  z-index: 1;                        /* local stack, foundations §6.1 */
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-height: var(--control-h-sm);
  margin: 0;
  padding: 0 var(--space-1);
  background: var(--surface-panel);
  border-bottom: var(--stroke-1) solid var(--border);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: var(--fw-regular);
  line-height: var(--lh-snug);
}
.ai-cm-group-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-cm-group-flag { flex: 0 0 auto; color: var(--accent); }
.ai-cm-group--current .ai-cm-group-path { color: var(--accent); }
.ai-cm-rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-hair);
  margin: 0;
  padding: 0;
  list-style: none;
}
.ai-cm-rows > li { min-width: 0; }

.ai-chat-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-hair);
  min-width: 0;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-xs);
  transition: background var(--dur-1) var(--ease-out);
}
.ai-chat-row:hover { background: var(--accent-soft); }
.ai-chat-row[aria-current="true"] {
  background: var(--accent-soft);
  box-shadow: inset var(--stroke-2) 0 0 var(--accent);
}
.ai-chat-open {
  display: block;
  width: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-ui);
  line-height: var(--lh-normal);
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ai-chat-open:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-offset); }
.ai-chat-row-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-hair) var(--space-1);
  min-width: 0;
  color: var(--text-muted);
  font-size: var(--text-xs);
  line-height: var(--lh-flat);
}
.ai-chat-row:hover .ai-chat-row-meta,
.ai-chat-row[aria-current="true"] .ai-chat-row-meta { color: var(--text-primary); }
.ai-chat-row-meta .ai-chat-path { color: inherit; }
.ai-chat-sep { flex: 0 0 auto; }
.ai-chat-time,
.ai-chat-count { flex: 0 0 auto; white-space: nowrap; }
.ai-chat-row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-hair);
  flex: 1 1 100%;            /* always its own line under the meta */
}

.ai-cm-rename {
  width: 100%;
  min-width: 0;
  height: var(--control-h-sm);
  padding: 0 var(--space-2);
  background: var(--surface-well);
  border: var(--stroke-1) solid var(--accent);
  border-radius: var(--radius-xs);
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-ui);
  box-shadow: 0 0 0 var(--stroke-3) var(--accent-soft);
}
.ai-cm-rename:focus { outline: none; }   /* the border and halo are the replacement */

.ai-chat-confirm {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.ai-chat-confirm-text {
  flex: 1 1 100%;
  margin: 0;
  color: var(--text-primary);
  font-size: var(--text-xs);
  line-height: var(--lh-snug);
}
.ai-chat-confirm-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
}
.ai-cm-btn {
  min-height: var(--control-h-sm);
  padding: 0 var(--space-2);
  border: var(--stroke-1) solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-xs);
  font-weight: var(--fw-medium);
  cursor: pointer;
  transition: background var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out);
}
.ai-cm-btn:hover:not(:disabled) { border-color: var(--accent); background: var(--accent-soft); }
.ai-cm-btn:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-offset); }
.ai-cm-btn.danger { border-color: transparent; background: transparent; color: var(--danger); }
.ai-cm-btn.danger:hover:not(:disabled) {
  background: transparent;
  border-color: transparent;
  color: var(--danger);
  box-shadow: inset 0 0 0 var(--stroke-1) var(--danger);
}

.ai-cm-footer {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  flex: 0 0 auto;
  padding: var(--space-2) var(--space-3) var(--space-3);
  border-top: var(--stroke-1) solid var(--border);
}
.ai-cm-new {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  width: 100%;
  min-height: var(--control-h-md);
  padding: 0 var(--space-3);
  border: var(--stroke-1) solid var(--accent);
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--text-on-accent);
  font: inherit;
  font-size: var(--text-ui);
  font-weight: var(--fw-medium);
  cursor: pointer;
  transition: box-shadow var(--dur-1) var(--ease-out);
}
.ai-cm-new > .icon { width: var(--icon-md); height: var(--icon-md); }
.ai-cm-new:hover:not(:disabled) { box-shadow: 0 0 0 var(--stroke-3) var(--accent-soft); }
.ai-cm-new:active:not(:disabled) { transform: translateY(1px); box-shadow: none; }
.ai-cm-new:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-offset); }
.ai-cm-new:disabled { opacity: var(--opacity-disabled); cursor: not-allowed; }
.ai-cm-storage {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-xs);
  line-height: var(--lh-snug);
}
.ai-cm-warn {
  display: flex;
  align-items: flex-start;
  gap: var(--space-1);
  margin: 0;
  padding: var(--space-2);
  border: var(--stroke-1) solid var(--warn);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  color: var(--text-primary);
  font-size: var(--text-xs);
  line-height: var(--lh-snug);
}
.ai-cm-warn > .icon { flex: 0 0 auto; width: var(--icon-md); height: var(--icon-md); color: var(--warn); }
.ai-cm-warn[hidden] { display: none; }   /* a flex face beats the UA [hidden] rule */

/* --- coarse pointer: the tablet case ------------------------------- */
@media (pointer: coarse) {
  .ai-chat-pick,
  .ai-cm-search-input,
  .ai-cm-rename { height: var(--control-h-touch); }
  .ai-chat-btn,
  .ai-cm-search-clear { width: var(--control-h-touch); height: var(--control-h-touch); }
  .ai-cm-search-clear { right: 0; }
  .ai-chat-meta { min-height: var(--control-h-touch); }
  .ai-cm-btn,
  .ai-cm-new { min-height: var(--control-h-touch); }
}

/* --- reduced motion: join the AI block ----------------------------- */
@media (prefers-reduced-motion: reduce) {
  .ai-chat-btn,
  .ai-chat-row,
  .ai-cm-btn,
  .ai-cm-new { transition: none; }
}
```

`Clear` adds no rule of its own: `.ai-chat-btn` styles it, `.ai-chat-btn.ai-clear` needs
nothing, and the shipped `.ai-clear` block is deleted (§13.4). `.ai-clear` survives as a class
on the element so `#ai-view .ai-clear` keeps resolving.

### 7.3 Heights this CSS produces

| Element | 240 / 140 | Sum |
|---|---|---|
| `.ai-chat-bar` | 69 | 8 + 30 + 2 + 24 + 4 + 1 |
| `.ai-chat-bar` with the flag at 140 | 95 | 69 + 2 + 24 (the action group wrapped) |
| `.ai-cm-header` | 35 | 34 + 1 |
| `.ai-cm-search` | 52 | 8 + 36 + 8 |
| `.ai-chat-row` | 67 | 4 + 17 + 2 + 14 meta + 2 + 24 actions + 4 |
| `.ai-cm-group-head` | 25 | 24 + 1 |
| `.ai-cm-footer` | 73 | 8 + 30 + 8 + 14 + 12 + 1 |
| `.ai-cm-footer` with Delete all chats | 105 | 8 + 30 + 8 + 14 + 8 + 24 + 12 + 1 |
| `.ai-cm-footer` over budget | ≈ 140 at 240; ≈ 220 at 140 | 73 + 8 + the warning: 3 lines at 240, 9 at 140 |
| `.ai-cm-footer` over budget, with Delete all chats | ≈ 172 at 240; ≈ 252 at 140 | the row above, plus 32 (8 gap + 24 button) |

### 7.4 Test hooks

The UI carries these attributes; the data layer behind them is the engineer's. None of them
changes a class name or a style.

| Hook | Element |
|---|---|
| `data-test-chat-bar` | `.ai-chat-bar` |
| `data-test-chat-select` | the chat `<select>` |
| `data-test-chat-new` | the bar's New chat button |
| `data-test-chat-manage` | the bar's Manage chats button |
| `data-test-chat-clear` | the bar's Clear conversation button |
| `data-test-chat-manager` | `.ai-chat-manager` |
| `data-test-chat-close` | the manager's close button |
| `data-test-chat-search` | the search field |
| `data-test-chat-row` | each `.ai-chat-row` |
| `data-test-chat-open` | each row's title button |
| `data-test-chat-rename` | each row's Rename button |
| `data-test-chat-delete` | each row's Delete button |
| `data-test-chat-confirm` | the `.ai-chat-confirm` group |
| `data-test-chat-new-manager` | the footer's New chat button |
| `data-test-chat-storage` | the storage line |
| `data-test-chat-delete-all` | the footer's Delete all chats button |
| `data-test-chat-delete-all-confirm` | the footer's `.ai-chat-confirm` group |

---

## 8. Accessibility

### 8.1 Roles and names

| Element | Contract |
|---|---|
| `.ai-chat-bar` | no role; the select and the three buttons carry the names |
| Chat select | `<select aria-label="Active chat">` with real `<optgroup>` children |
| Manage chats | `<button aria-expanded="false|true" aria-controls="ai-chat-manager">` |
| Clear conversation | `<button class="ai-chat-btn ai-clear" aria-label="Clear conversation">`; `disabled` when there is nothing to clear |
| `.ai-chat-manager` | `<div id="ai-chat-manager" role="region" aria-labelledby="ai-cm-title">`; not a dialog, no `aria-modal` |
| Manager title | `<h3 id="ai-cm-title" tabindex="-1">Chats</h3>` |
| Search | `<input type="search" aria-label="Search chats">` — the placeholder is not the name |
| Groups | `<section aria-labelledby>` + `<h4 class="ai-cm-group-head">` + `<ul>` / `<li>` |
| Row | `.ai-chat-row[aria-current="true"]` on the active chat only; the title is a real `<button>` |
| Row actions | `aria-label` naming the chat, so two rows never share a name |
| Confirm | `role="group" aria-label="Confirm delete"`, text then actions in DOM order |
| Delete all chats | `<button class="ai-cm-btn danger ai-cm-danger" aria-label="Delete all <n> chats for this note">`; the confirm group is `aria-label="Confirm delete all chats"` |
| Warning | `role="status"` |
| Live region | `.ai-cm-status.sr-only`, `role="status" aria-live="polite"`; announces the delete and the rename, never the filtering |

`aria-current` sits on the row `div`, not on the title button: the row is what is current, and
the button stays a plain activation control. `aria-expanded` and `aria-controls` on Manage track
the swap between the chat group and the manager; no dialog role and no `aria-haspopup` are
added, because nothing pops up.

### 8.2 Contrast

Measured with the palette in `foundations.md` §3, alpha composited over the surface each
element actually sits on. Text needs 4.5:1, boundaries and icons 3:1.

| Pair | Dark | Light | Verdict |
|---|---|---|---|
| `--text-primary` on `--surface-panel` (titles) | 12.57 | 14.61 | pass |
| `--text-muted` on `--surface-panel` (paths, meta, storage) | 5.52 | 5.56 | pass |
| `--text-muted` on `--accent-soft` over panel (row meta if it stayed muted) | **4.04** | 4.71 | **fails dark** — the meta takes `--text-primary` on the current and hovered row |
| `--text-primary` on `--accent-soft` over panel (row meta, current row) | 9.20 | 12.37 | pass |
| `--warn` on `--surface-panel` (the `not open` flag) | 8.55 | 5.52 | pass |
| `--accent` on `--surface-panel` (current group path and flag) | 6.00 | 5.34 | pass |
| `--danger` on `--surface-panel` (delete glyph hover) | 5.64 | 5.07 | pass |
| `--text-primary` on `--surface-raised` (warning text) | 11.30 | 13.48 | pass |
| `--warn` on `--surface-raised` (warning icon) | 7.68 | 5.10 | pass |
| `--text-on-accent` on `--accent` (New chat) | 6.99 | 5.72 | pass |
| `--text-muted` on `--surface-well` (search placeholder) | 6.43 | 5.32 | pass |
| `--border-strong` on `--surface-well` (select and search boundary) | 4.70 | 3.48 | pass (≥3) |

The failing row is the reason for one rule in §7.2: `.ai-chat-row-meta` takes
`--text-primary` on the hovered and current row. This is the same trap the Sessions count
badge fixes (`controls.md` §2.6). Colour is never the only signal: the flag has a glyph and a
word, the warning has a glyph and a sentence, the current row has a wash **and** an inset bar.

### 8.3 Reduced motion

| Element | Normal | Reduced motion |
|---|---|---|
| `.ai-chat-btn` hover | 120 ms background/colour | instant |
| `.ai-chat-row` hover | 120 ms background | instant |
| `.ai-cm-btn` hover | 120 ms background/border | instant |
| `.ai-cm-new` hover | 120 ms halo | instant |
| Confirm open, rename open, manager open | no transition — state swaps in one frame | same |

Nothing moves, slides or fades in this surface, so the reduced-motion block only removes
transitions; no state is left half-applied.

---

## 9. State matrix

| State | Bar | Manager list | Footer | Log / composer |
|---|---|---|---|---|
| File open, chats exist | select enabled, path shown | current group first | New chat enabled, storage line, **Delete all chats** | transcript |
| File open, no chat | select `No chat yet` | current group absent | New chat enabled, storage line, Delete all chats hidden | `No chat for this file.` + enabled composer |
| No file open | select disabled `No file open` | no current group; Unfiled and other files only | **New chat disabled**, storage line, Delete all chats hidden | `No file open.` + disabled composer |
| Active chat's file not open | path + `not open` flag | its group is not the current one | unchanged (the control scopes to the open note) | the chat's transcript, composer enabled |
| A turn is in flight | select, New, Manage disabled; **Clear enabled** | not reachable | — | caret, Stop |
| A permission card is pending | select, New, Manage disabled | not reachable | — | the card waits for Apply/Reject; composer draftable |
| A turn in flight, then another file opens | the bar keeps the streaming chat and its path; once the open path differs, the `not open` flag appears | the file's group is not the current one | New chat disabled until the turn ends | the streaming chat's transcript, Stop |
| No chats at all | select `No chat yet` | `No chats yet.` | New chat enabled when a file is open; Delete all chats hidden | `No chat for this file.` |
| Search with no match | unchanged | `No chats match “<query>”.` | unchanged; Delete all chats keeps the note's chats and says the search hides some | — |
| Chats at 100 % of budget | unchanged | unchanged | storage line | unchanged |
| Over budget | unchanged | unchanged | warning below the storage line, Delete all chats after it | unchanged |
| 140 px | select ~14 characters; with the flag the bar grows to 95 and the path keeps 54 | rows 100 wide, paths clamp | New chat 116 wide, storage wraps, Delete all chats hugs its text | — |
| Coarse pointer | 44 px targets, bar 103 | 44 px row actions | 44 px button | — |

Clear follows §2.5 in every row: enabled when the active chat has a message or a pending chip,
disabled otherwise, and enabled during a turn.

---

## 10. Decisions and bounds

| # | Decision | Why |
|---|---|---|
| 1 | One native `<select>`, no popup | §2.1 |
| 2 | Two-line bar, the title on the full width | 140 px: a one-line bar with three 24 px buttons would leave nothing of the title; this leaves the select the full content width at both widths |
| 3 | Bar locked for the span of a turn | one rule instead of per-chat exceptions in the manager; prevents deleting or swapping the chat a stream is writing into |
| 4 | Mismatch informs, it does not lock | the transcript is the chat's own and the assistant can read any file; the flag explains a state the user created |
| 5 | `Unfiled` is a fallback, not a creation path | new chats need a file; the group keeps legacy or unbound chats visible and deletable |
| 6 | Clear is a bar action, one chat deep (§2.5) | it is the one control that must stay live while the bar is locked, and it scopes to a chat, not to the view |
| 7 | Rename commits on blur as well as `Enter` | a click elsewhere is a deliberate finish; `Esc` remains the way to abandon |
| 8 | Delete is inline, not a menu item | `NB.menu` has no confirm state; a menu would need a second interaction model for one action |
| 9 | The row is not one button | it contains two buttons (`controls.md` §2.16) |
| 10 | No confirm and no undo on Clear | it is the escape hatch and must abort in one press; the guards are the disabled face, the distinct glyph and the last position in the group |
| 11 | Clear is neutral, never `.danger` | red would argue against the one press that stops a runaway reply; Delete keeps the red and the two-step confirm |
| 12 | The panel header drops to title plus collapse | the header describes the view; Clear describes a chat |

**What not to build.** No popup chat list. No centred modal, no scrim, no focus trap. No
server call of any kind, no cross-device sync badge. No per-chat export, pin, reorder, unread
count or colour. No "open file" action inside a row — selecting a chat never changes the
viewer. No new token, no new colour, no third theme value, no container query, no new
breakpoint, and no new icon besides `nb-icon-trash` and `nb-icon-broom`: the no-match state
uses the existing `nb-icon-search`, and the log empty state keeps the `nb-icon-sparkle` symbol
`ai-panel.md` §1.5 assigns it. No change to `ai-panel.md`'s header, provider row, log, cards or composer beyond the
one cross-reference sentence in §1.1.

---

## 11. Exceptions

The bar and the manager are new, so most of this document has no delta against a shipped look.
The one shipped control this document moves is Clear (X4). X1–X3 are values that sit off a
shared ladder; all four are recorded so no later pass "corrects" them silently.

| # | Value | Ladder | Delta | Why |
|---|---|---|---|---|
| X1 | Chat select height `--control-h-md` 30 | Fields and selects are `--control-h-lg` 36 (`guidelines.md` §2) | −6 px | A secondary picker above a two-line bar; 30 keeps the bar at 69 and keeps the select from reading as a twin of the provider select below |
| X2 | Chat select padding-inline-start `--space-2` 8 | Selects use `--space-3` 12 | −4 px | At 116 px every 4 px is a character of the title |
| X3 | Manager title `--text-ui` 600, not the uppercase `.panel-title` role | Panel headers use `--text-xs` uppercase (`ai-panel.md` §2.1) | +size | It is a view title inside the view, one level below the panel header; uppercasing a second header 34 px below the first reads as one header repeated |
| X4 | Clear: a 24 px ghost icon in the chat bar | Shipped header text button: `min-height: --control-h-sm`, 1 px `--border-strong`, `--surface-raised`, `--text-ui`, `padding: 0 --space-2` (`style.css:6542-6552`) | the header loses one 30 px text control; the bar gains one 24 px icon in its existing action row | it scopes to a chat, not to the view (§2.5), and the frame header returns to title plus collapse |

No proposals. Nothing in this document is "for later".

---

## 12. Acceptance criteria

| # | Criterion | Observable |
|---|---|---|
| AC1 | The bar sits between the panel header and the config hint, inside `.ai-chat-stack` | `#ai-view` children in order: `.panel-header`, `.ai-chat-stack`, `.ai-chat-manager`; inside the stack: `.ai-chat-bar`, `.ai-config-hint`, `.ai-model-bar`, `.ai-chat-log`, `.ai-attach-bar`, `.ai-input-row` |
| AC2 | The bar survives 140 px | At 140: the select is 116 wide, all three action buttons measure 24 × 24, the path line ellipsizes and the full path is in `title`; nothing is hidden; with the flag showing, the action group wraps to its own line and the bar measures 95 |
| AC3 | The select lists every chat, grouped | `This file` first, then each other file by recency, then `Unfiled`; every option text is a chat title; `aria-label="Active chat"` |
| AC4 | A mismatch is visible | With the active chat bound to a file other than `NB.viewer.getPath()`, the path line shows the flag with the word `not open` and the 14 px warning glyph in `--warn`, in both themes, at 240 and 140 |
| AC5 | No file open disables creation | Select shows `No file open` and is disabled; New chat is disabled; Manage chats stays enabled |
| AC6 | No chat for the file shows the empty state | Select stays enabled with the single option `No chat yet`; the log shows `No chat for this file.` and the composer is enabled |
| AC7 | A turn locks the chat controls | While a turn streams: select, New chat and Manage chats are disabled; Clear is enabled; the composer shows Stop |
| AC8 | The manager replaces the chat group | Opening it sets `.ai-chat-stack[hidden]` and clears `.ai-chat-manager[hidden]`; the panel has exactly one scroller, `.ai-cm-list` |
| AC9 | Groups and order | Current file first with the `current` flag, other files by their newest chat, `Unfiled` last; heads are sticky with an opaque face; a group with no surviving row disappears |
| AC10 | Row anatomy | Each row has a title button, a meta line of path · time · count (the time carries a full-timestamp `title`), and Rename then Delete at 24 × 24 on their own line under it; the active row carries `aria-current="true"` and the inset 2 px accent bar |
| AC11 | Rename | `F2` on the title button and the Rename button both open `.ai-cm-rename` seeded with the full title and selected; `Enter` commits and focuses the title button; `Esc` restores the old title and returns focus to the starting control; an empty value cancels |
| AC12 | Delete is two steps | The first press shows `Delete “<title>”?` with `Cancel` focused; `Esc` or `Cancel` restores the row and focuses Delete; `Delete` removes the chat, announces `Deleted “<title>”.`, and focuses the next row's title (else the previous, else the search field) |
| AC13 | Storage is reported | The footer shows `n chats · <size> of 4 MB`; over the budget it adds the `role="status"` warning with the exact sentence in §5.2 |
| AC14 | Search filters and clears | Typing filters rows by title and path; a non-empty field shows the clear button; `Esc` clears a non-empty query and closes the manager on a second press; no match shows `No chats match “<query>”.` |
| AC15 | Focus enters and leaves correctly | Opening the manager focuses `.ai-cm-title`; closing it, including by `Esc`, returns focus to Manage chats; selecting a chat returns focus to the chat select |
| AC16 | Contrast | Every pair in §8.2 measures as listed; in particular the row meta on a hovered or current row is `--text-primary`, never `--text-muted` |
| AC17 | Coarse targets | With a coarse pointer, every control in §6.4 measures at least 44 × 44 and no control is clipped |
| AC18 | Reduced motion | With `prefers-reduced-motion: reduce`, no property in this surface transitions; states still change completely |
| AC19 | No new tokens or layout systems | The diff adds no hex, no new custom property, no container query, no media query besides `(pointer: coarse)` and the reduced-motion block; the only `z-index` is the group head's local `1` |
| AC20 | The mockup is self-contained | `docs/ui/ai-chat-manager-mockup.html` opens offline with no network request and shows every board in §12.1 in both themes |
| AC21 | Clear lives in the bar and the header is clean | `.ai-chat-actions` holds three buttons, Clear last; `#ai-view .panel-header` contains the title and the collapse button only; no `.ai-clear` in the header |
| AC22 | Clear's enabled rule | Enabled with an active chat holding at least one entry or one attachment chip; disabled with no chat, no file, an empty chat, or a viewer session; `disabled` is the real attribute |
| AC23 | Clear works while locked | With a turn streaming, the select, New and Manage are disabled and Clear is enabled; pressing it aborts the turn and empties the transcript |
| AC24 | Clear keeps the chat | After a press: same id, title, file and group position; the row's count reads `0 msgs`; the log shows `No chat for this file.`; the storage line drops by the freed bytes |
| AC25 | Focus after Clear | Focus lands on the composer textarea, not `<body>`, and Clear is disabled in the same frame |
| AC26 | The test seam survives | `#ai-view .ai-clear` still resolves inside the bar, `.ai-clear` carries no style block of its own, and the twelve existing test references keep passing |

### 12.1 Mockup boards

Chat bar at 240 and 140 (dark, light) with its three actions; the bar's not-open, no-chat,
no-file and locked states; the bar's Clear disabled, live while locked, and the wrapped flag
state at 140; the panel header before and after Clear moved at 240, and after at 140; the
manager with chats at 240 and 140 (dark, light); the manager empty; inline rename; the delete
confirm; the storage warning — each at 240 and 140, dark and light.

---

## 13. Implementation handoff — moving Clear

One node moves and one sprite symbol is added. No behaviour changes. Files: `static/js/ai.js`,
`static/css/style.css`, `templates/index.html`. Line numbers are the shipped code at the time of
this pass; the block names are the stable reference.

### 13.1 DOM

| Step | Change |
|---|---|
| 1 | **Remove** the Clear button from the header block in `mount()`: `ai.js:2817-2848` — the `const clearBtn = document.createElement("button")` line through the closing `});` of its click listener, plus `actions.appendChild(clearBtn)` at `:2848`. Leave the `NB.activity.makeCollapseBtn()` append (`:2849-2851`) in place so `.panel-header-actions` keeps exactly one child. |
| 2 | **Create** it in the bar block, after `manageBtn` (`ai.js:2895-2903`) and before `chatActions.append(...)` (`:2905`). |
| 3 | Change that append to `chatActions.append(newBtn, manageBtn, clearBtn)` — Clear last, so the order is New · Manage · Clear and Clear is not adjacent to New. |

```js
const clearBtn = document.createElement("button");
clearBtn.type = "button";
clearBtn.className = "ai-chat-btn ai-clear";     // .ai-clear is the test seam
clearBtn.dataset.testChatClear = "1";
clearBtn.setAttribute("aria-label", "Clear conversation");
clearBtn.title = "Clear the conversation (the assistant forgets this chat's context)";
clearBtn.innerHTML = chatIcon("nb-icon-broom");
clearBtn.addEventListener("click", onClearChat);
```

The listener body moves verbatim from the current header handler: `ctl.abort()`,
`conversation = []`, the active chat's `conversation` / `toolFlags` / `lastPrompt` rewrite,
`systemCache = null`, `regenerating = false`, `resetLog()`, the enrich-timer reset, the
`clearAttachments()` / `removeTurnControls(log)` / `lastSent*` resets, `persistHistory()`,
`syncLogEmpty()`, `syncSend()`. Add **one** line at the end: `ta.focus();` (§2.5, "After a
press").

`onClearChat` is a new function declaration beside `newChatFromBar` (`ai.js:3139`). Function
declarations hoist inside `mount()`, as `resetLog` (`:3023`) and `clearAttachments` (`:3815`)
already rely on, so the listener can name it before its definition.

### 13.2 State

| Item | Change |
|---|---|
| `const clearBtn` | stays in `mount()`'s scope; `syncSend()` (`ai.js:3662-3665`) already writes `clearBtn.disabled` and needs no edit |
| `syncChatControls()` (`ai.js:3120-3127`) | unchanged — Clear is deliberately not gated by `chatLocked()` |
| `syncSend()` | unchanged; its existing expression is exactly the §2.5 enabled rule |

Do not add `clearBtn.disabled` to `syncChatControls()`: that function returns early while the
bar is hidden, and Clear's rule is already correct where it lives. Keep the `const clearBtn`
declaration inside the bar block, before the first `refreshChats()` / `restoreHistory()` call at
the end of `mount()` (`ai.js:4010-4016`) — a `const` read before its declaration would throw.

### 13.3 Sprite

Add one symbol in `templates/index.html`, beside `nb-icon-trash` (`:230`):

```html
<symbol id="nb-icon-broom" viewBox="0 0 16 16">
  <path d="M12.2 2.6 7.6 7.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M8.6 5.8 6.2 8.2a3.2 3.2 0 0 0-.8 1.6l-.5 2.2 2.2-.5a3.2 3.2 0 0 0 1.6-.8l2.4-2.4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M4.9 11.4 3.6 14M7.2 12.3 6.4 14.3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</symbol>
```

Reference shape, not a byte contract: 16 grid, 1.5 stroke, round caps, `currentColor`,
`fill="none"`, drawn to `foundations.md` §9.1.

### 13.4 CSS

| Change | Selector | Where |
|---|---|---|
| Delete the rule and its `:hover` | `.ai-clear` | `style.css:6542-6552` |
| Add `flex-wrap: wrap` | `.ai-chat-meta` | `style.css:5510-5516` |
| Add `margin-left: auto` | `.ai-chat-actions` | `style.css:5539-5544` |

Nothing else. The button is styled by `.ai-chat-btn` (`style.css:5547-5571`) and needs no rule
of its own. `.ai-clear` stays in the element's class list as a seam with **no** declarations;
do not re-style it, because a `.ai-clear` rule would now compete with `.ai-chat-btn`.

### 13.5 Tests and selectors

| Item | Action |
|---|---|
| `#ai-view .ai-clear` | still resolves — the bar is inside `#ai-view` — so all twelve references in `tests/dom/test_dom.js` (`:33168`, `:33435`, `:33784`, `:34426`, `:34818`, `:35709`, `:35914`, `:36053`, `:36314`, `:36615`, `:36776`, `:36882`) keep working unchanged |
| `:36776` (`Clear.disabled === false` during a turn) | keep it: it now guards the §2.5 rule, not a header quirk |
| Reset helpers that click `.ai-clear` | they use `dispatchEvent`, which still fires a listener on a disabled button; if any is ever changed to `.click()`, a disabled button would no-op — use `dispatchEvent` |
| New tests | prefer `[data-test-chat-clear]`; keep `.ai-clear` for the existing ones |
| Nothing asserts the header's child count, the Clear label text or the button height | no other test needs a change |

### 13.6 Order of work

1. Sprite symbol. 2. Node move + `ta.focus()`. 3. CSS deletion and the two declarations.
4. `node tests/dom/test_dom.js`. 5. Visual check at 140 with a `not open` chat: the bar wraps to
95 and the action group is right-aligned on its own line.
