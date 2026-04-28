export type HeatmapMetric = "gex" | "vex";
export type HeatmapSymbol = "SPX" | "SPY" | "QQQ" | "NDX" | "IWM";

export const HEATMAP_SYMBOLS: HeatmapSymbol[] = ["SPX", "SPY", "QQQ", "NDX", "IWM"];

export type HeatmapPositionMode = "oi_proxy";

export type HeatmapOiBaselineStatus = "provisional" | "locked";

export type HeatmapPersistenceStatus = "pending" | "persisted" | "unavailable" | "skipped";

export type HeatmapNode = {
  strike: number;
  value: number;
} | null;

export type HeatmapNodes = {
  king: HeatmapNode;
  positiveKing: HeatmapNode;
  negativeKing: HeatmapNode;
  aboveWall: HeatmapNode;
  belowWall: HeatmapNode;
};

export type HeatmapRow = {
  strike: number;
  value: number;
  formattedValue: string;
  callValue: number;
  putValue: number;
  colorNorm: number;
  gex: number;
  vex: number;
  callGex: number;
  putGex: number;
  callVex: number;
  putVex: number;
  colorNormGex: number;
  colorNormVex: number;
  tags: string[];
};

export type HeatmapPayload = {
  sessionId: string;
  symbol: HeatmapSymbol;
  tradingClass: string;
  dte: number | null;
  expirationDate: string;
  spot: number;
  metric: HeatmapMetric;
  positionMode: HeatmapPositionMode;
  oiBaselineStatus: HeatmapOiBaselineStatus;
  oiBaselineCapturedAt: string | null;
  lastSyncedAt: string;
  isLive: boolean;
  isStale: boolean;
  persistenceStatus: HeatmapPersistenceStatus;
  rows: HeatmapRow[];
  nodes: HeatmapNodes;
};

const HEATMAP_PATH = "/api/spx/0dte/heatmap/latest";

type HeatmapFetcher = (input: string, init: RequestInit) => Promise<Response>;

type LoadClientHeatmapOptions = {
  fetcher?: HeatmapFetcher;
};

type Validator = (value: unknown) => boolean;

const TOP_LEVEL_FIELDS: Record<string, Validator> = {
  sessionId: isString,
  symbol: (value) => isOneOf(value, HEATMAP_SYMBOLS),
  tradingClass: isNonEmptyString,
  dte: isNullableNumber,
  expirationDate: isString,
  spot: isNumber,
  metric: (value) => isOneOf(value, ["gex", "vex"]),
  positionMode: (value) => value === "oi_proxy",
  oiBaselineStatus: (value) => isOneOf(value, ["provisional", "locked"]),
  oiBaselineCapturedAt: isNullableString,
  lastSyncedAt: isString,
  isLive: isBoolean,
  isStale: isBoolean,
  persistenceStatus: (value) => isOneOf(value, ["pending", "persisted", "unavailable", "skipped"]),
  rows: Array.isArray,
  nodes: isHeatmapNodes
};

const ROW_FIELDS: Record<string, Validator> = {
  strike: isNumber,
  value: isNumber,
  formattedValue: isString,
  callValue: isNumber,
  putValue: isNumber,
  colorNorm: isNormalizedNumber,
  gex: isNumber,
  vex: isNumber,
  callGex: isNumber,
  putGex: isNumber,
  callVex: isNumber,
  putVex: isNumber,
  colorNormGex: isNormalizedNumber,
  colorNormVex: isNormalizedNumber,
  tags: isStringArray
};

export function isHeatmapPayload(payload: unknown): payload is HeatmapPayload {
  if (!isRecord(payload)) {
    return false;
  }

  for (const [field, isValid] of Object.entries(TOP_LEVEL_FIELDS)) {
    if (!hasValidField(payload, field, isValid)) {
      return false;
    }
  }

  return Array.isArray(payload.rows) && payload.rows.every(isHeatmapRow);
}

function isHeatmapRow(row: unknown): row is HeatmapRow {
  if (!isRecord(row)) {
    return false;
  }

  return Object.entries(ROW_FIELDS).every(([field, isValid]) => hasValidField(row, field, isValid));
}

function isHeatmapNodes(value: unknown): value is HeatmapNodes {
  if (!isRecord(value)) {
    return false;
  }

  return (
    hasValidField(value, "king", isHeatmapNode) &&
    hasValidField(value, "positiveKing", isHeatmapNode) &&
    hasValidField(value, "negativeKing", isHeatmapNode) &&
    hasValidField(value, "aboveWall", isHeatmapNode) &&
    hasValidField(value, "belowWall", isHeatmapNode)
  );
}

function isHeatmapNode(value: unknown): value is HeatmapNode {
  if (value === null) {
    return true;
  }

  return (
    isRecord(value) &&
    hasValidField(value, "strike", isNumber) &&
    hasValidField(value, "value", isNumber)
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

function isNormalizedNumber(value: unknown): value is number {
  return isNumber(value) && value >= 0 && value <= 1;
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isNumber(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isOneOf<T extends string>(value: unknown, allowedValues: readonly T[]): value is T {
  return typeof value === "string" && allowedValues.includes(value as T);
}

export async function loadClientHeatmap(
  metric: HeatmapMetric = "gex",
  options: LoadClientHeatmapOptions = {}
): Promise<HeatmapPayload | null> {
  const fetcher = options.fetcher ?? fetch;
  const params = new URLSearchParams({ metric });

  try {
    const response = await fetcher(`${HEATMAP_PATH}?${params.toString()}`, {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();

    if (!isHeatmapPayload(payload)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
