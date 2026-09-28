import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database, Json } from "@carbon/database";
import { trigger } from "@carbon/jobs";
import { trackWorkEvent } from "@carbon/lib/telemetry";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import type { Violation } from "@carbon/utils";
import { datetime, getSalesOrderStatus } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { runMRP } from "~/modules/production/production.service";
import { getCompanySettings } from "~/modules/settings";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getDatabaseClient } from "~/services/database.server";
import { sanitize } from "~/utils/supabase";
import type {
  quoteLineValidator,
  quoteMaterialValidator,
  quoteOperationValidator
} from "./sales.models";
import {
  buildMakeToOrderPriceRows,
  buildPullFromInventoryPriceRows,
  buildPurchaseToOrderPriceRows,
  deleteQuoteMaterial,
  getSalesOrderLines,
  type QuoteLinePriceRow,
  recalculateQuoteLinePrices,
  resolvePurchaseToOrderPrices,
  resolveQuoteLinePrices,
  upsertQuoteLine,
  upsertQuoteLineMethod,
  upsertQuoteMaterial,
  upsertQuoteMaterialMakeMethod,
  upsertQuoteOperation
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
// Route commands
// ---------------------------------------------------------------------------
//
// Each command below is the WHOLE operation a route action performs after its
// request-level gates (auth, company ownership, lock, sales-rule
// acknowledgement): the write plus the orchestration the bare service
// primitive lacks (price reconciliation, make-method pulls, MRP). The route
// calls the command, and `sales.mcp.server.ts` publishes the same command under
// the tool name of the primitive it replaces, so MCP, the in-app agent and
// workflows run exactly what the UI runs.
//
// A command never throws for an expected failure. It returns the route's own
// failure text in `error.message` and the underlying error in `cause`, so the
// route keeps flashing the same message and the MCP wrapper can surface both.

export type CommandResult<T> =
  | { data: T; error: null }
  | { data: T | null; error: { message: string }; cause: unknown };

function failed<T>(
  message: string,
  cause: unknown,
  data: T | null = null
): CommandResult<T> {
  return { data, error: { message }, cause };
}

type QuoteLineInput = Omit<z.infer<typeof quoteLineValidator>, "id">;

/**
 * Update a quote line and reconcile its quantity-break prices in one
 * transaction: prune the price rows of removed breaks and seed rows for added
 * breaks (Make to Order, Pull from Inventory, Purchase to Order). The route
 * behind the quote line form and `sales_upsertQuoteLine` (update) both run it.
 *
 * `serviceRole` does the price reads; the write goes through Kysely, so the
 * CALLER must have verified permission, company ownership and the quote lock.
 */
export async function updateQuoteLineWithPrices(
  serviceRole: SupabaseClient<Database>,
  args: {
    companyId: string;
    quoteId: string;
    lineId: string;
    userId: string;
    line: QuoteLineInput;
    customFields?: Json;
  }
): Promise<CommandResult<{ id: string }>> {
  const { companyId, quoteId, lineId, userId, line } = args;

  const existingPrices = await serviceRole
    .from("quoteLinePrice")
    .select("quantity")
    .eq("quoteLineId", lineId)
    .eq("companyId", companyId);
  if (existingPrices.error) {
    return failed(
      "Failed to read existing quote line prices",
      existingPrices.error
    );
  }

  // Reconcile in both directions. Seeding is method-specific and only covers
  // the three types below, but PRUNING is unconditional: a break removed from a
  // Make to Stock line — or from a line whose breaks were all cleared — would
  // otherwise leave rows behind that render as selectable options on the
  // customer share page and trip the finalize validation.
  const { added: addedQuantities, removed: removedQuantities } =
    reconcileQuantityBreaks(
      (existingPrices.data ?? []).map((p) => p.quantity),
      line.quantity ?? []
    );

  const methodType = line.methodType;
  const needsSeed =
    methodType === "Make to Order" ||
    methodType === "Pull from Inventory" ||
    methodType === "Purchase to Order";

  let priceRows: QuoteLinePriceRow[] = [];
  if (needsSeed && addedQuantities.length > 0) {
    // The stored line still holds the OLD itemId — the new one is only in the
    // input — so pass it through rather than let the builder read a value this
    // same call is about to change.
    const built =
      methodType === "Make to Order"
        ? await buildMakeToOrderPriceRows(
            serviceRole,
            quoteId,
            lineId,
            addedQuantities,
            userId,
            line.itemId
          )
        : methodType === "Pull from Inventory"
          ? await buildPullFromInventoryPriceRows(
              serviceRole,
              companyId,
              quoteId,
              lineId,
              addedQuantities,
              userId,
              line.itemId
            )
          : await buildPurchaseToOrderPriceRows(
              serviceRole,
              companyId,
              quoteId,
              lineId,
              addedQuantities,
              userId,
              line.itemId
            );
    if (built.error) {
      return failed(
        `Failed to calculate ${methodType} prices for new quantities`,
        built.error
      );
    }
    priceRows = built.rows;
  }

  try {
    await saveQuoteLineWithPrices({
      companyId,
      quoteId,
      lineId,
      line: {
        ...sanitize({ ...line, updatedBy: userId }),
        ...(args.customFields !== undefined
          ? { customFields: args.customFields }
          : {})
      },
      removedQuantities,
      priceRows
    });
  } catch (err) {
    // Kysely throws on rollback — nothing was written.
    return failed("Failed to update quote line", err);
  }

  return { data: { id: lineId }, error: null };
}

/**
 * Create a quote line and give it the pricing the add-line form gives it:
 * Purchase to Order and Pull from Inventory seed one price row per quantity
 * break; Make to Order pulls the item's make method onto the line and reprices.
 * The route behind the add-line form and `sales_upsertQuoteLine` (create) both
 * run it.
 *
 * `client` does every write; the route passes the service role after verifying
 * the quote belongs to the company and is unlocked. When the line inserted but
 * a pricing step failed, `data.id` is still set — the line exists.
 */
export async function createQuoteLineWithPrices(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    quoteId: string;
    userId: string;
    line: QuoteLineInput;
    configuration?: Record<string, unknown>;
    customFields?: Json;
  }
): Promise<CommandResult<{ id: string }>> {
  const { companyId, quoteId, userId, line, configuration } = args;

  const created = await upsertQuoteLine(client, {
    ...line,
    // The caller verified this quote; a copy inside `line` was not.
    quoteId,
    companyId,
    configuration,
    createdBy: userId,
    customFields: args.customFields
  });
  if (created.error || !created.data) {
    logger.error("Failed to create quote line", { error: created.error });
    return failed("Failed to create quote line.", created.error);
  }

  const quoteLineId = created.data.id;
  const data = { id: quoteLineId };
  const quantities = line.quantity ?? [1];

  if (line.methodType === "Purchase to Order") {
    const priceResult = await resolvePurchaseToOrderPrices(
      client,
      companyId,
      quoteId,
      quoteLineId,
      quantities,
      userId
    );
    if (priceResult?.error) {
      return failed(
        "Failed to resolve Purchase to Order prices",
        priceResult.error,
        data
      );
    }
  }

  if (line.methodType === "Pull from Inventory") {
    const priceResult = await resolveQuoteLinePrices(
      client,
      companyId,
      quoteId,
      quoteLineId,
      quantities,
      userId
    );
    if (priceResult?.error) {
      return failed(
        "Failed to resolve Pull from Inventory prices",
        priceResult.error,
        data
      );
    }
  }

  if (line.methodType === "Make to Order") {
    const upsertMethod = await upsertQuoteLineMethod(client, {
      quoteId,
      quoteLineId,
      itemId: line.itemId,
      configuration,
      companyId,
      userId
    });
    if (upsertMethod.error) {
      return failed(
        "Failed to create quote line method.",
        upsertMethod.error,
        data
      );
    }
    const recalcResult = await recalculateQuoteLinePrices(
      client,
      companyId,
      quoteId,
      quoteLineId,
      userId
    );
    if (recalcResult?.error) {
      return failed(
        "Failed to recalculate quote line prices",
        recalcResult.error,
        data
      );
    }
  }

  return { data, error: null };
}

