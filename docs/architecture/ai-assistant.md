# AI assistant

## Overview

An optional built-in assistant that reads the notebook and proposes edits
for review. It is not a context-free chat: it runs an agentic tool loop,
so it can list and read notes, fetch URLs, search the web, and propose
file changes. Siblings: [backend.md](backend.md) for the server-side
proxy routes and [markdown.md](markdown.md) for the renderer contract the
system prompt documents.

The assistant lives in the ✨ side panel. Its host is
`<div id="ai-view" class="side-panel-view" data-view="ai">` in
`templates/index.html`; `static/js/ai.js` mounts the view, owns the
conversation, and runs the tool loop.

It talks to any OpenAI-compatible `/v1/chat/completions` endpoint through
the server-side SSE route `POST /api/ai/chat`
(`static/js/api.js:102`, `app.py:1434`). Provider profiles live in
`config/ai.json`. The stored API key is never echoed to the browser
(`_public_ai_config`, `app.py:1263`), but it is attached to the upstream
request sent to whatever `base_url` the saved profile names. All `/api/ai/*`
routes are admin-only **only while auth is on**; because `admin_required`
returns the view unguarded when auth is off (the default), an open server
lets any LAN client read or rewrite the profiles and spend the stored key.
See [Security posture](backend.md#6-security-posture).

## Provider setup

Open Settings → AI. The tab is admin-gated while auth is on, and live.

- Add a provider profile: name, base URL, model, and API key (the AI
  section's element refs start at `settings.js:986`; the Add-provider
  handler is `settings.js:1390-1466`).
- Mark one profile as the default (`make default`), or Edit and Remove a
  profile.
- Test a profile: the `Test` button calls `GET /api/ai/probe?server=<name>`
  and reports reachable or unreachable. An upstream HTTP error, including
  401, counts as reachable; only a connection failure reports unreachable
  (`app.py:1393`).
- Custom prompt: global text appended to the built-in contract. It can
  steer style and focus but cannot invent tools (see `customPromptSuffix()`).
- Web search: sets the SearXNG instance URL used by the search tool.

Editing a profile never re-sends the stored key. A blank API key plus
`replaceSecret: true` carries the previous key over server-side
(`app.py:1245`).

## The six tools

The tools are declared in `systemPrompt()` and
called by the model as fenced ` ```nb-tool ` JSON blocks.

| Tool | What it does | Runs |
| --- | --- | --- |
| `list` | Enumerates the note tree. | automatically, shown as a trace line |
| `read` | Fetches one note's content. | automatically |
| `fetch` | Fetches a URL server-side via `/api/ai/fetch`, which is CORS-safe. | automatically |
| `search` | Queries the configured SearXNG instance via `/api/ai/search`. Fails if no instance is configured. | automatically |
| `write` | Creates a NEW file. | needs permission (Apply/Reject card) |
| `patch` | Edits an existing file through a batch of `/api/edit` ops. | needs permission (Apply/Reject card) |

The model's own rules, stated in `systemPrompt()`:

- To update an existing file it MUST use `patch`. A `write` call on an
  existing path is blocked client-side.
- In a patch, `find` must match the file exactly and appear exactly once,
  whitespace included.
- Read the relevant files before proposing patches; never invent content.
- One logical change per patch call; several calls are fine.

## The tool loop

`send()` (with `runToolLoop()`) runs a bounded loop around the SSE relay:

1. The user message is appended and sent with the full conversation.
2. The assistant reply streams in. Any ` ```nb-tool ` blocks are parsed out
   (`collectFenced(text, "nb-tool")`).
3. Read-only tools (`list`, `read`, `fetch`, `search`) run immediately and
   their results are pushed back as tool-result user messages, so the
   model continues in the next round.
4. `write` and `patch` become permission cards (`makePatchCard()` /
   `makeWriteCard()`). The
   loop stops there until the user clicks Apply or Reject, so a card is
   never left behind a completed turn.
5. `MAX_TOOL_ROUNDS = 5` caps the fan-out per user
   turn.

When the model returns prose with no tool blocks, the turn ends.

### Regenerate / Retry / Edit

Once a turn finishes — succeeded, errored (provider rejection or network),
or stopped — the newest turn carries two controls: the newest assistant
bubble gets a **↻ Regenerate** footer button, and the newest genuine user
bubble gets a **✎ Edit** button. They share a `.ai-turn-control` marker
class and the disable logic (`updateTurnDisabled`).

**Regenerate** (`regenerate` in `static/js/ai.js`) re-runs the model on the
latest genuine user turn and replaces that turn's assistant reply.

- The user turn is re-sent unchanged, so an image-bearing turn keeps its
  image parts and a provider rejection can be retried after a model switch
  or a config fix (§10 R1).

**Edit** (`editLastMessage`, exposed as `NB.ai.editLastMessage`) drops the
last turn and restores its input to the composer for editing:

- It removes the user bubble and everything after it, trims `conversation`
  to `slice(0, lastUserTurnIndex())` (before the user turn), then puts the
  last sent prompt back in the textarea, focuses it, and restores the last
  sent attachments into the pending bar (`restoreAttachments`). It never
  auto-sends — the user edits and presses Send.
- `restoreAttachments` rebuilds the chips (text and image thumbnails) and
  the slot/byte reservations from the already-read entries, without
  re-reading or re-decoding. The entries come from module state
  (`lastSentPrompt` / `lastSentFiles`, captured in `send()`), never from
  the conversation: conversation entries serialize into the request body,
  so extra keys there would duplicate an image's base64.
- Edit does not silently discard work: because `restoreAttachments` clears
  the attach bar and `composerSetPrompt` overwrites the textarea, the Edit
  control is disabled whenever the composer holds a non-empty draft or any
  pending attachment chips (title: "Clear the draft and attachments
  first"), and re-enables once the draft is emptied/sent and the chips are
  removed. Regenerate is unaffected by this guard.
- Edit is a no-op — and both controls are disabled — while a request is in
  flight, while attachment reads are pending, or while a write/patch
  permission card is unresolved; resolving the card re-enables them.
- After Edit trims the tail, the now-newest previous turn has no controls;
  `restoreTurnControls()` re-adds both (removing any existing set first).

Shared behavior:

- Only the newest turn has controls: `runToolLoop()` calls
  `removeTurnControls()` before every new turn (send, regenerate, or edit
  via `clearLastTurnDom`), stripping any existing `.ai-turn-control`.
- Replacing a turn clears the **whole DOM tail** after the last user
  bubble, not just `.ai-msg` nodes. `runAutoTool` appends `.ai-tool-trace`
  lines directly to the log, so a Regenerate that removed only `.ai-msg`
  siblings left stale duplicate trace lines; `clearLastTurnDom()` removes
  every sibling (assistant bubbles, traces, errors, cards, controls). It is
  shared by Regenerate (keeps the user bubble) and Edit, which additionally
  removes the user bubble itself (`clearLastTurnDom(log, true)`) since the
  next send re-creates it.
- `lastUserTurnIndex()` finds the turn structurally: every tool follow-up
  and `recordToolOutcome` push goes through `pushToolMessage()`, which tags
  the entry in a module-level `toolMessages` WeakSet. The index returns the
  last `role: "user"` entry not in that set, so a genuine prompt whose text
  merely starts with "(tool " is no longer misclassified. The WeakSet adds
  nothing to the entry, so the wire body stays `{role, content}`, and a
  content-part array (an image turn) is never tagged, so it is always
  genuine.
- Every tool round re-checks the wire cap (`wireSizeOfMessages()`) before
  sending; an oversize request (e.g. a near-limit image turn that grew with
  tool follow-ups) shows the too-large error and stops the turn without
  sending. Regenerate inherits this through `runToolLoop()`.

## Reviewing edits

Nothing is written until the user clicks Apply. `write` and `patch` always
surface as Apply/Reject cards.

- A patch card shows the proposed ops and a color-coded diff with dual
  line numbers and a `@@` hunk header (`buildDiffEl()`).
  The diff is a client-side preview computed by `previewPatch()`,
  which simulates the literal `find_replace`,
  `append`, and `prepend` ops. Ops it cannot simulate show an ops summary
  instead of a diff.
- Applying a patch calls `/api/edit` (`file_edit` route, `app.py:1795`).
  The server re-reads the file and re-applies every op against the
  current content, so a stale `find` (zero matches) fails closed with
  HTTP 400 (`_edit_find_replace`'s zero-match raise at `app.py:390`,
  mapped to 400 at `app.py:1841-1843`) and the card turns errored. The
  client preview is advisory; the server is the authority.
- Applying a `write` calls `/api/create`. If the target already exists,
  the card is blocked with "write cannot overwrite — ask the AI to patch
  it instead" (`makeWriteCard`'s apply handler re-reads the path and
  blocks on a readable file).
- Applying emits `NB.evt("ai:applied", {path})`. The viewer refreshes its
  cache from that event (`static/js/viewer.js:949`) and records a
  self-save so the watcher does not raise an "external change" prompt.
- Rejecting records the outcome in the conversation so the model knows the
  proposal was declined.

## Conversation memory

`ai.js` owns the full transcript in `conversation`: the system prompt,
every user turn, every assistant reply, and every tool result.
Every request re-uploads the whole history (`runToolLoop()`), so follow-ups
keep context without re-reading files. Applied, rejected, and blocked
outcomes are appended through `recordToolOutcome`, so the model sees what
happened to its proposals.

### Attachments

The user can attach local text files and images to a message. Both kinds
share one pending chip list (max 8 chips).

- **Text files** are read, BOM-decoded, and inlined into the user turn as
  `[Attached file: …]` blocks. Caps: 128 KiB per file, 512 KiB total. A
  NUL byte rejects the file as binary.
- **Images** (PNG/JPEG/WebP/GIF; SVG stays text) are read and
  downscaled/re-encoded locally in the browser by `readImageAttachment`.
  The policy: probe the bytes to confirm a real
  image and reject above 40 MP; pass the original bytes through when the
  file is ≤ 768 KiB and its longest edge ≤ 1568 px; otherwise re-encode
  with the longest edge at 1568 px (PNG→PNG, JPEG/WebP→same at q0.85,
  GIF→PNG first frame), retry once at 1024 px / q0.75 if still over
  768 KiB, then reject above 2 MiB. Max 4 images per message. The canvas
  mechanics sit behind an
  overridable codec seam (`NB.ai._setImageCodec` / `NB.ai._resetImageCodec`)
  so jsdom tests stub the canvas.
- **Wire format.** A turn with no images keeps a plain-string `content`. A
  turn with images uses an OpenAI content-part array: one `text` part
  (prompt + text inlines) when there is text, then one `image_url` part per
  image (`composeUserContent`). Image data URLs
  carry the sniffed output MIME, never the filename.
- **Persistence.** The full content, base64 image parts included, is
  re-uploaded every turn and every tool round. `Clear` resets it.
- **Wire backstop.** `send` refuses a request whose serialized body would
  exceed 12 MiB before calling the API, without mutating the conversation;
  the same check runs in the submit handler before the pending chips are
  cleared, so a refused send keeps what the user attached.

An upstream rejection of an image-bearing turn (HTTP status ≥ 400) shows
"this model may not support image input"; the image parts stay in the
conversation so a retry or a model switch still carries them.

The **Clear** button resets the conversation and system cache
(the `clearBtn` handler in `mount()`). Switching tabs changes the
"current file" named in the system prompt; the prompt is invalidated on
`file:open` (the `NB.evt.on("file:open")` hook in `mount()`).

## Configuration

`config/ai.json` uses snake_case keys; the HTTP API accepts camelCase input
and returns camelCase keys (the mapping lives in the AI section of `app.py`,
from `app.py:1154`).

```jsonc
{
  "servers": [
    {"name": "local", "base_url": "http://localhost:11434",
     "api_key": "", "model": "llama3"}
  ],
  "default": "local",
  "custom_prompt": "",
  "searxng_url": ""
}
```

- `GET /api/ai/config` returns the masked profile list with `hasKey`
  booleans, the default, the custom prompt, and the SearXNG URL. The
  stored key is never echoed (`app.py:1263`).
- `POST /api/ai/config` replaces the profile list. Base URLs are
  normalized on save: a trailing slash and a trailing `/v1` are stripped
  (`app.py:1230-1232`). `_chat_url()` then appends
  `/v1/chat/completions` (`app.py:1297`).
- `customPrompt` is preserved when the POST omits it and cleared when sent
  as `""`. The cap is 8000 characters (`app.py:1356-1357`).
- `searxngUrl` is preserved when omitted and cleared when sent as `""`
  (`app.py:1359-1362`).

Caps:

- `fetch` — 512 KiB body, 15-second timeout
  (`AI_FETCH_MAX_BYTES` at `app.py:1168`, `AI_FETCH_TIMEOUT` at
  `app.py:1169`).
- `search` — top 10 results, 15-second timeout
  (`AI_SEARXNG_TIMEOUT` at `app.py:1170`, `AI_SEARXNG_MAX_RESULTS` at
  `app.py:1171`).

Upstream HTTP errors during chat are re-emitted in-band as SSE
`event: error` frames, so the browser can display them
(`app.py:1490-1495`). The client treats an `{error: true}` frame as a
failed call (`static/js/api.js:141`).

The full HTTP request/response shapes for every `/api/ai/*` route are in
[`../contracts/http-api.md`](../contracts/http-api.md); the `config/`
file layout is in [`../contracts/configuration.md`](../contracts/configuration.md).

## Worked examples

### "Summarize what's in this folder"

The model calls `list` followed by `read` on the notes it found. Both run
automatically. Their outputs are fed back as tool results, and the final
round is a prose summary. No permission card appears, and nothing is
written.

### "Add a 'Next steps' section to notes/plan.md"

1. The model calls `read` on `notes/plan.md` (automatic).
2. It emits a `patch` call with an `append` op. A permission card appears
   showing the diff.
3. The user clicks Apply. The client posts the batch to `/api/edit`; the
   server verifies the anchor, applies atomically, and returns. The card
   shows "Applied", the viewer refreshes, and the watcher stays quiet.

### "Create a new note for the deployment runbook"

1. The model calls `list` to see where notes live (automatic).
2. It emits a `write` call with the full content. A permission card shows
   the whole file as added lines.
3. The user clicks Create. The client calls `/api/create`. If the path
   already exists the card errors and tells the user to ask for a patch
   instead.

### "Search the web for the current Graphviz release and add it to notes/tools.md"

1. The model calls `search` (automatic). If no SearXNG URL is configured,
   the trace line shows a failure and the model says so.
2. It may call `fetch` on a result URL (automatic, server-side,
   CORS-safe).
3. It proposes a `patch` on `notes/tools.md` with a `find_replace` op. The
   user reviews the diff and applies.