// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { hasPermission } from "@carbon/auth";
import { getUserClaims } from "@carbon/auth/users.server";
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import { getNextSequence } from "@carbon/database/sequence";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import type { ServerFnInput } from "@carbon/server-functions";
import { serverFns } from "@carbon/server-functions";
import type { DraftedContractInvoice } from "@carbon/server-functions/create-contract-invoices";
import type { DraftedRentalInvoice } from "@carbon/server-functions/create-rental-invoices";
import type { Violation } from "@carbon/utils";
import { round, suggestContractType } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import type { z } from "zod";
import { getCompanySettings } from "~/modules/settings";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";
import {
  contractEndDate,
  type createContractFromSalesOrderValidator
} from "./sales.models";

const logger = getLogger("erp", "sales-server");

type BreakRow = { quantity: number; overridePrice: number; active: boolean };

export async function duplicatePriceOverrides(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  source: { customerId?: string; customerTypeId?: string },
  target: { customerId?: string; customerTypeId?: string },
  options?: {
    overrideIds?: string[];
    conflictStrategy?: "skip" | "overwrite";
  }
): Promise<{
  duplicated: number;
  skipped: number;
  overwritten: number;
  error: unknown;
}> {
  let query = client
    .from("customerItemPriceOverride")
    .select(
      "id, itemId, notes, validFrom, validTo, active, applyRulesOnTop, breaks:customerItemPriceOverrideBreak(quantity, overridePrice, active)"
    )
    .eq("companyId", companyId);

  if (source.customerId) {
    query = query.eq("customerId", source.customerId);
  } else if (source.customerTypeId) {
    query = query.eq("customerTypeId", source.customerTypeId);
  } else {
    query = query.is("customerId", null).is("customerTypeId", null);
  }

  if (options?.overrideIds?.length) {
    query = query.in("id", options.overrideIds);
  }

  const { data: sourceOverrides, error: fetchError } = await query;
  if (fetchError || !sourceOverrides) {
    return { duplicated: 0, skipped: 0, overwritten: 0, error: fetchError };
  }

  if (sourceOverrides.length === 0) {
    return { duplicated: 0, skipped: 0, overwritten: 0, error: null };
  }

  const strategy = options?.conflictStrategy ?? "skip";

  let existingLookup = client
    .from("customerItemPriceOverride")
    .select("id, itemId")
    .eq("companyId", companyId)
    .in(
      "itemId",
      sourceOverrides.map((s) => s.itemId)
    );

  existingLookup = target.customerId
    ? existingLookup.eq("customerId", target.customerId)
    : target.customerTypeId
      ? existingLookup.eq("customerTypeId", target.customerTypeId)
      : existingLookup.is("customerId", null).is("customerTypeId", null);

  const { data: existingOverrides } = await existingLookup;
  const existingByItemId = new Map(
    (existingOverrides ?? []).map((e) => [e.itemId, e.id])
  );

  const db = getDatabaseClient();

  try {
    const result = await db.transaction().execute(async (trx) => {
      let duplicated = 0;
      let skipped = 0;
      let overwritten = 0;

      for (const src of sourceOverrides) {
        const breaks = ((src.breaks as BreakRow[] | null) ?? []).map((b) => ({
          quantity: b.quantity,
          overridePrice: b.overridePrice,
          active: b.active
        }));

        if (breaks.length === 0) {
          skipped++;
          continue;
        }

        const existingId = existingByItemId.get(src.itemId);

        if (existingId && strategy === "skip") {
          skipped++;
          continue;
        }

        let parentId: string;

        if (existingId) {
          await trx
            .updateTable("customerItemPriceOverride")
            .set({
              active: src.active,
              applyRulesOnTop: src.applyRulesOnTop ?? true,
              notes: src.notes ?? null,
              validFrom: src.validFrom ?? null,
              validTo: src.validTo ?? null,
              customerId: target.customerId ?? null,
              customerTypeId: target.customerTypeId ?? null,
              itemId: src.itemId,
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .where("id", "=", existingId)
            .where("companyId", "=", companyId)
            .execute();

          await trx
            .deleteFrom("customerItemPriceOverrideBreak")
            .where("customerItemPriceOverrideId", "=", existingId)
            .where("companyId", "=", companyId)
            .execute();

          parentId = existingId;
          overwritten++;
        } else {
          const [row] = await trx
            .insertInto("customerItemPriceOverride")
            .values({
              companyId,
              createdBy: userId,
              itemId: src.itemId,
              customerId: target.customerId ?? null,
              customerTypeId: target.customerTypeId ?? null,
              active: src.active,
              applyRulesOnTop: src.applyRulesOnTop ?? true,
              notes: src.notes ?? null,
              validFrom: src.validFrom ?? null,
              validTo: src.validTo ?? null
            })
            .returning("id")
            .execute();

          parentId = row.id;
          duplicated++;
        }

        await trx
          .insertInto("customerItemPriceOverrideBreak")
          .values(
            breaks.map((b) => ({
              customerItemPriceOverrideId: parentId,
              companyId,
              createdBy: userId,
              quantity: b.quantity,
              overridePrice: b.overridePrice,
              active: b.active
            }))
          )
          .execute();
      }

      return { duplicated, skipped, overwritten };
    });

    return { ...result, error: null };
  } catch (e) {
    return { duplicated: 0, skipped: 0, overwritten: 0, error: e };
  }
}

/**
 * Save a quote line and reconcile its quantity-break prices atomically.
 *
 * These three writes have to land together. Previously the line update
 * committed first, then the prune, then the seed — so a resolver failure left
 * the line saved with its new breaks unpriced, and a failure after the prune
 * left it short rows it used to have. The user saw a flashed error but the data
 * was already half-applied.
 *
 * Price ROWS are computed by the caller beforehand (the resolvers only read),
 * so a pricing failure aborts before anything is written at all. Those reads
 * are outside the transaction, which is fine: none of them touch the rows being
 * written here.
 */
export async function saveQuoteLineWithPrices(args: {
  companyId: string;
  quoteId: string;
  lineId: string;
  line: Record<string, unknown>;
  removedQuantities: number[];
  priceRows: Record<string, unknown>[];
}): Promise<void> {
  const { companyId, quoteId, lineId, line, removedQuantities, priceRows } =
    args;
  const db = getDatabaseClient();

  await db.transaction().execute(async (trx) => {
    // Kysely bypasses RLS and lineId/quoteId come from the URL: the line must
    // belong to this company AND to the quote whose lock state the route
    // checked, or nothing is written. The form's own quoteId is overridden so
    // a line can't be re-parented onto another document.
    const result = await trx
      .updateTable("quoteLine")
      .set({ ...line, quoteId } as never)
      .where("id", "=", lineId)
      .where("quoteId", "=", quoteId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) {
      throw new Error(`Quote line ${lineId} not found`);
    }

    if (removedQuantities.length > 0) {
      await trx
        .deleteFrom("quoteLinePrice")
        .where("quoteLineId", "=", lineId)
        .where("companyId", "=", companyId)
        .where("quantity", "in", removedQuantities)
        .execute();
    }

    if (priceRows.length > 0) {
      await trx
        .insertInto("quoteLinePrice")
        .values(
          // Kysely sends a JS array as a Postgres array literal; jsonb needs
          // JSON text.
          priceRows.map((row) => ({
            ...row,
            priceTrace: row.priceTrace ? JSON.stringify(row.priceTrace) : null
          })) as never
        )
        .execute();
    }
  });
}

// ---------------------------------------------------------------------------
// Sales-rule outcome evidence
// ---------------------------------------------------------------------------

/**
 * Persist sales-rule override/block evidence and notify the configured group.
 *
 * One `enforcementRuleAcknowledgment` row per deduped violation, plus one
 * `sales-rule-violation` notification. Both writes are best-effort: evidence
 * or notification failures are logged and must never break the submission
 * they describe. Callers pass the SERVICE-ROLE client — the acknowledgment
 * table's INSERT policy requires `sales_create`, but the documents these
 * gates protect (invoices, shipments) are legitimately posted by users
 * without it.
 *
 * Line actions pass `documentLineId`/`itemId` for the single line they wrote;
 * document gates leave them unset and each violation's own `lineId` (stamped
 * by the document evaluator) attributes the row instead.
 */
export async function recordSalesRuleOutcome(
  serviceRole: SupabaseClient<Database>,
  args: {
    companyId: string;
    userId: string;
    documentType: "quote" | "salesOrder" | "salesInvoice";
    documentId: string;
    outcome: "blocked" | "acknowledged";
    violations: Violation[];
    ruleNames: Record<string, string>;
    documentLineId?: string | null;
    itemId?: string | null;
  }
): Promise<void> {
  const {
    companyId,
    userId,
    documentType,
    documentId,
    outcome,
    violations,
    ruleNames
  } = args;
  if (violations.length === 0) return;

  const acknowledgmentInsert = await serviceRole
    .from("enforcementRuleAcknowledgment")
    .insert(
      violations.map((v) => ({
        companyId,
        ruleId: v.ruleId,
        ruleName: ruleNames[v.ruleId] ?? null,
        documentType,
        documentId,
        // A caller that evaluated a single line knows the real line id (or
        // that none exists yet) and passes the key — the evaluator's stamp is
        // a placeholder ("new") there. Document gates omit the key and the
        // per-violation stamp is the attribution.
        documentLineId:
          "documentLineId" in args
            ? (args.documentLineId ?? null)
            : (v.lineId ?? null),
        itemId: args.itemId ?? null,
        severity: v.severity,
        outcome,
        message: v.message,
        createdBy: userId
      }))
    );
  if (acknowledgmentInsert.error) {
    logger.error("Failed to record sales rule acknowledgments", {
      error: acknowledgmentInsert.error
    });
  }

  try {
    const companySettings = await getCompanySettings(serviceRole, companyId);
    if (companySettings.data?.salesRuleNotificationGroup?.length) {
      await trigger("notify", {
        companyId,
        documentId: `${documentType}:${documentId}:${outcome}`,
        event: NotificationEvent.SalesRuleViolation,
        recipient: {
          type: "group",
          groupIds: companySettings.data.salesRuleNotificationGroup
        },
        from: userId
      });
    }
  } catch (err) {
    logger.error("Failed to trigger sales rule violation notification", {
      error: err
    });
  }
}

// ---------------------------------------------------------------------------
// Rental invoices
// ---------------------------------------------------------------------------

/**
 * The `Purchase Option` charge Sell to Customer bills (`$id.$lineId.sell.tsx`,
 * which checks the agreement is Active, the line is a Sale unit On Rent
 * and the option is not already billed). Server-only on purpose: the
 * `sales.service.ts` charge writer is an MCP tool and only ever writes a
 * `Charge`, so no caller can name this charge type and skip those checks.
 */
export async function insertRentalPurchaseOptionCharge(
  client: SupabaseClient<Database>,
  charge: {
    rentalAgreementLineId: string;
    chargeDate: string;
    description: string;
    amount: number;
    taxPercent: number;
    companyId: string;
    createdBy: string;
  }
) {
  return client
    .from("rentalAgreementCharge")
    .insert([{ ...charge, chargeType: "Purchase Option" as const }])
    .select("id")
    .single();
}

/** The agreement page's "Invoice" (and Sell to Customer): drafts the
 *  invoices for whatever the agreement has due, exactly as the daily job
 *  would — the `create-rental-invoices` server function. */
export async function generateRentalInvoicesNow(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    /** `YYYY-MM-DD` in the company's timezone. */
    asOf: string;
    rentalAgreementId: string;
  }
): Promise<{ invoices: DraftedRentalInvoice[]; invoiceIds: string[] }> {
  const { companyId, userId, asOf, rentalAgreementId } = args;
  const { invoices, invoiceIds, failures } = await serverFns
    .system({ db, companyId, userId })
    .invokeOrThrow("create-rental-invoices", { asOf, rentalAgreementId });
  // One agreement is billed here, so its failure is the action's failure.
  if (failures.length > 0) {
    throw new Error(failures.map((f) => f.error).join("; "));
  }
  return { invoices, invoiceIds };
}

/**
 * Releases what a Draft invoice (or some of its lines) billed, so the next
 * generation bills it again: rental billing periods and charges, and contract
 * schedule rows. Called in the same transaction as the delete:
 * `salesInvoiceLineId` has no foreign key, so a delete alone would leave the
 * rows stamped as billed by a line that no longer exists.
 *
 * A contract's planned invoice goes back to Planned only once none of its
 * rows is still stamped — deleting one contract line from a Draft leaves the
 * planned invoice Invoiced while its other lines are still on that Draft.
 * `voidedSalesInvoiceId` is left alone, so a re-bill hold stays (rental
 * decision 8).
 */
async function releaseRecurringInvoiceStamps(
  trx: KyselyTx,
  args: { companyId: string; salesInvoiceLineIds: string[]; userId: string }
): Promise<void> {
  const { companyId, salesInvoiceLineIds, userId } = args;
  if (salesInvoiceLineIds.length === 0) return;

  await trx
    .updateTable("rentalBillingPeriod")
    .set({
      status: "Pending",
      salesInvoiceLineId: null,
      updatedBy: userId,
      updatedAt: sql`now()`
    })
    .where("companyId", "=", companyId)
    .where("salesInvoiceLineId", "in", salesInvoiceLineIds)
    .execute();

  await trx
    .updateTable("rentalAgreementCharge")
    .set({
      salesInvoiceLineId: null,
      updatedBy: userId,
      updatedAt: sql`now()`
    })
    .where("companyId", "=", companyId)
    .where("salesInvoiceLineId", "in", salesInvoiceLineIds)
    .execute();

  const releasedRows = await trx
    .updateTable("customerContractInvoiceLine")
    .set({
      salesInvoiceLineId: null,
      updatedBy: userId,
      updatedAt: sql`now()`
    })
    .where("companyId", "=", companyId)
    .where("salesInvoiceLineId", "in", salesInvoiceLineIds)
    .returning("customerContractInvoiceId")
    .execute();

  const plannedInvoiceIds = [
    ...new Set(
      releasedRows.flatMap((row) =>
        row.customerContractInvoiceId ? [row.customerContractInvoiceId] : []
      )
    )
  ];
  if (plannedInvoiceIds.length === 0) return;

  await trx
    .updateTable("customerContractInvoice")
    .set({
      status: "Planned",
      salesInvoiceId: null,
      updatedBy: userId,
      updatedAt: sql`now()`
    })
    .where("companyId", "=", companyId)
    .where("id", "in", plannedInvoiceIds)
    .where("status", "=", "Invoiced")
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("customerContractInvoiceLine as stamped")
            .select(sql`1`.as("one"))
            .whereRef(
              "stamped.customerContractInvoiceId",
              "=",
              "customerContractInvoice.id"
            )
            .where("stamped.companyId", "=", companyId)
            .where("stamped.salesInvoiceLineId", "is not", null)
        )
      )
    )
    .execute();
}

