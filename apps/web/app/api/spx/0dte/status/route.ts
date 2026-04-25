import { NextResponse } from "next/server";
import { isCollectorHealth } from "../../../../../lib/clientCollectorStatusSource";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
const COLLECTOR_STATUS_PATH = "/api/spx/0dte/status";

function collectorStatusUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl.replace(/\/+$/, "")}${COLLECTOR_STATUS_PATH}`;
}

function noStoreJson(payload: unknown, init?: ResponseInit) {
  const response = NextResponse.json(payload, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET() {
  try {
    const apiBaseUrl = process.env.GAMMASCOPE_API_BASE_URL ?? DEFAULT_API_BASE_URL;
    const upstreamResponse = await fetch(collectorStatusUrl(apiBaseUrl), {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });

    if (!upstreamResponse.ok) {
      return noStoreJson({ error: "Collector status request failed" }, { status: 502 });
    }

    const upstreamPayload = await upstreamResponse.json();

    if (!isCollectorHealth(upstreamPayload)) {
      return noStoreJson({ error: "Collector status request failed" }, { status: 502 });
    }

    return noStoreJson(upstreamPayload);
  } catch {
    return noStoreJson({ error: "Collector status request failed" }, { status: 502 });
  }
}
