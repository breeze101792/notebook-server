# Hybrid (WYSIWYG) editing shortcuts — functional spec

Status: draft for review. Owner: `product-designer`.
Applies to: `static/js/hybrid.js` (dispatch), `static/js/editbar.js` +
`templates/index.html` (tooltips), `static/js/settings.js` (read-only list),
`tests/dom/test_dom.js`, `tests/browser/test_hybrid_browser.js`.

Related: [hybrid-editing](../architecture/hybrid-editing.md) owns construct and
write-back behavior; this document owns only the keyboard surface. Where this
document and that one disagree about a construct, that one wins.

## 1. Purpose and user goal

> **A user editing in hybrid mode should be able to format the way they do in any
> mainstream editor — the chords they already know from Typora, Notion, Google
> Docs, and VS Code — without leaving the rendered view.**

Today hybrid ships four inline chords (bold, italic, strikethrough, inline code)
plus undo/redo and table/list move arrows. The block and inline constructs the
edit bar can produce (headings, lists, quote, code block, rule, clear formatting)
have no keyboard path, and the one chord every Markdown editor shares — **Mod+K
for a link** — is missing. This spec closes that gap.

It does not add features or change how any construct serializes; every action
below maps to a transform that already exists behind an edit-bar button.

## 2. Scope and non-goals

**In scope.** Keyboard shortcuts that act only while hybrid mode is active and
the caret/selection is inside `#viewer-content`: inline emphasis and link, block
types (heading, paragraph, quote, lists, code block, horizontal rule), and clear
formatting. Their semantics, refusal cases, the link flow, discoverability, and
acceptance criteria.

**Non-goals.**

- Source (CodeMirror) mode and preview mode. The edit bar already formats in
  source mode; extending the CM6 keymap is a separate change.
- Remapping these chords per user (see §6).
- New Markdown constructs, new rendering, or any new dependency.
- Multi-cursor, IME-composition, or tablet/touch input behavior beyond what the
  existing shortcuts already do.

## 3. The shortcut set

`Mod` is Cmd on macOS and Ctrl elsewhere (the existing `NB.shortcuts`
convention). Chords are stored and matched on `e.code`, not `e.key` — see §4.4.

### 3.1 Inline (selection-scoped)

| Chord | Action | Markdown output | Caret / selection behavior | Refusal |
|---|---|---|---|---|
| `Mod+B` | Bold | `**text**` | existing | cross-block, or in a code block |
| `Mod+I` | Italic | `*text*` | existing | cross-block, or in a code block |
| `Mod+Shift+X` | Strikethrough | `~~text~~` | existing | cross-block, or in a code block |
| `Mod+Shift+C` | Inline code | `` `text` `` | existing | cross-block, or in a code block |
| `Mod+K` | Link | `[text](url)` | §5 | cross-block, or in a code block |

The four existing rows are listed for completeness; their chords and behavior do
not change.

### 3.2 Block (paragraph-scoped)

Each acts on the top-level block(s) the selection touches; a collapsed caret
means its own block. Each is idempotent — pressing it again returns the block to
plain text where the construct toggles (lists, quote, code block), or sets the
level where it does not (headings).

