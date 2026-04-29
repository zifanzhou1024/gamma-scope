# Experimental Analytics Tab Design

Date: 2026-04-29
Status: User-approved design, pending implementation plan
Repository: gamma-scope

## Summary

GammaScope will add a new `Experimental` tab for testing price-only SPX 0DTE option-chain analytics before promoting the useful parts into the main trading dashboard. The tab should behave like a dense research cockpit: many panels visible at once, compact controls, explicit formula labels, and clear preview/error states.

The selected approach is a dedicated experimental backend API plus a modular frontend page. Heavy math and fitted curves live in Python so the calculations are centralized, testable, and able to use numeric libraries such as `numpy` and `scipy`. The frontend focuses on comparison, layout, toggles, replay frame selection, and rendering partial outputs without hiding the rest of the workbench.

## Goals

- Add `/experimental` as a fourth top-level tab beside Realtime, Replay, and Heatmap.
- Present many experimental outputs at once instead of a step-by-step workflow.
- Compare multiple IV smile construction methods and fitted curves side by side.
- Infer price-only metrics: parity forward, ATM straddle expected move, risk-neutral probabilities, terminal distribution preview, skew/tail asymmetry, move-needed maps, time-decay pressure, rich/cheap residuals, and no-arbitrage flags.
- Support latest snapshot analysis and lightweight replay-frame selection.
- Keep experimental formulas isolated from the existing realtime, replay, and heatmap dashboard contracts.
- Make immature outputs acceptable in v1 when they are explicitly labeled as `Experimental`, `Preview`, `Insufficient data`, or `Error`.
- Keep every formula explicit enough to test and later decide whether it belongs in the real dashboard.

## Non-Goals

- Do not replace the existing Realtime, Replay, or Heatmap pages.
- Do not change the existing `AnalyticsSnapshot` schema for this slice.
- Do not add order execution, alerts, brokerage actions, or account-risk workflows.
- Do not infer dealer positioning, gamma exposure from actual inventory, hidden liquidity, stop locations, or real-world probabilities from price-only data.
- Do not treat broker IV or last-price IV as production signals; they are diagnostic overlays.
- Do not take terminal-density derivatives from raw quote dots without smoothing or fitted prices.

## Current Project Context

GammaScope is a pnpm monorepo with:

- Next.js web app under `apps/web`.
- FastAPI backend under `apps/api`.
- Shared contracts under `packages/contracts`.
- Existing pages for `/`, `/replay`, and `/heatmap`.
- Existing `AnalyticsSnapshot` fields for spot, forward, expiry, discount factor, rate, dividend yield, bid, ask, mid, open interest, custom IV, custom gamma, custom vanna, broker IV/gamma comparisons, status, and coverage.
- Existing frontend dashboard primitives in `DashboardView`, `DashboardChart`, `dashboardMetrics`, `chartGeometry`, and shared theme/navigation CSS.
- Existing backend analytics in `analytics/black_scholes.py`, live snapshot assembly, replay repositories, heatmap service patterns, and route tests.

The new work should reuse the current snapshot and replay sources, route proxy patterns, top navigation styling, chart/table conventions, status tones, and test style.

## Selected Approach

Use a dedicated experimental API and modular tab.

Data flow:

```text
latest/replay AnalyticsSnapshot
  -> backend experimental analytics service
  -> typed ExperimentalAnalytics payload
  -> /experimental dense workbench grid
```

Backend responsibilities:

- Estimate parity-implied forward from paired call/put mids.
- Compute ATM straddle expected move and expected range.
- Build raw and fitted IV method curves.
- Use `numpy` and `scipy` for robust fitting and distribution work.
- Produce risk-neutral probability, terminal distribution, move-needed, decay, residual, and quote-quality panel outputs.
- Return partial results when a panel fails instead of failing the whole response.

Frontend responsibilities:

