# GammaScope Architecture Blueprint Design

Date: 2026-04-23
Status: Draft for review
Repository: gamma-scope

## Summary

GammaScope is a live-first SPX 0DTE analytics platform. It combines a local IBKR data collector, a FastAPI analytics backend, and a polished Next.js dashboard for exploring implied volatility, gamma, and vanna in real time.

The first product goal is portfolio signal: make the project credible, demoable, and visually polished while still being grounded in a realistic live market-data architecture. The platform starts with SPX/SPXW 0DTE only, then preserves clean boundaries for later expansion to other expiries or symbols.

## Goals

- Show a live SPX 0DTE session as the primary product experience.
- Keep IBKR/TWS or IB Gateway on the developer's machine for the first live-data edge.
- Support local integrated testing before any hosted rollout.
- Provide replay/demo sessions so the project works outside market hours and in public deployments.
- Compute custom IV, gamma, and vanna with documented formulas and tests.
- Store IBKR-provided IV/Greeks beside custom analytics as a secondary comparison layer.
- Retain rolling multi-day history, with a schema that can grow into a research archive later.
- Use light authentication for public replay plus private/admin live mode.
- Deploy later as a practical portfolio stack: Vercel frontend, hosted FastAPI, managed Postgres, managed Redis, and a controlled bridge to the local collector when ready.

## Non-Goals

- Do not build a general-purpose options platform in the first slice.
- Do not host IB Gateway/TWS in cloud infrastructure for the initial version.
- Do not promise trading-grade risk, execution, alerts, or recommendations.
- Do not start with full multi-user account management.
- Do not optimize the first data model for long-term research storage at the cost of product delivery.

## Recommended Approach

Use a live-first portfolio architecture. The local collector proves live-data credibility, while replay/demo data keeps the app publicly demoable. This avoids a replay-only product that feels staged, and it avoids an enterprise data platform that delays the visible product.

The application should present the live dashboard first. Replay and scenario analysis should use the same dashboard data contracts so they feel like natural modes of the same product, not separate demos.

"Live-first" describes the product architecture and final user experience, not the first code slice. Implementation should begin with shared contracts, analytics fixtures, and seeded replay data because those create a stable local test harness. The live collector then plugs into the same contracts.

## System Architecture

GammaScope has three main runtime surfaces.

### Local IBKR Collector

The collector runs on the developer's machine near IB Gateway or Trader Workstation. It owns:

- IBKR connection lifecycle and health state.
- SPX/SPXW 0DTE contract discovery.
- Strike-window selection around spot.
- Market data subscriptions.
- Normalization of underlying ticks, option ticks, contract metadata, and IBKR model values.
- Reconnect behavior and freshness reporting.
- A local-to-backend publishing path for live sessions.

The collector should be replaceable at the boundary. The first implementation can be IBKR-specific internally, but downstream services should receive normalized market-data messages so future providers or recorded sessions can reuse the same contracts.

Initial live scope:

- Symbol: SPX/SPXW.
- Expiry: current trading day's 0DTE expiry.
- Strike window: default plus/minus 20 strike levels around spot, calls and puts, configurable by environment.
- Subscription fallback: if rate limits, permissions, or quote quality prevent the default window, reduce to plus/minus 10 strike levels and mark chain coverage as partial.

### FastAPI Backend and Analytics

The backend receives normalized data from the collector or replay source, computes analytics, persists rolling history, and serves the frontend. It owns:

- Ingestion APIs or stream endpoints for collector messages.
- Session and contract state.
- Snapshot assembly for selected strike windows.
- Custom IV, gamma, and vanna calculations.
- IBKR comparison storage and difference reporting.
- REST APIs for status, latest snapshots, historical ranges, saved views, and scenario inputs.
- WebSocket streams for live dashboard updates and replay playback.
- Postgres persistence and Redis latest-state/cache usage.

Initial live cadence:

- Collector ingests ticks as they arrive.
- Backend computes and caches the latest analytics snapshot at most once per second per active session.
- WebSocket streams emit at most one dashboard snapshot per second.
- Postgres stores chain and analytics snapshots every 5 seconds during active live sessions, plus explicit replay/demo seed snapshots.

### Next.js Web App

The frontend is the product surface. It owns:

- Live session dashboard.
- Replay dashboard using the same visual layout and data shape as live mode.
- Scenario panel for spot, volatility, and time-to-expiry shifts.
- Option chain table with custom analytics and IBKR comparison columns.
- Connection, freshness, partial-data, and calculation-state indicators.
- Saved views and lightweight admin/private preferences.