| Chord | Action | Markdown output | Toggle-off |
|---|---|---|---|
| `Mod+Shift+7` | Ordered list | `1. text` | item already ordered → plain paragraph |
| `Mod+Shift+8` | Bulleted list | `- text` | item already bulleted → plain paragraph |
| `Mod+Shift+9` | Task list | `- [ ] text` | item already a task → plain paragraph |
| `Mod+Shift+.` | Blockquote | `> text` | block already quoted → lift out |
| `Mod+Alt+1` … `Mod+Alt+6` | Heading 1–6 | `# `…`###### ` | press the current level → plain paragraph (same as `Mod+Alt+0`) |
| `Mod+Alt+0` | Paragraph | plain text | removes heading/list/quote markers; inline emphasis is kept |
| `Mod+Alt+C` | Code block | fenced ` ``` ` block | caret inside a code block → plain paragraph |
| `Mod+Alt+R` | Horizontal rule | `---` on its own line | rule is a void block; delete with Backspace/Delete, not the chord |
| `Mod+\` | Clear formatting | markers + inline emphasis removed | n/a (one-way) |

Canonical serialization padding (`-   a`, `1.  a`, `- [x] a`) is owned by
[hybrid-editing](../architecture/hybrid-editing.md) Appendix A; the table shows
the Markdown construct, not the padded bytes.

### 3.3 Benchmark

| Construct | Typora | Google Docs | Notion | Our choice | Why |
|---|---|---|---|---|---|
| Link | Ctrl+K | Ctrl+K | Cmd/Ctrl+K | `Mod+K` | Universal; no collision. |
| Bold / Italic | Ctrl+B / Ctrl+I | Ctrl+B / Ctrl+I | Cmd+B / Cmd+I | unchanged | Already shipped. |
| Clear formatting | Ctrl+\ | Ctrl+\ | — | `Mod+\` | Two editors agree; no collision. |
| Ordered list | Ctrl+Shift+[ | Ctrl+Shift+7 | Cmd+Opt+7 | `Mod+Shift+7` | Google Docs web convention. |
| Bulleted list | Ctrl+Shift+] | Ctrl+Shift+8 | Cmd+Opt+8 | `Mod+Shift+8` | Google Docs web convention. |
| Checklist | — | Ctrl+Shift+9 | Cmd+Opt+9 | `Mod+Shift+9` | Google Docs web convention. |
| Code block | Ctrl+Shift+K (Cmd+Opt+C on mac) | — | Cmd+Opt+Shift+8 | `Mod+Alt+C` | Typora's macOS binding; avoids Firefox's Ctrl+Shift+K (Web Console). |
| Headings | Ctrl+1…6, Ctrl+0 | Ctrl+Alt+1…6 | Cmd+Opt+1…3 | `Mod+Alt+1…6`, `Mod+Alt+0` | Browsers reserve Ctrl+1…8 for tab switching, so the native-app chord cannot be used. |
| Blockquote | Ctrl+Shift+Q | — | — | `Mod+Shift+.` | `Mod+Shift+Q` is macOS "Log Out" (system-reserved); app-chosen chord. |
| Horizontal rule | — (type `---`) | — (type `---`) | — (type `---`) | `Mod+Alt+R` | No editor convention; app-chosen. |

Two deliberate departures from a vendor: headings use `Mod+Alt` not `Mod+1…6`
(browser tab keys), and quote avoids `Mod+Shift+Q` (macOS system key).

## 4. Semantics

### 4.1 Inline operations

- **Non-collapsed selection inside one block.** Wrap the selection in the target
  element. If the selection's start already sits inside that element, unwrap it
  (toggle off). Keep the wrapped text selected so a second press toggles again.
- **Collapsed caret, not already inside the element.** Insert an empty element
  and put the caret inside it, so the next typed characters are styled (the
  existing Typora-style `toggleInline` behavior). Pressing the chord again with
  the caret still inside the empty element unwraps it.
- **Collapsed caret inside the element.** Unwrap (toggle off).
- **Empty paragraph.** Same as a collapsed caret: an empty element is created
  and the caret placed inside it.
- **Mid-line.** Selection-only; a collapsed caret creates the element at the
  caret and typing continues styled.
- **Inside a table cell.** Allowed. A cell holds a paragraph, and the cell-local
  inline run toggles exactly as in the body.
- **Inside a code block (`<pre>`) or an atomic plugin block.** Refused. Formatting
  is not representable inside code. Notify: *"Formatting isn't available inside a
  code block"* (new message). No DOM change, no dirty flag.
- **Cross-block selection.** Refused with the existing message: *"Inline
  formatting needs a selection inside one block"*.

### 4.2 Block operations

- **Collapsed caret.** Act on the block containing the caret, exactly as the
  matching edit-bar button does today.
- **Selection spanning one or more top-level blocks.** Apply the operation to
  every top-level block the selection touches, each independently. This matches
  Word, Google Docs, and Typora (format the selection, not the caret). For lists,
  the per-item rule of [hybrid-editing §4.7.1](../architecture/hybrid-editing.md)
  applies to each touched item, and a block already entirely of the pressed type
  toggles off (the source-mode `listAction` contract, so the two modes agree).
- **Headings.** `Mod+Alt+N` sets the level on every touched block;
  `Mod+Alt+0` removes any heading/list/quote marker and leaves a paragraph. A
  heading-to-heading change keeps the text and its inline runs.
- **Empty block.** Lists create an item with a rendered marker (the existing
  zero-width-space placeholder); headings create an empty heading with a caret
  line box; code block creates an empty fence with the caret inside.
- **Code block (`Mod+Alt+C`).** A selection moves into a new fence; a collapsed
  caret in a non-empty paragraph moves that paragraph's text into the fence
  (Typora). With the caret inside a plain code block, it converts back to a
  paragraph. Language tags are not added; the user types them.
- **Horizontal rule (`Mod+Alt+R`).** Collapsed caret only. An empty block is
  replaced by the rule; otherwise the rule is inserted after the caret's block
  with a fresh empty paragraph after it, so no text is split or lost.
- **Clear formatting (`Mod+\`).** Runs the existing `clearFormatting()`: strips
  block markers and inline emphasis from every touched block, leaves links,
  images, fenced code, and atomic plugin blocks untouched, and leaves a rule in
  place. One undo step.
- **Inside a protected block** (a table or a fence). Block operations silently
  no-op, matching the behavior of the same edit-bar buttons. No notify, no dirty
  flag. (Creating a list inside a table cell from a shortcut is out of scope; a
  list that already exists in a cell is unaffected.)

### 4.3 Refusal summary

| Situation | Operation | Result |
|---|---|---|
| Selection crosses top-level blocks | Bold, italic, strike, code, link | Refused; notify *"Inline formatting needs a selection inside one block"* |
| Caret/selection inside `<pre>` or an atomic plugin block | Bold, italic, strike, code, link | Refused; notify *"Formatting isn't available inside a code block"* |
| Non-collapsed selection | Horizontal rule | Refused; notify *"Horizontal rule needs a collapsed caret"* |
| Caret in a table or fence | Headings, paragraph, quote, lists, code block, rule | Silent no-op (toolbar parity) |
| Caret at the root beside an `<hr>` | Any block operation | Silent no-op |

A refused operation changes no DOM, pushes no undo snapshot, and does not mark
the document dirty.

### 4.4 Key matching: `e.code`, not `e.key`

Shift and Option change `e.key`: `Mod+Shift+7` arrives as `&` on a US layout,
`Mod+Shift+.` as `>`, and Option+digit produces a symbol on macOS. Every new
chord must therefore match on `e.code` (`Digit7`, `Period`, `Backslash`,
`KeyC`, `KeyR`, `Digit1`…). This is layout-independent, the same rule
`NB.shortcuts.keyName()` already follows. The existing letter chords may stay on
`e.key`.

`Mod+K` must call `preventDefault()` so the browser's own Ctrl+K (focus the
address bar) does not run. Verify in the real-browser harness, not only jsdom.

## 5. Link flow (`Mod+K`)

Entry is a prompt, matching the existing source-mode and edit-bar link action
(`editbar.js` `link()`), so both modes behave identically and no new UI module is
needed. The selection is pinned before the prompt (the existing
`savedEmojiRange` pattern) because a prompt blurs the contentEditable.

The URL is stored verbatim as the `href`. A scheme is not forced — `#heading`,
`./note.md`, and `mailto:` are valid. The serializer emits `[label](url)` and
escapes the destination as needed.