- Render `/experimental` as a dense research cockpit.
- Provide latest/replay frame selection.
- Provide compact quote-filter and method-visibility controls.
- Show panel statuses and diagnostics clearly.
- Keep many outputs visible at once so the user can decide which experiments are useful.

Alternatives considered:

- Generic research payload: faster to iterate but weakens type safety and makes panel contracts easier to break.
- Frontend-orchestrated hybrid: smaller backend pieces but spreads formulas across TypeScript and Python, making repeatable research harder.
- Split research console: useful for many controls, but it hides some simultaneous comparison value. The selected UI direction is a dense workbench grid with a compact control strip.

## UI Direction

The page should prioritize simultaneous visibility over guided flow.

Layout:

- Top navigation includes `Experimental`.
- Page header matches the existing dashboard shell.
- Compact control strip:
  - mode: latest or replay
  - replay session/frame selector when replay mode is active
  - quote-filter preset
  - IV method toggles
  - refresh/load controls
- KPI strip:
  - parity forward
  - forward minus spot
  - ATM straddle
  - expected range
  - expected move percent
  - quote-quality score
- Main workbench grid:
  - IV smile method comparison
  - terminal distribution preview
  - close-above/close-below probability table
  - skew and tail asymmetry
  - move-needed map
  - time-decay pressure
  - rich/cheap residuals
  - quote-quality and no-arbitrage flags
  - range compression/expansion preview when replay/history is available

The layout should be compact and operational, not a marketing or explanatory page. Cards are acceptable for individual repeated panels, but the page should avoid nested cards and should keep text small enough for dense scanning.

## Panel Scope

### Forward And Expected Move Summary

Inputs:

- paired call/put mids by strike
- risk-free rate
- time to expiry
- spot hint when available

Outputs:

- parity forward
- forward minus spot
- ATM strike by forward
- ATM straddle
- expected range
- expected move percent
- diagnostics for missing pairs, crossed quotes, wide quotes, and skipped strikes

Formula:

```text
F_i = K + exp(rT) * (call_mid - put_mid)
forward = robust median of near-ATM F_i values
ATM straddle = ATM call mid + ATM put mid
expected range = forward +/- ATM straddle
```

### IV Smile Method Comparison

Visible methods:

- existing custom IV from `AnalyticsSnapshot`
- OTM midpoint Black-76 IV
- broker IV diagnostic overlay
- last-price diagnostic overlay when the input payload contains last prices; against current `AnalyticsSnapshot` inputs, this method returns `insufficient_data`
- ATM straddle IV
- fitted total-variance spline
- fitted total-variance quadratic
- fitted total-variance wing-weighted fit

Primary raw method:

```text
If K < F, use put midpoint.
If K > F, use call midpoint.
Near ATM, blend both sides or use the straddle-derived anchor.
```

Fitted curves should use log-moneyness and total variance:

```text
x = ln(K / F)
w = IV^2 * T
```

The UI should show raw points and fitted curves together, with method toggles. It should not present the lowest raw point as the final IV valley.

### Smile Diagnostics

Outputs:

- IV valley by fit
- ATM-forward IV
- put-wing IV
- call-wing IV
- skew slope
- curvature
- left/right wing richness
- method disagreement summary
- fit-quality status

Diagnostics must state which fitted method produced the headline value.

### Risk-Neutral Probabilities

Outputs:

- close-above probability by strike
- close-below probability by strike
- range probability approximation
- probability shelves where probabilities drop sharply

Approximation:

```text
P(S_T > K) ~= -dC/dK
P(S_T < K) ~= dP/dK
```

For adjacent strikes, use spread slopes and smoothed/fitted prices. Label these as risk-neutral probabilities, not real-world probabilities.

### Terminal Distribution Preview

Outputs:

- density buckets by strike zone
- highest-density close zone
- 68 percent implied range
- 95 percent implied range
- left-tail probability
- right-tail probability

This panel must use smoothed or fitted prices before estimating curvature:

```text
risk-neutral density ~= second derivative of call price with respect to strike
```

If smoothing/fitting is unavailable, the panel status should be `insufficient_data`.

