/* Real-browser test for the phone shell (docs/architecture/mobile.md §10).
 *
 * jsdom cannot see the CSS media query, the grid collapse, fixed-position
 * layers, or a real touch viewport. This harness boots the REAL app on a
 * temp notebook and checks:
 *   - 1280x800 desktop regression: four columns, tab strip visible;
 *   - 390x844 portrait and 932x430 landscape phones: the CSS token picks
 *     the phone shell, the reader is non-zero, nothing overflows sideways,
 *     the drawer lifecycle works, and controls meet the 44 px target;
 *   - a phone note open, header menu, capture append, and browser back.
 *
 * Run:  node tests/browser/test_mobile_browser.js
 * Env:  CHROMIUM_PATH  override the browser binary (NixOS needs this).
 *       PORT           server port (default 5099)
 *
 * Chromium only: the phone contexts use Playwright's isMobile option,
 * which Firefox does not support.
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
const PORT = Number(process.env.PORT || 5099);
const BASE = "http://127.0.0.1:" + PORT;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nb-mobile-"));
const DATA = path.join(tmp, "notebook");
const CONFIG = path.join(tmp, "config");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(CONFIG, { recursive: true });
fs.writeFileSync(path.join(CONFIG, "config.json"), "{}");

const NOTES = {
  "Welcome.md": "# Welcome\n\nPhone reader smoke test.\n",
  "Second.md": "# Second\n\nAnother root note.\n",
  "notes/a.md": "# File A\n\nTODO fix this bug.\n",
  "notes/b.md": "# File B\n\nAnother TODO fix this here.\n",
  "Long.md": "# Long\n\n" + Array.from({ length: 200 }, (_, i) =>
    "Paragraph " + (i + 1) + " with enough text to scroll the phone reader past the resume offset.").join("\n\n") + "\n",
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

// Each phone size is a separate device on one server. Reset the workspace's
// shared session state so a run does not inherit the previous size's tabs.
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

async function serverState() {
  const res = await fetch(BASE + "/api/workspace-state?id=default");
  const body = await res.json();
  return body.state || {};
}

async function waitForServerState(pred, ms) {
  const deadline = Date.now() + (ms || 10000);
  while (Date.now() < deadline) {
    if (pred(await serverState())) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function bootApp(page) {
  await page.waitForFunction(
    () => window.NB && window.NB.mobile && window.NB.tabs, null, { timeout: 20000 });
  await page.waitForSelector("#viewer-content", { state: "attached", timeout: 10000 });
}

async function modeOf(page) {
  return page.evaluate(() => ({
    token: getComputedStyle(document.documentElement)
      .getPropertyValue("--ui-mode").trim(),
    dataset: document.documentElement.dataset.uiMode,
    isOn: !!(window.NB.mobile && window.NB.mobile.isOn()),
  }));
}

async function openDrawer(page) {
  const open = await page.evaluate(
    () => document.body.classList.contains("drawer-open"));
  if (!open) await page.click("#mobile-title");
  await page.waitForFunction(
    () => document.body.classList.contains("drawer-open"), null, { timeout: 5000 });
  // Let the 220ms slide finish so geometry assertions see the open state.
  await page.waitForTimeout(300);
  await page.waitForFunction(() => {
    const r = document.getElementById("side-panel").getBoundingClientRect();
    return r.left >= -1 && r.right > 0;
  }, null, { timeout: 5000 });
}

async function closeDrawerByScrim(page) {
  const vp = page.viewportSize();
  await page.mouse.click(Math.max(10, vp.width - 20), Math.max(10, vp.height / 2));
  await page.waitForFunction(
    () => !document.body.classList.contains("drawer-open"), null, { timeout: 5000 });
}

async function openFileFromDrawer(page, file) {
  await openDrawer(page);
  await page.locator('#file-tree .tree-row[data-path="' + file + '"]').click();
  await page.waitForFunction(
    (f) => window.NB.tabs.getActive() === f, file, { timeout: 8000 });
  await page.waitForFunction(
    () => !document.body.classList.contains("drawer-open"), null, { timeout: 5000 });
}

// The drawer keeps whichever view was active last: a session switch leaves
// Sessions in it, so reopen through the Explorer rail slot before touching
// the tree. Only used with the drawer closed (the icon then opens it).
async function openExplorerInDrawer(page) {
  await page.click('#activity-bar .activity-btn[data-view="explorer"]');
  await page.waitForFunction(
    () => document.body.classList.contains("drawer-open"), null, { timeout: 5000 });
  await page.waitForTimeout(300);
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

    // --- 1280x800 desktop regression (spec C4) ---------------------
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
        () => /Phone reader smoke test/.test(
          document.getElementById("viewer-content").textContent),
        null, { timeout: 10000 });

      const m = await modeOf(page);
      check("desktop 1280: mode token is desktop", m.token === "desktop", m.token);
      check("desktop 1280: data-ui-mode is desktop", m.dataset === "desktop", m.dataset);
      check("desktop 1280: mobile.isOn() is false", m.isOn === false);

      const d = await page.evaluate(() => {
        const cs = (id) => getComputedStyle(document.getElementById(id));
        const rect = (id) => document.getElementById(id).getBoundingClientRect();
        const cols = cs("layout").gridTemplateColumns.split(/\s+/).filter(Boolean);
        return {
          display: cs("layout").display,
          colCount: cols.length,
          tabDisplay: cs("tab-bar").display,
          tabHeight: rect("tab-bar").height,
          activityW: rect("activity-bar").width,
          panelW: rect("side-panel").width,
          viewerW: rect("viewer").width,
          auxW: rect("aux-panel").width,
          rightRailW: rect("activity-bar-right").width,
          activityLeft: rect("activity-bar").left,
          panelLeft: rect("side-panel").left,
          editorLeft: rect("editor-pane").left,
          auxLeft: rect("aux-panel").left,
          rightRailLeft: rect("activity-bar-right").left,
          mobileTitle: cs("mobile-title").display,
          sessionBar: cs("session-bar").display,
          sessionBtnW: rect("session-switch").width,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      check("desktop 1280: #layout is a grid with five columns",
        d.display === "grid" && d.colCount === 5,
        "display=" + d.display + " cols=" + d.colCount);
      check("desktop 1280: every desktop column has width",
        d.activityW > 0 && d.panelW > 0 && d.viewerW > 0 &&
        d.auxW > 0 && d.rightRailW > 0,
        JSON.stringify([d.activityW, d.panelW, d.viewerW, d.auxW, d.rightRailW]));
      check("desktop 1280: columns stay in the five-track order",
        d.activityLeft < d.panelLeft && d.panelLeft < d.editorLeft &&
        d.editorLeft < d.auxLeft && d.auxLeft < d.rightRailLeft,
        JSON.stringify([d.activityLeft, d.panelLeft, d.editorLeft,
          d.auxLeft, d.rightRailLeft]));
      check("desktop 1280: the tab strip is visible",
        d.tabDisplay !== "none" && d.tabHeight > 0,
        "display=" + d.tabDisplay + " height=" + d.tabHeight);
      check("desktop 1280: mobile chrome is hidden",
        d.mobileTitle === "none", d.mobileTitle);
      const desktopRail = await page.evaluate(() => ({
        views: Array.from(
          document.querySelectorAll("#activity-bar .activity-btn[data-view]"))
          .map((b) => b.dataset.view),
        rightViews: Array.from(
          document.querySelectorAll("#activity-bar-right .activity-btn[data-view]"))
          .map((b) => b.dataset.view),
        more: getComputedStyle(document.getElementById("activity-more-btn")).display,
        railViews: window.NB.activity.railViews().length,
        rightRailViews: window.NB.activity.railViews("right").length,
        offRail: window.NB.activity.offRailViews().length,
      }));
      check("desktop 1280: the left rail carries the left-homed views and no More button",
        desktopRail.views.join(",") ===
          "explorer,sessions,pinned,bookmarks,recent,search,ai,tabs" &&
        desktopRail.more === "none",
        desktopRail.views.join(",") + " more=" + desktopRail.more);
      check("desktop 1280: the right rail carries the Outline only",
        desktopRail.rightViews.join(",") === "outline",
        desktopRail.rightViews.join(","));
      check("desktop 1280: the rail is not sliced",
        desktopRail.railViews === 8 && desktopRail.rightRailViews === 1 &&
        desktopRail.offRail === 0,
        "rail=" + desktopRail.railViews + " right=" + desktopRail.rightRailViews +
        " off=" + desktopRail.offRail);
      check("desktop 1280: the edit controls are available for a writable note",
        await page.evaluate(() =>
          getComputedStyle(document.getElementById("hybrid-toggle")).display !== "none" &&
          getComputedStyle(document.getElementById("edit-toggle")).display !== "none"));
      check("desktop 1280: the top-bar session picker is visible",
        d.sessionBar !== "none" && d.sessionBtnW > 0,
        "display=" + d.sessionBar + " w=" + d.sessionBtnW);
      check("desktop 1280: no horizontal overflow", d.overflow <= 1, String(d.overflow));
      check("desktop 1280: no uncaught page errors", pageErrors.length === 0,
        pageErrors.join(" | "));

      await page.screenshot({ path: path.join(tmp, "desktop-1280.png") });
      await ctx.close();
    }

    // --- Phone portrait and landscape ------------------------------
    const phoneSizes = [
      { name: "390x844", width: 390, height: 844 },
      { name: "932x430", width: 932, height: 430 },
    ];
    for (const size of phoneSizes) {
      await resetWorkspaceState();
      const ctx = await browser.newContext({
        viewport: { width: size.width, height: size.height },
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

      const m = await modeOf(page);
      check(size.name + ": the CSS token picks the phone shell",
        m.token === "phone", "token=" + m.token);
      check(size.name + ": data-ui-mode mirrors phone",
        m.dataset === "phone", m.dataset);
      check(size.name + ": mobile.isOn() is true", m.isOn === true);

      const layout = await page.evaluate(() => {
        const cs = (id) => getComputedStyle(document.getElementById(id));
        const rect = (id) => document.getElementById(id).getBoundingClientRect();
        const viewer = rect("viewer");
        const vc = rect("viewer-content");
        const rail = rect("activity-bar");
        const targets = ["back-btn", "mobile-title", "mobile-capture", "mobile-more"]
          .map((id) => {
            const r = rect(id);
            return { id, w: r.width, h: r.height, display: cs(id).display };
          });
        const railButtons = Array.from(
          document.querySelectorAll("#activity-bar .activity-btn[data-view]"))
          .filter((b) => getComputedStyle(b).display !== "none")
          .map((b) => {
            const r = b.getBoundingClientRect();
            return { view: b.dataset.view, w: r.width, h: r.height };
          });
        const moreBtn = document.getElementById("activity-more-btn");
        const moreRect = moreBtn.getBoundingClientRect();
        return {
          editorW: rect("editor-pane").width,
          viewerW: viewer.width,
          readerW: vc.width,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          bodyOverflow: document.body.scrollWidth - window.innerWidth,
          tabDisplay: cs("tab-bar").display,
          auxDisplay: cs("aux-panel").display,
          rightRailDisplay: cs("activity-bar-right").display,
          sessionDisplay: cs("session-bar").display,
          sessionBtnW: rect("session-switch").width,
          railPosition: cs("activity-bar").position,
          railBottom: rail.bottom,
          viewportH: window.innerHeight,
          bodyPad: getComputedStyle(document.body).padding,
          appTop: rect("app").top,
          appBottom: rect("app").bottom,
          homeRows: document.querySelectorAll("#mobile-home .mobile-home-row").length,
          homeHidden: document.getElementById("mobile-home").hidden,
          homeGlyphs: Array.from(
            document.querySelectorAll("#mobile-home .mobile-home-row"))
            .map((row) => {
              const label = row.querySelector(".mhr-label");
              const use = row.querySelector(".mhr-icon use");
              return [label ? label.textContent : "",
                use ? use.getAttribute("href") : ""];
            }),
          treeRowH: (() => {
            const el = document.querySelector("#file-tree .tree-row");
            return el ? el.getBoundingClientRect().height : 0;
          })(),
          treeMore: (() => {
            const el = document.querySelector("#file-tree .tree-more");
            if (!el) return { w: 0, h: 0 };
            const r = el.getBoundingClientRect();
            return { w: r.width, h: r.height };
          })(),
          targets,
          railButtons,
          moreBtn: {
            display: cs("activity-more-btn").display,
            w: moreRect.width, h: moreRect.height,
            expanded: moreBtn.getAttribute("aria-expanded"),
          },
        };
      });
      check(size.name + ": the editor area fills at least one column",
        layout.editorW > 0, "editor=" + layout.editorW);
      check(size.name + ": the phone shell has no session picker",
        layout.sessionDisplay === "none" && layout.sessionBtnW === 0,
        "display=" + layout.sessionDisplay + " w=" + layout.sessionBtnW);
      check(size.name + ": the page has no horizontal overflow",
        layout.overflow <= 1 && layout.bodyOverflow <= 1,
        "doc=" + layout.overflow + " body=" + layout.bodyOverflow);
      check(size.name + ": tab strip, right panel and right rail are hidden",
        layout.tabDisplay === "none" && layout.auxDisplay === "none" &&
        layout.rightRailDisplay === "none",
        "tabs=" + layout.tabDisplay + " aux=" + layout.auxDisplay +
        " rail=" + layout.rightRailDisplay);
      check(size.name + ": the activity bar is fixed to the bottom",
        layout.railPosition === "fixed" &&
        Math.abs(layout.railBottom - layout.viewportH) <= 1,
        "position=" + layout.railPosition + " bottom=" + layout.railBottom +
        " vh=" + layout.viewportH);
      check(size.name + ": the shell is edge-to-edge (body padding 0)",
        layout.bodyPad === "0px" &&
        Math.abs(layout.appTop) <= 1 &&
        Math.abs(layout.appBottom - layout.viewportH) <= 1,
        "pad=" + layout.bodyPad + " app=" + layout.appTop + ".." + layout.appBottom +
        " vh=" + layout.viewportH);
      check(size.name + ": top-bar controls meet the 44 px target",
        layout.targets.every((t) =>
          t.display !== "none" && t.w >= 44 && t.h >= 44),
        JSON.stringify(layout.targets));
      check(size.name + ": every rail button meets the 44 px target",
        layout.railButtons.length > 0 &&
        layout.railButtons.every((b) => b.w >= 44 && b.h >= 44),
        JSON.stringify(layout.railButtons));
      check(size.name + ": the rail is six views plus More, in bar order",
        layout.railButtons.map((b) => b.view).join(",") ===
          "explorer,sessions,pinned,bookmarks,recent,search" &&
        layout.moreBtn.display === "flex" && layout.moreBtn.expanded === "false",
        layout.railButtons.map((b) => b.view).join(",") +
          " more=" + layout.moreBtn.display);
      check(size.name + ": seven rail slots, each 44 px or wider",
        layout.railButtons.length + 1 === 7 &&
        layout.moreBtn.w >= 44 && layout.moreBtn.h >= 44,
        JSON.stringify(layout.railButtons.map((b) => Math.round(b.w))));
      check(size.name + ": the rail adds no horizontal overflow",
        layout.overflow <= 1, String(layout.overflow));
      // The static five in order; the optional Continue row sits between
      // Search and Bookmarks, so match by label instead of position.
      const homeGlyphMap = new Map(layout.homeGlyphs);
      check(size.name + ": Home rows carry the desktop sprite glyphs",
        homeGlyphMap.get("Search") === "#nb-icon-search" &&
        homeGlyphMap.get("Bookmarks") === "#nb-icon-bookmark" &&
        homeGlyphMap.get("Recent") === "#nb-icon-clock" &&
        homeGlyphMap.get("Browse") === "#nb-icon-explorer" &&
        homeGlyphMap.get("Settings") === "#nb-icon-settings" &&
        layout.homeGlyphs.every(([label, href]) =>
          !!label && /^#nb-icon-/.test(href)),
        JSON.stringify(layout.homeGlyphs));
      check(size.name + ": Home is the landing view with all five rows",
        !layout.homeHidden && layout.homeRows >= 5,
        "hidden=" + layout.homeHidden + " rows=" + layout.homeRows);

      // Drawer lifecycle: title opens, scrim closes, rail reopens.
      await openDrawer(page);
      const drawer = await page.evaluate(() => {
        const panel = document.getElementById("side-panel");
        const r = panel.getBoundingClientRect();
        return {
          visibility: getComputedStyle(panel).visibility,
          left: r.left, right: r.right, width: r.width,
          scrim: !document.getElementById("mobile-scrim").hidden,
          viewportW: window.innerWidth,
        };
      });
      check(size.name + ": the drawer slides into the viewport",
        drawer.visibility === "visible" && drawer.left >= -1 &&
        drawer.right > 0 && drawer.width > 0 &&
        drawer.width <= drawer.viewportW,
        JSON.stringify(drawer));
      check(size.name + ": the drawer scrim is visible", drawer.scrim === true);
      check(size.name + ": drawer rows and their … button meet the 44 px target",
        layout.treeRowH >= 44 && layout.treeMore.w >= 44 &&
        layout.treeMore.h >= 44,
        "row=" + layout.treeRowH + " more=" + JSON.stringify(layout.treeMore));
      await closeDrawerByScrim(page);
      check(size.name + ": a scrim tap closes the drawer",
        !(await page.evaluate(() => document.body.classList.contains("drawer-open"))));

      // Search drawer: the clear × is a full 44 px target and refocuses.
      await page.click('#activity-bar .activity-btn[data-view="search"]');
      await page.waitForFunction(
        () => document.body.classList.contains("drawer-open"), null, { timeout: 5000 });
      await page.waitForTimeout(300);
      await page.waitForSelector(".search-panel-input", { state: "visible" });
      await page.click(".search-panel-advanced-toggle");
      const phoneCase = await page.evaluate(() => {
        const row = document.querySelector(".search-panel-filter--case");
        const box = row.querySelector(".search-panel-case");
        return {
          inAdvanced: !!row.closest("#search-panel-advanced"),
          label: row.querySelector(".search-panel-filter-label").textContent.trim(),
          w: getComputedStyle(box).width,
          h: getComputedStyle(box).height,
        };
      });
      check(size.name + ": Match case sits in Advanced at 44 px",
        phoneCase.inAdvanced && phoneCase.label === "Match case" &&
        phoneCase.w === "44px" && phoneCase.h === "44px",
        JSON.stringify(phoneCase));
      await page.click(".search-panel-advanced-toggle");
      await page.fill(".search-panel-input", "TODO");
      const clearPhone = await page.evaluate(() => {
        const btn = document.querySelector(".search-panel-clear");
        const input = document.querySelector(".search-panel-input");
        return {
          hidden: btn.hidden,
          w: getComputedStyle(btn).width,
          h: getComputedStyle(btn).height,
          padRight: getComputedStyle(input).paddingRight,
        };
      });
      check(size.name + ": phone search clear is a 44 px target",
        clearPhone.hidden === false &&
        clearPhone.w === "44px" && clearPhone.h === "44px",
        JSON.stringify(clearPhone));
      check(size.name + ": phone search input reserves a 48 px slot",
        clearPhone.padRight === "48px", clearPhone.padRight);
      await page.click(".search-panel-clear");
      await page.waitForFunction(() =>
        document.querySelector(".search-panel-input").value === "");
      check(size.name + ": phone search clear empties and refocuses",
        await page.evaluate(() => document.activeElement ===
          document.querySelector(".search-panel-input")));
      await page.evaluate(() => NB.mobile.closeDrawer());
      await page.waitForFunction(
        () => !document.body.classList.contains("drawer-open"), null, { timeout: 5000 });
      await page.evaluate(() => NB.activity.activate("explorer", false));

      // Browser back closes a drawer without leaving the note.
      await openDrawer(page);
      await openFileFromDrawer(page, "Welcome.md");
      check(size.name + ": choosing a file opens it and closes the drawer",
        await page.evaluate(() => window.NB.tabs.getActive() === "Welcome.md" &&
          !document.body.classList.contains("drawer-open")));
      check(size.name + ": the opened note renders in the reader",
        await page.evaluate(() => /Phone reader smoke test/.test(
          document.getElementById("viewer-content").textContent)));
      const reader = await page.evaluate(() => {
        const rect = (id) => document.getElementById(id).getBoundingClientRect();
        return {
          viewerW: rect("viewer").width,
          readerW: rect("viewer-content").width,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      check(size.name + ": the reading column is wider than 0",
        reader.viewerW > 0 && reader.readerW > 0,
        "viewer=" + reader.viewerW + " reader=" + reader.readerW);
      check(size.name + ": the reading page still has no horizontal overflow",
        reader.overflow <= 1, String(reader.overflow));
      check(size.name + ": the title shows the note basename",
        (await page.textContent("#mobile-title")).trim() === "Welcome.md");
      check(size.name + ": the address bar carries ?file=",
        (await page.evaluate(() => window.location.search)).indexOf("file=") !== -1,
        await page.evaluate(() => window.location.search));

      await openDrawer(page);
      await page.goBack();
      await page.waitForFunction(
        () => !document.body.classList.contains("drawer-open"), null, { timeout: 5000 });
      check(size.name + ": browser back closes the drawer first",
        await page.evaluate(() => window.NB.tabs.getActive() === "Welcome.md"));

      // --- Sessions in the drawer -----------------------------------
      await page.click('#activity-bar .activity-btn[data-view="sessions"]');
      await page.waitForFunction(
        () => document.body.classList.contains("drawer-open"), null, { timeout: 5000 });
      await page.waitForTimeout(300);
      const sessGeom = await page.evaluate(() => {
        const view = document.getElementById("sessions-view");
        const box = (el) => {
          const r = el.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height) };
        };
        const list = view.querySelector(".sessions-list");
        return {
          visible: !view.hidden && view.getBoundingClientRect().width > 0,
          row: box(view.querySelector(".session-row")),
          add: box(view.querySelector(".session-add")),
          more: box(view.querySelector(".session-more")),
          close: box(view.querySelector(".panel-header .collapse-btn:last-child")),
          listPad: getComputedStyle(list).padding,
        };
      });
      check(size.name + ": Sessions opens in the drawer",
        sessGeom.visible === true);
      check(size.name + ": session row, +, … and close meet the 44 px target",
        [sessGeom.row, sessGeom.add, sessGeom.more, sessGeom.close]
          .every((b) => b.w >= 44 && b.h >= 44),
        JSON.stringify(sessGeom));
      check(size.name + ": the phone session list pads 8 px",
        sessGeom.listPad === "8px 8px 12px", sessGeom.listPad);

      // A second session, created from the drawer's +.
      await page.click("#sessions-view .session-add");
      await page.waitForFunction(
        () => !document.getElementById("session-dialog").hidden, null, { timeout: 5000 });
      await page.fill("#session-name", "Second");
      await page.click("#session-submit");
      await page.waitForFunction(
        () => document.querySelectorAll("#sessions-view .session-row").length === 2,
        null, { timeout: 8000 });
      check(size.name + ": + creates a session and switches to it",
        await page.evaluate(() =>
          window.NB.tabs.getActiveSessionId() !== "main" &&
          document.getElementById("session-dialog").hidden),
        await page.evaluate(() => window.NB.tabs.getActiveSessionId()));

      // Same note: reopen Welcome in the new session, then tap Main.
      await page.evaluate(() => window.NB.mobile.closeDrawer());
      await page.waitForFunction(
        () => !document.body.classList.contains("drawer-open"), null, { timeout: 5000 });
      await openExplorerInDrawer(page);
      await openFileFromDrawer(page, "Welcome.md");
      await page.click('#activity-bar .activity-btn[data-view="sessions"]');
      await page.waitForFunction(
        () => document.body.classList.contains("drawer-open"), null, { timeout: 5000 });
      await page.waitForTimeout(300);
      await page.click(
        '#sessions-view .session-row-wrap[data-session-id="main"] .session-row');
      await page.waitForFunction(
        () => !document.body.classList.contains("drawer-open"), null, { timeout: 5000 });
      check(size.name + ": tapping the session that holds the open note closes the drawer",
        await page.evaluate(() => window.NB.tabs.getActiveSessionId() === "main" &&
          window.NB.tabs.getActive() === "Welcome.md"),
        await page.evaluate(() => window.NB.tabs.getActiveSessionId() + " " +
          window.NB.tabs.getActive()));

      // Different note: open Second.md in Main, then tap the session that
      // holds Welcome.md instead.
      await openExplorerInDrawer(page);
      await openFileFromDrawer(page, "Second.md");
      await page.click('#activity-bar .activity-btn[data-view="sessions"]');
      await page.waitForFunction(
        () => document.body.classList.contains("drawer-open"), null, { timeout: 5000 });
      await page.waitForTimeout(300);
      await page.click(
        '#sessions-view .session-row-wrap:not([data-session-id="main"]) .session-row');
      await page.waitForFunction(
        () => !document.body.classList.contains("drawer-open"), null, { timeout: 5000 });
      check(size.name + ": tapping another session switches the note and closes the drawer",
        await page.evaluate(() => window.NB.tabs.getActiveSessionId() !== "main" &&
          window.NB.tabs.getActive() === "Welcome.md"),
        await page.evaluate(() => window.NB.tabs.getActiveSessionId() + " " +
          window.NB.tabs.getActive()));

      // Empty session: create one, return to a session that holds a note,
      // then tap the empty row from the drawer.
      await page.evaluate(async () => {
        await window.NB.tabs.createSession("Idle");
        window.NB.mobile.closeDrawer();
        await window.NB.tabs.swapTo("main");
      });
      await page.waitForFunction(
        () => window.NB.tabs.getActive() === "Second.md", null, { timeout: 8000 });
      await page.click('#activity-bar .activity-btn[data-view="sessions"]');
      await page.waitForFunction(
        () => document.body.classList.contains("drawer-open"), null, { timeout: 5000 });
      await page.waitForTimeout(300);
      const idleId = await page.evaluate(() => {
        const wrap = Array.from(
          document.querySelectorAll("#sessions-view .session-row-wrap"))
          .find((w) => w.querySelector(".session-name").textContent === "Idle");
        return wrap ? wrap.dataset.sessionId : null;
      });
      await page.click(
        '#sessions-view .session-row-wrap[data-session-id="' + idleId + '"] .session-row');
      await page.waitForFunction(
        () => !document.body.classList.contains("drawer-open"), null, { timeout: 5000 });
      check(size.name + ": tapping an empty session closes the drawer",
        await page.evaluate((id) => window.NB.tabs.getActiveSessionId() === id &&
          window.NB.tabs.getActive() === null &&
          window.location.search === "", idleId),
        await page.evaluate((id) => window.NB.tabs.getActiveSessionId() + " " +
          window.NB.tabs.getActive() + " " + window.location.search, idleId));

      // Back with the create dialog open closes the dialog, not the drawer.
      await page.click('#activity-bar .activity-btn[data-view="sessions"]');
      await page.waitForFunction(
        () => document.body.classList.contains("drawer-open"), null, { timeout: 5000 });
      await page.waitForTimeout(300);
      await page.click("#sessions-view .session-add");
      await page.waitForFunction(
        () => !document.getElementById("session-dialog").hidden, null, { timeout: 5000 });
      await page.goBack();
      await page.waitForFunction(
        () => document.getElementById("session-dialog").hidden, null, { timeout: 5000 });
      check(size.name + ": back closes the session dialog and keeps the drawer open",
        await page.evaluate(() =>
          document.getElementById("session-dialog").hidden &&
          window.NB.dialog.isOpen() === false &&
          document.body.classList.contains("drawer-open")));
      await page.evaluate(() => window.NB.mobile.closeDrawer());
      await page.waitForFunction(
        () => !document.body.classList.contains("drawer-open"), null, { timeout: 5000 });

      // --- More: the sheet, a view row and back ---------------------
      await openExplorerInDrawer(page);
      await openFileFromDrawer(page, "Welcome.md");
      await page.evaluate(() => window.NB.activity.register(
        { id: "demo", icon: "nb-icon-file", label: "Demo" }));
      await page.click("#activity-more-btn");
      await page.waitForFunction(
        () => !document.getElementById("mobile-views-sheet").hidden, null, { timeout: 5000 });
      await page.waitForTimeout(300);
      const sheet = await page.evaluate(() => {
        const host = document.getElementById("mobile-views-sheet");
        const row = host.querySelector(".mobile-more-row");
        return {
          open: !host.hidden && getComputedStyle(host).visibility === "visible",
          expanded: document.getElementById("activity-more-btn").getAttribute("aria-expanded"),
          title: host.querySelector("h2").textContent,
          role: host.getAttribute("role"),
          modal: host.getAttribute("aria-modal"),
          groups: Array.from(host.querySelectorAll(".mobile-more-group"))
            .map((el) => el.textContent),
          rows: Array.from(host.querySelectorAll(".mobile-more-label"))
            .map((el) => el.textContent),
          rowH: Math.round(row.getBoundingClientRect().height),
          danger: !!host.querySelector(".mobile-more-row.is-danger"),
          authEnabled: !!(window.NB.auth.status() || {}).enabled,
          scrim: !document.getElementById("mobile-scrim").hidden,
        };
      });
      check(size.name + ": More opens the sheet as a modal dialog",
        sheet.open && sheet.role === "dialog" && sheet.modal === "true" &&
        sheet.title === "More" && sheet.scrim === true,
        JSON.stringify({ open: sheet.open, role: sheet.role, title: sheet.title }));
      check(size.name + ": More advertises aria-expanded",
        sheet.expanded === "true", sheet.expanded);
      check(size.name + ": the sheet lists Views (the overflow) then App (Settings)",
        sheet.groups.join("|") === "Views|App" &&
        sheet.rows.join("|") === "Tabs|Demo|Settings",
        sheet.groups.join(",") + " / " + sheet.rows.join(","));
      check(size.name + ": the sheet rows are 52 px",
        sheet.rowH >= 52, String(sheet.rowH));
      check(size.name + ": no Sign out row without auth",
        sheet.danger === false && sheet.authEnabled === false,
        "danger=" + sheet.danger + " auth=" + sheet.authEnabled);
      await page.screenshot({ path: path.join(tmp, "phone-more-" + size.name + ".png") });

      await page.locator("#mobile-views-sheet .mobile-more-row").first().click();
      await page.waitForFunction(
        () => document.body.classList.contains("drawer-open"), null, { timeout: 5000 });
      check(size.name + ": a More view row opens the drawer and hides the sheet",
        await page.evaluate(() =>
          document.getElementById("mobile-views-sheet").hidden &&
          document.body.dataset.drawerView === "tabs" &&
          document.getElementById("activity-more-btn").getAttribute("aria-expanded") === "false"));
      await page.goBack();
      await page.waitForFunction(
        () => !document.body.classList.contains("drawer-open"), null, { timeout: 5000 });
      check(size.name + ": back from a view row returns to the note",
        await page.evaluate(() => window.NB.tabs.getActive() === "Welcome.md" &&
          window.location.search.indexOf("file=Welcome.md") !== -1),
        await page.evaluate(() => window.NB.tabs.getActive() + " " + window.location.search));

      // Note-header … menu opens without navigating.
      const urlBefore = page.url();
      await page.click("#mobile-more");
      await page.waitForSelector("#nb-menu:not([hidden])", { timeout: 5000 });
      const menuItems = await page.locator("#nb-menu button").allTextContents();
      check(size.name + ": the note … menu is Edit note / Reload / Copy link / Show in Browse",
        menuItems.join("|") === "Edit note|Reload|Copy link|Show in Browse",
        menuItems.join(","));
      check(size.name + ": opening … does not navigate",
        page.url() === urlBefore);
      const menuGeom = await page.locator("#nb-menu button").first()
        .evaluate((b) => {
          const r = b.getBoundingClientRect();
          return { w: r.width, h: r.height };
        });
      check(size.name + ": menu items meet the 44 px target",
        menuGeom.w >= 44 && menuGeom.h >= 44, JSON.stringify(menuGeom));
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () => document.getElementById("nb-menu").hidden, null, { timeout: 5000 });

      // --- WYSIWYG editing from the note menu -----------------------
      check(size.name + ": the top bar has no edit control",
        await page.evaluate(() =>
          getComputedStyle(document.getElementById("hybrid-toggle")).display === "none" &&
          getComputedStyle(document.getElementById("edit-toggle")).display === "none"));
      await page.click("#mobile-more");
      await page.waitForSelector("#nb-menu:not([hidden])", { timeout: 5000 });
      await page.locator("#nb-menu button").first().click();
      await page.waitForFunction(
        () => document.getElementById("viewer-content")
          .getAttribute("contenteditable") === "true", null, { timeout: 5000 });
      const editUi = await page.evaluate(() => {
        const bar = document.getElementById("edit-bar");
        const btns = Array.from(bar.querySelectorAll(".eb"))
          .filter((b) => b.offsetParent !== null)
          .map((b) => b.getBoundingClientRect());
        return {
          barVisible: !bar.hidden && bar.getBoundingClientRect().height > 0,
          saveVisible: !document.getElementById("save-btn").hidden,
          btnMinW: btns.length ? Math.min(...btns.map((r) => r.width)) : 0,
          btnMinH: btns.length ? Math.min(...btns.map((r) => r.height)) : 0,
          editOpen: document.body.classList.contains("edit-open"),
          overflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      check(size.name + ": editing shows the formatting bar",
        editUi.barVisible && editUi.editOpen);
      check(size.name + ": toolbar buttons meet the 44 px touch target",
        editUi.btnMinW >= 44 && editUi.btnMinH >= 44,
        editUi.btnMinW + "x" + editUi.btnMinH);
      check(size.name + ": Save is visible in the phone toolbar",
        editUi.saveVisible);
      check(size.name + ": editing adds no horizontal page overflow",
        editUi.overflow <= 1, String(editUi.overflow));

      // A toolbar tap formats the user's selection and keeps the editor
      // focused (the touch keyboard must stay up).
      await page.evaluate(() => {
        const vc = document.getElementById("viewer-content");
        const p = vc.querySelector("p");
        const range = document.createRange();
        range.selectNodeContents(p);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        vc.focus();
      });
      // The note may already be bold from the previous viewport run, so
      // assert the state flips rather than that bold is now on.
      const boldBefore = await page.evaluate(() =>
        !!document.querySelector("#viewer-content b, #viewer-content strong"));
      await page.tap('#edit-bar .eb[data-act="bold"]');
      await page.waitForFunction(
        (was) => (!!document.querySelector("#viewer-content b, #viewer-content strong")) !== was,
        boldBefore, { timeout: 5000 });
      check(size.name + ": a toolbar tap formats the selection",
        await page.evaluate((was) =>
          (!!document.querySelector("#viewer-content b, #viewer-content strong")) !== was,
        boldBefore));
      check(size.name + ": a toolbar tap keeps the editor focused",
        await page.evaluate(() =>
          document.activeElement === document.getElementById("viewer-content")));

      // Type at the end of the note and save through the API.
      await page.evaluate(() => {
        const vc = document.getElementById("viewer-content");
        const last = vc.querySelector("p:last-of-type") || vc.lastElementChild;
        const range = document.createRange();
        range.selectNodeContents(last);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        vc.focus();
      });
      await page.keyboard.type(" Edited on phone.");
      await page.evaluate(() => window.NB.hybrid.save());
      await page.waitForFunction(() => !window.NB.hybrid.isDirty(), null,
        { timeout: 5000 });
      const diskAfterEdit = fs.readFileSync(path.join(DATA, "Welcome.md"), "utf8");
      check(size.name + ": typed text reaches the file",
        /Edited on phone\./.test(diskAfterEdit), diskAfterEdit.slice(0, 120));

      // Back leaves edit mode and stays on the note.
      await page.goBack();
      await page.waitForFunction(
        () => !document.body.classList.contains("edit-open"), null, { timeout: 5000 });
      check(size.name + ": back leaves edit mode and stays on the note",
        await page.evaluate(() =>
          document.getElementById("viewer-content")
            .getAttribute("contenteditable") === null &&
          window.NB.tabs.getActive() === "Welcome.md"));

      check(size.name + ": no uncaught page errors", pageErrors.length === 0,
        pageErrors.join(" | "));

      await page.screenshot({ path: path.join(tmp, "phone-" + size.name + ".png") });
      await ctx.close();
    }

    // --- Sharing: desktop sessions and tabs reach the phone ----------
    {
      await resetWorkspaceState();
      const dctx = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        serviceWorkers: "block",
      });
      const desktop = await dctx.newPage();
      await desktop.goto(BASE + "/");
      await bootApp(desktop);
      await desktop.evaluate(async () => {
        await window.NB.tabs.open("Welcome.md");
        await window.NB.tabs.createSession("Work");
        await window.NB.tabs.open("Second.md");
      });
      const desktopSession = await desktop.evaluate(() =>
        window.NB.tabs.getActiveSessionId());
      check("sharing: the desktop state reaches the server",
        await waitForServerState((s) =>
          (s.sessions || []).some((x) => x.name === "Work"), 10000));

      const mctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        serviceWorkers: "block",
      });
      const phone = await mctx.newPage();
      const phoneErrors = [];
      let phoneWsGets = 0;
      phone.on("request", (r) => {
        if (r.method() === "GET" && r.url().indexOf("/api/workspace-state") >= 0) {
          phoneWsGets++;
        }
      });
      phone.on("pageerror", (e) => phoneErrors.push(String(e)));
      await phone.goto(BASE + "/");
      await bootApp(phone);
      await phone.waitForFunction(
        () => window.NB.tabs.getSessionList().length === 2, null, { timeout: 8000 });
      const shared = await phone.evaluate(() => ({
        list: window.NB.tabs.getSessionList().map((s) => s.name + ":" + s.count),
        activeSession: window.NB.tabs.getActiveSessionId(),
        active: window.NB.tabs.getActive(),
        homeHidden: document.getElementById("mobile-home").hidden,
      }));
      check("sharing: the phone lists the desktop's sessions",
        shared.list.join(",") === "Main:1,Work:1", shared.list.join(","));
      check("sharing: the phone opens the shared session's active tab",
        shared.activeSession === desktopSession && shared.active === "Second.md" &&
        shared.homeHidden === true,
        JSON.stringify(shared));
      check("sharing: the phone still starts no poll",
        await phone.evaluate(() => window.NB.sync.status().running === false));

      // A phone open is shared back: it lands in the active session's list
      // and the next phone boot restores the phone's own last note.
      await phone.evaluate(() => window.NB.tabs.open("Welcome.md"));
      check("sharing: a phone tab open is written to the workspace",
        await waitForServerState((s) => {
          const work = (s.sessions || []).find((x) => x.id === desktopSession);
          return !!work && (work.openFiles || []).indexOf("Welcome.md") >= 0;
        }, 10000));
      await phone.reload();
      await bootApp(phone);
      await phone.waitForFunction(
        () => window.NB.tabs.getActive() === "Welcome.md", null, { timeout: 8000 });
      const after = await phone.evaluate(() => ({
        session: window.NB.tabs.getActiveSessionId(),
        active: window.NB.tabs.getActive(),
      }));
      check("sharing: a phone reload restores the shared session and its note",
        after.session === desktopSession && after.active === "Welcome.md",
        JSON.stringify(after));

      // A phone kept alive in the background has no timer (AC73). Coming back
      // must pick up a peer's change in one conditional read.
      await desktop.evaluate(async () => {
        await window.NB.tabs.createSession("Later");
        await window.NB.tabs.open("notes/a.md");
      });
      check("sharing: a later desktop session reaches the server",
        await waitForServerState((s) =>
          (s.sessions || []).some((x) => x.name === "Later"), 10000));
      // The catch-up read is skipped while a local write is queued (the write's
      // response carries the merged state), so let the reload's write settle.
      await phone.waitForFunction(
        () => window.NB.sync.status().pending === false, null, { timeout: 8000 });
      const getsBeforeCatchUp = phoneWsGets;
      await phone.evaluate(() => {
        window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
      });
      await phone.waitForFunction(
        () => window.NB.tabs.getSessionList().some((s) => s.name === "Later"),
        null, { timeout: 8000 });
      const caught = await phone.evaluate(() => ({
        list: window.NB.tabs.getSessionList().map((s) => s.name + ":" + s.count),
        active: window.NB.tabs.getActive(),
        running: window.NB.sync.status().running,
      }));
      check("sharing: a resumed phone catches up without a reload",
        caught.list.join(",") === "Main:1,Work:2,Later:1" &&
        caught.active === "Welcome.md" && caught.running === false &&
        phoneWsGets - getsBeforeCatchUp === 1,
        JSON.stringify(caught) + " gets=" + (phoneWsGets - getsBeforeCatchUp));
      check("sharing: no uncaught page errors", phoneErrors.length === 0,
        phoneErrors.join(" | "));
      await phone.screenshot({ path: path.join(tmp, "phone-shared.png") });
      await mctx.close();
      await dctx.close();
    }

    // --- AC16/AC17: a right-homed view on the phone; no outline surface --
    // A view assigned to the right rail opens in the phone drawer; the right
    // rail and right panel have no phone surface; the Outline is absent from
    // the rail and the More sheet and activate("outline") is refused.
    {
      const setCfg = (body) => fetch(BASE + "/api/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      await setCfg({
        sidebarSide: { search: "right" },
        activeViewLeft: "explorer",
        activeViewRight: "search",
      });
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        serviceWorkers: "block",
      });
      const page = await ctx.newPage();
      const pageErrors = [];
      page.on("pageerror", (e) => pageErrors.push(String(e)));
      await page.goto(BASE + "/");
      await bootApp(page);
      check("AC16: the right-homed Search boots in #aux-panel on desktop",
        await page.evaluate(() =>
          !!document.querySelector('#aux-panel [data-view="search"]') &&
          !document.getElementById("search-view").hidden));
      // A live desktop -> phone flip: the mode switch re-lays the hosts.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() =>
        document.documentElement.dataset.uiMode === "phone" &&
        getComputedStyle(document.getElementById("aux-panel")).display === "none",
        null, { timeout: 8000 });
      const flip = await page.evaluate(() => {
        const hosts = Array.from(document.querySelectorAll(".side-panel-view"));
        return {
          outside: hosts.filter((h) => h.parentNode.id !== "side-panel")
            .map((h) => h.dataset.view),
          visible: hosts.filter((h) => !h.hidden).map((h) => h.dataset.view),
          rightRail: getComputedStyle(
            document.getElementById("activity-bar-right")).display,
          aux: getComputedStyle(document.getElementById("aux-panel")).display,
        };
      });
      check("AC16: a live desktop->phone flip leaves exactly one drawer host",
        flip.outside.length === 0 && flip.visible.length === 1,
        JSON.stringify(flip));
      check("AC16: the phone renders no right rail and no right panel",
        flip.rightRail === "none" && flip.aux === "none",
        "rail=" + flip.rightRail + " aux=" + flip.aux);
      // The right-homed Search opens in the drawer like any other view.
      const opened = await page.evaluate(() => {
        NB.mobile.openDrawer("search");
        return {
          drawer: document.body.classList.contains("drawer-open"),
          search: !document.getElementById("search-view").hidden,
          input: !!document.querySelector(
            '#side-panel #search-view .search-panel-input'),
        };
      });
      check("AC16: the right-homed view opens in the phone drawer",
        opened.drawer && opened.search && opened.input, JSON.stringify(opened));
      await page.evaluate(() => NB.mobile.closeDrawer());
      await page.waitForFunction(
        () => !document.body.classList.contains("drawer-open"), null, { timeout: 5000 });
      // AC17: no Outline slot in the rail, nor a row in the More sheet.
      const phoneOutline = await page.evaluate(() => {
        const rail = NB.activity.railViews().slice();
        const hostVisible = !document.getElementById("outline-view").hidden;
        const refused = NB.activity.activate("outline", false) === false;
        return { rail, hostVisible, refused };
      });
      check("AC17: the phone rail carries no Outline slot",
        phoneOutline.rail.indexOf("outline") < 0, phoneOutline.rail.join(","));
      check("AC17: activate('outline') is refused on the phone",
        phoneOutline.refused === true && phoneOutline.hostVisible === false);
      await page.click("#activity-more-btn");
      await page.waitForFunction(() => !document.getElementById("mobile-views-sheet").hidden,
        null, { timeout: 5000 });
      const moreRows = await page.evaluate(() => Array.from(
        document.querySelectorAll("#mobile-views-sheet .mobile-more-row"))
        .map((r) => r.textContent.replace(/\s+/g, " ").trim()));
      check("AC17: the More sheet has no Outline row",
        !moreRows.some((t) => /Outline/.test(t)) &&
        moreRows.some((t) => /Settings/.test(t)),
        moreRows.join(" | "));
      check("AC16/17: no uncaught page errors", pageErrors.length === 0,
        pageErrors.join(" | "));
      await ctx.close();
      await setCfg({});
    }

    // --- The narrow floor: seven slots still clear 44 px at 320 ----
    {
      const ctx = await browser.newContext({
        viewport: { width: 320, height: 568 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        serviceWorkers: "block",
      });
      const page = await ctx.newPage();
      await page.goto(BASE + "/");
      await bootApp(page);
      const rail = await page.evaluate(() => {
        const bar = document.getElementById("activity-bar");
        const btns = Array.from(bar.querySelectorAll(".activity-btn"))
          .filter((b) => b.offsetParent !== null);
        return {
          count: btns.length,
          minW: btns.length ? Math.round(Math.min(...btns.map((b) => b.getBoundingClientRect().width))) : 0,
          minH: btns.length ? Math.round(Math.min(...btns.map((b) => b.getBoundingClientRect().height))) : 0,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      check("320x568: the rail is six views plus More",
        rail.count === 7, String(rail.count));
      check("320x568: every rail slot clears the 44 px floor",
        rail.minW >= 44 && rail.minH >= 44, rail.minW + "x" + rail.minH);
      check("320x568: no horizontal overflow", rail.overflow <= 1, String(rail.overflow));
      await ctx.close();
    }

    // --- Boot: a deep link wins over the device-local resume ------
    {
      await resetWorkspaceState();
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        serviceWorkers: "block",
      });
      const page = await ctx.newPage();
      await page.goto(BASE + "/");
      await bootApp(page);
      // Leave a Continue target behind, then boot a different ?file= link.
      await page.evaluate(() => localStorage.setItem(
        "nb:mobileResume",
        JSON.stringify({ v: 1, path: "notes/a.md", scroll: 0 })));
      await page.goto(BASE + "/?file=notes/b.md");
      await bootApp(page);
      await page.waitForFunction(
        () => window.NB.tabs.getActive() === "notes/b.md", null, { timeout: 10000 });
      check("phone boot: a deep link wins over the device-local resume",
        await page.evaluate(() =>
          window.NB.tabs.getActive() === "notes/b.md" &&
          document.getElementById("mobile-title").textContent === "b.md" &&
          window.location.search.indexOf("file=") !== -1),
        await page.evaluate(() => window.NB.tabs.getActive() + " " + window.location.search));

      // A bad deep link keeps its address and shows Note not found; it must
      // not fall back to the resume note.
      await page.evaluate(() => localStorage.setItem(
        "nb:mobileResume",
        JSON.stringify({ v: 1, path: "notes/a.md", scroll: 0 })));
      await page.goto(BASE + "/?file=missing.md");
      await bootApp(page);
      await page.waitForFunction(
        () => !document.getElementById("mobile-state").hidden, null, { timeout: 10000 });
      check("phone boot: a bad deep link shows Note not found, not the resume note",
        await page.evaluate(() =>
          /Note not found/.test(document.getElementById("mobile-state").textContent) &&
          window.NB.tabs.getActive() !== "notes/a.md" &&
          window.location.search.indexOf("missing.md") !== -1),
        await page.evaluate(() =>
          document.getElementById("mobile-state").textContent + " active=" +
          window.NB.tabs.getActive() + " " + window.location.search));
      await ctx.close();
    }

    // --- History invariants: boot seeding, A -> B -> back --------
    {
      // Cold boot with a deep link: back reaches Home, not the page
      // before the app.
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        serviceWorkers: "block",
      });
      const page = await ctx.newPage();
      await page.goto(BASE + "/?file=Welcome.md");
      await bootApp(page);
      await page.waitForFunction(
        () => window.NB.tabs.getActive() === "Welcome.md", null, { timeout: 8000 });
      const coldActive = await page.evaluate(() => window.NB.tabs.getActive());
      check("history: cold deep link opens the note",
        coldActive === "Welcome.md", coldActive);
      await page.goBack();
      await page.waitForFunction(
        () => !document.getElementById("mobile-home").hidden, null, { timeout: 5000 });
      check("history: cold deep-link back reaches Home",
        await page.evaluate(() => window.NB.tabs.getActive() === null &&
          !document.getElementById("mobile-home").hidden));
      check("history: cold deep-link back clears ?file=",
        await page.evaluate(() => window.location.search === ""),
        await page.evaluate(() => window.location.search));
      await ctx.close();
    }
    {
      // Resume boot: the note is above a Home entry, so back reaches Home.
      await resetWorkspaceState();
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        serviceWorkers: "block",
      });
      const page = await ctx.newPage();
      await page.goto(BASE + "/");
      await bootApp(page);
      await page.evaluate(() => localStorage.setItem("nb:mobileResume",
        JSON.stringify({ v: 1, path: "Long.md", scroll: 600 })));
      await page.reload();
      await bootApp(page);
      await page.waitForFunction(
        () => window.NB.tabs.getActive() === "Long.md", null, { timeout: 8000 });
      const resumeActive = await page.evaluate(() => window.NB.tabs.getActive());
      check("history: resume boot opens the note",
        resumeActive === "Long.md", resumeActive);
      // The resume offset must be applied to the scrollport, not to the
      // page element (which does not scroll).
      const resumeScroll = await page.waitForFunction(
        () => Math.abs(document.getElementById("viewer-scroll").scrollTop - 600) < 2,
        null, { timeout: 5000 }).then(() => true).catch(() => false);
      check("history: resume boot restores the scroll position",
        resumeScroll,
        await page.evaluate(() => document.getElementById("viewer-scroll").scrollTop));
      await page.goBack();
      await page.waitForFunction(
        () => !document.getElementById("mobile-home").hidden, null, { timeout: 5000 });
      check("history: resume boot back reaches Home",
        await page.evaluate(() => window.NB.tabs.getActive() === null &&
          !document.getElementById("mobile-home").hidden));
      check("history: resume boot back clears ?file=",
        await page.evaluate(() => window.location.search === ""),
        await page.evaluate(() => window.location.search));
      await ctx.close();
    }
    {
      // A -> B -> back shows A, and the URL names A.
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        serviceWorkers: "block",
      });
      const page = await ctx.newPage();
      await page.goto(BASE + "/");
      await bootApp(page);
      await openFileFromDrawer(page, "Welcome.md");
      await openFileFromDrawer(page, "Second.md");
      check("history: A -> B opens B",
        await page.evaluate(() => window.NB.tabs.getActive() === "Second.md"));
      await page.goBack();
      await page.waitForFunction(
        () => window.NB.tabs.getActive() === "Welcome.md", null, { timeout: 8000 });
      check("history: A -> B -> back shows A",
        await page.evaluate(() => window.NB.tabs.getActive() === "Welcome.md"),
        await page.evaluate(() => window.NB.tabs.getActive()));
      check("history: back URL names A",
        await page.evaluate(() => window.location.search.indexOf("file=Welcome.md") !== -1),
        await page.evaluate(() => window.location.search));
      await ctx.close();
    }

    // --- Quick capture against the real server --------------------
    {
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        serviceWorkers: "block",
      });
      const page = await ctx.newPage();
      await page.goto(BASE + "/");
      await bootApp(page);
      await page.click("#mobile-capture");
      await page.waitForFunction(
        () => !document.getElementById("capture-sheet").hidden, null, { timeout: 5000 });
      await page.fill("#capture-input", "phone browser capture");
      await page.click("#capture-send");
      await page.waitForFunction(
        () => document.getElementById("capture-sheet").hidden, null, { timeout: 8000 });
      const inbox = fs.existsSync(path.join(DATA, "Inbox.md"))
        ? fs.readFileSync(path.join(DATA, "Inbox.md"), "utf8") : "";
      check("phone capture: Inbox.md is created on first capture",
        fs.existsSync(path.join(DATA, "Inbox.md")));
      check("phone capture: one blank-line-separated block lands on disk",
        inbox.endsWith("\n\nphone browser capture\n"), JSON.stringify(inbox.slice(-40)));
      check("phone capture: the sheet closes and the draft is cleared",
        await page.evaluate(() =>
          document.getElementById("capture-sheet").hidden &&
          localStorage.getItem("nb:captureDraft") === null));
      await page.screenshot({ path: path.join(tmp, "phone-capture.png") });
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
