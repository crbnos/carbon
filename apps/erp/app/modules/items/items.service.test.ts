import { datetime } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
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

const {
  assertChangeNoticeAssigneeIsCompanyMember,
  deleteChangeNotice,
  deleteChangeNoticeAction,
  diffMethod,
  duplicateMethodOperationStep,
  seedDefaultChangeNoticeActions,
  setChangeNoticeActionTasks,
  updateChangeNoticeActionAssignee,
  updateChangeNoticeActionDueDate,
  updateChangeNoticeActionNotes,
  updateChangeNoticeActionStatus
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

type FakeActionTask = {
  id: string;
  changeOrderId: string;
  companyId: string;
  actionTypeId: string | null;
  taskOrigin: string;
  sortOrder: number;
};

type FakeRequiredAction = {
  id: string;
  name: string;
  companyId: string;
  active: boolean;
};

function makeFakeActionTaskDb({
  tasks: initialTasks,
  templates
}: {
  tasks: FakeActionTask[];
  templates: FakeRequiredAction[];
}) {
  let tasks = [...initialTasks];
  const deletedIds: string[] = [];
  const insertedRows: Record<string, unknown>[] = [];
  const queries: { table: string; filters: string[] }[] = [];

  function whereBuilder(table: string, source: unknown[]) {
    const filters: { column: string; operator: string; value: unknown }[] = [];
    const builder = {
      select: () => builder,
      where: (column: string, operator: string, value: unknown) => {
        filters.push({ column, operator, value });
        return builder;
      },
      orderBy: () => builder,
      execute: async () => {
        queries.push({
          table,
          filters: filters.map(
            ({ column, operator }) => `${column} ${operator}`
          )
        });
        return source.filter((row) =>
          filters.every(({ column, operator, value }) => {
            const current = (row as Record<string, unknown>)[column];
            return operator === "in"
              ? (value as unknown[]).includes(current)
              : current === value;
          })
        );
      }
    };
    return builder;
  }

  const db = {
    transaction: () => ({
      execute: async (callback: (trx: unknown) => Promise<unknown>) =>
        callback(db)
    }),
    selectFrom: (table: string) => {
      const source = table === "changeOrderActionTask" ? tasks : templates;
      return whereBuilder(table, source);
    },
    deleteFrom: (table: string) => {
      const filters: { column: string; operator: string; value: unknown }[] =
        [];
      const builder = {
        where: (column: string, operator: string, value: unknown) => {
          filters.push({ column, operator, value });
          return builder;
        },
        execute: async () => {
          queries.push({
            table,
            filters: filters.map(
              ({ column, operator }) => `${column} ${operator}`
            )
          });
          const matches = (row: FakeActionTask) =>
            filters.every(({ column, operator, value }) => {
              const current = row[column as keyof FakeActionTask];
              return operator === "in"
                ? (value as unknown[]).includes(current)
                : current === value;
            });
          for (const task of tasks.filter(matches)) deletedIds.push(task.id);
          tasks = tasks.filter((task) => !matches(task));
        }
      };
      return builder;
    },
    insertInto: (_table: string) => ({
      values: (rows: Record<string, unknown>[]) => ({
        execute: async () => {
          insertedRows.push(...rows);
        }
      })
    })
  };

  return { db: db as never, deletedIds, insertedRows, queries };
}

type FakeDeleteRow = Record<string, unknown>;
type DeleteTable = "makeMethod" | "item" | "changeOrder";
type DeleteFailure =
  | "affected-read"
  | "method-read"
  | "item-read"
  | "makeMethod-delete"
  | "item-delete"
  | "changeOrder-delete";

type DeleteQuery = {
  table: string;
  operation: "select" | "delete";
  predicates: { column: string; operator: string; value: unknown }[];
  forUpdate: boolean;
};

type DeleteFakeOptions = {
  failure?: DeleteFailure;
  deleteCount?: Partial<Record<DeleteTable, number>>;
  rows?: Readonly<Record<string, readonly FakeDeleteRow[]>>;
};

// This fake records service-owned queries and decisions only. It deliberately
// does not model PostgreSQL FK cascades, SET NULL actions, locks, or rollback.
function makeFakeChangeNoticeDeleteDb(options: DeleteFakeOptions = {}) {
  const defaults: Record<string, FakeDeleteRow[]> = {
    changeOrder: [{ id: "notice-1", companyId: "company-1", status: "Draft" }],
    changeOrderAffectedItem: [
      {
        id: "affected-item",
        changeOrderId: "notice-1",
        companyId: "company-1",
        draftMakeMethodId: "draft-method",
        newItemId: "draft-item"
      }
    ],
    makeMethod: [
      {
        id: "draft-method",
        itemId: "draft-item",
        companyId: "company-1",
        changeOrderId: "notice-1",
        status: "Draft"
      }
    ],
    item: [
      {
        id: "draft-item",
        companyId: "company-1",
        changeOrderId: "notice-1",
        active: false
      }
    ]
  };
  const rows = Object.fromEntries(
    Object.entries({ ...defaults, ...options.rows }).map(([table, values]) => [
      table,
      [...values]
    ])
  ) as Record<string, FakeDeleteRow[]>;
  const queries: DeleteQuery[] = [];
  const deleted: DeleteQuery[] = [];
  let committed = false;
  let callbackRejected = false;

  const matches = (row: FakeDeleteRow, predicates: DeleteQuery["predicates"]) =>
    predicates.every(({ column, operator, value }) =>
      operator === "in"
        ? Array.isArray(value) && value.includes(row[column])
        : operator === "="
          ? row[column] === value
          : (() => {
              throw new Error(`Unexpected fake predicate: ${operator}`);
            })()
    );

  type Builder = {
    select: (...args: unknown[]) => Builder;
    where: (column: string, operator: string, value: unknown) => Builder;
    forUpdate: () => Builder;
    execute: () => Promise<unknown>;
    executeTakeFirst: () => Promise<unknown>;
  };

  const makeBuilder = (
    table: string,
    operation: DeleteQuery["operation"]
  ): Builder => {
    const predicates: DeleteQuery["predicates"] = [];
    let forUpdate = false;
    const builder = {} as Builder;
    builder.select = () => builder;
    builder.where = (column, operator, value) => {
      predicates.push({ column, operator, value });
      return builder;
    };
    builder.forUpdate = () => {
      forUpdate = true;
      return builder;
    };
    builder.execute = async () => {
      const query = {
        table,
        operation,
        predicates: [...predicates],
        forUpdate
      };
      queries.push(query);
      if (operation === "delete") deleted.push(query);
      if (
        operation === "select" &&
        ((table === "changeOrderAffectedItem" &&
          options.failure === "affected-read") ||
          (table === "makeMethod" && options.failure === "method-read") ||
          (table === "item" && options.failure === "item-read"))
      ) {
        throw new Error(`${table} read failed`);
      }
      if (operation === "delete" && options.failure === `${table}-delete`) {
        throw new Error(`${table} delete failed`);
      }
      const tableRows = rows[table] ?? [];
      if (operation === "select") {
        return tableRows.filter((row) => matches(row, query.predicates));
      }
      const count = tableRows.filter((row) =>
        matches(row, query.predicates)
      ).length;
      return {
        numDeletedRows: BigInt(
          options.deleteCount?.[table as DeleteTable] ?? count
        )
      };
    };
    builder.executeTakeFirst = async () => {
      const result = await builder.execute();
      return Array.isArray(result) ? result[0] : result;
    };
    return builder;
  };

  const trx = {
    selectFrom: (table: string) => makeBuilder(table, "select"),
    deleteFrom: (table: string) => makeBuilder(table, "delete")
  };
  const db = {
    transaction: () => ({
      execute: async (
        callback: (transaction: typeof trx) => Promise<unknown>
      ) => {
        try {
          const result = await callback(trx);
          committed = true;
          return result;
        } catch (cause) {
          callbackRejected = true;
          throw cause;
        }
      }
    })
  };

  return {
    db: db as never,
    queries,
    deleted,
    get committed() {
      return committed;
    },
    get callbackRejected() {
      return callbackRejected;
    }
  };
}

describe("Change Notice parent deletion", () => {
  it("deletes referenced drafts before the parent and leaves FK cascades to PostgreSQL", async () => {
    const fake = makeFakeChangeNoticeDeleteDb();

    const result = await deleteChangeNotice(fake.db, "notice-1", "company-1");

    expect(result).toEqual({ data: null, error: null });
    expect(fake.committed).toBe(true);
    expect(fake.callbackRejected).toBe(false);
    expect(fake.deleted.map(({ table }) => table)).toEqual([
      "item",
      "changeOrder"
    ]);
    expect(fake.queries.map(({ table }) => table)).not.toContain(
      "changeOrderActionTask"
    );
    expect(fake.queries.map(({ table }) => table)).not.toContain(
      "changeOrderSupersession"
    );
    expect(fake.queries.map(({ table }) => table)).not.toContain(
      "changeOrderImpactDecision"
    );

    for (const query of fake.queries.filter(
      ({ operation }) => operation === "select"
    )) {
      expect(query.predicates).toContainEqual({
        column: "companyId",
        operator: "=",
        value: "company-1"
      });
    }
    expect(
      fake.queries.find(
        ({ table, operation }) =>
          table === "changeOrderAffectedItem" && operation === "select"
      )?.forUpdate
    ).toBe(true);
  });

  it("preserves an item with multiple released Make Method versions", async () => {
    const fake = makeFakeChangeNoticeDeleteDb({
      rows: {
        changeOrder: [
          { id: "notice-1", companyId: "company-1", status: "Done" }
        ],
        changeOrderAffectedItem: [
          {
            id: "affected-released",
            changeOrderId: "notice-1",
            companyId: "company-1",
            draftMakeMethodId: "active-method",
            newItemId: "released-item"
          }
        ],
        makeMethod: [
          {
            id: "active-method",
            itemId: "released-item",
            companyId: "company-1",
            changeOrderId: null,
            status: "Active"
          },
          {
            id: "archived-method",
            itemId: "released-item",
            companyId: "company-1",
            changeOrderId: null,
            status: "Archived"
          }
        ],
        item: [
          {
            id: "released-item",
            companyId: "company-1",
            changeOrderId: "notice-1",
            active: true
          }
        ]
      }
    });

    const result = await deleteChangeNotice(fake.db, "notice-1", "company-1");

    expect(result).toEqual({ data: null, error: null });
    expect(fake.committed).toBe(true);
    expect(fake.deleted.map(({ table }) => table)).toEqual(["changeOrder"]);
  });

  it("rejects a referenced released method with a Draft sibling", async () => {
    const fake = makeFakeChangeNoticeDeleteDb({
      rows: {
        changeOrderAffectedItem: [
          {
            id: "affected-released",
            changeOrderId: "notice-1",
            companyId: "company-1",
            draftMakeMethodId: "released-method",
            newItemId: "released-item"
          }
        ],
        makeMethod: [
          {
            id: "released-method",
            itemId: "released-item",
            companyId: "company-1",
            changeOrderId: null,
            status: "Active"
          },
          {
            id: "draft-sibling",
            itemId: "released-item",
            companyId: "company-1",
            changeOrderId: "notice-1",
            status: "Draft"
          }
        ],
        item: [
          {
            id: "released-item",
            companyId: "company-1",
            changeOrderId: "notice-1",
            active: true
          }
        ]
      }
    });

    const result = await deleteChangeNotice(fake.db, "notice-1", "company-1");

    expect(result.error?.message).toBe(
      "Change Notice draft references are inconsistent."
    );
    expect(fake.committed).toBe(false);
    expect(fake.callbackRejected).toBe(true);
    expect(fake.deleted).toHaveLength(0);
  });

  it("rejects a referenced Draft with a current-notice non-Draft sibling", async () => {
    const fake = makeFakeChangeNoticeDeleteDb({
      rows: {
        changeOrderAffectedItem: [
          {
            id: "affected-draft",
            changeOrderId: "notice-1",
            companyId: "company-1",
            draftMakeMethodId: "draft-method",
            newItemId: "draft-item"
          }
        ],
        makeMethod: [
          {
            id: "draft-method",
            itemId: "draft-item",
            companyId: "company-1",
            changeOrderId: "notice-1",
            status: "Draft"
          },
          {
            id: "current-notice-active",
            itemId: "draft-item",
            companyId: "company-1",
            changeOrderId: "notice-1",
            status: "Active"
          }
        ],
        item: [
          {
            id: "draft-item",
            companyId: "company-1",
            changeOrderId: "notice-1",
            active: false
          }
        ]
      }
    });

    const result = await deleteChangeNotice(fake.db, "notice-1", "company-1");

    expect(result.error?.message).toBe(
      "Change Notice draft references are inconsistent."
    );
    expect(fake.committed).toBe(false);
    expect(fake.callbackRejected).toBe(true);
    expect(fake.deleted).toHaveLength(0);
  });

  it("deletes an item-backed Draft when its method backlink is null", async () => {
    const fake = makeFakeChangeNoticeDeleteDb({
      rows: {
        makeMethod: [
          {
            id: "draft-method",
            itemId: "draft-item",
            companyId: "company-1",
            changeOrderId: null,
            status: "Draft"
          }
        ]
      }
    });

    const result = await deleteChangeNotice(fake.db, "notice-1", "company-1");

    expect(result).toEqual({ data: null, error: null });
    expect(fake.deleted.map(({ table }) => table)).toEqual([
      "item",
      "changeOrder"
    ]);
    expect(fake.deleted.map(({ table }) => table)).not.toContain("makeMethod");
  });

  it("rejects an item with a released sibling method before deleting the item", async () => {
    const fake = makeFakeChangeNoticeDeleteDb({
      rows: {
        makeMethod: [
          {
            id: "draft-method",
            itemId: "draft-item",
            companyId: "company-1",
            changeOrderId: "notice-1",
            status: "Draft"
          },
          {
            id: "released-sibling",
            itemId: "draft-item",
            companyId: "company-1",
            changeOrderId: null,
            status: "Active"
          }
        ]
      }
    });

    const result = await deleteChangeNotice(fake.db, "notice-1", "company-1");

    expect(result.error?.message).toBe(
      "Change Notice draft references are inconsistent."
    );
    expect(fake.committed).toBe(false);
    expect(fake.callbackRejected).toBe(true);
    expect(fake.deleted).toHaveLength(0);

    const itemMethodQuery = fake.queries.find(
      ({ table, operation, predicates }) =>
        table === "makeMethod" &&
        operation === "select" &&
        predicates.some(
          ({ column, operator, value }) =>
            column === "itemId" &&
            operator === "in" &&
            Array.isArray(value) &&
            value.includes("draft-item")
        )
    );
    expect(itemMethodQuery?.forUpdate).toBe(true);
    expect(itemMethodQuery?.predicates).toContainEqual({
      column: "companyId",
      operator: "=",
      value: "company-1"
    });
  });

  it("rejects an item with a sibling method owned by another Change Notice", async () => {
    const fake = makeFakeChangeNoticeDeleteDb({
      rows: {
        makeMethod: [
          {
            id: "draft-method",
            itemId: "draft-item",
            companyId: "company-1",
            changeOrderId: "notice-1",
            status: "Draft"
          },
          {
            id: "other-notice-sibling",
            itemId: "draft-item",
            companyId: "company-1",
            changeOrderId: "other-notice",
            status: "Draft"
          }
        ]
      }
    });

    const result = await deleteChangeNotice(fake.db, "notice-1", "company-1");

    expect(result.error?.message).toBe(
      "Change Notice draft references are inconsistent."
    );
    expect(fake.committed).toBe(false);
    expect(fake.callbackRejected).toBe(true);
    expect(fake.deleted).toHaveLength(0);
  });

  it("deletes an item when all of its methods are safely disposable Drafts", async () => {
    const fake = makeFakeChangeNoticeDeleteDb({
      rows: {
        makeMethod: [
          {
            id: "draft-method",
            itemId: "draft-item",
            companyId: "company-1",
            changeOrderId: "notice-1",
            status: "Draft"
          },
          {
            id: "trigger-draft",
            itemId: "draft-item",
            companyId: "company-1",
            changeOrderId: null,
            status: "Draft"
          }
        ]
      }
    });

    const result = await deleteChangeNotice(fake.db, "notice-1", "company-1");

    expect(result).toEqual({ data: null, error: null });
    expect(fake.deleted.map(({ table }) => table)).toEqual([
      "item",
      "changeOrder"
    ]);
    expect(fake.committed).toBe(true);
  });

  it("preserves a released item after it is deactivated", async () => {
    const fake = makeFakeChangeNoticeDeleteDb({
      rows: {
        changeOrder: [
          { id: "notice-1", companyId: "company-1", status: "Done" }
        ],
        changeOrderAffectedItem: [
          {
            id: "affected-released",
            changeOrderId: "notice-1",
            companyId: "company-1",
            draftMakeMethodId: "released-method",
            newItemId: "released-item"
          }
        ],
        makeMethod: [
          {
            id: "released-method",
            itemId: "released-item",
            companyId: "company-1",
            changeOrderId: null,
            status: "Active"
          }
        ],
        item: [
          {
            id: "released-item",
            companyId: "company-1",
            changeOrderId: "notice-1",
            active: false
          }
        ]
      }
    });

    const result = await deleteChangeNotice(fake.db, "notice-1", "company-1");

    expect(result).toEqual({ data: null, error: null });
    expect(fake.deleted.map(({ table }) => table)).toEqual(["changeOrder"]);
  });

  it("deletes a standalone Version Draft method", async () => {
    const fake = makeFakeChangeNoticeDeleteDb({
      rows: {
        changeOrderAffectedItem: [
          {
            id: "affected-version",
            changeOrderId: "notice-1",
            companyId: "company-1",
            draftMakeMethodId: "version-method",
            newItemId: null
          }
        ],
        makeMethod: [
          {
            id: "version-method",
            itemId: "source-item",
            companyId: "company-1",
            changeOrderId: "notice-1",
            status: "Draft"
          }
        ],
        item: []
      }
    });

    const result = await deleteChangeNotice(fake.db, "notice-1", "company-1");

    expect(result).toEqual({ data: null, error: null });
    expect(fake.deleted.map(({ table }) => table)).toEqual([
      "makeMethod",
      "changeOrder"
    ]);
  });

  it("rejects an unowned standalone Draft method", async () => {
    const fake = makeFakeChangeNoticeDeleteDb({
      rows: {
        changeOrderAffectedItem: [
          {
            id: "affected-version",
            changeOrderId: "notice-1",
            companyId: "company-1",
            draftMakeMethodId: "unowned-method",
            newItemId: null
          }
        ],
        makeMethod: [
          {
            id: "unowned-method",
            itemId: "source-item",
            companyId: "company-1",
            changeOrderId: null,
            status: "Draft"
          }
        ],
        item: []
      }
    });

    const result = await deleteChangeNotice(fake.db, "notice-1", "company-1");

    expect(result.error?.message).toBe(
      "Change Notice draft references are inconsistent."
    );
    expect(fake.committed).toBe(false);
    expect(fake.callbackRejected).toBe(true);
    expect(fake.deleted).toHaveLength(0);
  });

  it("preserves a released standalone method with no Change Notice owner", async () => {
    const fake = makeFakeChangeNoticeDeleteDb({
      rows: {
        changeOrderAffectedItem: [
          {
            id: "affected-version",
            changeOrderId: "notice-1",
            companyId: "company-1",
            draftMakeMethodId: "released-method",
            newItemId: null
          }
        ],
        makeMethod: [
          {
            id: "released-method",
            itemId: "source-item",
            companyId: "company-1",
            changeOrderId: null,
            status: "Active"
          }
        ],
        item: []
      }
    });

    const result = await deleteChangeNotice(fake.db, "notice-1", "company-1");

    expect(result).toEqual({ data: null, error: null });
    expect(fake.deleted.map(({ table }) => table)).toEqual(["changeOrder"]);
  });

  it("leaves stamped but unreferenced items and methods untouched", async () => {
    const fake = makeFakeChangeNoticeDeleteDb({
      rows: {
        changeOrderAffectedItem: [],
        makeMethod: [
          {
            id: "unreferenced-method",
            itemId: "source-item",
            companyId: "company-1",
            changeOrderId: "notice-1",
            status: "Draft"
          }
        ],
        item: [
          {
            id: "unreferenced-item",
            companyId: "company-1",
            changeOrderId: "notice-1",
            active: false
          }
        ]
      }
    });

    const result = await deleteChangeNotice(fake.db, "notice-1", "company-1");

    expect(result).toEqual({ data: null, error: null });
    expect(fake.deleted.map(({ table }) => table)).toEqual(["changeOrder"]);
    expect(fake.queries.map(({ table }) => table)).not.toContain("item");
    expect(fake.queries.map(({ table }) => table)).not.toContain("makeMethod");
  });

  it.each([
    ["missing", { changeOrder: [] }],
    [
      "wrong company",
      {
        changeOrder: [
          { id: "notice-1", companyId: "company-2", status: "Draft" }
        ]
      }
    ]
  ] as const)("rejects a %s parent", async (_case, rows) => {
    const fake = makeFakeChangeNoticeDeleteDb({ rows });

    const result = await deleteChangeNotice(fake.db, "notice-1", "company-1");

    expect(result.error?.message).toBe("Change notice not found.");
    expect(fake.committed).toBe(false);
    expect(fake.callbackRejected).toBe(true);
    expect(fake.deleted).toHaveLength(0);
  });

  it.each([
    [
      "item",
      { rows: { item: [{ id: "draft-item", companyId: "company-2" }] } }
    ],
    [
      "method",
      {
        rows: {
          makeMethod: [
            {
              id: "draft-method",
              itemId: "draft-item",
              companyId: "company-2",
              changeOrderId: "notice-1",
              status: "Draft"
            }
          ]
        }
      }
    ]
  ] as const)("rejects a referenced %s from another company", async (_kind, options) => {
    const fake = makeFakeChangeNoticeDeleteDb(options);

    const result = await deleteChangeNotice(fake.db, "notice-1", "company-1");

    expect(result.error?.message).toBe(
      "Change Notice draft references are inconsistent."
    );
    expect(fake.callbackRejected).toBe(true);
    expect(fake.deleted).toHaveLength(0);
  });

  it.each([
    [
      "item",
      {
        rows: {
          item: [
            {
              id: "draft-item",
              companyId: "company-1",
              changeOrderId: "other-notice",
              active: false
            }
          ]
        }
      }
    ],
    [
      "method",
      {
        rows: {
          makeMethod: [
            {
              id: "draft-method",
              itemId: "draft-item",
              companyId: "company-1",
              changeOrderId: "other-notice",
              status: "Draft"
            }
          ]
        }
      }
    ],
    [
      "method attached to another item",
      {
        rows: {
          makeMethod: [
            {
              id: "draft-method",
              itemId: "other-item",
              companyId: "company-1",
              changeOrderId: "notice-1",
              status: "Draft"
            }
          ]
        }
      }
    ],
    [
      "non-Draft method still owned by the notice",
      {
        rows: {
          makeMethod: [
            {
              id: "draft-method",
              itemId: "draft-item",
              companyId: "company-1",
              changeOrderId: "notice-1",
              status: "Active"
            }
          ]
        }
      }
    ]
  ] as const)("rejects an invalid referenced %s state", async (_kind, options) => {
    const fake = makeFakeChangeNoticeDeleteDb(options);

    const result = await deleteChangeNotice(fake.db, "notice-1", "company-1");

    expect(result.error?.message).toBe(
      "Change Notice draft references are inconsistent."
    );
    expect(fake.callbackRejected).toBe(true);
    expect(fake.deleted).toHaveLength(0);
  });

  it("rejects a Done notice that still owns a standalone Draft", async () => {
    const fake = makeFakeChangeNoticeDeleteDb({
      rows: {
        changeOrder: [
          { id: "notice-1", companyId: "company-1", status: "Done" }
        ],
        changeOrderAffectedItem: [
          {
            id: "affected-version",
            changeOrderId: "notice-1",
            companyId: "company-1",
            draftMakeMethodId: "version-method",
            newItemId: null
          }
        ],
        makeMethod: [
          {
            id: "version-method",
            itemId: "source-item",
            companyId: "company-1",
            changeOrderId: "notice-1",
            status: "Draft"
          }
        ],
        item: []
      }
    });

    const result = await deleteChangeNotice(fake.db, "notice-1", "company-1");

    expect(result.error?.message).toBe(
      "Change Notice draft references are inconsistent."
    );
    expect(fake.callbackRejected).toBe(true);
    expect(fake.deleted).toHaveLength(0);
  });

  it.each([
    ["affected-read", "changeOrderAffectedItem read failed"],
    ["method-read", "makeMethod read failed"],
    ["item-read", "item read failed"]
  ] as const)("surfaces a %s and rejects the transaction callback", async (failure, message) => {
    const fake = makeFakeChangeNoticeDeleteDb({ failure });

    const result = await deleteChangeNotice(fake.db, "notice-1", "company-1");

    expect(result.error?.message).toBe(message);
    expect(fake.committed).toBe(false);
    expect(fake.callbackRejected).toBe(true);
    expect(fake.deleted).toHaveLength(0);
  });

  it.each([
    [
      "standalone method",
      "makeMethod-delete",
      "makeMethod delete failed",
      {
        rows: {
          changeOrderAffectedItem: [
            {
              id: "affected-version",
              changeOrderId: "notice-1",
              companyId: "company-1",
              draftMakeMethodId: "version-method",
              newItemId: null
            }
          ],
          makeMethod: [
            {
              id: "version-method",
              itemId: "source-item",
              companyId: "company-1",
              changeOrderId: "notice-1",
              status: "Draft"
            }
          ],
          item: []
        }
      }
    ],
    ["item", "item-delete", "item delete failed", undefined],
    ["parent", "changeOrder-delete", "changeOrder delete failed", undefined]
  ] as const)("surfaces a %s delete failure", async (_kind, failure, message, extra) => {
    const fake = makeFakeChangeNoticeDeleteDb({
      failure,
      ...(extra?.rows ? extra : {})
    });

    const result = await deleteChangeNotice(fake.db, "notice-1", "company-1");

    expect(result.error?.message).toBe(message);
    expect(fake.committed).toBe(false);
    expect(fake.callbackRejected).toBe(true);
    if (_kind !== "parent") {
      expect(fake.deleted.map(({ table }) => table)).not.toContain(
        "changeOrder"
      );
    }
  });

  it.each([
    [
      "makeMethod",
      "Failed to delete Change Notice draft methods.",
      "makeMethod"
    ],
    ["item", "Failed to delete Change Notice draft items.", "item"],
    ["changeOrder", "Change Notice was not deleted.", "changeOrder"]
  ] as const)("rejects a short %s delete", async (table, message, attemptedTable) => {
    const rows =
      table === "makeMethod"
        ? {
            changeOrderAffectedItem: [
              {
                id: "affected-version",
                changeOrderId: "notice-1",
                companyId: "company-1",
                draftMakeMethodId: "version-method",
                newItemId: null
              }
            ],
            makeMethod: [
              {
                id: "version-method",
                itemId: "source-item",
                companyId: "company-1",
                changeOrderId: "notice-1",
                status: "Draft"
              }
            ],
            item: []
          }
        : undefined;
    const fake = makeFakeChangeNoticeDeleteDb({
      deleteCount: { [table]: 0 },
      ...(rows ? { rows } : {})
    });

    const result = await deleteChangeNotice(fake.db, "notice-1", "company-1");

    expect(result.error?.message).toBe(message);
    expect(fake.callbackRejected).toBe(true);
    expect(
      fake.deleted.map(({ table: deletedTable }) => deletedTable)
    ).toContain(attemptedTable);
    if (table !== "changeOrder") {
      expect(
        fake.deleted.map(({ table: deletedTable }) => deletedTable)
      ).not.toContain("changeOrder");
    }
  });
});

type CapturedActionMutation = {
  table: string;
  operation: "update" | "delete";
  filters: { column: string; value: unknown }[];
  payload?: Record<string, unknown>;
};

function makeFakeActionMutationClient(timezone = "UTC") {
  const mutations: CapturedActionMutation[] = [];

  const client = {
    from(table: string) {
      const state: {
        operation?: "update" | "delete";
        filters: { column: string; value: unknown }[];
        payload?: Record<string, unknown>;
      } = { filters: [] };

      const record = () => {
        if (state.operation) {
          mutations.push({ table, ...state } as CapturedActionMutation);
        }
      };

      const builder = {
        select: () => builder,
        update: (payload: Record<string, unknown>) => {
          state.operation = "update";
          state.payload = payload;
          return builder;
        },
        delete: () => {
          state.operation = "delete";
          return builder;
        },
        eq: (column: string, value: unknown) => {
          state.filters.push({ column, value });
          return builder;
        },
        single: async () => {
          record();
          return { data: { id: "task-1" }, error: null };
        },
        maybeSingle: async () => {
          if (table === "company") return { data: { timezone }, error: null };
          // The assignee guard reads `userToCompany`; answer it with a member so
          // the mutation under test is reached. Its own filters are pinned by the
          // `assertChangeNoticeAssigneeIsCompanyMember` tests below.
          if (table === "userToCompany") {
            return { data: { userId: "user-2" }, error: null };
          }
          return { data: null, error: null };
        },
        then: (
          resolve: (value: { data: null; error: null }) => unknown,
          reject?: (error: unknown) => unknown
        ) =>
          Promise.resolve({ data: null, error: null }).then(() => {
            record();
            return resolve({ data: null, error: null });
          }, reject)
      };

      return builder;
    }
  } as never;

  return { client, mutations };
}

describe("Change Notice action task mutations", () => {
  it("scopes every mutation by task, Change Notice, and company", async () => {
    const input = {
      id: "task-1",
      changeNoticeId: "notice-1",
      companyId: "company-1",
      userId: "user-1"
    };
    const mutationRunners = [
      {
        operation: "update" as const,
        run: (client: never) =>
          updateChangeNoticeActionStatus(client, {
            ...input,
            status: "In Progress"
          })
      },
      {
        operation: "update" as const,
        run: (client: never) =>
          updateChangeNoticeActionNotes(client, {
            ...input,
            notes: { text: "updated" }
          })
      },
      {
        operation: "update" as const,
        run: (client: never) =>
          updateChangeNoticeActionAssignee(client, {
            ...input,
            assignee: "user-2"
          })
      },
      {
        operation: "update" as const,
        run: (client: never) =>
          updateChangeNoticeActionDueDate(client, {
            ...input,
            dueDate: "2026-09-03"
          })
      },
      {
        operation: "delete" as const,
        run: (client: never) => deleteChangeNoticeAction(client, input)
      }
    ];

    for (const { operation, run } of mutationRunners) {
      const fake = makeFakeActionMutationClient();
      await run(fake.client);

      expect(fake.mutations).toHaveLength(1);
      expect(fake.mutations[0]).toEqual(
        expect.objectContaining({
          table: "changeOrderActionTask",
          operation
        })
      );
      expect(fake.mutations[0].filters).toEqual([
        { column: "id", value: "task-1" },
        { column: "changeOrderId", value: "notice-1" },
        { column: "companyId", value: "company-1" }
      ]);
    }
  });

  it("uses the company calendar day for completion and clears it otherwise", async () => {
    const today = vi
      .spyOn(datetime, "today")
      .mockReturnValue(parseDate("2026-09-03"));

    try {
      const completed = makeFakeActionMutationClient("Pacific/Kiritimati");
      await updateChangeNoticeActionStatus(completed.client, {
        id: "task-1",
        changeNoticeId: "notice-1",
        companyId: "company-1",
        status: "Completed",
        userId: "user-1"
      });

      expect(today).toHaveBeenCalledWith("Pacific/Kiritimati");
      expect(completed.mutations[0].payload).toEqual(
        expect.objectContaining({
          status: "Completed",
          completedDate: "2026-09-03"
        })
      );

      const reopened = makeFakeActionMutationClient();
      await updateChangeNoticeActionStatus(reopened.client, {
        id: "task-1",
        changeNoticeId: "notice-1",
        companyId: "company-1",
        status: "In Progress",
        userId: "user-1"
      });

      expect(reopened.mutations[0].payload).toEqual(
        expect.objectContaining({
          status: "In Progress",
          completedDate: null
        })
      );
    } finally {
      today.mockRestore();
    }
  });
});

describe("Change Notice action task template reconciliation", () => {
  it("removes only template-owned tasks and stamps new tasks as template-owned", async () => {
    const fake = makeFakeActionTaskDb({
      tasks: [
        {
          id: "template-remove",
          changeOrderId: "notice-1",
          companyId: "company-1",
          actionTypeId: "template-remove",
          taskOrigin: "Template-owned",
          sortOrder: 1
        },
        {
          id: "manual-remove",
          changeOrderId: "notice-1",
          companyId: "company-1",
          actionTypeId: "template-remove",
          taskOrigin: "Manual",
          sortOrder: 2
        },
        {
          id: "impact-remove",
          changeOrderId: "notice-1",
          companyId: "company-1",
          actionTypeId: "template-remove",
          taskOrigin: "Impact follow-up",
          sortOrder: 3
        },
        {
          id: "template-keep",
          changeOrderId: "notice-1",
          companyId: "company-1",
          actionTypeId: "template-keep",
          taskOrigin: "Template-owned",
          sortOrder: 4
        }
      ],
      templates: [
        {
          id: "template-new",
          name: "New action",
          companyId: "company-1",
          active: true
        }
      ]
    });

    await setChangeNoticeActionTasks(fake.db, {
      changeNoticeId: "notice-1",
      requiredActionIds: ["template-keep", "template-new"],
      companyId: "company-1",
      userId: "user-1"
    });

    expect(fake.deletedIds).toEqual(["template-remove"]);
    expect(fake.insertedRows).toEqual([
      expect.objectContaining({
        changeOrderId: "notice-1",
        actionTypeId: "template-new",
        taskOrigin: "Template-owned",
        companyId: "company-1",
        createdBy: "user-1"
      })
    ]);
    expect(fake.queries).toEqual(
      expect.arrayContaining([
        {
          table: "changeOrderActionTask",
          filters: ["changeOrderId =", "companyId ="]
        },
        {
          table: "changeOrderActionTask",
          filters: ["id in", "changeOrderId =", "companyId ="]
        },
        {
          table: "changeOrderRequiredAction",
          filters: ["id in", "companyId ="]
        }
      ])
    );
  });

  it("does not duplicate requested templates linked to Manual or Impact tasks", async () => {
    const fake = makeFakeActionTaskDb({
      tasks: [
        {
          id: "manual-1",
          changeOrderId: "notice-1",
          companyId: "company-1",
          actionTypeId: "template-1",
          taskOrigin: "Manual",
          sortOrder: 1
        },
        {
          id: "impact-1",
          changeOrderId: "notice-1",
          companyId: "company-1",
          actionTypeId: "template-2",
          taskOrigin: "Impact follow-up",
          sortOrder: 2
        }
      ],
      templates: [
        {
          id: "template-1",
          name: "Existing manual action",
          companyId: "company-1",
          active: true
        },
        {
          id: "template-2",
          name: "Existing impact action",
          companyId: "company-1",
          active: true
        }
      ]
    });

    await setChangeNoticeActionTasks(fake.db, {
      changeNoticeId: "notice-1",
      requiredActionIds: ["template-1", "template-2"],
      companyId: "company-1",
      userId: "user-1"
    });

    expect(fake.deletedIds).toEqual([]);
    expect(fake.insertedRows).toEqual([]);
  });

  it("seeds only active templates for the requested company with the persisted origin", async () => {
    const fake = makeFakeActionTaskDb({
      tasks: [],
      templates: [
        {
          id: "template-1",
          name: "A action",
          companyId: "company-1",
          active: true
        },
        {
          id: "template-inactive",
          name: "Inactive",
          companyId: "company-1",
          active: false
        },
        {
          id: "template-other-company",
          name: "Other",
          companyId: "company-2",
          active: true
        }
      ]
    });

    await seedDefaultChangeNoticeActions(fake.db, {
      changeNoticeId: "notice-1",
      companyId: "company-1",
      userId: "user-1"
    });

    expect(fake.insertedRows).toEqual([
      expect.objectContaining({
        actionTypeId: "template-1",
        taskOrigin: "Template-owned",
        changeOrderId: "notice-1",
        companyId: "company-1"
      })
    ]);
    expect(fake.insertedRows).toHaveLength(1);
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

// ── assertChangeNoticeAssigneeIsCompanyMember ────────────────────────────────
// `changeOrderActionTask.assignee` is a `user` id, and `user` is a global table,
// so membership has to be proven against `userToCompany` for the active company.
function makeFakeMembershipClient(
  membership: { userId: string; companyId: string } | null,
  error: { message: string } | null = null
) {
  const lookups: { table: string; filters: Record<string, unknown> }[] = [];

  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return builder;
        },
        maybeSingle: async () => {
          lookups.push({ table, filters });
          return { data: error ? null : membership, error };
        }
      };
      return builder;
    }
  } as never;

  return { client, lookups };
}

describe("assertChangeNoticeAssigneeIsCompanyMember", () => {
  it("treats a cleared assignee as a no-op without querying", async () => {
    for (const assignee of [null, undefined, "", "   "]) {
      const { client, lookups } = makeFakeMembershipClient(null);
      await expect(
        assertChangeNoticeAssigneeIsCompanyMember(client, {
          companyId: "company-1",
          assignee
        })
      ).resolves.toBeNull();
      expect(lookups).toHaveLength(0);
    }
  });

  it("scopes the membership lookup to the assignee and the active company", async () => {
    const { client, lookups } = makeFakeMembershipClient({
      userId: "user-2",
      companyId: "company-1"
    });

    await expect(
      assertChangeNoticeAssigneeIsCompanyMember(client, {
        companyId: "company-1",
        assignee: "user-2"
      })
    ).resolves.toBeNull();

    expect(lookups).toEqual([
      {
        table: "userToCompany",
        filters: { userId: "user-2", companyId: "company-1" }
      }
    ]);
  });

  it("rejects an assignee who is not a member of the active company", async () => {
    const { client } = makeFakeMembershipClient(null);

    await expect(
      assertChangeNoticeAssigneeIsCompanyMember(client, {
        companyId: "company-1",
        assignee: "outsider-1"
      })
    ).resolves.toEqual({
      error: { message: "The task assignee is not a member of this company." }
    });
  });

  it("fails closed when the membership lookup errors", async () => {
    const { client } = makeFakeMembershipClient(null, {
      message: "lookup failed"
    });

    await expect(
      assertChangeNoticeAssigneeIsCompanyMember(client, {
        companyId: "company-1",
        assignee: "user-2"
      })
    ).resolves.toEqual({
      error: { message: "Could not verify the task assignee." }
    });
  });
});
