# Typography — the role contract

Status: Current spec — pre-implementation. Every token below exists in
`static/css/style.css:192-288`; the roles are what call sites do not yet follow.

Reference mockup: the type specimen is §4 of [`foundations-mockup.html`](foundations-mockup.html);
the one control that shows the scale is §2 and §2b of [`settings-modal-mockup.html`](settings-modal-mockup.html).
This document has no mockup of its own — it is a token binding and a set of rules, and the
specimen already exists next door.

**Normative source.** This document owns: the role table, the rule for choosing a role, the retired
literal list, how layout follows the scale, and the pairing rules. It reads
[`foundations.md`](foundations.md) §4 for token names and values and §10.6 for zoom,
[`reader.md`](reader.md) for the prose em ramp, and [`controls.md`](controls.md) for control
anatomy. It does **not** own: token enforcement, the lint rule, or the test seams — those are
`docs/architecture/typography.md`; icon sizes — foundations §9; the reader's heading ramp —
`reader.md`; the phone sheet's segmented control — [`settings-modal.md`](settings-modal.md) §9.3.

Abbreviations: `style.css` = `static/css/style.css`; `app.js` = `static/js/app.js`;
`index.html` = `templates/index.html`.

---

## 1. The scale

One multiplier, four settings. `--font-scale` is written on `<html>` by the server for the first
paint and by the client on every change.

| Setting | Radio value | `--font-scale` | Root | Source |
|---|---|---|---|---|
| **S** | `small` | `0.9` | 12.6 px | `app.js:259-264` |
| **M** | `medium` | `1.0` | 14 px | `app.js:259-264` |
| **L** | `large` | `1.15` | 16.1 px | `app.js:259-264` |
| **XL** | `xlarge` | `1.3` | 18.2 px | `app.js:259-264` |

The root is `html { font-size: calc(14px * var(--font-scale, 1)) }` (`style.css:292-297`), the
default is `--font-scale: 1` (`style.css:36`), the server writes the first value inline
(`index.html:2`), and the client rewrites it on change (`app.js:265-273`).

Every px figure in this document is that root × the token's rem value. Rem scales; px does not.

---

## 2. The roles

Eight roles over seven steps. A role fixes the size, the weight range and the line height. Two roles
share `--text-body`: the **row** role and the **body** role. A panel row and the note it opens are the
two things the user reads at reading size, so they take the same step; the line height and the
context differ, and those are what the role names carry.

| Role | Token | S px | M px | L px | XL px | Weight | Line height | Used for |
|---|---|---|---|---|---|---|---|---|
| **display** | `--text-lg` `1.15rem` | 14.5 | 16.1 | 18.5 | 20.9 | 600 | `--lh-tight` 1.2 | The name of the surface: dialog and window titles |
| **body** | `--text-body` `1rem` | 12.6 | 14.0 | 16.1 | 18.2 | 400 | `--lh-normal` 1.5 (phone prose and the AI log `--lh-prose` 1.65) | Note prose, rendered blocks, AI message text |
| **row** | `--text-body` `1rem` | 12.6 | 14.0 | 16.1 | 18.2 | 400–500 | `--lh-snug` 1.35 | Primary text of a side-panel row: file, session, bookmark, recent file, search hit |
| **navigation** | `--text-ui-lg` `.93rem` | 11.7 | 13.0 | 15.0 | 16.9 | 400–600 | `--lh-snug` 1.35 | Tabs, topbar controls, nav items, Settings labels and values |
| **control** | `--text-ui` `.86rem` | 10.8 | 12.0 | 13.8 | 15.7 | 400–600 | `--lh-flat` in a fixed-height control, else `--lh-snug` | Buttons, chips, fields, menu items |
| **meta** | `--text-sm` `.8rem` | 10.1 | 11.2 | 12.9 | 14.6 | 400 | `--lh-snug` 1.35 | Paths, snippets, dates, helper and status lines, counts |
| **label** | `--text-xs` `.72rem` | 9.1 | 10.1 | 11.6 | 13.1 | 400–600 | `--lh-tight` 1.2 + `--tracking-label` | Panel titles, section and group titles, uppercase labels. 400 is the quiet variant (a panel header), 600 the loud one (a group title in a form) |
| **badge** | `--text-2xs` `9px` | 9 | 9 | 9 | 9 | 600 | `--lh-tight` 1.2 | Count badges and specimen captions. Fixed: it never scales |

