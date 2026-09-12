/**
 * api.js — talks to the real backend in ../backend when it's running,
 * and falls back to realistic mock responses when it isn't (e.g. someone
 * viewing this on GitHub Pages without a server). The flow diagram and
 * timing logic don't need to know which mode they're in — every call
 * returns the same shape: { status, ok, body, duration, live }.
 */
(function () {
  const BASE_URL = window.API_BASE_URL || "http://localhost:8000";

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function timedFetch(url, options) {
    const start = performance.now();
    const res = await fetch(url, options);
    const duration = performance.now() - start;
    let body = null;
    try { body = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, ok: res.ok, body, duration };
  }

  const MOCK = {
    token: { status: 200, body: { access_token: "mock.jwt.token", token_type: "Bearer", expires_in: 3600 } },
    getUser: { status: 200, body: { id: 42, name: "Alex Rivera", email: "alex@example.com", joined: "2026-01-14" } },
    postUser: { status: 201, body: { id: 42, name: "Alex Rivera", email: "alex@example.com", updated: true } },
    replay: { status: 200, body: { id: 42, name: "Alex Rivera", email: "alex@example.com", updated: true, idempotent_replay: true } },
    error401: { status: 401, body: { detail: "Missing Authorization header" } },
    error429: { status: 429, body: { detail: "Rate limit exceeded — try again shortly" } },
    error500: { status: 500, body: { detail: "Backend service crashed (simulated failure)" } },
  };

  async function checkBackend() {
    try {
      const r = await fetch(`${BASE_URL}/health`, { method: "GET" });
      return r.ok;
    } catch (e) {
      return false;
    }
  }

  async function fetchToken() {
    try {
      const r = await timedFetch(`${BASE_URL}/v1/auth/token`, { method: "POST" });
      return { ...r, live: true };
    } catch (e) {
      await sleep(260);
      return { ...MOCK.token, duration: 140, live: false };
    }
  }

  /**
   * options: { method, simulate, idempotencyKey, token, seenIdempotencyKeys }
   * simulate: "" | "no-token" | "429" | "500"
   */
  async function callUsersEndpoint(method, options = {}) {
    const { simulate, idempotencyKey, token, seenIdempotencyKeys } = options;

    const headers = { "Content-Type": "application/json" };
    if (simulate !== "no-token" && token) headers["Authorization"] = `Bearer ${token}`;
    if (idempotencyKey && method === "POST") headers["Idempotency-Key"] = idempotencyKey;

    const url = new URL(`${BASE_URL}/v1/users/42`);
    if (simulate === "429" || simulate === "500") url.searchParams.set("simulate", simulate);

    const body = method === "POST" ? JSON.stringify({ name: "Alex Rivera", email: "alex@example.com" }) : undefined;

    try {
      const r = await timedFetch(url.toString(), { method, headers, body });
      return { ...r, live: true };
    } catch (e) {
      // Backend unreachable — fall back to a mock that matches what the
      // real backend would have done for this exact scenario.
      await sleep(300);
      if (simulate === "no-token") return { ...MOCK.error401, duration: 90, live: false };
      if (simulate === "429") return { ...MOCK.error429, duration: 60, live: false };
      if (simulate === "500") return { ...MOCK.error500, duration: 180, live: false };
      if (method === "POST" && idempotencyKey && seenIdempotencyKeys && seenIdempotencyKeys.has(idempotencyKey)) {
        return { ...MOCK.replay, duration: 95, live: false };
      }
      return { ...(method === "POST" ? MOCK.postUser : MOCK.getUser), duration: method === "POST" ? 260 : 210, live: false };
    }
  }

  window.ApiClient = { BASE_URL, checkBackend, fetchToken, callUsersEndpoint };
})();
