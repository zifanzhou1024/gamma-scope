import { NextResponse } from "next/server";
import { loadDashboardSnapshot } from "../../../../../../lib/snapshotSource";

export async function GET() {
  const response = NextResponse.json(await loadDashboardSnapshot());
  response.headers.set("Cache-Control", "no-store");
  return response;
}
