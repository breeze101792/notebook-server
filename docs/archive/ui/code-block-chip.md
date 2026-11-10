# Code fence header — quiet top space (E1)

> **Archived.** Frozen design record, kept for history. Not a current spec. See [`../README.md`](../README.md).


Status: **shipped** (uncommitted). Mockup:
[`code-block-chip-mockup.html`](code-block-chip-mockup.html) — Today, E1 and E2, idle / hover /
clicked, a bare fence, five stress cases, phone width, and live height readings.

The mockup renders the code with no inner padding. Production's vendored hljs theme adds
`1em` of padding inside `<code>` (see §2.6), so the mockup's 34 px band is the visual
equivalent of the 22 px band specified here. Use the numbers in §2, not the mockup's.

## 1. The problem

The block grows because the *padding* changes, not because of the label. The clicked pre sets
`padding-top: 34px` (`static/css/style.css:3338`) over a base `14px 16px` (`:3262`); the phone
base is `12px 14px` at `13px` (`:7466`), so the click adds 20 px (22 px on a phone) and moves
everything below it. The label is absolutely positioned (`:3342`) and the copy button already
floats at `top: 6px; right: 6px` over the code (`:3289`).

E1 keeps a band of top space **always**, in read and edit, and puts the type and the copy
button in it. No fill, no divider, no bar: the block's own `--code-bg` runs to its top edge.
The click only swaps the type for the editable input, so the block height never changes.

## 2. E1 — quiet top space (chosen)

- **Desktop:** fence pre `padding: 22px 16px 14px` in every state. Type at `left: 16px;
  top: 6px` (plain muted monospace, no box); copy at `top: 1px; right: 10px`, revealed on
  hover. Delete the `padding-top: 34px` rule on `pre.hybrid-plugin-editing`.
- **Phone (360–400px):** pre `padding: 44px 14px 12px` at `13px`; type at `left: 14px;
  top: 13px`; the existing 44×44 copy target sits fully inside the 44 px band instead of
  covering the first code line.
- **Clicked:** the generated type is hidden and the editable input takes its place, keeping
  the app's chip look (raised background, dashed border) so an empty language is still
  visible. Its text starts at the same x as the type, and the block does not move.
- **Bare fence:** the same band with no type (§4). The chip opens in the band, so even a fence
  with no language never grows.

```css
/* Fences only: pre:has(> code) excludes the plugin error boxes, whose
 * source is a text-only <pre> (.mermaid-source, .katex-source, ...). */
.markdown-body pre:has(> code) { padding-top: 22px; }   /* was 14px 16px */

/* The type is generated text: not a node, so it cannot take a caret, be
 * selected, copied, saved, undone, or lost on re-render. */
.markdown-body pre:has(> code)[data-fence-lang]:not([data-fence-lang=""])::after {
  content: attr(data-fence-lang);
  position: absolute;
  top: 6px;
  left: 16px;                                         /* the pre's padding edge */
  max-width: calc(100% - 96px);
  font: .72em/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--fg-muted);
  white-space: nowrap;
  overflow: hidden;
  pointer-events: none;                               /* clicks reach the pre */
  z-index: 0;
}
.markdown-body pre.hybrid-plugin-editing::after {
  display: none;                                      /* the input replaces the type */
}

/* Copy sits inside the band. Only the position and the stacking change; the
 * base rule hides it and reveals it on hover / focus-within
 * (.code-copy-btn, static/css/style.css:3289). */
.markdown-body pre:has(> code) > .code-copy-btn {
  top: 1px;
  right: 10px;
  z-index: 2;
}

/* The editing input: the app's chip, in the type's place. Its text starts at
 * x = 16 (7 + 8 padding + 1 border), matching the type. */
.hybrid-lang-pill {
  position: absolute;
  top: 2px;
  left: 7px;
  box-sizing: border-box;
  height: 18px;
  min-width: 24px;
  padding: 0 8px;
  border: 1px dashed var(--border);
  border-radius: 4px;
  background: var(--bg-elev);
  color: var(--fg-muted);
  font: .72em/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  z-index: 1;
  outline: none;
}
.hybrid-lang-pill:hover { color: var(--fg); }
.hybrid-lang-pill:focus { border-color: var(--accent); color: var(--fg); }
```

Phone, at the `style.css:7466` breakpoint. The copy override must repeat the `pre >`
selector: a plain `.code-copy-btn` at `(0,1,0)` loses to the desktop rule above at `(0,2,1)`.

