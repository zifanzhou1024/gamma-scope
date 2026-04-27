import { formatInteger, formatNumber, formatPercent, formatPrice } from "./dashboardMetrics";
import type { AnalyticsSnapshot } from "./contracts";

type AnalyticsRow = AnalyticsSnapshot["rows"][number];
type OptionSide = "call" | "put";

export interface StrikeInspectionSide {
  bid: string;
  ask: string;
  mid: string;
  iv: string;
  gamma: string;
  vanna: string;
  openInterest: string;
}

export interface StrikeInspection {
  strike: number;
  distanceLabel: string;
  call: StrikeInspectionSide;
  put: StrikeInspectionSide;
}

export function deriveStrikeInspection(
  rows: AnalyticsRow[],
  strike: number | null,
  spot: number
): StrikeInspection | null {
  if (strike == null) {
    return null;
  }

  const call = findStrikeSide(rows, strike, "call");
  const put = findStrikeSide(rows, strike, "put");

  return {
    strike,
    distanceLabel: formatStrikeDistance(strike, spot),
    call: formatInspectionSide(call),
    put: formatInspectionSide(put)
  };
}

function findStrikeSide(rows: AnalyticsRow[], strike: number, side: OptionSide): AnalyticsRow | null {
  return rows.find((row) => row.strike === strike && row.right === side) ?? null;
}

function formatInspectionSide(row: AnalyticsRow | null): StrikeInspectionSide {
  return {
    bid: formatPrice(row?.bid),
    ask: formatPrice(row?.ask),
    mid: formatPrice(row?.mid),
    iv: formatPercent(row?.custom_iv),
    gamma: formatNumber(row?.custom_gamma, 5),
    vanna: formatNumber(row?.custom_vanna, 5),
    openInterest: formatInteger(row?.open_interest)
  };
}

function formatStrikeDistance(strike: number, spot: number): string {
  const distance = Math.round(strike - spot);
  if (distance === 0) {
    return "At spot";
  }
  return `${distance > 0 ? "+" : ""}${distance} pts from spot`;
}
