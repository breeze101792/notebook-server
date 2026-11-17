# Feature design: image attachments for the ACP provider

**Author:** design
**Date:** 2026-11-17
**Status:** Implemented on 2026-11-17 (`app.py`, `acp_client.py`,
`static/js/ai.js`, the stub agent, and the backend/DOM suites). §11's current
docs were updated in the same change; the line numbers there are the pre-change
locations, kept as a record of the sweep.
**Facts:** [`docs/research/acp-image-input.md`](../../research/acp-image-input.md)
(spec shape, capability path, SDK 0.12.1, per-agent support).

---

## 0. One-line definition

A user who picks an ACP profile in the ✨ panel can attach images, and those
images reach the agent as ACP `image` content blocks in the `session/prompt`
request — the same browser-side read, downscale and re-encode the OpenAI path
already uses.

---

## 1. Decisions

| ID | Decision | Why | Rejected alternative |
| --- | --- | --- | --- |
| D1 | **No capability gate — an accepted, documented deviation from the ACP client MUST.** The server reads `promptCapabilities.image` after `initialize` (so it *is* known before the prompt is sent) and deliberately does not block on it; the image block is sent either way. | The user's call: the OpenAI path forwards images to any configured model without a pre-check and surfaces the failure. Blocking would make ACP the only provider that refuses before trying. The spec says a client MUST restrict content to the advertised capabilities, so this is a knowing non-conformance; the blast radius is undefined agent behaviour (research §5: some return `-32602`, some ignore the block). | Gate the turn when the flag is false (rejected by the user; kept as the fallback if `opencode` or another shipped agent turns out to mishandle the block). |
| D2 | **Only one turn's images are sent, enforced on both sides.** The client keeps image parts only on the newest user entry that is not a tool follow-up (`toolMessages` tracks those); the server takes the newest user message that carries any image part — the same turn, because the client collapses older image-bearing messages to text. Earlier images stay in the browser conversation, text-only on the wire. | ACP takes one prompt, not a message array. Re-sending every historical image would re-upload the data URL on every turn, trip the client's 12 MiB wire guard on later text-only turns, and re-send megabytes the server then discards. | Send every image in the transcript (rejected: wire-size blow-up, see M1 in the review). |
| D3 | **The server parses the data URL.** The browser keeps sending OpenAI-compatible `image_url` parts; `app.py` splits `data:<mime>;base64,<payload>` into `mimeType` + `data`. | One request shape for both provider kinds. The browser already owns resize/re-encode; the server only rewrites the wrapper. | A second client-side wire format for ACP (rejected: duplicate composer logic, two size paths). |
| D4 | **The capability flag is read for error wording only.** After `initialize`, read `agentCapabilities.promptCapabilities.image` defensively (any level may be absent or `null`; absent means unknown, not false). If the `session/prompt` call specifically fails (or completes with `stopReason == "refusal"`) while images were sent and the flag was `false`, report "ACP agent does not accept image attachments" instead of the generic "ACP turn failed". | Costs a few lines, turns an opaque failure into an actionable one, and does not change what is sent. | Never read the flag (rejected: an unsupported agent fails opaquely). |

---

## 2. Scope

**In scope**

- `POST /api/ai/chat` with an ACP profile accepts `image_url` content parts on user turns.
- The ACP client sends `[text block, image block, …]` in `session/prompt`.
- The attach control offers images while an ACP provider is active.
- Validation, limits, and failure messages for the ACP image path.
- Tests and doc updates listed in §9–§11.

**Out of scope**

- Image *output* from an agent (`agent_message_chunk` stays text-only; an agent
  that returns an image block in its reply has it dropped, unchanged from today).
- Audio blocks, embedded resources (`embeddedContext`), and `resource_link`
  hand-off of images.
- Agent capability probing at config load, and any per-profile UI badge.
- The OpenAI path's request shape, limits, or resize pipeline — unchanged.
- The notebook's six `nb-tool` contract — ACP agents still run their own tools.

---

## 3. Flow

1. User attaches a PNG/JPEG/WebP/GIF in the panel. Browser reads, downscales and
   re-encodes it; the chip holds a data URL (`static/js/ai.js:2481-2530`).
2. `composeUserContent` builds
   `[{"type":"text","text":…},{"type":"image_url","image_url":{"url":"data:image/png;base64,…"}}]`
   (`static/js/ai.js:2212-2222`) — unchanged for both provider kinds.
