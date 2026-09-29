# PLAN — Hybrid (WYSIWYG) reliability

Status: approved 2026-09-27. Owner: `build`.

## Goal

Hybrid mode must never lose the user's words or formats, must never reformat a
block the user did not touch, and must never write HTML into a Markdown file.

## The decision

**Option A: the Markdown file is the document; the DOM is a view of the region
being edited.**

On save, untouched source regions are preserved byte-for-byte; only blocks the
user edited are re-serialized. Output is always plain Markdown — never HTML
tags. A session with no edits writes nothing.

The model: the words are the content and the format is a property of those
words. `## Commands` is the text "Commands" with the h2 format applied. An
empty `###` is an h3 block with zero words; `` ### `   ` `` is an h3 block
containing a code-formatted run of three spaces. Both are valid content.

## Failure that motivated this

The note

```
## Commands

###

### `   `
```

loses the empty `###` and the contents of `` ### `   ` `` on save.

## Verified findings

Reproduced against the vendored bundles (`marked` v12.0.2, `turndown` v7.2.0,
`turndown-plugin-gfm` v1.0.2) unless noted.

| # | Finding | Evidence |
|---|---------|----------|
| 1 | `domToMarkdown()` regenerates the whole file from the DOM | `static/js/hybrid.js:144-213` |
| 2 | `isBlank` + `blankRule` run before added rules, so no `addRule` can see a blank heading | `static/vendor/turndown.browser.js:390`, `:664-671` |
| 3 | `collapseWhitespace` normalizes and then deletes whitespace-only text nodes before any rule runs, so the spaces in `` `   ` `` are unrecoverable by serialization | `static/vendor/turndown.browser.js:458-489` |
| 4 | Any heading with `!textContent.trim()` is flattened to `###` | `static/js/hybrid.js:179-183` |
| 5 | `children` skips text and comment nodes, so comments have no seat in a block walk | repro: `children: P,P` vs `childNodes: P,#text,#comment,#text,P` |
| 6 | A headerless table is the one path that emits raw HTML | turndown-plugin-gfm `keep`; repro |
| 7 | Undo/redo replace `innerHTML` wholesale, so node identity is unstable | `static/js/hybrid.js:1968`, `:1992` |
| 8 | External change re-renders without rebasing the source | `static/js/hybrid.js:3282-3299` |
| 9 | Save-without-dirty still POSTs; only autosave guards on `dirty` | `static/js/hybrid.js:2385`, `:2419`, `:2449` vs `:2064` |
| 10 | `domToMarkdown` is called at 48 sites in the DOM test suite | `tests/dom/test_dom.js` |

## Architecture

### Segment model

At `enter()`, keep the file source `S0` as the base and build an ordered
`segments[]` by walking marked's top-level tokens and the rendered
`#viewer-content.childNodes` in parallel:

- `block` — heading, paragraph, list, table, fence, blockquote, hr; one
  top-level element.
- `gap` — `space` tokens (blank-line runs); no node; raw kept.
- `raw` — `html` tokens (comments, raw HTML); comment node; raw kept.

Each segment holds `{kind, raw, start, end, node, hash}`.

`hash` is a normalized content hash computed **after** all enter-time
normalization (`enableCheckboxes`, `addListPlaceholders`, `flattenTheads`,
`markAtomicBlocks` at `static/js/hybrid.js:2235-2247`), with app chrome stripped
(`.code-copy-btn`, `data-hybrid-*`, `contenteditable`, heading `id`) and
`input.checked` included explicitly — HTML comparison cannot see it.

### Change detection

Content hash, never node identity. This survives undo/redo and external
re-render and catches checkbox toggles. Do not compare serialized markdown to
`raw`: `bulletListMarker: "-"` and `headingStyle: "atx"` would mark every `* a`
and setext block changed and canonicalize the whole file.

### Save algorithm

```
for each segment in segments:
  node present, hash unchanged -> emit raw
  node present, hash changed   -> emit serialize(node)
  kind is gap or raw           -> emit raw
  node gone                    -> drop
for each current node not matched -> emit serialize(node)
```

Gap ownership: a blank-line run belongs to the preceding block; a new node is
inserted after the block before it with the named constant
`SEGMENT_SEPARATOR` (`"\n\n"`). Split/merge: when one DOM node spans two source
blocks, the whole region is treated as changed and the original raws are
dropped.

### Format-driven serialization

A serializer for edited blocks where every element emits by its format, not its
`textContent`:

- empty `h3` -> `###`
- `<h3><code>   </code></h3>` -> `` ### `   ` ``
- empty `li` -> `-`
- whitespace-only heading -> preserved

The whitespace-only inline `<code>` case uses a private-use placeholder swap,
because Turndown deletes the spaces before any rule runs (finding 3).
`NB.blocks.restoreForMarkdown` (`static/js/blocks.js:144-158`) keeps owning
plugin fences.

Output boundary guard: assert no `<tag>` at line start outside a fence; close
the headerless-table path so a table serializes as GFM or is refused, never
`<table>`.

### No-op is a non-write

Compare the spliced result to `S0`. If equal, skip `doSave` in every caller:
`save`, `onClose`, `onSaveExit`, `commitForTabSwitch`, `flushAutosave`
(`static/js/hybrid.js:2385`, `:2403`, `:2419`, `:2449`, `:2068`).

