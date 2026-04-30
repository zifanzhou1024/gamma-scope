# GammaScope Backend Route Consolidation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove avoidable server-side proxy hops and centralize live snapshot materialization so frontend pages and backend routes use one clear live data path.

**Architecture:** Keep one FastAPI backend, one Next.js web app, and source-specific collectors. Browser/client calls continue to use same-origin Next API routes for auth and cookie boundaries, while server components fetch FastAPI directly. FastAPI routes use a shared live snapshot service/cache keyed by collector state revision and session/symbol instead of rebuilding snapshots independently in each route.

**Tech Stack:** Next.js App Router, Vitest, FastAPI, pytest, Pydantic-generated contracts, local collector state, Postgres-backed replay/heatmap persistence.

---

## File Structure

- Create: `apps/web/lib/serverBackendFetch.ts`
  - Owns FastAPI URL construction and optional admin-token forwarding for server-side web loaders.
- Modify: `apps/web/lib/serverExperimentalAnalyticsSource.ts`
  - Fetches `GET /api/spx/0dte/experimental/latest` directly from FastAPI on the server.
- Modify: `apps/web/lib/serverHeatmapSource.ts`
  - Fetches `GET /api/spx/0dte/heatmap/latest` directly from FastAPI on the server.
- Modify: `apps/web/tests/serverExperimentalAnalyticsSource.test.ts`
  - Updates expectations from same-origin proxy URL to FastAPI URL.
  - Adds admin-token forwarding coverage.
- Modify: `apps/web/tests/serverHeatmapSource.test.ts`
  - Updates expectations so symbol requests target FastAPI directly.
- Modify: `apps/api/gammascope_api/ingestion/collector_state.py`
  - Adds a monotonic revision to safely invalidate cached live snapshots.
- Create: `apps/api/gammascope_api/ingestion/live_snapshot_service.py`
  - Owns cached live dashboard/session/symbol snapshot materialization.
- Modify: `apps/api/gammascope_api/routes/snapshot.py`
  - Reads latest dashboard snapshot through the shared service.
- Modify: `apps/api/gammascope_api/routes/experimental.py`
  - Reads latest dashboard snapshot through the shared service.
- Modify: `apps/api/gammascope_api/routes/heatmap.py`
  - Reads symbol snapshots through the shared service.
- Modify: `apps/api/gammascope_api/routes/scenario.py`
  - Reads latest dashboard snapshot through the shared service.
- Modify: `apps/api/gammascope_api/routes/stream.py`
  - Streams latest dashboard snapshots through the shared service.
- Create: `apps/api/tests/test_live_snapshot_service.py`
  - Verifies cache reuse, invalidation, defensive copies, and symbol mapping.
- Modify existing route tests only if needed:
  - `apps/api/tests/test_contract_endpoints.py`
  - `apps/api/tests/test_experimental_routes.py`
  - `apps/api/tests/test_heatmap_route.py`
  - `apps/api/tests/test_stream_endpoint.py`
  - `apps/api/tests/test_private_mode.py`

## Chunk 1: Frontend Server Fetch Consolidation

### Task 1: Write frontend failing tests for direct FastAPI server fetches

**Files:**
- Modify: `apps/web/tests/serverExperimentalAnalyticsSource.test.ts`
- Modify: `apps/web/tests/serverHeatmapSource.test.ts`

- [ ] **Step 1: Update the experimental server source URL test**

Change the current same-origin expectation to a direct FastAPI expectation.

```ts
it("loads latest experimental analytics directly from FastAPI on the server", async () => {
  vi.stubEnv("GAMMASCOPE_API_BASE_URL", "http://fastapi.test/");
  const payload: ExperimentalAnalytics = {
    ...seedPayload,
    meta: {
      ...seedPayload.meta,
      sourceSessionId: "api-session"
    }
  };
  const fetcher = vi.fn(async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  }));

  await expect(loadLatestExperimentalAnalytics(fetcher as typeof fetch, new Headers({
    "x-forwarded-host": "gamma.example",
    "x-forwarded-proto": "https"
  }))).resolves.toEqual(payload);

  expect(fetcher).toHaveBeenCalledWith("http://fastapi.test/api/spx/0dte/experimental/latest", {
    cache: "no-store",
    headers: {
      Accept: "application/json"
    }
  });
});
```