Line heights and weights are the foundation tokens (`style.css:205-216`). `--fw-heading` 650 and
`--lh-prose` 1.65 belong to the reader and are not chrome roles.

**A row is one size in every panel.** The tree, Sessions, Pinned, Bookmarks, Recent and the Search
hit list all set their primary text to `--text-body`; the AI message takes it too, as prose. Two
panels that disagree about this are a defect, whatever the source. The runtime audit in
`docs/testing/typography.md` asserts the equality directly.

**Measured at L (Chromium, `--font-scale: 1.15`):** root and rows 16.1, tabs 14.97, controls 13.85, meta
12.88, panel titles 11.59. Each one is its token's L column carried to two decimals: `1rem` →
16.1, `.93rem` → 14.973, `.86rem` → 13.846, `.8rem` → 12.88, `.72rem` → 11.592. The scale is
consistent; what is missing is coverage at the remaining call sites (§2.1) and a control that shows
it (§8).

### 2.1 Where each role lives today

The row role landed: every side-panel row in the table below measures 16.1 px at L. The right-hand
column is the remaining backlog — the call sites that still carry a literal, measured in Chromium at
L. Each one becomes its role token in the migration the architecture doc orders.

| Role | Correct call sites | Remaining literal call sites (px at L) |
|---|---|---|
| display | — | `.settings-header h2` `1.14rem` (`style.css:2118-2121`), `.edit-heading h2` `1.14rem` (`:8816-8820`): **+0.1 px** to the token |
| body | `body` `1rem/1.5` (`:303`); phone prose `calc(16px * var(--font-scale))` (`:7689`); `.ai-msg-assistant > .ai-prose-span` `var(--text-body)` (`:5320-5326`); `.ai-user-text` (`:5311-5318`) | — |
| row | `.tree-name`, `.session-name`, `.recent-name`, `.bookmark-name`, `.search-panel-hit-file` — all `var(--text-body)`, 16.1 | `.pin-name` `15px` inside the phone block (`:7562`), out of scope |
| navigation | `.tab` `var(--text-ui-lg)` (`:1392`); `.settings-nav-item` `.93rem` (`:2162`); `.settings-label` `.93rem` (`:1688`, `:2233`); `.settings-value` `.93rem` (`:2306`) | `#topbar button` `.93rem` (`:357`); `.ws-row-label` `.95rem` (15.3); `.shortcut-label` `.95rem` (15.3); `#brand` `.93rem` at 700 with `.3px` tracking (kept, §6.3) |
| control | Settings chips `var(--text-ui)` (`:1845`); `.settings-action` `var(--text-ui)` (`:2365`) | `.settings-text-input` `.9rem` (`:2290`, 14.5); `.font-size-options label` `.93rem` (`:2354`, replaced by the tile row, §8); search filter chips `.76rem` (12.2); search filter glyph `.74rem` (11.9); `.shortcut-binding` `.9rem` (14.5) |
| meta | `.ws-row-path`, `.sp-file` and the other `.8rem` rows (22 sites) | `.settings-help` `.86rem` (`:1677`) and `.settings-note` `.86rem` (`:1678`) sit one role high (13.8); `.settings-hint` `.78rem` (`:1679`, 12.6); `.settings-watch-status` `.82rem` (13.2) |
| label | `.panel-title` `var(--text-xs)` (`:531-541`, font at `:537`); the Settings section heading `var(--text-xs)` (`:1663`) | `.settings-form-title` `.74rem` (`:1671`, 11.9); `.search-panel-filter-label` `.66rem` (10.6); the older `.settings-section h3` `.79rem` rule at `:2211` is overridden and should be deleted |
| badge | count badges at `9px` (`:1355`) | designer selection badge `.64rem` (`:7078`) — scales when a badge must not |

