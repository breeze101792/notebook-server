# AI panel — design handoff

Status: current spec — pre-implementation (target). It supersedes the **visual** values
of the two shipped AI design records — `docs/archive/design/ai-composer-redesign.md` and
`docs/archive/design/ai-chat-message-area.md` — and the AI view's phone rule in
`docs/ui/shell-frame.md` §6.1. Their behaviour stays as built; every superseded value has
a recorded reason in §12.

Reference mockup: [`ai-panel-mockup.html`](ai-panel-mockup.html) — dark and light pairs for
six boards: no provider, a full conversation (user turn, prose, trace, edit card with
diff, composer with two attachments), streaming with Stop, error with Retry, an ACP turn,
and the 140 px panel. The phone drawer is not part of this design (§9.2).

**Normative source.** This document owns the AI view's anatomy, states, copy and CSS
target. It reads [`foundations.md`](foundations.md) for every token,
[`controls.md`](controls.md) for control anatomy and ARIA, and
[`shell-frame.md`](shell-frame.md) for the panel frame. It does not
redesign the shell, the AI view's host registration, the ACP protocol, the proxy contract
or Settings → AI. Where this document and `static/css/style.css` differ today, this
document is the target and §10 gives the landing order.

Every claim about current code cites `file:line`.

---

## 1. Anatomy

### 1.1 The view at 240 px

`#ai-view` is a `side-panel-view` host (`templates/index.html:272`) filled by
`NB.ai.mount()` (`static/js/ai.js:2248-2731`). The frame makes it a flex column that
never scrolls (`style.css:296-300`); the view's own log is the scroller.

```
#ai-view  flex column, --surface-panel, overflow hidden
├─ .panel-header          34   "AI Assistant" · Clear · collapse
├─ .ai-model-bar          48   provider <select>  (+ .ai-acp-note 24 when ACP)
├─ .ai-config-hint        —    only a config failure or the viewer gate
├─ .ai-chat-log           flex  THE ZONE THAT SCROLLS
│   ├─ .ai-empty                centred, only when the log has no turns
│   ├─ .ai-msg-user            bubble, right-aligned; sent files below
│   ├─ .ai-tool-trace          one-line activity row; output is a disclosure
│   ├─ .ai-msg-assistant       prose; status; turn controls
│   ├─ .ai-error               inside the assistant bubble
│   ├─ .ai-edit-card           head · description · diff · actions · status
│   └─ .ai-jump                sticky "Jump to latest", only while scrolled up
├─ .ai-attach-bar         0/24+ chips; hidden when empty
└─ .ai-input-row          113  composer card
```

| Zone | At 240 | Rule |
|---|---|---|
| Panel width | 240 default, 140 floor, 480 cap | `--side-panel-width`, `--shell-pane-min`, `--side-panel-max` (`foundations.md:504`, `:979-981`) |
| Content box | 216 | panel width − `2 × --space-3` |
| Header | 34 | frame pattern, `docs/ui/shell-frame.md:418-427` |
| Provider row | 48 | 8 + 36 select + 4 |
| ACP note | 24 | only when the selected provider is ACP |
| Attach bar | 0 when empty; 26 per image row, 24 per text row, `--space-1` gap | Hidden when empty (`ai.js:2316-2319`); two chips wrap at 240 |
| Composer card | ≈118 idle (a 3-row field), ≈208 at the growth cap | 70 or 160 textarea + `--space-1` gap + 32 action row + 12 padding; measured at 1.0 |
| Log height at 560 | ≈ 343 with no chips; ≈ 287 with two chip rows | everything else is fixed |

The panel never scrolls as a whole; the header, the provider row, the attach bar and the
composer are fixed siblings, and the log is the one zone that scrolls. Blocks inside the log
own their own scrollers: the diff, the trace body and a wide table (`style.css:5058-5066`).

### 1.2 The view at 140 px

At the floor (`--shell-pane-min` 140) the content box is 116 px.

| Part | Behaviour | Why |
|---|---|---|
| Header | Title ellipsizes to "AI Assi…"; Clear and the collapse button both stay | 24 padding + 43 + 2 + 24 = 93, leaving 47 for the title; it is the only flexible item |
| Provider select | 116 wide; the native arrow reserves 24, so the value shows ~4 characters and clips | Full value in `title`; `controls.md` §2.5 keeps the native popup |
| User bubble | 95 % of 116 ≈ 110 | `max-width: 95%` |
| Assistant prose | 116 px ≈ 17 characters per line at `--text-ui-lg` | No second layout; the log wraps |
| Edit card | Op and stats on the first row; the path on its own line; at 140 the stats wrap and the actions stack | §4.2 |
| Diff | Horizontal scroll; the hunk header is sticky | The card is a preview; the server is the authority (`ai-assistant.md:334-339`) |
| Attach chip | The size clips first; the name then ellipsizes; the `×` stays | §5.4 |
| Composer | Textarea full width; attach (30) + gap (4) + send (32) = 66 inside 100 | The two-row grid needs no breakpoint (`ai-composer-redesign.md` §2) |

Nothing is hidden at 140. No container query is introduced: the shell is viewport-driven
and `foundations.md:531-534` closes that set.

### 1.3 Composer focused

| Part | Change | Token |
|---|---|---|
| Card | Border becomes `--accent`; a 3 px `--accent-soft` halo outside it | `style.css:5455-5458` is the precedent |
| Textarea | No outline of its own; the card is the visible replacement | Allowed by `foundations.md:650-652` |
| Log | Shrinks by the textarea's growth (70 → 160 at 3 rows and the cap) | It stays the scroller |
| Scroll | If the log was following the bottom, it stays at the bottom | §3.9 |
| Actions | Attach, send/stop keep 2 px rings on `:focus-visible` | §8 |

The card's bottom edge and margins (`--space-2 --space-3 --space-3`) never move; growth
extends upward into the log, and focus itself changes only the border and the halo.

### 1.4 What stays pinned

| Zone | Scrolls? | Why |
|---|---|---|
| Header | no | Collapse and Clear must never leave the view |
| Provider row | no | The active provider is context for every turn |
| Config / viewer banner | no | It explains why the composer is inert |
| Chat log | **yes** | The one zone that scrolls; `scrollbar-gutter: stable` keeps the measure from jumping |
| Attach bar | no | Chips are about to be sent; they sit beside the composer |
| Composer | no | The primary action stays reachable |
| Jump to latest | no (sticky inside the log) | A pointer path back to the newest turn |

### 1.5 Empty state

The log renders `.ai-empty` only when it has no turn, no card, no trace and no error.
It is centred in the log, maximum measure `calc(60 * var(--space-2))` (480), padding
`--space-6 --space-2`.

| Part | Value |
|---|---|
| Icon | `nb-icon-sparkle` (new sprite symbol), `--icon-lg` 17, `--text-muted`, `aria-hidden` |
| Title | `--text-ui`, `--fw-semibold`, `--text-primary` |
| Hint | `--text-sm`, `--text-muted`, `--lh-snug` |
| Action | none — the composer *is* the action |

Copy: "No messages yet." / "Ask about a note, or describe an edit. Nothing changes until
you apply it." (§7). The no-provider state reuses this geometry with its own title; a config
failure uses the banner instead and shows no empty state.

---

## 2. Header and provider control

### 2.1 Header

One pattern, the frame's (`shell-frame.md:418-427`). Today `ai.js` builds a `span` title
and its own actions (`ai.js:2251-2287`).

| Part | Value | Change from today |
|---|---|---|
| Box | 36 high, padding `0 var(--space-3)`, bottom 1 px `--border`, `--surface-panel` | `.panel-header` (`style.css:329-343`) is 8/12 padding; the frame target wins |
| Title | `<h2 class="panel-title">AI Assistant</h2>`, `--text-xs`, `--tracking-label`, `--text-muted`, ellipsis | A `span` today (`ai.js:2253-2255`); the heading gives the view a landmark |
| Actions | Clear, then the frame's collapse button, gap `--space-hair` | Same order; group already exists (`ai.js:2257-2286`) |
| Clear | Ghost button, `min-height: --control-h-sm`, padding `0 --space-2`, `--text-xs`, `--text-muted`; hover `--accent-soft` + `--text-primary`; disabled `--opacity-disabled` | Today ≈20 px tall with its own border (`style.css:5684-5693`) |
| Clear disabled | When the conversation is empty **and** no attachment chip is pending | Today always enabled (`ai.js:2259-2281`) |
| Clear action | Immediate: abort, clear conversation, system cache, log, controls, attachments, stored history | Unchanged (`ai.js:2264-2281`); no confirm — §12 C10 |
| Collapse / close | The frame's `makeCollapseBtn()`; `‹` desktop, `×` phone | `activity.js:278-288` |

Clear keeps its word. A trash glyph in a 24 px header target is ambiguous with a delete
action elsewhere, and this is the only destructive control in the view; the word is the
accessible name and needs no tooltip. Its `title` carries the same message with the
assistant named instead of "the model" (§7).

### 2.2 Provider control

One native `<select>`, full width. Today it is a `<select>` with no accessible name, 29 px
tall, a 1 px `--border` boundary and no focus rule (`ai.js:2296-2309`,
`style.css:5044-5056`; `controls.md:38` D3).

| Part | Value | Why |
|---|---|---|
| Row | `padding: var(--space-2) var(--space-3) var(--space-1)` | Shipped 4/12/8; the rung is 8 |
| Select | `width: 100%`, `height: --control-h-lg` 36, `padding: 0 --space-6 0 --space-3` | `controls.md` §2.5 |
| Face | `--surface-well` | A field is a well, not a raised card (`controls.md` §2.4) |
| Border | 1 px `--border-strong` | 1.39:1 → 4.03/3.64 dark, 3.64/3.36 light |
| Radius | `--radius-sm` | `controls.md` §2.5 |
| Type | `--text-ui`, `--text-primary` | — |
| Label | `aria-label="Model and provider"` | The option text is self-describing; no visible label at 140 |
| Option text | `<name> · <model>`; ACP: `<name> · <model>` with `model` defaulting to `"ACP"` | `ai.js:2791`, `:2752` |
| `title` | The selected option's full text | The 140 px select clips |
| Hover | Border `--accent` | `controls.md` §2.5 |
| Focus | 2 px `--focus-ring` at `--focus-offset` | New; D3 |
| Disabled | `--opacity-disabled`, `cursor: not-allowed`; no hover | New: while a turn is in flight (§12 C7) |
| No providers | A disabled select showing `No provider configured` | The log explains the next action |

The select is disabled for the whole span of a turn. The architecture states the picker is
disabled while the turn is in flight (`acp-provider.md:287-288`); the shipped code disables
only the attach and send controls (`ai.js:2409-2412`). Leaving it live can change
`currentServer` between tool rounds of one turn (`ai.js:1714-1717`).

### 2.3 ACP active

The picker appends every ACP profile after the OpenAI profiles (`ai.js:2745-2755`), and the
selected provider can be ACP. The panel shows two things the OpenAI state does not.

| Part | Value |
|---|---|
| Badge | `ACP`, outline pill, `--text-xs` 600, `--accent` text and border, padding `1px --space-2` |
| Note | One or two lines, `--text-xs`, `--text-muted`, `--lh-snug`, padding `0 --space-3 var(--space-1)` |
| Copy | "Runs its own tools. Changes are applied outside this panel's review." |
| Attach | `accept="text/*"`; title and label `Attach text files (ACP agents do not accept images)` / `Attach text files` (`ai.js:2343-2353`) |

The note is not a "Read-only" tag. Settings → AI carries that tag for the *profile*, which
is hand-edited (`settings.js:1361-1378`); in the chat panel the word would read as "chat is
read-only", which is false. The panel states the actual consequence — the agent's edits are
not reviewed here — in visible text, per `controls.md` §2.10.

