# Spelling — the misspelling underline and the prose menu's Spelling block

Status: Current spec — shipped. This is the visual and interaction
contract for the app's own en_US spellcheck in hybrid (WYSIWYG) mode. The
mechanism (dictionary, module, write path) is
[`../architecture/spellcheck.md`](../architecture/spellcheck.md); the requirement
is [`../requirements/features/spellcheck.md`](../requirements/features/spellcheck.md).

Reference mockup: [`spellcheck-mockup.html`](spellcheck-mockup.html) — dark and
light boards: underlined prose, the menu with and without suggestions, the
Settings row. Standalone, no network assets; the underline there is a static
`text-decoration` because the mockup carries no script, and the CSS rule in §1.3
is normative.

**Normative source.** This document owns the underline's paint, the Spelling block
inside the context menu, and the Settings row. It reads
[`foundations.md`](foundations.md) for tokens, [`controls.md`](controls.md) for
the `.context-menu` component and its focus contract, [`hybrid-mode.md`](hybrid-mode.md)
for the editing surface, [`reader.md`](reader.md) for prose, and
[`settings-modal.md`](settings-modal.md) for the General tab's row grammar. The
dictionary, the hit predicate, the write path and the config keys are the
architecture document's; this document never restates them.

**Prerequisite.** None. The menu component exists and ships; the underline is new
paint that reads existing tokens.

Paths: `style.css` is `static/css/style.css`; `index.html` is
`templates/index.html`.

---

## 1. The misspelling underline

### 1.1 What is underlined

| Content | Underlined | Why |
|---|---|---|
| Prose text a token rule accepts (letters, interior apostrophe, interior hyphen) and the dictionary rejects | yes | the feature's only standing signal |
| A correct word, a word in the personal list, a word just ignored | no | one verdict, one mark |
| Text inside `code`, a fence, a diagram card, the fence language chip, an image | never | literal content and rendered blocks are not prose |
| Link text and table cell text | yes | prose that serializes to Markdown |
| A word split across inline markup (`un**believ**able`) | never | one text node is required; guessing would corrupt the word |
| Whitespace and punctuation | never | no token |
| Preview mode, source mode, the phone | never | the feature lives in the desktop hybrid editing surface only |

### 1.2 The tokens

Two component tokens, declared on the prose root beside `--viewer-tail`: the
offset holds `em` and must follow `--font-scale` (guidelines §3 rule 2); the
thickness is a device-scale literal, kept next to it so the mark is tuned in one
place.

```css
#viewer-content {
  --spell-underline-offset: .18em;    /* 2.5 px at 1.0, 3.3 px at 1.3 */
  --spell-underline-thickness: 1.5px; /* between --stroke-1 and --stroke-2 */
}
```

No colour token: the rule reads `--danger` directly. A
`--spell-underline-color: var(--danger)` would alias back into a base token,
which guidelines §3 rule 3 forbids.

### 1.3 The rule

```css
::highlight(nb-spelling) {
  text-decoration-line: underline;
  text-decoration-style: wavy;
  text-decoration-color: var(--danger);
  text-decoration-thickness: var(--spell-underline-thickness);
  text-decoration-skip-ink: auto;
  text-underline-offset: var(--spell-underline-offset);
}

/* A wiki-link already carries a solid 2 px underline (style.css:3565);
   the squiggle drops one step lower so the two read as different signals. */
.markdown-body a[data-wikilink]::highlight(nb-spelling) {
  text-underline-offset: calc(2 * var(--spell-underline-offset));
}
```

