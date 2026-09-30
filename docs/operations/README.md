# Operations

How to build, run, test, and ship the notebook server. The runtime frontend
has no build step; the only built artifact is the CodeMirror bundle.

## Guides

| Guide | Covers |
| --- | --- |
| [`development.md`](development.md) | Repo layout, the change checklists (adding a renderer or a config key), conventions, and where to look next. |
| [`build.md`](build.md) | The `start.sh` bootstrap, the vendoring model, the offline-built CodeMirror bundle, the service worker cache, and the absence of a release pipeline. |

## Related documentation

| Document | Covers |
| --- | --- |
| [`../architecture/backend.md`](../architecture/backend.md) | Backend structure, storage, auth, and the AI proxy. |
| [`../architecture/frontend.md`](../architecture/frontend.md) | The module inventory, boot sequence, renderer pipeline, and persistence. |
| [`../contracts/configuration.md`](../contracts/configuration.md) | Config files, environment variables, and browser storage. |
| [`../testing/README.md`](../testing/README.md) | The test suites: how to run them and what they cover. |
| [`../../README.md`](../../README.md) | The user-facing feature overview and quick start. |
