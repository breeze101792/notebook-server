# Feature: AI assistant file attachments (images + larger text files)

**Author:** product-designer
**Date:** 2026-10-12
**Status:** Product definition. No technical or visual design chosen here.
**Inputs:** `docs/architecture/ai-assistant.md`; the attachment code in
`static/js/ai.js` (`AI_ATTACH_*`, verified 2026-10-12); the `/api/ai/chat`
route in `app.py` (verified 2026-10-12).

---

## 0. One-line definition

Let the owner attach **images** (screenshots) and **larger text/code files** to
an AI assistant message. Images go to a vision model as OpenAI-compatible
content parts; text files keep the existing inline-block treatment with higher
caps. No new server storage and no new route.

---

## 1. User goals

- **G1 — Ask about a screenshot.** The owner pastes or picks a PNG screenshot
  (the trigger case: a PNG larger than the old 32 KiB cap, currently rejected)
  and asks the assistant to read, transcribe, summarize, or review it. This is
  the reason the feature exists.
- **G2 — Show the model something it cannot read as text.** A UI mock, an error
  dialog, a photo of a whiteboard, a chart — content that has no useful text
  form.
- **G3 — Attach a bigger text/code file.** The owner attaches a larger source
  file, log, or config than the 32 KiB / 96 KiB caps allow today, so the
  assistant can review it without the owner pasting it in pieces.
- **G4 — See what was sent.** Attached images and text files are visible as
  chips before sending and as thumbnails/names in the sent bubble, so the
  owner knows exactly what the model received.

---

## 2. Scope

**Must-have (MVP).**

- Image attachments (PNG, JPEG, WebP, GIF) via the existing 📎 picker and the
  existing drag-and-drop target, in the same pending-attachment list as text
  files.
- Client-side downscale/re-encode so a real screenshot above the old cap is
  accepted and sent within a bounded payload.
- Vision wire format: an image-bearing user turn carries a content-part array.
- Raised text-file caps.
- Chips with image thumbnails before sending; thumbnails + names in the sent
  bubble.
- Clear, actionable errors for oversized, unsupported, unreadable, and
  vision-refused cases.
- `/api/ai/chat` accepts a content-part array for a user message (a required
  backend contract change; see §8).

**Should-have.**

- A per-provider "Supports images" hint so a known text-only model warns before
  the first failed send (see §9 open question 2).

**Out of scope / non-goals.**

- Any server-side image storage, thumbnail cache, OCR, or image editing.
- Attaching PDF, audio, video, or arbitrary binary files.
- Sending whole notebook folders as attachments (the `read` tool already exists).
- Auto-detecting a provider's vision capability from the wire (OpenAI-compatible
  endpoints expose none).
- Changing the visible bubble for text files beyond the raised caps.
- Image generation or image output from the model.

**MVP line.** Ship the must-have set: images end to end (pick → downscale →
chip → send → provider) plus the raised text caps. The "Supports images" hint is
the first should-have and can follow.

---

## 3. Verified current behavior (baseline this spec changes)

- `AI_ATTACH_MAX_FILES = 5`, `AI_ATTACH_MAX_BYTES = 32 KiB` per file,
  `AI_ATTACH_MAX_TOTAL = 96 KiB` total.
- Only UTF-8 text-like files are accepted (`isTextLike` MIME allowlist +
  extension fallback; empty MIME passes to a content check). A NUL byte means
  binary and is rejected.
- Text bodies are inlined into the user turn as
  `[Attached file: <name> (<size>)]\n<content>\n[/Attached file: <name>]`. The
  bubble shows name-only chips.
- The whole `conversation` is held in memory and re-uploaded on every request
  and every tool round.
- `/api/ai/chat` requires each message `content` to be a **string** and rebuilds
  a whitelisted upstream payload. Images cannot pass today.
- Caps are reserved synchronously at selection time; the send button is disabled
  while reads are in flight; a reset (`Clear`) bumps an epoch so stale reads
  cannot count.

---

## 4. Pinned design decisions

Every value below is a named constant; the default and its source are stated so
the limit can be re-derived, not guessed.

### 4.1 Accepted image formats and type detection

- Accept **PNG (`image/png`), JPEG (`image/jpeg`), WebP (`image/webp`), GIF
  (`image/gif`)**. These four are accepted by vision endpoints across providers;
  PNG is the screenshot default, so it is the primary case.
- Detection: trust `file.type` when it is one of the four accepted image MIME
  types; otherwise fall back to the extension (`.png`, `.jpg`, `.jpeg`,
  `.webp`, `.gif`). A file neither MIME- nor extension-matched is unsupported.
