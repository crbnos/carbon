import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import {
  dedupeViolations,
  evaluateLinesForSurface,
  evaluateSalesRuleLines,
  isBlocked,
  resolveSalesOrderShipTo
} from "@carbon/ee/rules.server";
import { storage } from "@carbon/files";
import { trigger } from "@carbon/jobs";
import { trackWorkEvent } from "@carbon/lib/telemetry";
import { raiseMoment } from "@carbon/lib/workflows";
import { getLogger } from "@carbon/logger";
import { getCachedPrinterConfig } from "@carbon/printing/printing.server";
import type { Violation } from "@carbon/utils";
import { datetime, getOverReceiptViolations } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertDocument } from "~/modules/documents/documents.service";
import { recordSalesRuleOutcome } from "~/modules/sales/sales.server";
import { getSalesOrderLine } from "~/modules/sales/sales.service";
import {
  getCompanyTimeZone,
  getLocationTimeZone
} from "~/modules/shared/timezone.server";
import { getUserDefaults } from "~/modules/users/users.server";
import {
  type CommandError,
  type CommandResult,
  commandError,
  commandOk
} from "~/utils/command-result";
import { getEdgeFunctionErrorMessage } from "~/utils/error";
import { stripSpecialCharacters } from "~/utils/string";
import { reconcileReceiptSerialEntities } from "./inventory.service";
import type { ReceiptSourceDocument, ShipmentSourceDocument } from "./types";

// Receipt and shipment COMMANDS: the create-from-source, post and void bodies
// that used to live in the `x+/receipt+` and `x+/shipment+` route actions.
// The routes call these and turn the result into a redirect + flash; the MCP
// companion (`inventory.mcp.server.ts`) wraps them as tools. Server-only: the
// commands read and invoke edge functions through the service role, exactly
// as the routes did, so a caller MUST have passed the route's
// `requirePermissions` (or `requireToolPermission`) first.
//
// Result conventions (`~/utils/command-result`): `error.flash` is the route's
// toast text, unchanged; `error.message` adds the refusal reason (an
// application `Error`, or the message the edge function returned) for API
// callers.

const logger = getLogger("erp", "inventory", "documents");

type ServiceRole = SupabaseClient<Database>;

export type DocumentCommandContext = {
  companyId: string;
  userId: string;
};

/** A post either went through, or was stopped by storage/sales rules before
 *  anything was written. `blocked` is not an error: the screen shows the
 *  violations and lets the user acknowledge warnings and post again. */
export type PostOutcome =
  | { status: "posted"; warning: string | null }
  | {
      status: "blocked";
      violations: Violation[];
      ruleNames: Record<string, string>;
    };

/** The edge function's own message (its JSON body) as the refusal reason;
 *  `errorResponse` in the edge runtime never puts database errors there. */
async function edgeFunctionError(
  flash: string,
  cause: unknown
): Promise<{ data: null; error: CommandError }> {
  const reason = cause ? await getEdgeFunctionErrorMessage(cause, "") : "";
  return {
    data: null,
    error: {
      message: reason && reason !== flash ? `${flash}: ${reason}` : flash,
      flash,
      cause
    }
  };
}

async function invokeCreate(
  serviceRole: ServiceRole,
  body: Record<string, unknown>
) {
  return serviceRole.functions.invoke<{ id: string }>("create", { body });
}

// ---------------------------------------------------------------------------
// Create from a source document
// ---------------------------------------------------------------------------

/**
 * Create a receipt the way the Receive buttons do (`x+/receipt+/new.tsx`):
 * from a purchase order, a sales return order or an inbound warehouse
 * transfer, the `create` edge function copies the outstanding lines; with no
 * source it creates a blank receipt at the user's default location. A sales
 * return order that already has a Draft receipt returns that receipt
 * (`existing: true`) instead of creating a second one.
 */
