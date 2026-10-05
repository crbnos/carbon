// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import {
  type CompiledQuery,
  type DatabaseConnection,
  DummyDriver,
  Kysely as KyselyClient,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryResult
} from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";

// diffMethod now lives in items.service. Importing the real module drags in the
// items.service graph, which transitively loads @carbon/content/glossary — whose
// module-load-time Lingui `msg` macro isn't transformed under plain vitest and
// throws. The pure diffMethod under test needs none of it, so stub glossary; the
// diffMethod under test stays the genuine implementation.
vi.mock("@carbon/content/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn()
}));

// The server functions (get-method copies a revision's make method) run their
// own transactions; the boundary here is the call.
const { serverFnInvoke } = vi.hoisted(() => ({ serverFnInvoke: vi.fn() }));
vi.mock("@carbon/server-functions", () => {
  const invoker = { invoke: serverFnInvoke };
  return { serverFns: { system: () => invoker, as: () => invoker } };
});

const {
  createRevision,
  deleteItem,
  diffMethod,
  duplicateMethodOperationStep,
  removeChangeNoticeAffectedItem
} = await import("./items.service");

// A minimal live methodMaterial row (only the fields diffMethod compares + id).
function baseMaterial(over: Record<string, unknown> = {}) {
  return {
    id: "mm_1",
    itemId: "P1",
    quantity: 2,
    order: 1,
    unitOfMeasureCode: "EA",
    methodType: "Buy",
    sourcingType: "Specified",
    ...over
  };
}

// A staged material pointing back at a live material via sourceMaterialId.
function stagedMaterial(over: Record<string, unknown> = {}) {
  return {
    id: "cosm_1",
    sourceMaterialId: "mm_1",
    itemId: "P1",
    quantity: 2,
    order: 1,
    unitOfMeasureCode: "EA",
    methodType: "Buy",
    sourcingType: "Specified",
    ...over
  };
}

function baseOperation(over: Record<string, unknown> = {}) {
  return {
    id: "mo_1",
    order: 1,
    operationOrder: "After Previous",
    description: "Cut",
    setupTime: 5,
    laborTime: 10,
    machineTime: 0,
    ...over
  };
}

function stagedOperation(over: Record<string, unknown> = {}) {
  return {
    id: "coso_1",
    sourceOperationId: "mo_1",
    order: 1,
    operationOrder: "After Previous",
    description: "Cut",
    setupTime: 5,
    laborTime: 10,
    machineTime: 0,
    ...over
  };
}

const EMPTY = {
  baseMaterials: [],
  targetMaterials: [],
  baseOperations: [],
  targetOperations: []
};

