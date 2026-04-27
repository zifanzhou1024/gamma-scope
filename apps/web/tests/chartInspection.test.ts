import { describe, expect, it } from "vitest";
import { deriveStrikeInspection } from "../lib/chartInspection";
import type { AnalyticsSnapshot } from "../lib/contracts";

type Row = AnalyticsSnapshot["rows"][number];

describe("deriveStrikeInspection", () => {
  it("derives call and put tooltip values for the selected strike", () => {
    const rows = [
      row({
        strike: 5200,
        right: "call",
        bid: 1,
        ask: 1.2,
        mid: 1.1,
        custom_iv: 0.18,
        custom_gamma: 0.01,
        custom_vanna: -0.02,
        open_interest: 100
      }),
      row({
        strike: 5200,
        right: "put",
        bid: 2,
        ask: 2.4,
        mid: 2.2,
        custom_iv: 0.21,
        custom_gamma: 0.03,
        custom_vanna: 0.04,
        open_interest: 250
      })
    ];

    expect(deriveStrikeInspection(rows, 5200, 5198.75)).toEqual({
      strike: 5200,
      distanceLabel: "+1 pts from spot",
      call: {
        bid: "1.00",
        ask: "1.20",
        mid: "1.10",
        iv: "18.00%",
        gamma: "0.01000",
        vanna: "-0.02000",
        openInterest: "100"
      },
      put: {
        bid: "2.00",
        ask: "2.40",
        mid: "2.20",
        iv: "21.00%",
        gamma: "0.03000",
        vanna: "0.04000",
        openInterest: "250"
      }
    });
  });

  it("returns null without a selected strike and uses em dashes for missing side values", () => {
    expect(deriveStrikeInspection([], null, 5200)).toBeNull();

    const inspection = deriveStrikeInspection(
      [row({ strike: 5210, right: "call", bid: null, ask: null, mid: null })],
      5210,
      5200
    );

    expect(inspection?.put.bid).toBe("—");
    expect(inspection?.call.bid).toBe("—");
    expect(inspection?.distanceLabel).toBe("+10 pts from spot");
  });

  it("labels strikes that round to the spot and negative distances", () => {
    expect(deriveStrikeInspection([], 5200, 5200.4)?.distanceLabel).toBe("At spot");
    expect(deriveStrikeInspection([], 5190, 5200)?.distanceLabel).toBe("-10 pts from spot");
  });
});

function row({ strike, right, ...overrides }: Partial<Row> & Pick<Row, "strike" | "right">): Row {
  return {
    contract_id: `SPXW-${right}-${strike}`,
    strike,
    right,
    bid: 1,
    ask: 1.2,
    mid: 1.1,
    custom_iv: null,
    custom_gamma: null,
    custom_vanna: null,
    open_interest: null,
    ibkr_iv: null,
    ibkr_gamma: null,
    ibkr_vanna: null,
    iv_diff: null,
    gamma_diff: null,
    comparison_status: "missing",
    calc_status: "ok",
    ...overrides
  };
}