/**
 * Deletes a Draft sales invoice and, in the same transaction, releases the
 * rental billing periods and charges and the contract schedule rows it
 * billed, so the next generation bills them again. `salesInvoiceLineId` on
 * those rows has no foreign key, so a plain delete would leave them stamped
 * as billed forever. Throws on a missing or non-Draft invoice.
 */
export async function deleteSalesInvoiceReleasingRentals(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; invoiceId: string; userId: string }
): Promise<void> {
  const { companyId, invoiceId, userId } = args;
  await db.transaction().execute(async (trx) => {
    const invoice = await trx
      .selectFrom("salesInvoice")
      .select(["id", "status"])
      .where("id", "=", invoiceId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!invoice) throw new Error("Sales invoice not found");
    if (invoice.status !== "Draft") {
      throw new Error(
        `Cannot delete sales invoice with status "${invoice.status}". Only Draft invoices can be deleted.`
      );
    }

    const lines = await trx
      .selectFrom("salesInvoiceLine")
      .select("id")
      .where("invoiceId", "=", invoiceId)
      .where("companyId", "=", companyId)
      .where((eb) =>
        eb.or([
          eb("invoiceLineType", "=", "Rental"),
          eb("customerContractInvoiceLineId", "is not", null)
        ])
      )
      .execute();
    await releaseRecurringInvoiceStamps(trx, {
      companyId,
      salesInvoiceLineIds: lines.map((line) => line.id),
      userId
    });

    await trx
      .deleteFrom("salesInvoice")
      .where("id", "=", invoiceId)
      .where("companyId", "=", companyId)
      .execute();
  });
}

