// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { isValidWbsCode } from "./wbs";
import {
  WBS_TEMPLATES,
  wbsTemplate,
  wbsTemplateParentCode
} from "./wbs-templates";

describe("WBS_TEMPLATES", () => {
  it("has the 4 appendixes", () => {
    expect(WBS_TEMPLATES.map((template) => template.key)).toEqual([
      "B",
      "A",
      "C",
      "F"
    ]);
  });

  for (const template of WBS_TEMPLATES) {
    describe(template.key, () => {
      it("has valid codes that do not repeat", () => {
        const codes = template.rows.map((row) => row.code);
        expect(codes.every(isValidWbsCode)).toBe(true);
        expect(new Set(codes).size).toBe(codes.length);
      });

      it("starts at 1.0 and lists every row after its parent", () => {
        expect(template.rows[0]?.code).toBe("1.0");
        const seen = new Set<string>();
        for (const [index, row] of template.rows.entries()) {
          const parent = wbsTemplateParentCode(row.code, template.rows);
          if (index === 0) expect(parent).toBeNull();
          else expect(parent && seen.has(parent)).toBe(true);
          seen.add(row.code);
        }
      });

      it("stops at level 3", () => {
        expect(
          template.rows.every((row) => row.code.split(".").length <= 3)
        ).toBe(true);
      });
    });
  }

  it("gives Appendix B 13 level-2 elements, 1.1 to 1.13", () => {
    const levelTwo = wbsTemplate("B")!
      .rows.map((row) => row.code)
      .filter((code) => code.split(".").length === 2 && code !== "1.0");
    expect(levelTwo).toEqual(
      Array.from({ length: 13 }, (_, index) => `1.${index + 1}`)
    );
  });

  it("names Appendix B 1.3 Systems Engineering", () => {
    expect(wbsTemplate("B")!.rows.find((row) => row.code === "1.3")?.name).toBe(
      "Systems Engineering"
    );
  });
});

describe("wbsTemplateParentCode", () => {
  const rows = wbsTemplate("B")!.rows;

  it("puts level 2 under 1.0 and level 3 under level 2", () => {
    expect(wbsTemplateParentCode("1.0", rows)).toBeNull();
    expect(wbsTemplateParentCode("1.1", rows)).toBe("1.0");
    expect(wbsTemplateParentCode("1.1.2", rows)).toBe("1.1");
  });
});
