import { beforeEach, describe, expect, it, vi } from "vitest";

// @carbon/glossary's terms.ts evaluates Lingui `msg` macros at module load,
// which vitest doesn't transform; the module graph pulls it in transitively.
vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn(),
  glossaryEntries: () => []
}));

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

// An in-memory stand-in for the Kysely transaction: enough of the query
// builder for these writers, plus an ordered log of reads, writes and locks so
// the tests can assert the issue lock is taken before anything else.
let tables: Tables;
let log: string[];

function matches(row: Row, filters: [string, string, unknown][]) {
  return filters.every(([column, op, value]) =>
    op === "in"
      ? (value as unknown[]).includes(row[column])
      : String(row[column]) === String(value)
  );
}

function query(table: string, kind: "select" | "update" | "insert") {
  const filters: [string, string, unknown][] = [];
  let patch: Row = {};
  let values: Row[] = [];
  let locked = false;

  const run = (): Row[] => {
    const rows = (tables[table] ??= []);
    if (kind === "insert") {
      log.push(`insert:${table}`);
      const inserted = values.map((v, i) => ({
        id: `${table}-${rows.length + i + 1}`,
        ...v
      }));
      rows.push(...inserted);
      return inserted;
    }
    const hit = rows.filter((r) => matches(r, filters));
    if (kind === "update") {
      log.push(`update:${table}`);
      for (const r of hit) Object.assign(r, patch);
      return hit;
    }
    log.push(`${locked ? "lock" : "read"}:${table}`);
    return hit;
  };

  const builder: any = {
    select: () => builder,
    returning: () => builder,
    set: (value: Row) => {
      patch = value;
      return builder;
    },
    values: (value: Row | Row[]) => {
      values = Array.isArray(value) ? value : [value];
      return builder;
    },
    where: (column: string, op: string, value: unknown) => {
      filters.push([column, op, value]);
      return builder;
    },
    forNoKeyUpdate: () => {
      locked = true;
      return builder;
    },
    execute: async () => run(),
    executeTakeFirst: async () => run()[0],
    executeTakeFirstOrThrow: async () => {
      const row = run()[0];
      if (!row) throw new Error("no result");
      return row;
    }
  };
  return builder;
}

const trx = {
  selectFrom: (table: string) => query(table, "select"),
  updateTable: (table: string) => query(table, "update"),
  insertInto: (table: string) => query(table, "insert")
};

vi.mock("~/services/database.server", () => ({
  getDatabaseClient: () => ({
    transaction: () => ({
      execute: async (fn: (t: typeof trx) => unknown) => fn(trx)
    })
  })
}));
vi.mock("./quality.server", () => ({
  errResult: (message: string) => ({ data: null, error: { message } })
}));

import {
  linkEntitiesToIssueItemRow,
  updateIssueItemQuantity
} from "./quality-disposition.server";

function seed(overrides: Partial<Tables> = {}) {
  tables = {
    nonConformance: [{ id: "nc-1", companyId: "c-1", status: "In Progress" }],
    nonConformanceItem: [
      {
        id: "nci-1",
        nonConformanceId: "nc-1",
        itemId: "item-1",
        quantity: 0,
        companyId: "c-1"
      }
    ],
    nonConformanceItemTrackedEntity: [],
    nonConformanceInspection: [],
    ...overrides
  };
  log = [];
}

const edit = (quantity: number, expectedQuantity: number) =>
  updateIssueItemQuantity({
    id: "nci-1",
    companyId: "c-1",
    userId: "u-1",
    quantity,
    expectedQuantity
  });

const itemRow = () => tables.nonConformanceItem[0];

beforeEach(() => seed());

