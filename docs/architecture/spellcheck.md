# Spellcheck — the dictionary, the underline, and the prose menu

Status: Current contract — shipped. This is the contract `build` implemented; the
visual spec is [`../ui/spellcheck.md`](../ui/spellcheck.md), the requirement is
[`../requirements/features/spellcheck.md`](../requirements/features/spellcheck.md),
and the facts behind the decision are [`../research/spellcheck-context-menu.md`](../research/spellcheck-context-menu.md).

Normative source. This document owns the new module `static/js/spellcheck.js`
(`NB.spellcheck`), the hybrid prose-menu policy, the write path for a correction,
and the two config keys. It does not restate hybrid's write-back contract
([`hybrid-editing.md`](hybrid-editing.md)), the menu module
([`context-menus.md`](context-menus.md)), or the config rulebook
([`../contracts/config-guidelines.md`](../contracts/config-guidelines.md)).
Every claim about current code cites `file:line`.

---

## 1. The decision

Hybrid mode (`#viewer-content` with `contenteditable="true"`) currently lets the
browser's own context menu through on plain prose, and only shows the app menu on
structural targets (`hybrid.js:10355` `isPlainTextTarget`, listener
`hybrid.js:10403-10411`). That split exists because the browser's menu is the only
place the browser's spelling suggestions appear, and no Web API returns them
(`research/spellcheck-context-menu.md` Q1, Q2: WHATWG DOM 547 is open, WebKit
59693 is reopened, no page or extension API opens the native menu).

| # | Decision | Why |
|---|---|---|
| D1 | On desktop hybrid, a right-click on prose opens the app menu; `Shift`+right-click keeps the native menu | the formatting menu becomes reachable where the user types; the native menu stays available as an escape |
| D2 | The app owns en_US spelling: typo-js 2.0.0 plus its `en_US.aff`/`.dic`, loaded on demand | the suggestions must live in our menu, so the dictionary must be ours |
| D3 | With the app owning the surface (desktop hybrid, switch on, the load not failed), `spellcheck="false"` is set on the editing root and the app draws the misspelling underline itself | one dictionary owns the verdict, the underline and "Add to dictionary"; two owners would disagree and neither could clear the other's mark |
| D4 | The underline is painted with the CSS Custom Highlight API, not DOM decoration | zero DOM mutation, so serialization, snapshots and the block-splice cache cannot see it |
| D5 | Ignore is session-scoped; Add to dictionary persists to `config.json` | ignore is a reading aid, the dictionary is a user vocabulary |
| D6 | One Settings switch, default on, covers underline, menu block and the browser's spellcheck | "off" must be genuinely off; a switch that leaves a second spellchecker running is a lie |
| D7 | The phone keeps today's behaviour: native menu, native spellcheck, no app underline | no `Shift` on touch; the long-press menu carries Android's own selection actions |
| D8 | Preview and CodeMirror source mode are unchanged | no menu surface exists there today (`context-menus.md` §4; `cm-bridge.js` registers no `contextmenu` handler) |
| D9 | The personal list is editable in Settings (one word per line), and four technical shapes are accepted without a dictionary hit (§4.1) | a general dictionary cannot know the notebook's vocabulary; the user owns the list, and the shapes remove the mechanical noise so the list only carries real terms |

Not in scope: languages other than en_US, grammar, suggestions in source mode,
persisting the ignore list, a visual editor for the personal dictionary.

---

## 2. The module

`static/js/spellcheck.js`, IIFE, publishes `NB.spellcheck`. Load order: a
deferred `<script>` tag after `menu.js` (`index.html:2078`; it produces menu
descriptors) and in the same position in `frontend.md`'s chain, before the
renderers. The module itself is precached; the vendor script and the dictionary
are fetched on demand, the script through `NB.lazyload.scripts` (`api.js:284-321`).

Purpose: turn a pointer position or a word into a spelling verdict and a
correction list, and paint the underline. It never writes prose.

MUST NOT: mutate text nodes, touch the selection, call `onContentChange`, own
undo history, decide when a menu opens, or know about hybrid's DOM.

State it owns, and its lifetime:

| State | Type | Lifetime |
|---|---|---|
| `state` | `"idle" \| "loading" \| "ready" \| "failed"` | module |
| `dict` | the `Typo` instance | module, cached across hybrid sessions |
| `root` | the editing element (`#viewer-content`) | one hybrid session (`enter` → `exit`) |
| `sessionIgnored` | `Set<string>`, lower-cased | one hybrid session |
| `pendingRefresh` | a `setTimeout` handle or an idle handle | one pass |

### 2.1 PROVIDES

```js
NB.spellcheck.state()            // -> "idle" | "loading" | "ready" | "failed"
NB.spellcheck.enter(root)        // begin a session; starts the load if needed
NB.spellcheck.exit()             // end a session; clears the registry and timers
NB.spellcheck.refresh(opts)      // { immediate?: boolean } — re-walk and repaint
NB.spellcheck.wordAtPoint(x, y)  // -> { node, start, end, word } | null
NB.spellcheck.wordAtCaret()      // -> the same hit from the current selection
NB.spellcheck.check(word)        // -> true | false | null  (null = not checkable)
NB.spellcheck.suggest(word, n)   // -> string[] (≤ n, best first)
NB.spellcheck.menuItems(hit, cb) // -> NB.menu descriptors, or [] (see below)
```

| Function | Purpose | Preconditions | Postconditions | Side effects | Failure |
|---|---|---|---|---|---|
| `state()` | report the dictionary lifecycle | — | one of the four states | none | — |
| `enter(root)` | bind a session and start the load | `root` is the live editing element | `state()` moves to `loading` (then `ready`/`failed`); an initial pass runs when ready; the `spellcheck` attribute is set per §3.1 | injects the vendor script and fetches the two dictionary files once per page | the promise chain rejects internally; `state()` becomes `failed`; never throws at the caller |
| `exit()` | unbind | — | no registry entry, no timer, no idle handle, `root` null; `dict` retained | `CSS.highlights.delete("nb-spelling")`, guarded (`if (window.CSS && CSS.highlights)`) | idempotent |
| `refresh(opts)` | repaint the underline | a session is bound | the registry holds exactly the current misspelled ranges | ~200 ms trailing debounce; `immediate` skips it; the pass runs in `requestIdleCallback` when available | no session → no-op |
| `wordAtPoint(x,y)` | resolve the word under a pointer | — | `{node,start,end,word}` or `null` | none | `null` when the caret APIs are missing (jsdom), on whitespace, or when the target is excluded |
| `wordAtCaret()` | resolve the word at the selection anchor | a selection inside `root` | the same shape, or `null` | none | `null` outside `root`, on whitespace, or on an excluded target |
| `check(word)` | verdict | `state() === "ready"` for a real verdict | `true`/`false`; `true` also when `isKnownWord` accepts the shape (§4.1) or the word is in `spellcheckWords`/`sessionIgnored`; `null` if not ready or not checkable | none | — |
| `suggest(word,n)` | ranked corrections | same | `string[]`, best first, ≤ n | none | `[]` when not ready |
| `menuItems(hit,cb)` | descriptors for the Spelling block | a non-null `hit`; `cb = { pick(replacement), done() }` from hybrid | `[]` unless `state() === "ready"` and the word is checkable, unknown, and absent from `spellcheckWords` and `sessionIgnored`; otherwise suggestions (up to 5), separator, `Add to dictionary`, `Ignore` | suggestion items call `cb.pick`; `Add to dictionary` writes config, then `refresh({immediate:true})` and `cb.done()`; `Ignore` writes the session set, then the same two calls | a config write failure keeps the word in the session dictionary (`app.js:1048` already warns) |

`cb.done()` is hybrid's "the menu is gone, put the caret back and focus the page"
(`restoreCaret()` + `viewerContentEl.focus()`, `hybrid.js:7336`). The module never
touches the selection; it only calls back.

The module emits `NB.evt` `"spellcheck:state"` with the new lifecycle string after
every transition. It is the only notification: hybrid uses it to flip the
`spellcheck` attribute when the load settles, and Settings uses it to update the
note.

Context: browser main thread, synchronous except the load. No reentrancy
requirements. Timing: `check`/`suggest` are dictionary lookups (typo-js memoizes
per word); `refresh` is bounded by the note's word count and runs at idle.

