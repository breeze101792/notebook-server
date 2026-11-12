#!/usr/bin/env node
/* Typography source check -- layer 1 of docs/architecture/typography.md §5.
 *
 * The contract (docs/testing/typography.md §2): every `font-size` declaration,
 * and the size slot of every `font:` shorthand, in style.css and vimnav.css is
 * either a role token (`var(--text-*)`), an icon token (`var(--icon-*)`),
 * `inherit`, the root scale definition, the font-size tile's component token,
 * a prose `em`/`%`, or an entry pinned in ALLOWLIST below.
 *
 * An allowlist entry is pinned to (file, selector, value); the selector carries
 * its @media/@container prefix so one rule per context is one entry. A literal
 * that is not listed fails, an allowlisted value that changes fails, and an
 * entry that no longer matches anything fails (stale). The literal count is
 * ratcheted by tests/static/typography-baseline.json: the count may not rise,
 * and a fall only passes when the baseline file is lowered in the same commit.
 *
 * Also enforced here (invariants I3 and I6, typography.md §1):
 *   - the :root block keeps exactly the seven documented --text-* steps;
 *   - no JS writes an element font size outside the documented exemptions;
 *   - no browser suite injects a font size through page.addStyleTag.
 *
 * Run:  node tests/static/test_typography.js
 *       node tests/static/test_typography.js --inventory   (print the inventory)
 */
"use strict";

const fs = require("fs");
const path = require("path");

const PROJ = path.resolve(__dirname, "..", "..");
const CSS_FILES = ["static/css/style.css", "static/css/vimnav.css"];
const JS_DIR = "static/js";
const BASELINE_FILE = "tests/static/typography-baseline.json";
const BROWSER_DIR = "tests/browser";

/* The root size the px figures in the docs are measured at (M). */
const ROOT_PX = 14;
/* The seven documented steps, in order (docs/ui/typography.md §1-2). */
const STEPS = [
  { token: "--text-2xs", value: "9px", rem: 0 },
  { token: "--text-xs", value: ".72rem", rem: 0.72 },
  { token: "--text-sm", value: ".8rem", rem: 0.8 },
  { token: "--text-ui", value: ".86rem", rem: 0.86 },
  { token: "--text-ui-lg", value: ".93rem", rem: 0.93 },
  { token: "--text-body", value: "1rem", rem: 1 },
  { token: "--text-lg", value: "1.15rem", rem: 1.15 },
];

/* Values that always pass (docs/testing/typography.md §2.1). */
const PASS_EXACT = new Set([
  "calc(14px * var(--font-scale, 1))",                       // the root definition
  "calc(1rem / var(--font-scale, 1) * var(--fs-opt))",        // the font-size tile
  "calc(16px * var(--font-scale))",                           // phone prose base
  "inherit",
]);
/* `em`/`%` is legal only inside a prose container (typography.md §6.3). */
const PROSE_SELECTOR = /\.markdown-body|\.ai-prose-span|\.welcome-tips/;
const PROSE_VALUE = /^(?:[\d.]+(?:em|%))(?:\/.*)?$/;

/* JS writes are allowed only in these documented places. */
const JS_ALLOWLIST = [
  {
    file: "static/js/blocks.js",
    match: 'font-size=\\"14\\"',
    why: "SVG fixture markup inside a JS string (typography.md §2.1)",
  },
  {
    file: "static/js/katex.js",
    match: "display.style.fontSize =",
    why: "KaTeX fit pass inside a vendored island; never app chrome",
  },
  {
    file: "static/js/export.js",
    fileWide: true,
    why: "writes sizes into the standalone exported HTML document, never the app chrome",
  },
];
/* Browser suites may inject a style rule only when it carries no font size. */
const STYLE_TAG_ALLOWLIST = [];

/* ------------------------------------------------------------------ */
/* Allowlist -- seeded from the inventory at the time of landing.      */
/* Each entry is pinned to (file, selector, value) and carries the     */
/* phase of architecture §6 that retires it. A stale entry fails.      */
/* ------------------------------------------------------------------ */

