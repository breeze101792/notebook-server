/* graph.js -- a force-directed graph view of how notes link together.
 *
 * Renders an interactive, canvas-based "brain" of the notebook as a
 * special tab (§graph) in the tab bar. The backend /api/graph endpoint
 * parses [[wikilinks]] and standard [text](x.md) links out of every .md
 * file and returns nodes + edges; this module lays them out with a
 * simple force simulation (repulsion between every pair of nodes,
 * spring attraction along edges, gentle centering gravity) and draws
 * them on a <canvas>.
 *
 * The graph lives as a .special-tab-view sibling of #viewer inside
 * #edit-split. NB.tabs owns the tab lifecycle (open/activate/close);
 * this module registers a special-tab factory that shows/hides the
 * #graph-view container and runs the simulation when activated.
 *
 * Interaction:
 *   - hover a node -> highlights it + its neighbours, dims the rest
 *   - click a node -> opens the file as a new file tab
 *   - drag a node   -> pins it at the cursor until release
 *   - drag the background -> pans the view
 *   - wheel / pinch -> zooms in / out around the cursor
 *   - toolbar: refresh (re-fetch), re-center, zoom +/-, filter input
 *
 * The simulation is a fixed-step integrator running on
 * requestAnimationFrame. It settles naturally; once the total kinetic
 * energy drops below a threshold the loop idles (only re-drawing, not
 * stepping physics) until something moves it (drag, resize, new data).
 * jsdom has no real canvas so every getContext / draw call is guarded
 * by a ctx null check; the module still mounts and fetches so the view
 * is testable without a rendering surface.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const TAB_ID = "§graph";

  // --- physics constants (tuned for small single-user notebooks) -------
  const REPULSION = 2200;
  const SPRING_LEN = 90;
  const SPRING_K = 0.01;
  const CENTER_K = 0.012;
  const DAMPING = 0.82;
  const SLEEP_EPS = 0.4;
  const MAX_SPEED = 16;
  const MIN_SCALE = 0.2;
  const MAX_SCALE = 5;

  // --- view state -----------------------------------------------------
  let nodes = [];
  let edges = [];
  let byId = {};
  let running = false;
  let rafId = null;
  let simulating = true;
  let canvas, ctx, dpr;
  let hoverId = null;
  let dragNode = null;
  let pan = { x: 0, y: 0 };
  let scale = 1;
  let panning = false;
  let lastMouse = { x: 0, y: 0 };
  let filterQuery = "";
  let width = 0, height = 0;
  let activeFile = null;
  let mounted = false;

  // --- DOM refs (resolved on first mount) -----------------------------
  let viewEl, canvasHostEl, canvasEl, summaryEl, filterEl;

  function fetchGraph() { return NB.api.getGraph(); }

  /* --- mount: wire up the static HTML structure. Called the first time
   * the graph tab is activated. The header + controls + canvas host ship
   * in index.html so the layout exists before the module boots; this just
   * grabs references and attaches listeners. */
  function mount() {
    if (mounted) return;
    mounted = true;
    viewEl = document.getElementById("graph-view");
    canvasHostEl = document.getElementById("graph-view-canvas-host");
    canvasEl = document.getElementById("graph-view-canvas");
    summaryEl = document.getElementById("graph-view-summary");
    filterEl = document.getElementById("graph-view-filter");
    canvas = canvasEl;
    try { ctx = canvas.getContext("2d"); } catch (_) { ctx = null; }
    dpr = (window.devicePixelRatio || 1);

    sizeCanvas();
    if (window.ResizeObserver && canvasHostEl) {
      try {
        const ro = new ResizeObserver(() => { sizeCanvas(); requestRedraw(); });
        ro.observe(canvasHostEl);
      } catch (_) {}
    }
    window.addEventListener("resize", () => { sizeCanvas(); requestRedraw(); });

    // Controls
    if (filterEl) filterEl.addEventListener("input", () => {
      filterQuery = (filterEl.value || "").trim().toLowerCase();
      requestRedraw();
    });
    bindBtn("graph-view-recenter", () => { resetView(); wake(); });
    bindBtn("graph-view-zoom-in", () => { zoomBy(1.2, width / 2, height / 2); });
    bindBtn("graph-view-zoom-out", () => { zoomBy(1 / 1.2, width / 2, height / 2); });
    bindBtn("graph-view-refresh", () => { loadGraph(); });

    // Canvas interaction
    if (canvasEl) {
      canvasEl.addEventListener("mousedown", onPointerDown);
      canvasEl.addEventListener("mousemove", onPointerMove);
      window.addEventListener("mouseup", onPointerUp);
      canvasEl.addEventListener("wheel", onWheel, { passive: false });
      canvasEl.addEventListener("mouseleave", () => {
        hoverId = null;
        if (canvasEl) canvasEl.style.cursor = "";
        requestRedraw();
      });
      canvasEl.addEventListener("click", onCanvasClick);
      canvasEl.addEventListener("touchstart", onTouchStart, { passive: false });
      canvasEl.addEventListener("touchmove", onTouchMove, { passive: false });
      canvasEl.addEventListener("touchend", onTouchEnd);
    }

    // Re-highlight the active file's node when the open file changes.
    NB.evt.on("file:open", (path) => {
      activeFile = path || null;
      requestRedraw();
    });
    // Re-fetch when the tree changes so the graph stays in sync.
    NB.evt.on("tree:refreshed", () => { if (viewEl && !viewEl.hidden) loadGraph(); });
  }

  /* Register the special tab + wire the toggle button immediately on
   * module load (not inside mount()). The tab system needs the
   * registration in place before tabs.restore() runs on boot, in case
   * §graph is in the persisted openFiles. The DOM wiring (canvas
   * listeners, resize observer) still happens lazily in mount() on
   * first activation, but the special-tab factory must be registered
   * early so activate("§graph") finds it. */
  function registerOnLoad() {
    if (NB.tabs && NB.tabs.registerSpecial) {
      NB.tabs.registerSpecial({
        id: TAB_ID,
        icon: "🕸",
        label: "Graph",
        onActivate: onTabActivate,
        onClose: onTabClose,
      });
    }
    const toggleBtn = document.getElementById("activity-graph-btn");
    if (toggleBtn && !toggleBtn.dataset.graphWired) {
      toggleBtn.dataset.graphWired = "1";
      toggleBtn.addEventListener("click", () => {
        mount();
        if (NB.tabs && NB.tabs.openSpecial) NB.tabs.openSpecial(TAB_ID);
      });
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", registerOnLoad);
  } else {
    registerOnLoad();
  }

  function bindBtn(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", fn);
  }

  function sizeCanvas() {
    if (!canvasHostEl || !canvas) return;
    const rect = canvasHostEl.getBoundingClientRect();
    width = rect.width || 600;
    height = Math.max(rect.height || 0, 200);
    // Only resize the canvas backing store if the dimensions actually
    // changed -- resizing clears the canvas, so doing it every frame
    // (e.g. from the rAF loop) would flicker.
    const w = Math.floor(width * dpr);
    const h = Math.floor(height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      if (canvas.style) {
        canvas.style.width = width + "px";
        canvas.style.height = height + "px";
      }
      if (ctx && dpr !== 1) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  // --- special-tab lifecycle ------------------------------------------
  function onTabActivate() {
    // Ensure the DOM is wired (canvas listeners, resize observer) even
    // if this is a boot-restore activation (mount() hasn't been called
    // yet because the user didn't click the button -- the tab was
    // restored from config). mount() is idempotent.
    mount();
    if (viewEl) viewEl.hidden = false;
    // Defer sizing + simulation start to the next frame. The element
    // was just unhidden; getBoundingClientRect() returns zeros until
    // the browser runs layout. requestAnimationFrame fires after the
    // next layout pass so sizeCanvas() sees real dimensions.
    requestAnimationFrame(() => {
      sizeCanvas();
      resetView();
      loadGraph();
    });
  }
  function onTabClose() {
    if (viewEl) viewEl.hidden = true;
    sleep();
  }

  // --- data fetch + layout seed ----------------------------------------
  async function loadGraph() {
    let data;
    try { data = await fetchGraph(); }
    catch (e) { console.warn("graph fetch failed", e); return; }
    const incoming = (data && data.nodes) || [];
    const inEdges = (data && data.edges) || [];
    const prev = {};
    for (const n of nodes) prev[n.id] = { x: n.x, y: n.y };
    byId = {};
    nodes = incoming.map((n, i) => {
      const prevPos = prev[n.id];
      const seed = prevPos || seedAround(i, incoming.length);
      const node = {
        id: n.id,
        name: n.name || n.id,
        links: n.links || 0,
        degree: n.links || 0,
        x: prevPos ? prevPos.x : seed.x,
        y: prevPos ? prevPos.y : seed.y,
        vx: 0,
        vy: 0,
        fixed: false,
      };
      byId[n.id] = node;
      return node;
    });
    edges = inEdges
      .map(e => ({ source: byId[e.source], target: byId[e.target] }))
      .filter(e => e.source && e.target);
    if (summaryEl) {
      const n = nodes.length, e = edges.length;
      summaryEl.textContent = n + " note" + (n === 1 ? "" : "s") + " · " +
        e + " link" + (e === 1 ? "" : "s");
    }
    simulating = true;
    wake();
  }

  function seedAround(i, n) {
    const r = Math.min(width, height) * 0.35 || 120;
    const a = (i / Math.max(1, n)) * Math.PI * 2;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }

  function resetView() {
    // World-space: nodes live around (0, 0). The view is positioned so
    // (0, 0) lands at the canvas center.
    scale = 1;
    pan = { x: width / 2, y: height / 2 };
    nodes.forEach((n, i) => {
      const s = seedAround(i, nodes.length);
      n.x = s.x; n.y = s.y; n.vx = 0; n.vy = 0;
    });
    simulating = true;
  }

  // --- physics step -----------------------------------------------------
  function step() {
    if (!nodes.length) return;
    // World-space: the centering force pulls nodes toward world (0, 0).
    let maxSpeed = 0;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      let fx = 0, fy = 0;
      for (let j = 0; j < nodes.length; j++) {
        if (i === j) continue;
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = (Math.random() - 0.5) * 2; dy = (Math.random() - 0.5) * 2; d2 = dx * dx + dy * dy; }
        const d = Math.sqrt(d2);
        const f = REPULSION / d2;
        fx += (dx / d) * f;
        fy += (dy / d) * f;
      }
      a._fx = fx;
      a._fy = fy;
    }
    for (const e of edges) {
      const a = e.source, b = e.target;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f = SPRING_K * (d - SPRING_LEN);
      const ux = dx / d, uy = dy / d;
      a._fx += ux * f;
      a._fy += uy * f;
      b._fx -= ux * f;
      b._fy -= uy * f;
    }
    for (const n of nodes) {
      n._fx += -n.x * CENTER_K;
      n._fy += -n.y * CENTER_K;
      if (n.fixed || n === dragNode) {
        n.vx = 0; n.vy = 0;
        continue;
      }
      n.vx = (n.vx + n._fx) * DAMPING;
      n.vy = (n.vy + n._fy) * DAMPING;
      const sp = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
      if (sp > MAX_SPEED) {
        n.vx = (n.vx / sp) * MAX_SPEED;
        n.vy = (n.vy / sp) * MAX_SPEED;
      }
      if (sp > maxSpeed) maxSpeed = sp;
      n.x += n.vx;
      n.y += n.vy;
    }
    if (maxSpeed < SLEEP_EPS) simulating = false;
  }

  // --- draw ------------------------------------------------------------
  function draw() {
    if (!ctx) return;
    // Re-sync the canvas size before drawing in case the container was
    // resized without sizeCanvas being called (e.g. window resize while
    // the graph tab is active but the ResizeObserver hasn't fired yet).
    // This is cheap (no-op if dimensions haven't changed) and ensures
    // the canvas backing store matches the CSS pixel dimensions, so
    // pointer-event picking math stays correct.
    sizeCanvas();
    // dpr scaling was set once in sizeCanvas(); don't reset to identity
    // or the dpr multiplier would be lost.
    ctx.clearRect(0, 0, width, height);
    // Apply the view transform: world (n.x, n.y) -> screen pixels.
    // ctx is already scaled by dpr, so on top of that we translate by
    // pan and scale by `scale`.
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(scale, scale);
    const neighbours = hoverId ? neighbourSet(hoverId) : null;
    for (const e of edges) {
      if (hoverId && e.source.id !== hoverId && e.target.id !== hoverId) {
        ctx.strokeStyle = "rgba(127,140,160,0.07)";
        ctx.lineWidth = 1 / scale;
      } else {
        ctx.strokeStyle = "rgba(124,156,255,0.5)";
        ctx.lineWidth = 1.5 / scale;
      }
      ctx.beginPath();
      ctx.moveTo(e.source.x, e.source.y);
      ctx.lineTo(e.target.x, e.target.y);
      ctx.stroke();
    }
    for (const n of nodes) {
      const dim = hoverId && hoverId !== n.id && !neighbours.has(n.id);
      const isFiltered = filterQuery && !n.id.toLowerCase().includes(filterQuery);
      const isDragged = (n === dragNode);
      let r = 4 + Math.min(10, Math.sqrt(n.degree) * 2);
      if (n.id === hoverId) r += 2;
      if (n.id === activeFile) r += 2;
      if (isDragged) r += 3;
      let fill;
      if (dim || isFiltered) {
        fill = "rgba(127,140,160,0.18)";
      } else if (n.id === activeFile) {
        fill = "#f3b454";
      } else if (isDragged) {
        fill = "#f3b454";
      } else if (n.id === hoverId) {
        fill = "#7c9cff";
      } else {
        fill = "rgba(124,156,255,0.8)";
      }
      // Glow ring for hovered / dragged nodes for clearer feedback.
      if (n.id === hoverId || isDragged) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = isDragged ? "rgba(243,180,84,0.4)" : "rgba(124,156,255,0.4)";
        ctx.lineWidth = 2 / scale;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      if (n.id === hoverId || n.degree >= 3 || (nodes.length <= 30 && !filterQuery)) {
        const label = n.name.replace(/\.md$/i, "");
        // Font size + label offset stay in screen pixels: undo the
        // scale so a 12px font reads as 12px regardless of zoom.
        ctx.font = (12 / scale) + "px -apple-system, sans-serif";
        ctx.fillStyle = dim || isFiltered ? "rgba(127,140,160,0.4)" : "rgba(230,230,234,0.92)";
        ctx.fillText(label, n.x + r + 4 / scale, n.y + 4 / scale);
      }
    }
    ctx.restore();
  }

  function neighbourSet(id) {
    const s = new Set();
    for (const e of edges) {
      if (e.source.id === id) s.add(e.target.id);
      else if (e.target.id === id) s.add(e.source.id);
    }
    return s;
  }

  // --- rAF loop --------------------------------------------------------
  function loop() {
    if (!running) return;
    if (simulating) step();
    draw();
    rafId = requestAnimationFrame(loop);
  }
  function wake() {
    if (running) return;
    running = true;
    rafId = requestAnimationFrame(loop);
  }
  function sleep() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }
  function requestRedraw() {
    if (!ctx) return;
    if (!running) draw();
  }

  // --- picking + pointer interaction ------------------------------------
  function eventPos(e) {
    const rect = canvasEl.getBoundingClientRect();
    return { x: (e.clientX - rect.left), y: (e.clientY - rect.top) };
  }
  function worldFromScreen(sx, sy) {
    return { x: (sx - pan.x) / scale, y: (sy - pan.y) / scale };
  }
  function pickNode(e) {
    if (!nodes.length) return null;
    const p = eventPos(e);
    // Pick in screen space so the click hitbox matches the visible
    // radius at any zoom level. Each node has a baseline world radius
    // (4 + small boost by degree); multiplied by `scale` gives its
    // current on-screen radius.
    let best = null, bestD = Infinity;
    for (const n of nodes) {
      const sx = pan.x + n.x * scale;
      const sy = pan.y + n.y * scale;
      const dx = sx - p.x, dy = sy - p.y;
      const r = (5 + Math.min(10, Math.sqrt(n.degree) * 2) + 3) * scale;
      const d = dx * dx + dy * dy;
      if (d < r * r && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }

  let dragMoved = false;
  function onPointerDown(e) {
    const n = pickNode(e);
    const p = eventPos(e);
    lastMouse = p;
    dragMoved = false;
    if (n) {
      dragNode = n;
      n.fixed = true;
      const w = worldFromScreen(p.x, p.y);
      n.x = w.x; n.y = w.y; n.vx = 0; n.vy = 0;
      simulating = true; wake();
    } else {
      panning = true;
    }
    if (canvasEl) canvasEl.style.cursor = "grabbing";
  }
  function onPointerMove(e) {
    const p = eventPos(e);
    if (dragNode) {
      const w = worldFromScreen(p.x, p.y);
      const dx = p.x - lastMouse.x, dy = p.y - lastMouse.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
      dragNode.x = w.x; dragNode.y = w.y;
      dragNode.vx = 0; dragNode.vy = 0;
      simulating = true; wake();
    } else if (panning) {
      // Pan moves the view, not the nodes: shift pan by the screen
      // pixel delta and nodes follow via draw().
      pan.x += p.x - lastMouse.x;
      pan.y += p.y - lastMouse.y;
      // Use requestRedraw so the panned view repaints immediately even
      // if the physics loop has settled. This keeps the drag feeling
      // 1:1 with the mouse instead of lagging behind the next sim step.
      requestRedraw();
    } else {
      const n = pickNode(e);
      const newHover = n ? n.id : null;
      if (newHover !== hoverId) {
        hoverId = newHover;
        if (canvasEl) canvasEl.style.cursor = n ? "pointer" : "";
        requestRedraw();
      }
    }
    lastMouse = p;
  }
  function onPointerUp() {
    if (dragNode) { dragNode.fixed = false; dragNode = null; simulating = true; wake(); }
    panning = false;
    if (canvasEl) canvasEl.style.cursor = hoverId ? "pointer" : "";
  }
  function onCanvasClick(e) {
    if (dragMoved) { dragMoved = false; return; }
    const n = pickNode(e);
    // Clicking a node opens the file as a normal file tab.
    if (n) NB.evt.emit("file:open-request", n.id);
  }
  function onWheel(e) {
    e.preventDefault();
    const p = eventPos(e);
    // A single wheel notch zooms ~15%; keep the zoom anchored on the
    // cursor so the point under the mouse stays fixed.
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoomBy(factor, p.x, p.y);
    // Wake the draw loop so the zoomed view repaints immediately, even
    // if the physics simulation has settled (running=false).
    requestRedraw();
  }
  function zoomBy(factor, sx, sy) {
    // Anchor the zoom on the world point under the cursor: solve for
    // the new pan so (sx, sy) maps to the same world coords as before.
    const wx = (sx - pan.x) / scale;
    const wy = (sy - pan.y) / scale;
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * factor));
    scale = newScale;
    pan.x = sx - wx * scale;
    pan.y = sy - wy * scale;
    requestRedraw();
  }

  // Touch
  let pinchStart = null;
  function onTouchStart(e) {
    if (e.touches.length === 1) onPointerDown(e.touches[0]);
    else if (e.touches.length === 2) pinchStart = pinchState(e);
  }
  function onTouchMove(e) {
    if (e.touches.length === 1) {
      e.preventDefault();
      onPointerMove(e.touches[0]);
    } else if (e.touches.length === 2 && pinchStart) {
      e.preventDefault();
      const cur = pinchState(e);
      const factor = cur.dist / pinchStart.dist;
      zoomBy(factor, pinchStart.cx, pinchStart.cy);
      pinchStart = cur;
    }
  }
  function onTouchEnd() {
    onPointerUp();
    pinchStart = null;
  }
  function pinchState(e) {
    const a = e.touches[0], b = e.touches[1];
    const dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
    const rect = canvasEl.getBoundingClientRect();
    return {
      dist: Math.sqrt(dx * dx + dy * dy),
      cx: (a.clientX + b.clientX) / 2 - rect.left,
      cy: (a.clientY + b.clientY) / 2 - rect.top,
    };
  }

  // --- public surface -------------------------------------------------
  NB.graph = {
    mount,
    loadGraph,
    refresh: loadGraph,
    get nodes() { return nodes; },
    get edges() { return edges; },
    get scale() { return scale; },
    get pan() { return pan; },
    get width() { return width; },
    get height() { return height; },
    TAB_ID,
  };
})();