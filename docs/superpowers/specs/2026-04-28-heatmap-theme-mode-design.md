# Heatmap Theme Mode Design

## Goal

Add first-class light-mode support to the 0DTE exposure heatmap and align the dark-mode heatmap palette with the selected visual direction. The heatmap should use the existing global GammaScope theme preference, so switching between dark and light carries across Realtime, Replay, and Heatmap.

## Selected Direction

Use the **Light Shell, Strong Heatmap** direction.

The heatmap cells keep one shared semantic palette in both themes:

- Positive exposure: teal/green through bright yellow at the strongest levels.
- Negative exposure: blue/purple through deep violet at the strongest levels.
- Neutral/very weak exposure: subdued slate/blue-gray.
- King node remains yellow.
- Spot row remains a clear blue reference marker.

Only the surrounding shell changes between dark and light: page background, panel background, borders, toolbar controls, ticker controls, table headers, strike column, hover state, and text colors.

## Existing Theme System

The app already has a global theme system:

- `ThemeToggle` reads and writes `gammascope:theme` in localStorage.
- `ThemeToggle` also writes the `gammascope_theme` cookie.
- `RootLayout` applies `html[data-theme="light"]` or `html[data-theme="dark"]` before hydration.
- Realtime and Replay already render the toggle in their top bars and share the same stored state.

Heatmap should reuse this system. It should not introduce a separate heatmap-specific preference, query parameter, or local state.

## UI Changes

Add the same `ThemeToggle` control to the Heatmap top bar, positioned consistently with Realtime/Replay. The Heatmap header should still show:

- Brand lockup.
- Realtime / Replay / Heatmap navigation.
- Selected ticker list.
- Live/stale status.
- Last synced time.

The theme switch should be in the header utility area near the existing status chips, using the same component and behavior as the other pages.

## Styling Changes

Introduce heatmap-specific theme tokens in CSS so the shell can be tuned without changing the shared dashboard palette globally. Suggested tokens:

- `--heatmap-shell-bg`
- `--heatmap-panel-bg`
- `--heatmap-panel-header-bg`
- `--heatmap-control-bg`
- `--heatmap-strike-bg`
- `--heatmap-table-head-bg`
- `--heatmap-row-hover-bg`
- `--heatmap-cell-neutral-bg`
- `--heatmap-positive-1` through `--heatmap-positive-4`
- `--heatmap-negative-1` through `--heatmap-negative-4`

Define these tokens for the default dark theme and override only shell-related tokens under `html[data-theme="light"]`. The positive/negative cell palette should remain semantically equivalent across both themes, with enough contrast for white/light chrome and dark chrome.

The existing `exposureToneClass` class contract should remain unchanged. The implementation should remap the current classes:

- `.heatmapCell-positive`
- `.heatmapCell-negative`
- `.heatmapCell-neutral`
- `.heatmapCell-intensity-0` through `.heatmapCell-intensity-4`

Do not add visible call/put columns. Call/put values remain available only through the existing tooltip.

## Data Flow

No API or collector changes are required.

Theme flow:

1. User toggles `ThemeToggle` on Realtime, Replay, or Heatmap.
2. The toggle updates localStorage, cookie, and `document.documentElement.dataset.theme`.
3. All pages read the same preference on load.
4. Heatmap CSS responds through `html[data-theme="light"]` selectors and shared theme variables.

## Testing

Use TDD for implementation. Add failing tests before production code.

Required tests:

- Heatmap header renders the global `ThemeToggle`.
- Toggling the theme from Heatmap applies `data-theme="light"` and persists the same localStorage key used by Realtime/Replay.
- A saved light preference loads on Heatmap through the existing toggle behavior.
- Heatmap styles include light-theme selectors for heatmap shell/chrome.
- Heatmap cell color classes still use the same class contract for positive, negative, neutral, and intensity levels.
- Existing Heatmap tests for default 3 panels, ticker selection, reorder, Spot, King, and tooltip-only call/put details continue to pass.

## Verification

End-to-end verification should cover:

- Load `/heatmap` in dark mode and confirm the heatmap uses the updated shared cell palette.
- Toggle to light mode on `/heatmap` and confirm the shell changes while the cell semantic palette stays aligned.
- Navigate from `/heatmap` to `/`, then `/replay`, and confirm the light/dark state carries over.
- Toggle back on Realtime or Replay and confirm `/heatmap` reflects the new state after navigation.
- Confirm no browser console errors and no failed heatmap API requests.

## Out Of Scope

- No new theme choices beyond dark/light.
- No per-page theme preference.
- No backend changes.
- No historical replay integration changes.
- No redesign of panel count, ticker selection, ordering, Spot, or King behavior.
