// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { trigger } = vi.hoisted(() => ({ trigger: vi.fn() }));
vi.mock("@carbon/jobs", () => ({ trigger }));
// The approval engine works in the database; here it answers per test.
vi.mock("@carbon/ee/approvals/document.server", () => ({
  openApprovalRequests: vi.fn(),
  cancelPendingApprovals: vi.fn(),
  decideApprovalRequest: vi.fn()
}));

import { openApprovalRequests } from "@carbon/ee/approvals/document.server";
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler
} from "kysely";
import {
  addItemPredecessor,
  createConsumable,
  createTool,
  setChangeNoticeStatus,
  setItemActive,
  setItemPostingGroup,
  setItemSourcing,
  updateConsumable,
  updateItem,
  updateItemPlanning,
  updateMaterial,
  updatePart,
  updateTool
} from "../app/modules/items/items.server";
import { createServiceContext } from "@carbon/api/service-fn.server";

type Write = {
  table: string;
  op: "insert" | "update" | "delete";
  values?: unknown;
  filters: [string, unknown][];
};

/** A Supabase client that answers every read of a table with `reads[table]`
 *  and records each write. A table it has no answer for reads as null. */
function fakeClient(reads: Record<string, unknown> = {}) {
  const writes: Write[] = [];
  const client = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      let write: Omit<Write, "table" | "filters"> | null = null;
      const answer = () => {
        if (write) {
          writes.push({ table, ...write, filters });
          return { data: null, error: null };
        }
        return { data: reads[table] ?? null, error: null };
      };
      const chain: Record<string, unknown> = {
        select: () => chain,
        insert: (values: unknown) => {
          write = { op: "insert", values };
          return chain;
        },
        update: (values: unknown) => {
          write = { op: "update", values };
          return chain;
        },
        upsert: (values: unknown) => {
          write = { op: "insert", values };
          return chain;
        },
        delete: () => {
          write = { op: "delete" };
          return chain;
        },
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return chain;
        },
        in: (column: string, value: unknown) => {
          filters.push([column, value]);
          return chain;
        },
        or: () => chain,
        limit: () => chain,
        order: () => chain,
        range: () => chain,
        maybeSingle: async () => answer(),
        single: async () => answer(),
        then: (resolve: (value: unknown) => unknown) => resolve(answer())
      };
      return chain;
    }
  };
  return { client: client as any, writes };
}

const unreachable = () => {
  throw new Error("must not be reached");
};

function contextFor(
  caller: unknown,
  {
    system = unreachable,
    pg = () => ({})
  }: { system?: () => unknown; pg?: () => unknown } = {}
) {
  return createServiceContext({
    actor: {
      type: "user",
      userId: "user-1",
      permissions: {
        parts: {
          view: ["company-1"],
          create: ["company-1"],
          update: ["company-1"],
          delete: ["company-1"]
        }
      }
    },
    company: { id: "company-1", groupId: "group-1" },
    caller: caller as any,
    system: system as any,
    pg: pg as any,
    kv: unreachable
  });
}

/** A system connection that answers no rows and records each statement. */
function recordingPg() {
  const statements: { sql: string; parameters: readonly unknown[] }[] = [];
  const pg = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler()
    },
    log: (event) => {
      if (event.level === "query") statements.push(event.query);
    }
  });
  return { pg, statements };
}

beforeEach(() => {
  vi.clearAllMocks();
  trigger.mockResolvedValue(undefined);
});

describe("setItemPostingGroup", () => {
  it("updates the items that have a cost row and creates one for each that has none", async () => {
    const { client, writes } = fakeClient({ itemCost: [{ itemId: "i1" }] });

    const result = await setItemPostingGroup(contextFor(client), {
      ids: ["i1", "i2", "i3"],
      itemPostingGroupId: "group-a"
    });

    expect(result.error).toBeNull();
    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatchObject({
      op: "update",
      values: { itemPostingGroupId: "group-a" },
      filters: [
        ["itemId", ["i1"]],
        ["companyId", "company-1"]
      ]
    });
    expect(writes[1].op).toBe("insert");
    expect(writes[1].values).toMatchObject([
      { itemId: "i2", itemPostingGroupId: "group-a", companyId: "company-1" },
      { itemId: "i3", itemPostingGroupId: "group-a", companyId: "company-1" }
    ]);
  });
});

describe("setItemSourcing", () => {
  it.each<Parameters<typeof setItemSourcing>[1]>([
    { ids: ["i1"] },
    { ids: ["i1"], replenishmentSystem: "Make", sourcingType: "Drop Ship" }
  ])("refuses a call that sets none, or more than one, of the three fields", async (input) => {
    const result = await setItemSourcing(contextFor(unreachable), input);
    expect(result.error).toMatchObject({ category: "validation" });
  });
});

