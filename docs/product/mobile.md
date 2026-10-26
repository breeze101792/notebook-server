# Mobile (iPhone-first) — functional spec

Status: draft for review. Owner: `product-designer`.
Applies to: the mobile layout of the existing shell (`templates/index.html`, `static/css/style.css`, `static/js/*`), `tests/dom/test_dom.js`, and a new real-browser mobile harness.
Related: [mobile-support research](../research/mobile-support.md) owns the fact pack (tested devices, iOS floor, viewport units, keyboard and safe-area measurements, touch quirks). This document owns observable product behaviour; where it depends on a device fact, the fact lives there.

## 1. Purpose and user goal

> **On a phone, the user should reach a note, read it properly, find something, and write a quick thought — without a desktop beside them and without disturbing the desktop they left at home.**

Today the four-column shell collapses the editor to 0 px on a phone, so the product is desktop-only in practice. v1 makes the same web app usable on a phone for reading and capture; v2 adds WYSIWYG editing of the open note. It stays one web app over plain HTTP on the LAN: no framework, no bundler, no native shell, no TLS or reverse-proxy work, no offline guarantee.

### 1.1 Facts this spec takes from the research document

- iOS never fires `contextmenu` on long-press, so the `…` button is the only menu entry (§4.0, C1).
- The visual viewport shrinks under an open keyboard and varies with browser chrome and safe-area insets; this drives focus scrolling, the capture sheet, full-height layout, drawer sizing, and rotation (M4, M5, §5).
- iOS zooms a focused field rendered below 16 CSS px, which is why the 16 px rule is binding (C2). Measurements and the device list live in [mobile-support](../research/mobile-support.md), not here.

## 2. Scope and non-goals

### 2.1 In scope

| ID | Capability | User-visible outcome |
|---|---|---|
| M1 | Entry and sign-in | auth optional; the cookie session survives reload; a 401 returns to the note being read |
| M2 | Home and navigation | Continue, Bookmarks, Recent, Browse drawer, Search entry, all tap-reachable |
| M3 | Read | Markdown, code, wide tables, images, diagrams, internal/external/deep links |
| M4 | Search | existing search index, debounced; a hit opens the note at the match |
| M5 | Quick capture | one block appended to `Inbox.md`; draft survives backgrounding |
| M6 | Minimal settings | theme, text size, sign out, server origin and reachability |
| M7 | Deep links and resume | `?file=` opens the right note; the last note on this device is one tap away |
| M8 | Unreachable states | a clear failure screen with Retry, distinct from sign-in |
| M9 | WYSIWYG edit | edit the open note in place with a touch formatting bar; Save and back both persist |

### 2.2 Out of scope (with the reason)

| Excluded | Why |
|---|---|
| Source (Markdown) editing | WYSIWYG covers the phone job; CM6's line editing is a desktop tool |
| Tabs UI, TOC / outline sheet | one note at a time; the tab substrate must not be forked; heading links still work |
| Per-device theme and text size | v1 uses the existing server-side prefs; no per-device promise |
| Image/diagram lightbox, pan, pinch-zoom | neither exists on desktop today; fit plus block scroll is enough |
| AI, export, graph, table/diagram editing, admin settings | large surfaces of their own; none is needed to read or capture |
| Offline cache, native app, install prompts, notifications, multiple servers | plain HTTP on the LAN; no offline story and no Android install are promised |

## 3. Ranked mobile jobs-to-be-done

| Rank | Job | Why it ranks here |
|---|---|---|
| 1 | “Open that note I was reading” | most frequent phone action; needs no typing |
| 2 | “Find the note or line I mean” | search and browse replace the desktop tree's density |
| 3 | “Read it without breaking the layout” | sideways scroll or clipped code makes a page unusable |
| 4 | “Jot this down before I forget” | capture must be one tap and must never lose a draft |
| 5 | “Get back to where I was” | back order and resume make the app feel native |

## 4. Functional flows

### 4.0 Shared navigation rules (apply to every M)

