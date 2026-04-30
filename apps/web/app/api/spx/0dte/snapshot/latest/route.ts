import { NextResponse } from "next/server";
import { loadDashboardSnapshot } from "../../../../../../lib/serverSnapshotSource";

export async function GET(request: Request) {
  const response = NextResponse.json(await loadDashboardSnapshot({
    requestHeaders: request.headers
  }));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
