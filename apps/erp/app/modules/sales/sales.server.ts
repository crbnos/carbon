import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import {
  createRentalInvoicesForDuePeriods,
  type RentalInvoiceGenerationArgs,
  releaseRentalInvoiceStamps
} from "@carbon/database/rental-billing";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import type { Violation } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCompanySettings } from "~/modules/settings";
import { getDatabaseClient } from "~/services/database.server";

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
  lineId: string;
  line: Record<string, unknown>;
  removedQuantities: number[];
  priceRows: Record<string, unknown>[];
}): Promise<void> {
  const { lineId, line, removedQuantities, priceRows } = args;
  const db = getDatabaseClient();

  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable("quoteLine")
      .set(line as never)
      .where("id", "=", lineId)
      .execute();

    if (removedQuantities.length > 0) {
      await trx
        .deleteFrom("quoteLinePrice")
        .where("quoteLineId", "=", lineId)
        .where("quantity", "in", removedQuantities)
        .execute();
    }

    if (priceRows.length > 0) {
      await trx
        .insertInto("quoteLinePrice")
        .values(priceRows as never)
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
 * which checks the agreement is Active, the line is a Sales-Type unit On Rent
 * and the option is not already billed). Server-only on purpose: the
 * `sales.service.ts` charge writer is an MCP tool and only ever writes a
 * `Charge`, so no caller can name this kind and skip those checks.
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
    .insert([{ ...charge, kind: "Purchase Option" as const }])
    .select("id")
    .single();
}

/** The agreement page's "Generate invoices": drafts an invoice for whatever
 *  the agreement has due today, exactly as the daily job would. */
export async function generateRentalInvoicesNow(
  db: Kysely<KyselyDatabase>,
  args: RentalInvoiceGenerationArgs
): Promise<{ invoiceIds: string[] }> {
  return createRentalInvoicesForDuePeriods(db, args);
}

/**
 * Deletes a Draft sales invoice and, in the same transaction, releases the
 * rental billing periods and charges it billed so the next generation bills
 * them again. `salesInvoiceLineId` on those rows has no foreign key, so a
 * plain delete would leave them stamped as billed forever. Throws on a
 * missing or non-Draft invoice.
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
      .where("invoiceLineType", "=", "Rental")
      .execute();
    await releaseRentalInvoiceStamps(trx, {
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

/** One line of a Draft invoice, releasing the rental period or charge it
 *  billed (see `deleteSalesInvoiceReleasingRentals`). The line must belong
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

    await releaseRentalInvoiceStamps(trx, {
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