- [ ] **Step 2: Add experimental admin-token forwarding coverage**

Add imports:

```ts
import { ADMIN_COOKIE_NAME, createAdminSessionValue } from "../lib/adminSession";
```

Add a test that a valid web admin cookie causes the server loader to forward only the backend admin token, not the browser cookie.

```ts
it("forwards the backend admin token for a valid server admin session", async () => {
  vi.stubEnv("GAMMASCOPE_API_BASE_URL", "http://fastapi.test");
  vi.stubEnv("GAMMASCOPE_ADMIN_TOKEN", "api-admin-token");
  vi.stubEnv("GAMMASCOPE_WEB_ADMIN_USERNAME", "admin");
  vi.stubEnv("GAMMASCOPE_WEB_ADMIN_PASSWORD", "password");
  vi.stubEnv("GAMMASCOPE_WEB_ADMIN_SESSION_SECRET", "x".repeat(32));

  const fetcher = vi.fn(async () => new Response(JSON.stringify(seedPayload), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  }));
  const sessionCookie = `${ADMIN_COOKIE_NAME}=${encodeURIComponent(createAdminSessionValue())}`;

  await loadLatestExperimentalAnalytics(fetcher as typeof fetch, new Headers({
    host: "gamma.local",
    cookie: sessionCookie
  }));

  expect(fetcher).toHaveBeenCalledWith("http://fastapi.test/api/spx/0dte/experimental/latest", {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "X-GammaScope-Admin-Token": "api-admin-token"
    }
  });
});
```

- [ ] **Step 3: Add heatmap direct FastAPI URL coverage**

Extend `apps/web/tests/serverHeatmapSource.test.ts` with a URL assertion. Keep the existing unavailable-slot behavior.

```ts
it("loads heatmap symbols directly from FastAPI on the server", async () => {
  vi.stubEnv("GAMMASCOPE_API_BASE_URL", "http://fastapi.test/");
  const fetcher = vi.fn(async (input: string) => {
    const symbol = new URL(input).searchParams.get("symbol");
    return new Response(JSON.stringify(heatmapPayload(toSupportedSymbol(symbol))), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });
  });

  await loadLatestHeatmaps(fetcher as typeof fetch, new Headers({ host: "gamma.test" }));

  expect(fetcher).toHaveBeenCalledWith(
    "http://fastapi.test/api/spx/0dte/heatmap/latest?metric=gex&symbol=SPX",
    expect.objectContaining({
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    })
  );
});
```

- [ ] **Step 4: Run frontend tests to verify RED**

Run:

```bash
pnpm --filter @gammascope/web test -- serverExperimentalAnalyticsSource.test.ts serverHeatmapSource.test.ts
```

Expected: FAIL because the current loaders call `http://<same-origin>/api/...`.

### Task 2: Implement the shared server backend fetch helper

**Files:**
- Create: `apps/web/lib/serverBackendFetch.ts`
- Modify: `apps/web/lib/serverExperimentalAnalyticsSource.ts`
- Modify: `apps/web/lib/serverHeatmapSource.ts`

- [ ] **Step 1: Create `serverBackendFetch.ts`**

Use this helper shape. Keep it small; do not move browser/client source helpers into it.

