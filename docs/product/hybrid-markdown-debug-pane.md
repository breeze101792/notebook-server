# Hybrid mode: the Markdown source debug pane — product definition

Status: design spec — pre-implementation (2026-11-16). Owner: `design`.
Applies to: `templates/index.html` (edit bar, `#edit-split`), `static/js/hybrid.js`,
`static/css/style.css`, `static/js/viewer.js` and `static/js/shortcuts.js` (the
two focus guards), `tests/dom/test_dom.js`,
`tests/browser/test_hybrid_browser.js`.
Related: [hybrid-editing](../architecture/hybrid-editing.md) (§5.8 — the pane's
mechanism), [hybrid-mode](../ui/hybrid-mode.md) (the surface it sits in),
[hybrid-markdown-debug-pane](../ui/hybrid-markdown-debug-pane.md) (the visual
spec), [frontend](../testing/frontend.md) (the tests).

## 1. The problem

Hybrid mode edits a rendered DOM and serializes it back to Markdown on save
(`domToMarkdown`, `static/js/hybrid.js:1259`). When the saved file does not
read the way the surface looked, the owner has no way to see the two side by
side: the left pane shows rendered prose, the file shows Markdown. Eyeballing
them across a tab switch is guesswork, and the mismatch is exactly the bytes
that differ.

The owner asked for a debug toggle on the hybrid edit bar: on, the view becomes
two columns — hybrid editing on the left, the plain Markdown text on the right
— so the difference can be read directly.

## 2. The decision

**The right pane shows the bytes Save would write now: `domToMarkdown()` of the
live DOM.**

Reason: that is the document the file will contain; byte-identically, it is the
file after the save. Anything else is a different question:

| Candidate | Verdict |
| --- | --- |
| Live serialized output (`domToMarkdown()`) | **Chosen.** Recomputes as the user edits, so every construct the serializer rewrites or drops is visible at the moment it is introduced. After a save it equals the file on disk. |
| The bytes on disk | Rejected as the default. They do not change while editing, so the pane would be blank of information until the next save. They are already available: save, then source mode (`Ctrl/Cmd+Shift+E`). |
| A textual diff of the two | Rejected for v1. It adds a diff engine and a second scroll model to a diagnostic. Listed as proposal P1 in the UI spec. |

The pane is a **debug view**, not a second editor. It never accepts input, is
never written back, and is not part of the document: it lives outside
`#viewer-content`, the node the serializer reads.

Assumption (stated, not verified): the owner wants this on the desktop only. The
phone edit bar is a 44 px horizontal scroller with Save/Done pinned; a second
column does not fit, and the phone has no source mode at all. The toggle is
therefore absent below 1140 px (the width at which the default panels plus the
reader floor plus a readable source column fit; the UI spec §4.3 derives it). A
fine-pointer window between 861 and 1139 px keeps the desktop shell and hybrid
mode but has no debug surface — a deliberate gap.

## 3. Users and jobs

One user: the notebook owner, working on a desktop, diagnosing a construct that
does not survive the round trip.

| # | Job | Done when |
| --- | --- | --- |
| J1 | See what the file will say for the block I am looking at | The right pane shows the serialized document while the left stays editable |
| J2 | Catch the exact construct that is rewritten | After typing or reformatting, the pane shows the changed bytes without a save |
| J3 | Confirm a fix | After a save, the pane text and the file bytes are identical |
| J4 | Get out of the way | One click closes the pane; the left column takes the full width again |

## 4. Flows

### 4.1 Open and read

1. The user is in hybrid mode. The edit bar shows a new split-view toggle
   (sprite `#nb-icon-split`, name "Show the Markdown source") after `Tx`
   (Clear formatting), in its own separator group.
2. Click the toggle. `#edit-split` becomes a row: the editable page keeps the
   larger share, a read-only Markdown column appears on the right.
3. The pane's first line is already the current serialization. The caret stays
   in the page; typing continues immediately.
4. The pane is replaced with the new serialization after the existing 50 ms
   idle pass (`onContentChange`), coalesced to at most one refresh per animation
   frame. Structural edits — list move, table row/column changes, checkbox
   toggle, undo/redo — update it through the same funnel.
5. The two columns scroll together, proportionally: moving either moves the
   other to the same relative position. A refresh keeps the pane's own offset
   and moves neither.

### 4.2 Close

Click the toggle again. The pane hides, `#edit-split` returns to a column, and the
page takes the full width. The pane's text is cleared (no stale document text
left in the DOM).

### 4.3 Exit hybrid

