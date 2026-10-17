# Settings Modal — Unified Redesign

Design handoff for the Settings modal (`#settings-overlay` in
`templates/index.html`, behaviour in `static/js/settings.js`), focused on
**unifying all six tabs onto one visual system** and on rebuilding the AI
tab's read-only **ACP / agent status** block as a proper status panel.

Reference mockup: `docs/design/settings-modal.html`.

Status: design only. No source files were changed. `web-engineer`
implements the CSS in `static/css/style.css`, the small markup additions in
`templates/index.html`, and the `settings.js` render changes listed in §9.

Companion docs: `docs/design/ai-composer-redesign.md` and
`docs/design/ai-chat-message-area.md`. This doc keeps the same visual
language: one calm surface, borderless fields inside a single bordered
control, quiet ghost row actions, semantic status carried by a dot **and**
a word.

**Normative source.** §3 (the unified system) and §5 (the ACP panel) are the
single source of truth. The mockup in §10 is an illustration of them; where
the two differ, this document wins.

---

## 1. Design intent

The Settings modal is the app's control room: six tabs, every control live
except the Security/AI save buttons. Today it mixes idioms — two near-identical
uppercase headings (`.settings-section h3` and `.settings-form-title`), five
sizes of secondary text (`.settings-help` .89rem, `.settings-note` .86rem,
`.settings-hint` .72rem, `.auth-status-text` .86rem, `.settings-vimrc-status`
.85rem), three input looks (`.settings-text-input`, `.auth-input`,
`.settings-vimrc-area`), a native checkbox beside a coloured dot beside a
plain text status, and rows of tiny radios with two different gaps. The AI tab
stacks five forms and ends with the ACP block as a wall of grey sentences.

The redesign imposes **one** spacing scale, **one** type scale, **one**
control system, **one** status system, and a consistent "grouped form"
rhythm across all six tabs. The AI tab is reorganised into labelled groups
separated by hairline rules so it reads as one panel. Its ACP block becomes a
read-only status panel: per-agent rows with a clear **Installed / Adapter
missing / Not installed** state, an obvious **Selected** marker on the agent
the configured profile uses, and a visible **Read-only** affordance.

---

## 2. Anatomy and the scoping rule (read this before §9)

```
#settings-overlay  (backdrop; also used by Export / Auth / Designer)
└ .settings-modal
  ├ .settings-header           title + window controls (Close / Maximize)
  ├ .settings-body             flex row
  │  ├ .settings-nav           tab list (role=tablist)
  │  └ .settings-sections      scroll pane
  │     └ .settings-section    one per tab (data-section)
  └ .settings-footer           single Close button
```

**The shared-class rule (critical).** Many of these class names are global
and style the **Auth**, **Export**, and **Mermaid Designer** modals, which
share `.settings-overlay` / `.settings-modal`:

- `.settings-row` (`style.css:1617`), `.settings-label` (`:1629`),
  `.settings-action` (`:1757`), `.settings-action--primary` (`:4468`),
  `.theme-options` / `.font-size-options` (`:1737` / `:1747`), and
  `.settings-form-title` / `.settings-hint` / `.settings-note` /
  `.settings-subheading`.
- Consumers: the Auth modal (`index.html:355-361`), the Export modal
  (`index.html:888-950`), and the Designer (`index.html:1065-1086`; its Apply
  button is `class="settings-action settings-action--primary"`).

Therefore **do not edit those global base rules**. Keep them as they are and
**add scoped `#settings-overlay …` overrides** that only win inside the
Settings modal. Every CSS block below is written that way. A global rewrite
would, for example, strip the Designer's Apply button of its accent fill — the
exact regression this rule prevents.

**No rename.** No existing id is renamed. New Settings-only classes are
prefixed `stg-`; new Settings-only tokens are `--stg-*`. Where a rule changes
the look of a shared class, it is always written `#settings-overlay <class>`,
so the other modals keep their current styling.

---

## 3. The unified system

### 3.1 Tokens

Add once, near the top of the `.settings-*` region of `static/css/style.css`.
Everything is scoped to the Settings modal:

```css
/* ------------------------------------------------------------------ */
/* Settings modal — unified design tokens. Scoped to #settings-overlay */
/* so the Export / Auth / Designer modals are untouched.              */
/* ------------------------------------------------------------------ */
#settings-overlay {
  /* Spacing scale. px, not rem: the modal's rhythm stays constant while
   * text scales with --font-scale (the file's existing convention). */
  --stg-space-1: 4px;
  --stg-space-2: 6px;
  --stg-space-3: 8px;
  --stg-space-4: 12px;
  --stg-space-5: 16px;
  --stg-space-6: 24px;

  /* Radii. */
  --stg-radius-sm: 6px;     /* fields, buttons, chips */
  --stg-radius-md: 8px;     /* card rows, read-only panels */
  --stg-radius-pill: 999px;

  /* Shared label gutter for every label|control row. */
  --stg-label-w: 132px;

  /* Field / button padding. */
  --stg-field-pad-y: 6px;
  --stg-field-pad-x: 10px;
  --stg-btn-pad-y: 6px;
  --stg-btn-pad-x: 14px;

  /* Secondary text. The app default --fg-muted (#8b8d98) is only 4.26:1
   * on --bg-elev (dark) — under the 4.5:1 bar for normal text. Inside
   * Settings it is raised to clear 4.5:1 on every surface it lands on.
   * This override is scoped, so the rest of the app is unchanged. */
  --fg-muted: #9799a4;

  /* Status text. Dark --ok / --warn already pass; the light theme values
   * do not (2.56:1 / 2.68:1 on --bg-elev), so light gets darker variants. */
  --stg-ok: var(--ok);
  --stg-warn: var(--warn);

  /* Switch knob: the app's --accent-fg is dark in the dark theme, so the
   * knob is taken from --fg there and from --accent-fg in light. */
  --stg-switch-knob: var(--fg);
}
body[data-theme="light"] #settings-overlay {
  --fg-muted: #5d6470;          /* 5.13:1 on --bg-elev */
  --stg-ok: #16703f;           /* 5.28:1 on --bg-elev */
  --stg-warn: #8a5a0b;         /* 5.10:1 on --bg-elev */
  --stg-switch-knob: var(--accent-fg);   /* = #ffffff in light */
}
```