```ts
import { verifyAdminRequest } from "./adminSession";

export const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
export const ADMIN_TOKEN_HEADER = "X-GammaScope-Admin-Token";

export function backendApiUrl(
  path: string,
  searchParams?: URLSearchParams,
  apiBaseUrl = process.env.GAMMASCOPE_API_BASE_URL ?? DEFAULT_API_BASE_URL
): string {
  const base = apiBaseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const query = searchParams?.toString();
  return query ? `${base}${normalizedPath}?${query}` : `${base}${normalizedPath}`;
}

export function backendJsonHeaders(requestHeaders?: Pick<Headers, "get">): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json"
  };
  const adminToken = process.env.GAMMASCOPE_ADMIN_TOKEN?.trim();

  if (adminToken && requestHeaders && requestHasValidAdminSession(requestHeaders)) {
    headers[ADMIN_TOKEN_HEADER] = adminToken;
  }

  return headers;
}

function requestHasValidAdminSession(requestHeaders: Pick<Headers, "get">): boolean {
  const cookie = requestHeaders.get("cookie");
  if (!cookie) {
    return false;
  }

  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const request = new Request(`${protocol}://${host}/__gammascope_backend_fetch_auth`, {
    headers: {
      cookie
    }
  });

  return verifyAdminRequest(request, { csrf: false }).ok;
}
```

- [ ] **Step 2: Update `serverExperimentalAnalyticsSource.ts`**

Replace `sameOriginProxyUrl` and `proxyRequestHeaders` with the helper.

```ts
import { backendApiUrl, backendJsonHeaders } from "./serverBackendFetch";

const EXPERIMENTAL_LATEST_PATH = "/api/spx/0dte/experimental/latest";

// inside loadLatestExperimentalAnalytics:
const response = await fetcher(backendApiUrl(EXPERIMENTAL_LATEST_PATH), {
  cache: "no-store",
  headers: backendJsonHeaders(requestHeaders)
});
```

Delete the old `sameOriginProxyUrl` and `proxyRequestHeaders` functions from this file.

- [ ] **Step 3: Update `serverHeatmapSource.ts`**

Replace same-origin proxy URL construction with direct FastAPI URL construction.

```ts
import { backendApiUrl, backendJsonHeaders } from "./serverBackendFetch";

const HEATMAP_PATH = "/api/spx/0dte/heatmap/latest";

// inside loadLatestHeatmapForSymbol:
const params = new URLSearchParams({ metric: "gex", symbol });
const response = await fetcher(backendApiUrl(HEATMAP_PATH, params), {
  cache: "no-store",
  headers: backendJsonHeaders(requestHeaders)
});
```

Delete the old `sameOriginProxyUrl` and `proxyRequestHeaders` functions from this file.

- [ ] **Step 4: Run focused frontend tests to verify GREEN**

Run:

```bash
pnpm --filter @gammascope/web test -- serverExperimentalAnalyticsSource.test.ts serverHeatmapSource.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run frontend typecheck**

Run:

```bash
pnpm typecheck:web
```

Expected: PASS.

## Chunk 2: Backend Live Snapshot Service

### Task 3: Add collector state revision support

**Files:**
- Modify: `apps/api/gammascope_api/ingestion/collector_state.py`
- Test: `apps/api/tests/test_latest_state_cache.py` or new assertions in `apps/api/tests/test_live_snapshot_service.py`

- [ ] **Step 1: Write a failing revision test**

Add this in `apps/api/tests/test_live_snapshot_service.py` once the file exists, or in `test_latest_state_cache.py` temporarily.

```py
def test_collector_state_revision_increments_on_ingest() -> None:
    state = CollectorState()
    assert state.revision() == 0

    state.ingest(CollectorEvents.model_validate(_health_event("2026-04-24T15:30:00Z")))

    assert state.revision() == 1
    assert state.snapshot()["revision"] == 1
```

Use an existing `_health_event` helper from the nearest test file, or define the minimal helper locally.

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_live_snapshot_service.py::test_collector_state_revision_increments_on_ingest -q
```

Expected: FAIL because `revision()` does not exist.

- [ ] **Step 3: Implement revision support**

In `CollectorState`:

```py
def clear(self) -> None:
    self._revision = 0
    self._health_events = {}
    self._contracts = {}
    self._underlying_ticks = {}
    self._option_ticks = {}
    self._last_event_time = None

def ingest(self, event: CollectorEvents) -> str:
    ...
    self._revision += 1
    return event_type

def revision(self) -> int:
    return self._revision
