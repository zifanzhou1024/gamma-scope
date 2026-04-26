import {
  proxyUrl,
  replayImportPath,
  replayImportRequestFailed,
  replayImportResponse,
  upstreamHeaders,
  verifyReplayImportProxy,
  type ImportRouteContext
} from "../../../../../../lib/replayImportProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function confirmReplayImportUrl(apiBaseUrl: string, context: ImportRouteContext): Promise<string> {
  const { importId } = await context.params;
  return proxyUrl(apiBaseUrl, replayImportPath(importId, "confirm"));
}

export async function POST(request: Request, context: ImportRouteContext) {
  const proxy = verifyReplayImportProxy(request, { csrf: true });
  if (proxy instanceof Response) {
    return proxy;
  }

  try {
    const upstreamResponse = await fetch(await confirmReplayImportUrl(proxy.apiBaseUrl, context), {
      method: "POST",
      cache: "no-store",
      headers: upstreamHeaders(proxy.adminToken)
    });

    return replayImportResponse(upstreamResponse);
  } catch {
    return replayImportRequestFailed();
  }
}
