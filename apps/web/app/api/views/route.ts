import { NextResponse } from "next/server";
import { isSavedViewArray, type SavedView } from "../../../lib/clientSavedViewsSource";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
const VIEWS_PATH = "/api/views";

function viewsUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl.replace(/\/+$/, "")}${VIEWS_PATH}`;
}

function noStoreJson(payload: unknown, init?: ResponseInit) {
  const response = NextResponse.json(payload, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function isSavedView(payload: unknown): payload is SavedView {
  return isSavedViewArray([payload]);
}

export async function GET() {
  try {
    const apiBaseUrl = process.env.GAMMASCOPE_API_BASE_URL ?? DEFAULT_API_BASE_URL;
    const upstreamResponse = await fetch(viewsUrl(apiBaseUrl), {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });

    if (!upstreamResponse.ok) {
      return noStoreJson({ error: "Saved views request failed" }, { status: 502 });
    }

    const upstreamPayload = await upstreamResponse.json();

    if (!isSavedViewArray(upstreamPayload)) {
      return noStoreJson({ error: "Saved views request failed" }, { status: 502 });
    }

    return noStoreJson(upstreamPayload);
  } catch {
    return noStoreJson({ error: "Saved views request failed" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const apiBaseUrl = process.env.GAMMASCOPE_API_BASE_URL ?? DEFAULT_API_BASE_URL;
    const upstreamResponse = await fetch(viewsUrl(apiBaseUrl), {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!upstreamResponse.ok) {
      return noStoreJson({ error: "Saved view save failed" }, { status: 502 });
    }

    const upstreamPayload = await upstreamResponse.json();

    if (!isSavedView(upstreamPayload)) {
      return noStoreJson({ error: "Saved view save failed" }, { status: 502 });
    }

    return noStoreJson(upstreamPayload);
  } catch {
    return noStoreJson({ error: "Saved view save failed" }, { status: 502 });
  }
}
