# Experimental 2 Estimated Flow Cockpit Design

Date: 2026-05-03
Status: User-approved design
Repository: gamma-scope

## Summary

GammaScope will add a separate `/experimental-2` page for estimated SPX 0DTE buy/sell flow, dealer pressure, and replay validation. This page must not change the main realtime dashboard, the current `/experimental` price-only research cockpit, or the `/heatmap` surface. The first version is SPX-only, with explicit room to add SPY, QQQ, IWM, NDX, and other symbols later.

The page will use a dense Flow Cockpit layout: a KPI strip, a spot-centered strike ladder as the main object, a right rail with inference diagnostics, and a bottom contract-level audit table. All outputs must be labeled as estimates because free broker snapshots cannot reveal true customer, market-maker, buy-to-open, or sell-to-close classifications.

## Goals

- Add `/experimental-2` as a new isolated page for estimated 0DTE flow.
- Add a dedicated backend experimental-flow API and generated contract.
- Use current and previous snapshots to estimate volume delta, aggressor side, premium flow, Greek-weighted flow, dealer pressure, and open/close proxy scores.
- Support live estimate mode and bounded replay validation mode in v1.
- Keep the first version SPX-only while shaping the contract for later multi-symbol support.
- Make every estimate auditable through contract-level rows and diagnostics.
- Preserve existing main dashboard, current experimental tab, heatmap, replay, scenario, and saved-view behavior.

## Non-Goals

- Do not claim official customer or market-maker flow without licensed open/close data.
- Do not infer exact buy-to-open, sell-to-open, buy-to-close, or sell-to-close from free quote snapshots.
- Do not add paid Cboe DataShop integration in this slice.
- Do not add brokerage execution, order routing, or trading alerts.
- Do not replace the existing `/experimental` page or merge these flow panels into it.
- Do not expand to SPY, QQQ, IWM, NDX, or other symbols in v1.
- Do not build a full backtest lab in v1.

## Current Project Context

The repo already has:

- A Next.js web app under `apps/web`.
- A FastAPI backend under `apps/api`.
- Shared JSON Schema contracts under `packages/contracts`.
- A main realtime dashboard at `/`.
- A replay workstation at `/replay`.
- A heatmap page at `/heatmap`.
- A price-only experimental page at `/experimental`.
- Collector events that already carry option `last`, `bid_size`, `ask_size`, `volume`, `open_interest`, `ibkr_delta`, `ibkr_gamma`, `ibkr_vega`, and `ibkr_theta`.
- Existing `AnalyticsSnapshot` rows that currently expose bid, ask, mid, open interest, custom IV, custom gamma, custom vanna, and broker comparison fields.
- Backend experimental analytics patterns that safely build partial panel payloads and validate through generated contracts.

The new work should follow the current experimental API and frontend patterns while keeping the flow estimator as a separate module.

## Selected Approach

Use a dedicated backend experimental-flow API.

Data flow:

```text
Live/replay AnalyticsSnapshot
  -> experimental_flow service
  -> previous-snapshot comparator
  -> flow estimator
  -> confidence + diagnostics
  -> typed ExperimentalFlow payload
  -> /experimental-2 cockpit
```

Alternatives considered:

- Frontend-only estimator: fastest, but weak for replay validation and loses state on refresh.
- Extending the existing experimental payload: less API surface, but mixes price-only research with flow inference and makes `/experimental` heavier.
- Dedicated backend API: best isolation, better tests, and cleaner replay validation.

The selected approach is the dedicated backend API.

## Backend Architecture

Add a new package:

```text
apps/api/gammascope_api/experimental_flow/
  __init__.py
  estimator.py
  service.py
```

Add a new route module:

```text
apps/api/gammascope_api/routes/experimental_flow.py
```

Routes:

```http
GET /api/spx/0dte/experimental-flow/latest
GET /api/spx/0dte/experimental-flow/replay
```

`latest` mode should compare the current live snapshot with the previous live snapshot available to the service. If no previous snapshot exists, return an `insufficient_data` style payload with diagnostics rather than failing.

`replay` mode should run the same estimator over persisted replay snapshots. V1 should support enough replay validation to compare estimated pressure against the next selected SPX horizon, but it should not become a general-purpose research/backtest framework.

## Contract Shape

Add a new JSON Schema:

```text
packages/contracts/schemas/experimental-flow.schema.json
```

Generate matching TypeScript and Python contracts.

Payload outline:

```ts
ExperimentalFlow {
  schema_version: "1.0.0"
  meta: {
    mode: "latest" | "replay"
    symbol: "SPX"
    expiry: string
    generatedAt: string
    sourceSessionId: string
    currentSnapshotTime: string
    previousSnapshotTime: string | null
  }
  summary: {
    estimatedBuyContracts: number
    estimatedSellContracts: number
    netEstimatedContracts: number
    netPremiumFlow: number
    netDeltaFlow: number | null
    netGammaFlow: number | null
    estimatedDealerGammaPressure: number | null
    confidence: "high" | "medium" | "low" | "unknown"
  }
  strikeRows: StrikeFlowRow[]
  contractRows: ContractFlowRow[]
  replayValidation: ReplayValidation | null
  diagnostics: Diagnostic[]
}
```

Strike rows:

```ts
StrikeFlowRow {
  strike: number
  callBuyContracts: number
  callSellContracts: number
  putBuyContracts: number
  putSellContracts: number
  netPremiumFlow: number
  netDeltaFlow: number | null
  netGammaFlow: number | null
  estimatedDealerGammaPressure: number | null
  openingScore: number
  closingScore: number
  confidence: "high" | "medium" | "low" | "unknown"
  tags: string[]
}
```

Contract rows:

```ts
ContractFlowRow {
  contractId: string
  right: "call" | "put"
  strike: number
  volumeDelta: number
  aggressor: "buy" | "weak_buy" | "sell" | "weak_sell" | "unknown"
  signedContracts: number
  premiumFlow: number
  deltaFlow: number | null
  gammaFlow: number | null
  vannaFlow: number | null
  thetaFlow: number | null
  openingScore: number
  closingScore: number
  confidence: "high" | "medium" | "low" | "unknown"
  diagnostics: string[]
}
```

Replay validation:

```ts
ReplayValidation {
  horizonMinutes: 5 | 15 | 30
  rows: ReplayValidationRow[]
  hitRate: number | null
}
```

## Required Snapshot Inputs

The estimator needs these row fields:

- `last`
- `volume`
- `bid_size`
- `ask_size`
- `open_interest`
- `custom_iv`
- `custom_gamma`
- `custom_vanna`
- `ibkr_delta`
- `ibkr_vega`
- `ibkr_theta`

The current collector event path already captures most of these fields. The first implementation should expose the needed optional fields through the flow API without changing the main dashboard rendering behavior. If `AnalyticsSnapshot.rows` is extended, the new fields must be optional and all existing consumers must continue to work.

## Estimation Formulas

For each contract matched between current and previous snapshots:

```text
volumeDelta = max(0, current.volume - previous.volume)
priceChange = current.last_or_mid - previous.last_or_mid
spread = current.ask - current.bid
spreadRatio = spread / current.mid
```

Aggressor estimate:

```text
if current.last >= previous.ask: buy
elif current.last <= previous.bid: sell
elif current.last >= current.ask: buy
elif current.last <= current.bid: sell
elif priceChange > 0: weak_buy
elif priceChange < 0: weak_sell
else: unknown
```

Weights:

```text
buy = +1
weak_buy = +0.5
sell = -1
weak_sell = -0.5
unknown = 0
```

Signed flow:

```text
signedContracts = volumeDelta * aggressorWeight
premiumFlow = signedContracts * current.mid * 100
deltaFlow = signedContracts * delta * spot * 100
gammaFlow = signedContracts * gamma * spot^2 * 0.01 * 100
vannaFlow = signedContracts * vanna * spot * 100
thetaFlow = signedContracts * theta * 100
estimatedDealerGammaPressure = -gammaFlow
```

When a Greek is missing, the corresponding flow should be `null` and the row should include a diagnostic tag.

## Open/Close Proxy Scores

The estimator cannot identify true open or close activity from free snapshots. It should provide proxy scores only.

Opening score increases when:

- `volumeDelta / openInterest` is high.
- Ask-side buying lifts IV.
- Bid-side put selling lifts IV.
- Same-direction flow repeats at the same strike.
- Spread is tight enough to trust side classification.

Closing score increases when:

- Volume hits bid while IV falls.
- Price decays while volume increases.
- Same-strike flow reverses from the prior interval.
- Quote quality is weak enough that open/close should remain unknown rather than directional.

Scores should be normalized from `0` to `1`. When inputs are missing, use lower confidence rather than inventing certainty.

## Confidence And Diagnostics

Confidence should combine:

