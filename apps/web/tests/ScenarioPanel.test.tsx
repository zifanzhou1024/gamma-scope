import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ScenarioPanel } from "../components/ScenarioPanel";

describe("ScenarioPanel", () => {
  it("groups scenario inputs and actions so controls can wrap inside their panel", () => {
    const markup = renderToStaticMarkup(
      <ScenarioPanel
        spotShift=""
        volShift=""
        timeShift=""
        isScenarioModeActive={true}
        isApplying={false}
        errorMessage={null}
        onSpotShiftChange={vi.fn()}
        onVolShiftChange={vi.fn()}
        onTimeShiftChange={vi.fn()}
        onApplyScenario={vi.fn()}
        onReturnToLive={vi.fn()}
      />
    );

    expect(markup).toMatch(/<form[^>]*class="scenarioForm"/);
    expect(markup).toMatch(/class="scenarioInputGroup"[\s\S]*Spot shift[\s\S]*Vol shift[\s\S]*Time shift/);
    expect(markup).toMatch(/class="scenarioActionGroup"[\s\S]*Apply scenario[\s\S]*Return to live/);
  });

  it("styles scenario control groups with wrapping behavior", () => {
    const styles = readFileSync(new URL("../app/styles.css", import.meta.url), "utf8");

    expect(styles).toMatch(/\.scenarioInputGroup\s*{[\s\S]*flex-wrap:\s*wrap/);
    expect(styles).toMatch(/\.scenarioActionGroup\s*{[\s\S]*flex-wrap:\s*wrap/);
    expect(styles).toMatch(/\.scenarioInputGroup,\s*\n\.scenarioActionGroup\s*{[\s\S]*align-items:\s*flex-end/);
    expect(styles).not.toContain("align-items: end");
  });
});
