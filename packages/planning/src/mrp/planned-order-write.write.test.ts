// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DB } from "@carbon/database/client";
import {
  type CompiledQuery,
  type DatabaseConnection,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryResult
} from "kysely";
import { describe, expect, it } from "vitest";
import {
  diffPlannedOrders,
  writePlannedOrderDiff
} from "./planned-order-write";
import {
  type GeneratedPlannedOrder,
  plannedOrderNaturalKey
} from "./planned-orders";

type Row = Record<string, unknown> & { id: string; status: string };

/**
 * A `plannedOrder` table in memory. It records every statement and applies
 * the ones the writer sends: the read (by status), the DELETE (by id and
 * status), the `UPDATE … FROM (VALUES …)` and the INSERT … RETURNING.
 */
class RecordingDriver extends DummyDriver {
  readonly sent: CompiledQuery[] = [];
  private nextId = 1;
  constructor(readonly rows: Row[]) {
    super();
  }

  private apply(query: CompiledQuery): unknown[] {
    const params = query.parameters as unknown[];
    const sqlText = query.sql;
    if (sqlText.startsWith("select")) {
      const status = params[1];
      return this.rows.filter((row) => row.status === status);
    }
    if (sqlText.startsWith("delete")) {
      const [, status, ...ids] = params;
      for (let i = this.rows.length - 1; i >= 0; i--) {
        const row = this.rows[i]!;
        if (row.status === status && ids.includes(row.id)) {
          this.rows.splice(i, 1);
        }
      }
      return [];
    }
    if (sqlText.trimStart().startsWith("UPDATE")) {
      // updatedBy, updatedAt, then 8 values per row, then companyId
      const values = params.slice(2, -1);
      for (let i = 0; i < values.length; i += 8) {
        const [id, quantity, scrapQuantity, dueDate, releaseDate] =
          values.slice(i, i + 8);
        const row = this.rows.find(
          (r) => r.id === id && r.status === "Planned"
        );
        if (!row) continue;
        Object.assign(row, {
          quantity,
          scrapQuantity,
          dueDate,
          releaseDate,
          updatedBy: params[0]
        });
      }
      return [];
    }
    if (sqlText.startsWith("insert")) {
      const columns = [
        ...(sqlText.match(/\(([^)]*)\) values/)?.[1] ?? "").matchAll(/"(\w+)"/g)
      ].map((m) => m[1]!);
      const inserted: Row[] = [];
      for (let i = 0; i < params.length; i += columns.length) {
        const row = Object.fromEntries(
          columns.map((column, j) => [column, params[i + j]])
        ) as Row;
        row.id = `new-${this.nextId++}`;
        this.rows.push(row);
        inserted.push(row);
      }
      return inserted;
    }
    return [];
  }

  override async acquireConnection(): Promise<DatabaseConnection> {
    return {
      executeQuery: async <R>(
        query: CompiledQuery
      ): Promise<QueryResult<R>> => {
        this.sent.push(query);
        return { rows: this.apply(query) as R[] };
      },
      // biome-ignore lint/correctness/useYield: never streamed
      streamQuery: async function* () {
        throw new Error("not streamed");
      }
    };
  }
}

function database(rows: Row[]) {
  const driver = new RecordingDriver(rows);
  const db = new Kysely<DB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler()
    }
  });
  return { db, driver };
}

const TRACE = {
  policyName: "Demand-Based Reorder",
  triggerValues: { projectedStock: -10 },
  quantity: 10,
  scrapQuantity: 0,
  explosionQuantity: 10
};

function generated(
  overrides: Partial<GeneratedPlannedOrder> = {}
): GeneratedPlannedOrder {
  const order = {
    itemId: "item-1",
    locationId: "loc-1",
    planningSegmentId: "",
    orderType: "Make" as const,
    quantity: 10,
    scrapQuantity: 0,
    dueDate: "2026-11-20",
    releaseDate: "2026-11-13",
    periodId: "p2",
    splitIndex: 0,
    lowLevelCode: 0,
    supplierId: null,
    quantityTrace: TRACE,
    ...overrides
  };
  return { ...order, naturalKey: plannedOrderNaturalKey(order) };
}

/** A stored row with the values `generated()` would write. */
function stored(id: string, overrides: Partial<Row> = {}): Row {
  const { naturalKey: _key, ...order } = generated();
  return { ...order, id, status: "Planned", ...overrides };
}

