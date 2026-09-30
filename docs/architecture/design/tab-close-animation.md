# Tab close animation

Extends [`tab-equalization.md`](tab-equalization.md). That document owns the
tokens, the width-freeze machinery, and the `nb-tab-equalize` re-equalization
keyframes. This document describes the **close motion**: a ghost placeholder in
the closed tab's slot that **collapses and fades immediately on close**, while
the survivors keep their frozen widths and slide left as its box shrinks.

**Status:** implemented and verified in a real Firefox via Marionette (see §8.2).
Not a proposal.
**Reference mockup:** [`tab-equalize-mockup.html`](tab-equalize-mockup.html).

---

## 1. Goal and plain-statement summary

A tab closed with the pointer inside the tab bar must not slide the strip under
the cursor, and the close must be visible **the moment it happens** — like
Firefox, not deferred until the pointer leaves the bar.

The plain statement, which the whole design follows from:

> The close is **visible immediately**: the closing tab's box **collapses and
> fades at once**, and the survivors **slide left** as it gives up the space.
> The survivors keep their frozen widths, so nothing re-sizes under the cursor.

The motion happens on a **ghost** — an inert copy of the closed tab's box
inserted at its slot — not on the live node. Three things in order:

1. **Create.** `close()` measures the closing tab and pushes a ghost entry.
   `render()` materializes a `div.tab.ghost` at the recorded slot with the
   measured width pinned inline.
2. **Collapse + fade.** The ghost plays `@keyframes nb-tab-ghost-close` —
   `flex-basis` from `<w>px` to `0`, opacity `1` to `0` — over
   `--tab-close-duration` (`100ms`) `--tab-close-ease` (`ease-out`). This is the
   visible close motion and it starts the instant the tab is closed.
3. **Self-remove.** Each ghost removes itself after `TAB_GHOST_FALLBACK_MS`
   (`280ms`) via its own `setTimeout`. There is no `transitionend` or
   `animationend` completion listener.

The survivors' own width reflow (`nb-tab-equalize`) is **not** the close motion.
It still runs for a close with the pointer **outside** the bar, and as the
release when the pointer leaves the bar with no ghost pending.

**Scope of the motion:** one class family (`.tab.ghost`, `.tab-ghost-fill`), one
keyframe pair (`nb-tab-ghost-close`), two close-only tokens
(`--tab-close-duration` / `--tab-close-ease`), one per-ghost timer
(`TAB_GHOST_FALLBACK_MS`), and the `realTabs()` accessor. The change is
`static/js/tabs.js` plus a scoped CSS block.

---

## 2. Mechanism

The sequence for a close of a tab **while the pointer is inside the bar**
(`frozenWidths !== null`) and reduced motion is off:

| Step | What happens | Why |
| --- | --- | --- |
| **Create** | `addGhost(path, idx)` (`tabs.js:245-255`) runs **before** `dropTab`. It finds the closing tab's node (bar-scoped, `tabs.js:246`), measures its pixel width into `width`, computes the `label`, records the tab's region as `pinned` (`tabs.js:253`), and pushes `{path,label,width,index,pinned,startedAt:0,node:null,timer:null}` onto the module `ghosts` array (`tabs.js:84`). | The node disappears at the next step, so its width must be measured first. The entry is **data**, so it survives the rebuild keyed by its recorded slot `index`, not by a node reference. `pinned` is read while `pinned` still holds the path; `dropTab` deletes it at the next step. |
| **Render** | `dropTab(path)` (`tabs.js:407-419`) removes the path from `ordered` / `openSet` / `pinned` / `frozenWidths` and closes its viewer entry. Then `render()` (`tabs.js:323-396`) runs: `stopRelease()`, `captureFrozenWidths()`, clear **both regions** (`pinEl.innerHTML = ""` / `listEl.innerHTML = ""`, `tabs.js:325-326`), rebuild the real tabs from `ordered` — appending each to `pinEl` or `listEl` by `pinned.has(path)` (`tabs.js:388`) — then **`materializeGhosts()`** (`tabs.js:394`), then `applyFrozenWidths()` (`tabs.js:395`). | `render()` stays the one strip-rebuild path. It is ghost-aware only in that it calls `materializeGhosts()` after the real tabs are appended; the real tab is gone immediately. |
| **Collapse + fade** | CSS `.tab.ghost` (`style.css:1071-1080`) runs `nb-tab-ghost-close` (`style.css:1095-1098`) over `--tab-close-duration` / `--tab-close-ease`, `forwards`. The keyframes animate the node's `flex-basis` from `var(--nb-tab-ghost-from)` to `0` and its `opacity` from `1` to `0`. The ghost's inline `flex: 0 0 <w>px; width: <w>px` is the box it starts from. | This is the visible close motion, and it starts the instant the node is materialized. Because `flex-basis` shrinks, the flex layout re-packs: the survivors to the ghost's right **slide left** by the shrinking amount. |
| **Self-remove** | On materialization, `materializeGhosts()` arms a per-ghost timer: `setTimeout(function () { removeGhost(g); }, TAB_GHOST_FALLBACK_MS)` (`tabs.js:305`). `removeGhost` (`tabs.js:272-279`) clears the timer, detaches the node, and splices the entry out. | The timer — not an animation event — owns completion. The close duration is `100ms` and the backstop is `280ms`, so the node is always removed after the motion has finished, with margin. |

