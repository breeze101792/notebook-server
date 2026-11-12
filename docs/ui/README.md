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
| [`guidelines.md`](guidelines.md) | Current spec — the rulebook | The shared build style: document format, control ladder, token scoping, surface ownership, geometry canon, the exception registry, mockup rules and the review checklist. **Read before writing or reviewing a surface.** |
| [`foundations.md`](foundations.md) | Current spec — foundation (pre-implementation) | The token layer every screen design references: principles, three-tier tokens, colour with contrast ratios, type, space, shape, elevation, z-bands, motion, breakpoints, iconography, accessibility baseline, implementation contract. **Start here.** |
| [`foundations-mockup.html`](foundations-mockup.html) | Mockup — **open this** | Dark and light side by side: swatches with ratios, type specimen, spacing, radii, elevation, icons, focus, motion, breakpoint ruler. |
| [`typography.md`](typography.md) | Current spec — the type contract | The eight type roles and the token each binds to, the px at S/M/L/XL, the rule for choosing a role, the retired literal sizes, how fixed heights hold the text at XL, the correct and wrong pairings, AC1–AC11. **Read before writing any `font-size`.** |
| [`controls.md`](controls.md) | Current spec — foundation (pre-implementation) | The component layer: inventory and verdict, 16 components with anatomy, states, markup, ARIA and keyboard contract, the consolidation decision, a state matrix, phone rules, AC1–AC25, and the migration order. |
| [`controls-mockup.html`](controls-mockup.html) | Mockup — **open this** | Every component in every state, dark and light, the eight real app contexts, and a 390 px phone board. |
| [`shell-frame.md`](shell-frame.md) | Current spec — pre-implementation | The shell frame: grid, topbar, activity rail, side-panel frame, outline pane, phone conversion, keyboard and ARIA, tokens, AC1–AC22, and the CSS landing order. |
| [`shell-frame-mockup.html`](shell-frame-mockup.html) | Mockup — **open this** | Nine boards: expanded, collapsed panel, collapsed outline, hidden topbar, the 860 boundary, and the 390 phone with drawer and rail. |
| [`tab-bar.md`](tab-bar.md) | Current spec — pre-implementation | The file tab strip: structure, anatomy, equal-width algorithm, overflow, every tab state, drag, close animation, ARIA, phone, AC1–AC22, and conflicts C1–C12. |
| [`tab-bar-mockup.html`](tab-bar-mockup.html) | Mockup — **open this** | Eleven boards: one tab, mixed states, pinned, overflow, drag, ghost close, menu, 861 and 390. |
| [`side-panel-views.md`](side-panel-views.md) | Current spec — pre-implementation | Explorer, Pinned, Bookmarks, Recent, and the conventions they share: headers, rows, top-section modes, context menus, empty and error states, phone, AC1–AC18. |
| [`sessions.md`](sessions.md) | Current spec — pre-implementation | The Sessions view: header, rows, counts, dirty dot, row menu, cap, read-only, keyboard and phone. AC1–AC12. |
| [`sessions-mockup.html`](sessions-mockup.html) | Mockup — **open this** | Normal, menu, cap, read-only and 140 px, dark and light. |
| [`side-panel-views-mockup.html`](side-panel-views-mockup.html) | Mockup — **open this** | Every list view, its empty state, the 140 px panel and the phone drawer. |
| [`search-view.md`](search-view.md) | Current spec — pre-implementation | Search: query row, options, Advanced, results listbox, states, copy, keyboard, phone, AC1–AC30. |
| [`search-view-mockup.html`](search-view-mockup.html) | Mockup — **open this** | Twelve boards from idle to timeout, Advanced open, 140 px and phone. |
| [`ai-panel.md`](ai-panel.md) | Current spec — pre-implementation | AI panel: header, provider, messages, tool trace, edit cards, composer, attachments, states, AC1–AC24. |
| [`ai-panel-mockup.html`](ai-panel-mockup.html) | Mockup — **open this** | Six boards from no-provider to error, ACP and 140 px. |
| [`reader.md`](reader.md) | Current spec — pre-implementation | The reading surface: page, type scale, block rhythm, inline elements, selection, states, accessibility, phone and print. AC1–AC14. |
| [`reader-mockup.html`](reader-mockup.html) | Mockup — **open this** | One note at 1280, 861 and 390, plus XL and print boards. |
| [`content-blocks.md`](content-blocks.md) | Current spec — pre-implementation | Code fences, tables, figures, math, diagram cards and html-live: anatomy, states, actions, tokens and proposals. AC1–AC23. |
| [`content-blocks-mockup.html`](content-blocks-mockup.html) | Mockup — **open this** | Every block in ready, loading, error and narrow states, dark and light. |
| [`edit-window.md`](edit-window.md) | Current spec — pre-implementation | The shared edit-window chrome: header, action bar, footer, geometry, maximize, history, focus, responsive. AC1–AC16. |
| [`edit-window-mockup.html`](edit-window-mockup.html) | Mockup — **open this** | Twelve boards: the three windows, maximized, narrow, phone, applying, error, blocked. |
| [`table-editor.md`](table-editor.md) | Current spec — pre-implementation | The table editor: grid, selection, clipboard, toolbar, blocked state, history, Apply, keyboard, phone. AC1–AC21. |
| [`table-editor-mockup.html`](table-editor-mockup.html) | Mockup — **open this** | Grid, editing, selection, clipboard, sort, blocked, narrow and phone boards. |
| [`diagram-designers.md`](diagram-designers.md) | Current spec — pre-implementation | The Mermaid and Graphviz/WaveDrom designers: stage, sidebar, inspector, states, Apply, keyboard, phone. AC1–AC18. |
| [`diagram-designers-mockup.html`](diagram-designers-mockup.html) | Mockup — **open this** | Eight boards across both designer families, including compact and phone. |
| [`settings-modal.md`](settings-modal.md) | Current spec — pre-implementation | Settings and its seven tabs: nav, rows, forms, lists, the font-size preview tiles, auth states, keyboard, phone. AC1–AC27. |
| [`settings-modal-mockup.html`](settings-modal-mockup.html) | Mockup — **open this** | Every tab, validation, admin/viewer and narrow boards, dark and light. |
| [`dialogs.md`](dialogs.md) | Current spec — pre-implementation | Auth, workspace, session, export and the shared dialog frame, with validation, states and phone. AC1–AC14. |
| [`dialogs-mockup.html`](dialogs-mockup.html) | Mockup — **open this** | Fifteen boards from sign-in to export progress, plus the toast. |
| [`lightboxes.md`](lightboxes.md) | Current spec — pre-implementation | The four full-screen viewers: open/close, controls, gestures, states, keyboard and phone. AC1–AC18. |
| [`lightboxes-mockup.html`](lightboxes-mockup.html) | Mockup — **open this** | Every viewer at fit and zoom, states, focus and phone. |
| [`source-editor.md`](source-editor.md) | Current spec — pre-implementation | Markdown source mode: edit bar, CodeMirror surface, split preview, save/dirty, draft bar, phone. AC1–AC18. |
| [`source-editor-mockup.html`](source-editor-mockup.html) | Mockup — **open this** | Source-only, split, dirty, menus, draft bar, narrow and phone. |
| [`hybrid-mode.md`](hybrid-mode.md) | Current spec — pre-implementation | WYSIWYG mode: page state, block chrome, grips, table/list overlays, code chip, save and conflict. AC1–AC19. |
| [`hybrid-mode-mockup.html`](hybrid-mode-mockup.html) | Mockup — **open this** | Idle, hover, focus, drag, table/list overlay, code chip, dirty, conflict and phone. |
| [`graph-view.md`](graph-view.md) | Current spec — pre-implementation | The `§graph` tab: header, controls, canvases, gestures, states, keyboard and phone. AC1–AC11. |
| [`graph-view-mockup.html`](graph-view-mockup.html) | Mockup — **open this** | 3D loading and ready, 2D, empty, error, large graph, 720, dark and light. |
| [`mobile-shell.md`](mobile-shell.md) | Current spec — pre-implementation | The phone shell: mode, topbar, rail, drawer, Home, capture, settings sheet, history, states. AC1–AC12. |
| [`mobile-shell-mockup.html`](mobile-shell-mockup.html) | Mockup — **open this** | Ten 390 × 844 boards: reader, drawer, Home, capture states, settings, auth-locked and offline. |
| [`welcome.md`](welcome.md) | Current spec — pre-implementation | Welcome, no tabs, empty/no workspace, load failure, offline and first run. AC1–AC10. |
| [`welcome-mockup.html`](welcome-mockup.html) | Mockup — **open this** | Seven boards, dark and light, including the phone Home reference. |