```css
.markdown-body pre:has(> code) { padding: 44px 14px 12px; font-size: 13px; }
.markdown-body pre:has(> code)[data-fence-lang]:not([data-fence-lang=""])::after {
  top: 13px; left: 14px;
}
.markdown-body pre:has(> code) > .code-copy-btn {
  top: 0; right: 0; width: 44px; height: 44px;
  padding: 0; font-size: 12px; opacity: 1;
}
.hybrid-lang-pill { top: 12px; left: 5px; }
```

Measured in the mockup (no code padding there; deltas are what transfer):

| | Idle | Clicked | Δ click |
|---|---|---|---|
| Today, desktop | 198.0px | 218.0px | **+20.0px** |
| **E1, desktop** | **218.0px** | **218.0px** | **0.0px** |
| Today, phone | 182.0px | 204.0px | **+22.0px** |
| **E1, phone** | **214.0px** | **214.0px** | **0.0px** |

The cost is the band: 8 px of permanent height on desktop (32 px on a phone, set by the touch
copy target). The click adds nothing.

### 2.1 The authored language

The type must be the *authored* info string. On a bare fence, highlight.js appends its
auto-detected `language-*` (`static/js/hybrid.js:1712-1718`), so reading the class after the
highlight pass would invent a language.

The attribute already exists: `data-fence-lang` is hybrid's `LANG_ATTR` (`hybrid.js:120`),
written by `captureFenceLanguages` (`:1719-1735`) and by `applyFenceLanguage`
(`:8546-8556`). Three writers cover every surface:

1. **View render (new).** In `viewer.render`, between `marked.parse` and the hljs pass
   (`static/js/viewer.js:437-460`), **in both branches** — not only `content === undefined`.
   The split preview shares the stylesheet, so it gets the band; without the capture it would
   get an empty band. For each `pre > code`, read the **first** class token; if it matches
   `language-([\w+-]+)`, set that value on the parent `pre`. A bare fence has no token, so a
   leading `hljs` leaves no attribute and no type.
2. **Hybrid enter and re-render.** `hybrid.enter()` captures on the reused preview DOM
   (`:6945`); `renderMarkdown` captures before and after hljs (`:1760`, `:1777`), so draft
   recovery, external reload and AI patches keep the type.
3. **Language edit.** `applyFenceLanguage` writes the new value, so the type relabels on
   commit. Clearing writes `""`, and the `:not([data-fence-lang=""])` guard removes it.

### 2.2 Why generated content, not a span

A `<span>` label was tried first and fails five ways: inside the editing host it takes a
caret and silently loses typed text on save; as the pre's first child it moves "caret at the
fence start" before the label (`caretToEdge`, `hybrid.js:3979`), so text typed there lands at
the fence's end; `selection.toString()` includes it, so Ctrl+A in the note prefixes a copied
fence with the language; it must be re-created after commit (`wireCommit` removes the pill
and nothing re-renders a plain fence, `:8730-8745`) and after every hybrid re-render; and its
box must match the input. Generated text has none of these failures, and the input still
replaces it cleanly.

### 2.3 The input in the band

The input keeps the chip the app already has — `height: 18px`, `min-width: 24px`, `padding: 0
8px`, a 1px dashed border, `background: var(--bg-elev)` — moved into the band at `left: 7px;
top: 2px`, which puts its text at `x = 16`, the type's x. The visible border keeps an empty
language discoverable (§4) without a bar. The chip is absolutely positioned, so its box
cannot reflow the block; the accent border on focus changes colour only.

Set its width in `addLanguagePill` (`hybrid.js:8674-8676`) to the text plus one
caret cell, plus the chip's own padding and border:

```js
chip.style.width = "calc(" + Math.max(2, chip.value.length + 1) + "ch + 18px)";
```

`1ch` is the monospace advance; 18px is `padding: 0 8px` plus the 1px border twice, so the
label text is never clipped.

### 2.4 What does not get the band

- Plugin containers (mermaid, wavedrom, katex, viz, html-live, svg) — no `<pre>`. Their error
  boxes hold a text-only `<pre>`; `pre:has(> code)` excludes them.
- The CM6 split preview gets the band and the type (shared stylesheet) but no copy button,
  since the live preview never gets one today (`viewer.js:479`).
