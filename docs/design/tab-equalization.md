# Tab-bar width re-equalization — design + handoff

**Status:** implemented; the pinned-region split (§2.4) shipped on top of it
**Owner:** `ui-designer` (this doc + the mockup)
**Implementer:** `web-engineer` (edits `static/`; this doc does not)
**Reference mockup:** [`tab-equalize-mockup.html`](tab-equalize-mockup.html)

---

## 1. Problem

Tabs are equal width. The rule on `.tab` is
`flex: 1 1 var(--tab-width)` with `min-width` / `max-width` rails
(`static/css/style.css:978-999`), so the strip re-equalizes **instantly**
whenever the tab count changes.

> **Baseline note.** The equal-width rule, the width-freeze, and the pinned
> split are one working-tree change set, not `HEAD`. Against `HEAD`, tabs are
> content-sized with only `max-width: 220px`, pinned tabs are narrower, and
> the bar has a single scroller. The equal, bounded width is a deliberate part
> of this work (without it nothing re-equalizes, so the release animation has
> no premise). Pinned tabs keep their natural width instead (§2.4).

To stop tabs from shifting out from under the cursor while closing,
`static/js/tabs.js` pins widths while the pointer is inside the bar:

- `mouseenter` on `#tab-bar` (`tabs.js:669`) snapshots each tab's measured
  pixel width into `frozenWidths` (`tabs.js:56`, `captureFrozenWidths`
  `tabs.js:125`) and writes inline `flex: 0 0 <w>px; width: <w>px`
  (`applyFrozenWidths` `tabs.js:133`).
- While frozen, `render()` (`tabs.js:312`) re-applies those pins after a
  close, so the strip stays put.
- `mouseleave` (`tabs.js:679`) calls `unfreezeWidths()` (`tabs.js:223`),
  which clears the inline pins. The stylesheet rule takes over and every tab
  **snaps** to its new equal width.

The snap is the thing to fix. Everything else about the freeze stays.

---

## 2. Design decision

### 2.1 Where the animation belongs — **release only**

> **Superseded in part by [`tab-close-animation.md`](tab-close-animation.md).**
> The statement below that "close while frozen must stay instant" no longer
> holds for the shipped close: a frozen close now leaves a **ghost** placeholder
> at the closed tab's slot whose box **collapses and fades immediately** (over
> `--tab-close-duration`, `100ms`), Firefox-style. That motion animates the
> ghost box, not the survivors — the survivors keep their frozen widths and
> slide left as the ghost shrinks, so the next close button is never resized and
> the slide-under-the-cursor bug the freeze removes does not return. The
> re-equalization (`nb-tab-equalize`) is still not a close motion: it runs for
> the pointer-**outside** close and for the release when no ghost is pending.

The release is the only moment the **survivors' width re-equalization**
animates. The purpose of the freeze is to keep the strip motionless so the next
close button does not slide away. A close-while-frozen that resized the
survivors would reintroduce the exact bug the freeze removes; that is why
`captureCloseReflow` self-returns `null` while frozen and the released
`nb-tab-equalize` never runs on a frozen close.

