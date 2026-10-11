# Options for a draw.io-style visual Mermaid editor in a no-build-step vanilla-JS app

**Author:** researcher
**Date:** 2026-10-10
**Status:** Findings only — no technology recommendation for the decision owner (`plan` / `architect`).

---

## 1. Question

For this project (a vanilla-JS, no-build-step notebook server), what established facts
bear on building a draw.io-style **visual editor for Mermaid diagrams**? Specifically:

1. Does draw.io/diagrams.net import Mermaid, and can it export back to Mermaid text?
   What is its license, size, and embeddability?
2. Is there a maintained library that converts Mermaid **into** Excalidraw elements, and a
   supported path back to Mermaid? Licenses, maintenance, size?
3. Does the `mermaid` npm package expose a public parser / AST / graph API to read or write
   diagrams?
4. What purpose-built open-source visual Mermaid editors exist, what do they round-trip,
   and under what license / maintenance?
5. Which graph libraries are license-compatible (MIT/Apache) for this app, and which
   require a build toolchain?
6. For the flowchart-heavy case, is there a reliable algorithm/library to serialize a
   node-edge graph to Mermaid text and parse it back — and can layout coordinates be
   written back?

### Local grounding (what this project actually uses)

| Fact | Value | Source |
| --- | --- | --- |
| Vendored Mermaid | **11.16.0** | `static/vendor/mermaid.min.js` (version string `renderer.draw(t,e,"11.16.0"` at `static/vendor/mermaid.min.js:3534`) |
| Mermaid bundle size | **3,565,102 bytes** (~3.4 MiB) UMD, exposes `window.mermaid` | `static/vendor/mermaid.min.js`; `static/js/mermaid.js:3-4` |
| Integration style | Vendored `<script>`, treated as a black box; `mermaid.initialize(...)` + `mermaid.render(id, source) -> Promise<{svg}>` | `static/js/mermaid.js:7-17` |
| Build step | **None.** Frontend is IIFEs extending `window.NB` | `CLAUDE.md`, "Frontend — vanilla JS, no build step" |

**Why the version matters:** the installed 11.16.0 defaults to the **Dagre** layout engine.
Mermaid **12.0.0** makes **ELK** the default and targets ES2024 / Node ≥ 22.12.0
(`mermaid` latest = 12.1.0, npm registry; Mermaid docs "Layouts"). Any option chosen must
work against the vendored 11.16.0 unless the project deliberately upgrades.

---

## 2. Finding — what is actually true

1. **draw.io imports Mermaid but cannot export back to Mermaid text.** Import is official
   (`Arrange > Insert > Mermaid`, plus a `mermaid` descriptor in embed mode). There is **no
   Mermaid export format** — its export set is XML/JSON/SVG/PNG/HTML. The maintainer
   **declined** the export feature specifically as out of scope. So draw.io is
   **one-way** for Mermaid.
2. **draw.io is no longer a practical open-source dependency.** The repo `LICENSE` file is
   the standard Apache-2.0 text, but the maintainer and README state the app sources are not
   published (only minified build output) and "this is not an open source project." It
   remains **self-hostable** via the official `jgraph/drawio` Docker image, and
   embeddable via `embed.diagrams.net` + `postMessage` (iframe, **no build step**).
3. **Excalidraw has a maintained, official-ish Mermaid→Excalidraw library**
   (`@excalidraw/mermaid-to-excalidraw`, MIT, v2.2.2, published 2026-03-24, lives in the
   Excalidraw monorepo). It supports **flowcharts only** (other diagram types become a
   static image). The **reverse** (Excalidraw→Mermaid) has **no supported/official path**;
   only stale or third-party converters exist (`@excalidraw-to-mermaid/core` is v0.1.0,
   last published 2024-09-24; `sindrel/excalidraw-converter` is an external Go CLI). The
   Excalidraw React component itself is a **React dependency → requires a build toolchain**.