export async function createReceipt(
  client: SupabaseClient<Database>,
  args: DocumentCommandContext & {
    sourceDocument?: ReceiptSourceDocument;
    sourceDocumentId?: string;
  }
): Promise<CommandResult<{ id: string; existing: boolean }>> {
  const { companyId, userId, sourceDocument } = args;
  const sourceDocumentId = args.sourceDocumentId ?? "";
  const defaults = await getUserDefaults(client, userId, companyId);
  const serviceRole = getCarbonServiceRole();

  switch (sourceDocument) {
    case "Purchase Order": {
      const created = await invokeCreate(serviceRole, {
        type: "receiptFromPurchaseOrder",
        companyId,
        locationId: defaults.data?.locationId,
        purchaseOrderId: sourceDocumentId,
        receiptId: undefined,
        userId
      });
      if (!created.data || created.error) {
        return edgeFunctionError("Failed to create receipt", created.error);
      }
      return commandOk({ id: created.data.id, existing: false });
    }
    case "Sales Return Order": {
      // One open draft per RMA: receiving again returns the existing draft
      // instead of stacking up duplicates.
      const existing = await client
        .from("receipt")
        .select("id")
        .eq("sourceDocument", "Sales Return Order")
        .eq("sourceDocumentId", sourceDocumentId)
        .eq("status", "Draft")
        .eq("companyId", companyId)
        .order("createdAt", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing.error) {
        return commandError(
          "Failed to check for an existing receipt",
          existing.error
        );
      }
      if (existing.data) {
        return commandOk({ id: existing.data.id, existing: true });
      }

      // No default-location guard: the create edge function falls back to
      // the return order's own location and errors specifically otherwise.
      const created = await invokeCreate(serviceRole, {
        type: "receiptFromSalesReturnOrder",
        companyId,
        locationId: defaults.data?.locationId,
        salesReturnOrderId: sourceDocumentId,
        receiptId: undefined,
        userId
      });
      if (!created.data || created.error) {
        return edgeFunctionError(
          await getEdgeFunctionErrorMessage(
            created.error,
            "Failed to create receipt"
          ),
          created.error
        );
      }
      return commandOk({ id: created.data.id, existing: false });
    }
    case "Inbound Transfer": {
      const created = await invokeCreate(serviceRole, {
        type: "receiptFromInboundTransfer",
        companyId,
        warehouseTransferId: sourceDocumentId,
        receiptId: undefined,
        userId
      });
      if (!created.data || created.error) {
        return edgeFunctionError("Failed to create receipt", created.error);
      }
      return commandOk({ id: created.data.id, existing: false });
    }
    default: {
      const created = await invokeCreate(serviceRole, {
        type: "receiptDefault",
        companyId,
        locationId: defaults.data?.locationId,
        userId
      });
      if (!created.data || created.error) {
        return edgeFunctionError("Failed to create receipt", created.error);
      }
      return commandOk({ id: created.data.id, existing: false });
    }
  }
}

const NO_DEFAULT_LOCATION =
  "Set a default location in your settings before creating a shipment";

/**
 * Create a shipment the way the Ship buttons do (`x+/shipment+/new.tsx`):
 * from a sales order, purchase order (return to supplier), sales or purchase
 * return order, or outbound warehouse transfer, the `create` edge function
 * copies the lines still to ship; with no source it creates a blank shipment.
 * Sales and purchase orders need the user's default location. A return order
 * that already has a Draft shipment returns that shipment (`existing: true`).
 */
export async function createShipment(
  client: SupabaseClient<Database>,
  args: DocumentCommandContext & {
    sourceDocument?: ShipmentSourceDocument;
    sourceDocumentId?: string;
  }
): Promise<CommandResult<{ id: string; existing: boolean }>> {
  const { companyId, userId, sourceDocument } = args;
  const sourceDocumentId = args.sourceDocumentId ?? "";
  const defaults = await getUserDefaults(client, userId, companyId);
  const serviceRole = getCarbonServiceRole();

  const created = async (body: Record<string, unknown>) => {
    const result = await invokeCreate(serviceRole, body);
    if (!result.data || result.error) {
      logger.error("Failed to create shipment", { error: result.error });
      return edgeFunctionError(
        await getEdgeFunctionErrorMessage(
          result.error,
          "Failed to create shipment"
        ),
        result.error
      );
    }
    return commandOk({ id: result.data.id, existing: false });
  };

  // One open draft per return order: shipping again returns the existing
  // draft instead of stacking up duplicates.
  const existingDraft = async (
    source: "Sales Return Order" | "Purchase Return Order"
  ) => {
    const existing = await client
      .from("shipment")
      .select("id")
      .eq("sourceDocument", source)
      .eq("sourceDocumentId", sourceDocumentId)
      .eq("status", "Draft")
      .eq("companyId", companyId)
      .order("createdAt", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing.error) {
      return commandError(
        "Failed to check for an existing shipment",
        existing.error
      );
    }
    return existing.data
      ? commandOk({ id: existing.data.id, existing: true })
      : null;
  };

  switch (sourceDocument) {
    case "Sales Order":
      if (!defaults.data?.locationId) return commandError(NO_DEFAULT_LOCATION);
      return created({
        type: "shipmentFromSalesOrder",
        companyId,
        locationId: defaults.data.locationId,
        salesOrderId: sourceDocumentId,
        shipmentId: undefined,
        userId
      });
    case "Sales Return Order": {
      const existing = await existingDraft("Sales Return Order");
      if (existing) return existing;
      return created({
        type: "shipmentFromSalesReturnOrder",
        companyId,
        locationId: defaults.data?.locationId,
        salesReturnOrderId: sourceDocumentId,
        shipmentId: undefined,
        userId
      });
    }
    case "Purchase Return Order": {
      const existing = await existingDraft("Purchase Return Order");
      if (existing) return existing;
      return created({
        type: "shipmentFromPurchaseReturnOrder",
        companyId,
        locationId: defaults.data?.locationId,
        purchaseReturnOrderId: sourceDocumentId,
        shipmentId: undefined,
        userId
      });
    }
    case "Purchase Order":
      if (!defaults.data?.locationId) return commandError(NO_DEFAULT_LOCATION);
      return created({
        type: "shipmentFromPurchaseOrder",
        companyId,
        locationId: defaults.data.locationId,
        purchaseOrderId: sourceDocumentId,
        shipmentId: undefined,
        userId
      });
    case "Outbound Transfer":
      return created({
        type: "shipmentFromWarehouseTransfer",
        companyId,
        warehouseTransferId: sourceDocumentId,
        shipmentId: undefined,
        userId
      });
    default:
      return created({
        type: "shipmentDefault",
        companyId,
        locationId: defaults.data?.locationId,
        userId
      });
  }
}

