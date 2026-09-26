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
import { describe, expect, it } from "vitest";
import {
  buildSortOrderUpdate,
  parseSortOrderUpdates,
  updateSortOrder
} from "./sort-order";

// The boundary here is the Postgres wire: a driver that records what Kysely
// sends and answers with the rows the database would have returned. Everything
// above it — SQL building, the transaction, the row-count check — runs real.
class RecordingDriver extends DummyDriver {
  readonly sent: string[] = [];
  constructor(private readonly returnedIds: string[]) {
    super();
  }
  override async acquireConnection(): Promise<DatabaseConnection> {
    return {
      executeQuery: async <R>(
        query: CompiledQuery
      ): Promise<QueryResult<R>> => {
        this.sent.push(query.sql);
        return { rows: this.returnedIds.map((id) => ({ id })) as R[] };
      },
      // biome-ignore lint/correctness/useYield: never streamed
      streamQuery: async function* () {
        throw new Error("not streamed");
      }
    };
  }
  override async beginTransaction() {
    this.sent.push("BEGIN");
  }
  override async commitTransaction() {
    this.sent.push("COMMIT");
  }
  override async rollbackTransaction() {
    this.sent.push("ROLLBACK");
  }
}

function database(returnedIds: string[] = []) {
  const driver = new RecordingDriver(returnedIds);
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

const updates = [
  { id: "ql1", sortOrder: 2 },
  { id: "ql2", sortOrder: 1 }
];

describe("buildSortOrderUpdate", () => {
  it("scopes one UPDATE … FROM (VALUES …) to the company and the parent document", () => {
    const { db } = database();
    const compiled = buildSortOrderUpdate({
      table: "quoteLine",
      column: "sortOrder",
      companyId: "c1",
      userId: "u1",
      parent: { column: "quoteId", id: "q1" },
      updates,
      updatedAt: "2026-09-26T00:00:00.000Z"
    }).compile(db);

    expect(compiled.sql).toBe(
      'UPDATE "quoteLine" AS t SET "sortOrder" = v."sortOrder", "updatedBy" = $1, "updatedAt" = $2 FROM (VALUES ($3::text, $4::numeric), ($5::text, $6::numeric)) AS v("id", "sortOrder") WHERE t."id" = v."id" AND t."companyId" = $7 AND "t"."quoteId" = $8 RETURNING t."id"'
    );
    expect(compiled.parameters).toEqual([
      "u1",
      "2026-09-26T00:00:00.000Z",
      "ql1",
      2,
      "ql2",
      1,
      "c1",
      "q1"
    ]);
  });

  it("writes an `order` sort column and scopes a one-hop parent through its table", () => {
    const { db } = database();
    const compiled = buildSortOrderUpdate({
      table: "assemblyInstructionStepMaterial",
      column: "sortOrder",
      companyId: "c1",
      userId: "u1",
      parent: {
        column: "stepId",
        via: {
          table: "assemblyInstructionStep",
          column: "assemblyInstructionId",
          id: "ai1"
        }
      },
      updates: [{ id: "m1", sortOrder: 1 }],
      updatedAt: "2026-09-26T00:00:00.000Z"
    }).compile(db);

    expect(compiled.sql).toContain(
      'AND "t"."stepId" IN (SELECT p."id" FROM "assemblyInstructionStep" AS p WHERE "p"."assemblyInstructionId" = $6 AND p."companyId" = $7)'
    );
    // The subquery is tenant-scoped too, with the same companyId.
    expect(compiled.parameters.slice(4)).toEqual(["c1", "ai1", "c1"]);

    const rfq = buildSortOrderUpdate({
      table: "salesRfqLine",
      column: "order",
      companyId: "c1",
      userId: "u1",
      parent: { column: "salesRfqId", id: "rfq1" },
      updates: [{ id: "l1", sortOrder: 1 }],
      updatedAt: "2026-09-26T00:00:00.000Z"
    }).compile(db);
    expect(rfq.sql).toContain('UPDATE "salesRfqLine" AS t SET "order" = ');
    expect(rfq.sql).toContain('AND "t"."salesRfqId" = $6');
  });
});

describe("updateSortOrder", () => {
  const args = {
    table: "quoteLine" as const,
    column: "sortOrder" as const,
    companyId: "c1",
    userId: "u1",
    parent: { column: "quoteId" as const, id: "q1" },
    updates
  };

  it("issues exactly one statement and commits when every row is on the document", async () => {
    const { db, driver } = database(["ql1", "ql2"]);
    await updateSortOrder(db, args);
    expect(driver.sent).toHaveLength(3);
    expect(driver.sent[0]).toBe("BEGIN");
    expect(driver.sent[1]).toMatch(/^UPDATE "quoteLine" AS t /);
    expect(driver.sent[2]).toBe("COMMIT");
  });

  it("rolls the whole reorder back when a row is outside the company or document", async () => {
    // Postgres matched only one of the two ids — the other belongs to another
    // quote (or company), so the predicates filtered it out.
    const { db, driver } = database(["ql1"]);
    await expect(updateSortOrder(db, args)).rejects.toThrow(
      "quoteLine: 1 of 2 rows are not on this document"
    );
    expect(driver.sent).toEqual(["BEGIN", expect.any(String), "ROLLBACK"]);
  });

  it("refuses an empty parent id instead of issuing an unscoped update", async () => {
    const { db, driver } = database(["ql1", "ql2"]);
    await expect(
      updateSortOrder(db, { ...args, parent: { column: "quoteId", id: "" } })
    ).rejects.toThrow("quoteLine: missing parent id");
    expect(driver.sent).toEqual([]);
  });

  it("sends nothing for an empty reorder", async () => {
    const { db, driver } = database();
    await updateSortOrder(db, { ...args, updates: [] });
    expect(driver.sent).toEqual([]);
  });
});

describe("parseSortOrderUpdates", () => {
  const form = (updates?: string) => {
    const formData = new FormData();
    if (updates !== undefined) formData.set("updates", updates);
    return formData;
  };

  it("reads the id → sort order map the drag-sort UI posts", () => {
    expect(parseSortOrderUpdates(form('{"ql1":2,"ql2":"1.5"}'))).toEqual([
      { id: "ql1", sortOrder: 2 },
      { id: "ql2", sortOrder: 1.5 }
    ]);
  });

  it.each([
    ["missing", undefined],
    ["not JSON", "{ql1: 2"],
    ["empty", "{}"],
    ["NaN", '{"ql1":"abc"}'],
    ["blank string (Number() would make it 0)", '{"ql1":""}'],
    ["null", '{"ql1":null}'],
    ["an array", "[1,2]"]
  ])("rejects %s", (_label, updates) => {
    expect(parseSortOrderUpdates(form(updates))).toBeNull();
  });
});
