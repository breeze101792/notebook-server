# Preview overflow, Settings focus, and tab-strip visibility — bugfix spec

Status: Ready for implementation. Owner: `product-designer`.
Applies to: `static/css/style.css`, `static/js/dialog.js`, `static/js/settings.js`, `static/js/export.js`, `static/js/auth.js`, `static/js/designer-shell.js`, `static/js/mermaid-designer.js`, `static/js/tabs.js`, `templates/index.html`, `tests/dom/test_dom.js`, `tests/browser/`.
Related: [browser audit](../testing/browser-audit.md), [frontend testing](../testing/frontend.md), [settings modal design](../design/settings-modal.md).

## 1. Problem statement

A real-Chromium pass produced five findings. Three block a user from reading or operating the product. Two are console noise with no user-visible effect. The existing suites pass, so these are coverage gaps, not regressions.

## 2. Scope decisions

| Finding | Decision | Reason |
| --- | --- | --- |
| F1 Preview clips long content | In scope | Long URLs, words, and inline code are unreachable, so the note cannot be read or copied in full. |
| F2 Settings has no focus management | In scope | Keyboard and screen-reader users cannot reliably enter, use, or leave the dialog. |
| F3 Active tab scrolls off-screen | In scope | The user cannot see which note is active and must hunt for a hidden tab. |
| F4 highlight.js logs unknown plugin languages | Deferred | Console-only, no user-visible effect; skipping plugin fences adds highlighter/renderer coupling for zero UX gain. |
| F5 Chrome logs password-in-form warnings | Deferred | Chromium developer diagnostic only; wrapping hidden inputs in a form risks Enter-key submit behavior. |

Recommendation: defer both F4 and F5 to a console-hygiene round. F5 is the weaker of the two and should be deferred first: it is Chromium-only and never reaches a user. F4 is broader but still invisible.

## 3. Intended behavior

### 3.1 Preview content (F1)

**Overflow fixture.** A note whose source contains one 2000-character bare URL, one 200-character unbroken word in a paragraph, one 200-character inline code span, one `h2` with a 200-character unbroken word, one 20-column table with 40-character cells, and one fenced block whose longest line is 2000 characters.
These sizes exceed the measured 1440 px content width (932 px in the audit) and are test parameters, not product limits. The measured viewports are 1440x900 and 390x844.

| Content class | Intended behavior |
| --- | --- |
| Prose (paragraphs, list items, blockquotes) | Wrap at word boundaries. A token wider than the line breaks inside itself. Nothing is clipped. |
| Bare URLs | Show the complete URL, wrapped across lines when needed. The link target is unchanged. |
| Links | Show the complete label, wrapped. The link target is unchanged. |
| Inline code | Wrap like prose. A long run breaks at character boundaries rather than being clipped. |
| Headings | Wrap. A long unbroken word breaks rather than overflowing the content box. |
| Tables | The table block scrolls horizontally inside itself. The page does not scroll. |
| Fenced code | The code block scrolls horizontally inside itself. The page does not scroll. |

Horizontal page scrolling is not the answer for prose. The preview never requires sideways scrolling to read text. Only a table and a fenced code block may have an internal horizontal scroller; each scrolls independently and does not move the page.

Wrapping is display-only. The note source is never rewritten, and the rendered text still matches the source. Hybrid edit mode uses the same preview container, so long prose wraps there too; fenced code and tables keep their own horizontal scrollers.

### 3.2 Settings keyboard contract (F2)

- **D1.** On open, focus moves to the dialog's Close button. It is always present, so the target is deterministic.
- **D2.** Tab moves through the dialog's focusable controls in DOM order and wraps from last to first. Shift+Tab moves in reverse and wraps from first to last.
- **D3.** While the dialog is open the dimmed app is inert: Tab never reaches a background control, and programmatic focus on one is ignored.
- **D4.** Esc closes the dialog. While a shortcut is being captured, Esc cancels the capture and leaves the dialog open.
- **D5.** Every close path (Esc, Close button, footer Close, dim backdrop) returns focus to the element that opened the dialog.
- **D6.** If the opener is gone or not focusable, focus returns to the Settings gear button in the activity bar.

### 3.3 Tab-strip behavior (F3)

- **D7.** After a tab opens, activates, or is restored at boot, the active tab is fully visible inside the strip viewport.
- **D8.** Scrolling into view is minimal: the strip moves only enough to reveal the active tab, without centering or overshooting.
- **D9.** When the active tab is already fully visible, a re-render preserves the current scroll position exactly. Re-rendering must not reset the strip to its start.
- **D10.** Only the active tab triggers scrolling. A tab opened in the background does not move the strip or push the active tab out of view.
- **D11.** Manual scrolling is preserved until the active tab changes. Pinning, unpinning, renaming, or reordering a tab does not discard it.
- **D12.** The strip keeps its hidden scrollbar. Wheel, trackpad, and existing tab-navigation shortcuts remain the ways to move it.
- **D13.** Pinned tabs and their fixed region keep current behavior. They do not move when the unpinned strip scrolls.

## 4. Acceptance criteria

