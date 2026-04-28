import { NextResponse } from "next/server";
import { verifyAdminRequest } from "../../../../../../lib/adminSession";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
const HEATMAP_PATH = "/api/spx/0dte/heatmap/latest";
const ADMIN_TOKEN_HEADER = "X-GammaScope-Admin-Token";

function heatmapUrl(apiBaseUrl: string, requestUrl: string): string {
  const sourceUrl = new URL(requestUrl);
  return `${apiBaseUrl.replace(/\/+$/, "")}${HEATMAP_PATH}${sourceUrl.search}`;
}

function noStoreJson(payload: unknown, init?: ResponseInit) {
  const response = NextResponse.json(payload, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function upstreamHeaders(request: Request): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json"
  };
  const adminToken = process.env.GAMMASCOPE_ADMIN_TOKEN?.trim();

  if (adminToken && verifyAdminRequest(request, { csrf: false }).ok) {
    headers[ADMIN_TOKEN_HEADER] = adminToken;
  }

  return headers;
}

export async function GET(request: Request): Promise<Response> {
  const apiBaseUrl = process.env.GAMMASCOPE_API_BASE_URL ?? DEFAULT_API_BASE_URL;

  try {
    const upstreamResponse = await fetch(heatmapUrl(apiBaseUrl, request.url), {
      cache: "no-store",
      headers: upstreamHeaders(request)
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
    return noStoreJson({ error: "Heatmap API unavailable" }, { status: 502 });
  }
}
