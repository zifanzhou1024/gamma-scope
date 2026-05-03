import type { ExperimentalFlow } from "./contracts";

export const FLOW_LATEST_PATH = "/api/spx/0dte/experimental-flow/latest";
export const FLOW_REPLAY_PATH = "/api/spx/0dte/experimental-flow/replay";

type ExperimentalFlowFetcher = (input: string, init: RequestInit) => Promise<Response>;

type LoadClientExperimentalFlowOptions = {
  fetcher?: ExperimentalFlowFetcher;
};

export type ExperimentalFlowReplayRequest = {
  session_id: string;
  horizon_minutes?: 5 | 15 | 30;
  at?: string;
};

type Validator = (value: unknown) => boolean;

const CONFIDENCE_VALUES = ["high", "medium", "low", "unknown"] as const;
const AGGRESSOR_VALUES = ["buy", "weak_buy", "sell", "weak_sell", "unknown"] as const;
const PRESSURE_DIRECTION_VALUES = ["positive", "negative", "flat", "unknown"] as const;
const HIT_CLASSIFICATION_VALUES = ["hit", "miss", "flat", "unknown"] as const;
const SEVERITY_VALUES = ["info", "warning", "error"] as const;
const EXPIRY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const TOP_LEVEL_FIELDS: Record<string, Validator> = {
  schema_version: (value) => value === "1.0.0",
  meta: isMeta,
  summary: isSummary,
  strikeRows: isStrikeRows,
  contractRows: isContractRows,
  replayValidation: isReplayValidation,
  diagnostics: isDiagnostics
};

export function isExperimentalFlow(payload: unknown): payload is ExperimentalFlow {
  if (!isRecord(payload)) {
    return false;
  }

  return Object.entries(TOP_LEVEL_FIELDS).every(([field, isValid]) => hasValidField(payload, field, isValid));
}

export async function loadClientExperimentalFlow(
  options: LoadClientExperimentalFlowOptions = {}
): Promise<ExperimentalFlow | null> {
  return loadExperimentalFlow(FLOW_LATEST_PATH, options);
}

export async function loadClientReplayExperimentalFlow(
  request: ExperimentalFlowReplayRequest,
  options: LoadClientExperimentalFlowOptions = {}
): Promise<ExperimentalFlow | null> {
  const params = new URLSearchParams({
    session_id: request.session_id,
    horizon_minutes: String(request.horizon_minutes ?? 5)
  });

  if (request.at) {
    params.set("at", request.at);
  }

  return loadExperimentalFlow(`${FLOW_REPLAY_PATH}?${params.toString()}`, options);
}

async function loadExperimentalFlow(
  path: string,
  options: LoadClientExperimentalFlowOptions
): Promise<ExperimentalFlow | null> {
  const fetcher = options.fetcher ?? fetch;

  try {
    const response = await fetcher(path, {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    return isExperimentalFlow(payload) ? payload : null;
  } catch {
    return null;
  }
}

function isMeta(value: unknown): value is ExperimentalFlow["meta"] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    hasValidField(value, "mode", (fieldValue) => isOneOf(fieldValue, ["latest", "replay"])) &&
    hasValidField(value, "symbol", (fieldValue) => fieldValue === "SPX") &&
    hasValidField(value, "expiry", isExpiryString) &&
    hasValidField(value, "generatedAt", isDateTimeString) &&
    hasValidField(value, "sourceSessionId", isNonEmptyString) &&
    hasValidField(value, "currentSnapshotTime", isDateTimeString) &&
    hasValidField(value, "previousSnapshotTime", isNullableDateTimeString)
  );
}

function isSummary(value: unknown): value is ExperimentalFlow["summary"] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    hasValidField(value, "estimatedBuyContracts", isNonNegativeNumber) &&
    hasValidField(value, "estimatedSellContracts", isNonNegativeNumber) &&
    hasValidField(value, "netEstimatedContracts", isNumber) &&
    hasValidField(value, "netPremiumFlow", isNumber) &&
    hasValidField(value, "netDeltaFlow", isNullableNumber) &&
    hasValidField(value, "netGammaFlow", isNullableNumber) &&
    hasValidField(value, "estimatedDealerGammaPressure", isNullableNumber) &&
    hasValidField(value, "confidence", isConfidence)
  );
}

function isStrikeRows(value: unknown): value is ExperimentalFlow["strikeRows"] {
  return Array.isArray(value) && value.every((row) => {
    return (
      isRecord(row) &&
      hasValidField(row, "strike", isPositiveNumber) &&
      hasValidField(row, "callBuyContracts", isNonNegativeNumber) &&
      hasValidField(row, "callSellContracts", isNonNegativeNumber) &&
      hasValidField(row, "putBuyContracts", isNonNegativeNumber) &&
      hasValidField(row, "putSellContracts", isNonNegativeNumber) &&
      hasValidField(row, "netPremiumFlow", isNumber) &&
      hasValidField(row, "netDeltaFlow", isNullableNumber) &&
      hasValidField(row, "netGammaFlow", isNullableNumber) &&
      hasValidField(row, "estimatedDealerGammaPressure", isNullableNumber) &&
      hasValidField(row, "openingScore", isNormalizedNumber) &&
      hasValidField(row, "closingScore", isNormalizedNumber) &&
      hasValidField(row, "confidence", isConfidence) &&
      hasValidField(row, "tags", isNonEmptyStringArray)
    );
  });
}

