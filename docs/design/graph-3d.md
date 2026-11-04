# Graph 3D — design handoff

A 3D evolution of the notebook's wikilink graph. This document is the
implementation contract; the interactive reference is
[`docs/design/graph-3d.html`](graph-3d.html).

- **Surface:** the `§graph` special tab (its `.graph-*` block in
  `templates/index.html`, `static/js/graph.js`, and the graph rules in
  `static/css/style.css`).
- **Status:** shipped (3D graph). 2D and 3D are both available; default is 3D.
  This document is the design record.
- **Read-only view:** it fetches `GET /api/graph` and writes nothing.
- **Mockup size:** 45 notes, 75 links. The count is computed from the mockup
  data, not typed into the summary.

---

## 1. Decision summary

| Decision | Choice |
| --- | --- |
| Camera | Perspective orbit camera: yaw, pitch, distance, pan-able target. 50° vertical FOV. |
| Projection | Hand-rolled 2D canvas projection + painter's algorithm. No WebGL, no dependency, no build step. |
| Depth cue order | Perspective size → fog/alpha → painter order → edge alpha/width → glow falloff → label attenuation. No depth-by-hue. |
| Primary drag | Orbit (was pan in 2D). |
| Pan | Right-drag, middle-drag, or Shift+left-drag. |
| Zoom | Wheel/pinch dolly with 35% cursor bias; buttons dolly to centre. |
| Node drag | Pin on a camera-facing plane through the node; release unpins and re-settles physics. |
| Labels | Screen-space billboards, collision-placed, capped; focus labels get a pill, others get a background halo. No leader lines. |
| New controls | Auto-orbit, depth spread. Re-center becomes reset-camera-and-fit. |
| Phone | Not a 3D surface. Keep the graph unreachable on phones; if needed later, ship the existing 2D view in a full-screen sheet. |
| Fallback / mode | The header switches between the restored 2D renderer and 3D (default). Depth spread 0% is the 3D flat mode. |
| Theme | Reads only the existing `--graph-*` tokens. No new colours. The mockup opens in the system theme; the demo strip overrides it. |

### 1.1 Accepted implementation decisions

The mode choice replaced the original "3D only" decision, so the open
questions in §16 are resolved as follows:

| Question | Decision |
| --- | --- |
| Replacement or mode | A persisted 2D/3D switch, default 3D. Depth spread 0% remains the 3D flat mode. |
| Auto-orbit default | Off. |
| Phone | Desktop/tablet only. The existing phone query keeps `#activity-graph-btn` hidden; a 2D sheet would be a separate follow-up. |
| Labels | Basenames (`node.name`), falling back to the shortest unique path suffix on collision. |
| Node drag | Camera-facing plane drag; release unpins and the physics re-settles. No permanent pin state. |
| Camera persistence | Survives a tab switch; resets on reload. Not stored in `config.json`. |
| Large notebooks | Above 1500 nodes render a flat layout with a notice rather than refusing to render. |
| Active file | Thin amber ring (no fill), kept distinct from the selection heat-map. |

Implementation deviations from the first draft of this spec:

- The renderers are split: `graph-2d.js` (`NB.graph2d`), `graph-3d.js`
  (`NB.graph3d`), and `graph.js` as the tab/header/mode facade. Only one
  renderer is active at a time.
- The auto-orbit control ships as `#graph-view-rotate`; reset/fit is
  `#graph-view-fit`.
- The fetch uses a 10s `Promise.race` timeout because `NB.api.getGraph()`
  exposes no `AbortSignal`. There is no true abort.
- Fit and focus tweens are suppressed while auto-orbit is on, honouring the
  "no camera easing while auto-orbiting" rule.

---

## 2. Design intent

**Same brain, with depth you can trust.**

The 2D graph already has a strong identity: a dark field, blue synapse nodes,
amber focus, thin directed-looking links, and a quiet ambient glow. The 3D
version must feel like that view gained a third axis, not like a different
product.

Three rules drive every decision:

1. **Depth is geometry, not colour.** Perspective size, atmospheric fade,
   draw order, and edge weight carry depth. The palette never changes for
   depth, so a far node is still the same kind of object as a near one.
2. **Focus survives every angle.** Hovering or selecting must make the node
   and its neighbourhood legible even when the camera is above, below, or
   behind the cluster. Labels are screen-space, never rotated into the scene.
3. **Restraint.** No floor grid, no rainbow clusters, no cinematic camera
   moves, no permanent arrowheads. The graph is an instrument, not an
   attraction.

Non-goals: VR, WebGL-only rendering, GPU physics, 3D text in world space,
per-cluster colours, animated fly-throughs, and a separate graph page.

---

## 3. Where it lives

The view remains one special tab, `§graph`, inside `#edit-split`. It replaces
the body of `#graph-view`; the header and canvas host keep their names so the
tab lifecycle and tests continue to work.

- Data is unchanged: `{ nodes: [{id, name, links}], edges: [{source, target}] }`.
  The server's edges are deduplicated undirected pairs; source→target order is
  only used for pulse direction.
- Two renderers share the one `§graph` tab through `graph.js`: the 2D
  neural view and the 3D view. The mode is persisted as `graphMode` and
  defaults to `3d`.
- The graph remains a "special tab": it opens from the activity-bar graph
  button, restores from `openFiles`, and never edits a note.
- No new server routes. The mode is a new `graphMode` key in
  `config/config.json` (`"2d"`/`"3d"`, default `"3d"`); the server stores the
  config blob verbatim.

---

## 4. Tokens

All canvas colours come from the existing RGB-triple tokens. The HTML chrome
uses the app's surface tokens. Nothing in this design introduces a new hue.

