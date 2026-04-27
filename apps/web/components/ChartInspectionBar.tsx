import React from "react";
import type { StrikeInspection, StrikeInspectionSide } from "../lib/chartInspection";
import { formatInteger } from "../lib/dashboardMetrics";

interface ChartInspectionBarProps {
  inspection: StrikeInspection;
  onClear: () => void;
}

export function ChartInspectionBar({ inspection, onClear }: ChartInspectionBarProps) {
  return (
    <section
      className="sharedInspectionBar"
      data-shared-inspection-bar={inspection.strike}
      aria-label="Selected strike inspection"
    >
      <div className="sharedInspectionStrike">
        <span>STRIKE</span>
        <strong>{formatInteger(inspection.strike)}</strong>
        <small>{inspection.distanceLabel}</small>
      </div>
      <div className="sharedInspectionTableWrap">
        <table className="sharedInspectionTable" aria-label="Call and put inspection values">
          <thead>
            <tr>
              <th scope="col">Side</th>
              <th scope="col">Bid</th>
              <th scope="col">Ask</th>
              <th scope="col">Mid</th>
              <th scope="col">IV</th>
              <th scope="col">Gamma</th>
              <th scope="col">Vanna</th>
              <th scope="col">OI</th>
            </tr>
          </thead>
          <tbody>
            <InspectionRow side="Call" values={inspection.call} />
            <InspectionRow side="Put" values={inspection.put} />
          </tbody>
        </table>
      </div>
      <button className="sharedInspectionClear" type="button" onClick={onClear}>
        Clear
      </button>
    </section>
  );
}

function InspectionRow({ side, values }: { side: "Call" | "Put"; values: StrikeInspectionSide }) {
  return (
    <tr>
      <th scope="row">{side}</th>
      <td>{values.bid}</td>
      <td>{values.ask}</td>
      <td>{values.mid}</td>
      <td>{values.iv}</td>
      <td>{values.gamma}</td>
      <td>{values.vanna}</td>
      <td>{values.openInterest}</td>
    </tr>
  );
}
