import { NextResponse } from "next/server";
import { verifyAdminRequest } from "../../../../../../lib/adminSession";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
const EXPERIMENTAL_LATEST_PATH = "/api/spx/0dte/experimental/latest";
const ADMIN_TOKEN_HEADER = "X-GammaScope-Admin-Token";

function experimentalLatestUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl.replace(/\/+$/, "")}${EXPERIMENTAL_LATEST_PATH}`;
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
    const upstreamResponse = await fetch(experimentalLatestUrl(apiBaseUrl), {
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
    return noStoreJson({ error: "Experimental analytics unavailable" }, { status: 502 });
  }
}