### 2.2 REQUIRES

- `NB.lazyload.scripts(srcs)` — load `/static/vendor/typo.js` once
  (`api.js:284-321`).
- `NB.app.getCfg()` / `NB.app.setSpellcheckWords(words)` — read the switch and the
  personal list; both are call-time reads (app.js loads last).
- `NB.evt.on("config:changed", …)` — apply a remote toggle live
  (`app.js:578`, `:803`).

### 2.3 OWNS

The `CSS.highlights` registry entry `"nb-spelling"`, the two dictionary files'
fetch, the session ignore set, and the `--spell-underline-offset` consumer (the
token is declared by the UI doc).

### 2.4 INVARIANTS

1. Exactly one spellchecker can be off, and the `spellcheck` attribute says which:
   the app owns the surface and sets `false` while hybrid is active on desktop and
   the feature has not failed; the user turned the feature off and the attribute is
   `false` too, with nothing painting (off means off); the feature failed and the
   attribute is removed, so the browser's spellcheck returns. On the phone the
   attribute is never touched.
2. `refresh` mutates no DOM. Nothing it does can reach `domToMarkdown`, a history
   snapshot, the change hash or the block-splice cache (`hybrid.js:288-293` hashes
   source, not paint).
3. Every `innerHTML` replacement invalidates every range; a refresh follows each
   one (§3), and `exit()` clears the entry.
4. A spelling hit is only valid for a connected node whose substring still equals
   the captured word.
5. The module graph is acyclic: `hybrid → spellcheck → app`; `app` requires
   neither.
6. A failed load degrades the feature to off for the session; there is no retry
   loop.

### 2.5 ERRORS

| Condition | Detection | Behaviour |
|---|---|---|
| `typo.js` fails to load | the loader (`NB.lazyload.scripts`) rejects | `state = "failed"`, console warn, no retry until the next `enter()` |
| dictionary fetch fails (404 / offline first use) | fetch rejects | same |
| `new Typo(...)` throws (malformed `.aff`/`.dic`) | `try/catch` inside the loader | same; the throw never escapes into `enter()` |
| `CSS.highlights` or `Highlight` missing | feature detect at `enter()` | `state = "failed"` before loading; browser spellcheck stays on |
| `Add to dictionary` POST fails | `saveConfig` catch (`app.js:1048`) | the word stays active for the session; the next successful persist carries it |
| stale node at pick time | `isConnected` + substring check | silent abort: no dirty, no snapshot, no write |

### 2.6 RESOURCES

Dictionary assets: the vendor script, `en_US.aff` 3,090 B, `en_US.dic` 551,762 B
and `softwareTerms.txt` 29,896 B (research Q3 for the first two; the exact
vendored sizes and hashes are in `NOTICE`). Not precached (§9). Memory is
proportional to the `.dic` stem map (≈ 50k stems) plus a ≈3,200-entry Set, and
stays resident after the first hybrid session.

---

## 3. Lifecycle on the hybrid side

| Moment | Code | Call |
|---|---|---|
| `enter()` completed its normalization and `resetHistory()` | `hybrid.js:7996-8023` | `NB.spellcheck.enter(viewerContentEl)`; the attribute follows §3.1 |
| a content change | `hybrid.js:7362` `onContentChange` | `NB.spellcheck.refresh()` in the function body — not in `scheduleSnapshot`, which no-ops while `restoring` |
| undo / redo | `hybrid.js:7450` `restoreSnapshot` → `innerHTML` `:7452` | covered: `restoreSnapshot` calls `onContentChange()` at `hybrid.js:7500` (`restoring = true` stops only `scheduleSnapshot`, `:7433`), so the refresh hook must sit in `onContentChange`'s body, not in `scheduleSnapshot` |
| conflict rebuild | `hybrid.js:8340` `rebuildFromSaved` | `refresh({immediate:true})` — this path does not call `onContentChange` |
| AI patch re-render | `hybrid.js:10530` `refreshFromContent` | `refresh({immediate:true})` |
| `exit()` | `hybrid.js:8046`, attribute removal `:8099` | `NB.spellcheck.exit()` beside the `contenteditable` removal, before the preview re-render |
| note switch while active | `commitForTabSwitch` → `exit()` | the same teardown; a pick that races it aborts by invariant 4 |

