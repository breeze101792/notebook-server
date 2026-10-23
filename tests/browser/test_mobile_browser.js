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
          outlineW: rect("outline-pane").width,
          activityLeft: rect("activity-bar").left,
          panelLeft: rect("side-panel").left,
          editorLeft: rect("editor-pane").left,
          outlineLeft: rect("outline-pane").left,
          mobileTitle: cs("mobile-title").display,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      check("desktop 1280: #layout is a grid with four columns",
        d.display === "grid" && d.colCount === 4,
        "display=" + d.display + " cols=" + d.colCount);
      check("desktop 1280: every desktop column has width",
        d.activityW > 0 && d.panelW > 0 && d.viewerW > 0 && d.outlineW > 0,
        JSON.stringify([d.activityW, d.panelW, d.viewerW, d.outlineW]));
      check("desktop 1280: columns stay left-to-right",
        d.activityLeft < d.panelLeft && d.panelLeft < d.editorLeft &&
        d.editorLeft < d.outlineLeft,
        JSON.stringify([d.activityLeft, d.panelLeft, d.editorLeft, d.outlineLeft]));
      check("desktop 1280: the tab strip is visible",
        d.tabDisplay !== "none" && d.tabHeight > 0,
        "display=" + d.tabDisplay + " height=" + d.tabHeight);
      check("desktop 1280: mobile chrome is hidden",
        d.mobileTitle === "none", d.mobileTitle);
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
            return { w: r.width, h: r.height };
          });
        return {
          editorW: rect("editor-pane").width,
          viewerW: viewer.width,
          readerW: vc.width,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          bodyOverflow: document.body.scrollWidth - window.innerWidth,
          tabDisplay: cs("tab-bar").display,
          outlineDisplay: cs("outline-pane").display,
          railPosition: cs("activity-bar").position,
          railBottom: rail.bottom,
          viewportH: window.innerHeight,
          bodyPad: getComputedStyle(document.body).padding,
          appTop: rect("app").top,
          appBottom: rect("app").bottom,
          homeRows: document.querySelectorAll("#mobile-home .mobile-home-row").length,
          homeHidden: document.getElementById("mobile-home").hidden,
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
        };
      });
      check(size.name + ": the editor area fills at least one column",
        layout.editorW > 0, "editor=" + layout.editorW);
      check(size.name + ": the page has no horizontal overflow",
        layout.overflow <= 1 && layout.bodyOverflow <= 1,
        "doc=" + layout.overflow + " body=" + layout.bodyOverflow);
      check(size.name + ": tab strip and outline are hidden",
        layout.tabDisplay === "none" && layout.outlineDisplay === "none",
        "tabs=" + layout.tabDisplay + " outline=" + layout.outlineDisplay);
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

      // Note-header … menu opens without navigating.
      const urlBefore = page.url();
      await page.click("#mobile-more");
      await page.waitForSelector("#nb-menu:not([hidden])", { timeout: 5000 });
      const menuItems = await page.locator("#nb-menu button").allTextContents();
      check(size.name + ": the note … menu is Reload / Copy link / Show in Browse",
        menuItems.join("|") === "Reload|Copy link|Show in Browse",
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

      check(size.name + ": no uncaught page errors", pageErrors.length === 0,
        pageErrors.join(" | "));

      await page.screenshot({ path: path.join(tmp, "phone-" + size.name + ".png") });
      await ctx.close();
    }

    // --- Boot: a deep link wins over the device-local resume ------
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
        JSON.stringify({ v: 1, path: "notes/a.md", scroll: 0 })));
      await page.reload();
      await bootApp(page);
      await page.waitForFunction(
        () => window.NB.tabs.getActive() === "notes/a.md", null, { timeout: 8000 });
      const resumeActive = await page.evaluate(() => window.NB.tabs.getActive());
      check("history: resume boot opens the note",
        resumeActive === "notes/a.md", resumeActive);
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
