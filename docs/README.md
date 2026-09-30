# Notebook Server documentation

This folder holds the project documentation, organized as a project-design
tree. The root [`README.md`](../README.md) is the user-facing overview;
these guides go deeper for people working on or integrating with the app.

The server is a single-user Markdown notebook: a Flask backend (`app.py`)
that serves a JSON API and one HTML page, and a vanilla-JS frontend that
renders Markdown in the browser. Notes are plain `.md` files on disk. There
is no database and no runtime build step.

## Folders

| Folder | Entry point | Owns |
| --- | --- | --- |
| [`requirements/`](requirements/README.md) | [`requirements/README.md`](requirements/README.md) | What the product does and why: scope, flows, edge cases, acceptance criteria, maintenance. |
| [`architecture/`](architecture/backend.md) | [`architecture/backend.md`](architecture/backend.md) | Backend structure, frontend modules, the Markdown pipeline, hybrid editing, and the AI assistant. |
| [`contracts/`](contracts/http-api.md) | [`contracts/http-api.md`](contracts/http-api.md) | The HTTP endpoint reference and the configuration-file contracts. |
| [`testing/`](testing/README.md) | [`testing/README.md`](testing/README.md) | The test strategy, the backend suite, and the frontend DOM/browser suites. |
| [`operations/`](operations/README.md) | [`operations/README.md`](operations/README.md) | Repo layout, build/toolchain, vendoring, and the change checklists. |

## Architecture

| Guide | Covers |
| --- | --- |
| [`architecture/backend.md`](architecture/backend.md) | Import-time path resolution and seeding, `safe_path` and atomic writes, the auth layer, the AI proxy, and the design trade-offs. |
| [`architecture/frontend.md`](architecture/frontend.md) | Script load order, the boot sequence, the `static/js/` modules, the code-block renderer registry, persistence, the service worker, and the UI surfaces. |
| [`architecture/markdown.md`](architecture/markdown.md) | The Markdown pipeline, supported GFM syntax, the five special fenced blocks and their vendored versions, wikilinks, and the `html-live` sandbox. |
| [`architecture/hybrid-editing.md`](architecture/hybrid-editing.md) | The construct-by-construct behavior spec for hybrid (WYSIWYG) editing: every syntax construct at every caret position, the decided behavior, and the open questions. |
| [`architecture/ai-assistant.md`](architecture/ai-assistant.md) | The built-in assistant: provider setup, the six tools, the tool loop, and reviewing edits. |
| [`architecture/design/`](architecture/design/tab-equalization.md) | Tab-bar design notes and the reference mockup. |

## Contracts

| Guide | Covers |
| --- | --- |
| [`contracts/http-api.md`](contracts/http-api.md) | The full HTTP endpoint reference: every route, parameter, status code, the `/api/edit` op schema, and worked `curl` examples. |
| [`contracts/configuration.md`](contracts/configuration.md) | `start.sh` flags, environment variables, first-run seeding, and every key in `config/config.json`, `config/auth.json`, and `config/ai.json`. |

## Testing and operations

| Guide | Covers |
| --- | --- |
| [`testing/README.md`](testing/README.md) | The test strategy and how to run both suites. |
| [`testing/backend.md`](testing/backend.md) | The stdlib `unittest` suite against the real Flask app. |
| [`testing/frontend.md`](testing/frontend.md) | The jsdom harness and the Playwright browser suite. |
| [`operations/development.md`](operations/development.md) | Repo layout, the change checklists, and conventions. |
| [`operations/build.md`](operations/build.md) | `start.sh`, vendoring, the CodeMirror bundle, and the service worker. |

## Other entry points

- [`../README.md`](../README.md) — user-facing feature overview and quick start.
- [`../agent.md`](../agent.md) — the machine-readable API guide served at
  `GET /agent.md`, with the current auth state substituted into it.
- [`../CLAUDE.md`](../CLAUDE.md) — orientation notes for coding agents working
  in this repository.

## Scope

`contracts/http-api.md` is the human-facing API reference. `agent.md` is the
companion an AI agent or script can fetch from a running server to learn how
to authenticate and call the API. Both describe the same routes; when they
disagree with the code, the code in `app.py` is authoritative.
