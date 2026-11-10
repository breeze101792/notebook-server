# Design guidelines — how the set is built

Status: Current spec — the rulebook for every document in `docs/ui/`.

This is the document to follow when you write, review, or build any surface in this
folder. It does not define a new surface. It defines the rules the surface docs already
share, the exceptions that are allowed, and how to tell a spec from a proposal.

Read [`foundations.md`](foundations.md) and [`controls.md`](controls.md) first. This file
sits above the surface docs: where a surface doc and this file disagree, the surface doc is
wrong.

---

## 1. The document format

Every `docs/ui/*.md` follows the same shape.

| Part | Rule |
|---|---|
| Title | `# Surface — what it is` |
| Status | `Current spec — pre-implementation` for a target, or `Design record — shipped` for history |
| Mockup | one relative link; the mockup is illustrative, the doc is normative |
| Normative source | what this doc owns, what it reads, and which other doc owns the rest |
| Prerequisite | token landing and any other pass that must land first |
| Body | numbered sections, tables over prose |
| Exceptions | applied changes, each with the pixel delta |
| Proposals | visual or behavioural changes **not** applied |
| Acceptance criteria | numbered `AC1…ACn`, each observable, each naming files/tests |
| What not to build | the boundary |

A document that changes a pixel must say so twice: in the exception table and in the
section that owns the value. "Same pixels" is a claim to verify, not a default.

### 1.1 Exceptions and proposals

| Kind | Where it goes | May change a pixel? |
|---|---|---|
| Missing ARIA, roles, labels, keyboard | body + exception table | no |
| Contrast fix mandated by foundations | exception table | yes, listed |
| Layout or density change approved by the user | exception table | yes, listed |
| Anything else visual or behavioural | proposals table | no |

Rules:

1. An exception has a reason, the old value, the new value, and the pixel delta.
2. A proposal is never drawn in the main mockup.
3. A document may not claim "the shipped look" and apply an unlisted visual delta.
4. A user approval is recorded with the date and the surface.

---

## 2. The control style contract

One ladder for every form and button in the app. A surface that departs from it is an
exception in its own doc.

| Control | Height | Face | Text | Border | Radius |
|---|---|---|---|---|---|
| Text field, search, select, textarea (single line) | `--control-h-lg` 36 | `--surface-well` | `--text-ui` | `--border-strong` | `--radius-sm` |
| Button, secondary | `--control-h-md` 30 | `--surface-raised` | `--text-ui` | `--border-strong` | `--radius-sm` |
| Button, primary | 30 | `--accent` | `--text-on-accent` | `--accent` | `--radius-sm` |
| Icon button | 24 / 30 / 32 / 36 by role | transparent | `--text-muted` | none | `--radius-sm` |
| Chip / filter pill | 30 | `--surface-raised` | `--text-ui` | `--border-strong` | `--radius-pill` |
| Switch track | 36 × 20 | `--surface-well` off, `--accent` on | — | `--border-strong` | `--radius-pill` |
| Table cell control | 32 (`--control-h-body`) | transparent | `--text-ui` | none | `--radius-xs` |

| State | Rule |
|---|---|
| Hover (secondary) | `--accent-soft` face, `--accent` border |
| Hover (primary) | face unchanged, 3 px `--accent-soft` halo; never `filter: brightness()` |
| Hover (ghost) | `--accent-soft` face, `--text-primary` |
| Hover (danger) | face unchanged, inset 1 px `--danger` ring |
| Focus-visible | `--focus-ring` at `--focus-offset` (2 px); rows and clipped scrollers use `--focus-offset-inset` (−2 px) |
| Disabled | `--opacity-disabled` (.45), no hover, `cursor: not-allowed` |
| Busy | `aria-busy="true"`, label + `…`, `cursor: progress` |
| Invalid | `--danger` border, `aria-invalid`, `aria-describedby`; on a `--danger-soft` block use `--text-primary` |

**The one exception to the ladder is the edit bar.** The markdown toolbar is 26 px high with
26 px buttons, because it is a dense formatting strip above the reader. The modal edit bar is
44 px. Both keep the focus ring at +1 px; see §4.

---

## 3. Tokens