```

Include revision in `summary()` and `snapshot()`:

```py
"revision": self._revision,
```

Restore it in `from_snapshot()`:

```py
state._revision = int(snapshot.get("revision") or 0)
```

- [ ] **Step 4: Run focused test**

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_live_snapshot_service.py::test_collector_state_revision_increments_on_ingest -q
```

Expected: PASS.

### Task 4: Add the live snapshot service/cache

**Files:**
- Create: `apps/api/gammascope_api/ingestion/live_snapshot_service.py`
- Test: `apps/api/tests/test_live_snapshot_service.py`

- [ ] **Step 1: Write failing service tests**

Add these tests with local event helpers copied from `apps/api/tests/test_heatmap_route.py` or `apps/api/tests/test_contract_endpoints.py`.

```py
from gammascope_api.contracts.generated.collector_events import CollectorEvents
from gammascope_api.ingestion.collector_state import CollectorState
from gammascope_api.ingestion.live_snapshot_service import LiveSnapshotService


def test_live_snapshot_service_caches_dashboard_snapshot_until_state_revision_changes(monkeypatch) -> None:
    state = CollectorState()
    for event in _spx_events(spot=5200.0, event_time="2026-04-24T15:30:01Z"):
        state.ingest(CollectorEvents.model_validate(event))
    calls = 0

    def fake_builder(input_state):
        nonlocal calls
        calls += 1
        return {"session_id": "moomoo-spx-0dte-live", "spot": input_state.latest_underlying_tick()["spot"]}

    monkeypatch.setattr(
        "gammascope_api.ingestion.live_snapshot_service.build_spx_dashboard_live_snapshot",
        fake_builder,
    )

    service = LiveSnapshotService(lambda: state)

    assert service.dashboard_snapshot()["spot"] == 5200.0
    assert service.dashboard_snapshot()["spot"] == 5200.0
    assert calls == 1

    for event in _spx_events(spot=5210.0, event_time="2026-04-24T15:30:02Z"):
        state.ingest(CollectorEvents.model_validate(event))

    assert service.dashboard_snapshot()["spot"] == 5210.0
    assert calls == 2
```

```py
def test_live_snapshot_service_returns_defensive_copies(monkeypatch) -> None:
    state = CollectorState()
    state.ingest(CollectorEvents.model_validate(_health_event("2026-04-24T15:30:00Z")))

    monkeypatch.setattr(
        "gammascope_api.ingestion.live_snapshot_service.build_spx_dashboard_live_snapshot",
        lambda _: {"session_id": "moomoo-spx-0dte-live", "rows": []},
    )

    service = LiveSnapshotService(lambda: state)
    first = service.dashboard_snapshot()
    first["rows"].append({"mutated": True})

    assert service.dashboard_snapshot()["rows"] == []
```

```py
def test_live_snapshot_service_maps_heatmap_symbols_to_live_sessions(monkeypatch) -> None:
    state = CollectorState()
    state.ingest(CollectorEvents.model_validate(_health_event("2026-04-24T15:30:00Z")))
    requested = []

    def fake_build_live_snapshot(_state, *, session_id=None):
        requested.append(session_id)
        return {"session_id": session_id}

    monkeypatch.setattr(
        "gammascope_api.ingestion.live_snapshot_service.build_live_snapshot",
        fake_build_live_snapshot,
    )

    service = LiveSnapshotService(lambda: state)

    assert service.symbol_snapshot("SPY") == {"session_id": "moomoo-spy-0dte-live"}
    assert requested == ["moomoo-spy-0dte-live"]
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_live_snapshot_service.py -q
```

Expected: FAIL because `live_snapshot_service.py` does not exist yet.

- [ ] **Step 3: Implement `live_snapshot_service.py`**

Use this shape:

```py
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Callable, Literal

from gammascope_api.ingestion.collector_state import CollectorState
from gammascope_api.ingestion.latest_state_cache import cached_or_memory_collector_state
from gammascope_api.ingestion.live_snapshot import build_live_snapshot, build_spx_dashboard_live_snapshot

HeatmapSymbol = Literal["SPX", "SPY", "QQQ", "NDX", "IWM"]

MOOMOO_LIVE_REPLAY_SESSION_IDS: dict[HeatmapSymbol, str] = {
    "SPX": "moomoo-spx-0dte-live",
    "SPY": "moomoo-spy-0dte-live",
    "QQQ": "moomoo-qqq-0dte-live",
    "NDX": "moomoo-ndx-0dte-live",
    "IWM": "moomoo-iwm-0dte-live",
}

_DASHBOARD_KEY = "__dashboard__"


@dataclass(frozen=True)
class _CachedSnapshot:
    state_revision: int
    snapshot: dict[str, Any] | None


class LiveSnapshotService:
    def __init__(self, state_provider: Callable[[], CollectorState] = cached_or_memory_collector_state) -> None:
        self._state_provider = state_provider
        self._cache: dict[str, _CachedSnapshot] = {}

    def dashboard_snapshot(self) -> dict[str, Any] | None:
        return self._cached_snapshot(
            _DASHBOARD_KEY,
            lambda state: build_spx_dashboard_live_snapshot(state),
        )

    def session_snapshot(self, session_id: str) -> dict[str, Any] | None:
        return self._cached_snapshot(
            session_id,
            lambda state: build_live_snapshot(state, session_id=session_id),
        )

    def symbol_snapshot(self, symbol: HeatmapSymbol) -> dict[str, Any] | None:
        return self.session_snapshot(MOOMOO_LIVE_REPLAY_SESSION_IDS[symbol])

    def _cached_snapshot(
        self,
        cache_key: str,
        builder: Callable[[CollectorState], dict[str, Any] | None],
    ) -> dict[str, Any] | None:
        state = self._state_provider()
        state_revision = state.revision()
        cached = self._cache.get(cache_key)

        if cached is None or cached.state_revision != state_revision:
            cached = _CachedSnapshot(state_revision=state_revision, snapshot=builder(state))
            self._cache[cache_key] = cached

        return deepcopy(cached.snapshot) if cached.snapshot is not None else None


_service_override: LiveSnapshotService | None = None


def get_live_snapshot_service() -> LiveSnapshotService:
    if _service_override is not None:
        return _service_override
    return _default_live_snapshot_service()


def set_live_snapshot_service_override(service: LiveSnapshotService) -> None:
    global _service_override
    _service_override = service


def reset_live_snapshot_service_override() -> None:
    global _service_override
    _service_override = None
    _default_live_snapshot_service.cache_clear()


@lru_cache(maxsize=1)
def _default_live_snapshot_service() -> LiveSnapshotService:
    return LiveSnapshotService()
```

