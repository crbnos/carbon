// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { openai } from "@ai-sdk/openai";
import { hasPermission } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getUserClaims } from "@carbon/auth/users.server";
import type { Database, Json } from "@carbon/database";
import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import { getNextSequence } from "@carbon/database/sequence";
import { QuoteEmail } from "@carbon/documents/email";
import { getQuoteDisplayId } from "@carbon/documents/pdf";
import {
  dedupeViolations,
  evaluateSalesRuleLines,
  evaluateSalesRulesForSalesDocument,
  isBlocked,
  resolveSalesOrderShipTo
} from "@carbon/ee/rules.server";
import {
  safeStorageFileName,
  storage,
  TEMP_STAGING_BUCKET
} from "@carbon/files";
import { supportedModelTypes } from "@carbon/files/cad";
import { trigger } from "@carbon/jobs";
import { redis } from "@carbon/kv";
import { trackWorkEvent } from "@carbon/lib/telemetry";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import type { ServerFnInput } from "@carbon/server-functions";
import { serverFns } from "@carbon/server-functions";
import type { DraftedContractInvoice } from "@carbon/server-functions/create-contract-invoices";
import type {
  DraftedRentalCreditMemo,
  DraftedRentalInvoice
} from "@carbon/server-functions/create-rental-invoices";
import type { Violation } from "@carbon/utils";
import {
  breakQuantities,
  datetime,
  getErrorMessage,
  getSalesOrderStatus,
  round,
  suggestContractType,
  unchecked
} from "@carbon/utils";
import { renderAsync } from "@react-email/components";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateText, Output } from "ai";
import { sql } from "kysely";
import { nanoid } from "nanoid";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { getExchangeRate } from "~/modules/accounting";
import { upsertDocument } from "~/modules/documents";
import {
  getSupplierPriceBreaksForItems,
  resolveItemIdFromExtractedText,
  upsertPart
} from "~/modules/items";
import { getUnreleasedChangeOrderIssue } from "~/modules/items/items.server";
import { runMRP } from "~/modules/production/production.service";
import {
  type CarbonError,
  createServiceContext,
  defineServiceFn,
  type ServiceContext
} from "~/modules/service-fn.server";
import { getCompany, getCompanySettings } from "~/modules/settings";
import { checkPartyContactRequirement } from "~/modules/settings/party-contact.server";
import { resolveBuyUnitCost, upsertExternalLink } from "~/modules/shared";
import {
  requireCompanyRecord,
  sendSalesOrderEmail
} from "~/modules/shared/shared.server";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getUser } from "~/modules/users/users.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";
import { sanitize } from "~/utils/supabase";
import { renderQuotePdf, renderSalesOrderPdf } from "./sales.documents.server";
import {
  contractEndDate,
  type createContractFromSalesOrderValidator,
  isQuoteLocked,
  isSalesOrderLocked,
  isSalesRfqLocked,
  quoteLineValidator,
  salesOrderLineValidator,
  salesRFQStatusType,
  salesRfqDragValidator,
  salesRfqValidator,
  selectedLinesValidator
} from "./sales.models";
import {
  buildMakeToOrderPriceRows,
  buildPullFromInventoryPriceRows,
  buildPurchaseToOrderPriceRows,
  calculatePricesForQuantities,
  convertQuoteToOrder,
  convertSalesRfqToQuote,
  finalizeQuote,
  getCustomer,
  getCustomerContact,
  getQuote,
  getSalesOrder,
  getSalesOrderLine,
  getSalesOrderLines,
  getSalesRFQ,
  insertSalesRFQ,
  type QuoteLinePriceRow,
  recalculateQuoteLinePrices,
  resolvePurchaseToOrderPrices,
  resolveQuoteLinePrices,
  updateSalesRFQStatus,
  upsertQuoteLine,
  upsertQuoteLineMethod,
  upsertSalesOrderLine,
  upsertSalesRFQLine
} from "./sales.service";
import { reconcileQuantityBreaks } from "./sales.utils";

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
): Promise<{
  invoices: DraftedRentalInvoice[];
  invoiceIds: string[];
  /** Draft credit memos for early returns, one per agreement. */
  creditMemos: DraftedRentalCreditMemo[];
}> {
  const { companyId, userId, asOf, rentalAgreementId } = args;
  const { invoices, invoiceIds, creditMemos, failures } = await serverFns
    .system({ db, companyId, userId })
    .invokeOrThrow("create-rental-invoices", { asOf, rentalAgreementId });
  // One agreement is billed here, so its failure is the action's failure.
  if (failures.length > 0) {
    throw new Error(failures.map((f) => f.error).join("; "));
  }
  return { invoices, invoiceIds, creditMemos };
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

/**
 * Deletes a Draft rental early-return credit memo and returns the
 * adjustment periods it credits to Pending, in one transaction, so the next
 * invoice run credits them again. `rentalBillingPeriod.memoId` RESTRICTs a
 * plain delete for exactly this reason. Throws on a missing or non-Draft
 * memo, or one that credits no rental agreement.
 */
export async function deleteRentalCreditMemoReleasingPeriods(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; memoId: string; userId: string }
): Promise<void> {
  const { companyId, memoId, userId } = args;
  await db.transaction().execute(async (trx) => {
    const memo = await trx
      .selectFrom("memo")
      .select(["id", "status", "rentalAgreementId"])
      .where("id", "=", memoId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!memo) throw new Error("Memo not found");
    if (!memo.rentalAgreementId) {
      throw new Error("This memo does not credit a rental agreement");
    }
    if (memo.status !== "Draft") {
      throw new Error(
        `Cannot delete a ${memo.status} memo. Only Draft memos can be deleted.`
      );
    }
    await trx
      .updateTable("rentalBillingPeriod")
      .set({
        status: "Pending",
        memoId: null,
        updatedBy: userId,
        updatedAt: sql`now()`
      })
      .where("companyId", "=", companyId)
      .where("memoId", "=", memoId)
      .execute();
    await trx
      .deleteFrom("memo")
      .where("id", "=", memoId)
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

/** The invoicing terms a Draft takes when its customer changes: the new
 *  customer's `contractInvoicingDefaults`, every one of them — the old
 *  customer's bill-to, contact, addresses and payment terms would be wrong,
 *  so a default the new customer lacks is cleared, not kept. Null when the
 *  customer did not change. Shared by setup step 1 and the properties
 *  panel, so both replace the same set. */
export async function contractCustomerChange(
  client: SupabaseClient<Database>,
  companyId: string,
  change: { from: string | null; to: string | null }
): Promise<Awaited<ReturnType<typeof contractInvoicingDefaults>> | null> {
  if (!change.to || change.to === change.from) return null;
  return contractInvoicingDefaults(client, companyId, change.to);
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

/** Where a Draft rental agreement opens: its setup wizard, for anyone who
 *  can edit it (the wizard needs `update: sales`). Null for an activated
 *  agreement, or for a viewer who cannot edit — they get the agreement page. */
export async function draftRentalAgreementSetupPath(
  client: SupabaseClient<Database>,
  args: { companyId: string; userId: string; id: string }
): Promise<string | null> {
  const { companyId, userId, id } = args;
  const [agreement, claims] = await Promise.all([
    client
      .from("rentalAgreement")
      .select("status")
      .eq("id", id)
      .eq("companyId", companyId)
      .maybeSingle(),
    getUserClaims(userId, companyId)
  ]);
  if (agreement.data?.status !== "Draft") return null;
  if (!hasPermission(claims?.permissions, "sales", "update", companyId)) {
    return null;
  }
  return path.to.rentalAgreementSetup(id, "units");
}

// ---------------------------------------------------------------------------
// Operations (`defineServiceFn`): what the routes, the API and MCP all run
// ---------------------------------------------------------------------------

/** Custom field values, as `setCustomFields` reads them off a form. */
const customFieldValues = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()])
);

/**
 * One field set on several records, as a Properties panel posts it: `ids`
 * repeats in a form, and an empty `value` clears the field.
 */
function fieldUpdate<const F extends readonly [string, ...string[]]>(
  fields: F
) {
  return z.object({
    ids: zfd.repeatableOfType(z.string().min(1)),
    field: z.enum(fields),
    value: z.string().nullish()
  });
}

/**
 * `requireCompanyRecord` as a refusal instead of a thrown `Response`: the
 * record must be this company's. Checked with the service role, so it holds
 * for an RLS-bypassing write that follows.
 */
async function refuseUnlessOwned(
  ctx: ServiceContext,
  table: Parameters<typeof requireCompanyRecord>[1],
  match: { id: string } & Record<string, string>
): Promise<CarbonError | null> {
  try {
    await requireCompanyRecord(
      ctx.asSystem.supabase,
      table,
      ctx.company.id,
      match
    );
    return null;
  } catch (thrown) {
    if (!(thrown instanceof Response)) throw thrown;
    return ctx.error(
      thrown.status === 404 ? "notFound" : "internal",
      await thrown.text()
    );
  }
}

/** What a sales-rule check found: the violation modal's payload. */
export type SalesRuleCheck = {
  violations: Violation[];
  ruleNames: Record<string, string>;
};

/**
 * The sales-rule gate a whole document passes before it moves on (quote
 * finalize and convert, RFQ convert, order confirm). Every line is
 * re-evaluated with the service role: lines arrive from paths the per-line
 * check never saw, and a rule may have been authored since.
 *
 * `blocked` is set when an error fired, or a warning that was not
 * acknowledged; that attempt is recorded (except for an RFQ, which the
 * acknowledgment table cannot name). A failed evaluation blocks too, with
 * its message as the one violation. Otherwise `check` holds the warnings the
 * caller records as acknowledged once the transition commits.
 */
async function salesDocumentGate(
  ctx: ServiceContext,
  args: {
    documentType: "quote" | "salesOrder" | "salesRfq";
    documentId: string;
    acknowledged: boolean;
    /** Only these lines are checked (a violation naming no line always is). */
    lineIds?: Set<string>;
  }
): Promise<{ blocked: SalesRuleCheck | null; check: SalesRuleCheck }> {
  const { documentType, documentId, acknowledged, lineIds } = args;
  let found: SalesRuleCheck;
  try {
    found = await evaluateSalesRulesForSalesDocument({
      client: ctx.asSystem.supabase,
      companyId: ctx.company.id,
      userId: ctx.auditUserId,
      documentType,
      documentId
    });
  } catch (err) {
    // Fail closed, but as the modal's message rather than a raw error.
    const blocked = {
      violations: [
        {
          ruleId: "__evaluation-error__",
          severity: "error" as const,
          message:
            err instanceof Error ? err.message : "Sales rule evaluation failed"
        }
      ],
      ruleNames: {}
    };
    return { blocked, check: blocked };
  }

  const check = {
    violations: dedupeViolations(found.violations).filter(
      (v) => !lineIds || !v.lineId || lineIds.has(v.lineId)
    ),
    ruleNames: found.ruleNames
  };
  if (
    check.violations.length === 0 ||
    !isBlocked(check.violations, acknowledged)
  ) {
    return { blocked: null, check };
  }
  if (documentType !== "salesRfq") {
    await recordSalesRuleOutcome(ctx.asSystem.supabase, {
      companyId: ctx.company.id,
      userId: ctx.auditUserId,
      documentType,
      documentId,
      outcome: "blocked",
      ...check
    });
  }
  return { blocked: check, check };
}

// --- Sales RFQs -------------------------------------------------------------

const salesRfqFields = [
  "customerContactId",
  "customerEngineeringContactId",
  "customerId",
  "customerLocationId",
  "customerReference",
  "expirationDate",
  "locationId",
  "rfqDate",
  "salesPersonId"
] as const;

/**
 * Create a sales RFQ.
 *
 * @remarks
 * Every customer, contact and location id must belong to this company. The
 * RFQ is created with its opportunity. Then, optionally: one line per
 * extracted `lines` entry that has a part number or description (each mapped
 * to an existing item when its text matches one directly), and the file at
 * `documentPath` (an extraction upload) copied onto the opportunity as a
 * document. A failed line or copy does not fail the RFQ.
 *
 * @mcp
 */
export const createSalesRfq = defineServiceFn({
  input: salesRfqValidator.extend({
    customFields: customFieldValues.optional(),
    lines: z
      .array(
        z.object({
          partNumber: z.coerce.string().nullish(),
          description: z.coerce.string().nullish(),
          quantity: z.coerce.number().nullish()
        })
      )
      .default([]),
    documentPath: z.string().optional()
  }),
  permission: { create: "sales" },

  async run(ctx, { lines, documentPath, customFields, ...rfq }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    // insertSalesRFQ writes through Kysely, which bypasses RLS.
    const references: [Parameters<typeof requireCompanyRecord>[1], string?][] =
      [
        ["customer", rfq.customerId],
        ["customerContact", rfq.customerContactId],
        ["customerContact", rfq.customerEngineeringContactId],
        ["customerLocation", rfq.customerLocationId],
        ["location", rfq.locationId]
      ];
    const refusals = await Promise.all(
      references.map(([table, id]) =>
        id ? refuseUnlessOwned(ctx, table, { id }) : null
      )
    );
    const refused = refusals.find((r) => r !== null);
    if (refused) return refused;

    const result = await insertSalesRFQ(client, ctx.asSystem.pg, {
      ...rfq,
      rfqId: rfq.rfqId || undefined,
      companyId,
      createdBy: userId,
      customFields
    });
    if (result.error || !result.data) {
      return ctx.error("internal", "Failed to insert RFQ", result.error);
    }
    const id = result.data.id;

    const work: Promise<unknown>[] = [];
    let order = 10;
    for (const line of lines) {
      if (!line.partNumber && !line.description) continue;
      // Map the line up front when the extracted text directly matches an
      // existing record — only lines with no direct match are left unmapped
      // for the review modal.
      const itemId = await resolveItemIdFromExtractedText(
        client,
        companyId,
        { type: "customer", id: rfq.customerId },
        [line.partNumber, line.description]
      );
      work.push(
        upsertSalesRFQLine(client, {
          salesRfqId: id,
          customerPartId: line.partNumber || "Unknown",
          itemId: itemId ?? undefined,
          description: line.description || line.partNumber || "Line Item",
          quantity: [line.quantity || 1],
          unitOfMeasureCode: "EA",
          order,
          companyId,
          createdBy: userId,
          customFields: {}
        })
      );
      order += 10;
    }

    if (documentPath) {
      work.push(
        (async () => {
          const created = await getSalesRFQ(client, id);
          const opportunityId = created.data?.opportunityId;
          if (!opportunityId) return;
          const basename = documentPath.split("/").pop() || "Extracted_RFQ.pdf";
          const originalFilename = basename.includes("_")
            ? basename.split("_").slice(1).join("_")
            : basename;
          const newStoragePath = `${companyId}/opportunity/${opportunityId}/${stripSpecialCharacters(originalFilename)}`;
          const copied = await storage(client)
            .company(companyId)
            .copy(documentPath, newStoragePath);
          if (copied.error) return;
          await upsertDocument(client, {
            path: newStoragePath,
            name: originalFilename,
            size: 0,
            sourceDocument: "Request for Quote",
            sourceDocumentId: id,
            readGroups: [userId],
            writeGroups: [userId],
            createdBy: userId,
            companyId
          });
        })()
      );
    }
    await Promise.all(work);

    return { id, rfqId: result.data.rfqId };
  }
});

/**
 * Set one field on one or more sales RFQs.
 *
 * @remarks
 * Refused when any of the RFQs is locked. An empty value clears the field.
 */
export const updateSalesRfqField = defineServiceFn({
  input: fieldUpdate(salesRfqFields),
  permission: { update: "sales" },

  async run(ctx, { ids, field, value }) {
    const client = ctx.asCaller.supabase;
    const rfqs = await client
      .from("salesRfq")
      .select("status")
      .in("id", ids)
      .eq("companyId", ctx.company.id);
    if (rfqs.error) {
      return ctx.error("internal", "Failed to load the RFQs", rfqs.error);
    }
    if (rfqs.data.some((rfq) => isSalesRfqLocked(rfq.status))) {
      return ctx.error("rule", "Cannot modify a locked RFQ.");
    }

    const update = await client
      .from("salesRfq")
      .update(
        unchecked({
          [field]: value || null,
          updatedBy: ctx.auditUserId,
          updatedAt: datetime.timestamp()
        })
      )
      .in("id", ids)
      .eq("companyId", ctx.company.id);
    if (update.error) {
      return ctx.error("internal", "Failed to update the RFQs", update.error);
    }
    return { ids };
  }
});

/**
 * Set a sales RFQ's status.
 *
 * @remarks
 * Ready for Quote first notifies the company's RFQ-ready group (a failed
 * notification leaves the status unchanged). Closed clears the assignee.
 * `noQuoteReasonId` records why it was not quoted.
 *
 * @mcp
 */
export const setSalesRfqStatus = defineServiceFn({
  input: z.object({
    id: z.string(),
    status: z.enum(salesRFQStatusType),
    noQuoteReasonId: z.string().nullish()
  }),
  permission: { update: "sales" },

  async run(ctx, { id, status, noQuoteReasonId }) {
    const client = ctx.asCaller.supabase;
    const refused = await refuseUnlessOwned(ctx, "salesRfq", { id });
    if (refused) return refused;

    if (status === "Ready for Quote") {
      const settings = await getCompanySettings(client, ctx.company.id);
      const groupIds = settings.data?.rfqReadyNotificationGroup;
      if (Array.isArray(groupIds) && groupIds.length > 0) {
        try {
          await trigger("notify", {
            companyId: ctx.company.id,
            documentId: id,
            event: NotificationEvent.SalesRfqReady,
            recipient: { type: "group", groupIds }
          });
        } catch (err) {
          return ctx.error("internal", "Failed to send notification", err);
        }
      }
    }

    const update = await updateSalesRFQStatus(client, {
      id,
      status,
      noQuoteReasonId: noQuoteReasonId ?? null,
      assignee: status === "Closed" ? null : undefined,
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error("internal", "Failed to update RFQ status", update.error);
    }
    return { id, status };
  }
});

/**
 * Convert a sales RFQ to a quote.
 *
 * @remarks
 * First the sales-rule gate: every RFQ line that names an item is checked as
 * a quote line. An error, or a warning not `acknowledged`, returns
 * `violations` and converts nothing. Then the `convert` server function mints
 * the quote, and every new line that has no prices yet is priced for each of
 * its quantities by its method (Make to Order from its cost rollup, Pull from
 * Inventory from the item's price, Purchase to Order from the supplier's).
 *
 * @mcp
 */
export const convertSalesRfq = defineServiceFn({
  input: z.object({ id: z.string(), acknowledged: z.boolean().default(false) }),
  permission: { create: "sales" },

  async run(ctx, { id, acknowledged }) {
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    // No acknowledgment evidence here: the minted quote's own line checks
    // and finalize/convert gates re-evaluate (and record) everything.
    const gate = await salesDocumentGate(ctx, {
      documentType: "salesRfq",
      documentId: id,
      acknowledged
    });
    if (gate.blocked) return gate.blocked;

    const convert = await convertSalesRfqToQuote(serviceRole, ctx.asSystem.pg, {
      id,
      companyId,
      userId
    });
    if (convert.error || !convert.data?.convertedId) {
      return ctx.error("internal", "Failed to convert RFQ", convert.error);
    }
    const quoteId = convert.data.convertedId;

    // A Make to Order line whose method was copied is priced already;
    // seeding it again was a duplicate insert the database refused.
    const [newLines, priced] = await Promise.all([
      serviceRole
        .from("quoteLine")
        .select("id, methodType, quantity")
        .eq("quoteId", quoteId)
        .eq("companyId", companyId),
      serviceRole
        .from("quoteLinePrice")
        .select("quoteLineId")
        .eq("quoteId", quoteId)
        .eq("companyId", companyId)
    ]);
    const pricedLineIds = new Set(priced.data?.map((p) => p.quoteLineId));
    await Promise.all(
      (newLines.data ?? [])
        .filter((line) => !pricedLineIds.has(line.id))
        .map((line) => {
          const quantities = line.quantity ?? [1];
          if (quantities.length === 0) return null;
          switch (line.methodType) {
            case "Make to Order":
              return calculatePricesForQuantities(
                serviceRole,
                quoteId,
                line.id,
                quantities,
                userId
              );
            case "Pull from Inventory":
              return resolveQuoteLinePrices(
                serviceRole,
                companyId,
                quoteId,
                line.id,
                quantities,
                userId
              );
            case "Purchase to Order":
              return resolvePurchaseToOrderPrices(
                serviceRole,
                companyId,
                quoteId,
                line.id,
                quantities,
                userId
              );
            default:
              return null;
          }
        })
    );

    return { quoteId };
  }
});

/**
 * Attach a dropped file to a sales RFQ line.
 *
 * @remarks
 * With no `lineId`, a new line is created for `customerPartId` first. A 3D
 * model is recorded as a model upload on the line, moved to staging and
 * queued for optimisation; any other file moves to the line's documents.
 */
export const attachSalesRfqFile = defineServiceFn({
  input: salesRfqDragValidator,
  permission: { create: "sales" },

  async run(ctx, input) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    let lineId = input.lineId;
    if (!lineId) {
      const inserted = await upsertSalesRFQLine(client, {
        salesRfqId: input.salesRfqId,
        customerPartId: input.customerPartId,
        quantity: [1],
        unitOfMeasureCode: "EA",
        order: 1,
        description: "",
        companyId,
        createdBy: userId,
        customFields: {}
      });
      if (inserted.error || !inserted.data?.id) {
        return ctx.error(
          "internal",
          "Failed to insert RFQ line",
          inserted.error
        );
      }
      lineId = inserted.data.id;
    }

    const moved = await placeDroppedFile(ctx, {
      documentPath: input.path,
      is3DModel: input.is3DModel,
      size: input.size,
      documentFolder: `opportunity-line/${lineId}`,
      setModel: (modelUploadId) =>
        client
          .from("salesRfqLine")
          .update({ modelUploadId })
          .eq("id", lineId)
          .eq("companyId", companyId),
      lineName: "RFQ line"
    });
    if (moved) return moved;
    return { lineId };
  }
});

/**
 * Move a file dropped on a quote or RFQ line into place. A 3D model gets a
 * `modelUpload` row (linked to the line through `setModel`), its raw file in
 * the staging bucket the optimise job reads, and that job queued. Any other
 * file moves under `documentFolder`.
 */
async function placeDroppedFile(
  ctx: ServiceContext,
  args: {
    documentPath: string;
    is3DModel?: boolean;
    size?: number;
    documentFolder: string;
    setModel: (
      modelUploadId: string
    ) => PromiseLike<{ error: { message: string } | null }>;
    lineName: string;
  }
): Promise<CarbonError | null> {
  const client = ctx.asCaller.supabase;
  const companyId = ctx.company.id;
  const fileName = args.documentPath.split("/").pop();

  if (!args.is3DModel) {
    const move = await storage(client)
      .company(companyId)
      .move(
        args.documentPath,
        `${companyId}/${args.documentFolder}/${fileName}`
      );
    return move.error
      ? ctx.error("internal", "Failed to move file", move.error)
      : null;
  }

  const modelId = nanoid();
  const newPath = `${companyId}/models/${modelId}.${fileName?.split(".").pop()}`;
  const recordCreate = await client.from("modelUpload").insert({
    id: modelId,
    modelPath: newPath,
    name: fileName!,
    size: args.size ?? 0,
    companyId,
    createdBy: ctx.auditUserId
  });
  if (recordCreate.error) {
    return ctx.error(
      "internal",
      "Failed to insert model record",
      recordCreate.error
    );
  }
  const recordUpdate = await args.setModel(modelId);
  if (recordUpdate.error) {
    return ctx.error(
      "internal",
      `Failed to update ${args.lineName} with model`,
      recordUpdate.error
    );
  }

  // Attachments live in the company bucket, raw models in `temp-staging`
  // (2.5 GB) for the optimise and assembly jobs; storage has no
  // cross-bucket move.
  const raw = await storage(client)
    .company(companyId)
    .download(args.documentPath);
  if (!raw.data) {
    return ctx.error("internal", "Failed to read model file", raw.error);
  }
  const staged = await client.storage
    .from(TEMP_STAGING_BUCKET)
    .upload(newPath, raw.data, { upsert: true });
  if (staged.error) {
    return ctx.error("internal", "Failed to stage model file", staged.error);
  }
  await storage(client).company(companyId).remove([args.documentPath]);

  // The thumbnail is rendered by model-optimize on success.
  await trigger("model-optimize", {
    modelUploadId: modelId,
    companyId,
    userId: ctx.auditUserId
  });
  return null;
}

/**
 * Map a sales RFQ's extracted lines to items.
 *
 * @remarks
 * Each mapping maps its line to `itemId`, creates a Make to Order part named
 * `createName` (or reuses the item with that part number), or is ignored.
 * Every line must be on this RFQ and every item and the customer this
 * company's. A mapped line with a customer part number also records it as
 * the customer's part for the item. A line that cannot be mapped does not
 * stop the others; `failed` counts them.
 *
 * @mcp
 */
export const mapSalesRfqLines = defineServiceFn({
  input: z.object({
    rfqId: z.string(),
    customerId: z.string().optional(),
    mappings: z.array(
      z.object({
        lineId: z.string(),
        action: z.enum(["map", "create", "ignore"]),
        itemId: z.string().nullish(),
        createName: z.string().nullish(),
        customerPartId: z.string().nullish(),
        description: z.string().nullish()
      })
    )
  }),
  permission: { update: "sales" },

  async run(ctx, { rfqId, customerId, mappings }) {
    const client = ctx.asCaller.supabase;
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    // The customerPartToItem upsert runs as the service role keyed on
    // (customerId, itemId): a foreign pair would overwrite another
    // company's mapping.
    const active = mappings.filter((map) => map.action !== "ignore");
    const lineIds = [...new Set(active.map((map) => map.lineId))];
    const itemIds = [
      ...new Set(active.flatMap((map) => (map.itemId ? [map.itemId] : [])))
    ];
    if (lineIds.length > 0) {
      const lines = await serviceRole
        .from("salesRfqLine")
        .select("id")
        .eq("salesRfqId", rfqId)
        .eq("companyId", companyId)
        .in("id", lineIds);
      if (lines.error || lines.data.length !== lineIds.length) {
        logger.error("RFQ lines not found for mapping", {
          companyId,
          rfqId,
          lineIds,
          error: lines.error
        });
        return ctx.error("notFound", "RFQ line not found");
      }
    }
    if (itemIds.length > 0) {
      const items = await serviceRole
        .from("item")
        .select("id")
        .eq("companyId", companyId)
        .in("id", itemIds);
      if (items.error || items.data.length !== itemIds.length) {
        logger.error("Items not found for RFQ line mapping", {
          companyId,
          rfqId,
          itemIds,
          error: items.error
        });
        return ctx.error("notFound", "Item not found");
      }
    }
    if (customerId) {
      const refused = await refuseUnlessOwned(ctx, "customer", {
        id: customerId
      });
      if (refused) return refused;
    }

    let failed = 0;
    for (const map of active) {
      let itemId = map.itemId;

      if (map.action === "create") {
        const name = (
          map.createName ||
          map.customerPartId ||
          map.description ||
          ""
        ).trim();
        if (!name) continue;

        // Reuse an item with that part number rather than fail on the unique
        // constraint or create a duplicate.
        const existing = await serviceRole
          .from("item")
          .select("id")
          .eq("companyId", companyId)
          .eq("readableId", name)
          .maybeSingle();
        if (existing.data) {
          itemId = existing.data.id;
        } else {
          // The service role: the sales-scoped client cannot insert items.
          const created = await upsertPart(serviceRole, {
            id: name,
            name,
            revision: "0",
            description: map.description || undefined,
            replenishmentSystem: "Make",
            defaultMethodType: "Make to Order",
            itemTrackingType: "Inventory",
            unitOfMeasureCode: "EA",
            shelfLifeCalculateFromBom: false,
            companyId,
            createdBy: userId
          });
          if (created.error || !created.data?.id) {
            failed++;
            logger.error("Failed to create part for RFQ line", {
              companyId,
              rfqId,
              lineId: map.lineId,
              readableId: name,
              error: created.error
            });
          } else {
            itemId = created.data.id;
          }
        }
      }
      if (!itemId) continue;

      const mapped = await client
        .from("salesRfqLine")
        .update({ itemId, updatedBy: userId })
        .eq("id", map.lineId)
        .eq("companyId", companyId);
      if (mapped.error) {
        failed++;
        logger.error("Failed to map RFQ line to item", {
          companyId,
          rfqId,
          lineId: map.lineId,
          itemId,
          error: mapped.error
        });
        continue;
      }

      if (customerId && map.customerPartId) {
        // customerPartToItem has no audit columns.
        const customerPart = await serviceRole
          .from("customerPartToItem")
          .upsert(
            {
              customerId,
              customerPartId: map.customerPartId,
              itemId,
              companyId
            },
            { onConflict: "customerId,itemId" }
          );
        if (customerPart.error) {
          failed++;
          logger.error("Failed to map customer part to item", {
            companyId,
            customerId,
            itemId,
            customerPartId: map.customerPartId,
            error: customerPart.error
          });
        }
      }
    }

    return { failed };
  }
});

// --- Documents (PDF) --------------------------------------------------------

/**
 * Store a rendered sales document PDF in the company bucket under `folder`
 * and record it as a document of its source, readable by the user who
 * issued it.
 */
async function attachDocumentPdf(
  ctx: ServiceContext,
  args: {
    pdf: Response;
    identifier: string;
    folder: string;
    sourceDocument: "Quote" | "Sales Order" | "Sales Return Order";
    sourceDocumentId: string;
  }
): Promise<
  | { file: ArrayBuffer; fileName: string; documentFilePath: string }
  | CarbonError
> {
  if (args.pdf.headers.get("content-type") !== "application/pdf") {
    return ctx.error("internal", "Failed to generate PDF");
  }
  const companyId = ctx.company.id;
  const file = await args.pdf.arrayBuffer();
  const fileName = stripSpecialCharacters(
    `${args.identifier} - ${datetime.timestamp().slice(0, -5)}.pdf`
  );
  const documentFilePath = `${companyId}/${args.folder}/${fileName}`;

  const upload = await storage(ctx.asSystem.supabase)
    .company(companyId)
    .upload(documentFilePath, file, {
      cacheControl: `${12 * 60 * 60}`,
      contentType: "application/pdf",
      upsert: true
    });
  if (upload.error) {
    return ctx.error(
      "internal",
      "Failed to upload PDF to storage",
      upload.error
    );
  }

  const document = await upsertDocument(ctx.asSystem.supabase, {
    path: documentFilePath,
    name: fileName,
    size: Math.round(file.byteLength / 1024),
    sourceDocument: args.sourceDocument,
    sourceDocumentId: args.sourceDocumentId,
    readGroups: [ctx.auditUserId],
    writeGroups: [ctx.auditUserId],
    createdBy: ctx.auditUserId,
    companyId
  });
  if (document.error) {
    return ctx.error(
      "internal",
      "Failed to create document record",
      document.error
    );
  }
  return { file, fileName, documentFilePath };
}

/** Render a sales order's PDF and attach it to its opportunity. */
async function attachSalesOrderPdf(
  ctx: ServiceContext,
  args: { salesOrderId: string; locale: string }
) {
  const order = await getSalesOrder(ctx.asSystem.supabase, args.salesOrderId);
  if (!order.data?.salesOrderId || !order.data.opportunityId) {
    return ctx.error("internal", "Failed to get sales order", order.error);
  }
  return attachDocumentPdf(ctx, {
    pdf: await renderSalesOrderPdf(ctx.asCaller.supabase, {
      id: args.salesOrderId,
      companyId: ctx.company.id,
      companyGroupId: ctx.company.groupId,
      locale: args.locale
    }),
    identifier: order.data.salesOrderId,
    folder: `opportunity/${order.data.opportunityId}`,
    sourceDocument: "Sales Order",
    sourceDocumentId: args.salesOrderId
  });
}

/** How a document is sent once it is issued. */
const documentNotification = {
  notification: z.enum(["Email", "None"]).optional(),
  customerContact: z.string().optional(),
  cc: z.array(z.string()).optional()
};

// --- Quotes -----------------------------------------------------------------

const quoteFields = [
  "customerId",
  "currencyCode",
  "customerContactId",
  "customerEngineeringContactId",
  "customerLocationId",
  "customerReference",
  "dueDate",
  "estimatorId",
  "expirationDate",
  "locationId",
  "salesPersonId"
] as const;

const quoteLocked = "Cannot modify a locked quote. Reopen it first.";

/**
 * Set one field on one or more quotes.
 *
 * @remarks
 * Refused when any of the quotes is locked. A new customer on a single quote
 * brings its currency. A new currency brings today's exchange rate. An empty
 * value clears the field.
 */
export const updateQuoteField = defineServiceFn({
  input: fieldUpdate(quoteFields),
  permission: { update: "sales" },

  async run(ctx, { ids, field, value }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const quotes = await client
      .from("quote")
      .select("status")
      .in("id", ids)
      .eq("companyId", companyId);
    if (quotes.error) {
      return ctx.error("internal", "Failed to load the quotes", quotes.error);
    }
    if (quotes.data.some((quote) => isQuoteLocked(quote.status))) {
      return ctx.error("rule", quoteLocked);
    }

    let changes: Record<string, string | number | null> = {
      [field]: value || null
    };
    if (field === "customerId") {
      changes = { customerId: value ?? undefined } as typeof changes;
      if (value && ids.length === 1) {
        const customer = await client
          .from("customer")
          .select("currencyCode")
          .eq("id", value)
          .single();
        if (customer.data?.currencyCode) {
          changes.currencyCode = customer.data.currencyCode;
        }
      }
    } else if (field === "currencyCode" && value) {
      const exchangeRate = await getExchangeRate(client, companyId, value);
      if (exchangeRate.error) {
        return ctx.error(
          "internal",
          "Failed to get the exchange rate",
          exchangeRate.error
        );
      }
      changes.exchangeRate = exchangeRate.data;
    }

    const update = await client
      .from("quote")
      .update(
        unchecked({
          ...changes,
          updatedBy: ctx.auditUserId,
          updatedAt: datetime.timestamp()
        })
      )
      .in("id", ids)
      .eq("companyId", companyId);
    if (update.error) {
      return ctx.error("internal", "Failed to update the quotes", update.error);
    }
    return { ids };
  }
});

/**
 * Check one quote or sales order line against the sales rules before it is
 * written. Every quantity break is evaluated: a minimum fires on the smallest,
 * a maximum on the largest. A blocked attempt is recorded; `lineId` is null
 * for a line not created yet.
 */
async function salesLineGate(
  ctx: ServiceContext,
  args: {
    surface: "quoteLine" | "salesOrderLine";
    documentType: "quote" | "salesOrder";
    documentId: string;
    lineId: string | null;
    itemId: string | null;
    quantities: number[];
    customerId: string | null;
    customerLocationId: string | null;
    acknowledged: boolean;
  }
): Promise<{ blocked: SalesRuleCheck | null; check: SalesRuleCheck }> {
  const found = await evaluateSalesRuleLines({
    client: ctx.asSystem.supabase,
    companyId: ctx.company.id,
    userId: ctx.auditUserId,
    surface: args.surface,
    lines: args.quantities.map((quantity) => ({
      lineId: args.lineId ?? "new",
      itemId: args.itemId,
      quantity
    })),
    customerId: args.customerId,
    customerLocationId: args.customerLocationId
  });
  const check = {
    violations: dedupeViolations(found.violations),
    ruleNames: found.ruleNames
  };
  if (
    check.violations.length === 0 ||
    !isBlocked(check.violations, args.acknowledged)
  ) {
    return { blocked: null, check };
  }
  await recordSalesLineOutcome(ctx, args, "blocked", check);
  return { blocked: check, check };
}

/** Record a line check's outcome against the line it is about. */
function recordSalesLineOutcome(
  ctx: ServiceContext,
  line: {
    documentType: "quote" | "salesOrder";
    documentId: string;
    lineId: string | null;
    itemId: string | null;
  },
  outcome: "blocked" | "acknowledged",
  check: SalesRuleCheck
) {
  return recordSalesRuleOutcome(ctx.asSystem.supabase, {
    companyId: ctx.company.id,
    userId: ctx.auditUserId,
    documentType: line.documentType,
    documentId: line.documentId,
    documentLineId: line.lineId,
    itemId: line.itemId,
    outcome,
    ...check
  });
}

/** The configuration a line form posts as JSON text; unreadable means none. */
function parseConfiguration(
  value: unknown
): Record<string, unknown> | undefined {
  if (typeof value !== "string") {
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : undefined;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    logger.error("Failed to parse quote line configuration", { error });
    return undefined;
  }
}

/** A Draft quote this company owns, or why it cannot be changed. */
async function unlockedQuote(ctx: ServiceContext, quoteId: string) {
  const refused = await refuseUnlessOwned(ctx, "quote", { id: quoteId });
  if (refused) return refused;
  const quote = await getQuote(ctx.asCaller.supabase, quoteId);
  if (isQuoteLocked(quote.data?.status)) return ctx.error("rule", quoteLocked);
  return quote.data;
}

/**
 * Add a line to a quote.
 *
 * @remarks
 * Refused while the quote is locked. The line is first checked against the
 * sales rules at every quantity break: an error, or a warning not
 * `acknowledged`, returns `violations` and adds nothing. Then the line is
 * priced by its method: Purchase to Order from the supplier's prices, Pull
 * from Inventory from the item's price, Make to Order by copying the item's
 * method and rolling up its cost. When pricing fails the line is kept and
 * `warning` says what failed.
 *
 * @mcp
 */
export const createQuoteLine = defineServiceFn({
  input: quoteLineValidator.extend({
    customFields: customFieldValues.optional(),
    acknowledged: z.boolean().default(false)
  }),
  permission: { create: "sales" },

  async run(ctx, { id: _id, acknowledged, customFields, ...line }) {
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const quoteId = line.quoteId;

    const quote = await unlockedQuote(ctx, quoteId);
    if (quote instanceof Error) return quote;

    const configuration = parseConfiguration(line.configuration);
    const target = {
      documentType: "quote" as const,
      documentId: quoteId,
      itemId: line.itemId ?? null
    };
    const gate = await salesLineGate(ctx, {
      ...target,
      surface: "quoteLine",
      lineId: null,
      quantities: breakQuantities(line.quantity),
      customerId: quote?.customerId ?? null,
      customerLocationId: quote?.customerLocationId ?? null,
      acknowledged
    });
    if (gate.blocked) return gate.blocked;

    const created = await upsertQuoteLine(serviceRole, {
      ...line,
      companyId,
      configuration,
      createdBy: userId,
      customFields
    });
    if (created.error) {
      return ctx.error(
        "internal",
        "Failed to create quote line.",
        created.error
      );
    }
    const quoteLineId = created.data.id;

    // Evidence once the line exists, so it names the line.
    await recordSalesLineOutcome(
      ctx,
      { ...target, lineId: quoteLineId },
      "acknowledged",
      gate.check
    );

    const warning = await priceNewQuoteLine(ctx, {
      quoteId,
      quoteLineId,
      itemId: line.itemId,
      methodType: line.methodType,
      quantities: line.quantity ?? [1],
      configuration
    });
    return { quoteLineId, warning };
  }
});

/** Price a just-created quote line by its method; a failure is the message. */
async function priceNewQuoteLine(
  ctx: ServiceContext,
  args: {
    quoteId: string;
    quoteLineId: string;
    itemId: string;
    methodType: z.infer<typeof quoteLineValidator>["methodType"];
    quantities: number[];
    configuration?: Record<string, unknown>;
  }
): Promise<string | null> {
  const serviceRole = ctx.asSystem.supabase;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const { quoteId, quoteLineId, quantities } = args;

  if (args.methodType === "Purchase to Order") {
    const priced = await resolvePurchaseToOrderPrices(
      serviceRole,
      companyId,
      quoteId,
      quoteLineId,
      quantities,
      userId
    );
    return priced?.error ? "Failed to resolve Purchase to Order prices" : null;
  }
  if (args.methodType === "Pull from Inventory") {
    const priced = await resolveQuoteLinePrices(
      serviceRole,
      companyId,
      quoteId,
      quoteLineId,
      quantities,
      userId
    );
    return priced?.error
      ? "Failed to resolve Pull from Inventory prices"
      : null;
  }
  if (args.methodType === "Make to Order") {
    const method = await upsertQuoteLineMethod(serviceRole, ctx.asSystem.pg, {
      quoteId,
      quoteLineId,
      itemId: args.itemId,
      configuration: args.configuration,
      companyId,
      userId
    });
    if (method.error) return "Failed to create quote line method.";
    const priced = await recalculateQuoteLinePrices(
      serviceRole,
      companyId,
      quoteId,
      quoteLineId,
      userId
    );
    return priced?.error ? "Failed to recalculate quote line prices" : null;
  }
  return null;
}

/**
 * Change a quote line.
 *
 * @remarks
 * Refused while the quote is locked. The line is first checked against the
 * sales rules at every quantity break (see `createQuoteLine`). Then its
 * quantity breaks are reconciled: a break no longer offered loses its price,
 * and a new break of a Make to Order, Pull from Inventory or Purchase to
 * Order line is priced. The prices are computed before anything is written,
 * and the line and its prices are saved in one transaction.
 *
 * @mcp
 */
export const updateQuoteLine = defineServiceFn({
  input: quoteLineValidator.extend({
    id: z.string(),
    customFields: customFieldValues.optional(),
    acknowledged: z.boolean().default(false)
  }),
  permission: { create: "sales" },

  async run(ctx, { id: lineId, acknowledged, customFields, ...line }) {
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const quoteId = line.quoteId;

    // The writes below bypass RLS and key on these ids.
    const refused = await refuseUnlessOwned(ctx, "quoteLine", {
      id: lineId,
      quoteId
    });
    if (refused) return refused;
    const quote = await unlockedQuote(ctx, quoteId);
    if (quote instanceof Error) return quote;

    const target = {
      documentType: "quote" as const,
      documentId: quoteId,
      lineId,
      itemId: line.itemId ?? null
    };
    const gate = await salesLineGate(ctx, {
      ...target,
      surface: "quoteLine",
      quantities: breakQuantities(line.quantity),
      customerId: quote?.customerId ?? null,
      customerLocationId: quote?.customerLocationId ?? null,
      acknowledged
    });
    if (gate.blocked) return gate.blocked;

    const existing = await serviceRole
      .from("quoteLinePrice")
      .select("quantity")
      .eq("quoteLineId", lineId)
      .eq("companyId", companyId);
    if (existing.error) {
      return ctx.error(
        "internal",
        "Failed to read existing quote line prices",
        existing.error
      );
    }

    // Pruning is unconditional: a break removed from any line would
    // otherwise render as a selectable option on the customer share page.
    const { added, removed } = reconcileQuantityBreaks(
      existing.data.map((p) => p.quantity),
      line.quantity ?? []
    );

    let priceRows: QuoteLinePriceRow[] = [];
    if (added.length > 0) {
      // The stored line still holds the old item: pass the new one.
      const built =
        line.methodType === "Make to Order"
          ? await buildMakeToOrderPriceRows(
              serviceRole,
              quoteId,
              lineId,
              added,
              userId,
              line.itemId
            )
          : line.methodType === "Pull from Inventory"
            ? await buildPullFromInventoryPriceRows(
                serviceRole,
                companyId,
                quoteId,
                lineId,
                added,
                userId,
                line.itemId
              )
            : line.methodType === "Purchase to Order"
              ? await buildPurchaseToOrderPriceRows(
                  serviceRole,
                  companyId,
                  quoteId,
                  lineId,
                  added,
                  userId,
                  line.itemId
                )
              : null;
      if (built?.error) {
        return ctx.error(
          "internal",
          `Failed to calculate ${line.methodType} prices for new quantities`,
          built.error
        );
      }
      priceRows = built?.rows ?? [];
    }

    try {
      await saveQuoteLineWithPrices({
        companyId,
        quoteId,
        lineId,
        line: {
          ...sanitize({ ...line, updatedBy: userId }),
          customFields
        },
        removedQuantities: removed,
        priceRows
      });
    } catch (err) {
      // A rollback: nothing was written.
      return ctx.error("internal", "Failed to update quote line", err);
    }

    // Evidence only for a change that landed.
    await recordSalesLineOutcome(ctx, target, "acknowledged", gate.check);
    return { quoteLineId: lineId };
  }
});

/**
 * Finalize a quote and send it to the customer.
 *
 * @remarks
 * In order: the customer must have a reachable contact when the company
 * requires one; the sales-rule gate re-checks every line (an error, or a
 * warning not `acknowledged`, returns `violations` and changes nothing); the
 * quote gets its share link; its PDF is filed on the opportunity; the quote
 * is set Sent and its lines Complete. With `notification` Email the PDF is
 * then emailed to `customerContact` (and `cc`); when that fails the quote is
 * still Sent and `warning` says so. `locale` formats the PDF.
 *
 * @mcp
 */
export const finalizeAndSendQuote = defineServiceFn({
  input: z.object({
    quoteId: z.string(),
    acknowledged: z.boolean().default(false),
    ...documentNotification,
    locale: z.string().default("en-US")
  }),
  permission: { create: "sales" },

  async run(ctx, input) {
    const { quoteId, notification, customerContact, cc, locale } = input;
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    if (notification === "Email" && !customerContact) {
      return ctx.error("validation", "Customer contact is required for email");
    }

    const refused = await refuseUnlessOwned(ctx, "quote", { id: quoteId });
    if (refused) return refused;
    const quote = await getQuote(serviceRole, quoteId);
    if (quote.error) {
      return ctx.error("internal", "Failed to get quote", quote.error);
    }

    // A customer with no reachable contact cannot be created at a connected
    // platform, so its documents are rejected there long after anyone is
    // watching. Refuse at issue time, while the record can still be fixed.
    const contactRequired = await checkPartyContactRequirement(
      serviceRole,
      companyId,
      { kind: "customer", id: quote.data.customerId }
    );
    if (contactRequired) return ctx.error("rule", contactRequired);

    // Before the share link and the PDF, so a blocked quote produces neither.
    const gate = await salesDocumentGate(ctx, {
      documentType: "quote",
      documentId: quoteId,
      acknowledged: input.acknowledged
    });
    if (gate.blocked) return gate.blocked;

    const link = await upsertExternalLink(serviceRole, {
      id: quote.data.externalLinkId ?? undefined,
      documentType: "Quote",
      documentId: quoteId,
      customerId: quote.data.customerId,
      expiresAt: quote.data.expirationDate,
      companyId
    });
    if (link.data && quote.data.externalLinkId !== link.data.id) {
      await serviceRole
        .from("quote")
        .update({
          externalLinkId: link.data.id,
          completedDate: datetime.timestamp()
        })
        .eq("id", quoteId)
        .eq("companyId", companyId);
    }

    const pdf = await attachDocumentPdf(ctx, {
      pdf: await renderQuotePdf(ctx.asCaller.supabase, {
        id: quoteId,
        companyId,
        companyGroupId: ctx.company.groupId,
        locale
      }),
      identifier: getQuoteDisplayId(quote.data),
      folder: `opportunity/${quote.data.opportunityId}`,
      sourceDocument: "Quote",
      sourceDocumentId: quoteId
    });
    if (pdf instanceof Error) return pdf;

    const finalized = await finalizeQuote(
      serviceRole,
      quoteId,
      userId,
      companyId
    );
    if (finalized.error) {
      return ctx.error("internal", "Failed to finalize quote", finalized.error);
    }

    // Evidence only once the finalize has committed.
    await recordSalesRuleOutcome(serviceRole, {
      companyId,
      userId,
      documentType: "quote",
      documentId: quoteId,
      outcome: "acknowledged",
      ...gate.check
    });

    if (notification !== "Email" || !customerContact) {
      return { quoteId, warning: null };
    }
    try {
      await emailQuote(ctx, {
        quote: quote.data,
        customerContactId: customerContact,
        cc,
        ...pdf
      });
      return { quoteId, warning: null };
    } catch (err) {
      logger.error("Failed to email the finalized quote", {
        companyId,
        quoteId,
        error: err
      });
      return { quoteId, warning: "Failed to send email" };
    }
  }
});

/** Email a finalized quote's PDF to its customer contact. Throws on failure. */
async function emailQuote(
  ctx: ServiceContext,
  args: {
    quote: NonNullable<Awaited<ReturnType<typeof getQuote>>["data"]>;
    customerContactId: string;
    cc?: string[];
    fileName: string;
    documentFilePath: string;
  }
) {
  const serviceRole = ctx.asSystem.supabase;
  const companyId = ctx.company.id;
  const [company, companySettings, customer, customerContact, user] =
    await Promise.all([
      getCompany(serviceRole, companyId),
      getCompanySettings(serviceRole, companyId),
      getCustomer(serviceRole, args.quote.customerId!),
      getCustomerContact(serviceRole, args.customerContactId, companyId),
      getUser(serviceRole, ctx.auditUserId)
    ]);
  if (!company.data) throw new Error("Failed to get company");
  if (!companySettings.data) throw new Error("Failed to get company settings");
  if (!customer.data) throw new Error("Failed to get customer");
  if (!customerContact.data) throw new Error("Failed to get customer contact");
  if (!user.data) throw new Error("Failed to get user");

  const emailTemplate = QuoteEmail({
    // @ts-expect-error TS2739 - TODO: fix type
    company: company.data,
    companySettings: companySettings.data,
    // @ts-expect-error
    quote: args.quote,
    recipient: {
      email: customerContact.data.contact!.email!,
      firstName: customerContact.data.contact!.firstName!,
      lastName: customerContact.data.contact!.lastName!
    },
    sender: {
      email: user.data.email,
      firstName: user.data.firstName,
      lastName: user.data.lastName
    }
  });
  const html = await renderAsync(emailTemplate);
  const text = await renderAsync(emailTemplate, { plainText: true });
  const signed = await storage(serviceRole)
    .company(companyId)
    .createSignedUrl(args.documentFilePath, 3600);
  if (signed.error) {
    logger.error("Failed to create signed URL for attachment", {
      storagePath: args.documentFilePath,
      error: signed.error
    });
  }

  await trigger("send-email", {
    to: [user.data.email, customerContact.data.contact!.email!],
    cc: args.cc?.length ? args.cc : undefined,
    from: user.data.email,
    subject: `Quote ${getQuoteDisplayId(args.quote)}`,
    html,
    text,
    attachments: signed.data
      ? [{ path: signed.data.signedUrl, filename: args.fileName }]
      : undefined,
    companyId
  });
}

/**
 * Convert a quote to a sales order.
 *
 * @remarks
 * `selectedLines` maps each quote line to the quantity break and prices to
 * order; a line with quantity 0 is not converted. First the sales-rule gate
 * re-checks the lines that convert (an error, or a warning not
 * `acknowledged`, returns `violations` and converts nothing). Then the
 * `convert` server function creates the order with `purchaseOrderNumber`.
 * Its PDF is filed on the opportunity and, with `notification` Email,
 * emailed to `customerContact`; those two never fail the conversion.
 *
 * @mcp
 */
export const convertQuote = defineServiceFn({
  input: z.object({
    quoteId: z.string(),
    selectedLines: selectedLinesValidator,
    purchaseOrderNumber: z.string().optional(),
    acknowledged: z.boolean().default(false),
    ...documentNotification,
    locale: z.string().default("en-US")
  }),
  permission: { create: "sales" },

  async run(ctx, input) {
    const { quoteId, selectedLines, notification, customerContact } = input;
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const refused = await refuseUnlessOwned(ctx, "quote", { id: quoteId });
    if (refused) return refused;

    // A deselected line never becomes an order line, so its violations
    // neither block nor leave evidence.
    const gate = await salesDocumentGate(ctx, {
      documentType: "quote",
      documentId: quoteId,
      acknowledged: input.acknowledged,
      lineIds: convertingLineIds(selectedLines)
    });
    if (gate.blocked) return gate.blocked;

    const convert = await convertQuoteToOrder(serviceRole, ctx.asSystem.pg, {
      id: quoteId,
      purchaseOrderNumber: input.purchaseOrderNumber ?? "",
      companyId,
      userId,
      selectedLines
    });
    if (convert.error || !convert.data?.convertedId) {
      return ctx.error(
        "internal",
        getErrorMessage(convert.error, "Failed to convert quote to order"),
        convert.error
      );
    }
    const salesOrderId = convert.data.convertedId;

    await recordSalesRuleOutcome(serviceRole, {
      companyId,
      userId,
      documentType: "quote",
      documentId: quoteId,
      outcome: "acknowledged",
      ...gate.check
    });

    // Neither the PDF nor the email holds up the new order.
    try {
      const pdf = await attachSalesOrderPdf(ctx, {
        salesOrderId,
        locale: input.locale
      });
      if (pdf instanceof Error) throw pdf;
      if (notification === "Email" && customerContact) {
        await sendSalesOrderEmail({
          salesOrderId,
          companyId,
          companyGroupId: ctx.company.groupId,
          userId,
          customerContactId: customerContact,
          cc: input.cc,
          documentFilePath: pdf.documentFilePath,
          fileName: pdf.fileName,
          serviceRole,
          locales: [input.locale]
        });
      }
    } catch (err) {
      logger.error("Failed to generate PDF or send email after conversion", {
        companyId,
        salesOrderId,
        error: err
      });
    }

    return { salesOrderId };
  }
});

/** The quote lines `selectedLines` converts: those ordered in a quantity. */
function convertingLineIds(
  selectedLines: z.infer<typeof selectedLinesValidator>
): Set<string> {
  return new Set(
    Object.entries(selectedLines)
      .filter(([, line]) => (line.quantity ?? 0) > 0)
      .map(([lineId]) => lineId)
  );
}

/**
 * Configure a Make to Order quote line.
 *
 * @remarks
 * Saves the configuration on the line, clears its prices, copies the item's
 * method for that configuration, then prices its Purchase to Order materials
 * from supplier price breaks (a typed cost is left alone).
 */
export const configureQuoteLine = defineServiceFn({
  input: z.object({
    quoteId: z.string(),
    lineId: z.string(),
    configuration: z.record(z.string(), z.unknown())
  }),
  permission: { update: "production" },

  async run(ctx, { quoteId, lineId, configuration }) {
    const client = ctx.asCaller.supabase;
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const refused = await refuseUnlessOwned(ctx, "quoteLine", {
      id: lineId,
      quoteId
    });
    if (refused) return refused;

    const [updated, quoteLine] = await Promise.all([
      client
        .from("quoteLine")
        .update({
          configuration: configuration as Json,
          updatedAt: datetime.timestamp(),
          updatedBy: userId
        })
        .eq("id", lineId),
      client.from("quoteLine").select("itemId").eq("id", lineId).single(),
      client.from("quoteLinePrice").delete().eq("quoteLineId", lineId)
    ]);
    if (updated.error) {
      return ctx.error(
        "internal",
        "Failed to update quote line",
        updated.error
      );
    }
    if (quoteLine.error) {
      return ctx.error("internal", "Failed to get quote line", quoteLine.error);
    }

    const method = await upsertQuoteLineMethod(serviceRole, ctx.asSystem.pg, {
      quoteId,
      quoteLineId: lineId,
      itemId: quoteLine.data.itemId,
      configuration,
      companyId,
      userId
    });
    if (method.error) {
      return ctx.error(
        "internal",
        "Failed to update quote line method",
        method.error
      );
    }

    const buyMaterials = await serviceRole
      .from("quoteMaterial")
      .select("id, itemId, unitCost, unitCostSource")
      .eq("quoteLineId", lineId)
      .eq("companyId", companyId)
      .eq("methodType", "Purchase to Order");
    const priceMap = await getSupplierPriceBreaksForItems(serviceRole, [
      ...new Set((buyMaterials.data ?? []).map((m) => m.itemId))
    ]);
    for (const material of buyMaterials.data ?? []) {
      if (material.unitCostSource === "manual") continue;
      const unitCost = resolveBuyUnitCost(material, 1, priceMap);
      if (unitCost !== material.unitCost) {
        await serviceRole
          .from("quoteMaterial")
          .update({ unitCost })
          .eq("id", material.id)
          .eq("companyId", companyId);
      }
    }
    return { lineId };
  }
});

/**
 * Attach a dropped file to a quote line.
 *
 * @remarks
 * With no `lineId`, a Make to Order part is created first, named after the
 * file (its part number and revision read from the name, with a suffix when
 * that revision exists), then a quote line for it with its method. A 3D model
 * becomes the line's (and its item's) model and is queued for optimisation;
 * any other file moves to the line's documents.
 */
export const attachQuoteFile = defineServiceFn({
  input: z.object({
    quoteId: z.string(),
    name: z.string(),
    size: z.number(),
    path: z.string(),
    lineId: z.string().optional()
  }),
  permission: { create: "sales" },

  async run(
    ctx,
    { quoteId, name: fileName, size, path: documentPath, ...input }
  ) {
    const client = ctx.asCaller.supabase;
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;

    // Lines and parts are created with the service role.
    const refused = await refuseUnlessOwned(ctx, "quote", { id: quoteId });
    if (refused) return refused;

    let lineId = input.lineId;
    let partId: string | undefined;
    if (!lineId) {
      const created = await createQuoteLineForFile(ctx, { quoteId, fileName });
      if (created instanceof Error) return created;
      ({ lineId, partId } = created);
    } else {
      const existing = await serviceRole
        .from("quoteLine")
        .select("itemId")
        .eq("id", lineId)
        .eq("quoteId", quoteId)
        .eq("companyId", companyId)
        .single();
      if (existing.error || !existing.data) {
        return ctx.error(
          "notFound",
          "Failed to find quote line",
          existing.error
        );
      }
      partId = existing.data.itemId;
    }

    const extension = fileName.split(".").pop();
    const placed = await placeDroppedFile(ctx, {
      documentPath,
      is3DModel: !!extension && supportedModelTypes.includes(extension),
      size,
      documentFolder: `opportunity-line/${lineId}`,
      setModel: async (modelUploadId) => {
        // A failed link is logged; the model is still optimised.
        const [lineUpdate] = await Promise.all([
          client.from("quoteLine").update({ modelUploadId }).eq("id", lineId),
          partId
            ? client
                .from("item")
                .update({ modelUploadId })
                .eq("id", partId)
                .eq("companyId", companyId)
            : null
        ]);
        if (lineUpdate.error) {
          logger.error("Failed to link model to quote line", {
            companyId,
            error: lineUpdate.error
          });
        }
        return { error: null };
      },
      lineName: "quote line"
    });
    if (placed) return placed;
    return { quoteLineId: lineId };
  }
});

/** A Make to Order part and a quote line for a file dropped on the quote. */
async function createQuoteLineForFile(
  ctx: ServiceContext,
  { quoteId, fileName }: { quoteId: string; fileName: string }
): Promise<{ lineId: string; partId: string } | CarbonError> {
  const serviceRole = ctx.asSystem.supabase;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const partName = fileName.replace(/\.[^/.]+$/, "");

  let readableId = partName;
  let revision = "0";
  try {
    const { output } = await generateText({
      model: openai("gpt-4o-mini"),
      output: Output.object({
        schema: z.object({
          partId: z
            .string()
            .describe("The part identifier extracted from the filename"),
          revision: z
            .string()
            .nullable()
            .describe("The revision number if present, null if not found")
        })
      }),
      prompt: `Extract the part ID and revision from this filename: "${partName}". The part ID should be the main identifier, and revision should be any version/revision indicator if present.`
    });
    readableId = output.partId;
    revision = output.revision || "0";
  } catch (error) {
    logger.error("Failed to parse part filename", { error });
  }

  // A revision that exists already gets a suffix.
  let suffix = 1;
  while (true) {
    const existing = await serviceRole
      .from("item")
      .select("id")
      .eq("readableId", readableId)
      .eq("revision", revision)
      .eq("companyId", companyId)
      .single();
    if (existing.error || !existing.data) break;
    revision = `${revision} (${suffix})`;
    suffix++;
  }

  const part = await upsertPart(serviceRole, {
    id: readableId,
    name: readableId,
    defaultMethodType: "Make to Order",
    itemTrackingType: "Inventory",
    replenishmentSystem: "Make",
    revision,
    unitOfMeasureCode: "EA",
    shelfLifeCalculateFromBom: false,
    companyId,
    createdBy: userId
  });
  if (part.error || !part.data?.id) {
    return ctx.error("internal", "Failed to create part", part.error);
  }
  const partId = part.data.id;

  const line = await upsertQuoteLine(serviceRole, {
    quoteId,
    itemId: partId,
    status: "Not Started",
    estimatorId: userId,
    description: partName,
    methodType: "Make to Order",
    customerPartId: partName,
    customerPartRevision: "",
    unitOfMeasureCode: "EA",
    taxPercent: 0,
    quantity: [1],
    companyId,
    createdBy: userId
  });
  if (line.error || !line.data) {
    return ctx.error("internal", "Failed to create quote line.", line.error);
  }

  const method = await upsertQuoteLineMethod(serviceRole, ctx.asSystem.pg, {
    quoteId,
    quoteLineId: line.data.id,
    itemId: partId,
    configuration: undefined,
    companyId,
    userId
  });
  if (method.error) {
    return ctx.error(
      "internal",
      "Failed to create quote line method.",
      method.error
    );
  }
  return { lineId: line.data.id, partId };
}

// --- Digital quotes (the customer's share link) ------------------------------

/**
 * The context a quote's share link acts in. The link is the only credential,
 * so it runs as the system, in the quote's company, on behalf of the quote's
 * creator. Null when the company cannot be read.
 */
export async function shareLinkContext(quote: {
  companyId: string;
  createdBy: string;
}): Promise<ServiceContext | null> {
  const company = await getCarbonServiceRole()
    .from("company")
    .select("companyGroupId")
    .eq("id", quote.companyId)
    .single();
  if (!company.data?.companyGroupId) return null;
  return createServiceContext({
    actor: { type: "system", onBehalfOf: quote.createdBy },
    company: { id: quote.companyId, groupId: company.data.companyGroupId },
    caller: getCarbonServiceRole(),
    system: getCarbonServiceRole,
    pg: getDatabaseClient,
    kv: () => redis
  });
}

const digitalQuoteClosed = "This quote is no longer available for a response.";

/** The quote a share link answers, while it still awaits a response. */
async function sentQuote(ctx: ServiceContext, quoteId: string) {
  const quote = await ctx.asSystem.supabase
    .from("quote")
    .select("*")
    .eq("id", quoteId)
    .eq("companyId", ctx.company.id)
    .single();
  if (quote.error) return ctx.error("notFound", "Quote not found", quote.error);
  // Without this a replayed link creates duplicate orders, or flips an
  // ordered quote back to Lost.
  if (quote.data.status !== "Sent")
    return ctx.error("rule", digitalQuoteClosed);
  return quote.data;
}

/** Tell the company's digital-quote group that a customer answered. */
async function notifyDigitalQuoteResponse(
  ctx: ServiceContext,
  quoteId: string
): Promise<CarbonError | null> {
  const settings = await getCompanySettings(
    ctx.asSystem.supabase,
    ctx.company.id
  );
  if (settings.error) {
    return ctx.error("internal", "Failed to send notification", settings.error);
  }
  const groupIds = settings.data?.digitalQuoteNotificationGroup ?? [];
  if (groupIds.length === 0) return null;
  try {
    await trigger("notify", {
      companyId: ctx.company.id,
      documentId: quoteId,
      event: NotificationEvent.DigitalQuoteResponse,
      recipient: { type: "group", groupIds }
    });
    return null;
  } catch (err) {
    return ctx.error("internal", "Failed to send notification", err);
  }
}

/**
 * The customer accepts a sent quote from its share link.
 *
 * @remarks
 * Only while the quote is Sent, with at least one line selected. A sales
 * rule error on a selected line refuses with a neutral message (the customer
 * must never read internal compliance text) and is recorded for the seller;
 * warnings are logged and the order proceeds. The quote converts to a sales
 * order with the customer's name and email, its PDF is filed, the company's
 * digital-quote group is notified, and an attached purchase order file is
 * stored on the opportunity (its name, without `.pdf`, is the PO number).
 */
export const acceptDigitalQuote = defineServiceFn({
  input: z.object({
    quoteId: z.string(),
    selectedLines: selectedLinesValidator,
    acceptedBy: z.string(),
    acceptedByEmail: z.string(),
    purchaseOrderFile: z.instanceof(File).optional()
  }),
  permission: "system",

  async run(
    ctx,
    { quoteId, selectedLines, purchaseOrderFile: file, ...input }
  ) {
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const quote = await sentQuote(ctx, quoteId);
    if (quote instanceof Error) return quote;

    const accepted = convertingLineIds(selectedLines);
    if (accepted.size === 0) {
      return ctx.error("rule", "Select at least one item to accept the quote.");
    }

    // The name becomes a storage key segment on an unauthenticated endpoint.
    const uploadFileName = file ? safeStorageFileName(file.name) : null;
    if (file && !uploadFileName) {
      logger.error("Rejected digital quote upload file name", {
        quoteId,
        companyId,
        fileName: file.name
      });
      return ctx.error("validation", "Invalid file name");
    }
    const purchaseOrderNumber =
      file && file.name.toLowerCase().endsWith(".pdf")
        ? file.name.replace(/\.pdf$/i, "")
        : "";

    // Nobody here may acknowledge a warning: errors refuse, warnings pass.
    const gate = await salesDocumentGate(ctx, {
      documentType: "quote",
      documentId: quoteId,
      acknowledged: true,
      lineIds: accepted
    });
    if (gate.blocked) {
      logger.error("Digital quote acceptance blocked by sales rules", {
        quoteId,
        companyId,
        violations: gate.blocked.violations
      });
      return ctx.error(
        "rule",
        "This quote can no longer be accepted online. Please contact your sales representative."
      );
    }
    if (gate.check.violations.length > 0) {
      logger.warn("Digital quote accepted with sales rule warnings", {
        quoteId,
        companyId,
        violations: gate.check.violations
      });
    }

    const convert = await convertQuoteToOrder(serviceRole, ctx.asSystem.pg, {
      id: quoteId,
      companyId,
      userId: ctx.auditUserId,
      selectedLines,
      digitalQuoteAcceptedBy: input.acceptedBy,
      digitalQuoteAcceptedByEmail: input.acceptedByEmail,
      purchaseOrderNumber
    });
    if (convert.error) {
      return ctx.error(
        "internal",
        "Failed to convert quote to order",
        convert.error
      );
    }

    const salesOrderId = convert.data?.convertedId;
    if (salesOrderId) {
      // The order stands without its PDF.
      const pdf = await attachSalesOrderPdf(ctx, {
        salesOrderId,
        locale: "en-US"
      }).catch((err: unknown) => err);
      if (pdf instanceof Error) {
        logger.error("Failed to generate PDF after digital quote acceptance", {
          companyId,
          salesOrderId,
          error: pdf
        });
      }
    }

    const notified = await notifyDigitalQuoteResponse(ctx, quoteId);
    if (notified) return notified;

    if (file && uploadFileName) {
      const purchaseOrderDocumentPath = `${companyId}/opportunity/${quote.opportunityId}/${uploadFileName}`;
      const upload = await storage(serviceRole)
        .company(companyId)
        .upload(purchaseOrderDocumentPath, file);
      if (upload.error) {
        return ctx.error("internal", "Failed to upload file", upload.error);
      }
      const opportunity = await serviceRole
        .from("opportunity")
        .update({ purchaseOrderDocumentPath })
        .eq("id", quote.opportunityId!)
        .eq("companyId", companyId);
      if (opportunity.error) {
        logger.error("Failed to update opportunity", {
          companyId,
          error: opportunity.error
        });
      }
    }

    return { salesOrderId: salesOrderId ?? null };
  }
});

/**
 * The customer rejects a sent quote from its share link.
 *
 * @remarks
 * Only while the quote is Sent: it becomes Lost with the customer's name and
 * email, and the company's digital-quote group is notified.
 */
export const rejectDigitalQuote = defineServiceFn({
  input: z.object({
    quoteId: z.string(),
    rejectedBy: z.string(),
    rejectedByEmail: z.string()
  }),
  permission: "system",

  async run(ctx, { quoteId, rejectedBy, rejectedByEmail }) {
    const quote = await sentQuote(ctx, quoteId);
    if (quote instanceof Error) return quote;

    const rejected = await ctx.asSystem.supabase
      .from("quote")
      .update({
        status: "Lost",
        digitalQuoteRejectedBy: rejectedBy,
        digitalQuoteRejectedByEmail: rejectedByEmail
      })
      .eq("id", quoteId)
      .eq("companyId", ctx.company.id);
    if (rejected.error) {
      return ctx.error("internal", "Failed to reject quote", rejected.error);
    }

    const notified = await notifyDigitalQuoteResponse(ctx, quoteId);
    if (notified) return notified;
    return { quoteId };
  }
});

// --- Sales orders -------------------------------------------------------------

const salesOrderFields = [
  "customerId",
  "currencyCode",
  "customerContactId",
  "customerEngineeringContactId",
  "customerLocationId",
  "customerReference",
  "exchangeRate",
  "expirationDate",
  "locationId",
  "orderDate",
  "salesPersonId",
  "receiptPromisedDate",
  "receiptRequestedDate"
] as const;

/**
 * Set one field on one or more sales orders.
 *
 * @remarks
 * Refused once any of the orders is confirmed. A new customer on a single
 * order brings its currency and today's exchange rate; so does a new
 * currency. The requested and promised dates are the shipment's. An empty
 * value clears the field.
 */
export const updateSalesOrderField = defineServiceFn({
  input: fieldUpdate(salesOrderFields),
  permission: { update: "sales" },

  async run(ctx, { ids, field, value }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const orders = await client
      .from("salesOrder")
      .select("status")
      .in("id", ids)
      .eq("companyId", companyId);
    if (orders.error) {
      return ctx.error("internal", "Failed to load the orders", orders.error);
    }
    if (orders.data.some((order) => isSalesOrderLocked(order.status))) {
      return ctx.error("rule", "Cannot modify a confirmed sales order.");
    }

    const audit = {
      updatedBy: ctx.auditUserId,
      updatedAt: datetime.timestamp()
    };
    const withRate = async (currencyCode: string) => {
      const rate = await getExchangeRate(client, companyId, currencyCode);
      return rate.error
        ? ctx.error("internal", "Failed to get the exchange rate", rate.error)
        : { currencyCode, exchangeRate: rate.data };
    };

    let table: "salesOrder" | "salesOrderShipment" = "salesOrder";
    let changes: Record<string, unknown> = { [field]: value || null };
    if (field === "customerId") {
      changes = { customerId: value ?? undefined };
      if (value && ids.length === 1) {
        const customer = await client
          .from("customer")
          .select("currencyCode")
          .eq("id", value)
          .single();
        if (customer.data?.currencyCode) {
          const currency = await withRate(customer.data.currencyCode);
          if (currency instanceof Error) return currency;
          changes = { ...changes, ...currency };
        }
      }
    } else if (field === "currencyCode" && value) {
      const currency = await withRate(value);
      if (currency instanceof Error) return currency;
      changes = currency;
    } else if (
      field === "receiptPromisedDate" ||
      field === "receiptRequestedDate"
    ) {
      table = "salesOrderShipment";
    }

    const update = await client
      .from(table)
      .update(unchecked({ ...changes, ...audit }))
      .in("id", ids)
      .eq("companyId", companyId);
    if (update.error) {
      return ctx.error("internal", "Failed to update the orders", update.error);
    }
    return { ids };
  }
});

/**
 * Confirm a sales order.
 *
 * @remarks
 * In order: the customer must have a reachable contact when the company
 * requires one; the sales-rule gate re-checks every line (an error, or a
 * warning not `acknowledged`, returns `violations` and confirms nothing);
 * the order's PDF is filed; with `notification` Email it is sent to
 * `customerContact` (and `cc`). Only then does the order take its status
 * from its lines, with today as the order date when it had none. MRP then
 * plans it. A failed PDF or email leaves the order unconfirmed.
 *
 * @mcp
 */
export const confirmSalesOrder = defineServiceFn({
  input: z.object({
    salesOrderId: z.string(),
    acknowledged: z.boolean().default(false),
    ...documentNotification,
    locale: z.string().default("en-US")
  }),
  permission: { create: "sales" },

  async run(ctx, input) {
    const { salesOrderId, notification, customerContact } = input;
    const client = ctx.asCaller.supabase;
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const refused = await refuseUnlessOwned(ctx, "salesOrder", {
      id: salesOrderId
    });
    if (refused) return refused;
    const order = await getSalesOrder(serviceRole, salesOrderId);
    if (order.error) {
      return ctx.error("internal", "Failed to get sales order", order.error);
    }

    // Off by default: only for a company that asked for the policy.
    const contactRequired = await checkPartyContactRequirement(
      client,
      companyId,
      { kind: "customer", id: order.data.customerId }
    );
    if (contactRequired) return ctx.error("rule", contactRequired);

    // Before the PDF, so a blocked order does not get one.
    const gate = await salesDocumentGate(ctx, {
      documentType: "salesOrder",
      documentId: salesOrderId,
      acknowledged: input.acknowledged
    });
    if (gate.blocked) return gate.blocked;

    const pdf = await attachSalesOrderPdf(ctx, {
      salesOrderId,
      locale: input.locale
    }).catch((err: unknown) =>
      ctx.error("internal", "Failed to generate PDF", err)
    );
    if (pdf instanceof Error) {
      return ctx.error("internal", "Failed to generate PDF", pdf);
    }

    if (notification === "Email") {
      if (!customerContact) {
        return ctx.error("validation", "Customer contact is required");
      }
      const sent = await sendSalesOrderEmail({
        salesOrderId,
        companyId,
        companyGroupId: ctx.company.groupId,
        userId,
        customerContactId: customerContact,
        cc: input.cc,
        documentFilePath: pdf.documentFilePath,
        fileName: pdf.fileName,
        serviceRole,
        locales: [input.locale]
      }).catch((err: unknown) => ({
        success: false,
        message: undefined,
        error: err
      }));
      if (!sent.success) {
        return ctx.error("internal", sent.message ?? "Failed to send email");
      }
    }

    const lines = await getSalesOrderLines(serviceRole, salesOrderId);
    const { status } = getSalesOrderStatus(lines.data || []);
    const confirmed = await client
      .from("salesOrder")
      .update({
        status,
        orderDate:
          order.data.orderDate ??
          datetime
            .today(await getCompanyTimeZone(client, companyId))
            .toString(),
        updatedAt: datetime.timestamp(),
        updatedBy: userId
      })
      .eq("id", salesOrderId);
    if (confirmed.error) {
      return ctx.error(
        "internal",
        "Failed to confirm sales order",
        confirmed.error
      );
    }

    // Evidence only once the confirm has committed.
    await recordSalesRuleOutcome(serviceRole, {
      companyId,
      userId,
      documentType: "salesOrder",
      documentId: salesOrderId,
      outcome: "acknowledged",
      ...gate.check
    });

    await runMRP(serviceRole, ctx.asSystem.pg, {
      type: "salesOrder",
      id: salesOrderId,
      companyId,
      userId
    });

    trackWorkEvent("sales_order_confirmed", {
      companyId,
      userId,
      salesOrderId,
      lineCount: lines.data?.length ?? 0,
      derivedStatus: status,
      emailed: notification === "Email"
    });
    return { salesOrderId, status };
  }
});

/** A sales order line keeps only the target its type uses. */
function withLineTarget<
  L extends {
    salesOrderLineType: string;
    accountId?: string;
    assetId?: string;
    itemId?: string;
  }
>(line: L): L {
  if (line.salesOrderLineType === "Comment") {
    return {
      ...line,
      accountId: undefined,
      assetId: undefined,
      itemId: undefined
    };
  }
  if (line.salesOrderLineType === "Fixed Asset") {
    return { ...line, accountId: undefined, itemId: undefined };
  }
  return { ...line, accountId: undefined, assetId: undefined };
}

/** An unlocked sales order this company owns, or why it cannot be changed. */
async function unlockedSalesOrder(
  ctx: ServiceContext,
  salesOrderId: string,
  message: string
) {
  const refused = await refuseUnlessOwned(ctx, "salesOrder", {
    id: salesOrderId
  });
  if (refused) return refused;
  const order = await getSalesOrder(ctx.asCaller.supabase, salesOrderId);
  if (isSalesOrderLocked(order.data?.status)) return ctx.error("rule", message);
  return null;
}

/**
 * Check a sales order line's item against the sales rules, at the order's
 * ship-to (the drop-ship location for a drop shipment). A line with no item
 * (a comment, a fixed asset) is not checked.
 */
async function salesOrderLineGate(
  ctx: ServiceContext,
  args: {
    salesOrderId: string;
    lineId: string | null;
    itemId?: string;
    quantity?: number;
    acknowledged: boolean;
  }
) {
  if (!args.itemId) {
    return { blocked: null, check: { violations: [], ruleNames: {} } };
  }
  const shipTo = await resolveSalesOrderShipTo(
    ctx.asSystem.supabase,
    args.salesOrderId,
    ctx.company.id
  );
  return salesLineGate(ctx, {
    surface: "salesOrderLine",
    documentType: "salesOrder",
    documentId: args.salesOrderId,
    lineId: args.lineId,
    itemId: args.itemId,
    quantities: [args.quantity ?? 1],
    customerId: shipTo.customerId,
    customerLocationId: shipTo.customerLocationId,
    acknowledged: args.acknowledged
  });
}

const salesOrderLineInput = salesOrderLineValidator.safeExtend({
  customFields: customFieldValues.optional(),
  acknowledged: z.boolean().default(false)
});

/**
 * Add a line to a sales order.
 *
 * @remarks
 * Refused while the order is locked, and for an item a change notice still
 * holds (an unreleased revision cannot be ordered). A line with an item is
 * first checked against the sales rules at the order's ship-to: an error,
 * or a warning not `acknowledged`, returns `violations` and adds nothing.
 *
 * @mcp
 */
export const createSalesOrderLine = defineServiceFn({
  input: salesOrderLineInput,
  permission: { create: "sales" },

  async run(ctx, { id: _id, acknowledged, customFields, ...input }) {
    const companyId = ctx.company.id;
    const line = withLineTarget(input);
    const locked = await unlockedSalesOrder(
      ctx,
      line.salesOrderId,
      "Cannot add lines to a locked sales order. Reopen it first."
    );
    if (locked) return locked;

    // Checked here rather than only in the picker: the API reaches this too.
    if (line.itemId) {
      const unreleased = await getUnreleasedChangeOrderIssue(
        ctx.asSystem.supabase,
        { itemId: line.itemId, companyId }
      );
      if (unreleased) {
        return ctx.error("rule", `${unreleased} It cannot be ordered.`);
      }
    }

    const gate = await salesOrderLineGate(ctx, {
      salesOrderId: line.salesOrderId,
      lineId: null,
      itemId: line.itemId,
      quantity: line.saleQuantity,
      acknowledged
    });
    if (gate.blocked) return gate.blocked;

    const created = await upsertSalesOrderLine(ctx.asCaller.supabase, {
      ...line,
      companyId,
      createdBy: ctx.auditUserId,
      customFields
    });
    if (created.error) {
      return ctx.error(
        "internal",
        "Failed to create sales order line.",
        created.error
      );
    }

    await recordSalesLineOutcome(
      ctx,
      {
        documentType: "salesOrder",
        documentId: line.salesOrderId,
        lineId: created.data.id,
        itemId: line.itemId ?? null
      },
      "acknowledged",
      gate.check
    );
    return { salesOrderLineId: created.data.id };
  }
});

/**
 * Change a sales order line.
 *
 * @remarks
 * Refused while the order is locked. A line with an item is first checked
 * against the sales rules (see `createSalesOrderLine`).
 *
 * @mcp
 */
export const updateSalesOrderLine = defineServiceFn({
  input: salesOrderLineInput.safeExtend({ id: z.string() }),
  permission: { create: "sales" },

  async run(ctx, { id, acknowledged, customFields, ...input }) {
    const line = withLineTarget(input);
    // The line must be on the order whose lock state is checked.
    const refused = await refuseUnlessOwned(ctx, "salesOrderLine", {
      id,
      salesOrderId: line.salesOrderId
    });
    if (refused) return refused;
    const locked = await unlockedSalesOrder(
      ctx,
      line.salesOrderId,
      "Cannot modify a locked sales order. Reopen it first."
    );
    if (locked) return locked;

    const gate = await salesOrderLineGate(ctx, {
      salesOrderId: line.salesOrderId,
      lineId: id,
      itemId: line.itemId,
      quantity: line.saleQuantity,
      acknowledged
    });
    if (gate.blocked) return gate.blocked;

    const updated = await upsertSalesOrderLine(ctx.asCaller.supabase, {
      id,
      ...line,
      updatedBy: ctx.auditUserId,
      customFields
    });
    if (updated.error) {
      return ctx.error(
        "internal",
        "Failed to update sales order line",
        updated.error
      );
    }

    await recordSalesLineOutcome(
      ctx,
      {
        documentType: "salesOrder",
        documentId: line.salesOrderId,
        lineId: id,
        itemId: line.itemId ?? null
      },
      "acknowledged",
      gate.check
    );
    return { salesOrderLineId: id };
  }
});

/**
 * Create a shipment for one sales order line.
 *
 * @remarks
 * The line needs a location; the shipment is created there through the
 * `create` server function.
 *
 * @mcp
 */
export const shipSalesOrderLine = defineServiceFn({
  input: z.object({ salesOrderLineId: z.string() }),
  permission: { create: "inventory" },

  async run(ctx, { salesOrderLineId }) {
    const companyId = ctx.company.id;
    const line = await getSalesOrderLine(
      ctx.asSystem.supabase,
      salesOrderLineId
    );
    if (line.error || line.data.companyId !== companyId) {
      return ctx.error(
        "notFound",
        "Failed to get sales order line",
        line.error
      );
    }
    if (!line.data.locationId) {
      return ctx.error(
        "rule",
        "Set a location on this sales order line before creating a shipment"
      );
    }

    const shipment = await serverFns
      .system({ db: ctx.asSystem.pg, companyId, userId: ctx.auditUserId })
      .invoke("create", {
        type: "shipmentFromSalesOrderLine",
        locationId: line.data.locationId,
        salesOrderLineId
      });
    if (!shipment.data || shipment.error) {
      return ctx.error("internal", "Failed to create shipment", shipment.error);
    }
    return { shipmentId: shipment.data.id };
  }
});
