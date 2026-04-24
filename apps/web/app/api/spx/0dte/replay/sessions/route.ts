import { NextResponse } from "next/server";
import { isReplaySessionArray } from "../../../../../../lib/clientReplaySource";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
const REPLAY_SESSIONS_PATH = "/api/spx/0dte/replay/sessions";

function replaySessionsUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl.replace(/\/+$/, "")}${REPLAY_SESSIONS_PATH}`;
}

function noStoreJson(payload: unknown, init?: ResponseInit) {
  const response = NextResponse.json(payload, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET() {
  try {
    const apiBaseUrl = process.env.GAMMASCOPE_API_BASE_URL ?? DEFAULT_API_BASE_URL;
    const upstreamResponse = await fetch(replaySessionsUrl(apiBaseUrl), {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });

    if (!upstreamResponse.ok) {
      return noStoreJson({ error: "Replay sessions request failed" }, { status: 502 });
    }

    const upstreamPayload = await upstreamResponse.json();

    if (!isReplaySessionArray(upstreamPayload)) {
      return noStoreJson({ error: "Replay sessions request failed" }, { status: 502 });
    }

    return noStoreJson(upstreamPayload);
  } catch {
    return noStoreJson({ error: "Replay sessions request failed" }, { status: 502 });
  }
}
