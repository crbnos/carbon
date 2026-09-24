import { describe, expect, it, vi } from "vitest";
import toolMetadataJson from "../app/routes/api+/mcp+/lib/tool-metadata.json";

// The items.service graph transitively loads @carbon/glossary, whose
// module-load-time Lingui `msg` macro isn't transformed under plain vitest.
// Stub it; the services under test stay the genuine implementation.
vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn()
}));

const { updateMaterialProperties, upsertMaterial } = await import(
  "~/modules/items/items.service"
);

// Pins material edits over the API and MCP: the properties panel's rules
// (dependent resets, pick lists, generated IDs) in the service, updates that
// write only the fields sent, sizes on update, and the lookup-table writes
// the MCP layer used to break by stamping audit columns those tables lack.

type Filter = [string, string, unknown];
type Call = {
  table: string;
  op: "select" | "update" | "insert" | "upsert" | "delete";
  columns?: string;
  payload?: Record<string, unknown>;
  filters: Filter[];
  single?: "single" | "maybeSingle";
};
type Response = { data: unknown; error: unknown };

/** A supabase stub that records every query and answers from `respond`. */
function makeClient(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, op: "select", filters: [] };
    let started = false;
    const builder: Record<string, unknown> = {};
    builder.select = (columns?: string) => {
      // A select after a write is the "return the row" modifier.
      if (!started) {
        started = true;
        call.op = "select";
        call.columns = columns;
      }
      return builder;
    };
    for (const op of ["update", "insert", "upsert", "delete"] as const) {
      builder[op] = (payload?: Record<string, unknown>) => {
        started = true;
        call.op = op;
        call.payload = payload;
        return builder;
      };
    }
    for (const op of ["eq", "in", "or", "not"] as const) {
      builder[op] = (column: string, value: unknown) => {
        call.filters.push([op, column, value]);
        return builder;
      };
    }
    builder.order = () => builder;
    builder.limit = () => builder;
    builder.single = () => {
      call.single = "single";
      return builder;
    };
    builder.maybeSingle = () => {
      call.single = "maybeSingle";
      return builder;
    };
    builder.then = (
      resolve: (value: Response) => unknown,
      reject?: (reason: unknown) => unknown
    ) => {
      calls.push(call);
      return Promise.resolve(respond(call)).then(resolve, reject);
    };
    return builder;
  };
  return { client: { from } as never, calls };
}

type Write = {
  table: string;
  set: Record<string, unknown>;
  where: Filter[];
};

/**
 * A Kysely stub for saveMaterialIdentity's transaction. `writes` holds only
 * committed statements: a throw inside the callback drops what it staged.
 */
function makeDb(opts: { taken?: boolean; materialRows?: number } = {}) {
  const writes: Write[] = [];
  let staged: Write[] = [];
  const trx = {
    selectFrom: () => {
      const query = {
        select: () => query,
        where: () => query,
        executeTakeFirst: async () => (opts.taken ? { id: "other" } : undefined)
      };
      return query;
    },
    updateTable: (table: string) => {
      const write: Write = { table, set: {}, where: [] };
      const query = {
        set: (values: Record<string, unknown>) => {
          write.set = values;
          return query;
        },
        where: (column: string, op: string, value: unknown) => {
          write.where.push([op, column, value]);
          return query;
        },
        executeTakeFirst: async () => {
          staged.push(write);
          return {
            numUpdatedRows: BigInt(
              table === "material" ? (opts.materialRows ?? 1) : 1
            )
          };
        },
        execute: async () => {
          staged.push(write);
          return [];
        }
      };
      return query;
    }
  };
  const db = {
    transaction: () => ({
      execute: async (callback: (tx: typeof trx) => Promise<unknown>) => {
        staged = [];
        const result = await callback(trx);
        writes.push(...staged);
        return result;
      }
    })
  };
  return { db: db as never, writes };
}

const COMPANY = "company-1";
const USER = "user-1";

const lookups: Record<string, Record<string, Record<string, unknown>>> = {
  materialSubstance: {
    aluminum: { name: "Aluminum", code: "AL" },
    steel: { name: "Steel", code: "STL" }
  },
  materialForm: {
    plate: { name: "Plate", code: "PL" },
    roundBar: { name: "Round Bar", code: "RB" }
  },
  materialGrade: {
    "al-6061": { name: "6061", materialSubstanceId: "aluminum" },
    "al-7075": { name: "7075", materialSubstanceId: "aluminum" },
    "stl-1018": { name: "1018", materialSubstanceId: "steel" }
  },
  materialFinish: {
    "al-anodized": { name: "Anodized", materialSubstanceId: "aluminum" }
  },
  materialDimension: {
    "pl-025": { name: '1/4"', materialFormId: "plate" },
    "rb-1": { name: '1"', materialFormId: "roundBar" }
  },
  materialType: {
    "al-pl-cast": {
      name: "Cast",
      code: "C",
      materialSubstanceId: "aluminum",
      materialFormId: "plate"
    }
  }
};