describe("setItemActive", () => {
  it("refuses to activate an item its unreleased change notice created, and writes nothing", async () => {
    const { client, writes } = fakeClient();
    const system = fakeClient({
      item: [
        { id: "i1", readableIdWithRevision: "P1.A", changeOrderId: "co-1" }
      ],
      changeOrder: [{ id: "co-1", changeOrderId: "ECO-1", status: "Draft" }]
    });

    const result = await setItemActive(
      contextFor(client, { system: () => system.client }),
      { ids: ["i1"], active: true }
    );

    expect(result.error).toMatchObject({ category: "rule" });
    expect(result.error?.message).toContain("ECO-1");
    expect(writes).toHaveLength(0);
  });

  it("deactivates without checking change notices", async () => {
    const { client, writes } = fakeClient();

    const result = await setItemActive(contextFor(client), {
      ids: ["i1"],
      active: false
    });

    expect(result.error).toBeNull();
    expect(writes).toMatchObject([{ op: "update", values: { active: false } }]);
  });
});

describe("details saves", () => {
  const details = {
    id: "i1",
    name: "Bracket",
    replenishmentSystem: "Buy",
    defaultMethodType: "Pull from Inventory",
    itemTrackingType: "Inventory",
    unitOfMeasureCode: "EA"
  } as const;

  /** The item row once the save's item updates whose filters match it have
   *  landed on it, as the database would apply them. */
  function itemAfter(row: Record<string, unknown>, writes: Write[]) {
    const matches = (write: Write) =>
      write.filters.every(([column, value]) =>
        Array.isArray(value) ? value.includes(row[column]) : row[column] === value
      );
    return writes
      .filter(
        (write) =>
          write.table === "item" && write.op === "update" && matches(write)
      )
      .reduce((item, write) => ({ ...item, ...(write.values as object) }), row);
  }

  it.each([
    ["updatePart", (ctx: any) => updatePart(ctx, { ...details, revision: "0" })],
    ["updateTool", (ctx: any) => updateTool(ctx, { ...details, revision: "0" })],
    ["updateConsumable", (ctx: any) => updateConsumable(ctx, details)]
  ])("%s leaves an inactive item inactive", async (_name, save) => {
    const stored = {
      id: "i1",
      companyId: "company-1",
      readableId: "P1",
      active: false
    };
    const { client, writes } = fakeClient({ item: stored });

    const result = await save(contextFor(client));

    expect(result.error).toBeNull();
    expect(itemAfter(stored, writes)).toMatchObject({
      name: "Bracket",
      active: false
    });
  });
});

describe("item creates", () => {
  const item = {
    id: "C-100",
    name: "Gloves",
    replenishmentSystem: "Buy",
    defaultMethodType: "Pull from Inventory",
    itemTrackingType: "Inventory",
    unitOfMeasureCode: "EA"
  } as const;

  it.each([
    ["createConsumable", "consumables", (ctx: any) => createConsumable(ctx, item)],
    [
      "createTool",
      "tools",
      (ctx: any) => createTool(ctx, { ...item, revision: "0" })
    ]
  ])("%s answers the new item's id, as createPart does", async (_name, view, create) => {
    const { client } = fakeClient({ [view]: { id: "i1", readableId: "C-100" } });

    const result = await create(contextFor(client));

    expect(result).toEqual({ data: { id: "i1" }, error: null });
  });
});

describe("updateMaterial under generated material IDs", () => {
  const material = {
    id: "i1",
    replenishmentSystem: "Buy",
    defaultMethodType: "Pull from Inventory",
    itemTrackingType: "Inventory",
    unitOfMeasureCode: "EA"
  } as const;
  const reads = {
    companySettings: { materialGeneratedIds: true },
    item: { id: "i1", readableId: "AL-PL" },
    material: {
      materialSubstanceId: "aluminum",
      materialFormId: "plate",
      materialTypeId: null,
      finishId: null,
      gradeId: null,
      dimensionId: null
    },
    materialSubstance: { name: "Aluminum", code: "AL" },
    materialForm: { name: "Sheet", code: "SH" }
  };

  it("writes a sent name to the item when no property changes, as the panel's name field does", async () => {
    const { client } = fakeClient(reads);
    const { pg, statements } = recordingPg();

    const result = await updateMaterial(contextFor(client, { pg: () => pg }), {
      ...material,
      name: "Plate offcuts"
    });

    expect(result.error).toBeNull();
    const itemUpdate = statements.find((statement) =>
      statement.sql.startsWith('update "item"')
    );
    expect(itemUpdate?.parameters).toContain("Plate offcuts");
  });

  it("refuses a name the property change does not derive, before any write", async () => {
    const { client, writes } = fakeClient(reads);
    const { pg, statements } = recordingPg();

    const result = await updateMaterial(contextFor(client, { pg: () => pg }), {
      ...material,
      materialFormId: "sheet",
      name: "Plate offcuts"
    });

    expect(result.error).toMatchObject({ category: "rule" });
    expect(writes).toEqual([]);
    expect(statements).toEqual([]);
  });
});

