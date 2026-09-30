# Build and toolchain

The notebook server has no compile step. There is one bootstrap wrapper for the
Python side and one offline-built frontend asset. This guide records both, the
vendoring model, and the service worker cache.

## `start.sh` bootstrap

`./start.sh` is the only build-like entry point. It sets up a Python virtual
environment on first run, installs the pinned dependencies, then launches the
app with the arguments it was given. It is a wrapper, not a compiler.

The flow:

1. **Resolve the project directory** from the script's own location and `cd`
   into it, so the script works from any invocation directory.
2. **Create the venv if missing.** The directory is `.venv_$(hostname)` in the
   project root. The name is host-specific, so one checkout holds a separate
   venv per machine and they do not collide.
3. **Ensure dependencies are installed.** The venv holds an `.installed` stamp
   whose contents are a copy of `requirements.txt` from the last successful
   install. If the stamp is missing, or `cmp -s requirements.txt .installed`
   reports a difference, the script runs `pip install -r requirements.txt` and
   copies `requirements.txt` onto the stamp. Otherwise it skips the install.
4. **Launch.** `exec .venv_<hostname>/bin/python app.py "$@"` replaces the shell
   so the server runs as the top process and receives every forwarded flag
   (e.g. `--debug`, `--host`, `--port`).

`requirements.txt` pins two dependencies:

```
Flask==3.0.3
bcrypt==5.0.0
```

The stamp is content-based, not timestamp-based, so editing `requirements.txt`
triggers a reinstall; touching it without changing its contents does not.

## Vendoring model

The runtime frontend loads everything as plain `<script defer>` tags from
`static/`. There is no bundler for the app code (the 29 `static/js/` modules)
and no CDN: every third-party library is committed under `static/vendor/`.

Most vendor files are direct, byte-for-byte copies of an upstream distribution
with no local editing:

- `mermaid.min.js` is **byte-identical** to
  `node_modules/mermaid/dist/mermaid.min.js` (verified with `cmp`; both are
  `md5 1dd12fadbfa258c3ac600e9e7f1d6a3d`). The `mermaid` dependency in
  `package.json` exists to source this copy.
- `marked.min.js`, `highlight.min.js`, the `turndown*.js` pair,
  `paged.polyfill.min.js`, `viz.js` / `viz.full.js`,
  `wavedrom.unpkg.min.js`, and the `katex/` folder (JS, CSS, and woff2 fonts)
  are direct upstream distributions.

To bump one of these, replace the file with the new upstream copy. There is no
regeneration script and no checksum manifest; correctness is by inspection and
by the test suite loading the file.

### The one built artifact: `codemirror.bundle.js`

`static/vendor/codemirror.bundle.js` (738,740 bytes) is the only file that is
not a copy. It is a single esbuild IIFE, built **offline**, that exposes
`window.CM6` — a flat object of the CodeMirror 6 named exports.

Its source is `static/vendor/codemirror.entry.js`, which re-exports the public
surface the app uses. The exact dependency set it pulls in:

- `codemirror` — `EditorView`, `basicSetup`
- `@codemirror/state` — `EditorState`, `Compartment`, `Prec`
- `@codemirror/view` — `keymap`, `ViewPlugin`, `Decoration`, `drawSelection`,
  `lineNumbers`, `highlightActiveLine`, `ViewUpdate`
- `@codemirror/commands` — `indentWithTab`, `history`, `defaultKeymap`,
  `historyKeymap`, `undo`, `redo`
- `@codemirror/lang-markdown` — `markdown`
- `@codemirror/search` — `searchKeymap`, `highlightSelectionMatches`,
  `SearchQuery`, `setSearchQuery`, `findNext`, `findPrevious`,
  `getSearchQuery`, `openSearchPanel`, `closeSearchPanel`, `search`
- `@codemirror/language` — `indentOnInput`, `bracketMatching`, `foldGutter`,
  `foldKeymap`, `syntaxHighlighting`, `defaultHighlightStyle`, `HighlightStyle`,
  `StreamLanguage`, `StringStream`, `LanguageSupport`
- `@replit/codemirror-vim` — `vim`, `Vim`, `getCM`, `CodeMirror`

**No script in the repository regenerates this bundle, and the exact esbuild
invocation is not recorded anywhere** — not in `package.json`, not in
`codemirror.entry.js`, not in any build file, and not in the git history of the
bundle (which was committed as a finished file in the commit that added VIM
mode). The output is a minified IIFE with no sourcemap comment. The output form
is consistent with esbuild's IIFE format, so the invocation was almost
certainly something equivalent to:

```bash
node_modules/.bin/esbuild static/vendor/codemirror.entry.js \
  --bundle --format=iife --minify --outfile=static/vendor/codemirror.bundle.js
```

That command is a reconstruction, not a recorded fact. Confirm it against the
committed bundle before relying on it. Anyone bumping any `@codemirror/*`
package, `@replit/codemirror-vim`, or `codemirror` itself must reconstruct the
invocation, rebuild from `codemirror.entry.js`, and rebuild byte-for-byte
reproducibly enough to review the diff. `esbuild` is pinned as a devDependency
(`^0.28.1`) for this purpose; `@codemirror/buildhelper` is present but unused.

## Service worker

`static/sw.js` is hand-maintained. It is not generated and has no build step.

**`CACHE` version.** `const CACHE = "notebook-v5"`. Bumping this string makes
every installed worker re-run `install` (re-precache the current assets) and
`activate` (delete every cache whose name is not the current `CACHE`). Bump it
whenever a precached asset changes or a file is added to `PRECACHE`. Without a
bump, an installed browser keeps serving assets from its old cache.

**`PRECACHE`.** A hand-written list of **41 entries**: the app shell (`/`), the
manifest, the favicon, the three PNG icons, the two stylesheets, the four
vendor libs needed to boot, and all 29 `static/js/` modules. The heavy
on-demand renderer bundles (Mermaid, Graphviz/Viz, CodeMirror, KaTeX, WaveDrom
— about 6.8 MB) are deliberately excluded; precaching them at install would
slow the first load. They are fetched on first use and cached on the way
through like any other asset. When adding a module, add its entry here and
bump `CACHE`.

**The three caching strategies** (all in `sw.js`):

| Strategy | Applies to | Behavior |
| --- | --- | --- |
| Network-only | any URL under `/api/` | Never reads or writes the cache. If the network fails, returns a 503 JSON `{"error": "Offline"}` body. Live data is never stale. |
| Network-first | everything else (pages and static assets) | Fetches the network first, mirrors a successful response into the cache, and falls back to the cache only when the network fails. Keeps code fresh per deploy while preserving an offline copy. |
| Install-time precache | the `PRECACHE` list | `install` calls `caches.open(CACHE).addAll(PRECACHE)`; `activate` deletes caches whose name differs from `CACHE`. |

Non-`GET` requests are passed through untouched. The history note in `sw.js`:
an earlier cache-first strategy froze assets at install time, so CSS fixes
never reached browsers with an older install; network-first replaced it.

## Release and artifact notes

There is no release pipeline. Concretely:

- **No CI.** No `.github/`, `.gitlab-ci.yml`, or other CI configuration exists.
- **No release or packaging step.** The deployable artifact is the checkout
  itself: `start.sh` plus the source tree. Nothing is compiled, zipped, or
  published by a script.
- **No SBOM.** No software bill of materials is generated or committed.
- **No version file and no changelog.**
- **No tags.** `git tag -l` is empty; there are no signed or annotated tags.

If a release artifact chain is wanted (a version bump, a changelog, a signed
annotated tag, an SBOM), it must be set up from scratch. Do not assume any of
it exists today.