Public visitors can use replay/demo sessions. Admin/private mode can unlock live streams once the local collector and backend are stable.

Light auth boundary:

- Local integrated testing can run without auth.
- Hosted replay mode has public read-only access to replay/demo sessions.
- Admin/private mode uses one configured admin identity or secret-backed session, not open sign-up.
- Saved views are scoped to either `public_demo` or `admin`; no multi-user account management is included in the first architecture.

## Product Experience

The first screen should communicate that GammaScope is watching a real SPX 0DTE session. It should show:

- SPX spot/reference price.
- Current 0DTE expiry.
- Connection and freshness state.
- IV smile chart.
- Gamma by strike chart.
- Vanna by strike chart.
- Option chain table.
- IBKR comparison values and differences where available.

Modes should be organized as:

- Live: real-time session, freshness state, collector health, latest analytics.
- Replay: stored sessions with scrubber controls and timestamp comparison.
- Scenario: adjustments to spot, volatility, and time-to-expiry from a live or replay snapshot.

Saved views should stay lightweight at first: selected mode, strike window, chart layout, filters, and admin/private preferences.

## Data Flow

### Live Path

```text
IB Gateway/TWS
  -> Local Collector
  -> Backend Ingestion
  -> Analytics Snapshot
  -> Postgres / Redis
  -> WebSocket / REST
  -> Next.js Web App
```

The collector emits normalized messages for underlying ticks, option ticks, option contracts, model values, and collector health. The backend groups these into coherent timestamped chain snapshots, computes analytics, stores rolling history, caches latest state, and streams updates.

### Replay Path

```text
Stored Session
  -> Replay Cursor
  -> Analytics Snapshot
  -> WebSocket / REST
  -> Next.js Web App
```

Replay should reuse the same frontend-facing analytics snapshot contract as live mode. This keeps the dashboard honest and makes public demo mode a real product workflow instead of a separate mock.

## Message and API Contracts

All cross-service payloads should include `schema_version`, `source`, `session_id`, `event_time`, and `received_time` where applicable. The backend owns contract versioning and should reject unsupported major versions with a visible ingestion error.

### Collector Messages

`CollectorHealth`

- `schema_version`
- `source`: `ibkr`
- `collector_id`
- `status`: `starting`, `connected`, `degraded`, `disconnected`, `stale`, `error`
- `ibkr_account_mode`: `paper`, `live`, or `unknown`
- `message`
- `event_time`
- `received_time`

`ContractDiscovered`

- `schema_version`
- `source`
- `session_id`
- `contract_id`
- `ibkr_con_id`
- `symbol`
- `expiry`
- `right`: `call` or `put`
- `strike`
- `multiplier`
- `exchange`
- `currency`
- `event_time`

`UnderlyingTick`

- `schema_version`
- `source`
- `session_id`
- `symbol`
- `spot`
- `bid`
- `ask`
- `last`
- `mark`
- `event_time`
- `quote_status`: `valid`, `stale`, `missing`, `invalid`

`OptionTick`

- `schema_version`
- `source`
- `session_id`
- `contract_id`
- `bid`
- `ask`
- `last`
- `bid_size`
- `ask_size`
- `volume`
- `open_interest`
- `ibkr_iv`
- `ibkr_delta`
- `ibkr_gamma`
- `ibkr_vega`
- `ibkr_theta`
- `event_time`
- `quote_status`: `valid`, `stale`, `missing`, `crossed`, `invalid`

### Frontend Snapshot Contract

`AnalyticsSnapshot`

- `schema_version`
- `session_id`
- `mode`: `live`, `replay`, or `scenario`
- `symbol`
- `expiry`
- `snapshot_time`
- `spot`
- `source_status`
- `freshness_ms`
- `coverage_status`: `full`, `partial`, or `empty`
- `scenario_params`, nullable
- `rows`: strike/right-level analytics rows

Each analytics row includes:

- `contract_id`
- `right`
- `strike`
- `bid`
- `ask`
- `mid`
- `custom_iv`
- `custom_gamma`
- `custom_vanna`
- `ibkr_iv`
- `ibkr_gamma`
- `ibkr_vanna`, nullable if unavailable
- `iv_diff`
- `gamma_diff`
- `calc_status`: `ok`, `missing_quote`, `invalid_quote`, `stale_underlying`, `solver_failed`, `out_of_model_scope`
- `comparison_status`: `ok`, `missing`, `stale`, `outside_tolerance`, `not_supported`

