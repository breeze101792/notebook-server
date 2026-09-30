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
  steer style and focus but cannot invent tools (`customPromptSuffix` at
  `static/js/ai.js:783`).
- Web search: sets the SearXNG instance URL used by the search tool.

Editing a profile never re-sends the stored key. A blank API key plus
`replaceSecret: true` carries the previous key over server-side
(`app.py:1245`).

## The six tools

The tools are declared in `systemPrompt()` (`static/js/ai.js:724`) and
called by the model as fenced ` ```nb-tool ` JSON blocks.

| Tool | What it does | Runs |
| --- | --- | --- |
| `list` | Enumerates the note tree. | automatically, shown as a trace line |
| `read` | Fetches one note's content. | automatically |
| `fetch` | Fetches a URL server-side via `/api/ai/fetch`, which is CORS-safe. | automatically |
| `search` | Queries the configured SearXNG instance via `/api/ai/search`. Fails if no instance is configured. | automatically |
| `write` | Creates a NEW file. | needs permission (Apply/Reject card) |
| `patch` | Edits an existing file through a batch of `/api/edit` ops. | needs permission (Apply/Reject card) |

The model's own rules, stated in the system prompt (`static/js/ai.js:758`):

- To update an existing file it MUST use `patch`. A `write` call on an
  existing path is blocked client-side.
- In a patch, `find` must match the file exactly and appear exactly once,
  whitespace included.
- Read the relevant files before proposing patches; never invent content.
- One logical change per patch call; several calls are fine.

## The tool loop

`send()` (`static/js/ai.js:943`) runs a bounded loop around the SSE relay:

1. The user message is appended and sent with the full conversation.
2. The assistant reply streams in. Any ` ```nb-tool ` blocks are parsed out
   (`collectFenced(text, "nb-tool")`, `static/js/ai.js:973`).
3. Read-only tools (`list`, `read`, `fetch`, `search`) run immediately and
   their results are pushed back as tool-result user messages, so the
   model continues in the next round.
4. `write` and `patch` become permission cards (`makePatchCard` at
   `static/js/ai.js:402`, `makeWriteCard` at `static/js/ai.js:505`). The
   loop stops there until the user clicks Apply or Reject, so a card is
   never left behind a completed turn.
5. `MAX_TOOL_ROUNDS = 5` (`static/js/ai.js:38`) caps the fan-out per user
   turn.

When the model returns prose with no tool blocks, the turn ends.

## Reviewing edits

Nothing is written until the user clicks Apply. `write` and `patch` always
surface as Apply/Reject cards.

- A patch card shows the proposed ops and a color-coded diff with dual
  line numbers and a `@@` hunk header (`buildDiffEl`, `static/js/ai.js:280`).
  The diff is a client-side preview computed by `previewPatch()`
  (`static/js/ai.js:340`), which simulates the literal `find_replace`,
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
  it instead" (the gating check at `static/js/ai.js:554`, message at
  `static/js/ai.js:559`).
- Applying emits `NB.evt("ai:applied", {path})`. The viewer refreshes its
  cache from that event (`static/js/viewer.js:949`) and records a
  self-save so the watcher does not raise an "external change" prompt.
- Rejecting records the outcome in the conversation so the model knows the
  proposal was declined.

## Conversation memory

`ai.js` owns the full transcript in `conversation`: the system prompt,
every user turn, every assistant reply, and every tool result
(`static/js/ai.js:717`). Every request re-uploads the whole history
(`static/js/ai.js:955`), so follow-ups keep context without re-reading
files. Applied, rejected, and blocked outcomes are appended through
`recordToolOutcome` (`static/js/ai.js:805`), so the model sees what
happened to its proposals.

The **Clear** button resets the conversation and system cache
(`static/js/ai.js:1038`). Switching tabs changes the "current file" named
in the system prompt; the prompt is invalidated on `file:open`
(`static/js/ai.js:1147`).

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