An image that still arrives through paste or drop is stripped before the request and one
notice is shown; the notice is an `.ai-error` block (`ai.js:1547-1556`, `:1674-1680`).

### 2.4 No provider, disconnected, viewer

| State | Where it shows | Composer |
|---|---|---|
| No provider configured | The log's empty state: title "No provider configured."; hint "Open Settings → AI to add one (any OpenAI-compatible endpoint works)." | Disabled; placeholder stays visible |
| Config fetch failed | `.ai-config-hint` above the log: alert icon + "Could not load AI settings." + one **Retry** (`sm`) that calls `loadAiConfig()` | Disabled until the list loads |
| Viewer while auth is on | `.ai-config-hint`: "The AI assistant is available to the admin only." | Disabled |

Today a fetch failure and an empty list are the same state: `loadAiConfig()` catches the
error, sets `servers = []`, and the hint says no provider is configured
(`ai.js:2762-2767`). The target distinguishes them with one boolean stored by the catch.
The viewer gate is a copy change only: `/api/ai/*` is admin-only while auth is on
(`ai-assistant.md:22-25`), so the panel already fails on send.

The banner is `--surface-raised`, 1 px `--warn` border, radius `--radius-sm`, padding
`--space-2 --space-3`, text `--text-primary` and a 16 px alert glyph in `--warn` (colour is
never the only signal). The fetch failure takes `role="alert"`; the viewer gate takes
`role="status"`. The Retry button is the button component, `sm`: 24 high, `--text-xs`,
secondary face.

---

## 3. Message area

### 3.1 Turn anatomy

| Block | Class | Alignment | Surface |
|---|---|---|---|
| User turn | `.ai-msg-user` > `.ai-user-text` | end, `max-width: 95%` | `--accent-soft`, no border |
| Sent files | `.ai-user-files` | end, below the bubble | chips and thumbnails |
| Assistant prose | `.ai-msg-assistant` > `.ai-prose-span` | stretch, full measure | none — the page is the surface |
| Tool trace | `.ai-tool-trace` | stretch | none; a 2 px left rule |
| Turn status | `.ai-turn-status` | start under the assistant turn | none |
| Error | `.ai-error` | inside the assistant bubble | `--danger-soft`, 1 px `--danger` |
| Edit card | `.ai-edit-card` | stretch | `--surface-raised`, 1 px `--border` |
| Turn controls | `.ai-turn-control` | Regenerate start, Edit end | none until hover |

There is no avatar, no timestamp and no bubble around assistant prose. The two design
records settled that (`ai-chat-message-area.md:120-123`); this pass keeps it, and gives the
reason: a chat panel inside a 240 px navigation column cannot afford an avatar column, and
the speaker is already given by alignment and by the message's accessible name (§8).

### 3.2 User turn

| Property | Value | Today |
|---|---|---|
| Padding | `--space-2 --space-3` | 7/11 (`style.css:5071-5078`) |
| Radius | `--radius-lg --radius-lg --radius-xs --radius-lg` | 12/12/3/12 |
| Face | `--accent-soft` | same |
| Border | none | already flattened |
| Type | `--text-ui-lg`, `--lh-normal`, `--text-primary` | `.9rem` / 1.5 |
| Wrap | `white-space: pre-wrap`, `overflow-wrap: anywhere` | same |
| Markdown | **never** — the prompt is rendered as text | same (`ai.js:1248-1255`) |

Rendering the prompt as text is deliberate: a user who types `<b>` or a link is asking the
model about that string, not asking the panel to render it.

Sent attachments (`ai.js:2222-2242`): text files are chips, images are thumbnails.

| Part | Value |
|---|---|
| Row | `margin-top: --space-1`, `gap: --space-1`, end-aligned, `max-width: 95%` |
| Text chip | `min-height: --control-h-sm`, padding `0 --space-2`, pill, `--surface-raised`, 1 px `--border-strong`, `--text-xs`, `--text-muted` |
| Thumbnail | `max-height: calc(var(--space-8) * 2)` (96), `max-width: 100%`, `--radius-sm`, 1 px `--border` |
| Title | The text chip's `title` keeps the byte size (`ai.js:2237`) |

### 3.3 Assistant prose and Markdown

The reply uses the note pipeline: `marked` in GFM mode, highlight.js, then the shared block
renderers in untrusted mode (`ai-assistant.md:355-371`; `ai.js:1345-1374`). The panel does
not fork the renderer.

| Element | Value |
|---|---|
| Prose span | `--text-ui-lg` (13 px @1.0), `--lh-prose` 1.65, `--text-primary` |
| Span gap | `--space-1` between segments |
| Paragraph | margin `.45em 0` (prose rhythm, scales with the text) |
| H1 / H2 / H3–H6 | `--text-lg` / `--text-body` / `--text-ui-lg`; weight `--fw-heading`; line `--lh-tight` |
| List | padding-left `1.5em`; item margin `.18em` |
| Inline code | `--font-mono`, `.82em`, `--surface-well`, 1 px `--border`, `--radius-xs`, padding `0 --space-1` |
| Code block | `--surface-well`, 1 px `--border`, `--radius-sm`, padding `--space-2 --space-3`, `--text-sm`, `--lh-normal`, wraps (`overflow-wrap: anywhere`) |
| Code-block header / copy | Owned by `code-block-chip.md`; inherited unchanged |
| Table | Scrolls inside its own box; `--text-sm`; 1 px `--border`; `th` face `--surface-raised` |
| Blockquote | 3 px `--border` left, `--text-muted` |
| Link | `--accent`; underline on hover and focus |
| Image | `max-width: 100%` |
| Figure blocks | Card padding `--space-2 --space-3`; the shared sizing pass fits the figure to the log; the lightbox is the detail view (`ai-assistant.md:382-386`) |

Assistant prose has no bubble and no border. The user bubble and the composer card are the
only filled surfaces in the column.

### 3.4 Tool trace

A trace is one row per tool event. Read-only tools appear as traces; write and patch appear
as cards (§4). The row answers "what is it doing?" at a glance and keeps the output one
disclosure away.

| Part | Value |
|---|---|
| Row | `min-height: --control-h-sm` (24), padding `--space-1 0 --space-1 --space-2`, 2 px `--border` left rule, `--font-mono` |
| Chevron | 14 px, `--text-muted`, rotates 90° at `--dur-1`; absent when there is no output |
| Name | `--text-xs`, `--fw-semibold`, `--tracking-label`, `--text-muted`; no fill; `flex: 0 0 auto` |
| Path / query | `--text-sm`, `--text-primary`, one line, ellipsis, `min-width: 0`, full string in `title` |
| Summary | `--text-xs`, `--text-muted`, one line, `white-space: nowrap`, may clip at 140 |
| Output body | `<pre>`, `--text-sm`, `--text-muted`, `--lh-normal`, `max-height: calc(var(--space-8) * 2)` (96), scrolls |
| Hover | Name and summary take `--text-primary`; no fill |
| Focus | 2 px ring, offset 2; the summary is the Tab stop |
| State | `data-state="running"` replaces the chevron with an 8 px `--accent` dot that pulses; `"ok"` shows the chevron; `"err"` shows the alert glyph and a `--danger` summary, and the body is open |

A trace with output is a `<details>`; its `<summary>` carries the name, path and summary.
A trace without output — every ACP trace frame — is a plain row with the same classes and
no chevron. This keeps the test selectors `.ai-tool-trace`, `.ai-tool-name`, `.ai-tool-out`
and `data-test-tool-trace` (`ai.js:718-736`; `tests/dom/test_dom.js:30576`,
`:30640-30643`, `:33091-33097`).

The summary is one fact per tool: `n entries` (list), `n chars` (read),
`contentType · n chars` (fetch), `n results · engine` (search). Shipped output is a 9 em
scroll box always open (`style.css:5672-5681`). At 240 px a `list` trace can push a whole
answer off screen; the disclosure keeps the turn readable and keeps the output available.

The ACP trace name is the agent's own tool title, e.g. `read notes/todo.md`
(`ai-assistant.md:161-166`). It is not uppercased: the shipped rule uppercases the name cell
(`style.css:5656-5665`), which would turn a case-sensitive path into `READ NOTES/TODO.MD`.
The row keeps the string as given. An ACP row has no path and no summary, so its name takes
the free width, ellipsizes, and carries the full string in `title`.

### 3.5 Streaming, status, stop

| Signal | Value |
|---|---|
| Caret | 2 px (`--stroke-2`) × 1 em, `--accent`, `margin-left: --space-hair`, `vertical-align: text-bottom`, `animation: ai-caret 1s steps(2, start) infinite` |
| Caret under reduced motion | Static, no animation |
| Composer while streaming | Card border `--accent` (`ai-composer-redesign.md` §2); attach and provider select disabled; Send hidden; Stop shown |
| Stop | 32 px circle, 1 px `--border-strong`, `--surface-raised` face, `--text-primary` glyph; hover `--danger` text and border; `aria-label="Stop generating"` |
| Stop result | The partial prose stays; a `.ai-turn-status` row "Stopped" appears under it; Regenerate is offered |
| Live announcement | `.ai-sr-status` announces "Assistant is responding" once at `begin()`, "Reply stopped" at an abort, and "Reply complete" when the stream ends; it never announces deltas (§8) |

A completed turn carries no status line: the caret is gone, Stop has become Send, and
Regenerate is present. A status line appears only for a terminal non-success state.

Today there is no caret, no status row and no live region; `ui.begin()` only toggles the
Stop button and the card border (`ai.js:2608-2622`). A stopped turn today leaves partial
text with no marker (`ai.js:1743-1744`, `:1770`).

### 3.6 Error turn

| Part | Value |
|---|---|
| Block | `.ai-error`: margin-top `--space-1`, padding `--space-2 --space-3`, 1 px `--danger`, `--radius-md`, face `--danger-soft` |
| Text | `--text-primary`, `--text-sm`, `--lh-snug`, wraps |
| Leading | `--icon-md` alert glyph in `--danger` + `AI request failed:` in `--fw-semibold`; the message follows in normal weight |
| Role | `role="alert"` |
| Retry | The turn control under the bubble reads **Retry**, keeps `.ai-regenerate` and `data-test-regenerate="1"`, and calls the same `regenerate()`; title "Retry the last request" |
| Image hint | A second `.ai-error` below, same geometry: "This model rejected the image(s). The selected model may not support image input — switch to a vision model and retry." (`ai.js:1754-1761`) |

The text is `--text-primary`, not `--danger`. Measured: light `--danger` on `--danger-soft`
over `--surface-panel` is **4.26:1**, under the 4.5:1 text floor for 11 px text; the shipped
rule paints `--danger` on that face (`style.css:5231-5240`). The border and the icon carry
the state at 4.26:1 (over the 3:1 UI floor); the sentence stays readable.

Retry is a label change, not a second action: the function, the class hook and the disabled
rules are unchanged (`ai.js:1620-1632`, `:1608-1617`).

### 3.7 Regenerate and Edit

Only the newest turn carries controls (`ai.js:1595-1602`). The visual spec is the shipped
`.ai-turn-control` block (`style.css:5195-5229`) with four corrections:

| Property | Shipped | Target | Why |
|---|---|---|---|
| Height | ≈18 px | `min-height: --control-h-sm` 24 | The desktop target floor (`foundations.md:676-690`) |
| Padding | `2px 6px` | `0 --space-1` | Same inset box, now a 24 px line |
| Type | `.72rem` | `--text-xs` | Same size, tokenised |
| Disabled | `opacity: .4` | `--opacity-disabled` | One disabled value (D5) |
| Transition | `.12s ease` | `--dur-1 --ease-out` | Tokenised; reduced-motion twin |
| Focus | 2 px, offset 1 | 2 px, offset 2 | One ring rule |