### Core API Surface

- `GET /api/spx/0dte/status`: session, collector, freshness, and coverage state.
- `GET /api/spx/0dte/snapshot/latest`: latest `AnalyticsSnapshot`.
- `GET /api/spx/0dte/replay/sessions`: stored replay ranges.
- `GET /api/spx/0dte/replay/snapshot?session_id=&at=`: replay snapshot at a timestamp.
- `POST /api/spx/0dte/scenario`: scenario request and response.
- `GET /api/views` and `POST /api/views`: lightweight saved views for `public_demo` or `admin`.
- `WS /ws/spx/0dte`: streamed `AnalyticsSnapshot` and health events.

## Analytics Design

Custom analytics are the primary displayed values. IBKR-provided analytics are a comparison layer.

### Custom Analytics

The analytics service should compute:

- Implied volatility from option mid price using a documented Black-Scholes-Merton style model for index options.
- Gamma by strike from computed IV and time-to-expiry, reported as delta change per one index point.
- Vanna by strike from computed IV and time-to-expiry. Store raw vanna as delta change per 1.00 volatility unit, and display normalized vanna per one volatility point by multiplying raw vanna by 0.01.

Formula documentation should state assumptions for interest rates, dividend yield or forward treatment, time-to-expiry, option multiplier, quote selection, and invalid market handling.

Initial formula conventions:

- Option price input: mid price when bid and ask are valid; otherwise mark invalid unless an explicit fallback is enabled for demo data.
- Time-to-expiry: actual seconds from quote timestamp to the configured expiry cutoff, annualized with ACT/365.
- Expiry cutoff: configurable per session; default to the SPXW PM-settled market close cutoff for 0DTE sessions.
- Rate: annualized risk-free rate from session configuration; seeded fixtures use a fixed deterministic value.
- Dividend/forward treatment: use continuous dividend yield from session configuration, defaulting to zero for initial demo fixtures.
- Solver: bounded implied-volatility solve with explicit failure status instead of silent fallback.
- Units: volatility stored as decimal annualized volatility, not percentage points.

### IBKR Comparison

When available, IBKR model IV and Greeks should be stored beside custom values. The UI can show:

- Custom value.
- IBKR value.
- Absolute or percentage difference.
- Missing/stale comparison state.
- Confidence or warning badges when tolerances are exceeded.

IBKR values should not block dashboard rendering. Missing or stale broker analytics should degrade gracefully.

### Analytics Edge Cases

The first version should handle:

- Missing bid or ask.
- Crossed or locked quotes.
- Very low option prices.
- Near-expiry time values.
- Deep in/out-of-the-money contracts.
- Stale underlying prices.
- Calculation failures with visible per-contract status.

### Scenario Semantics

Scenario analysis is an explicit backend calculation, not a persisted market event.

`ScenarioRequest` includes:

- `base_snapshot_id` or `session_id` plus `snapshot_time`
- `spot_shift_points`
- `vol_shift_points`, where 1.0 means one volatility percentage point
- `time_shift_minutes`

The backend returns an `AnalyticsSnapshot` with `mode` set to `scenario` and `scenario_params` populated. The scenario engine uses the base snapshot's custom IV as the starting volatility, applies the requested volatility shift, shifts spot and time-to-expiry, and recomputes gamma and vanna. It does not infer a new market option price or persist scenario rows unless a later saved-scenario feature is explicitly added.

## Data Model

The persistent model should separate normalized market data from derived analytics.

Core entities:

- Trading sessions: date, symbol, expiry, market hours, status, source.
- Option contracts: IBKR conId, symbol, right, strike, expiry, multiplier, exchange, currency.
- Underlying ticks: timestamp, symbol, spot/reference price, source, freshness metadata.
- Option ticks: timestamp, contract, bid, ask, last, size, volume, open interest, model fields when available.
- Chain snapshots: timestamped coherent strike-window views for a session.
- Analytics snapshots: custom IV/gamma/vanna, IBKR values, differences, calculation status.
- Replay sessions and cursors: ranges, playback metadata, source session.
- Saved views: lightweight public-demo or admin dashboard settings.

Retention starts as rolling multi-day history, configurable by environment. A practical first target is 5-20 trading days. The schema should preserve enough normalized data that a future research archive can be added by exporting or extending storage rather than replacing product tables.

## Error Handling and Operations

