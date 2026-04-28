import { isHeatmapPayload, type HeatmapPayload } from "./clientHeatmapSource";

const HEATMAP_PROXY_PATH = "/api/spx/0dte/heatmap/latest";

export async function loadLatestHeatmap(
  fetcher: typeof fetch = fetch,
  requestHeaders?: Pick<Headers, "get">
): Promise<HeatmapPayload | null> {
  const params = new URLSearchParams({ metric: "gex" });

  try {
    const response = await fetcher(`${sameOriginProxyUrl(requestHeaders)}?${params.toString()}`, {
      cache: "no-store",
      headers: proxyRequestHeaders(requestHeaders)
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    return isHeatmapPayload(payload) ? payload : null;
  } catch {
    return null;
  }
}

function sameOriginProxyUrl(requestHeaders?: Pick<Headers, "get">): string {
  const host = requestHeaders?.get("x-forwarded-host") ?? requestHeaders?.get("host") ?? "localhost:3000";
  const protocol = requestHeaders?.get("x-forwarded-proto") ?? "http";

  return `${protocol}://${host}${HEATMAP_PROXY_PATH}`;
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