Only `--fg-muted` is re-pointed; it is used exclusively for text and icons
inside the modal, so re-pointing it there has no other effect. The
`--stg-*` names are new and Settings-local.

### 3.2 Color roles

| Role | Token | Where |
| --- | --- | --- |
| Modal surface | `--bg-panel` | `.settings-modal`, `.settings-footer` |
| Nav surface | `--bg` | `.settings-nav` |
| Content surface (cards, panels) | `--bg-elev` | card rows, ACP panel, buttons |
| Field "well" | `--code-bg` | every input / textarea / select |
| Deeper inset | `--bg` | ACP profile card, `kbd` |
| Primary text | `--fg` | row values, card titles |
| Secondary text | `--fg-muted` (scoped, §3.1) | labels, help, hints, captions |
| Hairline | `--border` | group rules, card borders, field borders |
| Accent (selected / primary) | `--accent`, `--accent-soft`, `--accent-fg` | active nav, primary button, checked chip, "Selected" tag |
| Success (on / installed) | `--stg-ok` | watch "on", ACP "Installed" |
| Warning (needs attention) | `--stg-warn` | watch "off", ACP "Adapter missing", vimrc error |
| Danger (error / destructive) | `--danger`, `--danger-soft` | error text, Remove / Revoke hover |

### 3.3 Type scale

| Role | Classes it covers | Size | Weight | Other |
| --- | --- | --- | --- | --- |
| Modal title | `.settings-header h2` | 1.14rem | 600 | tracking .3px |
| Section heading | `.settings-section > h3`, `.settings-subheading` | .76rem | 600 | uppercase, tracking .8px, `--fg-muted` |
| Group label | `.settings-form-title` | .74rem | 600 | uppercase, tracking .7px, `--fg-muted`, top hairline (§3.4) |
| Row label | `.settings-label` | .93rem | 400 | `--fg-muted` |
| Row value / card title | `.settings-value`, card name | .93rem | 400 / 600 | `--fg` |
| Card meta | `.settings-token-role`, `.settings-token-created` | .78rem | 400 | `--fg-muted` |
| Body secondary | `.settings-help`, `.settings-note` | .86rem | 400 | `--fg-muted`, line-height 1.5 |
| Caption | `.settings-hint` | .78rem | 400 | `--fg-muted` |
| Status text | `.stg-status`, `.settings-vimrc-status`, `.auth-status-text` | .82rem | 400/600 | colour = role |
| Mono | `.settings-mono`, `code`, `.settings-vimrc-area` | .86rem | 400 | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` |

Unification moves `.settings-help` from .89rem → **.86rem** (identical to
`.settings-note`) and `.settings-hint` from .72rem → **.78rem** (legible at
every scale). `.settings-subheading` (.95rem normal-case) folds into the
section-heading look so "Hybrid editor…" and "Live markdown syntax" read as
siblings of "Shortcuts".

### 3.4 Group rhythm

```css
#settings-overlay .settings-section > h3,
#settings-overlay .settings-subheading {
  margin: 0 0 var(--stg-space-3);
  font-size: .76rem; font-weight: 600;
  text-transform: uppercase; letter-spacing: .8px;
  color: var(--fg-muted);
}
#settings-overlay .settings-form-title {
  margin: var(--stg-space-6) 0 var(--stg-space-3);
  padding-top: var(--stg-space-5);
  border-top: 1px solid var(--border);   /* the group separator */
  font-size: .74rem; font-weight: 600;
  text-transform: uppercase; letter-spacing: .7px;
  color: var(--fg-muted);
}
```

Every `.settings-form-title` carries a hairline rule above it.

**Actual AI-tab group order** (document order; there is no move). The ACP
panel is appended by JS to `#settings-ai-list`, inside the provider list, so it
sits **above** the "Add a provider" form. Top to bottom the AI tab is:

1. `h3` "AI assistant" + help + provider count.
2. `#settings-ai-list` — one card row per OpenAI provider, then the
   read-only ACP panel (`.settings-ai-acp-row` / `-info`), injected by
   `renderAiList()`.
3. `.settings-form-title` "Add a provider" + the name/url/model/key fields.
4. `.settings-form-title` "Assistant instructions" + the prompt textarea.
5. `.settings-form-title` "Web search" + the SearXNG field.

The ACP panel is deliberately grouped with the provider list — it is the
read-only member of the same "configured providers" set that the picker
shows — rather than moved to the bottom. It uses its own
`.settings-ai-acp-title` header, not `.settings-form-title`, so it takes no
top rule of its own.

### 3.5 Rows, labels, controls

```css
#settings-overlay .settings-row {
  display: flex; align-items: center; gap: var(--stg-space-4);
  padding: var(--stg-space-2) 0; min-width: 0;
}
#settings-overlay .settings-label {
  flex: 0 0 var(--stg-label-w); min-width: 0;
  color: var(--fg-muted); font-size: .93rem;
}
#settings-overlay .settings-control {
  flex: 1 1 auto; min-width: 0;
  display: flex; flex-wrap: wrap; gap: var(--stg-space-2);
}
#settings-overlay .settings-row-column {
  flex-direction: column; align-items: stretch; gap: 0;
}
#settings-overlay .settings-row-column .settings-label {
  flex: 0 0 auto; margin-bottom: var(--stg-space-1);
}
#settings-overlay .settings-form-actions {
  display: flex; justify-content: flex-end; align-items: center;
  gap: var(--stg-space-3); padding: var(--stg-space-2) 0;
}
```

This folds the current `#settings-section-ai .settings-row-column` overrides
into the general rule, so AI column rows agree with the vimrc column row.

### 3.6 Component catalogue

**Field** — one look for every text input, textarea, and select. Fields grow
to fill their row (`flex: 1 1 auto`), so the Site-title field stretches:

