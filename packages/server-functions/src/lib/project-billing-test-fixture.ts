// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A scratch company for the project billing regressions: a Contract project
// with a billing element and a child under it, the labor category Engineer II
// (bill rate 150.00), and helpers for a Time & Materials contract and for
// ledger rows written through `insertProjectLedgerRows`. Deleted afterwards.

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
          { table: "creditMemo", name: "Credit Memo", prefix: "CM-" }
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
