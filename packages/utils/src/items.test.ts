// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { distinctItemText } from "./items";

describe("distinctItemText", () => {
  it("keeps a name that differs from the readable id", () => {
    expect(distinctItemText("BRG-608", "Ball Bearing 608")).toBe(
      "Ball Bearing 608"
    );
  });

  it("drops a name that repeats the readable id", () => {
    expect(
      distinctItemText("Thermal Vacuum Test", "Thermal Vacuum Test")
    ).toBeUndefined();
  });

  it("ignores surrounding whitespace when comparing", () => {
    expect(distinctItemText("Calibration ", " Calibration")).toBeUndefined();
  });

  it("keeps an edited description of a service", () => {
    expect(
      distinctItemText("Thermal Vacuum Test", "Thermal Vacuum Test – 48h soak")
    ).toBe("Thermal Vacuum Test – 48h soak");
  });

  it("drops empty secondary text", () => {
    expect(distinctItemText("BRG-608", "")).toBeUndefined();
    expect(distinctItemText("BRG-608", null)).toBeUndefined();
    expect(distinctItemText("BRG-608", "  ")).toBeUndefined();
  });

  it("keeps secondary text when there is no primary", () => {
    expect(distinctItemText(undefined, "Ball Bearing 608")).toBe(
      "Ball Bearing 608"
    );
  });
});
