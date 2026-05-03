import { NextResponse } from "next/server";
import seedExperimentalFlow from "../../../../../../../../packages/contracts/fixtures/experimental-flow.seed.json";
import { backendApiUrl, backendJsonHeaders } from "../../../../../../lib/serverBackendFetch";

const EXPERIMENTAL_FLOW_LATEST_PATH = "/api/spx/0dte/experimental-flow/latest";

function noStoreJson(payload: unknown, init?: ResponseInit) {
  const response = NextResponse.json(payload, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function seedFallbackResponse(): Response {
  return noStoreJson(seedExperimentalFlow);
}

export async function GET(request: Request): Promise<Response> {
  try {
    const upstreamResponse = await fetch(backendApiUrl(EXPERIMENTAL_FLOW_LATEST_PATH), {
      cache: "no-store",
      headers: backendJsonHeaders(request.headers)
    });

    if (!upstreamResponse.ok) {
      return seedFallbackResponse();
    }

    const response = new Response(await upstreamResponse.text(), {
      status: upstreamResponse.status,
      headers: {
        "Content-Type": upstreamResponse.headers.get("Content-Type") ?? "application/json"
      }
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return seedFallbackResponse();
  }
}
