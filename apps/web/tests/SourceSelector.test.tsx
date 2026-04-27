import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SourceSelector } from "../components/SourceSelector";

describe("SourceSelector", () => {
  it("renders Moomoo and IBKR options with Moomoo selected by default", () => {
    const markup = renderToStaticMarkup(<SourceSelector value="moomoo" onChange={vi.fn()} />);

    expect(markup).toContain("Data source");
    expect(markup).toContain("Moomoo");
    expect(markup).toContain("IBKR");
    expect(markup).toMatch(/option value="moomoo" selected=""/);
  });
});
