import { afterEach, describe, expect, it, vi } from "vitest";
import type { SavedView } from "@gammascope/contracts/saved-view";

function savedView(overrides: Partial<SavedView> = {}): SavedView {
  return {
    view_id: "route-view-1",
    owner_scope: "public_demo",
    name: "Route replay view",
    mode: "replay",
    strike_window: {
      levels_each_side: 20
    },
    visible_charts: ["iv_smile", "gamma_by_strike", "vanna_by_strike"],
    created_at: "2026-04-24T17:00:00Z",
    ...overrides
  };
}

function jsonResponse(payload: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    json: async () => payload
  } as Response;
}

describe("/api/views", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards saved view list requests to FastAPI without caching", async () => {
    const views = [savedView()];
    const fetcher = vi.fn(async () => jsonResponse(views));
    vi.stubGlobal("fetch", fetcher);

    const { GET } = await import("../app/api/views/route");
    const response = await GET();

    await expect(response.json()).resolves.toEqual(views);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:8000/api/views", {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });
  });

  it("forwards saved view creation requests to FastAPI without caching", async () => {
    const view = savedView();
    const fetcher = vi.fn(async () => jsonResponse(view));
    vi.stubGlobal("fetch", fetcher);

    const { POST } = await import("../app/api/views/route");
    const response = await POST(new Request("http://localhost/api/views", {
      method: "POST",
      body: JSON.stringify(view)
    }));

    await expect(response.json()).resolves.toEqual(view);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:8000/api/views", {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(view)
    });
  });

  it("returns a no-store 502 response when FastAPI returns invalid saved views", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([{ ...savedView(), name: "" }])));

    const { GET } = await import("../app/api/views/route");
    const response = await GET();

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Saved views request failed" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns a no-store 502 response when FastAPI rejects saved view creation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "invalid" }, false, 422)));

    const { POST } = await import("../app/api/views/route");
    const response = await POST(new Request("http://localhost/api/views", {
      method: "POST",
      body: JSON.stringify(savedView())
    }));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Saved view save failed" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
