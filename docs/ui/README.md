# UI design — index

Design handoffs, their reference mockups, and the build guides for this app's web
interfaces. One table, one status per document; open the mockup file directly in a
browser — none needs a server or assets.

**Status key.** *Current spec* — describes the pattern to build from and is kept in
sync. *Design record* — shipped; preserves the reasoning and is not updated line by
line. *Mockup* — the visual reference; the doc beside it is normative.

| File | Status | What it is |
| --- | --- | --- |
| [`README.md`](README.md) | Index — current | This file: the folder map, the status key, and the reading order. |
| [`edit-window-guide.md`](edit-window-guide.md) | Current spec — build guide (pre-implementation) | The playbook for the unified edit window: anatomy, contracts, history engine, responsive, accessibility, new-window checklist, do/don't. Start here for any modal edit window. |
| [`edit-window.md`](edit-window.md) | Current spec — measured source (proposal, drawn in the mockup) | The unified shell for the table editor, Mermaid designer, and Graphviz/WaveDrom designer: header, action bar, history placement, footer, width behavior, implementation notes. Owns the numbers the guide references. |
| [`edit-window-mockup.html`](edit-window-mockup.html) | Mockup — **open this** | The unified shell at 1280 and 720, three windows, three history states, light/dark, plus the rejected header-history and current-chrome variants. |
| [`code-block-chip.md`](code-block-chip.md) | Design record — shipped | The code-fence header: quiet top space, label, copy control, hover states, phone width. |
| [`code-block-chip-mockup.html`](code-block-chip-mockup.html) | Mockup | Reference rendering for `code-block-chip.md` (use the doc's numbers, not the mockup's padding). |
| [`sessions.md`](sessions.md) | Design record — shipped | The Sessions view: marker rows, counts, header totals, row menu, tab integration, phone rule. |
| [`sessions-mockup.html`](sessions-mockup.html) | Mockup | Reference rendering for `sessions.md`. |
| [`topbar-session.md`](topbar-session.md) | Design record — shipped | The top-bar session picker: placement, markup, popover, states, narrow desktop, phone, light theme. |
| [`topbar-session-mockup.html`](topbar-session-mockup.html) | Mockup | Reference rendering for `topbar-session.md`. |
| [`workspaces.md`](workspaces.md) | Design record — shipped | The workspace picker: one control with two mounts (topbar chip, activity-bar glyph), states, menus, routes. |
| [`workspaces-mockup.html`](workspaces-mockup.html) | Mockup | Reference rendering for `workspaces.md`. |
| [`workspace-placement-mockup.html`](workspace-placement-mockup.html) | Mockup — decision record | The comparison board that produced the one-control/two-mount rule. Not updated; the app does not follow every board in it. |

## Reading order

| Job | Read |
| --- | --- |
| Build or extend an edit window | [`edit-window-guide.md`](edit-window-guide.md), then the numbers in [`edit-window.md`](edit-window.md), then open [`edit-window-mockup.html`](edit-window-mockup.html). |
| Match an existing shipped surface | The design record and its mockup in the table above. |
| Change a shipped surface | Treat its doc as a design record: write the new spec first, then implement. |