1. A note opens in place; the previous note is not kept visible. Back closes an open sheet or drawer first, then returns to the previous note in visit order, then Home, then the page before the app.
2. Browse opens from the left over a scrim and closes on its Close control, a scrim tap, back, or a chosen file. Every sheet and drawer has a visible Close control; a dismiss gesture is never the only way.
3. Anywhere desktop offers a right-click menu, mobile offers a `…` button with the same items reduced to v1. Excluded items (§2.2) are absent, not greyed out. No action requires hover, right-click, a long-press menu, or a keyboard.

### M1 — Entry and sign-in

1. Open the origin. With no password configured, go to Home. With auth on and no valid session, show only sign-in: no note content, titles, or tree.
2. A correct admin or viewer password lands on the requested `?file=` note, otherwise Home. A wrong password shows an inline error and clears the field; repeated failures show the rate-limit wait, and the form works again afterwards.
3. Any 401 during a read returns to sign-in. After signing in, the same note and approximate scroll position are restored.
4. Sign out ends the session and returns to sign-in when auth is on, Home when it is off.

### M2 — Home and navigation

1. Home shows, in order: Search entry, Continue, Bookmarks, Recent, Browse. Continue opens the last note read on this device; it is absent on first use, and a lost target shows a browse prompt.
2. Bookmarks keeps the saved order read-only: tap opens a note; no add, remove, or reorder. Empty says how to add bookmarks on desktop.
3. Recent lists server-side recent notes, newest first, bounded by a named cap. A phone read may add to it; it is shared with desktop by design.
4. Browse opens the tree drawer; folders expand one level per tap, the open note is marked, and choosing a file opens it and closes the drawer. The note title opens the drawer, so Browse is one tap from a note.

### M3 — Read

1. A chosen note shows loading, then one full-width reading column. It never renders at zero width and the page never scrolls sideways.
2. Long code lines scroll horizontally inside the code block and keep alignment; wide tables scroll inside the table box. Table hover controls, row/column hiding, and sorting are not offered on mobile.
3. Images fit the column and never overflow; tapping one does nothing. Mermaid, WaveDrom, KaTeX, and Graphviz render; an over-wide diagram scrolls inside its block rather than shrinking to unreadable size. No pan or pinch-zoom in v1.
4. An internal Markdown link opens that note in place; an external `http(s)` link opens a new tab so back returns to the note; `mailto:` hands off to the mail app. The `…` menu offers Reload, Copy link, and Show in Browse. Viewer-role users see the same reader, with capture absent.

### M4 — Search

1. The Search entry opens a full-screen sheet with the field ready for typing.
2. Typing queries the existing `/api/search` after one debounce interval. There is no request per keystroke and none for an empty query.
3. Results are grouped by file with path, snippet, and the match marked. Tapping a hit closes the sheet, opens the note, scrolls the match into view, and marks it; the mark clears on the next navigation.
4. No matches shows an empty state and keeps the query. A failed request shows an inline Retry and keeps the query and any results already shown.

### M5 — Quick capture

1. A `+` action on Home and in the note header opens the capture sheet: a multiline field, Send, and Close.
2. The draft is saved on this device as it is typed and again when the app is backgrounded; reopening the sheet or reloading restores it.
3. Send appends exactly one block to `Inbox.md`, creating the file if missing. The block is the typed text verbatim, separated from earlier content by a blank line; no heading, timestamp, or wrapper in v1.
4. While in flight Send is disabled and the field is unchanged. Success closes the sheet, confirms, and clears the draft. A network failure keeps the sheet and draft with an inline Retry, which sends the same block once.
5. A double tap on Send produces exactly one append. A viewer-role user has no capture entry, and a direct attempt is refused with a “not allowed for this role” message, never a false success.

### M6 — Minimal settings

1. The `…` action on Home opens Settings: theme, text size, sign out, server origin and status.
2. Theme and text size change immediately and offer the same choices as desktop. Both are stored server-side in v1, so the sheet states that a change applies to every device using this server.
3. Server origin shows the address in use and whether the last request reached the server, and states that plain HTTP means no offline reading and no install. Sign out appears only with auth on; AI, export, graph, admin, and token settings are absent.