Any exit path — Done/Close, Esc, the top-bar pencil, a tab switch, a file open,
a mode change — closes the pane and resets the toggle. The close happens before
the first `await` in `exit()`, so a pending refresh can never paint the preview
DOM into the pane. Re-entering hybrid starts with the pane closed. The toggle is
session state; nothing is written to `config/config.json`.

### 4.4 Save while open

The save writes the serialization; when the write returns, the pane recomputes
from the DOM. With no keystroke since the write was computed, that is exactly
the bytes on disk. If a keystroke landed during the POST, the pane already shows
the newer DOM (the idle pass paints before a write that awaits two round trips),
and it stays there: the file catches up on the next save. The pane answers "what
would Save write now", not "what did the last save write".

### 4.5 Serialization failure

If `domToMarkdown()` throws, the pane shows one line,
`⚠ Serialization failed: <message>`, and the session continues; a diagnostic
must never be able to break editing or saving. This branch is a safety net with
no test seam, and it is marked unverified. It is not the missing-library path:
`domToMarkdown` does not throw when turndown is absent.

## 5. Scope

### 5.1 In scope

- One toggle in the hybrid edit bar; no new shortcut, no menu item, no setting.
- One read-only pane, right of the page, in `#edit-split`.
- Refresh on the idle pass, after every save, and after a rebuild.
- Proportional scroll sync between the two columns while the pane is open.
- Empty-note and error states.
- Desktop only: visible at 1140 px and wider.

### 5.2 Out of scope

- Editing, applying, or importing the pane's text. There is no Apply.
- A diff against the on-disk file, per-block highlighting, line numbers, or a
  "jump to block" link between the columns.
- A phone or tablet layout.
- Persisting the toggle across sessions or modes.
- Using the pane as the source editor. Source mode is unchanged.
- Changing the serializer. This feature observes it; it does not fix it.

## 6. Edge cases

| # | Case | Expected |
| --- | --- | --- |
| E1 | Open the pane on a zero-byte note | Header plus an empty body with the muted **Empty note** word; the word is CSS `:empty` content, never bytes |
| E2 | Pane open, type fast | At most one refresh per frame plus one per idle pass, never one per keystroke; the caret never moves |
| E3 | Pane open, click inside the pane | Text is selected and scrolled; the note is not edited; clicking back in the page restores the caret |
| E4 | Pane open, save with a pending keystroke | The pane shows the current DOM's serialization. If the keystroke's idle pass painted before the write returned, the newer text stays; the file catches up on the next save |
| E5 | Pane open, the render check rebuilds the surface | Pane shows the rebuilt surface's serialization, not the pre-rebuild text |
| E6 | Pane open, the file changes on disk and the user reloads | Pane shows the reloaded content's serialization |
| E7 | Pane open, window narrowed below 1140 px | Pane and toggle hide; the page takes the full width. Widening restores the pane in its open state |
| E8 | Pane open, window resized within the desktop range | Both columns resize; the pane keeps its scroll offset where the content still has that height, and the next scroll re-syncs |
| E9 | Serializer throws | One line in the pane; editing, saving, and exiting still work. Safety net only: no seam can force the throw, so it is unverified |
| E10 | A construct the serializer cannot express (a `tfoot`, a caption, a blank run) | The pane shows what is actually written; no warning, no repair |
| E11 | Pane open, a plugin block (Mermaid, table chip) is being edited inline | The pane updates when the block commits, which is the moment the DOM changes |
| E12 | Pane open while a table or list drag is armed | Drag chrome is transient; the toggle is not reachable mid-drag. No new state |
| E13 | Pane focused, `Arrow`/`Page`/`Home`/`End`, or a bare `/` | The pane scrolls; the page follows through the sync; no shortcut fires |
| E14 | Pane scrolled down, then a keystroke in the page | The refresh keeps the pane's scroll offset (clamped if the document shrank) and moves neither column |
| E15 | Scroll either column | The other follows to the same relative position: the pane to the top when the page is at the top, both at 50% at 50%. The echo does not loop |
| E16 | Pane open, a refresh lands while both are at 40% | Neither column jumps; the pane keeps its own offset, the page does not move |
| E17 | Close the pane while its `<pre>` has focus | Focus returns to the page; the next keystroke edits the note and the page does not scroll |

## 7. Acceptance criteria

Each is observable and testable. `P-AC` = product criterion; the UI spec owns
the visual ones (`AC`), the testing doc maps them to files.

