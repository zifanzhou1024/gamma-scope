import { NextResponse } from "next/server";
import { isReplayTimestampResponse } from "../../../../../../../../lib/clientReplaySource";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
const REPLAY_SESSIONS_PATH = "/api/spx/0dte/replay/sessions";

interface ReplayTimestampsRouteContext {
  params: { sessionId: string } | Promise<{ sessionId: string }>;
}

function replayTimestampsUrl(apiBaseUrl: string, sessionId: string): string {
  return `${apiBaseUrl.replace(/\/+$/, "")}${REPLAY_SESSIONS_PATH}/${encodeURIComponent(sessionId)}/timestamps`;
}

function noStoreJson(payload: unknown, init?: ResponseInit) {
  const response = NextResponse.json(payload, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(_request: Request, context: ReplayTimestampsRouteContext) {
  try {
    const { sessionId } = await context.params;
    const apiBaseUrl = process.env.GAMMASCOPE_API_BASE_URL ?? DEFAULT_API_BASE_URL;
    const upstreamResponse = await fetch(replayTimestampsUrl(apiBaseUrl, sessionId), {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });

    if (!upstreamResponse.ok) {
      return noStoreJson({ error: "Replay timestamps request failed" }, { status: 502 });
    }

    const upstreamPayload = await upstreamResponse.json();

    if (!isReplayTimestampResponse(upstreamPayload)) {
      return noStoreJson({ error: "Replay timestamps request failed" }, { status: 502 });
    }

    return noStoreJson(upstreamPayload);
  } catch {
    return noStoreJson({ error: "Replay timestamps request failed" }, { status: 502 });
  }
}
