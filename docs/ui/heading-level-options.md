# Heading level legibility — four options, and the chosen design

Status: Design record — **V6 chosen and applied** (ramp plus a level label in both modes).
`reader.md`, `hybrid-mode.md`, `style.css` and `hybrid.js` carry it.

Mockup: [`heading-level-options-mockup.html`](heading-level-options-mockup.html) — an options
board, not a surface mockup: guidelines §7 keeps a proposal out of a surface mockup. The
fifth column is what shipped.

**Normative source.** `reader.md` owns the heading ramp — h1 `1.9em`, h2 `1.5em`,
h3 `1.25em`, h4–h6 `1em`, weight 650, line 1.25, a rule under h1 only
(`static/css/style.css:3142-3156`; phone override `:8892-8895`). `typography.md` owns the
role tokens and the retired-literal rule. `tests/static/test_typography.js` rejects any
`font-size` in `style.css` that is not a role token, an `em`/ `%` inside `.markdown-body`,
or an allowlisted entry. `hybrid-mode.md` §3 owns block chrome and allows none on a
paragraph or a heading.

**Prerequisite.** None. Each option is CSS only. V1–V3 also need the one-sentence amendment
to `reader.md` §11 named under "promise" below.

## 1. The problem

A note's h2 and h3 differ by 0.25 em of size and nothing else. h4, h5 and h6 have no size
rule, so they render at body size and read as bold paragraphs. The writer cannot tell two
adjacent levels apart without counting characters in the source.

- The source editor shows the typed `##`, so this is a rendered-mode problem: the reader,
  and hybrid mode, where the heading is contentEditable.
- `outline.js` already draws nesting with guide cells. A gutter label repeats what the
  outline holds, for one heading at a time and only while the outline is open (§7). The
  mockup's sample content is identical in all four columns.

### 1.1 Shared by V1–V3

| Rule | Value |
|---|---|
| Placement, flow | The page's existing 40 px left padding, except V2 (48 px, §3); the measure is 692 at 1280 and 273 at 861. `position: absolute`, `right: calc(100% + …)`, `top: 0`, `pointer-events: none`, `user-select: none`: off-flow, so the caret and text box are untouched and a click passes through to the heading. |
| Reveal | `visibility: hidden` → `visible`. `opacity` is not used: reader.md §11 bans it as a state, and a fade is banned with it, so visibility changes in one frame with the same visual result. |
| Phone | `display: none` inside the single phone query (`style.css:6975`). The gutter is 20 px and the phone has no hover. |
| Hybrid | `display: none` under `.markdown-body[contenteditable="true"]`; `hybrid-mode.md` §3 allows no gutter chrome on a heading. |
| Text | `--text-2xs` (badge role, 9 px, fixed), `--fw-semibold`, `--text-muted` (5.21:1 dark, 5.96:1 light), `--lh-tight`, `--tracking-label`. |
| Outline | A second view of the same information, one heading at a time; the outline stays the only whole-tree view. |

## 2. V1 — gutter hover badge

Solves the problem while the pointer is on the heading. Nothing is visible at rest.

```css
.markdown-body :is(h1,h2,h3,h4,h5,h6) { position: relative; }
.markdown-body :is(h1,h2,h3,h4,h5,h6)::before {
  position: absolute; right: calc(100% + var(--space-2)); top: 0;
  font-size: var(--text-2xs); font-weight: var(--fw-semibold); line-height: var(--lh-tight);
  letter-spacing: var(--tracking-label); color: var(--text-muted); white-space: nowrap;
  visibility: hidden; pointer-events: none; user-select: none;
}
.markdown-body h1::before { content: "H1"; }   /* h2…h6 likewise */
.markdown-body :is(h1,h2,h3,h4,h5,h6):hover::before,
.markdown-body :is(h1,h2,h3,h4,h5,h6):focus-visible::before { visibility: visible; }
```

- **Promise.** Breaks "no chrome in the page" (§11) and "no heading hover state" (§2.5).
  Both become "no chrome at rest; one 9 px label under the pointer".
- **Desktop.** Label top-aligned to the heading's line box, `right: 100% + 8 px`, ~12 px
  wide, well inside the 40 px gutter. **Phone.** Absent.
- **Works while writing.** No. Hybrid hides it.
- **Accessibility.** No heading takes focus today, so `:focus-visible` is inert until one
  does. Chrome puts generated content in the accessible name, so a reader may announce
  "H2 Setup"; a clean name needs an `aria-hidden` span from `viewer.js` (one renderer change).
- **Cost.** One CSS block, no JS. Reveal is pointer-only: keyboard and touch users never see it.

## 3. V2 — gutter hover hashes