function isContractRows(value: unknown): value is ExperimentalFlow["contractRows"] {
  return Array.isArray(value) && value.every((row) => {
    return (
      isRecord(row) &&
      hasValidField(row, "contractId", isNonEmptyString) &&
      hasValidField(row, "right", (fieldValue) => isOneOf(fieldValue, ["call", "put"])) &&
      hasValidField(row, "strike", isPositiveNumber) &&
      hasValidField(row, "volumeDelta", isNonNegativeNumber) &&
      hasValidField(row, "aggressor", (fieldValue) => isOneOf(fieldValue, AGGRESSOR_VALUES)) &&
      hasValidField(row, "signedContracts", isNumber) &&
      hasValidField(row, "premiumFlow", isNumber) &&
      hasValidField(row, "deltaFlow", isNullableNumber) &&
      hasValidField(row, "gammaFlow", isNullableNumber) &&
      hasValidField(row, "vannaFlow", isNullableNumber) &&
      hasValidField(row, "thetaFlow", isNullableNumber) &&
      hasValidField(row, "openingScore", isNormalizedNumber) &&
      hasValidField(row, "closingScore", isNormalizedNumber) &&
      hasValidField(row, "confidence", isConfidence) &&
      hasValidField(row, "diagnostics", isNonEmptyStringArray)
    );
  });
}

function isReplayValidation(value: unknown): value is ExperimentalFlow["replayValidation"] {
  if (value === null) {
    return true;
  }

  return (
    isRecord(value) &&
    hasValidField(value, "horizonMinutes", (fieldValue) => isOneOfNumber(fieldValue, [5, 15, 30])) &&
    hasValidField(value, "rows", isReplayValidationRows) &&
    hasValidField(value, "hitRate", isNullableNormalizedNumber)
  );
}

function isReplayValidationRows(value: unknown): value is NonNullable<ExperimentalFlow["replayValidation"]>["rows"] {
  return Array.isArray(value) && value.every((row) => {
    return (
      isRecord(row) &&
      hasValidField(row, "snapshotTime", isDateTimeString) &&
      hasValidField(row, "pressureDirection", (fieldValue) => isOneOf(fieldValue, PRESSURE_DIRECTION_VALUES)) &&
      hasValidField(row, "pressureMagnitude", isNullableNumber) &&
      hasValidField(row, "currentSpot", isPositiveNumber) &&
      hasValidField(row, "futureSpot", isNullablePositiveNumber) &&
      hasValidField(row, "realizedMove", isNullableNumber) &&
      hasValidField(row, "classification", (fieldValue) => isOneOf(fieldValue, HIT_CLASSIFICATION_VALUES))
    );
  });
}

function isDiagnostics(value: unknown): value is ExperimentalFlow["diagnostics"] {
  return Array.isArray(value) && value.every((diagnostic) => {
    return (
      isRecord(diagnostic) &&
      hasValidField(diagnostic, "code", isNonEmptyString) &&
      hasValidField(diagnostic, "message", isNonEmptyString) &&
      hasValidField(diagnostic, "severity", (fieldValue) => isOneOf(fieldValue, SEVERITY_VALUES))
    );
  });
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

function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isExpiryString(value: unknown): value is string {
  return isString(value) && EXPIRY_PATTERN.test(value);
}

function isDateTimeString(value: unknown): value is string {
  return isString(value) && DATE_TIME_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

function isNullableDateTimeString(value: unknown): value is string | null {
  return value === null || isDateTimeString(value);
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isNumber(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return isNumber(value) && value >= 0;
}

function isPositiveNumber(value: unknown): value is number {
  return isNumber(value) && value > 0;
}

function isNullablePositiveNumber(value: unknown): value is number | null {
  return value === null || isPositiveNumber(value);
}

function isNormalizedNumber(value: unknown): value is number {
  return isNumber(value) && value >= 0 && value <= 1;
}

function isNullableNormalizedNumber(value: unknown): value is number | null {
  return value === null || isNormalizedNumber(value);
}

function isConfidence(value: unknown): value is ExperimentalFlow["summary"]["confidence"] {
  return isOneOf(value, CONFIDENCE_VALUES);
}

function isOneOf<T extends string>(value: unknown, allowedValues: readonly T[]): value is T {
  return typeof value === "string" && allowedValues.includes(value as T);
}

function isOneOfNumber<T extends number>(value: unknown, allowedValues: readonly T[]): value is T {
  return typeof value === "number" && allowedValues.includes(value as T);
}
