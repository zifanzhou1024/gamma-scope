import { verifyAdminRequest } from "./adminSession";

export const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
export const ADMIN_TOKEN_HEADER = "X-GammaScope-Admin-Token";

export function backendApiUrl(
  path: string,
  searchParams?: URLSearchParams,
  apiBaseUrl = process.env.GAMMASCOPE_API_BASE_URL ?? DEFAULT_API_BASE_URL
): string {
  const base = apiBaseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const query = searchParams?.toString();

  return query ? `${base}${normalizedPath}?${query}` : `${base}${normalizedPath}`;
}

export function backendJsonHeaders(requestHeaders?: Pick<Headers, "get">): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json"
  };
  const adminToken = process.env.GAMMASCOPE_ADMIN_TOKEN?.trim();

  if (adminToken && requestHeaders && requestHasValidAdminSession(requestHeaders)) {
    headers[ADMIN_TOKEN_HEADER] = adminToken;
  }

  return headers;
}

function requestHasValidAdminSession(requestHeaders: Pick<Headers, "get">): boolean {
  const cookie = requestHeaders.get("cookie");
  if (!cookie) {
    return false;
  }

  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const request = new Request(`${protocol}://${host}/__gammascope_backend_fetch_auth`, {
    headers: {
      cookie
    }
  });

  return verifyAdminRequest(request, { csrf: false }).ok;
}