/** One line of a Draft invoice, releasing the rental period or charge, or
 *  the contract schedule row, it billed (see
 *  `deleteSalesInvoiceReleasingRentals`). The line must belong
 *  to `invoiceId` and that invoice must be Draft — checked here, under a row
 *  lock, because releasing a POSTED line's stamps would bill its period
 *  again. Throws otherwise. */
export async function deleteSalesInvoiceLineReleasingRentals(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    invoiceId: string;
    salesInvoiceLineId: string;
    userId: string;
  }
): Promise<void> {
  const { companyId, invoiceId, salesInvoiceLineId, userId } = args;
  await db.transaction().execute(async (trx) => {
    const line = await trx
      .selectFrom("salesInvoiceLine")
      .innerJoin("salesInvoice", (join) =>
        join
          .onRef("salesInvoice.id", "=", "salesInvoiceLine.invoiceId")
          .onRef("salesInvoice.companyId", "=", "salesInvoiceLine.companyId")
      )
      .select([
        "salesInvoiceLine.invoiceId as invoiceId",
        "salesInvoice.status as status"
      ])
      .where("salesInvoiceLine.id", "=", salesInvoiceLineId)
      .where("salesInvoiceLine.companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!line || line.invoiceId !== invoiceId) {
      throw new Error("Sales invoice line not found on this invoice");
    }
    if (line.status !== "Draft") {
      throw new Error(
        `Cannot delete a line of a sales invoice with status "${line.status}". Only Draft invoices can be edited.`
      );
    }

    await releaseRecurringInvoiceStamps(trx, {
      companyId,
      salesInvoiceLineIds: [salesInvoiceLineId],
      userId
    });
    await trx
      .deleteFrom("salesInvoiceLine")
      .where("id", "=", salesInvoiceLineId)
      .where("companyId", "=", companyId)
      .execute();
  });
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

/** The contract page's "Invoice": drafts the invoices the contract has due,
 *  exactly as the daily job would — the `create-contract-invoices` server
 *  function. */
export async function generateContractInvoicesNow(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    /** `YYYY-MM-DD` in the company's timezone. */
    asOf: string;
    customerContractId: string;
  }
): Promise<{ invoices: DraftedContractInvoice[]; invoiceIds: string[] }> {
  const { companyId, userId, asOf, customerContractId } = args;
  const { invoices, invoiceIds, failures } = await serverFns
    .system({ db, companyId, userId })
    .invokeOrThrow("create-contract-invoices", { asOf, customerContractId });
  // One contract is billed here, so its failure is the action's failure.
  if (failures.length > 0) {
    throw new Error(failures.map((f) => f.error).join("; "));
  }
  return { invoices, invoiceIds };
}