---

## 3. Choosing a role

Ask in this order. The first match wins; stop there.

1. **Is it a word the user reads as a note, or a block rendered from one?** → **body**. This includes
   an AI message in the assistant panel: it is rendered markdown, not chrome.
2. **Does it name the surface it sits in** — the title at the top of a dialog or window? → **display**.
   One per surface.
3. **Is it the primary text of a side-panel row** — the file, session, bookmark or hit the row is
   about? → **row**. One size in every panel, never `.93` or `.86` "because this panel is denser".
4. **Is it a way to move between surfaces** — a tab, a topbar control, a nav item? → **navigation**.
5. **Can the user click it, type in it, or is it the text of the thing they click?** → **control**.
6. **Does it describe another element rather than being it** — a path, a snippet, a date, a count,
   a hint, a status word? → **meta**.
7. **Is it a heading for a group of things, drawn uppercase?** → **label**.
8. **Is it a number or a short caption inside a badge-sized box?** → **badge**.

Three rules complete the choice:

- **One role per element.** A weight change is allowed inside the role's range (a selected tab goes
  to 600). A size change is not: if a element needs to look bigger, the role was wrong, not the size.
- **An element never takes two roles.** A label is not partly navigation and partly meta.
- **Role by function; size breaks the tie.** When two roles fit the function equally, take the one
  whose px is nearest the shipped value, so the migration delta stays honest. This is the only
  place size may decide.

A component that needs a rank the table does not have is a new role, and a new role is a change to
this document before it is a change to the stylesheet.

---

## 4. Current state

| Finding | Evidence | Verdict |
|---|---|---|
| The multiplier is applied once, on `<html>` | `style.css:292-297`, `app.js:268` | correct — one place, two writers (server and client) agree |
| The measured surfaces resolve to role tokens | §2 measured line | correct — rows 16.1, tabs 14.97, controls 13.85, meta 12.88, titles 11.59 |
| All seven side panels agree on the row role | Chromium at L, 1280 wide: Explorer, Sessions, Pinned, Bookmarks, Recent, Search and AI | correct — every row is `--text-body`; `docs/testing/typography.md` now asserts it |
| Only 66 of 314 `font-size` declarations read a token | `grep -c "font-size"` = 314; 197 are `rem` literals, 51 are `px` literals, 66 are `var(--text-*)` | **the defect** — surface drift is a call-site problem, not a scale problem |
| 36 distinct literal sizes exist | `grep -oE "font-size: *[0-9.]+rem"` → 36 values | the ladder in §6 retires 30 of them |
| The scale is invisible in the Settings control | `index.html:966-971` shows `S M L XL` at one size (`.93rem`, `style.css:2354`) | **the defect** — see §8 |

Enforcement, the lint rule and the test seam that keeps this ratio monotonic belong to
`docs/architecture/typography.md`. This document states the target; that document states how a
regression is caught.

---

## 5. Layout follows the scale

Two kinds of height. Content-sized heights follow the scale for free; fixed heights must be
checked against the XL column.

### 5.1 Content-sized: nothing to do

A row that pads by a token grows with its line box. `.settings-row { padding: 6px 0 }`
(`style.css:2223-2236`) has no height, so a row at XL is taller by exactly the line-box delta of its
roles. The same holds for `.settings-nav-item` (`:2154-2168`) and every menu row.

### 5.2 Fixed heights: check the XL column

The tallest text each height can hold, at XL, with the role's line height:

A line box is the role's px × the line height the rule sets; a rule that sets none inherits body's
1.5 (`style.css:303`).

