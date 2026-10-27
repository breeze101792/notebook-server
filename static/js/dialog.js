/* dialog.js -- shared containment for the body-level modal overlays.
 *
 * open() makes every other direct body child inert, wraps Tab and Shift+Tab
 * at the dialog edges, and makes the aria-modal promise true. close() clears
 * those flags and returns focus to the opener. Each surface keeps its own Esc
 * and backdrop handling; this module owns containment and focus only. */
(function () {
  "use strict";
  window.NB = window.NB || {};

  let active = null;
  let observer = null;
  const inerted = new Set();

  function dialogEl(overlay) {
    return overlay.querySelector('[role="dialog"]') || overlay;
  }

  function focusEl(el) {
    if (!el || typeof el.focus !== "function") return;
    try { el.focus({ preventScroll: true }); }
    catch (_) { try { el.focus(); } catch (_) {} }
  }

  function usable(el) {
    // A connected node is not enough: the closing context menu hides its
    // items before the handler runs, so an opener can be in the DOM but
    // unfocusable. Fall through to the caller's fallback in that case.
    return !!(el && el !== document.body && el !== document.documentElement &&
      el.isConnected !== false && typeof el.getClientRects === "function" &&
      el.getClientRects().length > 0);
  }

  function inertNode(el) {
    if (!el || el.nodeType !== 1 || el === active.overlay) return;
    if (el.inert) return;               // already inert for another owner
    el.inert = true;
    inerted.add(el);
  }

  function clearInert() {
    inerted.forEach((el) => { el.inert = false; });
    inerted.clear();
  }

  function focusables(overlay) {
    return Array.from(overlay.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter((el) => !el.disabled && !el.hidden && el.offsetParent !== null);
  }

  /* inert keeps pointer and AT out of the background, but Chromium still
   * moves Tab to the browser chrome after the last control. Wrap explicitly
   * so focus never leaves the dialog. The container is the default focus
   * target and `focusables()` excludes it, so it must count as both ends of
   * the cycle: otherwise Shift+Tab is not intercepted and focus falls to
   * BODY. */
  function onKeydown(e) {
    if (e.key !== "Tab" || !active) return;
    const list = focusables(active.overlay);
    if (!list.length) return;
    const container = dialogEl(active.overlay);
    const current = document.activeElement;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && (current === first || current === container)) {
      e.preventDefault();
      focusEl(last);
    } else if (!e.shiftKey && (current === last || current === container)) {
      e.preventDefault();
      focusEl(first);
    }
  }

  function open(overlay, opts) {
    if (!overlay) return;
    opts = opts || {};
    if (active && active.overlay === overlay) {
      focusEl(opts.initialFocus);
      return;
    }
    if (active) {
      if (observer) { observer.disconnect(); observer = null; }
      active.overlay.removeEventListener("keydown", onKeydown);
      clearInert();
    }
    active = {
      overlay: overlay,
      invoker: document.activeElement,
      fallback: opts.fallbackFocus || null,
    };
    Array.from(document.body.children).forEach(inertNode);
    // auth.js opens before the later overlays are parsed; inert those too.
    observer = new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => inertNode(node));
      });
    });
    observer.observe(document.body, { childList: true });
    overlay.addEventListener("keydown", onKeydown);

    const dialog = dialogEl(overlay);
    const target = opts.initialFocus || dialog;
    if (target === dialog && !dialog.hasAttribute("tabindex")) {
      dialog.setAttribute("tabindex", "-1");
    }
    focusEl(target);
  }

  function close(overlay) {
    if (!active || active.overlay !== overlay) return;
    const finished = active;
    active = null;
    if (observer) { observer.disconnect(); observer = null; }
    finished.overlay.removeEventListener("keydown", onKeydown);
    clearInert();
    const target = usable(finished.invoker) ? finished.invoker : finished.fallback;
    if (usable(target)) focusEl(target);
  }

  NB.dialog = { open, close };
})();
