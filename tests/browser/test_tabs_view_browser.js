/* Real-browser test for the Tabs side-panel view (docs/ui/tabs-view.md).
 *
 * jsdom cannot see layout, so the row contract's whole point -- one label
 * edge and one trailing edge across every row state (AC4a) -- is only
 * measurable here. This suite boots the REAL app on a temp notebook and
 * checks:
 *   - 1280: the Tabs rail icon is the eighth view and opens `#tabs-view`
 *     with one row per open tab, pinned first;
 *   - every `.tab-item-name` starts on one left edge and ends on one
 *     truncation edge, and every close/gap box ends on one right edge,
 *     across a pinned, a dirty, a conflicted, a special and an idle row;
 *   - drag-to-reorder with a real pointer: row 3 dropped on row 1's top
 *     half reorders the rows, the model and the workspace write, a gesture
 *     from a close button reorders nothing, and an unpinned row dropped on
 *     a pinned row lands after the pinned prefix;
 *   - hiding the strip (AC13): `#tab-bar` is not displayed, the setting is
 *     posted and stored, a script-free load paints the server's frame with
 *     the strip already hidden, the rail's outline twin appears and toggles
 *     the pane, and showing it again restores both;
 *   - 390: the view opens in the drawer from the More sheet, rows and the
 *     close reach 44 px, and a tap opens the note and closes the drawer.
 *
 * Run:  node tests/browser/test_tabs_view_browser.js
 * Env:  CHROMIUM_PATH  override the browser binary (NixOS needs this).
 *       PORT           server port (default 5079)
 *
 * Chromium only: the phone context uses Playwright's isMobile option.
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
const PORT = Number(process.env.PORT || 5079);
const BASE = "http://127.0.0.1:" + PORT;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nb-tabs-view-"));
const DATA = path.join(tmp, "notebook");
const CONFIG = path.join(tmp, "config");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(CONFIG, { recursive: true });
fs.writeFileSync(path.join(CONFIG, "config.json"), "{}");

const NOTES = {
  "Welcome.md": "# Welcome\n\nTabs view smoke test.\n",
  "Second.md": "# Second\n\nAnother root note.\n",
  "notes/a.md": "# File A\n\nTODO fix this bug.\n",
  "notes/b.md": "# File B\n\nAnother TODO fix this here.\n",
};
for (const [rel, body] of Object.entries(NOTES)) {
  const p = path.join(DATA, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log("  ok   " + name); }
  else { failed++; console.log("  FAIL " + name + (detail ? "  [" + detail + "]" : "")); }
}

// The phone restores the shared sessions; give it an empty Main so this
// block's two opens are the whole workspace.
async function resetWorkspaceState() {
  const cfg = await (await fetch(BASE + "/api/config")).json();
  const base = (cfg.workspaceState && cfg.workspaceState.default) || {};
  const state = {
    sessions: [{ id: "main", name: "Main", openFiles: [], activeFile: null }],
    activeSessionId: "main",
    pinnedFiles: [], openFiles: [], activeFile: null,
    lastFile: null, recentFiles: [], bookmarks: [], pinnedFolders: [],
  };
  const res = await fetch(BASE + "/api/workspace-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "default", state, base }),
  });
  if (!res.ok) throw new Error("reset workspace state failed: " + res.status);
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
    () => window.NB && window.NB.tabs && window.NB.activity, null, { timeout: 20000 });
  await page.waitForSelector("#viewer-content", { state: "attached", timeout: 10000 });
}

/* Rows of #tabs-view: their path, the name's left and right edges, and the
 * trailing box (the close button, or the pinned row's inert gap) width and
 * right edge. Both name edges are measured because a mark or a state column
 * switched to display:none would move the label's right edge (its
 * truncation point) without moving the left one -- AC4a forbids exactly
 * that. Measured in CSS pixels, so a 1 px seam shows up. */