```css
#settings-overlay .auth-input,
#settings-overlay .settings-text-input,
#settings-overlay #settings-ai-custom-prompt,
#settings-overlay .settings-vimrc-area,
#settings-overlay select {
  background: var(--code-bg); color: var(--fg);
  border: 1px solid var(--border); border-radius: var(--stg-radius-sm);
  padding: var(--stg-field-pad-y) var(--stg-field-pad-x);
  font-family: inherit; font-size: .93rem; outline: none;
  min-width: 0; flex: 1 1 auto;
}
#settings-overlay .auth-input:focus,
#settings-overlay .settings-text-input:focus,
#settings-overlay #settings-ai-custom-prompt:focus,
#settings-overlay select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
#settings-overlay .auth-input:disabled { opacity: .55; cursor: not-allowed; }
#settings-overlay .settings-auth-input { max-width: 320px; }
#settings-overlay .settings-vimrc-area {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  resize: vertical; width: 100%;
}
#settings-overlay #settings-ai-custom-prompt { resize: vertical; width: 100%; }
/* The AI fields span the full width (the 320px cap is for the password
 * forms); this replaces the current #settings-section-ai override. */
#settings-overlay #settings-section-ai .settings-auth-input {
  max-width: none; width: 100%; flex: 1 1 auto;
}
```

These overrides make Settings fields **sans-serif** (D3). The shared
`.auth-input` used by the Auth modal keeps its mono font, because the
override is scoped to `#settings-overlay`. Mono survives inside Settings only
where the content is code: the vimrc textarea, About paths, token values,
`.settings-mono`, model chips, and ACP keys.

**Button** — one base, four variants. The global `.settings-action` /
`.settings-action--primary` rules stay (the Designer and Export depend on
them); the scoped rules below only change the look inside Settings:

```css
#settings-overlay .settings-action {
  background: var(--bg-elev); color: var(--fg);
  border: 1px solid var(--border); border-radius: var(--stg-radius-sm);
  padding: var(--stg-btn-pad-y) var(--stg-btn-pad-x);
  font-family: inherit; font-size: .9rem; line-height: 1.4;
  cursor: pointer; white-space: nowrap;
}
#settings-overlay .settings-action:hover:not(:disabled) {
  background: var(--accent-soft); border-color: var(--accent);
}
#settings-overlay .settings-action:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 1px;
}
#settings-overlay .settings-action:disabled {
  opacity: .5; cursor: not-allowed;
  background: var(--bg-elev); border-color: var(--border);
}

/* --primary: the one commit action of a group. */
#settings-overlay .settings-action--primary {
  background: var(--accent); border-color: var(--accent);
  color: var(--accent-fg); font-weight: 600;
}
#settings-overlay .settings-action--primary:hover:not(:disabled) {
  background: var(--accent); border-color: var(--accent); filter: brightness(1.06);
}

/* --ghost: quiet row actions. */
#settings-overlay .settings-ai-test,
#settings-overlay .settings-ai-edit,
#settings-overlay .shortcut-change,
#settings-overlay .shortcut-reset {
  background: transparent; border-color: transparent;
  color: var(--fg-muted); padding: 4px 10px; font-size: .85rem;
}
#settings-overlay .settings-ai-edit { color: var(--accent); }
#settings-overlay .settings-ai-test:hover:not(:disabled),
#settings-overlay .settings-ai-edit:hover:not(:disabled),
#settings-overlay .shortcut-change:hover:not(:disabled),
#settings-overlay .shortcut-reset:hover:not(:disabled) {
  background: var(--accent-soft); border-color: var(--accent); color: var(--accent);
}

/* --danger: destructive row actions. */
#settings-overlay .settings-ai-remove,
#settings-overlay .settings-token-revoke,
#settings-overlay .settings-auth-danger {
  background: transparent; border-color: transparent; color: var(--danger);
}
#settings-overlay .settings-ai-remove:hover:not(:disabled),
#settings-overlay .settings-token-revoke:hover:not(:disabled),
#settings-overlay .settings-auth-danger:hover:not(:disabled) {
  background: var(--danger-soft); border-color: var(--danger);
}
```

`--primary` is applied to Save vimrc, Save prompt, Save search URL, Create
token, and Add provider (§9 lists the markup edits).

**Toggle** — every Settings checkbox becomes a switch; native semantics kept,
knob from a token (D4, finding 11):

```css
#settings-overlay input[type="checkbox"] {
  appearance: none; -webkit-appearance: none;
  position: relative; width: 36px; height: 20px;
  margin: 0 0 0 auto;               /* push to the row's right edge */
  flex: 0 0 auto;
  border-radius: var(--stg-radius-pill); background: var(--border);
  cursor: pointer; transition: background .15s ease;
}
#settings-overlay input[type="checkbox"]::after {
  content: ""; position: absolute; top: 2px; left: 2px;
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--stg-switch-knob);
  transition: transform .15s ease;
}
#settings-overlay input[type="checkbox"]:checked { background: var(--accent); }
#settings-overlay input[type="checkbox"]:checked::after { transform: translateX(16px); }
#settings-overlay input[type="checkbox"]:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}
#settings-overlay input[type="checkbox"]:disabled { opacity: .5; cursor: not-allowed; }
@media (prefers-reduced-motion: reduce) {
  #settings-overlay input[type="checkbox"],
  #settings-overlay input[type="checkbox"]::after { transition: none; }
}
```

The element keeps its identity: no id or name is touched, and the label
association still toggles it. (The only Settings checkbox that carries an id
is `#settings-auth-viewer-toggle`, `#settings-autosave-toggle`,
`#settings-vim-toggle`, `#settings-hide-topbar`, `#settings-graph-particles` —
all survive.)