| Thing | Height | Tallest role it holds | Line box + padding + border at XL | Verdict |
|---|---|---|---|---|
| Tab bar | `calc(34px * var(--font-scale))` = 44.2 at XL (`style.css:690`) | navigation 16.9, inherited 1.5 | 25.4 + 8 + 1 = 34.4 | scales; 9.8 px of slack |
| Topbar | `--topbar-h` 46 (`:29`) | navigation 16.9, inherited 1.5 | 25.4 + 10 + 2 = 37.4 | fits, 8.6 px of slack |
| Button | `--control-h-md` 30 (`:264`) | control 15.7, `--lh-flat` | 15.7 + 0 + 2 = 17.7 | fits |
| Field | `--control-h-lg` 36 (`:266`) | control 15.7, inherited 1.5 | 23.5 + 8 + 2 = 33.5 | fits, 2.5 px of slack |
| Table cell control | `--control-h-body` 32 (`:265`) | control 15.7, inherited 1.5 | 23.5 + 0 + 0 = 23.5 | fits |
| Icon button | `--control-h-sm` 24 (`:263`) | none — it holds an SVG, not text | — | fits |
| Touch target | `--control-h-touch` 44 (`:267`) | control 15.7, inherited 1.5 | 23.5 | fits |

Rules:

1. **A fixed height is sized for XL, not for M.** The check is
   `role_px(XL) × line_height + 2 × padding + 2 × border ≤ height`. The field is the tightest at
   2.5 px; nothing in the table may lose padding or gain a role.
2. **A height that holds a role which scales must scale too.** The tab bar is the exemplar
   (`calc(34px * var(--font-scale))`); it is why the tab text never clips at XL.
3. **A height fixed by something other than its text does not scale.** The 44 px touch floor and
   the 72 × 52 preview tile (§8) are the two cases.
4. **Never set a height to fit the text at M.** At XL it clips, and the fix is then a second height.

### 5.3 The four fixed sizes

`--text-2xs` 9 px, the 16 px touch field (`style.css:8013`), and the 8–11 px decorative glyphs
inside content cards are the sanctioned fixed sizes (foundations §4.4). To them this document adds
one: **the four absolute `Aa` sizes in the font-size preview tile** (a component token pair, §8),
because a preview whose specimen scaled with the current setting would show four identical tiles.

---

## 6. Retired literals

The stylesheet carries 197 `rem` and 51 `px` font-size declarations: 36 distinct rem values and 14
distinct px values. No new `font-size` may be written as any of them. A component being edited
replaces its own rem literal with a role token and records the delta; there is no sweep
(`foundations.md` §11.2 rule 2). The px values are not text sizes at all — §6.3 lists what each one
is and who owns it.

### 6.1 Zero-delta: mechanical substitution

| Literal | Sites | Becomes |
|---|---|---|
| `.8rem` | 22 | `--text-sm` |
| `.72rem` | 18 | `--text-xs` |
| `.93rem` | 21 | `--text-ui-lg` |
| `.86rem` | 14 | `--text-ui` |
| `1rem` | 8 | `--text-body` |
| `1.15rem` | 1 | `--text-lg` |

84 of the 197 rem declarations. Six of the 36 values are token-equal, so this half of the
migration changes no pixel.

### 6.2 The collapse ladder

Every other literal, sorted by its px at M. **Δ is at M; at XL it is Δ × 1.3**, except the badge
rows, where the token stays 9 px.