type QuoteMaterialInput = z.infer<typeof quoteMaterialValidator> & {
  quoteId: string;
  quoteLineId: string;
  quoteOperationId?: string;
  companyId: string;
  customFields?: Json;
};

/**
 * Create or update a quote material and reprice the line, as the material
 * form routes do: a Make to Order CREATE pulls the item's active make method
 * into the material's child make method first (an update does not — the
 * update route never re-pulls), then the line's system-priced rows are
 * recalculated. `createdBy` vs `updatedBy` picks the branch, like the service.
 *
 * `client` does the material write (the routes pass the service role after
 * verifying ownership); the make-method pull and the recalculation always run
 * on the service role, like the routes. A failed recalculation is reported in
 * `error` with `data` set — the routes ignore it and keep the saved material.
 */
export async function saveQuoteMaterialWithPrices(
  client: SupabaseClient<Database>,
  material:
    | (QuoteMaterialInput & { createdBy: string })
    | (QuoteMaterialInput & { updatedBy: string })
): Promise<
  CommandResult<{
    id: string;
    methodType: Database["public"]["Enums"]["methodType"];
  }> & {
    failedStep?: "write" | "makeMethod" | "recalculate";
  }
> {
  const isUpdate = "updatedBy" in material;
  const userId = isUpdate ? material.updatedBy : material.createdBy;
  const { companyId, quoteId, quoteLineId } = material;
  const serviceRole = getCarbonServiceRole();

  const written = await upsertQuoteMaterial(client, material);
  if (written.error || !written.data?.id) {
    return {
      ...failed(
        isUpdate
          ? "Failed to update quote material"
          : "Failed to insert quote material",
        written.error ?? written
      ),
      failedStep: "write"
    };
  }
  const data = { id: written.data.id, methodType: written.data.methodType };

  if (!isUpdate && material.methodType === "Make to Order") {
    const materialMakeMethod = await serviceRole
      .from("quoteMaterialWithMakeMethodId")
      .select("*")
      .eq("id", data.id)
      .eq("companyId", companyId)
      .single();
    if (materialMakeMethod.error) {
      return {
        ...failed(
          "Failed to get material make method",
          materialMakeMethod.error
        ),
        failedStep: "makeMethod"
      };
    }
    const makeMethod = await upsertQuoteMaterialMakeMethod(serviceRole, {
      sourceId: material.itemId,
      targetId: materialMakeMethod.data?.quoteMaterialMakeMethodId!,
      companyId,
      userId
    });
    if (makeMethod.error) {
      return {
        ...failed(
          "Failed to insert quote material make method",
          makeMethod.error,
          data
        ),
        failedStep: "makeMethod"
      };
    }
  }

  const recalc = await recalculateQuoteLinePrices(
    serviceRole,
    companyId,
    quoteId,
    quoteLineId,
    userId
  );
  if (recalc?.error) {
    return {
      ...failed("Failed to recalculate quote line prices", recalc.error, data),
      failedStep: "recalculate"
    };
  }

  return { data, error: null };
}