/**
 * Create a shipment for one sales order line, as the line's Ship action does
 * (`x+/sales-order+/$orderId.$lineId.shipment.tsx`): the shipment is created at
 * the line's location, which must be set.
 */
export async function createSalesOrderLineShipment(
  args: DocumentCommandContext & { salesOrderLineId: string }
): Promise<CommandResult<{ id: string }>> {
  const { companyId, userId, salesOrderLineId } = args;
  const serviceRole = getCarbonServiceRole();
  const salesOrderLine = await getSalesOrderLine(serviceRole, salesOrderLineId);
  if (salesOrderLine.error) {
    return commandError("Failed to get sales order line", salesOrderLine.error);
  }
  if (companyId !== salesOrderLine.data.companyId) {
    // A string cause: the reason stays out of the API message, which must not
    // confirm that the line exists in another company.
    return commandError(
      "Failed to get sales order line",
      "Company does not match"
    );
  }
  if (!salesOrderLine.data.locationId) {
    return commandError(
      "Set a location on this sales order line before creating a shipment"
    );
  }

  const created = await invokeCreate(serviceRole, {
    type: "shipmentFromSalesOrderLine",
    locationId: salesOrderLine.data.locationId,
    salesOrderLineId,
    companyId,
    userId
  });
  if (!created.data || created.error) {
    logger.error("Failed to create shipment", { error: created.error });
    return edgeFunctionError("Failed to create shipment", created.error);
  }
  return commandOk({ id: created.data.id });
}

// ---------------------------------------------------------------------------
// Post / void receipts
// ---------------------------------------------------------------------------

const VOIDED_RECEIPT = "Cannot post a voided receipt";

/**
 * Post a receipt, as the Post button does (`x+/receipt+/$receiptId.post.tsx`):
 * evaluates storage rules on the `receipt` and `place` surfaces (plus
 * `warehouseTransfer` for an inbound transfer) and over-receipt against the
 * live purchase order lines; a rule error, or an unacknowledged warning,
 * returns `blocked` without writing anything. Otherwise clears stale serial
 * entities, marks the receipt Pending and runs the `post-receipt` edge function
 * (item ledger, cost layers, journal, PO quantities, inspections). A failed
 * posting puts the receipt back to Draft. Afterwards: lead-time update when
 * the company enables it, label auto-print, the `inventory.receiptPosted`
 * workflow moment.
 */
