# Parse / serialize a Mermaid graph model for an in-app visual editor

Research report. Scope: can the parse↔serialize layer for a visual Mermaid
editor be delivered as a pre-bundled vendored file in `notebook-server`, which
has no runtime build step but does have `esbuild` as a devDependency?

- Date of research: 2026-10-10
- Project pins: `mermaid` `^11.16.0` (`package.json:25`), vendored bundle
  identifies itself as `11.16.0` (`static/vendor/mermaid.min.js`, grep
  `version:"11.16.0"`), `esbuild` `^0.28.1` (`package.json:20`), Node 24.21.0 /
  npm 11.19.0 in this environment.
- `mermaid` npm version pulled into `node_modules` for the runtime probes:
  `11.16.0` (`node_modules/mermaid/package.json`).

## Question

Whether a parse-into-model + serialize-back-to-Mermaid layer can be shipped as a
vendored, pre-bundled browser file, and which of the candidate routes is most
defensible. Six sub-questions were investigated: `mermaid-ast`,
`@mermaid-js/parser`, Mermaid's own runtime APIs, UMD graph canvases,
hand-rolled parsing, and a risk ranking.

## Summary of findings

1. `esbuild` **has no `umd` output format.** `--format` accepts only
   `iife | cjs | esm` (verified: `esbuild --help`, and an actual
   `--format=umd` run fails with `Invalid value "umd"`). The browser-global
   equivalent is `--format=iife --global-name=…`; a single-file ESM bundle is
   `--format=esm`. The question's premise ("`esbuild --bundle --format=umd`")
   is not a valid esbuild invocation.
2. `@mermaid-js/parser` **does not parse the graph-shaped classic diagrams**
   (flowchart, class, state, er, sequence, gantt, mindmap, timeline,
   requirement). It parses 15 other types. It bundles cleanly to a browser file.
3. `mermaid-ast` **does** parse and render those classic types, bundles cleanly
   to a browser IIFE/ESM file with esbuild, and has a test suite — but it is a
   young, dormant package with observed parse gaps (comments, `%%{init}%%`,
   edge IDs) and its vendored parsers are synced to Mermaid **11.12.2**, not the
   project's 11.16.0.
4. Mermaid 11.16.0 itself exposes `mermaid.mermaidAPI.getDiagramFromText()`,
   which returns a `Diagram` whose `.db` exposes real graph structure — but the
   API is officially annotated **`@internal` and `@deprecated`**.
5. Cytoscape.js and JointJS core both ship prebuilt UMD files; dagre ships ESM
   and is bundleable. React Flow / xyflow and Excalidraw require React and a
   build step.
6. Hand-rolling is only plausible for a narrow `flowchart` subset; the classic
   diagrams are parsed by LALR(1) JISON grammars (309–635 lines each), i.e.
   context-free, not regular.

## 1. `mermaid-ast`

### What it is (observed)

- npm: version `0.8.2`, published `2026-01-18T04:47:19Z`, licence MIT,
  `"type": "module"` (ESM-only; `exports` has `import` entries only).
  Repo `https://github.com/neongreen/mermaid-ast`
  (`npm view mermaid-ast version license type exports time repository.url`,
  registry.npmjs.org, read 2026-10-10).
