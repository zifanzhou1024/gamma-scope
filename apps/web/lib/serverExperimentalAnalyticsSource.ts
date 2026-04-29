import seed from "../../../packages/contracts/fixtures/experimental-analytics.seed.json";
import { isExperimentalAnalytics } from "./clientExperimentalAnalyticsSource";
import type { ExperimentalAnalytics } from "./contracts";

const EXPERIMENTAL_LATEST_PROXY_PATH = "/api/spx/0dte/experimental/latest";

const seedExperimentalAnalytics = seed as ExperimentalAnalytics;

export async function loadLatestExperimentalAnalytics(
  fetcher: typeof fetch = fetch,
  requestHeaders?: Pick<Headers, "get">
): Promise<ExperimentalAnalytics> {
  try {
    const response = await fetcher(sameOriginProxyUrl(requestHeaders), {
      cache: "no-store",
      headers: proxyRequestHeaders(requestHeaders)
    });

    if (!response.ok) {
      return seedExperimentalAnalytics;
    }

    const payload = await response.json();
    return isExperimentalAnalytics(payload) ? payload : seedExperimentalAnalytics;
  } catch {
    return seedExperimentalAnalytics;
  }
}

function sameOriginProxyUrl(requestHeaders?: Pick<Headers, "get">): string {
  const host = requestHeaders?.get("x-forwarded-host") ?? requestHeaders?.get("host") ?? "localhost:3000";
  const protocol = requestHeaders?.get("x-forwarded-proto") ?? "http";

  return `${protocol}://${host}${EXPERIMENTAL_LATEST_PROXY_PATH}`;
}

function proxyRequestHeaders(requestHeaders?: Pick<Headers, "get">): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json"
  };
  const cookie = requestHeaders?.get("cookie");

  if (cookie) {
    headers.Cookie = cookie;
  }

  return headers;
}
