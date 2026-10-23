/* mobile.js -- phone shell: mode mirror, drawer, Home, quick capture.
 *
 * The mode is decided by CSS (`--ui-mode` inside the phone media query in
 * style.css). This module reads that token, mirrors it to
 * `html[data-ui-mode]`, and owns the phone-only layers over the reader:
 * the side-panel drawer, the Home list, the capture sheet, and the mobile
 * settings sheet. Desktop never activates any of it.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const RESUME_KEY = "nb:mobileResume";
  const DRAFT_KEY = "nb:captureDraft";
  const CAPTURE_PATH = "Inbox.md";
  const CAPTURE_BLOCK = "\n\n";
  const MENU_WIDTH = 196;

  // "drawer" | "capture" | "settings" while a phone layer is open.
  let layer = null;
  let layerHistory = false;
  let suppressHistory = false;
  let bootHistory = true;
  let sending = false;
  let sendFailed = false;
  let captureDirty = false;
  let draftTimer = 0;
  let resumeTimer = 0;
  let scrollRaf = 0;
  let booted = false;
  let bootDone = false;
  let lastMode = null;
  let resizeTimer = 0;
  let resumeState = null;
  let resumeScrollDone = false;
  let serverOnline = true;
  let authLocked = false;
  let signingOut = false;

  // Static shell nodes are captured once at load: notes render into the
  // viewer before these ids in document order, so a lazy getElementById can
  // return a note's element with the same id.
  const shell = {
    title: document.getElementById("mobile-title"),
    viewerContent: document.getElementById("viewer-content"),
    captureInput: document.getElementById("capture-input"),
    captureSend: document.getElementById("capture-send"),
    captureStatus: document.getElementById("capture-status"),
    captureSheet: document.getElementById("capture-sheet"),
    captureClose: document.getElementById("capture-close"),
    scrim: document.getElementById("mobile-scrim"),
    home: document.getElementById("mobile-home"),
    state: document.getElementById("mobile-state"),
    settings: document.getElementById("mobile-settings"),
    more: document.getElementById("mobile-more"),
    captureBtn: document.getElementById("mobile-capture"),
    backBtn: document.getElementById("back-btn"),
    sidePanel: document.getElementById("side-panel"),
    menu: document.getElementById("nb-menu"),
  };
  let drawerStatusEl = null;

  /* --- mode ---------------------------------------------------------- */
  function readMode() {
    try {
      const token = getComputedStyle(document.documentElement)
        .getPropertyValue("--ui-mode").trim();
      if (token) return token;
    } catch (_) { /* jsdom / no stylesheet: fall through */ }
    return document.documentElement.dataset.uiMode || "desktop";
  }

  function isOn() { return readMode() === "phone"; }

  function refreshMode() {
    const mode = readMode();
    const previousMode = lastMode;
    lastMode = mode;
    const root = document.documentElement;
    const changed = root.dataset.uiMode !== mode;
    root.dataset.uiMode = mode;
    const status = (NB.auth && NB.auth.status) ? NB.auth.status() : null;
    authLocked = !!(status && status.enabled && !status.role);
    if (changed) NB.evt.emit("mobile:mode", { mode });
    syncChrome();
    // Desktop boot -> phone shell later (resize/rotation): seed history
    // for the visible note or Home. Idempotent when already seeded.
    if (mode === "phone" && previousMode && previousMode !== "phone" && bootDone) {
      seedPhoneHistory();
    }
    return mode;
  }

  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(refreshMode, 150);
  }

  /* --- small helpers ------------------------------------------------- */
  function basename(path) {
    if (!path) return "";
    const i = path.lastIndexOf("/");
    return i < 0 ? path : path.slice(i + 1);
  }

  function lsGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) { /* quota/private */ }
  }
  function lsRemove(key) {
    try { localStorage.removeItem(key); } catch (_) { /* ignore */ }
  }

  function treeHas(tree, path) {
    for (const node of tree || []) {
      if (node.path === path) return true;
      if (node.children && treeHas(node.children, path)) return true;
    }
    return false;
  }

  function notify(message, cls) {
    if (NB.app && NB.app.notify) NB.app.notify(message, 2400, cls);
  }

  /* --- title --------------------------------------------------------- */
  function setTitle(path) {
    const el = shell.title;
    if (!el) return;
    const site = (NB.app && NB.app.getSiteTitle) ? NB.app.getSiteTitle() : "Notebook";
    el.textContent = path ? basename(path) : site;
    el.title = path || "";
    el.setAttribute("aria-label", path
      ? "Note " + basename(path) + " — browse notes"
      : "Browse notes");
  }

  /* --- resume + draft storage ---------------------------------------- */
  function readResume() {
    const raw = lsGet(RESUME_KEY);
    if (!raw) return null;
    try {
      const v = JSON.parse(raw);
      if (!v || v.v !== 1 || typeof v.path !== "string" || !v.path) return null;
      return { path: v.path, scroll: Number(v.scroll) || 0 };
    } catch (_) { return null; }
  }

  function activePath() {
    return (NB.tabs && NB.tabs.getActive) ? NB.tabs.getActive() : null;
  }

  function saveResumeNow() {
    const path = activePath();
    if (!path) return;
    const vc = shell.viewerContent;
    const scroll = vc ? Math.round(vc.scrollTop) : 0;
    lsSet(RESUME_KEY, JSON.stringify({ v: 1, path, scroll }));
  }

  function scheduleResume() {
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(saveResumeNow, 200);
  }

  function saveDraftNow() {
    // Never touch storage on a fresh load: an empty, unopened textarea must
    // not wipe a draft saved by an earlier visit.
    if (layer !== "capture" && !captureDirty) return;
    const input = shell.captureInput;
    if (!input) return;
    const v = input.value;
    if (v) lsSet(DRAFT_KEY, v);
    else lsRemove(DRAFT_KEY);
  }

  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraftNow, 300);
  }

  /* --- layers (drawer / capture / settings) -------------------------- */
  function updateScrim() {
    const scrim = shell.scrim;
    if (scrim) scrim.hidden = !layer;
  }

  function showLayerUi(kind) {
    document.body.classList.toggle("drawer-open", kind === "drawer");
    document.body.classList.toggle("capture-open", kind === "capture");
    document.body.classList.toggle("settings-open", kind === "settings");
    if (kind === "capture") {
      const sheet = shell.captureSheet;
      if (sheet) sheet.hidden = false;
    } else if (kind === "settings") {
      const sheet = shell.settings;
      if (sheet) sheet.hidden = false;
    }
    updateScrim();
  }

  function hideLayerUi(kind) {
    document.body.classList.remove("drawer-open", "capture-open", "settings-open");
    delete document.body.dataset.drawerView;
    if (kind === "capture") {
      const sheet = shell.captureSheet;
      if (sheet) sheet.hidden = true;
    } else if (kind === "settings") {
      const sheet = shell.settings;
      if (sheet) sheet.hidden = true;
    }
    updateScrim();
  }

  function focusOpener(kind) {
    const el = kind === "capture" ? shell.captureBtn
      : kind === "settings" ? shell.more : shell.title;
    if (el && !el.hidden) { try { el.focus({ preventScroll: true }); } catch (_) {} }
  }

  function setLayer(kind) {
    if (!isOn()) return;
    if (layer && layer !== kind) hideLayerUi(layer);
    layer = kind;
    if (!layerHistory) {
      try {
        history.pushState({ nbLayer: kind }, "", location.href);
        layerHistory = true;
      } catch (_) { layerHistory = false; }
    }
    showLayerUi(kind);
  }

  function closeLayerNow(restoreFocus, opts) {
    const kind = layer;
    if (!kind) return;
    if (kind === "capture" && !(opts && opts.skipDraft)) saveDraftNow();
    layer = null;
    layerHistory = false;
    hideLayerUi(kind);
    if (kind === "capture" || kind === "settings") updateKeyboardInset();
    if (restoreFocus !== false) focusOpener(kind);
  }

  // Close through the history entry so browser/hardware back and the UI
  // controls (scrim, ×, Esc) all take the same path.
  function requestCloseLayer() {
    if (!layer) return false;
    if (layer === "capture") saveDraftNow();
    if (layerHistory) {
      try { history.back(); return true; }
      catch (_) { /* fall through to a direct close */ }
    }
    closeLayerNow();
    return true;
  }

  function closeTopLayer() {
    const menu = shell.menu;
    if (menu && !menu.hidden) { NB.menu.close(); return true; }
    return requestCloseLayer();
  }

  // The top-bar back control on a phone: close the top layer, then use
  // the viewer's visit stack, then fall back to browser history (previous
  // note / Home).
  function back() {
    // Browser history is the only navigator on a phone. A layer consumes
    // its own entry; everything else is one history.back() and is handled
    // in popstate.
    if (closeTopLayer()) return true;
    try { history.back(); return true; }
    catch (_) { return false; }
  }

  /* --- drawer -------------------------------------------------------- */
  function drawerView() {
    const panel = shell.sidePanel;
    return panel ? panel.querySelector(".side-panel-view:not([hidden])") : null;
  }

  function focusDrawer() {
    const view = drawerView();
    if (!view) return;
    if (view.dataset.view === "search") {
      const input = view.querySelector(".search-panel-input");
      if (input) { try { input.focus({ preventScroll: true }); } catch (_) {} return; }
    }
    const btns = view.querySelectorAll(".collapse-btn");
    const close = view.querySelector("#sidebar-collapse") || btns[btns.length - 1];
    if (close) { try { close.focus({ preventScroll: true }); } catch (_) {} }
  }

  function openDrawer(viewId) {
    if (!isOn()) return;
    if (viewId && NB.activity && NB.activity.activate) {
      NB.activity.activate(viewId, false);
    }
    const active = (NB.activity && NB.activity.getActive) ? NB.activity.getActive() : null;
    if (active) document.body.dataset.drawerView = active;
    setLayer("drawer");
    checkServer();
    setTimeout(focusDrawer, 220);
  }

  function closeDrawer() {
    if (layer === "drawer") requestCloseLayer();
  }

  function isDrawerOpen() {
    return layer === "drawer";
  }

  /* --- capture ------------------------------------------------------- */
  function updateSend() {
    const send = shell.captureSend;
    const input = shell.captureInput;
    if (!send || !input) return;
    if (sending) {
      send.disabled = true;
      send.textContent = "Sending\u2026";
      return;
    }
    send.disabled = !input.value.trim();
    send.textContent = sendFailed ? "Retry" : "Send";
  }

  function updateKeyboardInset() {
    const vv = window.visualViewport;
    let inset = 0;
    if (isOn() && vv) {
      inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    }
    document.documentElement.style.setProperty("--m-kb", inset + "px");
  }

  function openCapture() {
    if (!isOn()) return;
    if (NB.auth && NB.auth.canWrite && !NB.auth.canWrite()) {
      notify("Not allowed for this role", "warn");
      return;
    }
    const input = shell.captureInput;
    if (input) {
      const draft = lsGet(DRAFT_KEY);
      if (draft !== null && draft !== "") input.value = draft;
    }
    sendFailed = false;
    captureDirty = false;
    setLayer("capture");
    updateSend();
    updateKeyboardInset();
    setTimeout(() => {
      if (input) { try { input.focus({ preventScroll: true }); } catch (_) {} }
      updateKeyboardInset();
    }, 80);
  }

  function captureErrorText(e) {
    const msg = (e && e.message) || "Send failed";
    return /forbidden/i.test(msg) ? "Not allowed for this role" : msg;
  }

  async function sendCapture() {
    if (sending) return;
    const input = shell.captureInput;
    const status = shell.captureStatus;
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    if (NB.auth && NB.auth.canWrite && !NB.auth.canWrite()) {
      if (status) status.textContent = "Not allowed for this role";
      notify("Not allowed for this role", "warn");
      return;
    }
    sending = true;
    sendFailed = false;
    input.readOnly = true;
    if (status) status.textContent = "";
    updateSend();
    try {
      await NB.api.appendFile(CAPTURE_PATH, CAPTURE_BLOCK + text + "\n", true);
      lsRemove(DRAFT_KEY);
      input.value = "";
      sending = false;
      sendFailed = false;
      captureDirty = false;
      input.readOnly = false;
      updateSend();
      requestCloseLayer();
      notify("Saved to " + CAPTURE_PATH);
      if (NB.sidebar && NB.sidebar.refresh) NB.sidebar.refresh();
    } catch (e) {
      sending = false;
      sendFailed = true;
      input.readOnly = false;
      updateSend();
      if (status) status.textContent = captureErrorText(e);
    }
  }

  /* --- Home ---------------------------------------------------------- */
  function homeRow(icon, label, meta, handler) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mobile-home-row";
    const i = document.createElement("span");
    i.className = "mhr-icon";
    i.setAttribute("aria-hidden", "true");
    i.textContent = icon;
    const l = document.createElement("span");
    l.className = "mhr-label";
    l.textContent = label;
    btn.append(i, l);
    if (meta) {
      const m = document.createElement("span");
      m.className = "mhr-meta";
      m.textContent = meta;
      btn.appendChild(m);
    }
    btn.addEventListener("click", handler);
    return btn;
  }

  function openResume() {
    const resume = readResume();
    if (!resume) return;
    const tree = (NB.sidebar && NB.sidebar.getTree) ? NB.sidebar.getTree() : [];
    if (!treeHas(tree, resume.path)) {
      // M7.4: a deleted Continue target lands on Home with a one-line
      // notice, not the full not-found screen.
      lsRemove(RESUME_KEY);
      hideState();
      renderHome();
      notify("That note is no longer available.");
      return;
    }
    NB.evt.emit("file:open-request", resume.path);
  }

  function renderHome() {
    const home = shell.home;
    if (!home) return;
    home.innerHTML = "";
    const site = (NB.app && NB.app.getSiteTitle) ? NB.app.getSiteTitle() : "Notebook";
    const title = document.createElement("h1");
    title.className = "mobile-home-title";
    title.textContent = site;
    const sub = document.createElement("p");
    sub.className = "mobile-home-sub";
    sub.textContent = "Read or capture a note.";
    home.append(title, sub);

    const list = document.createElement("div");
    list.className = "mobile-home-list";
    list.appendChild(homeRow("\uD83D\uDD0D", "Search", "", () => openDrawer("search")));

    const resume = readResume();
    if (resume) {
      list.appendChild(homeRow("\u25B6", "Continue", basename(resume.path), openResume));
    }
    list.appendChild(homeRow("\uD83D\uDD16", "Bookmarks", "", () => openDrawer("bookmarks")));
    list.appendChild(homeRow("\uD83D\uDD52", "Recent", "", () => openDrawer("recent")));
    list.appendChild(homeRow("\uD83D\uDDC2", "Browse", "", () => openDrawer("explorer")));
    home.appendChild(list);

    const sep = document.createElement("div");
    sep.className = "mobile-home-sep";
    home.appendChild(sep);
    home.appendChild(homeRow("\u2699", "Settings", "", openSettings));
  }

  function updateHome() {
    const home = shell.home;
    if (!home) return;
    const active = activePath();
    const show = isOn() && !authLocked && !active;
    home.hidden = !show;
    if (isOn()) {
      const back = shell.backBtn;
      if (back) back.disabled = !active;
    }
    if (show) renderHome();
  }

  /* --- failure / not-found state ------------------------------------- */
  function showState(opts) {
    const host = shell.state;
    if (!host) return;
    host.innerHTML = "";
    const glyph = document.createElement("div");
    glyph.className = "mobile-state-glyph";
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = "\u26A0";
    const title = document.createElement("h2");
    title.className = "mobile-state-title";
    title.textContent = opts.title || "Can't reach the server";
    host.append(glyph, title);
    if (opts.path) {
      const p = document.createElement("code");
      p.className = "mobile-state-path";
      p.textContent = opts.path;
      host.appendChild(p);
    }
    if (opts.message) {
      const msg = document.createElement("p");
      msg.className = "mobile-state-msg";
      msg.textContent = opts.message;
      host.appendChild(msg);
    }
    if (opts.actions && opts.actions.length) {
      const row = document.createElement("div");
      row.className = "mobile-state-actions";
      for (const action of opts.actions) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "mobile-state-btn" + (action.secondary ? " secondary" : "");
        btn.textContent = action.label;
        btn.addEventListener("click", action.handler);
        row.appendChild(btn);
      }
      host.appendChild(row);
    }
    host.hidden = false;
    if (opts.retry) host.dataset.retry = "1";
  }

  function hideState() {
    const host = shell.state;
    if (host) host.hidden = true;
  }

  // M8: a transport failure is never a note or a sign-in prompt. Say there
  // is no cache and offer one retry of the page.
  function showUnreachable() {
    showState({
      title: "Can't reach the server",
      message: "Nothing is cached on this phone. Check the server, then retry.",
      actions: [{ label: "Retry", handler: () => {
        try { window.location.reload(); } catch (_) {}
      } }],
    });
  }

  function showNotFound(path) {
    showState({
      title: "Note not found",
      path,
      message: "This note is not in the notebook.",
      actions: [
        { label: "Browse", handler: () => { hideState(); openDrawer("explorer"); } },
        { label: "Home", secondary: true, handler: () => {
          hideState();
          if (NB.tabs && NB.tabs.clearAll) NB.tabs.clearAll();
          replaceWithHome();
          updateHome();
        } },
      ],
    });
  }

  /* --- mobile settings ----------------------------------------------- */
  function serverLabel() {
    return serverOnline ? "Online" : "Offline";
  }

  function statusDot(extraClass) {
    const dot = document.createElement("span");
    dot.className = "status-dot" + (serverOnline ? "" : " offline") + (extraClass ? " " + extraClass : "");
    dot.setAttribute("aria-hidden", "true");
    return dot;
  }

  function segmented(options, current, onPick) {
    const wrap = document.createElement("div");
    wrap.className = "mobile-settings-seg";
    wrap.setAttribute("role", "group");
    for (const opt of options) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = opt.label;
      btn.classList.toggle("on", opt.value === current);
      btn.setAttribute("aria-pressed", opt.value === current ? "true" : "false");
      btn.addEventListener("click", () => {
        wrap.querySelectorAll("button").forEach(b => {
          b.classList.remove("on");
          b.setAttribute("aria-pressed", "false");
        });
        btn.classList.add("on");
        btn.setAttribute("aria-pressed", "true");
        onPick(opt.value);
      });
      wrap.appendChild(btn);
    }
    return wrap;
  }

  function adminOnly() {
    const el = document.createElement("span");
    el.className = "mobile-settings-admin";
    el.textContent = "Admin only";
    return el;
  }

  function buildSettings() {
    const sheet = shell.settings;
    if (!sheet) return;
    const canWrite = !(NB.auth && NB.auth.canWrite) || NB.auth.canWrite();
    sheet.innerHTML = "";
    const grab = document.createElement("div");
    grab.className = "capture-grabber";
    grab.setAttribute("aria-hidden", "true");
    const head = document.createElement("div");
    head.className = "mobile-settings-head";
    const h = document.createElement("h2");
    h.id = "mobile-settings-title";
    h.textContent = "Settings";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "mobile-sheet-close";
    close.setAttribute("aria-label", "Close settings");
    close.textContent = "\u00D7";
    close.addEventListener("click", requestCloseLayer);
    head.append(h, close);

    const body = document.createElement("div");
    body.className = "mobile-settings-body";

    const themeRow = document.createElement("div");
    themeRow.className = "mobile-settings-row";
    const themeLabel = document.createElement("span");
    themeLabel.className = "mobile-settings-label";
    themeLabel.textContent = "Theme";
    const cfg = (NB.app && NB.app.getCfg) ? NB.app.getCfg() : {};
    if (canWrite) {
      themeRow.append(themeLabel, segmented([
        { label: "Auto", value: "auto" },
        { label: "Dark", value: "dark" },
        { label: "Light", value: "light" },
      ], cfg.theme || "auto", (v) => NB.app.setTheme(v)));
    } else {
      themeRow.append(themeLabel, adminOnly());
    }

    const sizeRow = document.createElement("div");
    sizeRow.className = "mobile-settings-row";
    const sizeLabel = document.createElement("span");
    sizeLabel.className = "mobile-settings-label";
    sizeLabel.textContent = "Text size";
    if (canWrite) {
      sizeRow.append(sizeLabel, segmented([
        { label: "S", value: "small" },
        { label: "M", value: "medium" },
        { label: "L", value: "large" },
        { label: "XL", value: "xlarge" },
      ], cfg.fontSize || "medium", (v) => NB.app.setFontSize(v)));
    } else {
      sizeRow.append(sizeLabel, adminOnly());
    }

    const serverRow = document.createElement("div");
    serverRow.className = "mobile-settings-row";
    const serverLabelEl = document.createElement("span");
    serverLabelEl.className = "mobile-settings-label";
    serverLabelEl.textContent = "Server";
    const serverWrap = document.createElement("span");
    serverWrap.className = "mobile-settings-server";
    serverWrap.append(statusDot());
    const serverWord = document.createElement("span");
    serverWord.className = "server-word";
    serverWord.textContent = location.host + " \u00B7 " + serverLabel();
    serverWrap.appendChild(serverWord);
    serverRow.append(serverLabelEl, serverWrap);

    const note = document.createElement("p");
    note.className = "mobile-settings-note";
    note.textContent = "Theme and text size are saved on this server and apply to every device.";

    body.append(themeRow, sizeRow, serverRow, note);

    const auth = (NB.auth && NB.auth.status) ? NB.auth.status() : null;
    if (auth && auth.enabled) {
      const out = document.createElement("button");
      out.type = "button";
      out.className = "mobile-signout";
      out.textContent = "Sign out";
      out.addEventListener("click", () => {
        requestCloseLayer();
        if (NB.auth && NB.auth.logout) NB.auth.logout();
      });
      body.appendChild(out);
    }

    sheet.append(grab, head, body);
  }

  function openSettings() {
    if (!isOn()) return;
    buildSettings();
    setLayer("settings");
    checkServer();
    setTimeout(() => {
      const close = shell.settings
        ? shell.settings.querySelector(".mobile-sheet-close") : null;
      if (close) { try { close.focus({ preventScroll: true }); } catch (_) {} }
    }, 220);
  }

  /* --- note menu ----------------------------------------------------- */
  function openMore() {
    if (!isOn()) return;
    const path = activePath();
    if (!path) { openSettings(); return; }
    const more = shell.more;
    const rect = more ? more.getBoundingClientRect() : { left: 10, right: 10, bottom: 60 };
    const closeMenu = () => {
      if (more) more.setAttribute("aria-expanded", "false");
    };
    const items = [
      { label: "Reload", handler: () => { closeMenu(); NB.viewer.reload(); } },
      { label: "Copy link", handler: () => { closeMenu(); NB.app.copyLink(path); } },
      { label: "Show in Browse", handler: () => {
        closeMenu();
        openDrawer("explorer");
        if (NB.sidebar && NB.sidebar.revealFile) NB.sidebar.revealFile(path);
      } },
    ];
    NB.menu.open({
      owner: "mobile",
      x: rect.right - MENU_WIDTH,
      y: rect.bottom + 4,
      scope: document.getElementById("topbar"),
      items,
      focusFirst: false,
    });
    if (more) more.setAttribute("aria-expanded", "true");
  }

  /* --- server status ------------------------------------------------- */
  async function checkServer() {
    if (!isOn() || !NB.api || !NB.api.getAuthStatus) return;
    try {
      await NB.api.getAuthStatus();
      setServerOnline(true);
    } catch (_) {
      setServerOnline(false);
    }
  }

  function setServerOnline(ok) {
    serverOnline = !!ok;
    if (drawerStatusEl) {
      const dot = drawerStatusEl.querySelector(".status-dot");
      if (dot) dot.classList.toggle("offline", !serverOnline);
      const word = drawerStatusEl.querySelector(".status-word");
      if (word) word.textContent = serverLabel();
    }
    const row = shell.settings
      ? shell.settings.querySelector(".mobile-settings-server") : null;
    if (row) {
      const dot = row.querySelector(".status-dot");
      if (dot) dot.classList.toggle("offline", !serverOnline);
      const word = row.querySelector(".server-word");
      if (word) word.textContent = location.host + " \u00B7 " + serverLabel();
    }
  }

  function buildDrawerStatus() {
    const panel = shell.sidePanel;
    if (!panel || drawerStatusEl) return;
    const foot = document.createElement("div");
    foot.id = "mobile-drawer-status";
    foot.hidden = true;
    foot.append(statusDot());
    const text = document.createElement("span");
    text.className = "status-word";
    text.textContent = serverLabel();
    const origin = document.createElement("span");
    origin.className = "status-origin";
    origin.textContent = location.host + " \u00B7 ";
    foot.append(origin, text);
    drawerStatusEl = foot;
    panel.appendChild(foot);
  }

  /* --- chrome sync --------------------------------------------------- */
  function updateCaptureButton() {
    const btn = shell.captureBtn;
    if (!btn) return;
    const canWrite = !(NB.auth && NB.auth.canWrite) || NB.auth.canWrite();
    btn.hidden = !canWrite;
  }

  function syncChrome() {
    const on = isOn();
    setTitle(activePath());
    updateCaptureButton();
    const status = drawerStatusEl;
    if (status) status.hidden = !on;
    document.querySelectorAll("#side-panel .collapse-btn").forEach((btn) => {
      if (btn.id === "sidebar-refresh" || btn.querySelector(".refresh-glyph")) return;
      btn.textContent = on ? "\u00D7" : "\u2039";
      btn.title = on ? "Close panel" : "Collapse panel";
      btn.setAttribute("aria-label", on ? "Close panel" : "Collapse panel");
    });
    if (!on) {
      // Clear the layer entry before the close path resets layerHistory,
      // otherwise repeated mode flips leave dead {nbLayer} entries.
      removeHistoryLayerEntry();
      if (layer) closeLayerNow(false);
      document.documentElement.style.setProperty("--m-kb", "0px");
      const home = shell.home;
      if (home) home.hidden = true;
      hideState();
    } else {
      updateHome();
      updateKeyboardInset();
    }
  }

  // Mode flips back to desktop mid-session: rewrite the layer entry to the
  // current navigation state so no dead {nbLayer} entry survives.
  function removeHistoryLayerEntry() {
    if (!layerHistory) return;
    const path = activePath();
    try {
      history.replaceState(
        path ? { nbFile: path } : { nbHome: true },
        "",
        path ? noteUrl(path) : location.pathname);
    } catch (_) {}
    layerHistory = false;
  }

  /* --- history ------------------------------------------------------- */
  function noteUrl(path) {
    return location.pathname + "?file=" + encodeURIComponent(path);
  }

  // Every Home path uses this: no stale ?file= survives, and reload lands
  // back on Home.
  function replaceWithHome() {
    try { history.replaceState({ nbHome: true }, "", location.pathname); }
    catch (_) {}
  }

  // Make the current entry name the visible state. When a note is visible,
  // keep a Home entry below it so the first back is Home. Idempotent: an
  // entry already naming the note/URL is not duplicated.
  function seedPhoneHistory() {
    const path = activePath();
    if (!path) {
      // A bad deep link deliberately keeps its address while its
      // not-found screen is up.
      const stateHost = shell.state;
      if (stateHost && !stateHost.hidden) return;
      replaceWithHome();
      return;
    }
    const url = noteUrl(path);
    let state = null;
    try { state = history.state; } catch (_) {}
    if (state && state.nbFile === path &&
        location.pathname + location.search === url) {
      return;
    }
    replaceWithHome();
    try { history.pushState({ nbFile: path }, "", url); } catch (_) {}
  }

  function pushNoteHistory(path) {
    if (bootHistory || suppressHistory || !isOn() || !path) return;
    let state = null;
    try { state = history.state; } catch (_) {}
    if (state && state.nbFile === path) return;
    const url = noteUrl(path);
    // A file chosen from an open drawer replaces the drawer entry with the
    // note entry, so back does not land on a dead drawer layer.
    if (layer) {
      layerHistory = false;
      closeLayerNow();
      try { history.replaceState({ nbFile: path }, "", url); } catch (_) {}
      return;
    }
    try { history.pushState({ nbFile: path }, "", url); } catch (_) {}
  }

  // An in-page anchor jump keeps the same note identity in the address bar
  // and in the history entry, so back can restore scroll instead of
  // navigating to a different note.
  function noteInPage(path) {
    if (!isOn() || !path) return;
    try { history.pushState({ nbFile: path, inPage: true }, "", location.href); }
    catch (_) {}
  }

  async function navigateToHistoryFile(path) {
    suppressHistory = true;
    try {
      if (path && NB.tabs && NB.tabs.open) {
        await NB.tabs.open(path);
      } else if (!path && NB.tabs && NB.tabs.clearAll) {
        NB.tabs.clearAll();
        replaceWithHome();
        updateHome();
      }
    } catch (_) { /* the tab layer already cleared on failure */ }
    finally { suppressHistory = false; }
  }

  // The boot window ends after app.js has restored the resume/deep-link
  // note. Seed history so the first back always lands on Home, then the
  // note is one more entry above it.
  function endBoot() {
    bootHistory = false;
    bootDone = true;
    if (!isOn()) return;
    seedPhoneHistory();
  }

  async function popViewerHistory() {
    suppressHistory = true;
    try { await NB.viewer.goBack(); }
    catch (_) { /* the viewer keeps the current note on failure */ }
    finally { suppressHistory = false; }
  }

  async function onPopState(e) {
    if (!isOn()) return;
    if (layer) { closeLayerNow(); return; }
    const state = e && e.state;
    const current = activePath();
    if (state && state.nbLayer) return;   // stale layer entry; ignore
    // Home entries (and legacy null states) clear the reader and the URL.
    if (!state || state.nbHome) {
      await navigateToHistoryFile(null);
      return;
    }
    // The navStack only belongs to the note the browser entry names.
    // A different note means navigate history instead of popping it.
    if (state.nbFile && state.nbFile !== current) {
      await navigateToHistoryFile(state.nbFile);
      return;
    }
    if (state.nbFile && state.nbFile === current &&
        NB.viewer && NB.viewer.canGoBack && NB.viewer.canGoBack()) {
      await popViewerHistory();
    }
  }

  /* --- auth ---------------------------------------------------------- */
  function onAuthRequired() {
    if (!isOn()) return;
    // Close before clearing: the capture close path may persist the
    // still-present text. The lock that follows skips its own write.
    if (layer === "capture" || layer === "settings") closeLayerNow(false);
    const input = shell.captureInput;
    if (input) { input.value = ""; input.readOnly = false; }
    captureDirty = false;
    sending = false;
    sendFailed = false;
    updateSend();
    updateCaptureButton();
  }

  function onAuthLocked() {
    authLocked = true;
    const input = shell.captureInput;
    // Preserve a still-open draft across a 401, but never let the close
    // save an empty field. Explicit sign-out has already removed the keys
    // and must not resurrect them here.
    if (!signingOut && input && input.value) lsSet(DRAFT_KEY, input.value);
    if (layer) closeLayerNow(false, { skipDraft: true });
    if (input) { input.value = ""; input.readOnly = false; }
    captureDirty = false;
    sending = false;
    sendFailed = false;
    updateSend();
    const title = shell.title;
    if (title) {
      title.textContent = "";
      title.setAttribute("aria-label", "Browse notes");
    }
    const home = shell.home;
    if (home) home.hidden = true;
    signingOut = false;
    updateCaptureButton();
  }

  function onSignOut() {
    signingOut = true;
    lsRemove(DRAFT_KEY);
    lsRemove(RESUME_KEY);
  }

  function onAuthStatus(status) {
    authLocked = !!(status && status.enabled && !status.role);
    updateCaptureButton();
    if (authLocked) {
      const home = shell.home;
      if (home) home.hidden = true;
    } else {
      setTitle(activePath());
      updateHome();
    }
  }

  /* --- events -------------------------------------------------------- */
  function wireEvents() {
    NB.evt.on("file:open", (path) => {
      if (!isOn()) return;
      hideState();
      setTitle(path);
      updateHome();
      saveResumeNow();
      scheduleResume();
      if (!resumeScrollDone) {
        resumeScrollDone = true;
        const resume = resumeState;
        if (resume && resume.path === path && resume.scroll > 0) {
          const vc = shell.viewerContent;
          requestAnimationFrame(() => {
            requestAnimationFrame(() => { if (vc) vc.scrollTop = resume.scroll; });
          });
        }
      }
      pushNoteHistory(path);
    });

    NB.evt.on("tabs:changed", ({ activeFile }) => {
      if (!isOn()) return;
      if (authLocked) {
        const title = shell.title;
        if (title) title.textContent = "";
        const home = shell.home;
        if (home) home.hidden = true;
        return;
      }
      setTitle(activeFile || null);
      if (!activeFile && !bootHistory) replaceWithHome();
      updateHome();
    });

    NB.evt.on("auth:status", onAuthStatus);
    NB.evt.on("auth:required", onAuthRequired);
    NB.evt.on("auth:locked", onAuthLocked);

    // Transport failures only (api.js does not emit for HTTP errors).
    NB.evt.on("api:network-error", (info) => {
      if (!isOn() || authLocked) return;
      // Capture owns its own inline Retry; do not cover the sheet.
      if (layer === "capture" && info && /\/api\/file\/append/.test(info.url || "")) {
        return;
      }
      showUnreachable();
    });
    NB.evt.on("mobile:mode", () => {
      resumeScrollDone = false;
      updateHome();
    });
  }

  function onKeydown(e) {
    if (e.key !== "Escape" || !isOn()) return;
    const menu = shell.menu;
    if (menu && !menu.hidden) return;   // menu.js owns Esc for its own menu
    closeTopLayer();
  }

  function wireUi() {
    const title = shell.title;
    if (title) title.addEventListener("click", () => openDrawer());
    const capture = shell.captureBtn;
    if (capture) capture.addEventListener("click", openCapture);
    const more = shell.more;
    if (more) more.addEventListener("click", (e) => { e.stopPropagation(); openMore(); });
    if (more) {
      document.addEventListener("click", () => {
        const menu = shell.menu;
        if (menu && menu.hidden) more.setAttribute("aria-expanded", "false");
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") more.setAttribute("aria-expanded", "false");
      }, true);
    }
    const scrim = shell.scrim;
    if (scrim) scrim.addEventListener("click", closeTopLayer);

    const close = shell.captureClose;
    if (close) close.addEventListener("click", requestCloseLayer);
    const send = shell.captureSend;
    if (send) send.addEventListener("click", sendCapture);
    const input = shell.captureInput;
    if (input) {
      input.addEventListener("input", () => {
        sendFailed = false;
        captureDirty = true;
        updateSend();
        scheduleDraft();
      });
    }

    const vc = shell.viewerContent;
    if (vc) {
      vc.addEventListener("scroll", () => {
        if (!isOn() || scrollRaf) return;
        scrollRaf = requestAnimationFrame(() => {
          scrollRaf = 0;
          scheduleResume();
        });
      }, { passive: true });
    }

    window.addEventListener("resize", onResize);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", updateKeyboardInset);
      window.visualViewport.addEventListener("scroll", updateKeyboardInset);
    }
    window.addEventListener("popstate", onPopState);
    document.addEventListener("keydown", onKeydown, true);
    document.addEventListener("visibilitychange", () => {
      updateKeyboardInset();
      if (document.visibilityState === "hidden") { saveDraftNow(); saveResumeNow(); }
    });
    window.addEventListener("pagehide", () => { saveDraftNow(); saveResumeNow(); });
  }

  function boot() {
    if (booted) return;
    booted = true;
    resumeState = readResume();
    buildDrawerStatus();
    wireUi();
    refreshMode();
    updateHome();
    updateCaptureButton();
    if (isOn()) checkServer();
  }

  // Wire events at load: mobile.js runs before app.js, so the listeners are
  // in place before the boot restore emits its first file:open.
  wireEvents();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  NB.mobile = {
    isOn,
    mode: readMode,
    refreshMode,
    openDrawer,
    closeDrawer,
    isDrawerOpen,
    openCapture,
    closeCapture: requestCloseLayer,
    openSettings,
    closeTopLayer,
    back,
    setTitle,
    resumePath: () => {
      const r = readResume();
      return r ? r.path : null;
    },
    clearResume: () => lsRemove(RESUME_KEY),
    showState,
    hideState,
    showNotFound,
    showUnreachable,
    onAuthRequired,
    onSignOut,
    beginBoot: () => { bootHistory = true; },
    endBoot,
    noteInPage,
  };
})();
