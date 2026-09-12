"""
API Flow Explainer — demo backend
----------------------------------
A small, real FastAPI service used to back the visual API flow explainer
in ../frontend. It implements the pieces that actually matter in a
production fintech-style API, at demo scale:

  * JWT client-credentials auth        (/v1/auth/token)
  * Bearer-token verification          (verify_token)
  * A real in-memory rate limiter      (check_rate_limit)
  * Idempotency-key handling on writes (POST /v1/users/{id})
  * A deliberate "chaos" flag for demoing failure states, the same way
    real teams use feature flags / chaos engineering to test error paths
    (?simulate=500)

Run it with:
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000
"""

import time
import asyncio
from collections import defaultdict, deque
from typing import Optional

import jwt
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="API Flow Explainer — Demo Backend", version="1.0.0")

# Frontend is a static page opened straight from disk / a different port,
# so CORS is wide open here — fine for a local demo, not for production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SECRET_KEY = "demo-secret-do-not-use-in-production"
ALGORITHM = "HS256"
TOKEN_TTL_SECONDS = 3600

# ---------------------------------------------------------------------------
# In-memory state (this is a demo — a real service would use Redis/Postgres)
# ---------------------------------------------------------------------------
idempotency_cache: dict[str, dict] = {}
rate_buckets: dict[str, deque] = defaultdict(deque)

RATE_LIMIT = 5          # max requests
RATE_WINDOW_SECONDS = 10  # per this many seconds, per client


def check_rate_limit(client_id: str) -> bool:
    """A real sliding-window rate limiter, not a mock."""
    now = time.time()
    bucket = rate_buckets[client_id]
    while bucket and now - bucket[0] > RATE_WINDOW_SECONDS:
        bucket.popleft()
    if len(bucket) >= RATE_LIMIT:
        return False
    bucket.append(now)
    return True


def issue_token() -> str:
    payload = {
        "sub": "demo-client",
        "iat": int(time.time()),
        "exp": int(time.time()) + TOKEN_TTL_SECONDS,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(authorization: Optional[str]) -> None:
    """Raises 401 the same way a real gateway would — missing header,
    malformed header, expired token, and bad signature are all distinct
    real failure modes, not one generic error."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization header must use the Bearer scheme")
    token = authorization.split(" ", 1)[1]
    try:
        jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token signature is invalid")


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "Bearer"
    expires_in: int = TOKEN_TTL_SECONDS


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/v1/auth/token", response_model=TokenResponse)
async def auth_token():
    """Client-credentials grant. In a real system this would check a
    client_id/client_secret pair; here it always succeeds so the demo
    stays focused on what happens *after* auth."""
    await asyncio.sleep(0.15)  # auth service round trip
    return TokenResponse(access_token=issue_token())


@app.get("/v1/users/{user_id}")
async def get_user(
    user_id: int,
    authorization: Optional[str] = Header(None),
    simulate: Optional[str] = Query(None, description="Force a specific failure for demo purposes"),
):
    if simulate == "429":
        raise HTTPException(status_code=429, detail="Rate limit exceeded — try again shortly")
    if not check_rate_limit("demo-client"):
        raise HTTPException(status_code=429, detail="Rate limit exceeded — try again shortly")

    verify_token(authorization)

    if simulate == "500":
        await asyncio.sleep(0.2)
        raise HTTPException(status_code=500, detail="Backend service crashed (simulated failure)")

    await asyncio.sleep(0.25)  # database read latency
    return {
        "id": user_id,
        "name": "Alex Rivera",
        "email": "alex@example.com",
        "joined": "2026-01-14",
    }


@app.post("/v1/users/{user_id}")
async def update_user(
    user_id: int,
    body: UserUpdate,
    authorization: Optional[str] = Header(None),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    simulate: Optional[str] = Query(None),
):
    if simulate == "429":
        raise HTTPException(status_code=429, detail="Rate limit exceeded — try again shortly")
    if not check_rate_limit("demo-client"):
        raise HTTPException(status_code=429, detail="Rate limit exceeded — try again shortly")

    verify_token(authorization)

    # Idempotency: replaying the same key returns the original result
    # without repeating the side effect — this is the mechanism Stripe
    # and most payment APIs use so a retried write can never double-charge.
    if idempotency_key and idempotency_key in idempotency_cache:
        cached = dict(idempotency_cache[idempotency_key])
        cached["idempotent_replay"] = True
        return cached

    if simulate == "500":
        await asyncio.sleep(0.2)
        raise HTTPException(status_code=500, detail="Backend service crashed (simulated failure)")

    await asyncio.sleep(0.3)  # database write latency
    response = {
        "id": user_id,
        "name": body.name or "Alex Rivera",
        "email": body.email or "alex@example.com",
        "updated": True,
    }
    if idempotency_key:
        idempotency_cache[idempotency_key] = response
    return response
