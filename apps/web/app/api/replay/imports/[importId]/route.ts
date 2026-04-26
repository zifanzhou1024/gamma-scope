import {
  proxyUrl,
  replayImportPath,
  replayImportRequestFailed,
  replayImportResponse,
  upstreamHeaders,
  verifyReplayImportProxy,
  type ImportRouteContext
} from "../../../../../lib/replayImportProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function replayImportUrl(apiBaseUrl: string, context: ImportRouteContext): Promise<string> {
  const { importId } = await context.params;
  return proxyUrl(apiBaseUrl, replayImportPath(importId));
}

async function proxyImportRequest(request: Request, context: ImportRouteContext, method: "GET" | "DELETE") {
  const proxy = verifyReplayImportProxy(request, { csrf: method === "DELETE" });
  if (proxy instanceof Response) {
    return proxy;
  }

  try {
    const upstreamResponse = await fetch(await replayImportUrl(proxy.apiBaseUrl, context), {
      method,
      cache: "no-store",
      headers: upstreamHeaders(proxy.adminToken)
    });

    return replayImportResponse(upstreamResponse);
  } catch {
    return replayImportRequestFailed();
  }
}

export async function GET(request: Request, context: ImportRouteContext) {
  return proxyImportRequest(request, context, "GET");
}

export async function DELETE(request: Request, context: ImportRouteContext) {
  return proxyImportRequest(request, context, "DELETE");
}
