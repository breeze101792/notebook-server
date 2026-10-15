# AI Chat Message Area — Turn Controls Redesign

Design handoff for the message area of the AI assistant side panel
(`#ai-view`, mounted by `static/js/ai.js`), focused on the **Edit /
Regenerate turn controls**. Reference mockup:
`docs/design/ai-chat-message-area.html`.

Status: design only. No source files were changed. `web-engineer`
implements the CSS in `static/css/style.css` and the two small `ai.js`
edits called out in §5.

Companion doc: `docs/design/ai-composer-redesign.md` (the composer below
this area). This doc matches its visual language: one calm bordered card,
borderless fields, quiet ghost icons, a single accent circle for the
primary action, and **text affordances that carry no border until they are
targeted**.

---

## 1. Design intent

The turn controls are the last thing the eye should notice in a turn, not
the first. Today they are bordered pills roughly the size of a small
button (`padding: 3px 10px`, `font-size: .76rem`, a `--bg-elev` fill and a
`--border` outline) sitting under the newest reply and the newest prompt;
they read as two extra buttons competing with the composer's real primary
action. The redesign demotes them to **quiet text affordances**: no fill,
no border, a muted color, a 14px inline icon and a short lowercase-weight
label, at roughly 18px tall — smaller than the composer's 30px attach
icon. They become visibly interactive only on hover or keyboard focus, and
they never leave the layout, so keyboard and touch users keep a
discoverable, focusable target at all times. Everything else in the
message area is left alone except a few optional, proportional polish
touches that make the bubbles agree with the composer card.

---

## 2. Turn controls — layout & weight spec

Panel context: `--side-panel-width: 240px` default, user-resizable, fluid
down to 240px. The controls are appended *inside* the newest `.ai-msg`
(a flex column): Regenerate into `.ai-msg-assistant`, Edit into
`.ai-msg-user`. Alignment therefore comes from `align-self`
(`flex-start` for Regenerate, `flex-end` for Edit) — unchanged from
today.

### Geometry

| Property | Value | Why |
| --- | --- | --- |
| display | `inline-flex; align-items: center` | icon + label on one baseline |
| gap | `4px` | icon-to-label breathing room |
| padding | `2px 6px` | target ≈ 18px tall, ≪ the 26px pill it replaces |
| border | `1px solid transparent` | reserves the box so hover never shifts layout; invisible at rest |
| border-radius | `6px` | matches the app's small-control radius |
| background | `transparent` | no fill until hover |
| color | `--fg-muted` | recessive body |
| font | `inherit`, `font-size: .72rem`, `line-height: 1` | smaller than the old `.76rem`; label stays legible |
| icon | `14 × 14px` inline SVG, `currentColor`, `aria-hidden` | quieter than the composer's 18px icons, same family |
| margin-top | `4px` | tight to the bubble it belongs to (was `6px`) |

`flex: 0 0 auto` on both buttons so a long label never stretches them.
Label text: **“Edit”** and **“Regenerate”** (see §4 for why icon + label,
not icon-only).

### Hierarchy (lightest → strongest)

1. Assistant prose / user bubble — the content.
2. Turn controls — a footnote-weight affordance, muted, borderless.
3. (Composer, below) the send circle — the one true primary action.

The controls must never out-weigh the content or the composer.

### States

| State | Spec |
| --- | --- |
| default | `color: --fg-muted; background: transparent; border-color: transparent` |
| hover (`:hover:not(:disabled)`) | `color: --fg; background: --accent-soft`; border stays transparent |
| active (`:active:not(:disabled)`) | keeps the hover fill (`--accent-soft`); no transform |
| focus-visible | `outline: 2px solid --accent; outline-offset: 1px` |
| disabled | `opacity: .4; color: --fg-muted; background: transparent; cursor: default` |

Behavioral semantics (disabled while busy / pending reads / unresolved
permission card; Edit also disabled while the composer holds a draft) are
**unchanged** — `updateTurnDisabled()` already drives both.

Contrast: `--fg-muted` on `--bg-panel` is ≈ 4.8:1 (dark) / ≈ 5.8:1
(light), so the resting label clears the 4.5:1 body-text bar; hover
`--fg` is higher still. Both pass.

### Narrow width (240px)

No breakpoint. At 240px the content box is ≈ 216px; the widest control
(“Regenerate”, 14px icon + 4px gap + ≈ 56px label + 12px padding ≈ 86px)
fits comfortably under its own bubble, and Regenerate / Edit sit under
*different* bubbles, so they never contend for a row. Nothing is clipped.

---

## 3. Optional message-area polish (clearly optional)

