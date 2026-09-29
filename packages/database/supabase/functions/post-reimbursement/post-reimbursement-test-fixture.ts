import type { Insertable } from "kysely";
import { sql } from "kysely";
import { Pool } from "pg";
import { type DB, getDatabaseClient } from "../lib/database.ts";

export const hasLocalDatabase: boolean = (() => {
  try {
    const databaseUrl = Deno.env.get("SUPABASE_DB_URL");
    if (!databaseUrl) return false;
    return ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(databaseUrl).hostname,
    );
  } catch {
    return false;
  }
})();

export function databaseTest(
  name: string,
  fn: () => void | Promise<void>,
): void {
  Deno.test({ name, ignore: !hasLocalDatabase, fn });
}

export async function connectReimbursementTestDatabase() {
  const databaseUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!databaseUrl) {
    throw new Error("Reimbursement regressions require SUPABASE_DB_URL");
  }
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Reimbursement regressions require a local database");
  }
  const db = getDatabaseClient<DB>(
    new Pool(
      {
        hostname: url.hostname,
        port: Number(url.port),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: url.pathname.slice(1),
        controls: { decoders: { 1700: Number } },
        tls: { enabled: false },
      },
      1,
    ),
  );
  await sql`SELECT set_config('app.sync_in_progress', 'true', false)`.execute(
    db,
  );
  return db;
}

// Every NOT NULL account column on `accountDefault` other than the two this
// suite actually exercises. They are pointed at one filler posting account so
// the row can exist at all — the payable resolution only ever reads
// `employeeReimbursementsPayableAccount` and `payablesAccount`.
const FILLER_ACCOUNT_DEFAULTS = [
  "salesAccount",
  "salesDiscountAccount",
  "costOfGoodsSoldAccount",
  "purchaseVarianceAccount",
  "inventoryAdjustmentVarianceAccount",
  "materialVarianceAccount",
  "laborAndMachineVarianceAccount",
  "indirectCostAccount",
  "maintenanceAccount",
  "assetDepreciationExpenseAccount",
  "serviceChargeAccount",
  "interestAccount",
  "supplierPaymentDiscountAccount",
  "customerPaymentDiscountAccount",
  "roundingAccount",
  "assetAquisitionCostAccount",
  "assetAquisitionCostOnDisposalAccount",
  "accumulatedDepreciationAccount",
  "accumulatedDepreciationOnDisposalAccount",
  "workInProgressAccount",
  "receivablesAccount",
  "bankCashAccount",
  "bankLocalCurrencyAccount",
  "bankForeignCurrencyAccount",
  "prepaymentAccount",
  "salesTaxPayableAccount",
  "purchaseTaxPayableAccount",
  "reverseChargeSalesTaxPayableAccount",
  "retainedEarningsAccount",
  "goodsReceivedNotInvoicedAccount",
  "overheadVarianceAccount",
  "lotSizeVarianceAccount",
  "subcontractingVarianceAccount",
  "currencyTranslationAccount",
  "customerWriteOffAccount",
  "supplierWriteOffAccount",
  "realizedExchangeGainAccount",
  "realizedExchangeLossAccount",
  "supplierPrepaymentAccount",
  "rawMaterialsAccount",
  "finishedGoodsAccount",
  "assetGainOnDisposalAccount",
  "assetLossOnDisposalAccount",
] as const;