3. `send()` posts `{server: <acp profile name>, messages, workspace?}` to
   `POST /api/ai/chat`. For an ACP profile, `buildRequestMessages` keeps image
   parts only on the newest genuine user entry (`lastUserTurnIndex`, which skips
   `toolMessages`) and rewrites every older image-bearing message to its text
   (D2).
4. `ai_chat` matches the name to an ACP profile and calls `_acp_chat_response`
   (`app.py:3282-3286`).
5. `_validate_chat_messages(..., drop_system=True)` runs unchanged
   (`app.py:3166`). Image parts are still allowed only on user turns, at most
   `AI_CHAT_MAX_IMAGE_PARTS` per message.
6. **New** `_acp_prompt_images(clean_messages)` walks the messages from the end
   and takes the newest `role == "user"` message **that carries any image part**.
   It parses and validates each part (§5) and returns
   `[(mime_type, base64_payload), …]` in parts order. A tool follow-up is a
   `role:"user"` message with no image part, so it is skipped — the newest
   image-bearing turn still wins inside the tool loop.
7. `prompt` is still
   `_acp_context_preamble(workspace_id) + "\n\n" + _flatten_acp_prompt(...)`,
   still capped at `ACP_MAX_PROMPT_BYTES`.
8. **New** `acp_client.run_turn(..., images=[…])` → `_drive` sends
   `prompt=[text_block(prompt), image_block(data, mime_type), …]`.
9. The SDK serializes each image block as
   `{"type":"image","mimeType":"image/png","data":"<base64>"}` inside the
   newline-delimited JSON-RPC `session/prompt` params on the child's stdin.
10. Reply streaming, trace frames, Stop, timeout and the kill ladder are
    unchanged.

---

## 4. Contract — `session/prompt` content

| Position | Block | Source |
| --- | --- | --- |
| 1 | `text_block(prompt)` | preamble + flattened transcript (§3 step 7) |
| 2..n | `image_block(data=<base64>, mime_type=<mime>)` | the newest image-bearing user turn's `image_url` parts, in order |

- `uri` is not set: the image has no file path on the host.
- No image block is emitted when no user message carries an image part.
- The text block always comes first. ACP does not require ordering, and a
  single leading text block keeps the flattened transcript readable in agent
  logs.
- System turns remain dropped; the preamble still rebuilds that context
  (`app.py:3097-3133`).

**REQ-ACPIMG-001** — An ACP turn whose newest image-bearing user message carries
N image parts sends exactly N image blocks, each after the single text block,
with `mimeType` equal to the data URL's media type and `data` equal to its
base64 payload.

**REQ-ACPIMG-002** — The `session/prompt` params never contain an `image_url`
part, a data URL, or an image block taken from any turn other than the newest
image-bearing user message. Within one user turn, an appended tool follow-up
(a `role:"user"` message with no image part) does not remove the blocks.

**REQ-ACPIMG-003** — An ACP turn with no image part in any user message sends
exactly `[text_block]` — byte-identical to today's request.

**REQ-ACPIMG-004** — The browser's ACP request body carries `image_url` parts
only on the newest genuine user entry; every older image-bearing message is
sent as text. The body therefore does not grow with the number of historical
images.

---

## 5. Validation and limits

Applied in `_acp_prompt_images`, before the agent is spawned. A violation is a
JSON **400** (not an SSE error), so nothing is executed.

| Check | Rule | Constant |
| --- | --- | --- |
| Media type | One of `image/png`, `image/jpeg`, `image/webp`, `image/gif` (lowercase; the shared validator already rejects a non-`data:image/` URL before this) | `ACP_IMAGE_MIME_ALLOW` |
| Encoding | Header is exactly `data:<mime>;base64`, payload is valid base64 with no whitespace | — |
| Payload | Non-empty after decode, and re-encodes to itself (rejects a truncated or padded string) | — |
| Signature | The decoded bytes start with the declared format's magic bytes (PNG, JPEG, GIF, WebP) | `ACP_IMAGE_SIGNATURES` |
| Count | ≤ `AI_CHAT_MAX_IMAGE_PARTS` (8) image parts in that message | reused, `app.py:2449` |
| Per image | Decoded payload ≤ 4 MiB; the base64 length is checked first so the decode is bounded | `ACP_MAX_IMAGE_BYTES` |
| Per turn | Decoded payloads ≤ 12 MiB total, bounded before each decode | `ACP_MAX_IMAGE_TOTAL_BYTES` |

