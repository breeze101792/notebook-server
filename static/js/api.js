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
    createItem:    (path, type, content) =>
      request("POST", "/api/create", Object.assign(
        { path, type }, content !== undefined ? { content } : {})),
    moveItem:      (from, to)   => request("POST", "/api/move",  { from, to }),
    copyItem:      (from, to)   => request("POST", "/api/copy",  { from, to }),
    deleteItem:    (path)      => request("POST", "/api/delete", { path }),
    search:        (q, caseSensitive) =>
      request("GET",  "/api/search?q=" + encodeURIComponent(q) + "&case=" + (caseSensitive ? "1" : "0")),
    getGraph:      () => request("GET",  "/api/graph"),
    getConfig:     () => request("GET",  "/api/config"),
    saveConfig:    (cfg)       => request("POST", "/api/config", cfg),
    getInfo:       () => request("GET",  "/api/info"),
    getAuthStatus: () => request("GET",  "/api/auth"),
    login:         (password)  => request("POST", "/api/login",  { password }),
    logout:        () => request("POST", "/api/logout"),
    // Save the admin and/or viewer password. Pass null for a field to
    // leave it unchanged; pass "" to clear the viewer (admin cannot be
    // cleared once set, the server rejects that). When changing the
    // admin password (i.e. an admin already exists), adminCurrentPassword
    // is required and verified server-side.
    saveAuthPasswords: (adminPassword, adminCurrentPassword, viewerPassword) =>
      request("POST", "/api/auth/passwords", {
        admin_password: adminPassword,
        admin_current_password: adminCurrentPassword,
        viewer_password: viewerPassword,
      }),
    // Named API tokens (bearer credentials for agents/scripts). The full
    // token string is only ever returned by createAuthToken; list and
    // delete never see it.
    listAuthTokens:  () => request("GET", "/api/auth/tokens"),
    createAuthToken: (name, role) => request("POST", "/api/auth/tokens", { name, role }),
    deleteAuthToken: (name) => request("DELETE", "/api/auth/tokens/" + encodeURIComponent(name)),
    // Partial patch batch (all-or-nothing): ops follow /api/edit's schema.
    applyEdits: (path, edits) => request("POST", "/api/edit", { path, edits }),
    // ---- AI assistant (OpenAI-compatible proxy; secrets stay server-side)
    aiGetConfig: () => request("GET", "/api/ai/config"),
    aiSaveConfig: (servers, dflt) =>
      request("POST", "/api/ai/config", { servers, default: dflt }),
    aiProbe: (name) => request("GET", "/api/ai/probe?server=" + encodeURIComponent(name)),
    // SSE relay. Does NOT use request(): the response is a text/event-stream,
    // not JSON -- we parse OpenAI-style deltas and invoke onDelta per token.
    aiChat: async (body, onDelta, signal) => {
      const resp = await fetch("/api/ai/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      if (resp.status === 401) NB.evt.emit("auth:required");
      if (!resp.ok || !resp.body) {
        let msg = resp.statusText || "AI request failed";
        try {
          const data = await resp.json();
          if (data && data.error) msg = data.error;
        } catch (_) { /* non-JSON error body */ }
        throw new Error(msg);
      }
      // SSE framing: messages arrive as "data: <one line>\n\n" records.
      // Line-oriented on purpose -- a chunk boundary may split a record,
      // so bytes buffer until the framing newline closes it.
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).replace(/\r$/, "");
          buf = buf.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") return;
          let obj;
          try { obj = JSON.parse(payload); } catch (_) { continue; }
          // The relay maps upstream HTTP failures onto an SSE error event
          // (the browser can't read the status of a streaming response
          // once it started), so an in-band {error:true} fails the call.
          if (obj && obj.error) {
            throw new Error(obj.message || "Upstream error " + (obj.status || ""));
          }
          const delta = obj.choices &&
                        obj.choices[0] &&
                        obj.choices[0].delta &&
                        obj.choices[0].delta.content;
          if (delta) onDelta(delta);
        }
      }
    },
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