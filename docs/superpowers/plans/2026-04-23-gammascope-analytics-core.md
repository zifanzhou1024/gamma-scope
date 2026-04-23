# GammaScope Analytics Core Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add documented Black-Scholes-Merton pricing, implied-volatility, gamma, and vanna calculations, then use them for backend scenario snapshots.

**Architecture:** Keep the first analytics engine inside the FastAPI package so scenario and future ingestion code can share one tested Python implementation. The module exposes small pure functions for pricing/Greeks and a thin snapshot transformer for scenario calculations. Contract shape remains owned by the existing JSON Schemas.

**Tech Stack:** Python 3.11+, FastAPI, pytest, Pydantic-generated contract models, standard-library math/statistics helpers.

---

Spec: `docs/superpowers/specs/2026-04-23-gammascope-architecture-blueprint-design.md`

## Scope

In scope:

- Forward/discount-factor Black-Scholes-Merton option pricing.
- Bounded implied-volatility solver with explicit calculation statuses.
- Gamma and vanna calculations using the documented project units.
- Quote validation for missing, invalid, crossed, below-intrinsic, and out-of-bounds cases.
- Scenario snapshot recomputation from the seeded replay snapshot.
- API tests proving scenario output changes spot, forward, Greeks, and per-row statuses.

Out of scope:

- IBKR collector integration.
- Persistent storage.
- WebSocket streaming.
- Frontend charts.
- Hosted deployment.

## File Structure

- Create: `apps/api/gammascope_api/analytics/__init__.py`
- Create: `apps/api/gammascope_api/analytics/black_scholes.py`
- Create: `apps/api/gammascope_api/analytics/scenario.py`
- Create: `apps/api/tests/test_black_scholes.py`
- Modify: `apps/api/gammascope_api/routes/scenario.py`
- Modify: `apps/api/tests/test_contract_endpoints.py`
- Modify: `README.md`

## Chunk 1: Formula Core

### Task 1: Add Black-Scholes-Merton Formula Tests

**Files:**

- Create: `apps/api/tests/test_black_scholes.py`

- [ ] **Step 1: Write failing pricing and Greeks tests**

Create tests for:

- call and put pricing against deterministic known values using `spot=100`, `strike=100`, `tau=30/365`, `rate=0.05`, `dividend_yield=0.01`, `sigma=0.20`.
- call/put parity through the same forward/discount-factor convention.
- gamma equality for calls and puts.
- vanna stored as raw vanna and display-normalized per one volatility point.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_black_scholes.py -q
```

Expected: import failure because `gammascope_api.analytics.black_scholes` does not exist yet.

- [ ] **Step 3: Implement formula functions**

Create `apps/api/gammascope_api/analytics/black_scholes.py` with:

- `Normal` CDF/PDF helpers.
- `BlackScholesInputs` dataclass.
- `forward_price`, `discount_factor`, `d1_d2`.
- `option_price`.
- `gamma`.
- `raw_vanna`.
- `display_vanna_per_vol_point`.

Use the formulas from the architecture spec and standard-library `math.erf` for the normal CDF.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_black_scholes.py -q
```

Expected: pricing and Greeks tests pass.

### Task 2: Add Implied Volatility Solver Tests

**Files:**

- Modify: `apps/api/tests/test_black_scholes.py`
- Modify: `apps/api/gammascope_api/analytics/black_scholes.py`

- [ ] **Step 1: Write failing solver tests**

Add tests for:

- Recovering a known volatility from a generated call price.
- Returning `below_intrinsic` when mid is below discounted intrinsic value.
- Returning `missing_quote` for missing bid or ask.
- Returning `invalid_quote` for negative or crossed quotes.
- Returning `vol_out_of_bounds` when no bracketed solution exists.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_black_scholes.py -q
```

Expected: failures because the solver API does not exist yet.

- [ ] **Step 3: Implement solver and quote validation**

Add:

- `AnalyticsResult` dataclass.
- `mid_price`.
- `calculate_row_analytics`.
- bounded bisection solver with `sigma_min=0.0001`, `sigma_max=8.5`, and price tolerance `max(0.01, abs(mid) * 1e-4)`.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_black_scholes.py -q
```

