/* Real-browser test for the §sessions content page (docs/ui/sessions-page.md).
 *
 * jsdom cannot see layout and cannot run a real HTML5 drag, so this suite
 * boots the REAL app on a temp notebook and checks, at 1280:
 *   - the Sessions rail icon opens the panel, `#sessions-page-btn` is its
 *     header's second action, and it opens the page as exactly one
 *     `§sessions` tab (AC1);
 *   - the page replaces the reader while the strip and both side panels
 *     stay;
 *   - the grid follows the editor track, not a fixed count: two columns
 *     with both panels open and three with the outline collapsed (AC16),
 *     measured from the cards' own boxes;
 *   - a row dragged from one card onto another moves it, with the drop mark
 *     and the `Move here` count swap visible mid-gesture (AC9);
 *   - Ctrl+click then Shift+click select two rows of one card, and dragging
 *     one of them moves both (AC10);
 *   - the page's tab survives a reload, because the move reached the
 *     workspace-state write (AC1's persistence rule, AC9's state write);
 * and at 390 the entry button is not displayed (AC18's phone rule).
 *
 * The drag is a real pointer drag: `page.mouse` down / move past the
 * browser's threshold / move onto the target card's header / up. That is the
 * same technique the tabs-view suite uses for its HTML5 row drag; Chromium
 * turns the pressed-and-moved draggable `<li>` into a native drag, so the
 * page's own dragstart / dragover / drop handlers run unmodified.
 *
 * Run:  node tests/browser/test_sessions_page_browser.js
 * Env:  CHROMIUM_PATH  override the browser binary (NixOS needs this).
 *       PORT           server port (default 5078)
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const playwright = require("playwright");

const PROJ = path.resolve(__dirname, "..", "..");
const PY = path.join(PROJ, ".venv_" + os.hostname(), "bin", "python");
const BROWSER_TYPE = playwright.chromium;
const { findChromium } = require("./chromium");
const BROWSER_PATH = process.env.CHROMIUM_PATH || findChromium();
const PORT = Number(process.env.PORT || 5078);
const BASE = "http://127.0.0.1:" + PORT;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nb-sessions-page-"));
const DATA = path.join(tmp, "notebook");
const CONFIG = path.join(tmp, "config");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(CONFIG, { recursive: true });
fs.writeFileSync(path.join(CONFIG, "config.json"), "{}");

const NOTES = {
  "Welcome.md": "# Welcome\n\nSessions page smoke test.\n",
  "Second.md": "# Second\n\nAnother root note.\n",
  "notes/a.md": "# File A\n\nTODO fix this bug.\n",
  "notes/b.md": "# File B\n\nAnother TODO fix this here.\n",
  "notes/c.md": "# File C\n\nThird note.\n",
  "notes/d.md": "# File D\n\nFourth note.\n",
};
for (const [rel, body] of Object.entries(NOTES)) {
  const p = path.join(DATA, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

/* Four sessions, so the one-row card count proves the column count: two
 * columns put two cards on the first row, three put three. */
const SESSIONS = [
  { id: "s1", name: "Main", openFiles: ["Welcome.md", "Second.md"],
    activeFile: null },
  { id: "s2", name: "Reading", openFiles: ["notes/a.md", "notes/b.md"],
    activeFile: null },
  { id: "s3", name: "Scratch", openFiles: ["notes/c.md"], activeFile: null },
  { id: "s4", name: "Last", openFiles: ["notes/d.md"], activeFile: null },
];

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log("  ok   " + name); }
  else { failed++; console.log("  FAIL " + name + (detail ? "  [" + detail + "]" : "")); }
}

async function waitForServer(child) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE + "/api/auth");
      if (r.ok || r.status === 401) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not start");
}

async function bootApp(page) {
  await page.waitForFunction(
    () => window.NB && window.NB.tabs && window.NB.activity, null,
    { timeout: 20000 });
  await page.waitForSelector("#viewer-content", { state: "attached",
    timeout: 10000 });
}

/* Seed the four sessions and make the page's own tab the live one, so the
 * page is showing and its own row is the current row. */