async function write(
  rows: Row[],
  orders: GeneratedPlannedOrder[],
  heldPlannedOrderIds: string[] = []
) {
  const { db, driver } = database(rows);
  const idByKey = await writePlannedOrderDiff(db, {
    companyId: "co-1",
    userId: "user-1",
    locationIds: ["loc-1"],
    generated: orders,
    heldPlannedOrderIds,
    updatedAt: "2026-11-14T00:00:00Z"
  });
  const kinds = driver.sent.map((q) =>
    q.sql.includes("pg_advisory_xact_lock")
      ? "lock"
      : q.sql.trimStart().split(/\s/)[0]!.toLowerCase()
  );
  return { idByKey, kinds, driver };
}

describe("writePlannedOrderDiff", () => {
  // A conversion between the run's read and its write would otherwise be
  // overwritten or deleted.
  it("takes the company's planning lock before any other statement", async () => {
    const { kinds, driver } = await write([], [generated()]);
    expect(kinds[0]).toBe("lock");
    expect(driver.sent[0]!.parameters).toEqual(["planning-actions:co-1"]);
  });

  it("inserts a new order and returns its id by natural key", async () => {
    const order = generated();
    const { idByKey, kinds, driver } = await write([], [order]);
    expect(kinds).toEqual(["lock", "select", "insert"]);
    expect(idByKey).toEqual(new Map([[order.naturalKey, "new-1"]]));
    expect(driver.rows).toEqual([
      expect.objectContaining({ id: "new-1", status: "Planned", quantity: 10 })
    ]);
  });

  // Two identical runs write nothing: ids and updatedAt stay.
  it("sends no write for a matched row whose values did not change", async () => {
    const order = generated();
    const { idByKey, kinds } = await write([stored("plo-1")], [order]);
    expect(kinds).toEqual(["lock", "select"]);
    expect(idByKey).toEqual(new Map([[order.naturalKey, "plo-1"]]));
  });

  it("updates a matched row in place when its quantity changed", async () => {
    const { idByKey, kinds, driver } = await write(
      [stored("plo-1")],
      [generated({ quantity: 15 })]
    );
    expect(kinds).toEqual(["lock", "select", "update"]);
    expect([...idByKey.values()]).toEqual(["plo-1"]);
    expect(driver.rows).toEqual([
      expect.objectContaining({
        id: "plo-1",
        quantity: 15,
        updatedBy: "user-1"
      })
    ]);
  });

  it("deletes a Planned row no generated order matches, but keeps a held one", async () => {
    const { kinds, driver } = await write(
      [stored("plo-gone"), stored("plo-held", { periodId: "p3" })],
      [],
      ["plo-held"]
    );
    expect(kinds).toEqual(["lock", "select", "delete"]);
    expect(driver.rows.map((row) => row.id)).toEqual(["plo-held"]);
  });

  it("never touches a Firm or Converted row, even on the same natural key", async () => {
    const firm = stored("plo-firm", { status: "Firm", quantity: 99 });
    const converted = stored("plo-conv", {
      status: "Converted",
      periodId: "p3",
      jobId: "job-1"
    });
    const order = generated();
    const { idByKey, driver } = await write([firm, converted], [order]);
    expect(idByKey).toEqual(new Map([[order.naturalKey, "new-1"]]));
    expect(driver.rows.slice(0, 2)).toEqual([
      stored("plo-firm", { status: "Firm", quantity: 99 }),
      stored("plo-conv", {
        status: "Converted",
        periodId: "p3",
        jobId: "job-1"
      })
    ]);
  });
});

describe("diffPlannedOrders", () => {
  // jsonb drops a key whose value is undefined; read back, the trace must
  // still equal the generated one, or every run rewrites every row.
  it("reads a trace with an undefined value back as unchanged", () => {
    const order = generated({
      quantityTrace: {
        ...TRACE,
        triggerValues: { projectedStock: -10, reorderPoint: undefined }
      }
    });
    const { naturalKey: _key, ...values } = order;
    const diff = diffPlannedOrders({
      existing: [
        {
          ...values,
          id: "plo-1",
          quantityTrace: JSON.parse(JSON.stringify(order.quantityTrace))
        }
      ],
      generated: [order],
      heldPlannedOrderIds: new Set()
    });
    expect(diff).toEqual({
      inserts: [],
      updates: [],
      deleteIds: [],
      matchedIds: new Map([[order.naturalKey, "plo-1"]])
    });
  });
});