export async function postReceipt(
  client: SupabaseClient<Database>,
  args: DocumentCommandContext & { receiptId: string; acknowledged: boolean }
): Promise<CommandResult<PostOutcome>> {
  const { companyId, userId, receiptId, acknowledged } = args;

  // Service-role reads so item / storageUnit reads are not blocked by RLS for
  // users who have `inventory.update` but not `parts.view` etc.
  const serviceRole = getCarbonServiceRole();
  const { data: lines } = await serviceRole
    .from("receiptLine")
    .select(
      "id, itemId, storageUnitId, receivedQuantity, locationId, receiptId, requiresSerialTracking, lineId, conversionFactor"
    )
    .eq("receiptId", receiptId)
    .eq("companyId", companyId);

  const { data: receiptForSurface } = await serviceRole
    .from("receipt")
    .select("sourceDocument, status")
    .eq("id", receiptId)
    .eq("companyId", companyId)
    .single();

  // A voided receipt has already been reversed — re-posting would duplicate
  // ledger entries, cost layers and journal lines. Refused before any write
  // (the Pending flip below is also conditioned on it).
  if (receiptForSurface?.status === "Voided") {
    return commandError(VOIDED_RECEIPT);
  }

  // Receipts from an Inbound Transfer ALSO evaluate the `warehouseTransfer`
  // surface — the post auto-completes the parent transfer.
  const isTransfer = receiptForSurface?.sourceDocument === "Inbound Transfer";
  const evalLines = (lines ?? []).map((l) => ({
    lineId: l.id as string,
    itemId: l.itemId as string | null,
    storageUnitId: l.storageUnitId as string | null,
    quantity: Number(l.receivedQuantity ?? 0),
    locationId: l.locationId as string | null
  }));

  const allViolations: Violation[] = [];
  const allRuleNames: Record<string, string> = {};
  // Receipt pass, then the place pass (the bin side); dedupe collapses the
  // transfer overlap.
  const surfaces: ("receipt" | "place" | "warehouseTransfer")[] = isTransfer
    ? ["receipt", "warehouseTransfer", "place", "warehouseTransfer"]
    : ["receipt", "place"];
  for (const surface of surfaces) {
    const { violations, ruleNames } = await evaluateLinesForSurface({
      client: serviceRole,
      companyId,
      userId,
      targetType: "item",
      surface,
      lines: evalLines
    });
    allViolations.push(...violations);
    Object.assign(allRuleNames, ruleNames);
  }

  // Over-receipt against the live PO lines rather than the receipt's
  // outstanding-quantity snapshot, so concurrent receipts are counted.
  if (receiptForSurface?.sourceDocument === "Purchase Order") {
    const purchaseOrderLineIds = [
      ...new Set(
        (lines ?? [])
          .map((l) => l.lineId)
          .filter((id): id is string => Boolean(id))
      )
    ];
    if (purchaseOrderLineIds.length > 0) {
      const { data: purchaseOrderLines } = await serviceRole
        .from("purchaseOrderLine")
        .select(
          "id, purchaseQuantity, quantityReceived, item(readableIdWithRevision)"
        )
        .in("id", purchaseOrderLineIds)
        .eq("companyId", companyId);

      const overReceipt = getOverReceiptViolations(
        lines ?? [],
        (purchaseOrderLines ?? []).map((line) => ({
          id: line.id,
          purchaseQuantity: line.purchaseQuantity,
          quantityReceived: line.quantityReceived,
          itemReadableId: line.item?.readableIdWithRevision
        }))
      );
      allViolations.push(...overReceipt.violations);
      Object.assign(allRuleNames, overReceipt.ruleNames);
    }
  }

  const deduped = dedupeViolations(allViolations);
  if (deduped.length > 0 && isBlocked(deduped, acknowledged)) {
    return commandOk({
      status: "blocked",
      violations: deduped,
      ruleNames: allRuleNames
    });
  }

  // Serial-tracked lines can accumulate stale tracked entities (reduced
  // quantity leaves orphans, edited serials leave duplicates) that would
  // otherwise be flipped to Available as phantom serials.
  await reconcileReceiptSerialEntities(serviceRole, {
    receiptId,
    companyId,
    lines: lines ?? []
  });

  // Atomic with the voided guard above: a concurrent void between the check
  // and here matches zero rows instead of being flipped back to Pending.
  const setPendingState = await client
    .from("receipt")
    .update({ status: "Pending" })
    .eq("id", receiptId)
    .eq("companyId", companyId)
    .neq("status", "Voided")
    .select("id");
  if (setPendingState.error) {
    return commandError("Failed to post receipt", setPendingState.error);
  }
  if (!setPendingState.data?.length) {
    return commandError(VOIDED_RECEIPT);
  }

  const revertToDraft = () =>
    client.from("receipt").update({ status: "Draft" }).eq("id", receiptId);

  let failure: { data: null; error: CommandError } | null = null;
  try {
    const receiptMetadata = await serviceRole
      .from("receipt")
      .select("sourceDocument,sourceDocumentId")
      .eq("id", receiptId)
      .single();

    const companySettings = await (serviceRole.from("companySettings") as any)
      .select("updateLeadTimesOnReceipt,printing")
      .eq("id", companyId)
      .single();

    const posted = await serviceRole.functions.invoke("post-receipt", {
      body: { receiptId, userId, companyId }
    });
    if (posted.error) {
      await revertToDraft();
      // A posting that never happened fires no workflow moment.
      return edgeFunctionError("Failed to post receipt", posted.error);
    }

    const shouldUpdateLeadTimesOnReceipt = Boolean(
      (companySettings.data as { updateLeadTimesOnReceipt?: boolean } | null)
        ?.updateLeadTimesOnReceipt
    );
    if (
      shouldUpdateLeadTimesOnReceipt &&
      receiptMetadata.data?.sourceDocument === "Purchase Order" &&
      receiptMetadata.data?.sourceDocumentId
    ) {
      const leadTimeUpdate = await serviceRole.functions.invoke(
        "update-purchased-prices",
        {
          body: {
            source: "purchaseOrder",
            purchaseOrderId: receiptMetadata.data.sourceDocumentId,
            companyId,
            userId,
            updatePrices: false,
            updateLeadTimes: true
          }
        }
      );
      if (leadTimeUpdate.error) {
        logger.error(
          "Failed to update lead time on receipt posting:",
          leadTimeUpdate.error
        );
      }
    }

    // Auto-print labels if enabled
    try {
      const { data: receipt } = await serviceRole
        .from("receipt")
        .select("locationId")
        .eq("id", receiptId)
        .single();
      const locationId = receipt?.locationId as string | undefined;
      if (locationId) {
        const config = await getCachedPrinterConfig(
          serviceRole,
          companyId,
          locationId,
          "receiving"
        );
        if (config?.autoPrint ?? true) {
          await trigger("print-job", {
            sourceDocument: "Receipt",
            sourceDocumentId: receiptId,
            companyId,
            userId,
            locationId
          });
        }
      }
    } catch (e) {
      logger.error("Auto-print failed", { error: e });
    }
  } catch (thrown) {
    logger.error("Receipt post failed; reverted to Draft", {
      companyId,
      receiptId,
      error: thrown
    });
    await revertToDraft();
    failure = commandError("Failed to post receipt", thrown);
  }

  // Runs after a thrown-and-reverted post too, as it always has (#1294);
  // changing when workflows fire is a separate decision.
  await raiseMoment("inventory.receiptPosted", {
    outputs: { receipt: { id: receiptId }, postedBy: { id: userId } },
    companyId,
    actorId: userId
  });

  if (failure) return failure;

  trackWorkEvent("receipt_posted", {
    companyId,
    userId,
    receiptId,
    sourceDocument: receiptForSurface?.sourceDocument ?? null
  });
  return commandOk({ status: "posted", warning: null });
}