`CSS.highlights` is document-global: the registry entry survives an `innerHTML`
replacement, but its ranges then point at detached nodes. The entry must be
replaced, not appended to, on every pass; `exit()` deletes it.

### 3.1 Routing and the `spellcheck` attribute

One test decides which menu opens on a right-click under `#viewer-content`; the
module owns the attribute, hybrid owns the branch.

```
appOwns = desktop && !phone && setting on && CSS.highlights && Highlight
          && state() !== "failed"
```

| State | `#viewer-content` `spellcheck` | Prose right-click | Spelling block |
|---|---|---|---|
| hybrid active, `appOwns`, `state() === "ready"` | `"false"` | app menu (`preventDefault`) | from `menuItems` |
| hybrid active, `appOwns`, `state() === "loading"` | `"false"` | app menu | none (the dictionary is not ready) |
| hybrid active, setting on, load failed | attribute removed | browser menu, no `preventDefault` | none |
| hybrid active, setting on, no highlight API | attribute removed | browser menu, no `preventDefault` | none |
| hybrid active, setting off | `"false"` | browser menu, no `preventDefault` | none |
| `Shift` held on a pointer right-click, `appOwns` | unchanged | browser menu: hybrid returns **before** `preventDefault` | n/a |
| phone | untouched (default on) | browser long-press menu | none |

On the phone the module is never entered (`enter()` is skipped), so the dictionary
is not fetched there and `state()` stays `idle`; `exit()` still runs and is
idempotent.
| preview / source mode | untouched | no app listener | none |

The escape branch is explicit and narrow, because `shiftKey` is also true for
`Shift`+`F10` and the Menu key (which report `clientX/Y === 0` and must keep the
app menu): `e.button === 2 && e.shiftKey && (e.clientX || e.clientY)`. Chromium
fires `contextmenu` on `Shift`+right-click and honours the early return; Firefox
does not fire the event for that gesture, so its native menu appears without the
branch running. Both are asserted in the browser suite (§10, T-SPELL-10), not
assumed.

Transitions that apply or remove the attribute, all on `root`:

1. `enter()` — apply per the table.
2. the load settles (`ready` / `failed`) — apply or remove.
3. the switch changes while hybrid is active, including a remote
   `config:changed` — apply or remove.
4. `exit()` — remove; the preview DOM is reused, so a stale `false` would follow
   the note into read mode.

One change reaches `NB.menu`: `open({label})`, an optional accessible name stored
with the owner and applied to the shared host at open. Hybrid passes
`"Note actions"`; the tree, tab, sessions and bookmarks menus pass nothing and keep
their current markup. `menu.js` changes nowhere else.

---

## 4. The target predicate

One predicate, used by the underline pass and the menu. A hit requires all of:

| Rule | Reason |
|---|---|
| the caret APIs (`caretRangeFromPoint` / `caretPositionFromPoint`) resolve to a text node inside the editing root | no pointer → no word; jsdom has neither and returns `null` |
| the whole word lies inside that one text node | a word split by inline markup (`un<em>believ</em>able`) is refused rather than guessed: a token is dropped when its neighbouring character or sibling text node continues a word run, and a period only glues when it looks like an extension (`file.txt`), not a sentence end |
| the caret or pointer offset falls inside the token (`start <= offset < end`) | a click past the last letter resolves to the next word or to nothing, never to the word behind it |
| the token matches `[A-Za-z][A-Za-z'’\-]*[A-Za-z]` (single letters and all-caps tokens allowed) | ASCII-only en_US; interior hyphen accepted (`mother-in-law`); digits, `_`, `/`, `@`, `.` refused, which rejects `I2C` and `0x20`; a correct-looking acronym such as `SCPI` is checked and may be a false positive the personal list handles |
| the token is not inside `code`, `pre`, `kbd`, `[contenteditable="false"]`, an image, or a plugin container | literal content and rendered blocks are not prose |
| the pointer is not on whitespace between words | the word under the pointer is the target, never a neighbour |

