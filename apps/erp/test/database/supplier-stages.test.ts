// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack; skipped without one. Supplier stages: who
// reads them, and what deleting one leaves behind.

import { sql } from "kysely";
import { expect, vi } from "vitest";
import { fixture, type PurchasingFixture, test } from "./fixtures/purchasing";

// Approval rules are a commercial feature, off in the community edition that
// an unset CARBON_EDITION reads as. Set before @carbon/env is imported.
vi.hoisted(() => {
  process.env.CARBON_EDITION = "enterprise";
});

const purchasing = await import(
  "../../app/modules/purchasing/purchasing.server"
);

// Rolled back: sets the role and JWT the app's real caller has, so RLS applies.
async function asUser<T>(
  f: PurchasingFixture,
  userId: string,
  read: (trx: typeof f.db) => Promise<T>
) {
  let result: T | undefined;
  await f.db
    .transaction()
    .execute(async (trx) => {
      await sql`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`.execute(
        trx
      );
      await sql`SET LOCAL ROLE authenticated`.execute(trx);
      result = await read(trx);
      throw new Error("rollback");
    })
    .catch((error: Error) => {
      if (error.message !== "rollback") throw error;
    });
  return result as T;
}

test("only an employee of the company reads its stages", async () => {
  const f = await fixture();
  const portalUser = crypto.randomUUID();
  const employee = crypto.randomUUID();
  const ownEmployee = crypto.randomUUID();
  try {
    await sql`
      INSERT INTO "supplierStage" (id, name, "companyId", "createdBy")
      VALUES (${`${f.ids.supplier}-stage`}, 'Sampling', ${f.companyId}, 'system')
    `.execute(f.db);
    await sql`
      INSERT INTO "user" (id, email, "firstName", "lastName") VALUES
        (${portalUser}, ${`${portalUser}@example.test`}, 'Portal', 'User'),
        (${employee}, ${`${employee}@example.test`}, 'Other', 'Employee'),
        (${ownEmployee}, ${`${ownEmployee}@example.test`}, 'Own', 'Employee')
    `.execute(f.db);
    await sql`
      INSERT INTO "userToCompany" ("userId", "companyId", role) VALUES
        (${portalUser}, ${f.companyId}, 'supplier'),
        (${employee}, ${f.otherCompanyId}, 'employee'),
        (${ownEmployee}, ${f.companyId}, 'employee')
    `.execute(f.db);

    const stages = (trx: typeof f.db) =>
      trx
        .selectFrom("supplierStage")
        .select("id")
        .where("companyId", "=", f.companyId)
        .execute();

    // The positive read proves the policies exist and the caller is applied:
    // with no policy, or no user, every read is empty.
    expect(await asUser(f, ownEmployee, stages)).toEqual([
      { id: `${f.ids.supplier}-stage` }
    ]);
    expect(await asUser(f, portalUser, stages)).toEqual([]);
    expect(await asUser(f, employee, stages)).toEqual([]);
  } finally {
    await sql`
      DELETE FROM "user" WHERE id IN (${portalUser}, ${employee}, ${ownEmployee})
    `.execute(f.db);
    await f.cleanup();
  }
});

test("deleting a stage clears it and leaves the supplier status", async () => {
  const f = await fixture();
  try {
    const stage = `${f.ids.supplier}-stage`;
    await sql`
      INSERT INTO "supplierStage" (id, name, "companyId", "createdBy")
      VALUES (${stage}, 'Sampling', ${f.companyId}, 'system')
    `.execute(f.db);
    await sql`
      UPDATE "supplier" SET "supplierStageId" = ${stage}, "supplierStatus" = 'Pending'
      WHERE id = ${f.ids.supplier}
    `.execute(f.db);

    await sql`DELETE FROM "supplierStage" WHERE id = ${stage}`.execute(f.db);

    const supplier = await f.db
      .selectFrom("supplier")
      .select(["supplierStageId", "supplierStatus", "companyId"])
      .where("id", "=", f.ids.supplier)
      .executeTakeFirst();
    expect(supplier).toEqual({
      supplierStageId: null,
      supplierStatus: "Pending",
      companyId: f.companyId
    });
  } finally {
    await f.cleanup();
  }
});

test("a supplier cannot take another company's stage", async () => {
  const f = await fixture();
  try {
    const stage = `${f.ids.supplier}-other-stage`;
    await sql`
      INSERT INTO "supplierStage" (id, name, "companyId", "createdBy")
      VALUES (${stage}, 'Sampling', ${f.otherCompanyId}, 'system')
    `.execute(f.db);

    await expect(
      sql`
        UPDATE "supplier" SET "supplierStageId" = ${stage} WHERE id = ${f.ids.supplier}
      `.execute(f.db)
    ).rejects.toThrow(/supplier_supplierStageId_fkey/);
  } finally {
    await f.cleanup();
  }
});

test("renaming a stage keeps its color, and null clears it", async () => {
  const f = await fixture();
  try {
    const stage = `${f.ids.supplier}-colored-stage`;
    await sql`
      INSERT INTO "supplierStage" (id, name, color, "companyId", "createdBy")
      VALUES (${stage}, 'Sampling', 'green', ${f.companyId}, 'system')
    `.execute(f.db);
    const colorOf = async () =>
      (
        await f.db
          .selectFrom("supplierStage")
          .select("color")
          .where("id", "=", stage)
          .executeTakeFirstOrThrow()
      ).color;

    const renamed = await purchasing.updateSupplierStage(
      f.contextAs("system"),
      { id: stage, name: "Trial" }
    );
    expect(renamed.error).toBeNull();
    expect(await colorOf()).toBe("green");

    const cleared = await purchasing.updateSupplierStage(
      f.contextAs("system"),
      { id: stage, name: "Trial", color: null }
    );
    expect(cleared.error).toBeNull();
    expect(await colorOf()).toBeNull();
  } finally {
    await f.cleanup();
  }
});