### Skew And Tail Asymmetry

Outputs:

- downside versus upside tail richness
- OTM put premium slope versus OTM call premium slope
- 25-delta and 10-delta approximations when enough data exists
- labels such as left-tail rich, right-tail cheap, skew steepening, skew flattening, crash premium elevated, or squeeze premium elevated

Labels must be backed by named formulas and thresholds in code.

### Move-Needed Map

Outputs by strike and side:

- call breakeven
- put breakeven
- distance to breakeven
- move-needed / expected-move ratio
- ratio labels:
  - below `0.5`: breakeven close
  - `0.5` to `1.0`: within expected move
  - `1.0` to `1.5`: needs above-normal move
  - above `1.5`: lottery-like

Formulas:

```text
call breakeven = K + call_mid
put breakeven = K - put_mid
call move needed = call breakeven - spot
put move needed = spot - put breakeven
ratio = move_needed / expected_move
```

### Time-Decay Pressure

Outputs:

- static premium per minute to expiry
- highest pressure strikes
- 15/30/60 minute preview when a fitted IV method is available; otherwise this sub-output returns `insufficient_data`

Static formula:

```text
static decay pressure = remaining premium / minutes to expiry
```

This is a crude diagnostic and must be labeled as such.

### Rich/Cheap Residuals

Outputs:

- actual mid
- fitted fair value
- residual in points
- rich/cheap/inline label
- local dislocation diagnostics

The first version can compute residuals against the selected fitted IV curve. It should not present residuals as guaranteed edge.

### Quote Quality And No-Arbitrage Flags

Flags:

- missing bid/ask
- crossed market
- bid above ask
- zero or negative bid when the method requires bid support
- spread too wide relative to mid
- below intrinsic
- impossible IV
- solver failed
- monotonicity violation
- convexity violation
- unusable for IV
- unusable for probability
- unusable for distribution

No-arbitrage checks are data-quality warnings, not trading signals.

### Range Compression/Expansion Preview

When replay/history is available, track over selected frames:

- ATM straddle
- expected move
- expected range
- tail price
- skew slope
- probability of selected key levels

If only the latest snapshot is loaded, this panel can show `insufficient_data` with a prompt to select replay frames.

## API And Contract

Add backend routes:

```http
GET /api/spx/0dte/experimental/latest
GET /api/spx/0dte/experimental/replay/snapshot?session_id=...&at=...&source_snapshot_id=...
```

Add matching Next.js proxy routes:

```text
apps/web/app/api/spx/0dte/experimental/latest/route.ts
apps/web/app/api/spx/0dte/experimental/replay/snapshot/route.ts
```

The backend response should be typed and grouped:

```text
meta
sourceSnapshot
forwardSummary
ivSmiles
smileDiagnostics
probabilities
terminalDistribution
skewTail
moveNeeded
decayPressure
richCheap
quoteQuality
historyPreview
```

Each group should include:

```text
status: "ok" | "preview" | "insufficient_data" | "error"
label: short display label
diagnostics: short machine-readable and display-readable notes
```

Contract rules:

- Existing `AnalyticsSnapshot`, heatmap, replay, scenario, and saved-view contracts remain untouched.
- Experimental payload gets schema/type tests even though it is allowed to evolve.
- Partial results are valid responses.
- Formula metadata should include method name, input counts, skipped row counts, and fallback reason when relevant.
- Errors inside one panel should not hide other panels.

## Backend Boundaries

Create focused experimental modules under `apps/api/gammascope_api/experimental/`:

- `forward.py`: paired quotes, parity forward, ATM straddle, expected range.
- `iv_methods.py`: Black-76 pricing, OTM midpoint IV, broker/last diagnostics, fitted smiles.
- `distribution.py`: close probabilities and terminal-density preview.
- `trade_maps.py`: move-needed, decay pressure, rich/cheap residuals.
- `quality.py`: quote filters and no-arbitrage checks.
- `service.py`: orchestration, panel statuses, partial-result handling.
- `routes.py` or route integration under the existing routes package.

