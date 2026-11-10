# Source editor — the Markdown editing surface

Status: Current spec — shipped surface, codified. §8.3 holds the only changes: seven
accessibility and consistency additions. Nothing else in this document alters what ships.

Reference mockup: [`source-editor-mockup.html`](source-editor-mockup.html) — dark and light
side by side: the CodeMirror surface close up, source-only, split, the bar state strip
(clean / dirty / saving / saved), a save error, the draft bar, the four open menus, 861, 720
and 390. Standalone, no network assets.

**Normative source.** This document owns the Markdown source editing surface: `#edit-toggle`,
`#edit-bar`, `#edit-split`, `#cm-host`, `#draft-bar` and the edit-mode state of
`#topbar` and `#tab-bar`. It **codifies the shipped look** and does not redesign it. It
reads [`foundations.md`](foundations.md) for tokens, [`controls.md`](controls.md) for the
control contract, and [`shell-frame.md`](shell-frame.md) for the frame and the focus order.

Out of scope, named but never specified here: the rendered preview
([`reader.md`](reader.md), [`content-blocks.md`](content-blocks.md)), WYSIWYG/edit-on-page
mode ([`hybrid-mode.md`](hybrid-mode.md)), the three edit-window modals
([`edit-window.md`](edit-window.md), [`table-editor.md`](table-editor.md),
[`diagram-designers.md`](diagram-designers.md)), and the tab bar ([`tab-bar.md`](tab-bar.md))
beyond the dirty dot.

`_edit_window.html` carries a **different** bar (`.edit-bar`, 57 px,
`--edit-bar-tool: 32px` at `style.css:8535-8540`). It is not `#edit-bar`. Nothing in this
document describes it.

Paths: `style.css` is `static/css/style.css`; `index.html` is `templates/index.html`.
Every claim about current code cites `file:line`. Every geometry figure was measured in
Chromium at 1280 × 800 with the default panes (`--font-scale: 1`), not estimated.

---

## 1. Modes and layout

### 1.1 Three states of the editor column

`#editor-pane` is a flex column: `#tab-bar` (34 px) → `#edit-bar` (0 when closed) →
`#edit-split` (`style.css:462-468`, `:473-494`, `:2534-2540`).

| State | `#edit-bar` | `#edit-split` | Children visible | Source |
|---|---|---|---|---|
| **Preview** | hidden | column | `#viewer` (or `#welcome`, or a special tab) | `index.html:367-385`; `viewer.js:601-627` |
| **Source only** | shown | column | `#cm-host` only | `viewer.js:657-677` |
| **Split** | shown | **row** (`.split`) | `#cm-host` left, `#viewer` right | `viewer.js:662-664`; `style.css:2541-2556` |

Edit mode always starts in **split** (`showPreview = true`, `viewer.js:919`). `Preview`
toggles the right pane without leaving edit mode (`viewer.js:1164-1180`). The split is a
true 50 / 50: measured 386.5 px for `#cm-host` and 385.5 px for `#viewer` in a 772 px
column, the 1 px difference matching the host's `border-right` (`style.css:2544-2549`).

The preview in split is a live re-render of the buffer, debounced 150 ms
(`viewer.js:510-518`, `:1154-1159`). It is the same renderer as the reader: the split only
changes the page padding to `16px 24px var(--viewer-tail)` (`style.css:2554-2556`) so the
narrower pane keeps a visible gutter. Prose, blocks and type are the reader's.

### 1.2 Entry and exit

| Route | Condition | Result | Source |
|---|---|---|---|
| `#edit-toggle` click | a file is open | `viewer.toggleEdit()` | `index.html:181`; `app.js:713`; `viewer.js:958-965` |
| `Mod+E` | a file is open, no modal | same; rebindable in Settings | `shortcuts.js:58`, `:286`, `app.js:783` |
| `:q` / `:q!` / `:wq` | vim on, editor focused | `closeEdit()` / `forceCloseEdit()` / save then close | `cm-bridge.js:176-195` |
| `Close` | edit mode | `closeEdit()`, prompts when dirty | `viewer.js:1193`, `:939-952` |
| `Ctrl/Cmd+B`, `Ctrl/Cmd+I` | editor focused | bold / italic | `cm-bridge.js:164-165` |
| `Ctrl/Cmd+S` | edit mode | save | `shortcuts.js:50`; `viewer.js:1057-1075` |
| `Esc` | editor focused | **does not exit.** Vim: insert → normal. Plain CM: collapse selection | `cm-bridge.js:157-166`, `:319-363`; `vimnav.js:160-170` |

`Esc` is not an exit route and must not become one: it is the vim mode switch
(`vimnav.js:373-376` says so in the shipped help). Exit is `Mod+E`, `Close`, `:q`, `:q!`
or `:wq`.

Entering from hybrid mode first ends that session (`viewer.js:961-963`), because both
surfaces write over the reader and would otherwise both be live.

### 1.3 What stays mounted

Nothing is torn down on a mode change except visibility.

| Element | Preview | Source | Split | Note |
|---|---|---|---|---|
| `#viewer`, `#viewer-scroll`, `#viewer-content` | visible | `hidden` | visible | Never re-created; the render is an `innerHTML` swap (`viewer.js:434`) |
| `#cm-host` and the CM6 view | `hidden` | visible | visible | The view is created once, lazily, and reused (`cm-bridge.js:120-124`, `:126-213`) |
| The buffer | kept in `t.content` | live in CM | live in CM | `endEdit` copies the buffer back (`viewer.js:924-932`) |
| `#edit-bar` | `hidden` | visible | visible | `[hidden]` is the switch, not a class (`style.css:583`) |

Creating the CM6 view is deferred to the first edit (`cm-bridge.js:30-34`, `:120-124`), so a
reader who never edits never downloads the 738 KB bundle. A `hidden` host still holds the
view: `showViewer()` blurs it explicitly before hiding so `hasFocus` cannot stay true and
swallow the shell keymap (`viewer.js:604-610`).

### 1.4 Scroll ownership

| Container | Owns | Source |
|---|---|---|
| `#editor-pane` | `overflow: hidden`; the frame | `style.css:462-468` |
| `#edit-split` | `overflow: hidden`; the row / column | `:2534-2540` |
| `#cm-host` | `overflow: auto`, but nothing overflows it — `.cm-editor` is `height: 100%` | `:2478-2496` |
| `.cm-scroller` | **the editor scroller**: `overflow: auto` from CM6, 22.4 px per line | CM base theme; `cm-bridge.js:595-596` |
| `#viewer-scroll` | the preview scroller (reader owns it) | `reader.md` §1.1 |

`NB.cmEditor.scrollDOM()` returns `.cm-scroller`, and that is what the scroll sync reads
(`cm-bridge.js:595-596`; `viewer.js:574-581`). The outer `overflow: auto` on `#cm-host` has
no scrolling content; it is kept because a view that has not measured yet can overflow for
one frame.

In split, scrolling either pane moves the other proportionally, in both directions, with a
re-entrancy guard released on the next animation frame (`viewer.js:557-581`). `showViewer()`
removes both listeners, so preview mode never syncs (`viewer.js:616-618`).

### 1.5 Bar height, measured

`#edit-bar` wraps (`style.css:577`), so its height depends on the column width. Nothing
else in the column is fixed to it.

| Editor column | Rows | Bar height | Source |
|---|---|---|---|
| 772 (1280, default panes) | 2 | **63 px** | measured |
| 353 (861, default panes) | 4 | **119 px** | measured |
| phone | 1 (strip) | 52 px | `style.css:7102` |