### 4.1 App / panel tokens used by the chrome

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--bg` | `#1a1b1f` | `#ffffff` | control fills |
| `--bg-panel` | `#22232a` | `#f6f7f9` | header, pills, demo strip |
| `--bg-elev` | `#2a2b34` | `#eceef2` | switch track |
| `--fg` | `#e6e6ea` | `#1f2330` | title, button icons |
| `--fg-muted` | `#8b8d98` | `#5d6470` | summary, hints, meta |
| `--accent` | `#7c9cff` | `#2f5fd0` | focus, active toggle, hairline |
| `--accent-soft` | `rgba(124,156,255,.18)` | `rgba(47,95,208,.12)` | hover / pressed fills |
| `--border` | `#383a45` | `#d8dde4` | 1px chrome borders |
| `--danger` | `#ff6b6b` | `#c0392b` | error icon only |
| `--accent-fg` | `#14151a` | `#ffffff` | text on the accent action button |

### 4.2 Graph tokens (unchanged from the 2D view)

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--graph-node-rgb` | `130 168 255` | `60 110 230` | default node |
| `--graph-node-hover-rgb` | `150 220 255` | `25 145 230` | hovered node |
| `--graph-edge-rgb` | `124 156 255` | `80 130 230` | base edge |
| `--graph-glow-rgb` | `150 220 255` | `25 145 230` | hover ring / glow |
| `--graph-warn-rgb` | `243 180 84` | `201 131 29` | selection, active file |
| `--graph-dim-rgb` | `80 92 120` | `150 162 184` | dimmed nodes, labels, edges |
| `--graph-label-rgb` | `230 234 245` | `31 35 48` | label text |
| `--graph-pulse-rgb` | `180 230 255` | `40 165 240` | signal pulse |
| `--graph-particle-rgb` | `130 168 255` | `60 110 230` | optional particle field |
| `--graph-vignette-inner-rgb` | `60 90 180` | `200 215 245` | ambient centre glow |
| `--graph-vignette-edge-rgb` | `14 16 24` | `244 246 251` | vignette edge |
| `--graph-bg` | `#0e1018` | `#f4f6fb` | canvas background |

### 4.3 Derived values (not tokens)

These are computed from the tokens above at draw time:

| Derivation | Formula | Why |
| --- | --- | --- |
| Hop-1 node | `mix(node, warn, 0.82)` | amber heat without a new hue |
| Hop-2 node | `mix(node, warn, 0.44)` | |
| Hop-3+ node | `mix(node, dim, 0.52)` | |
| Hop-1 edge | `mix(edge, warn, 0.34)` | |
| Hover neighbour | `mix(node, hover, 0.44)` | |
| Disconnected in selection | `mix(node, dim, 0.48)` | recede, do not vanish |
| `warnInk` (light only) | `mix(warn, label, 0.30)` | 1px amber rings reach 4.6:1 on the light canvas; plain `warn` is 2.88:1 |
| Label halo | background at 86–90% | readability over edges without a card |
| Fog | `fog = (depth − min)/(max − min)` | per frame, from projected depths |
| Fog alpha | `1 − 0.5 × fog^1.25` | far nodes at 50% |
| Edge alpha (idle) | `0.44 × (1 − 0.5·fogA) × (1 − 0.3·meanFog)` | far edges recede twice: once per endpoint depth, once on the mean |
| Glow alpha | `0.50 − 0.26 × fog` (selected 0.85, hover 0.72) | no blur pass |
| Screen radius | `clamp(worldR × focal/depth, 2.4, 28)` | perspective + legibility floor |

**No one-off colours.** If a future state needs a colour, derive it from the
tokens above and add it to this table; do not add a new hex value.

### 4.4 Spacing, type, radii

| Item | Value |
| --- | --- |
| Base font | 14px (`html`); canvas labels 12px |
| UI stack | `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` |
| Header padding | `8px 14px`, min-height 47px |
| Control height | 30px desktop; 44px on coarse pointers ≥1024px |
| Control radius | 8px |
| Filter width | 160px (190px coarse) |
| Depth control | 30px high; 58px track; 30px percentage output |
| Button | 30 × 30px; 15px icon |
| Header gap | 6px between controls; 12px before the toolbar |
| Hint / chip / toast radius | 999px |
| Pill label radius | 5px |
| State card radius | 14px |

---

## 5. Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ ● Graph [3D]  45 notes · 75 links        [filter] [depth] │ ⟳ ⊞ + − ↻ │  header 47px
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│                      ·  ·   ·       ·                                │
│                 ·        ╭──────────────╮                            │
│            ·        ·    │ camera hint  │       ·                    │
│                          ╰──────────────╯                            │
│                                                                      │
│                    3D scene, painter-sorted                          │
│                                                                      │
│                                        ╭─ selected note ──────────╮  │
│                                        │ search-panel  7 links ×  │  │
│                                        ╰──────────────────────────╯  │
│                                                                      │
│  ╭ mockup controls ─────────────╮                                    │
│  │ Dark Light  Reduce motion  State ▾ │                              │
│  ╰──────────────────────────────╯                                    │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.1 Header zones

1. **Identity:** 7px accent dot (2.4s pulse), `Graph` at 0.95rem/650, a `3D`
   badge (9px/700, 0.1em tracking, accent-soft fill, 4px radius).
2. **Summary:** 0.78rem, muted, tabular numerals. Reads
   `45 notes · 75 links`; with a filter, `… · 3 matches`. Loading:
   `Reading links…`; error: `Not connected`; empty: `0 notes · 0 links`.
3. **Filter:** search icon inside the left edge, 160px wide, 30px high.
4. **Depth:** layered-squares icon, range, percentage output. The whole group
   is one bordered control, so the slider does not read as three loose items.
5. **Separator:** 1px × 18px, border colour.
6. **Buttons, left to right:** auto-orbit (`aria-pressed`), reset/fit, zoom in,
   zoom out, refresh. This keeps the existing order and adds only auto-orbit
   before the divider.
7. **Hairline:** 1px gradient under the header, accent at 35%, 30%→70% stops,
   55% opacity, matching `.graph-view-header::after`.

The header is a blurred panel: `bg-panel` at 86%, `blur(8px)`, 1px border at
70%. It must stay translucent so the scene's depth is visible behind it.

