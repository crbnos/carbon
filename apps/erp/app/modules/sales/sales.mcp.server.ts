import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database, Json } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { commandError } from "~/services/mcp-command-error";
import {
  requireToolCompanyRecord,
  requireToolPermission
} from "~/services/mcp-guards.server";
import {
  isQuoteLocked,
  type quoteLineValidator,
  type quoteMaterialValidator,
  type quoteOperationValidator,
  type salesOrderStatusType,
  type salesReturnDispositionType
} from "./sales.models";
import {
  confirmSalesOrder,
  createQuoteLineWithPrices,
  deleteQuoteMaterialWithPrices,
  deleteQuoteOperationWithPrices,
  saveQuoteMaterialWithPrices,
  saveQuoteOperationWithPrices,
  updateQuoteLineWithPrices
} from "./sales.server";
import {
  setReturnLineDispositionFromPicker,
  transitionSalesOrderStatus
} from "./sales-transitions.server";

// Sales route commands published under the tool names of the bare service
// primitives they replace. Each export here SHADOWS the same-named export of
// `sales.service.ts` (the generator dedupes by name, and the registry spreads
// this module last), so `sales_upsertQuoteLine` and friends keep their names
// and payload schemas but run the command the route runs.
//
// A wrapper does three things and nothing else: re-apply the route's request
// gates (permission, company ownership, quote lock) that the MCP path would
// otherwise skip, adapt the tool's payload to the command's arguments, and
// turn the command's result into `{ data, error }`. Business logic lives in
// `sales.server.ts` (shared with the route) or the service, never here.
// Sales rules are evaluated by the dispatch gate (`sales-rules-gate.server.ts`)
// before any of these run.
//
// `client` MUST stay named `client` and first — the dispatcher injects it by
// name. Server-only: never re-export from the module barrel.

const LOCKED_QUOTE_MESSAGE = "Cannot modify a locked quote. Reopen it first.";

