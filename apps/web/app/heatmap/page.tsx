import { ExposureHeatmap } from "../../components/ExposureHeatmap";
import { headers } from "next/headers";
import { loadLatestHeatmap } from "../../lib/serverHeatmapSource";

export default async function HeatmapPage() {
  const initialPayload = await loadLatestHeatmap(fetch, await headers());

  return <ExposureHeatmap initialPayload={initialPayload} />;
}
