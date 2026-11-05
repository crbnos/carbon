// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { wbsTemplate } from "@carbon/utils";
import { describe, expect, it } from "vitest";
import {
  diffPlanSnapshots,
  PLAN_LAYER_FIELDS,
  type ProjectPlanSnapshot,
  parseElementPlanFieldValue,
  wbsTemplateElementType
} from "./projects.models";

describe("wbsTemplateElementType", () => {
  const rows = wbsTemplate("B")!.rows;

  it("builds a row with children as a System", () => {
    expect(wbsTemplateElementType("1.0", rows)).toBe("System");
    expect(wbsTemplateElementType("1.3", rows)).toBe("System");
  });

  it("builds a leaf as a Task", () => {
    expect(wbsTemplateElementType("1.2", rows)).toBe("Task");
    expect(wbsTemplateElementType("1.3.1", rows)).toBe("Task");
  });
});

describe("wbsCode as a plan-layer field", () => {
  it("is in the element's plan layer", () => {
    expect(PLAN_LAYER_FIELDS.projectElement).toContain("wbsCode");
  });

  it("sees no change between an old baseline without the key and a null code", () => {
    const element = { id: "pje_1", parentId: null, name: "Bus" };
    const base = {
      elements: [element],
      links: [],
      materials: [],
      labor: [],
      costs: []
    } as unknown as ProjectPlanSnapshot;
    const target = {
      ...base,
      elements: [{ ...element, wbsCode: null }]
    } as unknown as ProjectPlanSnapshot;
    expect(diffPlanSnapshots(base, target).elements[0]?.status).toBe(
      "unchanged"
    );
  });

  it("refuses an invalid code in a change request and accepts a blank one", () => {
    expect(parseElementPlanFieldValue("wbsCode", "1.2.3a")).toEqual({
      value: "1.2.3a"
    });
    expect(parseElementPlanFieldValue("wbsCode", null)).toEqual({
      value: null
    });
    expect(parseElementPlanFieldValue("wbsCode", ".1")).toHaveProperty("error");
  });
});
