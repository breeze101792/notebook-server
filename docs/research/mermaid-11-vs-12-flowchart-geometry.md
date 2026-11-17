# Mermaid 11.16.0 vs 12.3.0 — what changes how a `flowchart LR` is drawn

Research date: 2026-11-17. Read-only finding; no code changed.

> **Working-tree state changed during this research.** At 11:51 the app pinned
> `"mermaid": "^11.16.0"` (`package.json:41`), `node_modules/mermaid` was
> 11.16.0, and `static/vendor/mermaid.min.js` was the 11.16.0 build (3,565,102
> bytes, 0 `org.eclipse.elk` occurrences). At 12:02, while this research was
> running, `package.json`, `package-lock.json`, `node_modules/mermaid` and
> `static/vendor/mermaid.min.js` were changed to **12.3.0** by someone else
> (uncommitted: `git status` shows `M package.json`, `M
> static/vendor/mermaid.min.js`). The vendored file is now byte-identical to
> `https://cdn.jsdelivr.net/npm/mermaid@12.3.0/dist/mermaid.min.js`
> (md5 `8b562310c589df12d2000b5192a7bf7e`, 5,537,838 bytes, 345
> `org.eclipse.elk` occurrences). The comparison below stands; only the
> "currently vendored version" premise changed.

## Question

The notebook app vendored mermaid **11.16.0** for the render described here
(`package.json:41` was `"mermaid": "^11.16.0"`, resolved to `node_modules/mermaid`
11.16.0, vendored as `static/vendor/mermaid.min.js` of 3,565,102 bytes) and
rendered with
`mermaid.initialize({startOnLoad:false, theme, securityLevel:"strict", fontFamily})`
then `mermaid.render(id, code)`. mermaid.live (editor 2.0.67) shows the same
`flowchart LR` with more right angles and straight segments. Establish:

1. Is mermaid.live client-side with the same library?
2. What changed in flowchart rendering between the two versions?
3. Does 12.3.0 still ship a plain-script build that sets `window.mermaid`?
4. Which config flags exist in 12.3.0, and what are their defaults?

## Finding

**The geometry difference is the layout engine, not the renderer and not
`flowchart.curve`.** v12.0.0 made ELK the default layout (dagre was the v11
default). Mermaid's ELK layout tags every routed edge `curve: 'rounded'`, and
that per-edge value overrides the configured `flowchart.curve`; the painter then
draws a **polyline with 5 px corner arcs** instead of a `curveBasis` spline. With
`layout: 'dagre'` forced, 12.3.0 produces edge paths structurally identical to
11.16.0. `flowchart.curve` has no effect on ELK-routed edges (verified, below).

mermaid.live is a static client-side SPA using the `mermaid` npm package at
`^12.3.0`; 12.3.0 still publishes `dist/mermaid.min.js` as a plain-script
esbuild bundle that assigns `globalThis["mermaid"]`.

## Evidence

### 1. mermaid.live is client-side, same library

- `mermaid-live-editor` `package.json` (branch `master`, commit
  `d3eb1dcdd26d451e4224e16bdc755a10fe10225a`, 2026-11-16):
  `"version": "2.0.67"`, `"mermaid": "^12.3.0"`,
  `"@sveltejs/adapter-static": "^3.0.11"` (devDependency).
  <https://github.com/mermaid-js/mermaid-live-editor/blob/master/package.json>
- `src/lib/util/mermaid.ts:11-20` — the render path is a direct library call in
  the browser:
  `mermaid.initialize(config); return await mermaid.render(id, code);`
  It also registers `@mermaid-js/layout-tidy-tree` and zenuml
  (`:1-10`). ELK is not registered there; the comment at `:7` reads
  "ELK ships bundled with mermaid 12 and is registered automatically."
- `src/lib/constants.ts:69-70` — default config is literally empty:
  `// Empty on purpose: mermaid picks its own theme, look and layout per diagram type.`
  then `mermaid: '{}'`. So mermaid.live renders with **12.3.0 defaults**, except
  for the theme, which the editor pins to the diagram type's default
  (`src/lib/util/state.svelte.ts:288-312`, `getDefaultTheme`) and a migration
  that clears a legacy `{"theme":"default"}` (`:327-336`).