### 5.2 Canvas host

Fills the remaining height, `min-height: 0`, `overflow: hidden`. The canvas is
`position: absolute; inset: 0` with a CSS-pixel backing store scaled by DPR
(capped at 2). The host has `touch-action: none`, `user-select: none`, and a
focus-visible inset ring.

### 5.3 Overlays

| Overlay | Position | z | Content |
| --- | --- | --- | --- |
| Camera hint | top 14px, centred | 12 | mouse or touch instructions; fades after first interaction |
| Selection chip | bottom-right 16px | 14 | selected name, degree, hop counts, clear × |
| Toast | bottom-centre 20px | 16 | mockup open affordance; production refresh failure |
| State layer | inset 0 | 18 | loading / empty / error card |
| Mockup strip | fixed, bottom-left 16px | 40 | preview-only controls |

The hint, chip, and toast are inside the canvas host, so they never cover the
header. The mockup strip is outside the app frame and must be removed in
production.

---

## 6. Camera model

### 6.1 State

```
target  vec3   // display-space look-at point
yaw     rad    // default -0.52  (~-30°)
pitch   rad    // default  0.30  (~17°), clamp ±1.22 (~±70°)
dist    number // default from fit, clamp 230..3000
fov     50°    // vertical field of view
```

The camera position is:

```
dir  = (cos(pitch)·sin(yaw), sin(pitch), cos(pitch)·cos(yaw))
pos  = target + dir · dist
fwd  = -dir
right = normalize(fwd × worldUp)
up    = right × fwd
```

Projection (square pixels, focal based on the smaller viewport dimension):

```
focal = (min(width, height) / 2) / tan(fov/2)
cx    = dot(p − pos, right)
cy    = dot(p − pos, up)
cz    = dot(p − pos, fwd)
sx    = width/2  + (cx / cz) · focal
sy    = height/2 − (cy / cz) · focal
depth = cz
```

`cz <= 12` is culled. Node radius:

```
worldR  = 6.2 + min(9.5, sqrt(degree) · 2.2)   // 6.2 .. 15.7 world units
screenR = clamp(worldR · focal / depth, 2.4, 28)
```

Selected nodes draw 14% larger, hovered nodes 10%.

### 6.2 Reset-to-fit

1. Compute the centroid of the displayed positions (`z × depthScale`).
2. `R = max(distance from centroid)`, minimum 60.
3. `dist = clamp(R / sin(fov/2) × 1.12, 260, 2800)`.
4. Target = centroid; yaw = -0.52; pitch = 0.30.
5. Tween 440ms with ease-out-cubic; instant under reduced motion.

The user's pan and zoom are preserved across a tab switch. Reset is an explicit
action. A resize recomputes `focal` but does not re-fit; the graph does not jump
while a panel is dragged.

### 6.3 Input mapping

| Input | Action |
| --- | --- |
| Left-drag on empty space | Orbit. `yaw -= dx · 0.005`; `pitch += dy · 0.004`; clamp pitch. |
| Left-drag on a node | Pin the node on a camera-facing plane through it. Cursor maps to that plane; release unpins and wakes physics. |
| Right-drag | Pan in the camera plane. |
| Middle-drag | Pan. |
| Shift + left-drag | Pan (trackpad-friendly alternative). |
| Wheel | Dolly: `dist *= exp(deltaY · 0.0012)` (≈1.13 per 100), clamp 230–3000, with a 35% cursor bias. |
| Pinch | Distance ratio → dolly; two-finger drag → pan. |
| Single click (no drag >4px) on a node | Select: BFS hop heat-map + breathing ring. |
| Single click on empty space | Clear selection. |
| Double-click / double-tap on a node | Open the note as a file tab. |
| Drag threshold | 4px total movement; a drag suppresses click and double-click. |
| Double-tap threshold | 320ms, 26px, same node. |

**Why orbit replaces left-drag pan.** In a 3D scene the primary drag must
control the camera's most informative axis. Pan is still one modifier away,
and right-drag is the standard 3D convention. Clicking is unaffected because a
click is a zero-distance gesture.

**Why the camera-facing drag plane.** A node has no floor to slide on. A plane
through the node with normal = camera forward makes the node stay exactly under
the cursor at the current angle, at any pitch. Releasing unpins it, matching the
2D "release and the physics re-settles" contract. At `depthScale = 0` the model
z is forced to 0 so the inverse conversion cannot divide by zero.

**Wheel anchoring.** The point under the cursor on the target plane is computed
before the dolly. The target then moves toward that point by `(1 − newDist/dist)
× 0.35`. This keeps the cursor-zoom feel without the large target drift of full
anchoring. Pinch uses the same bias at the pinch midpoint.

**Pitch clamp.** ±70° prevents the right-vector degeneracy at the poles and
keeps labels readable. Users can look down on the graph but never lose the
horizon entirely.

### 6.4 Camera keyboard map

The canvas host is focusable (`tabindex="0"`, `role="application"`).

| Key | Action |
| --- | --- |
| ←/→ | Orbit yaw |
| ↑/↓ | Orbit pitch |
| Shift + arrows | Pan |
| `+` / `=` | Dolly in |
| `-` / `_` | Dolly out |
| Home / `0` | Reset camera and fit |
| `r` | Toggle auto-orbit (ignored under reduced motion) |
| `[` / `]` | Previous / next note by label; announces and keeps it on screen |
| Enter | Open the selected note (mockup: toast) |
| Escape | Clear selection |
| `/` | Focus the filter |

All of these stop at the host; typing in the filter or range is never hijacked.

---

## 7. Depth-cue hierarchy

The order matters: each cue is weaker than the one above it, so the eye reads
distance from geometry before it reads atmosphere.

1. **Perspective size.** The primary cue. Node screen radius is `worldR ×
   focal / depth`; near nodes are visibly larger, far nodes smaller. Clamped
   to 2.4px so far hubs remain clickable and 28px so near nodes do not become
   balloons.
