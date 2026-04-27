# Moomoo Data Source Design

Date: 2026-04-27
Status: Approved design
Repository: gamma-scope

## Summary

GammaScope will add Moomoo OpenAPI/OpenD as the default data source direction while preserving the current SPX live dashboard contract. The first implementation will fetch a configurable 0DTE option universe from Moomoo for SPX, SPY, QQQ, IWM, RUT, and NDX, poll live option snapshots every 2 seconds, and translate only SPX rows into the existing IBKR/SPX-shaped collector ingestion path.

This is a compatibility phase. It deliberately avoids changing the current API analytics snapshot schema or making the dashboard multi-symbol. The collector will still be shaped so future symbols can be added by configuration, and future source-aware code should default to Moomoo.

## Goals

- Use Moomoo as the default source for new source-aware collector and web selection behavior.
- Fetch the full configured universe: SPX, SPY, QQQ, IWM, RUT, and NDX.
- Use `get_option_chain()` only for contract discovery, not live quote polling.
- Use `get_market_snapshot()` every 2 seconds for live option rows.
- Keep snapshot requests within Moomoo documented limits for the target universe.
- Publish only SPX into the existing dashboard path during this phase.
- Add a browser-local source selector that defaults to Moomoo and can later drive real source-aware API selection.
- Leave clear room for future ticker additions and a later generalized multi-symbol contract.

## Non-Goals

- Do not redesign the analytics snapshot contract in this phase.
- Do not make the dashboard display SPY, QQQ, IWM, RUT, or NDX yet.
- Do not start or stop collector processes from the web UI.
- Do not implement Moomoo callback/push mode yet.
- Do not replace or remove existing IBKR commands.
- Do not silently use ETF proxies for index spot values.

## Current Project Context

The current live ingestion path is SPX and IBKR shaped:

- `packages/contracts/schemas/collector-events.schema.json` requires `source: "ibkr"` and `symbol: "SPX"` for live collector events.
- `apps/api/gammascope_api/ingestion/live_snapshot.py` builds only SPX analytics snapshots.
- Current API paths are SPX-specific, such as `/api/spx/0dte/snapshot/latest` and `/api/spx/0dte/collector/events`.
- The frontend expects one SPX `AnalyticsSnapshot`.
- Existing collector commands include mock data, IBKR health, IBKR handshake, IBKR contract discovery, and IBKR delayed snapshot publishing.

Because of those constraints, this design keeps the existing SPX/IBKR-shaped event contract for dashboard publishing and introduces Moomoo through a compatibility adapter.

## Selected Approach

Use a Moomoo compatibility collector:

1. Fetch the full configured Moomoo universe.
2. Normalize all fetched rows into an internal Moomoo option-row model.
3. Report collection status and per-symbol counts for all enabled symbols.
4. Translate only SPX rows into the current collector event schema.
5. Preserve current API and dashboard compatibility.

Alternatives considered:

- Generalize collector contracts now: cleaner long term, but it touches generated schemas, API ingestion, frontend type guards, and live snapshot assembly before the Moomoo collector is proven.
- Fetch SPX only first: lower risk, but it would not exercise the intended Moomoo universe or quota/rate model.
- Full multi-symbol dashboard now: complete, but too large for this source-swap phase.

The selected approach fetches all desired symbols while limiting dashboard changes to source preference display.

## Moomoo Runtime Flow

1. Connect to local Moomoo OpenD using `host=127.0.0.1` and `port=11111`.
2. Query subscription status for observability.
3. Load the enabled universe config.
4. For each enabled symbol:
   - Resolve spot.
   - Require manual spot for configured index symbols.
   - Call `get_option_chain(owner_code, start=expiry, end=expiry)` for discovery.
   - Apply configured option-family filter.
   - If a family filter matches zero rows, warn and fall back to the unfiltered chain.
   - Select ATM-centered strikes using configured down/up counts.
   - Keep both call and put contracts for selected strikes.
5. Deduplicate selected option codes across all symbols.
6. Run a quota and rate preflight before live polling.
7. Poll `get_market_snapshot()` every 2 seconds in chunks of at most 400 option codes.
8. Normalize snapshot rows into internal option rows.
9. Convert SPX rows into existing collector events and optionally publish them to FastAPI.
10. Continue polling until the command exits or a configured loop limit is reached.

## Universe Configuration