The survivors' widths are **not** touched by any of this. They stay pinned at
their frozen `flex: 0 0 <w>px; width: <w>px` (`applyFrozenWidths`,
`tabs.js:133-141`), so they never re-size. They only **translate**: a flex item
pinned to a fixed width still flows, so when the ghost before it shrinks, it
moves left. The width freeze therefore survives the ghost collapse untouched.

Re-equalization is deferred: on `mouseleave`, `unfreezeWidths()`
(`tabs.js:223-239`) measures the pinned widths, drops the pins, and then — if a
ghost is still on screen — **returns without playing `nb-tab-equalize`**
(`tabs.js:232-238`), because the ghost's collapse is already the motion. If no
ghost remains, the survivors play the normal release reflow.

Note the create, collapse, and remove are three separate stages. The **create**
pins the width and materializes the node; the **collapse** is pure CSS on that
node and needs no JS; the **remove** is a flat timer, unrelated to the
animation's end.

---

## 3. Code anchors

All in `static/js/tabs.js` unless noted. Line numbers are the current values.

| # | Anchor | Lines | Role |
| --- | --- | --- | --- |
| 1 | `GHOST_CLASS`, `GHOST_FILL_CLASS`, `GHOST_FROM_VAR`, `TAB_GHOST_FALLBACK_MS` | `tabs.js:80-83` | `"ghost"`, `"tab-ghost-fill"`, `"--nb-tab-ghost-from"`, `280` ms. |
| 2 | `ghosts` array | `tabs.js:84` | The ghost data model: `{ path, label, width, index, pinned, startedAt, node, timer }`. |
| 3 | `realTabs()` | `tabs.js:106-108` | `barEl.querySelectorAll(".tab:not(.ghost)")` — **bar-scoped**, so it spans both regions in `ordered` order (pinned first). **The** accessor for width measurement/pinning/release; ghosts are never counted. |
| 4 | `captureFrozenWidths()` / `applyFrozenWidths()` | `tabs.js:125-131` / `133-141` | The freeze pins that keep the survivors at their pre-close widths. Both use `realTabs()`. |
| 5 | `captureCloseReflow(skipPath)` | `tabs.js:151-160` | The pointer-**outside** close capture; self-returns `null` while frozen. |
| 6 | `prefersReducedMotion()` | `tabs.js:164-169` | The reduced-motion gate. |
| 7 | `stopRelease()` / `animateReflow(fromWidths)` | `tabs.js:178-185` / `197-217` | The shared `nb-tab-equalize` release/reflow driver; both put the class on `barEl`. |
| 8 | `unfreezeWidths()` ghost branch | `tabs.js:223-239`, branch at `232-237` | On leave, if a ghost is present, release the pins and skip the reflow. |
| 9 | `addGhost(path, idx)` | `tabs.js:245-255` | Create step: measure the closing node (bar-scoped query), record its `pinned` region, push the data entry. |
| 10 | `nowMs()` | `tabs.js:257-259` | `performance.now()` or `Date.now()`, for `startedAt`. |
| 11 | `removeGhost(g)` | `tabs.js:272-279` | Self-remove step: clear the timer, detach the node, splice the entry. Idempotent. |
| 12 | `materializeGhosts()` | `tabs.js:288-315` | Materialize step: rebuild one node per entry into its own region at its recorded slot (region-guarded anchor, `309-311`); resume via negative `animation-delay`; arm the per-ghost timer. |
| 13 | `finishGhosts()` | `tabs.js:319-321` | Drop every entry + node; called by `clearAll`. |
| 14 | `render()` → `materializeGhosts()` | `tabs.js:323-396`, call at `394-395` | Every strip rebuild clears both regions (`325-326`), re-appends each real tab by region (`388`), re-materializes the ghosts; `stopRelease()` first (`324`). |
| 15 | `dropTab(path)` | `tabs.js:407-419` | Drops the path from `ordered` / `openSet` / `pinned` / `frozenWidths` and the viewer. |
| 16 | `close()` | `tabs.js:493-547` | `ghostClose` at `529`, `reflow` at `530`, `addGhost` at `531`, `dropTab` at `532`, active branch `534-541`, else branch `542-546`. |
| 17 | `animationend` listener (on `barEl`) | `tabs.js:667-669` | Ends the **release** only (`RELEASE_ANIM`); ignores ghost animations. |
| 18 | `mouseenter` / `mouseleave` | `tabs.js:677-686` / `687` | Freeze on enter; `unfreezeWidths` on leave. |
| 19 | `NB.tabs.isGhosting()` / `ghostCount()` | `tabs.js:699-700`, exported `855-856` | Test hooks. |
| 20 | `clearAll()` → `finishGhosts()` | `tabs.js:719-733`, call at `729` | No stale slot survives an auth lock or a full clear. |

