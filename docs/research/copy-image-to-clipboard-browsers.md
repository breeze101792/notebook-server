# Copying an image to the system clipboard from a web page (October 2026)

Research question: what can a web page do in Firefox today (October 2026) to put
an **image** onto the system clipboard, so that a "Copy image" button actually
copies rather than only downloads? Scope: browser capability facts only. No
code was written or changed.

Grounding for this project: `static/js/copy-image.js` is a "Copy image" button
on rendered SVG diagrams. It rasterizes the SVG to a PNG `Blob` and calls
`navigator.clipboard.write([new ClipboardItem({ "image/png": blobPromise })])`,
falling back to a PNG download when that fails
(`static/js/copy-image.js:284`, `static/js/copy-image.js:299`). This report
confirms whether that path is sound in Firefox and what the fallback must
cover.

All sources were read directly. Dates/versions are those reported by the
source. Observations are marked; conclusions drawn from source code or from
several sources together are marked as inference.

---

## Question 1 — Does current Firefox support `navigator.clipboard.write([...image/png...])`?

**Finding: Yes, since Firefox 127 (released 2024-06-11).**

Evidence:

- **MDN BCD (browser-compat-data), `api/Clipboard.json`, `main` branch, read
  2026-10-14** (`https://github.com/mdn/browser-compat-data`):
  - `Clipboard.write`: `firefox.version_added = "127"`, with notes "This method
    must be called within user gesture event handlers", "Only accepts a single
    `ClipboardItem`", and "Web extensions with the `clipboardWrite` permission …
    can write data without a user gesture."
  - `Clipboard.type_image-png` ("Supports `image/png` MIME type"):
    `firefox.version_added = "127"`.
  - `Clipboard.type_text-html`: Firefox 127. `Clipboard.type_text-plain`:
    Firefox 127.
  - `ClipboardItem` (constructor) and `ClipboardItem.supports()`: Firefox 127.
- **Firefox 127.0 release notes, dated June 11, 2024**
  (`https://www.firefox.com/en-US/firefox/127.0/releasenotes/`), Web Platform
  section: “`navigator.clipboard.read()/write()` has been enabled”.
- **MDN `Clipboard.write()`** (`https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write`,
  last modified 2026-08-22): “Baseline 2024 … Since June 2024”; “Browsers
  commonly support writing text, HTML, and PNG image data.”