The complaint is the controls. The items below are proportional and can
each be skipped without harming the controls redesign.

- **User bubble — flatten the border.** Drop `border: 1px solid
  --border`, keep the `--accent-soft` fill, and set `border-radius: 12px
  12px 3px 12px` (was `10px 10px 3px 10px`) and `padding: 7px 11px`. This
  matches the composer card's “one surface, no competing borders” rule;
  the bubble already reads as a distinct surface via its fill. Keep
  `max-width: 95%`.
- **Error surface `.ai-error` — read as a system notice.** Change the
  fill from `--bg-elev` to `--danger-soft` and the radius from `6px` to
  `8px`, so it matches the card family and the danger tint signals an
  interruption rather than a normal block. Border stays `--danger`;
  padding `8px 10px`; font-size `.82rem`.
- **Turn rhythm.** Optionally raise `.ai-chat-log` `gap` from `10px` to
  `12px` so content blocks breathe a little more against the quieter
  controls. Not required; the controls read fine at `10px`.

Do **not** add bubbles around assistant prose, per-message avatars,
timestamps, or hover toolbars — that would over-restyle the area the
composer doc already settled.

---

## 4. Icon treatment

Match the composer redesign: inline SVG, `stroke/fill: currentColor`,
`aria-hidden="true"`, sized by CSS (14px), with the button's visible text
supplying the accessible name and `title` kept as the tooltip.

**Recommended: icon + label**, not icon-only. A hover `title` is
unavailable on touch and an icon alone (“↻”) does not state whether it
re-runs the last turn or re-sends the whole thread. A short visible label
keeps both controls discoverable on touch and self-describing, while the
ghost styling keeps them quiet. The label is also the accessible name, so
no `aria-label` is required (unlike the icon-only composer buttons).

Exact markup (set via `innerHTML` on the button; SVG has no text role):

```html
<!-- Edit (Feather "edit-3"): pencil + underline -->
<svg width="14" height="14" viewBox="0 0 24 24" fill="none"
     stroke="currentColor" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 20h9"/>
  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
</svg>

<!-- Regenerate (Feather "rotate-ccw"): counter-clockwise refresh -->
<svg width="14" height="14" viewBox="0 0 24 24" fill="none"
     stroke="currentColor" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <polyline points="1 4 1 10 7 10"/>
  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
</svg>
```

`currentColor` lets the icon follow the label through every state
(muted → `--fg` on hover → dimmed on disabled) with no extra CSS.

**Text-glyph fallback (no SVG):** keep the current text but drop the
border/fill and shrink the type, so it still reads small:
`btn.textContent = "✎ Edit"` and `"↻ Regenerate"` under the same
`.ai-turn-control` rules. The `✎` / `↻` glyphs are plain Unicode
(text-presentation, not emoji), so they inherit `currentColor`; the
earlier `AI_EDIT_LABEL = "✎ Edit"` already works, and Regenerate’s
`"↻ Regenerate"` is unchanged. This fallback meets every acceptance
criterion except the icon-shape ones.

---

## 5. Class mapping (keep / replace / add)

### Keep — behavior & hooks (unchanged)

- Class **`ai-turn-control`** on both buttons (removal logic selects
  `.ai-turn-control` in `removeTurnControls()` — `ai.js` ~1422).
- **`data-test-regenerate="1"`** and **`data-test-edit="1"`** (the DOM
  tests select on these).
- Classes `ai-regenerate` / `ai-edit` — retained **for alignment only**
  (`align-self`); the tests also select them (`.ai-regenerate`,
  `.ai-edit`).
- Both remain real `<button type="button">`; `title` text
  (`AI_EDIT_TITLE` / `AI_EDIT_DRAFT_TITLE` / “Re-run the model on your
  last question”) and the disabled semantics stay exactly as they are.
- Only the newest turn carries the controls (unchanged).

### Replace in `static/css/style.css`

The whole turn-control block, **lines 3719–3742** (the comment above it
plus `.ai-regenerate, .ai-edit { … }`, the two `align-self` rules, the
`:hover` rule, and the `:disabled` rule), is replaced by:

```css
/* Turn controls under the newest turn: quiet text affordances, not
 * buttons. No fill or border at rest; hover/focus reveals the accent.
 * Regenerate sits under the assistant reply, Edit under the user bubble.
 * Both are disabled while busy / pending reads / an unresolved card;
 * Edit also while the composer holds a draft. */
.ai-turn-control {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  margin-top: 4px;
  padding: 2px 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--fg-muted);
  font: inherit;
  font-size: .72rem;
  line-height: 1;
  cursor: pointer;
  transition: background .12s ease, color .12s ease;
}
.ai-turn-control > svg { width: 14px; height: 14px; flex: 0 0 auto; }
.ai-regenerate { align-self: flex-start; }
.ai-edit { align-self: flex-end; }
.ai-turn-control:hover:not(:disabled) {
  color: var(--fg);
  background: var(--accent-soft);
}
.ai-turn-control:active:not(:disabled) { background: var(--accent-soft); }
.ai-turn-control:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.ai-turn-control:disabled {
  opacity: .4;
  color: var(--fg-muted);
  background: transparent;
  cursor: default;
}
```

