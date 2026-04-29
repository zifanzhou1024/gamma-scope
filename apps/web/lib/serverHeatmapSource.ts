import { HEATMAP_SYMBOLS, isHeatmapPayload, type HeatmapPayload, type HeatmapSymbol } from "./clientHeatmapSource";

const HEATMAP_PROXY_PATH = "/api/spx/0dte/heatmap/latest";

export async function loadLatestHeatmap(
  fetcher: typeof fetch = fetch,
  requestHeaders?: Pick<Headers, "get">
): Promise<HeatmapPayload | null> {
  return loadLatestHeatmapForSymbol("SPX", fetcher, requestHeaders);
}

export async function loadLatestHeatmaps(
  fetcher: typeof fetch = fetch,
  requestHeaders?: Pick<Headers, "get">
): Promise<HeatmapPayload[]> {
  const payloads = await Promise.all(
    HEATMAP_SYMBOLS.map((symbol) => loadLatestHeatmapForSymbol(symbol, fetcher, requestHeaders))
  );

  return payloads.map((payload, index) => payload ?? unavailableHeatmap(HEATMAP_SYMBOLS[index]));
}

async function loadLatestHeatmapForSymbol(
  symbol: HeatmapSymbol,
  fetcher: typeof fetch,
  requestHeaders?: Pick<Headers, "get">
): Promise<HeatmapPayload | null> {
  const params = new URLSearchParams({ metric: "gex", symbol });

  try {
    const response = await fetcher(`${sameOriginProxyUrl(requestHeaders)}?${params.toString()}`, {
      cache: "no-store",
      headers: proxyRequestHeaders(requestHeaders)
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    return isHeatmapPayload(payload) && payload.symbol === symbol ? payload : null;
  } catch {
    return null;
  }
}

function unavailableHeatmap(symbol: HeatmapSymbol): HeatmapPayload {
  return {
    sessionId: `moomoo-${symbol.toLowerCase()}-0dte-unavailable`,
    symbol,
    tradingClass: symbol === "SPX" ? "SPXW" : symbol,
    dte: null,
    expirationDate: "",
    spot: 0,
    metric: "gex",
    positionMode: "oi_proxy",
    oiBaselineStatus: "provisional",
    oiBaselineCapturedAt: null,
    lastSyncedAt: "",
    isLive: false,
    isStale: true,
    persistenceStatus: "unavailable",
    rows: [],
    nodes: {
      king: null,
      positiveKing: null,
      negativeKing: null,
      aboveWall: null,
      belowWall: null
    }
  };
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