async function rowGeometry(page) {
  return page.evaluate(() => Array.from(
    document.querySelectorAll("#tabs-view .tab-item-wrap")).map((wrap) => {
    const name = wrap.querySelector(".tab-item-name").getBoundingClientRect();
    const trailEl = wrap.querySelector(".tab-item-close") ||
      wrap.querySelector(".tab-item-gap");
    const trail = trailEl ? trailEl.getBoundingClientRect() : null;
    return {
      path: wrap.dataset.path,
      nameLeft: +name.left.toFixed(2),
      nameRight: +name.right.toFixed(2),
      trailRight: trail ? +trail.right.toFixed(2) : null,
      trailWidth: trail ? +trail.width.toFixed(2) : null,
      trailing: trailEl ? trailEl.className : "",
    };
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

    // --- 1280: the rail icon, the host, the rows (AC1, AC3) ----------
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
      await page.waitForFunction(
        () => /Tabs view smoke test/.test(
          document.getElementById("viewer-content").textContent),
        null, { timeout: 10000 });

      const rail = await page.evaluate(() => ({
        views: Array.from(
          document.querySelectorAll("#activity-bar .activity-btn[data-view]"))
          .map((b) => b.dataset.view),
        tabsIconHref: (() => {
          const btn = document.querySelector(
            '#activity-bar .activity-btn[data-view="tabs"]');
          const use = btn && btn.querySelector("use");
          return use ? use.getAttribute("href") : "";
        })(),
        railViews: window.NB.activity.railViews().map((v) => v.id),
      }));
      check("1280: the Tabs view is the eighth rail icon",
        rail.views.length === 8 && rail.views[7] === "tabs" &&
        rail.railViews.join(",") === rail.views.join(","),
        rail.views.join(","));
      check("1280: the Tabs icon uses the new #nb-icon-tabs sprite",
        rail.tabsIconHref === "#nb-icon-tabs", rail.tabsIconHref);

      await page.click('#activity-bar .activity-btn[data-view="tabs"]');
      await page.waitForFunction(
        () => !document.getElementById("tabs-view").hidden, null, { timeout: 5000 });
      await page.waitForTimeout(120);
      const shown = await page.evaluate(() => ({
        tabsVisible: !document.getElementById("tabs-view").hidden &&
          document.getElementById("tabs-view").getBoundingClientRect().height > 0,
        aiHidden: document.getElementById("ai-view").hidden,
        title: document.querySelector("#tabs-view .panel-title").textContent,
        // The chip paints only the digits; the unit is an .sr-only sibling.
        count: document.querySelector("#tabs-view .tabs-total-n").textContent,
        unit: document.querySelector("#tabs-view .tabs-total .sr-only").textContent,
        stripTabs: document.querySelectorAll("#tab-bar .tab").length,
      }));
      check("1280: the rail icon shows #tabs-view and hides the other hosts",
        shown.tabsVisible && shown.aiHidden && shown.title === "Tabs" &&
        shown.count === String(shown.stripTabs) && shown.unit === " open files",
        JSON.stringify(shown));

      // A pinned row, a dirty row, a conflicted row and an idle row, so the
      // measured edges cover every state's reserved boxes (AC4a).
      await page.evaluate(async () => {
        const T = window.NB.tabs;
        T.clearAll();
        await T.open("notes/a.md");
        await T.open("notes/b.md");
        await T.open("Welcome.md");
        await T.open("Second.md");
        T.togglePin("notes/a.md");
        window.NB.viewer.setDraft("notes/b.md",
          { content: "# File B\n\nunsaved\n", mode: "source" });
        window.NB.viewer.setDraft("Welcome.md",
          { content: "# Welcome\n\nunsaved\n", mode: "source" });
        window.NB.evt.emit("viewer:conflict", { path: "Welcome.md", conflict: true });
      });
      await page.waitForTimeout(150);

      const model = await page.evaluate(() => ({
        open: window.NB.tabs.getOpen(),
        rows: Array.from(document.querySelectorAll("#tabs-view .tab-item-wrap"))
          .map((w) => w.dataset.path),
        pinned: window.NB.tabs.getOpen().filter((p) => window.NB.tabs.isPinned(p)),
        states: Array.from(document.querySelectorAll("#tabs-view .tab-item-wrap"))
          .map((w) => ({
            path: w.dataset.path,
            label: w.querySelector(".tab-item").getAttribute("aria-label"),
            dot: !!w.querySelector(".tab-item-dot"),
            conflict: !!w.querySelector('.tab-item-state use[href="#nb-icon-conflict"]'),
            close: w.querySelectorAll(".tab-item-close").length,
            gap: w.querySelectorAll(".tab-item-gap").length,
          })),
        count: document.querySelector("#tabs-view .tabs-total-n").textContent,
      }));
      check("1280: one row per open tab, in strip order",
        model.rows.join(",") === model.open.join(",") && model.rows.length === 4,
        model.rows.join(",") + " vs " + model.open.join(","));
      check("1280: the pinned tab is the first row and the only one without a close",
        model.pinned.join(",") === "notes/a.md" &&
        model.states[0].path === "notes/a.md" &&
        model.states[0].close === 0 && model.states[0].gap === 1 &&
        model.states.slice(1).every((s) => s.close === 1 && s.gap === 0),
        JSON.stringify(model.states));
      check("1280: the count chip equals the row count",
        model.count === String(model.rows.length), model.count);
      const byPath = new Map(model.states.map((s) => [s.path, s]));
      check("1280: a dirty row shows the dot, a conflicted row the glyph",
        byPath.get("notes/b.md").dot === true &&
        byPath.get("notes/b.md").label === "b.md, unsaved changes" &&
        byPath.get("Welcome.md").conflict === true &&
        byPath.get("Welcome.md").dot === false &&
        byPath.get("Welcome.md").label === "Welcome.md, unsaved changes, changed on disk",
        JSON.stringify([byPath.get("notes/b.md"), byPath.get("Welcome.md")]));

      // --- the special row takes part in the same sweep (AC4a) --------
      // §graph is registered by graph.js as { icon: "nb-icon-graph", label:
      // "Graph" }, so its row is named by that label -- never the pseudo-path
      // -- and carries the module sprite in the mark column. It is a row of
      // the same four boxes, so it must share the one label edge too.
      const specialOpened = await page.evaluate(async () => {
        await window.NB.tabs.openSpecial("§graph");
        return window.NB.tabs.getOpen();
      });
      await page.waitForTimeout(200);
      const special = await page.evaluate(() => {
        const wrap = document.querySelector(
          '#tabs-view .tab-item-wrap[data-path="§graph"]');
        if (!wrap) return null;
        const row = wrap.querySelector(".tab-item");
        const close = wrap.querySelector(".tab-item-close");
        return {
          name: wrap.querySelector(".tab-item-name").textContent,
          label: row.getAttribute("aria-label"),
          title: row.title,
          close: close ? close.getAttribute("aria-label") : null,
          isSpecial: wrap.classList.contains("is-special"),
          sprite: !!wrap.querySelector('.tab-item-mark use[href="#nb-icon-graph"]'),
          markEmpty: !!wrap.querySelector(".tab-item-mark.is-empty"),
          labelFace: getComputedStyle(
            wrap.querySelector(".tab-item-name")).fontStyle,
        };
      });
      check("1280: openSpecial adds the §graph row last",
        specialOpened.indexOf("§graph") === specialOpened.length - 1,
        specialOpened.join(","));
      check("1280: the special row is named 'Graph', never its pseudo-path",
        !!special && special.name === "Graph" && special.label === "Graph" &&
        special.title === "Graph",
        JSON.stringify(special));
      check("1280: the special row's close is 'Close Graph'",
        !!special && special.close === "Close Graph",
        JSON.stringify(special));
      check("1280: the special row carries the is-special face and the module sprite",
        !!special && special.isSpecial && special.sprite && !special.markEmpty &&
        special.labelFace === "italic",
        JSON.stringify(special));

      const geom = await rowGeometry(page);
      const nameLefts = geom.map((g) => g.nameLeft);
      const nameRights = geom.map((g) => g.nameRight);
      const trailRights = geom.map((g) => g.trailRight);
      const trailWidths = geom.map((g) => g.trailWidth);
      const spread = (v) => Math.max(...v) - Math.min(...v);
      check("1280: every row label starts on one left edge (max-min <= 0.5 px)",
        geom.length === 5 && spread(nameLefts) <= 0.5,
        JSON.stringify(nameLefts));
      check("1280: every row label ends on one truncation edge (max-min <= 0.5 px)",
        geom.length === 5 && spread(nameRights) <= 0.5,
        JSON.stringify(nameRights));
      check("1280: every close/gap box ends on one right edge (max-min <= 0.5 px)",
        trailRights.every((v) => v !== null) && spread(trailRights) <= 0.5,
        JSON.stringify(trailRights));
      check("1280: the close and gap boxes share one width (max-min <= 0.5 px)",
        trailWidths.every((v) => v !== null) && spread(trailWidths) <= 0.5,
        JSON.stringify(trailWidths));

      await page.screenshot({ path: path.join(tmp, "tabs-view-1280.png") });

      // --- hiding the strip (AC13; secondary-sidebar.md §5.2) -------
      // The tab bar has no outline toggle any more: the Outline lives in the
      // right panel and its right-rail icon is its only control, so hiding
      // the strip must not strand it.
      const outlineRight = '#activity-bar-right .activity-btn[data-view="outline"]';
      const before = await page.evaluate(() => ({
        barShown: getComputedStyle(document.getElementById("tab-bar")).display,
        hideTabBar: window.NB.app.getHideTabBar(),
        auxW: document.getElementById("aux-panel").getBoundingClientRect().width,
        collapsed: !!window.NB.app.getCfg().auxPanelCollapsed,
        toggles: document.querySelectorAll(
          "#outline-toggle, .outline-toggle, #outline-rail-btn").length,
      }));
      check("1280: hideTabBar defaults off and the strip is painted",
        before.hideTabBar === false && before.barShown !== "none" &&
        before.toggles === 0,
        JSON.stringify(before));

      await page.evaluate(() => window.NB.app.setHideTabBar(true));
      await page.waitForTimeout(120);
      const hidden = await page.evaluate(() => ({
        barShown: getComputedStyle(document.getElementById("tab-bar")).display,
        barAttr: document.getElementById("tab-bar").hidden,
        railIcon: !!document.querySelector(
          '#activity-bar-right .activity-btn[data-view="outline"]'),
        auxW: document.getElementById("aux-panel").getBoundingClientRect().width,
        collapsed: !!window.NB.app.getCfg().auxPanelCollapsed,
      }));
      check("1280: hiding the strip leaves the Outline reachable from the right rail",
        hidden.barAttr === true && hidden.barShown === "none" &&
        hidden.railIcon === true && hidden.auxW > 100,
        JSON.stringify(hidden));

      await page.click(outlineRight);
      await page.waitForTimeout(150);
      const collapsed = await page.evaluate(() => ({
        w: document.getElementById("aux-panel").getBoundingClientRect().width,
        collapsed: !!window.NB.app.getCfg().auxPanelCollapsed,
        pressed: document.querySelector(
          '#activity-bar-right .activity-btn[data-view="outline"]')
          .getAttribute("aria-pressed"),
      }));
      check("1280: the right-rail icon collapses #aux-panel",
        collapsed.collapsed === !hidden.collapsed &&
        collapsed.w <= 1.5 && collapsed.w < hidden.auxW - 50 &&
        collapsed.pressed === "true",
        JSON.stringify(collapsed) + " was " + hidden.auxW);
      await page.click(outlineRight);
      await page.waitForTimeout(150);
      const expanded = await page.evaluate(() => ({
        w: document.getElementById("aux-panel").getBoundingClientRect().width,
        collapsed: !!window.NB.app.getCfg().auxPanelCollapsed,
        pressed: document.querySelector(
          '#activity-bar-right .activity-btn[data-view="outline"]')
          .getAttribute("aria-pressed"),
      }));
      check("1280: a second press expands #aux-panel again",
        expanded.collapsed === hidden.collapsed &&
        Math.abs(expanded.w - hidden.auxW) <= 1 &&
        expanded.pressed === "true",
        JSON.stringify(expanded) + " was " + hidden.auxW);

      await page.evaluate(() => window.NB.app.setHideTabBar(false));
      await page.waitForTimeout(120);
      const restored = await page.evaluate(() => ({
        barShown: getComputedStyle(document.getElementById("tab-bar")).display,
        barAttr: document.getElementById("tab-bar").hidden,
        auxW: document.getElementById("aux-panel").getBoundingClientRect().width,
        tabsRight: document.getElementById("tab-list").getBoundingClientRect().right,
        barRight: document.getElementById("tab-bar").getBoundingClientRect().right,
      }));
      check("1280: showing the strip again restores the bar and keeps the panel",
        restored.barAttr === false && restored.barShown !== "none" &&
        Math.abs(restored.auxW - before.auxW) <= 1 &&
        restored.barRight - restored.tabsRight <= 4.5 && restored.barRight - restored.tabsRight >= 0,
        JSON.stringify(restored));

      // --- the setting persists and the server frame is right (AC13) --
      // The hide is a server-side decision: boot renders #tab-bar with
      // `hidden`. Let the earlier writes' 250 ms debounce land first.
      await page.waitForTimeout(400);
      const cfgPost = page.waitForResponse(
        (r) => r.request().method() === "POST" &&
          new URL(r.url()).pathname === "/api/config",
        { timeout: 5000 }).catch(() => null);
      await page.evaluate(() => window.NB.app.setHideTabBar(true));
      const posted = await cfgPost;
      check("1280: hiding the strip posts the setting to /api/config",
        !!posted && posted.ok(), posted ? String(posted.status()) : "no POST");
      const storedCfg = await (await fetch(BASE + "/api/config")).json();
      check("1280: /api/config stores hideTabBar for the next boot",
        storedCfg.hideTabBar === true, JSON.stringify(storedCfg.hideTabBar));
      const servedHtml = await (await fetch(BASE + "/")).text();
      check("1280: the server render ships the strip hidden",
        /<div id="tab-bar"[^>]*\shidden>/.test(servedHtml),
        (servedHtml.match(/<div id="tab-bar"[^>]*>/) || [""])[0]);
      check("1280: the server render ships no outline toggle or pane",
        !/id="outline-toggle"/.test(servedHtml) &&
        !/id="outline-pane"/.test(servedHtml) &&
        /id="outline-view"/.test(servedHtml));

      // Only a JavaScript-free load sees the server's frame.
      const noJsCtx = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        javaScriptEnabled: false,
      });
      const noJsPage = await noJsCtx.newPage();
      await noJsPage.goto(BASE + "/", { waitUntil: "load" });
      const serverFrame = await noJsPage.evaluate(() => ({
        barAttr: document.getElementById("tab-bar").hidden,
        barShown: getComputedStyle(document.getElementById("tab-bar")).display,
        auxShown: getComputedStyle(document.getElementById("aux-panel")).display,
        outlineVisible: !document.getElementById("outline-view").hidden,
      }));
      check("1280: the server frame alone ships the strip hidden",
        serverFrame.barAttr === true && serverFrame.barShown === "none" &&
        serverFrame.auxShown !== "none" && serverFrame.outlineVisible === true,
        JSON.stringify(serverFrame));
      await noJsCtx.close();

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.NB && window.NB.app, null, { timeout: 20000 });
      const bootedFrame = await page.evaluate(() => ({
        barAttr: document.getElementById("tab-bar").hidden,
        barShown: getComputedStyle(document.getElementById("tab-bar")).display,
        setting: window.NB.app.getHideTabBar(),
      }));
      check("1280: the booted app keeps the strip hidden",
        bootedFrame.barAttr === true && bootedFrame.barShown === "none" &&
        bootedFrame.setting === true,
        JSON.stringify(bootedFrame));

      // Leave the fixture as the 390 context expects it: the strip shown.
      const resetPost = page.waitForResponse(
        (r) => r.request().method() === "POST" &&
          new URL(r.url()).pathname === "/api/config",
        { timeout: 5000 }).catch(() => null);
      await page.evaluate(() => window.NB.app.setHideTabBar(false));
      await resetPost;

      // --- drag to reorder (tabs-view.md §8) -------------------------
      // A real pointer: the wrapper is the HTML5 drag item, so the drag is
      // started by pressing a row and moving past the browser's threshold.
      // The rows are re-measured for every gesture (a drop rebuilds them).
      const rowsOf = () => page.evaluate(() =>
        Array.from(document.querySelectorAll("#tabs-view .tab-item-wrap"))
          .map((w) => w.dataset.path));
      const boxOf = (selector) => page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }, selector);
      const rowSel = (p) =>
        '#tabs-view .tab-item-wrap[data-path="' + p + '"]';
      // edge "top" lands before the row, "bottom" after it. The press point
      // is the row centre, unless `grab` names a child (the close button).
      async function mouseDrag(fromPath, toPath, edge, grab) {
        const src = await boxOf(grab || rowSel(fromPath));
        const dst = await boxOf(rowSel(toPath));
        const sx = src.x + src.w / 2;
        const sy = src.y + src.h / 2;
        const ty = edge === "top" ? dst.y + dst.h * 0.25 : dst.y + dst.h * 0.75;
        await page.mouse.move(sx, sy);
        await page.mouse.down();
        // Past the drag threshold first, so the browser starts a drag and
        // not a text selection.
        await page.mouse.move(sx + 8, sy + 8, { steps: 4 });
        await page.mouse.move(dst.x + dst.w / 2, ty, { steps: 12 });
        await page.mouse.move(dst.x + dst.w / 2, ty, { steps: 2 });
        await page.mouse.up();
      }
      const settleOrder = (want) => page.waitForFunction(
        (w) => window.NB.tabs.getOpen().join(",") === w, want,
        { timeout: 4000 }).catch(() => {});

      // The rail icon toggles the panel when its view is already active (the
      // reload above restored activeView "tabs"), so this activates the view
      // and expands the panel instead of clicking.
      await page.evaluate(() => {
        window.NB.activity.activate("tabs");
        window.NB.activity.expand();
      });
      await page.waitForFunction(() => {
        const el = document.querySelector(
          '#tabs-view .tab-item-wrap[data-path="notes/a.md"]');
        return !!el && el.getBoundingClientRect().height > 0;
      }, null, { timeout: 5000 });
      await page.evaluate(async () => {
        const T = window.NB.tabs;
        T.clearAll();
        await T.open("notes/a.md");
        await T.open("notes/b.md");
        await T.open("Welcome.md");
        await T.activate("notes/a.md");
      });
      await page.waitForTimeout(700);       // let the setup write settle
      check("1280: drag setup: three rows with row 1 active",
        (await rowsOf()).join(",") === "notes/a.md,notes/b.md,Welcome.md" &&
        await page.evaluate(() => window.NB.tabs.getActive()) === "notes/a.md",
        (await rowsOf()).join(","));

      // 8. Row 3 onto row 1's top half: [3,1,2], and the order is workspace
      // state, so it must reach POST /api/workspace-state.
      const dragWsPost = page.waitForResponse(
        (r) => r.request().method() === "POST" &&
          new URL(r.url()).pathname === "/api/workspace-state",
        { timeout: 6000 }).catch(() => null);
      await mouseDrag("Welcome.md", "notes/a.md", "top");
      await settleOrder("Welcome.md,notes/a.md,notes/b.md");
      const dragRows = await rowsOf();
      const dragModel = await page.evaluate(() => ({
        open: window.NB.tabs.getOpen(),
        active: window.NB.tabs.getActive(),
      }));
      check("1280: drag: row 3 dropped on row 1's top half moves the model",
        dragModel.open.join(",") === "Welcome.md,notes/a.md,notes/b.md",
        dragModel.open.join(","));
      check("1280: drag: the DOM rows follow the model order",
        dragRows.join(",") === "Welcome.md,notes/a.md,notes/b.md",
        dragRows.join(","));
      check("1280: drag: the gesture leaves the active tab alone",
        dragModel.active === "notes/a.md", String(dragModel.active));
      const dragPosted = await dragWsPost;
      const dragState = dragPosted
        ? (dragPosted.request().postDataJSON() || {}).state : null;
      check("1280: drag: the new order reaches POST /api/workspace-state",
        !!dragState && Array.isArray(dragState.openFiles) &&
        dragState.openFiles.join(",") === "Welcome.md,notes/a.md,notes/b.md",
        dragState ? JSON.stringify(dragState.openFiles) : "no POST");

      // 9. A press on the close button is a click, not a drag: the browser
      // retargets dragstart at the wrapper, so the view's press flag is what
      // refuses it. The release lands on another row, so no close fires.
      await page.evaluate(async () => {
        const T = window.NB.tabs;
        T.clearAll();
        await T.open("notes/a.md");
        await T.open("notes/b.md");
        await T.open("Welcome.md");
        await T.activate("notes/a.md");
      });
      await page.waitForTimeout(300);
      const closeDragBefore = await rowsOf();
      await mouseDrag("notes/b.md", "notes/a.md", "top",
        rowSel("notes/b.md") + " .tab-item-close");
      await page.waitForTimeout(400);
      const closeDragAfter = await rowsOf();
      check("1280: drag: a gesture from a row's close button reorders nothing",
        closeDragAfter.join(",") === closeDragBefore.join(",") &&
        await page.evaluate(() => window.NB.tabs.getOpen().length === 3),
        closeDragBefore.join(",") + " -> " + closeDragAfter.join(","));

      // 10. The pinned clamp: the dragged row's segment is the model's rule
      // (tabs.js dropOnto), so a pinned row never leaves the prefix.
      await page.evaluate(async () => {
        const T = window.NB.tabs;
        T.clearAll();
        await T.open("notes/a.md");
        await T.open("notes/b.md");
        await T.open("Welcome.md");
        T.togglePin("Welcome.md");
        await T.activate("notes/a.md");
      });
      await page.waitForTimeout(300);
      check("1280: drag: pinning puts Welcome first",
        (await rowsOf()).join(",") === "Welcome.md,notes/a.md,notes/b.md" &&
        await page.evaluate(() => window.NB.tabs.isPinned("Welcome.md")),
        (await rowsOf()).join(","));
      await mouseDrag("notes/b.md", "Welcome.md", "top");
      await settleOrder("Welcome.md,notes/b.md,notes/a.md");
      const clampModel = await page.evaluate(() => ({
        open: window.NB.tabs.getOpen(),
        pinned: window.NB.tabs.isPinned(window.NB.tabs.getOpen()[0]),
      }));
      check("1280: drag: an unpinned row dropped on a pinned row lands after it",
        clampModel.open.join(",") === "Welcome.md,notes/b.md,notes/a.md" &&
        clampModel.pinned,
        clampModel.open.join(","));

      check("1280: no uncaught page errors", pageErrors.length === 0,
        pageErrors.join(" | "));
      await ctx.close();
    }

    // --- 390: the drawer, the 44 px floor, a tap (AC11, AC12) --------
    {
      await resetWorkspaceState();
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

      await page.evaluate(async () => {
        await window.NB.tabs.open("Welcome.md");
        await window.NB.tabs.open("Second.md", { activate: false });
      });
      await page.waitForTimeout(150);
      check("390: the phone rail does not carry the Tabs icon",
        await page.evaluate(() => !document.querySelector(
          '#activity-bar .activity-btn[data-view="tabs"]')));

      await page.click("#activity-more-btn");
      await page.waitForFunction(
        () => !document.getElementById("mobile-views-sheet").hidden, null, { timeout: 5000 });
      await page.waitForTimeout(300);
      const labels = await page.evaluate(() => Array.from(
        document.querySelectorAll("#mobile-views-sheet .mobile-more-label"))
        .map((el) => el.textContent));
      check("390: the More sheet lists Tabs in its Views group",
        labels[0] === "Tabs", labels.join(","));

      await page.locator("#mobile-views-sheet .mobile-more-row").first().click();
      await page.waitForFunction(
        () => document.body.classList.contains("drawer-open") &&
          document.body.dataset.drawerView === "tabs", null, { timeout: 5000 });
      await page.waitForTimeout(300);
      check("390: the Tabs view opens in the drawer",
        await page.evaluate(() =>
          !document.getElementById("tabs-view").hidden &&
          document.getElementById("tabs-view").getBoundingClientRect().width > 0 &&
          document.getElementById("tabs-view").getBoundingClientRect().right <=
            window.innerWidth + 1));

      const phone = await page.evaluate(() => ({
        rows: Array.from(document.querySelectorAll("#tabs-view .tab-item-wrap"))
          .map((w) => ({
            path: w.dataset.path,
            h: w.querySelector(".tab-item").getBoundingClientRect().height,
          })),
        closes: Array.from(document.querySelectorAll("#tabs-view .tab-item-close"))
          .map((b) => {
            const r = b.getBoundingClientRect();
            return { w: r.width, h: r.height };
          }),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      }));
      check("390: one row per open tab in the drawer list",
        phone.rows.map((r) => r.path).join(",") === "Welcome.md,Second.md",
        JSON.stringify(phone.rows));
      check("390: every row reaches the 44 px floor",
        phone.rows.length === 2 && phone.rows.every((r) => r.h >= 44),
        JSON.stringify(phone.rows));
      check("390: every close button reaches 44 x 44",
        phone.closes.length === 2 &&
        phone.closes.every((c) => c.w >= 44 && c.h >= 44),
        JSON.stringify(phone.closes));
      check("390: the view adds no horizontal overflow", phone.overflow <= 1,
        String(phone.overflow));

      await page.locator('#tabs-view .tab-item-wrap[data-path="Second.md"] .tab-item')
        .tap();
      await page.waitForFunction(
        () => window.NB.tabs.getActive() === "Second.md", null, { timeout: 8000 });
      await page.waitForFunction(
        () => !document.body.classList.contains("drawer-open"), null, { timeout: 5000 });
      check("390: a row tap opens the note",
        await page.evaluate(() => window.NB.tabs.getActive() === "Second.md"));
      check("390: a row tap closes the drawer",
        await page.evaluate(() => !document.body.classList.contains("drawer-open")));
      check("390: the note shows behind the closed drawer",
        await page.evaluate(() => /Another root note/.test(
          document.getElementById("viewer-content").textContent)));
      check("390: no uncaught page errors", pageErrors.length === 0,
        pageErrors.join(" | "));

      await page.screenshot({ path: path.join(tmp, "tabs-view-390.png") });
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
