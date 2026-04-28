import { ExposureHeatmap } from "../../components/ExposureHeatmap";
import { headers } from "next/headers";
import { loadLatestHeatmaps } from "../../lib/serverHeatmapSource";

export default async function HeatmapPage() {
  const initialPayloads = await loadLatestHeatmaps(fetch, await headers());

  return <ExposureHeatmap initialPayloads={initialPayloads} />;
}
