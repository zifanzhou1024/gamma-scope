# SPX 0DTE Trading Dashboard Roadmap Design

Date: 2026-04-27
Status: Approved roadmap design
Repository: gamma-scope

## Summary

GammaScope should evolve from a visually polished replay and realtime dashboard into a more actionable SPX 0DTE trading workstation. The dashboard already has the core product split, replay transport, metrics, IV/gamma/vanna charts, option chain, admin import path, IV low markers, and call/put color semantics. The next work should add spot-relative chart context, extracted trading levels, coordinated chart interaction, data-quality visibility, regime summaries, and change-over-time tracking.

The work should be delivered in phases. Each phase must preserve the existing `/` realtime dashboard and `/replay` replay workstation behavior while adding narrowly scoped trading utility.

## Goals

- Make IV, gamma, and vanna charts immediately interpretable relative to SPX spot and forward.
- Replace ambiguous chart headline values with spot-relative or ATM values.
- Extract key strikes into a compact market map panel.
- Improve chart readability and align all charts by strike.
- Add hover inspection and synchronized crosshair behavior.
- Surface data freshness, coverage, quote counts, and replay/live status clearly.
- Add trading-specific walls, regimes, and expected move context.
- Track changes in key levels over replay frames or realtime snapshots.
- Keep calculations explicit, testable, and isolated from presentation components.

## Non-Goals

- Do not replace the existing replay workstation split.
- Do not change backend API schemas for the first market-reference phase unless a later phase explicitly requires it.
- Do not add brokerage execution, order routing, alerts, or account-risk workflows.
- Do not make regime labels opaque or untested; derived labels must be backed by named formulas.
- Do not make the UI depend on the real local parquet baseline files.

## Current Project Context

Current branch state includes:

- `/` as the realtime dashboard.
- `/replay` as the replay workstation.
- Top navigation tabs for realtime, replay, and a disabled future heatmap tab.
- Compact admin utility in the top-right utility area.
- Archive transport and replay playback controls.
- IV by strike, gamma by strike, and vanna by strike charts.
- Option chain with ATM row and gamma/OI visual bars.
- IV low markers and fixed IV low summary badge.
- Call semantics mapped to green and put semantics mapped to red in the chart and option chain.

The relevant frontend modules are:

- `apps/web/components/DashboardView.tsx`
- `apps/web/components/DashboardChart.tsx`
- `apps/web/lib/dashboardMetrics.ts`
- `apps/web/lib/chartGeometry.ts`
- `apps/web/app/styles.css`

Existing tests cover dashboard rendering, chart rendering, replay pages, replay playback, admin session behavior, archive transport, and metric helpers. New phases should extend these surfaces rather than creating parallel dashboard systems.

## Selected Approach

Use an incremental trading-core-first roadmap.

Alternative approaches considered:

- Interaction first: improves usability through tooltips and crosshairs, but leaves important trading levels uncomputed.
- Full terminal redesign: could produce a stronger final screen, but has higher regression risk and makes testing harder.
- Trading core first: adds the most actionable information quickly while keeping implementation risk controlled.

The selected sequence is trading core first, then readability and interaction, then data-quality and higher-order trading interpretation.

## Phase 0: Stabilize Current Work

Goal: preserve the current replay workstation and visual polish before adding new trading behavior.

Scope:

- Preserve `/` realtime and `/replay` replay split.
- Preserve admin/login placement and top tab navigation.
- Preserve IV low badges.
- Preserve Call = green and Put = red semantics across IV chart and option-chain styling.
- Run existing web tests and typecheck.
- Commit current completed visual polish before starting the next behavior phase.

Acceptance criteria:

- `/replay` renders correctly.
- Replay playback still updates dashboard content.
- IV chart and option chain keep correct call/put colors.
- Existing web tests and typecheck pass.

## Phase 1: Market Reference And Market Map

Goal: make every chart spot-relative and add the first actionable trading summary.

Scope:

- Add vertical reference lines to IV, gamma, and vanna charts:
  - `SPX spot`
  - `Forward`
- Use clear visual hierarchy:
  - Spot: stronger solid line.
  - Forward: secondary dashed line.
- Replace vague chart stat label `Current` with ATM/spot-relative values:
  - `ATM IV`
  - `ATM Gamma`
  - `ATM Vanna`
