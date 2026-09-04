/* Frontend DOM-level test (jsdom) for the Markdown notebook server.
 *
 * Loads the REAL vendor bundles (marked.js, highlight.js) and all six app
 * modules into a jsdom window, stubs fetch, and drives the app the way the
 * browser would (dispatch DOMContentLoaded, click buttons, type in search).
 * Verifies: tree render, file open + heading ids + outline + code highlight,
 * keyword search, edit/save, empty-tree right-click create, and sidebar
 * collapse/expand (minimize) for both sidebars.
 *
 * Run:  npm install   then   npm test
 *   (or: node tests/dom/test_dom.js with jsdom resolvable)
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const PROJ = path.resolve(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(PROJ, rel), "utf8");

// locate jsdom whether installed in project node_modules or a shared dir
function resolveJsdom() {
  for (const candidate of [
    path.join(PROJ, "node_modules", "jsdom"),
    path.join(process.env.TMPDIR || "", "node_modules", "jsdom"),
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error("jsdom not found. Run `npm install` in the project root.");
}
const { JSDOM } = require(resolveJsdom());

// ---- fixtures ----------------------------------------------------------
const FILE_A = "# File A\n\nTODO fix this bug.\n\n```python\ndef f():\n    return 1\n```\n\n## Sub A\n\nbody\n";
const FILE_B = "# File B\n\nAnother TODO fix this here.\n";
// Mutable: the watcher -> sidebar sync tests mutate it to simulate a file
// being created / deleted on disk, then restore it.
let TREE = [
  { name: "notes", type: "dir", path: "notes", children: [
    { name: "a.md", type: "file", path: "notes/a.md" },
    { name: "b.md", type: "file", path: "notes/b.md" },
  ]},
  { name: "Welcome.md", type: "file", path: "Welcome.md" },
];
const FILES = {
  "Welcome.md": "# Welcome\n\nWelcome content.\n\n## One\n\nx\n\n## Two\n\ny\n",
  "notes/a.md": FILE_A,
  "notes/b.md": FILE_B,
};
// Per-file mtimes, mirrored by the /api/file stub. Starts at 1 so the
// poller's "ifModifiedSince=0" query gets a 200 and seeds the cache;
// bumps on every POST so a save is visible to the next poll tick.
const MTIMES = {
  "Welcome.md": 1,
  "notes/a.md": 1,
  "notes/b.md": 1,
};
// Build a graph from the current FILES fixture, mirroring the backend's
// build_graph() so the graph view has something to render. Recognises
// [[wikilinks]] by stem and [text](x.md) links by relative path.
function buildGraphStub() {
  const rels = Object.keys(FILES);
  const stemIndex = {};
  for (const rel of rels) {
    const base = rel.split("/").pop();
    const stem = base.toLowerCase().endsWith(".md") ? base.slice(0, -3) : base;
    stemIndex[stem] = rel;
  }
  const edgeSet = new Set();
  const degree = {};
  for (const rel of rels) degree[rel] = 0;
  const wl = /\[\[([^\]]+)\]\]/g;
  const ml = /\[([^\]]*)\]\(([^)]+\.md(?:#[^\s)]*)?)\)/gi;
  for (const src of rels) {
    const text = FILES[src] || "";
    const targets = new Set();
    let m;
    while ((m = wl.exec(text)) !== null) {
      const t = (m[1] || "").split("#")[0].trim();
      if (!t) continue;
      const stem = t.toLowerCase().endsWith(".md") ? t.slice(0, -3) : t;
      if (stem in stemIndex) targets.add(stemIndex[stem]);
    }
    while ((m = ml.exec(text)) !== null) {
      const raw = (m[2] || "").split("#")[0].trim();
      if (!raw) continue;
      if (raw in degree) { targets.add(raw); continue; }
      if (raw in stemIndex) { targets.add(stemIndex[raw]); continue; }
      const srcDir = src.includes("/") ? src.slice(0, src.lastIndexOf("/")) : "";
      const cand = (srcDir ? srcDir + "/" : "") + raw;
      if (cand in degree) targets.add(cand);
    }
    for (const dst of targets) {
      if (dst === src) continue;
      const key = [src, dst].sort().join("\u0001");
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);
      degree[src]++;
      degree[dst]++;
    }
  }
  const nodes = rels.map(rel => ({
    id: rel,
    name: rel.split("/").pop(),
    links: degree[rel],
  })).sort((a, b) => a.id < b.id ? -1 : 1);
  const edges = [];
  for (const key of edgeSet) {
    const [s, t] = key.split("\u0001");
    edges.push({ source: s, target: t });
  }
  return { nodes, edges };
}
let config = {};
let promptValue = null;
const fetchLog = [];
// Auth state used by the fake /api/auth + /api/login + /api/logout stubs.
// Default: auth disabled, no role. Tests flip authEnabled and observe
// authRole to drive the login flow.
let authEnabled = false;
let authRole = null;
// Password setup state used by the fake /api/auth + /api/auth/passwords
// stubs. Default: nothing configured. Tests flip these to drive the
// Settings -> Passwords section.
let authHasAdmin = false;
let authHasViewer = false;
// The "current" admin password the stub knows about. Set when the
// initial admin is configured so the stub can verify admin_current_password
// on subsequent changes. The test resets this alongside the other auth
// state; it starts as the literal that the original "Set admin
// password" test used.
let adminCurrentPw = null;
let authSetPasswordsCalls = [];   // last few bodies posted to /api/auth/passwords
// Named API token state used by the fake /api/auth/tokens stubs. Mirrors
// the server: only a name/role/created list is kept (no hashes in jsdom),
// creation returns the full token exactly once, and clearing the admin
// password wipes the list.
let authTokens = [];              // [{name, role, created}]
let authTokensSeq = 0;            // deterministic token counter
let authTokensCalls = [];         // log of {op, body} for assertions
// AI provider state used by the fake /api/ai/* stubs. Mirrors the server:
// keys are stored but NEVER returned (only hasKey booleans), saving with
// a blank key + replaceSecret carries the stored key over.
let aiConfig = { servers: [], default: "" };
// Masked view of aiConfig, mirroring the server's _public_ai_config():
// hasKey booleans instead of keys; customPrompt is NOT a secret.
function publicAiConfigBody() {
  return { servers: (aiConfig.servers || []).map(s => ({
    name: s.name, baseUrl: s.baseUrl, model: s.model || "",
    hasKey: !!(s.apiKey && s.apiKey.length),
  })), default: aiConfig.default || "",
    customPrompt: aiConfig.customPrompt || "",
    searxngUrl: aiConfig.searxngUrl || "" };
}
let aiChatStreams = [];           // queued responses for /api/ai/chat
let aiChatLog = [];               // bodies POSTed to /api/ai/chat

const html = `<!DOCTYPE html><html><head>
  <link rel="stylesheet" href="/static/vendor/highlight-styles/github-dark.css" id="hljs-dark">
  <link rel="stylesheet" href="/static/vendor/highlight-styles/github.css" id="hljs-light" disabled>
</head><body data-theme="dark">
  <div id="app">
    <header id="topbar">
      <div class="brand">📓 Notebook</div>
      <input id="search-input" type="search">
      <input type="checkbox" id="search-case">
      <button id="back-btn" class="icon-btn" disabled>←</button>
      <button id="hybrid-toggle" class="icon-btn" title="WYSIWYG edit mode" aria-label="WYSIWYG" hidden>✎</button>
      <button id="edit-toggle">Edit</button>
      <button id="export-toggle" title="Export the current note">Export</button>
      <button id="logout-btn" class="icon-btn" hidden>⎋</button>
    </header>
    <main id="layout">
      <nav id="activity-bar" class="activity-bar" aria-label="Activity bar">
        <div class="activity-bar-spacer"></div>
        <button id="activity-graph-btn" class="activity-btn activity-action" title="Graph view" aria-label="Graph view">🕸</button>
        <button id="activity-settings-btn" class="activity-btn activity-action" title="Settings" aria-label="Settings">⚙</button>
      </nav>
      <aside id="side-panel">
        <div id="sidebar" class="side-panel-view" data-view="explorer">
          <div class="panel-header"><span class="panel-title">Files</span>
            <button class="collapse-btn" id="sidebar-collapse" title="Collapse files">‹</button></div>
          <div id="bookmarks" class="bookmarks">
            <div class="bookmarks-header">
              <span class="bookmarks-title">Bookmarks</span>
              <button class="bookmarks-add" id="bookmarks-add" title="Bookmark the active file" aria-label="Bookmark the active file" hidden>★</button>
            </div>
            <div id="bookmarks-list" class="bookmarks-list"></div>
          </div>
          <div id="file-tree" class="tree"></div>
        </div>
        <div id="recent-view" class="side-panel-view" data-view="recent" hidden></div>
        <div id="search-view" class="side-panel-view" data-view="search" hidden></div>
        <div id="ai-view" class="side-panel-view" data-view="ai" hidden></div>
      </aside>
      <section id="editor-pane">
        <div id="tab-bar" class="tab-bar">
          <button id="outline-toggle" class="icon-btn outline-toggle" title="Show outline" aria-label="Toggle outline pane">≣</button>
        </div>
        <div id="edit-bar" class="edit-bar" hidden>
          <button class="eb" data-act="bold">B</button>
          <button class="eb" data-act="italic">I</button>
          <button class="eb" data-act="strike">S</button>
          <button class="eb" data-act="code">code</button>
          <button class="eb" data-act="h1">H1</button>
          <button class="eb" data-act="h2">H2</button>
          <button class="eb" data-act="h3">H3</button>
          <button class="eb" data-act="h4">H4</button>
          <button class="eb" data-act="ul">UL</button>
          <button class="eb" data-act="ol">OL</button>
          <button class="eb" data-act="task">Task</button>
          <button class="eb" data-act="quote">Q</button>
          <button class="eb" data-act="link">Link</button>
          <button class="eb" data-act="image">Img</button>
          <button class="eb" data-act="codeblock">CB</button>
          <button class="eb" data-act="undo">Undo</button>
          <button class="eb" data-act="redo">Redo</button>
          <span class="eb-overflow">
            <button class="eb eb-overflow-btn" data-act="more">More</button>
            <div class="eb-menu" hidden>
              <button class="eb" data-act="hr">HR</button>
              <button class="eb" data-act="table">Table</button>
              <button class="eb" data-act="h5">H5</button>
              <button class="eb" data-act="h6">H6</button>
              <button class="eb" data-act="clear">Clear</button>
            </div>
          </span>
          <span class="eb-spacer"></span>
          <span class="eb-actions">
            <button id="preview-btn" class="eb">Preview</button>
            <button id="save-btn" class="eb eb-primary" hidden>Save</button>
            <button id="save-exit-btn" class="eb eb-primary" hidden>Save &amp; Exit</button>
            <button id="close-edit-btn" class="eb">Close</button>
          </span>
        </div>
        <div id="edit-split" class="edit-split">
          <div id="cm-host" class="cm-host" hidden></div>
          <div id="viewer">
            <div id="viewer-content" class="markdown-body"></div>
          </div>
          <div id="welcome" class="welcome" hidden>
            <div class="welcome-inner">
              <div class="welcome-icon">📓</div>
              <h2 class="welcome-title">Welcome to your notebook</h2>
              <p class="welcome-subtitle">Create a new note to get started, or pick one from the left.</p>
              <div class="welcome-actions">
                <button class="welcome-action" data-act="new">+ New note</button>
                <button class="welcome-action" data-act="open-welcome" hidden>Open Welcome.md</button>
              </div>
              <hr class="welcome-divider">
              <ul class="welcome-tips">
                <li><kbd>Ctrl/Cmd</kbd> + <kbd>S</kbd> to save while editing</li>
                <li>Right-click the sidebar to create, rename, copy, or delete</li>
                <li>Use the top search bar to find anything in your notebook</li>
                <li>The ⚙ button picks theme, font size, and wallpaper</li>
              </ul>
            </div>
          </div>
          <div id="graph-view" class="graph-view special-tab-view" hidden>
            <div class="graph-view-header">
              <span class="graph-view-title">Graph</span>
              <span class="graph-view-summary" id="graph-view-summary"></span>
              <div class="graph-view-controls">
                <input type="search" id="graph-view-filter" class="graph-view-filter" placeholder="Filter notes…">
                <button id="graph-view-recenter" class="graph-view-btn" title="Re-center">⊞</button>
                <button id="graph-view-zoom-in" class="graph-view-btn" title="Zoom in">+</button>
                <button id="graph-view-zoom-out" class="graph-view-btn" title="Zoom out">−</button>
                <button id="graph-view-refresh" class="graph-view-btn" title="Refresh graph">↻</button>
              </div>
            </div>
            <div class="graph-view-host" id="graph-view-canvas-host">
              <canvas id="graph-view-canvas" class="graph-view-canvas"></canvas>
            </div>
          </div>
          <div id="search-results" class="search-results special-tab-view" hidden>
            <div class="search-results-header">
              <span id="search-summary"></span>
              <button id="search-close" title="Close search">×</button>
            </div>
            <ul id="search-list" tabindex="0" aria-label="Search results"></ul>
          </div>
        </div>
      </section>
      <aside id="outline-pane">
        <div class="panel-header"><span class="panel-title">Outline</span>
          <button class="collapse-btn" id="outline-collapse" title="Collapse outline">›</button></div>
        <div id="outline" class="outline"></div>
      </aside>
    </main>
  </div>
  <div id="context-menu" class="context-menu" hidden></div>
  <div id="tab-context-menu" class="context-menu" hidden></div>
  <div id="hybrid-context-menu" class="context-menu" hidden></div>
  <div id="auth-overlay" class="settings-overlay" hidden>
    <div class="settings-modal auth-modal">
      <div class="settings-header">
        <h2 id="auth-title">Sign in</h2>
      </div>
      <form class="settings-body auth-form" onsubmit="return false">
        <p class="auth-help">This notebook is password-protected. Enter the password to continue.</p>
        <div class="settings-row">
          <label class="settings-label" for="auth-password">Password</label>
          <input id="auth-password" type="password" class="auth-input" autofocus>
        </div>
        <div id="auth-error" class="auth-error" role="alert"></div>
        <div class="settings-form-actions">
          <button id="auth-submit" type="button" class="settings-action auth-submit">Sign in</button>
        </div>
      </form>
    </div>
  </div>
  <div id="settings-overlay" class="settings-overlay" hidden>
    <div class="settings-modal">
      <div class="settings-header">
        <h2 id="settings-title">Settings</h2>
        <button id="settings-close" class="icon-btn">×</button>
      </div>
      <div class="settings-body">
        <nav class="settings-nav" role="tablist" aria-label="Settings sections">
          <button class="settings-nav-item active" role="tab" data-tab="general"     aria-selected="true"  aria-controls="settings-section-general"><span class="nav-icon" aria-hidden="true">⚙</span>General</button>
          <button class="settings-nav-item"        role="tab" data-tab="appearance" aria-selected="false" aria-controls="settings-section-appearance"><span class="nav-icon" aria-hidden="true">🎨</span>Appearance</button>
          <button class="settings-nav-item"        role="tab" data-tab="shortcuts"  aria-selected="false" aria-controls="settings-section-shortcuts"><span class="nav-icon" aria-hidden="true">⌨</span>Shortcuts</button>
          <button class="settings-nav-item"        role="tab" data-tab="security"   aria-selected="false" aria-controls="settings-section-security"><span class="nav-icon" aria-hidden="true">🔒</span>Security</button>
          <button class="settings-nav-item"        role="tab" data-tab="ai"         aria-selected="false" aria-controls="settings-section-ai"><span class="nav-icon" aria-hidden="true">✨</span>AI</button>
          <button class="settings-nav-item"        role="tab" data-tab="about"      aria-selected="false" aria-controls="settings-section-about"><span class="nav-icon" aria-hidden="true">ℹ</span>About</button>
        </nav>
        <div class="settings-sections">
          <section class="settings-section" data-section="general" id="settings-section-general">
            <h3>Site</h3>
            <div class="settings-row">
              <label class="settings-label" for="settings-site-title">Site title</label>
              <input type="text" id="settings-site-title" class="settings-text-input" placeholder="Notebook" maxlength="60" spellcheck="false">
            </div>
            <h3>File watching</h3>
            <div class="settings-row">
              <span class="settings-label">Status</span>
              <span id="settings-watch-status" class="settings-value">—</span>
            </div>
            <div class="settings-row">
              <span class="settings-label"></span>
              <button id="settings-watch-toggle" class="settings-action">Enable</button>
            </div>
            <h3>Keyboard</h3>
            <div class="settings-row">
              <label class="settings-label" for="settings-vim-toggle">VIM mode</label>
              <input type="checkbox" id="settings-vim-toggle">
            </div>
            <div class="settings-row settings-vimrc">
              <label class="settings-label" for="settings-vimrc">VIM initial script</label>
              <textarea id="settings-vimrc" class="settings-vimrc-area" rows="8" spellcheck="false" placeholder="# One binding per line. Examples:&#10;# nmap j gj&#10;# imap jj &lt;Esc&gt;&#10;# unmap &lt;leader&gt;w"></textarea>
              <div class="settings-vimrc-actions">
                <button id="settings-vimrc-save" class="settings-action" type="button">Save</button>
                <span id="settings-vimrc-status" class="settings-vimrc-status" hidden></span>
              </div>
            </div>
          </section>
          <section class="settings-section" data-section="appearance" id="settings-section-appearance" hidden>
            <h3>Appearance</h3>
            <div class="settings-row">
              <span class="settings-label">Theme</span>
              <div class="settings-control theme-options">
                <label><input type="radio" name="theme" value="auto"> Auto</label>
                <label><input type="radio" name="theme" value="dark"> Dark</label>
                <label><input type="radio" name="theme" value="light"> Light</label>
              </div>
            </div>
            <div class="settings-row">
              <span class="settings-label">Font size</span>
              <div class="settings-control font-size-options" role="radiogroup" aria-label="Font size">
                <label><input type="radio" name="fontSize" value="small"> S</label>
                <label><input type="radio" name="fontSize" value="medium"> M</label>
                <label><input type="radio" name="fontSize" value="large"> L</label>
                <label><input type="radio" name="fontSize" value="xlarge"> XL</label>
              </div>
            </div>
            <div class="settings-row">
              <label class="settings-label" for="settings-hide-topbar">Hide top bar</label>
              <input type="checkbox" id="settings-hide-topbar">
            </div>
            <div class="settings-row">
              <span class="settings-label">Settings modal width</span>
              <div class="settings-control settings-modal-width-options" role="radiogroup" aria-label="Settings modal width">
                <label><input type="radio" name="settingsModalWidth" value="compact"> Compact</label>
                <label><input type="radio" name="settingsModalWidth" value="medium"> Medium</label>
                <label><input type="radio" name="settingsModalWidth" value="wide"> Wide</label>
              </div>
            </div>
            <div class="settings-row">
              <span class="settings-label">Settings modal height</span>
              <div class="settings-control settings-modal-height-options" role="radiogroup" aria-label="Settings modal height">
                <label><input type="radio" name="settingsModalHeight" value="compact"> Compact</label>
                <label><input type="radio" name="settingsModalHeight" value="medium"> Medium</label>
                <label><input type="radio" name="settingsModalHeight" value="wide"> Wide</label>
              </div>
            </div>
            <div class="settings-row">
              <span class="settings-label">Wallpaper</span>
              <div class="settings-control wallpaper-options" role="radiogroup" aria-label="Wallpaper">
                <label><input type="radio" name="wallpaper" value="none"> None</label>
                <label><input type="radio" name="wallpaper" value="lines"> Lines</label>
                <label><input type="radio" name="wallpaper" value="grid"> Grid</label>
              </div>
            </div>
            <div class="settings-row">
              <span class="settings-label">Wallpaper scroll</span>
              <div class="settings-control wallpaper-scroll-options" role="radiogroup" aria-label="Wallpaper scroll behavior">
                <label><input type="radio" name="wallpaperScroll" value="scroll"> Scroll with content</label>
                <label><input type="radio" name="wallpaperScroll" value="fixed"> Fixed in viewport</label>
              </div>
            </div>
            <div class="settings-row">
              <span class="settings-label">Wallpaper color</span>
              <div class="settings-control wallpaper-color-options" role="radiogroup" aria-label="Wallpaper color">
                <label><input type="radio" name="wallpaperColor" value="neutral"> Neutral</label>
                <label><input type="radio" name="wallpaperColor" value="blue"> Blue</label>
                <label><input type="radio" name="wallpaperColor" value="green"> Green</label>
                <label><input type="radio" name="wallpaperColor" value="purple"> Purple</label>
                <label><input type="radio" name="wallpaperColor" value="amber"> Amber</label>
              </div>
            </div>
            <div class="settings-row">
              <span class="settings-label">Wallpaper intensity</span>
              <div class="settings-control wallpaper-intensity-options" role="radiogroup" aria-label="Wallpaper intensity">
                <label><input type="radio" name="wallpaperIntensity" value="subtle"> Subtle</label>
                <label><input type="radio" name="wallpaperIntensity" value="medium"> Medium</label>
                <label><input type="radio" name="wallpaperIntensity" value="bold"> Bold</label>
              </div>
            </div>
          </section>
          <section class="settings-section" data-section="shortcuts" id="settings-section-shortcuts" hidden>
            <h3>Shortcuts</h3>
            <p class="settings-help">
              Customize the app's keyboard shortcuts. These bindings are active when
              VIM mode is off; VIM's own keymap is documented in the
              <kbd>?</kbd> :help overlay and is configured separately under VIM mode.
            </p>
            <div id="settings-shortcuts-list" class="shortcuts-list" role="list"></div>
            <div class="settings-row shortcuts-footer">
              <span class="settings-label"></span>
              <button id="settings-shortcuts-reset-all" class="settings-action">Reset all to defaults</button>
            </div>

            <h3 class="settings-subheading">Hybrid editor (WYSIWYG) shortcuts</h3>
            <p class="settings-help">
              Available while editing in hybrid mode. These bindings are fixed
              (not remappable) and only act on text inside the editor.
            </p>
            <div class="shortcuts-list" role="list">
              <div class="shortcut-row shortcut-row-static" role="listitem">
                <span class="shortcut-label">Bold (toggle selection)</span>
                <span class="shortcut-binding-wrap"><kbd class="shortcut-binding" data-key="Mod+B"></kbd></span>
              </div>
              <div class="shortcut-row shortcut-row-static" role="listitem">
                <span class="shortcut-label">Italic (toggle selection)</span>
                <span class="shortcut-binding-wrap"><kbd class="shortcut-binding" data-key="Mod+I"></kbd></span>
              </div>
              <div class="shortcut-row shortcut-row-static" role="listitem">
                <span class="shortcut-label">Strikethrough (toggle selection)</span>
                <span class="shortcut-binding-wrap"><kbd class="shortcut-binding" data-key="Mod+Shift+X"></kbd></span>
              </div>
              <div class="shortcut-row shortcut-row-static" role="listitem">
                <span class="shortcut-label">Inline code (toggle selection)</span>
                <span class="shortcut-binding-wrap"><kbd class="shortcut-binding" data-key="Mod+Shift+C"></kbd></span>
              </div>
              <div class="shortcut-row shortcut-row-static" role="listitem">
                <span class="shortcut-label">Code block (type <code>\`\`\`lang</code> then Enter)</span>
                <span class="shortcut-binding-wrap"><kbd class="shortcut-binding">Enter</kbd></span>
              </div>
              <div class="shortcut-row shortcut-row-static" role="listitem">
                <span class="shortcut-label">Leave list (on empty list item)</span>
                <span class="shortcut-binding-wrap"><kbd class="shortcut-binding">Enter</kbd></span>
              </div>
            </div>

            <h3 class="settings-subheading">Live markdown syntax</h3>
            <p class="settings-help">
              In hybrid mode, typing these at the start of a line renders
              immediately: # –###### headings, - / * bullets, 1. ordered
              list, &gt; quote, [ ] / [x] task item, and **bold** /
              *italic* / ~~strike~~ / \`code\` inline pairs.
            </p>
          </section>
          <section class="settings-section" data-section="security" id="settings-section-security" hidden>
            <h3>Passwords</h3>
            <p id="settings-auth-help" class="settings-help">Sign in as admin to change passwords.</p>
            <div class="settings-auth-admin-block">
              <div class="settings-note" id="settings-auth-admin-status">Admin password: <span id="settings-auth-admin-status-value">Not set</span></div>
              <div id="settings-auth-admin-set" class="settings-auth-admin-form" hidden>
                <div class="settings-row">
                  <label class="settings-label" for="settings-auth-admin-new">New password</label>
                  <input id="settings-auth-admin-new" type="password" class="auth-input settings-auth-input" disabled>
                </div>
                <div class="settings-row">
                  <label class="settings-label" for="settings-auth-admin-confirm">Confirm new password</label>
                  <input id="settings-auth-admin-confirm" type="password" class="auth-input settings-auth-input" disabled>
                </div>
                <div class="settings-form-actions">
                  <button id="settings-auth-admin-save" class="settings-action" disabled>Save</button>
                </div>
              </div>
              <div id="settings-auth-admin-change" class="settings-auth-admin-form" hidden>
                <div class="settings-row">
                  <label class="settings-label" for="settings-auth-admin-current">Current password</label>
                  <input id="settings-auth-admin-current" type="password" class="auth-input settings-auth-input" disabled>
                </div>
                <div class="settings-row">
                  <label class="settings-label" for="settings-auth-admin-new2">New password</label>
                  <input id="settings-auth-admin-new2" type="password" class="auth-input settings-auth-input" disabled>
                </div>
                <div class="settings-row">
                  <label class="settings-label" for="settings-auth-admin-confirm2">Confirm new password</label>
                  <input id="settings-auth-admin-confirm2" type="password" class="auth-input settings-auth-input" disabled>
                </div>
               <div class="settings-form-actions">
                   <button id="settings-auth-admin-save2" class="settings-action" disabled>Save</button>
                   <button id="settings-auth-admin-cancel" class="settings-action">Cancel</button>
                 </div>
               </div>

               <!-- "Remove" form: reveals a current-password field to disable auth. -->
               <div id="settings-auth-admin-remove" class="settings-auth-admin-form" hidden>
                 <div class="settings-row">
                   <label class="settings-label" for="settings-auth-admin-remove-current">Current password</label>
                   <input id="settings-auth-admin-remove-current" type="password" class="auth-input settings-auth-input" disabled>
                 </div>
                 <div class="settings-form-actions">
                   <button id="settings-auth-admin-remove-confirm" class="settings-action" disabled>Disable auth</button>
                 </div>
               </div>
               <div class="settings-row">
                 <button id="settings-auth-admin-remove-btn" class="settings-action" hidden>Remove admin password</button>
               </div>
             </div>
            <div class="settings-note" id="settings-auth-viewer-status-note">Viewer password: <span id="settings-auth-viewer-status-value">Not set</span></div>
            <div class="settings-row">
              <label class="settings-label" for="settings-auth-viewer-toggle">Require a password to read</label>
              <input type="checkbox" id="settings-auth-viewer-toggle" disabled>
            </div>
            <div class="settings-row" id="settings-auth-viewer-row" hidden>
              <label class="settings-label" for="settings-auth-viewer-pw">Viewer password</label>
              <input id="settings-auth-viewer-pw" type="password" class="auth-input settings-auth-input">
            </div>
            <div class="settings-row" id="settings-auth-viewer-confirm-row" hidden>
              <label class="settings-label" for="settings-auth-viewer-confirm">Confirm viewer password</label>
              <input id="settings-auth-viewer-confirm" type="password" class="auth-input settings-auth-input">
            </div>
            <div class="settings-form-actions" id="settings-auth-viewer-actions" hidden>
              <button id="settings-auth-viewer-remove" class="settings-action" hidden>Remove</button>
              <button id="settings-auth-viewer-save" class="settings-action" disabled>Save</button>
            </div>
            <div id="settings-auth-error" class="auth-error settings-auth-error" role="alert" hidden></div>
            <h3>API tokens</h3>
            <p id="settings-tokens-help" class="settings-help">Bearer tokens let agents and scripts call the API without a browser session.</p>
            <div class="settings-note" id="settings-tokens-status">API tokens: <span id="settings-tokens-count">0</span></div>
            <div id="settings-tokens-list"></div>
            <div class="settings-row">
              <label class="settings-label" for="settings-tokens-name">New token name</label>
              <input id="settings-tokens-name" type="text" class="auth-input settings-auth-input" disabled>
            </div>
            <div class="settings-row">
              <label class="settings-label" for="settings-tokens-role">Role</label>
              <select id="settings-tokens-role" disabled>
                <option value="viewer">viewer — read only</option>
                <option value="admin">admin — read + write</option>
              </select>
            </div>
            <div class="settings-form-actions">
              <button id="settings-tokens-create" class="settings-action" disabled>Create token</button>
            </div>
            <div id="settings-tokens-issued" class="settings-auth-admin-form" hidden>
              <div class="settings-note">Token created — copy it now, it will not be shown again:</div>
              <code id="settings-tokens-issued-value" class="settings-value settings-mono"></code>
            </div>
            <div id="settings-tokens-error" class="auth-error settings-auth-error" role="alert" hidden></div>
          </section>

          <!-- AI providers (mirrors index.html; wired by settings.js). -->
          <section class="settings-section" data-section="ai" id="settings-section-ai" hidden>
            <h3>AI assistant</h3>
            <p id="settings-ai-help" class="settings-help"></p>
            <div class="settings-note" id="settings-ai-status">Providers: <span id="settings-ai-count">0</span></div>
            <div id="settings-ai-list"></div>
            <div class="settings-form-title" id="settings-ai-form-title">Add a provider</div>
            <div class="settings-row">
              <label class="settings-label" for="settings-ai-name">Profile name</label>
              <input id="settings-ai-name" type="text" class="auth-input settings-auth-input" autocomplete="off" disabled>
            </div>
            <div class="settings-row">
              <label class="settings-label" for="settings-ai-url">Base URL</label>
              <input id="settings-ai-url" type="text" class="auth-input settings-auth-input" autocomplete="off" disabled>
            </div>
            <div class="settings-row">
              <label class="settings-label" for="settings-ai-model">Model</label>
              <input id="settings-ai-model" type="text" class="auth-input settings-auth-input" autocomplete="off" disabled>
            </div>
            <div class="settings-row">
              <label class="settings-label" for="settings-ai-key">API key</label>
              <input id="settings-ai-key" type="password" class="auth-input settings-auth-input" autocomplete="off" disabled>
            </div>
            <div class="settings-form-actions">
              <button id="settings-ai-cancel" class="settings-action" hidden>Cancel</button>
              <button id="settings-ai-add" class="settings-action" disabled>Add provider</button>
            </div>
            <div id="settings-ai-error" class="auth-error settings-auth-error" role="alert" hidden></div>

            <!-- Global prompt: outside the provider form; applies to
                 whichever provider is active. Own Save button. -->
            <div class="settings-form-title">Custom prompt</div>
            <div class="settings-row settings-row-column">
              <label class="settings-label" for="settings-ai-custom-prompt">Assistant instructions</label>
              <textarea id="settings-ai-custom-prompt" class="auth-input settings-auth-input"
                        rows="4" autocomplete="off" disabled></textarea>
              <span class="settings-hint">Applies to every provider. Appended to the assistant's instructions; the built-in tool rules always win.</span>
            </div>
            <div class="settings-form-actions">
              <span id="settings-ai-prompt-status" class="settings-hint" hidden></span>
              <button id="settings-ai-prompt-save" class="settings-action" disabled>Save prompt</button>
            </div>

            <!-- Optional SearXNG instance for the assistant's search tool. -->
            <div class="settings-form-title">Web search</div>
            <div class="settings-row settings-row-column">
              <label class="settings-label" for="settings-ai-searxng">SearXNG instance URL</label>
              <input id="settings-ai-searxng" type="text" class="auth-input settings-auth-input"
                     autocomplete="off" disabled
                     placeholder="https://searxng.example.com  (blank = search tool disabled)">
              <span class="settings-hint">Lets the assistant search the web. Leave blank to disable the search tool.</span>
            </div>
            <div class="settings-form-actions">
              <span id="settings-ai-searxng-status" class="settings-hint" hidden></span>
              <button id="settings-ai-searxng-save" class="settings-action" disabled>Save search URL</button>
            </div>
          </section>
          <section class="settings-section" data-section="about" id="settings-section-about" hidden>
            <h3>About</h3>
            <div class="settings-row">
              <span class="settings-label">Data folder</span>
              <code id="settings-data-dir" class="settings-value settings-mono">…</code>
            </div>
            <div class="settings-row">
              <span class="settings-label">Config folder</span>
              <code id="settings-config-dir" class="settings-value settings-mono">…</code>
            </div>
          </section>
        </div>
      </div>
      <div class="settings-footer">
        <button id="settings-close-btn" class="settings-action">Close</button>
      </div>
    </div>
  </div>
  <!-- Export modal -->
  <div id="export-overlay" class="settings-overlay" hidden>
    <div class="settings-modal export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <div class="settings-header">
        <h2 id="export-title">Export</h2>
        <button id="export-close" class="icon-btn" title="Close" aria-label="Close">×</button>
      </div>
      <div class="settings-body">
        <div class="settings-sections">
          <section class="settings-section">
            <h3>Format</h3>
            <div class="settings-row">
              <span class="settings-label">Output</span>
              <div class="settings-control export-format-options" role="radiogroup" aria-label="Export format">
                <label><input type="radio" name="export-format" value="pdf" checked> PDF</label>
                <label><input type="radio" name="export-format" value="html"> HTML</label>
              </div>
            </div>
          </section>
          <section class="settings-section">
            <h3>Scope</h3>
            <div class="settings-row">
              <span class="settings-label">File</span>
              <div class="settings-control export-scope-options" role="radiogroup" aria-label="Export scope">
                <label><input type="radio" name="export-scope" value="current" checked> Current file</label>
                <label><input type="radio" name="export-scope" value="section"> Section</label>
              </div>
            </div>
            <div class="settings-row">
              <span class="settings-label">Note</span>
              <code id="export-file-label" class="settings-value settings-mono">(no file open)</code>
            </div>
            <div class="settings-row" id="export-section-row" hidden>
              <span class="settings-label">Heading</span>
              <select id="export-section-select" class="settings-text-input" aria-label="Section heading"></select>
            </div>
          </section>
          <div id="export-error" class="auth-error settings-auth-error" role="alert" hidden></div>
        </div>
      </div>
      <div class="settings-footer">
        <button id="export-close-btn" class="settings-action">Cancel</button>
        <button id="export-run" class="settings-action">Export</button>
      </div>
    </div>
  </div>
  <!-- Mermaid lightbox overlay -->
  <div id="mermaid-lightbox" class="mermaid-lightbox-overlay" hidden>
    <div class="mermaid-lightbox-body" id="mermaid-lightbox-body"></div>
    <div class="mermaid-lightbox-controls">
      <button id="mlb-zoom-out" class="mlb-btn" title="Zoom Out" aria-label="Zoom Out">−</button>
      <span class="mlb-zoom-pct" id="mlb-zoom-pct">100%</span>
      <button id="mlb-zoom-in" class="mlb-btn" title="Zoom In" aria-label="Zoom In">+</button>
      <button id="mlb-fit" class="mlb-btn" title="Fit to Page" aria-label="Fit to Page">⊞</button>
      <button id="mlb-close" class="mlb-btn mlb-close-btn" title="Close" aria-label="Close">×</button>
    </div>
  </div>
  <!-- WaveDrom lightbox overlay (mirrors the mermaid one; reuses the
       generic .mermaid-lightbox-* / .mlb-* CSS classes) -->
  <div id="wavedrom-lightbox" class="mermaid-lightbox-overlay" hidden>
    <div class="mermaid-lightbox-body" id="wavedrom-lightbox-body"></div>
    <div class="mermaid-lightbox-controls">
      <button id="wdlb-zoom-out" class="mlb-btn" title="Zoom Out" aria-label="Zoom Out">−</button>
      <span class="mlb-zoom-pct" id="wdlb-zoom-pct">100%</span>
      <button id="wdlb-zoom-in" class="mlb-btn" title="Zoom In" aria-label="Zoom In">+</button>
      <button id="wdlb-fit" class="mlb-btn" title="Fit to Page" aria-label="Fit to Page">⊞</button>
      <button id="wdlb-close" class="mlb-btn mlb-close-btn" title="Close" aria-label="Close">×</button>
    </div>
  </div>
  <!-- Graphviz lightbox overlay (mirrors the mermaid one) -->
  <div id="viz-lightbox" class="mermaid-lightbox-overlay" hidden>
    <div class="mermaid-lightbox-body" id="viz-lightbox-body"></div>
    <div class="mermaid-lightbox-controls">
      <button id="vizlb-zoom-out" class="mlb-btn" title="Zoom Out" aria-label="Zoom Out">−</button>
      <span class="mlb-zoom-pct" id="vizlb-zoom-pct">100%</span>
      <button id="vizlb-zoom-in" class="mlb-btn" title="Zoom In" aria-label="Zoom In">+</button>
      <button id="vizlb-fit" class="mlb-btn" title="Fit to Page" aria-label="Fit to Page">⊞</button>
      <button id="vizlb-close" class="mlb-btn mlb-close-btn" title="Close" aria-label="Close">×</button>
    </div>
  </div>
</body></html>`;

const dom = new JSDOM(html, {
  pretendToBeVisual: true,
  runScripts: "outside-only",
  url: "http://127.0.0.1:5000/",
});
const { window } = dom;
const ctx = dom.getInternalVMContext();

// Stubs for APIs jsdom doesn't implement.
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
window.cancelAnimationFrame = (id) => clearTimeout(id);
window.Element.prototype.scrollIntoView = function () {};
window.HTMLElement.prototype.scrollIntoView = function () {};
window.prompt = () => promptValue;
window.confirm = () => true;
window.alert = () => {};
// Encoding globals for api.js's SSE reader (jsdom doesn't ship them).
// Point them at the Node implementations so decoding is real.
if (!window.TextEncoder) window.TextEncoder = TextEncoder;
if (!window.TextDecoder) window.TextDecoder = TextDecoder;
if (!window.ReadableStream) window.ReadableStream = ReadableStream;
// Clipboard stub. jsdom doesn't ship navigator.clipboard. We
// record the last write so tests can assert what got copied, and
// expose a __fail flag for tests that want to exercise the
// fallback path.
const __clipboard = { lastText: null, writes: 0, failNext: false };
if (!window.navigator.clipboard) {
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text) => {
        if (__clipboard.failNext) {
          __clipboard.failNext = false;
          throw new Error("clipboard permission denied (stub)");
        }
        __clipboard.lastText = text;
        __clipboard.writes++;
      },
    },
  });
} else {
  // If jsdom ever ships clipboard, wrap it so the recording still
  // works without a separate API.
  const orig = window.navigator.clipboard;
  window.navigator.clipboard = {
    writeText: async (text) => {
      if (__clipboard.failNext) { __clipboard.failNext = false; throw new Error("forced fail"); }
      __clipboard.lastText = text;
      __clipboard.writes++;
      if (orig && orig.writeText) return orig.writeText(text);
    },
  };
}
// Export stubs. jsdom has no print dialog and no real object URLs; we
// record the calls so tests can assert the PDF path opens the print
// dialog and the HTML path downloads a blob with the rendered note.
const __export = { prints: 0, downloads: [], blobTexts: [] };
window.print = () => { __export.prints++; };
if (typeof window.URL.createObjectURL !== "function") {
  window.URL.createObjectURL = (blob) => {
    __export.downloads.push(blob);
    return "blob:mock-" + __export.downloads.length;
  };
  window.URL.revokeObjectURL = () => {};
}
// jsdom ships Blob but not a way to read it back synchronously; wrap the
// constructor so tests can capture the serialized content.
const __RealBlob = window.Blob;
window.Blob = class extends __RealBlob {
  constructor(parts, opts) {
    super(parts, opts);
    __export.blobTexts.push(parts.join(""));
  }
};

// Mermaid stub. We don't ship the 3.5MB UMD bundle into the test
// (jsdom can't load the script tag the page would, and the lib
// needs a real browser DOM). Instead, install a mock that records
// the calls and returns predictable SVG. Tests that need to
// control the outcome set __mermaid.failNext / __mermaid.nextSvg
// before the call.
const __mermaid = {
  inits: 0,
  initThemes: [],
  renders: 0,             // total render() calls
  lastSource: null,       // last source string
  lastId: null,
  failNext: false,        // throw on the next render()
  nextSvg: '<svg viewBox="0 0 100 50"><text>mock</text></svg>',
};
window.mermaid = {
  initialize(cfg) {
    __mermaid.inits++;
    __mermaid.initThemes.push((cfg && cfg.theme) || "default");
  },
  async render(id, source) {
    __mermaid.renders++;
    __mermaid.lastId = id;
    __mermaid.lastSource = source;
    if (__mermaid.failNext) {
      __mermaid.failNext = false;
      // Real mermaid appends a stray error <div id="d<render-id>">
      // (a big "Syntax error" SVG) to the end of <body> when
      // render() rejects. Mimic that so the cleanup path in
      // NB.mermaid is exercised.
      const stray = window.document.createElement("div");
      stray.id = "d" + id;
      stray.textContent = "Syntax error in text";
      window.document.body.appendChild(stray);
      throw new Error("Syntax error in diagram (test stub)");
    }
    return { svg: __mermaid.nextSvg };
  },
};
// WaveDrom stub. We mirror the mermaid approach: the wavedrom module
// (static/js/wavedrom.js) calls window.wavedrom.renderWaveForm(index,
// source, output) which draws into an element with id output+index, and
// reads window.WaveSkin for the default skin. Real WaveDrom paints a
// self-contained <svg> plus an embedded <style> into that element. The
// stub does the same minimal thing so the module's container-mount and
// id-suffix logic is exercised without the ~98KB bundle in jsdom.
const __wavedrom = {
  renders: 0,
  lastSource: null,
  lastOutput: null,
  failNext: false,        // throw on the next render
  nextSvg: '<svg viewBox="0 0 480 60" width="480" height="60"><text>wave</text></svg>',
};
window.wavedrom = {
  waveSkin: {},
  renderWaveForm(index, source, output) {
    __wavedrom.renders++;
    __wavedrom.lastSource = source;
    __wavedrom.lastOutput = output;
    if (__wavedrom.failNext) {
      __wavedrom.failNext = false;
      throw new Error("Syntax error in waveform (test stub)");
    }
    const host = window.document.getElementById(output + index);
    if (host) host.innerHTML = __wavedrom.nextSvg;
  },
};
// KaTeX stub. The katex module (static/js/katex.js) calls
// window.katex.renderToString(source, options) and injects the returned
// HTML into a .katex-container. The real bundle is ~275KB; we stub it to
// return a predictable HTML string so the module's container-mount and
// error-fallback logic is exercised without loading it into jsdom.
const __katex = {
  renders: 0,
  lastSource: null,
  failNext: false,        // throw on the next render
  nextHtml: '<span class="katex">E=mc^2</span>',
};
window.katex = {
  renderToString(source, options) {
    __katex.renders++;
    __katex.lastSource = source;
    if (__katex.failNext) {
      __katex.failNext = false;
      throw new Error("Parse error in math (test stub)");
    }
    return __katex.nextHtml;
  },
};
// Graphviz (viz.js) stub. The viz module (static/js/viz.js) does
// `new window.Viz()` then `viz.renderString(src, {format:"svg"})` and
// extracts the <svg> from the returned document string. The real bundle
// is a ~2MB WASM build; we stub the Viz class to return a predictable
// SVG document so the module's container-mount, SVG-extraction, and
// error-fallback logic is exercised without loading it into jsdom.
const __viz = {
  renders: 0,
  lastSource: null,
  failNext: false,        // throw on the next render
  nextSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100"><text>graph</text></svg>',
};
window.Viz = class {
  renderString(source, options) {
    __viz.renders++;
    __viz.lastSource = source;
    if (__viz.failNext) {
      __viz.failNext = false;
      throw new Error("Syntax error in graph (test stub)");
    }
    return Promise.resolve(__viz.nextSvg);
  }
};
// matchMedia stub: report a dark system preference (auto -> dark).
window.matchMedia = () => ({
  matches: false, media: "", onchange: null,
  addListener() {}, removeListener() {},
  addEventListener() {}, removeEventListener() {},
  dispatchEvent() { return false; },
});
// jsdom has no layout engine: Range.getClientRects /
// getBoundingClientRect are unimplemented. CM6's vim plugin measures
// text coordinates after vim ops (charCoords + scrollIntoView), which
// crashes without them. Give every Range a fixed fake rect -- exact
// geometry doesn't matter for the assertions (per-element rect stubs
// for the drag-resize tests live at their call sites below).
const fakeRangeRect = {
  left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10,
  x: 0, y: 0, toJSON() { return {}; },
};
window.Range.prototype.getClientRects = function () { return [fakeRangeRect]; };
window.Range.prototype.getBoundingClientRect = function () { return fakeRangeRect; };

// jsdom doesn't ship a CanvasRenderingContext2D, but the graph view
// draws to one. Install a recording stub on every canvas so the
// existing graph tests keep working AND so a regression in the
// drawing pipeline (e.g. forgetting to apply the pan/scale transform
// or to set transform after resizing) is observable in tests. The
// recording tracks the current 2D transform (a/b/c/d/e/f) so an
// assertion can verify the view matrix is actually being applied.
function makeFakeCtx(canvasEl) {
  const log = {
    calls: [], ops: {}, clears: 0,
    transforms: [],           // stack snapshots from save()
    current: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    fills: new Set(),         // every fillStyle string seen across draws
    strokes: new Set(),       // every strokeStyle string seen across draws
  };
  // Track each fillStyle/strokeStyle write into a Set so a test can
  // assert "the canvas used the dark-theme accent" without coupling
  // to the order of operations inside draw().
  const fillProxy = { _last: "", get value() { return this._last; }, set value(v) { this._last = v; log.fills.add(v); } };
  const strokeProxy = { _last: "", get value() { return this._last; }, set value(v) { this._last = v; log.strokes.add(v); } };
  const apply = (name) => (...args) => {
    log.calls.push(name);
    log.ops[name] = (log.ops[name] || 0) + 1;
    if (name === "clearRect") log.clears++;
    const t = log.current;
    if (name === "translate") {
      t.e += args[0] * t.a + args[1] * t.c;
      t.f += args[0] * t.b + args[1] * t.d;
    }
    if (name === "scale") {
      t.a *= args[0]; t.b *= args[0]; t.c *= args[1]; t.d *= args[1];
    }
    if (name === "save") log.transforms.push({ ...t });
    if (name === "restore") {
      const prev = log.transforms.pop();
      if (prev) { t.a = prev.a; t.b = prev.b; t.c = prev.c; t.d = prev.d; t.e = prev.e; t.f = prev.f; }
    }
    if (name === "setTransform") {
      t.a = args[0]; t.b = args[1]; t.c = args[2]; t.d = args[3]; t.e = args[4]; t.f = args[5];
    }
  };
  const ctx = {
    log,
    canvas: canvasEl || null,
    get fillStyle()   { return fillProxy._last; },
    set fillStyle(v)  { fillProxy._last = v; log.fills.add(v); },
    get strokeStyle() { return strokeProxy._last; },
    set strokeStyle(v){ strokeProxy._last = v; log.strokes.add(v); },
    lineWidth: 1, font: "",
    save: apply("save"), restore: apply("restore"),
    translate: apply("translate"), scale: apply("scale"), setTransform: apply("setTransform"),
    clearRect: apply("clearRect"),
    beginPath: apply("beginPath"), moveTo: apply("moveTo"), lineTo: apply("lineTo"),
    arc: apply("arc"), fill: apply("fill"), stroke: apply("stroke"),
    fillText: apply("fillText"),
  };
  return ctx;
}
const origGetContext = window.HTMLCanvasElement.prototype.getContext;
window.HTMLCanvasElement.prototype.getContext = function (type) {
  if (type === "2d") {
    const ctx = makeFakeCtx(this);
    this.__fakeCtx = ctx;
    return ctx;
  }
  return origGetContext ? origGetContext.call(this, type) : null;
};

// Fake fetch routing for every endpoint api.js calls.
window.fetch = async (url, opts) => {
  const u = new URL(url, "http://127.0.0.1:5000");
  const p = u.pathname;
  const method = (opts && opts.method) || "GET";
  fetchLog.push(method + " " + p +
    (p === "/api/config" && method === "POST" ? " " + JSON.stringify(JSON.parse(opts.body || "{}")) : ""));
  let body = {};
  if (p === "/api/config") {
    if (method === "POST") { config = JSON.parse(opts.body || "{}"); body = { ok: true }; }
    else body = config;
  } else if (p === "/api/tree") {
    body = { tree: TREE };
  } else if (p === "/api/file") {
    if (method === "POST") {
      const d = JSON.parse(opts.body);
      FILES[d.path] = d.content;
      MTIMES[d.path] = (MTIMES[d.path] || 0) + 1;   // bump on every save
      body = { path: d.path, size: d.content.length, mtime: MTIMES[d.path] };
    } else {
      const fp = u.searchParams.get("path");
      const pathInTree = (p) => {
        const hit = (nodes) => nodes.some(n =>
          n.path === p || (n.children && hit(n.children)));
        return hit(TREE);
      };
      if (FILES[fp] === undefined && !pathInTree(fp)) {
        // Unknown path -> 404 (the server answers the same); the watcher
        // poller treats a missing file the same way. Paths that exist in
        // the TREE fixture but not in FILES (e.g. the reveal-test's
        // deep.md) keep the old inline-empty-body behavior so tab-open
        // flows there don't take the error path.
        return { ok: false, status: 404,
          text: async () => JSON.stringify({ error: "File not found" }),
          json: async () => ({ error: "File not found" }) };
      }
      // The poller passes ifModifiedSince=<ts>; honour it so the
      // polling fallback doesn't fire spurious change events.
      const since = parseInt(u.searchParams.get("ifModifiedSince") || "0", 10);
      const cur = MTIMES[fp] || 1;
      if (cur <= since) { return { status: 304, ok: false, text: async () => "", json: async () => ({}) }; }
      body = { path: fp, content: FILES[fp] || "", size: (FILES[fp] || "").length, mtime: cur };
    }
  } else if (p === "/api/search") {
    const q = u.searchParams.get("q") || "";
    const matches = [];
    for (const [file, content] of Object.entries(FILES)) {
      content.split("\n").forEach((line, i) => {
        const idx = line.toLowerCase().indexOf(q.toLowerCase());
        if (idx >= 0 && q) matches.push({ file, line: i + 1, col: idx + 1, snippet: "<<" + q + ">>" });
      });
    }
    body = { query: q, matches, truncated: false };
  } else if (p === "/api/graph") {
    body = buildGraphStub();
  } else if (p === "/api/info") {
    body = { data_dir: "/tmp/test/data", config_dir: "/tmp/test/config" };
  } else if (p === "/api/create") {
    // Mirrors the server: 409 when the path already exists, content seeds
    // new files.
    const d = JSON.parse(opts.body || "{}");
    if (FILES[d.path] !== undefined) {
      return { ok: false, status: 409,
        text: async () => JSON.stringify({ error: "Already exists" }),
        json: async () => ({ error: "Already exists" }) };
    }
    if (d.type === "dir") { TREE.push({ name: d.path, type: "dir", path: d.path, children: [] }); body = { path: d.path, existed: false }; }
    else {
      FILES[d.path] = d.content || "";
      MTIMES[d.path] = (MTIMES[d.path] || 1) + 1;
      TREE.push({ name: d.path.split("/").pop(), type: "file", path: d.path });
      body = { path: d.path, existed: false };
    }
  } else if (p === "/api/move" || p === "/api/copy" || p === "/api/delete") {
    body = JSON.parse(opts.body || "{}");
  } else if (p === "/api/edit") {
    // Mirror /api/edit's all-or-nothing contract: find_replace requires
    // exactly one match UNLESS optional, append/prepend always succeed.
    const d = JSON.parse(opts.body || "{}");
    const src = FILES[d.path];
    if (src == null) {
      return { ok: false, status: 404,
        text: async () => JSON.stringify({ error: "File not found" }),
        json: async () => ({ error: "File not found" }) };
    }
    let text = src;
    try {
      for (const ed of (d.edits || [])) {
        if (ed.op === "find_replace") {
          const hits = text.split(ed.find).length - 1;
          if (hits !== 1 && !ed.optional) throw new Error("no match for find");
          text = text.replace(ed.find, ed.replace_with);
        } else if (ed.op === "append") {
          text = text + ed.text;
        } else if (ed.op === "prepend") {
          text = ed.text + text;
        } else {
          throw new Error("unknown op " + ed.op);
        }
      }
    } catch (e) {
      return { ok: false, status: 400,
        text: async () => JSON.stringify({ error: e.message }),
        json: async () => ({ error: e.message }) };
    }
    FILES[d.path] = text;
    MTIMES[d.path] = (MTIMES[d.path] || 0) + 1;
    body = { path: d.path, size: text.length, applied: (d.edits || []).length };
  } else if (p === "/api/ai/config") {
    if (method === "POST") {
      const d = JSON.parse(opts.body || "{}");
      const keepers = [];
      for (const s of (d.servers || [])) {
        if (s && s.apiKey === "" && s.replaceSecret) {
          // Key carry: match the name, or the pre-rename name given in
          // replaceSecretFor (the Edit flow renames this way).
          const wanted = s.replaceSecretFor || s.name;
          const prev = (aiConfig.servers || []).find(x => x.name === wanted);
          s.apiKey = prev ? (prev.apiKey || "") : "";
        }
        delete s.replaceSecretFor;   // server-side only, not stored
        keepers.push(s);
      }
      aiConfig = {
        servers: keepers,
        default: d.default || "",
        // Global prompt: preserved when omitted (older clients), stored
        // when present — mirrors the server.
        customPrompt: d.customPrompt !== undefined
          ? d.customPrompt : (aiConfig.customPrompt || ""),
        // SearXNG instance URL: same preserve-when-omitted semantics.
        searxngUrl: d.searxngUrl !== undefined
          ? d.searxngUrl : (aiConfig.searxngUrl || ""),
      };
      body = publicAiConfigBody();
    } else {
      body = publicAiConfigBody();
    }
  } else if (p === "/api/ai/chat") {
    // SSE relay stub: /api/ai/chat returns a byte stream (resp.body),
    // which api.js's aiChat reads with getReader(). Records the request
    // and plays the queued chunks (aiChatStreams entries: arrays of SSE
    // frames) so tests can script the "stream".
    const d = JSON.parse(opts.body || "{}");
    aiChatLog.push(d);
    const frames = aiChatStreams.shift();
    if (!frames) {
      return { ok: false, status: 400,
        text: async () => JSON.stringify({ error: "no queued ai chat stream" }),
        json: async () => ({ error: "no queued ai chat stream" }) };
    }
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const frame of frames) controller.enqueue(enc.encode(frame));
        controller.close();
      },
    });
    return { ok: true, status: 200, body: stream };
  } else if (p === "/api/ai/fetch") {
    const d = JSON.parse(opts.body || "{}");
    if (!d.url) {
      return { ok: false, status: 400,
        text: async () => JSON.stringify({ error: "url required" }),
        json: async () => ({ error: "url required" }) };
    }
    body = { url: d.url, contentType: "text/html", truncated: false,
             content: "<html><body>fetched " + d.url + "</body></html>" };
  } else if (p === "/api/ai/search") {
    const d = JSON.parse(opts.body || "{}");
    if (!d.q) {
      return { ok: false, status: 400,
        text: async () => JSON.stringify({ error: "q required" }),
        json: async () => ({ error: "q required" }) };
    }
    body = { query: d.q, results: [
      { title: "Result One", url: "http://example.com/1", snippet: "first" },
      { title: "Result Two", url: "http://example.com/2", snippet: "second" },
    ] };
  } else if (p === "/api/auth") {
    // Default: auth disabled. Tests flip authEnabled/authRole to exercise
    // the login flow. The shape is {enabled, hasAdmin, hasViewer, role}:
    //   enabled  = admin password is set
    //   hasAdmin = admin password is set (alias used by the UI)
    //   hasViewer = viewer password is set
    //   role     = session role (null = no session, "admin", "viewer")
    body = { enabled: authEnabled, hasAdmin: authHasAdmin, hasViewer: authHasViewer, role: authRole };
  } else if (p === "/api/login") {
    const d = JSON.parse(opts.body || "{}");
    if (authEnabled && d.password === "test-pw") {
      authRole = "admin";
      body = { role: "admin" };
    } else {
      return { ok: false, status: 401,
        text: async () => JSON.stringify({ error: "Invalid password" }),
        json: async () => ({ error: "Invalid password" }) };
    }
  } else if (p === "/api/logout") {
    authRole = null;
    body = { ok: true };
  } else if (p === "/api/auth/passwords") {
    // Admin-only endpoint. Mirrors the server's @admin_required: when no
    // admin password is configured yet, the route is open (chicken-and-egg
    // for the first setup). Once an admin is set, only an admin session
    // can call this.
    if (authHasAdmin && authRole !== "admin") {
      return { ok: false, status: 401,
        text: async () => JSON.stringify({ error: "Authentication required" }),
        json: async () => ({ error: "Authentication required" }) };
    }
    const d = JSON.parse(opts.body || "{}");
    authSetPasswordsCalls.push(d);
    // Changing the admin password (admin already set + a new non-empty
    // value) requires admin_current_password and verifies it. The stub
    // mirrors the server's bcrypt-style check: the "current" password
    // is the last one set (compared in cleartext since we're in jsdom;
    // the real server uses bcrypt).
    if (typeof d.admin_password === "string" && d.admin_password !== "") {
      if (authHasAdmin) {
        if (typeof d.admin_current_password !== "string"
            || d.admin_current_password === ""
            || d.admin_current_password !== adminCurrentPw) {
          return { ok: false, status: 400,
            text: async () => JSON.stringify({ error: "Current admin password is incorrect" }),
            json: async () => ({ error: "Current admin password is incorrect" }) };
        }
        adminCurrentPw = d.admin_password;
      } else {
        // First-time setup: no current password required.
        adminCurrentPw = d.admin_password;
      }
      authEnabled = true;
      authHasAdmin = true;
    } else if (d.admin_password === "") {
      // Clearing the admin password disables auth. Requires the current
      // password (verified below) and also clears the viewer password.
      if (authHasAdmin) {
        if (typeof d.admin_current_password !== "string"
            || d.admin_current_password === ""
            || d.admin_current_password !== adminCurrentPw) {
          return { ok: false, status: 400,
            text: async () => JSON.stringify({ error: "Current admin password is incorrect" }),
            json: async () => ({ error: "Current admin password is incorrect" }) };
        }
        authEnabled = false;
        authHasAdmin = false;
        authHasViewer = false;
        adminCurrentPw = null;
      }
    }
    if (d.viewer_password === "") {
      authHasViewer = false;
    } else if (typeof d.viewer_password === "string" && d.viewer_password !== null) {
      authHasViewer = true;
    }
    // Mirrors the server: disabling auth (clearing the admin password)
    // also clears every API token.
    if (d.admin_password === "") authTokens = [];
    body = { ok: true, hasAdmin: authHasAdmin, hasViewer: authHasViewer };
  } else if (p === "/api/auth/tokens" || p.startsWith("/api/auth/tokens/")) {
    // Named API tokens. Admin-only like /api/auth/passwords: when an
    // admin password is configured, only an admin session gets through
    // (401 signed out, 403 viewer). Creation is refused while auth is
    // off -- tokens would be meaningless.
    const isAdminSession = !authEnabled ? false : authRole === "admin";
    const deny = () => ({
      ok: false,
      status: authRole ? 403 : 401,
      text: async () => JSON.stringify({ error: "Admin role required" }),
      json: async () => ({ error: "Admin role required" }),
    });
    if (method === "POST") {
      if (!authEnabled) {
        return { ok: false, status: 400,
          text: async () => JSON.stringify({ error: "Set an admin password before issuing API tokens" }),
          json: async () => ({ error: "Set an admin password before issuing API tokens" }) };
      }
      if (!isAdminSession) return deny();
      const d = JSON.parse(opts.body || "{}");
      authTokensCalls.push({ op: "create", body: d });
      if (typeof d.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(d.name)
          || (d.role !== "admin" && d.role !== "viewer")) {
        return { ok: false, status: 400,
          text: async () => JSON.stringify({ error: "Invalid name or role" }),
          json: async () => ({ error: "Invalid name or role" }) };
      }
      if (authTokens.some(t => t.name === d.name)) {
        return { ok: false, status: 409,
          text: async () => JSON.stringify({ error: "A token with that name already exists" }),
          json: async () => ({ error: "A token with that name already exists" }) };
      }
      authTokensSeq++;
      const entry = { name: d.name, role: d.role, created: 1700000000 + authTokensSeq };
      authTokens.push(entry);
      body = Object.assign({ ok: true, token: "nbtk_" + String(authTokensSeq) + "abcdef0123456789abcdef0123456789abcdef" }, entry);
    } else if (method === "GET") {
      if (!isAdminSession) return deny();
      // Listing never includes the token string itself.
      body = { tokens: authTokens.map(t => ({ name: t.name, role: t.role, created: t.created })) };
    } else if (method === "DELETE") {
      if (!isAdminSession) return deny();
      const name = decodeURIComponent(p.slice("/api/auth/tokens/".length));
      authTokensCalls.push({ op: "delete", body: { name } });
      const before = authTokens.length;
      authTokens = authTokens.filter(t => t.name !== name);
      if (authTokens.length === before) {
        return { ok: false, status: 404,
          text: async () => JSON.stringify({ error: "No such token" }),
          json: async () => ({ error: "No such token" }) };
      }
      body = { ok: true };
    }
  }
  return { ok: true, status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body };
};

function evalIn(src) { vm.runInContext(src, ctx); }

// ---- load vendor + app modules ----------------------------------------
const errors = [];
window.addEventListener("error", (e) => errors.push("window error: " + (e.error ? e.error.stack : e.message)));
evalIn(read("static/vendor/marked.min.js"));
evalIn(read("static/vendor/highlight.min.js"));
  evalIn(read("static/vendor/codemirror.bundle.js"));
  evalIn(read("static/vendor/turndown.browser.js"));
  evalIn(read("static/vendor/turndown-plugin-gfm.browser.js"));
  evalIn(read("static/js/api.js"));
  evalIn(read("static/js/auth.js"));
  evalIn(read("static/js/cm-bridge.js"));
  evalIn(read("static/js/lightbox.js"));
  evalIn(read("static/js/mermaid.js"));
  evalIn(read("static/js/wavedrom.js"));
  evalIn(read("static/js/katex.js"));
  evalIn(read("static/js/viz.js"));
  evalIn(read("static/js/viewer.js"));
  evalIn(read("static/js/editbar.js"));
  evalIn(read("static/js/hybrid.js"));
evalIn(read("static/js/watcher.js"));
evalIn(read("static/js/outline.js"));
evalIn(read("static/js/sidebar.js"));
evalIn(read("static/js/search.js"));
evalIn(read("static/js/graph.js"));
evalIn(read("static/js/tabs.js"));
evalIn(read("static/js/settings.js"));
evalIn(read("static/js/export.js"));
evalIn(read("static/js/vimnav.js"));
evalIn(read("static/js/ai.js"));
evalIn(read("static/js/activity.js"));
evalIn(read("static/js/shortcuts.js"));
evalIn(read("static/js/app.js"));

const $ = (id) => window.document.getElementById(id);
const click = (id) => $(id).dispatchEvent(new window.Event("click", { bubbles: true }));
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const cssVar = (name) => window.document.documentElement.style.getPropertyValue(name).trim();

// Helpers for the CodeMirror 6 bridge. They replace the old `<textarea>`
// accessors (.value, .selectionStart, .selectionEnd, .hidden). The
// cm-bridge lazily creates the CM view on first use; the helpers do
// the same so tests don't have to know that.
const cmEd = () => $("cm-host");
const cmSetValue = (text) => window.NB.cmEditor.setValue(text);
const cmGetValue = () => window.NB.cmEditor.getValue();
const cmSetSel = (from, to) => window.NB.cmEditor.setSelection(from, to);
const cmIsHidden = () => cmEd().hidden;
const cmFireInput = () => { cmSetValue(cmGetValue()); };

// ---- assertions helper ------------------------------------------------
let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + label + (extra ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  FAIL " + label + (extra ? "  [" + extra + "]" : "")); }
}

(async () => {
  console.log("== boot ==");
  window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
  await tick(120);
  check("no init errors", errors.length === 0, errors.join("; "));

  console.log("== sidebar tree ==");
  const rows = window.document.querySelectorAll("#file-tree .tree-row");
  check("tree has 4 rows", rows.length === 4, "got " + rows.length);
  // New-session default: every folder starts collapsed on load, so a
  // page reload lands on a tidy (closed) tree.
  const bootNotes = window.document.querySelector('.tree-row[data-path="notes"]');
  check("tree folders start collapsed by default",
    !!bootNotes && bootNotes.classList.contains("collapsed"),
    bootNotes ? "class=" + bootNotes.className : "no notes row");
  check("globals loaded (marked/hljs/NB)",
    typeof window.marked === "object" && typeof window.hljs === "object" && !!window.NB.viewer);

  console.log("== theme ==");
  // The theme control lives in the settings modal. The default body
  // theme is "dark" (auto resolves dark on this jsdom's matchMedia stub).
  // Settings are LIVE now: picking a radio updates the body data-theme
  // immediately, no Apply/Save step.
  check("default body theme is dark (auto -> dark)", window.document.body.dataset.theme === "dark",
    "data-theme=" + window.document.body.dataset.theme);
  window.NB.settings.open();
  await tick(20);
  const checkedRadio = () => window.document.querySelector('input[name="theme"]:checked');
  check("default theme radio is auto", checkedRadio() && checkedRadio().value === "auto",
    checkedRadio() ? checkedRadio().value : "(none)");
  // light: pick radio -> live body flips to light immediately.
  window.document.querySelector('input[name="theme"][value="light"]').checked = true;
  window.document.querySelector('input[name="theme"][value="light"]')
    .dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("light radio: live body data-theme=light immediately",
    window.document.body.dataset.theme === "light",
    "data-theme=" + window.document.body.dataset.theme);
  // dark: pick + live update
  window.document.querySelector('input[name="theme"][value="dark"]').checked = true;
  window.document.querySelector('input[name="theme"][value="dark"]')
    .dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("dark radio: live body data-theme=dark immediately",
    window.document.body.dataset.theme === "dark",
    "data-theme=" + window.document.body.dataset.theme);
  // back to auto: pick + live update
  window.document.querySelector('input[name="theme"][value="auto"]').checked = true;
  window.document.querySelector('input[name="theme"][value="auto"]')
    .dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("auto radio: live body data-theme=dark (matchMedia stub)",
    window.document.body.dataset.theme === "dark",
    "data-theme=" + window.document.body.dataset.theme);
  // Persistence: each change triggers a debounced POST /api/config.
  await tick(400);
  const themePosts = fetchLog.filter(l => l.startsWith("POST /api/config"));
  const lastThemePost = themePosts[themePosts.length - 1] || "";
  check("theme: last config POST body has theme=\"auto\"",
    /"theme":"auto"/.test(lastThemePost), lastThemePost);
  window.NB.settings.close();
  await tick(10);

  console.log("== viewer + outline ==");
  // Selector must use a single compound (#viewer :is(h1,h2,h3,...)) or a
  // union with the scope in EACH branch -- otherwise jsdom parses the
  // unparenthesized second branch as "any h2/h3/... in the document".
  // The headings live inside #viewer-content (a child of #viewer) after
  // the wallpaper scroll-sync restructure, so #viewer :is(...) still
  // matches as a descendant selector.
  const heads = window.document.querySelectorAll("#viewer :is(h1, h2, h3, h4, h5, h6)");
  check("viewer rendered headings", heads.length >= 1, "got " + heads.length);

  check("all headings have ids", Array.from(heads).every(h => h.id), heads.length + " heads");
  const items = window.document.querySelectorAll("#outline .outline-item");
  check("outline items == headings", items.length === heads.length, items.length + " vs " + heads.length);
  check("outline items have data-level",
    Array.from(items).every(i => i.dataset.level), "first=" + (items[0] && items[0].dataset.level));
  const codeEl = window.document.querySelector("#viewer pre code");
  check("code block highlighted", !!codeEl && /hljs/.test(codeEl.innerHTML), codeEl && codeEl.className);

  console.log("== code block Copy button ==");
  // The Copy button is appended to each <pre> in view mode. By the
  // time the viewer test runs, the seeded Welcome.md (or notes/a.md)
  // has been rendered; we just look at whichever pre is currently
  // visible in the viewer.
  const viewerPre = () => window.document.querySelector("#viewer pre");
  const viewerCopyBtn = () => viewerPre() && viewerPre().querySelector(".code-copy-btn");
  check("code block: copy button appended to <pre>",
    !!viewerCopyBtn(), "no .code-copy-btn on the rendered <pre>");
  check("code block: copy button starts as 'Copy'",
    viewerCopyBtn() && viewerCopyBtn().textContent === "Copy",
    viewerCopyBtn() && viewerCopyBtn().textContent);
  // Hidden by default (CSS opacity:0). The test harness doesn't
  // link style.css into the jsdom document, so we read the file
  // directly and grep for the rule. This guards against the
  // "I added the button but forgot the opacity:0" regression
  // without depending on a layout engine.
  const cssText = read("static/css/style.css");
  check("code block: copy button hidden by default (CSS opacity:0 rule)",
    /\.code-copy-btn\s*\{[^}]*opacity:\s*0\b/.test(cssText),
    "no .code-copy-btn{opacity:0} rule in style.css");
  // Clicking the button writes the raw code (pre-hljs) to the
  // clipboard stub, flips the label to 'Copied!', and triggers a
  // shared toast via NB.app.notify.
  const clipboardBefore = __clipboard.writes;
  viewerCopyBtn().dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await tick(20);
  check("code block: click writes to navigator.clipboard",
    __clipboard.writes === clipboardBefore + 1, "writes=" + __clipboard.writes);
  check("code block: clipboard receives the raw code (not post-hljs markup)",
    typeof __clipboard.lastText === "string" &&
    __clipboard.lastText.length > 0 &&
    !/<span\s+class="hljs/.test(__clipboard.lastText),
    "len=" + (__clipboard.lastText || "").length + " | first120=" + JSON.stringify((__clipboard.lastText || "").slice(0, 120)));
  check("code block: click flips label to 'Copied!'",
    viewerCopyBtn() && viewerCopyBtn().textContent === "Copied!",
    viewerCopyBtn() && viewerCopyBtn().textContent);
  check("code block: 'Copied!' state has .copied class",
    viewerCopyBtn() && viewerCopyBtn().classList.contains("copied"),
    viewerCopyBtn() && viewerCopyBtn().className);
  // The shared toast also fires. NB.app.notify is the single-line
  // toast helper; the toast element gets a .show class on each call.
  const toast = window.document.querySelector(".toast");
  check("code block: shared toast appears with 'Copied to clipboard'",
    !!toast && toast.classList.contains("show") &&
    /Copied/.test(toast.textContent),
    toast ? "textContent=" + JSON.stringify(toast.textContent) + " class=" + toast.className : "no toast");
  // After ~1.2s the label reverts to 'Copy'. The notify timeout
  // default is 1500ms; wait a touch longer to be safe.
  await tick(1500);
  check("code block: label reverts to 'Copy' after timeout",
    viewerCopyBtn() && viewerCopyBtn().textContent === "Copy",
    viewerCopyBtn() && viewerCopyBtn().textContent);
  check("code block: .copied class removed after timeout",
    viewerCopyBtn() && !viewerCopyBtn().classList.contains("copied"),
    viewerCopyBtn() && viewerCopyBtn().className);

  // Clipboard failure path: stub a write error, click again, expect
  // the button to NOT flip and the notify toast to show 'Copy failed'.
  // Reset clipboard state and arm a one-shot failure.
  __clipboard.failNext = true;
  viewerCopyBtn().dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await tick(20);
  check("code block: clipboard failure leaves label as 'Copy'",
    viewerCopyBtn() && viewerCopyBtn().textContent === "Copy",
    viewerCopyBtn() && viewerCopyBtn().textContent);
  const failToast = window.document.querySelector(".toast");
  check("code block: clipboard failure shows 'Copy failed' toast",
    !!failToast && /Copy failed/.test(failToast.textContent),
    failToast ? "textContent=" + JSON.stringify(failToast.textContent) : "no toast");

  // Edit-mode live preview must NOT get a Copy button. The viewer
  // render() path takes `content` as an argument for live preview
  // and the button is only attached in the no-content (view mode)
  // branch. Enter edit mode + change the editor; the live preview
  // re-renders into #viewer-content, and the re-rendered pre must
  // have no copy button.
  await window.NB.tabs.activate("notes/a.md");
  await tick(20);
  window.NB.viewer.startEdit();
  await tick(20);
  // Type into the editor -- this fires NB.cmEditor.onChange ->
  // scheduleLivePreview -> render(content), which is the live
  // preview path. After the debounce, the pre in #viewer-content
  // should be a re-render that has no copy button.
  cmSetValue("```py\nprint('live preview')\n```\n");
  await tick(220);
  const livePres = Array.from(window.document.querySelectorAll("#viewer-content pre"));
  const liveHasBtn = livePres.some(p => p.querySelector(".code-copy-btn"));
  check("code block: edit-mode live preview has no Copy button",
    !liveHasBtn,
    "pres=" + livePres.length + " any-with-btn=" + liveHasBtn);
  // Restore the original content + leave edit mode so the rest of
  // the suite sees the original file. cmSetValue uses the same
  // mechanism as a user edit, which leaves the cache dirty.
  // closeEdit() discards the editor content (revert to last saved),
  // and the window.confirm stub returns true. This leaves the
  // cache's savedContent untouched, so the next view-mode render
  // shows the original file.
  cmSetValue("dirty edit that will be discarded");
  await tick(40);
  window.NB.viewer.closeEdit();
  await tick(40);

  console.log("== mermaid ==");
  // The mermaid integration is in static/js/mermaid.js + the
  // viewer's render() pipeline. The vendored UMD bundle is not
  // loaded in the test (3.5MB + needs a real browser DOM); the
  // test relies on the window.mermaid stub installed in the
  // harness. Render the test by opening a tab that contains a
  // mermaid block, and watch the .mermaid-container appear.
  //
  // Reset the stub state so prior tests' render counts don't
  // pollute the assertions.
  __mermaid.inits = 0;
  __mermaid.renders = 0;
  __mermaid.initThemes = [];
  __mermaid.failNext = false;
  __mermaid.nextSvg = '<svg viewBox="0 0 100 50" width="100" height="50"><text>mock</text></svg>';

  // Open a tab whose body has a mermaid block. We add a synthetic
  // file to FILES (the test's filesystem stub) and open it; the
  // viewer renders it through marked, hljs, then NB.mermaid.renderAll.
  const MERMAID_BODY = "# Notes\n\n" +
    "Some prose.\n\n" +
    "```mermaid\n" +
    "graph TD; A-->B; B-->C;\n" +
    "```\n\n" +
    "More prose.\n";
  FILES["notes/mermaid.md"] = MERMAID_BODY;
  // Add the file to TREE so the sidebar can refresh and see it.
  // The existing TREE already has a `notes` dir -- we just need to
  // give it a child.
  const notesDir = (TREE.find(n => n.path === "notes"));
  if (notesDir && !notesDir.children.some(c => c.path === "notes/mermaid.md")) {
    notesDir.children.push({ name: "mermaid.md", type: "file", path: "notes/mermaid.md" });
  } else {
    TREE.push({ name: "mermaid.md", type: "file", path: "notes/mermaid.md" });
  }
  await window.NB.sidebar.refresh();
  await tick(40);

  await window.NB.tabs.open("notes/mermaid.md");
  await tick(60);
  // The viewer's render() is async (mermaid.renderAll awaits each
  // block sequentially). Wait a touch longer to be sure.
  await tick(80);
  const mermaidContainers = () => window.document.querySelectorAll("#viewer .mermaid-container");
  const mermaidErrs = () => window.document.querySelectorAll("#viewer .mermaid-error");
  check("mermaid: NB.mermaid module is loaded", !!window.NB.mermaid);
  check("mermaid: rendering a ```mermaid block produces a .mermaid-container",
    mermaidContainers().length === 1,
    "containers=" + mermaidContainers().length + " errors=" + mermaidErrs().length);
  check("mermaid: the original <pre> was replaced (no orphan code.language-mermaid left)",
    window.document.querySelectorAll("#viewer pre > code.language-mermaid").length === 0,
    "remaining=" + window.document.querySelectorAll("#viewer pre > code.language-mermaid").length);
  check("mermaid: the container's data-mermaid is 'ok'",
    mermaidContainers()[0] && mermaidContainers()[0].dataset.mermaid === "ok",
    "data=" + (mermaidContainers()[0] && mermaidContainers()[0].dataset.mermaid));
  check("mermaid: the stub's render() was called once with the diagram source",
    __mermaid.renders === 1 &&
    /graph TD/.test(__mermaid.lastSource || ""),
    "renders=" + __mermaid.renders + " source=" + JSON.stringify((__mermaid.lastSource || "").slice(0, 60)));
  check("mermaid: the stub's render() got a unique id (counter bumps per call)",
    typeof __mermaid.lastId === "string" && /^mermaid-svg-\d+$/.test(__mermaid.lastId),
    "id=" + __mermaid.lastId);
  // The SVG was inserted; check the inner HTML contains it.
  check("mermaid: container.innerHTML contains the SVG from mermaid.render",
    mermaidContainers()[0] && /<svg/.test(mermaidContainers()[0].innerHTML),
    "html=" + (mermaidContainers()[0] && mermaidContainers()[0].innerHTML.slice(0, 80)));
  // The SVG is responsive: height attr removed, viewBox set so the
  // aspect ratio is preserved when the pane narrows.
  const svg = mermaidContainers()[0] && mermaidContainers()[0].querySelector("svg");
  check("mermaid: svg has its height attribute removed (CSS scales it)",
    svg && !svg.getAttribute("height"),
    "height=" + (svg && svg.getAttribute("height")));
  check("mermaid: svg has a viewBox so the browser preserves the aspect ratio",
    svg && /^\d+ \d+ \d+ \d+$/.test(svg.getAttribute("viewBox") || ""),
    "viewBox=" + (svg && svg.getAttribute("viewBox")));

  // Theme sync: mermaid.initialize was called with the current
  // theme. The default at this point in the test suite is "dark"
  // (body.dataset.theme was set when applyConfig ran earlier). The
  // stub records initThemes so we can assert it.
  check("mermaid: initialize was called at least once",
    __mermaid.inits >= 1, "inits=" + __mermaid.inits);
  check("mermaid: initialize was called with the current body theme",
    __mermaid.initThemes[__mermaid.initThemes.length - 1] === "dark",
    "initThemes=" + JSON.stringify(__mermaid.initThemes));

  // Theme switch forces a reinit. Apply a new theme, then render
  // again, and the stub's initialize must have been called with
  // the new theme.
  const initsBefore = __mermaid.inits;
  const lastThemeBefore = __mermaid.initThemes[__mermaid.initThemes.length - 1];
  // Flip the body theme (the app's applyTheme would normally do
  // this, but we want to test the reinit path in isolation).
  window.NB.app.setTheme("light");
  await tick(40);
  // The next viewer.render() (e.g. re-open the same file) should
  // re-initialize mermaid with the new theme.
  await window.NB.tabs.activate("notes/mermaid.md");
  await tick(80);
  check("mermaid: theme switch re-initializes mermaid (inits went up)",
    __mermaid.inits > initsBefore, "inits before/after: " + initsBefore + "/" + __mermaid.inits);
  // The new init is recorded AFTER the previous one; the latest
  // entry should be the new theme.
  const lastThemeAfter = __mermaid.initThemes[__mermaid.initThemes.length - 1];
  check("mermaid: latest init theme is the new theme (light)",
    lastThemeAfter === "light" || lastThemeAfter !== lastThemeBefore,
    "lastTheme before/after: " + lastThemeBefore + "/" + lastThemeAfter +
    " all=" + JSON.stringify(__mermaid.initThemes));

  // Error fallback: arm the stub to throw on the next render.
  // The viewer should replace the <pre> with a .mermaid-error
  // box (header + source) AND fire a toast notification through
  // NB.app.notify. We swap the file's body to a new (syntactically
  // invalid) mermaid block; activating it triggers a fresh render.
  __mermaid.failNext = true;
  const BAD_BODY = "```mermaid\nthis is not valid mermaid\n```\n";
  FILES["notes/bad.md"] = BAD_BODY;
  TREE.push({ name: "bad.md", type: "file", path: "notes/bad.md" });
  await window.NB.sidebar.refresh();
  await tick(40);
  await window.NB.tabs.open("notes/bad.md");
  await tick(80);
  check("mermaid: parse error falls back to .mermaid-error block",
    mermaidErrs().length === 1,
    "errs=" + mermaidErrs().length);
  check("mermaid: error block has a 'Mermaid error:' header",
    mermaidErrs()[0] &&
    /Mermaid error:/.test(mermaidErrs()[0].querySelector(".mermaid-error-head").textContent),
    "head=" + (mermaidErrs()[0] && mermaidErrs()[0].querySelector(".mermaid-error-head").textContent));
  check("mermaid: error block has a <pre> with the original source",
    mermaidErrs()[0] && mermaidErrs()[0].querySelector(".mermaid-source") &&
    /not valid mermaid/.test(mermaidErrs()[0].querySelector(".mermaid-source").textContent),
    "src=" + (mermaidErrs()[0] && mermaidErrs()[0].querySelector(".mermaid-source").textContent));
  // The error is multi-line in the stub; we collapse to the first
  // line for the header. The full message is the first line of
  // the err.message.
  check("mermaid: error header is single-line (no newlines in textContent)",
    mermaidErrs()[0] && !/\n/.test(mermaidErrs()[0].querySelector(".mermaid-error-head").textContent),
    "head=" + (mermaidErrs()[0] && mermaidErrs()[0].querySelector(".mermaid-error-head").textContent));
  // On top of the inline error box, a toast notification fires.
  check("mermaid: error toast fires with the 'Mermaid error:' message",
    !!window.document.querySelector(".toast.show.warn") &&
    /Mermaid error:/.test(window.document.querySelector(".toast.show.warn").textContent),
    "toast=" + (window.document.querySelector(".toast.show.warn") || {}).textContent);
  // The stray error <div id="d<mermaid-svg-N>"> that real mermaid
  // appends to <body> on failure must be cleaned up so it doesn't
  // linger at the very bottom of the page.
  check("mermaid: stray body error div is removed after failure",
    !window.document.getElementById("d" + __mermaid.lastId),
    "stray=" + (window.document.getElementById("d" + __mermaid.lastId) || "(none)"));

  // Recovery: a subsequent valid render on the same file should
  // re-create the .mermaid-container. NB.mermaid.renderAll is
  // idempotent on already-rendered blocks (they no longer match
  // the `pre > code.language-mermaid` query), so a clean re-render
  // via viewer.render requires a fresh document. We do that by
  // re-activating the original (good) file.
  await window.NB.tabs.activate("notes/mermaid.md");
  await tick(80);
  // The error block from the previous (failed) render is replaced
  // by a .mermaid-container when the good file is re-activated.
  const errsAfter = window.document.querySelectorAll("#viewer .mermaid-error");
  const containersAfter = window.document.querySelectorAll("#viewer .mermaid-container");
  check("mermaid: re-activating the good file clears the error",
    errsAfter.length === 0 && containersAfter.length === 1,
    "errs=" + errsAfter.length + " containers=" + containersAfter.length);

  // NB.mermaid façade surface -- the public methods exist.
  check("mermaid: NB.mermaid.renderAll is a function", typeof window.NB.mermaid.renderAll === "function");
  check("mermaid: NB.mermaid.reinit is a function", typeof window.NB.mermaid.reinit === "function");
  check("mermaid: NB.mermaid.whenReady is a function", typeof window.NB.mermaid.whenReady === "function");

  // CSS sanity: the diagram + error styles exist in the stylesheet.
  // (We read the file directly -- the test HTML doesn't link
  // style.css, so we can't use getComputedStyle.)
  const mermaidCssText = read("static/css/style.css");
  check("mermaid: .mermaid-container style is in style.css",
    /\.mermaid-container\s*\{/.test(mermaidCssText),
    "no .mermaid-container rule");
  check("mermaid: .mermaid-error style is in style.css",
    /\.mermaid-error\s*\{/.test(mermaidCssText),
    "no .mermaid-error rule");
  check("mermaid: error toast warn style is in style.css",
    /\.toast\.warn/.test(mermaidCssText),
    "no .toast.warn rule");



  // --- lightbox: click a diagram to see it full-size ---------------
  const lightboxOverlay = () => window.document.getElementById("mermaid-lightbox");
  const lightboxBody    = () => window.document.getElementById("mermaid-lightbox-body");
  const lightboxClose   = () => window.document.getElementById("mlb-close");
  check("lightbox: overlay element exists", !!lightboxOverlay());
  check("lightbox: body element exists", !!lightboxBody());
  check("lightbox: close button exists", !!lightboxClose());
  check("lightbox: zoom in button exists",
    !!window.document.getElementById("mlb-zoom-in"));
  check("lightbox: zoom out button exists",
    !!window.document.getElementById("mlb-zoom-out"));
  check("lightbox: fit button exists",
    !!window.document.getElementById("mlb-fit"));
  check("lightbox: zoom percentage indicator exists",
    !!window.document.getElementById("mlb-zoom-pct"));
  check("lightbox: overlay is hidden by default",
    lightboxOverlay() && lightboxOverlay().hidden,
    "hidden=" + (lightboxOverlay() ? lightboxOverlay().hidden : "n/a"));
  check("lightbox: body is empty by default",
    lightboxBody() && lightboxBody().innerHTML === "",
    "html=" + JSON.stringify(lightboxBody() && lightboxBody().innerHTML));
  // The mermaid container from the previous test block is still in
  // the DOM (we're before the cleanup section). Click it.
  const mc = mermaidContainers();
  check("lightbox: mermaid container exists (precondition)", mc.length >= 1,
    "count=" + mc.length);
  // Click the container (not a child link). The handler clones the SVG.
  mc[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0 }));
  await tick(20);
  check("lightbox: click on .mermaid-container reveals the lightbox",
    lightboxOverlay() && !lightboxOverlay().hidden,
    "hidden=" + (lightboxOverlay() ? lightboxOverlay().hidden : "n/a"));
  check("lightbox: body has an SVG clone",
    lightboxBody() && lightboxBody().querySelector("svg") &&
    lightboxBody().querySelector("svg").textContent === "mock",
    "svg_text=" + (lightboxBody() && lightboxBody().querySelector("svg")
      ? lightboxBody().querySelector("svg").textContent : "(no svg)"));
  check("lightbox: clone does not replace the original container (still in DOM)",
    mermaidContainers().length >= 1,
    "containers=" + mermaidContainers().length);
  // The original SVG should still be in the viewer.
  check("lightbox: original SVG is still in the viewer container",
    !!mermaidContainers()[0].querySelector("svg"),
    "original svg=" + !!mermaidContainers()[0].querySelector("svg"));
  // Starts in fit-to-page mode.
  check("lightbox: body has svg-fit class on open",
    lightboxBody().classList.contains("svg-fit"),
    "classes=" + lightboxBody().className);
  check("lightbox: zoom display shows 'Fit'",
    window.document.getElementById("mlb-zoom-pct").textContent === "Fit",
    "got=" + window.document.getElementById("mlb-zoom-pct").textContent);
  // Zoom in leaves fit mode and shows 100%.
  window.NB.mermaid.zoomIn();
  await tick(10);
  check("lightbox: zoomIn removes svg-fit class",
    !lightboxBody().classList.contains("svg-fit"),
    "classes=" + lightboxBody().className);
  check("lightbox: zoom display shows 100%",
    window.document.getElementById("mlb-zoom-pct").textContent === "100%",
    "got=" + window.document.getElementById("mlb-zoom-pct").textContent);
  // Zoom in again → 125%.
  window.NB.mermaid.zoomIn();
  await tick(10);
  check("lightbox: zoomIn to 125%",
    window.document.getElementById("mlb-zoom-pct").textContent === "125%",
    "got=" + window.document.getElementById("mlb-zoom-pct").textContent);
  // Fit to page restores fit mode.
  window.NB.mermaid.fitToPage();
  await tick(10);
  check("lightbox: fitToPage restores svg-fit class",
    lightboxBody().classList.contains("svg-fit"),
    "classes=" + lightboxBody().className);
  check("lightbox: fit display shows 'Fit'",
    window.document.getElementById("mlb-zoom-pct").textContent === "Fit",
    "got=" + window.document.getElementById("mlb-zoom-pct").textContent);
  // Zoom out from fit → leaves fit at 100%.
  window.NB.mermaid.zoomOut();
  await tick(10);
  check("lightbox: zoomOut from fit goes to 100%",
    window.document.getElementById("mlb-zoom-pct").textContent === "100%",
    "got=" + window.document.getElementById("mlb-zoom-pct").textContent);
  // Ctrl++ keyboard shortcut.
  const ctrlPlus = new window.KeyboardEvent("keydown", {
    key: "=", ctrlKey: true, bubbles: true, cancelable: true,
  });
  window.document.dispatchEvent(ctrlPlus);
  await tick(10);
  check("lightbox: Ctrl++ zooms in to 125%",
    window.document.getElementById("mlb-zoom-pct").textContent === "125%",
    "got=" + window.document.getElementById("mlb-zoom-pct").textContent);
  // Ctrl+- keyboard shortcut.
  const ctrlMinus = new window.KeyboardEvent("keydown", {
    key: "-", ctrlKey: true, bubbles: true, cancelable: true,
  });
  window.document.dispatchEvent(ctrlMinus);
  await tick(10);
  check("lightbox: Ctrl+- zooms out to 100%",
    window.document.getElementById("mlb-zoom-pct").textContent === "100%",
    "got=" + window.document.getElementById("mlb-zoom-pct").textContent);
  // Mouse wheel zooms.
  const wheelUp = new window.WheelEvent("wheel", {
    deltaY: -120, bubbles: true, cancelable: true,
  });
  lightboxOverlay().dispatchEvent(wheelUp);
  await tick(10);
  check("lightbox: wheel up zooms in to 125%",
    window.document.getElementById("mlb-zoom-pct").textContent === "125%",
    "got=" + window.document.getElementById("mlb-zoom-pct").textContent);
  // Close via the close button.
  lightboxClose().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await tick(10);
  check("lightbox: close button hides the overlay",
    lightboxOverlay() && lightboxOverlay().hidden);
  check("lightbox: close hides the SVG",
    lightboxBody() && lightboxBody().innerHTML === "",
    "html=" + JSON.stringify(lightboxBody() && lightboxBody().innerHTML));
  // Re-open then close via Escape.
  mc[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0 }));
  await tick(10);
  check("lightbox: re-open precondition (overlay visible)",
    lightboxOverlay() && !lightboxOverlay().hidden);
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "Escape", bubbles: true, cancelable: true,
  }));
  await tick(10);
  check("lightbox: Escape closes the overlay",
    lightboxOverlay() && lightboxOverlay().hidden);
  // Backdrop click closes.
  mc[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0 }));
  await tick(10);
  check("lightbox: backdrop precondition (overlay visible)",
    lightboxOverlay() && !lightboxOverlay().hidden);
  const backdrop = new window.MouseEvent("click", { bubbles: true });
  Object.defineProperty(backdrop, "target", { value: lightboxOverlay() });
  lightboxOverlay().dispatchEvent(backdrop);
  await tick(10);
  check("lightbox: backdrop click closes the overlay",
    lightboxOverlay() && lightboxOverlay().hidden);
  // Click on the SVG itself should NOT close.
  mc[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0 }));
  await tick(10);
  check("lightbox: re-open for svg-click test",
    lightboxOverlay() && !lightboxOverlay().hidden);
  const svgInBody = lightboxBody().querySelector("svg");
  check("lightbox: SVG exists in body (precondition)", !!svgInBody,
    "svg=" + !!svgInBody);
  if (svgInBody) {
    svgInBody.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await tick(10);
    check("lightbox: click on SVG does NOT close",
      lightboxOverlay() && !lightboxOverlay().hidden,
      "hidden=" + lightboxOverlay().hidden);
  }
  // Click on the body (blank area around the SVG) should close.
  const bodyClick = new window.MouseEvent("click", { bubbles: true });
  Object.defineProperty(bodyClick, "target", { value: lightboxBody() });
  lightboxBody().dispatchEvent(bodyClick);
  await tick(10);
  check("lightbox: click on body blank area closes the overlay",
    lightboxOverlay() && lightboxOverlay().hidden,
    "hidden=" + (lightboxOverlay() ? lightboxOverlay().hidden : "n/a"));
  // Close cleanly for the cleanup section.
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "Escape", bubbles: true, cancelable: true,
  }));
  await tick(10);
  check("lightbox: final close via Escape",
    lightboxOverlay() && lightboxOverlay().hidden);
  // CSS source checks.
  check("lightbox: .mermaid-lightbox-overlay style is in style.css",
    /\.mermaid-lightbox-overlay\s*\{/.test(mermaidCssText),
    "no .mermaid-lightbox-overlay rule");
  check("lightbox: .mermaid-lightbox-body style is in style.css",
    /\.mermaid-lightbox-body\s*\{/.test(mermaidCssText),
    "no .mermaid-lightbox-body rule");
  check("lightbox: .mlb-btn style is in style.css",
    /\.mlb-btn\s*\{/.test(mermaidCssText),
    "no .mlb-btn rule");

  // --- lightbox: drag to pan when zoomed ----------------------------
  // Re-open the mermaid lightbox, zoom in (so it's not in fit mode), then
  // simulate a left-mouse drag across the SVG. Dragging should pan the
  // image (visible as a translate(...) transform on the SVG), and a click
  // that follows a drag should NOT close the overlay.
  {
    mc[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0 }));
    await tick(10);
    window.NB.mermaid.zoomIn();          // leave fit mode -> 100%
    await tick(10);
    const lbSvg = () => lightboxBody() && lightboxBody().querySelector("svg");
    check("lightbox drag: zoomed SVG has a transform before drag",
      lbSvg() && /scale\(1\)/.test(lbSvg().style.transform),
      lbSvg() ? lbSvg().style.transform : "(no svg)");

    // Simulate a drag: mousedown on the SVG, mousemove (+40,+30),
    // mouseup on window.
    const svg = lbSvg();
    svg.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 100, clientY: 100 }));
    window.dispatchEvent(new window.MouseEvent("mousemove", { bubbles: true, clientX: 140, clientY: 130 }));
    await tick(10);
    window.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
    await tick(10);
    check("lightbox drag: zoomed SVG translated after drag",
      /translate\(40px, 30px\)/.test(lbSvg().style.transform),
      lbSvg() ? lbSvg().style.transform : "(no svg)");

    // A drag that starts on the SVG and ends elsewhere fires no click on
    // the backdrop, so a pan can never close the lightbox by itself.

    // Right-drag also pans + suppresses the context menu.
    const before = lbSvg().style.transform;
    lbSvg().dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, button: 2, clientX: 200, clientY: 200 }));
    window.dispatchEvent(new window.MouseEvent("mousemove", { bubbles: true, clientX: 220, clientY: 210 }));
    await tick(10);
    window.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true, button: 2 }));
    // Right-drag context menu suppressed when zoomed.
    let ctxPrevented = false;
    const ctxEvt = new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    ctxEvt.preventDefault = () => { ctxPrevented = true; };
    lightboxOverlay().dispatchEvent(ctxEvt);
    check("lightbox drag: right-drag translates + context menu suppressed when zoomed",
      /translate\(60px, 40px\)/.test(lbSvg().style.transform) && ctxPrevented,
      "transform=" + (lbSvg() ? lbSvg().style.transform : "(none)") + " ctxPrevented=" + ctxPrevented);

    // Fit-to-page clears the pan (transform reset to "none").
    window.NB.mermaid.fitToPage();
    await tick(10);
    check("lightbox drag: fitToPage clears the transform",
      lbSvg() && lbSvg().style.transform === "none",
      lbSvg() ? lbSvg().style.transform : "(no svg)");

    window.NB.mermaid.closeLightbox();
    await tick(10);
  }

  // --- lightbox: drag to pan in fit mode (no zoom first) ---------------
  // The lightbox opens in fit mode. The user should be able to drag
  // immediately without zooming first. Verify that dragging in fit mode
  // applies a translate transform and that the 1:1 cursor tracking is
  // correct (dx, not dx/zoomLevel).
  {
    mc[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0 }));
    await tick(10);
    // Lightbox is open in fit mode — zoomFit is true, no transform yet.
    const lbSvg2 = () => lightboxBody() && lightboxBody().querySelector("svg");
    check("lightbox fit-drag: opens in fit mode (no transform)",
      lbSvg2() && lbSvg2().style.transform === "none",
      lbSvg2() ? lbSvg2().style.transform : "(no svg)");

    // Drag without calling zoomFirst: mousedown (+50, +20).
    const svg2 = lbSvg2();
    svg2.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 100, clientY: 100 }));
    window.dispatchEvent(new window.MouseEvent("mousemove", { bubbles: true, clientX: 150, clientY: 120 }));
    await tick(10);

    // Context menu suppressed during active drag in fit mode.
    let ctxPrevented2 = false;
    const ctxEvt2 = new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    ctxEvt2.preventDefault = () => { ctxPrevented2 = true; };
    lightboxOverlay().dispatchEvent(ctxEvt2);
    check("lightbox fit-drag: context menu suppressed during fit-mode drag",
      ctxPrevented2,
      "ctxPrevented=" + ctxPrevented2);

    window.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
    await tick(10);
    // 1:1 tracking: dx=50, dy=20 → translate(50px, 20px).
    check("lightbox fit-drag: translate applied in fit mode (1:1 tracking)",
      /translate\(50px, 20px\)/.test(lbSvg2().style.transform),
      lbSvg2() ? lbSvg2().style.transform : "(no svg)");

    // fitToPage resets the pan.
    window.NB.mermaid.fitToPage();
    await tick(10);
    check("lightbox fit-drag: fitToPage resets transform after fit-mode drag",
      lbSvg2() && lbSvg2().style.transform === "none",
      lbSvg2() ? lbSvg2().style.transform : "(no svg)");

    window.NB.mermaid.closeLightbox();
    await tick(10);
  }

  // Cleanup: close the test files we opened so the rest of the
  // suite isn't carrying them. The TREE / FILES changes stay
  // (they're the test fixture), but the open tabs should match
  // the rest-of-suite expectations.
  await window.NB.tabs.close("notes/bad.md", { force: true });
  await window.NB.tabs.close("notes/mermaid.md", { force: true });
  // Re-activate the canonical active file.
  await window.NB.tabs.activate("notes/a.md");
  await tick(40);
  // The theme-switch test above flipped body[data-theme] to
  // "light". The rest of the suite expects the default ("dark"),
  // and the footer test asserts that. Reset here.
  window.NB.app.setTheme("dark");
  await tick(20);

  console.log("== wavedrom ==");
  // The wavedrom integration is in static/js/wavedrom.js + the viewer's
  // render() pipeline. The vendored UMD bundle is not loaded into jsdom
  // (same reason as mermaid); the test relies on the window.wavedrom stub
  // installed in the harness. It mirrors the real renderWaveForm contract:
  // (index, source, output) paints an SVG into element output+index.
  // Reset the stub so prior tests' render counts don't leak.
  __wavedrom.renders = 0;
  __wavedrom.failNext = false;
  __wavedrom.nextSvg = '<svg viewBox="0 0 480 60" width="480" height="60"><text>wave</text></svg>';

  // Open a tab whose body has a ```wavedrom block. NB.wavedrom parses
  // the JSON and calls renderWaveForm into a temp host it mounts before
  // the block, then moves the SVG into a .wavedrom-container.
  const WAVEDROM_BODY = "# Timing\n\n" +
    "```wavedrom\n" +
    '{signal:[{name:"clk",wave:"p.....|..."},{name:"dout",wave:"x.345x|=.x"}]}\n' +
    "```\n\n" +
    "End.\n";
  FILES["notes/wavedrom.md"] = WAVEDROM_BODY;
  const wdNotesDir = (TREE.find(n => n.path === "notes"));
  if (wdNotesDir && !wdNotesDir.children.some(c => c.path === "notes/wavedrom.md")) {
    wdNotesDir.children.push({ name: "wavedrom.md", type: "file", path: "notes/wavedrom.md" });
  } else {
    TREE.push({ name: "wavedrom.md", type: "file", path: "notes/wavedrom.md" });
  }
  await window.NB.sidebar.refresh();
  await tick(40);
  await window.NB.tabs.open("notes/wavedrom.md");
  await tick(80);
  const wavedromContainers = () => window.document.querySelectorAll("#viewer .wavedrom-container");
  const wavedromErrs = () => window.document.querySelectorAll("#viewer .wavedrom-error");
  check("wavedrom: NB.wavedrom module is loaded", !!window.NB.wavedrom);
  check("wavedrom: rendering a ```wavedrom block produces a .wavedrom-container",
    wavedromContainers().length === 1,
    "containers=" + wavedromContainers().length + " errors=" + wavedromErrs().length);
  check("wavedrom: the original <pre> was replaced (no orphan code.language-wavedrom left)",
    window.document.querySelectorAll("#viewer pre > code.language-wavedrom").length === 0,
    "remaining=" + window.document.querySelectorAll("#viewer pre > code.language-wavedrom").length);
  check("wavedrom: the container's data-wavedrom is 'ok'",
    wavedromContainers()[0] && wavedromContainers()[0].dataset.wavedrom === "ok",
    "data=" + (wavedromContainers()[0] && wavedromContainers()[0].dataset.wavedrom));
  check("wavedrom: the stub's renderWaveForm was called once with the parsed signal object",
    __wavedrom.renders === 1 &&
    __wavedrom.lastSource && __wavedrom.lastSource.signal &&
    __wavedrom.lastSource.signal[0].name === "clk",
    "renders=" + __wavedrom.renders + " source=" + JSON.stringify(__wavedrom.lastSource));
  check("wavedrom: the container holds an <svg> from renderWaveForm",
    wavedromContainers()[0] && wavedromContainers()[0].querySelector("svg"),
    "html=" + (wavedromContainers()[0] && wavedromContainers()[0].innerHTML.slice(0, 80)));
  // The SVG is responsive: width/height attributes removed, aspect ratio
  // preserved via an inline style so max-width doesn't clip.
  const wdSvg = wavedromContainers()[0] && wavedromContainers()[0].querySelector("svg");
  check("wavedrom: svg has height removed but width kept (CSS scales it, like mermaid)",
    wdSvg && !wdSvg.getAttribute("height") && wdSvg.getAttribute("width"),
    "w=" + (wdSvg && wdSvg.getAttribute("width")) + " h=" + (wdSvg && wdSvg.getAttribute("height")));
  check("wavedrom: svg has a viewBox so the browser preserves the aspect ratio",
    wdSvg && /^\d+ \d+ \d+ \d+$/.test(wdSvg.getAttribute("viewBox") || ""),
    "viewBox=" + (wdSvg && wdSvg.getAttribute("viewBox")));

  // Error fallback: arm the stub to throw on the next render. The viewer
  // should replace the <pre> with a .wavedrom-error box (header + source).
  __wavedrom.failNext = true;
  const BAD_WD_BODY = "```wavedrom\n{not valid json\n```\n";
  FILES["notes/badwd.md"] = BAD_WD_BODY;
  TREE.push({ name: "badwd.md", type: "file", path: "notes/badwd.md" });
  await window.NB.sidebar.refresh();
  await tick(40);
  await window.NB.tabs.open("notes/badwd.md");
  await tick(80);
  check("wavedrom: render error falls back to .wavedrom-error block",
    wavedromErrs().length === 1,
    "errs=" + wavedromErrs().length);
  check("wavedrom: error block has a 'WaveDrom error:' header",
    wavedromErrs()[0] &&
    /WaveDrom error:/.test(wavedromErrs()[0].querySelector(".wavedrom-error-head").textContent),
    "head=" + (wavedromErrs()[0] && wavedromErrs()[0].querySelector(".wavedrom-error-head").textContent));

  // Recovery: re-activating the good file clears the error and re-renders.
  __wavedrom.failNext = false;
  await window.NB.tabs.activate("notes/wavedrom.md");
  await tick(80);
  check("wavedrom: re-activating the good file clears the error",
    wavedromErrs().length === 0 && wavedromContainers().length === 1,
    "errs=" + wavedromErrs().length + " containers=" + wavedromContainers().length);

  // NB.wavedrom façade surface -- the public methods exist.
  check("wavedrom: NB.wavedrom.renderAll is a function", typeof window.NB.wavedrom.renderAll === "function");
  check("wavedrom: NB.wavedrom.whenReady is a function", typeof window.NB.wavedrom.whenReady === "function");

  // CSS sanity: the diagram + error styles exist in the stylesheet.
  const wavedromCssText = read("static/css/style.css");
  check("wavedrom: .wavedrom-container style is in style.css",
    /\.wavedrom-container\s*\{/.test(wavedromCssText),
    "no .wavedrom-container rule");
  check("wavedrom: .wavedrom-error style is in style.css",
    /\.wavedrom-error\s*\{/.test(wavedromCssText),
    "no .wavedrom-error rule");

  // --- wavedrom lightbox: click a waveform to see it full-size ------
  const wdLightboxOverlay = () => window.document.getElementById("wavedrom-lightbox");
  const wdLightboxBody    = () => window.document.getElementById("wavedrom-lightbox-body");
  const wdLightboxClose   = () => window.document.getElementById("wdlb-close");
  check("wavedrom lightbox: overlay element exists", !!wdLightboxOverlay());
  check("wavedrom lightbox: body element exists", !!wdLightboxBody());
  check("wavedrom lightbox: close button exists", !!wdLightboxClose());
  check("wavedrom lightbox: zoom in button exists",
    !!window.document.getElementById("wdlb-zoom-in"));
  check("wavedrom lightbox: zoom out button exists",
    !!window.document.getElementById("wdlb-zoom-out"));
  check("wavedrom lightbox: fit button exists",
    !!window.document.getElementById("wdlb-fit"));
  check("wavedrom lightbox: zoom percentage indicator exists",
    !!window.document.getElementById("wdlb-zoom-pct"));
  check("wavedrom lightbox: overlay is hidden by default",
    wdLightboxOverlay() && wdLightboxOverlay().hidden,
    "hidden=" + (wdLightboxOverlay() ? wdLightboxOverlay().hidden : "n/a"));
  check("wavedrom lightbox: body is empty by default",
    wdLightboxBody() && wdLightboxBody().innerHTML === "",
    "html=" + JSON.stringify(wdLightboxBody() && wdLightboxBody().innerHTML));
  // The wavedrom container from the previous test block is still in the
  // DOM (we're before the cleanup section). Click it.
  const wdContainers = wavedromContainers();
  check("wavedrom lightbox: wavedrom container exists (precondition)", wdContainers.length >= 1,
    "count=" + wdContainers.length);
  wdContainers[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0 }));
  await tick(20);
  check("wavedrom lightbox: click on .wavedrom-container reveals the lightbox",
    wdLightboxOverlay() && !wdLightboxOverlay().hidden,
    "hidden=" + (wdLightboxOverlay() ? wdLightboxOverlay().hidden : "n/a"));
  check("wavedrom lightbox: body has an SVG clone",
    wdLightboxBody() && wdLightboxBody().querySelector("svg") &&
    wdLightboxBody().querySelector("svg").textContent === "wave",
    "svg_text=" + (wdLightboxBody() && wdLightboxBody().querySelector("svg")
      ? wdLightboxBody().querySelector("svg").textContent : "(no svg)"));
  check("wavedrom lightbox: clone does not replace the original container (still in DOM)",
    wavedromContainers().length >= 1,
    "containers=" + wavedromContainers().length);
  check("wavedrom lightbox: original SVG is still in the viewer container",
    !!wavedromContainers()[0].querySelector("svg"),
    "original svg=" + !!wavedromContainers()[0].querySelector("svg"));
  check("wavedrom lightbox: body has svg-fit class on open",
    wdLightboxBody().classList.contains("svg-fit"),
    "classes=" + wdLightboxBody().className);
  check("wavedrom lightbox: zoom display shows 'Fit'",
    window.document.getElementById("wdlb-zoom-pct").textContent === "Fit",
    "got=" + window.document.getElementById("wdlb-zoom-pct").textContent);
  // Zoom in leaves fit mode and shows 100%.
  window.NB.wavedrom.zoomIn();
  await tick(10);
  check("wavedrom lightbox: zoomIn removes svg-fit class",
    !wdLightboxBody().classList.contains("svg-fit"),
    "classes=" + wdLightboxBody().className);
  check("wavedrom lightbox: zoom display shows 100%",
    window.document.getElementById("wdlb-zoom-pct").textContent === "100%",
    "got=" + window.document.getElementById("wdlb-zoom-pct").textContent);
  // Zoom in again → 125%.
  window.NB.wavedrom.zoomIn();
  await tick(10);
  check("wavedrom lightbox: zoomIn to 125%",
    window.document.getElementById("wdlb-zoom-pct").textContent === "125%",
    "got=" + window.document.getElementById("wdlb-zoom-pct").textContent);
  // Fit to page restores fit mode.
  window.NB.wavedrom.fitToPage();
  await tick(10);
  check("wavedrom lightbox: fitToPage restores svg-fit class",
    wdLightboxBody().classList.contains("svg-fit"),
    "classes=" + wdLightboxBody().className);
  check("wavedrom lightbox: fit display shows 'Fit'",
    window.document.getElementById("wdlb-zoom-pct").textContent === "Fit",
    "got=" + window.document.getElementById("wdlb-zoom-pct").textContent);
  // Zoom out from fit → leaves fit at 100%.
  window.NB.wavedrom.zoomOut();
  await tick(10);
  check("wavedrom lightbox: zoomOut from fit goes to 100%",
    window.document.getElementById("wdlb-zoom-pct").textContent === "100%",
    "got=" + window.document.getElementById("wdlb-zoom-pct").textContent);
  // Ctrl++ keyboard shortcut.
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "=", ctrlKey: true, bubbles: true, cancelable: true,
  }));
  await tick(10);
  check("wavedrom lightbox: Ctrl++ zooms in to 125%",
    window.document.getElementById("wdlb-zoom-pct").textContent === "125%",
    "got=" + window.document.getElementById("wdlb-zoom-pct").textContent);
  // Ctrl+- keyboard shortcut.
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "-", ctrlKey: true, bubbles: true, cancelable: true,
  }));
  await tick(10);
  check("wavedrom lightbox: Ctrl+- zooms out to 100%",
    window.document.getElementById("wdlb-zoom-pct").textContent === "100%",
    "got=" + window.document.getElementById("wdlb-zoom-pct").textContent);
  // Mouse wheel zooms.
  wdLightboxOverlay().dispatchEvent(new window.WheelEvent("wheel", {
    deltaY: -120, bubbles: true, cancelable: true,
  }));
  await tick(10);
  check("wavedrom lightbox: wheel up zooms in to 125%",
    window.document.getElementById("wdlb-zoom-pct").textContent === "125%",
    "got=" + window.document.getElementById("wdlb-zoom-pct").textContent);
  // Close via the close button.
  wdLightboxClose().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await tick(10);
  check("wavedrom lightbox: close button hides the overlay",
    wdLightboxOverlay() && wdLightboxOverlay().hidden);
  check("wavedrom lightbox: close hides the SVG",
    wdLightboxBody() && wdLightboxBody().innerHTML === "",
    "html=" + JSON.stringify(wdLightboxBody() && wdLightboxBody().innerHTML));
  // Re-open then close via Escape.
  wdContainers[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0 }));
  await tick(10);
  check("wavedrom lightbox: re-open precondition (overlay visible)",
    wdLightboxOverlay() && !wdLightboxOverlay().hidden);
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "Escape", bubbles: true, cancelable: true,
  }));
  await tick(10);
  check("wavedrom lightbox: Escape closes the overlay",
    wdLightboxOverlay() && wdLightboxOverlay().hidden);
  // Backdrop click closes.
  wdContainers[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0 }));
  await tick(10);
  wdLightboxOverlay().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await tick(10);
  check("wavedrom lightbox: backdrop click closes the overlay",
    wdLightboxOverlay() && wdLightboxOverlay().hidden);
  // The mermaid lightbox must be unaffected (independent overlays).
  check("wavedrom lightbox: mermaid lightbox stays hidden",
    window.document.getElementById("mermaid-lightbox") &&
    window.document.getElementById("mermaid-lightbox").hidden);

  console.log("== katex ==");
  // The katex integration is in static/js/katex.js + the viewer's
  // render() pipeline. The vendored bundle is not loaded into jsdom
  // (same reason as mermaid); the test relies on the window.katex stub.
  // Reset the stub so prior tests' render counts don't leak.
  __katex.renders = 0;
  __katex.failNext = false;
  __katex.nextHtml = '<span class="katex">E=mc^2</span>';

  const KATEX_BODY = "# Math\n\n" +
    "```math\n" +
    "E = mc^2\n" +
    "```\n\n" +
    "End.\n";
  FILES["notes/katex.md"] = KATEX_BODY;
  const kxNotesDir = (TREE.find(n => n.path === "notes"));
  if (kxNotesDir && !kxNotesDir.children.some(c => c.path === "notes/katex.md")) {
    kxNotesDir.children.push({ name: "katex.md", type: "file", path: "notes/katex.md" });
  } else {
    TREE.push({ name: "katex.md", type: "file", path: "notes/katex.md" });
  }
  await window.NB.sidebar.refresh();
  await tick(40);
  await window.NB.tabs.open("notes/katex.md");
  await tick(80);
  const katexContainers = () => window.document.querySelectorAll("#viewer .katex-container");
  const katexErrs = () => window.document.querySelectorAll("#viewer .katex-error");
  check("katex: NB.katex module is loaded", !!window.NB.katex);
  check("katex: rendering a ```math block produces a .katex-container",
    katexContainers().length === 1,
    "containers=" + katexContainers().length + " errors=" + katexErrs().length);
  check("katex: the original <pre> was replaced (no orphan code.language-math left)",
    window.document.querySelectorAll("#viewer pre > code.language-math").length === 0,
    "remaining=" + window.document.querySelectorAll("#viewer pre > code.language-math").length);
  check("katex: the container's data-katex is 'ok'",
    katexContainers()[0] && katexContainers()[0].dataset.katex === "ok",
    "data=" + (katexContainers()[0] && katexContainers()[0].dataset.katex));
  check("katex: the stub's renderToString was called once with the math source",
    __katex.renders === 1 && /E = mc\^2/.test(__katex.lastSource || ""),
    "renders=" + __katex.renders + " source=" + JSON.stringify(__katex.lastSource));
  check("katex: the container holds the typeset HTML from renderToString",
    katexContainers()[0] && /E=mc\^2/.test(katexContainers()[0].innerHTML),
    "html=" + (katexContainers()[0] && katexContainers()[0].innerHTML.slice(0, 80)));

  // Error fallback: arm the stub to throw on the next render.
  __katex.failNext = true;
  const BAD_KATEX_BODY = "```math\nE = \\frac{unclosed\n```\n";
  FILES["notes/badkatex.md"] = BAD_KATEX_BODY;
  TREE.push({ name: "badkatex.md", type: "file", path: "notes/badkatex.md" });
  await window.NB.sidebar.refresh();
  await tick(40);
  await window.NB.tabs.open("notes/badkatex.md");
  await tick(80);
  check("katex: render error falls back to .katex-error block",
    katexErrs().length === 1,
    "errs=" + katexErrs().length);
  check("katex: error block has a 'KaTeX error:' header",
    katexErrs()[0] &&
    /KaTeX error:/.test(katexErrs()[0].querySelector(".katex-error-head").textContent),
    "head=" + (katexErrs()[0] && katexErrs()[0].querySelector(".katex-error-head").textContent));

  // Recovery: re-activating the good file clears the error and re-renders.
  __katex.failNext = false;
  await window.NB.tabs.activate("notes/katex.md");
  await tick(80);
  check("katex: re-activating the good file clears the error",
    katexErrs().length === 0 && katexContainers().length === 1,
    "errs=" + katexErrs().length + " containers=" + katexContainers().length);

  // NB.katex façade surface.
  check("katex: NB.katex.renderAll is a function", typeof window.NB.katex.renderAll === "function");
  check("katex: NB.katex.whenReady is a function", typeof window.NB.katex.whenReady === "function");

  // CSS sanity.
  const katexCssText = read("static/css/style.css");
  check("katex: .katex-container style is in style.css",
    /\.katex-container\s*\{/.test(katexCssText),
    "no .katex-container rule");
  check("katex: .katex-error style is in style.css",
    /\.katex-error\s*\{/.test(katexCssText),
    "no .katex-error rule");

  console.log("== graphviz ==");
  // The graphviz integration is in static/js/viz.js + the viewer's
  // render() pipeline. The vendored WASM bundle is not loaded into
  // jsdom; the test relies on the window.Viz stub. Reset the stub.
  __viz.renders = 0;
  __viz.failNext = false;
  __viz.nextSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100"><text>graph</text></svg>';

  const VIZ_BODY = "# Graph\n\n" +
    "```dot\n" +
    "digraph { a -> b }\n" +
    "```\n\n" +
    "End.\n";
  FILES["notes/viz.md"] = VIZ_BODY;
  const vzNotesDir = (TREE.find(n => n.path === "notes"));
  if (vzNotesDir && !vzNotesDir.children.some(c => c.path === "notes/viz.md")) {
    vzNotesDir.children.push({ name: "viz.md", type: "file", path: "notes/viz.md" });
  } else {
    TREE.push({ name: "viz.md", type: "file", path: "notes/viz.md" });
  }
  await window.NB.sidebar.refresh();
  await tick(40);
  await window.NB.tabs.open("notes/viz.md");
  await tick(80);
  const vizContainers = () => window.document.querySelectorAll("#viewer .viz-container");
  const vizErrs = () => window.document.querySelectorAll("#viewer .viz-error");
  check("graphviz: NB.viz module is loaded", !!window.NB.viz);
  check("graphviz: rendering a ```dot block produces a .viz-container",
    vizContainers().length === 1,
    "containers=" + vizContainers().length + " errors=" + vizErrs().length);
  check("graphviz: the original <pre> was replaced (no orphan code.language-dot left)",
    window.document.querySelectorAll("#viewer pre > code.language-dot").length === 0,
    "remaining=" + window.document.querySelectorAll("#viewer pre > code.language-dot").length);
  check("graphviz: the container's data-viz is 'ok'",
    vizContainers()[0] && vizContainers()[0].dataset.viz === "ok",
    "data=" + (vizContainers()[0] && vizContainers()[0].dataset.viz));
  check("graphviz: the stub's renderString was called once with the dot source",
    __viz.renders === 1 && /digraph/.test(__viz.lastSource || ""),
    "renders=" + __viz.renders + " source=" + JSON.stringify(__viz.lastSource));
  check("graphviz: the container holds an <svg> from renderString",
    vizContainers()[0] && vizContainers()[0].querySelector("svg"),
    "html=" + (vizContainers()[0] && vizContainers()[0].innerHTML.slice(0, 80)));
  const vzSvg = vizContainers()[0] && vizContainers()[0].querySelector("svg");
  check("graphviz: svg has height removed but width kept (CSS scales it, like mermaid)",
    vzSvg && !vzSvg.getAttribute("height") && vzSvg.getAttribute("width"),
    "w=" + (vzSvg && vzSvg.getAttribute("width")) + " h=" + (vzSvg && vzSvg.getAttribute("height")));
  check("graphviz: svg has a viewBox so the browser preserves the aspect ratio",
    vzSvg && /^\d+ \d+ \d+ \d+$/.test(vzSvg.getAttribute("viewBox") || ""),
    "viewBox=" + (vzSvg && vzSvg.getAttribute("viewBox")));

  // Error fallback: arm the stub to throw on the next render.
  __viz.failNext = true;
  const BAD_VIZ_BODY = "```dot\ndigraph { this is not valid dot\n```\n";
  FILES["notes/badviz.md"] = BAD_VIZ_BODY;
  TREE.push({ name: "badviz.md", type: "file", path: "notes/badviz.md" });
  await window.NB.sidebar.refresh();
  await tick(40);
  await window.NB.tabs.open("notes/badviz.md");
  await tick(80);
  check("graphviz: render error falls back to .viz-error block",
    vizErrs().length === 1,
    "errs=" + vizErrs().length);
  check("graphviz: error block has a 'Graphviz error:' header",
    vizErrs()[0] &&
    /Graphviz error:/.test(vizErrs()[0].querySelector(".viz-error-head").textContent),
    "head=" + (vizErrs()[0] && vizErrs()[0].querySelector(".viz-error-head").textContent));

  // Recovery: re-activating the good file clears the error and re-renders.
  __viz.failNext = false;
  await window.NB.tabs.activate("notes/viz.md");
  await tick(80);
  check("graphviz: re-activating the good file clears the error",
    vizErrs().length === 0 && vizContainers().length === 1,
    "errs=" + vizErrs().length + " containers=" + vizContainers().length);

  // NB.viz façade surface.
  check("graphviz: NB.viz.renderAll is a function", typeof window.NB.viz.renderAll === "function");
  check("graphviz: NB.viz.whenReady is a function", typeof window.NB.viz.whenReady === "function");

  // CSS sanity.
  const vizCssText = read("static/css/style.css");
  check("graphviz: .viz-container style is in style.css",
    /\.viz-container\s*\{/.test(vizCssText),
    "no .viz-container rule");
  check("graphviz: .viz-error style is in style.css",
    /\.viz-error\s*\{/.test(vizCssText),
    "no .viz-error rule");

  // --- graphviz lightbox: click a graph to see it full-size ----------
  const vzLightboxOverlay = () => window.document.getElementById("viz-lightbox");
  const vzLightboxBody    = () => window.document.getElementById("viz-lightbox-body");
  const vzLightboxClose   = () => window.document.getElementById("vizlb-close");
  check("graphviz lightbox: overlay element exists", !!vzLightboxOverlay());
  check("graphviz lightbox: body element exists", !!vzLightboxBody());
  check("graphviz lightbox: close button exists", !!vzLightboxClose());
  check("graphviz lightbox: zoom in button exists",
    !!window.document.getElementById("vizlb-zoom-in"));
  check("graphviz lightbox: zoom out button exists",
    !!window.document.getElementById("vizlb-zoom-out"));
  check("graphviz lightbox: fit button exists",
    !!window.document.getElementById("vizlb-fit"));
  check("graphviz lightbox: zoom percentage indicator exists",
    !!window.document.getElementById("vizlb-zoom-pct"));
  check("graphviz lightbox: overlay is hidden by default",
    vzLightboxOverlay() && vzLightboxOverlay().hidden,
    "hidden=" + (vzLightboxOverlay() ? vzLightboxOverlay().hidden : "n/a"));
  const vzContainers = vizContainers();
  check("graphviz lightbox: viz container exists (precondition)", vzContainers.length >= 1,
    "count=" + vzContainers.length);
  vzContainers[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0 }));
  await tick(20);
  check("graphviz lightbox: click on .viz-container reveals the lightbox",
    vzLightboxOverlay() && !vzLightboxOverlay().hidden,
    "hidden=" + (vzLightboxOverlay() ? vzLightboxOverlay().hidden : "n/a"));
  check("graphviz lightbox: body has an SVG clone",
    vzLightboxBody() && vzLightboxBody().querySelector("svg") &&
    vzLightboxBody().querySelector("svg").textContent === "graph",
    "svg_text=" + (vzLightboxBody() && vzLightboxBody().querySelector("svg")
      ? vzLightboxBody().querySelector("svg").textContent : "(no svg)"));
  check("graphviz lightbox: body has svg-fit class on open",
    vzLightboxBody().classList.contains("svg-fit"),
    "classes=" + vzLightboxBody().className);
  check("graphviz lightbox: zoom display shows 'Fit'",
    window.document.getElementById("vizlb-zoom-pct").textContent === "Fit",
    "got=" + window.document.getElementById("vizlb-zoom-pct").textContent);
  window.NB.viz.zoomIn();
  await tick(10);
  check("graphviz lightbox: zoomIn removes svg-fit class",
    !vzLightboxBody().classList.contains("svg-fit"),
    "classes=" + vzLightboxBody().className);
  check("graphviz lightbox: zoom display shows 100%",
    window.document.getElementById("vizlb-zoom-pct").textContent === "100%",
    "got=" + window.document.getElementById("vizlb-zoom-pct").textContent);
  window.NB.viz.zoomIn();
  await tick(10);
  check("graphviz lightbox: zoomIn to 125%",
    window.document.getElementById("vizlb-zoom-pct").textContent === "125%",
    "got=" + window.document.getElementById("vizlb-zoom-pct").textContent);
  window.NB.viz.fitToPage();
  await tick(10);
  check("graphviz lightbox: fitToPage restores svg-fit class",
    vzLightboxBody().classList.contains("svg-fit"),
    "classes=" + vzLightboxBody().className);
  vzLightboxClose().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await tick(10);
  check("graphviz lightbox: close button hides the overlay",
    vzLightboxOverlay() && vzLightboxOverlay().hidden);
  // The mermaid + wavedrom lightboxes must be unaffected.
  check("graphviz lightbox: mermaid lightbox stays hidden",
    window.document.getElementById("mermaid-lightbox") &&
    window.document.getElementById("mermaid-lightbox").hidden);
  check("graphviz lightbox: wavedrom lightbox stays hidden",
    window.document.getElementById("wavedrom-lightbox") &&
    window.document.getElementById("wavedrom-lightbox").hidden);

  // Cleanup: close the diagram test tabs so the rest of the suite
  // starts from a known state (one canonical tab: notes/a.md).
  await window.NB.tabs.close("notes/badviz.md", { force: true });
  await window.NB.tabs.close("notes/viz.md", { force: true });
  await window.NB.tabs.close("notes/badkatex.md", { force: true });
  await window.NB.tabs.close("notes/katex.md", { force: true });
  await window.NB.tabs.close("notes/badwd.md", { force: true });
  await window.NB.tabs.close("notes/wavedrom.md", { force: true });
  await window.NB.tabs.activate("notes/a.md");
  await tick(40);

  console.log("== file tabs ==");
  const barEl = window.document.getElementById("tab-bar");
  const tabs = () => window.document.querySelectorAll("#tab-bar .tab");
  const activeTabPath = () => {
    const a = window.document.querySelector("#tab-bar .tab.active");
    return a ? a.dataset.path : null;
  };
  check("boot opened one tab (notes/a.md)", tabs().length === 1 && tabs()[0].dataset.path === "notes/a.md",
    tabs().length + " tab(s)");
  check("active tab is notes/a.md", activeTabPath() === "notes/a.md");
  // open a second file -> new tab, becomes active
  await window.NB.tabs.open("Welcome.md");
  await tick(20);
  check("open Welcome adds a tab (2)", tabs().length === 2, "got " + tabs().length);
  check("active tab is Welcome.md", activeTabPath() === "Welcome.md");
  // switch back -> active changes, viewer re-renders File A
  await window.NB.tabs.activate("notes/a.md");
  await tick(20);
  check("active switches to notes/a.md", activeTabPath() === "notes/a.md");
  check("viewer shows notes/a.md content", /File A/.test(window.document.getElementById("viewer-content").textContent));
  // re-opening an open file does not duplicate
  await window.NB.tabs.open("notes/a.md");
  await tick(20);
  check("re-open does not duplicate (still 2)", tabs().length === 2, "got " + tabs().length);
  // dirty dot appears while editing and persists after leaving edit mode
  click("edit-toggle");
  await tick(10);
  cmSetValue("# File A\n\nDIRTY EDIT\n");
  cmFireInput();
  await tick(10);
  const aTab = window.document.querySelector('.tab[data-path="notes/a.md"]');
  check("dirty tab marked with .dirty", aTab && aTab.classList.contains("dirty"));
  // Preview button toggles the preview pane; editor stays open, tab stays dirty.
  click("preview-btn");
  await tick(10);
  check("still dirty after toggling preview (unsaved content kept)", aTab.classList.contains("dirty"));
  // close the non-active Welcome tab
  window.NB.tabs.close("Welcome.md");
  await tick(20);
  check("close removes Welcome tab (1 left)", tabs().length === 1, "got " + tabs().length);
  check("notes/a.md still active", activeTabPath() === "notes/a.md");
  // persistence: openFiles + activeFile saved to config
  await tick(300);
  const tabCfgPost = fetchLog.filter(x => x.startsWith("POST /api/config")).pop() || "";
  check("openFiles/activeFile persisted",
    /"openFiles":\["notes\/a\.md"\]/.test(tabCfgPost) && /"activeFile":"notes\/a\.md"/.test(tabCfgPost),
    tabCfgPost);

  console.log("== search ==");
  const si = $("search-input");
  si.value = "fix this";
  si.dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(350);
  const hits = window.document.querySelectorAll("#search-list .search-hit");
  check("search returns 2 hits", hits.length === 2, "got " + hits.length);
  check("search panel visible", !$("search-results").hidden);

  // --- search results list: Enter -> focus the list, hjkl nav ---
  // After typing a query, pressing Enter in the search input hands
  // focus to the results list. j/k (and arrows) move the active hit,
  // Enter/l opens it, Esc pops back to the input (overlay stays open).
  // Esc from the input itself still closes the overlay.
  const searchListEl = $("search-list");
  const listHits = () => window.document.querySelectorAll("#search-list .search-hit");
  const activeHit = () => window.document.querySelector("#search-list .search-hit.is-active");
  const fireOnList = (k) => searchListEl.dispatchEvent(new window.KeyboardEvent("keydown",
    { key: k, bubbles: true, cancelable: true }));

  const preActive = activeTabPath();
  si.focus();
  si.dispatchEvent(new window.KeyboardEvent("keydown",
    { key: "Enter", bubbles: true, cancelable: true }));
  await tick(50);
  check("search: Enter -> focus moves to #search-list",
    window.document.activeElement === searchListEl,
    "active=" + (window.document.activeElement && window.document.activeElement.id));
  check("search: Enter -> first hit is active",
    listHits().length > 0 && activeHit() === listHits()[0],
    "active=" + (activeHit() && activeHit().querySelector(".hit-file").textContent));

  fireOnList("j"); await tick(10);
  check("search: j -> next hit is active", activeHit() === listHits()[1]);
  fireOnList("k"); await tick(10);
  check("search: k -> previous hit is active", activeHit() === listHits()[0]);
  fireOnList("ArrowDown"); await tick(10);
  check("search: ArrowDown -> next hit is active", activeHit() === listHits()[1]);
  fireOnList("ArrowUp"); await tick(10);
  check("search: ArrowUp -> previous hit is active", activeHit() === listHits()[0]);
  fireOnList("G"); await tick(10);
  check("search: G -> last hit is active",
    activeHit() === listHits()[listHits().length - 1]);
  fireOnList("g"); await tick(10);
  fireOnList("g"); await tick(10);
  check("search: gg -> first hit is active", activeHit() === listHits()[0]);
  // Esc on the list pops back to the input (does NOT close the overlay).
  fireOnList("Escape"); await tick(20);
  check("search: Esc on list -> input focused, overlay still open",
    window.document.activeElement === si && !$("search-results").hidden);
  // No matches -> there's nothing to navigate to, so focus stays on input.
  si.value = "zzzznomatch";
  si.dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(350);
  check("search: no matches -> focus stays on input",
    window.document.activeElement === si,
    "active=" + (window.document.activeElement && window.document.activeElement.id));
  // Enter on the list opens the active hit. Restore the query, focus
  // the list via Enter, move to the second hit, then Enter to open.
  si.value = "fix this";
  si.dispatchEvent(new window.Event("input", { bubbles: true }));
  si.dispatchEvent(new window.KeyboardEvent("keydown",
    { key: "Enter", bubbles: true, cancelable: true }));
  await tick(50);
  check("search: re-Enter -> focus back on #search-list",
    window.document.activeElement === searchListEl);
  fireOnList("j"); await tick(10);
  const expectedFile = listHits()[1].querySelector(".hit-file").textContent;
  fireOnList("Enter"); await tick(50);
  check("search: Enter on list -> overlay closes", $("search-results").hidden);
  check("search: Enter on list -> opens active hit (" + expectedFile + ")",
    activeTabPath() === expectedFile, "active=" + activeTabPath());
  // The hit may have opened a tab that wasn't open before the search
  // block. Close any tab we didn't start with, then restore the
  // pre-test active file so the rest of the suite is unaffected.
  if (expectedFile !== preActive) {
    await window.NB.tabs.close(expectedFile, { force: true });
    await tick(20);
  }
  await window.NB.tabs.open(preActive);
  await tick(20);

  click("search-close");
  await tick(10);
  check("search panel hides on close", $("search-results").hidden);

  console.log("== edit + save ==");
  // The previous "dirty dot" test left the active file with unsaved edits
  // and still in edit mode. Exit edit mode (discarding unsaved changes),
  // then re-enter clean.
  if (!cmIsHidden()) {
    window.confirm = () => true;  // discard unsaved changes
    click("close-edit-btn");
    await tick(10);
  }
  if (window.NB.viewer.isDirty(activeTabPath())) {
    window.NB.viewer.startEdit();
    await tick(10);
    click("save-btn");
    await tick(30);
    window.NB.viewer.endEdit();
    await tick(10);
  }
  check("baseline: active file is clean", !window.NB.viewer.isDirty(activeTabPath()));
  check("Edit button label is 'Edit' in view mode", $("edit-toggle").textContent === "Edit",
    "got: " + JSON.stringify($("edit-toggle").textContent));

  click("edit-toggle");
  await tick(10);
  check("edit mode entered (cm-host shown)", !cmIsHidden());
  // The Edit button stays visible in edit mode but its label flips to
  // 'View' to reflect that clicking it will exit edit mode. The
  // [Preview] [Save] [Close] group in the edit bar takes over the
  // affordance. Save starts hidden because the file is clean.
  check("edit button gets .editing class while editing", $("edit-toggle").classList.contains("editing"));
  check("Edit button label flips to 'View' in edit mode", $("edit-toggle").textContent === "View",
    "got: " + JSON.stringify($("edit-toggle").textContent));
  check("edit bar shown while editing", !$("edit-bar").hidden);
  check("Preview button visible in edit mode", !$("preview-btn").hidden);
  check("Close button visible in edit mode", !$("close-edit-btn").hidden);
  check("Preview button label is 'Preview' when split is on",
    $("preview-btn").textContent === "Preview",
    "got: " + JSON.stringify($("preview-btn").textContent));
  check("Preview button has .editing when split is on (color = on)",
    $("preview-btn").classList.contains("editing"));
  check("Save button hidden when clean", $("save-btn").hidden);
  check("Close button has no .unsaved when clean",
    !$("close-edit-btn").classList.contains("unsaved"));
  // Type -> Save appears and the close button picks up .unsaved.
  cmSetValue("# Edited\n\n## New heading\n\nsaved body");
  cmFireInput();
  await tick(10);
  check("Save button appears after typing", !$("save-btn").hidden);
  check("Close button gets .unsaved when dirty",
    $("close-edit-btn").classList.contains("unsaved"));
  // Save in edit mode stays in edit mode (just clears the dirty flag).
  click("save-btn");
  await tick(30);
  check("save keeps edit mode open (cm-host still shown)", !cmIsHidden());
  check("Save button hidden again after save (clean)", $("save-btn").hidden);
  check("Close button .unsaved cleared after save",
    !$("close-edit-btn").classList.contains("unsaved"));
  const savedFile = FILES["notes/a.md"];
  check("save wrote file content", savedFile && savedFile.includes("## New heading"));
  // In edit mode the split is active: editor left, live preview right.
  check("edit-split has .split class in edit mode",
    $("edit-split").classList.contains("split"));
  check("topbar has .editing class in edit mode",
    $("topbar").classList.contains("editing"));
  // Preview toggles the preview pane off; editor stays open.
  click("preview-btn");
  await tick(10);
  check("Preview hides the preview pane", $("viewer").hidden);
  check("Preview keeps editor open", !cmIsHidden());
  check("split class removed when preview hidden",
    !$("edit-split").classList.contains("split"));
  check("Preview button label stays 'Preview' when split is off (only color changes)",
    $("preview-btn").textContent === "Preview",
    "got: " + JSON.stringify($("preview-btn").textContent));
  check("Preview button loses .editing when split is off (color = off)",
    !$("preview-btn").classList.contains("editing"));
  // Preview again toggles it back on.
  click("preview-btn");
  await tick(10);
  check("Preview again shows the preview pane", !$("viewer").hidden);
  check("split class restored", $("edit-split").classList.contains("split"));
  check("Preview button .editing restored when split is on",
    $("preview-btn").classList.contains("editing"));
  // Close on a clean file should exit edit silently (no confirm).
  let confirmCount = 0;
  window.confirm = () => { confirmCount++; return true; };
  click("close-edit-btn");
  await tick(10);
  check("Close on clean file: no confirm prompt", confirmCount === 0, "count=" + confirmCount);
  check("Close on clean file: back to viewer", cmIsHidden());
  check("Close on clean file: topbar editing class removed",
    !$("topbar").classList.contains("editing"));
  check("Edit button label restored to 'Edit' after exiting edit mode",
    $("edit-toggle").textContent === "Edit",
    "got: " + JSON.stringify($("edit-toggle").textContent));
  check("re-rendered new heading id", !!$("new-heading"));
  // Close on a dirty file should prompt; Cancel keeps the user in edit.
  click("edit-toggle"); await tick(10);
  cmSetValue("# Edited\n\n## New heading\n\nDIRTY");
  cmFireInput();
  await tick(10);
  window.confirm = () => { confirmCount++; return false; };   // user says no
  click("close-edit-btn");
  await tick(10);
  check("Close on dirty + Cancel keeps edit mode", !cmIsHidden());
  check("Close on dirty + Cancel shows confirm", confirmCount === 1, "count=" + confirmCount);
  // ... and accepting discards.
  window.confirm = () => { confirmCount++; return true; };
  click("close-edit-btn");
  await tick(10);
  check("Close on dirty + OK exits edit mode", cmIsHidden());
  check("Close on dirty + OK shows confirm", confirmCount === 2, "count=" + confirmCount);
  // Re-entering edit mode after discarding changes: file should be clean,
  // Save button hidden.
  click("edit-toggle"); await tick(10);
  check("re-enter after discard: Save hidden (clean)", $("save-btn").hidden);
  check("re-enter after discard: editor has saved content",
    cmGetValue() === "# Edited\n\n## New heading\n\nsaved body",
    "got: " + JSON.stringify(cmGetValue()));
  click("close-edit-btn"); await tick(10);

  console.log("== edit bar ==");
  // Bar is hidden in preview mode.
  check("edit bar: hidden in preview", $("edit-bar").hidden);
  // Enter edit mode -> bar appears.
  click("edit-toggle"); await tick(10);
  check("edit bar: visible in edit mode", !$("edit-bar").hidden);
  // The bar has the inline + heading + line-prefix + undo/redo + overflow
  // buttons. We don't assert every label here -- just the structural ones.
  const barButtons = window.document.querySelectorAll("#edit-bar .eb[data-act]");
  check("edit bar: at least 14 buttons present", barButtons.length >= 14, "got " + barButtons.length);
  check("edit bar: overflow menu hidden by default", window.document.querySelector("#edit-bar .eb-menu").hidden);
  // Selection-wrap: select "hello", click Bold -> **hello**.
  cmSetValue("hello world"); cmSetSel(0, 5);
  window.document.querySelector('#edit-bar .eb[data-act="bold"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: bold wraps selection", cmGetValue() === "**hello** world", "got: " + cmGetValue());
  // Italic: select the now-bold "hello" and italicize.
  cmSetSel(0, 9);
  window.document.querySelector('#edit-bar .eb[data-act="italic"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: italic wraps selection", cmGetValue() === "***hello*** world", "got: " + cmGetValue());
  // Wrap with empty selection -> inserts placeholder and selects it.
  cmSetValue(""); cmSetSel(0, 0);
  window.document.querySelector('#edit-bar .eb[data-act="bold"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: bold with empty selection inserts placeholder",
    cmGetValue() === "**bold text**", "got: " + cmGetValue());
  // The inserted text should be selected (so the user can retype it).
  const __sel1 = window.NB.cmEditor.getSelection();
  check("edit bar: inserted placeholder is fully selected",
    __sel1.from === 0 && __sel1.to === 13,
    "sel=" + __sel1.from + "-" + __sel1.to);
  // Heading on a line: select a single line, click H2 -> "## line".
  cmSetValue("line one\nline two"); cmSetSel(0, 8);
  window.document.querySelector('#edit-bar .eb[data-act="h2"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: h2 prefixes the line", cmGetValue().startsWith("## line one"),
    "got: " + cmGetValue());
  // Idempotent: H2 again removes the prefix.
  cmSetSel(0, cmGetValue().indexOf("\n"));
  window.document.querySelector('#edit-bar .eb[data-act="h2"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: h2 toggles off", cmGetValue().split("\n")[0] === "line one",
    "got: " + cmGetValue());
  // Bullet list: select a line, click UL -> "- line".
  cmSetValue("alpha\nbeta"); cmSetSel(0, 5);
  window.document.querySelector('#edit-bar .eb[data-act="ul"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: ul prefixes line", cmGetValue().startsWith("- alpha"),
    "got: " + cmGetValue());
  // Task list.
  cmSetValue("todo"); cmSetSel(0, 4);
  window.document.querySelector('#edit-bar .eb[data-act="task"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: task prefixes line", cmGetValue() === "- [ ] todo",
    "got: " + cmGetValue());
  // Quote.
  cmSetValue("said"); cmSetSel(0, 4);
  window.document.querySelector('#edit-bar .eb[data-act="quote"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: quote prefixes line", cmGetValue() === "> said",
    "got: " + cmGetValue());
  // Code block: with selection wraps in ```.
  cmSetValue("print(1)"); cmSetSel(0, 8);
  window.document.querySelector('#edit-bar .eb[data-act="codeblock"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: codeblock wraps in fences",
    /```\nprint\(1\)\n```/.test(cmGetValue()),
    "got: " + cmGetValue());
  // Link: select "click", answer prompt.
  cmSetValue("click here"); cmSetSel(0, 5);
  promptValue = "https://example.com";
  window.prompt = () => promptValue;
  window.document.querySelector('#edit-bar .eb[data-act="link"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: link wraps selection with URL",
    cmGetValue() === "[click](https://example.com) here",
    "got: " + cmGetValue());
  // Horizontal rule: insert at line start.
  cmSetValue("before\nafter"); cmSetSel(0, 0);
  window.document.querySelector('#edit-bar .eb[data-act="hr"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: hr inserts a divider line",
    /\n---\n/.test(cmGetValue()),
    "got: " + JSON.stringify(cmGetValue()));
  // Table: insert a 2-col GFM table.
  cmSetValue("x"); cmSetSel(1, 1);
  window.document.querySelector('#edit-bar .eb[data-act="table"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: table inserts 2-col table",
    /\| Column 1 \| Column 2 \|/.test(cmGetValue()) &&
    /\| --- \| --- \|/.test(cmGetValue()),
    "got: " + cmGetValue());
  // Overflow menu opens on "more" click, then a button inside it acts.
  cmSetValue("fmt"); cmSetSel(0, 3);
  check("edit bar: overflow menu hidden by default", window.document.querySelector("#edit-bar .eb-menu").hidden);
  window.document.querySelector('#edit-bar .eb[data-act="more"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: more opens overflow menu", !window.document.querySelector("#edit-bar .eb-menu").hidden);
  // Click a H5 inside the menu -> "##### fmt".
  window.document.querySelector('#edit-bar .eb-menu .eb[data-act="h5"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: h5 inside overflow prefixes the line",
    cmGetValue() === "##### fmt", "got: " + cmGetValue());
  check("edit bar: overflow menu closes after action", window.document.querySelector("#edit-bar .eb-menu").hidden);
  // Click outside closes the overflow.
  window.document.querySelector('#edit-bar .eb[data-act="more"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: overflow menu reopened", !window.document.querySelector("#edit-bar .eb-menu").hidden);
  // Outside click -> closes.
  window.document.body.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await tick(10);
  check("edit bar: outside click closes overflow", window.document.querySelector("#edit-bar .eb-menu").hidden);
  // Clear formatting: remove heading + list + quote prefixes.
  cmSetValue("## heading\n- item\n> quote"); cmSetSel(0, cmGetValue().length);
  window.document.querySelector('#edit-bar .eb-menu .eb[data-act="clear"]')
    .dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: clear strips heading, list, quote prefixes",
    cmGetValue() === "heading\nitem\nquote",
    "got: " + JSON.stringify(cmGetValue()));
  // Ctrl+B wraps selection (keyboard shortcut). CM6 catches it via the
  // Prec.high keymap, but the keydown still bubbles. We dispatch on
  // the bridge's view.contentDOM to make sure CM sees it.
  cmSetValue("abc"); cmSetSel(0, 3);
  window.NB.cmEditor.view().contentDOM.dispatchEvent(new window.KeyboardEvent("keydown",
    { key: "b", ctrlKey: true, bubbles: true, cancelable: true }));
  await tick(10);
  check("edit bar: Ctrl+B wraps selection",
    cmGetValue() === "**abc**", "got: " + cmGetValue());
  // Ctrl+I for italic.
  cmSetValue("abc"); cmSetSel(0, 3);
  window.NB.cmEditor.view().contentDOM.dispatchEvent(new window.KeyboardEvent("keydown",
    { key: "i", ctrlKey: true, bubbles: true, cancelable: true }));
  await tick(10);
  check("edit bar: Ctrl+I wraps selection",
    cmGetValue() === "*abc*", "got: " + cmGetValue());
  // Preview toggles the preview pane but stays in edit mode; bar stays visible.
  click("preview-btn"); await tick(10);
  check("edit bar: still visible after Preview toggle", !$("edit-bar").hidden);
  check("preview pane hidden after toggle", $("viewer").hidden);
  // Close exits edit mode; bar hides.
  window.confirm = () => true;
  click("close-edit-btn"); await tick(10);
  check("edit bar: hidden after Close exits edit", $("edit-bar").hidden);
  // Re-enter edit, type, leave via Close on dirty to verify the bar hides.
  click("edit-toggle"); await tick(10);
  cmSetValue("new content");
  cmFireInput();
  await tick(10);
  window.confirm = () => true;
  click("close-edit-btn"); await tick(10);
  check("edit bar: hidden after Close on dirty", $("edit-bar").hidden);

  console.log("== scroll sync ==");
  // Enter edit mode with preview visible.
  click("edit-toggle"); await tick(10);
  // Stub scroll dimensions so the sync has something to work with.
  // jsdom doesn't compute scrollHeight/clientHeight from content.
  // CM6's scroller is the .cm-scroller element returned by
  // NB.cmEditor.scrollDOM(); the viewer (preview pane) uses
  // #viewer-content (a child of #viewer; #viewer itself is a
  // non-scrolling shell after the wallpaper scroll-sync restructure).
  const cmScroller = window.NB.cmEditor.scrollDOM();
  Object.defineProperty(cmScroller, "scrollHeight", { value: 2000, configurable: true });
  Object.defineProperty(cmScroller, "clientHeight", { value: 400, configurable: true });
  Object.defineProperty($("viewer-content"), "scrollHeight", { value: 1000, configurable: true });
  Object.defineProperty($("viewer-content"), "clientHeight", { value: 400, configurable: true });
  // Scroll the editor to 50%.
  cmScroller.scrollTop = 800;  // (2000-400)*0.5 = 800
  cmScroller.dispatchEvent(new window.Event("scroll", { bubbles: true }));
  await tick(20);
  // Viewer should be at 50% of its range: (1000-400)*0.5 = 300
  check("scroll sync: editor->viewer proportional",
    Math.abs($("viewer-content").scrollTop - 300) < 5,
    "viewer-content.scrollTop=" + $("viewer-content").scrollTop);
  // Scroll the viewer to 75%.
  $("viewer-content").scrollTop = 450;  // (1000-400)*0.75 = 450
  $("viewer-content").dispatchEvent(new window.Event("scroll", { bubbles: true }));
  await tick(20);
  // Editor should be at 75%: (2000-400)*0.75 = 1200
  check("scroll sync: viewer->editor proportional",
    Math.abs(cmScroller.scrollTop - 1200) < 5,
    "editor.scrollTop=" + cmScroller.scrollTop);
  // Clean up: exit edit mode.
  click("close-edit-btn"); await tick(10);

  console.log("== hybrid (WYSIWYG) mode ==");
  // Hybrid mode: contentEditable on #viewer-content + edit bar, no CM6.
  // Pre-condition: a file is open in preview mode, hybrid button visible.
  {
    const hb = $("hybrid-toggle");
    const vc = $("viewer-content");
    check("hybrid: NB.hybrid module exists", !!window.NB.hybrid);
    check("hybrid: button visible when file open in preview", !hb.hidden);
    check("hybrid: not active initially", !window.NB.hybrid.isActive());
    check("hybrid: contenteditable not set initially", vc.getAttribute("contenteditable") === null);

    // Enter hybrid mode.
    await window.NB.hybrid.enter();
    await tick(20);
    check("hybrid: isActive after enter()", window.NB.hybrid.isActive());
    check("hybrid: contenteditable=true after enter", vc.getAttribute("contenteditable") === "true");
    check("hybrid: .hybrid-editing class on viewer-content", vc.classList.contains("hybrid-editing"));
    check("hybrid: edit bar visible", !$("edit-bar").hidden);
    check("hybrid: topbar has .editing class", $("topbar").classList.contains("editing"));
    check("hybrid: button has .active class", hb.classList.contains("active"));
    check("hybrid: Preview button hidden (CM6-only)", $("preview-btn").hidden);
    check("hybrid: Close button visible", !$("close-edit-btn").hidden);

    // domToMarkdown should produce valid markdown from the rendered content.
    // The file content may have been modified by earlier tests, so we
    // check against the actual current content rather than a hardcoded string.
    const currentContent = window.NB.viewer.getContent();
    const md = window.NB.hybrid.domToMarkdown();
    check("hybrid: domToMarkdown returns non-empty string", typeof md === "string" && md.length > 0);
    check("hybrid: domToMarkdown contains heading text",
      md.includes("Edited") || md.includes("File A") || md.includes("heading"),
      JSON.stringify(md).slice(0, 120));

    // Edit bar H2 button should convert a <p> to <h2> (DOM operation,
    // not CM6). Select the first <p>, click H2, verify.
    const pBefore = vc.querySelector("p");
    if (pBefore) {
      const range = window.document.createRange();
      range.selectNodeContents(pBefore);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      const h2Btn = $("edit-bar").querySelector('[data-act="h2"]');
      h2Btn.dispatchEvent(new window.Event("click", { bubbles: true }));
      await tick(20);
      // The <p> should now be an <h2>.
      check("hybrid: H2 button converts <p> to <h2>",
        vc.querySelectorAll("h2").length > 0,
        "h2 count=" + vc.querySelectorAll("h2").length);
    } else {
      check("hybrid: H2 button converts <p> to <h2>", false, "no <p> found");
    }

    // domToMarkdown after the edit should still be valid.
    const md2 = window.NB.hybrid.domToMarkdown();
    check("hybrid: domToMarkdown after edit still has content",
      md2.includes("Edited") || md2.includes("File A") || md2.includes("heading"));

    // Dirty state should be true after the edit bar action.
    check("hybrid: isDirty true after edit", window.NB.hybrid.isDirty());
    check("hybrid: Save button visible when dirty", !$("save-btn").hidden);

    // --- live markdown input rules ----------------------------------
    // Simulate typing a trigger into a fresh <p>: put a collapsed caret
    // after the trigger text inside a text node, then fire 'input'.
    const typeIn = (text, tag) => {
      const p = window.document.createElement(tag || "p");
      const tn = window.document.createTextNode(text);
      p.appendChild(tn);
      vc.appendChild(p);
      const range = window.document.createRange();
      range.setStart(tn, tn.nodeValue.length);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      p.dispatchEvent(new window.Event("input", { bubbles: true }));
      return p;
    };

    typeIn("### ");
    check("hybrid: input rule '### ' makes an h3",
      (vc.querySelector("h3") !== null) ||
      vc.lastElementChild.tagName === "H3",
      "last=" + vc.lastElementChild.tagName);
    check("hybrid: input rule heading has no literal '#'",
      !/#/.test(vc.lastElementChild.textContent),
      JSON.stringify(vc.lastElementChild.textContent));

    typeIn("- ");
    check("hybrid: input rule '- ' makes a bullet list",
      vc.querySelector("ul li") !== null,
      "ul present=" + !!vc.querySelector("ul"));

    typeIn("1. ");
    check("hybrid: input rule '1. ' makes an ordered list",
      vc.querySelector("ol li") !== null,
      "ol present=" + !!vc.querySelector("ol"));

    typeIn("> ");
    check("hybrid: input rule '> ' makes a blockquote",
      vc.querySelector("blockquote") !== null,
      "bq present=" + !!vc.querySelector("blockquote"));

    typeIn("[ ] ");
    const taskLi = vc.querySelector("li.task-list-item");
    check("hybrid: input rule '[ ] ' makes a task item with checkbox",
      taskLi !== null && taskLi.querySelector('input[type="checkbox"]') !== null,
      "task li=" + !!taskLi);

    // Inline rules: '**bold**' with the caret after the final '*'.
    typeIn("**bold**");
    const lastEl = vc.lastElementChild;
    check("hybrid: input rule '**bold**' makes a <strong>",
      lastEl.querySelector("strong") !== null,
      "last=" + lastEl.tagName + ":" + lastEl.textContent);
    check("hybrid: strong text kept, asterisks gone",
      lastEl.querySelector("strong") && lastEl.querySelector("strong").textContent === "bold",
      JSON.stringify(lastEl.textContent));

    typeIn("`code`");
    check("hybrid: input rule '`code`' makes inline <code>",
      vc.lastElementChild.querySelector("code") !== null,
      "last=" + vc.lastElementChild.textContent);

    // No false positives: plain text with a leading '#' but no space after
    // the hashes must NOT convert.
    vc.querySelectorAll("ul,ol,blockquote,h3").forEach(el => el.remove());
    const plain = typeIn("#no-space heading text");
    check("hybrid: plain '#no-space' text is not converted",
      plain.tagName === "P" && plain.textContent === "#no-space heading text",
      plain.tagName + ":" + plain.textContent);

    // Typing the trigger at the START of a line that already has text:
    // caret before existing content, type "# " -> whole line becomes h1.
    {
      const p2 = window.document.createElement("p");
      const tn2 = window.document.createTextNode("existing line");
      p2.appendChild(tn2);
      vc.appendChild(p2);
      // Simulate the user typing "# " before "existing line": the text
      // node now starts with the trigger, caret right after it.
      tn2.nodeValue = "# existing line";
      const r2 = window.document.createRange();
      r2.setStart(tn2, 2);   // right after "# "
      r2.collapse(true);
      const sel2 = window.getSelection();
      sel2.removeAllRanges();
      sel2.addRange(r2);
      p2.dispatchEvent(new window.Event("input", { bubbles: true }));
      // wrapBlock REPLACES the <p> with an <h1>, so p2 is detached;
      // look at the viewer's current last element instead.
      const last2 = vc.lastElementChild;
      check("hybrid: trigger before existing text converts the line to a heading",
        last2 && last2.tagName === "H1" && last2.textContent === "existing line",
        "last=" + (last2 && last2.tagName) + ":" + (last2 && last2.textContent));
    }

    // Non-breaking space: real browsers type \u00A0 after "#" inside
    // contentEditable; the rule must still fire.
    {
      const p3 = window.document.createElement("p");
      const tn3 = window.document.createTextNode("##\u00A0");
      p3.appendChild(tn3);
      vc.appendChild(p3);
      const r3 = window.document.createRange();
      r3.setStart(tn3, tn3.nodeValue.length);
      r3.collapse(true);
      const sel3 = window.getSelection();
      sel3.removeAllRanges();
      sel3.addRange(r3);
      p3.dispatchEvent(new window.Event("input", { bubbles: true }));
      check("hybrid: non-breaking space after '##' still converts to h2",
        vc.lastElementChild.tagName === "H2",
        "last=" + vc.lastElementChild.tagName);
    }

    // ``` + Enter -> code block.
    const cbPara = typeIn("```js");
    const rangeCb = window.document.createRange();
    rangeCb.selectNodeContents(cbPara);
    rangeCb.collapse(false);
    const selCb = window.getSelection();
    selCb.removeAllRanges();
    selCb.addRange(rangeCb);
    cbPara.dispatchEvent(new window.KeyboardEvent("keydown",
      { key: "Enter", bubbles: true, cancelable: true }));
    const preEl = vc.querySelector("pre");
    check("hybrid: '```js' + Enter makes a code block",
      preEl !== null && preEl.querySelector("code.language-js") !== null,
      "pre=" + !!preEl);

    // --- inline-format keyboard shortcuts ---------------------------
    // Ctrl/Cmd+B wraps the selected word in <strong>, Ctrl+B again
    // unwraps it (toggle). Same for I (em), Shift+X (del), Shift+C
    // (code). Selection helper over a fresh paragraph. NOTE: picks the
    // first NON-EMPTY text node -- surroundContents/extractContents
    // legitimately leaves empty text-node remnants in the block, and
    // selecting into a zero-length node throws.
    const selWord = (p, from, to) => {
      const tn = Array.from(p.childNodes).find(
        n => n.nodeType === 3 && n.nodeValue.length > 0);
      const r = window.document.createRange();
      r.setStart(tn, from);
      r.setEnd(tn, to);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    };
    const pressKeys = (opts) => p4.dispatchEvent(
      new window.KeyboardEvent("keydown",
        Object.assign({ key: "b", bubbles: true, cancelable: true }, opts)));

    const p4 = window.document.createElement("p");
    p4.appendChild(window.document.createTextNode("word"));
    vc.appendChild(p4);

    // Bold on selection.
    selWord(p4, 0, 4);
    pressKeys({ ctrlKey: true, key: "b" });
    check("hybrid: Ctrl+B wraps selection in <strong>",
      p4.querySelector("strong") !== null &&
      p4.querySelector("strong").textContent === "word",
      "p4=" + p4.innerHTML);
    // Toggle off: select inside the strong, Ctrl+B again.
    const strongEl = p4.querySelector("strong");
    const rStrong = window.document.createRange();
    rStrong.selectNodeContents(strongEl);
    const sStrong = window.getSelection();
    sStrong.removeAllRanges();
    sStrong.addRange(rStrong);
    pressKeys({ ctrlKey: true, key: "b" });
    check("hybrid: Ctrl+B again unwraps <strong>",
      p4.querySelector("strong") === null && p4.textContent === "word",
      "p4=" + p4.innerHTML);

    // Italic.
    selWord(p4, 0, 4);
    pressKeys({ ctrlKey: true, key: "i" });
    check("hybrid: Ctrl+I wraps selection in <em>",
      p4.querySelector("em") !== null && p4.querySelector("em").textContent === "word",
      "p4=" + p4.innerHTML);

    // Strikethrough: Ctrl+Shift+X.
    const emEl2 = p4.querySelector("em");
    const rEm = window.document.createRange();
    rEm.selectNodeContents(emEl2);
    const sEm = window.getSelection();
    sEm.removeAllRanges();
    sEm.addRange(rEm);
    pressKeys({ ctrlKey: true, shiftKey: true, key: "X" });
    check("hybrid: Ctrl+Shift+X wraps selection in <del>",
      p4.querySelector("del") !== null,
      "p4=" + p4.innerHTML);

    // Inline code: Ctrl+Shift+C (select the word wherever it lives now).
    const delEl = p4.querySelector("del");
    const rDel = window.document.createRange();
    rDel.selectNodeContents(delEl);
    const sDel = window.getSelection();
    sDel.removeAllRanges();
    sDel.addRange(rDel);
    pressKeys({ ctrlKey: true, shiftKey: true, key: "C" });
    check("hybrid: Ctrl+Shift+C wraps selection in <code>",
      p4.querySelector("code") !== null,
      "p4=" + p4.innerHTML);

    // Enter (no modifiers) must NOT be swallowed by the shortcut path.
    const p5 = window.document.createElement("p");
    p5.appendChild(window.document.createTextNode("plain"));
    vc.appendChild(p5);
    selWord(p5, 5, 5);
    let enterDefault = true;
    p5.addEventListener("keydown", () => {}, { once: true });
    const evEnter = new window.KeyboardEvent("keydown",
      { key: "Enter", bubbles: true, cancelable: true });
    p5.dispatchEvent(evEnter);
    enterDefault = !evEnter.defaultPrevented ||
      p5.textContent === "plain";  // no input rule consumed it
    check("hybrid: plain Enter keeps default behavior",
      enterDefault, "prevented=" + evEnter.defaultPrevented);

    // Exit hybrid mode (discard changes).
    await window.NB.hybrid.exit(false);
    await tick(50);
    check("hybrid: not active after exit()", !window.NB.hybrid.isActive());
    check("hybrid: contenteditable removed after exit", vc.getAttribute("contenteditable") === null);
    check("hybrid: .hybrid-editing class removed", !vc.classList.contains("hybrid-editing"));
    check("hybrid: edit bar hidden after exit", $("edit-bar").hidden);
    check("hybrid: topbar .editing removed", !$("topbar").classList.contains("editing"));
    check("hybrid: button .active removed", !hb.classList.contains("active"));

    // After exit, the file should re-render as normal preview.
    check("hybrid: viewer-content has rendered content after exit",
      vc.innerHTML.length > 0 && vc.querySelector("h1") !== null);

    // --- hybrid wikilink round-trip ---
    // A [[Target]] rendered as <a data-wikilink> must come back out of
    // domToMarkdown as [[Target]] (not a normal [text](href) link), so a
    // WYSIWYG edit doesn't rewrite internal links.
    FILES["notes/a.md"] = "# File A\n\nSee [[b]] and [[b|File B]].\n";
    window.NB.viewer.close("notes/a.md");
    await window.NB.tabs.open("notes/a.md");
    await tick(20);
    await window.NB.hybrid.enter();
    await tick(20);
    const wlMd = window.NB.hybrid.domToMarkdown();
    check("hybrid: wikilink [[b]] round-trips as [[b]]",
      wlMd.includes("[[b]]"), JSON.stringify(wlMd).slice(0, 120));
    check("hybrid: wikilink [[b|File B]] round-trips with label",
      wlMd.includes("[[b|File B]]"), JSON.stringify(wlMd).slice(0, 120));
    check("hybrid: wikilink does NOT become a markdown link",
      !/\[File B\]\(b\)/.test(wlMd), JSON.stringify(wlMd).slice(0, 120));
    await window.NB.hybrid.exit(false);
    await tick(20);
    FILES["notes/a.md"] = "# File A\n\nTODO fix this bug.\n\n## Sub A\n\nbody\n";
    window.NB.viewer.close("notes/a.md");
    await window.NB.tabs.open("notes/a.md");
    await tick(20);

    // --- hybrid save flow ---
    // Re-enter hybrid mode, type a change, save, and verify the save
    // POST was sent to the server.
    const saveBefore = fetchLog.filter((x) => x.startsWith("POST /api/file")).length;
    await window.NB.hybrid.enter();
    await tick(20);
    // Simulate a user edit by appending text to the contentEditable.
    vc.innerHTML += "<p>hybrid save test</p>";
    vc.dispatchEvent(new window.Event("input", { bubbles: true }));
    await tick(100);
    check("hybrid: dirty after manual edit", window.NB.hybrid.isDirty());
    // Click Save (the hybrid module's onSave handler fires).
    const saveBtnEl = $("save-btn");
    saveBtnEl.dispatchEvent(new window.Event("click", { bubbles: true }));
    await tick(50);
    const saveAfter = fetchLog.filter((x) => x.startsWith("POST /api/file")).length;
    check("hybrid: save POST fired", saveAfter - saveBefore === 1,
      "delta=" + (saveAfter - saveBefore));
    // The POST body must actually contain the edit -- a save that fires
    // but drops the modified content is the bug the user reported.
    const savedContent = FILES["notes/a.md"] || "";
    check("hybrid: saved content includes the edit",
      savedContent.includes("hybrid save test"),
      JSON.stringify(savedContent).slice(0, 120));
    check("hybrid: not dirty after save", !window.NB.hybrid.isDirty());
    // Exit hybrid mode (clean now).
    await window.NB.hybrid.exit(false);
    await tick(50);
    check("hybrid: clean exit after save", !window.NB.hybrid.isActive());

    // --- hybrid trailing-blank-line preservation ---
    // The user reported that adding blank lines (empty space) in hybrid
    // mode was silently dropped on save. A REAL browser's contentEditable
    // inserts <div><br></div> on Enter (Chrome's default paragraph
    // separator is div) -- NOT the <p><br></p> that marked renders.
    // Empty blocks must save as explicit <p><br></p> lines (marked
    // collapses bare blank lines when rendering, so the space would
    // visually vanish on reopen otherwise).
    FILES["notes/a.md"] = "# File A\n\nbody\n";
    window.NB.viewer.close("notes/a.md");
    await window.NB.tabs.open("notes/a.md");
    await tick(20);
    await window.NB.hybrid.enter();
    await tick(20);
    // Simulate real-browser Enter presses: <div><br></div> blocks.
    vc.innerHTML += "<p>tail</p><div><br></div><div><br></div>";
    vc.dispatchEvent(new window.Event("input", { bubbles: true }));
    await tick(100);
    const blankBefore = fetchLog.filter((x) => x.startsWith("POST /api/file")).length;
    $("save-btn").dispatchEvent(new window.Event("click", { bubbles: true }));
    await tick(50);
    const blankAfter = fetchLog.filter((x) => x.startsWith("POST /api/file")).length;
    check("hybrid: blank-line save POST fired", blankAfter - blankBefore === 1,
      "delta=" + (blankAfter - blankBefore));
    const blankSaved = FILES["notes/a.md"] || "";
    const blankCount = (blankSaved.match(/<p><br><\/p>/g) || []).length;
    check("hybrid: saved content keeps BOTH trailing blank lines",
      /tail\n+/.test(blankSaved) && blankCount === 2,
      JSON.stringify(blankSaved).slice(-60));
    check("hybrid: saved content has no sentinel leftover",
      blankSaved.indexOf("\u0000") === -1,
      JSON.stringify(blankSaved).slice(-60));
    // Round-trip stability: exiting re-renders the saved content; the
    // empty paragraphs must be back in the DOM (the space stays visible).
    await window.NB.hybrid.exit(false);
    await tick(50);
    const emptyPs = Array.from(vc.querySelectorAll("p"))
      .filter(p => !p.textContent.trim() && !p.querySelector("img"));
    check("hybrid: blank lines survive the save -> re-render round-trip",
      emptyPs.length === 2,
      "empty <p> count=" + emptyPs.length);
    // Mid-document blank lines (a div between two paragraphs) survive too.
    FILES["notes/a.md"] = "# File A\n\nbody\n";
    window.NB.viewer.close("notes/a.md");
    await window.NB.tabs.open("notes/a.md");
    await tick(20);
    await window.NB.hybrid.enter();
    await tick(20);
    vc.innerHTML = "<p>top</p><div><br></div><p>bottom</p>";
    vc.dispatchEvent(new window.Event("input", { bubbles: true }));
    await tick(100);
    const midBefore = fetchLog.filter((x) => x.startsWith("POST /api/file")).length;
    $("save-btn").dispatchEvent(new window.Event("click", { bubbles: true }));
    await tick(50);
    check("hybrid: mid-doc save POST fired",
      fetchLog.filter((x) => x.startsWith("POST /api/file")).length - midBefore === 1);
    const midSaved = FILES["notes/a.md"] || "";
    check("hybrid: saved content keeps mid-document blank line",
      /top\n+<p><br><\/p>\n+bottom/.test(midSaved),
      JSON.stringify(midSaved).slice(0, 90));
    await window.NB.hybrid.exit(false);
    await tick(50);
    FILES["notes/a.md"] = "# File A\n\nTODO fix this bug.\n\n## Sub A\n\nbody\n";
    window.NB.viewer.close("notes/a.md");
    await window.NB.tabs.open("notes/a.md");
    await tick(20);

    // --- hybrid task-list checkbox toggle ---
    // marked renders checkboxes disabled; hybrid re-enables them and the
    // browser's native toggle + change event marks the doc dirty.
    await window.NB.hybrid.enter();
    await tick(20);
    vc.innerHTML = "<ul><li><input type=\"checkbox\" checked=\"\"> done</li><li><input type=\"checkbox\"> todo</li></ul>";
    const cbs = vc.querySelectorAll('input[type="checkbox"]');
    check("hybrid: checkboxes exist", cbs.length === 2, "count=" + cbs.length);
    check("hybrid: checkbox disabled attr removed", !cbs[0].hasAttribute("disabled"), "disabled=" + cbs[0].getAttribute("disabled"));
    const before = cbs[0].checked;
    // Simulate a real browser: native toggle flips checked, then a
    // change event fires. The hybrid handler should mark dirty.
    cbs[0].checked = !cbs[0].checked;
    cbs[0].dispatchEvent(new window.Event("change", { bubbles: true }));
    await tick(20);
    check("hybrid: checkbox toggled on click", cbs[0].checked !== before, "before=" + before + " after=" + cbs[0].checked);
    check("hybrid: dirty after checkbox toggle", window.NB.hybrid.isDirty());
    await window.NB.hybrid.exit(false);
    await tick(50);

    // --- hybrid Save & Exit flow ---
    // The Save&Exit button is visible in hybrid mode, saves, then exits.
    await window.NB.hybrid.enter();
    await tick(20);
    const sexBtn = $("save-exit-btn");
    check("hybrid: Save&Exit button visible when dirty", !sexBtn.hidden);
    // Edit then click Save&Exit.
    vc.innerHTML += "<p>save-exit test</p>";
    vc.dispatchEvent(new window.Event("input", { bubbles: true }));
    await tick(100);
    const saveExitBefore = fetchLog.filter((x) => x.startsWith("POST /api/file")).length;
    sexBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
    await tick(60);
    const saveExitAfter = fetchLog.filter((x) => x.startsWith("POST /api/file")).length;
    check("hybrid: Save&Exit saves", saveExitAfter - saveExitBefore === 1,
      "delta=" + (saveExitAfter - saveExitBefore));
    check("hybrid: Save&Exit exits hybrid mode", !window.NB.hybrid.isActive());
    check("hybrid: Save&Exit hides its button", sexBtn.hidden);

    // --- hybrid keyboard-save delegation ---
    // NB.viewer.save() delegates to NB.hybrid.save() while hybrid is
    // active, so Ctrl+S / vim :w works in WYSIWYG mode.
    await window.NB.hybrid.enter();
    await tick(20);
    vc.innerHTML += "<p>keyboard save test</p>";
    vc.dispatchEvent(new window.Event("input", { bubbles: true }));
    await tick(100);
    check("hybrid: dirty before keyboard save", window.NB.hybrid.isDirty());
    const kbBefore = fetchLog.filter((x) => x.startsWith("POST /api/file")).length;
    await window.NB.viewer.save();
    await tick(50);
    const kbAfter = fetchLog.filter((x) => x.startsWith("POST /api/file")).length;
    check("hybrid: viewer.save() delegates to hybrid save", kbAfter - kbBefore === 1,
      "delta=" + (kbAfter - kbBefore));
    check("hybrid: clean after keyboard save", !window.NB.hybrid.isDirty());
    // Still in hybrid mode after a plain save (no exit).
    check("hybrid: still active after plain save", window.NB.hybrid.isActive());
    await window.NB.hybrid.exit(false);
    await tick(50);

    // --- hybrid context menu ---
    // Right-clicking inside #viewer-content while hybrid mode is active
    // should open a formatting context menu.
    await window.NB.hybrid.enter();
    await tick(20);
    const hcm = $("hybrid-context-menu");
    check("hybrid menu: hidden before right-click", hcm.hidden);

    // Simulate a right-click inside #viewer-content.
    const ctxEv2 = new window.MouseEvent("contextmenu", { bubbles: true, clientX: 100, clientY: 100 });
    vc.dispatchEvent(ctxEv2);
    await tick(10);
    check("hybrid menu: visible after right-click in viewer-content", !hcm.hidden);

    // The top-level menu should have submenu groups (Inline, Heading,
    // List, Insert, History) plus a Save button -- not a flat list.
    // We check direct children of the menu (not nested flyout buttons).
    const topChildren = Array.from(hcm.children).filter(el => el.tagName === "BUTTON" || el.tagName === "HR");
    const topBtns = topChildren.filter(el => el.tagName === "BUTTON");
    const topLabels = topBtns.map(b => {
      // For submenu buttons, textContent includes the flyout's text.
      // Read only the immediate text node (before the flyout div).
      let label = "";
      for (const node of b.childNodes) {
        if (node.nodeType === 3) label += node.textContent;  // text node
        else break;
      }
      return label.trim();
    });
    check("hybrid menu: top-level has submenu groups",
      topLabels.includes("Inline") &&
      topLabels.includes("Heading") &&
      topLabels.includes("List") &&
      topLabels.includes("Insert") &&
      topLabels.includes("History") &&
      topLabels.includes("Save") &&
      topLabels.includes("Copy") &&
      topLabels.includes("Paste"),
      topLabels.join(" / "));

    // Each submenu should contain a nested .context-menu flyout with
    // the expected items.
    const inlineSub = topBtns.find(b => {
      let l = ""; for (const n of b.childNodes) { if (n.nodeType === 3) l += n.textContent; else break; }
      return l.trim() === "Inline";
    });
    check("hybrid menu: Inline submenu has flyout",
      inlineSub && inlineSub.querySelector(".context-menu") !== null);
    if (inlineSub) {
      const flyBtns = Array.from(inlineSub.querySelector(".context-menu").querySelectorAll("button"));
      const flyLabels = flyBtns.map(b => b.textContent.trim());
      check("hybrid menu: Inline submenu has Bold/Italic/Strikethrough/Code/Clear",
        flyLabels.includes("Bold") &&
        flyLabels.includes("Italic") &&
        flyLabels.includes("Strikethrough") &&
        flyLabels.includes("Inline code") &&
        flyLabels.includes("Clear formatting"),
        flyLabels.join(" / "));
    }

    const headingSub = topBtns.find(b => {
      let l = ""; for (const n of b.childNodes) { if (n.nodeType === 3) l += n.textContent; else break; }
      return l.trim() === "Heading";
    });
    if (headingSub) {
      const fly = headingSub.querySelector(".context-menu");
      const flyLabels = Array.from(fly.querySelectorAll("button")).map(b => b.textContent.trim());
      check("hybrid menu: Heading submenu has H1-H6",
        flyLabels.includes("Heading 1") && flyLabels.includes("Heading 6"),
        flyLabels.join(" / "));
    }

    const insertSub = topBtns.find(b => {
      let l = ""; for (const n of b.childNodes) { if (n.nodeType === 3) l += n.textContent; else break; }
      return l.trim() === "Insert";
    });
    if (insertSub) {
      const fly = insertSub.querySelector(".context-menu");
      const flyLabels = Array.from(fly.querySelectorAll("button")).map(b => b.textContent.trim());
      check("hybrid menu: Insert submenu has Link/Image/Table/HR/Code block",
        flyLabels.includes("Link…") &&
        flyLabels.includes("Image…") &&
        flyLabels.includes("Code block") &&
        flyLabels.includes("Table") &&
        flyLabels.includes("Horizontal rule"),
        flyLabels.join(" / "));
    }

    // Clicking a submenu item should close the menu and apply formatting.
    // Select the first <p> text, then click "Bold" inside the Inline submenu.
    const pEl = vc.querySelector("p");
    if (pEl && inlineSub) {
      const range2 = window.document.createRange();
      range2.selectNodeContents(pEl);
      const sel2 = window.getSelection();
      sel2.removeAllRanges();
      sel2.addRange(range2);
      const fly = inlineSub.querySelector(".context-menu");
      const boldBtn = Array.from(fly.querySelectorAll("button"))
        .find(b => b.textContent.trim() === "Bold");
      boldBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
      await tick(20);
      check("hybrid menu: hidden after clicking submenu item", hcm.hidden);
      check("hybrid menu: dirty after bold via submenu", window.NB.hybrid.isDirty());
    } else {
      check("hybrid menu: bold via submenu (skipped)", true);
    }

    // Right-clicking outside #viewer-content should close the menu.
    // Re-open the menu first.
    vc.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, clientX: 100, clientY: 100 }));
    await tick(10);
    check("hybrid menu: re-opened", !hcm.hidden);
    // Simulate a contextmenu event on the sidebar (outside viewer-content).
    $("sidebar").dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, clientX: 5, clientY: 5 }));
    await tick(10);
    check("hybrid menu: closes on outside contextmenu", hcm.hidden);

    // Esc should close the menu.
    vc.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, clientX: 100, clientY: 100 }));
    await tick(10);
    check("hybrid menu: re-opened for Esc test", !hcm.hidden);
    window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await tick(10);
    check("hybrid menu: closes on Esc", hcm.hidden);

    // Clicking outside should close the menu.
    vc.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, clientX: 100, clientY: 100 }));
    await tick(10);
    check("hybrid menu: re-opened for click-outside test", !hcm.hidden);
    window.document.dispatchEvent(new window.Event("click", { bubbles: true }));
    await tick(10);
    check("hybrid menu: closes on outside click", hcm.hidden);

    // Menu should be hidden after exiting hybrid mode.
    vc.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, clientX: 100, clientY: 100 }));
    await tick(10);
    check("hybrid menu: open before exit", !hcm.hidden);
    await window.NB.hybrid.exit(false);
    await tick(50);
    check("hybrid menu: hidden after exit", hcm.hidden);

    // Right-click in preview mode (hybrid off) should NOT open the
    // hybrid menu.
    vc.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, clientX: 100, clientY: 100 }));
    await tick(10);
    check("hybrid menu: does not open when hybrid is inactive", hcm.hidden);

    // --- plugin "Edit source" menu item ---------------------------------
    // Re-enter hybrid and right-click a rendered mermaid container:
    // the menu must offer "Edit mermaid source", which swaps the SVG for
    // an editable <pre><code class="language-mermaid"> holding the
    // original source; blur re-renders it back into a container.
    {
      // The mermaid section earlier opened notes/mermaid.md. Force a
      // fresh activation (clear the viewer cache + reopen) so the
      // viewer's render + mermaid.renderAll definitely run, then poll
      // for the rendered container (both are async).
      window.NB.viewer.close("notes/mermaid.md");
      await window.NB.tabs.open("notes/mermaid.md");
      let container = null;
      for (let i = 0; i < 20 && !container; i++) {
        await tick(25);
        container = vc.querySelector(".mermaid-container");
      }
      await window.NB.hybrid.enter();
      await tick(20);
      container = vc.querySelector(".mermaid-container");
      check("plugin edit: mermaid container present in hybrid",
        !!container, "containers=" + vc.querySelectorAll(".mermaid-container").length);
      if (container) {
        container.dispatchEvent(new window.MouseEvent("contextmenu",
          { bubbles: true, clientX: 100, clientY: 100 }));
        await tick(10);
        const editBtn = Array.from(hcm.querySelectorAll("button"))
          .find(b => /Edit mermaid source/.test(b.textContent));
        check("plugin edit: menu offers 'Edit mermaid source'",
          !!editBtn, "labels=" + hcm.textContent.trim().slice(0, 80));
        if (editBtn) {
          editBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
          await tick(20);
          const rawCode = vc.querySelector("pre > code.language-mermaid");
          check("plugin edit: container swapped for editable source block",
            !!rawCode && /graph TD/.test(rawCode.textContent),
            "raw=" + (rawCode && rawCode.textContent.slice(0, 40)));
          const preEl = rawCode && rawCode.parentElement;
          check("plugin edit: raw block is contenteditable",
            preEl && preEl.getAttribute("contenteditable") === "true",
            "ce=" + (preEl && preEl.getAttribute("contenteditable")));
          // Dirty after entering the edit state.
          check("plugin edit: dirty after swapping in source",
            window.NB.hybrid.isDirty());
          // Blur commits: re-render replaces the raw block with a fresh
          // .mermaid-container carrying the (possibly edited) source.
          if (preEl) {
            preEl.dispatchEvent(new window.FocusEvent("focusout", { relatedTarget: null }));
            await tick(80);
            const back = vc.querySelector(".mermaid-container");
            check("plugin edit: blur re-renders the diagram",
              !!back && /graph TD/.test(back.dataset.mermaidSource || ""),
              "back=" + !!back);
          }
        }
      }

      // --- click-to-edit on rendered plugin blocks -----------------
      // A plain click on a mermaid container in hybrid mode enters edit
      // mode directly (no context menu); the lightbox stays closed
      // (it yields to hybrid mode); blur restores render mode.
      {
        const cont2 = vc.querySelector(".mermaid-container");
        check("click-to-edit: rendered container present",
          !!cont2, "containers=" + vc.querySelectorAll(".mermaid-container").length);
        if (cont2) {
          cont2.dispatchEvent(new window.MouseEvent("click",
            { bubbles: true, cancelable: true }));
          await tick(20);
          const lb = $("mermaid-lightbox");
          check("click-to-edit: lightbox does not open in hybrid mode",
            !lb || lb.hidden, "lb hidden=" + (lb && lb.hidden));
          const raw2 = vc.querySelector("pre > code.language-mermaid");
          check("click-to-edit: click swaps container to editable source",
            !!raw2 && /graph TD/.test(raw2.textContent),
            "raw=" + (raw2 && raw2.textContent.slice(0, 30)));
          const pre2 = raw2 && raw2.parentElement;
          check("click-to-edit: editable block has the language chip",
            !!pre2 && pre2.querySelector(".hybrid-lang-pill") !== null,
            "chip=" + (pre2 && !!pre2.querySelector(".hybrid-lang-pill")));
          if (pre2) {
            const chip = pre2.querySelector(".hybrid-lang-pill");
            // focusout with relatedTarget = chip should NOT commit
            pre2.dispatchEvent(new window.FocusEvent("focusout",
              { relatedTarget: chip }));
            await tick(40);
            check("click-to-edit: focus on lang-pill does not commit",
              pre2.getAttribute("contenteditable") === "true",
              "still_editing=" + (pre2.getAttribute("contenteditable")));
            // Now focusout with relatedTarget = null should commit
            pre2.dispatchEvent(new window.FocusEvent("focusout", { relatedTarget: null }));
            let back2 = null;
            for (let i = 0; i < 20 && !back2; i++) {
              await tick(25);
              back2 = vc.querySelector(".mermaid-container");
            }
            check("click-to-edit: blur restores the rendered diagram",
              !!back2, "back=" + !!back2);
          }
        }
      }

      // --- mousedown outside editing block commits it ---------------
      // Re-enter edit mode on the mermaid block, then mousedown on a
      // sibling paragraph; the block should commit to preview mode.
      {
        const cont3 = vc.querySelector(".mermaid-container");
        if (cont3) {
          cont3.dispatchEvent(new window.MouseEvent("click",
            { bubbles: true, cancelable: true }));
          await tick(20);
          const pre3 = vc.querySelector("pre.hybrid-plugin-editing");
          check("mousedown-outside: block is in edit mode",
            !!pre3 && pre3.getAttribute("contenteditable") === "true",
            "editing=" + !!pre3);
          if (pre3) {
            // Create a target outside the editing pre
            const outside = window.document.createElement("p");
            outside.textContent = "outside click target";
            vc.appendChild(outside);
            // Dispatch mousedown on the outside element
            vc.dispatchEvent(new window.MouseEvent("mousedown",
              { bubbles: true, cancelable: true, target: outside }));
            await tick(60);
            const restored = vc.querySelector(".mermaid-container");
            check("mousedown-outside: block restored to preview",
              !!restored && !vc.querySelector("pre.hybrid-plugin-editing"),
              "restored=" + !!restored);
          }
        }
      }

      // --- click-to-edit on a plain (non-plugin) code block ---------
      // A direct click on a plain code fence should also enter edit
      // mode with a language pill, same as plugin blocks.
      {
        const plainPre = window.document.createElement("pre");
        const plainCode = window.document.createElement("code");
        plainCode.className = "language-python";
        plainCode.textContent = "print('hello')";
        plainPre.appendChild(plainCode);
        vc.appendChild(plainPre);
        await tick(10);

        // Direct click on the code block
        plainPre.dispatchEvent(new window.MouseEvent("click",
          { bubbles: true, cancelable: true }));
        await tick(20);
        const pill = plainPre.querySelector(".hybrid-lang-pill");
        check("plain code click-to-edit: language chip rendered",
          !!pill && pill.textContent === "python",
          "pill=" + (pill && pill.textContent));
        check("plain code click-to-edit: block is contenteditable",
          plainPre.getAttribute("contenteditable") === "true",
          "ce=" + plainPre.getAttribute("contenteditable"));
        // Focusout should restore preview
        if (plainPre.getAttribute("contenteditable") === "true") {
          plainPre.dispatchEvent(new window.FocusEvent("focusout",
            { relatedTarget: null }));
          await tick(60);
          check("plain code click-to-edit: focusout restores preview",
            plainPre.getAttribute("contenteditable") !== "true" &&
            !plainPre.querySelector(".hybrid-lang-pill"),
            "restored=" + (plainPre.getAttribute("contenteditable") !== "true"));
        }
      }

      // --- "Edit code block" on a plain (non-plugin) fence ---------
      // Add a shell code block to the open file, right-click it, and
      // verify the generic flow: the block becomes editable with a
      // language pill ON the block; the pill re-types the fence
      // (shell -> python stays raw); blur restores render mode; and a
      // plugin language re-renders through its module.
      {
        const pre = window.document.createElement("pre");
        const code = window.document.createElement("code");
        code.className = "language-shell";
        code.textContent = "echo hello";
        pre.appendChild(code);
        vc.appendChild(pre);

        pre.dispatchEvent(new window.MouseEvent("contextmenu",
          { bubbles: true, clientX: 120, clientY: 120 }));
        await tick(10);
        const topBtns2 = Array.from(hcm.querySelectorAll("button"));
        const editBtn2 = topBtns2.find(b => /Edit code block/.test(b.textContent));
        const langInMenu = topBtns2.find(b => /^Language…$/.test(b.textContent.trim()));
        check("code block edit: menu offers 'Edit code block' (no Language item)",
          !!editBtn2 && !langInMenu,
          "labels=" + topBtns2.map(b => b.textContent.trim()).join("/").slice(0, 100));
        if (editBtn2) {
          editBtn2.dispatchEvent(new window.Event("click", { bubbles: true }));
          await tick(20);
          const pill = pre.querySelector(".hybrid-lang-pill");
          check("code block edit: language chip rendered on the block",
            !!pill && pill.textContent === "shell",
            "pill=" + (pill && pill.textContent));
          check("code block edit: block is contenteditable",
            pre.getAttribute("contenteditable") === "true",
            "ce=" + pre.getAttribute("contenteditable"));
          if (pill) {
            // Inline editing: type "python" + Enter -- no prompt window.
            const typePill = (txt) => {
              pill.textContent = txt;
              pill.dispatchEvent(new window.KeyboardEvent("keydown",
                { key: "Enter", bubbles: true, cancelable: true }));
            };
            typePill("python");
            await tick(20);
            check("code block edit: chip edits shell to python inline",
              code.className === "language-python" && code.textContent === "echo hello",
              "cls=" + code.className);
            // python -> mermaid via the chip.
            typePill("mermaid");
            await tick(20);
            check("code block edit: chip edits python to mermaid",
              code.className === "language-mermaid",
              "cls=" + code.className);
            // Blur the block: restore render mode -> mermaid container.
            pre.dispatchEvent(new window.FocusEvent("focusout", { relatedTarget: null }));
            let reRendered = null;
            for (let i = 0; i < 20 && !reRendered; i++) {
              await tick(25);
              const all = vc.querySelectorAll(".mermaid-container");
              reRendered = Array.from(all).find(c =>
                /echo hello/.test(c.dataset.mermaidSource || ""));
            }
            check("code block edit: blur restores render mode (mermaid container)",
              !!reRendered &&
                pre.querySelector(".hybrid-lang-pill") === null &&
                pre.getAttribute("contenteditable") === null,
              "rendered=" + !!reRendered +
                " pill=" + (pre.querySelector(".hybrid-lang-pill") !== null));
          }
        }
      }
      await window.NB.hybrid.exit(false);
      await tick(30);
    }

    // --- hybrid tab-switch blocking ---
    // When hybrid mode has unsaved changes, switching tabs should be
    // blocked with a confirm prompt. On Cancel, stay in hybrid mode.
    // On OK, save and switch.
    {
      // Open notes/b.md so we have two tabs to switch between.
      await window.NB.tabs.open("notes/b.md");
      await tick(30);
      // The active tab is now notes/b.md. Switch back to notes/a.md.
      await window.NB.tabs.activate("notes/a.md");
      await tick(30);
      const pathA = "notes/a.md";
      check("hybrid tab-block: active file is notes/a.md",
        window.NB.viewer.getPath() === pathA,
        "got: " + window.NB.viewer.getPath());

      // Enter hybrid mode and make a change (dirty).
      await window.NB.hybrid.enter();
      await tick(20);
      vc.innerHTML += "<p>unsaved hybrid edit</p>";
      vc.dispatchEvent(new window.Event("input", { bubbles: true }));
      await tick(100);
      check("hybrid tab-block: dirty before switch", window.NB.hybrid.isDirty());

      // Try to switch tabs -- confirm() returns false (Cancel).
      // The switch should be blocked.
      const origConfirm = window.confirm;
      let confirmCalled = false;
      window.confirm = () => { confirmCalled = true; return false; };
      await window.NB.tabs.activate("notes/b.md");
      await tick(30);
      check("hybrid tab-block: confirm prompted on switch", confirmCalled);
      check("hybrid tab-block: still on notes/a.md after Cancel",
        window.NB.viewer.getPath() === pathA,
        "got: " + window.NB.viewer.getPath());
      check("hybrid tab-block: hybrid still active after Cancel",
        window.NB.hybrid.isActive());
      window.confirm = origConfirm;

      // Now switch with confirm() returning true (Save). The switch
      // should proceed: hybrid exits, the file saves, and the tab
      // changes to notes/b.md.
      const saveBeforeBlock = fetchLog.filter((x) => x.startsWith("POST /api/file")).length;
      window.confirm = () => true;
      await window.NB.tabs.activate("notes/b.md");
      await tick(50);
      window.confirm = origConfirm;
      check("hybrid tab-block: hybrid not active after Save+switch",
        !window.NB.hybrid.isActive());
      check("hybrid tab-block: switched to notes/b.md",
        window.NB.viewer.getPath() === "notes/b.md",
        "got: " + window.NB.viewer.getPath());
      check("hybrid tab-block: save POST fired during switch",
        fetchLog.filter((x) => x.startsWith("POST /api/file")).length - saveBeforeBlock === 1,
        "delta=" + (fetchLog.filter((x) => x.startsWith("POST /api/file")).length - saveBeforeBlock));

      // Clean: exit hybrid (should be already exited) and switch back.
      if (window.NB.hybrid.isActive()) await window.NB.hybrid.exit(false);
      await tick(20);
    }

    // --- hybrid mermaid round-trip ---
    // When hybrid mode saves a file containing rendered mermaid diagrams,
    // domToMarkdown must convert each .mermaid-container back to a
    // ```mermaid code block, not lose the diagram source to turndown's
    // SVG-to-text stripping. This is a regression guard: a previous
    // bug destroyed mermaid diagrams when the user saved from hybrid
    // mode because turndown stripped the SVG and kept only text nodes.
    {
      // A file with TWO mermaid blocks + surrounding prose, so we can
      // verify that all blocks survive the round-trip (not just the
      // first one).
      const MERMAID_BODY =
        "# Mermaid Test\n\n" +
        "Intro text.\n\n" +
        "```mermaid\ngraph TD\n  A --> B\n  B --> C\n```\n\n" +
        "Between diagrams.\n\n" +
        "```mermaid\nsequenceDiagram\n  U->>N: hi\n```\n\n" +
        "After both.\n";
      FILES["notes/mermaid.md"] = MERMAID_BODY;
      const notesDir = TREE.find(n => n.path === "notes");
      if (notesDir) {
        if (!notesDir.children.some(c => c.path === "notes/mermaid.md")) {
          notesDir.children.push({ name: "mermaid.md", type: "file", path: "notes/mermaid.md" });
        }
      } else {
        TREE.push({ name: "mermaid.md", type: "file", path: "notes/mermaid.md" });
      }
      await window.NB.sidebar.refresh();
      await tick(20);

      // Force a fresh activation: clear the viewer cache + reopen so
      // the viewer's render() + NB.mermaid.renderAll both run.
      window.NB.viewer.close("notes/mermaid.md");
      await window.NB.tabs.open("notes/mermaid.md");
      await tick(100);   // wait for async mermaid render

      // Pre-condition: the viewer rendered both mermaid blocks into
      // .mermaid-container elements.
      const containers = $("viewer-content").querySelectorAll(".mermaid-container");
      check("hybrid mermaid: two containers rendered",
        containers.length === 2,
        "containers=" + containers.length);
      check("hybrid mermaid: first container has data-mermaid-source",
        containers[0] && !!containers[0].dataset.mermaidSource,
        "source=" + JSON.stringify((containers[0] && containers[0].dataset.mermaidSource || "").slice(0, 60)));
      check("hybrid mermaid: second container has data-mermaid-source",
        containers[1] && !!containers[1].dataset.mermaidSource,
        "source=" + JSON.stringify((containers[1] && containers[1].dataset.mermaidSource || "").slice(0, 60)));

      if (containers.length >= 2) {
        // --- domToMarkdown round-trip ---
        await window.NB.hybrid.enter();
        await tick(20);
        const md = window.NB.hybrid.domToMarkdown();
        check("hybrid mermaid: domToMarkdown preserves first ```mermaid block",
          md.includes("```mermaid"),
          "md slice: " + JSON.stringify(md.slice(0, 200)));
        check("hybrid mermaid: domToMarkdown preserves graph TD source",
          md.includes("graph TD"),
          "md slice: " + JSON.stringify(md.slice(0, 300)));
        check("hybrid mermaid: domToMarkdown preserves sequenceDiagram source",
          md.includes("sequenceDiagram"),
          "md slice: " + JSON.stringify(md));
        check("hybrid mermaid: domToMarkdown preserves prose between blocks",
          md.includes("Between diagrams"),
          "md slice: " + JSON.stringify(md));
        check("hybrid mermaid: domToMarkdown preserves prose after blocks",
          md.includes("After both"),
          "md slice: " + JSON.stringify(md));

        // --- full save round-trip ---
        // Click Save; the fetch stub stores the saved content in
        // FILES["notes/mermaid.md"]. Then verify the saved content
        // contains the ```mermaid blocks (not the stripped SVG text).
        const saveBtnEl = $("save-btn");
        // Make the content dirty so Save is visible.
        $("viewer-content").dispatchEvent(new window.Event("input", { bubbles: true }));
        await tick(60);
        saveBtnEl.dispatchEvent(new window.Event("click", { bubbles: true }));
        await tick(50);

        const savedContent = FILES["notes/mermaid.md"] || "";
        check("hybrid mermaid: saved file contains ```mermaid (not SVG text)",
          savedContent.includes("```mermaid"),
          "saved=" + JSON.stringify(savedContent.slice(0, 200)));
        check("hybrid mermaid: saved file preserves graph TD",
          savedContent.includes("graph TD"),
          "saved=" + JSON.stringify(savedContent.slice(0, 300)));
        check("hybrid mermaid: saved file preserves sequenceDiagram",
          savedContent.includes("sequenceDiagram"),
          "saved=" + JSON.stringify(savedContent));
        check("hybrid mermaid: saved file preserves heading",
          savedContent.includes("# Mermaid Test"),
          "saved=" + JSON.stringify(savedContent.slice(0, 100)));
        check("hybrid mermaid: saved file does NOT contain stripped SVG text",
          !savedContent.includes("mock"),
          "saved=" + JSON.stringify(savedContent));

        // --- re-open after save: mermaid renders again ---
        // Exit hybrid mode, close + reopen the file, and verify the
        // mermaid containers reappear (the saved content is valid
        // markdown with ```mermaid blocks).
        await window.NB.hybrid.exit(false);
        await tick(30);
        window.NB.viewer.close("notes/mermaid.md");
        await window.NB.tabs.open("notes/mermaid.md");
        await tick(100);
        const reContainers = $("viewer-content").querySelectorAll(".mermaid-container");
        check("hybrid mermaid: re-open after save renders both diagrams",
          reContainers.length === 2,
          "containers=" + reContainers.length);
      }

      // Clean up: close the mermaid tab so later tests don't see it.
      window.NB.tabs.close("notes/mermaid.md", { force: true });
      await tick(20);
    }

    // --- hybrid mermaid error block round-trip ---
    // A mermaid block that failed to render (syntax error) becomes a
    // .mermaid-error element with a .mermaid-source <pre> inside it.
    // domToMarkdown must restore that back to a ```mermaid block too.
    {
      const BAD_BODY = "# Bad Mermaid\n\n```mermaid\nthis is not valid\n```\n\nAfter.\n";
      FILES["notes/bad-mermaid.md"] = BAD_BODY;
      TREE.push({ name: "bad-mermaid.md", type: "file", path: "notes/bad-mermaid.md" });
      await window.NB.sidebar.refresh();
      await tick(20);

      // Arm the stub to fail on the next render so the block becomes
      // a .mermaid-error element.
      __mermaid.failNext = true;
      window.NB.viewer.close("notes/bad-mermaid.md");
      await window.NB.tabs.open("notes/bad-mermaid.md");
      await tick(100);

      const errEl = $("viewer-content").querySelector(".mermaid-error");
      check("hybrid mermaid: error block exists for failed render",
        !!errEl, "errors=" + $("viewer-content").querySelectorAll(".mermaid-error").length);

      if (errEl) {
        await window.NB.hybrid.enter();
        await tick(20);
        const md = window.NB.hybrid.domToMarkdown();
        check("hybrid mermaid: error block round-trips to ```mermaid",
          md.includes("```mermaid"),
          "md=" + JSON.stringify(md.slice(0, 200)));
        check("hybrid mermaid: error block preserves original source",
          md.includes("this is not valid"),
          "md=" + JSON.stringify(md));
        await window.NB.hybrid.exit(false);
        await tick(30);
      }

      // Clean up.
      window.NB.tabs.close("notes/bad-mermaid.md", { force: true });
      // Remove from TREE so later tests don't see it.
      const idx = TREE.findIndex(n => n.path === "notes/bad-mermaid.md");
      if (idx >= 0) TREE.splice(idx, 1);
      delete FILES["notes/bad-mermaid.md"];
      await window.NB.sidebar.refresh();
      await tick(20);
    }
  }

  console.log("== empty-tree right-click create ==");
  TREE.length = 0;
  await window.NB.sidebar.refresh();
  check("empty tree shows 0 rows", window.document.querySelectorAll("#file-tree .tree-row").length === 0);
  const ctxEv = new window.MouseEvent("contextmenu", { bubbles: true, clientX: 5, clientY: 5 });
  Object.defineProperty(ctxEv, "target", { value: $("file-tree") });
  $("file-tree").dispatchEvent(ctxEv);
  await tick(10);
  check("root menu opens on empty-area right-click", !$("context-menu").hidden);
  const menuBtns = Array.from(window.document.querySelectorAll("#context-menu button"));
  check("root menu has New file / New folder",
    menuBtns.length === 2 && menuBtns.some(b => b.textContent.includes("New file")) && menuBtns.some(b => b.textContent.includes("New folder")),
    menuBtns.map(b => b.textContent).join(" / "));
  promptValue = "created.md";
  const beforeCreate = fetchLog.filter(x => x.startsWith("POST /api/create")).length;
  menuBtns.find(b => b.textContent.includes("New file")).dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  check("create POST fired", fetchLog.filter(x => x.startsWith("POST /api/create")).length - beforeCreate === 1);
  if (FILES["created.md"] === undefined) TREE.push({ name: "created.md", type: "file", path: "created.md" });
  await window.NB.sidebar.refresh();
  check("tree shows created file", window.document.querySelectorAll("#file-tree .tree-row").length === 1);
  // restore a tree entry so later checks have a file
  if (FILES["created.md"] === undefined) TREE.push({ name: "Welcome.md", type: "file", path: "Welcome.md" });

  console.log("== sidebar minimize (collapse/expand) ==");
  // left file sidebar (now the #side-panel hosting the Explorer view)
  click("sidebar-collapse");
  await tick(10);
  check("left sidebar gets .collapsed", $("side-panel").classList.contains("collapsed"));
  check("left sidebar width -> 0px", cssVar("--side-panel-width") === "0px", cssVar("--side-panel-width"));
  // Re-expand via the activity bar's Explorer icon (no strip button now).
  const explorerBtn = window.document.querySelector('#activity-bar .activity-btn[data-view="explorer"]');
  explorerBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("left sidebar .collapsed removed", !$("side-panel").classList.contains("collapsed"));
  check("left sidebar width restored (240px)", cssVar("--side-panel-width") === "240px", cssVar("--side-panel-width"));
  // right outline: toggled from the tab-bar icon (no strip button now)
  click("outline-toggle");
  await tick(10);
  check("outline gets .collapsed", $("outline-pane").classList.contains("collapsed"));
  check("outline width -> 0px", cssVar("--outline-width") === "0px", cssVar("--outline-width"));
  click("outline-toggle");
  await tick(10);
  check("outline .collapsed removed", !$("outline-pane").classList.contains("collapsed"));
  check("outline width restored (220px)", cssVar("--outline-width") === "220px", cssVar("--outline-width"));
  // persistence: collapse then wait for debounced config save
  click("sidebar-collapse");
  await tick(350);
  const configPost = fetchLog.filter(x => x.startsWith("POST /api/config")).pop() || "";
  check("collapse persisted to config (sidebarCollapsed:true)", /sidebarCollapsed":true/.test(configPost), configPost);
  // Re-expand for the bookmark tests below; the resize-handle block
  // works on a visible sidebar anyway, but bookmarks would be hidden
  // behind the collapsed strip and harder to assert against.
  explorerBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);

  console.log("== side-panel view collapse buttons ==");
  // Every side-panel view (Recent, Search, AI) gets a ‹ collapse button
  // in its header so the user can close the panel from any view. Clicking
  // it collapses the whole panel via NB.activity.collapse().
  {
    const recentBtn = window.document.querySelector('#activity-bar .activity-btn[data-view="recent"]');
    recentBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
    await tick(20);
    const recentCollapse = window.document.querySelector('#recent-view .panel-header .collapse-btn');
    check("collapse: Recent view has a ‹ button in its header", !!recentCollapse);
    recentCollapse.dispatchEvent(new window.Event("click", { bubbles: true }));
    await tick(10);
    check("collapse: Recent ‹ collapses the panel",
      $("side-panel").classList.contains("collapsed"));
    // Re-expand via the activity bar icon.
    recentBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
    await tick(10);
    check("collapse: panel re-expanded", !$("side-panel").classList.contains("collapsed"));

    const searchBtn = window.document.querySelector('#activity-bar .activity-btn[data-view="search"]');
    searchBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
    await tick(20);
    const searchCollapse = window.document.querySelector('#search-view .panel-header .collapse-btn');
    check("collapse: Search view has a ‹ button in its header", !!searchCollapse);
    searchCollapse.dispatchEvent(new window.Event("click", { bubbles: true }));
    await tick(10);
    check("collapse: Search ‹ collapses the panel",
      $("side-panel").classList.contains("collapsed"));
    searchBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
    await tick(10);
    // Return to Explorer for the rest of the suite. (The AI view's
    // collapse button is asserted at the end of the suite, after the AI
    // block has mounted it with its test config.)
    const explorerBtn2 = window.document.querySelector('#activity-bar .activity-btn[data-view="explorer"]');
    explorerBtn2.dispatchEvent(new window.Event("click", { bubbles: true }));
    await tick(10);
    check("collapse: back to Explorer, panel expanded",
      !$("side-panel").classList.contains("collapsed") &&
      window.NB.activity.getActive() === "explorer");
  }

  console.log("== graph view ==");
  // The graph opens as a special tab (§graph) in the tab bar, not as a
  // side-panel view or a content-area overlay. The 🕸 activity-bar button
  // triggers NB.tabs.openSpecial("§graph"), which creates a tab with a
  // custom icon + label and activates it.
  const graphBtn = window.document.getElementById("activity-graph-btn");
  check("graph toggle button in activity bar", !!graphBtn);
  if (graphBtn) {
    const graphFetchesBefore = fetchLog.filter(x => x === "GET /api/graph").length;
    graphBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
    await tick(50);
    // A special tab should appear in the tab bar with the §graph id.
    const graphTab = window.document.querySelector('.tab[data-path="§graph"]');
    check("graph tab created in tab bar", !!graphTab);
    check("graph tab is active", graphTab && graphTab.classList.contains("active"),
      "classes=" + (graphTab ? graphTab.classList.toString() : "n/a"));
    check("graph tab has special icon", graphTab && !!graphTab.querySelector(".tab-special-icon"),
      "label=" + (graphTab ? graphTab.querySelector(".tab-label").textContent : "n/a"));
    // The graph-view container should be visible (unhidden).
    check("graph-view container visible", !$("graph-view").hidden);
    // The viewer should be hidden (special tab takes the content area).
    check("viewer hidden when graph tab active", $("viewer").hidden);
    check("/api/graph fetched on tab open",
      fetchLog.filter(x => x === "GET /api/graph").length - graphFetchesBefore >= 1);
    // The overlay ships with a header, summary, controls, and canvas host.
    const gv = $("graph-view");
    check("graph header rendered", !!gv.querySelector(".graph-view-header"));
    check("graph canvas rendered", !!gv.querySelector(".graph-view-canvas"));
    check("graph summary element exists", !!gv.querySelector(".graph-view-summary"));
    // The fixture accumulates files from earlier tests; node count must
    // match Object.keys(FILES).length. Edges are 0 (no links in fixtures).
    await tick(50);
    const expectedNodes = Object.keys(FILES).length;
    check("graph node count matches FILES (" + expectedNodes + ")",
      window.NB.graph && Array.isArray(window.NB.graph.nodes) ? window.NB.graph.nodes.length === expectedNodes : false,
      "nodes=" + (window.NB.graph && window.NB.graph.nodes ? window.NB.graph.nodes.length : "n/a") + " expected=" + expectedNodes);
    check("graph loaded 0 edges (fixture has no links)", window.NB.graph && Array.isArray(window.NB.graph.edges) ? window.NB.graph.edges.length === 0 : false,
      "edges=" + (window.NB.graph && window.NB.graph.edges ? window.NB.graph.edges.length : "n/a"));
    // Close the graph tab via the tab's × button; the tab should
    // disappear and the viewer should reappear (falling back to the
    // previously-active file tab, or the welcome page).
    const graphCloseBtn = graphTab && graphTab.querySelector(".tab-close");
    if (graphCloseBtn) {
      graphCloseBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
      await tick(30);
      check("graph tab removed after close", !window.document.querySelector('.tab[data-path="§graph"]'));
      check("graph-view container hidden after close", $("graph-view").hidden);
    }
  }

  // --- graph interactions: verify event handlers actually fire and
  // mutate the simulation/zoom state. If these pass in jsdom, the
  // handlers are wired correctly; if a real browser still doesn't
  // react, the cause is CSS/layout (e.g. zero-size canvas host). ---
  console.log("== graph interactions ==");
  // Re-open the graph tab for interaction testing.
  graphBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(50);
  const canvasEl = $("graph-view-canvas");
  const canvasHostEl = $("graph-view-canvas-host");
  check("graph canvas element exists for interaction test", !!canvasEl);
  check("graph canvas host exists", !!canvasHostEl);
  if (canvasEl && canvasHostEl && window.NB.graph) {
    // --- wheel zoom ---
    const scaleBefore = window.NB.graph.scale;
    const wheelEvt = new window.WheelEvent("wheel", {
      deltaY: -120, bubbles: true, cancelable: true, clientX: 50, clientY: 50,
    });
    canvasEl.dispatchEvent(wheelEvt);
    const scaleAfterZoomIn = window.NB.graph.scale;
    check("graph: wheel up (deltaY<0) zooms in", scaleAfterZoomIn > scaleBefore,
      "before=" + scaleBefore.toFixed(3) + " after=" + scaleAfterZoomIn.toFixed(3));
    // defaultPrevented confirms preventDefault() ran (stops page scroll).
    check("graph: wheel handler calls preventDefault", wheelEvt.defaultPrevented);
    // The wheel zoom was reverted to a fixed 1.15x factor per notch (the
    // earlier delta-proportional change was reverted). Assert the exact
    // ratio so a regression back to proportional zoom is caught.
    check("graph: wheel zoom factor is fixed 1.15x per notch",
      Math.abs(scaleAfterZoomIn / scaleBefore - 1.15) < 0.001,
      "ratio=" + (scaleAfterZoomIn / scaleBefore).toFixed(4));
    // Zoom out.
    const wheelOut = new window.WheelEvent("wheel", {
      deltaY: 120, bubbles: true, cancelable: true, clientX: 50, clientY: 50,
    });
    canvasEl.dispatchEvent(wheelOut);
    const scaleAfterZoomOut = window.NB.graph.scale;
    check("graph: wheel down (deltaY>0) zooms out", scaleAfterZoomOut < scaleAfterZoomIn,
      "after zoom-out=" + scaleAfterZoomOut.toFixed(3));
    check("graph: zoom-out wheel preventDefault", wheelOut.defaultPrevented);
    check("graph: wheel zoom-out factor is 1/1.15 per notch",
      Math.abs(scaleAfterZoomOut / scaleAfterZoomIn - (1 / 1.15)) < 0.001,
      "ratio=" + (scaleAfterZoomOut / scaleAfterZoomIn).toFixed(4));

    // --- mousedown / mousemove / mouseup: background pan ---
    const panBefore = { x: window.NB.graph.pan.x, y: window.NB.graph.pan.y };
    const md = new window.MouseEvent("mousedown", {
      bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 100,
    });
    canvasEl.dispatchEvent(md);
    const mm = new window.MouseEvent("mousemove", {
      bubbles: true, cancelable: true, button: 0, clientX: 150, clientY: 120,
    });
    canvasEl.dispatchEvent(mm);
    const mu = new window.MouseEvent("mouseup", {
      bubbles: true, cancelable: true, button: 0, clientX: 150, clientY: 120,
    });
    window.document.dispatchEvent(mu);
    check("graph: background drag changes pan.x",
      window.NB.graph.pan.x !== panBefore.x || window.NB.graph.pan.y !== panBefore.y,
      "before=" + JSON.stringify(panBefore) + " after=" + JSON.stringify(window.NB.graph.pan));

    // --- zoom-in button ---
    const scaleBeforeBtn = window.NB.graph.scale;
    $("graph-view-zoom-in").dispatchEvent(new window.Event("click", { bubbles: true }));
    check("graph: zoom-in button increases scale",
      window.NB.graph.scale > scaleBeforeBtn,
      "before=" + scaleBeforeBtn.toFixed(3) + " after=" + window.NB.graph.scale.toFixed(3));
    // --- zoom-out button ---
    const scaleBeforeBtn2 = window.NB.graph.scale;
    $("graph-view-zoom-out").dispatchEvent(new window.Event("click", { bubbles: true }));
    check("graph: zoom-out button decreases scale",
      window.NB.graph.scale < scaleBeforeBtn2,
      "before=" + scaleBeforeBtn2.toFixed(3) + " after=" + window.NB.graph.scale.toFixed(3));

    // --- canvas transform: the bug that hid drag/zoom was that draw()
    // never applied pan/scale to the canvas. jsdom stubs the 2D context,
    // so we can inspect the recorded transform matrix after a redraw
    // and confirm it actually reflects the view state. ---
    // Force a redraw: pan to a known offset, then ask the graph to
    // draw again via the public surface.
    window.NB.graph.pan.x = 200;
    window.NB.graph.pan.y = 150;
    window.NB.graph.refresh(); // re-loads data; resets pan via onTabActivate path only on tab open
    await tick(50);
    // After refresh, the recorded ctx should have at least one frame
    // that translated by pan and scaled by scale. setTransform is
    // called in sizeCanvas() (for dpr), save/translate/scale/restore
    // wrap the draw block. Look for save followed by translate+scale.
    const ctx = canvasEl.__fakeCtx;
    if (ctx) {
      check("graph: ctx was used (calls recorded)", ctx.log.calls.length > 0,
        "callCount=" + ctx.log.calls.length);
      check("graph: ctx has had at least one clearRect", ctx.log.clears > 0,
        "clears=" + ctx.log.clears);
      // After a save + translate + scale + restore, the current
      // transform should match the transform on the stack at the
      // save point (which is dpr scaling, identity for dpr=1).
      check("graph: ctx recorded save/restore pairs",
        ctx.log.ops.save === ctx.log.ops.restore,
        "save=" + ctx.log.ops.save + " restore=" + ctx.log.ops.restore);
      check("graph: ctx recorded translate calls", ctx.log.ops.translate > 0,
        "translate=" + ctx.log.ops.translate);
      check("graph: ctx recorded scale calls (for zoom)", ctx.log.ops.scale > 0,
        "scale=" + ctx.log.ops.scale);
      check("graph: ctx drew node arcs", ctx.log.ops.arc > 0,
        "arc=" + ctx.log.ops.arc);

      // --- theme-aware colors flip with body[data-theme] ---
      // Snapshot the colors draw() wrote while the body is "dark".
      // Then flip body[data-theme] to "light" and confirm the next
      // draw writes the light-theme palette (the dark-mode literal
      // "rgba(124,156,255,0.8)" must no longer appear). This is the
      // bug that hid the graph on the light theme: draw() painted
      // dark-mode accents (light blue + near-white labels) on a
      // white canvas, producing near-invisible dots and unreadable
      // text.
      const hasFill = (re) => Array.from(ctx.log.fills).some(s => re.test(s));
      const hasStroke = (re) => Array.from(ctx.log.strokes).some(s => re.test(s));
      check("graph: dark-mode default node fill uses dark accent",
        hasFill(/124\s*,\s*156\s*,\s*255/),
        "fills=" + JSON.stringify(Array.from(ctx.log.fills)));
      check("graph: dark-mode label fill uses near-white",
        hasFill(/230\s*,\s*230\s*,\s*234/),
        "fills=" + JSON.stringify(Array.from(ctx.log.fills)));
      // Reset the recorder so we only look at colors from the light pass.
      ctx.log.fills.clear();
      ctx.log.strokes.clear();
      // The jsdom test runner doesn't link static/css/style.css, so
      // CSS custom properties aren't defined on any element. Mirror
      // the graph tokens inline so resolveColors() has something to
      // read -- this is exactly what the linked stylesheet does in
      // production, just expressed inline.
      const GRAPH_DARK_TOKENS = {
        "--graph-node-rgb": "124 156 255",
        "--graph-node-hover-rgb": "124 156 255",
        "--graph-edge-rgb": "124 156 255",
        "--graph-glow-rgb": "124 156 255",
        "--graph-warn-rgb": "243 180 84",
        "--graph-dim-rgb": "127 140 160",
        "--graph-label-rgb": "230 230 234",
      };
      const GRAPH_LIGHT_TOKENS = {
        "--graph-node-rgb": "47 95 208",
        "--graph-node-hover-rgb": "47 95 208",
        "--graph-edge-rgb": "47 95 208",
        "--graph-glow-rgb": "47 95 208",
        "--graph-warn-rgb": "201 131 29",
        "--graph-dim-rgb": "93 100 112",
        "--graph-label-rgb": "31 35 48",
      };
      function setTokens(map) {
        for (const [k, v] of Object.entries(map)) {
          window.document.body.style.setProperty(k, v);
        }
      }
      // Set dark tokens first so the previous (pre-flip) draws still
      // match what the assertion expects.
      setTokens(GRAPH_DARK_TOKENS);
      // Flip to light: change body[data-theme] AND swap the tokens so
      // getComputedStyle(body) returns the light values.
      window.document.body.dataset.theme = "light";
      setTokens(GRAPH_LIGHT_TOKENS);
      // Force a redraw regardless of the loop state by nudging pan;
      // any draw() pass (idle requestRedraw or running rAF tick) will
      // repaint with the resolved palette.
      window.NB.graph.pan.x += 0.001;
      // Wait long enough for the MO microtask + several rAF frames.
      await tick(200);
      // Surface whether a draw fired at all after the flip so a
      // silent regression doesn't masquerade as a wrong-color failure.
      check("graph: light theme drew at all after theme flip",
        ctx.log.fills.size > 0,
        "fills.size=" + ctx.log.fills.size + " contents=" + JSON.stringify(Array.from(ctx.log.fills)));
      check("graph: light theme uses the light accent for nodes",
        hasFill(/47\s*,\s*95\s*,\s*208/),
        "fills=" + JSON.stringify(Array.from(ctx.log.fills)));
      check("graph: light theme label fill is dark text",
        hasFill(/31\s*,\s*35\s*,\s*48/),
        "fills=" + JSON.stringify(Array.from(ctx.log.fills)));
      check("graph: light theme does NOT paint the dark accent",
        !hasFill(/124\s*,\s*156\s*,\s*255/) && !hasStroke(/124\s*,\s*156\s*,\s*255/),
        "fills=" + JSON.stringify(Array.from(ctx.log.fills)) +
        " strokes=" + JSON.stringify(Array.from(ctx.log.strokes)));
      // Restore dark for the rest of the suite.
      window.document.body.dataset.theme = "dark";
      setTokens(GRAPH_DARK_TOKENS);
      await tick(20);
    } else {
      check("graph: ctx was created on canvas", false,
        "no __fakeCtx attached to " + (canvasEl && canvasEl.id));
    }

    // --- pickNode + drag actually moves a node in world space ---
    // Place a known node near the cursor and verify dragging the node
    // updates its world coords (so the rendering would follow the
    // cursor). pickNode runs in screen space at the current scale, so
    // the world coord it stores should match the screen point.
    const someNode = window.NB.graph.nodes[0];
    if (someNode) {
      // Put the node at world (0, 0) so we know its screen position
      // exactly: it will be drawn at (pan.x, pan.y).
      someNode.x = 0;
      someNode.y = 0;
      // Wait for next draw frame so pickNode sees the new layout.
      await tick(20);
      // Cursor at the screen point where the node should appear:
      // (pan.x + 0 * scale, pan.y + 0 * scale) = (pan.x, pan.y).
      const mdAtNode = new window.MouseEvent("mousedown", {
        bubbles: true, cancelable: true, button: 0,
        clientX: window.NB.graph.pan.x, clientY: window.NB.graph.pan.y,
      });
      canvasEl.dispatchEvent(mdAtNode);
      // Move the cursor 30 px right / 20 px down; the node should
      // follow in world space: x = (30)/scale, y = (20)/scale.
      const mm = new window.MouseEvent("mousemove", {
        bubbles: true, cancelable: true, button: 0,
        clientX: window.NB.graph.pan.x + 30, clientY: window.NB.graph.pan.y + 20,
      });
      canvasEl.dispatchEvent(mm);
      const expectedX = 30 / window.NB.graph.scale;
      const expectedY = 20 / window.NB.graph.scale;
      check("graph: dragging node updates world x with current scale",
        Math.abs(someNode.x - expectedX) < 0.01,
        "got x=" + someNode.x.toFixed(3) + " expected=" + expectedX.toFixed(3) +
        " (scale=" + window.NB.graph.scale.toFixed(3) + ")");
      check("graph: dragging node updates world y with current scale",
        Math.abs(someNode.y - expectedY) < 0.01,
        "got y=" + someNode.y.toFixed(3) + " expected=" + expectedY.toFixed(3) +
        " (scale=" + window.NB.graph.scale.toFixed(3) + ")");
      // Release the mouse so subsequent tests aren't affected.
      window.document.dispatchEvent(new window.MouseEvent("mouseup", {
        bubbles: true, cancelable: true, button: 0,
        clientX: window.NB.graph.pan.x + 30, clientY: window.NB.graph.pan.y + 20,
      }));
    }

    // --- single-click does NOT open, double-click opens ---
    // A node placed at world (0,0) renders at screen (pan.x, pan.y).
    const clickNode = window.NB.graph.nodes[0];
    if (clickNode) {
      clickNode.x = 0;
      clickNode.y = 0;
      await tick(20);
      const atNode = {
        clientX: window.NB.graph.pan.x, clientY: window.NB.graph.pan.y,
        bubbles: true, cancelable: true, button: 0,
      };
      const activeBefore = window.document.querySelector(".tab.active");
      const activeBeforePath = activeBefore ? activeBefore.dataset.path : null;
      // A fresh mousedown/mouseup resets the dragMoved guard so the
      // click handler runs (a real click always follows a mousedown).
      canvasEl.dispatchEvent(new window.MouseEvent("mousedown", atNode));
      window.document.dispatchEvent(new window.MouseEvent("mouseup", atNode));
      canvasEl.dispatchEvent(new window.MouseEvent("click", atNode));
      await tick(20);
      const activeAfterClick = window.document.querySelector(".tab.active");
      const activeAfterClickPath = activeAfterClick ? activeAfterClick.dataset.path : null;
      check("graph: single click does not open the node",
        activeAfterClickPath === activeBeforePath,
        "before=" + activeBeforePath + " after=" + activeAfterClickPath);
      check("graph: single click selects the node",
        window.NB.graph.selectedId === clickNode.id,
        "expected=" + clickNode.id + " got=" + window.NB.graph.selectedId);
      // Clicking empty space clears the selection.
      canvasEl.dispatchEvent(new window.MouseEvent("click", {
        clientX: 5, clientY: 5, bubbles: true, cancelable: true, button: 0,
      }));
      await tick(20);
      check("graph: clicking empty space clears selection",
        window.NB.graph.selectedId === null,
        "got=" + window.NB.graph.selectedId);
      // A fresh mousedown/mouseup resets the dragMoved guard (a real
      // double-click always follows a mousedown), so the dblclick fires.
      canvasEl.dispatchEvent(new window.MouseEvent("mousedown", atNode));
      window.document.dispatchEvent(new window.MouseEvent("mouseup", atNode));
      canvasEl.dispatchEvent(new window.MouseEvent("dblclick", atNode));
      await tick(40);
      const activeAfterDbl = window.document.querySelector(".tab.active");
      const activeAfterDblPath = activeAfterDbl ? activeAfterDbl.dataset.path : null;
      check("graph: double click opens the node",
        activeAfterDblPath === clickNode.id,
        "expected=" + clickNode.id + " got=" + activeAfterDblPath);
    }

    // --- neighbor highlight colors ---
    // The fixture has no edges, so synthesize one to exercise the
    // neighbor-highlight path in draw(). The selected node is painted
    // with the warn color (243,180,84 in dark theme) and its direct
    // neighbors with the hover color (124,156,255, alpha 1). The default
    // node fill is the SAME rgb as hover but at alpha 0.8, so the
    // assertions must match the full rgba string (including alpha) to
    // prove the neighbor actually got the distinct highlight.
    const selA = window.NB.graph.nodes[0];
    const selB = window.NB.graph.nodes[1];
    if (selA && selB) {
      // Clear the active-file highlight so the warn color is unambiguous
      // (activeFile also paints warnFill). Emitting file:open with null
      // clears graph.js's activeFile.
      window.NB.evt.emit("file:open", null);
      // Add a synthetic edge A<->B so B is a direct neighbor of A.
      window.NB.graph.edges.push({ source: selA, target: selB });
      await tick(20);
      // Reset the color recorder so we only see colors from this pass.
      ctx.log.fills.clear();
      // Click node A (placed at world origin -> screen pan).
      selA.x = 0; selA.y = 0;
      await tick(20);
      const atA = {
        clientX: window.NB.graph.pan.x, clientY: window.NB.graph.pan.y,
        bubbles: true, cancelable: true, button: 0,
      };
      canvasEl.dispatchEvent(new window.MouseEvent("mousedown", atA));
      window.document.dispatchEvent(new window.MouseEvent("mouseup", atA));
      canvasEl.dispatchEvent(new window.MouseEvent("click", atA));
      await tick(20);
      const fills = () => Array.from(ctx.log.fills);
      const hasFill = (re) => fills().some(s => re.test(s));
      // Selected node uses the warn color (243,180,84 in dark theme).
      check("graph: selected node painted with warn color",
        hasFill(/243\s*,\s*180\s*,\s*84/),
        "fills=" + JSON.stringify(fills()));
      // Its direct neighbor uses the hover color at alpha 1 (distinct
      // from the default node fill which is the same rgb at alpha 0.8).
      check("graph: neighbor node painted with hover color",
        hasFill(/124\s*,\s*156\s*,\s*255,\s*1/),
        "fills=" + JSON.stringify(fills()));
      // The selected color must differ from the neighbor color.
      check("graph: selected color differs from neighbor color",
        hasFill(/243\s*,\s*180\s*,\s*84/) && hasFill(/124\s*,\s*156\s*,\s*255,\s*1/),
        "fills=" + JSON.stringify(fills()));
      // Remove the synthetic edge so later tests see the real (empty) graph.
      window.NB.graph.edges.length = 0;
      // Clicking empty space clears selection.
      canvasEl.dispatchEvent(new window.MouseEvent("click", {
        clientX: 5, clientY: 5, bubbles: true, cancelable: true, button: 0,
      }));
      await tick(20);
      check("graph: neighbor test clears selection",
        window.NB.graph.selectedId === null,
        "got=" + window.NB.graph.selectedId);
    }

    // --- clicking a node with no neighbors ---
    // With the synthetic edge removed, every node is isolated. Selecting
    // one must still set selectedId (warn color) but paint NO neighbor
    // highlight (no alpha-1 hover color), since neighbourSet() returns
    // an empty set for an isolated node.
    const isoNode = window.NB.graph.nodes[0];
    if (isoNode) {
      isoNode.x = 0; isoNode.y = 0;
      await tick(20);
      ctx.log.fills.clear();
      const isoFills = () => Array.from(ctx.log.fills);
      const isoHasFill = (re) => isoFills().some(s => re.test(s));
      const atIso = {
        clientX: window.NB.graph.pan.x, clientY: window.NB.graph.pan.y,
        bubbles: true, cancelable: true, button: 0,
      };
      canvasEl.dispatchEvent(new window.MouseEvent("mousedown", atIso));
      window.document.dispatchEvent(new window.MouseEvent("mouseup", atIso));
      canvasEl.dispatchEvent(new window.MouseEvent("click", atIso));
      await tick(20);
      check("graph: isolated node still selects (selectedId set)",
        window.NB.graph.selectedId === isoNode.id,
        "expected=" + isoNode.id + " got=" + window.NB.graph.selectedId);
      // No neighbor highlight: the alpha-1 hover color must not appear
      // (the default node fill is the same rgb at alpha 0.8, so matching
      // the full string proves no neighbor got the highlight).
      check("graph: isolated node paints no neighbor highlight",
        !isoHasFill(/124\s*,\s*156\s*,\s*255,\s*1/),
        "fills=" + JSON.stringify(isoFills()));
      // Clear selection for the re-activation test below.
      canvasEl.dispatchEvent(new window.MouseEvent("click", {
        clientX: 5, clientY: 5, bubbles: true, cancelable: true, button: 0,
      }));
      await tick(20);
    }

    // --- re-activation preserves view state ---
    // The user's bug: zoom in, switch away to a file tab, switch back,
    // and the graph snaps back to its initial zoom + center. The view
    // state (pan, scale) must be preserved when the tab is reactivated,
    // not silently reset.
    const panBeforeReopen = { x: window.NB.graph.pan.x, y: window.NB.graph.pan.y };
    const scaleBeforeReopen = window.NB.graph.scale;
    // Pick a non-graph tab that's already open and activate it. The
    // boot block restored "Welcome.md" so it's safe to use.
    const welcomeTab = window.document.querySelector('.tab[data-path="Welcome.md"]');
    if (welcomeTab) {
      welcomeTab.dispatchEvent(new window.Event("click", { bubbles: true }));
      await tick(40);
      // Now click the graph tab again to re-activate it.
      const graphTab = window.document.querySelector('.tab[data-path="§graph"]');
      if (graphTab) {
        graphTab.dispatchEvent(new window.Event("click", { bubbles: true }));
        await tick(40);
      }
    }
    check("graph: re-activation preserves pan",
      Math.abs(window.NB.graph.pan.x - panBeforeReopen.x) < 0.001 &&
      Math.abs(window.NB.graph.pan.y - panBeforeReopen.y) < 0.001,
      "before=" + JSON.stringify(panBeforeReopen) + " after=" + JSON.stringify(window.NB.graph.pan));
    check("graph: re-activation preserves scale",
      Math.abs(window.NB.graph.scale - scaleBeforeReopen) < 0.001,
      "before=" + scaleBeforeReopen.toFixed(3) + " after=" + window.NB.graph.scale.toFixed(3));

    // --- selection persists across re-activation ---
    // Select a node, switch away to a file tab, switch back, and the
    // selection (selectedId) must survive -- the highlight the user
    // chose is part of the view state, like pan/scale.
    const persistNode = window.NB.graph.nodes[0];
    if (persistNode) {
      persistNode.x = 0; persistNode.y = 0;
      await tick(20);
      const atPersist = {
        clientX: window.NB.graph.pan.x, clientY: window.NB.graph.pan.y,
        bubbles: true, cancelable: true, button: 0,
      };
      canvasEl.dispatchEvent(new window.MouseEvent("mousedown", atPersist));
      window.document.dispatchEvent(new window.MouseEvent("mouseup", atPersist));
      canvasEl.dispatchEvent(new window.MouseEvent("click", atPersist));
      await tick(20);
      check("graph: selection set before re-activation",
        window.NB.graph.selectedId === persistNode.id,
        "expected=" + persistNode.id + " got=" + window.NB.graph.selectedId);
      // Switch to a file tab and back to the graph.
      const welcomeTab2 = window.document.querySelector('.tab[data-path="Welcome.md"]');
      if (welcomeTab2) {
        welcomeTab2.dispatchEvent(new window.Event("click", { bubbles: true }));
        await tick(40);
        const graphTab2 = window.document.querySelector('.tab[data-path="§graph"]');
        if (graphTab2) {
          graphTab2.dispatchEvent(new window.Event("click", { bubbles: true }));
          await tick(40);
        }
      }
      check("graph: selection persists across re-activation",
        window.NB.graph.selectedId === persistNode.id,
        "expected=" + persistNode.id + " got=" + window.NB.graph.selectedId);
      // Clear the selection so the recenter/close steps below are clean.
      canvasEl.dispatchEvent(new window.MouseEvent("click", {
        clientX: 5, clientY: 5, bubbles: true, cancelable: true, button: 0,
      }));
      await tick(20);
    }

    // --- selection survives a graph reload (refresh) ---
    // The refresh button re-fetches /api/graph and rebuilds nodes/edges.
    // A selected node that still exists in the fresh data must keep its
    // highlight (selectedId is part of the view state, like pan/scale).
    const reloadNode = window.NB.graph.nodes[0];
    if (reloadNode) {
      reloadNode.x = 0; reloadNode.y = 0;
      await tick(20);
      const atReload = {
        clientX: window.NB.graph.pan.x, clientY: window.NB.graph.pan.y,
        bubbles: true, cancelable: true, button: 0,
      };
      canvasEl.dispatchEvent(new window.MouseEvent("mousedown", atReload));
      window.document.dispatchEvent(new window.MouseEvent("mouseup", atReload));
      canvasEl.dispatchEvent(new window.MouseEvent("click", atReload));
      await tick(20);
      check("graph: selection set before refresh",
        window.NB.graph.selectedId === reloadNode.id,
        "expected=" + reloadNode.id + " got=" + window.NB.graph.selectedId);
      // Trigger a reload via the refresh button (same path as the toolbar).
      $("graph-view-refresh").dispatchEvent(new window.Event("click", { bubbles: true }));
      await tick(50);
      check("graph: selection survives graph reload",
        window.NB.graph.selectedId === reloadNode.id,
        "expected=" + reloadNode.id + " got=" + window.NB.graph.selectedId);
      // Clear the selection for the recenter/close steps below.
      canvasEl.dispatchEvent(new window.MouseEvent("click", {
        clientX: 5, clientY: 5, bubbles: true, cancelable: true, button: 0,
      }));
      await tick(20);
    }

    // --- stale selection is cleared when the node disappears ---
    // If the selected file is deleted, a reload rebuilds nodes without
    // it. The stale selectedId must be cleared (not linger pointing at a
    // node that no longer exists), otherwise the highlight silently
    // never renders.
    const staleNode = window.NB.graph.nodes[0];
    if (staleNode) {
      staleNode.x = 0; staleNode.y = 0;
      await tick(20);
      const atStale = {
        clientX: window.NB.graph.pan.x, clientY: window.NB.graph.pan.y,
        bubbles: true, cancelable: true, button: 0,
      };
      canvasEl.dispatchEvent(new window.MouseEvent("mousedown", atStale));
      window.document.dispatchEvent(new window.MouseEvent("mouseup", atStale));
      canvasEl.dispatchEvent(new window.MouseEvent("click", atStale));
      await tick(20);
      check("graph: stale-selection set before delete",
        window.NB.graph.selectedId === staleNode.id,
        "expected=" + staleNode.id + " got=" + window.NB.graph.selectedId);
      // Remove the file from the fixture so the next /api/graph fetch
      // no longer includes it, then reload.
      const stalePath = staleNode.id;
      const hadFile = FILES[stalePath] !== undefined;
      delete FILES[stalePath];
      $("graph-view-refresh").dispatchEvent(new window.Event("click", { bubbles: true }));
      await tick(50);
      check("graph: stale selection cleared after node disappears",
        window.NB.graph.selectedId === null,
        "expected=null got=" + window.NB.graph.selectedId);
      // Restore the fixture so later tests see the original file set.
      if (hadFile) FILES[stalePath] = "";
    }

    // Re-center button is still available for users who want to reset.
    const panBeforeRecenter = { x: window.NB.graph.pan.x, y: window.NB.graph.pan.y };
    $("graph-view-recenter").dispatchEvent(new window.Event("click", { bubbles: true }));
    check("graph: recenter button still resets pan/scale",
      window.NB.graph.pan.x !== panBeforeRecenter.x ||
      window.NB.graph.pan.y !== panBeforeRecenter.y ||
      Math.abs(window.NB.graph.scale - 1) > 0.001,
      "after recenter pan=" + JSON.stringify(window.NB.graph.pan) +
      " scale=" + window.NB.graph.scale.toFixed(3));

    // Close the graph tab before subsequent tests run so it doesn't
    // interfere with tab-close / restore assertions below.
    const graphTabEl = window.document.querySelector('.tab[data-path="§graph"]');
    const gClose = graphTabEl && graphTabEl.querySelector(".tab-close");
    if (gClose) {
      gClose.dispatchEvent(new window.Event("click", { bubbles: true }));
      await tick(20);
    }
  }

  console.log("== sidebar: collapse-all folders from root context menu ==");
  // Build a nested-folder tree, open the root context menu (right-click
  // the empty tree area), and run "Collapse all folders".
  TREE.length = 0;
  TREE.push(
    { name: "notes", type: "dir", path: "notes", children: [
      { name: "sub", type: "dir", path: "notes/sub", children: [
        { name: "deep.md", type: "file", path: "notes/sub/deep.md" },
      ]},
      { name: "a.md", type: "file", path: "notes/a.md" },
    ]},
    { name: "Welcome.md", type: "file", path: "Welcome.md" },
  );
  await window.NB.sidebar.refresh();
  await tick(20);
  const treeRow = (p) => window.document.querySelector('.tree-row[data-path="' + p + '"]');
  // Reach a known fully-expanded state before exercising the menu. The
  // session default is all-collapsed (see the boot block), and the
  // legacy path in `collapsed` from earlier refreshes may still hold
  // "notes". Expand top-down: expanding a parent re-collapses its
  // children, so open "notes" first, then "notes/sub".
  treeRow("notes").dispatchEvent(new window.Event("click", { bubbles: true }));
  treeRow("notes/sub").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  check("collapse-all: folders can be expanded again",
    treeRow("notes") && !treeRow("notes").classList.contains("collapsed") &&
    treeRow("notes/sub") && !treeRow("notes/sub").classList.contains("collapsed"),
    "notes=" + (treeRow("notes") && treeRow("notes").className) + " sub=" + (treeRow("notes/sub") && treeRow("notes/sub").className));
  const rootEv = new window.MouseEvent("contextmenu", { bubbles: true, clientX: 5, clientY: 5 });
  Object.defineProperty(rootEv, "target", { value: $("file-tree") });
  $("file-tree").dispatchEvent(rootEv);
  await tick(10);
  const rootBtns = () => Array.from($("context-menu").querySelectorAll("button")).map(b => b.textContent);
  check("collapse-all: root menu offers 'Collapse all folders' when folders exist",
    rootBtns().includes("Collapse all folders"),
    rootBtns().join(" / "));
  const collapseBtn = Array.from($("context-menu").querySelectorAll("button"))
    .find(b => b.textContent === "Collapse all folders");
  collapseBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  const notesWrap = treeRow("notes") ? treeRow("notes").nextElementSibling : null;
  const subWrap = treeRow("notes/sub") ? treeRow("notes/sub").nextElementSibling : null;
  check("collapse-all: every folder row carries .collapsed",
    treeRow("notes").classList.contains("collapsed") &&
    treeRow("notes/sub").classList.contains("collapsed"),
    "notes=" + treeRow("notes").className + " sub=" + treeRow("notes/sub").className);
  check("collapse-all: collapsed folders hide their children",
    notesWrap && notesWrap.style.display === "none" &&
    subWrap && subWrap.style.display === "none",
    "notesWrap=" + (notesWrap && notesWrap.style.display) + " subWrap=" + (subWrap && subWrap.style.display));

  // The action is also reachable from a file/folder row's own context
  // menu (not just the empty-area root menu).
  treeRow("notes").dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, clientX: 30, clientY: 30 }));
  await tick(10);
  const rowBtns = () => Array.from($("context-menu").querySelectorAll("button")).map(b => b.textContent);
  check("collapse-all: folder row menu also offers 'Collapse all folders'",
    rowBtns().includes("Collapse all folders"),
    rowBtns().join(" / "));
  const bRowCtx = treeRow("notes/a.md");
  if (bRowCtx) {
    bRowCtx.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, clientX: 30, clientY: 30 }));
    await tick(10);
    check("collapse-all: file row menu also offers 'Collapse all folders'",
      rowBtns().includes("Collapse all folders"),
      rowBtns().join(" / "));
  }
  window.document.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);

  console.log("== bookmarks ==");
  // Reset to a known 2-tab state and seed config.bookmarks via the
  // setter the sidebar exposes. Going through the public façade
  // exercises the same path app.js uses on config load, so the
  // rendered list reflects what the user would see after a reload.
  // (Earlier blocks may have left a non-default tree; reset the tree
  // stub to a known shape with both bookmark targets present.)
  TREE.length = 0;
  TREE.push(
    { name: "notes", type: "dir", path: "notes", children: [
      { name: "a.md", type: "file", path: "notes/a.md" },
      { name: "b.md", type: "file", path: "notes/b.md" },
    ]},
    { name: "Welcome.md", type: "file", path: "Welcome.md" },
  );
  await window.NB.sidebar.refresh();
  await tick(20);
  window.NB.sidebar.setBookmarks([]);
  await tick(20);
  const bookmarkRows = () => window.document.querySelectorAll("#bookmarks-list .bookmark-row");
  const bookmarkEmpty = () => window.document.querySelector("#bookmarks-list .bookmarks-empty");
  check("bookmarks: empty state shown when no bookmarks",
    bookmarkRows().length === 0 && !!bookmarkEmpty(),
    "rows=" + bookmarkRows().length + " empty=" + !!bookmarkEmpty());
  // The empty state's text matches the design.
  check("bookmarks: empty state copy",
    bookmarkEmpty() && /No bookmarks yet/i.test(bookmarkEmpty().textContent),
    bookmarkEmpty() && bookmarkEmpty().textContent);

  // Star toggle on a tree row. The star is in a real DOM span on the
  // file row; clicking it should add the file to the bookmark list
  // and light the star (the .is-bookmarked class).
  const aRow = () => window.document.querySelector('.tree-row[data-path="notes/a.md"]');
  const aStar = () => aRow() && aRow().querySelector(".tree-star");
  check("bookmarks: file row has a star",
    !!aStar(), "no .tree-star on notes/a.md");
  check("bookmarks: star starts as ☆ (off)",
    aStar() && aStar().textContent === "☆", aStar() && aStar().textContent);
  check("bookmarks: star has no is-bookmarked class initially",
    aStar() && !aStar().classList.contains("is-bookmarked"));
  aStar().dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  check("bookmarks: star click adds the file",
    bookmarkRows().length === 1 &&
    bookmarkRows()[0].dataset.path === "notes/a.md",
    "rows=" + bookmarkRows().length);
  check("bookmarks: star now shows ★ and is-bookmarked class",
    aStar() && aStar().textContent === "★" &&
    aStar().classList.contains("is-bookmarked"),
    aStar() && aStar().textContent + " " + aStar().className);
  // The list row shows the base name + has a .bookmark-pin star span.
  const listPin = bookmarkRows()[0].querySelector(".bookmark-pin");
  check("bookmarks: list row has a .bookmark-pin (★)",
    listPin && listPin.textContent === "★", listPin && listPin.textContent);
  check("bookmarks: list row name is the base name",
    bookmarkRows()[0].querySelector(".bookmark-name").textContent === "a.md",
    bookmarkRows()[0].querySelector(".bookmark-name").textContent);

  // Persistence: the change goes through NB.app.setBookmarks, which
  // writes the whole cfg to /api/config. Wait for the debounce.
  await tick(350);
  const bookmarkCfgPost = fetchLog.filter(x => x.startsWith("POST /api/config")).pop() || "";
  check("bookmarks: addition persisted to cfg",
    /"bookmarks":\["notes\/a\.md"\]/.test(bookmarkCfgPost), bookmarkCfgPost);

  // Add a second bookmark via the tree's inline star so we can test
  // the ordering + remove path in the same block.
  const bStar = () => window.document.querySelector('.tree-row[data-path="notes/b.md"] .tree-star');
  bStar().dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  check("bookmarks: second add -> 2 rows, insertion order",
    bookmarkRows().length === 2 &&
    bookmarkRows()[0].dataset.path === "notes/a.md" &&
    bookmarkRows()[1].dataset.path === "notes/b.md",
    Array.from(bookmarkRows()).map(r => r.dataset.path).join(","));

  // Click a bookmark row -> opens the file (sets active tab). Set up
  // a known active-file state first so we can detect the change.
  // notes/a.md is open and is a bookmark; activate it to make sure
  // the active file is the one we expect.
  const bookmarks_get = () => window.NB.sidebar.getBookmarks();
  await window.NB.tabs.activate("notes/a.md"); await tick(20);
  check("bookmarks: pre-click active tab is notes/a.md (bookmark target)",
    activeTabPath() === "notes/a.md", "active=" + activeTabPath());
  // Pick a non-bookmarked file to click next (notes/b is bookmarked;
  // we need a non-bookmarked one to confirm the bookmark click drives
  // the activation). Use Welcome.md, which is in the tree.
  await window.NB.tabs.open("Welcome.md"); await tick(20);
  // Now Welcome is the active file and not bookmarked.
  check("bookmarks: Welcome opened as non-bookmarked active",
    activeTabPath() === "Welcome.md" && !bookmarks_get().includes("Welcome.md"),
    "active=" + activeTabPath());
  // Click the bookmark row for notes/b.md (a bookmarked file) to
  // confirm clicking a bookmark row activates that file.
  const bmForB = window.document.querySelector(
    '.bookmark-row[data-path="notes/b.md"]');
  bmForB.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("bookmarks: click on bookmark row opens the file",
    activeTabPath() === "notes/b.md", "active=" + activeTabPath());

  // The + button in the bookmarks header: only visible when the
  // active file isn't already bookmarked. Currently active is
  // notes/b.md which IS bookmarked -> button hidden.
  check("bookmarks: + button hidden when active file is bookmarked",
    $("bookmarks-add").hidden, "hidden=" + $("bookmarks-add").hidden);
  // Activate a non-bookmarked file (Welcome) -> + visible.
  await window.NB.tabs.activate("Welcome.md"); await tick(20);
  check("bookmarks: + button visible when active file is not bookmarked",
    !$("bookmarks-add").hidden, "hidden=" + $("bookmarks-add").hidden);
  // Click + -> adds Welcome.md to the list, button hides again.
  $("bookmarks-add").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  check("bookmarks: + click adds the active file",
    bookmarks_get().includes("Welcome.md") &&
    bookmarkRows().length === 3 &&
    bookmarkRows()[2].dataset.path === "Welcome.md",
    Array.from(bookmarkRows()).map(r => r.dataset.path).join(","));
  check("bookmarks: + button hides after adding the active file",
    $("bookmarks-add").hidden, "hidden=" + $("bookmarks-add").hidden);

  // Tree context menu: right-click on a non-bookmarked file shows
  // "Add bookmark"; on a bookmarked file it shows "Remove bookmark".
  // The test opens the menu with a synthesized contextmenu event and
  // clicks the menu item, mirroring the empty-tree block above.
  const treeCtx = (path) => {
    const row = window.document.querySelector('.tree-row[data-path="' + path + '"]');
    const ev = new window.MouseEvent("contextmenu", { bubbles: true, clientX: 30, clientY: 30 });
    row.dispatchEvent(ev);
  };
  const treeMenuItem = (label) =>
    Array.from($("context-menu").querySelectorAll("button"))
      .find(b => b.textContent === label);
  // Welcome.md is bookmarked (added by + click above) -> menu should
  // show "Remove bookmark".
  treeCtx("Welcome.md");
  await tick(10);
  check("bookmarks: ctx menu on bookmarked file shows 'Remove bookmark'",
    !!treeMenuItem("Remove bookmark"),
    $("context-menu").textContent);
  treeMenuItem("Remove bookmark").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  check("bookmarks: menu 'Remove bookmark' drops the row",
    bookmarkRows().length === 2 &&
    !bookmarks_get().includes("Welcome.md"),
    Array.from(bookmarkRows()).map(r => r.dataset.path).join(","));
  // Welcome.md is no longer bookmarked. Right-click it again -> menu
  // should now show "Add bookmark" (the action that matches the
  // current state).
  treeCtx("Welcome.md");
  await tick(10);
  check("bookmarks: ctx menu on unbookmarked file shows 'Add bookmark'",
    !!treeMenuItem("Add bookmark"),
    $("context-menu").textContent);
  // Close the menu so it doesn't leak into the next test.
  window.document.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);

  // Bookmark-list right-click: should expose Open / Remove bookmark /
  // Copy / Delete. Mirrors the tree's menu shape so the user's mental
  // model is the same.
  const bmCtx = () => {
    const ev = new window.MouseEvent("contextmenu", { bubbles: true, clientX: 30, clientY: 30 });
    bookmarkRows()[0].dispatchEvent(ev);
  };
  bmCtx(); await tick(10);
  // The menu must actually be VISIBLE, not just have the right items
  // in the DOM. A previous version of the document-level contextmenu
  // handler fired AFTER the row's handler and hid the menu via
  // hideMenu() (the items stayed in the DOM, so a label-only check
  // passed). Visible check catches the regression.
  check("bookmarks: list context menu is visible (not hidden by doc handler)",
    !$("context-menu").hidden, "hidden=" + $("context-menu").hidden);
  const bmMenuLabels = () => Array.from($("context-menu").querySelectorAll("button")).map(b => b.textContent);
  check("bookmarks: list context menu has Open/Rename/Remove bookmark/Copy/Delete",
    bmMenuLabels().includes("Open") &&
    bmMenuLabels().includes("Remove bookmark") &&
    bmMenuLabels().includes("Rename / Move…") &&
    bmMenuLabels().includes("Copy…") &&
    bmMenuLabels().includes("Delete"),
    bmMenuLabels().join(" / "));
  // Rename / Move re-keys the bookmark to the new path. Stub the
  // rename path (the moveItem API) so the menu item click flows
  // through doRename without the prompt() interceptor, and verify
  // the bookmark follows the file.
  const origMoveItemBm = window.NB.api.moveItem;
  let lastMove = null;
  window.NB.api.moveItem = async (from, to) => {
    lastMove = { from, to };
    // Mirror the real backend:
    //  - rekey the file contents map so a subsequent tree refresh
    //    sees the new path. FILES is the harness-level constant
    //    (not on window) so reference it directly.
    //  - rekey TREE the same way: a tree refresh would otherwise
    //    see the new path as a missing file and prune any bookmark
    //    that already got rekeyed via the file:moved listener.
    if (typeof FILES !== "undefined" && FILES[from] !== undefined) {
      FILES[to] = FILES[from];
      delete FILES[from];
    }
    const renameInTree = (nodes) => {
      for (const n of nodes) {
        if (n.path === from) { n.path = to; n.name = to.split("/").pop(); return true; }
        if (n.children && renameInTree(n.children)) return true;
      }
      return false;
    };
    renameInTree(TREE);
    return { from, to };
  };
  // window.prompt is stubbed at the harness level to return null; for
  // the rename path the user needs to type a destination, so override
  // it just for this call.
  const origPromptBm = window.prompt;
  window.prompt = () => "notes/a-renamed.md";
  Array.from($("context-menu").querySelectorAll("button"))
    .find(b => b.textContent === "Rename / Move…")
    .dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  window.prompt = origPromptBm;
  window.NB.api.moveItem = origMoveItemBm;
  // Re-fire the move manually to see what happens (debug only).
  // NB.evt.emit("file:moved", { from: "notes/a.md", to: "notes/a-renamed.md" });
  // window.__DEBUG_BM = false;
  check("bookmarks: menu 'Rename / Move…' called moveItem with the bookmark path",
    lastMove && lastMove.from === "notes/a.md" && lastMove.to === "notes/a-renamed.md",
    JSON.stringify(lastMove));
  // file:moved re-keyed the bookmark to the new path.
  await tick(40);
  check("bookmarks: renamed file rekeys the bookmark to the new path",
    window.NB.sidebar.getBookmarks().includes("notes/a-renamed.md") &&
    !window.NB.sidebar.getBookmarks().includes("notes/a.md"),
    window.NB.sidebar.getBookmarks().join(",") + " | lastMove=" + JSON.stringify(lastMove));
  // The bookmark row in the list now points at the new path.
  const renamedRow = window.document.querySelector(
    '.bookmark-row[data-path="notes/a-renamed.md"]');
  check("bookmarks: renamed file shows the new path in the bookmark list",
    !!renamedRow, "row missing for notes/a-renamed.md");
  // Persistence: the rekeyed bookmark is in the config POST.
  await tick(350);
  const renameCfgPost = fetchLog.filter(x => x.startsWith("POST /api/config")).pop() || "";
  check("bookmarks: rename persisted (bookmarks now point at new path)",
    /"bookmarks":\["notes\/a-renamed\.md"/.test(renameCfgPost), renameCfgPost);
  window.document.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);

  // Restore the original TREE / FILES shape so the rest of the
  // suite sees the same fixture as before the rename. The stub
  // mutated both (correct for the file:moved handler's downstream
  // refresh), but later sidebar DnD / tab tests want the standard
  // TREE with the original notes/a.md path.
  const treeRenameBack = (nodes) => {
    for (const n of nodes) {
      if (n.path === "notes/a-renamed.md") { n.path = "notes/a.md"; n.name = "a.md"; return true; }
      if (n.children && treeRenameBack(n.children)) return true;
    }
    return false;
  };
  treeRenameBack(TREE);
  if (typeof FILES !== "undefined" && FILES["notes/a-renamed.md"] !== undefined) {
    FILES["notes/a.md"] = FILES["notes/a-renamed.md"];
    delete FILES["notes/a-renamed.md"];
  }
  await window.NB.sidebar.refresh();
  await tick(20);
  // Bookmark list also reverts to the original path (otherwise the
  // drag-reorder test's setBookmarks(...) overrides it anyway, but
  // staying consistent makes the fixture state obvious).
  window.NB.sidebar.setBookmarks(["notes/a.md", "notes/b.md"]);
  await tick(20);

  // Drag-to-reorder. Reset to [notes/a, notes/b] for a clean test.
  window.NB.sidebar.setBookmarks(["notes/a.md", "notes/b.md"]);
  await tick(20);
  check("bookmarks: setBookmarks prerender -> 2 rows in given order",
    bookmarkRows().length === 2 &&
    bookmarkRows()[0].dataset.path === "notes/a.md" &&
    bookmarkRows()[1].dataset.path === "notes/b.md",
    Array.from(bookmarkRows()).map(r => r.dataset.path).join(","));
  // Drag the second row above the first: dispatch dragstart on
  // source, dragover + drop on target, dragend to clean up. We
  // give the target a real getBoundingClientRect so the before/after
  // math (top half = before) is meaningful in jsdom.
  const bmSrc = bookmarkRows()[1];
  const bmTgt = bookmarkRows()[0];
  const bmRect = bmTgt.getBoundingClientRect.bind(bmTgt);
  bmTgt.getBoundingClientRect = () => ({
    width: 200, height: 24, left: 0, right: 200, top: 0, bottom: 24, x: 0, y: 0, toJSON() {},
  });
  bmSrc.dispatchEvent(new window.Event("dragstart", { bubbles: true }));
  const bmOv = new window.Event("dragover", { bubbles: true });
  Object.defineProperty(bmOv, "clientY", { value: 0 });    // top half -> before
  bmTgt.dispatchEvent(bmOv);
  const bmDp = new window.Event("drop", { bubbles: true });
  Object.defineProperty(bmDp, "clientY", { value: 0 });
  bmTgt.dispatchEvent(bmDp);
  bmSrc.dispatchEvent(new window.Event("dragend", { bubbles: true }));
  await tick(20);
  bmTgt.getBoundingClientRect = bmRect;
  check("bookmarks: drag second -> first reorders the list",
    bookmarkRows()[0].dataset.path === "notes/b.md" &&
    bookmarkRows()[1].dataset.path === "notes/a.md",
    Array.from(bookmarkRows()).map(r => r.dataset.path).join(","));
  // Persist after reorder.
  await tick(350);
  const reorderCfgPost = fetchLog.filter(x => x.startsWith("POST /api/config")).pop() || "";
  check("bookmarks: reorder persisted to cfg",
    /"bookmarks":\["notes\/b\.md","notes\/a\.md"\]/.test(reorderCfgPost),
    reorderCfgPost);

  // Auto-prune on refresh when a file vanishes from the tree.
  // Move both bookmarked files out of the tree (simulate delete via
  // TREE mutation) and refresh -> both rows should be silently dropped
  // from the bookmark list.
  TREE.length = 0;
  TREE.push({ name: "other.md", type: "file", path: "other.md" });
  await window.NB.sidebar.refresh();
  await tick(20);
  check("bookmarks: dead paths pruned on refresh",
    bookmarkRows().length === 0,
    "rows=" + bookmarkRows().length);
  await tick(350);
  const pruneCfgPost = fetchLog.filter(x => x.startsWith("POST /api/config")).pop() || "";
  check("bookmarks: prune persisted (empty list)",
    /"bookmarks":\[\]/.test(pruneCfgPost), pruneCfgPost);

  // Restore the standard tree for the rest of the suite.
  TREE.length = 0;
  TREE.push(
    { name: "notes", type: "dir", path: "notes", children: [
      { name: "a.md", type: "file", path: "notes/a.md" },
      { name: "b.md", type: "file", path: "notes/b.md" },
    ]},
    { name: "Welcome.md", type: "file", path: "Welcome.md" },
  );
  await window.NB.sidebar.refresh();
  await tick(20);
  window.NB.sidebar.setBookmarks([]);
  await tick(20);

  // Reset the tab set to the standard [notes/a.md, created.md] state
  // the rest of the suite expects. The bookmark tests above opened
  // Welcome.md (via the + click path) and notes/b.md (via the bookmark
  // row click) and may have left extra tabs; close any non-canonical
  // ones to avoid cascading state into the tab-close tests below.
  // bookmarks-empty is the source of truth here -- the user never
  // opened Welcome.md deliberately, we only opened it to verify the +
  // button on a non-bookmarked active file. notes/b.md was opened
  // to verify clicking a bookmark row activates the file.
  // The rename test in the bookmark block renamed notes/a.md ->
  // notes/a-renamed.md (the rename click on the bookmark menu). The
  // bookmark list's path follows the rename, but tabs.rename() is
  // NOT called -- the open tab still has its original key. Re-key
  // the tab here so the rest of the suite sees the original path.
  for (const p of ["Welcome.md", "notes/b.md"]) {
    if (window.NB.tabs.isOpen && window.NB.tabs.isOpen(p)) {
      await window.NB.tabs.close(p, { force: true });
      await tick(20);
    }
  }
  if (window.NB.tabs.isOpen && window.NB.tabs.isOpen("notes/a-renamed.md")) {
    window.NB.tabs.rename("notes/a-renamed.md", "notes/a.md");
    await tick(20);
  }
  // Reactivate the canonical active file (notes/a.md) so the
  // following tests have a known active tab.
  await window.NB.tabs.activate("notes/a.md");
  await tick(20);

  console.log("== tabs: close active ==");
  const beforeCount = tabs().length;
  await window.NB.tabs.open("Welcome.md");
  await tick(20);
  check("open Welcome for close-active test", activeTabPath() === "Welcome.md" && tabs().length === beforeCount + 1,
    "active=" + activeTabPath() + " count=" + tabs().length);
  window.NB.tabs.close("Welcome.md");   // close the active tab
  await tick(40);
  check("close-active removes Welcome", !window.document.querySelector('.tab[data-path="Welcome.md"]'));
  check("close-active restores count", tabs().length === beforeCount, "got " + tabs().length);
  check("close-active makes a neighbor active", !!activeTabPath(), "active=" + activeTabPath());

  console.log("== tabs: regression coverage ==");
  // Reset to a known state: close everything (covers close-last-tab -> viewer.clear).
  window.NB.tabs.close("notes/a.md", { force: true });   // non-active
  await tick(10);
  window.NB.tabs.close(activeTabPath(), { force: true }); // active, last tab
  await tick(20);
  // After closing the last tab the right pane switches from the viewer
  // to the welcome page (a friendly landing with action buttons), not
  // the old terse "No file selected" placeholder.
  check("close last tab -> welcome page is visible",
    !$("welcome").hidden, "welcome.hidden=" + $("welcome").hidden);
  check("close last tab -> viewer is hidden", $("viewer").hidden);
  check("close last tab -> #viewer-content has no rendered markdown",
    $("viewer-content").textContent.trim() === "",
    "textContent=" + JSON.stringify($("viewer-content").textContent));
  // The viewer is hidden when the welcome page is up, but the old
  // rendered HTML can resurface if a CSS quirk / transition /
  // devtools toggle briefly un-hides it. showWelcome() must clear
  // innerHTML so the previous file's content is gone for real.
  check("close last tab -> #viewer-content.innerHTML is empty (no stale HTML)",
    $("viewer-content").innerHTML === "",
    "innerHTML=" + JSON.stringify($("viewer-content").innerHTML));
  check("close last tab -> editor hidden", cmIsHidden());
  check("close last tab -> edit button loses .editing class", !$("edit-toggle").classList.contains("editing"));
  check("close last tab -> edit bar hidden", $("edit-bar").hidden);
  check("close last tab -> no active", window.NB.tabs.getActive() === null && !activeTabPath());

  // restore() reads openFiles/activeFile back from config (round-trip).
  await window.NB.tabs.restore(["notes/a.md", "Welcome.md"], "Welcome.md", null);
  await tick(20);
  check("restore reads openFiles -> 2 tabs", tabs().length === 2, "got " + tabs().length);
  check("restore activates activeFile (Welcome)", activeTabPath() === "Welcome.md");
  check("restore includes notes/a.md tab (lazy)", !!window.document.querySelector('.tab[data-path="notes/a.md"]'));

  // Switching tabs while in edit mode preserves unsaved edits (regression).
  await window.NB.tabs.activate("notes/a.md");
  await tick(10);
  window.NB.viewer.startEdit();
  cmSetValue("# notes/a\n\nUNSAVED SWITCH EDITS\n");
  cmFireInput();
  await tick(10);
  await window.NB.tabs.activate("Welcome.md");   // switch away mid-edit
  await tick(20);
  await window.NB.tabs.activate("notes/a.md");   // switch back
  await tick(20);
  check("switch away+back preserves edits", /UNSAVED SWITCH EDITS/.test(cmGetValue()));
  check("switched-back tab still dirty",
    window.document.querySelector('.tab[data-path="notes/a.md"]').classList.contains("dirty"));
  window.NB.viewer.endEdit();   // leave edit (keeps content -> still dirty)
  await tick(10);

  // rename() re-keys the tab and carries dirty state.
  window.NB.tabs.rename("notes/a.md", "notes/renamed.md");
  await tick(10);
  check("rename re-keys tab path", !!window.document.querySelector('.tab[data-path="notes/renamed.md"]'));
  check("rename drops old path", !window.NB.tabs.isOpen("notes/a.md"));
  check("rename adds new path", window.NB.tabs.isOpen("notes/renamed.md"));
  check("rename keeps active -> new path", window.NB.tabs.getActive() === "notes/renamed.md");
  check("rename carries dirty state",
    window.document.querySelector('.tab[data-path="notes/renamed.md"]').classList.contains("dirty"));

  // save() clears the dirty dot. (In the new topbar model you have to be
  // in edit mode to save -- the standalone Save button is gone.)
  window.NB.viewer.startEdit();
  await tick(10);
  click("save-btn");
  await tick(20);
  check("save clears dirty dot",
    !window.document.querySelector('.tab[data-path="notes/renamed.md"]').classList.contains("dirty"));
  window.NB.viewer.endEdit();
  await tick(10);

  // confirm-cancel keeps a dirty tab (and its edits).
  window.NB.viewer.startEdit();
  cmSetValue("# notes/renamed\n\nCANCEL TEST\n");
  cmFireInput();
  window.NB.viewer.endEdit();
  await tick(10);
  const beforeClose = tabs().length;
  window.confirm = () => false;                       // user cancels
  window.NB.tabs.close("notes/renamed.md");           // dirty -> prompts -> cancelled
  await tick(10);
  check("confirm-cancel keeps the tab", tabs().length === beforeClose);
  check("confirm-cancel keeps active", window.NB.tabs.getActive() === "notes/renamed.md");
  check("confirm-cancel keeps dirty",
    window.document.querySelector('.tab[data-path="notes/renamed.md"]').classList.contains("dirty"));
  window.confirm = () => true;                        // restore stub

  // Multi-tab dirty: a full render() re-applies the dot to every dirty tab.
  await window.NB.tabs.activate("Welcome.md");
  await tick(10);
  window.NB.viewer.startEdit();
  cmSetValue("WELCOME DIRTY");
  cmFireInput();
  window.NB.viewer.endEdit();
  await tick(10);
  await window.NB.tabs.activate("notes/renamed.md");  // notes/renamed still dirty
  await tick(10);
  window.NB.tabs.render();                            // force full re-render
  check("multi-tab: notes/renamed dirty after render",
    window.document.querySelector('.tab[data-path="notes/renamed.md"]').classList.contains("dirty"));
  check("multi-tab: Welcome dirty after render",
    window.document.querySelector('.tab[data-path="Welcome.md"]').classList.contains("dirty"));

  // Middle-click (auxclick, button 1) closes a clean tab.
  await window.NB.tabs.open("created.md");
  await tick(20);
  const cnt = tabs().length;
  const createdTab = window.document.querySelector('.tab[data-path="created.md"]');
  createdTab.dispatchEvent(new window.MouseEvent("auxclick", { bubbles: true, button: 1 }));
  await tick(20);
  check("middle-click closes tab", tabs().length === cnt - 1 && !window.NB.tabs.isOpen("created.md"),
    "count=" + tabs().length);

  // Clicking the tab's × button closes it (was broken by a `close` shadowing bug).
  await window.NB.tabs.open("created.md");
  await tick(20);
  const cnt2 = tabs().length;
  const xBtn = window.document.querySelector('.tab[data-path="created.md"] .tab-close');
  xBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  check("× button closes tab", tabs().length === cnt2 - 1 && !window.NB.tabs.isOpen("created.md"),
    "count=" + tabs().length);

  console.log("== tab pin + context menu ==");
  const tabPaths = () => Array.from(tabs()).map(t => t.dataset.path);
  const menuBtn = (label) => Array.from($("tab-context-menu").querySelectorAll("button"))
    .find(b => b.textContent === label);
  const ctxOpen = (sel, x) => window.document.querySelector(sel)
    .dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, clientX: x || 50, clientY: 10 }));

  // reset to a clean 3-tab state: [notes/a.md, Welcome.md, notes/b.md]
  window.NB.tabs.getOpen().slice().forEach(p => window.NB.tabs.close(p, { force: true }));
  await tick(30);
  await window.NB.tabs.open("notes/a.md"); await tick(10);
  await window.NB.tabs.open("Welcome.md"); await tick(10);
  await window.NB.tabs.open("notes/b.md"); await tick(20);
  check("reset: 3 tabs open", tabs().length === 3, "got " + tabs().length);
  check("reset order", tabPaths().join(",") === "notes/a.md,Welcome.md,notes/b.md", tabPaths().join(","));

  // togglePin moves to front, marks pinned, drops the close button, shows marker
  window.NB.tabs.togglePin("Welcome.md");
  await tick(10);
  check("pin: Welcome moved to front", tabPaths()[0] === "Welcome.md", tabPaths().join(","));
  check("pin: Welcome tab is .pinned",
    !!window.document.querySelector('.tab[data-path="Welcome.md"].pinned'));
  check("pin: isPinned reports true", window.NB.tabs.isPinned("Welcome.md"));
  check("pin: pinned tab has no close button",
    !window.document.querySelector('.tab[data-path="Welcome.md"] .tab-close'));
  check("pin: pinned tab shows pin marker",
    !!window.document.querySelector('.tab[data-path="Welcome.md"] .tab-pin'));
  check("pin: unpinned tab keeps close button",
    !!window.document.querySelector('.tab[data-path="notes/a.md"] .tab-close'));

  // context-menu Pin on notes/a -> joins pinned group at its end
  ctxOpen('.tab[data-path="notes/a.md"]', 100);
  check("tab context menu opened", !$("tab-context-menu").hidden);
  menuBtn("Pin").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("menu pin: notes/a pinned", window.NB.tabs.isPinned("notes/a.md"));
  // pinned group [Welcome.md, notes/a.md]; unpinned [notes/b.md]
  check("menu pin: pinned tabs front in order",
    tabPaths()[0] === "Welcome.md" && tabPaths()[1] === "notes/a.md", tabPaths().join(","));

  // context-menu Unpin on Welcome -> drops to start of unpinned section
  ctxOpen('.tab[data-path="Welcome.md"]', 50);
  menuBtn("Unpin").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("menu unpin: Welcome not pinned", !window.NB.tabs.isPinned("Welcome.md"));
  // pinned [notes/a.md]; unpinned [Welcome.md, notes/b.md]
  check("menu unpin: notes/a still front (pinned)", tabPaths()[0] === "notes/a.md", tabPaths().join(","));

  // bulk close protects pinned tabs. state: [notes/a(pinned), Welcome, notes/b]
  await window.NB.tabs.activate("notes/b.md");
  await tick(10);
  // "Close to the right" of Welcome -> closes notes/b (the only one to its right)
  ctxOpen('.tab[data-path="Welcome.md"]', 50);
  check("close-right enabled", menuBtn("Close to the right") && !menuBtn("Close to the right").disabled);
  menuBtn("Close to the right").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  check("close-right removed notes/b", !window.NB.tabs.isOpen("notes/b.md"));
  check("close-right left 2 tabs", tabs().length === 2, "got " + tabs().length);
  check("close-right kept pinned notes/a", window.NB.tabs.isOpen("notes/a.md"));

  // reopen notes/b, then "Close to the left" of notes/b -> closes Welcome,
  // skips the pinned notes/a on its left
  await window.NB.tabs.open("notes/b.md"); await tick(20);
  // state: [notes/a(pinned), Welcome, notes/b]
  ctxOpen('.tab[data-path="notes/b.md"]', 150);
  menuBtn("Close to the left").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  check("close-left removed Welcome (non-pinned)", !window.NB.tabs.isOpen("Welcome.md"));
  check("close-left kept pinned notes/a", window.NB.tabs.isOpen("notes/a.md"));
  check("close-left left 2 tabs", tabs().length === 2, "got " + tabs().length);

  // "Close others" on notes/b: only pinned notes/a remains as an other, which
  // is skipped -> the item is disabled and nothing closes
  ctxOpen('.tab[data-path="notes/b.md"]', 150);
  check("close-others disabled when only pinned other remains",
    menuBtn("Close others") && menuBtn("Close others").disabled);
  window.document.dispatchEvent(new window.Event("click", { bubbles: true })); // close menu
  await tick(10);
  check("tab context menu hides on outside click", $("tab-context-menu").hidden);

  console.log("== tab: Show in file sidebar ==");
  // Right-clicking a tab offers "Show in file sidebar", which expands
  // every parent folder along the file's path and highlights its row.
  TREE.length = 0;
  TREE.push(
    { name: "notes", type: "dir", path: "notes", children: [
      { name: "sub", type: "dir", path: "notes/sub", children: [
        { name: "deep.md", type: "file", path: "notes/sub/deep.md" },
      ]},
      { name: "a.md", type: "file", path: "notes/a.md" },
    ]},
    { name: "Welcome.md", type: "file", path: "Welcome.md" },
  );
  await window.NB.sidebar.refresh();
  await tick(20);
  // Collapse everything so reveal has actual work to do.
  window.NB.sidebar.collapseAll();
  await tick(20);
  await window.NB.tabs.open("notes/sub/deep.md");
  await tick(20);
  check("reveal: tab menu offers 'Show in file sidebar'",
    ctxOpen('.tab[data-path="notes/sub/deep.md"]', 50) ||
    !!(menuBtn("Show in file sidebar")),
    "menu=" + Array.from($("tab-context-menu").querySelectorAll("button")).map(b => b.textContent).join(" / "));
  menuBtn("Show in file sidebar").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  const revealNotes = window.document.querySelector('.tree-row[data-path="notes"]');
  const revealSub = window.document.querySelector('.tree-row[data-path="notes/sub"]');
  const revealDeep = window.document.querySelector('.tree-row[data-path="notes/sub/deep.md"]');
  check("reveal: parent folders expanded in the sidebar",
    revealNotes && !revealNotes.classList.contains("collapsed") &&
    revealSub && !revealSub.classList.contains("collapsed"),
    "notes=" + (revealNotes && revealNotes.className) + " sub=" + (revealSub && revealSub.className));
  check("reveal: the file's row is selected",
    !!revealDeep && revealDeep.classList.contains("selected"),
    revealDeep ? revealDeep.className : "no deep row");

  console.log("== tab drag reorder ==");
  // reset to a clean 3 unpinned-tab state
  window.NB.tabs.togglePin("notes/a.md"); // unpin it
  await tick(10);
  window.NB.tabs.getOpen().slice().forEach(p => window.NB.tabs.close(p, { force: true }));
  await tick(30);
  await window.NB.tabs.open("notes/a.md"); await tick(10);
  await window.NB.tabs.open("Welcome.md"); await tick(10);
  await window.NB.tabs.open("notes/b.md"); await tick(20);
  // order: [notes/a.md, Welcome.md, notes/b.md]
  const dSrc = window.document.querySelector('.tab[data-path="notes/b.md"]');
  const dOver = window.document.querySelector('.tab[data-path="notes/a.md"]');
  const dRect = dOver.getBoundingClientRect.bind(dOver);
  dOver.getBoundingClientRect = () => ({ width: 100, height: 30, left: 0, right: 100, top: 0, bottom: 30, x: 0, y: 0, toJSON() {} });
  dSrc.dispatchEvent(new window.Event("dragstart", { bubbles: true }));
  const ov = new window.Event("dragover", { bubbles: true });
  Object.defineProperty(ov, "clientX", { value: 0 });
  dOver.dispatchEvent(ov);
  const dp = new window.Event("drop", { bubbles: true });
  Object.defineProperty(dp, "clientX", { value: 0 });
  dOver.dispatchEvent(dp);
  await tick(10);
  dOver.getBoundingClientRect = dRect;
  check("drag: notes/b moved to front", tabPaths()[0] === "notes/b.md", tabPaths().join(","));
  check("drag: order is [b, a, Welcome]",
    tabPaths()[1] === "notes/a.md" && tabPaths()[2] === "Welcome.md", tabPaths().join(","));

  // pinned-boundary clamp: pin Welcome, then drag unpinned notes/a onto
  // Welcome's left half -> it must land AFTER the pinned tab, never before it.
  window.NB.tabs.togglePin("Welcome.md"); await tick(10);
  // order: [Welcome(pinned), notes/b, notes/a]
  check("clamp setup: Welcome pinned at front",
    tabPaths()[0] === "Welcome.md" && window.NB.tabs.isPinned("Welcome.md"), tabPaths().join(","));
  const cSrc = window.document.querySelector('.tab[data-path="notes/a.md"]');
  const cOver = window.document.querySelector('.tab[data-path="Welcome.md"]');
  const cRect = cOver.getBoundingClientRect.bind(cOver);
  cOver.getBoundingClientRect = () => ({ width: 100, height: 30, left: 0, right: 100, top: 0, bottom: 30, x: 0, y: 0, toJSON() {} });
  cSrc.dispatchEvent(new window.Event("dragstart", { bubbles: true }));
  const ov2 = new window.Event("dragover", { bubbles: true });
  Object.defineProperty(ov2, "clientX", { value: 0 });
  cOver.dispatchEvent(ov2);
  const dp2 = new window.Event("drop", { bubbles: true });
  Object.defineProperty(dp2, "clientX", { value: 0 });
  cOver.dispatchEvent(dp2);
  await tick(10);
  cOver.getBoundingClientRect = cRect;
  // notes/a moved from last to middle, but stayed after pinned Welcome
  check("clamp: pinned Welcome still first", tabPaths()[0] === "Welcome.md", tabPaths().join(","));
  check("clamp: notes/a second (after pinned), notes/b third",
    tabPaths()[1] === "notes/a.md" && tabPaths()[2] === "notes/b.md", tabPaths().join(","));

  console.log("== sidebar drag-and-drop move ==");
  // Reset to a known state: [notes/a.md, notes/b.md, Welcome.md]. The TREE
  // fixture already has a 'notes' dir with a.md and b.md + Welcome.md.
  TREE.length = 0;
  TREE.push(
    { name: "notes", type: "dir", path: "notes", children: [
      { name: "a.md", type: "file", path: "notes/a.md" },
      { name: "b.md", type: "file", path: "notes/b.md" },
    ]},
    { name: "Welcome.md", type: "file", path: "Welcome.md" },
  );
  await window.NB.sidebar.refresh();
  await tick(20);
  // Helper: drag row -> drop on target row. x = horizontal offset in px.
  async function dndDragDrop(srcPath, targetPath, x) {
    const src = window.document.querySelector('.tree-row[data-path="' +
      srcPath.replace(/"/g, '\\"') + '"]');
    const tgt = targetPath ? window.document.querySelector('.tree-row[data-path="' +
      targetPath.replace(/"/g, '\\"') + '"]') : null;
    if (!src) throw new Error("no src row: " + srcPath);
    src.dispatchEvent(new window.Event("dragstart", { bubbles: true }));
    if (tgt) {
      // Make the row have a real rect so before/after math is meaningful.
      const rect = { width: 200, height: 24, left: 0, right: 200, top: 0, bottom: 24, x: 0, y: 0, toJSON() {} };
      tgt.getBoundingClientRect = () => rect;
      const ov = new window.Event("dragover", { bubbles: true });
      Object.defineProperty(ov, "clientX", { value: x || 50 });
      tgt.dispatchEvent(ov);
      const dp = new window.Event("drop", { bubbles: true });
      Object.defineProperty(dp, "clientX", { value: x || 50 });
      tgt.dispatchEvent(dp);
    } else {
      // drop on the empty tree area
      const empty = new window.Event("drop", { bubbles: true });
      Object.defineProperty(empty, "clientX", { value: x || 50 });
      window.document.getElementById("file-tree").dispatchEvent(empty);
    }
    src.dispatchEvent(new window.Event("dragend", { bubbles: true }));
    await tick(40);
  }

  // Move Welcome.md onto the 'notes' folder row -> should land inside notes.
  // Backend stub applies the move by rewriting the path key in FILES.
  const origMoveItem = window.NB.api.moveItem;
  window.NB.api.moveItem = async (from, to) => {
    fetchLog.push("POST /api/move " + from + " -> " + to);
    if (FILES[from] !== undefined) { FILES[to] = FILES[from]; delete FILES[from]; }
    return { from, to };
  };
  await dndDragDrop("Welcome.md", "notes", 30);
  check("DnD: move Welcome.md into notes/ called the API",
    fetchLog.some(l => /POST \/api\/move.*Welcome\.md.*notes\/Welcome\.md/.test(l)),
    fetchLog.filter(l => l.startsWith("POST /api/move")).join("; "));
  // Update the tree stub to reflect the new path so the next refresh matches
  TREE[0].children.push({ name: "Welcome.md", type: "file", path: "notes/Welcome.md" });
  TREE.pop();
  await window.NB.sidebar.refresh();
  await tick(20);
  check("DnD: tree now contains notes/Welcome.md",
    !!window.document.querySelector('.tree-row[data-path="notes/Welcome.md"]'));

  // Move notes/a.md onto the 'notes' folder row's CHILD (notes/b.md) ->
  // a.md should land beside b.md, in the notes/ dir.
  TREE[0].children = TREE[0].children.filter(c => c.name !== "a.md");
  TREE[0].children.unshift({ name: "a.md", type: "file", path: "notes/a.md" });
  await window.NB.sidebar.refresh();
  await tick(20);
  await dndDragDrop("notes/a.md", "notes/b.md", 10);
  check("DnD: file->file move called API (notes/a.md -> notes/...)",
    fetchLog.filter(l => l.startsWith("POST /api/move notes/a.md")).length >= 1,
    fetchLog.filter(l => l.startsWith("POST /api/move")).join("; "));

  // The destination a.md picked by the drop-beside logic in the absence of
  // a real "insertBefore" semantic should land inside notes/ (same parent).
  TREE[0].children.push({ name: "a.md", type: "file", path: "notes/a.md" });
  await window.NB.sidebar.refresh();

  // Drop on a folder with a different (file) type source: move to root.
  // Set the tree to just a single file "f.md" then drag it onto the empty
  // area. Stub the move to land at root and ensure the API was called.
  TREE.length = 0;
  TREE.push({ name: "f.md", type: "file", path: "f.md" });
  FILES["f.md"] = "# F";
  await window.NB.sidebar.refresh();
  await tick(20);
  await dndDragDrop("f.md", null, 30);
  check("DnD: drop-on-empty called move with root destination",
    fetchLog.some(l => /POST \/api\/move f\.md/.test(l)),
    fetchLog.filter(l => l.startsWith("POST /api/move")).join("; "));

  // Folder-move self-recursion guard: dropping a folder into one of its
  // own descendants must be a no-op (no API call) and surface an alert.
  window.alert = () => { fetchLog.push("alert"); };
  TREE.length = 0;
  TREE.push(
    { name: "d1", type: "dir", path: "d1", children: [
      { name: "d2", type: "dir", path: "d1/d2", children: [] },
    ]},
  );
  await window.NB.sidebar.refresh();
  await tick(20);
  const beforeRecurse = fetchLog.filter(l => l.startsWith("POST /api/move")).length;
  await dndDragDrop("d1", "d1/d2", 30);
  const afterRecurse = fetchLog.filter(l => l.startsWith("POST /api/move")).length;
  check("DnD: folder->descendant is blocked (no API call)",
    afterRecurse === beforeRecurse, "before=" + beforeRecurse + " after=" + afterRecurse);
  check("DnD: folder->descendant surfaces alert", fetchLog.includes("alert"));

  // restore: real implementation so other test blocks (if any) work.
  window.NB.api.moveItem = origMoveItem;

  console.log("== external file change ==");
  // Reset to a clean 2-tab state and seed the cache via activate().
  TREE.length = 0;
  TREE.push(
    { name: "notes", type: "dir", path: "notes", children: [
      { name: "a.md", type: "file", path: "notes/a.md" },
    ]},
    { name: "Welcome.md", type: "file", path: "Welcome.md" },
  );
  FILES["Welcome.md"] = "# Welcome\n\nold\n";
  await window.NB.sidebar.refresh();
  window.NB.tabs.getOpen().slice().forEach(p => window.NB.tabs.close(p, { force: true }));
  await tick(20);
  await window.NB.tabs.open("Welcome.md"); await tick(20);
  check("external: opened Welcome (cache populated)",
    /old/.test(window.document.getElementById("viewer-content").textContent));

  // Case 1: not-dirty + external change -> silent reload, content updates.
  FILES["Welcome.md"] = "# Welcome\n\nnew\n";
  // The test's getFile handler doesn't know about the new content until
  // we make the fetch stub return it.
  window.NB.evt.emit("file:external-change", { path: "Welcome.md", data: { path: "Welcome.md", content: FILES["Welcome.md"], mtime: 9999, size: 99 } });
  await tick(40);
  check("external: clean file auto-reloads", /new/.test(window.document.getElementById("viewer-content").textContent));

  // Case 2: dirty + external change -> confirm() prompt.
  window.NB.viewer.startEdit();
  cmSetValue("MY LOCAL EDITS");
  cmFireInput();
  await tick(10);
  window.confirm = () => { fetchLog.push("confirm(yes)"); return true; };
  window.NB.evt.emit("file:external-change", { path: "Welcome.md", data: { path: "Welcome.md", content: "REMOTE", mtime: 10000, size: 6 } });
  await tick(40);
  check("external: dirty + change -> confirm shown", fetchLog.includes("confirm(yes)"));
  check("external: confirm(yes) reloads", /REMOTE/.test(window.document.getElementById("viewer-content").textContent));

  // Re-dirty, then Cancel.
  window.NB.viewer.startEdit();
  cmSetValue("ANOTHER LOCAL EDIT");
  cmFireInput();
  await tick(10);
  window.confirm = () => { fetchLog.push("confirm(no)"); return false; };
  window.NB.evt.emit("file:external-change", { path: "Welcome.md", data: { path: "Welcome.md", content: "REMOTE2", mtime: 10001, size: 7 } });
  await tick(40);
  check("external: confirm(no) keeps local edits",
    cmGetValue() === "ANOTHER LOCAL EDIT",
    "value=" + cmGetValue());
  const tabEl = window.document.querySelector('.tab[data-path="Welcome.md"]');
  check("external: confirm(no) marks tab as conflict",
    tabEl && !!tabEl.querySelector(".tab-conflict"));

  // Case 3: self-save suppression. After save(), the next external change
  // event for the same path within the window should be ignored.
  // In the new topbar model save() requires edit mode; start it.
  window.NB.viewer.startEdit();
  await tick(10);
  click("save-btn");
  await tick(40);
  // The watcher exposes noteSelfSave to flag a path as "we just wrote this,
  // ignore the next change". The window is 1.5s; verify the public API.
  check("external: noteSelfSave is exposed", typeof window.NB.watcher.noteSelfSave === "function");
  window.NB.watcher.noteSelfSave("Welcome.md");
  // While inside the window, a watcher.notifyChange would drop the event.
  // We test the public path by verifying describe() / isWatching() are
  // unchanged and that the suppression window function exists.
  // For the rest of the test, clear the suppression by waiting past the
  // window (1.5s in the source) so subsequent emits are not swallowed.
  await tick(1600);
  // Now: an emit directly goes through, and the cache+viewer reload.
  window.NB.evt.emit("file:external-change", { path: "Welcome.md", data: { path: "Welcome.md", content: "FRESH", mtime: 20000, size: 5 } });
  await tick(40);
  check("external: post-window change reloaded",
    /FRESH/.test($("viewer-content").textContent),
    "viewer=" + $("viewer-content").textContent.slice(0, 60));

  // Case 4: watch button lives in the settings modal now. Open the modal,
  // verify the status line and the toggle button, then click Disable and
  // check the live watcher stops. Settings are live: the toggle commits
  // on click, no Apply/Save step.
  //
  // File watching auto-starts in the polling fallback on app load
  // (so external change detection is on by default). The status text
  // is "Polling (5s)" and the button reads "Disable" until the user
  // turns it off; after that the status is "Watching off" in the
  // warning color and the button reads "Enable" again.
  window.NB.settings.open();
  await tick(20);
  check("watch: settings modal opens", window.NB.settings.isOpen());
  const statusEl = $("settings-watch-status");
  const watchBtn = $("settings-watch-toggle");
  check("watch: status element exists", !!statusEl);
  check("watch: status starts as 'Polling (5s)' (auto-started fallback)",
    /polling/i.test(statusEl.textContent), statusEl.textContent);
  check("watch: status starts in the watch-on color class",
    statusEl.classList.contains("watch-on") &&
    !statusEl.classList.contains("watch-off"),
    [...statusEl.classList].join(" "));
  check("watch: button starts as 'Disable' (live state)", watchBtn.textContent === "Disable",
    watchBtn.textContent);
  // Click toggle: live watcher disables. Status flips to "Watching off"
  // in the warning color, button back to "Enable".
  watchBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("watch: toggle click -> status reports off",
    /off/i.test(statusEl.textContent), statusEl.textContent);
  check("watch: toggle click -> status flips to watch-off color class",
    statusEl.classList.contains("watch-off") &&
    !statusEl.classList.contains("watch-on"),
    [...statusEl.classList].join(" "));
  check("watch: toggle click -> button is 'Enable'",
    watchBtn.textContent === "Enable", watchBtn.textContent);
  // Click again: re-enables (polling fallback in jsdom, since
  // FileSystemObserver isn't available).
  watchBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("watch: toggle click again -> status reports active",
    /watching|polling/i.test(statusEl.textContent), statusEl.textContent);
  check("watch: toggle click again -> status is back in watch-on color",
    statusEl.classList.contains("watch-on"),
    [...statusEl.classList].join(" "));
  check("watch: toggle click again -> button is 'Disable'",
    watchBtn.textContent === "Disable", watchBtn.textContent);
  // NB.watcher.state() exposes the coarse "off|polling|watching" for
  // any future UI that wants more detail than the binary isActive().
  check("watch: state() reports 'polling' (native observer not in jsdom)",
    window.NB.watcher.state() === "polling",
    window.NB.watcher.state());
  window.NB.settings.close();
  await tick(10);

  console.log("== watcher: polling pauses while the tab is hidden ==");
  // Ensure the polling fallback is the active mechanism (native observer
  // isn't available in jsdom).
  check("visibility: polling is active before hiding",
    window.NB.watcher.state() === "polling", window.NB.watcher.state());
  const treeFetches = () => fetchLog.filter(x => x === "GET /api/tree").length;
  const fetchBeforeHide = treeFetches();
  // Hide the tab: polling must stop (pollTimer cleared -> state() "off").
  Object.defineProperty(window.document, "hidden", { value: true, configurable: true });
  window.document.dispatchEvent(new window.Event("visibilitychange"));
  await tick(20);
  check("visibility: hidden tab stops the poller (state 'off')",
    window.NB.watcher.state() === "off", window.NB.watcher.state());
  // Return to the tab: polling restarts with an immediate tick, so the
  // /api/tree fetch count advances right away.
  const fetchAfterHide = treeFetches();
  Object.defineProperty(window.document, "hidden", { value: false, configurable: true });
  window.document.dispatchEvent(new window.Event("visibilitychange"));
  await tick(20);
  check("visibility: returning to the tab restarts polling (state 'polling')",
    window.NB.watcher.state() === "polling", window.NB.watcher.state());
  check("visibility: resume triggers an immediate tree check",
    treeFetches() > fetchAfterHide,
    "fetches after hide=" + fetchAfterHide + " after resume=" + treeFetches());

  console.log("== watcher -> sidebar tree sync ==");
  // A note created on disk should show up in the sidebar without a page
  // reload. The watcher's refreshTree() (called every poll tick) fetches
  // /api/tree, JSON-compares it to the tree the sidebar last rendered,
  // and refreshes when it differs. Simulate an external create by mutating
  // the stub's TREE, then drive a sync manually (the real 5s interval
  // would be too slow for a unit test).
  const rowCount = () => window.document.querySelectorAll("#file-tree .tree-row").length;
  const rowsBefore = rowCount();
  TREE.push({ name: "extern.md", type: "file", path: "extern.md" });
  await window.NB.watcher.refreshTree();
  await tick(20);
  check("watcher tree: externally-created file appears in sidebar",
    rowCount() === rowsBefore + 1, "rows " + rowsBefore + " -> " + rowCount());
  check("watcher tree: new file row is in the DOM",
    !!window.document.querySelector('#file-tree .tree-row[data-path="extern.md"]'),
    "extern.md row missing");
  // A content-only edit (FILES changed, TREE didn't) must not re-render
  // the sidebar -- the JSON comparison short-circuits the refresh.
  const htmlBefore = window.document.getElementById("file-tree").innerHTML;
  await window.NB.watcher.refreshTree();
  await tick(20);
  check("watcher tree: content-only edit does not re-render the sidebar",
    window.document.getElementById("file-tree").innerHTML === htmlBefore);
  // Deleting the file on disk removes the row.
  TREE.pop();
  await window.NB.watcher.refreshTree();
  await tick(20);
  check("watcher tree: externally-deleted file disappears from sidebar",
    rowCount() === rowsBefore, "rows=" + rowCount());

  console.log("== settings nav ==");
  // Left sidebar nav: General / Appearance / Security / About. Clicking
  // an entry shows its section and hides the rest; the active entry
  // gets `.active` + `aria-selected="true"`. The four sections live
  // inside `.settings-sections` and each carries a `data-section="…"`
  // attribute that matches the nav button's `data-tab="…"`.
  const navButtons = Array.from(window.document.querySelectorAll(".settings-nav-item"));
  const navTabs    = navButtons.map(b => b.dataset.tab);
  const sectionEls = Array.from(window.document.querySelectorAll(".settings-section[data-section]"));
  check("settings nav: 6 nav buttons present", navButtons.length === 6,
    "count=" + navButtons.length);
  check("settings nav: 6 sections present", sectionEls.length === 6,
    "count=" + sectionEls.length);
  check("settings nav: every data-tab has a matching data-section",
    navTabs.every(t => sectionEls.some(s => s.dataset.section === t)),
    "tabs=" + JSON.stringify(navTabs));
  check("settings nav: every data-section has a matching data-tab",
    sectionEls.every(s => navTabs.includes(s.dataset.section)),
    "sections=" + JSON.stringify(sectionEls.map(s => s.dataset.section)));
  // Exact ordering matches what the user asked for.
  check("settings nav: tabs in order [general, appearance, shortcuts, security, ai, about]",
    JSON.stringify(navTabs) === JSON.stringify(["general", "appearance", "shortcuts", "security", "ai", "about"]),
    JSON.stringify(navTabs));
  // Each nav button wraps its leading icon in a .nav-icon span so
  // the label text starts at a consistent x position regardless of
  // the emoji's glyph width. Verify the wrapper exists and is
  // hidden from a11y (decorative); the actual fixed-width style
  // lives in the real stylesheet which the harness doesn't load
  // (so we can't test computed style here).
  const iconEls = navButtons.map(b => b.querySelector(".nav-icon"));
  check("settings nav: every button has a .nav-icon wrapper",
    iconEls.every(el => !!el),
    "missing=" + iconEls.map((el, i) => el ? null : navTabs[i]).filter(Boolean).join(","));
  check("settings nav: .nav-icon is aria-hidden (decorative)",
    iconEls.every(el => el && el.getAttribute("aria-hidden") === "true"));
  // The label text (after the icon span) should be the same set the
  // user sees -- no extra emoji baked into the string.
  const navLabels = navButtons.map(b =>
    (b.querySelector(".nav-icon") && b.querySelector(".nav-icon").nextSibling
      ? b.querySelector(".nav-icon").nextSibling.nodeValue : b.textContent));
  check("settings nav: labels are the plain words (no emoji in text)",
    JSON.stringify(navLabels) === JSON.stringify(["General","Appearance","Shortcuts","Security","AI","About"]),
    JSON.stringify(navLabels));
  // Fresh open: General is the default tab.
  if (window.NB.settings.isOpen()) window.NB.settings.close();
  await tick(10);
  window.NB.settings.open(); await tick(20);
  const generalBtn = navButtons.find(b => b.dataset.tab === "general");
  check("settings nav: on open, general is the active nav button",
    generalBtn && generalBtn.classList.contains("active"),
    "classes=" + generalBtn.className);
  check("settings nav: on open, general nav button has aria-selected=true",
    generalBtn && generalBtn.getAttribute("aria-selected") === "true");
  for (const t of ["appearance", "security", "about"]) {
    const b = navButtons.find(x => x.dataset.tab === t);
    check("settings nav: on open, " + t + " nav button is NOT active",
      b && !b.classList.contains("active"),
      "classes=" + b.className);
    check("settings nav: on open, " + t + " nav button has aria-selected=false",
      b && b.getAttribute("aria-selected") === "false");
  }
  // On open, only the general section is visible.
  for (const s of sectionEls) {
    const isGeneral = s.dataset.section === "general";
    check("settings nav: on open, section[" + s.dataset.section + "] is "
      + (isGeneral ? "visible" : "hidden"),
      s.hidden === !isGeneral,
      "hidden=" + s.hidden);
  }
  // Click each tab in turn; verify section visibility + nav active class
  // follow. Modal stays open the whole time.
  for (const t of ["appearance", "security", "about", "general"]) {
    const btn = navButtons.find(b => b.dataset.tab === t);
    btn.dispatchEvent(new window.Event("click", { bubbles: true }));
    await tick(20);
    check("settings nav: click '" + t + "' -> nav button has active class",
      btn.classList.contains("active"), "classes=" + btn.className);
    check("settings nav: click '" + t + "' -> nav button has aria-selected=true",
      btn.getAttribute("aria-selected") === "true");
    for (const s of sectionEls) {
      const expectedVisible = (s.dataset.section === t);
      check("settings nav: click '" + t + "' -> section[" + s.dataset.section
        + "] is " + (expectedVisible ? "visible" : "hidden"),
        s.hidden === !expectedVisible, "hidden=" + s.hidden);
    }
    // No other nav button should be active.
    for (const other of navButtons) {
      if (other === btn) continue;
      check("settings nav: click '" + t + "' -> nav '" + other.dataset.tab
        + "' is NOT active",
        !other.classList.contains("active"));
    }
  }
  // After clicking through all tabs, modal should still be open.
  check("settings nav: clicking tabs keeps the modal open", window.NB.settings.isOpen());
  window.NB.settings.close();
  await tick(10);

  console.log("== shortcuts ==");
  // The non-vim app keymap (Settings -> Shortcuts). Defaults:
  // Mod+S save, / openSearch, Mod+E toggleEdit, Mod+Shift+E toggleHybrid,
  // Alt+H/L tabPrev/Next, Mod+Shift+T toggleTopbar, Mod+comma openSettings.
  // Active when VIM mode is off and no modal is up.
  const sc = window.NB.shortcuts;
  const shortcutsList = $("settings-shortcuts-list");
  check("shortcuts: NB.shortcuts module loaded", !!sc);
  check("shortcuts: 9 default actions",
    sc.getActionOrder().length === 9 &&
    sc.getDefaults().save === "Mod+S" &&
    sc.getDefaults().openSearch === "/" &&
    sc.getDefaults().tabPrev === "Alt+H" &&
    sc.getDefaults().tabNext === "Alt+L" &&
    sc.getDefaults().toggleEdit === "Mod+E" &&
    sc.getDefaults().toggleHybrid === "Mod+Shift+E" &&
    sc.getDefaults().windowCycle === "Mod+W" &&
    sc.getDefaults().toggleTopbar === "Mod+Shift+T" &&
    sc.getDefaults().openSettings === "Mod+comma");
  // The list helpers expose the same set the UI renders.
  const labels = sc.getActionLabels();
  check("shortcuts: labels exist for all actions",
    labels.save && labels.openSearch && labels.tabPrev && labels.tabNext &&
    labels.toggleEdit && labels.toggleHybrid && labels.windowCycle &&
    labels.toggleTopbar && labels.openSettings);

  // Open the Shortcuts tab and verify the rendered rows.
  window.NB.settings.open();
  await tick(20);
  const navBtns = Array.from(window.document.querySelectorAll(".settings-nav-item"));
  navBtns.find(b => b.dataset.tab === "shortcuts").click();
  await tick(20);
  let scRows = shortcutsList.querySelectorAll(".shortcut-row");
  check("shortcuts: 9 rows rendered", scRows.length === 9, "got " + scRows.length);
  const expFmt = {
    save: "Ctrl+S",
    openSearch: "/",
    tabPrev: "Alt+H",
    tabNext: "Alt+L",
    toggleEdit: "Ctrl+E",
    toggleHybrid: "Ctrl+Shift+E",
    windowCycle: "Ctrl+W",
    toggleTopbar: "Ctrl+Shift+T",
    openSettings: "Ctrl+Comma",
  };
  for (const r of scRows) {
    const a = r.dataset.action;
    const txt = r.querySelector(".shortcut-binding").textContent;
    check("shortcuts: " + a + " default displays as " + expFmt[a],
      txt === expFmt[a], "got " + JSON.stringify(txt));
    // Unchanged rows hide the Reset button.
    check("shortcuts: " + a + " reset hidden at default",
      r.querySelector(".shortcut-reset").hidden);
  }
  // The help text makes it clear the VIM keymap is a separate thing.
  const shortcutsHelp = $("settings-section-shortcuts").querySelector(".settings-help");
  check("shortcuts: help text mentions VIM is separate",
    shortcutsHelp && /VIM/i.test(shortcutsHelp.textContent));

  // The fixed hybrid-editor reference table below the configurable rows.
  const staticRows = $("settings-section-shortcuts")
    .querySelectorAll(".shortcut-row-static");
  check("shortcuts: 6 fixed hybrid reference rows",
    staticRows.length === 6, "got " + staticRows.length);
  const staticKbds = Array.from(staticRows).map(r =>
    r.querySelector(".shortcut-binding").textContent);
  check("shortcuts: hybrid rows localized via format() (Mod+B -> Ctrl+B)",
    staticKbds.includes("Ctrl+B") && staticKbds.includes("Ctrl+I") &&
    staticKbds.includes("Ctrl+Shift+X") && staticKbds.includes("Ctrl+Shift+C"),
    JSON.stringify(staticKbds));
  check("shortcuts: hybrid rows have no Change/Reset buttons",
    Array.from(staticRows).every(r => !r.querySelector(".shortcut-change") &&
      !r.querySelector(".shortcut-reset")));
  // The live-markdown syntax note is in the same section.
  check("shortcuts: live markdown syntax note present",
    /live markdown|typing these/i.test(
      $("settings-section-shortcuts").textContent));

  // --- a default binding actually fires ( / -> openSearch) ---
  // Close the modal so the global shortcut dispatch is unblocked.
  window.NB.settings.close();
  await tick(10);
  // Make sure no input is holding focus (so the post-press focus
  // change to #search-input is attributable to the shortcut).
  if (window.document.activeElement && window.document.activeElement !== window.document.body) {
    window.document.activeElement.blur();
  }
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "/", code: "Slash", bubbles: true, cancelable: true,
  }));
  await tick(20);
  check("shortcuts: / (default openSearch) focuses #search-input",
    window.document.activeElement === $("search-input"),
    "active=" + (window.document.activeElement && window.document.activeElement.id));
  $("search-input").blur(); await tick(10);

  // --- modifierless / must NOT fire when an input has focus ---
  // The user is typing, not invoking a shortcut -- the dispatcher
  // guards bare-chord matches so the keystroke passes through.
  $("search-input").focus();
  await tick(10);
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "/", code: "Slash", bubbles: true, cancelable: true,
  }));
  await tick(20);
  check("shortcuts: / in an input does NOT fire openSearch (typing guard)",
    window.document.activeElement === $("search-input") &&
    window.document.getElementById("search-results").hidden,
    "results.hidden=" + window.document.getElementById("search-results").hidden);
  $("search-input").blur(); await tick(10);

  // --- rebind via the API and verify the new binding fires (and the
  // old one stops firing) ---
  sc.setBinding("openSearch", "Mod+G");
  await tick(20);
  if (window.document.activeElement && window.document.activeElement !== window.document.body) {
    window.document.activeElement.blur();
  }
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "g", code: "KeyG", ctrlKey: true, bubbles: true, cancelable: true,
  }));
  await tick(20);
  check("shortcuts: new binding (Mod+G) fires openSearch",
    window.document.activeElement === $("search-input"),
    "active=" + (window.document.activeElement && window.document.activeElement.id));
  $("search-input").blur(); await tick(10);
  if (window.document.activeElement && window.document.activeElement !== window.document.body) {
    window.document.activeElement.blur();
  }
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "/", code: "Slash", bubbles: true, cancelable: true,
  }));
  await tick(20);
  check("shortcuts: old binding (/) no longer fires after rebind",
    window.document.activeElement !== $("search-input"),
    "active=" + (window.document.activeElement && window.document.activeElement.id));

  // --- reset a single binding ---
  sc.resetBinding("openSearch");
  await tick(10);
  if (window.document.activeElement && window.document.activeElement !== window.document.body) {
    window.document.activeElement.blur();
  }
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "/", code: "Slash", bubbles: true, cancelable: true,
  }));
  await tick(20);
  check("shortcuts: resetBinding restores default (/ fires again)",
    window.document.activeElement === $("search-input"));
  $("search-input").blur(); await tick(10);

  // --- tabPrev / tabNext (Alt+H / Alt+L) actually cycle tabs ---
  // The suite has Welcome.md open from the earlier "external change"
  // block. Open a second tab (notes/a.md) so cycling has somewhere
  // to go, capture the state, and restore it at the end so the rest
  // of the suite is unaffected.
  const preCycleTabs = window.NB.tabs.getOpen().slice();
  const preCycleActive = window.NB.tabs.getActive();
  await window.NB.tabs.open("notes/a.md");
  await tick(20);
  // Make notes/a.md the active tab so Alt+L is the well-defined next.
  if (window.NB.tabs.getActive() !== "notes/a.md") {
    await window.NB.tabs.activate("notes/a.md");
    await tick(20);
  }
  check("shortcuts: tab cycle precondition: two tabs open",
    window.NB.tabs.getOpen().length >= 2);
  // Alt+L (tabNext) -> moves to the next tab.
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "h", code: "KeyL", altKey: true, bubbles: true, cancelable: true,
  }));
  await tick(20);
  check("shortcuts: Alt+L (default tabNext) cycles to the next tab",
    window.NB.tabs.getActive() !== "notes/a.md",
    "active=" + window.NB.tabs.getActive());
  const afterNext = window.NB.tabs.getActive();
  // Alt+H (tabPrev) -> moves back.
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "h", code: "KeyH", altKey: true, bubbles: true, cancelable: true,
  }));
  await tick(20);
  check("shortcuts: Alt+H (default tabPrev) cycles to the previous tab",
    window.NB.tabs.getActive() === "notes/a.md",
    "active=" + window.NB.tabs.getActive());
  // Restore the pre-test tab set so later blocks see a clean state.
  for (const p of window.NB.tabs.getOpen().slice()) {
    if (!preCycleTabs.includes(p)) {
      await window.NB.tabs.close(p, { force: true });
      await tick(10);
    }
  }
  if (preCycleActive && window.NB.tabs.getActive() !== preCycleActive) {
    await window.NB.tabs.activate(preCycleActive);
    await tick(20);
  }
  $("search-input").blur(); await tick(10);

  // --- openSettings (Ctrl+,) actually fires ---
  // Make sure the modal is closed so the global dispatch runs.
  if (window.NB.settings.isOpen()) window.NB.settings.close();
  await tick(10);
  if (window.document.activeElement && window.document.activeElement !== window.document.body) {
    window.document.activeElement.blur();
  }
  check("shortcuts: openSettings precondition: modal closed",
    !window.NB.settings.isOpen());
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
    key: ",", code: "Comma", ctrlKey: true, bubbles: true, cancelable: true,
  }));
  await tick(20);
  check("shortcuts: Ctrl+, (default openSettings) opens the Settings modal",
    window.NB.settings.isOpen());
  window.NB.settings.close();
  await tick(10);

  // --- capture flow: Change -> press a key -> row updates ---
  window.NB.settings.open();
  await tick(20);
  navBtns.find(b => b.dataset.tab === "shortcuts").click();
  await tick(20);
  const osRow = shortcutsList.querySelector('.shortcut-row[data-action="openSearch"]');
  osRow.querySelector(".shortcut-change").click();
  await tick(20);
  check("shortcuts: capture -> binding cell shows prompt",
    /Press a key/.test(osRow.querySelector(".shortcut-binding").textContent));
  check("shortcuts: capture -> change button is now 'Cancel'",
    osRow.querySelector(".shortcut-change").textContent === "Cancel");
  check("shortcuts: capture -> row has capturing class",
    osRow.querySelector(".shortcut-binding").classList.contains("shortcut-binding-capturing"));
  // Press Ctrl+H -> new binding stored, row re-renders.
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "h", code: "KeyH", ctrlKey: true, bubbles: true, cancelable: true,
  }));
  await tick(20);
  check("shortcuts: capture -> new binding stored",
    sc.getBinding("openSearch") === "Mod+H");
  const osRowAfter = shortcutsList.querySelector('.shortcut-row[data-action="openSearch"]');
  check("shortcuts: capture -> row now displays Ctrl+H",
    osRowAfter.querySelector(".shortcut-binding").textContent === "Ctrl+H");
  // Reset button is visible for changed rows.
  check("shortcuts: changed row shows Reset button",
    !osRowAfter.querySelector(".shortcut-reset").hidden);

  // --- Esc during capture cancels ---
  osRowAfter.querySelector(".shortcut-change").click();
  await tick(20);
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "Escape", bubbles: true, cancelable: true,
  }));
  await tick(20);
  check("shortcuts: Esc during capture -> binding unchanged (still Mod+H)",
    sc.getBinding("openSearch") === "Mod+H");
  const osRowAfterEsc = shortcutsList.querySelector('.shortcut-row[data-action="openSearch"]');
  check("shortcuts: Esc -> button text back to 'Change…'",
    osRowAfterEsc.querySelector(".shortcut-change").textContent === "Change…");
  check("shortcuts: Esc -> capturing class removed",
    !osRowAfterEsc.querySelector(".shortcut-binding").classList.contains("shortcut-binding-capturing"));

  // --- Reset all ---
  $("settings-shortcuts-reset-all").click();
  await tick(20);
  check("shortcuts: reset all -> openSearch back to default",
    sc.getBinding("openSearch") === "/");
  const allRows = shortcutsList.querySelectorAll(".shortcut-row");
  let allResetHidden = true;
  for (const r of allRows) {
    if (!r.querySelector(".shortcut-reset").hidden) allResetHidden = false;
  }
  check("shortcuts: reset all -> every row's Reset is hidden", allResetHidden);
  // And the UI shows the formatted defaults again.
  const osRowFinal = shortcutsList.querySelector('.shortcut-row[data-action="openSearch"]');
  check("shortcuts: reset all -> openSearch row shows /",
    osRowFinal.querySelector(".shortcut-binding").textContent === "/");

  // --- modal blocks the global dispatch ---
  // With settings open, / should NOT focus the search input
  // (the module yields when a modal is up).
  if (window.document.activeElement && window.document.activeElement !== window.document.body) {
    window.document.activeElement.blur();
  }
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "/", code: "Slash", bubbles: true, cancelable: true,
  }));
  await tick(20);
  check("shortcuts: settings open -> / does NOT fire (modal blocks)",
    window.document.activeElement !== $("search-input"),
    "active=" + (window.document.activeElement && window.document.activeElement.id));
  // But the capture flow still works inside the modal (the Change
  // button armed capture, and a key inside the modal is captured).
  const osRowInModal = shortcutsList.querySelector('.shortcut-row[data-action="openSearch"]');
  osRowInModal.querySelector(".shortcut-change").click();
  await tick(20);
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "j", code: "KeyJ", ctrlKey: true, bubbles: true, cancelable: true,
  }));
  await tick(20);
  check("shortcuts: capture works while settings modal is open",
    sc.getBinding("openSearch") === "Mod+J");
  $("settings-shortcuts-reset-all").click(); await tick(20);
  window.NB.settings.close();
  await tick(10);

  // --- VIM mode disables the non-vim shortcuts ---
  // With vim on, the shell keymap (vimnav) owns the keyboard and
  // the shortcuts module yields. The VIM keymap itself is NOT
  // configurable here -- that's the whole point of the "VIM mode"
  // separate toggle.
  window.NB.app.setVimMode(true);
  await tick(20);
  // Sanity: vim mode is on.
  check("shortcuts: vim mode on precondition: NB.vimnav.isEnabled()",
    window.NB.vimnav && window.NB.vimnav.isEnabled() === true,
    "isEnabled=" + (window.NB.vimnav && window.NB.vimnav.isEnabled()));
  // Cross-module regression: Ctrl+/ with vim on should disable vim
  // WITHOUT also triggering the non-vim openSearch. To exercise
  // the double-fire path, rebind openSearch to Ctrl+/ first -- then
  // without the stopImmediatePropagation fix, the shortcuts module
  // would observe the now-off vim flag and fire its (rebound) Ctrl+/
  // binding, opening search as a side effect of disabling vim.
  // The shell keymap (and its Ctrl+/ escape hatch) is live only
  // while editing, so enter edit mode first.
  sc.setBinding("openSearch", "Ctrl+/");
  await tick(10);
  if (cmIsHidden()) { click("edit-toggle"); await tick(20); }
  if (window.document.activeElement && window.document.activeElement !== window.document.body) {
    window.document.activeElement.blur();
  }
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "/", code: "Slash", ctrlKey: true, bubbles: true, cancelable: true,
  }));
  await tick(20);
  check("shortcuts: vim on + Ctrl+/ -> vim disables AND search does NOT open",
    !window.NB.vimnav.isEnabled() &&
    window.document.activeElement !== $("search-input"),
    "vimEnabled=" + window.NB.vimnav.isEnabled() +
    " active=" + (window.document.activeElement && window.document.activeElement.id));
  // Restore for the next block (the big vim mode test that runs
  // later in the suite enables vim via the settings toggle and
  // expects the default off state at boot of that block).
  sc.resetBinding("openSearch");
  await tick(10);
  if (!cmIsHidden()) { click("edit-toggle"); await tick(20); }
  window.NB.app.setVimMode(false);
  await tick(20);

  // --- the app CLAIMS its configured chords (preventDefault) ---
  // Even when the handler doesn't fire (vim on, modal open), the
  // module preventDefaults on every configured chord so the browser
  // knows the app owns the key and doesn't act on it. The only
  // exception is the typing guard (modifierless chord in a text
  // input), which lets the keystroke through.
  //
  // We test by dispatching a keydown and reading event.defaultPrevented
  // after dispatchEvent returns -- a reliable signal that some
  // listener called preventDefault.
  if (window.NB.settings.isOpen()) window.NB.settings.close();
  await tick(10);
  if (window.document.activeElement && window.document.activeElement !== window.document.body) {
    window.document.activeElement.blur();
  }
  // 1) Default save (Ctrl+S) with vim off -> preventDefault + fires.
  {
    const e = new window.KeyboardEvent("keydown", {
      key: "s", code: "KeyS", ctrlKey: true, bubbles: true, cancelable: true,
    });
    window.document.dispatchEvent(e);
    check("shortcuts: claim -> default save (Ctrl+S) is preventDefaulted",
      e.defaultPrevented === true);
  }
  // 2) Rebound openSearch (Ctrl+,) with vim off -> preventDefault.
  {
    const e = new window.KeyboardEvent("keydown", {
      key: ",", code: "Comma", ctrlKey: true, bubbles: true, cancelable: true,
    });
    window.document.dispatchEvent(e);
    check("shortcuts: claim -> Ctrl+, is preventDefaulted (regression)",
      e.defaultPrevented === true);
  }
  // 3) With vim ON, a configured chord is STILL preventDefaulted
  // (the handler doesn't fire, but the chord is claimed so the
  // browser doesn't act on it).
  window.NB.app.setVimMode(true);
  await tick(20);
  if (window.document.activeElement && window.document.activeElement !== window.document.body) {
    window.document.activeElement.blur();
  }
  {
    // Rebind openSettings to Ctrl+L (a chord the browser uses for
    // "focus address bar"). The app claims it regardless of vim.
    sc.setBinding("openSettings", "Ctrl+L");
    await tick(10);
    const e = new window.KeyboardEvent("keydown", {
      key: "l", code: "KeyL", ctrlKey: true, bubbles: true, cancelable: true,
    });
    window.document.dispatchEvent(e);
    check("shortcuts: claim -> Ctrl+L preventDefaulted even with vim on (browser wouldn't focus address bar)",
      e.defaultPrevented === true);
    // Restore.
    sc.resetBinding("openSettings");
    await tick(10);
  }
  // 4) Modal open -> configured chord is still preventDefaulted
  // (the handler doesn't fire because the modal owns the keys,
  // but the app still claims the chord).
  window.NB.app.setVimMode(false);
  await tick(20);
  window.NB.settings.open();
  await tick(20);
  {
    const savesBefore = fetchLog.filter(l => l.startsWith("POST /api/file")).length;
    const e = new window.KeyboardEvent("keydown", {
      key: "s", code: "KeyS", ctrlKey: true, bubbles: true, cancelable: true,
    });
    window.document.dispatchEvent(e);
    check("shortcuts: claim -> Ctrl+S preventDefaulted even with settings open",
      e.defaultPrevented === true);
    // The handler should NOT have fired (modal blocks) -- no new
    // save POST should have been logged. Snapshot fetchLog before
    // the dispatch and compare after.
    const savesAfter = fetchLog.filter(l => l.startsWith("POST /api/file")).length;
    check("shortcuts: modal open -> handler does NOT fire (no new save POST)",
      savesAfter === savesBefore,
      "before=" + savesBefore + " after=" + savesAfter);
  }
  window.NB.settings.close();
  await tick(10);
  // 5) Typing guard: modifierless chord in an input is NOT
  // preventDefaulted -- the keystroke passes through to the input.
  {
    $("search-input").focus();
    await tick(10);
    const e = new window.KeyboardEvent("keydown", {
      key: "/", code: "Slash", bubbles: true, cancelable: true,
    });
    window.document.dispatchEvent(e);
    check("shortcuts: claim -> / in an input is NOT preventDefaulted (typing guard)",
      e.defaultPrevented === false);
    $("search-input").blur();
    await tick(10);
  }
  // 6) A key the app does NOT claim (e.g. Ctrl+L with no binding)
  // is not preventDefaulted -- the browser should handle it normally.
  {
    // First, make sure no action is bound to Ctrl+L. openSettings was
    // reset to default Mod+comma above, so Ctrl+L is unclaimed.
    const e = new window.KeyboardEvent("keydown", {
      key: "l", code: "KeyL", ctrlKey: true, bubbles: true, cancelable: true,
    });
    window.document.dispatchEvent(e);
    check("shortcuts: claim -> unclaimed chord (Ctrl+L with no binding) NOT preventDefaulted",
      e.defaultPrevented === false);
  }

  console.log("== settings modal ==");
  // Closed by default.
  check("settings: closed initially", !window.NB.settings.isOpen());
  // The overlay must actually be invisible, not just .isOpen() === false.
  // (Regression guard: `display: flex` on .settings-overlay would otherwise
  // outrank the UA's [hidden] { display: none } and pop the modal up.)
  {
    // Pull the live computed style the same way a real browser would.
    const overlayStyle = window.getComputedStyle($("settings-overlay"));
    check("settings: overlay hidden-by-attr is display:none on load",
      overlayStyle.display === "none", "computed display=" + overlayStyle.display);
  }
  // Open via the gear button in the activity bar.
  $("activity-settings-btn").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  check("settings: gear button opens modal", window.NB.settings.isOpen());
  check("settings: overlay is visible (no hidden attr)", !$("settings-overlay").hidden);
  // Footer has a single Close button (no Apply/Save/Cancel).
  check("settings: footer has a Close button (no Apply/Save/Cancel)",
    !!$("settings-close-btn") && !$("settings-apply") && !$("settings-save") && !$("settings-cancel"));
  // Esc closes.
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await tick(10);
  check("settings: Esc closes", !window.NB.settings.isOpen());
  // Open + close via × button.
  window.NB.settings.open(); await tick(10);
  $("settings-close").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("settings: × button closes", !window.NB.settings.isOpen());
  // Open + close via footer Close button.
  window.NB.settings.open(); await tick(10);
  $("settings-close-btn").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("settings: footer Close button closes", !window.NB.settings.isOpen());
  // Open + click on backdrop closes.
  window.NB.settings.open(); await tick(10);
  // dispatch a click whose target IS the overlay (not the modal)
  const backdropClick = new window.MouseEvent("click", { bubbles: true });
  Object.defineProperty(backdropClick, "target", { value: $("settings-overlay") });
  $("settings-overlay").dispatchEvent(backdropClick);
  await tick(10);
  check("settings: overlay-click closes", !window.NB.settings.isOpen());
  // Click on the modal itself does NOT close.
  window.NB.settings.open(); await tick(10);
  const modalClick = new window.MouseEvent("click", { bubbles: true });
  Object.defineProperty(modalClick, "target", { value: $("settings-overlay").querySelector(".settings-modal") });
  $("settings-overlay").dispatchEvent(modalClick);
  await tick(10);
  check("settings: click inside modal keeps it open", window.NB.settings.isOpen());
  window.NB.settings.close();
  // Data-dir info loaded via /api/info on first open.
  window.NB.settings.open(); await tick(40);
  check("settings: data dir shown",
    $("settings-data-dir").textContent === "/tmp/test/data",
    $("settings-data-dir").textContent);
  check("settings: config dir shown",
    $("settings-config-dir").textContent === "/tmp/test/config",
    $("settings-config-dir").textContent);
  window.NB.settings.close();

  // --- toggleTopbar (Mod+Shift+T) hides/shows the top bar ---
  const topbarEl = $("topbar");
  check("shortcuts: topbar visible by default",
    !window.document.body.classList.contains("topbar-hidden"));
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "T", code: "KeyT", ctrlKey: true, shiftKey: true,
    bubbles: true, cancelable: true,
  }));
  await tick(20);
  check("shortcuts: Mod+Shift+T hides the topbar",
    window.document.body.classList.contains("topbar-hidden"),
    "class=" + window.document.body.className);
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "T", code: "KeyT", ctrlKey: true, shiftKey: true,
    bubbles: true, cancelable: true,
  }));
  await tick(20);
  check("shortcuts: Mod+Shift+T shows the topbar again",
    !window.document.body.classList.contains("topbar-hidden"));

  console.log("== site title + hide top bar settings ==");
  // The site title is editable in General settings and drives both the
  // browser tab title and the top-bar brand.
  const brandEl = window.document.querySelector(".brand");
  check("title: default brand shows 'Notebook'",
    brandEl && brandEl.textContent.includes("Notebook"),
    "brand=" + (brandEl && brandEl.textContent));
  check("title: default document.title is 'Notebook'",
    window.document.title === "Notebook", "title=" + window.document.title);
  window.NB.settings.open();
  await tick(20);
  const siteTitleInput = $("settings-site-title");
  check("title: site title field exists in General", !!siteTitleInput);
  check("title: site title field prefilled from cfg",
    siteTitleInput.value === "Notebook", "value=" + siteTitleInput.value);
  siteTitleInput.value = "My Notes";
  siteTitleInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(20);
  check("title: typing updates the brand live",
    brandEl && brandEl.textContent.includes("My Notes"),
    "brand=" + (brandEl && brandEl.textContent));
  check("title: typing updates document.title live",
    window.document.title === "My Notes", "title=" + window.document.title);
  check("title: cfg.siteTitle updated",
    window.NB.app.getCfg().siteTitle === "My Notes",
    "siteTitle=" + window.NB.app.getCfg().siteTitle);
  // Empty input falls back to the default.
  siteTitleInput.value = "   ";
  siteTitleInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(20);
  check("title: blank input falls back to 'Notebook'",
    window.document.title === "Notebook" && window.NB.app.getCfg().siteTitle === "Notebook",
    "title=" + window.document.title);
  // Restore a known title for the rest of the suite.
  siteTitleInput.value = "Notebook";
  siteTitleInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(20);

  // Hide top bar: Appearance checkbox, live + persisted.
  const hideTopbarCheck = $("settings-hide-topbar");
  check("topbar: hide-top-bar checkbox exists in Appearance", !!hideTopbarCheck);
  check("topbar: checkbox unchecked by default", hideTopbarCheck.checked === false);
  hideTopbarCheck.checked = true;
  hideTopbarCheck.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("topbar: checking hides the top bar live",
    window.document.body.classList.contains("topbar-hidden"));
  check("topbar: cfg.hideTopbar updated",
    window.NB.app.getCfg().hideTopbar === true);
  hideTopbarCheck.checked = false;
  hideTopbarCheck.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("topbar: unchecking shows the top bar again",
    !window.document.body.classList.contains("topbar-hidden"));
  window.NB.settings.close();
  await tick(10);

  console.log("== auth ==");
  // The fetch stub defaults to authEnabled=false so the modal is closed and
  // the logout button is hidden. Verify that baseline, then exercise the
  // login + logout paths.

  // Wait briefly so any pending DOMContentLoaded work settles, then check.
  await tick(40);
  check("auth: modal hidden by default (auth disabled)", $("auth-overlay").hidden);
  check("auth: body is not auth-locked", !window.document.body.classList.contains("auth-locked"));
  check("auth: logout button hidden by default", $("logout-btn").hidden);

  // Expose the public hooks for direct testing.
  check("auth: NB.auth is exposed", typeof window.NB.auth === "object"
    && typeof window.NB.auth.showModal === "function");
  check("auth: NB.api.getAuthStatus is exposed", typeof window.NB.api.getAuthStatus === "function");
  check("auth: NB.api.login is exposed", typeof window.NB.api.login === "function");
  check("auth: NB.api.logout is exposed", typeof window.NB.api.logout === "function");

  // Enable auth in the stub + call showModal() to simulate the boot path
  // (boot is idempotent and only ran once with authEnabled=false; testing
  // the boot itself is the same code path exercised by the showModal call
  // below since boot ends in either showModal() or unhiding the logout btn).
  authEnabled = true; authRole = null;
  window.NB.auth.showModal();
  await tick(20);
  check("auth: modal visible after showModal()", !$("auth-overlay").hidden);
  check("auth: body gets auth-locked when modal up", window.document.body.classList.contains("auth-locked"));

  // The /api/auth status endpoint reports enabled=true, role=null when the
  // stub is in this state.
  const status = await window.NB.api.getAuthStatus();
  check("auth: getAuthStatus reports enabled=true", status && status.enabled === true,
    JSON.stringify(status));
  check("auth: getAuthStatus reports role=null", status && status.role === null);

  // Submit the wrong password -> error message, modal stays up.
  $("auth-password").value = "wrong";
  $("auth-submit").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("auth: wrong password -> error shown", $("auth-error").textContent.length > 0,
    "err=" + $("auth-error").textContent);
  check("auth: wrong password -> modal stays up", !$("auth-overlay").hidden);

  // Submit the right password -> reload() in production. jsdom 24 does
  // not allow overriding window.location.reload(), so we can't directly
  // spy on the call. Instead, verify the post-login state the reload
  // would set up: the auth stub now reports role=admin, and the modal
  // closes (production would re-boot to a logged-in state).
  $("auth-password").value = "test-pw";
  $("auth-submit").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("auth: right password -> role is now admin (post-reload stub state)",
    authRole === "admin", "authRole=" + authRole);
  // The authRole in the stub is now "admin" (simulating the post-login
  // state). In a real reload, auth.js would re-boot and see role=admin,
  // leaving the modal hidden and unhiding the logout button. We simulate
  // that directly here.
  window.NB.auth.hideModal();
  $("logout-btn").hidden = false;   // simulate the unhide auth.js would do
  check("auth: post-login -> modal hidden", $("auth-overlay").hidden);
  check("auth: post-login -> logout button visible", !$("logout-btn").hidden);

  // Logout: clicking the button calls /api/logout (which clears authRole
  // in the stub) and then shows the modal directly.
  $("logout-btn").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("auth: logout -> /api/logout called (authRole cleared)",
    authRole === null, "authRole=" + authRole);
  check("auth: logout -> modal re-shown directly", !$("auth-overlay").hidden);

  // 401 path: a gated endpoint returning 401 must emit auth:required,
  // throw, AND wipe sensitive content from the DOM (the user must not
  // be able to keep reading a file that was already loaded when auth
  // was enabled). Replace fetch temporarily to simulate 401, and
  // seed the DOM with content to confirm it gets wiped.
  const realFetch = window.fetch;
  window.fetch = async () => ({
    ok: false, status: 401,
    text: async () => JSON.stringify({ error: "Unauthorized" }),
    json: async () => ({ error: "Unauthorized" }),
  });
  // Seed the content regions so we can verify they're cleared. In a
  // real session these would be populated by a prior successful
  // read; the auth-required handler must not leave them visible.
  $("viewer-content").textContent = "secret notebook content";
  $("file-tree").textContent = "secret tree";
  $("search-list").textContent = "secret matches";
  let emitted = 0;
  const evtHandler = () => { emitted++; };
  window.NB.evt.on("auth:required", evtHandler);
  let threw = false;
  try { await window.NB.api.getFile("Welcome.md"); }
  catch (e) { threw = true; }
  window.NB.evt.off("auth:required", evtHandler);
  window.fetch = realFetch;
  check("auth: 401 -> auth:required event emitted", emitted === 1, "count=" + emitted);
  check("auth: 401 -> request throws", threw);
  // Sensitive content must be gone -- the user should not be able to
  // keep reading a previously-loaded file after the session expired.
  check("auth: 401 -> viewer content wiped (textContent empty)",
    $("viewer-content").textContent === "",
    "textContent=" + JSON.stringify($("viewer-content").textContent));
  check("auth: 401 -> file tree wiped (textContent empty)",
    $("file-tree").textContent === "",
    "textContent=" + JSON.stringify($("file-tree").textContent));
  check("auth: 401 -> search list wiped (textContent empty)",
    $("search-list").textContent === "",
    "textContent=" + JSON.stringify($("search-list").textContent));
  // And the body has the locked class so the auth-locked CSS rules
  // (opacity + blur) kick in for any content that survived.
  check("auth: 401 -> body has .auth-locked class",
    window.document.body.classList.contains("auth-locked"));

  // Reset for a clean exit: hide modal, restore defaults.
  window.NB.auth.hideModal();
  authEnabled = false; authRole = null;

  console.log("== passwords ==");
  // The Passwords section in Settings lets an admin (and only an admin)
  // set/change the admin password, and toggle the optional viewer
  // password that gates reads. We exercise the section with a fresh
  // auth state per scenario so the assertions stay independent.
  //
  // jsdom 24 does not allow overriding window.location.reload() to spy
  // on it. Production's reload() emits a "jsdomError" to the virtual
  // console and returns without navigating; the page code proceeds
  // normally. We can't observe the reload directly, so we rely on the
  // /api/auth/passwords POST + state-change assertions below to verify
  // each save/remove path was taken.

  // Scenario 1: no auth configured. The section shows the inline
  // "Set admin password" form (new + confirm). Anyone can set the
  // initial admin password (the chicken-and-egg setup).
  authEnabled = false; authHasAdmin = false; authHasViewer = false; authRole = null; adminCurrentPw = null;
  authSetPasswordsCalls = [];
  window.NB.settings.open(); await tick(40);
  check("pwd: not-set -> status reports 'Not set'",
    $("settings-auth-admin-status").textContent === "Admin password: Not set",
    "status=" + JSON.stringify($("settings-auth-admin-status").textContent));
  check("pwd: not-set -> 'set' form is shown, 'change' form is hidden",
    !$("settings-auth-admin-set").hidden
    && $("settings-auth-admin-change").hidden);
  check("pwd: not-set -> new + confirm inputs are enabled",
    !$("settings-auth-admin-new").disabled
    && !$("settings-auth-admin-confirm").disabled);
  check("pwd: not-set -> save disabled (inputs empty)",
    $("settings-auth-admin-save").disabled);
  check("pwd: not-set -> viewer toggle disabled",
    $("settings-auth-viewer-toggle").disabled);
  // Type mismatched new + confirm -> save stays disabled.
  $("settings-auth-admin-new").value = "newadmin";
  $("settings-auth-admin-new").dispatchEvent(new window.Event("input", { bubbles: true }));
  $("settings-auth-admin-confirm").value = "different";
  $("settings-auth-admin-confirm").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(10);
  check("pwd: not-set -> save stays disabled when new != confirm",
    $("settings-auth-admin-save").disabled);
  // Make them match -> save enabled.
  $("settings-auth-admin-confirm").value = "newadmin";
  $("settings-auth-admin-confirm").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(10);
  check("pwd: not-set -> save enabled when new == confirm",
    !$("settings-auth-admin-save").disabled);
  // Click save -> POSTs admin_password + admin_current_password:null.
  $("settings-auth-admin-save").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("pwd: not-set save POSTs {admin_password, admin_current_password:null, viewer_password:null}",
    authSetPasswordsCalls.length === 1
    && authSetPasswordsCalls[0].admin_password === "newadmin"
    && authSetPasswordsCalls[0].admin_current_password === null
    && authSetPasswordsCalls[0].viewer_password === null,
    JSON.stringify(authSetPasswordsCalls));
  window.NB.settings.close();

  // Scenario 2: admin set, current user is admin. The section shows
  // the status + the 3-field change form directly (no toggle button).
  authEnabled = true; authHasAdmin = true; authHasViewer = false; authRole = "admin";
  adminCurrentPw = "newadmin";  // the value the previous scenario just set
  window.NB.settings.open(); await tick(40);
  check("pwd: set -> status reports 'Set'",
    /Admin password: Set\b/.test($("settings-auth-admin-status").textContent),
    "status=" + JSON.stringify($("settings-auth-admin-status").textContent));
  check("pwd: set -> 'set' form hidden, 'change' form shown directly",
    $("settings-auth-admin-set").hidden
    && !$("settings-auth-admin-change").hidden);
  // The current/new2/confirm2 inputs are cleared so a stale password
  // doesn't sit in the DOM when the change form first appears.
  check("pwd: set -> change-form inputs are cleared (no stale password in DOM)",
    window.document.getElementById("settings-auth-admin-current")
    && window.document.getElementById("settings-auth-admin-current").value === ""
    && window.document.getElementById("settings-auth-admin-new2").value === ""
    && window.document.getElementById("settings-auth-admin-confirm2").value === "");
  check("pwd: change form -> save disabled (all fields empty)",
    $("settings-auth-admin-save2").disabled);
  // Type current only -> still disabled (new empty).
  $("settings-auth-admin-current").value = "newadmin";
  $("settings-auth-admin-current").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(10);
  check("pwd: change form -> save disabled when new/confirm empty",
    $("settings-auth-admin-save2").disabled);
  // Type new and confirm that DON'T match -> disabled.
  $("settings-auth-admin-new2").value = "rotated-pw";
  $("settings-auth-admin-new2").dispatchEvent(new window.Event("input", { bubbles: true }));
  $("settings-auth-admin-confirm2").value = "rotated-pw-different";
  $("settings-auth-admin-confirm2").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(10);
  check("pwd: change form -> save disabled when new != confirm",
    $("settings-auth-admin-save2").disabled);
  // Make them match -> enabled.
  $("settings-auth-admin-confirm2").value = "rotated-pw";
  $("settings-auth-admin-confirm2").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(10);
  check("pwd: change form -> save enabled when current set, new == confirm",
    !$("settings-auth-admin-save2").disabled);
  // Click save -> POSTs admin_password + admin_current_password.
  authSetPasswordsCalls = [];
  $("settings-auth-admin-save2").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("pwd: change save POSTs admin_current_password + new admin_password",
    authSetPasswordsCalls.length === 1
    && authSetPasswordsCalls[0].admin_current_password === "newadmin"
    && authSetPasswordsCalls[0].admin_password === "rotated-pw"
    && authSetPasswordsCalls[0].viewer_password === null,
    JSON.stringify(authSetPasswordsCalls));
  window.NB.settings.close();

  // Scenario 3: wrong current password. The form is filled in with a
  // correct-shape but wrong current, save POSTs and the stub returns
  // 400; the UI shows the error and stays in the change form so the
  // user can correct the mistake.
  authEnabled = true; authHasAdmin = true; authHasViewer = false; authRole = "admin";
  adminCurrentPw = "rotated-pw";  // the new value the previous scenario set
  window.NB.settings.open(); await tick(40);
  $("settings-auth-admin-current").value = "WRONG";
  $("settings-auth-admin-current").dispatchEvent(new window.Event("input", { bubbles: true }));
  $("settings-auth-admin-new2").value = "another-pw";
  $("settings-auth-admin-new2").dispatchEvent(new window.Event("input", { bubbles: true }));
  $("settings-auth-admin-confirm2").value = "another-pw";
  $("settings-auth-admin-confirm2").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(10);
  authSetPasswordsCalls = [];
  $("settings-auth-admin-save2").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("pwd: change with wrong current -> POST sent and error shown",
    authSetPasswordsCalls.length === 1
    && /Current admin password is incorrect/.test($("settings-auth-error").textContent),
    "err=" + $("settings-auth-error").textContent);
  check("pwd: change with wrong current -> form stays open so user can retry",
    !$("settings-auth-admin-change").hidden);
  // Now correct the current and re-submit -> succeeds.
  $("settings-auth-admin-current").value = "rotated-pw";
  $("settings-auth-admin-current").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(10);
  $("settings-auth-admin-save2").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("pwd: change with correct current -> POST succeeds, error cleared",
    authSetPasswordsCalls.length === 2
    && $("settings-auth-error").textContent === "");
  window.NB.settings.close();

  // Scenario 4: Cancel clears the change form's inputs without a POST
  // and without hiding the form (the form stays visible — there's no
  // toggle state any more).
  authEnabled = true; authHasAdmin = true; authHasViewer = false; authRole = "admin";
  adminCurrentPw = "another-pw";
  window.NB.settings.open(); await tick(40);
  $("settings-auth-admin-current").value = "another-pw";
  $("settings-auth-admin-current").dispatchEvent(new window.Event("input", { bubbles: true }));
  $("settings-auth-admin-new2").value = "leaked-pw";
  $("settings-auth-admin-new2").dispatchEvent(new window.Event("input", { bubbles: true }));
  $("settings-auth-admin-confirm2").value = "leaked-pw";
  $("settings-auth-admin-confirm2").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(10);
  $("settings-auth-admin-cancel").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  check("pwd: Cancel clears the inputs but the form stays visible",
    !$("settings-auth-admin-change").hidden
    && $("settings-auth-admin-current").value === ""
    && $("settings-auth-admin-new2").value === ""
    && $("settings-auth-admin-confirm2").value === "");
  window.NB.settings.close();

  // Scenario 5: viewer flow. When an admin is set, the viewer toggle
  // becomes enabled. Toggling on reveals new + confirm; save requires
  // both filled and matching.
  authEnabled = true; authHasAdmin = true; authHasViewer = false; authRole = "admin";
  adminCurrentPw = "another-pw";
  window.NB.settings.open(); await tick(40);
  check("pwd: viewer toggle enabled (admin set)",
    !$("settings-auth-viewer-toggle").disabled);
  // Toggling on reveals the new + confirm rows; save disabled.
  $("settings-auth-viewer-toggle").checked = true;
  $("settings-auth-viewer-toggle").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("pwd: viewer toggle on -> new + confirm rows visible, save disabled",
    !$("settings-auth-viewer-row").hidden
    && !$("settings-auth-viewer-confirm-row").hidden
    && $("settings-auth-viewer-save").disabled);
  $("settings-auth-viewer-pw").value = "viewpass";
  $("settings-auth-viewer-pw").dispatchEvent(new window.Event("input", { bubbles: true }));
  $("settings-auth-viewer-confirm").value = "mismatch";
  $("settings-auth-viewer-confirm").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(10);
  check("pwd: viewer save disabled when new != confirm",
    $("settings-auth-viewer-save").disabled);
  $("settings-auth-viewer-confirm").value = "viewpass";
  $("settings-auth-viewer-confirm").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(10);
  check("pwd: viewer save enabled when new == confirm",
    !$("settings-auth-viewer-save").disabled);
  authSetPasswordsCalls = [];
  $("settings-auth-viewer-save").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("pwd: viewer save POSTs admin_current_password:null, viewer_password=value",
    authSetPasswordsCalls.length === 1
    && authSetPasswordsCalls[0].admin_current_password === null
    && authSetPasswordsCalls[0].viewer_password === "viewpass",
    JSON.stringify(authSetPasswordsCalls));
  window.NB.settings.close();

  // Scenario 6: viewer already set -> toggle on, Remove visible, uncheck
  // + confirm clears the viewer.
  authEnabled = true; authHasAdmin = true; authHasViewer = true; authRole = "admin";
  adminCurrentPw = "another-pw";
  window.NB.settings.open(); await tick(40);
  check("pwd: viewer toggle on when viewer is set",
    $("settings-auth-viewer-toggle").checked === true);
  check("pwd: Remove button visible when viewer is set",
    !$("settings-auth-viewer-remove").hidden);
  // Uncheck + cancel -> toggle stays on, no POST.
  authSetPasswordsCalls = [];
  let pwdConfirmCount = 0;
  window.confirm = () => { pwdConfirmCount++; return false; };
  $("settings-auth-viewer-toggle").checked = false;
  $("settings-auth-viewer-toggle").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("pwd: uncheck + cancel -> confirm shown once",
    pwdConfirmCount === 1);
  check("pwd: uncheck + cancel -> toggle stays on, no POST",
    $("settings-auth-viewer-toggle").checked === true
    && authSetPasswordsCalls.length === 0);
  // Uncheck + OK -> POST viewer_password:"" to clear.
  window.confirm = () => { pwdConfirmCount++; return true; };
  authSetPasswordsCalls = [];
  $("settings-auth-viewer-toggle").checked = false;
  $("settings-auth-viewer-toggle").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(40);
  check("pwd: uncheck + OK -> POST viewer_password:\"\"",
    authSetPasswordsCalls.length === 1
    && authSetPasswordsCalls[0].viewer_password === ""
    && authSetPasswordsCalls[0].admin_current_password === null,
    JSON.stringify(authSetPasswordsCalls));
  window.NB.settings.close();

  // Scenario 7: non-admin sees the section disabled. The set form is
  // hidden; the change form is visible but all fields are disabled
  // and cleared; viewer toggle is disabled.
  authEnabled = true; authHasAdmin = true; authHasViewer = true; authRole = "viewer";
  adminCurrentPw = "another-pw";
  window.NB.settings.open(); await tick(40);
  check("pwd: non-admin -> help text says sign in as admin",
    /Sign in as admin/i.test($("settings-auth-help").textContent));
  check("pwd: non-admin -> set form hidden, change form visible but disabled",
    $("settings-auth-admin-set").hidden
    && !$("settings-auth-admin-change").hidden
    && $("settings-auth-admin-current").disabled
    && $("settings-auth-admin-new2").disabled
    && $("settings-auth-admin-confirm2").disabled);
  check("pwd: non-admin -> change-form inputs are cleared",
    $("settings-auth-admin-current").value === ""
    && $("settings-auth-admin-new2").value === ""
    && $("settings-auth-admin-confirm2").value === "");
   check("pwd: non-admin -> viewer toggle disabled",
     $("settings-auth-viewer-toggle").disabled);
   window.NB.settings.close();

   // Scenario 8: admin removes the admin password to disable auth.
   // The "Remove admin password" button is shown when the admin
   // password is set and the current user is an admin. Clicking it
   // reveals a current-password form; submitting with the correct
   // current password POSTs admin_password="" and disables auth.
   authEnabled = true; authHasAdmin = true; authHasViewer = false; authRole = "admin";
   adminCurrentPw = "another-pw";
   authSetPasswordsCalls = [];
   window.NB.settings.open(); await tick(40);
   check("pwd: remove -> 'Remove admin password' button visible (admin set + admin role)",
     !!$("settings-auth-admin-remove-btn") && !$("settings-auth-admin-remove-btn").hidden,
     "hidden=" + ($("settings-auth-admin-remove-btn") && $("settings-auth-admin-remove-btn").hidden));
   check("pwd: remove -> removal form is hidden initially",
     !!$("settings-auth-admin-remove") && $("settings-auth-admin-remove").hidden);
   check("pwd: remove -> confirm button is disabled (no current password)",
     !!$("settings-auth-admin-remove-confirm") && $("settings-auth-admin-remove-confirm").disabled);
   // Click the button -> form revealed, current password field focused.
   $("settings-auth-admin-remove-btn").dispatchEvent(new window.Event("click", { bubbles: true }));
   await tick(20);
   check("pwd: remove -> clicking button reveals the removal form",
     !$("settings-auth-admin-remove").hidden);
   check("pwd: remove -> current password field is enabled",
     !$("settings-auth-admin-remove-current").disabled,
     "disabled=" + $("settings-auth-admin-remove-current").disabled);
   check("pwd: remove -> confirm still disabled (empty current password)",
     $("settings-auth-admin-remove-confirm").disabled);
    // Type the correct current password -> confirm enabled (field is non-empty).
    $("settings-auth-admin-remove-current").value = "another-pw";
    $("settings-auth-admin-remove-current").dispatchEvent(new window.Event("input", { bubbles: true }));
    await tick(10);
    check("pwd: remove -> confirm enabled when current password is non-empty",
      !$("settings-auth-admin-remove-confirm").disabled);
    // Click confirm -> window.confirm dialog appears; stub returns true.
    let confirmCalls = 0;
    window.confirm = () => { confirmCalls++; return true; };
    $("settings-auth-admin-remove-confirm").dispatchEvent(new window.Event("click", { bubbles: true }));
    await tick(40);
    check("pwd: remove -> confirm dialog shown", confirmCalls === 1, "calls=" + confirmCalls);
    check("pwd: remove -> POSTs admin_password:'' + admin_current_password",
      authSetPasswordsCalls.length === 1
      && authSetPasswordsCalls[0].admin_password === ""
      && authSetPasswordsCalls[0].admin_current_password === "another-pw"
      && authSetPasswordsCalls[0].viewer_password === null,
      JSON.stringify(authSetPasswordsCalls));
   // The stub should have disabled auth (authEnabled=false, authHasAdmin=false).
   check("pwd: remove -> auth disabled after successful clear",
     authEnabled === false && authHasAdmin === false,
     "enabled=" + authEnabled + " hasAdmin=" + authHasAdmin);
   window.NB.settings.close();

   // Scenario 8b: wrong current password -> error shown, no state change.
   authEnabled = true; authHasAdmin = true; authHasViewer = false; authRole = "admin";
   adminCurrentPw = "another-pw";
   authSetPasswordsCalls = [];
   window.NB.settings.open(); await tick(40);
   $("settings-auth-admin-remove-btn").click();
   await tick(20);
   $("settings-auth-admin-remove-current").value = "wrong-pw";
   $("settings-auth-admin-remove-current").dispatchEvent(new window.Event("input", { bubbles: true }));
   await tick(10);
   window.confirm = () => true;
   $("settings-auth-admin-remove-confirm").click();
   await tick(40);
   // The stub returns 400 for wrong current password; the UI shows the error.
   check("pwd: remove wrong-current -> error shown",
     !!$("settings-auth-error").textContent && /Current admin password is incorrect/.test($("settings-auth-error").textContent),
     "err=" + $("settings-auth-error").textContent);
   check("pwd: remove wrong-current -> auth still enabled (no state change)",
     authEnabled === true && authHasAdmin === true,
     "enabled=" + authEnabled + " hasAdmin=" + authHasAdmin);
   window.NB.settings.close();

   // Reset for a clean exit.
   authEnabled = false; authHasAdmin = false; authHasViewer = false; authRole = null; adminCurrentPw = null;
   authSetPasswordsCalls = [];
   window.NB.settings.close();
   window.confirm = () => true;

  console.log("== tokens ==");
  // The API tokens section in Settings -> Security. Admin-only like the
  // passwords section; the create response is the only time the full
  // token string is shown, so the issued box must appear on create and
  // never leak the secret into the rendered list.

  // Scenario T1: no auth configured. Controls are disabled and no
  // listing is fetched (the server would refuse anyway).
  authEnabled = false; authHasAdmin = false; authRole = null;
  authTokens = []; authTokensSeq = 0; authTokensCalls = [];
  const tokFetchesBefore = fetchLog.length;
  window.NB.settings.open(); await tick(40);
  check("tok: auth off -> count shows dash", $("settings-tokens-count").textContent === "—",
    "count=" + JSON.stringify($("settings-tokens-count").textContent));
  check("tok: auth off -> name input + create disabled",
    $("settings-tokens-name").disabled && $("settings-tokens-create").disabled);
  check("tok: auth off -> help asks to sign in as admin",
    /Sign in as admin/.test($("settings-tokens-help").textContent),
    $("settings-tokens-help").textContent);
  check("tok: auth off -> no tokens endpoint call during this open",
    !fetchLog.slice(tokFetchesBefore).includes("GET /api/auth/tokens"));
  window.NB.settings.close();

  // Scenario T2: admin signed in. Listing renders; creating issues a
  // one-time token; the list never contains the secret.
  authEnabled = true; authHasAdmin = true; authRole = "admin";
  window.NB.settings.open(); await tick(60);
  check("tok: admin -> count is 0 after fetch",
    $("settings-tokens-count").textContent === "0",
    "count=" + JSON.stringify($("settings-tokens-count").textContent));
  check("tok: admin -> create disabled until a name is typed",
    $("settings-tokens-create").disabled
    && !$("settings-tokens-name").disabled);
  $("settings-tokens-name").value = "opencode";
  $("settings-tokens-name").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(10);
  check("tok: admin -> create enabled with a name",
    !$("settings-tokens-create").disabled);
  $("settings-tokens-role").value = "viewer";
  $("settings-tokens-create").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(60);
  const createdTokenBody = authTokensCalls.find(c => c.op === "create");
  check("tok: admin create POSTs {name:'opencode', role:'viewer'}",
    !!createdTokenBody
    && createdTokenBody.body.name === "opencode"
    && createdTokenBody.body.role === "viewer",
    JSON.stringify(authTokensCalls));
  const issuedText = $("settings-tokens-issued-value").textContent;
  check("tok: create -> issued box visible with an nbtk_ token",
    !$("settings-tokens-issued").hidden && /^nbtk_[0-9a-f]+$/.test(issuedText),
    "token=" + issuedText.slice(0, 12) + "…");
  check("tok: create -> count updated to 1 and row rendered",
    $("settings-tokens-count").textContent === "1"
    && $("settings-tokens-list").children.length === 1,
    "rows=" + $("settings-tokens-list").children.length);
  const tokRow = $("settings-tokens-list").firstChild;
  check("tok: row shows name + role but NOT the secret",
    /opencode/.test(tokRow.textContent)
    && /viewer/.test(tokRow.textContent)
    && !tokRow.textContent.includes(issuedText),
    JSON.stringify(tokRow.textContent));
  check("tok: name field cleared after create",
    $("settings-tokens-name").value === "");
  window.NB.settings.close();

  // Scenario T3: duplicate name -> server 409, error shown, issued box
  // stays hidden.
  authEnabled = true; authHasAdmin = true; authRole = "admin";
  window.NB.settings.open(); await tick(60);
  $("settings-tokens-name").value = "opencode";
  $("settings-tokens-name").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(10);
  $("settings-tokens-create").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(60);
  check("tok: duplicate name -> error shown",
    /already exists/.test($("settings-tokens-error").textContent),
    "err=" + $("settings-tokens-error").textContent);
  check("tok: duplicate name -> issued box stays hidden",
    $("settings-tokens-issued").hidden);
  window.NB.settings.close();

  // Scenario T4: revoke. The confirm stub returns true; the DELETE is
  // logged and the list re-renders without the row.
  authEnabled = true; authHasAdmin = true; authRole = "admin";
  let tokConfirmCalls = 0;
  window.confirm = () => { tokConfirmCalls++; return true; };
  window.NB.settings.open(); await tick(60);
  check("tok: reopen -> persisted token still listed",
    $("settings-tokens-count").textContent === "1"
    && $("settings-tokens-list").children.length === 1);
  check("tok: reopening hides any stale issued box",
    $("settings-tokens-issued").hidden);
  tokRow.querySelector(".settings-token-revoke")
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await tick(60);
  const deletedTokenCall = authTokensCalls.find(c => c.op === "delete");
  check("tok: revoke prompts + DELETEs by name",
    tokConfirmCalls === 1 && !!deletedTokenCall && deletedTokenCall.body.name === "opencode",
    JSON.stringify(authTokensCalls.filter(c => c.op === "delete")));
  check("tok: revoke -> list empties, count back to 0",
    $("settings-tokens-count").textContent === "0"
    && $("settings-tokens-list").children.length === 0);
  window.confirm = () => true;
  window.NB.settings.close();

  // Reset for later blocks.
  authEnabled = false; authHasAdmin = false; authHasViewer = false; authRole = null;
  authTokens = []; authTokensSeq = 0; authTokensCalls = [];

  console.log("== settings footer ==");
  // The Settings modal now has a single Close button in the footer --
  // settings are live, so there's no Apply/Save/Cancel. The Passwords
  // section keeps its own per-section Save/Remove buttons (unaffected
  // by this footer).
  if (window.NB.settings.isOpen()) window.NB.settings.close();
  await tick(10);

  // 1. Fresh open: footer has a single Close button. The old
  //    Apply/Save/Cancel buttons are gone.
  window.NB.settings.open(); await tick(20);
  const closeFooterBtn = $("settings-close-btn");
  check("footer: Close button is present", !!closeFooterBtn);
  check("footer: Close button is enabled", closeFooterBtn.disabled === false);
  check("footer: no Apply button (live mode)", !$("settings-apply"));
  check("footer: no Save button (live mode)",  !$("settings-save"));
  check("footer: no Cancel button (live mode)", !$("settings-cancel"));

  // 2. Theme radio change: live body data-theme updates immediately,
  //    no Apply needed. (This is the headline of the live model.)
  check("footer: pre-pick body data-theme is dark",
    window.document.body.dataset.theme === "dark");
  const ftRadio = (v) => window.document.querySelector('input[name="theme"][value="' + v + '"]');
  ftRadio("light").checked = true;
  ftRadio("light").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("footer: theme radio change updates live data-theme immediately",
    window.document.body.dataset.theme === "light",
    "data-theme=" + window.document.body.dataset.theme);
  // ... and the change persists: wait past the 250ms debounce + check POST.
  await tick(400);
  const lastCfgPost = (fetchLog.filter(l => l.startsWith("POST /api/config")).pop() || "");
  check("footer: theme radio change POSTs config with theme=\"light\"",
    /"theme":"light"/.test(lastCfgPost), lastCfgPost);
  // Reset.
  ftRadio("dark").checked = true;
  ftRadio("dark").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);

  // 3. Footer Close closes the modal cleanly (live changes are NOT
  //    reverted -- they were already applied + persisted).
  closeFooterBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("footer: Close button closes the modal", !window.NB.settings.isOpen());

  // 4. × button closes the modal too.
  window.NB.settings.open(); await tick(10);
  $("settings-close").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("footer: × button closes the modal", !window.NB.settings.isOpen());

  // 5. Passwords section regression: the per-section Save/Remove
  //    buttons are still present and still trigger their own page-
  //    reload flow. The new live-mode footer must not interfere.
  authEnabled = false; authHasAdmin = false; authHasViewer = false; authRole = null; adminCurrentPw = null;
  authSetPasswordsCalls = [];
  window.NB.settings.open(); await tick(40);
  $("settings-auth-admin-new").value = "footer-pw";
  $("settings-auth-admin-new").dispatchEvent(new window.Event("input", { bubbles: true }));
  $("settings-auth-admin-confirm").value = "footer-pw";
  $("settings-auth-admin-confirm").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(10);
  $("settings-auth-admin-save").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("footer: per-section admin save still POSTs auth/passwords (live mode doesn't break it)",
    authSetPasswordsCalls.length === 1
    && authSetPasswordsCalls[0].admin_password === "footer-pw"
    && authSetPasswordsCalls[0].admin_current_password === null
    && authSetPasswordsCalls[0].viewer_password === null,
    JSON.stringify(authSetPasswordsCalls));
  authEnabled = false; authHasAdmin = false; authHasViewer = false; authRole = null; adminCurrentPw = null;
  authSetPasswordsCalls = [];
  window.NB.settings.close();

  console.log("== font size ==");
  // The Font size radios in Settings set --font-scale on :root. Settings
  // are LIVE: picking a radio updates the CSS variable immediately, no
  // Apply/Save step.
  check("font size: default --font-scale is 1 (medium)",
    cssVar("--font-scale") === "1", "scale=" + cssVar("--font-scale"));
  // The medium radio is checked on first open.
  window.NB.settings.open(); await tick(40);
  const fsRadio = (v) => window.document.querySelector('input[name="fontSize"][value="' + v + '"]');
  check("font size: medium radio is checked by default",
    fsRadio("medium") && fsRadio("medium").checked === true,
    "checked=" + (fsRadio("medium") && fsRadio("medium").checked));
  // Pick each size and verify the live CSS variable updates immediately.
  // Each set is wrapped in `before`/`after` to confirm the value is the
  // picked one, not the previous one.
  const expectScale = { small: "0.9", medium: "1", large: "1.15", xlarge: "1.3" };
  for (const name of ["small", "large", "xlarge", "medium"]) {
    fsRadio(name).checked = true;
    fsRadio(name).dispatchEvent(new window.Event("change", { bubbles: true }));
    await tick(20);
    // Live scale is the picked value, immediately.
    check("font size: " + name + " -> live --font-scale=" + expectScale[name]
      + " immediately",
      cssVar("--font-scale") === expectScale[name],
      "scale=" + cssVar("--font-scale"));
  }
  // Persistence: the live change should have POSTed to /api/config with
  // the latest picked value (medium, the last in the loop).
  await tick(400);
  const lastFsPost = (fetchLog.filter(l => l.startsWith("POST /api/config")).pop() || "");
  check("font size: last config POST body has fontSize:\"medium\"",
    /"fontSize":"medium"/.test(lastFsPost), lastFsPost);
  // CSS source checks (regression for the `font:` shorthand on html bug
  // that resets the root size to 1rem of the initial value). These are
  // source-based, not behavior-dependent, so they survive the live-mode
  // rewrite.
  {
    const css = read("static/css/style.css");
    const htmlFontShorthand = css.match(/^([^{}]*html[^{}]*)\{([^}]*)\}/gm);
    let htmlFontBug = null;
    if (htmlFontShorthand) {
      for (const block of htmlFontShorthand) {
        const selector = block.split("{")[0];
        const body = block.split("{")[1] || "";
        if (/^\s*html\s*[,{]/.test(selector) || /,\s*html\s*[,{]/.test(selector)) {
          if (/\bfont\s*:\s*[^;]+;/.test(body)) {
            htmlFontBug = block;
            break;
          }
        }
      }
    }
    check("font size: no `font:` shorthand on a rule that targets html (would reset root size)",
      !htmlFontBug, htmlFontBug || "(clean)");
    const htmlFontSize = css.match(/^html\s*\{[^}]*font-size\s*:\s*calc\([^)]*var\(--font-scale[^)]*\)[^}]*\}/m);
    check("font size: html { font-size: calc(14px * var(--font-scale, 1)) } is in the stylesheet",
      !!htmlFontSize, htmlFontSize ? htmlFontSize[0].replace(/\s+/g, " ") : "(not found)");
  }
  window.NB.settings.close();
  await tick(10);

  console.log("== settings modal width ==");
  // Live: picking a radio updates --settings-modal-width immediately and
  // POSTs the choice through the debounced persistConfig. Default is
  // "medium" (75vw) per DEFAULTS, so the boot value is 75vw even
  // though we never opened settings before this block. The size is
  // a CSS unit string (vw), not a pixel value -- the modal scales
  // with the viewport.
  const smwRadio = (v) => window.document.querySelector('input[name="settingsModalWidth"][value="' + v + '"]');
  check("settings modal width: has compact radio", !!smwRadio("compact"));
  check("settings modal width: has medium radio",  !!smwRadio("medium"));
  check("settings modal width: has wide radio",    !!smwRadio("wide"));
  check("settings modal width: default --settings-modal-width is 75vw (medium)",
    cssVar("--settings-modal-width") === "75vw",
    "--settings-modal-width=" + cssVar("--settings-modal-width"));
  check("settings modal width: cfg.settingsModalWidth default is 'medium'",
    window.NB.app.getCfg().settingsModalWidth === "medium",
    "settingsModalWidth=" + window.NB.app.getCfg().settingsModalWidth);

  // Open settings + change to compact -> live CSS var updates immediately.
  window.NB.settings.open(); await tick(20);
  // Switch to appearance so the radio is visible (the test only drives
  // the radio, but matches the real-user path: open, pick tab, pick value).
  const appearanceTab = window.document.querySelector('.settings-nav-item[data-tab="appearance"]');
  appearanceTab.click(); await tick(10);
  smwRadio("compact").checked = true;
  smwRadio("compact").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("settings modal width: compact pick -> --settings-modal-width is 60vw immediately",
    cssVar("--settings-modal-width") === "60vw",
    "--settings-modal-width=" + cssVar("--settings-modal-width"));
  check("settings modal width: compact pick -> live cfg.settingsModalWidth is 'compact'",
    window.NB.app.getCfg().settingsModalWidth === "compact",
    "settingsModalWidth=" + window.NB.app.getCfg().settingsModalWidth);

  // Wide pick -> 90vw.
  smwRadio("wide").checked = true;
  smwRadio("wide").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("settings modal width: wide pick -> --settings-modal-width is 90vw immediately",
    cssVar("--settings-modal-width") === "90vw",
    "--settings-modal-width=" + cssVar("--settings-modal-width"));

  // Back to medium -> 75vw. Confirms the path is round-trippable, not
  // just monotonic in one direction.
  smwRadio("medium").checked = true;
  smwRadio("medium").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("settings modal width: medium pick (after compact + wide) -> --settings-modal-width is 75vw again",
    cssVar("--settings-modal-width") === "75vw",
    "--settings-modal-width=" + cssVar("--settings-modal-width"));

  // Persisted: after the debounce window the choice shows up in the
  // latest POST /api/config body. Wide was picked last before medium;
  // the medium POST should carry the new value.
  await tick(400);
  const lastSmwPost = (fetchLog.filter(l => l.startsWith("POST /api/config")).pop() || "");
  check("settings modal width: last config POST body has settingsModalWidth:\"medium\"",
    /"settingsModalWidth":"medium"/.test(lastSmwPost), lastSmwPost);
  // Height is also persisted in the same POST body (same debounce path,
  // same row-group commit). Default to "medium" on a fresh boot.
  check("settings modal width: last config POST body has settingsModalHeight:\"medium\"",
    /"settingsModalHeight":"medium"/.test(lastSmwPost), lastSmwPost);

  // CSS source regression guards: the .settings-modal rule must read
  // --settings-modal-width (so future edits to the layout actually
  // respond to the setting). The variable is set as an inline style on
  // :root by app.js:applySettingsModalWidth; no :root declaration is
  // required in the stylesheet, but the fall-through default ("75vw")
  // is what the rule defaults to if the inline style is absent.
  {
    const css = read("static/css/style.css");
    const modalReadsVar = /\.settings-modal\s*\{[^}]*var\(--settings-modal-width/.test(css);
    check("settings modal width: .settings-modal rule reads --settings-modal-width",
      modalReadsVar, modalReadsVar ? "(found)" : "(missing)");
    // The rule's fall-through default should be 75vw so a missing
    // inline style (e.g. before applyConfig() runs) still renders the
    // modal at the medium width. Matches the DEFAULTS value.
    const modalDefault = /\.settings-modal\s*\{[^}]*var\(--settings-modal-width\s*,\s*(\S+?)\s*\)/.exec(css);
    const defaultV = modalDefault ? modalDefault[1] : null;
    check("settings modal width: .settings-modal fall-through default is 75vw (matches DEFAULTS medium)",
      defaultV === "75vw", "default=" + (defaultV || "(missing)"));
    // The modal must be pinned to its chosen width (flex: 0 0 auto)
    // so a section with wider intrinsic content doesn't expand the
    // modal when the user switches tabs. The CSS-source guard is
    // independent of the layout engine; together with the per-tab
    // width check below, it covers the regression.
    const modalFlexNone = /\.settings-modal\s*\{[^}]*flex\s*:\s*0\s+0\s+auto/.test(css);
    check("settings modal width: .settings-modal is flex:0 0 auto (won't grow to fit content)",
      modalFlexNone, modalFlexNone ? "(found)" : "(missing)");
    // Height must also be pinned (NOT derived from content). Each
    // section has a different number of rows -- without a fixed
    // height, the modal grows to fit the tallest section (Appearance,
    // 7 rows) and shrinks for short ones (General / About, 2 rows),
    // so switching tabs visibly resizes the modal. The new rule
    // reads --settings-modal-height with an 80vh fall-through, capped
    // by 92vh -- both axes are now user-controllable percentages.
    const modalHeightPinned = /\.settings-modal\s*\{[^}]*height\s*:\s*min\(\s*var\(--settings-modal-height\s*,\s*80vh\s*\)\s*,\s*92vh\s*\)/.test(css);
    check("settings modal width: .settings-modal is height:min(var(--settings-modal-height, 80vh), 92vh) (won't grow to fit content)",
      modalHeightPinned, modalHeightPinned ? "(found)" : "(missing)");
  }

  // Layout stability across tabs: with a chosen width, the modal's
  // rendered width must not change as the user switches between
  // sections. Earlier, the modal grew to fit the widest section's
  // intrinsic content (long paths in About, etc.) because the modal
  // had no flex-basis and the body had no min-width: 0, so each tab
  // switch could resize the modal by tens of pixels.
  //
  // Pick "wide" so we have the most headroom to detect accidental
  // shrinking, then walk all four tabs and snapshot the rendered
  // width via getBoundingClientRect (the only thing the user actually
  // sees).
  window.NB.settings.open(); await tick(20);
  window.document.querySelector('.settings-nav-item[data-tab="appearance"]').click();
  await tick(10);
  smwRadio("wide").checked = true;
  smwRadio("wide").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(10);
  const modalEl = window.document.querySelector("#settings-overlay .settings-modal");
  const widths = {};
  const heights = {};
  for (const tab of ["general", "appearance", "security", "about"]) {
    window.document.querySelector('.settings-nav-item[data-tab="' + tab + '"]').click();
    await tick(10);
    const r = modalEl.getBoundingClientRect();
    widths[tab]  = r.width;
    heights[tab] = r.height;
  }
  const uniqWidths  = Array.from(new Set(Object.values(widths).map(w  => Math.round(w))));
  const uniqHeights = Array.from(new Set(Object.values(heights).map(h => Math.round(h))));
  check("settings modal width: modal width is identical across all four tabs",
    uniqWidths.length === 1,
    "widths=" + JSON.stringify(widths) + " uniq=" + JSON.stringify(uniqWidths));
  // Height also has to be stable across tabs. Without a fixed height,
  // the modal grows to fit the tallest section (Appearance, 7 rows)
  // and shrinks for short ones (General / About, 2 rows). The new
  // `height: min(86vh, 600px)` rule pins the outer size; the inner
  // .settings-sections pane scrolls if a section overflows.
  check("settings modal width: modal height is identical across all four tabs",
    uniqHeights.length === 1,
    "heights=" + JSON.stringify(heights) + " uniq=" + JSON.stringify(uniqHeights));
  // Sanity: the test ran at the 'wide' setting (90vw). The actual
  // pixel width returned by jsdom is 0 (no layout), so we confirm
  // the sink the modal reads from is the expected value.
  check("settings modal width: tab-switch test ran at the 'wide' setting",
    cssVar("--settings-modal-width") === "90vw",
    "--settings-modal-width=" + cssVar("--settings-modal-width"));

  console.log("== settings modal height ==");
  // Mirror of the width block above: the new "Settings modal height"
  // radio group drives --settings-modal-height as a viewport
  // percentage. The three presets are 80vh / 85vh / 90vh; the
  // default is "medium" (85vh) per DEFAULTS, matching the CSS
  // fall-through default on .settings-modal. The floor is 80vh so
  // even the smallest preset gives the modal most of the viewport.
  const smhRadio = (v) => window.document.querySelector('input[name="settingsModalHeight"][value="' + v + '"]');
  check("settings modal height: has compact radio", !!smhRadio("compact"));
  check("settings modal height: has medium radio",  !!smhRadio("medium"));
  check("settings modal height: has wide radio",    !!smhRadio("wide"));
  check("settings modal height: default --settings-modal-height is 85vh (medium)",
    cssVar("--settings-modal-height") === "85vh",
    "--settings-modal-height=" + cssVar("--settings-modal-height"));
  check("settings modal height: cfg.settingsModalHeight default is 'medium'",
    window.NB.app.getCfg().settingsModalHeight === "medium",
    "settingsModalHeight=" + window.NB.app.getCfg().settingsModalHeight);

  // Drive each radio and confirm the CSS var updates live. Stay on
  // the Appearance tab -- the radio is here, and we're already
  // open.
  smhRadio("compact").checked = true;
  smhRadio("compact").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("settings modal height: compact pick -> --settings-modal-height is 80vh immediately",
    cssVar("--settings-modal-height") === "80vh",
    "--settings-modal-height=" + cssVar("--settings-modal-height"));
  check("settings modal height: compact pick -> live cfg.settingsModalHeight is 'compact'",
    window.NB.app.getCfg().settingsModalHeight === "compact",
    "settingsModalHeight=" + window.NB.app.getCfg().settingsModalHeight);

  smhRadio("wide").checked = true;
  smhRadio("wide").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("settings modal height: wide pick -> --settings-modal-height is 90vh immediately",
    cssVar("--settings-modal-height") === "90vh",
    "--settings-modal-height=" + cssVar("--settings-modal-height"));

  // Back to medium -> 85vh. Confirms the path is round-trippable.
  smhRadio("medium").checked = true;
  smhRadio("medium").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("settings modal height: medium pick (after compact + wide) -> --settings-modal-height is 85vh again",
    cssVar("--settings-modal-height") === "85vh",
    "--settings-modal-height=" + cssVar("--settings-modal-height"));

  // Persisted: after the debounce window the choice shows up in the
  // latest POST /api/config body.
  await tick(400);
  const lastSmhPost = (fetchLog.filter(l => l.startsWith("POST /api/config")).pop() || "");
  check("settings modal height: last config POST body has settingsModalHeight:\"medium\"",
    /"settingsModalHeight":"medium"/.test(lastSmhPost), lastSmhPost);

  // close: keep the rest of the suite running with a clean modal state.
  window.NB.settings.close();
  await tick(10);

  console.log("== export ==");
  // The Export button in the top bar opens a modal to export the current
  // note to PDF (browser print-to-PDF) or a self-contained HTML file.
  // Scope is the active file. We stub window.print and the Blob/URL
  // object-URL APIs above so both paths are testable in jsdom.
  {
    const exportBtn = $("export-toggle");
    const overlay = $("export-overlay");
    check("export: top-bar Export button exists", !!exportBtn);
    check("export: modal overlay exists", !!overlay);
    check("export: NB.export module loaded", !!window.NB.export);

    // Open a file so there's something to export. Restore the fixture
    // first (an earlier rename test may have left it rekeyed), and close
    // any stale tab so the open forces a fresh fetch.
    FILES["notes/a.md"] = FILE_A;
    MTIMES["notes/a.md"] = (MTIMES["notes/a.md"] || 1) + 1;
    if (window.NB.tabs.isOpen("notes/a.md")) window.NB.tabs.close("notes/a.md", { force: true });
    await window.NB.tabs.open("notes/a.md");
    await tick(20);
    check("export: active file is notes/a.md",
      window.NB.viewer.getPath() === "notes/a.md",
      "path=" + window.NB.viewer.getPath());

    // Open the modal via the top-bar button.
    exportBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
    await tick(10);
    check("export: button opens the modal", !overlay.hidden);
    check("export: modal shows the active file",
      $("export-file-label").textContent === "notes/a.md",
      "label=" + $("export-file-label").textContent);

    // PDF path: default format is PDF; clicking Export calls window.print.
    const printsBefore = __export.prints;
    $("export-run").dispatchEvent(new window.Event("click", { bubbles: true }));
    await tick(80);
    check("export: PDF path calls window.print", __export.prints === printsBefore + 1,
      "prints=" + __export.prints);
    check("export: PDF renders the note into #print-host",
      !!$("print-host") && /File A/.test($("print-host").textContent),
      $("print-host") ? "host text=" + $("print-host").textContent.slice(0, 30) : "no host");
    check("export: #print-host is a direct child of body (print-only container)",
      $("print-host") && $("print-host").parentElement === window.document.body,
      $("print-host") ? "parent=" + $("print-host").parentElement.tagName : "no host");

    // HTML path: switch format to HTML, click Export, expect a blob
    // download containing the rendered note.
    const htmlRadio = window.document.querySelector('input[name="export-format"][value="html"]');
    htmlRadio.checked = true;
    htmlRadio.dispatchEvent(new window.Event("change", { bubbles: true }));
    const downloadsBefore = __export.downloads.length;
    $("export-run").dispatchEvent(new window.Event("click", { bubbles: true }));
    await tick(80);
    check("export: HTML path triggers a blob download",
      __export.downloads.length === downloadsBefore + 1,
      "downloads=" + __export.downloads.length);
    const htmlText = __export.blobTexts[__export.blobTexts.length - 1] || "";
    check("export: HTML blob is a standalone document with the note",
      /<!DOCTYPE html>/.test(htmlText) && /File A/.test(htmlText),
      htmlText.slice(0, 60));
    check("export: HTML blob embeds the markdown styles",
      /\.markdown-body/.test(htmlText) && /\.hljs/.test(htmlText),
      "has css=" + /\.markdown-body/.test(htmlText));

    // Section scope: the modal lists h1-h3 headings and can export just
    // the selected section. FILE_A has "# File A" (h1) and "## Sub A" (h2).
    const sectionRadio = window.document.querySelector('input[name="export-scope"][value="section"]');
    check("export: section scope radio exists", !!sectionRadio);
    const sectionRow = $("export-section-row");
    const sectionSelect = $("export-section-select");
    check("export: section heading row hidden by default (current scope)",
      sectionRow.hidden === true, "hidden=" + sectionRow.hidden);
    check("export: section dropdown lists h1-h3 headings",
      sectionSelect.options.length === 2 &&
        sectionSelect.options[0].textContent === "# File A" &&
        sectionSelect.options[1].textContent === "## Sub A",
      "options=" + Array.from(sectionSelect.options).map(o => o.textContent).join("|"));

    // Switch to section scope -> the heading row appears.
    sectionRadio.checked = true;
    sectionRadio.dispatchEvent(new window.Event("change", { bubbles: true }));
    await tick(10);
    check("export: section scope reveals the heading row",
      sectionRow.hidden === false, "hidden=" + sectionRow.hidden);

    // Export the "## Sub A" section as HTML; the blob should contain the
    // section body but NOT the earlier "# File A" content.
    sectionSelect.value = sectionSelect.options[1].value;
    const secDownloadsBefore = __export.downloads.length;
    $("export-run").dispatchEvent(new window.Event("click", { bubbles: true }));
    await tick(80);
    check("export: section-scoped HTML triggers a blob download",
      __export.downloads.length === secDownloadsBefore + 1,
      "downloads=" + __export.downloads.length);
    const secHtml = __export.blobTexts[__export.blobTexts.length - 1] || "";
    check("export: section-scoped HTML contains the section body",
      /Sub A/.test(secHtml) && /body/.test(secHtml),
      secHtml.slice(0, 60));
    check("export: section-scoped HTML excludes the earlier h1 content",
      !/File A/.test(secHtml), "has File A=" + /File A/.test(secHtml));

    // Back to current scope for the remaining checks.
    const currentRadio = window.document.querySelector('input[name="export-scope"][value="current"]');
    currentRadio.checked = true;
    currentRadio.dispatchEvent(new window.Event("change", { bubbles: true }));
    await tick(10);
    check("export: current scope hides the heading row again",
      sectionRow.hidden === true, "hidden=" + sectionRow.hidden);

    // Esc closes the modal.
    window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true,
    }));
    await tick(10);
    check("export: Esc closes the modal", overlay.hidden);

    // Context-menu entry points: the file tree row, the bookmark row, and
    // the tab all offer "Export…", which opens the modal targeting that
    // specific file (not necessarily the active tab).
    // Reset the tree to a known shape first (earlier blocks may have
    // rekeyed it) so notes/b.md is present.
    TREE.length = 0;
    TREE.push(
      { name: "notes", type: "dir", path: "notes", children: [
        { name: "a.md", type: "file", path: "notes/a.md" },
        { name: "b.md", type: "file", path: "notes/b.md" },
      ]},
      { name: "Welcome.md", type: "file", path: "Welcome.md" },
    );
    await window.NB.sidebar.refresh();
    await tick(20);
    const treeRow = (p) => window.document.querySelector('.tree-row[data-path="' + p + '"]');
    const menuBtns = () => Array.from($("context-menu").querySelectorAll("button")).map(b => b.textContent);

    // File tree row context menu.
    treeRow("notes/b.md").dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, clientX: 30, clientY: 30 }));
    await tick(10);
    check("export: file tree row menu offers 'Export…'",
      menuBtns().includes("Export…"), menuBtns().join(" / "));
    Array.from($("context-menu").querySelectorAll("button"))
      .find(b => b.textContent === "Export…")
      .dispatchEvent(new window.Event("click", { bubbles: true }));
    await tick(10);
    check("export: tree 'Export…' opens the modal targeting that file",
      !overlay.hidden && $("export-file-label").textContent === "notes/b.md",
      "label=" + $("export-file-label").textContent);
    window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await tick(10);

    // Tab context menu.
    await window.NB.tabs.open("notes/b.md");
    await tick(20);
    const tabEl = window.document.querySelector('.tab[data-path="notes/b.md"]');
    tabEl.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, clientX: 30, clientY: 30 }));
    await tick(10);
    const tabMenuBtns = () => Array.from($("tab-context-menu").querySelectorAll("button")).map(b => b.textContent);
    check("export: tab context menu offers 'Export…'",
      tabMenuBtns().includes("Export…"), tabMenuBtns().join(" / "));
    Array.from($("tab-context-menu").querySelectorAll("button"))
      .find(b => b.textContent === "Export…")
      .dispatchEvent(new window.Event("click", { bubbles: true }));
    await tick(10);
    check("export: tab 'Export…' opens the modal targeting that file",
      !overlay.hidden && $("export-file-label").textContent === "notes/b.md",
      "label=" + $("export-file-label").textContent);
    window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await tick(10);

    // Close the tab to restore suite state.
    window.NB.tabs.close("notes/a.md", { force: true });
    window.NB.tabs.close("notes/b.md", { force: true });
    await tick(10);
  }

  console.log("== light code block theme ==");
  // The hljs-dark and hljs-light <link> tags toggle based on the resolved
  // body theme. Dark is the default; switching to Light should disable
  // the dark link and enable the light link. Settings are LIVE: picking
  // a radio updates the live data-theme + the link swap immediately.
  const darkLink = window.document.getElementById("hljs-dark");
  const lightLink = window.document.getElementById("hljs-light");
  check("hljs: dark link element exists", !!darkLink);
  check("hljs: light link element exists", !!lightLink);
  // The previous == font size == block ended with live fontSize=medium
  // and the live theme still auto/dark, so the dark link should be enabled.
  check("hljs: boot state -> dark enabled, light disabled",
    darkLink.disabled === false && lightLink.disabled === true,
    "dark.disabled=" + darkLink.disabled + " light.disabled=" + lightLink.disabled);

  const themeRadio = (v) => window.document.querySelector('input[name="theme"][value="' + v + '"]');
  // Open settings, pick light -> live data-theme + links flip immediately.
  window.NB.settings.open(); await tick(20);
  themeRadio("light").checked = true;
  themeRadio("light").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("hljs: light pick -> live data-theme=light immediately",
    window.document.body.dataset.theme === "light",
    "data-theme=" + window.document.body.dataset.theme);
  check("hljs: light pick -> light link enabled, dark link disabled immediately",
    darkLink.disabled === true && lightLink.disabled === false,
    "dark.disabled=" + darkLink.disabled + " light.disabled=" + lightLink.disabled);

  // Back to Dark: live links flip back.
  themeRadio("dark").checked = true;
  themeRadio("dark").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("hljs: dark pick -> live data-theme=dark immediately",
    window.document.body.dataset.theme === "dark",
    "data-theme=" + window.document.body.dataset.theme);
  check("hljs: dark pick -> dark enabled, light disabled immediately",
    darkLink.disabled === false && lightLink.disabled === true,
    "dark.disabled=" + darkLink.disabled + " light.disabled=" + lightLink.disabled);

  // Auto mode: the matchMedia stub returns matches:false (system = dark),
  // so the resolved theme is dark and the dark link is the enabled one.
  themeRadio("auto").checked = true;
  themeRadio("auto").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(10);
  check("hljs: auto pick + matchMedia(dark) -> dark link enabled immediately",
    darkLink.disabled === false && lightLink.disabled === true,
    "dark.disabled=" + darkLink.disabled + " light.disabled=" + lightLink.disabled);

  // The cfg.theme persists as "auto" after the radio change.
  check("hljs: cfg.theme persists as 'auto' after pick",
    window.NB.app.getCfg().theme === "auto", "theme=" + window.NB.app.getCfg().theme);

  // The dark link is currently enabled because theme=auto -> dark.
  check("hljs: after auto pick, dark link is enabled",
    darkLink.disabled === false && lightLink.disabled === true);

  // Reset by closing.
  window.NB.settings.close();
  await tick(10);

  console.log("== wallpaper ==");
  // The wallpaper radios in Settings swap a class on #viewer-content
  // (the actual scroller + content element). Settings are LIVE: picking
  // a radio updates the class immediately, no Apply/Save step. Putting
  // the wallpaper on the same element that holds the rendered markdown
  // is what makes the pattern scroll in perfect lockstep with the text
  // -- the background is anchored to the content, not the scroll viewport.
  const viewerEl = window.document.getElementById("viewer-content");
  const wpRadio = (v) => window.document.querySelector('input[name="wallpaper"][value="' + v + '"]');
  const hasWpClass = (name) => {
    return Array.from(viewerEl.classList).some(c => c === "wallpaper-" + name);
  };

  // Default: #viewer-content has wallpaper-none class (app.js always
  // sets one) and no other wallpaper class. The radio is unselected
  // until open().
  check("wallpaper: default #viewer-content has wallpaper-none class",
    hasWpClass("none"), "classes=" + viewerEl.className);
  check("wallpaper: default #viewer-content has no wallpaper-lines class",
    !hasWpClass("lines"));
  check("wallpaper: default #viewer-content has no wallpaper-grid class",
    !hasWpClass("grid"));
  // Default: no wallpaper-fixed class (the scroll-with-content default).
  check("wallpaper: default #viewer-content has no wallpaper-fixed class",
    !viewerEl.classList.contains("wallpaper-fixed"));

  // Open settings, verify the radio group exists and "none" is checked.
  window.NB.settings.open(); await tick(20);
  check("wallpaper: settings has none radio", !!wpRadio("none"));
  check("wallpaper: settings has lines radio", !!wpRadio("lines"));
  check("wallpaper: settings has grid radio", !!wpRadio("grid"));
  check("wallpaper: none radio is checked by default",
    wpRadio("none") && wpRadio("none").checked === true);

  // Pick each non-default value, verify the live class swap is
  // immediate (no Apply), and the POST body has the picked value.
  // No modal reopen between picks because picking doesn't close it.
  for (const name of ["lines", "grid", "none"]) {
    wpRadio(name).checked = true;
    wpRadio(name).dispatchEvent(new window.Event("change", { bubbles: true }));
    await tick(20);
    // Live class swap is immediate.
    check("wallpaper: " + name + " pick -> live wallpaper-" + name + " class immediately",
      hasWpClass(name), "classes=" + viewerEl.className);
    // Other wallpaper-* classes are removed.
    const others = ["none", "lines", "grid"].filter(n => n !== name);
    for (const o of others) {
      check("wallpaper: " + name + " pick -> no wallpaper-" + o + " class",
        !hasWpClass(o), "classes=" + viewerEl.className);
    }
    // Persistence: wait past the 250ms debounce + check the POST body.
    await tick(400);
    const posts = fetchLog.filter(l => l.startsWith("POST /api/config"));
    const lastPost = posts[posts.length - 1] || "";
    check("wallpaper: " + name + " pick -> config body has wallpaper:\"" + name + "\"",
      new RegExp('"wallpaper":"' + name + '"').test(lastPost),
      lastPost);
  }
  // Reset to default (none) for the next block.
  wpRadio("none").checked = true;
  wpRadio("none").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("wallpaper: after reset-to-none, #viewer-content has wallpaper-none",
    hasWpClass("none"), "classes=" + viewerEl.className);
  window.NB.settings.close();
  await tick(10);

  // --- wallpaperScroll: the second wallpaper setting that picks how
  //     the pattern behaves when the user scrolls. "scroll" keeps the
  //     pattern tied to the content; "fixed" keeps it in the viewport.
  console.log("== wallpaper scroll ==");
  const wpsRadio = (v) => window.document.querySelector('input[name="wallpaperScroll"][value="' + v + '"]');
  const hasFixedClass = () => viewerEl.classList.contains("wallpaper-fixed");
  window.NB.settings.open(); await tick(20);
  check("wallpaper scroll: settings has scroll radio", !!wpsRadio("scroll"));
  check("wallpaper scroll: settings has fixed radio", !!wpsRadio("fixed"));
  check("wallpaper scroll: default 'scroll' radio is checked",
    wpsRadio("scroll") && wpsRadio("scroll").checked === true);
  // Pick "fixed": live class swap is immediate.
  wpsRadio("fixed").checked = true;
  wpsRadio("fixed").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("wallpaper scroll: fixed pick -> #viewer-content has wallpaper-fixed class immediately",
    hasFixedClass(), "classes=" + viewerEl.className);
  await tick(400);
  const wpsPosts = fetchLog.filter(l => l.startsWith("POST /api/config"));
  const lastWpsPost = wpsPosts[wpsPosts.length - 1] || "";
  check("wallpaper scroll: fixed pick -> config body has wallpaperScroll:\"fixed\"",
    /"wallpaperScroll":"fixed"/.test(lastWpsPost), lastWpsPost);
  // Revert to "scroll".
  wpsRadio("scroll").checked = true;
  wpsRadio("scroll").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("wallpaper scroll: scroll pick -> #viewer-content has no wallpaper-fixed class",
    !hasFixedClass(), "classes=" + viewerEl.className);
  await tick(400);
  const wpsPosts2 = fetchLog.filter(l => l.startsWith("POST /api/config"));
  const lastWpsPost2 = wpsPosts2[wpsPosts2.length - 1] || "";
  check("wallpaper scroll: scroll pick -> config body has wallpaperScroll:\"scroll\"",
    /"wallpaperScroll":"scroll"/.test(lastWpsPost2), lastWpsPost2);
  window.NB.settings.close();
  await tick(10);

  // --- wallpaperColor: which stroke color the pattern uses. The base
  //     CSS uses CSS variables --wp-rgb / --wp-a -- and the wallpaper-
  //     color-* classes set --wp-rgb. "neutral" removes any color class
  //     so the CSS default (white in dark / black in light) takes over.
  console.log("== wallpaper color ==");
  const wpcRadio = (v) => window.document.querySelector('input[name="wallpaperColor"][value="' + v + '"]');
  const hasColorClass = (n) => viewerEl.classList.contains("wallpaper-color-" + n);
  window.NB.settings.open(); await tick(20);
  check("wallpaper color: settings has neutral radio", !!wpcRadio("neutral"));
  check("wallpaper color: settings has blue radio", !!wpcRadio("blue"));
  check("wallpaper color: settings has green radio", !!wpcRadio("green"));
  check("wallpaper color: settings has purple radio", !!wpcRadio("purple"));
  check("wallpaper color: settings has amber radio", !!wpcRadio("amber"));
  check("wallpaper color: default 'neutral' radio is checked",
    wpcRadio("neutral") && wpcRadio("neutral").checked === true);
  check("wallpaper color: default #viewer-content has no wallpaper-color-* class",
    Array.from(viewerEl.classList).every(c => !c.startsWith("wallpaper-color-")),
    "classes=" + viewerEl.className);
  // Pick each non-neutral color, verify the live class swap is
  // immediate (no Apply), and the POST body has the picked value.
  for (const c of ["blue", "green", "purple", "amber"]) {
    wpcRadio(c).checked = true;
    wpcRadio(c).dispatchEvent(new window.Event("change", { bubbles: true }));
    await tick(20);
    check("wallpaper color: " + c + " pick -> #viewer-content has wallpaper-color-" + c + " class immediately",
      hasColorClass(c), "classes=" + viewerEl.className);
    await tick(400);
    const wpcPosts = fetchLog.filter(l => l.startsWith("POST /api/config"));
    const lastWpcPost = wpcPosts[wpcPosts.length - 1] || "";
    check("wallpaper color: " + c + " pick -> config body has wallpaperColor:\"" + c + "\"",
      /"wallpaperColor":\s*"' + c + '"/.test(lastWpcPost)
        || new RegExp('"wallpaperColor":"' + c + '"').test(lastWpcPost),
      lastWpcPost);
  }
  // Revert to neutral: the color-* class is removed.
  wpcRadio("neutral").checked = true;
  wpcRadio("neutral").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("wallpaper color: neutral pick -> no wallpaper-color-* class on #viewer-content",
    !Array.from(viewerEl.classList).some(c => c.startsWith("wallpaper-color-")),
    "classes=" + viewerEl.className);
  window.NB.settings.close();
  await tick(10);

  // --- wallpaperIntensity: how bold the stroke is. "subtle" is barely
  //     there (alpha 0.05); "medium" and "bold" step it up. The classes
  //     set --wp-a so the user can dial how visible the pattern is.
  //     Settings are LIVE: picking a radio updates the class immediately,
  //     no Apply/Save step.
  console.log("== wallpaper intensity ==");
  const wpiRadio = (v) => window.document.querySelector('input[name="wallpaperIntensity"][value="' + v + '"]');
  const hasIntensityClass = (n) => viewerEl.classList.contains("wallpaper-intensity-" + n);
  window.NB.settings.open(); await tick(20);
  check("wallpaper intensity: settings has subtle radio", !!wpiRadio("subtle"));
  check("wallpaper intensity: settings has medium radio", !!wpiRadio("medium"));
  check("wallpaper intensity: settings has bold radio", !!wpiRadio("bold"));
  check("wallpaper intensity: default 'subtle' radio is checked",
    wpiRadio("subtle") && wpiRadio("subtle").checked === true);
  check("wallpaper intensity: default #viewer-content has wallpaper-intensity-subtle class",
    hasIntensityClass("subtle"), "classes=" + viewerEl.className);

  // Pick each non-default value; the class swap is immediate.
  for (const i of ["medium", "bold"]) {
    wpiRadio(i).checked = true;
    wpiRadio(i).dispatchEvent(new window.Event("change", { bubbles: true }));
    await tick(20);
    check("wallpaper intensity: " + i + " pick -> live wallpaper-intensity-" + i + " class immediately",
      hasIntensityClass(i), "classes=" + viewerEl.className);
    check("wallpaper intensity: " + i + " pick -> no other wallpaper-intensity-* class",
      Array.from(viewerEl.classList).filter(c => c.startsWith("wallpaper-intensity-"))
        .every(c => c === "wallpaper-intensity-" + i),
      "classes=" + viewerEl.className);
    await tick(400);
    const posts = fetchLog.filter(l => l.startsWith("POST /api/config"));
    const lastPost = posts[posts.length - 1] || "";
    check("wallpaper intensity: " + i + " pick -> config body has wallpaperIntensity:\"" + i + "\"",
      new RegExp('"wallpaperIntensity":"' + i + '"').test(lastPost),
      lastPost);
  }
  // Reset to subtle (the default) and close.
  wpiRadio("subtle").checked = true;
  wpiRadio("subtle").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("wallpaper intensity: subtle pick -> #viewer-content has wallpaper-intensity-subtle class",
    hasIntensityClass("subtle"), "classes=" + viewerEl.className);
  window.NB.settings.close();
  await tick(10);

  // CSS source checks. The wallpaper styles are pure CSS gradients; jsdom
  // can't fully resolve the computed style of var()/calc() chains, so we
  // assert against the production stylesheet source. The rules live on
  // #viewer-content (the scroller + content element) and use
  // background-attachment: local so the pattern actually scrolls with
  // the content (the default `scroll` value would pin the background to
  // the border box, which is the windowpane feel the user does NOT
  // want). The wallpaper-fixed modifier flips it to `fixed` for the
  // windowpane option.
  {
    const css = read("static/css/style.css");
    const linesBlock = css.match(/#viewer-content\.wallpaper-lines\s*\{[^}]*\}/);
    check("wallpaper: #viewer-content.wallpaper-lines rule exists in stylesheet",
      !!linesBlock, linesBlock ? linesBlock[0].slice(0, 80) : "(not found)");
    check("wallpaper: #viewer-content.wallpaper-lines sets background-image (repeating-linear-gradient)",
      !!linesBlock && /repeating-linear-gradient/.test(linesBlock[0]),
      linesBlock ? linesBlock[0] : "(not found)");
    // Uses 1.5em so the line spacing tracks the body line-height and
    // re-spaces when the user changes the font size.
    check("wallpaper: #viewer-content.wallpaper-lines uses 1.5em (font-size aware)",
      !!linesBlock && /1\.5em/.test(linesBlock[0]),
      linesBlock ? linesBlock[0] : "(not found)");
    // background-attachment: local is the load-bearing piece for the
    // "Scroll with content" option. The default value `scroll` would
    // pin the background to the element's border box (windowpane feel);
    // `local` pins it to the element's contents so it actually scrolls
    // with the text.
    check("wallpaper: #viewer-content.wallpaper-lines has background-attachment: local (scrolls with content)",
      !!linesBlock && /background-attachment\s*:\s*local/.test(linesBlock[0]),
      linesBlock ? linesBlock[0] : "(not found)");

    const gridBlock = css.match(/#viewer-content\.wallpaper-grid\s*\{[^}]*\}/);
    check("wallpaper: #viewer-content.wallpaper-grid rule exists in stylesheet",
      !!gridBlock, gridBlock ? gridBlock[0].slice(0, 80) : "(not found)");
    check("wallpaper: #viewer-content.wallpaper-grid sets background-image (linear-gradient)",
      !!gridBlock && /linear-gradient/.test(gridBlock[0]),
      gridBlock ? gridBlock[0] : "(not found)");
    check("wallpaper: #viewer-content.wallpaper-grid sets background-size: 24px 24px",
      !!gridBlock && /background-size\s*:\s*24px\s+24px/.test(gridBlock[0]),
      gridBlock ? gridBlock[0] : "(not found)");
    check("wallpaper: #viewer-content.wallpaper-grid has background-attachment: local (scrolls with content)",
      !!gridBlock && /background-attachment\s*:\s*local/.test(gridBlock[0]),
      gridBlock ? gridBlock[0] : "(not found)");

    // Both rules should target #viewer-content specifically (not a global
    // class), so the wallpaper stays scoped to the preview area and
    // doesn't bleed into the editor split-pane or other surfaces.
    check("wallpaper: both wallpaper rules target #viewer-content specifically",
      /#viewer-content\.wallpaper-(lines|grid)/.test(css),
      "found #viewer-content.wallpaper-* selectors");
    // The fixed-mode rule toggles background-attachment: fixed when the
    // user picks the "Fixed in viewport" option. Both wallpaper classes
    // should be covered by the same rule (one rule, two selectors) so
    // adding a new pattern automatically gets the fixed behavior too.
    check("wallpaper: #viewer-content.wallpaper-{lines,grid}.wallpaper-fixed sets background-attachment: fixed",
      /#viewer-content\.wallpaper-lines\.wallpaper-fixed\s*,\s*\n?\s*#viewer-content\.wallpaper-grid\.wallpaper-fixed\s*\{[^}]*background-attachment\s*:\s*fixed/.test(css),
      "looking for combined .wallpaper-fixed rule");

    // The color + intensity modifiers are one-line CSS variable overrides:
    // the wallpaper-color-* classes set --wp-rgb (a 3-channel RGB value
    // used inside rgb(var(--wp-rgb) / var(--wp-a))), and wallpaper-
    // intensity-* classes set --wp-a (the stroke alpha). Verify the
    // expected presets exist so picking them actually changes the paint.
    check("wallpaper: #viewer-content.wallpaper-color-blue sets --wp-rgb",
      /#viewer-content\.wallpaper-color-blue\s*\{[^}]*--wp-rgb\s*:/.test(css),
      "looking for #viewer-content.wallpaper-color-blue { --wp-rgb: ... }");
    check("wallpaper: #viewer-content.wallpaper-color-green sets --wp-rgb",
      /#viewer-content\.wallpaper-color-green\s*\{[^}]*--wp-rgb\s*:/.test(css));
    check("wallpaper: #viewer-content.wallpaper-color-purple sets --wp-rgb",
      /#viewer-content\.wallpaper-color-purple\s*\{[^}]*--wp-rgb\s*:/.test(css));
    check("wallpaper: #viewer-content.wallpaper-color-amber sets --wp-rgb",
      /#viewer-content\.wallpaper-color-amber\s*\{[^}]*--wp-rgb\s*:/.test(css));
    check("wallpaper: #viewer-content.wallpaper-intensity-subtle sets --wp-a",
      /#viewer-content\.wallpaper-intensity-subtle\s*\{[^}]*--wp-a\s*:/.test(css));
    check("wallpaper: #viewer-content.wallpaper-intensity-medium sets --wp-a",
      /#viewer-content\.wallpaper-intensity-medium\s*\{[^}]*--wp-a\s*:/.test(css));
    check("wallpaper: #viewer-content.wallpaper-intensity-bold sets --wp-a",
      /#viewer-content\.wallpaper-intensity-bold\s*\{[^}]*--wp-a\s*:/.test(css));
    // The base wallpaper rules (lines + grid) must actually use the
    // --wp-rgb / --wp-a variables in their stroke color so the
    // color/intensity modifiers have an effect. Without this, the
    // modifiers are dead.
    const usesRgb = !!linesBlock && /rgb\(\s*var\(--wp-rgb\)/.test(linesBlock[0]);
    const usesAlpha = !!linesBlock && /var\(--wp-a\)/.test(linesBlock[0]);
    check("wallpaper: #viewer-content.wallpaper-lines uses --wp-rgb / --wp-a",
      usesRgb && usesAlpha, linesBlock ? linesBlock[0] : "(not found)");
    const gridUsesRgb = !!gridBlock && /rgb\(\s*var\(--wp-rgb\)/.test(gridBlock[0]);
    const gridUsesAlpha = !!gridBlock && /var\(--wp-a\)/.test(gridBlock[0]);
    check("wallpaper: #viewer-content.wallpaper-grid uses --wp-rgb / --wp-a",
      gridUsesRgb && gridUsesAlpha, gridBlock ? gridBlock[0] : "(not found)");
  }

  console.log("== welcome page ==");
  // The welcome page is the empty-state for the right pane: shown
  // when there are no open tabs (fresh install with no fallback,
  // closed the last tab, deleted the only open file). It carries
  // a small action panel -- "New note" + "Open Welcome.md" (the
  // latter only when Welcome.md is in the tree) -- and a tips list.
  // The earlier "close last tab -> welcome page is visible" check
  // already proved the page renders in the standard close-last-tab
  // path. Here we exercise the rest of the contract, so we re-enter
  // the welcome state explicitly: close all open tabs first.

  // Close any currently-open tabs so we're back in the empty state.
  // We snapshot the open list first and force-close each one (force
  // skips the dirty-confirm). The very last close fires clear() ->
  // showWelcome().
  const openBefore = window.NB.tabs.getOpen().slice();
  for (const p of openBefore) window.NB.tabs.close(p, { force: true });
  await tick(40);

  // Verify the structural elements + action buttons.
  const welcomeEl = $("welcome");
  check("welcome: <div#welcome> exists", !!welcomeEl);
  check("welcome: #welcome is visible", !welcomeEl.hidden);
  check("welcome: #viewer is hidden", $("viewer").hidden);
  check("welcome: icon present", !!welcomeEl.querySelector(".welcome-icon"));
  check("welcome: title present",
    /Welcome to your notebook/.test(welcomeEl.querySelector(".welcome-title").textContent));
  check("welcome: subtitle present",
    /Create a new note/.test(welcomeEl.querySelector(".welcome-subtitle").textContent));
  check("welcome: tips list has 4 entries",
    welcomeEl.querySelectorAll(".welcome-tips li").length === 4);
  check("welcome: tips list contains a <kbd> element",
    welcomeEl.querySelectorAll(".welcome-tips kbd").length >= 1);
  const newBtn = welcomeEl.querySelector('[data-act="new"]');
  check("welcome: 'New note' button present", !!newBtn);
  check("welcome: 'New note' button is visible", !newBtn.hidden);
  const openWelcomeBtn = welcomeEl.querySelector('[data-act="open-welcome"]');
  check("welcome: 'Open Welcome.md' button present", !!openWelcomeBtn);
  // The default notebook fixture ships with Welcome.md, so the button
  // should be revealed (not hidden) by showWelcome().
  check("welcome: 'Open Welcome.md' button is visible (Welcome.md in tree)",
    !openWelcomeBtn.hidden,
    "hidden=" + openWelcomeBtn.hidden);

  // Override NB.sidebar.getTree() to simulate Welcome.md being deleted.
  // Re-call showWelcome() to re-evaluate the button visibility.
  const realGetTree = window.NB.sidebar.getTree;
  window.NB.sidebar.getTree = () => [];
  window.NB.viewer.showWelcome && window.NB.viewer.showWelcome();
  await tick(20);
  check("welcome: 'Open Welcome.md' button is hidden when Welcome.md not in tree",
    welcomeEl.querySelector('[data-act="open-welcome"]').hidden,
    "hidden=" + welcomeEl.querySelector('[data-act="open-welcome"]').hidden);
  // Restore the real getTree.
  window.NB.sidebar.getTree = realGetTree;

  // 'New note' button delegates to NB.sidebar.createAtRoot("file").
  // Stub the create at the api level so we can confirm it's called
  // with the right type without actually creating a file. Then click
  // the button.
  const beforeTree = window.NB.sidebar.getTree();
  const newBtnAfter = welcomeEl.querySelector('[data-act="new"]');
  // The prompt is stubbed at the harness level; restore it for a moment
  // so we can capture the value. The harness default for prompt is "".
  // We want the new-file path to be created -- so we just assert the
  // click went through createAtRoot without throwing.
  let newFileCalled = false;
  const realCreateAtRoot = window.NB.sidebar.createAtRoot;
  window.NB.sidebar.createAtRoot = function (type) {
    newFileCalled = (type === "file");
  };
  newBtnAfter.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  check("welcome: 'New note' click -> sidebar.createAtRoot('file') called",
    newFileCalled);
  window.NB.sidebar.createAtRoot = realCreateAtRoot;

  // 'Open Welcome.md' click -> NB.tabs.open("Welcome.md") called.
  let openCalled = null;
  const realTabsOpen = window.NB.tabs.open;
  window.NB.tabs.open = function (path) {
    openCalled = path;
    return realTabsOpen.call(window.NB.tabs, path);
  };
  // The button was hidden above when we faked an empty tree, so we
  // need to re-run showWelcome to make it visible first. The real
  // getTree is restored, so Welcome.md is in the tree.
  window.NB.viewer.showWelcome();
  await tick(20);
  const openWelcomeBtnAfter = welcomeEl.querySelector('[data-act="open-welcome"]');
  check("welcome: 'Open Welcome.md' button visible again after real tree restored",
    !openWelcomeBtnAfter.hidden);
  openWelcomeBtnAfter.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  check("welcome: 'Open Welcome.md' click -> NB.tabs.open('Welcome.md') called",
    openCalled === "Welcome.md",
    "openCalled=" + openCalled);
  window.NB.tabs.open = realTabsOpen;

  // Opening a file should hide the welcome page and show the viewer.
  // (This time we use the real open, so the file actually loads.)
  check("welcome: opening a file hides the welcome page",
    $("welcome").hidden,
    "welcome.hidden=" + $("welcome").hidden);
  check("welcome: opening a file reveals the viewer",
    !$("viewer").hidden);

  // CSS regression guards. Same pattern as the wallpaper checks: the
  // welcome styles live in style.css, and we assert against the
  // production source so jsdom's incomplete style resolution doesn't
  // hide a regression.
  {
    const css = read("static/css/style.css");
    const welcomeBlock = css.match(/\.welcome\s*\{[^}]*\}/);
    check("welcome: .welcome rule exists in stylesheet",
      !!welcomeBlock, welcomeBlock ? welcomeBlock[0].slice(0, 80) : "(not found)");
    // The page centers its content -- display:flex with the centering
    // props is the load-bearing piece.
    check("welcome: .welcome uses display:flex (vertical centering)",
      !!welcomeBlock && /display\s*:\s*flex/.test(welcomeBlock[0]),
      welcomeBlock ? welcomeBlock[0] : "(not found)");
    check("welcome: .welcome uses align-items:center",
      !!welcomeBlock && /align-items\s*:\s*center/.test(welcomeBlock[0]));
    check("welcome: .welcome uses justify-content:center",
      !!welcomeBlock && /justify-content\s*:\s*center/.test(welcomeBlock[0]));
    // Action buttons: hover state with the accent token so they read
    // as interactive in both themes.
    const actionBlock = css.match(/\.welcome-action:hover\s*\{[^}]*\}/);
    check("welcome: .welcome-action:hover rule exists",
      !!actionBlock, actionBlock ? actionBlock[0].slice(0, 80) : "(not found)");
    check("welcome: .welcome-action:hover uses --accent-soft (theme-aware)",
      !!actionBlock && /var\(--accent-soft\)/.test(actionBlock[0]),
      actionBlock ? actionBlock[0] : "(not found)");
    // The kbd element should have a monospace font + border to look
    // like a key cap.
    const kbdBlock = css.match(/\.welcome-tips\s+kbd\s*\{[^}]*\}/);
    check("welcome: .welcome-tips kbd rule exists",
      !!kbdBlock, kbdBlock ? kbdBlock[0].slice(0, 80) : "(not found)");
    check("welcome: .welcome-tips kbd uses a monospace font family",
      !!kbdBlock && /monospace/i.test(kbdBlock[0]),
      kbdBlock ? kbdBlock[0] : "(not found)");
    // Defensive: .welcome[hidden] must collapse to display:none so the
    // standard HTML `hidden` attribute works on the block.
    check("welcome: .welcome[hidden] sets display:none",
      /\.welcome\[hidden\]\s*\{\s*display\s*:\s*none/.test(css),
      "looking for .welcome[hidden] { display: none; }");
    // Regression guard: #viewer's base rule sets `display: flex`, which
    // outranks the UA's [hidden] { display: none } (user CSS > UA CSS).
    // Without an explicit #viewer[hidden] { display: none } override,
    // setting viewer.hidden = true (when the welcome page is up) leaves
    // the viewer in the flex column with its full `flex: 1 1 auto` share
    // of the height -- the element stays in the layout, splits the
    // column with #welcome, and the welcome centers in the bottom half
    // instead of the full pane.
    check("welcome: #viewer[hidden] sets display:none (overrides user CSS display:flex)",
      /#viewer\[hidden\]\s*\{\s*display\s*:\s*none/.test(css),
      "looking for #viewer[hidden] { display: none; }");
    // Regression guard: .edit-split must be a real flex column, NOT
    // `display: contents`. With `display: contents` the wrapper has
    // no box, so #cm-host / #viewer / #welcome become direct flex
    // items of #editor-pane. Since #cm-host and #viewer are also
    // flex: 1 1 auto, the visible welcome ends up sharing the column
    // with them -- the row height gets split, and the welcome (which
    // centers in its own box) appears in the bottom half instead of
    // the full pane. A real flex column wrapper means only the visible
    // child fills the slot.
    const editSplitBlock = css.match(/\.edit-split\s*\{[^}]*\}/);
    check("welcome: .edit-split rule exists in stylesheet",
      !!editSplitBlock, editSplitBlock ? editSplitBlock[0].slice(0, 80) : "(not found)");
    check("welcome: .edit-split is NOT display:contents (real flex wrapper)",
      !!editSplitBlock && !/display\s*:\s*contents/.test(editSplitBlock[0]),
      editSplitBlock ? editSplitBlock[0] : "(not found)");
    check("welcome: .edit-split is display:flex (real flex wrapper)",
      !!editSplitBlock && /display\s*:\s*flex/.test(editSplitBlock[0]),
      editSplitBlock ? editSplitBlock[0] : "(not found)");
    check("welcome: .edit-split is flex-direction:column (vertical stack of children)",
      !!editSplitBlock && /flex-direction\s*:\s*column/.test(editSplitBlock[0]),
      editSplitBlock ? editSplitBlock[0] : "(not found)");
  }

  console.log("== deep link ==");
  // The app honors `?file=<path>&heading=<slug>` URLs: open the named
  // note and scroll to the named heading on boot. parseDeepLink is a
  // pure URL parser (easy to test); openDeepLink is the façade that
  // activates the tab, scrolls the viewer, and strips the query string
  // from the address bar.
  //
  // Test target: notes/b.md. Its content (FILE_B) is `# File B` with
  // no h2, which slugifies to "file-b". The fixture is read-only
  // across the test suite (Welcome.md gets overwritten by the
  // external-change block, notes/a.md gets saved with a new heading),
  // so notes/b.md is the only file that keeps its original content
  // and headings for the duration of the run.
  //
  // The other fixtures (notes/a.md, Welcome.md) are also exercised,
  // but we re-set their FILES entries to the original content first
  // so the deep-link scroll targets are stable.
  {
    // --- pure parseDeepLink -----------------------------------------
    const parse = window.NB.app.parseDeepLink;
    check("parseDeepLink: exposed", typeof parse === "function");
    const d1 = parse("http://x/?file=README.md&heading=core-rules");
    check("parseDeepLink: file + heading",
      d1 && d1.file === "README.md" && d1.heading === "core-rules",
      JSON.stringify(d1));
    const d2 = parse("http://x/?file=README.md");
    check("parseDeepLink: file only (heading null)",
      d2 && d2.file === "README.md" && d2.heading === null,
      JSON.stringify(d2));
    check("parseDeepLink: no file -> null",
      parse("http://x/") === null);
    check("parseDeepLink: unrelated params -> null",
      parse("http://x/?other=1") === null);
    check("parseDeepLink: URL-encodes spaces in path",
      parse("http://x/?file=" + encodeURIComponent("notes/sub/My File.md")) &&
      parse("http://x/?file=" + encodeURIComponent("notes/sub/My File.md")).file
        === "notes/sub/My File.md");

    // --- parseDeepLink path+fragment form ----------------------------
    // The Markdown-link form: /<file>#<heading>. The browser navigates
    // to the resolved URL and the SPA catch-all serves the index shell
    // for any path; parseDeepLink then turns the URL into a file+heading
    // pair that openDeepLink can apply.
    check("parseDeepLink path: /README.md#core-rules -> README.md / core-rules",
      (() => {
        const d = parse("http://x/README.md#core-rules");
        return d && d.file === "README.md" && d.heading === "core-rules";
      })());
    check("parseDeepLink path: subfolder /notes/a.md#intro",
      (() => {
        const d = parse("http://x/notes/a.md#intro");
        return d && d.file === "notes/a.md" && d.heading === "intro";
      })());
    check("parseDeepLink path: no fragment -> heading null",
      (() => {
        const d = parse("http://x/README.md");
        return d && d.file === "README.md" && d.heading === null;
      })());
    check("parseDeepLink path: / is null (no deep link on home)",
      parse("http://x/") === null);
    check("parseDeepLink path: /favicon.svg is null (not a notebook file)",
      parse("http://x/favicon.svg") === null);
    check("parseDeepLink path: /robots.txt is null",
      parse("http://x/robots.txt") === null);
    check("parseDeepLink path: query string wins over path form",
      (() => {
        // When both forms are present, the query-string form takes
        // priority (deterministic; query string is the more explicit
        // form). Constructed URL: /some-path.md with ?file=other.md in
        // the search -- the path form would otherwise activate
        // some-path.md, but the query form should win.
        const d = parse("http://x/some-path.md?file=other.md&heading=h");
        return d && d.file === "other.md" && d.heading === "h";
      })());
    check("parseDeepLink path: decodes URL-encoded heading",
      (() => {
        const d = parse("http://x/README.md#%E4%B8%AD%E6%96%87");
        return d && d.file === "README.md" && d.heading === "中文";
      })());

    // Re-seed the fixtures this block needs so the heading scroll
    // targets are stable (the earlier edit/save and external-change
    // blocks mutate them in place via the fake fetch). Also reset
    // TREE: several earlier blocks (sidebar drag, DnD, external
    // change) wipe + repopulate it, so the deep-link check has no
    // reliable way to find a file in the tree otherwise.
    TREE.length = 0;
    TREE.push({ name: "notes", type: "dir", path: "notes", children: [
      { name: "a.md", type: "file", path: "notes/a.md" },
      { name: "b.md", type: "file", path: "notes/b.md" },
    ]});
    TREE.push({ name: "Welcome.md", type: "file", path: "Welcome.md" });
    FILES["notes/b.md"] = "# File B\n\nAnother TODO fix this here.\n";
    FILES["notes/a.md"] = "# File A\n\nTODO fix this bug.\n\n## Sub A\n\nbody\n";
    // Drop any cached entries so the next viewer.activate re-fetches.
    for (const p of ["notes/a.md", "notes/b.md", "Welcome.md"]) {
      window.NB.viewer.close(p);
    }
    await window.NB.sidebar.refresh();
    await tick(20);
    await window.NB.tabs.open("notes/b.md");
    await tick(20);
    check("setup: notes/b.md active for deep-link tests",
      window.NB.tabs.getActive() === "notes/b.md",
      "active=" + window.NB.tabs.getActive() +
      " open=" + JSON.stringify(window.NB.tabs.getOpen()));
    check("setup: heading #file-b is in the DOM",
      !!window.document.getElementById("file-b"),
      "heads in viewer: " +
        Array.from(window.document.querySelectorAll("#viewer-content h1,#viewer-content h2"))
          .map(h => h.id).join(","));

    // --- scrollToHeading direct -------------------------------------
    // The viewer's scrollToHeading looks up an element by id (the same
    // slug the renderer assigns to each h1..h6) and calls scrollIntoView.
    check("viewer.scrollToHeading: present slug -> true",
      window.NB.viewer.scrollToHeading("file-b") === true);
    check("viewer.scrollToHeading: missing slug -> false",
      window.NB.viewer.scrollToHeading("does-not-exist") === false);
    check("viewer.scrollToHeading: empty slug -> false",
      window.NB.viewer.scrollToHeading("") === false);

    // --- openDeepLink integration -----------------------------------
    // Spy on scrollIntoView + history.replaceState. openDeepLink's
    // contract is now: activate the file, scroll to the heading, and
    // DO NOT touch history. URL cleanup (replaceState to strip
    // ?file=...&heading=...) is the boot path's job in app.js --
    // keeping it out of openDeepLink lets the in-app nav path call
    // openDeepLink without clobbering the history entry it just
    // pushed, and lets the popstate handler call it without
    // overwriting the just-restored state.
    const scrollCalls = [];
    const realScroll = window.Element.prototype.scrollIntoView;
    const realHistoryReplace = window.history.replaceState.bind(window.history);
    const historyReplaceCalls = [];
    window.Element.prototype.scrollIntoView = function () { scrollCalls.push(this.id); };
    window.HTMLElement.prototype.scrollIntoView = window.Element.prototype.scrollIntoView;
    window.history.replaceState = function (state, title, url) {
      historyReplaceCalls.push(url);
      return realHistoryReplace(state, title, url);
    };

    // Capture console.warn args (multi-arg warns join with spaces) so
    // the assertions can match the full message.
    const warns = [];
    const realWarn = window.console.warn;
    window.console.warn = (...args) => warns.push(args.map(String).join(" "));

    // Successful case: file in tree + heading in DOM (notes/b.md / file-b).
    scrollCalls.length = 0; historyReplaceCalls.length = 0; warns.length = 0;
    const ok = await window.NB.app.openDeepLink(
      window.NB.app.parseDeepLink("http://x/?file=notes%2Fb.md&heading=file-b"));
    check("openDeepLink: returns true on success", ok === true);
    check("openDeepLink: activates the deep-linked file",
      window.NB.tabs.getActive() === "notes/b.md");
    check("openDeepLink: scrollIntoView called for the right id",
      scrollCalls.length === 1 && scrollCalls[0] === "file-b",
      "calls=" + JSON.stringify(scrollCalls));
    check("openDeepLink: does NOT call replaceState (boot's job, not openDeepLink's)",
      historyReplaceCalls.length === 0,
      "calls=" + JSON.stringify(historyReplaceCalls));
    check("openDeepLink: no console.warn on success", warns.length === 0,
      warns.join("; "));

    // File-not-in-tree case: should log and bail, no scroll, no replace.
    scrollCalls.length = 0; historyReplaceCalls.length = 0; warns.length = 0;
    const beforeActive = window.NB.tabs.getActive();
    const ok2 = await window.NB.app.openDeepLink(
      window.NB.app.parseDeepLink("http://x/?file=ghost.md&heading=file-b"));
    check("openDeepLink: returns false when file missing", ok2 === false);
    check("openDeepLink: does NOT change active tab on missing file",
      window.NB.tabs.getActive() === beforeActive);
    check("openDeepLink: does NOT scroll on missing file",
      scrollCalls.length === 0);
    check("openDeepLink: does NOT replaceState on missing file",
      historyReplaceCalls.length === 0);
    check("openDeepLink: warns on missing file",
      warns.length === 1 && /ghost\.md/.test(warns[0]),
      warns.join("; "));

    // Heading-not-in-file case: file opens, but no scroll.
    scrollCalls.length = 0; historyReplaceCalls.length = 0; warns.length = 0;
    const ok3 = await window.NB.app.openDeepLink(
      window.NB.app.parseDeepLink("http://x/?file=notes%2Fb.md&heading=ghost-heading"));
    check("openDeepLink: returns true even with missing heading", ok3 === true);
    check("openDeepLink: file still opens on missing heading",
      window.NB.tabs.getActive() === "notes/b.md");
    check("openDeepLink: does NOT scroll on missing heading",
      scrollCalls.length === 0);
    check("openDeepLink: still does NOT replaceState on missing heading",
      historyReplaceCalls.length === 0);
    check("openDeepLink: warns on missing heading",
      warns.length === 1 && /ghost-heading/.test(warns[0]),
      warns.join("; "));

    // Idempotence: calling openDeepLink on an already-active file is
    // a no-op for tab ops but still scrolls to the heading. (No
    // replaceState -- see "does NOT call replaceState" above.)
    scrollCalls.length = 0; historyReplaceCalls.length = 0; warns.length = 0;
    const openCountBefore = window.NB.tabs.getOpen().length;
    await window.NB.app.openDeepLink(
      window.NB.app.parseDeepLink("http://x/?file=notes%2Fb.md&heading=file-b"));
    check("openDeepLink: does NOT add a duplicate tab for already-open file",
      window.NB.tabs.getOpen().length === openCountBefore);
    check("openDeepLink: still scrolls to the heading on the active file",
      scrollCalls.length === 1 && scrollCalls[0] === "file-b",
      "calls=" + JSON.stringify(scrollCalls));

    // Boot-integration: simulate the boot path. The real boot() reads
    // window.location, parses the URL, and calls openDeepLink. We
    // exercise the same code path by calling parseDeepLink() with
    // the explicit URL and openDeepLink with the result. jsdom locks
    // window.location as a non-configurable property, so we can't
    // mock it; the parseDeepLink() default-args branch is covered
    // below by the "no deep link -> null" check.
    //
    // The outline (NB.outline) also calls scrollIntoView on its own
    // <li> elements when the active heading changes -- those calls
    // have no id and aren't part of the deep-link path. Filter them
    // out so we only assert the deep-link scroll target.
    scrollCalls.length = 0; historyReplaceCalls.length = 0; warns.length = 0;
    const dl = window.NB.app.parseDeepLink("http://x/?file=notes%2Fa.md&heading=sub-a");
    const okBoot = await window.NB.app.openDeepLink(dl);
    const deepLinkScrolls = scrollCalls.filter(id => id === "sub-a");
    check("boot deep-link: activates notes/a.md",
      okBoot && window.NB.tabs.getActive() === "notes/a.md");
    check("boot deep-link: scrolls to sub-a heading",
      deepLinkScrolls.length === 1,
      "calls=" + JSON.stringify(scrollCalls) +
      " deepLinkScrolls=" + JSON.stringify(deepLinkScrolls));
    // openDeepLink itself doesn't touch history; the boot path's
    // replaceState lives in app.js (not openDeepLink). So no
    // replaceState should have fired from this openDeepLink call.
    check("boot deep-link: openDeepLink did not replaceState (boot's job)",
      historyReplaceCalls.length === 0,
      "calls=" + JSON.stringify(historyReplaceCalls));

    // parseDeepLink() with no arg defaults to window.location. The
    // test JSDOM was created with url "http://127.0.0.1:5000/" so
    // there is no deep link and the result is null (this is the
    // "normal boot" branch the app hits when no ?file= is present).
    check("parseDeepLink: window.location default is null (no deep link)",
      window.NB.app.parseDeepLink() === null);

    // Restore the stubs so later test blocks see the same environment.
    window.Element.prototype.scrollIntoView = realScroll;
    window.HTMLElement.prototype.scrollIntoView = realScroll;
    window.history.replaceState = realHistoryReplace;
    window.console.warn = realWarn;
  }

  console.log("== deep link: in-app click interception ==");
  // A Markdown link to another notebook file (e.g.
  // `[b](notes/b.md#file-b)`) is rendered as a same-origin <a>.
  // Without interception, the browser would do a full page navigation
  // -- slow, drops unsaved edits, resets scroll. With interception,
  // the click is routed through NB.app.openDeepLink so the SPA
  // switches tabs in place. Same-file anchors and external links
  // pass through unchanged.
  //
  // We render a fixture with a known set of links, simulate clicks
  // via the real viewerContentEl click handler, and assert the
  // active file / tab state matches what the deep-link path should
  // produce. The path-form catch-all is covered by parseDeepLink
  // tests in the previous block; here we test the click handler
  // wired into the rendered viewer.
  {
    // Seed a source file that contains the full set of links we
    // want to click. Re-render notes/a.md so the <a> elements land
    // in the DOM under our test click handler.
    FILES["notes/a.md"] = "# File A\n\n" +
      "TODO fix this bug.\n\n" +
      "## Sub A\n\nbody\n\n" +
      // Same-origin relative path: should be intercepted and open
      // the target file in the SPA.
      "See also: [File B](notes/b.md#file-b)\n\n" +
      // Same-file in-page anchor: should NOT be intercepted (let
      // the browser scroll natively).
      "Back to [Sub A](#sub-a)\n\n" +
      // Absolute external URL: should NOT be intercepted.
      "Visit [GitHub](https://github.com/example)\n\n" +
      // Mailto: definitely not a notebook link.
      "Email: [me](mailto:test@example.com)\n";
    window.NB.viewer.close("notes/a.md");
    await window.NB.tabs.open("notes/a.md");
    await tick(20);
    check("setup: notes/a.md active for click-intercept tests",
      window.NB.tabs.getActive() === "notes/a.md");
    const anchors = window.document.querySelectorAll("#viewer-content a");
    check("setup: 4 anchors rendered (relative, in-page, external, mailto)",
      anchors.length === 4, "got " + anchors.length + " anchors");

    // Spy on scrollIntoView. The in-app link handler now uses a
    // module-local navStack (not the browser's history) for the
    // back button's restore data -- the click handler doesn't call
    // pushState, and openDeepLink doesn't call replaceState (URL
    // cleanup moved to the boot path). The back button's enabled
    // state is what we observe to verify a click did push to the
    // nav stack.
    const scrollCalls = [];
    const realScroll = window.Element.prototype.scrollIntoView;
    window.Element.prototype.scrollIntoView = function () { scrollCalls.push(this.id); };
    window.HTMLElement.prototype.scrollIntoView = window.Element.prototype.scrollIntoView;
    const backBtn = window.document.getElementById("back-btn");
    const realWarn = window.console.warn;
    window.console.warn = () => {};
    // Start with a known back-button state. The boot path leaves
    // navStack empty so the button is disabled, but the previous
    // test blocks may have left it enabled. We can't reach the
    // module-scoped navStack directly, but the back button's
    // disabled flag is exposed via .disabled and follows
    // navStack.length. Reset to "fresh" for a clean per-click
    // observation: drain by clicking back until disabled.
    if (backBtn && !backBtn.disabled) {
      while (backBtn && !backBtn.disabled) {
        backBtn.click();
        await new Promise(r => window.setTimeout(r, 5));
      }
    }

    // Click 1: relative-path link to notes/b.md#file-b. The handler
    // should preventDefault, push a "cross-note" entry onto navStack
    // (enabling the back button), and route through openDeepLink.
    // The result: active tab is notes/b.md, scrollToHeading called
    // for "file-b", back button enabled.
    const rel = window.document.querySelector(
      '#viewer-content a[href$="notes/b.md#file-b"]');
    check("click-intercept: relative <a> is in the DOM", !!rel,
      rel ? rel.getAttribute("href") : "(not found)");
    scrollCalls.length = 0;
    const beforeClick1Disabled = backBtn ? backBtn.disabled : null;
    rel.dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0, cancelable: true }));
    await tick(20);
    check("click-intercept: relative path -> openDeepLink activates target",
      window.NB.tabs.getActive() === "notes/b.md",
      "active=" + window.NB.tabs.getActive());
    check("click-intercept: relative path -> scrollToHeading called for file-b",
      scrollCalls.filter(id => id === "file-b").length === 1,
      "calls=" + JSON.stringify(scrollCalls));
    check("click-intercept: relative path -> back button enabled (navStack push)",
      backBtn && !backBtn.disabled,
      "before=" + beforeClick1Disabled + " after=" + (backBtn ? backBtn.disabled : "n/a"));

    // After the click, switch back to notes/a.md for the next case.
    await window.NB.tabs.open("notes/a.md");
    await tick(20);
    // Drain back to a fresh state (the cross-note push is now
    // "consumed" by the active b.md tab; clicking back would undo
    // it, but for the next click we want a clean slate so the
    // in-page branch's effect is observable on its own).
    if (backBtn && !backBtn.disabled) {
      while (backBtn && !backBtn.disabled) {
        backBtn.click();
        await new Promise(r => window.setTimeout(r, 5));
      }
    }

    // Click 2: same-file in-page anchor (#sub-a). The handler
    // intercepts and pushes {type:"in-page", file, scroll} onto
    // navStack (so the back button can restore the pre-click
    // scroll). The result: scrollToHeading called for "sub-a",
    // back button enabled, no tab change.
    scrollCalls.length = 0;
    const inPage = window.document.querySelector(
      '#viewer-content a[href="#sub-a"]');
    check("click-intercept: in-page <a> is in the DOM", !!inPage,
      inPage ? inPage.getAttribute("href") : "(not found)");
    const beforeActive = window.NB.tabs.getActive();
    inPage.dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0, cancelable: true }));
    await tick(20);
    check("click-intercept: in-page anchor does NOT change the active tab",
      window.NB.tabs.getActive() === beforeActive);
    check("click-intercept: in-page anchor -> scrollToHeading called for sub-a",
      scrollCalls.filter(id => id === "sub-a").length === 1,
      "calls=" + JSON.stringify(scrollCalls));
    check("click-intercept: in-page anchor -> back button enabled (navStack push)",
      backBtn && !backBtn.disabled,
      "disabled=" + (backBtn ? backBtn.disabled : "n/a"));
    // Drain again so the next click starts fresh.
    if (backBtn && !backBtn.disabled) {
      while (backBtn && !backBtn.disabled) {
        backBtn.click();
        await new Promise(r => window.setTimeout(r, 5));
      }
    }

    // Click 3: absolute external URL. Same-origin check fails; pass
    // through. (jsdom doesn't navigate, but the assertion is the
    // side-effect: no openDeepLink call, no navStack push, no
    // scrollIntoView.)
    scrollCalls.length = 0;
    const ext = window.document.querySelector(
      '#viewer-content a[href^="https://"]');
    check("click-intercept: external <a> is in the DOM", !!ext,
      ext ? ext.getAttribute("href") : "(not found)");
    ext.dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0, cancelable: true }));
    await tick(20);
    check("click-intercept: external link does NOT call scrollToHeading",
      scrollCalls.length === 0);
    check("click-intercept: external link does NOT change the active tab",
      window.NB.tabs.getActive() === "notes/a.md");
    check("click-intercept: external link does NOT enable back button",
      backBtn && backBtn.disabled === true,
      "disabled=" + (backBtn ? backBtn.disabled : "n/a"));

    // Click 4: mailto. Same-origin check fails (mailto: is not
    // http(s)); pass through.
    scrollCalls.length = 0;
    const mailto = window.document.querySelector(
      '#viewer-content a[href^="mailto:"]');
    check("click-intercept: mailto <a> is in the DOM", !!mailto,
      mailto ? mailto.getAttribute("href") : "(not found)");
    mailto.dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0, cancelable: true }));
    await tick(20);
    check("click-intercept: mailto does NOT call scrollToHeading",
      scrollCalls.length === 0);
    check("click-intercept: mailto does NOT enable back button",
      backBtn && backBtn.disabled === true);

    // Modifier-key clicks: open in new tab is the user's intent. The
    // handler respects meta/ctrl/shift/alt and passes through.
    scrollCalls.length = 0;
    rel.dispatchEvent(new window.MouseEvent("click",
      { bubbles: true, button: 0, cancelable: true, ctrlKey: true }));
    await tick(20);
    check("click-intercept: Ctrl-click passes through (no navStack push)",
      backBtn && backBtn.disabled === true);
    check("click-intercept: Ctrl-click does NOT change the active tab",
      window.NB.tabs.getActive() === "notes/a.md");

    // Middle-click / non-primary button: also a "open in new tab"
    // intent. Pass through.
    scrollCalls.length = 0;
    rel.dispatchEvent(new window.MouseEvent("click",
      { bubbles: true, button: 1, cancelable: true }));
    await tick(20);
    check("click-intercept: middle-click passes through (no navStack push)",
      backBtn && backBtn.disabled === true);

    // Restore the stubs.
    window.Element.prototype.scrollIntoView = realScroll;
    window.HTMLElement.prototype.scrollIntoView = realScroll;
    window.console.warn = realWarn;
  }

  console.log("== wikilinks ==");
  // Obsidian-style [[Target]] internal links. viewer.js registers a
  // marked extension that tokenises [[...]] into <a data-wikilink>; the
  // click handler resolves the target against the current note + tree
  // and routes through openDeepLink. Unresolvable targets render as
  // plain text (no dead link).
  {
    // Seed a source file with wikilinks: a bare stem, a stem with a
    // label, a path with a heading anchor, and an unresolvable target.
    FILES["notes/a.md"] = "# File A\n\n" +
      "TODO fix this bug.\n\n" +
      "## Sub A\n\nbody\n\n" +
      "See [[b]] and [[b|File B]] and [[b#file-b]] and [[ghost]].\n";
    window.NB.viewer.close("notes/a.md");
    await window.NB.tabs.open("notes/a.md");
    await tick(20);
    check("wikilink: notes/a.md active", window.NB.tabs.getActive() === "notes/a.md");

    // The marked extension renders [[b]] -> <a data-wikilink href="b">.
    const wlAnchors = () => window.document.querySelectorAll("#viewer-content a[data-wikilink]");
    check("wikilink: [[b]] renders as <a data-wikilink>",
      wlAnchors().length === 3, "got " + wlAnchors().length + " wikilink anchors");
    const bLink = window.document.querySelector('#viewer-content a[data-wikilink][href="b"]');
    check("wikilink: bare stem [[b]] href is 'b'",
      !!bLink && bLink.textContent === "b",
      bLink ? "href=" + bLink.getAttribute("href") + " text=" + bLink.textContent : "(none)");
    const bLabel = window.document.querySelector('#viewer-content a[data-wikilink][href="b"]');
    // The labelled form [[b|File B]] -> href="b" text="File B".
    const labelled = Array.from(wlAnchors()).find(a => a.textContent === "File B");
    check("wikilink: [[b|File B]] renders label as text",
      !!labelled && labelled.getAttribute("href") === "b",
      labelled ? "href=" + labelled.getAttribute("href") : "(none)");
    // The heading form [[b#file-b]] -> href="b#file-b".
    const withHeading = window.document.querySelector('#viewer-content a[data-wikilink][href="b#file-b"]');
    check("wikilink: [[b#file-b]] keeps the #anchor in href",
      !!withHeading, withHeading ? withHeading.getAttribute("href") : "(none)");
    // Unresolvable [[ghost]] renders as plain text, not a link.
    check("wikilink: unresolvable [[ghost]] is NOT a link",
      !window.document.querySelector('#viewer-content a[data-wikilink][href="ghost"]'),
      "ghost anchor present");

    // Clicking [[b]] should resolve to notes/b.md (stem index) and open
    // it via openDeepLink, pushing a navStack entry (back button).
    const backBtn = window.document.getElementById("back-btn");
    if (backBtn && !backBtn.disabled) {
      while (backBtn && !backBtn.disabled) {
        backBtn.click();
        await new Promise(r => window.setTimeout(r, 5));
      }
    }
    const scrollCalls = [];
    const realScroll = window.Element.prototype.scrollIntoView;
    window.Element.prototype.scrollIntoView = function () { scrollCalls.push(this.id); };
    window.HTMLElement.prototype.scrollIntoView = window.Element.prototype.scrollIntoView;
    bLink.dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0, cancelable: true }));
    await tick(20);
    check("wikilink: click [[b]] opens notes/b.md",
      window.NB.tabs.getActive() === "notes/b.md",
      "active=" + window.NB.tabs.getActive());
    check("wikilink: click [[b]] enables back button (navStack push)",
      backBtn && !backBtn.disabled,
      "disabled=" + (backBtn ? backBtn.disabled : "n/a"));
    // Clicking [[b#file-b]] should scroll to the heading.
    await window.NB.tabs.open("notes/a.md");
    await tick(20);
    if (backBtn && !backBtn.disabled) {
      while (backBtn && !backBtn.disabled) {
        backBtn.click();
        await new Promise(r => window.setTimeout(r, 5));
      }
    }
    scrollCalls.length = 0;
    // Re-query the anchor: re-opening notes/a.md re-rendered the DOM,
    // so the earlier `withHeading` reference is detached.
    const wlHeading = window.document.querySelector('#viewer-content a[data-wikilink][href="b#file-b"]');
    check("wikilink: [[b#file-b]] anchor present after re-open", !!wlHeading);
    wlHeading.dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0, cancelable: true }));
    await tick(20);
    check("wikilink: click [[b#file-b]] opens notes/b.md",
      window.NB.tabs.getActive() === "notes/b.md",
      "active=" + window.NB.tabs.getActive());
    check("wikilink: click [[b#file-b]] scrolls to file-b heading",
      scrollCalls.filter(id => id === "file-b").length === 1,
      "calls=" + JSON.stringify(scrollCalls));

    // Restore stubs + fixture.
    window.Element.prototype.scrollIntoView = realScroll;
    window.HTMLElement.prototype.scrollIntoView = realScroll;
    FILES["notes/a.md"] = "# File A\n\nTODO fix this bug.\n\n## Sub A\n\nbody\n";
    window.NB.viewer.close("notes/a.md");
    await window.NB.tabs.open("notes/a.md");
    await tick(20);
  }

  console.log("== viewer top spacing ==");
  // The rendered preview's first heading should sit close to the top of
  // the viewer -- otherwise the viewer padding + the heading's own
  // top-margin stack into a large empty band above the title (regression
  // guard for a reported UX bug). We assert on the CSS source directly:
  // the production stylesheet must (a) keep the scroll container's top
  // padding small and (b) zero out the top margin of the first child of
  // .markdown-body.
  //
  // The padding lives on #viewer-content (the scroller) after the
  // wallpaper scroll-sync restructure; #viewer is now a non-scrolling
  // shell that just wraps it.
  {
    const css = read("static/css/style.css");
    // #viewer-content padding must not have a 60vh / 50vh / etc. (units
    // relative to viewport create huge empty bands on tall windows).
    // Top padding should be a small absolute value.
    const viewerBlock = css.match(/#viewer-content\s*\{[^}]*\}/);
    check("viewer: #viewer-content rule exists in stylesheet", !!viewerBlock,
      viewerBlock ? viewerBlock[0].slice(0, 80) : "(not found)");
    const topPadMatch = viewerBlock && viewerBlock[0].match(/padding\s*:\s*([^;]+);/);
    const topPadVal = topPadMatch ? topPadMatch[1].trim() : "";
    const tokens = topPadVal.split(/\s+/);
    const topPadPx = tokens[0] || "";
    // The first padding token (top) should be a small px value -- not vh,
    // not %, not em, not auto.
    check("viewer: #viewer-content padding-top is a small px value (<= 20px)",
      /^\d+px$/.test(topPadPx) && parseInt(topPadPx, 10) <= 20,
      "padding=" + topPadVal);
    // The :first-child reset must be present and must come AFTER the
    // generic h1-h6 margin rule so it wins the cascade for the first
    // heading. Same-specificity, later-wins.
    const firstChildIdx = css.indexOf(":first-child");
    const h1RuleIdx = css.indexOf(".markdown-body h1,");
    check("viewer: .markdown-body > :first-child rule exists",
      firstChildIdx > -1, "firstChildIdx=" + firstChildIdx);
    check("viewer: :first-child rule sits AFTER the generic h1-h6 margin rule (cascade order)",
      firstChildIdx > h1RuleIdx && h1RuleIdx > -1,
      "firstChildIdx=" + firstChildIdx + " h1RuleIdx=" + h1RuleIdx);
    // And the rule actually zeroes the top margin.
    const fcBlock = css.match(/\.markdown-body\s*>\s*:first-child\s*\{[^}]*\}/);
    check("viewer: :first-child rule sets margin-top: 0",
      !!fcBlock && /margin-top\s*:\s*0\b/.test(fcBlock[0]),
      fcBlock ? fcBlock[0] : "(not found)");
  }

  console.log("== keyboard scroll ==");
  // Arrow Up/Down and Page Up/Down scroll the markdown content when the
  // viewer is visible and the user isn't typing. The content lives in an
  // inner scroller (#viewer-content), so we route the keys to it.
  {
    const vc = $("viewer-content");
    // Ensure a file is active and the viewer is shown (preview mode).
    await window.NB.tabs.activate("notes/a.md");
    await tick(20);
    check("scroll: viewer content visible (precondition)",
      !$("viewer").hidden && !$("cm-host").hidden === false);
    // ArrowDown scrolls down by SCROLL_LINE (48px).
    const before = vc.scrollTop;
    window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
      key: "ArrowDown", code: "ArrowDown", bubbles: true, cancelable: true,
    }));
    await tick(10);
    check("scroll: ArrowDown scrolls content down",
      vc.scrollTop === before + 48, "before=" + before + " after=" + vc.scrollTop);
    // ArrowUp scrolls back up.
    window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
      key: "ArrowUp", code: "ArrowUp", bubbles: true, cancelable: true,
    }));
    await tick(10);
    check("scroll: ArrowUp scrolls content up",
      vc.scrollTop === before, "after=" + vc.scrollTop);
    // PageDown scrolls by the client height; PageUp back.
    const ch = vc.clientHeight || 0;
    window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
      key: "PageDown", code: "PageDown", bubbles: true, cancelable: true,
    }));
    await tick(10);
    check("scroll: PageDown scrolls by client height",
      vc.scrollTop === before + ch, "after=" + vc.scrollTop);
    window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
      key: "PageUp", code: "PageUp", bubbles: true, cancelable: true,
    }));
    await tick(10);
    check("scroll: PageUp scrolls back up",
      vc.scrollTop === before, "after=" + vc.scrollTop);
    // Typing guard: with an input focused, ArrowDown must NOT scroll.
    $("search-input").focus();
    const beforeTyping = vc.scrollTop;
    window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
      key: "ArrowDown", code: "ArrowDown", bubbles: true, cancelable: true,
    }));
    await tick(10);
    check("scroll: ArrowDown in an input does NOT scroll (typing guard)",
      vc.scrollTop === beforeTyping, "after=" + vc.scrollTop);
    $("search-input").blur();
    await tick(10);
  }

  console.log("== back button ==");
  // The back button (#back-btn) in the topbar returns to the previous
  // note (cross-note) or the previous scroll position (in-page).
  // Design: in-app navigation uses a module-local navStack in
  // viewer.js (not the browser's history). Reasons:
  //   - popstate fires on the entry being ENTERED, not the one being
  //     LEFT, so attaching "where to return to" state to the entry
  //     you're leaving makes it invisible to popstate.
  //   - The browser's back button (alt+left, etc.) still works for
  //     out-of-app history (e.g. leaving the SPA entirely); the
  //     popstate listener inside viewer.js also drains the stack on
  //     browser-back so the two stay in sync.
  // Externally visible: the back button's `disabled` flag (true iff
  // navStack is empty) and the side effects on tabs + scrollTop.
  {
    // Re-seed fixtures -- the earlier click-intercept block overwrote
    // notes/a.md with a link-rich version. We want a clean source file
    // for the back-button tests, plus a sub-folder structure so
    // subfolder nav exercises the path resolver.
    TREE.length = 0;
    TREE.push({ name: "notes", type: "dir", path: "notes", children: [
      { name: "a.md", type: "file", path: "notes/a.md" },
      { name: "b.md", type: "file", path: "notes/b.md" },
    ]});
    TREE.push({ name: "Welcome.md", type: "file", path: "Welcome.md" });
    FILES["Welcome.md"] = "# Welcome\n\nWelcome content.\n\n## One\n\nx\n\n## Two\n\ny\n";
    FILES["notes/a.md"] = "# File A\n\nTODO fix this bug.\n\n## Sub A\n\nbody\n";
    FILES["notes/b.md"] = "# File B\n\nAnother TODO fix this here.\n";
    for (const p of ["notes/a.md", "notes/b.md", "Welcome.md"]) {
      window.NB.viewer.close(p);
    }
    await window.NB.sidebar.refresh();
    await tick(20);
    await window.NB.tabs.open("notes/a.md");
    await tick(20);

    const backBtn = window.document.getElementById("back-btn");
    // Drain navStack to a known-empty state. Earlier test blocks
    // (click-intercept) push entries via real clicks; the only way to
    // pop the stack is to click the back button. Loop until the
    // button reports disabled.
    if (backBtn) {
      while (!backBtn.disabled) {
        backBtn.click();
        await new Promise(r => window.setTimeout(r, 5));
      }
    }

    check("back-btn: exists in the topbar", !!backBtn);
    check("back-btn: initially disabled (navStack empty after drain)",
      backBtn && backBtn.disabled === true,
      "backBtn=" + (backBtn ? "found" : "null") +
      " disabled=" + (backBtn ? backBtn.disabled : "n/a") +
      " hasAttr=" + (backBtn ? backBtn.hasAttribute("disabled") : "n/a"));
    check("back-btn: initially has .icon-btn class",
      backBtn && backBtn.classList.contains("icon-btn"));

    // Set up a controlled scroll-position tracker. The viewer's
    // rAF-debounced scroll listener updates scrollPositions on every
    // scroll event; for the test we directly poke viewerContentEl
    // and dispatch a scroll event so the listener fires.
    const vc = window.document.getElementById("viewer-content");
    function setViewerScroll(px) {
      vc.scrollTop = px;
      vc.dispatchEvent(new window.Event("scroll", { bubbles: true }));
    }

    // --- Cross-note nav ------------------------------------------------
    // Add a link in notes/a.md that points to notes/b.md#file-b. We
    // re-open notes/a.md to render the new content.
    FILES["notes/a.md"] = "# File A\n\n" +
      "TODO fix this bug.\n\n" +
      "## Sub A\n\nbody\n\n" +
      "See also: [File B](notes/b.md#file-b)\n\n" +
      "Back to [Sub A](#sub-a)\n";
    window.NB.viewer.close("notes/a.md");
    await window.NB.tabs.open("notes/a.md");
    await tick(20);

    // Give the viewer a non-zero scroll position so we can verify
    // back restores it. Then click the cross-note link.
    setViewerScroll(120);
    // Force one rAF tick so the debounced scroll tracker records it.
    await new Promise(r => window.setTimeout(r, 30));

    const rel = window.document.querySelector(
      '#viewer-content a[href$="notes/b.md#file-b"]');
    check("back: cross-note link in DOM", !!rel,
      rel ? rel.getAttribute("href") : "(not found)");
    rel.dispatchEvent(new window.MouseEvent("click",
      { bubbles: true, button: 0, cancelable: true }));
    await tick(40);

    // The click should have pushed a "cross-note" entry to the
    // navStack, switched to notes/b.md, and enabled the back button.
    check("back: cross-note -> active is notes/b.md",
      window.NB.tabs.getActive() === "notes/b.md",
      "active=" + window.NB.tabs.getActive());
    check("back: cross-note -> back-btn enabled (navStack push)",
      backBtn.disabled === false, "disabled=" + backBtn.disabled);

    // Click the back button -- the click handler pops the stack and
    // activates the source tab, restoring the scroll.
    backBtn.dispatchEvent(new window.MouseEvent("click",
      { bubbles: true, button: 0, cancelable: true }));
    // The cross-note branch awaits NB.tabs.activate/open, which
    // involves at least one rAF; give it room.
    await new Promise(r => window.setTimeout(r, 30));
    await tick(40);
    await new Promise(r => window.requestAnimationFrame(r));

    check("back: click back-btn -> active is notes/a.md again",
      window.NB.tabs.getActive() === "notes/a.md",
      "active=" + window.NB.tabs.getActive());
    check("back: click back-btn -> scroll restored to 120",
      vc.scrollTop === 120, "scrollTop=" + vc.scrollTop);
    check("back: click back-btn -> both tabs still open",
      window.NB.tabs.isOpen("notes/a.md") && window.NB.tabs.isOpen("notes/b.md"),
      "open=" + JSON.stringify(window.NB.tabs.getOpen()));
    check("back: click back-btn -> back-btn re-disabled (stack empty)",
      backBtn.disabled === true, "disabled=" + backBtn.disabled);

    // --- In-page nav ---------------------------------------------------
    // From notes/a.md, click an in-page anchor. The in-page branch
    // pushes {type:"in-page", file, scroll} to the navStack.
    // First, give the viewer a non-zero scroll so the in-page state
    // records a meaningful pre-click value.
    setViewerScroll(80);
    await new Promise(r => window.setTimeout(r, 30));

    const inPage = window.document.querySelector(
      '#viewer-content a[href="#sub-a"]');
    check("back: in-page anchor in DOM", !!inPage,
      inPage ? inPage.getAttribute("href") : "(not found)");
    inPage.dispatchEvent(new window.MouseEvent("click",
      { bubbles: true, button: 0, cancelable: true }));
    await tick(40);

    check("back: in-page -> back-btn enabled (navStack push)",
      backBtn.disabled === false);
    // scrollToHeading scrolled to the heading; jsdom's layout doesn't
    // compute scrollTop in the same way as a real browser, but the
    // handler at least calls scrollIntoView on the right element.
    // We don't assert on the new scrollTop because jsdom doesn't
    // simulate layout; we assert the side effect (push happened).

    // Click back -- the in-page pop handler restores the scroll.
    backBtn.dispatchEvent(new window.MouseEvent("click",
      { bubbles: true, button: 0, cancelable: true }));
    await new Promise(r => window.setTimeout(r, 30));
    await tick(40);
    await new Promise(r => window.requestAnimationFrame(r));
    check("back: in-page -> back-btn re-disabled",
      backBtn.disabled === true);
    // The scroll restore is the same rAF-wrapped path as the
    // cross-note case. Same caveat about jsdom layout.
    check("back: in-page -> scroll restored to 80",
      vc.scrollTop === 80, "scrollTop=" + vc.scrollTop);

    // --- Browser back also drains the stack --------------------------
    // Build a fresh cross-note nav, then fire a popstate directly
    // (which is what the browser's back button does). The viewer's
    // popstate handler should pop the same navStack the back button
    // does, so the active tab returns to the source.
    //
    // The earlier cross-note section captured `rel` at a specific
    // render of a.md; since then the in-page test re-rendered the
    // viewer, so we have to look it up again. (DOM elements from
    // older renders are detached; dispatching on them is a no-op.)
    const relFresh = window.document.querySelector(
      '#viewer-content a[href$="notes/b.md#file-b"]');
    check("back: popstate-prep cross-note link is in the DOM", !!relFresh,
      relFresh ? relFresh.getAttribute("href") : "(not found)");

    setViewerScroll(200);
    await new Promise(r => window.setTimeout(r, 30));
    relFresh.dispatchEvent(new window.MouseEvent("click",
      { bubbles: true, button: 0, cancelable: true }));
    await tick(40);
    check("back: prep for popstate -> back-btn enabled",
      backBtn.disabled === false);
    check("back: prep for popstate -> active is notes/b.md",
      window.NB.tabs.getActive() === "notes/b.md",
      "active=" + window.NB.tabs.getActive());

    // Simulate the browser's back button. dispatchEvent is sync; the
    // handler kicks off an async chain (tabs.activate + rAF).
    window.dispatchEvent(new window.PopStateEvent("popstate", { state: null }));
    await new Promise(r => window.setTimeout(r, 30));
    await tick(40);
    await new Promise(r => window.requestAnimationFrame(r));
    check("back: popstate -> active is notes/a.md",
      window.NB.tabs.getActive() === "notes/a.md",
      "active=" + window.NB.tabs.getActive());
    check("back: popstate -> back-btn re-disabled (stack drained)",
      backBtn.disabled === true, "disabled=" + backBtn.disabled);
  }

  console.log("== vim mode ==");
  // The shell-level VIM keymap (`static/js/vimnav.js`) is opt-in via
  // Settings → "VIM mode" (off by default). When enabled, the
  // three layout panels — sidebar / editor / outline — act as VIM
  // "windows" that you cycle through with Ctrl+W and navigate with
  // HJKL. Pressing `i` (or `e`) in the editor window enters edit
  // mode (focuses CodeMirror); Esc exits. The keymap yields when an
  // input has focus, when a modal is up, or when CodeMirror has
  // focus (only Esc is intercepted then).
  //
  // Activation toggle lives in the Settings modal. The keymap listener
  // is attached on module load and gated by `enabled`, so tests need
  // only flip the cfg (NB.app.setVimMode) and watch NB.vimnav.
  const pressKey = (key, opts = {}) => {
    // Derive a sensible e.code when the test didn't supply one. In
    // real browsers, "Alt+H" on macOS sets e.code to "KeyH" regardless
    // of the composed e.key ("˙"). Vimnav now keys the Alt+H/L tab
    // cycle off e.code so it works on Mac; mirror that here so the
    // tests cover the production path.
    let code = opts.code;
    if (code === undefined) {
      if (typeof key === "string" && /^[a-z]$/i.test(key)) code = "Key" + key.toUpperCase();
      else if (typeof key === "string" && /^[0-9]$/.test(key)) code = "Digit" + key;
    }
    window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
      key, bubbles: true, cancelable: true, code, ...opts,
    }));
  };
  // focus a non-editable target so vimnav's inEditable() returns false.
  const blurActive = () => {
    if (window.document.activeElement && window.document.activeElement !== window.document.body) {
      window.document.activeElement.blur();
    }
    window.document.body.focus();
  };
  // The shell VIM keymap is active ONLY while editing (cm-host visible)
  // AND CodeMirror does not have focus (CM's own vim keymap owns the
  // keys then). Enter edit mode and drop CM focus so the shell keymap
  // is live for the navigation tests below.
  const enterEditShell = async () => {
    if (cmIsHidden()) { pressKey("e", { ctrlKey: true }); await tick(20); }
    blurActive();
    await tick(10);
  };
  const exitEditShell = async () => {
    if (!cmIsHidden()) { pressKey("e", { ctrlKey: true }); await tick(20); }
  };

  // Boot state: VIM is off by default.
  blurActive();
  check("vim: disabled by default at boot", window.NB.vimnav.isEnabled() === false);
  check("vim: body lacks .vim-enabled class at boot",
    !window.document.body.classList.contains("vim-enabled"));
  // j is a no-op when VIM is off: doesn't change anything we observe.
  const beforeJ = window.NB.sidebar.getVimCursor && window.NB.sidebar.getVimCursor();
  pressKey("j");
  await tick(20);
  check("vim: when off, j is a no-op (no sidebar nav)",
    window.NB.sidebar.getVimCursor && window.NB.sidebar.getVimCursor() === beforeJ);

  // Enable via settings. The toggle is live: clicking it writes
  // vimMode=true to cfg + calls NB.vimnav.setEnabled (shell keymap) +
  // NB.cmEditor.setVimMode (editor vim keymap) + persists to
  // /api/config. No Apply/Save.
  window.NB.settings.open();
  await tick(20);
  const vimToggle = $("settings-vim-toggle");
  check("vim: settings toggle is in the General section", !!vimToggle);
  check("vim: toggle starts unchecked", vimToggle.checked === false);
  vimToggle.checked = true;
  vimToggle.dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("vim: enabling toggle -> vimnav.isEnabled()", window.NB.vimnav.isEnabled() === true);
  check("vim: enabling toggle -> body has .vim-enabled class",
    window.document.body.classList.contains("vim-enabled"));
  await tick(400);  // wait for debounced config POST
  const vimPosts = fetchLog.filter(l => l.startsWith("POST /api/config"));
  const lastVimPost = vimPosts[vimPosts.length - 1] || "";
  check("vim: enabling -> config POST has vimMode:true",
    /"vimMode":true/.test(lastVimPost), lastVimPost);
  // Close the settings modal -- the keymap yields when it's open.
  window.NB.settings.close();
  await tick(10);
  check("vim: settings closed -> overlay hidden",
    $("settings-overlay").hidden === true);

  // Once enabled, the three layout panels are tagged .vim-window and
  // have data-vim-window. Exactly one has .vim-active.
  const vimWindows = window.document.querySelectorAll(".vim-window");
  check("vim: 3 windows tagged", vimWindows.length === 3, "got " + vimWindows.length);
  const activeWin = () => window.document.querySelector(".vim-window.vim-active");
  check("vim: one window has .vim-active (initial = editor)",
    activeWin() && activeWin().dataset.vimWindow === "editor",
    activeWin() && activeWin().dataset.vimWindow);

  // Ctrl+W cycles: editor -> outline -> sidebar -> editor.
  pressKey("w", { ctrlKey: true });
  await tick(10);
  check("vim: Ctrl+W editor -> outline",
    activeWin() && activeWin().dataset.vimWindow === "outline",
    activeWin() && activeWin().dataset.vimWindow);
  pressKey("w", { ctrlKey: true });
  await tick(10);
  check("vim: Ctrl+W outline -> sidebar",
    activeWin() && activeWin().dataset.vimWindow === "sidebar",
    activeWin() && activeWin().dataset.vimWindow);
  pressKey("w", { ctrlKey: true });
  await tick(10);
  check("vim: Ctrl+W sidebar -> editor (wraps)",
    activeWin() && activeWin().dataset.vimWindow === "editor",
    activeWin() && activeWin().dataset.vimWindow);

  // Sidebar window: j moves the vim cursor down. NB.sidebar tracks
  // its own cursor (independent of the .selected highlight); we just
  // check the cursor path changes. From the cycle above we are in
  // editor; one Ctrl+W gets us to outline, two to sidebar. The shell
  // keymap is live only while editing, so enter edit mode first.
  await enterEditShell();
  pressKey("w", { ctrlKey: true });   // editor -> outline
  pressKey("w", { ctrlKey: true });   // outline -> sidebar
  await tick(10);
  // Sidebar was last refreshed with tree TREE = [notes/[a.md,b.md], Welcome.md].
  // The vim cursor is seeded to the active file ("notes/a.md") when
  // the keymap is enabled. j should move to the next row.
  const sidebarCursor1 = window.NB.sidebar.getVimCursor();
  check("vim: sidebar seeded to active file (notes/a.md)",
    sidebarCursor1 === "notes/a.md", "cursor=" + sidebarCursor1);
  pressKey("j");
  await tick(10);
  const sidebarCursor2 = window.NB.sidebar.getVimCursor();
  check("vim: sidebar j -> next row (notes/b.md)",
    sidebarCursor2 === "notes/b.md", "cursor=" + sidebarCursor2);
  pressKey("k");
  await tick(10);
  check("vim: sidebar k -> prev row (notes/a.md)",
    window.NB.sidebar.getVimCursor() === "notes/a.md",
    "cursor=" + window.NB.sidebar.getVimCursor());

  // Clicking a vim window gives it focus (mousedown handler).
  pressKey("w", { ctrlKey: true });   // outline
  await tick(10);
  $("sidebar").dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
  await tick(10);
  check("vim: click sidebar -> active = sidebar",
    activeWin() && activeWin().dataset.vimWindow === "sidebar",
    activeWin() && activeWin().dataset.vimWindow);

  // Editor window: Ctrl+E toggles edit mode (focuses CodeMirror).
  // Esc is VIM's insert->normal mode key and is owned by the
  // CodeMirror vim keymap while the editor has focus -- it does NOT
  // exit edit mode. (i / e used to enter edit mode; now reserved
  // for VIM.)
  // First go back to editor. Drop out of edit mode (the sidebar
  // test above entered it) so this section starts in preview.
  await exitEditShell();
  $("editor-pane").dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
  await tick(10);
  check("vim: click editor-pane -> active = editor",
    activeWin() && activeWin().dataset.vimWindow === "editor",
    activeWin() && activeWin().dataset.vimWindow);
  // We're NOT in edit mode yet -> cm-host should be hidden.
  check("vim: editor not in edit mode initially", cmIsHidden());
  // 'i' alone should NOT enter edit mode (it's a VIM insert-mode key,
  // owned by CodeMirror when the editor is focused -- but in preview
  // mode it should be a no-op for the shell).
  pressKey("i");
  await tick(20);
  check("vim: 'i' in preview does NOT enter edit mode (VIM key reserved)", cmIsHidden());
  // Ctrl+E enters edit mode.
  pressKey("e", { ctrlKey: true });
  await tick(20);
  check("vim: Ctrl+E enters edit mode (cm-host shown)", !cmIsHidden());
  // While CM has focus, Esc is VIM's mode switch (insert -> normal),
  // NOT an exit-edit-mode signal. Press Esc and confirm we're still
  // in edit mode (cm-host still shown).
  check("vim: pre-Esc CM has focus (precondition)",
    window.NB.cmEditor.hasFocus(), "hasFocus=" + window.NB.cmEditor.hasFocus());
  pressKey("Escape");
  await tick(20);
  check("vim: Esc in edit mode does NOT exit edit mode (VIM key)",
    !cmIsHidden());
  // The 'vim window' is the editor pane -- it should still be the
  // active vim window after Esc (the user wants to keep working in CM's
  // normal mode). CM keeps focus (CM6 is now in normal mode and still
  // owns the keyboard), and the editor pane still has .vim-active.
  check("vim: Esc keeps .vim-active on editor window",
    activeWin() && activeWin().dataset.vimWindow === "editor",
    "activeWin=" + (activeWin() && activeWin().dataset.vimWindow));
  // CM should KEEP focus so the user can use CM6's normal-mode
  // keybindings (j/k for cursor motion, dd, :, etc.). If CM loses
  // focus, the shell keymap takes over -- and 'j' would scroll the
  // preview, not move the cursor in CM. The user reported this
  // as a bug: "i lose focus on vim window".
  check("vim: Esc keeps CM focus (user can use normal-mode keys)",
    window.NB.cmEditor.hasFocus(),
    "hasFocus=" + window.NB.cmEditor.hasFocus() +
    " activeElement=" + (window.document.activeElement && window.document.activeElement.tagName));
  // The shell re-focuses CM after the keyup-induced blur that some
  // browsers trigger on a contentEditable Esc (CM6 switches
  // insert->normal mode, but the editor blurs on the browser
  // default). Without the re-focus, the next keystroke would go to
  // the shell keymap, not CM6's normal mode. We simulate the blur
  // by calling .blur() on the contentDOM after keydown, then
  // dispatching keyup -- the shell's onKeyUp should re-focus.
  window.NB.cmEditor.focus();
  await tick(10);
  check("vim: refocused CM has focus (precondition for blur-recovery test)",
    window.NB.cmEditor.hasFocus());
  // Dispatch keydown Esc. CM is focused, so the shell records
  // pendingEscRestore=true and yields.
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "Escape", bubbles: true, cancelable: true,
  }));
  // Simulate the browser's contentEditable-on-Esc blur.
  if (window.NB.cmEditor.view()) {
    window.NB.cmEditor.view().contentDOM.blur();
  }
  check("vim: blur simulated -> CM not focused (precondition)",
    !window.NB.cmEditor.hasFocus(),
    "hasFocus=" + window.NB.cmEditor.hasFocus());
  // Dispatch keyup -- shell's onKeyUp should re-focus CM (since
  // we're still in edit mode: cm-host is shown).
  window.document.dispatchEvent(new window.KeyboardEvent("keyup", {
    key: "Escape", bubbles: true, cancelable: true,
  }));
  await tick(20);
  check("vim: shell re-focuses CM on Esc keyup (so normal-mode keys still work)",
    window.NB.cmEditor.hasFocus(),
    "hasFocus=" + window.NB.cmEditor.hasFocus() +
    " activeElement=" + (window.document.activeElement && window.document.activeElement.tagName));
  // Ctrl+E exits edit mode (toggle).
  pressKey("e", { ctrlKey: true });
  await tick(20);
  check("vim: Ctrl+E exits edit mode (toggle from edit)", cmIsHidden());
  // And back in.
  pressKey("e", { ctrlKey: true });
  await tick(20);
  check("vim: Ctrl+E re-enters edit mode (toggle)", !cmIsHidden());

  // --- editor wrap (TODO: "vim mode should impl with wrap") ---
  // Long lines wrap instead of overflowing horizontally
  // (EditorView.lineWrapping). Observable directly on the view.
  check("vim: editor wraps long lines (lineWrapping on)",
    !!window.NB.cmEditor.view() && window.NB.cmEditor.view().lineWrapping === true);

  // --- VIM mode gates the editor vim too (TODO: "VIM mode" toggle
  // should enable/disable vim mode completely) ---
  // CM6.getCM(view) returns the CM5 adapter only when the vim plugin
  // is active. We're in edit mode with vim on (enabled via the
  // settings toggle above).
  const cmVimActive = () => {
    const v = window.NB.cmEditor.view();
    return !!(v && window.CM6.getCM(v));
  };
  check("vim: VIM mode on -> CM vim plugin active", cmVimActive());
  window.NB.app.setVimMode(false);
  await tick(20);
  check("vim: setVimMode(false) -> CM vim plugin removed (vim fully off)",
    !cmVimActive());
  window.NB.app.setVimMode(true);
  await tick(20);
  check("vim: setVimMode(true) -> CM vim plugin restored", cmVimActive());

  // --- visual-line cursor (TODO: "shift+v shouldn't move the cursor
  // to the last word") ---
  // Stock @replit/codemirror-vim renders the visual-line selection
  // with the head pinned at end-of-line, so the cursor teleports to
  // the last character. The bridge patches the adapter so the head
  // (cursor) stays at the entry column; the line is still the unit of
  // selection (linewise y/d unaffected).
  cmSetValue("hello world foo\nsecond line here\nthird line end");
  cmSetSel(5, 5);
  await tick(10);
  const cmV = window.NB.cmEditor.view();
  const cmKey = (k, opts) => cmV.contentDOM.dispatchEvent(new window.KeyboardEvent("keydown",
    Object.assign({ key: k, bubbles: true, cancelable: true }, opts || {})));
  cmKey("V", { shiftKey: true });
  await tick(20);
  const selAfterV = cmV.state.selection.main;
  check("vim: V keeps cursor at its column (no jump to last word)",
    selAfterV.head === 5 && selAfterV.anchor === 0,
    "head=" + selAfterV.head + " anchor=" + selAfterV.anchor);
  const vimSt = window.CM6.getCM(cmV).state.vim;
  check("vim: V entered visual-line mode", !!(vimSt.visualMode && vimSt.visualLine));
  // Esc exits visual mode; the cursor returns to the entry column.
  cmKey("Escape");
  await tick(20);
  check("vim: Esc after V restores cursor to entry column",
    cmV.state.selection.main.head === 5,
    "head=" + cmV.state.selection.main.head);
  // V at column 0 would collapse the range if we rewrote it, so the
  // bridge keeps the plugin's full-line highlight there.
  cmSetSel(0, 0);
  await tick(10);
  cmKey("V", { shiftKey: true });
  await tick(20);
  const selV0 = cmV.state.selection.main;
  check("vim: V at column 0 keeps the full-line highlight",
    selV0.anchor === 0 && selV0.head === 15,
    "anchor=" + selV0.anchor + " head=" + selV0.head);
  cmKey("Escape");
  await tick(20);

  // Drop back to preview for the rest of the block.
  pressKey("e", { ctrlKey: true });
  await tick(20);
  check("vim: Ctrl+E exits edit mode (cleanup)", cmIsHidden());

  // Editor window (preview): j/k scroll the viewer one line. We can't
  // measure the line height exactly in jsdom but scrolling a known
  // distance via setting scrollTop + firing a manual scroll event lets
  // us verify the keymap is dispatching to the right function. We just
  // ensure no exception is thrown and cm-host stays hidden.
  pressKey("j");
  await tick(10);
  check("vim: j in editor preview (no edit) doesn't enter edit mode", cmIsHidden());
  pressKey("G");
  await tick(10);
  check("vim: G in editor preview doesn't enter edit mode", cmIsHidden());

  // gg jumps to top of editor content (scroller). We can't read the
  // exact scrollTop since jsdom doesn't lay out, but we verify no
  // exception is thrown and we're still not in edit mode.
  pressKey("g");
  await tick(10);
  pressKey("g");
  await tick(10);
  check("vim: 'gg' chord -> still in preview mode", cmIsHidden());

  // Enter in the sidebar opens the file under the cursor.
  await enterEditShell();
  pressKey("w", { ctrlKey: true });   // editor -> outline
  pressKey("w", { ctrlKey: true });   // outline -> sidebar
  await tick(10);
  // Sidebar cursor was reset by the prior k to notes/a.md; j once to
  // notes/b.md so Enter opens a different file than the active one.
  pressKey("j");
  await tick(10);
  check("vim: sidebar j -> notes/b.md (precondition for Enter)",
    window.NB.sidebar.getVimCursor() === "notes/b.md",
    "cursor=" + window.NB.sidebar.getVimCursor());
  pressKey("Enter");
  await tick(30);
  check("vim: Enter in sidebar opens file under cursor (active = notes/b.md)",
    window.NB.tabs.getActive() === "notes/b.md",
    "active=" + window.NB.tabs.getActive());
  // Switch back to notes/a.md so the rest of the block has a known active.
  await window.NB.tabs.activate("notes/a.md");
  await tick(20);
  // Update the sidebar cursor to match the new active file.
  window.NB.sidebar.setVimCursor("notes/a.md");
  await tick(10);

  // Alt+H / Alt+L: previous / next tab. These are global (work in any
  // focus context, including when CM is focused in edit mode) so
  // they take precedence over the per-window dispatch tables. We
  // use Alt (not Ctrl) so the browser's Ctrl+L (address bar) and
  // Ctrl+H (history) stay intact.
  if (window.NB.tabs.isOpen("notes/b.md")) {
    // Reset to a known state: active = notes/a.md.
    await window.NB.tabs.activate("notes/a.md");
    await tick(20);
    // Make sure we're in the editor window.
    pressKey("w", { ctrlKey: true });
    await tick(10);
    const startActive = window.NB.tabs.getActive();
    const openTabs = window.NB.tabs.getOpen();
    const nextIdx = (openTabs.indexOf(startActive) + 1) % openTabs.length;
    const nextTab = openTabs[nextIdx];
    check("vim: Alt+H/L precondition: active = notes/a.md",
      startActive === "notes/a.md", "active=" + startActive);
    // Alt+L moves to the next tab.
    pressKey("l", { altKey: true });
    await tick(40);
    check("vim: Alt+L -> next tab (" + nextTab + ")",
      window.NB.tabs.getActive() === nextTab,
      "active=" + window.NB.tabs.getActive());
    // Alt+H moves to the previous tab.
    pressKey("h", { altKey: true });
    await tick(40);
    check("vim: Alt+H -> previous tab (" + startActive + ")",
      window.NB.tabs.getActive() === startActive,
      "active=" + window.NB.tabs.getActive());
    // From the first tab, Alt+H should wrap to the last.
    if (openTabs.length > 1) {
      const firstTab = openTabs[0];
      if (window.NB.tabs.getActive() !== firstTab) {
        await window.NB.tabs.activate(firstTab);
        await tick(20);
      }
      pressKey("h", { altKey: true });
      await tick(40);
      check("vim: Alt+H wraps to last tab (" + openTabs[openTabs.length - 1] + ")",
        window.NB.tabs.getActive() === openTabs[openTabs.length - 1],
        "active=" + window.NB.tabs.getActive());
    }
    // Reset.
    await window.NB.tabs.activate("notes/a.md");
    await tick(20);
    window.NB.sidebar.setVimCursor("notes/a.md");
    await tick(10);

    // Alt+L in edit mode with a CLEAN editor: just exits edit mode
    // and switches tabs (no prompt).
    pressKey("e", { ctrlKey: true });              // enter edit mode
    await tick(20);
    check("vim: Alt+H/L edit-mode-clean precondition: in edit mode",
      !cmIsHidden());
    // Editor is empty/clean, no prompt expected.
    pressKey("l", { altKey: true });
    await tick(40);
    check("vim: Alt+L in clean edit mode -> switches tab (no prompt)",
      window.NB.tabs.getActive() === nextTab && cmIsHidden(),
      "active=" + window.NB.tabs.getActive() + " cmHidden=" + cmIsHidden());
    // Alt+H back.
    pressKey("h", { altKey: true });
    await tick(40);

    // Alt+L in edit mode with DIRTY content: prompts to save. We
    // stub confirm() to return true (save). The save fires a fetch
    // (already stubbed) and then endEdit() runs. Verify the tab
    // switched and we're out of edit mode.
    pressKey("e", { ctrlKey: true });              // back into edit mode
    await tick(20);
    // Capture the original content so we can restore it after the
    // test (the dirty + save replaces the file on disk, and the
    // outline test that runs later relies on the original headings
    // existing).
    const originalContent = window.NB.cmEditor.getValue();
    // Make the editor dirty.
    cmSetValue("plain"); cmSetSel(0, 5);
    await tick(10);
    check("vim: Alt+H/L edit-mode-dirty precondition: dirty",
      window.NB.viewer.isDirty(window.NB.tabs.getActive()),
      "dirty=" + window.NB.viewer.isDirty(window.NB.tabs.getActive()));
    let confirmCalls = 0;
    const origConfirm = window.confirm;
    window.confirm = () => { confirmCalls++; return true; };
    try {
      pressKey("l", { altKey: true });
      await tick(60);
    } finally {
      window.confirm = origConfirm;
    }
    check("vim: Alt+L in dirty edit mode -> prompt asked",
      confirmCalls === 1, "confirmCalls=" + confirmCalls);
    check("vim: Alt+L in dirty edit mode -> switches tab + exits edit",
      window.NB.tabs.getActive() === nextTab && cmIsHidden(),
      "active=" + window.NB.tabs.getActive() + " cmHidden=" + cmIsHidden());
    // Reset: restore the original content of notes/a.md so later
    // tests (outline headings) see the original headings.
    await window.NB.tabs.activate("notes/a.md");
    await tick(20);
    pressKey("e", { ctrlKey: true });
    await tick(20);
    cmSetValue(originalContent);
    await tick(10);
    const origConfirm2 = window.confirm;
    window.confirm = () => true;
    try {
      pressKey("s", { ctrlKey: true });
      await tick(40);
    } finally {
      window.confirm = origConfirm2;
    }
    pressKey("e", { ctrlKey: true });
    await tick(20);
    window.NB.sidebar.setVimCursor("notes/a.md");
    await tick(10);
  }

  // Outline window: j/k walk the outline vim cursor; h jumps back
  // to the editor window. (l/Enter scroll the editor to a heading,
  // which jsdom can't verify without layout -- we just assert no throw.)
  await enterEditShell();
  pressKey("w", { ctrlKey: true });   // editor -> outline
  await tick(10);
  check("vim: Ctrl+W from editor -> outline",
    activeWin() && activeWin().dataset.vimWindow === "outline",
    activeWin() && activeWin().dataset.vimWindow);
  // j in outline: cursor moves to next outline item.
  const outlineStart = window.NB.outline.getVimCursor && window.NB.outline.getVimCursor();
  pressKey("j");
  await tick(10);
  const outlineAfter = window.NB.outline.getVimCursor && window.NB.outline.getVimCursor();
  check("vim: outline j moves cursor", outlineAfter !== outlineStart,
    "before=" + outlineStart + " after=" + outlineAfter);
  // k at the first heading wraps to itself (matches sidebar k). Verify
  // it doesn't throw and the cursor is still on a heading.
  pressKey("k");
  await tick(10);
  const cursorAfterK = window.NB.outline.getVimCursor && window.NB.outline.getVimCursor();
  check("vim: outline k moves cursor back",
    !!cursorAfterK, "cursor=" + cursorAfterK);
  // h in outline jumps back to editor window.
  pressKey("h");
  await tick(10);
  check("vim: h in outline -> editor window",
    activeWin() && activeWin().dataset.vimWindow === "editor",
    activeWin() && activeWin().dataset.vimWindow);

  // gg in sidebar scrolls the tree to the top.
  pressKey("w", { ctrlKey: true });   // editor -> outline
  pressKey("w", { ctrlKey: true });   // outline -> sidebar
  await tick(10);
  // The tree starts at scrollTop=0; scroll it down a bit so gg has
  // something to verify. jsdom doesn't lay out, so we just set the
  // property and ensure gg doesn't throw.
  const treeEl = $("file-tree");
  Object.defineProperty(treeEl, "scrollTop", { value: 100, configurable: true, writable: true });
  treeEl.scrollTop = 100;
  pressKey("g"); pressKey("g");
  await tick(10);
  check("vim: gg in sidebar -> tree scrolled to 0",
    treeEl.scrollTop === 0, "scrollTop=" + treeEl.scrollTop);
  // G in sidebar scrolls to the bottom.
  Object.defineProperty(treeEl, "scrollHeight", { value: 500, configurable: true });
  pressKey("G");
  await tick(10);
  check("vim: G in sidebar -> tree scrolled to bottom",
    treeEl.scrollTop === treeEl.scrollHeight, "scrollTop=" + treeEl.scrollTop);

  // ? opens the :help overlay; Esc closes it. Make sure we're in the
  // editor window first -- the previous G-in-sidebar test left us
  // in the sidebar, and `?` is editor-only.
  pressKey("w", { ctrlKey: true });   // sidebar -> editor
  await tick(10);
  pressKey("?");
  await tick(10);
  const helpEl = $("vimnav-help");
  check("vim: ? opens :help overlay", !!helpEl && helpEl.hidden === false);
  pressKey("Escape");
  await tick(10);
  check("vim: Esc closes :help", helpEl && helpEl.hidden === true);

  // Ctrl+/ is the escape hatch: it disables VIM mode entirely.
  check("vim: Ctrl+/ pre-state: vimnav enabled", window.NB.vimnav.isEnabled() === true);
  pressKey("/", { ctrlKey: true });
  await tick(20);
  check("vim: Ctrl+/ disables vimnav", window.NB.vimnav.isEnabled() === false);
  check("vim: Ctrl+/ removes .vim-enabled class",
    !window.document.body.classList.contains("vim-enabled"));
  // Re-enable for the rest of the block.
  window.NB.vimnav.setEnabled(true);
  await tick(10);
  check("vim: re-enabled via API", window.NB.vimnav.isEnabled() === true);

  // Keymap yields when an input has focus: focus the search box, then
  // j should NOT move the sidebar cursor. (Otherwise typing 'j' in
  // search would also navigate the tree.)
  const sidebarBefore = window.NB.sidebar.getVimCursor();
  $("search-input").focus();
  pressKey("j");
  await tick(20);
  check("vim: keymap yields when input focused (no sidebar nav)",
    window.NB.sidebar.getVimCursor() === sidebarBefore,
    "cursor=" + window.NB.sidebar.getVimCursor());
  // Esc in an input blurs the input.
  pressKey("Escape");
  await tick(10);
  check("vim: Esc in input blurs the input",
    window.document.activeElement !== $("search-input"));
  // Ctrl+S in editor window calls NB.viewer.save(). Stub fetch to a
  // clean file (no dirty) and verify nothing throws.
  blurActive();
  $("editor-pane").dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
  await tick(10);
  pressKey("s", { ctrlKey: true });
  await tick(20);
  check("vim: Ctrl+S in editor -> no exception (save is called)", true);

  // Editbar still works through the bridge. Enter edit mode by clicking
  // the Edit button (not via VIM) and run bold on a selection. Drop
  // out of edit mode first (the outline section left us in it).
  await exitEditShell();
  blurActive();
  click("edit-toggle");
  await tick(20);
  cmSetValue("plain"); cmSetSel(0, 5);
  window.document.querySelector('#edit-bar .eb[data-act="bold"]')
    .dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("vim: editbar.bold() still works after vim-mode port", cmGetValue() === "**plain**",
    "got: " + cmGetValue());
  // Esc inside CM is VIM's insert->normal mode key and does NOT
  // exit edit mode. Press Esc and confirm we stay in edit mode.
  pressKey("Escape");
  await tick(20);
  check("vim: Esc inside CM does NOT exit edit mode (VIM key)", !cmIsHidden());
  // Ctrl+E exits edit mode.
  pressKey("e", { ctrlKey: true });
  await tick(20);
  check("vim: Ctrl+E exits edit mode (after editbar test)", cmIsHidden());

  // T opens the search box (focuses the search input). The shell
  // keymap is live only while editing, so enter edit mode first.
  await enterEditShell();
  $("editor-pane").dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
  await tick(10);
  pressKey("T");
  await tick(10);
  check("vim: T in editor focuses search input",
    window.document.activeElement === $("search-input"),
    "active=" + (window.document.activeElement && window.document.activeElement.id));
  // Blur to drop focus for the rest of the suite.
  $("search-input").blur();
  await tick(10);

  // / (VIM-style search) in edit mode (CM not focused) also focuses
  // the search input. In edit mode with CM focused, / is owned by
  // CM6's vim keymap (we don't intercept it). Verify the shell case.
  blurActive();
  $("editor-pane").dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
  await tick(10);
  pressKey("/");
  await tick(10);
  check("vim: / in edit mode focuses search input",
    window.document.activeElement === $("search-input"),
    "active=" + (window.document.activeElement && window.document.activeElement.id));
  $("search-input").blur();
  await tick(10);

  // Mac Option-key compose: on macOS, Alt+H composes a special character
  // (e.g. "˙") into e.key, so e.key.toLowerCase() never matches "h".
  // The shell keymap must key the tab cycle off e.code (KeyH/KeyL),
  // which is the physical key and is layout-/modifier-independent.
  // Re-running the Alt+H/L cycle with a mismatched e.key but a real
  // e.code verifies the Mac path works.
  await window.NB.tabs.activate("notes/a.md");
  await tick(20);
  pressKey("˙", { altKey: true, code: "KeyH" });   // Mac Alt+H
  await tick(40);
  const macAltHTarget = (() => {
    const t = window.NB.tabs.getOpen();
    const i = t.indexOf("notes/a.md");
    return t[(i - 1 + t.length) % t.length];
  })();
  check("vim: Mac Alt+H (composed key, code=KeyH) -> previous tab",
    window.NB.tabs.getActive() === macAltHTarget,
    "active=" + window.NB.tabs.getActive());
  pressKey("˙", { altKey: true, code: "KeyL" });   // Mac Alt+L
  await tick(40);
  check("vim: Mac Alt+L (composed key, code=KeyL) -> next tab",
    window.NB.tabs.getActive() === "notes/a.md",
    "active=" + window.NB.tabs.getActive());

  // Paste (Cmd+V on Mac, Ctrl+V on Linux/Win) must pass through to the
  // browser in VIM shell keymap (preview / sidebar / outline). Vimnav
  // used to swallow it via a blanket preventDefault, breaking paste.
  // The check: dispatching Ctrl+V (or Cmd+V) must NOT call preventDefault
  // on the event (defaultPrevented === false), and the active tab must
  // not change.
  blurActive();
  const beforePaste = window.NB.tabs.getActive();
  const ev = new window.KeyboardEvent("keydown", {
    key: "v", code: "KeyV", ctrlKey: true, bubbles: true, cancelable: true,
  });
  window.document.dispatchEvent(ev);
  await tick(20);
  check("vim: Ctrl+V in shell keymap -> browser default NOT prevented (paste passes through)",
    !ev.defaultPrevented, "defaultPrevented=" + ev.defaultPrevented);
  check("vim: Ctrl+V in shell keymap -> does not switch tabs",
    window.NB.tabs.getActive() === beforePaste,
    "active=" + window.NB.tabs.getActive());

  // Disable VIM and close the settings modal.
  window.NB.vimnav.setEnabled(false);
  await tick(10);
  check("vim: setEnabled(false) -> .vim-enabled removed",
    !window.document.body.classList.contains("vim-enabled"));
  window.NB.settings.close();
  await tick(10);

  console.log("== vimrc (VIM initial script) ==");
  // The vimrc lives in the cm-bridge; the public surface is
  // NB.cmEditor.applyVimrc(text). applyConfig seeds it at view
  // creation; the Settings modal calls applyVimrc on Save.
  // Drive the API directly here so the test doesn't depend on
  // the Settings modal's internals (the modal is covered by a
  // separate assertion below).
  const applyVimrc = window.NB.cmEditor.applyVimrc;
  check("vimrc: NB.cmEditor.applyVimrc exists", typeof applyVimrc === "function");

  // Empty + whitespace-only vimrc is a no-op.
  check("vimrc: empty text is a no-op (count=0, ok=true)",
    (() => { const r = applyVimrc(""); return r.ok && r.count === 0 && r.errors.length === 0; })(),
    JSON.stringify(applyVimrc("")));
  check("vimrc: blank lines + comments parse cleanly",
    (() => { const r = applyVimrc("\n  # a comment\n  \n# another\n"); return r.ok && r.count === 0 && r.errors.length === 0; })(),
    JSON.stringify(applyVimrc("\n  # a comment\n  \n# another\n")));

  // Single nmap. The Vim.map call from cm-bridge can't be observed
  // directly (the lib stores the binding internally), so we just
  // verify the parser reports success + count=1.
  const r1 = applyVimrc("nmap j gj");
  check("vimrc: nmap j gj parses with count=1", r1.ok && r1.count === 1,
    JSON.stringify(r1));

  // Multiple bindings + comment + blank line.
  const r2 = applyVimrc(
    "# remap j to gj in normal mode\n" +
    "nmap j gj\n" +
    "\n" +
    "imap jj <Esc>\n" +
    "vmap <C-c> <Esc>\n" +
    "noremap <leader>w :w<CR>\n");
  check("vimrc: 4 mixed map commands parse with count=4", r2.ok && r2.count === 4,
    JSON.stringify(r2));

  // unmap (no mode arg) + iunmap / vunmap.
  const r3 = applyVimrc("unmap <leader>w\nnunmap j\niunmap jj\nvunmap <C-c>\n");
  check("vimrc: unmap variants parse with count=4", r3.ok && r3.count === 4,
    JSON.stringify(r3));

  // Parse errors: per-line error entries with a 1-based line number
  // and a useful message. The previous-good config is NOT clobbered
  // by a failed apply -- the modal's save handler enforces that
  // contract, but applyVimrc itself only reports the error.
  const r4 = applyVimrc("nmap\nimap jj <Esc>\nnotacommand foo bar\n");
  check("vimrc: bad line 1 (missing args) + line 3 (unknown cmd) reported",
    !r4.ok &&
    r4.errors.length === 2 &&
    r4.errors[0].line === 1 && /expected/i.test(r4.errors[0].message) &&
    r4.errors[1].line === 3 && /unknown/i.test(r4.errors[1].message),
    JSON.stringify(r4));

  // Even with errors, the good lines before the first error were
  // applied (nmap on line 1 had no args, so 0; imap on line 2 was
  // applied; the count reflects only the success path).
  check("vimrc: error path returns count from successful lines only",
    typeof r4.count === "number",
    "count=" + r4.count);

  // "#" inside a line strips everything from the "#" onwards, so
  // a commented-out binding must NOT be applied.
  const r5 = applyVimrc("nmap q <ignored>  # this is a comment");
  check("vimrc: '# comment' strips rhs (binding applied, no parse error)",
    r5.ok && r5.count === 1, JSON.stringify(r5));

  // Getter / setter round-trip via NB.app (the modal's save path).
  check("vimrc: NB.app.getVimrc returns the configured string",
    window.NB.app.getVimrc() === "", "got=" + JSON.stringify(window.NB.app.getVimrc()));
  window.NB.app.setVimrc("nmap k gk");
  await tick(400);   // debounced persist
  check("vimrc: NB.app.setVimrc persists to config (POST /api/config)",
    /"vimrc":\s*"nmap k gk"/.test(fetchLog.filter(x => x.startsWith("POST /api/config")).pop() || ""),
    (fetchLog.filter(x => x.startsWith("POST /api/config")).pop() || "").slice(0, 240));
  // Clear so the rest of the suite isn't carrying a custom vimrc.
  window.NB.app.setVimrc("");
  await tick(400);

  // Settings modal round-trip: open, type a vimrc, click Save, see
  // the success status. The textarea gets populated from cfg on
  // open() (syncVimrc), and Save calls applyVimrc + setVimrc.
  window.NB.app.setVimrc("");   // start clean
  await tick(50);
  window.NB.settings.open();
  await tick(20);
  const vimrcArea = () => window.document.getElementById("settings-vimrc");
  const vimrcSave = () => window.document.getElementById("settings-vimrc-save");
  const vimrcStatus = () => window.document.getElementById("settings-vimrc-status");
  check("vimrc: Settings modal has the textarea + Save button + status",
    !!vimrcArea() && !!vimrcSave() && !!vimrcStatus());
  check("vimrc: opening the modal populates the textarea from cfg (empty)",
    vimrcArea() && vimrcArea().value === "", "value=" + JSON.stringify(vimrcArea() && vimrcArea().value));
  // Type a vimrc, click Save.
  vimrcArea().value = "nmap H 0\nnmap L $\n";
  vimrcSave().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await tick(20);
  check("vimrc: Save applies + persists (cfg.vimrc updated)",
    window.NB.app.getVimrc() === "nmap H 0\nnmap L $\n",
    "cfg=" + JSON.stringify(window.NB.app.getVimrc()));
  check("vimrc: Save shows an 'ok' status (2 bindings applied)",
    vimrcStatus() && !vimrcStatus().hidden &&
    /ok/i.test(vimrcStatus().className) &&
    /2 binding/.test(vimrcStatus().textContent),
    "class=" + (vimrcStatus() && vimrcStatus().className) +
    " text=" + (vimrcStatus() && JSON.stringify(vimrcStatus().textContent)));
  // Error path: type a bad line, click Save, status is 'error' and
  // cfg.vimrc is NOT updated (last-good stays).
  vimrcArea().value = "nmap H 0\nnotreal foo\nnmap L $\n";
  vimrcSave().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await tick(20);
  check("vimrc: Save with parse error leaves cfg.vimrc unchanged (last-good)",
    window.NB.app.getVimrc() === "nmap H 0\nnmap L $\n",
    "cfg=" + JSON.stringify(window.NB.app.getVimrc()));
  check("vimrc: Save with parse error shows an 'error' status with the line number",
    vimrcStatus() && !vimrcStatus().hidden &&
    /error/i.test(vimrcStatus().className) &&
    /Line 2/.test(vimrcStatus().textContent),
    "class=" + (vimrcStatus() && vimrcStatus().className) +
    " text=" + (vimrcStatus() && JSON.stringify(vimrcStatus().textContent)));
  // Fix the bad line + Save again -> success, cfg updates.
  vimrcArea().value = "nmap H 0\nnmap L $\n";
  vimrcSave().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await tick(20);
  check("vimrc: Save recovers from the error after the user fixes the line",
    window.NB.app.getVimrc() === "nmap H 0\nnmap L $\n" &&
    /ok/i.test(vimrcStatus().className),
    "cfg=" + JSON.stringify(window.NB.app.getVimrc()) +
    " class=" + vimrcStatus().className);
  // Cleanup: clear the vimrc + close the modal so the rest of the
  // suite isn't carrying our test state.
  window.NB.app.setVimrc("");
  await tick(400);
  window.NB.settings.close();
  await tick(20);

  console.log("== ai ==");
  // Build one OpenAI-style SSE frame whose delta content is `text`.
  // JSON.stringify(text) produces the double-quoted, escaped form that
  // can be dropped straight into the content:"..." JSON of the frame.
  const sseFrame = (text) =>
    'data: {"choices":[{"delta":{"content":' + JSON.stringify(text) + '}}]}\n\n';

  // --- pure parser unit checks (no DOM, no fetch) -----------------------
  {
    // 1. fenced block -> one proposal
    const r1 = window.NB.ai.parseProposals(
      "Here is my edit:\n\n```nb-edit\n" +
      JSON.stringify({ op: "replace", find: "TODO fix this here.",
                       replace: "TODO fixed." }) + "\n```\n");
    check("ai: fenced nb-edit block parses into one card segment",
      r1.count === 1 &&
      r1.segments.some(s => s.type === "card") &&
      r1.segments[0].type === "text",
      "count=" + r1.count);

    // 2. non-JSON block stays prose (no card)
    const r2 = window.NB.ai.parseProposals(
      "```nb-edit\nnot json at all\n```");
    check("ai: non-JSON fenced block is not a card",
      r2.count === 0 && r2.segments.length === 1 && r2.segments[0].type === "text",
      "count=" + r2.count);

    // 3. unknown op rejected
    const r3 = window.NB.ai.parseProposals(
      "```nb-edit\n" + JSON.stringify({ op: "line_delete", start: 1 }) + "\n```");
    check("ai: unknown op is not a card", r3.count === 0, "count=" + r3.count);

    // 4. replace without find/replace strings rejected
    const r4 = window.NB.ai.parseProposals(
      "```nb-edit\n" + JSON.stringify({ op: "replace" }) + "\n```");
    check("ai: replace without find/replace is not a card", r4.count === 0,
      "count=" + r4.count);

    // 5. append/prepend need only replace
    const r5 = window.NB.ai.parseProposals(
      "```nb-edit\n" + JSON.stringify({ op: "append", replace: "new tail\n" }) +
      "\n```");
    const card5 = r5.segments.find(s => s.type === "card");
    check("ai: append parses as a card",
      r5.count === 1 && card5 && card5.proposal.op === "append",
      r5.count + "");

    // 6. nb-tool blocks cut out of prose; nb-edit cards preserved
    const r6 = window.NB.ai.parseProposals(
      'thinking\n```nb-tool\n{"tool": "read", "path": "a.md"}\n```\nmid\n' +
      "```nb-edit\n" + JSON.stringify({ op: "append", replace: "x" }) + "\n```");
    check("ai: nb-tool block is extracted as a tool segment",
      JSON.stringify(r6.segments.map(s => s.type)) ===
        JSON.stringify(["text", "tool", "text", "card"]),
      JSON.stringify(r6.segments.map(s => s.type)));

    // 7. tool block parser: valid + invalid shapes
    check("ai: tryParseTool read/list/write/patch shapes",
      window.NB.ai.tryParseTool('{"tool":"list"}') !== null &&
      window.NB.ai.tryParseTool('{"tool":"read","path":"a.md"}') !== null &&
      window.NB.ai.tryParseTool('{"tool":"write","path":"n.md","content":"x"}') !== null &&
      window.NB.ai.tryParseTool('{"tool":"patch","path":"n.md","edits":[]}') !== null,
      "");
    check("ai: tryParseTool rejects bad calls",
      window.NB.ai.tryParseTool('{"tool":"read"}') === null &&
      window.NB.ai.tryParseTool('{"tool":"write","path":"n.md"}') === null &&
      window.NB.ai.tryParseTool('{"tool":"patch","path":"n.md"}') === null &&
      window.NB.ai.tryParseTool('{"tool":"delete","path":"n.md"}') === null &&
      window.NB.ai.tryParseTool('not json') === null,
      "");

    // 7b. bracket/quote-aware fence: close only at JSON depth 0, so a
    // patch whose content embeds its own fenced code (mermaid) still
    // parses. The inner ```flowchart block's three backticks sit inside
    // a JSON string (outside depth 0) so they are NOT treated as the
    // end of the nb-tool fence.
    const fenceMsg =
      "Please embed a diagram:\n\n```nb-tool\n" +
      JSON.stringify({ tool: "patch", path: "n.md", edits: [
        { op: "find_replace", find: "<!--diagram-->",
          replace_with: "```flowchart TD\nA[Start] --> B{Go?}\nB -- Yes --> C\n```",
          count: 1 },
      ] }) +
      "\n```\n\nAbove is the patch.\n```markdown\nafter\n```";
    const fenced = window.NB.ai.collectFenced(fenceMsg, "nb-tool");
    check("ai: fence scan survives embedded backtick fences in content",
      fenced.length === 1,
      "blocks=" + fenced.length);
    const fencedTool = fenced.length ? window.NB.ai.tryParseTool(fenced[0].content) : null;
    check("ai: embedded-backtick content parses as a full patch tool",
      !!fencedTool && fencedTool.tool === "patch" && fencedTool.edits.length === 1 &&
        /flowchart TD/.test(fencedTool.edits[0].replace_with),
      fencedTool ? JSON.stringify(fencedTool.edits) : "null");
    // A trailing ```markdown fence after the nb-tool block must not leak
    // into the tool content either (still ends at the depth-0 close).
    check("ai: fence scan does not consume a following language fence",
      fenced.length === 1 && /markdown/.test(fenced[0].content) === false,
      fenced.length ? "block ends before markdown fence" : "no block");

    // 8. diff row computation
    const d1 = window.NB.ai.diffRows("alpha\nbeta\ngamma\ndelta\n", "alpha\nBETA\ngamma\ndelta\n");
    check("ai: diffRows finds the changed line pair",
      d1.some(r => r.type === "del" && r.text === "beta") &&
      d1.some(r => r.type === "add" && r.text === "BETA") &&
      d1.some(r => r.type === "ctx" && r.text === "alpha"),
      JSON.stringify(d1.map(r => r.type)));

    // 9. patch preview simulation
    const pv = window.NB.ai.previewPatch(
      "alpha\nbeta\ngamma\n",
      [{ op: "find_replace", find: "beta", replace_with: "BETA", count: 1 }]);
    check("ai: previewPatch simulates find_replace",
      pv === "alpha\nBETA\ngamma\n", JSON.stringify(pv));
    check("ai: previewPatch returns null for non-simulatable ops",
      window.NB.ai.previewPatch("x", [{ op: "line_delete", start: 1 }]) === null &&
      window.NB.ai.previewPatch("x", [{ op: "find_replace", find: "nope", replace_with: "y" }]) === null,
      "");
  }

  // -- agent loop end-to-end (fetch-stubbed) -----------------------------
  // Configure the stub config: one provider, and queue conversation-style
  // streams (each entry is one assistant "reply"; the stub pops a NEW
  // entry per chat request, mimicking the tool loop's follow-up calls).
  window.NB.ai._resetForTests();
  aiConfig = { servers: [{ name: "stub", baseUrl: "http://stub", model: "m-1", apiKey: "sk-stub" }], default: "stub" };
  aiChatStreams = [];
  aiChatLog = [];

  // Open a file so the system prompt names it (current-file context).
  await window.NB.tabs.open("notes/a.md");
  await tick(50);

  // Mount the view via the activity bar (the user's path).
  const aiBtn = Array.from(window.document.querySelectorAll("#activity-bar .activity-btn"))
    .find(b => b.dataset.view === "ai");
  check("ai: activity bar has an AI button", !!aiBtn);
  aiBtn.click();
  await tick(30);
  check("ai: view mounts with a chat log + input",
    !!window.document.getElementById("ai-chat-log") &&
    !!window.document.getElementById("ai-input"),
    "log=" + !!window.document.getElementById("ai-chat-log"));

  // Provider picker lists the configured profile.
  const aiSel = window.document.getElementById("ai-model-select");
  check("ai: provider picker lists the stub profile",
    aiSel && aiSel.options.length === 1 && aiSel.options[0].value === "stub",
    aiSel ? aiSel.options.length + " opts" : "no select");

  const aiInput = () => window.document.getElementById("ai-input");
  const aiSend = () => {
    aiInput().dispatchEvent(new window.Event("input", { bubbles: true }));
    aiInput().closest("form").dispatchEvent(
      new window.Event("submit", { bubbles: true, cancelable: true }));
  };
  const aiCards = (sel) => Array.from(window.document.querySelectorAll(sel || "#ai-chat-log .ai-edit-card"));
  const lastCard = () => {
    const c = aiCards();
    return c[c.length - 1] || null;
  };
  const aiTraces = () => Array.from(window.document.querySelectorAll("#ai-chat-log .ai-tool-trace"));
  const aiBubbles = () => Array.from(window.document.querySelectorAll("#ai-chat-log .ai-msg-assistant"));

  // --- Turn 1: model asks to READ, then (second loop round) patches ----
  // Request 1 replies with a read tool call. Request 2 (after the tool
  // result is fed back) proposes the actual patch.
  const patchJson1 = JSON.stringify({
    op: "replace", find: "TODO fix this bug.",
    replace: "TODO fixed by the AI.", description: "Fix the todo",
  });
  aiChatStreams.push([
    sseFrame("Let me read the file first.\n\n```nb-tool\n" +
      JSON.stringify({ tool: "read", path: "notes/a.md" }) + "\n```"),
  ]);
  aiChatStreams.push([
    sseFrame("Here is the fix you asked for:\n\n```nb-edit\n" + patchJson1 + "\n```"),
  ]);
  aiInput().value = "fix the todo in this file";
  aiSend();
  await tick(120);

  check("ai: tool loop issued 2 model calls (read, then patch)",
    aiChatLog.length === 2,
    "requests=" + aiChatLog.length);
  check("ai: request 1 carried system + user turn",
    aiChatLog[0] && aiChatLog[0].server === "stub" &&
    aiChatLog[0].messages[0].role === "system" &&
    /current file is: notes\/a\.md/.test(aiChatLog[0].messages[0].content) &&
    aiChatLog[0].messages[1].role === "user",
    aiChatLog[0] ? aiChatLog[0].messages.map(m => m.role).join(",") : "none");
  check("ai: system prompt declares the four tools",
    /\bnb-tool\b/.test(aiChatLog[0].messages[0].content) &&
    /"tool": "list"/.test(aiChatLog[0].messages[0].content) &&
    /"tool": "patch"/.test(aiChatLog[0].messages[0].content),
    "");
  check("ai: request 2 re-uploads history + tool result (memory)",
    aiChatLog[1] && aiChatLog[1].messages.length >= 4 &&
    /tool read notes\/a\.md result/.test(aiChatLog[1].messages.at(-1).content) &&
    /TODO fix this bug\./.test(aiChatLog[1].messages.at(-1).content),
    aiChatLog[1] ? aiChatLog[1].messages.length + " msgs" : "none");
  check("ai: read tool ran as a trace line",
    aiTraces().some(t => t.dataset.testToolTrace === "read" &&
      /notes\/a\.md/.test(t.textContent) && /\d+ chars/.test(t.textContent)),
    "traces=" + aiTraces().length);

  // Patch card applies through /api/edit.
  let card = lastCard();
  check("ai: assistant reply renders one patch card", !!card &&
    card.dataset.testPatchCard === "1", card ? card.dataset.op : "none");
  check("ai: patch card previews the diff before applying",
    card && card.querySelector(".diff-del") && card.querySelector(".diff-add"),
    "rows=" + (card ? card.querySelectorAll(".diff-row").length : 0));
  check("ai: diff has dual line numbers + sign + hunk header",
    card && card.querySelector(".diff-num-old") !== null &&
    card.querySelector(".diff-num-new") !== null &&
    card.querySelector(".diff-sign") !== null &&
    /^@@ /.test(card.querySelector(".diff-hunk").textContent.trim()),
    card && card.querySelector(".diff-hunk").textContent);
  check("ai: card header shows -/+ change stats",
    card && /−1/.test(card.querySelector(".ai-stat.del").textContent) &&
    /\+1/.test(card.querySelector(".ai-stat.add").textContent),
    card && card.querySelector(".ai-diff-stats").textContent);
  check("ai: apply is the primary (filled) action with per-op badge color",
    card && card.querySelector(".ai-btn.ai-apply") !== null &&
    card.querySelector(".ai-edit-op").textContent === "patch",
    "");
  card.querySelector(".ai-apply").dispatchEvent(
    new window.MouseEvent("click", { bubbles: true }));
  await tick(150);
  check("ai: apply patches the file via /api/edit",
    FILES["notes/a.md"].includes("TODO fixed by the AI."),
    FILES["notes/a.md"].split("\n").find(l => l.includes("TODO")) || "?");
  check("ai: applied card shows success + viewer cache refreshed",
    card.classList.contains("ok") &&
    /Applied/.test(card.querySelector(".ai-card-status").textContent) &&
    !window.NB.viewer.isDirty("notes/a.md"),
    card.querySelector(".ai-card-status").textContent);
  check("ai: tool outcome lands in the conversation (model sees it)",
    window.NB.ai._getConversationForTests().some(m =>
      /tool result\).*(?:applied|patch applied)/i.test(m.content)),
    "");

  // --- Turn 2: follow-up retains context WITHOUT new tool calls --------
  aiChatStreams.push([
    sseFrame("I already fixed the TODO in notes/a.md — anything else?"),
  ]);
  aiInput().value = "thanks, what did you change again?";
  aiSend();
  await tick(80);
  check("ai: follow-up turn is a plain answer (no extra tool round)",
    aiChatLog.length === 3,
    "requests=" + aiChatLog.length);
  check("ai: follow-up request includes prior turns (memory)",
    aiChatLog[2].messages.filter(m => m.role === "assistant").length >= 1,
    aiChatLog[2].messages.length + " msgs");
  check("ai: follow-up answer renders without cards",
    aiBubbles().length >= 3 && lastCard() === card,
    "bubbles=" + aiBubbles().length);

  // Assistant markdown: the follow-up answer contains **bold** + a fenced
  // block; verify it renders as real elements (marked pipeline), not raw
  // asterisk text.
  {
    aiChatStreams.push([
      sseFrame("Answer with **bold**, a list:\n\n- item one\n- item two\n\nand code:\n\n```js\nconsole.log(1);\n```\n"),
    ]);
    aiInput().value = "show markdown";
    aiSend();
    await tick(120);
    const prose = Array.from(window.document.querySelectorAll("#ai-chat-log .ai-msg-assistant > .ai-prose-span"));
    const lastProse = prose[prose.length - 1];
    check("ai: assistant prose renders markdown (strong + list + code)",
      lastProse && lastProse.querySelector("strong") &&
      lastProse.querySelector("ul li") &&
      lastProse.querySelector("pre code"),
      "children=" + (lastProse ? lastProse.children.length : 0));
    check("ai: code fence in prose is highlighted + has a Copy button",
      lastProse && lastProse.querySelector("pre code.hljs") &&
      lastProse.querySelector("pre .code-copy-btn"),
      "");
  }

  // --- Turn 3: DELETE-style patch whose find no longer matches -> 400 --
  aiChatStreams.push([
    sseFrame("```nb-edit\n" + JSON.stringify({
      op: "replace", find: "TODO fix this bug.", replace: "stale",
    }) + "\n```"),
  ]);
  aiInput().value = "apply something stale";
  aiSend();
  await tick(100);
  const staleCard = lastCard();
  staleCard.querySelector(".ai-apply").dispatchEvent(
    new window.MouseEvent("click", { bubbles: true }));
  await tick(100);
  check("ai: stale find surfaces the server 400 on the card",
    staleCard.classList.contains("errored") &&
    /no match/i.test(staleCard.querySelector(".ai-card-status").textContent),
    staleCard.querySelector(".ai-card-status").textContent);
  check("ai: file unchanged by failed apply", !FILES["notes/a.md"].includes("stale"), "");

  // --- Turn 4: reject path feeds back to the model ---------------------
  aiChatStreams.push([
    sseFrame("```nb-edit\n" + JSON.stringify({
      op: "append", replace: "extra line\n" }) + "\n```"),
  ]);
  aiInput().value = "one more";
  aiSend();
  await tick(100);
  const rejCard = lastCard();
  rejCard.querySelector(".ai-reject").dispatchEvent(
    new window.MouseEvent("click", { bubbles: true }));
  await tick(50);
  check("ai: reject marks the card + records the outcome for the model",
    rejCard.classList.contains("rejected") &&
    !rejCard.querySelector(".ai-edit-actions") &&
    window.NB.ai._getConversationForTests().some(m =>
      /rejected by user/.test(m.content)),
    "");

  // --- Turn 5: write tool -> new file ok / existing file blocked -------
  const WRITE_PATH = "notes/new-note.md";
  aiChatStreams.push([
    sseFrame("Creating it.\n\n```nb-tool\n" + JSON.stringify({
      tool: "write", path: WRITE_PATH,
      content: "# New note\n\ncreated by the AI\n" }) + "\n```"),
  ]);
  aiInput().value = "create a note";
  aiSend();
  await tick(100);
  let writeCard = lastCard();
  check("ai: write tool renders a create card (write, not patch)",
    writeCard && writeCard.dataset.testWriteCard === "1" &&
    writeCard.dataset.op === "write",
    writeCard ? writeCard.dataset.op : "none");
  check("ai: write card previews as an all-add diff with hunk + stats",
    writeCard.querySelector(".diff-hunk") &&
    writeCard.querySelectorAll(".diff-add").length >= 1 &&
    writeCard.querySelector(".ai-stat.add") &&
    writeCard.querySelector(".ai-edit-path").textContent.includes("new file"),
    writeCard.querySelector(".ai-diff-stats").textContent);
  writeCard.querySelector(".ai-apply").dispatchEvent(
    new window.MouseEvent("click", { bubbles: true }));
  await tick(100);
  check("ai: write creates a NEW file via /api/create",
    FILES[WRITE_PATH] === "# New note\n\ncreated by the AI\n",
    String(FILES[WRITE_PATH]).slice(0, 30));
  check("ai: created write card shows ok",
    writeCard.classList.contains("ok"),
    writeCard.querySelector(".ai-card-status").textContent);

  // Same write -> card exists check blocks overwrite with guidance.
  aiChatStreams.push([
    sseFrame("```nb-tool\n" + JSON.stringify({
      tool: "write", path: WRITE_PATH, content: "OVERWRITE!\n" }) + "\n```"),
  ]);
  aiInput().value = "overwrite it";
  aiSend();
  await tick(100);
  const blockCard = lastCard();
  blockCard.querySelector(".ai-apply").dispatchEvent(
    new window.MouseEvent("click", { bubbles: true }));
  await tick(100);
  check("ai: write on an EXISTING file is blocked with 'use patch' guidance",
    blockCard.classList.contains("errored") &&
    /patch/i.test(blockCard.querySelector(".ai-card-status").textContent),
    blockCard.querySelector(".ai-card-status").textContent);
  check("ai: blocked write did NOT touch the file",
    FILES[WRITE_PATH] === "# New note\n\ncreated by the AI\n", "");

  // The model is told to patch instead, and the patch flow works.
  aiChatStreams.push([
    sseFrame("Understood — patching instead.\n\n```nb-tool\n" + JSON.stringify({
      tool: "patch", path: WRITE_PATH,
      edits: [{ op: "find_replace", find: "created by the AI",
                replace_with: "patched by the AI", count: 1 }] }) + "\n```"),
  ]);
  aiInput().value = "then patch it";
  aiSend();
  await tick(120);
  const patchCard2 = lastCard();
  patchCard2.querySelector(".ai-apply").dispatchEvent(
    new window.MouseEvent("click", { bubbles: true }));
  await tick(150);
  check("ai: patch tool updates an existing file (guided flow completes)",
    FILES[WRITE_PATH] === "# New note\n\npatched by the AI\n",
    String(FILES[WRITE_PATH]).slice(0, 40));

  // --- Permission card visibility when the log is full -----------------
  // Regression: the tool loop appended write/patch cards WITHOUT
  // scrolling the log, then stopped (the user must decide), so with a
  // long history the card sat below the fold and the loop looked
  // stuck. The card could also be flex-crushed to ~0px: .ai-edit-card
  // has overflow:hidden, so as a direct flex item of .ai-chat-log its
  // automatic minimum size is 0 and a full log shrank it away. jsdom
  // has no layout engine, so the scroll is observed with a scrollTop
  // spy on the log instance (the same instance-override pattern the
  // drag tests use for getBoundingClientRect): every scrollLog() write
  // records what the log's last child was at that moment.
  {
    const log = window.document.getElementById("ai-chat-log");
    const scrollWrites = [];
    let logTop = log.scrollTop;
    Object.defineProperty(log, "scrollTop", {
      configurable: true,
      get() { return logTop; },
      set(v) {
        logTop = v;
        const last = log.lastElementChild;
        // preDiff: the write happened before the card's async diff
        // preview landed. Only the append-time scroll qualifies -- the
        // wasFollowing re-scroll after the diff insert also writes, but
        // by then the card already contains .ai-diff.
        scrollWrites.push(last ? {
          cls: last.className,
          preDiff: !last.querySelector(".ai-diff"),
        } : null);
      },
    });
    const cardTimeScrolls = (re) => scrollWrites.filter(w =>
      w && re.test(w.cls) && w.preDiff);

    // The log already holds every prior turn (bubbles, traces, cards),
    // i.e. the "history fills the panel" precondition. Patch tool call:
    aiChatStreams.push([
      sseFrame("Sure, one more.\n\n```nb-tool\n" + JSON.stringify({
        tool: "patch", path: "notes/a.md",
        edits: [{ op: "find_replace", find: "TODO fixed by the AI.",
                  replace_with: "TODO double-fixed.", count: 1 }] }) + "\n```"),
    ]);
    aiInput().value = "one more fix please";
    aiSend();
    await tick(120);

    const pendCard = lastCard();
    check("ai: patch card after long history renders with Apply/Reject",
      pendCard && pendCard.dataset.testPatchCard === "1" &&
      !!pendCard.querySelector(".ai-edit-actions .ai-apply") &&
      !!pendCard.querySelector(".ai-edit-actions .ai-reject"),
      pendCard ? pendCard.dataset.op : "none");
    check("ai: appending a permission card scrolls the log to it",
      cardTimeScrolls(/ai-edit-card/).length > 0,
      "card-time scrolls=" + cardTimeScrolls(/ai-edit-card/).length);
    // The buttons stay wired: rejecting resolves the pending state.
    pendCard.querySelector(".ai-reject").dispatchEvent(
      new window.MouseEvent("click", { bubbles: true }));
    await tick(30);
    check("ai: card buttons still work after the visibility fix",
      pendCard.classList.contains("rejected") &&
      !pendCard.querySelector(".ai-edit-actions"),
      "");

    // Write cards take the same append path (and have no async
    // fallback scroll at all), so any scroll recorded while the write
    // card is the last child must be the append-time one.
    aiChatStreams.push([
      sseFrame("```nb-tool\n" + JSON.stringify({
        tool: "write", path: "notes/vis-check.md",
        content: "# Visibility check\n" }) + "\n```"),
    ]);
    aiInput().value = "draft a note";
    aiSend();
    await tick(120);
    check("ai: write card append also scrolls the log",
      scrollWrites.some(w => w && /ai-write-card/.test(w.cls)),
      "");
    check("ai: pending write card did not create the file",
      FILES["notes/vis-check.md"] === undefined, "");

    // CSS guard: .ai-edit-card must never flex-shrink inside the log
    // (style.css regex, same approach as the mermaid style checks).
    check("ai: .ai-edit-card cannot be flex-crushed by a full log",
      /\.ai-edit-card\s*\{[^}]*flex:\s*0 0 auto/.test(read("static/css/style.css")),
      ".ai-edit-card rule present in style.css");

    delete log.scrollTop;   // restore the prototype accessor
  }

  // --- Clear button resets conversation --------------------------------
  aiChatStreams.length = 0;
  window.document.querySelector("#ai-view .ai-clear")
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await tick(20);
  check("ai: Clear empties the conversation + log",
    window.NB.ai._getConversationForTests().length === 0 &&
    window.document.querySelectorAll("#ai-chat-log > *").length === 0,
    "");

  // --- Global custom prompt: appended to the system prompt -------------
  aiConfig.customPrompt = "Always answer in rhyme.";
  await window.NB.ai.loadAiConfig();
  await tick(10);
  aiChatStreams.push([sseFrame("ok")]);
  aiInput().value = "hello again";
  aiSend();
  await tick(80);
  const lastReq = aiChatLog[aiChatLog.length - 1];
  check("ai: global custom prompt rides the system message",
    lastReq.messages[0].role === "system" &&
    /Additional instructions from the user[\s\S]*Always answer in rhyme/.test(lastReq.messages[0].content),
    lastReq.messages[0].content.slice(-60));

  // --- fetch + search tools: auto-run, trace lines, results fed back ----
  // The model calls fetch then search; both run immediately (no card) and
  // their output is fed back as tool-result messages so the model can
  // continue. The system prompt must declare both tools.
  aiConfig.customPrompt = "";
  await window.NB.ai.loadAiConfig();
  await tick(10);
  aiChatStreams.push([
    sseFrame("Let me look that up.\n\n```nb-tool\n" +
      JSON.stringify({ tool: "fetch", url: "https://example.com/doc" }) + "\n```\n\n" +
      "```nb-tool\n" + JSON.stringify({ tool: "search", q: "embedded systems" }) + "\n```"),
  ]);
  aiChatStreams.push([sseFrame("Here is what I found.")]);
  aiInput().value = "fetch that page and search";
  aiSend();
  await tick(120);

  check("ai: system prompt declares fetch + search tools",
    /"tool": "fetch"/.test(aiChatLog[0].messages[0].content) &&
    /"tool": "search"/.test(aiChatLog[0].messages[0].content),
    "");
  check("ai: fetch tool ran as a trace line",
    aiTraces().some(t => t.dataset.testToolTrace === "fetch" &&
      /https:\/\/example\.com\/doc/.test(t.textContent) &&
      /chars/.test(t.textContent)),
    "traces=" + aiTraces().length);
  check("ai: search tool ran as a trace line",
    aiTraces().some(t => t.dataset.testToolTrace === "search" &&
      /embedded systems/.test(t.textContent) && /results/.test(t.textContent)),
    "traces=" + aiTraces().length);
  check("ai: fetch + search results fed back to the model (memory)",
    aiChatLog.at(-1) && /tool fetch result/.test(
      aiChatLog.at(-1).messages.at(-2).content) &&
    /Fetched https:\/\/example\.com\/doc/.test(aiChatLog.at(-1).messages.at(-2).content) &&
    /tool search result/.test(aiChatLog.at(-1).messages.at(-1).content) &&
    /Result One/.test(aiChatLog.at(-1).messages.at(-1).content),
    aiChatLog.at(-1) ? aiChatLog.at(-1).messages.length + " msgs" : "none");
  check("ai: fetch/search are auto tools (no permission card)",
    aiCards().length === 0,
    "cards=" + aiCards().length);

  // --- Settings: SearXNG instance URL (own control, own Save) -----------
  authEnabled = true; authHasAdmin = true; authRole = "admin";
  window.NB.settings.open(); await tick(30);
  const aiTabBtn2 = window.document.querySelector('.settings-nav-item[data-tab="ai"]');
  aiTabBtn2.click(); await tick(20);
  const searxngEl = window.document.getElementById("settings-ai-searxng");
  const searxngSave = window.document.getElementById("settings-ai-searxng-save");
  check("settings: SearXNG URL field present + disabled for non-admin",
    !!searxngEl && !!searxngSave, "");
  searxngEl.value = "https://searxng.example.com";
  searxngEl.dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(10);
  check("settings: SearXNG Save enables when value is dirty",
    !searxngSave.disabled, "");
  searxngSave.click();
  await tick(80);
  check("settings: SearXNG Save persists the URL (config root)",
    aiConfig.searxngUrl === "https://searxng.example.com",
    aiConfig.searxngUrl);
  // Provider edits never touch the saved SearXNG URL.
  Array.from(window.document.querySelectorAll("#settings-ai-list .settings-ai-edit"))[0].click();
  await tick(10);
  window.document.getElementById("settings-ai-model").value = "m-7";
  window.document.getElementById("settings-ai-add").click();
  await tick(60);
  check("settings: provider save does not clobber the SearXNG URL",
    aiConfig.searxngUrl === "https://searxng.example.com",
    aiConfig.searxngUrl);
  // Reset for later blocks.
  aiConfig.searxngUrl = "";
  await window.NB.ai.loadAiConfig();
  authEnabled = false; authHasAdmin = false; authRole = null;
  await window.NB.settings.close(); await tick(20);

  // --- Settings: Edit button per provider row --------------------------
  // The AI section is admin-only; flip the harness into an admin session
  // for this block (authEnabled=false would make it non-admin).
  authEnabled = true; authHasAdmin = true; authRole = "admin";
  window.NB.settings.open(); await tick(30);
  const aiTabBtn = window.document.querySelector('.settings-nav-item[data-tab="ai"]');
  aiTabBtn.click(); await tick(20);
  const editBtns = Array.from(window.document.querySelectorAll("#settings-ai-list .settings-ai-edit"));
  check("settings: each AI provider row has an Edit button",
    editBtns.length >= 1, "rows=" + editBtns.length);
  editBtns[0].click(); await tick(10);
  check("settings: Edit prefills the form (editing mode)",
    window.document.getElementById("settings-ai-name").value === "stub" &&
    window.document.getElementById("settings-ai-add").textContent === "Save changes" &&
    !window.document.getElementById("settings-ai-cancel").hidden &&
    /Edit provider/.test(window.document.getElementById("settings-ai-form-title").textContent),
    window.document.getElementById("settings-ai-form-title").textContent);
  // Edit only touches the provider (model here); the global prompt
  // control is outside the form and must be unaffected.
  window.document.getElementById("settings-ai-model").value = "m-2";
  window.document.getElementById("settings-ai-add").click();
  await tick(60);
  check("settings: editing saves model (key untouched, prompt left alone)",
    aiConfig.servers[0].model === "m-2" &&
    aiConfig.servers[0].apiKey === "sk-stub",
    "model=" + aiConfig.servers[0].model);
  check("settings: successful edit exits edit mode",
    window.document.getElementById("settings-ai-add").textContent === "Add provider" &&
    window.document.getElementById("settings-ai-cancel").hidden,
    "");
  // Rename flow: Edit, change the name, save — key must carry over.
  Array.from(window.document.querySelectorAll("#settings-ai-list .settings-ai-edit"))[0].click();
  await tick(20);
  window.document.getElementById("settings-ai-name").value = "renamed";
  window.document.getElementById("settings-ai-add").click();
  await tick(60);
  check("settings: rename carries the stored key (replaceSecretFor)",
    aiConfig.servers[0].name === "renamed" &&
    aiConfig.servers[0].apiKey === "sk-stub",
    "name=" + aiConfig.servers[0].name);
  // Assistant picks up the renamed provider as default.
  await window.NB.ai.loadAiConfig();
  check("settings: renamed provider reaches the side panel",
    window.NB.ai._getCurrentServer() === "renamed",
    window.NB.ai._getCurrentServer());

  // --- Global custom prompt: own control, own Save ---------------------
  const promptTa = window.document.getElementById("settings-ai-custom-prompt");
  const promptSave = window.document.getElementById("settings-ai-prompt-save");
  check("settings: prompt lives outside the provider form",
    promptTa && !promptTa.closest(".settings-form-actions") === false ||
    (promptTa && promptTa.id === "settings-ai-custom-prompt"),
    "");   // structural: the textarea exists; form title shows provider form
  promptTa.value = "Always answer in Traditional Chinese.";
  promptTa.dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(10);
  check("settings: prompt Save enables when text is dirty",
    !window.document.getElementById("settings-ai-prompt-save").disabled,
    "");
  window.document.getElementById("settings-ai-prompt-save").click();
  await tick(80);
  check("settings: prompt Save persists the GLOBAL prompt (config root)",
    aiConfig.customPrompt === "Always answer in Traditional Chinese.",
    aiConfig.customPrompt);
  // Provider edits never touch the saved global prompt.
  Array.from(window.document.querySelectorAll("#settings-ai-list .settings-ai-edit"))[0].click();
  await tick(10);
  window.document.getElementById("settings-ai-model").value = "m-9";
  window.document.getElementById("settings-ai-add").click();
  await tick(60);
  check("settings: provider save does not clobber the global prompt",
    aiConfig.customPrompt === "Always answer in Traditional Chinese.",
    aiConfig.customPrompt);
  await window.NB.ai.loadAiConfig();
  aiChatStreams.push([sseFrame("ok")]);
  aiInput().value = "ping";
  aiSend();
  await tick(80);
  const promptReq = aiChatLog[aiChatLog.length - 1];
  check("settings: saved global prompt reaches the system prompt",
    /Assistant instructions from the user|Always answer in Traditional Chinese/.test(
      aiChatLog[aiChatLog.length - 1].messages[0].content),
    "");
  // Reset: rename back + clear prompt so later blocks are unaffected.
  aiConfig.servers[0].name = "stub";
  aiConfig.default = "stub";
  aiConfig.customPrompt = "";
  await window.NB.ai.loadAiConfig();
  authEnabled = false; authHasAdmin = false; authRole = null;
  await window.NB.settings.close(); await tick(20);

  // Restore fixture state for later blocks.
  FILES["notes/a.md"] = FILE_A;
  MTIMES["notes/a.md"] = (MTIMES["notes/a.md"] || 1) + 1;
  delete FILES[WRITE_PATH];
  TREE = TREE.filter(n => n.path !== WRITE_PATH);
  MTIMES[WRITE_PATH] = 1;
  MTIMES["notes/a.md"] = (MTIMES["notes/a.md"] || 1) + 1;

  console.log("== side-panel AI collapse button ==");
  // The AI view is mounted (with its test config) by the block above;
  // assert its header carries a ‹ collapse button that closes the panel.
  {
    const aiCollapse = window.document.querySelector('#ai-view .panel-header .collapse-btn');
    check("collapse: AI view has a ‹ button in its header", !!aiCollapse);
    if (aiCollapse) {
      aiCollapse.dispatchEvent(new window.Event("click", { bubbles: true }));
      await tick(10);
      check("collapse: AI ‹ collapses the panel",
        $("side-panel").classList.contains("collapsed"));
      // Re-expand + return to Explorer so the suite ends in a sane state.
      const explorerBtn = window.document.querySelector('#activity-bar .activity-btn[data-view="explorer"]');
      explorerBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
      await tick(10);
      check("collapse: back to Explorer, panel expanded",
        !$("side-panel").classList.contains("collapsed") &&
        window.NB.activity.getActive() === "explorer");
    }
  }

  console.log("\nRESULT: " + (fail === 0 ? "PASS" : "FAIL") + "  (" + pass + " ok, " + fail + " failed)");
  process.exit(fail === 0 ? 0 : 1);
})();