/** A new contract's invoicing terms from its customer: the bill-to
 *  customer, invoice contact and address and payment terms (Customer →
 *  Payment), and the ship-to address (Customer → Shipping) when it is one of
 *  the customer's own locations. Each is undefined when the customer has
 *  none, or a read fails — a default left empty is filled on the Invoicing
 *  step. */
export async function contractInvoicingDefaults(
  client: SupabaseClient<Database>,
  companyId: string,
  customerId: string
): Promise<{
  invoiceCustomerId: string | undefined;
  invoiceCustomerContactId: string | undefined;
  invoiceCustomerLocationId: string | undefined;
  paymentTermId: string | undefined;
  shipToCustomerLocationId: string | undefined;
}> {
  const [payment, shipping] = await Promise.all([
    client
      .from("customerPayment")
      .select(
        "invoiceCustomerId, invoiceCustomerContactId, invoiceCustomerLocationId, paymentTermId"
      )
      .eq("customerId", customerId)
      .eq("companyId", companyId)
      .maybeSingle(),
    client
      .from("customerShipping")
      .select("shippingCustomerId, shippingCustomerLocationId")
      .eq("customerId", customerId)
      .eq("companyId", companyId)
      .maybeSingle()
  ]);
  if (payment.error || shipping.error) {
    logger.error("Failed to read the customer's invoicing defaults", {
      companyId,
      customerId,
      error: payment.error ?? shipping.error
    });
  }

  const shipsToItself =
    !shipping.data?.shippingCustomerId ||
    shipping.data.shippingCustomerId === customerId;
  return {
    invoiceCustomerId: payment.data?.invoiceCustomerId ?? undefined,
    invoiceCustomerContactId:
      payment.data?.invoiceCustomerContactId ?? undefined,
    invoiceCustomerLocationId:
      payment.data?.invoiceCustomerLocationId ?? undefined,
    paymentTermId: payment.data?.paymentTermId ?? undefined,
    shipToCustomerLocationId: shipsToItself
      ? (shipping.data?.shippingCustomerLocationId ?? undefined)
      : undefined
  };
}