- Add a visible vanna zero line when zero is inside the y-domain.
- Add a `MARKET MAP` panel with:
  - Spot
  - Forward
  - ATM strike
  - Call IV low
  - Put IV low
  - Gamma peak
  - Vanna flip
  - Vanna max
- Add net exposure metrics:
  - Net gamma
  - Abs gamma
  - Net vanna
  - Abs vanna

Calculation choices:

- ATM strike is the listed strike nearest to current `snapshot.spot`.
- ATM IV is the average of available call and put IV at the ATM strike when both exist; otherwise use the available side.
- ATM gamma and ATM vanna are the sum of available side values at the ATM strike.
- Call IV low and put IV low are side-specific minimum `custom_iv` values.
- Gamma peak is the strike with the largest absolute `custom_gamma` aggregate by strike.
- Vanna flip is the interpolated strike where aggregate vanna crosses zero. If no sign crossing exists, show the strike with the smallest absolute aggregate vanna and mark it as nearest zero.
- Vanna max is the strike with the largest positive aggregate vanna. If all values are negative, show the least negative maximum.
- Net gamma and net vanna are simple sums of available row values. Absolute gamma and absolute vanna remain sums of absolute row values.

Implementation units:

- `dashboardMetrics.ts`: market map extraction, ATM values, net/absolute summaries.
- `DashboardChart.tsx`: spot/forward reference lines, ATM header value, vanna zero line.
- `DashboardView.tsx`: market map panel and expanded KPI presentation.
- Tests for extracted levels, chart annotations, vanna zero line, and new metric labels.

Acceptance criteria:

- User can visually locate spot and forward on all three charts.
- User can identify IV lows, gamma peak, vanna flip, and vanna max without manually reading curves.
- Chart headline values are no longer ambiguous.

## Phase 2: Chart Readability And Shared Strike Domain

Goal: make the three charts read as one coordinated market surface.

Scope:

- Increase axis tick, legend, stat, and annotation readability.
- Force IV, gamma, and vanna charts to share the same x-axis strike domain.
- Make chart axis labels and gridlines consistent across all three charts.
- Prevent labels from colliding at fullscreen and laptop widths.
- Preserve the existing dark market-ops style.

Implementation units:

- Extend chart geometry to accept a shared x-domain.
- Add responsive spacing for chart labels and stats.
- Add tests proving charts use the same strike domain.
- Add browser checks for laptop-width and fullscreen layouts.

Acceptance criteria:

- IV, gamma, and vanna align by strike.
- Chart text remains readable at common laptop and fullscreen sizes.
- No chart labels overlap important data or controls.

## Phase 3: Hover Tooltip And Synchronized Crosshair

Goal: make strike-by-strike inspection fast.

Scope:

- Add hover tooltip with available data:
  - Strike
  - Call IV
  - Put IV
  - Gamma
  - Vanna
  - Delta if available
  - Volume and open interest if available
  - Bid/ask spread
- Add synchronized vertical crosshair across IV, gamma, and vanna.
- Hovering one chart highlights the same strike on all charts.
- Option chain may highlight the hovered strike row when practical.

Implementation units:

- Add shared hover state in `DashboardView`.
- Add `hoveredStrike` and `onHoverStrike` props to chart components.
- Add tooltip data aggregation helper.
- Add component tests for tooltip content and synchronized hover state.

Acceptance criteria:

- Hovering a strike in any chart marks the same strike in all charts.
- Tooltip content is accurate for call/put data available at that strike.

## Phase 4: Data Quality And Realtime Trust Panel

Goal: make stale, partial, replayed, or degraded data obvious.

Scope:

- Add a compact data-quality strip or panel showing:
  - Last updated in New York market time.
  - Expiry and 0DTE status.
  - Quote count.
  - Strike count.
  - Freshness.
  - Source status.
  - Coverage status.
  - Update interval when available.
- Add filter summary when available:
  - Spread threshold.
  - Volume or open-interest requirements.
  - Valid and invalid quote counts.
- Distinguish realtime, replay, paused replay, and loaded replay states clearly.

Implementation units:

- Reuse existing `AnalyticsSnapshot` status fields where possible.
- Add a compact `DataQualityPanel`.
- Add tests for live and replay status rendering.