Ghost CSS in `static/css/style.css`:

| Anchor | Lines | Role |
| --- | --- | --- |
| `--tab-close-duration` / `--tab-close-ease` | `style.css:410-411` | `100ms` / `ease-out`, declared on `.tab-bar`. |
| `.tab.ghost` | `style.css:1071-1080` | The inert collapsing box: `pointer-events: none`, rails neutralized, `padding`/`border`/`background` removed, `overflow: hidden`, the `nb-tab-ghost-close` animation `forwards`. |
| `.tab-ghost-fill` | `style.css:1081-1094` | The inner span that carries the label and the visible tab chrome so the outer box can reach `0`. |
| `@keyframes nb-tab-ghost-close` | `style.css:1095-1098` | `from { flex-basis: var(--nb-tab-ghost-from); opacity: 1 }` → `to { flex-basis: 0; opacity: 0 }`. |
| Equalizing override | `style.css:1100` | `.tab-bar.nb-tab-equalizing .tab.ghost { animation: none; }` — the release keyframes never drive the placeholder. |
| Reduced-motion guard | `style.css:1103-1105` | `.tab.ghost { animation: none; opacity: 0; }` — no collapse, no fade. |

Release tokens (`--tab-release-duration` / `--tab-release-ease`, `180ms` /
`ease-out`) are at `style.css:406-407`; the `nb-tab-equalize` keyframes at
`style.css:1051-1057`.

### `materializeGhosts()` in full (shipped)

```js
function materializeGhosts() {
  if (!ghosts.length) return;
  const now = nowMs();
  const realNodes = realTabs();
  ghosts.forEach(g => {
    const node = document.createElement("div");
    node.className = "tab " + GHOST_CLASS;
    node.style.flex = "0 0 " + g.width + "px";
    node.style.width = g.width + "px";
    node.style.setProperty(GHOST_FROM_VAR, g.width + "px");
    const fill = document.createElement("span");
    fill.className = GHOST_FILL_CLASS;
    fill.textContent = g.label;
    node.appendChild(fill);
    if (!g.startedAt) g.startedAt = now;
    const elapsed = now - g.startedAt;
    if (elapsed > 0) node.style.animationDelay = "-" + elapsed + "ms";
    if (!g.timer) g.timer = setTimeout(function () { removeGhost(g); }, TAB_GHOST_FALLBACK_MS);
    // Insert into the ghost's own region. The recorded ordered-index anchor
    // must be a child of that region; when it is not (a segment boundary, or
    // a reorder since the close), fall back to the region's end.
    const region = g.pinned ? pinEl : listEl;
    let anchor = realNodes[g.index] || null;
    if (anchor && anchor.parentElement !== region) anchor = null;
    region.insertBefore(node, anchor);
    g.node = node;
  });
}
```

### `close()` (the ghost-relevant lines)

```js
const idx = ordered.indexOf(path);
const wasActive = (activePath === path);
// A ghost close (pointer inside the bar, motion allowed) skips the
// reflow: the ghost holds the slot, so there is nothing to slide yet.
const ghostClose = frozenWidths !== null && !prefersReducedMotion();
const reflow = (wasActive || ghostClose) ? null : captureCloseReflow(path);
if (ghostClose) addGhost(path, idx);   // measure the node before dropTab
dropTab(path);

if (wasActive) {
  const next = pickNeighbor(idx);
  activePath = null;
  // The ghost is DATA, so it survives the activate(next) render below.
  render();            // immediately drop the closed tab + clear active
  emitChanged();
  if (next) { activate(next); }   // async: load + re-render neighbor
  else { NB.viewer.clear(); }
} else {
  render();
  if (!ghostClose) animateReflow(reflow);
  emitChanged();
}
```

Everything else in `close()` is unchanged: `opts.force`, the hybrid dirty check
plus `NB.hybrid.exit(false)`, the dirty `confirm`, `wasActive` /
`pickNeighbor` / `activate(next)` / `NB.viewer.clear()`, and `emitChanged`.

### `unfreezeWidths()` (shipped)

```js
function unfreezeWidths() {
  if (!frozenWidths) return;
  const from = new Map();
  realTabs().forEach(tab => {
    const w = tab.getBoundingClientRect().width;
    if (w > 0) from.set(tab.dataset.path, w);
  });
  frozenWidths = null;
  clearPins(realTabs());
  if (ghosts.length) {
    // Ghost slots are collapsing on their own (they free their space as they
    // shrink), so the survivors are already sliding into place. Nothing to
    // re-equalize here.
    return;
  }
  animateReflow(from.size ? from : null);
}
```

