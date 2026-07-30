import { describe, expect, it, vi } from "vitest";

// diffMethod now lives in items.service. Importing the real module drags in the
// items.service graph, which transitively loads @carbon/glossary — whose
// module-load-time Lingui `msg` macro isn't transformed under plain vitest and
// throws. The pure diffMethod under test needs none of it, so stub glossary; the
// diffMethod under test stays the genuine implementation.
vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn()
}));

const { diffMethod, duplicateMethodOperationStep } = await import(
  "./items.service"
);

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
        { methodMaterialId: "mat-1", methodOperationStepId: "step-1" }
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
      [{ methodMaterialId: "mat-1", methodOperationStepId: "step-new" }]
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