const ALLOWLIST = [
  /* token-value literal; tier-1 token swap pending */
  { file: "static/css/style.css", selector: "body", value: "1rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: "#brand", value: ".93rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: "#topbar button, #topbar select", value: ".93rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".activity-btn", value: "1.15rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".expand-btn", value: "1rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".tab-bar .outline-toggle", value: "1rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: "#edit-bar .eb", value: ".93rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: "#edit-bar .eb code, #edit-bar .eb b, #edit-bar .eb i, #edit-bar .eb s", value: ".93rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".nb-drag-proxy", value: ".8rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".nb-tv-toggle", value: ".8rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".nb-tv-item", value: ".8rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".nb-tv-empty", value: ".8rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".watch-btn", value: ".93rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: "#settings-overlay .settings-label", value: ".93rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: "#settings-overlay .settings-ai-acp-profile-name", value: ".93rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: "#settings-overlay .settings-ai-acp-agent-name", value: ".93rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ":where(body > .settings-overlay > .settings-modal) .settings-nav-item", value: ".93rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".settings-label", value: ".93rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".settings-note", value: ".86rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".settings-vimrc-area", value: ".86rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".settings-value", value: ".93rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".settings-mono", value: ".86rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".theme-options label", value: ".93rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".auth-form .auth-help", value: ".93rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".auth-input", value: "1rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".auth-status-text", value: ".86rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: "#cm-host .cm-editor", value: "1rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: "#welcome .welcome-subtitle", value: "1rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".tree-empty", value: ".86rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".pinned-title", value: ".72rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".pinned-view-empty", value: ".86rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".bookmarks-empty", value: ".86rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: "body > #nb-menu button", value: ".93rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".outline-empty", value: ".86rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".mermaid-error-head, .wavedrom-error-head, .katex-error-head, .viz-error-head, .svg-error-head", value: ".86rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".toast", value: ".86rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".recent-empty", value: ".86rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".search-panel-note", value: ".72rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".sp-file", value: ".86rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".sp-count", value: ".72rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".search-panel-hit-snippet", value: ".8rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".ai-prose-span h2", value: "1rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".ai-prose-span h3, .ai-prose-span h4, .ai-prose-span h5, .ai-prose-span h6", value: ".93rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".ai-edit-path", value: ".8rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".ai-edit-desc", value: ".8rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".diff-hunk", value: ".72rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".ai-card-status", value: ".8rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".ai-user-file", value: ".72rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".settings-hint", value: ".72rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".export-format-options label, .export-scope-options label, .export-width-options label, .export-theme-options label", value: ".93rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".export-modal .settings-checkbox", value: ".93rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".table-editor-modal .te-cell", value: ".93rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".table-editor-modal .te-status", value: ".8rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".table-editor-modal .te-notice-glyph", value: "1rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".table-editor-modal .te-notice-strip p + p", value: ".8rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".designer-type", value: ".72rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".designer-sidebar-title", value: ".72rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".designer-chip-text", value: ".72rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".designer-switch-word", value: ".72rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".designer-alert", value: ".8rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".designer-alert-dismiss", value: "1rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".designer-state-title", value: "1rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".designer-grabber-label", value: ".8rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".designer-inspector-meta", value: ".72rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: "#dw-designer-overlay .dw-glyph-btn", value: ".72rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: "#dw-designer-overlay .dw-readout", value: ".72rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: "#dw-designer-overlay .dw-shape-btn", value: ".72rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".workspace-warn", value: ".8rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".workspace-caret", value: ".72rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".topbar-session-caret", value: ".72rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".session-item", value: ".93rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".session-check", value: ".8rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".ws-item", value: ".93rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".ws-check", value: ".8rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".ws-item-warn", value: ".8rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".ws-row-check", value: ".8rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".ws-row-path", value: ".8rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".ws-badge", value: ".72rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".ws-resolved-path", value: ".8rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".session-total", value: ".72rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".session-more", value: "1rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".sessions-foot-pin", value: ".72rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },
  { file: "static/css/style.css", selector: ".edit-chip", value: ".8rem", why: "token-value literal; tier-1 token swap pending", retires: "phase 1" },

  /* glyph or one-off em outside a prose container */
  { file: "static/css/style.css", selector: "#edit-bar .eb-submenu-btn::after", value: ".8em", why: "glyph or one-off em outside a prose container", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: "body > #nb-menu .submenu::after", value: ".8em", why: "glyph or one-off em outside a prose container", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: ".hybrid-lang-pill", value: ".72em", why: "glyph or one-off em outside a prose container", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: ".tab-special-icon", value: ".9em", why: "glyph or one-off em outside a prose container", retires: "phase 2.6" },

  /* off-scale role literal; role rounding pending */
  { file: "static/css/style.css", selector: "#edit-bar .eb-emoji-search", value: ".85rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.5" },
  { file: "static/css/style.css", selector: "#edit-bar .eb-emoji-tabs button", value: ".95rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: "#edit-bar .eb-emoji-grid button", value: "1.05rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: "#edit-bar .eb-emoji-empty", value: ".85rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: ".nb-tv-btn", value: ".76rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: ".nb-tv-note", value: ".74rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: "#viewer-content thead th .nb-tv-head-menu", value: ".7rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: "body > #nb-menu button .context-menu-kbd, body > #nb-menu kbd.context-menu-kbd", value: ".74rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: ".tab-ghost-fill", value: ".89rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: ".icon-btn", value: "1.3rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: "#settings-overlay .settings-token-role, #settings-overlay .settings-token-created", value: ".78rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.1" },
  { file: "static/css/style.css", selector: "#settings-overlay .stg-tag", value: ".68rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.1" },
  { file: "static/css/style.css", selector: "#settings-overlay .settings-vimrc-status", value: ".82rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.1" },
  { file: "static/css/style.css", selector: "#settings-overlay .auth-status-text", value: ".82rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.1" },
  { file: "static/css/style.css", selector: "#settings-overlay .settings-ai-acp-title", value: ".74rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.1" },
  { file: "static/css/style.css", selector: "#settings-overlay .settings-ai-acp-profile-meta", value: ".78rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.1" },
  { file: "static/css/style.css", selector: "#settings-overlay .settings-ai-acp-key", value: ".76rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.1" },
  { file: "static/css/style.css", selector: "#settings-overlay .settings-ai-acp-hint", value: ".74rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.1" },
  { file: "static/css/style.css", selector: ".settings-vimrc-status", value: ".85rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.1" },
  { file: "static/css/style.css", selector: ".settings-subheading", value: ".95rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.1" },
  { file: "static/css/style.css", selector: "#edit-toggle", value: "1.1rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: "#hybrid-toggle", value: "1.1rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: ".code-copy-btn", value: ".76rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: ".mermaid-source, .wavedrom-source, .katex-source, .viz-source, .svg-source", value: ".85rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: ".mlb-btn", value: "1.05rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: ".mlb-close-btn", value: "1.2rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: ".mlb-zoom-pct", value: ".82rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: ".search-panel-advanced-badge", value: ".66rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.5" },
  { file: "static/css/style.css", selector: ".search-panel-mode-opt span", value: ".78rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.5" },
  { file: "static/css/style.css", selector: ".sp-meta", value: ".74rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: ".ai-prose-span h1", value: "1.08rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.3" },
  { file: "static/css/style.css", selector: ".ai-prose-span pre", value: ".78rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.3" },
  { file: "static/css/style.css", selector: ".ai-prose-span table", value: ".82rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.3" },
  { file: "static/css/style.css", selector: ".ai-edit-op", value: ".68rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.3" },
  { file: "static/css/style.css", selector: ".ai-stat", value: ".7rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.3" },
  { file: "static/css/style.css", selector: ".ai-patch-ops-note", value: ".78rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.3" },
  { file: "static/css/style.css", selector: ".ai-diff", value: ".76rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.3" },
  { file: "static/css/style.css", selector: ".diff-num", value: ".7rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: ".ai-attach-chip", value: ".75rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.3" },
  { file: "static/css/style.css", selector: ".ai-attach-chip-remove", value: ".95rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.3" },
  { file: "static/css/style.css", selector: ".ai-tool-trace", value: ".76rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.3" },
  { file: "static/css/style.css", selector: ".ai-tool-name", value: ".68rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.3" },
  { file: "static/css/style.css", selector: ".ai-tool-out", value: ".74rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.3" },
  { file: "static/css/style.css", selector: ".table-editor-modal .te-sort-label", value: ".76rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: ".table-editor-modal .te-sort-col", value: ".82rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: ".table-editor-modal .te-hint", value: ".78rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: ".table-editor-modal .te-notice-strip p", value: ".85rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: ".designer-btn", value: ".82rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: ".designer-btn--small", value: ".74rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: ".designer-tab", value: ".78rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: ".designer-field-label", value: ".76rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: ".designer-field-error", value: ".74rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: ".designer-scope-note", value: ".74rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: ".designer-field-help", value: ".73rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: ".designer-shape-caption", value: ".68rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: ".designer-switch-label", value: ".82rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: ".designer-add", value: ".82rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: ".designer-state-icon", value: "1.6rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: ".designer-state-msg", value: ".9rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: ".designer-error-detail", value: ".82rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: ".designer-empty .designer-state-icon", value: "2rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: ".designer-hint", value: ".82rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: ".designer-inspector-glyph", value: ".78rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: ".designer-inspector-kind", value: ".92rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: ".designer-group-title", value: ".7rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: ".designer-consequence", value: ".73rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: ".designer-rest-glyph", value: "1.4rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: ".designer-rest-title", value: ".9rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: ".designer-rest-copy", value: ".78rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: ".designer-status", value: ".85rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: "#dw-designer-overlay .dw-slice-cell", value: ".64rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: "#dw-designer-overlay .dw-cell-slice", value: ".5rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: "#dw-designer-overlay .dw-cell-char", value: ".68rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: "#dw-designer-overlay .dw-data-index", value: ".68rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: "#dw-designer-overlay .dw-data-preview", value: ".74rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: "#dw-designer-overlay .designer-sel-badge", value: ".64rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.2" },
  { file: "static/css/style.css", selector: "#draft-bar", value: ".85rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: "#topbar .workspace-switch", value: ".84rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.4" },
  { file: "static/css/style.css", selector: "#topbar .session-switch", value: ".84rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.4" },
  { file: "static/css/style.css", selector: ".ws-item-note", value: ".76rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.4" },
  { file: "static/css/style.css", selector: ".edit-header .icon-btn", value: "1.35rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: ".edit-footer > [role=\"status\"]", value: ".82rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.6" },
  { file: "static/css/vimnav.css", selector: ".vimnav-help-body", value: "0.95rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.6" },
  { file: "static/css/vimnav.css", selector: ".vimnav-help-body h3", value: "0.95rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.6" },
  { file: "static/css/vimnav.css", selector: ".vimnav-help-body th, .vimnav-help-body td", value: "0.9rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.6" },
  { file: "static/css/vimnav.css", selector: ".vimnav-help-body kbd", value: "0.85rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.6" },
  { file: "static/css/vimnav.css", selector: ".vimnav-help-footer", value: "0.85rem", why: "off-scale role literal; role rounding pending", retires: "phase 2.6" },

  /* fixed badge numeral; --text-2xs never scales */
  { file: "static/css/style.css", selector: "#edit-bar .eb.unsaved::after", value: "9px", why: "fixed badge numeral; --text-2xs never scales", retires: "never (badge role)" },
  { file: "static/css/style.css", selector: ".graph-view-badge", value: "9px", why: "fixed badge numeral; --text-2xs never scales", retires: "never (badge role)" },

  /* glyph/icon size, not text; becomes --icon-* */
  { file: "static/css/style.css", selector: ":where(#tab-bar) .tab .tab-close", value: "16px", why: "glyph/icon size, not text; becomes --icon-*", retires: "never -- glyph -> --icon-* (foundations §9)" },
  { file: "static/css/style.css", selector: ":where(#tab-bar) .tab.pinned .tab-pin", value: "14px", why: "glyph/icon size, not text; becomes --icon-*", retires: "never -- glyph -> --icon-* (foundations §9)" },
  { file: "static/css/style.css", selector: "#welcome .welcome-icon", value: "48px", why: "glyph/icon size, not text; becomes --icon-*", retires: "never -- glyph -> --icon-* (foundations §9)" },
  { file: "static/css/style.css", selector: ".bookmark-pin", value: "11px", why: "glyph/icon size, not text; becomes --icon-*", retires: "never -- glyph -> --icon-* (foundations §9)" },
  { file: "static/css/style.css", selector: ".tree-star", value: "11px", why: "glyph/icon size, not text; becomes --icon-*", retires: "never -- glyph -> --icon-* (foundations §9)" },
  { file: "static/css/style.css", selector: ".recent-clear", value: "16px", why: "glyph/icon size, not text; becomes --icon-*", retires: "never -- glyph -> --icon-* (foundations §9)" },

  /* retired local search alias (search-view.md §7.1) */

  /* container-query responsive rule */
  { file: "static/css/style.css", selector: "@container (max-width: 199px) #search-view .search-panel-select", value: ".74rem", why: "container-query responsive rule", retires: "phase 2.6" },

  /* graph-view overlay text; graph-view.md owns it */
  { file: "static/css/style.css", selector: ".graph-view-title", value: ".95rem", why: "graph-view overlay text; graph-view.md owns it", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: ".graph-view-summary", value: ".78rem", why: "graph-view overlay text; graph-view.md owns it", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: ".graph-view-mode button", value: ".74rem", why: "graph-view overlay text; graph-view.md owns it", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: ".graph-view-filter", value: ".82rem", why: "graph-view overlay text; graph-view.md owns it", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: ".graph-view-depth-value", value: "10px", why: "graph-view overlay text; graph-view.md owns it", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: ".graph-view-hint", value: "11.5px", why: "graph-view overlay text; graph-view.md owns it", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: ".graph-view-chip", value: "11.5px", why: "graph-view overlay text; graph-view.md owns it", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: ".graph-view-toast", value: "12px", why: "graph-view overlay text; graph-view.md owns it", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: ".graph-view-state-title", value: ".98rem", why: "graph-view overlay text; graph-view.md owns it", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: ".graph-view-state-body", value: ".82rem", why: "graph-view overlay text; graph-view.md owns it", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: ".graph-view-state-body code", value: ".92em", why: "graph-view overlay text; graph-view.md owns it", retires: "phase 2.6" },
  { file: "static/css/style.css", selector: ".graph-view-state-action", value: ".8rem", why: "graph-view overlay text; graph-view.md owns it", retires: "phase 2.6" },

  /* phone shell px ladder; mobile-shell.md owns it */
  { file: "static/css/style.css", selector: "@media (max-width: 720px) .graph-view-hint", value: "11px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 520px) .graph-view-title", value: ".9rem", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) #back-btn, #mobile-capture, #mobile-more, #hybrid-toggle", value: "20px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) #mobile-title", value: "16px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) #edit-bar .eb", value: "15px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .activity-btn", value: "22px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .panel-title", value: "12px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) #mobile-drawer-status", value: "12px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .tree-name, .pin-name", value: "15px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) #side-panel .tree-more", value: "18px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .bookmark-name, .recent-name", value: "15px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .search-panel-advanced-toggle", value: "var(--search-adv-font)", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .search-panel-advanced-summary", value: "var(--search-adv-meta)", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .search-panel-case span", value: "15px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) #search-view .search-panel-mode-opt span", value: "15px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .search-panel-summary", value: "14px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .search-panel-note", value: "13px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .search-panel-hit .sp-file", value: "15px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .search-panel-hit-snippet", value: "14px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .sp-count", value: "12px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .search-panel-empty, .recent-empty, .bookmarks-empty", value: "14px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .markdown-body pre", value: "13px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .markdown-body pre:has(> code) > .code-copy-btn", value: "12px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .code-copy-btn", value: "12px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .mobile-home-title", value: "22px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .mobile-home-sub", value: "14px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .mobile-home-row", value: "15px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .mhr-icon", value: "18px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .mhr-meta", value: "12px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .mobile-state-glyph", value: "40px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .mobile-state-title", value: "20px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .mobile-state-path", value: "13px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .mobile-state-msg", value: "14px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .mobile-state-btn", value: "15px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .capture-head h2, .mobile-settings-head h2", value: "16px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .mobile-sheet-close", value: "20px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .capture-status", value: "13px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) #capture-send, .mobile-signout", value: "15px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .mobile-settings-label", value: "15px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .mobile-settings-admin", value: "13px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .mobile-settings-seg button", value: "13px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .mobile-settings-note", value: "12px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .mobile-settings-server", value: "12px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .toast", value: "14px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) #nb-menu button", value: "15px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .ws-item", value: ".95rem", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .ws-foot", value: ".8rem", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) #topbar .workspace-switch, #topbar .session-switch", value: "16px", why: "phone shell px ladder; mobile-shell.md owns it", retires: "phase 3" },

  /* iOS 16px zoom floor on a phone field (controls.md §9) */
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .search-panel-input", value: "16px", why: "iOS 16px zoom floor on a phone field (controls.md §9)", retires: "never (touch field)" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .search-panel-select", value: "16px", why: "iOS 16px zoom floor on a phone field (controls.md §9)", retires: "never (touch field)" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) #capture-input", value: "16px", why: "iOS 16px zoom floor on a phone field (controls.md §9)", retires: "never (touch field)" },
  { file: "static/css/style.css", selector: "@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) .auth-input", value: "16px", why: "iOS 16px zoom floor on a phone field (controls.md §9)", retires: "never (touch field)" },

];

/* ------------------------------------------------------------------ */
/* Utilities                                                          */
/* ------------------------------------------------------------------ */

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log("  ok   " + name);
  } else {
    failed++;
    console.log("  FAIL " + name + (detail ? "\n         " + detail : ""));
    failures.push(name);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(PROJ, rel), "utf8");
}

/* Replace every comment with spaces, keeping newlines, so line numbers and
 * column offsets survive. A rule inside a comment can never count. */
function stripComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src[i] === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (src[i] === "/" && src[i + 1] === "/") {
      const end = src.indexOf("\n", i);
      const stop = end < 0 ? src.length : end;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else {
      out += src[i++];
    }
  }
  return out;
}

function lineAt(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}

/* Split on `sep` outside parentheses, brackets and braces. */
function splitTopLevel(text, sep) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

const LENGTH = /^(?:\d*\.)?\d+(?:rem|px|em|%|pt)$/;
const KEYWORD = /^(?:xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger)$/;

/* The size slot of a `font:` shorthand: the first length, percentage, size
 * keyword, calc(), or role token; weight/line-height/family tokens are
 * skipped. Returns "" when the shorthand carries no recognisable size. */
function fontShorthandSize(value) {
  if (/^inherit$/i.test(value.trim())) return "inherit";
  const head = splitTopLevel(value.trim(), "/")[0];
  for (const token of head.split(/\s+/).filter(Boolean)) {
    if (/^var\(--(?:text|icon)-/.test(token)) return token;
    if (/^var\(--(?:fw|lh|font)-/.test(token)) continue;
    if (LENGTH.test(token) || KEYWORD.test(token) || /^calc\(/.test(token)) return token;
  }
  return "";
}

/* Walk declarations with their selector path and enclosing at-rules. */
function declarations(css, file) {
  const out = [];
  const stack = [];
  let i = 0;
  let segStart = 0;
  while (i < css.length) {
    if (css[i] === "{") {
      stack.push(css.slice(segStart, i).trim());
      segStart = i + 1;
    } else if (css[i] === "}") {
      stack.pop();
      segStart = i + 1;
    } else if (css[i] === ";" && stack.length) {
      const decl = css.slice(segStart, i);
      // Point the line number at the declaration's first non-space character,
      // not at the whitespace that follows the previous "{".
      const start = segStart + (decl.length - decl.trimStart().length);
      segStart = i + 1;
      const m = decl.match(/^\s*([-a-z]+)\s*:\s*([\s\S]*)$/i);
      if (m) {
        const prop = m[1].toLowerCase();
        if (prop === "font-size" || prop === "font") {
          const at = stack.filter((s) => s.startsWith("@")).join(" | ");
          const sel = stack
            .filter((s) => !s.startsWith("@"))
            .join(" > ")
            .replace(/\s+/g, " ")
            .trim();
          out.push({
            file,
            line: lineAt(css, start),
            media: at,
            selector: at ? at + " " + sel : sel,
            prop,
            value: m[2].trim(),
            size: prop === "font-size" ? m[2].trim() : fontShorthandSize(m[2]),
          });
        }
      }
    }
    i++;
  }
  return out;
}

function isLegal(decl) {
  const value = decl.size;
  if (!value) return false;
  if (/^var\(--text-/.test(value)) return true;
  if (/^var\(--icon-/.test(value)) return true;
  if (PASS_EXACT.has(value)) return true;
  if (PROSE_VALUE.test(value) && PROSE_SELECTOR.test(decl.selector)) return true;
  return false;
}

const pinKey = (file, selector, value) => file + "\u0000" + selector + "\u0000" + value;

function nearestStep(value) {
  let px = NaN;
  if (/px$/.test(value)) px = parseFloat(value);
  else if (/rem$/.test(value)) px = parseFloat(value) * ROOT_PX;
  else if (/em$/.test(value)) px = parseFloat(value) * ROOT_PX;
  if (!isFinite(px)) return { token: "?", px: NaN, delta: NaN };
  let best = null;
  for (const step of STEPS) {
    const stepPx = step.rem ? step.rem * ROOT_PX : 9;
    const delta = Math.abs(stepPx - px);
    if (!best || delta < best.delta) best = { token: step.token, px: stepPx, delta };
  }
  return best;
}

function violationLine(decl) {
  const near = nearestStep(decl.size);
  const delta = isFinite(near.delta) ? (near.delta < 0 ? "" : "+") + near.delta.toFixed(2) : "?";
  return decl.file.replace("static/css/", "") + ":" + decl.line +
    "  " + decl.selector +
    "  " + (decl.prop === "font" ? "font: " + decl.value : "font-size: " + decl.value) +
    "  nearest " + near.token + " (" + delta + ")";
}

/* ------------------------------------------------------------------ */
/* Run                                                                */
/* ------------------------------------------------------------------ */

const inventoryMode = process.argv.includes("--inventory");

console.log("== typography source check ==");

const parsed = [];
for (const file of CSS_FILES) {
  const css = stripComments(read(file));
  parsed.push(...declarations(css, file));
}

const literals = [];
let tokenised = 0;
for (const decl of parsed) {
  if (isLegal(decl)) tokenised++;
  else literals.push(decl);
}

const entries = new Map();
for (const entry of ALLOWLIST) {
  entries.set(pinKey(entry.file, entry.selector, entry.value), { entry, matches: 0 });
}

const unlisted = [];
const changed = [];
for (const decl of literals) {
  const hit = entries.get(pinKey(decl.file, decl.selector, decl.size));
  if (hit) {
    hit.matches++;
    continue;
  }
  const sameRule = ALLOWLIST.find((e) => e.file === decl.file && e.selector === decl.selector);
  if (sameRule) changed.push({ decl, pinned: sameRule.value });
  else unlisted.push(decl);
}

if (inventoryMode) {
  for (const decl of literals) console.log("  " + violationLine(decl));
}

check(
  "every literal is on the allowlist",
  unlisted.length === 0,
  unlisted.map(violationLine).join("\n         ")
);

check(
  "every allowlisted value is unchanged",
  changed.length === 0,
  changed
    .map((c) => violationLine(c.decl) + "  (pinned value: " + c.pinned + ")")
    .join("\n         ")
);

const stale = [...entries.values()].filter((e) => e.matches === 0);
check(
  "the allowlist has no stale entries",
  stale.length === 0,
  stale
    .map((e) => e.entry.file.replace("static/css/", "") + "  " + e.entry.selector +
      "  font-size: " + e.entry.value + "  (no declaration matches)")
    .join("\n         ")
);

check(
  "every allowlist entry is well formed",
  ALLOWLIST.every((e) =>
    CSS_FILES.includes(e.file) &&
    typeof e.selector === "string" && e.selector.length > 0 &&
    typeof e.value === "string" && e.value.length > 0 &&
    typeof e.why === "string" && e.why.length > 0 &&
    /^(phase \d|never)/.test(e.retires || "")),
  ALLOWLIST
    .filter((e) => !(CSS_FILES.includes(e.file) && e.selector && e.value && e.why && /^(phase \d|never)/.test(e.retires || "")))
    .map((e) => JSON.stringify(e))
    .join("\n         ")
);

/* -- the ratchet ---------------------------------------------------- */
let baseline = null;
try {
  baseline = JSON.parse(read(BASELINE_FILE));
} catch (err) {
  baseline = null;
}
check(
  "the ratchet baseline exists",
  !!baseline && typeof baseline.literals === "number",
  BASELINE_FILE + " is missing or has no `literals` count; it is the ratchet and must be committed"
);
if (baseline && typeof baseline.literals === "number") {
  check(
    "the literal count has not risen",
    literals.length <= baseline.literals,
    "baseline " + baseline.literals + ", found " + literals.length +
      " -- a new literal is a defect (docs/architecture/typography.md §2.4)"
  );
  check(
    "the baseline matches the literal count",
    literals.length === baseline.literals,
    "baseline " + baseline.literals + ", found " + literals.length +
      " -- lower " + BASELINE_FILE + " in the same commit that retires the literal"
  );
}

/* -- the token block ------------------------------------------------ */
const styleCss = stripComments(read("static/css/style.css"));
const tokenBlock = /:root\s*\{([\s\S]*?)\}/.exec(styleCss);
let steps = [];
if (tokenBlock && /--text-2xs\s*:/.test(tokenBlock[1])) {
  steps = [...tokenBlock[1].matchAll(/(--text-[a-z0-9-]+)\s*:\s*([^;]+);/g)]
    .map((m) => ({ token: m[1], value: m[2].trim() }));
} else {
  for (const m of styleCss.matchAll(/:root\s*\{([\s\S]*?)\}/g)) {
    if (/--text-2xs\s*:/.test(m[1])) {
      steps = [...m[1].matchAll(/(--text-[a-z0-9-]+)\s*:\s*([^;]+);/g)]
        .map((x) => ({ token: x[1], value: x[2].trim() }));
      break;
    }
  }
}
const expectedSteps = STEPS.map((s) => s.token + ": " + s.value).join("\n         ");
const actualSteps = steps.map((s) => s.token + ": " + s.value).join("\n         ");
check(
  "the :root block has exactly the seven documented steps, in order",
  steps.length === 7 && steps.every((s, i) => s.token === STEPS[i].token && s.value === STEPS[i].value),
  "expected:\n         " + expectedSteps + "\n         found:\n         " + actualSteps
);

/* -- JS must not write a font size (I6) ----------------------------- */
function walkJs(dir) {
  const out = [];
  for (const name of fs.readdirSync(path.join(PROJ, dir))) {
    const rel = dir + "/" + name;
    const abs = path.join(PROJ, rel);
    if (fs.statSync(abs).isDirectory()) out.push(...walkJs(rel));
    else if (name.endsWith(".js")) out.push(rel);
  }
  return out;
}

const WRITE_PATTERNS = [
  /\.style\.fontSize\s*=/,
  /\.style\[["']fontSize["']\]\s*=/,
  /\.style\.setProperty\(\s*["']font-size["']/,
  /["'`][^"'`]*font-size\s*:/,
  /fontSize\s*=\s*["'\d.]/,
];

const jsWrites = [];
for (const rel of walkJs(JS_DIR)) {
  const raw = read(rel);
  const src = stripComments(raw);
  src.split("\n").forEach((line, i) => {
    if (!/fontSize|font-size/i.test(line)) return;
    if (!WRITE_PATTERNS.some((re) => re.test(line))) return;
    const allowed = JS_ALLOWLIST.find((entry) =>
      entry.file === rel && (entry.fileWide || (entry.match && line.includes(entry.match)))
    );
    if (!allowed) jsWrites.push(rel + ":" + (i + 1) + "  " + line.trim());
  });
}
check(
  "no JS writes an element font size outside the documented exemptions",
  jsWrites.length === 0,
  jsWrites.join("\n         ")
);

/* -- browser suites must not inject a font size --------------------- */
function styleTagInjections() {
  const out = [];
  for (const name of fs.readdirSync(path.join(PROJ, BROWSER_DIR))) {
    if (!name.endsWith(".js")) continue;
    const rel = BROWSER_DIR + "/" + name;
    const src = stripComments(read(rel));
    const re = /addStyleTag\s*\(/g;
    let m;
    while ((m = re.exec(src))) {
      let depth = 1;
      let i = m.index + m[0].length;
      while (i < src.length && depth > 0) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")") depth--;
        i++;
      }
      const arg = src.slice(m.index, i);
      if (!/font-size|fontSize/i.test(arg)) continue;
      const allowed = STYLE_TAG_ALLOWLIST.some((e) => e.file === rel && arg.includes(e.match));
      if (!allowed) out.push(rel + ":" + lineAt(src, m.index) + "  " + arg.replace(/\s+/g, " ").slice(0, 120));
    }
  }
  return out;
}
const injections = styleTagInjections();
check(
  "browser suites inject no font size through addStyleTag",
  injections.length === 0,
  injections.join("\n         ")
);

/* -- summary -------------------------------------------------------- */
console.log("");
console.log("  " + ALLOWLIST.length + " literals allowlisted, " + tokenised + " tokenised (" +
  literals.length + " literal declarations, " + parsed.length + " size declarations)");
console.log("");
if (failed) {
  console.log("RESULT: FAIL  (" + passed + " ok, " + failed + " failed)");
  process.exit(1);
}
console.log("RESULT: PASS  (" + passed + " ok, 0 failed)");
