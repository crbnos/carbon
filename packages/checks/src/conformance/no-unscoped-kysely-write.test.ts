import { describe, expect, it } from "vitest";
import { noUnscopedKyselyWrite } from "./no-unscoped-kysely-write";

const SERVICE = "apps/erp/app/modules/sales/sales.service.ts";
const scan = (ts: string, file = SERVICE) =>
  noUnscopedKyselyWrite.scan(file, ts);

describe("noUnscopedKyselyWrite", () => {
  it("flags the reported shape: an update keyed by id alone", () => {
    const ts = [
      "for (const { id, sortOrder, updatedBy } of updates) {",
      "  await trx",
      '    .updateTable("quoteLine")',
      "    .set({ sortOrder, updatedBy })",
      '    .where("id", "=", id)',
      "    .execute();",
      "}"
    ].join("\n");
    const v = scan(ts);
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(3);
    expect(v[0]?.snippet).toBe('.updateTable("quoteLine")');
  });

  it("flags a delete keyed by a parent id alone", () => {
    const ts =
      'await trx.deleteFrom("jobMaterialStep").where("jobOperationStepId", "in", ids).execute();';
    expect(scan(ts)).toHaveLength(1);
  });

  it("allows a write scoped by companyId", () => {
    const ts = [
      "await trx",
      '  .updateTable("quoteLine")',
      "  .set({ sortOrder })",
      '  .where("id", "=", id)',
      '  .where("companyId", "=", companyId)',
      "  .execute();"
    ].join("\n");
    expect(scan(ts)).toHaveLength(0);
  });

  it("accepts an aliased table's qualified companyId", () => {
    const ts =
      'await trx.updateTable("job as j").set({ status }).where("j.id", "=", id).where("j.companyId", "=", companyId).executeTakeFirst();';
    expect(scan(ts)).toHaveLength(0);
  });

  it("requires the predicate on a table named by a variable too", () => {
    const ts = [
      'const slideTable = "jobOperationStepSlide" as const;',
      'await trx.deleteFrom(slideTable).where("stepId", "in", ids).execute();'
    ].join("\n");
    expect(scan(ts)).toHaveLength(1);
  });

  it("does not count companyId in the SET as scoping", () => {
    const ts =
      'await trx.updateTable("item").set({ companyId, name }).where("id", "=", id).execute();';
    expect(scan(ts)).toHaveLength(1);
  });

  it("does not let a NEIGHBOURING statement's companyId scope this one", () => {
    const ts = [
      'await trx.updateTable("quoteLine").set({ sortOrder }).where("id", "=", id).execute();',
      'await trx.updateTable("quote").set({ status }).where("id", "=", quoteId).where("companyId", "=", companyId).execute();'
    ].join("\n");
    const v = scan(ts);
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(1);
  });

  it("does not let a sibling array element's companyId scope this one", () => {
    const ts = [
      "await Promise.all([",
      '  trx.deleteFrom("a").where("id", "=", id),',
      '  trx.deleteFrom("b").where("id", "=", id).where("companyId", "=", companyId)',
      "]);"
    ].join("\n");
    const v = scan(ts);
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(2);
  });

  it("ignores a companyId predicate that is only in a comment", () => {
    const ts = [
      "await trx",
      '  .updateTable("quoteLine")',
      '  // .where("companyId", "=", companyId)',
      '  .where("id", "=", id)',
      "  .execute();"
    ].join("\n");
    expect(scan(ts)).toHaveLength(1);
  });

  it("ignores a write that is only in a comment", () => {
    const ts = '// trx.updateTable("quoteLine").where("id", "=", id)';
    expect(scan(ts)).toHaveLength(0);
  });

  it("stops at a semicolon inside a SET callback only at depth 0", () => {
    const ts = [
      "await trx",
      '  .updateTable("methodMaterial")',
      "  .set((eb) => { const x = 1; return { x }; })",
      '  .where("companyId", "=", companyId)',
      "  .execute();"
    ].join("\n");
    expect(scan(ts)).toHaveLength(0);
  });

  it("accepts a link table scoped through its parent in a subquery", () => {
    const ts = [
      "await trx",
      '  .deleteFrom("jobMaterialStep")',
      '  .where("jobOperationStepId", "in", (eb) =>',
      "    eb",
      '      .selectFrom("jobOperationStep")',
      '      .select("id")',
      '      .where("id", "in", ids)',
      '      .where("companyId", "=", companyId)',
      "  )",
      "  .execute();"
    ].join("\n");
    expect(scan(ts)).toHaveLength(0);
  });

  it("exempts the company table, whose id is the tenant", () => {
    const ts =
      'await trx.updateTable("company").set(fields).where("id", "=", companyId).execute();';
    expect(scan(ts)).toHaveLength(0);
  });

  it("covers routes, MES and jobs", () => {
    const ts = 'await db.deleteFrom("kanban").where("id", "=", id).execute();';
    for (const file of [
      "apps/erp/app/routes/x+/kanban+/delete.$id.tsx",
      "apps/mes/app/services/operations.service.ts",
      "packages/jobs/src/inngest/functions/tasks/foo.ts"
    ]) {
      expect(scan(ts, file)).toHaveLength(1);
    }
  });

  it("ignores edge functions and packages/ee", () => {
    const ts = 'await db.deleteFrom("user").where("id", "=", id).execute();';
    for (const file of [
      "packages/database/supabase/functions/post-receipt/index.ts",
      "packages/ee/src/sso/provisioning.server.ts"
    ]) {
      expect(scan(ts, file)).toHaveLength(0);
    }
  });
});
