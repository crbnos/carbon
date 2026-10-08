// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase } from "@carbon/database/client";
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
import { describe, expect, it, vi } from "vitest";
import type { PlanningActionKind } from "./production.service";

// Same module-graph stubs as production.service.test.ts: the functions under
// test need neither the glossary nor the Lingui macro.
vi.mock("@carbon/content/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn(),
  glossaryEntries: () => []
}));
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray | string, ...values: unknown[]) =>
    Array.isArray(strings)
      ? strings.reduce(
          (acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ""),
          ""
        )
      : String(strings)
}));

const {
  assignPlanningActions,
  dismissPlanningActions,
  getPlanningActionsByIds,
  markPlanningActionsActioned,
  reopenDismissedPlanningActions,
  settleNewSupplyPlanningActions
} = await import("./production.service");

// The Postgres wire is the boundary: every statement is recorded as compiled
// SQL with its parameters, and the rows the database would have changed come
// back as the result.
class RecordingDriver extends DummyDriver {
  readonly sent: CompiledQuery[] = [];
  constructor(private readonly rows: unknown[] = []) {
    super();
  }
  override async acquireConnection(): Promise<DatabaseConnection> {
    return {
      executeQuery: async <R>(
        query: CompiledQuery
      ): Promise<QueryResult<R>> => {
        this.sent.push(query);
        return { rows: this.rows as R[] };
      },
      // biome-ignore lint/correctness/useYield: never streamed
      streamQuery: async function* () {
        throw new Error("not streamed");
      }
    };
  }
}

function database(changedIds: string[] = []) {
  const driver = new RecordingDriver(changedIds.map((id) => ({ id })));
  const db = new Kysely<KyselyDatabase>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler()
    }
  });
  return { db, driver };
}

const args = {
  ids: ["a1", "a2", "a3"],
  companyId: "c1",
  userId: "u1",
  kind: "Make" as PlanningActionKind
};

// The routes reported the ids they were SENT ("Dismissed 5") while the update
// skipped rows that had changed since the page loaded.
describe("planning action worklist writes return the rows they changed", () => {
  it("dismiss changes only Open rows and returns their ids", async () => {
    const { db, driver } = database(["a1"]);
    const result = await dismissPlanningActions(db, args);
    expect(result).toEqual({ data: [{ id: "a1" }], error: null });
    const [statement] = driver.sent;
    expect(statement?.sql).toMatch(/^update "planningAction"/);
    expect(statement?.sql).toContain('"status" = $');
    expect(statement?.sql).toContain('returning "id"');
    expect(statement?.parameters).toContain("Open");
    expect(statement?.parameters).toContain("c1");
  });

  it("reopen changes only Dismissed rows and returns their ids", async () => {
    const { db, driver } = database(["a2"]);
    const result = await reopenDismissedPlanningActions(db, args);
    expect(result).toEqual({ data: [{ id: "a2" }], error: null });
    expect(driver.sent[0]?.parameters).toContain("Dismissed");
  });

  // Assign had no status condition: it re-owned actions already applied.
  it("assign never changes an applied action", async () => {
    const { db, driver } = database(["a1", "a3"]);
    const result = await assignPlanningActions(db, {
      ...args,
      assignee: "u2"
    });
    expect(result).toEqual({ data: [{ id: "a1" }, { id: "a3" }], error: null });
    const [statement] = driver.sent;
    expect(statement?.sql).toContain('"status" in ($');
    expect(statement?.parameters).toEqual(
      expect.arrayContaining(["Open", "Dismissed", "c1"])
    );
    expect(statement?.parameters).not.toContain("Actioned");
  });

  // The claim is the lock of the apply path: only Open rows flip, in ONE
  // statement, and the caller gets back exactly the rows it now holds.
  it("claim flips only Open rows to Actioned in one statement", async () => {
    const { db, driver } = database(["a1"]);
    const result = await markPlanningActionsActioned(db, args);
    expect(result).toEqual({ data: [{ id: "a1" }], error: null });
    expect(driver.sent).toHaveLength(1);
    expect(driver.sent[0]?.parameters).toEqual(
      expect.arrayContaining(["Actioned", "Open", "c1", "a1", "a2", "a3"])
    );
  });

  // The writes run past row-level security, so the page's permission was the
  // only check: a purchasing user could dismiss production's actions by id.
  it.each([
    ["dismiss", dismissPlanningActions],
    ["reopen", reopenDismissedPlanningActions],
    [
      "assign",
      (db: Kysely<KyselyDatabase>, a: typeof args) =>
        assignPlanningActions(db, { ...a, assignee: "u2" })
    ]
  ] as const)("%s writes only its own page's actions", async (_, write) => {
    const make = database(["a1"]);
    await write(make.db, args);
    expect(make.driver.sent[0]?.sql).toContain('"jobId" is not null');
    expect(make.driver.sent[0]?.sql).not.toContain('"purchaseOrderLineId"');
    expect(make.driver.sent[0]?.parameters).toContain("Make");

    const buy = database(["a1"]);
    await write(buy.db, { ...args, kind: "Buy" });
    expect(buy.driver.sent[0]?.sql).toContain(
      '"purchaseOrderLineId" is not null'
    );
    expect(buy.driver.sent[0]?.sql).not.toContain('"jobId"');
    expect(buy.driver.sent[0]?.parameters).toContain("Order");
  });

  it("sends nothing for an empty id list", async () => {
    const { db, driver } = database();
    const result = await dismissPlanningActions(db, { ...args, ids: [] });
    expect(result).toEqual({ data: [], error: null });
    expect(driver.sent).toHaveLength(0);
  });
});

