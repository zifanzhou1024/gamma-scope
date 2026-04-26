import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, parseAdminSessionValue } from "../../../../lib/adminSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(payload: unknown, init?: ResponseInit) {
  const response = NextResponse.json(payload, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function cookieValue(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return undefined;
  }

  for (const cookie of cookieHeader.split(";")) {
    const [cookieName, ...valueParts] = cookie.trim().split("=");
    if (cookieName === name) {
      try {
        return decodeURIComponent(valueParts.join("="));
      } catch {
        return undefined;
      }
    }
  }

  return undefined;
}

export async function GET(request: Request) {
  const session = parseAdminSessionValue(cookieValue(request, ADMIN_COOKIE_NAME));

  if (!session) {
    return noStoreJson({
      authenticated: false,
      csrf_token: null
    });
  }

  return noStoreJson({
    authenticated: true,
    csrf_token: session.csrf_token
  });
}
