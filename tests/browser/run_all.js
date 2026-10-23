/* Run every real-browser suite sequentially on distinct ports.
 *
 * Each suite spawns its own Flask server against a fresh temp notebook,
 * so the ports must not collide; they are assigned explicitly here
 * rather than relying on the per-suite defaults (hybrid and mobile both
 * default to 5099).
 *
 * Run:  node tests/browser/run_all.js [--only=<substring>]
 * Env:  CHROMIUM_PATH overrides the auto-detected binary.
 */
const path = require("path");
const { spawn } = require("child_process");
const { findChromium } = require("./chromium");

const SUITES = [
  { name: "core UI", file: "test_core_ui_browser.js", port: 5080 },
  { name: "auth/export/PWA", file: "test_auth_export_browser.js", port: 5081 },
  { name: "AI/ACP/editor", file: "test_ai_editor_browser.js", port: 5086 },
  { name: "hybrid", file: "test_hybrid_browser.js", port: 5099 },
  { name: "hybrid blocks", file: "test_hybrid_blocks_browser.js", port: 5082 },
  { name: "fence editor", file: "test_block_edit_browser.js", port: 5091 },
  { name: "mobile", file: "test_mobile_browser.js", port: 5095 },
  { name: "mermaid designer", file: "test_designer_browser.js", port: 5098 },
  { name: "dot/wavedrom designer", file: "test_dw_designer_browser.js", port: 5096 },
];

const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice("--only=".length) : null;
const selected = only
  ? SUITES.filter((s) => s.name.includes(only) || s.file.includes(only))
  : SUITES;

const chromium = process.env.CHROMIUM_PATH || findChromium();
if (!chromium) {
  console.error("No Chromium found. Set CHROMIUM_PATH to a working binary.");
  process.exit(2);
}
if (!selected.length) {
  console.error("No suite matches --only=" + only);
  process.exit(2);
}

function runSuite(suite) {
  return new Promise((resolve) => {
    console.log("\n============================================================");
    console.log("== " + suite.name + "  (" + suite.file + ", port " + suite.port + ")");
    console.log("============================================================\n");
    const child = spawn(process.execPath, [path.join(__dirname, suite.file)], {
      cwd: path.resolve(__dirname, "..", ".."),
      env: Object.assign({}, process.env, {
        CHROMIUM_PATH: chromium,
        PORT: String(suite.port),
      }),
      stdio: "inherit",
    });
    const timer = setTimeout(() => {
      console.error("\n" + suite.name + " timed out; terminating.");
      child.kill("SIGKILL");
    }, 15 * 60 * 1000);
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ suite, code: code == null ? 1 : code, signal });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      console.error(suite.name + " failed to start: " + err.message);
      resolve({ suite, code: 1, signal: null });
    });
  });
}

(async () => {
  console.log("Chromium: " + chromium);
  const results = [];
  for (const suite of selected) {
    results.push(await runSuite(suite));
  }
  console.log("\n============================================================");
  console.log("Browser suite summary");
  console.log("============================================================");
  for (const r of results) {
    console.log((r.code === 0 ? "PASS " : "FAIL ") + r.suite.name +
      (r.signal ? " (" + r.signal + ")" : ""));
  }
  const failed = results.filter((r) => r.code !== 0);
  console.log("\n" + (results.length - failed.length) + "/" + results.length + " suites passed");
  process.exit(failed.length ? 1 : 0);
})();
