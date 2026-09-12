<div align="center">

# PulseTrace
### An API Flow Explainer

*A small full-stack project that makes an API call visible — auth, routing, business logic,
and the failure modes that only show up once real traffic hits a real service.*

![FastAPI](https://img.shields.io/badge/backend-FastAPI-009485?logo=fastapi&logoColor=white)
![Python](https://img.shields.io/badge/python-3.11+-3776AB?logo=python&logoColor=white)
![JavaScript](https://img.shields.io/badge/frontend-vanilla%20JS-f7df1e?logo=javascript&logoColor=black)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

</div>

---

> **Note:** replace this line with a GIF of the demo in action — record yourself
> triggering a 401, then a success, then an idempotent replay. It's the fastest
> way for anyone reading this to see the backend is real. See
> [Recording a demo GIF](#recording-a-demo-gif) at the bottom.

## Why this exists

Most "API demo" projects animate a box moving from left to right and call it a day.
That shows what an API call *looks* like, not what one actually *does*.

PulseTrace is built around a different question: **what happens when a real API call
goes wrong, and where in the stack does it go wrong?** So instead of animating a
script, the diagram is driven by a real backend that has real authentication, a real
rate limiter, and a real idempotency mechanism — the same primitives production
fintech and payments APIs are built on.

Every number and status code you see on screen came from an actual HTTP round trip.
Nothing in the response panel is typed in by hand.

## Table of contents

- [What it demonstrates](#what-it-demonstrates)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [API reference](#api-reference)
- [Try these — proof it's real](#try-these--proof-its-real)
- [Design decisions](#design-decisions)
- [Known limitations](#known-limitations)
- [Roadmap](#roadmap)
- [Tech stack](#tech-stack)

## What it demonstrates

| Concept | Implementation | Real or simulated? |
|---|---|---|
| Bearer token auth (JWT) | `backend/main.py` → `verify_token()` | **Real.** Omitting the token gets an actual `401` from the server. |
| Sliding-window rate limiting | `backend/main.py` → `check_rate_limit()` | **Real.** In-memory limiter, 5 requests / 10s per client — send 6 in a row and get a genuine `429`. |
| Idempotency keys | `POST /v1/users/{id}` | **Real.** Replaying the same `Idempotency-Key` returns the original result and skips the write — the mechanism Stripe uses so a retried payment can't double-charge. |
| Round-trip latency | `frontend/api.js` → `timedFetch()` | **Real**, measured with `performance.now()` around the live `fetch()` call. |
| Deliberate backend failure | `?simulate=500` query flag | Triggered on demand, the same way real teams use feature flags to test failure paths — the crash itself is a real thrown exception, not a fake status code. |
| Request/response animation | `frontend/flow.js` | Visual layer only — but every stop, color, and timing is driven by the real status code and latency above, not a hardcoded script. |

The frontend also degrades gracefully: if it can't reach the backend, it falls back
to mock responses shaped exactly like the real ones and says so with a visible
banner — so the page is still explorable without a server (e.g. on GitHub Pages),
without ever pretending mock data is live.

## Architecture

```
   ┌───────────┐   Bearer token    ┌──────────────┐   validated req    ┌──────────────────┐   query    ┌──────────┐
   │  Your app │ ────────────────▶ │ API gateway  │ ─────────────────▶ │ Backend service  │ ─────────▶ │ Database │
   │ (browser) │ ◀──────────────── │ auth + rate  │ ◀───────────────── │ business logic   │ ◀───────── │ (mocked) │
   └───────────┘      response     │   limiting   │      response      └──────────────────┘  records   └──────────┘
                                    └──────────────┘
```

The gateway and backend service are logically separated inside a single
`backend/main.py` (auth and rate limiting run *before* business logic) rather than
deployed as two physical processes — that keeps the project runnable with one
command while still modelling **where** each class of failure actually occurs:

- **Gateway-level failures** (`401` missing token, `429` rate limit) are rejected
  *before* any business logic runs.
- **Service-level failures** (`500` crash) happen *after* auth passes, while the
  backend is doing its job.

The flow diagram on the frontend reflects this precisely: a `401`/`429` stops the
animated packet at the gateway node; a `500` lets it through the gateway and stops
it one hop later, at the backend service node — because that's the actual line of
code where each exception is raised.

## Project structure

```
api-flow-explainer/
├── backend/
│   ├── main.py            FastAPI app — auth, rate limiting, idempotency, routes
│   └── requirements.txt
├── frontend/
│   ├── index.html         Page structure
│   ├── styles.css         Glassmorphism UI, all styling
│   ├── api.js             Fetch layer — real calls + mock fallback
│   ├── flow.js            SVG flow-diagram engine (forward/backward traversal)
│   └── app.js             UI wiring, request lifecycle, error routing
├── .gitignore
└── README.md
```

## Getting started

### Backend

```bash
cd backend
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```

> Using `python -m pip` / `python -m uvicorn` instead of the bare `pip` / `uvicorn`
> commands avoids the classic Windows issue where the installed script isn't on
> your `PATH` — this always works because it runs uvicorn through Python directly.

You should see:
```
Uvicorn running on http://127.0.0.1:8000
```

### Frontend

```bash
cd frontend
python3 -m http.server 5500
```
Then open **http://localhost:5500**. The page checks for the backend automatically
and shows a banner telling you whether you're in live or mock mode.

You can also open `frontend/index.html` directly in a browser with no server at
all — it'll run in mock mode, since `fetch()` to `localhost:8000` will fail without
the backend running.

## API reference

| Method | Path | Auth required | Headers | Notes |
|---|---|---|---|---|
| `POST` | `/v1/auth/token` | No | — | Issues a demo JWT (client-credentials style). |
| `GET` | `/v1/users/{id}` | Yes | `Authorization: Bearer <token>` | Returns a mock user record. |
| `POST` | `/v1/users/{id}` | Yes | `Authorization`, optional `Idempotency-Key` | Updates the user; replays are safe if a key is reused. |
| `GET` | `/health` | No | — | Liveness check, used by the frontend to detect live vs mock mode. |

Both `/v1/users/{id}` routes accept an optional `?simulate=429` or `?simulate=500`
query parameter, used by the UI's **Demo failure mode** dropdown to trigger a
specific real failure on demand.

## Try these — proof it's real

1. Click **Send request** with no token → a genuine `401` from the server.
2. Click **Get token**, then **Send request** → `200`, with real measured latency.
3. Switch to **POST**, send it, then send it again with the *same* Idempotency-Key
   → the second response comes back with `"idempotent_replay": true`, and the
   backend never repeated the write.
4. Send 6 requests within 10 seconds → a real `429` from the sliding-window
   limiter — not a scripted one.
5. Select **Force backend crash** → the packet clears the gateway, then dies at
   the backend service node with a real `500`.

## Design decisions

**Why one backend file instead of separate gateway/service processes?**
Splitting auth and business logic into physically separate services is more
realistic, but it turns a one-command demo into a multi-service deployment
exercise. Keeping the *logical* separation (auth and rate limiting execute
before business logic, in their own functions) preserves the interesting part —
where a failure occurs — without the operational overhead.

**Why does the frontend fall back to mocks instead of just failing?**
An idle GitHub repo with a backend that isn't running is the most common way
anyone actually encounters this project. A blank error screen tells a reviewer
nothing; a clearly-labelled mock mode still shows the full interaction design.
The mock responses are shaped identically to the real ones specifically so the
UI code never needs to know which mode it's in.

**Why idempotency keys instead of just "handling errors gracefully"?**
Because it's the concept that separates a toy API from a payments-grade one.
Retried network requests are inevitable; idempotency keys are how real systems
make retrying a write safe instead of dangerous.

## Known limitations

This is a learning/portfolio project, not a production auth system:

- The JWT secret is hardcoded in `main.py` — fine for a demo, never for production.
- Rate-limit and idempotency state live in memory and reset on server restart.
- There's a single hardcoded user (`id: 42`) — no real data layer.
- CORS is fully open, which is appropriate for a local demo and nowhere else.

The parts that *are* real — token verification, rate limiting, idempotent writes,
and latency measurement — are implemented the way a production system would,
just at a scale that's easy to read in one sitting.

## Roadmap

- [ ] Swap the in-memory rate limiter and idempotency cache for Redis
- [ ] Split the gateway into a genuinely separate service (a real network hop,
      not an in-process check)
- [ ] Accept any OpenAPI spec and auto-generate the flow diagram for it
- [ ] Add a retry-with-backoff visualization for the `429` path

## Tech stack

**Backend:** FastAPI, PyJWT, Pydantic — an in-memory rate limiter and idempotency
cache stand in for what would be Redis/Postgres in a real deployment.

**Frontend:** Vanilla HTML/CSS/JS, no build step, no framework — `flow.js` for the
SVG path animation, `api.js` for the fetch layer, `app.js` for UI wiring.

---

