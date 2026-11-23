// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  buildMspdiXml,
  type MspdiInput,
  type WbsElement
} from "./projects.models";

const element = (
  sequence: number,
  id: string,
  parentId: string | null,
  sortOrder: number,
  extra: Partial<WbsElement> = {}
): WbsElement => ({
  id,
  readableId: `OB2-${sequence}`,
  parentId,
  type: "Task",
  name: id,
  sortOrder,
  sequence,
  wbsCode: null,
  startDate: null,
  targetDate: null,
  budget: null,
  ...extra
});

const input = (): MspdiInput => ({
  project: {
    identifier: "OB2",
    name: "Satellite bus & payload",
    currencyCode: "USD"
  },
  elements: [
    element(1, "bus", null, 1, {
      name: "Satellite bus",
      type: "System",
      wbsCode: "1.0"
    }),
    element(2, "design", "bus", 1, {
      name: "Design",
      startDate: "2026-11-02",
      targetDate: "2026-11-06",
      budget: 20000
    }),
    element(3, "build", "bus", 2, {
      name: "Build",
      startDate: "2026-11-11",
      targetDate: "2026-11-17",
      budget: 30000
    }),
    element(4, "mass", "bus", 3, { name: "Dry mass", type: "Parameter" })
  ],
  links: [{ fromElementId: "design", toElementId: "build" }],
  controlAccountIds: new Set(["bus"]),
  workPackageIds: new Set(["design", "build"]),
  baseline: new Map([
    [
      "design",
      { startDate: "2026-11-02", targetDate: "2026-11-06", budget: 18000 }
    ]
  ]),
  today: "2026-10-12"
});

describe("buildMspdiXml", () => {
  it("matches the golden file", async () => {
    await expect(buildMspdiXml(input())).toMatchFileSnapshot(
      "./__fixtures__/mspdi-golden.xml"
    );
  });

  it("leaves out Parameters and escapes text", () => {
    const xml = buildMspdiXml(input());
    expect(xml).not.toContain("Dry mass");
    expect(xml).toContain("<Name>OB2 Satellite bus &amp; payload</Name>");
  });

  it("writes budgets in hundredths on leaves only", () => {
    const xml = buildMspdiXml(input());
    expect(xml).toContain("<FixedCost>2000000</FixedCost>");
    expect(xml.match(/<FixedCost>/g)).toHaveLength(2);
  });

  it("counts working days only: Nov 11 (Wed) to Nov 17 (Tue) is 5 days", () => {
    expect(buildMspdiXml(input())).toContain("<Duration>PT40H0M0S</Duration>");
  });

  it("refuses repeated codes", () => {
    const data = input();
    (data.elements[2] as WbsElement).wbsCode = "1.1";
    expect(() => buildMspdiXml(data)).toThrow(/repeat/);
  });
});
