// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  canonicalElementsParams,
  elementLayoutFromParams,
  parseElementFilters
} from "~/modules/projects/projects.models";

const params = (query: string) => new URLSearchParams(query);

describe("the Plan page layout", () => {
  it("reads list, tree and reader", () => {
    expect(elementLayoutFromParams(params("layout=list"))).toBe("list");
    expect(elementLayoutFromParams(params("layout=tree"))).toBe("tree");
    expect(elementLayoutFromParams(params("layout=reader"))).toBe("reader");
  });

  it("reads no layout for a retired or missing one", () => {
    expect(elementLayoutFromParams(params("layout=board"))).toBeNull();
    expect(elementLayoutFromParams(params(""))).toBeNull();
  });
});

describe("canonicalElementsParams", () => {
  it("needs no redirect for a layout and no old type param", () => {
    expect(canonicalElementsParams(params("layout=list&search=bus"))).toBe(
      null
    );
  });

  it("sends a missing layout to list and keeps every other param", () => {
    const next = canonicalElementsParams(params("cr=pcr_1&search=bus"));
    expect(next?.get("layout")).toBe("list");
    expect(next?.get("cr")).toBe("pcr_1");
    expect(next?.get("search")).toBe("bus");
  });

  it("sends the retired layouts to list", () => {
    for (const layout of ["table", "board", "timeline"]) {
      expect(
        canonicalElementsParams(params(`layout=${layout}`))?.get("layout")
      ).toBe("list");
    }
  });

  it("turns the old type param into the Type filter", () => {
    const next = canonicalElementsParams(
      params("layout=tree&type=Test+Case&filter=ownerId:eq:u1")
    );
    expect(next?.get("type")).toBeNull();
    expect(next?.get("layout")).toBe("tree");
    expect(next?.getAll("filter")).toEqual([
      "ownerId:eq:u1",
      "type:eq:Test Case"
    ]);
  });

  it("drops an unknown old type and keeps a Type filter already set", () => {
    expect(
      canonicalElementsParams(params("layout=list&type=Bogus"))?.getAll(
        "filter"
      )
    ).toEqual([]);
    expect(
      canonicalElementsParams(
        params("layout=list&type=Task&filter=type:eq:System")
      )?.getAll("filter")
    ).toEqual(["type:eq:System"]);
  });
});

describe("parseElementFilters", () => {
  it("reads the Type filter of the filter row", () => {
    const { filters, type } = parseElementFilters(
      params("filter=type:eq:Requirement")
    );
    expect(filters.type).toEqual(["Requirement"]);
    expect(type).toBe("Requirement");
  });

  it("still reads the old type param", () => {
    const { filters, type } = parseElementFilters(params("type=Task"));
    expect(filters.type).toEqual(["Task"]);
    expect(type).toBe("Task");
  });

  it("gives the Tree no lens for more than one type", () => {
    const { filters, type } = parseElementFilters(
      params("filter=type:in:Task,System")
    );
    expect(filters.type).toEqual(["Task", "System"]);
    expect(type).toBeNull();
  });

  it("ignores an unknown type", () => {
    const { filters, isFiltered } = parseElementFilters(
      params("filter=type:eq:Bogus")
    );
    expect(filters.type).toBeNull();
    expect(isFiltered).toBe(false);
  });
});