- Public API from the shipped type declarations
  (`dist/index.d.ts` in `mermaid-ast-0.8.2.tgz`):
  - parse a string to a model: `parse(text)`, `parseAsync(text)`, plus
    per-type `parseFlowchart`, `parseSequence`, `parseClassDiagram`,
    `parseStateDiagram`, `parseErDiagram`, `parseGantt`, `parseGitGraph`,
    `parsePie`, `parseQuadrant`, `parseRequirement`, `parseSankey`,
    `parseBlock`, `parseC4`, `parseMindmap`, `parseTimeline`, `parseXYChart`,
    `parseJourney`, `parseKanban`; `detectDiagramType`.
  - serialize a model back to text: `render(ast)` plus per-type
    `renderFlowchart`, `renderSequence`, `renderClassDiagram`,
    `renderStateDiagram`, `renderErDiagram`, `renderGantt`, `renderGitGraph`,
    `renderPie`, `renderQuadrant`, `renderRequirement`, `renderSankey`,
    `renderBlock`, `renderC4`, `renderMindmap`, `renderTimeline`,
    `renderXYChart`.
  - wrapper classes for programmatic editing: `Flowchart`, `Sequence`,
    `ClassDiagram`, `StateDiagram`, `ErDiagram`, `Gantt`, `GitGraph`, `Pie`,
    `Quadrant`, `Requirement`, `Sankey`, `Block`, `C4`, `Mindmap`, `Timeline`,
    `XYChart`, `Journey`, `Kanban` (e.g. `Flowchart.create`, `.addNode`,
    `.addLink`, `.findNodes`, `.rebaseNodes`).
- The package README (fetched from
  `https://raw.githubusercontent.com/neongreen/mermaid-ast/main/packages/mermaid-ast/README.md`)
  states: "It uses the official mermaid.js JISON parsers to ensure
  compatibility", and "Round-trip guarantee: `render(parse(text))` produces
  semantically equivalent diagrams".

### Diagram types actually supported (observed)

The README table has **18 rows** (Flowchart, Sequence, Class, State, ER, Gantt,
Mindmap, Journey, Timeline, Sankey, Quadrant, XY Chart, Kanban, Requirement,
Block, Pie, Git Graph, C4). This matches the shipped distribution exactly: the
tarball's `dist/` contains 18 parser modules and 18 renderer modules
(`dist/parser/*.js`, `dist/renderer/*.js`). So the "18" claim is verified from
the artifact, but note it is *not* the full Mermaid 11.16 set — architecture,
packet, radar, treemap, treeView, wardley, cynefin, eventmodeling, venn,
ishikawa, swimlanes and zenuml are absent.

### Runtime dependencies and browser compatibility (observed)

- Runtime dependency is only `@mermaid-js/parser` `^0.6.3`
  (`npm view`, and `dist/vendored/sync-info.json` shows the parsers are synced
  to `mermaidVersion: 11.12.2`; `dist/vendored/VERSION` = `mermaid@11.12.2`).
- `@mermaid-js/parser@0.6.3` itself depends on `langium@3.3.1`
  (`npm view @mermaid-js/parser@0.6.3 dependencies`), which pulls chevrotain and
  a large `vscode-languageserver-*` tree (installed tree in
  `/tmp/opencode/bundle_ast/node_modules`). This dependency is only used for
  **pie** and **gitGraph**; the classic types use the vendored JISON parsers
  (`dist/parser/flowchart-parser.js` imports from
  `../vendored/parsers/flowchart.js`; only `pie-parser.js`, `gitgraph-parser.js`,
  `types/pie.js` and `parser/index.js` reference `@mermaid-js/parser`).
- `package.json` `engines: { node: ">=18.0.0" }`; README claims "Works in Bun,
  Node.js, and Deno" — it does **not** claim browser support.

### Can it be pre-bundled for the browser? (observed)

Using the project's own `esbuild` 0.28.1:

```
esbuild entry.js --bundle --format=iife --global-name=MMA --platform=browser
  → out.iife.js 1.78 MB, no errors
esbuild entry.js --bundle --format=esm  --platform=browser
  → ast.esm.mjs 1.72 MB, no errors
```