async function seedSessions(page) {
  await page.evaluate(async (sessions) => {
    await window.NB.tabs.restore([], null, null, [], {
      sessions: sessions.map((s) => ({
        id: s.id, name: s.name,
        openFiles: s.openFiles.slice(),
        activeFile: s.activeFile || null,
      })),
      activeSessionId: "s1",
      pinnedFiles: [],
      migrated: false,
    });
    await window.NB.tabs.openSpecial("§sessions");
  }, SESSIONS);
  await page.waitForFunction(
    () => !document.getElementById("sessions-page").hidden, null,
    { timeout: 5000 });
  await page.waitForTimeout(200);
}

const cardSel = (id) => '#sessions-page .session-card[data-session-id="' + id + '"]';
const rowSel = (id, p) =>
  '#sessions-page .session-card-tab-wrap[data-session-id="' + id +
  '"][data-path="' + p + '"] .session-card-tab';

async function boxOf(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, selector);
}

/* How many cards share the first row's top edge: that is the column count
 * the grid resolved to, read from the cards rather than from a CSS string. */
async function firstRowCards(page) {
  return page.evaluate(() => {
    const cards = Array.from(
      document.querySelectorAll("#sessions-page .session-card"));
    if (!cards.length) return 0;
    const tops = cards.map((c) => Math.round(c.getBoundingClientRect().top));
    const first = Math.min.apply(null, tops);
    return tops.filter((t) => t === first).length;
  });
}

async function pageState(page) {
  return page.evaluate(() => {
    const shown = (id) => {
      const el = document.getElementById(id);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return !el.hidden && r.width > 0 && r.height > 0;
    };
    const cards = Array.from(
      document.querySelectorAll("#sessions-page .session-card"));
    return {
      pageShown: shown("sessions-page"),
      viewerShown: shown("viewer"),
      stripShown: shown("tab-bar"),
      panelShown: shown("side-panel"),
      outlineShown: shown("outline-pane"),
      sessionsViewShown: shown("sessions-view"),
      stripTabs: Array.from(document.querySelectorAll("#tab-bar .tab"))
        .map((t) => t.dataset.path),
      cards: cards.length,
      sessionIds: cards.map((c) => c.dataset.sessionId),
      rows: Object.fromEntries(cards.map((c) => [
        c.dataset.sessionId,
        Array.from(c.querySelectorAll(".session-card-tab"))
          .map((r) => r.dataset.path),
      ])),
      summary: (document.querySelector("#sessions-page .sessions-page-summary")
        || {}).textContent || "",
      chip: (() => {
        const el = document.querySelector(
          "#sessions-page .sessions-page-selection");
        return el && !el.hidden ? el.textContent.trim() : "";
      })(),
    };
  });
}

async function modelState(page) {
  return page.evaluate(() => ({
    snapshot: window.NB.tabs.snapshot(),
    activeSessionId: window.NB.tabs.getActiveSessionId(),
    active: window.NB.tabs.getActive(),
    open: window.NB.tabs.getOpen(),
  }));
}

