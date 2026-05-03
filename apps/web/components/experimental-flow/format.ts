import { formatNumber, formatPercent, formatPrice, formatStatusLabel } from "../../lib/dashboardMetrics";

export function formatFlowCount(value: number | null | undefined): string {
  if (value == null) {
    return "-";
  }

  return value.toLocaleString("en-US", {
    maximumFractionDigits: 0
  });
}

export function formatFlowPremium(value: number | null | undefined): string {
  if (value == null) {
    return "-";
  }

  const sign = value < 0 ? "-" : "";
  return `${sign}$${formatCompact(Math.abs(value))}`;
}

export function formatFlowGreek(value: number | null | undefined): string {
  if (value == null) {
    return "-";
  }

  return formatCompact(value);
}

export function formatFlowStrike(value: number): string {
  return formatPrice(value).replace(".00", "");
}

export function formatFlowScore(value: number | null | undefined): string {
  return formatPercent(value, 0);
}

export function formatFlowLabel(value: string): string {
  return formatStatusLabel(value);
}

export function formatSignedFlow(value: number | null | undefined): string {
  if (value == null) {
    return "-";
  }

  if (value === 0) {
    return "0";
  }

  return `${value > 0 ? "+" : ""}${formatNumber(value, 0)}`;
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    notation: "compact"
  }).format(value);
}
