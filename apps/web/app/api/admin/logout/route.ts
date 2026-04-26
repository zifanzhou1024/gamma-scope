import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME } from "../../../../lib/adminSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(payload: unknown, init?: ResponseInit) {
  const response = NextResponse.json(payload, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function secureCookie(request?: Request): boolean {
  const hostedEnv = process.env.VERCEL || process.env.RENDER || process.env.FLY_APP_NAME;
  return (request ? new URL(request.url).protocol === "https:" : false)
    || process.env.NODE_ENV === "production"
    || Boolean(hostedEnv);
}

function clearedSessionCookie(request?: Request): string {
  const attributes = [
    `${ADMIN_COOKIE_NAME}=`,
    "Max-Age=0",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax"
  ];

  if (secureCookie(request)) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

export async function POST(request?: Request) {
  const response = noStoreJson({ authenticated: false });
  response.headers.set("Set-Cookie", clearedSessionCookie(request));

  return response;
}
