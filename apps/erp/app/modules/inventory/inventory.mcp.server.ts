import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireToolPermission } from "~/modules/shared/tool-permission.server";
import { type CommandResult, toToolResult } from "~/utils/command-result";
import { ruleError } from "~/utils/supabase";
import {
  createReceipt as createReceiptCommand,
  createSalesOrderLineShipment as createSalesOrderLineShipmentCommand,
  createShipment as createShipmentCommand,
  type PostOutcome,
  postReceipt as postReceiptCommand,
  postShipment as postShipmentCommand,
  voidReceipt as voidReceiptCommand,
  voidShipment as voidShipmentCommand
} from "./inventory.server";

// MCP/API tools for the receipt and shipment lifecycle. Each wraps the command
// its ERP route calls (`inventory.server.ts`), so the tool and the screen run
// the same rule evaluation, the same edge function and the same follow-ups.
// Server-only: never re-exported by the `~/modules/inventory` barrel;
// `registry.server.ts` spreads these exports into the `inventory` namespace
// and `scripts/generate-mcp.ts` publishes them.
//
// The commands read and invoke edge functions through the service role, so
// every tool re-applies its route's `requirePermissions` — `{ create:
// "inventory" }` on `x+/receipt+/new.tsx`, `x+/shipment+/new.tsx` and the
// sales order line Ship action; `{ update: "inventory" }` on the post and void
// actions — through `requireToolPermission` first.
//
// Typical flow: create the document from its source (lines are copied from
// the order), set quantities with inventory_updateReceiptLines /
// inventory_updateShipmentLines, then post.

const INVENTORY_CREATE = { create: "inventory" } as const;
const INVENTORY_UPDATE = { update: "inventory" } as const;

/** A rule block as a tool result: the screen opens a violations dialog, the
 *  tool returns the violations as a rule error naming how to proceed. */
function toPostToolResult(
  result: CommandResult<PostOutcome>,
  documentLabel: string
) {
  if (result.error || result.data.status === "posted") {
    return toToolResult(result);
  }
  const { violations } = result.data;
  const errors = violations.filter((v) => v.severity === "error");
  const lines = violations.map((v) => `[${v.severity}] ${v.message}`);
  const next =
    errors.length > 0
      ? "Resolve the errors and post again."
      : "These are warnings: post again with acknowledged: true to override them, as the warning dialog does.";
  return {
    data: null,
    error: ruleError(
      `Posting the ${documentLabel} was blocked by rules: ${lines.join("; ")}. ${next}`
    )
  };
}

/**
 * Create a Draft receipt with lines copied from a purchase order, sales return
 * order or inbound transfer (sourceDocument + its id), or a blank one without
 * a source. As the Receive button does, the receipt is located at your default
 * location (a transfer uses its own). A sales return order with a Draft receipt already returns that
 * receipt (`existing: true`). The receipt is Draft: set received quantities
 * with inventory_updateReceiptLines, then inventory_postReceipt. Returns the
 * receipt's id.
 */
export async function createReceipt(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  args: {
    sourceDocument?:
      | "Purchase Order"
      | "Sales Return Order"
      | "Inbound Transfer";
    sourceDocumentId?: string;
  }
) {
  await requireToolPermission(
    companyId,
    userId,
    INVENTORY_CREATE,
    "create receipts"
  );
  if (args.sourceDocument && !args.sourceDocumentId) {
    return {
      data: null,
      error: ruleError(
        `sourceDocumentId is required for a ${args.sourceDocument} receipt.`
      )
    };
  }
  return toToolResult(
    await createReceiptCommand(client, {
      companyId,
      userId,
      sourceDocument: args.sourceDocument,
      sourceDocumentId: args.sourceDocumentId
    })
  );
}

/**
 * Post a Draft receipt (rules checked first; pass acknowledged: true to
 * override warnings), writing its inventory, cost and journal entries. As the
 * Post button does, storage rules and over-receipt against the purchase order
 * are checked first: an error, or a warning not acknowledged with
 * `acknowledged: true`, refuses the post and lists the violations. Posting writes the item ledger, cost layers and
 * (with accounting enabled) the journal, updates the purchase order's received
 * quantities and opens any receipt inspections. A voided receipt cannot be
 * posted again. `receiptId` is the receipt's id (not its RE… readable id).
 */