async function main() {
  const child = spawn(PY, ["app.py", "--host", "127.0.0.1", "--port", String(PORT)], {
    cwd: PROJ,
    env: Object.assign({}, process.env, {
      NOTEBOOK_DATA_DIR: DATA,
      NOTEBOOK_CONFIG_DIR: CONFIG,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  child.stdout.on("data", (d) => { serverLog += d; });
  child.stderr.on("data", (d) => { serverLog += d; });

  let browser;
  try {
    browser = await BROWSER_TYPE.launch({
      headless: true,
      executablePath: BROWSER_PATH,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  } catch (err) {
    console.error("cannot launch chromium: " + String(err).split("\n")[0]);
    console.error("Set CHROMIUM_PATH to a working binary, or install the browser " +
      "for this platform.");
    child.kill("SIGTERM");
    process.exit(2);
  }

  try {
    await waitForServer(child);

    // --- 1280: the entry, the page, the columns (AC1, AC16) ----------
    {
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        serviceWorkers: "block",
      });
      const page = await ctx.newPage();
      const pageErrors = [];
      page.on("pageerror", (e) => pageErrors.push(String(e)));
      await page.goto(BASE + "/?file=Welcome.md");
      await bootApp(page);

      // The Sessions rail icon opens the panel.
      await page.click('#activity-bar .activity-btn[data-view="sessions"]');
      await page.waitForFunction(
        () => !document.getElementById("sessions-view").hidden, null,
        { timeout: 5000 });
      await page.waitForTimeout(150);
      check("1280: the Sessions rail icon opens the panel",
        await page.evaluate(() => {
          const el = document.getElementById("sessions-view");
          return !el.hidden && el.getBoundingClientRect().width > 100;
        }));

      const actions = await page.evaluate(() => {
        const kids = Array.from(
          document.querySelectorAll(
            "#sessions-view .panel-header-actions > *"));
        return kids.map((k) => k.id || k.className);
      });
      check("1280: the page button is the header's second action, before the collapse",
        actions.length === 3 && actions[0] === "session-add" &&
        actions[1] === "sessions-page-btn" &&
        /\bcollapse-btn\b/.test(actions[2]),
        actions.join(","));

      // The button opens the page as exactly one tab.
      await page.evaluate(() => window.NB.tabs.clearAll());
      await page.waitForTimeout(120);
      await seedSessions(page);
      const openBefore = await page.evaluate(() => window.NB.tabs.getOpen());
      check("1280: the seeded state opens the page as one §sessions tab",
        openBefore.filter((p) => p === "§sessions").length === 1,
        openBefore.join(","));
      // The button itself, from the panel: close the page tab first and let
      // the header button open it again.
      await page.evaluate(() => window.NB.tabs.close("§sessions"));
      await page.waitForTimeout(200);
      await page.click("#sessions-page-btn");
      await page.waitForFunction(
        () => !document.getElementById("sessions-page").hidden, null,
        { timeout: 5000 });
      await page.waitForTimeout(200);
      const afterBtn = await modelState(page);
      check("1280: #sessions-page-btn opens the page as exactly one tab",
        afterBtn.open.filter((p) => p === "§sessions").length === 1 &&
        afterBtn.active === "§sessions" &&
        (await page.evaluate(() => document.querySelectorAll(
          '#tab-bar .tab[data-path="§sessions"]').length)) === 1,
        afterBtn.open.join(","));
      await page.click("#sessions-page-btn");
      await page.waitForTimeout(200);
      check("1280: a second click focuses the same tab, it never duplicates",
        (await modelState(page)).open
          .filter((p) => p === "§sessions").length === 1);

      const shown = await pageState(page);
      check("1280: the page replaces the reader and the strip and both panels stay",
        shown.pageShown && !shown.viewerShown && shown.stripShown &&
        shown.panelShown && shown.outlineShown && shown.sessionsViewShown,
        JSON.stringify(shown));
      check("1280: one card per session, in model order",
        shown.cards === 4 && shown.sessionIds.join(",") === "s1,s2,s3,s4" &&
        shown.summary === "4 sessions · 7 tabs",
        shown.cards + " / " + shown.summary);
      check("1280: every card lists its own session's tabs",
        shown.rows.s1.join(",") === "Welcome.md,Second.md,§sessions" &&
        shown.rows.s2.join(",") === "notes/a.md,notes/b.md" &&
        shown.rows.s3.join(",") === "notes/c.md" &&
        shown.rows.s4.join(",") === "notes/d.md",
        JSON.stringify(shown.rows));

      // AC16: the grid follows the editor track, not a fixed count.
      const twoCols = await firstRowCards(page);
      check("1280: the grid paints two columns with both panels open",
        twoCols === 2, String(twoCols));
      await page.screenshot({ path: path.join(tmp, "sessions-page-1280.png") });

      await page.click("#outline-collapse");
      await page.waitForTimeout(250);
      const threeCols = await firstRowCards(page);
      check("1280: collapsing the outline widens the grid to three columns",
        threeCols === 3, String(threeCols));
      await page.screenshot({ path: path.join(tmp, "sessions-page-3col.png") });
      // The collapsed pane hides its own collapse control; the strip's own
      // outline toggle is the way back (the same state, the same control).
      await page.click("#outline-toggle");
      await page.waitForTimeout(250);
      check("1280: expanding the outline takes the grid back to two columns",
        (await firstRowCards(page)) === 2);

      // --- AC9: a real pointer drag, one row onto another card -------
      const dragSource = rowSel("s2", "notes/a.md");
      const dragTarget = cardSel("s4");
      const src = await boxOf(page, dragSource);
      const dst = await boxOf(page, dragTarget);
      check("1280: the drag fixture is on screen",
        !!src && !!dst && src.h > 0 && dst.h > 0,
        JSON.stringify({ src, dst }));
      const sx = src.x + src.w / 2;
      const sy = src.y + src.h / 2;
      const tx = dst.x + dst.w / 2;
      const ty = dst.y + 15;                 // the target card's header
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      // Past the browser's drag threshold first, so this is a drag and not a
      // text selection (the tabs-view suite's technique).
      await page.mouse.move(sx + 8, sy + 8, { steps: 4 });
      await page.mouse.move(tx, ty, { steps: 12 });
      await page.mouse.move(tx, ty, { steps: 2 });
      await page.waitForTimeout(200);
      const midDrag = await page.evaluate(() => ({
        targets: document.querySelectorAll(
          "#sessions-page .session-card.is-drop-target").length,
        targetId: (() => {
          const el = document.querySelector(
            "#sessions-page .session-card.is-drop-target");
          return el ? el.dataset.sessionId : "";
        })(),
        countText: (() => {
          const el = document.querySelector(
            "#sessions-page .session-card.is-drop-target .session-card-count");
          return el ? el.textContent : "";
        })(),
        dragging: document.querySelectorAll(
          "#sessions-page .session-card-tab-wrap.is-dragging").length,
      }));
      await page.screenshot({ path: path.join(tmp, "sessions-page-drag.png") });
      check("1280: the drag marks the source row and the one target card",
        midDrag.dragging === 1 && midDrag.targets === 1 &&
        midDrag.targetId === "s4" && midDrag.countText === "Move here",
        JSON.stringify(midDrag));
      await page.mouse.up();
      await page.waitForFunction(() => {
        const s = window.NB.tabs.snapshot().find((x) => x.id === "s4");
        return !!s && s.openFiles.indexOf("notes/a.md") >= 0;
      }, null, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(300);
      const dropped = await pageState(page);
      const droppedModel = await modelState(page);
      check("1280: a real mouse drag moves the row into the target card",
        dropped.rows.s4.join(",") === "notes/d.md,notes/a.md" &&
        dropped.rows.s2.join(",") === "notes/b.md",
        JSON.stringify(dropped.rows));
      check("1280: the model agrees with the page after the drop",
        droppedModel.snapshot.find((s) => s.id === "s4").openFiles.join(",") ===
          "notes/d.md,notes/a.md" &&
        droppedModel.snapshot.find((s) => s.id === "s2").openFiles.join(",") ===
          "notes/b.md",
        JSON.stringify(droppedModel.snapshot.map((s) => s.id + ":" +
          s.openFiles.join("|"))));
      // --- AC15: a rebuild keeps the scroller's position ----------------
      await page.setViewportSize({ width: 1280, height: 420 });
      const scrollBefore = await page.evaluate(() => {
        const b = document.querySelector("#sessions-page .sessions-page-body");
        b.scrollTop = Math.floor(b.scrollHeight / 2);
        return { top: b.scrollTop, max: b.scrollHeight - b.clientHeight };
      });
      await page.evaluate(() => {
        const first = window.NB.tabs.snapshot()[0];
        window.NB.tabs.renameSession(first.id, first.name + " renamed");
      });
      const scrollAfter = await page.evaluate(() => {
        const b = document.querySelector("#sessions-page .sessions-page-body");
        return {
          top: b.scrollTop,
          visible: !document.getElementById("sessions-page").hidden,
        };
      });
      check("1280: a rebuild keeps the page's scroll position",
        scrollBefore.max > 0 && scrollAfter.visible &&
        scrollAfter.top === scrollBefore.top,
        JSON.stringify({ scrollBefore, scrollAfter }));
      await page.setViewportSize({ width: 1280, height: 800 });

      check("1280: the drop leaves no mark and switches no session",
        droppedModel.activeSessionId === "s1" &&
        droppedModel.active === "§sessions" &&
        (await page.evaluate(() => document.querySelectorAll(
          "#sessions-page .is-drop-target, #sessions-page .is-dragging").length)) === 0);

      // --- AC10: Ctrl+click then Shift+click, drag one, move both -----
      await page.click(rowSel("s1", "Welcome.md"), { modifiers: ["Control"] });
      await page.click(rowSel("s1", "Second.md"), { modifiers: ["Shift"] });
      await page.waitForTimeout(150);
      const selected = await pageState(page);
      check("1280: Ctrl+click then Shift+click select the card's range",
        (await page.evaluate(() => document.querySelectorAll(
          "#sessions-page .session-card-tab.is-selected").length)) === 2 &&
        selected.chip === "2 tabs selected",
        selected.chip);
      const selSrc = await boxOf(page, rowSel("s1", "Welcome.md"));
      const selDst = await boxOf(page, cardSel("s3"));
      await page.mouse.move(selSrc.x + selSrc.w / 2, selSrc.y + selSrc.h / 2);
      await page.mouse.down();
      await page.mouse.move(selSrc.x + selSrc.w / 2 + 8,
        selSrc.y + selSrc.h / 2 + 8, { steps: 4 });
      await page.mouse.move(selDst.x + selDst.w / 2, selDst.y + 15, { steps: 12 });
      await page.mouse.move(selDst.x + selDst.w / 2, selDst.y + 15, { steps: 2 });
      await page.waitForTimeout(150);
      check("1280: dragging a selected row carries both rows",
        (await page.evaluate(() => document.querySelectorAll(
          "#sessions-page .session-card-tab-wrap.is-dragging").length)) === 2);
      await page.mouse.up();
      await page.waitForFunction(() => {
        const s = window.NB.tabs.snapshot().find((x) => x.id === "s3");
        return !!s && s.openFiles.length === 3;
      }, null, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(300);
      const batch = await pageState(page);
      check("1280: both selected rows move, once each",
        batch.rows.s3.join(",") === "notes/c.md,Welcome.md,Second.md" &&
        batch.rows.s1.join(",") === "§sessions",
        JSON.stringify(batch.rows));
      check("1280: the moved keys leave the selection",
        batch.chip === "", batch.chip);

      // --- AC6: a single click opens nothing; a double click does ------
      await page.click(rowSel("s3", "notes/c.md"));
      await page.waitForTimeout(150);
      const afterClick = await page.evaluate(() => ({
        active: window.NB.tabs.getActive(),
        shown: !document.getElementById("sessions-page").hidden,
      }));
      check("1280: a single click opens nothing and keeps the page",
        afterClick.active === "§sessions" && afterClick.shown,
        JSON.stringify(afterClick));
      const clickedSelected = await page.evaluate(() =>
        document.querySelectorAll("#sessions-page .session-card-tab.is-selected").length);
      check("1280: a single click selects that row alone",
        clickedSelected === 1, String(clickedSelected));
      await page.click("#sessions-page .sessions-page-foot");
      await page.waitForTimeout(120);
      const afterBackground = await page.evaluate(() => ({
        selected: document.querySelectorAll(
          "#sessions-page .session-card-tab.is-selected").length,
        active: window.NB.tabs.getActive(),
        shown: !document.getElementById("sessions-page").hidden,
      }));
      check("1280: a click on empty space clears the selection",
        afterBackground.selected === 0 && afterBackground.active === "§sessions" &&
        afterBackground.shown, JSON.stringify(afterBackground));
      await page.dblclick(rowSel("s3", "notes/c.md"));
      // The swap lands first; the reader hides the page when it renders.
      await page.waitForFunction(
        () => window.NB.tabs.getActive() === "notes/c.md" &&
          document.getElementById("sessions-page").hidden, null,
        { timeout: 8000 }).catch(() => {});
      const afterOpen = await page.evaluate(() => ({
        active: window.NB.tabs.getActive(),
        session: window.NB.tabs.getActiveSessionId(),
        hidden: document.getElementById("sessions-page").hidden,
      }));
      check("1280: a double click opens that tab",
        afterOpen.active === "notes/c.md" && afterOpen.session === "s3" &&
        afterOpen.hidden === true, JSON.stringify(afterOpen));
      // Back to the page in its own session, without adding a §sessions tab
      // to s3 (the state-write assertion below pins s3's list).
      await page.evaluate(() => window.NB.tabs.swapTo("s1"));
      await page.waitForFunction(
        () => window.NB.tabs.getActiveSessionId() === "s1", null,
        { timeout: 5000 }).catch(() => {});
      await page.evaluate(() => window.NB.tabs.activate("§sessions"));
      await page.waitForFunction(
        () => !document.getElementById("sessions-page").hidden, null,
        { timeout: 5000 });

      // --- AC1/AC9: the state write and the reload --------------------
      await page.evaluate(() => window.NB.tabs.activate("§sessions"));
      const wsPost = page.waitForResponse(
        (r) => r.request().method() === "POST" &&
          new URL(r.url()).pathname === "/api/workspace-state",
        { timeout: 8000 }).catch(() => null);
      // Any further state write: the debounce is 250 ms, and the moves
      // already armed one, so re-arm it with a real change and wait.
      await page.evaluate(() => window.NB.tabs.activate("§sessions"));
      await page.evaluate(() => window.NB.tabs.renameSession("s4", "Last one"));
      const posted = await wsPost;
      const postedState = posted
        ? (posted.request().postDataJSON() || {}).state : null;
      check("1280: the moves reach POST /api/workspace-state",
        !!postedState && Array.isArray(postedState.sessions) &&
        postedState.sessions.find((s) => s.id === "s3").openFiles
          .join(",") === "notes/c.md,Welcome.md,Second.md",
        postedState ? JSON.stringify(postedState.sessions.map(
          (s) => s.id + ":" + s.openFiles.join("|"))) : "no POST");

      await page.reload({ waitUntil: "domcontentloaded" });
      await bootApp(page);
      await page.waitForFunction(
        () => !document.getElementById("sessions-page").hidden, null,
        { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(300);
      const reloaded = await pageState(page);
      const reloadedModel = await modelState(page);
      check("1280: the §sessions tab survives a reload",
        reloadedModel.open.indexOf("§sessions") >= 0 &&
        reloadedModel.active === "§sessions" && reloaded.pageShown,
        reloadedModel.open.join(","));
      check("1280: the reload restores every moved row",
        reloaded.rows.s3.join(",") === "notes/c.md,Welcome.md,Second.md" &&
        reloaded.rows.s4.join(",") === "notes/d.md,notes/a.md" &&
        reloaded.rows.s2.join(",") === "notes/b.md",
        JSON.stringify(reloaded.rows));

      check("1280: no uncaught page errors", pageErrors.length === 0,
        pageErrors.join(" | "));
      await ctx.close();
    }

    // --- 390: the entry is not there (AC18) -------------------------
    {
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        serviceWorkers: "block",
      });
      const page = await ctx.newPage();
      const pageErrors = [];
      page.on("pageerror", (e) => pageErrors.push(String(e)));
      await page.goto(BASE + "/");
      await bootApp(page);
      await page.evaluate(() => window.NB.activity.activate("sessions"));
      await page.waitForTimeout(300);
      const phone = await page.evaluate(() => {
        const btn = document.getElementById("sessions-page-btn");
        return {
          mode: document.documentElement.dataset.uiMode,
          exists: !!btn,
          display: btn ? getComputedStyle(btn).display : "missing",
          width: btn ? btn.getBoundingClientRect().width : -1,
          pageHidden: document.getElementById("sessions-page").hidden,
        };
      });
      check("390: the phone shell hides the page's entry button",
        phone.mode === "phone" && phone.exists && phone.display === "none" &&
        phone.width === 0,
        JSON.stringify(phone));
      check("390: the phone opens no sessions page by itself",
        phone.pageHidden === true);
      check("390: no uncaught page errors", pageErrors.length === 0,
        pageErrors.join(" | "));
      await page.screenshot({ path: path.join(tmp, "sessions-page-390.png") });
      await ctx.close();
    }
  } finally {
    await browser.close();
    child.kill("SIGTERM");
  }

  console.log("\nRESULT: " + (failed ? "FAIL" : "PASS") +
    "  (" + passed + " ok, " + failed + " failed)");
  if (failed) {
    console.log("--- server log tail ---\n" + serverLog.slice(-2000));
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