Deliberately **not** excluded: link text (`a`) and table cells (`td`/`th`). Link
labels and cell text are prose that serializes to Markdown; excluding them would
hide real misspellings. `NATIVE_MENU_BLOCKED_SELECTOR` (`hybrid.js:307-310`) keeps
its own, wider meaning for the native-menu policy and is not reused as this
predicate; the two lists differ by design (cells and links).

The check receives the word normalised: a curly apostrophe (U+2019) is mapped to
`'` before `check`/`suggest`, and `Typo.check` accepts capitalization variants
(research Q3, README). The `.aff` carries an `ICONV ’ '` table, but the module does
not depend on it: extraction accepts `’` as part of the token, the module folds it
before the lookup, and a chosen suggestion is written in the dictionary's form
(ASCII apostrophe).

`wordAtCaret()` applies the same rules to `window.getSelection()`'s anchor node and
offset. It is the keyboard route (`Shift`+`F10` / the Menu key on prose) and returns
`null` whenever the selection is outside `root` or the anchor is not a text node.

### 4.1 What counts as known

A general dictionary flags a technical notebook's own vocabulary. The module
therefore checks every source and shape in this table before it accepts a
dictionary miss (one helper, `isKnownWord`, used by the underline pass and by
`check`):

| Source / shape | Rule | Example |
|---|---|---|
| personal or ignored word | present in `spellcheckWords` or `sessionIgnored` | `fsm` added by the user |
| software terms | present in the vendored cspell software-terms list (≈3,200 entries) | `linter`, `bootloader`, `config` |
| the note's code vocabulary | the token appears inside `code`, a fence or a rendered block in this note | `rankdir`, `const`, `svg` |
| acronym | all letters upper-case, 2+ letters | `SCPI`, `MOSFET`, `README`, `GFM` |
| identifier | an upper-case letter after the first character (camelCase, PascalCase, `WaveDrom`) | `getElementById`, `securityLevel`, `KaTeX` |
| hyphen compound | split on `-`; every part of 2+ letters is known by the sources above or the dictionary | `html-live`, `box-shadow`, `re-entrant` |
| possessive | a trailing `'s` / `’s` is stripped and the stem checked | `MOSFET’s`, `Zephyr's` |
| inflection | strip one or two of `-s`, `-es`, `-ies→y`, `-ed`, `-ied→y`, `-ing`, `-er`, `-est`, `-ly`, with the doubled-consonant forms, and check the base | `subfolders`, `flashed`, `APIs`, `renderers` |

A token with digits, `_`, `/`, `@` or `.` never reaches this step (§4 refuses it),
so `I2C`, `0x20` and `I2C_ADDR` are neither marked nor offered.

Measured on eight notes of a technical notebook: 58 flagged words before these
sources, 34 with the software terms, 25 with the note's code vocabulary, 22 with
inflections. The 22 that remain are CSS/embedded/LaTeX terms, product names, and
one real typo — the personal list's job.

The rules are deliberately narrow: a real typo in lower case (`recieve`,
`firmwar`) or a capitalised one (`Recieve`) is still flagged, and an inflection of
a typo (`recieved`) never resolves to a known base. The cost is accepted: an
all-caps typo (`TEH`) is treated as an acronym and not marked.

Every source and shape goes through one function, so the underline and the menu
can never disagree about a word.

---

## 5. The write path

`hybrid.js` owns the write, because the ordering it needs is undo-history policy
and the history internals are module-local (`historyTimer`, `pushSnapshot`,
`scheduleSnapshot` — `hybrid.js:7404`, `:7419`, `:7433`). The suggestion
descriptors pass `cb.pick = (word) => fixWord(hit, word)`; the module's own two
items call `refresh` and `cb.done()` themselves (§2.1).

`fixWord(hit, replacement)`, in this exact order:

| # | Step | Why the order matters |
|---|---|---|
| 1 | revalidate: `hit.node.isConnected && viewerContentEl.contains(hit.node) && hit.node.data.slice(hit.start, hit.end) === hit.word` | a note switch, an undo or an external rebuild may have replaced the DOM while the menu was open; writing blind would dirty a document that does not hold the word |
| 2 | flush a pending history timer: `if (historyTimer) { clearTimeout(historyTimer); historyTimer = null; pushSnapshot(); }` (the `undo()` pattern, `hybrid.js:7508`) | commits the pre-fix DOM as its own undo step |
| 3 | replace through a `Range` over the text node and put the collapsed caret after the replacement | the menu closes before the handler runs (`menu.js:120`), so the selection is no longer in the page; `restoreCaret()` restores the pre-menu range and is the wrong tool |
| 4 | `viewerContentEl.focus()` | the menu button held focus; without this the next keystroke is swallowed |
| 5 | `onContentChange({ snapshotNow: true })` — one new `opts` flag that calls `pushSnapshot()` instead of `scheduleSnapshot()` | marks dirty, arms autosave, refreshes the debug pane and the underline, and records exactly one undo step |
| 6 | `NB.spellcheck.refresh({ immediate: true })` | the fix removes the underline at once (the `onContentChange` hook also fires; the immediate pass wins) |

Wrong order, observed failures:

| Deviation | Bug |
|---|---|
| `scheduleSnapshot()` (the default) | the 400 ms timer resets on the fix's own change, so the pre-fix DOM is never captured: one undo reverts the typing *and* the fix |
| immediate push without flushing first | the stale timer fires later and pushes the same state twice; undo needs two presses |
| `onContentChange` before the write | dirty and autosave arm against the pre-fix DOM, and the generated debug output shows the uncorrected text |
| write to a detached node | a stray dirty flag and a snapshot of an unchanged document |

The `snapshotNow` flag is the only change to `onContentChange`; every existing
caller keeps its behaviour.

---

## 6. The underline pass

1. `refresh` first collects the note's code vocabulary: one `TreeWalker` pass
   over the text nodes under `root` that sit in an excluded subtree (`code`, a
   fence, a rendered block), lower-cased into a session set.
2. `refresh` walks the text nodes under `root` again for prose.
3. For each prose node: refuse if an ancestor is in the predicate's exclusion set; split
   on the token rule; `check` each token that is not in `config.spellcheckWords`
   (lower-cased) and not in `sessionIgnored`.
4. Build one `Range` per misspelled token and register
   `CSS.highlights.set("nb-spelling", new Highlight(...ranges))` — replacing the
   previous entry. No ranges → `CSS.highlights.delete("nb-spelling")`.
5. Debounce ≈ 200 ms, trailing, then a `requestIdleCallback` hop. `immediate`
   skips both, because a correction and a switch toggle must clear the mark
   before the next paint. It is not `HISTORY_COALESCE_MS` (400): paint
   granularity and undo granularity are different concerns.
6. IME: no pass while composing; the pass relies on `onContentChange`, which already
   waits for `compositionend` (`hybrid-mode.md` §2.5).

The pass is O(words) per change with memoized dictionary lookups. If a future note
size makes this measurable, the fix is a per-block dirty set, not a different API.

---

## 7. Config

Two keys in `config.json`, both global user preferences (not workspace-scoped
state: `app.py:1978-1979` strips only the state and workspace-scoped keys, so both
round-trip through `GET/POST /api/config` with no server change and no new
validation).

| Key | Type | Default | Written by | Read by |
|---|---|---|---|---|
| `spellcheck` | boolean | `true` | the Settings switch | `enter()`, the `contextmenu` branch |
| `spellcheckWords` | array of strings | `[]` | `Add to dictionary` | `refresh`, `check` |

