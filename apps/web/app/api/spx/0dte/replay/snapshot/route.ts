import { NextResponse } from "next/server";
import { isAnalyticsSnapshot } from "../../../../../../lib/snapshotSource";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
const REPLAY_SNAPSHOT_PATH = "/api/spx/0dte/replay/snapshot";

function replaySnapshotUrl(apiBaseUrl: string, requestUrl: string): string {
  const sourceUrl = new URL(requestUrl);
  const params = new URLSearchParams();
  const sessionId = sourceUrl.searchParams.get("session_id");
  const at = sourceUrl.searchParams.get("at");

  if (sessionId) {
    params.set("session_id", sessionId);
  }

  if (at) {
    params.set("at", at);
  }

  return `${apiBaseUrl.replace(/\/+$/, "")}${REPLAY_SNAPSHOT_PATH}?${params.toString()}`;
}

function noStoreJson(payload: unknown, init?: ResponseInit) {
  const response = NextResponse.json(payload, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: Request) {
  try {
    const apiBaseUrl = process.env.GAMMASCOPE_API_BASE_URL ?? DEFAULT_API_BASE_URL;
    const upstreamResponse = await fetch(replaySnapshotUrl(apiBaseUrl, request.url), {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });

    if (!upstreamResponse.ok) {
      return noStoreJson({ error: "Replay snapshot request failed" }, { status: 502 });
    }

    const upstreamPayload = await upstreamResponse.json();

    if (!isAnalyticsSnapshot(upstreamPayload)) {
      return noStoreJson({ error: "Replay snapshot request failed" }, { status: 502 });
    }

    return noStoreJson(upstreamPayload);
  } catch {
    return noStoreJson({ error: "Replay snapshot request failed" }, { status: 502 });
  }
}
