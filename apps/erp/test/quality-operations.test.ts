// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { createServiceContext } from "@carbon/api/service-fn.server";
import {
  createIssue,
  saveInspectionDocument,
  setIssueStatus,
  updateIssueField,
  updateIssueItemField,
  updateQualityDocumentField
} from "../app/modules/quality/quality.server";

const quality = {
  quality: {
    view: ["company-1"],
    create: ["company-1"],
    update: ["company-1"],
    delete: ["company-1"]
  }
};

/**
 * A Supabase client whose every query answers with the rows the test names
 * for its table. Any write is recorded; nothing else is checked.
 */
function client(rows: Record<string, unknown>) {
  const writes: string[] = [];
  const from = (table: string) => {
    const result = { data: rows[table] ?? null, error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "limit", "order"]) {
      chain[method] = () => chain;
    }
    for (const method of ["insert", "update", "delete"]) {
      chain[method] = () => {
        writes.push(`${method}:${table}`);
        return chain;
      };
    }
    chain.single = chain.maybeSingle = () => Promise.resolve(result);
    chain.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve(result).then(resolve);
    return chain;
  };
  return { from, writes } as unknown as {
    from: typeof from;
    writes: string[];
  };
}

function contextWith(rows: Record<string, unknown> = {}) {
  const db = client(rows);
  const ctx = createServiceContext({
    actor: { type: "user", userId: "user-1", permissions: quality },
    company: { id: "company-1", groupId: "group-1" },
    caller: db as never,
    system: () => db as never,
    pg: () => ({}) as never,
    kv: () => ({}) as never
  });
  return { ctx, writes: db.writes };
}

describe("opening an issue", () => {
  const issue = {
    name: "Cracked housing",
    priority: "Medium",
    source: "Internal",
    locationId: "loc-1",
    nonConformanceTypeId: "type-1",
    openDate: "2026-10-16"
  } as const;

  it("refuses a record of another company, and creates nothing", async () => {
    // Every reference is found, except the location.
    const { ctx, writes } = contextWith({
      location: [],
      nonConformanceType: [{ id: "type-1" }]
    });

    const result = await createIssue(ctx, issue);

    expect(result.error).toMatchObject({ category: "notFound" });
    expect(writes).toEqual([]);
  });
});

describe("issue status", () => {
  it("cannot close an issue: closing posts its dispositions", async () => {
    const { ctx } = contextWith();
    const result = await setIssueStatus(ctx, {
      id: "nc-1",
      status: "Closed" as never
    });
    expect(result.error?.category).toBe("validation");
  });

  it("refuses to reopen an issue whose dispositions posted inventory", async () => {
    const { ctx, writes } = contextWith({
      nonConformance: { status: "Closed" },
      itemLedger: [{ id: "il-1" }]
    });

    const result = await setIssueStatus(ctx, {
      id: "nc-1",
      status: "Registered"
    });

    expect(result.error?.category).toBe("rule");
    expect(writes).toEqual([]);
  });
});

describe("a closed issue is locked", () => {
  it("refuses a field change when any of the issues is closed", async () => {
    const { ctx, writes } = contextWith({
      nonConformance: [
        { id: "nc-1", status: "In Progress" },
        { id: "nc-2", status: "Closed" }
      ]
    });

    const result = await updateIssueField(ctx, {
      ids: ["nc-1", "nc-2"],
      field: "priority",
      value: "High"
    });

    expect(result.error?.category).toBe("rule");
    expect(writes).toEqual([]);
  });

  it("refuses a disposition change on a closed issue", async () => {
    const { ctx, writes } = contextWith({
      nonConformanceItem: { nonConformance: { status: "Closed" } }
    });

    const result = await updateIssueItemField(ctx, {
      id: "nci-1",
      field: "disposition",
      value: "Scrap"
    });

    expect(result.error?.category).toBe("rule");
    expect(writes).toEqual([]);
  });

  it("refuses a missing disposition row before any write", async () => {
    const { ctx, writes } = contextWith({ nonConformanceItem: null });

    const result = await updateIssueItemField(ctx, {
      id: "nci-missing",
      field: "disposition",
      value: "Scrap"
    });

    expect(result.error?.category).toBe("notFound");
    expect(writes).toEqual([]);
  });

  it("refuses a negative quantity", async () => {
    const { ctx, writes } = contextWith();
    const result = await updateIssueItemField(ctx, {
      id: "nci-1",
      field: "quantity",
      value: -3,
      expectedQuantity: 0
    });
    expect(result.error?.category).toBe("validation");
    expect(writes).toEqual([]);
  });
});

describe("quality document fields", () => {
  it("refuses a status that is not one", async () => {
    const { ctx, writes } = contextWith();
    const result = await updateQualityDocumentField(ctx, {
      ids: ["qd-1"],
      field: "status",
      value: "Published"
    });
    expect(result.error?.category).toBe("validation");
    expect(writes).toEqual([]);
  });

  it("takes a single tag as the whole list", async () => {
    const { ctx, writes } = contextWith();
    const result = await updateQualityDocumentField(ctx, {
      ids: ["qd-1"],
      field: "tags",
      value: "ISO 9001"
    });
    expect(result.error).toBeNull();
    expect(writes).toEqual(["update:qualityDocument"]);
  });
});

describe("saving an inspection plan", () => {
  it("refuses legacy balloons sent without their anchors", async () => {
    const { ctx, writes } = contextWith();
    const result = await saveInspectionDocument(ctx, {
      inspectionDocumentId: "doc-1",
      balloons: {
        create: [
          {
            tempBalloonAnchorId: "anchor-1",
            label: "1",
            xCoordinate: 0.5,
            yCoordinate: 0.5
          }
        ],
        update: [],
        delete: []
      }
    });
    expect(result.error?.category).toBe("validation");
    expect(writes).toEqual([]);
  });
});
