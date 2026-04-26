import { NextResponse } from "next/server";
import { verifyAdminRequest } from "./adminSession";
import { isReplayImportResult } from "./replayImportSource";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
const DEFAULT_REPLAY_IMPORT_MAX_BYTES = 100 * 1024 * 1024;

interface ProxyContext {
  apiBaseUrl: string;
  adminToken: string;
}

export interface ImportRouteContext {
  params: Promise<{
    importId: string;
  }>;
}

export type StreamingRequestInit = RequestInit & {
  duplex: "half";
};

export function noStoreJson(payload: unknown, init?: ResponseInit) {
  const response = NextResponse.json(payload, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function replayImportPath(importId?: string, action?: "confirm"): string {
  const path = importId ? `/api/replay/imports/${encodeURIComponent(importId)}` : "/api/replay/imports";
  return action ? `${path}/${action}` : path;
}

export function proxyUrl(apiBaseUrl: string, path: string): string {
  return `${apiBaseUrl.replace(/\/+$/, "")}${path}`;
}

export function verifyReplayImportProxy(
  request: Request,
  options: { csrf?: boolean } = {}
): ProxyContext | Response {
  const verification = verifyAdminRequest(request, options);
  if (!verification.ok) {
    return adminUnavailableResponse(verification.reason);
  }

  const token = adminToken();
  if (!token) {
    return replayImportProxyUnavailable();
  }

  const apiBaseUrl = validatedApiBaseUrl(request);
  if (!apiBaseUrl) {
    return replayImportProxyUnavailable();
  }

  return {
    apiBaseUrl,
    adminToken: token
  };
}

export function replayImportUploadTooLarge(request: Request): boolean {
  const contentLength = request.headers.get("content-length");
  if (!contentLength) {
    return false;
  }

  const length = Number(contentLength);
  return Number.isFinite(length) && length > replayImportMaxBytes();
}

export function replayImportTooLargeResponse(): Response {
  return noStoreJson({ error: "Replay import upload too large" }, { status: 413 });
}

export async function replayImportResponse(upstreamResponse: Response): Promise<Response> {
  let upstreamPayload: unknown;

  try {
    upstreamPayload = await upstreamResponse.json();
  } catch {
    return replayImportRequestFailed();
  }

  if (!isReplayImportResult(upstreamPayload)) {
    return replayImportRequestFailed();
  }

  return noStoreJson(upstreamPayload, { status: upstreamResponse.status });
}

export function replayImportRequestFailed(): Response {
  return noStoreJson({ error: "Replay import request failed" }, { status: 502 });
}

export function upstreamHeaders(adminTokenValue: string, request?: Request): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-GammaScope-Admin-Token": adminTokenValue
  };
  const contentType = request?.headers.get("content-type");

  if (contentType) {
    headers["Content-Type"] = contentType;
  }

  return headers;
}

function adminUnavailableResponse(reason: "unavailable" | "unauthenticated" | "invalid_csrf" | null): Response {
  if (reason === "unavailable") {
    return noStoreJson({ error: "Admin login unavailable" }, { status: 503 });
  }

  return noStoreJson({ error: "Admin session required" }, { status: 403 });
}

function replayImportProxyUnavailable(): Response {
  return noStoreJson({ error: "Replay import proxy unavailable" }, { status: 503 });
}

function adminToken(): string | null {
  const token = process.env.GAMMASCOPE_ADMIN_TOKEN;
  const trimmed = token?.trim();

  return trimmed ? trimmed : null;
}

function validatedApiBaseUrl(request: Request): string | null {
  const configuredBaseUrl = process.env.GAMMASCOPE_API_BASE_URL?.trim();
  const rawBaseUrl = configuredBaseUrl || DEFAULT_API_BASE_URL;
  let apiUrl: URL;

  try {
    apiUrl = new URL(rawBaseUrl);
  } catch {
    return null;
  }

  if (apiUrl.protocol !== "http:" && apiUrl.protocol !== "https:") {
    return null;
  }

  if (apiUrl.origin === new URL(request.url).origin) {
    return null;
  }

  apiUrl.search = "";
  apiUrl.hash = "";

  return apiUrl.toString().replace(/\/+$/, "");
}

function replayImportMaxBytes(): number {
  const configuredMaxBytes = process.env.GAMMASCOPE_REPLAY_IMPORT_MAX_BYTES?.trim();
  if (!configuredMaxBytes) {
    return DEFAULT_REPLAY_IMPORT_MAX_BYTES;
  }

  const maxBytes = Number(configuredMaxBytes);
  return Number.isFinite(maxBytes) && maxBytes >= 0
    ? Math.trunc(maxBytes)
    : DEFAULT_REPLAY_IMPORT_MAX_BYTES;
}