describe("diffMethod — materials", () => {
  it("classifies a staged line with no source pointer as added", () => {
    const { materials } = diffMethod({
      ...EMPTY,
      targetMaterials: [stagedMaterial({ sourceMaterialId: null })]
    });
    expect(materials).toHaveLength(1);
    expect(materials[0].status).toBe("added");
    expect(materials[0].before).toBeNull();
    expect(materials[0].after).not.toBeNull();
  });

  it("classifies a base line nothing points at as removed", () => {
    const { materials } = diffMethod({
      ...EMPTY,
      baseMaterials: [baseMaterial()]
    });
    expect(materials).toHaveLength(1);
    expect(materials[0].status).toBe("removed");
    expect(materials[0].before).not.toBeNull();
    expect(materials[0].after).toBeNull();
  });

  it("classifies a matched pair with a changed field as modified", () => {
    const { materials } = diffMethod({
      ...EMPTY,
      baseMaterials: [baseMaterial()],
      targetMaterials: [stagedMaterial({ quantity: 5 })]
    });
    expect(materials).toHaveLength(1);
    expect(materials[0].status).toBe("modified");
    expect(materials[0].changedFields).toEqual({
      quantity: { before: 2, after: 5 }
    });
  });

  it("classifies an identical matched pair as unchanged", () => {
    const { materials } = diffMethod({
      ...EMPTY,
      baseMaterials: [baseMaterial()],
      targetMaterials: [stagedMaterial()]
    });
    expect(materials).toHaveLength(1);
    expect(materials[0].status).toBe("unchanged");
    expect(materials[0].changedFields).toBeUndefined();
  });

  it("treats numeric-string vs number quantities as unchanged", () => {
    const { materials } = diffMethod({
      ...EMPTY,
      baseMaterials: [baseMaterial({ quantity: "2" })],
      targetMaterials: [stagedMaterial({ quantity: 2 })]
    });
    expect(materials[0].status).toBe("unchanged");
  });

  // N→1 consolidation: an assembly's draft BOM drops 3 components and adds one
  // new part. The diff must read as 3 removed + 1 added (no supersession) — the
  // shape the consolidation feature surfaces on the assembly's Changes card.
  it("consolidation: 3 base materials removed, 1 new part added", () => {
    const { materials } = diffMethod({
      ...EMPTY,
      baseMaterials: [
        baseMaterial({ id: "mm_1", itemId: "P1", order: 1 }),
        baseMaterial({ id: "mm_2", itemId: "P2", order: 2 }),
        baseMaterial({ id: "mm_3", itemId: "P3", order: 3 })
      ],
      targetMaterials: [
        stagedMaterial({
          id: "cosm_new",
          sourceMaterialId: null,
          itemId: "P_NEW",
          order: 1
        })
      ]
    });
    expect(materials.filter((m) => m.status === "removed")).toHaveLength(3);
    expect(materials.filter((m) => m.status === "added")).toHaveLength(1);
    expect(materials.filter((m) => m.status === "modified")).toHaveLength(0);
    expect(materials.find((m) => m.status === "added")?.after?.itemId).toBe(
      "P_NEW"
    );
  });
});

describe("diffMethod — operations", () => {
  it("classifies an added operation (null source)", () => {
    const { operations } = diffMethod({
      ...EMPTY,
      targetOperations: [stagedOperation({ sourceOperationId: null })]
    });
    expect(operations[0].status).toBe("added");
  });

  it("classifies a removed operation", () => {
    const { operations } = diffMethod({
      ...EMPTY,
      baseOperations: [baseOperation()]
    });
    expect(operations[0].status).toBe("removed");
  });

  it("classifies a modified operation and records the changed field", () => {
    const { operations } = diffMethod({
      ...EMPTY,
      baseOperations: [baseOperation()],
      targetOperations: [stagedOperation({ setupTime: 20 })]
    });
    expect(operations[0].status).toBe("modified");
    expect(operations[0].changedFields).toEqual({
      setupTime: { before: 5, after: 20 }
    });
  });

  it("classifies an unchanged operation", () => {
    const { operations } = diffMethod({
      ...EMPTY,
      baseOperations: [baseOperation()],
      targetOperations: [stagedOperation()]
    });
    expect(operations[0].status).toBe("unchanged");
  });

  it("records process type, assembly instruction, and inspection plan changes", () => {
    const { operations } = diffMethod({
      ...EMPTY,
      baseOperations: [
        baseOperation({
          operationType: "Process",
          assemblyInstructionId: "ai_1",
          inspectionDocumentId: "doc_1"
        })
      ],
      targetOperations: [
        stagedOperation({
          operationType: "Assembly",
          assemblyInstructionId: "ai_2",
          inspectionDocumentId: "doc_2"
        })
      ]
    });
    expect(operations[0].status).toBe("modified");
    expect(operations[0].changedFields).toEqual({
      operationType: { before: "Process", after: "Assembly" },
      assemblyInstructionId: { before: "ai_1", after: "ai_2" },
      inspectionDocumentId: { before: "doc_1", after: "doc_2" }
    });
  });
});