The signature check is not cosmetic: the media type is a label the sender chooses, so
without it any bytes reach the agent's decoder. The length gate runs before
`b64decode`, so a 32 MiB body cannot force a 24 MiB decode plus a 32 MiB
re-encode per part (the per-image and per-turn caps are enforced twice: once
from the encoded length, once from the exact decoded length).

Rationale for the numbers: the browser re-encodes to ≤ 2 MiB per image and at
most 4 images per message (`static/js/ai.js:101-107`), so the *effective* limit
is the client's 12 MiB wire guard; the server caps are a backstop for a client
that does not resize, and they sit above the browser's 8 MiB worst case so a
legal browser turn never trips them. Both are new constants, placed beside
`ACP_MAX_PROMPT_BYTES` (`app.py:2350`).

Strictness note: a data URL carrying newlines inside the payload is accepted by
the OpenAI path today and rejected here. The browser never emits whitespace, and
a base64 string broken across lines is ambiguous to re-wrap, so the ACP branch
is strict. This asymmetry is intentional and stated in §7's messages.

`ACP_MAX_PROMPT_BYTES` keeps counting **text only**. Image bytes are bounded by
the caps above, and the whole body by `MAX_REQUEST_BYTES`.

---

## 6. Behaviour on failure

| Case | Where | Result |
| --- | --- | --- |
| Agent advertises `image: false` | `_drive`, after `initialize` | No pre-block (D1). Images are sent; the flag is kept for wording only. |
| `session/prompt` call throws, images were sent, flag was `false` | `_drive`, around the prompt await only (not `initialize`/`new_session`) | SSE `event: error`, message `"ACP agent does not accept image attachments"` (D4). |
| Prompt completes with `stopReason == "refusal"`, images were sent, flag was `false` | `_drive`, after the prompt returns | Same message, emitted instead of `done`. A refused block otherwise renders an empty bubble. |
| Prompt fails or refuses with flag `true`/unknown | unchanged | `"ACP turn failed"` / normal `done` |
| Bad media type / encoding / size / count | `_acp_prompt_images` | HTTP 400 before spawn (§7). The client suppresses its OpenAI "switch to a vision model" hint on 400 for an ACP provider (§8.3). |
| The user switches to an ACP profile with an image already in the transcript | browser | The image is not stripped from the *conversation*; it is stripped from older wire messages (D2). No notice is shown. Switching back to an OpenAI profile sends it again. |

The failure is per turn: because the client sends only the newest turn's images
(D2), one failed image turn does not poison later turns. That is the one place
this design deliberately differs from the OpenAI path.

`_drive` currently wraps the whole spawn/initialize/session/prompt sequence in
one `except Exception` (`acp_client.py:285-287`). The D4 branch must be a
nested `try` around `asyncio.wait_for(conn.prompt(...))` (and the `refusal`
check after it), never the outer handler — otherwise an auth or `session/new`
failure on an image-bearing turn is misreported as an image problem.

---

## 7. Error strings (ACP image branch)

Every string is a JSON body `{"error": "…"}` with status 400 unless noted.

| Condition | Message |
| --- | --- |
| Not `data:image/<allowed>;base64,` | `ACP image attachments must be a data:image/(png|jpeg|webp|gif);base64 URL` |
| Invalid base64, whitespace, or empty payload | `ACP image attachment is not valid base64` |
| Decoded bytes do not match the declared format | `ACP image attachment content does not match its media type` |
| Per-image cap | `ACP image attachments are limited to 4 MiB each` |
| Total cap | `ACP image attachments are limited to 12 MiB per turn` |

The existing "at most 8 image_url parts per message" error from
`_rebuild_chat_message` already covers the count and stays as-is.

---

## 8. Module changes

### 8.1 `app.py`

| Item | Change |
| --- | --- |
| `ACP_MAX_IMAGE_BYTES`, `ACP_MAX_IMAGE_TOTAL_BYTES`, `ACP_IMAGE_MIME_ALLOW`, `ACP_IMAGE_SIGNATURES`, `ACP_IMAGE_WEBP_*` | New, beside `ACP_MAX_PROMPT_BYTES` (`app.py:2350`) |
| `_image_signature_ok(mime, decoded)` | New. Magic-byte check for the four allowed formats. |
| `_acp_prompt_images(messages)` | New. Walk from the end; take the newest `role == "user"` message whose content list holds at least one `image_url` part. Parse, validate (§5), return `([(mime, b64)], None)` or `(None, error_response)`. No image part anywhere → `([], None)`. |
| `_acp_chat_response` | Delete the 400 loop (`app.py:3173-3177`). Call `_acp_prompt_images`; pass `images=` to `run_turn`. |
| `_flatten_acp_prompt` | Unchanged behaviour (text only). Fix the docstring line "Image parts never reach here (rejected earlier)" (`app.py:3080`). |