| Literal | px at M | Sites | Role | Token px at M | Δ at M |
|---|---|---|---|---|---|
| `.64rem` | 9.0 | 2 | badge | 9 | +0.0 (−2.7 at XL) |
| `.66rem` | 9.2 | 1 | badge | 9 | −0.2 (−3.0 at XL) |
| `.68rem` | 9.5 | 5 | badge | 9 | −0.5 (−3.4 at XL) |
| `.7rem` | 9.8 | 4 | label | 10.1 | +0.3 |
| `.73rem` | 10.2 | 2 | meta | 11.2 | +1.0 |
| `.74rem` | 10.4 | 13 | label | 10.1 | −0.3 |
| `.74rem` (ghost buttons) | 10.4 | 1 | control | 12.0 | +1.7 |
| `.75rem` | 10.5 | 1 | control | 12.0 | +1.5 |
| `.76rem` | 10.6 | 10 | label | 10.1 | −0.6 |
| `.78rem` (titles) | 10.9 | 2 | label | 10.1 | −0.8 |
| `.78rem` (meta lines) | 10.9 | 11 | meta | 11.2 | +0.3 |
| `.79rem` | 11.1 | 1 | label | 10.1 | −1.0 |
| `.82rem` | 11.5 | 15 | control | 12.0 | +0.6 |
| `.84rem` | 11.8 | 2 | navigation | 13.0 | +1.3 |
| `.85rem` | 11.9 | 10 | control | 12.0 | +0.1 |
| `.89rem` | 12.5 | 4 | control | 12.0 | −0.4 |
| `.9rem` and `0.9rem` | 12.6 | 5 | control | 12.0 | −0.6 |
| `.92rem` | 12.9 | 1 | navigation | 13.0 | +0.1 |
| `.95rem` | 13.3 | 7 | navigation | 13.0 | −0.3 |
| `.98rem` | 13.7 | 1 | navigation | 13.0 | −0.7 |
| `1.05rem` | 14.7 | 2 | control | 12.0 | −2.7 |
| `1.08rem` (AI prose heading) | 15.1 | 1 | the prose ramp: an `em` step over body, not a chrome role (`ai-panel.md` owns it) | 14.0 | −1.1 |
| `1.1rem` | 15.4 | 2 | — glyph, see §6.3 | — | — |
| `1.14rem` | 16.0 | 2 | display | 16.1 | +0.1 |
| `1.2rem` | 16.8 | 1 | — glyph, see §6.3 | — | — |
| `1.3rem` | 18.2 | 1 | — glyph, see §6.3 | — | — |
| `1.35rem` | 18.9 | 1 | — glyph, see §6.3 | — | — |
| `1.4rem` (welcome title) | 19.6 | 1 | display | 16.1 | −3.5 |
| `1.4rem` (designer glyph) | 19.6 | 1 | — glyph, see §6.3 | — | — |
| `1.6rem` | 22.4 | 1 | — glyph, see §6.3 | — | — |
| `.5rem` | 7.0 | 1 | content card caption — exempt (§6.3) | — | — |

`.74rem`, `.78rem` and the two spellings of `.9rem` appear twice because one literal serves two
jobs in different components; the role follows the job, which is why the size table alone is not a
type system.

### 6.3 Exempt

| Kind | Values in use | Where | Why it is not a role |
|---|---|---|---|
| Badge numeral | `9px` | count badges (`style.css:1355`) | `--text-2xs`; a badge that grew would break its box |
| iOS zoom floor | `16px` | touch fields (`:8013`), phone prose base (`:7689`) | below 16 px the phone zooms the viewport on focus |
| Glyph size | `11px`, `14px`, `16px`, `18px`, `20px`, `22px`, `40px`, `48px`; `1.1` `1.2` `1.3` `1.35` `1.4` `1.6rem` | `.tab-close` `16px` (`:1432`), `.recent-clear` `16px` (`:9061`), `.bookmark-pin` `11px` (`:3208`), `#edit-toggle` (`:2888`, `:2896`), `.mlb-close-btn` (`:3939`), `.edit-header .icon-btn` (`:8838`), `.designer-state-icon` (`:6690`), empty-state glyphs (`:7295`, `:7818`) | the element's only content is a glyph, so this is an **icon size in disguise**; it retires to `--icon-*` when the sprite lands (foundations §9), never to a text role |
| Phone shell chrome | `12px`–`22px`, declared inside the phone media query | `style.css:7508`, `:7562`, `:7643-7672`, `:7890`, `:7957-7977` | the phone shell is authored at a fixed device size; [`mobile-shell.md`](mobile-shell.md) owns those sizes and retires them on its next pass |
| Graph-view overlay | `10px`, `11px`, `11.5px`, `12px` | `style.css:4855`, `:4973`, `:5005`, `:5061`, `:5200` | canvas and overlay labels inside one view; [`graph-view.md`](graph-view.md) owns them |
| Content card | `8–11px`, `.5rem` | diagram and designer internals (`style.css:33-35`, `:7015`) | the card owns its skin (`guidelines.md` §4) |
| `em` values | `.markdown-body h1`–`h4` (`:3374`, `:7440-7443`), `.ai-prose-span` (`:5342`) | prose | the prose ramp; `em` is legal only inside prose, on an element whose own size is a role |
| Wordmark | `.93rem` + 700 + `.3px` | `#brand` (`:333-336`) | a mark, not a role: it keeps navigation's size and its own weight and tracking |

