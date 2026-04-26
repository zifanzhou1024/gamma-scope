import { NextResponse } from "next/server";
import { verifyAdminRequest } from "../../../../lib/adminSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(payload: unknown, init?: ResponseInit) {
  const response = NextResponse.json(payload, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: Request) {
  const verification = verifyAdminRequest(request);

  if (!verification.ok || !verification.session) {
    return noStoreJson({
      authenticated: false,
      csrf_token: null
    });
  }

  return noStoreJson({
    authenticated: true,
    csrf_token: verification.session.csrf_token
  });
}