The collector should drive collection from data/config, not hard-coded control flow. Each entry should support:

```text
symbol
owner_code
enabled
publish_to_spx_dashboard
strike_window_down
strike_window_up
family_filter
requires_manual_spot
manual_spot
priority
```

Default universe:

| Symbol | Owner Code | Window | Family Filter | Manual Spot | Publish To Current Dashboard |
| --- | --- | ---: | --- | --- | --- |
| SPX | `US..SPX` | 30 down, ATM, 30 up | `SPXW` | yes | yes |
| SPY | `US.SPY` | 15 down, ATM, 15 up | none | no | no |
| QQQ | `US.QQQ` | 15 down, ATM, 15 up | none | no | no |
| IWM | `US.IWM` | 10 down, ATM, 10 up | none | no | no |
| RUT | `US..RUT` | 20 down, ATM, 20 up | `RUTW` | yes | no |
| NDX | `US..NDX` | 50 down, ATM, 50 up | `NDXP` | yes | no |

Manual spot is required for SPX, RUT, and NDX in this phase because direct index spot snapshots are not reliable in the existing Moomoo test evidence. If a required manual spot is missing, the collector skips that symbol with a warning and keeps collecting other enabled symbols.

Future ticker additions should be possible by adding a config entry with an owner code, strike window, and spot behavior. A later generalized contract can publish additional symbols without changing the Moomoo discovery loop.

## Rate And Quota Guardrails

The target default universe selects about 572 option contracts:

| Symbol | Contracts |
| --- | ---: |
| SPX | 122 |
| SPY | 62 |
| QQQ | 62 |
| IWM | 42 |
| RUT | 82 |
| NDX | 202 |
| Total | 572 |

Moomoo `get_market_snapshot()` allows at most 400 codes per request and 60 requests per 30 seconds. With 572 option codes:

```text
ceil(572 / 400) = 2 snapshot requests per refresh
30 / 2 seconds = 15 refreshes per 30 seconds
2 * 15 = 30 snapshot requests per 30 seconds
```

That is within the 60 requests per 30 seconds snapshot limit.

`get_option_chain()` should be treated as a slow discovery endpoint. The collector must not call it every 2 seconds. The first implementation should call it at startup. Future rebalancing can refresh chains slowly, for example every 1 to 5 minutes or when spot leaves the selected strike window buffer.

If a future universe exceeds safe snapshot request rates or quota assumptions, the collector should either fail preflight or degrade by priority. Default degradation priority is:

1. Reduce NDX.
2. Reduce RUT.
3. Reduce IWM.
4. Reduce QQQ and SPY.
5. Keep SPX highest priority.

## Internal Moomoo Row Model

The collector should normalize Moomoo snapshot rows into an internal model before translating to collector events. Required normalized fields:

```text
underlying
owner_code
option_code
option_name
expiry
option_type
strike
snapshot_time
last_price
bid_price
ask_price
volume
open_interest
implied_volatility
delta
gamma
vega
theta
rho
contract_multiplier
```

Useful derived fields:

```text
mid_price
spread
moneyness
distance_from_spot_points
distance_from_spot_pct
is_call
is_put
is_atm_window_member
```

The internal model can carry all six symbols. The compatibility publisher filters it to SPX before producing current dashboard events.

## Compatibility Event Translation

Only SPX rows are translated into the current collector event schema:

- `CollectorHealth`
- `UnderlyingTick`
- `ContractDiscovered`
- `OptionTick`

The current schema still requires `source: "ibkr"` and IBKR-shaped field names. During this compatibility phase, translated Moomoo SPX events should remain schema-valid, while using clear values in fields that are not schema-constrained:

- `collector_id`: for example `local-moomoo`
- `ibkr_account_mode`: `unknown`
- `message`: clearly says Moomoo compatibility snapshot polling is active

Contract identifiers should keep the existing stable format:

```text
SPX-YYYY-MM-DD-C-STRIKE
SPX-YYYY-MM-DD-P-STRIKE
```

For `ContractDiscovered`, the current schema requires `ibkr_con_id`. The compatibility adapter should use a deterministic synthetic integer derived from the Moomoo option code when no real IBKR conId exists. This value is a compatibility identifier only and must not be treated as an IBKR contract id by Moomoo code.

For `OptionTick`, map Moomoo fields as follows:

| Current Field | Moomoo Source |
| --- | --- |
| `bid` | bid price |
| `ask` | ask price |
| `last` | latest or last price |
| `volume` | volume |
| `open_interest` | open interest |
| `ibkr_iv` | implied volatility |
| `ibkr_delta` | delta |
| `ibkr_gamma` | gamma |
| `ibkr_vega` | vega |
| `ibkr_theta` | theta |

These field names remain IBKR-prefixed only because the current schema is not generalized yet.

## Web Source Selector

Add a compact source selector to the dashboard UI with:

- Default selection: Moomoo.
- Options: Moomoo and IBKR.
- Storage: browser localStorage.
- Behavior: display/source preference only, not collector process control.

In this phase, the selector labels the preferred source and keeps room for future query-parameter behavior. A later source-aware API can use the same UI to call:

```text
/api/spx/0dte/snapshot/latest?source=moomoo
/api/spx/0dte/status?source=moomoo
```

New source-aware designs and code should default to Moomoo. IBKR remains available as a compatibility or fallback source, but it is not the default for future work.

## Error Handling

The collector should return or publish clear health and warning information for:

- Missing `moomoo-api` package.
- OpenD connection failure.
- Missing required manual spot.
- Empty option chains.
- Family filter returning zero rows.
- Snapshot request errors.
- Snapshot row count mismatches.
- Rate or quota preflight failures.
- No publishable SPX rows.

Failures for one non-SPX symbol should not prevent other enabled symbols from collecting. Failures that prevent SPX publishing should produce an error or degraded health result rather than silently falling back to stale data.

## Testing Strategy

Collector tests should use fake Moomoo quote contexts so CI does not require OpenD:

- Universe config defaults and future ticker override parsing.
- ATM strike selection with asymmetric down/up windows.
- Option-family filter fallback.
- Missing manual spot skip behavior.
- Chunking selected codes into batches of at most 400.
- Snapshot request math at a 2-second interval.
- Internal row normalization.
- SPX-only compatibility event translation.
- Synthetic conId stability from Moomoo option code.
- CLI publish and non-publish behavior.
- Clear error output for missing package and connection failures.

Web tests:

- Source selector defaults to Moomoo.
- Source selector persists in localStorage.
- Selector can switch to IBKR without breaking current snapshot loading.
- Dashboard source label reflects the selected browser preference.

Contract/API tests:

- Translated SPX Moomoo compatibility events validate against the current collector event schema.
- Publishing translated events still produces a live SPX snapshot through the existing API path.

Optional local smoke tests against real OpenD:

- Chain discovery for enabled symbols with supplied manual spots.
- Quota preflight result near 572 selected option codes for the default universe.
- A short 2-second snapshot loop returns rows and stays below request limits.

## Acceptance Criteria

- Moomoo collector connects to local OpenD and can fetch the configured universe when credentials and market permissions are available.
- Default refresh interval is 2 seconds.
- `get_option_chain()` is used only for discovery.
- `get_market_snapshot()` is used for live option data.
- Full default universe is selected by config, not hard-coded branches.
- Missing manual index spot skips only that symbol and reports a warning.
- SPX rows can be translated and published into the current live dashboard path.
- Existing IBKR commands continue to work.
- The dashboard source selector defaults to Moomoo and persists per browser.
- Future source-aware designs default to Moomoo.

## Implementation Boundaries

Expected implementation units:

- New Moomoo collector config and snapshot module under `services/collector/gammascope_collector`.
- Focused collector tests under `services/collector/tests`.
- A new package script for the Moomoo collector.
- Minimal README usage notes for Moomoo OpenD, manual spots, and snapshot polling.
- Minimal web source selector UI and tests.

Avoid broad schema rewrites in this phase. The next phase after this compatibility collector can generalize collector events to real source and symbol fields, then expose multi-symbol API state.

## References

- Moomoo OpenAPI `get_option_chain()` documentation: https://openapi.moomoo.com/moomoo-api-doc/en/quote/get-option-chain.html
- Moomoo OpenAPI `get_market_snapshot()` documentation: https://openapi.moomoo.com/moomoo-api-doc/en/quote/get-market-snapshot.html
- Moomoo OpenAPI subscription documentation: https://openapi.moomoo.com/moomoo-api-doc/en/quote/sub.html
- Moomoo OpenAPI subscription status documentation: https://openapi.moomoo.com/moomoo-api-doc/en/quote/query-subscription.html
