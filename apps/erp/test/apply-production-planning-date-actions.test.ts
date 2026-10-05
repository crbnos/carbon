// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
import { describe, expect, it, vi } from "vitest";

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

const { applyProductionPlanningDateActions, nextJobPriority } = await import(
  "../app/modules/production/production.service"
);

// The Postgres wire is the boundary: each statement is recorded, and the rows
// "the database" answers with are chosen by what the statement is.
type Responder = (query: CompiledQuery) => unknown[];

class RecordingDriver extends DummyDriver {
  readonly sent: CompiledQuery[] = [];
  constructor(private readonly respond: Responder) {
    super();
  }
  override async acquireConnection(): Promise<DatabaseConnection> {
    return {
      executeQuery: async <R>(
        query: CompiledQuery
      ): Promise<QueryResult<R>> => {
        this.sent.push(query);
        return { rows: this.respond(query) as R[] };
      },
      // biome-ignore lint/correctness/useYield: never streamed
      streamQuery: async function* () {
        throw new Error("not streamed");
      }
    };
  }
}

function database(respond: Responder) {
  const driver = new RecordingDriver(respond);
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

const is = {
  claim: (q: CompiledQuery) =>
    /^update "planningAction" set "status" = \$1/.test(q.sql) &&
    q.parameters.includes("Actioned"),
  jobs: (q: CompiledQuery) =>
    /^select "id", "locationId", "deadlineType" from "job"/.test(q.sql),
  siblings: (q: CompiledQuery) =>
    /^select "id", "locationId", "dueDate", "priority", "deadlineType" from "job"/.test(
      q.sql
    ),
  dates: (q: CompiledQuery) => /UPDATE "job" AS j\s+SET "dueDate"/.test(q.sql),
  reopen: (q: CompiledQuery) =>
    /UPDATE "planningAction" AS a\s+SET "status" = 'Open'/.test(q.sql)
};

const ids = (rows: string[]) => rows.map((id) => ({ id }));
const scope = { companyId: "c1", userId: "u1" };

const moveA = {
  planningActionId: "a1",
  jobId: "job-a",
  suggestedDate: "2026-11-02"
};
const moveB = {
  planningActionId: "a2",
  jobId: "job-b",
  suggestedDate: "2026-11-02"
};

function everythingLands(q: CompiledQuery): unknown[] {
  if (is.claim(q)) return ids(["a1", "a2"]);
  if (is.jobs(q)) {
    return [
      { id: "job-a", locationId: "loc", deadlineType: "Soft Deadline" },
      { id: "job-b", locationId: "loc", deadlineType: "ASAP" }
    ];
  }
  if (is.siblings(q)) {
    // one job already on the target date
    return [
      {
        id: "job-x",
        locationId: "loc",
        dueDate: "2026-11-02",
        priority: 4,
        deadlineType: "Soft Deadline"
      }
    ];
  }
  if (is.dates(q)) return ids(["job-a", "job-b"]);
  return [];
}

describe("nextJobPriority", () => {
  it("starts at 0 with no siblings, goes after the last, or before a lower rank", () => {
    expect(nextJobPriority([], "Soft Deadline")).toBe(0);
    expect(
      nextJobPriority(
        [{ priority: 4, deadlineType: "Soft Deadline" }],
        "Soft Deadline"
      )
    ).toBe(5);
    expect(
      nextJobPriority([{ priority: 4, deadlineType: "Soft Deadline" }], "ASAP")
    ).toBe(2);
    expect(
      nextJobPriority(
        [
          { priority: 2, deadlineType: "ASAP" },
          { priority: 4, deadlineType: "Soft Deadline" }
        ],
        "Hard Deadline"
      )
    ).toBe(3);
  });
});

describe("applyProductionPlanningDateActions", () => {
  it("claims, reads twice and writes every date and priority in one statement", async () => {
    const { db, driver } = database(everythingLands);
    const result = await applyProductionPlanningDateActions(db, {
      ...scope,
      actions: [moveA, moveB]
    });
    expect(result).toEqual({
      applied: ["a1", "a2"],
      alreadyApplied: [],
      refused: []
    });
    expect(driver.sent.filter(is.claim)).toHaveLength(1);
    expect(driver.sent.filter(is.jobs)).toHaveLength(1);
    expect(driver.sent.filter(is.siblings)).toHaveLength(1);
    expect(driver.sent.filter(is.dates)).toHaveLength(1);
    expect(driver.sent).toHaveLength(4);
  });

  // job-a (Soft Deadline) goes after the sibling at 4 → 5; job-b (ASAP) goes
  // before both → half of the first priority, 2. Each placement sees the one
  // before it, as the sequential writes did.
  it("ranks moved jobs among the jobs already on the date, in turn", async () => {
    const { db, driver } = database(everythingLands);
    await applyProductionPlanningDateActions(db, {
      ...scope,
      actions: [moveA, moveB]
    });
    const write = driver.sent.find(is.dates)!;
    expect(write.parameters).toEqual(
      expect.arrayContaining(["job-a", "2026-11-02", 5, "job-b", 2])
    );
    expect(write.parameters).toEqual(
      expect.arrayContaining(["Draft", "Planned", "c1"])
    );
  });

  it("leaves an action another apply already claimed alone", async () => {
    const { db, driver } = database((q) =>
      is.claim(q) ? ids(["a2"]) : everythingLands(q)
    );
    const result = await applyProductionPlanningDateActions(db, {
      ...scope,
      actions: [moveA, moveB]
    });
    expect(result.alreadyApplied).toEqual(["a1"]);
    expect(result.applied).toEqual(["a2"]);
    const write = driver.sent.find(is.dates)!;
    expect(write.parameters).not.toContain("job-a");
  });

  // job-a was released to the floor after the page loaded: the guarded UPDATE
  // leaves it, and its action goes back to Open for review.
  it("un-claims an action whose job left Draft / Planned", async () => {
    const { db, driver } = database((q) => {
      if (is.dates(q)) return ids(["job-b"]);
      if (is.reopen(q)) return ids(["a1"]);
      return everythingLands(q);
    });
    const result = await applyProductionPlanningDateActions(db, {
      ...scope,
      actions: [moveA, moveB]
    });
    expect(result.refused).toEqual([{ id: "a1", jobId: "job-a" }]);
    expect(result.applied).toEqual(["a2"]);
    expect(driver.sent.find(is.reopen)!.parameters).toEqual(
      expect.arrayContaining(["a1", "c1"])
    );
  });

  it("sends nothing for an empty batch", async () => {
    const { db, driver } = database(everythingLands);
    await applyProductionPlanningDateActions(db, { ...scope, actions: [] });
    expect(driver.sent).toHaveLength(0);
  });
});
