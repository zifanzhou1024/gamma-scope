# Experimental Analytics Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dense `/experimental` SPX 0DTE research tab backed by a dedicated experimental FastAPI payload for IV smile comparison, price-implied distribution, probabilities, trade maps, and quote-quality diagnostics.

**Architecture:** Keep the existing `AnalyticsSnapshot` contract untouched. Add a new experimental contract, backend analytics package, FastAPI routes, Next.js proxy/client layer, and modular React workbench page. Heavy numeric work lives in Python with `numpy` and `scipy`; frontend code renders many panel outputs at once and treats each panel status independently.

**Tech Stack:** Python 3.11+, FastAPI, pytest, Pydantic-generated models, numpy, scipy, Next.js App Router, React 19, TypeScript, Vitest, JSON Schema contracts.

---

## Scope Check

The approved spec is broad, but it is one cohesive feature: one new experimental surface powered by one dedicated payload. The work is split into independently verifiable slices so each task produces working, testable software before the next layer depends on it.

## File Structure

### Contracts

- Create `packages/contracts/schemas/experimental-analytics.schema.json`: canonical response schema.
- Create `packages/contracts/fixtures/experimental-analytics.seed.json`: fixture for schema and UI tests.
- Modify `packages/contracts/package.json`: add TypeScript generation and package export for experimental analytics.
- Modify `packages/contracts/tests/schema.test.mjs`: compile schema and validate seed fixture.
- Modify `packages/contracts/tests/generated-types.ts`: typecheck generated type.
- Create generated `packages/contracts/src/generated/experimental-analytics.ts`.
- Create generated `apps/api/gammascope_api/contracts/generated/experimental_analytics.py`.
- Modify `apps/api/tests/test_generated_contracts.py`: validate seed fixture through generated Pydantic model.

### Backend Analytics

- Create `apps/api/gammascope_api/experimental/__init__.py`: package marker.
- Create `apps/api/gammascope_api/experimental/models.py`: internal dataclasses and panel helpers.
- Create `apps/api/gammascope_api/experimental/quality.py`: quote pairing, quote filters, no-arbitrage checks.
- Create `apps/api/gammascope_api/experimental/forward.py`: parity forward and ATM straddle.
- Create `apps/api/gammascope_api/experimental/iv_methods.py`: Black-76 pricing, IV solve, raw curves, fits.
- Create `apps/api/gammascope_api/experimental/distribution.py`: probabilities and density preview.
- Create `apps/api/gammascope_api/experimental/trade_maps.py`: move-needed, decay, residual maps.
- Create `apps/api/gammascope_api/experimental/service.py`: orchestration and partial panel error handling.
- Create `apps/api/gammascope_api/routes/experimental.py`: latest and replay experimental API routes.
- Modify `apps/api/gammascope_api/main.py`: include experimental router.
- Modify `apps/api/pyproject.toml`: add `numpy` and `scipy`.

### Backend Tests

- Create `apps/api/tests/test_experimental_quality.py`.
- Create `apps/api/tests/test_experimental_forward.py`.
- Create `apps/api/tests/test_experimental_iv_methods.py`.
- Create `apps/api/tests/test_experimental_distribution.py`.
- Create `apps/api/tests/test_experimental_trade_maps.py`.
- Create `apps/api/tests/test_experimental_service.py`.
- Create `apps/api/tests/test_experimental_routes.py`.

### Frontend Data And UI

- Modify `apps/web/lib/contracts.ts`: export `ExperimentalAnalytics`.
- Create `apps/web/lib/clientExperimentalSource.ts`: validation and client fetchers.
- Create `apps/web/lib/experimentalFormat.ts`: status, number, ratio, and diagnostics formatting.
- Create `apps/web/components/ExperimentalDashboard.tsx`: page shell and replay/latest state.
- Create `apps/web/components/experimental/ExperimentalPanel.tsx`: reusable panel wrapper.
- Create `apps/web/components/experimental/ExperimentalSmileChart.tsx`: compact SVG chart for IV curves and distribution.
- Create `apps/web/components/experimental/ExperimentalSummaryPanels.tsx`: KPI, forward, smile diagnostics, skew/tail panels.
- Create `apps/web/components/experimental/ExperimentalTables.tsx`: probability, move-needed, decay, residual, quality tables.
- Create `apps/web/app/experimental/page.tsx`: server route.
- Create `apps/web/app/api/spx/0dte/experimental/latest/route.ts`: Next proxy for latest.
- Create `apps/web/app/api/spx/0dte/experimental/replay/snapshot/route.ts`: Next proxy for replay frame.
- Modify `apps/web/components/DashboardView.tsx`: add Experimental nav tab.
- Modify `apps/web/components/ExposureHeatmap.tsx`: add Experimental nav tab to its independent heatmap header.
- Modify `apps/web/app/styles.css`: experimental workbench layout and responsive styling.

### Frontend Tests

- Create `apps/web/tests/clientExperimentalSource.test.ts`.
- Create `apps/web/tests/experimentalFormat.test.ts`.
- Create `apps/web/tests/experimentalRoute.test.ts`.
- Create `apps/web/tests/experimentalReplayRoute.test.ts`.
- Create `apps/web/tests/ExperimentalPage.test.tsx`.
- Create `apps/web/tests/ExperimentalDashboard.test.tsx`.
- Modify `apps/web/tests/DashboardView.test.tsx`: top nav includes Experimental.
- Modify `apps/web/tests/ExposureHeatmap.test.tsx`: Heatmap nav includes Experimental.

---

## Task 1: Add Experimental Contract And Numeric Dependencies

**Files:**
- Create: `packages/contracts/schemas/experimental-analytics.schema.json`
- Create: `packages/contracts/fixtures/experimental-analytics.seed.json`
- Modify: `packages/contracts/package.json`
- Modify: `packages/contracts/tests/schema.test.mjs`
- Modify: `packages/contracts/tests/generated-types.ts`
- Create generated: `packages/contracts/src/generated/experimental-analytics.ts`
- Create generated: `apps/api/gammascope_api/contracts/generated/experimental_analytics.py`
- Modify: `apps/api/tests/test_generated_contracts.py`
- Modify: `apps/api/pyproject.toml`

- [ ] **Step 1: Add failing schema fixture validation**

In `packages/contracts/tests/schema.test.mjs`, add `experimental-analytics.schema.json` to the schema compile list:

```js
  for (const schemaPath of [
    "schemas/common.schema.json",
    "schemas/collector-events.schema.json",
    "schemas/analytics-snapshot.schema.json",
    "schemas/experimental-analytics.schema.json",
    "schemas/scenario.schema.json",
    "schemas/saved-view.schema.json"
  ]) {
```

Then add this test after `seed analytics snapshot matches schema`:

```js
test("seed experimental analytics payload matches schema", async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);

  const schema = await readJson("schemas/experimental-analytics.schema.json");
  const fixture = await readJson("fixtures/experimental-analytics.seed.json");
  const validate = ajv.compile(schema);

  assert.equal(validate(fixture), true, JSON.stringify(validate.errors, null, 2));
});
```

- [ ] **Step 2: Run contract tests to verify failure**

Run:

```bash
pnpm test:contracts
```

Expected: FAIL because `packages/contracts/schemas/experimental-analytics.schema.json` does not exist.

- [ ] **Step 3: Create experimental schema**

Create `packages/contracts/schemas/experimental-analytics.schema.json` with this schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://gammascope.local/schemas/experimental-analytics.schema.json",
  "title": "ExperimentalAnalytics",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "meta",
    "sourceSnapshot",
    "forwardSummary",
    "ivSmiles",
    "smileDiagnostics",
    "probabilities",
    "terminalDistribution",
    "skewTail",
    "moveNeeded",
    "decayPressure",
    "richCheap",
    "quoteQuality",
    "historyPreview"
  ],
  "properties": {
    "schema_version": { "type": "string", "const": "1.0.0" },
    "meta": {
      "type": "object",
      "additionalProperties": false,
      "required": ["generatedAt", "mode", "sourceSessionId", "sourceSnapshotTime", "symbol", "expiry"],
      "properties": {
        "generatedAt": { "type": "string", "format": "date-time" },
        "mode": { "type": "string", "enum": ["latest", "replay"] },
        "sourceSessionId": { "type": "string", "minLength": 1 },
        "sourceSnapshotTime": { "type": "string", "format": "date-time" },
        "symbol": { "type": "string", "const": "SPX" },
        "expiry": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" }
      }
    },
    "sourceSnapshot": {
      "type": "object",
      "additionalProperties": false,
      "required": ["spot", "forward", "rowCount", "strikeCount", "timeToExpiryYears"],
      "properties": {
        "spot": { "type": "number" },
        "forward": { "type": "number" },
        "rowCount": { "type": "integer", "minimum": 0 },
        "strikeCount": { "type": "integer", "minimum": 0 },
        "timeToExpiryYears": { "type": "number", "minimum": 0 }
      }
    },
    "forwardSummary": {
      "allOf": [
        { "$ref": "#/$defs/PanelBase" },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["status", "label", "diagnostics", "parityForward", "forwardMinusSpot", "atmStrike", "atmStraddle", "expectedRange", "expectedMovePercent"],
          "properties": {
            "status": { "$ref": "#/$defs/PanelStatus" },
            "label": { "type": "string" },
            "diagnostics": { "type": "array", "items": { "$ref": "#/$defs/Diagnostic" } },
            "parityForward": { "type": ["number", "null"] },
            "forwardMinusSpot": { "type": ["number", "null"] },
            "atmStrike": { "type": ["number", "null"] },
            "atmStraddle": { "type": ["number", "null"] },
            "expectedRange": {
              "type": ["object", "null"],
              "additionalProperties": false,
              "required": ["lower", "upper"],
              "properties": {
                "lower": { "type": "number" },
                "upper": { "type": "number" }
              }
            },
            "expectedMovePercent": { "type": ["number", "null"] }
          }
        }
      ]
    },
    "ivSmiles": {
      "allOf": [
        { "$ref": "#/$defs/PanelBase" },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["status", "label", "diagnostics", "methods"],
          "properties": {
            "status": { "$ref": "#/$defs/PanelStatus" },
            "label": { "type": "string" },
            "diagnostics": { "type": "array", "items": { "$ref": "#/$defs/Diagnostic" } },
            "methods": {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": ["key", "label", "status", "points"],
                "properties": {
                  "key": { "type": "string", "minLength": 1 },
                  "label": { "type": "string", "minLength": 1 },
                  "status": { "$ref": "#/$defs/PanelStatus" },
                  "points": { "type": "array", "items": { "$ref": "#/$defs/Point" } }
                }
              }
            }
          }
        }
      ]
    },
    "smileDiagnostics": {
      "allOf": [
        { "$ref": "#/$defs/PanelBase" },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["status", "label", "diagnostics", "ivValley", "atmForwardIv", "skewSlope", "curvature", "methodDisagreement"],
          "properties": {
            "status": { "$ref": "#/$defs/PanelStatus" },
            "label": { "type": "string" },
            "diagnostics": { "type": "array", "items": { "$ref": "#/$defs/Diagnostic" } },
            "ivValley": { "$ref": "#/$defs/StrikeValue" },
            "atmForwardIv": { "type": ["number", "null"] },
            "skewSlope": { "type": ["number", "null"] },
            "curvature": { "type": ["number", "null"] },
            "methodDisagreement": { "type": ["number", "null"] }
          }
        }
      ]
    },
    "probabilities": {
      "allOf": [
        { "$ref": "#/$defs/PanelBase" },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["status", "label", "diagnostics", "levels"],
          "properties": {
            "status": { "$ref": "#/$defs/PanelStatus" },
            "label": { "type": "string" },
            "diagnostics": { "type": "array", "items": { "$ref": "#/$defs/Diagnostic" } },
            "levels": {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": ["strike", "closeAbove", "closeBelow"],
                "properties": {
                  "strike": { "type": "number" },
                  "closeAbove": { "type": ["number", "null"] },
                  "closeBelow": { "type": ["number", "null"] }
                }
              }
            }
          }
        }
      ]
    },
    "terminalDistribution": {
      "allOf": [
        { "$ref": "#/$defs/PanelBase" },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["status", "label", "diagnostics", "density", "highestDensityZone", "range68", "range95", "leftTailProbability", "rightTailProbability"],
          "properties": {
            "status": { "$ref": "#/$defs/PanelStatus" },
            "label": { "type": "string" },
            "diagnostics": { "type": "array", "items": { "$ref": "#/$defs/Diagnostic" } },
            "density": { "type": "array", "items": { "$ref": "#/$defs/Point" } },
            "highestDensityZone": { "type": ["string", "null"] },
            "range68": { "type": ["string", "null"] },
            "range95": { "type": ["string", "null"] },
            "leftTailProbability": { "type": ["number", "null"] },
            "rightTailProbability": { "type": ["number", "null"] }
          }
        }
      ]
    },
    "skewTail": {
      "allOf": [
        { "$ref": "#/$defs/PanelBase" },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["status", "label", "diagnostics", "tailBias", "leftTailRichness", "rightTailRichness"],
          "properties": {
            "status": { "$ref": "#/$defs/PanelStatus" },
            "label": { "type": "string" },
            "diagnostics": { "type": "array", "items": { "$ref": "#/$defs/Diagnostic" } },
            "tailBias": { "type": ["string", "null"] },
            "leftTailRichness": { "type": ["number", "null"] },
            "rightTailRichness": { "type": ["number", "null"] }
          }
        }
      ]
    },
    "moveNeeded": { "$ref": "#/$defs/PanelWithRows" },
    "decayPressure": { "$ref": "#/$defs/PanelWithRows" },
    "richCheap": { "$ref": "#/$defs/PanelWithRows" },
    "quoteQuality": {
      "allOf": [
        { "$ref": "#/$defs/PanelBase" },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["status", "label", "diagnostics", "score", "flags"],
          "properties": {
            "status": { "$ref": "#/$defs/PanelStatus" },
            "label": { "type": "string" },
            "diagnostics": { "type": "array", "items": { "$ref": "#/$defs/Diagnostic" } },
            "score": { "type": "number", "minimum": 0, "maximum": 1 },
            "flags": {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": ["strike", "right", "code", "message"],
                "properties": {
                  "strike": { "type": "number" },
                  "right": { "type": "string", "enum": ["call", "put", "pair"] },
                  "code": { "type": "string", "minLength": 1 },
                  "message": { "type": "string", "minLength": 1 }
                }
              }
            }
          }
        }
      ]
    },
    "historyPreview": { "$ref": "#/$defs/PanelWithRows" }
  },
  "$defs": {
    "PanelStatus": {
      "type": "string",
      "enum": ["ok", "preview", "insufficient_data", "error"]
    },
    "Diagnostic": {
      "type": "object",
      "additionalProperties": false,
      "required": ["code", "message", "severity"],
      "properties": {
        "code": { "type": "string", "minLength": 1 },
        "message": { "type": "string", "minLength": 1 },
        "severity": { "type": "string", "enum": ["info", "warning", "error"] }
      }
    },
    "PanelBase": {
      "type": "object",
      "required": ["status", "label", "diagnostics"],
      "properties": {
        "status": { "$ref": "#/$defs/PanelStatus" },
        "label": { "type": "string", "minLength": 1 },
        "diagnostics": { "type": "array", "items": { "$ref": "#/$defs/Diagnostic" } }
      }
    },
    "Point": {
      "type": "object",
      "additionalProperties": false,
      "required": ["x", "y"],
      "properties": {
        "x": { "type": "number" },
        "y": { "type": ["number", "null"] }
      }
    },
    "StrikeValue": {
      "type": "object",
      "additionalProperties": false,
      "required": ["strike", "value", "label"],
      "properties": {
        "strike": { "type": ["number", "null"] },
        "value": { "type": ["number", "null"] },
        "label": { "type": ["string", "null"] }
      }
    },
    "PanelWithRows": {
      "allOf": [
        { "$ref": "#/$defs/PanelBase" },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["status", "label", "diagnostics", "rows"],
          "properties": {
            "status": { "$ref": "#/$defs/PanelStatus" },
            "label": { "type": "string" },
            "diagnostics": { "type": "array", "items": { "$ref": "#/$defs/Diagnostic" } },
            "rows": {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": true,
                "required": ["strike"],
                "properties": {
                  "strike": { "type": "number" }
                }
              }
            }
          }
        }
      ]
    }
  }
}
```

- [ ] **Step 4: Create seed experimental fixture**

Create `packages/contracts/fixtures/experimental-analytics.seed.json`:

```json
{
  "schema_version": "1.0.0",
  "meta": {
    "generatedAt": "2026-04-23T16:00:00Z",
    "mode": "latest",
    "sourceSessionId": "seed-spx-2026-04-23",
    "sourceSnapshotTime": "2026-04-23T16:00:00Z",
    "symbol": "SPX",
    "expiry": "2026-04-23"
  },
  "sourceSnapshot": {
    "spot": 5200.25,
    "forward": 5200.36,
    "rowCount": 34,
    "strikeCount": 17,
    "timeToExpiryYears": 0.000456621
  },
  "forwardSummary": {
    "status": "ok",
    "label": "Forward and expected move",
    "diagnostics": [],
    "parityForward": 5200.36,
    "forwardMinusSpot": 0.11,
    "atmStrike": 5200,
    "atmStraddle": 18.75,
    "expectedRange": { "lower": 5181.61, "upper": 5219.11 },
    "expectedMovePercent": 0.003605
  },
  "ivSmiles": {
    "status": "preview",
    "label": "IV smile methods",
    "diagnostics": [{ "code": "preview_method", "message": "Experimental fitted methods are diagnostic.", "severity": "info" }],
    "methods": [
      { "key": "custom_iv", "label": "Current custom IV", "status": "ok", "points": [{ "x": 5190, "y": 0.18 }, { "x": 5200, "y": 0.17 }, { "x": 5210, "y": 0.19 }] },
      { "key": "spline_fit", "label": "Spline fit", "status": "preview", "points": [{ "x": 5190, "y": 0.181 }, { "x": 5200, "y": 0.171 }, { "x": 5210, "y": 0.191 }] }
    ]
  },
  "smileDiagnostics": {
    "status": "preview",
    "label": "Smile diagnostics",
    "diagnostics": [],
    "ivValley": { "strike": 5200, "value": 0.171, "label": "Spline valley" },
    "atmForwardIv": 0.172,
    "skewSlope": -0.08,
    "curvature": 0.12,
    "methodDisagreement": 0.011
  },
  "probabilities": {
    "status": "preview",
    "label": "Risk-neutral probabilities",
    "diagnostics": [{ "code": "risk_neutral", "message": "Probabilities are risk-neutral, not real-world.", "severity": "info" }],
    "levels": [
      { "strike": 5190, "closeAbove": 0.67, "closeBelow": 0.33 },
      { "strike": 5200, "closeAbove": 0.52, "closeBelow": 0.48 },
      { "strike": 5210, "closeAbove": 0.35, "closeBelow": 0.65 }
    ]
  },
  "terminalDistribution": {
    "status": "preview",
    "label": "Terminal distribution",
    "diagnostics": [],
    "density": [{ "x": 5190, "y": 0.02 }, { "x": 5200, "y": 0.04 }, { "x": 5210, "y": 0.025 }],
    "highestDensityZone": "5195-5205",
    "range68": "5182-5219",
    "range95": "5164-5237",
    "leftTailProbability": 0.08,
    "rightTailProbability": 0.06
  },
  "skewTail": {
    "status": "preview",
    "label": "Skew and tail asymmetry",
    "diagnostics": [],
    "tailBias": "Left-tail rich",
    "leftTailRichness": 1.18,
    "rightTailRichness": 0.94
  },
  "moveNeeded": {
    "status": "ok",
    "label": "Move-needed map",
    "diagnostics": [],
    "rows": [{ "strike": 5210, "side": "call", "breakeven": 5213.2, "moveNeeded": 12.95, "expectedMoveRatio": 0.69, "label": "Within expected move" }]
  },
  "decayPressure": {
    "status": "preview",
    "label": "Time-decay pressure",
    "diagnostics": [{ "code": "static_decay", "message": "Static pressure assumes no spot or IV change.", "severity": "info" }],
    "rows": [{ "strike": 5210, "side": "call", "premium": 3.2, "pointsPerMinute": 0.08 }]
  },
  "richCheap": {
    "status": "preview",
    "label": "Rich/cheap residuals",
    "diagnostics": [],
    "rows": [{ "strike": 5210, "side": "call", "actualMid": 3.2, "fittedFair": 3.05, "residual": 0.15, "label": "Rich" }]
  },
  "quoteQuality": {
    "status": "ok",
    "label": "Quote quality",
    "diagnostics": [],
    "score": 0.94,
    "flags": [{ "strike": 5120, "right": "put", "code": "zero_bid", "message": "Bid is zero." }]
  },
  "historyPreview": {
    "status": "insufficient_data",
    "label": "Range compression preview",
    "diagnostics": [{ "code": "needs_replay", "message": "Select replay frames to compare history.", "severity": "info" }],
    "rows": []
  }
}
```

- [ ] **Step 5: Update contract package exports and generation**

Modify `packages/contracts/package.json`:

```json
{
  "scripts": {
    "validate": "node --test tests/schema.test.mjs",
    "test": "node --test tests/schema.test.mjs",
    "generate": "mkdir -p src/generated && json2ts -i schemas/analytics-snapshot.schema.json -o src/generated/analytics-snapshot.ts && json2ts -i schemas/collector-events.schema.json -o src/generated/collector-events.ts && json2ts -i schemas/experimental-analytics.schema.json -o src/generated/experimental-analytics.ts && json2ts -i schemas/scenario.schema.json -o src/generated/scenario.ts && json2ts -i schemas/saved-view.schema.json -o src/generated/saved-view.ts",
    "typecheck:generated": "tsc --project tsconfig.generated.json --noEmit"
  },
  "exports": {
    "./analytics-snapshot": "./src/generated/analytics-snapshot.ts",
    "./collector-events": "./src/generated/collector-events.ts",
    "./experimental-analytics": "./src/generated/experimental-analytics.ts",
    "./scenario": "./src/generated/scenario.ts",
    "./saved-view": "./src/generated/saved-view.ts"
  }
}
```

Preserve unchanged fields such as `name`, `version`, `private`, `type`, and `devDependencies`.

- [ ] **Step 6: Update TypeScript generated type smoke**

Modify `packages/contracts/tests/generated-types.ts`:

```ts
import type { AnalyticsSnapshot } from "../src/generated/analytics-snapshot";
import type { CollectorEvents } from "../src/generated/collector-events";
import type { ExperimentalAnalytics } from "../src/generated/experimental-analytics";
import type { SavedView } from "../src/generated/saved-view";
import type { ScenarioRequest } from "../src/generated/scenario";

