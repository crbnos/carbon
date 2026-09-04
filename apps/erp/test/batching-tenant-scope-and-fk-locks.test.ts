import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// Tenant-isolation regression guards for Job Operation Batching (#1010).
// Originally from PR #1137; rewritten for the v2 consolidated migration, which
// scopes candidates via SECURITY INVOKER + RLS (not a company_id parameter) and
// pins batch membership to a company via COMPOSITE tenant FKs. The property
// protected is the same: a batch and its members can never cross a tenant
// boundary. Reads the migration + service text directly — no DB, no app imports
// (the ERP barrels drag lingui `msg` macros vitest does not transform).

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
const migration = read("20260821024449_job-operation-batching.sql");
const memberFkFix = read(
  "20260904151137_batch-member-fk-set-null-companyid.sql"
);

describe("batch candidates are tenant-scoped (AC[0])", () => {
  test("get_batchable_operations runs SECURITY INVOKER so the caller's RLS scopes rows", () => {
    // The function takes no company_id; SECURITY INVOKER means the caller's RLS
    // on jobOperation/job restricts candidates to their own company. A DEFINER
    // function would leak every company's operations.
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION get_batchable_operations[\s\S]*?SECURITY INVOKER/
    );
  });

  test("the JS wrapper passes location + process (no cross-tenant id)", () => {
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
    expect(service).toMatch(/location_id:\s*args\.locationId/);
    expect(service).toMatch(/process_id:\s*args\.processId/);
  });
});

describe("batch membership is pinned to one company via composite FKs", () => {
  test("jobOperation + productionEvent membership FKs carry companyId into the reference", () => {
    // A member operation (or its timer) can only join a batch in the SAME
    // company — the FK references ("id", "companyId"), not just ("id").
    expect(migration).toMatch(
      /ADD CONSTRAINT "jobOperation_jobOperationBatchId_fkey"\s*FOREIGN KEY \("jobOperationBatchId", "companyId"\)\s*REFERENCES "jobOperationBatch"\("id", "companyId"\)/s
    );
    expect(migration).toMatch(
      /ADD CONSTRAINT "productionEvent_jobOperationBatchId_fkey"\s*FOREIGN KEY \("jobOperationBatchId", "companyId"\)\s*REFERENCES "jobOperationBatch"\("id", "companyId"\)/s
    );
  });

  test("member FKs SET NULL only jobOperationBatchId, not the NOT NULL companyId", () => {
    // A column-list-less `ON DELETE SET NULL` on a multi-column FK nulls EVERY
    // referencing column, including the NOT NULL `companyId` — so deleting a
    // batch (or a `DELETE FROM company` cascade) would raise a not-null
    // violation. The PG15 column-list form nulls ONLY the batch pointer.
    // 20260904151137 fixes both member FKs to this form.
    expect(memberFkFix).toMatch(
      /ADD CONSTRAINT "jobOperation_jobOperationBatchId_fkey"[\s\S]*?ON DELETE SET NULL \("jobOperationBatchId"\)/
    );
    expect(memberFkFix).toMatch(
      /ADD CONSTRAINT "productionEvent_jobOperationBatchId_fkey"[\s\S]*?ON DELETE SET NULL \("jobOperationBatchId"\)/
    );
  });

  test("jobOperationBatch has a composite tenant PK and companyId FK", () => {
    expect(migration).toMatch(
      /PRIMARY KEY \("id", "companyId"\)/
    );
    expect(migration).toMatch(
      /"jobOperationBatch_companyId_fkey" FOREIGN KEY \("companyId"\)\s*REFERENCES "company"\("id"\)/s
    );
  });

  test("RLS gates reads to employees and mutations to production permissions", () => {
    expect(migration).toMatch(
      /CREATE POLICY "SELECT" ON "public"\."jobOperationBatch"[\s\S]*?get_companies_with_employee_role\(\)/
    );
    for (const action of ["create", "update", "delete"]) {
      expect(migration).toMatch(
        new RegExp(
          `get_companies_with_employee_permission\\('production_${action}'\\)`
        )
      );
    }
  });
});