`shell-frame.md` §1.1 shows 63 at 772 and 119 at 353 for this bar. The 57 px figure is the
edit-window token (`--edit-bar-h`, `style.css:8535`), not this bar.

---

## 2. Edit bar

### 2.1 Every control, in order

Markup: `index.html:295-365`. Groups appear below as the bar draws them, left to right.

| # | Group | Control | `data-act` / id | Does | Source |
|---|---|---|---|---|---|
| 1 | History | `↶` Undo | `undo` | CM history undo | `index.html:296`; `editbar.js:778-786` |
| | | `↷` Redo | `redo` | CM history redo | `:297`; `editbar.js:787-794` |
| 2 | Headings | `H1`…`H6` | `h1`…`h6` | Prefix every touched line; clicking the same level again strips the prefix | `:299-304`; `editbar.js:660-666`, `:404-410` |
| 3 | Inline | `B` | `bold` | Wrap `**…**`, else insert `**bold text**` selected | `:306`; `editbar.js:654`, `:367-372` |
| | | `I` | `italic` | Wrap `*…*` | `:307` |
| | | `S` | `strike` | Wrap `~~…~~` | `:308` |
| | | `</>` | `code` | Wrap `` `…` `` | `:309` |
| 4 | Lists | `• List` | `ul` | Bullet the touched lines; pressing again unlists the block | `:311`; `editbar.js:668`, `:470-500` |
| | | `1. List` | `ol` | Numbered list, same toggle | `:312` |
| | | `☑` | `task` | Task item `- [ ] `, same toggle | `:313` |
| | | `>` | `quote` | `> ` prefix per line, or strip when all quoted | `:314`; `editbar.js:668-670` |
| | | `☰` | `list-menu` | Opens the list menu (2 items) | `:315-321`; `editbar.js:681-694` |
| 5 | Insert | `🔗` | `link` | `prompt()` for the URL, wrap `[label](url)` | `:323`; `editbar.js:697-705` |
| | | `🖼` | `image` | `prompt()` for the URL, wrap `![alt](url)` | `:324`; `editbar.js:706-714` |
| | | `😀` | `emoji` | Opens the emoji picker | `:325-332`; `editbar.js:717-722`, `:255-267` |
| | | `{}` | `codeblock` | Insert a fenced block around the selection, else `` ```\ncode\n``` `` | `:333`; `editbar.js:727-733` |
| | | `Examples ▾` | `example-menu` | Opens the example menu (6 rows, one flyout) | `:334-337`; `editbar.js:733-741`, `:341-362` |
| | | `──` | `hr` | `---` on its own line | `:338`; `editbar.js:743-758` |
| 6 | Table | `▦` | `table-menu` | Opens the table menu (14 items) | `:340-358`; `editbar.js:819-822` |
| 7 | Cleanup | `Tx` | `clear` | Strip heading, quote, list and task prefixes and inline emphasis; fences and links survive | `:360`; `editbar.js:795-817` |
| 8 | Mode | `Preview` | `#preview-btn` | Toggles the split; label never changes | `:362`; `viewer.js:1164-1180` |
| | | `Save` | `#save-btn` | Writes, stays in edit mode; `hidden` when clean | `:363`; `viewer.js:736-765`, `:536` |
| | | `Close` | `#close-edit-btn` | Exits; `.unsaved` dot + accent border when dirty | `:364`; `viewer.js:939-952`, `:537` |

`Preview` is a state button with a fixed label — the accent fill carries "on"
(`style.css:2660-2663`), and `tests/dom/test_dom.js:7110-7112` and `:7146-7148` assert the
label stays `Preview` in both states. Do not rename it to "Hide preview".

`Save` is the only control the bar hides at rest. Its `hidden` attribute must win over
`display: inline-flex`; the stylesheet carries an explicit override
(`style.css:1144-1149`).

### 2.2 Geometry

| Property | Value | Token | Source |
|---|---|---|---|
| Row | `display: flex; align-items: center; flex-wrap: wrap` | — | `style.css:574-577` |
| Gap | 2 px | `--space-hair` | `:578` |
| Padding | `4px 8px` | `--space-1` `--space-2` | `:579` |
| Face | `--bg-panel` | `--surface-panel` | `:580` |
| Seam | `1px solid --border` bottom | `--stroke-1` | `:581` |
| Button box | `min-width: 28px; height: 26px; padding: 0 6px` | — (see §10 P12) | `:584-590` |
| Button radius | 4 px | `--radius-xs` | `:594` |
| Button type | `.93rem`, line-height 1 | `--text-ui-lg`, `--lh-flat` | `:597-598` |
| Button face | transparent, `--fg-muted` text, 1 px transparent border | `--text-muted` | `:591-593` |
| Separator | `1 × 18px`, `margin: 0 4px`, `--border` | `--border` | `:609-615` |
| Actions group | `gap: 4px; margin-left: auto` | `--space-1` | `:1163-1168` |
| `Save` | `--accent` text, weight 600 | `--accent`, `--fw-semibold` | `:1170-1173` |

Measured: a glyph button is 28 × 26; `Preview` is 64.7 × 26; `Close` is 49.5 × 26 (61.3 when
`.unsaved` adds the dot). The bar's own box is 63 px tall at 772 and 119 px at 353.

Text buttons grow with their label; `H1`–`H6` sit on the 28 px floor. There is no icon
sprite in this bar yet — the glyphs are characters (foundations §9.3 lists them for
replacement; §10 P11).

### 2.3 Wrapping, overflow, scroll

| Surface | Behaviour | Source |
|---|---|---|
| Desktop `#edit-bar` | `flex-wrap: wrap`. No scroller, no mask, no "more" button | `style.css:576-577` |
| Phone `#edit-bar` | `flex-wrap: nowrap`, horizontal scroll, hidden scrollbar, sticky action group | `:7098-7111`, `:7123-7133` |

There is no third behaviour and no overflow menu: every control stays one click away,
which is why the bar grows a row instead of hiding buttons. `controls.md` §2.3 records the
same rule and forbids a fourth overflow model.

Consequences that follow from wrapping and are shipped:

1. `margin-left: auto` on `.eb-actions` pins the group to the right edge **of the last
   row** (`style.css:1167`). At 772 the group sits on row 2; at 861 it sits on row 4.
2. A menu anchored to a row-1 button opens over row 2. The emoji panel does exactly that
   (`top: 100%` of `.eb-emoji-wrap`, `style.css:679-694`; measured y = 112, bar bottom
   143).
3. The menus open downward with no flip and no max-height (`style.css:618-633`), so a tall
   menu can pass the viewport floor. The table menu is 428 px tall. See §10 P4.

### 2.4 The four overflow menus

One appearance: four top-level panels plus the Mermaid flyout. All are `position: absolute; top: 100%; margin-top: 2px;
z-index: 100`, `--bg-panel`, `1px --border`, radius 6, `--shadow-pop` literal, padding 4,
`gap: 2px`, hidden by the `hidden` attribute (`style.css:618-634`).