/** Confirm, schedule edits, amend, cancel and revert — the
 *  `post-customer-contract` server function, run as the signed-in user so
 *  its permission check applies. Never throws: `{ data, error }`. */
export function runContractAction(
  caller: {
    client: SupabaseClient<Database>;
    db: Kysely<KyselyDatabase>;
    companyId: string;
    userId: string;
  },
  input: ServerFnInput<"post-customer-contract">
) {
  return serverFns.as(caller).invoke("post-customer-contract", input);
}

type SalesOrderStatus = Database["public"]["Enums"]["salesOrderStatus"];

/** The statuses the invoiced/shipped rollup sets. A Draft or unconfirmed
 *  order gets its status at Confirm (which derives it from the lines), and a
 *  Cancelled or Closed one keeps its own. */
const ROLLUP_ORDER_STATUSES: SalesOrderStatus[] = [
  "To Ship and Invoice",
  "To Ship",
  "To Invoice",
  "Completed"
];

/** The order status the lines imply — the rollup in `post-sales-invoice`
 *  (copied, not imported: that file is a server function). Service lines are
 *  never shipped, so they never hold shipping open. */
function salesOrderStatusFromLines(
  lines: {
    salesOrderLineType: Database["public"]["Enums"]["salesOrderLineType"];
    invoicedComplete: boolean;
    sentComplete: boolean;
  }[]
): { status: SalesOrderStatus; allInvoiced: boolean } {
  const allInvoiced = lines.every(
    (line) => line.salesOrderLineType === "Comment" || line.invoicedComplete
  );
  const allShipped = lines.every(
    (line) =>
      line.salesOrderLineType === "Comment" ||
      line.salesOrderLineType === "Service" ||
      line.sentComplete
  );

  let status: SalesOrderStatus = "To Ship and Invoice";
  if (allInvoiced && allShipped) {
    status = "Completed";
  } else if (allInvoiced) {
    status = "To Ship";
  } else if (allShipped) {
    status = "To Invoice";
  }
  return { status, allInvoiced };
}

