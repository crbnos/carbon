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
import { expect, it, vi } from "vitest";

// The function under test needs only the Kysely handle it is given; the
// rest of the module graph is stubbed, as in transfer-planning-actions.test.ts.
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

const { moveActionPegsToSupply } = await import("./projects.server");

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

const pegOnAction = (projectId: string, quantity: number) => ({
  planningGroupId: "plg_1",
  itemId: "item_1",
  locationId: "loc_1",
  supplyId: "pa_1",
  projectId,
  projectElementId: null,
  demandSourceType: "Project Material",
  demandSourceId: `pem_${projectId}`,
  parentPegId: null,
  quantity,
  needDate: "2026-11-02",
  state: "Soft"
});

it("supersedes an applied action's pegs and copies them onto its PO line", async () => {
  // the supersede returns the action's 2 pegs; the insert returns nothing
  const { db, driver } = database([
    [pegOnAction("prj_1", 20), pegOnAction("prj_2", 30)],
    []
  ]);
  const result = await moveActionPegsToSupply(db, {
    companyId: "c1",
    userId: "u1",
    moves: [
      {
        planningActionId: "pa_1",
        supplyType: "Purchase Order Line",
        supplyId: "pol_1"
      }
    ]
  });
  expect(result).toEqual({ moved: 2, error: null });

  const statements = driver.sent.map((query) => query.sql);
  const supersede = driver.sent.find((query) =>
    query.sql.startsWith('update "projectPeg"')
  );
  // never an in-place change of the peg: only the supersede columns
  expect(supersede?.sql).toContain('set "supersededAt" = now()');
  expect(supersede?.sql).toContain('"supersededAt" is null');
  expect(supersede?.parameters).toEqual(
    expect.arrayContaining(["c1", "Planning Action", "pa_1"])
  );

  const insert = driver.sent.find((query) =>
    query.sql.startsWith('insert into "projectPeg"')
  );
  expect(statements.filter((sql) => sql.startsWith("insert"))).toHaveLength(1);
  // both copies name the PO line, keep their project and quantity, and are
  // stamped by the planner who applied the order
  const parameters = insert?.parameters ?? [];
  expect(parameters.filter((value) => value === "pol_1")).toHaveLength(2);
  expect(
    parameters.filter((value) => value === "Purchase Order Line")
  ).toHaveLength(2);
  expect(parameters).toEqual(
    expect.arrayContaining(["prj_1", 20, "prj_2", 30, "u1"])
  );
  expect(parameters).not.toContain("pa_1");
});

it("sends nothing when no grouped order was applied", async () => {
  const { db, driver } = database([]);
  const result = await moveActionPegsToSupply(db, {
    companyId: "c1",
    userId: "u1",
    moves: []
  });
  expect(result).toEqual({ moved: 0, error: null });
  expect(driver.sent).toHaveLength(0);
});
