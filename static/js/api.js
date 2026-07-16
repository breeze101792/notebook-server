/* api.js -- fetch wrappers + tiny pub/sub for the notebook app.
 * Modules share the global window.NB namespace. */
(function () {
  "use strict";

  window.NB = window.NB || {};

  async function request(method, url, body) {
    const opts = {
      method,
      headers: {},
      // Always send the session cookie so the server can identify the user
      // (same-origin so the cookie is included on both same-port and
      // cross-port LAN connections to the same host).
      credentials: "same-origin",
    };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    let resp;
    try {
      resp = await fetch(url, opts);
    } catch (e) {
      throw new Error("Network error: " + e.message);
    }
    let data = null;
    const text = await resp.text();
    if (text) {
      try { data = JSON.parse(text); }
      catch (e) { throw new Error("Bad JSON from server"); }
    }
    // 401 from any gated endpoint means the session expired or the user
    // logged out in another tab. Surface it as a pub/sub event so the
    // auth module can show the login modal again, and the rest of the UI
    // can pause until a fresh login completes.
    if (resp.status === 401) {
      NB.evt.emit("auth:required");
    }
    if (!resp.ok) {
      const msg = (data && data.error) || resp.statusText || "Request failed";
      throw new Error(msg);
    }
    return data;
  }

  const api = {
    getTree:       () => request("GET",  "/api/tree").then(r => r.tree),
    getFile:       (path)     => request("GET",  "/api/file?path=" + encodeURIComponent(path)),
    saveFile:      (path, content) => request("POST", "/api/file", { path, content }),
    createItem:    (path, type) => request("POST", "/api/create", { path, type }),
    moveItem:      (from, to)   => request("POST", "/api/move",  { from, to }),
    copyItem:      (from, to)   => request("POST", "/api/copy",  { from, to }),
    deleteItem:    (path)      => request("POST", "/api/delete", { path }),
    search:        (q, caseSensitive) =>
      request("GET", "/api/search?q=" + encodeURIComponent(q) + "&case=" + (caseSensitive ? "1" : "0")),
    getConfig:     () => request("GET",  "/api/config"),
    saveConfig:    (cfg)       => request("POST", "/api/config", cfg),
    getInfo:       () => request("GET",  "/api/info"),
    getAuthStatus: () => request("GET",  "/api/auth"),
    login:         (password)  => request("POST", "/api/login",  { password }),
    logout:        () => request("POST", "/api/logout"),
    // Save the admin and/or viewer password. Pass null for a field to
    // leave it unchanged; pass "" to clear the viewer (admin cannot be
    // cleared once set, the server rejects that).
    saveAuthPasswords: (adminPassword, viewerPassword) =>
      request("POST", "/api/auth/passwords",
        { admin_password: adminPassword, viewer_password: viewerPassword }),
  };

  /* Tiny pub/sub so modules decouple. */
  const listeners = {};
  const evt = {
    on(name, fn)  { (listeners[name] = listeners[name] || []).push(fn); },
    off(name, fn) {
      if (!listeners[name]) return;
      listeners[name] = listeners[name].filter(f => f !== fn);
    },
    emit(name, ...args) {
      (listeners[name] || []).forEach(fn => { try { fn(...args); } catch (e) { console.error(e); } });
    },
  };

  window.NB.api = api;
  window.NB.evt = evt;
})();