2. **Fog / alpha.** Far nodes fade to 50% alpha (`1 − 0.5·fog^1.25`). The
   background shows through, so they read as behind, not just dim.
3. **Painter's order.** Edges are sorted far→near and drawn first; nodes are
   sorted far→near and drawn over them; labels are sorted far→near and drawn
   last. This resolves most occlusion without a depth buffer. Edges that pass
   in front of a far node are still drawn behind it (accepted simplification);
   nodes remain legible.
4. **Edge alpha and width.** Idle edges are 0.44 alpha at 1.15px, scaled by
   depth; far edges are thinner and fainter. Focus edges rise to 2.0px and
   0.9 alpha. No per-edge gradient (it costs a gradient per frame and adds
   noise).
5. **Glow falloff.** Each node has a cached radial glow sprite whose alpha
   falls from 0.50 near to 0.24 far. There is **no canvas blur and no
   `shadowBlur`**; the glow is the blur substitute and keeps the frame budget.
6. **Label attenuation.** Far labels fade and are suppressed entirely at
   `fog > 0.78` unless the node is a hub or in focus. This is the final depth
   cue: text exists where the eye should look.

No depth cue changes hue. A far node is a dimmer, smaller version of the same
blue sphere.

---

## 8. Label strategy

**Billboards, not objects.** Labels are drawn in screen space after the 3D
scene. They never rotate with the camera, never shrink with perspective, and
stay 12px regardless of zoom.

| State | Labels shown | Cap |
| --- | --- | --- |
| Idle | hubs (degree ≥ 6) + nodes with `fog < 0.46` | 16 |
| Hover | hovered node + direct neighbours + selected node/hop-1 | 22 |
| Selected | selected node + hop-1 + hubs | 22 |
| Filter | matching notes only; all if ≤ 12 matches, otherwise hubs + near matches | 22 |

**Placement.** Right of the node at `r + 7px`; then left; then above; then
below. Each candidate is clamped to an 8px inset. A 2px collision margin is
checked against already-placed labels. Focus labels are placed first and are
forced if all four positions collide; ordinary labels are skipped. This is
what keeps 45 labels from becoming a hairball.

**Readability over the scene.**

- Ordinary label: fill `--graph-label-rgb`, 3px halo in the canvas background
  colour at 86–90%, `lineJoin: round`. The halo is not a card; it disappears
  into the background.
- Focus label: 17px-high rounded pill, panel fill at 90%, 1px border. Selected
  uses `warnInk`; hovered uses `glow`. Text is 600 weight at full opacity.
- Text truncates at 30 characters with an ellipsis. Full names live in the
  selection chip and the SR announcement.

**No leader lines.** Labels sit within 7px of the node edge. Leader lines would
add a second set of lines to a graph already made of lines. If a future mode
moves labels farther away, add a 1px `dim` leader only for focus labels.

**Path vs basename.** The mockup labels with relative paths
(`architecture/frontend`) so the folder lobes are identifiable. Production
should use `node.name` (the basename, matching the current 2D view) and fall
back to the shortest unique path suffix when two basenames collide. This is an
open question below.

---

## 9. Interaction states

### 9.1 Idle

- Node: `--graph-node-rgb` sphere sprite (highlight offset up-left, darker
  rim), size by degree, alpha by fog.
- Edge: 0.44 alpha, 1.15px, depth-sorted.
- Vignette: one screen-space radial blip, `vinIn` at 22% centre → 7% mid →
  transparent edge. Cached bitmap; rebuilt on resize/theme.
- Optional particle field: preserved from 2D as a Settings toggle, default
  off. It remains screen-space and is gated by reduced motion and the
  ≤500 nodes+edges rule. The mockup omits it to keep the review focused.
- Physics is asleep after the initial settle.

### 9.2 Hover

- Hovered node: `--graph-node-hover-rgb`, +10% radius, 1.6px glow ring at
  `r + 4`.
- Direct neighbours: `mix(node, hover, 0.44)`.
- Everything else: alpha × 0.16. If a node is within two hops of the selected
  node, the floor is 0.58 so the selection context is not erased.
- Incident edges: 0.92 alpha, 1.9px, glow underlay. Non-incident edges: 0.055.
- Labels: hover + neighbours, cap 22; the hovered label gets a pill.
- A filter wins over hover dimming: a non-matching hovered node stays dim and
  unlabeled.

### 9.3 Selection (click)

BFS over undirected edges. Distance drives both fill and edge weight:

| Distance | Node fill | Ring | Edge |
| --- | --- | --- | --- |
| 0 (selected) | `warn` | 1.5px `warnInk` at `r + 3.2`; breathing ring `r + 5 … r + 13.5`, alpha 0.16–0.56 | hop-1 edges |
| 1 | `mix(node, warn, 0.82)` | none | 0.88 alpha, 2.0px, `mix(edge, warn, 0.34)`, pulse |
| 2 | `mix(node, warn, 0.44)` | none | 0.52 alpha, 1.5px, `mix(edge, warn, 0.16)` |
| 3+ | `mix(node, dim, 0.52)` | none | 0.32 alpha, 1.2px |
| Disconnected | `mix(node, dim, 0.48)`, alpha ×0.26 | none | 0.055 alpha |

- The breathing ring is `sin(t/420)`; under reduced motion it is a static
  1.5px ring at `r + 6` with alpha 0.45.
- Pulses run on hop-1 edges only, max 12, one 1.9px head dot + a 7% tail,
  2.6s per traversal, source→target.
- The selection chip appears with the name, degree, and hop-1/hop-2 counts.
- Clicking the same node keeps it selected. Clicking empty space clears.

### 9.4 Filter

- Match on `name` and full `id`, case-insensitive substring, trimmed.
- Non-matching nodes: alpha ×0.14. Non-matching edges: alpha ×0.12 if both ends
  miss, ×0.34 if one end matches.
- Labels only for matches; the summary appends `N matches` (or `0 matches`).
- The selected node keeps a 0.45 alpha floor when filtered out, and the chip
  remains, so the selection is locatable even when its label is suppressed.