| Menu | Anchor | Placement | Width | Item | Content | Source |
|---|---|---|---|---|---|---|
| List | `☰` | `right: 0` | `min-width: 180px` | 28 px | Move item up, Move item down. Both `disabled` + `aria-disabled` unless the caret is on a list line, decided on open | `style.css:618-639`; `editbar.js:681-694` |
| Table | `▦` | `left: 0` | `min-width: 170px`, measured 170 | 28 px | 14 items, in this order: Insert table, Move row up, Move row down, Move column left, Move column right, Align column (cycle), Insert row above, Insert row below, Delete row, Insert column left, Insert column right, Delete column, Toggle header row, Delete table | `index.html:342-357`; `style.css:643-648` |
| Examples | `Examples ▾` | `left: 0` | `min-width: 170px` | 28 px | 6 rows from `NB.blocks.exampleGroups()`: Mermaid ▸, WaveDrom timing, Math (KaTeX), Graphviz graph, HTML preview, SVG drawing. The whole trigger hides when the registry is empty | `style.css:651-656`; `editbar.js:341-362` |
| Mermaid flyout | `Mermaid ▸` | `left: 100%; top: 0; margin-left: 2px` | `min-width: 150px`, measured 160 | 28 px | Flowchart, Sequence, Pie, State, Class, ER, Gantt schedule, Timeline | `style.css:659-673` |
| Emoji | `😀` | `left: 0` | 268 px | see below | search field, 6 category tabs, 8-column grid | `style.css:679-753` |

Item text is left-aligned and full width (`style.css:635-639`); the flyout marker is `▸`
from `::after` (`:661-666`).

**Emoji panel parts.** Panel padding 6, gap 6, radius 6 (`:679-694`). Search field 26 px
tall, `--bg-elev` face, `1px --border`, radius 4, `.85rem` (`:696-707`). Category tabs 24 px
tall, one equal-width cell each, `.95rem`; active = `--accent-soft` face + `--accent` border
+ `--fg` text (`:708-728`). Grid 8 columns of 30 px with a 2 px gap, `max-height: 208px`,
scrolls (`:729-735`); a tile is 30 px, `1.05rem`, hover `--accent-soft` (`:736-746`). The
grid is built from the curated `EMOJI_CATEGORIES` table, deduplicated, emoji inserted as
text nodes (`editbar.js:42-200`, `:230-253`). The search field takes focus when the panel
opens (`editbar.js:255-260`).

Opening one menu closes any other: the new trigger sits outside the other wrappers, and the
document click handler hides every menu whose wrapper was not clicked (`editbar.js:1054-1065`).
`Esc` closes nothing today — that is E5.

### 2.5 Button states

| State | Paint | Source |
|---|---|---|
| rest | transparent face, `--fg-muted` text, transparent 1 px border | `style.css:591-593` |
| hover | `--accent-soft` face, `--fg` text | `:600-603` |
| pressed | `--accent` face, white text — **2.61:1 in dark**; E1 fixes it to `--text-on-accent` | `:604` |
| focus-visible | **none today**; E4 adds the shared ring | foundations §10.3; `controls.md` §3.1 |
| `Save` at rest | `--accent` text, weight 600 | `:1170-1173` |
| `Save` hover | `--accent` face, white text — 2.61:1 dark; E1 | `:1174` |
| `Preview` on | `--accent` face, white text — 2.61:1 dark; E1 | `:2660-2663` |
| `Close` dirty | `--accent` text + `--accent` border + a 9 px `●` after the label | `:1153-1160` |
| disabled (list menu only) | native `disabled` + `aria-disabled`, but **no visual difference**: the `.eb` rule sets its own colour and `cursor: pointer`, so the UA greying never shows. The only cue is that hover and click do nothing (§10 P15) | `editbar.js:689`; `style.css:584-599` |
| hidden | `display: none` via `#edit-bar .eb[hidden]` | `style.css:1149` |

There is no selected state for `H1`–`H6`, `B`, `I`: the buttons do not reflect the caret's
line. That is shipped and deliberate — the bar is stateless (`editbar.js` has no
selection-change hook; the list menu decides its two disabled states on open).

### 2.6 Phone strip

Source editor: **there is none on a phone.** `#cm-host` is `display: none` inside the phone
query (`style.css:7085-7087`) and the bar is suppressed unless a WYSIWYG layer is open
(`body:not(.edit-open) #edit-bar { display: none }`, `:7112-7114`). The phone strip below is
the shipped bar as the WYSIWYG surface uses it; it is documented here because it is one
markup, and `hybrid-mode.md` owns its behaviour.

| Property | Value | Source |
|---|---|---|
| Height | `calc(--m-hit + 8px)` = 52 px, `flex-wrap: nowrap` | `style.css:7102`, `:7100` |
| Padding | `4px` + 6 px + safe-area, per side | `:7103-7104` |
| Scroll | `overflow-x: auto`, scrollbar hidden, `overscroll-behavior-x: contain` | `:7105-7111` |
| Button | `min-width: 44px; height: 44px; padding: 0 8px; font-size: 15px` | `:7115-7121` |
| Separator | `flex: 0 0 1px; margin: 0 2px` | `:7122` |
| Action group | `order: -1`, `position: sticky; left: 0`, `padding-right: 6px`, `--bg-panel` face, right-edge shadow `6px 0 8px -6px rgba(0,0,0,.45)` | `:7123-7133` |
| Save / primary | filled `--accent`, `--accent-fg` text — the only place the bar fills by default | `:7135-7142` |
| Flyout groups | List, Table, Examples, Emoji are `display: none` | `:7143-7146` |
| Measured | scroll width 1293 px in a 390 px strip; the sticky action group holds Save and Done (Preview is hidden in hybrid) | measured |

The strip therefore shows: `Save` `Done` (pinned; Preview is hidden in hybrid), then `↶ ↷ | H1 … H6 | B I S </>
| • List 1. List ☑ > | 🔗 🖼 {} ── | Tx` in one scrollable line.

---

## 3. CodeMirror surface

### 3.1 Extensions and theme

`cm.basicSetup`, `cm.markdown()`, `EditorView.lineWrapping`, a vim compartment, a
`Prec.high` keymap for `Mod-b` / `Mod-i`, and an update listener (`cm-bridge.js:135-174`).

There is **no** `EditorView.theme()` call and no `darkTheme` facet. Every colour in the
editor therefore comes from CM6's `baseTheme`, whose values are selected by a
`&light` / `&dark` prefix on the **editor theme class**, not by the page theme. With no dark
facet the view is always `&light`, in both themes. This is the root of the selection and
find-panel colours below.

The theme is CSS overrides, five rules (`style.css:2478-2525`).

### 3.2 Type and measure

| Property | Value | Source |
|---|---|---|
| Font | `1rem/1.6 "SFMono-Regular", Menlo, Consolas, monospace` | `style.css:2492` |
| Size @1.0 / @1.3 | 14 / 18.2 px; line 22.4 / 29.1 px | `:2492`, `:138` |
| Face | `--bg` (page), text `--fg` | `:2493-2494`, `:2496` |
| Content padding | `16px 40px 16px 8px` | `:2505` |
| Text origin | gutter 40.6 + 8 padding + 6 line inset = **54.6 px** from the host's left edge | `:2505`; CM base `.cm-line { padding: 0 2px 0 6px }` |
| Max width | none — the editor fills the host, wrapping at the pane edge | `:2479-2482`; `cm-bridge.js:147` |
| Caret colour (declared) | `--fg` | `:2506` |

The 40 px right padding matches the reader's `--viewer-pad-x`, deliberately
(`style.css:2502-2504`). In split it does **not** shrink to the preview's 24 px, so the two
panes have different inner gutters at the seam. See §10 P7.

`lineWrapping` means there is never a horizontal scrollbar in the editor
(`cm-bridge.js:143-147`): a long line wraps, exactly as the preview does.

### 3.3 Gutters

| Property | Value | Source |
|---|---|---|
| Gutter face | `--bg`, text `--fg-muted` | `style.css:2508-2511` |
| Gutter seam | `1px solid --border` right | `:2511` |
| Line-number cell | `min-width: 20px; padding: 0 3px 0 5px; text-align: right`, CM base, measured 25.8 px at 2-digit numbers | CM base |
| **Fold column** | `13.7 px`, **visible**, with `▾` chevrons on foldable lines | measured; see below |
| Total gutter | 40.6 px at 1280 | measured |
| Gutter height | one cell per line, at the 22.4 px line height | CM base |

