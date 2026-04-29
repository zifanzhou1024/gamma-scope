import type { ExperimentalAnalytics } from "./contracts";

const EXPERIMENTAL_LATEST_PATH = "/api/spx/0dte/experimental/latest";
const EXPERIMENTAL_REPLAY_PATH = "/api/spx/0dte/experimental/replay/snapshot";

type ExperimentalAnalyticsFetcher = (input: string, init: RequestInit) => Promise<Response>;

type LoadClientExperimentalAnalyticsOptions = {
  fetcher?: ExperimentalAnalyticsFetcher;
};

export type ExperimentalReplayRequest = {
  session_id: string;
  at?: string;
  source_snapshot_id?: string;
};

type Validator = (value: unknown) => boolean;

const PANEL_STATUSES = ["ok", "preview", "insufficient_data", "error"] as const;

const TOP_LEVEL_FIELDS: Record<string, Validator> = {
  schema_version: (value) => value === "1.0.0",
  meta: isMeta,
  sourceSnapshot: isSourceSnapshot,
  forwardSummary: isForwardSummary,
  ivSmiles: isIvSmiles,
  smileDiagnostics: isSmileDiagnostics,
  probabilities: isProbabilities,
  terminalDistribution: isTerminalDistribution,
  skewTail: isSkewTail,
  moveNeeded: isPanelWithRows,
  decayPressure: isPanelWithRows,
  richCheap: isPanelWithRows,
  quoteQuality: isQuoteQuality,
  historyPreview: isPanelWithRows
};

export function isExperimentalAnalytics(payload: unknown): payload is ExperimentalAnalytics {
  if (!isRecord(payload)) {
    return false;
  }

  return Object.entries(TOP_LEVEL_FIELDS).every(([field, isValid]) => hasValidField(payload, field, isValid));
}

export async function loadClientExperimentalAnalytics(
  options: LoadClientExperimentalAnalyticsOptions = {}
): Promise<ExperimentalAnalytics | null> {
  return loadExperimentalAnalytics(EXPERIMENTAL_LATEST_PATH, options);
}

export async function loadClientReplayExperimentalAnalytics(
  request: ExperimentalReplayRequest,
  options: LoadClientExperimentalAnalyticsOptions = {}
): Promise<ExperimentalAnalytics | null> {
  const params = new URLSearchParams({ session_id: request.session_id });

  if (request.at) {
    params.set("at", request.at);
  }

  if (request.source_snapshot_id) {
    params.set("source_snapshot_id", request.source_snapshot_id);
  }

  return loadExperimentalAnalytics(`${EXPERIMENTAL_REPLAY_PATH}?${params.toString()}`, options);
}

async function loadExperimentalAnalytics(
  path: string,
  options: LoadClientExperimentalAnalyticsOptions
): Promise<ExperimentalAnalytics | null> {
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
    return isExperimentalAnalytics(payload) ? payload : null;
  } catch {
    return null;
  }
}

function isMeta(value: unknown): value is ExperimentalAnalytics["meta"] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    hasValidField(value, "generatedAt", isString) &&
    hasValidField(value, "mode", (fieldValue) => isOneOf(fieldValue, ["latest", "replay"])) &&
    hasValidField(value, "sourceSessionId", isNonEmptyString) &&
    hasValidField(value, "sourceSnapshotTime", isString) &&
    hasValidField(value, "symbol", (fieldValue) => fieldValue === "SPX") &&
    hasValidField(value, "expiry", isString)
  );
}

function isSourceSnapshot(value: unknown): value is ExperimentalAnalytics["sourceSnapshot"] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    hasValidField(value, "spot", isNumber) &&
    hasValidField(value, "forward", isNumber) &&
    hasValidField(value, "rowCount", isNonNegativeInteger) &&
    hasValidField(value, "strikeCount", isNonNegativeInteger) &&
    hasValidField(value, "timeToExpiryYears", isNonNegativeNumber)
  );
}

function isForwardSummary(value: unknown): value is ExperimentalAnalytics["forwardSummary"] {
  return (
    isPanel(value) &&
    hasValidField(value, "parityForward", isNullableNumber) &&
    hasValidField(value, "forwardMinusSpot", isNullableNumber) &&
    hasValidField(value, "atmStrike", isNullableNumber) &&
    hasValidField(value, "atmStraddle", isNullableNumber) &&
    hasValidField(value, "expectedRange", isNullableExpectedRange) &&
    hasValidField(value, "expectedMovePercent", isNullableNumber)
  );
}

function isIvSmiles(value: unknown): value is ExperimentalAnalytics["ivSmiles"] {
  return isPanel(value) && hasValidField(value, "methods", isIvSmileMethods);
}

function isIvSmileMethods(value: unknown): value is ExperimentalAnalytics["ivSmiles"]["methods"] {
  return Array.isArray(value) && value.every((method) => {
    return (
      isRecord(method) &&
      hasValidField(method, "key", isNonEmptyString) &&
      hasValidField(method, "label", isNonEmptyString) &&
      hasValidField(method, "status", isPanelStatus) &&
      hasValidField(method, "points", isPoints)
    );
  });
}