- Escape in the filter clears it; Escape again returns focus to the canvas.
- There is no extra "no matches" overlay. The summary and the dimmed scene are
  the feedback. If user testing shows this is too quiet, add a small
  "No notes match" line under the filter — not a modal.

### 9.5 Active file

The last opened note keeps a **1px `warnInk` ring** at `r + 2.4`, alpha 0.55,
with no fill change. This is a conscious evolution from the 2D amber fill so
it can never collide with the selection heat-map. It is drawn under the hover
and selection rings. The mockup marks `search-panel` as active.

### 9.6 Node drag

- Pointer down on a node starts a plane drag; the node is pinned (`fixed`),
  the simulation wakes so neighbours respond.
- The node keeps its hover ring and label while dragged.
- Release unpins and lets the force sim re-settle. It does not leave a
  permanent pin; "pin" is not a user-visible state.
- A drag never selects or opens the note.

### 9.7 Auto-orbit

- Off by default. A toggle button with `aria-pressed`; 0.075 rad/s (≈4.3°/s)
  around the current target.
- Pauses during any gesture; resumes when the gesture ends.
- Disabled and forced off under reduced motion; the title explains why.
- No pitch bob, no zoom breathing, no camera easing while auto-orbiting.

### 9.8 Depth spread

- Range 0–100%, default 100%, step 5.
- Scales the rendered z only; the force simulation stays 3D, so raising the
  value re-inflates the layout. The camera target's z is rescaled with the
  value to keep the look-at point stable.
- 0% is a flat projection, not an orthographic switch: the current yaw/pitch
  still applies. Reset camera after flattening for a face-on view.
- Node drag in a flat view writes model z = 0.
- This is the non-3D fallback and the comparison control; it is not persisted.

### 9.9 Reduced motion

Honours `prefers-reduced-motion: reduce` by default. The mockup's demo switch
overrides it for comparison; production must not add that switch (the OS owns
it).

When on:

- auto-orbit off and its button disabled;
- no edge pulses;
- selection ring static (no breathing);
- no camera tween (reset and focus jumps are instant);
- no loading spinner rotation;
- hint and toast transitions removed;
- no title-dot pulse.

Physics settling still occurs after a node drag because it is a direct
manipulation, not ambient motion. Nothing loops on its own.

### 9.10 Loading / empty / error

The production view fetches `/api/graph`; the states below are the complete
treatment.

| State | Header | Layer |
| --- | --- | --- |
| First load | summary `Reading links…`; all controls disabled | full-screen layer: rotating conic ring, "Mapping your notebook…", "Reading links from your notes." |
| Empty (`nodes.length === 0`) | `0 notes · 0 links`; filter/zoom/depth/rotate disabled; refresh enabled | constellation icon, "Nothing to map yet", link guidance, **Refresh** button |
| Error, no data | `Not connected`; controls disabled; refresh enabled | broken-link icon with a danger dot, "Couldn't load the graph", server guidance, **Retry** button |
| Refresh with existing data | graph stays visible; refresh button spins; summary unchanged | no layer (avoid flicker). On failure: toast "Couldn't refresh the graph" and keep the old data. On success: keep the camera and node positions; refit only if the user has not moved the camera since the last fit. The mockup refits on refresh to demonstrate the loading round-trip. |
| Refresh with no data | loading layer | as first load |

State layer anatomy: 66% `--graph-bg` + `blur(3px)`; 360px max card; 14px
radius; 26/28px padding; 56px art; `.98rem/650` title; `.82rem` body at
`--fg-muted`; 30px accent action.

The mockup's demo strip can force any state for inspection. In production the
state is data-driven only.

---

## 10. Component specs

### 10.1 Header

| Property | Value |
| --- | --- |
| Height | min 47px (desktop), 60px coarse |
| Padding | 8px 14px |
| Background | `color-mix(in oklab, var(--bg-panel) 86%, transparent)` + `blur(8px)` |
| Border bottom | 1px `border` at 70% |
| Accent hairline | 1px gradient, accent 35%, 30–70% stops, 55% opacity |
| Flex | title+summary left, toolbar right; no wrap until 520px |
| z-index | 5 |

### 10.2 Title, badge, summary

- Dot: 7px, accent, double box-shadow glow, 2.4s pulse (static under reduced
  motion).
- Title: `.95rem`, weight 650, `white-space: nowrap`.
- Badge: 16px high, 9px/700, 0.1em tracking, accent-soft fill, accent text,
  1px accent-30% border, 4px radius.
- Summary: `.78rem`, muted, tabular numerals, nowrap. Below 981px it stays
  visible but caps at 118px with an ellipsis, so the filter count is not lost.

### 10.3 Filter

- 160 × 30px, radius 8, 1px border, `--bg` fill, `.82rem`.
- Search icon 13px, 8px from the left; text starts at 26px.
- Placeholder "Filter notes…" at `--fg-muted`.
- Focus-visible: accent border + 3px accent-25% ring.
- Native search cancel hidden; Escape clears via JS.

### 10.4 Depth control

- One bordered group, 30px high, radius 8, `--bg` fill, 6px gap.
- Layered-squares icon 13px, muted.
- Range 58px wide, `accent-color: var(--accent)`.
- Output 30px right-aligned, 10px tabular, muted.
- `aria-label="Depth spread"`; `aria-valuetext` updates to "N percent".
- Focus-visible ring on the range.

### 10.5 Buttons

| State | Visual |
| --- | --- |
| Default | 30×30, 8px radius, 1px border, `--bg`, muted icon |
| Hover | accent-soft fill, accent border, accent icon |
| Active (pressed) | `translateY(1px)` |
| Toggled on (`aria-pressed`) | accent-soft fill, accent border, accent icon |
| Focus-visible | 3px accent-28% ring, accent border |
| Disabled | 42% opacity, `not-allowed` |
| Refreshing | icon spins 0.7s linear; no spin under reduced motion |