## Implementation order

| Step | Work | Owner | Risk |
|------|------|-------|------|
| 1 | Format-driven serialization fix in `domToMarkdown`; keep the signature (48 test call sites) | `web-engineer` | Low |
| 2 | Write-skip guard when spliced output equals `S0`, in all five callers | `web-engineer` | Low |
| 3 | No-HTML boundary guard; close the headerless-table path | `web-engineer` | Low |
| 4 | Segment model + content-hash detection + splice behind the same contract | `architect` then `web-engineer` | High |
| 5 | Rebase on external change; undo/redo invalidation | `web-engineer` | Medium |
| 6 | Corpus + mutation tests; run both suites | `tester` | — |

Steps 1-3 are independently shippable and stop the reported data loss. Step 4
is the Option A core.

## Verification

Browser/JS change; nothing runs on target. Verify on the host.

- Round-trip corpus (byte-identity, no edit): `###`, `` ### `   ` ``,
  `<!-- c -->`, `a\n\n\n\nb\n`, `* a`, `Title\n=====`, indented code, headerless
  table, no trailing newline.
- Mutation table: toggle a checkbox; undo once; paste multi-block; edit one
  paragraph beside a comment and a blank run.
- No-HTML: regex for `<tag>` at line start outside fences.
- No-op non-write: `fetchLog` shows zero `POST /api/file` on clean
  Save, Save+Exit, and Exit.
- Existing 48 `domToMarkdown` assertions keep passing.
- `node tests/dom/test_dom.js` and
  `.venv_$(hostname)/bin/python -m unittest discover -s tests -v`.

### Real-browser testing

jsdom has no editing engine, so it cannot exercise `contentEditable`. A real
Chromium harness drives the actual app through Playwright:
`tests/browser/test_hybrid_browser.js` (run `npm run test:browser`). It boots
Flask against a temp notebook, opens the note, enters hybrid through the real
button, edits with the native engine, and asserts the file on disk.

On NixOS the Playwright-bundled Chromium cannot start (missing shared
libraries), so the harness loads the nixpkgs Chromium via `executablePath`
(override with `CHROMIUM_PATH`).

Result at this revision: real-browser PASS (10 ok, 0 failed); DOM suite PASS
(1998 ok, 0 failed); backend suite OK (209 tests).

## Known pre-existing bug (found by the real-browser harness)

An empty heading has **zero height** in a real browser. A caret placed inside
it is redirected by the editing engine, so text typed at an empty `###` can
land in the following block. This is pre-existing (reproduced with the change
stashed) and separate from the write-back loss this plan fixes. Tracked here
for a follow-up; not part of steps 1-3.

## Assumption

An existing HTML comment in a note is preserved verbatim as untouched source
bytes. No HTML is ever generated; the passthrough keeps what is already there.

## Addressed challenger findings

| Finding | Resolution |
|---------|------------|
| C1 `addRule` unreachable | Confirmed; abandoned `addRule`; clone mutation plus source passthrough |
| C2 checkbox invisible to DOM equality | Hash includes `input.checked` |
| C3 node identity breaks on undo/re-render | Content-hash detection; rebase on external change |
| C4 gap/split/merge ownership | Segment ownership rule plus explicit tests |
| M1 enter-time normalization | Map built after normalization; chrome stripped |
| M2 no-HTML not closed | Every table rebuilt into the GFM shape; no `<table>` can be emitted |
| M3 no-op still writes | Write-skip guard in every caller |
| M4 edited block canonicalizes | Splice keeps untouched blocks; edited blocks are serialized |
| M5 unfalsifiable criteria | Corpus, mutation, `fetchLog`, and real-browser tests |
| m1 tagging leaks | Side hash, not DOM attributes |
| m2 hash cost on autosave | Equality method and cost stated; hash is the hot path |
| m3 migration ordering | Phase 1 keeps the `domToMarkdown` signature |

## Review findings resolved during implementation

| Finding | Resolution |
|---------|------------|
| Private-use placeholder corrupted real U+E000 text | Replaced with a NUL-prefixed sentinel |
| `sourceHasRawTable` whole-file flag leaked generated tables | Replaced by `normalizeTablesForGfm` |
| Lossy `rawTableToGfm` string conversion | Rebuilt on the clone; inline markup preserved |
| Empty `<table>` threw in the GFM plugin | Row-less tables removed before serialization |
| `enter()` threw on an empty table | Same fix; regression test added |
| No-op baseline went stale after an external change | `rebaseSession` on `file:external-change` |
| In-flight save rebased against the advanced DOM, dropping the typed keystroke | Baseline captured before the first await; regression test fails on the old code |
| Lazy plugin render disabled the splice | Plugin blocks hashed by fence source, not rendered subtree |
| Root-level text/comment nodes unhashed | `rootAuxCount` guard; falls closed |
| `trim()` stripped real leading/trailing whitespace | Newline-only trim in both serializer and splice |
| Duplicate plugin class lists | `PLUGIN_CONTAINER_SELECTOR` is the single source |
| Vacuous mermaid save test | Test now mutates the DOM so the write is real |