describe("diffMethod — operation children", () => {
  it("carries no children when child maps are omitted (backward compatible)", () => {
    const { operations } = diffMethod({
      ...EMPTY,
      baseOperations: [baseOperation()],
      targetOperations: [stagedOperation()]
    });
    expect(operations[0].children).toBeUndefined();
  });

  it("diffs steps/parameters/tools by sourceId per matched operation", () => {
    const { operations } = diffMethod({
      ...EMPTY,
      baseOperations: [baseOperation()],
      targetOperations: [stagedOperation()],
      baseOperationChildren: {
        // keyed by the LIVE operation id (mo_1)
        mo_1: {
          steps: [{ id: "mos_1", name: "Inspect", sortOrder: 1 }],
          parameters: [{ id: "mop_1", key: "speed", value: "100" }],
          tools: [{ id: "mot_1", toolId: "T1", quantity: 1 }]
        }
      },
      targetOperationChildren: {
        // keyed by the STAGED operation id (coso_1)
        coso_1: {
          steps: [
            // modified: sortOrder changed
            { id: "coss_1", sourceId: "mos_1", name: "Inspect", sortOrder: 2 }
          ],
          parameters: [
            // added: no sourceId
            { id: "cosp_1", sourceId: null, key: "feed", value: "5" }
          ],
          // tools: mot_1 nothing points at ⇒ removed
          tools: []
        }
      }
    });

    const children = operations[0].children!;
    expect(children.steps).toHaveLength(1);
    expect(children.steps[0].status).toBe("modified");
    expect(children.steps[0].changedFields).toEqual({
      sortOrder: { before: 1, after: 2 }
    });

    // base mop_1 dropped (removed) + staged cosp_1 with no sourceId (added)
    expect(children.parameters).toHaveLength(2);
    expect(children.parameters.map((e) => e.status).sort()).toEqual([
      "added",
      "removed"
    ]);

    expect(children.tools).toHaveLength(1);
    expect(children.tools[0].status).toBe("removed");
  });
});

// ── duplicateMethodOperationStep: link-carrying copy ─────────────────────────
// Tiny fake supabase client mirroring the chain shapes this function uses:
// canned rows for selects, records inserts.
function makeFakeClient(opts: {
  rows: Record<string, Record<string, unknown>[]>;
  newIdByTable?: Record<string, string>;
  errorOnInsert?: string;
}) {
  const inserts: { table: string; rows: Record<string, unknown>[] }[] = [];

  function resolve(state: {
    table: string;
    op?: "insert";
    filters: Record<string, unknown>;
    insertRows?: Record<string, unknown>[];
    single: boolean;
  }) {
    if (state.op === "insert") {
      inserts.push({ table: state.table, rows: state.insertRows ?? [] });
      if (opts.errorOnInsert === state.table) {
        return {
          data: null,
          error: { message: `insert failed: ${state.table}` }
        };
      }
      if (state.single) {
        const id = opts.newIdByTable?.[state.table] ?? `new_${state.table}`;
        return { data: { id }, error: null };
      }
      return { data: null, error: null };
    }
    let data = opts.rows[state.table] ?? [];
    for (const [col, val] of Object.entries(state.filters)) {
      data = data.filter((r) => r[col] === val);
    }
    return state.single
      ? { data: data[0] ?? null, error: null }
      : { data, error: null };
  }

  function builder(table: string) {
    const state = {
      table,
      filters: {} as Record<string, unknown>,
      op: undefined as "insert" | undefined,
      insertRows: undefined as Record<string, unknown>[] | undefined,
      single: false
    };
    const b = {
      select: () => b,
      eq: (col: string, val: unknown) => {
        state.filters[col] = val;
        return b;
      },
      insert: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
        state.op = "insert";
        state.insertRows = Array.isArray(rows) ? rows : [rows];
        return b;
      },
      single: () => {
        state.single = true;
        return Promise.resolve(resolve(state));
      },
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(state)).then(onF, onR)
    };
    return b;
  }

  return { client: { from: builder } as never, inserts };
}

