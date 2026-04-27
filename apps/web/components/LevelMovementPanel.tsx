import React from "react";
import type { LevelMovements, LevelMovement } from "../lib/dashboardMetrics";
import { formatNumber, formatPrice } from "../lib/dashboardMetrics";

const movementItems: Array<{
  key: keyof LevelMovements;
  label: string;
  valueKind: "price" | "strike";
}> = [
  { key: "spot", label: "Spot", valueKind: "price" },
  { key: "callIvLowStrike", label: "Call IV low", valueKind: "strike" },
  { key: "putIvLowStrike", label: "Put IV low", valueKind: "strike" },
  { key: "gammaPeakStrike", label: "Gamma peak", valueKind: "strike" },
  { key: "vannaFlipStrike", label: "Vanna flip", valueKind: "strike" }
];

export function LevelMovementPanel({
  movements,
  historyCount
}: {
  movements: LevelMovements;
  historyCount: number;
}) {
  const isWaiting = historyCount < 2;

  return (
    <section className="levelMovementPanel" aria-label="Level movement" data-level-movement-panel>
      <div className="sectionHeader">
        <div>
          <h2>LEVEL MOVEMENT</h2>
          <p>{isWaiting ? "Waiting for next snapshot" : "Recent level changes across snapshots."}</p>
        </div>
      </div>
      <div className="levelMovementGrid">
        {movementItems.map((item) => (
          <LevelMovementItem
            key={item.key}
            label={item.label}
            movement={movements[item.key]}
            valueKind={item.valueKind}
            isWaiting={isWaiting}
          />
        ))}
      </div>
    </section>
  );
}

function LevelMovementItem({
  label,
  movement,
  valueKind,
  isWaiting
}: {
  label: string;
  movement: LevelMovement;
  valueKind: "price" | "strike";
  isWaiting: boolean;
}) {
  return (
    <div className={`levelMovementItem levelMovementItem-${movement.direction.toLowerCase()}`}>
      <span className="levelMovementLabel">{label}</span>
      <strong className="levelMovementValue">{formatMovementCurrent(movement, valueKind)}</strong>
      <small className="levelMovementDetail">
        {isWaiting
          ? "Needs next snapshot"
          : `Prev ${formatMovementValue(movement.previous, valueKind)} · Now ${formatMovementValue(
              movement.current,
              valueKind
            )}`}
      </small>
      <small className="levelMovementDelta">
        {movement.direction === "Unavailable" ? "Unavailable" : `${formatSignedDelta(movement.delta)} ${movement.direction}`}
      </small>
    </div>
  );
}

function formatMovementCurrent(movement: LevelMovement, valueKind: "price" | "strike"): string {
  return formatMovementValue(movement.current, valueKind);
}

function formatMovementValue(value: number | null, valueKind: "price" | "strike"): string {
  if (value == null) {
    return "—";
  }
  return valueKind === "price" ? formatPrice(value) : `${formatPrice(value)}`;
}

function formatSignedDelta(value: number | null): string {
  if (value == null) {
    return "—";
  }
  if (Object.is(value, -0) || value === 0) {
    return formatNumber(0, 2);
  }
  return `${value > 0 ? "+" : ""}${formatNumber(value, 2)}`;
}
