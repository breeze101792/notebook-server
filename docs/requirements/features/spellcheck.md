# Feature: Spelling corrections in the hybrid page menu

Status: Shipped. The mechanism is
[`../../architecture/spellcheck.md`](../../architecture/spellcheck.md); the visual
spec is [`../../ui/spellcheck.md`](../../ui/spellcheck.md).

## 1. One-line definition

While editing a note in hybrid (WYSIWYG) mode on desktop, right-clicking plain
prose opens the app's own menu, and that menu offers spelling corrections the app
computes from a bundled en_US dictionary.

## 2. Why

Hybrid mode lost its right-click formatting menu on prose because the browser's
native menu was the only route to the browser's spelling suggestions
(`hybrid.js:10355`, `hybrid.js:10403-10411`, commit `93b9f90`). No Web API exposes
those suggestions (`research/spellcheck-context-menu.md` Q1): to have both, the app
must own the dictionary. This feature buys the formatting menu back where the user
types, and pays for it with one dictionary, one underline and one switch.

## 3. Users and goals

| Goal | Success looks like |
|---|---|
| Fix a typo where I see it | right-click the word, one click on the correction, the word is fixed and saved by autosave |
| Keep my formatting tools while editing prose | right-click anywhere in prose shows Copy, Inline, Heading, List, Insert, History, Save as before |
| Stop marking words that are correct to me | "Add to dictionary" on the word; the mark disappears at once and does not return |
| Not have two spellcheckers argue | one mark, one verdict, one "Add to dictionary" |
| Reach the browser's own menu when I want it | `Shift`+right-click keeps it |

## 4. Scope

Must have:

- the prose right-click on desktop hybrid opens the app menu, with the Spelling
  block when the pointer is on a misspelled word;
- up to five ranked suggestions, "Add to dictionary", "Ignore";
- the misspelling underline while editing;
- a Settings switch, default on;
- a personal-word list that survives a reload and reaches the user's other
  devices through the existing config file, editable in Settings (one word per
  line) and grown by "Add to dictionary";
- technical shapes are not marked: all-caps acronyms, camelCase identifiers,
  hyphen compounds of known parts, and possessives of known words.
- failure degrades to the browser's spellcheck and native menu.

Should have: none beyond the above.

Out of scope: languages other than en_US; grammar; spelling in preview or source
mode; spelling on the phone; a UI to edit the personal list; persisted ignore;
multi-word correction.

## 5. Flows

### F1 — fix a word (pointer)

1. The user right-clicks a word carrying the wavy underline.
2. The app menu opens at the pointer with the suggestions above the Clipboard
   group.
3. The user clicks a suggestion. The menu closes, the word is replaced, the caret
   lands after it, the underline disappears, and the tab is dirty; autosave writes
   the file as usual.
4. One `Ctrl`/`Cmd`+`Z` restores the previous word only.

Branches: no suggestions → the block shows a disabled "No spelling suggestions"
plus Add/Ignore; the word is correct → no block at all; the pointer is on `code`,
a fence, a diagram, or whitespace → no block.

### F2 — stop marking a correct word

`Add to dictionary` → the word joins `spellcheckWords`, the mark clears now, the
word stays cleared after reload. `Ignore` clears the mark until hybrid mode is
exited, and the word is marked again next session.

### F3 — escape to the browser menu

