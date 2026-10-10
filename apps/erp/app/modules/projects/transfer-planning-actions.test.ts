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

// The function under test needs only the Kysely handle it is given; the
// rest of the module graph is stubbed, as in production.service.test.ts.
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
vi.mock("~/services/database.server", () => ({ getDatabaseClient: vi.fn() }));
vi.mock("@carbon/server-functions", () => ({ serverFns: {} }));
vi.mock("~/modules/items/items.service", () => ({ getMethodTree: vi.fn() }));

const { createProjectStockTransfersFromActions } = await import(
  "./projects.server"
);

// The Postgres wire is the boundary: each statement is recorded, and the
// driver answers it with the next scripted result.
class ScriptedDriver extends DummyDriver {
  readonly sent: CompiledQuery[] = [];
  constructor(private readonly results: unknown[][]) {
    super();
  }
  override async acquireConnection(): Promise<DatabaseConnection> {
    return {
      executeQuery: async <R>(
        query: CompiledQuery
      ): Promise<QueryResult<R>> => {
        this.sent.push(query);
        return { rows: (this.results.shift() ?? []) as R[] };
      },
      // biome-ignore lint/correctness/useYield: never streamed
      streamQuery: async function* () {
        throw new Error("not streamed");
      }
    };
  }
}

function database(results: unknown[][]) {
  const driver = new ScriptedDriver(results);
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

describe("createProjectStockTransfersFromActions", () => {
  it("claims the action and creates a Draft transfer with one line", async () => {
    const { db, driver } = database([
      // the claim
      [{ id: "a1", suggestedDate: "2026-10-11", suggestedQuantity: 8 }],
      // the action
      [
        {
          id: "a1",
          type: "Transfer",
          itemId: "i1",
          locationId: "l1",
          fromProjectId: null,
          toProjectId: "prj_1",
          reason: "Common stock not needed within the horizon"
        }
      ],
      // the readable ids
      [{ id: "PST-000001" }],
      // the header
      [
        {
          id: "pst_1",
          planningActionId: "a1",
          projectStockTransferId: "PST-000001"
        }
      ]
    ]);

    const result = await createProjectStockTransfersFromActions(db, {
      companyId: "c1",
      userId: "u1",
      planningActionIds: ["a1"]
    });

    expect(result).toEqual({
      created: [
        {
          planningActionId: "a1",
          id: "pst_1",
          projectStockTransferId: "PST-000001"
        }
      ],
      alreadyApplied: [],
      error: null
    });

    const [claim, , sequence, header, line, link] = driver.sent;
    expect(claim?.sql).toMatch(/^update "planningAction"/);
    expect(claim?.parameters).toContain("Actioned");
    expect(sequence?.sql).toContain("get_next_sequence('projectStockTransfer'");
    expect(header?.sql).toMatch(/^insert into "projectStockTransfer"/);
    expect(header?.parameters).toEqual(
      expect.arrayContaining(["Transfer", "prj_1", "l1", "a1", "PST-000001"])
    );
    expect(line?.sql).toMatch(/^insert into "projectStockTransferLine"/);
    // the quantity as it is at the claim
    expect(line?.parameters).toEqual(expect.arrayContaining(["i1", 8]));
    expect(link?.sql).toContain(`SET "projectStockTransferId"`);
  });

  // The claim is the lock: an action another apply took first gets nothing.
  it("creates nothing for an action already applied", async () => {
    const { db, driver } = database([[]]);

    const result = await createProjectStockTransfersFromActions(db, {
      companyId: "c1",
      userId: "u1",
      planningActionIds: ["a1"]
    });

    expect(result).toEqual({
      created: [],
      alreadyApplied: ["a1"],
      error: null
    });
    expect(driver.sent).toHaveLength(1);
  });
});