The service should accept a normalized snapshot dictionary, produce an experimental payload, and be directly testable without HTTP.

`numpy` and `scipy` are acceptable backend dependencies for this feature.

## Frontend Boundaries

Create focused frontend units:

- `apps/web/app/experimental/page.tsx`: server page loading initial experimental payload.
- `apps/web/components/ExperimentalDashboard.tsx`: route shell, latest/replay mode state, control strip, panel grid.
- `apps/web/components/experimental/*`: modular panel components.
- `apps/web/lib/clientExperimentalSource.ts`: client fetchers and payload validation.
- `apps/web/lib/experimentalFormat.ts`: formatting, status display, ratio labels, diagnostics text.
- Optional `apps/web/lib/experimentalChartGeometry.ts` if current chart helpers are too narrow.

Reuse:

- top nav style from `DashboardView`
- theme toggle and source/status conventions where practical
- chart geometry where practical
- replay session/timestamp client helpers where practical
- existing formatter conventions for prices, percentages, and statuses

## Replay Behavior

The experimental page should support:

- latest snapshot mode by default
- replay session selection
- replay timestamp/frame selection
- loading experimental analytics for a selected replay frame

It should not duplicate the full replay workstation. It only needs enough replay support to compare experimental formulas across historical frames.

## Error Handling And Data Hygiene

The experimental API should be tolerant of noisy 0DTE quotes while being explicit about discarded data.

Rules:

- A bad formula or failed fit marks that panel as `error` or `insufficient_data`; it does not break the whole tab.
- Quote filters track skipped rows by reason.
- IV methods report convergence failures and bounds failures separately.
- Distribution panels require smoothed or fitted prices.
- Probability and distribution panels are labeled risk-neutral.
- Broker IV and last-price IV are diagnostic overlays.
- No-arbitrage flags are data-quality warnings.

## Testing

Backend tests:

- parity forward from paired quotes
- robust forward median behavior around ATM
- ATM straddle expected move
- Black-76 pricing and IV solving
- quote filtering and skipped-reason counts
- fitted smile success and failure states
- probability approximations
- terminal-density preview states
- move-needed ratios and labels
- time-decay pressure
- rich/cheap residuals
- no-arbitrage flags
- partial payload generation when one panel fails
- latest and replay experimental routes

Contract tests:

- experimental response schema validation
- generated or typed payload compatibility if a shared schema is added

Frontend tests:

- experimental fetchers
- formatter/status helpers
- `/experimental` route rendering
- top nav active state
- dense grid panel presence
- latest mode
- lightweight replay frame selection
- panel partial failure states
- method toggles and quote-filter controls

Regression checks:

- existing API tests
- existing web tests
- web typecheck
- browser verification at desktop width showing many panels without overlap

## Acceptance Criteria

- `/experimental` appears in top navigation.
- The page renders a dense, multi-panel experimental analytics workbench.
- Latest snapshot mode loads and displays partial or complete experimental payloads.
- Replay frame mode can load experimental analytics for a selected frame.
- IV smile methods and fitted curves are visible at the same time.
- Forward, expected move, probabilities, distribution preview, move-needed, decay, rich/cheap, and quote-quality panels are visible at once on desktop.
- Every panel shows a clear status and diagnostics when data is missing or a method fails.
- Existing Realtime, Replay, and Heatmap behavior remains unchanged.
- Tests cover core formulas, panel status behavior, routes, proxies, and frontend rendering.

## Decisions Made

- Use a dedicated experimental backend API.
- Use a modular `/experimental` tab.
- Use a dense workbench grid with compact controls.
- Include broad price-only analytics in v1, with preview labels where needed.
- Support latest snapshot plus lightweight replay frame selection.
- Expose a research set of IV methods and fits.
- Allow `numpy` and `scipy` backend dependencies.
- Keep existing production dashboard contracts untouched.