/**
 * Void a Posted receipt, as the Void action does
 * (`x+/receipt+/$receiptId.void.tsx`): the `post-receipt` edge function
 * reverses its ledger, cost and journal entries. Refused unless the receipt is
 * Posted, and for a receipt created by a purchase invoice (void the invoice).
 */
export async function voidReceipt(
  client: SupabaseClient<Database>,
  args: DocumentCommandContext & { receiptId: string }
): Promise<CommandResult<{ id: string }>> {
  const { companyId, userId, receiptId } = args;
  const FAILED = "Failed to void receipt";

  const { data: receipt } = await client
    .from("receipt")
    .select("status, invoiced")
    .eq("id", receiptId)
    .eq("companyId", companyId)
    .single();
  if (!receipt) return commandError(FAILED, new Error("Receipt not found"));
  if (receipt.status !== "Posted") {
    return commandError(FAILED, new Error("Can only void posted receipts"));
  }
  if (receipt.invoiced) {
    return commandError(
      FAILED,
      new Error(
        "Cannot void a receipt created by a purchase invoice. Void the invoice instead."
      )
    );
  }

  const voided = await getCarbonServiceRole().functions.invoke("post-receipt", {
    body: { type: "void", receiptId, userId, companyId }
  });
  if (voided.error) return edgeFunctionError(FAILED, voided.error);
  return commandOk({ id: receiptId });
}

// ---------------------------------------------------------------------------
// Post / void shipments
// ---------------------------------------------------------------------------

type ExpiredEntityPolicy = "Warn" | "Block" | "BlockWithOverride";

export const SHIPMENT_NOT_FOUND = "Shipment not found";

/**
 * Post a shipment, as the Post button does
 * (`x+/shipment+/$shipmentId.post.tsx`): evaluates storage rules on the
 * `shipment` and `pick` surfaces (plus `warehouseTransfer` for an outbound
 * transfer) and, for a sales order shipment, the order's sales rules at the
 * shipped quantities; a rule error, or an unacknowledged warning, returns
 * `blocked` without posting (blocked sales rules are recorded on the order).
 * Refuses expired batches unless the company's expired-entity policy is Warn
 * (then `warning` says which). Otherwise marks the shipment Pending and runs
 * the `post-shipment` edge function (item ledger, COGS, SO quantities); a
 * failed posting puts it back to Draft.
 *
 * `renderPackingSlip` renders the packing slip PDF that a sales order shipment
 * files on the opportunity. It needs the browser request, so only the route
 * passes it; without it the post goes ahead with no packing slip, as it does
 * when the PDF fails.
 */