- Detection is best-effort because browsers often report an empty or wrong MIME
  for local files; the decode step (§4.2) is the final gate — a file that passes
  the type gate but cannot be decoded as an image is rejected as unreadable.
- SVG stays **text** (already in the text extension allowlist) and is inlined as
  text; it is never treated as a raster image.
- GIF is accepted but a re-encode flattens it to the first frame. State this in
  the error/summary text only if a re-encode happened.

### 4.2 Image sizing: downscale and re-encode

- `AI_ATTACH_IMAGE_SOURCE_MAX_BYTES = 10 MiB` — the largest raw file accepted.
  Above it, reject without reading ("…larger than 10 MiB — downscale it first").
  Source: canvas decoding of very large images is memory-heavy on the owner's
  machine; 10 MiB covers any real screenshot (a 4K PNG is ~8 MiB) and bounds a
  pathological file.
- `AI_ATTACH_IMAGE_MAX_EDGE = 1600 px` (longest edge). Source: the common
  vision-model internal resize target is ~1568 px; 1600 keeps detail for code
  and UI screenshots while cutting bytes.
- `AI_ATTACH_IMAGE_TARGET_BYTES = 768 KiB` (decoded) — the per-image target
  after any re-encode. Source: a screenshot at this size stays legible for
  vision and keeps the re-uploaded transcript affordable.
- `AI_ATTACH_IMAGE_MAX_BYTES = 2 MiB` (decoded) — the per-image hard cap.
  Source: 2 MiB decodes to ~2.7 MiB base64, below Anthropic's ~5 MB per-image
  recommendation with headroom.
- **Pass-through rule.** If a selected image is already ≤ `TARGET_BYTES` and its
  longest edge is ≤ `MAX_EDGE`, send its original bytes unchanged with its
  original MIME. No re-encode, no gratuitous quality loss.
- **Downscale rule.** Otherwise draw to a canvas with the longest edge ≤
  `MAX_EDGE`, then re-encode preserving the source format:
  - PNG → PNG (keeps text crisp; preserves transparency)
  - JPEG → JPEG at quality 0.85
  - WebP → WebP at quality 0.85
  - GIF → PNG (first frame; preserves transparency)
  If the result still exceeds `TARGET_BYTES`, re-encode once more at 1024 px /
  quality 0.75. If it still exceeds `MAX_BYTES`, reject:
  "`<name> could not be reduced below 2 MiB`".
- Canvas re-encode drops EXIF (including GPS) and ICC metadata. This is a
  privacy benefit and is noted for the user-visible behavior only if asked.

### 4.3 Wire representation

- A user turn **without images** keeps the current plain-string `content`
  (backward compatible).
- A user turn **with images** uses a content-part array:

  ```json
  {"role":"user","content":[
    {"type":"text","text":"<prompt> + inlined text-file blocks"},
    {"type":"image_url","image_url":{"url":"data:image/png;base64,<...>"}}
  ]}
  ```

  - One `text` part carries the prompt and every text-file inline block
    (unchanged marker format). It is emitted when the user typed text or
    attached a text file. An image-only send (empty prompt, no text files) emits
    no `text` part rather than inventing an instruction.
  - One `image_url` part per image, in attachment order, after the text part.
  - The data URL carries the MIME from §4.2 and standard base64.
- Mixed attachments follow one rule: text files inline into the single text
  part; images become image parts. No text file is ever split across parts.

### 4.4 Message caps and total payload bound

- `AI_ATTACH_MAX_IMAGES = 4` per message. Source: a few screenshots is the real
  use; four bounds vision token cost and request size.
- `AI_ATTACH_MAX_FILES = 8` total chips (text + image), raised from 5. Source:
  room for up to four images plus several code files; kept a named total so the
  accounting stays one list.
- `AI_ATTACH_IMAGE_TOTAL_BYTES = 8 MiB` decoded (4 × `MAX_BYTES`). Enforced
  independently of the text total.
- `AI_ATTACH_TEXT_MAX_BYTES = 128 KiB` (per text file, raised from 32 KiB).
- `AI_ATTACH_TEXT_MAX_TOTAL = 512 KiB` (raised from 96 KiB).
- `AI_ATTACH_MAX_WIRE_BYTES = 12 MiB` — the serialized JSON request body,
  base64 included. Source: 8 MiB decoded → ~10.7 MiB base64 (inflation
  `4/3 ≈ 1.34×`) → + 0.5 MiB text + JSON overhead fits 12 MiB, which is under
  OpenAI's ~50 MB and Anthropic's ~32 MB request limits. If a send would exceed
  it, refuse before the request with a clear message and do not mutate the
  conversation (belt-and-braces; the per-type caps should already prevent it).