| # | Given / when / then | Proof |
| --- | --- | --- |
| P-AC1 | Given hybrid mode on desktop, when the bar renders, then one split-view toggle is present and `aria-pressed="false"`; in source mode or preview it is absent. | `tests/dom/test_dom.js` |
| P-AC2 | Given hybrid mode, when the toggle is clicked, then `#hybrid-debug-pane` is visible, `#edit-split` carries `hybrid-debug`, the page stays `contenteditable`, and the pane's text equals `NB.hybrid.domToMarkdown()`. | DOM test |
| P-AC3 | Given the pane is open, when a block is typed into and the 50 ms idle pass plus one frame run, then the pane's text equals `NB.hybrid.domToMarkdown()` for the new DOM. | DOM test |
| P-AC4 | Given the pane is open, when a structural action runs (list move, table row insert, undo, checkbox toggle), then the pane's text equals the new serialization within one frame. | DOM test |
| P-AC5 | Given the pane is open, when the user types, then focus stays in `#viewer-content` and the caret is not moved by the refresh. | Browser suite |
| P-AC6 | Given the pane is open and no keystroke lands during the POST, when the document is saved in a real browser, then the pane's text and the file's bytes are identical. With a keystroke during the POST the pane stays on the newer DOM and the file catches up on the next save (E4). | Browser suite |
| P-AC7 | Given the pane is open, when it is closed, then it is hidden, the class is gone, its text is empty, and the page is full width. | DOM test |
| P-AC8 | Given hybrid mode exits by any path, when it exits, then the pane is closed and the toggle is reset; re-entering shows it closed. A frame scheduled by the last keystroke never paints the preview DOM. | DOM test |
| P-AC9 | Given the pane is open, when the note is saved and the render check rebuilds the surface, then the pane shows the rebuilt serialization. | DOM test (forced mismatch via `NB.hybrid.renderCheck`) |
| P-AC10 | Given a zero-byte note, when the pane opens, then it shows the empty state and no exception is logged. | DOM test |
| P-AC11 | The thrown-serializer branch is a safety net and is **unverified**; there is no seam to force a throw. No AC claims behaviour for a missing turndown. | inspection |
| P-AC12 | Given a viewport of 1139 px or narrower, when hybrid mode is entered, then neither the toggle nor the pane is visible and the page is full width; at 1140 the split fits with the page at ≥352 px. | Browser suite at both widths (media queries do not run in jsdom) |
| P-AC13 | Given the pane is open, when the note is serialized for save, then the bytes equal the serialization taken with the pane closed. | DOM test, byte equality |
| P-AC14 | Given the pane was used, when the session ends, then no config key was added and none was written. The module performs no config write; **inspection**. | inspection |
| P-AC15 | Given the pane is open and scrolled, when the page is edited, then the pane's scroll offset survives the refresh (clamped to the new content) and neither column jumps. | Browser suite (jsdom stores `scrollTop` without layout, so it cannot falsify this) |
| P-AC17 | Given the pane is open, when either column is scrolled, then the other moves to the same relative position, in both directions, without a feedback loop. | Browser suite (jsdom has no scrollable height, so the mapping is skipped) |
| P-AC18 | Given the pane is open, when it is closed, then both scroll listeners are removed and the pane's text is cleared. | inspection (`setDebugPane`) |
| P-AC16 | Given the pane has focus, when an arrow key or `/` is pressed, then the pane scrolls or nothing happens, and the note does not scroll and Search does not open. | Browser keyboard pass |

## 8. What must not regress

- The hybrid save round trip: with the pane open, `domToMarkdown()` output is
  byte-identical to the output with the pane closed. The pane is outside the
  serializer's root.
- The no-op write contract: opening and closing the pane changes no document
  bytes, so a save after a toggle writes nothing.
- The undo history: the pane is not in any snapshot, and toggling does not push
  one.
- The I10 render check and the splice baseline: unchanged, because the pane is
  outside `#viewer-content`.
- Source mode, preview mode, and the phone edit bar: unchanged. The source
  split's own scroll sync (`viewer.js:557-586`) is untouched; hybrid has its own
  pair of listeners.

## 9. Open decisions

| # | Decision | Status |
| --- | --- | --- |
| D1 | The pane shows the serialized save output, not the file on disk | **Taken** (§2) |
| D2 | No diff view in v1 | Taken; proposal P1 in the UI spec |
| D3 | Desktop only, breakpoint 1140 px | Taken; derived from 508 px of shell chrome + 352 px reader floor + 280 px source column |
| D4 | Session state, not persisted | Taken |
| D5 | Glyph `#nb-icon-split`, name "Show the Markdown source" | Taken; a glyph change is a one-line delta |