Normalisation happens in `app.js` `applyConfig` and the setter, matching the
existing precedent (`app.js:536-545`): trim, lower-case, dedupe, fold a curly
apostrophe to `'` (so a stored word matches the module's lookup), refuse a word
longer than 64 characters or containing characters outside the token rule, cap the
list at 1,000 entries (oldest dropped). `DEFAULTS` (`app.js:54-175`) gains both
keys; `setSpellcheck`/`getSpellcheck` and
`setSpellcheckWords`/`getSpellcheckWords` follow the existing setter pattern
(`app.js:1819-1834`).

`POST /api/config` is admin-only (`app.py:1959`) and hybrid requires a writable
role, which in this app is the admin session; a viewer or read-only session never
enters hybrid and never reaches either write. No error branch is needed for a
non-admin Add.

No `boot_state` entry: nothing is needed before first paint.

### 7.1 The Personal words editor

The list is user-editable in Settings → General → Spelling
([`../ui/spellcheck.md`](../ui/spellcheck.md) §3). The editor is the second writer
of `spellcheckWords`; `Add to dictionary` is the first. Both go through
`NB.app.setSpellcheckWords()`, so there is one normaliser and one source of truth.

| Aspect | Rule |
|---|---|
| Control | a 10-row mono textarea, one word per line, plus Save and a status line (the VIM-script pattern in the same tab) |
| Read | the textarea is filled from `getSpellcheckWords()` every time Settings opens, and on a `config:changed` that lands while it is open **and the textarea has no unsaved edit** (a remote save must not wipe typing in progress) |
| Write | split on line breaks, trim, drop empty lines, then `setSpellcheckWords(lines)` — **replace**, never append |
| Validation | the same rules as §7 (lower-case, dedupe, 64 characters, token rule, 1,000 cap); invalid and duplicate lines are reported, never silently dropped |
| Status copy | `Saved N words.` · `Saved N words; M ignored: a, b, c.` (3 names, then `+K more`) · `Saved 1,000 words; K dropped (the list is capped at 1,000).` · `Save failed: <message>` |
| Repaint | `config:changed` reaches an open hybrid session, which repaints at once; no reload |
| Failure | a failed POST keeps the textarea content and shows the failure line; the in-memory list still applies for this page (`app.js:1048`) |
| Order | the editor does not sort; the list keeps the order the user typed, newest last, which is the order `Add to dictionary` appends to |

There is no per-row delete, no import/export, and no per-workspace list: editing
the text is the delete path, and the list is one global preference like every
other key in `config.json`.

---

## 8. Failure matrix

| Failure | Underline | Menu on prose | Browser spellcheck | Setting |
|---|---|---|---|---|
| dictionary loading (the first moment after `enter`) | none yet | app menu, no Spelling block | off (the app owns the surface) | on |
| dictionary failed | none | **browser menu** | **on** (attribute removed) | on, with a note |
| `CSS.highlights` missing | none | **browser menu** | **on** | switch disabled with a note |
| setting off | none | **browser menu** | **off** (off means off) | off |
| phone | none | browser long-press menu | on | row absent |
| config POST fails on Add | unchanged | word applies now | off | — |

"The app menu with no Spelling block" is today's hybrid menu, unchanged.

---

## 9. Service worker and vendoring

- `static/vendor/typo.js`, `static/vendor/dictionaries/en_US/{en_US.aff,en_US.dic}`
  and `static/vendor/dictionaries/softwareTerms.txt` are vendored, not fetched
  from a CDN (the app makes no third-party requests at runtime).
- No `PRECACHE` entry for any of the four: `sw.js:69-75` states the policy for
  heavy on-demand bundles — install cost is deliberately kept down and the
  network-first handler mirrors them into the cache, so offline works after first
  use. `CACHE` (`sw.js:68`) is **not** bumped for this change.
- `spellcheck.js` itself **is** precached (an app module missing from the list
  breaks offline, `context-menus.md` §4.4); `CACHE` bumps v33 → v34 for that one
  entry, with the reason in the sw.js comment block (`sw.js:65-67` pattern).
- `static/vendor/NOTICE` gains one entry per bundled file: typo-js version 2.0.0
  with its BSD-3-Clause claim (its own repo ships no LICENSE file — record that),
  the dictionary's identity (en_US Hunspell Dictionary 2020.12.07, SCOWL size 60)
  and its own licence text copied from the bundled
  `dictionaries/en_US/README.md`. The decode is UTF-8: `en_US.aff` declares
  `SET UTF-8`, so the files are read with `fetch` + `text()` and passed to
  `new Typo("en_US", affData, dicData)`; the library's own loader is not used.

---

## 10. Verification

Test layers: `tests/static/` (a jsdom-hosted module suite,
`node tests/static/test_spellcheck.js`), `tests/dom/test_dom.js` (jsdom: no caret
API and no `CSS.highlights`, so it proves the degraded path, the teardown and
config normalisation — the descriptor shape is browser-only, because `menuItems`
returns `[]` until the dictionary is ready), and
`tests/browser/test_hybrid_browser.js` (the real path: hit-test, underline, menu
block, replacement, undo, both Chromium and Firefox).

| Clause | Proof | Test |
|---|---|---|
| §4 predicate: whitespace, digits, split words, exclusions | host unit | T-SPELL-01 |
| §2 `check`/`suggest` against the vendored dictionary, curly apostrophe folded | host unit | T-SPELL-02 |
| §7 normalisation: case, dedupe, 64-char and 1,000-entry caps | host unit | T-SPELL-03 |
| §2 `menuItems`: shape, 5-suggestion cap, correct-word → `[]`, `[]` when not ready, disabled "No spelling suggestions", `cb.done()` after Add/Ignore | browser | T-SPELL-04 |
| §3 teardown: `exit()` does not throw, leaves no registry entry, no timer, no idle handle | jsdom | T-SPELL-05 |
| §5 write path: fix marks dirty, is one undo step, caret lands after the word | browser | T-SPELL-06 |
| §5 revalidation: switch note with the menu open, then pick → no write | browser | T-SPELL-07 |
| §6 underline: a misspelled word gets a range, a correct one does not, `code` never does | browser | T-SPELL-08 |
| §8 failure: blocked dictionary → attribute removed, browser spellcheck back, browser menu on prose | browser | T-SPELL-09 |
| §3.1 routing: prose → app menu; `Shift`+pointer → no `preventDefault`; `Shift`+F10 → app menu | browser, both engines | T-SPELL-10 |
| D7: phone long-press keeps the native menu and the attribute | browser (mobile suite) | T-SPELL-11 |
| D8: preview and source mode unchanged | browser (existing suites) | T-SPELL-12 |
| jsdom degraded path: no caret API, no highlight registry, `spellcheck` attribute untouched; the Settings row and its label wiring; the menu `label` option is per-surface | jsdom | T-SPELL-13 |
| §4 `wordAtCaret` + `Shift`+F10 on prose lands focus on the first suggestion | browser | T-SPELL-14 |
| D5: Add survives a reload; Ignore does not survive a re-entry | browser | T-SPELL-15 |
| §7 switch: writes `spellcheck`; a remote `config:changed` applies live in hybrid | browser | T-SPELL-16 |
| §7.1 editor: paste → Save → normalised list stored; rejected lines named; open note repaints; empty Save clears | browser | T-SPELL-17 |
| §4.1 shapes: acronym, identifier, hyphen compound of known parts, possessive; a lower-case typo still flagged | host unit | T-SPELL-18 |

Unverified at design time: typo-js `suggest()` ranking quality against Hunspell
(no benchmark exists — research Q3), and Firefox's `Shift`+right-click path (MDN
says the event is not fired; the research pack did not examine Firefox, so the
browser suite checks it in both engines). Both are recorded, not assumed.