describe("duplicateMethodOperationStep", () => {
  function sourceRows() {
    return {
      methodOperationStep: [
        {
          id: "step-1",
          operationId: "op-1",
          name: "Deburr",
          description: null,
          type: "Task",
          unitOfMeasureCode: null,
          minValue: null,
          maxValue: null,
          listValues: null,
          sortOrder: 2
        },
        { id: "step-2", operationId: "op-1", sortOrder: 5 }
      ],
      methodOperationStepSlide: [
        {
          stepId: "step-1",
          imagePath: "/x.png",
          modelUploadId: null,
          caption: "c",
          sortOrder: 1,
          size: "medium",
          annotations: "[]"
        }
      ],
      methodOperationToolStep: [
        { methodOperationToolId: "tool-1", methodOperationStepId: "step-1" }
      ],
      methodMaterialStep: [
        {
          methodMaterialId: "mat-1",
          methodOperationStepId: "step-1",
          quantity: 5
        }
      ]
    };
  }

  it("copies the step and carries its slides/tool-links/material-links onto the clone", async () => {
    const { client, inserts } = makeFakeClient({
      rows: sourceRows(),
      newIdByTable: { methodOperationStep: "step-new" }
    });

    const result = await duplicateMethodOperationStep(client, {
      id: "step-1",
      companyId: "c1",
      createdBy: "u1"
    });
    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: "step-new" });

    expect(
      inserts.find((i) => i.table === "methodOperationStep")?.rows[0]
    ).toMatchObject({
      operationId: "op-1",
      name: "Deburr (copy)",
      sortOrder: 6, // max sibling sortOrder (5) + 1
      companyId: "c1",
      createdBy: "u1"
    });
    expect(
      inserts.find((i) => i.table === "methodOperationStepSlide")?.rows[0]
    ).toMatchObject({ stepId: "step-new", imagePath: "/x.png" });
    expect(
      inserts.find((i) => i.table === "methodOperationToolStep")?.rows
    ).toEqual([
      { methodOperationToolId: "tool-1", methodOperationStepId: "step-new" }
    ]);
    expect(inserts.find((i) => i.table === "methodMaterialStep")?.rows).toEqual(
      [
        {
          methodMaterialId: "mat-1",
          methodOperationStepId: "step-new",
          quantity: 5
        }
      ]
    );
  });

  it("aborts and surfaces the error if a child copy fails (no further inserts)", async () => {
    const { client, inserts } = makeFakeClient({
      rows: sourceRows(),
      newIdByTable: { methodOperationStep: "step-new" },
      errorOnInsert: "methodOperationToolStep"
    });

    const result = await duplicateMethodOperationStep(client, {
      id: "step-1",
      companyId: "c1",
      createdBy: "u1"
    });

    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
    // Tool-link copy failed → the material-link copy must never run.
    expect(inserts.some((i) => i.table === "methodMaterialStep")).toBe(false);
  });
});

// A supplierPart row as the diff reads it (every column, as `select("*")`).
function supplierPart(over: Record<string, unknown> = {}) {
  return {
    id: "sp-1",
    itemId: "item-a",
    supplierId: "sup-1",
    supplierPartId: "ACME-100",
    supplierUnitOfMeasureCode: "BOX",
    minimumOrderQuantity: 10,
    orderMultiple: 5,
    conversionFactor: 12,
    unitPrice: 4.5,
    active: true,
    customFields: null,
    tags: null,
    companyId: "c1",
    createdBy: "u1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedBy: null,
    updatedAt: null,
    ...over
  };
}

describe("diffMethod — supplier parts", () => {
  it("reads a revision's copied supplier parts as unchanged", () => {
    const { supplierParts } = diffMethod({
      ...EMPTY,
      baseSupplierParts: [
        supplierPart(),
        supplierPart({ id: "sp-2", supplierId: "sup-2" })
      ],
      // The copy is a different row on a different item, created later.
      targetSupplierParts: [
        supplierPart({
          id: "sp-9",
          itemId: "item-b",
          createdBy: "u2",
          createdAt: "2026-02-01T00:00:00Z"
        }),
        supplierPart({ id: "sp-10", itemId: "item-b", supplierId: "sup-2" })
      ]
    });
    expect(supplierParts.map((e) => e.status)).toEqual([
      "unchanged",
      "unchanged"
    ]);
  });

  it("reports an edited, a dropped and a new supplier on the draft", () => {
    const { supplierParts } = diffMethod({
      ...EMPTY,
      baseSupplierParts: [
        supplierPart(),
        supplierPart({ id: "sp-2", supplierId: "sup-2" })
      ],
      targetSupplierParts: [
        supplierPart({ id: "sp-9", itemId: "item-b", unitPrice: 5 }),
        supplierPart({ id: "sp-11", itemId: "item-b", supplierId: "sup-3" })
      ]
    });
    expect(
      supplierParts.map((e) => [e.status, (e.after ?? e.before)?.supplierId])
    ).toEqual([
      ["modified", "sup-1"],
      ["added", "sup-3"],
      ["removed", "sup-2"]
    ]);
    expect(supplierParts[0].changedFields).toEqual({
      unitPrice: { before: 4.5, after: 5 }
    });
  });

  it("reads every supplier part as added when the draft has no source", () => {
    const { supplierParts } = diffMethod({
      ...EMPTY,
      targetSupplierParts: [supplierPart({ id: "sp-9", itemId: "item-b" })]
    });
    expect(supplierParts.map((e) => e.status)).toEqual(["added"]);
  });
});