type _SnapshotSchemaVersion = AnalyticsSnapshot["schema_version"];
type _CollectorEvent = CollectorEvents;
type _ExperimentalPanelStatus = ExperimentalAnalytics["forwardSummary"]["status"];
type _ScenarioShift = ScenarioRequest["vol_shift_points"];
type _SavedViewMode = SavedView["mode"];
```

- [ ] **Step 7: Add Python generated model test**

Modify `apps/api/tests/test_generated_contracts.py`:

```python
from gammascope_api.contracts.generated.experimental_analytics import ExperimentalAnalytics
```

Add:

```python
def test_seed_experimental_analytics_loads_as_generated_model() -> None:
    fixture_path = (
        Path(__file__).parents[3]
        / "packages"
        / "contracts"
        / "fixtures"
        / "experimental-analytics.seed.json"
    )
    payload = json.loads(fixture_path.read_text())

    experimental = ExperimentalAnalytics.model_validate(payload)

    assert experimental.schema_version == "1.0.0"
    assert experimental.meta.symbol == "SPX"
    assert experimental.forwardSummary.status.value == "ok"
```

- [ ] **Step 8: Add numeric dependencies**

Modify `apps/api/pyproject.toml` dependencies:

```toml
dependencies = [
  "fastapi>=0.115",
  "numpy>=2.0",
  "psycopg[binary]>=3.2",
  "pyarrow>=16",
  "pydantic>=2.8",
  "python-multipart>=0.0.22",
  "redis>=5.0",
  "scipy>=1.13",
  "uvicorn[standard]>=0.30"
]
```

- [ ] **Step 9: Generate TypeScript and Python contract models**

Run:

```bash
pnpm contracts:generate
.venv/bin/python -m datamodel_code_generator --input packages/contracts/schemas/experimental-analytics.schema.json --input-file-type jsonschema --output apps/api/gammascope_api/contracts/generated/experimental_analytics.py --output-model-type pydantic_v2.BaseModel --disable-timestamp
```

Expected: creates `packages/contracts/src/generated/experimental-analytics.ts` and `apps/api/gammascope_api/contracts/generated/experimental_analytics.py`.

- [ ] **Step 10: Run contract and generated-model tests**

Run:

```bash
pnpm test:contracts
pnpm --filter @gammascope/contracts typecheck:generated
.venv/bin/pytest apps/api/tests/test_generated_contracts.py -q
```

Expected: all pass.

- [ ] **Step 11: Commit contracts**

Run:

```bash
git add packages/contracts apps/api/pyproject.toml apps/api/gammascope_api/contracts/generated/experimental_analytics.py apps/api/tests/test_generated_contracts.py
git commit -m "feat: add experimental analytics contract"
```

---

## Task 2: Add Quote Quality And Forward Summary Core

**Files:**
- Create: `apps/api/gammascope_api/experimental/__init__.py`
- Create: `apps/api/gammascope_api/experimental/models.py`
- Create: `apps/api/gammascope_api/experimental/quality.py`
- Create: `apps/api/gammascope_api/experimental/forward.py`
- Test: `apps/api/tests/test_experimental_quality.py`
- Test: `apps/api/tests/test_experimental_forward.py`

- [ ] **Step 1: Write failing quote-quality tests**

Create `apps/api/tests/test_experimental_quality.py`:

```python
from gammascope_api.experimental.quality import grouped_pairs, quote_quality_panel


def row(contract_id: str, right: str, strike: float, bid: float | None, ask: float | None, mid: float | None = None) -> dict:
    return {
        "contract_id": contract_id,
        "right": right,
        "strike": strike,
        "bid": bid,
        "ask": ask,
        "mid": mid if mid is not None else ((bid + ask) / 2 if bid is not None and ask is not None else None),
        "custom_iv": 0.2,
        "ibkr_iv": 0.21,
        "custom_gamma": 0.01,
        "custom_vanna": 0.001,
        "open_interest": 100,
        "calc_status": "ok",
    }


def test_grouped_pairs_keeps_call_and_put_by_strike() -> None:
    pairs = grouped_pairs([
        row("c-100", "call", 100, 4.9, 5.1),
        row("p-100", "put", 100, 4.8, 5.0),
        row("c-105", "call", 105, 2.0, 2.2),
    ])

    assert [pair.strike for pair in pairs] == [100, 105]
    assert pairs[0].call["contract_id"] == "c-100"
    assert pairs[0].put["contract_id"] == "p-100"
    assert pairs[1].call["contract_id"] == "c-105"
    assert pairs[1].put is None


def test_quote_quality_flags_missing_crossed_zero_and_wide_quotes() -> None:
    panel = quote_quality_panel([
        row("c-100", "call", 100, 4.9, 5.1),
        row("p-100", "put", 100, None, 5.0),
        row("c-105", "call", 105, 3.0, 2.9),
        row("p-105", "put", 105, 0.0, 0.1),
        row("c-110", "call", 110, 0.2, 1.2),
    ])

    assert panel["status"] == "preview"
    assert panel["score"] == 0.2
    assert {flag["code"] for flag in panel["flags"]} == {"missing_bid_ask", "crossed_market", "zero_bid", "wide_spread"}
```

- [ ] **Step 2: Run quality tests to verify failure**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_experimental_quality.py -q
```

Expected: FAIL with `ModuleNotFoundError: No module named 'gammascope_api.experimental'`.

- [ ] **Step 3: Implement experimental models**

Create `apps/api/gammascope_api/experimental/__init__.py` as an empty file.

Create `apps/api/gammascope_api/experimental/models.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from math import isfinite
from typing import Any, Literal


PanelStatus = Literal["ok", "preview", "insufficient_data", "error"]


@dataclass(frozen=True)
class StrikePair:
    strike: float
    call: dict[str, Any] | None
    put: dict[str, Any] | None


def diagnostic(code: str, message: str, severity: Literal["info", "warning", "error"] = "info") -> dict[str, str]:
    return {"code": code, "message": message, "severity": severity}


def panel(status: PanelStatus, label: str, diagnostics: list[dict[str, str]] | None = None, **values: Any) -> dict[str, Any]:
    return {"status": status, "label": label, "diagnostics": diagnostics or [], **values}


def optional_float(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if isfinite(result) else None
```

- [ ] **Step 4: Implement quote quality**

Create `apps/api/gammascope_api/experimental/quality.py`:

```python
from __future__ import annotations

from typing import Any

from gammascope_api.experimental.models import StrikePair, diagnostic, optional_float, panel

MAX_RELATIVE_SPREAD = 0.40


def grouped_pairs(rows: list[dict[str, Any]]) -> list[StrikePair]:
    grouped: dict[float, dict[str, dict[str, Any] | None]] = {}
    for row in rows:
        strike = float(row["strike"])
        bucket = grouped.setdefault(strike, {"call": None, "put": None})
        if row.get("right") == "call":
            bucket["call"] = row
        elif row.get("right") == "put":
            bucket["put"] = row
    return [
        StrikePair(strike=strike, call=bucket["call"], put=bucket["put"])
        for strike, bucket in sorted(grouped.items())
    ]


def quote_quality_panel(rows: list[dict[str, Any]]) -> dict[str, Any]:
    flags: list[dict[str, Any]] = []
    usable_rows = 0
    for row in rows:
        row_flags = quote_flags(row)
        flags.extend(row_flags)
        if not row_flags:
            usable_rows += 1

    score = usable_rows / len(rows) if rows else 0.0
    status = "ok" if score >= 0.8 else "preview" if rows else "insufficient_data"
    diagnostics = [] if rows else [diagnostic("empty_chain", "No option rows are available.", "warning")]
    return panel(status, "Quote quality", diagnostics, score=round(score, 4), flags=flags)


def quote_flags(row: dict[str, Any]) -> list[dict[str, Any]]:
    bid = optional_float(row.get("bid"))
    ask = optional_float(row.get("ask"))
    strike = float(row["strike"])
    right = str(row.get("right") or "pair")
    flags: list[dict[str, Any]] = []

    if bid is None or ask is None:
        return [_flag(strike, right, "missing_bid_ask", "Bid or ask is missing.")]
    if ask < bid:
        flags.append(_flag(strike, right, "crossed_market", "Bid is above ask."))
    if bid <= 0:
        flags.append(_flag(strike, right, "zero_bid", "Bid is zero or negative."))

    mid = (bid + ask) / 2
    if mid > 0 and (ask - bid) / mid > MAX_RELATIVE_SPREAD:
        flags.append(_flag(strike, right, "wide_spread", "Spread is wider than 40% of midpoint."))

    if row.get("calc_status") == "below_intrinsic":
        flags.append(_flag(strike, right, "below_intrinsic", "Midpoint is below discounted intrinsic value."))
    if row.get("calc_status") in {"vol_out_of_bounds", "solver_failed"}:
        flags.append(_flag(strike, right, str(row["calc_status"]), "IV solve is unusable."))

    return flags


def _flag(strike: float, right: str, code: str, message: str) -> dict[str, Any]:
    return {"strike": strike, "right": right, "code": code, "message": message}
```