- `Dockerfile:1-3` — "The build output is a static site"; `nginx.conf` serves
  `/usr/share/nginx/html` with `try_files $uri /index.html`.
- The only server endpoint is optional and export-only:
  `MERMAID_RENDERER_URL` (`src/lib/util/env.ts:9`) is used solely to build
  png/svg share links (`src/lib/util/state.svelte.ts:194-228`). It is not used
  for the preview or the editor render.

Conclusion: same engine, same library family, different major version.

### 2. What changed between v11 and v12

**v12.0.0 release notes** (published 2026-09-10),
<https://github.com/mermaid-js/mermaid/releases/tag/mermaid%4012.0.0>:

- PR #8155 `feat!: ELK is now bundled with mermaid and is the default layout
  algorithm.` — "Flowchart, state, class, entity-relationship, requirement,
  use-case diagrams that do not specify a `layout` are now laid out by ELK
  instead of dagre." Also: "The single-file IIFE build (`mermaid.min.js`)
  inlines it and grows by roughly 500 kB gzipped."
- PR #8193 — `theme`, `look` and `layout` can be set per diagram type;
  "Resolution, highest first: front matter or directive, `initialize()`, the
  diagram type's default, the global default".
- PR #8211 — removes `flowchart.defaultRenderer`; "flowchart-v2, classDiagram
  and stateDiagram are what `detectType` now returns". No renderer was added:
  all `defaultRenderer` values already selected "the same unified renderer".
- Closing section: "ELK replaces dagre as the default layout, and `redux-color` /
  `neo` replace `default` / `classic` as theme and look for flowchart…"
  To keep the old appearance: `mermaid.initialize({ layout: 'dagre', theme:
  'default', look: 'classic' })`.
- Also breaking: ES2024 / Safari 17.4+ / Node 22.12+ (PR #8213).

**Docs, rendered at version 12.3.0**,
<https://mermaid.ai/open-source/config/layouts.html>: "ELK is bundled and
default from v12.0.0 … it is the **default**, replacing Dagre" (Flowchart is
first in the list).

**Defaults, from the shipped 12.3.0 schema**
`packages/mermaid/src/schemas/config.schema.yaml` at tag `mermaid@12.3.0`:

| key | 11.16.0 | 12.3.0 | source |
|---|---|---|---|
| global `layout` | `dagre` | `elk` | 12.3.0 schema `:79-85`; 11.16.0 global default read from the bundle (`layout:"dagre"`) |
| `flowchart.theme` | (absent; global `default`) | `redux-color` | 12.3.0 schema `:2518-2520` |
| `flowchart.look` | (absent; global `classic`) | `neo` | 12.3.0 schema `:2521-2523` |
| `flowchart.curve` | `basis` | `basis` (unchanged) | 12.3.0 schema `:2576-2596`; 11.16.0 schema `:2295-2315` |
| `flowchart.nodeSpacing` | `50` | `50` | 12.3.0 `:2558-2566` |
| `flowchart.rankSpacing` | `50` | `50` | 12.3.0 `:2567-2575` |
| `flowchart.padding` | `15` | `15` | 12.3.0 `:2598-2604` |
| `flowchart.wrappingWidth` | `200` | `120` | 12.3.0 `:2605-2612`; 11.16.0 `:2327-2334` |
| `flowchart.minNodeWidth` | (does not exist) | `120` | 12.3.0 `:2613-2622` |
| `flowchart.htmlLabels` | `null`, deprecated | `null`, deprecated | 12.3.0 `:2546-2557`; 11.16.0 `:2265-2276` |
| `flowchart.defaultRenderer` | `dagre-wrapper` | removed | 11.16.0 `:2326`; v12.0.0 note #8211 |
| global `fontFamily` | `'"trebuchet ms", verdana, arial, sans-serif;'` | same | both bundles' global default block |
| ELK in the bundle | absent (`org.eclipse.elk` appears 0 times in `static/vendor/mermaid.min.js`) | present (345 occurrences in `dist/mermaid.min.js`) | byte grep of both files |

Edge routing, primary source (`mermaid@12.3.0`):

- `packages/mermaid/src/rendering-util/layout-algorithms/elk/render.ts:2106` —
  after clipping, every routed ELK edge is tagged `layoutEdge.curve = 'rounded';`.
  Unrouted edges fall back to `layoutEdge.curve = 'linear'` (`:2055`).
- `packages/mermaid/src/rendering-util/rendering-elements/edges.js`
  (`resolveEdgeCurveType`, `:38-45`) — a string `edge.curve` wins over
  `getConfig()?.flowchart?.curve`.
- Same file — `case 'rounded': curve = curveLinear` then
  `generateRoundedPath(applyMarkerOffsetsToPoints(lineData, edge), 5)`.
  So ELK edges are straight segments joined by quadratic arcs of radius 5 px.

`look` and `fontFamily` are not the cause of the geometry difference: with
`look: 'classic'` and `theme: 'default'` the ELK path is still `M L Q L Q L`.
`look` is also not a visible difference between the two versions: both bundles
emit `data-look="neo"` and a `<linearGradient>` node fill for the app's config,
so the schema-level default change did not reach the rendered output.

### 3. 12.3.0 still ships a global-setting browser build

Fetched from jsDelivr on 2026-11-17:

- `https://cdn.jsdelivr.net/npm/mermaid@12.3.0/dist/mermaid.min.js`
  first bytes: `"use strict";var __esbuild_esm_mermaid_nm;(__esbuild_esm_mermaid_nm||={}).mermaid=(()=>{…`
  last bytes: `globalThis["mermaid"] = globalThis.__esbuild_esm_mermaid_nm["mermaid"].default;`
  Size 5,537,838 bytes, `content-type: application/javascript`.
