// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  readWbsCsv,
  toWbsCsvRows,
  type WbsElement,
  type WbsLink
} from "./projects.models";

let sequence = 0;
const element = (
  id: string,
  parentId: string | null,
  sortOrder: number,
  extra: Partial<WbsElement> = {}
): WbsElement => {
  sequence += 1;
  return {
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
  };
};

const project = () => {
  sequence = 0;
  const elements = [
    element("bus", null, 1, { type: "System", wbsCode: "1.0" }),
    element("design", "bus", 1, {
      startDate: "2026-11-02",
      targetDate: "2026-11-06",
      budget: 20000
    }),
    element("build", "bus", 2, { budget: 30000 }),
    element("mass", "bus", 3, { type: "Parameter" })
  ];
  const links: WbsLink[] = [{ fromElementId: "design", toElementId: "build" }];
  return { elements, links };
};

const asCsv = (rows: ReturnType<typeof toWbsCsvRows>) =>
  rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        value === null ? "" : String(value)
      ])
    )
  );

describe("toWbsCsvRows", () => {
  it("writes the numbered elements in tree order without Parameters", () => {
    const { elements, links } = project();
    const rows = toWbsCsvRows(elements, links);
    expect(rows.map((row) => row["WBS Code"])).toEqual(["1.0", "1.1", "1.2"]);
    expect(rows[1]).toMatchObject({
      "Element ID": "OB2-2",
      "Parent WBS Code": "1.0",
      Level: 2,
      Start: "2026-11-02",
      Budget: 20000
    });
    expect(rows[2]?.Predecessors).toBe("1.1");
  });

  it("refuses a WBS with a repeated code", () => {
    const { elements, links } = project();
    elements[2]!.wbsCode = "1.1";
    expect(() => toWbsCsvRows(elements, links)).toThrow(/repeat/);
  });
});

describe("readWbsCsv", () => {
  it("reads its own export back with no change", () => {
    const { elements, links } = project();
    const result = readWbsCsv(
      asCsv(toWbsCsvRows(elements, links)),
      elements,
      links
    );
    expect(result.errors).toEqual([]);
    expect(result.creates).toEqual([]);
    expect(result.links).toEqual([]);
    for (const update of result.updates) {
      const before = elements.find((e) => e.id === update.id)!;
      expect(update.parentChanged).toBe(false);
      expect(update.wbsCode).toBe(before.wbsCode);
      expect(update.name).toBe(before.name);
    }
  });

  it("updates names and creates a row under a parent code", () => {
    const { elements, links } = project();
    const csv = asCsv(toWbsCsvRows(elements, links));
    csv[1]!.Name = "Detailed design";
    csv[2]!.Name = "Build and test";
    csv.push({
      "WBS Code": "1.3",
      "Parent WBS Code": "1.0",
      Name: "Integration",
      Type: "Task",
      Predecessors: "1.2"
    });
    const result = readWbsCsv(csv, elements, links);
    expect(result.errors).toEqual([]);
    expect(
      Object.fromEntries(result.updates.map((u) => [u.id, u.name]))
    ).toEqual({
      bus: "bus",
      design: "Detailed design",
      build: "Build and test"
    });
    expect(result.creates).toEqual([
      expect.objectContaining({
        key: "new:5",
        parentKey: "bus",
        wbsCode: "1.3",
        name: "Integration"
      })
    ]);
    expect(result.links).toEqual([{ fromKey: "build", toKey: "new:5" }]);
  });

  it("keeps the current values of blank cells on an update", () => {
    const { elements, links } = project();
    const result = readWbsCsv([{ "Element ID": "OB2-2" }], elements, links);
    expect(result.errors).toEqual([]);
    expect(result.updates[0]).toMatchObject({
      name: "design",
      parentKey: "bus",
      startDate: "2026-11-02",
      budget: 20000
    });
  });

  it("reports an unknown parent code and writes nothing", () => {
    const { elements, links } = project();
    const result = readWbsCsv(
      [{ "WBS Code": "2.1", "Parent WBS Code": "9.9", Name: "Orphan" }],
      elements,
      links
    );
    expect(result.errors).toEqual([
      {
        row: 2,
        message: "Parent WBS code 9.9 is not in the file or the project"
      }
    ]);
  });

  it("reports a code that another element already has", () => {
    const { elements, links } = project();
    const result = readWbsCsv(
      [{ "WBS Code": "1.1", Name: "Again" }],
      elements,
      links
    );
    expect(result.errors[0]?.message).toMatch(/1\.1 repeats \(OB2-2 has it\)/);
  });

  it("reports a bad date and a target before the start", () => {
    const { elements, links } = project();
    const result = readWbsCsv(
      [
        { Name: "A", Start: "11/02/2026" },
        { Name: "B", Start: "2026-11-10", Target: "2026-11-01" }
      ],
      elements,
      links
    );
    expect(result.errors).toEqual([
      { row: 2, message: "Start must be YYYY-MM-DD" },
      { row: 3, message: "Target is before Start" }
    ]);
  });

  it("refuses a move under the element's own subtree", () => {
    const { elements, links } = project();
    const result = readWbsCsv(
      [{ "Element ID": "OB2-1", "Parent WBS Code": "1.1" }],
      elements,
      links
    );
    expect(result.errors[0]?.message).toMatch(/own subtree/);
  });

  it("refuses predecessors that make a loop", () => {
    const { elements, links } = project();
    const result = readWbsCsv(
      [{ "Element ID": "OB2-2", Predecessors: "1.2" }],
      elements,
      links
    );
    expect(result.errors[0]?.message).toBe("The predecessors make a loop");
  });

  it("refuses a Parameter row", () => {
    const { elements, links } = project();
    const result = readWbsCsv([{ "Element ID": "OB2-4" }], elements, links);
    expect(result.errors[0]?.message).toMatch(
      /Parameters are not part of the WBS/
    );
  });
});
