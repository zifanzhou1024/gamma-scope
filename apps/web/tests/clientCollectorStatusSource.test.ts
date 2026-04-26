import { describe, expect, it, vi } from "vitest";
import type { CollectorHealth } from "@gammascope/contracts/collector-events";
import { isCollectorHealth, loadClientCollectorHealth } from "../lib/clientCollectorStatusSource";

function collectorHealth(overrides: Partial<CollectorHealth> = {}): CollectorHealth {
  return {
    schema_version: "1.0.0",
    source: "ibkr",
    collector_id: "local-dev",
    status: "connected",
    ibkr_account_mode: "paper",
    message: "Collector ready",
    event_time: "2026-04-24T15:00:00Z",
    received_time: "2026-04-24T15:00:01Z",
    ...overrides
  };
}

function jsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: async () => payload
  } as Response;
}

describe("isCollectorHealth", () => {
  it("validates the CollectorHealth contract shape", () => {
    expect(isCollectorHealth(collectorHealth())).toBe(true);
    expect(isCollectorHealth({ ...collectorHealth(), status: "warming" })).toBe(false);
    expect(isCollectorHealth({ ...collectorHealth(), ibkr_account_mode: "demo" })).toBe(false);
    expect(isCollectorHealth({ ...collectorHealth(), collector_id: 123 })).toBe(false);
  });

  it("rejects payloads with additional properties", () => {
    expect(isCollectorHealth({ ...collectorHealth(), extra: true })).toBe(false);
  });

  it("rejects empty collector IDs", () => {
    expect(isCollectorHealth(collectorHealth({ collector_id: "" }))).toBe(false);
  });

  it("rejects invalid event timestamps", () => {
    expect(isCollectorHealth(collectorHealth({ event_time: "not-a-date" }))).toBe(false);
    expect(isCollectorHealth(collectorHealth({ received_time: "2026-04-24 15:00:01" }))).toBe(false);
  });

  it("rejects impossible calendar dates while accepting valid leap dates", () => {
    expect(isCollectorHealth(collectorHealth({ event_time: "2026-02-31T00:00:00Z" }))).toBe(false);
    expect(isCollectorHealth(collectorHealth({ received_time: "2025-02-29T00:00:00Z" }))).toBe(false);
    expect(isCollectorHealth(collectorHealth({
      event_time: "2024-02-29T00:00:00Z",
      received_time: "2024-02-29T00:00:01Z"
    }))).toBe(true);
  });
});

describe("loadClientCollectorHealth", () => {
  it("requests collector status from the relative API route", async () => {
    const payload = collectorHealth();
    const fetcher = vi.fn(async () => jsonResponse(payload));

    await loadClientCollectorHealth({ fetcher });

    expect(fetcher).toHaveBeenCalledWith("/api/spx/0dte/status", {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });
  });

  it("returns a valid CollectorHealth payload", async () => {
    const payload = collectorHealth();
    const fetcher = vi.fn(async () => jsonResponse(payload));

    await expect(loadClientCollectorHealth({ fetcher })).resolves.toBe(payload);
  });

  it("returns null for invalid payloads", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ ...collectorHealth(), received_time: null }));

    await expect(loadClientCollectorHealth({ fetcher })).resolves.toBeNull();
  });

  it("returns null for non-OK HTTP responses", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ error: "unavailable" }, false));

    await expect(loadClientCollectorHealth({ fetcher })).resolves.toBeNull();
  });

  it("returns null when fetching rejects", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("offline");
    });

    await expect(loadClientCollectorHealth({ fetcher })).resolves.toBeNull();
  });
});