---

## 7. Pairings

### 7.1 Correct

| Pairing | Why it holds |
|---|---|
| `.panel-title` = label at 400 + tracking + uppercase (`style.css:531-541`) | one role, one token, one place; the quiet label variant, and every panel header inherits it |
| `.tab` = navigation (`:1392`) inside a bar that scales (`:690`) | the role and the height move together |
| `body` = body `1rem/1.5` (`:303`), phone prose = `16px × scale/1.65` (`:7689`) | prose is one role at two densities, not two roles |
| `.settings-label` and `.settings-value` both navigation (`:2233`, `:2306`) | label and value are one rank, so the column reads down one line |
| `.tree-name`, `.session-name`, `.recent-name`, `.bookmark-name`, `.search-panel-hit-file` all `var(--text-body)` | one row role, one step, seven panels; the audit asserts the equality rather than the look |
| Settings chip = control (`:1845`), Settings button = control (`:2365`) | a chip and a button are the same rank; only the shape differs |

### 7.2 Wrong

| Pairing | What is wrong | Where |
|---|---|---|
| A row at `--text-ui` in one panel and `--text-body` in another | two panels, two ranks for the same job; the user reads it as "the font size is different in each panel", which is exactly the report this pass answers | the pre-fix tree row at `.86rem` beside a `1rem` session row |
| `.font-size-options label { font-size: .93rem }` beside the chip rule `{ font-size: var(--text-ui) }` | a control set at the navigation rank; two rules, two ranks, one element, and specificity decides the winner. Replaced by the tile row, which drops `.font-size-options` from the chip lists | `style.css:2354` vs `:1845` |
| `.settings-help` `.86rem`, `.settings-note` `.86rem`, `.settings-hint` `.78rem` | three secondary paragraphs in one tab at two ranks, one of them between roles | `:1677-1679` |
| `.settings-section h3` `.79rem` (`:2211`, now overridden) next to `.settings-form-title` `.74rem` (`:1671`) | two headings of the same job five hundredths of a rem apart | `:2211`, `:1671` |
| `.ai-prose-span h1 { font-size: 1.08rem }` | a heading inside prose set at a chrome-ish size; prose headings are `em` steps over body, never chrome sizes | `:5342` |
| A checked chip paints `--accent` on `--accent-soft` | text on the wash is `--accent` 3.97:1 dark / 4.20:1 light and `--text-muted` 3.65 / 4.37 — both under 4.5. Text on `--accent-soft` is `--text-primary` or it is wrong | `:1863-1864`; measured |
| `--text-2xs` on a sentence | 9 px is a numeral size; a sentence at 9 px is unreadable at every setting | `--text-2xs` |

The chip row is shipped behaviour and is **not** changed by this pass. It is the reason the new
font-size tile keeps `--text-primary` for its text on the selected wash (§8) instead of copying the
chip's accent label.

---

## 8. The one control that shows the scale

The Settings font-size row becomes four preview tiles: `Aa` at each option's real size, the letter,
and the px value, with the current value beside the row label. The full spec — anatomy, states,
copy, ARIA and CSS — is [`settings-modal.md`](settings-modal.md) §3.6.1, and the drawing is
`settings-modal-mockup.html` §2 and §2b.

Three rules from this document bind it:

1. The four `Aa` sizes are **absolute** px: 12.6, 14, 16.1, 18.2. They are not role tokens — the
   tile reads one multiplier, `--fs-opt` (`.9 / 1 / 1.15 / 1.3`), off the live root
   (`calc(1rem / var(--font-scale) * var(--fs-opt))`). Their job is to differ from the current root.
2. The captions inside the tile are **badge** (9 px, fixed): at `--text-xs` the widest caption
   measures 69.7 px at XL and overflows the 72 px card; at 9 px it measures 49.1 px.