function isSmileDiagnostics(value: unknown): value is ExperimentalAnalytics["smileDiagnostics"] {
  return (
    isPanel(value) &&
    hasValidField(value, "ivValley", isStrikeValue) &&
    hasValidField(value, "atmForwardIv", isNullableNumber) &&
    hasValidField(value, "skewSlope", isNullableNumber) &&
    hasValidField(value, "curvature", isNullableNumber) &&
    hasValidField(value, "methodDisagreement", isNullableNumber)
  );
}

function isProbabilities(value: unknown): value is ExperimentalAnalytics["probabilities"] {
  return isPanel(value) && hasValidField(value, "levels", isProbabilityLevels);
}

function isProbabilityLevels(value: unknown): value is ExperimentalAnalytics["probabilities"]["levels"] {
  return Array.isArray(value) && value.every((level) => {
    return (
      isRecord(level) &&
      hasValidField(level, "strike", isNumber) &&
      hasValidField(level, "closeAbove", isNullableNumber) &&
      hasValidField(level, "closeBelow", isNullableNumber)
    );
  });
}

function isTerminalDistribution(value: unknown): value is ExperimentalAnalytics["terminalDistribution"] {
  return (
    isPanel(value) &&
    hasValidField(value, "density", isPoints) &&
    hasValidField(value, "highestDensityZone", isNullableString) &&
    hasValidField(value, "range68", isNullableString) &&
    hasValidField(value, "range95", isNullableString) &&
    hasValidField(value, "leftTailProbability", isNullableNumber) &&
    hasValidField(value, "rightTailProbability", isNullableNumber)
  );
}

function isSkewTail(value: unknown): value is ExperimentalAnalytics["skewTail"] {
  return (
    isPanel(value) &&
    hasValidField(value, "tailBias", isNullableString) &&
    hasValidField(value, "leftTailRichness", isNullableNumber) &&
    hasValidField(value, "rightTailRichness", isNullableNumber)
  );
}

function isPanelWithRows(value: unknown): value is ExperimentalAnalytics["moveNeeded"] {
  return isPanel(value) && hasValidField(value, "rows", isPanelRows);
}

function isQuoteQuality(value: unknown): value is ExperimentalAnalytics["quoteQuality"] {
  return (
    isPanel(value) &&
    hasValidField(value, "score", isNormalizedNumber) &&
    hasValidField(value, "flags", isQuoteQualityFlags)
  );
}

function isQuoteQualityFlags(value: unknown): value is ExperimentalAnalytics["quoteQuality"]["flags"] {
  return Array.isArray(value) && value.every((flag) => {
    return (
      isRecord(flag) &&
      hasValidField(flag, "strike", isNumber) &&
      hasValidField(flag, "right", (fieldValue) => isOneOf(fieldValue, ["call", "put", "pair"])) &&
      hasValidField(flag, "code", isNonEmptyString) &&
      hasValidField(flag, "message", isNonEmptyString)
    );
  });
}

function isPanel(value: unknown): value is {
  status: ExperimentalAnalytics["forwardSummary"]["status"];
  label: string;
  diagnostics: ExperimentalAnalytics["forwardSummary"]["diagnostics"];
} & Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  return (
    hasValidField(value, "status", isPanelStatus) &&
    hasValidField(value, "label", isNonEmptyString) &&
    hasValidField(value, "diagnostics", isDiagnostics)
  );
}

function isDiagnostics(value: unknown): value is ExperimentalAnalytics["forwardSummary"]["diagnostics"] {
  return Array.isArray(value) && value.every((diagnostic) => {
    return (
      isRecord(diagnostic) &&
      hasValidField(diagnostic, "code", isNonEmptyString) &&
      hasValidField(diagnostic, "message", isNonEmptyString) &&
      hasValidField(diagnostic, "severity", (fieldValue) => isOneOf(fieldValue, ["info", "warning", "error"]))
    );
  });
}

function isPoints(value: unknown): value is ExperimentalAnalytics["ivSmiles"]["methods"][number]["points"] {
  return Array.isArray(value) && value.every((point) => {
    return (
      isRecord(point) &&
      hasValidField(point, "x", isNumber) &&
      hasValidField(point, "y", isNullableNumber)
    );
  });
}

function isStrikeValue(value: unknown): value is ExperimentalAnalytics["smileDiagnostics"]["ivValley"] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    hasValidField(value, "strike", isNullableNumber) &&
    hasValidField(value, "value", isNullableNumber) &&
    hasValidField(value, "label", isNullableString)
  );
}

function isPanelRows(value: unknown): value is ExperimentalAnalytics["moveNeeded"]["rows"] {
  return Array.isArray(value) && value.every((row) => {
    return isRecord(row) && hasValidField(row, "strike", isNumber);
  });
}

function isNullableExpectedRange(value: unknown): value is ExperimentalAnalytics["forwardSummary"]["expectedRange"] {
  if (value === null) {
    return true;
  }

  return (
    isRecord(value) &&
    hasValidField(value, "lower", isNumber) &&
    hasValidField(value, "upper", isNumber)
  );
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

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isNumber(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return isNumber(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value) && value >= 0;
}

function isNormalizedNumber(value: unknown): value is number {
  return isNumber(value) && value >= 0 && value <= 1;
}

function isPanelStatus(value: unknown): value is ExperimentalAnalytics["forwardSummary"]["status"] {
  return isOneOf(value, PANEL_STATUSES);
}

function isOneOf<T extends string>(value: unknown, allowedValues: readonly T[]): value is T {
  return typeof value === "string" && allowedValues.includes(value as T);
}
