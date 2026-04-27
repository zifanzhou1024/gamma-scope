import {
  proxyUrl,
  replayImportPath,
  replayImportRequestFailed,
  replayImportResponse,
  replayImportTooLargeResponse,
  replayImportUploadTooLarge,
  upstreamHeaders,
  verifyReplayImportProxy,
  type StreamingRequestInit
} from "../../../../lib/replayImportProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const proxy = verifyReplayImportProxy(request, { csrf: true });
  if (proxy instanceof Response) {
    return proxy;
  }

  if (replayImportUploadTooLarge(request)) {
    return replayImportTooLargeResponse();
  }

  try {
    const init: StreamingRequestInit = {
      method: "POST",
      cache: "no-store",
      headers: upstreamHeaders(proxy.adminToken, request),
      body: request.body,
      duplex: "half"
    };
    const upstreamResponse = await fetch(proxyUrl(proxy.apiBaseUrl, replayImportPath()), init);

    return replayImportResponse(upstreamResponse);
  } catch {
    return replayImportRequestFailed();
  }
}