`style.css:2516-2518` sets `#cm-host .cm-foldGutter { display: none }` with the comment
"remove it from the layout entirely". **It does not work**: CM6's base theme declares
`.cm-gutter { display: flex !important }`, and `!important` beats the id rule. The empty
13.7 px column and its chevrons still render, between the line numbers and the text. That is
the shipped look and is codified here as-is. §10 P1 proposes the one-line repair; it is not
applied because it removes 13.7 px the user currently sees.

The gutter is not interactive and not focusable; folding is bound by `basicSetup` but has no
affordance beyond the chevron.

### 3.4 Active line, selection, cursor

| Element | Shipped | Source |
|---|---|---|
| Active line | `rgba(127, 127, 127, .08)` — one literal, identical in both themes | `style.css:2519-2521` |
| Active line number | same wash, text `--fg` (not muted) | `:2522-2525` |
| Selection, focused | **`#d7d4f0`** — CM's light focused selection, in both themes | measured; CM base `&light.cm-focused … .cm-selectionBackground` |
| Selection, unfocused | `#d9d9d9` — the same light palette | CM base `&light .cm-selectionBackground` |
| Native caret | **suppressed**: `.cm-content` computes `caret-color: rgba(0, 0, 0, 0)`, so the stylesheet's `--fg` value never paints | measured |
| Cursor (drawn) | `1.2px solid black` in both themes, drawn by CM in `.cm-cursor` | measured `rgb(0,0,0)`; CM base `.cm-cursor` |
| Bracket match | `#328c8252` / `#bb555544` (CM base) | CM base |

Two failures follow, and both are E2 / E3:

- The dark selection wash is a **light lavender** on a `#1a1b1f` page. The selected text
  stays `--fg`, so it is near-invisible inside the selection.
- The dark cursor is black on `#1a1b1f` — about 1.05:1. `caret-color: var(--fg)`
  (`style.css:2506`) does not help: the content computes `caret-color: rgba(0,0,0,0)`
  (measured), and the drawn bar is what you see.

`selection` here means the CM layer, not `::selection`. The foundation's global
`::selection` rule (Appendix A) never reaches this surface.

### 3.5 Find panel

`basicSetup` includes `searchKeymap`, so `Mod+F` inside the editor opens CM6's search panel.
(The comment at `cm-bridge.js:140` claims the panel is opt-in; it is not. Correct it when
that file is next touched.)

| Property | Shipped | Source |
|---|---|---|
| Trigger | `Mod+F`; `F3` / `Mod+G` next and previous; `Esc` closes when the panel is focused | CM base keymap |
| Placement | bottom, `position: sticky`, `z-index: 300`, `bottom: 0`, inside the editor box | measured |
| Height | 74.2 px (two wrapped rows of controls at 386.5 px of editor width) | measured |
| Face | `#f5f5f5` with black text — the light theme, in both themes | measured |
| Contents | Find field, `next` `previous` `all` `match case` `regexp` `by word` `replace` `replace all`, `×` | measured |
| Focus | the find field takes focus on open | measured |

It is readable but off-theme in dark mode. §10 P2 covers a themed panel; nothing is applied
because the panel is CM's own DOM and restyling it is a visible change to a surface the user
has not asked to change.

### 3.6 Vim

Vim is the same editor with a keymap swapped through a `Compartment`
(`cm-bridge.js:148-151`, `:559-586`). Three vendor patches ride on it: the visual-line head
fix, the no-op scroll fix, and Escape ownership (`cm-bridge.js:57-374`).

| Property | Shipped | Source |
|---|---|---|
| Mode indicator | **none.** `cm.vim()` is called without `{ status: true }`, so no `.cm-vim-panel` is mounted | `cm-bridge.js:151`; CM vim extension |
| Normal-mode cursor | a full block, `background: #ff9696` (pink), text painted over it | CM vim theme, measured |
| Unfocused block | `background: none; outline: 1px solid #ff9696; color: transparent` | CM vim theme |
| Insert indicator | the block disappears and the bar cursor returns | CM vim |
| Ex commands | `:w` save, `:q` close (prompt when dirty), `:q!` discard, `:wq` save + close | `cm-bridge.js:176-195` |
| `:help` overlay | the shell's own overlay, not the editor's | `vimnav.js:360-430` |
| Effect on the bar | **the bar hides itself** in source mode when vim is on | `editbar.js:985-1005` |
| Effect on keys | the shell keymap yields to CM while it has focus; `Mod+E` and `Alt+H/L` still work | `vimnav.js:160-170`; `shortcuts.js:331-334` |

The bar hiding under vim is shipped and intentional: vim users drive the editor from the
keyboard and use `:w` / `:q` (`editbar.js:985-990`). It means a vim user has no visible
Save button; `Mod+S` and `:w` remain. §10 P10 proposes a mode indicator only.

The block cursor paints `#ff9696` behind the character and keeps the editor text colour for
the glyph: in dark that is `#e6e6ea` on pink, about 1.9:1. It is vendor appearance that vim
users read as "normal mode", so it is recorded here and proposed as P16 rather than changed.

### 3.7 Markdown highlighting

`markdown()` plus `defaultHighlightStyle` (inside `basicSetup`) — the light palette, in both
themes. Heading text is bold, markers (`#`, `>`, `-`) are drawn muted, and code tokens use
the light tag colours (`#940` comment, `#a11` string, `#708` keyword, and so on). There is no
`highlightStyle` override in `cm-bridge.js`.

On the dark page the weights and the muted markers read correctly; the coloured code tokens
are the light palette's. §10 P2 is the same repair as the find panel.

---

## 4. Save, dirty, draft, exit

### 4.1 Dirty

`isDirty(path)` is true when `t.draft` exists, or when the live buffer differs from
`savedContent` (`viewer.js:880-885`). Every change re-evaluates it and emits
`viewer:dirty-changed` (`viewer.js:1154-1159`).

Three indicators, all driven by that one flag:

| Indicator | Clean | Dirty | Source |
|---|---|---|---|
| `Save` button | `hidden` | shown | `viewer.js:536`; `index.html:363` |
| `Close` button | plain | `.unsaved`: accent text, accent border, `●` after the label | `viewer.js:537`; `style.css:1153-1160` |
| File tab | plain | `.dirty`: `--accent-soft` face, accent border, 8 px dot before the label | `style.css:1207-1217` (owned by `tab-bar.md`) |

### 4.2 Save

`Save` and `Mod+S` both call `viewer.save()` (`viewer.js:1057-1075`), which writes through
`writeSourceSave` (`:736-765`): buffer → `POST /api/file` → `savedContent` updated → draft
cleared → draft bar hidden → toolbar refreshed → file re-fetched for the new mtime.

Save **stays in edit mode** and hides its own button (`viewer.js:749-751`). A close that
arrives while the POST is in flight waits for it before deciding dirty (`viewer.js:1077-1083`,
`:939-941`).

There is no saving state in the UI. The button stays live and unchanged for the whole
request (§5, §10 P3).

### 4.3 Preview toggle

`Preview` flips `showPreview` and re-renders the buffer into the right pane; the editor keeps
focus (`viewer.js:1164-1180`). The label is constant; only the accent fill changes
(`style.css:2660-2663`). Source-only is therefore: bar + editor, no preview, `.split`
removed.

### 4.4 Close, and unsaved changes

`closeEdit()` awaits a pending save, then, if dirty, calls the **native** `confirm()`:

```
You have unsaved changes in "<path>".

Discard them and exit edit mode?
```

Accept reverts the buffer to `savedContent` and exits; Cancel stays in edit mode with the
edits (`viewer.js:939-952`). `:q!` and `forceCloseEdit()` skip the prompt (`:971-976`).

The native dialog is shipped and is the only blocking prompt in this surface. It is not the
design-system dialog (§10 P6).

Exiting renders `savedContent`, not the discarded buffer (`viewer.js:924-932`).

### 4.5 Draft bar

`#draft-bar` is the recovery path for a buffer that was stashed by a tab switch
(`viewer.js:1023-1047`). It is **fixed**, centred, above the bottom edge:

| Property | Value | Source |
|---|---|---|
| Position | `fixed; left: 50%; translateX(-50%)`; desktop `bottom: calc(24px + env(safe-area-inset-bottom))`; phone bottom clears the 56 px rail: `calc(var(--m-rail-h) + var(--space-4) + env(safe-area-inset-bottom))` | `style.css:7791-7795` |
| Band | `--z-draft` 80 | `:7796` |
| Box | `max-width: min(560px, 100vw − 32px)`, padding `10px 12px`, gap 10, radius 8, `--bg-elev`, `1px --border`, `--shadow-pop`, `.85rem` | `:7800-7806` |
| Message | `--fg-muted`, nowrap + ellipsis | `:7809-7814` |
| Button | padding `4px 10px`, radius 5, `1px --border`, transparent, `--fg`, measured 27.9 px tall | `:7815-7824` |
| `Recover` | accent border + accent text, listed first | `:7825-7828` |
| `Discard` | the neutral button | `index.html:393` |
| Hover | `background: var(--bg-hover)` — **`--bg-hover` is declared nowhere**, so the declaration is dead | `:7829`; foundations §11.3 |

Copy is exact: `Unsaved changes in "<name>" from before the switch.`
(`viewer.js:74`). `Recover` restarts edit mode on the saved bytes and then applies the draft
as one transaction, so `Ctrl+Z` returns to the saved file; it leaves the file dirty
(`viewer.js:83-106`). `Discard` drops the draft and re-renders the saved bytes (`:108-117`).

**It is a `role="status" aria-live="polite"` strip.** It never shows while the editor is open. The rule is `t.draft && !t.editMode &&
!hybridOn` (`viewer.js:66-76`); the bar belongs to the preview of a file whose buffer is
stashed. Recovering it is what puts you back in the editor. `updateDraftBar()` runs on
`render()`, `activate()` and `setDraft()`, not on `hybrid.enter()`, so a bar already visible on
the preview stays over the editable page. E8 calls it on enter.

### 4.6 Autosave

The source editor has **no autosave.** `cfg.autosave` and `cfg.autosaveDelay` drive WYSIWYG
mode only (`app.js:132-137`; `hybrid.js:6634-6683`). Save and `:w` are the only writes, so
the dirty dot and the `Save` button persist for as long as the buffer differs from disk. Do
not describe autosave as an editor feature.

### 4.7 Errors

| Failure | What the user sees | Source |
|---|---|---|
| Save rejected (read-only role, network) from the **button** | a toast: `Save failed: <message>` | `viewer.js:1183-1192`; `app.js:1154` |
| Save rejected from **`Mod+S`** | **nothing.** The shortcut dispatcher logs the rejection to the console | `shortcuts.js:335-338` |
| Save rejected from **`:w`** | **nothing.** The ex command ignores the returned promise, so the rejection is unhandled | `cm-bridge.js:178` |
| CM6 bundle fails to load | edit mode is entered anyway: the bar shows, the left pane is empty, and the first toolbar action throws. No message | `viewer.js:908-921`; `cm-bridge.js:106-124` |
| External change with a dirty buffer | native `confirm()`; Cancel keeps the edits and marks the tab a conflict | `viewer.js:1254-1266` |
| Watcher reload while editing | the buffer is replaced in place and the session stays | `viewer.js:1269-1280` |

---

## 5. States

| State | Bar | Editor | Preview | Notes | Source |
|---|---|---|---|---|---|
| **Clean** | `Save` hidden; `Close` plain; `Preview` filled | full buffer | live | The default after entering | `viewer.js:536-537` |
| **Dirty** | `Save` shown; `Close` `●`; tab dot | full buffer | live | Persists until save or exit | `:884`, `:1154-1159` |
| **Saving** | unchanged — no busy label, no disabled state | editable | live | A second click starts a second POST | §10 P3 |
| **Saved** | identical to clean | full buffer | live | Stays in edit mode | `viewer.js:749-751` |
| **Save error** | unchanged | editable | live | Toast only, from the button; silent from the keyboard | `:1183-1192` |
| **Read-only role** | `Save` shown as normal | editable, accepts typing | live | Nothing marks the file read-only; the first save fails | `viewer.js:1185-1188` |
| **No file** | hidden | hidden | welcome page | `#edit-toggle` does nothing (`toggleEdit` returns) | `viewer.js:958-959`, `:693-731` |
| **Very long file** | as clean/dirty | full file, wrapped, virtualised by CM6 | live, debounced | `setValue` replaces the whole doc in one transaction | `cm-bridge.js:507-516` |
| **CM6 load failure** | shown | empty pane, no message | live | Half-entered mode | `viewer.js:913-916` |
| **Vim on, source** | **hidden entirely** | full, block cursor | live | `:w` / `:q` replace the bar | `editbar.js:993-1005` |
| **Narrow (353)** | 4 rows, 119 px | 177 px wide | 176 px | No reflow beyond wrapping | measured |
| **Phone** | strip, no editor | `display: none` | phone reader | Source editing does not exist here | `style.css:7085-7087`, `:7112-7114` |

Two of these are gaps rather than states: *saving* has no representation, and *read-only*
has no signal beyond the failure. Both are proposals, not new designs (§10 P3, P8).

---

## 6. Keyboard and ARIA

### 6.1 Shipped

| Binding | Scope | Effect | Source |
|---|---|---|---|
| `Mod+E` | anywhere, no modal | enter / leave edit mode | `shortcuts.js:58`, `:286` |
| `Mod+S` | edit mode | save | `shortcuts.js:50`; `viewer.js:1057` |
| `Mod+B` / `Mod+I` | editor focused | bold / italic | `cm-bridge.js:164-165` |
| `Mod+F` | editor focused | CM find panel | CM `searchKeymap` |
| `Esc` | editor focused | vim insert → normal; plain CM collapses the selection | `cm-bridge.js:319-363` |
| `:w` `:q` `:q!` `:wq` | vim on, normal mode | save / close / discard / both | `cm-bridge.js:176-195` |
| `Tab` | bar | next control, DOM order | native |
| `Enter` / `Space` | bar | activate | native |

`Mod+Shift+E` (hybrid) is suppressed while the source editor is open and does nothing
(`shortcuts.js:331-334`).

### 6.2 The bar's ARIA today

| Item | Today | Source |
|---|---|---|
| `#edit-bar` | a plain `div` with no role and no name | `index.html:295` |
| Buttons | `<button>` with `title` only; no `aria-label`, no `aria-keyshortcuts` | `:296-364` |
| Glyph buttons (`↶ ↷ ☑ ☰ 🔗 🖼 😀 ▦ ── Tx {}`) | the accessible name is the character | same |
| `☰` `😀` `Examples ▾` `▦` | `aria-haspopup="true"`, **no `aria-expanded`** | `:316`, `:326`, `:335`, `:341` |
| Menus | `div` + `hidden`; no `role`, no name, no focus management | `:317-321`, `:327-331`, `:336`, `:342-357` |
| `Preview` | no `aria-pressed`; state is colour only | `:362` |
| Editor | CM6's `.cm-content` is `role="textbox" aria-multiline="true"` from the vendor view; no `aria-label` | CM base |
| Tab order | `#tab-bar` → `#edit-bar` → editor content → preview | `shell-frame.md` §7.1 |