`_rebuild_chat_message` and `_validate_chat_messages` are unchanged: they are
shared with the OpenAI path and already accept the parts. Note that the shared
validator already 400s a non-`data:image/` URL (`app.py:3038`) and an image part
on a non-user role, so `_acp_prompt_images` only sees user-owned
`data:image/…` URLs.

### 8.2 `acp_client.py`

| Item | Change |
| --- | --- |
| import | `from acp import spawn_agent_process, text_block, image_block` |
| `run_turn(..., images=())` | New keyword: a sequence of `(mime_type, base64_data)` tuples. Flask-free; no data-URL parsing here. |
| `_drive(..., images)` | Build `blocks = [text_block(prompt)] + [image_block(data, mime) for mime, data in images]`; pass `prompt=blocks`. |
| `_drive`, after `initialize` | `_image_capability(init)`: read `agentCapabilities.promptCapabilities.image` from the model's `model_fields_set`, because the SDK fills a default instance (with `image: false`) when the agent omits the field. Absent or `null` at any level means unknown (`None`) and is never treated as `False`. |
| `_drive`, prompt call | Wrap `asyncio.wait_for(conn.prompt(...))` in its own `try`. On failure with `images` and `image_ok is False`, record the D4 message; otherwise re-raise into the existing handler. After success, if `stop_reason == "refusal"` with the same conditions, record the D4 error instead of `done`. |
| docstring | State that images are blocks 2..n, that the capability is diagnostic only (D1 deviation), and that the prompt call owns the D4 branch. |

No change to permissions, timeouts, the queue, or the kill ladder.

### 8.3 `static/js/ai.js`

| Item | Line | Action |
| --- | --- | --- |
| `AI_ATTACH_TEXT_ACCEPT` | 145-148 | remove (no `accept` filter for any provider) |
| `acpImageNoticeShown` | 883-884, 1671, 1841 | remove the flag and its resets |
| `activeServerIsAcp` | 1523-1525 | **keep** — still needed by the 400-hint guard (M4) and by `buildRequestMessages` |
| `buildRequestMessages` | 1527-1545 | keep the ACP branch, change what it does: keep image parts only on `conversation[lastUserTurnIndex()]` (remember the `[getSystem(), ...conversation]` offset of one), collapse every *other* image-bearing message to its text. Return `{messages}` without `strippedImages`; update the two callers (`runToolLoop:1716-1717`, `onSubmit:2657-2660`). |
| `showAcpImageNotice` | 1549-1558 | remove |
| `send()` strip block and `lastSentFiles` slice | 1675-1682, 1696 | remove the strip; `lastSentFiles = files.slice()` so Edit/Regenerate restore what the user picked |
| `syncAttachAffordance` | 2346-2356, **2309**, **2636-2637** | keep the function, reduced to one behaviour: remove `accept`, label "Attach files". Keep both callers. Do **not** delete the function or the `mountSyncAttachAffordance` hook — `sel`'s change listener (`:2309`) calls it directly and would throw. |
| `runToolLoop` 400 hint | 1745-1764 | do not show "switch to a vision model" when `activeServerIsAcp()`; the ACP 400 means a bad data URL or size, not a missing vision model |
| `refreshServerBar` affordance calls | 2790, 2804 | keep (harmless; the function no longer branches) |

The chip list, image read/resize, `composeUserContent`, the wire-size guard,
history persistence and the OpenAI path are untouched. The only provider
difference left on the client is which messages carry image parts (D2) and the
suppressed vision hint (M4).

---

## 9. Tests

