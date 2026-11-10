# Viewer scroll container and wallpaper attachment

> **Archived.** Frozen design record, kept for history. Not a current spec. See [`../README.md`](../README.md).


**Status:** shipped. `#viewer-scroll` is the scroll container and
`#viewer-content` is the page; the element contract, the wallpaper host rule
and the retarget map below are the as-built record.

## Decision

Split the preview into a scroll container (`#viewer-scroll`) and a content page
(`#viewer-content`). The wallpaper is painted on whichever of those two is the
*thing that does not move relative to the words*:

| `wallpaperScroll` | Pattern host | Effect |
| --- | --- | --- |
| `scroll` | `#viewer-content` (the page) | Pattern is part of the page and moves with the text, including the elastic overscroll. |
| `fixed` | `#viewer-scroll` (the scrollport) | Pattern is anchored to the scrollport and the page moves over it (windowpane). |

Both hosts use the default `background-attachment: scroll`. `local` and `fixed`
are removed from the stylesheet: each is the source of a browser-specific bug,
and neither is needed once the pattern sits on the right element.

## Problem

Today `#viewer-content` is both the scroll container and the page
(`static/css/style.css:2376-2394`), and the pattern uses
`background-attachment: local` (`:2450-2474`). `local` positions the pattern
from the scroll offset. An elastic overscroll (iOS/macOS rubber band)
translates the content without changing the clamped scroll offset, so the words
move and the pattern stays: the pair separates at the ends exactly as reported.
The shipped workaround set `overscroll-behavior-y: none` (`:2382-2387`), which
removes the bounce.

Measured on the real app in Chromium and Firefox 159: at rest the `local`
pattern phase is exactly `-scrollTop mod 24` at 0/100/500/1000/2000/max, and it
holds a constant distance to a text marker across a 20-frame animated scroll.
The defect is specific to content translation (overscroll), not to scrolling.

## Target DOM

```
#viewer                     non-scrolling shell (unchanged box, position: relative, overflow: hidden)
 ├─ #viewer-scroll          the only scroll container
 │   └─ #viewer-content     the page: markdown-body, wallpaper classes, padding
 └─ overlays                .nb-drop-line, list/table drag overlays — unchanged, still children of #viewer
```

The overlays stay in the shell: they are `position: absolute` and take their
coordinates from `#viewer.getBoundingClientRect()` (`list-edit.js:92`,
`table-edit.js:56`, `table-view.js:169`), which does not change. They are not
inside the scroller, so they are never clipped by it.

## Element contract

| Element | Role | Owns | Must not |
| --- | --- | --- | --- |
| `#viewer` | Visibility shell and overlay coordinate space | `position: relative`, `overflow: hidden`, flex sizing (`style.css:2354-2366`) | Scroll. |
| `#viewer-scroll` | The scroll container. All scroll state lives here: `scrollTop`, `scrollHeight`, `clientHeight`, the `scroll` event, the elastic overscroll. | `overflow-y: auto`, `overflow-x: hidden`, `min-height: 0`, `overscroll-behavior-y: contain` | Hold the note content or the wallpaper (except in `fixed` mode). |
| `#viewer-content` | The page. Markdown blocks stay its direct children, so `hybrid.js` is unchanged. | Padding (`16px 40px var(--viewer-tail)`; `--viewer-tail: 48px`), `min-height: 100%`, the wallpaper in `scroll` mode. | Scroll: `overflow: visible`, no flex, no `min-height: 0`. |

`min-height: 100%` plus the global `border-box` (`style.css:133`) keeps the
current geometry: a short note is exactly one viewport tall, a long note is
`content + padding`, and at max scroll the last line sits `--viewer-tail` above
the scrollport bottom.

## Wallpaper contract

- Pattern rules move from `#viewer-content.wallpaper-*` to
  `:is(#viewer-content, #viewer-scroll).wallpaper-*` (`style.css:2424-2474`),
  and the theme default (`--wp-rgb`) to the same `:is()` selector, because the
  classes can sit on either host.
- `app.js:315-380` gains `wallpaperHost()`: `#viewer-scroll` when
  `wallpaperScroll === "fixed"`, `#viewer-content` otherwise. The four
  `applyWallpaper*` functions set every `wallpaper-*` class on that host and
  remove them from the other one, so a mode switch moves the pattern without a
  reload.