Icons are inline 16×16 SVG at 15px, 1.4–1.5 stroke, round caps: orbit ellipse
+ dot, four corner brackets, plus, minus, circular refresh arrow. Every button
has both `aria-label` and `title`. The auto-orbit button also carries
`aria-pressed`.

### 10.6 Camera hint

- 999px pill, top 14px centred, 7px 12px padding, 11.5px muted text.
- Panel 82% + blur(10px); 1px border at 82%.
- Desktop copy: "Drag to orbit · Scroll to zoom · Right-drag to pan ·
  Double-click a note to open".
- Coarse copy: "Drag to orbit · Pinch to zoom · Two-finger drag to pan ·
  Double-tap a note to open".
- Fades over 380ms on the first pointer-down, wheel, or canvas key. Instant
  under reduced motion. `pointer-events: none`, `aria-hidden` (the host's
  aria-label carries the instructions).
- Never re-shows automatically. A production help action, if added, would be a
  separate "?" in the header; not in this scope.

### 10.7 Selection chip

- 999px pill, bottom-right 16px, 11.5px.
- Amber dot, name in `--fg`/600 (ellipsis at 220px), meta `7 links · 3 at hop
  1 · 5 at hop 2`, 22px clear button with an SVG ×.
- Panel 90% + blur(12px), 1px border, soft shadow.
- Hidden when nothing is selected or the view is not ready.
- The clear button has `aria-label="Clear selection"` and a focus-visible ring.
- Lifts to `bottom: 128px` below 720px; meta hides so the chip stays one line.

### 10.8 Toast

- 999px pill, bottom-centre 20px, 12px, panel 92% + blur(12px), 1px accent-34%
  border, soft shadow; 3.2s then fade.
- `role="status"` + `aria-live="polite"`; pointer-events none.
- The mockup uses it for the double-click "would open" affordance and refresh
  confirmation. Production uses it for refresh failures; it is not part of the
  required graph chrome.

### 10.9 State card

See §9.10. All copy is real, specific, and actionable; no lorem ipsum.

### 10.10 Mockup strip (not app chrome)

- Fixed bottom-left, 362px wide (full width minus 24px below 720px), 12px
  radius, panel 92% + blur(14px), shadow.
- Caption: "MOCKUP CONTROLS" + "preview only".
- Dark/Light segmented control; Reduce motion switch; State select
  (Ready/Loading/Empty/Error).
- Uses the app tokens but is visually distinct through the caption and the
  fixed position. Remove it in production. The theme and reduced-motion
  toggles exist only to let a reviewer compare; they are not new app settings.

---

## 11. Accessibility

### 11.1 Keyboard

Fully keyboard operable:

- Tab reaches the filter, depth range, auto-orbit, fit, zoom in/out, refresh,
  the canvas host, the selection clear button, and the state action.
- The canvas host supports the camera map in §6.4.
- `[`/`]` selects notes in label order, so the graph is inspectable without a
  pointer. The selected note is announced and, if off-screen, the camera
  eases to it (instant under reduced motion).
- Escape clears the selection; `/` moves focus to the filter; Enter opens the
  selected note.

### 11.2 Focus

Every interactive element has a `:focus-visible` style: 3px accent at 28%
outside the control, plus an accent border. The canvas host uses a 2px inset
accent ring instead of an outside ring because it fills the viewport. No
element relies on the browser default outline.

### 11.3 Contrast (measured)

| Pair | Ratio |
| --- | --- |
| Dark label `#e6eaf5` on `#0e1018` | 15.78:1 |
| Light label `#1f2330` on `#f4f6fb` | 14.48:1 |
| Dark muted `#8b8d98` on `#22232a` | 4.74:1 |
| Light muted `#5d6470` on `#f6f7f9` | 5.56:1 |
| Dark accent `#7c9cff` on `#0e1018` | 7.28:1 |
| Light accent `#2f5fd0` on `#f4f6fb` | 5.29:1 |
| Dark warn `#f3b454` on `#0e1018` | 10.37:1 |
| Light warn `#c9831d` on `#f4f6fb` | 2.88:1 (non-text only) |
| Light `warnInk` `#966623` on `#f4f6fb` | 4.60:1 |
| Accent button text dark `#14151a` on `#7c9cff` | 6.99:1 |
| Accent button text light `#ffffff` on `#2f5fd0` | 5.72:1 |

The light selection ring uses `warnInk`, not plain `warn`, so the 1px ring
clears 3:1. Node fills are graphics, not text; labels always use the label
token at full opacity with a halo or pill.

### 11.4 Colour independence

- Selection: fill + two rings + chip + SR announcement, not colour alone.
- Hover: fill + ring + pill label.
- Filter: opacity + summary count.
- Error: icon + text, not red alone.
- Auto-orbit: `aria-pressed` + pressed visual.
- Depth: slider position + percentage + `aria-valuetext`.

### 11.5 Screen readers

The canvas is `aria-hidden`; the host is a focusable `role="application"` with
a full instruction label. Selection changes are announced through a visually
hidden `aria-live="polite"` region with the note name, degree, hop-1 and hop-2
counts, and the Enter/Escape actions.

**Production requirement not fully demonstrated by the mockup:** a canvas is
not a document. Add an SR-only list of notes (links to `#` that open the note)
inside the graph view, or route SR users to the Search panel. The keyboard
selection cycle is a demonstration, not a substitute for a list.

### 11.6 Touch targets

Desktop buttons are 30px, matching the current header. When 3D is reachable on
a coarse pointer ≥1024px (tablet), buttons become 44×44px, controls 44px high,
the filter 190px, the depth track 72px, and the chip close 32px. On phones the
graph is not shipped (see §13), so 30px targets never appear on a phone.

---

## 12. Performance budget

Target: **60fps on a 2020-class laptop at 1280×800, DPR 2**, with the mockup's
45 nodes / 75 edges.

### 12.1 Frame budget

