// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The decisions the method import makes when a make method version already
// has lines: which version it writes into, when it refuses, and what it
// appends or skips.

import { describe, expect, it } from "vitest";
import { LOCKED_REVISION_MESSAGE } from "~/modules/items/items.service";
import { fieldMappings } from "./imports.models";
import {
  methodImportLock,
  methodVersionIssue,
  opKey,
  pickMethodImportTarget,
  planMaterialAppend,
  planOperationAppend
} from "./shared.service";

const method = (
  version: number,
  status: string,
  changeOrderId: string | null = null
) => ({ id: `mm-${version}`, version, status, changeOrderId });

describe("wizard defaults", () => {
  // The wizard writes an enum's Default into every blank or unmapped cell, so
  // a preset here would replace the material's unit and the process's type.
  it("presets no BOM unit and no operation type", () => {
    for (const table of ["bom", "partWithMethod"] as const) {
      expect(
        fieldMappings[table].unitOfMeasureCode.enumData
      ).not.toHaveProperty("default");
    }
    for (const table of ["operations", "partWithMethod"] as const) {
      expect(fieldMappings[table].operationType.enumData).not.toHaveProperty(
        "default"
      );
    }
  });
});

describe("pickMethodImportTarget", () => {
  it("targets the highest non-archived version when the version is blank", () => {
    const methods = [
      method(1, "Archived"),
      method(2, "Active"),
      method(3, "Draft")
    ];
    expect(pickMethodImportTarget(methods, "")).toEqual({
      method: methods[2]
    });
  });

  it("targets the Active version when it is the highest", () => {
    const methods = [method(1, "Archived"), method(2, "Active")];
    expect(pickMethodImportTarget(methods, " ")).toEqual({
      method: methods[1]
    });
  });

  it("creates the next version when every version is archived", () => {
    expect(pickMethodImportTarget([method(1, "Archived")], "")).toEqual({
      createVersion: 2
    });
    expect(pickMethodImportTarget([], "")).toEqual({ createVersion: 1 });
  });

  it("targets an explicit version, or creates it when it is missing", () => {
    const methods = [method(1, "Active"), method(2, "Draft")];
    expect(pickMethodImportTarget(methods, "1")).toEqual({
      method: methods[0]
    });
    expect(pickMethodImportTarget(methods, "4")).toEqual({
      createVersion: 4
    });
  });
});

describe("methodVersionIssue", () => {
  it("accepts a blank version and numbers above 0 with up to 2 decimals", () => {
    for (const version of ["", " ", "1", "2", "1.5", "1.25", "1.50", "1.000"]) {
      expect(methodVersionIssue(version)).toBeNull();
    }
  });

  // makeMethod.version is NUMERIC(10, 2): 1.555 is stored as 1.56, and a
  // re-run of the same file would then create 1.555 again and collide.
  it("refuses what the version column cannot keep as written", () => {
    for (const version of ["abc", "0", "-1", "1.555", "1e1", "1,5"]) {
      expect(methodVersionIssue(version)).toBe(
        `Make Method Version "${version}" must be a number above 0 with at most 2 decimals`
      );
    }
  });
});

describe("methodImportLock", () => {
  const base = {
    status: "Draft",
    version: 2,
    changeNoticeLock: null,
    revisionStatus: "Design",
    releaseControl: "enforce" as const
  };

  it("allows a Draft on an unreleased revision", () => {
    expect(methodImportLock(base)).toEqual({ ok: true, warn: false });
  });

  it("refuses a version that is not a Draft", () => {
    const active = methodImportLock({ ...base, status: "Active" });
    expect(active.ok).toBe(false);
    expect("message" in active && active.message).toMatch(
      /^make method version 2 is Active, and only a Draft version can change/
    );
    const archived = methodImportLock({ ...base, status: "Archived" });
    expect("message" in archived && archived.message).toMatch(/is Archived/);
  });

  it("refuses a Draft that a locked change notice holds", () => {
    expect(
      methodImportLock({ ...base, changeNoticeLock: "Locked notice" })
    ).toEqual({ ok: false, warn: false, message: "Locked notice" });
  });

  it("follows release control on a released revision", () => {
    const released = { ...base, revisionStatus: "Production" };
    expect(methodImportLock(released)).toEqual({
      ok: false,
      warn: false,
      message: LOCKED_REVISION_MESSAGE
    });
    // The editors write under "warn" and show the message; so does the import.
    expect(methodImportLock({ ...released, releaseControl: "warn" })).toEqual({
      ok: true,
      warn: true,
      message: LOCKED_REVISION_MESSAGE
    });
    expect(methodImportLock({ ...released, releaseControl: "off" })).toEqual({
      ok: true,
      warn: false
    });
  });
});

