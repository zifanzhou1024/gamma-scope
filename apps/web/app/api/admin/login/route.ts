import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE_NAME,
  adminLoginAvailable,
  createAdminSessionValue,
  verifyAdminCredentials
} from "../../../../lib/adminSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(payload: unknown, init?: ResponseInit) {
  const response = NextResponse.json(payload, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function secureCookie(request: Request): boolean {
  const hostedEnv = process.env.VERCEL || process.env.RENDER || process.env.FLY_APP_NAME;
  return new URL(request.url).protocol === "https:" || process.env.NODE_ENV === "production" || Boolean(hostedEnv);
}

function sessionCookie(value: string, request: Request): string {
  const attributes = [
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Max-Age=28800",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax"
  ];

  if (secureCookie(request)) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

export async function POST(request: Request) {
  if (!adminLoginAvailable()) {
    return noStoreJson({
      authenticated: false,
      error: "Admin login unavailable"
    }, { status: 503 });
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const credentials = payload && typeof payload === "object"
    ? payload as { username?: unknown; password?: unknown }
    : {};
  const username = typeof credentials.username === "string" ? credentials.username : "";
  const password = typeof credentials.password === "string" ? credentials.password : "";

  if (!verifyAdminCredentials(username, password)) {
    return noStoreJson({
      authenticated: false,
      error: "Invalid credentials"
    }, { status: 401 });
  }

  const response = noStoreJson({ authenticated: true });
  response.headers.set("Set-Cookie", sessionCookie(createAdminSessionValue(), request));

  return response;
}
