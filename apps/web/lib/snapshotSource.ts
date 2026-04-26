import type { AnalyticsSnapshot } from "./contracts";
import { seedSnapshot } from "./seedSnapshot";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
const SNAPSHOT_PATH = "/api/spx/0dte/snapshot/latest";

type SnapshotFetcher = (input: string, init: RequestInit) => Promise<Response>;

type LoadDashboardSnapshotOptions = {
  apiBaseUrl?: string;
  fetcher?: SnapshotFetcher;
};

type Validator = (value: unknown) => boolean;

const TOP_LEVEL_FIELDS: Record<string, Validator> = {
  schema_version: (value) => value === "1.0.0",
  session_id: isString,
  mode: (value) => isOneOf(value, ["live", "replay", "scenario"]),
  symbol: (value) => value === "SPX",
  expiry: isString,
  snapshot_time: isString,
  spot: isNumber,
  forward: isNumber,
  discount_factor: isNumber,
  risk_free_rate: isNumber,
  dividend_yield: isNumber,
  source_status: (value) => isOneOf(value, ["starting", "connected", "degraded", "disconnected", "stale", "error"]),
  freshness_ms: isNumber,
  coverage_status: (value) => isOneOf(value, ["full", "partial", "empty"]),
  scenario_params: isScenarioParams,
  rows: Array.isArray
};

const ROW_FIELDS: Record<string, Validator> = {
  contract_id: isString,
  right: (value) => value === "call" || value === "put",
  strike: isNumber,
  bid: isNullableNumber,
  ask: isNullableNumber,
  mid: isNullableNumber,
  open_interest: isNullableNumber,
  custom_iv: isNullableNumber,
  custom_gamma: isNullableNumber,
  custom_vanna: isNullableNumber,
  ibkr_iv: isNullableNumber,
  ibkr_gamma: isNullableNumber,
  ibkr_vanna: isNullableNumber,
  iv_diff: isNullableNumber,
  gamma_diff: isNullableNumber,
  calc_status: (value) =>
    isOneOf(value, [
      "ok",
      "missing_quote",
      "invalid_quote",
      "below_intrinsic",
      "vol_out_of_bounds",
      "stale_underlying",
      "solver_failed",
      "out_of_model_scope"
    ]),
  comparison_status: (value) => isOneOf(value, ["ok", "missing", "stale", "outside_tolerance", "not_supported"])
};

function snapshotUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl.replace(/\/+$/, "")}${SNAPSHOT_PATH}`;
}

export function isAnalyticsSnapshot(payload: unknown): payload is AnalyticsSnapshot {
  if (!isRecord(payload)) {
    return false;
  }

  for (const [field, isValid] of Object.entries(TOP_LEVEL_FIELDS)) {
    if (!hasValidField(payload, field, isValid)) {
      return false;
    }
  }

  const rows = payload.rows;
  return Array.isArray(rows) && rows.every(isAnalyticsRow);
}

function isAnalyticsRow(row: unknown): row is AnalyticsSnapshot["rows"][number] {
  if (!isRecord(row)) {
    return false;
  }

  return Object.entries(ROW_FIELDS).every(([field, isValid]) => hasValidField(row, field, isValid));
}

function hasValidField(record: Record<string, unknown>, field: string, isValid: Validator): boolean {
  return Object.hasOwn(record, field) && isValid(record[field]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isNumber(value);
}

function isScenarioParams(value: unknown): value is AnalyticsSnapshot["scenario_params"] {
  if (value === null) {
    return true;
  }

  if (!isRecord(value)) {
    return false;
  }

  return Object.entries(value).every(([field, fieldValue]) => {
    return (
      (field === "spot_shift_points" || field === "vol_shift_points" || field === "time_shift_minutes") &&
      isNumber(fieldValue)
    );
  });
}

function isOneOf<T extends string>(value: unknown, allowedValues: readonly T[]): value is T {
  return typeof value === "string" && allowedValues.includes(value as T);
}

export async function loadDashboardSnapshot(options: LoadDashboardSnapshotOptions = {}): Promise<AnalyticsSnapshot> {
  const apiBaseUrl = options.apiBaseUrl ?? process.env.GAMMASCOPE_API_BASE_URL ?? DEFAULT_API_BASE_URL;
  const fetcher = options.fetcher ?? fetch;

  try {
    const response = await fetcher(snapshotUrl(apiBaseUrl), {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      return seedSnapshot;
    }

    const payload = await response.json();

    if (!isAnalyticsSnapshot(payload)) {
      return seedSnapshot;
    }

    return payload;
  } catch {
    return seedSnapshot;
  }
}