### 5.1 Selection, not already a link

1. Capture the selection range and its text (the label).
2. Open the URL prompt prefilled with `https://`.
3. Confirm with a non-empty URL → replace the selection with
   `<a href="url">label</a>`; select the link text. One undo step.
4. Confirm with an empty URL, or cancel → nothing changes.

### 5.2 Collapsed caret, not in a link

1. Open the URL prompt prefilled with `https://`.
2. Confirm with a non-empty URL → insert `<a href="url">link text</a>` with the
   label placeholder `link text` selected, so typing replaces the label.
3. Empty URL or cancel → nothing changes.

### 5.3 Caret or selection inside an existing link

1. Open the URL prompt prefilled with the link's current `href`.
2. Confirm a non-empty URL → update the `href` only; the label text is unchanged.
   Keep the link text selected.
3. Confirm **empty** → remove the link: unwrap the `<a>` to its text. This is the
   toggle-off.
4. Cancel → nothing changes.

If the selection partially covers a link, the anchor is still the target and the
same edit applies.

### 5.4 Text that is already a URL

If the selection's text is a single `http(s)://…`, `mailto:…`, or bare-domain
token, prefill the prompt with that text. Confirming wraps it as
`[text](text)` (label equals destination). Cancel leaves it as plain text.

### 5.5 Paste-over-selection