Regenerate sits under the assistant reply (`align-self: flex-start`), Edit under the user
bubble (`flex-end`). Edit is disabled while the composer holds a draft or attachments, with
the title "Clear the draft and attachments first" (`ai.js:1608-1617`). The labels are the
accessible names; no `aria-label` is added.

### 3.8 Long messages and long conversations

- A long code block or table scrolls inside itself; the log keeps its measure.
- A long prose turn is read by scrolling; there is no collapse.
- The log holds every turn; there is no virtual list. A turn's DOM is bounded by the reply
  text and its blocks.
- The turn controls stay on the newest turn only, so the log does not accumulate buttons.
- Restored history renders user and assistant prose only. Traces and permission cards are
  not recreated because their anchors may be stale (`ai.js:1130-1146`). This design keeps
  that and adds no "not restored" notice: the prose is the transcript, and a restored card
  could apply a stale patch.
- On restore, scroll once to the bottom; on every later view switch the host is hidden, not
  unmounted, so scroll and draft survive (`shell-frame.md:435-439`).

### 3.9 Scroll anchoring

Today every append and every delta sets `scrollTop = scrollHeight` (`ai.js:1262-1264`),
which yanks a reader who has scrolled up back to the bottom on every token.

| Rule | Value |
|---|---|
| Follow threshold | `scrollHeight - scrollTop - clientHeight < 80` | The card preview already uses 80 (`ai.js:611-612`) |
| At the bottom | Append/delta scrolls to the bottom, instantly (no smooth scroll) |
| Above the bottom | Scroll position is left alone; the jump control appears |
| Jump control | `.ai-jump`, the log's last child so `position: sticky` sticks to the log's scrollport, centred at its bottom edge; `--surface-raised`, 1 px `--border`, pill, 1 px border, `--shadow-float`, `--text-xs`, padding `0 --space-2`, min-height `--control-h-sm` |
| Jump copy | "Jump to latest" |
| Jump behaviour | Activate: set follow, scroll to the bottom, and move focus to the newest turn's first control (or the textarea when there is none). The button hides when the bottom is reached, so focus is never left on a hidden control |
| Composer growth | If following, keep the bottom; otherwise keep `scrollTop` |
| Clear | Reset both the log and the follow flag |

The button is a real `<button>`; it never overlays the composer and never covers the newest
line for longer than the reader is above the bottom.

---

## 4. Edit cards

### 4.1 The six tools

The assistant has six tools (`ai-assistant.md:196-209`). Only two need a decision from the
user; the other four are activity.

| Tool | What it does | Surface |
|---|---|---|
| `list` | Tree listing | Trace row |
| `read` | One note's content | Trace row, path |
| `fetch` | URL, server-side | Trace row, URL |
| `search` | web search | Trace row, query |
| `write` | Create a new file | Card, Apply label **Create** |
| `patch` | Update an existing file | Card, Apply label **Apply** |

A `patch` card may carry several ops in one call; the card applies them atomically. The
legacy single-op `nb-edit` fence still becomes a patch card (`ai.js:1469-1479`).

### 4.2 Card anatomy

```
.ai-edit-card  (flex: 0 0 auto; never shrinks inside the log)
├─ .ai-edit-head     op pill + stats (row 1) · path (row 2)
├─ .ai-edit-desc     one sentence, optional
├─ .ai-diff          hunk header + rows; max-height --ai-diff-max-h
├─ .ai-patch-ops-note  only when the preview is unavailable
├─ .ai-edit-actions  Reject (secondary) · Apply (primary)
└─ .ai-card-status   applied / error / rejected
```

| Part | Value |
|---|---|
| Card | `--surface-raised`, 1 px `--border`, `--radius-md`, `margin: 0`, `overflow: hidden`, `flex: 0 0 auto` |
| Head | `padding: --space-2 --space-3`, face `--surface-panel`, bottom 1 px `--border`, gap `--space-2`, `flex-wrap: wrap` |
| Op pill | Outline pill, `--text-xs` 600, uppercase, `--tracking-label`, padding `1px --space-2`; patch `--warn`, write `--ok`, legacy replace/append/prepend `--text-muted` |
| Path | `--font-mono`, `--text-sm`, `--text-primary`, one line, ellipsis, `order: 2`, `flex: 1 0 100%` — its own row |
| Stats | End-aligned, gap `--space-1`, `--text-2xs` (9 px, fixed) mono; `−n` border `--danger`, `+n` border `--ok`, text `--text-primary` |
| Description | `padding: --space-1 --space-3 0`, `--text-sm`, `--text-muted` |
| Actions | `padding: --space-2 --space-3`, gap `--space-2`, end-aligned, `flex-wrap: wrap` |
| Status | `padding: --space-2 --space-3`, top 1 px `--border`, `--text-sm`; applied `--ok`, error `--danger`, rejected `--text-muted` |

The op pill and the stats are **outline**, not filled. The shipped rules paint raw
`rgba(...)` fills (`style.css:5282-5286`, `:5310-5311`) which break the token rule and make
the light `--danger`/`--ok` text sit on their own tint; as outline pills the text is
`--text-primary` and the border carries the state.

The path is the identity of the change; it is mono, it gets its own row, and it truncates only
at the floor. The op pill and the stats share the first row (stats `order: 1`); at 140 the
stats wrap to a second row and the path becomes the third. The actions are Reject then Apply
in the DOM, so the primary sits at the right edge; at 140 they stack with Reject above Apply.

### 4.3 Diff

| Part | Value |
|---|---|
| Box | `--surface-well`, `--font-mono`, `--text-sm`, `--lh-normal`, `max-height: --ai-diff-max-h` (260), `overflow: auto` |
| Grid | `1.8em 1.8em 1em 1fr` (old number · new number · sign · code) |
| Hunk header | Sticky `top: 0`, local `z-index: 1`, face `--surface-raised`, text `--text-muted`, `--text-xs`, padding `--space-1 --space-2`, bottom 1 px `--border` |
| Number | `--text-muted`, no opacity, right-aligned, `--text-xs`, `user-select: none` |
| Added row | Face `--diff-add-bg`; code `--text-primary`; sign `+` in `--ok` |
| Removed row | Face `--diff-del-bg`; code `--text-primary`; sign `−` in `--danger`; strikethrough in `--danger` |
| Context | `--text-muted` |
| More lines | `… n more lines`, `--text-muted`, italic |
| Screen-reader summary | `.sr-only` "Diff: n lines added, n removed" before the block |

Today the added code is `--ok` and the removed code is `--danger` on the tint
(`style.css:5377-5389`). Light `--danger` on the 10 % tint over `--surface-well` measures
**4.22:1**, under the text floor; light `--accent` on the hunk face measured **4.33:1**.
Code is the content of the card: it takes `--text-primary`; the sign, the row tint and the
border carry the direction.

Why the diff is the whole file preview: for a `write`, every line is an addition against an
empty base and the first 40 lines are shown with a "… n more lines" footer
(`ai.js:656-668`).

### 4.4 States

| State | Class | Card border | Actions | Status | Focus |
|---|---|---|---|---|---|
| Pending | — | `--border` | Reject (secondary), Apply (primary) | none | Reject is the next stop, then Apply |
| Applying | `.applying` | `--accent` | Both disabled; Apply reads "Applying…" / "Creating…"; `aria-busy="true"` | none | Stays on the pressed button |
| Applied | `.ok` | `--ok` | Removed | Check glyph + "Applied to path (n edits)" / "Created path" | Moves to the status row |
| Errored | `.errored` | `--danger` | Removed | Alert glyph + the server/API message | Moves to the status row |
| Rejected | `.rejected` | `--border` | Removed | Muted "Rejected — the AI will be told you declined this change" | Moves to the status row |

The action row is replaced by the status row; it gets `tabindex="-1"` and
`role="status"` so the outcome is announced and the focus is not dropped on `<body>` when
the pressed button is removed. Today resolution removes the actions (`ai.js:496-501`) and
drops focus; the card dims by opacity (`style.css:5256-5259`), which lowers the contrast of
the status the user needs to read.

Reject is disabled during an apply: the request is in flight, and a rejected card with a
landed patch would lie. Shipped leaves Reject live (`ai.js:503-526`); this is a behaviour
change recorded in §12 C9.

### 4.5 Multi-op and write notes

| Case | Copy | Source |
|---|---|---|
| Ops the client cannot simulate | "n ops · preview unavailable (applied atomically)" | `ai.js:620-623` |
| Write longer than 40 lines | "… n more lines" | `ai.js:662-667` |
| Write targeting an existing path | "File already exists — write cannot overwrite. Ask the AI to patch it instead." | `ai.js:686-688` |
| Stale patch | The server's 400 message, e.g. "no match …" | `ai.js:576-583` |

The ops note is a statement, not an error: the server applies the batch atomically and
re-verifies every anchor (`ai-assistant.md:325-339`). The card never claims the preview is
the authority.

### 4.6 Keyboard and focus

- Apply and Reject are native buttons in DOM order; `Enter`/`Space` activate.
- The diff and the card body are not focusable; the disclosure in a trace is.
- On resolution, focus moves to `.ai-card-status[tabindex="-1"]`; the next `Tab` leaves the
  card for the next message control.
- `Esc` does not cancel a pending card. The tool loop stops until the user decides, and a
  silent `Esc` would leave the model waiting with no visible reason.
- A pending card disables Regenerate and Edit until it is resolved (`ai.js:1561-1572`).

---

## 5. Composer

### 5.1 Card

| Property | Value | Today |
|---|---|---|
| Box | grid, `1fr auto`, areas `"input input" / "attach actions"` | same (`style.css:5439-5454`) |
| Margin | `--space-2 --space-3 --space-3` | 8/12/12 |
| Padding | `--space-2 --space-2 --space-1` | 8/8/6 |
| Face | `--surface-raised` | `--bg-elev` |
| Border | 1 px `--border-strong` | `--border` (1.39:1; a field boundary needs 3:1) |
| Radius | `--radius-lg` | 12 |
| Focus | Border `--accent` + 3 px `--accent-soft` halo | same (`:5455-5458`) |
| Streaming | Border `--accent` | same (`:5459`) |
| Click | Clicking the card focuses the textarea | same (`ai.js:2383-2386`) |

The card is the only bordered surface in the composer area: the textarea has no border of
its own, and the attach control is a ghost until hover.

### 5.2 Textarea and keys

| Property | Value |
|---|---|
| Min height | `--ai-composer-min-h` (40) |
| Max height | `--ai-composer-max-h` (160); JS reads the token |
| Rest height | three rows (`rows="3"`, `ai.js:2357`) ≈ 70 px at 240 |
| Padding | `--space-1 --space-1 0` |
| Type | `--text-ui-lg`, `--lh-normal`, `--text-primary` |
| Placeholder | `--text-muted`; the shipped sentence (§7) |
| Resize handle | none |
| Label | `aria-label="Message"` (new; the placeholder is not a label) |
| Disabled | `--opacity-disabled`, `cursor: not-allowed` |
| Growth | Reset to auto, then `min(scrollHeight, max)` (`ai.js:2390-2393`) |

| Key | Effect |
|---|---|
| `Enter` | Send |
| `Shift+Enter` | Newline |
| `Cmd/Ctrl+Enter` | Send (same path; so a user who is used to chat forms does not insert a newline) |
| `Enter` while composing (IME) | Ignored — no send; `e.isComposing` or `keyCode === 229` |
| `Tab` | DOM order is textarea, attach, send/stop (`ai.js:2378`); from the field Tab reaches attach, then the action |

Today `keydown` sends on bare Enter and does not check composition (`ai.js:2666-2671`),
and there is no `aria-label` on the textarea (`ai.js:2354-2358`).

The composer stays enabled while a reply streams so the user can draft the next turn; only
Send is replaced by Stop and attach/select are disabled.

### 5.3 Send and stop