- Text caps and image caps are **separate paths** with separate counters; the
  combined wire guard is the only place they meet.

### 4.5 Conversation persistence

- **Images persist in the in-memory `conversation` and are re-sent on every
  subsequent turn and every tool round**, identical to text-file bodies today.
- Rationale: one memory model, and follow-up questions about a screenshot keep
  working without re-attaching.
- Cost trade-off (stated plainly): base64 image parts are re-uploaded on every
  request, so a turn with four images can re-send ~10 MiB on each of up to
  `MAX_TOOL_ROUNDS` rounds. Mitigations: the downscale caps keep typical images
  well under `TARGET_BYTES`; text-file caps bound the text part; `Clear` resets
  the transcript. The cheaper alternative — send images only on the first turn
  and later replace them with a name stub — is rejected because follow-up
  questions would lose the pixels and it splits the memory model. It is listed
  as open question 1.

### 4.6 User-visible UI

- **Pending chips** (same `.ai-attach-chip` row as today):
  - image chip = a small thumbnail (square, cover-cropped) + sanitized name +
    human size + remove `×`;
  - text chip = name + size + remove `×` (unchanged).
- **Sent bubble** (`appendUserFiles` today shows names only):
  - images additionally render a bounded thumbnail (a fixed max height) so the
    owner can see what was sent;
  - text files keep name-only chips. Thumbnails use the object URL or a data URL
    already in hand; they are never re-fetched.
- **Errors** are shown as `.ai-attach-err` chips (existing pattern), with these
  exact messages:
  - oversized source image: "`<name>` is larger than 10 MiB — downscale it
    first"
  - oversized text file: "`<name>` is larger than 128 KiB"
  - text total exceeded: "attachment size limit reached (512 KiB total)"
  - too many images: "too many images (max 4)"
  - too many files: "too many files (max 8)"
  - unsupported: "unsupported file type: `<name>`"
  - unreadable image: "`<name>` could not be read as an image"
  - binary text: "`<name>` is binary (not a UTF-8 text file)" (unchanged)
- **Non-vision provider.** No capability metadata exists, so the panel does not
  pre-block. It attempts the send and, if the request **was rejected by the
  provider** (relayed HTTP error) while carrying image parts, it shows:
  "This model rejected the image(s). The selected model may not support image
  input — switch to a vision model and re-attach."
  For recovery it rewrites that failed user turn in `conversation`, replacing
  the image parts with a text stub naming them, so the next message does not
  fail the same way. Network, timeout, and aborted (Stop) failures keep the
  image parts so a retry still carries them.

### 4.7 Security and privacy

- Image bytes are read and re-encoded **locally in the browser**; there is no
  new upload step. They leave the machine only as base64 data URLs through the
  same admin-gated `POST /api/ai/chat` endpoint, to the same configured
  provider.
- No new server storage, no new route, no file is written. `config/ai.json` is
  unchanged (no image-capability field is required). `/api/ai/*` stays
  admin-only while auth is on, so viewer sessions cannot attach or send.
- The provider sees the image bytes; that is already true of every prompt. No
  claim of provider-side deletion is made.

---

## 5. Functional flows

**F1 — Attach.** The owner clicks 📎 or drags files onto the input (existing
handlers). Each file is classified image vs text-like. Caps are checked at
selection time and a slot/byte budget is reserved synchronously, so an
in-flight read cannot race the accounting. A rejected file produces its error
chip and reserves nothing. Send stays disabled while any read/downscale is
pending.

**F2 — Read / downscale.**
- Text: read to an ArrayBuffer, honour the BOM, decode; a NUL byte rejects as
  binary (unchanged). Enforce `TEXT_MAX_BYTES` per file and `TEXT_MAX_TOTAL`.
- Image: enforce `SOURCE_MAX_BYTES`; decode the image; apply the §4.2
  pass-through/downscale/re-encode rule; base64-encode the result. A decode or
  canvas failure rejects that chip only.
- Each file settles independently: one failure never removes a good chip.

**F3 — Chip.** The chip appears immediately ("reading…"), then shows the
thumbnail (image) or name/size (text), or an error chip if F2 failed. Remove
releases the reserved bytes/name and re-syncs Send.