const ALUMINUM_PLATE = {
  materialSubstanceId: "aluminum",
  materialFormId: "plate",
  materialTypeId: "al-pl-cast",
  finishId: "al-anodized",
  gradeId: "al-6061",
  dimensionId: "pl-025"
};

const ITEM = { id: "item-uuid-1", readableId: "MAT-AL-PLATE" };

const idOf = (call: Call) =>
  call.filters.find(([op, column]) => op === "eq" && column === "id")?.[2];

type Scenario = {
  generated?: boolean;
  material?: Record<string, string | null> | null;
  itemById?: typeof ITEM | null;
  itemsByReadableId?: (typeof ITEM)[];
  revisions?: string[];
  changeNotice?: string;
};

/** Answers every read the material paths make from one scenario. */
function respondTo(scenario: Scenario) {
  return (call: Call): Response => {
    const { table, op } = call;
    if (op === "select" && table === "companySettings") {
      return {
        data: { materialGeneratedIds: scenario.generated ?? false },
        error: null
      };
    }
    if (op === "select" && table === "material") {
      return {
        data: scenario.material === undefined ? ALUMINUM_PLATE : scenario.material,
        error: null
      };
    }
    if (op === "select" && table in lookups) {
      return {
        data: lookups[table][idOf(call) as string] ?? null,
        error: null
      };
    }
    if (op === "select" && table === "item") {
      if (call.columns === "revision") {
        return {
          data: (scenario.revisions ?? ["0"]).map((revision) => ({ revision })),
          error: null
        };
      }
      if (call.columns === "id, changeOrderId") {
        return {
          data: [{ id: ITEM.id, changeOrderId: scenario.changeNotice ?? null }],
          error: null
        };
      }
      if (call.columns === "*") {
        return {
          data: {
            ...ITEM,
            name: "Aluminum plate",
            type: "Material",
            replenishmentSystem: "Buy",
            companyId: COMPANY
          },
          error: null
        };
      }
      const byUuid = idOf(call) !== undefined;
      if (byUuid) {
        const item =
          scenario.itemById === undefined ? ITEM : scenario.itemById;
        return { data: item, error: null };
      }
      return { data: scenario.itemsByReadableId ?? [], error: null };
    }
    if (op === "select" && table === "changeOrder") {
      return {
        data: scenario.changeNotice
          ? [{ id: "co-1", changeOrderId: scenario.changeNotice }]
          : [],
        error: null
      };
    }
    if (op === "select" && table === "materials") {
      return { data: { readableId: ITEM.readableId }, error: null };
    }
    if (op === "insert" && table === "item") {
      return { data: { id: "item-uuid-new" }, error: null };
    }
    if (op === "update" && table === "item") {
      return { data: { id: ITEM.id }, error: null };
    }
    if (op === "update" && table === "itemCost") {
      return { data: { itemId: ITEM.id }, error: null };
    }
    if (op === "select") return { data: [], error: null };
    return { data: null, error: null };
  };
}

const writesTo = (calls: Call[], table: string, op: Call["op"]) =>
  calls.filter((c) => c.table === table && c.op === op);

const materialWrite = (writes: Write[]) =>
  writes.find((w) => w.table === "material");

