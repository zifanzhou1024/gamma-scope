import type { HeatmapNode } from "./clientHeatmapSource";

type HeatmapStatus = {
  isLive: boolean;
  isStale: boolean;
};

export function exposureToneClass(value: number, colorNorm: number): string {
  const sign = value > 0 ? "positive" : value < 0 ? "negative" : "neutral";
  return `heatmapCell-${sign} heatmapCell-intensity-${intensityBucket(colorNorm)}`;
}

export function formatHeatmapStatus(status: HeatmapStatus): "LIVE" | "STALE" | "DELAYED" {
  if (status.isStale) {
    return "STALE";
  }

  return status.isLive ? "LIVE" : "DELAYED";
}

export function formatHeatmapTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/New_York"
  }).format(date);
}

export function compactNodeLabel(node: HeatmapNode): string {
  if (node === null) {
    return "-";
  }

  return `${formatStrike(node.strike)} ${formatCompactMoney(node.value)}`;
}

function intensityBucket(colorNorm: number): number {
  if (!Number.isFinite(colorNorm) || colorNorm <= 0) {
    return 0;
  }

  if (colorNorm < 0.25) {
    return 1;
  }

  if (colorNorm < 0.5) {
    return 2;
  }

  if (colorNorm < 0.75) {
    return 3;
  }

  return 4;
}

function formatStrike(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2);
}

function formatCompactMoney(value: number): string {
  const sign = value < 0 ? "-" : "";
  const absoluteValue = Math.abs(value);

  if (absoluteValue >= 1_000_000_000) {
    return `${sign}$${trimTrailingZero(absoluteValue / 1_000_000_000)}B`;
  }

  if (absoluteValue >= 1_000_000) {
    return `${sign}$${trimTrailingZero(absoluteValue / 1_000_000)}M`;
  }

  if (absoluteValue >= 1_000) {
    return `${sign}$${trimTrailingZero(absoluteValue / 1_000)}K`;
  }

  return `${sign}$${trimTrailingZero(absoluteValue)}`;
}

function trimTrailingZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}
