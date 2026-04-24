import React from "react";

interface ScenarioPanelProps {
  spotShift: string;
  volShift: string;
  timeShift: string;
  isScenarioModeActive: boolean;
  isApplying: boolean;
  errorMessage: string | null;
  onSpotShiftChange: (value: string) => void;
  onVolShiftChange: (value: string) => void;
  onTimeShiftChange: (value: string) => void;
  onApplyScenario: (event: React.FormEvent<HTMLFormElement>) => void;
  onReturnToLive: () => void;
}

export function ScenarioPanel({
  spotShift,
  volShift,
  timeShift,
  isScenarioModeActive,
  isApplying,
  errorMessage,
  onSpotShiftChange,
  onVolShiftChange,
  onTimeShiftChange,
  onApplyScenario,
  onReturnToLive
}: ScenarioPanelProps) {
  return (
    <section className="scenarioPanel" aria-label="Scenario controls">
      <form className="scenarioForm" onSubmit={onApplyScenario}>
        <label>
          <span>Spot shift</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.25"
            value={spotShift}
            onChange={(event) => onSpotShiftChange(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Vol shift</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.25"
            value={volShift}
            onChange={(event) => onVolShiftChange(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Time shift</span>
          <input
            type="number"
            inputMode="numeric"
            step="1"
            value={timeShift}
            onChange={(event) => onTimeShiftChange(event.currentTarget.value)}
          />
        </label>
        <button type="submit" disabled={isApplying}>
          Apply scenario
        </button>
        {isScenarioModeActive ? (
          <button type="button" className="secondaryButton" onClick={onReturnToLive}>
            Return to live
          </button>
        ) : null}
        {errorMessage ? <p role="status">{errorMessage}</p> : null}
      </form>
    </section>
  );
}
