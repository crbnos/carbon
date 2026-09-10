import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// Regression guards for the Job Operation Batching migration (#1010). These read
// the migration text directly — no DB, no app imports (the ERP barrels drag
// lingui `msg` macros vitest does not transform). They pin the correctness
// properties of the batch candidate RPC and the batch status enum. The feature
// ships as ONE consolidated migration (v2), so everything is asserted against it.

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

const migration = read("20260905132037_job-operation-batching.sql");

describe("get_batchable_operations is tenant-scoped via RLS", () => {
  test("the candidate RPC runs as SECURITY INVOKER so the caller's RLS applies", () => {
    // SECURITY INVOKER is what scopes candidates to the caller's company — the
    // function itself takes no companyId, so a DEFINER function would leak every
    // company's operations.
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION get_batchable_operations[\s\S]*?SECURITY INVOKER/
    );
  });
});

describe("started operations are excluded from batch candidates", () => {
  test("the RPC adds a NOT EXISTS productionEvent guard", () => {
    expect(migration).toMatch(
      /NOT EXISTS\s*\([\s\S]*?FROM "productionEvent" pe[\s\S]*?pe\."jobOperationId"\s*=\s*jo\."id"/
    );
  });

  test("the lane branch renders Active AND Completing batches (read-only Completing)", () => {
    // The board shows Active batches (drag targets) and Completing batches
    // (read-only, awaiting a retry in MES). Both must appear as lanes. The
    // consolidated migration also renders the pre-floor 'Planned' state, which
    // this assertion allows without letting Active/Completing drop out.
    expect(migration).toMatch(
      /OR b\."status"\s+IN\s*\('Planned',\s*'Active',\s*'Completing'\)/
    );
  });
});

describe("batch status enum", () => {
  test("is Planned/Active/Completing/Completed with Completing from day one", () => {
    // 'Planned' (pre-floor planning) joined the enum in the consolidated
    // migration; 'Completing' still ships in the same CREATE TYPE rather than
    // being bolted on by a later ALTER, which is what this pins.
    expect(migration).toMatch(
      /CREATE TYPE "jobOperationBatchStatus" AS ENUM \('Planned', 'Active', 'Completing', 'Completed'\)/
    );
  });

  test("has no Cancelled value (dissolve deletes the row instead)", () => {
    // A dead enum state forces unreachable UI branches and cannot be removed
    // later. The enum declaration must not contain 'Cancelled'.
    const enumDecl = migration.match(
      /CREATE TYPE "jobOperationBatchStatus" AS ENUM \([^)]*\)/
    );
    expect(enumDecl).not.toBeNull();
    expect(enumDecl?.[0]).not.toContain("Cancelled");
  });
});