While the prompt is open, paste is native to the prompt's input. After the link
is created the label is selected, so a paste replaces the **label**; it never
rewrites the `href`. To change the destination, press `Mod+K` again. No custom
paste handling is added.

### 5.6 Link refusal and boundaries

- Selection crossing top-level blocks → refused with the inline message (§4.3).
- Caret/selection inside a code block or atomic plugin block → refused with the
  code-block message (§4.3).
- A link may cross no block boundary; it is inline text within one block. A
  blockquote/list/cell is one block for this rule, so a link inside a quoted or
  listed paragraph is fine.

### 5.7 Should-have (not MVP)

Replace the prompt with a small anchored popover (URL field + Apply / Remove),
reusing the `NB.menu` singleton or the edit-bar popover pattern. This removes the
blocking prompt and the selection-blur workaround. It is deferred because the
source-mode and edit-bar link paths already use a prompt, and adding the popover
means a new UI surface plus focus/selection management in two modes.

## 6. Config vs hardcoded: recommendation

**Keep the new hybrid shortcuts hardcoded in `hybrid.js`, out of the
`NB.shortcuts` registry.** The four existing inline chords already are, and the
new ones are the same kind of binding.

Rationale:

1. **Context.** `NB.shortcuts` is a capture-phase `document` listener that fires
   app-shell actions regardless of mode. Registering `Mod+Alt+1` there would fire
   it in preview mode, source mode, the search box, and the AI panel — all wrong.
   Hybrid's own `onEnterKey` already gates on `active`, the caret being inside
   `#viewer-content`, and the plugin-island guards. Reusing those gates is
   simpler and safer than replicating them in the global dispatcher.
2. **Collisions.** The registry uses "first configured action wins" and lets a
   user rebind anything. A user who rebinds `save` to `Mod+K`, or `toggleEdit` to
   `Mod+Shift+8`, would silently shadow a hybrid action (or be shadowed by it),
   with no way to express "only in hybrid". Keeping hybrid chords off the registry
   removes the whole class of collision.
3. **Scope.** The task is the hybrid keyboard surface, not a redesign of the
   global shortcut system. The registry stays exactly as it is.

The chords must still live in **one declarative table** inside `hybrid.js`
(chord → action → output → tooltip), so the Settings list, the tooltips, and the
dispatcher read a single source and cannot drift. Message strings become named
constants, not inline literals.

A single opt-out toggle ("Enable hybrid formatting shortcuts", default on) is a
reasonable addition if keyboard conflicts are reported; per-chord remapping is
not in this version.

## 7. Discoverability

Four surfaces, in priority order:

1. **Edit-bar tooltips.** Every edit-bar button that maps to a hybrid shortcut
   shows the platform-correct chord, rendered through `NB.shortcuts.format()`
   (`Mod+K` → `Cmd+K` on macOS, `Ctrl+K` elsewhere). Today `index.html` hardcodes
   `title="Bold (Ctrl+B)"`, which is wrong on macOS and can drift; a boot-time
   pass in `editbar.js`/`app.js` sets the titles from the chord table.
2. **Settings → Shortcuts, read-only group.** Below the configurable app-shell
   actions, add a "Hybrid formatting (available in WYSIWYG mode)" group listing
   each chord read-only, with a one-line note that these are contextual and not
   remappable in this version. Rows use the same `shortcut-row` markup and
   `NB.shortcuts.format()` labels as the editable rows, so they look native but
   carry no Change/Reset buttons.
3. **A shortcuts cheatsheet overlay** (should-have). A `Mod+/` app-shell action
   opens a modal listing the app-shell chords and the hybrid chords. `Mod+/` is
   the one addition to the registry this spec requires; everything else stays
   out.
4. **The `/agent.md` guide** stays documentation for agents, not for the human
   cheatsheet; no change needed there.

## 8. Acceptance criteria

Each is testable in `tests/dom/test_dom.js` (hybrid block) unless marked
`[browser]` (real Chromium harness). "Serialize" means the note's saved Markdown
after the existing save path. All are **hybrid-only**: repeat the dispatch in
preview mode and in source mode and assert no change.

**Dispatch and mode**