---

## 4. The ghost data model

`ghosts` is a module-level array of entries:

```js
{ path, label, width, index, startedAt, node, timer }
```

| Field | Meaning |
| --- | --- |
| `path` | The closed path. Records identity; ghost nodes carry no `data-path`, so `realTabs()` and the freeze never see them. |
| `label` | The text for the ghost's inner `.tab-ghost-fill` span (special-tab label, or `baseName(path)`). |
| `width` | The pixel width measured from the closing node **before** `dropTab`. Held inline as `flex: 0 0 <w>px; width: <w>px` and fed to the keyframes as `--nb-tab-ghost-from`. |
| `index` | The slot among the real tabs (`ordered.indexOf(path)` captured before removal). `materializeGhosts()` resolves it against `realTabs()` (bar order, pinned first) but only uses the anchor when it is a child of the ghost's region. |
| `pinned` | The region the closed tab came from, read with `pinned.has(path)` **before** `dropTab` deletes it (`tabs.js:253-254`). `materializeGhosts()` picks `pinEl` when true, `listEl` otherwise (`tabs.js:309`). |
| `startedAt` | `0` at capture; set to `nowMs()` on the first materialization. `materializeGhosts()` computes `elapsed = now - startedAt` and sets a negative `animation-delay` so a rebuilt node resumes mid-collapse instead of restarting. |
| `node` | The current DOM node, rebuilt on every `render()`. |
| `timer` | The per-ghost `setTimeout` handle that calls `removeGhost` after `TAB_GHOST_FALLBACK_MS`; `null` until materialized. |

**Why it survives `render()`.** `render()` clears both regions
(`pinEl.innerHTML = ""` / `listEl.innerHTML = ""`, `tabs.js:325-326`), which
destroys a ghost node along with the real tabs. But the ghost is **data** in
the module-level `ghosts` array, and `render()` never clears that array; it ends
by calling `materializeGhosts()` (`tabs.js:394`), which re-creates a fresh node
for each entry in its recorded region at its recorded `index`, with its
`width` pinned, its `--nb-tab-ghost-from` set, and its elapsed time applied as a
negative `animation-delay`. So any render that lands during the ghost's life (an
`activate(next)` after an active-tab close, an open, a reorder, a conflict
badge) rebuilds the ghost in place rather than losing it. A raw node reference
would not survive the rebuild; the entry's `node` field is just a cache of the
latest materialization.

**How the active-tab close works.** Closing the active tab calls `render()`
immediately and then `activate(next)`, which lands a **second** render after the
neighbor loads. The ghost entry survives both because it is data. The second
render rebuilds the node, but `startedAt` is already set, so `elapsed` is the
time since the tab was closed and the node is given
`animation-delay: -<elapsed>ms`. The collapse therefore **continues from where
it was** rather than restarting; the content pane swaps to the neighbor over the
tail of the collapse. Without `startedAt` the rebuild would snap the ghost back
to full opacity and replay the whole 100 ms, which is the flicker this field
exists to avoid.

**`realTabs()` is the single accessor.** Every width measurement, pin, release,
and stop path iterates `realTabs()` (`tabs.js:127`, `135`, `154`, `181`, `199`,
`226`, `231`, `291`), never `querySelectorAll(".tab")`. It is **bar-scoped**, so
it returns the tabs of both regions in bar order (pinned first);
`materializeGhosts()` uses the same accessor to resolve a ghost's anchor, then
regions-guards it. A ghost's width is therefore never measured or pinned by the
freeze/release machinery — its collapsing box is invisible to the reflow math.

---

## 5. Gates

### 5.1 Gates the ghost close keeps

| Gate | Condition | Behaviour | Reason |
| --- | --- | --- | --- |
| **Pointer inside the bar (frozen)** | `frozenWidths !== null` | Ghost created | This is the only case the ghost exists for; a close with the pointer outside keeps the `captureCloseReflow` → `animateReflow` path. |
| **Reduced motion off** | `!prefersReducedMotion()` | No ghost; instant close | `ghostClose` is false, so nothing is captured; the frozen close lands instantly with no motion (CSS also forces `animation: none` / `opacity: 0` on a ghost as a second line of defense — `style.css:1103-1105`). |

`close` creates a ghost **only** when both hold: `ghostClose = frozenWidths !==
null && !prefersReducedMotion()` (`tabs.js:529`).

The **non-ghost** (pointer-outside) close path inherits `animateReflow`'s four
gates unchanged: reduced motion, active drag (`draggingPath`), oversized strip
(`> TAB_RELEASE_MAX_TABS` = 24), and sub-epsilon delta (`WIDTH_EPSILON` = 0.5 px).

### 5.2 Gates that do **not** apply to the ghost path

