import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// PR #1137 review regression guards (issue #1010 Work Order Batching).
// These assert the SQL/JS that closes two review findings stays in place:
//   AC[0] get_batchable_operations is company-scoped (cross-tenant leak fix)
//   AC[9] the new large-table FKs are added NOT VALID with the VALIDATE in a
//         SEPARATE migration (so ADD does not scan jobOperation/productionEvent
//         under an ACCESS EXCLUSIVE lock).
// They read the migration + service text directly — no DB, no app imports (the
// ERP barrels drag lingui `msg` macros that vitest does not transform).

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

describe("get_batchable_operations is tenant-scoped (AC[0])", () => {
  const sql = read("20260714013500_batchable-operations-rpc.sql");

  test("declares a company_id parameter", () => {
    // Fails before the fix: the function took only `location_id`.
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION get_batchable_operations\([^)]*company_id\s+TEXT/s);
  });

  test("filters the candidate jobOperations and jobs by company_id", () => {
    expect(sql).toMatch(/jo\."companyId"\s*=\s*company_id/);
    expect(sql).toMatch(/"job"\."companyId"\s*=\s*company_id/);
  });

  test("the JS wrapper forwards companyId to the RPC", () => {
    const service = readFileSync(
      join(
        process.cwd(),
        "app",
        "modules",
        "production",
        "production.service.ts"
      ),
      "utf8"
    );
    // The wrapper signature and the rpc arg must both carry company_id.
    expect(service).toMatch(
      /getBatchableOperations\(\s*client:\s*SupabaseClient<Database>,\s*locationId:\s*string,\s*companyId:\s*string/s
    );
    expect(service).toMatch(/company_id:\s*companyId/);
  });
});

describe("batching FKs avoid table locks (AC[9])", () => {
  const batching = read("20260714012050_job-operation-batching.sql");
  const validate = read("20260714012100_batching-fk-validate.sql");

  test("jobOperation + productionEvent membership FKs are added NOT VALID", () => {
    expect(batching).toMatch(
      /ADD CONSTRAINT "jobOperation_jobOperationBatchId_fkey"[^;]*NOT VALID/s
    );
    expect(batching).toMatch(
      /ADD CONSTRAINT "productionEvent_jobOperationBatchId_fkey"[^;]*NOT VALID/s
    );
  });

  test("the batching migration does NOT validate the large-table FKs inline", () => {
    // The whole point of the separate step: a same-file VALIDATE would keep the
    // ADD's exclusive lock through the scan.
    expect(batching).not.toMatch(
      /VALIDATE CONSTRAINT "jobOperation_jobOperationBatchId_fkey"/
    );
    expect(batching).not.toMatch(
      /VALIDATE CONSTRAINT "productionEvent_jobOperationBatchId_fkey"/
    );
  });

  test("a separate migration validates both large-table FKs", () => {
    expect(validate).toMatch(
      /VALIDATE CONSTRAINT "jobOperation_jobOperationBatchId_fkey"/
    );
    expect(validate).toMatch(
      /VALIDATE CONSTRAINT "productionEvent_jobOperationBatchId_fkey"/
    );
  });

  test("composite tenant FKs pin a batch's resources to its company", () => {
    for (const c of ["processId", "workCenterId", "locationId"]) {
      expect(batching).toMatch(
        new RegExp(
          `ADD CONSTRAINT "jobOperationBatch_${c}_fkey"\\s*FOREIGN KEY \\("${c}", "companyId"\\)`,
          "s"
        )
      );
    }
  });
});