Nothing on the bar is a Tab stop that a screen reader can name beyond its glyph. That is E5.

### 6.3 Focus

No control in `#edit-bar` draws a focus ring (`foundations.md` §10.3 lists `.eb` explicitly).
The editor content is focusable and CM draws no ring of its own; the browser's default focus
indicator on `.cm-content` is `outline: none` in CM's base theme, so the caret is the only
focus cue. That is correct for a text field and is not changed.

`showEditor()` moves focus into the editor on entry (`viewer.js:675`); `showViewer()` blurs
it on exit (`:610`). `Close` returns focus to the page body, not to `#edit-toggle` — §10 P9.

---

## 7. Responsive and phone

| Width | Shell | Bar | Editor / preview | Note |
|---|---|---|---|---|
| 1280 | desktop, column 772 | 2 rows, 63 px | 386.5 / 385.5 | the default |
| 1280 + XL | same | 2 rows at 1.0; the row count grows with the type because `--text-ui-lg` is rem | same | no px type in the bar |
| 861 | desktop, column 353 | **4 rows, 119 px** | 177 / 176 | a third of the column is toolbar |
| 860 | phone shell | strip only, no editor | no editor | `style.css:6975` |
| 720 | phone shell | strip, scrolls, 52 px | no editor | measured `--ui-mode: phone` |
| 520 | phone shell | strip | no editor | — |
| 390 | phone shell | strip, scrollWidth 1293 | no editor | sticky actions 240 px |

The only mode switch is 860 / 1023 (`foundations.md` §8.2). There is no source-editor
refinement between 1280 and 861: the bar wraps and the two panes halve. Below 860 the
surface does not exist.

`--font-scale` scales the bar's type (`--text-ui-lg` is rem) and the editor's font
(`1rem`), so at 1.3 the same column holds fewer controls per row and the editor shows fewer
lines; nothing clips. The 26 px button and the 40 px content padding are px and do not
scale, so at 1.3 the bar's buttons are tighter around larger text — shipped, and within the
foundation's 24 px floor.

---

## 8. Tokens and the CSS target

### 8.1 Reuse first

Every value below is already a foundation token or an existing stylesheet value with the
same meaning. No new colour is introduced.

**Foundation deltas.** Adopting the tokens also adopts foundations §3.6/§5.4: dark
`--fg-muted` `#9799a4` (the bar/gutter/draft text lightens) and the light `--shadow-pop`
alpha `.16` (the menus and draft bar lighten in the light theme). They are disclosed here,
as in `hybrid-mode.md`.

| Surface value | Token | Source |
|---|---|---|
| bar gap 2, padding 4 / 8, actions gap 4 | `--space-hair`, `--space-1`, `--space-2` | `style.css:578-579`, `:1165` |
| button radius 4, menu radius 6 | `--radius-xs`, `--radius-sm` | `:594`, `:626` |
| button type `.93rem` / lh 1 | `--text-ui-lg`, `--lh-flat` | `:597-598` |
| bar face, menu face | `--surface-panel` | `:580`, `:624` |
| button text, gutter text, draft message | `--text-muted` | `:592`, `:2510`, `:7810` |
| accent, accent wash, on-accent text | `--accent`, `--accent-soft`, `--text-on-accent` | `:604`, `:602`, `:2655` |
| seams, input borders, gutters | `--border` | `:581`, `:625`, `:2511` |
| editor face, page face | `--surface-page` | `:2493`, `:2483` |
| menu shadow, draft shadow | `--shadow-pop` (light alpha changes .35 → .16) | `:627`, `:7805` |
| menu band | `--z-popover` 1000; the shipped menus are 100, so the band rises. It stays below `--z-modal` 2000, so a menu never covers a dialog | `:622`, `:683` |
| draft band | `--z-draft` | `:7796` |
| focus ring, offsets | `--focus-ring`, `--focus-offset` | E4 |
| selection wash | `--selection-bg`, `--selection-text` | E2 |
| caret | `--fg` | E3 |

### 8.2 Values kept as literals, with the reason

| Value | Where | Why it stays |
|---|---|---|
| button `26px` height | `:589` | Between `--control-h-sm` 24 and `--control-h-md` 30. The bar's 26 is what the user sees; snapping to 30 changes 63 px → 71 px. §10 P12 |
| button `0 6px` padding, `min-width: 28px` | `:588-590` | 6 px is a half-step that predates the grid; the 28 floor keeps `H1`–`H6` square-ish |
| separator `18px`, `margin: 0 4px` | `:612-613` | 18 is not a rung; 20 (`--space-5`-tall) would move the seam |
| menu `min-width` 180 / 170 / 150 | `:632`, `:647`, `:655`, `:672` | Chosen per menu for its longest label |
| menu item `28px` | `:638` | `controls.md` §2.9 targets 32; changing it repaints every menu |
| editor padding `16px 40px 16px 8px` | `:2505` | The 40 is shared with the reader's `--viewer-pad-x` by intent, kept literal so the two can move independently |
| `rgba(127,127,127,.08)` active line | `:2520`, `:2523` | Theme-neutral by construction; a token would be a new colour |
| emoji panel `268px`, grid `30px`, `max-height: 208px` | `:685`, `:737`, `:733` | Panel geometry, no token family fits |
| phone `15px` button type | `:7120` | Touch size, inside the phone query only. It is also a px `font-size`, which `foundations.md` §4.4 does not allow; changing it would change the touch text size, so it is recorded, not repaired |

### 8.3 Applied exceptions

Seven additions. Each is accessibility or consistency, each is visual-neutral or replaces a
measured failure. Five are one declaration, one is a markup attribute pass with a little
`editbar.js`, and one is two selectors. None changes spacing, layout, or any colour at rest
except E1, which is a foundation-mandated label swap.