| Gate | Scope |
| --- | --- |
| **Active drag** (`draggingPath`) | Gates `animateReflow` only. `ghostClose` does not check it, and the collapse is a CSS animation on the ghost node, so neither the create nor the collapse consults `draggingPath`. In practice a drag and a frozen close rarely coincide (`onDragStart` prevents a drag from starting on a close button). |
| **`TAB_RELEASE_MAX_TABS`** (24) | Gates `animateReflow` only. An oversized strip still ghosts: `ghostClose` has no tab-count check. |
| **`WIDTH_EPSILON`** | Gates `animateReflow` only. The ghost always animates from its measured width; a sub-pixel delta is irrelevant to it. |

### 5.3 Gates and machinery from earlier designs, now dropped

| Dropped | Why |
| --- | --- |
| **`faded` class / `faded` entry flag** | The fade is part of the collapse keyframes and the node is removed by a timer, so there is no post-fade state to hold. |
| **`leaving` class / `collapseGhosts()` / `releaseGhosts()`** | The ghost collapses on creation, not on pointer leave. There is no second, leave-triggered collapse stage. |
| **`transitionend` listener (`flex-basis`)** | The collapse is a keyframe animation, not a transition, and completion is a flat timer. `animationend` is not used for ghosts either (the listener at `tabs.js:667-669` ends the release only). |
| **Frozen close stays instant; gap closes later on leave** | Dropped. The frozen close now ghosts: the closing tab's box collapses and fades immediately. |
| **Close while frozen must not animate** | Dropped. The old constraint existed to protect the next close button from sliding under the cursor. The ghost removes the danger differently: the survivors keep their frozen widths; only the ghost's own box shrinks, so the next close button is never resized. |

No `TAB_CLOSE_*` constant beyond `--tab-close-duration` / `--tab-close-ease`
(CSS) exists in the shipped code; the ghost family is the only close-specific
state.

---

## 6. Interactions

- **Frozen close.** §2. The ghost is created, collapses and fades at once, and
  removes itself after 280 ms. The survivors keep their inline pins and slide
  left as the ghost's box shrinks.
- **Active-tab close while frozen.** `ghostClose` is true regardless of
  `wasActive`, so `addGhost` runs, `reflow` is `null`, and the ghost data
  survives both the immediate `render()` (`tabs.js:538`) and the later
  `activate(next)` render (`tabs.js:540`). `startedAt` + the negative
  `animation-delay` make the rebuilt node resume mid-collapse instead of
  restarting, so the content pane swaps to the neighbour over the tail of the
  close. The tab is still removed immediately; only the placeholder lingers.
- **Close during a release.** Freeze and release are mutually exclusive:
  `mouseenter` cancels a release (`stopRelease()`, `tabs.js:684`) and freezes, and
  `mouseleave` releases. A ghost close therefore cannot coexist with an
  in-flight `nb-tab-equalize`. A close with the pointer **outside** while a
  release is mid-flight takes the non-ghost path; `render()` stops the release
  first and a fresh settle begins from the captured mid-animation widths.
- **Close during a drag.** No ghost-specific gate (§5.2). If the strip is frozen
  and a close is triggered mid-drag, a ghost is still created, collapses, and is
  removed by its timer.
- **`clearAll()` / `auth:locked`.** `clearAll()` drops every tab via `dropTab`
  (bypassing `close()`, so no new ghost) and calls `finishGhosts()` at
  `tabs.js:729` to remove any ghost entry + node in flight, clearing its timer,
  then renders. No stale slot survives a lock or a full clear.
- **Overflow / scrolling strip.** No ghost cap. The ghost holds its inline width
  at the recorded slot; if the strip overflows, the ghost occupies its slot like
  a normal tab and its collapse lets the flex layout re-pack (which may scroll).
  The `>24` cap affects only the survivor reflow. A **pinned** ghost always
  occupies a slot in the fixed `#tab-pinned` region, which never scrolls.
- **Pointer leave, then re-enter.** `mouseleave` releases the freeze
  (`unfreezeWidths`, `tabs.js:223-239`). If a ghost node is still on screen,
  `unfreezeWidths` releases the pins and returns without a reflow (`232-237`);
  the ghost is already mid-collapse (or done). `mouseenter` then re-freezes at
  the survivors' current widths. If the ghost has already self-removed,
  `unfreezeWidths` plays the normal survivor reflow. Because the collapse and
  the 280 ms removal are independent of the freeze, a leave/re-enter cannot
  restart or cancel the collapse.
- **Multiple ghosts at once.** Closing two tabs while frozen pushes two entries;
  `materializeGhosts()` inserts each into its own region at its recorded slot.
  Each has its own timer, so each removes itself independently; the collapses
  overlap. No unbounded accumulation — every entry carries a timer that splices
  it out.
- **A render mid-collapse.** `render()` destroys the ghost node and
  `materializeGhosts()` rebuilds it. `startedAt` + the negative `animation-delay`
  resume the collapse from the elapsed point, so a render in the middle of the
  100 ms close does not replay it. This is the mechanism that makes the
  active-tab close (which always lands a second render) work.