describe("updateIssueItemQuantity", () => {
  it("locks the issue before checking links and writing", async () => {
    const result = await edit(5, 0);

    expect(result.error).toBeNull();
    expect(itemRow().quantity).toBe(5);
    const lockAt = log.indexOf("lock:nonConformance");
    expect(lockAt).toBeGreaterThan(-1);
    expect(log.indexOf("read:nonConformanceItemTrackedEntity")).toBeGreaterThan(
      lockAt
    );
    expect(log.indexOf("read:nonConformanceInspection")).toBeGreaterThan(
      lockAt
    );
    expect(log.indexOf("update:nonConformanceItem")).toBeGreaterThan(lockAt);
  });

  it("refuses an older save that completes after a newer one", async () => {
    const newer = await edit(7, 0);
    const older = await edit(5, 0);

    expect(newer.error).toBeNull();
    expect(older.error?.message).toMatch(/changed since the page loaded/);
    expect(itemRow().quantity).toBe(7);
  });

  it("refuses a row with linked tracked entities", async () => {
    seed({
      nonConformanceItemTrackedEntity: [
        {
          id: "l-1",
          nonConformanceItemId: "nci-1",
          nonConformanceId: "nc-1",
          trackedEntityId: "te-1",
          quantity: 1,
          companyId: "c-1"
        }
      ]
    });
    const result = await edit(4, 0);

    expect(result.error?.message).toMatch(/linked tracked entities/);
    expect(itemRow().quantity).toBe(0);
  });

  it("refuses an issue with an inspection link", async () => {
    seed({
      nonConformanceInspection: [
        { id: "i-1", nonConformanceId: "nc-1", companyId: "c-1" }
      ]
    });
    const result = await edit(4, 0);

    expect(result.error?.message).toMatch(/inspection lot/);
    expect(itemRow().quantity).toBe(0);
  });

  it("refuses a closed issue", async () => {
    seed({
      nonConformance: [{ id: "nc-1", companyId: "c-1", status: "Closed" }]
    });
    const result = await edit(4, 0);

    expect(result.error?.message).toMatch(/closed issue/);
    expect(itemRow().quantity).toBe(0);
  });
});

describe("linkEntitiesToIssueItemRow", () => {
  const link = (
    entities: { id: string; quantity: number }[],
    fallbackQuantity?: number
  ) =>
    linkEntitiesToIssueItemRow(trx as any, {
      nonConformanceId: "nc-1",
      companyId: "c-1",
      userId: "u-1",
      itemId: "item-1",
      entities,
      fallbackQuantity
    });

  it("grows the row quantity by the linked entities", async () => {
    await link([
      { id: "te-1", quantity: 2 },
      { id: "te-2", quantity: 3 }
    ]);

    expect(itemRow().quantity).toBe(5);
    expect(tables.nonConformanceItemTrackedEntity).toHaveLength(2);
  });

  it("skips entities already linked on the issue", async () => {
    seed({
      nonConformanceItemTrackedEntity: [
        {
          id: "l-1",
          nonConformanceItemId: "nci-other",
          nonConformanceId: "nc-1",
          trackedEntityId: "te-1",
          quantity: 2,
          companyId: "c-1"
        }
      ]
    });
    await link([
      { id: "te-1", quantity: 2 },
      { id: "te-2", quantity: 3 }
    ]);

    expect(itemRow().quantity).toBe(3);
    expect(tables.nonConformanceItemTrackedEntity).toHaveLength(2);
  });

  it("creates the row when the item has none", async () => {
    seed({ nonConformanceItem: [] });
    await link([{ id: "te-1", quantity: 4 }]);

    expect(tables.nonConformanceItem).toHaveLength(1);
    expect(itemRow().quantity).toBe(4);
  });

  it("uses the fallback quantity for an empty row with no entities", async () => {
    await link([], 12);

    expect(itemRow().quantity).toBe(12);
  });

  it("ignores the fallback when every entity is already linked", async () => {
    seed({
      nonConformanceItemTrackedEntity: [
        {
          id: "l-1",
          nonConformanceItemId: "nci-other",
          nonConformanceId: "nc-1",
          trackedEntityId: "te-1",
          quantity: 2,
          companyId: "c-1"
        }
      ]
    });
    await link([{ id: "te-1", quantity: 2 }], 12);

    expect(itemRow().quantity).toBe(0);
  });
});