| # | Rule | Why | Cost |
|---|---|---|---|
| **E1** | In `#edit-bar .eb:active` (`:604`), `.eb-primary:hover` (`:1174`), `#edit-toggle.editing` (`:2655`), `#preview-btn.editing` (`:2662`): `color: var(--text-on-accent)`. | White on `#7c9cff` is **2.61:1**. This is the eight-rule defect `foundations.md` §3.6 already mandates; four of the eight are this surface's. It is not a new decision. | Dark labels go near-black on the accent; light is unchanged (`--accent-fg` is white there). |
| **E2** | `#cm-host .cm-selectionBackground { background: var(--selection-bg); }` and `#cm-host .cm-selectionBackground, #cm-host .cm-content ::selection { color: var(--selection-text); }` | Selection ships as `#d7d4f0` in **both** themes (CM light default). On the dark page the light text over that wash is unreadable. The reader already adopted the same pair (`reader.md` E1). | One rule; the id selector beats CM's five-class theme rule. Dark selected text: 8.2:1. |
| **E3** | `#cm-host .cm-cursor { border-left-color: var(--fg); }` | The drawn cursor is `1.2px solid black` in both themes; on `#1a1b1f` that is 1.05:1. | One line. Light `#000` → `#1f2330` (imperceptible); dark becomes visible. |
| **E4** | The bar joins the shared focus rule from `controls.md` §3.1: `:where(.icon-btn, …, #edit-bar .eb, …):focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-offset); }`. No separate rule, no new class. | No `.eb` control draws a ring today (`foundations.md` §10.3). | One rule that `controls.md` already specifies; zero specificity, so nothing else moves. |
| **E5** | Bar semantics: `#edit-bar` gets `role="toolbar" aria-label="Formatting"`; the eight groups are wrapped in `<span role="group" aria-label="…">` with **`display: contents`**, so no flex item moves; every glyph-only button gets `aria-label` equal to its `title` without the chord; the four menu triggers get `aria-expanded` (toggled in `editbar.js`) and keep `aria-haspopup`; `#preview-btn` gets `aria-pressed`. Plus: `Esc` closes the open menu and returns focus to its trigger. | The bar has no name, no group names, no expanded state and no `Esc` today; foundations §10.5 rule 2 requires `Esc` to close the topmost layer. The glyphs stay as characters inside `aria-hidden` spans, which is foundations §9.4's staging state. | Markup + ~15 lines of `editbar.js`, plus one `display: contents` rule. `role="toolbar"` promises a composite: E5 also adds one roving `tabindex="0"` across the bar and Left/Right/Home/End movement, so the role is true. `aria-haspopup` + `aria-expanded` on a panel that is not `role="menu"` is still inaccurate — P5 finishes the menu model. |
| **E6** | `#draft-bar .draft-bar-btn:hover { background: var(--accent-soft); }` (replaces the dead `var(--bg-hover)`). | `--bg-hover` is declared nowhere (`foundations.md` §11.3 names this exact line), so the hover paints nothing. `controls.md` §2.1 already assigns `.draft-bar-btn` the `--accent-soft` hover. | One token swap; hover appears for the first time. |
| **E7** | `#edit-bar .eb[aria-expanded="true"] { color: var(--accent); border-color: var(--accent); }` and `#edit-bar .eb[aria-pressed="true"] { border-color: var(--accent); }` | Expanded state must not be exposed to assistive tech only. A menu trigger that is open takes the same accent border `Close` uses when dirty; `Preview` keeps its accent fill (E1 supplies the label colour) and gains only the border, so no rule paints accent text on an accent face. | Two selectors, existing colours, no new paint. |

E1 must land with the foundation token block or with the shipped names (`--accent-fg`); E2,
E3, E6 read `--selection-bg`, `--selection-text`, `--fg`, `--accent-soft`, so they use the
foundation names from Appendix A. Until that block lands, substitute `--selection`,
`--fg`, `--accent-soft` — do not add a second set of tokens for this surface.

### 8.4 Order of work

1. E1 — four colour declarations, in place, one line each, with the measured ratio in a
   comment.
2. E4 — the `controls.md` §3.1 base rule, which lands once for the whole app.
3. E2, E3 — two rules appended to the CM block after `style.css:2525`.
4. E6 — one declaration inside the existing `#draft-bar` block.
5. E5, E7 — markup (`index.html:295-365`) and `editbar.js` wiring, in that order.
6. Nothing else in this surface is edited.

All seven are additive or single-value replacements. No rule is reordered and no class is
renamed.

---

## 9. Acceptance criteria

Each is observable in the app or in the mockup and names its file. AC8–AC13 are the applied
exceptions; the rest describe shipped behaviour.

| # | Criterion | File | Observable |
|---|---|---|---|
| **AC1** | Entering edit mode shows the bar and the split; the split is two equal panes | `static/js/viewer.js` | After `#edit-toggle`, `#cm-host` is not `hidden`, `#edit-split` has `.split`, and the two panes measure 386.5 / 385.5 in a 772 px column |
| **AC2** | `Preview` toggles the right pane and keeps the label `Preview` in both states | `index.html`, `viewer.js` | The viewer hides, `.split` is removed, and `#preview-btn.textContent` stays `Preview`; accent fill appears only when the pane is on |
| **AC3** | The bar wraps and never scrolls on desktop | `static/css/style.css` | At 1280 the bar is 63 px / 2 rows; at 861 it is 119 px / 4 rows; `scrollWidth === clientWidth` at both |
| **AC4** | Every control in §2.1 exists once, in that order | `templates/index.html` | 28 buttons in DOM order match the table (27 visible while clean); six separators divide seven groups and the action group is separated by `margin-left: auto`, not a rule |
| **AC5** | The four menus open downward from their trigger with the shipped geometry | `style.css` | Table / example menus are 170 px wide with 28 px items; the list menu is 180; the emoji panel is 268 × 284 with 8 × 30 px cells and a 208 px grid |
| **AC6** | The editor is 14 / 22.4 px mono, wrapping, with a 40.6 px gutter | `style.css` | Computed `font` on `.cm-editor` is `14px/22.4px SFMono-Regular…`; no horizontal scrollbar on a long line; the gutter measures 40.6 |
| **AC7** | Save stays in edit mode and hides itself; Close shows the unsaved dot | `viewer.js` | Type → `#save-btn` appears and `#close-edit-btn` gains `.unsaved`; click Save → both revert, `#cm-host` stays visible |
| **AC8** | An accent-filled bar label clears 4.5:1 in both themes | `style.css` | `#preview-btn.editing` dark text is `--text-on-accent` (6.99:1) |
| **AC9** | The editor selection uses the token pair | `style.css` | Selecting text in dark paints `rgba(124,156,255,.28)` over the page, not `#d7d4f0` |
| **AC10** | The drawn cursor is visible in both themes | `style.css` | `.cm-cursor` `border-left-color` equals `--fg`; dark reads ≥3:1 on `--bg` |
| **AC11** | Every bar control shows the shared 2 px ring on `:focus-visible` | `style.css` | Tabbing into the bar lands on `↶` with an accent ring at offset 2 |
| **AC12** | The bar has a name, named groups, and expanded / pressed state | `index.html`, `editbar.js` | `#edit-bar` has `role="toolbar"` + a label; opening `▦` sets `aria-expanded="true"`, shows the accent border (E7) and `Esc` closes it and focuses `▦`; `#preview-btn` carries `aria-pressed` |
| **AC13** | The draft-bar hover paints | `style.css` | Hovering `Discard` shows the `--accent-soft` face |
| **AC14** | The draft bar uses the shipped copy and never shows in edit mode | `viewer.js` | Switching tabs with a dirty buffer shows `Unsaved changes in "…" from before the switch.`; entering edit mode hides it; `Recover` reopens the editor dirty |
| **AC15** | Exit from a dirty buffer prompts and honours Cancel | `viewer.js` | `Close` with a dirty buffer calls `confirm`; declining keeps `#cm-host` visible; accepting renders `savedContent` |
| **AC16** | The phone has no source editor and shows the strip only for the WYSIWYG layer | `style.css` | At 390 `#cm-host` computes `display: none`; `#edit-bar` is `display: none` until `body.edit-open`; then it is 52 px with 44 px buttons and a sticky action group |
| **AC17** | Vim hides the bar in source mode | `editbar.js` | With vim on and edit mode open, `#edit-bar.hidden` is true; turning vim off restores it without re-entering edit mode |
| **AC18** | The mockup is self-contained and shows every board in both themes | `docs/ui/source-editor-mockup.html` | Opening the file offline shows the CM surface, source-only, split, the state strip, error, draft bar, menus, 861, 720 and 390 with zero network requests |

Tests that already cover part of this: `tests/dom/test_dom.js:7072-7194` (AC1, AC2, AC7,
AC15 via a stubbed `confirm`), `tests/browser/test_core_ui_browser.js:429-467` and
`:1984-2004` (entry, draft bar), `tests/browser/test_ai_editor_browser.js:242-243`,
`:404-416`, `:564-584` (entry/exit around an AI apply), `tests/browser/test_hybrid_browser.js`
(bar buttons driven in hybrid mode), `tests/browser/test_hybrid_blocks_browser.js:260-264`
(draft bar visibility).