| ID | Layer | Test | REQ |
| --- | --- | --- | --- |
| T-001 | backend (stub ACP) | One image → the stub records two blocks, `text` first then `image` with the expected `mimeType` and decoded byte length | REQ-ACPIMG-001 |
| T-002 | backend | Two images → three blocks, image order preserved | REQ-ACPIMG-001 |
| T-003 | backend | Image turn + a following tool follow-up (`role:"user"`, string, no parts) → the image blocks are still sent. A second case: an older image turn plus a newer image turn → only the newer turn's blocks | REQ-ACPIMG-002 |
| T-004 | backend | No image part anywhere → the stub records exactly one `text` block (a real count, not "the stream still works") | REQ-ACPIMG-003 |
| T-005 | backend | Agent advertising `image:false` still receives the image block; the turn completes | D1 |
| T-006 | backend | `image:false` + the prompt call returns a JSON-RPC error → SSE `ACP agent does not accept image attachments` | D4 |
| T-007 | backend | `image:true` + the prompt call errors → `ACP turn failed` (**negative control** for D4); an agent that sends no `promptCapabilities` and errors → also `ACP turn failed` (silence is unknown, not `false`) | D4 |
| T-008 | backend | `data:image/svg+xml`, `data:image/bmp`, missing `;base64`, empty payload, whitespace in payload, non-base64, and a PNG label over non-PNG bytes → 400 with the matching §7 message; stub pidfile absent | §5 |
| T-009 | backend | Per-image and total byte caps at the boundary (cap passes, cap+1 → 400) | §5 |
| T-010 | client unit | `run_turn(images=[…])` against the stub: two blocks with the right fields; `images=()`: one block | REQ-ACPIMG-001/003 |
| T-011 | DOM | ACP: no `accept` filter on `#ai-attach-input`; the ACP body carries `image_url` on the newest genuine turn and text-only for older image turns; no `.ai-error` notice; no "switch to a vision model" hint on a 400 | REQ-ACPIMG-004, M4 |
| T-012 | DOM | OpenAI path unchanged: history images still sent on every request | regression |
| T-013 | backend (stub transport) | A 3 MiB image round-trips through the real stdio transport: the stub decodes the full payload (R3) | R3 |
| T-014 | manual, host | One real image turn against `opencode acp` via `tests/manual/acp_real_opencode_check.py`, and one against an `image:false` agent if one is installed | end to end, D1 |
| T-015 | browser | ACP Phase B (`tests/browser/test_ai_editor_browser.js:599-669`) still passes, no `.ai-error` — **regression only**, it sends no image | regression |

**Fixture work.** `tests/fixtures/stub_acp_agent.py`:

- `initialize` (`:363-367`) advertises `agentCapabilities.promptCapabilities.image` per mode, and supports `"agentCapabilities": null` and a capabilities object with no `promptCapabilities` at all (both "unknown" cases).
- `_prompt_blocks(params)` returns `blocks=text,image:<mime>:<decoded bytes>,…`
  in arrival order, streamed as the reply so T-001–T-005, T-010 and T-013 assert
  on the agent's own view of the request, not on the client's.
- Modes/flags: `image` (`true`), `image-nocap` (`false`), `image-reject`
  (`false` + prompt error, T-006), `image-refuse` (`false` + `refusal`),
  `image-error` (`true` + prompt error, T-007), `image-silent-error` (no
  `promptCapabilities` + prompt error, T-007), `capnull` (`null`), plus
  `capnull`/silence coverage at the client level (T-010).
- Test fixtures use real magic bytes: a PNG label over `abcd` is now a 400, so
  every accepted payload starts with the format's signature.
- The stub reads `session/prompt` params with `readline` so a multi-MiB base64
  line is exercised, not truncated (T-013).