**Radio group → chips.** One treatment for the eight Settings radio groups,
named explicitly with `:is()` (not a `[class$="-options"]` selector, which
would also catch the Export modal's `.export-*-options` if ever unscoped):

```css
#settings-overlay :is(.theme-options, .font-size-options,
  .settings-modal-width-options, .settings-modal-height-options,
  .wallpaper-options, .wallpaper-scroll-options,
  .wallpaper-color-options, .wallpaper-intensity-options) {
  display: flex; flex-wrap: wrap; gap: var(--stg-space-2);
}
#settings-overlay :is(.theme-options, .font-size-options,
  .settings-modal-width-options, .settings-modal-height-options,
  .wallpaper-options, .wallpaper-scroll-options,
  .wallpaper-color-options, .wallpaper-intensity-options) label {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 11px;
  border: 1px solid var(--border); border-radius: var(--stg-radius-pill);
  background: var(--bg-elev); color: var(--fg-muted); font-size: .86rem;
  cursor: pointer;
  transition: background .12s ease, border-color .12s ease, color .12s ease;
}
#settings-overlay :is(.theme-options, .font-size-options,
  .settings-modal-width-options, .settings-modal-height-options,
  .wallpaper-options, .wallpaper-scroll-options,
  .wallpaper-color-options, .wallpaper-intensity-options) label:hover {
  border-color: var(--accent); color: var(--fg);
}
/* D4: the real selector is :has(); .is-checked is a harmless fallback. */
#settings-overlay :is(.theme-options, .font-size-options,
  .settings-modal-width-options, .settings-modal-height-options,
  .wallpaper-options, .wallpaper-scroll-options,
  .wallpaper-color-options, .wallpaper-intensity-options) label:has(input:checked),
#settings-overlay :is(.theme-options, .font-size-options,
  .settings-modal-width-options, .settings-modal-height-options,
  .wallpaper-options, .wallpaper-scroll-options,
  .wallpaper-color-options, .wallpaper-intensity-options) label.is-checked {
  background: var(--accent-soft); border-color: var(--accent);
  color: var(--accent); font-weight: 600;
}
#settings-overlay :is(.theme-options, .font-size-options,
  .settings-modal-width-options, .settings-modal-height-options,
  .wallpaper-options, .wallpaper-scroll-options,
  .wallpaper-color-options, .wallpaper-intensity-options) label:has(input:focus-visible) {
  outline: 2px solid var(--accent); outline-offset: 1px;
}
#settings-overlay :is(.theme-options, .font-size-options,
  .settings-modal-width-options, .settings-modal-height-options,
  .wallpaper-options, .wallpaper-scroll-options,
  .wallpaper-color-options, .wallpaper-intensity-options) input {
  position: absolute; width: 1px; height: 1px; opacity: 0; margin: 0;
}
```

`:has()` is already used in this stylesheet (`.markdown-body li:has(...)`), so
it is in scope; the `.is-checked` fallback satisfies D4. The radio stays a
real, focusable `<input type="radio">`; only its default rendering is hidden.

**Card row** — provider rows and token rows share the existing `.shortcut-row`
card shape:

```css
#settings-overlay .settings-ai-row,
#settings-overlay .settings-token-row {
  display: flex; align-items: center; gap: var(--stg-space-3);
  padding: var(--stg-space-3) var(--stg-space-4);
  border: 1px solid var(--border); border-radius: var(--stg-radius-md);
  background: var(--bg-elev); margin: 0 0 var(--stg-space-2);
}
#settings-overlay .settings-ai-row .settings-label,
#settings-overlay .settings-token-row .settings-label {
  flex: 1 1 auto; min-width: 0;
  color: var(--fg); font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
#settings-overlay .settings-token-meta {
  display: inline-flex; align-items: center; gap: var(--stg-space-2);
  flex-wrap: wrap; min-width: 0;
}
#settings-overlay .settings-token-role,
#settings-overlay .settings-token-created {
  font-size: .78rem; color: var(--fg-muted);
}
```

**Status** — dot + word; the word carries the state, so colour is never the
only signal. This generalises the existing `.settings-watch-status`:

```css
#settings-overlay .stg-status,
#settings-overlay .settings-watch-status {
  display: inline-flex; align-items: center; gap: var(--stg-space-2);
  font-size: .82rem; font-weight: 600; color: var(--fg);
}
#settings-overlay .stg-status::before,
#settings-overlay .settings-watch-status::before {
  content: ""; width: 8px; height: 8px; border-radius: 50%;
  flex: 0 0 auto; background: var(--fg-muted);
}
/* The watch dot follows its own text colour. settings.js only toggles the
 * watch-on / watch-off class, so this keeps the green/amber dot with no JS
 * change (finding 3). */
#settings-overlay .settings-watch-status::before { background: currentColor; }
#settings-overlay .stg-status--ok { color: var(--stg-ok); }
#settings-overlay .stg-status--ok::before { background: var(--stg-ok); }
#settings-overlay .stg-status--warn { color: var(--stg-warn); }
#settings-overlay .stg-status--warn::before { background: var(--stg-warn); }
#settings-overlay .stg-status--danger { color: var(--danger); }
#settings-overlay .stg-status--danger::before { background: var(--danger); }
#settings-overlay .stg-status--accent { color: var(--accent); }
#settings-overlay .stg-status--accent::before { background: var(--accent); }
/* The watch text colours are raised for light (see --stg-ok / --stg-warn). */
#settings-overlay .settings-watch-status.watch-on { color: var(--stg-ok); }
#settings-overlay .settings-watch-status.watch-off { color: var(--stg-warn); }
```

Drop the old standalone global `.settings-watch-status` and
`.settings-watch-status::before` rules only if you also move the
`watch-on`/`watch-off` colour lines above into the scoped block; otherwise
leave them and let the scoped rules win. The neutral `.stg-status` (no
modifier) keeps `--fg` text with a `--fg-muted` dot.

**Tag** (uppercase micro-label, no dot): "Read-only", "Selected", "Default",
"key stored", "no key".

```css
#settings-overlay .stg-tag {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 1px 8px; border: 1px solid var(--border);
  border-radius: var(--stg-radius-pill); background: var(--bg-elev);
  color: var(--fg-muted); font-size: .68rem; font-weight: 700;
  letter-spacing: .5px; text-transform: uppercase; white-space: nowrap;
}
#settings-overlay .stg-tag--accent {
  color: var(--accent); border-color: var(--accent); background: var(--accent-soft);
}
#settings-overlay .stg-tag--ok     { color: var(--stg-ok);     border-color: var(--stg-ok); }
#settings-overlay .stg-tag--danger { color: var(--danger);     border-color: var(--danger); }
```

### 3.7 Class mapping — existing → target

| Existing class | Target component | Change |
| --- | --- | --- |
| `.settings-section > h3` | Section heading | new type scale (§3.3) |
| `.settings-subheading` | Section heading | folded into the same look |
| `.settings-form-title` | Group label | same type + top hairline (§3.4) |
| `.settings-help` | Body secondary | .89rem → .86rem |
| `.settings-note` | Body secondary | `.86rem` |
| `.settings-hint` | Caption | .72rem → .78rem |
| `.auth-status-text` | Status text | `.82rem` |
| `.settings-vimrc-status` | Status text | `.82rem`; use `.stg-status` for saved/error |
| `.settings-watch-status` | Status | shares the `.stg-status` base; dot via `currentColor` |
| `.settings-label` | Row label | gutter token `--stg-label-w` |
| `.settings-control` | Control cell | flex + wrap + gap |
| `.settings-row` | Row | spacing tokens |
| `.settings-row-column` | Stacked row | generalised (drops AI-specific override) |
| `.settings-form-actions` | Action cluster | right + gap 8px |
| `.settings-action` | Button (secondary) | scoped radius/padding + focus ring |
| `.settings-action--primary` | Button (primary) | scoped; global rule kept for Designer |
| `.settings-ai-test` (new) | Button (ghost) | new class, added in JS |
| `.settings-ai-edit` | Button (ghost, accent) | ghost |
| `.settings-token-revoke`, `.settings-ai-remove` (new) | Button (danger ghost) | danger ghost |
| `.shortcut-change`, `.shortcut-reset` | Button (small ghost) | ghost, .85rem |
| `.settings-text-input`, `.auth-input`, `select` | Field | one look; sans in Settings (scoped) |
| `.settings-vimrc-area`, `#settings-ai-custom-prompt` | Field | unified border/bg/radius |
| `.theme-options`, `.font-size-options`, +6 `*-options` | Radio chips | chips (§3.6) |
| `input[type=checkbox]` (in Settings) | Toggle switch | switch |
| `.settings-ai-row`, `.settings-token-row` | Card row | card chrome + meta |
| `.settings-ai-acp-row`, `.settings-ai-acp-info` | Read-only panel | §5 |
| `.settings-ai-acp-agent*` | ACP agent row/status | §5 |

---

## 4. Per-tab notes

**General.** Site title: full-width field (flex fills the row). File-watching
status uses the shared status look (`dot + word`); the words are unchanged
("Watching …" / "—"). The native observer Enable/Disable button stays
`.settings-action`. Autosave and VIM mode become switches. The VIM initial
script column row keeps its mono textarea; Save becomes
`.settings-action--primary`, with the status text beside it (`.stg-status`
once JS sets the class).

**Appearance.** All eight radio groups become chips. Hide top bar and Graph
background particles become switches. Add three group labels
(`.settings-form-title`) to break the long run of rows into readable groups —
markup change, see §9:
- "Interface" before Theme
- "Modal size" before Settings modal width
- "Wallpaper" before Wallpaper

**Shortcuts.** `.settings-subheading` now matches the section-heading style.
Configurable rows stay cards; Change…/Reset become small ghosts. Static
reference rows keep the dashed border but drop their fill so they read as a
table. "Reset all to defaults" stays in the footer cluster.

**Security.** Passwords: the "Admin password: …" / "Viewer password: …"
elements stay `.settings-note` (no class change, so no markup edit: the notes
are not converted to `.stg-status`). The password fields use the field token;
Save/Change stay the neutral `.settings-action` (the five primaries are the
ones §9 lists); Remove admin password / Disable auth / Revoke use the danger
ghost. API tokens: rows become card rows with a
muted `.settings-token-role` / `.settings-token-created`; the Role `<select>`
matches the field look. All errors use the one `.auth-error` /
`.settings-auth-error` treatment (danger text, no box).

**AI.** §5.

**About.** Two label|mono-value rows, unchanged structure; the mono values wrap
instead of forcing the modal wider (`word-break: break-all` already set).

**Header / nav / footer.** Nav gets a clearer selected state: keep the
`--accent-soft` fill + `--accent` text, add a 2px accent rail
(`box-shadow: inset 2px 0 0 var(--accent)`). Footer keeps the single Close
button (Settings are live).

---

## 5. AI tab — read-only ACP / agent status presentation

This is the headline change. The ACP block stops being a paragraph of grey
sentences and becomes a **status panel** with three layers: a panel header, a
configured-profile card, and a per-agent list.

### 5.1 Panel layout

```
┌───────────────────────────────────────────────────────────────┐
│ ACP AGENTS                                        [🔒 READ-ONLY]│
│ Local coding agents the assistant can drive over the Agent     │
│ Client Protocol. Configured by editing config/acp.json on the  │
│ server (not editable here).                                    │
│                                                                │
│ Configured profile                                             │
│ ┃ ● opencode        [SELECTED] [DEFAULT]                       │
│ ┃   allowlist key  opencode                                   │
│                                                                │
│ Detected agents                                                │
│   ● opencode       [Installed]        key: opencode           │
│   ● Claude Code    [Adapter missing]  key: claude             │
│       npm install -g @agentclientprotocol/claude-agent-acp    │
│   ● Codex          [Not installed]    key: codex              │
└───────────────────────────────────────────────────────────────┘
```

The panel is appended by `renderAiList()` to `#settings-ai-list`, so it sits
inside the provider list, above the "Add a provider" form (§3.4). It keeps the
classes the DOM tests select: `.settings-ai-acp-row` (with `data-acp-name`)
when a profile is configured, `.settings-ai-acp-info` when only agents are
detected, and `.settings-ai-acp-agent[data-acp-key]` per detected agent.

**Display filter.** The server's PATH probe reports every known agent
(`ACP_KNOWN_AGENTS`). The panel lists only the three core agents
(`opencode`, `claude`, `codex`) plus any agent actually installed on the host
(`acpAgents[i].available === true`); every other uninstalled, non-core agent is
hidden as noise. The probe itself is unchanged and still returned in full.
Applied in `buildAcpAgentLines()`, so it covers both the profile panel and the
info panel.

### 5.2 States

| State | Dot colour | Status word | Applied to |
| --- | --- | --- | --- |
| Installed | `--stg-ok` | "Installed" | `acpAgents[i].available` |
| Adapter missing | `--stg-warn` | "Adapter missing" | `acpAgents[i].adapterMissing` |
| Not installed | `--fg-muted` | "Not installed" | neither flag |
| Selected | `--accent` | tag "Selected" + accent row rail | `acpAgents[i].key === acp.agent` |
| Configured | `--accent` | profile card with left accent rail | `cfg.acp` present |
| Default | `--accent` | tag "Default" | `cfg.acp.default` |

Colour is never the only signal: every state carries a word, and the dot is
`aria-hidden` decoration.

### 5.3 Panel CSS

```css
#settings-overlay .settings-ai-acp-row,
#settings-overlay .settings-ai-acp-info {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--stg-radius-md);
  padding: var(--stg-space-4);
  margin: var(--stg-space-2) 0 var(--stg-space-3);
}
#settings-overlay .settings-ai-acp-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--stg-space-3); margin: 0 0 var(--stg-space-3);
}
#settings-overlay .settings-ai-acp-title {
  margin: 0; font-size: .74rem; font-weight: 600;
  text-transform: uppercase; letter-spacing: .7px; color: var(--fg-muted);
}
#settings-overlay .settings-ai-acp-profile {
  display: flex; align-items: center; flex-wrap: wrap;
  gap: var(--stg-space-2);
  padding: var(--stg-space-3);
  border: 1px solid var(--border);
  border-left: 2px solid var(--accent);
  border-radius: var(--stg-radius-sm);
  background: var(--bg);
  margin: 0 0 var(--stg-space-3);
}
#settings-overlay .settings-ai-acp-profile-name { font-weight: 600; color: var(--fg); }
#settings-overlay .settings-ai-acp-profile-meta {
  flex: 1 1 100%; font-size: .78rem; color: var(--fg-muted);
}
#settings-overlay .settings-ai-acp-agents {
  display: flex; flex-direction: column; gap: var(--stg-space-2);
}
#settings-overlay .settings-ai-acp-agent {
  display: flex; align-items: center; flex-wrap: wrap;
  gap: var(--stg-space-2) var(--stg-space-3);
  padding: var(--stg-space-2) var(--stg-space-3);
  border-radius: var(--stg-radius-sm);
}
#settings-overlay .settings-ai-acp-agent[data-selected="true"] {
  background: var(--accent-soft);
  box-shadow: inset 2px 0 0 var(--accent);
}
#settings-overlay .settings-ai-acp-agent-name { flex: 0 0 auto; font-weight: 600; color: var(--fg); }
#settings-overlay .settings-ai-acp-agent-status { flex: 0 0 auto; }
#settings-overlay .settings-ai-acp-key {
  margin-left: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: .76rem; color: var(--fg-muted);
}
#settings-overlay .settings-ai-acp-hint {
  flex: 1 1 100%;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: .74rem; color: var(--stg-warn); overflow-wrap: anywhere;
}
#settings-overlay .settings-ai-acp-note { margin: var(--stg-space-3) 0 0; }
```

### 5.4 Markup `settings.js` must emit

Recommended (clean wording). **Class hooks kept:** `.settings-ai-acp-row`
(+`data-acp-name`), `.settings-ai-acp-info`, `.settings-ai-acp-agents`,
`.settings-ai-acp-agent` (+`data-acp-key`), `.settings-ai-acp-agent-status`.
**Retired:** `.settings-ai-acp-selected` (its "Selected agent key: …" line is
replaced by the profile card; no test selects it). The status `<span>` gains
the shared state classes so it picks up the dot:

```html
<!-- profile configured: .settings-ai-acp-row[data-acp-name] -->
<div class="settings-ai-acp-row" data-acp-name="opencode">
  <div class="settings-ai-acp-head">
    <span class="settings-ai-acp-title">ACP agents</span>
    <span class="stg-tag" title="Configured by editing config/acp.json on the server"><span aria-hidden="true">🔒</span> Read-only</span>
  </div>
  <p class="settings-help">Local coding agents the assistant can drive over the
    Agent Client Protocol. Configured by editing <code>config/acp.json</code> on
    the server (not editable here).</p>

  <div class="settings-ai-acp-profile">
    <span class="settings-ai-acp-profile-name">opencode</span>
    <span class="stg-tag stg-tag--accent">Selected</span>
    <span class="stg-tag stg-tag--accent">Default</span>   <!-- only when acp.default -->
    <span class="settings-ai-acp-profile-meta">allowlist key
      <code class="settings-ai-acp-key">opencode</code></span>
  </div>

  <!-- Rendered ONLY when acpAgents is non-empty (finding 7): no orphan
       "Detected agents" heading. -->
  <span class="settings-ai-acp-title">Detected agents</span>
  <div class="settings-ai-acp-agents">
    <div class="settings-ai-acp-agent" data-acp-key="opencode" data-state="installed" data-selected="true">
      <span class="settings-ai-acp-agent-name">opencode</span>
      <span class="settings-ai-acp-agent-status stg-status stg-status--ok">Installed</span>
      <code class="settings-ai-acp-key">opencode</code>
    </div>
    <div class="settings-ai-acp-agent" data-acp-key="claude" data-state="adapter-missing">
      <span class="settings-ai-acp-agent-name">Claude Code</span>
      <span class="settings-ai-acp-agent-status stg-status stg-status--warn">Adapter missing</span>
      <code class="settings-ai-acp-key">claude</code>
      <span class="settings-ai-acp-hint">npm install -g @agentclientprotocol/claude-agent-acp</span>
    </div>
    <div class="settings-ai-acp-agent" data-acp-key="codex" data-state="not-installed">
      <span class="settings-ai-acp-agent-name">Codex</span>
      <span class="settings-ai-acp-agent-status stg-status">Not installed</span>
      <code class="settings-ai-acp-key">codex</code>
    </div>
  </div>
</div>
```

When the profile has an empty `agent` (a hand-written `command`), the profile
card's meta line reads: `This profile uses an explicit "command" instead of an
allowlist key.`

No profile, agents detected — same panel shell under
`.settings-ai-acp-info`, no profile card, plus (this keeps the exact phrases
the current tests grep for):

```html
<p class="settings-ai-acp-note settings-help">ACP agents were detected on this
  server, but none is configured. Enable one by adding <code>"agent":
  "&lt;key&gt;"</code> (or a <code>"command"</code>) to
  <code>config/acp.json</code> on the server (not editable here).</p>
```

No profile and no agent detected: render nothing (current behaviour).

### 5.5 Read-only affordance

Three signals, all non-interactive:
1. A **Read-only** `.stg-tag` in the panel header (with a lock glyph,
   `aria-hidden`; the word is the message).
2. The panel is a plain `<div>`/`<span>` tree — no inputs, no buttons, so it is
   not tabbable.
3. An inset surface (`--bg-elev` + border) visually distinct from the editable
   form fields, with no group rule above it.

---

## 6. Responsive behaviour

- The modal size is user-chosen (`--settings-modal-width/height`, 60/75/90 vw),
  so a viewport media query is a poor proxy for the modal's own width. The
  system is fluid instead: nav is a fixed 180px column; the section pane is
  `flex: 1; min-width: 0`; rows keep `min-width: 0` so a long path or status
  string can never push the modal open.
- Chips wrap (`flex-wrap`), card rows wrap their meta cluster, and the ACP
  agent rows wrap (hint on its own full-width line). Nothing is clipped at
  compact width.
- The one optional viewport tweak, matching the Designer's existing pattern
  (`@media (max-width: 640px)`), is to lay the nav out as a horizontal scroll
  strip above the sections. Recommended only if a phone viewport must be
  supported; not required by the brief.

## 7. Font-scale behaviour

Spacing and control padding are px (constant rhythm); all text is rem, so
S/M/L/XL scale type only. The label gutter `--stg-label-w` is a fixed 132px
flex-basis and is **not** enlarged at XL: a long label such as "Graph
background particles" simply wraps to a second line and the row grows taller
(nothing is clipped and the modal never gains a horizontal scrollbar).
Growing the gutter with `--font-scale` was rejected because it would starve
the field at compact width. Switches, dots, and nav rails are px
micro-decoration and never balloon.

## 8. Accessibility (values computed against the real tokens)

Contrast of body/secondary text on the two surfaces it uses:

| Text | Surface | Dark | Light |
| --- | --- | --- | --- |
| `--fg` | `--bg-elev` | 11.3:1 | 13.5:1 |
| `--fg-muted` (scoped §3.1) | `--bg-elev` | 4.96:1 | 5.13:1 |
| `--fg-muted` | `--bg-panel` | 5.52:1 | 5.56:1 |

Status text at ~.82rem (normal size, so the 4.5:1 bar applies):

| State colour | Surface | Dark | Light |
| --- | --- | --- | --- |
| `--stg-ok` (Installed / on) | `--bg-elev` | 7.61:1 | 5.28:1 |
| `--stg-warn` (Adapter missing / off) | `--bg-elev` | 7.68:1 | 5.10:1 |
| `--danger` (error) | `--bg-elev` | 5.07:1 | 4.68:1 |

All pass 4.5:1. The scoped `--stg-ok` / `--stg-warn` tokens exist because the
app-level `--ok` (#2faa66) and `--warn` (#c9831d) are only 2.56:1 / 2.68:1 on
`--bg-elev` in the light theme — too low to colour text, which is why light
gets darker variants while dark reuses the app values. The neutral "Not
installed" state carries no success/warning meaning, so it deliberately stays
`--fg` text with a `--fg-muted` dot rather than a coloured label.

- **Not colour-only.** Every status pairs a colour with a word; state dots are
  `aria-hidden`.
- **Toggles.** The switch is a styled native `<input type="checkbox">`; the
  label association, keyboard toggle, and screen-reader semantics are
  unchanged. Focus shows a visible accent ring.
- **Radio chips.** The native radio stays focusable; `:focus-visible` puts a
  ring on the chip. Arrow-key group navigation is unchanged.
- **Focus everywhere.** Buttons, fields, nav items, and switches all show a
  `2px --accent` focus ring.
- **Read-only ACP.** No interactive elements; the "Read-only" tag is text.

---

## 9. Required source changes (for `web-engineer`)

### `static/css/style.css` — additive and scoped

- Add the scoped token block (§3.1) and the scoped component rules
  (§3.3–§3.6, §5.3), all prefixed `#settings-overlay`.
- **Keep every shared global rule intact** — `.settings-row` (1617),
  `.settings-label` (1629), `.settings-action` (1757),
  `.settings-action--primary` (4468), `.theme-options` (1737),
  `.font-size-options` (1747), `.settings-form-title`, `.settings-hint`,
  `.settings-note`, `.settings-subheading`. The Designers/Export/Auth modals
  depend on them. The new `#settings-overlay …` rules win only inside Settings.
- The only global rules you may touch are the `.settings-watch-status`
  colour/dot rules; the safest change is to add the scoped overrides in §3.6
  and leave the global ones in place (the scoped ones win inside Settings).
- Do **not** introduce a `[class$="-options"]` selector; list the eight
  Settings radio-group classes explicitly (§3.6).

### `templates/index.html`

- No id or class is renamed.
- Appearance tab: add three `.settings-form-title` labels — "Interface"
  (before Theme), "Modal size" (before Settings modal width), "Wallpaper"
  (before Wallpaper).
- Add `settings-action--primary` to: `#settings-vimrc-save`,
  `#settings-ai-prompt-save`, `#settings-ai-searxng-save`,
  `#settings-tokens-create`, `#settings-ai-add`. (These are the only markup
  edits for the primary variant; without them it is dead.)
- AI tab: rename the "Custom prompt" group label to **"Assistant
  instructions"** (keep the element ids untouched).
- No other markup change: switches, chips, fields, and the select are all
  achieved in CSS from the existing elements.

### `static/js/settings.js`

- `buildAcpAgentLines(agents)` (~1299): emit the row structure in §5.4 — name,
  status (classes `settings-ai-acp-agent-status stg-status
  stg-status--<state>` and the words Installed / Adapter missing / Not
  installed), mono key chip, and the hint line only for adapter-missing; set
  `data-state` and, when `a.key === aiAcpProfile.agent`,
  `data-selected="true"`.
- `buildAiAcpRow(acp, agents)` (~1330): build the panel head + help + profile
  card + **a "Detected agents" sub-label only when `agents` has entries** +
  the agent list. Stop emitting `.settings-ai-acp-selected`.
- `buildAiAcpInfoRow(agents)` (~1359): same panel shell under
  `.settings-ai-acp-info`. Keep the "none is configured" / `"agent": "<key>"`
  note wording (§5.4) so the existing test regexes pass.
- `buildAiRow(s)` (~1069): add `settings-ai-test` to the Test button; add
  `settings-ai-remove` to Remove; render the default marker as a
  `.stg-tag--accent` "Default" tag when active and a ghost "Make default"
  button otherwise (or keep the button and add `settings-ai-default`
  styling).
- Optional: give `#settings-ai-prompt-status` / `#settings-ai-searxng-status`
  the `.stg-status` + state classes at runtime ("Saved" → `--ok`, error →
  `--danger`), and the same for `#settings-vimrc-status`.

### `tests/dom/test_dom.js` (D1 — update in the same change)

No selector changes are needed: the ACP panel stays inside `#settings-ai-list`,
so `#settings-ai-list .settings-ai-acp-row`, `…-info`, and
`.settings-ai-acp-agent[data-acp-key]` still resolve. Only these **text**
assertions change:

- `23305-23308` — `/^opencode — installed$/` → the row now contains
  `opencode` and the word `Installed`.
- `23309-23313` — the exact `"Claude Code — installed — ACP adapter missing (…)"`
  string → the row contains `Claude Code`, `Adapter missing`, and the hint
  `npm install -g @agentclientprotocol/claude-agent-acp`.
- `23314-23317` — `/^Codex — not installed$/` → `Codex` + `Not installed`.
- `23290-23295` — keep `/ACP agent: acp-agent/`? **No** — that sentence is gone.
  Change to assert the row contains the profile name `acp-agent`, a `Selected`
  tag, and the key `opencode`; keep `/config\/acp\.json/` and
  `/not editable here/` unchanged.
- `23318-23320` — `/Selected agent key: opencode/` → assert the profile card's
  key chip reads `opencode`.
- `23357-23360` — **unchanged**: the note keeps `none is configured`,
  `"agent": "<key>"`, and `config/acp.json`.
- `23374-23376` — **unchanged**: the empty-key note keeps
  `explicit "command" instead of an allowlist key`.
- The harness markup (the copy inside `test_dom.js`) does not need structural
  edits: it has no ACP nodes (the ACP panel is rendered by JS).

---

## 10. Reference mockup

`docs/design/settings-modal.html` — standalone, no build step, no
dependencies. It inlines the app's real tokens as `.theme-dark` / `.theme-light`
and renders the modal once per tab, the AI-tab ACP panel in both themes, a
before/after of the ACP block, and the XL scale. Open it directly in a browser.
The mockup **illustrates** §3–§5; if it disagrees, this document is
normative.

---

## 11. Acceptance criteria

- [ ] All six tabs use one section-heading style and one group-label style;
      no tab has a one-off title.
- [ ] `.settings-help` and `.settings-note` render at .86rem; `.settings-hint`
      at .78rem.
- [ ] Every Settings text input, textarea, and select shares one border,
      background, radius, and focus ring, and fills its row; Settings fields
      are sans-serif while the Auth modal's `.auth-input` stays mono.
- [ ] Buttons have one base + four variants (secondary, primary, ghost, danger
      ghost) with one focus ring; the primary variant is used by at least the
      five buttons listed in §9.
- [ ] Every Settings checkbox renders as a switch with a token-coloured knob;
      its id survives; keyboard focus shows an accent ring; the label toggles
      it.
- [ ] Every Settings radio group renders as wrapping chips; the checked chip
      is accent-tinted and bold; `:has()` is used and `.is-checked` works as a
      fallback.
- [ ] Provider rows and token rows share the card shape with `.shortcut-row`.
- [ ] The ACP block renders as a read-only panel with a "Read-only" tag and no
      tabbable controls; the "Detected agents" heading is absent when no agent
      was detected.
- [ ] Each detected ACP agent has a dot + word state (Installed / Adapter
      missing / Not installed); the adapter-missing row shows the hint.
- [ ] The agent the configured profile selects is marked "Selected" and
      carries an accent row rail.
- [ ] A configured profile shows a profile card named after `cfg.acp.name`
      with its allowlist key; a null profile with a detected agent shows the
      enable note; neither profile nor agents renders nothing.
- [ ] Both themes and all four font scales render without horizontal overflow
      at the compact modal width; long row labels may wrap to a second line at
      XL.
- [ ] No class or id is renamed; the scoped `#settings-overlay` rules leave the
      Export / Auth / Designer modals unchanged (the Designer's Apply button
      keeps its accent fill).
- [ ] Every status text colour clears 4.5:1 on `--bg-elev` in both themes
      (values in §8).
- [ ] No new dependency, no framework, plain CSS; colours and sizes come from
      the existing tokens plus the scoped `--stg-*` set; no hard-coded colour
      values.
