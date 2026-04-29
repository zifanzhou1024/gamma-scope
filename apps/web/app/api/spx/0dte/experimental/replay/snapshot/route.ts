import { NextResponse } from "next/server";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
const EXPERIMENTAL_REPLAY_PATH = "/api/spx/0dte/experimental/replay/snapshot";

function experimentalReplayUrl(apiBaseUrl: string, requestUrl: string): string {
  const sourceUrl = new URL(requestUrl);
  const params = new URLSearchParams();
  const sessionId = sourceUrl.searchParams.get("session_id");
  const at = sourceUrl.searchParams.get("at");
  const sourceSnapshotId = sourceUrl.searchParams.get("source_snapshot_id");

  if (sessionId) {
    params.set("session_id", sessionId);
  }

  if (at) {
    params.set("at", at);
  }

  if (sourceSnapshotId) {
    params.set("source_snapshot_id", sourceSnapshotId);
  }

  return `${apiBaseUrl.replace(/\/+$/, "")}${EXPERIMENTAL_REPLAY_PATH}?${params.toString()}`;
}

function noStoreJson(payload: unknown, init?: ResponseInit) {
  const response = NextResponse.json(payload, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: Request): Promise<Response> {
  const apiBaseUrl = process.env.GAMMASCOPE_API_BASE_URL ?? DEFAULT_API_BASE_URL;

  try {
    const upstreamResponse = await fetch(experimentalReplayUrl(apiBaseUrl, request.url), {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });

    const response = new Response(await upstreamResponse.text(), {
      status: upstreamResponse.status,
      headers: {
        "Content-Type": upstreamResponse.headers.get("Content-Type") ?? "application/json"
      }
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return noStoreJson({ error: "Experimental replay analytics unavailable" }, { status: 502 });
  }
}
