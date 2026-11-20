# Spellcheck suggestions in a custom right-click menu (November 2026)

Research question: if the WYSIWYG contenteditable editor stops letting the
native context menu show over prose and draws its own menu instead, can the
spelling suggestions be obtained and placed inside that custom menu — and if
not, what client-side and server-side spellchecking is actually available?

Scope: browser capability facts and library/PyPI facts. No design decision is
recommended and no code was written or changed.

Grounding for this project: `static/js/hybrid.js` sets `contenteditable` on
`#viewer-content` and keeps the native menu only on plain prose via
`isPlainTextTarget()`, returning without `preventDefault()` so the browser's
suggestions show (`static/js/hybrid.js:10355-10370`, listener at
`static/js/hybrid.js:10403-10411`). That escape hatch exists because the custom
menu (`NB.menu.open`, `static/js/menu.js:184`) cannot show suggestions. Runtime
today is Chromium/Firefox on Linux; the project is NixOS with Python 3.13.17
(`.venv_nixlab`), Flask 3.0.3 (`requirements.txt:1`), CodeMirror 6 for the
source editor (`node_modules/@codemirror/view` 6.43.6, `@codemirror/lint`
6.9.7).

All sources were read directly. Dates and versions are those the source reports.
Access date for every URL below: 2026-11-20. Observations are marked
**[observed]**; conclusions drawn from them are **[inferred]**.

---

## Question 1 — Is there a Web API that exposes the browser's spellcheck results or suggestions to JavaScript?

**Finding: No. As of November 2026 there is no shipped API in any engine that
returns the misspelled word under the caret, the ranges the browser flagged, or
the suggestion list. The only spellcheck surfaces are (a) a boolean hint, (b)
a CSS pseudo-element for styling, and (c) the `insertReplacementText` input
event when the user picks a correction.**

### What does exist

1. **`spellcheck` — a hint, not a query.** WHATWG HTML, §"Spelling and grammar
   checking", `attr-spellcheck`
   (`https://html.spec.whatwg.org/multipage/interaction.html#attr-spellcheck`):
   the attribute is enumerated (`true` / `false` / default), and the spec
   states only whether an element "will be checked for spelling and grammar".
   **[observed]** Nothing in that section returns a result. MDN's page
   (`https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/spellcheck`,
   last modified 2026-07-03) adds: "This attribute is merely a hint for the
   browser: browsers are not required to check for spelling errors."
   **[observed]** `HTMLElement.spellcheck` is the boolean reflection of that
   attribute and nothing more
   (`https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/spellcheck`).

2. **`::spelling-error` — styling only.** MDN
   (`https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/::spelling-error`):
   "represents a text segment which the user agent has flagged as incorrectly
   spelled", allowable properties are limited to colour/decoration family
   properties. Marked "Limited availability … not Baseline". **[observed]** A
   page can restyle the squiggle; it cannot read the word, the offset, or the
   suggestions.

3. **`CaretPosition` carries no spelling state.** MDN
   (`https://developer.mozilla.org/en-US/docs/Web/API/CaretPosition`) lists the
   complete interface: `offsetNode`, `offset`, `getClientRect()`. **[observed]**