4. **Mermaid exposes a documented *validation* parse but no documented public AST/graph
   read API.** `mermaid.parse(text)` returns only `{diagramType}`. The lower-level
   `@mermaid-js/parser` package (MIT, v2.0.1) does expose `parse(diagramType, text) -> AST`,
   but it is a support package, not a first-class documented product API, and coverage is
   partial/unverified. `getDiagramFromText()` reaches the internal diagram DB but has been
   reported as deprecated. There is a long-standing open issue (#2523, since 2021) asking
   for a supported AST/serializer — i.e. **the capability is not officially provided**.
   Writing Mermaid text is the documented input; structured read-back is not.
5. **Purpose-built open-source visual Mermaid editors exist, but every one that
   round-trips is a React/Svelte app needing a build toolchain.** The only MIT project
   claiming **bi-directional** sync is **Mermify** (flowcharts + sequence diagrams). The
   official **Mermaid Chart "Visual Editor"** is **commercial/closed**. `mermaid-live-editor`
   (MIT) is a text editor + preview, **not** a visual drag editor.
6. **License-compatible graph libraries:** React Flow / xyflow (**MIT**), Cytoscape.js
   (**MIT**), JointJS core (**MPL-2.0**, file-level copyleft; JointJS+ plugins commercial),
   mxGraph (**Apache-2.0 but archived/EOL**). **GoJS is commercial** (not open source;
   free only for personal non-commercial use since Sept 2026). React Flow and any React
   editor force a **build toolchain**, which this app does not have.
7. **Serializing a node-edge graph to Mermaid text is straightforward; parsing Mermaid
   back to a graph has no *official* library but two working third-party paths
   (`mermaid-ast`, MIT, Jan 2026; and the Excalidraw parser).** Mermaid has **no coordinate
   syntax** — layout is owned by Dagre/ELK, and user-specified node positions were requested
   in 2015 (#270) and never implemented. So diagram geometry cannot be written back into
   Mermaid text.

**Bottom line for this app:** the only option that is simultaneously (a) no-build-step,
(b) license-compatible, and (c) maintained is the **draw.io iframe embed** — but it gives
you Mermaid **import only, never export back to Mermaid** (a one-way door, XML in the
middle). Every round-trip-capable open-source editor requires a JS build toolchain. The
"serialize graph → Mermaid text" direction is well-supported; the "Mermaid text → editable
graph model" direction depends on an unofficial parser.

---

## 3. Comparison table

| Option | What it is | Mermaid IN | Mermaid OUT | License | Maintained (pushed) | Build step needed? | Size / footprint | Diagram types |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **draw.io embed** (`embed.diagrams.net`) | iframe + `postMessage` editor | ✅ `mermaid` descriptor | ❌ only XML/JSON/SVG/PNG/HTML | Apache-2.0 file, but sources withheld ("not open source") | ✅ active product; repo pushed 2026 | **No** (iframe) | external service (or self-host Docker `jgraph/drawio`) | Many (Mermaid import broadly) |
| **draw.io self-host (Docker)** | `jgraph/drawio` Tomcat image | ✅ | ❌ | Apache-2.0 (minified) | ✅ | No (server, not JS) | Docker container | Many |
| **`@excalidraw/mermaid-to-excalidraw`** | Mermaid → Excalidraw elements | ✅ | ❌ | **MIT** | ✅ (v2.2.2, 2026-03-24; repo pushed 2026-10-08) | **Yes** (needs `@excalidraw/excalidraw`, React) | lib 330 KB unpacked; editor 46.8 MB unpacked | **Flowchart only** |
| **`@excalidraw-to-mermaid/core`** | Excalidraw → Mermaid | ❌ | ✅ | ISC | ❌ (v0.1.0, 2024-09-24; repo pushed 2024-09-24) | Yes | 12.5 KB | small |
| **`sindrel/excalidraw-converter`** | Go CLI: Excalidraw → Mermaid/Gliffy/draw.io | ❌ | ✅ (flowchart only) | MIT | ✅ (pushed 2026-09-01, 295★) | external CLI | Go binary | flowchart only |
| **`mermaid` npm** | renderer + validator | input = text | ❌ (no serializer) | MIT | ✅ (12.1.0; project uses 11.16.0) | No (UMD available) | 3.4 MiB vendored | ~18 types |
| **`@mermaid-js/parser`** | Langium parser → AST | ✅ | AST only | MIT | ✅ (2.0.1) | No (package) | small | partial / unverified |
| **`mermaid-ast`** | parse + **serialize** + graph tools | ✅ | ✅ | **MIT** | ⚠️ new (v0.8.2, created 2026-01-16, pushed 2026-03-27, 22★) | No (package) | — | claims all 18 types; flowchart graph tools |
| **Mermify** | React visual editor, bi-directional | ✅ | ✅ | **MIT** | ✅ (v0.3.0, pushed 2026-09-24, 29★) | **Yes** (React/Vite/TS) | web app; Docker/Helm | flowchart + sequence |
| **mermaid visual editor (saketkattu)** | Next.js + React Flow, export-only | ❌ (import on roadmap) | ✅ | MIT | ⚠️ (pushed 2026-05-04, 63★, 44 open issues) | **Yes** (Next.js) | web app | flowchart |
| **mermaid-reactflow-editor (albingcj)** | Mermaid → React Flow canvas | ✅ (flowchart) | partial | MIT | ✅ (pushed 2026-07-25, 59★) | **Yes** (Vite) | web app | flowchart |
| **mermaid-live-editor** | official text editor + preview | text | text | MIT | ✅ (pushed 2026-10-10, 6.9k★) | **Yes** (SvelteKit) | web app | many |
| **Mermaid Chart Visual Editor** | commercial product | ✅ | ✅ | proprietary | ✅ | n/a (hosted) | SaaS | multiple |

### Graph libraries (Q5)

| Library | License | Compatible here? | Build toolchain? | Notes |
| --- | --- | --- | --- | --- |
| **React Flow / `@xyflow/react`** | **MIT** | ✅ license | **Yes — React/JSX** | v12.12.0; 1.2 MB unpacked; core is MIT "forever" |
| **Cytoscape.js** (`cytoscape`) | **MIT** | ✅ | No (UMD available) | v3.34.3; 5.7 MB unpacked; graph analysis + renderer |
| **JointJS** (`@joint/core`) | **MPL-2.0** (file-level copyleft) | ⚠️ license-OK but copyleft on modified files | No (UMD `joint.min.js`) | v4.3.3; JointJS+ plugins are **commercial** |
| **mxGraph** | Apache-2.0 | ✅ license | No | **archived 2021-03-31, EOL**, "not advised to start new projects" |
| **GoJS** | **commercial** | ❌ | n/a | not open source; free only for personal non-commercial use (Sept 2026); license key + watermark |

---

## 4. Evidence (by question)

### Q1 — draw.io / diagrams.net

- **Import is official.** The manual documents *Arrange > Insert > Mermaid*; the diagram is
  converted to native draw.io shapes in an editable "Mermaid container group" that stores
  the source for re-editing.
  - Observed: <https://www.drawio.com/docs/manual/mermaid/> (draw.io docs, 2026).
- **Embed mode accepts a Mermaid descriptor** and can wrap it as a re-editable group:
  `{"action":"load","descriptor":{"format":"mermaid","data":"graph TD\n A-->B","wrap":true}}`.
  - Observed: <https://www.drawio.com/docs/reference/embed-mode/> ("Mermaid descriptor options").
- **`#create` URL supports `type:"mermaid"`** to create a diagram from Mermaid syntax.
  - Observed: <https://www.drawio.com/docs/reference/supported-url-parameters/> ("Creating diagrams from templates").
- **Export formats do NOT include Mermaid.** The embed `export` action supports
  `xml`, `json`, `svg`, `xmlsvg`, `png`, `xmlpng`, `html`, `html2` (and UI exports PNG/JPG/
  WebP/SVG/XML/HTML/PDF). No `mermaid` format.
  - Observed: <https://www.drawio.com/docs/reference/embed-mode/> ("export" action).
- **Mermaid export was explicitly declined by a maintainer:**
  > "export to mermaid would be extrememly complex and better implemented as a tool outside
  > of the draw.io editor" — davidjgraph, 2026-05-27, issue closed "not planned".
  - Observed: <https://github.com/jgraph/drawio/issues/5590>. (An older identical request:
    <https://github.com/jgraph/drawio/issues/279>, 2018.)
- **JSON export is topology-only** — "graph topology, labels and metadata; no styles or
  geometry", cells typed `layer|group|node|edge` with `source`/`target`.
  - Observed: <https://www.drawio.com/docs/reference/embed-mode/> ("json" export parameters).
- **License — nuanced.** The repository `LICENSE` file is the verbatim **Apache License 2.0**
  (<https://github.com/jgraph/drawio/blob/dev/LICENSE>). But the maintainer states the app
  **sources are not published** (only minified build output) and "this is not an open source
  project"; the change is not going to be reverted.
  - Observed: discussion <https://github.com/jgraph/drawio/discussions/4819> (Dec 2024–2026).
  - Inferred: the Apache-2.0 text applies to the distributed minified code; there is no
    buildable open source. Treat it as source-available, not open source.
- **Embeddability / size:** embed mode is "only supported on `https://embed.diagrams.net`"
  (third-party host). Self-hosting is supported via the official Docker image:
  `docker run -it --rm -p 8080:8080 -p 8443:8443 jgraph/drawio`.
  - Observed: <https://www.drawio.com/docs/reference/embed-mode/>;
    <https://www.drawio.com/docs/security/diagrams-docker-app/>.
- **No official `@drawio/…` npm editor package.** npm search for "drawio" returns only
  integrations/converters (e.g. `@drawio/mcp`, an MCP server; `drawio-embed`), no official
  editor package.
  - Observed: npm registry search `https://registry.npmjs.org/-/v1/search?text=drawio`
    (retrieved 2026-10-10).

### Q2 — Excalidraw

- **Official Mermaid→Excalidraw library exists.** `@excalidraw/mermaid-to-excalidraw`:
  license **MIT**, latest **2.2.2**, published **2026-03-24**, unpacked **330,086 bytes**;
  depends on `@mermaid-js/parser` and `mermaid`.
  - Observed: registry `https://registry.npmjs.org/@excalidraw/mermaid-to-excalidraw`.
- **API:** two steps — `parseMermaidToExcalidraw(mermaidSyntax)` then
  `convertToExcalidrawElements(elements)` (the second from `@excalidraw/excalidraw`, needed
  because the editor is UMD, not tree-shakeable ESM).
  - Observed: <https://docs.excalidraw.com/docs/@excalidraw/mermaid-to-excalidraw/api>.
- **Flowcharts only.** "Currently only flowcharts are supported. All other diagram types
  will be rendered as an image in Excalidraw." Unsupported shapes fall back to rectangles;
  markdown and FontAwesome fall back to plain text.
  - Observed: same API page.
- **Reverse path (Excalidraw→Mermaid) is not official.** The docs document only the one
  direction. The community request to convert back is an open issue
  (<https://github.com/excalidraw/excalidraw/issues/11187>), and the reverse is served only
  by third-party tools.
  - Observed (issue exists): search result title/URL; not read in full.
  - `@excalidraw-to-mermaid/core`: ISC, **v0.1.0**, published **2024-09-24**, repo
    `YokiToki/excalidraw-to-mermaid` pushed **2024-09-24** (≈2 years stale, 11★, no SPDX
    license on the repo API response).
    - Observed: registry + `https://api.github.com/repos/YokiToki/excalidraw-to-mermaid`.
  - `sindrel/excalidraw-converter`: external **Go CLI**, MIT, 295★, pushed 2026-09-01;
    converts Excalidraw→Mermaid **flowcharts only**.
    - Observed: <https://github.com/sindrel/excalidraw-converter>.
- **Excalidraw itself is a React component and heavy.** `@excalidraw/excalidraw` v0.18.1,
  MIT, unpacked **46,802,783 bytes** (includes source/build assets); ~36 runtime deps
  including React-oriented tooling.
  - Observed: registry `https://registry.npmjs.org/@excalidraw/excalidraw`.
- **Maintenance:** Excalidraw monorepo is highly active (133,571★, pushed 2026-10-08);
  the mermaid-to-excalidraw package's last publish is 2026-03-24.
  - Observed: `https://api.github.com/repos/excalidraw/excalidraw`; npm registry.

### Q3 — mermaid core parser / AST

- **`mermaid.parse(text)` is documented but returns only the diagram type:**
  "returns `{ diagramType: string }` if the definition follows mermaid's syntax." There is
  no documented AST/graph return.
  - Observed: <https://mermaid.js.org/config/usage.html> ("Syntax validation without rendering").
- **No public AST/serializer API — long-standing open request.** Issue #2523 (opened
  2021-11-30, still open): maintainer knsv: "The data is stored in a diagram specific
  representation after parsing... there is no built in functionality [to dump it]." Later
  commenters note `getDiagramFromText()` works but is "marked as a deprecated API"; another
  notes it "doesn't support things like gitgraph, flowchart, or class diagram." A
  contributor published `mermaid-ast` in Jan 2026 as the community answer.
  - Observed: <https://github.com/mermaid-js/mermaid/issues/2523>.
- **A lower-level parser package does exist:** `@mermaid-js/parser`, MIT, v2.0.1
  (modified 2026-10-02). Its README: it "exports a `parse` function" with signature
  `parse<T extends DiagramAST>(diagramType, text): T`, implemented on **Langium**.
  - Observed: registry `https://registry.npmjs.org/@mermaid-js/parser` (README text).
  - Open: which diagram types this package covers is **not verified**; Mermaid is
    mid-migration and the package is used internally by the Excalidraw converter.
- **Writing Mermaid text is the documented input** (that is the entire product model); there
  is **no documented way to get structure back out**.
  - Observed: <https://mermaid.js.org/config/usage.html>.
  - Conflicting: `mermaid.mermaidAPI` exists but the API page treats it as legacy; DeepWiki
    lists `mermaidAPI.parse()` (secondary source, not relied upon).

### Q4 — purpose-built visual Mermaid editors

| Project | Diagram types | Round-trips existing text? | License | Maintenance | Build step |
| --- | --- | --- | --- | --- | --- |
| **Mermify** (`tra-sco/mermify`) | flowchart + sequence | **Yes, bi-directional** (Monaco ↔ canvas) | MIT | v0.3.0, pushed 2026-09-24, 29★ | React + Vite + TS |
| **mermaid-visual-editor** (`saketkattu`) | flowchart | **No** — "The canvas state is canonical. Mermaid syntax is always derived — never parsed back in"; import is an unchecked roadmap item | MIT | pushed 2026-05-04, 63★, 44 open issues | Next.js |
| **mermaid-reactflow-editor** (`albingcj`) | flowchart (+ subgraphs) | Inbound only (Mermaid text → React Flow); editing does not auto-emit Mermaid | MIT | pushed 2026-07-25, 59★ | Vite/React |
| **mermaid-live-editor** (`mermaid-js`) | many | Text only (not a visual editor) | MIT | pushed 2026-10-10, 6.9k★ | SvelteKit |
| **Mermaid Chart Visual Editor** | multiple | Yes (visual ↔ code sync) | proprietary | active product | hosted SaaS |
| **Mermaid Flow** (`mermaidflow.app`) | flowchart | n/a | closed (no public repo found) | active web service w/ pricing | hosted |

- Observed: <https://github.com/tra-sco/mermify/blob/main/README.md>;
  <https://github.com/saketkattu/mermaid-visual-editor>;
  <https://github.com/albingcj/mermaid-reactflow-editor>;
  <https://github.com/mermaid-js/mermaid-live-editor>;
  <https://mermaid.ai/products/visual-editor>; <https://www.mermaidflow.app/>.
- Maintenance facts observed via `https://api.github.com/repos/...` (retrieved 2026-10-10).

### Q5 — graph libraries (licenses + build cost)

- React Flow = **MIT, "forever"**, per the vendor:
  <https://xyflow.com/open-source>; `@xyflow/react` v12.12.0, MIT (registry). React/JSX →
  **build toolchain required**.
- JointJS core = **MPL-2.0** (repo `clientIO/joint`, 5.4k★); JointJS+ plugins are commercial:
  <https://github.com/clientIO/joint>; `@joint/core` v4.3.3, MPL-2.0 (registry).
- GoJS = **commercial, not open source**: "The GoJS library is software that is licensed
  under a commercial license agreement. It is not open-source." Free for personal
  non-commercial use since Sept 2026.
  - Observed: <https://gojs.net/latest/learn/deployment.html>.
- Cytoscape.js = **MIT** (repo `cytoscape/cytoscape.js`, 11.2k★); `cytoscape` v3.34.3, MIT.
- mxGraph = Apache-2.0, **archived 2021-03-31, EOL**: "Development on mxGraph has now
  stopped... not advised to start new projects against this codebase."
  - Observed: <https://github.com/jgraph/mxgraph>.
- **Build-toolchain flag:** React Flow (React), any React editor, Excalidraw's React
  component, mermaid-live-editor (Svelte), Mermify (React/Vite), saketkattu (Next.js) all
  require a bundler. Cytoscape.js, JointJS, mxGraph, and Mermaid itself ship UMD/plain
  scripts usable without a build step.

### Q6 — text / round-trip fidelity for flowcharts

- **Serialize graph → Mermaid text is well-supported in practice.**
  - `mermaid-ast` (MIT, v0.8.2, created 2026-01-16): "Parses all 18 diagram types supported
    by mermaid.js and renders them back to text... Full round-trip fidelity:
    `render(parse(text))` produces semantically equivalent diagrams... graph manipulation
    tools for flowcharts specifically."
    - Observed: <https://github.com/neongreen/mermaid-ast>; registry
      `https://registry.npmjs.org/mermaid-ast`.
  - The saketkattu editor's architecture is exactly this: a Zustand `{nodes[],edges[]}`
    store serialized by `lib/serializer.ts` to Mermaid syntax.
    - Observed: `saketkattu/mermaid-visual-editor` README ("Architecture").
  - `albingcj/mermaid-reactflow-editor` uses `src/utils/mermaidToReactFlow.ts` for the
    inverse (Mermaid text → graph).
    - Observed: its README.
  - Non-Mermaid-JS examples that prove the direction: Syncfusion `SaveDiagramAsMermaid`
    (flowchart/mind map; help.syncfusion.com) and LangGraph's `get_graph().draw_mermaid()`.
    - Observed (search result titles/URLs; not read in full).
- **Layout coordinates cannot be written back into Mermaid.**
  - Mermaid has no coordinate/position syntax; the layout engine assigns ranks automatically:
    "Each node in the flowchart is ultimately assigned to a rank... by the rendering engine"
    and "Links may still be made longer than the requested number of ranks by the rendering
    engine."
    - Observed: <https://mermaid.js.org/syntax/flowchart.html> (multi-directional / minimum-length).
  - A request to pin node positions (#270, opened 2015-12-15) was closed **stale** with no
    implementation; the layout is Dagre-owned.
    - Observed: <https://github.com/mermaid-js/mermaid/issues/270>.
  - Engine: **Dagre** in the vendored 11.16.0 (default); **ELK** becomes the default at
    **12.0.0** ("ELK is bundled and default from v12.0.0... replacing Dagre").
    - Observed: <https://mermaid.js.org/config/layouts.html>; local `static/vendor/mermaid.min.js`
      version string 11.16.0.
  - Dagre itself is available without a build step: `@dagrejs/dagre` v3.1.1, **MIT**
    (registry); `dagre` 0.8.5, MIT. It computes coordinates for a *custom* renderer, but
    those coordinates have nowhere to go in Mermaid text.

---

## 5. Observed vs. inferred vs. assumption

**Observed (read this run):**
- Vendored Mermaid 11.16.0 and its 3,565,102-byte size (`static/vendor/mermaid.min.js`).
- draw.io Mermaid import, embed descriptor, export format list, maintainer's declining of
  Mermaid export, Apache-2.0 LICENSE file, "not open source" maintainer statement, Docker
  self-host command.
- Excalidraw Mermaid→Excalidraw API, flowchart-only limitation, package licenses/versions/
  dates/sizes, reverse-path staleness.
- Mermaid `parse` return shape; open issue #2523; `@mermaid-js/parser` `parse()` signature;
  no coordinate syntax; Dagre→ELK default change at v12.
- Licenses: React Flow MIT, JointJS MPL-2.0, GoJS commercial, Cytoscape MIT, mxGraph
  Apache-2.0/archived, mermaid-ast MIT, all the editor repos' SPDX licenses and `pushed_at`.

**Inferred (my conclusion from the above):**
- draw.io is effectively **one-way** for Mermaid (import but not export) — inferred from the
  export-format list plus the explicit decline.
- The draw.io repo is best treated as **source-available, not open source**, even though the
  LICENSE text is Apache-2.0 — inferred from maintainer statements.
- A round-trip-capable editor integration for this app would require either an iframe
  (draw.io, no Mermaid export) or adopting a build toolchain (every open-source editor that
  round-trips).
- `mermaid-ast` is the most direct off-the-shelf primitive for graph↔Mermaid text, but it is
  very new and low-adoption.

**Assumptions (not verified):**
- That the project would not add a JS build toolchain — taken from `CLAUDE.md` ("no build
  step"). If that constraint changed, the option set changes materially.
- That a future upgrade to Mermaid 12.x is acceptable or not — unknown; the choice affects
  layout defaults and browser target (ES2024 / Safari 17.4+).

---

## 6. Open / conflicting — what would settle it

1. **`@mermaid-js/parser` coverage.** Its README shows the `parse` signature but not the
   list of supported `diagramType` keys. *Settle by:* reading
   `packages/parser/src/index.ts` / `initializers` in the mermaid repo at the tag matching
   the package version.
2. **`mermaid-ast` correctness and maturity.** It claims full round-trip for 18 types but is
   ~3 months old with 22 stars and no independent review. *Settle by:* running its test
   suite against the project's real notes, and checking its coverage of Mermaid 11.16 syntax
   (it depends on `@mermaid-js/parser`, which may lag the vendored version).
3. **draw.io license boundaries.** Exact terms for redistributing the minified Apache-2.0
   webapp vs. calling `embed.diagrams.net` are not spelled out in a single authoritative
   page. *Settle by:* legal review of the repo README + LICENSE and the embed terms.
4. **Excalidraw reverse path.** No official converter; third-party tools are stale or CLI.
   *Settle by:* tracking issue #11187, or evaluating `sindrel/excalidraw-converter` against
   real scenes.
5. **Whether a self-hosted draw.io embed can be configured to emit Mermaid.** All evidence
   says no (no export format, maintainer declined). *Settle by:* checking the draw.io source
   for any hidden Mermaid serializer — not currently published, which is itself the blocker.

---

## 7. Recommendation (for the decision owner)

This section states what the evidence supports, not a choice.

- If the goal requires **round-tripping existing Mermaid text** (edit visually, write Mermaid
  back), the evidence shows **no no-build-step option that does this**:
  - draw.io imports but does not export Mermaid;
  - every open-source editor that round-trips (Mermify, the Excalidraw stack) requires a
    build toolchain;
  - the official/commercial Mermaid Chart Visual Editor does round-trip but is a hosted
    product.
- If the goal tolerates a **one-way import** (Mermaid in → edit as draw.io shapes → store
  XML, not Mermaid), the **draw.io iframe embed / self-host Docker** is the only
  license-compatible, maintained, no-build-step path — with the caveat that the repo is
  source-available, not open source, and the Mermaid source is preserved only inside draw.io
  XML/group metadata.
- If the goal is a **custom editor in this app**, the evidence-supported primitives are:
  a graph layer (Cytoscape.js or JointJS core, both no-build-step), `mermaid` (already
  vendored) for rendering, and `mermaid-ast` (or hand-rolled serialization) for
  text↔graph — with `@dagrejs/dagre` for layout. **Coordinates cannot be persisted in
  Mermaid text**, so any manual positioning would have to live in a sidecar format, not in
  the note.

*Citations are inline; every external URL was fetched this run except the two marked
"search result; not read in full" (Syncfusion, LangGraph) and the Excalidraw issue #11187
title.*