- `https://cdn.jsdelivr.net/npm/mermaid@11.16.0/dist/mermaid.min.js` starts with
  the same 300 bytes and ends with the same `globalThis["mermaid"] = …` line;
  size 3,565,102 bytes.
- `https://cdn.jsdelivr.net/npm/mermaid@12.3.0/package.json`: `"type": "module"`,
  no `main`, no `browser`, no `unpkg`; `exports["."]` maps `import` and
  `default` to `./dist/mermaid.core.mjs`; `exports["./*"]` is `"./*"`.

So: the **package entry** is ESM-only, the **single-file browser build is not**.
`dist/mermaid.min.js` is an esbuild IIFE-style bundle (a `var
__esbuild_esm_mermaid_nm` wrapper around the ESM module, then one assignment to
`globalThis.mermaid`). It is neither UMD nor ESM. A page loads it exactly like
the app loads 11.16.0 today: `<script src="…/mermaid.min.js">`, then
`window.mermaid.initialize(...)`, `window.mermaid.render(id, code)`.

### 4. Config flags in 12.3.0 and their defaults

Defaults are listed in the table above. Behaviour verified on the published
artifacts (chromium, Playwright from `node_modules`, both files loaded as plain
scripts, config `{startOnLoad:false, theme:'default', securityLevel:'strict',
fontFamily:'sans-serif'}`, diagram with a decision diamond and two labelled
branches):

| build / config | edge path shape | first edge `d` |
|---|---|---|
| 11.16.0, app config | `M L C C L` | `M514.195,139L518.98,139C523.766,139,533.336,139,543.211,135.23C…` |
| 12.3.0, app config | `M L Q L Q L` | `M352.33,73.33L378,73.33L390.92,73.33Q398,73.33 398,66.26L398,62.07Q…` |
| 12.3.0, `layout:'dagre'` | `M L C C L` | `M359.616,70.616L370.151,66.513C380.687,62.411,…` |
| 12.3.0, `flowchart:{curve:'linear'}` | unchanged vs app config | identical `d` |
| 12.3.0, `flowchart:{curve:'step'}` | unchanged vs app config | identical `d` |

