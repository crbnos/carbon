// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  getAdjacentLineIds,
  getMethodSearch,
  getOperationTabSources,
  getPartMethodNodeLink,
  getPartMethodTab,
  isPartMethodLinePath
} from "./methodPageUtils";

describe("getOperationTabSources", () => {
  it("uses the operation's own content by default", () => {
    expect(getOperationTabSources({ operationType: "Process" })).toEqual({
      instructions: "own",
      parameters: "own",
      steps: "own",
      tools: "own",
      preview: "own"
    });
  });

  it("takes instructions, parameters and steps from a procedure, not tools", () => {
    expect(
      getOperationTabSources({ operationType: "Process", procedureId: "p" })
    ).toEqual({
      instructions: "procedure",
      parameters: "procedure",
      steps: "procedure",
      tools: "own",
      preview: "procedure"
    });
  });

  it.each([
    ["assemblyInstructionId", "Assembly"],
    ["inspectionDocumentId", "Inspection"]
  ])("takes only steps and preview from %s", (field, operationType) => {
    expect(getOperationTabSources({ operationType, [field]: "x" })).toEqual({
      instructions: "own",
      parameters: "own",
      steps: "linked",
      tools: "own",
      preview: "linked"
    });
  });

  it("uses nothing for Outside Processing, even with a stale link", () => {
    const sources = getOperationTabSources({
      operationType: "Outside Processing",
      procedureId: "p"
    });
    expect(new Set(Object.values(sources))).toEqual(new Set(["notUsed"]));
  });
});

describe("getPartMethodTab", () => {
  it("reads the tab from the path, on the table and on a line", () => {
    expect(getPartMethodTab("/x/part/a/bill-of-process")).toBe(
      "bill-of-process"
    );
    expect(getPartMethodTab("/x/part/a/bill-of-material/line")).toBe(
      "bill-of-material"
    );
    expect(getPartMethodTab("/x/part/a/details")).toBeNull();
  });
});

describe("isPartMethodLinePath", () => {
  it("is true on a line and on new, false on the table", () => {
    expect(isPartMethodLinePath("/x/part/a/bill-of-process/op")).toBe(true);
    expect(isPartMethodLinePath("/x/part/a/bill-of-material/new")).toBe(true);
    expect(isPartMethodLinePath("/x/part/a/bill-of-material")).toBe(false);
    expect(isPartMethodLinePath("/x/part/a/details")).toBe(false);
  });
});

describe("getPartMethodNodeLink", () => {
  const base = { itemId: "a", rootMethodId: "root" };

  it("keeps the root on the current method tab", () => {
    expect(
      getPartMethodNodeLink({
        ...base,
        pathname: "/x/part/a/bill-of-process/op"
      })
    ).toBe("/x/part/a/bill-of-process?methodId=root");
  });

  it("keeps the root on Details from another record tab", () => {
    expect(
      getPartMethodNodeLink({ ...base, pathname: "/x/part/a/planning" })
    ).toBe("/x/part/a/details?methodId=root");
  });

  it("keeps a sub-assembly on the current method tab", () => {
    expect(
      getPartMethodNodeLink({
        ...base,
        pathname: "/x/part/a/bill-of-process",
        makeMethodId: "sub"
      })
    ).toBe("/x/part/a/bill-of-process?methodId=root&makeMethodId=sub");
  });

  it("opens a sub-assembly on Bill of Material from another record tab", () => {
    expect(
      getPartMethodNodeLink({
        ...base,
        pathname: "/x/part/a/details",
        makeMethodId: "sub"
      })
    ).toBe("/x/part/a/bill-of-material?methodId=root&makeMethodId=sub");
  });
});

describe("getMethodSearch", () => {
  it("drops only the tab param", () => {
    expect(getMethodSearch("?methodId=m&tab=steps&makeMethodId=s")).toBe(
      "?methodId=m&makeMethodId=s"
    );
  });

  it("returns nothing when no param stays", () => {
    expect(getMethodSearch("?tab=steps")).toBe("");
  });
});

describe("getAdjacentLineIds", () => {
  it("returns the neighbours", () => {
    expect(getAdjacentLineIds(["a", "b", "c"], "b")).toEqual({
      previousId: "a",
      nextId: "c"
    });
  });

  it("returns null at each end", () => {
    expect(getAdjacentLineIds(["a", "b"], "a").previousId).toBeNull();
    expect(getAdjacentLineIds(["a", "b"], "b").nextId).toBeNull();
  });

  it("returns null for a line that is not in the list", () => {
    expect(getAdjacentLineIds(["a"], "new")).toEqual({
      previousId: null,
      nextId: null
    });
  });
});