| Value | Source | Note |
|---|---|---|
| Name `nb-spelling` | this doc | one registry entry for the document; `CSS.highlights` is document-global, so the name is the scope |
| `--danger` `#ff6b6b` dark / `#c0392b` light | foundations §3.2 | 6.20:1 / 5.49:1 on `--surface-page`; 3.74:1 / 4.36:1 over an active selection wash — both clear the 3:1 non-text floor |
| `--spell-underline-thickness` 1.5 px | this doc | between `--stroke-1` and `--stroke-2`: 2 px reads as a large marker at 14 px, 1 px as too faint. The wave's amplitude follows this value; at device-pixel ratio 1 the engine may snap it to 2 px. User call, 2026-11-20 |
| `wavy` | this doc | the shape is the non-colour signal, so the state is never colour alone |
| no `color`, no `background-color` | this doc | a highlight inherits the originating element's colour; the selection and search washes own the backgrounds |

Two engine facts the rule lives with (guidelines §7):

1. `::highlight()` accepts only the decoration, colour and text-shadow families.
   A border or background image is ignored, which is why the mark cannot be
   anything else.
2. `text-underline-offset` is in the pseudo-element's allowed set
   (css-pseudo-4 §3.2) but WebKit does not implement it yet (WebKit bug 282027).
   It is progressive: where it is ignored, the decoration falls back to the UA's
   natural position and the wiki-link override disappears, so the two underlines
   share a line there. The mark still reads; this is the accepted degradation.

`CSS.highlights` and `::highlight()` need Chromium ≥ 105 and Firefox ≥ 140
(Baseline since March 2026). Below that, and where the API is missing entirely,
nothing is painted and the feature is treated as failed: the browser's own
spellcheck stays on and the browser's menu stays reachable (architecture §8). The
app never removes the browser's spellcheck without replacing it.

### 1.4 Interaction with existing paint

| Situation | Result |
|---|---|
| Word inside a text selection | the selection wash stays; the squiggle is painted from the highlight layer. Engines differ on which paints last — this spec does not depend on the squiggle surviving an active selection, because the open menu is the operating signal at that moment |
| Word inside a plain link | the link has colour only (`style.css:3562`); no collision |
| Word inside a wiki-link | solid underline plus the squiggle one step lower (rule above) |
| The page's 2 px inset focus ring | no interaction: the underline lives inside the line box, ≥ `--viewer-tail` (48 px) above the page edge |
| IME composition | no repaint until `compositionend` (`hybrid-mode.md` §2.5) |
| A corrected word | the mark clears immediately, before the next paint of anything else |

### 1.5 Accessibility

The underline is a visual aid only. It carries no `aria-*`, announces nothing, and
is not focusable. The programmatic path to the same information is the Spelling
block in the menu (§2): `Shift`+`F10` / the Menu key on prose resolves the word at
the caret (`NB.spellcheck.wordAtCaret`) and `focusFirst` lands on the first
suggestion, so the correction is reachable with the keyboard alone. The mark is not
the only signal for a state: the menu names the correction in text.

---

## 2. The Spelling block in the context menu

### 2.1 Placement and order

The block is **first**, above the Clipboard group: a right-click on a marked word
is aimed at the correction, and it is where the browser's own menu used to put it.

| Position | Item | When |
|---|---|---|
| 1…n | one item per suggestion, n ≤ 5, best first, labelled with the corrected word | the word is misspelled and the dictionary returns suggestions |
| 1 | `No spelling suggestions` (disabled) | the word is misspelled and the dictionary returns none |
| n+1 | `<hr>` | whenever the block shows |
| n+2 | `Add to dictionary` | whenever the block shows |
| n+3 | `Ignore` | whenever the block shows |
| n+4 | `<hr>` | whenever the block shows |
| … | the existing menu: Copy, Paste, Paste without formatting, separator, Inline, Heading, … | always |

A correct word, or a pointer that resolves to no word, produces **no block**: the
menu opens exactly as it does today, first item `Copy`. That is the common case and
must not change shape.

### 2.2 Anatomy

```html
<div id="nb-menu" class="context-menu" role="menu" aria-label="Note actions">
  <button>hello</button>
  <button>helm</button>
  <hr>
  <button>Add to dictionary</button>
  <button>Ignore</button>
  <hr>
  <button>Copy<kbd class="context-menu-kbd">Ctrl+C</kbd></button>
  …
</div>
```