Old design records (the shared edit window, the code-fence header, Sessions, the top-bar
session picker, the workspace picker, and their mockups) are frozen under
[`../archive/ui/`](../archive/ui/). They are history, not current specs.

## Reading order

| Job | Read |
| --- | --- |
| Write or review a design doc | [`guidelines.md`](guidelines.md) first — format, control ladder, ownership, exceptions, checklist. |
| Design any new screen or component | [`foundations.md`](foundations.md) first — tokens, type tokens, icons, focus, breakpoints — then [`typography.md`](typography.md) for the role each piece of text takes, then the matching surface doc. |
| Design or restyle a control | [`controls.md`](controls.md) after the foundations: anatomy, states, markup, ARIA, and the state matrix. |
| Choose a text size, or replace a `font-size` literal | [`typography.md`](typography.md): the role table, choosing a role, the retired literals and their deltas. |
| Build the app shell | [`shell-frame.md`](shell-frame.md): grid, topbar, rail, panel frame, outline, phone. Then [`tab-bar.md`](tab-bar.md) for the strip. |
| Build or change a side-panel view | [`side-panel-views.md`](side-panel-views.md) for Explorer, Pinned, Bookmarks and Recent; [`sessions.md`](sessions.md) for Sessions; [`search-view.md`](search-view.md) for Search; [`ai-panel.md`](ai-panel.md) for AI. |
| Build or extend an edit window | [`edit-window.md`](edit-window.md) for the shared chrome, then [`table-editor.md`](table-editor.md) or [`diagram-designers.md`](diagram-designers.md) for the body. |
| Match a shipped surface that has no new spec | Use the frozen record under [`../archive/`](../archive/README.md) as source material, then write the new spec. |
| Change a shipped surface | Write the new spec first, then implement. Do not revive an archived doc as current. |