| Tier | Where | Rule |
|---|---|---|
| Base | `:root` and `body[data-theme="light"]` | Historical names (`--bg`, `--fg`, `--accent`). Never renamed. |
| Semantic | the same two theme blocks | `--surface-*`, `--text-*`, `--focus-*`, `--overlay-*`, `--selection-*`; aliases repeated per theme |
| Primitive | a `:root` block after the themes | numbers: space, radius, stroke, z, duration, control heights, icons |
| Component | the doc that owns the component | declared where every consumer can see them |

Rules:

1. A component token that is used outside its component's DOM scope is declared on `:root`
   or on a shared ancestor, not on the component's inner wrapper.
2. `em` values stay on the element whose font size they follow. A component token that
   holds `em` is declared on the prose root, not on `:root`.
3. A component token never aliases itself, and never aliases back into a base token.
4. A token that is an exact duplicate of a foundation token is deleted, and its consumers
   read the foundation token.
5. Runtime-set names (`--nb-w`, `--m-kb`, `--settings-modal-*`) are allowlisted in the
   foundations check; they are not declared in the stylesheet. A component-local name may
   carry a documented fallback (`var(--stg-nav-w, 180px)`); a fallback is not a substitution
   for declaring a value the component owns.

---

## 4. Layout and surface ownership

| Surface | Owner | Reads |
|---|---|---|
| Tokens, type, space, elevation, motion, breakpoints | [`foundations.md`](foundations.md) | — |
| Control anatomy, states, focus, ARIA | [`controls.md`](controls.md) | foundations |
| Desktop shell, topbar, rail, side panel, outline, phone conversion | [`shell-frame.md`](shell-frame.md) | foundations, controls |
| Tab strip | [`tab-bar.md`](tab-bar.md) | foundations, controls |
| Side-panel views | [`side-panel-views.md`](side-panel-views.md) | shell-frame, controls |
| Search | [`search-view.md`](search-view.md) | side-panel-views |
| AI panel | [`ai-panel.md`](ai-panel.md) | side-panel-views |
| Reader prose | [`reader.md`](reader.md) | foundations |
| Rendered blocks | [`content-blocks.md`](content-blocks.md) | reader |
| Shared modal chrome | [`edit-window.md`](edit-window.md) | foundations, controls |
| Table editor body | [`table-editor.md`](table-editor.md) | edit-window |
| Diagram designer bodies | [`diagram-designers.md`](diagram-designers.md) | edit-window |
| Settings content | [`settings-modal.md`](settings-modal.md) | edit-window (chrome) |
| Auth, workspace, session, export | [`dialogs.md`](dialogs.md) | edit-window (chrome) |
| Full-screen viewers | [`lightboxes.md`](lightboxes.md) | controls |
| Source editor | [`source-editor.md`](source-editor.md) | shell-frame, reader |
| WYSIWYG mode | [`hybrid-mode.md`](hybrid-mode.md) | reader, content-blocks |
| Graph view | [`graph-view.md`](graph-view.md) | shell-frame |
| Phone shell | [`mobile-shell.md`](mobile-shell.md) | shell-frame |
| Welcome and app-level empties | [`welcome.md`](welcome.md) | shell-frame, reader |

**Chrome vs content.** The reader and its blocks are content; their palette is the content
palette. The shell, modals, panels and controls are chrome; their palette is the UI palette.
A content surface (a Graphviz card, the WaveDrom white skin, an image) keeps its own colours
and is exempt from the UI palette.

**Modal chrome.** `edit-window.md` owns `.settings-modal`: overlay, box, header, footer,
drag, resize, maximize, focus containment. A surface that uses it owns only its body and
footer content. Settings and the dialogs reference it; they do not redefine its geometry.

---

## 5. Geometry canon

| Thing | Value |
|---|---|
| Topbar | 46 px desktop, 52 + inset phone |
| Activity rail | 48 px desktop, 56 + inset phone |
| Side panel | 240 default, 140 floor, 480 cap |
| Outline | 220 default, 520 cap |
| Tab bar | 34 px |
| Markdown edit bar | 63 px at 772 (2 rows), 119 at 353 (4 rows) |
| Modal edit bar | 57 px line, 44 px controls |
| Modal box | `min(1320px, 96vw) × min(85vh, 92vh)` |
| Settings box | `min(75vw, 96vw) × min(85vh, 92vh)` |
| Dialog boxes | 420 (auth/workspace/session), 520 (export) |
| Phone drawer | `min(86vw, 340px)` |
| Phone sheet | 72 dvh cap, 560 max, radius 16 top |
| Phone rail | 56 + inset, five views |
| Phone targets | 44 × 44 |
| Phone fields | 16 px type (stops iOS zoom) |