Each criterion is one Playwright assertion. "Viewer content box" means the border box of `#viewer-content` minus its padding. "Fully visible" means the tab's left and right edges are inside `#tab-list`'s visible box, with 1 px tolerance.

### Preview overflow

1. AC1. At 1440x900 with the overflow fixture in preview, `#viewer-content.scrollWidth - #viewer-content.clientWidth` is at most 1 px.
2. AC2. The paragraph containing the 2000-character bare URL has its right edge inside the viewer content box.
3. AC3. The rendered bare URL anchor's text equals the full URL in the source.
4. AC4. The bare URL anchor's right edge is inside the viewer content box.
5. AC5. The paragraph containing the 200-character unbroken word has `scrollWidth === clientWidth`.
6. AC6. The 200-character inline code element's right edge is inside the viewer content box.
7. AC7. The `h2` containing the 200-character unbroken word has its right edge inside the viewer content box.
8. AC8. The wide table has `scrollWidth > clientWidth`, so it owns a horizontal scroller.
9. AC9. With the wide table's `scrollLeft` at its maximum, its last header cell's right edge is inside the table's visible box.
10. AC10. The 2000-character fenced code block has `scrollWidth > clientWidth`.
11. AC11. With the fenced block's `scrollLeft` at its maximum, the end of its longest line is inside the block's visible box.
12. AC12. At 390x844 with the same fixture, `document.documentElement.scrollWidth - clientWidth` is at most 1 px.
13. AC13. At 390x844, the 200-character inline code element's right edge is inside the viewer content box.
14. AC14. After the fixture renders in preview, the file read from the server is byte-identical to the fixture source.
15. AC15. Entering hybrid edit mode on the fixture leaves the 2000-character code line reachable by horizontal scrolling inside the editor.

### Settings focus

16. AC16. Opening Settings while the gear button has focus leaves `document.activeElement === document.getElementById("settings-close")`.
17. AC17. Pressing Tab 40 times from the Close button keeps focus inside `.settings-modal` after every press.
18. AC18. Pressing Tab on the last focusable control inside the dialog moves focus to the first focusable control inside the dialog.
19. AC19. Pressing Shift+Tab on the first focusable control inside the dialog moves focus to the last focusable control inside the dialog.
20. AC20. With the dialog open, calling `focus()` on `#activity-settings-btn` leaves focus inside `.settings-modal`.
21. AC21. Pressing Esc closes the dialog and leaves focus on the gear button that opened it.
22. AC22. Clicking the dialog's Close button closes the dialog and leaves focus on the element that opened it.
23. AC23. Clicking the dim backdrop closes the dialog and leaves focus on the element that opened it.

### Tab strip

24. AC24. At 1440x900 with 10 tabs open, activating the 10th tab scrolls `#tab-list` until that tab is fully visible.
25. AC25. Opening a new file while the strip is scrolled to its start leaves the new active tab fully visible.
26. AC26. After setting `#tab-list.scrollLeft` to 200, clicking a tab that is already fully visible leaves `scrollLeft` at 200, within 1 px.
27. AC27. After setting `#tab-list.scrollLeft` to 200, pinning a different, already-visible tab leaves `scrollLeft` at 200, within 1 px.
28. AC28. With `activeFile` restored to the 10th open file, the active tab is fully visible after boot.
29. AC29. Using the next-tab keyboard shortcut until the active tab is off-screen to the right leaves the new active tab fully visible.
30. AC30. Closing the active tab leaves the newly active tab fully visible.
31. AC31. Opening a tab with activation disabled leaves `#tab-list.scrollLeft` unchanged within 1 px.
32. AC32. Scrolling `#tab-list` horizontally does not change the left edge of a pinned tab.
33. AC33. At 1440x900, scrolling `#tab-list` to its maximum leaves the last tab fully visible.

### Non-regression

34. AC34. The full browser suite passes with the existing 746 assertions unchanged.
35. AC35. The full backend suite passes with the existing 357 tests unchanged.
36. AC36. The existing tab close-animation, ghost-slot, pin, and drag-reorder tests pass unchanged.

## 5. Non-goals

- No redesign of the preview, Settings, or the tab strip.
- No change to note source, Markdown parsing, sanitization, or renderer output.
- No visible horizontal scrollbar on the preview or the tab strip.
- No tab-strip scroll buttons, arrows, gradients, or hover overlays.
- No change to tab widths, close animation, pinning, drag reorder, or the outline toggle.
- No change to tab persistence or config keys.
- No change to Settings sections, navigation, copy, or visual treatment.
- No focus work on any overlay beyond Settings, Export, the two diagram designers, and the login/auth modal, which share the same dialog helper.
- No change to the phone settings sheet, which already works.
- No fix for F4 or F5 in this round.
- No new dependencies, build step, or keyboard shortcut.
- No change to the fenced-code and table scrollers in hybrid edit mode; its prose wraps through the shared preview container.

## 6. Follow-ups

- F4 and F5: console hygiene, no user-visible behavior.

The auth modal now uses the shared dialog helper (D1–D6), so the earlier
follow-up question about whether it should adopt the focus contract is
resolved.