- [ ] **Step 5: Run quality tests to verify pass**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_experimental_quality.py -q
```

Expected: PASS.

- [ ] **Step 6: Write failing forward tests**

Create `apps/api/tests/test_experimental_forward.py`:

```python
import pytest

from gammascope_api.experimental.forward import forward_summary_panel, time_to_expiry_years


def row(right: str, strike: float, mid: float, bid: float | None = None, ask: float | None = None) -> dict:
    return {
        "contract_id": f"{right}-{strike}",
        "right": right,
        "strike": strike,
        "bid": bid if bid is not None else mid - 0.05,
        "ask": ask if ask is not None else mid + 0.05,
        "mid": mid,
        "calc_status": "ok",
    }


def test_time_to_expiry_years_uses_2000_utc_close() -> None:
    assert time_to_expiry_years("2026-04-23T19:00:00Z", "2026-04-23") == pytest.approx(1 / (365 * 24))


def test_forward_summary_uses_parity_median_and_forward_atm_straddle() -> None:
    snapshot = {
        "spot": 100.0,
        "risk_free_rate": 0.0,
        "snapshot_time": "2026-04-23T19:00:00Z",
        "expiry": "2026-04-23",
        "rows": [
            row("call", 95, 6.0),
            row("put", 95, 1.0),
            row("call", 100, 3.5),
            row("put", 100, 3.4),
            row("call", 105, 1.2),
            row("put", 105, 6.0),
        ],
    }

    panel = forward_summary_panel(snapshot)

    assert panel["status"] == "ok"
    assert panel["parityForward"] == pytest.approx(100.1)
    assert panel["forwardMinusSpot"] == pytest.approx(0.1)
    assert panel["atmStrike"] == 100
    assert panel["atmStraddle"] == pytest.approx(6.9)
    assert panel["expectedRange"] == {"lower": pytest.approx(93.2), "upper": pytest.approx(107.0)}
    assert panel["expectedMovePercent"] == pytest.approx(0.068931, rel=1e-4)


def test_forward_summary_reports_insufficient_data_without_pairs() -> None:
    panel = forward_summary_panel({
        "spot": 100.0,
        "risk_free_rate": 0.0,
        "snapshot_time": "2026-04-23T19:00:00Z",
        "expiry": "2026-04-23",
        "rows": [row("call", 100, 3.5)],
    })

    assert panel["status"] == "insufficient_data"
    assert panel["parityForward"] is None
```

- [ ] **Step 7: Run forward tests to verify failure**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_experimental_forward.py -q
```

Expected: FAIL because `gammascope_api.experimental.forward` does not exist.

- [ ] **Step 8: Implement forward summary**

Create `apps/api/gammascope_api/experimental/forward.py`:

```python
from __future__ import annotations

from datetime import UTC, datetime, time
from math import exp
from statistics import median
from typing import Any

from gammascope_api.experimental.models import diagnostic, optional_float, panel
from gammascope_api.experimental.quality import grouped_pairs, quote_flags

EXPIRY_CUTOFF_UTC = time(hour=20, minute=0, tzinfo=UTC)
MIN_TAU_YEARS = 1 / (365 * 24 * 60 * 60)


def time_to_expiry_years(snapshot_time: str, expiry: str) -> float:
    try:
        snapshot_dt = _parse_datetime(snapshot_time)
        expiry_date = datetime.fromisoformat(expiry).date()
    except ValueError:
        return 0.0
    expiry_dt = datetime.combine(expiry_date, EXPIRY_CUTOFF_UTC)
    seconds = max((expiry_dt - snapshot_dt).total_seconds(), 0)
    return seconds / (365 * 24 * 60 * 60)


def forward_summary_panel(snapshot: dict[str, Any]) -> dict[str, Any]:
    spot = float(snapshot["spot"])
    rate = float(snapshot.get("risk_free_rate") or 0.0)
    tau = max(time_to_expiry_years(str(snapshot["snapshot_time"]), str(snapshot["expiry"])), MIN_TAU_YEARS)
    forward_estimates: list[tuple[float, float]] = []

    for pair in grouped_pairs(list(snapshot.get("rows", []))):
        if pair.call is None or pair.put is None:
            continue
        if quote_flags(pair.call) or quote_flags(pair.put):
            continue
        call_mid = optional_float(pair.call.get("mid"))
        put_mid = optional_float(pair.put.get("mid"))
        if call_mid is None or put_mid is None:
            continue
        forward_estimates.append((pair.strike, pair.strike + exp(rate * tau) * (call_mid - put_mid)))

    if not forward_estimates:
        return panel(
            "insufficient_data",
            "Forward and expected move",
            [diagnostic("missing_pairs", "No clean call/put pairs are available.", "warning")],
            parityForward=None,
            forwardMinusSpot=None,
            atmStrike=None,
            atmStraddle=None,
            expectedRange=None,
            expectedMovePercent=None,
        )

    near_atm = sorted(forward_estimates, key=lambda item: abs(item[0] - spot))[:15]
    parity_forward = median(value for _, value in near_atm)
    atm_pair = min(grouped_pairs(list(snapshot.get("rows", []))), key=lambda pair: abs(pair.strike - parity_forward))
    atm_straddle = _pair_straddle(atm_pair.call, atm_pair.put)
    expected_range = None
    expected_move_percent = None
    if atm_straddle is not None:
        expected_range = {"lower": parity_forward - atm_straddle, "upper": parity_forward + atm_straddle}
        expected_move_percent = atm_straddle / parity_forward if parity_forward > 0 else None

    return panel(
        "ok",
        "Forward and expected move",
        [],
        parityForward=parity_forward,
        forwardMinusSpot=parity_forward - spot,
        atmStrike=atm_pair.strike,
        atmStraddle=atm_straddle,
        expectedRange=expected_range,
        expectedMovePercent=expected_move_percent,
    )


def _pair_straddle(call: dict[str, Any] | None, put: dict[str, Any] | None) -> float | None:
    if call is None or put is None:
        return None
    call_mid = optional_float(call.get("mid"))
    put_mid = optional_float(put.get("mid"))
    if call_mid is None or put_mid is None:
        return None
    return call_mid + put_mid


def _parse_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)
```

- [ ] **Step 9: Run focused backend core tests**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_experimental_quality.py apps/api/tests/test_experimental_forward.py -q
```

Expected: PASS.

- [ ] **Step 10: Commit quality and forward core**

Run:

```bash
git add apps/api/gammascope_api/experimental apps/api/tests/test_experimental_quality.py apps/api/tests/test_experimental_forward.py
git commit -m "feat: add experimental quote quality and forward summary"
```

---

## Task 3: Add IV Method Curves And Fitted Smile Diagnostics

**Files:**
- Create: `apps/api/gammascope_api/experimental/iv_methods.py`
- Test: `apps/api/tests/test_experimental_iv_methods.py`

- [ ] **Step 1: Write failing IV method tests**

Create `apps/api/tests/test_experimental_iv_methods.py`:

```python
import pytest

from gammascope_api.experimental.iv_methods import (
    black76_price,
    build_iv_smiles_panel,
    implied_vol_black76,
    smile_diagnostics_panel,
)


def row(right: str, strike: float, mid: float, custom_iv: float = 0.2, ibkr_iv: float | None = 0.21) -> dict:
    return {
        "contract_id": f"{right}-{strike}",
        "right": right,
        "strike": strike,
        "bid": max(0.0, mid - 0.05),
        "ask": mid + 0.05,
        "mid": mid,
        "custom_iv": custom_iv,
        "ibkr_iv": ibkr_iv,
        "calc_status": "ok",
    }


def test_black76_iv_solver_recovers_known_vol() -> None:
    price = black76_price(forward=100, strike=100, tau=30 / 365, rate=0.05, sigma=0.25, right="call")

    assert implied_vol_black76(price=price, forward=100, strike=100, tau=30 / 365, rate=0.05, right="call") == pytest.approx(0.25, abs=1e-5)


def test_build_iv_smiles_panel_outputs_raw_and_fitted_methods() -> None:
    snapshot = {
        "spot": 100,
        "risk_free_rate": 0.0,
        "snapshot_time": "2026-04-23T19:00:00Z",
        "expiry": "2026-04-23",
        "rows": [
            row("put", 90, 0.25, 0.28),
            row("put", 95, 0.75, 0.22),
            row("call", 100, 3.0, 0.18),
            row("put", 100, 2.9, 0.18),
            row("call", 105, 0.9, 0.21),
            row("call", 110, 0.3, 0.26),
        ],
    }
    forward_summary = {"parityForward": 100.0, "atmStraddle": 5.9}

    panel = build_iv_smiles_panel(snapshot, forward_summary)

    assert panel["status"] == "preview"
    assert {method["key"] for method in panel["methods"]} >= {
        "custom_iv",
        "broker_iv",
        "otm_midpoint_black76",
        "atm_straddle_iv",
        "spline_fit",
        "quadratic_fit",
        "wing_weighted_fit",
        "last_price",
    }
    assert next(method for method in panel["methods"] if method["key"] == "last_price")["status"] == "insufficient_data"


def test_smile_diagnostics_reports_valley_and_method_disagreement() -> None:
    iv_panel = {
        "methods": [
            {"key": "custom_iv", "points": [{"x": 95, "y": 0.22}, {"x": 100, "y": 0.18}, {"x": 105, "y": 0.21}]},
            {"key": "spline_fit", "points": [{"x": 95, "y": 0.215}, {"x": 100, "y": 0.175}, {"x": 105, "y": 0.205}]},
            {"key": "quadratic_fit", "points": [{"x": 95, "y": 0.216}, {"x": 100, "y": 0.176}, {"x": 105, "y": 0.206}]},
        ]
    }

    panel = smile_diagnostics_panel(iv_panel, forward=100)

    assert panel["status"] == "preview"
    assert panel["ivValley"] == {"strike": 100, "value": pytest.approx(0.175), "label": "Spline valley"}
    assert panel["atmForwardIv"] == pytest.approx(0.175)
    assert panel["methodDisagreement"] is not None
```

- [ ] **Step 2: Run IV tests to verify failure**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_experimental_iv_methods.py -q
```

Expected: FAIL because `iv_methods.py` does not exist.

- [ ] **Step 3: Implement Black-76, IV solve, and smile methods**

Create `apps/api/gammascope_api/experimental/iv_methods.py`:

```python
from __future__ import annotations

from math import erf, exp, isfinite, log, pi, sqrt
from typing import Any, Literal

import numpy as np
from scipy.interpolate import UnivariateSpline
from scipy.optimize import brentq

from gammascope_api.experimental.forward import time_to_expiry_years
from gammascope_api.experimental.models import diagnostic, optional_float, panel
from gammascope_api.experimental.quality import grouped_pairs, quote_flags

Right = Literal["call", "put"]
SIGMA_MIN = 0.0001
SIGMA_MAX = 8.5


def normal_cdf(value: float) -> float:
    return 0.5 * (1 + erf(value / sqrt(2)))


def black76_price(*, forward: float, strike: float, tau: float, rate: float, sigma: float, right: Right) -> float:
    if forward <= 0 or strike <= 0 or tau <= 0 or sigma <= 0:
        return 0.0
    df = exp(-rate * tau)
    vol_sqrt_t = sigma * sqrt(tau)
    if vol_sqrt_t <= 0:
        intrinsic = max(forward - strike, 0) if right == "call" else max(strike - forward, 0)
        return df * intrinsic
    d1 = (log(forward / strike) + 0.5 * sigma * sigma * tau) / vol_sqrt_t
    d2 = d1 - vol_sqrt_t
    if right == "call":
        return df * (forward * normal_cdf(d1) - strike * normal_cdf(d2))
    return df * (strike * normal_cdf(-d2) - forward * normal_cdf(-d1))


def implied_vol_black76(*, price: float, forward: float, strike: float, tau: float, rate: float, right: Right) -> float | None:
    if price <= 0 or forward <= 0 or strike <= 0 or tau <= 0:
        return None
    df = exp(-rate * tau)
    intrinsic = df * (max(forward - strike, 0) if right == "call" else max(strike - forward, 0))
    if price < intrinsic - 1e-8:
        return None

    def objective(sigma: float) -> float:
        return black76_price(forward=forward, strike=strike, tau=tau, rate=rate, sigma=sigma, right=right) - price

    try:
        return float(brentq(objective, SIGMA_MIN, SIGMA_MAX, xtol=1e-8, maxiter=100))
    except ValueError:
        return None


def build_iv_smiles_panel(snapshot: dict[str, Any], forward_summary: dict[str, Any]) -> dict[str, Any]:
    forward = optional_float(forward_summary.get("parityForward")) or float(snapshot["forward"])
    rate = float(snapshot.get("risk_free_rate") or 0)
    tau = max(time_to_expiry_years(str(snapshot["snapshot_time"]), str(snapshot["expiry"])), 1 / (365 * 24 * 60 * 60))
    rows = list(snapshot.get("rows", []))
    raw_otm = _otm_midpoint_points(rows, forward, tau, rate)
    custom_points = _row_points(rows, "custom_iv")
    broker_points = _row_points(rows, "ibkr_iv")
    atm_straddle_points = _atm_straddle_points(forward_summary, forward, tau)
    fitted = _fit_methods(raw_otm, forward, tau)
    methods = [
        {"key": "custom_iv", "label": "Current custom IV", "status": "ok" if custom_points else "insufficient_data", "points": custom_points},
        {"key": "broker_iv", "label": "Broker IV diagnostic", "status": "preview" if broker_points else "insufficient_data", "points": broker_points},
        {"key": "otm_midpoint_black76", "label": "OTM midpoint Black-76", "status": "ok" if raw_otm else "insufficient_data", "points": raw_otm},
        {"key": "atm_straddle_iv", "label": "ATM straddle IV", "status": "preview" if atm_straddle_points else "insufficient_data", "points": atm_straddle_points},
        *fitted,
        {"key": "last_price", "label": "Last-price diagnostic", "status": "insufficient_data", "points": []},
    ]
    status = "preview" if any(method["points"] for method in methods) else "insufficient_data"
    return panel(status, "IV smile methods", [diagnostic("research_methods", "Fitted smile methods are experimental.", "info")], methods=methods)


def smile_diagnostics_panel(iv_panel: dict[str, Any], forward: float) -> dict[str, Any]:
    spline = next((method for method in iv_panel.get("methods", []) if method.get("key") == "spline_fit"), None)
    points = list((spline or {}).get("points") or [])
    if not points:
        return panel("insufficient_data", "Smile diagnostics", [diagnostic("missing_fit", "No fitted smile is available.", "warning")], ivValley={"strike": None, "value": None, "label": None}, atmForwardIv=None, skewSlope=None, curvature=None, methodDisagreement=None)
    finite_points = [point for point in points if point.get("y") is not None]
    valley = min(finite_points, key=lambda point: float(point["y"]))
    atm = min(finite_points, key=lambda point: abs(float(point["x"]) - forward))
    left = finite_points[0]
    right = finite_points[-1]
    width = max(float(right["x"]) - float(left["x"]), 1.0)
    skew_slope = (float(right["y"]) - float(left["y"])) / width
    curvature = float(left["y"]) + float(right["y"]) - 2 * float(atm["y"])
    disagreement = _method_disagreement(iv_panel)
    return panel("preview", "Smile diagnostics", [], ivValley={"strike": float(valley["x"]), "value": float(valley["y"]), "label": "Spline valley"}, atmForwardIv=float(atm["y"]), skewSlope=skew_slope, curvature=curvature, methodDisagreement=disagreement)


def _row_points(rows: list[dict[str, Any]], key: str) -> list[dict[str, float]]:
    points = []
    for row in rows:
        value = optional_float(row.get(key))
        if value is not None:
            points.append({"x": float(row["strike"]), "y": value})
    return sorted(points, key=lambda point: point["x"])


def _otm_midpoint_points(rows: list[dict[str, Any]], forward: float, tau: float, rate: float) -> list[dict[str, float]]:
    points = []
    for pair in grouped_pairs(rows):
        if pair.strike < forward:
            selected = pair.put
            right: Right = "put"
        else:
            selected = pair.call
            right = "call"
        if selected is None or quote_flags(selected):
            continue
        price = optional_float(selected.get("mid"))
        if price is None:
            continue
        iv = implied_vol_black76(price=price, forward=forward, strike=pair.strike, tau=tau, rate=rate, right=right)
        if iv is not None and isfinite(iv):
            points.append({"x": pair.strike, "y": iv})
    return sorted(points, key=lambda point: point["x"])


def _atm_straddle_points(forward_summary: dict[str, Any], forward: float, tau: float) -> list[dict[str, float]]:
    straddle = optional_float(forward_summary.get("atmStraddle"))
    atm = optional_float(forward_summary.get("atmStrike"))
    if straddle is None or atm is None or forward <= 0 or tau <= 0:
        return []
    iv = (straddle / forward) * sqrt(pi / (2 * tau))
    return [{"x": atm, "y": iv}]


def _fit_methods(points: list[dict[str, float]], forward: float, tau: float) -> list[dict[str, Any]]:
    if len(points) < 4 or forward <= 0 or tau <= 0:
        return [
            {"key": "spline_fit", "label": "Spline fit", "status": "insufficient_data", "points": []},
            {"key": "quadratic_fit", "label": "Quadratic fit", "status": "insufficient_data", "points": []},
            {"key": "wing_weighted_fit", "label": "Wing-weighted fit", "status": "insufficient_data", "points": []},
        ]
    x = np.array([log(point["x"] / forward) for point in points], dtype=float)
    strikes = np.array([point["x"] for point in points], dtype=float)
    total_variance = np.array([(point["y"] ** 2) * tau for point in points], dtype=float)
    order = np.argsort(x)
    x = x[order]
    strikes = strikes[order]
    total_variance = total_variance[order]
    grid = np.linspace(float(x.min()), float(x.max()), 80)
    grid_strikes = forward * np.exp(grid)

    spline = UnivariateSpline(x, total_variance, k=min(3, len(x) - 1), s=len(x) * 1e-7)
    spline_points = _fit_points(grid_strikes, spline(grid), tau)

    quadratic_coefficients = np.polyfit(x, total_variance, deg=2)
    quadratic_points = _fit_points(grid_strikes, np.polyval(quadratic_coefficients, grid), tau)

    weights = 1 + np.abs(x) / max(float(np.max(np.abs(x))), 1e-9)
    wing_coefficients = np.polyfit(x, total_variance, deg=2, w=weights)
    wing_points = _fit_points(grid_strikes, np.polyval(wing_coefficients, grid), tau)

    return [
        {"key": "spline_fit", "label": "Spline fit", "status": "preview", "points": spline_points},
        {"key": "quadratic_fit", "label": "Quadratic fit", "status": "preview", "points": quadratic_points},
        {"key": "wing_weighted_fit", "label": "Wing-weighted fit", "status": "preview", "points": wing_points},
    ]


def _fit_points(strikes: np.ndarray, total_variance: np.ndarray, tau: float) -> list[dict[str, float]]:
    clean = np.maximum(total_variance, 1e-12)
    ivs = np.sqrt(clean / tau)
    return [{"x": float(strike), "y": float(iv)} for strike, iv in zip(strikes, ivs)]


def _method_disagreement(iv_panel: dict[str, Any]) -> float | None:
    method_values = []
    for method in iv_panel.get("methods", []):
        points = [point for point in method.get("points", []) if point.get("y") is not None]
        if points:
            method_values.append(float(points[len(points) // 2]["y"]))
    if len(method_values) < 2:
        return None
    return max(method_values) - min(method_values)
```