- The server-rendered boot classes stay on `#viewer-content` (`index.html:373`).
  At `scrollTop 0` both hosts anchor the pattern at the same point, so moving
  them on load is not visible.
- `.wallpaper-fixed` remains the mode marker for `app.js`; the
  `background-attachment: fixed` rule (`style.css:2478-2480`) is deleted.

## Scroller ownership and retarget map

Only these call sites change. Everything that reads or writes the *content*
(render, `innerHTML`, `hybrid.js` children, `copy-image.js`, `table-editor.js`)
keeps targeting `#viewer-content`.

| File:line | Current | Change |
| --- | --- | --- |
| `templates/index.html:372-374` | `#viewer > #viewer-content` | Insert `#viewer-scroll` between them. |
| `static/js/viewer.js:17-18` | `viewerContentEl` only | Add `viewerScrollEl`; keep both. |
| `static/js/viewer.js:483` | `NB.outline.startWatching(viewerContentEl)` | Pass `viewerScrollEl`. |
| `static/js/viewer.js:548-566` | `syncScroll(scroller, viewerContentEl)` and back | Pass `viewerScrollEl`; the function reads its arguments, so it is not caught by a `scrollTop` grep. |
| `static/js/viewer.js:584, 651-652, 1157-1158` | scroll listeners on `viewerContentEl` | Attach to `viewerScrollEl`. |
| `static/js/viewer.js:1351-1424, 1505-1588` | scroll save/restore and keyboard scroll | `viewerScrollEl.scrollTop`; `scrollIntoView` calls (`:1099`, `:1122`) need no change — they scroll the nearest scroller. |
| `static/js/vimnav.js:275-279, 344-355` | `gg`, `G`, `j`, `k`, `h`, `l` write `#viewer-content.scrollTop` | Write to `#viewer-scroll`. Silent no-op otherwise. |
| `static/js/mobile.js:54-72` | `shell.viewerContent` | Add `shell.viewerScroll`. |
| `static/js/mobile.js:178-180` | resume saves `shell.viewerContent.scrollTop` | Save `shell.viewerScroll.scrollTop`. |
| `static/js/mobile.js:1079-1083` | boot resume writes `shell.viewerContent.scrollTop` | Write `shell.viewerScroll`. |
| `static/js/mobile.js:1180-1186` | scroll listener on `shell.viewerContent` | Attach to `shell.viewerScroll`. |
| `static/js/list-edit.js:575` | hide-on-scroll on `viewerContentEl` | Attach to the scroller. |
| `static/js/table-edit.js:168` | hide-on-scroll on `viewerContentEl` | Attach to the scroller. |
| `static/js/table-view.js:1219` | hide-on-scroll on `viewerContentEl` | Attach to the scroller. |
| `static/js/blocks.js:669-671` | `measureViewportH` default `#viewer-content` | Default to the scroller. |
| `static/js/blocks.js:743-752, 837-859` | relayout scope / `observeHost` default | Use the scroller for size and observation; the scan root may stay the page. |
| `static/js/blocks.js:681-687` | `hostOf` fallback `#viewer-content` | Fall back to `#viewer-scroll`. The shape walk already finds the new scroller. |

Guard after the change: no `getElementById("viewer-content").scrollTop` or
`#viewer-content` scroll listener remains outside the content-root uses
(`render`, `innerHTML`, hybrid, copy-image, table editor).

## Hybrid mode

`#viewer-content.hybrid-editing { overflow-x: auto }` (`style.css:2736-2738`)
must move to `#viewer.hybrid-active #viewer-scroll { overflow-x: auto }`.
Otherwise a non-`visible` `overflow-x` computes `overflow-y: auto`, the page
becomes a scroll container again, and `hostOf` (`blocks.js:681-687`) returns it:
`measureViewportH` would then use the whole note height, so tall diagrams stop
fitting and a figure's size starts depending on how much text follows it.

The page stays `overflow: visible`. Wide tables pan the scroller, so the page
and the pattern pan together. `#viewer-content.hybrid-editing pre / pre code /
table { overflow: visible }` (`style.css:2729-2735`) stays as is.

## Overscroll