1. With hybrid active and the caret in `#viewer-content`, each new chord
   dispatches its action (one call per keydown).
2. In preview mode, each new chord is ignored: no DOM change, no dirty flag, and
   `defaultPrevented` is false.
3. In source (CM6) mode, each new chord is ignored by hybrid and does not alter
   the CodeMirror document.
4. `[browser]` `Mod+K` calls `preventDefault`; the browser's focus-address-bar
   action does not run.
5. Every new chord matched on `e.code` fires with the US `e.key` that Shift or
   Option produces (`Shift+7` → `&`, `Shift+.` → `>`, Option+1 → `¡`).

**Inline**

6. `Mod+B`/`Mod+I`/`Mod+Shift+X`/`Mod+Shift+C` over a one-block selection produce
   `<strong>`/`<em>`/`<del>`/`<code>` respectively; serialize to `**x**`/`*x*`/
   `~~x~~`/`` `x` ``.
7. Pressing the same inline chord again with the run selected unwraps it.
8. A collapsed caret creates the empty inline element and places the caret inside.
9. An inline chord over a cross-block selection changes nothing and calls
   `notify` with *"Inline formatting needs a selection inside one block"*.
10. An inline chord with the caret inside a `<pre>` changes nothing and calls
    `notify` with the code-block message.

**Link**

11. Selection + `Mod+K` + URL → an `<a href>` wrapping the selected text;
    serializes to `[label](url)`.
12. Collapsed caret + `Mod+K` + URL → `<a>link text</a>` with the placeholder
    label selected; serializes to `[link text](url)`.
13. Cancel or empty URL → no change, no undo snapshot.
14. Caret inside an existing link + `Mod+K` + new URL → the `href` updates, the
    label is unchanged.
15. Caret inside an existing link + `Mod+K` + empty URL → the `<a>` unwraps to
    its text (toggle-off).
16. Selecting a URL as text + `Mod+K` → the prompt is prefilled with that text;
    confirming yields `[text](text)`.
17. `Mod+K` over a cross-block selection is refused with the inline message; the
    `href` of any link the selection touches is unchanged.
18. The selection survives the prompt: the link lands on the original selection,
    not at the prompt's loss of focus.
19. `Mod+K` on a fresh link produces a single undo step; hybrid undo restores the
    pre-link DOM.

**Block**

20. `Mod+Shift+7`/`8`/`9` on a paragraph produce `<ol>`/`<ul>`/task `<li>` and
    serialize to `1. x` / `- x` / `- [ ] x`.
21. Pressing a list chord on an item already of that type removes the item from
    the list as a paragraph.
22. `Mod+Shift+7/8/9` over a multi-block selection applies to every touched
    block; a block already entirely of the pressed type toggles off.
23. `Mod+Shift+.` wraps the caret's block in a `<blockquote>`; a second press
    lifts it out; over a selection, every touched block is quoted.
24. `Mod+Alt+1`…`6` set the matching `<h1>`…`<h6>` on every touched block and
    serialize to the matching `# `…`###### `.
25. `Mod+Alt+0` converts headings, lists, and quotes to paragraphs while keeping
    inline runs; it does not strip emphasis.
