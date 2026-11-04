# Operations

How to build, run, test, and ship the notebook server. The runtime frontend
has no build step; two vendor bundles are built offline, `codemirror.bundle.js`
and `visimer.bundle.js`.

## Guides

The folder holds three files: this index, `development.md`, and `build.md`.

| Guide | Covers |
| --- | --- |
| [`development.md`](development.md) | Repo layout, running the tests, the change checklists (adding a renderer or a config key), conventions, and where to look next. |
| [`build.md`](build.md) | The `start.sh` bootstrap and its Python 3.10 floor, the vendoring model, the two offline-built bundles (CodeMirror and Visimer), the service worker cache, and the absence of a release pipeline. |

## Related documentation

| Document | Covers |
| --- | --- |
| [`../architecture/backend.md`](../architecture/backend.md) | Backend structure, storage, auth, and the AI proxy. |
| [`../architecture/frontend.md`](../architecture/frontend.md) | The module inventory, boot sequence, renderer pipeline, and persistence. |
| [`../contracts/configuration.md`](../contracts/configuration.md) | Config files, environment variables, and browser storage. |
| [`../testing/README.md`](../testing/README.md) | The test suites: how to run them and what they cover. |
| [`../../README.md`](../../README.md) | The user-facing feature overview and quick start. |