// Apply read each action on its own; a batch of N is now one statement — and
// the ids travel as parameters, never in a PostgREST URL, so a bulk Apply on a
// page of busy items (hundreds of ids) cannot overrun the gateway.
describe("getPlanningActionsByIds", () => {
  it("reads the whole batch in one company-scoped statement", async () => {
    const ids = Array.from({ length: 500 }, (_, i) => `a${i}`);
    const { db, driver } = database();
    const result = await getPlanningActionsByIds(db, { ids, companyId: "c1" });
    expect(result).toEqual({ data: [], error: null });
    expect(driver.sent).toHaveLength(1);
    const [statement] = driver.sent;
    expect(statement?.sql).toMatch(/^select \* from "planningAction"/);
    expect(statement?.sql).toContain('"id" in (');
    expect(statement?.parameters).toContain("c1");
    expect(statement?.parameters).toEqual(expect.arrayContaining(ids));
  });

  it("reports a failed read instead of throwing", async () => {
    const { db } = database();
    const failing = db.withPlugin({
      transformQuery: (args) => args.node,
      transformResult: async () => {
        throw new Error("connection refused");
      }
    });
    const result = await getPlanningActionsByIds(failing, {
      ids: ["a1"],
      companyId: "c1"
    });
    expect(result).toEqual({
      data: null,
      error: { message: "connection refused" }
    });
  });
});

// The page's Order button raised PO lines and jobs but never touched the
// suggestions they answered, which stayed Open on the page until the next MRP
// run re-derived the worklist.
describe("settleNewSupplyPlanningActions", () => {
  const settle = {
    companyId: "c1",
    locationId: "l1",
    userId: "u1",
    type: "Order" as const
  };

  it("settles each ordered (item, week) in one statement", async () => {
    const { db, driver } = database(["a1", "a2"]);
    const result = await settleNewSupplyPlanningActions(db, {
      ...settle,
      ordered: [
        { itemId: "i1", periodId: "p1" },
        { itemId: "i1", periodId: "p1" },
        { itemId: "i2", periodId: "p2" }
      ]
    });
    expect(result).toEqual({ data: [{ id: "a1" }, { id: "a2" }], error: null });
    expect(driver.sent).toHaveLength(1);
    const [statement] = driver.sent;
    expect(statement?.sql).toMatch(/^update "planningAction"/);
    // pairs, never a cross product: ordering i1 in p1 and i2 in p2 must not
    // settle i1's p2 suggestion
    expect(statement?.sql).toContain(
      '("itemId" = $9 and "periodId" = $10) or ("itemId" = $11 and "periodId" = $12)'
    );
    expect(statement?.parameters).toEqual([
      "Actioned",
      "u1",
      expect.any(String),
      "c1",
      "l1",
      "Order",
      "Open",
      "Dismissed",
      "i1",
      "p1",
      "i2",
      "p2"
    ]);
  });

  it("sends nothing when no order was placed", async () => {
    const { db, driver } = database();
    const result = await settleNewSupplyPlanningActions(db, {
      ...settle,
      ordered: []
    });
    expect(result).toEqual({ data: [], error: null });
    expect(driver.sent).toHaveLength(0);
  });
});