26. `Mod+Alt+C` moves a selection or the caret's paragraph text into a fence and
    serializes to a ```` ``` ```` block; on a code block it converts back to a
    paragraph.
27. `Mod+Alt+R` with a collapsed caret inserts a rule on its own line and does
    not lose text; with a non-collapsed selection it changes nothing and calls
    `notify` with the rule message.
28. `Mod+\` strips block markers and inline runs across a multi-block selection,
    leaves links/images intact, and leaves a fenced code block untouched.
29. Every block chord inside a table cell or a fence is a silent no-op (no DOM
    change, no dirty flag, no notify).
30. A no-op operation (toggle onto an empty result, refusal, protected block)
    pushes no undo snapshot and leaves `isDirty()` false.

**Serialization and write-back**

31. After each successful chord, save and assert the emitted Markdown equals the
    expected construct; untouched blocks are byte-identical (the splice path,
    [hybrid-editing](../architecture/hybrid-editing.md) I3).
32. No chord writes presentation HTML to the file (I4): output is plain Markdown.

**Config and discoverability**

33. Edit-bar tooltips for the mapped actions read the platform-correct chord
    (`Cmd+K` on macOS, `Ctrl+K` elsewhere) via `NB.shortcuts.format()`.
34. Settings → Shortcuts shows the hybrid group read-only: no Change/Reset
    controls, and the labels match the chord table.
35. The chord table is the single source: changing a chord there changes both the
    dispatcher and the displayed labels (no second hardcoded copy).

## 9. Decisions (accepted)

The §9 open questions are closed; the calls below are binding for implementation.

- D1. **Link entry: prompt (MVP).** Matches the existing source-mode and
  edit-bar link action; adds no new UI surface. The anchored popover (§5.7) is
  deferred to a follow-up.
- D2. **Headings keep `Mod+Alt+1…6` / `Mod+Alt+0`, matched on `e.code`.** The
  handler claims the keydown and calls `preventDefault`, so an AltGr-generated
  character is never inserted. Rejected `Mod+1…6` (browser tab keys) and
  `Mod+Shift+1…6` (macOS reserves Cmd+Shift+3/4/5 for screenshots).
- D3. **A block chord applies to every touched top-level block; no cap.**
  Capping at an arbitrary count would surprise on a multi-block selection. Each
  chord is one undo step.
- D4. **Blockquote chord confirmed: `Mod+Shift+.`.** Shifted `.` is `>`, so the
  chord reads as "quote"; `Mod+Shift+Q` stays avoided (macOS Log Out).
- D5. **Cheatsheet overlay dropped to should-have-later.** Discoverability is
  covered by the edit-bar tooltips (§7.1) and the read-only Settings group
  (§7.2). The `NB.shortcuts` registry is left unchanged — no `Mod+/` action.
- D6. **Source (CM6) mode stays out of scope.** The new chords are hybrid-only.

## 10. Non-hard-coded values

The chord table is one named structure; the two new notify messages, the
placeholder `link text`, the `https://` prompt prefill, and the URL matcher are
named constants, not inline literals. No number is introduced by this spec.

## 11. Assumptions

- A1. `NB.app.notify` remains the toast mechanism for refusal messages.
- A2. `NB.shortcuts.format()` stays the single chord-label formatter.
- A3. ~~The existing … transforms these chords call.~~ **Falsified by review —
  see §12.** Code block and horizontal rule are inline `execCommand` handlers,
  not transforms; there is no paragraph action; only `clearFormatting` is
  multi-block; the inline `<pre>` refusal does not exist; the hybrid link path is
  `execCommand("createLink")`, not `editbar.js link()`. The change is therefore
  new transforms plus a dispatcher, and the scope is cut accordingly.
- A4. `Mod+K` is free: it is not one of the nine `NB.shortcuts` defaults.

## 12. Revision after adversarial review (binding scope)

An adversarial review of v1 found A3 false and several chords collision-prone.
This section **overrides §1–§8 where they disagree**. §8's acceptance criteria
apply only to the features that survive §12.1; the deferred rows' ACs are
deferred with them.

### 12.1 Ships in this change

- `Mod+K` — link (the universal gap the user reported).
- `Mod+Shift+7` / `Mod+Shift+8` / `Mod+Shift+9` — ordered / bulleted / task list.
- `Mod+Shift+.` — blockquote.
- `Mod+\` — clear formatting.

Scope of each: a **collapsed caret, or a selection inside one block**. All
hardcoded in `hybrid.js` behind one chord table (chord → action → code), out of
`NB.shortcuts` (per §6, which stands).

### 12.2 Deferred (do not implement now)

- **Headings `Mod+Alt+1…6` / `Mod+Alt+0`.** AltGr reports Ctrl+Alt, so on
  Nordic/German layouts AltGr+digit *invokes* the chord (Nordic `@` = AltGr+2 →
  H2; German `}` = AltGr+0 → strip markers). `wrapBlock` on a list item also
  emits invalid `<ul><h1>`, and `wrapBlock`/`toggleQuote` add no empty-line box.
  Needs a collision-free family and those fixes first.
- **Code block `Mod+Alt+C`, horizontal rule `Mod+Alt+R`.** No reusable transform;
  empty-fence round-trip unverified; `text\n---` can serialize as a setext H2;
  `Mod+Alt+R` is Cmd+Opt+R hard-reload on macOS.
- **Multi-block drivers (D3).** `wrapBlock`/`toggleList`/`toggleTask`/
  `toggleQuote` are single-block; a multi-block selection is a silent no-op
  today. Deferred; §4.2's "every touched block" and AC22/23/24 do not apply.
- **Link inline popover (§5.7); `Mod+/` cheatsheet (§7.3).**
- **Source (CM6) parity** (D6).
- **The inline `<pre>` refusal (§4.1) and the cross-cell table guard (finding 9)**
  are separate bug fixes, not part of this change.

### 12.3 Link flow (revised)

Reuse the hybrid path that already exists (`execCommand("createLink")`), with a
prompt for the URL. Pin the selection before the prompt.

- Selection + non-empty URL → link the selection.
- Collapsed caret + non-empty URL → insert `link text` as the label, label
  selected, so typing replaces it.
- Caret/selection inside an existing link + non-empty URL → update the `href`
  only; label unchanged. + **empty** URL → unwrap the `<a>` to its text.
- Empty URL anywhere else, or cancel → no change, no undo snapshot.
- Cross-block selection → refused with the existing inline message (§4.3).
- **Scheme guard.** Reject `javascript:` and `data:` hrefs (a link is clickable
  and the renderer is un-sanitized) — no change, notify the user. Allow `#`,
  relative, `mailto:`, and `http(s)`. This is the one new safety rule.