- **Bugzilla 1809106** (“Enable `dom.events.asyncClipboard.clipboardItem` …”),
  read 2026-10-14 (`https://bugzilla.mozilla.org/show_bug.cgi?id=1809106`):
  the tracking bug for enabling the async clipboard. Tracking flag
  `firefox122` = fixed (pref-gated / Nightly), Status RESOLVED FIXED. In the
  thread, replying to an MDN editor, the maintainer confirms: *“Yes, we only
  support text/plain, text/html and image/png.”* (comment ~#17). A Mozilla
  contributor comment notes the API “is necessary to enable copying of image
  content into the clipboard, which some web application like gitea now offer.”

**Which data types Firefox's async `write()` accepts today:**
`text/plain`, `text/html`, and `image/png` only. Anything else is rejected
(Bugzilla 1809106 comment; MDN `Clipboard.write`; the W3C spec mandates exactly
those three, see Q5). `image/svg+xml` and `web ` custom formats are **not**
supported in Firefox (BCD `ClipboardItem.json`: `type_image_svg_xml` Firefox
`false`, `type_web` Firefox `"preview"`).

**Independent real-world confirmation (Firefox 150 Nightly, March 2026):**
mozilla/pdf.js issue #20918, opened 2026-03-19
(`https://github.com/mozilla/pdf.js/issues/20918`), states that
`navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])`
**succeeds without error** in Firefox; the failure reported there was only the
subsequent *paste* in **headless** Firefox (upstream bug 1878643), and the issue
was closed 2026-09-20 after that upstream bug was fixed. (Observation from the
issue thread; the headless detail is a secondary report.)

Related limitation, not a blocker (a report, not a Mozilla statement):
Bugzilla 1961156, created 2025-04-17, last comment 2026-07-07
(`https://bugzilla.mozilla.org/show_bug.cgi?id=1961156`) — Firefox re-encodes
images before placing them on the clipboard, stripping embedded metadata (e.g.
Excalidraw scene data). The pixel data still reaches the clipboard.

---

## Question 2 — Is there any supported page-side way to put *image* data on the Firefox clipboard?

**Finding: Yes — `navigator.clipboard.write()` with `image/png` (Firefox 127+).
The `document.execCommand("copy")` route does NOT put image (pixel) data on the
clipboard in Firefox.**

### 2a. `document.execCommand("copy")` with an `<img>` in the selection

**Finding: No. In Firefox this copies the selection as `text/html` (and
`text/plain`), not as `image/png`. It does not place a decoded bitmap on the
system clipboard.**

Primary-source evidence — Gecko source, `dom/base/nsCopySupport.cpp`, `main`
branch, read 2026-10-14
(`https://github.com/mozilla/gecko-dev/blob/master/dom/base/nsCopySupport.cpp`):

- The default copy path is `nsCopySupport::FireClipboardEvent` →
  `EncodeDocumentWithContextAndPutToClipboard` → `CreateTransferable`. That
  transferable adds only `kHTMLMime` (`text/html`), `kHTMLContext`,
  `kHTMLInfo`, `kTextMime` (`text/plain`), and a private source-URL flavor. **No
  image MIME is added.** An `<img>` inside the selection is serialized into the
  HTML flavor as an `<img src="…">` tag, not as pixel data.
- Image *data* is added only by a separate function, `nsCopySupport::ImageCopy`,
  which sets `kNativeImageMime` under the `COPY_IMAGE_DATA` flag. That function
  takes an `nsIImageLoadingContent*` (a specific image element) and is the
  implementation behind the browser's own **context-menu “Copy Image”**
  command — it is not the `execCommand("copy")` selection path.

Inference (from the source above): at runtime, a page calling
`execCommand("copy")` with a `Range` over an `<img>` produces `text/html`
(plus `text/plain`) on the clipboard, which pastes into rich-text editors as an
image reference, but produces no `image/png`/bitmap and will not paste into
image targets. This matches the one secondary report found: Stack Overflow
answer to “How to copy image to clipboard in firefox”, answer by BlobKat posted
2024-10-16 (`https://stackoverflow.com/questions/70289757/how-to-copy-image-to-clipboard-in-firefox`):
“`execCommand` sounds promising but it does not actually copy the image, rather
a rich text segment containing the image.” That answer’s suggested workaround
is `text/html` via the async API.

Not established: whether a page could add an image `File` to the `copy` event's
`DataTransfer` and let the default proceed (the `clipboardData->GetTransferable`
branch of `FireClipboardEvent`). No source confirming that route to an
`image/png` flavor was found. Treat as unproven.

### 2b. Any other Web API or permission

**Finding: No other page-side path exists. The async Clipboard API is the only
supported route, and `clipboard-write` is not available to web pages in
Firefox.**

- **MDN Clipboard API** (`https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API`,
  last modified 2026-03-05): “The `clipboard-read` and `clipboard-write`
  permissions are not supported (and not planned to be supported) by Firefox or
  Safari.” Writing “requires transient activation.”
- **MDN, Interact with the clipboard** (WebExtensions,
  `https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Interact_with_the_clipboard`,
  last modified 2026-09-15): the `clipboardWrite` permission exists only for
  **extensions**; it lets an extension write without a user gesture. Page
  scripts do not get it.
- **Gecko `dom/locales/en-US/chrome/dom/dom.properties`** (`main` branch, read
  2026-10-14): `ExecCommandCutCopyDeniedNotInputDriven=document.execCommand(‘cut’/‘copy’)
  was denied because it was not called from inside a short running
  user-generated event handler.` → `execCommand("copy")` requires a **user
  gesture** in Firefox anyway.
- **MDN `Document.execCommand`** (`https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand`,
  last modified 2026-08-21): marked Deprecated / non-standard; “the newer
  Clipboard API is recommended.” Also: “`document.execCommand()` only returns
  `true` if it is invoked as part of a user interaction.”
- **The `copy` event route:** a page can write arbitrary strings via
  `clipboardData.setData()` inside a trusted `copy` event, but per Alex Harri,
  “The web’s clipboard …”, 2024-09-01
  (`https://alexharri.com/blog/clipboard`), arbitrary/custom representations
  are stored only in a browser-specific clipboard format
  (`org.mozilla.custom-clipdata` in Firefox) and are **not** mapped to native
  OS image formats. So this cannot place an `image/png` for other applications.

**Bottom line for Q2:** If the requirement is “a real image on the system
clipboard that pastes into an image target,” the reliable answer for Firefox is
**yes via `navigator.clipboard.write()` (127+)**, and **no via `execCommand`**.

---

## Question 3 — Chrome / Edge / Safari support and `Promise<Blob>`

**Finding: All three support `write()` with `image/png`. `Promise<Blob>` as the
`ClipboardItem` value is supported in Firefox (127+) and Safari (13.1+); in
Chrome it arrived in 98 (Blob-or-Promise) and was completed in 133.**

- **web.dev, “Unblocking clipboard access”** (`https://web.dev/articles/async-clipboard`,
  article by Jason Miller / Thomas Steiner, first published 2020-07-31; its
  compat boxes show `write()` support): Chrome **76**, Edge **79**, Firefox
  **127**, Safari **13.1**. (Matches MDN BCD `Clipboard.write`.)
- **MDN BCD `api/ClipboardItem.json`** (`main`, read 2026-10-14), `ClipboardItem()`
  constructor data-type support:
  - **Chrome 76–97:** partial — “Only accepts a `Blob` as the item data”
    (crbug 40103226).
  - **Chrome 98–132:** partial — “Only accepts a `Blob` or a Promise resolving
    to a `Blob` as the item data.” → **`Promise<Blob>` works from Chrome 98.**
  - **Chrome 133+:** full (also strings / promises resolving to strings).
  - **Firefox 127:** no partial note → full spec support (Blob, string, or
    Promise resolving to Blob/string), per the constructor’s documented
    parameter types on MDN.
  - **Safari 13.1:** listed as supported.
- **Safari requires `write()` to be called synchronously in the user gesture.**
  WebKit bug 222262, “Javascript Clipboard API write() does not work after
  await”, reported 2021-02-22, last modified 2026-06-24
  (`https://bugs.webkit.org/show_bug.cgi?id=222262`):
  - Comment 1 (Ryosuke Niwa, WebKit): the difference is “the way user activation
    is tracked between Blink and WebKit”; the workaround is to start the write
    inside the click handler and pass a Promise as the `ClipboardItem` value.
  - Comment 3 (Wenson Hsieh, WebKit): making the `image/png` value “a Promise
    instead of an async function” makes it work.
  - Comment 7 (Nolan Lawson, 2025-09-05): “the issue occurs when there’s any
    async boundary between the user-initiated click event and the call to
    `navigator.clipboard.write` … neither Chromium nor Firefox have this issue,
    so the special workaround is only required for WebKit.”
  This is also the basis of the warning on the web.dev article.

Implication for this project: `copy-image.js` already builds the PNG promise
synchronously and passes it as the `ClipboardItem` value
(`static/js/copy-image.js:280`, `static/js/copy-image.js:285`), which is the
Safari-safe shape. Good.

---

## Question 4 — Prerequisites for the `execCommand` route (which does not work)

Because 2a does not place image data in Firefox, its prerequisites are moot for
the “copy an image” goal. Still, the relevant facts:

- **User gesture:** required. `execCommand("copy")` is denied outside a short
  user-generated event handler in Firefox (Gecko `dom.properties` string above;
  MDN `execCommand` page).
- **Non-collapsed selection:** Firefox's default copy path returns early if the
  selection ranges are collapsed (`nsCopySupport::FireClipboardEvent`,
  `AreNormalAndCrossShadowBoundaryRangesCollapsed`). So a `Range` must exist.
- **Rendered DOM vs offscreen:** the Gecko path encodes the selection via the
  document encoder, so the node must be in the document/selection; a detached
  node is not part of a normal selection.
- **`data:` vs `blob:` URL / `contenteditable` / format:** these affect only the
  *`text/html` string* that is serialized (`<img src="…">`), not whether image
  data is placed on the clipboard — because image data is never placed on this
  path. Bugzilla 1868508 (created 2023-12-06; a Mozilla engineer could not
  reproduce on FF120, macOS + Ubuntu) concerns the browser's own “Copy Image”
  context menu for base64 `data:` images, not `execCommand`.
- **CSP / permission prompt (async path):** `write()` needs a secure context
  (MDN `Clipboard.write`), a user gesture, and no permission prompt in Firefox
  (no `clipboard-write` permission exists for pages). A CSP `img-src` directive
  can block loading an image for *canvas rasterization* but is unrelated to the
  clipboard write itself. Not established that any CSP directive blocks the
  async clipboard image write; no source found.

---

## Question 5 — Cross-browser best practice (2026)

**Primary path:** `navigator.clipboard.write([new ClipboardItem({ "image/png": blobOrPromise })])`,
called **synchronously inside the click handler**, with the value passed as a
`Promise<Blob>` so Safari's user-activation model is satisfied.

Sources: web.dev “Unblocking clipboard access” (Chrome 76 / Edge 79 / Firefox
127 / Safari 13.1); MDN BCD `Clipboard.write` + `type_image-png`; WebKit bug
222262 (Safari sync requirement). Feature-detect with
`ClipboardItem.supports("image/png")` where available — Chrome 121+, Firefox
127+, Safari 18.4+ (BCD `ClipboardItem.supports_static`) — or wrap in
try/catch.

**Fallback:** no longer “download only” for Firefox. Firefox has had the async
image path since 127, so a download fallback is needed only for (a) older
Firefox (<127), (b) insecure contexts (non-HTTPS/localhost), (c) denied/failed
`write()`, or (d) browsers/OSes that reject `image/png`. The fallback should
download the PNG (`<a download>`) and/or open a preview where the user can use
the browser's native right-click → **Copy Image**, which does place pixel data
(the `nsCopySupport::ImageCopy` / `COPY_IMAGE_DATA` path in Gecko).

**Explicitly: there is a working Firefox path (127+); “no Firefox path” is
false as of 2026.** The only route that does not work in Firefox is the
`execCommand("copy")` shortcut.

---

## Source list (with dates/versions)

| # | Source | Date / version | Used for |
|---|--------|----------------|----------|
| 1 | MDN BCD `api/Clipboard.json`, `api/ClipboardItem.json` (main) | read 2026-10-14 | Firefox 127 `write` + `image/png`; Chrome `Promise<Blob>` 98/133; `supports()` |
| 2 | Firefox 127.0 release notes | 2024-06-11 | `read()/write()` enabled |
| 3 | MDN `Clipboard.write()` | last mod. 2026-08-22 | Baseline 2024; text/HTML/PNG |
| 4 | MDN `ClipboardItem()` | last mod. 2025-06-23 | data = Blob / string / Promise |
| 5 | MDN Clipboard API | last mod. 2026-03-05 | `clipboard-write` unsupported in FF/Safari |
| 6 | MDN `Document.execCommand()` | last mod. 2026-08-21 | deprecated; needs user interaction |
| 7 | MDN “Interact with the clipboard” (WebExtensions) | last mod. 2026-09-15 | execCommand denial string; extension-only permission |
| 8 | Bugzilla 1809106 | RESOLVED FIXED, `firefox122` | tracking bug; “only text/plain, text/html, image/png” |
| 9 | Bugzilla 1961156 | created 2025-04-17 | Firefox re-encodes clipboard images |
| 10 | Bugzilla 1868508 | created 2023-12-06 | base64 image / Copy Image context menu, not reproducible |
| 11 | mozilla/pdf.js #20918 | 2026-03-19 → closed 2026-09-20 | `image/png` write succeeds in FF (non-headless) |
| 12 | web.dev “Unblocking clipboard access” | pub. 2020-07-31 | Chrome 76 / Edge 79 / FF 127 / Safari 13.1; Safari Promise warning |
| 13 | WebKit bug 222262 | 2021-02-22, mod. 2026-06-24 | Safari sync user-gesture requirement |
| 14 | Gecko `dom/base/nsCopySupport.cpp` | main, read 2026-10-14 | execCommand path adds no image MIME; `ImageCopy` does |
| 15 | Gecko `dom/locales/.../dom.properties` | main, read 2026-10-14 | execCommand user-gesture denial string |
| 16 | Alex Harri, “The web’s clipboard…” | 2024-09-01 | arbitrary types not mapped to native image formats |
| 17 | W3C Clipboard API (`w3.org/TR/clipboard-apis/`, §mandatory-data-types-x) | 2026-06-24 draft | mandatory types text/plain, text/html, image/png |

## Open / conflicting

- **Headless Firefox:** `write()` succeeds but paste failed in headless mode
  (upstream bug 1878643), fixed by 2026-09-20 per the pdf.js issue. Relevant only
  to automated tests, not real users.
- **`execCommand` image behavior** is established from the Gecko source path
  (observation) and concluded at runtime (inference). No Mozilla doc states it
  in prose; no independent end-to-end browser test was run here.
- **DataTransfer-File route** to place an image via a `copy` event is
  unproven; no source found.
- **CSP interaction** with the async image clipboard write is unproven; no
  source found.

## Recommendation

Keep the async `navigator.clipboard.write()` + `Promise<Blob>` implementation
(Safari-safe, works in Chrome 98+, Firefox 127+, Safari 13.1+). Keep the PNG
download fallback for old Firefox (<127), insecure contexts, and write failures.
Do not attempt an `execCommand("copy")` image path in Firefox: the Gecko code
path shows it never places image data on the clipboard. The decision on whether
to also expose a right-click “Copy Image” preview fallback belongs to `plan`
or the user; the evidence here supports only the download fallback as the
lowest-cost correct option.
