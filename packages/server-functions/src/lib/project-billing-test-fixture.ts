// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A scratch company for the project billing regressions: a Contract project
// with a billing element and a child under it, the labor category Engineer II
// (bill rate 150.00), and helpers for a Time & Materials contract and for
// ledger rows written through `insertProjectLedgerRows`. `addAccounting` and
// `addJournalLines` add the accounts and WIP journal lines the revenue
// recognition run reads. Deleted afterwards.

import type { Database } from "@carbon/database";
import { sql } from "kysely";
import { connectLocalTestDatabase } from "../local-database-test-fixture";
import { ServerFnContext } from "../server-fn-context";
import {
  buildProjectLedgerRow,
  insertProjectLedgerRows
} from "./project-posting";

const USER = "system";

type CostType = Database["public"]["Enums"]["projectCostType"];

const ACCOUNTS = [
  { name: "wip", class: "Asset" },
  { name: "contract-asset", class: "Asset" },
  { name: "cogs", class: "Expense" },
  { name: "expense", class: "Expense" },
  { name: "sales", class: "Revenue" },
  { name: "deferred", class: "Liability" },
  { name: "loss-provision", class: "Liability" }
] as const;

type AccountName = (typeof ACCOUNTS)[number]["name"];

export async function projectBillingTestFixture() {
  const db = await connectLocalTestDatabase();
  const prefix = `pbtest-${crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)}`;
  const companyId = `${prefix}-company`;
  const groupId = `${prefix}-group`;
  const customerId = `${prefix}-customer`;
  const itemId = `${prefix}-item`;
  const locationId = `${prefix}-location`;
  const laborCategoryId = `${prefix}-engineer-ii`;

  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("companyGroup")
      .values({ id: groupId, name: prefix, createdBy: USER })
      .execute();
    await trx
      .insertInto("company")
      .values({
        id: companyId,
        name: prefix,
        companyGroupId: groupId,
        baseCurrencyCode: "USD",
        timezone: "America/New_York"
      })
      .execute();
    await trx
      .insertInto("currency")
      .values({
        code: "USD",
        decimalPlaces: 2,
        companyGroupId: groupId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("companySettings")
      .values({ id: companyId })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
    await trx
      .insertInto("sequence")
      .values(
        [
          { table: "salesInvoice", name: "Sales Invoice", prefix: "INV-" },
          { table: "creditMemo", name: "Credit Memo", prefix: "CM-" },
          {
            table: "revenueRecognitionRun",
            name: "Revenue Recognition Run",
            prefix: "RR-"
          }
        ].map((row) => ({ ...row, companyId }))
      )
      .execute();
    await trx
      .insertInto("customer")
      .values({ id: customerId, name: prefix, companyId })
      .execute();
    await trx
      .insertInto("location")
      .values({
        id: locationId,
        name: "Headquarters",
        addressLine1: "1 Main St",
        city: "Springfield",
        postalCode: "00000",
        timezone: "America/New_York",
        companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("item")
      .values({
        id: itemId,
        readableId: `${prefix}-ENG`,
        name: "Engineering services",
        type: "Service",
        itemTrackingType: "Non-Inventory",
        companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("laborCategory")
      .values({
        id: laborCategoryId,
        name: "Engineer II",
        companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("laborCategoryRate")
      .values({
        laborCategoryId,
        costRate: 100,
        billRate: 150,
        effectiveFrom: "2026-01-01",
        companyId,
        createdBy: USER
      })
      .execute();
  });

  const ctx = ServerFnContext.system({ db, companyId, userId: USER });

  const account = (name: AccountName) => `${prefix}-acct-${name}`;

  /** The accounts and account defaults the revenue recognition run needs:
   *  Project WIP (Asset), cost of goods sold, Deferred Revenue, Contract
   *  Assets, Sales and the Contract Loss Provision. */
  const addAccounting = async () => {
    await db.transaction().execute(async (trx) => {
      await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
      await trx
        .insertInto("account")
        .values(
          ACCOUNTS.map((row) => ({
            id: account(row.name),
            name: `${prefix} ${row.name}`,
            class: row.class,
            incomeBalance:
              row.class === "Asset" || row.class === "Liability"
                ? ("Balance Sheet" as const)
                : ("Income Statement" as const),
            companyGroupId: groupId,
            createdBy: USER
          }))
        )
        .execute();
      // Every NOT NULL default on cost of goods sold, then the run's own.
      await sql`INSERT INTO "accountDefault" SELECT (jsonb_populate_record(NULL::"accountDefault",
        (SELECT jsonb_object_agg(attname, to_jsonb(${account("cogs")}::text)) FROM pg_attribute
         WHERE attrelid='"accountDefault"'::regclass AND attnum>0 AND NOT attisdropped AND attnotnull AND attname<>'companyId')
        || jsonb_build_object(
          'companyId', ${companyId}::text,
          'costOfGoodsSoldAccount', ${account("cogs")}::text,
          'salesAccount', ${account("sales")}::text,
          'deferredRevenueAccount', ${account("deferred")}::text,
          'contractAssetAccount', ${account("contract-asset")}::text,
          'contractLossProvisionAccount', ${account("loss-provision")}::text,
          'projectWorkInProgressAccount', ${account("wip")}::text
        ))).*`.execute(trx);
    });
  };

  let journalCount = 0;
  /** One Draft journal with these lines; returns the line ids in order. */
  const addJournalLines = async (
    lines: { account: AccountName; amount: number }[],
    postingDate = "2026-02-10"
  ) => {
    journalCount += 1;
    const journalId = `${prefix}-je-${journalCount}`;
    const reference = (index: number) => `${journalId}-${index}`;
    return db.transaction().execute(async (trx) => {
      await trx
        .insertInto("journal")
        .values({
          id: journalId,
          journalEntryId: journalId,
          postingDate,
          status: "Draft",
          companyId,
          createdBy: USER
        })
        .execute();
      const inserted = await trx
        .insertInto("journalLine")
        .values(
          lines.map((line, index) => ({
            journalId,
            accountId: account(line.account),
            amount: line.amount,
            journalLineReference: reference(index),
            companyId,
            createdBy: USER
          }))
        )
        .returning(["id", "journalLineReference"])
        .execute();
      const idByReference = new Map(
        inserted.map((row) => [row.journalLineReference, row.id])
      );
      return lines.map((_, index) => idByReference.get(reference(index))!);
    });
  };

  /** A Released project with a billing element (`<identifier>-1`) and a
   *  child under it (`<identifier>-2`). */
  const addProject = async (
    key: string,
    identifier: string,
    costTreatment: "Contract" | "Expense" = "Contract"
  ) => {
    const projectId = `${companyId}-${key}`;
    const stateId = `${projectId}-todo`;
    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto("project")
        .values({
          id: projectId,
          name: key,
          identifier,
          status: "Released",
          costTreatment,
          companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("projectState")
        .values({
          id: stateId,
          name: "Todo",
          group: "Unstarted",
          color: "#000000",
          sortOrder: 0,
          isDefault: true,
          projectId,
          companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("projectElement")
        .values([
          {
            id: `${projectId}-root`,
            projectId,
            readableId: `${identifier}-1`,
            sequence: 1,
            type: "Task",
            name: "Engineering",
            isBilling: true,
            stateId,
            companyId,
            createdBy: USER
          },
          {
            id: `${projectId}-child`,
            projectId,
            parentId: `${projectId}-root`,
            readableId: `${identifier}-2`,
            sequence: 2,
            type: "Task",
            name: "Analysis",
            isBilling: false,
            stateId,
            companyId,
            createdBy: USER
          }
        ])
        .execute();
    });
    return {
      projectId,
      rootId: `${projectId}-root`,
      childId: `${projectId}-child`
    };
  };

  /** A Monthly / Calendar / Arrears contract with one billing line on the
   *  element, from 2026-01-01. Active unless `status` says otherwise. */
  const addContract = async (input: {
    key: string;
    projectId: string;
    projectElementId: string;
    status?: "Draft" | "Active";
    billingMethod?: "Time & Materials" | "Cost Plus";
    materialHandlingPercent?: number | null;
    fundedAmount?: number | null;
  }) => {
    const contractId = `${companyId}-${input.key}`;
    const lineId = `${contractId}-line`;
    const billingMethod = input.billingMethod ?? "Time & Materials";
    await db.transaction().execute(async (trx) => {
      await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
      await trx
        .insertInto("customerContract")
        .values({
          id: contractId,
          customerContractId: `CON-${input.key}`,
          name: input.key,
          customerId,
          status: input.status ?? "Active",
          closeDate: "2026-01-01",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          billingFrequency: "Month",
          billingAlignment: "Calendar",
          billingTiming: "Arrears",
          currencyCode: "USD",
          companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("customerContractLine")
        .values({
          id: lineId,
          customerContractId: contractId,
          revenueType: "One-time",
          itemId,
          description: "Engineering T&M",
          quantity: 1,
          rate: 0,
          startDate: "2026-01-01",
          billingMethod,
          revenueMethod: "Right to Invoice",
          materialHandlingPercent:
            input.materialHandlingPercent === undefined
              ? 0.1
              : input.materialHandlingPercent,
          feePercent: billingMethod === "Cost Plus" ? 0.08 : null,
          fundedAmount: input.fundedAmount ?? null,
          projectId: input.projectId,
          projectElementId: input.projectElementId,
          companyId,
          createdBy: USER
        })
        .execute();
    });
    return { contractId, lineId };
  };

  /** Writes ledger rows through `insertProjectLedgerRows`, as posting does. */
  const post = async (
    rows: {
      projectId: string;
      projectElementId: string;
      costType: CostType;
      amount: number;
      quantity?: number | null;
      postingDate?: string;
      laborCategoryId?: string | null;
      reversalOfId?: string | null;
      documentType?: string;
      journalLineId?: string | null;
    }[]
  ) =>
    db.transaction().execute((trx) =>
      insertProjectLedgerRows(trx, {
        companyId,
        userId: USER,
        rows: rows.map((row, index) =>
          buildProjectLedgerRow({
            companyId,
            projectId: row.projectId,
            projectElementId: row.projectElementId,
            postingDate: row.postingDate ?? "2026-02-10",
            costType: row.costType,
            documentType: row.documentType ?? "Test",
            documentId: `${prefix}-doc-${index}`,
            laborCategoryId: row.laborCategoryId ?? null,
            quantity: row.quantity ?? null,
            amount: row.amount,
            reversalOfId: row.reversalOfId ?? null,
            journalLineId: row.journalLineId ?? null,
            createdBy: USER
          })
        )
      })
    );

  const items = (projectId: string) =>
    db
      .selectFrom("projectBillableItem")
      .selectAll()
      .where("projectId", "=", projectId)
      .where("companyId", "=", companyId)
      .orderBy("createdAt")
      .orderBy("amount", "desc")
      .orderBy("id")
      .execute();

  return {
    db,
    ctx,
    companyId,
    customerId,
    itemId,
    locationId,
    laborCategoryId,
    userId: USER,
    account,
    addAccounting,
    addJournalLines,
    addProject,
    addContract,
    post,
    items,
    async cleanup() {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx.deleteFrom("company").where("id", "=", companyId).execute();
        await trx
          .deleteFrom("companyGroup")
          .where("id", "=", groupId)
          .execute();
        await sql`DROP TABLE IF EXISTS ${sql.id(`searchIndex_${companyId}`)}`.execute(
          trx
        );
        await sql`DROP TABLE IF EXISTS ${sql.id(`auditLog_${companyId}`)}`.execute(
          trx
        );
      });
      await db.destroy();
    }
  };
}