| Control | Rest | Hover | Active | Focus | Disabled |
|---|---|---|---|---|---|
| Send | 32 (`--control-h-body`) circle, `--accent` face, glyph `--text-on-accent` | 3 px `--accent-soft` halo, face unchanged | `translateY(1px)`, halo removed | 2 px ring, offset 2 | Face `--surface-well`, glyph `--text-muted`, 1 px `--border-strong`, `--opacity-disabled` |
| Stop | 32 circle, `--surface-raised` face, 1 px `--border-strong`, `--text-primary` glyph | `--danger` text and border | `translateY(1px)` | 2 px ring, offset 2 | not used |

Send is disabled when the draft is empty **and** there are no attachments, when an
attachment read is in flight, and while a turn is running (it is hidden then, not merely
disabled). Today `syncSend()` disables it only for a running turn or pending reads
(`ai.js:2409-2411`), so an empty Send looks live and does nothing (`ai.js:2641`).

The send glyph is `--text-on-accent`, not `#fff`. White on the dark accent measures
2.61:1; `--text-on-accent` measures 6.99:1 (`foundations.md:209-224`). The
`.ai-btn.ai-apply` rule at `style.css:5421` is the one white-on-accent instance in this
surface; the composer circle already uses the right token (`:5485-5486`). The three composer glyphs render at `--icon-md` 16; the
inline SVGs carry `width="18"` today (`ai.js:2330`, `:2365`, `:2375`), and the component
rule overrides the attribute.

### 5.4 Attachments

The bar sits above the card, hidden when empty (`ai.js:2316-2319`). Both kinds share one
list of at most 8 chips; images are capped at 4 and are downscaled in the browser
(`ai-assistant.md:397-430`).

| Part | Value |
|---|---|
| Bar | `padding: 0 --space-3`, `gap: --space-1`, wrap |
| Chip | `min-height: --control-h-sm` (24), padding `0 --space-1 0 --space-2`, pill, `--surface-raised`, 1 px `--border-strong`, `--text-xs` |
| Thumbnail | `--control-h-sm` square, `--radius-xs`, `object-fit: cover`, 1 px `--border`; inserted when the read settles (`ai.js:2484-2485`) |
| Name | `flex: 1 1 auto`, `min-width: 0`, ellipsis; 120-character cap is in JS (`ai.js:115`) |
| Size | `flex: 0 200 auto`, `min-width: 0`, overflow hidden, `--text-muted`; "reading…" until settled (`ai.js:2459`) |
| Remove | 24 × 24 icon button inside the chip, `margin-right: calc(-1 * --space-1)`, `×`, `aria-label="Remove <name>"`; hover `--danger` |
| Reading | No opacity; the size cell already says "reading…" |
| Error chip | Full-row `.ai-attach-chip.error`: `--danger-soft` face, 1 px `--danger`, `--radius-sm`, `--text-primary`, alert glyph, dismiss `×` (`aria-label="Dismiss error"`) |
| Error role | `role="alert"` (already, `ai.js:2420`) |
| Count errors | The exact strings are in §7 |

The shipped reading chip dims the whole chip to `.55` (`style.css:5569`), which takes the
name and the remove control below the text and UI floors while the file is still readable
and actionable. The text already carries the state.

Limits, from the constants (`ai.js:100-112`): 8 chips, 4 images, 10 MiB source image, 2 MiB
encoded image, 128 KiB text file, 512 KiB text total, 12 MiB wire. The client refuses
before sending and keeps the chips (`ai.js:2650-2659`).

### 5.5 Drag, paste, focus

| Input | Behaviour |
|---|---|
| Drag over the view | `outline: var(--stroke-2) dashed var(--accent); outline-offset: calc(-1 * var(--stroke-2))` on `#ai-view`; the drag highlight is the only change |
| Drop | Same `addFiles` path (`ai.js:2693-2708`) |
| Paste | Clipboard files go through `addFiles`; plain text paste is untouched (`ai.js:2677-2683`) |
| Focus order | Header Clear → collapse → select → log controls (traces, links, copy, turn controls, card Reject/Apply) → chip removes → textarea → attach → send/stop |
| Ring | 2 px `--focus-ring`, offset 2; the card uses `:focus-within` and the inner field has none |

A disabled attach control stays visible while a turn runs; it does not disappear, so the
row does not reflow when the turn ends.

---

## 6. States

| State | Trigger | Header | Provider row | Log | Composer |
|---|---|---|---|---|---|
| No provider | fetch succeeds, no profiles | normal | disabled, "No provider configured" | empty state with the Settings sentence | disabled |
| Disconnected | config fetch throws | normal | last known value, or "No provider configured" | config banner + Retry | disabled |
| Viewer | auth on, role ≠ admin | normal | disabled | config banner "admin only" | disabled |
| Empty conversation | no turns, no chips | Clear disabled | normal | `.ai-empty` | enabled once text or a file exists |
| Idle | ≥1 turn, no request | Clear enabled | enabled | transcript, newest-turn controls | enabled |
| Streaming | request in flight | Clear enabled (aborts) | disabled | caret, trace rows, Stop in the composer | attach disabled, Send hidden, Stop shown |
| Stopped | user pressed Stop | normal | enabled | "Stopped" status + Regenerate | enabled |
| Error | SSE/HTTP failure | normal | enabled | `.ai-error` + Retry | enabled |
| Pending card | patch/write awaits a decision | normal | enabled | card with Apply/Reject; Regenerate/Edit disabled | enabled |
| Applying | Apply or Create pressed | normal | enabled | card busy, both actions disabled | enabled |
| Applied / errored / rejected | resolution | normal | enabled | status row, actions gone | enabled |
| ACP active | selected provider is ACP | normal | ACP pill + note; attach text-only | traces; prose | normal, text-only attach |
| Very long | many turns | normal | normal | scrolls; jump control while above the bottom | docked |
| 140 px | panel at the floor | title ellipsized | value clipped, `title` | wraps; diff scrolls | composer keeps one action row |
| Phone | drawer | 52, title + Clear + × | 44 high, 16 px | 16 px prose | 16 px field, 44 targets |

---

## 7. Copy

Every visible string. "Shipped" means it is in the code today and the target keeps it
verbatim; "New" or "Changed" is a decision of this pass.

### 7.1 Header, provider, composer

| String | Status | Source |
|---|---|---|
| `AI Assistant` | shipped | `ai.js:2255` |
| `Clear` | shipped | `ai.js:2262` |
| `Clear the conversation (the assistant forgets the context)` | changed from "the model forgets context" | `ai.js:2263` |
| `No provider configured` (option) | changed from `no provider configured` | `ai.js:2782` |
| `<name> · <model>` / `<name> · <baseUrl>` | shipped | `ai.js:2791` |
| `Model and provider` (aria-label) | new | §2.2 |
| `No provider configured.` (empty-state title) | new | §2.4 |
| `Open Settings → AI to add one (any OpenAI-compatible endpoint works).` (empty-state hint) | changed: the shipped sentence is split; its first clause becomes the title | `ai.js:2293` |
| `Could not load AI settings.` | new | §2.4 |
| `Retry` | new (banner) | §2.4 |
| `The AI assistant is available to the admin only.` | new | §2.4 |
| `ACP` (badge) | new | §2.3 |
| `Runs its own tools. Changes are applied outside this panel's review.` | new | §2.3 |
| `Attach files` (label + title) | shipped | `ai.js:2327-2328` |
| `Attach text files (ACP agents do not accept images)` (title) | shipped | `ai.js:2346` |
| `Attach text files` (aria-label) | shipped | `ai.js:2347` |
| `Send message` (aria-label) | shipped | `ai.js:2363` |
| `Send (Enter)` (title) | shipped | `ai.js:2362` |
| `Stop generating` (label + title) | shipped | `ai.js:2372-2373` |
| `Ask the AI to write or edit notes; it can list and read files…` | shipped | `ai.js:2358` |
| `Message` (aria-label) | new | §5.2 |
| `Message composer` (form aria-label) | new | §8.1 |
| `Remove <name>` (chip remove) | shipped | `ai.js:2464` |
| `reading…` (chip size while a read is in flight) | shipped | `ai.js:2459` |
| `Jump to latest` | new | §3.9 |
| `Dismiss error` (aria-label) | new | §5.4 |
| `No messages yet.` | new | §1.5 |
| `Ask about a note, or describe an edit. Nothing changes until you apply it.` | new | §1.5 |

### 7.2 Message area

| String | Status | Source |
|---|---|---|
| `Assistant is responding` (live, visually hidden) | new | §3.5 |
| `Reply stopped` (live, visually hidden) | new | §3.5 |
| `Reply complete` (live, visually hidden) | new | §3.5 |
| `Conversation` (log aria-label) | new | §8.1 |
| `Your message` / `Assistant reply` (turn group aria-label) | new | §8.1 |
| `Stopped` | new | §3.5 |
| `AI request failed: <message>` | shipped (label split for styling) | `ai.js:1748` |
| `Retry` (turn control, error state) | new label; same action | §3.6 |
| `Retry the last request` (title) | new | §3.6 |
| `Regenerate` | shipped | `ai.js:1626` |
| `Re-run the model on your last question` (title) | shipped | `ai.js:1627` |
| `Edit` | shipped | `ai.js:1644` |
| `Edit your last question and resend` (title) | shipped | `ai.js:72` |
| `Clear the draft and attachments first` (Edit title while blocked) | shipped | `ai.js:73` |
| `This model rejected the image(s). The selected model may not support image input — switch to a vision model and retry.` | shipped | `ai.js:1758-1760` |
| `ACP agents do not accept image attachments — the image was not sent.` / `… n images were not sent.` | shipped | `ai.js:1552-1553` |
| `Message too large to send (<size>, limit 12 MB); remove attachments or Clear the conversation.` | shipped | `ai.js:1509-1511` |

### 7.3 Tool trace and cards

| String | Status | Source |
|---|---|---|
| `list` / `read` / `fetch` / `search` | shipped | `ai.js:722-724`, `:747`, `:768`, `:780`, `:795` |
| `<n> entries` (list summary) | new; the shipped list body has no summary | §3.4 |
| `<n> chars` | shipped; required by `tests/dom/test_dom.js:30641` | `ai.js:772` |
| `<contentType> · <n> chars (truncated)` | shipped | `ai.js:784-785` |
| `<n> results · <engine>` | shipped | `ai.js:800-801` |
| `failed: <message>` | shipped | `ai.js:763`, `:775`, `:790`, `:811` |
| `patch` / `write` | shipped | `ai.js:540`, `:643` |
| `<path>` / `<path> (new file)` | shipped | `ai.js:543`, `:646` |
| `Reject` / `Apply` / `Create` | shipped labels; the DOM order is changed to Reject then Apply (C13) | `ai.js:523`, `:594`, `:708`, `:513` |
| `Applying…` / `Creating…` | shipped | `ai.js:572`, `:675` |
| `Applied to <path> (<n> edits)` / `Created <path>` | shipped text; the leading `✔` becomes a check SVG | `ai.js:588-590`, `:704` |
| `<message>` (errored card) | shipped text; the leading `✖` becomes an alert SVG | `ai.js:581`, `:697` |
| `Rejected — the AI will be told you declined this change` | shipped text; the leading `✖` becomes an x SVG; muted, not dimmed | `ai.js:518-519` |
| `File already exists — write cannot overwrite. Ask the AI to patch it instead.` | shipped text; the leading `✖` becomes an alert SVG | `ai.js:686-687` |
| `<n> ops · preview unavailable (applied atomically)` | shipped | `ai.js:620-622` |
| `… <n> more lines` | shipped | `ai.js:665-666` |
| `Diff: <n> lines added, <n> removed` (visually hidden) | new | §4.3 |

### 7.4 Attachment errors