**Tests to rewrite, not keep:** `test_image_attachment_rejected_400`
(`tests/test_app.py:4441`) asserts the removed behaviour; it becomes T-001,
and its "no process spawned" assertion moves to T-008. The DOM block
`tests/dom/test_dom.js:35525-35632` (the `"text/*"` assertion at `:35556-35559`,
the strip/notice assertions, and `:35626`'s "history image removed") is
rewritten per T-011/T-012: the new expectation is *older turns text-only, newest
turn image-bearing*, not "all images gone".

**Keep:** `test_flatten_acp_prompt_handles_parts_and_unknown_content`
(`tests/test_app.py:4957`) still holds — `_flatten_acp_prompt` stays text-only.
The preamble tests (`:4391-4435`) and the two-delta stream test (`:4321`) do
not change, but `:4321` is not used as proof of T-004.

---

## 10. Trace

| REQ | Proof |
| --- | --- |
| REQ-ACPIMG-001 | T-001, T-002, T-010 |
| REQ-ACPIMG-002 | T-003 |
| REQ-ACPIMG-003 | T-004, T-010 |
| REQ-ACPIMG-004 | T-011, T-012 |
| §5 limits | T-008, T-009 |
| D1 no gate | T-005, T-011 |
| D4 wording | T-006, T-007 |
| M3 null capabilities | stub mode in T-010 |
| R3 large line | T-013 |
| End to end | T-014 (manual, host) |

Everything in §5 and §9 is host-verifiable except T-014, which needs a real
agent binary and credentials. T-014 is **unverified** in CI by design;
`tests/manual/` is not collected. Nothing in CI proves that a real agent accepts
the block (R5).

---

## 11. Current docs to update in the same change

These currently state the opposite. Each line number is as of 2026-11-17.

| File | Lines | Change |
| --- | --- | --- |
| `README.md` | 181-183 | ACP agents do take images; delete the "take no images" paragraph, and state the newest-turn rule |
| `CLAUDE.md` | 254-257 | Provider strips images / server 400 → describe the block conversion and the newest-turn rule |
| `agent.md` | 134-135 | Add that an ACP turn accepts `image_url` parts on the newest user turn |
| `PLAN.md` | 435-436 | Still says images are stripped for ACP turns; mark historical or update |
| `docs/requirements/features/acp-provider.md` | 119, 197, 230-231, 274, 312, 347-348, 410-417, 611-613 | Replace the image row/AC with a pointer to this file |
| `docs/architecture/ai-assistant.md` | ACP section | Describe the image block path, the newest-turn rule, and the D1 deviation |
| `docs/contracts/http-api.md` | 469, 484 | `image_url` is accepted on the newest user turn; list the §7 errors; record the D1 non-conformance note |
| `docs/ui/ai-panel.md` | 187, 659, 689, 723, 1702, 1771 | Attach is image-capable; delete the notice row and the "No image input for ACP" prohibition; **replace AC5** with "ACP shows its badge and note, and the attach control accepts images"; fix the stale `ai.js` line refs |
| `docs/testing/backend.md` | ACP test list | Add T-001–T-010, T-013 |
| `docs/testing/frontend.md` | ACP DOM block | New DOM expectations (T-011, T-012) |
| `docs/README.md` | requirements table | This file's row + status |

`docs/ui/guidelines.md` needs no change: this removes an affordance restriction
and adds no token, component, or state.

---

## 12. Risks

| ID | Risk | Mitigation |
| --- | --- | --- |
| R1 | An agent whose *model* lacks vision accepts the block and returns a confused text answer, not an error. | Nothing to gate on: the agent's `image` capability describes the protocol, not the model. The message reaches the user; same as an API provider with a text-only model. |
| R2 | A user expects an earlier image ("the diagram above") to be visible on a later turn. | D2 sends only the newest turn. The reply will say it cannot see it; the fix is to re-attach. Documented in README's ACP section. |
| R3 | Base64 in the JSON-RPC line makes a very large single line. | Per-image (4 MiB) and per-turn (12 MiB) decoded caps; the browser's 12 MiB wire guard binds first. Proven through the real stdio transport by T-013. |
| R4 | The 4/12 MiB caps drift from the browser's 2 MiB re-encode cap. | Both numbers live in one table (§5) and are asserted at the boundary by T-009. |
| R5 | **D1 is a knowing breach of an ACP client MUST.** An agent may reject the prompt (`-32602`), ignore the block, or behave in any undefined way; the spec does not define it. | Accepted by the user for parity with the OpenAI path. The failure is contained to one turn (D2), the D4 wording makes it actionable when the agent advertised `false`, and the fallback is one line: restore the gate in `_drive`. T-014 is the only end-to-end evidence, and it runs by hand. |
| R6 | An image stays in a long transcript, so `Edit`/`Regenerate` can re-send it after a failure. | Intended: the image belongs to the newest genuine turn, and re-sending it is the retry the user asked for. |
| R7 | Image bytes now leave the browser on an ACP turn; real agents persist session transcripts (e.g. opencode's session store) under the server user's home, surviving a browser history clear. | Deliberate consequence of sending images at all; it stays inside the server user's own files and crosses no trust boundary. Documented so data-at-rest is a policy choice, not a surprise. |

---

## 13. Open questions

None blocking.

- D1 is the one decision to re-check at the first real-agent run (T-014). If
  `opencode acp` rejects or ignores an image block, restore the gate in
  `_drive`: `if images and image_ok is False: record the D4 error and return`
  before the prompt. The rest of the design is unaffected.
- Two calls the implementer may revisit without changing the contract: the
  exact per-image cap (4 MiB) and whether D4's wording is worth keeping.
