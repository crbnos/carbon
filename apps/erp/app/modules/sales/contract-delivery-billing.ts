// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A Fixed Price part CLIN bills when its part is delivered (spec section 10.4,
// D34). The line's schedule holds its price as Planned billing events, and an
// Active contract's events cannot be edited, so posting a delivery moves the
// delivered units' share of the next Planned event to the delivery date. Void
// puts it back. The line's billed total never changes, so the revenue plan
// still conserves.

import { InvalidInputError } from "@carbon/api/errors";
import type { KyselyTx } from "@carbon/database/client";
import { equals, round } from "@carbon/database/precision";
import { datetime } from "@carbon/utils";
import { sql } from "kysely";
import {
  deleteEmptyPlannedInvoices,
  invoiceKey,
  resolveInvoiceIds,
  type Scope,
  scheduleRowValues
} from "./sales.service";

const DATE_TEXT = (column: string) => sql<string>`${sql.ref(column)}::text`;

/** The row a delivery moved, and the date it moved the whole row from (null
 *  when it split the row). */
export type DeliveryBillingRow = {
  rowId: string;
  previousInvoiceDate: string | null;
};

/**
 * Moves `amount` of the line's next Planned billing event onto a Planned
 * event on `deliveredOn`. The whole row moves when it holds no more than
 * `amount`; otherwise it is split, its units in proportion. Returns null when
 * the line has no Planned event left (it is already invoiced).
 */
