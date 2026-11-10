// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  diffMethod,
  duplicateMethodOperationStep,
  getItemDemand,
  getLockVerdict,
  getUnreleasedChangeOrderIssue,
  getUnreleasedChangeOrderItems,
  LOCKED_REVISION_MESSAGE
} from "./items.service";

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
    currencyCode: "USD",
    supplierUnitPrice: 4.5,
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
        supplierPart({ id: "sp-9", itemId: "item-b", supplierUnitPrice: 5 }),
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
      supplierUnitPrice: { before: 4.5, after: 5 }
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
  // Answers every table with its rows, or with the error given for it.
  function mockClient(
    rowsByTable: Record<string, unknown[]>,
    errorsByTable: Record<string, unknown> = {}
  ) {
    return {
      client: {
        from: (table: string) => {
          const builder: any = {
            select: () => builder,
            eq: () => builder,
            in: () => builder,
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
      } as any
    };
  }

  const args = {
    itemId: "item_1",
    locationId: "loc_1",
    companyId: "co_1",
    periods: ["p1", "p2"]
  };

  it("returns the projection rows as `projections`, defaulting every series to []", async () => {
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

describe("getLockVerdict", () => {
  it.each(["off", "warn", "enforce"] as const)(
    "allows edits on an unlocked revision under release control %s",
    (releaseControl) => {
      expect(getLockVerdict({ isLocked: false, releaseControl })).toEqual({
        ok: true,
        warn: false
      });
    }
  );

  it.each([
    ["off", { ok: true, warn: false }],
    ["warn", { ok: true, warn: true, message: LOCKED_REVISION_MESSAGE }],
    ["enforce", { ok: false, warn: false, message: LOCKED_REVISION_MESSAGE }]
  ] as const)(
    "gives a locked revision under release control %s the matching verdict",
    (releaseControl, verdict) => {
      expect(getLockVerdict({ isLocked: true, releaseControl })).toEqual(
        verdict
      );
    }
  );
});

type Row = Record<string, unknown> | null;

// PostgREST's `max_rows`, mirrored so a read that asks for too much silently
// comes back short — exactly the failure the batching exists to avoid.
const MAX_ROWS = 1000;

// Stands in for the two list reads the batch guard makes. Supabase builders are
// thenables, so the chain resolves on await without a terminal method. Each
// read is answered from the ids its own `in` filter carries, sliced to the
// `range` page fetchAllByIds asks for and truncated at MAX_ROWS, so a guard
// that stopped batching or paging visibly drops rows.
function fakeListClient(
  rows: { item?: Row[]; changeOrder?: Row[] },
  errors: { item?: boolean; changeOrder?: boolean } = {}
) {
  return {
    from(table: string) {
      const failed = errors[table as keyof typeof errors] === true;
      const all = rows[table as keyof typeof rows] ?? [];
      let requested: string[] | null = null;
      let page: [number, number] | null = null;
      const builder = {
        select: () => builder,
        in: (_column: string, ids: string[]) => {
          requested = ids;
          return builder;
        },
        eq: () => builder,
        order: () => builder,
        range: (from: number, to: number) => {
          page = [from, to];
          return builder;
        },
        then: (
          resolve: (value: {
            data: Row[] | null;
            error: { message: string } | null;
          }) => unknown
        ) =>
          resolve({
            data: failed
              ? null
              : all
                  .filter(
                    (row) => !requested || requested.includes(row?.id as string)
                  )
                  .slice(page?.[0] ?? 0, page ? page[1] + 1 : undefined)
                  .slice(0, MAX_ROWS),
            error: failed ? { message: `failed to read ${table}` } : null
          })
      };
      return builder;
    }
  } as never;
}

const companyId = "company_1";
const args = { itemId: "item_1", companyId };

describe("getUnreleasedChangeOrderItems", () => {
  it("reads nothing when given no ids", async () => {
    const client = fakeListClient({ item: [{ id: "item_1" }] });

    expect(
      await getUnreleasedChangeOrderItems(client, { itemIds: [], companyId })
    ).toEqual({ data: [], error: null });
  });

  it("passes items that no change order owns", async () => {
    const client = fakeListClient({
      item: [
        {
          id: "item_1",
          readableIdWithRevision: "P000001",
          changeOrderId: null
        }
      ]
    });

    expect(
      await getUnreleasedChangeOrderItems(client, {
        itemIds: ["item_1"],
        companyId
      })
    ).toEqual({ data: [], error: null });
  });

  // Release leaves changeOrderId in place as a provenance link, so the column
  // alone cannot answer "is this still a draft" — the status decides.
  it("returns only the items whose change order is unreleased", async () => {
    const client = fakeListClient({
      item: [
        {
          id: "item_1",
          readableIdWithRevision: "P000001.A",
          changeOrderId: "co_open"
        },
        {
          id: "item_2",
          readableIdWithRevision: "P000002.B",
          changeOrderId: "co_done"
        }
      ],
      changeOrder: [
        {
          id: "co_open",
          changeOrderId: "ECO-000001",
          status: "Implementation"
        },
        { id: "co_done", changeOrderId: "ECO-000002", status: "Done" }
      ]
    });

    expect(
      await getUnreleasedChangeOrderItems(client, {
        itemIds: ["item_1", "item_2"],
        companyId
      })
    ).toEqual({
      data: [
        {
          itemId: "item_1",
          itemName: "P000001.A",
          changeOrderReadableId: "ECO-000001"
        }
      ],
      error: null
    });
  });

  // PostgREST caps a response at 1000 rows, so the guard walks the ids in
  // batches. Without that, an item past the cap reads as unowned and activates.
  it("finds an offending item past the response cap", async () => {
    const itemIds = Array.from({ length: 1200 }, (_, i) => `item_${i}`);
    const client = fakeListClient({
      item: itemIds.map((id) => ({
        id,
        readableIdWithRevision: id,
        changeOrderId: id === "item_1100" ? "co_open" : null
      })),
      changeOrder: [
        { id: "co_open", changeOrderId: "ECO-000001", status: "Draft" }
      ]
    });

    expect(
      await getUnreleasedChangeOrderItems(client, { itemIds, companyId })
    ).toEqual({
      data: [
        {
          itemId: "item_1100",
          itemName: "item_1100",
          changeOrderReadableId: "ECO-000001"
        }
      ],
      error: null
    });
  });

  // A read that did not answer says nothing about the items, so callers block
  // rather than wave the write through on a database blip.
  it("reports an error when the item read fails", async () => {
    const client = fakeListClient({}, { item: true });

    expect(
      await getUnreleasedChangeOrderItems(client, {
        itemIds: ["item_1"],
        companyId
      })
    ).toEqual({
      data: [],
      error: "These items could not be checked against their change orders."
    });
  });

  it("reports an error when the change order read fails", async () => {
    const client = fakeListClient(
      {
        item: [
          {
            id: "item_1",
            readableIdWithRevision: "P000001.A",
            changeOrderId: "co_open"
          }
        ]
      },
      { changeOrder: true }
    );

    expect(
      await getUnreleasedChangeOrderItems(client, {
        itemIds: ["item_1"],
        companyId
      })
    ).toEqual({
      data: [],
      error: "These items could not be checked against their change orders."
    });
  });
});

describe("getUnreleasedChangeOrderIssue", () => {
  it("names the change order still holding the item", async () => {
    const client = fakeListClient({
      item: [
        {
          id: "item_1",
          readableIdWithRevision: "P000001.A",
          changeOrderId: "co_open"
        }
      ],
      changeOrder: [
        { id: "co_open", changeOrderId: "ECO-000001", status: "Draft" }
      ]
    });

    expect(await getUnreleasedChangeOrderIssue(client, args)).toBe(
      "P000001.A was created by change order ECO-000001, which has not been released yet."
    );
  });

  // Narrow on purpose — the guard does not judge `active`. Inactive items are
  // allowed onto these documents today, and that is a separate decision.
  it("passes an inactive item that no change order owns", async () => {
    const client = fakeListClient({
      item: [
        { id: "item_1", readableIdWithRevision: "P000001", changeOrderId: null }
      ]
    });

    expect(await getUnreleasedChangeOrderIssue(client, args)).toBeNull();
  });

  it("blocks when the check could not be made", async () => {
    const client = fakeListClient({}, { item: true });

    expect(await getUnreleasedChangeOrderIssue(client, args)).toBe(
      "These items could not be checked against their change orders."
    );
  });
});
