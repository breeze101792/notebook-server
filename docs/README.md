# Notebook Server documentation

This folder holds the project documentation. The root [`README.md`](../README.md)
is the user-facing overview; these guides go deeper for people working on or
integrating with the app.

The server is a single-user Markdown notebook: a Flask backend (`app.py`) that
serves a JSON API and one HTML page, and a vanilla-JS frontend that renders
Markdown in the browser. Notes are plain `.md` files on disk. There is no
database and no runtime build step.

## Guides

| Guide | Covers |
| --- | --- |
| [`architecture.md`](architecture.md) | Backend structure, import-time path resolution and seeding, `safe_path` and atomic writes, the auth layer, the AI proxy, and the design trade-offs. |
| [`frontend.md`](frontend.md) | Script load order, the boot sequence, all 29 `static/js/` modules, the code-block renderer registry, persistence, the service worker, and the UI surfaces. |
| [`api.md`](api.md) | The full HTTP endpoint reference: every route, parameter, status code, the `/api/edit` op schema, and worked `curl` examples. |
| [`configuration.md`](configuration.md) | `start.sh` flags, environment variables, first-run seeding, and every key in `config/config.json`, `config/auth.json`, and `config/ai.json`. |
| [`markdown.md`](markdown.md) | The Markdown pipeline, supported GFM syntax, the five special fenced blocks and their vendored versions, wikilinks, and the `html-live` sandbox. |
| [`ai-assistant.md`](ai-assistant.md) | The built-in assistant: provider setup, the six tools, the tool loop, reviewing edits, and the `config/ai.json` shape. |
| [`development.md`](development.md) | Repo layout, both test suites, how to run them, vendoring, and the checklists for adding a renderer or a config key. |

## Other entry points

- [`../README.md`](../README.md) — user-facing feature overview and quick start.
- [`../agent.md`](../agent.md) — the machine-readable API guide served at
  `GET /agent.md`, with the current auth state substituted into it.
- [`../CLAUDE.md`](../CLAUDE.md) — orientation notes for coding agents working
  in this repository.

## Scope

`docs/api.md` is the human-facing API reference. `agent.md` is the companion an
AI agent or script can fetch from a running server to learn how to
authenticate and call the API. Both describe the same routes; when they
disagree with the code, the code in `app.py` is authoritative.
