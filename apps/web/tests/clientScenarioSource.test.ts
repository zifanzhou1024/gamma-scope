import { describe, expect, it, vi } from "vitest";
import type { AnalyticsSnapshot } from "../lib/contracts";
import { seedSnapshot } from "../lib/seedSnapshot";
import { requestClientScenarioSnapshot } from "../lib/clientScenarioSource";

function apiSnapshot(): AnalyticsSnapshot {
  return {
    ...seedSnapshot,
    session_id: "scenario-api-session",
    mode: "scenario",
    scenario_params: {
      spot_shift_points: 12.5,
      vol_shift_points: -1.25,
      time_shift_minutes: 15
    }
  };
}

function scenarioRequest() {
  return {
    session_id: "live-session",
    snapshot_time: "2026-04-24T15:45:00Z",
    spot_shift_points: 12.5,
    vol_shift_points: -1.25,
    time_shift_minutes: 15
  };
}

function jsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: async () => payload
  } as Response;
}

describe("requestClientScenarioSnapshot", () => {
  it("posts the scenario request to the relative API route", async () => {
    const request = scenarioRequest();
    const fetcher = vi.fn(async () => jsonResponse(apiSnapshot()));

    await requestClientScenarioSnapshot(request, { fetcher });

    expect(fetcher).toHaveBeenCalledWith("/api/spx/0dte/scenario", {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(request)
    });
  });

  it("returns a valid scenario snapshot", async () => {
    const snapshot = apiSnapshot();
    const fetcher = vi.fn(async () => jsonResponse(snapshot));

    await expect(requestClientScenarioSnapshot(scenarioRequest(), { fetcher })).resolves.toBe(snapshot);
  });

  it("returns null when fetching rejects", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("offline");
    });

    await expect(requestClientScenarioSnapshot(scenarioRequest(), { fetcher })).resolves.toBeNull();
  });

  it("returns null for non-OK HTTP responses", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ error: "unavailable" }, false));

    await expect(requestClientScenarioSnapshot(scenarioRequest(), { fetcher })).resolves.toBeNull();
  });

  it("returns null for invalid payloads", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ ...apiSnapshot(), rows: "nope" }));

    await expect(requestClientScenarioSnapshot(scenarioRequest(), { fetcher })).resolves.toBeNull();
  });
});