/**
 * Creates a Draft contract from a sales order's Service lines (decision 7).
 * The lines taken are marked `invoicedComplete`, so `convert` never invoices
 * them and the order's rollup counts them as invoiced; when that leaves every
 * line invoiced, the order's status is recomputed. Deleting the Draft
 * contract, or one of its lines, releases them
 * (`deleteContractReleasingSalesOrderLines`). Returns the contract's id.
 */
export async function createContractFromSalesOrder(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    /** `YYYY-MM-DD` in the company's timezone: the close date. */
    asOf: string;
    input: z.infer<typeof createContractFromSalesOrderValidator>;
  }
): Promise<string> {
  const { companyId, userId, asOf, input } = args;

  // Drawn before the transaction, as the contract form's route does: a
  // refusal below costs a number, but the sequence row is not held locked
  // while the order is.
  const customerContractId = await db
    .transaction()
    .execute((trx) => getNextSequence(trx, "customerContract", companyId));

  return db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom("salesOrder")
      .select([
        "id",
        "salesOrderId",
        "status",
        "customerId",
        "customerReference",
        "salesPersonId",
        "currencyCode",
        "exchangeRate"
      ])
      .where("id", "=", input.salesOrderId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new Error("Sales order not found");
    if (order.status === "Cancelled" || order.status === "Closed") {
      throw new Error(
        `Cannot create a contract from a ${order.status.toLowerCase()} sales order`
      );
    }

    // Payment terms and the invoice party live on the order's payment row.
    const payment = await trx
      .selectFrom("salesOrderPayment")
      .select([
        "paymentTermId",
        "invoiceCustomerId",
        "invoiceCustomerContactId",
        "invoiceCustomerLocationId"
      ])
      .where("id", "=", order.id)
      .where("companyId", "=", companyId)
      .executeTakeFirst();

    // Every line is locked, not only the chosen ones: the status rollup
    // below reads them all.
    const orderLines = await trx
      .selectFrom("salesOrderLine")
      .select([
        "id",
        "salesOrderLineType",
        "itemId",
        "description",
        "saleQuantity",
        "unitPrice",
        "convertedUnitPrice",
        "taxPercent",
        "invoicedComplete",
        "quantityInvoiced",
        "sentComplete"
      ])
      .where("salesOrderId", "=", order.id)
      .where("companyId", "=", companyId)
      .forUpdate()
      .execute();
    const orderLineById = new Map(orderLines.map((line) => [line.id, line]));

    const chosenIds = new Set(input.lines.map((line) => line.salesOrderLineId));
    if (chosenIds.size !== input.lines.length) {
      throw new Error("A sales order line was chosen more than once");
    }

    const chosen = input.lines.map((choice) => {
      const line = orderLineById.get(choice.salesOrderLineId);
      if (!line) throw new Error("A chosen line is not on this sales order");
      if (line.salesOrderLineType !== "Service" || !line.itemId) {
        throw new Error("Only Service lines can move to a contract");
      }
      if (line.invoicedComplete || Number(line.quantityInvoiced ?? 0) > 0) {
        throw new Error(
          "A line that is already invoiced cannot move to a contract"
        );
      }
      const quantity = Number(line.saleQuantity ?? 0);
      if (quantity <= 0) {
        throw new Error("A line with no quantity cannot move to a contract");
      }
      // A contract line's rate is in the contract's currency, which is the
      // order's: `unitPrice` is base, `convertedUnitPrice` (unitPrice ×
      // exchangeRate) is what the customer was quoted.
      const rate = round(
        Number(line.convertedUnitPrice ?? line.unitPrice ?? 0)
      );
      if (rate < 0) {
        throw new Error(
          "A line with a negative price cannot move to a contract"
        );
      }
      return { choice, line, itemId: line.itemId, quantity, rate };
    });

    const previousContracts = await trx
      .selectFrom("customerContract")
      .select("status")
      .where("companyId", "=", companyId)
      .where("customerId", "=", order.customerId)
      .execute();

    const { endDate, termMonths } = contractEndDate(
      input.startDate,
      input.duration,
      input.endDate
    );

    const contract = await trx
      .insertInto("customerContract")
      .values({
        companyId,
        customerContractId,
        name: input.name,
        contractType: suggestContractType(previousContracts),
        customerId: order.customerId,
        invoiceCustomerId: payment?.invoiceCustomerId ?? null,
        invoiceCustomerContactId: payment?.invoiceCustomerContactId ?? null,
        invoiceCustomerLocationId: payment?.invoiceCustomerLocationId ?? null,
        salesPersonId: order.salesPersonId,
        salesOrderId: order.id,
        customerReference: order.customerReference,
        closeDate: asOf,
        startDate: input.startDate,
        endDate,
        termMonths,
        billingFrequency: input.billingFrequency,
        billingAlignment: input.billingAlignment,
        billingTiming: input.billingTiming,
        paymentTermId: payment?.paymentTermId ?? null,
        currencyCode: order.currencyCode,
        exchangeRate: order.exchangeRate ?? 1,
        createdBy: userId
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    await trx
      .insertInto("customerContractLine")
      .values(
        chosen.map(({ choice, line, itemId, quantity, rate }) => ({
          companyId,
          customerContractId: contract.id,
          revenueType: choice.revenueType,
          itemId,
          description: line.description,
          quantity,
          rate,
          rateUnit:
            choice.revenueType === "Recurring"
              ? (choice.rateUnit ?? null)
              : null,
          taxPercent: line.taxPercent,
          startDate: input.startDate,
          salesOrderLineId: line.id,
          createdBy: userId
        }))
      )
      .execute();

    await trx
      .updateTable("salesOrderLine")
      .set({
        invoicedComplete: true,
        updatedBy: userId,
        updatedAt: sql`now()`
      })
      .where("companyId", "=", companyId)
      .where("id", "in", [...chosenIds])
      .execute();

    const { status, allInvoiced } = salesOrderStatusFromLines(
      orderLines.map((line) => ({
        ...line,
        invoicedComplete: line.invoicedComplete || chosenIds.has(line.id)
      }))
    );
    if (allInvoiced && ROLLUP_ORDER_STATUSES.includes(order.status)) {
      await trx
        .updateTable("salesOrder")
        .set({ status, updatedBy: userId, updatedAt: sql`now()` })
        .where("id", "=", order.id)
        .where("companyId", "=", companyId)
        .execute();
    }

    return contract.id;
  });
}

/**
 * Hands sales-order lines back to their order when the Draft contract (or
 * contract line) that took them is deleted: `invoicedComplete` goes back to
 * false where the line is not fully invoiced, and an order the rollup had
 * settled is recomputed from its lines. Runs inside the delete's transaction.
 */
async function releaseContractSalesOrderLines(
  trx: KyselyTx,
  args: { companyId: string; userId: string; salesOrderLineIds: string[] }
): Promise<void> {
  const { companyId, userId, salesOrderLineIds } = args;
  if (salesOrderLineIds.length === 0) return;

  const released = await trx
    .updateTable("salesOrderLine")
    .set({
      invoicedComplete: false,
      updatedBy: userId,
      updatedAt: sql`now()`
    })
    .where("companyId", "=", companyId)
    .where("id", "in", salesOrderLineIds)
    .where("invoicedComplete", "=", true)
    .where(
      sql<boolean>`coalesce("quantityInvoiced", 0) < coalesce("saleQuantity", 0)`
    )
    .returning("salesOrderId")
    .execute();

  const salesOrderIds = [...new Set(released.map((line) => line.salesOrderId))];
  if (salesOrderIds.length === 0) return;

  const orders = await trx
    .selectFrom("salesOrder")
    .select(["id", "status"])
    .where("companyId", "=", companyId)
    .where("id", "in", salesOrderIds)
    .forUpdate()
    .execute();
  const orderLines = await trx
    .selectFrom("salesOrderLine")
    .select([
      "salesOrderId",
      "salesOrderLineType",
      "invoicedComplete",
      "sentComplete"
    ])
    .where("companyId", "=", companyId)
    .where("salesOrderId", "in", salesOrderIds)
    .execute();

  // Each order's new status, grouped so one UPDATE per status covers them
  // (at most one per rollup status, however many orders).
  const orderIdsByStatus = new Map<SalesOrderStatus, string[]>();
  for (const order of orders) {
    if (!ROLLUP_ORDER_STATUSES.includes(order.status)) continue;
    const { status } = salesOrderStatusFromLines(
      orderLines.filter((line) => line.salesOrderId === order.id)
    );
    if (status === order.status) continue;
    orderIdsByStatus.set(status, [
      ...(orderIdsByStatus.get(status) ?? []),
      order.id
    ]);
  }

  for (const [status, ids] of orderIdsByStatus) {
    await trx
      .updateTable("salesOrder")
      .set({ status, updatedBy: userId, updatedAt: sql`now()` })
      .where("companyId", "=", companyId)
      .where("id", "in", ids)
      .execute();
  }
}

/** Locks a contract and refuses one that is missing or not a Draft. */
async function lockDraftContract(
  trx: KyselyTx,
  args: { companyId: string; customerContractId: string; refusal: string }
): Promise<void> {
  const contract = await trx
    .selectFrom("customerContract")
    .select("status")
    .where("id", "=", args.customerContractId)
    .where("companyId", "=", args.companyId)
    .forUpdate()
    .executeTakeFirst();
  if (!contract) throw new Error("Contract not found");
  if (contract.status !== "Draft") throw new Error(args.refusal);
}

/**
 * Deletes a Draft contract and, in the same transaction, hands the
 * sales-order lines it took back to their order (decision 7) so they can be
 * invoiced again. Throws on a missing or non-Draft contract.
 */
export async function deleteContractReleasingSalesOrderLines(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; userId: string; id: string }
): Promise<void> {
  const { companyId, userId, id } = args;
  await db.transaction().execute(async (trx) => {
    await lockDraftContract(trx, {
      companyId,
      customerContractId: id,
      refusal: "Only a Draft contract can be deleted. Cancel it instead."
    });

    const lines = await trx
      .selectFrom("customerContractLine")
      .select("salesOrderLineId")
      .where("customerContractId", "=", id)
      .where("companyId", "=", companyId)
      .where("salesOrderLineId", "is not", null)
      .execute();
    await releaseContractSalesOrderLines(trx, {
      companyId,
      userId,
      salesOrderLineIds: lines.flatMap((line) =>
        line.salesOrderLineId ? [line.salesOrderLineId] : []
      )
    });

    await trx
      .deleteFrom("customerContract")
      .where("id", "=", id)
      .where("companyId", "=", companyId)
      .where("status", "=", "Draft")
      .execute();
  });
}