| Work | Budget |
| --- | --- |
| Force step (45 nodes, 990 pairs, 75 springs) | ≤ 2ms |
| Projection + sort + draw (75 edges, 45 nodes) | ≤ 5ms |
| Labels (≤ 22, measure cached, collision) | ≤ 1ms |
| Total JS + canvas | ≤ 8ms typical, 10ms p95 |
| Idle (nothing dirty) | 0 draws, 0 physics |

### 12.2 Cost controls

- **DPR cap 2.** Above 2 the canvas grows quadratically for no visible gain.
- **Cached sprites.** One 64×64 sphere and one 64×64 glow per colour. Hop
  heat-map colours create up to 45 extra sprites on first selection, then
  reuse them. Cleared on theme change. No `shadowBlur`, no `filter: blur`.
- **Cached vignette.** One offscreen bitmap, rebuilt on resize/theme only.
- **Cached text widths.** Keyed by text + weight.
- **Fixed-step physics.** 60Hz step while active; sleeps when
  `energy/n < 0.006`. Warm-up runs once at load, capped by
  `WARMUP_PAIR_BUDGET` (2M pair-steps) so 300 nodes do not block first paint.
- **No per-frame gradients.** All gradients live in sprites or the vignette.
- **Ambient redraw only when focused.** Auto-orbit or hover/selection keeps
  the loop alive; otherwise an idle view costs nothing until input/theme/resize.
- **Pause when hidden.** `visibilitychange` marks dirty on return; browsers
  throttle background rAF.
- **Culling.** Nodes behind the camera (`depth <= 12`) are skipped. Off-screen
  nodes still draw (45 is cheap); labels outside an 80px margin are skipped.

### 12.3 Caps and tiers

| Tier | Nodes | Effects |
| --- | --- | --- |
| Full (default) | ≤ 300 | pulses ≤ 12; labels 16 idle / 22 focus; bloom all visible; sim 60Hz |
| Reduced | 301–800 | pulses only selected hop-1 (≤ 8); labels 12 / 16; bloom focus + nearest 100; sim 30Hz; edge glow off |
| Lite | 801–1500 | no pulses, no bloom; labels 10 hubs; sim settles once then freezes; 30fps cap |
| Over budget | > 1500 | Render a flat layout (depth disabled) with a one-shot notice; do not attempt full 3D. |

The existing 2D rule (disable the particle field above 500 nodes+edges) is
preserved. The 3D view adds the label and effect tiers above; a user with a
huge notebook should never get a 5fps hairball.

### 12.4 Measurement plan

- Add a dev-only `window.__graph3dStats` with the last draw duration, node
  count, visible label count, and pulse count (behind a query flag, not in
  production output).
- Test 45/75, a synthetic 300/600, and 800/1600 graph. Record p50/p95.
- Profile with the Chrome performance panel on the mockup; check for layout
  thrash (none; canvas only) and forced synchronous layout (none per frame;
  `localPos` uses `getBoundingClientRect` on pointer events only).

---

## 13. Responsive and phone behaviour

### 13.1 Desktop breakpoints (implemented in the mockup)

| Width | Behaviour |
| --- | --- |
| ≥ 981px | One header row; summary visible; filter 160px; depth visible. |
| 821–980px | One row when it fits; the header wraps the toolbar when panels squeeze it. Summary stays visible capped at 118px; filter 160px; depth visible. |
| 721–820px | One row if it fits; toolbar can wrap internally; summary capped at 118px; depth visible. |
| ≤ 720px | Depth hidden (move it to a header overflow if narrow-window flat mode is required); selection meta hidden; chip lifted to 128px; toast lifted to 78px; demo strip full width. |
| ≤ 520px | Header wraps to two rows; heading full width; toolbar full width; filter stays 160px. |
| 390px (tested) | Header 76px; no horizontal scroll; host fills the rest. |

The canvas never assumes a minimum width. `ResizeObserver` updates the
backing store and focal length; the camera is not refit on resize.

### 13.2 Phone decision

**The 3D graph is not a phone surface in v1.**

- The current phone shell hides `#activity-graph-btn` in the phone media query,
  so the graph is already unreachable there.
  This design keeps that behaviour; it does not silently add a hidden 3D view.
- Reasons: a 390px viewport cannot show 45 labels without a hairball; orbit +
  pinch + two-finger pan competes with the phone shell's back gesture and
  reading scroll; the phone's jobs are read, capture, and WYSIWYG edit; 3D
  redraws cost battery for a view that is inherently exploratory.
- If graph access on the phone becomes a requirement, the follow-up is the
  **existing 2D renderer in a full-screen sheet**, opened from the phone Home
  or the note `…` menu, with larger touch targets and a list fallback. Do not
  port the 3D camera to the phone.
- The mockup still lays out at 390px so the header and states can be inspected
  on a resized desktop window. That is a review convenience, not a ship
  target.

### 13.3 Tablet

- The app's phone query is `(pointer: coarse) and (max-width: 1023px)`.
  Portrait tablets ≤1023px are treated as phones and keep the graph hidden.
- A coarse pointer ≥1024px (landscape tablet) gets the desktop 3D view with
  touch orbit, pinch dolly, two-finger pan, 44px targets, and no hover state
  (labels and the chip carry feedback).
- If portrait-tablet graph access is wanted, treat it as the same 2D-sheet
  follow-up as phones; do not force 3D into 768px.

---

## 14. Implementation notes for `web-engineer`

1. **Do not change the backend.** `GET /api/graph` already returns everything
   needed. The view is read-only; no `safe_path`, no writes.
2. **Keep the special tab.** Reuse `NB.tabs.registerSpecial({id: "§graph"})`
   and the existing `#graph-view` / `#graph-view-canvas-host` ids. A new tab id
   would break persisted `openFiles` and the activity button.
3. **Module.** Split the renderers into `graph-2d.js` (`NB.graph2d`) and
   `graph-3d.js` (`NB.graph3d`); `graph.js` is the facade owning the tab,
   header, mode switch, and the compatible `NB.graph` surface.