V1 with the syntax the writer typed, so the label reads as a source fragment. Everything
else is V1: placement, reveal, phone, hybrid, colour, `pointer-events: none`.

```css
.markdown-body :is(h1,h2,h3,h4,h5,h6)::before {
  font-family: var(--font-mono); font-size: var(--text-2xs);
  letter-spacing: normal; right: calc(100% + var(--space-hair));
}
.markdown-body h2::before { content: "##"; }     /* h1…h6 likewise */
```

- **Promise.** Same two amendments as V1.
- **Problem it adds.** `######` is 32–45 px wide at 9 px depending on the monospace fallback,
  so it does not reliably fit the 40 px gutter. V2 needs the page padding at 48 px
  (`reader.md` §1.2, +8 px) and is the only variant that moves the measure.
- **Accessibility.** Same generated-content risk; the announced string would be "## Setup".
- **Cost.** One CSS block plus an 8 px layout delta. It is V1 with a syntax echo the source
  editor already shows.

## 4. V3 — always-on level rail

A 2 px tick at the measure edge, length encoding the level, with the `Hn` label outside it.
Visible at all times.

```css
.markdown-body :is(h1,h2,h3,h4,h5,h6) { position: relative; }
.markdown-body :is(h1,h2,h3,h4,h5,h6)::before {          /* tick */
  content: ""; position: absolute; top: 0;
  right: calc(100% + var(--space-1)); width: var(--space-hair); background: var(--text-muted);
}
.markdown-body h1::before { height: var(--space-4); }   /* 16 */
.markdown-body h2::before { height: var(--space-3); }   /* 12 */
.markdown-body h3::before { height: var(--space-2); }   /*  8 */
.markdown-body :is(h4,h5,h6)::before { height: var(--space-1); }  /* 4 */
.markdown-body :is(h1,h2,h3,h4,h5,h6)::after {           /* label */
  position: absolute; top: 0; right: calc(100% + var(--space-3));
  font-size: var(--text-2xs); font-weight: var(--fw-semibold); line-height: var(--lh-tight);
  letter-spacing: var(--tracking-label); color: var(--text-muted);
  white-space: nowrap; pointer-events: none;
}
.markdown-body h1::after { content: "H1"; }              /* h2…h6 likewise */
```

- **Promise.** Breaks §11 outright: permanent chrome on every heading. §2.5's "no
  numbering, no anchor glyph" gains a level mark.
- **Level encoding.** Length only. Opacity is banned as a state and per-level contrast
  would need new colour values, so h4–h6 share the 4 px tick and the label disambiguates.
- **Desktop.** Visible at rest, recognisable while scrolling. **Phone.** Absent, so the
  one-column reading surface loses the cue.
- **Works while writing.** No. It is the cue hybrid mode most needs and the one §3 forbids.
- **Accessibility.** Generated content pollutes the heading name again; the label is 9 px
  at 5.2:1, small but above the contrast floor. Keyboard and touch users keep the cue.
- **Cost.** One CSS block, no JS, 26 px of the 40 px gutter, plus the name fix if needed.

## 5. V4 — typography ladder only

No labels, no gutter. The levels are separated by the ramp itself.

```css
.markdown-body h2 { border-bottom: var(--stroke-1) solid var(--border); padding-bottom: .2em; }
.markdown-body h4 { font-size: 1.05em; }
.markdown-body h5 { font-size: .95em; text-transform: uppercase; letter-spacing: var(--tracking-label); }
.markdown-body h6 { font-size: .9em; color: var(--text-muted); }
```

- **Promise.** No new chrome, so §11 holds. The optional h2 hairline breaks "h1 is the only
  level with a rule under it" (§2.5). The `h5` tracking contradicts the spirit of "no
  letter-spacing on body text" (§11); a heading is not body text, but it is recorded anyway.
- **Recognition.** h4 is 14.7 px at the 14 px root — still close to a bold paragraph. h5 is
  uppercase and spaced, h6 smaller and muted, and the h2 rule stops h2 and h3 being a size
  comparison.
- **Desktop and phone.** The phone block already sets h4 `1.05em` (`:8892-8895`); the new
  h5/h6 rules inherit through it. No phone rule is added.
- **Works while writing.** Yes, in both modes; a ramp is not chrome and is never hidden.
  `text-transform` stays live under the caret, so a lowercase h5 renders uppercase.
- **Accessibility.** No generated content, so no heading name changes; h6 is 5.21:1 dark,
  5.96:1 light; a screen reader reads h5 as typed.
- **Cost.** Four declarations, no JS, no DOM, no allowlist: the `em` values sit inside
  `.markdown-body`, which `test_typography.js` accepts. `reader.md` §2.2 and §7.2 change.

