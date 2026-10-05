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
  type PlanningActionDiff,
  writePlanningActionDiff
} from "./planning-actions";

// The Postgres wire is the boundary: every statement the writer sends is
// recorded as compiled SQL with its parameters.
class RecordingDriver extends DummyDriver {
  readonly sent: CompiledQuery[] = [];
  override async acquireConnection(): Promise<DatabaseConnection> {
    return {
      executeQuery: async <R>(
        query: CompiledQuery
      ): Promise<QueryResult<R>> => {
        this.sent.push(query);
        return { rows: [] };
      },
      // biome-ignore lint/correctness/useYield: never streamed
      streamQuery: async function* () {
        throw new Error("not streamed");
      }
    };
  }
}

function database() {
  const driver = new RecordingDriver();
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

const emptyDiff: PlanningActionDiff = {
  inserts: [],
  updates: [],
  deleteIds: []
};

async function write(diff: Partial<PlanningActionDiff>) {
  const { db, driver } = database();
  await writePlanningActionDiff(db, {
    companyId: "c1",
    userId: "u1",
    diff: { ...emptyDiff, ...diff },
    updatedAt: "2026-10-06T00:00:00.000Z"
  });
  return driver.sent;
}

describe("writePlanningActionDiff", () => {
  // The run reads the actions, then writes its diff. A row applied in between
  // was deleted, or reopened by a `status: "Open"` patch.
  it("never deletes an applied action", async () => {
    const [statement] = await write({ deleteIds: ["a1", "a2"] });
    expect(statement?.sql).toMatch(/^delete from "planningAction"/);
    expect(statement?.sql).toContain('"status" != $');
    expect(statement?.parameters).toContain("Actioned");
    expect(statement?.parameters).toContain("c1");
  });

  it("never updates an applied action", async () => {
    const [statement] = await write({
      updates: [{ id: "a1", patch: { status: "Open" } }]
    });
    expect(statement?.sql).toContain(`t."status" <> 'Actioned'`);
    expect(statement?.sql).toContain(`t."companyId" = $`);
  });

  // One UPDATE per row was thousands of round trips on the weekly roll.
  it("sends one statement per set of changed columns, not per row", async () => {
    const sent = await write({
      updates: [
        { id: "a1", patch: { periodId: "p2" } },
        { id: "a2", patch: { periodId: "p3" } },
        { id: "a3", patch: { periodId: "p4" } },
        { id: "a4", patch: { suggestedQuantity: 12, status: "Open" } }
      ]
    });
    expect(sent).toHaveLength(2);

    const periodOnly = sent.find((q) => !q.sql.includes("suggestedQuantity"));
    expect(periodOnly?.sql).toContain(`"periodId" = v."periodId"::text`);
    expect(periodOnly?.parameters).toEqual(
      expect.arrayContaining(["a1", "p2", "a2", "p3", "a3", "p4"])
    );

    const reopen = sent.find((q) => q.sql.includes("suggestedQuantity"));
    expect(reopen?.sql).toContain(
      `"status" = v."status"::"planningActionStatus"`
    );
    expect(reopen?.sql).toContain(
      `"suggestedQuantity" = v."suggestedQuantity"::numeric`
    );
    // Only the patched columns: a period-only row keeps its stored quantity.
    expect(periodOnly?.sql).not.toContain("suggestedQuantity");
  });

  it("writes trigger values as JSON", async () => {
    const [statement] = await write({
      updates: [{ id: "a1", patch: { triggerValues: { reorderPoint: 5 } } }]
    });
    expect(statement?.sql).toContain(`"triggerValues"::jsonb`);
    expect(statement?.parameters).toContain('{"reorderPoint":5}');
  });

  it("refuses a patch column it has no type for, before writing", async () => {
    const { db, driver } = database();
    await expect(
      writePlanningActionDiff(db, {
        companyId: "c1",
        userId: "u1",
        diff: { ...emptyDiff, updates: [{ id: "a1", patch: { bogus: 1 } }] },
        updatedAt: "2026-10-06T00:00:00.000Z"
      })
    ).rejects.toThrow(/bogus/);
    expect(driver.sent).toHaveLength(0);
  });
});