Functional round-trip of `render(parse(text))` on the ESM bundle succeeded and
was idempotent for: flowchart, classDiagram, stateDiagram, erDiagram,
sequenceDiagram, gantt. `pie` threw a deliberate error ("Pie diagrams use an
async parser. Use `Pie.parse()` or `parseAsync()` instead.").

Bundle caveat (observed): the emitted bundle contains a Node `path`-style branch
that calls `process.cwd()` when invoked with no argument
(`void 0 === t3 && (t3 = process.cwd())`, offset ~741382 of `ast.esm.mjs`), plus
`process.platform` guarded by `"object" == typeof process` (offset ~747890).
`createRequire` was a false positive (the token was `createRequirementYY`). The
`process.cwd()` branch is guarded only against a missing *argument*, not against
a missing `process`, so a browser could throw if that code path runs. Whether
that path is reached in a real browser was **not** verified here (Node always
provides `process`). This is the main residual browser risk for this option.

### Observed parse/fidelity gaps (reproduced)

Against the bundled `mermaid-ast` 0.8.2:

| Input | Result |
| --- | --- |
| `flowchart LR\nA --> B\n` | OK |
| `flowchart LR\n%% hello\nA --> B\n` | **FAIL** — "Failed to parse flowchart: Parse error on line 2" |
| `flowchart LR\n  %% hello\nA --> B\n` | **FAIL** (same) |
| `%%{init: {"theme":"dark"}}%%\nflowchart LR\nA --> B\n` | **FAIL** — "Unable to detect diagram type" |
| `flowchart LR\n  A e1@-->|yes| B\n` | parses, but renders as `A -->|yes| B` (edge id `e1` **dropped**) |
| `flowchart LR\nA-->B-->C`, `A & B --> C`, subgraph, `classDef`+`style`, class members+`note`, state `[*]`+`note`, er attributes+cardinality, gantt sections | OK and idempotent |

Cross-check: Mermaid 11.16.0 itself parses `%% hello` comments fine
(`mermaid.parse` + `getDiagramFromText` under jsdom). So the comment failure is a
`mermaid-ast` parser limitation, not a Mermaid syntax error. (Note: the
`e1@-->` edge-id probe `flowchart LR\n e1@--> B` fails in Mermaid 11.16 too,
because no source node is given; the valid form is `A e1@--> B`, which Mermaid
parses but `mermaid-ast` renders without the id.)

### Maturity / maintenance (observed)

- All 13 versions were published inside ~31 hours on 2026-01-16/17/18
  (`npm view mermaid-ast time`).
- GitHub repo created `2026-01-16`, last push `2026-03-27`, `stargazers 22`,
  `forks 3`, `open_issues 2`, MIT, not archived (GitHub API, read 2026-10-10).
  So: ~9 months since the last release, ~6.5 months since the last push, one
  maintainer, small adoption.
- Test suite exists: `tests/{unit,roundtrip,compatibility,cross-runtime,golden,fixtures}`
  in the repo (`package.json` scripts `test`, `test:unit`, `test:roundtrip`,
  `test:compatibility`; README documents idempotence fixture counts per type).

## 2. `@mermaid-js/parser`

### Signature and supported types (observed)

- npm: current `2.0.1` (published `2026-10-02`), MIT, `"type": "module"`,
  ESM-only, `engines: node >=22.12.0`; repo
  `https://github.com/mermaid-js/mermaid` under `packages/parser`
  (`npm view @mermaid-js/parser version license type engines repository.url`).
- The package README declares:

  ```ts
  declare function parse<T extends DiagramAST>(
    diagramType: keyof typeof initializers,
    text: string
  ): T;
  ```

  The shipped declaration is overloaded and returns a **Promise**:
  `export declare function parse(diagramType: 'pie', text: string): Promise<Pie>`, etc.
  (`dist/src/index.d.ts`).
- **Supported `diagramType` keys** (15): `architecture`, `cynefin`,
  `eventmodeling`, `gitGraph`, `info`, `packet`, `pie`, `radar`, `railroad`,
  `railroadAbnf`, `railroadEbnf`, `railroadPeg`, `treemap`, `treeView`,
  `wardley`. This list is identical in `2.0.1` and in `1.2.1` — the version
  range `mermaid@11.16.0` actually depends on (`npm view mermaid@11.16.0
  dependencies` → `@mermaid-js/parser: ^1.2.0`).
- **Functional confirmation** (bundled 2.0.1, called with `parse(type, text)`):

  | Type | Result |
  | --- | --- |
  | pie, gitGraph, info | OK (`$type` returned) |
  | flowchart, classDiagram, stateDiagram, erDiagram, sequenceDiagram, gantt, requirementDiagram, mindmap, timeline | **FAIL — "Unknown diagram type: …"** |

  So the direct answer: it handles **pie** (and gitGraph), but **not** flowchart,
  class, state, erDiagram, sequence or gantt. Those remain JISON-parsed inside
  mermaid core.

### Dependencies and browser-bundleability (observed)

- Dependency history changed materially:
  - `0.6.3` → `langium@3.3.1` (Node-oriented parser framework).
  - `1.0.0` → `langium@^4.0.0`.
  - `1.2.0` / `1.2.1` / `2.0.0` → only `@chevrotain/types` (a types-only
    package); `2.0.1` → `@chevrotain/types ~13.2.0`. `chevrotain` and `langium`
    are now **devDependencies** only (`package.json` in the tarball), and
    `dist/` chunks import only relative `./chunks/...` paths and dynamic
    `import("./chunks/...")` — no runtime bare imports and no Node builtins. The
    earlier `from 'langium'` / `from 'path'` hits were in `.map` source-map
    files, not the executable `.mjs`.
- Bundle test with esbuild 0.28.1, `--platform=browser`, no chevrotain/langium
  installed (only `@mermaid-js/parser` + esbuild):
  - `2.0.1`: IIFE `1.30 MB`, ESM `1.32 MB`, no errors.
  - `1.2.1`: IIFE `1.49 MB`, no errors.
  So it is ESM-only but browser-bundleable.
- AST stability: the output is a Langium-generated, fully-typed AST exported
  through a large auto-generated `index.d.ts` (`api-extractor`). It is typed,
  but the package is internal to Mermaid and, more importantly, does not cover
  the graph-shaped types an editor would target.

## 3. Mermaid's own APIs in the vendored 11.16.0

### Exposed API (observed)

- The vendored `static/vendor/mermaid.min.js` is Mermaid `11.16.0`. It exposes
  `mermaid.mermaidAPI` (`xd = { startOnLoad:!0, mermaidAPI:Pp, parse:…, render:…, init:…, run:… }`),
  and `mermaidAPI` is a frozen object containing
  `{ render, parse, getDiagramFromText, initialize, getConfig, … }`.
- There is **no plain `getDiagram`**; only `getDiagramFromText`.
- Source at tag `mermaid@11.16.0`, `packages/mermaid/src/mermaidAPI.ts`:
  - line 635: `const getDiagramFromText = (text: string, metadata: Pick<DiagramMetadata,'title'> = {}) => { … return Diagram.fromText(code, metadata); }`
  - line 659: `/** @internal - Use mermaid.function instead of mermaid.mermaidAPI.function */`
  - line 661: `export const mermaidAPI = Object.freeze({ … getDiagramFromText, … });`
  - line 427: `render` is marked `@deprecated - use the mermaid.render function instead`.
- Source `packages/mermaid/src/mermaid.ts` lines 433–440: the `Mermaid`
  interface's `mermaidAPI` member is annotated
  `@deprecated Use parse and render instead … @internal`.
- The generated public API docs
  (`https://mermaid.ai/open-source/config/setup/mermaid/interfaces/Mermaid.html`)
  likewise list `mermaidAPI` as **`Internal`** and **Deprecated**, and document
  `getDiagramFromText: (text, metadata) => Promise<Diagram>`.
- The current user-facing usage doc
  (`https://mermaid.js.org/config/usage.html`) documents only
  `render`, `run`, `parse`, `detectType` — it does **not** document `mermaidAPI`
  or `getDiagramFromText`.

### Does it expose graph structure? (observed, empirically)

Loaded `node_modules/mermaid` 11.16.0 under jsdom, called
`await mermaid.mermaidAPI.getDiagramFromText(text)`. Result: a `Diagram` with
keys `['type','text','db','parser','renderer']`. `db` accessors per type:

| Diagram | `d.type` | useful `db` methods |
| --- | --- | --- |
| flowchart | `flowchart-v2` | `getData()`, `getVertices()`, `getEdges()`, `getClasses()`, `getSubGraphs()` (+ `direction`) |
| class | `class` | `getClasses()`, `getRelations()`, `getData()` |
| state | `stateDiagram` | `getClasses()`, `getStates()`, `getRelations()`, `getData()` |
| er | `er` | `getClasses()`, `getEntities()`, `getData()` |
| sequence | `sequence` | `getMessages()`, `getActors()` |
| pie | `pie` | `getSections()` |

Flowchart shape observed for
`flowchart LR\n A[Start] --> B{Choice}\n B -->|yes| C[End]\n subgraph S1\n D --> E\n end`:

- `db.getVertices()` → a `Map` keyed by id:
  `["A", { id:"A", labelType:"text", domId:"flowchart-A-0", styles:[], classes:[], text:"Start", type:"square", props:{} }]`, and
  `B` is `type:"diamond"`, etc.
- `db.getEdges()` → `[{ start:"A", end:"B", type:"arrow_point", text:"", labelType:"text", classes:[], stroke:"normal", length:1, id:"L_A_B_0" }, …]`.
- `db.getData()` → normalized `{ nodes: [{ id, label, shape, isGroup, … }], edges: […] }`,
  where subgraph `S1` appears as a node with `isGroup:true`, and
  `db.getSubGraphs()` → `[{ id:"S1", nodes:["E","D"], title:"S1", … }]`.

So at runtime the graph model **is** readable for flowchart (nodes, labels,
shapes, edges, edge labels, subgraphs, direction), and other types expose their
own `getX`/`getData` accessors. But this is an undocumented, internal,
deprecated surface: no stability guarantee, and no serializer back to text.

## 4. Graph canvases usable without a runtime build step

| Package | Version | License | Ships prebuilt UMD? | Unpacked size | Notes |
| --- | --- | --- | --- | --- | --- |
| `cytoscape` | 3.34.3 | MIT | **Yes** — `dist/cytoscape.umd.js` (1.18 MB) and `dist/cytoscape.min.js`; exports listed (`npm view cytoscape exports`) | 5.70 MB | UMD header confirmed (Copyright Cytoscape Consortium, 2016-2026) |
| `@joint/core` | 4.3.3 | **MPL-2.0** | **Yes** — `main` = `./dist/joint.min.js`, a UMD bundle (header shows `exports` / `define.amd` branches) | 6.23 MB | Licence is file-level copyleft, **not** MIT; `module` = `dist/joint.js` |
| `@dagrejs/dagre` | 3.1.1 | MIT | No UMD build, but ships ESM `dagre.esm.js`, CJS, and `dagre.{js,min.js}`; pure JS, esbuild-bundleable | 1.41 MB | A **layout engine**, not a canvas renderer; depends on `@dagrejs/graphlib` |
| `@xyflow/react` | 12.12.0 | MIT | UMD/CJS/ESM present, **but** peers `react >=17`, `react-dom >=17` | 1.22 MB | Requires React ⇒ build step + React runtime |
| `reactflow` (legacy) | 11.11.4 | MIT | UMD present, peers `react/react-dom >=17` | 0.18 MB | Same constraint |
| `@excalidraw/excalidraw` | 0.18.1 | MIT | ESM-only prod bundle (`dist/prod/index.js`), peers `react`/`react-dom` | 46.80 MB | Requires React + build step; depends on `@excalidraw/mermaid-to-excalidraw@2.2.2` (prior art for mermaid→diagram conversion) |

Cytoscape.js and JointJS core are the two that ship a ready-to-vendor UMD file
(no build step). Dagre is a layout engine you would compose with a renderer.

## 5. Hand-rolling the parse layer

### flowchart (evidence)

The flowchart syntax doc
(`https://mermaid.js.org/syntax/flowchart.html`, page version 12.1.0) shows it is
larger than a regular grammar. Constructs a hand-rolled tokenizer must handle:

- Node/edge basics, but also **30+ named shapes** via the general
  `A@{ shape: rect }` form (v11.3.0+) in addition to the legacy bracket syntaxes.
- Direction statements (`TB/TD/BT/RL/LR`), including inside subgraphs.
- Link variants: arrow/open/dotted/thick/invisible, `--x` / `--o` / `<-->`
  multidirectional, length modifiers (`---`, `----`, …; `===`; `-.->`), and the
  first-letter `o`/`x` gotcha (a space or capital is required).
- Labels: `-->|text|` and the `-- text -->` form; markdown strings in backticks;
  quoted strings for special characters; entity codes.
- **Chained links** `A-->B-->C` and **`&` multi-node links** `A & B --> C`.
- **Subgraphs** (nested, explicit ids, direction, edges to/from subgraphs).
- Styling: `classDef`, `class`, `style`, `linkStyle`, edge IDs `e1@-->` and
  `e1@{ animate: true }`.
- **Comments `%%`** and **directives `%%{init: …}%%`**, plus the `end`-keyword
  and `o`/`x` gotchas.

### class / state / er (evidence)

Mermaid 11.16.0 parses these with **JISON (LALR(1)) grammars**, not a regular
expression: `packages/mermaid/src/diagrams/…` contains `flowchart/parser/flow.jison`
(635 lines), `class/parser/classDiagram.jison` (440), `state/parser/stateDiagram.jison`
(352), `er/parser/erDiagram.jison` (309) at tag `mermaid@11.16.0`. These are
context-free grammars with lookahead, quoting/escape rules, and (for state)
indentation-sensitivity. `mermaid-ast`'s own choice — vendoring these `.jison`
files rather than hand-rolling (`dist/vendored/grammars/*.jison`) — is further
evidence that hand-rolling is a re-implementation of a CFG, not a tokenizer.

Conclusion: a hand-rolled parser is realistic only for a deliberately restricted
`flowchart` subset (simple `id[text]` nodes, `-->`/`---`/`-.->`/`==>` edges with
optional `|label|`, no comments/directives/subgraphs/edge-ids). Extending it to
class/state/er means reproducing a real parser.

## 6. Risk ranking

| Option | (a) Browser-prebundle without build step | (b) Syntax coverage of Mermaid 11.16 graph types | (c) Maturity / maintenance | (d) Round-trip fidelity risk |
| --- | --- | --- | --- | --- |
| **`mermaid-ast` vendored** (bundled once with esbuild, shipped as IIFE) | **Good** — bundles to 1.78 MB IIFE / 1.72 MB ESM, no errors; residual `process.cwd()` path unverified in a real browser | **Good for the classic set** — parses+renders flowchart/class/state/er/sequence/gantt; but parsers synced to **11.12.2**, missing newer 11.16 syntax, and lacks architecture/radar/etc. | **Low** — 0.8.2, one maintainer, last push 2026-03-27, 22 stars | **Medium** — has a round-trip test suite, but observed gaps: `%%` comments fail, `%%{init}%%` fails detection, edge IDs dropped |
| **`@mermaid-js/parser` vendored** | **Good** — bundles to ~1.3 MB, self-contained, no Node builtins | **Poor for the editor's need** — does **not** parse flowchart/class/state/er/sequence/gantt; only 15 other types | **Good** — first-party Mermaid package, active (`2.0.1`, 2026-10-02) | **N/A** — parse-only; no serializer; classic types unsupported |
| **Mermaid 11.16 `getDiagramFromText` (no bundle)** | **None needed** — already loaded as `window.mermaid` | **Excellent (11.16-exact)** to read structure | Internal/deprecated; version-locked to the vendored 11.16.0 | **High** — parse-only (`db` accessors are internal); serializer must be written by hand |
| **Hand-rolled per-type** | **Excellent** — plain JS | **Poor→Fair** — only a restricted flowchart subset is realistic; class/state/er need a real parser | Fully in-repo control, but ongoing maintenance against Mermaid syntax drift | **High** — every syntax feature (comments, `&`, subgraphs, shapes, directives) is a new failure mode |

### Most defensible primitive (on the evidence)

For an editor that must **both** parse a Mermaid string to a model and
serialize it back, `mermaid-ast` vendored as a single pre-bundled file is the
only candidate that has all of: coverage of the graph-shaped types, an actual
serializer, a test suite, and a clean esbuild browser bundle. Its costs are the
low maturity (0.8.2, dormant), the 11.12.2 parser sync versus the project's
11.16.0, the unverified `process.cwd()` browser path, and specific fidelity
gaps (comments, directives, edge IDs). `@mermaid-js/parser` is better maintained
but is the wrong tool for the graph types. Mermaid's own `getDiagramFromText`
gives exact-version structure but is internal/deprecated and parse-only.

The final choice (and whether to restrict the editor to a subset of diagram
types to reduce fidelity risk) belongs to `plan` / `architect` / the user.

## Observed vs inferred

- **Observed (read directly):** all npm metadata (`npm view`); tarball contents
  and `package.json`/`index.d.ts`; esbuild version and format options; the
  actual esbuild bundle runs and their byte sizes; the actual `mermaid-ast`
  round-trip and edge-case results; the `@mermaid-js/parser` per-type results;
  the vendored bundle version string and API symbols; the Mermaid v11.16.0
  source lines (`mermaid.ts`, `mermaidAPI.ts`) and jison line counts; the
  jsdom `getDiagramFromText` output shapes; graph-library dist file listings and
  UMD headers; GitHub repo/commit metadata; the mermaid and Mermaid docs pages.
- **Inferred:** that `mermaid.mermaidAPI.getDiagramFromText` is unsafe to depend
  on because it is annotated internal/deprecated (the annotation is observed; the
  consequence is an inference); that the `process.cwd()` branch in the
  `mermaid-ast` bundle may throw in a browser (the branch is observed; whether
  the code path executes in a browser is not verified); that `mermaid-ast`'s
  comment failure is a parser limitation rather than a Mermaid syntax error
  (based on Mermaid 11.16 parsing the same input, but the root cause inside
  `mermaid-ast` was not traced).
- **Assumed:** none material to the findings.

## Open / conflicting

- **Browser execution of the `mermaid-ast` bundle** was tested under Node (which
  provides `process`), not a real browser. A Chromium run with `process`
  undefined would settle whether the `process.cwd()` path is reachable. What
  would settle it: load the pre-built IIFE in a browser/jsdom-without-process
  context and parse a diagram.
- **Whether `mermaid-ast`'s gaps are general or input-specific** — comments,
  directives and edge-ID loss were each reproduced once. What would settle it:
  run the package's own `tests/roundtrip` fixtures against the vendored
  Mermaid 11.16.0 corpus.
- **Version skew** — `mermaid-ast` bundles Mermaid 11.12.2 parsers while the
  project renders with Mermaid 11.16.0. A diagram accepted by the editor's
  vendored 11.16 renderer could be rejected by the 11.12.2 parser (or vice
  versa). What would settle it: a differential corpus test between the two.
- **`@mermaid-js/parser` d.ts returns `Promise`** while the README shows a
  synchronous signature; the README is stale relative to the shipped types. The
  runtime behaviour (Promise) was confirmed functionally.
- **Docs version** — the Mermaid docs pages fetched are served at version
  12.1.0 (current), whereas the project vendors 11.16.0; syntax noted here
  (e.g. collapsible subgraphs v11.17) may post-date the project's version. The
  source citations are pinned to tag `mermaid@11.16.0`.

## Recommendation (evidence-bounded)

- Deliver the parse/serialize layer as a **one-time esbuild bundle vendored into
  `static/vendor/`**, produced with `--format=iife` (global) or `--format=esm`,
  because esbuild has no `umd` format. This satisfies "no runtime build step".
- If the editor must support the graph-shaped types (flowchart/class/state/er/
  sequence/gantt), the evidence supports evaluating **`mermaid-ast`** as the
  primitive — with explicit acceptance of its maturity, its 11.12.2 parser sync,
  and its observed gaps.
- Do not rely on `@mermaid-js/parser` for those types, and do not build on
  Mermaid's internal `getDiagramFromText` without accepting it is deprecated and
  internal (it is, however, the only route that reads the structure with exact
  11.16.0 fidelity, and could serve as a read-only validation cross-check).
- Restricting the editor to a diagram subset, and the final selection between
  these routes, is a decision for `plan` / `architect` / the user.

## Sources

External (read 2026-10-10):

- npm registry metadata via `npm view` / `npm pack` for: `mermaid-ast@0.8.2`,
  `@mermaid-js/parser@{0.6.3,1.0.0,1.2.0,1.2.1,2.0.0,2.0.1}`, `mermaid@11.16.0`,
  `cytoscape@3.34.3`, `@joint/core@4.3.3`, `@dagrejs/dagre@3.1.1`,
  `@xyflow/react@12.12.0`, `reactflow@11.11.4`, `@excalidraw/excalidraw@0.18.1`.
- `mermaid-ast` package README:
  `https://raw.githubusercontent.com/neongreen/mermaid-ast/main/packages/mermaid-ast/README.md`
- `mermaid-ast` GitHub repo + commits: `https://api.github.com/repos/neongreen/mermaid-ast`
- Mermaid v11.16.0 source:
  `https://raw.githubusercontent.com/mermaid-js/mermaid/mermaid@11.16.0/packages/mermaid/src/mermaid.ts`
  (lines 433–440) and `…/src/mermaidAPI.ts` (lines 427, 635, 659–661).
- Mermaid classic jison grammars at tag `mermaid@11.16.0`:
  `packages/mermaid/src/diagrams/{flowchart/parser/flow,class/parser/classDiagram,state/parser/stateDiagram,er/parser/erDiagram}.jison`.
- Mermaid docs — usage: `https://mermaid.js.org/config/usage.html`
  (documents `render`/`run`/`parse`/`detectType`).
- Mermaid public interface docs — `Mermaid.mermaidAPI`:
  `https://mermaid.ai/open-source/config/setup/mermaid/interfaces/Mermaid.html`
  (labels `mermaidAPI` Internal + Deprecated; `getDiagramFromText → Promise<Diagram>`).
- Mermaid flowchart syntax: `https://mermaid.js.org/syntax/flowchart.html`.

Local:

- `package.json:20` (`esbuild`), `package.json:25` (`mermaid ^11.16.0`).
- `static/vendor/mermaid.min.js` — version string `11.16.0`; `mermaidAPI` /
  `getDiagramFromText` symbols present.
- `node_modules/mermaid/package.json` — `version: 11.16.0`.
- Runtime probes (Node 24.21.0 + `esbuild` 0.28.1): bundles under
  `/tmp/opencode/bundle_ast`, `/tmp/opencode/bundle_parser21`,
  `/tmp/opencode/bundle_parser12`; jsdom probes against
  `node_modules/mermaid` 11.16.0.
