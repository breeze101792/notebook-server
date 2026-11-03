/* graph-3d.js -- the notebook's 3D wikilink graph renderer.
 *
 * A perspective orbit camera, hand-rolled 2D-canvas projection, and a
 * painter's-algorithm draw pass render the notebook as a 3D field of
 * notes. Data comes from GET /api/graph (nodes + undirected edges); the
 * view is read-only. graph.js owns the §graph special tab and chooses
 * this renderer when the saved mode is "3d"; this module only owns the
 * canvas, camera, and simulation.
 *
 * Depth is geometry, not colour: perspective size, fog, draw order, and
 * edge weight carry distance. Depth spread 0% flattens the z-axis. Every
 * canvas colour is read from the existing --graph-*-rgb tokens, so theme
 * changes rebuild the sprites and vignette.
 *
 * Only one renderer is active at a time. `activate()` starts the loop;
 * `deactivate()` sleeps it. Every input, resize, event, and async load
 * path no-ops while inactive so a hidden 3D view cannot draw or mutate
 * state after the user switches to 2D.
 *
 * jsdom can return a stub or no 2D context. All drawing is guarded: the
 * module still mounts, fetches, and exposes state so DOM tests can run
 * without a rendering surface.
 */
(function () {
  "use strict";

  window.NB = window.NB || {};

  // --- camera / projection constants ----------------------------------
  const TAU = Math.PI * 2;
  const FOV = 50 * Math.PI / 180;
  const DEFAULT_YAW = -0.52;
  const DEFAULT_PITCH = 0.30;
  const MIN_PITCH = -1.22;
  const MAX_PITCH = 1.22;
  const MIN_DIST = 230;
  const MAX_DIST = 3000;
  const FIT_MIN_DIST = 260;
  const FIT_MAX_DIST = 2800;
  const CULL_DEPTH = 12;
  const DPR_CAP = 2;
  const DRAG_THRESHOLD = 4;
  const DOUBLE_TAP_MS = 320;
  const DOUBLE_TAP_PX = 26;
  const MIN_NODE_R = 2.4;
  const MAX_NODE_R = 28;
  const CAMERA_TWEEN_MS = 440;
  const FOCUS_TWEEN_MS = 320;
  const AUTO_ORBIT_RAD_PER_S = 0.075;
  const ORBIT_YAW_PER_PX = 0.005;
  const ORBIT_PITCH_PER_PX = 0.004;
  const WHEEL_ZOOM_PER_PX = 0.0012;
  const WHEEL_CURSOR_BIAS = 0.35;
  const TOAST_MS = 3200;
  const TOAST_FADE_MS = 200;
  // DOM_DELTA_LINE wheels report lines, not pixels (Firefox mouse wheels).
  const WHEEL_LINE_PX = 16;
  const TOOLBAR_ZOOM = 1.2;
  const KEY_ZOOM = 1.18;
  const KEY_ORBIT_STEP = 0.075;
  const KEY_PAN_STEP = 26;

  // --- physics constants (tuned for small single-user notebooks) ------
  const REPULSION = 5200;
  const SPRING_LEN = 66;
  const SPRING_K = 0.011;
  const CENTER_K = 0.0009;
  const DAMPING = 0.85;
  const MAX_SPEED = 7;
  const SLEEP_EPS = 0.006;

  // --- labels / chrome ------------------------------------------------
  const LABEL_FONT = '500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const LABEL_FONT_STRONG = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const LABEL_MAX_CHARS = 30;
  // Must stay above the server's 5 s graph-scan deadline: the server's 504
  // (and its message) has to arrive before this race rejects on the client.
  const FETCH_TIMEOUT_MS = 10000;
  const NOTIFY_MS = 4000;
  const GRAPH_TIMEOUT_MESSAGE =
    "The notebook took too long to scan. Graph not refreshed.";
  const PARTICLES_LIMIT = 500;

  // Cap the synchronous warm-up by work, not just steps: 300 nodes at the
  // full tier's 500 steps is ~22M pair checks before the first paint.
  const WARMUP_PAIR_BUDGET = 2000000;

  const TIERS = {
    full:    { name: "full",    labelIdle: 16, labelFocus: 22, pulseCap: 12, bloom: "all",  warmup: 500 },
    reduced: { name: "reduced", labelIdle: 12, labelFocus: 16, pulseCap: 8,  bloom: "near", warmup: 80 },
    lite:    { name: "lite",    labelIdle: 10, labelFocus: 10, pulseCap: 0,  bloom: "none", warmup: 25 },
    over:    { name: "over",    labelIdle: 10, labelFocus: 10, pulseCap: 0,  bloom: "none", warmup: 0 },
  };

  const STATE_COPY = {
    loading: {
      title: "Mapping your notebook…",
      body: "Reading links from your notes.",
      action: null,
    },
    empty: {
      title: "Nothing to map yet",
      body: "Notes appear here once they exist. Link them with wikilinks or Markdown links to draw edges.",
      action: "Refresh",
    },
    error: {
      title: "Couldn’t load the graph",
      body: "The server didn’t answer. Check that the notebook is running, then try again.",
      action: "Retry",
    },
  };

  // --- module state ---------------------------------------------------
  let nodes = [];
  let edges = [];
  let byId = new Map();

  let selectedId = null;
  let selectedDist = null;
  let hoverId = null;
  let filterQuery = "";
  let filterSet = null;
  let depthScale = 1;
  let autoRotate = false;
  let reducedMotion = false;
  let ready = "idle";            // idle | loading | ready | empty | error
  let tier = TIERS.full;
  let overBudget = false;
  let overBudgetNotified = false;
  let activeFilePath = null;

  let mounted = false;
  let active = false;
  let running = false;
  let rafId = null;
  let fetching = false;
  let dirty = true;
  let lastT = 0;
  let simRunning = false;
  let simFrame = 0;
  let dragNode = null;
  let dragOrigin = null;
  let dragDown = null;

  let canvas = null;
  let ctx = null;
  let width = 1;
  let height = 1;
  let dpr = 1;
  let focal = 500;

  let palette = null;
  let spriteCache = new Map();
  let vignette = null;
  let projection = new Map();
  let labelWidthCache = new Map();

  const cam = {
    target: { x: 0, y: 0, z: 0 },
    yaw: DEFAULT_YAW,
    pitch: DEFAULT_PITCH,
    dist: 900,
    fov: FOV,
  };
  let cameraMoved = false;
  let camTween = null;

  // --- input state ----------------------------------------------------
  const pointers = new Map();
  let gesture = null;              // orbit | pan | node | pinch
  let downInfo = null;
  let pinchPrev = null;
  let last = { x: 0, y: 0 };
  let lastTap = { t: 0, x: 0, y: 0, id: null };

  // --- ambient effects ------------------------------------------------
  let particleFieldEnabled = false;
  let particles = null;
  let toastTimer = null;
  let toastHideTimer = null;
  let hintHidden = false;

  // --- DOM (resolved once; these ids are unique to the graph view) ----
  const el = {
    view: document.getElementById("graph-view"),
    host: document.getElementById("graph-view-canvas-host"),
    canvas: document.getElementById("graph-view-canvas"),
    summary: document.getElementById("graph-view-summary"),
    filter: document.getElementById("graph-view-filter"),
    depth: document.getElementById("graph-view-depth"),
    depthValue: document.getElementById("graph-view-depth-value"),
    rotate: document.getElementById("graph-view-rotate"),
    fit: document.getElementById("graph-view-fit"),
    zoomIn: document.getElementById("graph-view-zoom-in"),
    zoomOut: document.getElementById("graph-view-zoom-out"),
    refresh: document.getElementById("graph-view-refresh"),
    hint: document.getElementById("graph-view-hint"),
    state: document.getElementById("graph-view-state"),
    stateCard: document.getElementById("graph-view-state-card"),
    stateArt: document.getElementById("graph-view-state-art"),
    stateTitle: document.getElementById("graph-view-state-title"),
    stateBody: document.getElementById("graph-view-state-body"),
    stateAction: document.getElementById("graph-view-state-action"),
    chip: document.getElementById("graph-view-chip"),
    chipName: document.getElementById("graph-view-chip-name"),
    chipMeta: document.getElementById("graph-view-chip-meta"),
    chipClose: document.getElementById("graph-view-chip-close"),
    toast: document.getElementById("graph-view-toast"),
    srLive: document.getElementById("graph-view-sr-live"),
    srList: document.getElementById("graph-view-sr-list"),
  };

  // --- small utilities ------------------------------------------------
  function nowMs() {
    return (window.performance && window.performance.now) ? window.performance.now() : Date.now();
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dot3(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

  function hash32(str) {
    let h = 0x811c9dc5;
    const s = String(str || "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function hashUnit(str) { return hash32(str) / 4294967296; }

  function matchMedia(query) {
    try {
      return window.matchMedia ? window.matchMedia(query) : null;
    } catch (_) {
      return null;
    }
  }

  function readVar(name) {
    if (typeof getComputedStyle !== "function") return "";
    const body = document.body;
    const root = document.documentElement;
    if (body) {
      const fromBody = getComputedStyle(body).getPropertyValue(name).trim();
      if (fromBody) return fromBody;
    }
    if (root) return getComputedStyle(root).getPropertyValue(name).trim();
    return "";
  }

  function parseTriplet(value) {
    const m = String(value || "").trim().match(/^(\d+)\s+(\d+)\s+(\d+)$/);
    return m ? [+m[1], +m[2], +m[3]] : null;
  }

  function parseColor(value) {
    const s = String(value || "").trim();
    let m = s.match(/^#([0-9a-f]{3})$/i);
    if (m) {
      return [
        parseInt(m[1][0], 16) * 17,
        parseInt(m[1][1], 16) * 17,
        parseInt(m[1][2], 16) * 17,
      ];
    }
    m = s.match(/^#([0-9a-f]{6})$/i);
    if (m) {
      return [
        parseInt(m[1].slice(0, 2), 16),
        parseInt(m[1].slice(2, 4), 16),
        parseInt(m[1].slice(4, 6), 16),
      ];
    }
    m = s.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
    if (m) return [+m[1], +m[2], +m[3]];
    return null;
  }

  function rgb(triple, alpha) {
    if (!triple) return "rgba(0,0,0," + alpha + ")";
    return "rgba(" + triple[0] + "," + triple[1] + "," + triple[2] + "," + alpha + ")";
  }

  function mix(a, b, t) {
    if (!a) return b;
    if (!b) return a;
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t),
    ];
  }

  // --- canvas / context guards ---------------------------------------
  function drawableCtx(c) {
    try {
      const g = c && c.getContext ? c.getContext("2d") : null;
      if (!g) return null;
      // jsdom's recording stub is not a real 2D context. Requiring the
      // operations the renderer actually uses keeps every draw guarded.
      if (typeof g.fillRect !== "function" ||
          typeof g.drawImage !== "function" ||
          typeof g.arcTo !== "function" ||
          typeof g.measureText !== "function" ||
          typeof g.strokeText !== "function" ||
          typeof g.createRadialGradient !== "function") {
        return null;
      }
      return g;
    } catch (_) {
      return null;
    }
  }

  function offscreenCtx(c) {
    try {
      const g = c && c.getContext ? c.getContext("2d") : null;
      if (!g) return null;
      if (typeof g.fillRect !== "function" ||
          typeof g.arc !== "function" ||
          typeof g.createRadialGradient !== "function") {
        return null;
      }
      return g;
    } catch (_) {
      return null;
    }
  }

  // --- palette / sprites ---------------------------------------------
  function readPalette() {
    palette = {
      node: parseTriplet(readVar("--graph-node-rgb")) || [130, 168, 255],
      hover: parseTriplet(readVar("--graph-node-hover-rgb")) || [150, 220, 255],
      edge: parseTriplet(readVar("--graph-edge-rgb")) || [124, 156, 255],
      glow: parseTriplet(readVar("--graph-glow-rgb")) || [150, 220, 255],
      warn: parseTriplet(readVar("--graph-warn-rgb")) || [243, 180, 84],
      dim: parseTriplet(readVar("--graph-dim-rgb")) || [80, 92, 120],
      label: parseTriplet(readVar("--graph-label-rgb")) || [230, 234, 245],
      pulse: parseTriplet(readVar("--graph-pulse-rgb")) || [180, 230, 255],
      particle: parseTriplet(readVar("--graph-particle-rgb")) || [130, 168, 255],
      vinIn: parseTriplet(readVar("--graph-vignette-inner-rgb")) || [60, 90, 180],
      vinOut: parseTriplet(readVar("--graph-vignette-edge-rgb")) || [14, 16, 24],
      bg: readVar("--graph-bg") || "#0e1018",
      bgTriple: parseColor(readVar("--graph-bg")) || [14, 16, 24],
      panel: parseColor(readVar("--bg-panel")) || [34, 35, 42],
      border: parseColor(readVar("--border")) || [56, 58, 69],
    };
  }

  function rebuildVisuals() {
    readPalette();
    spriteCache.clear();
    labelWidthCache.clear();
    buildVignette();
    dirty = true;
  }

  function sphereSprite(color) {
    const key = "sphere:" + color.join(",");
    const hit = spriteCache.get(key);
    if (hit) return hit;
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = offscreenCtx(c);
    if (!g) return null;
    const grad = g.createRadialGradient(24, 21, 2, 32, 33, 33);
    grad.addColorStop(0, rgb(mix(color, [255, 255, 255], 0.42), 1));
    grad.addColorStop(0.52, rgb(color, 1));
    grad.addColorStop(1, rgb(mix(color, [0, 0, 0], 0.34), 1));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(32, 32, 32, 0, TAU);
    g.fill();
    spriteCache.set(key, c);
    return c;
  }

  function glowSprite(color) {
    const key = "glow:" + color.join(",");
    const hit = spriteCache.get(key);
    if (hit) return hit;
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = offscreenCtx(c);
    if (!g) return null;
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, rgb(color, 0.55));
    grad.addColorStop(0.35, rgb(color, 0.20));
    grad.addColorStop(1, rgb(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    spriteCache.set(key, c);
    return c;
  }

  function buildVignette() {
    vignette = null;
    if (!palette || !width || !height) return;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(width));
    c.height = Math.max(1, Math.round(height));
    const g = offscreenCtx(c);
    if (!g) return;
    const cx = width * 0.5;
    const cy = height * 0.46;
    const grad = g.createRadialGradient(
      cx, cy, Math.min(width, height) * 0.05,
      cx, height * 0.52, Math.max(width, height) * 0.80
    );
    grad.addColorStop(0, rgb(palette.vinIn, 0.22));
    grad.addColorStop(0.5, rgb(palette.vinIn, 0.07));
    grad.addColorStop(1, rgb(palette.vinOut, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, width, height);
    vignette = c;
  }

  // --- canvas sizing + camera basis ----------------------------------
  function sizeCanvas() {
    if (!el.host || !canvas) return;
    const rect = el.host.getBoundingClientRect();
    width = Math.max(1, rect.width || 0);
    height = Math.max(1, rect.height || 0);
    dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);
    const bw = Math.round(width * dpr);
    const bh = Math.round(height * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    focal = (Math.min(width, height) / 2) / Math.tan(cam.fov / 2);
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildVignette();
    dirty = true;
  }

  function computeBasis() {
    const cp = Math.cos(cam.pitch);
    const sp = Math.sin(cam.pitch);
    const cy = Math.cos(cam.yaw);
    const sy = Math.sin(cam.yaw);
    const dir = { x: cp * sy, y: sp, z: cp * cy };
    const pos = {
      x: cam.target.x + dir.x * cam.dist,
      y: cam.target.y + dir.y * cam.dist,
      z: cam.target.z + dir.z * cam.dist,
    };
    const fwd = { x: -dir.x, y: -dir.y, z: -dir.z };
    let rx = -fwd.z, ry = 0, rz = fwd.x;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl;
    rz /= rl;
    const ux = ry * fwd.z - rz * fwd.y;
    const uy = rz * fwd.x - rx * fwd.z;
    const uz = rx * fwd.y - ry * fwd.x;
    return {
      pos: pos,
      fwd: fwd,
      right: { x: rx, y: ry, z: rz },
      up: { x: ux, y: uy, z: uz },
    };
  }

  function projectPoint(p, b) {
    const rel = { x: p.x - b.pos.x, y: p.y - b.pos.y, z: p.z - b.pos.z };
    const depth = dot3(rel, b.fwd);
    if (depth <= CULL_DEPTH) return null;
    const cx = dot3(rel, b.right);
    const cy = dot3(rel, b.up);
    return {
      x: width / 2 + (cx / depth) * focal,
      y: height / 2 - (cy / depth) * focal,
      depth: depth,
      scale: focal / depth,
      fog: 0,
    };
  }

  function displayZ() {
    return overBudget ? 0 : depthScale;
  }

  function displayPos(n) {
    return { x: n.x, y: n.y, z: n.z * displayZ() };
  }

  function projectNode(n, b) {
    return projectPoint(displayPos(n), b);
  }

  function worldRadius(n) {
    return 6.2 + Math.min(9.5, Math.sqrt(n.degree) * 2.2);
  }

  // --- camera actions -------------------------------------------------
  function setCamera(to) {
    cam.yaw = to.yaw;
    cam.pitch = to.pitch;
    cam.dist = to.dist;
    cam.target.x = to.target.x;
    cam.target.y = to.target.y;
    cam.target.z = to.target.z;
  }

  function fitCamera(animate) {
    let cx = 0, cy = 0, cz = 0;
    const count = nodes.length;
    if (count) {
      for (let i = 0; i < count; i++) {
        const p = displayPos(nodes[i]);
        cx += p.x;
        cy += p.y;
        cz += p.z;
      }
      cx /= count;
      cy /= count;
      cz /= count;
    }
    let radius = 60;
    for (let i = 0; i < count; i++) {
      const p = displayPos(nodes[i]);
      const d = Math.hypot(p.x - cx, p.y - cy, p.z - cz);
      if (d > radius) radius = d;
    }
    const dist = clamp(radius / Math.sin(cam.fov / 2) * 1.12, FIT_MIN_DIST, FIT_MAX_DIST);
    const to = {
      yaw: DEFAULT_YAW,
      pitch: DEFAULT_PITCH,
      dist: dist,
      target: { x: cx, y: cy, z: cz },
    };
    cameraMoved = false;
    if (!animate || reducedMotion || autoRotate) {
      setCamera(to);
      camTween = null;
    } else {
      camTween = {
        t0: nowMs(),
        dur: CAMERA_TWEEN_MS,
        from: {
          yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist,
          target: { x: cam.target.x, y: cam.target.y, z: cam.target.z },
        },
        to: to,
      };
    }
    invalidate();
  }

  function advanceTween(now) {
    if (!camTween) return false;
    const k = clamp((now - camTween.t0) / camTween.dur, 0, 1);
    const e = 1 - Math.pow(1 - k, 3);
    const f = camTween.from;
    const t = camTween.to;
    cam.yaw = lerp(f.yaw, t.yaw, e);
    cam.pitch = lerp(f.pitch, t.pitch, e);
    cam.dist = lerp(f.dist, t.dist, e);
    cam.target.x = lerp(f.target.x, t.target.x, e);
    cam.target.y = lerp(f.target.y, t.target.y, e);
    cam.target.z = lerp(f.target.z, t.target.z, e);
    if (k >= 1) camTween = null;
    dirty = true;
    return true;
  }

  // --- screen / world conversion -------------------------------------
  function localPos(ev) {
    const r = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  function rayFromScreen(sx, sy, b) {
    const nx = (sx - width / 2) / focal;
    const ny = -(sy - height / 2) / focal;
    const dir = {
      x: b.fwd.x + b.right.x * nx + b.up.x * ny,
      y: b.fwd.y + b.right.y * nx + b.up.y * ny,
      z: b.fwd.z + b.right.z * nx + b.up.z * ny,
    };
    const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
    dir.x /= l;
    dir.y /= l;
    dir.z /= l;
    return dir;
  }

  function pointOnPlane(sx, sy, planePoint, b) {
    const dir = rayFromScreen(sx, sy, b);
    const denom = dot3(dir, b.fwd);
    if (Math.abs(denom) < 0.0001) return null;
    const t = dot3({
      x: planePoint.x - b.pos.x,
      y: planePoint.y - b.pos.y,
      z: planePoint.z - b.pos.z,
    }, b.fwd) / denom;
    return {
      x: b.pos.x + dir.x * t,
      y: b.pos.y + dir.y * t,
      z: b.pos.z + dir.z * t,
    };
  }

  function panByPixels(dx, dy) {
    const b = computeBasis();
    const wpp = (2 * cam.dist * Math.tan(cam.fov / 2)) / Math.max(1, height);
    cam.target.x -= b.right.x * dx * wpp;
    cam.target.y -= b.right.y * dx * wpp;
    cam.target.z -= b.right.z * dx * wpp;
    cam.target.x += b.up.x * dy * wpp;
    cam.target.y += b.up.y * dy * wpp;
    cam.target.z += b.up.z * dy * wpp;
    cameraMoved = true;
    invalidate();
  }

  function zoomAt(sx, sy, factor, bias) {
    const b = computeBasis();
    const anchor = pointOnPlane(sx, sy, cam.target, b);
    const newDist = clamp(cam.dist * factor, MIN_DIST, MAX_DIST);
    if (anchor) {
      const k = 1 - newDist / cam.dist;
      cam.target.x += (anchor.x - cam.target.x) * k * bias;
      cam.target.y += (anchor.y - cam.target.y) * k * bias;
      cam.target.z += (anchor.z - cam.target.z) * k * bias;
    }
    cam.dist = newDist;
    cameraMoved = true;
    invalidate();
  }

  // --- picking --------------------------------------------------------
  function pick(sx, sy, touch) {
    const b = computeBasis();
    let best = null;
    let bestDepth = Infinity;
    let bestScore = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const p = projectNode(n, b);
      if (!p) continue;
      const sr = clamp(worldRadius(n) * p.scale, MIN_NODE_R, MAX_NODE_R);
      const hit = Math.max(touch ? 14 : 7, sr * 1.2 + 4);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d > hit) continue;
      if (p.depth < bestDepth - 0.5) {
        best = n;
        bestDepth = p.depth;
        bestScore = d;
      } else if (Math.abs(p.depth - bestDepth) <= 0.5 && d < bestScore) {
        best = n;
        bestScore = d;
      }
    }
    return best;
  }

  // --- selection / BFS ------------------------------------------------
  function distanceMap(startId) {
    const dist = new Map([[startId, 0]]);
    const queue = [startId];
    while (queue.length) {
      const cur = queue.shift();
      const node = byId.get(cur);
      if (!node) continue;
      const d = dist.get(cur);
      node.neighbors.forEach(function (id) {
        if (!dist.has(id)) {
          dist.set(id, d + 1);
          queue.push(id);
        }
      });
    }
    return dist;
  }

  function selectNode(id) {
    if (!byId.has(id)) return;
    selectedId = id;
    selectedDist = distanceMap(id);
    updateChip();
    announceSelection();
    invalidate();
  }

  function clearSelection() {
    if (!selectedId) return;
    selectedId = null;
    selectedDist = null;
    updateChip();
    announce("Selection cleared.");
    invalidate();
  }

  function hopCounts() {
    let hop1 = 0;
    let hop2 = 0;
    if (selectedDist) {
      selectedDist.forEach(function (d, id) {
        if (id === selectedId) return;
        if (d === 1) hop1 += 1;
        else if (d === 2) hop2 += 1;
      });
    }
    return { hop1: hop1, hop2: hop2 };
  }

  function updateChip() {
    if (!el.chip) return;
    if (!selectedId || ready !== "ready") {
      el.chip.hidden = true;
      return;
    }
    const n = byId.get(selectedId);
    if (!n) {
      el.chip.hidden = true;
      return;
    }
    const counts = hopCounts();
    if (el.chipName) el.chipName.textContent = n.label;
    if (el.chipMeta) {
      el.chipMeta.textContent = n.degree + (n.degree === 1 ? " link" : " links") +
        " · " + counts.hop1 + " at hop 1" +
        (counts.hop2 ? " · " + counts.hop2 + " at hop 2" : "");
    }
    el.chip.hidden = false;
  }

  function announce(text) {
    if (el.srLive) el.srLive.textContent = text;
  }

  function announceSelection() {
    if (!selectedId) {
      announce("Selection cleared.");
      return;
    }
    const n = byId.get(selectedId);
    if (!n) return;
    const counts = hopCounts();
    announce("Selected " + n.label + ", " + n.degree +
      (n.degree === 1 ? " link" : " links") + ". " +
      counts.hop1 + " direct " + (counts.hop1 === 1 ? "neighbour" : "neighbours") +
      ", " + counts.hop2 + " at two hops. Press Enter to open it, Escape to clear.");
  }

  function cycleSelection(dir) {
    if (!nodes.length) return;
    const sorted = nodes.slice().sort(function (a, b) {
      return a.label.localeCompare(b.label);
    });
    let idx = sorted.findIndex(function (n) { return n.id === selectedId; });
    if (idx < 0) idx = dir > 0 ? -1 : 0;
    idx = (idx + dir + sorted.length) % sorted.length;
    const n = sorted[idx];
    selectNode(n.id);
    const p = projectNode(n, computeBasis());
    if (!p || p.x < 24 || p.x > width - 24 || p.y < 24 || p.y > height - 24) {
      cameraMoved = true;
      const to = {
        yaw: cam.yaw,
        pitch: cam.pitch,
        dist: cam.dist,
        target: { x: n.x, y: n.y, z: n.z * displayZ() },
      };
      if (reducedMotion || autoRotate) {
        setCamera(to);
        camTween = null;
      } else {
        camTween = {
          t0: nowMs(),
          dur: FOCUS_TWEEN_MS,
          from: {
            yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist,
            target: { x: cam.target.x, y: cam.target.y, z: cam.target.z },
          },
          to: to,
        };
      }
    }
    invalidate();
  }

  // --- filter / summary ----------------------------------------------
  function applyFilter() {
    if (!active) return;
    if (el.filter) filterQuery = (el.filter.value || "").trim().toLowerCase();
    if (!filterQuery) {
      filterSet = null;
    } else {
      const set = new Set();
      nodes.forEach(function (n) {
        if (n.label.toLowerCase().indexOf(filterQuery) >= 0 ||
            n.id.toLowerCase().indexOf(filterQuery) >= 0) {
          set.add(n.id);
        }
      });
      filterSet = set;
    }
    updateSummary();
    invalidate();
  }

  function updateSummary() {
    if (!el.summary) return;
    if (ready === "loading") { el.summary.textContent = "Reading links…"; return; }
    if (ready === "error") { el.summary.textContent = "Not connected"; return; }
    if (ready === "empty") { el.summary.textContent = "0 notes · 0 links"; return; }
    const n = nodes.length;
    const e = edges.length;
    let text = n + " note" + (n === 1 ? "" : "s") + " · " +
      e + " link" + (e === 1 ? "" : "s");
    if (filterQuery) {
      const k = filterSet ? filterSet.size : 0;
      text += " · " + k + (k === 1 ? " match" : " matches");
    }
    el.summary.textContent = text;
  }

  // --- labels ---------------------------------------------------------
  function assignLabels(list) {
    const info = list.map(function (n) {
      return { n: n, parts: n.id.replace(/\.md$/i, "").split("/"), used: 1 };
    });
    for (let guard = 0; guard < 8; guard++) {
      const groups = new Map();
      info.forEach(function (it) {
        const key = it.parts.slice(-it.used).join("/");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(it);
      });
      let changed = false;
      groups.forEach(function (g) {
        if (g.length > 1) {
          g.forEach(function (it) {
            if (it.used < it.parts.length) {
              it.used += 1;
              changed = true;
            }
          });
        }
      });
      if (!changed) break;
    }
    info.forEach(function (it) {
      it.n.label = it.parts.slice(-it.used).join("/");
    });
  }

  // --- physics --------------------------------------------------------
  function stepPhysics() {
    let i, j;
    const n = nodes.length;
    for (i = 0; i < n; i++) {
      nodes[i].fx = 0;
      nodes[i].fy = 0;
      nodes[i].fz = 0;
    }
    for (i = 0; i < n; i++) {
      const a = nodes[i];
      for (j = i + 1; j < n; j++) {
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = a.z - b.z;
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 100) d2 = 100;
        const inv = 1 / Math.sqrt(d2);
        const f = REPULSION / d2;
        const fx = dx * inv * f;
        const fy = dy * inv * f;
        const fz = dz * inv * f;
        a.fx += fx;
        a.fy += fy;
        a.fz += fz;
        b.fx -= fx;
        b.fy -= fy;
        b.fz -= fz;
      }
    }
    for (i = 0; i < edges.length; i++) {
      const e = edges[i];
      const s = e.source;
      const t = e.target;
      const sx = t.x - s.x;
      const sy = t.y - s.y;
      const sz = t.z - s.z;
      const d = Math.sqrt(sx * sx + sy * sy + sz * sz) || 0.01;
      const spring = SPRING_K * (d - SPRING_LEN);
      const ux = sx / d;
      const uy = sy / d;
      const uz = sz / d;
      s.fx += ux * spring;
      s.fy += uy * spring;
      s.fz += uz * spring;
      t.fx -= ux * spring;
      t.fy -= uy * spring;
      t.fz -= uz * spring;
    }
    let energy = 0;
    for (i = 0; i < n; i++) {
      const node = nodes[i];
      node.fx -= node.x * CENTER_K;
      node.fy -= node.y * CENTER_K;
      node.fz -= node.z * CENTER_K;
      if (node.fixed || node === dragNode) {
        node.vx = 0;
        node.vy = 0;
        node.vz = 0;
        continue;
      }
      node.vx = (node.vx + node.fx) * DAMPING;
      node.vy = (node.vy + node.fy) * DAMPING;
      node.vz = (node.vz + node.fz) * DAMPING;
      let speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy + node.vz * node.vz);
      if (speed > MAX_SPEED) {
        const k = MAX_SPEED / speed;
        node.vx *= k;
        node.vy *= k;
        node.vz *= k;
        speed = MAX_SPEED;
      }
      node.x += node.vx;
      node.y += node.vy;
      node.z += node.vz;
      energy += speed * speed;
    }
    if (!dragNode && energy / n < SLEEP_EPS) simRunning = false;
  }

  function warmUp(steps) {
    for (let i = 0; i < steps; i++) stepPhysics();
    nodes.forEach(function (n) { n.vx = n.vy = n.vz = 0; });
    simRunning = false;
  }

  // --- seeds ----------------------------------------------------------
  function seedPosition(id, index, total, flat) {
    const u = hashUnit(id);
    const theta = index * 2.399963229728653 + u * 0.7;
    const radius = 90 + Math.sqrt(Math.max(1, total)) * 22;
    if (flat) {
      return {
        x: Math.cos(theta) * radius,
        y: Math.sin(theta) * radius,
        z: 0,
      };
    }
    const phi = Math.acos(1 - 2 * ((index + 0.5) / Math.max(1, total)));
    return {
      x: Math.sin(phi) * Math.cos(theta) * radius,
      y: Math.cos(phi) * radius,
      z: (u - 0.5) * 2 * (60 + Math.sqrt(Math.max(1, total)) * 18),
    };
  }

  function tierFor(count) {
    if (count <= 300) return "full";
    if (count <= 800) return "reduced";
    if (count <= 1500) return "lite";
    return "over";
  }

  // --- data load / apply ---------------------------------------------
  function applyGraphData(data, options) {
    const opts = options || {};
    const incoming = (data && Array.isArray(data.nodes)) ? data.nodes : [];
    const incomingEdges = (data && Array.isArray(data.edges)) ? data.edges : [];
    const prev = new Map();
    nodes.forEach(function (n) { prev.set(n.id, n); });

    const next = [];
    const nextById = new Map();
    const seen = new Set();
    // The over-budget tier renders flat, so seed new notes on a disk rather
    // than flattening a sphere into a dense centre.
    const flatSeed = incoming.length > 1500;
    for (let i = 0; i < incoming.length; i++) {
      const raw = incoming[i] || {};
      const id = raw.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const seed = seedPosition(id, i, incoming.length, flatSeed);
      const old = prev.get(id);
      const node = {
        id: id,
        name: raw.name || id,
        label: "",
        links: raw.links || 0,
        // Degree is recomputed from the deduplicated edges below; the
        // server's `links` field is only a hint.
        degree: 0,
        neighbors: new Set(),
        x: old ? old.x : seed.x,
        y: old ? old.y : seed.y,
        z: seed.z,
        vx: 0,
        vy: 0,
        vz: 0,
        fx: 0,
        fy: 0,
        fz: 0,
        fixed: false,
      };
      next.push(node);
      if (!nextById.has(id)) nextById.set(id, node);
    }
    nodes = next;
    byId = nextById;

    edges = [];
    const edgeSeen = new Set();
    for (let i = 0; i < incomingEdges.length; i++) {
      const raw = incomingEdges[i] || {};
      const a = byId.get(raw.source);
      const b = byId.get(raw.target);
      if (!a || !b || a === b) continue;
      const key = a.id < b.id ? a.id + "\u0000" + b.id : b.id + "\u0000" + a.id;
      if (edgeSeen.has(key)) continue;
      edgeSeen.add(key);
      edges.push({ source: a, target: b, phase: (edges.length * 0.61803398875) % 1 });
      a.degree += 1;
      b.degree += 1;
      a.neighbors.add(b.id);
      b.neighbors.add(a.id);
    }

    assignLabels(nodes);
    if (selectedId && !byId.has(selectedId)) {
      selectedId = null;
      selectedDist = null;
    }
    if (selectedId) selectedDist = distanceMap(selectedId);
    if (hoverId && !byId.has(hoverId)) hoverId = null;
    if (dragNode && !byId.has(dragNode.id)) dragNode = null;
    if (activeFilePath && !byId.has(activeFilePath)) activeFilePath = null;

    const tierName = tierFor(nodes.length);
    overBudget = tierName === "over";
    tier = TIERS[tierName];

    if (nodes.length + edges.length > PARTICLES_LIMIT && particleFieldEnabled) {
      particleFieldEnabled = false;
      if (NB.evt && NB.evt.emit) NB.evt.emit("graph:pardensity", false);
    }

    const survivorCount = nodes.reduce(function (sum, n) {
      return sum + (prev.has(n.id) ? 1 : 0);
    }, 0);
    const newCount = nodes.length - survivorCount;

    if (!overBudget && newCount > 0) {
      const pairCost = Math.max(1,
        (nodes.length * (nodes.length - 1)) / 2 + edges.length);
      const budgetSteps = Math.max(1, Math.floor(WARMUP_PAIR_BUDGET / pairCost));
      const base = Math.min(tier.warmup, budgetSteps);
      const steps = survivorCount > 0 ? Math.min(80, base) : base;
      warmUp(steps);
      // If the work budget cut the warm-up short, keep settling on the rAF
      // loop instead of painting an under-settled layout. stepPhysics()
      // sleeps as soon as the energy threshold is reached.
      if (steps < tier.warmup) simRunning = true;
    } else {
      nodes.forEach(function (n) { n.vx = n.vy = n.vz = 0; });
      simRunning = false;
    }

    applyFilter();
    updateSrList();
    updateHostLabel();
    updateChip();

    if (nodes.length === 0) {
      setReady("empty");
    } else {
      setReady("ready");
      if (opts.initial || !cameraMoved) fitCamera(!opts.initial);
      if (overBudget && !overBudgetNotified) {
        overBudgetNotified = true;
        showToast("Graph too large for 3D — showing a flat view.");
      } else if (!overBudget) {
        overBudgetNotified = false;
      }
    }
    invalidate();
  }

  function loadGraph(options) {
    const opts = options || {};
    if (!active || fetching) return Promise.resolve();
    fetching = true;
    const hadData = nodes.length > 0;
    if (!hadData) setReady("loading");
    else if (el.refresh) el.refresh.classList.add("is-spinning");
    updateControls();

    let timer = null;
    const timeout = new Promise(function (_, reject) {
      timer = window.setTimeout(function () {
        reject(new Error("Graph request timed out"));
      }, FETCH_TIMEOUT_MS);
    });

    const request = (NB.api && NB.api.getGraph)
      ? Promise.resolve().then(function () { return NB.api.getGraph(); })
      : Promise.reject(new Error("Graph API unavailable"));

    return Promise.race([request, timeout])
      .then(function (data) {
        window.clearTimeout(timer);
        fetching = false;
        if (el.refresh) el.refresh.classList.remove("is-spinning");
        // A mode switch may have deactivated this renderer while the
        // request was in flight; a late result must not mutate the
        // hidden 3D view.
        if (!active) return;
        applyGraphData(data, { initial: !hadData || !!opts.initial });
      })
      .catch(function (err) {
        window.clearTimeout(timer);
        fetching = false;
        if (el.refresh) el.refresh.classList.remove("is-spinning");
        if (!active) return;
        const timedOut = !!(err && err.code === "timeout");
        if (timedOut) notifyGraphTimeout();
        if (hadData) {
          // The rendered graph stays; only the notice says it is stale.
          if (!timedOut) showToast("Couldn’t refresh the graph");
          updateControls();
        } else {
          setReady("error");
        }
        if (window.console && console.warn) console.warn("graph fetch failed", err);
      });
  }

  // --- ready / loading / empty / error -------------------------------
  function setReady(kind) {
    ready = kind;
    const isReady = kind === "ready";

    if (el.state) el.state.hidden = isReady;
    if (!isReady) {
      const copy = STATE_COPY[kind] || STATE_COPY.loading;
      if (el.stateArt) el.stateArt.dataset.kind = kind;
      if (el.stateTitle) el.stateTitle.textContent = copy.title;
      if (el.stateBody) el.stateBody.textContent = copy.body;
      if (el.stateAction) {
        if (copy.action) {
          el.stateAction.hidden = false;
          el.stateAction.textContent = copy.action;
        } else {
          el.stateAction.hidden = true;
        }
      }
      if (el.chip) el.chip.hidden = true;
    } else {
      updateChip();
    }
    if (el.stateCard) {
      el.stateCard.setAttribute("role", kind === "error" ? "alert" : "status");
    }
    // An application region is opaque to some screen readers; only claim it
    // once the canvas is interactive, so the loading/empty/error card is
    // announced as a normal status region.
    if (el.host) el.host.setAttribute("role", isReady ? "application" : "group");
    updateControls();
    updateSummary();
    invalidate();
  }

  function updateControls() {
    // The toolbar is shared with the 2D renderer. An inactive 3D view must
    // not leave the controls disabled for the renderer that is showing.
    if (!active) return;
    const can = ready === "ready";
    if (el.filter) el.filter.disabled = !can;
    if (el.depth) el.depth.disabled = !can || overBudget;
    if (el.fit) el.fit.disabled = !can;
    if (el.zoomIn) el.zoomIn.disabled = !can;
    if (el.zoomOut) el.zoomOut.disabled = !can;
    if (el.rotate) el.rotate.disabled = !can || reducedMotion;
    if (el.refresh) el.refresh.disabled = fetching;
    updateRotateButton();
  }

  function updateRotateButton() {
    if (!el.rotate) return;
    el.rotate.setAttribute("aria-pressed", autoRotate ? "true" : "false");
    el.rotate.setAttribute("aria-label", autoRotate ? "Pause auto-orbit" : "Start auto-orbit");
    el.rotate.title = reducedMotion
      ? "Auto-orbit is off while reduced motion is on"
      : "Auto-orbit (R)";
  }

  // --- toast / hint ---------------------------------------------------
  /* A 504 means the server's walk hit its scan deadline and sent no data.
   * The graph on screen stays; this only says why it is stale. */
  function notifyGraphTimeout() {
    if (NB.app && NB.app.notify) {
      NB.app.notify(GRAPH_TIMEOUT_MESSAGE, NOTIFY_MS, "warn");
    } else {
      showToast(GRAPH_TIMEOUT_MESSAGE);
    }
  }

  function showToast(message) {
    announce(message);
    if (!el.toast) return;
    el.toast.textContent = message;
    el.toast.hidden = false;
    window.requestAnimationFrame(function () {
      if (el.toast) el.toast.classList.add("show");
    });
    window.clearTimeout(toastTimer);
    window.clearTimeout(toastHideTimer);
    toastTimer = window.setTimeout(function () {
      if (!el.toast) return;
      el.toast.classList.remove("show");
      toastHideTimer = window.setTimeout(function () {
        if (el.toast) el.toast.hidden = true;
      }, reducedMotion ? 0 : TOAST_FADE_MS);
    }, TOAST_MS);
  }

  function hideHint() {
    if (hintHidden || !el.hint) return;
    hintHidden = true;
    el.hint.classList.add("is-hidden");
    window.setTimeout(function () {
      if (el.hint) el.hint.hidden = true;
    }, reducedMotion ? 0 : 420);
  }

  // --- reduced motion / theme ----------------------------------------
  function setReducedMotion(on) {
    reducedMotion = !!on;
    if (reducedMotion) {
      autoRotate = false;
      if (camTween) {
        setCamera(camTween.to);
        camTween = null;
      }
    }
    updateControls();
    dirty = true;
  }

  function onThemeChange() {
    rebuildVisuals();
  }

  // --- screen readers -------------------------------------------------
  function updateHostLabel() {
    if (!el.host) return;
    const n = nodes.length;
    const e = edges.length;
    el.host.setAttribute("aria-label",
      "3D graph of " + n + " note" + (n === 1 ? "" : "s") + " and " +
      e + " link" + (e === 1 ? "" : "s") + ". Drag to orbit. Scroll to zoom. " +
      "Right-drag to pan. Click a note to select it. Double-click a note to open it. " +
      "Press left and right bracket to move the selection, Enter to open, " +
      "Escape to clear, Home to reset the camera.");
  }

  function updateSrList() {
    if (!el.srList) return;
    while (el.srList.firstChild) el.srList.removeChild(el.srList.firstChild);
    const sorted = nodes.slice().sort(function (a, b) {
      return a.label.localeCompare(b.label);
    });
    sorted.forEach(function (n) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = "#";
      a.dataset.path = n.id;
      a.textContent = n.label;
      li.appendChild(a);
      el.srList.appendChild(li);
    });
  }

  // --- animation loop -------------------------------------------------
  function invalidate() {
    dirty = true;
    if (active) wake();
  }

  function loop(now) {
    if (!running) return;
    // A file tab hides the graph through viewer.showViewer(), which does not
    // call deactivate(). Treat a hidden view as a deactivation so the loop and
    // auto-orbit stop instead of running (and drawing a 1x1 canvas) forever.
    if (!active || (el.view && el.view.hidden)) {
      deactivate();
      return;
    }

    if (!lastT) lastT = now;
    const dt = Math.min(0.05, (now - lastT) / 1000 || 0.016);
    lastT = now;

    let activeFrame = false;
    if (advanceTween(now)) activeFrame = true;
    if (autoRotate && !reducedMotion && !gesture) {
      cam.yaw += AUTO_ORBIT_RAD_PER_S * dt;
      cameraMoved = true;
      dirty = true;
      activeFrame = true;
    }
    if (simRunning && !overBudget) {
      // The reduced tier simulates at 30Hz; drawing still runs at rAF.
      if (tier.name === "reduced") {
        simFrame = (simFrame + 1) % 2;
        if (simFrame === 0) stepPhysics();
      } else {
        stepPhysics();
      }
      activeFrame = true;
    }
    const ambient = !reducedMotion && (!!hoverId || !!selectedId || autoRotate || particleFieldEnabled);
    if (ready === "ready" && (dirty || activeFrame || ambient)) {
      draw(now);
      dirty = false;
    }
    // Idle costs nothing: stop scheduling once the tween, physics, ambient
    // effects and pending draw are all done. Loading/empty/error states do
    // not spin either; setReady() wakes the loop when data arrives.
    const needsFrame = activeFrame || ambient || !!camTween || simRunning ||
      (ready === "ready" && dirty);
    if (needsFrame) {
      rafId = window.requestAnimationFrame(loop);
    } else {
      running = false;
      rafId = null;
    }
  }

  function wake() {
    if (running) return;
    running = true;
    lastT = 0;
    rafId = window.requestAnimationFrame(loop);
  }

  function sleep() {
    running = false;
    if (rafId) window.cancelAnimationFrame(rafId);
    rafId = null;
  }

  // --- drawing --------------------------------------------------------
  function textWidth(text, strong) {
    if (!ctx) return text.length * 7;
    const key = (strong ? "s:" : "n:") + text;
    const hit = labelWidthCache.get(key);
    if (hit != null) return hit;
    ctx.font = strong ? LABEL_FONT_STRONG : LABEL_FONT;
    const w = ctx.measureText(text).width;
    labelWidthCache.set(key, w);
    return w;
  }

  function roundRect(g, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rr, y);
    g.arcTo(x + w, y, x + w, y + h, rr);
    g.arcTo(x + w, y + h, x, y + h, rr);
    g.arcTo(x, y + h, x, y, rr);
    g.arcTo(x, y, x + w, y, rr);
    g.closePath();
  }

  function truncate(text) {
    if (text.length > LABEL_MAX_CHARS) {
      return text.slice(0, LABEL_MAX_CHARS - 1) + "…";
    }
    return text;
  }

  function drawParticles() {
    if (!particles) return;
    const W = width || 1;
    const H = height || 1;
    const part = (palette && palette.particle) || [130, 168, 255];
    for (let i = 0; i < particles.length; i++) {
      const a = particles[i];
      a.x = (a.x + a.vx + 1) % 1;
      a.y = (a.y + a.vy + 1) % 1;
      const ax = a.x * W;
      const ay = a.y * H;
      ctx.fillStyle = rgb(part, 0.20);
      ctx.beginPath();
      ctx.arc(ax, ay, 1, 0, TAU);
      ctx.fill();
      for (let j = i + 1; j < particles.length; j++) {
        const b = particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0.01) continue;
        const d = Math.sqrt(d2);
        const t = 1 - d / 0.1;
        ctx.strokeStyle = rgb(part, 0.06 + 0.10 * t);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(b.x * W, b.y * H);
        ctx.stroke();
      }
    }
  }

  function initParticles() {
    if (particles) return;
    const count = Math.min(100, Math.max(60, Math.round((width * height) / 24000)));
    particles = new Array(count);
    for (let i = 0; i < count; i++) {
      particles[i] = {
        x: Math.random(),
        y: Math.random(),
        vx: (Math.random() - 0.5) * 0.0004,
        vy: (Math.random() - 0.5) * 0.0004,
      };
    }
  }

  function edgeStyle(e, a, b, hoverIdNow, hoverSet, selDist, filterSetNow) {
    const ds = selDist ? (selDist.get(e.source.id) === undefined ? Infinity : selDist.get(e.source.id)) : Infinity;
    const dt = selDist ? (selDist.get(e.target.id) === undefined ? Infinity : selDist.get(e.target.id)) : Infinity;
    // The farthest endpoint decides the band: a selected->hop-1 edge is
    // hop 1, not hop 0. Using the minimum would hide the most important
    // edges behind the disconnected style.
    const hop = Math.max(ds, dt);
    const hoverIncident = hoverIdNow && (e.source.id === hoverIdNow || e.target.id === hoverIdNow);
    const hoverIn = hoverIdNow && hoverSet &&
      (e.source.id === hoverIdNow || hoverSet.has(e.source.id)) &&
      (e.target.id === hoverIdNow || hoverSet.has(e.target.id));

    let alpha;
    let weight;
    let color = palette.edge;
    let glow = false;

    if (selDist) {
      if (hop === 1) { alpha = 0.88; weight = 2.0; color = mix(palette.edge, palette.warn, 0.34); glow = true; }
      else if (hop === 2) { alpha = 0.52; weight = 1.5; color = mix(palette.edge, palette.warn, 0.16); }
      else if (hop >= 3 && hop !== Infinity) { alpha = 0.32; weight = 1.2; color = mix(palette.edge, palette.dim, 0.24); }
      else { alpha = 0.055; weight = 1.0; color = palette.dim; }
      if (hoverIncident) {
        alpha = Math.max(alpha, 0.92);
        weight = 2.1;
        glow = true;
        color = mix(palette.edge, palette.glow, 0.42);
      }
    } else if (hoverIdNow) {
      if (hoverIncident) { alpha = 0.92; weight = 1.9; color = mix(palette.edge, palette.glow, 0.34); glow = true; }
      else if (hoverIn) { alpha = 0.38; weight = 1.2; }
      else { alpha = 0.055; weight = 1.0; color = palette.dim; }
    } else {
      alpha = 0.44 * (1 - 0.5 * b.fog);
      weight = 1.15;
    }

    if (filterSetNow) {
      const ms = filterSetNow.has(e.source.id);
      const mt = filterSetNow.has(e.target.id);
      if (!ms && !mt) alpha *= 0.12;
      else if (!ms || !mt) alpha *= 0.34;
    }
    alpha *= (1 - 0.3 * ((a.fog + b.fog) / 2));
    if (tier.name !== "full" && glow) glow = false;
    return { alpha: clamp(alpha, 0, 1), width: weight, color: color, glow: glow };
  }

  function labelsFor(projected, hoverIdNow, hoverSet, selDist, filterSetNow, capIdle, capFocus) {
    const out = [];
    for (let i = 0; i < projected.length; i++) {
      const rec = projected[i];
      const n = rec.n;
      if (rec.x < -80 || rec.x > width + 80 || rec.y < -80 || rec.y > height + 80) continue;
      if (filterSetNow && !filterSetNow.has(n.id)) continue;

      const isSel = n.id === selectedId;
      if (selDist && !isSel && selDist.get(n.id) === undefined) continue;
      const isHover = n.id === hoverIdNow;
      const isHoverNb = hoverSet && hoverSet.has(n.id);
      const sel = selDist ? selDist.get(n.id) : undefined;
      const isSelNb = sel === 1;
      const isHub = n.degree >= 6;
      const forced = isSel || isHover;

      let show;
      if (hoverIdNow) {
        show = isHover || isHoverNb || isSel || isSelNb;
      } else if (selDist) {
        show = isSel || isSelNb || isHub;
      } else if (filterSetNow) {
        show = filterSetNow.size <= 12 || isHub || rec.fog < 0.38;
      } else {
        show = isHub || rec.fog < 0.46;
      }
      if (!show) continue;
      if (!forced && rec.fog > 0.78) continue;

      out.push({
        rec: rec,
        text: truncate(n.label),
        forced: forced,
        priority: forced ? 0 : (isHub ? 1 : 2) + rec.fog,
      });
    }
    const cap = (stateHasFocus() ? capFocus : capIdle);
    out.sort(function (a, b) {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.rec.depth - b.rec.depth;
    });
    if (out.length > cap) out.length = cap;
    return out;
  }

  function stateHasFocus() {
    return !!(filterQuery || hoverId || selectedId);
  }

  function overlapsAny(list, r) {
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (r.x < p.x + p.w + 2 && r.x + r.w + 2 > p.x &&
          r.y < p.y + p.h + 2 && r.y + r.h + 2 > p.y) return true;
    }
    return false;
  }

  function drawLabels(projected, hoverIdNow, hoverSet, selDist, filterSetNow) {
    const capIdle = tier.labelIdle;
    const capFocus = tier.labelFocus;
    const candidates = labelsFor(projected, hoverIdNow, hoverSet, selDist, filterSetNow, capIdle, capFocus);
    if (!candidates.length) return;

    const placed = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const strong = c.forced;
      const text = c.text;
      const w = textWidth(text, strong);
      const boxW = w + 10;
      const boxH = 17;
      const gap = c.rec.drawR + 7;
      const cy = c.rec.y;
      const tries = [
        { x: c.rec.x + gap, y: cy },
        { x: c.rec.x - gap - boxW, y: cy },
        { x: c.rec.x - boxW / 2, y: cy - c.rec.drawR - 7 - boxH / 2 },
        { x: c.rec.x - boxW / 2, y: cy + c.rec.drawR + 7 + boxH / 2 },
      ];
      let chosen = null;
      for (let t = 0; t < tries.length; t++) {
        const x = clamp(tries[t].x, 8, width - boxW - 8);
        const y = clamp(tries[t].y, boxH / 2 + 8, height - boxH / 2 - 8);
        const rect = { x: x, y: y - boxH / 2, w: boxW, h: boxH };
        if (!overlapsAny(placed, rect)) {
          chosen = { x: x, y: y, rect: rect };
          break;
        }
      }
      if (!chosen && c.forced) {
        const x2 = clamp(tries[0].x, 8, width - boxW - 8);
        const y2 = clamp(cy, boxH / 2 + 8, height - boxH / 2 - 8);
        chosen = { x: x2, y: y2, rect: { x: x2, y: y2 - boxH / 2, w: boxW, h: boxH } };
      }
      if (!chosen) continue;
      placed.push(chosen.rect);
      c.box = chosen;
    }

    const drawables = candidates.filter(function (c) { return !!c.box; });
    drawables.sort(function (a, b) { return b.rec.depth - a.rec.depth; });

    const warnInk = stateIsLight() ? mix(palette.warn, palette.label, 0.30) : palette.warn;
    for (let i = 0; i < drawables.length; i++) {
      const c = drawables[i];
      const rec = c.rec;
      const box = c.box;
      const isFocus = c.forced;
      const isSel = rec.n.id === selectedId;
      const isHover = rec.n.id === hoverIdNow;
      let alpha = clamp(rec.alpha * 1.35, 0.12, 1);
      if (isFocus) alpha = 1;

      ctx.font = isFocus ? LABEL_FONT_STRONG : LABEL_FONT;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";

      if (isFocus) {
        ctx.globalAlpha = 1;
        roundRect(ctx, box.x, box.y, box.w, box.h, 5);
        ctx.fillStyle = rgb(palette.panel, stateIsLight() ? 0.94 : 0.9);
        ctx.fill();
        ctx.strokeStyle = isSel
          ? rgb(warnInk, stateIsLight() ? 0.9 : 0.62)
          : rgb(palette.glow, 0.48);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = rgb(palette.label, 1);
        ctx.fillText(truncate(rec.n.label), box.x + 5, box.y + box.h / 2 + 0.5);
      } else {
        const textOut = truncate(rec.n.label);
        ctx.globalAlpha = alpha;
        ctx.lineJoin = "round";
        ctx.strokeStyle = rgb(palette.bgTriple, stateIsLight() ? 0.9 : 0.86);
        ctx.lineWidth = 3;
        ctx.strokeText(textOut, box.x + 5, box.y + box.h / 2 + 0.5);
        ctx.fillStyle = rgb(palette.label, 1);
        ctx.fillText(textOut, box.x + 5, box.y + box.h / 2 + 0.5);
      }
    }
    ctx.globalAlpha = 1;
  }

  function stateIsLight() {
    return document.body && document.body.dataset &&
      document.body.dataset.theme === "light";
  }

  function draw(now) {
    if (!ctx || !palette || !width || !height || !active) return;
    const b = computeBasis();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, width, height);
    if (vignette) ctx.drawImage(vignette, 0, 0, width, height);
    if (particleFieldEnabled && !reducedMotion) {
      initParticles();
      drawParticles();
    }

    const hoverIdNow = hoverId;
    const selectedIdNow = selectedId;
    const selDist = selectedIdNow ? selectedDist : null;
    const filterSetNow = filterSet;
    const hoverSet = hoverIdNow && byId.get(hoverIdNow) ? byId.get(hoverIdNow).neighbors : null;

    const projected = [];
    projection.clear();
    let minD = Infinity;
    let maxD = -Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const p = projectNode(n, b);
      if (!p) continue;
      const sr = clamp(worldRadius(n) * p.scale, MIN_NODE_R, MAX_NODE_R);
      const rec = {
        n: n,
        x: p.x,
        y: p.y,
        depth: p.depth,
        sr: sr,
        fog: 0,
        alpha: 1,
        color: palette.node,
        drawR: sr,
      };
      projected.push(rec);
      projection.set(n.id, rec);
      if (p.depth < minD) minD = p.depth;
      if (p.depth > maxD) maxD = p.depth;
    }
    const fogSpan = Math.max(1, maxD - minD);

    for (let i = 0; i < projected.length; i++) {
      const rec = projected[i];
      const n = rec.n;
      rec.fog = clamp((rec.depth - minD) / fogSpan, 0, 1);
      const sel = selDist ? selDist.get(n.id) : undefined;
      const inHover = !hoverIdNow || n.id === hoverIdNow || (hoverSet && hoverSet.has(n.id));
      const inSel = sel !== undefined && sel <= 2;
      const matches = !filterSetNow || filterSetNow.has(n.id);

      let dim = 1;
      if (filterSetNow && !matches) dim *= 0.14;
      if (hoverIdNow && !inHover) dim *= inSel ? 0.58 : 0.16;

      let color = palette.node;
      if (n.id === selectedIdNow) {
        color = palette.warn;
      } else if (selDist && sel === undefined) {
        color = mix(palette.node, palette.dim, 0.48);
        dim *= 0.26;
      } else if (sel === 1) {
        color = mix(palette.node, palette.warn, 0.82);
      } else if (sel === 2) {
        color = mix(palette.node, palette.warn, 0.44);
      } else if (sel !== undefined && sel >= 3) {
        color = mix(palette.node, palette.dim, 0.52);
      } else if (n.id === hoverIdNow) {
        color = palette.hover;
      } else if (hoverSet && hoverSet.has(n.id)) {
        color = mix(palette.node, palette.hover, 0.44);
      }

      const fogAlpha = 1 - 0.5 * Math.pow(rec.fog, 1.25);
      rec.alpha = clamp(dim * fogAlpha, 0.04, 1);
      if (n.id === selectedIdNow) {
        rec.alpha = Math.max(rec.alpha, (filterSetNow && !matches) ? 0.45 : 0.72);
      }
      rec.color = color;
      rec.drawR = rec.sr * (n.id === selectedIdNow ? 1.14 : n.id === hoverIdNow ? 1.1 : 1);
    }

    // Edges: far to near.
    const edgeRecs = [];
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const ra = projection.get(e.source.id);
      const rb = projection.get(e.target.id);
      if (!ra || !rb) continue;
      edgeRecs.push({ e: e, a: ra, b: rb, depth: (ra.depth + rb.depth) / 2 });
    }
    edgeRecs.sort(function (x, y) { return y.depth - x.depth; });

    ctx.lineCap = "round";
    for (let i = 0; i < edgeRecs.length; i++) {
      const er = edgeRecs[i];
      const style = edgeStyle(er.e, er.a, er.b, hoverIdNow, hoverSet, selDist, filterSetNow);
      if (style.alpha <= 0.012) continue;
      if (style.glow) {
        ctx.globalAlpha = style.alpha * 0.22;
        ctx.strokeStyle = rgb(style.color, 1);
        ctx.lineWidth = style.width + 4;
        ctx.beginPath();
        ctx.moveTo(er.a.x, er.a.y);
        ctx.lineTo(er.b.x, er.b.y);
        ctx.stroke();
      }
      ctx.globalAlpha = style.alpha;
      ctx.strokeStyle = rgb(style.color, 1);
      ctx.lineWidth = style.width;
      ctx.beginPath();
      ctx.moveTo(er.a.x, er.a.y);
      ctx.lineTo(er.b.x, er.b.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Signal pulses: focus only, capped by the tier.
    if (!reducedMotion && tier.pulseCap > 0) {
      const pulses = [];
      for (let i = 0; i < edges.length && pulses.length < tier.pulseCap; i++) {
        const pe = edges[i];
        let focusEdge = false;
        if (selDist) {
          const ds = selDist.get(pe.source.id);
          const dt = selDist.get(pe.target.id);
          focusEdge = ds === 1 || dt === 1;
        }
        if (tier.name !== "reduced") {
          if (!focusEdge && hoverIdNow) {
            focusEdge = pe.source.id === hoverIdNow || pe.target.id === hoverIdNow;
          }
          if (!focusEdge && dragNode) {
            focusEdge = pe.source === dragNode || pe.target === dragNode;
          }
        }
        if (focusEdge) pulses.push(pe);
      }
      for (let i = 0; i < pulses.length; i++) {
        const pe = pulses[i];
        const pa = projection.get(pe.source.id);
        const pb = projection.get(pe.target.id);
        if (!pa || !pb) continue;
        const t = ((now / 2600) + pe.phase) % 1;
        const hx = lerp(pa.x, pb.x, t);
        const hy = lerp(pa.y, pb.y, t);
        const tx = lerp(pa.x, pb.x, Math.max(0, t - 0.07));
        const ty = lerp(pa.y, pb.y, Math.max(0, t - 0.07));
        const depthFade = 1 - 0.4 * ((pa.fog + pb.fog) / 2);
        ctx.globalAlpha = 0.55 * depthFade;
        ctx.strokeStyle = rgb(palette.pulse, 1);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(hx, hy);
        ctx.stroke();
        ctx.globalAlpha = 0.95 * depthFade;
        ctx.fillStyle = rgb(palette.pulse, 1);
        ctx.beginPath();
        ctx.arc(hx, hy, 1.9, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Nodes: far to near.
    projected.sort(function (x, y) { return y.depth - x.depth; });
    const breath = reducedMotion ? 0.38 : (Math.sin(now / 420) + 1) / 2;
    const warnInk = stateIsLight() ? mix(palette.warn, palette.label, 0.30) : palette.warn;
    const nearBloom = new Set();
    if (tier.bloom === "near") {
      const byDepth = projected.slice().sort(function (a, b) { return a.depth - b.depth; });
      for (let i = 0; i < Math.min(100, byDepth.length); i++) nearBloom.add(byDepth[i].n.id);
    }

    for (let i = 0; i < projected.length; i++) {
      const rec = projected[i];
      const n = rec.n;
      const sr = rec.drawR;
      const alpha = rec.alpha;
      const isSel = n.id === selectedIdNow;
      const isHover = n.id === hoverIdNow;
      const bloom = tier.bloom === "all" ||
        (tier.bloom === "near" && (isSel || isHover || nearBloom.has(n.id)));

      if (bloom) {
        const glowAlpha = alpha * (isSel ? 0.85 : isHover ? 0.72 : (0.5 - 0.26 * rec.fog));
        if (glowAlpha > 0.02) {
          const gs = glowSprite(rec.color);
          if (gs) {
            ctx.globalAlpha = glowAlpha;
            const gr = sr * 3.4;
            ctx.drawImage(gs, rec.x - gr, rec.y - gr, gr * 2, gr * 2);
          }
        }
      }

      ctx.globalAlpha = alpha;
      const ss = sphereSprite(rec.color);
      if (ss) {
        ctx.drawImage(ss, rec.x - sr, rec.y - sr, sr * 2, sr * 2);
      } else {
        ctx.fillStyle = rgb(rec.color, 1);
        ctx.beginPath();
        ctx.arc(rec.x, rec.y, sr, 0, TAU);
        ctx.fill();
      }

      if (n.id === activeFilePath && !isSel) {
        ctx.globalAlpha = alpha * 0.55;
        ctx.strokeStyle = rgb(warnInk, 1);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(rec.x, rec.y, sr + 2.4, 0, TAU);
        ctx.stroke();
      }

      if (isHover && !isSel) {
        // A filter wins over hover: a non-matching hovered node stays dim,
        // so its ring must not jump to full brightness.
        const hoverDimmed = filterSetNow && !filterSetNow.has(n.id);
        ctx.globalAlpha = hoverDimmed ? Math.min(0.30, alpha) : Math.max(0.8, alpha);
        ctx.strokeStyle = rgb(palette.glow, 1);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(rec.x, rec.y, sr + 4, 0, TAU);
        ctx.stroke();
      }

      if (isSel) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = rgb(warnInk, stateIsLight() ? 0.95 : 0.9);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(rec.x, rec.y, sr + 3.2, 0, TAU);
        ctx.stroke();

        if (reducedMotion) {
          ctx.strokeStyle = rgb(warnInk, 0.45);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(rec.x, rec.y, sr + 6, 0, TAU);
          ctx.stroke();
        } else {
          ctx.strokeStyle = rgb(warnInk, 0.16 + 0.4 * breath);
          ctx.lineWidth = 1.2 + 1.6 * breath;
          ctx.beginPath();
          ctx.arc(rec.x, rec.y, sr + 5 + 8.5 * breath, 0, TAU);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;

    drawLabels(projected, hoverIdNow, hoverSet, selDist, filterSetNow);
  }

  // --- node drag / pointer core --------------------------------------
  function startNodeDrag(n, pos) {
    dragNode = n;
    dragOrigin = { x: n.x, y: n.y, z: n.z };
    dragDown = { x: pos.x, y: pos.y };
    n.fixed = true;
    simRunning = true;
  }

  function dragNodeTo(pos) {
    const n = dragNode;
    if (!n || !dragOrigin || !dragDown) return;
    const b = computeBasis();
    const planePoint = { x: dragOrigin.x, y: dragOrigin.y, z: dragOrigin.z * displayZ() };
    const from = pointOnPlane(dragDown.x, dragDown.y, planePoint, b);
    const to = pointOnPlane(pos.x, pos.y, planePoint, b);
    if (!from || !to) return;
    // Apply the pointer delta instead of teleporting the node centre to the
    // cursor, so grabbing a node near its edge does not snap it.
    n.x = dragOrigin.x + (to.x - from.x);
    n.y = dragOrigin.y + (to.y - from.y);
    n.z = displayZ() > 0.02 ? dragOrigin.z + (to.z - from.z) / displayZ() : 0;
    n.vx = 0;
    n.vy = 0;
    n.vz = 0;
    simRunning = tier.name !== "lite" && tier.name !== "over";
    invalidate();
  }

  function releaseNodeDrag() {
    if (!dragNode) return;
    dragNode.fixed = false;
    dragNode = null;
    dragOrigin = null;
    dragDown = null;
    simRunning = tier.name === "full" || tier.name === "reduced";
    invalidate();
  }

  function pinchInfo() {
    const pts = Array.from(pointers.values());
    if (pts.length < 2) return null;
    const ax = pts[0].x, ay = pts[0].y, bx = pts[1].x, by = pts[1].y;
    return {
      dist: Math.hypot(ax - bx, ay - by) || 1,
      cx: (ax + bx) / 2,
      cy: (ay + by) / 2,
    };
  }

  function setHover(id) {
    if (!active || hoverId === id) return;
    hoverId = id;
    invalidate();
  }

  function beginPointer(id, pos, meta) {
    if (!active || ready !== "ready") return;
    if (el.host && el.host.focus) el.host.focus({ preventScroll: true });
    hideHint();
    camTween = null;
    last = pos;
    pointers.set(id, { x: pos.x, y: pos.y, type: meta.pointerType || "mouse" });

    if (pointers.size === 2) {
      if (gesture === "node") releaseNodeDrag();
      gesture = "pinch";
      pinchPrev = pinchInfo();
      if (el.host) el.host.classList.add("is-grabbing");
      return;
    }

    const panButton = meta.button === 2 || meta.button === 1 ||
      (meta.button === 0 && meta.shiftKey);
    const hit = panButton ? null : pick(pos.x, pos.y, meta.pointerType !== "mouse");

    if (panButton) {
      gesture = "pan";
    } else if (hit) {
      gesture = "node";
      startNodeDrag(hit, pos);
      if (meta.pointerType !== "mouse") setHover(hit.id);
    } else {
      gesture = "orbit";
      if (meta.pointerType !== "mouse") setHover(null);
    }

    downInfo = {
      x: pos.x,
      y: pos.y,
      button: meta.button || 0,
      moved: false,
      pointerType: meta.pointerType || "mouse",
      startedOn: hit ? hit.id : null,
    };
    if (el.host) el.host.classList.add("is-grabbing");
  }

  function movePointer(id, pos) {
    if (!active || !pointers.has(id)) return;
    pointers.set(id, { x: pos.x, y: pos.y, type: pointers.get(id).type });

    if (gesture === "pinch") {
      const cur = pinchInfo();
      if (cur && pinchPrev) {
        const factor = pinchPrev.dist / cur.dist;
        zoomAt(cur.cx, cur.cy, factor, WHEEL_CURSOR_BIAS);
        panByPixels(cur.cx - pinchPrev.cx, cur.cy - pinchPrev.cy);
      }
      pinchPrev = cur;
      invalidate();
      return;
    }

    const dx = pos.x - last.x;
    const dy = pos.y - last.y;
    if (downInfo && Math.abs(pos.x - downInfo.x) + Math.abs(pos.y - downInfo.y) > DRAG_THRESHOLD) {
      downInfo.moved = true;
    }

    if (gesture === "orbit") {
      cam.yaw -= dx * ORBIT_YAW_PER_PX;
      cam.pitch = clamp(cam.pitch + dy * ORBIT_PITCH_PER_PX, MIN_PITCH, MAX_PITCH);
      cameraMoved = true;
      computeBasis();
    } else if (gesture === "pan") {
      panByPixels(dx, dy);
    } else if (gesture === "node" && downInfo && downInfo.moved) {
      dragNodeTo(pos);
    }

    last = pos;
    invalidate();
  }

  function handleTap(node, info) {
    const now = nowMs();
    if (now - lastTap.t < DOUBLE_TAP_MS &&
        Math.hypot(info.x - lastTap.x, info.y - lastTap.y) < DOUBLE_TAP_PX &&
        lastTap.id === node.id) {
      if (NB.evt && NB.evt.emit) NB.evt.emit("file:open-request", node.id);
      lastTap = { t: 0, x: 0, y: 0, id: null };
    } else {
      lastTap = { t: now, x: info.x, y: info.y, id: node.id };
    }
  }

  function endPointer(id, pos) {
    if (!active || !pointers.has(id)) return;
    const wasGesture = gesture;
    const info = downInfo;
    pointers.delete(id);
    if (wasGesture === "node") releaseNodeDrag();

    if (pointers.size === 0) {
      if (el.host) el.host.classList.remove("is-grabbing");
      if (wasGesture === "pinch") {
        gesture = null;
        downInfo = null;
        pinchPrev = null;
        invalidate();
        return;
      }
      if (info && !info.moved && info.button === 0) {
        const hit = pick(pos.x, pos.y, info.pointerType !== "mouse");
        if (hit) {
          selectNode(hit.id);
          handleTap(hit, info);
        } else {
          clearSelection();
        }
      }
      gesture = null;
      downInfo = null;
      pinchPrev = null;
      if (info && info.pointerType === "mouse") {
        const hover = pick(pos.x, pos.y, false);
        setHover(hover ? hover.id : null);
        if (canvas) canvas.style.cursor = hover ? "pointer" : "grab";
      } else {
        setHover(null);
      }
      invalidate();
    } else if (pointers.size === 1) {
      gesture = "pinch";
      pinchPrev = null;
    }
  }

  function wheelDeltaPx(ev) {
    if (ev.deltaMode === 1) return ev.deltaY * WHEEL_LINE_PX;
    if (ev.deltaMode === 2) return ev.deltaY * Math.max(1, height);
    return ev.deltaY;
  }

  function onWheel(ev) {
    if (!active || ready !== "ready") return;
    ev.preventDefault();
    hideHint();
    camTween = null;
    const pos = localPos(ev);
    const factor = Math.exp(wheelDeltaPx(ev) * WHEEL_ZOOM_PER_PX);
    zoomAt(pos.x, pos.y, factor, WHEEL_CURSOR_BIAS);
  }

  // --- event wiring ---------------------------------------------------
  function bindPointerEvents() {
    if (!canvas) return;
    const hasPointer = typeof window.PointerEvent !== "undefined";

    if (hasPointer) {
      canvas.addEventListener("pointerdown", function (ev) {
        if (ev.button !== undefined && ev.button > 2) return;
        try { canvas.setPointerCapture(ev.pointerId); } catch (_) {}
        beginPointer(ev.pointerId, localPos(ev), {
          button: ev.button,
          shiftKey: ev.shiftKey,
          pointerType: ev.pointerType,
        });
      });
      canvas.addEventListener("pointermove", function (ev) {
        if (!active) return;
        if (pointers.has(ev.pointerId)) {
          movePointer(ev.pointerId, localPos(ev));
          return;
        }
        if (ev.pointerType === "mouse" && !gesture && ready === "ready") {
          const pos = localPos(ev);
          const h = pick(pos.x, pos.y, false);
          setHover(h ? h.id : null);
          canvas.style.cursor = h ? "pointer" : "grab";
        }
      });
      canvas.addEventListener("pointerup", function (ev) {
        endPointer(ev.pointerId, localPos(ev));
      });
      canvas.addEventListener("pointercancel", function (ev) {
        endPointer(ev.pointerId, localPos(ev));
      });
      canvas.addEventListener("pointerleave", function () {
        if (!gesture && !pointers.size) {
          setHover(null);
          canvas.style.cursor = "grab";
        }
      });
    } else {
      // Fallback for environments without Pointer Events (jsdom and very
      // old browsers). Real touch devices use the pointer branch above.
      canvas.addEventListener("mousedown", function (ev) {
        if (ev.button !== undefined && ev.button > 2) return;
        beginPointer("mouse", localPos(ev), {
          button: ev.button,
          shiftKey: ev.shiftKey,
          pointerType: "mouse",
        });
      });
      canvas.addEventListener("mousemove", function (ev) {
        if (!active) return;
        if (pointers.has("mouse") || gesture) return;
        if (ready !== "ready") return;
        const pos = localPos(ev);
        const h = pick(pos.x, pos.y, false);
        setHover(h ? h.id : null);
        canvas.style.cursor = h ? "pointer" : "grab";
      });
      window.addEventListener("mousemove", function (ev) {
        if (!pointers.has("mouse")) return;
        movePointer("mouse", localPos(ev));
      });
      window.addEventListener("mouseup", function (ev) {
        if (!pointers.has("mouse")) return;
        endPointer("mouse", localPos(ev));
      });
      canvas.addEventListener("mouseleave", function () {
        if (!gesture && !pointers.size) {
          setHover(null);
          canvas.style.cursor = "grab";
        }
      });
    }

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", function (ev) { ev.preventDefault(); });
  }

  function bindControls() {
    if (el.filter) {
      el.filter.addEventListener("input", applyFilter);
      el.filter.addEventListener("keydown", function (ev) {
        if (!active || ev.key !== "Escape") return;
        ev.stopPropagation();
        if (el.filter.value) {
          el.filter.value = "";
          applyFilter();
        } else if (el.host) {
          el.host.focus({ preventScroll: true });
        }
      });
    }

    if (el.depth) {
      el.depth.addEventListener("input", function () {
        if (!active) return;
        const v = clamp(parseFloat(el.depth.value) || 0, 0, 100);
        const next = v / 100;
        const old = depthScale;
        camTween = null;
        if (old > 0.001) cam.target.z *= next / old;
        depthScale = next;
        if (el.depthValue) el.depthValue.textContent = v + "%";
        el.depth.setAttribute("aria-valuetext", v + " percent");
        invalidate();
      });
    }

    if (el.rotate) {
      el.rotate.addEventListener("click", function () {
        if (!active || reducedMotion || ready !== "ready") return;
        autoRotate = !autoRotate;
        if (autoRotate) camTween = null;
        updateRotateButton();
        invalidate();
      });
    }

    if (el.fit) el.fit.addEventListener("click", function () {
      if (!active) return;
      fitCamera(true);
    });
    if (el.zoomIn) el.zoomIn.addEventListener("click", function () {
      if (!active) return;
      camTween = null;
      zoomAt(width / 2, height / 2, 1 / TOOLBAR_ZOOM, 0);
    });
    if (el.zoomOut) el.zoomOut.addEventListener("click", function () {
      if (!active) return;
      camTween = null;
      zoomAt(width / 2, height / 2, TOOLBAR_ZOOM, 0);
    });
    if (el.refresh) el.refresh.addEventListener("click", function () {
      if (!active) return;
      loadGraph();
    });
    if (el.stateAction) el.stateAction.addEventListener("click", function () {
      if (!active) return;
      loadGraph();
    });

    if (el.chipClose) {
      el.chipClose.addEventListener("click", function () {
        if (!active) return;
        clearSelection();
        if (el.host) el.host.focus({ preventScroll: true });
      });
    }

    if (el.srList) {
      el.srList.addEventListener("click", function (ev) {
        if (!active) return;
        const target = ev.target;
        const link = target && target.closest ? target.closest("a[data-path]") : null;
        if (!link) return;
        ev.preventDefault();
        if (NB.evt && NB.evt.emit) NB.evt.emit("file:open-request", link.dataset.path);
      });
    }

    if (el.host) {
      el.host.setAttribute("tabindex", "0");
      el.host.setAttribute("role", "application");
      el.host.addEventListener("keydown", onHostKeyDown);
    }
  }

  function onHostKeyDown(ev) {
    if (!active || ready !== "ready") return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const target = ev.target;
    if (target && target !== el.host) {
      const tag = (target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "button" || tag === "textarea" ||
          tag === "select" || tag === "a") {
        return;
      }
    }
    const k = ev.key;

    if (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown") {
      ev.preventDefault();
      hideHint();
      camTween = null;
      const step = KEY_ORBIT_STEP;
      if (ev.shiftKey) {
        if (k === "ArrowLeft") panByPixels(KEY_PAN_STEP, 0);
        else if (k === "ArrowRight") panByPixels(-KEY_PAN_STEP, 0);
        else if (k === "ArrowUp") panByPixels(0, KEY_PAN_STEP);
        else panByPixels(0, -KEY_PAN_STEP);
      } else {
        if (k === "ArrowLeft") cam.yaw += step;
        else if (k === "ArrowRight") cam.yaw -= step;
        else if (k === "ArrowUp") cam.pitch = clamp(cam.pitch - step, MIN_PITCH, MAX_PITCH);
        else cam.pitch = clamp(cam.pitch + step, MIN_PITCH, MAX_PITCH);
        cameraMoved = true;
      }
      invalidate();
      return;
    }

    if (k === "+" || k === "=" || k === "-" || k === "_") {
      ev.preventDefault();
      hideHint();
      camTween = null;
      zoomAt(width / 2, height / 2, (k === "+" || k === "=") ? 1 / KEY_ZOOM : KEY_ZOOM, 0);
      return;
    }

    if (k === "Home" || k === "0") {
      ev.preventDefault();
      fitCamera(true);
      return;
    }

    if (k === "/") {
      ev.preventDefault();
      if (el.filter) {
        el.filter.focus();
        el.filter.select();
      }
      return;
    }

    if (k === "r" || k === "R") {
      ev.preventDefault();
      if (!reducedMotion) {
        autoRotate = !autoRotate;
        if (autoRotate) camTween = null;
        updateRotateButton();
        invalidate();
      }
      return;
    }

    if (k === "[" || k === "]") {
      ev.preventDefault();
      hideHint();
      cycleSelection(k === "]" ? 1 : -1);
      return;
    }

    if (k === "Enter") {
      ev.preventDefault();
      if (selectedId && byId.has(selectedId)) {
        if (NB.evt && NB.evt.emit) NB.evt.emit("file:open-request", selectedId);
      } else {
        announce("No note selected. Use the left and right bracket keys to choose one.");
      }
      return;
    }

    if (k === "Escape") {
      ev.preventDefault();
      clearSelection();
    }
  }

  function bindObservers() {
    if (typeof MutationObserver === "function" && document.body) {
      try {
        new MutationObserver(function () { onThemeChange(); })
          .observe(document.body, { attributes: true, attributeFilter: ["data-theme"] });
      } catch (_) {}
    }
    const reduceMq = matchMedia("(prefers-reduced-motion: reduce)");
    if (reduceMq) {
      setReducedMotion(reduceMq.matches);
      if (reduceMq.addEventListener) {
        reduceMq.addEventListener("change", function (e) { setReducedMotion(e.matches); });
      } else if (reduceMq.addListener) {
        reduceMq.addListener(function (e) { setReducedMotion(e.matches); });
      }
    }
    if (el.host && window.ResizeObserver) {
      try {
        new ResizeObserver(function () {
          if (!active) return;
          sizeCanvas();
          invalidate();
        }).observe(el.host);
      } catch (_) {}
    }
    window.addEventListener("resize", function () {
      if (!active) return;
      sizeCanvas();
      invalidate();
    });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && active) {
        lastT = 0;
        invalidate();
      }
    });
  }

  // --- ambient particles ---------------------------------------------
  function setParticleField(on) {
    const dense = nodes.length + edges.length > PARTICLES_LIMIT;
    particleFieldEnabled = !!on && !dense;
    if (on && dense && NB.evt && NB.evt.emit) NB.evt.emit("graph:pardensity", false);
    if (particleFieldEnabled) initParticles();
    invalidate();
  }

  // --- mount / activation lifecycle ----------------------------------
  function mount() {
    if (mounted) return;
    mounted = true;
    canvas = el.canvas;
    ctx = drawableCtx(canvas);
    dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);

    readPalette();
    try {
      if (NB.app && NB.app.getCfg) {
        particleFieldEnabled = !!NB.app.getCfg().graphParticles;
      }
    } catch (_) {}
    if (particleFieldEnabled) initParticles();

    bindPointerEvents();
    bindControls();
    bindObservers();
    sizeCanvas();
  }

  function setActiveFile(path) {
    activeFilePath = (path && String(path).charAt(0) !== "§") ? path : null;
    invalidate();
  }

  function activate(options) {
    const opts = options || {};
    mount();
    active = true;
    // A fetch discarded by a mode switch can leave `ready` at "loading"
    // even though the previous layout is intact.
    if (nodes.length && ready !== "ready") setReady("ready");
    if (el.host) {
      el.host.setAttribute("role", ready === "ready" ? "application" : "group");
    }
    updateControls();
    updateHostLabel();
    // The shared filter input may hold a value from the other renderer.
    applyFilter();
    window.requestAnimationFrame(function () {
      if (!active) return;
      sizeCanvas();
      if (!nodes.length) {
        loadGraph({ initial: true });
      } else if (opts.refresh) {
        loadGraph();
      } else {
        invalidate();
      }
      wake();
    });
  }

  function deactivate() {
    active = false;
    if (dragNode) releaseNodeDrag();
    pointers.clear();
    gesture = null;
    downInfo = null;
    pinchPrev = null;
    if (el.host) el.host.classList.remove("is-grabbing");
    sleep();
  }

  // Module-level events survive the renderer lifecycle. They no-op while
  // inactive so a hidden 3D view never reacts to file or tree changes.
  if (NB.evt && NB.evt.on) {
    NB.evt.on("file:open", function (path) {
      if (!active) return;
      setActiveFile(path);
      // The viewer hides special-tab containers before emitting file:open.
      if (el.view && el.view.hidden) {
        deactivate();
        return;
      }
      invalidate();
    });
    NB.evt.on("tree:refreshed", function () {
      if (!active || !mounted) return;
      loadGraph();
    });
  }

  // --- public surface -------------------------------------------------
  NB.graph3d = {
    mount: mount,
    activate: activate,
    deactivate: deactivate,
    loadGraph: loadGraph,
    refresh: loadGraph,
    get nodes() { return nodes; },
    get edges() { return edges; },
    get selectedId() { return selectedId; },
    get activeFile() { return activeFilePath; },
    // Compatibility views for the old 2D surface. They are derived from the
    // camera and are read-only; the renderer no longer uses a pan/scale matrix.
    get scale() { return focal / Math.max(1, cam.dist); },
    get pan() { return { x: cam.target.x, y: cam.target.y }; },
    get width() { return width; },
    get height() { return height; },
    setActiveFile: setActiveFile,
    getParticleField: function () { return particleFieldEnabled; },
    setParticleField: setParticleField,
    getCamera: function () {
      return {
        target: { x: cam.target.x, y: cam.target.y, z: cam.target.z },
        yaw: cam.yaw,
        pitch: cam.pitch,
        dist: cam.dist,
        fov: cam.fov,
      };
    },
    getDepthSpread: function () { return depthScale; },
    getTier: function () { return tier.name; },
    get running() { return running; },
  };
})();
