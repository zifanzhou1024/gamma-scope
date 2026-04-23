import { describe, expect, it } from "vitest";
import { seedSnapshot } from "../lib/seedSnapshot";

describe("seedSnapshot", () => {
  it("loads the shared AnalyticsSnapshot fixture", () => {
    expect(seedSnapshot.schema_version).toBe("1.0.0");
    expect(seedSnapshot.symbol).toBe("SPX");
    expect(seedSnapshot.rows).toHaveLength(2);
  });
});