| Part | Rule |
|---|---|
| Suggestion label | the corrected word in the original's capitalisation pattern; never quoted, never numbered, no ellipsis |
| `No spelling suggestions` | disabled: `disabled` + `aria-disabled="true"`, no click listener (`menu.js:113-118`); the visible label is the reason, so no `title` |
| Separators | `<hr>`, one before and one after the block |
| Group heading | none: the separator plus the wording makes the group; a `role="group"` wrapper would make the items unreachable by the arrow walk (`menu.js:162-165` reads direct children) — proposal P2 |
| Item roles | still plain `<button>`s, like every other menu item today; `role="menuitem"` lands with `controls.md` §3.3 step 11, not this pass |
| Menu name | the host takes an `aria-label` from a new `NB.menu.open({label})` option; hybrid passes `"Note actions"`, the other surfaces keep no label unless they ask. The singleton is shared, so a fixed label would misname the tree and tab menus |
| Focus | hybrid opens with `focusFirst: true` (`hybrid.js:10396`), so focus lands on the first suggestion when the block shows and on `Copy` otherwise |
| Item height, padding, radius, type | the shipped `.context-menu` numbers, unchanged — see proposal P1 |

Wording is fixed: `Add to dictionary`, `Ignore`, `No spelling suggestions`. The
`…` suffix is not used: nothing opens from these items.

### 2.3 What each item does

| Item | Effect | Visual feedback |
|---|---|---|
| a suggestion | replaces the word under the pointer; the menu closes first (`menu.js:120`), then the write runs (architecture §5) | the word changes, the underline clears, the tab shows dirty, autosave writes |
| `Add to dictionary` | adds the word, lower-cased, to the personal list in `config.json`, then repaints and hands the caret back (`cb.done()`) | the underline clears at once and the mark does not return after reload |
| `Ignore` | suppresses the word for this hybrid session, then repaints and hands the caret back | the underline clears until hybrid exits |
| `No spelling suggestions` | nothing (disabled) | — |

`Add to dictionary` and `Ignore` must both end with the caret back in the page: the
menu button holds focus while the handler runs, and `close()` does not move it
(`menu.js:65-73`). Without the hand-back the next keystroke is swallowed.

### 2.4 The escape hatch

The handler returns **before** `preventDefault()` when the gesture is a pointer
`Shift`+right-click, so the browser shows its own menu. The exact condition matters:
`Shift` is also true for `Shift`+`F10` and the Menu key, which report
`clientX/Y === 0` and must keep the app menu, so the branch is
`e.button === 2 && e.shiftKey && (e.clientX || e.clientY)`.

Chromium fires `contextmenu` for the gesture and honours the early return. Firefox
does not fire the event for `Shift`+right-click, so its native menu appears without
the branch running. The gesture is undocumented in the UI (no tooltip, no Settings
row); it exists so a word the app's dictionary does not know is never trapped
behind the app menu.

---

## 3. The Settings row

General tab, a new `Spelling` group after `Keyboard`
([`settings-modal.md`](settings-modal.md) §4.1, rows 14–20).

A textarea, not a row list, because the object is a vocabulary: pasting twenty
words at once is the real gesture, and deleting by editing is faster than a remove
button per row. The control reuses the VIM-script block in the same tab.

| # | Element | Copy | State and behaviour |
|---|---|---|---|
| 14 | `h3` | `Spelling` | — |
| 15 | Help paragraph | "Underline misspelled words while editing and offer corrections on right-click." | `id="settings-spellcheck-help"` |
| 16 | Row: label `Spellcheck` + switch | checked by default | live → `spellcheck`; `aria-describedby` → the help paragraph |
| 17 | Note (conditional) | "Spelling dictionary could not be loaded." · "This browser has no text-highlight API; its own spellcheck is used." | `role="status"`, `--warn` for the first, `--text-muted` for the second; hidden when neither applies |
| 18 | Row: label `Personal words`, textarea, action | placeholder `one word per line` | 10 rows, mono (the `#settings-vimrc` pattern); filled from the stored list on open; not disabled by the switch |
| 19 | Help paragraph `#settings-spellcheck-words-help` | "One word per line. These words are never marked, and compounds made from them are accepted too." | `aria-describedby` on the textarea |
| 20 | Action row: Save (primary) + status line `#settings-spellcheck-words-status` | `Saved 24 words.` · `Saved 22 words; 2 ignored: i2c, foo_bar.` · `Saved 1,000 words; 12 dropped (the list is capped at 1,000).` · `Save failed: <message>` | `role="status"`, hidden until the first save; `.ok` for success, `.error` for ignored/dropped and for a failure (the shipped `.settings-vimrc-status` rules) |

