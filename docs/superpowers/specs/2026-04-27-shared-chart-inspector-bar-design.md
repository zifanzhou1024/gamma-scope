# Shared Chart Inspector Bar Design

## Summary

Replace the current per-chart inspection tooltip with one shared inspector bar below the IV, gamma, and vanna chart row.

The current implementation synchronizes inspection correctly, but the UI is not acceptable because every chart repeats the same large tooltip table. That creates oversized boxes, duplicated words, clipped columns, and visual competition with the chart curves.

## Goals

- Keep synchronized crosshairs across IV, gamma, and vanna.
- Show full strike details once, not three times.
- Keep chart cards focused on chart reading.
- Prevent tooltip/table overflow at desktop and laptop widths.
- Preserve keyboard inspection, hover inspection, Escape clear, and existing chart annotations.

## Non-Goals

- No backend API changes.
- No data-model changes to `deriveStrikeInspection`.
- No redesign of archive transport, market map, option chain, or top navigation.
- No floating cursor-follow tooltip in this phase.

## Layout

### Chart Cards

Each chart card keeps:

- Title, strike count, legend, IV low badge when relevant, chart, axes, spot/forward/vanna-zero lines, synchronized crosshair, and summary stats.
- Invisible per-strike hit zones for hover/focus/keyboard inspection.

Each chart card removes:

- The full inspection tooltip table.

Each chart card adds:

- A compact local inspection chip when a strike is selected and the selected strike is inside that chart domain.
- The chip should show only chart-specific values, for example:
  - IV chart: `7,105 · Call IV 23.0% · Put IV —`
  - Gamma chart: `7,105 · Call Γ 0.00882 · Put Γ —`
  - Vanna chart: `7,105 · Call Vanna -0.00319 · Put Vanna —`

The chip must stay inside the chart card and must not cover the x/y axes.

### Shared Inspector Bar

`DashboardView` renders one shared inspector bar immediately below the three-chart grid and above chart summary continuation / option chain content.

The bar appears only when `inspection` is non-null.

The bar contains:

- Strike block:
  - `STRIKE`
  - selected strike
  - distance from spot
- Call/put quote table:
  - columns: Side, Bid, Ask, Mid, IV, Gamma, Vanna, OI
  - rows: Call and Put
- Optional clear button:
  - label: `Clear`
  - clears the shared inspection state

The bar should be visually compact enough to fit one row on wide desktop and wrap cleanly on smaller widths.

## Component Boundaries

- `DashboardView` remains the owner of `inspectedStrike` and `inspection`.
- `DashboardChart` remains responsible for hit zones and crosshair rendering.
- Move full tooltip rendering out of `DashboardChart`.
- Add a new focused component, likely `ChartInspectionBar`, responsible for the shared details table.
- Add a compact per-chart value helper or prop so each chart can render a chart-specific selected-strike chip.

## Accessibility

- Chart hit zones remain keyboard reachable.
- Enter/Space selects a strike.
- Escape clears inspection.
- The shared inspector bar uses native semantic table markup.
- The clear button is a real button.
- The local chart chip is display-only and should not add confusing duplicate table semantics.

## Responsive Rules

- Desktop: three charts stay in one row; inspector bar spans the full chart grid width.
- Medium screens: inspector table may horizontally compress but must not overflow outside the dashboard shell.
- Small screens: chart cards stack and inspector bar becomes a vertical block with a scroll-free table if possible; if the table cannot fit, it may use horizontal scrolling inside the inspector bar only.

## Testing

- Update `DashboardChart` tests:
  - chart no longer renders the full tooltip table.
  - chart still renders hit zones, crosshair, and compact local inspection chip.
  - keyboard and mouse inspection behavior remains covered.
- Add or update `DashboardView` tests:
  - one shared inspector bar renders when a strike is selected.
  - the bar contains strike, distance, Call/Put, Bid, Ask, Mid, IV, Gamma, Vanna, and OI.
  - all three charts still receive synchronized inspection props.
  - clearing from the shared bar removes crosshairs/chips/bar.
- Browser verification:
  - `/replay` shows no duplicated tooltip tables.
  - selecting a strike shows three crosshairs and one shared inspector bar.
  - no chart card overflows at current desktop width.