`#viewer-scroll` uses `overscroll-behavior-y: contain` on desktop and
`overscroll-behavior: contain` on the phone. `contain` permits the bounce and
blocks scroll chaining and pull-to-refresh; `none` and the `fixed`
`background-attachment` are removed.

## Acceptance criteria

| ID | Criterion | Verifier |
| --- | --- | --- |
| AC-1 | `#viewer-scroll` is the element whose `scrollTop` changes, and `#viewer-content` is its only child. | Browser test (Chromium + Firefox). |
| AC-2 | `scroll` mode: the pattern classes are on `#viewer-content`. `fixed` mode: on `#viewer-scroll`. Computed `background-attachment` is `scroll` in both. | Browser test. |
| AC-3 | Short note: `#viewer-scroll.scrollHeight === clientHeight`, max `scrollTop === 0`, and the pattern fills the pane. | Browser test. |
| AC-4 | Long note: max `scrollTop === #viewer-content.offsetHeight - #viewer-scroll.clientHeight`; at max the last line is `--viewer-tail` above the scrollport bottom and the pattern still covers the tail. | Browser test. |
| AC-5 | Hybrid: `getComputedStyle(#viewer-content).overflowY === "visible"`; `blocks.js hostOf` returns `#viewer-scroll`. | Browser test + CSS-source check. |
| AC-6 | Every scroll API in the map above moves the scroller; no writes to `#viewer-content.scrollTop` remain. | Grep guard + browser tests (outline scroll-spy, split sync, vim `G`, mobile resume, figure wheel scroll). |
| AC-7 | `overscroll-behavior-y` on the scroller is `contain`; pull-to-refresh and chaining stay blocked. | CSS-source check; manual on device. |
| AC-8 | During a top and a bottom elastic bounce on iOS Safari and macOS Safari, a text baseline and a pattern line keep a constant pixel offset. | **Unverified by automation** — manual slow-motion recording. |
| AC-9 | `fixed` mode still reads as a windowpane on iOS (pattern on the scrollport does not degrade). | **Unverified by automation** — manual on device. |

## Test changes

- `tests/dom/test_dom.js`: the fixture gains `#viewer-scroll`; the wallpaper
  CSS checks move to the `:is()` selectors; the hybrid check at `:11019-11021`
  becomes `#viewer.hybrid-active #viewer-scroll { overflow-x: auto }`; the
  split-sync stub at `:7745-7778` uses the scroller.
- `tests/browser/test_figure_sizing_browser.js:715-790`: wheel scroll and
  lightbox restore target `#viewer-scroll`; a vacuous `0 === 0` restore must be
  impossible (assert a non-zero starting offset).
- `tests/browser/test_core_ui_browser.js:805-860`: outline scroll-spy and
  "back to top" target `#viewer-scroll`.
- `tests/browser/test_mobile_browser.js:545-650`: seed a non-zero resume
  scroll and assert the scroller restores it.
- Add a check that `G` in vim mode reaches `scrollHeight - clientHeight`.

## Risks

| ID | Risk | Mitigation |
| --- | --- | --- |
| RISK-1 | A missed scroll call site fails silently (no exception when writing `scrollTop` on a non-scroller). | The grep guard in AC-6 plus the retargeted browser suites. |
| RISK-2 | Hybrid page becomes a scroll container and breaks figure sizing. | AC-5 and the moved CSS rule. |
| RISK-3 | The HTML, CSS and JS must land together; a partial change leaves no scroller at all. | One atomic change set; rollback is a single revert. |
| RISK-4 | `min-height: 100%` against a flex-sized scroller could resolve differently in Safari. | AC-3/AC-4 on device; the geometry is the same formula as today. |
| RISK-5 | The native bounce cannot be reproduced on this Linux host. | AC-8/AC-9 are manual; the structural guarantee is that the pattern is painted on the translated element. |

## Docs to update with the code

- `architecture/frontend.md` — the viewer shell/scroller/page contract and the
  wallpaper host rule.
- `architecture/markdown.md:185-192` — the figure host is `#viewer-scroll`.
- `design/mobile-shell.md` — scroll restoration targets `#viewer-scroll`;
  `contain` is the bounce, not `none`.
- `testing/frontend.md` — the retargeted browser assertions.