export async function splitBillingRowForDelivery(
  trx: KyselyTx,
  args: {
    scope: Scope;
    contractId: string;
    customerContractLineId: string;
    amount: number;
    deliveredOn: string;
  }
): Promise<DeliveryBillingRow | null> {
  const { scope, contractId, customerContractLineId, deliveredOn } = args;
  if (args.amount <= 0) return null;

  const next = await trx
    .selectFrom("customerContractInvoiceLine as r")
    .innerJoin("customerContractInvoice as i", (join) =>
      join
        .onRef("i.id", "=", "r.customerContractInvoiceId")
        .onRef("i.companyId", "=", "r.companyId")
    )
    .select([
      "r.id",
      "r.customerContractLineId",
      DATE_TEXT("r.periodStart").as("periodStart"),
      DATE_TEXT("r.periodEnd").as("periodEnd"),
      "r.units",
      "r.unitPrice",
      "r.amount",
      DATE_TEXT("i.invoiceDate").as("invoiceDate")
    ])
    .where("r.customerContractId", "=", contractId)
    .where("r.customerContractLineId", "=", customerContractLineId)
    .where("r.companyId", "=", scope.companyId)
    .where("r.isAdjustment", "=", false)
    .where("r.amount", ">", 0)
    .where("i.status", "=", "Planned")
    .orderBy("i.invoiceDate")
    .orderBy("r.id")
    .forUpdate()
    .executeTakeFirst();
  if (!next) return null;

  const rowAmount = Number(next.amount);
  const ids = await resolveInvoiceIds(
    trx,
    scope,
    contractId,
    [{ invoiceDate: deliveredOn, status: "Planned" }],
    { isEdited: true }
  );
  const deliveryInvoiceId = ids.get(invoiceKey(deliveredOn, "Planned"))!;

  if (args.amount >= rowAmount || equals(args.amount, rowAmount)) {
    await trx
      .updateTable("customerContractInvoiceLine")
      .set({
        customerContractInvoiceId: deliveryInvoiceId,
        updatedBy: scope.userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", next.id)
      .where("companyId", "=", scope.companyId)
      .execute();
    await deleteEmptyPlannedInvoices(trx, scope, contractId);
    return { rowId: next.id, previousInvoiceDate: next.invoiceDate };
  }

  const share = args.amount / rowAmount;
  const units = Number(next.units);
  await trx
    .updateTable("customerContractInvoiceLine")
    .set({
      units: round(units * (1 - share)),
      amount: round(rowAmount - args.amount),
      updatedBy: scope.userId,
      updatedAt: datetime.timestamp()
    })
    .where("id", "=", next.id)
    .where("companyId", "=", scope.companyId)
    .execute();
  const values = scheduleRowValues(
    scope,
    contractId,
    {
      lineId: customerContractLineId,
      periodStart: next.periodStart,
      periodEnd: next.periodEnd,
      units: units * share,
      unitPrice: Number(next.unitPrice),
      amount: args.amount,
      isAdjustment: false
    },
    { invoiceId: deliveryInvoiceId, memoId: null }
  );
  const inserted = await trx
    .insertInto("customerContractInvoiceLine")
    .values(values)
    .returning("id")
    .executeTakeFirstOrThrow();
  return { rowId: inserted.id, previousInvoiceDate: null };
}

/**
 * Puts back what `splitBillingRowForDelivery` moved: a whole row returns to a
 * Planned event on its old date; a split row merges back into the line's next
 * Planned row of the same period, or stays where it is when that row is gone.
 * Refused once the delivered row is invoiced.
 */
export async function restoreBillingRowAfterVoid(
  trx: KyselyTx,
  args: {
    scope: Scope;
    contractId: string;
    row: DeliveryBillingRow;
  }
): Promise<void> {
  const { scope, contractId, row } = args;
  const delivered = await trx
    .selectFrom("customerContractInvoiceLine as r")
    .innerJoin("customerContractInvoice as i", (join) =>
      join
        .onRef("i.id", "=", "r.customerContractInvoiceId")
        .onRef("i.companyId", "=", "r.companyId")
    )
    .select([
      "r.id",
      "r.customerContractLineId",
      DATE_TEXT("r.periodStart").as("periodStart"),
      "r.units",
      "r.amount",
      "i.status"
    ])
    .where("r.id", "=", row.rowId)
    .where("r.customerContractId", "=", contractId)
    .where("r.companyId", "=", scope.companyId)
    .forUpdate()
    .executeTakeFirst();
  // The row is gone (deleted with its line): nothing to put back.
  if (!delivered) return;
  if (delivered.status !== "Planned") {
    throw new InvalidInputError("The delivery is invoiced. Credit it first.");
  }

  if (row.previousInvoiceDate) {
    const ids = await resolveInvoiceIds(
      trx,
      scope,
      contractId,
      [{ invoiceDate: row.previousInvoiceDate, status: "Planned" }],
      { isEdited: true }
    );
    await trx
      .updateTable("customerContractInvoiceLine")
      .set({
        customerContractInvoiceId: ids.get(
          invoiceKey(row.previousInvoiceDate, "Planned")
        )!,
        updatedBy: scope.userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", delivered.id)
      .where("companyId", "=", scope.companyId)
      .execute();
    await deleteEmptyPlannedInvoices(trx, scope, contractId);
    return;
  }

  const sibling = await trx
    .selectFrom("customerContractInvoiceLine as r")
    .innerJoin("customerContractInvoice as i", (join) =>
      join
        .onRef("i.id", "=", "r.customerContractInvoiceId")
        .onRef("i.companyId", "=", "r.companyId")
    )
    .select(["r.id", "r.units", "r.amount"])
    .where("r.customerContractId", "=", contractId)
    .where("r.customerContractLineId", "=", delivered.customerContractLineId)
    .where("r.companyId", "=", scope.companyId)
    .where("r.id", "<>", delivered.id)
    .where("r.isAdjustment", "=", false)
    .where("r.periodStart", "=", delivered.periodStart)
    .where("i.status", "=", "Planned")
    .orderBy("i.invoiceDate")
    .orderBy("r.id")
    .forUpdate()
    .executeTakeFirst();
  if (!sibling) return;

  await trx
    .updateTable("customerContractInvoiceLine")
    .set({
      units: round(Number(sibling.units) + Number(delivered.units)),
      amount: round(Number(sibling.amount) + Number(delivered.amount)),
      updatedBy: scope.userId,
      updatedAt: datetime.timestamp()
    })
    .where("id", "=", sibling.id)
    .where("companyId", "=", scope.companyId)
    .execute();
  await trx
    .deleteFrom("customerContractInvoiceLine")
    .where("id", "=", delivered.id)
    .where("companyId", "=", scope.companyId)
    .execute();
  await deleteEmptyPlannedInvoices(trx, scope, contractId);
}
