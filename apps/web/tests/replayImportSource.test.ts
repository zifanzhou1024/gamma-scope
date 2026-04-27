import { describe, expect, it, vi } from "vitest";
import {
  cancelReplayImport,
  confirmReplayImport,
  isReplayImportResult,
  loadReplayImport,
  uploadReplayImport,
  type ReplayImportResult
} from "../lib/replayImportSource";

function importResult(overrides: Partial<ReplayImportResult> = {}): ReplayImportResult {
  return {
    import_id: "import-test-1",
    status: "awaiting_confirmation",
    summary: { rows: 42 },
    warnings: ["missing iv for 1 row"],
    errors: [],
    session_id: null,
    replay_url: null,
    ...overrides
  };
}

function jsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: async () => payload
  } as Response;
}

describe("isReplayImportResult", () => {
  it("accepts valid replay import payloads", () => {
    expect(isReplayImportResult(importResult())).toBe(true);
    expect(isReplayImportResult(importResult({
      status: "completed",
      session_id: "session-1",
      replay_url: "/replay?session_id=session-1"
    }))).toBe(true);
  });

  it("rejects invalid replay import payloads", () => {
    expect(isReplayImportResult({ ...importResult(), import_id: 1 })).toBe(false);
    expect(isReplayImportResult({ ...importResult(), status: "ready" })).toBe(false);
    expect(isReplayImportResult({ ...importResult(), summary: null })).toBe(false);
    expect(isReplayImportResult({ ...importResult(), warnings: [1] })).toBe(false);
    expect(isReplayImportResult({ ...importResult(), errors: "none" })).toBe(false);
    expect(isReplayImportResult({ ...importResult(), session_id: 1 })).toBe(false);
    expect(isReplayImportResult({ ...importResult(), replay_url: 1 })).toBe(false);
  });
});

describe("replay import client helpers", () => {
  it("uploads multipart data to the website import route with the CSRF header", async () => {
    const files = new FormData();
    const file = new Blob(["symbol,expiry\nSPX,2026-04-24\n"], { type: "text/csv" });
    files.append("file", file, "replay.csv");
    const fetcher = vi.fn(async () => jsonResponse(importResult()));
    vi.stubGlobal("fetch", fetcher);

    await expect(uploadReplayImport(files, "csrf-token")).resolves.toEqual(importResult());

    expect(fetcher).toHaveBeenCalledWith("/api/replay/imports", {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "X-GammaScope-CSRF": "csrf-token"
      },
      body: files
    });
    vi.unstubAllGlobals();
  });

  it("loads an import from the website route", async () => {
    const fetcher = vi.fn(async () => jsonResponse(importResult()));
    vi.stubGlobal("fetch", fetcher);

    await expect(loadReplayImport("import test/1")).resolves.toEqual(importResult());

    expect(fetcher).toHaveBeenCalledWith("/api/replay/imports/import%20test%2F1", {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });
    vi.unstubAllGlobals();
  });

  it("confirms an import through the website route with the CSRF header", async () => {
    const fetcher = vi.fn(async () => jsonResponse(importResult({ status: "completed" })));
    vi.stubGlobal("fetch", fetcher);

    await expect(confirmReplayImport("import test/1", "csrf-token")).resolves.toEqual(importResult({ status: "completed" }));

    expect(fetcher).toHaveBeenCalledWith("/api/replay/imports/import%20test%2F1/confirm", {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "X-GammaScope-CSRF": "csrf-token"
      }
    });
    vi.unstubAllGlobals();
  });

  it("cancels an import through the website route with the CSRF header", async () => {
    const fetcher = vi.fn(async () => jsonResponse(importResult({ status: "cancelled" })));
    vi.stubGlobal("fetch", fetcher);

    await expect(cancelReplayImport("import test/1", "csrf-token")).resolves.toEqual(importResult({ status: "cancelled" }));

    expect(fetcher).toHaveBeenCalledWith("/api/replay/imports/import%20test%2F1", {
      method: "DELETE",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "X-GammaScope-CSRF": "csrf-token"
      }
    });
    vi.unstubAllGlobals();
  });

  it("fails closed for fetch errors, non-OK responses, and invalid payloads", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    await expect(loadReplayImport("import-test-1")).resolves.toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "nope" }, false)));
    await expect(confirmReplayImport("import-test-1", "csrf-token")).resolves.toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ...importResult(), status: "ready" })));
    await expect(cancelReplayImport("import-test-1", "csrf-token")).resolves.toBeNull();

    vi.unstubAllGlobals();
  });
});