**F4 — Send.** On submit, the pending list is snapshotted, then cleared, then
the turn is built: the text part = prompt + text-file inlines; one image part
per image. The user bubble shows the prompt, the text chips, and the image
thumbnails. The user turn is pushed to `conversation`.

**F5 — Provider.** `NB.api.aiChat` posts `{server, messages:[system, ...conversation]}`
to the admin-gated relay. The server validates a string **or** a content-part
array, whitelists as today, and relays the upstream SSE unmodified. Streamed
deltas render as today.

**F6 — Tool rounds.** After each assistant reply, tool calls run as today; the
next round re-uploads the full conversation, image parts included (§4.5).

**F7 — Clear.** Resets the conversation, the system cache, and the pending
attachments (unchanged), including image chips and thumbnails.

---

## 6. Edge cases and failure modes

| Case | Required behavior |
| --- | --- |
| PNG screenshot just over the old 32 KiB cap (the trigger) | Accepted; downscaled only if over `MAX_EDGE`/`TARGET_BYTES`; sent as an image part. |
| Image with empty MIME but a `.png`/`.jpg`/… extension | Accepted via extension fallback; decode is the final gate. |
| Text file with a `.png` name but text content | Passes the type gate, then image decode fails → "could not be read as an image". |
| `.txt` file containing a NUL (binary) | Rejected as binary (unchanged). |
| Image whose bytes cannot be decoded | Rejected as unreadable; other attachments unaffected. |
| Animated GIF | Accepted; the first frame is sent; if re-encoded, output is PNG. |
| SVG | Treated as text (inlined), not as a raster image. |
| Transparent PNG | Passed through unchanged if within budget; re-encoded to PNG (alpha kept). |
| Photo (JPEG) above the edge/size limits | Downscaled to ≤1600 px, re-encoded JPEG q0.85; if still >2 MiB, one more pass at 1024/q0.75; then rejected. |
| Source image >10 MiB | Rejected before reading. |
| 5th image, or 9th file of any kind | Rejected with the matching "too many" error; earlier chips stay. |
| Mixed text + images | Both caps enforced independently; text inlines go into the one text part; images follow. |
| Empty prompt with images only | Send is allowed (existing rule); the turn has image parts and no text part. |
| Prompt with images, no provider configured | The existing "no provider configured" error shows; nothing is sent. |
| Provider/model has no vision | Provider rejection is shown with the §4.6 recovery message; the failed turn's image parts become a text stub so later turns do not re-fail. |
| Network / timeout / Stop while images attached | Normal error or abort path; image parts stay in history for retry. |
| Duplicate names (image and text) | Disambiguated with the existing `" (n)"` suffix rule. |
| Combined wire size would exceed 12 MiB | Send refused before the request with a clear message; conversation unchanged. |
| `Clear` during an in-flight read | Epoch bump discards the stale read; no chip is added to the fresh list. |
| Viewer role while auth is on | `/api/ai/*` is admin-only, so the panel/attachments are unavailable as today; no 403 from a chip. |

---

## 7. Testable acceptance criteria

Each is a jsdom host test in `tests/dom/test_dom.js`, a `tests/test_app.py`
case, or a documented manual step. **Note:** jsdom has no canvas; downscale
criteria (4, 5, 18) need a stubbed canvas or are verified by the documented
manual step — the rest run headless.

1. **jsdom** — a PNG larger than the old 32 KiB cap (e.g. 200 KiB) attaches into
   a pending chip with a thumbnail and no error.
2. **jsdom** — an image file larger than `SOURCE_MAX_BYTES` (10 MiB) is rejected
   with the "larger than 10 MiB" error and no chip.
3. **jsdom** — an image already ≤ `MAX_EDGE` and ≤ `TARGET_BYTES` is sent with
   byte-identical content and its original MIME (assert pass-through).
4. **jsdom (stubbed canvas) / manual** — an image wider than 1600 px is
   downscaled so the sent bytes decode to an image whose longest edge ≤1600 and
   ≤ `MAX_BYTES`.
5. **jsdom (stubbed canvas) / manual** — a 3000×3000 PNG re-encodes to PNG (not
   JPEG) and stays within `MAX_BYTES`.
6. **jsdom** — a sent image-bearing user turn's `content` is an array whose
   first part is `{type:"text"}` and whose later parts are
   `{type:"image_url",image_url:{url:"data:image/<type>;base64,…"}}`.