describe("updateMaterialProperties", () => {
  it("a new substance clears finish, grade and type", async () => {
    const { client } = makeClient(respondTo({}));
    const { db, writes } = makeDb();
    const result = await updateMaterialProperties(client, db, {
      id: ITEM.id,
      companyId: COMPANY,
      updatedBy: USER,
      materialSubstanceId: "steel"
    });
    expect(result.error).toBeNull();
    expect(materialWrite(writes)?.set).toMatchObject({
      materialSubstanceId: "steel",
      finishId: null,
      gradeId: null,
      materialTypeId: null,
      id: ITEM.readableId,
      updatedBy: USER
    });
    expect(materialWrite(writes)?.set).not.toHaveProperty("dimensionId");
    expect(materialWrite(writes)?.where).toEqual(
      expect.arrayContaining([
        ["=", "id", ITEM.readableId],
        ["=", "companyId", COMPANY]
      ])
    );
  });

  it("keeps a dependent the same call sets", async () => {
    const { client } = makeClient(respondTo({}));
    const { db, writes } = makeDb();
    const result = await updateMaterialProperties(client, db, {
      id: ITEM.readableId,
      companyId: COMPANY,
      updatedBy: USER,
      materialSubstanceId: "steel",
      gradeId: "stl-1018"
    });
    expect(result.error).toBeNull();
    expect(materialWrite(writes)?.set).toMatchObject({
      materialSubstanceId: "steel",
      gradeId: "stl-1018",
      finishId: null
    });
  });

  it("a new shape clears dimension and type", async () => {
    const { client } = makeClient(respondTo({}));
    const { db, writes } = makeDb();
    await updateMaterialProperties(client, db, {
      id: ITEM.id,
      companyId: COMPANY,
      updatedBy: USER,
      materialFormId: "roundBar"
    });
    expect(materialWrite(writes)?.set).toMatchObject({
      materialFormId: "roundBar",
      dimensionId: null,
      materialTypeId: null
    });
    expect(materialWrite(writes)?.set).not.toHaveProperty("gradeId");
  });

  it.each([
    [{ gradeId: "stl-1018" }, "not a grade of substance aluminum"],
    [{ finishId: "missing" }, "Finish missing not found"],
    [{ dimensionId: "rb-1" }, "not a dimension of shape plate"],
    [
      { materialFormId: "roundBar", materialTypeId: "al-pl-cast" },
      "not a type of substance aluminum and shape roundBar"
    ],
    [{ materialSubstanceId: "unobtainium" }, "Substance unobtainium not found"]
  ])("refuses %o", async (change, message) => {
    const { client } = makeClient(respondTo({}));
    const { db, writes } = makeDb();
    const result = await updateMaterialProperties(client, db, {
      id: ITEM.id,
      companyId: COMPANY,
      updatedBy: USER,
      ...change
    });
    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({
      message: expect.stringContaining(message)
    });
    expect(writes).toHaveLength(0);
  });

  it("does not re-check an older inconsistency the call leaves alone", async () => {
    const { client } = makeClient(
      respondTo({ material: { ...ALUMINUM_PLATE, gradeId: "stl-1018" } })
    );
    const { db, writes } = makeDb();
    const result = await updateMaterialProperties(client, db, {
      id: ITEM.id,
      companyId: COMPANY,
      updatedBy: USER,
      dimensionId: null
    });
    expect(result.error).toBeNull();
    expect(materialWrite(writes)?.set).toMatchObject({ dimensionId: null });
    expect(materialWrite(writes)?.set).not.toHaveProperty("gradeId");
  });

  it("an unknown material is an error and writes nothing", async () => {
    const { client } = makeClient(
      respondTo({ itemById: null, material: null })
    );
    const { db, writes } = makeDb();
    const result = await updateMaterialProperties(client, db, {
      id: "nope",
      companyId: COMPANY,
      updatedBy: USER,
      gradeId: "al-7075"
    });
    expect(result.error).toMatchObject({ code: "PGRST116" });
    expect(writes).toHaveLength(0);
  });

  it("with generated IDs, renames the material and every revision in one transaction", async () => {
    const { client } = makeClient(respondTo({ generated: true }));
    const { db, writes } = makeDb();
    const result = await updateMaterialProperties(client, db, {
      id: ITEM.id,
      companyId: COMPANY,
      updatedBy: USER,
      gradeId: "al-7075"
    });
    expect(result.error).toBeNull();

    const newId = '7075-AL-C-PL-1/4"-Anodized';
    expect(materialWrite(writes)?.set).toMatchObject({
      gradeId: "al-7075",
      id: newId
    });
    const items = writes.find((w) => w.table === "item");
    expect(items?.set).toMatchObject({
      readableId: newId,
      name: '7075 Aluminum Cast Plate 1/4" Anodized',
      updatedBy: USER
    });
    expect(items?.where).toEqual(
      expect.arrayContaining([
        ["=", "readableId", ITEM.readableId],
        ["=", "companyId", COMPANY],
        ["=", "type", "Material"]
      ])
    );
  });

  it("with generated IDs, refuses an id another material has", async () => {
    const { client } = makeClient(respondTo({ generated: true }));
    const { db, writes } = makeDb({ taken: true });
    const result = await updateMaterialProperties(client, db, {
      id: ITEM.id,
      companyId: COMPANY,
      updatedBy: USER,
      gradeId: "al-7075"
    });
    expect(result.error).toMatchObject({
      message: expect.stringContaining("already exists")
    });
    expect(writes).toHaveLength(0);
  });

  it("with generated IDs, needs a substance and a shape", async () => {
    const { client } = makeClient(respondTo({ generated: true }));
    const { db, writes } = makeDb();
    const result = await updateMaterialProperties(client, db, {
      id: ITEM.id,
      companyId: COMPANY,
      updatedBy: USER,
      materialFormId: null
    });
    expect(result.error).toMatchObject({
      message: expect.stringContaining("substance and a shape")
    });
    expect(writes).toHaveLength(0);
  });
});