4. **`insertReplacementText` — the only observable event.** W3C Input Events
   (`https://w3c.github.io/input-events/`) lists `insertReplacementText` with
   the description "insert or replace existing content by means of a spell
   checker or similar" (spec text near the `inputType` table). **[observed]**
   This fires when the user accepts a correction; it delivers the replacement
   text in `data`, not the list of candidates. The EditContext explainer uses
   exactly this path (`e.inputType === "insertReplacementText"` "for
   spellcheck", `https://w3c.github.io/edit-context/`), which confirms that even
   the API designed for fully custom editors only receives the accepted
   replacement. **[observed]**

### Proposals, and their status

- **WHATWG DOM issue 547, "Proposal: Spellcheck API"**
  (`https://github.com/whatwg/dom/issues/547`), opened 2017-12-18 by Ginden.
  State: **Open**, labels `addition/proposal` and `needs implementer interest`.
  **[observed]** The proposed surface is `navigator.spellchecker(language)` plus
  `isValidWord()`, `isGrammaticallyValid()`, `validateText()` returning ranges.
  A comment on 2026-02-26 (tmccombs) proposes adding
  `suggestions() => Promise<Array<string>>` and states the motivating use case
  verbatim: "I have a text editor that is drawn completely on a `<canvas>`, and
  uses a custom context menu. As such, it can't make use of the browser's
  built-in spell checking functionality." **[observed]** The
  `needs implementer interest` label was applied 2026-07-09 — i.e. still
  no engine has committed to it. **[observed]**
- **WebKit bug 59693, "[Feature Request] Need SpellCheck API"**
  (`https://bugs.webkit.org/show_bug.cgi?id=59693`), reported 2011-04-28. Its
  proposal explicitly included `getSuggestions(queryWord, language)`. A patch
  landed as r88332 (2011-06-08) and was rolled out in r89452 (2011-06-22) after
  review objections; status is **REOPENED**. **[observed]** No WebKit engine
  ships a page-visible spellcheck API today. **[inferred from the absence of
  such an interface in the shipped IDL and from MDN's enumeration]**
- **Chromium "Spell check custom dictionary API"**, chromestatus id
  `6185007701557248`
  (`https://chromestatus.com/features/6185007701557248`), status **Proposed**.
  It adds `document.spellCheckCustomDictionary` so a page can suppress false
  positives; the summary states the words "cannot be read back". **[observed]**
  This is the nearest in-flight Chromium spellcheck proposal, and it is
  write-only.

### Why it is not exposed (and the one thing that leaks)

Chromium's own feature entry "Restricting spelling and grammar highlights",
chromestatus `5080415048171520`, status **Proposed**, gives the rationale:
"it's possible to extract indirect information from browsers without rate
limits on the application of these hints. In Chrome and Firefox, it's possible
to have an autofocused text area cycle programmatically through a series of
misspelled words, and for the site to monitor indicators of rendering
performance to notice when hints are applied." **[observed]** Note the status:
Proposed, not shipped, so the timing side channel still works today.
**[inferred]**

### Where the suggestions actually live (Chromium internals)

- `components/spellcheck/common/spellcheck_result.h:49` —
  `std::vector<std::u16string> replacements;` with the comment at `:16-17`
  "It also contains a possible replacement of the misspelling if it is
  available". **[observed]**
- `components/spellcheck/common/spellcheck.mojom` — `SpellCheckHost`
  `RequestTextCheck(...) => (array<SpellCheckResult> results)`, and
  `FillSuggestionList(word) => (array<string16> suggestions)` which is gated
  `[EnableIf=USE_BROWSER_SPELLCHECKER_AND_SPELLING_SERVICE]`, i.e. the Windows
  path. **[observed]** This is browser↔renderer mojo, not a Blink IDL surface.
- `third_party/blink/renderer/core/editing/markers/document_marker.h:44-64` —
  the renderer stores them as document markers (`kSuggestionMarkerIndex`,
  `kSuggestion`, `kActiveSuggestion`). Document markers have no scripting
  binding; the 2011 WebKit attempt to expose them (`addSpellcheckRange`,
  `spellcheckRanges`) is the patch that was rolled out. **[observed for the
  marker enum; inferred for "no binding", from the absence of such members in
  the shipped Blink IDL and in MDN's `HTMLElement`/`Element` interface lists]**

**Not established:** whether any engine has an unshipped, behind-a-flag
spellcheck API in 2026. I searched chromestatus (`q=spellcheck` returns 5
entries, none of them a suggestions API) and the two standards issues above;
that is not proof of absence inside a closed flag list.

---

## Question 2 — Can a page open the browser's own context menu at a point?

**Finding: No. There is no method on any script-visible interface that opens the
UA context menu, and the extension-side API cannot open it either.**

- **MDN `Element: contextmenu` event**
  (`https://developer.mozilla.org/en-US/docs/Web/API/Element/contextmenu_event`,
  last modified 2026-10-26): "fires when the user attempts to open a context
  menu"; the only documented script interaction is `preventDefault()`, which
  suppresses it. **[observed]** There is no companion "show" method, and the
  page's interface-method list (the full `Element` method enumeration on that
  page) contains none. **[observed]**
- **`chrome.contextMenus`** (extensions only,
  `https://developer.chrome.com/docs/extensions/reference/api/contextMenus`).
  Its methods are exactly `create()`, `remove()`, `removeAll()`, `update()`, plus
  the `onClicked` event. **[observed]** No `open()` — even an extension cannot
  raise the native menu; it can only contribute items to a menu the user opens.
- **`isTrusted`**: the DOM Standard
  (`https://dom.spec.whatwg.org/`) defines `isTrusted` as "true if event was
  dispatched by the user agent, and false otherwise". **[observed]** Dispatching
  a synthetic `contextmenu` `Event` therefore does not reproduce the user's
  right-click; that it also cannot trigger the UA's default action is
  **[inferred]** from the event model, not stated in a source I read.

**Consequence for the design question:** a custom menu cannot delegate to the
native one. The only ways to keep native suggestions reachable are to not
`preventDefault()` on that target (what `hybrid.js` does today) or to produce
suggestions another way (Questions 3–4). This is **[inferred]** from the two
negative findings above.

---

## Question 3 — Client-side spellchecking in JavaScript

**Finding: Typo.js is the only actively maintained pure-JS Hunspell
implementation, it was released four days ago (2.0.0, 2026-11-16), and its
`en_US` dictionary is ~540 KB. Its `suggest()` is documented as returning
"best first" and was specifically improved in this release.**

### `typo-js` (package name `typo-js`, repo `cfinke/Typo.js`)

- **Version and date [observed]**: npm registry
  (`https://registry.npmjs.org/typo-js`) — `dist-tags.latest = 2.0.0`,
  `time["2.0.0"] = 2026-11-16T22:35:36Z`. The repo's last commits are
  `2026-11-16` ("Support MAP and anchored REP entries in suggest()", "Improve
  slowness in French suggest() calls", "Typo 2.0.0"), 557 stars, not archived
  (`https://api.github.com/repos/cfinke/Typo.js`). **[observed]**
- **License [observed, with a caveat]**: `package.json` for 2.0.0 declares
  `"license": "BSD-3-Clause"`; the README section "Licensing" says "licensed
  under the Modified BSD License". The GitHub API reports
  `license: NOASSERTION` and `https://raw.githubusercontent.com/cfinke/Typo.js/master/LICENSE`
  returns 404 — there is no LICENSE file in the repo root. The npm metadata is
  the authoritative distribution claim; a legal review should note the missing
  file. **[observed]**
- **Dictionary shipped [observed]**: the npm tarball contains
  `dictionaries/en_US/en_US.aff` (3,090 bytes) and `dictionaries/en_US/en_US.dic`
  (551,762 bytes); total package `unpackedSize` 733,495 bytes, 9 files (npm
  `dist` metadata and `https://unpkg.com/typo-js@2.0.0/dictionaries/?meta`).
  The bundled `dictionaries/en_US/README.md` identifies it as "en_US Hunspell
  Dictionary Version 2020.12.07", derived from SCOWL, "correspond to SCOWL size
  60". The `.dic` first line is `49568` (49,568 stems). **[observed]**
- **Same bytes as the upstream package [observed]**: `wooorm/dictionaries`
  `dictionaries/en/index.aff` = 3,086 bytes and `index.dic` = 551,762 bytes via
  `Content-Length` (`https://raw.githubusercontent.com/wooorm/dictionaries/main/...`);
  that repo is MIT (`https://api.github.com/repos/wooorm/dictionaries`, last
  push 2024-09-09). So the browser-side dictionary cost is ~543 KB, ~50k stems.
- **API [observed]**: README API table — `check(word)`, `checkExact(word)`,
  `suggest(word, limit = 5)` "Corrections for a misspelled word, best first.
  Results are cached per word", `hasFlag()`. README example:
  `dictionary.suggest("speling")` → `["spelling","spieling","spewing","peeling","selling"]`.
  The affix support list covers `PFX`, `SFX` (with continuation classes and
  cross products), `REP` (with `^`/`$` anchors — new in 2.0.0), `MAP`, `FLAG`,
  `AF`, `COMPOUNDMIN`/`COMPOUNDRULE`, `KEEP`/`NOSUGGEST`/`NEEDAFFIX`/
  `FORBIDDENWORD`, `ICONV`/`OCONV`, `TRY`, `WORDCHARS`, plus a Typo-specific
  `PRIORITYSUGGEST` flag.
- **Quality of `suggest()` — not established by benchmark.** **[observed]** the
  release note "Support MAP and anchored REP entries in suggest()" means
  accented-variant and anchored-replacement suggestions were wrong before
  2.0.0. **[inferred]** ranking quality now tracks Hunspell's own
  `REP`/`MAP`-driven ordering more closely, because those tables are what
  Hunspell uses to order candidates. No measurement of typo.js vs Hunspell
  output exists in any source I read — that needs a corpus comparison.

### Alternatives

- **`nspell`** (repo `wooorm/nspell`), npm `nspell@2.1.5`, published
  **2021-01-17**, MIT, `unpackedSize` 42,413 bytes, one dependency (`is-buffer`).
  It ships no dictionary; dictionaries come from `dictionary-*` packages.
  **[observed]** No release in ~5 years.
- **`codemirror-v6-spell-checker`** (repo `5e-Cleric/codemirror-v6-spell-checker`),
  npm 1.0.1, published **2026-05-23**, MIT, `unpackedSize` 66.8 MB, depends on
  `@codemirror/state ^6.6.0`, `@codemirror/view ^6.43.0`, `typo-js ^1.3.2`.
  **[observed]** It is a decoration-based CM6 extension; its own author
  announces it in the CodeMirror forum thread 9811
  (`https://discuss.codemirror.net/t/new-v6-spell-checking-extension/9811`).
  Note it pins typo-js **1.x**, not 2.0.0.

---

## Question 4 — Server-side Python spell suggestions on Linux

**Finding: three viable shapes — pure-Python (`spylls`, `pyspellchecker`), a
binding over a C/C++ library (`pyenchant` → libenchant, `nuspell` → needs a
build), or shelling out to the `hunspell` CLI. All of the Hunspell-family ones
return ranked suggestions.**

| Option | Pure Python? | System library | License | Maintained | Ranked suggestions |
|---|---|---|---|---|---|
| `spylls` 0.1.7 | yes (no deps) | none | MPL-2.0 (PyPI classifier says MIT — conflict) | last release 2022-01-23, last commit 2024-03-26 | yes |
| `pyenchant` 3.3.0 | no (ctypes) | libenchant + a provider + dictionaries | LGPL | release 2025-09-14 | yes, provider's order |
| `nuspell` 5.1.9 | no | ICU4C; no official Python package | LGPL-3.0 | active, 2026-09-11 | yes |
| `hunspell` CLI 1.7.6 | n/a (process) | the binary + dicts | LGPL-2.1 | active, 2026-10-26 | yes |
| `pyspellchecker` 0.9.1 | yes (`py3-none-any` wheel) | none | MIT | active, 2026-10-10 | yes (edit-distance/frequency) |

### `spylls`

- PyPI `https://pypi.org/pypi/spylls/json`: version **0.1.7**, uploaded
  **2022-01-23**, `requires_dist: null` (no dependencies), `requires_python:
  >=3.7`. **[observed]**
- **License conflict [observed]**: the PyPI description's "License" section
  says "MPL 2.0", the repo `LICENSE` file at
  `https://raw.githubusercontent.com/zverok/spylls/master/LICENSE` begins
  "Mozilla Public License Version 2.0", and `https://api.github.com/repos/zverok/spylls`
  reports `MPL-2.0`; but the PyPI classifiers include
  `License :: OSI Approved :: MIT License`. Two sources say MPL-2.0, one says
  MIT. Treat MPL-2.0 as the operative license and do not ship it on the MIT
  classifier alone.
- API (PyPI description): `Dictionary.from_files('en_US')`, `dictionary.lookup(word)`,
  `for suggestion in dictionary.suggest('spylls')` → "spells", "spills". A
  dictionary is distributed with the package. **[observed]**
- Maintenance: last commit `2024-03-26` (GitHub `pushed_at`), 298 stars, not
  archived. **[observed]**

### `nuspell`

- **No PyPI package named `nuspell`.** `https://pypi.org/pypi/nuspell/json`
  returns HTTP **404**. **[observed]** Its README documents a C++ library and a
  CLI built with CMake, with no Python section at all
  (`https://raw.githubusercontent.com/nuspell/nuspell/master/README.md`);
  runtime dependency "ICU4C". **[observed]**
- Version **v5.1.9**, released **2026-09-11**, license **LGPL-3.0**, 270 stars
  (`https://api.github.com/repos/nuspell/nuspell/releases/latest`). README
  claims "Up to 3.5 times faster than Hunspell" and "Suggests high-quality
  spelling corrections". **[observed]** The speed claim is the vendor's, not an
  independent measurement.
- Third-party binding **`pynuspell` 1.0.0**, uploaded **2021-05-26**,
  LGPL-3.0, homepage `https://github.com/scherzocrk/pynuspell`, built against
  **Nuspell 4.2.0** (PyPI description badges) — i.e. it lags the current 5.1.9.
  **[observed]**

### `pyenchant` / libenchant

- PyPI `https://pypi.org/pypi/pyenchant/json`: version **3.3.0**, uploaded
  **2025-09-14**, `requires_python: >=3.9`, no deps, license **LGPL**,
  source `https://github.com/pyenchant/pyenchant`. **[observed]**
- Installation doc `https://pyenchant.github.io/pyenchant/install.html`:
  "to work properly, PyEnchant needs to: find the Enchant C library [and] find
  the dictionaries for your particular language"; on Linux install
  `libenchant` with the distro package manager; it locates the library with
  `ctypes.util.find_library()`, "which requires `ldconfig`, `gcc`, `objdump` or
  `ld` to be installed … statically linked distributions (like Alpine Linux)
  might not bring along binutils by default". **[observed]** On NixOS this means
  a wrapped interpreter with `LD_LIBRARY_PATH`/`libenchant` on the path plus a
  Hunspell provider and dictionary packages — **[inferred]** from the
  `find_library` mechanism, not stated for NixOS specifically.
- `suggest()` returns the provider's ranked list by definition of Enchant's
  `suggest`; **[inferred]** — the install doc does not state ranking.

### `hunspell` CLI

- Repo `hunspell/hunspell`, latest release **v1.7.6** (2026-10-26), GitHub
  licence field **LGPL-2.1**; the source tree also carries `COPYING`,
  `COPYING.LESSER` and `COPYING.MPL`, i.e. the historical tri-licence.
  **[observed]**
- Pipe mode, from `man/hunspell.1`: `-a` "is intended to be used from other
  programs through a pipe"; the man page's own example, `hunspell -d en_US`
  then input `exsample`, yields
  `& exsample 4 0: example, examples, ex sample, ex-sample` — count and
  ranked list. **[observed]** One process per request unless a long-lived
  process is managed by hand. **[inferred]**

### `pyspellchecker` (worth knowing as the pure-Python non-Hunspell option)

- PyPI 0.9.1, uploaded **2026-10-10**, MIT
  (`https://api.github.com/repos/barrust/pyspellchecker`, last push
  2026-10-10), wheel `pyspellchecker-0.9.1-py3-none-any.whl` — pure Python, no
  compiled extension. **[observed]** It uses its own frequency word lists, not
  `.aff`/`.dic`; **[observed]** from the `py3-none-any` wheel and the absence
  of any dictionary-file dependency in `requires_dist`.

**Not established:** per-option latency and memory under this project's note
sizes. Nothing I read benchmarks spylls or pyenchant; only Nuspell makes a
speed claim, about itself.

---

## Question 5 — Chromium on Linux: native menu suggestions in a contenteditable region

**Finding: Yes, by default, and it does not involve any OS spellcheck service.
Linux builds Chromium's own Hunspell renderer spellchecker, whose dictionaries
Chromium downloads itself as `.bdic` files. The suggestions shown in the
right-click menu come from that in-process dictionary set (plus, optionally, the
Google spelling service).**

### The platform switch is a build flag, and Linux is not on the OS side

`components/spellcheck/spellcheck_build_features.gni` (read at `main`):

```
use_browser_spellchecker = is_android || is_mac || is_win
use_renderer_spellchecker = !use_browser_spellchecker || is_win
```

**[observed]** `components/spellcheck/spellcheck.md` explains the pair: "Use
the operating system's spellchecker rather than Hunspell" and "Use hunspell
spellchecker rather than the operating system's spellchecker". **[observed]**
Since Linux is in neither `is_android`, `is_mac`, nor `is_win`,
`use_renderer_spellchecker` is true on Linux. **[inferred, mechanically from
the gni expression]**

Corroborating: `components/spellcheck/browser/` contains
`spellcheck_platform_mac.mm`, `spellcheck_platform_win.cc` and
`spellcheck_platform_android.cc` — **no Linux file** — and
`spellcheck_platform_mac.mm:1-5` describes itself as "Integration with macOS
built-in spellchecker". **[observed]** `spellcheck_platform.h` gates its
platform-suggestion callback on
`BUILDFLAG(IS_WIN) && BUILDFLAG(USE_BROWSER_SPELLCHECKER)`. **[observed]**

### The dictionary is Chromium's own download

`chrome/browser/spellchecker/spellcheck_hunspell_dictionary.cc:280-284`:

```
static const char kDownloadServerUrl[] =
    "https://redirector.gvt1.com/edgedl/chrome/dict/";
return GURL(std::string(kDownloadServerUrl) + base::ToLowerASCII(bdict_file));
```

**[observed]** The payload is a `.bdic` (BDict) file: validated with
`hunspell::BDict::Verify` at `:252`, header check `data->compare(0, 4, "BDic")`
at `:244`, and the filename is built as `language + version + ".bdic"`
(`components/spellcheck/common/spellcheck_common.cc:168-179`). **[observed]**
So a fresh Linux profile with no `~/.config/.../Dictionaries/en-US-*.bdic`
has to fetch a dictionary before any squiggle appears. **[inferred]**

### The menu you see is Chrome's own submenu

`chrome/browser/renderer_context_menu/spelling_menu_observer.cc` builds it:

- `kMaxSpellingSuggestions = 3`, `kMaxSpellingSuggestionsLimit = 5` (`:46-49`)
- `suggestions_ = params.dictionary_suggestions;` (`:89`)
- `use_platform_suggestions_ = spellcheck::UseBrowserSpellChecker();` (`:96`) —
  the OS path only applies where that build flag is set
- remote suggestions via `SpellingServiceClient::IsAvailable(...)` (`:92`)

**[observed]** So the "Spelling" submenu is rendered by Chrome from
`dictionary_suggestions` regardless of platform; the OS spellchecker only
replaces the source of those suggestions where `use_browser_spellchecker`
holds. **[inferred]**

### The optional Google path

`components/spellcheck/browser/spelling_service_client.cc:44-46` defines
`https://%s.googleapis.com/spelling/v%d/spelling/check?key=%s` — the "enhanced
spell check" path. It is off unless the pref is set:
`chrome/browser/spellchecker/spellcheck_service.cc:536` initialises
`kSpellCheckUseSpellingService` to `false`. **[observed]** This matters for a
privacy-sensitive local notebook: basic spell check stays local on Linux, and
only the enhanced setting sends text to Google. **[inferred]**

### Practical confirmation on Linux

CodeMirror forum thread 9886, "Native spellcheck is never applied to a
CodeMirror 6 editing host on Chromium 152 (Electron 44)"
(`https://discuss.codemirror.net/t/native-spellcheck-is-never-applied-to-a-codemirror-6-editing-host-on-chromium-152-electron-44/9886`):

- The reporter's symptom description: in the failing environment "the
  right-click menu offers no misspelled word or suggestions", while a plain
  contenteditable with the same attributes **is** checked. **[observed]**
- Marijn Haverbeke (CodeMirror's author), 2026-09-05: "I don't see this. My
  Chromium 52 (Linux) spell-checks content inside CodeMirror as expected."
  **[observed]** (The version number appears to be a typo for 152; the thread
  title and the reporter's follow-up both concern Chromium 152.)
- The reporter's follow-up, 2026-09-06: re-running in "plain Chrome
  152.0.7977.82 (Linux, fresh en-US profile): all three boxes are spellchecked,
  including both CodeMirror editors. The failure only reproduces under Electron
  44". **[observed]**

**Relevant caveat if the app is ever wrapped in Electron:** native spellcheck
was broken in Electron 44 / Chromium 152 for CM6 hosts, per that thread.
**[observed as a report; not independently reproduced]**

---

## Question 6 — CodeMirror 6 spellcheck / context-menu integration

**Finding: CM6 has no spellcheck extension and no context-menu extension. It
turns native spellcheck off by default on `.cm-content` and lets you turn it
back on with one `contentAttributes` facet. The lint package can host a
dictionary-based checker but has no menu and no suggestion ranking.**

### Observed locally (exact installed versions)

- `node_modules/@codemirror/view` **6.43.6**, `dist/index.js:8254-8264` builds
  the content attributes with `spellcheck: "false"`, `autocorrect: "off"`,
  `autocapitalize: "off"`, `writingsuggestions: "false"`, `translate: "no"`,
  `contenteditable: "true"`. **[observed]**
- That object is then overridden by the `contentAttributes` facet
  (`attrsFromFacet(this, contentAttributes, contentAttrs)` at `:8268`); the
  facet is declared at `:1514` and documented in `dist/index.d.ts:1435` as
  `static contentAttributes: Facet<AttrSource, ...>`. **[observed]**
- `@codemirror/lint` **6.9.7**, `dist/index.d.ts:9-24` defines `Diagnostic`
  (`from`, `to`, `severity`, …) and `:53-65` defines `Action` (`name`,
  `markClass?`, `apply`). **[observed]**
- `grep -c spell node_modules/@codemirror/lint/dist/index.js` → 0 matches.
  **[observed]** So lint has no spellcheck awareness; a dictionary checker would
  be a normal `linter(source)` returning diagnostics, and candidate words could
  be surfaced as `Diagnostic.actions`. **[inferred]**

### Upstream docs

- The official reference, `https://codemirror.net/docs/ref/`, contains **zero**
  occurrences of "spell" (grep of the fetched page, 834,749 bytes).
  **[observed]** There is no first-party spellcheck extension.
- Forum answer on the supported route
  (`https://discuss.codemirror.net/t/inputstyle-contenteditable-we-may-hope-for-browser-spell-checking/608`):
  "That's not how you use `contentAttributes`. You want
  `contentAttributes.of({spellcheck: "true"})` instead." **[observed]**
- Third-party only: `codemirror-v6-spell-checker` 1.0.1 (2026-05-23, MIT,
  typo-js 1.x, 66.8 MB unpacked) — announced by its author in thread 9811.
  **[observed]**
- No CM6 context-menu extension was found in the reference docs or the forum
  threads read. **[observed as a search result; not proof of absence in
  third-party packages]**

---

## Observed vs inferred, condensed

**Observed:** no spellcheck-results API ships; the two proposals (WHATWG
DOM 547, WebKit 59693) are open/reopened and unimplemented; Chromium's only
in-flight spellcheck API is a write-only custom dictionary; there is no
script or extension API to open the native context menu; typo-js 2.0.0 shipped
2026-11-16 with a 3,090 + 551,762-byte en_US dictionary and a documented
best-first `suggest(word, limit=5)`; spylls 0.1.7 is dependency-free pure
Python with an MPL-2.0/MIT metadata conflict and no release since 2022;
pyenchant 3.3.0 needs libenchant; nuspell 5.1.9 has no PyPI package; hunspell
1.7.6 `-a` emits a ranked list; Linux Chromium uses `use_renderer_spellchecker`
and downloads `.bdic` from `redirector.gvt1.com`; Chrome renders the "Spelling"
submenu from `dictionary_suggestions`; CM6 hardcodes `spellcheck:"false"` and
ships no spellcheck or context-menu extension.

**Inferred:** that dispatching a synthetic `contextmenu` cannot raise the UA
menu; that document markers have no scripting binding; that NixOS needs a
wrapped interpreter for pyenchant; that a dictionary-backed `linter(source)`
plus `Diagnostic.actions` is the shape a CM6 integration would take.

**Not established:** whether typo-js `suggest()` quality matches Hunspell
(no benchmark exists in any source read); per-option server latency and memory;
whether a flag-gated spellcheck API exists inside any engine; whether Firefox's
implementation (Gecko's own spellchecker, not examined here in source) changes
any of the above — Questions 1, 2 and 5 were answered from Chromium and
standards only, plus the MDN/forum evidence that spans both engines.