---

## 10. Proposals, not applied

Nothing here is applied. Each names its reason and its cost.

| # | Proposal | Why | Cost |
|---|---|---|---|
| **P1** | Make the fold-gutter removal work: `#cm-host .cm-gutter.cm-foldGutter { display: none !important }`, or drop `foldGutter` from the extension list in `cm-bridge.js`. | `style.css:2516-2518` does nothing against CM's `.cm-gutter { display: flex !important }`. A 13.7 px empty column with chevrons sits between numbers and text, against the comment's stated intent. | Removes 13.7 px of gutter and the fold chevrons — a visible change to the shipped look. Dropping `foldGutter` also removes the keymap. |
| **P2** | Give the editor a dark facet: `EditorView.theme({}, { dark: true })` when `body` has no light theme, or per-class token rules for `.cm-panels`, `.cm-searchMatch`, `.cm-selectionMatch` and the highlight style. | Every CM colour is the `&light` value in both themes: the find panel is `#f5f5f5`, search matches are `#ffff0054`, syntax tokens use the light tag palette. Readable, off-theme. | A theme object has to re-evaluate on a theme switch (a Compartment or a re-dispatch), plus a token pass over CM's class names. The find panel and the match colours are visible changes. |
| **P3** | A saving state: `#save-btn` → `Saving…`, `aria-busy="true"`, disabled, `cursor: progress`, per `controls.md` §2.1. | A save is a network round trip; today the button looks identical before, during and after, and a second click posts a second write. | Label mutation + disable + restore; must not double-fire `pendingSave`. |
| **P4** | Menu placement: flip up when the menu would pass the viewport, and cap the table menu with `max-height` + scroll. | `top: 100%` with no flip and no cap (`style.css:618-633`). The table menu is 428 px; under the last row at 861 it ends about 630 px down the window, so any window shorter than that clips its last items. | A measurement pass in `editbar.js` on open, plus a `.is-up` class. |
| **P5** | Finish the menu model: `role="menu"` + `role="menuitem"`, arrow-key walk, focus into the first item on open, `Tab` closes. | E5 stops at `aria-expanded`, because the panels are not menus and promising menu keys would be a lie. `controls.md` §2.9 already owns this contract for five instances. | ~60 lines in `editbar.js`, and the hybrid tests that click bar menus must still pass (they click by `data-act`, so they should). |
| **P6** | Replace the native `confirm()` on a dirty close with the dialog frame (`controls.md` §2.11): title, body naming the file, `Discard` (danger) and `Cancel`. | The prompt is a browser string with a path in it; it cannot be themed, cannot be read in the app's own type, and blocks the frame. | One dialog + `NB.dialog` wiring; `tests/dom/test_dom.js:7160` stubs `window.confirm` and would need the dialog path. |
| **P7** | In split, drop the editor's right padding from 40 to 24 so both panes share a gutter. | Shipped: editor right 40, preview right 24 (`style.css:2505` vs `:2555`). At the seam the two text columns start their margins differently. | One declaration inside `.edit-split.split #cm-host .cm-content`; a visible change at the seam. |
| **P8** | A read-only signal: when the server rejects the write, mark the file read-only in the bar (a `Read-only` badge, `Save` disabled) instead of failing per click. | A viewer role can type indefinitely and only learns at save time, once per attempt. | Needs the save error to be classified (403 vs other) and a per-file flag. |
| **P9** | Return focus to `#edit-toggle` (or the bar's first control) when the editor closes. | `Close` and `Mod+E` drop focus to the body; the next `Tab` restarts at the top of the shell. | One `focus()` call in `endEdit`, guarded for the phone and for a tab switch. |
| **P10** | A vim mode indicator: a 20 px line at the bottom of the split showing `-- INSERT --` / `-- NORMAL --`. | `cm.vim()` is called without `{ status: true }`, so the mode is shown only by the block cursor, and the bar is hidden in vim mode. A first-time vim user has no text cue. | A status strip is a new element inside the editor column; it changes the shipped look and the split height. |
| **P11** | Sprite the bar glyphs: `↶ ↷ ☑ ☰ 🔗 🖼 😀 ▦ ── {} Tx` and the `📝` topbar toggle become `<use>` symbols at `--icon-md`. | Foundations §9.3 lists them. E5 puts the character in an `aria-hidden` span, which is the stated staging state, not the target. | New symbols, one per glyph, plus the topbar. Every one is a visible repaint; emoji are the widest. |
| **P12** | Two bar heights, one rule: either snap buttons to `--control-h-md` 30 (bar 71 px at 772) or add `--eb-h: 26px` to the primitive block and read it. | 26 px is the only control height in the app outside the 24 / 30 / 36 / 44 ladder. | Snapping changes every screenshot and the 861 stack (119 → 143). The token keeps the look and costs one declaration. |
| **P13** | Snap the draft bar's buttons to `--control-h-md` and `--radius-sm`. | Shipped `4px 10px` padding on `.85rem` measures 27.9 px, and radius is 5 px — the rounding slip `foundations.md` §5.2 names. | Two declarations; the bar grows 2 px. |
| **P14** | At 861, replace wrapping with a priority overflow: the first N controls, then a `⋯` menu. | Four rows take 119 px of a 353 px column, a third of the writing area. | A new overflow model, which `controls.md` §2.3 forbids adding; it is a redesign of the bar, not a fix. |
| **P15** | A disabled paint for `.eb:disabled`: `opacity: var(--opacity-disabled)` and `cursor: not-allowed`, per `controls.md` §1.3. | The two list-move items are disabled off a list line, but the `.eb` rule overrides the UA's greying, so they look identical to enabled items and only fail silently on click. | Two declarations; the list menu gains a visible state it never had. |
| **P16** | Tokenise the vim block cursor: `background: var(--accent)`, glyph `var(--text-on-accent)`, unfocused outline `var(--accent)`. | The block is `#ff9696` with the editor's text colour on top — about 1.9:1 in dark. It is the only mode cue, so its glyph should be legible. | Changes the vim cursor colour for every vim user; two vendor classes to override. |

---

## 11. What not to build

- **No new bar surface.** No second toolbar, no floating format bubble over the editor, no
  per-line gutter buttons. This bar is the only formatting UI for source mode.
- **No auto-hiding bar.** The bar is hidden by `[hidden]` or by vim mode. It never fades on
  scroll, never collapses to icons, never becomes a ribbon.
- **No "More" menu on desktop.** Wrapping is the shipped overflow model for this bar; a
  fourth model is forbidden by `controls.md` §2.3.
- **No rich text in the editor.** The surface edits Markdown bytes. No rendered headings, no
  WYSIWYG blocks, no inline images. That is hybrid mode, and it is a different document.
- **No autosave.** Source mode writes on `Save`, `Mod+S`, `:w`, `:wq` only.
- **No changed selection, cursor, active-line or gutter colour beyond E2 and E3.** The
  shipped editor look is the target; P1, P2 and P16 are proposals, not instructions.
- **No reading max-width in the split, no third pane, no resizable divider.** The split is
  50 / 50 (`viewer.js:662-664`).
- **No second scrollbar in the editor.** `.cm-scroller` scrolls; `#cm-host` must not.
- **No native dialog replacement without P6.** Do not invent a second confirm.
- **No theme-specific geometry.** A colour changes with the theme; a size does not
  (`foundations.md` P4).
- **No colour literal.** Every colour is a token; the shipped literals in §8.2 are recorded,
  not copied forward.
- **No new key binding for exit.** `Esc` stays the vim mode switch.