```text
confidence = quoteQuality * volumeSignal * aggressorClarity * greekCoverage
```

Map numeric confidence into:

- `high`
- `medium`
- `low`
- `unknown`

Each contract row should carry diagnostics such as:

- `missing_previous_snapshot`
- `missing_volume`
- `no_volume_delta`
- `missing_last`
- `wide_spread`
- `crossed_quote`
- `missing_delta`
- `missing_gamma`
- `missing_vanna`
- `missing_theta`
- `aggressor_unknown`
- `open_close_proxy_only`

The payload-level diagnostics should summarize any systemic issue, such as insufficient prior snapshot, partial chain coverage, or low Greek coverage.

## Frontend UI

Add:

```text
apps/web/app/experimental-2/page.tsx
apps/web/components/ExperimentalFlowDashboard.tsx
apps/web/components/experimental-flow/
```

Use the Flow Cockpit layout:

- Top navigation includes `Experimental 2`.
- KPI strip:
  - estimated buy contracts
  - estimated sell contracts
  - net contracts
  - net premium flow
  - dealer gamma pressure
  - confidence
- Main strike ladder:
  - centered around spot
  - rows by strike
  - call buy/sell
  - put buy/sell
  - net premium
  - dealer gamma pressure
  - confidence
  - color intensity by dealer gamma pressure
- Right rail:
  - aggressor mix
  - opening/closing proxy
  - quote/Greek coverage diagnostics
- Bottom audit table:
  - contract-level rows
  - volume delta
  - aggressor
  - signed contracts
  - premium flow
  - Greek flow
  - confidence
  - diagnostics

The page should be dense and operational, not explanatory or marketing-oriented. It should use concise labels and keep formulas in diagnostics/audit surfaces rather than long in-app prose.

## Replay Validation

Replay validation should stay bounded in v1.

Supported modes:

- Latest/live estimate: compare current snapshot to previous live snapshot.
- Replay validate: run the estimator across persisted replay snapshots and compare pressure direction to the next selected SPX horizon.

Initial horizons:

- 5 minutes
- 15 minutes
- 30 minutes

Validation rows should include:

- source snapshot time
- pressure direction
- pressure magnitude
- next spot
- realized move
- hit/miss/null classification

This is meant to answer whether the estimated flow pointed in the right direction recently. It is not a full strategy backtester.

## Data Integrity Rules

- Never label inferred data as official customer or market-maker data.
- Keep estimated fields named with `estimated` or `proxy` where needed.
- Include diagnostics whenever an estimate depends on weak assumptions.
- Return partial payloads instead of failing the entire API when one panel cannot be computed.
- Treat missing previous snapshots as `insufficient_data`.
- Keep existing dashboard contracts backward compatible.

## Testing

Backend tests:

- Estimator computes volume deltas from current and previous rows.
- Aggressor classification handles buy, sell, weak buy, weak sell, and unknown.
- Negative or reset cumulative volume is clamped to zero with diagnostics.
- Greek-weighted flow returns `null` and diagnostics when Greeks are missing.
- Strike aggregation sums calls and puts correctly.
- Dealer gamma pressure is the inverse of estimated gamma flow.
- Open/close proxy scores stay in `[0, 1]`.
- Low-quality quotes reduce confidence.
- Latest route returns a typed insufficient-data payload when previous snapshot is unavailable.
- Replay route computes bounded validation rows.

Frontend tests:

- `/experimental-2` renders with seed or fallback payload.
- KPI strip formats contracts, money, Greek flows, and confidence.
- Strike ladder sorts and centers rows around spot.
- Contract audit table shows diagnostics.
- Low-confidence and unknown rows render visibly.
- Navigation includes Experimental 2 without breaking existing tabs.

Contract tests:

- TypeScript and Python generated contracts accept the seed fixture.
- Invalid confidence labels and aggressor labels are rejected.
- Optional Greek flow fields accept `null`.

## Acceptance Criteria

- A user can open `/experimental-2` without affecting `/`, `/experimental`, `/replay`, or `/heatmap`.
- The page shows estimated buy/sell contracts, premium flow, Greek-weighted flow, dealer gamma pressure, and confidence.
- Every displayed estimate can be traced to contract-level audit rows.
- Missing or weak data is visible through diagnostics and confidence.
- Replay validation can compare estimated pressure direction against a selected future SPX horizon.
- The implementation remains SPX-only in v1 but does not block later multi-symbol expansion.
