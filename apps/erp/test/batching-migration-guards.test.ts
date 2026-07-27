import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// Regression guards for the Job Operation Batching migrations (#1010). These read
// the migration + service text directly — no DB, no app imports (the ERP barrels
// drag lingui `msg` macros vitest does not transform). They pin the correctness
// properties of the batch candidate RPC and the resumable-completion status.

const migrations = join(
  process.cwd(),
  "..",
  "..",
  "packages",
  "database",
  "supabase",
  "migrations"
);
const read = (rel: string) => readFileSync(join(migrations, rel), "utf8");

describe("get_batchable_operations is tenant-scoped via RLS", () => {
  const base = read("20260707135312_job-operation-batching.sql");

  test("the candidate RPC runs as SECURITY INVOKER so the caller's RLS applies", () => {
    // SECURITY INVOKER is what scopes candidates to the caller's company — the
    // function itself takes no companyId, so a DEFINER function would leak every
    // company's operations.
    expect(base).toMatch(
      /CREATE OR REPLACE FUNCTION get_batchable_operations[\s\S]*?SECURITY INVOKER/
    );
  });
});

describe("started operations are excluded from batch candidates", () => {
  const guard = read("20260716120250_batchable-operations-rpc-started-guard.sql");

  test("the RPC re-declaration adds a NOT EXISTS productionEvent guard", () => {
    expect(guard).toMatch(
      /NOT EXISTS\s*\([\s\S]*?FROM "productionEvent" pe[\s\S]*?pe\."jobOperationId"\s*=\s*jo\."id"/
    );
  });

  test("the guard is scoped to the unbatched branch, not batched members", () => {
    // b.status = 'Active' (already-batched) rows must still be returned.
    expect(guard).toMatch(/OR b\."status"\s*=\s*'Active'/);
  });
});

describe("resumable completion status", () => {
  const completing = read(
    "20260716115259_job-operation-batch-completing-status.sql"
  );

  test("adds a 'Completing' value before 'Completed'", () => {
    expect(completing).toMatch(
      /ALTER TYPE "jobOperationBatchStatus" ADD VALUE IF NOT EXISTS 'Completing' BEFORE 'Completed'/
    );
  });
});
