import { ExposureHeatmap } from "../../components/ExposureHeatmap";
import { loadClientHeatmap, type HeatmapPayload } from "../../lib/clientHeatmapSource";

export default async function HeatmapPage() {
  const initialPayload = await loadLatestHeatmap();

  return <ExposureHeatmap initialPayload={initialPayload} />;
}

export async function loadLatestHeatmap(fetcher: typeof fetch = fetch): Promise<HeatmapPayload | null> {
  return loadClientHeatmap("gex", { fetcher });
}
