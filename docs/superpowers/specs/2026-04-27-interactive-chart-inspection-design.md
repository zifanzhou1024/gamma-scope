# Interactive Chart Inspection Design

## Summary

Add synchronized strike inspection across the IV, gamma, and vanna charts. Hovering or keyboard-focusing a strike on any chart should select that strike globally, draw a matching vertical crosshair on all three charts, and show readable tooltip data for the selected strike.

## Goals

- Provide per-strike inspection without changing backend APIs.
- Synchronize IV, gamma, and vanna charts through one `inspectedStrike` state in `DashboardView`.
- Show tooltip values useful for SPX 0DTE review: strike, distance from spot, call/put bid, ask, mid, IV, gamma, vanna, and open interest.
- Support mouse and keyboard inspection.
- Preserve existing chart visuals, IV low markers, spot/forward references, vanna zero line, replay playback, and option chain behavior.

## Architecture

- Add a focused chart-inspection data helper that derives a normalized inspection model from `AnalyticsSnapshot` rows, a selected strike, and spot.
- Keep shared inspection state in `DashboardView`.
- Extend `DashboardChart` with optional `inspectedStrike`, `inspection`, `onInspectStrike`, and `onClearInspection` props.
- Each chart renders transparent SVG strike hit zones, an active crosshair if the selected strike is in that chart domain, and a fixed tooltip panel for the active strike.
- Tooltip data is derived once per selected strike and passed to all charts so all panels display consistent values.

## Interaction Rules

- `pointer enter` / `mouse enter` on a strike hit zone sets the shared inspected strike.
- `focus` on a strike hit zone sets the shared inspected strike for keyboard users.
- Leaving a chart or blurring a hit zone clears inspection.
- If the selected strike is outside a chart domain, that chart does not draw a crosshair.
- Missing numeric values render as `—`.

## UI Direction

- Crosshair should be a thin, high-contrast vertical line distinct from spot/forward references.
- Hit zones are invisible and must not visually clutter charts.
- Tooltip is locked in a consistent chart panel position rather than following the cursor, so text remains readable.
- Tooltip uses compact two-column call/put rows for quick comparison.

## Testing

- Unit tests for inspection data derivation.
- Chart tests proving hit zones, crosshair, and tooltip render from active inspection.
- Dashboard interaction tests proving hovering/focusing one chart updates all chart crosshairs.
- Existing web tests and typecheck must remain green.
- Browser verification must confirm hover inspection on `/replay` updates crosshairs and tooltip content.