Optionally replace the old `.ai-user-text` rule (3619–3628) and
`.ai-error` rule (3744–3753) per §3. Leave every other AI rule untouched.

### Add in `ai.js`

- **Required:** none in the markup. The `.ai-turn-control` hook already
  exists on both buttons.
- **If SVG icons are adopted:**
  - Add two module constants next to `AI_EDIT_LABEL` (`ai.js` ~59):
    `AI_ICON_EDIT` and `AI_ICON_REGEN`, each holding the SVG string above.
  - In `appendRegenerate()` (~1448) replace
    `btn.textContent = "↻ Regenerate";` with
    `btn.innerHTML = AI_ICON_REGEN + "Regenerate";`.
  - In `appendEditControl()` (~1468) replace
    `btn.textContent = AI_EDIT_LABEL;` with
    `btn.innerHTML = AI_ICON_EDIT + "Edit";` (or keep
    `AI_EDIT_LABEL = "Edit"` and concatenate).
- The visible label is the accessible name; no `aria-label` needed. Keep
  `title`.
- **No new CSS class is required.** If the web-engineer wants to style
  the label separately, wrap it in `<span class="ai-turn-label">` — but
  the icon + text node with `gap: 4px` is sufficient, so this is not
  recommended.

---

## 6. Reference mockup

`docs/design/ai-chat-message-area.html` — standalone, no build step, no
dependencies. It inlines the app's real tokens as `.theme-dark` /
`.theme-light` (equivalents of `:root` and `body[data-theme="light"]`)
and shows, in one scrollable grid:

- **Before / After** side by side (old bordered pill vs the new quiet
  affordance) so the size reduction is obvious.
- Dark · 360px · **rest** (assistant reply + Regenerate, user bubble +
  Edit).
- Dark · 360px · **hover** (forced) and **focus-visible** (forced).
- Dark · 360px · **disabled** (busy: both controls dimmed).
- Dark · **240px** narrow.
- Light · 360px · rest and light · disabled.

Open it directly in a browser. The CSS block marked “DESIGN UNDER TEST”
is what `web-engineer` ports into `static/css/style.css`.

---

## 7. Acceptance criteria

Testable by `web-engineer` while implementing and by `tester` for
regression.

- [ ] Both turn controls keep the class `ai-turn-control`, the classes
      `ai-regenerate` / `ai-edit`, and the attributes
      `data-test-regenerate="1"` / `data-test-edit="1"`.
- [ ] Each remains a real `<button type="button">` with the current
      `title` text and the current disabled semantics (busy → both
      disabled; composer draft → Edit disabled).
- [ ] Only the newest turn shows the controls (unchanged: exactly one
      `.ai-regenerate` and one `.ai-edit` after a completed turn).
- [ ] At rest each control has **no visible border and no fill** (border
      color is transparent, background transparent) and a muted label
      (`--fg-muted`).
- [ ] On hover each control shows `--fg` text on an `--accent-soft`
      fill; the border stays transparent, so nothing shifts position.
- [ ] A keyboard-focused control shows a visible `2px --accent` outline
      (`:focus-visible`, offset 1px); focus is reachable by Tab in both
      the light and dark themes.
- [ ] A disabled control is visibly dimmed (`opacity: .4`), keeps the
      muted color, shows no hover fill, and does not respond to clicks.
- [ ] The control's height is materially smaller than the old bordered
      pill (≈ 18px vs ≈ 26px) and smaller than the composer's 30px attach
      icon.
- [ ] Icons (if adopted) render from inline SVG with
      `stroke="currentColor"` and `aria-hidden="true"`, and follow the
      label through hover/disabled; the visible label supplies the
      accessible name (no `aria-label` needed).
- [ ] Regenerate is left-aligned under the assistant reply; Edit is
      right-aligned under the user bubble (`align-self` unchanged).
- [ ] At a 240px panel width neither control overflows or is clipped,
      and the label stays on one line.
- [ ] No new dependencies, no framework, plain CSS; all colors and sizes
      come from existing custom properties (no new tokens introduced).
- [ ] The controls never out-weigh the message content or the composer
      send circle at any state.