7. **jsdom** — a text-only turn's `content` is still a plain string.
8. **jsdom** — mixed text+image attachments put every text inline in the single
   text part and one image part per image, in order.
9. **jsdom** — an image-only send (empty prompt) produces image parts with no
   text part.
10. **jsdom** — a 5th image is rejected with "too many images (max 4)"; the
    first four remain.
11. **jsdom** — a 128 KiB text file is accepted and a 128 KiB+1 text file is
    rejected with the size error; 512 KiB total is accepted and over is
    rejected with the total error.
12. **jsdom** — after sending an image turn, the second `aiChat` call's
    `messages` still contains the earlier `image_url` part (persistence).
13. **jsdom** — a stub upstream rejection on an image turn shows the "may
    not support image input" message; the transcript is **not** rewritten
    (§10 R1) — the image parts stay so a retry carries them.
14. **jsdom** — an unsupported file type still shows "unsupported file type";
    a NUL text file still shows the binary error.
15. **jsdom** — the Send button is disabled while an image read/downscale is
    pending and re-enables when it settles.
16. **jsdom** — `Clear` empties the pending attachments (image chips and
    thumbnails included) and the conversation.
17. **test_app** — `/api/ai/chat` accepts a user message whose `content` is an
    array of `text` and `image_url` parts and relays the request body
    unchanged; an array containing an unknown part type returns HTTP 400; a
    content that is neither a string nor an array still returns HTTP 400.
18. **manual** — with a configured vision model, attach a real screenshot, send
    it, and receive a description; browser devtools shows exactly one
    `POST /api/ai/chat` and no direct request to the provider.
19. **manual** — switch to a text-only model, attach an image, send it, see the
    recovery message, and confirm the following message succeeds with no images
    re-sent.
20. **test_app / manual** — no new file is written and `config/ai.json` is
    byte-identical before and after an image send (no server storage).

---

## 8. Constraints and dependencies

- **Backend contract change (required).** `/api/ai/chat` must accept a message
  `content` that is either a string or an array of content parts limited to
  `text` and `image_url`, validate every part, and pass the message through the
  existing whitelist. This is not optional: images cannot reach the provider
  without it. The whitelist rule (no client keys leak upstream) is preserved.
- **Upstream limits.** Request size: OpenAI ~50 MB, Anthropic ~32 MB; the
  `12 MiB` wire cap stays under both. Base64 inflation is `4/3` (~33%); every
  byte budget states decoded size and the wire guard is the serialized size.
- **Token cost.** Images cost far more tokens than their byte size suggests and
  are re-sent every turn/round (§4.5); the caps bound, but do not hide, this.
- **No capability metadata.** OpenAI-compatible endpoints expose no vision
  flag, so non-vision handling is recovery-based, not pre-emptive.
- **Browser-only image work.** Downscale/re-encode depends on canvas, which
  jsdom lacks; the affected tests need a stub.
- **Existing invariants preserved.** Attachment accounting stays synchronous
  (no read/accounting race); a failed chip removes only itself; `Clear`
  discards stale reads via the epoch.
- **Docs sync.** Attachment behavior is documented in the `ai.js` header
  comment; if this ships, that comment and `docs/architecture/ai-assistant.md`
  (Conversation memory section) must be updated in the same change. The
  renderer-version contract in `agent.md` / `ai.js` is unaffected.

---

## 9. Open questions

1. **Image persistence cost.** Persist and re-send every turn (pinned in §4.5)
   versus send images on the first turn only and replace them with a name stub
   afterward. The pinned choice is correct for follow-ups but multiplies cost by
   up to `MAX_TOOL_ROUNDS`. Owner: `architect` (cost model) with product
   confirming the follow-up behavior the owner actually needs.
2. **Per-provider "Supports images" hint.** Add an explicit checkbox in the
   Settings → AI profile (warn before the first failed send) versus relying on
   the recovery path. Affects scope; owner: product + `ui-designer`.
3. **Re-encode defaults.** Confirm `1600 px`, `768 KiB` target, and the
   format-preserving rule against a real vision provider's legibility. Owner:
   product, with `researcher` verifying provider guidance and `architect`
   confirming the canvas path.
4. **Text cap value.** `128 KiB` per file / `512 KiB` total is a first pass;
   confirm against real files the owner attaches. Owner: product.
5. **Recovery rewrite.** Confirm that replacing a failed turn's image parts with
   a text stub (rather than deleting the turn) is the right recovery, given
   there is no per-message delete today. Owner: product + `architect`.

---

## 10. Build resolutions (override §4/§9 on conflict)

