// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  pickEmployeeType,
  planGroupMappingSave,
  replaceCompanyGrants,
  stripCompanyGrants,
  typeGrantsFor
} from "./mapping";

describe("pickEmployeeType", () => {
  it("picks the mapped group with the lowest priority", () => {
    expect(
      pickEmployeeType(
        [
          { employeeTypeId: "buyer", priority: 20, displayName: "Buyers" },
          { employeeTypeId: "admin", priority: 1, displayName: "Admins" }
        ],
        "default"
      )
    ).toBe("admin");
  });

  it("breaks a priority tie by group name", () => {
    expect(
      pickEmployeeType(
        [
          { employeeTypeId: "z", priority: 5, displayName: "Zeta" },
          { employeeTypeId: "a", priority: 5, displayName: "Alpha" }
        ],
        "default"
      )
    ).toBe("a");
  });

  it("ignores unmapped groups", () => {
    expect(
      pickEmployeeType(
        [
          { employeeTypeId: null, priority: 0, displayName: "Everyone" },
          { employeeTypeId: "buyer", priority: 50, displayName: "Buyers" }
        ],
        "default"
      )
    ).toBe("buyer");
  });

  it("gives the default type to a person in no mapped group", () => {
    expect(pickEmployeeType([], "default")).toBe("default");
    expect(
      pickEmployeeType(
        [{ employeeTypeId: null, priority: 0, displayName: "Everyone" }],
        "default"
      )
    ).toBe("default");
  });
});

describe("planGroupMappingSave", () => {
  const group = (
    id: string,
    employeeTypeId: string | null,
    priority: number
  ) => ({ id, employeeTypeId, priority });

  it("numbers mapped groups in list order and writes only what changed", () => {
    expect(
      planGroupMappingSave(
        [
          group("a", "admin", 10),
          group("b", "buyer", 20),
          group("c", null, 100)
        ],
        [
          { groupId: "b", employeeTypeId: "buyer" },
          { groupId: "a", employeeTypeId: "admin" },
          { groupId: "c", employeeTypeId: null }
        ]
      )
    ).toEqual({
      unknownGroupIds: [],
      updates: [
        { id: "b", employeeTypeId: "buyer", priority: 10 },
        { id: "a", employeeTypeId: "admin", priority: 20 }
      ],
      removedGroupIds: []
    });
  });

  it("reports an unmapped group and keeps its priority", () => {
    expect(
      planGroupMappingSave(
        [group("a", "admin", 10), group("b", "buyer", 20)],
        [
          { groupId: "b", employeeTypeId: "buyer" },
          { groupId: "a", employeeTypeId: null }
        ]
      )
    ).toEqual({
      unknownGroupIds: [],
      updates: [
        { id: "b", employeeTypeId: "buyer", priority: 10 },
        { id: "a", employeeTypeId: null, priority: 10 }
      ],
      removedGroupIds: ["a"]
    });
  });

  it("reports a group the company does not have", () => {
    expect(
      planGroupMappingSave(
        [group("a", null, 100)],
        [{ groupId: "x", employeeTypeId: "admin" }]
      ).unknownGroupIds
    ).toEqual(["x"]);
  });
});

describe("typeGrantsFor", () => {
  it("lists the keys whose arrays hold the company", () => {
    expect(
      typeGrantsFor(
        [
          {
            module: "Purchasing",
            view: ["c1"],
            create: ["c1"],
            update: [],
            delete: []
          },
          { module: "Sales", view: ["c2"], create: [], update: [], delete: [] }
        ],
        "c1"
      )
    ).toEqual(["purchasing_view", "purchasing_create"]);
  });
});

describe("replaceCompanyGrants", () => {
  const current = {
    sales_view: ["c1", "c2"],
    sales_update: ["c1"],
    purchasing_view: ["c2"]
  };

  it("keeps other companies' grants", () => {
    const next = replaceCompanyGrants(current, ["purchasing_view"], "c1");
    expect(next.sales_view).toEqual(["c2"]);
    expect(next.purchasing_view).toEqual(["c2", "c1"]);
  });

  it("removes a key the type no longer grants", () => {
    const next = replaceCompanyGrants(current, ["sales_view"], "c1");
    expect(next.sales_update).toEqual([]);
    expect(next.sales_view).toEqual(["c2", "c1"]);
  });

  it("adds a key the person never had", () => {
    const next = replaceCompanyGrants(current, ["quality_view"], "c1");
    expect(next.quality_view).toEqual(["c1"]);
  });

  it("does not change the input", () => {
    replaceCompanyGrants(current, [], "c1");
    expect(current.sales_view).toEqual(["c1", "c2"]);
  });
});

describe("stripCompanyGrants", () => {
  it("removes only the company", () => {
    expect(stripCompanyGrants({ a: ["c1", "c2"], b: ["c1"] }, "c1")).toEqual({
      a: ["c2"],
      b: []
    });
  });
});