export async function postReceipt(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  args: { receiptId: string; acknowledged?: boolean }
) {
  await requireToolPermission(
    companyId,
    userId,
    INVENTORY_UPDATE,
    "post receipts"
  );
  return toPostToolResult(
    await postReceiptCommand(client, {
      companyId,
      userId,
      receiptId: args.receiptId,
      acknowledged: args.acknowledged === true
    }),
    "receipt"
  );
}

/**
 * Void a Posted receipt, reversing its inventory, cost and journal entries;
 * refused for a receipt created by a purchase invoice (void the invoice).
 * Mirrors the Void action; refused unless the receipt is Posted.
 */
export async function voidReceipt(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  args: { receiptId: string }
) {
  await requireToolPermission(
    companyId,
    userId,
    INVENTORY_UPDATE,
    "void receipts"
  );
  return toToolResult(
    await voidReceiptCommand(client, {
      companyId,
      userId,
      receiptId: args.receiptId
    })
  );
}

/**
 * Create a Draft shipment with lines copied from a sales order, purchase
 * order, return order or outbound transfer (sourceDocument + its id), or a
 * blank one without a source. As the Ship button does, the lines are what is
 * left to ship. Sales and purchase orders ship from your default location, which must
 * be set. Without `sourceDocument` a blank shipment is created. A return order
 * with a Draft shipment already returns that shipment (`existing: true`). The
 * shipment is Draft: set shipped quantities with
 * inventory_updateShipmentLines, then inventory_postShipment. To ship one
 * sales order line, use inventory_createSalesOrderLineShipment.
 */
export async function createShipment(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  args: {
    sourceDocument?:
      | "Sales Order"
      | "Sales Return Order"
      | "Purchase Order"
      | "Purchase Return Order"
      | "Outbound Transfer";
    sourceDocumentId?: string;
  }
) {
  await requireToolPermission(
    companyId,
    userId,
    INVENTORY_CREATE,
    "create shipments"
  );
  if (args.sourceDocument && !args.sourceDocumentId) {
    return {
      data: null,
      error: ruleError(
        `sourceDocumentId is required for a ${args.sourceDocument} shipment.`
      )
    };
  }
  return toToolResult(
    await createShipmentCommand(client, {
      companyId,
      userId,
      sourceDocument: args.sourceDocument,
      sourceDocumentId: args.sourceDocumentId
    })
  );
}

/**
 * Create a Draft shipment for one sales order line at the line's location, as
 * the line's Ship action does. The line's location must be set.
 * `salesOrderLineId` is the line's id. Returns the shipment's id.
 */
export async function createSalesOrderLineShipment(
  companyId: string,
  userId: string,
  args: { salesOrderLineId: string }
) {
  await requireToolPermission(
    companyId,
    userId,
    INVENTORY_CREATE,
    "create shipments"
  );
  return toToolResult(
    await createSalesOrderLineShipmentCommand({
      companyId,
      userId,
      salesOrderLineId: args.salesOrderLineId
    })
  );
}

/**
 * Post a Draft shipment (storage and sales rules checked first; pass
 * acknowledged: true to override warnings), writing its inventory and journal
 * entries. As the Post button does, storage rules and, for a sales order
 * shipment, the order's sales rules are checked first: an error,
 * or a warning not acknowledged with `acknowledged: true`, refuses the post
 * and lists the violations. Expired batches refuse the post unless the
 * company's expired-batch policy is Warn (`warning` then names them). Posting
 * writes the item ledger and (with accounting enabled) cost of goods sold, and
 * updates the order's shipped quantities. No packing slip PDF is filed on the
 * opportunity from here; the Post button files one. `shipmentId` is the
 * shipment's id (not its SH… readable id).
 */
export async function postShipment(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  args: { shipmentId: string; acknowledged?: boolean }
) {
  await requireToolPermission(
    companyId,
    userId,
    INVENTORY_UPDATE,
    "post shipments"
  );
  return toPostToolResult(
    await postShipmentCommand(client, {
      companyId,
      userId,
      shipmentId: args.shipmentId,
      acknowledged: args.acknowledged === true
    }),
    "shipment"
  );
}

/**
 * Void a Posted shipment, reversing its inventory and journal entries, as the
 * Void action does. Refused unless the shipment is Posted.
 */
export async function voidShipment(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  args: { shipmentId: string }
) {
  await requireToolPermission(
    companyId,
    userId,
    INVENTORY_UPDATE,
    "void shipments"
  );
  return toToolResult(
    await voidShipmentCommand(client, {
      companyId,
      userId,
      shipmentId: args.shipmentId
    })
  );
}