### M7 — Deep links and resume

1. `?file=<path>` is the canonical note link; opening one passes the M1 gate and then opens that note.
2. An unknown target shows “Note not found” with Browse and Home actions; the app does not crash, blank, or rewrite the address to another note.
3. In-app navigation updates the address bar to that note's `?file=` form without adding a history entry per scroll. Reload returns to the note in the address bar; back returns to the previous note.
4. Continue returns to the last note read on this device even if the address bar was never shared. If it was deleted, Continue falls back to Home with a one-line notice; a deep link to a deleted note stays on “Note not found”.

### M8 — Unreachable and unauthorized

1. A network failure shows a page-level “Can't reach the server” state with the origin and a Retry. Retry re-issues the request and restores the previous view, not Home.
2. v1 caches no notes. A note readable before a failure is not shown from cache, and the failure screen says so.
3. A 401 is never shown as unreachable: it shows sign-in (M1). A 403 shows a role-permission message. A capture sent while unreachable fails with its draft kept; there is no background retry queue in v1.

### M9 — WYSIWYG edit

1. With a note open, an ✎ control in the top bar and **Edit note** as the first item of the `…` menu enter WYSIWYG mode. Both are absent for a viewer role and with no note open.
2. The rendered note becomes the editable surface. A single sideways-scrolling formatting strip sits under the top bar with Save and Done pinned at its left; every control is at least 44 px.
3. Tapping a formatting control keeps the caret and the keyboard. Typing, selection, task checkboxes, lists, headings, quotes, links, and code blocks behave as they do in desktop WYSIWYG mode.
4. Autosave (server setting) covers idle typing. **Save** writes immediately; **Done** writes when autosave is on, otherwise it asks before leaving unsaved changes.
5. Back (browser, hardware, the top-bar arrow), Esc, or Done leave edit mode before any navigation. Leaving with autosave off keeps the buffer as a recoverable draft.
6. The bottom rail and the +/… actions are hidden while editing. The note, its address, and the scroll position do not change when entering or leaving.

## 5. Edge cases

| Case | Expected behaviour | M |
|---|---|---|
| Very long note | scrolls normally; back restores the approximate position; no truncation | M3, M7 |
| Wide table | scrolls inside its box; the page does not scroll sideways | M3 |
| Wide diagram / long code line | each scrolls inside its own block; diagram stays legible; code alignment preserved | M3 |
| Unicode filename | opens from tree, search, and `?file=`; address bar shows it encoded; reload resolves the same file | M2, M7 |
| Missing deep link, stale tree, or file deleted while reading | “Note not found” with Browse/Home and a refresh action; a bad link keeps its address; never a blank screen or stale copy | M2, M3, M7 |
| File changed while reading | no auto-update in v1; Reload in the `…` menu shows the new content | M3 |
| Session expired mid-action | sign-in, then return to the same note; a capture draft is kept and sent only by an explicit Send | M1, M5 |
| Sign-in rate limit | distinct message with the wait; form usable afterwards; no auto-retry | M1 |
| Rotation or keyboard | note, drawer state, and draft survive; scroll position approximately preserved; focused field and Send scroll above the keyboard; no duplicate request | all |
| Double-tap Send | exactly one append | M5 |
| Viewer role | reader only; capture and edit absent; a direct write is refused with a message | M1, M5, M9 |

## 6. Acceptance criteria

Tagged **[H]** manual on a real phone (device matrix in the research document) or **[D]** automated in jsdom/Playwright. C1–C6 are cross-cutting.

