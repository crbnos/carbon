import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler
} from "kysely";
import { describe, expect, it } from "vitest";
import type { JobDatabase } from "../../../db";
import { terminalRunsQuery } from "./workflow-run-retention";

/** Compiles SQL without a connection — the passes below are pure query shape. */
const db = new Kysely<never>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (i) => new PostgresIntrospector(i),
    createQueryCompiler: () => new PostgresQueryCompiler()
  }
}) as unknown as JobDatabase;

const sqlFor = (stage?: "uncompacted" | "hasSteps") =>
  terminalRunsQuery(db, "2026-08-01T00:00:00.000Z", 500, stage).compile().sql;

describe("terminalRunsQuery", () => {
  it("orders oldest first so a backlog drains", () => {
    // Without this every pass re-reads the same unordered page each night.
    expect(sqlFor()).toContain(
      `order by COALESCE("completedAt", "createdAt") asc`
    );
  });

  it("narrows the compaction pass to runs not yet compacted", () => {
    expect(sqlFor("uncompacted")).toContain(`"compactedAt" is null`);
  });

  it("narrows the drop pass to compacted runs that still have steps", () => {
    const sql = sqlFor("hasSteps");
    // Both predicates are what make this pass advance: a run drops out of the
    // candidate set as soon as its step rows are gone.
    expect(sql).toContain(`"compactedAt" is not null`);
    expect(sql).toContain(`exists`);
    expect(sql).toContain(`from "workflowStepRun" as "step"`);
    expect(sql).toContain(`"step"."runId" = "workflowRun"."id"`);
    expect(sql).toContain(`"step"."companyId" = "workflowRun"."companyId"`);
  });

  it("does not gate the header purge on compaction", () => {
    // Headers age out at 90 days whether or not their steps were ever compacted.
    expect(sqlFor()).not.toContain(`"compactedAt"`);
  });
});