/** One line of a Draft contract, handing its sales-order line back to the
 *  order (see `deleteContractReleasingSalesOrderLines`). The line must belong
 *  to `customerContractId`; throws otherwise. */
export async function deleteContractLineReleasingSalesOrderLine(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    customerContractId: string;
    customerContractLineId: string;
  }
): Promise<void> {
  const { companyId, userId, customerContractId, customerContractLineId } =
    args;
  await db.transaction().execute(async (trx) => {
    await lockDraftContract(trx, {
      companyId,
      customerContractId,
      refusal: "Lines can only be removed from a Draft contract — use Amend"
    });

    const line = await trx
      .selectFrom("customerContractLine")
      .select(["customerContractId", "salesOrderLineId"])
      .where("id", "=", customerContractLineId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!line || line.customerContractId !== customerContractId) {
      throw new Error("This line does not belong to this contract");
    }

    await releaseContractSalesOrderLines(trx, {
      companyId,
      userId,
      salesOrderLineIds: line.salesOrderLineId ? [line.salesOrderLineId] : []
    });

    await trx
      .deleteFrom("customerContractLine")
      .where("id", "=", customerContractLineId)
      .where("companyId", "=", companyId)
      .execute();
  });
}

/** Where a Draft contract opens: its setup wizard, for anyone who can edit
 *  it (the wizard needs `update: sales`). Null for a confirmed contract, or
 *  for a viewer who cannot edit — they get the contract page. */
export async function draftContractSetupPath(
  client: SupabaseClient<Database>,
  args: { companyId: string; userId: string; id: string }
): Promise<string | null> {
  const { companyId, userId, id } = args;
  const [contract, claims] = await Promise.all([
    client
      .from("customerContract")
      .select("status")
      .eq("id", id)
      .eq("companyId", companyId)
      .maybeSingle(),
    getUserClaims(userId, companyId)
  ]);
  if (contract.data?.status !== "Draft") return null;
  if (!hasPermission(claims?.permissions, "sales", "update", companyId)) {
    return null;
  }
  return path.to.contractSetup(id, "products");
}
