import { NextResponse } from "next/server";
import { verifyAdminRequest } from "../../../../lib/adminSession";
import { isReplayImportResult } from "../../../../lib/replayImportSource";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
const REPLAY_IMPORTS_PATH = "/api/replay/imports";

function apiBaseUrl(): string {
  return (process.env.GAMMASCOPE_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

function replayImportsUrl(): string {
  return `${apiBaseUrl()}${REPLAY_IMPORTS_PATH}`;
}

function adminToken(): string | null {
  const token = process.env.GAMMASCOPE_ADMIN_TOKEN;
  return token && token.trim().length > 0 ? token : null;
}

function noStoreJson(payload: unknown, init?: ResponseInit) {
  const response = NextResponse.json(payload, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function adminUnavailableResponse(reason: "unavailable" | "unauthenticated" | "invalid_csrf" | null) {
  if (reason === "unavailable") {
    return noStoreJson({ error: "Admin login unavailable" }, { status: 503 });
  }

  return noStoreJson({ error: "Admin session required" }, { status: 403 });
}

async function replayImportResponse(upstreamResponse: Response) {
  let upstreamPayload: unknown;

  try {
    upstreamPayload = await upstreamResponse.json();
  } catch {
    return noStoreJson({ error: "Replay import request failed" }, { status: 502 });
  }

  if (!isReplayImportResult(upstreamPayload)) {
    return noStoreJson({ error: "Replay import request failed" }, { status: 502 });
  }

  return noStoreJson(upstreamPayload, { status: upstreamResponse.status });
}

export async function POST(request: Request) {
  const verification = verifyAdminRequest(request, { csrf: true });
  if (!verification.ok) {
    return adminUnavailableResponse(verification.reason);
  }

  const token = adminToken();
  if (!token) {
    return noStoreJson({ error: "Replay import proxy unavailable" }, { status: 503 });
  }

  try {
    const upstreamResponse = await fetch(replayImportsUrl(), {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "X-GammaScope-Admin-Token": token
      },
      body: await request.formData()
    });

    return replayImportResponse(upstreamResponse);
  } catch {
    return noStoreJson({ error: "Replay import request failed" }, { status: 502 });
  }
}
