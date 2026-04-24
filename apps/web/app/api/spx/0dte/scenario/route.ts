import { NextResponse } from "next/server";
import { isAnalyticsSnapshot } from "../../../../../lib/snapshotSource";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
const SCENARIO_PATH = "/api/spx/0dte/scenario";

function scenarioUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl.replace(/\/+$/, "")}${SCENARIO_PATH}`;
}

function noStoreJson(payload: unknown, init?: ResponseInit) {
  const response = NextResponse.json(payload, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const apiBaseUrl = process.env.GAMMASCOPE_API_BASE_URL ?? DEFAULT_API_BASE_URL;
    const upstreamResponse = await fetch(scenarioUrl(apiBaseUrl), {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!upstreamResponse.ok) {
      return noStoreJson({ error: "Scenario request failed" }, { status: 502 });
    }

    const upstreamPayload = await upstreamResponse.json();

    if (!isAnalyticsSnapshot(upstreamPayload)) {
      return noStoreJson({ error: "Scenario request failed" }, { status: 502 });
    }

    return noStoreJson(upstreamPayload);
  } catch {
    return noStoreJson({ error: "Scenario request failed" }, { status: 502 });
  }
}