## 6. V5 — hybrid-only inline hashes (note, not a column)

Showing `##` inside the heading only while that block is edited needs a
`contenteditable="false"` marker span inserted at the text start on focus and removed on
blur. `hybrid.js` already owns marker removal on Backspace, so this adds a second writer of
the same characters: the save path, undo snapshots and the caret at position 0 each gain an
edge case, for a cue visible only while the writer looks at the heading. Not worth it — V4
works in hybrid mode for zero JS, and the source editor shows the literal syntax.

## 7. Comparison

| | At-a-glance recognition | Zero reading-mode clutter | Works while writing | Implementation cost |
|---|---|---|---|---|
| **V1** hover badge | None at rest; needs the pointer | Yes, at rest | No | Low — CSS; renderer span if the heading name must stay clean |
| **V2** hover hashes | None at rest; needs the pointer and knowledge of the syntax | Yes, at rest | No | Low–medium — CSS plus an 8 px gutter delta |
| **V3** always-on rail | Yes, while scrolling | No, chrome on every heading | No | Medium — CSS, 25 px of gutter, accessible-name fix |
| **V4** ladder | Partial: h2/h3 yes, h4 vs bold paragraph no | Yes | **Yes** | Lowest — four declarations, no DOM |
| **V6** chosen (§9) | Yes: the ramp at rest, the label under the pointer or caret | Yes | **Yes** | Low — V4's declarations, one CSS block and ~15 lines of caret tracking |

## 8. Recommendation, reading-only

**V4, with the h2 hairline.** It is the only option visible in hybrid mode, and the stated
problem is a writing problem. It adds no chrome, no generated content and no
accessible-name risk, and it does not touch the type test. The h2 rule answers the "h2 or
h3" complaint; the h4–h6 steps answer the rest.

Residual weakness: an h4 at 1.05 em still resembles a paragraph that opens with bold text.
If that survives a week of real notes, V1 is compatible with V4 and can be added later as a
reading-only aid.

To adopt: add V4 as P13 in `reader.md` §9, then apply it as an exception with value deltas
in §2.2, §7.2 and AC4. Do not ship V1, V2 or V3 before deciding the accessible-name question.

---

## 9. Decision — V6: the ramp everywhere, the level badge while editing

**Supersedes §8 after review.** The writer's problem happens in hybrid mode, so the badge
belongs there and nowhere else. V1's rule that hybrid hides it was wrong; so was showing it
on hover in the reader — the render surface stays paper. V6 is V4 (the ramp, always on, no
chrome, works on phone and while scrolling) plus a gutter label **in hybrid mode only**, on
the heading that holds the caret, or under the pointer while editing.

### 9.1 Shape

| Property | Value |
|---|---|
| Label | `H1`–`H6`, `--text-2xs` 9 px fixed, `--fw-semibold`, `--text-muted`, `--tracking-label`, `--lh-tight` |
| Placement | Left gutter, `right: calc(100% + var(--space-2))`, top-aligned to the heading's first line. Off-flow; the measure never moves |
| Reveal | Hybrid mode only: the caret's heading, or the heading under the pointer while editing. Caret-derived like the shipped list grip and table chip (`list-edit.js:575`; `table-edit.js:104-121`) |
| Read mode | No label at all. The ramp alone carries the level; `reader.md` §11 keeps the page paper |
| Out of the text | A pseudo-element, so it cannot be selected, deleted, saved, undone or reached by the caret. The save path is untouched — the reason V5 was rejected |
| At rest | `visibility: hidden`. One frame, no fade; `opacity` stays banned as a state (`reader.md` §11) |
| Phone | Absent. The ramp carries the phone, where there is no hover and the gutter is 20 px |
| Print | Absent. The label adds nothing the ramp does not already say |
| Busy gutter | Suppressed inside a list item, quote or table, where the grip or Edit chip owns that column |

### 9.2 CSS

```css
.markdown-body :is(h1,h2,h3,h4,h5,h6) { position: relative; }
.markdown-body :is(h1,h2,h3,h4,h5,h6)::before {
  content: "" / "";
  position: absolute; top: 0; right: calc(100% + var(--space-2));
  font-size: var(--text-2xs); font-weight: var(--fw-semibold);
  line-height: var(--lh-tight); letter-spacing: var(--tracking-label);
  color: var(--text-muted); white-space: nowrap;
  visibility: hidden; pointer-events: none; user-select: none;
}
.markdown-body h1::before { content: "H1" / ""; }   /* h2…h6 likewise */
.markdown-body.hybrid-editing :is(h1,h2,h3,h4,h5,h6):hover::before,
.markdown-body :is(h1,h2,h3,h4,h5,h6)[data-hybrid-level]::before { visibility: visible; }
.markdown-body :is(li,blockquote,table) :is(h1,h2,h3,h4,h5,h6)::before { display: none; }
```

