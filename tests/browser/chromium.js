/* Locate a Chromium binary for the Playwright suites.
 *
 * Playwright's bundled browsers are not installed on NixOS (and its
 * headless shell cannot start there), so every suite needs a real
 * binary. CHROMIUM_PATH still wins; otherwise probe the Playwright
 * cache, the usual system paths, and the Nix store, and use the first
 * candidate that answers --version.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

function runsVersion(exe) {
  try {
    execFileSync(exe, ["--version"], { stdio: "ignore", timeout: 8000 });
    return true;
  } catch (_) {
    return false;
  }
}

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const candidates = [];
  const cache = path.join(os.homedir(), ".cache", "ms-playwright");
  try {
    for (const name of fs.readdirSync(cache)) {
      if (/^chromium-\d+$/.test(name)) {
        candidates.push(path.join(cache, name, "chrome-linux64", "chrome"));
      }
    }
  } catch (_) { /* no bundled browser */ }
  candidates.push(
    "/run/current-system/sw/bin/chromium",
    "/run/current-system/sw/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome"
  );
  try {
    for (const name of fs.readdirSync("/nix/store")) {
      if (!/-chromium-\d/.test(name) || /sandbox/.test(name)) continue;
      candidates.push(path.join("/nix/store", name, "bin", "chromium"));
      candidates.push(path.join("/nix/store", name, "bin", "chromium-browser"));
    }
  } catch (_) { /* not NixOS */ }
  for (const exe of candidates) {
    if (fs.existsSync(exe) && runsVersion(exe)) return exe;
  }
  return undefined;
}

module.exports = { findChromium };