---

## 7. Edge cases

| Case | Behaviour |
| --- | --- |
| Close the only tab while frozen | It is active, so `addGhost` runs before `dropTab`; `pickNeighbor` finds nothing, `NB.viewer.clear()` runs. `materializeGhosts()` inserts the ghost at index 0 of an empty real set (the end), so it collapses and fades there and self-removes after 280 ms. |
| Close a non-active tab while frozen with one survivor | The ghost collapses and fades; the survivor keeps its frozen width and slides left as the ghost's basis shrinks, then re-equalizes on the next leave. |
| Active-tab close while frozen | The ghost survives the `activate(next)` render; `startedAt` resumes the collapse instead of restarting it. |
| Ghost entry whose node was rebuilt | `materializeGhosts()` always assigns the fresh node to `g.node`; `removeGhost` clears `g.timer` and detaches whatever `g.node` currently is, so a rebuild mid-collapse is cleaned up correctly. |
| Close with the pointer outside the bar | No ghost. `captureCloseReflow` → `render()` → `animateReflow` runs, as before. |
| Reduced motion | No ghost; instant close, no collapse, no fade (§5.1). |
| Ghost measured at width 0 (hidden, jsdom) | `addGhost` records `width = 0`; the node is `flex: 0 0 0px; width: 0px`, so the keyframes animate `flex-basis` from `0` to `0` and only the opacity is visible. The node still self-removes on its timer. |
| A stale cached `index.html` (no `#tab-list`/`#tab-pinned`) | `listEl` falls back to `barEl` and `pinEl` falls back to `listEl` (`tabs.js:23-24`); ghosts render into the bar/scroller, and `realTabs()` still excludes them. |
| A ghost for a **pinned** tab | `addGhost` records `pinned: true` (`tabs.js:253-254`) and `materializeGhosts()` inserts into `#tab-pinned` (`tabs.js:309`), so the placeholder occupies the pinned region and never scrolls with the strip. (A pinned tab has no close button, so this path is reached via the context-menu **Close**, not a `×`.) |
| Anchor path not in the ghost's region (segment boundary / reorder since close) | `materializeGhosts()` nulls the anchor when `anchor.parentElement !== region` and inserts at the region's end (`tabs.js:310-311`), so a cross-region anchor never throws. |
| `clearAll()` / `auth:locked` with a ghost in flight | `finishGhosts()` removes every entry + node and clears each timer. |
| Fast repeated frozen closes | Each pushes an entry with its own timer; each self-removes independently. The array is emptied by the timers or by `clearAll`. |
| Cancelled close (dirty `confirm` → Cancel) | `close()` returns before `ghostClose` / `addGhost`; nothing is armed, no ghost, the tab set is untouched. |
| Ghost with a special-tab label | `addGhost` uses the special tab's `label` (or the path) for the ghost's `.tab-ghost-fill`; the ghost is inert and has no handlers. |
| Timer fires after the ghost entry was already spliced | `removeGhost` is idempotent: it clears / null-checks its own timer, no-ops on a missing node, and is a no-op when the entry is already gone from the array. |

---

## 8. Test coverage

### 8.1 Official DOM suite (`tests/dom/test_dom.js`)

The `== tab close ghost ==` block runs from `test_dom.js:3665-3841`. It stubs
`Element.prototype.getBoundingClientRect` to return a fixed width per tab path
(`notes/a.md` `140`, `Welcome.md` `160`, `notes/b.md` `180`), opens three tabs
with `notes/a.md` active, and drives the freeze with a dispatched `mouseenter` on
`#tab-bar`. jsdom has no layout engine, no `AnimationEvent` / `TransitionEvent`,
and no interpolation, so the block asserts class, inline style, entry count, and
DOM position — never that anything actually animates.

What the block asserts, in order:

- **Setup** — three tabs, `notes/a.md` active.
- **Freeze + create** — after `mouseenter`, `isWidthFrozen()` is true. Closing
  the non-active `Welcome.md`:
  - `isGhosting()` is true and `ghostCount() === 1`;
  - a `.tab.ghost` node exists inside `#tab-list` and has the `ghost` class
    (`test_dom.js:3699`);
  - the ghost holds `"Welcome.md"` in an inner `.tab-ghost-fill` span (and the
    ghost's whole `textContent` is that label);
  - the closed path is absent from the real tabs, which number 2;
  - the ghost is not counted among the real tabs
    (`realTabs().length === allTabs().length - 1`).
- **Slot + width** — the ghost's inline `style.width === "160px"` and
  `style.flex === "0 0 160px"`; it carries
  `--nb-tab-ghost-from: 160px`; it sits at `#tab-list.children[1]` (the closed
  tab's slot, `test_dom.js:3722`); the frozen close runs **no** release
  (`!isReleasing()`, no `nb-tab-equalizing` class); and the survivor `notes/b.md`
  keeps its freeze pins (`180px`).
- **Data survives `render()`** — calling `NB.tabs.render()` keeps the entry
  (`ghostCount() === 1`), materializes a **different** node at the same slot
  (`children[1]`), and the rebuilt node still holds `160px`.
- **No leave teardown** — dispatching `mouseleave` releases the freeze
  (`!isWidthFrozen()`) but **does not** remove the ghost
  (`ghostCount() === 1`, node still present) and runs no release reflow. This is
  the explicit assertion that the timer, not `mouseleave`, owns removal.
- **Self-removal** — after `tick(320)` (past the `280ms` backstop),
  `ghostCount() === 0`, `!isGhosting()`, and no `.tab.ghost` node remains.
- **Reduced motion** — with `matchMedia` stubbed to match
  `prefers-reduced-motion`, a frozen close creates no ghost
  (`ghostCount() === 0`).
- **Pointer outside** — with the freeze released, a close creates no ghost.
- **`clearAll()`** — a ghost is armed (`ghostCount() === 1`) and `clearAll()`
  removes it.
- **Structural CSS contract** — reads `static/css/style.css` as text and pins:
  `.tab-bar` declares `--tab-close-duration: 100ms` and
  `--tab-close-ease: ease-out`; `.tab.ghost` is inert (`pointer-events: none`)
  and runs `nb-tab-ghost-close var(--tab-close-duration) var(--tab-close-ease)
  forwards`; `@keyframes nb-tab-ghost-close` exists; its `from` is
  `flex-basis: var(--nb-tab-ghost-from)` + `opacity: 1`; its `to` is
  `flex-basis: 0` + `opacity: 0`; and the reduced-motion block disables the
  ghost animation.
- **Cleanup** — restores the prototype rect stub and returns to one tab on
  `notes/a.md`.

The `== tab pin + region ==` (`test_dom.js:11289-11398`) and
`== tab pinned region ==` (`test_dom.js:11495-11700`) blocks cover the
pinned region itself: a pinned tab renders in `#tab-pinned`, an unpinned tab
stays in `#tab-list`, the region is shown while something is pinned, and the
`.tab-pinned { flex: 0 0 auto; max-width: none }` / capped-and-scrolling CSS
contract is pinned. The ghost-into-`#tab-pinned` path is
exercised by the region guard in `materializeGhosts()` but is not directly
asserted (see §9).

Related blocks: the existing `== tab close reflow ==` block
(`test_dom.js:3420-3653`) covers the pointer-**outside** path
(`captureCloseReflow` → `animateReflow`), including the active-close-stays-instant
case; the `== file tabs ==` freeze block (from `test_dom.js:3208`) covers the
freeze pins and waits for a ghost's backstop to retire before the release block
(`3240-3243`). The shared `tabs()` helper excludes ghosts
(`test_dom.js:3144`), mirroring `realTabs()`.

**What the block does not cover:** the active-tab ghost is not directly asserted
(no test closes the active tab while frozen and checks the ghost survives the
`activate(next)` render), and the negative `animation-delay` resume is not
asserted (jsdom cannot see the animation). See §9.

### 8.2 Real-browser evidence (Firefox via Marionette)

The behavior was verified in a **real Firefox 155** (headless) driven over
Marionette against a throwaway server. Four tabs were open, each `202px` wide,
the pointer was inside the bar, and a **non-active** tab's close button was
clicked. Measured during and after the close:

| Moment | Measurement |
| --- | --- |
| Ghost width across the close | `202 → 65 → 34 → 0` px |
| Ghost opacity across the close | `1 → 0` |
| Survivor widths | held at `202px` (no resize) |
| Survivor lefts | `498, 701, 905` → `498, 701` for the remaining two after settling (they slid left as the ghost shrank) |
| Ghost gone | by ~`120ms` (within the `280ms` backstop) |
| End state | 3 real tabs, `isGhosting()` false |

This confirms the **immediate collapse in a real browser**: the ghost's box
shrinks and fades over the `100ms` close while the survivors keep their widths
and slide left to fill the freed space — the motion plays the moment the tab is
closed, not on pointer leave.

---

## 9. What could not be verified

- **jsdom cannot interpolation-test.** The DOM suite can assert class, inline
  style, entry count, and DOM position, never that a width or opacity actually
  animates. The real-browser run (§8.2) is the interpolation evidence. jsdom has
  no layout, so the ghost's `flex-basis` collapse and the survivors' slide are
  invisible to it.
- **The active-tab path in a real browser.** The active-tab ghost (the rebuilt
  node resuming via `startedAt` + negative `animation-delay`) is correct by
  construction and is what makes the second `render()` in `activate(next)` safe,
  but it was not driven in a real browser and is not asserted by the DOM block.
- **The `startedAt` resume specifically.** No test observes the negative
  `animation-delay`; it is reasoned from the code.
- **Reduced motion in a real browser.** The JS gate and the CSS fallback are both
  in place and the DOM block asserts no ghost is created, but the reduced-motion
  close was not run as a real-browser case.
- **Multiple simultaneous ghosts and re-entry during a collapse.** The data
  model supports both and each ghost owns its timer, but neither was measured in
  a browser.
- **A pinned tab's ghost in a real browser.** `pinned` is recorded in the entry
  and `materializeGhosts()` inserts into `#tab-pinned`; the DOM suite does not
  close a pinned tab while frozen, so the pinned-region insert is reasoned from
  the code (the region guard at `tabs.js:310-311` is the same path the unpinned
  case exercises). The pinned region's own fixed behavior was measured in a
  browser — see [`tab-equalization.md`](tab-equalization.md) §11.1.
- **The exact `100ms` feel.** The ghost width / opacity sequence in §8.2 was
  sampled once; the duration was matched to Firefox's `100ms` and to the
  observed collapse, not tuned against a stopwatch. Adjust
  `--tab-close-duration` if it reads fast or slow; nothing else depends on the
  value.

---

## 10. Firefox source citations

The motion values are Firefox's; this app reuses the *perception* of them, not
their node lifecycle.

| Motion value / rule | Source | Symbol |
| --- | --- | --- |
| `min-width` / `max-width` transition, `100ms`, `ease-out` | `browser/themes/shared/tabbrowser/tabs.css` | `--tab-width-transition: min-width 100ms ease-out, max-width 100ms ease-out;` |
| Collapse endpoint `0.1px`, contents hidden at `t=0` | `browser/themes/shared/tabbrowser/tabs.css` | `&:not([fadein]) { max-width: 0.1px; min-width: 0.1px; visibility: hidden; }` |
| `.closing-tabs-spacer` | `browser/themes/shared/tabbrowser/tabs.css` | The spacer that reserves the closing tabs' space while they collapse. |
| Close driver (`removeTab`), the mouse width-lock | `browser/components/tabbrowser/Tabbrowser.sys.mjs` | `removeTab()`; the mouse-initiated path locks the remaining tabs' widths so they do not re-equalize. |

**Honest note on the mapping.** Firefox animates the **live closing node's**
`min-width` / `max-width` (and hides its contents at `t=0`, so the collapse is
never painted), and for a mouse-initiated close it additionally locks the
remaining tabs' widths. This app's approach **differs** in mechanism:

- It animates the `flex-basis` (and `opacity`) of an inert **ghost copy**
  inserted at the closed tab's slot, not the `max-width` of the live node. The
  ghost is a real, painted box (it fades out rather than hiding at `t=0`), so the
  close **is** visible where Firefox's closing node would be unpainted.
- It holds the survivors' widths via the **freeze** (`frozenWidths` →
  inline `flex: 0 0 <w>px`), the app's equivalent of Firefox's mouse width-lock,
  rather than Firefox's own inline width-lock during `removeTab`.

Same perceived motion — the closing tab's box shrinks away over `100ms
ease-out` while the neighbours hold their size — different mechanism.

---

## 11. Design history

Two earlier approaches were tried and rejected before the shipped design.

### 11.1 Rejected: the lingering `.closing` node

**What was proposed:** mark the closing tab with a `.closing` class, keep its
node alive across `render()` via a "surgical" strip update that removed stale
nodes but spared the closing one, and collapse its own `min-width` /
`max-width` over `100ms` — a direct transcription of Firefox's node collapse.

**Why it failed:**

- It **dropped existing `close()` behaviour**: the rewrite lost `opts.force`,
  the hybrid `NB.hybrid.exit(false)` path, the dirty `confirm`, and the
  `wasActive` / `pickNeighbor` / `activate(next)` neighbour-switch logic.
- It **contradicted the active-tab render**: `activate(next)` lands a second
  `render()`, which would tear down the still-collapsing node the design was
  built to preserve.

### 11.2 Rejected: the fade-in-place ghost that held the gap until `mouseleave`

**What was proposed:** replace the closed tab with a same-width ghost that
**faded in place only** — its box stayed at full width holding the slot — and
collapse the box later, on `mouseleave`, so the survivors slid left only once
the pointer left the bar.

**Why it failed:** the user rejected it — **the animation did not play on
close**. The user's requirement (matching Firefox) is that the close is visible
**immediately**, the moment the tab is closed. Holding the gap and deferring the
collapse to pointer leave made the close look like a no-op until the pointer
left the bar.

### 11.3 Shipped: collapse immediately, let the ghost free its own space

The shipped design collapses the ghost's `flex-basis` to `0` and fades it **on
creation**, from the `nb-tab-ghost-close` keyframes, and removes the node on a
flat timer. The survivors keep their frozen widths — so nothing resizes under
the cursor — while sliding left as the ghost's box gives up the space. This
satisfies the Firefox-like immediate close and keeps the freeze's original
promise (the next close button never moves mid-session).