// The boundary is the Postgres wire: a driver that records what Kysely sends
// and answers the item insert with the id the database would have generated.
// `failOn` makes the first statement containing that text throw, as the
// database would on a constraint violation (`code` is its SQLSTATE).
class RecordingDriver extends DummyDriver {
  readonly sent: CompiledQuery[] = [];
  readonly log: string[] = [];
  constructor(
    private readonly failOn?: string,
    private readonly code?: string
  ) {
    super();
  }
  override async acquireConnection(): Promise<DatabaseConnection> {
    return {
      executeQuery: async <R>(
        query: CompiledQuery
      ): Promise<QueryResult<R>> => {
        if (this.failOn && query.sql.includes(this.failOn)) {
          throw Object.assign(
            new Error(`failed: ${this.failOn}`),
            this.code ? { code: this.code } : {}
          );
        }
        this.sent.push(query);
        this.log.push(query.sql);
        const rows = query.sql.startsWith('insert into "item"')
          ? [{ id: "item-b" }]
          : [];
        return { rows: rows as R[] };
      },
      // biome-ignore lint/correctness/useYield: never streamed
      streamQuery: async function* () {
        throw new Error("not streamed");
      }
    };
  }
  override async beginTransaction() {
    this.log.push("BEGIN");
  }
  override async commitTransaction() {
    this.log.push("COMMIT");
  }
  override async rollbackTransaction() {
    this.log.push("ROLLBACK");
  }
}

function recordingDatabase(failOn?: string, code?: string) {
  const driver = new RecordingDriver(failOn, code);
  const db = new KyselyClient<KyselyDatabase>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler()
    }
  }) as unknown as Kysely<KyselyDatabase>;
  return { db, driver };
}