3. All tile text on the selected wash is **`--text-primary`** (§7.2).

---

## 9. Accessibility

| Requirement | Rule | Where it is observable |
|---|---|---|
| Contrast | Every role reads at ≥4.5:1 on the surface it sits on; label at 600 weight is not an exemption | `foundations.md` §3.2; the wash case in §7.2 |
| Zoom | At 200 % browser zoom the shell produces no horizontal scroll and no clipped line | `body` zoomed at 1280 and 390; foundations §10.6 |
| XL | At `--font-scale: 1.3` no chrome text clips: every fixed height in §5.2 keeps its slack | 1280 and 1024 at XL, both themes |
| Minimum | No chrome text is smaller than `--text-xs` except the badge role and the glyph sizes in §6.3 | rendered tree at XL |
| Focus | A role change on focus is not allowed; the ring is the only focus signal | `controls.md` focus contract |
| Reduced motion | A role change never animates; font-size transitions are forbidden | foundations §7.4 |

---

## 10. Acceptance criteria

| # | Criterion | File | Observable |
|---|---|---|---|
| **AC1** | Every role in §2 resolves to its token in both themes | `static/css/style.css` | Reading each `--text-*` from `getComputedStyle(document.body)` returns the px in the table × the current scale |
| **AC2** | No new literal size is introduced | `static/css/style.css` | The 197 `rem` and 51 `px` declarations in §4 never rise; the token count (66) never falls |
| **AC3** | A touched component reads a role token for every `font-size` it owns | the component's rule | The rule contains `var(--text-*)`, not a number, except the §6.3 exemptions |
| **AC4** | Role rounding lands per component, or as a sweep once | git history | The first pass may rewrite several surfaces in one commit when the static ratchet and its allowlist land with it; every later change rewrites one component and lists its §6.2 deltas |
| **AC5** | Fixed heights hold the XL column | `style.css` | At XL, measuring each row of §5.2 shows `content height ≤ box height`; no clipped descender at 1280 or 1024 |
| **AC6** | The scale is visible in Settings | `index.html`, `settings-modal-mockup.html` | Four tiles, each with `Aa` at its option's size, the letter, and the px value; the row label carries the current px |
| **AC7** | Row and body are one step | `style.css` | Every side-panel row and the AI message text measure `--text-body`; no row uses `--text-ui` or `--text-ui-lg` |
| **AC8** | Badge text never scales | `style.css` | `--text-2xs` is `9px` and every badge measures 9 px at S and at XL |
| **AC9** | Text on `--accent-soft` is `--text-primary` | `style.css` | No rule paints `--accent` or `--text-muted` on a `--accent-soft` face in a new component; the shipped chip is recorded, not copied |
| **AC10** | Every panel row is equal at every setting | `style.css`, `tests/browser/test_typography_browser.js` | At S, M, L and XL, `.tree-name`, `.session-name`, `.recent-name`, `.bookmark-name` and `.search-panel-hit-file` compute to the same px within 0.01 |
| **AC11** | No off-scale text in a side panel or Settings | `tests/browser/test_typography_browser.js` | The runtime audit reports zero unmatched sizes in all seven panels, in default and expanded states, and in all seven Settings tabs |

---

## 11. What not to build

| Rejected | Reason |
|---|---|
| A second scale, a fluid `clamp()` type ramp, or a `vw`-based size | One multiplier is the whole model; a second scale is two designs |
| A user-visible size per role (a slider for headings) | The app has one typographic setting, and it is the one in §1 |
| A web font, a second sans, or a serif for prose | `foundations.md` §4.1: the system stack is the design |
| `font-size` in px in a new rule | §6.3 lists every case that may; anything else is a defect |
| A `font-size` transition | Foundations §7.4 forbids animating text layout |
| Sizing text to fit a box | The box is wrong; §5.2 is the ladder |
| `em`-sized chrome | `em` is the prose ramp's unit, not the chrome's |
| Retiring literals in one sweep | §6 rule: touch it, tokenise it, record the delta |