- [ ] **Step 4: Run focused service tests to verify GREEN**

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest apps/api/tests/test_live_snapshot_service.py -q
```

Expected: PASS.

### Task 5: Route FastAPI live readers through the service

**Files:**
- Modify: `apps/api/gammascope_api/routes/snapshot.py`
- Modify: `apps/api/gammascope_api/routes/experimental.py`
- Modify: `apps/api/gammascope_api/routes/heatmap.py`
- Modify: `apps/api/gammascope_api/routes/scenario.py`
- Modify: `apps/api/gammascope_api/routes/stream.py`

- [ ] **Step 1: Update `snapshot.py`**

Replace:

```py
live_snapshot = build_spx_dashboard_live_snapshot(cached_or_memory_collector_state())
```

with:

```py
live_snapshot = get_live_snapshot_service().dashboard_snapshot()
```

Remove unused imports for `cached_or_memory_collector_state` and `build_spx_dashboard_live_snapshot`.

- [ ] **Step 2: Update `experimental.py`**

Use:

```py
live_snapshot = get_live_snapshot_service().dashboard_snapshot()
```

Keep `build_experimental_payload(live_snapshot, "latest")` unchanged.

- [ ] **Step 3: Update `scenario.py`**

Use:

```py
live_snapshot = get_live_snapshot_service().dashboard_snapshot()
```

Keep scenario calculation behavior unchanged.

- [ ] **Step 4: Update `stream.py`**

In `_current_snapshot()`, use:

```py
live_snapshot = get_live_snapshot_service().dashboard_snapshot()
```

Keep replay websocket behavior unchanged.

- [ ] **Step 5: Update `heatmap.py`**

Import `MOOMOO_LIVE_REPLAY_SESSION_IDS`, `HeatmapSymbol`, and `get_live_snapshot_service` from `live_snapshot_service`.

Delete the local `HeatmapSymbol` literal and `MOOMOO_LIVE_REPLAY_SESSION_IDS` mapping from `heatmap.py`.

Use:

```py
live_snapshot = get_live_snapshot_service().symbol_snapshot(symbol)
```

Keep `_latest_moomoo_live_replay_snapshot(symbol)` as the Postgres fallback.

- [ ] **Step 6: Run focused backend route tests**

Run:

```bash
PYTHONPATH=apps/api .venv/bin/pytest \
  apps/api/tests/test_live_snapshot_service.py \
  apps/api/tests/test_contract_endpoints.py \
  apps/api/tests/test_experimental_routes.py \
  apps/api/tests/test_heatmap_route.py \
  apps/api/tests/test_stream_endpoint.py \
  apps/api/tests/test_private_mode.py \
  -q
```

Expected: PASS.

If any tests fail because cached snapshots persist between tests with intentionally reused event fixtures, call `reset_live_snapshot_service_override()` or `_default_live_snapshot_service.cache_clear()` from the relevant test fixture. Prefer adding a shared autouse fixture only if multiple files need it.

## Chunk 3: Full Verification and Cleanup

### Task 6: Run full project verification

**Files:**
- No planned source edits.

- [ ] **Step 1: Run frontend verification**

Run:

```bash
pnpm typecheck:web && pnpm test:web
```

Expected: PASS.

- [ ] **Step 2: Run backend verification**

Run:

```bash
pnpm test:api
```

Expected: PASS.

- [ ] **Step 3: Run collector tests if collector contracts changed unexpectedly**

Run this only if edits touched collector event contracts or collector state snapshots consumed by collector tests:

```bash
pnpm test:collector
```

Expected: PASS.

- [ ] **Step 4: Browser smoke check**

With API and web running:

```bash
GAMMASCOPE_API_BASE_URL=http://127.0.0.1:8000 \
NEXT_PUBLIC_GAMMASCOPE_WS_URL=ws://127.0.0.1:8000/ws/spx/0dte \
pnpm dev:web
```

Check:

- `http://localhost:3000/experimental` renders live or fallback experimental analytics without console errors.
- `http://localhost:3000/heatmap` renders all supported heatmap panels.
- `http://localhost:3000/` still receives live dashboard updates.

Expected: pages render, no browser console errors, API logs show FastAPI requests from Next server without same-origin `/api/...` recursion for server initial loads.

### Task 7: Final review checklist

- [ ] Confirm browser/client calls still use same-origin Next proxy paths.
- [ ] Confirm server components fetch `GAMMASCOPE_API_BASE_URL` directly.
- [ ] Confirm FastAPI route behavior is unchanged externally.
- [ ] Confirm `source` contract naming is not changed in this plan; source-neutral Moomoo/IBKR ingestion is a separate larger migration.
- [ ] Confirm no unrelated dirty file changes were reverted, especially generated `apps/web/next-env.d.ts`.

## Expected End State

- Server-rendered `/experimental` and `/heatmap` no longer do a Next route handler hop before reaching FastAPI.
- FastAPI live readers share one live snapshot service/cache.
- The Moomoo and IBKR capabilities remain intact.
- Existing public API paths remain compatible:
  - `GET /api/spx/0dte/snapshot/latest`
  - `GET /api/spx/0dte/experimental/latest`
  - `GET /api/spx/0dte/heatmap/latest`
  - `POST /api/spx/0dte/scenario`
  - `WS /ws/spx/0dte`