4. **Canvas 2D, no WebGL.** The mockup is the reference; copy its projection,
   sprite cache, and label placement. Guard `getContext("2d")` returning null
   exactly as `graph.js` does for jsdom.
5. **Warm start.** Reuse existing `x,y` for nodes that survive a refresh.
   Seed `z` deterministically from a hash of the node id so a refresh does not
   reshuffle depth. Run the warm-up before the first paint; do not show a
   half-settled graph.
6. **Theme.** Read the `--graph-*-rgb` triples on mount and on a
   `MutationObserver` for `body[data-theme]`; rebuild sprites and the vignette
   then. Never hardcode a colour in the renderer.
7. **Reduced motion.** Read `matchMedia("(prefers-reduced-motion: reduce)")`
   and listen for changes (unless a test override is set). Gate auto-orbit,
   pulses, breathing, camera tweens, and the loading spin.
8. **Particles.** Port the existing screen-space particle field and its
   Settings toggle; gate it with reduced motion and the ≤500 rule. It is not
   part of the mockup's review surface.
9. **Events.** Use Pointer Events with pointer capture. Keep a 4px drag
   threshold. Detect double-click manually (or do not `preventDefault` on
   pointerdown if relying on native `dblclick`; the mockup uses manual
   detection because pointer capture + preventDefault can suppress it).
10. **Focus and keyboard.** Make the host focusable, wire the map in §6.4, and
    keep the SR live region. Add the SR-only note list before shipping.
11. **States.** First-load loading layer; empty layer; error layer; refresh
    keeps the old graph and reports failure with a toast. The shipped fetch
    uses a 10s `Promise.race` timeout because `NB.api.getGraph()` exposes no
    `AbortSignal`; a true abort is a follow-up if `api.js` grows signal
    support.
12. **Tests.** Extend `tests/dom/test_dom.js` for mount, control wiring, token
    reads, selection BFS, filter summary, and reduced-motion gating. Add a
    real-browser suite for orbit/zoom/pan/click/dblclick/drag and the
    loading/empty/error state. The canvas is stubbable in jsdom; do not require
    a real 2D context for logic tests.

---

## 15. Acceptance checklist

Implementation status: source and tests are in. The checklist below is the
design acceptance record; formal 60fps measurement and real touch gestures
remain unverified.

- [ ] `/api/graph` data renders; summary matches the counts.
- [ ] Orbit, pan, dolly, reset-to-fit work with mouse, trackpad, and touch.
- [ ] Click selects; double-click opens the note; drag pins then re-settles.
- [ ] Hover highlights the node + neighbours and dims the rest.
- [ ] Selection shows the hop heat-map, breathing ring, and chip.
- [ ] Filter dims non-matches and updates the match count.
- [ ] Auto-orbit toggles; it is off under reduced motion.
- [ ] Depth 0% flattens; 100% restores the 3D spread.
- [ ] Theme switch repaints canvas and chrome from tokens only.
- [ ] Reduced motion removes pulses, breathing, spin, tweens, and auto-orbit.
- [ ] All controls have labels, titles, focus-visible styles, and keyboard access.
- [ ] Loading, empty, error, and refresh-failure states are implemented.
- [ ] 45/75 holds 60fps; the tier rules cap labels/pulses on large graphs.
- [ ] No phone 3D; tablet touch targets are 44px.
- [ ] Both 2D and 3D render; 3D is the default; the mode persists.
- [ ] Only implementation source and tests changed after acceptance.

---

## 16. Open questions

Resolved — see §1.1. The list below is kept as the decision record.

1. **Replacement or mode?** Does 3D replace the 2D graph, or do we keep a
   permanent 2D/3D switch? Recommendation: ship 3D as the default, keep
   depth 0% as the flat mode, and keep the old renderer as a one-release
   fallback rather than a user-facing toggle.
2. **Auto-orbit default.** Off by default (recommended: calm, battery-friendly,
   reduced-motion-safe), or on at a slow 4°/s so the depth is obvious on first
   open?
3. **Phone.** Confirm the graph stays desktop/tablet-only in v1. If it must be
   reachable on a phone, approve the existing 2D view in a full-screen sheet
   (not 3D) as a separate follow-up.
4. **Labels.** Full relative paths (the mockup, clearer folder lobes) or the
   current basename labels? Recommendation: basenames, with the shortest
   unique path suffix only on collision.
5. **Node drag.** Camera-plane drag with release re-settle (recommended, matches
   the 2D contract), or drag-to-freeze permanently? A permanent pin needs a
   visible "pinned" state and an unpin action; that is more UI.
6. **Camera persistence.** Should the orbit/pan/zoom survive a tab switch or a
   reload? Recommendation: survive a tab switch, reset on reload. Persisting
   the camera in `config.json` is cheap but adds a schema key.
7. **Large notebooks.** At what node count should 3D refuse and fall back to
   2D? The proposed ceiling is 1500; the lite tier starts at 801. A real
   notebook may never reach this, but the rule should be explicit.
8. **Active file.** Keep the thin amber halo (recommended) or drop active-file
   marking from the graph to reduce the amber vocabulary? The current 2D view
   uses an amber fill; the halo is a deliberate evolution.

---

## 17. What the mockup demonstrates that a screenshot cannot

- The feel of orbit, pan, and cursor-anchored dolly, and whether the depth
  order holds up as the camera moves.
- Whether focus stays legible from above, below, and behind a cluster, and how
  the billboard labels collide and re-place.
- The double-click affordance (toast), the breathing selection, and the hop
  heat-map in motion.
- Auto-orbit speed and whether it is calming or distracting.
- The reduced-motion comparison: pulses/breathing/auto-orbit on vs off.
- The theme switch rebuilding canvas colours, sprites, and the vignette.
- Depth 0% flattening and the return to 3D.
- The loading, empty, error, and filter states with real header counts.
- The responsive header at 1280, 760, 520, and 390px.

Open `docs/design/graph-3d.html` directly from disk. It has no network
requests, no CDN, no module imports, no fetch, and no build step.