- [ ] **Step 4: Run IV tests**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_experimental_iv_methods.py -q
```

Expected: PASS.

- [ ] **Step 5: Run backend core regression**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_experimental_quality.py apps/api/tests/test_experimental_forward.py apps/api/tests/test_experimental_iv_methods.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit IV methods**

Run:

```bash
git add apps/api/gammascope_api/experimental/iv_methods.py apps/api/tests/test_experimental_iv_methods.py
git commit -m "feat: add experimental iv smile methods"
```

---

## Task 4: Add Distribution, Probability, Trade Map, And Residual Panels

**Files:**
- Create: `apps/api/gammascope_api/experimental/distribution.py`
- Create: `apps/api/gammascope_api/experimental/trade_maps.py`
- Test: `apps/api/tests/test_experimental_distribution.py`
- Test: `apps/api/tests/test_experimental_trade_maps.py`

- [ ] **Step 1: Write failing distribution tests**

Create `apps/api/tests/test_experimental_distribution.py`:

```python
from gammascope_api.experimental.distribution import probability_panel, terminal_distribution_panel, skew_tail_panel


def fitted_iv_panel() -> dict:
    points = [{"x": 95, "y": 0.22}, {"x": 100, "y": 0.18}, {"x": 105, "y": 0.21}]
    return {"methods": [{"key": "spline_fit", "points": points}]}


def test_probability_panel_returns_risk_neutral_level_rows() -> None:
    panel = probability_panel(fitted_iv_panel(), forward=100, tau=1 / 365, rate=0.0)

    assert panel["status"] == "preview"
    assert panel["levels"][0]["strike"] == 95
    assert 0 <= panel["levels"][0]["closeAbove"] <= 1
    assert panel["diagnostics"][0]["code"] == "risk_neutral"


def test_terminal_distribution_panel_returns_density_and_ranges() -> None:
    panel = terminal_distribution_panel(fitted_iv_panel(), forward=100, tau=1 / 365, rate=0.0)

    assert panel["status"] == "preview"
    assert panel["density"]
    assert panel["highestDensityZone"] is not None
    assert panel["range68"] is not None
    assert panel["range95"] is not None


def test_distribution_panels_report_insufficient_data_without_fit() -> None:
    empty = {"methods": []}

    assert probability_panel(empty, forward=100, tau=1 / 365, rate=0.0)["status"] == "insufficient_data"
    assert terminal_distribution_panel(empty, forward=100, tau=1 / 365, rate=0.0)["status"] == "insufficient_data"


def test_skew_tail_panel_labels_left_tail_richness() -> None:
    panel = skew_tail_panel(fitted_iv_panel(), forward=100)

    assert panel["status"] == "preview"
    assert panel["tailBias"] in {"Left-tail rich", "Right-tail rich", "Balanced tails"}
```

- [ ] **Step 2: Run distribution tests to verify failure**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_experimental_distribution.py -q
```

Expected: FAIL because `distribution.py` does not exist.

- [ ] **Step 3: Implement distribution panels**

Create `apps/api/gammascope_api/experimental/distribution.py`:

```python
from __future__ import annotations

from math import exp, log, sqrt
from typing import Any

from gammascope_api.experimental.iv_methods import black76_price, normal_cdf
from gammascope_api.experimental.models import diagnostic, panel


def probability_panel(iv_panel: dict[str, Any], *, forward: float, tau: float, rate: float) -> dict[str, Any]:
    points = _fit_points(iv_panel)
    if len(points) < 2:
        return panel("insufficient_data", "Risk-neutral probabilities", [diagnostic("missing_fit", "A fitted smile is required.", "warning")], levels=[])
    levels = []
    for point in points:
        strike = float(point["x"])
        sigma = float(point["y"])
        if forward <= 0 or strike <= 0 or tau <= 0:
            close_above = None
        else:
            d2 = (log(forward / strike) - 0.5 * sigma * sigma * tau) / (sigma * sqrt(tau))
            close_above = normal_cdf(d2)
        levels.append({"strike": strike, "closeAbove": close_above, "closeBelow": None if close_above is None else 1 - close_above})
    return panel("preview", "Risk-neutral probabilities", [diagnostic("risk_neutral", "Probabilities are risk-neutral, not real-world.", "info")], levels=levels)


def terminal_distribution_panel(iv_panel: dict[str, Any], *, forward: float, tau: float, rate: float) -> dict[str, Any]:
    points = _fit_points(iv_panel)
    if len(points) < 3:
        return panel("insufficient_data", "Terminal distribution", [diagnostic("missing_fit", "A fitted smile with at least three points is required.", "warning")], density=[], highestDensityZone=None, range68=None, range95=None, leftTailProbability=None, rightTailProbability=None)
    calls = [
        black76_price(forward=forward, strike=float(point["x"]), tau=tau, rate=rate, sigma=float(point["y"]), right="call")
        for point in points
    ]
    strikes = [float(point["x"]) for point in points]
    density = []
    for index in range(1, len(points) - 1):
        left_width = strikes[index] - strikes[index - 1]
        right_width = strikes[index + 1] - strikes[index]
        width = max((left_width + right_width) / 2, 1e-9)
        curvature = (calls[index - 1] - 2 * calls[index] + calls[index + 1]) / (width * width)
        density.append({"x": strikes[index], "y": max(0.0, curvature * exp(rate * tau))})
    if not density:
        return panel("insufficient_data", "Terminal distribution", [diagnostic("empty_density", "Density could not be estimated.", "warning")], density=[], highestDensityZone=None, range68=None, range95=None, leftTailProbability=None, rightTailProbability=None)
    highest = max(density, key=lambda point: point["y"] or 0)
    probabilities = probability_panel(iv_panel, forward=forward, tau=tau, rate=rate)["levels"]
    lower68, upper68 = _range_from_probabilities(probabilities, 0.16, 0.84)
    lower95, upper95 = _range_from_probabilities(probabilities, 0.025, 0.975)
    left_tail = next((level["closeBelow"] for level in probabilities if level["strike"] == lower95), None)
    right_tail = next((level["closeAbove"] for level in probabilities if level["strike"] == upper95), None)
    return panel("preview", "Terminal distribution", [], density=density, highestDensityZone=f"{highest['x']:.0f}", range68=_range_label(lower68, upper68), range95=_range_label(lower95, upper95), leftTailProbability=left_tail, rightTailProbability=right_tail)


def skew_tail_panel(iv_panel: dict[str, Any], *, forward: float) -> dict[str, Any]:
    points = _fit_points(iv_panel)
    if len(points) < 3:
        return panel("insufficient_data", "Skew and tail asymmetry", [diagnostic("missing_fit", "A fitted smile is required.", "warning")], tailBias=None, leftTailRichness=None, rightTailRichness=None)
    atm = min(points, key=lambda point: abs(float(point["x"]) - forward))
    left = points[0]
    right = points[-1]
    atm_iv = max(float(atm["y"]), 1e-9)
    left_richness = float(left["y"]) / atm_iv
    right_richness = float(right["y"]) / atm_iv
    if left_richness - right_richness > 0.05:
        bias = "Left-tail rich"
    elif right_richness - left_richness > 0.05:
        bias = "Right-tail rich"
    else:
        bias = "Balanced tails"
    return panel("preview", "Skew and tail asymmetry", [], tailBias=bias, leftTailRichness=left_richness, rightTailRichness=right_richness)


def _fit_points(iv_panel: dict[str, Any]) -> list[dict[str, float]]:
    for method in iv_panel.get("methods", []):
        if method.get("key") == "spline_fit":
            return [point for point in method.get("points", []) if point.get("y") is not None]
    return []


def _range_from_probabilities(levels: list[dict[str, Any]], lower_tail: float, upper_tail: float) -> tuple[float | None, float | None]:
    lower = min(levels, key=lambda level: abs((level.get("closeBelow") or 0) - lower_tail), default={}).get("strike")
    upper = min(levels, key=lambda level: abs((level.get("closeBelow") or 0) - upper_tail), default={}).get("strike")
    return lower, upper


def _range_label(lower: float | None, upper: float | None) -> str | None:
    if lower is None or upper is None:
        return None
    return f"{lower:.0f}-{upper:.0f}"
```

- [ ] **Step 4: Run distribution tests**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_experimental_distribution.py -q
```

Expected: PASS.

- [ ] **Step 5: Write failing trade map tests**

Create `apps/api/tests/test_experimental_trade_maps.py`:

```python
import pytest

from gammascope_api.experimental.trade_maps import decay_pressure_panel, move_needed_panel, rich_cheap_panel


def row(right: str, strike: float, mid: float) -> dict:
    return {
        "contract_id": f"{right}-{strike}",
        "right": right,
        "strike": strike,
        "bid": max(0, mid - 0.05),
        "ask": mid + 0.05,
        "mid": mid,
        "custom_iv": 0.2,
        "calc_status": "ok",
    }


def test_move_needed_panel_labels_expected_move_ratios() -> None:
    panel = move_needed_panel([row("call", 105, 2), row("put", 95, 1.5)], spot=100, expected_move=10)

    assert panel["status"] == "ok"
    assert panel["rows"][0]["breakeven"] == 107
    assert panel["rows"][0]["expectedMoveRatio"] == pytest.approx(0.7)
    assert panel["rows"][0]["label"] == "Within expected move"


def test_decay_pressure_panel_reports_static_points_per_minute() -> None:
    panel = decay_pressure_panel([row("call", 105, 2.0)], minutes_to_expiry=20)

    assert panel["status"] == "preview"
    assert panel["rows"][0]["pointsPerMinute"] == pytest.approx(0.1)


def test_rich_cheap_panel_compares_actual_mid_to_fitted_fair() -> None:
    iv_panel = {"methods": [{"key": "spline_fit", "points": [{"x": 105, "y": 0.2}]}]}
    panel = rich_cheap_panel([row("call", 105, 2.0)], iv_panel=iv_panel, forward=100, tau=1 / 365, rate=0.0)

    assert panel["status"] == "preview"
    assert panel["rows"][0]["strike"] == 105
    assert panel["rows"][0]["label"] in {"Rich", "Cheap", "Inline"}
```

- [ ] **Step 6: Run trade map tests to verify failure**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_experimental_trade_maps.py -q
```

Expected: FAIL because `trade_maps.py` does not exist.

- [ ] **Step 7: Implement trade maps**

Create `apps/api/gammascope_api/experimental/trade_maps.py`:

```python
from __future__ import annotations

from typing import Any

from gammascope_api.experimental.iv_methods import black76_price
from gammascope_api.experimental.models import diagnostic, optional_float, panel


def move_needed_panel(rows: list[dict[str, Any]], *, spot: float, expected_move: float | None) -> dict[str, Any]:
    out = []
    for row in rows:
        mid = optional_float(row.get("mid"))
        if mid is None:
            continue
        strike = float(row["strike"])
        side = str(row["right"])
        if side == "call":
            breakeven = strike + mid
            move_needed = max(0.0, breakeven - spot)
        else:
            breakeven = strike - mid
            move_needed = max(0.0, spot - breakeven)
        ratio = move_needed / expected_move if expected_move and expected_move > 0 else None
        out.append({"strike": strike, "side": side, "breakeven": breakeven, "moveNeeded": move_needed, "expectedMoveRatio": ratio, "label": _ratio_label(ratio)})
    return panel("ok" if out else "insufficient_data", "Move-needed map", [], rows=out)


def decay_pressure_panel(rows: list[dict[str, Any]], *, minutes_to_expiry: float) -> dict[str, Any]:
    out = []
    minutes = max(minutes_to_expiry, 1e-9)
    for row in rows:
        mid = optional_float(row.get("mid"))
        if mid is None:
            continue
        out.append({"strike": float(row["strike"]), "side": row["right"], "premium": mid, "pointsPerMinute": mid / minutes})
    return panel("preview" if out else "insufficient_data", "Time-decay pressure", [diagnostic("static_decay", "Static pressure assumes no spot or IV change.", "info")], rows=out)


def rich_cheap_panel(rows: list[dict[str, Any]], *, iv_panel: dict[str, Any], forward: float, tau: float, rate: float) -> dict[str, Any]:
    fit_by_strike = _fit_by_strike(iv_panel)
    out = []
    for row in rows:
        mid = optional_float(row.get("mid"))
        sigma = fit_by_strike.get(float(row["strike"]))
        if mid is None or sigma is None:
            continue
        side = row["right"]
        fitted_fair = black76_price(forward=forward, strike=float(row["strike"]), tau=tau, rate=rate, sigma=sigma, right=side)
        residual = mid - fitted_fair
        out.append({"strike": float(row["strike"]), "side": side, "actualMid": mid, "fittedFair": fitted_fair, "residual": residual, "label": _residual_label(residual)})
    return panel("preview" if out else "insufficient_data", "Rich/cheap residuals", [], rows=out)


def _ratio_label(ratio: float | None) -> str:
    if ratio is None:
        return "Expected move unavailable"
    if ratio < 0.5:
        return "Breakeven close"
    if ratio <= 1.0:
        return "Within expected move"
    if ratio <= 1.5:
        return "Needs above-normal move"
    return "Lottery-like"


def _residual_label(residual: float) -> str:
    if residual > 0.1:
        return "Rich"
    if residual < -0.1:
        return "Cheap"
    return "Inline"


def _fit_by_strike(iv_panel: dict[str, Any]) -> dict[float, float]:
    for method in iv_panel.get("methods", []):
        if method.get("key") == "spline_fit":
            return {float(point["x"]): float(point["y"]) for point in method.get("points", []) if point.get("y") is not None}
    return {}
```

- [ ] **Step 8: Run distribution and trade map tests**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_experimental_distribution.py apps/api/tests/test_experimental_trade_maps.py -q
```

Expected: PASS.

- [ ] **Step 9: Run all experimental backend unit tests**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_experimental_quality.py apps/api/tests/test_experimental_forward.py apps/api/tests/test_experimental_iv_methods.py apps/api/tests/test_experimental_distribution.py apps/api/tests/test_experimental_trade_maps.py -q
```

Expected: PASS.

- [ ] **Step 10: Commit distribution and trade maps**

Run:

```bash
git add apps/api/gammascope_api/experimental/distribution.py apps/api/gammascope_api/experimental/trade_maps.py apps/api/tests/test_experimental_distribution.py apps/api/tests/test_experimental_trade_maps.py
git commit -m "feat: add experimental distribution and trade maps"
```

---

## Task 5: Add Experimental Service And FastAPI Routes

**Files:**
- Create: `apps/api/gammascope_api/experimental/service.py`
- Create: `apps/api/gammascope_api/routes/experimental.py`
- Modify: `apps/api/gammascope_api/main.py`
- Test: `apps/api/tests/test_experimental_service.py`
- Test: `apps/api/tests/test_experimental_routes.py`

- [ ] **Step 1: Write failing service tests**

Create `apps/api/tests/test_experimental_service.py`:

```python
from gammascope_api.contracts.generated.experimental_analytics import ExperimentalAnalytics
from gammascope_api.experimental.service import build_experimental_payload
from gammascope_api.fixtures import load_json_fixture


def test_build_experimental_payload_validates_against_generated_model() -> None:
    snapshot = load_json_fixture("analytics-snapshot.seed.json")

    payload = build_experimental_payload(snapshot, mode="latest")
    validated = ExperimentalAnalytics.model_validate(payload)

    assert validated.schema_version == "1.0.0"
    assert validated.meta.mode.value == "latest"
    assert validated.meta.sourceSessionId == snapshot["session_id"]
    assert validated.forwardSummary.label == "Forward and expected move"
    assert validated.ivSmiles.methods
    assert validated.quoteQuality.score >= 0


def test_build_experimental_payload_returns_partial_panel_when_iv_builder_fails(monkeypatch) -> None:
    snapshot = load_json_fixture("analytics-snapshot.seed.json")

    def explode(*_args, **_kwargs):
        raise RuntimeError("fit failed")

    monkeypatch.setattr("gammascope_api.experimental.service.build_iv_smiles_panel", explode)

    payload = build_experimental_payload(snapshot, mode="latest")

    assert payload["ivSmiles"]["status"] == "error"
    assert payload["forwardSummary"]["status"] in {"ok", "preview", "insufficient_data"}
    ExperimentalAnalytics.model_validate(payload)
```

- [ ] **Step 2: Run service tests to verify failure**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_experimental_service.py -q
```

Expected: FAIL because `service.py` does not exist.

- [ ] **Step 3: Implement experimental service**

Create `apps/api/gammascope_api/experimental/service.py`:

```python
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from gammascope_api.experimental.distribution import probability_panel, skew_tail_panel, terminal_distribution_panel
from gammascope_api.experimental.forward import forward_summary_panel, time_to_expiry_years
from gammascope_api.experimental.iv_methods import build_iv_smiles_panel, smile_diagnostics_panel
from gammascope_api.experimental.models import diagnostic, panel
from gammascope_api.experimental.quality import quote_quality_panel
from gammascope_api.experimental.trade_maps import decay_pressure_panel, move_needed_panel, rich_cheap_panel


ExperimentalMode = Literal["latest", "replay"]


def build_experimental_payload(snapshot: dict[str, Any], *, mode: ExperimentalMode) -> dict[str, Any]:
    tau = time_to_expiry_years(str(snapshot["snapshot_time"]), str(snapshot["expiry"]))
    rows = list(snapshot.get("rows", []))
    source = {
        "spot": float(snapshot["spot"]),
        "forward": float(snapshot["forward"]),
        "rowCount": len(rows),
        "strikeCount": len({float(row["strike"]) for row in rows}),
        "timeToExpiryYears": tau,
    }
    forward = _safe_panel("forwardSummary", lambda: forward_summary_panel(snapshot))
    iv_smiles = _safe_panel("ivSmiles", lambda: build_iv_smiles_panel(snapshot, forward))
    smile_diagnostics = _safe_panel("smileDiagnostics", lambda: smile_diagnostics_panel(iv_smiles, forward=float(forward.get("parityForward") or snapshot["forward"])))
    rate = float(snapshot.get("risk_free_rate") or 0)
    model_forward = float(forward.get("parityForward") or snapshot["forward"])
    expected_move = forward.get("atmStraddle")
    minutes = max(tau * 365 * 24 * 60, 0)

    return {
        "schema_version": "1.0.0",
        "meta": {
            "generatedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "mode": mode,
            "sourceSessionId": str(snapshot["session_id"]),
            "sourceSnapshotTime": str(snapshot["snapshot_time"]),
            "symbol": str(snapshot["symbol"]),
            "expiry": str(snapshot["expiry"]),
        },
        "sourceSnapshot": source,
        "forwardSummary": forward,
        "ivSmiles": iv_smiles,
        "smileDiagnostics": smile_diagnostics,
        "probabilities": _safe_panel("probabilities", lambda: probability_panel(iv_smiles, forward=model_forward, tau=max(tau, 1e-9), rate=rate)),
        "terminalDistribution": _safe_panel("terminalDistribution", lambda: terminal_distribution_panel(iv_smiles, forward=model_forward, tau=max(tau, 1e-9), rate=rate)),
        "skewTail": _safe_panel("skewTail", lambda: skew_tail_panel(iv_smiles, forward=model_forward)),
        "moveNeeded": _safe_panel("moveNeeded", lambda: move_needed_panel(rows, spot=float(snapshot["spot"]), expected_move=expected_move)),
        "decayPressure": _safe_panel("decayPressure", lambda: decay_pressure_panel(rows, minutes_to_expiry=minutes)),
        "richCheap": _safe_panel("richCheap", lambda: rich_cheap_panel(rows, iv_panel=iv_smiles, forward=model_forward, tau=max(tau, 1e-9), rate=rate)),
        "quoteQuality": _safe_panel("quoteQuality", lambda: quote_quality_panel(rows)),
        "historyPreview": panel("insufficient_data", "Range compression preview", [diagnostic("needs_replay_frames", "Select replay frames to compare history.", "info")], rows=[]),
    }


def _safe_panel(name: str, builder):  # type: ignore[no-untyped-def]
    try:
        return builder()
    except Exception as exc:
        return panel(
            "error",
            _label_for(name),
            [diagnostic("panel_error", f"{_label_for(name)} failed: {exc}", "error")],
            **EMPTY_VALUES_BY_PANEL.get(name, {}),
        )


def _label_for(name: str) -> str:
    return {
        "forwardSummary": "Forward and expected move",
        "ivSmiles": "IV smile methods",
        "smileDiagnostics": "Smile diagnostics",
        "probabilities": "Risk-neutral probabilities",
        "terminalDistribution": "Terminal distribution",
        "skewTail": "Skew and tail asymmetry",
        "moveNeeded": "Move-needed map",
        "decayPressure": "Time-decay pressure",
        "richCheap": "Rich/cheap residuals",
        "quoteQuality": "Quote quality",
    }.get(name, name)


EMPTY_VALUES_BY_PANEL = {
    "forwardSummary": {"parityForward": None, "forwardMinusSpot": None, "atmStrike": None, "atmStraddle": None, "expectedRange": None, "expectedMovePercent": None},
    "ivSmiles": {"methods": []},
    "smileDiagnostics": {"ivValley": {"strike": None, "value": None, "label": None}, "atmForwardIv": None, "skewSlope": None, "curvature": None, "methodDisagreement": None},
    "probabilities": {"levels": []},
    "terminalDistribution": {"density": [], "highestDensityZone": None, "range68": None, "range95": None, "leftTailProbability": None, "rightTailProbability": None},
    "skewTail": {"tailBias": None, "leftTailRichness": None, "rightTailRichness": None},
    "moveNeeded": {"rows": []},
    "decayPressure": {"rows": []},
    "richCheap": {"rows": []},
    "quoteQuality": {"score": 0, "flags": []},
}
```

- [ ] **Step 4: Run service tests**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_experimental_service.py -q
```

Expected: PASS.

- [ ] **Step 5: Write failing route tests**

Create `apps/api/tests/test_experimental_routes.py`:

```python
from fastapi.testclient import TestClient

from gammascope_api.contracts.generated.experimental_analytics import ExperimentalAnalytics
from gammascope_api.main import app


client = TestClient(app)


def test_latest_experimental_route_returns_seed_payload() -> None:
    response = client.get("/api/spx/0dte/experimental/latest")

    assert response.status_code == 200
    payload = response.json()
    ExperimentalAnalytics.model_validate(payload)
    assert payload["meta"]["mode"] == "latest"
    assert payload["meta"]["sourceSessionId"] == "seed-spx-2026-04-23"


def test_replay_experimental_route_returns_requested_replay_payload() -> None:
    response = client.get("/api/spx/0dte/experimental/replay/snapshot?session_id=seed-spx-2026-04-23&at=2026-04-23T15:40:00Z")

    assert response.status_code == 200
    payload = response.json()
    ExperimentalAnalytics.model_validate(payload)
    assert payload["meta"]["mode"] == "replay"
    assert payload["meta"]["sourceSnapshotTime"] == "2026-04-23T15:40:00Z"
```

- [ ] **Step 6: Run route tests to verify failure**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_experimental_routes.py -q
```

Expected: FAIL with 404 responses because routes are not registered.

- [ ] **Step 7: Implement FastAPI routes**

Create `apps/api/gammascope_api/routes/experimental.py`:

```python
from __future__ import annotations

from fastapi import APIRouter, Header

from gammascope_api.auth import can_read_live_state
from gammascope_api.experimental.service import build_experimental_payload
from gammascope_api.fixtures import load_json_fixture
from gammascope_api.ingestion.latest_state_cache import cached_or_memory_collector_state
from gammascope_api.ingestion.live_snapshot import build_live_snapshot
from gammascope_api.routes.replay import get_replay_snapshot


router = APIRouter()


@router.get("/api/spx/0dte/experimental/latest")
def get_latest_experimental(x_gammascope_admin_token: str | None = Header(default=None)) -> dict:
    if can_read_live_state(x_gammascope_admin_token):
        live_snapshot = build_live_snapshot(cached_or_memory_collector_state())
        if live_snapshot is not None:
            return build_experimental_payload(live_snapshot, mode="latest")
    return build_experimental_payload(load_json_fixture("analytics-snapshot.seed.json"), mode="latest")


@router.get("/api/spx/0dte/experimental/replay/snapshot")
def get_replay_experimental(
    session_id: str,
    at: str | None = None,
    source_snapshot_id: str | None = None,
) -> dict:
    snapshot = get_replay_snapshot(session_id=session_id, at=at, source_snapshot_id=source_snapshot_id)
    return build_experimental_payload(snapshot, mode="replay")
```

Modify `apps/api/gammascope_api/main.py`:

```python
from gammascope_api.routes import admin, collector, experimental, heatmap, replay, replay_imports, scenario, snapshot, status, stream, views
```

Add after `app.include_router(snapshot.router)`:

```python
app.include_router(experimental.router)
```

- [ ] **Step 8: Run service and route tests**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_experimental_service.py apps/api/tests/test_experimental_routes.py -q
```

Expected: PASS.

- [ ] **Step 9: Run focused backend experimental suite**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_experimental_quality.py apps/api/tests/test_experimental_forward.py apps/api/tests/test_experimental_iv_methods.py apps/api/tests/test_experimental_distribution.py apps/api/tests/test_experimental_trade_maps.py apps/api/tests/test_experimental_service.py apps/api/tests/test_experimental_routes.py -q
```

Expected: PASS.

- [ ] **Step 10: Commit service and routes**

Run:

```bash
git add apps/api/gammascope_api/experimental/service.py apps/api/gammascope_api/routes/experimental.py apps/api/gammascope_api/main.py apps/api/tests/test_experimental_service.py apps/api/tests/test_experimental_routes.py
git commit -m "feat: add experimental analytics api"
```

---

## Task 6: Add Next.js Experimental Proxy And Client Source

**Files:**
- Modify: `apps/web/lib/contracts.ts`
- Create: `apps/web/lib/clientExperimentalSource.ts`
- Create: `apps/web/lib/experimentalFormat.ts`
- Create: `apps/web/app/api/spx/0dte/experimental/latest/route.ts`
- Create: `apps/web/app/api/spx/0dte/experimental/replay/snapshot/route.ts`
- Test: `apps/web/tests/clientExperimentalSource.test.ts`
- Test: `apps/web/tests/experimentalFormat.test.ts`
- Test: `apps/web/tests/experimentalRoute.test.ts`
- Test: `apps/web/tests/experimentalReplayRoute.test.ts`

- [ ] **Step 1: Export experimental contract type**

Modify `apps/web/lib/contracts.ts`:

```ts
export type { AnalyticsSnapshot } from "@gammascope/contracts/analytics-snapshot";
export type { ExperimentalAnalytics } from "@gammascope/contracts/experimental-analytics";
```

- [ ] **Step 2: Write failing client source tests**

Create `apps/web/tests/clientExperimentalSource.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { loadClientExperimentalLatest, loadClientExperimentalReplaySnapshot, isExperimentalAnalytics } from "../lib/clientExperimentalSource";