describe("planMaterialAppend", () => {
  it("numbers lines from 1 on an empty version", () => {
    expect(
      planMaterialAppend({
        lines: [
          { index: 0, itemId: "a" },
          { index: 1, itemId: "b" }
        ],
        existing: []
      })
    ).toEqual({
      insert: [
        { index: 0, order: 1 },
        { index: 1, order: 2 }
      ],
      skipped: []
    });
  });

  it("appends after the highest line and skips materials already on it", () => {
    expect(
      planMaterialAppend({
        lines: [
          { index: 0, itemId: "a" },
          { index: 1, itemId: "c" },
          { index: 2, itemId: "d" }
        ],
        existing: [
          { itemId: "a", order: 1 },
          { itemId: "b", order: 5 }
        ]
      })
    ).toEqual({
      insert: [
        { index: 1, order: 6 },
        { index: 2, order: 7 }
      ],
      skipped: [0]
    });
  });

  it("writes every copy of a material repeated inside the file", () => {
    expect(
      planMaterialAppend({
        lines: [
          { index: 0, itemId: "a" },
          { index: 1, itemId: "a" }
        ],
        existing: []
      }).insert
    ).toHaveLength(2);
  });
});

describe("planOperationAppend", () => {
  const partLabel = "P-1 rev 0";

  it("orders new operations by their Op No on an empty version", () => {
    const plan = planOperationAppend({
      bop: [
        { index: 0, opNo: "10" },
        { index: 1, opNo: "2" }
      ],
      children: [{ index: 2, opNo: "2.0", rowType: "STEP" }],
      existing: [],
      partLabel
    });
    expect(plan.insert).toEqual([
      { index: 0, opNo: "10", order: 10 },
      { index: 1, opNo: "2", order: 2 }
    ]);
    expect(plan.errors).toEqual([]);
    expect(plan.existingIdByOpNo.size).toBe(0);
  });

  it("refuses an Op No that is not a number", () => {
    const plan = planOperationAppend({
      bop: [{ index: 0, opNo: "Deburr" }],
      children: [{ index: 1, opNo: "Deburr", rowType: "STEP" }],
      existing: [{ id: "op-1", order: 1 }],
      partLabel
    });
    expect(plan.insert).toEqual([]);
    expect(plan.errors).toEqual([
      { row: 0, reason: 'Op No "Deburr" must be a number' },
      { row: 1, reason: 'Op No "Deburr" must be a number' }
    ]);
  });

  it("matches an Op No to the existing operation with that order", () => {
    const plan = planOperationAppend({
      bop: [
        { index: 0, opNo: "1" },
        { index: 1, opNo: "30" }
      ],
      children: [],
      existing: [
        { id: "op-1", order: 1 },
        { id: "op-2", order: 2 }
      ],
      partLabel
    });
    expect(plan.skipped).toEqual([{ index: 0, opNo: "1" }]);
    expect(plan.insert).toEqual([{ index: 1, opNo: "30", order: 30 }]);
    expect(plan.existingIdByOpNo.get("1")).toBe("op-1");
  });

  it("matches Op Nos by value, not by text", () => {
    const plan = planOperationAppend({
      bop: [{ index: 0, opNo: "01" }],
      children: [
        { index: 1, opNo: "1.0", rowType: "STEP" },
        { index: 2, opNo: "2.00", rowType: "PARAM" }
      ],
      existing: [
        { id: "op-1", order: 1 },
        { id: "op-2", order: 2 }
      ],
      partLabel
    });
    expect(plan.errors).toEqual([]);
    expect(plan.skipped).toEqual([{ index: 0, opNo: "01" }]);
    expect(plan.existingIdByOpNo.get(opKey("1.0"))).toBe("op-1");
    expect(plan.existingIdByOpNo.get(opKey("2"))).toBe("op-2");
  });

  it("attaches child rows to an existing operation with no BOP row", () => {
    const plan = planOperationAppend({
      bop: [],
      children: [
        { index: 0, opNo: "2", rowType: "STEP" },
        { index: 1, opNo: "2", rowType: "PARAM" }
      ],
      existing: [
        { id: "op-1", order: 1 },
        { id: "op-2", order: 2 }
      ],
      partLabel
    });
    expect(plan.errors).toEqual([]);
    expect(plan.existingIdByOpNo.get("2")).toBe("op-2");
  });

  it("reports a child row whose Op No matches nothing", () => {
    const plan = planOperationAppend({
      bop: [],
      children: [{ index: 4, opNo: "9", rowType: "TOOL" }],
      existing: [{ id: "op-1", order: 1 }],
      partLabel
    });
    expect(plan.errors).toEqual([
      { row: 4, reason: 'TOOL references unknown Op No "9"' }
    ]);
  });

  it("reports an Op No that matches two existing operations", () => {
    const plan = planOperationAppend({
      bop: [{ index: 0, opNo: "1" }],
      children: [{ index: 1, opNo: "1", rowType: "STEP" }],
      existing: [
        { id: "op-1", order: 1 },
        { id: "op-2", order: 1 }
      ],
      partLabel
    });
    expect(plan.errors).toEqual([
      { row: 0, reason: 'Op No "1" matches 2 operations on P-1 rev 0' }
    ]);
    expect(plan.insert).toEqual([]);
  });
});