1. With auth off, the origin loads Home; with auth on and no session, only sign-in is present [D].
2. A correct password opens the requested `?file=` note, a wrong one shows an inline error, and a 401 during a read returns to sign-in and then to the same note [H].
3. Home exposes Search, Continue, Bookmarks, Recent, and Browse; Continue opens the last note read on that device and is absent with no history [D].
4. Browse expands a folder on tap, opens a file, and closes the drawer; back closes an open drawer or sheet before leaving the note [D].
5. Bookmarks opens in saved order and offers no add, remove, or reorder; an empty list explains desktop [D].
6. At the mobile breakpoint the reading column is wider than 0 px and the page has no horizontal overflow [D].
7. A wide table, a long code line, and an over-wide diagram each scroll inside their own block; images fit without overflow [H].
8. An internal link opens in place, an external link opens a new tab, and back returns to the note [H].
9. Typing issues one search request per debounce interval and none for an empty query [D].
10. Tapping a hit opens that note at the match and marks it; empty and failed searches keep the query, and a failure offers Retry [D].
11. Send posts to `/api/file/append` for `Inbox.md` with `create:true` and the typed text as one blank-line-separated block [D].
12. Send is disabled in flight, and a double tap produces exactly one append [D].
13. The draft survives a reload and a background/foreground cycle [H].
14. `Inbox.md` is created on first capture and gains exactly one block per capture [D].
15. A viewer role sees no capture entry; a direct write is refused with a message [D].
16. Theme and text size apply immediately, and the sheet states the change is server-wide [D].
17. Sign out is present only with auth on; AI, export, graph, admin, and token settings are absent [D].
18. A `?file=` link lands on that note; an unknown path shows “Note not found” with Browse and Home, and Reload/Continue return to the correct note [D].
19. A deleted Continue target falls back to Home with a notice; a deleted deep link stays on “Note not found” [D].
20. A network failure shows “Can't reach the server” with Retry, and Retry restores the previous view; a 401 shows sign-in, a 403 shows the role message, and the failure screen states there is no cache [D].
21. C1 — No action needs hover, right-click, a long-press menu, or a keyboard; every desktop right-click menu has a `…` equivalent [H].
22. C2 — Every form field renders at 16 px or larger and focusing it does not zoom the page [H].
23. C3 — Every tappable control measures at least 44 × 44 CSS px, including `…` buttons and drawer rows [D].
24. C4 — At the desktop breakpoint the shell is unchanged: same four columns, tab strip, widths, and menus [D].
25. C5 — Reading a note on a phone changes neither the desktop's open tabs, active file, nor panel widths [D].
26. C6 — Unreachable and unauthorized are visually distinct: Retry versus sign-in; rotation and keyboard focus preserve the note, drawer state, and draft [H].
27. M9 — With a note open, ✎ and **Edit note** enter WYSIWYG mode; the toolbar keeps text on the caret, Save writes, and back/Done/Esc leave before navigating [D]. A viewer sees no edit entry [D].

## 7. Out-of-scope confirmation and the v2 boundary

§2.2 stands: no excluded item ships, and the shipped shell implies none of them — no disabled tabs, no offline promise. Still deferred: source (CM6) editing, tabs, TOC, per-device prefs, lightbox with pan, export, graph, AI, table/diagram visual designers, admin settings, and an offline cache only if the server story changes.

| Still-deferred need | What the shipped shell must preserve |
|---|---|
| Tabs | note identity is the `?file=` path; back uses visit order, not a tab stack |
| Per-device prefs | v1 says theme and size are server-wide; never presents them as per-device |
| Lightbox, offline | images and diagrams keep block boundaries; nothing claims cached content or background delivery |

## 8. Assumptions and open questions

**Assumptions.** A1 `Inbox.md` is the only capture target in v1. A2 Each capture is one verbatim block, blank-line separated, with no timestamp. A3 Continue is device-local; Recent is the server's shared list. A4 The mobile layout is chosen by viewport width, not user agent, so a large tablet may use the desktop shell. A5 The existing session policy applies unchanged; mobile adds no session lifetime. A6 The iOS floor and device table come from [mobile-support](../research/mobile-support.md), not from this spec.

**Open questions.** Q1 Which iOS versions and devices are the v1 floor? (research) Q5 Is a first-run “no password is set” notice needed for a LAN server?

Resolved during design: the capture target is `Inbox.md`; Recent stays the server's shared list; Search is always one tap away in the bottom rail, so the note header does not need a second entry.