Acceptance criteria:

- User can tell whether the dashboard is live, stale, replaying, partial, or degraded without inspecting logs or backend state.

## Phase 5: Trading Levels, Walls, And Regimes

Goal: convert raw curves into tradeable summaries.

Scope:

- Add expected move bands:
  - `0.5σ`
  - `1σ`
- Add wall levels:
  - Largest positive gamma strike.
  - Largest negative gamma strike when present.
  - Largest vanna strike.
  - Optional charm or decay pressure only when required data exists.
- Add regime labels:
  - Gamma regime: pinning, trending, or unstable.
  - Vanna regime: supportive, suppressive, or mixed.
  - IV smile bias: left-skew, right-skew, or balanced.

Implementation units:

- Add a dedicated market-regime metrics module.
- Keep all formulas named and covered by unit tests.
- Render regime cards near the market map.

Acceptance criteria:

- The dashboard summarizes likely pressure zones and broad regime without requiring the user to interpret every curve manually.

## Phase 6: Change Over Time

Goal: show whether important levels are moving.

Scope:

- Track level changes over replay frames or realtime snapshots:
  - IV low movement.
  - Gamma peak movement.
  - Vanna flip movement.
  - Spot movement.
- Add compact movement indicators:
  - previous value to current value.
  - delta.
  - direction.
- In replay, reset history on session or date change.
- In realtime, use a bounded recent snapshot buffer.

Implementation units:

- Add client-side level history buffer.
- Add replay-aware history reset.
- Add movement calculation tests.
- Add browser verification during replay playback at high speeds.

Acceptance criteria:

- User can see not only where levels are, but whether they are migrating.

## Phase 7: Performance, QA, And Product Hardening

Goal: keep the dashboard stable as chart and level calculations grow.

Scope:

- Memoize expensive market-map and chart calculations.
- Keep replay frame changes responsive.
- Browser-check `/` and `/replay`.
- Verify 60x replay still updates charts, KPIs, market map, and option chain.
- Add regression tests around stale replay loads and session switches.

Acceptance criteria:

- No noticeable replay lag from added chart and level calculations.
- Existing realtime and replay behavior remains intact.
- Full web unit tests and typecheck pass.

## Testing Strategy

Each implementation phase should start with focused failing tests.

Baseline verification:

- Web unit tests.
- Web typecheck.
- Browser check for `/`.
- Browser check for `/replay`.

Phase-specific tests:

- Market map extraction unit tests.
- Chart reference-line rendering tests.
- Vanna zero-line rendering tests.
- Shared x-domain tests.
- Tooltip and synchronized hover tests.
- Data-quality panel tests.
- Regime formula tests.
- Level-history movement tests.

Browser verification should include replay playback at `60x` after phases that affect chart rendering, market maps, hover state, or replay frame updates.

## Implementation Order

1. Phase 0: stabilize and commit current polish.
2. Phase 1: market reference and market map.
3. Phase 2: chart readability and shared strike domain.
4. Phase 3: hover tooltip and synchronized crosshair.
5. Phase 4: data quality and realtime trust panel.
6. Phase 5: trading levels, walls, and regimes.
7. Phase 6: change over time.
8. Phase 7: performance, QA, and product hardening.

## Risks And Mitigations

- Risk: chart annotations clutter small screens.
  - Mitigation: keep labels in fixed badges or compact callouts and use line styling for chart-space markers.
- Risk: regime labels imply more certainty than the formulas support.
  - Mitigation: keep formulas explicit, tested, and documented before exposing labels.
- Risk: synchronized hover adds render churn during replay playback.
  - Mitigation: isolate hover state, memoize derived chart data, and verify high-speed replay.
- Risk: change-over-time calculations become confusing after replay session changes.
  - Mitigation: reset history on replay session/date changes and label the comparison window clearly.

## Open Decisions For Later Phases

- Whether expected move bands should use ATM IV, average IV, or a backend-provided model input.
- Whether gamma peak should use net gamma by strike or absolute gamma by strike in wall/regime panels.
- Whether option-chain hover highlighting should ship with Phase 3 or remain a follow-up.
- Whether regime labels should appear on both realtime and replay by default or be hidden behind an advanced panel.