describe("createRevision", () => {
  const item = {
    id: "item-a",
    readableId: "P-100",
    revision: "A",
    name: "Bracket",
    type: "Part",
    replenishmentSystem: "Make",
    defaultMethodType: "Make to Order",
    itemTrackingType: "Inventory",
    unitOfMeasureCode: "EA",
    description: null,
    sourcingType: "Specified",
    thumbnailPath: null,
    mpn: null,
    modelUploadId: null,
    companyId: "c1"
  } as never;

  beforeEach(() => {
    serverFnInvoke.mockReset().mockResolvedValue({ data: null, error: null });
  });

  // The caller's supabase client: the permission gate.
  function revisionClient(gate: { error: { message: string } | null }) {
    const rpc = vi.fn().mockResolvedValue({ data: null, ...gate });
    return { client: { rpc } as never, rpc };
  }

  it("inserts the revision and what it inherits in one transaction", async () => {
    const { client, rpc } = revisionClient({ error: null });
    const { db, driver } = recordingDatabase();

    const result = await createRevision(client, db, {
      item,
      revision: "B",
      createdBy: "u1"
    });

    expect(result).toEqual({ data: { id: "item-b" }, error: null });
    expect(rpc).toHaveBeenCalledWith("assert_company_access", {
      p_company_id: "c1",
      p_permission: "parts_create"
    });

    // The item first (its interceptor creates the rows the updates land on),
    // and the price breaks after the supplier parts they hang off.
    expect(
      driver.log.map((sql) => sql.match(/^\w+( into)? "\w+"|^\w+$/)?.[0])
    ).toEqual([
      "BEGIN",
      'insert into "item"',
      'update "itemReplenishment"',
      'update "itemPlanning"',
      'update "itemCost"',
      'insert into "supplierPart"',
      'insert into "supplierPartPrice"',
      "COMMIT"
    ]);

    const [insert, ...copies] = driver.sent;
    expect(insert.parameters).toEqual(
      expect.arrayContaining(["P-100", "B", "Bracket", "c1", "u1", true])
    );
    // Kysely bypasses RLS: both sides of every statement name the company,
    // and the rows move from the source revision to the new one only.
    for (const query of copies) {
      expect(query.parameters).toContain("c1");
      expect(query.parameters).toContain("item-a");
      expect(query.parameters).toContain("item-b");
    }
    const [replenishment, planning, , supplierParts, prices] = copies.map(
      (query) => query.sql
    );
    expect(replenishment).toContain(
      'where "target"."itemId" = $3 and "target"."companyId" = $4 and "source"."itemId" = $5 and "source"."companyId" = $6'
    );
    expect(planning).toContain('"target"."locationId" = "source"."locationId"');
    expect(supplierParts).toContain('where "itemId" = $3 and "companyId" = $4');
    expect(prices).toContain(
      '"target"."supplierId" = "source"."supplierId" and "target"."companyId" = "source"."companyId"'
    );

    // The method is copied once the revision is committed.
    expect(serverFnInvoke).toHaveBeenCalledWith("get-method", {
      type: "itemToItem",
      sourceId: "item-a",
      targetId: "item-b"
    });
  });

  it("leaves no revision behind when the copy fails", async () => {
    const { client } = revisionClient({ error: null });
    const { db, driver } = recordingDatabase('insert into "supplierPart"');

    const result = await createRevision(client, db, {
      item,
      revision: "B",
      createdBy: "u1"
    });

    expect(result).toEqual({
      data: null,
      error: { message: 'failed: insert into "supplierPart"' }
    });
    // The item insert rolls back with the copy; there is nothing to clean up.
    expect(driver.log.at(-1)).toBe("ROLLBACK");
    expect(driver.log).not.toContain("COMMIT");
    expect(driver.log.some((sql) => sql.startsWith("delete"))).toBe(false);
    expect(serverFnInvoke).not.toHaveBeenCalled();
  });

  it("writes nothing for a caller who cannot create parts in the company", async () => {
    const denied = { message: "Not authorized for this company" };
    const { client } = revisionClient({ error: denied });
    const { db, driver } = recordingDatabase();

    const result = await createRevision(client, db, {
      item,
      revision: "B",
      createdBy: "u1"
    });

    expect(result).toEqual({ data: null, error: denied });
    expect(driver.log).toEqual([]);
    expect(serverFnInvoke).not.toHaveBeenCalled();
  });
});

describe("deleteItem", () => {
  function gateClient(gate: { error: { message: string } | null }) {
    const rpc = vi.fn().mockResolvedValue({ data: null, ...gate });
    return { client: { rpc } as never, rpc };
  }

  it("deletes the item's price breaks and the item in one transaction", async () => {
    const { client, rpc } = gateClient({ error: null });
    const { db, driver } = recordingDatabase();

    const result = await deleteItem(client, db, "item-b", "c1");

    expect(result).toEqual({ data: null, error: null });
    expect(rpc).toHaveBeenCalledWith("assert_company_access", {
      p_company_id: "c1",
      p_permission: "parts_delete"
    });
    // A price break restricts the delete of its supplier part, which the item
    // delete cascades to, so the price breaks go first.
    expect(driver.log).toEqual([
      "BEGIN",
      'delete from "supplierPartPrice" where "companyId" = $1 and "supplierPartId" in (select "id" from "supplierPart" where "itemId" in ($2) and "companyId" = $3)',
      'delete from "item" where "id" in ($1) and "companyId" = $2',
      "COMMIT"
    ]);
    expect(driver.sent.map((query) => query.parameters)).toEqual([
      ["c1", "item-b", "c1"],
      ["item-b", "c1"]
    ]);
  });

  it("keeps the price breaks when the item itself cannot be deleted", async () => {
    const { client } = gateClient({ error: null });
    const { db, driver } = recordingDatabase('delete from "item"', "23503");

    const result = await deleteItem(client, db, "item-b", "c1");

    // The route maps a 23503 to its friendly message, so the code survives.
    expect(result).toEqual({
      data: null,
      error: { code: "23503", message: 'failed: delete from "item"' }
    });
    expect(driver.log.at(-1)).toBe("ROLLBACK");
    expect(driver.log).not.toContain("COMMIT");
  });

  it("writes nothing for a caller who cannot delete parts in the company", async () => {
    const denied = { message: "Not authorized for this company" };
    const { client } = gateClient({ error: denied });
    const { db, driver } = recordingDatabase();

    const result = await deleteItem(client, db, "item-b", "c1");

    expect(result).toEqual({ data: null, error: denied });
    expect(driver.log).toEqual([]);
  });
});