This does **not** mean a frozen close is invisible. The shipped close animates a
**ghost** placeholder (the closed tab's box) instead of the survivors; see
[`tab-close-animation.md`](tab-close-animation.md). The ghost owns its own
collapse-and-fade, so the close is visible immediately while the survivors stay
at their frozen widths.

Open/close while **not** frozen (pointer outside the bar — sidebar click,
keyboard, tab restore) keeps the survivor re-equalization instant, except for
the pointer-**outside** close, which plays `nb-tab-equalize` from the captured
pre-close widths. Those changes are part of navigation, they usually swap the
active tab anyway, and wiring an animation into every `render()` is what makes
it replay on unrelated renders (requirement 3). Keep the survivor motion scoped
to two events: the pointer leaving the bar after a freeze, and a close with the
pointer outside the bar.

**Tradeoff, stated plainly:** the survivor re-equalization animates in only two
situations — the pointer leaving the bar after a freeze, and a close with the
pointer outside the bar — and every other re-equalization is instantaneous.
That is consistent: the user only notices the re-equalization when their pointer
is on the bar and then leaves, or on a close they initiated from outside the
bar. Everywhere else a new tab opening is already the dominant visual change.

### 2.2 What animates — `flex-basis`, and it is a layout animation

The tab's main size is driven by `flex-basis`, not `width`: with a definite
`flex-basis` a flex item ignores `width` for its main size. So the animated
property is **`flex-basis`**, held at `flex-grow: 0` / `flex-shrink: 0` for
the duration so the used width equals the basis and interpolates linearly.

`flex-basis` is **layout-triggering**, not compositor-only. Each frame
re-runs flex layout on `#tab-bar` and its tabs (both regions). This is
acceptable at typical tab counts: the subtree is a handful of small divs with
no layout-heavy descendants, the animation is 180 ms, and it runs at most once
per pointer-exit. As a guard, the implementation skips the animation above
`TAB_RELEASE_MAX_TABS` (24) tabs — past that the strip is at `min-width` and
scrolling, so there is usually no visible delta anyway.

We do **not** use `transform: scaleX()` (FLIP): it distorts the label text,
the close button, the 6 px corner radius, and the 1 px borders — all of which
read as broken on a tab. A true width interpolation is the honest animation
here, and the cost is small.

### 2.3 How the transition is triggered — a scoped keyframe animation

A plain `transition` on `.tab` is wrong: it would also fire on any render
that changes a pinned tab's width, including tab opens outside the frozen
state (requirement 3, exactly the failure to avoid).

**Chosen mechanism:** on release, clear the inline pins **synchronously**
(so the strip's resting state is immediately the equal layout, and the
existing test contract at `tests/dom/test_dom.js:3216-3217` still holds),
measure both the frozen ("from") and equal ("to") widths, then play a scoped
CSS **keyframe animation** whose `from`/`to` widths arrive per tab through
two inline custom properties. The animation holds `flex-grow: 0` while it
runs, so the tab lays out at the animated basis; when it ends
(`animation-fill-mode: none`), the tab reverts to the stylesheet
`flex: 1 1 var(--tab-width)` layout, whose result is numerically identical to
the animation's `to` width — so there is no jump at the end.

Why this over the alternatives:

- **Scoped class + transition, clear pins at `transitionend`.** Correct, but
  it keeps the inline pins alive for the whole animation, so the existing
  synchronous `style.width === ""` assertion breaks, and `transitionend` is
  unreliable (it does not fire when start == end). More moving parts.
- **Web Animations API (`Element.animate`).** Explicit and cancellable, but
  the codebase uses WAAPI nowhere, it moves duration/easing into JS (against
  the CSS-token convention), and jsdom has no `Element.prototype.animate`, so
  the DOM harness could not exercise it.
- **`@property` registered custom properties.** Would allow a pure-CSS
  transition of a width variable, but `@property` is a new mechanism the
  project does not use, and it would not preserve the synchronous clear.

The chosen keyframes approach keeps timing/easing/reduced-motion in CSS
(project idiom), keeps the inline-clear synchronous (existing test stays
green), and touches JS only to measure and to add/remove one class.

### 2.4 The pinned region — a second, non-equalizing child of the bar

The tab bar is no longer a single scroller. `#tab-bar` holds three children
in order (`templates/index.html:128-142`):

1. `#tab-pinned` (`.tab-pinned`) — the pinned tabs, a **fixed, non-scrolling**
   region (`templates/index.html:133`);
2. `#tab-list` (`.tab-list`) — the unpinned strip, **the only part of the row
   that scrolls** (`templates/index.html:137`);
3. `#outline-toggle` — the outline button, a fixed sibling at the right edge
   (`templates/index.html:141`).

The pinned region is `flex: 0 0 auto` (`style.css:450-457`), so it never
shrinks; the scroller (`flex: 1 1 auto`, `min-width: 0`, `overflow-x: auto`,
`style.css:429-432`) yields the space instead. The region is capped at
`max-width: 50%` and scrolls internally beyond that (with the scrollbar
hidden), so a long pinned set can neither squeeze the scroller out nor push
the outline toggle off the edge. `tabs.js` hides the region entirely while
nothing is pinned — `pinEl.hidden = pinned.size === 0` (`tabs.js:382`) — and
the CSS `[hidden]` rule wins over its `display: flex` (`style.css:463`). There
is no separator between the regions; the bar's own `2px` gap is the only
spacing.

Pinned tabs **rest at their natural width** rather than equalizing:
`.tab-pinned .tab { flex: 0 0 auto; max-width: none; }` (`style.css:469`). The
region is content-sized, so there is no free space for the
`flex: 1 1 var(--tab-width)` rule to distribute; a pinned tab renders at its
content width and lifts the shared `max-width` rail so a long name shows in
full (the region caps and scrolls instead). A pinned tab also has no close
button (`tabs.js:363-370`), so no room is reserved for one. The equal-width
rule still applies to every unpinned tab. In the real-browser run (§11.1) a
long pinned name measured `331px` untruncated, and the region capped at `50%`
of the bar when many tabs were pinned.

The freeze/release machinery covers both regions without a special case. It is
path-keyed — `frozenWidths` is a `Map<path, px>` (`tabs.js:56`) and
`captureFrozenWidths` / `applyFrozenWidths` look each tab up by
`tab.dataset.path` (`tabs.js:125-141`) — and `realTabs()` queries the **bar**,
not the scroller: `barEl.querySelectorAll(".tab:not(.ghost)")`
(`tabs.js:106-108`). So a freeze pins pinned and unpinned tabs alike, and the
release selector `.tab-bar.nb-tab-equalizing .tab` (`style.css:1055`) reaches
a `.tab` wherever it sits in the bar. The release class itself was moved from
`#tab-list` to `#tab-bar` for exactly this reason (see §4.2, §5, §6).

---

## 3. Tokens

Declare the two new tunables on `.tab-bar`, beside `--tab-min-width` etc.
(`style.css:400-402`). No new colors; nothing else in the theme changes.

| Token | Value | Declared on | Meaning |
| --- | --- | --- | --- |
| `--tab-release-duration` | `180ms` | `.tab-bar` | Length of the release re-equalization. |
| `--tab-release-ease` | `ease-out` | `.tab-bar` | Settle curve: quick start, gentle stop. |

Rationale for the values:

- **180 ms** is a step above the existing micro-transitions (`.12s`/`.15s`
  at `style.css:212, 332, 2520, 2891, 3513`) because it moves several
  elements at once and benefits from a touch more time; it is well under the
  ~300 ms ceiling for interface motion.
- **`ease-out`** matches the intent (elements relaxing into their resting
  place). The existing `ease` is used for symmetric hover fades; a settle is
  asymmetric, so `ease-out` is the right keyword and still a standard token,
  not a bespoke bezier.

JS mirrors the duration only for the fallback timer (see §5.4). The CSS
remains the source of truth; the constant is a backstop for environments
where the stylesheet is not applied (the jsdom harness does not load
`style.css` as a sheet).

---

## 4. CSS spec

Three blocks in `static/css/style.css`. The tokens sit inside the existing
`.tab-bar` rule; the keyframes + release rule sit after the `.tab` rules
(`style.css:1041`, the `.drop-after` rule), so the whole tab section stays
together.

### 4.1 Tokens (`.tab-bar`, `style.css:392-421`)

```css
.tab-bar {
  /* ... existing declarations ... */
  --tab-min-width: 120px;
  --tab-width: 170px;
  --tab-max-width: 220px;
  /* Release re-equalization: when the pointer leaves the bar the frozen
   * inline widths are released and every tab animates to its new equal
   * width. Duration/easing live here so the animation stays tunable in CSS. */
  --tab-release-duration: 180ms;
  --tab-release-ease: ease-out;
}
```

### 4.2 Release keyframes + scoped rule (`style.css:1043-1057`)

```css
/* Release re-equalization. tabs.js clears each tab's frozen inline flex
 * synchronously and, when a visible width change is coming, tags the
 * bar with .nb-tab-equalizing and feeds each tab its start/end width
 * through --nb-tab-from / --nb-tab-to. flex-grow is held at 0 for the
 * duration so the used width equals the animated flex-basis; when the
 * animation ends the tab reverts to the stylesheet's equal-width flex rule
 * at the same width, so there is no jump. The class is the only thing that
 * enables the animation -- an unrelated render never triggers it. The
 * selector is bar-scoped so it reaches a .tab in either region (the pinned
 * region is a sibling of the scroller). */
@keyframes nb-tab-equalize {
  from { flex-grow: 0; flex-shrink: 0; flex-basis: var(--nb-tab-from); }
  to   { flex-grow: 0; flex-shrink: 0; flex-basis: var(--nb-tab-to); }
}
.tab-bar.nb-tab-equalizing .tab {
  animation: nb-tab-equalize var(--tab-release-duration) var(--tab-release-ease);
}
```

### 4.3 Reduced motion (same idiom as `style.css:3171`)

Add to the existing `@media (prefers-reduced-motion: reduce)` block at
`style.css:1060` (or as its own block next to the keyframes):

```css
@media (prefers-reduced-motion: reduce) {
  .tab-bar.nb-tab-equalizing .tab { animation: none; }
}
```

With `animation: none` the tab sits at the stylesheet equal width
immediately — i.e. the current instant behavior. JS also skips adding the
class under reduced motion (§5.3); the media query is the second line of
defense.

No color, border, or background property is animated, so contrast is
unchanged in both themes.

---

## 5. JS contract (`static/js/tabs.js`)

Keep `captureFrozenWidths` (`tabs.js:125`) and `applyFrozenWidths`
(`tabs.js:133`) exactly as they are — they still pin with
`tab.style.flex = "0 0 " + w + "px"` / `tab.style.width = w + "px"`, keyed by
`tab.dataset.path`, which the existing freeze test asserts
(`tests/dom/test_dom.js:3216-3218`).

`unfreezeWidths` (`tabs.js:223-239`) is the shipped orchestrator below; the
constants sit beside `frozenWidths` (`tabs.js:56`, `tabs.js:63-70`). The
`mouseleave` binding (`tabs.js:679`) is unchanged — it still calls
`unfreezeWidths`.

### 5.1 Constants (module state, `tabs.js:63-70`)

```js
  // Release re-equalization. RELEASE_CLASS scopes the keyframes; RELEASE_ANIM
  // matches the keyframes name so the animationend handler ignores any other
  // future .tab animation. Timing lives in CSS (--tab-release-duration); the
  // fallback timer guards a dropped animationend.
  const RELEASE_CLASS = "nb-tab-equalizing";
  const RELEASE_ANIM = "nb-tab-equalize";
  const TAB_FROM_VAR = "--nb-tab-from";
  const TAB_TO_VAR = "--nb-tab-to";
  const TAB_RELEASE_FALLBACK_MS = 280;   // >= CSS duration; timer backstop
  const TAB_RELEASE_MAX_TABS = 24;       // above this, re-equalize instantly
  const WIDTH_EPSILON = 0.5;             // px; smaller deltas are invisible
  let releaseTimer = null;
```

### 5.2 Helpers

```js
  /* True when the user has asked the OS for reduced motion. Mirrors the
   * guard graph.js uses (graph.js:104-107). */
  function prefersReducedMotion() {
    try {
      return !!(window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (_) { return false; }
  }

  /* Drop the inline freeze pins on the given tabs. */
  function clearPins(tabs) {
    tabs.forEach(t => { t.style.flex = ""; t.style.width = ""; });
  }

  /* End or cancel the release animation. Idempotent: called by the fallback
   * timer, by animationend, and to cancel on re-entry or mid-flight render. */
  function stopRelease() {
    if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null; }
    barEl.classList.remove(RELEASE_CLASS);
    realTabs().forEach(t => {
      t.style.removeProperty(TAB_FROM_VAR);
      t.style.removeProperty(TAB_TO_VAR);
    });
  }
```

### 5.3 The release orchestrator (replaces `unfreezeWidths`)

```js
  /* Release the freeze. The inline pins are cleared synchronously so the
   * strip's resting layout is the equal-width one immediately (this is also
   * the reduced-motion / no-delta fallback). When a visible change is
   * coming, a scoped keyframe animation replays the move from the frozen
   * widths to the measured equal widths. */
  function unfreezeWidths() {
    if (!frozenWidths) return;
    frozenWidths = null;
    const tabs = realTabs();           // both regions; ghosts excluded
    if (!tabs.length) return;

    const start = tabs.map(t => t.getBoundingClientRect().width);  // frozen widths
    clearPins(tabs);

    // Instant paths: reduced motion, an active drag, an oversized strip.
    // The pins are already gone, so the strip has re-equalized at once.
    if (prefersReducedMotion() || draggingPath ||
        tabs.length > TAB_RELEASE_MAX_TABS) return;

    // Measure the equal layout. This read also flushes the cleared pins,
    // so no explicit reflow is needed.
    const end = tabs.map(t => t.getBoundingClientRect().width);
    if (!tabs.some((_, i) => Math.abs(start[i] - end[i]) > WIDTH_EPSILON)) return;

    tabs.forEach((t, i) => {
      t.style.setProperty(TAB_FROM_VAR, start[i] + "px");
      t.style.setProperty(TAB_TO_VAR, end[i] + "px");
    });
    barEl.classList.add(RELEASE_CLASS);
    releaseTimer = setTimeout(stopRelease, TAB_RELEASE_FALLBACK_MS);
  }
```

### 5.4 Completion hook (beside the drag listeners)

```js
  /* End the release as soon as the last tab finishes. Accept events that
   * name the release keyframes; also accept an unnamed synthetic event,
   * since a real browser always sets animationName but the jsdom harness
   * dispatches a plain Event. Other named animations are ignored. */
  barEl.addEventListener("animationend", (e) => {
    if (!e.animationName || e.animationName === RELEASE_ANIM) stopRelease();
  });
```

The fallback timer covers a missing `animationend` (e.g. start == end for
every tab, or a backgrounded tab), so completion never depends on a single
event.

### 5.5 Two cancel hooks

**A. `render()` cancels first** (`tabs.js:312`). New node sets would otherwise
inherit the class's animation with no `--nb-tab-from` / `--nb-tab-to` set,
which resolves to an invalid `flex-basis`. It also clears both regions, since
pinned and unpinned tabs render into different parents (`tabs.js:315-316`).

```js
  function render() {
    stopRelease();               // an in-flight settle belongs to the old nodes
    captureFrozenWidths();
    pinEl.innerHTML = "";
    listEl.innerHTML = "";
    /* ... unchanged ... */
  }
```

**B. `mouseenter` cancels before freezing** (`tabs.js:669-678`). A quick
leave-and-re-enter must not fight the animation: it cancels at the current
mid-animation width and freezes there.

```js
  barEl.addEventListener("mouseenter", () => {
    if (frozenWidths) return;
    stopRelease();               // re-entering cancels an in-flight settle
    frozenWidths = new Map();
    captureFrozenWidths();
  });
```

### 5.6 Test hook

Expose the release state next to `isWidthFrozen` (`tabs.js:683`, `tabs.js:687`):

```js
  function isReleasing() { return barEl.classList.contains(RELEASE_CLASS); }
  // ... and in the NB.tabs object:
  isReleasing,
```

---

## 6. States and timing

| State | Trigger | Inline pins | `#tab-bar` class | Visual |
| --- | --- | --- | --- | --- |
| **Rest** | — | none | — | Equal widths from CSS. |
| **Frozen** | `mouseenter` on `#tab-bar` | `flex: 0 0 <w>px; width: <w>px` per tab | — | Strip holds still across a close/open. The pin covers pinned and unpinned tabs (path-keyed); a pinned tab's width is already natural, so its pinned value is its own width. |
| **Releasing** | `mouseleave` → visible delta | cleared | `nb-tab-equalizing` | 180 ms `ease-out` `flex-basis` move to the measured equal widths. |
| **Released** | `animationend` or 280 ms backstop | cleared | — | Equal widths from CSS, same as the animation's end. |
| **Instant release** | reduced motion, active drag, > 24 tabs, or no delta | cleared | — | Pre-animation behavior: immediate equal widths. |

The animation ends on the width the CSS rule would produce on its own, so
the transition from the animated layout to the stylesheet layout is
pixel-identical.

---

## 7. Reduced motion

- CSS: `animation: none` inside `@media (prefers-reduced-motion: reduce)`
  (§4.3), matching the existing `style.css:3171` idiom.
- JS: `unfreezeWidths` returns before adding the class when
  `prefersReducedMotion()` is true (§5.3). The pins are already cleared, so
  the fallback is exactly today's instant re-equalization.
- `matchMedia` is guarded in a `try/catch` with a `false` default, so the
  jsdom stub and any environment without it behave as "not reduced".

---

## 8. Interaction with drag and with the freeze

- **Drag:** `draggingPath` is non-null from `dragstart` (`onDragStart`,
  `tabs.js:578`, set at `582`) until `dragend` (`clearDragging`,
  `tabs.js:644`). `unfreezeWidths` returns before animating while
  it is set, so a drop settles instantly and the animation never fights the
  browser's drag image or a re-render. `draggingPath` is cleared on `dragend`
  before any later `mouseleave`.
- **Replay on render:** the animation is enabled only by the class, which is
  added solely in `unfreezeWidths` and removed by `stopRelease`. `render()`
  calls `stopRelease()` first, so no render can start or replay it.
- **No fight with the freeze:** `mouseenter` calls `stopRelease()` before
  capturing, so re-entry cancels a settle and freezes at the current widths.

---

## 9. Edge cases

| Case | Behavior |
| --- | --- |
| Tab opened while frozen (no entry in `frozenWidths`) | On release it measures its current natural width as "from"; if that already equals "to" it simply does not move. It never animates from a missing value. |
| One tab total / one tab left | Animates from the frozen width to the single equal width (clamped to `--tab-max-width`), or not at all if already there. |
| Overflow / scrolling (many tabs at `--tab-min-width`) | The target equals the frozen `min-width`, so the delta is ~0 and the guard skips the animation. `scrollLeft` is untouched — animating `flex-basis` does not scroll. |
| Tabs clamped at min or max | If the frozen width already equals the clamped target, no visible motion. If only one bound changes, all tabs still share the same target, so the strip stays uniform throughout. |
| Pointer leaves and immediately re-enters | `mouseenter` cancels the settle and freezes at the mid-animation widths; the next release starts a fresh animation. No snap-back. |
| `mouseleave` during a drag | Skipped (instant release). |
| All tabs removed (`clearAll`, `auth:locked`) | `tabs.length === 0`, nothing to animate; pins are already absent. |
| `mouseleave` without a prior freeze | `frozenWidths` is null, immediate return. |
| Reduced motion | Instant release; class never added. |
| A render fires mid-animation (e.g. `viewer:conflict`) | `render()` calls `stopRelease()`; the rebuilt strip renders at the equal widths. Acceptable — the tab set is changing anyway. |
| Very narrow list (container < `--tab-min-width`) | Tabs clamp to `min-width` and overflow into the scroller; frozen and target widths match, so no animation. |
| Pinned tabs in the release | `realTabs()` is bar-scoped, so a pinned tab is measured and pinned like any other. Its "from" and "to" are the same natural width (the `.tab-pinned .tab { flex: 0 0 auto; }` rule does not change with tab count), so its delta is ~0 and it holds still while unpinned tabs equalize around it. |
| Pin / unpin mid-animation | `togglePin` calls `render()`, which calls `stopRelease()` first; the rebuilt two-region strip renders at rest. |
| Last pinned tab unpinned | `render()` sets `pinEl.hidden = true`; the region takes no space (`style.css:455`) and the bar lays out as it did before the split. |

The `#outline-toggle` sits outside `#tab-list` as a sibling, to the right of
the scroller (`templates/index.html:128-142`), and is never matched by the
release selector. The same is true of `#tab-pinned` on the left; it is a
sibling of the scroller, not a child, so the release class on the bar (rather
than on `#tab-list`) is what reaches a pinned tab.

---

## 10. Acceptance checklist (for `tester`)

String/static checks against `static/css/style.css` (the harness already
reads the file as text, e.g. `tests/dom/test_dom.js:1575`):

- [ ] `.tab-bar` declares `--tab-release-duration: 180ms`.
- [ ] `.tab-bar` declares `--tab-release-ease: ease-out`.
- [ ] `@keyframes nb-tab-equalize` exists with `from`/`to` setting
      `flex-basis: var(--nb-tab-from)` / `var(--nb-tab-to)` and
      `flex-grow: 0`.
- [ ] `.tab-bar.nb-tab-equalizing .tab` sets
      `animation: nb-tab-equalize var(--tab-release-duration) var(--tab-release-ease)`.
- [ ] A `@media (prefers-reduced-motion: reduce)` block contains
      `.tab-bar.nb-tab-equalizing .tab { animation: none; }`.
- [ ] `.tab-pinned` is `flex: 0 0 auto`, capped at `max-width: 50%`, and
      scrolls internally (`overflow-x: auto`) so a long pinned set cannot
      squeeze the scroller out or clip the outline toggle.
- [ ] `.tab-pinned[hidden]` is `display: none`; `.tab-pinned .tab` is
      `flex: 0 0 auto; max-width: none` (natural width, no truncation).

Behavior checks in `tests/dom/test_dom.js` (the freeze block starts at
`3197`; the harness runs it with `pretendToBeVisual: true`
(`test_dom.js:744`), so `requestAnimationFrame` exists):

- [ ] Existing, unchanged: after `mouseenter` + `close()`, the survivor keeps
      `style.width === "<w>px"` and `style.flex === "0 0 <w>px"`
      (`test_dom.js:3216-3218`).
- [ ] Existing, unchanged: immediately after `mouseleave`,
      `isWidthFrozen()` is false and the survivor's `style.width`/`style.flex`
      are `""` (synchronous clear, `test_dom.js:3222-3224`).
- [ ] With stubbed non-zero rects whose released widths differ by more than
      `WIDTH_EPSILON`, `mouseleave` adds `nb-tab-equalizing` to `#tab-bar`
      and `NB.tabs.isReleasing()` is true.
- [ ] In that state every tab has inline `--nb-tab-from` / `--nb-tab-to`
      set to the expected `"<n>px"` values (start = frozen, end = equal).
- [ ] After dispatching `animationend` on the bar (an unnamed event is
      accepted), `isReleasing()` is false, the class is gone, and both inline
      custom properties are `""`.
- [ ] Advancing the fallback timer past `TAB_RELEASE_FALLBACK_MS` (fake
      timers, or a `setTimeout` long enough) also ends the release.
- [ ] With reduced motion true (`matchMedia` stub returns `matches: true`),
      `mouseleave` does **not** add the class and the pins are cleared.
- [ ] With `draggingPath` set (dispatch `dragstart` on a tab, then
      `mouseleave`), the class is not added.
- [ ] A `render()` call while releasing removes the class (no animation on
      unrelated renders).
- [ ] Re-entering (`mouseenter`) while releasing removes the class and leaves
      `isWidthFrozen()` true.

Note for the tester: the handler accepts an **unnamed** synthetic event
because jsdom has no `AnimationEvent` and a plain
`new window.Event("animationend")` carries no `animationName`; in a real
browser it matches `RELEASE_ANIM` (`nb-tab-equalize`) and ignores the ghost's
`nb-tab-ghost-close`.

---

## 11. What I could not verify

- **Real-browser timing and feel.** No browser was run in this environment.
  The 180 ms / `ease-out` choice is judged from the existing transition
  scale, not measured. Adjust `--tab-release-duration` if it reads slow;
  nothing else depends on the value.
- **`var()` inside `@keyframes`.** The mechanism relies on custom properties
  being substituted and then interpolated as lengths. This is standard,
  modern behavior (Chromium, Firefox, Safari) but was not executed here.
  `web-engineer` should confirm the first animated frame shows the `from`
  width, not the cleared/equal width.
- **jsdom cannot exercise the keyframes**, so the DOM tests can only assert
  the class, the custom properties, and the completion/cancel paths — not the
  rendered interpolation. The mockup is the visual reference.
- **The transient-overflow case** (releasing from wider frozen widths to a
  narrower equal width, e.g. a tab opened while frozen) may briefly let the
  rightmost tab clip at `#tab-list`'s edge before it settles. It is bounded
  by the 180 ms duration and clamped by `overflow-x: auto`. Not reproduced in
  a browser.

### 11.1 Verified in a real browser — the pinned region

Unlike the motion above, the pinned region's **layout** was measured directly.
Verified in a real **Firefox 155** (headless via Marionette) against a
throwaway server with **12+ tabs overflowing** the strip:

| Measurement | Result |
| --- | --- |
| Pinned tabs' parent | Both pinned tabs had `inPinnedRegion: true` (`#tab-pinned`). |
| Pinned tabs' screen positions across a full scroll | `left` `294`, `416` **before and after**; unchanged, and fully visible. |
| The unpinned strip's scroll | `scrollLeft` `1024` of `scrollWidth` `1584` vs `clientWidth` `560` — scrolled fully right. |
| The pinned region's own scroll | `scrollLeft` `0`; `scrollWidth == clientWidth == 246` — it never scrolled. |
| Unpinning both | The region went `hidden` with width `0`.
| Pinned tab widths | Natural width, not equalized: a long name measured `331px` untruncated, and the region capped at `50%` of the bar with many tabs pinned. |

So the split does what §2.4 claims: the pinned region is fixed and never
scrolls, the strip scrolls beneath it without moving pinned tabs, an empty
region collapses to nothing, and pinned tabs rest at their natural width.

---

## 12. Files

The equalization work above shipped together with the pinned-region split
(§2.4), so this table lists both.

| File | Change |
| --- | --- |
| `static/css/style.css` | Add the two release tokens to `.tab-bar`; add the keyframes + release rule + reduced-motion rule. Add the `.tab-pinned`, `.tab-pinned[hidden]`, and `.tab-pinned .tab` rules (`style.css:441-469`); move the release selector from `.tab-list.nb-tab-equalizing` to `.tab-bar.nb-tab-equalizing` (`style.css:1055`, `1061`, `1100`). |
| `static/js/tabs.js` | Add constants and helpers; `unfreezeWidths`; the `animationend` listener; `stopRelease()` at the top of `render()` and in the `mouseenter` handler; expose `isReleasing`. Add the `pinEl` accessor (`tabs.js:24`); bar-scope `realTabs()` (`106-108`); split `render()` output by region and hide the region via `syncPinnedRegion()` (`tabs.js:260-268`, `377`); move the release class to `barEl` (`180`, `215`, `687`); carry `pinned` in the ghost entry (`253`) and region-guard the ghost insert (`tabs.js:298-301`). |
| `templates/index.html` | The tab bar now holds `#tab-pinned`, `#tab-list`, and `#outline-toggle` (`index.html:128-142`). |
| `tests/dom/test_dom.js` | Extend the freeze block per §10; the pin-region assertions live in the `== tab pin + context menu ==` block (`9528-9596`). |

This document and the mockup live under `docs/`; the `ui-designer` role does
not edit `static/`, `templates/`, or `tests/`.
