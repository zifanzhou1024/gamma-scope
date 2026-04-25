import type { CollectorHealth } from "@gammascope/contracts/collector-events";

const COLLECTOR_STATUS_PATH = "/api/spx/0dte/status";

type CollectorStatusFetcher = (input: string, init: RequestInit) => Promise<Response>;

type LoadClientCollectorHealthOptions = {
  fetcher?: CollectorStatusFetcher;
};

type Validator = (value: unknown) => boolean;

const COLLECTOR_HEALTH_FIELDS: Record<string, Validator> = {
  schema_version: (value) => value === "1.0.0",
  source: (value) => value === "ibkr",
  collector_id: isNonEmptyString,
  status: (value) => isOneOf(value, ["starting", "connected", "degraded", "disconnected", "stale", "error"]),
  ibkr_account_mode: (value) => isOneOf(value, ["paper", "live", "unknown"]),
  message: isString,
  event_time: isDateTimeString,
  received_time: isDateTimeString
};

export type { CollectorHealth };

export function isCollectorHealth(payload: unknown): payload is CollectorHealth {
  if (!isRecord(payload)) {
    return false;
  }

  const allowedFields = new Set(Object.keys(COLLECTOR_HEALTH_FIELDS));
  if (!Object.keys(payload).every((field) => allowedFields.has(field))) {
    return false;
  }

  return Object.entries(COLLECTOR_HEALTH_FIELDS).every(([field, isValid]) =>
    Object.hasOwn(payload, field) && isValid(payload[field])
  );
}

export async function loadClientCollectorHealth(
  options: LoadClientCollectorHealthOptions = {}
): Promise<CollectorHealth | null> {
  const fetcher = options.fetcher ?? fetch;

  try {
    const response = await fetcher(COLLECTOR_STATUS_PATH, {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();

    if (!isCollectorHealth(payload)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
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

function isDateTimeString(value: unknown): value is string {
  if (!isString(value)) {
    return false;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})T.*(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return month >= 1 && month <= 12 && day >= 1 && day <= lastDayOfMonth && Number.isFinite(Date.parse(value));
}

function isOneOf<T extends string>(value: unknown, allowedValues: readonly T[]): value is T {
  return typeof value === "string" && allowedValues.includes(value as T);
}