export async function postShipment(
  client: SupabaseClient<Database>,
  args: DocumentCommandContext & {
    shipmentId: string;
    acknowledged: boolean;
    renderPackingSlip?: () => Promise<Response>;
  }
): Promise<CommandResult<PostOutcome>> {
  const { companyId, userId, shipmentId, acknowledged } = args;

  const serviceRole = getCarbonServiceRole();
  const { data: lines } = await serviceRole
    .from("shipmentLine")
    .select(
      "id, lineId, itemId, storageUnitId, shippedQuantity, locationId, shipmentId"
    )
    .eq("shipmentId", shipmentId)
    .eq("companyId", companyId);

  const { data: shipmentForSurface } = await serviceRole
    .from("shipment")
    .select("sourceDocument, sourceDocumentId, locationId")
    .eq("id", shipmentId)
    // Service-role read: companyId scope is not backstopped by RLS here.
    .eq("companyId", companyId)
    .maybeSingle();

  // Everything below reads through the service role by shipmentId (the
  // packing slip included), so a shipment outside this company stops here.
  if (!shipmentForSurface) {
    logger.error("Shipment not found for company", { companyId, shipmentId });
    return commandError(SHIPMENT_NOT_FOUND);
  }

  // Outbound transfers ALSO evaluate the `warehouseTransfer` surface — the
  // post auto-completes the parent transfer.
  const isTransfer = shipmentForSurface.sourceDocument === "Outbound Transfer";
  const evalLines = (lines ?? []).map((l) => ({
    lineId: l.id as string,
    itemId: l.itemId as string | null,
    storageUnitId: l.storageUnitId as string | null,
    quantity: Number(l.shippedQuantity ?? 0),
    locationId: l.locationId as string | null
  }));

  const allViolations: Violation[] = [];
  const allRuleNames: Record<string, string> = {};
  // Shipment pass, then the pick pass (the bin side).
  const surfaces: ("shipment" | "pick" | "warehouseTransfer")[] = isTransfer
    ? ["shipment", "warehouseTransfer", "pick", "warehouseTransfer"]
    : ["shipment", "pick"];
  for (const surface of surfaces) {
    const { violations, ruleNames } = await evaluateLinesForSurface({
      client: serviceRole,
      companyId,
      userId,
      targetType: "item",
      surface,
      lines: evalLines
    });
    allViolations.push(...violations);
    Object.assign(allRuleNames, ruleNames);
  }

  // Sales rules on the originating sales order — the last physical checkpoint.
  // Sales rules have no `shipment` surface, so this evaluates under
  // `salesOrderLine`, scoped to THIS shipment's lines at their shipped
  // quantities, against the order's resolved ship-to.
  let salesRuleViolations: Violation[] = [];
  if (
    shipmentForSurface.sourceDocument === "Sales Order" &&
    shipmentForSurface.sourceDocumentId
  ) {
    const shipTo = await resolveSalesOrderShipTo(
      serviceRole,
      shipmentForSurface.sourceDocumentId,
      companyId
    );
    const { violations, ruleNames } = await evaluateSalesRuleLines({
      client: serviceRole,
      companyId,
      userId,
      surface: "salesOrderLine",
      lines: (lines ?? [])
        .filter((l) => !!l.itemId && Number(l.shippedQuantity ?? 0) > 0)
        .map((l) => ({
          // Attribute to the source sales-order line when linked, so the
          // evidence row and deep link land on the order line.
          lineId: (l.lineId as string | null) ?? (l.id as string),
          itemId: l.itemId as string,
          quantity: Number(l.shippedQuantity)
        })),
      customerId: shipTo.customerId,
      customerLocationId: shipTo.customerLocationId
    });
    salesRuleViolations = violations;
    allViolations.push(...violations);
    Object.assign(allRuleNames, ruleNames);
  }

  const deduped = dedupeViolations(allViolations);
  // Evidence covers only the SALES violations, attributed to the source order.
  // A post blocked by any violation records its sales violations as blocked;
  // acknowledged evidence waits until the post has committed.
  const salesDeduped = dedupeViolations(salesRuleViolations);
  if (deduped.length > 0 && isBlocked(deduped, acknowledged)) {
    if (salesDeduped.length > 0 && shipmentForSurface.sourceDocumentId) {
      await recordSalesRuleOutcome(serviceRole, {
        companyId,
        userId,
        documentType: "salesOrder",
        documentId: shipmentForSurface.sourceDocumentId,
        outcome: "blocked",
        violations: salesDeduped,
        ruleNames: allRuleNames
      });
    }
    return commandOk({
      status: "blocked",
      violations: deduped,
      ruleNames: allRuleNames
    });
  }

  // Expired-batch policy (companySettings.inventoryShelfLife): refuse to post
  // when any tracked entity on the shipment is past its expirationDate, unless
  // the policy is "Warn". Mirrors post-stock-transfer / issue.
  const { data: companySettings } = await serviceRole
    .from("companySettings")
    .select("inventoryShelfLife")
    .eq("id", companyId)
    .single();
  const shelfLifeBlob = companySettings?.inventoryShelfLife as {
    expiredEntityPolicy?: ExpiredEntityPolicy;
  } | null;
  const expiredPolicy: ExpiredEntityPolicy =
    shelfLifeBlob?.expiredEntityPolicy ?? "Block";

  const { data: shipmentTrackedEntities } = await serviceRole
    .from("trackedEntity")
    .select("id, readableId, expirationDate")
    .eq("attributes ->> Shipment", shipmentId)
    .eq("companyId", companyId);

  // Expiry is judged on the shipping site's calendar, not the server's; no
  // location on the shipment → the company calendar.
  const shipmentLocationId = shipmentForSurface.locationId as string | null;
  const todayLocal = datetime.today(
    shipmentLocationId
      ? await getLocationTimeZone(serviceRole, shipmentLocationId, companyId)
      : await getCompanyTimeZone(serviceRole, companyId)
  );
  const expiredEntities = (shipmentTrackedEntities ?? []).filter((e) => {
    if (!e.expirationDate) return false;
    try {
      return parseDate(e.expirationDate).compare(todayLocal) < 0;
    } catch {
      return false;
    }
  });

  let expiredWarning: string | null = null;
  if (expiredEntities.length > 0) {
    const ids = expiredEntities.map((e) => e.readableId ?? e.id).join(", ");
    const plural = expiredEntities.length === 1 ? "" : "es";
    if (expiredPolicy === "Block" || expiredPolicy === "BlockWithOverride") {
      return commandError(
        `Cannot post shipment with expired batch${plural}: ${ids}`
      );
    }
    expiredWarning = `Posted shipment with expired batch${plural}: ${ids}`;
  }

  const setPendingState = await client
    .from("shipment")
    .update({ status: "Pending" })
    .eq("id", shipmentId);
  if (setPendingState.error) {
    return commandError("Failed to post shipment", setPendingState.error);
  }

  const revertToDraft = () =>
    client.from("shipment").update({ status: "Draft" }).eq("id", shipmentId);

  let failure: { data: null; error: CommandError } | null = null;
  try {
    const { data: shipment } = await serviceRole
      .from("shipment")
      .select("sourceDocument, sourceDocumentId, shipmentId")
      .eq("id", shipmentId)
      .eq("companyId", companyId)
      .single();

    // A sales order shipment files its packing slip PDF on the opportunity.
    if (
      args.renderPackingSlip &&
      shipment?.sourceDocument === "Sales Order" &&
      shipment?.sourceDocumentId
    ) {
      try {
        await filePackingSlip(serviceRole, {
          companyId,
          userId,
          shipmentId,
          shipmentReadableId: shipment.shipmentId,
          salesOrderId: shipment.sourceDocumentId,
          renderPackingSlip: args.renderPackingSlip
        });
      } catch (err) {
        // Continue with posting even if PDF generation fails
        logger.error("Failed to generate packing slip PDF", { error: err });
      }
    }

    const posted = await serviceRole.functions.invoke("post-shipment", {
      body: { type: "post", shipmentId, userId, companyId }
    });
    if (posted.error) {
      await revertToDraft();
      // A posting that never happened fires no workflow moment.
      return edgeFunctionError("Failed to post shipment", posted.error);
    }

    // Auto-print labels if enabled
    try {
      const { data: shipmentForPrint } = await serviceRole
        .from("shipment")
        .select("locationId")
        .eq("id", shipmentId)
        .eq("companyId", companyId)
        .single();
      const locationId = shipmentForPrint?.locationId as string | undefined;
      if (locationId) {
        const config = await getCachedPrinterConfig(
          serviceRole,
          companyId,
          locationId,
          "shipping"
        );
        if (config?.autoPrint ?? true) {
          await trigger("print-job", {
            sourceDocument: "Shipment",
            sourceDocumentId: shipmentId,
            companyId,
            userId,
            locationId
          });
        }
      }
    } catch (e) {
      logger.error("Auto-print failed", { error: e });
    }

    // Labels for batch split entities. splitEntityIds carries the RETAINED
    // shelf lots (their quantity changed in the split); the shipped child
    // departed Consumed and gets no label.
    const splitEntityIds: string[] = posted.data?.splitEntityIds || [];
    if (splitEntityIds.length > 0) {
      try {
        for (const entityId of splitEntityIds) {
          await trigger("print-job", {
            sourceDocument: "Entity",
            sourceDocumentId: entityId,
            companyId,
            userId
          });
        }
      } catch (e) {
        logger.error("Auto-print for split entities failed", { error: e });
      }
    }
  } catch (thrown) {
    logger.error("Shipment post failed; reverted to Draft", {
      companyId,
      shipmentId,
      error: thrown
    });
    await revertToDraft();
    failure = commandError("Failed to post shipment", thrown);
  }

  // Runs after a thrown-and-reverted post too, as it always has (#1294).
  await raiseMoment("inventory.shipmentPosted", {
    outputs: { shipment: { id: shipmentId }, postedBy: { id: userId } },
    companyId,
    actorId: userId
  });

  if (failure) return failure;

  // Acknowledged-override evidence only once the post has stuck.
  if (salesDeduped.length > 0 && shipmentForSurface.sourceDocumentId) {
    await recordSalesRuleOutcome(serviceRole, {
      companyId,
      userId,
      documentType: "salesOrder",
      documentId: shipmentForSurface.sourceDocumentId,
      outcome: "acknowledged",
      violations: salesDeduped,
      ruleNames: allRuleNames
    });
  }
  trackWorkEvent("shipment_posted", {
    companyId,
    userId,
    shipmentId,
    sourceDocument: shipmentForSurface.sourceDocument ?? null
  });
  return commandOk({ status: "posted", warning: expiredWarning });
}

