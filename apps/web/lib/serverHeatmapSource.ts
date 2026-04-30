import { HEATMAP_SYMBOLS, isHeatmapPayload, type HeatmapPayload, type HeatmapSymbol } from "./clientHeatmapSource";
import { backendApiUrl, backendJsonHeaders } from "./serverBackendFetch";

const HEATMAP_PATH = "/api/spx/0dte/heatmap/latest";

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
    const response = await fetcher(backendApiUrl(HEATMAP_PATH, params), {
      cache: "no-store",
      headers: backendJsonHeaders(requestHeaders)
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