GammaScope should surface data quality calmly and explicitly. The system should represent:

- IBKR disconnected.
- Collector connected but no market data.
- Stale underlying or option ticks.
- Missing contracts.
- Partial strike-window coverage.
- Crossed or invalid quotes.
- Analytics calculation failures.
- Missing or stale IBKR comparison values.
- Backend ingestion lag.
- WebSocket disconnect/reconnect.

The frontend should show these states with connection badges, freshness timestamps, partial-data notices, and row-level calculation states. The goal is for reviewers to see operational maturity without noisy internal logs.

## Deployment Path

Deployment should happen in stages.

### Stage 1: Local Integrated Testing

Run the full stack locally first:

- Next.js web app.
- FastAPI backend.
- Postgres.
- Redis.
- Local IBKR collector.
- Seeded replay data for off-hours testing.

Docker Compose can orchestrate shared services, while the collector can run locally with access to IB Gateway/TWS.

### Stage 2: Hosted Portfolio Demo

Deploy the public experience with replay/demo data:

- Next.js on Vercel.
- FastAPI on a hosted service.
- Managed Postgres.
- Managed Redis.
- Public replay sessions and scenario tools.

### Stage 3: Private Live Online Mode

After the local live system is stable, add a controlled path for private/admin live access from the hosted app. This is not part of the first implementation plan. Stage 1 and Stage 2 explicitly exclude hosted live access.

The future bridge boundary is:

- Local collector remains the only component that talks to IBKR.
- Hosted backend accepts live data only from an authenticated collector identity.
- Public users remain restricted to replay/demo data.
- Admin/private live streams require auth, explicit freshness state, and a way to disable ingestion quickly.

## Testing Strategy

Testing should support both numerical credibility and product confidence.

### Analytics Tests

- IV/gamma/vanna deterministic fixtures.
- Edge cases near expiry.
- Invalid, missing, crossed, or stale quotes.
- Broker comparison tolerances.
- Formula unit and sign convention checks.

### Backend Tests

- Ingestion contract tests.
- Latest snapshot APIs.
- Replay range queries.
- Scenario endpoint behavior.
- Saved view persistence.
- Health and freshness state.
- WebSocket message shape.

### Collector Tests

- Mocked IBKR connection events.
- Contract discovery behavior.
- Strike-window selection.
- Tick normalization.
- Reconnect and stale-state transitions.

### Frontend Tests

- Live dashboard renders seeded latest snapshots.
- Replay scrubber changes charts and tables consistently.
- Scenario controls update displayed analytics.
- Empty, loading, stale, partial, and error states are visible.
- Connection badges and freshness timestamps behave predictably.

### End-to-End Smoke Tests

Use seeded replay data to run a stable portfolio demo outside market hours. The smoke test should prove that a reviewer can open the app, view a session, scrub replay, and inspect analytics without IBKR access.

## Initial Milestones

1. Project foundation: monorepo structure, local service orchestration, shared contracts, README update.
2. Analytics core: pricing/Greeks formulas, fixtures, documentation, tests.
3. Seeded replay slice: backend snapshot APIs, frontend dashboard, replay data.
4. Live collector slice: IBKR connection, SPX 0DTE discovery, normalized tick publishing.
5. Live dashboard: WebSocket stream, freshness indicators, chain table, charts.
6. Scenario panel: spot, volatility, and time controls against latest/replay snapshots.
7. Light auth/private mode: admin-only live access, public replay access.
8. Hosted replay demo: deploy web/API with managed storage and seeded sessions.

These milestones should become separate implementation plans. The first implementation plan should cover only project foundation, shared contracts, local orchestration, and enough seeded data plumbing to verify the contracts. Later plans can address analytics, replay UI, collector integration, live dashboard streaming, scenarios, auth, and deployment.

## Open Decisions

- Exact charting library for the frontend.
- Exact hosted FastAPI and managed Redis/Postgres providers.
- Local-to-hosted live bridge mechanism for private online mode.

These open decisions do not block the first local implementation plan. Strike-window defaults, cadence, formula conventions, auth boundaries, and first contract shapes are defined above.

## Approval Criteria

The architecture is successful if:

- The live SPX 0DTE path is credible and locally testable.
- Replay/demo mode works without IBKR and uses the same frontend data contracts.
- Custom analytics are documented and tested.
- IBKR comparison is visible but non-blocking.
- Data quality states are explicit in the API and UI.
- The deployment path moves from local testing to hosted replay to private live mode without redesigning core boundaries.