const payload = {
  schema_version: "1.0.0",
  meta: {
    generatedAt: "2026-04-23T16:00:00Z",
    mode: "latest",
    sourceSessionId: "seed-spx-2026-04-23",
    sourceSnapshotTime: "2026-04-23T16:00:00Z",
    symbol: "SPX",
    expiry: "2026-04-23"
  },
  sourceSnapshot: { spot: 5200.25, forward: 5200.36, rowCount: 34, strikeCount: 17, timeToExpiryYears: 0.01 },
  forwardSummary: { status: "ok", label: "Forward", diagnostics: [], parityForward: 5200.36, forwardMinusSpot: 0.11, atmStrike: 5200, atmStraddle: 18.75, expectedRange: { lower: 5181.61, upper: 5219.11 }, expectedMovePercent: 0.0036 },
  ivSmiles: { status: "preview", label: "IV", diagnostics: [], methods: [] },
  smileDiagnostics: { status: "preview", label: "Smile", diagnostics: [], ivValley: { strike: null, value: null, label: null }, atmForwardIv: null, skewSlope: null, curvature: null, methodDisagreement: null },
  probabilities: { status: "preview", label: "Probabilities", diagnostics: [], levels: [] },
  terminalDistribution: { status: "preview", label: "Distribution", diagnostics: [], density: [], highestDensityZone: null, range68: null, range95: null, leftTailProbability: null, rightTailProbability: null },
  skewTail: { status: "preview", label: "Skew", diagnostics: [], tailBias: null, leftTailRichness: null, rightTailRichness: null },
  moveNeeded: { status: "ok", label: "Move", diagnostics: [], rows: [] },
  decayPressure: { status: "preview", label: "Decay", diagnostics: [], rows: [] },
  richCheap: { status: "preview", label: "Residuals", diagnostics: [], rows: [] },
  quoteQuality: { status: "ok", label: "Quality", diagnostics: [], score: 1, flags: [] },
  historyPreview: { status: "insufficient_data", label: "History", diagnostics: [], rows: [] }
};

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

describe("client experimental source", () => {
  it("validates an experimental payload", () => {
    expect(isExperimentalAnalytics(payload)).toBe(true);
    expect(isExperimentalAnalytics({ ...payload, quoteQuality: { score: 1 } })).toBe(false);
  });

  it("loads latest experimental analytics without caching", async () => {
    const fetcher = vi.fn(async () => jsonResponse(payload));

    await expect(loadClientExperimentalLatest({ fetcher })).resolves.toEqual(payload);
    expect(fetcher).toHaveBeenCalledWith("/api/spx/0dte/experimental/latest", {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
  });

  it("loads replay experimental analytics with source snapshot id", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ ...payload, meta: { ...payload.meta, mode: "replay" } }));

    await loadClientExperimentalReplaySnapshot({ session_id: "session/a", at: "2026-04-23T15:40:00Z", source_snapshot_id: "snap-1" }, { fetcher });

    expect(fetcher).toHaveBeenCalledWith("/api/spx/0dte/experimental/replay/snapshot?session_id=session%2Fa&at=2026-04-23T15%3A40%3A00Z&source_snapshot_id=snap-1", {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
  });

  it("returns null for invalid payloads", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ ...payload, schema_version: "0.0.0" }));

    await expect(loadClientExperimentalLatest({ fetcher })).resolves.toBeNull();
  });
});
```

- [ ] **Step 3: Run client source tests to verify failure**

Run:

```bash
pnpm --filter @gammascope/web test -- --run tests/clientExperimentalSource.test.ts
```

Expected: FAIL because `clientExperimentalSource.ts` does not exist.

- [ ] **Step 4: Implement client experimental source**

Create `apps/web/lib/clientExperimentalSource.ts`:

```ts
import type { ExperimentalAnalytics } from "./contracts";

const EXPERIMENTAL_LATEST_PATH = "/api/spx/0dte/experimental/latest";
const EXPERIMENTAL_REPLAY_PATH = "/api/spx/0dte/experimental/replay/snapshot";

type ExperimentalFetcher = (input: string, init: RequestInit) => Promise<Response>;

interface LoadOptions {
  fetcher?: ExperimentalFetcher;
}

export interface ExperimentalReplayRequest {
  session_id: string;
  at?: string;
  source_snapshot_id?: string;
}

export async function loadClientExperimentalLatest(options: LoadOptions = {}): Promise<ExperimentalAnalytics | null> {
  return loadExperimental(EXPERIMENTAL_LATEST_PATH, options);
}

export async function loadClientExperimentalReplaySnapshot(
  request: ExperimentalReplayRequest,
  options: LoadOptions = {}
): Promise<ExperimentalAnalytics | null> {
  const params = new URLSearchParams({ session_id: request.session_id });
  if (request.at) {
    params.set("at", request.at);
  }
  if (request.source_snapshot_id) {
    params.set("source_snapshot_id", request.source_snapshot_id);
  }
  return loadExperimental(`${EXPERIMENTAL_REPLAY_PATH}?${params.toString()}`, options);
}

