// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  childWbsCode,
  computeWbsCodes,
  isValidWbsCode,
  type WbsNode,
  wbsSequence
} from "./wbs";

let sequence = 0;
const node = (
  id: string,
  parentId: string | null,
  sortOrder: number,
  extra: Partial<WbsNode> = {}
): WbsNode => ({
  id,
  parentId,
  type: "Task",
  sortOrder,
  sequence: ++sequence,
  wbsCode: null,
  ...extra
});

const codesOf = (nodes: WbsNode[]) =>
  Object.fromEntries(computeWbsCodes(nodes).codes);

describe("computeWbsCodes", () => {
  it("numbers roots and children by position", () => {
    expect(
      codesOf([
        node("A", null, 1),
        node("A1", "A", 1),
        node("A2", "A", 2),
        node("B", null, 2)
      ])
    ).toEqual({ A: "1", A1: "1.1", A2: "1.2", B: "2" });
  });

  it("follows the sort order, not the insert order", () => {
    const codes = codesOf([
      node("A", null, 1),
      node("A1", "A", 2),
      node("A2", "A", 1)
    ]);
    expect(codes.A2).toBe("1.1");
    expect(codes.A1).toBe("1.2");
  });

  it("breaks a sort order tie by the readable id sequence", () => {
    const codes = codesOf([
      node("A", null, 1),
      node("late", "A", 1, { sequence: 9 }),
      node("early", "A", 1, { sequence: 3 })
    ]);
    expect(codes.early).toBe("1.1");
    expect(codes.late).toBe("1.2");
  });

  it("drops the .0 of a level 1 code for its children", () => {
    expect(
      codesOf([
        node("root", null, 1, { wbsCode: "1.0" }),
        node("a", "root", 1),
        node("b", "root", 2)
      ])
    ).toEqual({ root: "1.0", a: "1.1", b: "1.2" });
  });

  it("skips a Parameter and its subtree without shifting siblings", () => {
    const codes = codesOf([
      node("A", null, 1),
      node("t1", "A", 1),
      node("p", "A", 2, { type: "Parameter" }),
      node("pp", "p", 1, { type: "Parameter" }),
      node("t2", "A", 3)
    ]);
    expect(codes.t2).toBe("1.2");
    expect(codes.p).toBeUndefined();
    expect(codes.pp).toBeUndefined();
  });

  it("reports a pinned code that collides with a derived one", () => {
    const { duplicates } = computeWbsCodes([
      node("A", null, 1),
      node("a1", "A", 1),
      node("a2", "A", 2),
      node("a3", "A", 3, { wbsCode: "1.2" })
    ]);
    expect([...duplicates]).toEqual(["1.2"]);
  });

  it("derives the children of a pinned code from it", () => {
    const codes = codesOf([
      node("A", null, 1),
      node("pinned", "A", 1, { wbsCode: "5" }),
      node("child", "pinned", 1)
    ]);
    expect(codes.pinned).toBe("5");
    expect(codes.child).toBe("5.1");
  });

  it("keeps a pinned code when the element moves", () => {
    const before = codesOf([
      node("A", null, 1),
      node("B", null, 2),
      node("x", "A", 1, { wbsCode: "1.2" })
    ]);
    const after = codesOf([
      node("A", null, 1),
      node("B", null, 2),
      node("x", "B", 1, { wbsCode: "1.2" }),
      node("y", "B", 2)
    ]);
    expect(before.x).toBe("1.2");
    expect(after.x).toBe("1.2");
    expect(after.y).toBe("2.2");
  });
});

describe("childWbsCode", () => {
  it("numbers a root by its position", () => {
    expect(childWbsCode(null, 3)).toBe("3");
  });

  it("appends the position", () => {
    expect(childWbsCode("1.2", 4)).toBe("1.2.4");
    expect(childWbsCode("1.0", 4)).toBe("1.4");
  });
});

describe("isValidWbsCode", () => {
  it("accepts codes with letters, digits, dots and dashes", () => {
    expect(isValidWbsCode("1.2.3a")).toBe(true);
    expect(isValidWbsCode("1.0")).toBe(true);
    expect(isValidWbsCode("C-1.2")).toBe(true);
  });

  it("refuses an empty code, a leading dot and more than 40 characters", () => {
    expect(isValidWbsCode("")).toBe(false);
    expect(isValidWbsCode(".1")).toBe(false);
    expect(isValidWbsCode("1".repeat(41))).toBe(false);
    expect(isValidWbsCode("1".repeat(40))).toBe(true);
  });
});

describe("wbsSequence", () => {
  it("reads the number after the last dash", () => {
    expect(wbsSequence("OB2-17")).toBe(17);
    expect(wbsSequence("TPL-A-3")).toBe(3);
  });
});
