const REPLAY_IMPORTS_PATH = "/api/replay/imports";
const CSRF_HEADER_NAME = "X-GammaScope-CSRF";

const REPLAY_IMPORT_STATUSES = new Set([
  "uploaded",
  "validating",
  "awaiting_confirmation",
  "publishing",
  "completed",
  "failed",
  "cancelled"
]);

export interface ReplayImportResult {
  import_id: string;
  status: "uploaded" | "validating" | "awaiting_confirmation" | "publishing" | "completed" | "failed" | "cancelled";
  summary: Record<string, unknown>;
  warnings: string[];
  errors: string[];
  session_id: string | null;
  replay_url: string | null;
}

export function isReplayImportResult(payload: unknown): payload is ReplayImportResult {
  if (!isRecord(payload)) {
    return false;
  }

  return (
    typeof payload.import_id === "string" &&
    typeof payload.status === "string" &&
    REPLAY_IMPORT_STATUSES.has(payload.status) &&
    isRecord(payload.summary) &&
    isStringArray(payload.warnings) &&
    isStringArray(payload.errors) &&
    isNullableString(payload.session_id) &&
    isNullableString(payload.replay_url)
  );
}

export async function uploadReplayImport(files: FormData, csrfToken: string): Promise<ReplayImportResult | null> {
  return requestReplayImport(REPLAY_IMPORTS_PATH, {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      [CSRF_HEADER_NAME]: csrfToken
    },
    body: files
  });
}

export async function loadReplayImport(importId: string): Promise<ReplayImportResult | null> {
  return requestReplayImport(`${REPLAY_IMPORTS_PATH}/${encodeURIComponent(importId)}`, {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "application/json"
    }
  });
}

export async function confirmReplayImport(importId: string, csrfToken: string): Promise<ReplayImportResult | null> {
  return requestReplayImport(`${REPLAY_IMPORTS_PATH}/${encodeURIComponent(importId)}/confirm`, {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      [CSRF_HEADER_NAME]: csrfToken
    }
  });
}

export async function cancelReplayImport(importId: string, csrfToken: string): Promise<ReplayImportResult | null> {
  return requestReplayImport(`${REPLAY_IMPORTS_PATH}/${encodeURIComponent(importId)}`, {
    method: "DELETE",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      [CSRF_HEADER_NAME]: csrfToken
    }
  });
}

async function requestReplayImport(input: string, init: RequestInit): Promise<ReplayImportResult | null> {
  try {
    const response = await fetch(input, init);

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    return isReplayImportResult(payload) ? payload : null;
  } catch {
    return null;
  }
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