Markup is exactly the VIM-script block's shape, six rows tall:

```html
<div class="settings-row settings-vimrc">
  <label class="settings-label" for="settings-spellcheck-words">Personal words</label>
  <textarea id="settings-spellcheck-words" class="settings-vimrc-area"
    rows="10" spellcheck="false" placeholder="one word per line"
    aria-describedby="settings-spellcheck-words-help"></textarea>
  <div class="settings-vimrc-actions">
    <button id="settings-spellcheck-words-save"
      class="settings-action settings-action--primary" type="button">Save</button>
    <span id="settings-spellcheck-words-status" class="settings-vimrc-status"
      role="status" hidden></span>
  </div>
</div>
<p class="settings-help" id="settings-spellcheck-words-help">
  One word per line. These words are never marked, and compounds made from them
  are accepted too.
</p>
```

Markup follows §3.5 exactly:

```html
<h3 id="settings-spelling-heading">Spelling</h3>
<p class="settings-help" id="settings-spellcheck-help">
  Underline misspelled words while editing and offer corrections on right-click.
</p>
<div class="settings-row">
  <label class="settings-label" for="settings-spellcheck-toggle">Spellcheck</label>
  <input type="checkbox" id="settings-spellcheck-toggle" checked
         aria-describedby="settings-spellcheck-help">
</div>
<div class="settings-note" role="status" hidden></div>
```

No CSS change: `#settings-overlay input[type="checkbox"]` (`style.css:1835-1859`)
already carries the 36 × 20 switch, the focus ring and the reduced-motion guard. No
`role="switch"` — the six shipped switches are plain checkboxes; one outlier is
worse than the missing refinement.

**Off means off.** Off removes the underline and the Spelling block, and keeps
`spellcheck="false"` on the editing surface, so the browser's spellcheck does not
return either: the app owns the feature, and "off" cannot leave a second
spellchecker marking the same page. The browser's *menu* does come back on prose
(architecture §3.1), without its spelling suggestions. The note must never imply
that turning the switch off restores the browser's spellcheck.

The switch is absent from the phone settings sheet: the feature is desktop-only and
the phone keeps the browser's spellcheck (`settings-modal.md` §9.4).

---

## 4. States

| # | State | Underline | Menu on prose | Settings |
|---|---|---|---|---|
| 1 | Misspelled, dictionary ready, switch on, pointer right-click | wavy `--danger`, 1.5 px, `.18em` offset | Spelling block above Clipboard | checked, no note |
| 2 | Correct word, or no word under the pointer | none | app menu, first item `Copy` | — |
| 3 | Misspelled, no suggestions | yes | app menu with the disabled `No spelling suggestions` + Add / Ignore | — |
| 4 | Dictionary loading (first moment after entering hybrid) | none yet | app menu, no block | — |
| 5 | Dictionary failed | none | **browser menu** | checked + the load note |
| 6 | Switch off | none | **browser menu** | unchecked |
| 7 | No `CSS.highlights` | none | **browser menu** | switch disabled + the API note |
| 8 | Phone | the browser's own underline | the browser's long-press menu | row not present |
| 9 | `Shift`+pointer right-click on prose | unchanged | the browser's menu | — |
| 10 | Preview / source mode | none | no app menu today, unchanged | — |
| 11 | Note switched with the menu open, then a suggestion picked | — | the menu is already closed by the switch | nothing written |
| 12 | Personal words: empty list | — | — | empty textarea, `Saved 0 words (the list is empty).` after a save |
| 13 | Personal words: 24 words pasted, 2 invalid | the two valid-only words are never marked | a word in the list never shows a Spelling block | textarea populated, `Saved 22 words; 2 ignored: …` |
| 14 | Personal words: a compound whose parts are listed (`html-live` with `html`) | not marked | no block | — |
| 15 | Settings open while a remote device saves words | repaint on `config:changed` | — | textarea refilled only if it has no unsaved edit |