describe("removeChangeNoticeAffectedItem", () => {
  // The caller's supabase client: reads the affected row, vouches for the
  // delete, and removes the affected row at the end.
  function affectedItemClient(row: Record<string, unknown>) {
    const deleted: string[] = [];
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      from: (table: string) => {
        const builder = {
          select: () => builder,
          eq: () => builder,
          maybeSingle: () => Promise.resolve({ data: row, error: null }),
          delete: () => {
            deleted.push(table);
            return builder;
          },
          then: (onF: (v: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(onF)
        };
        return builder;
      }
    };
    return { client: client as never, deleted };
  }

  it("discards a Revision draft, price breaks first, then removes the row", async () => {
    const { client, deleted } = affectedItemClient({
      draftMakeMethodId: "mm-1",
      newItemId: "item-b"
    });
    const { db, driver } = recordingDatabase();

    const result = await removeChangeNoticeAffectedItem(
      client,
      db,
      "aff-1",
      "c1"
    );

    expect(result.error).toBeNull();
    // The draft method goes with its item, so only the item is deleted.
    expect(
      driver.log.map((sql) => sql.match(/^delete from "\w+"|^\w+$/)?.[0])
    ).toEqual([
      "BEGIN",
      'delete from "supplierPartPrice"',
      'delete from "item"',
      "COMMIT"
    ]);
    expect(deleted).toEqual(["changeOrderAffectedItem"]);
  });

  it("deletes only the Draft method for a Version", async () => {
    const { client, deleted } = affectedItemClient({
      draftMakeMethodId: "mm-1",
      newItemId: null
    });
    const { db, driver } = recordingDatabase();

    await removeChangeNoticeAffectedItem(client, db, "aff-1", "c1");

    expect(driver.log).toEqual([
      "BEGIN",
      'delete from "makeMethod" where "id" in ($1) and "companyId" = $2',
      "COMMIT"
    ]);
    expect(deleted).toEqual(["changeOrderAffectedItem"]);
  });

  it("keeps the affected row when its draft cannot be discarded", async () => {
    const { client, deleted } = affectedItemClient({
      draftMakeMethodId: "mm-1",
      newItemId: "item-b"
    });
    const { db, driver } = recordingDatabase('delete from "item"', "23503");

    const result = await removeChangeNoticeAffectedItem(
      client,
      db,
      "aff-1",
      "c1"
    );

    expect(result.error).toEqual({
      code: "23503",
      message: 'failed: delete from "item"'
    });
    expect(driver.log.at(-1)).toBe("ROLLBACK");
    // The row is the only pointer at the draft; it stays with it.
    expect(deleted).toEqual([]);
  });
});

describe("diffMethod — attributes", () => {
  it("reports one entry per changed attribute column", () => {
    const { attributes } = diffMethod({
      ...EMPTY,
      baseAttributes: { name: "Widget", description: "old" },
      targetAttributes: { name: "Widget", description: "new" }
    });
    expect(attributes).toHaveLength(1);
    expect(attributes[0].status).toBe("modified");
    expect(attributes[0].changedFields).toEqual({
      description: { before: "old", after: "new" }
    });
  });

  it("returns a single unchanged entry when no attribute differs", () => {
    const { attributes } = diffMethod({
      ...EMPTY,
      baseAttributes: { name: "Widget", description: "same" },
      targetAttributes: { name: "Widget", description: "same" }
    });
    expect(attributes).toHaveLength(1);
    expect(attributes[0].status).toBe("unchanged");
  });

  it("ignores audit/linkage columns in the attribute diff", () => {
    const { attributes } = diffMethod({
      ...EMPTY,
      baseAttributes: { name: "Widget", id: "a", updatedAt: "t1" },
      targetAttributes: { name: "Widget", id: "b", updatedAt: "t2" }
    });
    expect(attributes).toHaveLength(1);
    expect(attributes[0].status).toBe("unchanged");
  });

  it("surfaces the whole attribute set as added for a net-new item (New Part)", () => {
    const target = { name: "Widget", description: "brand new" };
    const { attributes } = diffMethod({
      ...EMPTY,
      baseAttributes: null,
      targetAttributes: target
    });
    expect(attributes).toHaveLength(1);
    expect(attributes[0].status).toBe("added");
    expect(attributes[0].before).toBeNull();
    expect(attributes[0].after).toEqual(target);
  });
});

describe("getItemDemand", () => {
  function mockClient(
    rowsByTable: Record<string, unknown[]>,
    errorsByTable: Record<string, unknown> = {}
  ) {
    const reads: Array<{
      table: string;
      filters: Array<[string, string, unknown]>;
    }> = [];
    const client: any = {
      from: (table: string) => {
        const read = { table, filters: [] as Array<[string, string, unknown]> };
        reads.push(read);
        const builder: any = {
          select: () => builder,
          eq: (column: string, value: unknown) => {
            read.filters.push(["eq", column, value]);
            return builder;
          },
          in: (column: string, value: unknown) => {
            read.filters.push(["in", column, value]);
            return builder;
          },
          order: () => builder,
          then: (resolve: (v: unknown) => void) =>
            resolve(
              errorsByTable[table]
                ? { data: null, error: errorsByTable[table] }
                : { data: rowsByTable[table] ?? [], error: null }
            )
        };
        return builder;
      }
    };
    return { client, reads };
  }

  const args = {
    itemId: "item_1",
    locationId: "loc_1",
    companyId: "co_1",
    periods: ["p1", "p2"]
  };

  it("reads demandProjection alongside demandActual and demandForecast", async () => {
    const { getItemDemand } = await import("./items.service");
    const { client, reads } = mockClient({});

    await getItemDemand(client, args);

    expect(reads.map((r) => r.table).sort()).toEqual([
      "demandActual",
      "demandForecast",
      "demandProjection"
    ]);
  });

  it("scopes the projection read to the item, location, company and periods", async () => {
    const { getItemDemand } = await import("./items.service");
    const { client, reads } = mockClient({});

    await getItemDemand(client, args);

    const projectionRead = reads.find((r) => r.table === "demandProjection");
    expect(projectionRead?.filters).toEqual([
      ["eq", "itemId", "item_1"],
      ["eq", "locationId", "loc_1"],
      ["eq", "companyId", "co_1"],
      ["in", "periodId", ["p1", "p2"]]
    ]);
  });

  it("returns the projection rows as `projections`, defaulting every series to []", async () => {
    const { getItemDemand } = await import("./items.service");
    const projectionRow = {
      id: "dp_1",
      itemId: "item_1",
      locationId: "loc_1",
      periodId: "p1",
      forecastQuantity: 40
    };
    const { client } = mockClient({ demandProjection: [projectionRow] });

    const demand = await getItemDemand(client, args);

    expect(demand).toEqual({
      actuals: [],
      forecasts: [],
      projections: [projectionRow],
      error: null
    });
  });

  it("tells an item with no demand apart from a failed read", async () => {
    const { getItemDemand } = await import("./items.service");

    const empty = await getItemDemand(mockClient({}).client, args);
    expect(empty.error).toBeNull();

    const failure = { message: "permission denied for table demandForecast" };
    const failed = await getItemDemand(
      mockClient({}, { demandForecast: failure }).client,
      args
    );
    expect(failed.error).toBe(failure);
  });
});