All shipped, verbatim (`ai.js:2506-2543`, `:2185-2190`, `:2135-2156`).

| String |
|---|
| `too many files (max 8)` |
| `<name> is larger than 10 MiB — downscale it first` |
| `too many images (max 4)` |
| `<name> is larger than 128 KiB` |
| `attachment size limit reached (512 KiB total)` |
| `unsupported file type: <name>` |
| `<name> is binary (not a UTF-8 text file)` |
| `<name> could not be read as an image` |
| `<name> could not be reduced below 2 MiB` |
| `No AI provider configured — open Settings → AI.` (the send-time guard) |

The two no-provider strings stay different: the empty-state sentence explains setup; the
send-time line is a failure of an action that should now be impossible because the
composer is disabled. Keep it as a backstop.

---

## 8. Accessibility

### 8.1 Landmarks and structure

| Element | Contract |
|---|---|
| `#side-panel` | `<aside aria-label="Side panel">` — the frame's (`shell-frame.md:664`) |
| `#ai-view` | The view host; no role of its own |
| `.panel-title` | `<h2>AI Assistant</h2>`; the view's heading |
| `.ai-chat-log` | `role="log"`, `aria-label="Conversation"`, `aria-live="off"` |
| Each turn | `role="group"` + `aria-label="Your message"` / `"Assistant reply"` |
| Composer | `<form>` + `<textarea aria-label="Message">` |
| Status | `.ai-sr-status.sr-only` `role="status" aria-live="polite"`, visually hidden by the existing `.sr-only` rule (`style.css:4406`) |
| Errors | `role="alert"` on `.ai-error` and on attachment error chips |
| Card | `role="group"` + `aria-label="Proposed patch to <path>"` / `"Proposed new file <path>"` |

The log is `aria-live="off"` deliberately. A live log would announce every streamed token;
the hidden status region announces the two facts a screen-reader user needs — the reply
started and it stopped or failed. The reply itself is read on demand.

### 8.2 Focus order and keys