Anything that departs from this table is an exception in the owning doc.

---

## 6. The exception registry

These are shipped or approved exceptions. Do not "fix" one without changing its doc and
recording the decision.

| Surface | Exception | Why |
|---|---|---|
| Explorer tree | Shipped look: 18 px guide cells, continuous `-3px` strokes, 22 px rows, accent text | The user chose this look; only ARIA/keyboard change |
| Search + Recent | Cursor row is a listbox option, wash + `--text-primary` without weight or bar | A transient keyboard cursor is not a selection |
| Markdown edit bar | 26 px controls, +1 px focus offset | Dense formatting strip |
| Auth / workspace / session / export | +1 px focus offset | The dialog body pads by 14–18 px; an outset 2 px ring would touch the seam |
| Edit-window bar | 44 px line; 32 px tools | Modal chrome |
| Table preview controls | 24 px toggle, ≈22 px buttons | Reader table chrome; 24 px floor is P17 in `content-blocks.md` |
| Lightbox controls | 28 px, radius 5, white 2 px focus ring | They sit over an arbitrary image; a dark ring disappears |
| Lightbox pill | `.55` face, full-white percentage, `.28` border | 4.74:1 over a white diagram |
| Settings + dialogs | 36 px fields, 30 px buttons | Unified control layer |
| Settings switch | 36 × 20, native checkbox | The shipped switch contract |
| Content cards | Own tokens on the block | Diagram libraries own their skin |
| Graph canvas | `--graph-*-rgb` triples | Canvas needs full colour strings |
| Phone rail | Five views: Explorer, Pinned, Bookmarks, Recent, Search | AI, Sessions, graph, settings, logout are not phone views |
| AI phone | Not present | The user rejected it |

---

## 7. Mockups

Every doc has one sibling `*-mockup.html`.

| Rule | Detail |
|---|---|
| Self-contained | no network asset, no web font, no script dependency |
| Themes | dark and light, side by side or a toggle |
| Tokens | the same names and values as the doc; no cycles |
| Boards | every state the doc names; the real copy |
| No invented states | if the doc does not specify it, do not draw it |
| Geometry | the shipped numbers, labelled |
| Accessibility | focus, roles and labels shown where they are part of the spec |

A mockup that draws a look the doc forbids is a defect in the mockup. Fix the mockup, not
the doc.

---

## 8. Cross-doc review checklist

Before a surface doc is handed to `build`:

1. **Header.** Status, mockup link, normative source, prerequisite.
2. **Ownership.** Every element has one owner; the doc names what it does not own.
3. **Tokens.** Every `var()` resolves; component tokens are declared where used; no
   self-reference; `em` on the right element.
4. **Values.** Every geometry, colour and type value traces to `style.css` or a foundation
   token.
5. **Exceptions.** Every pixel change is in the exception table with a reason; everything
   else visual is a proposal.
6. **Cross-doc.** The shared facts match §5 and §6 (phone rail, edit bar, fields, focus,
   disabled, modal chrome).
7. **States.** Default, hover, focus, disabled, busy, invalid, empty, loading, error,
   long-content, narrow, phone.
8. **ARIA and keyboard.** Roles, names, focus order, trap/return, shortcuts.
9. **Tests.** Every AC names a file; any existing test that constrains a value is listed.
10. **Mockup.** Opens offline, both themes, zero errors.
11. **Links.** Every relative link resolves.

---

## 9. What still needs a decision

These are real gaps, not defects in a doc:

| Gap | Where |
|---|---|
| The graph has no phone surface (deliberate) | `graph-view.md` §7 |
| The phone rail keeps five views; Settings/Logout are two taps deeper | `mobile-shell.md` §13 |
| The Settings desktop modal at 390 is 292 px; the phone uses the sheet | `settings-modal.md` P2 |
| Image lightbox, sticky table headers, MathML for display math | proposals in `content-blocks.md` |

---

## 10. Using this file

- New surface: copy the document format, read the ownership row, follow §2–§6, write the
  ACs, then the mockup.
- Change to a shipped surface: write the new spec, list the delta, then implement.
- Review: run §8 top to bottom. A surface that fails any item is not ready.