async function filePackingSlip(
  serviceRole: ServiceRole,
  args: DocumentCommandContext & {
    shipmentId: string;
    shipmentReadableId: string;
    salesOrderId: string;
    renderPackingSlip: () => Promise<Response>;
  }
) {
  const { companyId, userId, shipmentId } = args;
  const { data: salesOrder } = await serviceRole
    .from("salesOrder")
    .select("opportunityId")
    .eq("id", args.salesOrderId)
    .eq("companyId", companyId)
    .single();
  if (!salesOrder?.opportunityId) return;

  const pdf = await args.renderPackingSlip();
  if (pdf.headers.get("content-type") !== "application/pdf") return;

  const file = await pdf.arrayBuffer();
  const fileName = stripSpecialCharacters(
    `${args.shipmentReadableId} - ${new Date().toISOString().slice(0, -5)}.pdf`
  );
  const documentFilePath = `${companyId}/opportunity/${salesOrder.opportunityId}/${fileName}`;

  const upload = await storage(serviceRole)
    .company(companyId)
    .upload(documentFilePath, file, {
      cacheControl: `${12 * 60 * 60}`,
      contentType: "application/pdf",
      upsert: true
    });
  if (upload.error) return;

  await upsertDocument(serviceRole, {
    path: documentFilePath,
    name: fileName,
    size: Math.round(file.byteLength / 1024),
    sourceDocument: "Shipment",
    sourceDocumentId: shipmentId,
    readGroups: [userId],
    writeGroups: [userId],
    createdBy: userId,
    companyId
  });
}

/**
 * Void a Posted shipment, as the Void action does
 * (`x+/shipment+/$shipmentId.void.tsx`): the `post-shipment` edge function
 * reverses its ledger and journal entries. Refused unless the shipment is
 * Posted.
 */
export async function voidShipment(
  client: SupabaseClient<Database>,
  args: DocumentCommandContext & { shipmentId: string }
): Promise<CommandResult<{ id: string }>> {
  const { companyId, userId, shipmentId } = args;
  const FAILED = "Failed to void shipment";

  const { data: shipment } = await client
    .from("shipment")
    .select("status")
    .eq("id", shipmentId)
    .eq("companyId", companyId)
    .single();
  if (!shipment) return commandError(FAILED, new Error(SHIPMENT_NOT_FOUND));
  if (shipment.status !== "Posted") {
    return commandError(FAILED, new Error("Can only void posted shipments"));
  }

  const voided = await getCarbonServiceRole().functions.invoke(
    "post-shipment",
    { body: { type: "void", shipmentId, userId, companyId } }
  );
  if (voided.error) return edgeFunctionError(FAILED, voided.error);
  return commandOk({ id: shipmentId });
}