async function requireUnlockedQuote(companyId: string, quoteId: string) {
  const quote = await getCarbonServiceRole()
    .from("quote")
    .select("status")
    .eq("id", quoteId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (quote.error || !quote.data) throw new Error("Quote not found.");
  if (isQuoteLocked(quote.data.status)) throw new Error(LOCKED_QUOTE_MESSAGE);
}

/**
 * Create or update a quote line and its quantity-break prices as the quote line forms do; keep `description` a short label (long specs go in externalNotes).
 *
 * `description` is truncated on the digital quote. `externalNotes` (TipTap doc
 * JSON) renders in full under the line on the digital quote and PDF;
 * `internalNotes` takes the same shape and is never shown to the customer.
 *
 * Create (no `id`): inserts the line, then seeds one price row per quantity
 * break (Purchase to Order, Pull from Inventory) or pulls the item's make
 * method onto the line and reprices it (Make to Order).
 * Update (with `id`): saves the line and reconciles its price rows in one
 * transaction — rows for removed quantity breaks are deleted, rows for added
 * breaks are seeded. Omitted fields are left unchanged.
 *
 * Refused while the quote is locked (reopen it first). `quoteId` is the
 * quote's uuid. Sales rules are evaluated first; an error-severity violation
 * refuses the call.
 */
export async function upsertQuoteLine(
  client: SupabaseClient<Database>,
  quotationLine:
    | (Omit<z.infer<typeof quoteLineValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof quoteLineValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  const companyId = (quotationLine as { companyId?: string }).companyId;
  if (!companyId) throw new Error("companyId is required.");
  const serviceRole = getCarbonServiceRole();

  if ("id" in quotationLine) {
    const {
      id: lineId,
      updatedBy: userId,
      customFields,
      companyId: _companyId,
      createdBy: _createdBy,
      ...fields
    } = quotationLine as typeof quotationLine & {
      companyId?: string;
      createdBy?: string;
    };
    await requireToolPermission(
      userId,
      companyId,
      "sales",
      "create",
      "update quote lines"
    );

    // The stored line proves ownership and supplies what a partial update
    // leaves out: the quote it hangs off, and the breaks and method the price
    // reconciliation compares against (an absent `quantity` must not read as
    // "every break removed").
    const stored = await serviceRole
      .from("quoteLine")
      .select("quoteId, quantity, methodType")
      .eq("id", lineId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (stored.error || !stored.data) {
      throw new Error("Quote line not found.");
    }
    const quoteId = stored.data.quoteId;
    if (fields.quoteId && fields.quoteId !== quoteId) {
      throw new Error("A quote line cannot be moved to another quote.");
    }
    await requireUnlockedQuote(companyId, quoteId);

    const result = await updateQuoteLineWithPrices(serviceRole, {
      companyId,
      quoteId,
      lineId,
      userId,
      line: {
        ...fields,
        quoteId,
        quantity: fields.quantity ?? stored.data.quantity ?? [],
        methodType: fields.methodType ?? stored.data.methodType
      },
      customFields
    });
    if (result.error) {
      return {
        data: null,
        error: commandError(result.error.message, result.cause)
      };
    }
    return { data: result.data, error: null };
  }

  const {
    createdBy: userId,
    customFields,
    configuration,
    companyId: _companyId,
    updatedBy: _updatedBy,
    ...fields
  } = quotationLine as typeof quotationLine & { updatedBy?: string };
  await requireToolPermission(
    userId,
    companyId,
    "sales",
    "create",
    "create quote lines"
  );
  await requireToolCompanyRecord(
    "quote",
    companyId,
    { id: fields.quoteId },
    "Quote"
  );
  await requireUnlockedQuote(companyId, fields.quoteId);

  const result = await createQuoteLineWithPrices(serviceRole, {
    companyId,
    quoteId: fields.quoteId,
    userId,
    line: fields,
    configuration: parseConfiguration(configuration),
    customFields
  });
  if (!result.data) {
    return {
      data: null,
      error: commandError(result.error!.message, result.error && result.cause)
    };
  }
  // The bare service returned the inserted row; keep that response shape.
  const row = await client
    .from("quoteLine")
    .select("*")
    .eq("id", result.data.id)
    .single();
  if (result.error) {
    return {
      data: row.data,
      error: commandError(
        `Quote line ${result.data.id} was created, but pricing failed. ${result.error.message}`,
        result.cause
      )
    };
  }
  return row;
}

/** The add-line form posts `configuration` as JSON text; a tool may send either. */
function parseConfiguration(
  configuration: unknown
): Record<string, unknown> | undefined {
  if (configuration === undefined || configuration === null) return undefined;
  if (typeof configuration === "string") {
    try {
      return JSON.parse(configuration);
    } catch {
      throw new Error("configuration must be a JSON object.");
    }
  }
  return configuration as Record<string, unknown>;
}

/**
 * Create or update a quote material and reprice its quote line, as the
 * material form does. Creating a Make to Order material also copies the item's
 * active make method (materials and operations) under it. `createdBy` vs
 * `updatedBy` picks create vs update. The line, make method and operation ids
 * must belong to the company and to `quoteLineId`.
 */
export async function upsertQuoteMaterial(
  client: SupabaseClient<Database>,
  quoteMaterial:
    | (z.infer<typeof quoteMaterialValidator> & {
        quoteId: string;
        quoteLineId: string;
        quoteOperationId?: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof quoteMaterialValidator> & {
        quoteId: string;
        quoteLineId: string;
        quoteOperationId?: string;
        companyId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  const isUpdate = "updatedBy" in quoteMaterial;
  const userId = isUpdate ? quoteMaterial.updatedBy : quoteMaterial.createdBy;
  const { companyId, quoteId, quoteLineId } = quoteMaterial;
  await requireToolPermission(
    userId,
    companyId,
    "sales",
    "create",
    isUpdate ? "update quote materials" : "create quote materials"
  );
  await Promise.all([
    requireToolCompanyRecord(
      "quoteLine",
      companyId,
      { id: quoteLineId, quoteId },
      "Quote line"
    ),
    isUpdate
      ? requireToolCompanyRecord(
          "quoteMaterial",
          companyId,
          { id: quoteMaterial.id, quoteLineId },
          "Quote material"
        )
      : requireToolCompanyRecord(
          "quoteMakeMethod",
          companyId,
          { id: quoteMaterial.quoteMakeMethodId, quoteLineId },
          "Quote make method"
        ),
    quoteMaterial.quoteOperationId
      ? requireToolCompanyRecord(
          "quoteOperation",
          companyId,
          { id: quoteMaterial.quoteOperationId, quoteLineId },
          "Quote operation"
        )
      : undefined
  ]);

  // The routes write materials on the service role once ownership is proven.
  const result = await saveQuoteMaterialWithPrices(
    getCarbonServiceRole(),
    quoteMaterial
  );
  if (result.error) {
    return {
      data: result.data,
      error: commandError(
        result.data
          ? `Quote material ${result.data.id} was saved, but ${lowerFirst(result.error.message)}`
          : result.error.message,
        result.cause
      )
    };
  }
  return { data: result.data, error: null };
}

/**
 * Delete a quote material and reprice its quote line, as the material delete
 * action does. `quoteMaterialId` is the material's id; an unknown id is an
 * error.
 */
export async function deleteQuoteMaterial(
  client: SupabaseClient<Database>,
  quoteMaterialId: string,
  companyId: string,
  userId: string
) {
  await requireToolPermission(
    userId,
    companyId,
    "sales",
    "delete",
    "delete quote materials"
  );
  const material = await getCarbonServiceRole()
    .from("quoteMaterial")
    .select("quoteId, quoteLineId")
    .eq("id", quoteMaterialId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (material.error || !material.data) {
    throw new Error("Quote material not found.");
  }

  const result = await deleteQuoteMaterialWithPrices(client, {
    quoteMaterialId,
    quoteId: material.data.quoteId,
    quoteLineId: material.data.quoteLineId,
    companyId,
    userId
  });
  if (result.error) {
    return {
      data: null,
      error: commandError(result.error.message, result.cause)
    };
  }
  return { data: null, error: null };
}

/**
 * Create or update a quote operation and reprice its quote line, as the
 * operation form does. `createdBy` vs `updatedBy` picks create vs update. The
 * line and make method (create) or operation (update) must belong to the
 * company and to `quoteLineId`.
 */
export async function upsertQuoteOperation(
  client: SupabaseClient<Database>,
  operation:
    | (Omit<z.infer<typeof quoteOperationValidator>, "id"> & {
        quoteId: string;
        quoteLineId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof quoteOperationValidator> & {
        quoteId: string;
        quoteLineId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof quoteOperationValidator>, "id"> & {
        id: string;
        quoteId: string;
        quoteLineId: string;
        companyId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  const isCreate = "createdBy" in operation;
  const userId = isCreate ? operation.createdBy : operation.updatedBy;
  const { companyId, quoteId, quoteLineId } = operation;
  await requireToolPermission(
    userId,
    companyId,
    "sales",
    "create",
    isCreate ? "create quote operations" : "update quote operations"
  );
  await Promise.all([
    requireToolCompanyRecord(
      "quoteLine",
      companyId,
      { id: quoteLineId, quoteId },
      "Quote line"
    ),
    isCreate
      ? requireToolCompanyRecord(
          "quoteMakeMethod",
          companyId,
          { id: operation.quoteMakeMethodId, quoteLineId },
          "Quote make method"
        )
      : requireToolCompanyRecord(
          "quoteOperation",
          companyId,
          { id: operation.id, quoteLineId },
          "Quote operation"
        )
  ]);

  // The routes write operations with the caller's client (RLS applies).
  const result = await saveQuoteOperationWithPrices(client, operation);
  if (result.error) {
    return {
      data: result.data,
      error: commandError(
        result.data
          ? `Quote operation ${result.data.id} was saved, but ${lowerFirst(result.error.message)}`
          : result.error.message,
        result.cause
      )
    };
  }
  return { data: result.data, error: null };
}

/**
 * Delete a quote operation and reprice its quote line, as the operation delete
 * action does. An unknown id is an error.
 */
export async function deleteQuoteOperation(
  client: SupabaseClient<Database>,
  quoteOperationId: string,
  companyId: string,
  userId: string
) {
  await requireToolPermission(
    userId,
    companyId,
    "sales",
    "delete",
    "delete quote operations"
  );
  const result = await deleteQuoteOperationWithPrices(client, {
    quoteOperationId,
    companyId,
    userId
  });
  if (result.error) {
    return {
      data: null,
      error: commandError(result.error.message, result.cause)
    };
  }
  return { data: null, error: null };
}

/**
 * Confirm a sales order as the Confirm button does, without the PDF or email: status from its lines, order date if empty, then MRP for its lines.
 *
 * The status is derived from the lines (an all-service order becomes "To
 * Invoice", otherwise "To Ship and Invoice"), the order date is set to today
 * if empty, and MRP runs for the order so its lines become demand. `salesOrderId` is the order's
 * uuid. Sales rules are evaluated first; an error-severity violation refuses
 * the call.
 */
export async function releaseSalesOrder(
  client: SupabaseClient<Database>,
  salesOrderId: string,
  userId: string,
  companyId: string
) {
  await requireToolPermission(
    userId,
    companyId,
    "sales",
    "create",
    "confirm sales orders",
    { employee: true }
  );
  const result = await confirmSalesOrder(client, {
    salesOrderId,
    companyId,
    userId,
    emailed: false
  });
  if (result.error) {
    return {
      data: null,
      error: commandError(result.error.message, result.cause)
    };
  }
  return { data: result.data, error: null };
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Set a customer return line's disposition as the line's disposition picker does; Scrap and Rework are refused (they are set by escalating the line to an Issue).
 *
 * Accepts Pending, Return to Customer and Use As Is. Refused on a Cancelled
 * return order, and for anything but Pending before a quantity is received.
 * `lineId` is the return order line's uuid.
 */
export async function setSalesReturnOrderLineDisposition(
  client: SupabaseClient<Database>,
  args: {
    lineId: string;
    companyId: string;
    disposition: (typeof salesReturnDispositionType)[number];
    userId: string;
  }
) {
  await requireToolPermission(
    args.userId,
    args.companyId,
    "sales",
    "update",
    "set return line dispositions"
  );
  const result = await setReturnLineDispositionFromPicker(client, args);
  if (result.error) {
    return { data: null, error: { message: result.error.message } };
  }
  return { data: result.data, error: null };
}

/**
 * Change a sales order's status as its status menu does; Cancelled runs the cancel flow, which also cancels the jobs made for the order.
 *
 * With Cancelled, `cancelJobIds` limits which of the order's jobs are
 * cancelled (omit it to cancel all of them, send an empty list to cancel
 * none). Closed clears the assignee. `id` is the order's uuid.
 */
export async function updateSalesOrderStatus(
  client: SupabaseClient<Database>,
  update: {
    id: string;
    companyId: string;
    status: (typeof salesOrderStatusType)[number];
    cancelJobIds?: string[];
    updatedBy: string;
  }
) {
  const { id, companyId, updatedBy: userId } = update;
  await requireToolPermission(
    userId,
    companyId,
    "sales",
    "update",
    "change sales order status"
  );
  await requireToolCompanyRecord(
    "salesOrder",
    companyId,
    { id },
    "Sales order"
  );
  const result = await transitionSalesOrderStatus(client, {
    id,
    userId,
    status: update.status,
    cancelJobIds: update.cancelJobIds
  });
  if (result.error) {
    return {
      data: null,
      error: commandError(result.error.message, result.cause)
    };
  }
  return { data: result.data, error: null };
}
