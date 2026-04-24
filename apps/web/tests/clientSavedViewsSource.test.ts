import { describe, expect, it, vi } from "vitest";
import type { SavedView } from "@gammascope/contracts/saved-view";
import { seedSnapshot } from "../lib/seedSnapshot";
import {
  createSavedViewDraft,
  isSavedViewArray,
  loadClientSavedViews,
  saveClientSavedView
} from "../lib/clientSavedViewsSource";

function savedView(overrides: Partial<SavedView> = {}): SavedView {
  return {
    view_id: "saved-view-1",
    owner_scope: "public_demo",
    name: "Replay review",
    mode: "replay",
    strike_window: {
      levels_each_side: 20
    },
    visible_charts: ["iv_smile", "gamma_by_strike", "vanna_by_strike"],
    created_at: "2026-04-24T17:00:00Z",
    ...overrides
  };
}

function jsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: async () => payload
  } as Response;
}

describe("saved views client source", () => {
  it("validates saved view arrays", () => {
    expect(isSavedViewArray([savedView()])).toBe(true);
    expect(isSavedViewArray([{ ...savedView(), visible_charts: [] }])).toBe(false);
    expect(isSavedViewArray([{ ...savedView(), owner_scope: "everyone" }])).toBe(false);
  });

  it("loads saved views from the relative API route", async () => {
    const views = [savedView()];
    const fetcher = vi.fn(async () => jsonResponse(views));

    await expect(loadClientSavedViews({ fetcher })).resolves.toEqual(views);
    expect(fetcher).toHaveBeenCalledWith("/api/views", {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });
  });

  it("returns an empty list when saved views cannot be loaded", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ error: "unavailable" }, false));

    await expect(loadClientSavedViews({ fetcher })).resolves.toEqual([]);
  });

  it("saves a view through the relative API route", async () => {
    const view = savedView();
    const fetcher = vi.fn(async () => jsonResponse(view));

    await expect(saveClientSavedView(view, { fetcher })).resolves.toEqual(view);
    expect(fetcher).toHaveBeenCalledWith("/api/views", {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(view)
    });
  });

  it("returns null when saved view creation returns an invalid payload", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ ...savedView(), name: "" }));

    await expect(saveClientSavedView(savedView(), { fetcher })).resolves.toBeNull();
  });

  it("creates a saved view draft from the current snapshot", () => {
    expect(createSavedViewDraft(seedSnapshot, {
      name: "Morning replay",
      viewId: "view-demo",
      createdAt: "2026-04-24T17:00:00Z"
    })).toEqual({
      view_id: "view-demo",
      owner_scope: "public_demo",
      name: "Morning replay",
      mode: seedSnapshot.mode,
      strike_window: {
        levels_each_side: 20
      },
      visible_charts: ["iv_smile", "gamma_by_strike", "vanna_by_strike"],
      created_at: "2026-04-24T17:00:00Z"
    });
  });
});
