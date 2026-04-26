import { NextResponse } from "next/server";
import { parseAdminSessionFromRequest } from "../../../../lib/adminSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(payload: unknown, init?: ResponseInit) {
  const response = NextResponse.json(payload, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: Request) {
  const session = parseAdminSessionFromRequest(request);

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