- Bare fences get the band and no type (§4).
- Export (`export.js` uses its own `exportCss`) has neither. A direct print of the app page
  follows the live stylesheet and shows both; the copy button stays hidden by
  `@media print` (`style.css:3590`).
- Save, copy and undo never see the type: it is generated text. The input and copy button are
  stripped on save (`hybrid.js:613`); the copy source already drops the button
  (`copy-image.js:667`).

### 2.5 Accessibility

Generated content may be exposed to assistive technology as part of the fence; it is
decorative, not focusable, and the source above it is unchanged. Editing the language stays
pointer-only: the input is created on click and E1 adds no keyboard route to it. That gap is
pre-existing (`hybrid.js:3890-3898`) and out of scope here; if it is closed later, the band is
the place for a focusable language control.

### 2.6 Build notes (read before implementing)

1. **The vendored theme owns the code's padding.** `pre code.hljs{padding:1em}` in
   `static/vendor/highlight-styles/github-dark.css:1` (and `github.css`) loads after
   `style.css` (`templates/index.html:38`) at equal specificity, so it beats
   `.markdown-body pre code{padding:0}` (`style.css:3282`). Code text therefore starts about
   `1em` inside the pre, which is why the band is 22 px and not the mockup's 34 px. Do not
   change the vendor padding in this change.
2. **The type aligns to the pre's padding edge, not to the code text.** The code's `1em`
   inset means the code glyphs start ~14 px right of the type. This is accepted; do not add a
   magic offset.
3. **Capture in both render branches** (§2.1), or the split preview shows an empty band.
4. **Repeat the `pre >` selector in the phone copy rule**, or the desktop `(0,2,1)` rule wins
   and the 44 px target overflows the 44 px band.
5. **Keep the chip visible when empty** (§2.3). Without its background the bare-fence case
   has no visible affordance.
6. **Raw-HTML `<pre><code class="language-x">`** also matches the band and type; it is saved
   from `outerHTML` and was already stamped at hybrid enter (`hybrid.js:1719`), so the
   attribute leak is pre-existing. Leave it.
7. **Languages outside `[\w+-]+`** (`python3.11`, `c#`) show no type because the shared
   capture regex ignores them (`hybrid.js:1726`). Pre-existing; do not relax it here.

## 3. What to verify in the real app

1. **Read view.** Every authored fence shows its type in the band on load, both themes; a bare
   fence shows the empty band; plugin error boxes and containers show no band.
2. **Click.** The pre reads 0 px height change at desktop and 360–400 px. The type and the
   input occupy the same text x; nothing below the fence moves.
3. **Hover and focus.** Copy appears at the band's right and is reachable by keyboard through
   `pre:focus-within`; a click on the band or the type opens the fence.
4. **Phone copy.** The 44×44 target sits at the band's right edge, fully inside the 44 px
   band, not over the first code line.
5. **Bare fences.** No type, the same band, a visible chip on click, the block unchanged.
6. **Adjacency.** First block, a paragraph before, two adjacent fences, a fence in a
   blockquote and one in a list item: the band never touches the text above and is not
   clipped.
7. **Language lifetime.** Bare → type a language → the type appears on commit; clear it → the
   type disappears, the band stays; hybrid re-render, draft recovery and an AI patch restore
   it.
8. **Chrome.** Ctrl+A/copy, the copy button, save and undo contain no type text; focus shows
   the chip border without reflowing the block.
9. **Split preview.** It shows the type and no copy button; the band is not empty.
10. **Long type.** `objective-c` at phone width stays clear of the copy button (the label is
    capped at `100% - 96px`).
11. **Today baseline.** A still grows +20 px desktop, +22 px phone.

## 4. Fences with no language (decided)

A fence with no info string gets the band and **no type**. The space is reserved because the
editable input opens there; an invented label such as `txt` would lie. The chip is visible
when it opens, and the block still does not grow on click.

## 5. Dropped options

- **A — today:** the type appears on click in `padding-top: 34px`; +20 px desktop, +22 px
  phone. Rejected: it moves the note under the pointer.
- **Filled bar (earlier E):** a 26 px (44 px phone) coloured header strip with a divider.
  Rejected by the owner: it reads as a bar, not as part of the code block.
- **Caption above the box (E2):** the type outside the border with a 22 px margin reserving
  its space. Rejected: it needs a `:first-child` override and still reads as a separate
  label.
