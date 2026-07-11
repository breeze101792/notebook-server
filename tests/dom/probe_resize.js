/* probe_resize.js -- launch real chromium, hit-test the sidebar resize handle.
 * Run with: node tests/dom/probe_resize.js <url>
 * Reports, for BOTH the left sidebar and the right outline pane:
 *   - the handle element + its bounding box
 *   - what document.elementFromPoint() returns at the handle's center
 *   - a real mouse drag and whether --sidebar-width/--outline-width changed
 */
const { chromium } = require("playwright-core");

(async () => {
  const url = process.argv[2] || "http://127.0.0.1:5197/";
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(url, { waitUntil: "networkidle" });
  // let the tree/tabs settle
  await page.waitForTimeout(300);

  const report = await page.evaluate(() => {
    const out = [];
    function probe(id, edge) {
      const pane = document.getElementById(id);
      const handle = pane.querySelector(".resize-handle");
      const pb = pane.getBoundingClientRect();
      const hb = handle ? handle.getBoundingClientRect() : null;
      // center of the handle strip
      const cx = hb ? hb.left + hb.width / 2 : (edge === "right" ? pb.right - 2 : pb.left + 2);
      const cy = pb.top + pb.height / 2; // vertical middle, below the header
      const atop = document.elementFromPoint(cx, pb.top + 60); // just below header
      const amid = document.elementFromPoint(cx, cy);
      const aedge = document.elementFromPoint(cx, pb.bottom - 30);
      out.push({
        id, edge,
        paneBox: { l: Math.round(pb.left), r: Math.round(pb.right), t: Math.round(pb.top), b: Math.round(pb.bottom), w: Math.round(pb.width) },
        handle: hb ? { l: Math.round(hb.left), r: Math.round(hb.right), w: Math.round(hb.width) } : null,
        handleStyle: handle ? {
          position: getComputedStyle(handle).position,
          right: handle.style.right, left: handle.style.left,
          width: handle.style.width, zIndex: getComputedStyle(handle).zIndex,
          opacity: handle.style.opacity, pointerEvents: getComputedStyle(handle).pointerEvents,
        } : null,
        atTop: atop ? atop.tagName + "#" + atop.id + "." + atop.className : null,
        atMid: amid ? amid.tagName + "#" + amid.id + "." + amid.className : null,
        atEdge: aedge ? aedge.tagName + "#" + aedge.id + "." + aedge.className : null,
      });
    }
    probe("sidebar", "right");
    probe("outline-pane", "left");
    return out;
  });
  console.log("=== HIT TEST (elementFromPoint at handle center, below header) ===");
  for (const r of report) {
    console.log(`\n[${r.id}] edge=${r.edge}`);
    console.log("  paneBox:", JSON.stringify(r.paneBox));
    console.log("  handle :", JSON.stringify(r.handle));
    console.log("  hStyle :", JSON.stringify(r.handleStyle));
    console.log("  atTop :", r.atTop);
    console.log("  atMid :", r.atMid);
    console.log("  atEdge:", r.atEdge);
  }

  // Now try a REAL drag on each handle and see if the CSS var changes.
  async function dragTest(id, edge, cssVar) {
    const before = await page.evaluate(v => getComputedStyle(document.documentElement).getPropertyValue(v), cssVar);
    const pane = await page.$("#" + id);
    const pb = await pane.boundingBox();
    // handle center: right edge -> just inside pane right; left edge -> just inside pane left
    const hx = edge === "right" ? pb.x + pb.width - 2 : pb.x + 2;
    const hy = pb.y + pb.height / 2;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    // move 60px outward (right edge: increase x; left edge: decrease x to widen outline)
    const dx = edge === "right" ? +60 : -60;
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(hx + dx * i / 6, hy);
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(80);
    const during = await page.evaluate(v => getComputedStyle(document.documentElement).getPropertyValue(v), cssVar);
    await page.mouse.up();
    await page.waitForTimeout(80);
    const after = await page.evaluate(v => getComputedStyle(document.documentElement).getPropertyValue(v), cssVar);
    console.log(`\n=== DRAG [${id}] ${cssVar} ===`);
    console.log("  before:", before.trim(), "| during:", during.trim(), "| after:", after.trim());
    return { before: before.trim(), during: during.trim(), after: after.trim() };
  }
  const sd = await dragTest("sidebar", "right", "--sidebar-width");
  const od = await dragTest("outline-pane", "left", "--outline-width");
  console.log("\n=== SUMMARY ===");
  console.log("sidebar  drag worked:", sd.before !== sd.during, `( ${sd.before} -> ${sd.during} )`);
  console.log("outline  drag worked:", od.before !== od.during, `( ${od.before} -> ${od.during} )`);

  await browser.close();
})().catch(e => { console.error("PROBE ERROR:", e); process.exit(1); });