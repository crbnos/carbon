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

import { getPostgresClient } from "@carbon/database/client";
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
  createPart,
  createTool,
  getItemPlanning,
  setChangeNoticeStatus,
  setItemActive,
  setItemPostingGroup,
  setItemSourcing,
  updateConsumable,
  upsertConfigurationParameter,
  upsertConfigurationParameterGroup,
  updateItem,
  updateItemCost,
  updateItemPlanning,
  updateMaterial,
  updatePart,
  updateTool
} from "../app/modules/items/items.server";
import { createServiceContext } from "@carbon/api/service-fn.server";
import { pageClaims } from "./page-claims";

type Write = {
  table: string;
  op: "insert" | "update" | "delete";
  values?: unknown;
  filters: [string, unknown][];
};

/** A Supabase client that answers every read of a table with `reads[table]`
 *  and records each write. A table it has no answer for reads as null. An
 *  insert answers the row `inserted[table]` stands for, as `.select()` would. */
function fakeClient(
  reads: Record<string, unknown> = {},
  writeErrors: Record<string, unknown> = {},
  inserted: Record<string, unknown> = {}
) {
  const writes: Write[] = [];
  const client = {
    // The company permission checks before a Kysely write pass.
    rpc: async () => ({ data: null, error: null }),
    from(table: string) {
      const filters: [string, unknown][] = [];
      let write: Omit<Write, "table" | "filters"> | null = null;
      const answer = () => {
        if (write) {
          writes.push({ table, ...write, filters });
          const error = writeErrors[table] ?? null;
          const row = write.op === "insert" ? inserted[table] : undefined;
          return { data: error ? null : (row ?? null), error };
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
        match: (columns: Record<string, unknown>) => {
          filters.push(...Object.entries(columns));
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

/**
 * The item rows the gate reads (`item` id and type), at the Postgres wire: a
 * driver that answers every query with these rows. Kysely runs real.
 */
function itemsDatabase(items: Record<string, string>) {
  const rows = Object.entries(items).map(([id, type]) => ({ id, type }));
  const connection = {
    executeQuery: async () => ({ rows }),
    // oxlint-disable-next-line require-yield -- never streamed
    streamQuery: async function* () {
      throw new Error("not streamed");
    }
  };
  const done = async () => undefined;
  class Driver {
    init = done;
    acquireConnection = async () => connection;
    beginTransaction = done;
    commitTransaction = done;
    rollbackTransaction = done;
    releaseConnection = done;
    destroy = done;
  }
  return getPostgresClient({} as never, Driver as never);
}

const PARTS = itemsDatabase({
  i1: "Part",
  i2: "Part",
  i3: "Part",
  "old-part": "Part",
  "new-part": "Part"
});

function contextFor(
  caller: unknown,
  {
    system = unreachable,
    pg = () => PARTS,
    actions = ["view", "create", "update", "delete"]
  }: {
    system?: () => unknown;
    pg?: () => unknown;
    actions?: ("view" | "create" | "update" | "delete")[];
  } = {}
) {
  return createServiceContext({
    actor: {
      type: "user",
      role: "employee",
      userId: "user-1",
      permissions: pageClaims({
        parts: {
          view: actions.includes("view") ? ["company-1"] : [],
          create: actions.includes("create") ? ["company-1"] : [],
          update: actions.includes("update") ? ["company-1"] : [],
          delete: actions.includes("delete") ? ["company-1"] : []
        }
      })
    },
    company: { id: "company-1", groupId: "group-1" },
    caller: caller as any,
    system: system as any,
    pg: pg as any,
    kv: unreachable
  });
}

/**
 * A system connection, at the Postgres wire, that records each statement and
 * answers it with `answer(sql)`: its rows and affected count, or the error it
 * throws. Transactions run, and commit nothing.
 */
function scriptedPg(
  answer: (sql: string) => { rows?: unknown[]; numAffectedRows?: bigint }
) {
  const statements: { sql: string; parameters: readonly unknown[] }[] = [];
  const connection = {
    executeQuery: async (query: {
      sql: string;
      parameters: readonly unknown[];
    }) => {
      statements.push(query);
      return { rows: [], ...answer(query.sql) };
    },
    // oxlint-disable-next-line require-yield -- never streamed
    streamQuery: async function* () {
      throw new Error("not streamed");
    }
  };
  const done = async () => undefined;
  class Driver {
    init = done;
    acquireConnection = async () => connection;
    beginTransaction = done;
    commitTransaction = done;
    rollbackTransaction = done;
    releaseConnection = done;
    destroy = done;
  }
  return { pg: getPostgresClient({} as never, Driver as never), statements };
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

  const creates = [
    [
      "createConsumable",
      (ctx: any, sent: object = {}) =>
        createConsumable(ctx, { ...item, ...sent })
    ],
    [
      "createTool",
      (ctx: any, sent: object = {}) =>
        createTool(ctx, { ...item, revision: "0", ...sent })
    ],
    [
      "createPart",
      (ctx: any, sent: object = {}) =>
        createPart(ctx, { ...item, revision: "0", ...sent })
    ]
  ] as const;

  it.each(creates)("%s answers the new item's id and costs only that item of the company", async (_name, create) => {
    const { client } = fakeClient();
    const { pg, statements } = scriptedPg((sql) => {
      if (sql.startsWith('insert into "item"')) return { rows: [{ id: "i1" }] };
      if (sql.startsWith('update "itemCost"')) return { numAffectedRows: BigInt(1) };
      return {};
    });

    const result = await create(contextFor(client, { pg: () => pg }));

    expect(result).toEqual({ data: { id: "i1" }, error: null });
    const cost = statements.find((statement) =>
      statement.sql.startsWith('update "itemCost"')
    );
    expect(cost?.sql).toMatch(
      /where "itemId" in \(\$\d+\) and "companyId" = \$\d+$/
    );
    expect(cost?.parameters.slice(-2)).toEqual(["i1", "company-1"]);
  });

  it.each(creates)("%s answers a number another item has as a conflict", async (_name, create) => {
    const { client } = fakeClient();
    const { pg } = scriptedPg((sql) => {
      if (sql.startsWith('insert into "item"')) {
        throw Object.assign(
          new Error('duplicate key value violates unique constraint "item_unique"'),
          { code: "23505" }
        );
      }
      return {};
    });

    const result = await create(contextFor(client, { pg: () => pg }));

    expect(result.error?.category).toBe("conflict");
  });

  it.each(creates)("%s refuses a group of another company inside its transaction", async (_name, create) => {
    const { client } = fakeClient();
    const { pg, statements } = scriptedPg((sql) =>
      sql.startsWith('insert into "item"') ? { rows: [{ id: "i1" }] } : {}
    );

    const result = await create(contextFor(client, { pg: () => pg }), {
      postingGroupId: "other-company-group"
    });

    expect(result.error).toMatchObject({
      category: "rule",
      message: "Item group other-company-group not found"
    });
    expect(
      statements.some((statement) => statement.sql.startsWith('update "itemCost"'))
    ).toBe(false);
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

  it("refuses an empty readable id instead of reading it as left out", async () => {
    const { client, writes } = fakeClient(reads);
    const { pg, statements } = recordingPg();

    const result = await updateMaterial(contextFor(client, { pg: () => pg }), {
      ...material,
      readableId: ""
    });

    expect(result.error).toMatchObject({ category: "validation" });
    expect(writes).toEqual([]);
    expect(statements).toEqual([]);
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

describe("upsertConfigurationParameter", () => {
  const parameter = {
    itemId: "i1",
    key: "width",
    label: "Width",
    dataType: "numeric"
  } as const;

  it("refuses a parameter for an item of another company, and writes nothing", async () => {
    const { client, writes } = fakeClient();
    const system = fakeClient({ item: null });

    const result = await upsertConfigurationParameter(
      contextFor(client, { system: () => system.client }),
      { ...parameter, itemId: "other-item" }
    );

    expect(result.error).toMatchObject({ category: "notFound" });
    expect(writes).toEqual([]);
  });

  it("saves an edit with Edit on the item's page, only on the company's item", async () => {
    const { client, writes } = fakeClient();
    const system = fakeClient({ item: { id: "i1" } });

    const result = await upsertConfigurationParameter(
      contextFor(client, {
        system: () => system.client,
        actions: ["view", "update"]
      }),
      { ...parameter, id: "p1" }
    );

    expect(result.error).toBeNull();
    expect(writes).toMatchObject([
      {
        table: "configurationParameter",
        op: "update",
        filters: [
          ["id", "p1"],
          ["itemId", "i1"],
          ["companyId", "company-1"]
        ]
      }
    ]);
  });

  it("never writes the creation audit fields an edit sends", async () => {
    const { client, writes } = fakeClient();
    const system = fakeClient({ item: { id: "i1" } });
    // A caller's extra keys, which the input drops.
    const sent = {
      ...parameter,
      id: "p1",
      createdBy: "user-2",
      createdAt: "2020-01-01T00:00:00Z"
    };

    const result = await upsertConfigurationParameter(
      contextFor(client, {
        system: () => system.client,
        actions: ["view", "update"]
      }),
      sent
    );

    expect(result.error).toBeNull();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.values).not.toHaveProperty("createdBy");
    expect(writes[0]!.values).not.toHaveProperty("createdAt");
  });

  it("adds a parameter to the group sent, and answers its id", async () => {
    const { client, writes } = fakeClient(
      {
        configurationParameterGroup: [
          { id: "g-size", isUngrouped: false, sortOrder: 1 },
          { id: "g-ungrouped", isUngrouped: true, sortOrder: 2 }
        ]
      },
      {},
      { configurationParameter: { id: "p-new" } }
    );
    const system = fakeClient({ item: { id: "i1" } });

    const result = await upsertConfigurationParameter(
      contextFor(client, { system: () => system.client }),
      { ...parameter, configurationParameterGroupId: "g-size" }
    );

    expect(result).toEqual({ data: { id: "p-new" }, error: null });
    expect(writes).toMatchObject([
      {
        table: "configurationParameter",
        op: "insert",
        values: { configurationParameterGroupId: "g-size", itemId: "i1" }
      }
    ]);
  });

  it("adds a parameter sent without a group to the item's Ungrouped group", async () => {
    const { client, writes } = fakeClient(
      {
        configurationParameterGroup: [
          { id: "g-ungrouped", isUngrouped: true, sortOrder: 1 }
        ]
      },
      {},
      { configurationParameter: { id: "p-new" } }
    );
    const system = fakeClient({ item: { id: "i1" } });

    const result = await upsertConfigurationParameter(
      contextFor(client, { system: () => system.client }),
      parameter
    );

    expect(result.error).toBeNull();
    expect(writes).toMatchObject([
      {
        table: "configurationParameter",
        op: "insert",
        values: { configurationParameterGroupId: "g-ungrouped" }
      }
    ]);
  });

  it("refuses a group that is not one of the item's, and writes nothing", async () => {
    const { client, writes } = fakeClient();
    const system = fakeClient({ item: { id: "i1" } });

    const result = await upsertConfigurationParameter(
      contextFor(client, { system: () => system.client }),
      { ...parameter, configurationParameterGroupId: "g-other-item" }
    );

    expect(result.error).toMatchObject({ category: "rule" });
    expect(writes).toEqual([]);
  });
});

describe("upsertConfigurationParameterGroup", () => {
  it("refuses a group for an item of another company, and writes nothing", async () => {
    const { client, writes } = fakeClient();
    const system = fakeClient({ item: null });

    const result = await upsertConfigurationParameterGroup(
      contextFor(client, { system: () => system.client }),
      { itemId: "other-item", name: "Size" }
    );

    expect(result.error).toMatchObject({ category: "notFound" });
    expect(writes).toEqual([]);
  });

  it("renames a group only of the company's item", async () => {
    const { client, writes } = fakeClient();
    const system = fakeClient({ item: { id: "i1" } });

    const result = await upsertConfigurationParameterGroup(
      contextFor(client, { system: () => system.client }),
      { itemId: "i1", id: "g1", name: "Size" }
    );

    expect(result.error).toBeNull();
    expect(writes).toEqual([
      {
        table: "configurationParameterGroup",
        op: "update",
        values: { name: "Size" },
        filters: [
          ["id", "g1"],
          ["itemId", "i1"],
          ["companyId", "company-1"]
        ]
      }
    ]);
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

  const planning = {
    itemId: "i1",
    locationId: "loc-1",
    reorderingPolicy: "Manual Reorder" as const
  };
  const fenceWritten = async (fence: { planningTimeFenceDays?: number | null }) => {
    const { client, writes } = fakeClient();
    await updateItemPlanning(contextFor(client), { ...planning, ...fence });
    const update = writes.find(
      (write) => write.table === "itemPlanning" && write.op === "update"
    );
    return update?.values as Record<string, unknown>;
  };

  // An API or MCP caller that never heard of the fence must not undo an
  // item's explicit 0 (no fence) by resetting it to the location's.
  it("keeps the stored time fence when the save leaves it out", async () => {
    expect(await fenceWritten({})).not.toHaveProperty("planningTimeFenceDays");
  });

  it.each([
    [null, null],
    [0, 0],
    [5, 5]
  ])("writes a sent time fence of %s", async (sent, stored) => {
    expect(await fenceWritten({ planningTimeFenceDays: sent })).toMatchObject({
      planningTimeFenceDays: stored
    });
  });
});

describe("getItemPlanning", () => {
  it("answers the item's planning row with the location's time fence", async () => {
    const { client } = fakeClient({
      itemPlanning: { itemId: "i1", locationId: "loc-1", planningTimeFenceDays: null },
      location: { planningTimeFenceDays: 3 }
    });

    const result = await getItemPlanning(contextFor(client), {
      itemId: "i1",
      locationId: "loc-1"
    });

    expect(result).toEqual({
      data: {
        itemId: "i1",
        locationId: "loc-1",
        planningTimeFenceDays: null,
        locationPlanningTimeFenceDays: 3
      },
      error: null
    });
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

describe("item page permissions", () => {
  // Tools at Edit with Parts at View: a tool's cost can change, a part's cannot.
  const toolsEditor = (items: Record<string, string>, caller: unknown) =>
    createServiceContext({
      actor: {
        type: "user",
        role: "employee",
        userId: "user-1",
        permissions: pageClaims({
          "parts.tools": {
            view: ["company-1"],
            create: ["company-1"],
            update: ["company-1"],
            delete: []
          },
          "parts.parts": {
            view: ["company-1"],
            create: [],
            update: [],
            delete: []
          }
        })
      },
      company: { id: "company-1", groupId: "group-1" },
      caller: caller as any,
      system: unreachable as any,
      pg: () => itemsDatabase(items),
      kv: unreachable
    });

  it("lets Tools at Edit change a tool's cost", async () => {
    const { client, writes } = fakeClient();
    const result = await updateItemCost(
      toolsEditor({ "tool-1": "Tool" }, client),
      { itemId: "tool-1", cost: { unitCost: 12 } }
    );

    expect(result.error).toBeNull();
    expect(writes).toMatchObject([
      {
        table: "itemCost",
        op: "update",
        values: { unitCost: 12 },
        filters: [["itemId", "tool-1"]]
      }
    ]);
  });

  it("refuses a part's cost with Parts at View, and writes nothing", async () => {
    const { client, writes } = fakeClient();
    const result = await updateItemCost(
      toolsEditor({ "part-1": "Part" }, client),
      { itemId: "part-1", cost: { unitCost: 12 } }
    );

    expect(result.error).toMatchObject({ category: "forbidden", status: 403 });
    expect(writes).toEqual([]);
  });
});