### 9.3 The caret half, in `hybrid.js`

About forty lines, structured like `list-edit.js:318-340`: on `selectionchange`, take the
selection's anchor node, walk to the nearest `h1`–`h6` inside `#viewer-content`, mark it, and
clear the previous one. A selection that spans blocks is not a caret, so it clears instead.
Clearing sweeps every marked heading and also runs from a `focusout` listener on
`#viewer-content` and from hybrid exit: a click on the outline or a side panel moves focus
without firing `selectionchange`. No DOM is added and no renderer changes — the label is
generated by CSS.

### 9.4 Accessibility

`content: "…" / ""` gives the generated content an empty alternative text, so the heading's
name stays `Setup`, not `H2 Setup`. MDN marks the alternative-text slot Baseline, and
Chromium's ARIA snapshot reports the heading as `heading "Power path"` both at rest and with
the label shown. Firefox could not be launched in this environment, so **Firefox is
unverified**; if an older engine rejects the `/ ""` slot the whole declaration is invalid
and the label simply does not render, which fails quietly. The fallback would be an
`aria-hidden` span emitted by the renderer (one change in `viewer.js`). Exposure is small
either way: the label is `visibility: hidden` at rest, and a screen-reader user never
hovers. The label is not a control, so it is absent from the tab order and announces
nothing.

### 9.5 Promises this changes

| Doc | Now | Becomes |
|---|---|---|
| `hybrid-mode.md` §3 | "No generic block chrome", heading row: hover none, caret none | Heading row: one non-interactive `Hn` label, pointer over it or caret inside it. It takes no click, cannot be dragged and opens no menu, so the rule's target (an outline, a drag handle, a per-block menu) still holds |
| `reader.md` §2.5, §11 | "no heading hover state", "no chrome in the page" | Read mode keeps both promises in full: no label, no hover state. The 9 px `Hn` label is hybrid-only, on the caret's heading or under the pointer while editing |
| `reader.md` §2.2, §7.2, AC4 | h4–h6 at prose size, only h1 ruled | V4's ladder: h2 hairline, h4 1.05 em, h5 `.95em` uppercase, h6 `.9em` muted |

### 9.6 Cost and what is not proposed

Cost: ~40 CSS lines and ~45 JS lines, no markup, no renderer, no test allowlist
(`typography.md` already owns the badge role at 9 px). The outline keeps the whole-tree
view; the label answers one heading at a time.

Not proposed now: making the label a chip that opens a level menu (change h2 to h3 without
retyping). It would be the better long-term control, but it turns the label into chrome
that takes a click — `hybrid-mode.md` §3 rejects a per-block menu — and it needs a menu,
a picker and a keyboard contract of its own. If the label proves useful, that is the next
step, not this one.

### 9.7 As shipped

Five deltas from §9.2/§9.3, each recorded where it lives:

| Item | §9 said | Ships as |
|---|---|---|
| Scope | both modes | hybrid only. The pointer reveal is gated on `.markdown-body.hybrid-editing`, and `[data-hybrid-level]` is written only while the editor is active, so the render surface shows no label |
| Alignment | `top: 0` | `top: var(--space-hair)`. A pixel scan in Chromium put the label's cap 2 px high on h2 at `top: 0`; one hair step centres the error at ±2 px across the ramp (`style.css:3690-3692`) |
| Attribute | `data-level-live` | `data-hybrid-level`. The prefix makes `isChromeAttr` strip it from the change hash and the serialized note with no list edit (`hybrid.js` `LEVEL_ATTR`) |
| Generated content | one shared `content: "" / ""` | one rule per level, `content: "Hn" / ""`; the shared rule would not carry the level |
| Blur | "clear on blur" | a `focusout` listener on `#viewer-content`, and the clear sweeps every `[data-hybrid-level]` rather than trusting one node: a snapshot restore re-inserts the attribute on fresh nodes |

Two more facts: the AI panel keeps its own flat `.ai-prose-span` h3–h6 ramp
(`style.css:5826-5833`), because `ai-panel.md` owns it and an assistant reply is not a note
the user structures; and the h1 rule moved from a literal `1px` to `var(--stroke-1)` so the
two heading rules cannot drift.

Measured in the app at 1.0: the badge is 9 px / 10.8, 13.94 px wide, its left edge 22 px
inside the 40 px gutter; h5/h6 render at 13.3 / 12.6 px; the phone hides the badge at 390.