`Q` is a quadratic corner arc; `C` is a cubic spline segment. The two `curve`
overrides produced **byte-identical** paths to the default, i.e. `flowchart.curve`
cannot restore smoothing while ELK is the layout.

Second probe, long label `A[This is a fairly long explanatory label] --> B[Short]`:

- 11.16.0: node widths `260` / `102.94`, viewBox `0 0 428.9375 94`.
- 12.3.0 default (ELK): node widths `152` / `152`, viewBox `4 4 360 136`.
- 12.3.0 with `{layout:'dagre', theme:'default', look:'classic',
  flowchart:{wrappingWidth:200, minNodeWidth:0}}`: node widths `260` /
  `102.94`, viewBox `0 0 428.9375 94`, and the edge `d` prefix identical to
  11.16.0.

`minNodeWidth: 120` is new and is what widens short nodes under v12; removing it
along with restoring `wrappingWidth: 200` reproduced the 11.16.0 render exactly
in this probe.

## Observed vs inferred

Observed (read or run directly):

- The live-editor sources, default config `{}`, the static build, and the
  `^12.3.0` dependency, at the commit above.
- v12.0.0 release-note text, the 12.3.0 docs page, and the 12.3.0 / 11.16.0
  schema defaults.
- The first and last bytes, size and `content-type` of both `dist/mermaid.min.js`
  files; the `package.json` of 12.3.0.
- The `curve = 'rounded'` / `generateRoundedPath(…, 5)` code paths in
  `mermaid@12.3.0`.
- The rendered `d` strings and node widths in the table above.

Inferred:

- That the ELK tag `curve='rounded'` survives to the paint step: I read
  `layoutEdge.curve = 'rounded'` in `elk/render.ts` and the string-wins rule in
  `edges.js`, and the rendered output confirms it. The exact internal call order
  was not traced end to end.
- That mermaid.live shows `look: 'neo'` + `theme: 'redux-color'` for flowcharts
  by default: from `constants.ts:69-70` (empty config), the documented
  resolution order in #8193, and `getDefaultTheme`. Not observed on the live
  site directly.
- That `minNodeWidth: 120` is the sole cause of the wider short nodes: the
  probe with `minNodeWidth: 0` matched 11.16.0 exactly, but I did not vary
  `padding` independently.

Assumed (not verified): that the deployment at mermaid.live runs this `master`
build; the repo, version `2.0.67` and the dependency range match what the user
reported from the editor UI.

## Open / conflicting

- Which spacing knobs ELK actually honours. The schema still lists
  `flowchart.nodeSpacing` / `rankSpacing` at 50, but ELK has its own
  `elk.spacing.*` options; I did not verify whether the flowchart values reach
  ELK or are only used by dagre. A probe varying one value and measuring node
  coordinates would settle it.
- Whether `flowchart.curve` is honoured by any *non*-default layout in v12
  (dagre yes — `M L C C L` observed). Not tested for `tidy-tree` or
  `cose-bilkent`.
- `securityLevel: "strict"` is the default in both versions (schema), so it is
  not a difference.

## What this means for the decision

The two renders differ because the app ran 11.16.0 (dagre, `curveBasis`
splines) and mermaid.live runs 12.3.0 (ELK, 5 px-rounded orthogonal polylines).
No change to the app's `initialize()` options — theme, fontFamily,
`securityLevel` — could close that gap while the library stayed at 11.16.0,
because the difference is in the layout engine that 11.16.0 does not contain (0
occurrences of `org.eclipse.elk` in the 11.16.0 vendored file). The flags that
control it in 12.3.0 are `layout` (default `elk`), `flowchart.look` (default
`neo`), `flowchart.theme` (default `redux-color`), `flowchart.wrappingWidth`
(default `120`) and `flowchart.minNodeWidth` (default `120`, new);
`flowchart.curve` stays `basis` but is overridden per edge by the ELK layout.
After the 12.3.0 upgrade the app's vendored file is byte-identical to
mermaid.live's library, so the two should now draw the same geometry unless the
app's `initialize()` options differ (it pins `theme` and `fontFamily`;
mermaid.live pins only `theme`).