const required = {
  name: "Aluminum plate",
  replenishmentSystem: "Buy" as const,
  defaultMethodType: "Pull from Inventory" as const,
  itemTrackingType: "Inventory" as const,
  unitOfMeasureCode: "EA",
  shelfLifeCalculateFromBom: false,
  companyId: COMPANY
};

describe("upsertMaterial update", () => {
  it("writes only the fields sent and leaves active alone", async () => {
    const { client, calls } = makeClient(respondTo({}));
    const { db, writes } = makeDb();
    const result = await upsertMaterial(client, db, {
      ...required,
      id: ITEM.id,
      updatedBy: USER,
      mpn: "MPN-1"
    });
    expect(result.error).toBeNull();

    const [item] = writesTo(calls, "item", "update");
    expect(item.payload).toMatchObject({ name: "Aluminum plate", mpn: "MPN-1" });
    expect(item.payload).not.toHaveProperty("description");
    expect(item.payload).not.toHaveProperty("active");
    expect(item.filters).toEqual(
      expect.arrayContaining([
        ["eq", "id", ITEM.id],
        ["eq", "companyId", COMPANY]
      ])
    );
    // No property or custom field sent, so the material row is untouched.
    expect(writes).toHaveLength(0);
    expect(writesTo(calls, "material", "update")).toHaveLength(0);
  });

  it("a readable id resolves to the item uuid", async () => {
    const { client, calls } = makeClient(
      respondTo({ itemById: null, itemsByReadableId: [ITEM] })
    );
    const { db } = makeDb();
    const result = await upsertMaterial(client, db, {
      ...required,
      id: ITEM.readableId,
      updatedBy: USER
    });
    expect(result.error).toBeNull();
    expect(writesTo(calls, "item", "update")[0].filters).toEqual(
      expect.arrayContaining([["eq", "id", ITEM.id]])
    );
  });

  it("a readable id shared by several revisions is refused", async () => {
    const { client, calls } = makeClient(
      respondTo({
        itemById: null,
        itemsByReadableId: [ITEM, { ...ITEM, id: "item-uuid-2" }]
      })
    );
    const { db, writes } = makeDb();
    const result = await upsertMaterial(client, db, {
      ...required,
      id: ITEM.readableId,
      updatedBy: USER
    });
    expect(result.error).toMatchObject({
      message: expect.stringContaining("revisions")
    });
    expect(writesTo(calls, "item", "update")).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it("sends item group and unit cost to itemCost", async () => {
    const { client, calls } = makeClient(respondTo({}));
    const { db } = makeDb();
    const result = await upsertMaterial(client, db, {
      ...required,
      id: ITEM.id,
      updatedBy: USER,
      postingGroupId: "group-1",
      unitCost: 12.5
    });
    expect(result.error).toBeNull();
    const [cost] = writesTo(calls, "itemCost", "update");
    expect(cost.payload).toMatchObject({
      itemPostingGroupId: "group-1",
      unitCost: 12.5,
      updatedBy: USER
    });
    expect(cost.filters).toEqual(
      expect.arrayContaining([
        ["eq", "itemId", ITEM.id],
        ["eq", "companyId", COMPANY]
      ])
    );
    expect(cost.single).toBe("single");
  });

  it("checks property changes before any write", async () => {
    const { client, calls } = makeClient(respondTo({}));
    const { db, writes } = makeDb();
    const result = await upsertMaterial(client, db, {
      ...required,
      id: ITEM.id,
      updatedBy: USER,
      gradeId: "stl-1018"
    });
    expect(result.error).toMatchObject({
      message: expect.stringContaining("not a grade of substance aluminum")
    });
    expect(writesTo(calls, "item", "update")).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it("echoing unchanged properties writes none of them", async () => {
    const { client } = makeClient(respondTo({}));
    const { db, writes } = makeDb();
    const result = await upsertMaterial(client, db, {
      ...required,
      id: ITEM.id,
      updatedBy: USER,
      ...ALUMINUM_PLATE
    });
    expect(result.error).toBeNull();
    expect(writes).toHaveLength(0);
  });

  it("with generated IDs, a property change renames and replaces the sent name", async () => {
    const { client, calls } = makeClient(respondTo({ generated: true }));
    const { db, writes } = makeDb();
    const result = await upsertMaterial(client, db, {
      ...required,
      id: ITEM.id,
      updatedBy: USER,
      readableId: ITEM.readableId,
      gradeId: "al-7075"
    });
    expect(result.error).toBeNull();
    const name = '7075 Aluminum Cast Plate 1/4" Anodized';
    expect(writes.find((w) => w.table === "item")?.set).toMatchObject({
      name
    });
    expect(writesTo(calls, "item", "update")[0].payload).toMatchObject({
      name
    });
  });

  it("with hand-typed IDs, readableId renames the material", async () => {
    const { client } = makeClient(respondTo({}));
    const { db, writes } = makeDb();
    const result = await upsertMaterial(client, db, {
      ...required,
      id: ITEM.id,
      updatedBy: USER,
      readableId: "MAT-AL-PLATE-2"
    });
    expect(result.error).toBeNull();
    expect(materialWrite(writes)?.set).toMatchObject({ id: "MAT-AL-PLATE-2" });
    expect(writes.find((w) => w.table === "item")?.set).toMatchObject({
      readableId: "MAT-AL-PLATE-2"
    });
  });

  it("sizes add a revision per size the material lacks", async () => {
    const { client, calls } = makeClient(
      respondTo({ revisions: ["0", '1"'] })
    );
    const { db } = makeDb();
    const result = await upsertMaterial(client, db, {
      ...required,
      id: ITEM.id,
      updatedBy: USER,
      sizes: ['1"', '2"', '2"']
    });
    expect(result.error).toBeNull();
    const inserts = writesTo(calls, "item", "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].payload).toMatchObject({
      readableId: ITEM.readableId,
      revision: '2"',
      type: "Material",
      createdBy: USER
    });
  });

  it("sizes are refused while the material is open in a change notice", async () => {
    const { client, calls } = makeClient(
      respondTo({ changeNotice: "ECN-0001" })
    );
    const { db } = makeDb();
    const result = await upsertMaterial(client, db, {
      ...required,
      id: ITEM.id,
      updatedBy: USER,
      sizes: ['2"']
    });
    expect(result.error).toMatchObject({
      message: expect.stringContaining("ECN-0001")
    });
    expect(writesTo(calls, "item", "insert")).toHaveLength(0);
  });
});

describe("upsertMaterial create", () => {
  it("with generated IDs, derives the readable id and name from the properties", async () => {
    const { client, calls } = makeClient(respondTo({ generated: true }));
    const { db } = makeDb();
    const result = await upsertMaterial(client, db, {
      ...required,
      id: "anything",
      name: "anything",
      createdBy: USER,
      materialSubstanceId: "aluminum",
      materialFormId: "plate",
      gradeId: "al-7075"
    });
    expect(result.error).toBeNull();
    expect(writesTo(calls, "item", "insert")[0].payload).toMatchObject({
      readableId: "7075-AL-PL",
      name: "7075 Aluminum Plate"
    });
    expect(writesTo(calls, "material", "upsert")[0].payload).toMatchObject({
      id: "7075-AL-PL"
    });
  });

  it("refuses a grade that is not of the substance", async () => {
    const { client, calls } = makeClient(respondTo({}));
    const { db } = makeDb();
    const result = await upsertMaterial(client, db, {
      ...required,
      id: "MAT-1",
      createdBy: USER,
      materialSubstanceId: "aluminum",
      gradeId: "stl-1018"
    });
    expect(result.error).toMatchObject({
      message: expect.stringContaining("not a grade of substance aluminum")
    });
    expect(writesTo(calls, "item", "insert")).toHaveLength(0);
  });
});

describe("material tools over MCP", () => {
  const tools = (
    toolMetadataJson as unknown as {
      tools: { name: string; injectAuth: string[]; serviceParams: string[] }[];
    }
  ).tools;
  const tool = (name: string) => tools.find((t) => t.name === name);

  it.each([
    "items_upsertMaterialDimension",
    "items_upsertMaterialFinish",
    "items_upsertMaterialGrade",
    "items_upsertMaterialType"
  ])("%s stamps no audit columns its table lacks", (name) => {
    expect(tool(name)?.injectAuth).toEqual(["companyId"]);
  });

  it("items_updateMaterialProperties is reachable with a database client", () => {
    const update = tool("items_updateMaterialProperties");
    expect(update?.serviceParams).toEqual(["client", "db", "material"]);
    expect(update?.injectAuth).toEqual(
      expect.arrayContaining(["companyId", "updatedBy"])
    );
  });
});