describe("setChangeNoticeStatus", () => {
  const gated = {
    id: "co-1",
    fromStatus: "Engineering Complete",
    status: "Implementation"
  } as const;

  it("opens no approval request for a notice that moved on", async () => {
    const { client } = fakeClient({ changeOrder: { status: "Implementation" } });

    const result = await setChangeNoticeStatus(contextFor(client), gated);

    expect(result.error).toMatchObject({ category: "conflict" });
    expect(openApprovalRequests).not.toHaveBeenCalled();
  });

  it("submits for approval instead of moving when a rule gates the step", async () => {
    const { client, writes } = fakeClient({
      changeOrder: { status: "Engineering Complete" }
    });
    vi.mocked(openApprovalRequests).mockResolvedValue({
      status: "opened",
      requested: ["co-1"],
      alreadyPending: [],
      approverIds: ["approver-1"]
    });

    const result = await setChangeNoticeStatus(
      contextFor(client, { system: () => ({}) }),
      gated
    );

    expect(result.data).toMatchObject({ approvalRequested: true });
    expect(writes).toEqual([]);
  });

  it("refuses a second request while one is pending", async () => {
    const { client, writes } = fakeClient({
      changeOrder: { status: "Engineering Complete" }
    });
    vi.mocked(openApprovalRequests).mockResolvedValue({
      status: "opened",
      requested: [],
      alreadyPending: ["co-1"],
      approverIds: []
    });

    const result = await setChangeNoticeStatus(
      contextFor(client, { system: () => ({}) }),
      gated
    );

    expect(result.error).toMatchObject({ category: "conflict" });
    expect(writes).toEqual([]);
  });
});

describe("addItemPredecessor", () => {
  const predecessor = {
    itemId: "new-part",
    supersessionMode: "Consume First",
    conversionFactor: 1
  } as const;

  it("refuses a part as its own predecessor before reading anything", async () => {
    const result = await addItemPredecessor(contextFor(unreachable), {
      ...predecessor,
      predecessorItemId: "new-part"
    });

    expect(result.error).toMatchObject({ category: "rule" });
  });

  it("refuses a predecessor that already has another successor", async () => {
    const { client, writes } = fakeClient({
      item: { id: "old-part", readableIdWithRevision: "P1" },
      itemSupersession: {
        successorItemId: "other-part",
        successor: { readableIdWithRevision: "P9" }
      }
    });

    const result = await addItemPredecessor(contextFor(client), {
      ...predecessor,
      predecessorItemId: "old-part"
    });

    expect(result.error).toMatchObject({ category: "rule" });
    expect(writes).toEqual([]);
  });
});

describe("updateItemPlanning", () => {
  it("refuses a responsible employee who is not an active employee of the company", async () => {
    const { client, writes } = fakeClient({ employee: null });

    const result = await updateItemPlanning(contextFor(client), {
      itemId: "i1",
      locationId: "loc-1",
      reorderingPolicy: "Manual Reorder",
      responsibleEmployee: "someone-else"
    });

    expect(result.error).toMatchObject({ category: "rule" });
    expect(writes).toEqual([]);
  });
});

describe("updateItem", () => {
  const part = {
    id: "i1",
    name: "Bracket",
    replenishmentSystem: "Buy",
    defaultMethodType: "Purchase to Order",
    itemTrackingType: "Inventory",
    unitOfMeasureCode: "EA",
    type: "Part"
  } as const;

  it("refuses a readable id that differs from the item's, and writes nothing", async () => {
    const { client, writes } = fakeClient({ item: { readableId: "P-100" } });

    for (const readableId of ["P-200", ""]) {
      const result = await updateItem(contextFor(client), {
        ...part,
        readableId
      });

      expect(result.error).toMatchObject({ category: "rule" });
      expect(result.error?.message).toContain("setItemReadableId");
    }
    expect(writes).toHaveLength(0);
  });

  it("refuses an item that is not of the type sent, and writes nothing", async () => {
    const { client, writes } = fakeClient({ item: null });

    const result = await updateItem(contextFor(client), {
      ...part,
      type: "Tool"
    });

    expect(result.error).toMatchObject({ category: "rule" });
    expect(writes).toHaveLength(0);
  });

  it("writes neither the readable id nor the type", async () => {
    const { client, writes } = fakeClient({ item: { readableId: "P-100" } });

    const result = await updateItem(contextFor(client), {
      ...part,
      readableId: "P-100",
      name: "Bracket, painted"
    });

    expect(result.error).toBeNull();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      table: "item",
      op: "update",
      values: { name: "Bracket, painted" }
    });
    expect(writes[0].values).not.toHaveProperty("readableId");
    expect(writes[0].values).not.toHaveProperty("type");
  });
});