---

## 5. Keyboard and ARIA

| Control | Name | Keys | Focus |
|---|---|---|---|
| Menu host | the label hybrid passes (`Note actions`), `role="menu"` | — | focus goes to the first enabled item (`focusFirst`) |
| Suggestion | its word | `Enter` / `Space` | arrow-walkable; first is focused on open |
| `Add to dictionary`, `Ignore` | their labels | `Enter` / `Space` | arrow-walkable |
| `No spelling suggestions` | its label + `aria-disabled="true"` | not reachable (native `disabled`) | skipped by the arrow walk |
| Settings switch | `Spellcheck`, described by the help line | `Space` toggles | native ring |
| The underline | — | — | not focusable, not announced |

Keyboard entry: `Shift`+`F10` / the Menu key fires `contextmenu` with
`clientX/Y === 0`. On prose, hybrid resolves the word at the caret with
`NB.spellcheck.wordAtCaret()` and anchors the menu at the page's own box; on a
focused diagram block it anchors to the block (`hybrid.js:10380-10393`) as today.
`focusFirst` then puts focus on the first suggestion, so the whole correction is
keyboard-reachable. Nothing else changes in the menu's keyboard contract.

---

## 6. Tokens and CSS target

| Token | Value | Declared |
|---|---|---|
| `--spell-underline-offset` | `.18em` | `#viewer-content` (component token holding `em`, guidelines §3 rule 2) |
| `--spell-underline-thickness` | `1.5px` | `#viewer-content` |
| `--danger` (read, not redefined) | `#ff6b6b` / `#c0392b` | theme blocks |
| `--stroke-2` | `2px` | primitives (used by the menu ring, not the underline) |

Rules to land, in order:

1. `--spell-underline-offset` and `--spell-underline-thickness` on `#viewer-content` (`style.css:2793` section).
2. The `::highlight(nb-spelling)` rule and its wiki-link offset override.
3. `body > #nb-menu button:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-offset-inset); }` — exception E1.
4. The Settings group markup and wiring; no CSS.

---

## 7. Exceptions applied

| # | Surface | Old | New | Delta | Why |
|---|---|---|---|---|---|
| E1 | `#nb-menu` items | no `:focus-visible` rule (`style.css:3449-3460`) | inset 2 px `--focus-ring` | paint only on keyboard focus; no resting change | `focusFirst` puts focus on a menu item and a focused item now changes prose from the keyboard. This pass lands `controls.md` §3.3 step 3 for `#nb-menu` only; the other menu families keep that step's scope |
| E2 | `#viewer-content` | — | `--spell-underline-offset` and `--spell-underline-thickness` declared | new declarations, no change to existing paint | one token must hold `em` on the prose root; the other is the tuning value the mark reads |

Nothing else in this document changes a shipped pixel. The Spelling block reuses
the shipped `.context-menu` item, separator and disabled rules, and the item roles
stay as they ship (no `role="menuitem"` until `controls.md` §3.3 step 11).

---

## 8. Proposals, not applied

