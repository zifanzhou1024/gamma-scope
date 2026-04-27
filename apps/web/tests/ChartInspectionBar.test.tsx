import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChartInspectionBar } from "../components/ChartInspectionBar";

const inspection = {
  strike: 5200,
  distanceLabel: "+1 pts from spot",
  call: {
    bid: "1.00",
    ask: "1.20",
    mid: "1.10",
    iv: "18.80%",
    gamma: "0.01850",
    vanna: "0.00080",
    openInterest: "100"
  },
  put: {
    bid: "2.00",
    ask: "2.30",
    mid: "2.15",
    iv: "20.50%",
    gamma: "0.01800",
    vanna: "0.00100",
    openInterest: "250"
  }
};

describe("ChartInspectionBar", () => {
  it("renders one shared semantic call and put inspection table", () => {
    const markup = renderToStaticMarkup(<ChartInspectionBar inspection={inspection} onClear={vi.fn()} />);

    expect(markup).toContain('data-shared-inspection-bar="5200"');
    expect(markup).toContain("STRIKE");
    expect(markup).toContain("5,200");
    expect(markup).toContain("+1 pts from spot");
    expect(markup).toContain("<table");
    expect(markup).toContain('<th scope="col">Side</th>');
    expect(markup).toContain('<th scope="col">Bid</th>');
    expect(markup).toContain('<th scope="col">Ask</th>');
    expect(markup).toContain('<th scope="col">Mid</th>');
    expect(markup).toContain('<th scope="col">IV</th>');
    expect(markup).toContain('<th scope="col">Gamma</th>');
    expect(markup).toContain('<th scope="col">Vanna</th>');
    expect(markup).toContain('<th scope="col">OI</th>');
    expect(markup).toContain('<th scope="row">Call</th>');
    expect(markup).toContain('<th scope="row">Put</th>');
    expect(markup).toContain("18.80%");
    expect(markup).toContain("0.01800");
    expect(markup).toContain("250");
    expect(markup).toContain("<button");
    expect(markup).toContain("Clear");
  });
});