async function loadExperimental(path: string, options: LoadOptions): Promise<ExperimentalAnalytics | null> {
  const fetcher = options.fetcher ?? fetch;
  try {
    const response = await fetcher(path, {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    return isExperimentalAnalytics(payload) ? payload : null;
  } catch {
    return null;
  }
}

export function isExperimentalAnalytics(payload: unknown): payload is ExperimentalAnalytics {
  if (!isRecord(payload)) {
    return false;
  }
  return (
    payload.schema_version === "1.0.0" &&
    isRecord(payload.meta) &&
    (payload.meta.mode === "latest" || payload.meta.mode === "replay") &&
    payload.meta.symbol === "SPX" &&
    isRecord(payload.sourceSnapshot) &&
    isPanel(payload.forwardSummary) &&
    isIvSmiles(payload.ivSmiles) &&
    isPanel(payload.smileDiagnostics) &&
    isPanel(payload.probabilities) &&
    isPanel(payload.terminalDistribution) &&
    isPanel(payload.skewTail) &&
    isPanel(payload.moveNeeded) &&
    isPanel(payload.decayPressure) &&
    isPanel(payload.richCheap) &&
    isQuoteQuality(payload.quoteQuality) &&
    isPanel(payload.historyPreview)
  );
}

function isPanel(value: unknown): value is { status: string; label: string; diagnostics: unknown[] } {
  return isRecord(value) && isStatus(value.status) && typeof value.label === "string" && Array.isArray(value.diagnostics);
}

function isIvSmiles(value: unknown): boolean {
  return isPanel(value) && Array.isArray(value.methods);
}

function isQuoteQuality(value: unknown): boolean {
  return isPanel(value) && typeof value.score === "number" && Number.isFinite(value.score) && Array.isArray(value.flags);
}

function isStatus(value: unknown): boolean {
  return value === "ok" || value === "preview" || value === "insufficient_data" || value === "error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
```

- [ ] **Step 5: Add formatter tests**

Create `apps/web/tests/experimentalFormat.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatExperimentalNumber, formatExperimentalPercent, panelStatusDisplay } from "../lib/experimentalFormat";

describe("experimental format helpers", () => {
  it("formats numbers and percentages with null fallbacks", () => {
    expect(formatExperimentalNumber(12.3456, 2)).toBe("12.35");
    expect(formatExperimentalNumber(null)).toBe("—");
    expect(formatExperimentalPercent(0.1234)).toBe("12.34%");
  });

  it("maps panel statuses to display tones", () => {
    expect(panelStatusDisplay("ok")).toEqual({ label: "OK", tone: "ok" });
    expect(panelStatusDisplay("preview")).toEqual({ label: "Preview", tone: "warning" });
    expect(panelStatusDisplay("insufficient_data")).toEqual({ label: "Insufficient data", tone: "muted" });
    expect(panelStatusDisplay("error")).toEqual({ label: "Error", tone: "error" });
  });
});
```

- [ ] **Step 6: Implement format helpers**

Create `apps/web/lib/experimentalFormat.ts`:

```ts
import type { ExperimentalAnalytics } from "./contracts";

export type PanelStatus = ExperimentalAnalytics["forwardSummary"]["status"];
export type PanelTone = "ok" | "warning" | "muted" | "error";

export function panelStatusDisplay(status: PanelStatus): { label: string; tone: PanelTone } {
  if (status === "ok") {
    return { label: "OK", tone: "ok" };
  }
  if (status === "preview") {
    return { label: "Preview", tone: "warning" };
  }
  if (status === "insufficient_data") {
    return { label: "Insufficient data", tone: "muted" };
  }
  return { label: "Error", tone: "error" };
}

export function formatExperimentalNumber(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatExperimentalPercent(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatExperimentalRange(range: { lower: number; upper: number } | null | undefined): string {
  if (!range) {
    return "—";
  }
  return `${formatExperimentalNumber(range.lower)} - ${formatExperimentalNumber(range.upper)}`;
}
```

- [ ] **Step 7: Run client and formatter tests**

Run:

```bash
pnpm --filter @gammascope/web test -- --run tests/clientExperimentalSource.test.ts tests/experimentalFormat.test.ts
```

Expected: PASS.

- [ ] **Step 8: Write failing Next proxy route tests**

Create `apps/web/tests/experimentalRoute.test.ts`:

```ts
import { describe, expect, it, vi, afterEach } from "vitest";

describe("GET /api/spx/0dte/experimental/latest", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("forwards latest experimental analytics without caching", async () => {
    vi.stubEnv("GAMMASCOPE_API_BASE_URL", "http://fastapi.local:9000/");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const { GET } = await import("../app/api/spx/0dte/experimental/latest/route");
    const response = await GET(new Request("http://web.local/api/spx/0dte/experimental/latest"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetch).toHaveBeenCalledWith("http://fastapi.local:9000/api/spx/0dte/experimental/latest", {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
  });
});
```

Create `apps/web/tests/experimentalReplayRoute.test.ts`:

```ts
import { describe, expect, it, vi, afterEach } from "vitest";

describe("GET /api/spx/0dte/experimental/replay/snapshot", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("forwards replay experimental query params without caching", async () => {
    vi.stubEnv("GAMMASCOPE_API_BASE_URL", "http://fastapi.local:9000/");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const { GET } = await import("../app/api/spx/0dte/experimental/replay/snapshot/route");
    const response = await GET(new Request("http://web.local/api/spx/0dte/experimental/replay/snapshot?session_id=seed&at=2026-04-23T15:40:00Z&source_snapshot_id=snap-a"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetch).toHaveBeenCalledWith("http://fastapi.local:9000/api/spx/0dte/experimental/replay/snapshot?session_id=seed&at=2026-04-23T15%3A40%3A00Z&source_snapshot_id=snap-a", {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
  });
});
```

- [ ] **Step 9: Run proxy route tests to verify failure**

Run:

```bash
pnpm --filter @gammascope/web test -- --run tests/experimentalRoute.test.ts tests/experimentalReplayRoute.test.ts
```

Expected: FAIL because the route files do not exist.

- [ ] **Step 10: Implement Next proxy routes**

Create `apps/web/app/api/spx/0dte/experimental/latest/route.ts`:

```ts
const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
const EXPERIMENTAL_LATEST_PATH = "/api/spx/0dte/experimental/latest";

function noStoreJson(payload: unknown, init?: ResponseInit) {
  const response = Response.json(payload, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(_request: Request): Promise<Response> {
  const apiBaseUrl = process.env.GAMMASCOPE_API_BASE_URL ?? DEFAULT_API_BASE_URL;
  try {
    const upstream = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}${EXPERIMENTAL_LATEST_PATH}`, {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    const response = new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" }
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return noStoreJson({ error: "Experimental analytics unavailable" }, { status: 502 });
  }
}
```

Create `apps/web/app/api/spx/0dte/experimental/replay/snapshot/route.ts`:

```ts
const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
const EXPERIMENTAL_REPLAY_PATH = "/api/spx/0dte/experimental/replay/snapshot";

function experimentalReplayUrl(apiBaseUrl: string, requestUrl: string): string {
  const sourceUrl = new URL(requestUrl);
  const params = new URLSearchParams();
  for (const key of ["session_id", "at", "source_snapshot_id"]) {
    const value = sourceUrl.searchParams.get(key);
    if (value) {
      params.set(key, value);
    }
  }
  return `${apiBaseUrl.replace(/\/+$/, "")}${EXPERIMENTAL_REPLAY_PATH}?${params.toString()}`;
}

function noStoreJson(payload: unknown, init?: ResponseInit) {
  const response = Response.json(payload, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: Request): Promise<Response> {
  const apiBaseUrl = process.env.GAMMASCOPE_API_BASE_URL ?? DEFAULT_API_BASE_URL;
  try {
    const upstream = await fetch(experimentalReplayUrl(apiBaseUrl, request.url), {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    const response = new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" }
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return noStoreJson({ error: "Experimental replay analytics unavailable" }, { status: 502 });
  }
}
```

- [ ] **Step 11: Run web data-layer tests**

Run:

```bash
pnpm --filter @gammascope/web test -- --run tests/clientExperimentalSource.test.ts tests/experimentalFormat.test.ts tests/experimentalRoute.test.ts tests/experimentalReplayRoute.test.ts
```

Expected: PASS.

- [ ] **Step 12: Commit web data layer**

Run:

```bash
git add apps/web/lib/contracts.ts apps/web/lib/clientExperimentalSource.ts apps/web/lib/experimentalFormat.ts apps/web/app/api/spx/0dte/experimental apps/web/tests/clientExperimentalSource.test.ts apps/web/tests/experimentalFormat.test.ts apps/web/tests/experimentalRoute.test.ts apps/web/tests/experimentalReplayRoute.test.ts
git commit -m "feat: add experimental web data layer"
```

---

## Task 7: Add Experimental Page, Modular Panels, And Navigation

**Files:**
- Create: `apps/web/app/experimental/page.tsx`
- Create: `apps/web/components/ExperimentalDashboard.tsx`
- Create: `apps/web/components/experimental/ExperimentalPanel.tsx`
- Create: `apps/web/components/experimental/ExperimentalSmileChart.tsx`
- Create: `apps/web/components/experimental/ExperimentalSummaryPanels.tsx`
- Create: `apps/web/components/experimental/ExperimentalTables.tsx`
- Modify: `apps/web/components/DashboardView.tsx`
- Modify: `apps/web/components/ExposureHeatmap.tsx`
- Test: `apps/web/tests/ExperimentalPage.test.tsx`
- Test: `apps/web/tests/ExperimentalDashboard.test.tsx`
- Modify: `apps/web/tests/DashboardView.test.tsx`
- Modify: `apps/web/tests/ExposureHeatmap.test.tsx`

- [ ] **Step 1: Write failing page test**

Create `apps/web/tests/ExperimentalPage.test.tsx`:

```tsx
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  dashboardProps: vi.fn(),
  initialPayload: {
    schema_version: "1.0.0",
    meta: { mode: "latest", sourceSessionId: "seed", sourceSnapshotTime: "2026-04-23T16:00:00Z", generatedAt: "2026-04-23T16:00:01Z", symbol: "SPX", expiry: "2026-04-23" },
    sourceSnapshot: { spot: 5200, forward: 5201, rowCount: 2, strikeCount: 1, timeToExpiryYears: 0.01 },
    forwardSummary: { status: "ok", label: "Forward", diagnostics: [], parityForward: 5201, forwardMinusSpot: 1, atmStrike: 5200, atmStraddle: 20, expectedRange: { lower: 5181, upper: 5221 }, expectedMovePercent: 0.0038 },
    ivSmiles: { status: "preview", label: "IV", diagnostics: [], methods: [] },
    smileDiagnostics: { status: "preview", label: "Smile", diagnostics: [], ivValley: { strike: null, value: null, label: null }, atmForwardIv: null, skewSlope: null, curvature: null, methodDisagreement: null },
    probabilities: { status: "preview", label: "Probabilities", diagnostics: [], levels: [] },
    terminalDistribution: { status: "preview", label: "Distribution", diagnostics: [], density: [], highestDensityZone: null, range68: null, range95: null, leftTailProbability: null, rightTailProbability: null },
    skewTail: { status: "preview", label: "Skew", diagnostics: [], tailBias: null, leftTailRichness: null, rightTailRichness: null },
    moveNeeded: { status: "ok", label: "Move", diagnostics: [], rows: [] },
    decayPressure: { status: "preview", label: "Decay", diagnostics: [], rows: [] },
    richCheap: { status: "preview", label: "Residuals", diagnostics: [], rows: [] },
    quoteQuality: { status: "ok", label: "Quality", diagnostics: [], score: 1, flags: [] },
    historyPreview: { status: "insufficient_data", label: "History", diagnostics: [], rows: [] }
  }
}));

vi.mock("../components/ExperimentalDashboard", () => ({
  ExperimentalDashboard: (props: unknown) => {
    mocks.dashboardProps(props);
    return <div>Experimental dashboard shell</div>;
  }
}));

describe("ExperimentalPage", () => {
  it("loads and renders the experimental dashboard shell", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(mocks.initialPayload), { status: 200, headers: { "Content-Type": "application/json" } })));
    vi.stubGlobal("React", React);

    const { default: ExperimentalPage } = await import("../app/experimental/page");
    const page = await ExperimentalPage();

    expect(renderToStaticMarkup(page)).toContain("Experimental dashboard shell");
    expect(mocks.dashboardProps).toHaveBeenCalledWith({ initialPayload: mocks.initialPayload });
  });
});
```

- [ ] **Step 2: Run page test to verify failure**

Run:

```bash
pnpm --filter @gammascope/web test -- --run tests/ExperimentalPage.test.tsx
```

Expected: FAIL because `apps/web/app/experimental/page.tsx` does not exist.

- [ ] **Step 3: Implement page route**

Create `apps/web/app/experimental/page.tsx`:

```tsx
import { ExperimentalDashboard } from "../../components/ExperimentalDashboard";
import { loadClientExperimentalLatest } from "../../lib/clientExperimentalSource";

export default async function ExperimentalPage() {
  const initialPayload = await loadClientExperimentalLatest({
    fetcher: (input, init) => fetch(input, init)
  });

  return <ExperimentalDashboard initialPayload={initialPayload} />;
}
```

- [ ] **Step 4: Write failing dashboard render test**

Create `apps/web/tests/ExperimentalDashboard.test.tsx`:

```tsx
import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ExperimentalDashboard } from "../components/ExperimentalDashboard";
import type { ExperimentalAnalytics } from "../lib/contracts";

const payload = {
  schema_version: "1.0.0",
  meta: { mode: "latest", sourceSessionId: "seed", sourceSnapshotTime: "2026-04-23T16:00:00Z", generatedAt: "2026-04-23T16:00:01Z", symbol: "SPX", expiry: "2026-04-23" },
  sourceSnapshot: { spot: 5200, forward: 5201, rowCount: 2, strikeCount: 1, timeToExpiryYears: 0.01 },
  forwardSummary: { status: "ok", label: "Forward and expected move", diagnostics: [], parityForward: 5201, forwardMinusSpot: 1, atmStrike: 5200, atmStraddle: 20, expectedRange: { lower: 5181, upper: 5221 }, expectedMovePercent: 0.0038 },
  ivSmiles: { status: "preview", label: "IV smile methods", diagnostics: [], methods: [{ key: "custom_iv", label: "Current custom IV", status: "ok", points: [{ x: 5200, y: 0.2 }] }] },
  smileDiagnostics: { status: "preview", label: "Smile diagnostics", diagnostics: [], ivValley: { strike: 5200, value: 0.18, label: "Spline valley" }, atmForwardIv: 0.18, skewSlope: -0.01, curvature: 0.02, methodDisagreement: 0.01 },
  probabilities: { status: "preview", label: "Risk-neutral probabilities", diagnostics: [], levels: [{ strike: 5200, closeAbove: 0.52, closeBelow: 0.48 }] },
  terminalDistribution: { status: "preview", label: "Terminal distribution", diagnostics: [], density: [{ x: 5200, y: 0.04 }], highestDensityZone: "5195-5205", range68: "5181-5221", range95: "5160-5240", leftTailProbability: 0.08, rightTailProbability: 0.06 },
  skewTail: { status: "preview", label: "Skew and tail asymmetry", diagnostics: [], tailBias: "Left-tail rich", leftTailRichness: 1.2, rightTailRichness: 0.9 },
  moveNeeded: { status: "ok", label: "Move-needed map", diagnostics: [], rows: [{ strike: 5210, side: "call", breakeven: 5214, moveNeeded: 14, expectedMoveRatio: 0.7, label: "Within expected move" }] },
  decayPressure: { status: "preview", label: "Time-decay pressure", diagnostics: [], rows: [{ strike: 5210, side: "call", premium: 4, pointsPerMinute: 0.2 }] },
  richCheap: { status: "preview", label: "Rich/cheap residuals", diagnostics: [], rows: [{ strike: 5210, side: "call", actualMid: 4, fittedFair: 3.8, residual: 0.2, label: "Rich" }] },
  quoteQuality: { status: "ok", label: "Quote quality", diagnostics: [], score: 0.95, flags: [{ strike: 5120, right: "put", code: "zero_bid", message: "Bid is zero." }] },
  historyPreview: { status: "insufficient_data", label: "Range compression preview", diagnostics: [{ code: "needs_replay", message: "Select replay frames.", severity: "info" }], rows: [] }
} satisfies ExperimentalAnalytics;

describe("ExperimentalDashboard", () => {
  it("renders dense experimental panels at once", () => {
    const markup = renderToStaticMarkup(<ExperimentalDashboard initialPayload={payload} />);

    expect(markup).toContain("GammaScope");
    expect(markup).toContain("Experimental");
    expect(markup).toContain("Forward and expected move");
    expect(markup).toContain("IV smile methods");
    expect(markup).toContain("Smile diagnostics");
    expect(markup).toContain("Risk-neutral probabilities");
    expect(markup).toContain("Terminal distribution");
    expect(markup).toContain("Skew and tail asymmetry");
    expect(markup).toContain("Move-needed map");
    expect(markup).toContain("Time-decay pressure");
    expect(markup).toContain("Rich/cheap residuals");
    expect(markup).toContain("Quote quality");
    expect(markup).toContain("Range compression preview");
  });

  it("renders an empty state when the initial payload is unavailable", () => {
    const markup = renderToStaticMarkup(<ExperimentalDashboard initialPayload={null} />);

    expect(markup).toContain("Experimental analytics unavailable");
  });
});
```

- [ ] **Step 5: Run dashboard test to verify failure**

Run:

```bash
pnpm --filter @gammascope/web test -- --run tests/ExperimentalDashboard.test.tsx
```

Expected: FAIL because `ExperimentalDashboard` does not exist.

- [ ] **Step 6: Implement reusable panel wrapper**

Create `apps/web/components/experimental/ExperimentalPanel.tsx`:

```tsx
import React from "react";
import type { ExperimentalAnalytics } from "../../lib/contracts";
import { panelStatusDisplay } from "../../lib/experimentalFormat";

type PanelStatus = ExperimentalAnalytics["forwardSummary"]["status"];

interface ExperimentalPanelProps {
  title: string;
  status: PanelStatus;
  children: React.ReactNode;
  diagnostics?: Array<{ code: string; message: string; severity?: string }>;
}

export function ExperimentalPanel({ title, status, diagnostics = [], children }: ExperimentalPanelProps) {
  const display = panelStatusDisplay(status);
  return (
    <section className="experimentalPanel" aria-label={title}>
      <div className="experimentalPanelHeader">
        <h2>{title}</h2>
        <span className={`experimentalStatus experimentalStatus-${display.tone}`}>{display.label}</span>
      </div>
      <div className="experimentalPanelBody">{children}</div>
      {diagnostics.length > 0 ? (
        <ul className="experimentalDiagnostics" aria-label={`${title} diagnostics`}>
          {diagnostics.slice(0, 3).map((diagnostic) => (
            <li key={`${diagnostic.code}-${diagnostic.message}`}>{diagnostic.message}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 7: Implement chart and panel components**

Create `apps/web/components/experimental/ExperimentalSmileChart.tsx`:

```tsx
import React from "react";

interface Point {
  x: number;
  y: number | null;
}

interface Series {
  key: string;
  label: string;
  points: Point[];
}

const FRAME = { width: 520, height: 220, padding: 32 };

export function ExperimentalSmileChart({ series }: { series: Series[] }) {
  const points = series.flatMap((item) => item.points).filter((point): point is { x: number; y: number } => point.y != null);
  if (points.length === 0) {
    return <div className="experimentalEmpty">No chart points available</div>;
  }
  return (
    <svg className="experimentalChart" viewBox={`0 0 ${FRAME.width} ${FRAME.height}`} role="img" aria-label="Experimental chart">
      {series.map((item, index) => (
        <path key={item.key} className={`experimentalChartSeries experimentalChartSeries-${index % 6}`} d={pathFor(item.points, points)} />
      ))}
    </svg>
  );
}

function pathFor(seriesPoints: Point[], domainPoints: Array<{ x: number; y: number }>): string {
  return seriesPoints
    .filter((point): point is { x: number; y: number } => point.y != null)
    .map((point, index) => {
      const projected = project(point, domainPoints);
      return `${index === 0 ? "M" : "L"} ${projected.x.toFixed(2)} ${projected.y.toFixed(2)}`;
    })
    .join(" ");
}

function project(point: { x: number; y: number }, domainPoints: Array<{ x: number; y: number }>) {
  const minX = Math.min(...domainPoints.map((item) => item.x));
  const maxX = Math.max(...domainPoints.map((item) => item.x));
  const minY = Math.min(...domainPoints.map((item) => item.y));
  const maxY = Math.max(...domainPoints.map((item) => item.y));
  return {
    x: FRAME.padding + ratio(point.x, minX, maxX) * (FRAME.width - FRAME.padding * 2),
    y: FRAME.height - FRAME.padding - ratio(point.y, minY, maxY) * (FRAME.height - FRAME.padding * 2)
  };
}

function ratio(value: number, min: number, max: number): number {
  return min === max ? 0.5 : (value - min) / (max - min);
}
```

Create `apps/web/components/experimental/ExperimentalSummaryPanels.tsx`:

```tsx
import React from "react";
import type { ExperimentalAnalytics } from "../../lib/contracts";
import { formatExperimentalNumber, formatExperimentalPercent, formatExperimentalRange } from "../../lib/experimentalFormat";
import { ExperimentalPanel } from "./ExperimentalPanel";
import { ExperimentalSmileChart } from "./ExperimentalSmileChart";

export function ExperimentalKpis({ payload }: { payload: ExperimentalAnalytics }) {
  return (
    <section className="experimentalKpiGrid" aria-label="Experimental summary">
      <Kpi label="Parity forward" value={formatExperimentalNumber(payload.forwardSummary.parityForward)} />
      <Kpi label="Forward - spot" value={formatExperimentalNumber(payload.forwardSummary.forwardMinusSpot)} />
      <Kpi label="ATM straddle" value={formatExperimentalNumber(payload.forwardSummary.atmStraddle)} />
      <Kpi label="Expected range" value={formatExperimentalRange(payload.forwardSummary.expectedRange)} />
      <Kpi label="Expected move" value={formatExperimentalPercent(payload.forwardSummary.expectedMovePercent)} />
      <Kpi label="Quote quality" value={formatExperimentalPercent(payload.quoteQuality.score, 0)} />
    </section>
  );
}

export function ForwardPanel({ payload }: { payload: ExperimentalAnalytics }) {
  const panel = payload.forwardSummary;
  return (
    <ExperimentalPanel title={panel.label} status={panel.status} diagnostics={panel.diagnostics}>
      <dl className="experimentalDefinitionGrid">
        <dt>ATM strike</dt><dd>{formatExperimentalNumber(panel.atmStrike, 0)}</dd>
        <dt>Expected range</dt><dd>{formatExperimentalRange(panel.expectedRange)}</dd>
        <dt>Expected move</dt><dd>{formatExperimentalPercent(panel.expectedMovePercent)}</dd>
      </dl>
    </ExperimentalPanel>
  );
}

export function SmilePanel({ payload }: { payload: ExperimentalAnalytics }) {
  return (
    <ExperimentalPanel title={payload.ivSmiles.label} status={payload.ivSmiles.status} diagnostics={payload.ivSmiles.diagnostics}>
      <ExperimentalSmileChart series={payload.ivSmiles.methods} />
      <div className="experimentalLegend">
        {payload.ivSmiles.methods.map((method) => <span key={method.key}>{method.label}</span>)}
      </div>
    </ExperimentalPanel>
  );
}

export function DiagnosticsPanel({ payload }: { payload: ExperimentalAnalytics }) {
  const panel = payload.smileDiagnostics;
  return (
    <ExperimentalPanel title={panel.label} status={panel.status} diagnostics={panel.diagnostics}>
      <dl className="experimentalDefinitionGrid">
        <dt>IV valley</dt><dd>{formatExperimentalNumber(panel.ivValley.value ? panel.ivValley.strike : null, 0)}</dd>
        <dt>ATM-forward IV</dt><dd>{formatExperimentalPercent(panel.atmForwardIv)}</dd>
        <dt>Skew slope</dt><dd>{formatExperimentalNumber(panel.skewSlope, 4)}</dd>
        <dt>Curvature</dt><dd>{formatExperimentalNumber(panel.curvature, 4)}</dd>
      </dl>
    </ExperimentalPanel>
  );
}

export function DistributionPanel({ payload }: { payload: ExperimentalAnalytics }) {
  const panel = payload.terminalDistribution;
  return (
    <ExperimentalPanel title={panel.label} status={panel.status} diagnostics={panel.diagnostics}>
      <ExperimentalSmileChart series={[{ key: "density", label: "Density", points: panel.density }]} />
      <dl className="experimentalDefinitionGrid">
        <dt>Highest density</dt><dd>{panel.highestDensityZone ?? "—"}</dd>
        <dt>68% range</dt><dd>{panel.range68 ?? "—"}</dd>
        <dt>95% range</dt><dd>{panel.range95 ?? "—"}</dd>
      </dl>
    </ExperimentalPanel>
  );
}

export function SkewTailPanel({ payload }: { payload: ExperimentalAnalytics }) {
  const panel = payload.skewTail;
  return (
    <ExperimentalPanel title={panel.label} status={panel.status} diagnostics={panel.diagnostics}>
      <strong>{panel.tailBias ?? "—"}</strong>
      <dl className="experimentalDefinitionGrid">
        <dt>Left richness</dt><dd>{formatExperimentalNumber(panel.leftTailRichness)}</dd>
        <dt>Right richness</dt><dd>{formatExperimentalNumber(panel.rightTailRichness)}</dd>
      </dl>
    </ExperimentalPanel>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}
```

Create `apps/web/components/experimental/ExperimentalTables.tsx`:

```tsx
import React from "react";
import type { ExperimentalAnalytics } from "../../lib/contracts";
import { formatExperimentalNumber, formatExperimentalPercent } from "../../lib/experimentalFormat";
import { ExperimentalPanel } from "./ExperimentalPanel";

export function ProbabilityPanel({ payload }: { payload: ExperimentalAnalytics }) {
  const panel = payload.probabilities;
  return (
    <ExperimentalPanel title={panel.label} status={panel.status} diagnostics={panel.diagnostics}>
      <SimpleTable headers={["Strike", "Above", "Below"]} rows={panel.levels.slice(0, 8).map((row) => [formatExperimentalNumber(row.strike, 0), formatExperimentalPercent(row.closeAbove), formatExperimentalPercent(row.closeBelow)])} />
    </ExperimentalPanel>
  );
}

export function MoveNeededPanel({ payload }: { payload: ExperimentalAnalytics }) {
  return <RowsPanel title={payload.moveNeeded.label} status={payload.moveNeeded.status} diagnostics={payload.moveNeeded.diagnostics} rows={payload.moveNeeded.rows} />;
}

export function DecayPanel({ payload }: { payload: ExperimentalAnalytics }) {
  return <RowsPanel title={payload.decayPressure.label} status={payload.decayPressure.status} diagnostics={payload.decayPressure.diagnostics} rows={payload.decayPressure.rows} />;
}

export function ResidualPanel({ payload }: { payload: ExperimentalAnalytics }) {
  return <RowsPanel title={payload.richCheap.label} status={payload.richCheap.status} diagnostics={payload.richCheap.diagnostics} rows={payload.richCheap.rows} />;
}

export function QualityPanel({ payload }: { payload: ExperimentalAnalytics }) {
  const panel = payload.quoteQuality;
  return (
    <ExperimentalPanel title={panel.label} status={panel.status} diagnostics={panel.diagnostics}>
      <p className="experimentalLargeValue">{formatExperimentalPercent(panel.score, 0)}</p>
      <SimpleTable headers={["Strike", "Side", "Flag"]} rows={panel.flags.slice(0, 8).map((flag) => [formatExperimentalNumber(flag.strike, 0), flag.right, flag.message])} />
    </ExperimentalPanel>
  );
}

export function HistoryPanel({ payload }: { payload: ExperimentalAnalytics }) {
  return <RowsPanel title={payload.historyPreview.label} status={payload.historyPreview.status} diagnostics={payload.historyPreview.diagnostics} rows={payload.historyPreview.rows} />;
}

function RowsPanel({ title, status, diagnostics, rows }: { title: string; status: ExperimentalAnalytics["forwardSummary"]["status"]; diagnostics: ExperimentalAnalytics["forwardSummary"]["diagnostics"]; rows: Array<Record<string, unknown>> }) {
  return (
    <ExperimentalPanel title={title} status={status} diagnostics={diagnostics}>
      <SimpleTable headers={["Strike", "Detail", "Label"]} rows={rows.slice(0, 8).map((row) => [formatExperimentalNumber(row.strike as number, 0), String(row.side ?? row.code ?? row.residual ?? "—"), String(row.label ?? row.message ?? "—")])} />
    </ExperimentalPanel>
  );
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  if (rows.length === 0) {
    return <div className="experimentalEmpty">No rows available</div>;
  }
  return (
    <table className="experimentalTable">
      <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
    </table>
  );
}
```

- [ ] **Step 8: Implement dashboard shell**

Create `apps/web/components/ExperimentalDashboard.tsx`:

```tsx
"use client";

import React, { useState } from "react";
import type { ExperimentalAnalytics } from "../lib/contracts";
import { ThemeToggle } from "./ThemeToggle";
import {
  DiagnosticsPanel,
  DistributionPanel,
  ExperimentalKpis,
  ForwardPanel,
  SkewTailPanel,
  SmilePanel
} from "./experimental/ExperimentalSummaryPanels";
import {
  DecayPanel,
  HistoryPanel,
  MoveNeededPanel,
  ProbabilityPanel,
  QualityPanel,
  ResidualPanel
} from "./experimental/ExperimentalTables";

interface ExperimentalDashboardProps {
  initialPayload: ExperimentalAnalytics | null;
}

export function ExperimentalDashboard({ initialPayload }: ExperimentalDashboardProps) {
  const [payload] = useState(initialPayload);

  return (
    <main className="dashboardShell experimentalShell">
      <header className="topBar">
        <div className="topBarPrimary">
          <div className="brandLockup">
            <div className="scopeMark" aria-hidden="true" />
            <div>
              <h1>GammaScope</h1>
              <p>Experimental 0DTE research</p>
            </div>
          </div>
          <nav className="topNavTabs" aria-label="Dashboard views">
            <a className="topNavTab" href="/">Realtime</a>
            <a className="topNavTab" href="/replay">Replay</a>
            <a className="topNavTab" href="/heatmap">Heatmap</a>
            <a className="topNavTab topNavTab-active" href="/experimental" aria-current="page">Experimental</a>
          </nav>
        </div>
        <div className="topBarUtility"><ThemeToggle /></div>
      </header>

      {payload ? (
        <>
          <section className="experimentalControlStrip" aria-label="Experimental controls">
            <span>{payload.meta.mode === "replay" ? "Replay frame" : "Latest snapshot"}</span>
            <span>{payload.meta.sourceSessionId}</span>
            <span>{payload.meta.sourceSnapshotTime}</span>
            <span>{payload.sourceSnapshot.strikeCount} strikes</span>
          </section>
          <ExperimentalKpis payload={payload} />
          <section className="experimentalGrid" aria-label="Experimental analytics panels">
            <SmilePanel payload={payload} />
            <DistributionPanel payload={payload} />
            <ForwardPanel payload={payload} />
            <DiagnosticsPanel payload={payload} />
            <ProbabilityPanel payload={payload} />
            <SkewTailPanel payload={payload} />
            <MoveNeededPanel payload={payload} />
            <DecayPanel payload={payload} />
            <ResidualPanel payload={payload} />
            <QualityPanel payload={payload} />
            <HistoryPanel payload={payload} />
          </section>
        </>
      ) : (
        <section className="experimentalPanel">
          <div className="experimentalPanelHeader"><h2>Experimental analytics unavailable</h2></div>
          <p>Latest experimental analytics could not be loaded.</p>
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 9: Run page and dashboard tests**

Run:

```bash
pnpm --filter @gammascope/web test -- --run tests/ExperimentalPage.test.tsx tests/ExperimentalDashboard.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Add Experimental nav to existing pages**

Modify the top nav in `apps/web/components/DashboardView.tsx` to add:

```tsx
            <a className="topNavTab" href="/experimental">
              Experimental
            </a>
```

Place it after Heatmap.

Modify the `topNavTabs` block in `apps/web/components/ExposureHeatmap.tsx` to add:

```tsx
            <a className="topNavTab" href="/experimental">
              Experimental
            </a>
```

Place it after the active Heatmap link.

- [ ] **Step 11: Update existing nav tests**

In `apps/web/tests/DashboardView.test.tsx`, add to the first render test:

```ts
    expect(markup).toContain("Experimental");
    expect(markup).toContain("href=\"/experimental\"");
```

Add matching assertions to `apps/web/tests/ExposureHeatmap.test.tsx` in its basic render test:

```ts
    expect(container.innerHTML).toContain("Experimental");
    expect(container.innerHTML).toContain("href=\"/experimental\"");
```

- [ ] **Step 12: Run nav and page tests**

Run:

```bash
pnpm --filter @gammascope/web test -- --run tests/DashboardView.test.tsx tests/ExposureHeatmap.test.tsx tests/ExperimentalPage.test.tsx tests/ExperimentalDashboard.test.tsx
```

Expected: PASS.

- [ ] **Step 13: Commit experimental page**

Run:

```bash
git add apps/web/app/experimental apps/web/components/ExperimentalDashboard.tsx apps/web/components/experimental apps/web/components/DashboardView.tsx apps/web/components/ExposureHeatmap.tsx apps/web/tests/ExperimentalPage.test.tsx apps/web/tests/ExperimentalDashboard.test.tsx apps/web/tests/DashboardView.test.tsx apps/web/tests/ExposureHeatmap.test.tsx
git commit -m "feat: add experimental analytics workbench"
```

---

## Task 8: Add Experimental Styling And Final Verification

**Files:**
- Modify: `apps/web/app/styles.css`
- Test: `apps/web/tests/ExperimentalDashboard.test.tsx`

- [ ] **Step 1: Add CSS assertions**

In `apps/web/tests/ExperimentalDashboard.test.tsx`, import CSS:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
```

Add after imports:

```ts
const styles = readFileSync(join(__dirname, "../app/styles.css"), "utf8");
```

Add this test:

```tsx
  it("defines dense experimental workbench styles", () => {
    expect(styles).toContain(".experimentalGrid");
    expect(styles).toContain("grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))");
    expect(styles).toContain(".experimentalControlStrip");
    expect(styles).toContain(".experimentalPanel");
  });
```

- [ ] **Step 2: Run style assertion to verify failure**

Run:

```bash
pnpm --filter @gammascope/web test -- --run tests/ExperimentalDashboard.test.tsx
```

Expected: FAIL because styles are not defined.

- [ ] **Step 3: Add experimental CSS**

Append to `apps/web/app/styles.css` before light-theme overrides near the end:

```css
.experimentalShell {
  width: min(1520px, calc(100% - 32px));
}

.experimentalControlStrip {
  align-items: center;
  background: var(--control-bg);
  border: 1px solid var(--line);
  border-radius: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
  padding: 10px;
}

.experimentalControlStrip span,
.experimentalStatus {
  border: 1px solid var(--line-soft);
  border-radius: 999px;
  color: var(--soft);
  font-size: 12px;
  line-height: 1;
  padding: 7px 9px;
}

.experimentalKpiGrid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  margin-bottom: 14px;
}

.experimentalGrid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
}

.experimentalPanel {
  background: var(--panel-bg);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 16px 34px var(--shadow-strong);
  min-width: 0;
  padding: 14px;
}

.experimentalPanel:first-child,
.experimentalPanel:nth-child(2) {
  grid-column: span 2;
}

.experimentalPanelHeader {
  align-items: center;
  display: flex;
  gap: 10px;
  justify-content: space-between;
  margin-bottom: 10px;
}

.experimentalPanelHeader h2 {
  font-size: 13px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.experimentalStatus-ok {
  color: var(--good-text);
}

.experimentalStatus-warning {
  color: var(--warning-text);
}

.experimentalStatus-muted {
  color: var(--muted);
}

.experimentalStatus-error {
  color: var(--error-text);
}

.experimentalPanelBody {
  min-width: 0;
}

.experimentalDefinitionGrid {
  display: grid;
  gap: 8px;
  grid-template-columns: minmax(90px, 1fr) minmax(90px, 1fr);
}

.experimentalDefinitionGrid dt,
.experimentalTable th {
  color: var(--muted);
  font-size: 11px;
  text-transform: uppercase;
}

.experimentalDefinitionGrid dd {
  color: var(--text);
  font-variant-numeric: tabular-nums;
  margin: 0;
  text-align: right;
}

.experimentalChart {
  display: block;
  height: auto;
  max-height: 240px;
  width: 100%;
}

.experimentalChartSeries {
  fill: none;
  stroke: var(--blue);
  stroke-width: 2;
}

.experimentalChartSeries-1 {
  stroke: var(--teal);
}

.experimentalChartSeries-2 {
  stroke: var(--violet);
}

.experimentalChartSeries-3 {
  stroke: var(--amber);
}

.experimentalChartSeries-4 {
  stroke: var(--green);
}

.experimentalChartSeries-5 {
  stroke: var(--red);
}

.experimentalLegend {
  color: var(--muted);
  display: flex;
  flex-wrap: wrap;
  font-size: 11px;
  gap: 6px;
  margin-top: 8px;
}

.experimentalLegend span {
  border: 1px solid var(--line-soft);
  border-radius: 999px;
  padding: 4px 7px;
}

.experimentalTable {
  border-collapse: collapse;
  font-size: 12px;
  width: 100%;
}

.experimentalTable th,
.experimentalTable td {
  border-bottom: 1px solid var(--line-soft);
  padding: 6px 4px;
  text-align: left;
}

.experimentalTable td {
  color: var(--soft);
  font-variant-numeric: tabular-nums;
}

.experimentalDiagnostics {
  color: var(--muted);
  font-size: 11px;
  margin: 10px 0 0;
  padding-left: 18px;
}

.experimentalLargeValue {
  font-size: 28px;
  font-weight: 760;
}

.experimentalEmpty {
  align-items: center;
  border: 1px dashed var(--line);
  border-radius: 8px;
  color: var(--muted);
  display: flex;
  min-height: 80px;
  justify-content: center;
  padding: 12px;
}

@media (max-width: 760px) {
  .experimentalPanel:first-child,
  .experimentalPanel:nth-child(2) {
    grid-column: span 1;
  }
}
```

- [ ] **Step 4: Run web focused tests**

Run:

```bash
pnpm --filter @gammascope/web test -- --run tests/ExperimentalDashboard.test.tsx tests/ExperimentalPage.test.tsx tests/clientExperimentalSource.test.ts tests/experimentalFormat.test.ts tests/experimentalRoute.test.ts tests/experimentalReplayRoute.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run backend focused tests**

Run:

```bash
.venv/bin/pytest apps/api/tests/test_experimental_quality.py apps/api/tests/test_experimental_forward.py apps/api/tests/test_experimental_iv_methods.py apps/api/tests/test_experimental_distribution.py apps/api/tests/test_experimental_trade_maps.py apps/api/tests/test_experimental_service.py apps/api/tests/test_experimental_routes.py apps/api/tests/test_generated_contracts.py -q
```

Expected: PASS.

- [ ] **Step 6: Run contract generation and validation**

Run:

```bash
pnpm test:contracts
pnpm contracts:generate
.venv/bin/python -m datamodel_code_generator --input packages/contracts/schemas/experimental-analytics.schema.json --input-file-type jsonschema --output apps/api/gammascope_api/contracts/generated/experimental_analytics.py --output-model-type pydantic_v2.BaseModel --disable-timestamp
pnpm --filter @gammascope/contracts typecheck:generated
```

Expected: PASS and no unintended generated diff beyond experimental files.

- [ ] **Step 7: Run full web checks**

Run:

```bash
pnpm typecheck:web
pnpm test:web
```

Expected: PASS.

- [ ] **Step 8: Run full API tests**

Run:

```bash
docker compose up -d postgres
.venv/bin/pytest apps/api/tests -q
```

Expected: PASS.

- [ ] **Step 9: Browser verification**

Run the app:

```bash
pnpm dev:api
pnpm dev:web
```

Open:

```text
http://localhost:3000/experimental
```

Verify:

- Top nav shows `Experimental` active.
- KPI row is visible.
- IV smile and distribution panels span wider than small panels on desktop.
- Probability, skew/tail, move-needed, decay, rich/cheap, quote-quality, and history panels are visible without overlapping.
- Panel statuses are visible.
- The page remains usable at a 1440px desktop viewport and a 390px mobile viewport.

- [ ] **Step 10: Commit styling and verification changes**

Run:

```bash
git add apps/web/app/styles.css apps/web/tests/ExperimentalDashboard.test.tsx
git commit -m "style: add experimental workbench layout"
```

---

## Final Verification

Run:

```bash
pnpm contracts:validate
pnpm --filter @gammascope/contracts typecheck:generated
pnpm typecheck:web
pnpm test:web
docker compose up -d postgres
.venv/bin/pytest apps/api/tests -q
```

Expected:

- Contracts compile and validate.
- Generated TypeScript types typecheck.
- Web typecheck passes.
- Web tests pass.
- API tests pass.
- Existing Realtime, Replay, and Heatmap pages keep their current behavior.

## Manual Smoke

Run:

```bash
pnpm dev:api
pnpm dev:web
```

Open:

```text
http://localhost:3000/experimental
```

Expected:

- Dense workbench grid loads from seeded fallback when live API data is unavailable.
- Experimental tab is active.
- Many panels are visible at once.
- Preview and insufficient-data statuses are visible where relevant.
- No browser console errors appear during initial render.

## Notes For Executors

- Preserve the unrelated existing modification in `apps/web/next-env.d.ts`; do not revert it.
- Use `apply_patch` for manual edits.
- Keep each task commit focused.
- If scipy fitting behaves differently by version, adjust assertions to test shape/status/ranges rather than exact spline point values.