| # | Proposal | Why it waits |
|---|---|---|
| P1 | Tokenise `.context-menu` to the `controls.md` §2.9 numbers (item height 32, `--radius-xs`, `--space-2` padding, `--shadow-pop`, `--z-popover`, kbd hint `margin-left: auto`) | it is already `controls.md` §3.3 step 7 and it changes every menu in the app; this feature should be reviewable on its own |
| P2 | Wrap the suggestions in `role="group" aria-label="Spelling suggestions"` | the menu's arrow walk reads direct children (`menu.js:162-165`); the group needs the walk changed first |
| P3 | Flip the menu above the pointer when it would cover the word being corrected | the menu clamps to the viewport today (`menu.js:44-48`); a ~250 px menu opened in the lower third covers the word. Real annoyance, separate decision |
| P4 | Persist `Ignore` with the personal list | ignore is a reading aid; the personal list is a vocabulary. Decide if a user asks |

---

## 9. Acceptance criteria

| # | Criterion | Test |
|---|---|---|
| AC1 | Underlined prose uses `--danger`, wavy, `--spell-underline-thickness` (1.5 px), at `--spell-underline-offset`; no other colour or background is introduced | browser visual assertion, T-SPELL-08 |
| AC2 | A correct word, a word in the personal list, and an ignored word carry no mark | T-SPELL-08 |
| AC3 | Text inside `code`, a fence, a diagram card and the language chip is never marked | T-SPELL-08 |
| AC4 | The Spelling block shows at most 5 suggestions, then a separator, `Add to dictionary`, `Ignore`, then a separator, then `Copy` | T-SPELL-04 |
| AC5 | With no suggestions the block shows the disabled `No spelling suggestions` and both actions | T-SPELL-04 |
| AC6 | With a correct word under the pointer the menu is the existing menu: first item `Copy`, no separator above it | T-SPELL-04 |
| AC7 | Choosing a suggestion clears the mark immediately and the tab shows dirty | T-SPELL-06 |
| AC8 | `Add to dictionary` clears the mark and the word stays clear after reload | T-SPELL-15 |
| AC9 | `Ignore` clears the mark until hybrid exits, and the word is marked again on re-entry | T-SPELL-15 |
| AC10 | The Settings row is in General under `Spelling`, checked by default, with the help line as its description | jsdom T-SPELL-13 |
| AC11 | With the switch off, `#viewer-content` still carries `spellcheck="false"`, the menu has no Spelling block, and `CSS.highlights` has no entry | browser T-SPELL-09 |
| AC12 | A failed load or a missing highlight API removes the `spellcheck` attribute, so the browser's spellcheck is in charge, the prose menu is the browser's, and the matching note shows | browser T-SPELL-09 |
| AC13 | Focus lands on the first suggestion when the block shows, and the focused item carries the inset ring | browser T-SPELL-10 |
| AC14 | The menu host carries `role="menu"` and the label hybrid passes (`Note actions`), and no other surface's menu gains that label | jsdom T-SPELL-13 |
| AC15 | `Add to dictionary` and `Ignore` both return focus and the caret to the page: typing immediately after either lands in the note | browser T-SPELL-15 |
| AC16 | `Shift`+`F10` on a misspelled prose word opens the app menu with the Spelling block, first item focused | browser T-SPELL-14 |
| AC17 | The Personal words editor round-trips: a pasted list saves normalised, the invalid lines are named in the status, and the words stop being marked without a reload | browser T-SPELL-17 |
| AC18 | The shape rules hold: an all-caps acronym, a camelCase identifier, a hyphen compound of known parts, and a possessive of a known stem are not marked; `recieve` still is | host T-SPELL-18 (and browser T-SPELL-08) |

---

## 10. What not to build

- No underline in preview or source mode; no spelling in the CM6 editor.
- No underline on the phone, and no app menu on a long-press.
- No second colour token for the underline; no tinted background behind a
  misspelled word; no icon beside it.
- No group heading or `role="group"` in the menu (P2), no menu tokenisation (P1),
  no flip-above (P3) in this pass.
- No `role="menuitem"` in this pass; that is `controls.md` §3.3 step 11.
- No language picker, no grammar, no "did you mean" sentence rewriting.
- No new menu class, no new switch style, no change to the edit bar.