/**
 * Delete a quote material and reprice its line, as the material delete route
 * does. `client` does the delete (the route passes the caller's client); the
 * recalculation runs on the service role.
 */
export async function deleteQuoteMaterialWithPrices(
  client: SupabaseClient<Database>,
  args: {
    quoteMaterialId: string;
    quoteId: string;
    quoteLineId: string;
    companyId: string;
    userId: string;
  }
): Promise<CommandResult<null> & { failedStep?: "write" | "recalculate" }> {
  const deleted = await deleteQuoteMaterial(client, args.quoteMaterialId);
  if (deleted.error) {
    return {
      ...failed("Failed to delete quote material", deleted.error),
      failedStep: "write"
    };
  }
  const recalc = await recalculateQuoteLinePrices(
    getCarbonServiceRole(),
    args.companyId,
    args.quoteId,
    args.quoteLineId,
    args.userId
  );
  if (recalc?.error) {
    return {
      ...failed("Failed to recalculate quote line prices", recalc.error),
      failedStep: "recalculate"
    };
  }
  return { data: null, error: null };
}

type QuoteOperationInput = Omit<
  z.infer<typeof quoteOperationValidator>,
  "id"
> & {
  quoteId: string;
  quoteLineId: string;
  companyId: string;
  customFields?: Json;
};

/**
 * Create or update a quote operation and reprice the line, as the operation
 * form routes do. `createdBy` vs `updatedBy` picks the branch, like the
 * service. `client` does the write (the routes pass the caller's client); the
 * recalculation runs on the service role.
 */
export async function saveQuoteOperationWithPrices(
  client: SupabaseClient<Database>,
  operation:
    | (QuoteOperationInput & { id?: string; createdBy: string })
    | (QuoteOperationInput & { id: string; updatedBy: string })
): Promise<
  CommandResult<{ id: string }> & {
    failedStep?: "write" | "recalculate";
  }