| Order | Stop |
|---|---|
| 1 | Clear |
| 2 | Collapse / close |
| 3 | Provider select |
| 4 | Trace summaries, prose links, code-block copy buttons and card buttons, in DOM order (the card's Reject then Apply are the last controls before the chips) |
| 5 | Turn controls in DOM order: Edit (in the user turn), then Regenerate (in the assistant turn) |
| 6 | Attachment remove buttons |
| 7 | Textarea |
| 8 | Attach |
| 9 | Send / Stop |

Rules:

1. Tab order is DOM order; no positive `tabindex` (`foundations.md:696`).
2. `Enter` and `Space` activate buttons; `Enter` in the textarea sends; `Shift+Enter`
   newlines; IME composition never sends.
3. `Esc` closes the drawer, the settings layer, or the reader history. It does not clear the
   draft and does not cancel a pending card.
4. A resolved card moves focus to its status row; a removed chip moves focus to the next
   chip's remove button, or to the textarea when the bar empties.
5. The jump control appears above the composer only when it can act; it is reachable by
   `Tab` and does not steal focus.

### 8.3 Contrast

Measured pairs that this design introduces or fixes. Text needs 4.5:1; boundaries and
icons 3:1 (`foundations.md:626-636`).

| Pair | Dark | Light | Verdict |
|---|---|---|---|
| `--text-primary` on `--surface-panel` | 12.57 | 14.61 | pass |
| `--text-muted` on `--surface-panel` | 5.52 | 5.56 | pass |
| `--text-muted` on `--surface-raised` | 4.96 | 5.13 | pass |
| `--accent` on `--surface-panel` (ACP badge) | 6.00 | 5.34 | pass |
| `--border-strong` on `--surface-panel` | 4.03 | 3.64 | pass (≥3) |
| `--text-primary` on `--danger-soft` over panel | 10.05 | 12.26 | pass (error body) |
| `--danger` on `--danger-soft` over panel | 4.51 | **4.26** | **fails light** — not used for text |
| `--danger` on `--surface-raised` (status) | 5.07 | 4.68 | pass |
| `--ok` on `--surface-raised` (status) | 7.61 | 5.28 | pass |
| `--text-primary` on `--diff-add-bg` over well | 12.21 | 12.15 | pass |
| `--text-primary` on `--diff-del-bg` over well | 12.82 | 12.14 | pass |
| `--text-muted` on `--surface-well` (diff numbers) | 6.43 | 5.32 | pass |
| `--accent` on `--accent-soft` over well | 5.22 | **4.33** | **fails light** — not used for the hunk header |
| `--text-on-accent` on `--accent` | 6.99 | 5.72 | pass (send, Apply) |

`--text-muted` is never used at `--opacity-disabled` on text the user must read. Disabled
controls follow the component rule; status text is never disabled.

### 8.4 Reduced motion

| Element | Normal | Reduced motion |
|---|---|---|
| Streaming caret | 1 s blink | static, visible |
| Trace running dot | pulse | static |
| Trace chevron | `--dur-1` rotate | instant |
| Turn control | `--dur-1` background/colour | none |
| Jump control | none | none |
| Drawer | `--dur-3` | none — the frame owns it |

Every transition and animation above has a twin in the AI block's `@media (prefers-reduced-motion: reduce)`
(`foundations.md:462-470`).

### 8.5 Touch

On a coarse pointer the targets are at least 44 × 44 (`--control-h-touch`): Clear, select,
attach, send, stop, turn controls, card buttons, chip remove. The AI view is desktop and
tablet only; it is not in the phone drawer (§9.2). A chip itself stays 30 high; its remove
button is 44 square, grown with negative margins so the chip's height does not change
(`controls.md` §2.6).

---

## 9. Responsive and phone

### 9.1 Widths

| Width | Behaviour |
|---|---|
| 480 (cap) | The same single column; prose measure grows; the composer card stays full width |
| 240 (default) | The design width; everything in §3–§5 fits |
| 140 (floor) | §1.2; nothing hidden, the diff scrolls, card actions wrap |
| 861–1023, coarse | Phone shell; the AI view is not reachable there (§9.2) |
| 1024+, coarse | Desktop shell per `foundations.md:681-687`; the panel is not a drawer |

There is no second mode switch. The AI view adds no container query (`foundations.md:531-535`).

### 9.2 The phone

The AI view and its rail button stay **hidden on the phone**, as shipped
(`style.css:7203-7204`, `shell-frame.md` §6.1). The drawer keeps its five view buttons and
there is no AI entry. The user rejected enabling it on 2026-11-09.

The panel was assessed at the 335 px drawer width and the layout works, but it is not part of
this design. If the decision reverses, reuse the frame's drawer, trap and scrim; the composer
needs 16 px type, 44 px targets and the same attachment limits, and the rail gains a sixth
button at 65 px each. Nothing else in this document depends on that variant.

### 9.3 Orientation and zoom

The AI view has no phone surface, so orientation does not change it. At 200 % browser zoom
the shell switches to the phone layout at 860 px and the AI view is no longer reachable; no
horizontal scrolling appears on `body` (`foundations.md:703-705`). At `--font-scale: 1.3` the
header and card controls do not clip: the title ellipsizes and the card actions wrap.

---

## 10. Tokens and CSS target

### 10.1 Reuse, then the AI additions

Everything below resolves to a foundation token. The three heights are theme-independent
primitives; the two diff washes are declared per theme. All five are in foundations Appendix A;
the table records why.

| Token | Value | Why it cannot use an existing token |
|---|---|---|
| `--ai-composer-min-h` | `40px` | Two lines of `--text-ui-lg` at `--lh-normal` plus padding; no rung expresses it. `--control-h-body` is 32 and one line. |
| `--ai-composer-max-h` | `160px` | The growth ceiling, currently `AI_INPUT_MAX_HEIGHT` (`ai.js:86`) and `max-height` (`style.css:5464`). JS must read the same number. |
| `--ai-diff-max-h` | `260px` | The diff's scroll ceiling (`style.css:5336`). `--space-*` stops at 48; the value is a reading window, not spacing. |
| `--diff-add-bg` | dark `rgba(95, 212, 154, .10)`, light `rgba(22, 112, 63, .10)` | The row tint is a colour literal today (`style.css:5378`). A component colour belongs in the theme blocks. |
| `--diff-del-bg` | dark `rgba(255, 107, 107, .10)`, light `rgba(192, 57, 43, .10)` | Same (`style.css:5384`). |

No alias tokens are added. `--ai-*` is a number family; `--diff-*` is a colour family. Both
follow the component tier (`foundations.md:45-70`). The composer record's criterion "no new
tokens introduced" (`ai-composer-redesign.md:320`) predates the foundation layer; these five
replace the JS constant and four CSS literals, so they are the tokenisation it asked for, not
a new palette.

### 10.2 Rule order

| # | Change | Where |
|---|---|---|
| 1 | The AI and diff tokens are declared in foundations Appendix A; no local declaration | `style.css` token blocks |
| 2 | Header: `h2` title with the UA margin and weight reset, tokenised Clear | `ai.js:2251-2287`; `style.css:5023-5031`, `:5684-5693` |
| 3 | Provider bar: 36 px select, well face, strong border, focus, disabled; ACP pill and note. On a config failure keep the last `servers`/`currentServer` and set `configFailed` instead of clearing them | `ai.js:2296-2309`, `:2762-2767`, `:2774-2800`; `style.css:5044-5056` |
| 4 | Log: role, padding, gap, empty state, jump control, follow rule | `ai.js:2311-2314`, `:1262-1264`; `style.css:5058-5066` |
| 5 | Messages: user, prose, trace, status, error, turn controls | `style.css:5068-5240`, `:5195-5229`, `:5644-5682` |
| 6 | Cards: head, diff, actions, status, focus move | `ai.js:489-712`; `style.css:5248-5434` |
| 7 | Composer: card, field, send/stop, chips | `ai.js:2354-2415`, `:2444-2560`; `style.css:5439-5627` |
| 8 | Phone: no change. The two hides stay; no AI rule enters the phone query | `style.css:7203-7204` |
| 9 | Reduced motion: one AI block beside the AI rules | `style.css` |
| 10 | JS behaviour: Clear and Send disabled rules, IME/Enter guard, card-status focus move, trace disclosure toggle, config-failure boolean | `ai.js:2259-2281`, `:2409-2415`, `:2666-2671`, `:489-501`, `:2762-2767` |

Rules 2–7 replace shipped declarations in place; rule 8 is a second block inside the one
phone query, after every desktop AI rule, so its values win by order. Rule 9 follows the
last AI rule. No existing rule is reordered, and no token block is moved.

### 10.3 The target CSS

```css
#ai-view {
  background: var(--surface-panel);
  min-width: 0;
}
#ai-view .panel-header { padding-inline-end: var(--space-2); }
#ai-view .panel-header-actions { gap: var(--space-hair); }
#ai-view .panel-title { margin: 0; font-weight: var(--fw-regular); }

.ai-clear {
  min-height: var(--control-h-sm);
  padding: 0 var(--space-2);
  border: var(--stroke-1) solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: var(--text-xs);
  cursor: pointer;
}
.ai-clear:hover:not(:disabled) { color: var(--text-primary); background: var(--accent-soft); }
.ai-clear:disabled { opacity: var(--opacity-disabled); cursor: not-allowed; }
.ai-clear:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-offset); }

.ai-config-hint {
  margin: var(--space-2) var(--space-3) 0;
  padding: var(--space-2) var(--space-3);
  border: var(--stroke-1) solid var(--warn);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  color: var(--text-primary);
  font-size: var(--text-sm);
  line-height: var(--lh-snug);
}

.ai-model-bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3) var(--space-1);
  flex: 0 0 auto;
}
.ai-model-select {
  flex: 1 1 auto;
  min-width: 0;
  height: var(--control-h-lg);
  padding: 0 var(--space-6) 0 var(--space-3);
  background: var(--surface-well);
  color: var(--text-primary);
  border: var(--stroke-1) solid var(--border-strong);
  border-radius: var(--radius-sm);
  font: inherit;
  font-size: var(--text-ui);
}
.ai-model-select:hover:not(:disabled) { border-color: var(--accent); }
.ai-model-select:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}
.ai-model-select:disabled { opacity: var(--opacity-disabled); cursor: not-allowed; }

.ai-acp-note {
  display: flex;
  align-items: flex-start;
  gap: var(--space-1);
  margin: 0 var(--space-3) var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-xs);
  line-height: var(--lh-snug);
}
.ai-acp-tag {
  flex: 0 0 auto;
  padding: 1px var(--space-2);
  border: var(--stroke-1) solid var(--accent);
  border-radius: var(--radius-pill);
  color: var(--accent);
  font-size: var(--text-xs);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-flat);
}

.ai-chat-log {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.ai-empty {
  margin: auto;
  max-width: calc(60 * var(--space-2));
  padding: var(--space-6) var(--space-2);
  text-align: center;
  color: var(--text-muted);
}
.ai-empty-icon { color: var(--text-muted); margin: 0 auto var(--space-2); }
.ai-empty-title {
  margin: 0 0 var(--space-1);
  color: var(--text-primary);
  font-size: var(--text-ui);
  font-weight: var(--fw-semibold);
}
.ai-empty-hint { margin: 0; font-size: var(--text-sm); line-height: var(--lh-snug); }

.ai-msg { display: flex; flex-direction: column; min-width: 0; flex: 0 0 auto; }
.ai-msg-user { align-items: flex-end; }
.ai-msg-assistant { align-items: stretch; }

.ai-user-text {
  max-width: 95%;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-lg) var(--radius-lg) var(--radius-xs) var(--radius-lg);
  background: var(--accent-soft);
  color: var(--text-primary);
  font-size: var(--text-ui-lg);
  line-height: var(--lh-normal);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.ai-msg-assistant > .ai-prose-span {
  color: var(--text-primary);
  font-size: var(--text-ui-lg);
  line-height: var(--lh-prose);
  overflow-wrap: anywhere;
  min-width: 0;
}
.ai-msg-assistant > .ai-prose-span + .ai-prose-span { margin-top: var(--space-1); }
.ai-prose-span > :first-child { margin-top: 0; }
.ai-prose-span > :last-child { margin-bottom: 0; }
.ai-prose-span p { margin: .45em 0; }
.ai-prose-span h1, .ai-prose-span h2, .ai-prose-span h3,
.ai-prose-span h4, .ai-prose-span h5, .ai-prose-span h6 {
  margin: .8em 0 .35em;
  line-height: var(--lh-tight);
  font-weight: var(--fw-heading);
}
.ai-prose-span h1 { font-size: var(--text-lg); }
.ai-prose-span h2 { font-size: var(--text-body); }
.ai-prose-span h3, .ai-prose-span h4,
.ai-prose-span h5, .ai-prose-span h6 { font-size: var(--text-ui-lg); }
.ai-prose-span ul, .ai-prose-span ol { margin: .45em 0; padding-left: 1.5em; }
.ai-prose-span li { margin: .18em 0; }
.ai-prose-span li > p:first-child { margin-top: 0; }
.ai-prose-span li > p:last-child { margin-bottom: 0; }
.ai-prose-span code {
  font-family: var(--font-mono);
  font-size: .82em;
  background: var(--surface-well);
  border: var(--stroke-1) solid var(--border);
  border-radius: var(--radius-xs);
  padding: 0 var(--space-1);
}
.ai-prose-span pre {
  position: relative;
  margin: var(--space-2) 0;
  padding: var(--space-2) var(--space-3);
  background: var(--surface-well);
  border: var(--stroke-1) solid var(--border);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  line-height: var(--lh-normal);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  overflow-x: clip;
}
.ai-prose-span pre code { background: transparent; border: 0; padding: 0; font-size: inherit; }
.ai-prose-span blockquote {
  margin: .45em 0;
  padding: var(--space-hair) var(--space-3);
  border-left: var(--stroke-3) solid var(--border);
  color: var(--text-muted);
}
.ai-prose-span table {
  border-collapse: collapse;
  font-size: var(--text-sm);
  display: block;
  max-width: 100%;
  overflow-x: auto;
}
.ai-prose-span th, .ai-prose-span td {
  border: var(--stroke-1) solid var(--border);
  padding: var(--space-1) var(--space-2);
  text-align: left;
}
.ai-prose-span th { background: var(--surface-raised); }
.ai-prose-span a { color: var(--accent); }
.ai-prose-span img { max-width: 100%; }

.ai-tool-trace {
  min-height: var(--control-h-sm);
  padding: var(--space-1) 0 var(--space-1) var(--space-2);
  border-left: var(--stroke-2) solid var(--border);
  margin: 0;
  font-family: var(--font-mono);
  color: var(--text-muted);
}
.ai-tool-trace > summary {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
  list-style: none;
  cursor: pointer;
}
.ai-tool-trace > summary::-webkit-details-marker { display: none; }
.ai-tool-trace[data-state="event"],
.ai-tool-trace[data-state="running"] {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}
.ai-tool-name {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-label);
}
.ai-tool-trace > .ai-tool-name:only-child {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ai-tool-path {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-size: var(--text-sm);
}
.ai-tool-out {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: var(--text-xs);
  white-space: nowrap;
}
.ai-tool-trace[data-state="err"] .ai-tool-out { color: var(--danger); }
.ai-tool-body {
  margin: var(--space-1) 0 0;
  max-height: calc(var(--space-8) * 2);
  overflow: auto;
  color: var(--text-muted);
  font-size: var(--text-sm);
  line-height: var(--lh-normal);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.ai-tool-caret { flex: 0 0 auto; width: var(--icon-sm); height: var(--icon-sm); transition: transform var(--dur-1) var(--ease-out); }
.ai-tool-trace[open] .ai-tool-caret { transform: rotate(90deg); }
.ai-tool-dot {
  flex: 0 0 auto;
  width: var(--space-2);
  height: var(--space-2);
  border-radius: var(--radius-circle);
  background: var(--accent);
  animation: ai-pulse 1.6s var(--ease-linear) infinite;
}
@keyframes ai-pulse { 50% { opacity: .35; } }
.ai-tool-trace:focus-within { outline: none; }
.ai-tool-trace > summary:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset-inset);
}

.ai-turn-status {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-top: var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-xs);
}
.ai-status-dot {
  width: var(--space-2);
  height: var(--space-2);
  border-radius: var(--radius-circle);
  background: var(--text-muted);
}

.ai-stream-caret {
  display: inline-block;
  width: var(--stroke-2);
  height: 1em;
  margin-left: var(--space-hair);
  vertical-align: text-bottom;
  background: var(--accent);
  animation: ai-caret 1s steps(2, start) infinite;
}
@keyframes ai-caret { 50% { opacity: 0; } }

.ai-error {
  margin-top: var(--space-1);
  padding: var(--space-2) var(--space-3);
  border: var(--stroke-1) solid var(--danger);
  border-radius: var(--radius-md);
  background: var(--danger-soft);
  color: var(--text-primary);
  font-size: var(--text-sm);
  line-height: var(--lh-snug);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.ai-error-label { font-weight: var(--fw-semibold); }
.ai-error-icon { color: var(--danger); }

.ai-turn-control {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  flex: 0 0 auto;
  min-height: var(--control-h-sm);
  margin-top: var(--space-1);
  padding: 0 var(--space-1);
  border: var(--stroke-1) solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: var(--text-xs);
  line-height: var(--lh-flat);
  cursor: pointer;
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.ai-turn-control > svg { width: var(--icon-sm); height: var(--icon-sm); flex: 0 0 auto; }
.ai-regenerate { align-self: flex-start; }
.ai-edit { align-self: flex-end; }
.ai-turn-control:hover:not(:disabled) { color: var(--text-primary); background: var(--accent-soft); }
.ai-turn-control:active:not(:disabled) { background: var(--accent-soft); }
.ai-turn-control:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-offset); }
.ai-turn-control:disabled { opacity: var(--opacity-disabled); color: var(--text-muted); background: transparent; cursor: not-allowed; }

.ai-jump {
  position: sticky;
  bottom: 0;
  align-self: center;
  min-height: var(--control-h-sm);
  padding: 0 var(--space-2);
  border: var(--stroke-1) solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-raised);
  box-shadow: var(--shadow-float);
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-xs);
  cursor: pointer;
}
.ai-jump[hidden] { display: none; }

/* --- edit card --- */
.ai-edit-card {
  flex: 0 0 auto;
  margin: 0;
  border: var(--stroke-1) solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
  overflow: hidden;
}
.ai-edit-card.applying { border-color: var(--accent); }
.ai-edit-card.ok { border-color: var(--ok); }
.ai-edit-card.errored { border-color: var(--danger); }
.ai-edit-card.rejected { border-color: var(--border); }

.ai-edit-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--surface-panel);
  border-bottom: var(--stroke-1) solid var(--border);
}
.ai-edit-op {
  flex: 0 0 auto;
  padding: 1px var(--space-2);
  border: var(--stroke-1) solid currentColor;
  border-radius: var(--radius-pill);
  font-size: var(--text-xs);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  color: var(--warn);
}
.ai-edit-card[data-op="write"] .ai-edit-op { color: var(--ok); }
.ai-edit-card[data-op="append"] .ai-edit-op,
.ai-edit-card[data-op="prepend"] .ai-edit-op,
.ai-edit-card[data-op="replace"] .ai-edit-op { color: var(--text-muted); }
.ai-edit-path {
  order: 2;
  flex: 1 0 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}
.ai-diff-stats { order: 1; margin-left: auto; display: inline-flex; gap: var(--space-1); flex: 0 0 auto; }
.ai-stat {
  padding: 0 var(--space-1);
  border: var(--stroke-1) solid currentColor;
  border-radius: var(--radius-pill);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
}
.ai-stat.del { border-color: var(--danger); }
.ai-stat.add { border-color: var(--ok); }
.ai-edit-desc {
  padding: var(--space-1) var(--space-3) 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.ai-patch-ops-note {
  padding: var(--space-2) var(--space-3);
  border-top: var(--stroke-1) solid var(--border);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.ai-diff {
  background: var(--surface-well);
  border-bottom: var(--stroke-1) solid var(--border);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: var(--lh-normal);
  overflow: auto;
  max-height: var(--ai-diff-max-h);
}
.diff-row {
  display: grid;
  grid-template-columns: 1.8em 1.8em 1em 1fr;
  align-items: baseline;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  min-width: max-content;
  padding-right: var(--space-2);
}
.diff-num {
  text-align: right;
  padding: 0 var(--space-1) 0 0;
  color: var(--text-muted);
  user-select: none;
  font-size: var(--text-xs);
}
.diff-sign { user-select: none; font-weight: var(--fw-semibold); }
.diff-text { white-space: pre-wrap; color: var(--text-primary); }
.diff-hunk {
  position: sticky;
  top: 0;
  z-index: 1;                  /* local stack, foundations §6.1 */
  display: block;
  padding: var(--space-1) var(--space-2);
  background: var(--surface-raised);
  border-bottom: var(--stroke-1) solid var(--border);
  color: var(--text-muted);
  font-size: var(--text-xs);
  white-space: nowrap;
}
.diff-add { background: var(--diff-add-bg); }
.diff-add .diff-sign { color: var(--ok); }
.diff-del { background: var(--diff-del-bg); }
.diff-del .diff-sign { color: var(--danger); }
.diff-del .diff-text { text-decoration: line-through; text-decoration-color: var(--danger); }
.diff-ctx { color: var(--text-muted); }
.diff-more {
  display: block;
  padding: var(--space-1) var(--space-2);
  color: var(--text-muted);
  font-style: italic;
  white-space: nowrap;
}

.ai-edit-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
}
.ai-btn {
  min-height: var(--control-h-md);
  padding: 0 var(--space-3);
  border: var(--stroke-1) solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-panel);
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-ui);
  font-weight: var(--fw-medium);
  cursor: pointer;
  transition: background var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out);
}
.ai-btn:hover:not(:disabled) { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.ai-btn.ai-apply {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--text-on-accent);
  font-weight: var(--fw-semibold);
}
.ai-btn.ai-apply:hover:not(:disabled) {
  background: var(--accent);
  color: var(--text-on-accent);
  box-shadow: 0 0 0 var(--stroke-3) var(--accent-soft);
}
.ai-btn:active:not(:disabled) { transform: translateY(1px); }
.ai-btn:disabled { opacity: var(--opacity-disabled); cursor: not-allowed; }
.ai-btn:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-offset); }

.ai-card-status {
  padding: var(--space-2) var(--space-3);
  border-top: var(--stroke-1) solid var(--border);
  font-size: var(--text-sm);
}
.ai-card-status:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-offset-inset); }
.ai-card-status.applied { color: var(--ok); }
.ai-card-status.error { color: var(--danger); }
.ai-card-status.rejected { color: var(--text-muted); }

/* --- composer --- */
.ai-input-row {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-areas:
    "input  input"
    "attach actions";
  align-items: end;
  gap: var(--space-1);
  margin: var(--space-2) var(--space-3) var(--space-3);
  padding: var(--space-2) var(--space-2) var(--space-1);
  background: var(--surface-raised);
  border: var(--stroke-1) solid var(--border-strong);
  border-radius: var(--radius-lg);
  flex: 0 0 auto;
}
.ai-input-row:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 var(--stroke-3) var(--accent-soft);
}
.ai-input-row.ai-streaming { border-color: var(--accent); }
.ai-input {
  grid-area: input;
  resize: none;
  min-height: var(--ai-composer-min-h);
  max-height: var(--ai-composer-max-h);
  padding: var(--space-1) var(--space-1) 0;
  background: transparent;
  border: 0;
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-ui-lg);
  line-height: var(--lh-normal);
}
.ai-input:focus { outline: none; }
.ai-input::placeholder { color: var(--text-muted); }
.ai-input:disabled { opacity: var(--opacity-disabled); cursor: not-allowed; }

.ai-attach {
  grid-area: attach;
  justify-self: start;
  width: var(--control-h-md);
  height: var(--control-h-md);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.ai-attach:hover:not(:disabled) { color: var(--text-primary); background: var(--accent-soft); }
.ai-attach:disabled { opacity: var(--opacity-disabled); cursor: not-allowed; color: var(--text-muted); background: transparent; }

.ai-send, .ai-stop {
  grid-area: actions;
  justify-self: end;
  width: var(--control-h-body);
  height: var(--control-h-body);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-circle);
  cursor: pointer;
}
.ai-send { border: 0; background: var(--accent); color: var(--text-on-accent); }
.ai-send:hover:not(:disabled) { box-shadow: 0 0 0 var(--stroke-3) var(--accent-soft); }
.ai-send:active:not(:disabled) { transform: translateY(1px); }
.ai-send:disabled {
  background: var(--surface-well);
  color: var(--text-muted);
  border: var(--stroke-1) solid var(--border-strong);
  box-shadow: none;
  opacity: var(--opacity-disabled);
  cursor: not-allowed;
}
.ai-stop { border: var(--stroke-1) solid var(--border-strong); background: var(--surface-raised); color: var(--text-primary); }
.ai-stop:hover { color: var(--danger); border-color: var(--danger); }
.ai-send[hidden], .ai-stop[hidden] { display: none; }
.ai-attach svg, .ai-send svg, .ai-stop svg { width: var(--icon-md); height: var(--icon-md); }
.ai-attach:focus-visible, .ai-send:focus-visible, .ai-stop:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}

.ai-attach-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
  padding: 0 var(--space-3);
  flex: 0 0 auto;
}
.ai-attach-bar[hidden] { display: none; }
.ai-attach-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  max-width: 100%;
  min-height: var(--control-h-sm);
  padding: 0 var(--space-1) 0 var(--space-2);
  background: var(--surface-raised);
  border: var(--stroke-1) solid var(--border-strong);
  border-radius: var(--radius-pill);
  color: var(--text-primary);
  font-size: var(--text-xs);
}
.ai-attach-chip-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-attach-chip-size { flex: 0 200 auto; min-width: 0; overflow: hidden; color: var(--text-muted); white-space: nowrap; }
.ai-attach-chip-thumb {
  flex: 0 0 auto;
  width: var(--control-h-sm);
  height: var(--control-h-sm);
  border: var(--stroke-1) solid var(--border);
  border-radius: var(--radius-xs);
  object-fit: cover;
}
.ai-attach-chip-thumb[hidden] { display: none; }
.ai-attach-chip-remove {
  flex: 0 0 auto;
  width: var(--control-h-sm);
  height: var(--control-h-sm);
  margin-right: calc(-1 * var(--space-1));
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: var(--text-ui);
  line-height: var(--lh-flat);
  cursor: pointer;
}
.ai-attach-chip-remove:hover { color: var(--danger); }
.ai-attach-chip-remove:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-offset-inset); }
.ai-attach-chip.error {
  flex: 1 1 100%;
  border-color: var(--danger);
  border-radius: var(--radius-sm);
  background: var(--danger-soft);
  color: var(--text-primary);
  padding: 0 var(--space-1) 0 var(--space-2);
}

.ai-user-files {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-1);
  margin-top: var(--space-1);
  max-width: 95%;
}
.ai-user-file {
  display: inline-flex;
  align-items: center;
  min-height: var(--control-h-sm);
  padding: 0 var(--space-2);
  border: var(--stroke-1) solid var(--border-strong);
  border-radius: var(--radius-pill);
  background: var(--surface-raised);
  color: var(--text-muted);
  font-size: var(--text-xs);
  white-space: nowrap;
}
.ai-user-thumb {
  max-height: calc(var(--space-8) * 2);
  max-width: 100%;
  border: var(--stroke-1) solid var(--border);
  border-radius: var(--radius-sm);
}
.ai-drop-active { outline: var(--stroke-2) dashed var(--accent); outline-offset: calc(-1 * var(--stroke-2)); }

@media (prefers-reduced-motion: reduce) {
  .ai-stream-caret { animation: none; opacity: 1; }
  .ai-tool-dot { animation: none; opacity: 1; }
  .ai-tool-caret { transition: none; }
  .ai-turn-control { transition: none; }
  .ai-btn { transition: none; }
}
```

### 10.4 Phone block

Inside the existing query (`style.css:6975`), after the two hides at `:7203-7204` are
deleted:

```css
.ai-clear { min-height: var(--control-h-touch); padding: 0 var(--space-2); font-size: var(--text-ui); }
.panel-title { font-size: var(--text-ui); }
.ai-model-bar { padding: var(--space-2) var(--space-4) var(--space-1); }
.ai-model-select { height: var(--control-h-touch); font-size: 16px; border-radius: var(--m-radius); }
.ai-acp-note { margin-inline: var(--space-4); font-size: var(--text-sm); }
.ai-chat-log { padding: var(--space-3) var(--space-4); }
.ai-user-text, .ai-msg-assistant > .ai-prose-span { font-size: 16px; }
.ai-input-row { margin: var(--space-2) var(--space-3) var(--space-3); }
.ai-input { min-height: var(--control-h-touch); font-size: 16px; }
.ai-attach, .ai-send, .ai-stop { width: var(--control-h-touch); height: var(--control-h-touch); }
.ai-attach { border-radius: var(--radius-md); }
.ai-attach-chip { min-height: var(--control-h-md); font-size: var(--text-ui); }
.ai-attach-chip-remove {
  width: var(--control-h-touch);
  height: var(--control-h-touch);
  margin: calc(-1 * var(--space-2)) calc(-1 * var(--space-2)) calc(-1 * var(--space-2)) 0;
}
.ai-turn-control { min-height: var(--control-h-touch); padding: 0 var(--space-2); font-size: var(--text-ui); }
.ai-btn { min-height: var(--control-h-touch); font-size: 16px; }
.ai-jump { min-height: var(--control-h-touch); }
```

### 10.5 Checks

| Check | Command / file | Expect |
|---|---|---|
| No undeclared token | `foundations.md:770-778` `comm` check | The five additions are declared; nothing else appears |
| No raw colour in the AI rules | `grep -n "rgba\\|#[0-9a-f]\\{3,6\\}"` on the AI section | Only the token declarations in the theme blocks |
| No new breakpoint | `grep -n "@media"` | One added reduced-motion block; the phone query is reused |
| DOM suite | `node tests/dom/test_dom.js` | All AI blocks green; the trace selectors and the stats text unchanged |
| Browser | `node tests/browser/run_all.js --only=core` | The panel mounts, streams and applies at 1280 |
| Mockup | open `docs/ui/ai-panel-mockup.html` offline | Six dark/light pairs, zero network requests |

---

## 11. Acceptance criteria

| # | Criterion | Where | Observable |
|---|---|---|---|
| **AC1** | The AI view uses the frame header | `ai.js`, `style.css` | `#ai-view .panel-title` is an `<h2>` reading "AI Assistant"; the header is 36 high; Clear and the collapse control are the only actions |
| **AC2** | Clear is disabled with an empty conversation and no chips, and enabled after the first turn or attachment | `ai.js` | With no turns and no chips `.ai-clear.disabled === true`; after a send or a chip it is false; clicking clears conversation, log, chips and stored history (`tests/dom/test_dom.js:30969-30976`) |
| **AC3** | The provider control is a labelled, focusable 36 px select | `ai.js`, `style.css` | `aria-label="Model and provider"`; height 36; a visible 2 px ring; disabled for the whole turn |
| **AC4** | No provider, fetch failure and viewer are three distinct states | `ai.js` | Three different strings; composer disabled in all three; the fetch failure offers Retry |
| **AC5** | ACP shows its badge and consequence note, and text-only attachment affordance | `ai.js` | `.ai-acp-tag` reads "ACP"; the note is visible; `#ai-attach` title is "Attach text files (ACP agents do not accept images)" |
| **AC6** | The log is a named log and errors are alerts | `ai.js` | `.ai-chat-log[role="log"][aria-label="Conversation"]`; every `.ai-error` has `role="alert"`; `.ai-sr-status[role="status"]` exists |
| **AC7** | Streaming can be stopped and does not scroll a reader who is above the bottom | `ai.js` | With `scrollTop = 0` and a delta, `scrollTop` stays 0 and `.ai-jump` is visible; Stop aborts and "Stopped" appears |
| **AC8** | The streaming caret exists and is static under reduced motion | `style.css` | `.ai-stream-caret` in the newest bubble; `animation: none` in the AI reduced-motion block |
| **AC9** | A failed turn shows the error block and a Retry control | `ai.js` | Error text begins "AI request failed:"; the control keeps `.ai-regenerate` and reads "Retry"; clicking re-runs (`ai.js:1824-1846`) |
| **AC10** | An image-bearing provider rejection adds the vision hint | `ai.js` | Two `.ai-error` blocks on `status >= 400` (`tests/dom/test_dom.js:31920-31960`) |
| **AC11** | Edit restores the prompt and its attachments, and is disabled with a draft | `ai.js` | Existing checks at `tests/dom/test_dom.js:32218-32490` stay green; the title is "Clear the draft and attachments first" |
| **AC12** | Every card state is visible without opacity | `style.css` | `.applying` border `--accent`; `.ok` `--ok`; `.errored` `--danger`; `.rejected` keeps `--border` and normal text; no `opacity` on the card |
| **AC13** | Resolving a card moves focus to its status row and announces it | `ai.js` | `document.activeElement` is `.ai-card-status[tabindex="-1"][role="status"]` after Apply, Reject or an error |
| **AC14** | The diff is readable in both themes | `style.css` | Code text is `--text-primary`; the hunk header is `--surface-raised` + `--text-muted`; the numbers are `--text-muted` with no opacity |
| **AC15** | The composer's send is disabled when there is nothing to send | `ai.js` | Empty textarea, no chips → `sendBtn.disabled`; one chip with an empty prompt → enabled |
| **AC16** | `Enter` sends, `Shift+Enter` newlines, IME never sends, `Cmd/Ctrl+Enter` sends | `ai.js` | Four jsdom key events; no request while `isComposing` |
| **AC17** | An attachment chip fits at 240 and 140 | `style.css`, mockup | The name ellipsizes, the size clips first, the `×` stays; no horizontal overflow on `.ai-chat-log` |
| **AC18** | The empty state appears only with no turns and names the next action | `ai.js` | `.ai-empty` present on mount, absent after the first send, back after Clear |
| **AC19** | The 140 px panel loses no control | `style.css`, mockup | Card actions wrap; the select clips; the composer keeps one action row; no control is hidden (the attach bar and the send/stop pair are hidden only by their own state) |
| **AC20** | The AI view is absent from the phone | `style.css`, `static/js/activity.js` | At 390 the rail has five view buttons and none is AI; `#ai-view` is hidden and cannot be activated from the drawer |
| **AC21** | Every new colour and spacing value is a token | `style.css` | The `comm` check in §10.5 is clean; the only new hex/rgba lines are the two diff tokens in each theme |
| **AC22** | Reduced motion removes every new animation and transition | `style.css` | The caret, trace dot, chevron and button transitions are inert |
| **AC23** | No dependency or build step is added | repo | No `package.json` dependency change, no new asset, the mockup is one file |
| **AC24** | A trace with output is a disclosure; an ACP trace is a plain row | `ai.js` | A `read` row is a `<details>` with the summary `read · path · n chars` and the output in `.ai-tool-body`; an ACP row is a `<div>` with `.ai-tool-name` and no chevron; `.ai-tool-trace`, `.ai-tool-name` and `.ai-tool-out` are unchanged (`tests/dom/test_dom.js:30640-30643`, `:33091-33097`) |

The existing tests that already cover this surface and must stay green:
`tests/dom/test_dom.js:30549` (mount), `:30640-30643` (read trace), `:30650-30676` (diff,
stats, applied status), `:30780-30857` (stale, write and blocked cards), `:30928-30964`
(card scroll and shrink), `:31230-31320` (chips), `:31920-31960` (errors and vision hint),
`:32218-32490` (Regenerate/Edit), `:33091-33105` (ACP trace), `:33640-33642` (restored
trace).

Two assertions change with this spec, and must be updated in the same commit:

| Test | Now | Target |
|---|---|---|
| `tests/dom/test_dom.js:31517-31548` | removing the last attachment re-enables Send with an empty draft | Send stays disabled when the draft is empty and no chip remains (AC15) |
| `tests/browser/test_ai_blocks_browser.js:402` | reads the composer height | the new min/max tokens keep the box in range |


---

## 12. Conflicts, supersessions and what not to build

### 12.1 Conflicts with shipped records

| # | Conflict | Resolution | Why |
|---|---|---|---|
| **C1** | The AI view and its rail button are hidden on the phone (`style.css:7203-7204`; `shell-frame.md` §6.1). An earlier draft enabled them. | The user rejected the phone variant on 2026-11-09. | Keep the shipped hide. The rail stays at five view buttons; no AI entry in the drawer. §9.2 records the assessed-but-rejected layout. |
| **C2** | `controls.md` §2.4 says a textarea submits on `Ctrl/Cmd+Enter` and `Enter` inserts a newline. The AI composer sends on bare `Enter` (`ai.js:2666-2671`). | The chat composer keeps `Enter` = send. `Cmd/Ctrl+Enter` also sends; `Shift+Enter` newlines. | Chat convention beats the form convention; users type multi-line prompts with Shift. The two rules cannot both hold in one field, and the shipped field already sends on Enter. Amend `controls.md` §2.4 with the chat-composer exception. |
| **C3** | `ai-chat-message-area.md` §3 recommends `.ai-error` with `--danger` text on `--danger-soft`; that is shipped at `style.css:5231-5240`. Measured light: **4.26:1**. | Text becomes `--text-primary`; the border and the icon stay `--danger`. | The sentence is the content; 4.26 fails the 11 px text floor. The state is still carried three ways: the border, the icon and the words. |
| **C4** | `ai-chat-message-area.md` §2 fixes the turn control at ≈18 px with `padding: 2px 6px`, opacity `.4`. | `min-height: --control-h-sm` 24, padding `0 --space-1`, `--opacity-disabled`. | The 24 px target floor (`foundations.md:676-690`); the control still reads as a quiet footnote because it has no fill and `--text-xs`. |
| **C5** | `ai-composer-redesign.md` §3 gives the card `border: 1px solid --border` and the attach control `border-radius: 8px`. | Card border `--border-strong`; attach radius `--radius-sm` 6. | `--border` on `--surface-panel` is 1.39:1; an interactive boundary needs 3:1 (`foundations.md:182-192`). The attach control is an icon button (radius sm), not a card. |
| **C6** | The composer record gives the disabled send `opacity: .6` (`style.css:5496`); D5 counts six disabled opacities. | `--opacity-disabled` (.45). | One disabled value. |
| **C7** | `acp-provider.md:287-288` says the provider picker is disabled while a turn is in flight; `ai.js:2409-2412` disables only attach and send. | Disable the select for the whole turn. | A provider switch between tool rounds would send round 2 to a different provider (`ai.js:1714-1717`). |
| **C8** | `.ai-btn.ai-apply` paints `#fff` on `--accent` (`style.css:5421-5424`); white on the dark accent is 2.61:1. | `--text-on-accent` at rest; hover is a 3 px halo, not `opacity: .88`. | D1 in `controls.md:36`; one of the eight fixes in `foundations.md:209-224`. |
| **C9** | The shipped card leaves Reject live during Apply (`ai.js:503-526`) and dims a rejected card to `.65` (`style.css:5259`). | Both actions disabled while applying; a rejected card keeps normal text. | A landed patch under a "rejected" label is a lie; opacity lowers the contrast of the status the user must read. |
| **C10** | Clear erases the conversation and the stored history in one click (`ai.js:2264-2281`). | Keep it immediate; disable it when there is nothing to clear. No confirm, no undo. | The transcript is local and reconstructible; the action is a named word in a header with one purpose, and a confirm would add a layer to the smallest control. Recorded as a deliberate rejection, not an oversight. |
| **C11** | Restored history has no traces and no cards (`ai.js:1130-1146`). | Keep that. Do not synthesise a card from a stored tool follow-up. | A restored `patch` card's anchor may be stale; the server would reject it, and a diff against an old file is worse than no card. |
| **C12** | The shipped trace output is always open and can be 9 em tall (`style.css:5672-5681`). | Wrap output in a `<details>`; the summary stays one line. | The trace answers "what is it doing"; the output is for the curious. The selectors and text the tests assert are preserved. |
| **C13** | The shipped card appends Apply then Reject (`ai.js:503-526`), so the primary action sits on the left. | Reject then Apply in the DOM; Apply is the rightmost control. | A commit action belongs at the reading end of the row. The classes and the test selectors are unchanged, so no test asserts the order. |

### 12.2 What not to build

- **No timestamps, avatars, or per-message actions other than the newest turn's Edit and
  Regenerate.** They are not in the conversation model and would be invented state.
- **No bubble around assistant prose.** The page is the surface.
- **No Markdown rendering of the user's prompt.** It is text.
- **No inline message editing.** Edit restores the composer, as shipped.
- **No delete-single-turn, branch, fork or conversation list.** Clear is the only reset.
- **No auto-retry, background retry or request queue.** Retry is a user action.
- **No ACP configuration, model detection, "Test" button or "Read-only" tag in this panel.**
  Settings → AI owns the profile; the panel only names the selected one.
- **No image input for ACP.** The picker accepts text only; the server rejects images 400.
- **No new provider editor or Settings change.** Out of scope.
- **No custom tooltip.** Native `title` plus a visible word (`controls.md` §2.10).
- **No new breakpoint, container query, z-band, shadow or dependency.** The phone query is
  reused; the diff's sticky header uses the local `z-index: 1`.
- **No smooth scrolling.** The log jumps instantly, and reduced motion changes nothing
  about that.
- **No virtual list.** The log stays one DOM list; a 200-turn session is still readable.
- **No confirm dialog on Clear, no undo toast.** See C10.
- **No colour literals in the AI rules.** The diff tints are the two new colour tokens.
- **No "typing" indicator with three animated dots.** The caret and Stop are the signal;
  a second animation adds noise.

---

## Appendix A — Shipped metrics this document changes

| Item | Now | Target | Source |
|---|---|---|---|
| Header title node | `<span>` | `<h2>` | `ai.js:2253` |
| Clear box | ≈20 high, own border | 24 high, ghost | `style.css:5684-5693` |
| Select | 29 high, `--border`, no focus ring | 36, `--border-strong`, ring, disabled while streaming | `style.css:5048-5056`; `controls.md:38` |
| Log padding | 4/12/12 | 12 all round | `style.css:5062` |
| Log gap | 12 | `--space-3` (12) | `style.css:5065` |
| User text | `.9rem` / 1.5 | `--text-ui-lg` / `--lh-normal` | `style.css:5075-5076` |
| Assistant prose | `.9rem` / 1.5 | `--text-ui-lg` / `--lh-prose` | `style.css:5082-5083` |
| Error text | `--danger` on `--danger-soft` | `--text-primary`, danger chrome | `style.css:5231-5240` |
| Card radius | 8 | `--radius-md` (8) | `style.css:5250` |
| Card head | op · path · stats on one row | op + stats, then the path on its own row | `ai.js:536-545` |
| Rejected card | `opacity: .65` | no opacity; muted status | `style.css:5259` |
| Card status | 7/10 | `--space-2 --space-3` | `style.css:5428` |
| Apply text | `#fff` | `--text-on-accent` | `style.css:5421` |
| Composer border | `--border` | `--border-strong` | `style.css:5451` |
| Composer padding | 8/8/6 | `--space-2 --space-2 --space-1` | `style.css:5449` |
| Textarea type | `.9rem` | `--text-ui-lg` | `style.css:5470` |
| Attach radius | 8 | `--radius-sm` | `style.css:5589` |
| Composer glyphs | 18 (SVG attributes) | `--icon-md` 16 | `ai.js:2330`, `:2365`, `:2375` |
| Trace output | always open, 9 em | disclosure, 96 max | `style.css:5672-5681` |
| Turn control | ≈18 high, opacity `.4` | 24 high, `--opacity-disabled`, focus offset 2 | `style.css:5195-5229` |
| Reading chip | `opacity: .55` | no opacity; "reading…" in the size cell | `style.css:5569` |
| Trace name | CSS `text-transform: uppercase` | as given (ACP titles keep case) | `style.css:5656-5665` |
| Diff code | `--ok` / `--danger` | `--text-primary`; sign carries colour | `style.css:5377-5389` |
| Diff floor | `min-height` 10 lines | none — the card is `flex: 0 0 auto` and the log scrolls | `style.css:5343` |
| Diff numbers | `--text-muted` at `.6` | `--text-muted`, no opacity | `style.css:5354-5362` |
| Hunk header | accent on accent-soft | raised face + muted text | `style.css:5366-5376` |
| Phone | view and icon hidden | drawer view, 44 targets, 16 px field | `style.css:7203-7204` |