export async function reimbursementFixture(
  options: { reimbursementId?: string } = {},
) {
  const db = await connectReimbursementTestDatabase();
  const prefix = `reimbtest-${
    crypto.randomUUID().replaceAll("-", "").slice(0, 12)
  }`;
  const companyId = `${prefix}-company`;
  const groupId = `${prefix}-group`;
  const reimbursementId = options.reimbursementId ?? `${prefix}-reimbursement`;
  const lineId = `${prefix}-line-1`;
  const secondLineId = `${prefix}-line-2`;
  const employeeId = `${prefix}-employee`;
  const employeeTypeId = `${prefix}-employee-type`;
  const costCenterId = `${prefix}-cost-center`;
  const otherCostCenterId = `${prefix}-cost-center-2`;
  const projectId = `${prefix}-project`;
  const costCenterDimensionId = `${prefix}-dimension-cc`;
  const projectDimensionId = `${prefix}-dimension-pj`;
  const account = (name: string) => `${prefix}-${name}`;

  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx.insertInto("companyGroup").values({
      id: groupId,
      name: prefix,
      createdBy: "system",
    }).execute();
    await trx.insertInto("company").values({
      id: companyId,
      name: prefix,
      companyGroupId: groupId,
      baseCurrencyCode: "USD",
      timezone: "America/New_York",
    }).execute();
    await trx.insertInto("currency").values({
      code: "USD",
      decimalPlaces: 2,
      companyGroupId: groupId,
      createdBy: "system",
    }).execute();
    await trx.insertInto("account").values([
      {
        id: account("payable"),
        name: "Employee reimbursements payable",
        class: "Liability",
        incomeBalance: "Balance Sheet",
        companyGroupId: groupId,
        createdBy: "system",
      },
      {
        id: account("ap"),
        name: "Accounts payable",
        class: "Liability",
        incomeBalance: "Balance Sheet",
        companyGroupId: groupId,
        createdBy: "system",
      },
      {
        id: account("expense"),
        name: "Travel expense",
        class: "Expense",
        incomeBalance: "Income Statement",
        companyGroupId: groupId,
        createdBy: "system",
      },
      {
        id: account("expense2"),
        name: "Meals expense",
        class: "Expense",
        incomeBalance: "Income Statement",
        companyGroupId: groupId,
        createdBy: "system",
      },
      {
        id: account("misc"),
        name: "Filler",
        class: "Expense",
        incomeBalance: "Income Statement",
        companyGroupId: groupId,
        createdBy: "system",
      },
    ]).execute();
    await trx.insertInto("companySettings").values({
      id: companyId,
      accountingEnabled: true,
    }).onConflict((oc) =>
      oc.column("id").doUpdateSet({ accountingEnabled: true })
    ).execute();
    // `Object.fromEntries` erases the literal key types, so the assembled row
    // has to be re-asserted as the insertable shape.
    await trx.insertInto("accountDefault").values({
      companyId,
      ...Object.fromEntries(
        FILLER_ACCOUNT_DEFAULTS.map((column) => [column, account("misc")]),
      ),
      payablesAccount: account("ap"),
      employeeReimbursementsPayableAccount: account("payable"),
    } as unknown as Insertable<DB["accountDefault"]>).execute();
    await trx.insertInto("accountingPeriod").values({
      id: `${prefix}-period`,
      startDate: "2000-01-01",
      endDate: "2099-12-31",
      fiscalYear: 2099,
      periodNumber: 1,
      status: "Active",
      closeStatus: "Open",
      companyId,
      createdBy: "system",
    }).execute();
    await trx.insertInto("sequence").values({
      table: "journalEntry",
      name: "Reimbursement journals",
      prefix: "REIMBTEST-",
      companyId,
    }).execute();
    await trx.insertInto("dimension").values([
      {
        id: costCenterDimensionId,
        name: "Cost Center",
        entityType: "CostCenter",
        companyGroupId: groupId,
        createdBy: "system",
      },
      {
        id: projectDimensionId,
        name: "Project",
        entityType: "Project",
        companyGroupId: groupId,
        createdBy: "system",
      },
    ]).execute();
    await trx.insertInto("costCenter").values([
      {
        id: costCenterId,
        name: "Field service",
        companyId,
        createdBy: "system",
      },
      {
        id: otherCostCenterId,
        name: "Engineering",
        companyId,
        createdBy: "system",
      },
    ]).execute();
    await trx.insertInto("project").values({
      id: projectId,
      name: "Apollo",
      companyId,
      createdBy: "system",
    }).execute();
    // `reimbursement.employeeId` is only an FK target here — nothing in the
    // posting path reads the employee. Both tables carry sync interceptors that
    // mirror the row into the `group`/`membership` graph, which needs a real
    // user and a provisioned company; that scaffolding is irrelevant to a
    // journal, so the two inserts run with triggers off.
    await sql`SET LOCAL session_replication_role = replica`.execute(trx);
    await trx.insertInto("employeeType").values({
      id: employeeTypeId,
      name: "Employee",
      companyId,
    }).execute();
    await trx.insertInto("employee").values({
      id: employeeId,
      companyId,
      employeeTypeId,
      active: true,
    }).execute();
    await sql`SET LOCAL session_replication_role = origin`.execute(trx);
    await trx.insertInto("reimbursement").values({
      id: reimbursementId,
      reimbursementId: `${prefix}-readable`,
      employeeId,
      status: "Draft",
      integration: "ramp",
      reimbursementDate: "2026-09-11",
      currencyCode: "USD",
      exchangeRate: 1,
      amount: 620,
      companyId,
      createdBy: "system",
    }).execute();
    await trx.insertInto("reimbursementLine").values([
      {
        id: lineId,
        reimbursementId,
        accountId: account("expense"),
        costCenterId,
        description: "Airfare",
        amount: 500,
        sequence: 0,
        companyId,
        createdBy: "system",
      },
      {
        id: secondLineId,
        reimbursementId,
        accountId: account("expense2"),
        description: "Meals",
        amount: 120,
        sequence: 1,
        companyId,
        createdBy: "system",
      },
    ]).execute();
  });

  const args = {
    type: "post" as const,
    reimbursementId,
    companyId,
    userId: "system",
  };

  return {
    db,
    args,
    account,
    reimbursementId,
    companyId,
    groupId,
    employeeId,
    lineId,
    secondLineId,
    costCenterId,
    otherCostCenterId,
    projectId,
    costCenterDimensionId,
    projectDimensionId,
    connect: connectReimbursementTestDatabase,
    async cleanup() {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        // The draft guard and the posted-journal immutability triggers both
        // refuse the teardown writes below; disabling them is the same escape
        // hatch the charge fixture uses.
        await sql`SET LOCAL session_replication_role = replica`.execute(trx);
        await trx.updateTable("reimbursement").set({
          status: "Draft",
          journalId: null,
          postedAt: null,
          postedBy: null,
          voidedAt: null,
          voidedBy: null,
        })
          .where("companyId", "=", companyId).execute();
        await trx.updateTable("journal").set({ status: "Draft" })
          .where("companyId", "=", companyId).execute();
        await sql`SET LOCAL session_replication_role = origin`.execute(trx);
        await trx.deleteFrom("company").where("id", "=", companyId).execute();
        await trx.deleteFrom("companyGroup").where("id", "=", groupId)
          .execute();
        await sql`DROP TABLE IF EXISTS ${sql.id(`searchIndex_${companyId}`)}`
          .execute(trx);
        await sql`DROP TABLE IF EXISTS ${sql.id(`auditLog_${companyId}`)}`
          .execute(trx);
      });
      await db.destroy();
    },
  };
}