Decision record from the adversarial review (challenger, 2026-10-12). These
supersede the pinned values above wherever they disagree.

- **R1 — Error plumbing and recovery (§4.6, §9.5).** Propogate `status` onto the
  error `api.js` throws for an in-band SSE `{error:true}`. `ai.js` does **not**
  rewrite the transcript. On a failed image-bearing send, show the "may not
  support image input" hint only when `err.status >= 400` (a provider
  rejection); network, timeout, and abort failures show the normal error. Image
  parts stay in `conversation` so a retry still carries them.
- **R2 — Image accounting (§4.2, §4.4).** Caps are per-item and independent;
  drop the separate 8 MiB "image total". Synchronous reservation covers the
  **slot count** and the per-image **source** cap; encoded-byte accounting
  settles when the read/encode completes, and a failed chip releases its slot.
  Values: `AI_ATTACH_MAX_IMAGES = 4`, `AI_ATTACH_MAX_FILES = 8` (text + image),
  `AI_ATTACH_IMAGE_SOURCE_MAX_BYTES = 10 MiB`, `AI_ATTACH_IMAGE_MAX_BYTES =
  2 MiB`, `AI_ATTACH_IMAGE_TARGET_BYTES = 768 KiB`, `AI_ATTACH_TEXT_MAX_BYTES =
  128 KiB`, `AI_ATTACH_TEXT_MAX_TOTAL = 512 KiB`, `AI_ATTACH_MAX_WIRE_BYTES =
  12 MiB` (send-time backstop). The body is bounded by 2 MiB × 4 images + 512
  KiB text + the wire guard.
- **R3 — jsdom test seam (§7, §8).** Expose an injectable image decode hook on
  `NB.ai` (for example `NB.ai._setImageDecoder(fn)`) that turns a `File` into
  `{width, height, dataUrl, bytes, mime}`. Production uses canvas; tests stub
  it. Criteria needing the stub: 1, 3, 4, 5, 6, 8, 9, 10, 12, 13, 15, 16.
- **R4 — Paste (§1, §2).** Add a `paste` listener on the input so clipboard
  images and text files go through the same `addFiles` path. Copy-screenshot →
  paste is the trigger workflow.
- **R5 — Decompression guard (§4.2).** After decode, reject when
  `width * height > AI_ATTACH_IMAGE_MAX_PIXELS` (40 MP) before drawing to the
  canvas.
- **R6 — Wire MIME (§4.1, §4.2).** The data-URL MIME is the decoder/canvas
  output type, taken from the actual bytes, never the filename or claimed MIME.
  Bytes that do not decode as an image are rejected as unreadable regardless of
  name or extension. A `text/plain` file named `.png` therefore fails as
  unreadable — an intended change from today's text behavior.
- **R7 — Re-encode defaults (§9.3).** `AI_ATTACH_IMAGE_MAX_EDGE = 1568` px,
  target 768 KiB, hard cap 2 MiB; second pass at 1024 px / q0.75, then reject.
  PNG stays PNG (alpha kept; no destructive JPEG fallback). Animated GIF
  pass-through sends original bytes; a re-encode flattens to the first frame as
  PNG. Canvas re-encode drops metadata; EXIF orientation relies on browser
  auto-orientation.
- **R8 — Backend validation (§8).** Rebuild every message to `{role, content}`
  strictly (per-message extras stripped). `content` is a string, or a non-empty
  list of parts. Parts: `{"type":"text","text":<str>}` →
  `{"type":"text","text":...}`; `{"type":"image_url","image_url":{"url":<str
  starting "data:image/">}}` → `{"type":"image_url","image_url":{"url":...}}`.
  Any other type or shape → HTTP 400. Image parts allowed only on `user`
  messages, at most 8 per message. Set `app.config["MAX_CONTENT_LENGTH"] = 32
  MiB` to bound the request body.
- **R9 — "Supports images" hint (§9.2).** Deferred; not in the MVP.
- **R10 — Persistence (§9.1).** Images stay in `conversation` and are re-sent
  every turn and tool round (no auto-rewrite, per R1).
- **R11 — Docs sync (§8).** Update the `ai.js` header comment and
  `docs/architecture/ai-assistant.md` in the same change.
- **R12 — Existing tests.** Rewrite the assertions in
  `tests/dom/test_dom.js` that pin 32 KiB / 96 KiB / file-cap 5 (the `ai attach`
  block) to the new caps. `test_app.py` `TestAiChat.test_chat_validates_messages`
  gains array-content cases.