### 12.4 Discoverability (revised)

Add the new chords to the **existing** static shortcut rows in
`templates/index.html` (`shortcut-row-static`), which already list hybrid-only
chords (Enter, Shift+Enter, Alt+arrow). No new Settings group, and **no
boot-time tooltip pass** — the edit-bar buttons are shared with source mode,
where these chords are inert (finding 11). `NB.shortcuts.format()` renders the
display chords; the dispatcher matches `e.code` through a parallel code map, so
a display chord like `Mod+Shift+7` and a code match `Digit7` coexist.

### 12.5 Matching

Match the new chords on `e.code`; the existing letter chords stay on `e.key`.
`Mod+K` and `Mod+\` must `preventDefault` (Ctrl+K focuses the address bar);
verify in the real-browser harness, not only jsdom.

### 12.6 Acceptance criteria for this change

The §8 criteria reduce to these; the rest are deferred with their features.

1. With hybrid active and the caret in `#viewer-content`, each of
   `Mod+K`, `Mod+Shift+7/8/9`, `Mod+Shift+.`, `Mod+\` dispatches once per keydown.
2. In preview mode and in source (CM6) mode, each is ignored: no DOM change, no
   dirty flag, `defaultPrevented` false.
3. `Mod+Shift+7`/`8`/`9` on a paragraph produce `<ol>`/`<ul>`/task `<li>` and
   serialize to `1. x` / `- x` / `- [ ] x`; pressing again on an item of that type
   removes it as a paragraph.
4. `Mod+Shift+.` wraps the caret's block in a `<blockquote>` (serializes to
   `> x`); a second press lifts it out.
5. `Mod+\` strips block markers and inline runs from the caret's block, leaves
   links/images and a fenced code block untouched.
6. Inside a table cell or a fence, the block chords are a silent no-op (no DOM
   change, no dirty flag, no notify) — except `Mod+\`, which clears cell inline
   emphasis (existing `clearFormatting` behavior) and is documented as such, not
   as a no-op.
7. Selection + `Mod+K` + URL → `<a href>` wrapping the selection; serializes to
   `[label](url)`; one undo step.
8. Collapsed caret + `Mod+K` + URL → `<a>link text</a>`, label selected;
   serializes to `[link text](url)`.
9. Cancel or empty URL (outside an existing link) → no change, no undo snapshot.
10. Caret in an existing link + `Mod+K` + new URL → href updates, label
    unchanged; + empty URL → `<a>` unwraps to its text.
11. `Mod+K` + a `javascript:` or `data:` URL → no change, notify.
12. Cross-block selection + `Mod+K` → refused with the existing inline message.
13. `[browser]` The selection survives the prompt (the `savedEmojiRange` pin),
    and `Mod+K` / `Mod+\` call `preventDefault`.
14. A no-op (refusal, protected block, cancel) pushes no undo snapshot and
    leaves `isDirty()` false.
15. After each successful chord, save and assert the emitted Markdown is the
    expected construct; untouched blocks are byte-identical.
