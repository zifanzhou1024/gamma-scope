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

### Next.js Web App

The frontend is the product surface. It owns:

- Live session dashboard.
- Replay dashboard using the same visual layout and data shape as live mode.
- Scenario panel for spot, volatility, and time-to-expiry shifts.
- Option chain table with custom analytics and IBKR comparison columns.
- Connection, freshness, partial-data, and calculation-state indicators.
- Saved views and lightweight admin/private preferences.

Public visitors can use replay/demo sessions. Admin/private mode can unlock live streams once the local collector and backend are stable.

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

## Analytics Design

Custom analytics are the primary displayed values. IBKR-provided analytics are a comparison layer.

### Custom Analytics

The analytics service should compute:

- Implied volatility from option mid price using a documented Black-Scholes style model for index options.
- Gamma by strike from computed IV and time-to-expiry.
- Vanna by strike with a documented units and sign convention.

Formula documentation should state assumptions for interest rates, dividend yield or forward treatment, time-to-expiry, option multiplier, quote selection, and invalid market handling.

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
- Saved views/watchlists: lightweight admin/private dashboard settings.

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

After the local live system is stable, add a controlled path for private/admin live access from the hosted app. This can use a secure bridge from the local collector to the hosted backend, with authentication and clear operational controls.

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

## Open Decisions

- Exact charting library for the frontend.
- Exact hosted FastAPI and managed Redis/Postgres providers.
- Initial strike-window width around spot.
- Snapshot frequency and WebSocket throttling policy.
- Formula conventions for rates, dividends, forward price, and vanna units.
- Local-to-hosted live bridge mechanism for private online mode.

## Approval Criteria

The architecture is successful if:

- The live SPX 0DTE path is credible and locally testable.
- Replay/demo mode works without IBKR and uses the same frontend data contracts.
- Custom analytics are documented and tested.
- IBKR comparison is visible but non-blocking.
- Data quality states are explicit in the API and UI.
- The deployment path moves from local testing to hosted replay to private live mode without redesigning core boundaries.