Expected: all formula tests pass.

## Chunk 2: Scenario Endpoint Integration

### Task 3: Recompute Scenario Snapshots

**Files:**

- Create: `apps/api/gammascope_api/analytics/scenario.py`
- Modify: `apps/api/gammascope_api/routes/scenario.py`
- Modify: `apps/api/tests/test_contract_endpoints.py`

- [ ] **Step 1: Write failing API scenario tests**

Update the scenario endpoint test to assert:

- `mode` is `scenario`.
- `spot`, `forward`, and `scenario_params` reflect the request.
- each row's `custom_iv` is base IV plus the volatility shift converted from volatility points to decimal volatility.
- `custom_gamma` and `custom_vanna` are recomputed and differ from the base fixture for an actual shift.
- `iv_diff` and `gamma_diff` compare custom values against IBKR values when present.

- [ ] **Step 2: Run scenario test to verify RED**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_contract_endpoints.py::test_scenario_returns_scenario_snapshot -q
```

Expected: failure because the route still echoes the seeded fixture.

- [ ] **Step 3: Implement scenario transformer**

Create `apps/api/gammascope_api/analytics/scenario.py` with:

- `create_scenario_snapshot(base_snapshot, request_payload)`.
- expiry time handling using `snapshot_time`, `expiry`, and the request's `time_shift_minutes`.
- volatility shift conversion where `1.0` means `0.01`.
- row-level recomputation using `calculate_row_analytics`.
- graceful row status preservation for missing custom IV or invalid scenario inputs.

Update the FastAPI scenario route to call this transformer.

- [ ] **Step 4: Run scenario test to verify GREEN**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_contract_endpoints.py::test_scenario_returns_scenario_snapshot -q
```

Expected: scenario test passes.

### Task 4: Documentation and Full Verification

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Document analytics conventions**

Add a short `Analytics Conventions` section to `README.md` describing:

- forward/discount-factor Black-Scholes-Merton form.
- ACT/365 time.
- decimal annualized volatility.
- gamma per one index point.
- vanna stored per 1.00 volatility unit and displayed per one volatility point.
- IBKR values as comparison-only fields.

- [ ] **Step 2: Run full backend and frontend checks**

Run:

```bash
pnpm contracts:validate
pnpm contracts:generate
.venv/bin/python -m datamodel_code_generator --input packages/contracts/schemas/analytics-snapshot.schema.json --input-file-type jsonschema --output apps/api/gammascope_api/contracts/generated/analytics_snapshot.py --output-model-type pydantic_v2.BaseModel --disable-timestamp
.venv/bin/python -m datamodel_code_generator --input packages/contracts/schemas/collector-events.schema.json --input-file-type jsonschema --output apps/api/gammascope_api/contracts/generated/collector_events.py --output-model-type pydantic_v2.BaseModel --disable-timestamp
.venv/bin/python -m datamodel_code_generator --input packages/contracts/schemas/scenario.schema.json --input-file-type jsonschema --output apps/api/gammascope_api/contracts/generated/scenario.py --output-model-type pydantic_v2.BaseModel --disable-timestamp
.venv/bin/python -m datamodel_code_generator --input packages/contracts/schemas/saved-view.schema.json --input-file-type jsonschema --output apps/api/gammascope_api/contracts/generated/saved_view.py --output-model-type pydantic_v2.BaseModel --disable-timestamp
pnpm --filter @gammascope/contracts typecheck:generated
git diff --exit-code -- packages/contracts/src apps/api/gammascope_api/contracts/generated
pnpm typecheck:web
pnpm test:web
.venv/bin/pytest apps/api/tests -q
```

Expected: all checks pass and generated files remain stable.

- [ ] **Step 3: Commit analytics core**

Run:

```bash
git add README.md docs/superpowers/plans/2026-04-23-gammascope-analytics-core.md apps/api/gammascope_api/analytics apps/api/gammascope_api/routes/scenario.py apps/api/tests
git commit -m "feat: add analytics core"
```