Browser floor: `CSS.highlights` and `::highlight()` need Chromium ≥ 105 and
Firefox ≥ 140 (Baseline since March 2026). Both harness browsers meet it; the
feature degrades to the browser's spellcheck below it, and the Settings note says
so.

---

## 11. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | typo-js 2.0.0 is four days old at design time (2026-11-16) and rewrote the load path | pin exactly 2.0.0, vendor the classic script, call the documented data constructor, and cover check/suggest in a host test so an upgrade is a deliberate change |
| R2 | two dictionaries disagree on technical vocabulary (`Zephyr`, `MOSFET`) | one owner (D3): the app's verdict is the only one shown; `Add to dictionary` clears the mark immediately |
| R3 | a large note makes the pass measurable | debounce at idle; a per-block dirty set is the planned fix if it is ever felt |
| R4 | the menu clamp grows by the Spelling block (~5 rows) | accepted; a flip-above rule is a proposal in the UI doc |
| R5 | a browser without `CSS.highlights` (or jsdom) silently loses the feature | explicit degrade to the browser's spellcheck with a Settings note, never a half-on state |
| R6 | the personal list grows without bound | 1,000-entry cap, oldest dropped, normalised on read |

Open questions: none blocking. Deferred by decision: non-en_US dictionaries, a UI
to edit the personal list, suggestions in source mode, and persisted ignore.
