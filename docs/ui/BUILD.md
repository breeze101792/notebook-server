# Build handoff — from the design set to code

Status: execution plan. Read [`guidelines.md`](guidelines.md) before touching a surface.

This is the compact state of the design programme. It exists so the build can proceed
without re-reading every surface doc.

---

## 1. What exists

| Group | Docs |
|---|---|
| Rulebook | `guidelines.md` |
| Foundation | `foundations.md`, `controls.md` (+ mockups) |
| Shell | `shell-frame.md`, `tab-bar.md` |
| Side panels | `side-panel-views.md`, `sessions.md`, `search-view.md`, `ai-panel.md` |
| Reading | `reader.md`, `content-blocks.md` |
| Edit windows | `edit-window.md`, `table-editor.md`, `diagram-designers.md` |
| Overlays | `settings-modal.md`, `dialogs.md`, `lightboxes.md` |
| Editing | `source-editor.md`, `hybrid-mode.md` |
| Special | `graph-view.md`, `mobile-shell.md`, `welcome.md` |

Every doc has a sibling `*-mockup.html`. The set is frozen; the code is the next step.

---

## 2. Build order

Each phase is shippable and testable alone. Do not start a phase before its prerequisite.

| # | Phase | Lands | Gate |
|---|---|---|---|
| 0 | Baseline | run `npm test` and the browser suites unchanged | green |
| 1 | Token layer | foundations Appendix A: semantic aliases, primitives, component tokens | `comm` check, `npm test` |
| 2 | Contrast fixes | the three values in foundations §3.6 and the eight white-on-accent rules | `npm test`, visual |
| 3 | Controls | focus rules, borders, disabled opacity, primary halo | `npm test` |
| 4 | Shell | grid budget, topbar, rail, panel frame, outline, phone | `test:browser:core`, `:mobile` |
| 5 | Tabs | two tablists, roving, close paths, dirty/conflict | `test_dom`, `:core` |
| 6 | Side-panel views | Explorer ARIA only (visuals frozen), Pinned, Bookmarks, Recent, Sessions | `test_dom` |
| 7 | Search | field, clear, Advanced, listbox states | `test_dom`, `:core` |
| 8 | AI | provider, messages, trace, cards, composer | `test_dom`, `:ai*` |
| 9 | Reader + blocks | prose a11y, code chip, tables, figures, math, cards | `test_dom`, `:blocks` |
| 10 | Edit windows | shared chrome, table editor, designers | `test_dom`, `:table-editor`, `:designer`, `:dw` |
| 11 | Overlays | Settings, dialogs, lightboxes | `test_dom`, `:auth`, `:core` |
| 12 | Editing surfaces | source bar/CM, hybrid chrome | `test_dom`, `:hybrid*` |
| 13 | Special | graph chrome, phone shell, welcome | `test_dom`, `:core`, `:mobile` |

The per-surface acceptance criteria are the gate for that phase.

---

## 3. Non-negotiables

1. **Keep the current look** unless the doc's exception table says otherwise. The Explorer
   tree is frozen.
2. **Foundations first.** A token rule that lands before Appendix A is invalid and can
   blank a surface.
3. **No drive-by sweeps.** Tokenise a component when you touch it.
4. **Never rename a legacy token.** Add aliases; keep the base names.
5. **Never edit `docs/` from a build change** unless the design is wrong; then stop and
   take it back to the design set.
6. **Tests:** `npm test` is the fast gate; name the browser suite that covers the surface.

---

## 4. Known exceptions (do not "fix")

- Explorer tree: 18 px guide cells, continuous `-3px` strokes, 22 px rows, accent text.
- Search/Recent cursor row: listbox option, wash + text-primary, no weight or bar.
- Markdown edit bar: 26 px controls, +1 px focus offset.
- Modal edit bar: 44 px line, 32 px tools.
- Reader table controls: 24 px toggle, ≈22 px buttons.
- Lightbox controls: 28 px, radius 5, white ring.
- Settings and dialogs: 36 px fields, 30 px buttons.
- Phone rail: five views (Explorer, Pinned, Bookmarks, Recent, Search); no AI.
- Canvas surfaces: `--graph-*` triples; content cards keep their own skin.

---

## 5. Open decisions

- Image lightbox, sticky table headers, MathML for display math: proposals only.
- Graph stays desktop-only; phone Settings uses the sheet.
- Sessions is now a current spec; the archived record is history.

---

## 6. Verification

```bash
npm test
node tests/browser/run_all.js --only=core
node tests/browser/run_all.js --only=mobile
```

Static checks live in `foundations.md` §11.3. Run the token `comm` check after phase 1 and
1.