`Shift`+right-click on prose does not cancel the event, so Chromium shows its own
menu (link actions, search, its spellcheck if the app's is off). Firefox does not
fire `contextmenu` for that gesture at all, so it shows the native menu by itself.

### F4 — the dictionary cannot load

First hybrid entry after a failed fetch (offline first run, a broken asset): no
underline, no Spelling block, the browser's own menu returns on prose, and the
browser's own spellcheck comes back on. The Settings switch stays on and shows a
one-line note; the next hybrid entry retries.

### F5 — the feature is off

Settings → General → Spelling off: no underline, no Spelling block, and no
spellcheck on the editing surface at all (`spellcheck="false"` stays). The
browser's menu returns on prose, without spelling suggestions.

### F6 — the note changes while the menu is open

The user opens the menu, then switches notes (or an external change rebuilds the
page), then clicks a suggestion. Nothing is written, nothing is marked dirty: the
click is dropped because the word it named is gone.

### F7 — edit the personal words

Settings → General → Spelling → Personal words: the list the user has built is
shown one word per line. They paste twenty words, press Save, and the status says
`Saved 19 words; 1 ignored: foo_bar` (one line was not a word). No reload: an open
note repaints at once, the listed words stop being marked, and `Add to dictionary`
appends to the same list afterwards.

## 6. Edge cases

| Case | Behaviour |
|---|---|
| Word split by inline markup (`un**believ**able`) | not checked, not offered; one text node is required |
| `I2C`, `0x20`, `foo_bar`, `/usr/bin`, a URL inside prose | refused by the token rule; no mark, no suggestions |
| `mother-in-law`, `don’t` | checked as one word; the dictionary maps the curly apostrophe |
| All-caps and capitalized forms | checked as written; the dictionary accepts capitalization variants |
| Link text, table cell text | checked (they are prose in the Markdown) |
| Text inside `code`, a fence, a diagram, the fence language chip | never checked |
| Word at the very start or end of a text node | checked; the word must still lie wholly inside the node |
| Acronym in caps (`SCPI`, `README`) | accepted; an all-caps typo (`TEH`) is accepted too — the cost of not flagging acronyms |
| camelCase / PascalCase identifier in prose (`getElementById`, `KaTeX`) | accepted |
| Hyphen compound (`re-entrant`, `box-shadow`, `html-live`) | accepted when every part is a known word; `html-live` passes once `html` is in the personal list |
| Possessive of a known word (`MOSFET’s`, `Zephyr's`) | accepted; the `’s` is not part of the check |
| Personal-word line with a digit or `_` (`foo_bar`) | rejected by the editor and named in the status, never stored |
| Duplicate lines pasted | deduped silently; the count in the status reflects the stored list |
| More than 1,000 lines pasted | the newest 1,000 are kept; the status says how many dropped |
| A remote device saves words while Settings is open with unsaved edits | the textarea is not overwritten; the note repaints |
| Empty textarea + Save | clears the list: `Saved 0 words (the list is empty).` |
| Suggestion equals the word with different case | offered; choosing it writes the dictionary's form |
| Two notes open, one misspelled word in each | per-session ignore only in the active session; the dictionary is per page |
| A 1,001st personal word | the oldest entry drops (cap 1,000) |
| Config POST fails | the word still applies for this page; the next successful save carries it |
| Browser without the CSS highlight API | feature treated as failed: browser spellcheck and native menu, note in Settings |

## 7. Acceptance criteria

Each is observable from the UI or a test; the trace is in
[`../../architecture/spellcheck.md`](../../architecture/spellcheck.md) §10.

| # | Criterion | T |
|---|---|---|
| AC1 | In desktop hybrid, a right-click on plain prose opens `#nb-menu` and cancels the native menu. | T-SPELL-10 |
| AC2 | In desktop hybrid, a right-click on a word the dictionary does not know shows up to five suggestions above the first separator. | T-SPELL-04 |
| AC3 | Choosing a suggestion replaces exactly that word and nothing else, and the file on disk is correct after autosave. | T-SPELL-06 |
| AC4 | The correction is one undo step; a `Ctrl`/`Cmd`+`Z` immediately after restores the previous word and keeps the earlier typing. | T-SPELL-06 |
| AC5 | A misspelled word is underlined while editing; a correct word, a word inside `code`, and a word inside a fence are not. | T-SPELL-08 |
| AC6 | "Add to dictionary" clears the mark immediately and the word stays clear after a page reload. | T-SPELL-06 |
| AC7 | "Ignore" clears the mark for this session and the word is marked again after re-entering hybrid. | T-SPELL-06 |
| AC8 | With the switch off: no underline, no Spelling block, `spellcheck="false"` still on the editing surface, and the browser's menu (without suggestions) on prose. | T-SPELL-09 |
| AC9 | A failed dictionary load removes `spellcheck="false"`, so the browser's spellcheck is on and the browser's menu returns on prose, with no Spelling block. | T-SPELL-09 |
| AC10 | `Shift`+pointer right-click on prose leaves the event un-cancelled, so the browser's menu shows (Chromium) or the browser shows it without the event (Firefox). | T-SPELL-10 |
| AC11 | The phone's long-press on prose still shows the browser's menu, and the `spellcheck` attribute is never set to false there. | T-SPELL-11 |
| AC12 | A suggestion picked after the note changed is a no-op: nothing written, nothing marked dirty. | T-SPELL-07 |
| AC13 | Right-clicking prose with a correct word under the pointer shows the existing menu unchanged, first item `Copy`. | T-SPELL-04 |
| AC14 | No HTTP endpoint and no server file changed: the two keys round-trip through `GET/POST /api/config`. | existing backend config tests + inspection |
| AC15 | Typing immediately after `Add to dictionary` or `Ignore` lands in the note (focus and caret returned). | T-SPELL-15 |
| AC16 | `Shift`+`F10` on a misspelled prose word opens the menu with the block and focuses the first suggestion. | T-SPELL-14 |
| AC17 | The Settings switch writes `spellcheck`, and a change made in another tab (a remote `config:changed`) applies to an open hybrid session without a reload. | T-SPELL-16 |
| AC18 | The Personal words editor saves a pasted list normalised, names the rejected lines in its status, and an open note stops marking those words without a reload. | T-SPELL-17 |
| AC19 | An all-caps acronym, a camelCase identifier, a hyphen compound of known parts, and a possessive of a known word are not marked; `recieve` in the same paragraph still is. | T-SPELL-18 |

## 8. What must not regress

- The hybrid formatting menu (Inline, Heading, List, Insert, History, Save,
  table, diagram items) is unchanged for every structural target.
- The write-back contract: a save that changes nothing writes nothing
  (`hybrid-editing.md` §6.2); a correction writes the corrected Markdown and
  nothing else.
- The debug pane shows the corrected source after a fix.
- Preview mode, source mode, the phone shell, the sidebar, and tab menus are
  untouched.
