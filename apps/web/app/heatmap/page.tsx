import { ExposureHeatmap } from "../../components/ExposureHeatmap";
import { isHeatmapPayload, type HeatmapPayload } from "../../lib/clientHeatmapSource";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
const HEATMAP_PATH = "/api/spx/0dte/heatmap/latest";

export default async function HeatmapPage() {
  const initialPayload = await loadLatestHeatmap();

  return <ExposureHeatmap initialPayload={initialPayload} />;
}

export async function loadLatestHeatmap(fetcher: typeof fetch = fetch): Promise<HeatmapPayload | null> {
  const apiBaseUrl = process.env.GAMMASCOPE_API_BASE_URL ?? DEFAULT_API_BASE_URL;
  const url = `${apiBaseUrl.replace(/\/+$/, "")}${HEATMAP_PATH}?metric=gex`;

  try {
    const response = await fetcher(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
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
