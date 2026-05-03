import { NextResponse } from "next/server";
import { backendApiUrl, backendJsonHeaders } from "../../../../../../lib/serverBackendFetch";

const EXPERIMENTAL_FLOW_REPLAY_PATH = "/api/spx/0dte/experimental-flow/replay";

function experimentalFlowReplayParams(requestUrl: string): URLSearchParams {
  const sourceUrl = new URL(requestUrl);
  const params = new URLSearchParams();
  const sessionId = sourceUrl.searchParams.get("session_id");
  const horizonMinutes = sourceUrl.searchParams.get("horizon_minutes");
  const at = sourceUrl.searchParams.get("at");

  if (sessionId) {
    params.set("session_id", sessionId);
  }

  if (horizonMinutes) {
    params.set("horizon_minutes", horizonMinutes);
  }

  if (at) {
    params.set("at", at);
  }

  return params;
}

function noStoreJson(payload: unknown, init?: ResponseInit) {
  const response = NextResponse.json(payload, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const upstreamResponse = await fetch(
      backendApiUrl(EXPERIMENTAL_FLOW_REPLAY_PATH, experimentalFlowReplayParams(request.url)),
      {
        cache: "no-store",
        headers: backendJsonHeaders()
      }
    );

    const response = new Response(await upstreamResponse.text(), {
      status: upstreamResponse.status,
      headers: {
        "Content-Type": upstreamResponse.headers.get("Content-Type") ?? "application/json"
      }
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return noStoreJson({ error: "Experimental flow replay unavailable" }, { status: 502 });
  }
}
