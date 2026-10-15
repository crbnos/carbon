// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { openai } from "@ai-sdk/openai";
import { hasPermission } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getUserClaims } from "@carbon/auth/users.server";
import type { Database, Json } from "@carbon/database";
import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import { lockIssueDispositions } from "@carbon/database/quality";
import { getNextSequence } from "@carbon/database/sequence";
import { QuoteEmail } from "@carbon/documents/email";
import { getQuoteDisplayId } from "@carbon/documents/pdf";
import { insertAuditLogEntries } from "@carbon/ee/audit.server";
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
import { validator } from "@carbon/form";
import { batchTrigger, trigger } from "@carbon/jobs";
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
import type {
  ContractAmendmentPreview,
  ContractCancellationPreview,
  ContractCancellationResult
} from "@carbon/server-functions/post-customer-contract";
import { getStripeConnectAccountId } from "@carbon/stripe/send-sales-invoice.server";
import type { Violation } from "@carbon/utils";
import {
  breakQuantities,
  datetime,
  getErrorMessage,
  getSalesOrderStatus,
  round,
  suggestContractType,
  textToTiptap,
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
import { stripeCustomerActions } from "~/modules/invoicing/invoicing.models";
import { linkStripeCustomerForBilling } from "~/modules/invoicing/stripe-customer.server";
import {
  getSupplierPriceBreaksForItems,
  resolveItemIdFromExtractedText,
  upsertPart
} from "~/modules/items";
import { getUnreleasedChangeOrderIssue } from "~/modules/items/items.server";
import { runMRP } from "~/modules/production/production.service";
import { deleteIssue, getIssueTypesList, insertIssue } from "~/modules/quality";
import { systemContext } from "~/modules/service-context.server";
import {
  type CarbonError,
  defineServiceFn,
  type ServiceContext
} from "~/modules/service-fn.server";
import {
  getCompany,
  getCompanySettings,
  getNextSequence as getNextSequenceNumber
} from "~/modules/settings";
import { checkPartyContactRequirement } from "~/modules/settings/party-contact.server";
import { resolveBuyUnitCost, upsertExternalLink } from "~/modules/shared";
import {
  refuseUnlessOwned,
  sendSalesOrderEmail
} from "~/modules/shared/shared.server";
import {
  getCompanyTimeZone,
  getLocationTimeZone
} from "~/modules/shared/timezone.server";
import { getUser, getUserDefaults } from "~/modules/users/users.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";
import { sanitize } from "~/utils/supabase";
import {
  renderQuotePdf,
  renderSalesOrderPdf,
  renderSalesReturnOrderPdf
} from "./sales.documents.server";
import {
  contractAmendmentChangeValidator,
  contractEndDate,
  type createContractFromSalesOrderValidator,
  customerContractAmendmentValidator,
  customerContractTypes,
  customerContractValidator,
  invoiceAutomations,
  isQuoteLocked,
  isSalesOrderLocked,
  isSalesReturnOrderLocked,
  isSalesRfqLocked,
  quoteLineValidator,
  quoteMaterialValidator,
  quoteOperationValidator,
  rentalAgreementLineClassificationValidator,
  rentalAgreementValidator,
  salesOrderLineValidator,
  salesReturnOrderLineValidator,
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
  confirmSalesReturnOrder,
  convertQuoteToOrder,
  convertSalesRfqToQuote,
  copyQuoteLine,
  deleteQuoteMaterial,
  finalizeQuote,
  getContract,
  getCustomer,
  getCustomerContact,
  getCustomerContractStatuses,
  getQuote,
  getRentalAgreement,
  getRentalAgreementLine,
  getSalesOrder,
  getSalesOrderLine,
  getSalesOrderLines,
  getSalesReturnOrder,
  getSalesReturnOrderLine,
  getSalesReturnOrderLineTrackedEntities,
  getSalesRFQ,
  insertContract,
  insertRentalAgreement,
  insertSalesRFQ,
  type QuoteLinePriceRow,
  recalculateQuoteLinePrices,
  resolvePurchaseToOrderPrices,
  resolveQuoteLinePrices,
  setSalesReturnOrderLineDisposition,
  updateContract,
  updateContractInvoiceAutomation,
  updateContractNotes,
  updateContractType,
  updateRentalAgreement,
  updateRentalAgreementInvoiceAutomation,
  updateSalesRFQStatus,
  upsertQuoteLine,
  upsertQuoteLineMethod,
  upsertQuoteMaterial,
  upsertQuoteMaterialMakeMethod,
  upsertQuoteOperation,
  upsertRentalAgreementLine,
  upsertSalesOrderLine,
  upsertSalesReturnOrderLine,
  upsertSalesRFQLine
} from "./sales.service";
import { reconcileQuantityBreaks } from "./sales.utils";
import { contractDurationOf } from "./ui/Contracts/useContractLabels";

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
    const references: [Parameters<typeof refuseUnlessOwned>[1], string?][] = [
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
  return systemContext({
    companyId: quote.companyId,
    companyGroupId: company.data.companyGroupId,
    onBehalfOf: quote.createdBy
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

// --- Sales return orders (RMAs) ---------------------------------------------------

const salesReturnOrderFields = [
  "customerId",
  "currencyCode",
  "salesOrderId",
  "customerContactId",
  "customerLocationId",
  "customerReference",
  "expirationDate",
  "locationId",
  "orderDate"
] as const;

/**
 * Set one field on one or more sales return orders.
 *
 * @remarks
 * Refused when any of them is completed or cancelled. A new customer on a
 * single return order brings its currency and today's exchange rate; so does
 * a new currency (a missing rate refuses rather than writing a stale one). An
 * empty value clears the field.
 */
export const updateSalesReturnOrderField = defineServiceFn({
  input: fieldUpdate(salesReturnOrderFields),
  permission: { update: "sales" },

  async run(ctx, { ids, field, value }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const orders = await client
      .from("salesReturnOrder")
      .select("status")
      .in("id", ids)
      .eq("companyId", companyId);
    if (orders.error) {
      return ctx.error(
        "internal",
        "Failed to load the return orders",
        orders.error
      );
    }
    if (orders.data.some((order) => isSalesReturnOrderLocked(order.status))) {
      return ctx.error(
        "rule",
        "Cannot modify a completed or cancelled return order."
      );
    }

    const withRate = async (currencyCode: string) => {
      const rate = await getExchangeRate(client, companyId, currencyCode);
      return rate.error
        ? ctx.error("internal", "Failed to get the exchange rate", rate.error)
        : { currencyCode, exchangeRate: rate.data };
    };

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
    }

    const update = await client
      .from("salesReturnOrder")
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
      return ctx.error(
        "internal",
        "Failed to update the return orders",
        update.error
      );
    }
    return { ids };
  }
});

/**
 * Confirm a sales return order (RMA).
 *
 * @remarks
 * Authorizes the customer to return the goods on its lines: each line's
 * quantity is checked, under row locks, against what its source document can
 * still take back, and a line over that refuses the whole confirm. Then the
 * RMA's PDF is filed on it; when that fails the RMA is still confirmed and
 * `warning` says so. `locale` formats the PDF.
 *
 * @mcp
 */
export const confirmReturnOrder = defineServiceFn({
  input: z.object({
    salesReturnOrderId: z.string(),
    locale: z.string().default("en-US")
  }),
  permission: { update: "sales" },

  async run(ctx, { salesReturnOrderId: id, locale }) {
    const companyId = ctx.company.id;
    const order = await getSalesReturnOrder(ctx.asSystem.supabase, id);
    if (order.error || !order.data) {
      return ctx.error(
        "internal",
        "Failed to load sales return order",
        order.error
      );
    }
    if (order.data.companyId !== companyId) {
      return ctx.error(
        "forbidden",
        "You are not authorized to confirm this return order"
      );
    }

    try {
      await confirmSalesReturnOrder(
        ctx.asSystem.pg,
        { id, companyId },
        ctx.auditUserId
      );
    } catch (err) {
      // Its refusals (a quantity over the source's cap) are thrown.
      return ctx.error(
        "rule",
        err instanceof Error ? err.message : "Failed to confirm return order",
        err
      );
    }

    // The RMA is confirmed: a failed PDF does not undo it.
    const pdf = await attachDocumentPdf(ctx, {
      pdf: await renderSalesReturnOrderPdf(ctx.asCaller.supabase, {
        id,
        companyId,
        companyGroupId: ctx.company.groupId,
        locale
      }),
      identifier: order.data.salesReturnOrderId ?? "",
      folder: `sales-return-order/${id}`,
      sourceDocument: "Sales Return Order",
      sourceDocumentId: id
    }).catch((err: unknown) =>
      ctx.error("internal", "Failed to generate PDF", err)
    );
    if (pdf instanceof Error) {
      logger.error("Failed to file the confirmed RMA's PDF", {
        companyId,
        salesReturnOrderId: id,
        error: pdf
      });
      return {
        salesReturnOrderId: id,
        warning: "Return order confirmed, but the PDF could not be generated"
      };
    }
    return { salesReturnOrderId: id, warning: null };
  }
});

/**
 * Add a line to a sales return order (RMA).
 *
 * @remarks
 * Only while the RMA is Draft: its quantities are checked against their
 * sources at Confirm, so a later line would skip that check. A line from a
 * sales order links the RMA to that order when it has none yet (the first
 * line's order wins; a link someone set is never replaced).
 *
 * @mcp
 */
export const createReturnOrderLine = defineServiceFn({
  input: salesReturnOrderLineValidator.extend({
    customFields: customFieldValues.optional()
  }),
  permission: { create: "sales" },

  async run(ctx, { id: _id, customFields, ...line }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const orderId = line.salesReturnOrderId;

    const refused = await refuseUnlessOwned(ctx, "salesReturnOrder", {
      id: orderId
    });
    if (refused) return refused;
    const order = await getSalesReturnOrder(client, orderId);
    if (isSalesReturnOrderLocked(order.data?.status)) {
      return ctx.error(
        "rule",
        "Cannot add lines to a completed or cancelled return order."
      );
    }
    if (order.data?.status !== "Draft") {
      return ctx.error(
        "rule",
        "Lines can only be added while the return order is Draft"
      );
    }

    const created = await upsertSalesReturnOrderLine(client, {
      ...line,
      companyId,
      createdBy: ctx.auditUserId,
      customFields
    });
    if (created.error || !created.data) {
      return ctx.error(
        "internal",
        "Failed to create return order line",
        created.error
      );
    }

    // Best-effort: a failure leaves the manual link available.
    if (!order.data?.salesOrderId && line.salesOrderLineId) {
      const salesOrderLine = await client
        .from("salesOrderLine")
        .select("salesOrderId")
        .eq("id", line.salesOrderLineId)
        .eq("companyId", companyId)
        .maybeSingle();
      if (salesOrderLine.data?.salesOrderId) {
        await client
          .from("salesReturnOrder")
          .update({
            salesOrderId: salesOrderLine.data.salesOrderId,
            updatedBy: ctx.auditUserId
          })
          .eq("id", orderId)
          .eq("companyId", companyId);
      }
    }
    return { salesReturnOrderLineId: created.data.id };
  }
});

/**
 * Escalate a sales return order line to a quality Issue.
 *
 * @remarks
 * Scrap and Rework are quality decisions, so the line gets an Issue for its
 * received quantity, linked to the line and to its returned entities still
 * On Hold (expected serials or batches, and those received blind against the
 * line), and the line records the disposition. Needs a received quantity, an
 * Issue Type and a location (the RMA's, else the user's). When the line has
 * an open Issue already, only the disposition changes and that Issue is
 * returned (`created` false), so changing the choice never opens a second
 * Issue for the same goods. A failure after the Issue is created deletes it
 * again; a failed disposition write keeps it and `warning` says so.
 *
 * @mcp
 */
export const escalateReturnOrderLine = defineServiceFn({
  input: z.object({
    salesReturnOrderId: z.string(),
    lineId: z.string(),
    disposition: z.enum(["Scrap", "Rework"])
  }),
  permission: { create: "quality", update: "sales" },

  async run(ctx, { salesReturnOrderId: id, lineId, disposition }) {
    const client = ctx.asCaller.supabase;
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const [order, line] = await Promise.all([
      getSalesReturnOrder(client, id),
      getSalesReturnOrderLine(client, lineId)
    ]);
    if (order.error || !order.data) {
      return ctx.error("internal", "Failed to load return order", order.error);
    }
    if (line.error || !line.data) {
      return ctx.error(
        "internal",
        "Failed to load return order line",
        line.error
      );
    }
    if (
      line.data.salesReturnOrderId !== id ||
      order.data.companyId !== companyId
    ) {
      return ctx.error(
        "notFound",
        "This line does not belong to this return order"
      );
    }
    const quantityReceived = Number(line.data.quantityReceived ?? 0);
    if (quantityReceived <= 0) {
      return ctx.error(
        "rule",
        "Cannot set a disposition before any quantity is received"
      );
    }

    const entityIds = await returnedOnHoldEntityIds(ctx, { id, lineId });

    const [userDefaults, issueTypes, item, returnReason] = await Promise.all([
      getUserDefaults(client, userId, companyId),
      getIssueTypesList(client, companyId),
      client
        .from("item")
        .select("readableIdWithRevision")
        .eq("id", line.data.itemId)
        .eq("companyId", companyId)
        .single(),
      line.data.returnReasonId
        ? client
            .from("returnReason")
            .select("name")
            .eq("id", line.data.returnReasonId)
            .single()
        : Promise.resolve({ data: null, error: null })
    ]);
    const issueType = issueTypes.data?.[0];
    const locationId =
      order.data.locationId ?? userDefaults.data?.locationId ?? null;
    if (!issueType || !locationId) {
      return ctx.error(
        "rule",
        "Configure at least one Issue Type and a location to escalate this line to an Issue"
      );
    }

    // The disposition select posts on every change: without this, Scrap ->
    // Rework -> Scrap left several open Issues each carrying the full
    // received quantity, written off once per Issue.
    const existingLink = await serviceRole
      .from("nonConformanceSalesReturnOrderLine")
      .select("nonConformanceId, nonConformance(id, nonConformanceId, status)")
      .eq("salesReturnOrderLineId", lineId)
      .eq("companyId", companyId);
    if (existingLink.error) {
      return ctx.error(
        "internal",
        "Failed to check for an existing Issue",
        existingLink.error
      );
    }
    const openLink = existingLink.data.find((row) => {
      const nc = row.nonConformance as { status?: string | null } | null;
      return nc && nc.status !== "Closed";
    });
    if (openLink) {
      await serviceRole
        .from("salesReturnOrderLine")
        .update({
          disposition,
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .eq("id", lineId)
        .eq("companyId", companyId);
      return {
        issueId: openLink.nonConformanceId,
        created: false,
        warning: null
      };
    }

    const rmaReadableId = order.data.salesReturnOrderId ?? "";
    const itemReadableId =
      item.data?.readableIdWithRevision ?? line.data.itemId;
    const created = await insertIssue(serviceRole, {
      name: [
        "Returned goods",
        rmaReadableId,
        itemReadableId && `— ${itemReadableId}`
      ]
        .filter(Boolean)
        .join(" "),
      description: [
        `Auto-created from sales return order ${rmaReadableId} line ${line.data.lineNumber}.`,
        `Requested disposition: ${disposition}.`,
        returnReason.data?.name
          ? `Return reason: ${returnReason.data.name}.`
          : null
      ]
        .filter(Boolean)
        .join(" "),
      priority: "Medium",
      source: "Internal",
      locationId,
      nonConformanceTypeId: issueType.id,
      openDate: datetime
        .today(await getLocationTimeZone(client, locationId, companyId))
        .toString(),
      quantity: quantityReceived,
      items: [line.data.itemId],
      companyId,
      createdBy: userId
    });
    if (created.error || !created.data) {
      return ctx.error("internal", "Failed to create Issue", created.error);
    }
    const issueId = created.data.id;

    // From here a failure deletes the Issue again: an orphan with no RMA
    // link and a line still Pending is worse than a clean retry.
    const linked = await linkIssueToReturnLine(ctx, {
      issueId,
      salesReturnOrderId: id,
      rmaReadableId,
      lineId,
      itemId: line.data.itemId,
      entityIds,
      quantityReceived,
      disposition
    });
    if (linked) {
      await deleteIssue(serviceRole, issueId);
      return linked;
    }

    const tasks = await serverFns
      .system({ db: ctx.asSystem.pg, companyId, userId })
      .invoke("create", { type: "nonConformanceTasks", id: issueId });
    if (tasks.error) {
      await deleteIssue(serviceRole, issueId);
      return ctx.error("internal", "Failed to create Issue tasks", tasks.error);
    }

    const recorded = await setSalesReturnOrderLineDisposition(
      client,
      ctx.asSystem.pg,
      { lineId, companyId, disposition, userId }
    );
    return {
      issueId,
      created: true,
      warning: recorded.error
        ? "Issue created, but failed to update the line's disposition"
        : null
    };
  }
});

/**
 * A return line's goods still On Hold: its expected serials and batches,
 * plus entities received blind against the line's receipt lines.
 */
async function returnedOnHoldEntityIds(
  ctx: ServiceContext,
  { id, lineId }: { id: string; lineId: string }
): Promise<string[]> {
  const client = ctx.asCaller.supabase;
  const companyId = ctx.company.id;
  const linked = await getSalesReturnOrderLineTrackedEntities(client, [lineId]);
  const ids = (linked.data ?? [])
    .filter((row) => row.trackedEntity?.status === "On Hold")
    .map((row) => row.trackedEntityId);

  const receipts = await client
    .from("receipt")
    .select("id")
    .eq("sourceDocument", "Sales Return Order")
    .eq("sourceDocumentId", id)
    .eq("companyId", companyId);
  const receiptIds = (receipts.data ?? []).map((receipt) => receipt.id);
  if (receiptIds.length > 0) {
    const receiptLines = await client
      .from("receiptLine")
      .select("id")
      .in("receiptId", receiptIds)
      .eq("lineId", lineId)
      .eq("companyId", companyId);
    const receiptLineIds = (receiptLines.data ?? []).map((row) => row.id);
    if (receiptLineIds.length > 0) {
      const blind = await client
        .from("trackedEntity")
        .select("id")
        .eq("companyId", companyId)
        .eq("status", "On Hold")
        .in("attributes ->> Receipt Line", receiptLineIds);
      ids.push(...(blind.data ?? []).map((entity) => entity.id));
    }
  }
  return [...new Set(ids)];
}

/**
 * Link a new Issue to the return line and its returned entities, and set
 * its item to the line's received quantity and disposition with the
 * entities split out (under the lock every disposition writer takes).
 */
async function linkIssueToReturnLine(
  ctx: ServiceContext,
  args: {
    issueId: string;
    salesReturnOrderId: string;
    rmaReadableId: string;
    lineId: string;
    itemId: string;
    entityIds: string[];
    quantityReceived: number;
    disposition: "Scrap" | "Rework";
  }
): Promise<CarbonError | null> {
  const serviceRole = ctx.asSystem.supabase;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const { issueId } = args;

  const lineLink = await serviceRole
    .from("nonConformanceSalesReturnOrderLine")
    .insert({
      nonConformanceId: issueId,
      salesReturnOrderLineId: args.lineId,
      salesReturnOrderId: args.salesReturnOrderId,
      salesReturnOrderReadableId: args.rmaReadableId,
      companyId,
      createdBy: userId
    });
  if (lineLink.error) {
    return ctx.error(
      "internal",
      "Failed to link the Issue to the RMA",
      lineLink.error
    );
  }

  let entityRows: { id: string; quantity: number }[] = [];
  if (args.entityIds.length > 0) {
    const entityLinks = await serviceRole
      .from("nonConformanceTrackedEntity")
      .insert(
        args.entityIds.map((trackedEntityId) => ({
          nonConformanceId: issueId,
          trackedEntityId,
          companyId,
          createdBy: userId
        }))
      );
    if (entityLinks.error) {
      return ctx.error(
        "internal",
        "Failed to link the returned entities to the Issue",
        entityLinks.error
      );
    }
    const quantities = await serviceRole
      .from("trackedEntity")
      .select("id, quantity")
      .in("id", args.entityIds)
      .eq("companyId", companyId);
    if (quantities.error) {
      return ctx.error(
        "internal",
        "Failed to read the returned entities for the Issue",
        quantities.error
      );
    }
    entityRows = quantities.data.map((entity) => ({
      id: entity.id,
      quantity: Number(entity.quantity ?? 1)
    }));
  }

  try {
    // The lock helper takes a Kysely transaction itself.
    await ctx.asSystem.pg.transaction().execute(async (trx) => {
      await lockIssueDispositions(trx, {
        nonConformanceId: issueId,
        companyId
      });
      const itemRow = await trx
        .updateTable("nonConformanceItem")
        .set({
          quantity: args.quantityReceived,
          disposition: args.disposition,
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .where("nonConformanceId", "=", issueId)
        .where("itemId", "=", args.itemId)
        .where("companyId", "=", companyId)
        .returning(["id"])
        .executeTakeFirst();
      if (itemRow && entityRows.length > 0) {
        await trx
          .insertInto("nonConformanceItemTrackedEntity")
          .values(
            entityRows.map((entity) => ({
              nonConformanceItemId: itemRow.id,
              nonConformanceId: issueId,
              trackedEntityId: entity.id,
              quantity: entity.quantity,
              companyId,
              createdBy: userId
            }))
          )
          .execute();
      }
    });
    return null;
  } catch (err) {
    return ctx.error("internal", "Failed to set the Issue's item", err);
  }
}

/**
 * Change a sales return order (RMA) line.
 *
 * @remarks
 * Refused when the RMA is completed or cancelled, and for a line of another
 * RMA. Once the RMA is confirmed, its quantity, item, unit price, restocking
 * fee, unit of measure and source links are locked: they were checked
 * against their sources at Confirm. A field that is sent unchanged, or not
 * sent, is no change.
 *
 * @mcp
 */
export const updateReturnOrderLine = defineServiceFn({
  input: salesReturnOrderLineValidator.extend({
    id: z.string(),
    customFields: customFieldValues.optional()
  }),
  permission: { update: "sales" },

  async run(ctx, { id: lineId, customFields, ...line }) {
    const client = ctx.asCaller.supabase;
    const orderId = line.salesReturnOrderId;

    const order = await getSalesReturnOrder(client, orderId);
    if (isSalesReturnOrderLocked(order.data?.status)) {
      return ctx.error(
        "rule",
        "Cannot modify a completed or cancelled return order."
      );
    }

    const existing = await client
      .from("salesReturnOrderLine")
      .select(
        "salesReturnOrderId, quantity, itemId, unitPrice, restockFeePercent, unitOfMeasureCode, salesOrderLineId, shipmentLineId, salesInvoiceLineId"
      )
      .eq("id", lineId)
      .eq("companyId", ctx.company.id)
      .single();
    if (existing.error || existing.data.salesReturnOrderId !== orderId) {
      return ctx.error(
        "notFound",
        "This line does not belong to this return order"
      );
    }

    if (order.data?.status !== "Draft") {
      const current = existing.data;
      const locked: [string, unknown, unknown][] = [
        ["Quantity", Number(line.quantity), Number(current.quantity)],
        ["Item", line.itemId, current.itemId],
        ["Unit price", Number(line.unitPrice), Number(current.unitPrice)],
        [
          "Restocking fee",
          line.restockFeePercent === undefined
            ? undefined
            : Number(line.restockFeePercent),
          Number(current.restockFeePercent)
        ],
        [
          "Unit of measure",
          line.unitOfMeasureCode,
          current.unitOfMeasureCode ?? undefined
        ],
        [
          "Sales order line link",
          line.salesOrderLineId,
          current.salesOrderLineId ?? undefined
        ],
        [
          "Shipment line link",
          line.shipmentLineId,
          current.shipmentLineId ?? undefined
        ],
        [
          "Invoice line link",
          line.salesInvoiceLineId,
          current.salesInvoiceLineId ?? undefined
        ]
      ];
      const changed = locked.find(
        ([, next, now]) => next !== undefined && next !== now
      );
      if (changed) {
        return ctx.error("rule", `${changed[0]} is locked after confirmation`);
      }
    }

    const updated = await upsertSalesReturnOrderLine(client, {
      ...line,
      id: lineId,
      updatedBy: ctx.auditUserId,
      customFields
    });
    if (updated.error) {
      return ctx.error(
        "internal",
        "Failed to update return order line",
        updated.error
      );
    }
    return { salesReturnOrderLineId: lineId };
  }
});

// --- Quote methods: materials and operations ---------------------------------

/** Which parts of a method a copy brings. */
const methodParts = z.object({
  billOfMaterial: z.boolean().default(true),
  billOfProcess: z.boolean().default(true),
  parameters: z.boolean().default(true),
  tools: z.boolean().default(true),
  steps: z.boolean().default(true),
  workInstructions: z.boolean().default(true)
});

/** Reprice a quote line after its method changed; a failure is logged. */
async function repriceQuoteLine(
  ctx: ServiceContext,
  { quoteId, quoteLineId }: { quoteId: string; quoteLineId: string }
) {
  const priced = await recalculateQuoteLinePrices(
    ctx.asSystem.supabase,
    ctx.company.id,
    quoteId,
    quoteLineId,
    ctx.auditUserId
  );
  if (priced?.error) {
    logger.error("Failed to recalculate quote line prices", {
      companyId: ctx.company.id,
      quoteLineId,
      error: priced.error
    });
  }
  return priced;
}

/**
 * Copy an item's method onto a quote line.
 *
 * @remarks
 * The parts chosen in `parts` replace the line's method (with a
 * configuration, the item's configured method), then the line's quantities
 * are repriced from it.
 *
 * @mcp
 */
export const copyItemMethodToQuoteLine = defineServiceFn({
  input: z.object({
    quoteId: z.string().min(1),
    quoteLineId: z.string().min(1),
    itemId: z.string(),
    parts: methodParts.default(methodParts.parse({})),
    configuration: z.record(z.string(), z.unknown()).optional()
  }),
  permission: { update: "sales" },

  async run(ctx, { quoteId, quoteLineId, itemId, parts, configuration }) {
    // The method is written with the service role.
    const refused = await refuseUnlessOwned(ctx, "quoteLine", {
      id: quoteLineId,
      quoteId
    });
    if (refused) return refused;

    const method = await upsertQuoteLineMethod(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      {
        itemId,
        quoteId,
        quoteLineId,
        companyId: ctx.company.id,
        userId: ctx.auditUserId,
        parts,
        ...(configuration !== undefined ? { configuration } : {})
      }
    );
    if (method.error) {
      return ctx.error(
        "internal",
        "Failed to get quote line method",
        method.error
      );
    }
    const priced = await repriceQuoteLine(ctx, { quoteId, quoteLineId });
    if (priced?.error) {
      return ctx.error("internal", "Failed to recalculate quote line prices");
    }
    return { quoteLineId };
  }
});

/**
 * Copy another quote line's method onto a quote line.
 *
 * @remarks
 * `sourceId` and `targetId` are both `quoteId:quoteLineId`. The parts chosen
 * in `parts` are copied, then the target line is repriced with its pricing
 * rules and configuration prices on top of the copied cost.
 *
 * @mcp
 */
export const copyQuoteLineMethod = defineServiceFn({
  input: z.object({
    sourceId: z.string(),
    targetId: z.string(),
    parts: methodParts.default(methodParts.parse({}))
  }),
  permission: { update: "sales" },

  async run(ctx, { sourceId, targetId, parts }) {
    const [quoteId, quoteLineId] = targetId.split(":");
    if (!quoteId || !quoteLineId) {
      return ctx.error("validation", "targetId must be quoteId:quoteLineId");
    }
    const refused = await refuseUnlessOwned(ctx, "quoteLine", {
      id: quoteLineId,
      quoteId
    });
    if (refused) return refused;

    const copied = await copyQuoteLine(ctx.asSystem.supabase, ctx.asSystem.pg, {
      type: "quoteLine",
      sourceId,
      targetId,
      ...parts,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    });
    if (copied.error) {
      return ctx.error("internal", "Failed to copy quote line", copied.error);
    }
    const priced = await repriceQuoteLine(ctx, { quoteId, quoteLineId });
    if (priced?.error) {
      return ctx.error("internal", "Failed to recalculate quote line prices");
    }
    return { quoteLineId };
  }
});

/**
 * Copy an item's method onto a quote material's make method.
 *
 * @remarks
 * `targetId` is the material's make method. The parts chosen in `parts`
 * replace it (with a configuration, the item's configured method).
 *
 * @mcp
 */
export const copyItemMethodToQuoteMaterial = defineServiceFn({
  input: z.object({
    sourceId: z.string(),
    targetId: z.string(),
    parts: methodParts.default(methodParts.parse({})),
    configuration: z.record(z.string(), z.unknown()).optional()
  }),
  permission: { update: "sales" },

  async run(ctx, { sourceId, targetId, parts, configuration }) {
    const method = await upsertQuoteMaterialMakeMethod(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      {
        sourceId,
        targetId,
        companyId: ctx.company.id,
        userId: ctx.auditUserId,
        parts,
        ...(configuration !== undefined ? { configuration } : {})
      }
    );
    if (method.error) {
      return ctx.error(
        "internal",
        "Failed to insert quote material make method",
        method.error
      );
    }
    return { quoteMaterialMakeMethodId: targetId };
  }
});

const quoteMaterialInput = z.object({
  ...quoteMaterialValidator.shape,
  kit: z.boolean().default(false),
  quoteId: z.string(),
  quoteLineId: z.string(),
  customFields: customFieldValues.optional()
});

/**
 * Add a material to a quote line's method.
 *
 * @remarks
 * The line, its make method and the operation it is issued to must be this
 * company's and the line's. A Make to Order material gets the item's method
 * (when that fails the material is kept and `warning` says so). Then the
 * line is repriced.
 *
 * @mcp
 */
export const createQuoteMaterial = defineServiceFn({
  input: quoteMaterialInput,
  permission: { create: "sales" },

  async run(ctx, { customFields, ...material }) {
    const serviceRole = ctx.asSystem.supabase;
    const { quoteId, quoteLineId } = material;
    const refused = await refuseUnlessQuoteMethodRows(ctx, {
      quoteId,
      quoteLineId,
      quoteMakeMethodId: material.quoteMakeMethodId,
      quoteOperationId: material.quoteOperationId
    });
    if (refused) return refused;

    const inserted = await upsertQuoteMaterial(serviceRole, {
      ...material,
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId,
      customFields
    });
    if (inserted.error || !inserted.data?.id) {
      return ctx.error(
        "internal",
        "Failed to insert quote material",
        inserted.error
      );
    }
    const id = inserted.data.id;

    let warning: string | null = null;
    if (material.methodType === "Make to Order") {
      const withMethod = await serviceRole
        .from("quoteMaterialWithMakeMethodId")
        .select("*")
        .eq("id", id)
        .eq("companyId", ctx.company.id)
        .single();
      if (withMethod.error) {
        return ctx.error(
          "internal",
          "Failed to get material make method",
          withMethod.error
        );
      }
      const method = await upsertQuoteMaterialMakeMethod(
        serviceRole,
        ctx.asSystem.pg,
        {
          sourceId: material.itemId,
          targetId: withMethod.data.quoteMaterialMakeMethodId!,
          companyId: ctx.company.id,
          userId: ctx.auditUserId
        }
      );
      if (method.error) {
        warning = "Failed to insert quote material make method";
      }
    }

    // A failed method skipped the reprice, as it always has.
    if (!warning) await repriceQuoteLine(ctx, { quoteId, quoteLineId });
    return { id, warning };
  }
});

/**
 * Change a material on a quote line's method.
 *
 * @remarks
 * The material, its line and the operation it is issued to must be this
 * company's and the line's. A material never moves to another line. Then the
 * line is repriced.
 *
 * @mcp
 */
export const updateQuoteMaterial = defineServiceFn({
  input: quoteMaterialInput,
  permission: { create: "sales" },

  async run(ctx, { customFields, ...material }) {
    const { quoteId, quoteLineId } = material;
    const refused =
      (await refuseUnlessOwned(ctx, "quoteMaterial", {
        id: material.id,
        quoteLineId
      })) ??
      (await refuseUnlessQuoteMethodRows(ctx, {
        quoteId,
        quoteLineId,
        quoteOperationId: material.quoteOperationId
      }));
    if (refused) return refused;

    const updated = await upsertQuoteMaterial(ctx.asSystem.supabase, {
      ...material,
      companyId: ctx.company.id,
      updatedBy: ctx.auditUserId,
      customFields
    });
    if (updated.error || !updated.data?.id) {
      return ctx.error(
        "internal",
        "Failed to update quote material",
        updated.error
      );
    }
    await repriceQuoteLine(ctx, { quoteId, quoteLineId });
    return { id: updated.data.id, methodType: updated.data.methodType };
  }
});

/**
 * Remove a material from a quote line's method, then reprice the line.
 *
 * @mcp destructive
 */
export const deleteQuoteMaterialAndReprice = defineServiceFn({
  input: z.object({
    quoteId: z.string(),
    quoteLineId: z.string(),
    id: z.string()
  }),
  permission: { delete: "sales" },

  async run(ctx, { quoteId, quoteLineId, id }) {
    const refused =
      (await refuseUnlessOwned(ctx, "quoteLine", {
        id: quoteLineId,
        quoteId
      })) ??
      (await refuseUnlessOwned(ctx, "quoteMaterial", { id, quoteLineId }));
    if (refused) return refused;

    const deleted = await deleteQuoteMaterial(ctx.asCaller.supabase, id);
    if (deleted.error) {
      return ctx.error(
        "internal",
        "Failed to delete quote material",
        deleted.error
      );
    }
    await repriceQuoteLine(ctx, { quoteId, quoteLineId });
    return { id };
  }
});

/**
 * The quote line, and the make method and operation a method row names,
 * must be this company's and that line's: method rows are written with the
 * service role.
 */
async function refuseUnlessQuoteMethodRows(
  ctx: ServiceContext,
  args: {
    quoteId: string;
    quoteLineId: string;
    quoteMakeMethodId?: string;
    quoteOperationId?: string;
  }
): Promise<CarbonError | null> {
  const { quoteLineId } = args;
  const refusals = await Promise.all([
    refuseUnlessOwned(ctx, "quoteLine", {
      id: quoteLineId,
      quoteId: args.quoteId
    }),
    args.quoteMakeMethodId
      ? refuseUnlessOwned(ctx, "quoteMakeMethod", {
          id: args.quoteMakeMethodId,
          quoteLineId
        })
      : null,
    args.quoteOperationId
      ? refuseUnlessOwned(ctx, "quoteOperation", {
          id: args.quoteOperationId,
          quoteLineId
        })
      : null
  ]);
  return refusals.find((refusal) => refusal !== null) ?? null;
}

const quoteOperationInput = quoteOperationValidator.safeExtend({
  quoteId: z.string(),
  quoteLineId: z.string(),
  customFields: customFieldValues.optional()
});

/**
 * Add an operation to a quote line's method, then reprice the line.
 *
 * @remarks
 * The line and its make method must be this company's and the line's.
 *
 * @mcp
 */
export const createQuoteOperation = defineServiceFn({
  input: quoteOperationInput,
  permission: { create: "sales" },

  async run(ctx, { customFields, ...operation }) {
    const { quoteId, quoteLineId } = operation;
    const refused = await refuseUnlessQuoteMethodRows(ctx, {
      quoteId,
      quoteLineId,
      quoteMakeMethodId: operation.quoteMakeMethodId
    });
    if (refused) return refused;

    const inserted = await upsertQuoteOperation(ctx.asCaller.supabase, {
      ...operation,
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId,
      customFields
    });
    if (inserted.error || !inserted.data?.id) {
      return ctx.error(
        "internal",
        "Failed to insert quote operation",
        inserted.error
      );
    }
    await repriceQuoteLine(ctx, { quoteId, quoteLineId });
    return { id: inserted.data.id };
  }
});

/**
 * Change an operation on a quote line's method, then reprice the line.
 *
 * @mcp
 */
export const updateQuoteOperation = defineServiceFn({
  input: quoteOperationInput,
  permission: { create: "sales" },

  async run(ctx, { customFields, ...operation }) {
    const { quoteId, quoteLineId } = operation;
    const refused =
      (await refuseUnlessOwned(ctx, "quoteLine", {
        id: quoteLineId,
        quoteId
      })) ??
      (await refuseUnlessOwned(ctx, "quoteOperation", {
        id: operation.id,
        quoteLineId
      }));
    if (refused) return refused;

    const updated = await upsertQuoteOperation(ctx.asCaller.supabase, {
      ...operation,
      companyId: ctx.company.id,
      updatedBy: ctx.auditUserId,
      customFields
    });
    if (updated.error || !updated.data?.id) {
      return ctx.error(
        "internal",
        "Failed to update quote operation",
        updated.error
      );
    }
    await repriceQuoteLine(ctx, { quoteId, quoteLineId });
    return { id: updated.data.id };
  }
});

/**
 * Remove an operation from a quote line's method, then reprice its line.
 *
 * @mcp destructive
 */
export const deleteQuoteOperationAndReprice = defineServiceFn({
  input: z.object({ id: z.string() }),
  permission: { delete: "sales" },

  async run(ctx, { id }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const operation = await client
      .from("quoteOperation")
      .select("quoteId, quoteLineId")
      .eq("id", id)
      .eq("companyId", companyId)
      .single();

    const deleted = await client
      .from("quoteOperation")
      .delete()
      .eq("id", id)
      .eq("companyId", companyId);
    if (deleted.error) {
      return ctx.error("internal", deleted.error.message, deleted.error);
    }
    if (operation.data) await repriceQuoteLine(ctx, operation.data);
    return { id };
  }
});

// --- Contracts --------------------------------------------------------------

const forbidden = (ctx: ServiceContext) =>
  ctx.error("forbidden", "You do not have permission to do this");

/** Today in the company's timezone: the date a contract or rental acts on. */
async function companyToday(ctx: ServiceContext) {
  return datetime
    .today(await getCompanyTimeZone(ctx.asCaller.supabase, ctx.company.id))
    .toString();
}

/** The contract lifecycle server function, run as the caller. */
function postContract(
  ctx: ServiceContext,
  input: ServerFnInput<"post-customer-contract">
) {
  return runContractAction(
    {
      client: ctx.asCaller.supabase,
      db: ctx.asSystem.pg,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    },
    input
  );
}

/**
 * Create a Draft contract.
 *
 * @remarks
 * The contract type, when not sent, is suggested from the customer's other
 * contracts. The bill-to, invoice contact and address, ship-to and payment
 * terms the input leaves out come from the customer's invoicing and shipping
 * defaults. The exchange rate is today's for the currency. The contract is
 * then set up from its products step.
 *
 * @mcp
 */
export const createContract = defineServiceFn({
  input: customerContractValidator.safeExtend({
    customFields: customFieldValues.optional()
  }),
  permission: { create: "sales" },

  async run(ctx, input) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const {
      id: _id,
      customerContractId: _customerContractId,
      customFields,
      ...data
    } = input;

    let contractType = data.contractType;
    if (!contractType) {
      const previous = await getCustomerContractStatuses(
        client,
        companyId,
        data.customerId
      );
      if (previous.error) {
        return ctx.error(
          "internal",
          "Failed to read the customer's contracts",
          previous.error
        );
      }
      contractType = suggestContractType(previous.data ?? []);
    }

    const defaults = await contractInvoicingDefaults(
      client,
      companyId,
      data.customerId
    );
    const sequence = await getNextSequenceNumber(
      client,
      "customerContract",
      companyId
    );
    if (sequence.error || !sequence.data) {
      return ctx.error(
        "internal",
        "Failed to get the next contract number",
        sequence.error
      );
    }
    // Looked up, never assumed 1.
    const exchangeRate = await getExchangeRate(
      client,
      companyId,
      data.currencyCode
    );
    if (exchangeRate.error || !exchangeRate.data) {
      return ctx.error(
        "internal",
        "Failed to get the exchange rate",
        exchangeRate.error
      );
    }

    const contract = await insertContract(client, {
      ...data,
      invoiceCustomerId: data.invoiceCustomerId ?? defaults.invoiceCustomerId,
      invoiceCustomerContactId:
        data.invoiceCustomerContactId ?? defaults.invoiceCustomerContactId,
      invoiceCustomerLocationId:
        data.invoiceCustomerLocationId ?? defaults.invoiceCustomerLocationId,
      shipToCustomerLocationId:
        data.shipToCustomerLocationId ?? defaults.shipToCustomerLocationId,
      paymentTermId: data.paymentTermId ?? defaults.paymentTermId,
      exchangeRate: Number(exchangeRate.data),
      contractType,
      customerContractId: sequence.data,
      companyId,
      createdBy: ctx.auditUserId,
      customFields
    });
    if (contract.error || !contract.data) {
      return ctx.error("internal", "Failed to create contract", contract.error);
    }
    return { id: contract.data.id };
  }
});

/**
 * Save a Draft contract's terms from its setup.
 *
 * @remarks
 * Refused once the contract is not a Draft. A new customer brings its own
 * bill-to, invoice contact and address, ship-to and payment terms; a new
 * currency brings today's exchange rate. Custom fields the input leaves out
 * are kept.
 *
 * @mcp
 */
export const updateContractTerms = defineServiceFn({
  input: customerContractValidator.safeExtend({
    id: z.string(),
    customFields: customFieldValues.optional()
  }),
  permission: { update: "sales" },

  async run(ctx, input) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const {
      id,
      customerContractId: _customerContractId,
      customFields,
      ...data
    } = input;

    const current = await getContract(client, id, companyId);
    if (current.error || current.data?.companyId !== companyId) {
      return ctx.error("notFound", "Contract not found", current.error);
    }

    const invoicing = await contractCustomerChange(client, companyId, {
      from: current.data.customerId,
      to: data.customerId
    });

    let exchangeRate: number | undefined;
    if (data.currencyCode !== current.data.currencyCode) {
      const rate = await getExchangeRate(client, companyId, data.currencyCode);
      if (rate.error || !rate.data) {
        return ctx.error(
          "internal",
          "Failed to get the exchange rate",
          rate.error
        );
      }
      exchangeRate = Number(rate.data);
    }

    // Refuses a contract that is no longer a Draft.
    const update = await updateContract(client, {
      ...data,
      ...(invoicing ?? {}),
      ...(exchangeRate !== undefined ? { exchangeRate } : {}),
      id,
      updatedBy: ctx.auditUserId,
      customFields: {
        ...((current.data.customFields ?? {}) as Record<string, unknown>),
        ...customFields
      } as Json
    });
    if (update.error) {
      return ctx.error(
        "rule",
        update.error.message || "Failed to update contract",
        update.error
      );
    }
    return { id };
  }
});

/** The terms one contract field can change from its properties panel. */
const contractTermFields = [
  "name",
  "customerId",
  "invoiceCustomerId",
  "invoiceCustomerContactId",
  "invoiceCustomerLocationId",
  "shipToCustomerLocationId",
  "salesPersonId",
  "projectId",
  "customerReference",
  "closeDate",
  "startDate",
  "duration",
  "endDate",
  "renewal",
  "renewalUplift",
  "billingFrequency",
  "billingAlignment",
  "billingTiming",
  "firstInvoiceDate",
  "billedThrough",
  "recognizeRevenueFrom",
  "paymentTermId",
  "currencyCode",
  "notes"
] as const;

/**
 * Set one term of a contract.
 *
 * @remarks
 * A Draft's terms are checked as a whole (an end date on or after the start,
 * a custom duration needs an end date), so the stored terms are read, the
 * one field is swapped in and the whole set is validated and saved. A new
 * customer brings its own invoicing defaults; a new bill-to clears the
 * invoice contact and address; an end date makes the term custom; a new
 * currency brings today's rate. `notes` is plain text. An Active contract
 * changes its terms with Amend: only its notes are set here.
 *
 * @mcp
 */
export const setContractTerm = defineServiceFn({
  input: z.object({
    id: z.string(),
    field: z.enum(contractTermFields),
    value: z.string().nullish()
  }),
  permission: { update: "sales" },

  async run(ctx, { id, field, value }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const current = await getContract(client, id, companyId);
    if (current.error || current.data?.companyId !== companyId) {
      logger.error("contract not found for update", {
        companyId,
        id,
        error: current.error
      });
      return ctx.error("notFound", "Contract not found");
    }
    const contract = current.data;
    const notesDoc = value ? textToTiptap(value) : null;

    if (contract.status !== "Draft") {
      if (field !== "notes") {
        return ctx.error(
          "rule",
          "Only a Draft contract's terms can be edited — use Amend"
        );
      }
      // Notes are not a term: they stay editable after Confirm.
      const update = await updateContractNotes(client, {
        id,
        companyId,
        notes: notesDoc,
        updatedBy: userId
      });
      if (update.error) {
        return ctx.error(
          "rule",
          update.error.message || "Failed to update notes",
          update.error
        );
      }
      return { id };
    }

    const terms: Record<(typeof contractTermFields)[number], unknown> = {
      name: contract.name,
      customerId: contract.customerId,
      invoiceCustomerId: contract.invoiceCustomerId,
      invoiceCustomerContactId: contract.invoiceCustomerContactId,
      invoiceCustomerLocationId: contract.invoiceCustomerLocationId,
      shipToCustomerLocationId: contract.shipToCustomerLocationId,
      salesPersonId: contract.salesPersonId,
      projectId: contract.projectId,
      customerReference: contract.customerReference,
      closeDate: contract.closeDate,
      startDate: contract.startDate,
      duration: contractDurationOf({
        endDate: contract.endDate,
        termMonths: contract.termMonths
      }),
      endDate: contract.endDate,
      renewal: contract.renewal,
      // Stored as a fraction; the terms speak percent points.
      renewalUplift: round(Number(contract.renewalUplift ?? 0) * 100),
      billingFrequency: contract.billingFrequency,
      billingAlignment: contract.billingAlignment,
      billingTiming: contract.billingTiming,
      firstInvoiceDate: contract.firstInvoiceDate,
      billedThrough: contract.billedThrough,
      recognizeRevenueFrom: contract.recognizeRevenueFrom,
      paymentTermId: contract.paymentTermId,
      currencyCode: contract.currencyCode,
      // The stored document, re-encoded so the validator keeps it as is.
      notes: contract.notes ? JSON.stringify(contract.notes) : null
    };
    terms[field] =
      field === "notes"
        ? notesDoc
          ? JSON.stringify(notesDoc)
          : null
        : value || null;
    if (field === "endDate") terms.duration = "custom";
    if (field === "customerId") {
      const invoicing = await contractCustomerChange(client, companyId, {
        from: contract.customerId,
        to: value ?? null
      });
      if (invoicing) Object.assign(terms, invoicing);
    }
    if (field === "invoiceCustomerId" && value !== contract.invoiceCustomerId) {
      terms.invoiceCustomerContactId = null;
      terms.invoiceCustomerLocationId = null;
    }

    // The same form the new contract form posts, so the same coercion runs.
    const merged = new FormData();
    for (const key of contractTermFields) {
      const term = terms[key];
      if (term !== null && term !== undefined && term !== "") {
        merged.append(key, String(term));
      }
    }
    // Not a term, but the terms service writes it: carried so saving a term
    // never resets the contract to the company's invoicing setting.
    if (contract.invoiceAutomation) {
      merged.append("invoiceAutomation", contract.invoiceAutomation);
    }
    if (field === "currencyCode" && value && value !== contract.currencyCode) {
      const rate = await getExchangeRate(client, companyId, value);
      if (rate.error) {
        return ctx.error(
          "internal",
          "Failed to get the exchange rate",
          rate.error
        );
      }
      merged.append("exchangeRate", String(rate.data));
    }

    const validation = await validator(customerContractValidator).validate(
      merged
    );
    if (validation.error) {
      return ctx.error(
        "validation",
        Object.values(validation.error.fieldErrors)[0] ??
          "These terms are not valid"
      );
    }
    const {
      id: _id,
      customerContractId: _customerContractId,
      ...data
    } = validation.data;

    const update = await updateContract(client, {
      ...data,
      // Not a term: an omitted type is kept.
      contractType: undefined,
      id,
      updatedBy: userId,
      customFields: contract.customFields ?? undefined
    });
    if (update.error) {
      logger.error("contract term update failed", {
        companyId,
        id,
        field,
        error: update.error
      });
      return ctx.error(
        "rule",
        update.error.message || "Failed to update contract",
        update.error
      );
    }
    return { id };
  }
});

/**
 * Set a contract's type.
 *
 * @remarks
 * Stays editable while the contract is Active.
 *
 * @mcp
 */
export const setContractType = defineServiceFn({
  input: z.object({
    id: z.string(),
    contractType: z.enum(customerContractTypes)
  }),
  permission: { update: "sales" },

  async run(ctx, { id, contractType }) {
    const update = await updateContractType(ctx.asCaller.supabase, {
      id,
      companyId: ctx.company.id,
      contractType,
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error(
        "rule",
        update.error.message || "Failed to update contract type",
        update.error
      );
    }
    return { id };
  }
});

/**
 * Set how a contract's invoices are posted and sent.
 *
 * @remarks
 * Null is the company's setting. Stripe needs Stripe connected. On a
 * confirmed contract, a mode that posts (anything but Draft Only, the
 * company's setting included) needs the invoicing create permission as well,
 * as confirming does. Post and Email needs an invoice contact email.
 *
 * @mcp
 */
export const setContractInvoiceAutomation = defineServiceFn({
  input: z.object({
    id: z.string(),
    invoiceAutomation: z.enum(invoiceAutomations).nullable()
  }),
  permission: { update: "sales" },

  async run(ctx, { id, invoiceAutomation }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    if (
      invoiceAutomation === "Post and Send via Stripe" &&
      !(await getStripeConnectAccountId(ctx.asSystem.supabase, companyId))
    ) {
      return ctx.error("rule", "Connect Stripe in Integrations first");
    }

    if (invoiceAutomation !== "Draft Only") {
      const current = await getContract(client, id, companyId);
      if (current.error || current.data?.companyId !== companyId) {
        return ctx.error("notFound", "Contract not found");
      }
      if (current.data.status !== "Draft") {
        // An unreadable company setting is treated as posting.
        const effective =
          invoiceAutomation ??
          (await getCompanySettings(client, companyId)).data?.invoiceAutomation;
        if (
          effective !== "Draft Only" &&
          !ctx.can({ update: "sales", create: "invoicing" })
        ) {
          return forbidden(ctx);
        }
      }
    }

    const update = await updateContractInvoiceAutomation(client, {
      id,
      companyId,
      invoiceAutomation,
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error(
        "rule",
        update.error.message || "Failed to update invoicing",
        update.error
      );
    }
    return { id };
  }
});

/**
 * Confirm a Draft contract.
 *
 * @remarks
 * A contract whose invoices post on their own (any mode but Draft Only)
 * needs the invoicing create permission as well. Under Post and Send via
 * Stripe a billing customer with no Stripe customer is linked first, as
 * `stripeCustomerAction` says. The `post-customer-contract` server function
 * then checks the lines, fixes the invoice schedule and revenue plan and
 * makes the contract Active.
 *
 * @mcp
 */
export const confirmContract = defineServiceFn({
  input: z.object({
    id: z.string(),
    stripeCustomerAction: z.enum(stripeCustomerActions).optional(),
    stripeCustomerId: z.string().optional(),
    stripeContactEmail: z.string().email().optional()
  }),
  permission: { update: "sales" },

  async run(ctx, { id, stripeCustomerAction, ...stripe }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const contract = await getContract(client, id, companyId);
    if (contract.error || contract.data?.companyId !== companyId) {
      return ctx.error("notFound", "Contract not found", contract.error);
    }
    if (contract.data.status !== "Draft") {
      return ctx.error("conflict", "Only a Draft contract can be confirmed");
    }
    const mode = contract.data.effectiveInvoiceAutomation;
    if (
      mode !== "Draft Only" &&
      !ctx.can({ update: "sales", create: "invoicing" })
    ) {
      return forbidden(ctx);
    }

    // The server function re-checks the mapping inside its transaction.
    const billingCustomerId =
      contract.data.invoiceCustomerId ?? contract.data.customerId;
    if (
      mode === "Post and Send via Stripe" &&
      stripeCustomerAction &&
      billingCustomerId
    ) {
      let message: string | null = null;
      try {
        const linked = await linkStripeCustomerForBilling({
          serviceRole: ctx.asSystem.supabase,
          companyId,
          userId: ctx.auditUserId,
          billingCustomerId,
          customerContactId: contract.data.invoiceCustomerContactId,
          action: stripeCustomerAction,
          stripeCustomerId: stripe.stripeCustomerId,
          contactEmail: stripe.stripeContactEmail
        });
        if (!linked.ok) message = linked.message;
      } catch (err) {
        logger.error("Failed to link the Stripe customer", {
          companyId,
          customerContractId: id,
          billingCustomerId,
          error: err
        });
        message = getErrorMessage(
          err,
          "the Stripe customer could not be linked"
        );
      }
      if (message) {
        return ctx.error("rule", `Contract not confirmed — ${message}`);
      }
    }

    const result = await postContract(ctx, {
      type: "confirm",
      customerContractId: id,
      asOf: await companyToday(ctx)
    });
    if (result.error) {
      return ctx.error(
        "rule",
        getErrorMessage(result.error, "Failed to confirm the contract"),
        result.error
      );
    }
    return { id };
  }
});

const contractAmendment = customerContractAmendmentValidator.extend({
  changes: z
    .array(contractAmendmentChangeValidator)
    .min(1, { message: "Change at least one line" })
});

/**
 * Preview an amendment to an Active contract.
 *
 * @remarks
 * Runs the amendment the way `sales.contract.amend` would and rolls it
 * back: the adjustments, the next two invoices and the suggested contract
 * type.
 *
 * @mcp
 */
export const previewContractAmendment = defineServiceFn({
  input: contractAmendment.omit({ reason: true, contractType: true }),
  permission: { update: "sales" },

  async run(ctx, { customerContractId, amendmentDate, effect, changes }) {
    const result = await postContract(ctx, {
      type: "amend",
      customerContractId,
      asOf: await companyToday(ctx),
      amendmentDate,
      effect,
      // Neither changes what the amendment does; both are recorded only.
      contractType: "Existing",
      reason: "Preview",
      changes,
      preview: true
    });
    if (result.error) {
      return ctx.error(
        "rule",
        getErrorMessage(result.error, "Failed to preview the amendment"),
        result.error
      );
    }
    return result.data as ContractAmendmentPreview;
  }
});

/**
 * Amend an Active contract.
 *
 * @remarks
 * Changes, adds or ends lines from `amendmentDate`, recorded with its type
 * and reason. The `post-customer-contract` server function owns every guard
 * and re-plans the schedule and revenue from the effective date; its
 * refusal is the message.
 *
 * @mcp
 */
export const amendContract = defineServiceFn({
  input: contractAmendment,
  permission: { update: "sales" },

  async run(ctx, input) {
    const result = await postContract(ctx, {
      type: "amend",
      asOf: await companyToday(ctx),
      ...input
    });
    if (result.error) {
      return ctx.error(
        "rule",
        getErrorMessage(result.error, "Failed to amend the contract"),
        result.error
      );
    }
    return { id: input.customerContractId };
  }
});

/**
 * Preview cancelling an Active contract.
 *
 * @remarks
 * Runs the cancellation and rolls it back: the credit available for the
 * unused time after `endDate`.
 *
 * @mcp
 */
export const previewContractCancellation = defineServiceFn({
  input: z.object({ customerContractId: z.string(), endDate: z.string() }),
  permission: { update: "sales" },

  async run(ctx, { customerContractId, endDate }) {
    const result = await postContract(ctx, {
      type: "cancel",
      customerContractId,
      asOf: await companyToday(ctx),
      endDate,
      // Recorded only; the preview's credit does not depend on either.
      reason: "Preview",
      creditUnusedTime: false,
      preview: true
    });
    if (result.error) {
      return ctx.error(
        "rule",
        getErrorMessage(result.error, "Failed to preview the cancellation"),
        result.error
      );
    }
    return result.data as ContractCancellationPreview;
  }
});

/**
 * Cancel an Active contract.
 *
 * @remarks
 * Ends it at `endDate`. With `creditUnusedTime` a Draft credit memo is
 * drafted for the unused time, which needs the invoicing create permission
 * as well; `memoReadableId` names it.
 *
 * @mcp
 */
export const cancelContract = defineServiceFn({
  input: z.object({
    customerContractId: z.string(),
    endDate: z.string(),
    reason: z.string().trim().min(1),
    creditUnusedTime: z.boolean().default(false)
  }),
  permission: { update: "sales" },

  async run(ctx, input) {
    if (
      input.creditUnusedTime &&
      !ctx.can({ update: "sales", create: "invoicing" })
    ) {
      return forbidden(ctx);
    }
    const result = await postContract(ctx, {
      type: "cancel",
      asOf: await companyToday(ctx),
      ...input
    });
    if (result.error) {
      return ctx.error(
        "rule",
        getErrorMessage(result.error, "Failed to cancel the contract"),
        result.error
      );
    }
    const cancelled = result.data as Partial<ContractCancellationResult> | null;
    return {
      id: input.customerContractId,
      memoReadableId: cancelled?.memoReadableId ?? null
    };
  }
});

/**
 * Revert a contract's cancellation.
 *
 * @remarks
 * Restores the lines, end date and renewal it changed. When the
 * cancellation drafted a credit memo, it is deleted, which needs the
 * invoicing delete permission as well (a failed check for one asks for it).
 *
 * @mcp
 */
export const revertContractCancellation = defineServiceFn({
  input: z.object({ customerContractId: z.string() }),
  permission: { update: "sales" },

  async run(ctx, { customerContractId }) {
    const memoRows = await ctx.asCaller.supabase
      .from("customerContractInvoiceLine")
      .select("id")
      .eq("customerContractId", customerContractId)
      .eq("companyId", ctx.company.id)
      .not("memoId", "is", null)
      .limit(1);
    if (
      (memoRows.error || memoRows.data.length > 0) &&
      !ctx.can({ update: "sales", delete: "invoicing" })
    ) {
      return forbidden(ctx);
    }

    const result = await postContract(ctx, {
      type: "revert-cancellation",
      customerContractId,
      asOf: await companyToday(ctx)
    });
    if (result.error) {
      return ctx.error(
        "rule",
        getErrorMessage(result.error, "Failed to revert the cancellation"),
        result.error
      );
    }
    return { id: customerContractId };
  }
});

// --- Rental agreements ------------------------------------------------------

/** The rental lifecycle server function, run as the system for the caller. */
function postRentalAgreement(
  ctx: ServiceContext,
  input: ServerFnInput<"post-rental-agreement">
) {
  return serverFns
    .system({
      db: ctx.asSystem.pg,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    })
    .invoke("post-rental-agreement", input);
}

/** A rental agreement of this company, or why not. */
async function ownRentalAgreement(ctx: ServiceContext, id: string) {
  const agreement = await getRentalAgreement(
    ctx.asCaller.supabase,
    id,
    ctx.company.id
  );
  if (agreement.error || agreement.data?.companyId !== ctx.company.id) {
    return ctx.error("notFound", "Rental agreement not found", agreement.error);
  }
  return agreement.data;
}

const rentalAgreementInput = rentalAgreementValidator.safeExtend({
  ownershipTransfers: z.boolean().default(false),
  specializedAsset: z.boolean().default(false),
  purchaseOptionReasonablyCertain: z.boolean().default(false),
  customFields: customFieldValues.optional()
});

/**
 * Create a Draft rental agreement.
 *
 * @remarks
 * Takes the next agreement number. With `fixedAssetId` (the fleet's Rent)
 * the unit is added at its monthly rate on file; when that fails the
 * agreement is kept and `warning` says so. The agreement is then set up
 * from its units step.
 *
 * @mcp
 */
export const createRentalAgreement = defineServiceFn({
  input: rentalAgreementInput.safeExtend({
    fixedAssetId: z.string().optional()
  }),
  permission: { create: "sales" },

  async run(ctx, input) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const {
      id: _id,
      rentalAgreementId: _rentalAgreementId,
      fixedAssetId,
      customFields,
      ...data
    } = input;

    const sequence = await getNextSequenceNumber(
      client,
      "rentalAgreement",
      companyId
    );
    if (sequence.error || !sequence.data) {
      return ctx.error(
        "internal",
        "Failed to get the next rental agreement number",
        sequence.error
      );
    }
    const agreement = await insertRentalAgreement(client, {
      ...data,
      rentalAgreementId: sequence.data,
      companyId,
      createdBy: ctx.auditUserId,
      customFields
    });
    if (agreement.error || !agreement.data) {
      return ctx.error(
        "internal",
        "Failed to create rental agreement",
        agreement.error
      );
    }
    const id = agreement.data.id;

    if (fixedAssetId) {
      const line = await upsertRentalAgreementLine(client, {
        rentalAgreementId: id,
        fixedAssetId,
        // The planner can change the frequency and rate on the unit.
        rateUnit: "Month",
        companyId,
        createdBy: ctx.auditUserId
      });
      if (line.error) {
        logger.error("Failed to add the unit to a new rental agreement", {
          companyId,
          rentalAgreementId: id,
          error: line.error
        });
        return {
          id,
          warning: "Agreement created, but the unit could not be added"
        };
      }
    }
    return { id, warning: null };
  }
});

const rentalTermFields = [
  "customerId",
  "customerLocationId",
  "customerContactId",
  "salesPersonId",
  "locationId",
  "startDate",
  "endDate",
  "billingCycle",
  "billingTiming",
  "paymentTermId",
  "currencyCode",
  "depositAmount",
  "taxPercent",
  "discountRate",
  "ownershipTransfers",
  "specializedAsset",
  "purchaseOptionAmount",
  "purchaseOptionReasonablyCertain",
  "notes"
] as const;

const rentalBooleanTerms = new Set<string>([
  "ownershipTransfers",
  "specializedAsset",
  "purchaseOptionReasonablyCertain"
]);

/**
 * Set one term of a Draft rental agreement.
 *
 * @remarks
 * The terms are checked as a whole (an end date after the start, a purchase
 * option reasonably certain needs an end date), so the stored terms are
 * read, the one field is swapped in and the whole set is validated and
 * saved. A new customer clears the site and contact; a new currency brings
 * today's rate. The yes/no terms take `true` or `on`.
 *
 * @mcp
 */
export const setRentalAgreementTerm = defineServiceFn({
  input: z.object({
    id: z.string(),
    field: z.enum(rentalTermFields),
    value: z.string().nullish()
  }),
  permission: { update: "sales" },

  async run(ctx, { id, field, value }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const agreement = await ownRentalAgreement(ctx, id);
    if (agreement instanceof Error) return agreement;
    if (agreement.status !== "Draft") {
      return ctx.error(
        "rule",
        "Only a Draft rental agreement's terms can be edited"
      );
    }

    const terms: Record<(typeof rentalTermFields)[number], unknown> = {
      customerId: agreement.customerId,
      customerLocationId: agreement.customerLocationId,
      customerContactId: agreement.customerContactId,
      salesPersonId: agreement.salesPersonId,
      locationId: agreement.locationId,
      startDate: agreement.startDate,
      endDate: agreement.endDate,
      billingCycle: agreement.billingCycle,
      billingTiming: agreement.billingTiming,
      paymentTermId: agreement.paymentTermId,
      currencyCode: agreement.currencyCode,
      depositAmount: agreement.depositAmount,
      taxPercent: agreement.taxPercent,
      discountRate: agreement.discountRate,
      ownershipTransfers: agreement.ownershipTransfers,
      specializedAsset: agreement.specializedAsset,
      purchaseOptionAmount: agreement.purchaseOptionAmount,
      purchaseOptionReasonablyCertain:
        agreement.purchaseOptionReasonablyCertain,
      notes: agreement.notes
    };
    terms[field] = rentalBooleanTerms.has(field)
      ? value === "on" || value === "true"
      : value || null;
    // A site and contact belong to one customer.
    if (field === "customerId" && value !== agreement.customerId) {
      terms.customerLocationId = null;
      terms.customerContactId = null;
    }

    // The same form the terms form posts, so the same coercion runs.
    const merged = new FormData();
    for (const key of rentalTermFields) {
      const term = terms[key];
      if (rentalBooleanTerms.has(key)) {
        if (term) merged.append(key, "on");
      } else if (term !== null && term !== undefined && term !== "") {
        merged.append(key, String(term));
      }
    }
    if (field === "currencyCode" && value && value !== agreement.currencyCode) {
      const rate = await getExchangeRate(client, companyId, value);
      if (rate.error) {
        return ctx.error(
          "internal",
          "Failed to get the exchange rate",
          rate.error
        );
      }
      merged.append("exchangeRate", String(rate.data));
    }

    const validation = await validator(rentalAgreementValidator).validate(
      merged
    );
    if (validation.error) {
      return ctx.error(
        "validation",
        Object.values(validation.error.fieldErrors)[0] ??
          "These terms are not valid"
      );
    }
    const {
      id: _id,
      rentalAgreementId: _rentalAgreementId,
      ...data
    } = validation.data;

    const update = await updateRentalAgreement(client, {
      ...data,
      id,
      companyId,
      updatedBy: ctx.auditUserId,
      customFields: agreement.customFields ?? undefined
    });
    if (update.error) {
      logger.error("rental agreement term update failed", {
        companyId,
        id,
        field,
        error: update.error
      });
      return ctx.error(
        "rule",
        update.error.message || "Failed to update rental agreement",
        update.error
      );
    }
    return { id };
  }
});

/**
 * Set how a rental agreement's invoices are posted and sent.
 *
 * @remarks
 * Null is the company's setting. Stays editable while the agreement is
 * Active. Stripe needs Stripe connected; Post and Email needs a contact
 * email.
 *
 * @mcp
 */
export const setRentalInvoiceAutomation = defineServiceFn({
  input: z.object({
    id: z.string(),
    invoiceAutomation: z.enum(invoiceAutomations).nullable()
  }),
  permission: { update: "sales" },

  async run(ctx, { id, invoiceAutomation }) {
    if (
      invoiceAutomation === "Post and Send via Stripe" &&
      !(await getStripeConnectAccountId(ctx.asSystem.supabase, ctx.company.id))
    ) {
      return ctx.error("rule", "Connect Stripe in Integrations first");
    }
    const update = await updateRentalAgreementInvoiceAutomation(
      ctx.asCaller.supabase,
      {
        id,
        companyId: ctx.company.id,
        invoiceAutomation,
        updatedBy: ctx.auditUserId
      }
    );
    if (update.error) {
      return ctx.error(
        "rule",
        update.error.message || "Failed to update invoicing",
        update.error
      );
    }
    return { id };
  }
});

/**
 * Activate a Draft rental agreement.
 *
 * @remarks
 * Needs at least one unit. The `post-rental-agreement` server function then
 * checks every unit, classifies each line (rental or sale), books a sale's
 * commencement and cuts the first billing periods, in one transaction; its
 * refusal is the message.
 *
 * @mcp
 */
export const activateRentalAgreement = defineServiceFn({
  input: z.object({ id: z.string() }),
  permission: { update: "sales" },

  async run(ctx, { id }) {
    const agreement = await ownRentalAgreement(ctx, id);
    if (agreement instanceof Error) return agreement;
    if (agreement.status !== "Draft") {
      return ctx.error(
        "conflict",
        "Only a Draft rental agreement can be activated"
      );
    }
    if (!agreement.lineCount) {
      return ctx.error("rule", "Add a unit before activating");
    }

    const result = await postRentalAgreement(ctx, {
      type: "activate",
      rentalAgreementId: id
    });
    if (result.error) {
      return ctx.error(
        "rule",
        getErrorMessage(result.error, "Failed to activate rental agreement"),
        result.error
      );
    }
    return { id };
  }
});

/**
 * Close or cancel a rental agreement.
 *
 * @remarks
 * Close needs every unit back and every period and charge invoiced, and no
 * open rental shipment or receipt. Cancel needs nothing on rent, sold,
 * invoiced or recognized, and deletes the Pending lines. The
 * `post-rental-agreement` server function owns the checks; its refusal is
 * the message.
 *
 * @mcp
 */
export const setRentalAgreementStatus = defineServiceFn({
  input: z.object({ id: z.string(), intent: z.enum(["close", "cancel"]) }),
  permission: { update: "sales" },

  async run(ctx, { id, intent }) {
    const agreement = await ownRentalAgreement(ctx, id);
    if (agreement instanceof Error) return agreement;

    const result = await postRentalAgreement(ctx, {
      type: intent,
      rentalAgreementId: id
    });
    if (result.error) {
      return ctx.error(
        "rule",
        getErrorMessage(
          result.error,
          intent === "close"
            ? "Failed to close rental agreement"
            : "Failed to cancel rental agreement"
        ),
        result.error
      );
    }
    return { id, intent };
  }
});

/**
 * Release a Pending unit that never left the yard.
 *
 * @remarks
 * Its billing stops at `returnedAt` and the line is Returned. Refused for a
 * future date, a line that is not Pending, a unit treated as a sale, and a
 * unit on an open rental shipment or receipt.
 *
 * @mcp
 */
export const releaseRentalUnit = defineServiceFn({
  input: z.object({
    rentalAgreementId: z.string(),
    rentalAgreementLineId: z.string(),
    returnedAt: z.string().min(1)
  }),
  permission: { update: "sales" },

  async run(ctx, input) {
    const result = await postRentalAgreement(ctx, {
      type: "release",
      ...input
    });
    if (result.error) {
      return ctx.error(
        "rule",
        getErrorMessage(result.error, "Failed to release the unit"),
        result.error
      );
    }
    return { rentalAgreementLineId: input.rentalAgreementLineId };
  }
});

/**
 * Put a rental unit on a shipment to deliver it.
 *
 * @remarks
 * Adds the unit to the agreement's Draft rental shipment (or creates one);
 * the shipment is posted from inventory. Only on an Active agreement.
 *
 * @mcp
 */
export const deliverRentalUnit = defineServiceFn({
  input: z.object({
    rentalAgreementId: z.string(),
    rentalAgreementLineId: z.string()
  }),
  permission: { update: "sales", create: "inventory" },

  async run(ctx, input) {
    const result = await serverFns
      .system({
        db: ctx.asSystem.pg,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      })
      .invoke("create", { type: "shipmentFromRentalAgreement", ...input });
    if (result.error || !result.data) {
      return ctx.error(
        "rule",
        getErrorMessage(result.error, "Failed to create the shipment"),
        result.error
      );
    }
    return { shipmentId: result.data.id };
  }
});

/**
 * Put a rental unit on a receipt to return it.
 *
 * @remarks
 * Adds the unit to the agreement's Draft rental receipt (or creates one);
 * the receipt is posted from inventory. Only on an Active agreement.
 *
 * @mcp
 */
export const returnRentalUnit = defineServiceFn({
  input: z.object({
    rentalAgreementId: z.string(),
    rentalAgreementLineId: z.string()
  }),
  permission: { update: "sales", create: "inventory" },

  async run(ctx, input) {
    const result = await serverFns
      .system({
        db: ctx.asSystem.pg,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      })
      .invoke("create", { type: "receiptFromRentalAgreement", ...input });
    if (result.error || !result.data) {
      return ctx.error(
        "rule",
        getErrorMessage(result.error, "Failed to create the receipt"),
        result.error
      );
    }
    return { receiptId: result.data.id };
  }
});

/**
 * Override how a Draft rental agreement's unit is accounted for.
 *
 * @remarks
 * Rental or Sale, with a reason, while the agreement is Draft (activation
 * fixes the treatment). Read and written with the service role, since an
 * accountant may not see sales; an audit entry is written best-effort.
 *
 * @mcp
 */
export const classifyRentalUnit = defineServiceFn({
  input: rentalAgreementLineClassificationValidator.extend({
    rentalAgreementId: z.string(),
    rentalAgreementLineId: z.string()
  }),
  permission: { update: "accounting" },

  async run(
    ctx,
    {
      rentalAgreementId: id,
      rentalAgreementLineId: lineId,
      classification,
      reason
    }
  ) {
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;
    const fixed = "The classification is fixed once the agreement is activated";

    const [agreement, line] = await Promise.all([
      serviceRole
        .from("rentalAgreement")
        .select("id, status")
        .eq("id", id)
        .eq("companyId", companyId)
        .maybeSingle(),
      serviceRole
        .from("rentalAgreementLine")
        .select(
          "id, lessorClassification, classificationOverride, classificationOverrideReason"
        )
        .eq("id", lineId)
        .eq("rentalAgreementId", id)
        .eq("companyId", companyId)
        .maybeSingle()
    ]);
    if (agreement.error || !agreement.data || line.error || !line.data) {
      return ctx.error(
        "notFound",
        "This unit does not belong to this rental agreement",
        agreement.error ?? line.error
      );
    }
    if (agreement.data.status !== "Draft") return ctx.error("rule", fixed);

    // Activation stamps `classificationInputs`: an agreement activated since
    // the read above matches no row.
    const update = await serviceRole
      .from("rentalAgreementLine")
      .update({
        lessorClassification: classification,
        classificationOverride: true,
        classificationOverrideReason: reason,
        updatedBy: ctx.auditUserId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", lineId)
      .eq("companyId", companyId)
      .is("classificationInputs", null)
      .select("id")
      .maybeSingle();
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to override the classification",
        update.error
      );
    }
    if (!update.data) return ctx.error("conflict", fixed);

    // Best-effort: a failed audit write never undoes the override.
    try {
      await insertAuditLogEntries(serviceRole, companyId, [
        {
          tableName: "rentalAgreementLine",
          entityType: "rentalAgreement",
          entityId: id,
          recordId: lineId,
          operation: "UPDATE",
          actorId: ctx.auditUserId,
          diff: {
            lessorClassification: {
              old: line.data.lessorClassification,
              new: classification
            },
            classificationOverride: {
              old: line.data.classificationOverride,
              new: true
            },
            classificationOverrideReason: {
              old: line.data.classificationOverrideReason,
              new: reason
            }
          },
          metadata: { origin: "web" }
        }
      ]);
    } catch (err) {
      logger.warn("audit write skipped for a classification override", {
        error: err
      });
    }
    return { rentalAgreementLineId: lineId, classification };
  }
});

/**
 * Sell a rental unit to its customer: exercise the purchase option.
 *
 * @remarks
 * Only for a unit treated as a sale, on rent under an Active agreement with
 * a purchase option, once per unit, and not before the end of the term
 * (ending a sale early is a manual journal). Bills the option as a Purchase
 * Option charge dated today and drafts its invoice; posting that invoice
 * transfers the unit. An invoice the automation may post is queued for it.
 *
 * @mcp
 */
export const sellRentalUnit = defineServiceFn({
  input: z.object({
    rentalAgreementId: z.string(),
    rentalAgreementLineId: z.string()
  }),
  permission: { create: ["sales", "invoicing"], update: "sales" },

  async run(ctx, { rentalAgreementId: id, rentalAgreementLineId: lineId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    const [agreement, line] = await Promise.all([
      getRentalAgreement(client, id, companyId),
      getRentalAgreementLine(client, lineId, companyId)
    ]);
    if (
      agreement.error ||
      agreement.data?.companyId !== companyId ||
      line.error ||
      line.data.rentalAgreementId !== id
    ) {
      return ctx.error(
        "notFound",
        "This unit does not belong to this rental agreement"
      );
    }

    const amount = agreement.data.purchaseOptionAmount;
    if (
      agreement.data.status !== "Active" ||
      line.data.lessorClassification !== "Sale" ||
      line.data.status !== "On Rent" ||
      !amount
    ) {
      return ctx.error(
        "rule",
        "Only a unit treated as a sale, on rent under an agreement with a purchase option, can be sold"
      );
    }

    const billed = "The purchase option has already been billed";
    const existing = await client
      .from("rentalAgreementCharge")
      .select("id")
      .eq("rentalAgreementLineId", lineId)
      .eq("companyId", companyId)
      .eq("chargeType", "Purchase Option")
      .limit(1);
    if (existing.error) {
      return ctx.error(
        "internal",
        "Failed to check the purchase option",
        existing.error
      );
    }
    if (existing.data.length > 0) return ctx.error("conflict", billed);

    const today = await companyToday(ctx);
    // The schedule and the remaining rent run to the end date.
    const endDate = agreement.data.endDate;
    if (endDate && today < endDate) {
      return ctx.error(
        "rule",
        `The purchase option is exercised at the end of the term (${endDate}); ending a rental treated as a sale early is a manual journal`
      );
    }

    const charge = await insertRentalPurchaseOptionCharge(client, {
      rentalAgreementLineId: lineId,
      amount,
      chargeDate: today,
      description: "Purchase option exercised",
      taxPercent: agreement.data.taxPercent ?? 0,
      companyId,
      createdBy: ctx.auditUserId
    });
    if (charge.error) {
      // 23505: a concurrent request billed it first.
      return charge.error.code === "23505"
        ? ctx.error("conflict", billed)
        : ctx.error(
            "internal",
            "Failed to bill the purchase option",
            charge.error
          );
    }

    let invoices: DraftedRentalInvoice[];
    try {
      ({ invoices } = await generateRentalInvoicesNow(ctx.asSystem.pg, {
        companyId,
        asOf: today,
        rentalAgreementId: id,
        userId: ctx.auditUserId
      }));
    } catch (err) {
      return ctx.error(
        "internal",
        err instanceof Error
          ? `The purchase option was billed but its invoice was not drafted: ${err.message}`
          : "The purchase option was billed but its invoice was not drafted",
        err
      );
    }

    // Normally on a held charges invoice; anything automatable posts in the
    // background.
    const toAutomate = invoices.filter(
      (invoice) => invoice.mode !== "Draft Only" && !invoice.holdReason
    );
    if (toAutomate.length > 0) {
      await batchTrigger(
        "invoice-automate",
        toAutomate.map((invoice) => ({
          payload: { companyId, invoiceId: invoice.invoiceId }
        }))
      );
    }
    return { invoiceIds: invoices.map((invoice) => invoice.invoiceId) };
  }
});