> {
  const isCreate = "createdBy" in operation;
  const userId = isCreate ? operation.createdBy : operation.updatedBy;

  const written = await upsertQuoteOperation(
    client,
    operation as Parameters<typeof upsertQuoteOperation>[1]
  );
  if (written.error || !written.data?.id) {
    return {
      ...failed(
        isCreate
          ? "Failed to insert quote operation"
          : "Failed to update quote operation",
        written.error ?? written
      ),
      failedStep: "write"
    };
  }
  const data = { id: written.data.id };

  const recalc = await recalculateQuoteLinePrices(
    getCarbonServiceRole(),
    operation.companyId,
    operation.quoteId,
    operation.quoteLineId,
    userId
  );
  if (recalc?.error) {
    return {
      ...failed("Failed to recalculate quote line prices", recalc.error, data),
      failedStep: "recalculate"
    };
  }
  return { data, error: null };
}

/**
 * Delete a quote operation and reprice its line, as the operation delete
 * route does. The operation's quote and line are read (company-scoped) before
 * the delete; an unknown id is refused before anything is written.
 */
export async function deleteQuoteOperationWithPrices(
  client: SupabaseClient<Database>,
  args: { quoteOperationId: string; companyId: string; userId: string }
): Promise<CommandResult<null> & { failedStep?: "write" | "recalculate" }> {
  const { quoteOperationId, companyId, userId } = args;
  const op = await client
    .from("quoteOperation")
    .select("quoteId, quoteLineId")
    .eq("id", quoteOperationId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (op.error || !op.data) {
    return {
      ...failed("Quote operation not found", op.error),
      failedStep: "write"
    };
  }

  const deleted = await client
    .from("quoteOperation")
    .delete()
    .eq("id", quoteOperationId)
    .eq("companyId", companyId);
  if (deleted.error) {
    return {
      ...failed(deleted.error.message, deleted.error),
      failedStep: "write"
    };
  }

  const recalc = await recalculateQuoteLinePrices(
    getCarbonServiceRole(),
    companyId,
    op.data.quoteId,
    op.data.quoteLineId,
    userId
  );
  if (recalc?.error) {
    return {
      ...failed("Failed to recalculate quote line prices", recalc.error),
      failedStep: "recalculate"
    };
  }
  return { data: null, error: null };
}

/**
 * Confirm a sales order: derive its status from the lines
 * (`getSalesOrderStatus` — an all-service order becomes "To Invoice"), stamp
 * the order date if it has none, then run MRP for the order so its lines
 * become demand. The confirm route runs this after its sales-rule gate and its
 * optional PDF/email; `sales_releaseSalesOrder` publishes it.
 *
 * `client` does the status write (the route passes the caller's client, so RLS
 * applies); the line read and MRP run on the service role, like the route. The
 * order must belong to `companyId`.
 */
export async function confirmSalesOrder(
  client: SupabaseClient<Database>,
  args: {
    salesOrderId: string;
    companyId: string;
    userId: string;
    /** Telemetry only: whether the confirm also emailed the customer. */
    emailed?: boolean;
  }
): Promise<CommandResult<{ id: string; status: string }>> {
  const { salesOrderId, companyId, userId } = args;
  const serviceRole = getCarbonServiceRole();

  const salesOrder = await serviceRole
    .from("salesOrder")
    .select("id, companyId, orderDate")
    .eq("id", salesOrderId)
    .maybeSingle();
  if (salesOrder.error || !salesOrder.data) {
    return failed("Failed to get sales order", salesOrder.error);
  }
  if (salesOrder.data.companyId !== companyId) {
    return failed("You are not authorized to confirm this sales order", null);
  }

  const orderLines = await getSalesOrderLines(serviceRole, salesOrderId);
  const { status } = getSalesOrderStatus(orderLines.data || []);

  const confirm = await client
    .from("salesOrder")
    .update({
      status,
      orderDate:
        salesOrder.data.orderDate ??
        datetime.today(await getCompanyTimeZone(client, companyId)).toString(),
      updatedAt: datetime.timestamp(),
      updatedBy: userId
    })
    .eq("id", salesOrderId)
    .eq("companyId", companyId);
  if (confirm.error) {
    return failed("Failed to confirm sales order", confirm.error);
  }

  const mrp = await runMRP(serviceRole, getDatabaseClient(), {
    type: "salesOrder",
    id: salesOrderId,
    companyId,
    userId
  });
  if (mrp.error) {
    // The confirm committed; the route never surfaced an MRP failure either.
    logger.error("MRP failed after sales order confirm", {
      salesOrderId,
      error: mrp.error
    });
  }

  trackWorkEvent("sales_order_confirmed", {
    companyId,
    userId,
    salesOrderId,
    lineCount: orderLines.data?.length ?? 0,
    derivedStatus: status,
    emailed: args.emailed ?? false
  });

  return { data: { id: salesOrderId, status }, error: null };
}
